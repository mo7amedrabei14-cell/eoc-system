from fastapi import FastAPI, Depends, HTTPException, status, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordRequestForm
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, time, datetime, timedelta
from psycopg.errors import UniqueViolation
import json

# ملفات المشروع الخاصة بيك
from audit import create_audit_log
from realtime import notify_participant_accounts, create_realtime_event
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


def ensure_schema():
    """
    🛡️ تهيئة البنية الآمنة (idempotent) عند كل تشغيل — بدون الحاجة لتشغيل
    ملفات migration يدوياً على قاعدة Neon (السبب الجذري لانقطاع الإشعارات:
    جدول realtime_events لم يكن موجوداً على اللوحة الحية).
    - realtime_events + فهارسها (قناة الإشعارات اللحظية) — create_realtime_event
    - idempotency_keys (الحماية من الإرسال المكرر في الـ middleware) — بدونه
      كل حفظ مهمة كان يفشل 500 لأن الـ middleware يقرأه في كل طلب كتابة.
    - missions.team_code / mission_participants.participant_position + نقل
      الصفة التاريخية لغير المتطوع (مطابق لملف 20260906).
    كل أمر آمن للإعادة (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
    """
    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # ── 1) فيد الأحداث اللحظية (Realtime Events)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS realtime_events (
                    event_id       BIGSERIAL PRIMARY KEY,
                    event_type     TEXT NOT NULL,
                    action         TEXT NOT NULL,
                    actor_user_id  INTEGER,
                    target_user_id INTEGER,
                    mission_id     INTEGER,
                    details        JSONB,
                    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS realtime_events_id_idx ON realtime_events (event_id);"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS realtime_events_mission_idx ON realtime_events (mission_id, event_id);"
            )

            # ── 2) جدول مفاتيح الإرسال المكرر (Idempotency)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS idempotency_keys (
                    idempotency_key VARCHAR(255) PRIMARY KEY,
                    response        JSONB,
                    original_status INTEGER,
                    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            # تأمين إضافي لو الجدول موجود بأعمدة ناقصة
            cursor.execute("ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS response JSONB;")
            cursor.execute("ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS original_status INTEGER;")
            cursor.execute("ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;")

            # ── 3) أعمدة تكميلية + ترحيل صفة غير المتطوع (idempotent)
            cursor.execute("ALTER TABLE missions ADD COLUMN IF NOT EXISTS team_code VARCHAR(100) DEFAULT '';")
            cursor.execute("ALTER TABLE mission_participants ADD COLUMN IF NOT EXISTS participant_position VARCHAR(100);")
            cursor.execute("""
                UPDATE mission_participants
                SET participant_position = participation_role
                WHERE participant_type = 'non_volunteer'
                  AND (participant_position IS NULL OR TRIM(participant_position) = '')
                  AND participation_role IS NOT NULL AND TRIM(participation_role) <> '';
            """)

            # ── 4) البنية الموحدة (المحرك الواحد): من/إلى للخطوط + أعمدة القطاع
            #    (idempotent — نفس بنية migration 20260907_unify_engine.sql حتى
            #    تلتئم اللوحة الحية تلقائياً على أي worker جديد)
            cursor.execute("ALTER TABLE mission_itineraries ADD COLUMN IF NOT EXISTS route_from VARCHAR(255);")
            cursor.execute("ALTER TABLE mission_itineraries ADD COLUMN IF NOT EXISTS departure_date DATE;")
            cursor.execute("ALTER TABLE mission_itineraries ADD COLUMN IF NOT EXISTS arrival_date DATE;")
            cursor.execute("ALTER TABLE mission_participant_sessions ADD COLUMN IF NOT EXISTS itinerary_group VARCHAR(150);")
            cursor.execute("ALTER TABLE mission_participant_sessions ADD COLUMN IF NOT EXISTS start_dt TIMESTAMP;")
            cursor.execute("ALTER TABLE mission_participant_sessions ADD COLUMN IF NOT EXISTS end_dt TIMESTAMP;")
            # الإصلاح الجذري لـ 500: session_date لم يعد إلزامياً (آمن للإعادة)
            cursor.execute("ALTER TABLE mission_participant_sessions ALTER COLUMN session_date DROP NOT NULL;")

            # ── 5) بداية المهمة (checkbox) + تاريخ/وقت إنشاء المهمة
            #    (مطابق لـ migrations/20260909_mission_start_creation_datetime.sql —
            #    idempotent، يلتئم أي worker جديد تلقائياً)
            cursor.execute("""
                ALTER TABLE mission_participants
                    ADD COLUMN IF NOT EXISTS start_from_mission boolean NOT NULL DEFAULT true;
            """)
            cursor.execute("""
                ALTER TABLE missions
                    ADD COLUMN IF NOT EXISTS creation_datetime timestamp without time zone;
            """)
            # backfill لمرة واحدة (حارس IS NULL يحمي تعديلات المالك من الكتابة فوقها)
            cursor.execute("""
                UPDATE missions m
                SET creation_datetime = COALESCE(
                    (SELECT MIN(al.created_at) FROM audit_logs al
                      WHERE al.action = 'إنشاء مهمة' AND al.entity_type = 'mission'
                        AND al.entity_id::bigint = m.mission_id::bigint),
                    m.created_at)
                WHERE m.creation_datetime IS NULL;
            """)

            # ── 6) كتالوج الانضمام/الانفصال (فئة مستقلة — ليس خط سير، لا يُخزَّن في mission_itineraries)
            #    عمود الأمان: العنوان ≤ 120 حرفاً ليظل «JL:J:<title>»/«JL:L:<title>» داخل varchar(150)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mission_join_leave_entries (
                    entry_id    BIGSERIAL PRIMARY KEY,
                    mission_id  INTEGER NOT NULL REFERENCES missions(mission_id) ON DELETE CASCADE,
                    title       VARCHAR(120) NOT NULL,
                    kind        VARCHAR(10) NOT NULL CHECK (kind IN ('join','leave')),
                    dt          TIMESTAMP NOT NULL,
                    created_at  TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cursor.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_jle_mission_title_kind
                    ON mission_join_leave_entries (mission_id, LOWER(TRIM(title)), kind);
            """)

            # ── 7) وسوم المصدر على جلسات المشاركة (NULL = سطر قديم من أزرار الانضمام/الانفصال السابقة)
            #    ON DELETE NO ACTION: حذف سجل كتالوج مع «مشتقاته» ما زال موجودة مرفوض — يفرض
            #    الحذف الصريح بالترتيب (المشتقات ← مفاتيح الإسناد ← سجل الكتالوج) ولا يسمح أبداً
            #    بتحويل سطر موسوم إلى سطر قديم عبر SET NULL.
            cursor.execute("""
                ALTER TABLE mission_participant_sessions
                    ADD COLUMN IF NOT EXISTS start_entry_id BIGINT
                    REFERENCES mission_join_leave_entries(entry_id) ON DELETE NO ACTION;
            """)
            cursor.execute("""
                ALTER TABLE mission_participant_sessions
                    ADD COLUMN IF NOT EXISTS end_entry_id BIGINT
                    REFERENCES mission_join_leave_entries(entry_id) ON DELETE NO ACTION;
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_mps_start_entry
                    ON mission_participant_sessions (start_entry_id);
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_mps_end_entry
                    ON mission_participant_sessions (end_entry_id);
            """)
        connection.commit()
    except Exception as e:
        print(f"ensure_schema error (will retry on next boot): {e}")
    finally:
        connection.close()


# 🚀 تهيئة فورية عند أول تشغيل لأي worker (Vercel serverless) — آمن للإعادة
# ولا يكسر الإقلاع لو القاعدة لحظةً ما غير متاحة (يُحاول في التشغيل التالي).
try:
    ensure_schema()
except Exception as e:
    print(f"Startup schema bootstrap failed: {e}")


app = FastAPI(title="EOC System", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def idempotency_middleware(request: Request, call_next):
    """
    Idempotency middleware for mutation endpoints (POST, PUT, PATCH, DELETE).
    If the request has an Idempotency-Key header, we check if we have already processed
    a request with that key. If so, we return the cached response.
    Otherwise, we process the request and cache the response.
    """
    # Only apply to mutation endpoints, excluding certain paths like /token
    if request.method in ["POST", "PUT", "PATCH", "DELETE"] and request.url.path not in ["/token"]:
        idempotency_key = request.headers.get("Idempotency-Key")
        if idempotency_key:
            # Check if we have a cached response for this idempotency key
            connection = get_connection()
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT response, original_status FROM idempotency_keys WHERE idempotency_key = %s;",
                        (idempotency_key,)
                    )
                    row = cursor.fetchone()
                    if row and row[0] is not None:  # response is not null
                        # Return the cached response
                        # psycopg3 يقرأ عمود jsonb كـ dict جاهز؛ لا نلجأ لـ json.loads إلا إذا
                        # كانت القيمة نصية (ملفقة/مخزنة يدوياً). هذا يمنع TypeError → 500.
                        cached = row[0]
                        if isinstance(cached, str):
                            cached_response = json.loads(cached)
                        elif isinstance(cached, dict):
                            cached_response = cached
                        else:
                            cached_response = None
                        if cached_response is not None:
                            return JSONResponse(content=cached_response, status_code=row[1])
            except Exception as e:
                # 🛡️ حماية من أي خلل عابر هنا (جدول غير موجود لحظياً / اتصال):
                # لا يجب أن يفشل كل طلب كتابة بسبب فحص التكرار — نكمل التنفيذ
                # الطبيعي (ensure_schema ينشئ الجدول عند أول إقلاع).
                print(f"Idempotency pre-check error (continuing without cache): {e}")
            finally:
                connection.close()

    # If we didn't return a cached response, proceed to the endpoint
    response = await call_next(request)

    # After the endpoint, if we had an idempotency key and the method is mutation, store the response
    if request.method in ["POST", "PUT", "PATCH", "DELETE"] and request.url.path not in ["/token"]:
        idempotency_key = request.headers.get("Idempotency-Key")
        if idempotency_key:
            # We need to get the response body and status code
            # We assume the response is a JSONResponse and we can get the body.
            # For safety, we try to get the body; if we can't, we skip storage.
            try:
                # If the response is a JSONResponse, we can access .body
                # If it's a StreamingResponse, we cannot get the body without consuming it.
                # We'll only handle JSONResponse for now.
                if hasattr(response, 'body'):
                    response_body = response.body
                    status_code = response.status_code
                else:
                    # We cannot get the body, so we skip storage.
                    return response

                # ⚠️ فقط نخزّن الاستجابات الناجحة (2xx). لو خزّنا أخطاءً (4xx/5xx)
                # كانت ستُعاد للأبد على كل إعادة محاولة بنفس المفتاح — خطأ عابر
                # (403/400/500) كان يتحوّل إلى فشل دائم. المستخدم يقرأ الفشل
                # فيستطيع إعادة المحاولة بمفتاح جديد حتى ينجح.
                if status_code < 400:
                    connection = get_connection()
                    try:
                        with connection.cursor() as cursor:
                            cursor.execute(
                                """
                                INSERT INTO idempotency_keys (idempotency_key, response, original_status)
                                VALUES (%s, %s, %s)
                                ON CONFLICT (idempotency_key) DO UPDATE
                                SET response = EXCLUDED.response,
                                    original_status = EXCLUDED.original_status,
                                    created_at = CURRENT_TIMESTAMP
                                """,
                                (idempotency_key, json.dumps(response_body.decode() if isinstance(response_body, bytes) else response_body), status_code)
                            )
                            connection.commit()
                    finally:
                        connection.close()
                else:
                    # استجابة خطأ: نحذف أي قيمة مخزّنة سابقاً لهذا المفتاح
                    # حتى لا يُحتجز المفتاح بفشل قديم، ويبقى التكرار آمناً.
                    connection = get_connection()
                    try:
                        with connection.cursor() as cursor:
                            cursor.execute(
                                "DELETE FROM idempotency_keys WHERE idempotency_key = %s;",
                                (idempotency_key,)
                            )
                            connection.commit()
                    finally:
                        connection.close()
            except Exception as e:
                # If there's an error in storing, we log it but don't fail the request.
                print(f"Error storing idempotency response: {e}")

    return response


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

@app.get("/api/volunteers/all")
def get_all_volunteers(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    كل المتطوعين عبر كل الفروع (متطلب #6) — لاختيار مشارك من أي فرع في نموذج المهمة.
    يُعاد اسم الفرع الفعلي لكل متطوع حتى يعرف المستخدم من أين هو.
    """
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT v.volunteer_id, v.full_name, v.phone, v.membership_number, v.branch_id,
                       COALESCE(b.branch_name, 'غير محدد') AS branch_name
                FROM volunteers v
                LEFT JOIN branches b ON b.branch_id = v.branch_id
                WHERE v.is_active = TRUE
                ORDER BY v.full_name;
            """)
            rows = cursor.fetchall()
            return [
                {"volunteer_id": r[0], "full_name": r[1], "phone": r[2], "membership_number": r[3],
                 "branch_id": r[4], "branch_name": r[5]}
                for r in rows
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail="حدث خطأ أثناء جلب المتطوعين")
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
    route_from: Optional[str] = None  # من (نقطة الانطلاق)
    route_to: str                     # إلى (الوجهة)
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    # 🆕 تواريخ كاملة لكل يوم/مسار (مهمات مفتوحة) — دعم المبيت overnight
    departure_date: Optional[str] = None
    arrival_date: Optional[str] = None

class VehicleModel(BaseModel):
    driver_name: str
    vehicle_number: str

class PeriodModel(BaseModel):
    """فترة مشاركة participant — مهمات مفتوحة فقط."""
    session_date: str
    check_in_time: str
    check_out_time: Optional[str] = None
    notes: Optional[str] = None

class ParticipantModel(BaseModel):
    participant_type: str
    full_name: str
    # 💡 عمودا "الفريق/الكود" حُذفا نهائيًّا من الواجهة (متطلب #2)، لذا أصبحا اختياريين
    #    للتوافق مع أي بيانات قديمة ما زالت تصل. قاعدة البيانات لم تتغير (لا duplicate).
    team_name: Optional[str] = None
    team_code: Optional[str] = None
    participation_role: str
    # 🆕 صفة المشارك (لغير المتطوعين) — حقل مخصص منفصل عن رقم العضوية الخاص بالمتطوعين
    participant_position: Optional[str] = None
    branch_id: int
    assigned_itinerary: str
    return_status: str = "مازال بالمهمة"
    phase_name: str = "اليوم الأول"
    stay_type: str = "ذهاب وعودة"
    # 🆕 فترات المشاركة — للمهمات المفتوحة كحساب فعلي، وللعادية كتجاوز (خروج مبكر)
    participation_periods: List[PeriodModel] = []
    # 🆕 الأيام المخصصة للمشارك (متعدد) — مهمات مفتوحة فقط: يرث المشارك ساعات اليوم افتراضياً
    assigned_days: List[str] = []
    # 🆕 «يُحسب من بداية المهمة» — مفتاح نقي على مصدر بداية المشاركة المخططة
    #    (TRUE = بداية المهمة، FALSE = بداية المسار المسند). الافتراضي في القاعدة TRUE.
    start_from_mission: bool = True

class JoinRequest(BaseModel):
    """طلب انضمام مشارك (استثناء). المهمة مفتوحة: itinerary_group = اليوم/المسار."""
    participant_id: int
    itinerary_group: Optional[str] = None   # يُحتفظ به للتوافق الخلفي فقط (المسارات تُضبط في الاستمارة)
    join_datetime: str                      # "YYYY-MM-DD HH:MM" كاملة (دعم المبيت)
    client_now: Optional[str] = None        # ساعة العميل المحلية — الإطار المرجعي لزمن التسجيل

class LeaveRequest(BaseModel):
    """طلب تسجيل انفصال مشارك (استثناء)."""
    participant_id: int
    itinerary_group: Optional[str] = None   # يُحتفظ به للتوافق الخلفي فقط (المسارات تُضبط في الاستمارة)
    leave_datetime: str                     # "YYYY-MM-DD HH:MM" كاملة
    client_now: Optional[str] = None        # ساعة العميل المحلية — الإطار المرجعي لزمن التسجيل

class SessionEditRequest(BaseModel):
    """تعديل زمن انضمام/انفصال مسجَّل داخل مهمة مسودة (Draft) — يُحدَّث في مكانه:
    لا حذف + إعادة إنشاء (تجنّب فقد البيانات لو فشل الاستبدال)."""
    action: str                             # "join" → يحدّث start_dt؛ "leave" → يحدّث end_dt
    dt: str                                 # "YYYY-MM-DD HH:MM" كاملة (الزمن الجديد الدقيق)
    client_now: Optional[str] = None        # ساعة العميل المحلية — إطار التحقق من «المستقبل»

class JoinLeaveEntryModel(BaseModel):
    """سجل انضمام/انفصال (فئة مستقلة عن الخطوط) يُحمل في نموذج المهمة نفسها.
    entry_id: موجود عند التعديل (تحديث في مكانه — لا حذف+إعادة إدراج)؛ غائب = إدراج جديد."""
    entry_id: Optional[int] = None
    title: str
    kind: str                               # 'join' أو 'leave'
    dt: Optional[str] = None                # "YYYY-MM-DD HH:MM" كاملة

class JoinLeaveEntryRequest(BaseModel):
    """إنشاء/تعديل سجل كتالوج انضمام/انفصال (Draft فقط)."""
    title: str
    kind: str                               # 'join' أو 'leave'
    dt: str                                 # "YYYY-MM-DD HH:MM" كاملة
    client_now: Optional[str] = None        # ساعة العميل المحلية — إطار التحقق من «المستقبل»

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
    created_at: Optional[str] = None  # توافق خلفي فقط — يُتجاهل (انظر creation_datetime)

    # 🆕 تاريخ/وقت إنشاء المهمة (لقطة المستخدم) — يُكتب مرة واحدة عند الإنشاء،
    #    والمالك فقط يقدر يعدّله لاحقاً (403 لغير المالك). يُنسخ فقط لا يتجدد.
    creation_datetime: Optional[str] = None

    # كود الفريق/الإدارة على مستوى المهمة (حقل مستقل عن المشاركين)
    team_code: Optional[str] = None

    # مفتاح الحماية من الإرسال المكرر (double-submit): يُرسَل أيضاً في ترويسة
    # Idempotency-Key، لكن يُخزَّن في قاعدة البيانات ضمن صف المهمة. كان مفقوداً
    # من النموذج بينما كان الكود يقرأ mission.idempotency_key → AttributeError → 500.
    idempotency_key: Optional[str] = None

    routes: List[RouteModel] = []
    vehicles: List[VehicleModel] = []
    participants: List[ParticipantModel] = []
    beneficiaries: List[BeneficiaryModel] = []
    eoc_staff: List[EOCStaffModel] = []
    # 🆕 سجلات الانضمام/الانفصال (فئة مستقلة) — تُسنَد للمشاركين عبر picker الأيام
    join_leave_entries: List[JoinLeaveEntryModel] = []


# =============================================================================
# الحقول الإلزامية (#6) — تُفرض في السيرفر ذاته (لا يُمكِن الاختراق عبر API مباشر)
# =============================================================================

def validate_mission_required_fields(mission):
    """
    تتأكد من وجود كل الحقول الإلزامية في المهمة وتعيد قائمة بأسماء الناقص منها.
    فارغة ([]) = المهمة سليمة. تُستخدم في POST و PUT معاً.
    """
    def val(v):
        return v is not None and str(v).strip() != ""

    missing = []
    if not val(getattr(mission, "exit_date", None)):
        missing.append("تاريخ المهمة")
    if not val(getattr(mission, "departure_time", None)):
        missing.append("ساعة التحرك / البدء")
    if not any(val(p.full_name) for p in (mission.participants or [])):
        missing.append("إضافة مشارك واحد على الأقل")

    # 🆕 صفة المشارك إلزامية لكل مشارك غير متطوع (المتطوع يُعرف برقم العضوية فقط)
    for i, p in enumerate(mission.participants or []):
        if p.participant_type == "non_volunteer" and \
                not val(getattr(p, "participant_position", None)):
            missing.append(f"صفة المشارك (غير المتطوع: {p.full_name or ('مشارك ' + str(i + 1))})")

    staff_map = {s.role_name: s.staff_name for s in (mission.eoc_staff or [])}
    for role, label in [("مسؤول المتابعة", "مسؤول المتابعة (قائد العملية)"),
                        ("المشرف", "المشرف"),
                        ("الجوكر", "الجوكر"),
                        ("معبئ الاستمارة", "معبئ الاستمارة")]:
        if not val(staff_map.get(role)):
            missing.append(label)
    return missing


def validate_mission_completion(mission):
    """
    قاعدة الإنهاء (#6): لا يجوز أن تصبح المهمة "مكتملة/Completed" إلا بوجود
    تاريخ الانتهاء وساعة الانتهاء معاً.
    """
    def val(v):
        return v is not None and str(v).strip() != ""

    if mission.status in ("Completed", "مكتملة"):
        if not (val(mission.completion_date) and val(mission.completion_time)):
            return "لا يمكن إنهاء وإغلاق المهمة إلا بعد إدخال تاريخ الانتهاء وساعة الانتهاء معاً."
    return None


# =============================================================================
# هوية المشارِك — الجذر الحقيقي (#4)
# المشارك لم يعد مجرد اسم/صفة نصية تُطابَق بالنصوص؛ الهوية الفعلية (volunteer_id /
# user_id / membership_number) تتحل من قاعدة البيانات نفسها وتُخزَّن مع المشاركة.
# => مصدر الحقيقة هو الـ Database، لا أسماء الأشخاص ولا الـ React state.
# =============================================================================

def resolve_participant_identity(cursor, part, exclude_mission_id=None):
    """
    يعيد (volunteer_id, user_id, membership_number, owner_mission_id) للمشارك:

    - المتطوع: يُربط بسجل volunteers عبر رقم العضوية (participation_role = رقم العضوية).
      ومنه نشتق user_id لو للمتطوع حساب دخول (username = رقم العضوية).
    - غير المتطوع: نحتفظ برقم/صفة العرض كما هو (سلوك قائم).
    - owner_mission_id: إن كان المشارك ما زال ملتحقاً بمهمة نشطة أخرى → رقمها
      (يستخدمه رادار التتبع لمنع خروج المتطوع في مهمتين معاً)، وإلا None.
      exclude_mission_id = المهمة الحالية (عند التحديث) حتى لا يتعارض الرادار مع
      صف المشارك الموجود فعلاً في نفس المهمة (الـ PUT لم يعد يحذف المشاركين قبلاً).
    """
    membership = (part.participation_role or "").strip()
    volunteer_id = None
    user_id = None
    owner_mission_id = None
    owner_mission_branch = None
    excl_sql = " AND p.mission_id <> %s" if exclude_mission_id is not None else ""

    if part.participant_type == "volunteer" and membership:
        # 1. الربط بسجل المتطوع بالرقم الموحّد والفرع معاً (هوية = رقم العضوية + الفرع).
        #    رقم العضوية وحده ليس فريداً — قد يتكرر عبر الفروع — فلا يُربط إلا بمطابقة الفرع.
        cursor.execute(
            """
            SELECT v.volunteer_id, v.membership_number
            FROM volunteers v
            WHERE LOWER(TRIM(v.membership_number)) = LOWER(%s)
              AND v.branch_id IS NOT DISTINCT FROM %s
            ORDER BY v.volunteer_id ASC
            LIMIT 1;
            """,
            (membership, part.branch_id),
        )
        row = cursor.fetchone()
        if row:
            volunteer_id = row[0]
            if row[1]:
                membership = row[1]  # الرقم الرسمي كما في سجل المتطوع
            # 2. حساب دخول المتطوع إن وُجد (username = رقم العضوية)
            cursor.execute(
                """
                SELECT u.user_id
                FROM users u
                JOIN volunteers v ON v.volunteer_id = %s
                WHERE LOWER(TRIM(u.username)) = LOWER(TRIM(v.membership_number))
                LIMIT 1;
                """,
                (volunteer_id,),
            )
            ur = cursor.fetchone()
            if ur:
                user_id = ur[0]

    # 3. رادار المنع: هل ما زال ملتحقاً بمهمة نشطة أخرى؟ بالهوية المركّبة
    #    (رقم العضوية + الفرع) — لا برقم العضوية وحده ولا بصف المتطوع: الرقم قد
    #    يتكرر عبر الفروع، فنفس الرقم في فرع مختلف هوية مختلفة ولا يُمنع.
    #    تعريف "النشطة" مطابق تماماً لتعريف القوة البشرية (same source of truth):
    #    المسوّدة ليست تحركاً فعلياً، فمن كان مدرجاً في مسودة فقط لا يمنع تكليفه.
    if part.return_status == "مازال بالمهمة" and membership:
        # excl_sql يُستثنى منه صف المهمة الحالية عند التحديث (fix #7): الرادار يجب ألا
        # يعتبر مشاركاً "في مهمة أخرى" وهو فعلاً ملتحق بنفس المهمة الجاري تعديلها.
        cursor.execute(
            """
            SELECT m.mission_name, COALESCE(b.branch_name, 'غير محدد')
            FROM mission_participants p
            JOIN missions m ON p.mission_id = m.mission_id
            LEFT JOIN branches b ON b.branch_id = p.branch_id
            WHERE LOWER(TRIM(p.membership_number)) = LOWER(%s)
              AND p.branch_id IS NOT DISTINCT FROM %s
              AND m.status NOT IN ('Draft', 'Cancelled', 'Returned', 'Completed')
              -- تعريف «النشطة» مطابق لتعريف القوة البشرية (same source of truth):
              -- حضور مفتوح فعلياً (end_dt IS NULL) فقط — شريحة جارية فعلاً.
              -- الشريحة B القديمة (return_status + صفر segments) أُزيلت لأنها:
              --   1) تمنع مشاركاً لم يُنضمّ فعلياً (نُقِل للاستمارة فقط) من الانضمام لأي مهمة.
              --   2) لا يمكن إصلاحه بالـ LEAVE لأن لا segment مفتوح لإغلاقه.
              AND EXISTS (
                  SELECT 1 FROM mission_participant_sessions s
                  WHERE s.participant_id = p.participant_id AND s.end_dt IS NULL
              )
            """ + excl_sql + """
            LIMIT 1;
            """,
            (membership, part.branch_id) + ((exclude_mission_id,) if exclude_mission_id is not None else ()),
        )
        row = cursor.fetchone()
        if row:
            owner_mission_id = row[0]
            owner_mission_branch = row[1]

    return volunteer_id, user_id, membership, owner_mission_id, owner_mission_branch


def dedupe_participants(participants):
    """يمنع تكرار نفس المتطوع داخل نفس الاستمارة (قبل الإدخال) — يحتفظ بآخر إدخال."""
    seen = set()
    result = []
    for part in reversed(participants):
        if part.participant_type == "volunteer":
            key = (part.branch_id, (part.participation_role or "").strip().lower())
            if key in seen:
                continue
            seen.add(key)
        result.append(part)
    result.reverse()
    return result


def compute_participant_status(mission_status, return_status, segments):
    """
    الحالة الآلية للمشارك (عمود "الحالة") — لا تُدخل يدوياً أبداً:
    - المهمة منتهية  ⇒ "تم انتهاء مهمتة"
    - عودة مسجلة    ⇒ "تم انتهاء مهمتة"
    - segments: أي segment مفتوح (بلا end_dt) ⇒ "مازال بالمهمة"، كلها مغلقة ⇒ "تم انتهاء مهمتة"
    - بلا segments (يرث الأيام/المهمة) والمهمة نشطة ⇒ "مازال بالمهمة"
    """
    if mission_status in ('Completed', 'مكتملة'):
        return 'تم انتهاء مهمتة'
    if return_status == 'تم انتهاء مهمتة':
        return 'تم انتهاء مهمتة'
    if segments:
        return 'مازال بالمهمة' if any(not s.get('end_dt') for s in segments) else 'تم انتهاء مهمتة'
    return 'مازال بالمهمة'


# ═══════════════════════════════════════════════════════════════════════════
# مساعدات Segments المشاركة (Join/Leave) — زمن كامل (timestamp) بدعم المبيت
# ═══════════════════════════════════════════════════════════════════════════

def dt_from_parts(date_str, time_str):
    """دمج تاريخ + وقت في datetime واحد (يقبل "HH:MM" و "HH:MM:SS"). بلا نجاح ⇒ None."""
    if not date_str or not time_str:
        return None
    d = str(date_str).strip()
    t = str(time_str).strip()
    if len(t) == 5 and ':' in t:
        t = t + ':00'
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(f"{d} {t}", fmt)
        except ValueError:
            continue
    return None


def parse_dt_input(value):
    """تفسير "YYYY-MM-DD HH:MM" / "YYYY-MM-DDTHH:MM" / تاريخ فقط ⇒ datetime أو None."""
    if value is None:
        return None
    v = str(value).strip().replace('T', ' ')
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt)
        except ValueError:
            continue
    return None


def segment_span_from_parts(date_str, check_in, check_out):
    """(start_dt, end_dt) من أجزاء الفترة القديمة — مبيت: end <= start ⇒ اليوم التالي."""
    start = dt_from_parts(date_str, check_in)
    if start is None:
        return (None, None)
    if not check_out:
        return (start, None)
    end = dt_from_parts(date_str, check_out)
    if end is not None and end <= start:
        end = end + timedelta(days=1)
    return (start, end)


def fmt_dt(dt):
    """datetime ⇒ "YYYY-MM-DD HH:MM" للعرض."""
    return dt.strftime("%Y-%m-%d %H:%M") if dt else None


def reference_segment_start(cursor, mission_row, itinerary_group=None, start_from_mission=False, assigned_groups=None):
    """
    بداية المشاركة المرجعية عند تسجيل انفصال بلا segment مفتوح:
    - start_from_mission (checkbox «يُحسب من بداية المهمة») ⇒ بداية المهمة — مفتاح نقي
      (القاعدة 3)، أياً كان اليوم/المجموعة.
    - المهمة المفتوحة (itinerary_group): أقرب انطلاق (تاريخ+وقت) لليوم المختار — يدعم المبيت.
    - بلا مجموعة وبتخصيصات (assigned_groups): أقرب انطلاق عبر كل تخصيصات المشارك.
    - غير ذلك: بداية المهمة (exit_date ثم بدائل + departure_time ثم start_time — القاعدة 1).
    """
    if not isinstance(mission_row, dict):
        mission_row = dict(mission_row)

    if start_from_mission:
        s = mission_start_dt(mission_row)
        if s:
            return s

    if itinerary_group:
        cursor.execute(
            "SELECT MIN(departure_date + departure_time) FROM mission_itineraries "
            "WHERE mission_id = %s AND group_title = %s AND departure_date IS NOT NULL AND departure_time IS NOT NULL",
            (mission_row.get('mission_id'), itinerary_group),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return row[0]
        # قديم بلا تواريخ: أقرب انطلاق (وقت فقط) في يوم انطلاق المهمة
        cursor.execute(
            "SELECT MIN(departure_time) FROM mission_itineraries "
            "WHERE mission_id = %s AND group_title = %s AND departure_time IS NOT NULL",
            (mission_row.get('mission_id'), itinerary_group),
        )
        row = cursor.fetchone()
        dep_date = mission_row.get('departure_date')
        if row and row[0] and dep_date:
            s = dt_from_parts(dep_date, row[0])
            if s:
                return s
    elif assigned_groups:
        cursor.execute(
            "SELECT MIN(departure_date + departure_time) FROM mission_itineraries "
            "WHERE mission_id = %s AND group_title = ANY(%s) AND departure_date IS NOT NULL AND departure_time IS NOT NULL",
            (mission_row.get('mission_id'), list(assigned_groups)),
        )
        row = cursor.fetchone()
        if row and row[0]:
            return row[0]
    # بداية المهمة — نفس ترتيب القاعدة 1 بلا استخدام created_at ما دام exit_date موجوداً
    d = (mission_row.get('exit_date')
         or mission_row.get('departure_date')
         or mission_row.get('arrival_date')
         or str(mission_row.get('created_at') or '')[:10])
    for tcol in ('departure_time', 'start_time'):
        t = mission_row.get(tcol)
        if t:
            s = dt_from_parts(d, t) if d else None
            if s:
                return s
    return None


def segment_hours(segments, now=None):
    """مجموع ساعات الـ segments: مغلقة (فرق ثابت) + مفتوحة (من start_dt إلى now)."""
    total = 0.0
    now = now or datetime.now()
    for s in segments:
        start = s.get('start_dt')
        if isinstance(start, str):
            start = parse_dt_input(start)
        if not start:
            continue
        end = s.get('end_dt')
        if isinstance(end, str):
            end = parse_dt_input(end)
        end = end or now
        secs = (end - start).total_seconds()
        if secs > 0:
            total += secs / 3600.0
    return round(total, 2)


def validate_segment_datetime(dt_value, now=None):
    """رفض زمن مُدخل في المستقبل (400) — حتمي تحت ساعة مثبّتة في الاختبارات."""
    now = now or datetime.now()
    if dt_value and dt_value > now:
        raise HTTPException(status_code=400, detail="الزمن المُدخل في المستقبل")


def mission_start_dt(mission_data):
    """بداية المهمة = «تاريخ المهمة» (exit_date) + «ساعة التحرك/البدء» (departure_time) ثم
    start_time. بدائل التاريخ فقط عند غياب exit_date: departure_date→arrival_date→(created_at).
    ⚠️ لا تُستخدم created_at أبداً كبداية المهمة ما دام exit_date موجوداً (القاعدة 1)."""
    d = (mission_data.get('exit_date')
         or mission_data.get('departure_date')
         or mission_data.get('arrival_date')
         or str(mission_data.get('created_at') or '')[:10])
    for tcol in ('departure_time', 'start_time'):
        t = mission_data.get(tcol)
        if t:
            s = dt_from_parts(d, t)
            if s:
                return s
    return None


def planned_start_dt(mission_data, assigned_days, routes, start_from_mission=False):
    """مصدر بداية المشاركة المخططة — مفتاح نقي (بلا أي شروط تواريخ):
    - أقرب انطلاق عبر مسارات المشارك المسندة (مجموعاته المخصصة) له الأولوية.
    - start_from_mission (checkbox) ⇒ بداية المهمة.
    - بلا مسارات مسندة ولا checkbox ⇒ None (لا بداية = غير مشارك — ساعات صفرية).
    يفوض إلى participation_start_dt (مصدر الحقيقة الواحد لمحرك الساعات، requirement C)."""
    return participation_start_dt(mission_data, assigned_days, routes, start_from_mission)


# ═══════════════════════════════════════════════════════════════════════════
# انضمام/انفصال الكتالوج — فئة مستقلة (ليست خط سير)
# القاعدة الجوهرية: سجل الانضمام/الانفصال (mission_join_leave_entries) يُسنَد إلى
# المشاركين عبر mission_participant_itineraries بمفتاح مشفّر «JL:J:<title>» / «JL:L:<title>».
# أي مستهلك مسارات يفلتر بمطابقة group_title حرفياً ⇒ مفاتيح JL:* تُتجاهل ضمنياً
# من كل حساب مسارات — صفر تغيير على نظام الخطوط.
# ═══════════════════════════════════════════════════════════════════════════

JL_PREFIX_JOIN, JL_PREFIX_LEAVE = 'JL:J:', 'JL:L:'

# رسالة رفض الانفصال بلا بدء مشاركة — مطابقة مطلقة بين الواجهة والـ backend (requirement E)
JL_ERR_NO_START = "لا يمكن إضافة انفصال لهذا المشارك لأنه لا يوجد له موعد بدء للمشاركة. برجاء تحديد انضمام أو خط سير أو تفعيل «من بداية المهمة» أولًا."


def split_assigned_days(assigned_days):
    """فصل التخصيصات المختلطة: مسارات (أسماء مجموعات عادية) مقابل أحداث انضمام/انفصال.
    events = قائمة (kind, title) مثل ('join', 'الدفعة الأولى')."""
    routes, events = [], []
    for a in assigned_days or []:
        if not a:
            continue
        if a.startswith(JL_PREFIX_JOIN):
            events.append(('join', a[len(JL_PREFIX_JOIN):]))
        elif a.startswith(JL_PREFIX_LEAVE):
            events.append(('leave', a[len(JL_PREFIX_LEAVE):]))
        else:
            routes.append(a)
    return routes, events


def jl_key(kind, title):
    """مفتاح الإسناد المشفّر لسجل كتالوج واحد — يُخزَّن في itinerary_group."""
    return (JL_PREFIX_JOIN if kind == 'join' else JL_PREFIX_LEAVE) + title


def participation_start_dt(mission_data, route_groups, routes, start_from_mission=False):
    """بداية المشاركة (مصدر الحقيقة الواحد لمحرك الساعات):
    أقرب انطلاق لمجموعة مسار مخصصة → بداية المهمة (فقط لو «من بداية المهمة») → None.
    None = لا بداية = «غير مشارك» (ساعات صفرية)."""
    groups = set(route_groups or [])
    earliest = None
    for g in routes:
        if g.get('group_title') not in groups:
            continue
        sd = dt_from_parts(g.get('departure_date'), g.get('departure_time'))
        if sd and (earliest is None or sd < earliest):
            earliest = sd
    if earliest:
        return earliest
    if start_from_mission:
        return mission_start_dt(mission_data)
    return None


def derive_jl_segments(assigned_days, entry_dt_map, mission_row, routes, start_from_mission=False):
    """يُشتق نطاقات المشاركة للمشارك من تخصيصاته (مسارات + أحداث كتالوج).
    entry_dt_map: {(kind, title): (dt, entry_id)} من كتالوج المهمة.
    مسح زمني مفتوح/مغلق (requirement C/D + قاعدتا «انضمام = بداية مطلقة» و«لا تداخل»):
    - في وجود أي انضمام ⇒ الانضمام هو البداية المطلقة؛ بديل المسار/بداية المهمة غير مؤهل أبداً.
    - المسح الزمني: انضمام يفتح فترة إذا لم تكن مفتوحة، انضمام داخل فترة حيّة يُبتلع (لا تداخل)،
      انفصال يغلق الفترة المفتوحة، انفصال بلا فترة مفتوحة ⇒ 400 (يرجع أو انضمام جديد مطلوب).
    - بلا أي انضمام ⇒ بديل (أقرب مسار → بداية المهمة حسب checkbox) يفتح فترة واحدة فقط.
    يرفع 400 برسالة JL_ERR_NO_START لأي انفصال بلا بدء مشاركة صالح."""
    route_titles, events = split_assigned_days(assigned_days)
    joins, leaves = [], []
    for kind, title in events:
        rec = entry_dt_map.get((kind, title))
        if not rec:
            continue  # سجل محذوف/غير معروف ⇒ إسناد قديم يُتجاهل (يُعاد الاشتقاق نظيفاً)
        dt, entry_id = rec
        target = joins if kind == 'join' else leaves
        target.append({'dt': dt, 'id': entry_id})
    joins.sort(key=lambda x: x['dt'])
    leaves.sort(key=lambda x: x['dt'])
    fallback = participation_start_dt(mission_row, route_titles, routes, start_from_mission)

    periods = []
    if joins:
        merged = sorted(
            [(j['dt'], 'join', j) for j in joins] + [(l['dt'], 'leave', l) for l in leaves],
            key=lambda x: x[0],
        )
        open_start, open_entry = None, None
        for t, ev_kind, ev in merged:
            if ev_kind == 'join':
                if open_start is None:
                    open_start, open_entry = t, ev['id']
                # وإلا ⇒ انضمام داخل فترة حيّة يُبتلع (لا تداخل).
            else:  # leave
                if open_start is not None:
                    periods.append({'start': open_start, 'end': t,
                                    'start_entry_id': open_entry, 'end_entry_id': ev['id']})
                    open_start, open_entry = None, None
                else:
                    raise HTTPException(status_code=400, detail=JL_ERR_NO_START)
        if open_start is not None:
            periods.append({'start': open_start, 'end': None,
                            'start_entry_id': open_entry, 'end_entry_id': None})
    else:
        start_used = False
        for lev in leaves:
            if not start_used and fallback is not None and fallback <= lev['dt']:
                periods.append({'start': fallback, 'end': lev['dt'],
                                'start_entry_id': None, 'end_entry_id': lev['id']})
                start_used = True
            else:
                raise HTTPException(status_code=400, detail=JL_ERR_NO_START)
    return periods


def materialize_jl_segments(cursor, mission_id, mission_row, user_id=None, fire_events=True):
    """إعادة توليد شرائح المشاركة المشتقة من كتالوج الانضمام/الانفصال للمهمة (Draft فقط).
    مصدر الحقيقة = مسارات/أحداث المشارك المُسنَدة. مبدأ عدم المساس:
      - الشرائح القديمة (start_entry_id NULL و end_entry_id NULL) لا تُلمس أبداً.
      - الشرائح الموسومة تُطابَق بـ (start_entry_id, end_entry_id): تحديث في مكانها،
        حذف ما لم يعد موجوداً، إدراج الجديد — نفس صيغة إدراج /join.
    - يزامن return_status: شريحة مفتوحة ⇒ «مازال بالمهمة»، أي شريحة مغلقة ⇒ «تم انتهاء مهمتة».
    - fire_events ⇒ سجل Audit + حدث لحظي لكل شريحة مستحدثة (polite try/except)."""
    cursor.execute(
        "SELECT p.participant_id, p.full_name, p.start_from_mission FROM mission_participants p "
        "WHERE p.mission_id = %s AND p.roster_active = true",
        (mission_id,),
    )
    participants = [{'id': r[0], 'name': r[1], 'sfm': (r[2] is not False)} for r in cursor.fetchall()]
    if not participants:
        return

    cursor.execute(
        "SELECT group_title, departure_date, departure_time FROM mission_itineraries "
        "WHERE mission_id = %s AND group_title IS NOT NULL",
        (mission_id,),
    )
    routes = [
        {'group_title': r[0], 'departure_date': r[1], 'departure_time': r[2]}
        for r in cursor.fetchall()
    ]

    cursor.execute(
        "SELECT entry_id, title, kind, dt FROM mission_join_leave_entries WHERE mission_id = %s",
        (mission_id,),
    )
    entry_dt_map = {}
    for r in cursor.fetchall():
        entry_dt_map[(r[2], r[1])] = (r[3], r[0])

    mission_name = mission_row.get('mission_name') or ''
    for p in participants:
        cursor.execute(
            "SELECT itinerary_group FROM mission_participant_itineraries "
            "WHERE participant_id = %s AND mission_id = %s",
            (p['id'], mission_id),
        )
        assigned_days = [r[0] for r in cursor.fetchall()]

        try:
            periods = derive_jl_segments(assigned_days, entry_dt_map, mission_row, routes, p['sfm'])
        except HTTPException:
            raise  # 400 بلا بدء مشاركة — يوقف الحفظ برسالة واضحة (لا حفظ نصف مكتمل)

        # ── التطابق/المواءمة (reconcile) مع شرائح المشاركة الموسومة فقط ──
        #    ترتيب آمن ضد قيد الفريدة (mission_id, participant_id, session_date,
        #    check_in_time): تحديث في مكانه ← حذف غير المُطالب ← إدراج الجديد.
        #    مطابقة بالهوية الكاملة (start,end) أولاً، ثم بإعادة استخدام نفس
        #    بداية الانضمام عند تبدل الانفصال (مفتوحة→مغلقة أو العكس — الانضمام
        #    يفتح فترة واحدة لكل مشارك)، ثم بالبدء الاحتياطي (start_entry NULL =
        #    صف اشتقاق واحد كحد أقصى لكل مشارك). القديم (بلا وسوم) لا يُلمس أبداً.
        cursor.execute(
            "SELECT session_id, start_dt, end_dt, session_date, check_in_time, check_out_time, "
            "       start_entry_id, end_entry_id, notes "
            "FROM mission_participant_sessions WHERE participant_id = %s",
            (p['id'],),
        )
        existing = cursor.fetchall()
        tagged_rows = [r for r in existing if r[6] is not None or r[7] is not None]
        claimed = set()  # session_ids المُحدَّثة في مكانها (لا حذف ولا إدراج جديد)

        inserts = []
        for pd in periods:
            sd = pd['start']
            ed = pd['end']
            want = (pd['start_entry_id'], pd['end_entry_id'])
            # (أ) المفتاح الكامل مطابق
            row = next((r for r in tagged_rows
                        if r[0] not in claimed and (r[6], r[7]) == want), None)
            if row is None and pd['start_entry_id'] is not None:
                # (ب) إعادة استخدام نفس بداية الانضمام عند تبدل الانفصال
                row = next((r for r in tagged_rows
                            if r[0] not in claimed and r[6] == pd['start_entry_id']), None)
            if row is None and pd['start_entry_id'] is None:
                # (ج) البدء الاحتياطي — صف اشتقاق واحد ببداية NULL
                row = next((r for r in tagged_rows
                            if r[0] not in claimed and r[6] is None and r[7] is not None), None)
            if row:
                cursor.execute(
                    "UPDATE mission_participant_sessions SET start_dt = %s, end_dt = %s, "
                    "session_date = %s, check_in_time = %s, check_out_time = %s, "
                    "end_entry_id = %s WHERE session_id = %s",
                    (sd, ed, sd.date() if sd else None, sd.time() if sd else None,
                     ed.time() if ed else None, pd['end_entry_id'], row[0]),
                )
                claimed.add(row[0])
            else:
                inserts.append(pd)

        # حذف شرائحنا التي لم تُطالَب (موسومة فقط — القديمة محفوظة) — قبل الإدراج
        # حتى لا يصطدم الجديد بقيد الفريدة على (participant, session_date, check_in).
        for r in tagged_rows:
            if r[0] not in claimed:
                cursor.execute(
                    "DELETE FROM mission_participant_sessions WHERE session_id = %s", (r[0],)
                )

        # إدراج الجديد (فترات جديدة بدون صف مُطابَق)
        for pd in inserts:
            sd = pd['start']
            ed = pd['end']
            cursor.execute(
                """INSERT INTO mission_participant_sessions
                   (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt,
                    start_entry_id, end_entry_id, notes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'انضمام')""",
                (p['id'], mission_id, sd.date() if sd else None, sd.time() if sd else None,
                 sd, ed, pd['start_entry_id'], pd['end_entry_id']),
            )
            if fire_events:
                created_pd = dict(pd)
                created_pd['mission_name'] = mission_name
                created_pd['participant_name'] = p['name']
                _emit_jl_event(cursor, mission_id, user_id, created_pd)

        # ── مزامنة الحالة: مفتوح ⇒ «مازال بالمهمة»؛ وإلا أغلق كل شيء ⇒ «تم انتهاء مهمتة»
        cursor.execute(
            "SELECT status FROM missions WHERE mission_id = %s", (mission_id,)
        )
        m_status = cursor.fetchone()[0]
        new_status = ('مازال بالمهمة'
                      if any(pd['end'] is None for pd in periods)
                      else ('تم انتهاء مهمتة' if periods else None))
        if new_status and m_status not in ('Completed', 'مكتملة'):
            cursor.execute(
                "UPDATE mission_participants SET return_status = %s WHERE participant_id = %s",
                (new_status, p['id']),
            )


def _emit_jl_event(cursor, mission_id, user_id, pd):
    """Audit + حدث لحظي لشريحة مشاركة مستحدثة من كتالوج الانضمام/الانفصال.
    لا تُفسد الحفظ أبداً (polite — أي خطأ يُطبع ويُتجاوز)."""
    try:
        create_audit_log(
            cursor, user_id, "انضمام" if pd['end_entry_id'] is None else "انفصال",
            mission_id=mission_id, entity_type="mission", entity_id=mission_id,
            details={
                "action_text": (f"تسجيل انضمام {pd['participant_name']} في {pd['mission_name']} "
                                f"عند {fmt_dt(pd['start'])}"),
            },
        )
    except Exception as e:
        print(f"Audit Error (JL): {e}")


def mission_end_dt(mission_data):
    """نهاية المهمة — completion ثم arrival."""
    d = mission_data.get('completion_date') or mission_data.get('arrival_date')
    for tcol in ('completion_time', 'arrival_time'):
        t = mission_data.get(tcol)
        if t and d:
            e = dt_from_parts(d, t)
            if e:
                return e
    return None


def assigned_span(assigned_groups, routes, mission_start=None, start_from_mission=False, end_cap=None):
    """نافذة الجدول للخطوط المسندة (خطة افتراضية) = لكل يوم (departure_date) مدى
    «أول انطلاق → آخر وصول» عبر كل المسارات المسندة لذلك اليوم، ثم الجمع عبر الأيام.
    مثال: مسار 10:00→14:00 + مسار 13:00→18:00 لنفس اليوم ⇒ 10:00→18:00 (مدى واحد، لا جمع).
    المسارات بلا تواريخ (قديم) تُدمج في يوم واحد 'day' — تُعامل معاملة نفس اليوم.
    - start_from_mission و mission_start ⇒ استبدال بداية أول أيام المشارك ببداية المهمة
      (مفتاح مصدر واحد، بلا أي شرط تواريخ — القاعدة 3).
    - end_cap ⇒ أي نهاية تتجاوز سقف نهاية المهمة تُقصَّ إلى السقف (fix D1: نافذة
      الخطة القديمة غير المقصوصة). end_cap=None أثناء النشاط ⇒ غير فعّال.
    """
    by_day = {}
    groups = set(assigned_groups or [])
    for g in routes:
        if g.get('group_title') not in groups:
            continue
        sd = dt_from_parts(g.get('departure_date'), g.get('departure_time'))
        ed = dt_from_parts(g.get('arrival_date'), g.get('arrival_time'))
        if sd and ed:
            key = str(g.get('departure_date')) or str(g.get('arrival_date')) or 'day'
            if key not in by_day:
                by_day[key] = [sd, ed]
            else:
                by_day[key][0] = min(by_day[key][0], sd)
                by_day[key][1] = max(by_day[key][1], ed)
    total = 0.0
    if start_from_mission and mission_start and by_day:
        # «أول أيام» المشارك = اليوم الذي يبدأ فيه مداه أولاً — نستبدل بدايته ببداية المهمة.
        earliest_key = min(by_day, key=lambda k: by_day[k][0])
        by_day[earliest_key][0] = mission_start
    for lo, hi in by_day.values():
        if end_cap and hi > end_cap:
            hi = end_cap
        secs = (hi - lo).total_seconds()
        if secs > 0:
            total += secs / 3600.0
    return total


def compute_working_hours(mission_data, mission_status, segments, assigned_days, routes, now=None, start_from_mission=False):
    """
    ساعات عمل المشارك — محرك واحد موحّد (لا فرق Normal/Open — التصنيف للعرض فقط):
    ⭐ المبدأ (fix #6): الساعات الفعلية تأتي من JOIN/LEAVE حصراً.
        • وُجدت أي قطاعات (تحت أي مجموعة أو بلا مجموعة) ⇒ مجموع مددها الفعلية فقط —
          لا خليط مع نافذة افتراضية لأيام لم يشارك فيها فعلياً.
        • لا قطاعات + تخصيص صريح (assigned_days) ⇒ نافذة المسارات المُسندة إليه (واحد أو أكثر).
        • لا قطاعات ولا تخصيص ⇒ افتراضي خطة المهمة: خط أساسي ⇒ نافذته، وإلا أول
          مجموعة مخصصة، وإلا ⇒ بداية/نهاية المهمة نفسها.
    الـ segment المفتوح يُحسب حتى الآن (إطار العميل) — أو حتى نهاية المهمة إن اكتملت.
    start_from_mission (checkbox «يُحسب من بداية المهمة») = مفتاح نقي على مصدر بداية
    المشاركة المخططة: TRUE ⇒ بداية المهمة؛ FALSE ⇒ بداية المسار المسند. الافتراضي
    هنا False ليبقى معنى اختبارات المحرك النقية؛ عمود القاعدة افتراضه TRUE، ومواقع
    الإنتاج تمرر دائماً القيمة المخزنة.
    """
    now = now or datetime.now()
    completed = mission_status in ('Completed', 'مكتملة')
    end_cap = mission_end_dt(mission_data) if completed else None
    planned_start = planned_start_dt(mission_data, assigned_days, routes, start_from_mission)

    def seg_dur(s):
        start = s.get('start_dt')
        if isinstance(start, str):
            start = parse_dt_input(start)  # GET يُسلّم نصوصًا — نقبل datetime أيضًا
        if not start:
            return 0.0
        end = s.get('end_dt')
        if isinstance(end, str):
            end = parse_dt_input(end)
        if end:
            # مغلق — يُقصّ إلى سقف نهاية المهمة إن تجاوزه (fix D1: القديم غير المقصوص)
            if end_cap and end > end_cap:
                end = end_cap
        else:
            end = end_cap or now  # مفتوح — حتى الآن، أو حتى نهاية المهمة إن اكتملت
        secs = (end - start).total_seconds()
        return (secs / 3600.0) if secs > 0 else 0.0

    def day_window(title, cap=None):
        # نافذة اليوم = (أواخر وصول − أول انطلاق) بين كل مسارات ذلك اليوم (بالتواريخ للمبيت)
        spans = []
        for g in routes:
            if g.get('group_title') != title:
                continue
            sd = dt_from_parts(g.get('departure_date'), g.get('departure_time'))
            ed = dt_from_parts(g.get('arrival_date'), g.get('arrival_time'))
            if sd and ed:
                spans.append((sd, ed))
        if not spans:
            return 0.0
        hi = max(s[1] for s in spans)
        if cap and hi > cap:
            hi = cap
        w = (hi - min(s[0] for s in spans)).total_seconds()
        return (w / 3600.0) if w > 0 else 0.0

    assigned = assigned_days or []

    # ⭐ الحضور الفعلي هو مصدر الحقيقة دائماً — أي قطاعات (انضمام/انفصال/عودة) ⇒
    #    مجموعها هو الحساب الوحيد، حتى لو اكتملت المهمة (الخطة لا تحلّ محل المشاركة
    #    الفعلية أبداً). الـ segment المفتوح في مهمة مكتملة يُغلق عند نهاية المهمة (end_cap).
    if segments:
        return round(sum(seg_dur(s) for s in segments), 2)

    # (مهم) المكتملة بلا قطاعات فعليّة تتجمّد لمدى المشاركة المخططة (الخطة الافتراضية):
    #    بدايتها من planned_start (مفتاح checkbox: TRUE = بداية المهمة، FALSE = بداية
    #    المسار المسند) ونهايتها سقف نهاية المهمة (end_cap) — القاعدة 3، بلا شروط تواريخ.
    if completed:
        start = planned_start
        if not start:
            return 0.0
        end = end_cap
        if end and end > start:
            return round((end - start).total_seconds() / 3600.0, 2)
        return 0.0

    # (1) بلا قطاعات + تخصيص صريح ⇒ الافتراضي من المسارات المُسندة إليه (واحد أو أكثر)
    #     أي: خط السير هو الخطة الافتراضية فقط، ولا يُحتسب إلا بغياب الحضور الفعلي.
    #     fix #4: عدة مسارات مسندة ⇒ المدى (أول انطلاق → آخر وصول) لكل يوم، لا الجمع —
    #     مسار 10:00→14:00 + مسار 13:00→18:00 لنفس اليوم ⇒ 10:00→18:00 (8 ساعات) لا 9.
    #     start_from_mission ⇒ استبدال بداية أول أيام المشارك ببداية المهمة (القاعدة 3).
    if assigned:
        return round(assigned_span(
            assigned, routes,
            mission_start=(mission_start_dt(mission_data) if start_from_mission else None),
            start_from_mission=start_from_mission,
            end_cap=end_cap,
        ), 2)

    # (2) بلا قطاعات وبلا تخصيص ⇒ افتراضي خطة المهمة (مباشر):
    #     • يوجد خط أساسي ⇒ نافذة «خط السير الأساسي» (Both exist → Basic default)
    #     • وإلا أول مجموعة مخصصة (Custom-only)
    #     • وإلا ⇒ بداية/نهاية المهمة نفسها (No itinerary → Mission Start/End)
    # 🆕 requirement C: بلا تخصيص وبلا «من بداية المهمة» لا يوجد بدء مشاركة مطلقاً
    #    ⇒ «غير مشارك» وساعاته صفرية؛ النافذة الافتراضية لا تُمنح لمن بلا بداية.
    if not participation_start_dt(mission_data, assigned_days, routes, start_from_mission):
        return 0.0
    basic_win = day_window('خط السير الأساسي', cap=end_cap) if 'خط السير الأساسي' in [g.get('group_title') for g in routes] else 0.0
    if basic_win > 0:
        return round(basic_win, 2)
    custom_win = 0.0
    seen = set()
    for g in routes:
        t = g.get('group_title')
        if t and t not in seen and t != 'خط السير الأساسي':
            seen.add(t)
            w = day_window(t, cap=end_cap)
            if w > 0:
                custom_win = w
                break
    if custom_win > 0:
        return round(custom_win, 2)
    start = planned_start
    if not start:
        return 0.0
    end = mission_end_dt(mission_data) or now
    if now < end:
        end = now  # نشطة وسقف الخطة لم يصل بعد ⇒ ساعات حتى الآن
    if end and end > start:
        return round((end - start).total_seconds() / 3600.0, 2)
    return 0.0


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
                    m.status, b.branch_name, m.mission_type, m.mission_location, m.data_source, m.departure_date, m.completion_date, m.notes, m.exit_date,
                    m.team_code, m.creation_datetime
                FROM missions m
                LEFT JOIN branches b ON m.branch_id = b.branch_id
            """
            
            if role_name.upper() in ["OWNER", "MANAGER", "ADMIN", "SUPERVISOR", "JOKER", "OPERATION", "مشرف", "جوكر", "المالك", "أوبريشن"]:
                # 🆕 التاريخ المعياري لترتيب سجل المهام هو «تاريخ/وقت إنشاء المهمة» (creation_datetime)
                #    — لا «تاريخ المهمة» (exit_date) ولا created_at. fallback: created_at (قديم بلا تاريخ إنشاء)
                query = base_query + " ORDER BY COALESCE(m.creation_datetime, m.created_at) DESC;"
                cursor.execute(query)
            else:
                user_branches = get_user_branches(user_id)
                branch_ids = [b["branch_id"] for b in user_branches]
                if not branch_ids: return []
                # 💡 الإصلاح الأول: استخدام = ANY(%s) بدل IN %s
                query = base_query + " WHERE m.branch_id = ANY(%s) ORDER BY COALESCE(m.creation_datetime, m.created_at) DESC;"
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
                # 💡 إصلاح التاريخ (متطلب #4): التاريخ النصفي يبقى كاملاً (تاريخ + وقت) بنفس توقيت النظام بدون أي تحويل
                result.append({
                    "mission_id": m_id, "mission_code": r[1], "mission_classification": r[2] or "عادية",
                    "created_at": r[3].strftime("%Y-%m-%d %H:%M") if hasattr(r[3], 'strftime') else str(r[3]).split(' ')[0] if r[3] else "-",
                    "mission_name": r[4] or "بدون اسم",
                    "vol_count": r[5] or 0, "non_vol_count": r[6] or 0, "total_participants": (r[5] or 0) + (r[6] or 0),
                    "team_codes": r[7] or "-", "responsible_person": r[8] or "-", "drivers": r[9] or "-",
                    "plates": r[10] or "-", "status": r[11] or "Draft", "branch": r[12] or "-",
                    "mission_type": r[13] or "-", "mission_location": r[14] or "-", "data_source": r[15] or "-",
                    "departure_date": str(r[16]) if r[16] else "-", "completion_date": str(r[17]) if r[17] else "-",
                    "notes": r[18] or "-",
                    "exit_date": str(r[19]) if len(r) > 19 and r[19] else "-",
                    "team_code": (r[20] or "") if len(r) > 20 else "",
                    "creation_datetime": str(r[21]) if len(r) > 21 and r[21] else "-",
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
def create_mission(
    mission: MissionCreate,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    idempotency_key_header: Optional[str] = Header(None),
):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    # مفتاح الحماية يُقرأ من الترويسة أولاً (الواجهة ترسله في الـ header)،
    # مع مرونة دعم إرساله داخل الـ body أيضاً للتوافق مع أي عميل قديم.
    ikey = mission.idempotency_key or idempotency_key_header or None

    # 🛡️ الحقول الإلزامية + قاعدة الإنهاء — تُفرض في السيرفر قبل أي PROCESS للطلب
    missing_required = validate_mission_required_fields(mission)
    if missing_required:
        raise HTTPException(status_code=400, detail="الحقول الإلزامية التالية مطلوبة: " + "، ".join(missing_required))
    completion_error = validate_mission_completion(mission)
    if completion_error:
        raise HTTPException(status_code=400, detail=completion_error)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # 🛡️ حماية من الإرسال المكرر (double-submit): لو نفس الطلب اتبعت قبل كده
            # بنفس مفتاح idempotency_key، بنرجع نفس المهمة القديمة من غير ما نسجلها تاني.
            if ikey:
                cursor.execute(
                    "SELECT mission_id, mission_code FROM missions WHERE idempotency_key = %s;",
                    (ikey,)
                )
                existing = cursor.fetchone()
                if existing:
                    return {"message": "تم حفظ المهمة بنجاح", "mission_code": existing[1], "mission_id": existing[0]}

            mission_code = f"#MSN-{datetime.now().strftime('%y%m%d-%H%M%S')}"
            def none_if_empty(val): return val if val != "" else None

            # 🆕 لقطة تاريخ/وقت الإنشاء (إصدار المستخدم) — تُكتب مرة واحدة ولا تُعاد توليدها
            creation_dt_val = parse_dt_input(mission.creation_datetime) if mission.creation_datetime else None

            cursor.execute("""
                INSERT INTO missions (
                    mission_code, mission_name, mission_classification, branch_id, mission_type, mission_location, responsible_person,
                    data_source, status, exit_date, departure_date, arrival_date, return_date, completion_date,
                    start_time, departure_time, arrival_time, completion_time, injured_count,
                    indirect_beneficiaries_total, notes, internal_notes, idempotency_key, team_code, creation_datetime
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                ) RETURNING mission_id;
            """, (
                mission_code, mission.mission_name, mission.mission_classification, mission.branch_id, mission.mission_type, mission.mission_location,
                mission.responsible_person, mission.data_source, mission.status,
                none_if_empty(mission.exit_date), none_if_empty(mission.departure_date), none_if_empty(mission.arrival_date),
                none_if_empty(mission.return_date), none_if_empty(mission.completion_date),
                none_if_empty(mission.start_time), none_if_empty(mission.departure_time), none_if_empty(mission.arrival_time),
                none_if_empty(mission.completion_time),
                mission.injured_count, mission.indirect_beneficiaries_total, mission.notes, mission.internal_notes,
                ikey,
                mission.team_code if mission.team_code is not None else "",
                creation_dt_val
            ))
            mission_id = cursor.fetchone()[0]

            # 🛡️ حماية FK: التأكد من أن المهمة فعلاً موجودة قبل إدخال خطوط السير
            cursor.execute("SELECT 1 FROM missions WHERE mission_id = %s;", (mission_id,))
            if not cursor.fetchone():
                raise Exception(f"Mission creation failed: mission_id={mission_id} not found after INSERT. Aborting itinerary insert to prevent FK violation.")

            for route in mission.routes:
                cursor.execute("""
                    INSERT INTO mission_itineraries (mission_id, group_title, route_from, route_to, departure_time, arrival_time, departure_date, arrival_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                """, (mission_id, route.group_title, none_if_empty(route.route_from), route.route_to, none_if_empty(route.departure_time), none_if_empty(route.arrival_time), none_if_empty(route.departure_date), none_if_empty(route.arrival_date)))

            for vehicle in mission.vehicles:
                cursor.execute("INSERT INTO mission_vehicles (mission_id, driver_name, vehicle_number) VALUES (%s, %s, %s);", (mission_id, vehicle.driver_name, vehicle.vehicle_number))

            # 🆕 كتالوج الانضمام/الانفصال (فئة مستقلة عن الخطوط) — إدراج سجلات النموذج
            _sync_jl_catalog(cursor, mission_id, mission.join_leave_entries)

            # منع تكرار نفس المتطوع داخل نفس الاستمارة (قبل الرادار والإدخال)
            participant_user_ids = []
            inserted_participants = []  # (participant_id, participant_model) for session linking
            for part in dedupe_participants(mission.participants):
                # 1. أوتوميشن الإغلاق
                if mission.status in ['Completed', 'مكتملة']:
                    part.return_status = 'تم انتهاء مهمتة'

                # 2. الهوية الفعلية (الـ DB هي مصدر الحقيقة): ربط المتطوع + حساب دخوله + رادار المنع
                volunteer_id, participant_user_id, membership, active_in_other, active_in_other_branch = resolve_participant_identity(cursor, part)
                if participant_user_id:
                    participant_user_ids.append(participant_user_id)

                # 3. رادار التتبع لمنع خروج المتطوع في مهمتين مع بعض (بالهوية المركّبة لا بالنصوص)
                if active_in_other is not None:
                    raise Exception(f"المشارك '{part.full_name}' (رقم العضوية {membership} — فرع {active_in_other_branch}) غير قابل للإضافة: رقم العضوية + الفرع مسجَّل حالياً في مهمة نشطة أخرى ({active_in_other}).\n\nلا يمكن إضافته حتى يتم تسجيل عودته في تلك المهمة أولاً (عاد للقاعدة).")

                cursor.execute("""
                    INSERT INTO mission_participants (mission_id, participant_type, full_name, team_name, team_code, participation_role, participant_position, volunteer_id, user_id, membership_number, branch_id, assigned_itinerary, return_status, phase_name, stay_type, start_from_mission)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING participant_id;
                """, (mission_id, part.participant_type, part.full_name, part.team_name or '', part.team_code or '', part.participation_role, part.participant_position or '', volunteer_id, participant_user_id, membership, part.branch_id, part.assigned_itinerary, part.return_status, part.phase_name, part.stay_type, (part.start_from_mission is not False)))
                pid = cursor.fetchone()[0]
                inserted_participants.append((pid, part))

            # 🆕 فترات المشاركة (legacy path فقط — الواجهة الجديدة تدير الـ segments عبر
            #    /join و /leave ولا ترسل فترات في النموذج). أي فترة واردة تُخزَّن
            #    بـ start_dt/end_dt كامليْن (دعم المبيت) بدلاً من الأوقات المنفصلة.
            session_rows = []
            for pid, part in inserted_participants:
                for period in (part.participation_periods or []):
                    start_dt, end_dt = segment_span_from_parts(period.session_date, period.check_in_time, period.check_out_time)
                    session_rows.append((pid, mission_id, period.session_date, period.check_in_time, period.check_out_time, period.notes, start_dt, end_dt))
            if session_rows:
                cursor.executemany("""
                    INSERT INTO mission_participant_sessions (participant_id, mission_id, session_date, check_in_time, check_out_time, notes, start_dt, end_dt)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, session_rows)

            # 🆕 تخصيص الأيام/الخطوط للمشارك (متعدد) — أي مهمة لها مجموعات:
            #    المشارك يرث ساعات المجموعة المخصصة. (لا يُقيَّد بالتصنيف — المحرك موحّد)
            day_rows = []
            for pid, part in inserted_participants:
                for day_title in (part.assigned_days or []):
                    day_rows.append((pid, mission_id, day_title))
            if day_rows:
                cursor.executemany("""
                    INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group)
                    VALUES (%s, %s, %s)
                """, day_rows)
            # 🆕 اتساق الحالة الآلية مع الرادار: مشارك كل فتراته مغلقة ⇒ انتهت مهمته
            for pid, part in inserted_participants:
                periods = part.participation_periods or []
                if periods and all(per.check_out_time for per in periods):
                    cursor.execute("""
                        UPDATE mission_participants SET return_status = 'تم انتهاء مهمتة'
                        WHERE participant_id = %s
                    """, (pid,))

            # 🆕 اشتقاق شرائح المشاركة من كتالوج الانضمام/الانفصال (Draft فقط —
            #    عند الخروج من المسودة تُجمَّد الفترات ولا يُعاد حسابها). يُستدعى قبل
            #    حظر الإغلاق التلقائي حتى يُغلق الأخير أي segment مفتوح لمهمة مكتملة.
            if mission.status == 'Draft':
                materialize_jl_segments(
                    cursor, mission_id, {'mission_name': mission.mission_name},
                    user_id=user_id,
                )

            # ── الإغلاق التلقائي عند الإنشاء المباشر كمهمة منتهية (حالة نادرة) ──
            #    نفس قاعدة update_mission: أي segment مفتوح لمشاركي مهمة Completed يُغلق
            #    في لحظة انتهاء المهمة (completion → arrival) — لا يبقى حضور مفتوح فيها.
            if mission.status in ('Completed', 'مكتملة'):
                comp_dt = mission_end_dt({
                    'completion_date': mission.completion_date,
                    'arrival_date': mission.arrival_date,
                    'completion_time': mission.completion_time,
                    'arrival_time': mission.arrival_time,
                })
                if not comp_dt and (mission.departure_date or mission.arrival_date):
                    comp_dt = dt_from_parts(
                        mission.departure_date or mission.arrival_date,
                        mission.completion_time or mission.arrival_time or '00:00'
                    )
                if comp_dt:
                    cursor.execute("""
                        UPDATE mission_participant_sessions
                        SET end_dt = %s, check_out_time = %s
                        WHERE participant_id IN (
                                SELECT participant_id FROM mission_participants WHERE mission_id = %s
                            )
                          AND end_dt IS NULL
                    """, (comp_dt, comp_dt.strftime('%H:%M'), mission_id))

            for ben in mission.beneficiaries:
                cursor.execute("INSERT INTO mission_beneficiaries (mission_id, category_name, direct_count, indirect_count) VALUES (%s, %s, %s, %s);", (mission_id, ben.category_name, ben.direct_count, ben.indirect_count))

            for staff in mission.eoc_staff:
                cursor.execute("INSERT INTO mission_eoc_staff (mission_id, role_name, staff_name) VALUES (%s, %s, %s);", (mission_id, staff.role_name, staff.staff_name))

            # 💡 تسجيل اللوج
            try:
                create_audit_log(cursor, user_id, "إنشاء مهمة", mission_id=mission_id, entity_type="mission", entity_id=mission_id, details={"action_text": f"قام بإنشاء استمارة جديدة بكود: {mission_code}"})
            except Exception as e:
                print(f"Audit Error: {e}")

            # 💡 إشعار المتطوعين المشاركين المربوطين بحسابات دخول (بالـ user_id لا الأسماء)
            if participant_user_ids:
                try:
                    notify_participant_accounts(cursor, mission_id, mission.mission_name, user_id, participant_user_ids)
                except Exception as e:
                    print(f"Participant notify error: {e}")

            connection.commit()
            return {"message": "تم حفظ المهمة بنجاح", "mission_code": mission_code, "mission_id": mission_id}
            
    except Exception as e:
        connection.rollback()
        # ✅ Fix: throw says "مسجّل" but old catch looked for "متواجد" — different word.
        #    Now catches both forms so the intended 400 isn't lost to 500.
        err = str(e)
        if "مسجّل حالياً في مهمة نشطة أخرى" in err or "متواجد حالياً في مهمة نشطة أخرى" in err:
            raise HTTPException(status_code=400, detail=err)
        if ikey and "idempotency_key" in err and ("unique" in err.lower() or "duplicate" in err.lower()):
            try:
                with connection.cursor() as cursor2:
                    cursor2.execute("SELECT mission_id, mission_code FROM missions WHERE idempotency_key = %s;", (ikey,))
                    existing = cursor2.fetchone()
                    if existing:
                        return {"message": "تم حفظ المهمة بنجاح", "mission_code": existing[1], "mission_id": existing[0]}
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=err)
    finally:
        connection.close()

@app.put("/api/missions/{mission_id}")
def update_mission(
    mission_id: int,
    mission: MissionCreate,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    idempotency_key_header: Optional[str] = Header(None),
):
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    # 🆕 بوابة المالك — تعديل «تاريخ/وقت إنشاء المهمة» متاح لهم فقط (403 لغيرهم)
    role = get_user_role(user_id)
    is_owner = bool(role) and role["role_name"].upper() in ["OWNER", "المالك"]
    # مفتاح الحماية من الإرسال المكرر — يُقرأ من الترويسة أولاً (الواجهة ترسله في الـ header)؛
    # يعمل جنباً إلى جنب مع مفتاح المهمة المخزَّن في قاعدة البيانات (DB هو مصدر الحقيقة).
    ikey = mission.idempotency_key or idempotency_key_header or None

    # 🛡️ الحقول الإلزامية + قاعدة الإنهاء — تُفرض في السيرفر قبل أي PROCESS للطلب
    missing_required = validate_mission_required_fields(mission)
    if missing_required:
        raise HTTPException(status_code=400, detail="الحقول الإلزامية التالية مطلوبة: " + "،".join(missing_required))
    completion_error = validate_mission_completion(mission)
    if completion_error:
        raise HTTPException(status_code=400, detail=completion_error)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            def none_if_empty(val): return val if val != "" else None

            # 🛡️ منع الإرسال المكرر (double-submit / إعادة المحاولة): لو نفس الطلب
            # بنفس المفتاح اتعمل فعلاً من قبل على نفس الاستمارة، بنرجع نجاح فوراً
            # من غير ما ننفذ أي mutation ثانية (بدون تكرار المشاركين/الإشعارات/اللوج).
            if ikey:
                cursor.execute(
                    "SELECT 1 FROM missions WHERE mission_id = %s AND idempotency_key = %s;",
                    (mission_id, ikey)
                )
                if cursor.fetchone():
                    return {"message": "تم تحديث المهمة بنجاح"}

            # 🆕 تاريخ/وقت الإنشاء: لقطة ثابتة لا تتجدد أبداً — «تغيير القيمة» فعل مالك
            #    فقط (403 لغير المالك). إعادة إرسال نفس القيمة من غير المالك = ليس تغييراً.
            cur_db_cd = None
            cd_row = cursor.execute("SELECT creation_datetime FROM missions WHERE mission_id = %s", (mission_id,)).fetchone()
            if cd_row:
                cur_db_cd = cd_row[0]
            req_cd = parse_dt_input(mission.creation_datetime) if mission.creation_datetime else None
            cd_change = bool(req_cd) and (cur_db_cd is None or req_cd != cur_db_cd)
            cd_value = None  # COALESCE يحافظ على القديم لو لم يُطلب تغيير
            if cd_change:
                if not is_owner:
                    raise HTTPException(status_code=403, detail="تعديل تاريخ إنشاء المهمة متاح للمالك فقط")
                cd_value = req_cd

            # 1. تحديث البيانات الأساسية (بدون تغيير كود المهمة غير المُدخل)
            cursor.execute("""
                UPDATE missions SET
                    mission_name=%s, mission_classification=%s, branch_id=%s, mission_type=%s, mission_location=%s,
                    responsible_person=%s, data_source=%s, status=%s, exit_date=%s, departure_date=%s,
                    arrival_date=%s, return_date=%s, completion_date=%s, start_time=%s, departure_time=%s,
                    arrival_time=%s, completion_time=%s, injured_count=%s, indirect_beneficiaries_total=%s,
                    notes=%s, internal_notes=%s,
                    team_code=%s,
                    idempotency_key = COALESCE(%s, idempotency_key),
                    mission_code = COALESCE(%s, mission_code),
                    creation_datetime = COALESCE(%s, creation_datetime)
                    -- 💡 (متطلب #4) لم نعد نكتب فوق created_at: يبقى التاريخ الفعلي للتسجيل في السيرفر
                    -- (كان بيتحصّل لوقت منتصف الليل 00:00 عند أي تعديل فيفتقد الوقت الحقيقي)
                    -- 🆕 creation_datetime = لقطة إنشاء ثابتة؛ تُستبدل فقط بتغيير مالك (cd_value)
                WHERE mission_id=%s;
            """, (
                mission.mission_name, mission.mission_classification, mission.branch_id, mission.mission_type, mission.mission_location,
                mission.responsible_person, mission.data_source, mission.status,
                none_if_empty(mission.exit_date), none_if_empty(mission.departure_date), none_if_empty(mission.arrival_date),
                none_if_empty(mission.return_date), none_if_empty(mission.completion_date),
                none_if_empty(mission.start_time), none_if_empty(mission.departure_time), none_if_empty(mission.arrival_time),
                none_if_empty(mission.completion_time),
                mission.injured_count, mission.indirect_beneficiaries_total, mission.notes, mission.internal_notes,
                mission.team_code if mission.team_code is not None else "",
                ikey,
                none_if_empty(mission.mission_code),
                cd_value,
                mission_id
            ))
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="المهمة غير موجودة أو تم حذفها")

            # 🆕 سجل أمني عند تعديل المالك لتاريخ الإنشاء (لا يُسجَّل لأي إعادة إرسال مطابقة)
            if cd_change and is_owner:
                try:
                    create_audit_log(
                        cursor, user_id, "تعديل تاريخ الإنشاء", mission_id=mission_id,
                        entity_type="mission", entity_id=mission_id,
                        details={"action_text": f"تعديل تاريخ إنشاء المهمة من {fmt_dt(cur_db_cd) if cur_db_cd else '—'} إلى {fmt_dt(cd_value)}"},
                    )
                except Exception as e:
                    print(f"Audit Error: {e}")

            # 2. مسح التفاصيل القديمة (عشان منعملش تكرار) — مع حفظ استثنائي:
            #    المشاركون أُزيلوا من الاستمارة لكن لهم segments مسجلة (شاركوا فعلاً)
            #    لا يُحذفون نهائياً: يبقى سجلهم للرادار والـ HR، ويُخفَون من الاستمارة
            #    عبر roster_active=false. الـ segments نفسها (mission_participant_sessions)
            #    لا تُمسح هنا أبداً — التاريخ المُسجَّل ملك /join و/leave وحدهما.
            # ── snapshot المشاركين الحاليين: المشارك + هويته + هل له segments ──
            existing_participants = {}
            cursor.execute("""
                SELECT p.participant_id, p.participant_type, p.full_name, p.participation_role,
                       p.membership_number, p.branch_id, p.assigned_itinerary, p.return_status,
                       p.phase_name, p.stay_type, p.team_name, p.team_code, p.user_id,
                       EXISTS(SELECT 1 FROM mission_participant_sessions s
                              WHERE s.participant_id = p.participant_id) AS has_segments
                FROM mission_participants p
                WHERE p.mission_id = %s
                ORDER BY p.participant_id DESC;
            """, (mission_id,))
            for (pid, ptype, fname, prole, mnum, bid, itin, rstatus, phase, stay, tname, tcode, puser_id, has_seg) in cursor.fetchall():
                mkey = (mnum or '').strip().lower() if (mnum or '').strip() else (fname or '').strip().lower()
                if not mkey:
                    continue
                ident = (str(bid or ''), mkey)
                if ident in existing_participants:
                    continue  # أقدم صف لنفس الهوية داخل نفس المهمة — نأخذ أحدثه كمصدر
                existing_participants[ident] = {
                    "participant_id": pid, "has_segments": bool(has_seg),
                    "phase_name": phase, "stay_type": stay, "team_name": tname or '', "team_code": tcode or '',
                    "user_id": puser_id, "return_status": rstatus,
                }

            # مسح التفاصيل غير المسجلة (يعاد إدخالها تالياً) — لا تُمسح الـ segments
            cursor.execute("DELETE FROM mission_itineraries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_vehicles WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_participant_itineraries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_beneficiaries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_eoc_staff WHERE mission_id = %s", (mission_id,))

            # 3. إدخال التفاصيل الجديدة بعد التعديل
            for route in mission.routes:
                cursor.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_from, route_to, departure_time, arrival_time, departure_date, arrival_date) VALUES (%s, %s, %s, %s, %s, %s, %s, %s);", (mission_id, route.group_title, none_if_empty(route.route_from), route.route_to, none_if_empty(route.departure_time), none_if_empty(route.arrival_time), none_if_empty(route.departure_date), none_if_empty(route.arrival_date)))

            for vehicle in mission.vehicles:
                cursor.execute("INSERT INTO mission_vehicles (mission_id, driver_name, vehicle_number) VALUES (%s, %s, %s);", (mission_id, vehicle.driver_name, vehicle.vehicle_number))

            # 🆕 كتالوج الانضمام/الانفصال: upsert في مكانه (يُحافَظ على entry_id =
            #    provenance ثابت للشرائح المشتقة)، وحذف ما لم يُرسَل بتنظيف صريح.
            _sync_jl_catalog(cursor, mission_id, mission.join_leave_entries)

            # المشاركون: UPsert بالهوية — من بقي يُحدَّث في مكانه (تبقى segments المسجلة كما هي)،
            #   ومن أُزيل بلا segments يُحذف نهائياً، ومن أُزيل وله segments يُخفى (roster_active=false).
            participant_user_ids = []
            reinserted_idents = set()
            kept_pids = []
            new_participants = []  # (participant_id, part) for day linking
            for part in dedupe_participants(mission.participants):
                if mission.status in ['Completed', 'مكتملة']:
                    part.return_status = 'تم انتهاء مهمتة'

                # الهوية الفعلية (الـ DB هي مصدر الحقيقة) + رادار المنع بالهوية المركّبة
                # (رقم العضوية + الفرع). نستثني المهمة الحالية من الرادار: الـ PUT يحدّث
                # المشارك في مكانه (لا يحذفه قبلاً كما في السابق) فيجب ألا يصرّعه الرادار بنفسه.
                volunteer_id, participant_user_id, membership, active_in_other, active_in_other_branch = resolve_participant_identity(cursor, part, exclude_mission_id=mission_id)
                if participant_user_id:
                    participant_user_ids.append(participant_user_id)

                mkey = membership.strip().lower() if (membership or '').strip() else (part.full_name or '').strip().lower()
                ident = (str(part.branch_id or ''), mkey) if mkey else None
                if ident:
                    reinserted_idents.add(ident)

                if active_in_other is not None:
                    raise Exception(f"المشارك '{part.full_name}' (رقم العضوية {membership} — فرع {active_in_other_branch}) غير قابل للإضافة أو التحديث: رقم العضوية + الفرع مسجَّل حالياً في مهمة نشطة أخرى ({active_in_other}).\n\nيجب تسجيل عودته في تلك المهمة أولاً (عاد للقاعدة).")

                # ── استعادة الحقول التي لا تعرضها/لا تُدارُ من الاستمارة (مصدر الحقيقة):
                #    لو نفس الشخص موجود قبل التعديل بنفس الهوية، نحافظ على بياناته القائمة
                #    إلا إذا غيّر المدخل القيمة فعلاً (القيمة غير الفارغة/الافتراضية تفوز).
                prev = existing_participants.get(ident) if ident else None
                if prev:
                    if (mission.mission_classification or '') != 'مفتوحة':
                        if part.phase_name in (None, '', 'اليوم الأول'):
                            part.phase_name = prev.get("phase_name") or part.phase_name
                        if part.stay_type in (None, '', 'ذهاب وعودة'):
                            part.stay_type = prev.get("stay_type") or part.stay_type
                    part.team_name = part.team_name or prev.get("team_name") or ''
                    part.team_code = part.team_code or prev.get("team_code") or ''
                    # الحالة الفعلية مصدرها قاعدة البيانات — النموذج لا يتجاوزها أبداً.
                    # عند إنهاء المهمة: «تم انتهاء مهمتة» تبقى الفائزة — لا نعيد إرث
                    # 'مازال بالمهمة' القديم (الشرائح أُغلقت تلقائياً في لقطة الإنهاء أدناه).
                    # كان الشرط السابق يطلب has_segments فحسب: لو لا segments (مشارك نُقل
                    # للاستمارة فقط دون انضمام فعلي) كانت return_status تُستعاد من الـ
                    # Pydantic default ≠ الـ DB → يصبح Participant عالقاً بـ 'مازال بالمهمة'.
                    if mission.status not in ('Completed', 'مكتملة'):
                        part.return_status = prev.get("return_status") or part.return_status

                if prev:
                    # تحديث في مكانه — يُحافَظ على participant_id فتبقى segments المسجلة كما هي
                    cursor.execute("""
                        UPDATE mission_participants SET
                            participant_type=%s, full_name=%s, team_name=%s, team_code=%s,
                            participation_role=%s, participant_position=%s, volunteer_id=%s, user_id=%s,
                            membership_number=%s, branch_id=%s, assigned_itinerary=%s, return_status=%s,
                            phase_name=%s, stay_type=%s, start_from_mission=%s, roster_active=true
                        WHERE participant_id=%s;
                    """, (part.participant_type, part.full_name, part.team_name or '', part.team_code or '',
                          part.participation_role, part.participant_position or '', volunteer_id, participant_user_id,
                          membership, part.branch_id, part.assigned_itinerary, part.return_status,
                          part.phase_name, part.stay_type, (part.start_from_mission is not False),
                          prev["participant_id"]))
                    pid = prev["participant_id"]
                else:
                    cursor.execute("""
                        INSERT INTO mission_participants (mission_id, participant_type, full_name, team_name, team_code, participation_role, participant_position, volunteer_id, user_id, membership_number, branch_id, assigned_itinerary, return_status, phase_name, stay_type, roster_active, start_from_mission)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, %s)
                        RETURNING participant_id;
                    """, (mission_id, part.participant_type, part.full_name, part.team_name or '', part.team_code or '',
                          part.participation_role, part.participant_position or '', volunteer_id, participant_user_id,
                          membership, part.branch_id, part.assigned_itinerary, part.return_status,
                          part.phase_name, part.stay_type, (part.start_from_mission is not False)))
                    pid = cursor.fetchone()[0]
                kept_pids.append(pid)
                new_participants.append((pid, part))

            # ── من أُزيلوا من الاستمارة:
            #    بلا segments ⇒ حذف نهائي؛ وله segments ⇒ يُخفى ويبقى سجله للرادار والـ HR
            stale_ids = [v["participant_id"] for v in existing_participants.values()
                         if v["participant_id"] not in kept_pids and not v.get("has_segments")]
            if stale_ids:
                cursor.execute("DELETE FROM mission_participants WHERE participant_id = ANY(%s)", (stale_ids,))
            if kept_pids:
                cursor.execute("""
                    UPDATE mission_participants SET roster_active = false
                    WHERE mission_id = %s AND roster_active = true
                      AND participant_id <> ALL(%s);
                """, (mission_id, kept_pids))

            # 🆕 تخصيص الأيام/الخطوط للمشارك (متعدد) — أي مهمة لها مجموعات:
            #    المشارك يرث ساعات المجموعة المخصصة. (لا يُقيَّد بالتصنيف — المحرك موحّد)
            day_rows = []
            for pid, part in new_participants:
                for day_title in (part.assigned_days or []):
                    day_rows.append((pid, mission_id, day_title))
            if day_rows:
                cursor.executemany("""
                    INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group)
                    VALUES (%s, %s, %s)
                """, day_rows)

            # 🆕 إعادة اشتقاق شرائح المشاركة من كتالوج الانضمام/الانفصال (Draft فقط —
            #    عند الخروج من المسودة تُجمَّد الفترات ولا يُعاد حسابها). يُستدعى قبل
            #    حظر الإغلاق التلقائي حتى يُغلق الأخير أي segment مشتقّ مفتوح لمهمة مكتملة.
            if mission.status == 'Draft':
                materialize_jl_segments(
                    cursor, mission_id, _jl_mission_row(cursor, mission_id),
                    user_id=user_id,
                )

            # ── الإغلاق التلقائي للمشاركة عند انتهاء المهمة (متطلب حتمي، حل جذري) ──
            #    عند تحويل المهمة إلى 'Completed' كان أي حضور مسجَّل عبر JOIN (segment
            #    بلا end_dt) يبقى مفتوحاً في قاعدة البيانات — الحساب يُظهره مقصوراً على
            #    نهاية المهمة، لكن الصف الفعلي يبقى مفتوحاً إلى الأبد، فيتناقض مع متطلب
            #    "تنتهي المهمة وتنغلق المشاركة النشطة تلقائياً" ويترك سجلاً مفتوحاً داخل
            #    مهمة منتهية. الحل: نُغلق فعلياً كل segment مفتوح لمشاركي هذه المهمة في
            #    لحظة انتهاء المهمة (completion → arrival — نفس نافذة mission_end_dt).
            #    الحارس `end_dt IS NULL` يجعله آمناً/idempotent: لا يمس عودة مسجَّلة مسبقاً.
            #    (لو لم يصل الـ _completion_fields بسبب وضع قديم، نتراجع لـ departure_date —
            #    نفس قاعدة COALESCE في تقرير الـ HR.)
            if mission.status in ('Completed', 'مكتملة'):
                comp_dt = mission_end_dt({
                    'completion_date': mission.completion_date,
                    'arrival_date': mission.arrival_date,
                    'completion_time': mission.completion_time,
                    'arrival_time': mission.arrival_time,
                })
                if not comp_dt and (mission.departure_date or mission.arrival_date):
                    comp_dt = dt_from_parts(
                        mission.departure_date or mission.arrival_date,
                        mission.completion_time or mission.arrival_time or '00:00'
                    )
                if comp_dt:
                    cursor.execute("""
                        UPDATE mission_participant_sessions
                        SET end_dt = %s, check_out_time = %s
                        WHERE participant_id IN (
                                SELECT participant_id FROM mission_participants WHERE mission_id = %s
                            )
                          AND end_dt IS NULL
                    """, (comp_dt, comp_dt.strftime('%H:%M'), mission_id))

            for ben in mission.beneficiaries:
                cursor.execute("INSERT INTO mission_beneficiaries (mission_id, category_name, direct_count, indirect_count) VALUES (%s, %s, %s, %s);", (mission_id, ben.category_name, ben.direct_count, ben.indirect_count))

            for staff in mission.eoc_staff:
                cursor.execute("INSERT INTO mission_eoc_staff (mission_id, role_name, staff_name) VALUES (%s, %s, %s);", (mission_id, staff.role_name, staff.staff_name))

            # 💡 تسجيل اللوج
            try:
                create_audit_log(cursor, user_id, "تحديث/مراجعة", mission_id=mission_id, entity_type="mission", entity_id=mission_id, details={"action_text": f"قام بتحديث الاستمارة أو تغيير حالتها إلى: {mission.status}"})
            except Exception as e:
                print(f"Audit Error: {e}")

            # إشعار المتطوعين المربوطين بحسابات: من أُبقوا + من أُزيلوا من الاستمارة
            try:
                notify_participant_accounts(cursor, mission_id, mission.mission_name, user_id, participant_user_ids)
                # من أُزيلوا فعلاً: أي مشارك لم يَعُد ضمن القائمة الجديدة ولم يبقَ مُعاد
                # إدخاله. نستبعد صراحةً من أبقيناهم (بيانات snapshot قد تختلف مفتاحاً
                # لو تغيّر trim/case بين الإدخالين) حتى لا يصله إشعار مزدوج ("أُبقيت"
                # و"أُزيلت") لنفس التحديث.
                kept_user_ids = set(participant_user_ids)
                removed_user_ids = [
                    (v.get("user_id") or 0) for ident, v in existing_participants.items()
                    if ident not in reinserted_idents and v.get("user_id") and v.get("user_id") not in kept_user_ids
                ]
                notify_participant_accounts(cursor, mission_id, mission.mission_name, user_id, removed_user_ids)
            except Exception as e:
                print(f"Participant notify error: {e}")

            connection.commit()
            return {"message": "تم تحديث المهمة بنجاح"}
            
    except HTTPException:
        # 🚨 بوابة المالك وأي HTTPException مقصودة (400/403/404) تُمرَّر كما هي —
        #    لا تُبتلع في فخ `except Exception` (كانت تحوّل 403 إلى 500).
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        # ✅ Same radar-exception mismatch fix as create_mission: "مسجّل" vs "متواجد"
        err = str(e)
        if "مسجّل حالياً في مهمة نشطة أخرى" in err or "متواجد حالياً في مهمة نشطة أخرى" in err:
            raise HTTPException(status_code=400, detail=err)
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء التحديث: {err}")
    finally:
        connection.close()

class EndParticipationRequest(BaseModel):
    """إنهاء مشاركة واحد أو أكثر (bulk) — مهمات مفتوحة/نشطة."""
    participant_ids: List[int] = []
    client_now: Optional[str] = None  # ساعة العميل المحلية — إطار زمني لإنهاء المشاركة

@app.post("/api/missions/{mission_id}/end-participation")
def end_participation(
    mission_id: int,
    data: EndParticipationRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    "إنهاء المشاركة الآن" (فردي أو جماعي):
    - تسجيل العودة return_status = 'تم انتهاء مهمتة' (يحرر المتطوع من رادار المنع)
    - غلق أي فترة مفتوحة بلا check_out بالوقت الحالي
    - لو المشارك بلا فترات، يُسجَّل له سطر إنهاء موثق (إغلاق اليوم/العملية)
    """
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    ids = list(dict.fromkeys(data.participant_ids or []))  # إزالة التكرار مع حفظ الترتيب
    if not ids:
        raise HTTPException(status_code=400, detail="لم يتم اختيار أي مشارك")
    now_ref = parse_dt_input(data.client_now) if data.client_now else datetime.now()

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT mission_name, departure_time FROM missions WHERE mission_id = %s", (mission_id,))
            mrow = cursor.fetchone()
            if not mrow:
                raise HTTPException(status_code=404, detail="المهمة غير موجودة")
            mission_name, departure_time = mrow[0], mrow[1]

            # قصره على مشاركين فعليين في هذه المهمة فقط
            cursor.execute(
                "SELECT participant_id FROM mission_participants WHERE mission_id = %s AND participant_id = ANY(%s)",
                (mission_id, ids),
            )
            valid_ids = [row[0] for row in cursor.fetchall()]
            if not valid_ids:
                raise HTTPException(status_code=404, detail="لا يوجد مشاركون صالحون في هذه المهمة")

            for pid in valid_ids:
                # 1. تسجيل العودة (يحرر من الرادار)
                cursor.execute(
                    "UPDATE mission_participants SET return_status = 'تم انتهاء مهمتة' WHERE participant_id = %s",
                    (pid,),
                )
                # 2. غلق أي فترة مفتوحة (بلا end_dt) عند زمن الإنهاء — يُغلق end_dt أيضاً
                #    (وليس check_out_time فقط) حتى تتوقف ساعات «المباشر» عن النمو بعد الإنهاء،
                #    وهو ما تطبقه حسابات الساعات (start_dt..end_dt) في الواجهة والقوة البشرية.
                cursor.execute(
                    "UPDATE mission_participant_sessions SET check_out_time = %s::time, end_dt = %s::timestamp WHERE participant_id = %s AND end_dt IS NULL",
                    (now_ref.time(), now_ref, pid),
                )
                # 3. لو بلا فترات: سطر توثيق للإنهاء (تسجيل معلومة الحضور/الخروج)
                cursor.execute(
                    "SELECT 1 FROM mission_participant_sessions WHERE participant_id = %s LIMIT 1",
                    (pid,),
                )
                if not cursor.fetchone():
                    cursor.execute(
                        """INSERT INTO mission_participant_sessions
                           (participant_id, mission_id, session_date, check_in_time, check_out_time, notes)
                           VALUES (%s, %s, CURRENT_DATE, %s, CURRENT_TIME, 'إنهاء المشاركة')""",
                        (pid, mission_id, departure_time),
                    )

            try:
                create_audit_log(
                    cursor, user_id, "إنهاء مشاركة", mission_id=mission_id,
                    entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"إنهاء مشاركة {len(valid_ids)} مشارك في المهمة: {mission_name}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"updated": valid_ids, "mission_id": mission_id}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء إنهاء المشاركة: {str(e)}")
    finally:
        connection.close()


@app.post("/api/missions/{mission_id}/join")
def mission_join(
    mission_id: int,
    data: JoinRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """🔒 legacy-only (بعد إعادة تصميم الانضمام/الانفصال): المسار القديم للأزرار
    الفردية لم يعد يُستخدم للتسجيل الجديد. المشاركة تُدار الآن حصراً من قسم
    «انضمام / انفصال» عبر كتالوج mission_join_leave_entries + الإسناد للخطوط
    (يُشتق في المسودة ويُجمّد بعدها). السجلات القديمة بلا وسوم تاريخ للقراءة فقط.
    يُحافَظ بجسم هذه الدالة التاريخي أدناه كمرجع — غير قابل للوصول."""
    raise HTTPException(
        status_code=405,
        detail="زر الانضمام القديم لم يعد متاحاً — تُدار المشاركة من قسم «انضمام / انفصال» الجديد.",
    )
    # ---- (محتوى تاريخي غير قابل للوصول — محفوظ كمرجع) ----
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # المهمة نفسها
            cursor.execute("SELECT mission_name, mission_classification, status FROM missions WHERE mission_id = %s", (mission_id,))
            mrow = cursor.fetchone()
            if not mrow:
                raise HTTPException(status_code=404, detail="المهمة غير موجودة")
            mission_name, classification, m_status = mrow[0], mrow[1] or 'عادية', mrow[2]

            # المشارك فعلياً في هذه المهمة (الرستر لا يشمل المُخفَين للتواريخ فقط)
            cursor.execute(
                "SELECT participant_id, full_name FROM mission_participants WHERE mission_id = %s AND participant_id = %s AND roster_active = true",
                (mission_id, data.participant_id),
            )
            prow = cursor.fetchone()
            if not prow:
                raise HTTPException(status_code=404, detail="المشارك غير موجود ضمن مهمة نشطة")
            participant_name = prow[1]

            join_dt = parse_dt_input(data.join_datetime)
            if not join_dt:
                raise HTTPException(status_code=400, detail="زمن الانضمام غير صالح (الصيغة المتوقعة: YYYY-MM-DD HH:MM)")
            # fix #3: التحقق من المستقبل يتم مقابل ساعة العميل المحلية (نفس إطار البيانات)
            # لا ضد ساعة السيرفر — وإلا يُرفض زمن ماضٍ محلياً كأنه في المستقبل عند اختلاف المنطقة.
            now_ref = parse_dt_input(data.client_now) or datetime.now()
            validate_segment_datetime(join_dt, now=now_ref)

            # تحقق اليوم/المجموعة — اختياري تماماً (لا إجبار)
            #   لو أُرسل اليوم → يجب أن يكون ضمن تخصيصات المشارك؛
            #   وإلا → بدون مجموعة (خط السير الأساسي/العام)
            itinerary_group = None
            if data.itinerary_group:
                cursor.execute(
                    "SELECT 1 FROM mission_participant_itineraries WHERE participant_id = %s AND itinerary_group = %s",
                    (data.participant_id, data.itinerary_group),
                )
                if not cursor.fetchone():
                    raise HTTPException(status_code=400, detail="خط السير المختار غير مخصص لهذا المشارك")
                itinerary_group = data.itinerary_group
            # لا يوجد else — itinerary_group يبقى None إذا لم يُرسل

            # منع التكرار: لا تُفتح جلستان مفتوحتان لنفس المشارك/اليوم
            if itinerary_group:
                cursor.execute(
                    "SELECT 1 FROM mission_participant_sessions WHERE participant_id = %s AND itinerary_group = %s AND end_dt IS NULL",
                    (data.participant_id, itinerary_group),
                )
            else:
                cursor.execute(
                    "SELECT 1 FROM mission_participant_sessions WHERE participant_id = %s AND end_dt IS NULL",
                    (data.participant_id,),
                )
            if cursor.fetchone():
                connection.commit()
                return {"message": "انضمام مكرر — أُعيدت النتيجة نفسها", "already_joined": True, "participant_id": data.participant_id, "mission_id": mission_id}

            cursor.execute(
                """INSERT INTO mission_participant_sessions
                   (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, itinerary_group, notes)
                   VALUES (%s, %s, %s, %s, %s, NULL, %s, 'انضمام')""",
                (data.participant_id, mission_id, join_dt.date(), join_dt.time(), join_dt, itinerary_group),
            )

            # الحالة → مازال بالمهمة (رادار المنع: موجود في مهمة)
            cursor.execute(
                "UPDATE mission_participants SET return_status = 'مازال بالمهمة' WHERE participant_id = %s",
                (data.participant_id,),
            )

            try:
                create_audit_log(
                    cursor, user_id, "انضمام", mission_id=mission_id,
                    entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"تسجيل انضمام {participant_name}{' — اليوم: ' + itinerary_group if itinerary_group else ''} في {mission_name} عند {data.join_datetime}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")

            # بث لحظي للمعنيين (منعزلة عن المعاملة بمعاملة فرعية — لا تُفسد الحفظ لو فشلت)
            try:
                create_realtime_event(
                    cursor,
                    event_type="mission",
                    action=f"انضمام {participant_name}",
                    actor_user_id=user_id,
                    mission_id=mission_id,
                    details={
                        "action_text": f"{participant_name} انضم{' إلى يوم: ' + itinerary_group if itinerary_group else ''} في {mission_name} عند {data.join_datetime}",
                        "affected": "participant",
                        "mission_name": mission_name,
                    },
                    resolve_creator=True,
                )
            except Exception as e:
                print(f"Realtime Error: {e}")

            connection.commit()
            return {"message": "تم تسجيل الانضمام", "participant_id": data.participant_id, "mission_id": mission_id}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء تسجيل الانضمام: {str(e)}")
    finally:
        connection.close()


@app.post("/api/missions/{mission_id}/leave")
def mission_leave(
    mission_id: int,
    data: LeaveRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """🔒 legacy-only (بعد إعادة تصميم الانضمام/الانفصال): المسار القديم للأزرار
    الفردية لم يعد يُستخدم للتسجيل الجديد. المشاركة تُدار الآن حصراً من قسم
    «انضمام / انفصال» عبر كتالوج + الإسناد (يُشتق في المسودة ويُجمّد بعدها).
    السجلات القديمة بلا وسوم تاريخ للقراءة فقط.
    يُحافَظ بجسم هذه الدالة التاريخي أدناه كمرجع — غير قابل للوصول."""
    raise HTTPException(
        status_code=405,
        detail="زر الانفصال القديم لم يعد متاحاً — تُدار المشاركة من قسم «انضمام / انفصال» الجديد.",
    )
    # ---- (محتوى تاريخي غير قابل للوصول — محفوظ كمرجع) ----
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT * FROM missions WHERE mission_id = %s", (mission_id,))
            mrow = cursor.fetchone()
            if not mrow:
                raise HTTPException(status_code=404, detail="المهمة غير موجودة")
            cols = [d[0] for d in cursor.description]
            mission_row = dict(zip(cols, mrow))
            for k, v in mission_row.items():
                if v is not None and not isinstance(v, (str, int, float, bool)): mission_row[k] = str(v)
            mission_name, classification = mission_row.get('mission_name'), mission_row.get('mission_classification') or 'عادية'

            cursor.execute(
                "SELECT participant_id, full_name, start_from_mission FROM mission_participants WHERE mission_id = %s AND participant_id = %s AND roster_active = true",
                (mission_id, data.participant_id),
            )
            prow = cursor.fetchone()
            if not prow:
                raise HTTPException(status_code=404, detail="المشارك غير موجود ضمن مهمة نشطة")
            participant_name = prow[1]
            start_from_mission_flag = (prow[2] is not False)

            leave_dt = parse_dt_input(data.leave_datetime)
            if not leave_dt:
                raise HTTPException(status_code=400, detail="زمن الانفصال غير صالح (الصيغة المتوقعة: YYYY-MM-DD HH:MM)")
            # fix #3: نفس الإطار المرجعي لساعة العميل (انظر /join).
            now_ref = parse_dt_input(data.client_now) or datetime.now()
            validate_segment_datetime(leave_dt, now=now_ref)

            # تحقق اليوم/المجموعة بناءً على البيانات لا التصنيف (المحرك موحّد):
            # تحقق اليوم/المجموعة — اختياري تماماً (لا إجبار)
            #   لو أُرسل اليوم → يجب أن يكون ضمن تخصيصات المشارك؛
            #   وإلا → بدون مجموعة (خط السير الأساسي/العام)
            itinerary_group = None
            if data.itinerary_group:
                cursor.execute(
                    "SELECT 1 FROM mission_participant_itineraries WHERE participant_id = %s AND itinerary_group = %s",
                    (data.participant_id, data.itinerary_group),
                )
                if not cursor.fetchone():
                    raise HTTPException(status_code=400, detail="خط السير المختار غير مخصص لهذا المشارك")
                itinerary_group = data.itinerary_group
            # لا يوجد else — itinerary_group يبقى None إذا لم يُرسل

            # 1. يوجد segment مفتوح ⇒ نغلقه (لا نُنشئ غيره — لا تكرار)
            if itinerary_group:
                cursor.execute(
                    "SELECT session_id, start_dt FROM mission_participant_sessions "
                    "WHERE participant_id = %s AND itinerary_group = %s AND end_dt IS NULL "
                    "ORDER BY start_dt NULLS LAST LIMIT 1",
                    (data.participant_id, itinerary_group),
                )
            else:
                cursor.execute(
                    "SELECT session_id, start_dt FROM mission_participant_sessions "
                    "WHERE participant_id = %s AND end_dt IS NULL "
                    "ORDER BY start_dt NULLS LAST LIMIT 1",
                    (data.participant_id,),
                )
            open_seg = cursor.fetchone()
            if open_seg:
                cursor.execute(
                    "UPDATE mission_participant_sessions SET end_dt = %s, check_out_time = %s WHERE session_id = %s",
                    (leave_dt, leave_dt.time(), open_seg[0]),
                )
            else:
                # 2. بلا segment مفتوح. fix #2/#3/#5: لا نعيد كتابة/توسيع سجل مغلق.
                #    لو للمشارك أي segments سابقة (غادر فعلاً) ⇒ لا حضور نشط لتسجيل انفصال
                #    ثانٍ — العودة للعمل تتطلب انضماماً جديداً (segment جديد). أما لو لم يُسجَّل
                #    له أي حضور أصلاً (legacy) ⇒ نُنشئ من بداية المشاركة المرجعية حتى الانفصال.
                cursor.execute(
                    "SELECT 1 FROM mission_participant_sessions WHERE participant_id = %s LIMIT 1",
                    (data.participant_id,),
                )
                if cursor.fetchone():
                    raise HTTPException(status_code=400, detail="لا يوجد حضور مفتوح لتسجيل الانفصال — المشارك غير نشط حالياً")
                cursor.execute(
                    "SELECT itinerary_group FROM mission_participant_itineraries WHERE participant_id = %s AND mission_id = %s",
                    (data.participant_id, mission_id),
                )
                assigned_groups = [r[0] for r in cursor.fetchall()]
                ref_start = reference_segment_start(cursor, mission_row, itinerary_group,
                                                    start_from_mission=start_from_mission_flag,
                                                    assigned_groups=assigned_groups)
                if ref_start:
                    cursor.execute(
                        """INSERT INTO mission_participant_sessions
                           (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, itinerary_group, notes)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, 'انفصال (من بداية المشاركة)')""",
                        (data.participant_id, mission_id, ref_start.date(), ref_start.time(), ref_start, leave_dt, itinerary_group),
                    )
                else:
                    # لا بداية معروفة — سجّل drop بنقطة النهاية فقط (ساعات صفرية).
                    # ⚠️ الإصلاح الجذري لـ HTTP 500: كان يُرسل session_date=NULL وكان العمود
                    #    NOT NULL ⇒ v2_enforce_not_null. الآن نُرسل تاريخ الانفصال الحقيقي،
                    #    ويبقى start_dt=NULL حتّى لا يُحسب هذا السجل في الساعات.
                    cursor.execute(
                        """INSERT INTO mission_participant_sessions
                           (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, itinerary_group, notes)
                           VALUES (%s, %s, %s, %s, NULL, %s, %s, 'انفصال')""",
                        (data.participant_id, mission_id, leave_dt.date(), leave_dt.time(), leave_dt, itinerary_group),
                    )

            # الحالة → تم انتهاء مهمتة (يحرر من الرادار)
            cursor.execute(
                "UPDATE mission_participants SET return_status = 'تم انتهاء مهمتة' WHERE participant_id = %s",
                (data.participant_id,),
            )

            try:
                create_audit_log(
                    cursor, user_id, "انفصال", mission_id=mission_id,
                    entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"تسجيل انفصال {participant_name}{' — اليوم: ' + itinerary_group if itinerary_group else ''} في {mission_name} عند {data.leave_datetime}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")

            # بث لحظي للمعنيين (منعزلة عن المعاملة بمعاملة فرعية — لا تُفسد الحفظ لو فشلت)
            try:
                create_realtime_event(
                    cursor,
                    event_type="mission",
                    action=f"انفصال {participant_name}",
                    actor_user_id=user_id,
                    mission_id=mission_id,
                    details={
                        "action_text": f"{participant_name} انفصل{' عن يوم: ' + itinerary_group if itinerary_group else ''} في {mission_name} عند {data.leave_datetime}",
                        "affected": "participant",
                        "mission_name": mission_name,
                    },
                    resolve_creator=True,
                )
            except Exception as e:
                print(f"Realtime Error: {e}")

            connection.commit()
            return {"message": "تم تسجيل الانفصال", "participant_id": data.participant_id, "mission_id": mission_id}
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء تسجيل الانفصال: {str(e)}")
    finally:
        connection.close()


@app.patch("/api/missions/{mission_id}/sessions/{session_id}")
def edit_draft_session(
    mission_id: int,
    session_id: int,
    data: SessionEditRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """تعديل زمن انضمام/انفصال مسجَّل (Draft فقط) — يُحدَّث الشريحة نفسها في مكانها.
    متاح فقط ما دامت المهمة مسودة (Draft): «مسودة المهمة = مسودة المشاركة».
    بمجرد خروج المهمة من المسودة (إرسال عام/مراجعة) يُرفض التعديل — لا يُمس
    التاريخ المُجرى نهائياً. لا حذف + إعادة إنشاء: يُحافَظ على نفس session_id."""
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    if data.action not in ("join", "leave"):
        raise HTTPException(status_code=400, detail="action يجب أن يكون 'join' أو 'leave'")
    new_dt = parse_dt_input(data.dt)
    if not new_dt:
        raise HTTPException(status_code=400, detail="الزمن الجديد غير صالح (الصيغة المتوقعة: YYYY-MM-DD HH:MM)")
    now_ref = parse_dt_input(data.client_now) or datetime.now()
    validate_segment_datetime(new_dt, now=now_ref)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # المهمة يجب أن تكون مسودة — القفل مُعلَّق على الانتقال العام لا على الزر
            cursor.execute("SELECT status FROM missions WHERE mission_id = %s", (mission_id,))
            mrow = cursor.fetchone()
            if not mrow:
                raise HTTPException(status_code=404, detail="المهمة غير موجودة")
            if mrow[0] not in ('Draft',):
                raise HTTPException(status_code=403, detail="لا يمكن تعديل المشاركة بعد خروج المهمة من المسودة — السجل المجرى نهائي")

            # الشريحة تنتمي فعلاً لهذه المهمة/مشارك نشط
            cursor.execute(
                "SELECT s.session_id, s.start_dt, s.end_dt, mp.full_name, s.itinerary_group "
                "FROM mission_participant_sessions s "
                "JOIN mission_participants mp ON mp.participant_id = s.participant_id AND s.mission_id = %s "
                "WHERE s.session_id = %s AND s.mission_id = %s AND mp.roster_active = true",
                (mission_id, session_id, mission_id),
            )
            row = cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="الشريحة غير موجودة ضمن هذه المهمة")
            _sid, _cur_start, _cur_end, participant_name, itinerary_group = row

            if data.action == "join":
                # تحديث زمن الانضمام: start_dt + session_date + check_in_time معاً
                cursor.execute(
                    "UPDATE mission_participant_sessions SET start_dt = %s, session_date = %s, check_in_time = %s WHERE session_id = %s",
                    (new_dt, new_dt.date(), new_dt.time(), session_id),
                )
            else:
                # تحديث زمن الانفصال: end_dt + check_out_time
                cursor.execute(
                    "UPDATE mission_participant_sessions SET end_dt = %s, check_out_time = %s WHERE session_id = %s",
                    (new_dt, new_dt.time(), session_id),
                )

            try:
                create_audit_log(
                    cursor, user_id, "تعديل مشاركة", mission_id=mission_id,
                    entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"تعديل {('انضمام' if data.action == 'join' else 'انفصال')} {participant_name or ''} في مهمة مسودة إلى {data.dt}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم تحديث المشاركة في مكانها", "session_id": session_id, "action": data.action}
    except HTTPException:
        connection.rollback()
        raise  # 400/403/404 تُمرَّر كما هي (لا تُغلَّف إلى 500)
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء تعديل المشاركة: {str(e)}")
    finally:
        connection.close()


@app.delete("/api/missions/{mission_id}/sessions/{session_id}")
def remove_draft_session(
    mission_id: int,
    session_id: int,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """حذف شريحة انضمام/انفصال مسجَّلة (Draft فقط) — يُستخدم عندما يلغي المستخدم أحد
    السجلات المسودة (مثلاً يلغي انضماماً قبل إرسال المهمة). بمجرد خروج المهمة من
    المسودة يُرفض الحذف — السجل المجرى نهائي (immunable)."""
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT status FROM missions WHERE mission_id = %s", (mission_id,))
            mrow = cursor.fetchone()
            if not mrow:
                raise HTTPException(status_code=404, detail="المهمة غير موجودة")
            if mrow[0] not in ('Draft',):
                raise HTTPException(status_code=403, detail="لا يمكن حذف المشاركة بعد خروج المهمة من المسودة — السجل المجرى نهائي")

            cursor.execute("SELECT 1 FROM mission_participant_sessions WHERE session_id = %s AND mission_id = %s", (session_id, mission_id))
            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail="الشريحة غير موجودة ضمن هذه المهمة")

            cursor.execute("DELETE FROM mission_participant_sessions WHERE session_id = %s AND mission_id = %s", (session_id, mission_id))

            try:
                create_audit_log(
                    cursor, user_id, "حذف مشاركة مسودة", mission_id=mission_id,
                    entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"حذف شريحة مشاركة مسودة (session {session_id}) من مهمة {mission_id}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم حذف المشاركة المسودة", "session_id": session_id}
    except HTTPException:
        connection.rollback()
        raise  # 400/403/404 تُمرَّر كما هي (لا تُغلَّف إلى 500)
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء حذف المشاركة: {str(e)}")
    finally:
        connection.close()


# ═══════════════════════════════════════════════════════════════════════════
# سجلات الانضمام/الانفصال (كتالوج) — قسم «انضمام / انفصال» الجديد
# جميعها Draft فقط («مسودة المهمة = مسودة المشاركة»)، والتحقق من المستقبل مقابل
# ساعة العميل، ورفض العنوان المكرر لكل نوع برسالة عربية.
# ═══════════════════════════════════════════════════════════════════════════

def _jl_mission_row(cursor, mission_id):
    """dict المهمة (كل الأعمدة) — لاستخدام mission_row في الاشتقاق/الساعات."""
    cursor.execute("SELECT * FROM missions WHERE mission_id = %s", (mission_id,))
    mrow = cursor.fetchone()
    if not mrow:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة")
    cols = [d[0] for d in cursor.description]
    r = dict(zip(cols, mrow))
    for k, v in r.items():
        if v is not None and not isinstance(v, (str, int, float, bool)):
            r[k] = str(v)
    return r


def _sync_jl_catalog(cursor, mission_id, entries):
    """مزامنة كتالوج الانضمام/الانفصال من نموذج المهمة (create: إدراج الكل؛
    update: upsert مع حذف غير المُرسَل). فحص التكرار شامِل على *المجموعة النهائية*
    (كل ما سيتبقى بعد المزامنة) — إدراجاً وتحديثاً — برسالة عربية واضحة.
    السجلات غير المُرسَلة تُحذف بتنظيف صريح (شرائح مشتقة ← مفتاح إسناد ← سجل الكتالوج)
    بنفس ترتيب DELETE endpoint؛ حارس FK NO ACTION شبكة أمان ضد أي خطأ ترتيب."""
    labels = {'join': 'انضمام', 'leave': 'انفصال'}
    submitted = []
    for ent in entries or []:
        kind = ent.kind
        if kind not in ('join', 'leave'):
            raise HTTPException(status_code=400, detail="kind يجب أن يكون 'join' أو 'leave'")
        title = (ent.title or '').strip()
        if not title:
            raise HTTPException(status_code=400, detail="أدخل عنواناً لسجل الانضمام/الانفصال")
        dtv = parse_dt_input(ent.dt) if ent.dt else None
        if dtv is None:
            raise HTTPException(status_code=400, detail="زمن الانضمام/الانفصال غير صالح (الصيغة المتوقعة: YYYY-MM-DD HH:MM)")
        submitted.append({'entry_id': ent.entry_id, 'title': title, 'kind': kind, 'dt': dtv})

    if not submitted:
        # لا شيء مُرسَل — يبقى (الكتالوج الفارغ) ويُحذف له غيرُه أسفل
        submitted = []

    # قراءة الكتالوج الحالي للمهمة
    cursor.execute(
        "SELECT entry_id, title, kind FROM mission_join_leave_entries WHERE mission_id = %s",
        (mission_id,),
    )
    existing = {r[0]: {'title': r[1], 'kind': r[2]} for r in cursor.fetchall()}

    sub_ids = {s['entry_id'] for s in submitted if s['entry_id'] is not None}

    # رفض أي entry_id في الحمولة لا ينتمي لهذه المهمة (لا تُنشئ حقائق مخفية)
    for s in submitted:
        if s['entry_id'] is not None and s['entry_id'] not in existing:
            raise HTTPException(status_code=400, detail=f"سجل الانضمام/الانفصال رقم {s['entry_id']} غير موجود ضمن هذه المهمة")

    # فحص التكرار على المجموعة النهائية (كل ما سيتبقى بعد المزامنة) — يغطي
    # التكرار داخل الحمولة والتكرار ضد السجلات المُبقاة وتعارض إعادة العنوان.
    seen = {}
    dup_entry = None
    for s in submitted:
        k = (s['kind'], s['title'].strip().lower())
        if k in seen:
            dup_entry = s
            break
        seen[k] = True
    if dup_entry is not None:
        raise HTTPException(status_code=400, detail=f"يوجد بالفعل سجل {labels[dup_entry['kind']]} بنفس العنوان «{dup_entry['title']}» — اختر عنواناً مختلفاً")

    # حذف غير المُرسَل: شرائح مشتقة ← مفتاح الإسناد ← صف الكتالوج (ترتيب FK الآمن)
    for eid, e in existing.items():
        if eid in sub_ids:
            continue
        cursor.execute(
            "DELETE FROM mission_participant_sessions WHERE start_entry_id = %s OR end_entry_id = %s",
            (eid, eid),
        )
        cursor.execute(
            "DELETE FROM mission_participant_itineraries WHERE itinerary_group = %s",
            (jl_key(e['kind'], e['title']),),
        )
        cursor.execute("DELETE FROM mission_join_leave_entries WHERE entry_id = %s", (eid,))

    # upsert: تحديث في مكانه (يُحافَظ على entry_id = provenance stable) أو إدراج جديد
    for s in submitted:
        if s['entry_id'] is not None:
            cursor.execute(
                "UPDATE mission_join_leave_entries SET title = %s, kind = %s, dt = %s WHERE entry_id = %s",
                (s['title'], s['kind'], s['dt'], s['entry_id']),
            )
        else:
            cursor.execute(
                "INSERT INTO mission_join_leave_entries (mission_id, title, kind, dt) VALUES (%s, %s, %s, %s)",
                (mission_id, s['title'], s['kind'], s['dt']),
            )


def _jl_validate(cursor, mission_id, kind, dt_str, client_now):
    """التحقق الموحّد لسجل كتالوج: نوع صالح + زمن غير مستقبلي وعمود Draft."""
    if kind not in ('join', 'leave'):
        raise HTTPException(status_code=400, detail="kind يجب أن يكون 'join' أو 'leave'")
    dtv = parse_dt_input(dt_str)
    if not dtv:
        raise HTTPException(status_code=400, detail="زمن الانضمام/الانفصال غير صالح (الصيغة المتوقعة: YYYY-MM-DD HH:MM)")
    now_ref = parse_dt_input(client_now) or datetime.now()
    validate_segment_datetime(dtv, now=now_ref)
    cursor.execute("SELECT status FROM missions WHERE mission_id = %s", (mission_id,))
    mrow = cursor.fetchone()
    if not mrow:
        raise HTTPException(status_code=404, detail="المهمة غير موجودة")
    if mrow[0] not in ('Draft',):
        raise HTTPException(status_code=403, detail="لا يمكن تعديل الانضمام/الانفصال بعد خروج المهمة من المسودة — السجل المجرى نهائي")
    return dtv


def _jl_dup_guard(cursor, mission_id, title, kind, exclude_id=None):
    """رفض عنوان مكرر لنفس النوع داخل المهمة (رسالة عربية واضحة)."""
    if not title or not str(title).strip():
        raise HTTPException(status_code=400, detail="أدخل عنواناً لسجل الانضمام/الانفصال")
    if exclude_id is not None:
        cursor.execute(
            "SELECT 1 FROM mission_join_leave_entries "
            "WHERE mission_id = %s AND LOWER(TRIM(title)) = LOWER(%s) AND kind = %s "
            "AND entry_id <> %s",
            (mission_id, title.strip(), kind, exclude_id),
        )
    else:
        cursor.execute(
            "SELECT 1 FROM mission_join_leave_entries "
            "WHERE mission_id = %s AND LOWER(TRIM(title)) = LOWER(%s) AND kind = %s",
            (mission_id, title.strip(), kind),
        )
    if cursor.fetchone():
        label = "انضمام" if kind == 'join' else 'انفصال'
        raise HTTPException(status_code=400, detail=f"يوجد بالفعل سجل {label} بنفس العنوان — اختر عنواناً مختلفاً")


@app.post("/api/missions/{mission_id}/join-leave-entries")
def create_join_leave_entry(
    mission_id: int,
    data: JoinLeaveEntryRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """إنشاء سجل كتالوج انضمام/انفصال (Draft فقط). الأزرار دائماً مفتوحة —
    يُمنع فقط إسناد انفصال بلا بدء مشاركة عند الحفظ (requirement E)."""
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            dtv = _jl_validate(cursor, mission_id, data.kind, data.dt, data.client_now)
            _jl_dup_guard(cursor, mission_id, data.title, data.kind)
            cursor.execute(
                "INSERT INTO mission_join_leave_entries (mission_id, title, kind, dt) "
                "VALUES (%s, %s, %s, %s) RETURNING entry_id, title, kind, dt",
                (mission_id, data.title.strip(), data.kind, dtv),
            )
            r = cursor.fetchone()
            try:
                create_audit_log(
                    cursor, user_id, "إنشاء سجل انضمام/انفصال",
                    mission_id=mission_id, entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"إنشاء سجل {'انضمام' if data.kind == 'join' else 'انفصال'} «{data.title.strip()}» في مهمة {mission_id}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")
            connection.commit()
            return {"entry_id": r[0], "title": r[1], "kind": r[2], "dt": fmt_dt(r[3])}
    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء إنشاء سجل الانضمام/الانفصال: {str(e)}")
    finally:
        connection.close()


@app.patch("/api/missions/{mission_id}/join-leave-entries/{entry_id}")
def update_join_leave_entry(
    mission_id: int,
    entry_id: int,
    data: JoinLeaveEntryRequest,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """تعديل سجل كتالوج في مكانه (Draft فقط) مع إعادة توليد الشرائح المشتقة.
    ترتيب المعاملة (حارس ON DELETE NO ACTION):
      1) حذف الشريحة المشتقة لهذا السجل (لو بقي صف يشير إليه فسيرفض FK الحذف).
      2) إعادة تسمية مفاتيح الإسناد إن تغيّر العنوان.
      3) تحديث سجل الكتالوج نفسه.
      4) إعادة الاشتقاق للنُسق الجديد."""
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            dtv = _jl_validate(cursor, mission_id, data.kind, data.dt, data.client_now)
            _jl_dup_guard(cursor, mission_id, data.title, data.kind, exclude_id=entry_id)

            cursor.execute(
                "SELECT title, kind FROM mission_join_leave_entries WHERE entry_id = %s AND mission_id = %s",
                (entry_id, mission_id),
            )
            old = cursor.fetchone()
            if not old:
                raise HTTPException(status_code=404, detail="السجل غير موجود ضمن هذه المهمة")
            old_title, old_kind = old[0], old[1]

            # 1) شريحة مشتقة تُحذف أولاً — يسمح بالحذف الآمن لسجل الكتالوج بعدها
            cursor.execute(
                "DELETE FROM mission_participant_sessions WHERE start_entry_id = %s OR end_entry_id = %s",
                (entry_id, entry_id),
            )

            # 2) إعادة تسمية مفتاح الإسناد (إن تغيّر العنوان)
            new_title = data.title.strip()
            if new_title != old_title:
                cursor.execute(
                    "UPDATE mission_participant_itineraries SET itinerary_group = %s WHERE itinerary_group = %s",
                    (jl_key(old_kind, new_title), jl_key(old_kind, old_title)),
                )

            # 3) تحديث الكتالوج
            cursor.execute(
                "UPDATE mission_join_leave_entries SET title = %s, kind = %s, dt = %s WHERE entry_id = %s",
                (new_title, data.kind, dtv, entry_id),
            )

            # 4) إعادة الاشتقاق (Draft confirmed في _jl_validate)
            if old_kind != data.kind:
                # النوع تغيّر ⇒ مفتاح الإسناد يختلف تماماً: أزل مفتاح النوع القديم
                cursor.execute(
                    "DELETE FROM mission_participant_itineraries WHERE itinerary_group = %s",
                    (jl_key(old_kind, old_title),),
                )
            mission_row = _jl_mission_row(cursor, mission_id)
            materialize_jl_segments(cursor, mission_id, mission_row, user_id=user_id)

            try:
                create_audit_log(
                    cursor, user_id, "تعديل سجل انضمام/انفصال",
                    mission_id=mission_id, entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"تعديل سجل {'انضمام' if data.kind == 'join' else 'انفصال'} «{new_title}» في مهمة {mission_id}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"entry_id": entry_id, "title": new_title, "kind": data.kind, "dt": fmt_dt(dtv)}
    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء تعديل سجل الانضمام/الانفصال: {str(e)}")
    finally:
        connection.close()


@app.delete("/api/missions/{mission_id}/join-leave-entries/{entry_id}")
def delete_join_leave_entry(
    mission_id: int,
    entry_id: int,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """حذف سجل كتالوج (Draft فقط) — تنظيف صريح بالترتيب لضمان حذف الشرائح المشتقة
    والوصلات فقط دون أي تحويل لشرائح موسومة إلى «قديمة»:
      1) حذف الشريحة المشتقة للسجل.
      2) حذف مفتاح الإسناد (JL:*) من خطوط المشاركين.
      3) حذف سجل الكتالوج (FK NO ACTION يحرس الترتيب: لو بقيت شريحة ↦ أُرفض).
      4) إعادة الاشتقاق للمشاركين المتأثرين (تنظيف الحالة المعلّقة)."""
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401)

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT status FROM missions WHERE mission_id = %s", (mission_id,))
            mrow = cursor.fetchone()
            if not mrow:
                raise HTTPException(status_code=404, detail="المهمة غير موجودة")
            if mrow[0] not in ('Draft',):
                raise HTTPException(status_code=403, detail="لا يمكن حذف الانضمام/الانفصال بعد خروج المهمة من المسودة — السجل المجرى نهائي")

            cursor.execute(
                "SELECT title, kind FROM mission_join_leave_entries WHERE entry_id = %s AND mission_id = %s",
                (entry_id, mission_id),
            )
            old = cursor.fetchone()
            if not old:
                raise HTTPException(status_code=404, detail="السجل غير موجود ضمن هذه المهمة")
            title, kind = old[0], old[1]

            # 1) الشرائح المشتقة أولاً (يستحيل أن يتبقى صف يشير إليه)
            cursor.execute(
                "DELETE FROM mission_participant_sessions WHERE start_entry_id = %s OR end_entry_id = %s",
                (entry_id, entry_id),
            )
            # 2) مفاتيح الإسناد
            cursor.execute(
                "DELETE FROM mission_participant_itineraries WHERE itinerary_group = %s",
                (jl_key(kind, title),),
            )
            # 3) سجل الكتالوج — FK NO ACTION يشكّل شبكة أمان ترتيب
            cursor.execute(
                "DELETE FROM mission_join_leave_entries WHERE entry_id = %s AND mission_id = %s",
                (entry_id, mission_id),
            )
            # 4) إعادة الاشتقاق للمشاركين المتأثرين (تنظيف حالة العودة المعلّقة)
            mission_row = _jl_mission_row(cursor, mission_id)
            materialize_jl_segments(cursor, mission_id, mission_row, user_id=user_id)

            try:
                create_audit_log(
                    cursor, user_id, "حذف سجل انضمام/انفصال",
                    mission_id=mission_id, entity_type="mission", entity_id=mission_id,
                    details={"action_text": f"حذف سجل {'انضمام' if kind == 'join' else 'انفصال'} «{title}» من مهمة {mission_id}"},
                )
            except Exception as e:
                print(f"Audit Error: {e}")

            connection.commit()
            return {"message": "تم حذف سجل الانضمام/الانفصال", "entry_id": entry_id}
    except HTTPException:
        connection.rollback()
        raise
    except Exception as e:
        connection.rollback()
        raise HTTPException(status_code=500, detail=f"حدث خطأ أثناء حذف سجل الانضمام/الانفصال: {str(e)}")
    finally:
        connection.close()


@app.get("/api/missions/{mission_id}")
def get_mission_details(mission_id: int, client_now: Optional[str] = None, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """client_now = ساعة العميل المحلية (اختياري) — تُستخدم كإطار زمني للساعات الحية."""
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
            
            cursor.execute("SELECT group_title, route_from, route_to, departure_time, arrival_time, departure_date, arrival_date FROM mission_itineraries WHERE mission_id = %s", (mission_id,))
            mission_data["routes"] = [{"group_title": r[0], "route_from": r[1] or "", "route_to": r[2], "departure_time": str(r[3]) if r[3] else "", "arrival_time": str(r[4]) if r[4] else "", "departure_date": str(r[5]) if r[5] else "", "arrival_date": str(r[6]) if r[6] else ""} for r in cursor.fetchall()]

            cursor.execute("SELECT driver_name, vehicle_number FROM mission_vehicles WHERE mission_id = %s", (mission_id,))
            mission_data["vehicles"] = [{"driver_name": r[0], "vehicle_number": r[1]} for r in cursor.fetchall()]

            # الرستر = المشاركون الظاهرون في الاستمارة فقط (roster_active=true)؛
            # من أُزيليا وله segments يُحفَظ سجله للرادار/HR ولا يظهر هنا.
            cursor.execute("SELECT participant_id, participant_type, full_name, team_name, team_code, participation_role, participant_position, volunteer_id, user_id, membership_number, branch_id, assigned_itinerary, return_status, phase_name, stay_type, start_from_mission FROM mission_participants WHERE mission_id = %s AND roster_active = true ORDER BY participant_id", (mission_id,))
            participant_rows = cursor.fetchall()
            mission_status = mission_data.get("status")
            mission_data["participants"] = []
            for r in participant_rows:
                pid = r[0]
                cursor.execute("SELECT session_id, session_date, check_in_time, check_out_time, notes, start_dt, end_dt, itinerary_group FROM mission_participant_sessions WHERE participant_id = %s ORDER BY COALESCE(start_dt, session_date), start_dt", (pid,))
                segments = []
                for s in cursor.fetchall():
                    segments.append({
                        "session_id": s[0],
                        "session_date": str(s[1]) if s[1] else "",
                        "check_in_time": str(s[2]) if s[2] else "",
                        "check_out_time": str(s[3]) if s[3] else "",
                        "notes": s[4],
                        "start_dt": fmt_dt(s[5]),
                        "end_dt": fmt_dt(s[6]),
                        "itinerary_group": s[7],
                    })
                cursor.execute("SELECT itinerary_group FROM mission_participant_itineraries WHERE participant_id = %s ORDER BY itinerary_group", (pid,))
                assigned_days = [d[0] for d in cursor.fetchall()]
                status = compute_participant_status(mission_status, r[12], segments)
                # 🆕 «يُحسب من بداية المهمة» — القيمة المخزنة (NULL قديم = TRUE افتراضياً)
                start_from_mission = (r[15] is not False)
                # fix #3/#8: الساعات الحية تُحسب مقابل ساعة العميل (نفس إطار start_dt/end_dt)
                now_ref = parse_dt_input(client_now) if client_now is not None else None
                working_hours = compute_working_hours(
                    mission_data, mission_status,
                    segments, assigned_days, mission_data["routes"],
                    now=now_ref, start_from_mission=start_from_mission
                )
                mission_data["participants"].append({
                    "participant_id": pid, "participant_type": r[1], "full_name": r[2], "team_name": r[3], "team_code": r[4],
                    "participation_role": r[5], "participant_position": r[6], "volunteer_id": r[7], "user_id": r[8],
                    "membership_number": r[9], "branch_id": r[10], "assigned_itinerary": r[11], "return_status": r[12],
                    "phase_name": r[13], "stay_type": r[14], "participation_periods": segments,
                    "assigned_days": assigned_days,
                    "start_from_mission": start_from_mission,
                    "status": status,
                    "working_hours": working_hours
                })
            
            cursor.execute("SELECT category_name, direct_count, indirect_count FROM mission_beneficiaries WHERE mission_id = %s", (mission_id,))
            mission_data["beneficiaries"] = [{"category_name": r[0], "direct_count": r[1], "indirect_count": r[2]} for r in cursor.fetchall()]
            
            cursor.execute("SELECT role_name, staff_name FROM mission_eoc_staff WHERE mission_id = %s", (mission_id,))
            mission_data["eoc_staff"] = [{"role_name": r[0], "staff_name": r[1]} for r in cursor.fetchall()]

            # 🆕 سجل الانضمام/الانفصال: كتالوج المهمة (ترتيب تعريض: حسب النوع ثم الزمن)
            cursor.execute(
                "SELECT entry_id, title, kind, dt FROM mission_join_leave_entries "
                "WHERE mission_id = %s ORDER BY kind, dt",
                (mission_id,),
            )
            mission_data["join_leave_entries"] = [
                {"entry_id": r[0], "title": r[1], "kind": r[2], "dt": fmt_dt(r[3])}
                for r in cursor.fetchall()
            ]

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
            cursor.execute("DELETE FROM mission_join_leave_entries")

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
                
            # حذف التفاصيل أولاً لتجنب تعليق records يتيماً (لا FK CASCADE في الـ DB)
            cursor.execute("DELETE FROM mission_participant_sessions WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE mission_id = %s)", (mission_id,))
            cursor.execute("DELETE FROM mission_participant_itineraries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_participants WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_itineraries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_vehicles WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_beneficiaries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_eoc_staff WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM mission_join_leave_entries WHERE mission_id = %s", (mission_id,))
            cursor.execute("DELETE FROM missions WHERE mission_id = %s", (mission_id,))

            # 💡 تسجيل اللوج — نفس نمط بقية endpoints الحذف: نمرّر
            # entity_id فقط (وليس mission_id) حتى لا يرتبك قيد FK لو كان
            # audit_logs.mission_id يشير إلى missions (بعد الحذف لا يوجد الصف
            # فيفشل insert ويضيع اللوج بصمت). اللوج يُسجَّل بعد الحذف بنفس
            # المعاملة، ويسقط أي خطأ في الـ insert وحده دون الرجوع عن الحذف.
            try:
                create_audit_log(cursor, user_id, "حذف مهمة", mission_id=None, entity_type="mission", entity_id=mission_id, details={"action_text": f"قام بحذف الاستمارة رقم {mission_id} نهائياً من النظام"})
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
                SELECT l.audit_id, l.user_id, u.full_name, u.username, l.action, l.details, l.created_at, l.entity_type
                FROM audit_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                ORDER BY l.created_at DESC LIMIT %s OFFSET %s;
            """, (limit, skip))
            rows = cursor.fetchall()
            # 🎯 عرض/جلب الـactor في سجل النظام بشكل سليم (إصلاح "مستخدم محذوف" عند المالك):
            #    - الاسم الرباعي إن وُجد، وإلا نستعين بـ username كبديل.
            #    - لو السجل نفسه بلا user_id (فعل بلا فاعل مسجّل) → "غير محدد"
            #      بدل الوصف المضلِّل "مستخدم محذوف" — دون تغيير أي مستخدم/صلاحية/بيانات.
            def _actor_name(r):
                if r[2]:
                    return r[2]
                if r[3]:
                    return r[3]
                if r[1] is not None:
                    return f"مستخدم #{r[1]}"
                return "غير محدد"
            return [
                {
                    "log_id": r[0], "user_id": r[1], "full_name": _actor_name(r),
                    "action": r[4],
                    "details": r[5].get("action_text", str(r[5])) if isinstance(r[5], dict) else str(r[5] or ""),
                    "created_at": r[6].strftime("%Y-%m-%d %H:%M:%S") if r[6] else "",
                    "entity_type": r[7]
                } for r in rows
            ]
    except Exception as e:
        print(f"Error fetching audit logs: {e}")
        return []
    finally:
        connection.close()

@app.get("/api/live-updates")
def get_live_updates(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    🛡️ نسخة مفتوحة لكل الأدوار (بما فيهم المتطوع) من فيد التحديثات اللحظية.
    سجل النظام الكامل (/api/audit-logs) فاضل مقفول زي ما هو للمالك/المشرف/الجوكر بس.
    لكن المتطوع كان مش بيوصله أي تحديث لحظي خالص (كان بياخد 403) فمكنش بيعرف لما
    الجوكر يرد عليه أو يغير حالة استمارته إلا لو عمل Refresh يدوي للصفحة.
    الإندبوينت ده بيرجع نفس البيانات للأدوار العليا، وبيرجع نسخة مفلترة (مهام/أخبار/كوارث/زلازل/أخبار الذكاء الاصطناعي فقط)
    للمتطوع، من غير ما يشوف حاجة إدارية حساسة (زي تعديلات المستخدمين والصلاحيات).
    """
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)

    role = get_user_role(user_id)
    is_privileged = bool(role) and role["role_name"].upper() in ["OWNER", "MANAGER", "SUPERVISOR", "JOKER", "المالك"]

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            if is_privileged:
                cursor.execute("""
                    SELECT l.audit_id, l.user_id, u.full_name, u.username, l.action, l.details, l.created_at, l.entity_type
                    FROM audit_logs l
                    LEFT JOIN users u ON l.user_id = u.user_id
                    ORDER BY l.created_at DESC LIMIT 50;
                """)
            else:
                cursor.execute("""
                    SELECT l.audit_id, l.user_id, u.full_name, u.username, l.action, l.details, l.created_at, l.entity_type
                    FROM audit_logs l
                    LEFT JOIN users u ON l.user_id = u.user_id
                    WHERE l.entity_type IN ('mission', 'local_news', 'global_disaster', 'earthquake', 'ai_news')
                    ORDER BY l.created_at DESC LIMIT 50;
                """)
            rows = cursor.fetchall()
            # 🎯 نفس تركيب الـ actor السليم اللي في /api/audit-logs — حتى لو user_id = NULL
            # (فعل مسجّل بلا فاعل) نعرض "غير محدد" بدل الوصف المضلِّل "مستخدم محذوف".
            def _actor_name(r):
                if r[2]:
                    return r[2]
                if r[3]:
                    return r[3]
                if r[1] is not None:
                    return f"مستخدم #{r[1]}"
                return "غير محدد"
            return [
                {
                    "log_id": r[0], "user_id": r[1], "full_name": _actor_name(r),
                    "action": r[4],
                    "details": r[5].get("action_text", str(r[5])) if isinstance(r[5], dict) else str(r[5] or ""),
                    "created_at": r[6].strftime("%Y-%m-%d %H:%M:%S") if r[6] else "",
                    "entity_type": r[7]
                } for r in rows
            ]
    except Exception as e:
        print(f"Error fetching live updates: {e}")
        return []
    finally:
        connection.close()


@app.get("/api/realtime/events")
def get_realtime_events(
    after_id: int = 0,
    limit: int = 100,
    init: int = 0,
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    📡 قناة الأحداث اللحظية (متطلب #5)
    Incremental polling بوسم تصاعدي (after_id) بدل ما ننزل كل الـ audit_logs في كل طلب.
    المستلم بيتحدد من الـ backend بالـ user_id:
      - الحدث المخصص (target_user_id) → بيوصله صاحبه حتى لو خارج نطاق فرعه.
      - بث عام → الرتب العليا تشوف الكل، والمتطوع يشوف فقط أنواعه المسموحة
        (والمهام اللي تخص فروع منطقته) مع استبعاد فعله هو (no self-notify).
    init=1 → بيرجع آخر watermark فقط بدون أحداث (لتهيئة العمود من غير إشعارات قديمة).
    """
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id:
        raise HTTPException(status_code=401)

    role = get_user_role(user_id)
    is_privileged = bool(role) and role["role_name"].upper() in [
        "OWNER", "MANAGER", "SUPERVISOR", "JOKER", "OPERATION", "المالك", "مشرف", "جوكر", "أوبريشن",
    ]

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            if init:
                cursor.execute("SELECT COALESCE(MAX(event_id), 0) FROM realtime_events;")
                return {"events": [], "latest_id": cursor.fetchone()[0]}

            if is_privileged:
                cursor.execute(
                    """
                    SELECT e.event_id, e.event_type, e.action, e.actor_user_id,
                           u.full_name, e.mission_id, e.details, e.target_user_id, e.created_at
                    FROM realtime_events e
                    LEFT JOIN users u ON e.actor_user_id = u.user_id
                    WHERE e.event_id > %s
                      AND e.actor_user_id IS DISTINCT FROM %s
                    ORDER BY e.event_id ASC
                    LIMIT %s;
                    """,
                    (after_id, user_id, limit),
                )
            else:
                branch_ids = [b["branch_id"] for b in get_user_branches(user_id)]
                cursor.execute(
                    """
                    SELECT e.event_id, e.event_type, e.action, e.actor_user_id,
                           u.full_name, e.mission_id, e.details, e.target_user_id, e.created_at
                    FROM realtime_events e
                    LEFT JOIN users u ON e.actor_user_id = u.user_id
                    WHERE e.event_id > %s
                      AND e.actor_user_id IS DISTINCT FROM %s
                      AND (
                            e.target_user_id = %s
                            OR (
                                e.target_user_id IS NULL
                                AND e.event_type IN ('mission','local_news','global_disaster','earthquake','ai_news')
                                AND (
                                    e.event_type != 'mission'
                                    OR e.mission_id IS NULL
                                    OR EXISTS (
                                        SELECT 1 FROM missions mm
                                        WHERE mm.mission_id = e.mission_id
                                          AND mm.branch_id = ANY(%s)
                                    )
                                )
                            )
                      )
                    ORDER BY e.event_id ASC
                    LIMIT %s;
                    """,
                    (after_id, user_id, user_id, branch_ids, limit),
                )

            rows = cursor.fetchall()
            events = [
                {
                    "event_id": r[0],
                    "event_type": r[1],
                    "action": r[2],
                    "actor_user_id": r[3],
                    "actor_name": r[4] or "نظام",
                    "mission_id": r[5],
                    "details": r[6].get("action_text", str(r[6])) if isinstance(r[6], dict) else str(r[6] or ""),
                    "target_user_id": r[7],
                    "created_at": r[8].strftime("%Y-%m-%d %H:%M") if r[8] else "",
                }
                for r in rows
            ]
            latest_id = events[-1]["event_id"] if events else after_id
            return {"events": events, "latest_id": latest_id}
    except Exception as e:
        print(f"Error fetching realtime events: {e}")
        return {"events": [], "latest_id": after_id}
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
                SELECT l.audit_id, l.user_id, u.full_name, u.username, l.action, l.details, l.created_at, l.entity_type
                FROM audit_logs l
                LEFT JOIN users u ON l.user_id = u.user_id
                ORDER BY l.created_at DESC;
            """)
            rows = cursor.fetchall()

            # 🎯 نفس تركيب الـ actor السليم (الاسم ↔ username ↔ رقم المستخدم ↔ "غير محدد")
            def _actor_name(r):
                if r[2]:
                    return r[2]
                if r[3]:
                    return r[3]
                if r[1] is not None:
                    return f"مستخدم #{r[1]}"
                return "غير محدد"

            result = []
            for r in rows:
                details_val = r[5]
                details_str = details_val.get("action_text", str(details_val)) if isinstance(details_val, dict) else str(details_val or "")
                created_val = r[6]
                created_str = created_val.strftime("%Y-%m-%d %H:%M:%S") if hasattr(created_val, 'strftime') else str(created_val) if created_val else "غير مسجل"

                result.append({
                    "log_id": r[0], "user_id": r[1], "full_name": _actor_name(r),
                    "action": r[4], "details": details_str, "created_at": created_str,
                    "entity_type": r[7]
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
    finally:
        connection.close()


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
    finally:
        connection.close()

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
    finally:
        connection.close()

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
    finally:
        connection.close()

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
    finally:
        connection.close()

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
    finally:
        connection.close()

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
    finally:
        connection.close()

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
    finally:
        connection.close()

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
    finally:
        connection.close()

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
                create_audit_log(cursor, user_id, "رصد خبر آلي", mission_id=None, entity_type="ai_news", entity_id=new_id, details={"action_text": f"محرك الذكاء الاصطناعي رصد خبراً جديداً ({news.news_type}) في: {news.governorate}"}, actor_user_id=None)
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
                create_audit_log(cursor, user_id, "تحديث خبر آلي", mission_id=None, entity_type="ai_news", entity_id=news_id, details={"action_text": f"تم تحديث بيانات رصد الذكاء الاصطناعي للخبر رقم {news_id}"}, actor_user_id=None)
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
def get_human_resources(client_now: Optional[str] = None, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """client_now = ساعة العميل المحلية (اختياري) — إطار الساعات الحية للـ segments المفتوحة."""
    token = credentials.credentials
    user_id = get_current_user_id(token)
    if not user_id: raise HTTPException(status_code=401)
    
    role = get_user_role(user_id)
    if not role or role["role_name"].upper() not in ["OWNER", "MANAGER", "SUPERVISOR", "JOKER", "المالك"]:
        raise HTTPException(status_code=403, detail="عفواً، هذه الصفحة متاحة للمالك فقط")

    connection = get_connection()
    try:
        with connection.cursor() as cursor:
            # =========================================================================
            # حساب القوة البشرية من الهوية الفعلية لا من النصوص (#4)
            # - كل سطر مشاركة له مفتاح هوية جذري مركّب (identity key):
            #     rid:branch:membership_number   (عنده رقم عضوية/صفة — مقيد بالفرع)
            #     nm:branch:full_name            (بدون رقم — يظل مقيداً بالفرع، فالأسماء تتكرر)
            #   🔧 الهوية = رقم العضوية + الفرع (رقم العضوية وحده ليس فريداً — قد يتكرر
            #   عبر الفروع، فنفس الرقم في فرع مختلف هوية مختلفة وتُحسب منفصلة تماماً).
            # - عدد المهام = عدد المهمات الفعلية المتميزة للنفس الهوية (لا تُعد المهمة مرتين)
            # - الساعات تُحسب من التواريخ الحقيقية للمهمة المكتملة (لا 0 ساعة بديلة)
            # - المهمة الحالية تُرجع ببيانها (id/كود/اسم) حتى نعرف في أي مهمة هو الآن
            # =========================================================================
            # fix #3/#8: إطار الساعات الحية = ساعة العميل المحلية (المقدَّمة) أو ساعة السيرفر.
            now_ref = client_now or None  # يُمرَّر كمعامل إلى COALESCE(%s::timestamp, (now() AT TIME ZONE 'Africa/Cairo'))
            cursor.execute("""
                WITH ident AS (
                    SELECT
                        mp.participant_id,
                        mp.mission_id,
                        mp.branch_id,
                        mp.full_name,
                        mp.membership_number,
                        mp.participant_type,
                        mp.participant_position,
                        mp.volunteer_id,
                        mp.return_status,
                        -- 🆕 «يُحسب من بداية المهمة» — مفتاح نقي على مصدر بداية المشاركة المخططة
                        mp.start_from_mission AS sfm,
                        -- هوية المركّبة: رقم العضوية + الفرع (رقم العضوية وحده ليس فريداً —
                        --   قد يتكرر عبر الفروع، فنفس الرقم في فرع مختلف هوية مختلفة).
                        CASE
                            WHEN TRIM(COALESCE(mp.membership_number, '')) <> ''
                                 THEN 'rid:' || COALESCE(mp.branch_id, 0) || ':' || TRIM(mp.membership_number)
                            ELSE 'nm:' || COALESCE(mp.branch_id, 0) || ':' || TRIM(mp.full_name)
                        END AS k
                    FROM mission_participants mp
                    WHERE mp.full_name IS NOT NULL AND TRIM(mp.full_name) <> ''
                      AND mp.participant_type IN ('volunteer', 'non_volunteer')
                ),
                -- 🆕 الزوجان الكاملان (مطابقان لـ mission_start_dt / mission_end_dt):
                --   mission_start_ts = exit_date ثم بدائل + departure_time ثم start_time
                --   (بلا created_at::time مهما كان — NULL بدون زوج تاريخ+وقت كامل).
                --   mission_end_ts   = pair completion، وإلا pair arrival — NULL بدون زوج كامل.
                mission_pair AS (
                    SELECT
                        m.mission_id,
                        (CASE
                            WHEN m.exit_date IS NOT NULL THEN m.exit_date
                            WHEN m.departure_date IS NOT NULL THEN m.departure_date
                            WHEN m.arrival_date IS NOT NULL THEN m.arrival_date
                            ELSE m.created_at::date
                        END + COALESCE(m.departure_time, m.start_time)) AS mission_start_ts,
                        (CASE
                            WHEN m.completion_date IS NOT NULL AND m.completion_time IS NOT NULL
                                THEN m.completion_date + m.completion_time
                            WHEN m.arrival_date IS NOT NULL AND m.arrival_time IS NOT NULL
                                THEN m.arrival_date + m.arrival_time
                        END) AS mission_end_ts
                    FROM missions m
                ),
                person AS (
                    SELECT DISTINCT ON (k)
                        k,
                        full_name,
                        membership_number,
                        participant_type,
                        participant_position,
                        branch_id,
                        volunteer_id
                    FROM ident
                    ORDER BY k, participant_id DESC
                ),
                -- المهمة الحالية الفعلية: مشارك "مازال بالمهمة" في مهمة غير منتهية، بالنسبة لكل هوية
                active AS (
                    SELECT DISTINCT ON (i.k)
                        i.k,
                        m.mission_id,
                        m.mission_code,
                        m.mission_name
                    FROM ident i
                    JOIN missions m ON m.mission_id = i.mission_id
                    -- «في مهمة حاليًا»: إمّا شريحة مشاركة مفتوحة فعلياً (end_dt IS NULL) في هذه المهمة
                    -- بعينها (انضمام صريح غير مُغلق)، وإمّا مشاركٌ بلا أي segments أصلاً (وضع الإرث —
                    -- لم يُسجَّل له انضمام/انفصال صريح) وما يزال مدرجاً «مازال بالمهمة» في مهمة غير
                    -- منتهية (سلوك قائم يُحافظ على تشغيليته، ولا ينطبق إلا على من لا سجلَ له؛ فبمجرد
                    -- وجود أي segment تُحسم النشطة من شريحةٍ مفتوحة حصراً — لا return_status قديم/مُستعاد).
                    -- الشريحة المغلقة في مهمة منتهية لا تجعل المشارك نشطاً أبداً، والشريحة المفتوحة
                    -- في مهمة أخرى لا تُنسب لهذه المهمة (نُلزم s.mission_id = i.mission_id).
                    WHERE m.status NOT IN ('Draft', 'Cancelled', 'Returned')
                      AND (
                          EXISTS (
                              SELECT 1 FROM mission_participant_sessions s
                              WHERE s.participant_id = i.participant_id
                                AND s.mission_id     = i.mission_id
                                AND s.end_dt IS NULL
                          )
                          OR (
                              i.return_status = 'مازال بالمهمة'
                              AND NOT EXISTS (
                                  SELECT 1 FROM mission_participant_sessions s
                                  WHERE s.participant_id = i.participant_id
                              )
                          )
                      )
                    ORDER BY i.k, m.created_at DESC, m.mission_id DESC
                ),
                -- 🆕 ساعات المشاركة الفعلية = مجموع مدد كل الـ Segments (Join/Leave) الحقيقية لكل شخص
                -- لكل مهمة. زمن كامل timestamp (start_dt..end_dt) بدعم المبيت overnight —
                -- الـ segment المفتوح (بلا end_dt) يُحتسب حتى الآن. الجمع حقيقي عبر كل
                -- الشرائح (انضمام/انفصال/عودة) — ليس أول/آخر سجل فقط (#3-7).
                explicit_hours AS (
                    SELECT
                        i.k,
                        mp.mission_id,
                        mp.participant_id,
                        mps.itinerary_group,
                        SUM(
                            GREATEST(
                                EXTRACT(EPOCH FROM (
                                    (
                                        CASE
                                            -- المغلق في مهمة مكتملة يُقصّ إلى سقف نهاية المهمة (fix D1)؛
                                            -- والمفتوح فيها يُغلق عند السقف (LEAST[COALESCE] = seg_dur في Python:
                                            --  مغلق ⇒ end_dt مقصوصاً بالسقف، مفتوح ⇒ السقف).
                                            WHEN m.status IN ('Completed', 'مكتملة')
                                                 AND mpair.mission_end_ts IS NOT NULL
                                            THEN LEAST(COALESCE(mps.end_dt, mpair.mission_end_ts), mpair.mission_end_ts)
                                            -- بلا سقف (غير مكتملة، أو مكتملة بلا زوج كامل):
                                            --  المغلق بنهايته المسجلة، والمفتوح حتى الآن (إطار العميل).
                                            ELSE COALESCE(mps.end_dt, COALESCE(%s::timestamp, (now() AT TIME ZONE 'Africa/Cairo')))
                                        END - mps.start_dt
                                    )
                                )) / 3600.0,
                                0
                            )
                        ) AS hours
                    FROM mission_participant_sessions mps
                    JOIN mission_participants mp ON mp.participant_id = mps.participant_id
                    JOIN missions m ON m.mission_id = mp.mission_id
                    JOIN mission_pair mpair ON mpair.mission_id = mp.mission_id
                    JOIN ident i ON i.participant_id = mp.participant_id
                    WHERE mps.start_dt IS NOT NULL
                    GROUP BY i.k, mp.mission_id, mp.participant_id, mps.itinerary_group
                ),
                -- ⭐ fix #6: الحضور الفعلي يغلب الخطة — لو للهوية أي قطاعات في المهمة
                --    (تحت أي مجموعة أو بلا مجموعة) فمجموعها هو الوحيد، بلا خليط مع نوافذ افتراضية.
                actual_total AS (
                    SELECT
                        eh.k,
                        eh.mission_id,
                        SUM(eh.hours) AS hours
                    FROM explicit_hours eh
                    GROUP BY eh.k, eh.mission_id
                ),
                -- 🆕 أقرب انطلاق عبر كل تخصيصات المشارك (مطابق لأفرع planned_start_dt عند
                --   start_from_mission=FALSE): أقل (تاريخ+وقت) انطلاق في مساراته المسندة.
                assigned_departure AS (
                    SELECT
                        i.participant_id,
                        i.mission_id,
                        MIN(d.departure_date + d.departure_time) AS dep
                    FROM ident i
                    JOIN mission_participant_itineraries mpi
                      ON mpi.participant_id = i.participant_id AND mpi.mission_id = i.mission_id
                    JOIN mission_itineraries d
                      ON d.mission_id = mpi.mission_id AND d.group_title = mpi.itinerary_group
                    WHERE d.departure_date IS NOT NULL AND d.departure_time IS NOT NULL
                    GROUP BY i.participant_id, i.mission_id
                ),
                -- بلا قطاعات + تخصيص صريح ⇒ الخطة الافتراضية من المسارات المُسندة.
                -- fix #4: لكل يوم (departure_date) مدى «أول انطلاق → آخر وصول» عبر كل
                -- المسارات المُسندة لذلك اليوم (لا الجمع بينها) ثم الجمع عبر الأيام:
                -- مسار 10:00→14:00 + مسار 13:00→18:00 لنفس اليوم ⇒ 10:00→18:00 (8س لا 9س).
                -- NULL تواريخ (قديم) تُدمج في يوم واحد (bucket واحد) — معاملة نفس اليوم.
                default_mix AS (
                    SELECT
                        k,
                        mission_id,
                        SUM(GREATEST(EXTRACT(EPOCH FROM (hi - lo)) / 3600.0, 0)) AS hours
                    FROM (
                        SELECT
                            l.k,
                            l.mission_id,
                            l.sfm,
                            l.mission_start_ts,
                            -- 🆕 القاعدة 3 (مطابق لـ assigned_span): بداية «أول أيام» المشارك
                            --    تُستبدل ببداية المهمة — «أول يوم» = يوم أقرب بداية مدى (lo_ts)
                            --    في تخصيصاته، بلا أي شرط تواريخ. الفرع القديم بلا تواريخ لا يُبدَّل.
                            CASE
                                WHEN l.sfm AND l.mission_start_ts IS NOT NULL
                                     AND (l.lo_ts = MIN(l.lo_ts) OVER (PARTITION BY l.k, l.mission_id))
                                THEN l.mission_start_ts
                                ELSE l.lo
                            END AS lo,
                            l.hi AS hi
                        FROM (
                            SELECT
                                i.k,
                                i.mission_id,
                                i.sfm,
                                i.participant_id,
                                mpair.mission_start_ts,
                                COALESCE(d.departure_date::text, 'day') AS day_bucket,
                                -- مدى اليوم بالفرع الثلاثي القديم نفسه (بلا تغيير):
                                (CASE
                                    WHEN COUNT(d.departure_date) = COUNT(*) THEN MIN(d.departure_date::timestamp + d.departure_time)
                                    WHEN COUNT(*) > 0 AND COUNT(d.departure_date) = 0 THEN date '2000-01-01' + MIN(d.departure_time)
                                    ELSE MIN(COALESCE(d.departure_date, d.arrival_date)::timestamp + d.departure_time)
                                END) AS lo,
                                (CASE
                                    WHEN COUNT(d.departure_date) = COUNT(*) THEN MAX(d.arrival_date::timestamp + d.arrival_time)
                                    WHEN COUNT(*) > 0 AND COUNT(d.departure_date) = 0 THEN date '2000-01-01' + MAX(d.arrival_time)
                                    ELSE MAX(COALESCE(d.arrival_date, d.departure_date)::timestamp + d.arrival_time)
                                END) AS hi,
                                -- بداية اليوم كـ timestamp كامل (لتحديد «أول يوم» بأقرب بداية —
                                --   الفرع القديم بلا تواريخ لا يشارك هنا)
                                (CASE
                                    WHEN COUNT(d.departure_date) = COUNT(*) THEN MIN(d.departure_date::timestamp + d.departure_time)
                                    ELSE MIN(COALESCE(d.departure_date, d.arrival_date)::timestamp + d.departure_time)
                                END) AS lo_ts
                            FROM ident i
                            JOIN mission_participant_itineraries mpi ON mpi.participant_id = i.participant_id AND mpi.mission_id = i.mission_id
                            JOIN mission_itineraries d ON d.mission_id = mpi.mission_id AND d.group_title = mpi.itinerary_group
                            JOIN missions m ON m.mission_id = i.mission_id
                            LEFT JOIN mission_pair mpair ON mpair.mission_id = m.mission_id
                            WHERE d.departure_time IS NOT NULL AND d.arrival_time IS NOT NULL
                            GROUP BY i.k, i.mission_id, i.sfm, i.participant_id, mpair.mission_start_ts, d.departure_date
                        ) l
                    ) sw
                    GROUP BY k, mission_id
                ),
                -- 🔧 المحرك الموحد: حساب ساعات كل مهمة بهوية البيانات لا بالتصنيف — المهمة
                --    تُحسب مرة واحدة لكل هوية مهما تكرر تسجيل مشاركته فيها (#4):
                --   ⭐ (1) له أي قطاعات ⇒ مجموعها الفعلي كله (JOIN/LEAVE هو مصدر الحقيقة)
                --   (2) وإلا له أيام مخصصة ⇒ وراثة نوافذها (خطة افتراضية)
                --   (3) وإلا ⇒ افتراضي خطة المهمة: مكتملة ⇒ مدة المهمة (مجمّدة دون تغيير)؛
                --       نشطة ⇒ min(الآن, نهاية الخطة) − الانطلاق (ساعات مباشرة).
                mission_hours AS (
                    SELECT
                        i.k,
                        i.mission_id,
                        MAX(m.created_at) AS created_at,
                        MAX((m.status NOT IN ('Draft', 'Cancelled', 'Returned'))::int)::boolean AS is_valid,
                        MAX(CASE
                            WHEN m.status NOT IN ('Draft', 'Cancelled', 'Returned')
                            THEN CASE
                                -- ⭐ الحضور الفعلي مصدر الحقيقة — أي قطاعات (Join/Leave) ⇒ مجموعها،
                                --    حتى لو اكتملت المهمة (الخطة لا تحلّ محل المشاركة الفعلية).
                                --    (مطابق لـ compute_working_hours: الـ segments قبل التجميد)
                                WHEN at.hours IS NOT NULL THEN at.hours
                                -- ⭐ التجميد يفتح بمفتاح الحالة (مطابق لـ Python) — بلا قطاعات فعلية:
                                --    planned_start (checkbox-aware) .. نهاية المهمة (سقف الزوج الكامل فقط).
                                WHEN m.status IN ('Completed', 'مكتملة') THEN
                                    CASE
                                        WHEN ps.ts IS NOT NULL AND mpair.mission_end_ts IS NOT NULL
                                             AND mpair.mission_end_ts > ps.ts
                                        THEN GREATEST(EXTRACT(EPOCH FROM (mpair.mission_end_ts - ps.ts)) / 3600.0, 0)
                                        ELSE 0
                                    END
                                -- Active missions: assigned-day defaults → live mission window
                                WHEN dm.hours IS NOT NULL THEN dm.hours
                                ELSE CASE WHEN ps.ts IS NOT NULL
                                     THEN GREATEST(
                                        EXTRACT(EPOCH FROM (
                                            LEAST(
                                                COALESCE(%s::timestamp, (now() AT TIME ZONE 'Africa/Cairo')),
                                                COALESCE(mpair.mission_end_ts, COALESCE(%s::timestamp, (now() AT TIME ZONE 'Africa/Cairo')))
                                            ) - ps.ts
                                        )) / 3600.0,
                                        0
                                     )
                                     ELSE 0
                                     END
                            END
                            ELSE 0
                        END) AS hours
                    FROM ident i
                    JOIN missions m ON m.mission_id = i.mission_id
                    LEFT JOIN actual_total at ON at.mission_id = i.mission_id AND at.k = i.k
                    LEFT JOIN default_mix dm ON dm.mission_id = i.mission_id AND dm.k = i.k
                    LEFT JOIN mission_pair mpair ON mpair.mission_id = i.mission_id
                    LEFT JOIN assigned_departure ad ON ad.participant_id = i.participant_id AND ad.mission_id = i.mission_id
                    -- 🆕 planned_start — مطابق لـ participation_start_dt (requirement C):
                    --    أقرب انطلاق عبر التخصيصات له الأولوية، ثم بداية المهمة فقط لو
                    --    «من بداية المهمة»، وإلا NULL (لا بداية = غير مشارك = ساعات صفرية).
                    --    (الفرع السابق كان يطابق planned_start_dt لكن بتفضيل sfm أعمى — أصبح
                    --    المُسار يعلو على sfm، والمُخصَّص بلا مسار وبلا sfm ⇒ 0 ساعات.)
                    CROSS JOIN LATERAL (
                        SELECT CASE
                            WHEN ad.dep IS NOT NULL THEN ad.dep
                            WHEN i.sfm AND mpair.mission_start_ts IS NOT NULL THEN mpair.mission_start_ts
                            ELSE NULL
                        END AS ts
                    ) ps
                    GROUP BY i.k, i.mission_id
                ),
                -- 🆕 «عدد ساعات آخر مهمة» — أحدث مهمة فعلية (غير ملغاة/مسودة) للهوية،
                --    بنفس حساب الساعات الموحد؛ نشطة ⇒ مباشر حتى اللحظة، مكتملة ⇒ مجمّدة.
                --    الترتيب بـ created_at ثم mission_id (مطرد) يجعل الاختيار حتمياً عند التساوي.
                last_mission AS (
                    SELECT DISTINCT ON (k)
                        k,
                        mission_hours.hours AS last_mission_hours
                    FROM mission_hours
                    WHERE is_valid
                    ORDER BY k, created_at DESC, mission_id DESC
                ),
                stats AS (
                    SELECT
                        k,
                        COUNT(*) FILTER (WHERE is_valid) AS missions_count,
                        ROUND(COALESCE(SUM(CASE WHEN is_valid THEN hours ELSE 0 END), 0)::numeric, 1) AS total_hours
                    FROM mission_hours
                    GROUP BY k
                )
                SELECT
                    p.full_name,
                    COALESCE(NULLIF(TRIM(p.membership_number), ''), 'بدون رقم/صفة') AS membership_number,
                    p.participant_type,
                    COALESCE(p.participant_position, '') AS participant_position,
                    COALESCE(b.branch_name, 'غير محدد') AS branch_name,
                    p.branch_id,
                    p.volunteer_id,
                    COALESCE(s.missions_count, 0) AS missions_count,
                    COALESCE(ROUND(lm.last_mission_hours::numeric, 1), 0) AS last_mission_hours,
                    COALESCE(s.total_hours, 0) AS total_hours,
                    (a.mission_id IS NOT NULL) AS active_mission,
                    a.mission_id AS active_mission_id,
                    a.mission_code AS active_mission_code,
                    a.mission_name AS active_mission_name
                FROM person p
                LEFT JOIN stats s  ON s.k = p.k
                LEFT JOIN active a ON a.k = p.k
                LEFT JOIN branches b ON b.branch_id = p.branch_id
                LEFT JOIN last_mission lm ON lm.k = p.k
                ORDER BY p.branch_id, p.k;
            """, (now_ref, now_ref, now_ref))
            rows = cursor.fetchall()
            result = []
            for row in rows:
                result.append({
                    "full_name": row[0],
                    "membership_number": row[1],
                    "participant_type": row[2],
                    "participant_position": row[3],
                    "branch_name": row[4],
                    "branch_id": row[5],
                    "volunteer_id": row[6],
                    "missions_count": row[7],
                    "last_mission_hours": float(row[8] or 0),   # 🆕 ساعات آخر مهمة (مباشر/مجمّدة)
                    "total_hours": float(row[9] or 0),          # إجمالي الساعات (تراكمي)
                    "active_mission": bool(row[10]),
                    "active_mission_id": row[11],
                    "active_mission_code": row[12],
                    "active_mission_name": row[13],
                })
            return result
    except Exception as e:
        print(f"Error fetching HR: {e}")
        raise HTTPException(status_code=500, detail="حدث خطأ داخلي أثناء جلب بيانات القوة البشرية")
    finally:
        connection.close()