import feedparser
import requests
import json
import os
import time
from google import genai
from datetime import datetime, timedelta

# ==========================================
# 1. إعدادات النظام
# ==========================================
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") 
SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN") 
SYSTEM_API_URL = "https://eoc-system.vercel.app/api/ai-news" 

client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# 💡 التعديل الأول: شبكة الكلمات المفتاحية (توسيع شامل لكل المرادفات والمصطلحات)
KEYWORDS = [
    # حوادث الطرق والقطارات
    'تصادم', 'انقلاب', 'خروج قطار', 'اصطدام', 'حوادث طرق', 'ميكروباص', 'سيارة نقل', 
    'مقطورة', 'حادث مروع', 'دهس', 'طريق صحراوي', 'طريق زراعي', 'محور',
    # الحرائق والانفجارات
    'حريق', 'حرائق', 'اشتعال', 'نيران', 'تفحم', 'ماس كهربائي', 'انفجار', 
    'تسرب غاز', 'تسرب كيميائي', 'مواد خطرة', 'السيطرة على حريق', 'الدفع بسيارات إطفاء',
    # انهيارات ومشاكل هندسية
    'انهيار', 'سقوط مبنى', 'تصدع', 'ميل عقار', 'انهيار جزئي', 'انهيار كوبري', 
    'سقوط كوبري', 'هبوط أرضي', 'انهيار صخري',
    # كوارث طبيعية وبيئية
    'سيول', 'فيضانات', 'زلزال', 'هزة أرضية', 'عاصفة ترابية', 'عاصفة رملية',
    'طقس سيء', 'أمطار رعدية', 'رياح عاتية', 'تغير مناخي', 'تسرب بترولي',
    # طوارئ طبية وإصابات (كلمات دلالية قوية)
    'مصرع', 'وفاة', 'إصابة', 'إصابات', 'حالات حرجة', 'اختناق', 'تسمم', 
    'نزيف', 'ضحايا', 'مفقودين', 'انتشال', 'جثة', 'جثث', 'جثمان', 'نقل للمستشفى',
    # مصطلحات أمنية وإغاثية (بتأكد إن في أزمة)
    'عاجل', 'طوارئ', 'إنقاذ', 'إسعاف', 'كارثة', 'استغاثة', 'إخلاء', 
    'تدخل سريع', 'فرق إغاثة', 'مخيم إيواء', 'قوافل طبية', 'حماية مدنية', 
    'طوق أمني', 'كردون أمني', 'النيابة العامة'
]

# 💡 التعديل التاني: توسيع المصادر
RSS_FEEDS = {
    "اليوم السابع": "https://www.youm7.com/rss/SectionRss?SectionID=203",
    "المصري اليوم": "https://www.almasryalyoum.com/rss/section/13",
    "صدى البلد": "https://www.elbalad.news/rss/3",
    "مصراوي": "https://www.masrawy.com/CrossDomain/News/RSS",
    "الشروق": "https://www.shorouknews.com/rss/accidents.xml",
    "بوابة الأهرام": "https://gate.ahram.org.eg/Rss/50/LatestNews.aspx",
    "الوطن": "https://www.elwatannews.com/home/rss",
    "فيتو": "https://www.vetogate.com/rss/2",
    "الدستور": "https://www.dostor.org/rss/section/5",
    "البوابة نيوز": "https://www.albawabhnews.com/rss/97",
    "الأسبوع": "https://www.elaosboa.com/rss/accidents/",
    "سكاي نيوز": "https://www.skynewsarabia.com/rss/مصر",
    "القاهرة 24": "https://www.cairo24.com/rss",
    "روسيا اليوم (مصر)": "https://arabic.rt.com/rss/egypt/"
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
    print(f"⚠️ فشل جلب الأخبار السابقة: {e}")

def analyze_news_with_ai(news_text):
    # 💡 التعديل التالت: إضافة تعليمات صريحة لحالات "غير مصنف" للذكاء الاصطناعي
    prompt = f"""
    أنت مساعد لغرفة عمليات EOC. استخرج البيانات التالية من هذا الخبر في صيغة JSON فقط بدون أي نصوص إضافية:
    الخبر: "{news_text}"

    - "incident_description": ملخص للحادث.
    - "news_type": تصنيف الحادث. (إذا كان حادثاً غريباً أو غير متأكد من تصنيفه الدقيق، اكتب "أخرى / غير مصنف").
    - "governorate": اسم المحافظة (إذا لم تذكر استنتجها أو اكتب "غير محدد").
    - "area_name": اسم المنطقة أو المركز.
    - "street_name": اسم الشارع أو الطريق.
    - "hospital_name": اسم المستشفى الذي نقل إليه المصابين.
    - "injured_count": المصابين (اكتب الرقم فقط، وإذا لم يوجد اكتب 0).
    - "deaths_count": الوفيات (اكتب الرقم فقط، وإذا لم يوجد اكتب 0).
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
        print("⚠️ المفاتيح السرية مفقودة!")
        return

    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🤖 بدء المسح الشامل العنيف...")
    
    now_utc = datetime.utcnow()

    for publisher, url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(url)
            # 💡 التعديل الرابع: إجباره يقرأ أول 50 خبر كاملين مش العدد الافتراضي
            for entry in feed.entries[:50]: 
                
                # 💡 التعديل الخامس: توسيع نافذة الوقت لـ ساعتين بدل ساعة لضمان اصطياد الأخبار المتأخرة
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
                
                full_text = f"{entry.title} - {entry.get('summary', '')}"
                
                # الكلمات المفتاحية الجديدة هتفلتر بصرامة
                if any(k in full_text for k in KEYWORDS):
                    print(f"🚨 حادث تم اصطياده: {entry.title}")
                    ai_data = analyze_news_with_ai(full_text)
                    
                    # 💡 التعديل السادس: سلة المجهول (لو Gemini فشل، ارفع الخبر برضه ببيانات مبدئية)
                    if not ai_data:
                        ai_data = {
                            "incident_description": entry.title,
                            "news_type": "أخرى / غير مصنف",
                            "governorate": "تحليل يدوي مطلوب",
                            "injured_count": "0",
                            "deaths_count": "0"
                        }

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
                        "news_updates": "تم الرصد آلياً بواسطة AI Scanner.",
                        "news_link": news_link,
                        "data_entry_name": "AI Robot"
                    }
                    
                    headers = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
                    res = requests.post(SYSTEM_API_URL, json=payload, headers=headers)
                    if res.status_code in [200, 201]: print("✅ تم الإرسال بنجاح للغرفة!")
                    
                    processed_news_links.add(news_link)
            time.sleep(2) # تقليل وقت الانتظار لسرعة المسح
        except Exception as e:
            print(f"❌ خطأ مسح {publisher}")
    print("✅ انتهت دورة المسح الشاملة بنجاح.")

if __name__ == '__main__':
    run_ai_scanner()