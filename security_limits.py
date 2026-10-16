"""Pure helpers for server-side rate-limit keys."""
from __future__ import annotations

import hashlib


def build_login_rate_limit_key(client_ip: str, username: str) -> str:
    """Build a privacy-preserving key for the trusted client IP + normalized username."""
    normalized_ip = str(client_ip or "-").strip() or "-"
    normalized_username = str(username or "").strip().lower()
    value = f"{normalized_ip}|{normalized_username}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
