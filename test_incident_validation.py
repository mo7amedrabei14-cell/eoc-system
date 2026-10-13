import unittest

from incident_validation import validate_incident, is_probable_real_incident


class IncidentValidationTests(unittest.TestCase):
    def test_rejects_explicit_literary_social_post(self):
        article = {
            "title": "حريق الذكريات",
            "text": "نص أدبي/شاعري نشر على وسائل التواصل الاجتماعي ولا يمثل أي حادث أمني أو طارئ حقيقي.",
        }
        accepted, reason = validate_incident(article)
        self.assertFalse(accepted)
        self.assertIn("أدبي", reason)

    def test_rejects_metaphorical_fire_without_real_world_context(self):
        article = {
            "title": "حريق في قلبي",
            "text": "حريق في قلبي لا يطفئه إلا رجوعك والحنين يزلزل روحي.",
        }
        self.assertFalse(is_probable_real_incident(article))

    def test_accepts_concrete_fire_report(self):
        article = {
            "title": "اندلاع حريق في مخزن أخشاب بالقاهرة",
            "text": "اندلع حريق داخل مخزن أخشاب في القاهرة، وانتقلت الحماية المدنية وتم الدفع بسيارات الإطفاء.",
        }
        self.assertTrue(is_probable_real_incident(article))

    def test_accepts_concrete_traffic_report(self):
        article = {
            "title": "انقلاب ميكروباص على طريق المنيا",
            "text": "وقع حادث انقلاب ميكروباص على الطريق الزراعي بالمنيا وأسفر عن إصابة 4 أشخاص وتم نقل المصابين للمستشفى.",
        }
        self.assertTrue(is_probable_real_incident(article))

    def test_accepts_concrete_building_collapse(self):
        article = {
            "title": "انهيار عقار في الإسكندرية",
            "text": "شهدت منطقة سيدي بشر انهيار عقار وانتقلت قوات الحماية المدنية لرفع الأنقاض.",
        }
        self.assertTrue(is_probable_real_incident(article))

    def test_ambiguous_paid_candidate_requires_explicit_ai_confirmation(self):
        article = {
            "title": "بلاغ",
            "text": "حادث",
            "_requires_ai_confirmation": True,
        }
        self.assertFalse(is_probable_real_incident(article))
        self.assertTrue(is_probable_real_incident(article, {"is_real_incident": True}))
        self.assertFalse(is_probable_real_incident(article, {"is_real_incident": False}))

    def test_rejects_ai_false_verdict_even_if_keywords_exist(self):
        article = {
            "title": "حريق في مخزن بالقاهرة",
            "text": "حريق في مخزن بالقاهرة",
        }
        accepted, reason = validate_incident(article, {"is_real_incident": False})
        self.assertFalse(accepted)
        self.assertIn("الذكاء الاصطناعي", reason)

    def test_rejects_ai_description_that_identifies_literary_content(self):
        article = {
            "title": "كلمات فيها حريق",
            "text": "الحياة حريق لا ينتهي والقلوب رماد.",
        }
        ai_data = {
            "incident_description": "نص أدبي/شاعري ولا يمثل أي حادث أمني أو طارئ حقيقي",
            "news_type": "غير مؤهل",
        }
        self.assertFalse(is_probable_real_incident(article, ai_data))


if __name__ == "__main__":
    unittest.main(verbosity=2)
