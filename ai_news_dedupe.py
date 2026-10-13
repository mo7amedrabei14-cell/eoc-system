"""Multi-layer duplicate detection for AI incident/news intake.

The module deliberately has no network or database dependencies so its decisions
can be regression-tested deterministically.
"""
from datetime import datetime, timezone
from difflib import SequenceMatcher
from hashlib import sha256
from html import unescape
import re
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_TRACKING_KEYS = {
    "fbclid", "gclid", "dclid", "mc_cid", "mc_eid", "igshid", "igsh",
    "feature", "si", "ref_src", "ref_url", "spm", "cmpid", "campaign",
}
_ARABIC_TRANSLATION = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ى": "ي", "ؤ": "و", "ئ": "ي",
})
_SPACE_RE = re.compile(r"\s+")
_TAG_RE = re.compile(r"<[^>]+>")
_TRACKING_PREFIXES = ("utm_",)


def canonicalize_url(value):
    """Normalize a news URL while retaining parameters that may identify the story."""
    raw = unescape(str(value or "").strip())
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
            return raw
        scheme = parts.scheme.lower()
        host = parts.hostname.lower()
        if host.startswith("www."):
            host = host[4:]
        port = parts.port
        if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
            host = f"{host}:{port}"
        path = parts.path or "/"
        if path != "/":
            path = path.rstrip("/")
        kept = []
        for key, val in parse_qsl(parts.query, keep_blank_values=True):
            normalized_key = key.lower().strip()
            if normalized_key in _TRACKING_KEYS or normalized_key.startswith(_TRACKING_PREFIXES):
                continue
            kept.append((key, val))
        kept.sort(key=lambda item: (item[0].lower(), item[1]))
        return urlunsplit((scheme, host, path, urlencode(kept, doseq=True), ""))
    except (TypeError, ValueError):
        return raw


def normalize_text(value):
    """Normalize Unicode/Arabic spelling and punctuation for comparison only."""
    text = unescape(str(value or ""))
    text = _TAG_RE.sub(" ", text)
    text = text.translate(_ARABIC_TRANSLATION).replace("ـ", "")
    text = "".join(
        char for char in text
        if unicodedata.category(char) not in ("Mn", "Me", "Cf")
    )
    text = text.casefold()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return _SPACE_RE.sub(" ", text).strip()


def normalize_title(value):
    return normalize_text(value)


def _timestamp(item):
    if not isinstance(item, dict):
        return None
    for key in ("published_at", "published", "observed_at", "created_at", "created_utc", "incident_date", "date", "timestamp"):
        value = item.get(key)
        if value in (None, ""):
            continue
        try:
            if isinstance(value, (int, float)):
                return datetime.fromtimestamp(float(value), tz=timezone.utc)
            parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except (ValueError, TypeError, OverflowError, OSError):
            continue
    return None


def _within_hours(left, right, hours):
    left_time, right_time = _timestamp(left), _timestamp(right)
    if left_time is None or right_time is None:
        return None
    return abs((left_time - right_time).total_seconds()) <= hours * 3600


def _title(item):
    return normalize_title(
        item.get("title")
        or item.get("incident_description")
        or item.get("headline")
        or item.get("summary")
        or ""
    )


def _body(item):
    value = item.get("text") or item.get("selftext") or item.get("content") or ""
    return normalize_text(value)


def _token_similarity(left, right):
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def duplicate_reason(candidate, previous):
    """Return a duplicate reason, or None when evidence is too weak."""
    candidate_url = canonicalize_url(candidate.get("link") or candidate.get("news_link"))
    previous_url = canonicalize_url(previous.get("link") or previous.get("news_link"))
    if candidate_url and previous_url and candidate_url == previous_url:
        return "canonical_url"

    current_title, old_title = _title(candidate), _title(previous)
    if current_title and old_title:
        same_window = _within_hours(candidate, previous, 48)
        # Very short/headline-only phrases (e.g. "عاجل") are not safe identifiers.
        enough_text = min(len(current_title), len(old_title)) >= 18
        if enough_text and current_title == old_title:
            if same_window is not False:
                return "exact_title"

        if enough_text:
            ratio = SequenceMatcher(None, current_title, old_title, autojunk=False).ratio()
            token_score = _token_similarity(current_title, old_title)
            if same_window is True and ratio >= 0.91 and token_score >= 0.76:
                return "similar_title"
            # When timestamps are absent, demand near identity to limit false positives.
            if same_window is None and ratio >= 0.975 and token_score >= 0.90:
                return "similar_title_no_timestamp"

    current_body, old_body = _body(candidate), _body(previous)
    if min(len(current_body), len(old_body)) >= 100:
        same_window = _within_hours(candidate, previous, 72)
        if same_window is not False:
            if sha256(current_body.encode("utf-8")).digest() == sha256(old_body.encode("utf-8")).digest():
                return "identical_body"
            if same_window is True and _token_similarity(current_body, old_body) >= 0.92:
                return "similar_body"
    return None


def deduplicate_articles(candidates, existing_records=()):
    """Canonicalize and filter candidates against stored records and earlier candidates.

    Returns (unique_articles, metrics). Each candidate is copied before its URL is
    normalized, so callers may retain the original source object if needed.
    """
    prior = [row for row in (existing_records or ()) if isinstance(row, dict)]
    accepted = []
    metrics = {
        "input": 0,
        "unique": 0,
        "duplicates": 0,
        "canonical_url": 0,
        "exact_title": 0,
        "similar_title": 0,
        "similar_title_no_timestamp": 0,
        "identical_body": 0,
        "similar_body": 0,
    }
    for raw in candidates or ():
        if not isinstance(raw, dict):
            continue
        metrics["input"] += 1
        item = dict(raw)
        link_key = canonicalize_url(item.get("link") or item.get("news_link"))
        if link_key:
            item["link"] = link_key
        duplicate = None
        for old in prior:
            duplicate = duplicate_reason(item, old)
            if duplicate:
                break
        if duplicate:
            metrics["duplicates"] += 1
            metrics[duplicate] = metrics.get(duplicate, 0) + 1
            continue
        accepted.append(item)
        prior.append(item)
    metrics["unique"] = len(accepted)
    return accepted, metrics
