"""
🌍 استخبارات الزلازل — محرك المراقبة اللحظية (runner)
=====================================================
مشغَّل من GitHub Actions cron (earthquake_cron.yml) كل دقيقة. المحرك لا يلمس
القاعدة مباشرة؛ يكتب فقط عبر API النظام باستخدام SYSTEM_TOKEN.

الدورة الكاملة كل تشغيلة:
  1) قراءة تغذية USGS (all_hour — الزلزال يظهر فيها خلال ثوانٍ من وقوعه،
     وall_day احتياطاً لو فشلت الأولى).
  2) توحيد الحقول وإرسالها للنظام: POST /api/earthquake-intel/ingest
  3) السيرفر يحتفظ بالجديدة فقط (فريد source + external_id) وينبثق كل زلزال
     جديد فوراً في قناة الريال تايم → توست من الأعلى + صوت إنذار للزلازل
     القريبة من وسط القارة (وسط مصر) — أول واحد يعرف قبل التطبيقات كلها.

لا يعتمد على أي مكتبة خارجية غير requests (متوفرة في requirements.txt).
"""

import json
import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests

SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN", "").strip()
SYSTEM_API_URL = (os.environ.get("SYSTEM_API_URL") or "eoc-system-qaol.vercel.app").rstrip("/")
INGEST_URL = SYSTEM_API_URL + "/api/earthquake-intel/ingest"

# تغذية USGS: كل الزلازل في آخر ساعة (الأحدث) — وكل زلازل اليوم احتياطاً
FEED_URLS = (
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
)

UA_HEADERS = {"User-Agent": "EOC-Earthquake-Intel/1.0"}


def fetch_json(url, timeout=20):
    resp = requests.get(url, timeout=timeout, headers=UA_HEADERS)
    resp.raise_for_status()
    return resp.json()


def fetch_feed():
    """تغذية أساسية (آخر ساعة) + احتياطي (آخر يوم) — يرجع (features, اسم التغذية)."""
    errors = []
    for url in FEED_URLS:
        try:
            data = fetch_json(url)
            return data.get("features", []), url
        except Exception as e:
            errors.append(f"{url}: {e}")
    print("✋ فشلت كل تغذيات USGS:")
    for err in errors:
        print("   -", err)
    return [], None


def normalize_event(feature):
    """توحيد حدث GeoJSON من USGS إلى القاموس الذي يقبله endpoint الاستقبال."""
    try:
        props = feature.get("properties") or {}
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or [None, None, None]
        lon, lat, depth = (list(coords) + [None, None, None])[:3]
        return {
            "external_id": feature.get("id") or props.get("code") or "",
            "occurred_at": props.get("time"),            # epoch milliseconds
            "magnitude": props.get("mag"),
            "depth_km": depth,
            "place": props.get("place") or "",
            "latitude": lat,
            "longitude": lon,
        }
    except Exception as e:
        print(f"تخطي حدث غير صالح: {e}")
        return None


def send_batch(events):
    if not events:
        return {"inserted": 0}
    resp = requests.post(
        INGEST_URL,
        json={"source": "usgs", "events": events},
        headers={"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def run_once():
    if not SYSTEM_TOKEN:
        print("✋ SYSTEM_TOKEN غير مضبوط — لا يمكن بث الزلازل للنظام.")
        sys.exit(1)

    features, feed_name = fetch_feed()
    events = []
    for feature in features or []:
        norm = normalize_event(feature)
        if norm and norm.get("external_id"):
            events.append(norm)

    print(f"📡 تغذية: {feed_name} — أحداث صالحة: {len(events)}")
    try:
        result = send_batch(events)
        print(f"✅ تم الإرسال — الجديد للنظام: {result.get('inserted', 0)} / {len(events)}")
    except Exception as e:
        print(f"✋ فشل الإرسال للنظام: {e}")
        sys.exit(1)


if __name__ == "__main__":
    run_once()
