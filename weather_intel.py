"""
استخبارات الطقس — محرك التشغيل اليومي (runner)
==============================================
مشغَّل من GitHub Actions cron (weather_cron.yml) — mirror لهيكل ai_radar.py:
البوت لا يلمس قاعدة البيانات إطلاقًا؛ يكتب فقط عبر الـ API بـ SYSTEM_TOKEN.

البنية: config → فحص الموديل (fail-fast قبل أي جلب) → مواقع/إعدادات ← API
      → تحديث أرشيف حديث (best-effort، لا يمسّ المخزون) → forecast ← Open-Meteo
      → إحصاءات/تواتر/شذوذ/مخاطر **حتمية** (statistics stdlib) — ليس Claude
      → Claude يكتب التقييم فقط من JSON محدد
      → POST /api/weather-intel/ingest (معاملة واحدة)

صفر dependencies جديدة: requests + statistics + zoneinfo (stdlib).
كل طلب خارجي: timeout + محاولات محدودة + تسجيل.
"""

import json
import math
import os
import sys
import time
import uuid
from datetime import datetime, timedelta
from statistics import mean, median, stdev
from zoneinfo import ZoneInfo

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── 1) الإعدادات والمفاتيح ──────────────────────────────────────────────────
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN", "").strip()
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

SYSTEM_API_URL = os.environ.get(
    "SYSTEM_API_URL", "https://eoc-system-b12f.vercel.app"
).rstrip("/")

OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
ANTHROPIC_VERSION = "2023-06-01"

TZ = ZoneInfo("Africa/Cairo")          # لا UTC إطلاقًا لحساب «اليوم»
TARGET_DELTA_DAYS = 1                  # TARGET_DATE = (تاريخ القاهرة المحلي) + يوم
BACKFILL_MIN_YEAR = int(os.environ.get("BACKFILL_MIN_YEAR", "1996"))

# نقطة 7: الموديل قابل للضبط ويُتحقَّق منه ضد الـ API الفعلي قبل أول جلب طقس.
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5").strip()
# نقطة «1» من الموافقة: حدّ مخرجات واقعي قابل للضبط (لا 3 ولا حذف JSON)
CLAUDE_MAX_TOKENS = int(os.environ.get("CLAUDE_MAX_TOKENS", "2000"))
CLAUDE_MAX_TOKENS = max(100, min(CLAUDE_MAX_TOKENS, 16000))

HISTORY_WINDOW_DAYS = int(os.environ.get("HISTORY_WINDOW_DAYS", "3"))
MIN_SAMPLES = int(os.environ.get("MIN_SAMPLES", "20"))

# معلومة فقط لعرضها في السجل عند تعذّر واجهة الـModels (ليست بوابة تأكيد)
KNOWN_CLAUDE_MODELS = {
    "claude-sonnet-5", "claude-opus-5", "claude-fable-5-1",
    "claude-haiku-4-5", "claude-haiku-4-5-20251001",
}

# مقاييس الخط المرجعي: مفتاح داخلي → مفتاح Open-Meteo (forecast/archive)
#   1) يجب أن يتطابق تعريف المتري بين التوقعات والأرشيف حتى يكون المقارنة سليمة.
#   2) أي متري غير متاح في الاستجابة يُتجاهل بأمان بدلًا من كسر التشغيل (مثل gust/cloud).
METRIC_DEFS = {
    "tmax":     {"title_ar": "الحرارة العظمى",      "unit": "°C",   "dir": "both", "forecast": "temperature_2m_max",     "archive": "temperature_2m_max",   "optional": False},
    "tmin":     {"title_ar": "الحرارة الصغرى",      "unit": "°C",   "dir": "both", "forecast": "temperature_2m_min",     "archive": "temperature_2m_min",   "optional": False},
    "precip":   {"title_ar": "هطول الأمطار",        "unit": "mm",   "dir": "high", "forecast": "precipitation_sum",       "archive": "precipitation_sum",    "optional": False},
    "wind":     {"title_ar": "الرياح القصوى",       "unit": "كم/س", "dir": "high", "forecast": "wind_speed_10m_max",      "archive": "wind_speed_10m_max",   "optional": False},
    "humidity": {"title_ar": "متوسط الرطوبة",       "unit": "%",    "dir": "high", "forecast": "relative_humidity_2m_mean", "archive": "relative_humidity_2m_mean", "optional": False},
    "gusts":    {"title_ar": "هبات الرياح",         "unit": "كم/س", "dir": "high", "forecast": "wind_gusts_10m_max",      "archive": "wind_gusts_10m_max",   "optional": True},
    "cloud":    {"title_ar": "الغطاء السحابي",      "unit": "%",    "dir": "info", "forecast": "cloud_cover_mean",        "archive": None,                   "optional": True},
}

WMO_LABELS = {
    0: ("سماء صافية", "Clear sky"), 1: ("غائم جزئيًا", "Mainly clear"), 2: ("غائم جزئيًا", "Partly cloudy"),
    3: ("غائم", "Overcast"), 45: ("ضباب", "Fog"), 48: ("ضباب متجمد", "Depositing rime fog"),
    51: ("رذاذ خفيف", "Light drizzle"), 53: ("رذاذ", "Drizzle"), 55: ("رذاذ كثيف", "Dense drizzle"),
    61: ("مطر خفيف", "Slight rain"), 63: ("مطر", "Moderate rain"), 65: ("مطر غزير", "Heavy rain"),
    66: ("مطر متجمد", "Freezing rain"), 67: ("مطر متجمد غزير", "Freezing rain heavy"),
    71: ("ثلوج خفيفة", "Slight snow"), 73: ("ثلوج", "Snow"), 75: ("ثلوج كثيفة", "Heavy snow"),
    77: ("حبيبات ثلجية", "Snow grains"), 80: ("زخات خفيفة", "Slight showers"), 81: ("زخات مطر", "Showers"),
    82: ("زخات غزيرة", "Violent showers"), 85: ("زخات ثلجية خفيفة", "Slight snow showers"),
    86: ("زخات ثلجية كثيفة", "Heavy snow showers"), 95: ("عاصفة رعدية", "Thunderstorm"),
    96: ("عاصفة رعدية مع برد", "Thunderstorm hail"), 99: ("عاصفة رعدية قوية مع برد", "Thunderstorm severe hail"),
}

SYSTEM_PROMPT = """أنت محلل أرصاد تشغيلي مساعد لغرفة عمليات الطوارئ (EOC) — أداة دعم، وليست مصدر إنذار رسمي.

تحلل JSON مُدخل فقط (توقعات + إحصاءات تاريخية + تكرارات + شذوذ + مخاطر — كلها محسوبة سلفًا). التزم بأمانة العدد:
- لا تختلق رقمًا ولا تقدر متري غائبًا أبدًا.
- لا تستنتج فئات إحصائية بنفسك (extreme/high/normal/insufficient_data أمامك محسوبة) — لا تعيد تصنيفها.
- لا كلمات قطع ('متأكد/مؤكد/سيحدث'), ولا إنذارات طوارئ، ولا تحذيرات رسمية — توصيات مراقبة فقط.
- كل جملة تذكر أصله بين قوسين: [توقعات] أو [تاريخي] أو [إحصائي] أو [تشغيلي].
- لو ظهر sample_count أقل من الحد الأدنى (insufficient_data) أو ai metadata قال إنه ناقص، صرّح بذلك بدل تجاوزه.

أخرج JSON عربيًا صارمًا فقط (بدون توسيم ```) بالمفاتيح الخمسة:
{
  "weather_summary": "ملخص عملياتي لطقس اليوم التالي (جة قصيرة)",
  "historical_comparison": "مقارنة مع الخط المرجعي التاريخي: مصدره ونافذته وعدد العينات وما يخبر الإحصاء، بلا أرقام مخترعة",
  "significant_anomalies": "جمل تُبرز أي شذوذ مهم (لا شيء لا يوجد)",
  "operational_implications": "الآثار التشغيلية على غرفة العمليات (سلوك ميداني، حركة، تغذية، إضاءة)",
  "recommended_monitoring": "نقاط مراقبة مقترحة للغرفة (لا إنذارات)"
}
"""


# ── 2) أدوات مساعدة ─────────────────────────────────────────────────────────
def cairo_today():
    return datetime.now(TZ).date()


def target_date_for_run():
    return cairo_today() + timedelta(days=TARGET_DELTA_DAYS)


def cairo_now_str():
    return datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S")


def window_dates(target_day, window, min_year=BACKFILL_MIN_YEAR):
    """تواريخ النافذة (± window) حول target_day عبر كل سنة من min_year حتى سنة الهدف.
    أي تاريخ غير موجود في تقويم سنة ما (مثل 29 فبراير) يُتخطى — لا يختلق شيئًا."""
    out = []
    for y in range(min_year, target_day.year + 1):
        for d in range(-window, window + 1):
            try:
                out.append(target_day.replace(year=y) + timedelta(days=d))
            except ValueError:
                continue
    return out


def http_get(url, headers=None, params=None, timeout=30):
    """GET آمن مع check على النتيجة — يرمي على الفشل (لا silent)."""
    import requests
    r = requests.get(url, headers=headers or {}, params=params or {}, timeout=timeout)
    r.raise_for_status()
    return r.json()


def http_post(url, headers=None, json_body=None, timeout=30):
    import requests
    r = requests.post(url, headers=headers or {}, json=json_body or {}, timeout=timeout)
    return r


def numeric(v):
    """تحويل آمن — العودة None للقيم الغائبة (لا صفر مخترعًا)."""
    if v is None:
        return None
    try:
        f = float(v)
        return f if not math.isnan(f) else None
    except (TypeError, ValueError):
        return None


# ── 3) الإحصاءات الحتمية (كتَب يُختبر محليًا — لا Claude) ───────────────────
def percentile(sorted_vals, q):
    """استيفاء خطّي على قيم مرتبة — مطابق لـ Excel PERCENTILE.INC / NumPy الافتراضي.
    الصيغة المحددة: r = q·(n−1)، ثم فيرج على ⌊r⌋/⌈r⌉."""
    n = len(sorted_vals)
    if n == 0:
        return None
    if n == 1:
        return sorted_vals[0]
    r = q * (n - 1)
    lo = int(math.floor(r))
    hi = int(math.ceil(r))
    if lo == hi:
        return sorted_vals[lo]
    frac = r - lo
    return sorted_vals[lo] + frac * (sorted_vals[hi] - sorted_vals[lo])


def compute_statistics(values, window_days, period_start, period_end,
                       history_source="era5-reanalysis", methodology_version="v1"):
    """إحصاءات متري واحد من قيم صالحة فقط. يعيد dict (العناصر المعدومة None)."""
    vals = [float(v) for v in values if numeric(v) is not None]
    n = len(vals)
    if n == 0:
        return {
            "sample_count": 0, "mean": None, "median": None, "min": None, "max": None,
            "p10": None, "p25": None, "p75": None, "p90": None, "stddev": None,
            "history_source": history_source, "window_days": window_days,
            "methodology_version": methodology_version,
            "period_start": str(period_start), "period_end": str(period_end),
        }
    sv = sorted(vals)
    return {
        "sample_count": n,
        "mean": round(mean(vals), 3),
        "median": round(median(vals), 3),
        "min": round(min(vals), 3),
        "max": round(max(vals), 3),
        "p10": round(percentile(sv, 0.10), 3),
        "p25": round(percentile(sv, 0.25), 3),
        "p75": round(percentile(sv, 0.75), 3),
        "p90": round(percentile(sv, 0.90), 3),
        "stddev": (round(stdev(vals), 3) if n > 1 else 0.0),
        "history_source": history_source,
        "window_days": window_days,
        "methodology_version": methodology_version,
        "period_start": str(period_start),
        "period_end": str(period_end),
    }


def classify_anomaly(value, stats, direction='both', min_samples=MIN_SAMPLES):
    """تصنيف حتمي عبر فواصل P10/P25/P75/P90 (نقطة 6). يعيد dict، لا نصوص مُصاغة.
    directions: both (تتجاهل الجانبين) / high (المُنطق المرتفع فقط) — المنخفض محايد تشغيليًا."""
    if value is None:
        return {"category": "insufficient_data", "reason": "لا توجد قيمة توقعات", "record": False}
    if not stats or stats.get("sample_count", 0) < min_samples:
        return {
            "category": "insufficient_data",
            "reason": f"عدد العينات {stats.get('sample_count', 0)} أقل من الحد الأدنى ({min_samples})",
            "record": False,
        }
    if direction == 'high' and value <= stats.get("p75", value):
        return {"category": "normal", "reason": "ضمن النطاق (المنخفض محايد تشغيليًا)", "record": False}

    v, mx, mn = float(value), stats["max"], stats["min"]
    if v > mx or v < mn:
        record = True
    else:
        record = False

    p10, p25, p75, p90 = stats["p10"], stats["p25"], stats["p75"], stats["p90"]
    if v < p10:
        cat = "extreme_low"
        note = "أدنى من النطاق الواقعي التاريخي"
    elif v < p25:
        cat = "low"
        note = "أدنى من الطبيعي"
    elif v <= p75:
        cat = "normal"
        note = "ضمن النطاق الطبيعي"
    elif v <= p90:
        cat = "high"
        note = "أعلى من الطبيعي"
    else:
        cat = "extreme_high"
        note = "أعلى من النطاق الواقعي التاريخي"
    return {"category": cat, "reason": note, "record": record, "value": v, "max_hist": mx, "min_hist": mn}


def compute_frequency(values, threshold, relation='ge', desc=None):
    """شفافية التكرار (نقطة 8/9): المقام = عدد المشاهدات الصالحة فعلًا."""
    vals = [float(v) for v in values if numeric(v) is not None]
    total = len(vals)
    if total == 0:
        return {"qualifying_count": 0, "total_count": 0, "frequency_pct": 0.0}
    if relation == 'le':
        q = sum(1 for v in vals if v <= threshold)
    else:
        q = sum(1 for v in vals if v >= threshold)
    return {
        "qualifying_count": q,
        "total_count": total,
        "frequency_pct": round(q * 100.0 / total, 4) if total else 0.0,
        "relation": relation,
        "desc": desc,
    }


# ── 4) فحص الموديل قبل أول جلب (fail-fast — نقطة «2» من الموافقة) ───────────
def validate_claude_model(model, api_key):
    """يتحقق من الموديل ضد واجهة Models الفعلية في Anthropic. يعيد (سليم أم لا, رسالة).
    لو تعذّرت واجهة الـModels (شبكة) → نحذّر ونتابع: المكالمة الفعلية ستكشف أي خطأ حقيقي."""
    if not api_key:
        return False, "ANTHROPIC_API_KEY مفقود — لا يمكن تشغيل التقييم الذكي."
    try:
        r = http_get(
            ANTHROPIC_MODELS_URL,
            headers={"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION},
            timeout=15,
        )
        ids = {m.get("id") for m in r.get("data", []) if m.get("id")}
        if model in ids:
            return True, ""
        return False, f"الموديل المكوّن «{model}» غير متاح في الـ API الحالي. المتاح مثلًا: {sorted(ids)[:8]}"
    except Exception as e:
        print(f"⚠️ تعذّر الوصول لواجهة التحقق من الموديلات ({e}) — سيتحقق الـ API الفعلي بنفسه.")
        return True, ""


# ── 5) جلب البيانات (كلها timeout + خطأ واضح) ───────────────────────────────
def api_headers():
    return {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}


def fetch_locations():
    if not SYSTEM_TOKEN:
        raise SystemExit("✋ SYSTEM_TOKEN غير مضبوط — تأكد من الـ secrets.")
    return http_get(f"{SYSTEM_API_URL}/api/weather-intel/locations?active=1", headers=api_headers(), timeout=20)


def fetch_config():
    return http_get(f"{SYSTEM_API_URL}/api/weather-intel/config", headers=api_headers(), timeout=20)


def fetch_history(location_id, target_day, window):
    rows = http_get(
        f"{SYSTEM_API_URL}/api/weather-intel/history",
        headers=api_headers(),
        params={"location_id": location_id, "target_date": str(target_day), "window": window},
        timeout=30,
    )
    return rows or []


def fetch_forecast(lat, lon, target_day):
    """توقعات اليوم المستهدف (خطوة واحدة). يعيد (dict بقيم المتري, raw_json)."""
    url = OPEN_METEO_FORECAST
    daily_params = []
    for m, d in METRIC_DEFS.items():
        if d["forecast"]:                       # gust/cloud قد تكون اختياريًا
            if d["optional"]:
                daily_params.append(d["forecast"])
            else:
                daily_params.append(d["forecast"])
    daily_params += ["precipitation_probability_max", "weather_code"]
    # remove_dup وترتيب ثابت (لا تتكرر السلسلة)
    daily = ",".join(dict.fromkeys(daily_params))
    params = {
        "latitude": lat, "longitude": lon,
        "daily": daily,
        "timezone": "Africa/Cairo",
        "start_date": str(target_day), "end_date": str(target_day),
    }
    data = http_get(url, params=params, timeout=30)
    daily_block = data.get("daily", {})
    fc = {
        "tmax": numeric(first(daily_block.get("temperature_2m_max"))),
        "tmin": numeric(first(daily_block.get("temperature_2m_min"))),
        "precip": numeric(first(daily_block.get("precipitation_sum"))),
        "precip_prob_pct": numeric(first(daily_block.get("precipitation_probability_max"))),
        "wind": numeric(first(daily_block.get("wind_speed_10m_max"))),
        "gusts": numeric(first(daily_block.get("wind_gusts_10m_max"))),
        "humidity": numeric(first(daily_block.get("relative_humidity_2m_mean"))),
        "cloud": numeric(first(daily_block.get("cloud_cover_mean"))),
        "weather_code": first(daily_block.get("weather_code")),
    }
    return fc, data


def first(arr):
    if not arr:
        return None
    return arr[0]


def fetch_archive_recent(lat, lon, start_day, end_day):
    """تحديث أرشيف حديث (best-effort). يعيد قائمة dicts على شكل صفوف weather_history_daily."""
    daily = ",".join(dict.fromkeys(
        d["archive"] for d in METRIC_DEFS.values() if d["archive"]
    ))
    if not daily:
        return []
    params = {
        "latitude": lat, "longitude": lon,
        "daily": daily, "timezone": "Africa/Cairo",
        "start_date": str(start_day), "end_date": str(end_day),
    }
    data = http_get(OPEN_METEO_ARCHIVE, params=params, timeout=30)
    blk = data.get("daily", {})
    n = len(blk.get("time", []) or [])
    out = []
    for i in range(n):
        try:
            d = datetime.strptime(blk["time"][i], "%Y-%m-%d").date()
        except Exception:
            continue
        out.append({
            "record_date": str(d),
            "tmax": numeric(first(blk.get("temperature_2m_max")[i:i + 1] or [None])),
            "tmin": numeric(first(blk.get("temperature_2m_min")[i:i + 1] or [None])),
            "precip_mm": numeric(first(blk.get("precipitation_sum")[i:i + 1] or [None])),
            "wind_max_kph": numeric(first(blk.get("wind_speed_10m_max")[i:i + 1] or [None])),
            "wind_gusts_kph": numeric(first(blk.get("wind_gusts_10m_max")[i:i + 1] or [None])),
            "humidity_mean_pct": numeric(first(blk.get("relative_humidity_2m_mean")[i:i + 1] or [None])),
            "cloud_cover_mean_pct": numeric(first(blk.get("cloud_cover_mean")[i:i + 1] or [None])),
        })
    return out


CORE_METRICS = ("tmax", "tmin", "precip", "wind", "humidity")


def history_metric_columns():
    return {
        "tmax": "tmax", "tmin": "tmin", "precip": "precip_mm",
        "wind": "wind_max_kph", "gusts": "wind_gusts_kph",
        "humidity": "humidity_mean_pct", "cloud": "cloud_cover_mean_pct",
    }


def build_baseline(history_rows, recent_rows, target_day, window):
    """يحوّل الصفوف (من DB + الأرشيف الحديث) إلى قيم النافذة لكل متري، ثم يحسب الإحصاءات.
    merged = تاريخ → صف (يكمل صفوف DB بأي أيام جلبناها حديثًا لا توجد فيها)."""
    by_date = {}
    for h in history_rows:
        by_date[h["record_date"]] = h
    for r in recent_rows:
        by_date[r["record_date"]] = r
    window_set = {str(d) for d in window_dates(target_day, window)}
    col = history_metric_columns()
    series = {m: [] for m in col}
    dates = []
    for rd, row in by_date.items():
        if rd not in window_set:
            continue
        dates.append(rd)
        for m, c in col.items():
            v = row.get(c)
            if numeric(v) is not None:
                series[m].append(float(v))
    period_start = min(dates) if dates else None
    period_end = max(dates) if dates else None
    stats = {}
    for m in METRIC_DEFS:
        if m not in column_map:
            continue
        if m not in series:
            continue
        stats[m] = compute_statistics(series[m], window, period_start, period_end)
    return stats


# مفتاح المتري → عمود قياس للقيم (للعرض) — نفس USE_ID كما بالأسفل
column_map = history_metric_columns()


def build_frequencies(series, config, stats_by_metric, target_day, window):
    """سجلات التكرار من عتبات weather_intel_config (المقام = العينات الصالحة)."""
    freq_specs = [
        ("freq.tmax_ge", "tmax", "ge"),
        ("freq.tmin_le", "tmin", "le"),
        ("freq.precip_ge", "precip", "ge"),
        ("freq.wind_ge", "wind", "ge"),
    ]
    out = []
    for key, metric, relation in freq_specs:
        cfg_value = config.get(key, {}).get("value")
        if cfg_value is None or metric not in series:
            continue
        try:
            thr = float(cfg_value)
        except (TypeError, ValueError):
            continue
        st = stats_by_metric.get(metric, {})
        desc = config.get(key, {}).get("description_ar") or key
        unit = config.get(key, {}).get("unit") or METRIC_DEFS[metric]["unit"]
        f = compute_frequency(series[metric], thr, relation, desc)
        out.append({
            "metric": metric, "threshold_value": thr,
            "threshold_unit": unit, "threshold_desc_ar": desc,
            "qualifying_count": f["qualifying_count"], "total_count": f["total_count"],
            "frequency_pct": f["frequency_pct"],
            "period_start": st.get("period_start"), "period_end": st.get("period_end"),
            "methodology": f"نافذة ±{window} يومًا عبر {BACKFILL_MIN_YEAR}-{target_day.year} · مقام = المشاهدات الصالحة",
        })
    return out


def detect_hazards(fc, config):
    """المخاطر من العتبات القابلة للضبط (لا شيء «مخترع»). لا رؤية/ضباب من الرطوبة — تعليقًا على نقطة 4."""
    out = []
    tmax = fc.get("tmax")
    v = cfg_f(config, "hazard.tmax_high_c", 40.0)
    if tmax is not None and tmax >= v:
        out.append({"code": "extreme_heat", "level": "high", "title_ar": "موجّه حرارة مرتفعة",
                    "detail_ar": f"الحرارة العظمى المتوقعة {tmax}°C تبلغ/تتجاوز {v:g}°C", "unit": "°C"})
    tmin = fc.get("tmin")
    v = cfg_f(config, "hazard.tmin_low_c", 5.0)
    if tmin is not None and tmin <= v:
        out.append({"code": "cold", "level": "high", "title_ar": "برودة",
                    "detail_ar": f"الحرارة الصغرى المتوقعة {tmin}°C تنخفض إلى/دون {v:g}°C", "unit": "°C"})
    precip = fc.get("precip")
    v = cfg_f(config, "hazard.precip_heavy_mm", 10.0)
    if precip is not None and precip >= v:
        out.append({"code": "heavy_rain", "level": "medium", "title_ar": "أمطار غزيرة",
                    "detail_ar": f"الهطول المتوقع {precip} مم يبلغ/يتجاوز {v:g} مم", "unit": "mm"})
    wind = fc.get("wind")
    v = cfg_f(config, "hazard.wind_high_kph", 40.0)
    if wind is not None and wind >= v:
        out.append({"code": "strong_wind", "level": "medium", "title_ar": "رياح قوية",
                    "detail_ar": f"الرياح القصوى المتوقعة {wind} كم/س تبلغ/تتجاوز {v:g} كم/س", "unit": "كم/س"})
    gusts = fc.get("gusts")
    v = cfg_f(config, "hazard.wind_gusts_high_kph", 60.0)
    if gusts is not None and gusts >= v:
        out.append({"code": "strong_wind", "level": "medium", "title_ar": "هبات رياح قوية",
                    "detail_ar": f"الهبات المتوقعة {gusts} كم/س تبلغ/تتجاوز {v:g} كم/س", "unit": "كم/س"})
    wcode = fc.get("weather_code")
    if wcode is not None:
        t_codes = {int(x.strip()) for x in (config.get("hazard.thunderstorm_codes", {}).get("value") or "95,96,99").split(",") if x.strip().isdigit()}
        f_codes = {int(x.strip()) for x in (config.get("hazard.fog_codes", {}).get("value") or "45,48").split(",") if x.strip().isdigit()}
        label, _ = WMO_LABELS.get(int(wcode), ("حالة غير مصنفة", "Unknown"))
        if int(wcode) in t_codes:
            out.append({"code": "thunderstorm", "level": "medium", "title_ar": "رعد",
                        "detail_ar": f"التوقعات تشير إلى {label} (رمز WMO {wcode}) — من التوقعات فقط، لا خط تاريخي", "unit": ""})
        elif int(wcode) in f_codes:
            out.append({"code": "fog", "level": "low", "title_ar": "ضباب",
                        "detail_ar": f"التوقعات تشير إلى {label} (رمز WMO {wcode}) — فئة فعلية من التوقعات فقط، لا خط تاريخي", "unit": ""})
    return out


def cfg_f(config, key, default):
    try:
        return float(config.get(key, {}).get("value", default))
    except (TypeError, ValueError):
        return default


# ── 6) تقييم Claude (الإخراج JSON فقط، والحذر من الاقتطاع) ──────────────────
def extract_json(text):
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t[3:]
        t = t.rsplit("```", 1)[0]
    t = t.strip()
    candidates = [t]
    s, e = t.find("{"), t.rfind("}")
    if s != -1 and e != -1 and s < e:
        candidates.append(t[s:e + 1])
    for c in candidates:
        try:
            return json.loads(c)
        except (json.JSONDecodeError, TypeError):
            continue
    return None


def call_claude_ai(structured_input):
    """يكتب التقييم من JSON مُدخل فقط. يعيد (parsed, raw_text, error_msg)."""
    if not ANTHROPIC_API_KEY:
        return None, "", "ANTHROPIC_API_KEY مفقود (ai_status='error' بدون نص وهمي)."
    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    body = {
        "model": CLAUDE_MODEL,
        "max_tokens": CLAUDE_MAX_TOKENS,
        "messages": [
            {"role": "user", "content": f"{SYSTEM_PROMPT}\n\nالبيانات المدخلة (JSON):\n{json.dumps(structured_input, ensure_ascii=False, indent=2)}"}
        ],
    }
    last_err = None
    for attempt in range(3):
        try:
            import requests
            r = requests.post(ANTHROPIC_MESSAGES_URL, headers=headers, json=body, timeout=90)
            if r.status_code == 200:
                data = r.json()
                stop = data.get("stop_reason")
                parts = data.get("content") or []
                raw = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
                parsed = extract_json(raw)
                if parsed is None:
                    if stop == "max_tokens":
                        last_err = "الرد وصل حدّ الخطوط (max_tokens) قبل اكتمال JSON — زِد CLAUDE_MAX_TOKENS."
                    else:
                        last_err = "Claude لم يخرج JSON صالحًا."
                else:
                    return parsed, raw, None
            else:
                last_err = f"خطأ Anthropic {r.status_code}: {r.text[:300]}"
            if attempt < 2:
                print(f"  ⚠️ محاولة {attempt + 1} فشلت ({last_err[:80]}) — إعادة بعد 2 ثانية…")
                time.sleep(2)
        except Exception as e:
            last_err = f"فشل الاتصال بـ Anthropic: {e}"
            if attempt < 2:
                print(f"  ⚠️ محاولة {attempt + 1}: {last_err}")
                time.sleep(2)
    return None, "", last_err


def build_claude_input(loc, fc, stats, frequencies, anomalies, hazards, target_day):
    from collections import OrderedDict
    fc_clean = OrderedDict()
    for m, d in METRIC_DEFS.items():
        v = fc.get(m)
        if v is None:
            continue
        fc_clean[m] = {"value": v, "unit": d["unit"], "title_ar": d["title_ar"]}
    if fc.get("weather_code") is not None:
        label, label_en = WMO_LABELS.get(int(fc["weather_code"]), ("غير مصنف", "Unknown"))
        fc_clean["weather_code"] = {"code": fc["weather_code"], "label_ar": label, "label_en": label_en}
    baseline = OrderedDict()
    for m, st in stats.items():
        baseline[m] = {
            "title_ar": METRIC_DEFS[m]["title_ar"], "unit": METRIC_DEFS[m]["unit"],
            **{k: st.get(k) for k in
               ("sample_count", "mean", "median", "min", "max", "p10", "p25", "p75", "p90", "stddev")},
            "period_start": st.get("period_start"), "period_end": st.get("period_end"),
            "window_days": st.get("window_days"), "history_source": st.get("history_source"),
        }
    return {
        "metadata": {
            "target_date": str(target_day),
            "location": {"id": loc["id"], "name_ar": loc["name_ar"], "name_en": loc["name_en"]},
            "coordinates": {"latitude": loc["latitude"], "longitude": loc["longitude"]},
            "sources": {
                "forecast": "Open-Meteo Forecast API",
                "historical_baseline": "ERA5 reanalysis (Open-Meteo Archive)",
                "window_days": stats.get("tmax", {}).get("window_days", HISTORY_WINDOW_DAYS),
                "sample_note": "المقادير إحصائية مشتقة من مشاهدات صالحة فقط",
            },
        },
        "forecast": dict(fc_clean),
        "historical_baseline": dict(baseline),
        "frequencies": frequencies,
        "anomalies": anomalies,
        "hazards": hazards,
    }


# ── 7) الإرسال النهائي (معاملة واحدة) ───────────────────────────────────────
def send_ingest(payload):
    try:
        r = http_post(f"{SYSTEM_API_URL}/api/weather-intel/ingest", headers=api_headers(), json_body=payload, timeout=60)
        if r.status_code not in (200, 201):
            print(f"⚠️ ingest فشل ({r.status_code}): {r.text[:300]}")
            return False
        print(f"  ✅ ingest OK (run_id={r.json().get('run_id')})")
        return True
    except Exception as e:
        print(f"⚠️ فشل إرسال ingest: {e}")
        return False


# ── 8) المحرك الرئيسي ───────────────────────────────────────────────────────
def build_run(stat, **kw):
    d = {"status": stat}
    d.update(kw)
    return d


def run_pipeline():
    if not SYSTEM_TOKEN:
        print("✋ SYSTEM_TOKEN مفقود — لا يمكن تشغيل استخبارات الطقس.")
        return 1
    print(f"\n[{cairo_now_str()}] 🌤️ بدء تشغيل استخبارات الطقس (TARGET = {target_date_for_run()})")

    # — فحص الموديل أولًا: أي تكوين سيّئ يتوقف هنا قبل إنفاق أي مكالمة (نقطة «2») —
    ok_model, model_msg = validate_claude_model(CLAUDE_MODEL, ANTHROPIC_API_KEY)
    if not ok_model:
        print(f"🚫 فشل إنهائي مبكر: {model_msg}")
        send_ingest({
            "client_run_uuid": str(uuid.uuid4()),
            "run_date": str(cairo_today()), "target_date": str(target_date_for_run()),
            "status": "failed",
            "total_locations": 0, "successful_locations": 0, "error_locations": 0,
            "source_meta": {"claude_model": CLAUDE_MODEL},
            "error_details": {"fatal": model_msg},
            "snapshots": [], "statistics": [], "frequencies": [], "assessments": [], "history_rows": [],
        })
        return 1
    print(f"  ✓ الموديل {CLAUDE_MODEL} متاح (max_tokens={CLAUDE_MAX_TOKENS})")

    target_day = target_date_for_run()
    run_date = cairo_today()
    client_run_uuid = str(uuid.uuid4())
    source_meta = {
        "forecast_source": "open-meteo-forecast",
        "historical_source": "era5-reanalysis",
        "window_days": HISTORY_WINDOW_DAYS,
        "min_samples": MIN_SAMPLES,
        "claude_model": CLAUDE_MODEL,
        "claude_max_tokens": CLAUDE_MAX_TOKENS,
        "archive_refresh": {},   # «best-effort» — أي فشل يُسجَّل هنا ولا يمسّ المخزون
    }

    # — 1) المواقع + العتبات (من DB عبر الـ API — لا hardcode) —
    try:
        locations = fetch_locations()
    except Exception as e:
        print(f"🚫 فشل جلب المواقع: {e}")
        send_ingest({"client_run_uuid": client_run_uuid, "run_date": str(run_date), "target_date": str(target_day),
                     "status": "failed", "total_locations": 0, "successful_locations": 0, "error_locations": 0,
                     "source_meta": source_meta, "error_details": {"fatal": f"فشل جلب المواقع: {e}"},
                     "snapshots": [], "statistics": [], "frequencies": [], "assessments": [], "history_rows": []})
        return 1
    if not locations:
        print("⚠️ لا توجد مواقع نشطة في الجدول.")
        return 0
    try:
        config = fetch_config()
    except Exception as e:
        print(f"⚠️ فشل جلب العتبات ({e}) — مكمل بالقيم الافتراضية.")
        config = {}

    total = len(locations)
    ok_count = err_count = 0
    error_details = {}
    history_rows_to_ingest = []   # صفوف الأرشيف الحديث (best-effort) تُثبَّت في نفس التشغيل
    snapshots, statistics, frequencies, assessments = [], [], [], []

    for idx, loc in enumerate(locations, 1):
        lid = loc["id"]
        print(f"\n[{idx}/{total}] 📍 {loc.get('name_ar')} ({loc.get('latitude')},{loc.get('longitude')})")
        try:
            # — تحديث الأرشيف الحديث: أ، لا يمسّ المخزون ب، أي فشل = متابعة (نقطة «3») —
            try:
                start_d = run_date - timedelta(days=6)
                end_d = run_date - timedelta(days=1)
                recent = fetch_archive_recent(loc.get("latitude"), loc.get("longitude"), start_d, end_d)
                if recent:
                    history_rows_to_ingest.extend(recent)
                    source_meta["archive_refresh"][str(lid)] = f"OK {len(recent)} يومًا ({start_d}..{end_d})"
                else:
                    source_meta["archive_refresh"][str(lid)] = "empty"
            except Exception as e:
                # تابع بلا كسر: نستخدم أحدث ما هو مخزّن فعلًا (نقطة «3»)
                source_meta["archive_refresh"][str(lid)] = f"SKIP: {str(e)[:200]}"
                error_details[str(lid)] = error_details.get(str(lid), {})
                error_details[str(lid)]["archive_refresh"] = f"متخطى (فشل مؤقت): {str(e)[:200]}"
                recent = []

            # — التوقعات (مصدر خارجي) — أي فشل = تخطي الموقع بلا تقييم زائف —
            fc, raw = fetch_forecast(loc.get("latitude"), loc.get("longitude"), target_day)

            # — الخط المرجعي من DB (+ أيام الأرشيف الحديثة المكتملة) —
            try:
                hist_rows = fetch_history(lid, target_day, HISTORY_WINDOW_DAYS)
            except Exception as e:
                raise RuntimeError(f"فشل جلب التاريخ ({e})")
            stats = build_baseline(hist_rows, recent, target_day, HISTORY_WINDOW_DAYS)

            # — سلسلة القيم لكل متري (للتكرار) بأمان —
            series = {}
            for m in chain_metrics(stats):
                col = column_map[m]
                vals = []
                for h in hist_rows:
                    v = h.get(col)
                    if numeric(v) is not None:
                        vals.append(float(v))
                for h in recent:
                    v = h.get(col)
                    if numeric(v) is not None:
                        vals.append(float(v))
                series[m] = vals

            freq_records = build_frequencies(series, config, stats, target_day, HISTORY_WINDOW_DAYS)

            # — التصنيف الحتمي + المخاطر —
            anomalies = {}
            for m, st in stats.items():
                dir_ = METRIC_DEFS[m]["dir"]
                anomalies[m] = classify_anomaly(fc.get(m), st, direction=dir_, min_samples=MIN_SAMPLES)
            hazards = detect_hazards(fc, config)

            # — تقييم Claude (فشله = حفظ التقارير مع ai_status='error' بلا نص وهمي) —
            claude_input = build_claude_input(loc, fc, stats, freq_records, anomalies, hazards, target_day)
            ai_parsed, ai_raw, ai_error = call_claude_ai(claude_input)
            ai_status = "success" if (ai_parsed is not None and isinstance(ai_parsed, dict)) else "error"
            ai_text = json.dumps(ai_parsed, ensure_ascii=False, indent=2) if ai_status == "success" else ""

            fetched_at = datetime.now(TZ).strftime("%Y-%m-%d %H:%M:%S")
            snapshots.append({
                "location_id": lid, "target_date": str(target_day), "data_source": "open-meteo-forecast",
                "fetched_at": fetched_at, "raw_json": raw,
                "tmax": fc.get("tmax"), "tmin": fc.get("tmin"),
                "precip_mm": fc.get("precip"), "precip_prob_pct": fc.get("precip_prob_pct"),
                "wind_max_kph": fc.get("wind"), "wind_gusts_kph": fc.get("gusts"),
                "humidity_mean_pct": fc.get("humidity"), "cloud_cover_mean_pct": fc.get("cloud"),
                "weather_code": fc.get("weather_code"),
            })
            for m, st in stats.items():
                statistics.append({
                    "location_id": lid, "target_date": str(target_day), "metric": m,
                    "history_source": st.get("history_source"), "window_days": st.get("window_days"),
                    "methodology_version": st.get("methodology_version"),
                    "period_start": st.get("period_start"), "period_end": st.get("period_end"),
                    "sample_count": st.get("sample_count"), "mean": st.get("mean"),
                    "median": st.get("median"), "min": st.get("min"), "max": st.get("max"),
                    "p10": st.get("p10"), "p25": st.get("p25"), "p75": st.get("p75"),
                    "p90": st.get("p90"), "stddev": st.get("stddev"),
                })
            frequencies.extend(freq_records)
            assessments.append({
                "location_id": lid, "target_date": str(target_day),
                "anomalies": anomalies, "hazards": hazards,
                "ai_assessment": ai_text, "ai_assessment_json": ai_parsed,
                "ai_model": CLAUDE_MODEL, "ai_status": ai_status, "ai_error": (ai_error if ai_status == "error" else None),
            })
            ok_count += 1
            print(f"  ✓ التقييم {('عبر ' + CLAUDE_MODEL) if ai_status == 'success' else 'بدون AI (ai_status=error)'} · عينات التاريخ N={stats.get('tmax', {}).get('sample_count', '—')}")
            time.sleep(0.4)
        except Exception as e:
            err_count += 1
            error_details[str(lid)] = {"error": str(e)[:300]}
            print(f"  ✗ فشل الموقع: {e}")
            time.sleep(0.5)

    status = "success" if err_count == 0 else ("partial" if ok_count > 0 else "failed")
    payload = {
        "client_run_uuid": client_run_uuid,
        "run_date": str(run_date), "target_date": str(target_day),
        "status": status, "total_locations": total,
        "successful_locations": ok_count, "error_locations": err_count,
        "error_details": error_details, "source_meta": source_meta,
        "snapshots": snapshots, "statistics": statistics,
        "frequencies": frequencies, "assessments": assessments,
        "history_rows": history_rows_to_ingest,
    }
    send_ingest(payload)
    print(f"\n[{cairo_now_str()}] ✅ اكتمل: {ok_count}/{total} موقع ناجح ، حالة التشغيل: {status}")
    return 0 if status != "failed" else 1


def chain_metrics(stats):
    return [m for m in METRIC_DEFS if m in stats]


if __name__ == "__main__":
    sys.exit(run_pipeline())