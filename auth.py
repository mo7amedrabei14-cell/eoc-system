import os
import time
from datetime import datetime, timedelta, timezone
import jwt
from dotenv import load_dotenv
from pwdlib import PasswordHash

from db import get_connection


load_dotenv()

password_hash = PasswordHash.recommended()

JWT_SECRET = os.getenv("JWT_SECRET")

if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not configured")


# ─────────────────────────────────────────────────────────────────────────────
# 🚪 «جيل الجلسات» (token generation) — أساس زر «تسجيل خروج الجميع» للمالك
# كل توكن يحمل رقم الجيل اللي أُصدر فيه (gen)، و«خروج الجميع» بيزوّد الرقم في
# القاعدة ⇒ كل توكن أقدم يُرفض فوراً على كل الأجهزة. مقارنة أرقام صحيحة فقط
# (مفيش أي اعتماد على فروق ساعات الأجهزة)، ومفيش أي مساس بالشغل المحفوظ.
# الكاش 5 ثوانٍ: يمنع قراءة القاعدة في كل طلب (نفس سبب إصلاح الأداء القديم).
# ─────────────────────────────────────────────────────────────────────────────
SESSION_GEN_CACHE_TTL = 5.0
_session_gen_cache = {"at": 0.0, "value": 0, "known": False}


def get_session_generation() -> int:
    """رقم جيل الجلسات الحالي من القاعدة (كاش 5 ثوانٍ)."""
    now = time.monotonic()

    if _session_gen_cache["known"] and (now - _session_gen_cache["at"]) < SESSION_GEN_CACHE_TTL:
        return _session_gen_cache["value"]

    try:
        connection = get_connection()

        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT token_generation FROM auth_control WHERE id = 1")
                row = cursor.fetchone()
                value = int(row[0]) if row and row[0] is not None else 0
        finally:
            connection.close()

        _session_gen_cache.update({"at": now, "value": value, "known": True})
        return value

    except Exception:
        # تعذّر القراءة: نحتفظ بآخر قيمة معروفة بدل ما نسقّط كل المستخدمين بـ 401
        return _session_gen_cache["value"]


def invalidate_session_generation_cache() -> None:
    _session_gen_cache["at"] = 0.0


def authenticate_user(username: str, password: str):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    user_id,
                    full_name,
                    username,
                    password_hash,
                    is_active
                FROM users
                WHERE username = %s;
                """,
                (username,)
            )

            user = cursor.fetchone()

            if not user:
                return None

            if not user[4]:
                return None

            if not user[3]:
                return None

            if not password_hash.verify(password, user[3]):
                return None

            return {
                "user_id": user[0],
                "full_name": user[1],
                "username": user[2],
            }

    finally:
        connection.close()


def create_access_token(user_id: int, generation: int | None = None):
    expires_at = datetime.now(timezone.utc) + timedelta(hours=8)

    payload = {
        "sub": str(user_id),
        "exp": expires_at,
        # 🚪 رقم جيل الجلسة: أي توكن بجيل أقدم من جيل القاعدة يُرفض (خروج الجميع)
        "gen": int(generation) if generation is not None else get_session_generation(),
    }

    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm="HS256"
    )

def get_effective_permissions(role_id: int):
    connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH RECURSIVE role_tree AS (
                    SELECT role_id
                    FROM roles
                    WHERE role_id = %s

                    UNION

                    SELECT ri.parent_role_id
                    FROM role_inheritance ri
                    INNER JOIN role_tree rt
                        ON ri.child_role_id = rt.role_id
                )
                SELECT DISTINCT p.permission_code
                FROM role_tree rt
                INNER JOIN role_permissions rp
                    ON rp.role_id = rt.role_id
                INNER JOIN permissions p
                    ON p.permission_id = rp.permission_id
                ORDER BY p.permission_code;
                """,
                (role_id,)
            )

            rows = cursor.fetchall()

            return [row[0] for row in rows]

    finally:
        connection.close()

def get_user_branches(user_id: int, connection=None):
    # ♻️ إعادة استخدام اختيارية للاتصال: لو مُرِّر اتصال من نفس الطلب نستخدمه بلا فتح/إغلاق إضافي
    #    (اتصال واحد للطلب كله)، وإلا فالسلوك القديم حرفياً — اتصال خاص يُفتح ويُغلق هنا.
    owns_connection = connection is None
    if owns_connection:
        connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    b.branch_id,
                    b.branch_name,
                    b.has_geographic_scope
                FROM user_branches ub
                INNER JOIN branches b
                    ON b.branch_id = ub.branch_id
                WHERE ub.user_id = %s
                  AND b.is_active = TRUE
                ORDER BY b.branch_id;
                """,
                (user_id,)
            )

            rows = cursor.fetchall()

            return [
                {
                    "branch_id": row[0],
                    "branch_name": row[1],
                    "has_geographic_scope": row[2]
                }
                for row in rows
            ]

    finally:
        if owns_connection:
            connection.close()

def get_user_role(user_id: int, connection=None):
    # ♻️ نفس نمط get_user_branches: اتصال مُمرَّر اختيارياً — بلا تمرير = السلوك القديم كما هو.
    owns_connection = connection is None
    if owns_connection:
        connection = get_connection()

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT
                    r.role_id,
                    r.role_name
                FROM user_roles ur
                INNER JOIN roles r
                    ON r.role_id = ur.role_id
                WHERE ur.user_id = %s
                LIMIT 1;
                """,
                (user_id,)
            )

            row = cursor.fetchone()

            if not row:
                return None

            return {
                "role_id": row[0],
                "role_name": row[1]
            }

    finally:
        if owns_connection:
            connection.close()

def check_permission(user_id: int, permission_code: str):
    role = get_user_role(user_id)

    if not role:
        return False

    permissions = get_effective_permissions(role["role_id"])

    return permission_code in permissions

def check_branch_access(user_id: int, branch_id: int):
    role = get_user_role(user_id)

    if not role:
        return False

    if role["role_name"] == "OWNER":
        return True

    branches = get_user_branches(user_id)

    allowed_branch_ids = {
        branch["branch_id"]
        for branch in branches
    }

    return branch_id in allowed_branch_ids

def authorize(
    user_id: int,
    permission_code: str,
    branch_id: int | None = None
):
    if not check_permission(user_id, permission_code):
        return False

    if branch_id is not None:
        if not check_branch_access(user_id, branch_id):
            return False

    return True

def get_current_user_id(token: str):
    """
    ✅ Fix: opened 3 separate DB connections (permissions + role + branches) that were
    never used here.  That added ~3 extra TCP/TLS handshakes on every authenticated
    request, easily pushing a Vercel Hobby function over its 10-second gateway
    timeout when the first request is a cold-start.  Now we use one connection and
    only query what's actually needed.
    """
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"]
        )

        user_id = payload.get("sub")

        if not user_id:
            return None

        # 🚪 خروج الجميع: أي توكن من جيل أقدم من جيل القاعدة يُعتبر منتهياً
        # (التوكنات القديمة بلا gen = جيل 0، فتفضل شغالة زي ما هي لحد أول خروج جماعي)
        try:
            current_generation = get_session_generation()
        except Exception:
            current_generation = 0

        if int(payload.get("gen", 0) or 0) < current_generation:
            return None

        return int(user_id)

    except Exception:
        return None

def explain_token_failure(token: str) -> str:
    """🚪 سبب رفض التوكن: logout_all (خروج جماعي) / expired / invalid."""
    try:
        payload = jwt.decode(
            token, JWT_SECRET, algorithms=["HS256"], options={"verify_exp": False}
        )
        token_generation = int(payload.get("gen", 0) or 0)
    except Exception:
        return "invalid"

    try:
        if token_generation < get_session_generation():
            return "logout_all"
    except Exception:
        pass

    return "expired"
