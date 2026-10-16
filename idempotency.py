"""Privacy-preserving, PostgreSQL-backed idempotency helpers.

The raw client key, user identity, authorization token, and query string are never
stored in the scoped table. The legacy table remains untouched for compatibility.
"""
from __future__ import annotations

import hashlib
import json
import threading
from typing import Optional


SCOPED_IDEMPOTENCY_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS idempotency_keys_v2 (
    identity_hash   VARCHAR(64) NOT NULL,
    method          VARCHAR(10) NOT NULL,
    route_path      VARCHAR(255) NOT NULL,
    query_hash      VARCHAR(64) NOT NULL,
    client_key_hash VARCHAR(64) NOT NULL,
    response        JSONB,
    original_status INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (
        identity_hash, method, route_path, query_hash, client_key_hash
    )
);
"""

_SCHEMA_READY = False
_SCHEMA_LOCK = threading.Lock()


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_idempotency_scope(
    identity: str,
    method: str,
    route_path: str,
    query_string: str,
    client_key: str,
) -> Optional[dict[str, str]]:
    """Return normalized, privacy-preserving fields for a composite idempotency key."""
    if not identity or not client_key or not client_key.strip():
        return None

    method_value = str(method or "").strip().upper()
    path_value = str(route_path or "").strip()
    if not method_value or len(method_value) > 10 or not path_value or len(path_value) > 255:
        return None

    return {
        "identity_hash": _sha256(str(identity)),
        "method": method_value,
        "route_path": path_value,
        "query_hash": _sha256(str(query_string or "")),
        "client_key_hash": _sha256(client_key.strip()),
    }


def ensure_scoped_idempotency_schema(connection_factory) -> bool:
    """Create the v2 table without running the application's heavy schema migration."""
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
                cursor.execute(SCOPED_IDEMPOTENCY_SCHEMA_SQL)
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


def _scope_values(scope: dict[str, str]) -> tuple[str, str, str, str, str]:
    return (
        scope["identity_hash"],
        scope["method"],
        scope["route_path"],
        scope["query_hash"],
        scope["client_key_hash"],
    )


def fetch_cached_response(cursor, scope: dict[str, str]):
    """Return (decoded_response, status) or None when this scope has no saved response."""
    cursor.execute(
        """
        SELECT response, original_status
        FROM idempotency_keys_v2
        WHERE identity_hash = %s
          AND method = %s
          AND route_path = %s
          AND query_hash = %s
          AND client_key_hash = %s;
        """,
        _scope_values(scope),
    )
    row = cursor.fetchone()
    if not row or row[0] is None:
        return None

    cached = row[0]
    if isinstance(cached, str):
        try:
            decoded = json.loads(cached)
        except (TypeError, ValueError):
            return None
    elif isinstance(cached, (dict, list, int, float, bool)):
        decoded = cached
    else:
        return None
    return decoded, row[1]


def save_cached_response(cursor, scope: dict[str, str], response_payload, status_code: int) -> None:
    """Save successful response payloads, and delete only the matching scoped failed key."""
    values = _scope_values(scope)
    if status_code < 400:
        cursor.execute(
            """
            INSERT INTO idempotency_keys_v2 (
                identity_hash, method, route_path, query_hash,
                client_key_hash, response, original_status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (
                identity_hash, method, route_path, query_hash, client_key_hash
            ) DO UPDATE
            SET response = EXCLUDED.response,
                original_status = EXCLUDED.original_status,
                created_at = CURRENT_TIMESTAMP;
            """,
            (*values, json.dumps(response_payload), status_code),
        )
    else:
        cursor.execute(
            """
            DELETE FROM idempotency_keys_v2
            WHERE identity_hash = %s
              AND method = %s
              AND route_path = %s
              AND query_hash = %s
              AND client_key_hash = %s;
            """,
            values,
        )
