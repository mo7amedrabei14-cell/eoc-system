from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import psycopg

from dependencies import get_db, RequirePermission

router = APIRouter(prefix="/volunteers", tags=["Volunteers"])

@router.get("/")
def get_volunteers(
    user_id: int = Depends(RequirePermission("mission.view")), # أي حد بيشوف المهام يقدر يشوف المتطوعين
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT v.volunteer_id, v.full_name, v.phone, v.membership_number, b.branch_name, v.is_active
            FROM volunteers v
            LEFT JOIN branches b ON v.branch_id = b.branch_id
            ORDER BY v.volunteer_id DESC;
            """
        )
        rows = cursor.fetchall()
        return [{"volunteer_id": r[0], "full_name": r[1], "phone": r[2], "membership_number": r[3], "branch_name": r[4], "is_active": r[5]} for r in rows]

class CreateVolunteerRequest(BaseModel):
    full_name: str
    phone: str | None = None
    branch_id: int
    membership_number: str | None = None

@router.post("/", status_code=201)
def create_volunteer(
    data: CreateVolunteerRequest,
    user_id: int = Depends(RequirePermission("volunteer.create")),
    connection: psycopg.Connection = Depends(get_db)
):
    with connection.cursor() as cursor:
        if data.membership_number:
            cursor.execute("SELECT volunteer_id FROM volunteers WHERE membership_number = %s AND branch_id = %s;", (data.membership_number, data.branch_id))
            if cursor.fetchone(): raise HTTPException(status_code=409, detail="رقم العضوية موجود بالفعل في هذا الفرع")

        cursor.execute(
            "INSERT INTO volunteers (full_name, phone, branch_id, membership_number) VALUES (%s, %s, %s, %s) RETURNING volunteer_id;",
            (data.full_name, data.phone, data.branch_id, data.membership_number)
        )
        return {"message": "تم إضافة المتطوع بنجاح", "volunteer_id": cursor.fetchone()[0]}