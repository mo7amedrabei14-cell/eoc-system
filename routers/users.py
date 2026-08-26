from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import psycopg

# الأدوات بتاعتنا
from dependencies import get_db, RequirePermission
from auth import password_hash

# إعداد قسم المستخدمين
router = APIRouter(prefix="/users", tags=["Users"])

# 1. جلب كل المستخدمين
@router.get("/")
def get_users(
    user_id: int = Depends(RequirePermission("users.view")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                u.user_id, u.full_name, u.username, u.is_active,
                r.role_id, r.role_name
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.user_id
            LEFT JOIN roles r ON r.role_id = ur.role_id
            ORDER BY u.user_id;
            """
        )
        rows = cursor.fetchall()
        return [
            {
                "user_id": row[0], "full_name": row[1], "username": row[2],
                "is_active": row[3], "role_id": row[4], "role": row[5]
            }
            for row in rows
        ]

# 2. إنشاء مستخدم جديد
class CreateUserRequest(BaseModel):
    full_name: str
    username: str
    password: str
    role_id: int
    branch_ids: list[int] = []

@router.post("/", status_code=201)
def create_user(
    data: CreateUserRequest,
    current_user_id: int = Depends(RequirePermission("users.create")),
    connection: psycopg.Connection = Depends(get_db)
):
    hashed_password = password_hash.hash(data.password)
    
    with connection.cursor() as cursor:
        cursor.execute("SELECT role_name FROM roles WHERE role_id = %s;", (data.role_id,))
        role = cursor.fetchone()
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
            
        cursor.execute(
            """
            INSERT INTO users (full_name, username, role, password_hash, is_active)
            VALUES (%s, %s, %s, %s, TRUE) RETURNING user_id;
            """,
            (data.full_name, data.username, role[0], hashed_password)
        )
        user_id = cursor.fetchone()[0]
        
        cursor.execute("INSERT INTO user_roles (user_id, role_id) VALUES (%s, %s);", (user_id, data.role_id))
        
        for branch_id in data.branch_ids:
            cursor.execute("INSERT INTO user_branches (user_id, branch_id) VALUES (%s, %s);", (user_id, branch_id))
            
    return {"message": "User created successfully", "user_id": user_id}

# 3. تعديل بيانات مستخدم
class UpdateUserRequest(BaseModel):
    full_name: str
    username: str

@router.put("/{user_id}")
def update_user(
    user_id: int,
    data: UpdateUserRequest,
    credentials = Depends(RequirePermission("users.edit")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE users SET full_name = %s, username = %s WHERE user_id = %s
            RETURNING user_id, full_name, username, is_active;
            """,
            (data.full_name, data.username, user_id)
        )
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
            
    return {
        "message": "User updated successfully",
        "user": {"user_id": user[0], "full_name": user[1], "username": user[2], "is_active": user[3]}
    }

# 4. تفعيل أو إيقاف مستخدم
class UpdateUserStatusRequest(BaseModel):
    is_active: bool

@router.patch("/{user_id}/status")
def update_user_status(
    user_id: int,
    data: UpdateUserStatusRequest,
    credentials = Depends(RequirePermission("users.status")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE users SET is_active = %s WHERE user_id = %s RETURNING user_id, full_name, username, is_active;",
            (data.is_active, user_id)
        )
        user = cursor.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
            
    return {
        "message": "User status updated successfully",
        "user": {"user_id": user[0], "full_name": user[1], "username": user[2], "is_active": user[3]}
    }

# 5. تغيير دور (وظيفة) المستخدم
class UpdateUserRoleRequest(BaseModel):
    role_id: int

@router.put("/{user_id}/role")
def update_user_role(
    user_id: int,
    data: UpdateUserRoleRequest,
    credentials = Depends(RequirePermission("users.role.edit")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("SELECT role_id FROM roles WHERE role_id = %s;", (data.role_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Role not found")
            
        cursor.execute("SELECT user_id FROM users WHERE user_id = %s;", (user_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
            
        cursor.execute("DELETE FROM user_roles WHERE user_id = %s;", (user_id,))
        cursor.execute("INSERT INTO user_roles (user_id, role_id) VALUES (%s, %s);", (user_id, data.role_id))
        
    return {"message": "User role updated successfully", "user_id": user_id, "role_id": data.role_id}

# 6. تغيير فروع المستخدم
class UpdateUserBranchesRequest(BaseModel):
    branch_ids: list[int]

@router.put("/{user_id}/branches")
def update_user_branches(
    user_id: int,
    data: UpdateUserBranchesRequest,
    credentials = Depends(RequirePermission("users.branches.edit")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute("SELECT user_id FROM users WHERE user_id = %s;", (user_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="User not found")
            
        if data.branch_ids:
            cursor.execute("SELECT branch_id FROM branches WHERE branch_id = ANY(%s) AND is_active = TRUE;", (data.branch_ids,))
            valid_branch_ids = {row[0] for row in cursor.fetchall()}
            invalid = [b for b in data.branch_ids if b not in valid_branch_ids]
            if invalid:
                raise HTTPException(status_code=400, detail=f"Invalid branch IDs: {invalid}")
                
        cursor.execute("DELETE FROM user_branches WHERE user_id = %s;", (user_id,))
        for branch_id in data.branch_ids:
            cursor.execute("INSERT INTO user_branches (user_id, branch_id) VALUES (%s, %s);", (user_id, branch_id))
            
    return {"message": "User branches updated successfully", "user_id": user_id, "branch_ids": data.branch_ids}