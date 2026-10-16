"""Pure helpers for safely scoping idempotency records.

No database or web-framework dependency: keeping this logic isolated makes it
straightforward to test scope collisions and compatibility behavior offline.
"""
from __future__ import annotations

import hashlib
from typing import Optional


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def build_idempotency_scope(
    identity: str,
    method: str,
    route_path: str,
    query_string: str,
    client_key: str,
) -> Optional[dict[str, str]]:
    """Return normalized, privacy-preserving fields for a composite idempotency key.

    The raw authorization token, user identity, query string, and client key are
    never stored. Their hashes bind them to the scope. Legacy raw-key rows remain
    in the legacy table and cannot collide with or be replayed through this scope.
    """
    if not identity or not client_key or not client_key.strip():
        return None

    method_value = str(method or "").strip().upper()
    path_value = str(route_path or "").strip()
    if not method_value or len(method_value) > 10 or not path_value or len(path_value) > 255:
        return None

    key_value = client_key.strip()
    query_value = str(query_string or "")

    return {
        "identity_hash": _sha256(identity),
        "method": method_value,
        "route_path": path_value,
        "query_hash": _sha256(query_value),
        "client_key_hash": _sha256(key_value),
    }
