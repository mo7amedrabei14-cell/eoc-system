from fastapi import APIRouter, Depends
import psycopg

from dependencies import get_db

router = APIRouter(prefix="/branches", tags=["Branches"])

@router.get("/")
def get_branches(connection: psycopg.Connection = Depends(get_db)):
    with connection.cursor() as cursor:
        cursor.execute("SELECT branch_id, branch_name, has_geographic_scope FROM branches WHERE is_active = TRUE ORDER BY branch_id;")
        rows = cursor.fetchall()
        return [{"branch_id": r[0], "branch_name": r[1], "has_geographic_scope": r[2]} for r in rows]