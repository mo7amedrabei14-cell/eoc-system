import os
import sys
sys.path.insert(0, os.getcwd())

# Force Anthropic provider via environment (though call_ai uses SELECTED_* globals)
os.environ['AI_PROVIDER'] = 'anthropic'
os.environ['AI_BASE_URL'] = ''
os.environ['AI_API_KEY'] = ''
os.environ['GEMINI_API_KEY'] = ''  # ensure not interfering

# Import weather_intel after setting env
import weather_intel

# Manually set the selected provider globals (as run_pipeline would)
# Determine provider based on env (same logic as run_pipeline)
provider = None
model = None
max_tokens = None
api_key = None
base_url = None

if os.environ.get('AI_PROVIDER'):
    provider = os.environ['AI_PROVIDER'].strip().lower()
elif os.environ.get('AI_BASE_URL') and ("localhost" in os.environ['AI_BASE_URL'] or "127.0.0.1" in os.environ['AI_BASE_URL']):
    provider = "omniroute"
elif os.environ.get('GEMINI_API_KEY'):
    provider = "gemini"
else:
    provider = "anthropic"

if provider == "anthropic":
    model = weather_intel.CLAUDE_MODEL or "claude-sonnet-5"
    max_tokens = weather_intel.CLAUDE_MAX_TOKENS
    api_key = weather_intel.ANTHROPIC_API_KEY
    base_url = weather_intel.ANTHROPIC_MESSAGES_URL
elif provider == "omniroute":
    model = os.environ.get('AI_MODEL') or "claude-sonnet-5"  # default to same as Anthropic for compatibility
    max_tokens = int(os.environ.get('AI_MAX_TOKENS', "2000"))
    api_key = os.environ.get('AI_API_KEY', '')
    base_url = os.environ.get('AI_BASE_URL', '').rstrip("/")
elif provider == "gemini":
    model = os.environ.get('GEMINI_MODEL', "gemini-2.5-flash").strip()
    max_tokens = int(os.environ.get('AI_MAX_TOKENS', "2000"))
    api_key = os.environ.get('GEMINI_API_KEY', '')
    base_url = None
else:
    # Fallback to anthropic
    provider = "anthropic"
    model = weather_intel.CLAUDE_MODEL or "claude-sonnet-5"
    max_tokens = weather_intel.CLAUDE_MAX_TOKENS
    api_key = weather_intel.ANTHROPIC_API_KEY
    base_url = weather_intel.ANTHROPIC_MESSAGES_URL

# Set the globals in the weather_intel module
weather_intel.SELECTED_AI_PROVIDER = provider
weather_intel.SELECTED_AI_MODEL = model
weather_intel.SELECTED_AI_MAX_TOKENS = max_tokens
weather_intel.SELECTED_AI_API_KEY = api_key
weather_intel.SELECTED_AI_BASE_URL = base_url

# Build dummy input (same as before)
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

try:
    parsed, raw_text, error_msg = weather_intel.call_ai(dummy_input)
    if error_msg:
        print(f"خطأ: {error_msg}")
        sys.exit(1)
    if parsed is None:
        print("فشل استخراج JSON من الاستجابة")
        sys.exit(1)
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