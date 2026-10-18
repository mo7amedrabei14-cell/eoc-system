"""Real PostgreSQL lock-order integration test for earthquake schema repair."""
import os
import threading
import time
import unittest

import psycopg

from test_eq_schema_bootstrap import load_real_schema_functions


DSN = os.environ.get("TEST_DATABASE_URL", "")
LOCK_NAMESPACE = 74193
LOCK_KEY = 1


class EarthquakePostgresLockOrderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DSN:
            raise RuntimeError("TEST_DATABASE_URL must point to the disposable PostgreSQL CI service")
        # This workflow uses a disposable database service; never point this test at production.
        with psycopg.connect(DSN) as conn:
            conn.execute("DROP TABLE IF EXISTS public.earthquake_intel CASCADE")
            conn.execute("""
                CREATE TABLE public.earthquake_intel (
                    eq_intel_id BIGSERIAL PRIMARY KEY,
                    source VARCHAR(40) NOT NULL DEFAULT 'usgs',
                    external_id VARCHAR(160) NOT NULL DEFAULT '',
                    occurred_at TIMESTAMP WITHOUT TIME ZONE,
                    magnitude DOUBLE PRECISION,
                    depth_km DOUBLE PRECISION,
                    place VARCHAR(240),
                    latitude DOUBLE PRECISION,
                    longitude DOUBLE PRECISION,
                    distance_km DOUBLE PRECISION,
                    sound_alert BOOLEAN NOT NULL DEFAULT FALSE,
                    raw JSONB,
                    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL
                        DEFAULT (now() AT TIME ZONE 'Africa/Cairo'),
                    hist_max_mag DOUBLE PRECISION,
                    hist_window_count INTEGER
                )
            """)
            conn.execute("""
                CREATE UNIQUE INDEX uq_eq_intel_source_external
                ON public.earthquake_intel (source, external_id)
            """)

    def test_read_then_insert_does_not_deadlock_with_schema_repair(self):
        # The history column and occurrence index are intentionally missing so the
        # real application schema function must execute DDL after its exclusive lock.
        writer_read_complete = threading.Event()
        allow_writer_insert = threading.Event()
        writer_insert_complete = threading.Event()
        migration_started = threading.Event()
        migration_complete = threading.Event()
        failures = []

        namespace = load_real_schema_functions(None)
        namespace["get_connection"] = lambda: psycopg.connect(DSN)

        def writer():
            conn = None
            try:
                conn = psycopg.connect(DSN)
                with conn.cursor() as cur:
                    # Mirrors the application's lock protocol: shared advisory lock
                    # first, before SELECT takes a relation lock.
                    cur.execute(
                        "SELECT pg_advisory_xact_lock_shared(%s, %s)",
                        (LOCK_NAMESPACE, LOCK_KEY),
                    )
                    cur.execute("SELECT eq_intel_id FROM public.earthquake_intel LIMIT 1")
                    cur.fetchone()
                    writer_read_complete.set()
                    if not allow_writer_insert.wait(8):
                        raise TimeoutError("test did not release writer for INSERT")
                    # This was the lock upgrade that could deadlock behind ALTER TABLE.
                    cur.execute("""
                        INSERT INTO public.earthquake_intel (source, external_id, magnitude)
                        VALUES ('test', 'lock-order-regression', 2.5)
                        ON CONFLICT (source, external_id) DO NOTHING
                    """)
                conn.commit()
                writer_insert_complete.set()
            except BaseException as exc:
                failures.append(("writer", repr(exc)))
                if conn is not None:
                    conn.rollback()
            finally:
                if conn is not None:
                    conn.close()

        def migrate():
            try:
                migration_started.set()
                # Calls the actual schema function extracted from main.py.
                namespace["ensure_earthquake_intel_schema"]()
            except BaseException as exc:
                failures.append(("migration", repr(exc)))
            finally:
                migration_complete.set()

        writer_thread = threading.Thread(target=writer, name="eq-test-writer", daemon=True)
        migration_thread = threading.Thread(target=migrate, name="eq-test-migration", daemon=True)
        writer_thread.start()
        self.assertTrue(writer_read_complete.wait(4), "writer did not establish its read transaction")
        migration_thread.start()
        self.assertTrue(migration_started.wait(2), "schema repair did not start")

        # Confirm that the migration is queued on the advisory lock, not on the table.
        deadline = time.monotonic() + 5
        migration_waiting_on_advisory = False
        try:
            with psycopg.connect(DSN, autocommit=True) as monitor:
                while time.monotonic() < deadline:
                    row = monitor.execute("""
                        SELECT 1
                        FROM pg_stat_activity
                        WHERE datname = current_database()
                          AND pid <> pg_backend_pid()
                          AND wait_event_type = 'Lock'
                          AND query ILIKE '%pg_advisory_xact_lock%'
                        LIMIT 1
                    """).fetchone()
                    if row:
                        migration_waiting_on_advisory = True
                        break
                    time.sleep(0.05)
        finally:
            # Always release the worker, including when the assertion above fails.
            allow_writer_insert.set()

        writer_thread.join(8)
        migration_thread.join(8)
        self.assertFalse(writer_thread.is_alive(), "writer hung while schema repair was queued")
        self.assertFalse(migration_thread.is_alive(), "schema repair did not finish")
        self.assertTrue(migration_waiting_on_advisory, "migration did not wait on the shared/exclusive advisory-lock protocol")
        self.assertTrue(writer_insert_complete.is_set(), "INSERT failed to complete before schema repair")
        self.assertTrue(migration_complete.is_set(), "schema repair did not complete")
        self.assertEqual(failures, [], f"unexpected PostgreSQL concurrency errors: {failures}")

        with psycopg.connect(DSN) as conn:
            column_exists = conn.execute("""
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'earthquake_intel'
                      AND column_name = 'hist_scanned_at'
                )
            """).fetchone()[0]
            index_exists = conn.execute(
                "SELECT to_regclass('public.idx_eq_intel_occurred') IS NOT NULL"
            ).fetchone()[0]
            inserted = conn.execute("""
                SELECT COUNT(*) FROM public.earthquake_intel
                WHERE source = 'test' AND external_id = 'lock-order-regression'
            """).fetchone()[0]
        self.assertTrue(column_exists, "schema repair did not add hist_scanned_at")
        self.assertTrue(index_exists, "schema repair did not create idx_eq_intel_occurred")
        self.assertEqual(inserted, 1, "writer INSERT was lost during schema repair")


if __name__ == "__main__":
    unittest.main()
