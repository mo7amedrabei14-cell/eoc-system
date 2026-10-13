#!/usr/bin/env python3
"""Offline regression tests for multi-layer AI radar duplicate protection."""
import unittest

from ai_news_dedupe import canonicalize_url, deduplicate_articles, duplicate_reason, normalize_title


class AINewsDedupeTests(unittest.TestCase):
    def test_canonical_url_drops_tracking_and_fragment(self):
        self.assertEqual(
            canonicalize_url("https://www.Example.com/story/?utm_source=telegram&id=42#comments"),
            "https://example.com/story?id=42",
        )

    def test_arabic_title_normalization_removes_diacritics_and_variant_alef(self):
        self.assertEqual(normalize_title("أَخبَارُ الحَادِث"), normalize_title("اخبار الحادث"))

    def test_same_canonical_url_is_duplicate_even_if_title_changed(self):
        self.assertEqual(
            duplicate_reason(
                {"title": "خبر جديد", "link": "https://www.example.com/story?utm_medium=x"},
                {"incident_description": "ملخص آخر", "news_link": "https://example.com/story"},
            ),
            "canonical_url",
        )

    def test_exact_title_within_two_days_is_duplicate(self):
        self.assertEqual(
            duplicate_reason(
                {"title": "حادث تصادم ميكروباص على طريق القاهرة أسوان وإصابة 10 أشخاص",
                 "link": "https://example.com/a", "published_at": "2026-10-13T10:00:00Z"},
                {"incident_description": "حادث تصادم ميكروباص على طريق القاهرة أسوان وإصابة 10 أشخاص",
                 "news_link": "https://example.com/b", "observed_at": "2026-10-13T11:00:00Z"},
            ),
            "exact_title",
        )

    def test_near_identical_title_with_recent_timestamps_is_duplicate(self):
        reason = duplicate_reason(
            {"title": "حادث تصادم ميكروباص على طريق القاهرة أسوان وإصابة 10 أشخاص",
             "link": "https://example.com/a", "published_at": "2026-10-13T10:00:00Z"},
            {"title": "حادث تصادم ميكروباص على طريق القاهرة-أسوان وإصابة 10 أشخاص",
             "link": "https://example.com/b", "published_at": "2026-10-13T10:30:00Z"},
        )
        self.assertIn(reason, ("exact_title", "similar_title"))

    def test_identical_article_body_detected_even_with_different_titles(self):
        body = ("وقع الحادث صباح اليوم على الطريق الصحراوي وتم الدفع بقوات الحماية المدنية والإسعاف. " * 3)
        self.assertEqual(
            duplicate_reason(
                {"title": "بلاغ عاجل عن حادث", "text": body, "link": "https://example.com/a",
                 "published_at": "2026-10-13T10:00:00Z"},
                {"title": "تفاصيل الحادث بالطريق الصحراوي", "text": body, "link": "https://example.com/b",
                 "published_at": "2026-10-13T10:05:00Z"},
            ),
            "identical_body",
        )

    def test_deduplicates_within_batch_and_against_database_records(self):
        old = {"incident_description": "حريق كبير بمخزن أخشاب في شبرا الخيمة تسبب في إصابات",
               "news_link": "https://news.example/old", "observed_at": "2026-10-13T10:00:00Z"}
        candidates = [
            {"title": "حريق كبير بمخزن أخشاب في شبرا الخيمة تسبب في إصابات",
             "link": "https://news.example/new", "published_at": "2026-10-13T10:30:00Z"},
            {"title": "حريق كبير بمخزن أخشاب في شبرا الخيمة تسبب في إصابات",
             "link": "https://news.example/copy", "published_at": "2026-10-13T10:31:00Z"},
            {"title": "زلزال في دولة أخرى بقوة 5 درجات", "link": "https://news.example/quake",
             "published_at": "2026-10-13T10:32:00Z"},
        ]
        unique, stats = deduplicate_articles(candidates, [old])
        self.assertEqual(len(unique), 1)
        self.assertEqual(unique[0]["link"], "https://news.example/quake")
        self.assertEqual(stats["duplicates"], 2)
        self.assertEqual(stats["unique"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
