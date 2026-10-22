"""Regression tests for join/leave notification targeting and weather batch typing.

These tests use mocked cursors only; they do not connect to PostgreSQL or mutate data.
Run with: pytest -q tests/test_jl_weather_regressions.py
"""
import datetime as dt
from unittest.mock import patch

import main
from weather_backfill import _insert_history_rows_cursor


def _participant():
    return {
        "end_entry_id": None,
        "participant_name": "Regression participant",
        "mission_name": "Regression mission",
        "start": dt.datetime(2026, 10, 22, 10, 0),
    }


def _run_join_leave_event(actor_id, creator_id):
    state = {}
    emitted = {"event": 1, "created_at": dt.datetime(2026, 10, 22, 10, 0)}
    with (
        patch.object(main, "create_audit_log"),
        patch.object(main, "fmt_dt", return_value="10:00"),
        patch.object(main, "resolve_mission_creator", return_value=creator_id),
        patch.object(main, "get_latest_recent_event_action", return_value=None),
        patch.object(main, "is_recent_duplicate_action", return_value=False),
        patch.object(main, "create_realtime_event", return_value=emitted) as create_event,
    ):
        main._emit_jl_event(object(), 42, actor_id, _participant(), state)
    return create_event.call_args.kwargs


def test_join_leave_event_targets_creator_when_another_user_is_actor():
    kwargs = _run_join_leave_event(actor_id=7, creator_id=42)
    assert kwargs["target_user_id"] == 42
    assert kwargs["dedupe_prechecked"] is True


def test_join_leave_event_is_untargeted_when_creator_is_actor():
    kwargs = _run_join_leave_event(actor_id=42, creator_id=42)
    assert kwargs["target_user_id"] is None
    assert kwargs["dedupe_prechecked"] is True


class _FakeCursor:
    def __init__(self):
        self.params = None

    def execute(self, query, params):
        self.params = params

    def fetchall(self):
        return []


def test_weather_history_batch_normalizes_mixed_numeric_types_and_preserves_nulls():
    rows = [
        {
            "location_id": 1,
            "record_date": dt.date(2026, 10, 20),
            "tmax": 25,
            "tmin": 12.5,
            "precip_mm": None,
            "wind_max_kph": 8,
            "wind_gusts_kph": 11.25,
            "humidity_mean_pct": 60,
            "cloud_cover_mean_pct": None,
            "data_source": "test",
        },
        {
            "location_id": 2,
            "record_date": dt.date(2026, 10, 21),
            "tmax": 26.5,
            "tmin": 13,
            "precip_mm": 0,
            "wind_max_kph": None,
            "wind_gusts_kph": 12,
            "humidity_mean_pct": 61.5,
            "cloud_cover_mean_pct": 30,
            "data_source": "test",
        },
    ]
    cur = _FakeCursor()

    assert _insert_history_rows_cursor(cur, rows) == 0
    numeric_arrays = cur.params[2:9]
    for array in numeric_arrays:
        assert all(value is None or type(value) is float for value in array)
    assert numeric_arrays[0] == [25.0, 26.5]
    assert numeric_arrays[1] == [12.5, 13.0]
    assert numeric_arrays[2] == [None, 0.0]
    assert numeric_arrays[5] == [60.0, 61.5]
    assert numeric_arrays[6] == [None, 30.0]
