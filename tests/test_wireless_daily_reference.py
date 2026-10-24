"""Unit tests for daily wireless reference allocation."""
import unittest
from datetime import date

from wireless_daily_reference import next_wireless_delivery_code


class _FakeCounterCursor:
    """Small deterministic stand-in for the atomic counter upsert."""
    def __init__(self):
        self.counters = {}
        self.params = None
        self.sql = ""
        self._last_number = None

    def execute(self, sql, params=None):
        self.sql = " ".join(sql.split()).lower()
        self.params = params
        reference_date = params[0]
        self.counters[reference_date] = self.counters.get(reference_date, 0) + 1
        self._last_number = self.counters[reference_date]

    def fetchone(self):
        return (self._last_number,)


class WirelessDailyReferenceTests(unittest.TestCase):
    def test_serial_increments_within_a_day_and_resets_on_next_date(self):
        cursor = _FakeCounterCursor()
        self.assertEqual(
            next_wireless_delivery_code(cursor, "2026-10-24"),
            "#WH-20261024-00001",
        )
        self.assertEqual(
            next_wireless_delivery_code(cursor, "2026-10-24"),
            "#WH-20261024-00002",
        )
        self.assertEqual(
            next_wireless_delivery_code(cursor, "2026-10-25"),
            "#WH-20261025-00001",
        )

    def test_database_allocation_is_a_single_date_scoped_atomic_upsert(self):
        cursor = _FakeCounterCursor()
        next_wireless_delivery_code(cursor, "2026-10-24")
        self.assertIn(
            "insert into wireless_delivery_daily_counters (reference_date, last_number)",
            cursor.sql,
        )
        self.assertIn("on conflict (reference_date) do update", cursor.sql)
        self.assertIn(
            "last_number = wireless_delivery_daily_counters.last_number + 1",
            cursor.sql,
        )
        self.assertEqual(cursor.params, (date(2026, 10, 24),))

    def test_invalid_date_fails_before_touching_the_database(self):
        cursor = _FakeCounterCursor()
        with self.assertRaises(ValueError):
            next_wireless_delivery_code(cursor, "2026-13-40")
        self.assertEqual(cursor.sql, "")
        self.assertEqual(cursor.counters, {})


if __name__ == "__main__":
    unittest.main()
