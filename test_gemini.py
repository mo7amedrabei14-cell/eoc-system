import os
import sys
sys.path.insert(0, os.getcwd())

# Import the module to access its functions and globals
import weather_intel

# Ensure we are using Gemini provider by checking that AI_PROVIDER is not set and AI_BASE_URL not set
# (the module's logic will pick Gemini if GEMINI_API_KEY is set)
# We'll just call the call_ai function with a dummy input.

# Build a minimal structured input that matches what build_claude_input would produce.
# We only need enough to satisfy the JSON extraction; the actual content doesn't matter for the API call.
# We'll use a simple dict with a dummy forecast.
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
