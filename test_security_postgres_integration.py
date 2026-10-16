"""PostgreSQL integration tests for security stores against an ephemeral test database.

CI supplies a disposable PostgreSQL service and EOC_TEST_DATABASE_URL. Tests isolate
all objects in a random schema and drop that schema after the run; no application or
production credentials are read.
"""
from __future__ import annotations

import json
import os
import unittest
import uuid

import psycopg

import idempotency as idempotency_store
import security_limits as login_store


TEST_DSN = os.environ.get("EOC_TEST_DATABASE_URL")


@unittest.skipUnless(TEST_DSN, "requires the ephemeral PostgreSQL service configured in CI")
class SecurityPostgresIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not TEST_DSN:
            raise unittest.SkipTest("EOC_TEST_DATABASE_URL not configured")

        cls.schema = "eoc_security_test_" + uuid.uuid4().hex
        with psycopg.connect(TEST_DSN) as connection:
            connection.execute(f'CREATE SCHEMA "{cls.schema}"')
            connection.commit()

        idempotency_store._SCHEMA_READY = False
        login_store._SCHEMA_READY = False
        if not idempotency_store.ensure_scoped_idempotency_schema(cls.connect_db):
            raise RuntimeError("could not create isolated idempotency table")
        if not login_store.ensure_login_rate_limit_schema(cls.connect_db):
            raise RuntimeError("could not create isolated login throttling table")

        with cls.connect_db() as connection:
            connection.execute(
                """
                CREATE TABLE idempotency_keys (
                    idempotency_key VARCHAR(255) PRIMARY KEY,
                    response JSONB,
                    original_status INTEGER,
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            connection.commit()

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, "schema", None) and TEST_DSN:
            with psycopg.connect(TEST_DSN) as connection:
                connection.execute(f'DROP SCHEMA IF EXISTS "{cls.schema}" CASCADE')
                connection.commit()
        idempotency_store._SCHEMA_READY = False
        login_store._SCHEMA_READY = False

    @classmethod
    def connect_db(cls):
        connection = psycopg.connect(TEST_DSN)
        connection.execute(f'SET search_path TO "{cls.schema}"')
        return connection

    def make_scope(
        self,
        identity="user:101",
        method="POST",
        path="/api/missions",
        query="source=web",
        key="retry-123",
    ):
        scope = idempotency_store.build_idempotency_scope(
            identity=identity,
            method=method,
            route_path=path,
            query_string=query,
            client_key=key,
        )
        self.assertIsNotNone(scope)
        return scope

    def test_same_scope_returns_saved_response_and_status(self):
        scope = self.make_scope()
        payload = json.dumps({"mission_id": 271, "status": "created"})
        with self.connect_db() as connection:
            with connection.cursor() as cursor:
                idempotency_store.save_cached_response(cursor, scope, payload, 201)
                connection.commit()
                cached = idempotency_store.fetch_cached_response(cursor, scope)

        self.assertEqual(cached, ({"mission_id": 271, "status": "created"}, 201))

    def test_same_client_key_isolated_by_identity_method_route_and_query(self):
        base = self.make_scope()
        variants = [
            self.make_scope(identity="user:202"),
            self.make_scope(method="PUT"),
            self.make_scope(path="/api/missions/271"),
            self.make_scope(query="source=mobile"),
        ]
        with self.connect_db() as connection:
            with connection.cursor() as cursor:
                idempotency_store.save_cached_response(
                    cursor, base, json.dumps({"owner": "user-101"}), 200
                )
                connection.commit()
                for variant in variants:
                    with self.subTest(scope=variant):
                        self.assertIsNone(
                            idempotency_store.fetch_cached_response(cursor, variant)
                        )
                self.assertEqual(
                    idempotency_store.fetch_cached_response(cursor, base),
                    ({"owner": "user-101"}, 200),
                )

    def test_failed_response_removes_only_its_matching_scope(self):
        one = self.make_scope(identity="user:101")
        two = self.make_scope(identity="user:202")
        with self.connect_db() as connection:
            with connection.cursor() as cursor:
                idempotency_store.save_cached_response(cursor, one, '{"saved":true}', 200)
                idempotency_store.save_cached_response(cursor, two, '{"saved":true}', 200)
                connection.commit()
                idempotency_store.save_cached_response(cursor, one, '{"error":true}', 500)
                connection.commit()
                self.assertIsNone(idempotency_store.fetch_cached_response(cursor, one))
                self.assertEqual(
                    idempotency_store.fetch_cached_response(cursor, two),
                    ({"saved": True}, 200),
                )

    def test_legacy_raw_key_rows_are_not_replayed_by_scoped_store(self):
        key = "legacy-retry-xyz"
        scope = self.make_scope(key=key)
        with self.connect_db() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO idempotency_keys (idempotency_key, response, original_status) "
                    "VALUES (%s, %s::jsonb, %s)",
                    (key, json.dumps({"old": "ambiguous"}), 200),
                )
                connection.commit()
                self.assertIsNone(
                    idempotency_store.fetch_cached_response(cursor, scope)
                )

    def test_shared_login_failure_window_counts_then_clears(self):
        key = login_store.build_login_rate_limit_key("203.0.113.9", "Operation.Upper")
        with self.connect_db() as connection:
            with connection.cursor() as cursor:
                for _ in range(10):
                    login_store.record_login_failure(cursor, key)
                connection.commit()
                self.assertEqual(login_store.count_recent_failures(cursor, key, 900), 10)

                login_store.clear_login_failures(cursor, key)
                connection.commit()
                self.assertEqual(login_store.count_recent_failures(cursor, key, 900), 0)

    def test_failures_outside_window_do_not_count(self):
        key = login_store.build_login_rate_limit_key("203.0.113.10", "operation.canal")
        with self.connect_db() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO login_rate_limit_events (key_hash, failed_at)
                    VALUES (%s, CURRENT_TIMESTAMP - INTERVAL '20 minutes');
                    """,
                    (key,),
                )
                connection.commit()
                self.assertEqual(login_store.count_recent_failures(cursor, key, 900), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
