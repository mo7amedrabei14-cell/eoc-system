#!/usr/bin/env python3
"""Offline regression tests for configurable social-media intake."""
import os
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

import social_media_sources as S


class SocialMediaSourceTests(unittest.TestCase):
    def test_csv_environment_parsing(self):
        with patch.dict(os.environ, {"OSINT_TELEGRAM_CHANNELS": " channel_one, @channel_two ,, channel_three "}):
            self.assertEqual(S._csv("OSINT_TELEGRAM_CHANNELS"), ["channel_one", "channel_two", "channel_three"])

    def test_keyword_filter_is_case_insensitive(self):
        self.assertTrue(S._matches("Breaking report: FIRE in Cairo", ["fire"]))
        self.assertFalse(S._matches("routine traffic update", ["fire", "حادث"]))

    def test_article_shape_is_compatible_with_existing_ai_radar(self):
        item = S._article("title", "text", "https://example.com/post", "Telegram: @channel", "2026-10-13T10:00:00Z")
        self.assertEqual(item["title"], "title")
        self.assertEqual(item["link"], "https://example.com/post")
        self.assertEqual(item["publisher"], "Telegram: @channel")
        self.assertTrue(item["published_at"])
        self.assertEqual(item["platform"], "Telegram")

    def test_recent_filter_accepts_recent_iso_timestamp(self):
        value = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
        self.assertTrue(S._is_recent(value, 3))

    def test_recent_filter_rejects_old_iso_timestamp(self):
        value = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
        self.assertFalse(S._is_recent(value, 3))

    def test_telegram_adapter_extracts_public_channel_posts(self):
        now = datetime.now(timezone.utc).isoformat()
        html = f"""
        <div class="tgme_widget_message" data-post="erc_alerts/123">
          <div class="tgme_widget_message_text">حريق كبير في مخزن بالقاهرة وإصابات</div>
          <a class="tgme_widget_message_date"><time datetime="{now}"></time></a>
        </div>
        """
        class Response:
            ok = True
            status_code = 200
            text = html
        with patch.dict(os.environ, {"OSINT_TELEGRAM_CHANNELS": "erc_alerts"}):
            with patch.object(S, "_http_get", return_value=Response()):
                items = S._telegram(["حريق"], 3)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["link"], "https://t.me/erc_alerts/123")
        self.assertIn("حريق", items[0]["text"])


    def test_extra_social_rss_feed_is_configurable(self):
        now = datetime.now(timezone.utc).isoformat()
        class Entry:
            title = "حريق كبير في القاهرة"
            summary = "بلاغ حريق وإصابات"
            link = "https://social-feed.example/post/123"
            published = now
        class Feed:
            entries = [Entry()]
        class Response:
            ok = True
            status_code = 200
            content = b"<rss></rss>"
        config = "Public Telegram mirror::https://feeds.example/telegram.xml"
        with patch.dict(os.environ, {"OSINT_EXTRA_SOCIAL_FEEDS": config}):
            with patch.object(S, "_http_get", return_value=Response()):
                with patch.object(S.feedparser, "parse", return_value=Feed()):
                    items = S._extra_social_rss(["حريق"], 3)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["publisher"], "Social RSS: Public Telegram mirror")
        self.assertEqual(items[0]["link"], Entry.link)

    def test_unconfigured_authenticated_sources_are_skipped(self):
        names = (
            "X_API_BEARER_TOKEN", "META_ACCESS_TOKEN", "META_FACEBOOK_PAGE_IDS",
            "META_INSTAGRAM_USER_IDS", "REDDIT_ACCESS_TOKEN", "REDDIT_CLIENT_ID",
            "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD",
            "OSINT_REDDIT_SUBREDDITS",
        )
        clean_env = {name: "" for name in names}
        with patch.dict(os.environ, clean_env, clear=False):
            self.assertEqual(S._x(["حريق"], 3), [])
            self.assertEqual(S._facebook(["حريق"], 3), [])
            self.assertEqual(S._instagram(["حريق"], 3), [])
            self.assertEqual(S._reddit(["حريق"], 3), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
