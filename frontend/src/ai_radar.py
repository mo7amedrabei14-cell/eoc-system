import feedparser
import requests
import time
import schedule
import json
import google.generativeai as genai
from datetime import datetime

# ==========================================
# 1. إعدادات النظام والربط (Configurations)
# ==========================================
# 🚨 حط مفتاح الـ API بتاع Gemini هنا
GEMINI_API_KEY = "حط_مفتاح_جيميني_هنا" 

# رابط السيرفر بتاعك اللي هيستقبل الداتا
SYSTEM_API_URL = "https://eoc-system.vercel.app/api/ai-news" 

# 🚨 حط التوكن بتاع حسابك الإداري عشان السيرفر يقبل الأخبار
SYSTEM_TOKEN = "التوكن_بتاع_حسابك_الاداري_هنا" 

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-1.5-flash')

# ==========================================
# 2. الكلمات المفتاحية الشاملة (الرادار)
# ==========================================
KEYWORDS = [
    'حريق', 'حرائق', 'انهيار', 'سقوط مبنى', 'تصادم', 'انقلاب', 'غرق', 'تسرب غاز', 
    'تسرب كيميائي', 'تسمم', 'انفجار', 'سيول', 'فيضانات', 'زلزال', 'هزة أرضية', 
    'مصرع', 'وفاة', 'إصابة', 'تفحم', 'اشتعال', 'دهس', 'اختناق', 'عاجل', 
    'طوارئ', 'إنقاذ', 'إسعاف', 'كارثة', 'تدافع', 'خروج قطار'
]

# ==========================================
# 3. شبكة المصادر الإخبارية (RSS Feeds)
# ==========================================
RSS_FEEDS = {
    "اليوم السابع (حوادث)": "https://www.youm7.com/rss/SectionRss?SectionID=203",
    "المصري اليوم (حوادث)": "https://www.almasryalyoum.com/rss/section/13",
    "صدى البلد (حوادث)": "https://www.elbalad.news/rss/3",
    "مصراوي (حوادث)": "https://www.masrawy.com/CrossDomain/News/RSS",
    "الشروق (حوادث)": "https://www.shorouknews.com/rss/accidents.xml",
    "بوابة الأهرام (حوادث)": "https://gate.ahram.org.eg/Rss/50/LatestNews.aspx",
    "الوطن (حوادث)": "https://www.elwatannews.com/home/rss"
}

# ذاكرة عشان الروبوت ميبعتش نفس الخبر مرتين للغرفة
processed_news_links = set()

# ==========================================
# 4. عقل الذكاء الاصطناعي (تحليل الخبر)
# ==========================================
def analyze_news_with_ai(news_text):
    prompt = f"""
    أنت مساعد ذكي لغرفة عمليات طوارئ (EOC) في مصر. قم بقراءة هذا الخبر واستخراج البيانات التالية في صيغة JSON فقط وبدون أي نصوص إضافية:
    الخبر: "{news_text}"

    المفاتيح المطلوبة في الـ JSON:
    - "incident_description": ملخص للحادث في جملة واحدة.
    - "news_type": اختر تصنيفاً واحداً فقط يطابق الخبر من هذه القائمة (حادث تصادم سيارات, حادث غرق سفينة, حادث تصادم قطارات, حادث انقلاب قطار, حادث انقلاب سيارة, حادث فقدان أشخاص في البحر, حادث تصادم سفن, انهيار مبنى تجاري, حريق مبنى سكني, حريق مبنى تجاري, حريق مبنى صناعي, حادث انفجار, انهيار مبنى صناعي, انهيار ارضي, حريق منطقة زراعية, حادث تسرب مواد كيميائية أو غازات سامة, سيول, فيضانات, امطار غزيرة, زلزال, انهيار مبنى سكني, حادث دهس اشخاص, حريق مبنى طبي, انهيار مبنى طبي, حريق مخزن, حريق مزرعة, حريق سيارة, حريق مبنى ديني, حريق مبنى تعليمي, حادث تدافع, حريق مبنى رياضي, حريق قطار, حادث تصادم سيارة بقطار, حادث تسمم, حريق مبنى حكومي, انهيار مبنى حكومي, انهيار مبنى ديني). إذا لم تجد تطابقاً دقيقاً، اختر أقرب وصف منطقي.
    - "governorate": اسم المحافظة المصرية التي وقع بها الحادث (يجب أن يكون اسم المحافظة فقط مثل: القاهرة, الإسكندرية, الدقهلية). إذا لم تذكر، اكتب "غير محدد".
    - "area_name": اسم المنطقة أو المركز (مثل: شبرا، مدينة نصر، طلخا). إذا لم يذكر اكتب "".
    - "street_name": اسم الشارع أو الطريق (مثل: الدائري، الزراعي). إذا لم يذكر اكتب "".
    - "hospital_name": اسم المستشفى التي تم نقل المصابين/الجثامين إليها. إذا لم يذكر اكتب "".
    - "injured_count": عدد المصابين (رقم فقط). إذا لم يذكر اكتب "0".
    - "deaths_count": عدد الوفيات (رقم فقط). إذا لم يذكر اكتب "0".

    تأكد أن المخرجات هي Valid JSON format فقط.
    """
    try:
        response = model.generate_content(prompt)
        # تنظيف الرد لضمان أنه JSON سليم
        clean_json = response.text.replace('```json', '').replace('```', '').strip()
        return json.loads(clean_json)
    except Exception as e:
        print(f"❌ خطأ في معالجة الذكاء الاصطناعي: {e}")
        return None

# ==========================================
# 5. محرك البحث والإرسال للسيستم
# ==========================================
def run_ai_scanner():
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🤖 بدء جولة مسح جديدة عبر المواقع الإخبارية...")
    
    for publisher, url in RSS_FEEDS.items():
        try:
            feed = feedparser.parse(url)
            # هنبص على أحدث 5 أخبار نزلت في كل موقع
            for entry in feed.entries[:5]:
                news_link = entry.link
                
                # لو الخبر في الذاكرة، نتجاوزه
                if news_link in processed_news_links:
                    continue
                
                news_title = entry.title
                news_summary = entry.get('summary', '')
                full_text = f"{news_title} - {news_summary}"
                
                # الفلترة المبدئية: هل الخبر يحتوي على كلمة من الرادار؟
                if any(keyword in full_text for keyword in KEYWORDS):
                    print(f"⚠️ تم التقاط حادث محتمل من ({publisher}): {news_title}")
                    
                    # إرسال للـ AI لتحليل التفاصيل
                    ai_data = analyze_news_with_ai(full_text)
                    
                    if ai_data:
                        payload = {
                            "incident_date": datetime.now().strftime("%Y-%m-%d"),
                            "incident_description": ai_data.get("incident_description", news_title),
                            "news_type": ai_data.get("news_type", "غير محدد"),
                            "news_publisher": publisher,
                            "street_name": ai_data.get("street_name", ""),
                            "area_name": ai_data.get("area_name", ""),
                            "governorate": ai_data.get("governorate", "القاهرة"),
                            "hospital_name": ai_data.get("hospital_name", ""),
                            "injured_count": str(ai_data.get("injured_count", "0")),
                            "deaths_count": str(ai_data.get("deaths_count", "0")),
                            "news_updates": "تم الرصد والتحليل آلياً بواسطة محرك الذكاء الاصطناعي (AI Scanner).",
                            "news_link": news_link,
                            "data_entry_name": "AI Robot"
                        }
                        
                        # إرسال البيانات لقاعدة بيانات الغرفة المركزية
                        headers = {"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"}
                        api_res = requests.post(SYSTEM_API_URL, json=payload, headers=headers)
                        
                        if api_res.status_code in [200, 201]:
                            print(f"✅ تم الإرسال للغرفة المركزية بنجاح! ({ai_data.get('governorate')})")
                        else:
                            print(f"❌ فشل الإرسال للسيستم: {api_res.text}")
                    
                    # حفظ اللينك في الذاكرة عشان ميتكررش
                    processed_news_links.add(news_link)
                    
        except Exception as e:
            print(f"❌ خطأ أثناء مسح {publisher}: {e}")

# ==========================================
# 6. التشغيل المستمر (الجدولة)
# ==========================================
# هيعمل مسح لكل المواقع كل 10 دقايق
schedule.every(10).minutes.do(run_ai_scanner)

print("🚀 محرك الذكاء الاصطناعي (AI Radar) يعمل الآن... سيقوم بالمسح كل 10 دقائق.")
run_ai_scanner() # تشغيل أول مرة فوراً

while True:
    schedule.run_pending()
    time.sleep(1)