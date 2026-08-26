import os
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


def create_access_token(user_id: int):
    expires_at = datetime.now(timezone.utc) + timedelta(hours=8)

    payload = {
        "sub": str(user_id),
        "exp": expires_at,
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

def get_user_branches(user_id: int):
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
        connection.close()

def get_user_role(user_id: int):
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
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"]
        )

        user_id = payload.get("sub")

        if not user_id:
            return None

        return int(user_id)

    except Exception:
        return None