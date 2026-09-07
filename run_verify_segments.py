import os, re, sys, datetime
import psycopg
from dotenv import load_dotenv

# ═══════════════════════════════════════════════════════════════════════════
# run_verify_segments.py — تحقق شامل من إعادة تصميم المشاركة
# ITINERARY = الافتراضي، JOIN/LEAVE = استثناءات (قطاعات داخلية start_dt/end_dt)
# 1) مبيت 23:00→03:00 = 4 ساعات       2) انضمام متأخر 09:00 = ساعات اليوم 5
# 3) انفصال+عودة = قطعتان منفصلتان = 6+2=8  4) خليط اليوم (قطاعات + وراثة)
# 5) استبدال يحفظ HR     6) مهمة عادية مبيت = 4س  7) تعديل خطة السير لا يمس القطاعات
# 8) HR تجميعي        9) منطق idempotency (كود)     10) py_compile (خارجي)
# ═══════════════════════════════════════════════════════════════════════════

load_dotenv(r"C:\Users\mo7am\OneDrive\Work\EOC System\.env")
sys.path.insert(0, r"C:\Users\mo7am\OneDrive\Work\EOC System")
DB = os.getenv("DATABASE_URL")
MAIN = r"C:\Users\mo7am\OneDrive\Work\EOC System\main.py"

import main  # استيراد المساعدات الحقيقية (الاستيراد آمن — لا uvicorn عند الاستيراد)
from main import (
    compute_participant_status, compute_working_hours, segment_span_from_parts,
    parse_dt_input, dt_from_parts, segment_hours, mission_start_dt, mission_end_dt,
    reference_segment_start,
)

failures = []
def check(label, got, exp=None):
    if exp is None:
        exp = True  # صيغة (label, condition) — شرط منطقي
    ok = got == exp
    print(f"[{'OK' if ok else 'FAIL'}] {label}: got={got!r} expected={exp!r}")
    if not ok: failures.append(label)

def ensure_schema(cur):
    """Idempotent — يضمن وجود أعمدة القطاعات (يعمل حتى لو تأخر تطبيق الميگریشن)."""
    cur.execute("SELECT 1 FROM pg_attribute WHERE attrelid = 'mission_participant_sessions'::regclass AND attname = 'start_dt'")
    if cur.fetchone() is None:
        print("  → إضافة أعمدة القطاعات (idempotent)...")
        cur.execute("ALTER TABLE mission_itineraries ADD COLUMN IF NOT EXISTS departure_date date")
        cur.execute("ALTER TABLE mission_itineraries ADD COLUMN IF NOT EXISTS arrival_date date")
        cur.execute("ALTER TABLE mission_participants ADD COLUMN IF NOT EXISTS roster_active boolean NOT NULL DEFAULT true")
        cur.execute("ALTER TABLE mission_participant_sessions ADD COLUMN IF NOT EXISTS itinerary_group varchar(150)")
        cur.execute("ALTER TABLE mission_participant_sessions ADD COLUMN IF NOT EXISTS start_dt timestamp")
        cur.execute("ALTER TABLE mission_participant_sessions ADD COLUMN IF NOT EXISTS end_dt timestamp")
        conn.commit()

print("═" * 70)
print(" الجزء A — اختبارات المساعدات النقية (compute_working_hours/status/segments)")
print("═" * 70)

# ── 1) مبيت: قطاع 23:00 → 03:00 (اليوم التالي) = 4 ساعات ──
s, e = segment_span_from_parts("2026-09-01", "23:00", "03:00")
check("1a مبيت segment_span: end بعد بدء بيوم", (s, e) == (datetime.datetime(2026,9,1,23), datetime.datetime(2026,9,2,3)))
check("1b مبيت segment_hours = 4", segment_hours([{'start_dt': s, 'end_dt': e}]), 4.0)
s2, e2 = segment_span_from_parts("2026-09-01", "08:00", None)
check("1c مفتوح (بلا نهاية) → end_dt None", e2 is None, True)

# parse_dt_input
check("parse 'YYYY-MM-DD HH:MM'", parse_dt_input("2026-09-01 09:30"), datetime.datetime(2026,9,1,9,30))
check("parse 'YYYY-MM-DD HH:MM:SS'", parse_dt_input("2026-09-01 09:30:00"), datetime.datetime(2026,9,1,9,30,0))

# ── الحالة الآلية ──
check("2a نشطة بلا قطع → مازال", compute_participant_status('نشطة', 'مازال بالمهمة', []), 'مازال بالمهمة')
check("2b مهمة مكتملة → انتهت", compute_participant_status('Completed', 'مازال بالمهمة', []), 'تم انتهاء مهمتة')
check("2c return_status انتهى → انتهت", compute_participant_status('نشطة', 'تم انتهاء مهمتة', []), 'تم انتهاء مهمتة')
check("2d قطاع مفتوح → مازال", compute_participant_status('نشطة', 'مازال بالمهمة', [{'end_dt': None}]), 'مازال بالمهمة')
check("2e كل القطع مغلقة → انتهت", compute_participant_status('نشطة', 'مازال بالمهمة', [{'end_dt': e}]), 'تم انتهاء مهمتة')

# بيانات أساسية للمهام (نصوص كـ GET)
day1 = [{'group_title': 'اليوم الأول', 'departure_date': '2026-09-08', 'departure_time': '08:00', 'arrival_date': '2026-09-08', 'arrival_time': '14:00'}]
day1_x2 = day1 + [{'group_title': 'اليوم الأول', 'departure_date': '2026-09-08', 'departure_time': '09:00', 'arrival_date': '2026-09-08', 'arrival_time': '13:00'}]
day2 = [{'group_title': 'اليوم الثاني', 'departure_date': '2026-09-09', 'departure_time': '23:00', 'arrival_date': '2026-09-10', 'arrival_time': '03:00'}]
routes_open = day1 + day2
open_m = {'mission_classification': 'مفتوحة', 'departure_date': '2026-09-08', 'departure_time': '08:00'}

# ── 2) انضمام متأخر: يوم 08:00→14:00 (6س)، انضم 09:00 → 5 ساعات ──
seg_late = [{'start_dt': datetime.datetime(2026,9,8,9,0), 'end_dt': datetime.datetime(2026,9,8,14,0), 'itinerary_group': 'اليوم الأول'}]
check("3 انضمام متأخر = 5س", compute_working_hours(open_m, 'نشطة', seg_late, ['اليوم الأول'], routes_open), 5.0)

# ── 4) خليط اليوم: Day1 قطاعات + Day2 بلا قطع (يرث 4س مبيت) ──
seg_d1 = [{'start_dt': datetime.datetime(2026,9,8,9,0), 'end_dt': datetime.datetime(2026,9,8,14,0), 'itinerary_group': 'اليوم الأول'},
          {'start_dt': datetime.datetime(2026,9,8,17,0), 'end_dt': datetime.datetime(2026,9,8,20,0), 'itinerary_group': 'اليوم الأول'}]
check("4 خليط Day1 قطعتان (5+3) + Day2 وراثة 4س = 12س",
      compute_working_hours(open_m, 'نشطة', seg_d1, ['اليوم الأول', 'اليوم الثاني'], routes_open), 12.0)

# ── وراثة كاملة بلا قطاعات: Day1 6س + Day2 مبيت 4س = 10 ──
check("5 وراثة كاملة = 10س", compute_working_hours(open_m, 'نشطة', [], ['اليوم الأول', 'اليوم الثاني'], routes_open), 10.0)

# ── 6) مهمة عادية: مدة المهمة دون تغيير 10س (08:00→18:00) ──
normal_m = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '08:00', 'arrival_date': '2026-09-08', 'arrival_time': '18:00'}
check("6 عادية مدة = 10س", compute_working_hours(normal_m, 'نشطة', [], [], []), 10.0)

# ── 3) انفصال+عودة في عادية: قطعتان 6+2 = 8 (المهمة 10س تبقى للمهمة نفسها) ──
seg_n = [{'start_dt': datetime.datetime(2026,9,8,8,0), 'end_dt': datetime.datetime(2026,9,8,14,0)},
         {'start_dt': datetime.datetime(2026,9,8,17,0), 'end_dt': datetime.datetime(2026,9,8,19,0)}]
seg_n2 = [{'start_dt': datetime.datetime(2026,9,8,8,0), 'end_dt': datetime.datetime(2026,9,8,14,0)},
         {'start_dt': datetime.datetime(2026,9,8,17,0), 'end_dt': datetime.datetime(2026,9,8,19,0)}]
check("7 عادية انفصال+عودة = 8س", compute_working_hours(normal_m, 'نشطة', seg_n2, [], []), 8.0)
check("8 عادية بلا قطع (المهمة تبقى 10س)", compute_working_hours(normal_m, 'نشطة', [], [], []), 10.0)

# ── 6) مهمة عادية مبيت: انطلاق 23:00 → انتهاء 03:00 اليوم التالي = 4س ──
normal_ovn = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '23:00', 'completion_date': '2026-09-09', 'completion_time': '03:00'}
check("6b عادية مبيت = 4س", compute_working_hours(normal_ovn, 'نشطة', [], [], []), 4.0)

# ── 7) قطاع مفتوح على مهمة مكتملة يُسقف بنهاية المهمة ──
compl_m = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '08:00', 'completion_date': '2026-09-08', 'completion_time': '18:00'}
seg_open = [{'start_dt': datetime.datetime(2026,9,8,16,0), 'end_dt': None}]
check("7 قطاع مفتوح على مكتملة → حتى 18:00 = 2س", compute_working_hours(compl_m, 'Completed', seg_open, [], []), 2.0)

# ── قطاع بلا يوم في مفتوحة (نادرة) يُضاف مستقلاً مع وراثة باقي الأيام ──
seg_stray = [{'start_dt': datetime.datetime(2026,9,8,15,0), 'end_dt': datetime.datetime(2026,9,8,16,0)}]  # بلا group
check("7b قطاع بلا يوم (1س) + Day1 وراثة 6س = 7س",
      compute_working_hours(open_m, 'نشطة', seg_stray, ['اليوم الأول'], routes_open), 7.0)

print()
print("═" * 70)
print(" الجزء B — اختبارات قاعدة البيانات (HR الحقيقي + reference_segment_start)")
print("═" * 70)

conn = psycopg.connect(DB)
cur = conn.cursor()
try:
    # تنظيف أي بقايا
    cur.execute("DELETE FROM mission_participant_sessions WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE full_name LIKE 'TEST_SEG_%')")
    cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id IN (SELECT mission_id FROM missions WHERE mission_code LIKE 'TEST-SEG-%')")
    cur.execute("DELETE FROM mission_participants WHERE full_name LIKE 'TEST_SEG_%'")
    cur.execute("DELETE FROM mission_itineraries WHERE mission_id IN (SELECT mission_id FROM missions WHERE mission_code LIKE 'TEST-SEG-%')")
    cur.execute("DELETE FROM missions WHERE mission_code LIKE 'TEST-SEG-%'")
    conn.commit()
    ensure_schema(cur)

    code = 'TEST-SEG-' + datetime.datetime.now().strftime('%H%M%S')

    # ── مهمة مفتوحة: يوم 1 (08→14) ، يوم 2 مبيت (23:00→03:00 اليوم التالي) ──
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, created_at, departure_date, departure_time)
        VALUES (%s, 'TEST_SEG_OPEN', 'مفتوحة', 19, 'Active', NOW(), CURRENT_DATE, '00:01')
        RETURNING mission_id
    """, (code,))
    oid = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'اليوم الأول','A',CURRENT_DATE,'08:00',CURRENT_DATE,'14:00')", (oid,))
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'اليوم الأول','B',CURRENT_DATE,'09:00',CURRENT_DATE,'13:00')", (oid,))
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_to, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'اليوم الثاني','A',CURRENT_DATE+1,'23:00',CURRENT_DATE+2,'03:00')", (oid,))

    # P1: كلاهما، قطاعات على Day1 فقط (انضمام متأخر 09:00→14:00 = 5س) → Day2 وراثة (4س) ⇒ 9س
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_SEG_P1','volunteer',19,'مازال بالمهمة') RETURNING participant_id", (oid,))
    p1 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الأول')", (p1, oid))
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الثاني')", (p1, oid))
    cur.execute("INSERT INTO mission_participant_sessions (participant_id, mission_id, itinerary_group, start_dt, end_dt) VALUES (%s,%s,'اليوم الأول', CURRENT_DATE::timestamp + time '09:00', CURRENT_DATE::timestamp + time '14:00')", (p1, oid))

    # P2: يوم 1 فقط بلا قطع ⇒ وراثة 6س (نافذة Day1)
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_SEG_P2','volunteer',19,'مازال بالمهمة') RETURNING participant_id", (oid,))
    p2 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الأول')", (p2, oid))

    # P3: انفصال+عودة يوم 1 (قطعة 08→14 = 6س + 17→19 = 2س) + يوم 2 وراثة (4س) ⇒ 12س
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_SEG_P3','volunteer',19,'مازال بالمهمة') RETURNING participant_id", (oid,))
    p3 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الأول')", (p3, oid))
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الثاني')", (p3, oid))
    cur.execute("INSERT INTO mission_participant_sessions (participant_id, mission_id, itinerary_group, start_dt, end_dt) VALUES (%s,%s,'اليوم الأول', CURRENT_DATE::timestamp + time '08:00', CURRENT_DATE::timestamp + time '14:00')", (p3, oid))
    cur.execute("INSERT INTO mission_participant_sessions (participant_id, mission_id, itinerary_group, start_dt, end_dt) VALUES (%s,%s,'اليوم الأول', CURRENT_DATE::timestamp + time '17:00', CURRENT_DATE::timestamp + time '19:00')", (p3, oid))

    # R1: له قطاعات ثم "أُزيل من الاستمارة" (roster_active=false) — يجب بقاء ساعاته (الاستبدال يحفظ HR)
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status, roster_active) VALUES (%s,'TEST_SEG_R1','volunteer',19,'تم انتهاء مهمتة',false) RETURNING participant_id", (oid,))
    r1 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participant_sessions (participant_id, mission_id, itinerary_group, start_dt, end_dt) VALUES (%s,%s,'اليوم الأول', CURRENT_DATE::timestamp + time '08:00', CURRENT_DATE::timestamp + time '11:00')", (r1, oid))

    # ── مهمة عادية مبيت: انطلاق 23:00 → انتهاء 03:00 التالي (مدة = 4س) ──
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, created_at, departure_date, departure_time, completion_date, completion_time)
        VALUES (%s, 'TEST_SEG_NORM_OVN', 'عادية', 19, 'Completed', NOW(), CURRENT_DATE, '23:00', CURRENT_DATE+1, '03:00')
        RETURNING mission_id
    """, ('TEST-SEG-NORM-1',))
    nid = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_SEG_N1','volunteer',19,'تم انتهاء مهمتة')", (nid,))

    conn.commit()
    print(f"Inserted: open={oid} normal={nid} P1={p1} P2={p2} P3={p3} R1={r1}")

    # ── reference_segment_start: أقرب انطلاق (تاريخ+وقت) لليوم الأول ──
    m_row = {'mission_id': oid, 'departure_date': str(datetime.date.today()), 'departure_time': '00:01'}
    ref = reference_segment_start(cur, m_row, 'اليوم الأول')
    exp_ref = datetime.datetime.combine(datetime.date.today(), datetime.time(8, 0))
    check("9 reference_segment_start (أقرب انطلاق اليوم) = 08:00", ref, exp_ref)

    # ── استخراج وتشغيل استعلام HR الحقيقي من main.py ──
    src = open(MAIN, encoding="utf-8").read()
    idx = src.index("WITH ident AS (")
    open_tri = src.rfind('cursor.execute("""', 0, idx)
    hr_start = open_tri + len('cursor.execute("""')
    m = re.search(r'\n\s+"""\)', src[hr_start:])
    if not m:
        raise SystemExit("HR closing not found")
    hr = src[hr_start:hr_start + m.start() + 1]
    hr = hr[hr.index('WITH ident AS'):]
    cur.execute(hr)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    ci = {c: i for i, c in enumerate(cols)}

    def hrow(name):
        return next((r for r in rows if r[ci['full_name']] == name), None)

    def hval(name):
        r = hrow(name)
        return float(r[ci['total_hours']]) if r else None

    for r in rows:
        if r[ci['full_name']] and ('TEST_SEG_' in r[ci['full_name']] or 'TEST_SEG_N' in r[ci['full_name']]):
            print(f"  HR {r[ci['full_name']]}: hours={r[ci['total_hours']]} active={r[ci['active_mission']]}")

    check("HR-P1 خليط (Day1 قطع 5س + Day2 وراثة 4س) = 9", hval('TEST_SEG_P1'), 9.0)
    check("HR-P2 وراثة Day1 = 6", hval('TEST_SEG_P2'), 6.0)
    check("HR-P3 انفصال+عودة (8س) + Day2 وراثة (4س) = 12", hval('TEST_SEG_P3'), 12.0)
    check("HR-R1 محفوظ رغم إزالته (roster_active=false) = 3", hval('TEST_SEG_R1'), 3.0)
    check("HR-N1 مهمة عادية مبيت = 4", hval('TEST_SEG_N1'), 4.0)
    check("HR-N1 عدد مهام 1", hrow('TEST_SEG_N1')[ci['missions_count']], 1)

    # ── 7) تعديل خطة السير لا يمس القطاعات المسجلة ──
    # R1's segment hours only depend on mission_participant_sessions (explicit path). Change route times:
    cur.execute("UPDATE mission_itineraries SET departure_time='10:00', arrival_time='20:00' WHERE mission_id=%s AND group_title='اليوم الأول'", (oid,))
    conn.commit()
    cur.execute(hr); rows = cur.fetchall(); cols = [d[0] for d in cur.description]; ci = {c:i for i,c in enumerate(cols)}
    check("7 تعديل أوقات اليوم لا يغيّر قطاعات R1 (تبقى 3س)", hval('TEST_SEG_R1'), 3.0)
    check("7 P2 وراثة تغيّرت مع خطة السير (10→20 = 10س)", hval('TEST_SEG_P2'), 10.0)

    # ── 9) منطق idempotency لـ /join (فحص كود المصدر: رفض تكرار الفتح) ──
    has_guard_sql = (
        "SELECT 1 FROM mission_participant_sessions WHERE participant_id = %s AND itinerary_group = %s AND end_dt IS NULL" in src
        and '"already_joined": True' in src
    )
    print(f"[{'OK' if has_guard_sql else 'FAIL'}] 9 /join فحص idempotency موجود في المصدر (رفض تكرار الفتح)")
    if not has_guard_sql: failures.append("idempotency-guard")

finally:
    # ── تنظيف كامل لصفوف الاختبار ──
    try:
        cur.execute("DELETE FROM mission_participant_sessions WHERE participant_id IN (SELECT participant_id FROM mission_participants WHERE full_name LIKE 'TEST_SEG_%')")
        cur.execute("DELETE FROM mission_participant_itineraries WHERE mission_id IN (SELECT mission_id FROM missions WHERE mission_code LIKE 'TEST-SEG-%')")
        cur.execute("DELETE FROM mission_participants WHERE full_name LIKE 'TEST_SEG_%'")
        cur.execute("DELETE FROM mission_itineraries WHERE mission_id IN (SELECT mission_id FROM missions WHERE mission_code LIKE 'TEST-SEG-%')")
        cur.execute("DELETE FROM missions WHERE mission_code LIKE 'TEST-SEG-%'")
        conn.commit()
        print("\nCleanup done (TEST_SEG_* / TEST-SEG-*).")
    except Exception as e:
        conn.rollback(); print("cleanup warn:", e)
    conn.close()

print()
print("═" * 70)
print(f"SUMMARY — {'كل الاختبارات نجحت ✅' if not failures else 'فشل ' + str(len(failures)) + ' اختبار ❌'}")
if failures:
    print("  فاشلة:", *failures, sep="\n   - ")