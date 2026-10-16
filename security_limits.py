"""PostgreSQL-backed shared login rate limiting and hashed key helpers."""
from __future__ import annotations

import hashlib
import threading


LOGIN_RATE_LIMIT_SCHEMA_SQL = (
    """
    CREATE TABLE IF NOT EXISTS login_rate_limit_events (
        event_id  BIGSERIAL PRIMARY KEY,
        key_hash  VARCHAR(64) NOT NULL,
        failed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_login_rate_events_key_failed
    ON login_rate_limit_events (key_hash, failed_at DESC);
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_login_rate_events_failed
    ON login_rate_limit_events (failed_at);
    """,
)

_SCHEMA_READY = False
_SCHEMA_LOCK = threading.Lock()


def build_login_rate_limit_key(client_ip: str, username: str) -> str:
    """Build a privacy-preserving key for the trusted client IP + normalized username."""
    normalized_ip = str(client_ip or "-").strip() or "-"
    normalized_username = str(username or "").strip().lower()
    value = f"{normalized_ip}|{normalized_username}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def ensure_login_rate_limit_schema(connection_factory) -> bool:
    """Create the shared attempt-event table without requiring any production URL."""
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return True

    with _SCHEMA_LOCK:
        if _SCHEMA_READY:
            return True
        connection = None
        try:
            connection = connection_factory()
            with connection.cursor() as cursor:
                for statement in LOGIN_RATE_LIMIT_SCHEMA_SQL:
                    cursor.execute(statement)
            connection.commit()
            _SCHEMA_READY = True
            return True
        except Exception:
            if connection is not None:
                try:
                    connection.rollback()
                except Exception:
                    pass
            return False
        finally:
            if connection is not None:
                connection.close()


def count_recent_failures(cursor, key_hash: str, window_seconds: int) -> int:
    cursor.execute(
        """
        SELECT COUNT(*)
        FROM login_rate_limit_events
        WHERE key_hash = %s
          AND failed_at >= CURRENT_TIMESTAMP - (%s * INTERVAL '1 second');
        """,
        (key_hash, window_seconds),
    )
    row = cursor.fetchone()
    return int(row[0]) if row else 0


def record_login_failure(cursor, key_hash: str) -> None:
    cursor.execute(
        """
        INSERT INTO login_rate_limit_events (key_hash, failed_at)
        VALUES (%s, CURRENT_TIMESTAMP);
        """,
        (key_hash,),
    )


def clear_login_failures(cursor, key_hash: str) -> None:
    cursor.execute(
        "DELETE FROM login_rate_limit_events WHERE key_hash = %s;",
        (key_hash,),
    )


def prune_expired_failures(cursor) -> None:
    cursor.execute(
        """
        DELETE FROM login_rate_limit_events
        WHERE failed_at < CURRENT_TIMESTAMP - INTERVAL '1 day';
        """
    )
