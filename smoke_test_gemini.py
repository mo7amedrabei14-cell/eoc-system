import os
import sys
sys.path.insert(0, os.getcwd())

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Load environment variables (same as in weather_intel.py)
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
AI_PROVIDER = os.environ.get("AI_PROVIDER", "").strip().lower()
AI_BASE_URL = os.environ.get("AI_BASE_URL", "").strip()
AI_API_KEY = os.environ.get("AI_API_KEY", "").strip()
AI_MODEL = os.environ.get("AI_MODEL", "").strip()
AI_MAX_TOKENS = int(os.environ.get("AI_MAX_TOKENS", "2000"))
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

# Import constants from weather_intel.py
from weather_intel import (
    ANTHROPIC_MESSAGES_URL,
    ANTHROPIC_VERSION,
    CLAUDE_MODEL,
    CLAUDE_MAX_TOKENS,
    SYSTEM_PROMPT,
    extract_json,
)

# Replicate the provider selection logic from weather_intel.py run_pipeline
provider = None
model = None
max_tokens = None
api_key = None
base_url = None

if AI_PROVIDER:
    provider = AI_PROVIDER
elif AI_BASE_URL and ("localhost" in AI_BASE_URL or "127.0.0.1" in AI_BASE_URL):
    provider = "omniroute"
elif GEMINI_API_KEY:
    provider = "gemini"
else:
    provider = "anthropic"

# Set provider-specific values
if provider == "anthropic":
    model = CLAUDE_MODEL or "claude-sonnet-5"
    max_tokens = CLAUDE_MAX_TOKENS
    api_key = ANTHROPIC_API_KEY
    base_url = ANTHROPIC_MESSAGES_URL
elif provider == "omniroute":
    model = AI_MODEL or "claude-sonnet-5"  # default to same as Anthropic for compatibility
    max_tokens = AI_MAX_TOKENS
    api_key = AI_API_KEY
    base_url = AI_BASE_URL.rstrip("/")
elif provider == "gemini":
    model = GEMINI_MODEL
    max_tokens = AI_MAX_TOKENS
    api_key = GEMINI_API_KEY
    base_url = None  # URL constructed per request
else:
    # Fallback to anthropic
    provider = "anthropic"
    model = CLAUDE_MODEL or "claude-sonnet-5"
    max_tokens = CLAUDE_MAX_TOKENS
    api_key = ANTHROPIC_API_KEY
    base_url = ANTHROPIC_MESSAGES_URL

# Validate provider configuration (we'll skip actual validation for speed, but check for missing keys)
if provider == "anthropic":
    if not api_key:
        print(f"ERROR: ANTHROPIC_API_KEY missing")
        sys.exit(1)
elif provider == "gemini":
    if not api_key:
        print(f"ERROR: GEMINI_API_KEY missing")
        sys.exit(1)
elif provider == "omniroute":
    if not base_url:
        print(f"ERROR: AI_BASE_URL not set for OmniRoute.")
        sys.exit(1)
else:
    print(f"ERROR: Unknown AI provider: {provider}")
    sys.exit(1)

# Now set the globals in the weather_intel module
import weather_intel
weather_intel.SELECTED_AI_PROVIDER = provider
weather_intel.SELECTED_AI_MODEL = model
weather_intel.SELECTED_AI_MAX_TOKENS = max_tokens
weather_intel.SELECTED_AI_API_KEY = api_key
weather_intel.SELECTED_AI_BASE_URL = base_url

# Build a minimal structured input that mimics what build_claude_input would produce.
# We need to include enough to satisfy the JSON extraction; we'll use dummy values.
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
        print(f"AI_ERROR: {error_msg}")
        sys.exit(1)
    if parsed is None:
        print("ERROR: Failed to extract JSON from response")
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
        print(f"ERROR: Missing keys in response: {missing}")
        sys.exit(1)
    # Success
    print(f"SUCCESS: Model used={weather_intel.SELECTED_AI_MODEL}, Provider={weather_intel.SELECTED_AI_PROVIDER}")
    print(f"All five required keys present.")
    # Optionally, we could print a snippet of the response (without exposing key)
    # but we'll keep it minimal.
except Exception as e:
    print(f"EXCEPTION: {e}")
    sys.exit(1)