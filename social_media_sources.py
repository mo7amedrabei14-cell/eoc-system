"""Optional, authenticated/public social-source adapters for the EOC AI radar.

All integrations are opt-in and configuration-driven. Never scrape private accounts
or bypass platform permissions. Missing configuration disables only that adapter.
"""
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
import os
import re
import time
from urllib.parse import quote

import feedparser
import requests
from bs4 import BeautifulSoup


USER_AGENT = os.environ.get(
    "OSINT_USER_AGENT",
    "EOC-AI-Radar/1.0 (emergency incident monitoring; contact system administrator)",
)
GRAPH_VERSION = os.environ.get("META_GRAPH_API_VERSION", "v24.0").strip() or "v24.0"
REQUEST_TIMEOUT = 12


def _csv(name):
    return [value.strip().lstrip("@") for value in os.environ.get(name, "").split(",") if value.strip()]


def _parse_datetime(value):
    if value in (None, ""):
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        try:
            parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            parsed = parsedate_to_datetime(str(value).strip())
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def _is_recent(value, max_age_hours):
    parsed = _parse_datetime(value)
    if parsed is None:
        return True
    return parsed >= datetime.now(timezone.utc) - timedelta(hours=max_age_hours)


def _matches(text, keywords):
    haystack = str(text or "").casefold()
    return any(str(keyword).casefold() in haystack for keyword in keywords if keyword)


def _article(title, text, link, publisher, published_at=None, image_url="لا توجد صورة"):
    return {
        "title": str(title or "").strip()[:500],
        "text": str(text or "").strip()[:5000],
        "link": str(link or "").strip(),
        "publisher": str(publisher or "Social Media").strip(),
        "image_url": str(image_url or "لا توجد صورة"),
        "published_at": published_at,
        "platform": str(publisher or "Social Media").split(":", 1)[0],
    }


def _http_get(url, **kwargs):
    headers = dict(kwargs.pop("headers", {}) or {})
    headers.setdefault("User-Agent", USER_AGENT)
    return requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, **kwargs)


def _warn(platform, response=None):
    status = getattr(response, "status_code", None)
    suffix = f" (HTTP {status})" if status else ""
    print(f"⚠️ مصدر اجتماعي {platform}: تعذر الجلب{suffix}")


def _telegram(keywords, max_age_hours):
    articles = []
    channels = _csv("OSINT_TELEGRAM_CHANNELS")
    for channel in channels[:30]:
        safe_channel = re.sub(r"[^A-Za-z0-9_]", "", channel)
        if not safe_channel:
            continue
        response = None
        try:
            response = _http_get(f"https://t.me/s/{safe_channel}")
            if not response.ok:
                _warn(f"Telegram/{safe_channel}", response)
                continue
            soup = BeautifulSoup(response.text, "html.parser")
            messages = soup.select(".tgme_widget_message")
            for message in messages[-30:]:
                text_node = message.select_one(".tgme_widget_message_text")
                if not text_node:
                    continue
                body = text_node.get_text(" ", strip=True)
                if not _matches(body, keywords):
                    continue
                date_node = message.select_one(".tgme_widget_message_date time")
                published = date_node.get("datetime") if date_node else None
                if not _is_recent(published, max_age_hours):
                    continue
                data_post = str(message.get("data-post") or "")
                link = f"https://t.me/{data_post}" if data_post and "/" in data_post else f"https://t.me/s/{safe_channel}"
                title = re.sub(r"\s+", " ", body).strip()[:220]
                articles.append(_article(title, body, link, f"Telegram: @{safe_channel}", published))
        except Exception:
            _warn(f"Telegram/{safe_channel}", response)
    return articles


def _youtube(keywords, max_age_hours):
    articles = []
    channels = _csv("OSINT_YOUTUBE_CHANNEL_IDS")
    for channel_id in channels[:30]:
        if not re.fullmatch(r"UC[A-Za-z0-9_-]{10,}", channel_id):
            continue
        response = None
        try:
            response = _http_get(
                "https://www.youtube.com/feeds/videos.xml",
                params={"channel_id": channel_id},
            )
            if not response.ok:
                _warn(f"YouTube/{channel_id}", response)
                continue
            feed = feedparser.parse(response.content)
            for entry in feed.entries[:30]:
                title = getattr(entry, "title", "")
                summary = BeautifulSoup(getattr(entry, "summary", ""), "html.parser").get_text(" ", strip=True)
                published = getattr(entry, "published", None)
                if not _matches(f"{title} {summary}", keywords) or not _is_recent(published, max_age_hours):
                    continue
                articles.append(_article(
                    title, summary, getattr(entry, "link", ""),
                    f"YouTube: {getattr(feed.feed, 'title', channel_id)}", published,
                ))
        except Exception:
            _warn(f"YouTube/{channel_id}", response)
    return articles


def _reddit_token():
    # Prefer credentials that can mint a fresh token for each hourly workflow.
    client_id = os.environ.get("REDDIT_CLIENT_ID", "").strip()
    client_secret = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
    username = os.environ.get("REDDIT_USERNAME", "").strip()
    password = os.environ.get("REDDIT_PASSWORD", "").strip()
    if not all((client_id, client_secret, username, password)):
        return os.environ.get("REDDIT_ACCESS_TOKEN", "").strip()
    try:
        response = requests.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=(client_id, client_secret),
            data={"grant_type": "password", "username": username, "password": password},
            headers={"User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        if not response.ok:
            _warn("Reddit OAuth", response)
            return ""
        return str(response.json().get("access_token") or "")
    except Exception:
        _warn("Reddit OAuth")
        return ""


def _reddit(keywords, max_age_hours):
    articles = []
    subreddits = _csv("OSINT_REDDIT_SUBREDDITS")
    if not subreddits:
        return articles
    token = _reddit_token()
    if not token:
        print("ℹ️ Reddit غير مفعّل: أضف Reddit OAuth secrets و OSINT_REDDIT_SUBREDDITS.")
        return articles
    headers = {"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
    for subreddit in subreddits[:20]:
        if not re.fullmatch(r"[A-Za-z0-9_]{2,21}", subreddit):
            continue
        response = None
        try:
            response = requests.get(
                f"https://oauth.reddit.com/r/{subreddit}/new",
                params={"limit": 50, "raw_json": 1},
                headers=headers,
                timeout=REQUEST_TIMEOUT,
            )
            if not response.ok:
                _warn(f"Reddit/r/{subreddit}", response)
                continue
            entries = response.json().get("data", {}).get("children", [])
            for wrapper in entries:
                post = wrapper.get("data", {}) if isinstance(wrapper, dict) else {}
                title = post.get("title", "")
                body = post.get("selftext", "")
                published = post.get("created_utc")
                if not _matches(f"{title} {body}", keywords) or not _is_recent(published, max_age_hours):
                    continue
                articles.append(_article(
                    title, body, f"https://www.reddit.com{post.get('permalink', '')}",
                    f"Reddit: r/{subreddit}", published,
                ))
        except Exception:
            _warn(f"Reddit/r/{subreddit}", response)
    return articles


def _x(keywords, max_age_hours):
    token = os.environ.get("X_API_BEARER_TOKEN", "").strip()
    if not token:
        return []
    query_terms = []
    for value in keywords:
        term = str(value or "").strip()
        if len(term) < 2:
            continue
        if re.search(r"\s", term):
            term = '"' + term.replace('"', '') + '"'
        query_terms.append(term)
        if len(query_terms) >= 18:
            break
    if not query_terms:
        return []
    params = {
        "query": "(" + " OR ".join(query_terms) + ") -is:retweet",
        "max_results": 100,
        "tweet.fields": "created_at,lang,author_id",
        "expansions": "author_id",
        "user.fields": "username",
    }
    response = None
    try:
        response = requests.get(
            "https://api.x.com/2/tweets/search/recent",
            params=params,
            headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT,
        )
        if not response.ok:
            _warn("X", response)
            return []
        payload = response.json()
        users = {
            item.get("id"): item.get("username", "")
            for item in payload.get("includes", {}).get("users", [])
        }
        articles = []
        for post in payload.get("data", []):
            created = post.get("created_at")
            if not _is_recent(created, max_age_hours):
                continue
            if not _matches(post.get("text", ""), keywords):
                continue
            username = users.get(post.get("author_id"), "")
            link = f"https://x.com/{username}/status/{post.get('id')}" if username else f"https://x.com/i/web/status/{post.get('id')}"
            articles.append(_article(
                post.get("text", "")[:220], post.get("text", ""), link,
                f"X: @{username}" if username else "X", created,
            ))
        return articles
    except Exception:
        _warn("X", response)
        return []


def _meta_graph(path, params, platform):
    response = None
    try:
        params = dict(params)
        params["access_token"] = os.environ.get("META_ACCESS_TOKEN", "").strip()
        response = _http_get(f"https://graph.facebook.com/{GRAPH_VERSION}/{path}", params=params)
        if not response.ok:
            _warn(platform, response)
            return []
        payload = response.json()
        return payload.get("data", []) if isinstance(payload, dict) else []
    except Exception:
        _warn(platform, response)
        return []


def _facebook(keywords, max_age_hours):
    token = os.environ.get("META_ACCESS_TOKEN", "").strip()
    page_ids = _csv("META_FACEBOOK_PAGE_IDS")
    if not token or not page_ids:
        return []
    articles = []
    for page_id in page_ids[:20]:
        posts = _meta_graph(
            f"{page_id}/feed",
            {"fields": "message,permalink_url,created_time", "limit": 50},
            f"Facebook/{page_id}",
        )
        for post in posts:
            message = post.get("message", "")
            created = post.get("created_time")
            if not _matches(message, keywords) or not _is_recent(created, max_age_hours):
                continue
            articles.append(_article(
                re.sub(r"\s+", " ", message).strip()[:220], message,
                post.get("permalink_url", ""), f"Facebook Page: {page_id}", created,
            ))
    return articles


def _instagram(keywords, max_age_hours):
    token = os.environ.get("META_ACCESS_TOKEN", "").strip()
    account_ids = _csv("META_INSTAGRAM_USER_IDS")
    if not token or not account_ids:
        return []
    articles = []
    for account_id in account_ids[:20]:
        posts = _meta_graph(
            f"{account_id}/media",
            {"fields": "id,caption,permalink,timestamp,media_type", "limit": 50},
            f"Instagram/{account_id}",
        )
        for post in posts:
            caption = post.get("caption", "")
            created = post.get("timestamp")
            if not _matches(caption, keywords) or not _is_recent(created, max_age_hours):
                continue
            articles.append(_article(
                re.sub(r"\s+", " ", caption).strip()[:220], caption,
                post.get("permalink", ""), f"Instagram Business: {account_id}", created,
            ))
    return articles


def _extra_social_rss(keywords, max_age_hours):
    """Read optional RSS/Atom feeds from approved social-feed bridges.

    Set OSINT_EXTRA_SOCIAL_FEEDS to entries in the form
    label::https://feed-url|another label::https://another-feed-url.
    HTTPS is required; entries are deliberately explicit and capped.
    """
    articles = []
    configured = os.environ.get("OSINT_EXTRA_SOCIAL_FEEDS", "").strip()
    for entry_config in configured.split("|")[:20]:
        if "::" not in entry_config:
            continue
        label, url = (part.strip() for part in entry_config.split("::", 1))
        if not label or not url.lower().startswith("https://"):
            continue
        response = None
        try:
            response = _http_get(url)
            if not response.ok:
                _warn(f"Social RSS/{label}", response)
                continue
            feed = feedparser.parse(response.content)
            for entry in feed.entries[:25]:
                title = getattr(entry, "title", "")
                summary = BeautifulSoup(getattr(entry, "summary", ""), "html.parser").get_text(" ", strip=True)
                published = getattr(entry, "published", None) or getattr(entry, "updated", None)
                if not _matches(f"{title} {summary}", keywords) or not _is_recent(published, max_age_hours):
                    continue
                articles.append(_article(
                    title, summary, getattr(entry, "link", ""),
                    f"Social RSS: {label}", published,
                ))
        except Exception:
            _warn(f"Social RSS/{label}", response)
    return articles


def fetch_social_articles(keywords, max_age_hours=3):
    """Collect recent, keyword-matching posts from enabled social adapters.

    Public Telegram channel previews and YouTube channel feeds need channel IDs
    only. Reddit, X, Facebook and Instagram use authenticated APIs and therefore
    stay disabled until their corresponding secrets/variables are configured.
    """
    articles = []
    adapters = (
        ("Telegram", _telegram),
        ("YouTube", _youtube),
        ("Reddit", _reddit),
        ("X", _x),
        ("Facebook", _facebook),
        ("Instagram", _instagram),
        ("Extra social RSS", _extra_social_rss),
    )
    for platform, adapter in adapters:
        try:
            found = adapter(keywords, max_age_hours)
            articles.extend(item for item in found if item.get("title") and item.get("link"))
            if found:
                print(f"📱 {platform}: رصد {len(found)} منشورًا مطابقًا")
        except Exception:
            _warn(platform)
    return articles
