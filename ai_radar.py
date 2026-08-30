import feedparser
import requests
import json
import os
import time
import urllib.parse
import concurrent.futures
import random
from bs4 import BeautifulSoup
from google import genai
from datetime import datetime, timedelta

# ==========================================
# 1. إعدادات النظام والمفاتيح
# ==========================================
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") 
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN") 
SYSTEM_API_URL = "https://eoc-system.vercel.app/api/ai-news" 

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# 💡 شبكة اصطياد الحوادث الشاملة
KEYWORDS = [
    'تصادم', 'انقلاب', 'خروج قطار', 'اصطدام', 'حوادث طرق', 'ميكروباص', 'سيارة نقل', 
    'مقطورة', 'حادث مروع', 'دهس', 'حريق', 'حرائق', 'اشتعال', 'نيران', 'تفحم', 
    'ماس كهربائي', 'انفجار', 'تسرب غاز', 'تسرب كيميائي', 'انهيار', 'سقوط مبنى', 
    'تصدع', 'ميل عقار', 'هبوط أرضي', 'سيول', 'فيضانات', 'زلزال', 'هزة أرضية', 
    'مصرع', 'وفاة', 'إصابة', 'حالات حرجة', 'اختناق', 'تسمم', 'انتشال', 'جثة', 
    'طوارئ', 'إنقاذ', 'إسعاف', 'كارثة', 'حماية مدنية', 'كردون أمني', 'السيطرة على'
]

# قائمة تنكر البوت (Stealth Mode)
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"
]

# ==========================================
# 2. بناء رادار السوشيال ميديا والأخبار السريع (محدث وشامل)
# ==========================================
search_query = 'حريق OR حادث OR عاجل OR مصرع OR انفجار OR انهيار'
encoded_query = urllib.parse.quote(f"{search_query} when:1h")
GOOGLE_NEWS_EGYPT = f"https://news.google.com/rss/search?q={encoded_query}&hl=ar&gl=EG&ceid=EG:ar"

# 💡 شبكة الرصد الأخطبوطية (كل الأقسام والمواقع)
RSS_FEEDS = {
    # 🔴 جوجل نيوز
    "رادار جوجل اللحظي": GOOGLE_NEWS_EGYPT, 
    
    # 🔴 صدى البلد (الموقع اللي فاتنا)
    "صدى البلد (عاجل/رئيسية)": "https://www.elbalad.news/rss/1",
    "صدى البلد (حوادث)": "https://www.elbalad.news/rss/3",
    "صدى البلد (محافظات)": "https://www.elbalad.news/rss/4",

    # 🔴 اليوم السابع
    "اليوم السابع (عاجل)": "https://www.youm7.com/rss/SectionRss?SectionID=65",
    "اليوم السابع (حوادث)": "https://www.youm7.com/rss/SectionRss?SectionID=203",
    "اليوم السابع (محافظات)": "https://www.youm7.com/rss/SectionRss?SectionID=319",

    # 🔴 المصري اليوم
    "المصري اليوم (عاجل)": "https://www.almasryalyoum.com/rss/section/1",
    "المصري اليوم (حوادث)": "https://www.almasryalyoum.com/rss/section/13",
    "المصري اليوم (محافظات)": "https://www.almasryalyoum.com/rss/section/53",

    # 🔴 الشروق
    "الشروق (عاجل)": "https://www.shorouknews.com/rss/urgent.xml",
    "الشروق (حوادث)": "https://www.shorouknews.com/rss/accidents.xml",
    "الشروق (محافظات)": "https://www.shorouknews.com/rss/governorates.xml",

    # 🔴 فيتو
    "فيتو (عاجل)": "https://www.vetogate.com/rss/1",
    "فيتو (حوادث)": "https://www.vetogate.com/rss/2",
    "فيتو (محافظات)": "https://www.vetogate.com/rss/3",

    # 🔴 الدستور
    "الدستور (عاجل)": "https://www.dostor.org/rss/section/1",
    "الدستور (حوادث)": "https://www.dostor.org/rss/section/5",

    # 🔴 البوابة نيوز
    "البوابة نيوز (عاجل)": "https://www.albawabhnews.com/rss/1",
    "البوابة نيوز (حوادث)": "https://www.albawabhnews.com/rss/97",

    # 🔴 الأسبوع
    "الأسبوع (عاجل)": "https://www.elaosboa.com/rss/1/",
    "الأسبوع (حوادث)": "https://www.elaosboa.com/rss/accidents/",

    # 🔴 مواقع بتغذية شاملة
    "القاهرة 24 (الرئيسية)": "https://www.cairo24.com/rss",
    "الوطن (الرئيسية)": "https://www.elwatannews.com/home/rss",
    "مصراوي (الرئيسية)": "https://www.masrawy.com/CrossDomain/News/RSS",

    # 🔴 الوكالات الدولية بمصر
    "سكاي نيوز (مصر)": "https://www.skynewsarabia.com/rss/مصر",
    "روسيا اليوم (مصر)": "https://arabic.rt.com/rss/egypt/",
    "العربية (مصر)": "https://www.alarabiya.net/egypt.rss"
}

# ==========================================
# 3. الذاكرة المانعة للتكرار
# ==========================================
processed_news_links = set()
try:
    if SYSTEM_TOKEN:
        headers = {"Authorization": f"Bearer {SYSTEM_TOKEN}"}
        res = requests.get(SYSTEM_API_URL, headers=headers)
        if res.ok:
            for news in res.json():
                if news.get("news_link"):
                    processed_news_links.add(news.get("news_link"))
except Exception as e:
    print(f"⚠️ فشل جلب الأخبار السابقة: {e}")

# ==========================================
# 4. دالة الغوص العميق (قراءة المقال بالكامل)
# ==========================================
def scrape_full_article(url):
    try:
        headers = {'User-Agent': random.choice(USER_AGENTS)}
        response = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(response.content, 'html.parser')
        
        paragraphs = soup.find_all('p')
        article_text = " ".join([p.get_text() for p in paragraphs])
        
        return article_text[:3500] if len(article_text) > 3500 else article_text
    except Exception as e:
        return ""

# ==========================================
# 5. محرك الذكاء الاصطناعي (تحليل احترافي)
# ==========================================
def analyze_news_with_ai(news_text, title, retries=3):
    prompt = f"""
    أنت خبير أمني في غرفة عمليات EOC. اقرأ هذا النص الكامل للخبر، واستخرج البيانات في صيغة JSON فقط:
    العنوان: "{title}"
    التفاصيل الكاملة: "{news_text}"

    - "incident_description": ملخص دقيق للحادث يبرز حجم الخسائر إن وجدت.
    - "news_type": تصنيف الحادث. (إذا كان غريباً اكتب "أخرى / غير مصنف").
    - "governorate": اسم المحافظة (استنتجها أو اكتب "غير محدد").
    - "area_name": اسم المنطقة.
    - "street_name": اسم الشارع.
    - "hospital_name": المستشفى الذي تم نقل الضحايا إليه (إن وجد).
    - "injured_count": المصابين (اكتب الرقم فقط، أو 0).
    - "deaths_count": الوفيات (اكتب الرقم فقط، أو 0).
    - "severity_score": رقم من 1 إلى 10 يمثل حجم الأزمة وتأثيرها.
    """
    for attempt in range(retries):
        try:
            response = client.models.generate_content(model='gemini-3.6-flash', contents=prompt)
            clean_json = response.text.replace('```json', '').replace('```', '').strip()
            return json.loads(clean_json)
        except Exception as e:
            time.sleep(2)
    return None

# ==========================================
# 6. وحدة المسح الفردية (تعمل بالتوازي)
# ==========================================
def scan_single_source(publisher, url, now_utc):
    try:
        headers = {'User-Agent': random.choice(USER_AGENTS)}
        resp = requests.get(url, headers=headers, timeout=10)
        feed = feedparser.parse(resp.content)
        
        for entry in feed.entries[:50]: 
            
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
                print(f"🚨 [{publisher}] تم اصطياد حادث، جاري الغوص لجمع التفاصيل: {entry.title}")
                
                full_article_text = scrape_full_article(news_link)
                combined_text = full_article_text if len(full_article_text) > 50 else entry.get('summary', '')

                ai_data = analyze_news_with_ai(combined_text, entry.title)
                
                if not ai_data:
                    ai_data = {
                        "incident_description": entry.title,
                        "news_type": "أخرى / غير مصنف",
                        "governorate": "تحليل يدوي مطلوب",
                        "injured_count": "0", "deaths_count": "0", "severity_score": "غير محدد"
                    }

                severity = ai_data.get("severity_score", "?")
                updates_msg = f"🔥 [مستوى الخطورة: {severity}/10] - تم قراءة المقال بالكامل بواسطة EOC AI Radar."

                payload = {
                    "incident_date": datetime.now().strftime("%Y-%m-%d"),
                    "incident_description": ai_data.get("incident_description", entry.title),
                    "news_type": ai_data.get("news_type", "أخرى / غير مصنف"),
                    "news_publisher": publisher,
                    "street_name": ai_data.get("street_name", ""),
                    "area_name": ai_data.get("area_name", ""),
                    "governorate": ai_data.get("governorate", "القاهرة"),
                    "hospital_name": ai_data.get("hospital_name", ""),
                    "injured_count": str(ai_data.get("injured_count", "0")),
                    "deaths_count": str(ai_data.get("deaths_count", "0")),
                    "news_updates": updates_msg,
                    "news_link": news_link,
                    "data_entry_name": "AI Robot (Deep Scan)"
                }
                
                headers_api = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
                res = requests.post(SYSTEM_API_URL, json=payload, headers=headers_api)
                if res.status_code in [200, 201]: 
                    print(f"✅ تم رفع الخبر بنجاح شامل التفاصيل من {publisher}!")
                
                processed_news_links.add(news_link)
    except Exception as e:
        print(f"❌ خطأ في مسح {publisher}: {e}")

# ==========================================
# 7. المحرك الرئيسي (Multi-threading مع 25 مسار)
# ==========================================
def run_ai_scanner():
    if not GEMINI_API_KEY or not SYSTEM_TOKEN:
        print("⚠️ المفاتيح السرية مفقودة!")
        return

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🤖 بدء المسح المتوازي الشامل (Deep Scan Mode)...")
    now_utc = datetime.utcnow()

    # 💡 تم زيادة قوة المعالجة لـ 25 مسار متوازي لاصطياد كل المواقع في ثانية واحدة
    with concurrent.futures.ThreadPoolExecutor(max_workers=25) as executor:
        futures = [executor.submit(scan_single_source, pub, url, now_utc) for pub, url in RSS_FEEDS.items()]
        concurrent.futures.wait(futures)

    print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ انتهت دورة المسح الشاملة بنجاح.")

if __name__ == '__main__':
    run_ai_scanner()