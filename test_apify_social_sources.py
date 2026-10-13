"""Offline tests for Apify freshness, mapping, and durable result-budget guards."""
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import apify_social_sources as S


class ApifySocialSourceTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)

    def _state(self):
        return S._new_budget_state(self.now)

    def _post(self, minutes_ago=10, platform="Facebook"):
        published = (self.now - timedelta(minutes=minutes_ago)).isoformat()
        if platform == "Instagram":
            return {
                "caption": "حريق كبير في مخزن بالقاهرة وإصابات",
                "url": "https://www.instagram.com/p/example/",
                "timestamp": published,
                "username": "example_page",
            }
        return {
            "message": "حريق كبير في مخزن بالقاهرة وإصابات",
            "url": "https://www.facebook.com/posts/example",
            "published_at": published,
            "author": {"name": "Example Page"},
        }

    def test_strict_freshness_accepts_under_thirty_minutes(self):
        stamp = self.now - timedelta(minutes=29)
        self.assertTrue(S.is_recent_publication(stamp.isoformat(), 30, self.now))

    def test_strict_freshness_rejects_over_thirty_minutes(self):
        stamp = self.now - timedelta(minutes=31)
        self.assertFalse(S.is_recent_publication(stamp.isoformat(), 30, self.now))

    def test_missing_or_invalid_timestamp_is_not_assumed_recent(self):
        self.assertFalse(S.is_recent_publication(None, 30, self.now))
        self.assertFalse(S.is_recent_publication("not-a-date", 30, self.now))

    def test_article_normalization_supports_facebook_and_instagram_fields(self):
        fb = S._article_from_post(self._post(10, "Facebook"), "Facebook", ["حريق"], 30, self.now)
        ig = S._article_from_post(self._post(15, "Instagram"), "Instagram", ["حريق"], 30, self.now)
        self.assertEqual(fb["publisher"], "Facebook: Example Page")
        self.assertEqual(ig["publisher"], "Instagram: example_page")
        self.assertEqual(fb["link"], "https://www.facebook.com/posts/example")
        self.assertEqual(ig["link"], "https://www.instagram.com/p/example/")

    def test_existing_budget_store_is_reused_without_creating_another(self):
        class Response:
            ok = True
            status_code = 200
            def json(self):
                return {"data": {"items": [
                    {"id": "existing-store-id", "name": S.BUDGET_STORE_NAME}
                ]}}
        with patch.object(S.requests, "get", return_value=Response()) as get:
            with patch.object(S.requests, "post") as post:
                self.assertEqual(S._get_or_create_budget_store("test-token"), "existing-store-id")
                get.assert_called_once()
                post.assert_not_called()

    def test_budget_store_is_created_only_when_none_exists(self):
        class EmptyResponse:
            ok = True
            status_code = 200
            def json(self):
                return {"data": {"items": []}}
        class CreatedResponse:
            ok = True
            status_code = 201
            def json(self):
                return {"data": {"id": "new-store-id"}}
        with patch.object(S.requests, "get", return_value=EmptyResponse()) as get:
            with patch.object(S.requests, "post", return_value=CreatedResponse()) as post:
                self.assertEqual(S._get_or_create_budget_store("test-token"), "new-store-id")
                get.assert_called_once()
                post.assert_called_once()

    def test_no_token_disables_apify_without_network_calls(self):
        with patch.dict(os.environ, {"APIFY_API_TOKEN": ""}, clear=False):
            with patch.object(S, "_get_or_create_budget_store") as store:
                self.assertEqual(S.fetch_apify_social_articles(["حريق"], now=self.now), [])
                store.assert_not_called()

    def test_success_uses_one_result_slot_and_persists_the_count(self):
        state = self._state()
        writes = []
        with patch.dict(os.environ, {"APIFY_API_TOKEN": "test-token", "APIFY_DAILY_RESULT_CAP": "50", "APIFY_MONTHLY_RESULT_CAP": "1000"}, clear=False):
            with patch.object(S, "_get_or_create_budget_store", return_value="store-id"):
                with patch.object(S, "_read_budget", return_value=state):
                    with patch.object(S, "_save_budget", side_effect=lambda store, token, value: writes.append(dict(value)) or True):
                        with patch.object(S, "_actor_request", return_value=([self._post(10, "Facebook")], "ok")) as actor:
                            rows = S.fetch_apify_social_articles(["حريق"], now=self.now)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["platform"], "Facebook")
        self.assertEqual(writes[-1]["daily_used"], 1)
        self.assertEqual(writes[-1]["monthly_used"], 1)
        self.assertTrue(writes[-1]["slot_consumed"])
        actor.assert_called_once()
        self.assertGreaterEqual(len(writes), 2)

    def test_stale_result_is_charged_conservatively_but_never_forwarded(self):
        state = self._state()
        writes = []
        with patch.dict(os.environ, {"APIFY_API_TOKEN": "test-token"}, clear=False):
            with patch.object(S, "_get_or_create_budget_store", return_value="store-id"):
                with patch.object(S, "_read_budget", return_value=state):
                    with patch.object(S, "_save_budget", side_effect=lambda store, token, value: writes.append(dict(value)) or True):
                        with patch.object(S, "_actor_request", return_value=([self._post(31, "Facebook")], "ok")) as actor:
                            rows = S.fetch_apify_social_articles(["حريق"], now=self.now)
        self.assertEqual(rows, [])
        self.assertEqual(writes[-1]["monthly_used"], 1)
        self.assertTrue(writes[-1]["slot_consumed"])
        actor.assert_called_once()

    def test_empty_first_platform_falls_back_to_second_within_same_slot(self):
        state = self._state()
        writes = []
        with patch.dict(os.environ, {"APIFY_API_TOKEN": "test-token"}, clear=False):
            with patch.object(S, "_get_or_create_budget_store", return_value="store-id"):
                with patch.object(S, "_read_budget", return_value=state):
                    with patch.object(S, "_save_budget", side_effect=lambda store, token, value: writes.append(dict(value)) or True):
                        with patch.object(
                            S, "_actor_request",
                            side_effect=[([], "ok"), ([self._post(5, "Instagram")], "ok")],
                        ) as actor:
                            rows = S.fetch_apify_social_articles(["حريق"], now=self.now)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["platform"], "Instagram")
        self.assertEqual(writes[-1]["daily_used"], 1)
        self.assertEqual(writes[-1]["monthly_used"], 1)
        self.assertTrue(writes[-1]["slot_consumed"])
        self.assertEqual(actor.call_count, 2)

    def test_search_payload_uses_high_signal_queries_not_generic_fire_keyword(self):
        payload = S._actor_payload("Facebook", ["حريق"])
        self.assertTrue(payload["mustContainQuery"])
        self.assertIn("حريق منزل", payload["searchQueries"])
        self.assertIn("انقلاب سيارة", payload["searchQueries"])
        self.assertNotIn("حريق", payload["searchQueries"])

    def test_apify_rejects_literary_post_even_if_it_contains_incident_words(self):
        post = self._post(10, "Facebook")
        post["message"] = "نص أدبي/شاعري نشر على وسائل التواصل الاجتماعي ولا يمثل أي حادث أمني أو طارئ حقيقي. حريق الذكريات."
        article = S._article_from_post(post, "Facebook", ["حريق"], 30, self.now)
        self.assertIsNone(article)

    def test_apify_routes_ambiguous_paid_incident_to_ai_confirmation(self):
        post = self._post(10, "Facebook")
        post["message"] = "حادث"
        article = S._article_from_post(post, "Facebook", ["حادث"], 30, self.now)
        self.assertIsNotNone(article)
        self.assertTrue(article.get("_requires_ai_confirmation"))

    def test_monthly_or_daily_cap_blocks_actor_calls(self):
        state = self._state()
        state["daily_used"] = 50
        with patch.dict(os.environ, {"APIFY_API_TOKEN": "test-token", "APIFY_DAILY_RESULT_CAP": "50"}, clear=False):
            with patch.object(S, "_get_or_create_budget_store", return_value="store-id"):
                with patch.object(S, "_read_budget", return_value=state):
                    with patch.object(S, "_save_budget", return_value=True):
                        with patch.object(S, "_actor_request") as actor:
                            rows = S.fetch_apify_social_articles(["حريق"], now=self.now)
        self.assertEqual(rows, [])
        actor.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
