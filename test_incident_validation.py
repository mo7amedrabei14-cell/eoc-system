import unittest

from incident_validation import validate_incident, is_probable_real_incident
from unittest.mock import patch
import ai_radar as R


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
            "title": "خبر عاجل",
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

    def test_send_report_does_not_write_explicit_non_incident(self):
        article = {
            "title": "حريق الذكريات",
            "text": "نص أدبي/شاعري نشر على وسائل التواصل الاجتماعي ولا يمثل أي حادث أمني أو طارئ حقيقي.",
            "link": "https://facebook.com/posts/literary-example",
            "publisher": "Facebook: test",
        }
        before = R.send_stats.get("rejected", 0)
        with patch.object(R.requests, "post") as post:
            result = R.send_report(article, {"is_real_incident": False})
        self.assertFalse(result)
        post.assert_not_called()
        self.assertEqual(R.send_stats.get("rejected", 0), before + 1)

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



    def test_accepts_incident_with_arabic_cause_verb_and_global_location(self):
        article = {
            "title": "كلب أعمى يتسبب في حريق هائل بأمريكا",
            "text": "كلب أعمى يتسبب في حريق هائل بأمريكا.",
        }
        accepted, reason = validate_incident(article)
        self.assertTrue(accepted, reason)

    def test_accepts_incident_report_using_noun_form_and_non_egyptian_location(self):
        article = {
            "title": "اندلاع حريق في ناقلة نفط شرق مضيق هرمز",
            "text": "أفادت تقارير باندلاع حريق في ناقلة نفط شرق مضيق هرمز.",
        }
        accepted, reason = validate_incident(article)
        self.assertTrue(accepted, reason)

if __name__ == "__main__":
    unittest.main(verbosity=2)
