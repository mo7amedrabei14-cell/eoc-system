"""Regression tests for PostgreSQL earthquake schema/ingestion lock ordering.

These tests execute the real schema-bootstrap functions against a small fake
connection. They don't replace the live PostgreSQL concurrency smoke test.
"""
import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SOURCE = (ROOT / "main.py").read_text(encoding="utf-8")


class FakeCursor:
    def __init__(self, states):
        self.states = iter(states)
        self.pending = None
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split())
        self.statements.append((normalized, params))
        if "to_regclass('public.earthquake_intel')" in normalized and "pg_attribute" in normalized:
            self.pending = next(self.states)

    def fetchone(self):
        value = self.pending
        self.pending = None
        return value


class FakeConnection:
    def __init__(self, states):
        self.fake_cursor = FakeCursor(states)
        self.commits = 0
        self.rollbacks = 0
        self.closed = False

    def cursor(self):
        return self.fake_cursor

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = True


def load_real_schema_functions(connection):
    """Compile only the real schema functions, without starting app bootstrap."""
    tree = ast.parse(SOURCE, filename="main.py")
    wanted_assignments = {
        "_EQ_INTEL_SCHEMA_LOCK_NAMESPACE",
        "_EQ_INTEL_SCHEMA_LOCK_KEY",
        "_EQ_INTEL_BASE_COLUMNS",
        "_EQ_INTEL_HISTORY_COLUMNS",
    }
    wanted_functions = {
        "_eq_intel_read_schema_state",
        "_eq_intel_schema_ready",
        "ensure_earthquake_intel_schema",
    }
    selected = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id in wanted_assignments
                   for target in node.targets):
                selected.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in wanted_functions:
            selected.append(node)
    selected.sort(key=lambda node: node.lineno)
    namespace = {"get_connection": lambda: connection}
    module = ast.Module(body=selected, type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "main.py", "exec"), namespace)
    return namespace


def schema_state(exists, columns, unique_index, occurred_index):
    return (exists, list(columns), unique_index, occurred_index)


class EarthquakeSchemaGuardTests(unittest.TestCase):
    def test_healthy_schema_returns_without_ddl_or_advisory_lock(self):
        constants = load_real_schema_functions(FakeConnection([]))
        all_columns = constants["_EQ_INTEL_BASE_COLUMNS"] | constants["_EQ_INTEL_HISTORY_COLUMNS"]
        connection = FakeConnection([
            schema_state(True, all_columns, True, True),
        ])
        namespace = load_real_schema_functions(connection)

        namespace["ensure_earthquake_intel_schema"]()

        statements = [sql for sql, _ in connection.fake_cursor.statements]
        self.assertFalse(any(
            sql.startswith(("CREATE TABLE", "ALTER TABLE", "CREATE INDEX", "CREATE UNIQUE INDEX"))
            for sql in statements
        ), statements)
        self.assertFalse(any("pg_advisory_xact_lock(" in sql for sql in statements), statements)
        self.assertEqual(connection.commits, 1)
        self.assertEqual(connection.rollbacks, 0)
        self.assertTrue(connection.closed)

    def test_repair_lock_precedes_only_missing_ddl(self):
        base_columns = load_real_schema_functions(FakeConnection([]))["_EQ_INTEL_BASE_COLUMNS"]
        columns = base_columns | {"hist_max_mag", "hist_window_count"}
        state = schema_state(True, columns, False, True)
        connection = FakeConnection([state, state])
        namespace = load_real_schema_functions(connection)

        namespace["ensure_earthquake_intel_schema"]()

        statements = [sql for sql, _ in connection.fake_cursor.statements]
        lock_index = next(i for i, sql in enumerate(statements) if "pg_advisory_xact_lock(" in sql)
        ddl_indices = [i for i, sql in enumerate(statements) if sql.startswith(("ALTER TABLE", "CREATE INDEX", "CREATE UNIQUE INDEX"))]
        self.assertTrue(ddl_indices)
        self.assertLess(lock_index, min(ddl_indices), statements)
        self.assertEqual(sum("ALTER TABLE earthquake_intel" in sql for sql in statements), 1, statements)
        self.assertTrue(any("ADD COLUMN hist_scanned_at" in sql for sql in statements), statements)
        self.assertFalse(any("ADD COLUMN hist_max_mag" in sql or "ADD COLUMN hist_window_count" in sql for sql in statements), statements)
        self.assertTrue(any(sql.startswith("CREATE UNIQUE INDEX uq_eq_intel_source_external") for sql in statements), statements)
        self.assertFalse(any("CREATE INDEX idx_eq_intel_occurred" in sql for sql in statements), statements)
        self.assertEqual(connection.commits, 1)
        self.assertTrue(connection.closed)

    def test_missing_table_creation_is_serialized_and_complete(self):
        missing = schema_state(False, set(), False, False)
        connection = FakeConnection([missing, missing])
        namespace = load_real_schema_functions(connection)

        namespace["ensure_earthquake_intel_schema"]()

        statements = [sql for sql, _ in connection.fake_cursor.statements]
        lock_index = next(i for i, sql in enumerate(statements) if "pg_advisory_xact_lock(" in sql)
        create_index = next(i for i, sql in enumerate(statements) if sql.startswith("CREATE TABLE"))
        self.assertLess(lock_index, create_index, statements)
        self.assertTrue(any(sql.startswith("CREATE TABLE IF NOT EXISTS earthquake_intel") for sql in statements), statements)
        self.assertTrue(any(sql.startswith("CREATE UNIQUE INDEX uq_eq_intel_source_external") for sql in statements), statements)
        self.assertTrue(any(sql.startswith("CREATE INDEX idx_eq_intel_occurred") for sql in statements), statements)
        self.assertEqual(connection.commits, 1)
        self.assertTrue(connection.closed)

    def test_ingest_takes_shared_lock_before_reading_or_inserting(self):
        tree = ast.parse(SOURCE, filename="main.py")
        ingest = next(node for node in ast.walk(tree)
                      if isinstance(node, ast.FunctionDef) and node.name == "_eq_intel_ingest_events")
        lines = SOURCE.splitlines()
        body = "\n".join(lines[ingest.lineno - 1:ingest.end_lineno])
        shared_lock = body.index("pg_advisory_xact_lock_shared")
        table_insert = body.index("INSERT INTO earthquake_intel")
        self.assertLess(shared_lock, table_insert, body)
        self.assertIn("_EQ_INTEL_SCHEMA_LOCK_NAMESPACE", body)
        self.assertIn("_EQ_INTEL_SCHEMA_LOCK_KEY", body)


if __name__ == "__main__":
    unittest.main()
