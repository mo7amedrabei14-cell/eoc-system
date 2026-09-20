import os
import sys
import json
sys.path.insert(0, os.getcwd())

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Load environment variables
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
AI_MODEL = os.environ.get("AI_MODEL", "").strip()
GEMINI_MODEL_DEFAULT = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

# Determine which Gemini model to use
gemini_model_to_use = None
if GEMINI_API_KEY:
    try:
        import requests
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={GEMINI_API_KEY}"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            models = data.get("models", [])
            # Prefer a flash model, else any gemini model
            for m in models:
                mid = m.get("name", "")
                if mid.startswith("models/gemini-") and "flash" in mid:
                    gemini_model_to_use = mid.split("/")[-1]
                    break
            if not gemini_model_to_use:
                for m in models:
                    mid = m.get("name", "")
                    if mid.startswith("models/gemini-"):
                        gemini_model_to_use = mid.split("/")[-1]
                        break
        # If we didn't get a model, fallback to default or AI_MODEL
    except Exception:
        pass
if not gemini_model_to_use:
    if AI_MODEL:
        gemini_model_to_use = AI_MODEL
    elif GEMINI_MODEL_DEFAULT:
        gemini_model_to_use = GEMINI_MODEL_DEFAULT
    else:
        gemini_model_to_use = "gemini-pro"  # ultimate fallback

# Now set up provider selection as before, but we will force provider to gemini
# by setting AI_PROVIDER=gemini to avoid ambiguity.
# However, we want to test the automatic selection when GEMINI_API_KEY is set.
# We'll just set the environment variable AI_PROVIDER to empty and rely on GEMINI_API_KEY.
# We'll also clear AI_BASE_URL to avoid omniroute detection.
# We'll do this by overriding os.environ temporarily.
os.environ['AI_PROVIDER'] = ''
os.environ['AI_BASE_URL'] = ''
# Ensure GEMINI_API_KEY is already set (it is)
# We'll also set GEMINI_MODEL to our chosen model to influence the default.
os.environ['GEMINI_MODEL'] = gemini_model_to_use

# Now import weather_intel after setting env vars
import weather_intel

# Build a minimal structured input
dummy_input = {
    "metadata": {
        "target_date": "2026-09-18",
        "location": {"id": 1, "name_ar": "القاهرة", "name_en": "Cairo"},
        "coordinates": {"latitude": 30.0444, "longitude": 31.2357},
        "sources": {
            "forecast": "Open-Meteo Forecast API",
            "historical_baseline": "ERA5 reanalysis (Open-Meteo Archive)",
            "window_days": 3,
            "sample_note": "المقادير إحصائية مشتقة من مشاهدات صالحة فقط",
        },
    },
    "forecast": {
        "tmax": {"value": 35.0, "unit": "°C", "title_ar": "الحرارة العظمى"},
        "tmin": {"value": 20.0, "unit": "°C", "title_ar": "الحرارة الصغرى"},
        "precip": {"value": 0.0, "unit": "mm", "title_ar": "هطول الأمطار"},
        "wind": {"value": 10.0, "unit": "كم/س", "title_ar": "الرياح القصوى"},
        "humidity": {"value": 50.0, "unit": "%", "title_ar": "متوسط الرطوبة"},
    },
    "historical_baseline": {},
    "frequencies": [],
    "anomalies": {},
    "hazards": [],
}

# Call the AI function
try:
    parsed, raw_text, error_msg = weather_intel.call_ai(dummy_input)
    if error_msg:
        print(f"خطأ: {error_msg}")
        sys.exit(1)
    if parsed is None:
        print("فشل استخراج JSON من الاستجابة")
        sys.exit(1)
    # Check for the five required keys
    required_keys = [
        "weather_summary",
        "historical_comparison",
        "significant_anomalies",
        "operational_implications",
        "recommended_monitoring",
    ]
    missing = [k for k in required_keys if k not in parsed]
    if missing:
        print(f"مفاتيح مفقودة في الاستجابة: {missing}")
        sys.exit(1)
    print("نجح الاختبار: تم استلام استجابة صالحة تحتوي على جميع المفاتيح المطلوبة.")
    print(f"النموذج المستخدم: {weather_intel.SELECTED_AI_MODEL}")
    print(f"الموفر: {weather_intel.SELECTED_AI_PROVIDER}")
except Exception as e:
    print(f"حدث استثناء غير متوقع: {e}")
    sys.exit(1)
