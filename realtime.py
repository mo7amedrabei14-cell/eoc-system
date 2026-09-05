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

from typing import Optional, Any, Dict
from psycopg.types.json import Jsonb


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
    for uid in participant_user_ids or []:
        if not uid or uid == actor_user_id or uid in seen:
            continue
        seen.add(uid)
        create_realtime_event(
            cursor,
            event_type="mission",
            action=f"تم تحديث مهمتك: {mission_name or 'مهمة'}",
            actor_user_id=actor_user_id,
            mission_id=mission_id,
            details={"affected": "participant", "mission_name": mission_name or ""},
            target_user_id=uid,
        )


def create_realtime_event(
    cursor,
    event_type: str,
    action: str,
    actor_user_id: Optional[int] = None,
    mission_id: Optional[int] = None,
    details: Optional[Dict[str, Any]] = None,
    target_user_id: Optional[int] = None,
    resolve_creator: bool = False,
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

    # ── تحديد المستلم من الـ backend:
    #    الرتبة العليا اللي بتغيّر مهمة بتخاطب منشئ المهمة (صاحبها) بالـ user_id
    if target_user_id is None and resolve_creator and event_type == "mission":
        creator = resolve_mission_creator(cursor, mission_id)
        if creator is not None and creator != actor_user_id:
            target_user_id = creator

    cursor.execute(
        """
        INSERT INTO realtime_events (
            event_type, action, actor_user_id, mission_id, target_user_id, details
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING event_id, created_at;
        """,
        (
            event_type,
            action,
            actor_user_id,
            mission_id,
            target_user_id,
            Jsonb(details) if details is not None else None,
        ),
    )

    return cursor.fetchone()