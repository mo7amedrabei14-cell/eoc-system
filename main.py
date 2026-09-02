from fastapi import FastAPI, Depends, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, time, datetime
from psycopg.errors import UniqueViolation

# ملفات المشروع الخاصة بيك
from audit import create_audit_log
from db import get_connection
from pwdlib import PasswordHash
from routers import users, missions, volunteers, branches

from auth import (
    authenticate_user,
    create_access_token,
    get_current_user_id,
    get_user_role,
    get_effective_permissions,
    get_user_branches,
    authorize,
    password_hash
)

security = HTTPBearer()

CLEAR_ALL_CONFIRMATION_CODE = "301014"


class ClearAllRequest(BaseModel):
    confirmation_code: str


def require_owner_for_clear(user_id: int):
    role = get_user_role(user_id)

    if not role or role["role_name"].upper() not in ["OWNER", "المالك"]:
        raise HTTPException(
            status_code=403,
            detail="هذه العملية متاحة للمالك فقط"
        )


def validate_clear_confirmation(data: ClearAllRequest):
    if data.confirmation_code != CLEAR_ALL_CONFIRMATION_CODE:
        raise HTTPException(
            status_code=400,
            detail="رمز التأكيد غير صحيح. لم يتم حذف أي بيانات."
        )
app = FastAPI(title="EOC System", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(missions.router)
app.include_router(volunteers.router)
app.include_router(branches.router)

@app.get("/")
def root():
    return {"system": "EOC System", "status": "online"}

@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = authenticate_user(form_data.username, form_data.password)
    if not user: raise HTTPException(status_code=401, detail="اسم المستخدم أو كلمة المرور غير صحيحة")

    role = get_user_role(user["user_id"])
    if not role: raise HTTPException(status_code=403, detail="User has no assigned role")

    permissions = get_effective_permissions(role["role_id"])

    # 💡 التعديل هنا: خليناه upper() عشان يتجاهل الحروف السمول والكابيتال
    if role["role_name"].upper() == "OWNER":
        connection = get_connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT branch_id, branch_name, has_geographic_scope FROM branches WHERE is_active = TRUE ORDER BY branch_id;")
                rows = cursor.fetchall()
                user_branches = [{"branch_id": row[0], "branch_name": row[1], "has_geographic_scope": row[2]} for row in rows]
        finally:
            connection.close()
        is_global_admin = True
    else:
        user_branches = get_user_branches(user["user_id"])
        is_global_admin = False

    access_token = create_access_token(user["user_id"])

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "user_id": user["user_id"], "full_name": user["full_name"], "username": user["username"],
            "role": role["role_name"], "permissions": permissions, "branches": user_branches,
            "is_global_admin": is_global_admin
        }
    }


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

@app.post("/auth/change-password")
def change_password(data: ChangePasswordRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    current_user_id = get_current_user_id(token)

    if not current_user_id: raise HTTPException(status_code=401, detail="Invalid token")
    if data.new_password != data.confirm_password: raise HTTPException(status_code=422, detail="Passwords do not match")
    if len(data.new_password) < 8: raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT password_hash FROM users WHERE user_id = %s AND is_active = TRUE;", (current_user_id,))
            user = cursor.fetchone()
            if not user: raise HTTPException(status_code=404, detail="User not found")
            current_password_hash = user[0]
            if not current_password_hash: raise HTTPException(status_code=400, detail="User password not configured")
            if not password_hash.verify(data.current_password, current_password_hash): raise HTTPException(status_code=401, detail="Incorrect password")
            new_password_hash = password_hash.hash(data.new_password)
            cursor.execute("UPDATE users SET password_hash = %s WHERE user_id = %s;", (new_password_hash, current_user_id))
        connection.commit()
        return {"message": "Password changed successfully"}
    finally:
        connection.close()


@app.get("/api/dashboard/stats")
def get_dashboard_stats(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # 💡 سحب الإحصائيات الدقيقة للسايكل
            cursor.execute("SELECT COUNT(*) FROM missions WHERE status = 'Under Review'")
            under_review = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM missions WHERE status = 'Approved'")
            approved = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM missions WHERE status = 'Completed'")
            completed = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM missions WHERE status IN ('Draft', 'Returned')")
            drafts = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM missions WHERE status NOT IN ('Completed', 'Closed', 'Canceled')")
            active_missions = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM volunteers WHERE is_active = TRUE")
            ready_teams = cursor.fetchone()[0]

            if active_missions > 50: emergency_level = "حالة قصوى (أحمر)"
            elif active_missions > 20: emergency_level = "تأهب (أصفر)"
            else: emergency_level = "مستقر (أخضر)"

            return {
                "active_missions": active_missions, 
                "ready_teams": ready_teams, 
                "emergency_level": emergency_level,
                "under_review": under_review,
                "approved": approved,
                "completed": completed,
                "drafts": drafts
            }
    except Exception as e:
        print(e)
        return {"active_missions": 0, "ready_teams": 0, "emergency_level": "مستقر", "under_review": 0, "approved": 0, "completed": 0, "drafts": 0}
    finally:
        connection.close()

@app.get("/api/branches/locations")
def get_branches_locations(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT 
                    MAX(b.branch_id), TRIM(b.branch_name), MAX(b.address), MAX(b.latitude), MAX(b.longitude),
                    SUM(COALESCE(i.cars, 0)), SUM(COALESCE(i.tents, 0)), SUM(COALESCE(i.mattresses, 0)),
                    SUM(COALESCE(i.fire_extinguishers, 0)), SUM(COALESCE(i.plastic_mats, 0)), SUM(COALESCE(i.pillows, 0)),
                    SUM(COALESCE(i.bed_sheets, 0)), SUM(COALESCE(i.blood_banks, 0)), SUM(COALESCE(i.hospitals, 0)),
                    SUM(COALESCE(i.ambulances, 0)), SUM(COALESCE(i.water_tanks, 0)), SUM(COALESCE(i.plastic_buckets, 0)),
                    SUM(COALESCE(i.plastic_jerrycans, 0)), SUM(COALESCE(i.blankets, 0)), SUM(COALESCE(i.motorola_radios, 0)),
                    SUM(COALESCE(i.huawei_radios, 0)), SUM(COALESCE(i.first_aid_kits, 0)), SUM(COALESCE(i.stretchers, 0)),
                    SUM(COALESCE(i.helmets, 0)), SUM(COALESCE(i.ice_boxes, 0)), SUM(COALESCE(i.vests, 0)),
                    SUM(COALESCE(i.caps, 0)), SUM(COALESCE(i.disinfection_machines, 0)), SUM(COALESCE(i.manual_sprayers, 0)),
                    SUM(COALESCE(i.plastic_goggles, 0)), SUM(COALESCE(i.plastic_boots, 0)), SUM(COALESCE(i.psych_support_teams, 0)),
                    SUM(COALESCE(i.psych_support_vols, 0)), SUM(COALESCE(i.health_awareness_teams, 0)), SUM(COALESCE(i.health_awareness_vols, 0)),
                    SUM(COALESCE(i.first_aid_trainers_hq, 0)), SUM(COALESCE(i.first_aid_trainers_branch, 0)), SUM(COALESCE(i.first_aid_teams, 0)),
                    SUM(COALESCE(i.first_aid_vols, 0)), SUM(COALESCE(i.wash_vols, 0)), SUM(COALESCE(i.emergency_teams, 0)), SUM(COALESCE(i.emergency_vols, 0))
                FROM branches b
                LEFT JOIN branch_inventory i ON b.branch_id = i.branch_id
                WHERE b.is_active = TRUE AND b.latitude IS NOT NULL
                GROUP BY TRIM(b.branch_name)
                ORDER BY TRIM(b.branch_name);
            """)
            rows = cursor.fetchall()
            return [
                {
                    "id": r[0], "name": r[1], "address": r[2] or "بدون عنوان", 
                    "lat": float(r[3]), "lng": float(r[4]),
                    "cars": int(r[5]), "tents": int(r[6]), "mattresses": int(r[7]), "fire_extinguishers": int(r[8]),
                    "plastic_mats": int(r[9]), "pillows": int(r[10]), "bed_sheets": int(r[11]), "blood_banks": int(r[12]),
                    "hospitals": int(r[13]), "ambulances": int(r[14]), "water_tanks": int(r[15]), "plastic_buckets": int(r[16]),
                    "plastic_jerrycans": int(r[17]), "blankets": int(r[18]), "motorola_radios": int(r[19]), "huawei_radios": int(r[20]),
                    "first_aid_kits": int(r[21]), "stretchers": int(r[22]), "helmets": int(r[23]), "ice_boxes": int(r[24]),
                    "vests": int(r[25]), "caps": int(r[26]), "disinfection_machines": int(r[27]), "manual_sprayers": int(r[28]),
                    "plastic_goggles": int(r[29]), "plastic_boots": int(r[30]), "psych_support_teams": int(r[31]), "psych_support_vols": int(r[32]),
                    "health_awareness_teams": int(r[33]), "health_awareness_vols": int(r[34]), "first_aid_trainers_hq": int(r[35]),
                    "first_aid_trainers_branch": int(r[36]), "first_aid_teams": int(r[37]), "first_aid_vols": int(r[38]),
                    "wash_vols": int(r[39]), "emergency_teams": int(r[40]), "emergency_vols": int(r[41])
                } for r in rows
            ]
    except Exception as e:
        return []
    finally:
        connection.close()


class RouteModel(BaseModel):
    group_title: str
    route_to: str
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None

class VehicleModel(BaseModel):
    driver_name: str
    vehicle_number: str

class ParticipantModel(BaseModel):
    participant_type: str
    full_name: str
    team_name: str
    team_code: str
    participation_role: str
    branch_id: int
    assigned_itinerary: str
    return_status: str = "مازال بالمهمة"
    phase_name: str = "اليوم الأول"
    stay_type: str = "ذهاب وعودة"

class BeneficiaryModel(BaseModel):
    category_name: str
    direct_count: int
    indirect_count: int

class EOCStaffModel(BaseModel):
    role_name: str
    staff_name: str

class MissionCreate(BaseModel):
    mission_name: str
    mission_classification: str = "عادية"
    branch_id: int
    mission_type: Optional[str] = None
    mission_location: Optional[str] = None
    responsible_person: Optional[str] = None
    data_source: Optional[str] = None
    status: str
    
    exit_date: Optional[str] = None
    departure_date: Optional[str] = None
    arrival_date: Optional[str] = None
    return_date: Optional[str] = None
    completion_date: Optional[str] = None
    
    start_time: Optional[str] = None
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    completion_time: Optional[str] = None
    
    injured_count: Optional[int] = 0
    indirect_beneficiaries_total: Optional[int] = 0
    notes: Optional[str] = None
    internal_notes: Optional[str] = None
    
    mission_code: Optional[str] = None
    created_at: Optional[str] = None
    
    routes: List[RouteModel] = []
    vehicles: List[VehicleModel] = []
    participants: List[ParticipantModel] = []
    beneficiaries: List[BeneficiaryModel] = []
    eoc_staff: List[EOCStaffModel] = []


@app.get("/api/missions")
def get_missions(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    
    role = get_user_role(user_id)
    if not role: raise HTTPException(status_code=403)

    role_name = role["role_name"]
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            base_query = """
                SELECT 
                    m.mission_id, m.mission_code, m.mission_classification, m.created_at, m.mission_name, 
                    (SELECT COUNT(*) FROM mission_participants p WHERE p.mission_id = m.mission_id AND p.participant_type = 'volunteer') as vol_count,
                    (SELECT COUNT(*) FROM mission_participants p WHERE p.mission_id = m.mission_id AND p.participant_type = 'non_volunteer') as non_vol_count,
                    (SELECT STRING_AGG(DISTINCT team_code::text, ' - ') FROM mission_participants p WHERE p.mission_id = m.mission_id AND p.team_code != '') as team_codes,
                    m.responsible_person,
                    (SELECT STRING_AGG(driver_name::text, ' - ') FROM mission_vehicles v WHERE v.mission_id = m.mission_id) as drivers,
                    (SELECT STRING_AGG(vehicle_number::text, ' - ') FROM mission_vehicles v WHERE v.mission_id = m.mission_id) as plates,
                    m.status, b.branch_name, m.mission_type, m.mission_location, m.data_source, m.departure_date, m.completion_date, m.notes, m.exit_date
                FROM missions m
                LEFT JOIN branches b ON m.branch_id = b.branch_id
            """
            
            if role_name.upper() in ["OWNER", "MANAGER", "ADMIN", "SUPERVISOR", "JOKER", "OPERATION", "مشرف", "جوكر", "المالك", "أوبريشن"]:
                query = base_query + " ORDER BY m.created_at DESC;"
                cursor.execute(query)
            else:
                user_branches = get_user_branches(user_id)
                branch_ids = [b["branch_id"] for b in user_branches]
                if not branch_ids: return []
                # 💡 الإصلاح الأول: استخدام = ANY(%s) بدل IN %s
                query = base_query + " WHERE m.branch_id = ANY(%s) ORDER BY m.created_at DESC;"
                cursor.execute(query, (branch_ids,))
                
            rows = cursor.fetchall()
            
            mission_ids = [r[0] for r in rows]
            beneficiaries_dict = {mid: [] for mid in mission_ids}
            if mission_ids:
                # 💡 الإصلاح التاني: استخدام = ANY(%s) بدل IN %s
                cursor.execute("SELECT mission_id, category_name, direct_count, indirect_count FROM mission_beneficiaries WHERE mission_id = ANY(%s)", (mission_ids,))
                for b_row in cursor.fetchall():
                    beneficiaries_dict[b_row[0]].append({"category_name": b_row[1], "direct_count": b_row[2], "indirect_count": b_row[3]})

            result = []
            for r in rows:
                m_id = r[0]
                result.append({
                    "mission_id": m_id, "mission_code": r[1], "mission_classification": r[2] or "عادية",
                    "created_at": r[3].strftime("%Y-%m-%d") if hasattr(r[3], 'strftime') else str(r[3]).split(' ')[0] if r[3] else "-", 
                    "mission_name": r[4] or "بدون اسم",
                    "vol_count": r[5] or 0, "non_vol_count": r[6] or 0, "total_participants": (r[5] or 0) + (r[6] or 0),
                    "team_codes": r[7] or "-", "responsible_person": r[8] or "-", "drivers": r[9] or "-",
                    "plates": r[10] or "-", "status": r[11] or "Draft", "branch": r[12] or "-",
                    "mission_type": r[13] or "-", "mission_location": r[14] or "-", "data_source": r[15] or "-",
                    "departure_date": str(r[16]) if r[16] else "-", "completion_date": str(r[17]) if r[17] else "-",
                    "notes": r[18] or "-",
                    "exit_date": str(r[19]) if len(r) > 19 and r[19] else "-",
                    "beneficiaries": beneficiaries_dict.get(m_id, []),
                    "vehicles_info": f"{r[9] or ''} ({r[10] or ''})" if r[9] else "لا توجد سيارات" 
                })
            return result
    except Exception as e:
        print(f"Error fetching missions: {e}")
        raise HTTPException(status_code=500, detail="حدث خطأ داخلي أثناء جلب المهام")
    finally:
        connection.close()

@app.post("/api/missions")
def create_mission(mission: MissionCreate, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            mission_code = f"#MSN-{datetime.now().strftime('%y%m%d-%H%M%S')}"
            def none_if_empty(val): return val if val != "" else None

            cursor.execute("""
                INSERT INTO missions (
                    mission_code, mission_name, mission_classification, branch_id, mission_type, mission_location, responsible_person,
                    data_source, status, exit_date, departure_date, arrival_date, return_date, completion_date,
                    start_time, departure_time, arrival_time, completion_time, injured_count, 
                    indirect_beneficiaries_total, notes, internal_notes
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                ) RETURNING mission_id;
            """, (
                mission_code, mission.mission_name, mission.mission_classification, mission.branch_id, mission.mission_type, mission.mission_location,
                mission.responsible_person, mission.data_source, mission.status,
                none_if_empty(mission.exit_date), none_if_empty(mission.departure_date), none_if_empty(mission.arrival_date),
                none_if_empty(mission.return_date), none_if_empty(mission.completion_date),
                none_if_empty(mission.start_time), none_if_empty(mission.departure_time), none_if_empty(mission.arrival_time),
                none_if_empty(mission.completion_time),
                mission.injured_count, mission.indirect_beneficiaries_total, mission.notes, mission.internal_notes
            ))
            mission_id = cursor.fetchone()[0]

            for route in mission.routes:
                cursor.execute("""
                    INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_time, arrival_time)
                    VALUES (%s, %s, %s, %s, %s);
                """, (mission_id, route.group_title, route.route_to, none_if_empty(route.departure_time), none_if_empty(route.arrival_time)))

            for vehicle in mission.vehicles:
                cursor.execute("INSERT INTO mission_vehicles (mission_id, driver_name, vehicle_number) VALUES (%s, %s, %s);", (mission_id, vehicle.driver_name, vehicle.vehicle_number))

            for part in mission.participants:
                # 1. أوتوميشن الإغلاق
                if mission.status in ['Completed', 'مكتملة']:
                    part.return_status = 'تم انتهاء مهمتة'
                
                # 2. رادار التتبع لمنع خروج المتطوع في مهمتين مع بعض
                if part.return_status == 'مازال بالمهمة' and part.participation_role.strip() != '':
                    cursor.execute("""
                        SELECT m.mission_name FROM mission_participants p
                        JOIN missions m ON p.mission_id = m.mission_id
                        WHERE p.participation_role = %s AND p.return_status = 'مازال بالمهمة' AND m.status NOT IN ('Completed', 'Cancelled', 'Returned')
                    """, (part.participation_role,))
                    active_in_other = cursor.fetchone()
                    if active_in_other:
                        raise Exception(f"المشارك '{part.full_name}' (رقم {part.participation_role}) متواجد حالياً في مهمة نشطة أخرى ({active_in_other[0]}).\n\nلا يمكن إضافته حتى يتم تسجيل عودته في تلك المهمة أولاً.")

                cursor.execute("""
                    INSERT INTO mission_participants (mission_id, participant_type, full_name, team_name, team_code, participation_role, branch_id, assigned_itinerary, return_status, phase_name, stay_type)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (mission_id, part.participant_type, part.full_name, part.team_name, part.team_code, part.participation_role, part.branch_id, part.assigned_itinerary, part.return_status, part.phase_name, part.stay_type))

            for ben in mission.beneficiaries:
                cursor.execute("INSERT INTO mission_beneficiaries (mission_id, category_name, direct_count, indirect_count) VALUES (%s, %s, %s, %s);", (mission_id, ben.category_name, ben.direct_count, ben.indirect_count))

            for staff in mission.eoc_staff:
                cursor.execute("INSERT INTO mission_eoc_staff (mission_id, role_name, staff_name) VALUES (%s, %s, %s);", (mission_id, staff.role_name, staff.staff_name))

            # 💡 تسجيل اللوج
            try:
                create_audit_log(cursor, user_id, "إنشاء مهمة", mission_id=mission_id, entity_type="mission", entity_id=mission_id, details={"action_text": f"قام بإنشاء استمارة جديدة بكود: {mission_code}"})
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم حفظ المهمة بنجاح", "mission_code": mission_code, "mission_id": mission_id}
            
    except Exception as e:
        connection.rollback()
        if "متواجد حالياً في مهمة نشطة أخرى" in str(e):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/missions/{mission_id}")
def update_mission(mission_id: int, mission: MissionCreate, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None

            # 1. تحديث البيانات الأساسية (بدون تغيير كود المهمة)
            # 1. تحديث البيانات الأساسية
            cursor.execute("""
                UPDATE missions SET
                    mission_name=%s, mission_classification=%s, branch_id=%s, mission_type=%s, mission_location=%s,
                    responsible_person=%s, data_source=%s, status=%s, exit_date=%s, departure_date=%s,
                    arrival_date=%s, return_date=%s, completion_date=%s, start_time=%s, departure_time=%s,
                    arrival_time=%s, completion_time=%s, injured_count=%s, indirect_beneficiaries_total=%s,
                    notes=%s, internal_notes=%s,
                    mission_code = COALESCE(%s, mission_code),
                    created_at = COALESCE(%s::timestamp, created_at)
                WHERE mission_id=%s;
            """, (
                mission.mission_name, mission.mission_classification, mission.branch_id, mission.mission_type, mission.mission_location,
                mission.responsible_person, mission.data_source, mission.status,
                none_if_empty(mission.exit_date), none_if_empty(mission.departure_date), none_if_empty(mission.arrival_date),
                none_if_empty(mission.return_date), none_if_empty(mission.completion_date),
                none_if_empty(mission.start_time), none_if_empty(mission.departure_time), none_if_empty(mission.arrival_time),
                none_if_empty(mission.completion_time),
                mission.injured_count, mission.indirect_beneficiaries_total, mission.notes, mission.internal_notes,
                none_if_empty(mission.mission_code), none_if_empty(mission.created_at),
                mission_id
            ))

            # 2. مسح التفاصيل القديمة (عشان منعملش تكرار)
            cursor.execute("DELETE FROM mission_itineraries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_vehicles WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_participants WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_beneficiaries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_eoc_staff WHERE mission_id = %s", (mission_id,))

            # 3. إدخال التفاصيل الجديدة بعد التعديل
            for route in mission.routes:
                cursor.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_time, arrival_time) VALUES (%s, %s, %s, %s, %s);", (mission_id, route.group_title, route.route_to, none_if_empty(route.departure_time), none_if_empty(route.arrival_time)))

            for vehicle in mission.vehicles:
                cursor.execute("INSERT INTO mission_vehicles (mission_id, driver_name, vehicle_number) VALUES (%s, %s, %s);", (mission_id, vehicle.driver_name, vehicle.vehicle_number))

            for part in mission.participants:
                if mission.status in ['Completed', 'مكتملة']:
                    part.return_status = 'تم انتهاء مهمتة'
                
                if part.return_status == 'مازال بالمهمة' and part.participation_role.strip() != '':
                    cursor.execute("""
                        SELECT m.mission_name FROM mission_participants p
                        JOIN missions m ON p.mission_id = m.mission_id
                        WHERE p.participation_role = %s AND p.return_status = 'مازال بالمهمة' 
                        AND m.status NOT IN ('Completed', 'Cancelled', 'Returned') AND m.mission_id != %s
                    """, (part.participation_role, mission_id))
                    active_in_other = cursor.fetchone()
                    if active_in_other:
                        raise Exception(f"المشارك '{part.full_name}' (رقم {part.participation_role}) متواجد حالياً في مهمة نشطة أخرى ({active_in_other[0]}).\n\nلا يمكن إضافته أو تحديث بياناته حتى يتم تسجيل عودته أولاً.")

                cursor.execute("INSERT INTO mission_participants (mission_id, participant_type, full_name, team_name, team_code, participation_role, branch_id, assigned_itinerary, return_status, phase_name, stay_type) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);", (mission_id, part.participant_type, part.full_name, part.team_name, part.team_code, part.participation_role, part.branch_id, part.assigned_itinerary, part.return_status, part.phase_name, part.stay_type))

            for ben in mission.beneficiaries:
                cursor.execute("INSERT INTO mission_beneficiaries (mission_id, category_name, direct_count, indirect_count) VALUES (%s, %s, %s, %s);", (mission_id, ben.category_name, ben.direct_count, ben.indirect_count))

            for staff in mission.eoc_staff:
                cursor.execute("INSERT INTO mission_eoc_staff (mission_id, role_name, staff_name) VALUES (%s, %s, %s);", (mission_id, staff.role_name, staff.staff_name))

            # 💡 تسجيل اللوج
            try:
                create_audit_log(cursor, user_id, "تحديث/مراجعة", mission_id=mission_id, entity_type="mission", entity_id=mission_id, details={"action_text": f"قام بتحديث الاستمارة أو تغيير حالتها إلى: {mission.status}"})
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم تحديث المهمة بنجاح"}
            
    except Exception as e:
        connection.rollback()
        if "متواجد حالياً في مهمة نشطة أخرى" in str(e):
            raise HTTPException(status_code=400, detail=str(e))
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء التحديث: {str(e)}")

@app.get("/api/missions/{mission_id}")
def get_mission_details(mission_id: int, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM missions WHERE mission_id = %s", (mission_id,))
            mission_row = cursor.fetchone()
            if not mission_row: raise HTTPException(status_code=404)
            col_names = [desc[0] for desc in cursor.description]
            mission_data = dict(zip(col_names, mission_row))
            for k, v in mission_data.items():
                if v is not None and not isinstance(v, (str, int, float, bool)): mission_data[k] = str(v)
            
            cursor.execute("SELECT group_title, route_to, departure_time, arrival_time FROM mission_itineraries WHERE mission_id = %s", (mission_id,))
            mission_data["routes"] = [{"group_title": r[0], "route_to": r[1], "departure_time": str(r[2]) if r[2] else "", "arrival_time": str(r[3]) if r[3] else ""} for r in cursor.fetchall()]
            
            cursor.execute("SELECT driver_name, vehicle_number FROM mission_vehicles WHERE mission_id = %s", (mission_id,))
            mission_data["vehicles"] = [{"driver_name": r[0], "vehicle_number": r[1]} for r in cursor.fetchall()]
            
            cursor.execute("SELECT participant_type, full_name, team_name, team_code, participation_role, branch_id, assigned_itinerary, return_status, phase_name, stay_type FROM mission_participants WHERE mission_id = %s", (mission_id,))
            mission_data["participants"] = [{"participant_type": r[0], "full_name": r[1], "team_name": r[2], "team_code": r[3], "participation_role": r[4], "branch_id": r[5], "assigned_itinerary": r[6], "return_status": r[7], "phase_name": r[8], "stay_type": r[9]} for r in cursor.fetchall()]
            
            cursor.execute("SELECT category_name, direct_count, indirect_count FROM mission_beneficiaries WHERE mission_id = %s", (mission_id,))
            mission_data["beneficiaries"] = [{"category_name": r[0], "direct_count": r[1], "indirect_count": r[2]} for r in cursor.fetchall()]
            
            cursor.execute("SELECT role_name, staff_name FROM mission_eoc_staff WHERE mission_id = %s", (mission_id,))
            mission_data["eoc_staff"] = [{"role_name": r[0], "staff_name": r[1]} for r in cursor.fetchall()]
            
            return mission_data
    except Exception as e:
        raise HTTPException(status_code=500, detail="حدث خطأ أثناء جلب التفاصيل")
    finally:
        connection.close()

@app.post("/api/missions/clear-all")
def clear_all_missions(
    data: ClearAllRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials
    user_id = get_current_user_id(token)

    if not user_id:
        raise HTTPException(status_code=401, detail="غير مصرح")

    require_owner_for_clear(user_id)
    validate_clear_confirmation(data)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            cursor.execute("SELECT COUNT(*) FROM missions")
            deleted_count = cursor.fetchone()[0]

            # حذف تفاصيل جميع المهام أولاً
            cursor.execute("DELETE FROM mission_itineraries")
            cursor.execute("DELETE FROM mission_vehicles")
            cursor.execute("DELETE FROM mission_participants")
            cursor.execute("DELETE FROM mission_beneficiaries")
            cursor.execute("DELETE FROM mission_eoc_staff")

            # حذف المهام نفسها
            cursor.execute("DELETE FROM missions")

            # تسجيل عملية المسح في الـ Audit Log
            create_audit_log(
                cursor,
                user_id,
                "مسح جميع المهام",
                mission_id=None,
                entity_type="missions",
                entity_id=None,
                details={
                    "action_text": f"قام المالك بمسح جميع المهام نهائياً من النظام. عدد السجلات المحذوفة: {deleted_count}"
                }
            )

            connection.commit()

            return {
                "message": "تم مسح جميع المهام بنجاح",
                "deleted_count": deleted_count
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ أثناء مسح المهام: {str(e)}"
        )

    finally:
        connection.close()

@app.delete("/api/missions/{mission_id}")
def delete_mission(mission_id: int, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT mission_id FROM missions WHERE mission_id = %s", (mission_id,))
            if not cursor.fetchone(): raise HTTPException(status_code=404)
                
            cursor.execute("DELETE FROM missions WHERE mission_id = %s", (mission_id,))
            
            # 💡 تسجيل اللوج
            try:
                create_audit_log(cursor, user_id, "حذف مهمة", mission_id=mission_id, entity_type="mission", entity_id=mission_id, details={"action_text": f"قام بحذف الاستمارة رقم {mission_id} نهائياً من النظام"})
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم حذف المهمة بنجاح"}
            
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500)
    finally:
        connection.close()

@app.get("/api/audit-logs")
def get_audit_logs(skip: int = 0, limit: int = 300, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    
    role = get_user_role(user_id)
    if not role or role["role_name"].upper() not in ["OWNER", "MANAGER", "SUPERVISOR", "JOKER", "المالك"]:
        raise HTTPException(status_code=403, detail="هذه الصفحة متاحة للمالك فقط")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # ضفنا l.entity_type عشان نفلتر بيه
            cursor.execute("""
                SELECT l.audit_id, l.user_id, u.full_name, l.action, l.details, l.created_at, l.entity_type
                FROM audit_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                ORDER BY l.created_at DESC LIMIT %s OFFSET %s;
            """, (limit, skip))
            rows = cursor.fetchall()
            return [
                {
                    "log_id": r[0], "user_id": r[1], "full_name": r[2] or "مستخدم محذوف",
                    "action": r[3], 
                    "details": r[4].get("action_text", str(r[4])) if isinstance(r[4], dict) else str(r[4] or ""), 
                    "created_at": r[5].strftime("%Y-%m-%d %H:%M:%S") if r[5] else "",
                    "entity_type": r[6]
                } for r in rows
            ]
    except Exception as e:
        print(f"Error fetching audit logs: {e}")
        return []
    finally:
        connection.close()

@app.get("/api/audit-logs/export")
def export_audit_logs(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401, detail="غير مصرح")
    
    role = get_user_role(user_id)
    if not role or role["role_name"].upper() not in ["OWNER", "المالك"]:
        raise HTTPException(status_code=403, detail="هذه الصفحة متاحة للمالك فقط")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT l.audit_id, l.user_id, u.full_name, l.action, l.details, l.created_at, l.entity_type
                FROM audit_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                ORDER BY l.created_at DESC;
            """)
            rows = cursor.fetchall()
            
            result = []
            for r in rows:
                details_val = r[4]
                details_str = details_val.get("action_text", str(details_val)) if isinstance(details_val, dict) else str(details_val or "")
                created_val = r[5]
                created_str = created_val.strftime("%Y-%m-%d %H:%M:%S") if hasattr(created_val, 'strftime') else str(created_val) if created_val else "غير مسجل"
                    
                result.append({
                    "log_id": r[0], "user_id": r[1], "full_name": r[2] or "مستخدم محذوف",
                    "action": r[3], "details": details_str, "created_at": created_str,
                    "entity_type": r[6]
                })
            return result
    except Exception as e:
        print(f"Error exporting audit logs: {e}")
        raise HTTPException(status_code=500, detail=f"خطأ في قاعدة البيانات: {str(e)}")
    finally:
        connection.close()

# =====================================================================
# =====================================================================
# قطاع الأخبار المحلية (مفصول تماماً عن المهام) - Local News Module
# =====================================================================
# =====================================================================

class LocalNewsModel(BaseModel):
    branch_id: Optional[int] = None
    incident_date: Optional[str] = None
    incident_month: Optional[str] = None
    incident_description: Optional[str] = None
    news_type: Optional[str] = None
    news_publisher: Optional[str] = None
    street_name: Optional[str] = None
    area_name: Optional[str] = None
    governorate: Optional[str] = None
    
    is_reported: bool = False
    report_time: Optional[str] = None
    
    is_responded: bool = False
    branch_response_text: Optional[str] = None
    response_time: Optional[str] = None
    response_time_points: int = 0
    response_duration: Optional[str] = None
    
    is_field_response: bool = False
    movement_time: Optional[str] = None
    report_to_movement_duration: Optional[str] = None
    movement_points: int = 0
    
    field_arrival_time: Optional[str] = None
    distance_km: Optional[float] = None
    field_response_points: int = 0
    report_to_arrival_duration: Optional[str] = None
    
    intervention_type: Optional[str] = None
    intervening_branch: Optional[str] = None
    mission_form_name: Optional[str] = None
    participants_count: int = 0
    
    hospital_name: Optional[str] = None
    injured_count: int = 0
    deaths_count: int = 0
    news_updates: Optional[str] = None
    news_link: str
    data_entry_name: Optional[str] = None
    notes: Optional[str] = None

@app.get("/api/local-news")
def get_local_news(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    
    role = get_user_role(user_id)
    if not role: raise HTTPException(status_code=403)

    role_name = role["role_name"]
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # الصلاحيات: المالك والجوكر والمشرف بيشوفوا كله، الفرع بيشوف أخباره بس
            base_query = """
                SELECT n.*, b.branch_name 
                FROM local_news n 
                LEFT JOIN branches b ON n.branch_id = b.branch_id
            """
            if role_name.upper() in ["OWNER", "MANAGER", "ADMIN", "SUPERVISOR", "JOKER", "OPERATION", "مشرف", "جوكر", "المالك", "أوبريشن"]:
                query = base_query + " ORDER BY n.created_at DESC;"
                cursor.execute(query)
            else:
                user_branches = get_user_branches(user_id)
                branch_ids = [b["branch_id"] for b in user_branches]
                if not branch_ids: return []
                query = base_query + " WHERE n.branch_id = ANY(%s) ORDER BY n.created_at DESC;"
                cursor.execute(query, (branch_ids,))
                
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]
            
            result = []
            for row in rows:
                news_data = dict(zip(col_names, row))
                # تظبيط التواريخ عشان الـ JSON
                for k, v in news_data.items():
                    if v is not None and not isinstance(v, (str, int, float, bool)): 
                        news_data[k] = str(v)
                result.append(news_data)
                
            return result
    except Exception as e:
        print(f"Error fetching news: {e}")
        raise HTTPException(status_code=500, detail="حدث خطأ داخلي أثناء جلب الأخبار")
    finally:
        connection.close()


@app.post("/api/local-news")
def create_local_news(news: LocalNewsModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None

            cursor.execute("""
                INSERT INTO local_news (
                    branch_id, incident_date, incident_month, incident_description, news_type, news_publisher,
                    street_name, area_name, governorate, is_reported, report_time, is_responded, branch_response_text,
                    response_time, response_time_points, response_duration, is_field_response, movement_time,
                    report_to_movement_duration, movement_points, field_arrival_time, distance_km, field_response_points,
                    report_to_arrival_duration, intervention_type, intervening_branch, mission_form_name, participants_count,
                    hospital_name, injured_count, deaths_count, news_updates, news_link, data_entry_name, notes
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                ) RETURNING news_id;
            """, (
                news.branch_id, none_if_empty(news.incident_date), news.incident_month, news.incident_description, news.news_type, news.news_publisher,
                news.street_name, news.area_name, news.governorate, news.is_reported, none_if_empty(news.report_time), news.is_responded, news.branch_response_text,
                none_if_empty(news.response_time), news.response_time_points, news.response_duration, news.is_field_response, none_if_empty(news.movement_time),
                news.report_to_movement_duration, news.movement_points, none_if_empty(news.field_arrival_time), news.distance_km, news.field_response_points,
                news.report_to_arrival_duration, news.intervention_type, news.intervening_branch, news.mission_form_name, news.participants_count,
                news.hospital_name, news.injured_count, news.deaths_count, news.news_updates, news.news_link, news.data_entry_name, news.notes
            ))
            news_id = cursor.fetchone()[0]

            # 💡 تسجيل اللوج الخاص بالأخبار فقط (مفصول عن المهام)
            try:
                create_audit_log(cursor, user_id, "إنشاء خبر", mission_id=None, entity_type="local_news", entity_id=news_id, details={"action_text": f"قام بإضافة خبر محلي جديد في منطقة: {news.area_name or 'غير محدد'}"})
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم حفظ الخبر بنجاح", "news_id": news_id}
            
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/local-news/{news_id}")
def update_local_news(news_id: int, news: LocalNewsModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None

            cursor.execute("""
                UPDATE local_news SET
                    branch_id=%s, incident_date=%s, incident_month=%s, incident_description=%s, news_type=%s, news_publisher=%s,
                    street_name=%s, area_name=%s, governorate=%s, is_reported=%s, report_time=%s, is_responded=%s, branch_response_text=%s,
                    response_time=%s, response_time_points=%s, response_duration=%s, is_field_response=%s, movement_time=%s,
                    report_to_movement_duration=%s, movement_points=%s, field_arrival_time=%s, distance_km=%s, field_response_points=%s,
                    report_to_arrival_duration=%s, intervention_type=%s, intervening_branch=%s, mission_form_name=%s, participants_count=%s,
                    hospital_name=%s, injured_count=%s, deaths_count=%s, news_updates=%s, news_link=%s, data_entry_name=%s, notes=%s
                WHERE news_id=%s;
            """, (
                news.branch_id, none_if_empty(news.incident_date), news.incident_month, news.incident_description, news.news_type, news.news_publisher,
                news.street_name, news.area_name, news.governorate, news.is_reported, none_if_empty(news.report_time), news.is_responded, news.branch_response_text,
                none_if_empty(news.response_time), news.response_time_points, news.response_duration, news.is_field_response, none_if_empty(news.movement_time),
                news.report_to_movement_duration, news.movement_points, none_if_empty(news.field_arrival_time), news.distance_km, news.field_response_points,
                news.report_to_arrival_duration, news.intervention_type, news.intervening_branch, news.mission_form_name, news.participants_count,
                news.hospital_name, news.injured_count, news.deaths_count, news.news_updates, news.news_link, news.data_entry_name, news.notes,
                news_id
            ))

            # 💡 تسجيل اللوج الخاص بالأخبار
            try:
                create_audit_log(cursor, user_id, "تحديث خبر", mission_id=None, entity_type="local_news", entity_id=news_id, details={"action_text": f"قام بتحديث بيانات الخبر في منطقة: {news.area_name or 'غير محدد'}"})
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم تحديث الخبر بنجاح"}
            
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/local-news/clear-all")
def clear_all_local_news(
    data: ClearAllRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials
    user_id = get_current_user_id(token)

    if not user_id:
        raise HTTPException(status_code=401, detail="غير مصرح")

    require_owner_for_clear(user_id)
    validate_clear_confirmation(data)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            cursor.execute("SELECT COUNT(*) FROM local_news")
            deleted_count = cursor.fetchone()[0]

            cursor.execute("DELETE FROM local_news")

            create_audit_log(
                cursor,
                user_id,
                "مسح جميع الأخبار المحلية",
                mission_id=None,
                entity_type="local_news",
                entity_id=None,
                details={
                    "action_text": f"قام المالك بمسح جميع الأخبار المحلية نهائياً. عدد السجلات المحذوفة: {deleted_count}"
                }
            )

            connection.commit()

            return {
                "message": "تم مسح جميع الأخبار المحلية بنجاح",
                "deleted_count": deleted_count
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ أثناء مسح الأخبار المحلية: {str(e)}"
        )

    finally:
        connection.close()


@app.delete("/api/local-news/{news_id}")
def delete_local_news(news_id: int, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM local_news WHERE news_id = %s", (news_id,))
            
            try:
                create_audit_log(cursor, user_id, "حذف خبر", mission_id=None, entity_type="local_news", entity_id=news_id, details={"action_text": f"قام بحذف الخبر رقم {news_id} نهائياً"})
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم حذف الخبر بنجاح"}
            
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500)
    finally:
        connection.close()

# =====================================================================
# =====================================================================
# قطاع رصد الكوارث العالمية - Global Disasters Module
# =====================================================================
# =====================================================================

class GlobalDisasterModel(BaseModel):
    incident_date: Optional[str] = None
    incident_month: Optional[str] = None
    news_title: Optional[str] = None
    country: Optional[str] = None
    disaster_type: Optional[str] = None
    affected_areas: Optional[str] = None
    at_risk_areas: Optional[str] = None
    source_name: Optional[str] = None
    injured_count: int = 0
    deaths_count: int = 0
    missing_count: int = 0
    national_societies_interventions: Optional[str] = None
    news_link: str  # 💡 هذا الحقل إلزامي بناءً على طلبك
    news_updates: Optional[str] = None
    data_entry_name: Optional[str] = None
    notes: Optional[str] = None

@app.get("/api/global-disasters")
def get_global_disasters(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM global_disasters ORDER BY created_at DESC;")
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]
            result = []
            for row in rows:
                data = dict(zip(col_names, row))
                for k, v in data.items():
                    if v is not None and not isinstance(v, (str, int, float, bool)): 
                        data[k] = str(v)
                result.append(data)
            return result
    finally:
        connection.close()

@app.post("/api/global-disasters")
def create_global_disaster(disaster: GlobalDisasterModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None
            cursor.execute("""
                INSERT INTO global_disasters (
                    incident_date, incident_month, news_title, country, disaster_type, affected_areas,
                    at_risk_areas, source_name, injured_count, deaths_count, missing_count,
                    national_societies_interventions, news_link, news_updates, data_entry_name, notes
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING disaster_id;
            """, (
                none_if_empty(disaster.incident_date), disaster.incident_month, disaster.news_title, disaster.country,
                disaster.disaster_type, disaster.affected_areas, disaster.at_risk_areas, disaster.source_name,
                disaster.injured_count, disaster.deaths_count, disaster.missing_count,
                disaster.national_societies_interventions, disaster.news_link, disaster.news_updates,
                disaster.data_entry_name, disaster.notes
            ))
            disaster_id = cursor.fetchone()[0]

            # تسجيل اللوج الخاص بالكوارث العالمية
            try:
                create_audit_log(cursor, user_id, "رصد كارثة عالمية", mission_id=None, entity_type="global_disaster", entity_id=disaster_id, details={"action_text": f"قام برصد كارثة جديدة ({disaster.disaster_type}) في: {disaster.country}"})
            except Exception as e: pass

            connection.commit()
            return {"message": "تم الحفظ بنجاح", "disaster_id": disaster_id}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/global-disasters/{disaster_id}")
def update_global_disaster(disaster_id: int, disaster: GlobalDisasterModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None
            cursor.execute("""
                UPDATE global_disasters SET
                    incident_date=%s, incident_month=%s, news_title=%s, country=%s, disaster_type=%s,
                    affected_areas=%s, at_risk_areas=%s, source_name=%s, injured_count=%s, deaths_count=%s,
                    missing_count=%s, national_societies_interventions=%s, news_link=%s, news_updates=%s,
                    data_entry_name=%s, notes=%s
                WHERE disaster_id=%s;
            """, (
                none_if_empty(disaster.incident_date), disaster.incident_month, disaster.news_title, disaster.country,
                disaster.disaster_type, disaster.affected_areas, disaster.at_risk_areas, disaster.source_name,
                disaster.injured_count, disaster.deaths_count, disaster.missing_count,
                disaster.national_societies_interventions, disaster.news_link, disaster.news_updates,
                disaster.data_entry_name, disaster.notes, disaster_id
            ))

            try:
                create_audit_log(cursor, user_id, "تحديث كارثة عالمية", mission_id=None, entity_type="global_disaster", entity_id=disaster_id, details={"action_text": f"قام بتحديث بيانات كارثة ({disaster.disaster_type}) في: {disaster.country}"})
            except Exception as e: pass

            connection.commit()
            return {"message": "تم التحديث بنجاح"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/global-disasters/clear-all")
def clear_all_global_disasters(
    data: ClearAllRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials
    user_id = get_current_user_id(token)

    if not user_id:
        raise HTTPException(status_code=401, detail="غير مصرح")

    require_owner_for_clear(user_id)
    validate_clear_confirmation(data)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            cursor.execute("SELECT COUNT(*) FROM global_disasters")
            deleted_count = cursor.fetchone()[0]

            cursor.execute("DELETE FROM global_disasters")

            create_audit_log(
                cursor,
                user_id,
                "مسح جميع الكوارث العالمية",
                mission_id=None,
                entity_type="global_disasters",
                entity_id=None,
                details={
                    "action_text": f"قام المالك بمسح جميع الكوارث العالمية نهائياً. عدد السجلات المحذوفة: {deleted_count}"
                }
            )

            connection.commit()

            return {
                "message": "تم مسح جميع الكوارث العالمية بنجاح",
                "deleted_count": deleted_count
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ أثناء مسح الكوارث العالمية: {str(e)}"
        )

    finally:
        connection.close()

@app.delete("/api/global-disasters/{disaster_id}")
def delete_global_disaster(disaster_id: int, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM global_disasters WHERE disaster_id = %s", (disaster_id,))
            try:
                create_audit_log(cursor, user_id, "حذف كارثة عالمية", mission_id=None, entity_type="global_disaster", entity_id=disaster_id, details={"action_text": f"قام بحذف رصد الكارثة رقم {disaster_id} نهائياً"})
            except Exception as e: pass
            connection.commit()
            return {"message": "تم الحذف بنجاح"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500)
    finally:
        connection.close()

# =====================================================================
# قطاع الزلازل - Earthquakes Module
# =====================================================================
class GlobalEqModel(BaseModel):
    date: str
    month: Optional[str] = None
    time: Optional[str] = None
    country: Optional[str] = None
    magnitude: float
    depth_km: Optional[str] = None
    region: Optional[str] = None
    status: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None

class EgyptEqModel(BaseModel):
    date: str
    time: Optional[str] = None
    magnitude: float
    depth_km: Optional[str] = None
    region: Optional[str] = None
    longitude: Optional[float] = None
    latitude: Optional[float] = None

@app.get("/api/earthquakes/global")
def get_global_eqs(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not get_current_user_id(credentials.credentials): raise HTTPException(401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM global_earthquakes ORDER BY date DESC, time DESC;")
            cols = [desc[0] for desc in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]
    finally:
        connection.close()

@app.post("/api/earthquakes/global/bulk")
def add_global_eqs_bulk(eqs: List[GlobalEqModel], credentials: HTTPAuthorizationCredentials = Depends(security)):
    user_id = get_current_user_id(credentials.credentials)
    if not user_id: raise HTTPException(401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            for eq in eqs:
                cursor.execute("""
                    INSERT INTO global_earthquakes (date, month, time, country, magnitude, depth_km, region, status, longitude, latitude)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (eq.date, eq.month, eq.time, eq.country, eq.magnitude, eq.depth_km, eq.region, eq.status, eq.longitude, eq.latitude))
            try: create_audit_log(cursor, user_id, "رفع سجل زلازل", mission_id=None, entity_type="earthquake", entity_id=None, details={"action_text": f"قام برفع ملف زلازل عالمية يحتوي على {len(eqs)} سجل"})
            except Exception: pass
            connection.commit()
            return {"message": f"تم إضافة {len(eqs)} زلزال بنجاح"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(500, str(e))

@app.post("/api/earthquakes/global")
def add_global_eq(eq: GlobalEqModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    user_id = get_current_user_id(credentials.credentials)
    if not user_id: raise HTTPException(401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                INSERT INTO global_earthquakes (date, month, time, country, magnitude, depth_km, region, status, longitude, latitude)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (eq.date, eq.month, eq.time, eq.country, eq.magnitude, eq.depth_km, eq.region, eq.status, eq.longitude, eq.latitude))
            try: create_audit_log(cursor, user_id, "إضافة زلزال", mission_id=None, entity_type="earthquake", entity_id=None, details={"action_text": f"أضاف زلزال عالمي بقوة {eq.magnitude} في {eq.country or eq.region}"})
            except Exception: pass
            connection.commit()
            return {"message": "تم الإضافة"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(500, str(e))

@app.delete("/api/earthquakes/global/{eq_id}")
def delete_global_eq(eq_id: int, credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not get_current_user_id(credentials.credentials): raise HTTPException(401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM global_earthquakes WHERE eq_id = %s", (eq_id,))
            connection.commit()
            return {"message": "تم الحذف"}
    finally:
        connection.close()

@app.get("/api/earthquakes/egypt")
def get_egypt_eqs(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not get_current_user_id(credentials.credentials): raise HTTPException(401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM egypt_earthquakes ORDER BY date DESC, time DESC;")
            cols = [desc[0] for desc in cursor.description]
            return [dict(zip(cols, row)) for row in cursor.fetchall()]
    finally:
        connection.close()

@app.post("/api/earthquakes/egypt")
def add_egypt_eq(eq: EgyptEqModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    user_id = get_current_user_id(credentials.credentials)
    if not user_id: raise HTTPException(401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                INSERT INTO egypt_earthquakes (date, time, magnitude, depth_km, region, longitude, latitude)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (eq.date, eq.time, eq.magnitude, eq.depth_km, eq.region, eq.longitude, eq.latitude))
            try: create_audit_log(cursor, user_id, "إضافة زلزال", mission_id=None, entity_type="earthquake", entity_id=None, details={"action_text": f"أضاف زلزال محلي (مصر) بقوة {eq.magnitude} في {eq.region}"})
            except Exception: pass
            connection.commit()
            return {"message": "تم الإضافة"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(500, str(e))

@app.delete("/api/earthquakes/egypt/{eq_id}")
def delete_egypt_eq(eq_id: int, credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not get_current_user_id(credentials.credentials): raise HTTPException(401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM egypt_earthquakes WHERE eq_id = %s", (eq_id,))
            connection.commit()
            return {"message": "تم الحذف"}
    finally:
        connection.close()

@app.put("/api/earthquakes/global/{eq_id}")
def update_global_eq(eq_id: int, eq: GlobalEqModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    user_id = get_current_user_id(credentials.credentials)
    if not user_id: raise HTTPException(status_code=401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                UPDATE global_earthquakes 
                SET date=%s, month=%s, time=%s, country=%s, magnitude=%s, depth_km=%s, region=%s, status=%s, longitude=%s, latitude=%s
                WHERE eq_id=%s
            """, (eq.date, eq.month, eq.time, eq.country, eq.magnitude, eq.depth_km, eq.region, eq.status, eq.longitude, eq.latitude, eq_id))
            try: create_audit_log(cursor, user_id, "تعديل زلزال", mission_id=None, entity_type="earthquake", entity_id=None, details={"action_text": f"عدّل بيانات زلزال عالمي بقوة {eq.magnitude}"})
            except Exception: pass
            connection.commit()
            return {"message": "تم التعديل"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(500, str(e))

@app.put("/api/earthquakes/egypt/{eq_id}")
def update_egypt_eq(eq_id: int, eq: EgyptEqModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    user_id = get_current_user_id(credentials.credentials)
    if not user_id: raise HTTPException(status_code=401)
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                UPDATE egypt_earthquakes 
                SET date=%s, time=%s, magnitude=%s, depth_km=%s, region=%s, longitude=%s, latitude=%s
                WHERE eq_id=%s
            """, (eq.date, eq.time, eq.magnitude, eq.depth_km, eq.region, eq.longitude, eq.latitude, eq_id))
            try: create_audit_log(cursor, user_id, "تعديل زلزال", mission_id=None, entity_type="earthquake", entity_id=None, details={"action_text": f"عدّل بيانات زلزال محلي (مصر) بقوة {eq.magnitude}"})
            except Exception: pass
            connection.commit()
            return {"message": "تم التعديل"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(500, str(e))

@app.post("/api/earthquakes/clear-all")
def clear_all_earthquakes(
    data: ClearAllRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials
    user_id = get_current_user_id(token)

    if not user_id:
        raise HTTPException(status_code=401, detail="غير مصرح")

    require_owner_for_clear(user_id)
    validate_clear_confirmation(data)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            cursor.execute("SELECT COUNT(*) FROM global_earthquakes")
            global_count = cursor.fetchone()[0]

            cursor.execute("SELECT COUNT(*) FROM egypt_earthquakes")
            egypt_count = cursor.fetchone()[0]

            cursor.execute("DELETE FROM global_earthquakes")
            cursor.execute("DELETE FROM egypt_earthquakes")

            total_count = global_count + egypt_count

            create_audit_log(
                cursor,
                user_id,
                "مسح جميع الزلازل",
                mission_id=None,
                entity_type="earthquakes",
                entity_id=None,
                details={
                    "action_text": (
                        f"قام المالك بمسح جميع سجلات الزلازل نهائياً من النظام. "
                        f"إجمالي السجلات المحذوفة: {total_count}"
                    )
                }
            )

            connection.commit()

            return {
                "message": "تم مسح جميع الزلازل بنجاح",
                "deleted_count": total_count,
                "global_deleted": global_count,
                "egypt_deleted": egypt_count
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ أثناء مسح الزلازل: {str(e)}"
        )

    finally:
        connection.close()

# =====================================================================
# قطاع رصد الذكاء الاصطناعي - AI News Module
# =====================================================================

class AINewsModel(BaseModel):
    incident_date: Optional[str] = None
    incident_month: Optional[str] = None
    incident_description: Optional[str] = None
    news_type: Optional[str] = None
    news_publisher: Optional[str] = None
    street_name: Optional[str] = None
    area_name: Optional[str] = None
    governorate: Optional[str] = None
    hospital_name: Optional[str] = None
    injured_count: Optional[str] = "0"
    deaths_count: Optional[str] = "0"
    news_updates: Optional[str] = None
    news_link: str
    data_entry_name: Optional[str] = "AI Robot"

@app.get("/api/ai-news")
def get_ai_news(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    import os
    system_token = os.environ.get("SYSTEM_TOKEN", "").strip()
    
    if system_token and token.strip() == system_token:
        pass # الباب مفتوح للروبوت
    else:
        user_id = get_current_user_id(token)
        if not user_id: raise HTTPException(status_code=401)
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM ai_news ORDER BY created_at DESC;")
            rows = cursor.fetchall()
            col_names = [desc[0] for desc in cursor.description]
            result = []
            for row in rows:
                data = dict(zip(col_names, row))
                for k, v in data.items():
                    if v is not None and not isinstance(v, (str, int, float, bool)): 
                        data[k] = str(v)
                result.append(data)
            return result
    finally:
        connection.close()

@app.post("/api/ai-news")
def create_ai_news(news: AINewsModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    import os
    system_token = os.environ.get("SYSTEM_TOKEN", "").strip()
    
    if system_token and token.strip() == system_token:
        user_id = 1
    else:
        user_id = get_current_user_id(token)
        if not user_id: raise HTTPException(status_code=401)
    
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None
            cursor.execute("""
                INSERT INTO ai_news (
                    incident_date, incident_month, incident_description, news_type, news_publisher,
                    street_name, area_name, governorate, hospital_name, injured_count, deaths_count,
                    news_updates, news_link, data_entry_name
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id;
            """, (
                none_if_empty(news.incident_date), none_if_empty(news.incident_month), news.incident_description, 
                news.news_type, news.news_publisher, news.street_name, news.area_name, news.governorate, 
                news.hospital_name, str(news.injured_count), str(news.deaths_count), news.news_updates, 
                news.news_link, news.data_entry_name
            ))
            new_id = cursor.fetchone()[0]

            try:
                create_audit_log(cursor, user_id, "رصد خبر آلي", mission_id=None, entity_type="ai_news", entity_id=new_id, details={"action_text": f"محرك الذكاء الاصطناعي رصد خبراً جديداً ({news.news_type}) في: {news.governorate}"})
            except Exception as e: pass

            connection.commit()
            return {"message": "تم الحفظ بنجاح", "id": new_id}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()
        
@app.put("/api/ai-news/{news_id}")
def update_ai_news(news_id: int, news: AINewsModel, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None
            cursor.execute("""
                UPDATE ai_news SET
                    incident_date=%s, incident_month=%s, incident_description=%s, news_type=%s, news_publisher=%s,
                    street_name=%s, area_name=%s, governorate=%s, hospital_name=%s, injured_count=%s, deaths_count=%s,
                    news_updates=%s, news_link=%s, data_entry_name=%s
                WHERE id=%s;
            """, (
                none_if_empty(news.incident_date), none_if_empty(news.incident_month), news.incident_description, 
                news.news_type, news.news_publisher, news.street_name, news.area_name, news.governorate, 
                news.hospital_name, str(news.injured_count), str(news.deaths_count), news.news_updates, 
                news.news_link, news.data_entry_name, news_id
            ))

            try:
                create_audit_log(cursor, user_id, "تحديث خبر آلي", mission_id=None, entity_type="ai_news", entity_id=news_id, details={"action_text": f"تم تحديث بيانات رصد الذكاء الاصطناعي للخبر رقم {news_id}"})
            except Exception as e: pass

            connection.commit()
            return {"message": "تم التحديث بنجاح"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        connection.close()

@app.post("/api/ai-news/clear-all")
def clear_all_ai_news(
    data: ClearAllRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    token = credentials.credentials
    user_id = get_current_user_id(token)

    if not user_id:
        raise HTTPException(status_code=401, detail="غير مصرح")

    require_owner_for_clear(user_id)
    validate_clear_confirmation(data)

    connection = get_connection()

    try:
        with connection.cursor() as cursor:

            cursor.execute("SELECT COUNT(*) FROM ai_news")
            deleted_count = cursor.fetchone()[0]

            cursor.execute("DELETE FROM ai_news")

            create_audit_log(
                cursor,
                user_id,
                "مسح جميع أخبار الذكاء الاصطناعي",
                mission_id=None,
                entity_type="ai_news",
                entity_id=None,
                details={
                    "action_text": f"قام المالك بمسح جميع أخبار الذكاء الاصطناعي نهائياً. عدد السجلات المحذوفة: {deleted_count}"
                }
            )

            connection.commit()

            return {
                "message": "تم مسح جميع أخبار الذكاء الاصطناعي بنجاح",
                "deleted_count": deleted_count
            }

    except Exception as e:
        connection.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"حدث خطأ أثناء مسح أخبار الذكاء الاصطناعي: {str(e)}"
        )

    finally:
        connection.close()

@app.delete("/api/ai-news/{news_id}")
def delete_ai_news(news_id: int, credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
        
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM ai_news WHERE id = %s", (news_id,))
            try:
                create_audit_log(cursor, user_id, "حذف خبر آلي", mission_id=None, entity_type="ai_news", entity_id=news_id, details={"action_text": f"تم حذف الرصد الآلي رقم {news_id}"})
            except Exception as e: pass
            connection.commit()
            return {"message": "تم الحذف بنجاح"}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500)
    finally:
        connection.close()

import os
import requests

@app.post("/api/trigger-ai-radar")
def trigger_ai_radar(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401, detail="غير مصرح")
    
    role = get_user_role(user_id)
    if not role or role["role_name"].upper() not in ["OWNER", "المالك"]:
        raise HTTPException(status_code=403, detail="عفواً، المالك فقط يمكنه إطلاق الرادار.")

    # 💡 تم تغيير الاسم لتجنب حظر Vercel لأي متغير يبدأ بـ GITHUB
    radar_key = os.environ.get("RADAR_SECRET_KEY")
    
    if not radar_key:
        raise HTTPException(status_code=500, detail="الخطأ: مفتاح RADAR_SECRET_KEY غير موجود في إعدادات Vercel.")

    # إرسال أمر التشغيل لجيت هاب
    url = "https://api.github.com/repos/mo7amedrabei14-cell/eoc-system/actions/workflows/ai_cron.yml/dispatches"
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "Authorization": f"Bearer {radar_key}",
        "Content-Type": "application/json"
    }
    data = {"ref": "main"}

    try:
        response = requests.post(url, headers=headers, json=data)
        if response.status_code in [200, 204]:
            return {"message": "تم إطلاق وحش الرصد بنجاح! 🚀\nيتم مسح السوشيال ميديا والأخبار حالياً، راقب الخريطة."}
        else:
            raise HTTPException(status_code=response.status_code, detail=f"فشل جيت هاب: {response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"فشل الاتصال الداخلي: {str(e)}")

# Fix Vercel Environment Variables Conflict

# =====================================================================
# قطاع القوة البشرية - Human Resources
# =====================================================================
# =====================================================================
# قطاع القوة البشرية - Human Resources
# =====================================================================
@app.get("/api/human-resources")
def get_human_resources(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    
    role = get_user_role(user_id)
    if not role or role["role_name"].upper() not in ["OWNER", "MANAGER", "SUPERVISOR", "JOKER", "المالك"]:
        raise HTTPException(status_code=403, detail="عفواً، هذه الصفحة متاحة للمالك فقط")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # دالة DISTINCT ON لمنع التكرار، مع حساب المهام وإجمالي الساعات
            cursor.execute("""
                SELECT DISTINCT ON (
                    p.branch_id, 
                    CASE 
                        WHEN TRIM(p.participation_role) = '' OR p.participation_role IS NULL THEN TRIM(p.full_name) 
                        ELSE TRIM(p.participation_role) 
                    END
                )
                    p.full_name,
                    COALESCE(NULLIF(TRIM(p.participation_role), ''), 'بدون رقم/صفة') AS membership_number,
                    p.participant_type,
                    b.branch_name,
                    p.branch_id,
                    (
                        SELECT COUNT(DISTINCT m.mission_id)
                        FROM mission_participants mp
                        JOIN missions m ON mp.mission_id = m.mission_id
                        WHERE mp.branch_id = p.branch_id
                        AND m.status NOT IN ('Draft', 'Cancelled', 'Returned')
                        AND (
                            (TRIM(mp.participation_role) != '' AND TRIM(mp.participation_role) = TRIM(p.participation_role))
                            OR 
                            ((TRIM(mp.participation_role) = '' OR mp.participation_role IS NULL) AND TRIM(mp.full_name) = TRIM(p.full_name))
                        )
                    ) as missions_count,
                    (
                        SELECT ROUND(COALESCE(SUM(
                            GREATEST(
                                EXTRACT(EPOCH FROM (
                                    (m.completion_date + COALESCE(m.completion_time, '00:00'::time)) - 
                                    (COALESCE(m.departure_date, m.created_at::date) + COALESCE(m.departure_time, m.start_time, '00:00'::time))
                                )) / 3600.0, 
                                0
                            )
                        ), 0)::numeric, 1)
                        FROM mission_participants mp
                        JOIN missions m ON mp.mission_id = m.mission_id
                        WHERE mp.branch_id = p.branch_id
                        AND m.status NOT IN ('Draft', 'Cancelled', 'Returned')
                        AND m.completion_date IS NOT NULL 
                        AND (
                            (TRIM(mp.participation_role) != '' AND TRIM(mp.participation_role) = TRIM(p.participation_role))
                            OR 
                            ((TRIM(mp.participation_role) = '' OR mp.participation_role IS NULL) AND TRIM(mp.full_name) = TRIM(p.full_name))
                        )
                    ) as total_hours
                FROM mission_participants p
                LEFT JOIN branches b ON p.branch_id = b.branch_id
                WHERE p.full_name IS NOT NULL AND TRIM(p.full_name) != ''
                ORDER BY 
                    p.branch_id, 
                    CASE 
                        WHEN TRIM(p.participation_role) = '' OR p.participation_role IS NULL THEN TRIM(p.full_name) 
                        ELSE TRIM(p.participation_role) 
                    END, 
                    p.participant_id DESC;
            """)
            rows = cursor.fetchall()
            result = []
            for row in rows:
                result.append({
                    "full_name": row[0],
                    "membership_number": row[1],
                    "participant_type": row[2],
                    "branch_name": row[3] or "غير محدد",
                    "branch_id": row[4],
                    "missions_count": row[5],
                    "total_hours": float(row[6]) # ده إجمالي الساعات
                })
            return result
    except Exception as e:
        print(f"Error fetching HR: {e}")
        raise HTTPException(status_code=500, detail="حدث خطأ داخلي أثناء جلب بيانات القوة البشرية")
    finally:
        connection.close()