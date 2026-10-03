# clean_eq_audit.py — مسح قيود الرصد الآلي من سجل النظام (مرة واحدة)
from db import get_connection

conn = get_connection()
cur = conn.cursor()
cur.execute("DELETE FROM audit_logs WHERE action LIKE 'رصد زلزال%';")
print(f"✅ تم حذف {cur.rowcount} قيد رصد آلي من سجل النظام")
conn.commit()
input("اضغط Enter للإغلاق...")

