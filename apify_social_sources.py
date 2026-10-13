"""Budget-capped Apify public-post collection for the EOC AI Radar.

The search itself uses high-signal incident phrases (not generic words such as
"death", "fire", or "emergency") to reduce irrelevant paid results before they
reach the dataset. Every result is still checked locally before being forwarded.
"""
from datetime import datetime, timedelta, timezone
import os
import re
from email.utils import parsedate_to_datetime
from urllib.parse import quote

import requests
from incident_validation import validate_incident, is_ai_confirmation_candidate


API_BASE = "https://api.apify.com/v2"
BUDGET_STORE_NAME = "EOC-AI-Radar-Social-Budget"
BUDGET_RECORD_KEY = "SOCIAL_BUDGET_V1"
FACEBOOK_ACTOR = "topapi~facebook-search-posts-scraper"
INSTAGRAM_ACTOR = "seemuapps~instagram-keyword-posts-scraper"
REQUEST_TIMEOUT = 210
MAX_TOTAL_CHARGE_USD_PER_RUN = 0.01

# Prioritize incident-reporting phrases rather than broad, metaphor-prone words.
# mustContainQuery=true makes the Actor apply these queries strictly to post text.
SOCIAL_INCIDENT_SEARCH_QUERIES = [
    # Short but incident-specific terms keep exact-match search useful. Avoid
    # generic standalone words such as "حريق" that frequently occur metaphorically.
    "حادث مروري", "انقلاب سيارة", "انقلاب ميكروباص", "تصادم", "اصطدام", "دهس",
    "اندلاع حريق", "نشوب حريق", "حريق منزل", "حريق مصنع", "حريق مخزن",
    "الحماية المدنية", "سيارات الإطفاء", "انهيار عقار", "انهيار مبنى",
    "سقوط عقار", "انفجار", "تسرب غاز", "سيول", "فيضانات", "زلزال",
    "غرق مركب", "انتشال جثامين", "مصرع في حادث", "إصابات في حادث",
    "اشتباكات", "إطلاق نار", "تسمم جماعي", "سقوط طائرة", "خروج قطار عن القضبان",
]


def _int_env(name, default, minimum=1):
    try:
        return max(minimum, int(os.environ.get(name, str(default)) or default))
    except (TypeError, ValueError):
        return default


def _parse_datetime(value):
    """Parse ISO/RFC822/Unix timestamps; unknown times are rejected by freshness checks."""
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        raw = str(value).strip()
        if re.fullmatch(r"\d{9,}(?:\.\d+)?", raw):
            return datetime.fromtimestamp(float(raw), tz=timezone.utc)
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def _first_value(item, names):
    for name in names:
        value = item.get(name)
        if value not in (None, ""):
            return value
    return None


def _published_datetime(item):
    if not isinstance(item, dict):
        return None
    return _parse_datetime(_first_value(item, (
        "published_at", "publishedAt", "timestamp", "created_time", "createdAt",
        "date_posted", "date", "takenAt", "taken_at", "taken_at_timestamp",
        "created_utc", "published", "time",
    )))


def is_recent_publication(value, max_age_minutes=30, now=None):
    """True only when an explicit timestamp proves that the post is <= N minutes old."""
    published = _parse_datetime(value)
    if published is None:
        return False
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    reference = reference.astimezone(timezone.utc)
    age_seconds = (reference - published).total_seconds()
    # Allow up to two minutes of clock skew into the future, but no unknown/stale posts.
    return -120 <= age_seconds <= max(1, max_age_minutes) * 60


def _article_from_post(item, platform, keywords, max_age_minutes, now):
    if not isinstance(item, dict):
        return None
    published = _published_datetime(item)
    if published is None or not is_recent_publication(published, max_age_minutes, now):
        return None

    body_value = _first_value(item, (
        "message", "caption", "text", "description", "content", "title",
    ))
    body = re.sub(r"\s+", " ", str(body_value or "")).strip()
    title_value = _first_value(item, ("title", "post_title", "caption", "message", "text"))
    title = re.sub(r"\s+", " ", str(title_value or body)).strip()[:220]
    if not body:
        return None

    link = _first_value(item, (
        "url", "post_url", "postUrl", "permalink", "permalink_url", "link", "post_link",
    ))
    if not link:
        return None

    author_data = item.get("author") or item.get("owner") or item.get("user") or {}
    if isinstance(author_data, dict):
        author = (
            author_data.get("name") or author_data.get("username")
            or author_data.get("full_name") or author_data.get("id") or ""
        )
    else:
        author = str(author_data or "")
    if not author:
        author = str(_first_value(item, (
            "author_name", "authorName", "username", "ownerUsername", "owner_username",
            "page_name", "pageName",
        )) or "")

    image = _first_value(item, ("image", "image_url", "thumbnail", "displayUrl", "display_url"))
    publisher = f"{platform}: {author}" if author else f"{platform} (Apify)"
    article = {
        "title": title or body[:220],
        "text": body[:5000],
        "link": str(link).strip(),
        "publisher": publisher,
        "image_url": str(image or "لا توجد صورة"),
        "published_at": published.isoformat(),
        "platform": platform,
    }
    valid, reason = validate_incident(article)
    if not valid:
        if is_ai_confirmation_candidate(article):
            # The Actor result has already been returned and may be billable.
            # Preserve a potentially real but underspecified incident for an explicit
            # Gemini verdict; explicit poetry/metaphor/non-event text never reaches here.
            article["_requires_ai_confirmation"] = True
            print(f"🔎 Apify/{platform}: نتيجة مدفوعة تحتاج تأكيد Gemini قبل الإرسال ({reason}).")
            return article
        print(f"⛔ Apify/{platform}: استبعاد نتيجة غير مؤهلة قبل التحليل ({reason}).")
        return None
    return article


def _new_budget_state(now):
    return {
        "version": 1,
        "month": now.strftime("%Y-%m"),
        "day": now.strftime("%Y-%m-%d"),
        "monthly_used": 0,
        "daily_used": 0,
        "slot_key": None,
        "slot_attempted": [],
        "slot_consumed": False,
        "slot_reserved": False,
        "pending_platform": None,
        "updated_at": now.isoformat(),
    }


def _current_slot(now):
    index = now.hour * 2 + (now.minute // 30)
    return f"{now.strftime('%Y-%m-%dT%H')}:{now.minute // 30}", index


def _normalize_budget_state(raw, now):
    state = _new_budget_state(now)
    if isinstance(raw, dict):
        state.update({key: value for key, value in raw.items() if key in state})
    if state.get("month") != now.strftime("%Y-%m"):
        state["monthly_used"] = 0
        state["month"] = now.strftime("%Y-%m")
    if state.get("day") != now.strftime("%Y-%m-%d"):
        state["daily_used"] = 0
        state["day"] = now.strftime("%Y-%m-%d")
    slot_key, _ = _current_slot(now)
    if state.get("slot_key") != slot_key:
        state["slot_key"] = slot_key
        state["slot_attempted"] = []
        state["slot_consumed"] = False
        state["slot_reserved"] = False
        state["pending_platform"] = None
    elif state.get("slot_reserved"):
        # A previous runner may have ended after a paid run but before recording its
        # outcome. Keep the reservation and close this slot rather than risk overspend.
        state["slot_reserved"] = False
        state["slot_consumed"] = True
        state["pending_platform"] = None
    state["monthly_used"] = max(0, int(state.get("monthly_used") or 0))
    state["daily_used"] = max(0, int(state.get("daily_used") or 0))
    if not isinstance(state.get("slot_attempted"), list):
        state["slot_attempted"] = []
    state["updated_at"] = now.isoformat()
    return state


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _get_or_create_budget_store(token):
    """Reuse the same durable Apify KVS across every scheduled runner."""
    headers = _auth_headers(token)
    try:
        offset = 0
        page_size = 100
        for _ in range(50):
            response = requests.get(
                f"{API_BASE}/key-value-stores",
                params={"limit": page_size, "offset": offset},
                headers=headers,
                timeout=20,
            )
            if not response.ok:
                print(f"⚠️ Apify: تعذّر فحص مخازن الميزانية (HTTP {response.status_code}); أوقف البحث لحماية الرصيد.")
                return None
            payload = response.json()
            data = payload.get("data", {}) if isinstance(payload, dict) else {}
            items = data.get("items", []) if isinstance(data, dict) else []
            for item in items:
                if isinstance(item, dict) and item.get("name") == BUDGET_STORE_NAME and item.get("id"):
                    return str(item["id"])
            if not items or len(items) < page_size:
                break
            offset += len(items)
        else:
            print("⚠️ Apify: لم أعثر على مخزن الميزانية ضمن أول 5,000 مخزن؛ أوقف البحث بدل إنشاء مخزن قد يعيد ضبط السقف.")
            return None

        response = requests.post(
            f"{API_BASE}/key-value-stores",
            params={"name": BUDGET_STORE_NAME},
            headers=headers,
            timeout=20,
        )
        if not response.ok:
            print(f"⚠️ Apify: تعذّر إنشاء مخزن ميزانية الرصد (HTTP {response.status_code}); أوقف البحث لحماية الرصيد.")
            return None
        data = response.json().get("data", {})
        store_id = data.get("id")
        if not store_id:
            print("⚠️ Apify: لم يُرجع مخزن الميزانية معرّفًا؛ أوقف البحث لحماية الرصيد.")
            return None
        return str(store_id)
    except Exception as exc:
        print(f"⚠️ Apify: تعذّر الاتصال بمخزن الميزانية ({type(exc).__name__}); أوقف البحث لحماية الرصيد.")
        return None


def _read_budget(store_id, token):
    try:
        response = requests.get(
            f"{API_BASE}/key-value-stores/{quote(store_id, safe='')}/records/{BUDGET_RECORD_KEY}",
            headers=_auth_headers(token),
            timeout=20,
        )
        if response.status_code == 404:
            return {}
        if not response.ok:
            print(f"⚠️ Apify: تعذّرت قراءة سقف الرصيد (HTTP {response.status_code}); أوقف البحث.")
            return None
        value = response.json()
        return value if isinstance(value, dict) else None
    except Exception as exc:
        print(f"⚠️ Apify: تعذّرت قراءة سجل الميزانية ({type(exc).__name__}); أوقف البحث.")
        return None


def _save_budget(store_id, token, state):
    try:
        response = requests.put(
            f"{API_BASE}/key-value-stores/{quote(store_id, safe='')}/records/{BUDGET_RECORD_KEY}",
            headers=_auth_headers(token),
            json=state,
            timeout=20,
        )
        return response.ok
    except Exception:
        return False


def _safe_apify_error_detail(response, token=None):
    """Return a short, redacted diagnostic from an Apify 4xx response."""
    detail = ""
    try:
        payload = response.json()
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                detail = " - ".join(
                    str(error.get(key) or "").strip()
                    for key in ("type", "message")
                    if str(error.get(key) or "").strip()
                )
            elif isinstance(error, str):
                detail = error
            elif payload.get("message"):
                detail = str(payload["message"])
    except Exception:
        pass

    if not detail:
        detail = str(getattr(response, "text", "") or "")
    secret = token or os.environ.get("APIFY_API_TOKEN", "")
    if secret:
        detail = detail.replace(secret, "[REDACTED]")
    detail = re.sub(r"(?i)\\bbearer\\s+[^\\s,;]+", "Bearer [REDACTED]", detail)
    detail = re.sub(
        r'''(?i)(["']?token["']?\\s*[:=]\\s*["']?)[^"'\\s,}]+''',
        r"\\1[REDACTED]",
        detail,
    )
    detail = re.sub(r"\\s+", " ", detail).strip()
    return detail[:320] or "لم يُرجع Apify تفاصيل للخطأ"


def _actor_request(actor_id, payload, token):
    """Run one Actor with a hard cap of one chargeable result and a tiny cost ceiling."""
    try:
        response = requests.post(
            f"{API_BASE}/acts/{actor_id}/run-sync-get-dataset-items",
            params={
                "maxItems": 1,
                "maxTotalChargeUsd": MAX_TOTAL_CHARGE_USD_PER_RUN,
                "timeout": 180,
            },
            headers=_auth_headers(token),
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
    except Exception as exc:
        print(f"⚠️ Apify/{actor_id}: تعذّر تأكيد نتيجة التشغيل ({type(exc).__name__}); احتُسب الحجز احترازيًا.")
        return None, "uncertain"

    if response.status_code in (401, 403):
        print(f"🛑 Apify/{actor_id}: رفض المصادقة (HTTP {response.status_code}); راجع APIFY_API_TOKEN.")
        return [], "auth"
    if response.status_code >= 500 or response.status_code in (408, 429):
        print(f"⚠️ Apify/{actor_id}: فشل مؤقت (HTTP {response.status_code}); احتُسب الحجز احترازيًا.")
        return None, "uncertain"
    if not response.ok:
        detail = _safe_apify_error_detail(response, token)
        print(f"⚠️ Apify/{actor_id}: رفض الطلب (HTTP {response.status_code}) — {detail}")
        return [], "recoverable"
    try:
        value = response.json()
    except Exception:
        return None, "uncertain"
    if not isinstance(value, list):
        return [], "ok"
    return value, "ok"


def _actor_payload(platform, keywords, slot_index=0):
    """Strict, high-signal search; rotate query order without raising item/charge caps."""
    queries = list(SOCIAL_INCIDENT_SEARCH_QUERIES)
    if queries:
        offset = max(0, int(slot_index)) % len(queries)
        queries = queries[offset:] + queries[:offset]
    if platform == "Facebook":
        return {
            "searchQueries": queries,
            "sortBy": "recent",
            "startDate": "1 day",
            "mustContainQuery": True,
            "maxPostsPerQuery": 1,
            "maxItems": 1,
            "compact": True,
            "includePostDetails": False,
            "monitorMode": True,
            "monitorStoreName": "eoc-ai-radar-facebook",
            "maxConcurrency": 1,
        }
    return {
        "keywords": queries,
        "maxPostsPerKeyword": 1,
        "dateFrom": "1 day",
        "postType": "all",
        "minLikes": 0,
    }


def fetch_apify_social_articles(keywords, max_age_minutes=30, now=None):
    """Fetch at most one new item per half-hour slot across Facebook + Instagram.

    A shared Apify KVS enforces daily/monthly caps and prevents duplicate manual
    workflow runs from spending another result in the same half-hour slot.
    Unknown timestamps are rejected. One platform is prioritized per slot; the
    second is tried only when the first returns no dataset items without a charge.
    """
    token = os.environ.get("APIFY_API_TOKEN", "").strip()
    if not token:
        print("ℹ️ Apify غير مفعّل: أضف APIFY_API_TOKEN في GitHub Actions Secrets.")
        return []
    clean_keywords = []
    seen_keywords = set()
    for word in keywords or []:
        word = str(word or "").strip()
        key = word.casefold()
        if word and key not in seen_keywords:
            clean_keywords.append(word)
            seen_keywords.add(key)
    if not clean_keywords:
        return []

    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    reference = reference.astimezone(timezone.utc)

    store_id = _get_or_create_budget_store(token)
    if not store_id:
        return []
    raw_state = _read_budget(store_id, token)
    if raw_state is None:
        return []
    state = _normalize_budget_state(raw_state, reference)

    monthly_cap = _int_env("APIFY_MONTHLY_RESULT_CAP", 1000)
    daily_cap = _int_env("APIFY_DAILY_RESULT_CAP", 50)
    slot_key, slot_index = _current_slot(reference)

    if state.get("slot_consumed") or state.get("slot_reserved"):
        return []
    if state["monthly_used"] >= monthly_cap:
        print(f"⏸️ Apify: وصل الرصد إلى سقف الشهر ({state['monthly_used']}/{monthly_cap} نتيجة محتسبة).")
        return []
    if state["daily_used"] >= daily_cap:
        print(f"⏸️ Apify: وصل الرصد إلى سقف اليوم ({state['daily_used']}/{daily_cap} نتيجة محتسبة).")
        return []

    # Facebook is the primary feed because its search can sort newest-first.
    # Instagram is a fallback only when Facebook returns no rows / a recoverable error.
    platforms = ["Facebook", "Instagram"]
    articles = []
    max_age_minutes = max(1, int(max_age_minutes))

    for platform in platforms:
        if platform in state["slot_attempted"]:
            continue
        if state["slot_consumed"] or state["monthly_used"] >= monthly_cap or state["daily_used"] >= daily_cap:
            break

        actor_id = FACEBOOK_ACTOR if platform == "Facebook" else INSTAGRAM_ACTOR
        payload = _actor_payload(platform, clean_keywords, slot_index=slot_index)

        state["monthly_used"] += 1
        state["daily_used"] += 1
        state["slot_attempted"].append(platform)
        state["slot_reserved"] = True
        state["pending_platform"] = platform
        state["updated_at"] = reference.isoformat()
        if not _save_budget(store_id, token, state):
            print("🛑 Apify: لم أستطع حفظ حجز الميزانية؛ أوقفت الطلب قبل إنفاق الرصيد.")
            state["monthly_used"] -= 1
            state["daily_used"] -= 1
            return []

        rows, outcome = _actor_request(actor_id, payload, token)

        if rows:
            state["slot_reserved"] = False
            state["pending_platform"] = None
            state["slot_consumed"] = True
            state["updated_at"] = reference.isoformat()
            if not _save_budget(store_id, token, state):
                print("⚠️ Apify: تعذّر تأكيد حالة الميزانية بعد نتيجة؛ يظل الحجز السابق محفوظًا.")
            candidates = []
            for row in rows:
                article = _article_from_post(row, platform, clean_keywords, max_age_minutes, reference)
                if article:
                    parsed = _published_datetime(row)
                    candidates.append((parsed or datetime.min.replace(tzinfo=timezone.utc), article))
            candidates.sort(key=lambda pair: pair[0], reverse=True)
            if candidates:
                result = candidates[0][1]
                print(f"📱 Apify/{platform}: منشور حادث مؤهل خلال {max_age_minutes} دقيقة.")
                return [result]
            print(f"ℹ️ Apify/{platform}: رُفضت نتيجة المصدر لأنها لم تجتز شروط الوقت/الواقعة؛ حُفظ حجز الميزانية لتجنب الإنفاق المكرر.")
            return []

        if outcome == "uncertain":
            state["slot_reserved"] = False
            state["pending_platform"] = None
            state["slot_consumed"] = True
            state["updated_at"] = reference.isoformat()
            _save_budget(store_id, token, state)
            return []

        state["monthly_used"] = max(0, state["monthly_used"] - 1)
        state["daily_used"] = max(0, state["daily_used"] - 1)
        state["slot_reserved"] = False
        state["pending_platform"] = None
        state["updated_at"] = reference.isoformat()
        if not _save_budget(store_id, token, state):
            print("🛑 Apify: لم أستطع تحديث ميزانية الحصة الفارغة؛ أوقفت باقي مصادر هذا الموعد.")
            return []
        if outcome == "auth":
            return []

    return articles
