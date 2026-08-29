import feedparser
import requests
import json
import os
import time
from google import genai
from datetime import datetime

# ==========================================
# 1. إعدادات النظام (بتتسحب من خزنة GitHub السرية)
# ==========================================
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") 
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN") 
SYSTEM_API_URL = "https://eoc-system.vercel.app/api/ai-news" 

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

KEYWORDS = [
    'حريق', 'حرائق', 'انهيار', 'سقوط مبنى', 'تصادم', 'انقلاب', 'غرق', 'تسرب غاز', 
    'تسرب كيميائي', 'تسمم', 'انفجار', 'سيول', 'فيضانات', 'زلزال', 'هزة أرضية', 
    'مصرع', 'وفاة', 'إصابة', 'تفحم', 'اشتعال', 'دهس', 'اختناق', 'عاجل', 
    'طوارئ', 'إنقاذ', 'إسعاف', 'كارثة', 'تدافع', 'خروج قطار'
]

RSS_FEEDS = {
    "اليوم السابع": "https://www.youm7.com/rss/SectionRss?SectionID=203",
    "المصري اليوم": "https://www.almasryalyoum.com/rss/section/13",
    "صدى البلد": "https://www.elbalad.news/rss/3",
    "مصراوي": "https://www.masrawy.com/CrossDomain/News/RSS",
    "الشروق": "https://www.shorouknews.com/rss/accidents.xml",
    "بوابة الأهرام": "https://gate.ahram.org.eg/Rss/50/LatestNews.aspx",
    "الوطن": "https://www.elwatannews.com/home/rss"
}

# ==========================================
# 2. تحميل الذاكرة من السيستم لمنع التكرار
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
        print(f"📦 تم تحميل {len(processed_news_links)} رابط سابق من الداتا بيز لعدم التكرار.")
except Exception as e:
    print(f"⚠️ فشل جلب الأخبار السابقة: {e}")

# ==========================================
# 3. التحليل بالذكاء الاصطناعي
# ==========================================
def analyze_news_with_ai(news_text):
    prompt = f"""
    أنت مساعد لغرفة عمليات EOC. استخرج البيانات التالية في صيغة JSON فقط:
    الخبر: "{news_text}"

    - "incident_description": ملخص للحادث.
    - "news_type": تصنيف الحادث.
    - "governorate": اسم المحافظة (مثال: القاهرة).
    - "area_name": اسم المنطقة.
    - "street_name": اسم الشارع.
    - "hospital_name": اسم المستشفى.
    - "injured_count": المصابين (رقم).
    - "deaths_count": الوفيات (رقم).
    """
    try:
        response = client.models.generate_content(model='gemini-3.6-flash', contents=prompt)
        clean_json = response.text.replace('```json', '').replace('```', '').strip()
        return json.loads(clean_json)
    except Exception as e:
        print(f"❌ خطأ AI: {e}")
        return None

# ==========================================
# 4. محرك المسح والإرسال
# ==========================================
def run_ai_scanner():
    if not GEMINI_API_KEY or not SYSTEM_TOKEN:
        print("⚠️ المفاتيح السرية مفقودة!")
        return

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🤖 بدء المسح...")
    for publisher, url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:5]:
                news_link = entry.link
                if news_link in processed_news_links: continue
                
                full_text = f"{entry.title} - {entry.get('summary', '')}"
                if any(k in full_text for k in KEYWORDS):
                    print(f"⚠️ حادث محتمل: {entry.title}")
                    ai_data = analyze_news_with_ai(full_text)
                    if ai_data:
                        payload = {
                            "incident_date": datetime.now().strftime("%Y-%m-%d"),
                            "incident_description": ai_data.get("incident_description", entry.title),
                            "news_type": ai_data.get("news_type", "غير محدد"),
                            "news_publisher": publisher,
                            "street_name": ai_data.get("street_name", ""),
                            "area_name": ai_data.get("area_name", ""),
                            "governorate": ai_data.get("governorate", "القاهرة"),
                            "hospital_name": ai_data.get("hospital_name", ""),
                            "injured_count": str(ai_data.get("injured_count", "0")),
                            "deaths_count": str(ai_data.get("deaths_count", "0")),
                            "news_updates": "تم الرصد آلياً بواسطة AI Scanner.",
                            "news_link": news_link,
                            "data_entry_name": "AI Robot"
                        }
                        headers = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
                        res = requests.post(SYSTEM_API_URL, json=payload, headers=headers)
                        if res.status_code in [200, 201]: print("✅ تم الإرسال بنجاح!")
                    
                    processed_news_links.add(news_link)
                time.sleep(4) 
        except Exception as e:
            print(f"❌ خطأ مسح {publisher}")
    print("✅ انتهت دورة المسح بنجاح.")

if __name__ == '__main__':
    run_ai_scanner()