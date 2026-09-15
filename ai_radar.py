import feedparser
import requests
import json
import os
import time
import urllib.parse
import concurrent.futures
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
SYSTEM_API_URL = "https://eoc-system-b12f.vercel.app/api/ai-news"

# Quota management: free tier = 20 req/day. We batch 5 articles per call,
# so 20 calls × 5 = 100 articles analyzed per day. Leave a buffer.
GEMINI_DAILY_LIMIT = 18
gemini_calls_today = 0

# Correct Gemini model names (gemini-3.5-flash does NOT exist)
GEMINI_MODEL = "gemini-2.0-flash"
BATCH_SIZE = 5  # articles per Gemini API call

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
encoded_query = urllib.parse.quote(f"{search_query} when:1h")
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
# ==========================================
def can_call_gemini():
    """Check if we still have quota for Gemini API calls."""
    return gemini_calls_today < GEMINI_DAILY_LIMIT

def analyze_batch_with_ai(articles_batch):
    """
    Send a batch of articles (up to BATCH_SIZE) in a single Gemini API call.
    Returns a list of parsed dicts, one per article.
    """
    global gemini_calls_today

    if not GEMINI_API_KEY:
        return [None] * len(articles_batch)

    if not can_call_gemini():
        print(f"⚠️ Quota limit approaching ({gemini_calls_today}/{GEMINI_DAILY_LIMIT}) — skipping AI analysis")
        return [None] * len(articles_batch)

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
    "governorate": "المحافظة",
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

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    headers = {'Content-Type': 'application/json'}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 8192
        }
    }

    for attempt in range(3):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=60)

            if response.status_code == 200:
                gemini_calls_today += 1
                data = response.json()
                ai_text = data['candidates'][0]['content']['parts'][0]['text']
                # Clean markdown fences if present
                clean_text = ai_text.strip()
                if clean_text.startswith('```'):
                    clean_text = clean_text.split('\n', 1)[1] if '\n' in clean_text else clean_text[3:]
                if clean_text.endswith('```'):
                    clean_text = clean_text[:-3]
                clean_text = clean_text.strip()

                results = json.loads(clean_text)

                # Ensure we return a list
                if isinstance(results, dict):
                    results = [results]

                # Pad with None if fewer results than articles
                while len(results) < len(articles_batch):
                    results.append(None)

                print(f"✅ Gemini analysis OK: {len(articles_batch)} articles in 1 call (quota: {gemini_calls_today}/{GEMINI_DAILY_LIMIT})")
                return results[:len(articles_batch)]

            elif response.status_code == 429:
                # RATE LIMITED — do NOT retry (daily quota, not transient)
                print(f"⚠️ Gemini quota EXHAUSTED (429) — stopping AI analysis for this run")
                gemini_calls_today = GEMINI_DAILY_LIMIT  # Mark as depleted
                return [None] * len(articles_batch)

            else:
                print(f"⚠️ Gemini error {response.status_code} (attempt {attempt+1}): {response.text[:200]}")
                time.sleep(2)

        except json.JSONDecodeError as e:
            print(f"⚠️ Gemini returned invalid JSON (attempt {attempt+1}): {e}")
            time.sleep(1)
        except Exception as e:
            print(f"⚠️ Gemini call failed (attempt {attempt+1}): {e}")
            time.sleep(2)

    return [None] * len(articles_batch)

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
                    if now_utc - pub_date > timedelta(hours=2):
                        continue
            except Exception:
                pass

            news_link = entry.link
            if news_link in processed_news_links:
                continue

            if any(k in entry.title for k in KEYWORDS):
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
def send_report(article, ai_data):
    """Send a single article report to the EOC API."""
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
        # Fallback: use keyword guessing for governorate
        gov = guess_governorate(f"{article['title']} {article['text']}")
        severity = "?"
        tactical = "تعذر التحليل بواسطة الذكاء الاصطناعي. يرجى المراجعة اليدوية."
        lat = "غير متوفر"
        lng = "غير متوفر"
        description = article["title"]
        news_type = "غير مصنف (فشل التحليل)"
        area = ""
        street = ""
        hospital = ""
        injured = "0"
        deaths = "0"

    tactical_report = (
        f"🔥 [مستوى الخطورة]: {severity}/10\n"
        f"📍 [إحداثيات الموقع]: {lat}, {lng}\n"
        f"💡 [توصيات تكتيكية للغرفة]: {tactical}\n"
        f"📸 [صورة الحادثة]: {article.get('image_url', 'لا توجد صورة')}"
    )

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
        "data_entry_name": "OSINT God-Mode AI"
    }

    try:
        headers_api = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
        res = requests.post(SYSTEM_API_URL, json=payload, headers=headers_api, timeout=15)
        if res.status_code in [200, 201]:
            print(f"  ✅ إرسال ناجح: {article['title'][:60]}")
        else:
            print(f"  ⚠️ خطأ إرسال ({res.status_code}): {res.text[:100]}")
            # Don't add to processed set if POST failed — retry next run
            processed_news_links.discard(article["link"])
    except Exception as e:
        print(f"  ⚠️ فشل الاتصال: {e}")
        processed_news_links.discard(article["link"])

# ==========================================
# 7. Main Engine
# ==========================================
def run_ai_scanner():
    global gemini_calls_today

    if not GEMINI_API_KEY or not SYSTEM_TOKEN:
        print("⚠️ المفاتيح مفقودة! تأكد من GEMINI_API_KEY و SYSTEM_TOKEN")
        return

    gemini_calls_today = 0
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🤖 تفعيل وضع (OSINT God-Mode)...")
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

    # Phase 2: Batch-analyze with Gemini (sequential, quota-aware)
    print(f"\n🧠 بدء التحليل الذكي (بجمع {BATCH_SIZE} أخبار في كل طلب)...\n")

    for i in range(0, len(all_articles), BATCH_SIZE):
        if not can_call_gemini():
            print(f"⚠️ Quartz depleted at article {i}/{len(all_articles)} — sending remaining without AI")
            break

        batch = all_articles[i:i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        total_batches = (len(all_articles) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"📡 الدفعة {batch_num}/{total_batches} ({len(batch)} أخبار)...")

        ai_results = analyze_batch_with_ai(batch)

        # Send each article with its AI analysis (or fallback)
        for article, ai_data in zip(batch, ai_results):
            send_report(article, ai_data)
            time.sleep(0.3)  # Small delay between API posts

        # Pause between Gemini batches to avoid rate limits
        if i + BATCH_SIZE < len(all_articles) and can_call_gemini():
            time.sleep(1)

    # Send remaining articles (those after quota was exhausted) without AI
    remaining_start = 0
    for i in range(0, len(all_articles), BATCH_SIZE):
        if not can_call_gemini():
            remaining_start = i
            break
        remaining_start = i + BATCH_SIZE

    if remaining_start < len(all_articles):
        print(f"\n🔄 إرسال {len(all_articles) - remaining_start} أخبار متبقية بدون تحليل AI...")
        for article in all_articles[remaining_start:]:
            send_report(article, None)
            time.sleep(0.2)

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ✅ تم الانتهاء من المسح (Gemini calls: {gemini_calls_today}/{GEMINI_DAILY_LIMIT})")

if __name__ == '__main__':
    run_ai_scanner()
