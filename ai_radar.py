import feedparser
import requests
import json
import os
import time
import urllib.parse
import concurrent.futures
import random
from bs4 import BeautifulSoup
import google.generativeai as genai
from datetime import datetime, timedelta
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ==========================================
# 1. إعدادات النظام والمفاتيح
# ==========================================
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") 
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN") 
# 💡 تم إصلاح اللينك للمشروع الجديد مع مسار الـ API
SYSTEM_API_URL = "https://eoc-system-b12f.vercel.app/api/ai-news" 

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

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

# ==========================================
# 2. شبكة الرصد الأخطبوطية الشاملة
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
    pass

# ==========================================
# 4. دالة الغوص العميق (سحب النص + الصور)
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
    except Exception as e:
        return "", "لا توجد صورة"

# ==========================================
# 5. محرك الذكاء الاصطناعي (العقل المدبر التكتيكي)
# ==========================================
def analyze_news_with_ai(news_text, title, retries=3):
    prompt = f"""
    أنت خبير أمني ومدير استراتيجيات في غرفة عمليات طوارئ (EOC) متقدمة.
    قم بتحليل هذا الحدث بدقة شديدة:
    العنوان: "{title}"
    التفاصيل: "{news_text}"

    استخرج البيانات التالية في صيغة JSON فقط وبدون أي نصوص إضافية:
    - "incident_description": ملخص تكتيكي للحادث يبرز حجم الخسائر والتهديدات المحتملة.
    - "news_type": تصنيف الحادث الدقيق.
    - "governorate": المحافظة.
    - "area_name": المنطقة.
    - "street_name": الشارع.
    - "hospital_name": المستشفى.
    - "injured_count": المصابين (رقم فقط).
    - "deaths_count": الوفيات (رقم فقط).
    - "severity_score": تقييم الخطورة من 1 إلى 10 (رقم فقط).
    - "latitude": استنتج خط العرض الجغرافي التقريبي لمكان الحادث في مصر (مثال: 30.0444).
    - "longitude": استنتج خط الطول الجغرافي التقريبي لمكان الحادث في مصر (مثال: 31.2357).
    - "tactical_recommendations": اكتب 3 توصيات ميدانية سريعة لغرفة العمليات لكيفية الاستجابة لهذا الحدث.
    """
    
    # هنستخدم أحدث وأسرع موديل ظهر عندك في القائمة ونكلم جوجل دايركت
    model_name = "gemini-3.5-flash" 
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
    
    headers = {'Content-Type': 'application/json'}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2}
    }

    for attempt in range(retries):
        try:
            # الاتصال المباشر الصاروخي
            response = requests.post(url, headers=headers, json=payload, timeout=20)
            
            if response.status_code == 200:
                data = response.json()
                ai_text = data['candidates'][0]['content']['parts'][0]['text']
                clean_json = ai_text.replace('```json', '').replace('```', '').strip()
                return json.loads(clean_json)
            else:
                print(f"⚠️ خطأ من جوجل في المحاولة {attempt+1}: {response.text}")
                time.sleep(2)
        except Exception as e:
            print(f"⚠️ فشل تحليل الذكاء الاصطناعي في المحاولة {attempt+1}: {e}")
            time.sleep(2)
            
    return None

# ==========================================
# 6. وحدة المسح الفردية
# ==========================================
def scan_single_source(publisher, url, now_utc):
    try:
        headers = {'User-Agent': random.choice(USER_AGENTS)}
        resp = requests.get(url, headers=headers, timeout=10)
        feed = feedparser.parse(resp.content)
        
        # 💡 مسح 15 خبر من كل مصدر
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
                print(f"🚨 [{publisher}] تم رصد الهدف: {entry.title}")
                
                full_article_text, image_url = scrape_full_article(news_link)
                combined_text = full_article_text if len(full_article_text) > 50 else entry.get('summary', '')

                ai_data = analyze_news_with_ai(combined_text, entry.title)
                
                if not ai_data:
                    print(f"🔄 جاري إرسال الخبر ({entry.title}) بدون تحليل ذكاء اصطناعي للضرورة.")
                    ai_data = {
                        "incident_description": entry.title,
                        "news_type": "غير مصنف (فشل التحليل)",
                        "governorate": "-",
                        "area_name": "",
                        "street_name": "",
                        "hospital_name": "",
                        "injured_count": "0",
                        "deaths_count": "0",
                        "severity_score": "?",
                        "latitude": "غير متوفر",
                        "longitude": "غير متوفر",
                        "tactical_recommendations": "تعذر التحليل بواسطة الذكاء الاصطناعي. يرجى المراجعة اليدوية للخبر المرفق."
                    }

                severity = ai_data.get("severity_score", "?")
                tactical = ai_data.get("tactical_recommendations", "لا توجد توصيات واضحة.")
                lat = ai_data.get("latitude", "غير متوفر")
                lng = ai_data.get("longitude", "غير متوفر")
                
                tactical_report = (
                    f"🔥 [مستوى الخطورة]: {severity}/10\n"
                    f"📍 [إحداثيات الموقع]: {lat}, {lng}\n"
                    f"💡 [توصيات تكتيكية للغرفة]: {tactical}\n"
                    f"📸 [صورة الحادثة]: {image_url}"
                )

                payload = {
                    "incident_date": datetime.now().strftime("%Y-%m-%d"),
                    "incident_description": ai_data.get("incident_description", entry.title),
                    "news_type": ai_data.get("news_type", "أخرى / غير مصنف"),
                    "news_publisher": publisher,
                    "street_name": ai_data.get("street_name", ""),
                    "area_name": ai_data.get("area_name", ""),
                    "governorate": ai_data.get("governorate", "-"),
                    "hospital_name": ai_data.get("hospital_name", ""),
                    "injured_count": str(ai_data.get("injured_count", "0")),
                    "deaths_count": str(ai_data.get("deaths_count", "0")),
                    "news_updates": tactical_report,
                    "news_link": news_link,
                    "data_entry_name": "OSINT God-Mode AI"
                }
                
                headers_api = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
                res = requests.post(SYSTEM_API_URL, json=payload, headers=headers_api)
                
                if res.status_code in [200, 201]: 
                    print(f"✅ تم إرسال التقرير لغرفة العمليات بنجاح!")
                else:
                    print(f"⚠️ خطأ في الإرسال: {res.text}")
                
                processed_news_links.add(news_link)
    except Exception as e:
        pass

# ==========================================
# 7. المحرك الرئيسي (Multi-threading القاتل)
# ==========================================
def run_ai_scanner():
    if not GEMINI_API_KEY or not SYSTEM_TOKEN:
        print("⚠️ المفاتيح مفقودة!")
        return

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🤖 تفعيل وضع (OSINT God-Mode)...")
    now_utc = datetime.utcnow()

    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as executor:
        futures = [executor.submit(scan_single_source, pub, url, now_utc) for pub, url in RSS_FEEDS.items()]
        concurrent.futures.wait(futures)

    print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ تم الانتهاء من المسح الميداني بنجاح.")

if __name__ == '__main__':
    run_ai_scanner()
