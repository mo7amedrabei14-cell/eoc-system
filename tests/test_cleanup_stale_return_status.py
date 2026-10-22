"""Safe regression tests for cleanup_stale_return_status.py (no real database)."""
from unittest.mock import patch

import cleanup_stale_return_status as cleanup


class FakeCursor:
    def __init__(self, stale_rows):
        self.stale_rows = stale_rows
        self.rows = []
        self.calls = []
        self.update_sql = None
        self.update_params = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=None):
        normalized = " ".join(sql.split()).lower()
        self.calls.append((normalized, params))
        if "join missions m" in normalized and "from mission_participants p" in normalized:
            self.rows = list(self.stale_rows)
        elif normalized.startswith("update mission_participants as p"):
            self.update_sql = normalized
            self.update_params = params
            self.rows = [(pid,) for pid in params[0]]
        elif normalized.startswith("select participant_id, membership_number, full_name, return_status"):
            self.rows = [
                (pid, f"M-{pid}", f"Test {pid}", "في الانتظار")
                for pid in params[0]
            ]
        else:
            raise AssertionError(f"Unexpected SQL: {normalized}")

    def fetchall(self):
        return list(self.rows)


class FakeConnection:
    def __init__(self, cursor):
        self.fake_cursor = cursor
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


def test_cleanup_updates_only_selected_eligible_participants():
    selected = [
        (101, "M-101", "Test 101", 2, "مازال بالمهمة", 77, "Mission A", "Active"),
        (202, "M-202", "Test 202", 3, "مازال بالمهمة", 88, "Mission B", "Active"),
    ]
    cursor = FakeCursor(selected)
    conn = FakeConnection(cursor)
    with patch.object(cleanup, "get_connection", return_value=conn):
        cleanup.main()

    assert cursor.update_params == ([101, 202],)
    assert "p.participant_id = any(%s)" in cursor.update_sql
    assert "p.return_status = 'مازال بالمهمة'" in cursor.update_sql
    assert "p.membership_number is not null" in cursor.update_sql
    assert "m.status not in ('draft', 'cancelled', 'returned', 'completed')" in cursor.update_sql
    assert "not exists" in cursor.update_sql
    assert conn.commits == 1
    assert conn.rollbacks == 0
    assert conn.closed


def test_cleanup_with_no_eligible_rows_performs_no_update():
    cursor = FakeCursor([])
    conn = FakeConnection(cursor)
    with patch.object(cleanup, "get_connection", return_value=conn):
        cleanup.main()

    assert not any(sql.startswith("update mission_participants as p") for sql, _ in cursor.calls)
    assert conn.commits == 0
    assert conn.rollbacks == 1
    assert conn.closed
