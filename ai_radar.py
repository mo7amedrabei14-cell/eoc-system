import feedparser
import requests
import json
import os
import time
import urllib.parse
import concurrent.futures
import sys
import random
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ==========================================
# 1. System Config & Keys
# ==========================================
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN")
SYSTEM_API_URL = "https://eoc-system-qaol.vercel.app/api/ai-news"

# ==========================================
# Quota & Model Chain — كل النماذج هنا مجانية (Free Tier فقط)
# ==========================================
# 🧠 سبب «فشل التحليل» قبل الإصلاح (مُثبَت بالتجربة على المفتاح):
#    نماذج Gemini 3.x تستهلك رموز «التفكير» (thinking) من نفس ميزانية
#    maxOutputTokens، فكان الرد يرجع finishReason=MAX_TOKENS بنصٍّ فارغ ⇒ JSON غير
#    صالح ⇒ news_type = «غير مصنف (فشل التحليل)». كذلك انتهت حصة الحساب المجانية
#    لنماذج بعينها (429) فكان الرادار يتوقف تماماً عن التحليل.
#    الحل ثلاثي: (1) تعطيل التفكير: thinkingBudget=0 أو thinkingLevel=low حسب ما
#    يقبله كل نموذج. (2) responseMimeType=application/json. (3) سلسلة نماذج مجانية
#    بديلة عند 429/404/503 + تحليل احتياطي محلي مضمون آخر الطريق.
GEMINI_DAILY_LIMIT = int(os.environ.get("GEMINI_DAILY_LIMIT", "60") or 60)
GEMINI_CALLS_PER_MODEL_CAP = int(os.environ.get("GEMINI_CALLS_PER_MODEL_CAP", "20") or 20)
# ⏱️ نافذة الرصد: الكرون كل ساعتين ⇒ نافذة 1 ساعة كانت تفقد ما نُشر بين الجولات.
#    3 ساعات (قابلة للضبط) تغلق الفجوة مع تكرار الجولات، والتكرار محمي بالروابط.
RADAR_MAX_AGE_HOURS = int(os.environ.get("RADAR_MAX_AGE_HOURS", "3") or 3)
gemini_calls_today = 0
gemini_calls_by_model = {}

# 🔤 تُجرَّب بالترتيب — كلها على الطبقة المجانية (Google AI Studio Free Tier).
#    GEMINI_MODEL من البيئة يتقدّم لو موجود، والباقي بدائل مجانية مجرَّبة فعلياً.
MODEL_CHAIN = [
    os.environ.get("GEMINI_MODEL", "").strip(),
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
]
GEMINI_MODELS = [m for i, m in enumerate(MODEL_CHAIN) if m and m not in MODEL_CHAIN[:i]]
dead_models = set()       # 404: النموذج غير متاح لهذا المفتاح
quota_exhausted_models = set()  # 429: استُهلكت حصته المجانية
# 🛡️ حماية من عاصفة استدعاءات: لو فشل نموذج مرتين متتاليتين (صيغة/رد غير صالح) نتوقف
#    عن تجربته في *باقي الجولة* بدل إعادة محاولته مع كل دفعة (كان يضاعف الاستدعاءات
#    بلا داعٍ في جولات الإصلاح الكبيرة).
degraded_models = set()
model_failures = {}

# صيغ generationConfig: الأولى تعطّل التفكير (أسرع وأرخص وتُرجع JSON كامل)،
# والنموذج الذي يرفضها (400) نجرّب معه التي تليها ثم الافتراضية.
GEN_CONFIG_VARIANTS = (
    {"thinkingBudget": 0},
    {"thinkingLevel": "low"},
    None,
)

BATCH_SIZE = 4  # articles per Gemini API call

KEYWORDS = [
    'تصادم', 'انقلاب', 'خروج قطار', 'اصطدام', 'حوادث طرق', 'ميكروباص', 'سيارة نقل',
    'مقطورة', 'حادث مروع', 'دهس', 'حريق', 'حرائق', 'اشتعال', 'نيران', 'تفحم',
    'ماس كهربائي', 'انفجار', 'تسرب غاز', 'تسرب كيميائي', 'انهيار', 'سقوط مبنى',
    'تصدع', 'ميل عقار', 'هبوط أرضي', 'سيول', 'فيضانات', 'زلزال', 'هزة أرضية',
    'مصرع', 'وفاة', 'إصابة', 'حالات حرجة', 'اختناق', 'تسمم', 'انتشال', 'جثة',
    'طوارئ', 'إنقاذ', 'إسعاف', 'كارثة', 'حماية مدنية', 'كردون أمني', 'السيطرة على'
]

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"
]

# Egyptian governorate keyword mapping for fallback classification
GOVERNORATE_KEYWORDS = {
    "القاهرة": ["القاهرة", "مصر القديمة", "حلوان", "شبرا", "المرج", "التابية", "عين شمس", "مدينة نصر", "التجمع", "مصر الجديدة", "الزمالك", "الدقى", "العجوزة", "ال beamsite", "دار السلام", "المعادي", "الuochem", "بدر", "الشروق", "15 مايو", "الوفاء والأمل"],
    "الجيزة": ["الجيزة", "الهرم", "أكتوبر", "6 أكتوبر", "السادس", "الOSTAZ", "العياط", "البدرشين", "أوسيم", "كرداسة", "الصف", "المメディنه الجديده"],
    "القليوبية": ["القليوبية", "بنها", "شبرا الخيمة", "القناطر", "الخانكة", "كفر الدوار", " طهطا"],
    "الفيوم": ["الفيوم", "سنورس", "طامية", "إبشواي", "الصعيد"],
    "المنيا": ["المنيا", "ملوي", "سمالوط", "دير مواس", "أبوقرقاص", "بني مزار", "مغاغة", "العدوة"],
    "أسيوط": ["أسيوط", "ال推动", "القوصية", "أبو تيج", "الغنايم", "ساحل سليم", "المحϻ"],
    "سوهاج": ["سوهاج", "جراجة", "العمايرة", "البلينا", "المنشاة", "طما", "دار السلاamburger", "ساقلتة", "طهطا"],
    "قنا": ["قنا", "دشنا", "الوقف", "نقادة", "فرشوط", "أبو تشت", "القوصية", "الأقصر"],
    "الأقصر": ["الأقصر", "البرنوصي", "الق blvd", "الفرنة", "الbyss"],
    "الاقصر": ["الاقصر", "الاقصر"],
    "اسوان": ["اسوان", "دراو", "كوم امبو", "نصر النوبة", "أبوسمبل", "إدفو", "ال-svg"],
    "البحر الأحمر": ["البحر الأحمر", "الغردقة", "مرسى علم", "الجونة", "الסיןاء", " święt"],
    "البحيرة": ["البحيرة", "المنصورة", "دمنهور", "كفر الدوار", "رشيد", "حوش عيسى", "إدكو", "النوبارية"],
    "الدقهلية": ["الدقهلية", "المنصورة", "طلخا", "ميت غمر", "دكرنس", "السنبلاوين", "المنزلة", "بلقاس"],
    "دمياط": ["دمياط", "دمياط الجديدة", "فارسكور", "كفر سعد", "الروضة", "السReward"],
    "الشرقية": ["الشرقية", "الزقازيق", "أبو حماد", "العاشر من رمضان", "بلبيس", "منيا القمح", "ههيا", "القناطر"],
    "كفر الشيخ": ["كفر الشيخ", "دسوق", "سيدي سالم", "الحامول", "بيلا", "مطوبس", "الرياض"],
    "غربية": ["غربية", "طنطا", "المحلة الكبرى", "السCLS", "كفر الزيات", "زفتى", "السنطة", "بلاط"],
    "المنوفية": ["المنوفية", "شبين الكوم", "منوف", "سادات", "ال_graph", "تلا", "الشهداء"],
    "الفيوم": ["الفيوم", "سنورس", "طامية", "أبشواي", "fdnj"],
    "بني سويف": ["بني سويف", "الواحات", "ناصر", "إهناسيا", "ببا", "سمسطا"],
    "الborder": ["الجبل الأحمر", "عابدين", "الظاهر", "الdetail", "الleitung"],
}

def guess_governorate(text):
    """Extract governorate from text using keyword matching."""
    if not text:
        return "-"
    for gov, keywords in GOVERNORATE_KEYWORDS.items():
        if any(k in text for k in keywords):
            return gov
    return "-"

# ==========================================
# 2. RSS Feed Network
# ==========================================
search_query = 'حريق OR حادث OR عاجل OR مصرع OR انفجار OR انهيار'
encoded_query = urllib.parse.quote(f"{search_query} when:{RADAR_MAX_AGE_HOURS}h")
GOOGLE_NEWS_EGYPT = f"https://news.google.com/rss/search?q={encoded_query}&hl=ar&gl=EG&ceid=EG:ar"

RSS_FEEDS = {
    "رادار جوجل اللحظي": GOOGLE_NEWS_EGYPT,
    "صدى البلد (عاجل)": "https://www.elbalad.news/rss/1",
    "صدى البلد (حوادث)": "https://www.elbalad.news/rss/3",
    "اليوم السابع (عاجل)": "https://www.youm7.com/rss/SectionRss?SectionID=65",
    "اليوم السابع (حوادث)": "https://www.youm7.com/rss/SectionRss?SectionID=203",
    "المصري اليوم (عاجل)": "https://www.almasryalyoum.com/rss/section/1",
    "المصري اليوم (حوادث)": "https://www.almasryalyoum.com/rss/section/13",
    "الشروق (عاجل)": "https://www.shorouknews.com/rss/urgent.xml",
    "الشروق (حوادث)": "https://www.shorouknews.com/rss/accidents.xml",
    "فيتو (عاجل)": "https://www.vetogate.com/rss/1",
    "فيتو (حوادث)": "https://www.vetogate.com/rss/2",
    "الدستور (عاجل)": "https://www.dostor.org/rss/section/1",
    "الدستور (حوادث)": "https://www.dostor.org/rss/section/5",
    "البوابة نيوز": "https://www.albawabhnews.com/rss/97",
    "الأسبوع (عاجل)": "https://www.elaosboa.com/rss/1/",
    "الأسبوع (حوادث)": "https://www.elaosboa.com/rss/accidents/",
    "القاهرة 24 (الرئيسية)": "https://www.cairo24.com/rss",
    "الوطن (الرئيسية)": "https://www.elwatannews.com/home/rss",
    "مصراوي (الرئيسية)": "https://www.masrawy.com/CrossDomain/News/RSS",
    "سكاي نيوز (مصر)": "https://www.skynewsarabia.com/rss/مصر",
    "روسيا اليوم (مصر)": "https://arabic.rt.com/rss/egypt/",
    "العربية (مصر)": "https://www.alarabiya.net/egypt.rss"
}

# Load already-processed links to avoid duplicates
processed_news_links = set()
try:
    if SYSTEM_TOKEN:
        headers = {"Authorization": f"Bearer {SYSTEM_TOKEN}"}
        res = requests.get(SYSTEM_API_URL, headers=headers, timeout=10)
        if res.ok:
            for news in res.json():
                if news.get("news_link"):
                    processed_news_links.add(news.get("news_link"))
except Exception:
    pass

# ==========================================
# 3. Article Scraper
# ==========================================
def scrape_full_article(url):
    try:
        headers = {'User-Agent': random.choice(USER_AGENTS)}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')

        og_image = soup.find('meta', property='og:image')
        image_url = og_image['content'] if og_image else "لا توجد صورة"

        paragraphs = soup.find_all('p')
        article_text = " ".join([p.get_text() for p in paragraphs])

        return article_text[:3500] if len(article_text) > 3500 else article_text, image_url
    except Exception:
        return "", "لا توجد صورة"

# ==========================================
# 4. Gemini AI — Batch Analysis Engine
#    + محرّك تحليل احتياطي محلي مضمون (لا خبر بلا تحليل إطلاقاً)
# ==========================================
def can_call_gemini():
    """هل ما زالت ميزانية استدعاءات التحليل متاحة؟"""
    return gemini_calls_today < GEMINI_DAILY_LIMIT


def _parse_ai_json(ai_text):
    """يحوّل رد النموذج إلى list[dict]، أو None لو النص فارغ/مقطوع/غير JSON."""
    if not ai_text:
        return None
    clean_text = ai_text.strip()
    if clean_text.startswith('```'):
        clean_text = clean_text.split('\n', 1)[1] if '\n' in clean_text else clean_text[3:]
    if clean_text.endswith('```'):
        clean_text = clean_text[:-3]
    clean_text = clean_text.strip()
    try:
        results = json.loads(clean_text)
    except json.JSONDecodeError:
        start, end = clean_text.find('['), clean_text.rfind(']')
        if start == -1 or end <= start:
            return None
        try:
            results = json.loads(clean_text[start:end + 1])
        except json.JSONDecodeError:
            return None
    if isinstance(results, dict):
        results = [results]
    if not isinstance(results, list):
        return None
    return [item for item in results if isinstance(item, dict)]


def _call_gemini_model(model, prompt):
    """يجرّب نموذجاً مجانياً واحداً بثلاث صيغ (بلا تفكير ← تفكير منخفض ← الافتراضية).
    يرجع: ("ok", list[dict]) | ("next", سبب) للنموذج التالي | ("fail", سبب)."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
    headers = {'Content-Type': 'application/json'}
    note = "رد غير صالح"
    for gen_variant in GEN_CONFIG_VARIANTS:
        generation_config = {
            "temperature": 0.2,
            "maxOutputTokens": 8192,
            "responseMimeType": "application/json",
        }
        if gen_variant is not None:
            generation_config["thinkingConfig"] = dict(gen_variant)
        payload = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": generation_config}
        for attempt in range(2):
            try:
                response = requests.post(url, headers=headers, json=payload, timeout=90)
            except Exception as e:
                note = f"شبكة: {e}"
                time.sleep(2)
                continue

            code = response.status_code
            if code == 200:
                try:
                    data = response.json()
                except Exception:
                    note = "رد غير JSON"
                    continue
                candidate = (data.get('candidates') or [{}])[0]
                finish = str(candidate.get('finishReason') or '')
                ai_text = "".join(
                    part.get('text') or ''
                    for part in ((candidate.get('content') or {}).get('parts') or [])
                )
                parsed = _parse_ai_json(ai_text)
                if parsed is not None:
                    return "ok", parsed
                note = f"رد غير صالح (finish={finish or '?'} طول={len(ai_text)})"
                break  # هذه الصيغة غير نافعة ⇒ جرّب صيغة التفكير التالية
            if code in (400, 422):
                note = f"صيغة الطلب مرفوضة ({code})"
                break  # نفس النموذج بصيغة تفكير أخرى
            if code == 404:
                dead_models.add(model)
                return "next", "404 (النموذج غير متاح لهذا المفتاح)"
            if code == 429:
                quota_exhausted_models.add(model)
                return "next", "429 (انتهت الحصة المجانية لهذا النموذج)"
            if code in (500, 502, 503, 504):
                note = f"{code} (النموذج مزدحم)"
                time.sleep(3)
                continue
            note = f"{code}: {response.text[:150]}"
            time.sleep(2)
    print(f"   ⚠️ {model}: {note}")
    return "fail", note


# ── تحليل احتياطي محلي مضمون: لا يحتاج أي API ولا حصة، فيستحيل أن يبقى خبر بلا تحليل ──
GOV_CENTROIDS = {
    "القاهرة": (30.0444, 31.2357), "الجيزة": (30.0131, 31.2089), "القليوبية": (30.4659, 31.1841),
    "الفيوم": (29.3084, 30.8428), "المنيا": (28.1099, 30.7503), "أسيوط": (27.1809, 31.1837),
    "سوهاج": (26.5591, 31.6957), "قنا": (26.1550, 32.7164), "الأقصر": (25.6872, 32.6396),
    "الاقصر": (25.6872, 32.6396), "اسوان": (24.0889, 32.8998), "البحر الأحمر": (27.2579, 33.8116),
    "البحيرة": (30.8481, 30.3436), "الدقهلية": (31.0409, 31.3785), "دمياط": (31.4165, 31.8133),
    "الشرقية": (30.5877, 31.5020), "كفر الشيخ": (31.1117, 30.9398), "غربية": (30.7865, 31.0004),
    "المنوفية": (30.5972, 30.9876), "بني سويف": (29.0661, 31.0994), "الإسكندرية": (31.2001, 29.9187),
    "بورسعيد": (31.2653, 32.3019), "السويس": (29.9668, 32.5498), "الإسماعيلية": (30.5965, 32.2715),
    "شمال سيناء": (31.1312, 33.7984), "جنوب سيناء": (28.5399, 33.9750), "مطروح": (31.3543, 27.2373),
    "الوادي الجديد": (25.4514, 30.5464), "المنصورة": (31.0409, 31.3785),
}

TYPE_KEYWORDS = [
    (("تصادم قطار", "خروج قطار", "قطار", "سكة حديد"), "حادث سكة حديد"),
    (("تصادم", "اصطدام", "انقلاب", "دهس", "ميكروباص", "سيارة نقل", "مقطورة", "حادث مروري"), "حادث مروري"),
    (("حريق", "حرائق", "اشتعال", "نيران", "تفحم", "ماس كهربائي"), "حريق"),
    (("انهيار", "سقوط مبنى", "سقوط عقار", "تصدع", "ميل عقار"), "انهيار مبنى"),
    (("هبوط أرضي", "هبوط ارضي"), "هبوط أرضي"),
    (("سيول", "فيضان", "فيضانات", "أمطار غزيرة", "امطار غزيرة"), "سيول وفيضانات"),
    (("تسرب غاز", "انفجار غاز"), "تسرب غاز"),
    (("تسرب كيميائي", "تسرب مواد"), "تسرب كيميائي"),
    (("انفجار", "عبوة ناسفة", "قنبلة"), "انفجار"),
    (("زلزال", "هزة أرضية", "هزه ارضيه"), "زلزال"),
    (("غرق", "غرقى", "الغرق"), "غرق"),
    (("تسمم", "تسمم غذائي"), "تسمم"),
    (("اختناق",), "اختناق"),
    (("اشتباكات", "إطلاق نار", "اطلاق نار"), "أحداث أمنية"),
]

TYPE_PLAYBOOK = {
    "حريق": "دفع سيارات إطفاء وتأمين كردون حول الموقع، إخلاء العقارات المجاورة، التنسيق مع الحماية المدنية لمنع امتداد النيران.",
    "حادث مروري": "تأمين موقع الحادث وتحويل المرور لمسار بديل، دفع أوناش لرفع المركبات، وتجهيز الإسعاف للحالات الحرجة.",
    "حادث سكة حديد": "إخطار هيئة السكة الحديد وإيقاف الحركة على الخط، إخلاء الرصيف، ودفع فرق إنقاذ وإسعاف للسكة.",
    "انهيار مبنى": "تشكيل فرق بحث وإنقاذ مدعومة بكلاب ومساعدات صوتية، تأمين المباني المجاورة، ورفع الأنقاض بحذر.",
    "هبوط أرضي": "إخلاء المباني المتأثرة وتأمين نطاق آمن، دراسة استقرار التربة، ومنع مرور المركبات الثقيلة.",
    "سيول وفيضانات": "تشغيل طلمبات شفط المياه، إخلاء المناطق المنخفضة، وتأمين محولات الكهرباء والطرق السريعة.",
    "تسرب غاز": "قطع مصدر التسرب وتهوية المكان، إخلاء دائرة 200 متر، ومنع كل مصادر الاشتعال قبل المعالجة.",
    "تسرب كيميائي": "تحديد نوع المادة وتأمين منطقة عازلة، دفع فرق مواد خطرة بمهمات وقاية كاملة، والتنسيق مع البيئة والصحة.",
    "انفجار": "تأمين محيط الانفجار ومسح وجود عبوات ثانية، دفع فرق إسعاف، وتقييم استقرار المباني المتضررة.",
    "زلزال": "جرد المباني المتضررة وتصنيفها، فتح مراكز إيواء، وتجهيز فرق إنقاذ على مستوى المحافظات المجاورة.",
    "غرق": "دفع فرق إنقاذ بحري وغطاسين، إخلاء الشاطئ، وتنسيق مع الإسعاف لحالات الغرق الحرجة.",
    "تسمم": "سحب العينات وتحديد المصدر، دفع محاليل ومستلزمات مستشفيات، وتوعية المواطنين بتجنب المصدر.",
    "اختناق": "تهوية المكان وإخراج المتواجدين، دفع أسطوانات أكسجين، وفحص مصدر الغازات.",
    "أحداث أمنية": "تأمين محيط الأحداث بالتنسيق مع الأمن، دفع إسعاف ميداني، ومسار آمن لخروج المصابين.",
}

FIELD_PLAYBOOK_DEFAULT = "تأمين موقع الحادث وكردون أمني، دفع الإسعاف والإنقاذ لتقييم الخسائر ميدانياً، وتحديث الغرفة بالأرقام المؤكدة أولاً بأول."


def _to_int(value):
    """يحوّل أرقاماً عربية/لاتينية إلى int، ويرجع 0 لو غير صالح."""
    if value is None:
        return 0
    text = str(value).translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789'))
    digits = ''.join(ch for ch in text if ch.isdigit())
    if not digits:
        return 0
    try:
        return int(digits[:6])
    except ValueError:
        return 0


def _extract_counts(text):
    """يستخرج (وفيات، إصابات) من نص الخبر بعبارات عربية مباشرة — بلا ذكاء اصطناعي."""
    import re as _re

    def _max_of(words):
        best = 0
        for word in words:
            for pattern in (rf"(\d+)\s*[^\d]{{0,12}}{word}", rf"{word}[^\d]{{0,20}}(\d+)"):
                for match in _re.findall(pattern, text):
                    best = max(best, _to_int(match))
        return best

    deaths = _max_of(("مصرع", "قتيل", "قتلى", "وفاة", "وفيات", "متوفى", "متوفين", "جثة", "جثث", "مصرعه", "مصرعها"))
    injured = _max_of(("إصابة", "اصابة", "إصابات", "مصاب", "مصابين", "جرحى", "جريح", "حالات حرجة"))
    return deaths, injured


def fallback_analysis(article, reason=""):
    """تحليل آلي محلي مضمون لأي خبر — يشتغل حتى لو كل النماذج المجانية وقعت أو انتهت
    حصتها، فلا يبقى خبر واحد في «غير مصنف (فشل التحليل)»."""
    import re as _re

    title = (article.get('title') or '').strip()
    body = (article.get('text') or '').strip()
    text = f"{title} {body}".strip()

    news_type = "بلاغ حادث (تحليل آلي)"
    for keywords, label in TYPE_KEYWORDS:
        if any(word in text for word in keywords):
            news_type = label
            break

    deaths, injured = _extract_counts(text)
    severity = 3
    if injured:
        severity = 6 if injured < 5 else 7
    if deaths:
        severity = 8 if deaths < 5 else 9
    if deaths >= 10:
        severity = 10

    governorate = guess_governorate(text)
    latitude, longitude = GOV_CENTROIDS.get(governorate, (None, None))

    hospital = ""
    hospital_match = _re.search(r"مستشفى\s+([^\s،,.\n]{2,20})", text)
    if hospital_match:
        hospital = hospital_match.group(1).strip()
    street = ""
    street_match = _re.search(r"(?:شارع|طريق)\s+([^\s،,.\n]{2,25})", text)
    if street_match:
        street = street_match.group(1).strip()
    area = ""
    area_match = _re.search(r"(?:منطقة|حي|قرية|مركز|مدينة)\s+([^\s،,.\n]{2,20})", text)
    if area_match:
        area = area_match.group(1).strip()

    summary_source = (body or title)[:400]
    description = f"{title}" if not summary_source or summary_source == title else f"{title} — {summary_source}"[:500]

    return {
        "title": title,
        "incident_description": description or title or "بلاغ بلا نص (تحليل آلي)",
        "news_type": news_type,
        "governorate": governorate,
        "area_name": area,
        "street_name": street,
        "hospital_name": hospital,
        "injured_count": injured,
        "deaths_count": deaths,
        "severity_score": severity,
        "latitude": latitude,
        "longitude": longitude,
        "tactical_recommendations": TYPE_PLAYBOOK.get(news_type, FIELD_PLAYBOOK_DEFAULT),
        "analysis_source": "heuristic",
        "analysis_note": reason or "تحليل آلي احتياطي (كل النماذج المجانية غير متاحة)",
    }

def analyze_batch_with_ai(articles_batch):
    """
    Send a batch of articles (up to BATCH_SIZE) in a single Gemini API call.
    Returns a list of parsed dicts, one per article.
    """
    global gemini_calls_today

    if not GEMINI_API_KEY:
        print("⚠️ GEMINI_API_KEY غير موجود — سيُستخدم التحليل الاحتياطي المحلي")
        return [fallback_analysis(a, "مفتاح التحليل غير مُعد") for a in articles_batch]

    if not can_call_gemini():
        print(f"⚠️ استُهلكت ميزانية التحليل ({gemini_calls_today}/{GEMINI_DAILY_LIMIT}) — تحليل احتياطي محلي مضمون")
        return [fallback_analysis(a) for a in articles_batch]

    articles_for_prompt = []
    for a in articles_batch:
        articles_for_prompt.append({
            "title": a["title"],
            "text": a["text"][:800]  # Trim per-article to keep batch prompt manageable
        })

    prompt = f"""
أنت خبير أمني ومدير استراتيجيات في غرفة عمليات طوارئ (EOC) متقدمة.
قم بتحليل هذه المجموعة من الأخبار ({len(articles_batch)} أخبار) واستخرج البيانات التالية لكل خبر.

أعد النتيجة كـ JSON array فقط، بدون أي نص إضافية أو ```:
[
  {{
    "title": "العنوان الأصلي",
    "incident_description": "ملخص تكتيكي للحادث يبرز حجم الخسائر والتهديدات",
    "news_type": "تصنيف الحادث",
    "governorate": "المحافظة المصرية لو الحادث داخل مصر (مثل: القاهرة/أسيوط)، وإلا اكتب اسم الدولة بالعربية (مثل: تركيا/فرنسا/الولايات المتحدة الأمريكية)",
    "area_name": "المنطقة",
    "street_name": "الشارع",
    "hospital_name": "المستشفى",
    "injured_count": 0,
    "deaths_count": 0,
    "severity_score": 5,
    "latitude": 30.0444,
    "longitude": 31.2357,
    "tactical_recommendations": "3 توصيات ميدانية سريعة"
  }}
]

الأخبار:
{json.dumps(articles_for_prompt, ensure_ascii=False, indent=2)}
"""

    live_models = [
        m for m in GEMINI_MODELS
        if m not in dead_models and m not in quota_exhausted_models and m not in degraded_models
    ]
    parsed_results = None
    note = ""
    for model in live_models:
        kind, payload_result = _call_gemini_model(model, prompt)
        if kind == "ok":
            gemini_calls_today += 1
            gemini_calls_by_model[model] = gemini_calls_by_model.get(model, 0) + 1
            if gemini_calls_by_model[model] >= GEMINI_CALLS_PER_MODEL_CAP:
                quota_exhausted_models.add(model)
            parsed_results = payload_result
            model_failures.pop(model, None)
            print(f"✅ تحليل ناجح عبر {model}: {len(articles_batch)} أخبار (استدعاء {gemini_calls_today}/{GEMINI_DAILY_LIMIT})")
            break
        note = payload_result
        model_failures[model] = model_failures.get(model, 0) + 1
        if model_failures[model] >= 2:
            degraded_models.add(model)
            debug_suffix = " — لن يُعاد تجربته في هذه الجولة"
        else:
            debug_suffix = ""
        if kind == "next":
            print(f"↩️ تخطّي {model}: {note}{debug_suffix}")
        elif debug_suffix:
            print(f"↩️ تخفيض {model} بعد فشل متكرر{debug_suffix}")

    if parsed_results is None:
        # كل النماذج المجانية وقعت/انتهت حصتها ⇒ قسّم الدفعة (خبر واحد = أعلى فرصة نجاح)
        if live_models and len(articles_batch) > 1:
            mid = len(articles_batch) // 2
            print(f"↔️ تقسيم الدفعة ({mid} + {len(articles_batch) - mid}) لإعادة المحاولة")
            return (analyze_batch_with_ai(articles_batch[:mid])
                    + analyze_batch_with_ai(articles_batch[mid:]))
        print("🧯 تحليل احتياطي محلي مضمون — لا يُترك أي خبر بلا تحليل")
        return [fallback_analysis(a) for a in articles_batch]

    # 🛡️ ضمان أخير: dict كامل لكل خبر (لو رجّع النموذج أقل من العدد ⇒ استكمال بالتحليل الاحتياطي)
    results = []
    for idx, article in enumerate(articles_batch):
        item = parsed_results[idx] if idx < len(parsed_results) else None
        results.append(item if isinstance(item, dict) and item else fallback_analysis(article, "عنصر ناقص في رد النموذج"))
    return results

# ==========================================
# 5. Single Source Scanner (RSS + Scrape)
# ==========================================
def scan_single_source(publisher, url, now_utc):
    """Scan one RSS feed, collect matching articles. Returns list of article dicts."""
    matched = []
    try:
        headers = {'User-Agent': random.choice(USER_AGENTS)}
        resp = requests.get(url, headers=headers, timeout=10)
        feed = feedparser.parse(resp.content)

        for entry in feed.entries[:15]:
            try:
                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    pub_date = datetime.fromtimestamp(time.mktime(entry.published_parsed))
                    if now_utc - pub_date > timedelta(hours=RADAR_MAX_AGE_HOURS):
                        continue
            except Exception:
                pass

            news_link = entry.link
            if news_link in processed_news_links:
                continue

            # 🔎 المطابقة على العنوان أو الملخص (عناوين كثيرة بلا كلمة مفتاحية نصية)
            haystack = f"{entry.title} {entry.get('summary', '')}"
            if any(k in haystack for k in KEYWORDS):
                print(f"🚨 [{publisher}] رصد: {entry.title}")
                full_article_text, image_url = scrape_full_article(news_link)
                combined_text = full_article_text if len(full_article_text) > 50 else entry.get('summary', '')

                matched.append({
                    "title": entry.title,
                    "text": combined_text,
                    "link": news_link,
                    "publisher": publisher,
                    "image_url": image_url
                })
                processed_news_links.add(news_link)
    except Exception:
        pass

    return matched

# ==========================================
# 6. Send Report to API
# ==========================================
# 📊 عدّادات الجولة — تُطبع في نهاية التشغيل لتشخيص أي فشل إرسال فوراً من لوج GitHub
send_stats = {"ok": 0, "dup": 0, "fail": 0, "auth_fail": 0}


def _build_tactical_report(article, ai_data):
    """نص التقرير التكتيكي المعروض في الواجهة (خطورة + إحداثيات + توصيات + مصدر التحليل + صورة)."""
    severity = ai_data.get("severity_score", "?")
    tactical = ai_data.get("tactical_recommendations") or "لا توجد توصيات واضحة."
    lat = ai_data.get("latitude") if ai_data.get("latitude") is not None else "غير متوفر"
    lng = ai_data.get("longitude") if ai_data.get("longitude") is not None else "غير متوفر"
    source_label = (
        "تحليل آلي احتياطي (بلا ذكاء اصطناعي)"
        if str(ai_data.get("analysis_source") or "").lower() == "heuristic"
        else "ذكاء اصطناعي (Gemini)"
    )
    return (
        f"🔥 [مستوى الخطورة]: {severity}/10\n"
        f"📍 [إحداثيات الموقع]: {lat}, {lng}\n"
        f"💡 [توصيات تكتيكية للغرفة]: {tactical}\n"
        f"🧠 [مصدر التحليل]: {source_label}\n"
        f"📸 [صورة الحادثة]: {article.get('image_url', 'لا توجد صورة')}"
    )


def send_report(article, ai_data):
    """Send a single article report to the EOC API — التحليل هنا مضمون (AI أو احتياطي محلي)."""
    if not isinstance(ai_data, dict) or not ai_data:
        ai_data = fallback_analysis(article, "رد فارغ من محرّك التحليل")
    if ai_data:
        severity = ai_data.get("severity_score", "?")
        tactical = ai_data.get("tactical_recommendations", "لا توجد توصيات واضحة.")
        lat = ai_data.get("latitude", "غير متوفر")
        lng = ai_data.get("longitude", "غير متوفر")
        description = ai_data.get("incident_description", article["title"])
        news_type = ai_data.get("news_type", "أخرى / غير مصنف")
        gov = ai_data.get("governorate", guess_governorate(article["text"]))
        area = ai_data.get("area_name", "")
        street = ai_data.get("street_name", "")
        hospital = ai_data.get("hospital_name", "")
        injured = str(ai_data.get("injured_count", "0"))
        deaths = str(ai_data.get("deaths_count", "0"))
    else:
        # ⚠️ فرع احترازي غير قابل للوصول بعد الإصلاح (التحليل الاحتياطي فوق يضمن dict دائماً) —
        #    وكان هو مصدر نص «فشل التحليل / تعذر التحليل» اللي كان يظهر لكل خبر.
        _fb = fallback_analysis(article, "فرع احترازي")
        gov = _fb["governorate"]
        severity = _fb["severity_score"]
        tactical = _fb["tactical_recommendations"]
        lat = _fb["latitude"] if _fb["latitude"] is not None else "غير متوفر"
        lng = _fb["longitude"] if _fb["longitude"] is not None else "غير متوفر"
        description = _fb["incident_description"]
        news_type = _fb["news_type"]
        area = _fb["area_name"]
        street = _fb["street_name"]
        hospital = _fb["hospital_name"]
        injured = str(_fb["injured_count"])
        deaths = str(_fb["deaths_count"])

    tactical_report = _build_tactical_report(article, ai_data)

    payload = {
        "incident_date": datetime.now().strftime("%Y-%m-%d"),
        "incident_description": description,
        "news_type": news_type,
        "news_publisher": article["publisher"],
        "street_name": street,
        "area_name": area,
        "governorate": gov,
        "hospital_name": hospital,
        "injured_count": injured,
        "deaths_count": deaths,
        "news_updates": tactical_report,
        "news_link": article["link"],
        "data_entry_name": "OSINT  AI"
    }

    try:
        headers_api = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
        res = requests.post(SYSTEM_API_URL, json=payload, headers=headers_api, timeout=15)
        if res.status_code in [200, 201]:
            send_stats["ok"] += 1
            print(f"  ✅ إرسال ناجح: {article['title'][:60]}")
        elif "duplicate key" in (res.text or ""):
            # 🛡️ لو السيرفر القديم رفض التكرار 500 — الخبر أصلاً محفوظ ⇒ يُعدّ نجاحاً
            send_stats["dup"] += 1
            print(f"  ✅ الخبر محفوظ مسبقاً (تكرار رابط): {article['title'][:60]}")
        elif res.status_code in (401, 403):
            send_stats["auth_fail"] += 1
            send_stats["fail"] += 1
            print(f"  🛑 SYSTEM_TOKEN مرفوض من السيرفر ({res.status_code}) — راجع Secret في GitHub: {res.text[:120]}")
            processed_news_links.discard(article["link"])
        else:
            send_stats["fail"] += 1
            print(f"  ⚠️ خطأ إرسال ({res.status_code}): {res.text[:150]}")
            # Don't add to processed set if POST failed — retry next run
            processed_news_links.discard(article["link"])
    except Exception as e:
        send_stats["fail"] += 1
        print(f"  ⚠️ فشل الاتصال بالسيرفر: {e}")
        processed_news_links.discard(article["link"])

# ==========================================
# 7. Main Engine
# ==========================================
def run_ai_scanner():
    global gemini_calls_today

    # 🛡️ لا نوقف المسح أبداً لمفتاح ناقص: التحليل الاحتياطي المحلي يضمن التصنيف،
    #    وSYSTEM_TOKEN يلزم فقط لخطوة الإرسال (نُكمل ونطبع تشخيصاً صريحاً).
    if not GEMINI_API_KEY:
        print("⚠️ GEMINI_API_KEY غير مُعد — التحليل سيكون آلياً محلياً مضموناً (الإرسال يعمل عادي)")
    if not SYSTEM_TOKEN:
        print("🛑 SYSTEM_TOKEN غير مُعد — سيتم المسح والتحليل بلا إرسال! راجع Secrets في GitHub")

    send_stats.update({"ok": 0, "dup": 0, "fail": 0, "auth_fail": 0})
    gemini_calls_today = 0
    gemini_calls_by_model.clear()
    dead_models.clear()
    quota_exhausted_models.clear()
    degraded_models.clear()
    model_failures.clear()
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🤖 تفعيل وضع (OSINT )...")
    now_utc = datetime.utcnow()

    # Phase 1: Scan all RSS feeds in parallel (fast, no API calls)
    all_articles = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
        futures = {executor.submit(scan_single_source, pub, url, now_utc): pub for pub, url in RSS_FEEDS.items()}
        for future in concurrent.futures.as_completed(futures):
            try:
                articles = future.result()
                all_articles.extend(articles)
            except Exception:
                pass

    print(f"\n📊 تم رصد {len(all_articles)} خبر جديد من جميع المصادر")

    if not all_articles:
        print("ℹ️ لا توجد أخبار جديدة مطابقة.")
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ تم الانتهاء.")
        return

    # Phase 2: تحليل كل الأخبار — AI مجاني عند توفّر الحصة، وإلا تحليل آلي احتياطي مضمون
    print(f"\n🧠 بدء التحليل (بجمع {BATCH_SIZE} أخبار في كل طلب)...\n")

    total_batches = (len(all_articles) + BATCH_SIZE - 1) // BATCH_SIZE
    for i in range(0, len(all_articles), BATCH_SIZE):
        batch = all_articles[i:i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        print(f"📡 الدفعة {batch_num}/{total_batches} ({len(batch)} أخبار)...")

        # ✅ التحليل لا يفشل: كل عنصر dict دائماً (AI أو احتياطي) — لا None ولا «فشل التحليل»
        ai_results = analyze_batch_with_ai(batch)

        for article, ai_data in zip(batch, ai_results):
            if SYSTEM_TOKEN:
                send_report(article, ai_data)
            time.sleep(0.3)  # Small delay between API posts

        # Pause between Gemini batches to avoid rate limits
        if i + BATCH_SIZE < len(all_articles) and can_call_gemini():
            time.sleep(1)

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ✅ تم الانتهاء من المسح (Gemini calls: {gemini_calls_today}/{GEMINI_DAILY_LIMIT})")
    # 📊 ملخص الجولة — أول ما تقرأه في اللوج لتعرف فوراً هل وصلت الأخبار أم لا ولماذا
    print(f"\n📈 ملخص الجولة: رُصد {len(all_articles)} خبر | أُرسل بنجاح {send_stats['ok']} | مكرر محفوظ {send_stats['dup']} | فشل إرسال {send_stats['fail']}")
    if send_stats["auth_fail"]:
        print("🛑 تشخيص: فشل إرسال 401/403 ⇒ SYSTEM_TOKEN في Secrets غير صحيح/فارغ — صححه ثم أعد التشغيل")
    elif len(all_articles) and send_stats["ok"] == 0 and send_stats["fail"] == 0 and not SYSTEM_TOKEN:
        print("🛑 تشخيص: لا SYSTEM_TOKEN ⇒ لم يُرسل شيء بالتصميم — أضف الـ Secret")

    # Phase 3: إصلاح الأخبار القديمة التي فشل تحليلها قبل هذا الإصلاح (لا يبقى خبر بلا تحليل)
    try:
        repair_unanalyzed_news()
    except Exception as e:
        print(f"⚠️ تعذّر إصلاح الأخبار القديمة: {e}")


# ==========================================
# 8. Repair Engine — إعادة تحليل كل خبر فشل تحليله سابقاً
# ==========================================
# 🛠️ حد الإصلاح لكل جولة: الجديد أولًا — الإصلاح لا يأكل ميزانية الجديد (كان 400)
RADAR_REPAIR_LIMIT = int(os.environ.get("RADAR_REPAIR_LIMIT", "50") or 50)


def _needs_repair(news):
    """هل هذا السجل بلا تحليل حقيقي؟ (علامات الفشل القديمة أو تصنيف فارغ)."""
    news_type = str(news.get("news_type") or "").strip()
    updates = str(news.get("news_updates") or "")
    if "تعذر التحليل" in updates or "فشل التحليل" in news_type:
        return True
    return news_type in ("", "-", "غير مصنف", "أخرى / غير مصنف")


def repair_unanalyzed_news(limit=None):
    """يعيد تحليل كل خبر سابق فشل تحليله (news_type = «غير مصنف (فشل التحليل)») عبر
    PUT /api/ai-news/{id} بمفتاح النظام — حتى لا يبقى في القاعدة أي خبر بلا تحليل.
    يستخدم التحليل نفسه: ذكاء اصطناعي مجاني عند توفّر الحصة، وإلا التحليل الاحتياطي المحلي."""
    if not SYSTEM_TOKEN:
        print("⚠️ SYSTEM_TOKEN مفقود — تخطّي إصلاح الأخبار القديمة")
        return

    cap = RADAR_REPAIR_LIMIT if limit is None else limit
    headers = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
    try:
        res = requests.get(SYSTEM_API_URL, headers=headers, timeout=30)
    except Exception as e:
        print(f"⚠️ تعذّر جلب أخبار الرادار: {e}")
        return
    if not res.ok:
        print(f"⚠️ تعذّر جلب أخبار الرادار ({res.status_code})")
        return
    try:
        rows = res.json()
    except Exception:
        print("⚠️ رد غير صالح من نقطة أخبار الرادار")
        return

    if not isinstance(rows, list):
        print("⚠️ شكل غير متوقع لبيانات الرادار")
        return

    pending = [r for r in rows if isinstance(r, dict) and _needs_repair(r) and r.get("news_link")]
    if not pending:
        print("ℹ️ لا توجد أخبار قديمة بلا تحليل — كل السجلات محلَّلة.")
        return

    pending = pending[:cap]
    print(f"\n🛠️ إصلاح {len(pending)} خبر قديم بلا تحليل (حد الجولة: {cap})...")
    repaired = 0
    for i in range(0, len(pending), BATCH_SIZE):
        batch_rows = pending[i:i + BATCH_SIZE]
        articles = [{
            "title": (row.get("incident_description") or "بلاغ بلا عنوان").strip(),
            "text": f"{row.get('incident_description') or ''} {row.get('news_publisher') or ''}".strip(),
            "link": row.get("news_link"),
            "publisher": row.get("news_publisher") or "",
            "image_url": "لا توجد صورة",
        } for row in batch_rows]
        analyses = analyze_batch_with_ai(articles)
        for row, article, ai_data in zip(batch_rows, articles, analyses):
            payload = {
                "incident_date": (str(row.get("incident_date") or "")[:10] or None),
                "incident_month": row.get("incident_month"),
                "incident_description": ai_data.get("incident_description") or article["title"],
                "news_type": ai_data.get("news_type") or "بلاغ حادث (تحليل آلي)",
                "news_publisher": row.get("news_publisher"),
                "street_name": ai_data.get("street_name") or "",
                "area_name": ai_data.get("area_name") or "",
                "governorate": (
                    ai_data.get("governorate")
                    if ai_data.get("governorate") not in (None, "", "-")
                    else (row.get("governorate") or "-")
                ),
                "hospital_name": ai_data.get("hospital_name") or "",
                "injured_count": str(ai_data.get("injured_count") or 0),
                "deaths_count": str(ai_data.get("deaths_count") or 0),
                "news_updates": _build_tactical_report(article, ai_data),
                "news_link": row.get("news_link"),
                "data_entry_name": row.get("data_entry_name") or "OSINT  AI",
                "observed_at": (str(row.get("observed_at") or "")[:19] or None),
            }
            try:
                put = requests.put(f"{SYSTEM_API_URL}/{row.get('id')}", json=payload, headers=headers, timeout=20)
                if put.status_code in (200, 201):
                    repaired += 1
                else:
                    print(f"  ⚠️ فشل إصلاح الخبر {row.get('id')} ({put.status_code}): {put.text[:120]}")
            except Exception as e:
                print(f"  ⚠️ فشل إصلاح الخبر {row.get('id')}: {e}")
            time.sleep(0.15)
        print(f"   … أُصلح {repaired}/{min(i + len(batch_rows), len(pending))}")

    print(f"✅ إصلاح الأخبار القديمة: {repaired}/{len(pending)} خبر أصبح محلَّلاً.")

if __name__ == '__main__':
    # 🔧 أوضاع التشغيل:
    #   python ai_radar.py                    ⇒ مسح المصادر + تحليل + إصلاح دفعة من القديم
    #   python ai_radar.py --repair-only      ⇒ إصلاح الأخبار القديمة فقط (بلا مسح جديد)
    #   python ai_radar.py --repair-only 2000 ⇒ إصلاح كل السجلات القديمة في جولة واحدة
    args = [a for a in sys.argv[1:] if a.strip()]
    if '--repair-only' in args:
        rest = [a for a in args if a != '--repair-only']
        repair_limit = int(rest[0]) if rest and rest[0].isdigit() else None
        gemini_calls_today = 0
        gemini_calls_by_model.clear()
        dead_models.clear()
        quota_exhausted_models.clear()
        degraded_models.clear()
        model_failures.clear()
        if not GEMINI_API_KEY or not SYSTEM_TOKEN:
            print("⚠️ المفاتيح مفقودة! تأكد من GEMINI_API_KEY و SYSTEM_TOKEN")
            sys.exit(2)
        repair_unanalyzed_news(limit=repair_limit)
    else:
        run_ai_scanner()
