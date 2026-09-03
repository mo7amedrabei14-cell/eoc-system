from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from datetime import date, time, datetime
import time
import psycopg
import io
import pandas as pd
from psycopg.types.json import Jsonb

from dependencies import get_db, RequirePermission, get_current_user
from audit import create_audit_log
from auth import get_user_role, get_user_branches

router = APIRouter(prefix="/missions", tags=["Missions"])

# ==========================================
# 1. إنشاء مهمة جديدة
# ==========================================
class CreateMissionRequest(BaseModel):
    mission_code: str
    branch_id: int
    mission_type: str
    mission_name: str | None = None
    mission_location: str | None = None
    is_open_mission: bool = False
    exit_date: date | None = None
    arrival_date: date | None = None
    return_date: date | None = None
    departure_time: time | None = None
    arrival_time: time | None = None
    completion_time: time | None = None
    responsible_person: str | None = None
    driver_name: str | None = None
    vehicle_number: str | None = None
    notes: str | None = None
    governorate_id: int | None = None
    injured_count: int = 0
    indirect_beneficiaries: int = 0
    data_source: str | None = None
    idempotency_key: Optional[str] = None

@router.post("/", status_code=201)
def create_mission(
    data: CreateMissionRequest,
    current_user_id: int = Depends(RequirePermission("mission.create")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        # Atomic idempotency reservation
        if data.idempotency_key:
            # Start transaction: insert placeholder if not exists
            cursor.execute("""
                WITH ins AS (
                    INSERT INTO idempotency_keys (idempotency_key, response, original_status)
                    VALUES (%s, NULL::jsonb, NULL::int)
                    ON CONFLICT (idempotency_key) DO NOTHING
                    RETURNING idempotency_key
                )
                SELECT
                    CASE WHEN (SELECT COUNT(*) FROM ins) = 1 THEN true ELSE false END AS we_are_owner,
                    (SELECT response, original_status FROM idempotency_keys WHERE idempotency_key = %s) AS existing
            """, (data.idempotency_key, data.idempotency_key))

            result = cursor.fetchone()
            we_are_owner = result[0]
            existing_response = result[1]['response'] if result[1] and result[1]['response'] is not None else None
            existing_status = result[1]['original_status'] if result[1] and result[1]['original_status'] is not None else None

            # If we are not the owner, wait for the result or return what we have
            if not we_are_owner:
                # Wait up to 2 attempts for the owner to complete (100ms each)
                for _ in range(2):
                    if existing_response is not None and existing_status is not None:
                        break
                    cursor.execute("""
                        SELECT response, original_status
                        FROM idempotency_keys
                        WHERE idempotency_key = %s
                    """, (data.idempotency_key,))
                    r = cursor.fetchone()
                    existing_response = r['response'] if r and r['response'] is not None else None
                    existing_status = r['original_status'] if r and r['original_status'] is not None else None
                    time.sleep(0.1)

                # If we still don't have a response, something went wrong
                if existing_response is None:
                    raise HTTPException(status_code=500, detail="Idempotency owner failed to produce a response")

                return {
                    "message": existing_response.get("message", "Mission processed"),
                    "mission_id": existing_response.get("mission_id"),
                    "status": existing_response.get("status")
                } | {"original_status": existing_status}

            # We are the owner - proceed with mission creation
        # If no idempotency key, we proceed normally (non-idempotent)

        cursor.execute("SELECT branch_name FROM branches WHERE branch_id = %s AND is_active = TRUE;", (data.branch_id,))
        if not cursor.fetchone(): raise HTTPException(status_code=404, detail="Active branch not found")

        cursor.execute(
            """
            INSERT INTO missions (
                mission_code, branch_id, mission_type, mission_name, mission_location, is_open_mission,
                exit_date, arrival_date, return_date, departure_time, arrival_time,
                completion_time, responsible_person, driver_name, vehicle_number, notes,
                created_by, governorate_id, injured_count, indirect_beneficiaries, data_source
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            ) RETURNING mission_id, mission_code, status;
            """,
            (
                data.mission_code, data.branch_id, data.mission_type, data.mission_name, data.mission_location, data.is_open_mission,
                data.exit_date, data.arrival_date, data.return_date, data.departure_time, data.arrival_time,
                data.completion_time, data.responsible_person, data.driver_name, data.vehicle_number, data.notes,
                current_user_id, data.governorate_id, data.injured_count, data.indirect_beneficiaries, data.data_source
            )
        )
        mission = cursor.fetchone()
        mission_id = mission[0]
        mission_code_from_db = mission[1]
        mission_status = mission[2]
        create_audit_log(cursor, current_user_id, "CREATE_MISSION", mission_id, "mission", mission_id, {"mission_code": mission_code_from_db})

        # Build final response
        response = {
            "message": "Mission created successfully",
            "mission_id": mission_id,
            "mission_code": mission_code_from_db,
            "status": mission_status
        }

        # Finalize idempotency record if we have a key and we are the owner
        if data.idempotency_key and we_are_owner:
            cursor.execute("""
                UPDATE idempotency_keys
                SET response = %s,
                    original_status = %s
                WHERE idempotency_key = %s
            """, (Jsonb(response), mission_status, data.idempotency_key))

        return response

@router.get("/")
def get_missions(
    current_user_id: int = Depends(RequirePermission("mission.view")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("SELECT mission_id, mission_code, mission_type, status FROM missions ORDER BY created_at DESC;")
        return [{"mission_id": r[0], "mission_code": r[1], "mission_type": r[2], "status": r[3]} for r in cursor.fetchall()]

# ==========================================
# 2. إضافة مشارك (مع خط سير مخصص بوقت وتاريخ)
# ==========================================
class AddMissionParticipantRequest(BaseModel):
    participant_type: str
    volunteer_id: int | None = None
    full_name: str | None = None
    branch_id: int | None = None
    membership_number: str | None = None
    phone: str | None = None
    participation_role: str | None = None
    notes: str | None = None
    # تفاصيل خط السير
    route_from: str | None = None
    route_to: str | None = None
    route_date: date | None = None
    departure_time: time | None = None
    arrival_time: time | None = None

@router.post("/{mission_id}/participants", status_code=201)
def add_mission_participant(
    mission_id: int,
    data: AddMissionParticipantRequest,
    current_user_id: int = Depends(RequirePermission("mission.participant.add")),
    connection: psycopg.Connection = Depends(get_db)
):
    participant_type = data.participant_type.strip().lower()
    
    with connection.cursor() as cursor:
        cursor.execute("SELECT mission_id FROM missions WHERE mission_id = %s;", (mission_id,))
        if not cursor.fetchone(): raise HTTPException(status_code=404, detail="Mission not found")

        if participant_type == "volunteer":
            if data.volunteer_id:
                volunteer_id = data.volunteer_id
                full_name = "متطوع مسجل"
            else:
                cursor.execute(
                    "INSERT INTO volunteers (full_name, phone, branch_id, membership_number, is_active) VALUES (%s, %s, %s, %s, TRUE) RETURNING volunteer_id;",
                    (data.full_name, data.phone, data.branch_id, data.membership_number)
                )
                volunteer_id = cursor.fetchone()[0]
                full_name = data.full_name
                
            cursor.execute(
                """
                INSERT INTO mission_participants 
                (mission_id, participant_type, volunteer_id, notes, route_from, route_to, route_date, departure_time, arrival_time) 
                VALUES (%s, 'volunteer', %s, %s, %s, %s, %s, %s, %s) RETURNING participant_id;
                """, 
                (mission_id, volunteer_id, data.notes, data.route_from, data.route_to, data.route_date, data.departure_time, data.arrival_time)
            )
            participant_id = cursor.fetchone()[0]
            
        else: # Non-volunteer
            full_name = data.full_name
            cursor.execute(
                """
                INSERT INTO mission_participants 
                (mission_id, participant_type, full_name, phone, participation_role, notes, route_from, route_to, route_date, departure_time, arrival_time) 
                VALUES (%s, 'non_volunteer', %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING participant_id;
                """,
                (mission_id, data.full_name, data.phone, data.participation_role, data.notes, data.route_from, data.route_to, data.route_date, data.departure_time, data.arrival_time)
            )
            participant_id = cursor.fetchone()[0]

    return {"message": "Participant added", "participant_id": participant_id, "name": full_name}

# ==========================================
# 3. تصنيفات المستفيدين (Beneficiaries)
# ==========================================
class BeneficiaryRequest(BaseModel):
    category_name: str
    beneficiary_count: int
    notes: str | None = None

@router.post("/{mission_id}/beneficiaries", status_code=201)
def add_beneficiary(
    mission_id: int, data: BeneficiaryRequest,
    user_id: int = Depends(RequirePermission("mission.edit")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("SELECT mission_id FROM missions WHERE mission_id = %s;", (mission_id,))
        if not cursor.fetchone(): raise HTTPException(status_code=404, detail="Mission not found")
        
        cursor.execute(
            "INSERT INTO mission_beneficiaries (mission_id, category_name, beneficiary_count, notes) VALUES (%s, %s, %s, %s) RETURNING id;",
            (mission_id, data.category_name, data.beneficiary_count, data.notes)
        )
        return {"message": "Beneficiary category added successfully", "id": cursor.fetchone()[0]}

# ==========================================
# 4. باقي عمليات المهمة (Itineraries, Staff, Logs)
# ==========================================
class ItineraryRequest(BaseModel):
    itinerary_date: date
    route_from: str
    route_to: str
    departure_time: time | None = None
    arrival_time: time | None = None

@router.post("/{mission_id}/itineraries", status_code=201)
def add_itinerary(
    mission_id: int, data: ItineraryRequest,
    user_id: int = Depends(RequirePermission("mission.edit")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO mission_itineraries (mission_id, itinerary_date, route_from, route_to, departure_time, arrival_time) VALUES (%s, %s, %s, %s, %s, %s) RETURNING itinerary_id;", (mission_id, data.itinerary_date, data.route_from, data.route_to, data.departure_time, data.arrival_time))
        return {"message": "Itinerary added", "itinerary_id": cursor.fetchone()[0]}

class EOCStaffRequest(BaseModel):
    shift_date: date
    role_name: str
    staff_name: str
    phone: str | None = None

@router.post("/{mission_id}/staff", status_code=201)
def add_eoc_staff(
    mission_id: int, data: EOCStaffRequest,
    user_id: int = Depends(RequirePermission("mission.edit")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO mission_eoc_staff (mission_id, shift_date, role_name, staff_name, phone) VALUES (%s, %s, %s, %s, %s) RETURNING staff_id;", (mission_id, data.shift_date, data.role_name, data.staff_name, data.phone))
        return {"message": "Staff added", "staff_id": cursor.fetchone()[0]}

class MissionLogRequest(BaseModel):
    branch_id: int | None = None
    communication_method: str | None = None
    log_date: date
    log_time: time
    action_status: str | None = None
    notes: str | None = None

@router.post("/{mission_id}/logs", status_code=201)
def add_mission_log(
    mission_id: int, data: MissionLogRequest,
    user_id: int = Depends(get_current_user),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("INSERT INTO mission_logs (mission_id, branch_id, communication_method, log_date, log_time, action_status, notes, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING log_id;", (mission_id, data.branch_id, data.communication_method, data.log_date, data.log_time, data.action_status, data.notes, user_id))
        return {"message": "Log added", "log_id": cursor.fetchone()[0]}

# ==========================================
# 5. التقرير السحري المُحدّث (المشاركين مدمجين بخط السير)
# ==========================================
@router.get("/{mission_id}/export-excel")
def export_mission_excel(
    mission_id: int,
    user_id: int = Depends(RequirePermission("mission.view")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("SELECT m.*, b.branch_name FROM missions m LEFT JOIN branches b ON m.branch_id = b.branch_id WHERE m.mission_id = %s;", (mission_id,))
        mission = cursor.fetchone()
        if not mission: raise HTTPException(status_code=404, detail="Mission not found")
        
        # جلب خط السير العام الأول للمهمة لاستخدامه كـ Fallback لو المشارك معندوش خط مخصص
        cursor.execute("SELECT route_date, route_from, route_to, departure_time, arrival_time FROM mission_itineraries WHERE mission_id = %s ORDER BY itinerary_date, departure_time LIMIT 1;", (mission_id,))
        fallback_route = cursor.fetchone()

        # جلب المشاركين بكل تفاصيلهم وخط سيرهم المخصص إن وُجد
        cursor.execute("""
            SELECT 
                COALESCE(v.membership_number, '-') AS membership, 
                COALESCE(v.full_name, mp.full_name) AS name, 
                COALESCE(v.phone, mp.phone) AS phone, 
                mp.participant_type, 
                mp.participation_role, 
                mp.route_from, 
                mp.route_to,
                mp.route_date,
                mp.departure_time,
                mp.arrival_time
            FROM mission_participants mp 
            LEFT JOIN volunteers v ON v.volunteer_id = mp.volunteer_id 
            WHERE mp.mission_id = %s;
        """, (mission_id,))
        participants_raw = cursor.fetchall()
        
        # دمج خط السير مع بيانات المشاركين في قائمة واحدة
        participants_list = []
        for p in participants_raw:
            # لو المشارك ليه خط سير مخصص، خده.. لو مفيش، خد العام
            if p[5] and p[6]:
                r_date, r_from, r_to, r_dep, r_arr = p[7], p[5], p[6], p[8], p[9]
            elif fallback_route:
                r_date, r_from, r_to, r_dep, r_arr = fallback_route[0], fallback_route[1], fallback_route[2], fallback_route[3], fallback_route[4]
            else:
                r_date, r_from, r_to, r_dep, r_arr = None, "غير محدد", "غير محدد", None, None

            participants_list.append({
                "رقم العضوية": p[0], 
                "الاسم": p[1], 
                "الموبايل": p[2], 
                "النوع": "متطوع" if p[3] == 'volunteer' else "غير متطوع", 
                "الصفة / الدور": p[4] if p[4] else "-",
                "تاريخ التحرك": r_date,
                "من": r_from,
                "إلى": r_to,
                "وقت التحرك": r_dep,
                "وقت الوصول": r_arr
            })

        # جلب تصنيفات المستفيدين، الطاقم، والسجلات
        cursor.execute("SELECT category_name, beneficiary_count, notes FROM mission_beneficiaries WHERE mission_id = %s;", (mission_id,))
        beneficiaries = cursor.fetchall()

        cursor.execute("SELECT shift_date, role_name, staff_name, phone FROM mission_eoc_staff WHERE mission_id = %s;", (mission_id,))
        staff = cursor.fetchall()

        cursor.execute("SELECT log_date, log_time, communication_method, action_status, notes FROM mission_logs WHERE mission_id = %s;", (mission_id,))
        logs = cursor.fetchall()

    # إنشاء ملف الإكسيل
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        pd.DataFrame([{"كود المهمة": mission[1], "اسم المهمة": mission[3], "الفرع": mission[-1], "عدد المصابين": mission[22], "المستفيدين (إجمالي)": mission[23], "السائق": mission[14], "السيارة": mission[15]}]).to_excel(writer, sheet_name='البيانات الأساسية', index=False)
        
        # التاب المدمج (المشاركون + خطوط سيرهم)
        if participants_list: pd.DataFrame(participants_list).to_excel(writer, sheet_name='فريق العمل وخطوط السير', index=False)
        
        if beneficiaries: pd.DataFrame(beneficiaries, columns=["التصنيف الفئوي", "العدد", "ملاحظات"]).to_excel(writer, sheet_name='تصنيف المستفيدين', index=False)
        if staff: pd.DataFrame(staff, columns=["التاريخ", "الدور", "الاسم", "الموبايل"]).to_excel(writer, sheet_name='طاقم الغرفة', index=False)
        if logs: pd.DataFrame(logs, columns=["التاريخ", "الوقت", "وسيلة الاتصال", "الإجراء", "ملاحظات"]).to_excel(writer, sheet_name='سجل الإشارات', index=False)

    output.seek(0)
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": f"attachment; filename=Mission_{mission[1]}.xlsx"})