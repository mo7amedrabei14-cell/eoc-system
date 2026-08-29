import feedparser
import requests
import time
import schedule
import json
import threading
import os
from flask import Flask
from google import genai
from datetime import datetime

# ==========================================
# 1. إعدادات النظام والمفاتيح السريّة (من السيرفر)
# ==========================================
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") 
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN") 
SYSTEM_API_URL = "https://eoc-system.vercel.app/api/ai-news" 

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ==========================================
# 2. إعداد سيرفر الويب الوهمي (عشان السيرفر السحابي ميفصلوش)
# ==========================================
app = Flask(__name__)

@app.route('/')
def home():
    return "🤖 AI Radar is running 24/7 in the background!"

def run_flask():
    port = int(os.environ.get("PORT", 8080))
    app.run(host='0.0.0.0', port=port)

# ==========================================
# 3. الكلمات المفتاحية والمصادر
# ==========================================
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

processed_news_links = set()

# ==========================================
# 4. محرك البحث والذكاء الاصطناعي
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

def run_ai_scanner():
    if not GEMINI_API_KEY or not SYSTEM_TOKEN:
        print("⚠️ المفاتيح السرية غير موجودة! الرجاء إضافتها في إعدادات السيرفر.")
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
                time.sleep(4) # فرملة لمنع الحظر من جوجل
        except Exception as e:
            print(f"❌ خطأ مسح {publisher}")

def start_background_tasks():
    schedule.every(10).minutes.do(run_ai_scanner)
    run_ai_scanner()
    while True:
        schedule.run_pending()
        time.sleep(1)

if __name__ == '__main__':
    # تشغيل الروبوت في الخلفية (Thread)
    threading.Thread(target=start_background_tasks, daemon=True).start()
    # تشغيل سيرفر الويب في الواجهة عشان Render يقبله
    run_flask()