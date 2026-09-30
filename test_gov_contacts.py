#!/usr/bin/env python3
"""
📞 اختبار انحدار لصفحة «سجل التواصل مع المحافظات»

يثبت — على قاعدة البيانات الحقيقية — أن:
  1) الجدول يُنشأ بمعرّف خفيف آمن للإعادة، وقيد (التاريخ، المحافظة) فريد.
  2) الحفظ جزئي بالحرف: خانة واحدة تُحدَّث ولا تُمحى باقي الخانات المحفوظة.
  3) المسح الصريح لخانة يعمل (فعل المستخدم).
  4) البيانات تظهر لمستخدم آخر على نفس اليوم (لا localStorage — السيرفر هو المصدر).
  5) نطاق الأقاليم مفروض على السيرفر: الأوبريشن لا يقرأ/يكتب خارج إقليمه (403).
  6) حساب إدارة الشباب والتطوع (READ_ONLY_MISSIONS) ممنوع تماماً من الصفحة (403).
  7) التصدير: المُفلتر من الجوكر فما فوق (الأوبريشن 403)، والسجل الشامل للمالك فقط.
  8) مسح الكل: المالك فقط + رمز التأكيد الصحيح.
  9) تحقق المدخلات: تاريخ/عدد/طول النص.
 10) لا مسار مفتوح بلا توكن (401/403).

تُنظَّف كل بيانات الاختبار (الصفوف والسجلات) في النهاية — لا تعديل على بيانات إنتاجية.
"""
import os
import sys

os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from fastapi.testclient import TestClient
from db import get_connection
from auth import create_access_token
import main as M

client = TestClient(M.app)
M.ensure_gov_contacts_schema()

conn = get_connection()
cur = conn.cursor()


def user_id_of(username):
    cur.execute("SELECT user_id FROM users WHERE username = %s AND is_active", (username,))
    r = cur.fetchone()
    return r[0] if r else None


def hdr(username):
    uid = user_id_of(username)
    return {"Authorization": f"Bearer {create_access_token(uid)}"} if uid else None


OWNER = hdr("mrabea.x")
JOKER = hdr("joker")
MANAGER = hdr("manager")
OPS_CANAL = hdr("operation.canal")
YOUTH = hdr("yveoc")

for name, h in [("owner", OWNER), ("joker", JOKER), ("operation.canal", OPS_CANAL), ("yveoc", YOUTH)]:
    if not h:
        print(f"user {name} not found — aborting")
        sys.exit(1)

TEST_DATE = "2027-02-20"
TEST_DATE_2 = "2027-02-21"
CANAL_BRANCH_IDS = sorted(M.regions_to_branch_ids({"canal"}))
PASS = FAIL = 0
AUDIT_MAX = 0
RT_MAX = 0
# 🛡️ نسخة من كل صفوف السجل الحقيقية قبل أي «مسح الكل» في الاختبار — تُعاد كما هي بعده.
#    (المستخدم بيجرّب الصفحة على نفس القاعدة: ممنوع أي اختبار يمسح شغله.)
SNAPSHOT = {}
SNAP_COLS = (
    "contact_id, contact_date, branch_id, reason, contact_count, phone_time, wireless_time, "
    "whatsapp_time, reply_time, notes, entered_by, created_at, updated_at"
)


def take_snapshot():
    cur.execute(f"SELECT {SNAP_COLS} FROM governorate_contacts")
    for r in cur.fetchall():
        # صفوف تواريخ الاختبار (اللي الاختبار نفسه أنشأها) لا تُحفظ في اللقطة — بيتمسحو في النهاية
        if r[1] and r[1].isoformat() in (TEST_DATE, TEST_DATE_2):
            continue
        SNAPSHOT[r[0]] = r


def restore_snapshot():
    for r in SNAPSHOT.values():
        cur.execute(
            f"INSERT INTO governorate_contacts ({SNAP_COLS}) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (contact_id) DO UPDATE SET reason = EXCLUDED.reason, contact_count = EXCLUDED.contact_count, "
            "phone_time = EXCLUDED.phone_time, wireless_time = EXCLUDED.wireless_time, whatsapp_time = EXCLUDED.whatsapp_time, "
            "reply_time = EXCLUDED.reply_time, notes = EXCLUDED.notes, entered_by = EXCLUDED.entered_by, "
            "updated_at = EXCLUDED.updated_at",
            tuple(r),
        )
    cur.execute(
        "SELECT setval(pg_get_serial_sequence('governorate_contacts', 'contact_id'), "
        "GREATEST(COALESCE((SELECT MAX(contact_id) FROM governorate_contacts), 1), 1))"
    )


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  OK  {name}" + (f"  [{extra}]" if extra else ""))
    else:
        FAIL += 1
        print(f"  XX  {name}" + (f"  [{extra}]" if extra else ""))


def row_for(branch_id, headers, date=TEST_DATE):
    r = client.get(f"/api/gov-contacts?date={date}", headers=headers)
    if r.status_code != 200:
        return None
    for row in r.json():
        if row["branch_id"] == branch_id:
            return row
    return None


def count_rows(date=TEST_DATE, branch_id=None):
    if branch_id is None:
        cur.execute("SELECT COUNT(*) FROM governorate_contacts WHERE contact_date = %s", (date,))
    else:
        cur.execute(
            "SELECT COUNT(*) FROM governorate_contacts WHERE contact_date = %s AND branch_id = %s",
            (date, branch_id),
        )
    return cur.fetchone()[0]


def cleanup():
    cur.execute(
        "DELETE FROM governorate_contacts WHERE contact_date IN (%s, %s)",
        (TEST_DATE, TEST_DATE_2),
    )
    restore_snapshot()  # 🛡️ إرجاع أي صف حقيقي اتأثر بـ«مسح الكل» داخل الاختبار
    # سجلات التدقيق والأحداث اللحظية التي أنشأها هذا الاختبار وحده (نافذة المعرّفات)
    try:
        cur.execute("DELETE FROM realtime_events WHERE event_id > %s AND event_type = 'gov_contact'", (RT_MAX,))
    except Exception:
        conn.rollback()
    cur.execute(
        "DELETE FROM audit_logs WHERE audit_id > %s AND entity_type = 'gov_contact'",
        (AUDIT_MAX,),
    )
    conn.commit()


try:
    cur.execute("SELECT to_regclass('public.governorate_contacts')")
    ok("الجدول موجود (ensure_gov_contacts_schema)", cur.fetchone()[0] is not None)
    try:
        take_snapshot()
        cur.execute("SELECT COALESCE(MAX(audit_id), 0) FROM audit_logs")
        AUDIT_MAX = cur.fetchone()[0]
        cur.execute("SELECT COALESCE(MAX(event_id), 0) FROM realtime_events")
        RT_MAX = cur.fetchone()[0]
    except Exception:
        conn.rollback()

    # ── (10) بلا توكن ───────────────────────────────────────────────
    r = client.get(f"/api/gov-contacts?date={TEST_DATE}")
    ok("GET بلا توكن مرفوض", r.status_code in (401, 403), str(r.status_code))
    r = client.post("/api/gov-contacts/batch", json={"date": TEST_DATE, "rows": []})
    ok("POST بلا توكن مرفوض", r.status_code in (401, 403), str(r.status_code))

    # ── (2) حفظ أولي كامل بواسطة الجوكر (نطاق عام) ─────────────────
    payload = {
        "date": TEST_DATE,
        "rows": [
            {
                "branch_id": 19,
                "reason": "معرفة وجود مهمات",
                "contact_count": 3,
                # ⏰ صيغة الآلة اللي بيبعتها حقل الوقت المقسّم في الواجهة (HH:MM — 24 ساعة)
                "whatsapp_time": "09:26",
                "notes": "تم الرد واتساب",
            }
        ],
    }
    r = client.post("/api/gov-contacts/batch", json=payload, headers=JOKER)
    ok("حفظ أولي (جوكر) → 200", r.status_code == 200, r.text[:120])
    row = row_for(19, JOKER)
    ok(
        "الصف المحفوظ يُقرأ كما هو",
        row and row["contact_count"] == 3 and row["whatsapp_time"] == "09:26" and row["notes"] == "تم الرد واتساب",
        str(row),
    )

    # ── (2) حفظ جزئي: خانة واحدة لا تمحو الباقي ─────────────────────
    r = client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 19, "reply_time": "10:01"}]},
        headers=JOKER,
    )
    ok("حفظ جزئي (خانة واحدة) → 200", r.status_code == 200, r.text[:120])
    row = row_for(19, JOKER)
    ok(
        "الحفظ الجزئي لا يمحو باقي الخانات",
        row and row["contact_count"] == 3 and row["whatsapp_time"] == "09:26"
        and row["notes"] == "تم الرد واتساب" and row["reply_time"] == "10:01",
        str(row),
    )

    # ── «سبب الاتصال» نص حقيقي في القاعدة دايماً (يظهر في تصدير Excel) ─
    r = client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 13, "notes": "مغلق"}]},
        headers=JOKER,
    )
    row = row_for(13, JOKER)
    ok(
        "حفظ بلا «سبب الاتصال» يُثبّت الافتراضي في القاعدة",
        r.status_code == 200 and row and row["reason"] == M.GOV_CONTACT_DEFAULT_REASON,
        str(row),
    )
    client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 13, "contact_count": 4}]},
        headers=JOKER,
    )
    ok(
        "تحديث بلا «سبب الاتصال» لا يمحو السبب المخزَّن",
        row_for(13, JOKER)["reason"] == M.GOV_CONTACT_DEFAULT_REASON,
        str(row_for(13, JOKER)["reason"]),
    )
    client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 13, "reason": "متابعة تصعيد"}]},
        headers=JOKER,
    )
    ok("السبب المخصص يُحفظ", row_for(13, JOKER)["reason"] == "متابعة تصعيد", str(row_for(13, JOKER)["reason"]))
    client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 13, "whatsapp_time": "11:15"}]},
        headers=JOKER,
    )
    ok(
        "السبب المخصص يُحفظ وميتمسحش بتحديث لاحق",
        row_for(13, JOKER)["reason"] == "متابعة تصعيد",
        str(row_for(13, JOKER)["reason"]),
    )
    r = client.get(f"/api/gov-contacts/log?from_date={TEST_DATE}&to_date={TEST_DATE}", headers=JOKER)
    exported = (r.json() if r.status_code == 200 else [])
    ok(
        "المسبب المحفوظ ظاهر في التصدير كنص",
        any(d["branch_id"] == 13 and d["reason"] == "متابعة تصعيد" for d in exported),
        str([(d["branch_id"], d["reason"]) for d in exported]),
    )

    # ── (3) المسح الصريح لخانة ──────────────────────────────────────
    r = client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 19, "whatsapp_time": None}]},
        headers=JOKER,
    )
    row = row_for(19, JOKER)
    ok("المسح الصريح لخانة يعمل", r.status_code == 200 and row and row["whatsapp_time"] is None and row["contact_count"] == 3, str(row))

    # ── (4) مستخدم آخر يرى نفس البيانات (جهاز آخر) ─────────────────
    row_owner = row_for(19, OWNER)
    ok(
        "مستخدم آخر (المالك) يرى نفس الحفظ على السيرفر",
        row_owner and row_owner["contact_count"] == 3 and row_owner["notes"] == "تم الرد واتساب",
        str(row_owner),
    )

    # ── (1) لا تكرار: نفس المحافظة مرتين → صف واحد ─────────────────
    client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 19, "notes": "مغلق"}]},
        headers=JOKER,
    )
    client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 19, "notes": "مغلق"}]},
        headers=JOKER,
    )
    ok("صف واحد لكل (يوم × محافظة) — لا تكرار", count_rows(TEST_DATE, 19) == 1, str(count_rows(TEST_DATE, 19)))

    # ── (5) نطاق الأوبريشن ─────────────────────────────────────────
    r = client.get(f"/api/gov-contacts?date={TEST_DATE}", headers=OPS_CANAL)
    ok("أوبريشن القنال يقرأ الصفحة", r.status_code == 200, str(r.status_code))
    ids = sorted({row["branch_id"] for row in r.json()})
    ok("قراءة الأوبريشن محدودة بإقليمه", all(i in CANAL_BRANCH_IDS for i in ids), str(ids))
    ok("المحافظة خارج الإقليم غير ظاهرة للجوكر", row_for(19, OPS_CANAL) is None)

    r = client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": 19, "notes": "تم الرد هاتفيا"}]},
        headers=OPS_CANAL,
    )
    ok("كتابة الأوبريشن خارج إقليمه مرفوضة (403)", r.status_code == 403, str(r.status_code))
    ok("المحاولة المرفوضة لم تكتب شيئاً", row_for(19, JOKER)["notes"] == "مغلق")

    r = client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE, "rows": [{"branch_id": CANAL_BRANCH_IDS[0], "contact_count": 1, "reason": "معرفة وجود مهمات"}]},
        headers=OPS_CANAL,
    )
    ok("كتابة الأوبريشن داخل إقليمه مقبولة", r.status_code == 200, r.text[:120])
    ok("الأوبريشن يرى كتابته", row_for(CANAL_BRANCH_IDS[0], OPS_CANAL) is not None)
    ok("الجوكر يرى كتابة الأوبريشن", row_for(CANAL_BRANCH_IDS[0], JOKER) is not None)

    # ── (6) حساب إدارة الشباب والتطوع ممنوع ────────────────────────
    ok("الحساب المستبعد: GET → 403", client.get(f"/api/gov-contacts?date={TEST_DATE}", headers=YOUTH).status_code == 403)
    ok(
        "الحساب المستبعد: POST → 403",
        client.post(
            "/api/gov-contacts/batch",
            json={"date": TEST_DATE, "rows": [{"branch_id": 19, "notes": "تم الرد هاتفيا"}]},
            headers=YOUTH,
        ).status_code == 403,
    )
    ok(
        "الحساب المستبعد: التصدير → 403",
        client.get(f"/api/gov-contacts/log?from_date={TEST_DATE}&to_date={TEST_DATE}", headers=YOUTH).status_code == 403,
    )
    ok(
        "الحساب المستبعد: مسح الكل → 403",
        client.post("/api/gov-contacts/clear-all", json={"confirmation_code": M.CLEAR_ALL_CONFIRMATION_CODE}, headers=YOUTH).status_code == 403,
    )

    # ── (9) تحقق المدخلات ──────────────────────────────────────────
    ok("تاريخ غير صحيح → 400", client.get("/api/gov-contacts?date=20-02-2027", headers=JOKER).status_code == 400)
    ok(
        "عدد مرات الاتصال > 999 → 400",
        client.post(
            "/api/gov-contacts/batch",
            json={"date": TEST_DATE, "rows": [{"branch_id": 19, "contact_count": 5000}]},
            headers=JOKER,
        ).status_code == 400,
    )
    ok(
        "ملاحظة طويلة جداً → 400",
        client.post(
            "/api/gov-contacts/batch",
            json={"date": TEST_DATE, "rows": [{"branch_id": 19, "notes": "x" * 300}]},
            headers=JOKER,
        ).status_code == 400,
    )
    ok(
        "حمولة بلا أي حقل → لا كتابة (saved=0)",
        client.post("/api/gov-contacts/batch", json={"date": TEST_DATE, "rows": [{"branch_id": 19}]}, headers=JOKER).json().get("saved") == 0,
    )

    # ── (7) التصدير ────────────────────────────────────────────────
    r = client.get(f"/api/gov-contacts/log?from_date={TEST_DATE}&to_date={TEST_DATE}", headers=OPS_CANAL)
    ok("الأوبريشن لا يصدّر (403)", r.status_code == 403, str(r.status_code))
    r = client.get(f"/api/gov-contacts/log?from_date={TEST_DATE}&to_date={TEST_DATE}", headers=JOKER)
    ok("الجوكر يصدّر بفلتر التاريخ (200)", r.status_code == 200, r.text[:120])
    if r.status_code == 200:
        data = r.json()
        ok("المُصدَّر داخل نطاق التاريخ", all(d["contact_date"] == TEST_DATE for d in data), str(len(data)))
        ok("المُصدَّر يحتوي المحافظة المحفوظة", any(d["branch_id"] == 19 for d in data))
    ok("الجوكر لا يصدّر السجل الشامل (403)", client.get("/api/gov-contacts/log?all=true", headers=JOKER).status_code == 403)
    r = client.get("/api/gov-contacts/log?all=true", headers=OWNER)
    ok("المالك يصدّر السجل الشامل (200)", r.status_code == 200, r.text[:120])
    if r.status_code == 200:
        ok("السجل الشامل يشمل كل التواريخ", any(d["branch_id"] == 19 for d in r.json()))

    r = client.post("/api/gov-contacts/export-log", json={"kind": "filtered"}, headers=JOKER)
    ok("تسجيل تنزيل المُفلتر (جوكر) → 200", r.status_code == 200, r.text[:120])
    ok("تسجيل تنزيل الشامل (جوكر) → 403", client.post("/api/gov-contacts/export-log", json={"kind": "full"}, headers=JOKER).status_code == 403)

    # ── (8) مسح الكل ───────────────────────────────────────────────
    take_snapshot()  # لقطة أخيرة قبل المسح — تُعاد بعده بالكامل
    ok("مسح الكل بدون رمز صحيح → 400", client.post("/api/gov-contacts/clear-all", json={"confirmation_code": "000000"}, headers=OWNER).status_code == 400)
    ok("مسح الكل (جوكر) → 403", client.post("/api/gov-contacts/clear-all", json={"confirmation_code": M.CLEAR_ALL_CONFIRMATION_CODE}, headers=JOKER).status_code == 403)
    ok("المسح المرفوض لم يحذف شيئاً", count_rows(TEST_DATE) > 0, str(count_rows(TEST_DATE)))
    r = client.post("/api/gov-contacts/clear-all", json={"confirmation_code": M.CLEAR_ALL_CONFIRMATION_CODE}, headers=OWNER)
    ok("المالك + الرمز الصحيح → مسح كامل", r.status_code == 200 and r.json().get("deleted_count", 0) > 0, r.text[:120])
    ok("لا صفوف بعد المسح", count_rows(TEST_DATE) == 0, str(count_rows(TEST_DATE)))

    # ── (2) سجل التدقيق يُكتب للحفظ غير الصامت ─────────────────────
    client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE_2, "rows": [{"branch_id": 19, "notes": "لم يتم الرد"}]},
        headers=JOKER,
    )
    cur.execute(
        "SELECT COUNT(*) FROM audit_logs WHERE entity_type = 'gov_contact' AND audit_id > %s",
        (AUDIT_MAX,),
    )
    ok("سجل التدقيق يوثّق التعديل", cur.fetchone()[0] > 0)
    r = client.post(
        "/api/gov-contacts/batch",
        json={"date": TEST_DATE_2, "silent": True, "rows": [{"branch_id": 19, "contact_count": 2}]},
        headers=JOKER,
    )
    ok("الحفظ اللحظي الصامت يعمل", r.status_code == 200 and row_for(19, JOKER, TEST_DATE_2)["contact_count"] == 2)

finally:
    try:
        cleanup()
    except Exception as e:
        print(f"cleanup error: {e}")
    conn.close()

print(f"\n{'=' * 46}\nنتيجة: {PASS}/{PASS + FAIL} ناجح\n{'=' * 46}")
sys.exit(1 if FAIL else 0)
