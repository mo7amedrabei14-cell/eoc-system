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
check("4 خليط Day1 قطعتان = 8س (القطاعات تسود — لا وراثة تُضاف فوقها)",
      compute_working_hours(open_m, 'نشطة', seg_d1, ['اليوم الأول', 'اليوم الثاني'], routes_open), 8.0)

# ── وراثة كاملة بلا قطاعات: Day1 6س + Day2 مبيت 4س = 10 ──
check("5 وراثة كاملة = 10س", compute_working_hours(open_m, 'نشطة', [], ['اليوم الأول', 'اليوم الثاني'], routes_open), 10.0)

# ── 6) مهمة عادية: مدة المهمة دون تغيير 10س (08:00→18:00) ──
normal_m = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '08:00', 'arrival_date': '2026-09-08', 'arrival_time': '18:00'}
check("6 عادية حية now=الوصول → 10س", compute_working_hours(normal_m, 'نشطة', [], [], [], now=datetime.datetime(2026,9,8,18,0)), 10.0)

# ── 3) انفصال+عودة في عادية: قطعتان 6+2 = 8 (المهمة 10س تبقى للمهمة نفسها) ──
seg_n = [{'start_dt': datetime.datetime(2026,9,8,8,0), 'end_dt': datetime.datetime(2026,9,8,14,0)},
         {'start_dt': datetime.datetime(2026,9,8,17,0), 'end_dt': datetime.datetime(2026,9,8,19,0)}]
seg_n2 = [{'start_dt': datetime.datetime(2026,9,8,8,0), 'end_dt': datetime.datetime(2026,9,8,14,0)},
         {'start_dt': datetime.datetime(2026,9,8,17,0), 'end_dt': datetime.datetime(2026,9,8,19,0)}]
check("7 عادية انفصال+عودة = 8س", compute_working_hours(normal_m, 'نشطة', seg_n2, [], []), 8.0)
check("8 عادية بلا قطع حية now=الوصول → 10س", compute_working_hours(normal_m, 'نشطة', [], [], [], now=datetime.datetime(2026,9,8,18,0)), 10.0)

# ── 6) مهمة عادية مبيت: انطلاق 23:00 → انتهاء 03:00 اليوم التالي = 4س ──
normal_ovn = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '23:00', 'completion_date': '2026-09-09', 'completion_time': '03:00'}
check("6b عادية مبيت حية now=04:00 → 4س", compute_working_hours(normal_ovn, 'نشطة', [], [], [], now=datetime.datetime(2026,9,9,4,0)), 4.0)

# ── 7) قطاع مفتوح على مهمة مكتملة يُسقف بنهاية المهمة ──
compl_m = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '08:00', 'completion_date': '2026-09-08', 'completion_time': '18:00'}
seg_open = [{'start_dt': datetime.datetime(2026,9,8,16,0), 'end_dt': None}]
check("7 قطاع مفتوح على مكتملة → حتى 18:00 = 2س", compute_working_hours(compl_m, 'Completed', seg_open, [], []), 2.0)

# ── قطاع بلا يوم في مفتوحة (نادرة) يُضاف مستقلاً مع وراثة باقي الأيام ──
seg_stray = [{'start_dt': datetime.datetime(2026,9,8,15,0), 'end_dt': datetime.datetime(2026,9,8,16,0)}]  # بلا group
check("7b قطاع بلا يوم = 1س (يوجد قطاع ⇒ مجموع القطاعات فقط، لا وراثة)",
      compute_working_hours(open_m, 'نشطة', seg_stray, ['اليوم الأول'], routes_open), 1.0)

# ═══════════════════════════════════════════════════════════════════════════
#  الجزء A.2 — المحرك الموحد: ساعات حية (now مُثبَّت) + لا انحياز للتصنيف
# ═══════════════════════════════════════════════════════════════════════════
print()
print("═" * 70)
print(" الجزء A.2 — ساعات العمل الحية (ساعة مثبتة) + المحرك الموحد")
print("═" * 70)

one = datetime.datetime
live_m = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '10:00',
          'arrival_date': '2026-09-08', 'arrival_time': '17:00'}
T09 = one(2026, 9, 8, 9, 0); T12 = one(2026, 9, 8, 12, 0)
T17 = one(2026, 9, 8, 17, 0); T18 = one(2026, 9, 8, 18, 0)

check("L1 حية بلا قطع now=17 → 7س", compute_working_hours(live_m, 'نشطة', [], [], [], now=T17), 7.0)
check("L2 حية بلا قطع now=12 → ساعتان فقط", compute_working_hours(live_m, 'نشطة', [], [], [], now=T12), 2.0)
check("L3 سقف الخطة now=18 (بعد الوصول) → 7س", compute_working_hours(live_m, 'نشطة', [], [], [], now=T18), 7.0)
check("L4 حارس now قبل الانطلاق → 0", compute_working_hours(live_m, 'نشطة', [], [], [], now=T09), 0.0)

ovn = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '23:00',
       'arrival_date': '2026-09-09', 'arrival_time': '03:00'}
check("L5 مبيت حي now=+1 01:00 → 2س", compute_working_hours(ovn, 'نشطة', [], [], [], now=one(2026, 9, 9, 1, 0)), 2.0)
check("L6 مبيت حي now=+1 04:00 → 4س (مقيد بالوصول 03:00)", compute_working_hours(ovn, 'نشطة', [], [], [], now=one(2026, 9, 9, 4, 0)), 4.0)

comp_m2 = {'mission_classification': 'عادية', 'departure_date': '2026-09-08', 'departure_time': '10:00',
           'arrival_date': '2026-09-08', 'arrival_time': '17:00'}
check("L7 مكتملة متجمّدة حتى لو now=18 → 7س", compute_working_hours(comp_m2, 'Completed', [], [], [], now=T18), 7.0)

# المساواة بين التصنيفين: نفس المدخلات ⇒ نفس الناتج (عادية ≡ مفتوحة)
def cfree(m, status, seg, days, routes, now=None):
    a = compute_working_hours({**m, 'mission_classification': 'عادية'}, status, seg, days, routes, now=now)
    b = compute_working_hours({**m, 'mission_classification': 'مفتوحة'}, status, seg, days, routes, now=now)
    return a, b

a1, b1 = cfree(live_m, 'نشطة', [], [], [], now=T12)
check("L8 لا تصنيف (حية بلا أيام) — القيمتان متساويتان", a1, b1)
check("L8b القيمة الحقيقية 2", a1, 2.0)
a2, b2 = cfree(open_m, 'نشطة', seg_n2, [], [], now=T12)
check("L9 لا تصنيف (بقطاعات) — متساويتان", a2 == b2, True)
a3, b3 = cfree(open_m, 'نشطة', seg_d1, ['اليوم الأول', 'اليوم الثاني'], routes_open, now=T12)
check("L10 لا تصنيف (بأيام مخصصة) — متساويتان", a3 == b3, True)

# القاعدة 2: قطاعات بلا أيام مخصصة ⇒ مجموعها الفعلي (لا تصنيف)
check("L11 قاعدة2 بلا أيام → مجموع القطع = 8س",
      compute_working_hours(open_m, 'نشطة', seg_n2, [], routes_open, now=T18), 8.0)

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

    # مرساة زمنية من قاعدة البيانات نفسها (لا افتراض بمنطقة محلية) —
    # نُثبّت مهام الانحدار في الماضي لنتائج حتمية خالية من "زمن مستقبلي".
    cur.execute("SELECT CURRENT_DATE")
    db_today = cur.fetchone()[0]
    past = db_today - datetime.timedelta(days=2)

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
    m = re.search(r'\n\s+"""(?=[,\)]|,\(now_ref)', src[hr_start:])
    if not m:
        raise SystemExit("HR closing not found")
    hr = src[hr_start:hr_start + m.start() + 1]
    hr = hr[hr.index('WITH ident AS'):]
    # The live-hours 'now' placeholders are bound as params at run time; run them
    # standalone here as NULL → LOCALTIMESTAMP (same values the query would bind).
    hr = hr.replace('%s::timestamp', 'NULL::timestamp')
    cur.execute(hr)
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    ci = {c: i for i, c in enumerate(cols)}

    def hrow(name):
        return next((r for r in rows if r[ci['full_name']] == name), None)

    def hval(name):
        r = hrow(name)
        return float(r[ci['total_hours']]) if r else None

    def hcol(name, col):
        r = hrow(name)
        return float(r[ci[col]]) if r else None

    for r in rows:
        if r[ci['full_name']] and ('TEST_SEG_' in r[ci['full_name']] or 'TEST_SEG_N' in r[ci['full_name']]):
            print(f"  HR {r[ci['full_name']]}: hours={r[ci['total_hours']]} active={r[ci['active_mission']]}")

    # fix#6: القطاعات تسود — Day1 قطاع (5س) فقط، لا وراثة فوقه ⇒ 5 (مهمة حية، لاها لا)
    check("HR-P1 خليط (قطاعات فقط = 5س — لا وراثة فوق القطع)", hval('TEST_SEG_P1'), 5.0)
    # fix#6 + checkbox: بلا قطع → وراثة نافذة Day1 لكن مع بداية المهمة (00:01) ⇒ حية ≈ 14 (زمن-الآن)
    check("HR-P2 وراثة Day1 حية (now−بداية المهمة 00:01) ≈ 14", hval('TEST_SEG_P2'), 14.0)
    # fix#6: قطعتا Day1 فقط (8س) — لا وراثة فوق القطع ⇒ 8
    check("HR-P3 انفصال+عودة فقط = 8س (مهمة حية)", hval('TEST_SEG_P3'), 8.0)
    check("HR-R1 محفوظ رغم إزالته (roster_active=false) = 3", hval('TEST_SEG_R1'), 3.0)
    check("HR-N1 مهمة عادية مبيت = 4", hval('TEST_SEG_N1'), 4.0)
    check("HR-N1 عدد مهام 1", hrow('TEST_SEG_N1')[ci['missions_count']], 1)

    # ── 7) تعديل خطة السير لا يمس القطاعات المسجلة ──
    # R1's segment hours only depend on mission_participant_sessions (explicit path). Change route times:
    cur.execute("UPDATE mission_itineraries SET departure_time='10:00', arrival_time='20:00' WHERE mission_id=%s AND group_title='اليوم الأول'", (oid,))
    conn.commit()
    cur.execute(hr); rows = cur.fetchall(); cols = [d[0] for d in cur.description]; ci = {c:i for i,c in enumerate(cols)}
    check("7 تعديل أوقات اليوم لا يغيّر قطاعات R1 (تبقى 3س)", hval('TEST_SEG_R1'), 3.0)
    check("7 P2 وراثة حية بعد تعديل الخطة (now−بداية المهمة) ≈ 20", hval('TEST_SEG_P2'), 20.0)

    # ── عدد ساعات آخر مهمة (العمود الجديد قبل إجمالي الساعات) ──
    check("HR-P1 آخر مهمة = 5س (قطاعات فقط)", hcol('TEST_SEG_P1', 'last_mission_hours'), 5.0)
    check("HR-P2 آخر مهمة = 20س", hcol('TEST_SEG_P2', 'last_mission_hours'), 20.0)
    check("HR-R1 آخر مهمة = 3س (محفوظ رغم الإزالة)", hcol('TEST_SEG_R1', 'last_mission_hours'), 3.0)
    check("HR-N1 آخر مهمة = 4س", hcol('TEST_SEG_N1', 'last_mission_hours'), 4.0)
    check("HR-P1 آخر مهمة == إجمالي الساعات (مهمة واحدة)", hcol('TEST_SEG_P1', 'last_mission_hours'), hval('TEST_SEG_P1'))

    # ═══════════════════════════════════════════════════════════════════════
    #  المحرك الموحد — محاكاة GET تماماً (نفس الاستعلامات التي تُبنى بها
    #  المشاركة/الساعات في main.py) لفحص هوية المهمة عند نمو خط السير.
    # ═══════════════════════════════════════════════════════════════════════
    def get_like(mid, pid):
        cur.execute("SELECT * FROM missions WHERE mission_id = %s", (mid,))
        row = cur.fetchone()
        if not row: return None
        m = dict(zip([d[0] for d in cur.description], row))
        for k, v in list(m.items()):
            if v is not None and not isinstance(v, (str, int, float, bool)): m[k] = str(v)
        cur.execute("SELECT group_title, route_from, route_to, departure_time, arrival_time, departure_date, arrival_date FROM mission_itineraries WHERE mission_id = %s", (mid,))
        m['routes'] = [{"group_title": r[0], "route_from": r[1] or "", "route_to": r[2], "departure_time": str(r[3]) if r[3] else "", "arrival_time": str(r[4]) if r[4] else "", "departure_date": str(r[5]) if r[5] else "", "arrival_date": str(r[6]) if r[6] else ""} for r in cur.fetchall()]
        cur.execute("SELECT participant_id, participant_type, full_name, team_name, team_code, participation_role, participant_position, volunteer_id, user_id, membership_number, branch_id, assigned_itinerary, return_status, phase_name, stay_type, start_from_mission FROM mission_participants WHERE mission_id = %s AND roster_active = true ORDER BY participant_id", (mid,))
        found = None
        for r in cur.fetchall():
            if r[0] != pid: continue
            cur.execute("SELECT session_date, check_in_time, check_out_time, notes, start_dt, end_dt, itinerary_group FROM mission_participant_sessions WHERE participant_id = %s ORDER BY COALESCE(start_dt, session_date), start_dt", (pid,))
            segments = [{"session_date": str(s[0]) if s[0] else "", "check_in_time": str(s[1]) if s[1] else "", "check_out_time": str(s[2]) if s[2] else "", "notes": s[3], "start_dt": main.fmt_dt(s[4]), "end_dt": main.fmt_dt(s[5]), "itinerary_group": s[6]} for s in cur.fetchall()]
            cur.execute("SELECT itinerary_group FROM mission_participant_itineraries WHERE participant_id = %s ORDER BY itinerary_group", (pid,))
            days = [d[0] for d in cur.fetchall()]
            found = {
                "participant_id": r[0], "classification": m.get("mission_classification"),
                "status": compute_participant_status(m.get("status"), r[12], segments),
                "working_hours": compute_working_hours(m, m.get("status"), segments, days, m["routes"], start_from_mission=(r[15] is not False)),
                "segments": segments, "seg_count": len(segments), "assigned_days": days,
            }
        return found

    # ── نمو خط السير يحفظ الهوية: بلا أيام/قطع ⇒ مدة المهمة المتجمدة لا تتأثر ──
    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, created_at,
                              departure_date, departure_time, completion_date, completion_time)
        VALUES (%s, 'TEST_SEG_GROW', 'عادية', 19, 'Completed', NOW(),
                %s, '09:00', %s, '13:00')
        RETURNING mission_id
    """, (code + '-G', past, past))
    gid = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_SEG_G1','volunteer',19,'تم انتهاء مهمتة') RETURNING participant_id", (gid,))
    g1 = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_from, route_to, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'خط السير الأساسي','القاهرة','الجيزة',%s,'09:00',%s,'13:00')", (gid, past, past))
    conn.commit()

    base = get_like(gid, g1)
    check("G1 المهمة نفسها 'عادية'", base['classification'], 'عادية')
    check("G2 بلا أيام وقطع → مدة المهمة متجمّدة 4س", base['working_hours'], 4.0)
    check("G3 صفر قطاعات مبدئياً", base['seg_count'], 0)

    # النمو عبر PUT-equivalent: خط أساسي ثانٍ + مجموعة مخصصة + تعديل أوقات مسار
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_from, route_to, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'خط السير الأساسي','القاهرة','المعادي',%s,'10:00',%s,'12:00')", (gid, past, past))
    cur.execute("INSERT INTO mission_itineraries (mission_id, group_title, route_from, route_to, departure_date, departure_time, arrival_date, arrival_time) VALUES (%s,'اليوم الميداني','القاهرة','العبور',%s,'08:00',%s,'20:00')", (gid, past, past))
    cur.execute("UPDATE mission_itineraries SET departure_time = '07:00' WHERE mission_id = %s AND route_to = 'الجيزة'", (gid,))
    conn.commit()

    after = get_like(gid, g1)
    check("G4 نفس المشارك (participant_id محفوظ)", after['participant_id'], base['participant_id'])
    check("G5 التصنيف لم ينقلب لمفتوحة (هوية)", after['classification'], 'عادية')
    check("G6 لا قطع جديدة بعد النمو", after['seg_count'], 0)
    check("G7 ساعات المتجمّدة لم تتغيّر بخط السير وحده", after['working_hours'], base['working_hours'])
    check("G7b تساوي فعلي 4", after['working_hours'], 4.0)

    # تخصيص يوم بعد النمو ⇒ القاعدة 1 (نافذة المجموعة المخصصة 08→20 = 12س)
    cur.execute("INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) VALUES (%s,%s,'اليوم الميداني')", (g1, gid))
    conn.commit()
    assigned = get_like(gid, g1)
    check("G8 مع التخصيص + مكتملة ⇒ تجمّد عند مدى المهمة 09:00→13:00 = 4س (لا نافذة المسار)", assigned['working_hours'], 4.0)

    cur.execute(hr); rows = cur.fetchall(); cols = [d[0] for d in cur.description]; ci = {c:i for i,c in enumerate(cols)}
    check("G9 HR-G1 آخر مهمة = 4س (تجمّد المكتملة)", hcol('TEST_SEG_G1', 'last_mission_hours'), 4.0)
    check("G9b HR-G1 الإجمالي = 4س (مجموع حقيقي)", hcol('TEST_SEG_G1', 'total_hours'), 4.0)

    # ═══════════════════════════════════════════════════════════════════════
    #  الإصلاح الجذري لـ HTTP 500: تسجيل انفصال بلا segment مفتوح
    #  لم يَعُد يخالف NOT NULL على session_date
    # ═══════════════════════════════════════════════════════════════════════
    cur.execute("SELECT is_nullable FROM information_schema.columns WHERE table_name='mission_participant_sessions' AND column_name='session_date'")
    check("M1 session_date أصبح nullable (DROP NOT NULL)", cur.fetchone()[0], 'YES')

    cur.execute("""
        INSERT INTO missions (mission_code, mission_name, mission_classification, branch_id, status, created_at,
                              departure_date, departure_time, completion_date, completion_time)
        VALUES (%s, 'TEST_SEG_LEAVE', 'عادية', 19, 'Completed', NOW(), %s, '08:00', %s, '14:00')
        RETURNING mission_id
    """, (code + '-L', past, past))
    lid = cur.fetchone()[0]
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_SEG_L1','volunteer',19,'مازال بالمهمة') RETURNING participant_id", (lid,))
    l1 = cur.fetchone()[0]
    conn.commit()
    leave_dt = datetime.datetime.combine(past, datetime.time(10, 30))

    # (أ) شكل الـ drop الجديد: session_date=تاريخ — ينجح بلا 500
    try:
        cur.execute("""INSERT INTO mission_participant_sessions
                       (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, itinerary_group, notes)
                       VALUES (%s, %s, %s, %s, NULL, %s, NULL, 'انفصال')""",
                    (l1, lid, leave_dt.date(), leave_dt.time(), leave_dt))
        conn.commit(); drop_ok = True
    except Exception as e:
        conn.rollback(); drop_ok = False; print("  ! drop insert فشل:", e)
    check("M2 مسار الـ drop (session_date بتاريخ) ينجح — لا 500", drop_ok, True)

    # (ب) الشكل القديم NULL أصبح مسموحاً أيضاً (تحزُّم إضافي)
    try:
        cur.execute("INSERT INTO mission_participant_sessions (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, itinerary_group, notes) VALUES (%s, %s, NULL, NULL, NULL, %s, NULL, 'انفصال')", (l1, lid, leave_dt))
        conn.commit(); legacy_ok = True
    except Exception as e:
        conn.rollback(); legacy_ok = False; print("  ! legacy NULL insert فشل:", e)
    check("M3 الشكل القديم (session_date=NULL) لم يَعُد مرفوضاً", legacy_ok, True)

    # (ج) الاثنان start_dt=NULL ⇒ لا يُحتسبان (ساعات L1 = 0 — لا ساعات وهمية)
    gl = get_like(lid, l1)
    check("M4 قطعتا انفصال مسجلتان", gl['seg_count'], 2)
    check("M5 قطعتا القطع start_dt فارغ (غير محتسبتين)", gl['segments'][1]['start_dt'] is None, True)
    check("M6 ساعات L1 = 0 (لا شيء يُحتسب — لا وهمية)", gl['working_hours'], 0.0)

    # (د) سجل انفصال حقيقي ببداية مرجعية (08:00→10:30 = 2.5س) — الرحل الطبيعي للعادية
    cur.execute("INSERT INTO mission_participants (mission_id, full_name, participant_type, branch_id, return_status) VALUES (%s,'TEST_SEG_L2','volunteer',19,'تم انتهاء مهمتة') RETURNING participant_id", (lid,))
    l2 = cur.fetchone()[0]
    cur.execute("""INSERT INTO mission_participant_sessions
                   (participant_id, mission_id, session_date, check_in_time, start_dt, end_dt, itinerary_group, notes)
                   VALUES (%s, %s, %s, %s, %s, %s, NULL, 'انفصال (من بداية المشاركة)')""",
                (l2, lid, leave_dt.date(), leave_dt.time(),
                 datetime.datetime.combine(past, datetime.time(8, 0)), leave_dt))
    conn.commit()
    gl2 = get_like(lid, l2)
    check("M7 انفصال ببداية مرجعية = 2.5س (يُحتسب طبيعياً)", gl2['working_hours'], 2.5)

    # ── 9) منطق idempotency لـ /join (فحص كود المصدر: رفض تكرار الفتح) ──
    has_guard_sql = (
        "SELECT 1 FROM mission_participant_sessions WHERE participant_id = %s AND itinerary_group = %s AND end_dt IS NULL" in src
        and '"already_joined": True' in src
    )
    print(f"[{'OK' if has_guard_sql else 'FAIL'}] 9 /join فحص idempotency موجود في المصدر (رفض تكرار الفتح)")
    if not has_guard_sql: failures.append("idempotency-guard")

    # ── 10) عقد إصلاح الـ 500 (فحص كود المصدر): لا إدراج بـ session_date=NULL ──
    old_null_omit = "VALUES (%s, %s, NULL, NULL, NULL, %s, %s, 'انفصال')" not in src
    new_drop_fix = (
        "VALUES (%s, %s, %s, %s, NULL, %s, %s, 'انفصال')" in src
        and "leave_dt.date()" in src
        and "start_dt, end_dt, itinerary_group, notes" in src
    )
    no500_contract = old_null_omit and new_drop_fix
    print(f"[{'OK' if no500_contract else 'FAIL'}] 10 إصلاح الـ 500 في المصدر (drop-path يكتب session_date=تاريخ، لا NULL)")
    if not no500_contract: failures.append("leave-no500-source")

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