from typing import Optional, Any
from datetime import date, time, datetime
from psycopg.types.json import Jsonb

from realtime import create_realtime_event


def audit_value(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    return value


def create_audit_log(
    cursor,
    user_id: int,
    action: str,
    mission_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
    details: Optional[dict[str, Any]] = None,
    realtime: bool = True,
    target_user_id: Optional[int] = None
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

    cursor.execute(
        """
        INSERT INTO audit_logs (
            user_id,
            mission_id,
            action,
            entity_type,
            entity_id,
            details
        )
        VALUES (%s, %s, %s, %s, %s, %s)
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
        try:
            create_realtime_event(
                cursor,
                event_type=entity_type,
                action=action,
                actor_user_id=user_id,
                mission_id=entity_id if entity_type == "mission" else None,
                details=details,
                target_user_id=target_user_id,
                resolve_creator=(entity_type == "mission"),
            )
        except Exception as e:
            print(f"Realtime event error: {e}")

    return audit_result