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
# If not set, we cannot proceed
if not GEMINI_API_KEY:
    print("ERROR: GEMINI_API_KEY not set")
    sys.exit(1)

# Fetch available models from Gemini API to find a valid model
import requests
models_url = f"https://generativelanguage.googleapis.com/v1beta/models?key={GEMINI_API_KEY}"
try:
    resp = requests.get(models_url, timeout=10)
    if resp.status_code == 200:
        data = resp.json()
        models = data.get("models", [])
        # Prefer a flash model, else any gemini model
        selected_model = None
        for m in models:
            mid = m.get("name", "")
            if mid.startswith("models/gemini-") and "flash" in mid:
                selected_model = mid.split("/")[-1]
                break
        if not selected_model:
            for m in models:
                mid = m.get("name", "")
                if mid.startswith("models/gemini-"):
                    selected_model = mid.split("/")[-1]
                    break
        if selected_model is None:
            selected_model = "gemini-pro"  # fallback
    else:
        # If we cannot fetch models, fallback to default
        selected_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
except Exception as e:
    # If any error, fallback to default
    selected_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

# Override the model to use
os.environ['GEMINI_MODEL'] = selected_model
# Ensure we are not forcing other providers
os.environ['AI_PROVIDER'] = ''
os.environ['AI_BASE_URL'] = ''

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
EOF