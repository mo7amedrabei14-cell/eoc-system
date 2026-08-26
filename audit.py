from typing import Optional, Any
from datetime import date, time, datetime
from psycopg.types.json import Jsonb


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
    details: Optional[dict[str, Any]] = None
):
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

    return cursor.fetchone()