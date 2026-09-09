from typing import Optional, Any
from datetime import date, time, datetime
from psycopg.types.json import Jsonb

from realtime import create_realtime_event


def audit_value(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    return value


_ACTOR_NOT_PROVIDED = object()  # حارس: يميّز «لم يُمرَّر الفاعل» عن «تمرير None صراحةً»


def create_audit_log(
    cursor,
    user_id: int,
    action: str,
    mission_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    details: Optional[dict[str, Any]] = None,
    realtime: bool = True,
    target_user_id: Optional[int] = None,
    actor_user_id=_ACTOR_NOT_PROVIDED,
):
    """
    تسجيل اللوج الأمني + (اختياري) حدث لحظي في نفس المعاملة.
    - realtime=True: يتم إشعار الزملاء المعنيين فوراً عبر realtime_events
    - target_user_id: لو محدّد من الـ backend نرسل له الحدث مباشرة (حسب user_id مش الأسماء)
    """
    if details is not None:
        details = {
            key: audit_value(value)
            for key, value in details.items()
        }

    # fix #8: created_at صرّيحاً بتوقيت القاهرة (Africa/Cairo) بدل default السيرفر (UTC).
    #    العمود timestamp بدون منطقة — تخزين التوقيت المحلي يجعله يُعرض كما هو على الواجهة
    #    (الـ frontend لا يحوِّل مناطق). سابقاً كان يُسجَّل UTC فيظهر «ساعة متأخر» في مصر
    #    (مثال: حذف 10:35م محلياً يُسجَّل 07:35م). نفس نمط main.py: now() AT TIME ZONE 'Africa/Cairo'.
    cursor.execute(
        """
        INSERT INTO audit_logs (
            user_id,
            mission_id,
            action,
            entity_type,
            entity_id,
            details,
            created_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, (now() AT TIME ZONE 'Africa/Cairo'))
        RETURNING audit_id, created_at;
        """,
        (
            user_id,
            mission_id,
            action,
            entity_type,
            entity_id,
            Jsonb(details) if details is not None else None
        )
    )
    audit_result = cursor.fetchone()

    # ── الأحداث اللحظية: كل تغيير حقيقي يسجَّل كحدث ويحدَّد مستلمه من الـ backend
    if realtime and entity_type is not None:
        # الفاعل في القناة اللحظية:
        #   - الاستدعاءات التي لا تمرر actor_user_id (كلها) → فاعل = user_id المسجِّل.
        #   - تمرير None صراحةً (بوت الذكاء الاصطناعي) → فاعل = NULL = «نظام»
        #     (لا يُستبعد أحد عبر no-self-notify، ويظهر كـ "نظام" في الواجهة)
        #     بينما يبقى سجل audit_logs محتفظاً بـ user_id الفعلي كما هو.
        # قبل هذا الإصلاح كان تمرير None يتحول تلقائياً إلى user_id=1 (مالك حقيقي)
        # فيُستبعد المالك من إشعارات البوت ويعتقد أنها توقفت عن الوصول إليه.
        if actor_user_id is _ACTOR_NOT_PROVIDED:
            realtime_actor = user_id
        else:
            realtime_actor = actor_user_id  # يجوز أن يكون None → النظام

        try:
            create_realtime_event(
                cursor,
                event_type=entity_type,
                action=action,
                actor_user_id=realtime_actor,
                mission_id=entity_id if entity_type == "mission" else None,
                details=details,
                target_user_id=target_user_id,
                resolve_creator=(entity_type == "mission"),
            )
        except Exception as e:
            print(f"Realtime event error: {e}")

    return audit_result