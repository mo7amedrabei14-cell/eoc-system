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
            
            if role_name.upper() in ["OWNER", "MANAGER", "ADMIN", "SUPERVISOR", "JOKER", "مشرف", "جوكر"]:
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
                    INSERT INTO mission_participants (mission_id, participant_type, full_name, team_name, team_code, participation_role, branch_id, assigned_itinerary, return_status, phase_name)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (mission_id, part.participant_type, part.full_name, part.team_name, part.team_code, part.participation_role, part.branch_id, part.assigned_itinerary, part.return_status, part.phase_name))

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

                cursor.execute("INSERT INTO mission_participants (mission_id, participant_type, full_name, team_name, team_code, participation_role, branch_id, assigned_itinerary, return_status, phase_name) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);", (mission_id, part.participant_type, part.full_name, part.team_name, part.team_code, part.participation_role, part.branch_id, part.assigned_itinerary, part.return_status, part.phase_name))

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
            
            cursor.execute("SELECT participant_type, full_name, team_name, team_code, participation_role, branch_id, assigned_itinerary, return_status, phase_name FROM mission_participants WHERE mission_id = %s", (mission_id,))
            mission_data["participants"] = [{"participant_type": r[0], "full_name": r[1], "team_name": r[2], "team_code": r[3], "participation_role": r[4], "branch_id": r[5], "assigned_itinerary": r[6], "return_status": r[7], "phase_name": r[8]} for r in cursor.fetchall()]
            
            cursor.execute("SELECT category_name, direct_count, indirect_count FROM mission_beneficiaries WHERE mission_id = %s", (mission_id,))
            mission_data["beneficiaries"] = [{"category_name": r[0], "direct_count": r[1], "indirect_count": r[2]} for r in cursor.fetchall()]
            
            cursor.execute("SELECT role_name, staff_name FROM mission_eoc_staff WHERE mission_id = %s", (mission_id,))
            mission_data["eoc_staff"] = [{"role_name": r[0], "staff_name": r[1]} for r in cursor.fetchall()]
            
            return mission_data
    except Exception as e:
        raise HTTPException(status_code=500, detail="حدث خطأ أثناء جلب التفاصيل")
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
    if not role or role["role_name"].upper() not in ["OWNER", "المالك"]:
        raise HTTPException(status_code=403, detail="هذه الصفحة متاحة للمالك فقط")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT l.audit_id, l.user_id, u.full_name, l.action, l.details, l.created_at
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
                    "created_at": r[5].strftime("%Y-%m-%d %H:%M:%S") if r[5] else ""
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
                SELECT l.audit_id, l.user_id, u.full_name, l.action, l.details, l.created_at
                FROM audit_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                ORDER BY l.created_at DESC;
            """)
            rows = cursor.fetchall()
            
            result = []
            for r in rows:
                # تأمين قراءة التفاصيل
                details_val = r[4]
                details_str = details_val.get("action_text", str(details_val)) if isinstance(details_val, dict) else str(details_val or "")
                    
                # تأمين قراءة التاريخ
                created_val = r[5]
                created_str = created_val.strftime("%Y-%m-%d %H:%M:%S") if hasattr(created_val, 'strftime') else str(created_val) if created_val else "غير مسجل"
                    
                result.append({
                    "log_id": r[0], "user_id": r[1], "full_name": r[2] or "مستخدم محذوف",
                    "action": r[3], "details": details_str, "created_at": created_str
                })
            return result
    except Exception as e:
        print(f"Error exporting audit logs: {e}")
        # هنا بنبعت الإيرور الحقيقي للواجهة عشان نشوفه
        raise HTTPException(status_code=500, detail=f"خطأ في قاعدة البيانات: {str(e)}")
    finally:
        connection.close()