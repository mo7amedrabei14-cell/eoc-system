from fastapi import APIRouter, Depends
import psycopg

from dependencies import get_db, get_current_user

router = APIRouter(prefix="/branches", tags=["Branches"])

@router.get("/")
# 🔒 قائمة الفروع بيانات تشغيلية داخلية: نقطة المصادقة هي الحد الفعلي (كانت تُرجَع
#    لأي زائر بلا توكن). لا يقرأ هذا المسار أي عميل في الواجهة (الواجهة تستخدم
#    /api/branches/locations الموثّق) — فالحد لا يكسر أي مسار قائم.
def get_branches(
    connection: psycopg.Connection = Depends(get_db),
    user_id: int = Depends(get_current_user),
):
    with connection.cursor() as cursor:
        cursor.execute("SELECT branch_id, branch_name, has_geographic_scope FROM branches WHERE is_active = TRUE ORDER BY branch_id;")
        rows = cursor.fetchall()
        return [{"branch_id": r[0], "branch_name": r[1], "has_geographic_scope": r[2]} for r in rows]