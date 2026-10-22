"""
قناة الأحداث اللحظية (Realtime Events)

نظيفة عن audit: جدول خفيف (realtime_events) مخصص للإشعارات الفورية.
الميزة الأساسية هنا أن *الـ backend* هو اللي بيحدد المستلم بالـ user_id
(مش مقارنة بالأسماء زي ما كان حاصل قبل كده في الـ frontend).

المنطق:
- الحدث من متطوع (إنشاء/تحديث) → broadcast للأدوار المصرح لها ضمنياً (الرتب العليا + متطوعي نفس الفروع).
- الحدث من رتبة عليا على مهمة (اعتماد/إرجاع/إنهاء/تحديث) → target_user_id = صاحب المهمة (أول من أنشأها)
  حتى يصله الإشعار فوراً مهما كان فرعه.
"""

import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, Any, Dict
from psycopg.types.json import Jsonb

# ─────────────────────────────────────────────────────────────────────────────
# 🛡️ حارس التكرار — علاج جذري لتكرار الإشعارات
#
# المشكلة اللي كانت بتحصل فعلًا في الإنتاج (مقيسة من قاعدة البيانات):
#   • نفس الحركة تتسجّل صفّين في نفس الثانية (طلب مكرر / إعادة إرسال بعد timeout)
#       global_disaster  ent=28  → «رصد كارثة عالمية» مرتين، الفارق 0 ثانية
#       global_disaster  ent=26  → «حذف كارثة عالمية» مرتين، الفارق 0 ثانية
#   • وزلزال واحد يتسجّل باسمين مختلفين في نفس الثانية:
#       earthquake  ent=41  → «إضافة زلزال» + «إضافة زلزال محلي»
#
# فالحماية هُنا: قبل أي INSERT، نقارن بالفعل الأخير لنفس (النوع + السجل + الفاعل)
# داخل نافذة زمنية قصيرة. لو النص هو نفسه بعد التطبيع أو واحد يحتوي الآخر
# (إضافة زلزال ⊂ إضافة زلزال محلي) ⇒ دي نفس الحركة مكرّرة ⇒ لا نكتب إشعارًا تاني.
#
# ملاحظات مهمة:
#   - لا نلمس audit_logs إطلاقًا: سجل النظام القانوني بيفضل كامل بكل صف.
#   - التغيير في تدفق الإشعارات فقط، مش في الـ API ولا الصلاحيات ولا منطق العمل.
#   - حركتان مختلفتان فعلًا («انضمام» ثم «انفصال») لا تُدمجان أبدًا.
#   - تقدر توقف الحارس بضبط EOC_REALTIME_DEDUPE=0 لو احتجت.
# ─────────────────────────────────────────────────────────────────────────────
import os

DEDUPE_WINDOW_SECONDS = 12
DEDUPE_ENABLED = os.getenv("EOC_REALTIME_DEDUPE", "1") not in ("0", "false", "False")

# كلمات «نطاق» بتفرق بين نصّين لنفس الحركة الواحدة (زلزال عالمي/محلي = نفس الزلزال للمستخدم)
_SCOPE_RE = re.compile(r"\b(?:محلي|محلية|عالمي|عالمية|دولي|دولية|بمصر|مصر)\b")


def _normalize_action(text: Optional[str]) -> str:
    """تطبيع نص الحركة: تشكيل/تطويل محذوف · ألف موحّدة · ترقيم→مسافة · كلمات النطاق محذوفة · ياء/تاء موحّدة.

    الترتيب مهم: كلمات النطاق تُحذف *قبل* توحيد الياء (وإلا «عالمي» تتحول «عالمى» وما تتطابقش).
    """
    if not text:
        return ""
    s = str(text).strip().lower()
    s = re.sub(r"[\u064B-\u0652\u0670\u0640]", "", s)           # تشكيل + تطويل
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")  # توحيد الألف
    s = re.sub(r"[^\w\s\u0600-\u06FF]", " ", s)                 # ترقيم → مسافة
    s = _SCOPE_RE.sub(" ", s)                                     # حذف كلمات النطاق ككلمات كاملة
    s = s.replace("ي", "ى").replace("ة", "ه")                  # توحيد الياء والتاء المربوطة
    return re.sub(r"\s+", " ", s).strip()


def _strip_scope(s: str) -> str:
    """حذف كلمات النطاق ككلمات كاملة ثم تنظيف المسافات — خطوة المقارنة الجوهرية."""
    return re.sub(r"\s+", " ", _SCOPE_RE.sub(" ", s)).strip()


def is_same_logical_action(prev_action: Optional[str], new_action: Optional[str]) -> bool:
    """هل النصّان نفس الحركة المنطقية؟ (متطابق أو واحد يحتوي الآخر)

    🛡️ علاج جذري لتكرار الإشعارات (نفس الحركة من مسارين):
    بعض النقاط بتكتب صف الأوديت (وبثه اللحظي) + صف بث صريح في نفس الثانية،
    والأكشن الوحيد اللي بيفرق بينهم كلمة نطاق («إضافة زلزال» مقابل
    «إضافة زلزال عالمي»). الحارس القديم كان بيحذف كلمات النطاق *بعد* المقارنة
    فبيعتبرهم حركتين مختلفتين ⇒ إشعار مرتين. الحل: نقارن على النص بعد حذف
    كلمات النطاق — فكل ما وصل بحركة واحدة ونطاق مختلف يُدمج تلقائياً.
    """
    a_full, b_full = _normalize_action(prev_action), _normalize_action(new_action)
    if not a_full or not b_full:
        return False
    a, b = _strip_scope(a_full), _strip_scope(b_full)
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    # لازم الجزء الأقصر يكون جوهريّاً (٤ أحرف على الأقل) ومحتوى ككلمة داخل الأطول
    return len(shorter) >= 4 and shorter in longer



def get_latest_recent_event_action(
    cursor,
    *,
    event_type: str,
    entity_id: Optional[int],
    mission_id: Optional[int],
    actor_user_id: Optional[int],
    target_user_id: Optional[int],
):
    """Fetch the latest action for one dedupe scope, preserving create_realtime_event semantics."""
    if not DEDUPE_ENABLED:
        return None
    cursor.execute(
        """
        SELECT action, created_at
        FROM realtime_events
        WHERE event_type = %s
          AND COALESCE(entity_id, -1) = COALESCE(%s, -1)
          AND COALESCE(mission_id, -1) = COALESCE(%s, -1)
          AND actor_user_id IS NOT DISTINCT FROM %s
          AND target_user_id IS NOT DISTINCT FROM %s
          AND created_at > ((now() AT TIME ZONE 'Africa/Cairo') - make_interval(secs => %s))
        ORDER BY event_id DESC
        LIMIT 1;
        """,
        (
            event_type, entity_id, mission_id, actor_user_id, target_user_id,
            float(DEDUPE_WINDOW_SECONDS),
        ),
    )
    row = cursor.fetchone()
    return row if row else None


def is_recent_duplicate_action(
    previous_action: Optional[str],
    new_action: Optional[str],
    previous_created_at=None,
) -> bool:
    """Apply duplicate-action matching only while the prior action is inside the configured window."""
    if not DEDUPE_ENABLED or previous_created_at is None:
        return False
    now_cairo = datetime.now(ZoneInfo("Africa/Cairo")).replace(tzinfo=None)
    if previous_created_at <= now_cairo - timedelta(seconds=DEDUPE_WINDOW_SECONDS):
        return False
    return is_same_logical_action(previous_action, new_action)


def find_recent_duplicate_target_ids(
    cursor,
    *,
    event_type: str,
    entity_id: Optional[int],
    mission_id: Optional[int],
    actor_user_id: Optional[int],
    target_user_ids,
    action: str,
):
    """Return recipients whose latest matching recent event represents this action.

    Target identity is part of realtime-event deduplication: sending the same
    action to two different users must not suppress the second user's notification.
    """
    target_ids = list(dict.fromkeys(uid for uid in (target_user_ids or []) if uid))
    if not DEDUPE_ENABLED or not target_ids:
        return set()

    cursor.execute("""
        SELECT DISTINCT ON (target_user_id) target_user_id, action
        FROM realtime_events
        WHERE event_type = %s
          AND COALESCE(entity_id, -1) = COALESCE(%s, -1)
          AND COALESCE(mission_id, -1) = COALESCE(%s, -1)
          AND actor_user_id IS NOT DISTINCT FROM %s
          AND target_user_id = ANY(%s::int[])
          AND created_at > ((now() AT TIME ZONE 'Africa/Cairo') - make_interval(secs => %s))
        ORDER BY target_user_id, event_id DESC;
    """, (
        event_type, entity_id, mission_id, actor_user_id,
        target_ids, float(DEDUPE_WINDOW_SECONDS),
    ))
    duplicates = set()
    for uid, previous_action in cursor.fetchall():
        if is_same_logical_action(previous_action, action):
            duplicates.add(uid)
    return duplicates


def resolve_mission_creator(cursor, mission_id: Optional[int]) -> Optional[int]:
    """يرجع user_id صاحب المهمة (أول حدث تسجيل ليها في الفيد) حتى نرسل له إشعار مخصص."""
    if mission_id is None:
        return None
    cursor.execute(
        """
        SELECT actor_user_id
        FROM realtime_events
        WHERE event_type = 'mission'
          AND mission_id = %s
          AND actor_user_id IS NOT NULL
        ORDER BY event_id ASC
        LIMIT 1;
        """,
        (mission_id,),
    )
    row = cursor.fetchone()
    return row[0] if row else None


def notify_participant_accounts(
    cursor,
    mission_id: int,
    mission_name: Optional[str],
    actor_user_id: int,
    participant_user_ids,
):
    """
    توجيه حدث مخصص (بالـ user_id) لكل مشارك له حساب دخول — حتى يصل المتطوع
    إشعار فوري بتكليفه أو بتغيّر مهمته، مهما كان فرعه (مصدر الحقيقة: الـ DB).
    - لا يرسل للفاعل نفسه (no self-notify).
    - لا تكرار: كل مشارك-حساب يصل له حدث واحد لكل عملية.
    """
    seen: set = set()
    target_ids = []
    for uid in participant_user_ids or []:
        if not uid or uid == actor_user_id or uid in seen:
            continue
        seen.add(uid)
        target_ids.append(uid)
    if not target_ids:
        return

    action = f"تم تحديث مهمتك: {mission_name or 'مهمة'}"
    duplicate_targets = find_recent_duplicate_target_ids(
        cursor,
        event_type="mission",
        entity_id=None,
        mission_id=mission_id,
        actor_user_id=actor_user_id,
        target_user_ids=target_ids,
        action=action,
    )
    for uid in target_ids:
        if uid in duplicate_targets:
            continue
        create_realtime_event(
            cursor,
            event_type="mission",
            action=action,
            actor_user_id=actor_user_id,
            mission_id=mission_id,
            details={
                # action_text → يعرضه get_realtime_events أولاً فيصلك نص نظيف
                # بدل الخريطة الخام {'affected': 'participant', ...}
                "action_text": action,
                "affected": "participant",
                "mission_name": mission_name or "",
            },
            target_user_id=uid,
            dedupe_prechecked=True,
        )


def create_realtime_event(
    cursor,
    event_type: str,
    action: str,
    actor_user_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    entity_id: Optional[int] = None,
    details: Optional[Dict[str, Any]] = None,
    target_user_id: Optional[int] = None,
    resolve_creator: bool = False,
    dedupe_prechecked: bool = False,
):
    """
    يسجل حدث لحظي واحد لكل تغيير حقيقي (نفس المعاملة بتاعة الـ audit)
    حتى نضمن: (1) الـ UI يعكس دائمًا حالة الـ DB فعلًا، (2) بدون تكرار أحداث.
    """
    if details is not None:
        details = {
            key: (value.isoformat() if hasattr(value, "isoformat") else value)
            for key, value in details.items()
        }

    # ── Resolve the final target before dedupe so retries of resolve_creator events
    #    use the same recipient-scoped key as the earlier INSERT.
    if target_user_id is None and resolve_creator and event_type == "mission":
        creator = resolve_mission_creator(cursor, mission_id)
        if creator is not None and creator != actor_user_id:
            target_user_id = creator

    # 🛡️ حارس التكرار: نفس الحركة على نفس السجل من نفس الفاعل خلال نافذة قصيرة
    #    ⇒ نرجع الحدث الموجود بدل ما نكتب صفّ تاني (نفس توقيع الإرجاع بالظبط).
    if DEDUPE_ENABLED and not dedupe_prechecked:
        cursor.execute(
            """
            SELECT event_id, action, created_at
            FROM realtime_events
            WHERE event_type = %s
              AND COALESCE(entity_id, -1) = COALESCE(%s, -1)
              AND COALESCE(mission_id, -1) = COALESCE(%s, -1)
              AND actor_user_id IS NOT DISTINCT FROM %s
              AND target_user_id IS NOT DISTINCT FROM %s
              AND created_at > ((now() AT TIME ZONE 'Africa/Cairo') - make_interval(secs => %s))
            ORDER BY event_id DESC
            LIMIT 1;
            """,
            (
                event_type,
                entity_id,
                mission_id,
                actor_user_id,
                target_user_id,
                float(DEDUPE_WINDOW_SECONDS),
            ),
        )
        previous = cursor.fetchone()
        if previous and is_same_logical_action(previous[1], action):
            # نفس الحركة اتسجلت بالفعل ⇒ لا تكرار في الفيد (والـ audit سليم زي ما هو)
            return (previous[0], previous[2])

    # fix #8: created_at صرّيحاً بتوقيت القاهرة (Africa/Cairo) — نفس إصلاح audit.py:
    #    العمود timestamp بدون منطقة، والتخزين المحلي هو ما يعرضه التيكر/الإشعارات كما هو.
    cursor.execute(
        """
        INSERT INTO realtime_events (
            event_type, action, actor_user_id, mission_id, entity_id, target_user_id, details, created_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, (now() AT TIME ZONE 'Africa/Cairo'))
        RETURNING event_id, created_at;
        """,
        (
            event_type,
            action,
            actor_user_id,
            mission_id,
            entity_id,
            target_user_id,
            Jsonb(details) if details is not None else None,
        ),
    )

    return cursor.fetchone()
