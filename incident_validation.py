"""Conservative pre-filter for real-world emergency incident reports.

This module is deliberately deterministic and has no network/model dependency.
It rejects explicit literary/fictional posts and accepts only incident language
with concrete reporting, responder, casualty, or physical-location context.
"""
import re
import unicodedata


_TRANSLATION = str.maketrans({
    "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا",
    "ى": "ي", "ؤ": "و", "ئ": "ي",
})

_EXPLICIT_NON_NEWS = (
    re.compile(r"\b(?:نص|منشور|كلام)\s*(?:ادبي|شعري|شاعري)\b"),
    re.compile(r"\b(?:قصيده|قصائد|ابيات شعر|خواطر ادبيه|نص شعري|نص ادبي)\b"),
    re.compile(r"(?:لا يمثل|لا تمثل|لا يتضمن|ليس|ليست|لم يقع|لم يحدث).{0,65}(?:حادث|واقعه|طارئ|حدث امني|حدث حقيقي)"),
    re.compile(r"\b(?:غير حقيقي|غير واقعي|خيالي|خياليه|مجازي|مجازيه|تمثيلي|مشهد تمثيلي)\b"),
    re.compile(r"\b(?:fictional|fiction|poem|poetry|literary text|creative writing|metaphorical|parody)\b"),
)

_METAPHORICAL_LANGUAGE = re.compile(
    r"\b(?:قلبي|قلوبنا|مشاعري|مشاعرنا|العشق|الغرام|حبيبي|حبيبتي|الفراق|الحنين|"
    r"شوقي|دموعي|ذكرياتي|الذكريات|روحي|خواطري|احلامي|حياتي|ليلي|الخيال|"
    r"وجعي|الم الفراق|نار الحب|حريق المشاعر|زلزال المشاعر)\b"
)

_INCIDENT_TERMS = re.compile(
    r"\b(?:حادث|حوادث|تصادم|اصطدام|انقلاب|دهس|صدم|قطار|حريق|حرائق|نيران|"
    r"اندلاع|نشوب|احتراق|انفجار|تفجير|تسرب غاز|تسرب كيميائي|انهيار|سقوط عقار|"
    r"سقوط مبنى|هبوط ارضي|سيول|فيضانات|فيضان|زلزال|هزه ارضيه|غرق|غرق مركب|"
    r"انتشال|انقاذ|اختناق|تسمم|مصرع|قتيل|قتلي|وفيات|اصابات|مصابين|جرحي|"
    r"اشتباكات|اطلاق نار|اطلاق الرصاص|قصف|غاره|انهيار ارضي|اعصار|كارثه|"
    r"بلاغ امني|حدث امني)\b"
)

_REPORTING_OR_RESPONSE = re.compile(
    r"\b(?:وقع|وقوع|شهدت|شهد|اندلع|نشب|اسفر|اسفرت|تسبب|تسببت|ادي الي|ادت الي|"
    r"اصيب|اصابة|اصابات|لقي مصرعه|لقي مصرعها|مصرع|انتقلت|انتقل|دفعت|الدفع ب|"
    r"تم نقل|نقل المصابين|الحمايه المدنيه|سيارات الاطفاء|الاطفاء|الاسعاف|"
    r"فرق الانقاذ|قوات الانقاذ|اخماد|السيطره علي|انقذ|انتشال|تلقى بلاغ|تلقت بلاغا|"
    r"اغلاق الطريق|اخلاء|بيان رسمي|اعلنت وزاره|اعلنت الشرطه|تحطم|انقلبت|"
    r"اصطدمت|تصادمت|انفجرت|سجلت|جرى نقل|تمكنت|باشرت|بلاغ|بلاغات)\b"
)

_PHYSICAL_CONTEXT = re.compile(
    r"\b(?:شارع|طريق|محور|كوبري|قرية|قريه|مدينة|مدينه|محافظة|محافظه|مركز|حي|"
    r"منزل|شقة|شقه|عقار|مبنى|مبني|برج|مصنع|مخزن|مستودع|مستشفى|مدرسة|مدرسه|"
    r"جامعة|جامعه|كنيسة|كنيسه|مسجد|محطة|محطه|سوق|ورشة|ورشه|مزرعة|مزرعه|"
    r"فندق|مطعم|ميناء|مطار|نهر|بحر|ترعة|ترعه|ساحل|صحراء|مركب|سيارة|سياره|"
    r"ميكروباص|حافلة|حافله|شاحنة|شاحنه|قطار|كردون|موقع الحادث|موقع الحريق)\b"
)

_KNOWN_EGYPTIAN_PLACES = re.compile(
    r"\b(?:مصر|القاهره|الجيزه|الاسكندريه|المنيا|اسيوط|سوهاج|قنا|الاقصر|اسوان|"
    r"الفيوم|القليوبيه|الشرقيه|الغربيه|الدقهليه|البحيره|دمياط|مطروح|بورسعيد|"
    r"السويس|الاسماعيليه|شمال سيناء|جنوب سيناء|بني سويف|كفر الشيخ|المنوفيه|"
    r"العريش|شرم الشيخ|الغردقه|طنطا|المنصوره|بنها|ملوي|سمالوط|شبرا الخيمه|"
    r"المحله الكبري|العاشر من رمضان|السادس من اكتوبر|6 اكتوبر)\b"
)


def normalize_incident_text(value):
    """Normalize Arabic spelling/punctuation for rule matching without translating meaning."""
    text = str(value or "").translate(_TRANSLATION).replace("ـ", "")
    text = "".join(
        char for char in text
        if unicodedata.category(char) not in ("Mn", "Me", "Cf")
    )
    text = text.casefold()
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _value_is_false(value):
    if value is False or value == 0:
        return True
    if isinstance(value, str):
        normalized = normalize_incident_text(value)
        return normalized in {
            "false", "no", "0", "لا", "كلا", "غير حقيقي",
            "ليس حادثا", "ليس حادث", "لا يمثل حادثا", "لا يمثل حادث",
        }
    return False


def _source_text(article):
    if not isinstance(article, dict):
        return ""
    values = []
    for key in ("title", "text", "summary", "content", "selftext", "description"):
        value = article.get(key)
        if value:
            values.append(str(value))
    return normalize_incident_text(" ".join(values))


def validate_incident(article, ai_data=None):
    """Return (accepted, reason); fail closed for literary/figurative/non-event content."""
    if not isinstance(article, dict):
        return False, "بيانات المنشور غير صالحة"

    if isinstance(ai_data, dict):
        for key in ("is_real_incident", "is_incident", "actual_event", "incident_confirmed"):
            if key in ai_data and _value_is_false(ai_data.get(key)):
                return False, "تحليل الذكاء الاصطناعي استبعد كونه حادثًا فعليًا"
        ai_text = normalize_incident_text(" ".join(
            str(ai_data.get(key) or "")
            for key in ("incident_description", "news_type", "rejection_reason", "validation_reason")
        ))
    else:
        ai_text = ""

    source_text = _source_text(article)
    for pattern in _EXPLICIT_NON_NEWS:
        if pattern.search(source_text) or pattern.search(ai_text):
            return False, "محتوى أدبي/خيالي أو تصريح صريح بأنه لا يمثل حادثًا"
    if not source_text:
        return False, "نص المنشور فارغ"

    if not _INCIDENT_TERMS.search(source_text):
        return False, "لا توجد دلالة واضحة على نوع حادث أو طارئ"
    if _METAPHORICAL_LANGUAGE.search(source_text) and not _REPORTING_OR_RESPONSE.search(source_text):
        return False, "صياغة مجازية/وجدانية دون قرائن بلاغ عن واقعة"
    has_reporting = bool(_REPORTING_OR_RESPONSE.search(source_text))
    has_place = bool(_PHYSICAL_CONTEXT.search(source_text) or _KNOWN_EGYPTIAN_PLACES.search(source_text))
    if not has_reporting and not has_place:
        # If an Apify result has already consumed a billable result slot, do not
        # silently discard an otherwise incident-shaped ambiguous post. Route it
        # to Gemini, and allow delivery only on an explicit positive verdict.
        if (
            article.get("_requires_ai_confirmation")
            and isinstance(ai_data, dict)
            and ai_data.get("is_real_incident") is True
        ):
            return True, "أكد Gemini أن نتيجة المصدر المدفوعة تصف واقعة فعلية"
        return False, "لا توجد قرائن واقعية كافية: مكان محدد أو فعل إخباري/استجابة طوارئ"

    return True, "اجتاز فحص الواقعة الفعلية الأولي"


def is_ai_confirmation_candidate(article):
    """True only for ambiguous incident-shaped text eligible for a paid-result AI check."""
    if not isinstance(article, dict):
        return False
    source_text = _source_text(article)
    if not source_text:
        return False
    if any(pattern.search(source_text) for pattern in _EXPLICIT_NON_NEWS):
        return False
    if not _INCIDENT_TERMS.search(source_text):
        return False
    if _METAPHORICAL_LANGUAGE.search(source_text) and not _REPORTING_OR_RESPONSE.search(source_text):
        return False
    return True


def is_probable_real_incident(article, ai_data=None):
    """Boolean convenience wrapper used by collection and delivery guards."""
    return validate_incident(article, ai_data)[0]
