# -*- coding: utf-8 -*-
"""N+1 optimization regression suite — behavioral equivalence + round-trip counts.

Covers mission details, join/leave materialization, participant identity/availability,
completion and participant notification dedupe, recipient-scoped realtime events,
wireless handover child lists, end-participation presence, earthquake cross-source
matching/history, and global-earthquake duplicate checks. Data-size-sensitive paths
exercise 1, 10 and 100 records and compare current behavior with a fixed legacy baseline.

The ORIGINAL implementations are not re-typed here: they are loaded from
`git show 7f57fe0000c1fb36a8e3e7b996352fb4812600e0:main.py` and imported as a second module, so both sides run the
real code and are compared on:
  * the exact JSON response (order included),
  * the resulting table state (inside a transaction that is rolled back),
  * the exact sequence of write statements (+ their parameters),
  * the measured number of cursor.execute calls.

═══════════════════════════════════════════════════════════════════════════════
TEST DATABASE ONLY — hard guard:
  TEST_DATABASE_URL must be set explicitly, its host must be loopback and its
  database name must contain "test".  There is NO fallback to DATABASE_URL, so
  this script can never touch the production database; everything it writes is
  rolled back (or lives in the disposable test DB).
═══════════════════════════════════════════════════════════════════════════════
"""
import contextlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent

# ── guard: refuse to run against anything that is not a local test database ──
TEST_URL = (os.environ.get("TEST_DATABASE_URL") or "").strip()
if not TEST_URL:
    print("SKIP: set TEST_DATABASE_URL to a disposable local test database "
          "(e.g. postgresql://user@127.0.0.1:55432/eoc_test).")
    sys.exit(2)

_parsed = urlparse(TEST_URL)
if (_parsed.hostname or "").lower() not in ("127.0.0.1", "localhost", "::1") \
        or "test" not in (_parsed.path or "").lower():
    print(f"REFUSED: TEST_DATABASE_URL must be a loopback database whose name contains "
          f"'test' (got host={_parsed.hostname!r}, db={(_parsed.path or '').lstrip('/')!r}).")
    sys.exit(2)

# Both modules (current + pre-Phase-1 baseline) connect through db.get_connection -> DATABASE_URL.
os.environ["DATABASE_URL"] = TEST_URL
# An explicit throwaway secret is safe only because the test URL guard above
# requires a loopback database whose name contains "test".
os.environ.setdefault("JWT_SECRET", "n1-test-only-secret-not-for-production")
# Disable persistent/external feed workers in this disposable database test.
os.environ["EOC_EQ_LOCAL_ENGINE"] = "0"
os.environ["EOC_EQ_WORLD_BACKFILL"] = "0"
os.environ["EOC_EQ_EMSC_ENGINE"] = "0"
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402

# main.ensure_schema expects the core tables used by the production migration path.
# The application's own bootstrap creates its runtime/add-on tables after these stubs.
with psycopg.connect(TEST_URL, autocommit=True) as _bootstrap_connection:
    _bootstrap_sql = (ROOT / "tests" / "n1_test_schema.sql").read_text(encoding="utf-8")
    for _statement in _bootstrap_sql.split(";"):
        if _statement.strip():
            _bootstrap_connection.execute(_statement)

import main as NEW  # noqa: E402
import realtime as REALTIME  # noqa: E402
from db import get_connection  # noqa: E402
import backfill_world_catalog as WORLD_BACKFILL  # noqa: E402
import weather_backfill as WEATHER_BACKFILL  # noqa: E402
import fix_emsc_links as EMSC_LINKS  # noqa: E402
from routers import users as USER_ROUTER  # noqa: E402


def _wait_for_schema(module, label, verify_version=False):
    ready = getattr(module, "_schema_ready", None)
    if ready is not None and not ready.wait(timeout=60):
        raise RuntimeError(f"{label} schema bootstrap did not finish within 60 seconds")
    error = getattr(module, "_schema_error", None)
    if isinstance(error, dict) and error.get("message"):
        raise RuntimeError(f"{label} schema bootstrap failed: {error['message']}")
    if verify_version:
        with psycopg.connect(TEST_URL) as _conn:
            with _conn.cursor() as _cur:
                _cur.execute("SELECT value FROM schema_meta WHERE key = 'version'")
                _row = _cur.fetchone()
        expected = getattr(module, "SCHEMA_VERSION", None)
        if not _row or _row[0] != expected:
            raise RuntimeError(
                f"{label} schema did not reach expected version {expected!r}; "
                f"found {_row[0] if _row else None!r}"
            )


_wait_for_schema(NEW, "current application", verify_version=True)

PASS = FAIL = 0
ACTOR = {"id": None}   # test actor (audit_logs.user_id -> users FK)


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✔ {name}")
    else:
        FAIL += 1
        print(f"  ✘ {name}  {extra}")


# ─────────────────────────────────────────────────────────────────────────────
# PRE-PHASE-1 (pre-optimization) implementation loaded as its own module
# ─────────────────────────────────────────────────────────────────────────────
def load_legacy_module():
    baseline = "7f57fe0000c1fb36a8e3e7b996352fb4812600e0"
    src = subprocess.run(
        ["git", "show", f"{baseline}:main.py"], cwd=str(ROOT),
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout
    path = Path(tempfile.mkdtemp(prefix="n1_head_")) / "main_head_snapshot.py"
    path.write_text(src, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("main_head_snapshot", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["main_head_snapshot"] = mod
    spec.loader.exec_module(mod)
    _wait_for_schema(mod, "legacy baseline")
    return mod


# ─────────────────────────────────────────────────────────────────────────────
# Query counting
# ─────────────────────────────────────────────────────────────────────────────
class Counter:
    def __init__(self):
        self.n = 0
        self.sql = []          # (normalized sql, normalized params)

    def reset(self):
        self.n = 0
        self.sql = []


def _norm_param(value):
    if hasattr(value, "obj"):                    # psycopg Jsonb
        return ("jsonb", json.dumps(value.obj, sort_keys=True, default=str, ensure_ascii=False))
    if isinstance(value, (list, tuple)):
        return tuple(_norm_param(v) for v in value)
    if isinstance(value, dict):
        return tuple(sorted((str(k), _norm_param(v)) for k, v in value.items()))
    return repr(value)


class CountingCursor:
    def __init__(self, cur, counter):
        self._cur = cur
        self._counter = counter

    def execute(self, sql, params=None):
        self._counter.n += 1
        self._counter.sql.append((" ".join(str(sql).split()), _norm_param(params)))
        if params is None:
            return self._cur.execute(sql)
        return self._cur.execute(sql, params)

    def executemany(self, sql, seq_params):
        rows = list(seq_params)
        self._counter.n += 1
        self._counter.sql.append((" ".join(str(sql).split()), f"<executemany {len(rows)}>"))
        return self._cur.executemany(sql, rows)

    def __getattr__(self, item):
        return getattr(self._cur, item)


class CountingConnection:
    """Counts queries; commit/rollback are recorded but never applied so the
    test (not the endpoint) owns the transaction."""

    def __init__(self, conn, counter):
        self._conn = conn
        self._counter = counter
        self.commits = 0
        self.rollbacks = 0

    @contextlib.contextmanager
    def cursor(self, *args, **kwargs):
        with self._conn.cursor(*args, **kwargs) as cur:
            yield CountingCursor(cur, self._counter)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        pass

    def __getattr__(self, item):
        return getattr(self._conn, item)


WRITE_PREFIXES = ("INSERT", "UPDATE", "DELETE")


def write_statements(counter):
    return [(sql, params) for sql, params in counter.sql
            if sql.upper().startswith(WRITE_PREFIXES)]


# ─────────────────────────────────────────────────────────────────────────────
# Seeding (test DB only)
# ─────────────────────────────────────────────────────────────────────────────
SEED_TABLES = (
    "mission_participant_sessions", "mission_participant_itineraries",
    "mission_join_leave_entries", "mission_itineraries", "mission_vehicles",
    "mission_beneficiaries", "mission_eoc_staff", "mission_volunteer_room_notes",
    "mission_participants", "missions", "global_earthquakes",
    "audit_logs", "realtime_events",
)


def reset_db(cur):
    cur.execute("TRUNCATE " + ", ".join(SEED_TABLES) + " RESTART IDENTITY CASCADE")
    # audit_logs.user_id has an FK to users (GENERATED ALWAYS) — reuse one actor row.
    cur.execute("SELECT user_id FROM users WHERE username = 'n1_test_actor' LIMIT 1")
    row = cur.fetchone()
    if row is None:
        cur.execute(
            "INSERT INTO users (full_name, username, role) "
            "VALUES ('N1 test actor', 'n1_test_actor', 'owner') RETURNING user_id"
        )
        row = cur.fetchone()
    ACTOR["id"] = row[0]


def new_mission(cur, code, status="Active"):
    cur.execute(
        """
        INSERT INTO missions (mission_code, mission_name, mission_classification, status,
                              exit_date, departure_date, arrival_date, start_time,
                              departure_time, arrival_time, created_at, idempotency_key, team_code)
        VALUES (%s, %s, 'عادية', %s, '2026-08-20', '2026-08-20', '2026-08-21',
                '07:00', '08:00', '18:00', now(), %s, '')
        RETURNING mission_id
        """,
        (code, f"N1 {code}", status, f"idem-{code}"),
    )
    return cur.fetchone()[0]


def new_route(cur, mid, group, dep_date, dep_time, arr_date, arr_time):
    cur.execute(
        """
        INSERT INTO mission_itineraries (mission_id, group_title, route_from, route_to,
                                         departure_time, arrival_time, departure_date, arrival_date)
        VALUES (%s, %s, '', '', %s, %s, %s, %s)
        """,
        (mid, group, dep_time, arr_time, dep_date, arr_date),
    )


def new_participant(cur, mid, name, roster=True, sfm=True, return_status="مازال بالمهمة"):
    cur.execute(
        """
        INSERT INTO mission_participants (mission_id, participant_type, full_name,
                                          membership_number, participant_position, team_name,
                                          team_code, roster_active, start_from_mission,
                                          return_status, branch_id, assigned_itinerary)
        VALUES (%s, 'volunteer', %s, '', '', '', '', %s, %s, %s, 1, '')
        RETURNING participant_id
        """,
        (mid, name, roster, sfm, return_status),
    )
    return cur.fetchone()[0]


def assign(cur, mid, pid, group):
    cur.execute(
        "INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) "
        "VALUES (%s, %s, %s)",
        (pid, mid, group),
    )


def new_session(cur, pid, mid, sdate, cin, cout, start_dt=None, end_dt=None,
                notes=None, group=None, start_entry=None, end_entry=None):
    cur.execute(
        """
        INSERT INTO mission_participant_sessions
            (participant_id, mission_id, session_date, check_in_time, check_out_time,
             notes, start_dt, end_dt, itinerary_group, start_entry_id, end_entry_id)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING session_id
        """,
        (pid, mid, sdate, cin, cout, notes, start_dt, end_dt, group, start_entry, end_entry),
    )
    return cur.fetchone()[0]


def new_jl_entry(cur, mid, title, kind, when):
    cur.execute(
        "INSERT INTO mission_join_leave_entries (mission_id, title, kind, dt) "
        "VALUES (%s, %s, %s, %s) RETURNING entry_id",
        (mid, title, kind, when),
    )
    return cur.fetchone()[0]


# ─────────────────────────────────────────────────────────────────────────────
# 1) get_mission_details
# ─────────────────────────────────────────────────────────────────────────────
def call_details(mod, mid):
    counter = Counter()
    conn = get_connection()
    proxy = CountingConnection(conn, counter)
    saved = (mod.get_connection, mod.get_current_user_id, mod._user_has_permission)
    mod.get_connection = lambda: proxy
    mod.get_current_user_id = lambda token: ACTOR["id"]
    mod._user_has_permission = lambda cursor, uid, perm: True
    try:
        out = mod.get_mission_details(mid, None, SimpleNamespace(credentials="test-token"))
    finally:
        mod.get_connection, mod.get_current_user_id, mod._user_has_permission = saved
        conn.close()
    return json.dumps(out, ensure_ascii=False, default=str, sort_keys=False), counter.n


def seed_details(cur):
    ids = {}
    ids["empty"] = new_mission(cur, "N1-D0")
    ids["one"] = new_mission(cur, "N1-D1")
    ids["multi"] = new_mission(cur, "N1-D2")
    ids["done"] = new_mission(cur, "N1-D3", status="Completed")
    ids["stray"] = new_mission(cur, "N1-D4")
    ids["ten"] = new_mission(cur, "N1-D10")
    for i in range(10):
        new_participant(cur, ids["ten"], f"عينة 10 مشاركين {i}")
    ids["hundred"] = new_mission(cur, "N1-D100")
    for i in range(100):
        new_participant(cur, ids["hundred"], f"عينة 100 مشارك {i}")

    # D0 — zero participants
    # D1 — one participant, no sessions / no itineraries
    new_participant(cur, ids["one"], "مفرد بلا شيء")

    # D2 — three participants, route groups for the hours engine
    m2 = ids["multi"]
    new_route(cur, m2, "اليوم الأول", "2026-08-20", "08:00", "2026-08-20", "18:00")
    new_route(cur, m2, "اليوم الثاني", "2026-08-21", "09:00", "2026-08-21", "17:00")

    p_a = new_participant(cur, m2, "أ - جلستان متطابقتان")
    assign(cur, m2, p_a, "اليوم الأول")
    assign(cur, m2, p_a, "اليوم الثاني")
    # tie on start_dt (two rows) + one legacy row with only session_date
    new_session(cur, p_a, m2, "2026-08-20", "10:00", "14:00",
                "2026-08-20 10:00:00", "2026-08-20 14:00:00", "جلسة أ")
    new_session(cur, p_a, m2, "2026-08-20", "16:00", "20:00",
                "2026-08-20 10:00:00", "2026-08-20 20:00:00", "جلسة ب (نفس البداية)")
    new_session(cur, p_a, m2, "2026-08-21", "09:30", "12:00", None, None, "قديمة بلا start_dt")

    p_b = new_participant(cur, m2, "ب - بلا جلسات ولا مسارات")

    p_c = new_participant(cur, m2, "ج - جلسة مفتوحة")
    assign(cur, m2, p_c, "اليوم الثاني")
    new_session(cur, p_c, m2, "2026-08-21", "09:00", None,
                "2026-08-21 09:00:00", None, "مفتوحة")

    # D3 — completed mission: status must win in compute_participant_status
    m3 = ids["done"]
    new_route(cur, m3, "خط السير الأساسي", "2026-08-20", "08:00", "2026-08-20", "18:00")
    p_d = new_participant(cur, m3, "د - مهمة مكتملة")
    new_session(cur, p_d, m3, "2026-08-20", "08:00", "12:00",
                "2026-08-20 08:00:00", "2026-08-20 12:00:00", None)

    # D4 — the session query is scoped by participant_id only (not by mission):
    #      one row deliberately carries another mission_id.
    m4 = ids["stray"]
    p_e = new_participant(cur, m4, "هـ - صف بمعرّف مهمة أخرى")
    new_session(cur, p_e, m4, "2026-08-20", "10:00", "11:00",
                "2026-08-20 10:00:00", "2026-08-20 11:00:00", "صف المهمة الحالية")
    new_session(cur, p_e, ids["empty"], "2026-08-20", "11:00", "12:00",
                "2026-08-20 11:00:00", "2026-08-20 12:00:00", "صف مهمة أخرى")
    return ids


def test_mission_details(old_mod):
    print("\n=== 1) get_mission_details ===")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            reset_db(cur)
        conn.commit()
        with conn.cursor() as cur:
            ids = seed_details(cur)
        conn.commit()
        with conn.cursor() as cur:
            counts = {}
            for key, mid in ids.items():
                cur.execute("SELECT count(*) FROM mission_participants "
                            "WHERE mission_id = %s AND roster_active = true", (mid,))
                counts[key] = cur.fetchone()[0]
    finally:
        conn.close()

    for key, mid in ids.items():
        old_json, old_n = call_details(old_mod, mid)
        new_json, new_n = call_details(NEW, mid)
        n = counts[key]
        print(f"  · mission '{key}': participants={n}  queries old={old_n} new={new_n}")
        ok(f"[{key}] response identical (order + values)", old_json == new_json,
           f"first diff at {next((i for i, (a, b) in enumerate(zip(old_json, new_json)) if a != b), 'len')}")
        ok(f"[{key}] old query count is 9 + 2N", old_n == 9 + 2 * n, f"old={old_n} expected={9 + 2 * n}")
        expected_new = 11 if n else 9
        ok(f"[{key}] new query count is constant ({expected_new})", new_n == expected_new,
           f"new={new_n}")


# ─────────────────────────────────────────────────────────────────────────────
# 2) materialize_jl_segments
# ─────────────────────────────────────────────────────────────────────────────
def snapshot_jl(cur, mid, pids):
    cur.execute(
        """
        SELECT participant_id, session_date, check_in_time, check_out_time,
               start_dt, end_dt, start_entry_id, end_entry_id, notes, itinerary_group
        FROM mission_participant_sessions
        WHERE participant_id = ANY(%s::int[])
        ORDER BY participant_id, start_dt NULLS FIRST, session_date NULLS FIRST,
                 check_in_time NULLS FIRST, start_entry_id NULLS FIRST,
                 end_entry_id NULLS FIRST, notes
        """,
        (pids,),
    )
    sessions = [[str(v) for v in row] for row in cur.fetchall()]

    cur.execute(
        "SELECT participant_id, return_status FROM mission_participants "
        "WHERE participant_id = ANY(%s::int[]) ORDER BY participant_id",
        (pids,),
    )
    statuses = [[str(v) for v in row] for row in cur.fetchall()]

    cur.execute("SELECT status FROM missions WHERE mission_id = %s", (mid,))
    mission_status = cur.fetchone()[0]

    cur.execute("SELECT action, details->>'action_text' FROM audit_logs "
                "WHERE mission_id = %s ORDER BY audit_id", (mid,))
    audits = [[str(v) for v in row] for row in cur.fetchall()]

    cur.execute("SELECT event_type, action, details->>'action_text' FROM realtime_events "
                "WHERE mission_id = %s ORDER BY event_id", (mid,))
    events = [[str(v) for v in row] for row in cur.fetchall()]

    cur.execute(
        "SELECT count(*) FROM mission_participant_sessions WHERE participant_id = ANY(%s::int[])",
        (pids,),
    )
    total = cur.fetchone()[0]
    return {"sessions": sessions, "statuses": statuses, "mission_status": mission_status,
            "audits": audits, "events": events, "total_sessions": total}


def run_materialize(mod, mid, pids):
    conn = get_connection()
    counter = Counter()
    try:
        cur = CountingCursor(conn.cursor(), counter)
        try:
            mission_row = NEW._jl_mission_row(cur, mid)
            cur.execute("SELECT count(*) FROM mission_participants "
                        "WHERE mission_id = %s AND roster_active = true", (mid,))
            roster = cur.fetchone()[0]
            counter.reset()                      # measure only materialize_jl_segments
            mod.materialize_jl_segments(cur, mid, mission_row, user_id=ACTOR["id"])
            calls = list(counter.sql)            # before snapshot_jl (its reads aren't ours)
            snap = snapshot_jl(cur, mid, pids)
            writes = [c for c in calls if c[0].upper().startswith(WRITE_PREFIXES)]
            reads = [c for c in calls if c[0].upper().startswith("SELECT")]
            return {"snap": snap, "writes": writes, "reads": len(reads),
                    "calls": len(calls), "sql": calls, "roster": roster}
        finally:
            conn.rollback()                      # test DB, but keep the seed pristine
            cur.close()
    finally:
        conn.close()


def seed_materialize(cur):
    cases = {}

    # MB1 — update / reuse / fallback / legacy-untouched / no-periods / inactive roster
    m = new_mission(cur, "N1-M1", status="Active")
    new_route(cur, m, "مسار A", "2026-08-20", "08:00", "2026-08-20", "18:00")
    j1 = new_jl_entry(cur, m, "دخول", "join", "2026-08-20 10:00:00")
    l1 = new_jl_entry(cur, m, "خروج", "leave", "2026-08-20 14:00:00")
    j2 = new_jl_entry(cur, m, "دخول2", "join", "2026-08-20 09:00:00")
    l3 = new_jl_entry(cur, m, "خروج3", "leave", "2026-08-20 16:00:00")

    p1 = new_participant(cur, m, "P1 تحديث في المكان", sfm=False)
    assign(cur, m, p1, NEW.jl_key("join", "دخول"))
    assign(cur, m, p1, NEW.jl_key("leave", "خروج"))
    new_session(cur, p1, m, "2026-08-20", "10:00", "14:00",
                "2026-08-20 10:00:00", "2026-08-20 14:00:00", "انضمام", None, j1, l1)

    p2 = new_participant(cur, m, "P2 إعادة استخدام البداية", sfm=False)
    assign(cur, m, p2, NEW.jl_key("join", "دخول2"))
    new_session(cur, p2, m, "2026-08-20", "09:00", "14:00",
                "2026-08-20 09:00:00", "2026-08-20 14:00:00", "انضمام", None, j2, l1)

    p3 = new_participant(cur, m, "P3 بداية احتياطية", sfm=False)
    assign(cur, m, p3, "مسار A")
    assign(cur, m, p3, NEW.jl_key("leave", "خروج3"))
    new_session(cur, p3, m, "2026-08-20", "08:00", "16:00",
                "2026-08-20 08:00:00", "2026-08-20 16:00:00", "انضمام", None, None, l3)

    p4 = new_participant(cur, m, "P4 شريحة قديمة محفوظة", sfm=False)
    assign(cur, m, p4, NEW.jl_key("join", "دخول"))
    assign(cur, m, p4, NEW.jl_key("leave", "خروج"))
    legacy_id = new_session(cur, p4, m, "2026-08-20", "07:00", "07:30",
                            "2026-08-20 07:00:00", "2026-08-20 07:30:00",
                            "قديمة بلا وسوم", None, None, None)

    p5 = new_participant(cur, m, "P5 بلا إسناد", sfm=False)
    p6 = new_participant(cur, m, "P6 خارج الرستر", roster=False, sfm=False)
    assign(cur, m, p6, NEW.jl_key("join", "دخول"))
    p6_session = new_session(cur, p6, m, "2026-08-20", "10:00", None,
                             "2026-08-20 10:00:00", None, "انضمام", None, j1, None)

    cases["update_reuse_fallback"] = {"mid": m, "pids": [p1, p2, p3, p4, p5, p6],
                                      "legacy_id": legacy_id, "inactive_session": p6_session}

    # MB2 — catalog assignment removed entirely: tagged rows must be deleted
    m2 = new_mission(cur, "N1-M2", status="Active")
    new_route(cur, m2, "مسار B", "2026-08-20", "08:00", "2026-08-20", "18:00")
    jx = new_jl_entry(cur, m2, "انضمام ملغى", "join", "2026-08-20 09:00:00")
    lx = new_jl_entry(cur, m2, "انفصال ملغى", "leave", "2026-08-20 15:00:00")
    p7 = new_participant(cur, m2, "P7 إسناد محذوف", sfm=False)
    new_session(cur, p7, m2, "2026-08-20", "09:00", "15:00",
                "2026-08-20 09:00:00", "2026-08-20 15:00:00", "انضمام", None, jx, lx)
    cases["removed_assignment"] = {"mid": m2, "pids": [p7], "legacy_id": None, "inactive_session": None}

    # MB3 — no sessions at all: pure inserts + open period
    m3 = new_mission(cur, "N1-M3", status="Active")
    new_route(cur, m3, "مسار C", "2026-08-20", "08:00", "2026-08-20", "18:00")
    j3 = new_jl_entry(cur, m3, "انضمام مفتوح", "join", "2026-08-20 11:00:00")
    p8 = new_participant(cur, m3, "P8 إدراج جديد", sfm=False)
    assign(cur, m3, p8, NEW.jl_key("join", "انضمام مفتوح"))
    cases["fresh_inserts"] = {"mid": m3, "pids": [p8], "legacy_id": None, "inactive_session": None}

    # Same JOIN/LEAVE topology at 1 / 10 / 100 rows for state/write equivalence.
    for size in (1, 10, 100):
        scale_mid = new_mission(cur, f"N1-MS{size}", status="Active")
        new_route(cur, scale_mid, f"مسار المقياس {size}",
                  "2026-08-20", "08:00", "2026-08-20", "18:00")
        join_title = f"انضمام المقياس {size}"
        leave_title = f"انفصال المقياس {size}"
        new_jl_entry(cur, scale_mid, join_title, "join", "2026-08-20 10:00:00")
        new_jl_entry(cur, scale_mid, leave_title, "leave", "2026-08-20 12:00:00")
        scale_pids = []
        for i in range(size):
            pid = new_participant(cur, scale_mid, f"مشارك المقياس {size}/{i}", sfm=False)
            assign(cur, scale_mid, pid, NEW.jl_key("join", join_title))
            assign(cur, scale_mid, pid, NEW.jl_key("leave", leave_title))
            scale_pids.append(pid)
        cases[f"scale_{size}"] = {
            "mid": scale_mid, "pids": scale_pids,
            "legacy_id": None, "inactive_session": None,
        }

    return cases


def test_materialize(old_mod):
    print("\n=== 2) materialize_jl_segments ===")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            reset_db(cur)
        conn.commit()
        with conn.cursor() as cur:
            cases = seed_materialize(cur)
        conn.commit()
    finally:
        conn.close()

    for name, case in cases.items():
        old = run_materialize(old_mod, case["mid"], case["pids"])
        new = run_materialize(NEW, case["mid"], case["pids"])
        n = old["roster"]          # the loop only walks roster_active participants
        print(f"  · case '{name}': roster={n} / rows={len(case['pids'])}  "
              f"reads old={old['reads']} new={new['reads']}  "
              f"writes old={len(old['writes'])} new={len(new['writes'])}")
        ok(f"[{name}] final session/status/audit/realtime state identical",
           old["snap"] == new["snap"],
           f"old={json.dumps(old['snap'], ensure_ascii=False)[:400]} new={json.dumps(new['snap'], ensure_ascii=False)[:400]}")
        ok(f"[{name}] write sequence (statements + params) identical",
           old["writes"] == new["writes"],
           f"old={old['writes'][:2]} new={new['writes'][:2]}")
        ok(f"[{name}] mission status untouched by the function",
           old["snap"]["mission_status"] == "Active" and new["snap"]["mission_status"] == "Active")
        # Fixed reads are six; if segments emit notifications, dedupe is prefetched
        # once per materialization instead of one SELECT per segment.
        dedupe_reads = [
            sql for sql, _params in new["sql"]
            if sql.upper().startswith("SELECT ACTION, CREATED_AT")
            and "FROM REALTIME_EVENTS" in sql.upper()
        ]
        creator_reads = [
            sql for sql, _params in new["sql"]
            if sql.upper().startswith("SELECT ACTOR_USER_ID")
            and "FROM REALTIME_EVENTS" in sql.upper()
        ]
        ok(f"[{name}] fixed reads plus at most one creator lookup and one dedupe prefetch",
           new["reads"] == 6 + len(dedupe_reads) + len(creator_reads)
           and len(dedupe_reads) <= 1 and len(creator_reads) <= 1,
           f"old={old['reads']} new={new['reads']} dedupe={len(dedupe_reads)} creator={len(creator_reads)}")
        ok(f"[{name}] exactly 2 batch reads (ANY) + 1 hoisted status read",
           len([c for c in new["sql"] if "= ANY(" in c[0]]) == 2
           and len([c for c in new["sql"] if "FROM missions WHERE mission_id" in c[0]]) == 1,
           str([c[0][:60] for c in new["sql"] if "ANY" in c[0]]))

    # targeted invariants (behaviour, independent of old-vs-new diffing)
    mid = cases["update_reuse_fallback"]["mid"]
    pids = cases["update_reuse_fallback"]["pids"]
    out = run_materialize(NEW, mid, pids)["snap"]
    legacy_id = cases["update_reuse_fallback"]["legacy_id"]
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT notes, start_entry_id, end_entry_id FROM mission_participant_sessions "
                        "WHERE session_id = %s", (legacy_id,))
            legacy = cur.fetchone()
            cur.execute("SELECT notes FROM mission_participant_sessions WHERE session_id = %s",
                        (cases["update_reuse_fallback"]["inactive_session"],))
            inactive = cur.fetchone()
    finally:
        conn.close()
    ok("legacy untagged segment untouched", legacy == ("قديمة بلا وسوم", None, None), f"got {legacy}")
    ok("non-roster participant untouched", inactive == ("انضمام",), f"got {inactive}")


def test_trigger_assumptions():
    """Guard the status and session-state assumptions used by read prefetching."""
    print("\n=== mission-status read (hoisted) — assumptions ===")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid),
                       pg_get_functiondef(t.tgfoid)
                FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                WHERE NOT t.tgisinternal
                  AND c.relname IN ('missions', 'mission_participants',
                                    'mission_participant_sessions', 'mission_participant_itineraries')
                """)
            triggers = cur.fetchall()
    finally:
        conn.close()
    session_triggers = [t for t in triggers if t[0] == "mission_participant_sessions"]
    itinerary_triggers = [t for t in triggers if t[0] == "mission_participant_itineraries"]
    mission_status_triggers = [t for t in triggers
                               if t[0] == "missions" and "status" in t[2].lower()
                               and "field_operation_status" not in t[2].lower()]
    ok("no trigger on mission_participant_sessions", not session_triggers, str(session_triggers))
    ok("no itinerary-link trigger depends on per-row mutation ordering",
       not itinerary_triggers, str(itinerary_triggers))
    participant_session_mutators = [
        t for t in triggers
        if t[0] == "mission_participants"
        and "mission_participant_sessions" in (t[3] or "").lower()
    ]
    ok("no participant trigger mutates sessions behind the prefetched snapshot",
       not participant_session_mutators, str(participant_session_mutators))
    ok("no trigger updates missions.status on our writes", not mission_status_triggers,
       str(mission_status_triggers))



# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: participant identity batch, recipient dedupe, session-presence batch,
# cross-source earthquake candidates, and batched local catalog-history reads.
# ─────────────────────────────────────────────────────────────────────────────
def test_identity_batch(old_mod):
    print("\n=== Phase 2) participant identity batch ===")
    conn = get_connection()
    counter = Counter()
    proxy_cur = None
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            reset_db(cur)
            tag = _uuid.uuid4().hex[:10].upper()
            m_open = new_mission(cur, f"N1-ID-OPEN-{tag}")
            m_closed = new_mission(cur, f"N1-ID-CLOSED-{tag}")

            def volunteer_with_user(membership):
                cur.execute(
                    "INSERT INTO volunteers (full_name, phone, branch_id, membership_number) "
                    "VALUES (%s, NULL, NULL, %s) RETURNING volunteer_id",
                    (f"Identity {membership}", membership),
                )
                vid = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO users (full_name, username, role) VALUES (%s, %s, 'owner') RETURNING user_id",
                    (f"Identity {membership}", membership),
                )
                return vid

            open_mem = f"N1OPEN{tag}"
            closed_mem = f"N1CLOSED{tag}"
            open_vid = volunteer_with_user(open_mem)
            closed_vid = volunteer_with_user(closed_mem)

            open_pid = new_participant(cur, m_open, "linked-open")
            cur.execute(
                "UPDATE mission_participants SET membership_number=%s, volunteer_id=%s, branch_id=NULL "
                "WHERE participant_id=%s", (open_mem, open_vid, open_pid),
            )
            new_session(cur, open_pid, m_open, "2026-08-20", "08:00", None,
                        "2026-08-20 08:00:00", None, "open")
            closed_pid = new_participant(cur, m_closed, "linked-closed")
            cur.execute(
                "UPDATE mission_participants SET membership_number=%s, volunteer_id=%s, branch_id=NULL "
                "WHERE participant_id=%s", (closed_mem, closed_vid, closed_pid),
            )
            new_session(cur, closed_pid, m_closed, "2026-08-20", "08:00", "12:00",
                        "2026-08-20 08:00:00", "2026-08-20 12:00:00", "closed")

            unlinked_mem = f"N1UNLINKED{tag}"
            unlinked_pid = new_participant(cur, m_open, "unlinked-open")
            cur.execute(
                "UPDATE mission_participants SET membership_number=%s, volunteer_id=NULL, branch_id=NULL "
                "WHERE participant_id=%s", (unlinked_mem, unlinked_pid),
            )
            new_session(cur, unlinked_pid, m_open, "2026-08-20", "09:00", None,
                        "2026-08-20 09:00:00", None, "unlinked open")

            parts = [
                SimpleNamespace(participant_type="volunteer", participation_role=open_mem, branch_id=None),
                SimpleNamespace(participant_type="volunteer", participation_role=closed_mem, branch_id=None),
                SimpleNamespace(participant_type="volunteer", participation_role=unlinked_mem, branch_id=None),
                SimpleNamespace(participant_type="volunteer", participation_role=f"N1MISSING{tag}", branch_id=None),
                SimpleNamespace(participant_type="non_volunteer", participation_role="", branch_id=None),
            ]
            # Repeat the real input objects at 1 / 10 / 100 rows to measure slope without
            # changing fixture state between the old and new implementation.
            for size in (1, 10, 100):
                sample = [parts[i % len(parts)] for i in range(size)]
                counter.reset()
                old_results = [old_mod.resolve_participant_identity(cur, part) for part in sample]
                old_queries = counter.n
                counter.reset()
                batch_results = NEW.resolve_participant_identities(cur, sample)
                new_queries = counter.n
                same = old_results == [tuple(item[:5]) for item in batch_results]
                ok(f"[identity {size}] batch results equal single-row resolver", same)
                ok(f"[identity {size}] one read round trip for non-empty batch", new_queries == 1,
                   f"got {new_queries}")
                ok(f"[identity {size}] old helper issues repeated reads", old_queries > new_queries,
                   f"old={old_queries}, batch={new_queries}")

            counter.reset()
            old_excluded = old_mod.resolve_participant_identity(cur, parts[0], exclude_mission_id=m_open)
            old_excluded_queries = counter.n
            counter.reset()
            new_excluded = NEW.resolve_participant_identities(cur, [parts[0]], exclude_mission_id=m_open)[0]
            ok("[identity exclusion] same-mission exclusion remains equivalent",
               old_excluded == tuple(new_excluded[:5]),
               f"old={old_excluded} new={new_excluded[:5]}")
            ok("[identity exclusion] batch query count fixed", counter.n == 1,
               f"got {counter.n}; old queries={old_excluded_queries}")
    except Exception as exc:
        ok("identity batch fixture and equivalence checks complete", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_notification_batch(old_mod):
    print("\\n=== Phase 2) notification recipient dedupe ===")

    class FakeCursor:
        def __init__(self, existing):
            self.existing = set(existing)
            self.counter = Counter()
            self.rows = []
            self.one = None

        def execute(self, sql, params=None):
            self.counter.n += 1
            if "details @>" in sql and "target_user_id = ANY" in sql:
                requested = params[1]
                self.rows = [(uid,) for uid in requested if uid in self.existing]
                self.one = None
            elif "target_user_id = ANY" in sql:
                requested = params[4]
                self.rows = [
                    (uid, "اكتملت المهمة: N1 test mission — بانتظار مراجعة إدارة الشباب")
                    for uid in requested if uid in self.existing
                ]
                self.one = None
            elif "SELECT 1 FROM realtime_events" in sql:
                self.one = (1,) if params[1] in self.existing else None
                self.rows = []
            else:
                raise AssertionError(f"unexpected notification SQL: {sql}")

        def fetchall(self):
            return self.rows

        def fetchone(self):
            return self.one

    previous_status = "Completed"
    for size in (1, 10, 100):
        recipients = [101] + [102 + i for i in range(size)] + [102, 103]

        def run(mod):
            existing = {102}
            sent = []
            cursor = FakeCursor(existing)
            saved_find = mod.find_youth_account_ids
            saved_emit = mod.create_realtime_event
            mod.find_youth_account_ids = lambda _cursor: list(recipients)

            def emit(_cursor, **kwargs):
                sent.append(kwargs["target_user_id"])
                existing.add(kwargs["target_user_id"])
                # Mirror a successful INSERT into the cursor's in-transaction read view.
                cursor.existing.add(kwargs["target_user_id"])

            mod.create_realtime_event = emit
            try:
                mod.notify_youth_of_completion(
                    cursor, 555, "N1 test mission", 101, previous_status=previous_status
                )
                return sent, cursor.counter.n
            finally:
                mod.find_youth_account_ids = saved_find
                mod.create_realtime_event = saved_emit

        old_sent, old_queries = run(old_mod)
        new_sent, new_queries = run(NEW)
        eligible_rows = sum(uid != 101 for uid in recipients)
        ok(f"[notification {size}] recipient behavior unchanged",
           old_sent == new_sent, f"old={old_sent[:12]} new={new_sent[:12]}")
        ok(f"[notification {size}] legacy reads follow recipient-row count",
           old_queries == eligible_rows, f"old={old_queries} expected={eligible_rows}")
        ok(f"[notification {size}] current recipient checks use two batch SELECTs",
           new_queries == 2, f"new={new_queries}")



def test_recent_realtime_dedupe_window():
    print("\n=== Phase 2) realtime dedupe window semantics ===")
    now = _datetime.now(NEW.ZoneInfo("Africa/Cairo")).replace(tzinfo=None)
    fresh_at = now - _timedelta(seconds=5)
    expired_at = now - _timedelta(seconds=REALTIME.DEDUPE_WINDOW_SECONDS + 5)
    same_inside = REALTIME.is_recent_duplicate_action("انضمام", "انضمام", fresh_at)
    same_outside = REALTIME.is_recent_duplicate_action("انضمام", "انضمام", expired_at)
    ok("same action inside dedupe window remains duplicate",
       same_inside is bool(REALTIME.DEDUPE_ENABLED),
       f"dedupe_enabled={REALTIME.DEDUPE_ENABLED} result={same_inside}")
    ok("same action outside dedupe window is not duplicate",
       same_outside is False, f"result={same_outside}")


def test_participant_notification_dedupe_batch():
    print("\\n=== Phase 2) participant notification dedupe batch ===")

    class FakeCursor:
        def __init__(self):
            self.counter = Counter()
            self.rows = []

        def execute(self, sql, params=None):
            self.counter.n += 1
            if "target_user_id = ANY" not in sql:
                raise AssertionError(f"unexpected realtime SQL: {sql}")
            requested = params[4]
            self.rows = [(103, "تم تحديث مهمتك: مهمة N1")]
            self.rows = [row for row in self.rows if row[0] in requested]

        def fetchall(self):
            return self.rows

    saved_enabled = REALTIME.DEDUPE_ENABLED
    saved_emit = REALTIME.create_realtime_event
    REALTIME.DEDUPE_ENABLED = True
    try:
        for size in (1, 10, 100):
            cursor = FakeCursor()
            emitted = []
            recipients = [101] + [102 + i for i in range(size)] + [102, 103, 104, None, 0]
            REALTIME.create_realtime_event = lambda _cur, **kwargs: emitted.append(kwargs)
            REALTIME.notify_participant_accounts(cursor, 555, "مهمة N1", 101, recipients)
            targets = [item["target_user_id"] for item in emitted]
            expected = [uid for uid in dict.fromkeys(recipients) if uid and uid != 101 and uid != 103]
            ok(f"[participant fan-out {size}] unique recipients and actor filtering preserved",
               targets == expected, f"expected={expected[:12]} actual={targets[:12]}")
            ok(f"[participant fan-out {size}] one dedupe SELECT for all recipients",
               cursor.counter.n == 1, f"queries={cursor.counter.n}")
            ok(f"[participant fan-out {size}] prechecked inserts remain marked",
               all(item.get("dedupe_prechecked") is True for item in emitted))
    finally:
        REALTIME.DEDUPE_ENABLED = saved_enabled
        REALTIME.create_realtime_event = saved_emit



def test_realtime_dedupe_is_recipient_scoped():
    print("\n=== Phase 2) realtime dedupe is recipient-scoped ===")

    class FakeCursor:
        def __init__(self):
            self.events = []
            self.next_id = 1
            self.one = None
            self.selects = 0
            self.inserts = 0

        def execute(self, sql, params=None):
            if "SELECT event_id, action, created_at" in sql:
                self.selects += 1
                event_type, entity_id, mission_id, actor_id, target_id, _window = params
                matches = [
                    event for event in self.events
                    if event["event_type"] == event_type
                    and event["entity_id"] == entity_id
                    and event["mission_id"] == mission_id
                    and event["actor_user_id"] == actor_id
                    and event["target_user_id"] == target_id
                ]
                self.one = (
                    (matches[-1]["event_id"], matches[-1]["action"], matches[-1]["created_at"])
                    if matches else None
                )
            elif "INSERT INTO realtime_events" in sql:
                self.inserts += 1
                event_type, action, actor_id, mission_id, entity_id, target_id, _details = params
                created_at = _datetime(2026, 10, 22, 12, 0, self.next_id)
                self.events.append({
                    "event_id": self.next_id, "event_type": event_type, "action": action,
                    "actor_user_id": actor_id, "mission_id": mission_id,
                    "entity_id": entity_id, "target_user_id": target_id,
                    "created_at": created_at,
                })
                self.one = (self.next_id, created_at)
                self.next_id += 1
            else:
                raise AssertionError(f"unexpected realtime SQL: {sql}")

        def fetchone(self):
            return self.one

    saved_enabled = REALTIME.DEDUPE_ENABLED
    REALTIME.DEDUPE_ENABLED = True
    cursor = FakeCursor()
    try:
        action = "تم تحديث مهمتك: مهمة اختبار"
        REALTIME.create_realtime_event(
            cursor, event_type="mission", action=action, actor_user_id=7,
            mission_id=900, target_user_id=11,
        )
        REALTIME.create_realtime_event(
            cursor, event_type="mission", action=action, actor_user_id=7,
            mission_id=900, target_user_id=12,
        )
        REALTIME.create_realtime_event(
            cursor, event_type="mission", action=action, actor_user_id=7,
            mission_id=900, target_user_id=11,
        )
    finally:
        REALTIME.DEDUPE_ENABLED = saved_enabled

    targets = [event["target_user_id"] for event in cursor.events]
    ok("same action reaches distinct recipients but dedupes same recipient",
       targets == [11, 12], f"targets={targets}")
    ok("recipient-scoped duplicate lookup runs before each non-prechecked insert",
       cursor.selects == 3 and cursor.inserts == 2,
       f"selects={cursor.selects} inserts={cursor.inserts}")


def test_wireless_delivery_batch(old_mod):
    print("\\n=== Phase 2) wireless handover device-list N+1 ===")

    class FakeCursor:
        def __init__(self, devices_by_delivery):
            self.devices_by_delivery = devices_by_delivery
            self.rows = []

        def execute(self, sql, params=None):
            if "FROM wireless_delivery_devices" not in sql:
                raise AssertionError(f"unexpected wireless SQL: {sql}")
            if "delivery_id = ANY" in sql:
                ids = set(params[0])
                self.rows = [
                    (delivery_id, *device)
                    for delivery_id in ids
                    for device in self.devices_by_delivery.get(delivery_id, [])
                ]
                self.rows.sort(key=lambda row: (row[0], row[1]))
            else:
                self.rows = sorted(self.devices_by_delivery.get(params[0], []), key=lambda row: row[0])

        def fetchall(self):
            return self.rows

    def delivery_row(delivery_id, status="مسلَّم"):
        return (
            delivery_id, f"WH-{delivery_id}", f"مستلم {delivery_id}", "", None,
            "قسم العمليات", _date(2026, 10, 22), "مهمة", "", "القاهرة",
            "", status, _datetime(2026, 10, 22, 11, 30), "",
            _datetime(2026, 10, 22, 10, 0), "وجهة",
        )

    for size in (1, 10, 100):
        start_id = 2000 + size * 100
        devices_by_delivery = {}
        rows = []
        for index in range(size):
            delivery_id = start_id + index
            if (index + 1) % 3 == 0:
                devices = []
            elif (index + 1) % 3 == 1:
                devices = [
                    (delivery_id * 10 + 1, "MOTOROLA", f"SN-{delivery_id}-A", "battery", "سليم", ""),
                    (delivery_id * 10 + 2, "HUAWEI", f"SN-{delivery_id}-B", None, "مستعمل", "ملاحظة"),
                ]
            else:
                devices = [(delivery_id * 10 + 1, "HUAWEI", None, None, None, None)]
            devices_by_delivery[delivery_id] = devices
            rows.append(delivery_row(delivery_id, status="مُرجَع" if index % 2 else "مسلَّم"))

        old_counter, new_counter = Counter(), Counter()
        old_cur, new_cur = FakeCursor(devices_by_delivery), FakeCursor(devices_by_delivery)
        old_values = [
            old_mod._wireless_delivery_dict(CountingCursor(old_cur, old_counter), row)
            for row in rows
        ]
        new_values = NEW._wireless_delivery_dicts(CountingCursor(new_cur, new_counter), rows)
        expected_device_counts = [len(devices_by_delivery[row[0]]) for row in rows]
        ok(f"[wireless {size}] full payloads match per-delivery reference", old_values == new_values)
        ok(f"[wireless {size}] N child-list SELECTs become one",
           old_counter.n == size and new_counter.n == 1,
           f"old={old_counter.n} new={new_counter.n}")
        ok(f"[wireless {size}] child order and empty lists are preserved",
           [len(row["devices"]) for row in new_values] == expected_device_counts)



def test_wireless_inventory_calc_batch():
    print("\n=== Phase 2) wireless inventory summary batching ===")
    _wait_for_schema(NEW, "current module")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            expected = {}
            for dtype, form_type in (("TETRA", "MOTOROLA"), ("HUAWEI", "HUAWEI")):
                cur.execute(
                    "SELECT total_count FROM wireless_inventory WHERE device_type = %s;",
                    (dtype,),
                )
                row = cur.fetchone()
                total = int(row[0]) if row else 16
                cur.execute("""
                    SELECT COUNT(*) FROM wireless_delivery_devices d
                    JOIN wireless_deliveries del ON del.delivery_id = d.delivery_id
                    WHERE d.device_type = %s AND del.status = 'مسلَّم';
                """, (form_type,))
                out_count = int(cur.fetchone()[0] or 0)
                cur.execute("""
                    SELECT COUNT(*) FROM wireless_delivery_devices d
                    JOIN wireless_deliveries del ON del.delivery_id = d.delivery_id
                    WHERE d.device_type = %s AND del.status = 'مُرجَع';
                """, (form_type,))
                returned = int(cur.fetchone()[0] or 0)
                expected[dtype] = {
                    "total": total, "out": out_count,
                    "remaining": max(0, total - out_count), "returned": returned,
                }
            old_queries = counter.n
            counter.reset()
            actual = NEW._wireless_inventory_calc(cur)
            new_queries = counter.n
        ok("wireless inventory counts unchanged", expected == actual,
           f"expected={expected} actual={actual}")
        ok("six summary reads become one SELECT", old_queries == 6 and new_queries == 1,
           f"old={old_queries} new={new_queries}")
    except Exception as exc:
        ok("wireless inventory fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_end_participation_presence_batch():
    print("\\n=== Phase 2) end-participation session-presence batch ===")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            reset_db(cur)
            mid = new_mission(cur, f"N1-END-{_uuid.uuid4().hex[:10].upper()}")
            ids = [new_participant(cur, mid, f"presence-{i}") for i in range(100)]
            for index, pid in enumerate(ids):
                if index % 3 == 1:
                    new_session(cur, pid, mid, "2026-08-20", "08:00", "09:00",
                                "2026-08-20 08:00:00", "2026-08-20 09:00:00", "closed")
                elif index % 3 == 2:
                    new_session(cur, pid, mid, "2026-08-20", "09:00", None,
                                "2026-08-20 09:00:00", None, "open")

            for size in (1, 10, 100):
                sample = ids[:size]
                counter.reset()
                old_presence = set()
                for pid in sample:
                    cur.execute(
                        "SELECT 1 FROM mission_participant_sessions WHERE participant_id = %s LIMIT 1",
                        (pid,),
                    )
                    if cur.fetchone():
                        old_presence.add(pid)
                old_queries = counter.n

                counter.reset()
                cur.execute(
                    "SELECT DISTINCT participant_id FROM mission_participant_sessions "
                    "WHERE participant_id = ANY(%s::int[])",
                    (sample,),
                )
                new_presence = {row[0] for row in cur.fetchall()}
                new_queries = counter.n
                ok(f"[end participation {size}] session-presence set unchanged",
                   old_presence == new_presence, f"old={old_presence} new={new_presence}")
                ok(f"[end participation {size}] N reads become one",
                   new_queries == 1 and old_queries == size,
                   f"old={old_queries} new={new_queries}")
    except Exception as exc:
        ok("end-participation presence fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()



def test_cross_source_batch():
    print("\n=== Phase 2) earthquake cross-source dedupe candidates ===")
    conn = get_connection()
    counter = Counter()
    tag = _uuid.uuid4().hex
    base_dt = _datetime(2026, 10, 22, 11, 0, 0)
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            cur.execute(
                """
                INSERT INTO earthquake_intel
                    (source, external_id, occurred_at, magnitude, latitude, longitude, sound_alert)
                VALUES ('emsc', %s, %s, 4.5, 30.0, 31.0, FALSE)
                ON CONFLICT (source, external_id) DO NOTHING
                """,
                (f"n1-cross-source-{tag}", base_dt),
            )
            for size in (1, 10, 100):
                events = [
                    {"occurred_at": base_dt + _timedelta(seconds=i),
                     "latitude": 30.0, "longitude": 31.0}
                    for i in range(size)
                ]
                old_groups = []
                counter.reset()
                for event in events:
                    cur.execute("""
                        SELECT latitude, longitude, magnitude
                        FROM earthquake_intel
                        WHERE source <> %s
                          AND occurred_at BETWEEN %s::timestamp - interval '5 minutes'
                                              AND %s::timestamp + interval '5 minutes'
                          AND latitude BETWEEN %s - 2.0 AND %s + 2.0
                          AND longitude BETWEEN %s - 3.0 AND %s + 3.0
                        LIMIT 20;
                    """, ("usgs", event["occurred_at"], event["occurred_at"],
                          event["latitude"], event["latitude"],
                          event["longitude"], event["longitude"]))
                    old_groups.append([tuple(r) for r in cur.fetchall()])
                old_queries = counter.n

                counter.reset()
                new_groups = NEW._eq_intel_cross_source_candidates(cur, "usgs", events)
                new_queries = counter.n
                ok(f"[cross-source {size}] candidate rows unchanged",
                   old_groups == new_groups, f"old first={old_groups[:1]} new first={new_groups[:1]}")
                ok(f"[cross-source {size}] N reads become one",
                   old_queries == size and new_queries == 1,
                   f"old={old_queries} new={new_queries}")
    except Exception as exc:
        ok("cross-source batch fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_cross_source_fallback_batch():
    print("\n=== Phase 2) earthquake degraded-path fallback batching ===")
    _wait_for_schema(NEW, "current module")
    conn = get_connection()
    counter = Counter()
    original_batch = NEW._eq_intel_cross_source_candidates
    tag = _uuid.uuid4().hex
    base_dt = _datetime(2026, 10, 22, 11, 0, 0)
    try:
        with conn.cursor() as raw:
            raw.execute("""
                INSERT INTO earthquake_intel
                    (source, external_id, occurred_at, magnitude, latitude, longitude, sound_alert)
                VALUES ('emsc', %s, %s, 4.5, 30.0, 31.0, FALSE)
                ON CONFLICT (source, external_id) DO NOTHING
            """, (f"n1-cross-fallback-{tag}", base_dt))
        for size in (1, 10, 100):
            events = [
                {"occurred_at": base_dt + _timedelta(seconds=i),
                 "latitude": 30.0, "longitude": 31.0}
                for i in range(size)
            ]
            with conn.cursor() as raw:
                cur = CountingCursor(raw, counter)
                counter.reset()
                expected = original_batch(cur, "usgs", events)
                counter.reset()

                def fail_primary(*_args, **_kwargs):
                    raise RuntimeError("simulate array-batch failure")

                NEW._eq_intel_cross_source_candidates = fail_primary
                try:
                    actual = NEW._eq_intel_cross_source_candidates_resilient(cur, "usgs", events)
                finally:
                    NEW._eq_intel_cross_source_candidates = original_batch
                read_queries = sum(
                    1 for sql, _params in counter.sql
                    if sql.lstrip().upper().startswith(("SELECT", "WITH"))
                )
                ok(f"[cross-source fallback {size}] candidate groups unchanged",
                   expected == actual)
                ok(f"[cross-source fallback {size}] one batch read after primary failure",
                   read_queries == 1, f"SELECT/WITH queries={read_queries}")
    except Exception as exc:
        ok("cross-source fallback fixture completes", False, repr(exc))
    finally:
        NEW._eq_intel_cross_source_candidates = original_batch
        conn.rollback()
        conn.close()


def test_local_history_batch(old_mod):
    print("\n=== Phase 2) primary local earthquake history batch ===")
    conn = get_connection()
    counter = Counter()
    saved_get_connection = old_mod.get_connection
    proxy = CountingConnection(conn, counter)
    old_mod.get_connection = lambda: proxy
    tag = _uuid.uuid4().hex
    event_date = _date(2026, 10, 22)
    try:
        with conn.cursor() as raw:
            raw.execute("""
                INSERT INTO earthquake_catalog
                    (source, external_id, occurred_at, magnitude, depth_km, place,
                     latitude, longitude, region_id)
                VALUES ('usgs', %s, '2022-10-22 09:00:00', 4.7, 5, 'N1 test event',
                        30.0444, 31.2357, 'world')
                ON CONFLICT (source, external_id) DO NOTHING
            """, (f"n1-local-hist-{tag}",))
        for size in (1, 10, 100):
            items = [
                (900000 + i, 30.0444, 31.2357, event_date)
                for i in range(size)
            ]
            counter.reset()
            old_values = [
                old_mod._eq_catalog_local_hist(lat, lon, day, NEW.EQ_INTEL_HIST_RADIUS_KM)
                for _eq_id, lat, lon, day in items
            ]
            old_queries = counter.n

            counter.reset()
            with conn.cursor() as raw:
                new_values = NEW._eq_catalog_local_hist_batch(
                    CountingCursor(raw, counter), items, NEW.EQ_INTEL_HIST_RADIUS_KM
                )
            new_queries = counter.n
            ok(f"[local history {size}] aggregate outputs equal",
               old_values == [new_values.get(item[0]) for item in items])
            ok(f"[local history {size}] 2N reads become one SELECT",
               old_queries == 2 * size and new_queries == 1,
               f"old={old_queries} new={new_queries}")
    except Exception as exc:
        ok("local history batch fixture completes", False, repr(exc))
    finally:
        old_mod.get_connection = saved_get_connection
        conn.rollback()
        conn.close()


def test_catalog_baseline_batch():
    print("\n=== Phase 2) regional earthquake catalog summary batching ===")
    _wait_for_schema(NEW, "current module")
    conn = get_connection()
    counter = Counter()
    proxy = CountingConnection(conn, counter)
    saved_get_connection = NEW.get_connection
    NEW.get_connection = lambda: proxy
    try:
        now_doy = _datetime.now(NEW.ZoneInfo("Africa/Cairo")).timetuple().tm_yday
        expected = []
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            for zone in NEW.EQ_CATALOG_REGIONS:
                cur.execute("""
                    SELECT COALESCE(MAX(magnitude), NULL), COUNT(*)
                    FROM earthquake_catalog
                    WHERE region_id = %s AND magnitude IS NOT NULL
                      AND occurred_at IS NOT NULL
                      AND (
                            ABS(date_part('doy', occurred_at)::int - %s) <= %s
                            OR 365 - ABS(date_part('doy', occurred_at)::int - %s) <= %s
                      );
                """, (zone["id"], now_doy, NEW.EQ_INTEL_HIST_WINDOW_DAYS,
                      now_doy, NEW.EQ_INTEL_HIST_WINDOW_DAYS))
                mx, cnt = cur.fetchone()
                cur.execute(
                    "SELECT COUNT(*) FROM earthquake_catalog WHERE region_id = %s;",
                    (zone["id"],),
                )
                total = cur.fetchone()[0]
                expected.append({
                    "id": zone["id"], "ar": zone["ar"], "en": zone["en"],
                    "season_max_mag": mx, "season_count": int(cnt or 0),
                    "total_count": int(total or 0),
                })
        old_queries = counter.n
        counter.reset()
        actual = NEW._eq_catalog_baseline_zones()
        new_queries = counter.n
        ok("regional catalog summary outputs unchanged", expected == actual)
        ok("two reads per configured region become one SELECT",
           old_queries == 2 * len(NEW.EQ_CATALOG_REGIONS) and new_queries == 1,
           f"regions={len(NEW.EQ_CATALOG_REGIONS)} old={old_queries} new={new_queries}")
    except Exception as exc:
        ok("regional catalog summary fixture completes", False, repr(exc))
    finally:
        NEW.get_connection = saved_get_connection
        conn.rollback()
        conn.close()


def test_secondary_history_batch(old_mod):
    print("\n=== Phase 2) secondary local earthquake history batch ===")
    conn = get_connection()
    counter = Counter()
    proxy = CountingConnection(conn, counter)
    saved_get_connection = old_mod.get_connection
    saved_ready = old_mod._eq_catalog_ready_cached
    old_mod.get_connection = lambda: proxy
    old_mod._eq_catalog_ready_cached = lambda: True
    tag = _uuid.uuid4().hex
    event_date = _date(2026, 10, 22)
    try:
        with conn.cursor() as raw:
            raw.execute("""
                INSERT INTO earthquake_catalog
                    (source, external_id, occurred_at, magnitude, depth_km, place,
                     latitude, longitude, region_id)
                VALUES ('usgs', %s, '2022-10-22 09:00:00', 4.7, 5, 'N1 test event',
                        30.0, 31.2, 'world')
                ON CONFLICT (source, external_id) DO NOTHING
            """, (f"n1-secondary-hist-{tag}",))

        for size in (1, 10, 100):
            items = [
                (910000 + i, 30.0 + (i / 10.0), 31.2, event_date)
                for i in range(size)
            ]
            old_values = []
            counter.reset()
            for _eq_id, lat, lon, day in items:
                old_mod._EQ_INTEL_HIST_MEM_CACHE.clear()
                old_values.append(old_mod._eq_intel_fetch_history(
                    lat, lon, day, old_mod.EQ_INTEL_HIST_RADIUS_KM
                ))
            old_queries = counter.n

            NEW._EQ_INTEL_HIST_MEM_CACHE.clear()
            counter.reset()
            with conn.cursor() as raw:
                new_values = NEW._eq_intel_fetch_history_batch_local(
                    CountingCursor(raw, counter), items, NEW.EQ_INTEL_HIST_RADIUS_KM
                )
            new_queries = counter.n
            ok(f"[secondary history {size}] outputs equal to cached single-row SQL",
               old_values == [new_values.get(item[0]) for item in items])
            ok(f"[secondary history {size}] N local reads become one SELECT",
               old_queries == size and new_queries == 1,
               f"old={old_queries} new={new_queries}")
    except Exception as exc:
        ok("secondary history batch fixture completes", False, repr(exc))
    finally:
        old_mod.get_connection = saved_get_connection
        old_mod._eq_catalog_ready_cached = saved_ready
        conn.rollback()
        conn.close()


def test_world_catalog_year_window_batch():
    print("\n=== Phase 2) world catalog year-window checks ===")
    _wait_for_schema(NEW, "current module")
    conn = get_connection()
    counter = Counter()
    tag = _uuid.uuid4().hex
    windows = [
        (_datetime(1990 + 2 * i, 1, 1), _datetime(1991 + 2 * i, 1, 1))
        for i in range(100)
    ]
    try:
        with conn.cursor() as raw:
            raw.executemany("""
                INSERT INTO earthquake_catalog
                    (source, external_id, occurred_at, magnitude, latitude, longitude, region_id)
                VALUES ('usgs', %s, %s, 4.1, 0, 0, 'world')
                ON CONFLICT (source, external_id) DO NOTHING
            """, [
                (f"n1-world-window-{tag}-{i}", start + _timedelta(days=1))
                for i, (start, _end) in enumerate(windows) if i % 3 == 0
            ])
            cur = CountingCursor(raw, counter)
            for size in (1, 10, 100):
                sample = windows[:size]
                counter.reset()
                expected = set()
                for index, (start, end) in enumerate(sample):
                    cur.execute("""
                        SELECT 1 FROM earthquake_catalog
                        WHERE region_id='world' AND occurred_at >= %s AND occurred_at < %s
                        LIMIT 1;
                    """, (start, end))
                    if cur.fetchone():
                        expected.add(index)
                old_queries = counter.n
                for label, finder in (
                    ("runtime", NEW._eq_world_filled_year_windows),
                    ("maintenance", WORLD_BACKFILL._find_filled_year_window_indexes),
                ):
                    counter.reset()
                    actual = finder(cur, sample)
                    new_queries = counter.n
                    ok(f"[world windows {size}/{label}] filled indexes unchanged",
                       expected == actual, f"old={sorted(expected)} new={sorted(actual)}")
                    ok(f"[world windows {size}/{label}] N year checks become one SELECT",
                       old_queries == size and new_queries == 1,
                       f"old={old_queries} new={new_queries}")
    except Exception as exc:
        ok("world catalog window fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_update_user_branches_route_batch():
    print("\n=== Phase 3) user branch endpoint batching ===")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            raw.execute("""
                CREATE TEMP TABLE users (
                    user_id INTEGER PRIMARY KEY
                ) ON COMMIT DROP;
            """)
            raw.execute("""
                CREATE TEMP TABLE branches (
                    branch_id INTEGER PRIMARY KEY,
                    is_active BOOLEAN NOT NULL
                ) ON COMMIT DROP;
            """)
            raw.execute("""
                CREATE TEMP TABLE user_branches (
                    sequence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    branch_id INTEGER NOT NULL
                ) ON COMMIT DROP;
            """)
            raw.execute("INSERT INTO users (user_id) VALUES (901)")
            raw.executemany(
                "INSERT INTO branches (branch_id, is_active) VALUES (%s, TRUE)",
                [(branch_id,) for branch_id in range(1, 101)],
            )

        proxy = CountingConnection(conn, counter)
        branch_ids = [100] + list(range(1, 100))
        counter.reset()
        result = USER_ROUTER.update_user_branches(
            901,
            USER_ROUTER.UpdateUserBranchesRequest(branch_ids=branch_ids),
            credentials=None,
            connection=proxy,
        )
        calls = counter.n
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, branch_id FROM user_branches WHERE user_id=901 ORDER BY sequence_id"
            )
            links = cur.fetchall()
        ok("user branch endpoint returns submitted IDs in original order",
           result["branch_ids"] == branch_ids and links == [(901, branch_id) for branch_id in branch_ids],
           f"response={result.get('branch_ids', [])[:5]} links={links[:5]}")
        ok("100 branch links use a fixed four cursor calls including validation and delete",
           calls == 4, f"driver calls={calls}")

        # Invalid IDs must be rejected before DELETE, preserving the previously stored links.
        counter.reset()
        rejected = False
        try:
            USER_ROUTER.update_user_branches(
                901,
                USER_ROUTER.UpdateUserBranchesRequest(branch_ids=[1001]),
                credentials=None,
                connection=proxy,
            )
        except Exception as exc:
            rejected = getattr(exc, "status_code", None) == 400
        invalid_calls = counter.n
        with conn.cursor() as cur:
            cur.execute(
                "SELECT user_id, branch_id FROM user_branches WHERE user_id=901 ORDER BY sequence_id"
            )
            after_invalid = cur.fetchall()
        ok("invalid branch IDs are rejected before any link mutation",
           rejected and after_invalid == links, f"rejected={rejected} rows_preserved={after_invalid == links}")
        ok("invalid branch payload performs only the two validation reads",
           invalid_calls == 2, f"driver calls={invalid_calls}")

        counter.reset()
        empty_result = USER_ROUTER.update_user_branches(
            901,
            USER_ROUTER.UpdateUserBranchesRequest(branch_ids=[]),
            credentials=None,
            connection=proxy,
        )
        empty_calls = counter.n
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM user_branches WHERE user_id=901")
            remaining = cur.fetchone()[0]
        ok("empty branch list keeps the explicit clear-all behavior",
           empty_result["branch_ids"] == [] and remaining == 0,
           f"remaining={remaining}")
        ok("empty branch list skips branch lookup and insert batch",
           empty_calls == 2, f"driver calls={empty_calls}")
    except Exception as exc:
        ok("user branch endpoint batching fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_jl_event_preserves_creator_recipient():
    print("\n=== Review fix) join/leave event creator recipient ===")

    def run_case(actor_id, creator_id):
        audit_calls = []
        dedupe_targets = []
        event_calls = []
        now_at = _datetime(2026, 10, 23, 12, 0, 0)

        def fake_audit(*args, **kwargs):
            audit_calls.append((args, kwargs))

        def fake_dedupe(_cursor, **kwargs):
            dedupe_targets.append(kwargs["target_user_id"])
            return None

        def fake_emit(_cursor, **kwargs):
            event_calls.append(kwargs)
            return (501, now_at)

        state = {}
        with patch.object(NEW, "create_audit_log", side_effect=fake_audit), \
             patch.object(NEW, "resolve_mission_creator", return_value=creator_id) as resolve_creator, \
             patch.object(NEW, "get_latest_recent_event_action", side_effect=fake_dedupe), \
             patch.object(NEW, "is_recent_duplicate_action", return_value=False), \
             patch.object(NEW, "create_realtime_event", side_effect=fake_emit):
            NEW._emit_jl_event(
                object(), 900, actor_id,
                {
                    "end_entry_id": None,
                    "participant_name": "مشارك اختبار",
                    "mission_name": "مهمة اختبار",
                    "start": _datetime(2026, 10, 23, 10, 0, 0),
                },
                state,
            )

        return {
            "audit_calls": audit_calls,
            "dedupe_targets": dedupe_targets,
            "event_calls": event_calls,
            "resolve_calls": resolve_creator.call_count,
            "state": state,
        }

    creator_actor = run_case(actor_id=41, creator_id=41)
    different_actor = run_case(actor_id=88, creator_id=41)
    ok("when the creator acts, event remains untargeted as before",
       len(creator_actor["event_calls"]) == 1
       and creator_actor["event_calls"][0]["target_user_id"] is None
       and creator_actor["dedupe_targets"] == [None],
       f"events={creator_actor['event_calls']} lookup={creator_actor['dedupe_targets']}")
    ok("when another user acts, event and dedupe are directed to the mission creator",
       len(different_actor["event_calls"]) == 1
       and different_actor["event_calls"][0]["target_user_id"] == 41
       and different_actor["dedupe_targets"] == [41],
       f"events={different_actor['event_calls']} lookup={different_actor['dedupe_targets']}")
    ok("creator is resolved once per materialization and audit remains separate",
       creator_actor["resolve_calls"] == different_actor["resolve_calls"] == 1
       and creator_actor["audit_calls"][0][1]["realtime"] is False
       and different_actor["audit_calls"][0][1]["realtime"] is False
       and all(event.get("dedupe_prechecked") is True
               for event in creator_actor["event_calls"] + different_actor["event_calls"]))


def test_weather_history_mixed_numeric_batch():
    print("\n=== Review fix) weather mixed numeric array types ===")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            cur.execute("""
                CREATE TEMP TABLE weather_history_daily (
                    location_id INTEGER NOT NULL,
                    record_date DATE NOT NULL,
                    tmax DOUBLE PRECISION,
                    tmin DOUBLE PRECISION,
                    precip_mm DOUBLE PRECISION,
                    wind_max_kph DOUBLE PRECISION,
                    wind_gusts_kph DOUBLE PRECISION,
                    humidity_mean_pct DOUBLE PRECISION,
                    cloud_cover_mean_pct DOUBLE PRECISION,
                    data_source TEXT NOT NULL,
                    UNIQUE (location_id, record_date, data_source)
                ) ON COMMIT DROP;
            """)
            rows = [
                {
                    "location_id": 501, "record_date": _date(2026, 1, 1),
                    "tmax": 24, "tmin": 13.5, "precip_mm": 0,
                    "wind_max_kph": 12, "wind_gusts_kph": 14.25,
                    "humidity_mean_pct": 70, "cloud_cover_mean_pct": None,
                    "data_source": "mixed-type-regression",
                },
                {
                    "location_id": 501, "record_date": _date(2026, 1, 2),
                    "tmax": 24.5, "tmin": 14, "precip_mm": 0.25,
                    "wind_max_kph": 12.75, "wind_gusts_kph": 15,
                    "humidity_mean_pct": None, "cloud_cover_mean_pct": 35,
                    "data_source": "mixed-type-regression",
                },
                {
                    "location_id": 501, "record_date": _date(2026, 1, 3),
                    "tmax": None, "tmin": None, "precip_mm": None,
                    "wind_max_kph": None, "wind_gusts_kph": None,
                    "humidity_mean_pct": None, "cloud_cover_mean_pct": None,
                    "data_source": "mixed-type-regression",
                },
            ]
            counter.reset()
            inserted = WEATHER_BACKFILL._insert_history_rows_cursor(cur, rows)
            calls = counter.n
            cur.execute("""
                SELECT record_date, tmax, tmin, precip_mm, wind_max_kph,
                       wind_gusts_kph, humidity_mean_pct, cloud_cover_mean_pct
                FROM weather_history_daily
                ORDER BY record_date
            """)
            stored = cur.fetchall()
            expected = [
                (_date(2026, 1, 1), 24.0, 13.5, 0.0, 12.0, 14.25, 70.0, None),
                (_date(2026, 1, 2), 24.5, 14.0, 0.25, 12.75, 15.0, None, 35.0),
                (_date(2026, 1, 3), None, None, None, None, None, None, None),
            ]
            ok("mixed ints/floats and missing weather values insert correctly",
               inserted == 3 and stored == expected,
               f"inserted={inserted} stored={stored}")
            ok("mixed numeric history still uses one SQL round trip",
               calls == 1, f"calls={calls}")

            counter.reset()
            reinserted = WEATHER_BACKFILL._insert_history_rows_cursor(cur, rows)
            ok("weather backfill remains insert-only on conflict",
               reinserted == 0 and counter.n == 1,
               f"inserted_again={reinserted} calls={counter.n}")
    except Exception as exc:
        ok("weather mixed numeric batch fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_batched_maintenance_writes():
    print("\n=== Phase 2) batched maintenance and child writes ===")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            cur.execute("""
                CREATE TEMP TABLE user_branches (
                    sequence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    branch_id INTEGER NOT NULL
                ) ON COMMIT DROP;
            """)
            counter.reset()
            USER_ROUTER._insert_user_branch_links(cur, 901, [8, 2, 7])
            calls = counter.n
            cur.execute("SELECT user_id, branch_id FROM user_branches ORDER BY sequence_id")
            links = cur.fetchall()
            ok("user branch batch preserves input order",
               links == [(901, 8), (901, 2), (901, 7)], f"links={links}")
            ok("user branch link writes use one executemany batch",
               calls == 1, f"driver calls={calls}")

            cur.execute("""
                CREATE TEMP TABLE weather_history_daily (
                    location_id INTEGER NOT NULL,
                    record_date DATE NOT NULL,
                    tmax DOUBLE PRECISION, tmin DOUBLE PRECISION,
                    precip_mm DOUBLE PRECISION, wind_max_kph DOUBLE PRECISION,
                    wind_gusts_kph DOUBLE PRECISION, humidity_mean_pct DOUBLE PRECISION,
                    cloud_cover_mean_pct DOUBLE PRECISION, data_source TEXT NOT NULL,
                    UNIQUE (location_id, record_date, data_source)
                ) ON COMMIT DROP;
            """)
            cur.execute("""
                INSERT INTO weather_history_daily
                    (location_id, record_date, tmax, data_source)
                VALUES (1, '2026-01-01', 99, 'era5-archive');
            """)
            history_rows = [
                {"location_id": 1, "record_date": "2026-01-01", "tmax": 10,
                 "data_source": "era5-archive"},
                {"location_id": 1, "record_date": "2026-01-02", "tmax": 11,
                 "data_source": "era5-archive"},
                {"location_id": 1, "record_date": "2026-01-02", "tmax": 12,
                 "data_source": "era5-archive"},
                {"location_id": 2, "record_date": "2026-01-03", "tmin": 3,
                 "data_source": "era5-archive"},
            ]
            counter.reset()
            inserted = WEATHER_BACKFILL._insert_history_rows_cursor(cur, history_rows)
            calls = counter.n
            cur.execute("""
                SELECT location_id, record_date, tmax, tmin, data_source
                FROM weather_history_daily ORDER BY location_id, record_date;
            """)
            history = cur.fetchall()
            ok("weather archive retains insert-only conflict behavior",
               inserted == 2 and history == [
                   (1, _date(2026, 1, 1), 99.0, None, "era5-archive"),
                   (1, _date(2026, 1, 2), 11.0, None, "era5-archive"),
                   (2, _date(2026, 1, 3), None, 3.0, "era5-archive"),
               ], f"inserted={inserted} rows={history}")
            ok("weather history N row inserts become one set-based statement",
               calls == 1, f"driver calls={calls}")

            cur.execute("""
                CREATE TEMP TABLE earthquake_intel (
                    eq_intel_id BIGINT PRIMARY KEY,
                    raw JSONB
                ) ON COMMIT DROP;
            """)
            cur.execute("""
                INSERT INTO earthquake_intel (eq_intel_id, raw)
                VALUES (101, '{"keep":"a"}'::jsonb), (102, NULL);
            """)
            counter.reset()
            attempted = EMSC_LINKS.update_emsc_detail_links(cur, [
                (101, "emsc-abc123"), (102, "emsc-def456"), (103, "emsc-")
            ])
            calls = counter.n
            cur.execute("SELECT eq_intel_id, raw FROM earthquake_intel ORDER BY eq_intel_id")
            link_rows = cur.fetchall()
            ok("EMSC batch preserves JSON and existing keys",
               attempted == 2 and link_rows == [
                   (101, {"keep": "a", "detail_url":
                          "https://www.seismicportal.eu/eventdetails.html?unid=abc123"}),
                   (102, {"detail_url":
                          "https://www.seismicportal.eu/eventdetails.html?unid=def456"}),
               ], f"attempted={attempted} rows={link_rows}")
            ok("EMSC N row updates become one set-based UPDATE",
               calls == 1, f"driver calls={calls}")

            cur.execute("""
                CREATE TEMP TABLE write_batch_test (
                    id INTEGER PRIMARY KEY, value TEXT NOT NULL
                ) ON COMMIT DROP;
            """)
            sql_insert = "INSERT INTO write_batch_test (id, value) VALUES (%s, %s)"
            sql_update = "UPDATE write_batch_test SET value = %s WHERE id = %s"
            operations = [
                (sql_insert, (1, "one")), (sql_insert, (2, "two")),
                (sql_update, ("ONE", 1)), (sql_insert, (3, "three")),
            ]
            counter.reset()
            NEW._execute_contiguous_batches(cur, operations)
            calls = counter.n
            cur.execute("SELECT id, value FROM write_batch_test ORDER BY id")
            state = cur.fetchall()
            ok("contiguous batches preserve operation order and final state",
               state == [(1, "ONE"), (2, "two"), (3, "three")], f"state={state}")
            ok("contiguous batching merges only adjacent identical SQL",
               calls == 3, f"driver calls={calls}")
    except Exception as exc:
        ok("batched maintenance write fixtures complete", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_end_participation_writes_batch():
    print("\n=== Phase 2) end-participation write batching ===")
    conn = get_connection()
    counter = Counter()
    now_ref = _datetime(2026, 10, 22, 12, 30, 0)
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            cur.execute("""
                CREATE TEMP TABLE mission_participants (
                    participant_id BIGINT PRIMARY KEY,
                    return_status TEXT
                ) ON COMMIT DROP;
            """)
            cur.execute("""
                CREATE TEMP TABLE mission_participant_sessions (
                    session_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    participant_id BIGINT NOT NULL, mission_id BIGINT NOT NULL,
                    session_date DATE, check_in_time TIME, check_out_time TIME,
                    end_dt TIMESTAMP, notes TEXT
                ) ON COMMIT DROP;
            """)
            raw.executemany(
                "INSERT INTO mission_participants (participant_id, return_status) VALUES (%s, %s)",
                [(pid, "مازال بالمهمة") for pid in (1, 2, 3, 4)],
            )
            raw.executemany("""
                INSERT INTO mission_participant_sessions
                    (participant_id, mission_id, session_date, check_in_time, check_out_time, end_dt, notes)
                VALUES (%s, 50, DATE '2026-10-20', TIME '08:00',
                        CASE WHEN %s = 1 THEN TIME '09:00' ELSE NULL END,
                        CASE WHEN %s = 1 THEN TIMESTAMP '2026-10-20 09:00:00' ELSE NULL END,
                        'fixture')
            """, [(1, 1, 1), (2, 2, 2)])
            counter.reset()
            NEW._apply_end_participation_writes(
                cur, [3, 4, 1, 2], {1, 2}, 50,
                _datetime(2026, 10, 22, 7, 0).time(), now_ref,
            )
            calls = counter.n
            cur.execute("SELECT participant_id, return_status FROM mission_participants ORDER BY participant_id")
            statuses = cur.fetchall()
            cur.execute("""
                SELECT participant_id, check_out_time, end_dt, notes
                FROM mission_participant_sessions ORDER BY session_id
            """)
            sessions = cur.fetchall()
            inserted = [row for row in sessions if row[3] == "إنهاء المشاركة"]
            ok("end-participation statuses and closures unchanged",
               statuses == [(pid, "تم انتهاء مهمتة") for pid in (1, 2, 3, 4)]
               and sessions[1][1] == now_ref.time() and sessions[1][2] == now_ref,
               f"statuses={statuses} sessions={sessions}")
            ok("missing-session documentation retains selected-ID order",
               [row[0] for row in inserted] == [3, 4], f"inserted={inserted}")
            ok("end-participation writes fixed at two updates plus one insert batch",
               calls == 3, f"driver calls={calls}")
    except Exception as exc:
        ok("end-participation write fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_join_leave_catalog_write_batch():
    print("\n=== Phase 2) join/leave catalog write batching ===")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            cur.execute("""
                CREATE TEMP TABLE mission_join_leave_entries (
                    entry_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    mission_id BIGINT NOT NULL, title TEXT NOT NULL,
                    kind TEXT NOT NULL, dt TIMESTAMP NOT NULL
                ) ON COMMIT DROP;
            """)
            cur.execute("""
                CREATE TEMP TABLE mission_participant_sessions (
                    start_entry_id BIGINT, end_entry_id BIGINT
                ) ON COMMIT DROP;
            """)
            cur.execute("""
                CREATE TEMP TABLE mission_participant_itineraries (
                    itinerary_group TEXT
                ) ON COMMIT DROP;
            """)
            raw.executemany("""
                INSERT INTO mission_join_leave_entries (mission_id, title, kind, dt)
                VALUES (501, %s, %s, %s)
            """, [
                (f"Entry {i}", "join" if i % 2 == 0 else "leave",
                 _datetime(2026, 10, 20, 10, 0))
                for i in range(20)
            ])
            raw.execute("SELECT entry_id, title, kind FROM mission_join_leave_entries ORDER BY entry_id")
            old_entries = raw.fetchall()
            old_ids = [row[0] for row in old_entries]
            raw.executemany("""
                INSERT INTO mission_participant_sessions (start_entry_id, end_entry_id)
                VALUES (%s, %s)
            """, [(eid, eid) for eid in old_ids])
            raw.executemany("""
                INSERT INTO mission_participant_itineraries (itinerary_group) VALUES (%s)
            """, [(NEW.jl_key(kind, title),) for _eid, title, kind in old_entries])

            submitted = [
                SimpleNamespace(entry_id=eid, title=f"Updated {i}", kind="join",
                                dt="2026-10-20 10:00")
                for i, (eid, _title, _kind) in enumerate(old_entries[:10])
            ]
            submitted.append(SimpleNamespace(
                entry_id=None, title="New Entry", kind="leave", dt="2026-10-20 11:00"
            ))
            stale_keys = [NEW.jl_key(kind, title) for _eid, title, kind in old_entries[10:]]
            counter.reset()
            NEW._sync_jl_catalog(cur, 501, submitted)
            calls = counter.n
            cur.execute("SELECT entry_id, title FROM mission_join_leave_entries WHERE mission_id=501 ORDER BY entry_id")
            entries = cur.fetchall()
            cur.execute("""
                SELECT count(*) FROM mission_participant_sessions
                WHERE start_entry_id = ANY(%s::bigint[]) OR end_entry_id = ANY(%s::bigint[])
            """, (old_ids[10:], old_ids[10:]))
            stale_sessions = cur.fetchone()[0]
            cur.execute("""
                SELECT count(*) FROM mission_participant_itineraries
                WHERE itinerary_group = ANY(%s::text[])
            """, (stale_keys,))
            stale_groups = cur.fetchone()[0]
            ok("join/leave catalog preserves in-place updates and new entry",
               len(entries) == 11 and [row[1] for row in entries[:10]] ==
               [f"Updated {i}" for i in range(10)] and entries[-1][1] == "New Entry",
               f"entries={entries}")
            ok("stale catalog child references deleted before catalog rows",
               stale_sessions == 0 and stale_groups == 0,
               f"sessions={stale_sessions} groups={stale_groups}")
            ok("catalog writes are bounded independent of 10 stale entries",
               calls == 6, f"driver calls={calls}")
    except Exception as exc:
        ok("join/leave catalog fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_mission_assignment_write_batch():
    print("\n=== Phase 3) participant itinerary assignment batching ===")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            cur.execute("""
                CREATE TEMP TABLE mission_participant_itineraries (
                    link_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    participant_id BIGINT NOT NULL,
                    mission_id BIGINT NOT NULL,
                    itinerary_group TEXT NOT NULL,
                    CONSTRAINT uq_mpi_participant_group UNIQUE (participant_id, itinerary_group)
                ) ON COMMIT DROP;
            """)
            seed = [
                (1, 700, "Day A"), (1, 700, "stale"),
                (2, 700, "old"), (3, 700, "preserved"), (4, 700, "old"),
            ]
            seed.extend((pid, 700, f"old-{pid}") for pid in range(10, 110))
            raw.executemany(
                "INSERT INTO mission_participant_itineraries (participant_id, mission_id, itinerary_group) "
                "VALUES (%s, %s, %s)",
                seed,
            )

            assignments = [
                (1, ["Day A", " Day B ", "Day A", "", None]),
                (2, []),
                (3, None),
                (4, ["   ", None]),
            ]
            assignments.extend(
                (pid, [f"Group {pid % 5}", f" Group {pid % 5} ", f" Route {pid} "])
                for pid in range(10, 110)
            )
            counter.reset()
            NEW._sync_participant_itinerary_assignments(cur, 700, assignments)
            calls = counter.n
            cur.execute("""
                SELECT participant_id, itinerary_group
                FROM mission_participant_itineraries
                WHERE mission_id=700
                ORDER BY participant_id, itinerary_group
            """)
            stored = set(cur.fetchall())

            expected = {(1, "Day A"), (1, "Day B"), (3, "preserved")}
            for pid in range(10, 110):
                expected.add((pid, f"Group {pid % 5}"))
                expected.add((pid, f"Route {pid}"))
            ok("assignment batching preserves trimming, de-duplication, clear-all and omitted-field semantics",
               stored == expected, f"stored_count={len(stored)} expected_count={len(expected)}")
            ok("100 participant assignment updates stay within three driver batches",
               calls == 3, f"driver calls={calls}")
            ok("assignment writes retain the unique-constraint conflict guard",
               "uq_mpi_participant_group" in "\n".join(sql for sql, _params in counter.sql),
               "expected ON CONFLICT ON CONSTRAINT uq_mpi_participant_group")
    except Exception as exc:
        ok("mission assignment batch fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_mission_route_write_batch():
    print("\n=== Phase 2) mission route update batching ===")
    conn = get_connection()
    counter = Counter()
    try:
        with conn.cursor() as raw:
            cur = CountingCursor(raw, counter)
            cur.execute("""
                CREATE TEMP TABLE mission_itineraries (
                    itinerary_id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                    mission_id BIGINT NOT NULL,
                    group_title TEXT, route_from TEXT, route_to TEXT,
                    departure_date TEXT, departure_time TEXT,
                    arrival_date TEXT, arrival_time TEXT
                ) ON COMMIT DROP;
            """)
            raw.executemany("""
                INSERT INTO mission_itineraries
                    (mission_id, group_title, route_from, route_to,
                     departure_date, departure_time, arrival_date, arrival_time)
                VALUES (700, %s, %s, %s, %s, %s, %s, %s)
            """, [
                ("Group A", "A", "B", "2026-10-20", "08:00", "2026-10-20", "09:00"),
                ("Group B", "B", "C", "2026-10-20", "09:00", "2026-10-20", "10:00"),
            ])
            routes = [
                SimpleNamespace(
                    itinerary_id=1, group_title="Group A updated", route_from="A2",
                    route_to="B2", departure_date="2026-10-20", departure_time="08:30",
                    arrival_date="2026-10-20", arrival_time="09:30",
                ),
                SimpleNamespace(
                    itinerary_id=2, group_title="Group B updated", route_from="B2",
                    route_to="C2", departure_date="2026-10-20", departure_time="09:30",
                    arrival_date="2026-10-20", arrival_time="10:30",
                ),
                SimpleNamespace(
                    itinerary_id=None, group_title="Group C", route_from="C", route_to="D",
                    departure_date="2026-10-20", departure_time="10:30",
                    arrival_date="2026-10-20", arrival_time="11:30",
                ),
            ]
            counter.reset()
            NEW._sync_mission_routes(cur, 700, routes)
            calls = counter.n
            cur.execute("""
                SELECT itinerary_id, group_title, route_from, route_to,
                       departure_date, departure_time, arrival_date, arrival_time
                FROM mission_itineraries WHERE mission_id=700 ORDER BY itinerary_id
            """)
            stored = cur.fetchall()
            ok("mission routes preserve IDs, locations, dates, times and insert order",
               stored == [
                   (1, "Group A updated", "A2", "B2", "2026-10-20", "08:30", "2026-10-20", "09:30"),
                   (2, "Group B updated", "B2", "C2", "2026-10-20", "09:30", "2026-10-20", "10:30"),
                   (3, "Group C", "C", "D", "2026-10-20", "10:30", "2026-10-20", "11:30"),
               ], f"stored={stored}")
            ok("consecutive route updates batch before RETURNING insert",
               calls == 3, f"driver calls={calls}")
    except Exception as exc:
        ok("mission route write fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# 3) add_global_eqs_bulk
# ─────────────────────────────────────────────────────────────────────────────
def call_bulk(mod, rows):
    counter = Counter()
    conn = get_connection()
    proxy = CountingConnection(conn, counter)
    saved = (mod.get_connection, mod.get_current_user_id)
    mod.get_connection = lambda: proxy
    mod.get_current_user_id = lambda token: ACTOR["id"]
    try:
        models = [mod.GlobalEqModel(**r) for r in rows]
        result = mod.add_global_eqs_bulk(models, SimpleNamespace(credentials="test-token"))
        with conn.cursor() as cur:
            cur.execute("SELECT date, time, latitude, longitude, magnitude FROM global_earthquakes "
                        "ORDER BY eq_id")
            stored = [tuple(str(v) for v in row) for row in cur.fetchall()]
        return {"result": result, "stored": stored, "queries": counter.n,
                "commits": proxy.commits, "rollbacks": proxy.rollbacks}
    finally:
        conn.rollback()
        mod.get_connection, mod.get_current_user_id = saved
        conn.close()


def seed_earthquakes(cur):
    cur.execute(
        """
        INSERT INTO global_earthquakes (date, month, time, country, magnitude, depth_km,
                                        region, status, longitude, latitude)
        VALUES ('2024-04-01', '04', '03:15:20', 'EG', 4.2, '10', 'R', 'ok', 31.25, 30.15),
               ('2024-04-02', '04', '05:00:00', 'EG', 3.1, '8',  'R', 'ok', 32.10, 29.10),
               ('2024-04-03', '04', '06:00:00', 'EG', 2.5, '5',  'R', 'ok', NULL, 28.00)
        """
    )


def test_earthquake_catalog_batch_insert():
    print("\n=== Phase 4) earthquake catalog bounded batch writes ===")
    conn = get_connection()
    counter = Counter()
    tag = _uuid.uuid4().hex[:10]
    timestamp_ms = int(
        _datetime(2026, 10, 22, 10, 0).replace(tzinfo=NEW.ZoneInfo("UTC")).timestamp() * 1000
    )
    try:
        with conn.cursor() as raw:
            raw.execute("""
                CREATE TEMP TABLE earthquake_catalog (
                    catalog_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    source TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    occurred_at TIMESTAMP,
                    magnitude DOUBLE PRECISION,
                    depth_km DOUBLE PRECISION,
                    place TEXT,
                    latitude DOUBLE PRECISION,
                    longitude DOUBLE PRECISION,
                    region_id TEXT NOT NULL,
                    UNIQUE (source, external_id)
                ) ON COMMIT DROP;
            """)
            raw.execute("""
                INSERT INTO earthquake_catalog
                    (source, external_id, occurred_at, magnitude, depth_km,
                     place, latitude, longitude, region_id)
                VALUES ('usgs', 'already-existing', '2020-01-01 00:00:00',
                        9.0, 12, 'Original row', 1, 2, 'seed')
            """)
            cur = CountingCursor(raw, counter)

            for size in (1, 10, 100):
                unique_features = [
                    {
                        "id": f"n1-world-batch-{tag}-{size}-{index}",
                        "properties": {
                            "time": timestamp_ms + index * 1000,
                            "mag": 4.1 + index / 100,
                            "place": f"Original feature {index}",
                        },
                        "geometry": {"coordinates": [30.0 + index / 100, 29.0 + index / 100, 5]},
                    }
                    for index in range(size)
                ]
                conflict_feature = {
                    "id": "already-existing",
                    "properties": {"time": timestamp_ms, "mag": 1.0, "place": "Must not overwrite"},
                    "geometry": {"coordinates": [80, 70, 1]},
                }
                duplicate_feature = {
                    **unique_features[0],
                    "properties": {
                        **unique_features[0]["properties"],
                        "mag": 9.9,
                        "place": "Duplicate payload",
                    },
                }
                invalid_features = [
                    {"id": "", "properties": {"time": timestamp_ms}, "geometry": {"coordinates": [1, 2, 3]}},
                    {"id": f"no-time-{tag}", "properties": {}, "geometry": {"coordinates": [1, 2, 3]}},
                    {"id": f"no-lat-{tag}", "properties": {"time": timestamp_ms}, "geometry": {"coordinates": [1, None, 3]}},
                    None,
                ]
                rows = NEW._eq_catalog_rows_from_usgs_features(
                    [conflict_feature, *unique_features, duplicate_feature, *invalid_features],
                    f"test-{size}",
                )
                counter.reset()
                inserted = NEW._eq_catalog_insert_rows(cur, rows)
                calls = counter.n
                cur.execute("""
                    SELECT external_id, magnitude, place, latitude, longitude, region_id
                    FROM earthquake_catalog
                    WHERE region_id = %s
                    ORDER BY catalog_id
                """, (f"test-{size}",))
                stored = cur.fetchall()
                expected = [
                    (
                        feature["id"],
                        feature["properties"]["mag"],
                        feature["properties"]["place"],
                        feature["geometry"]["coordinates"][1],
                        feature["geometry"]["coordinates"][0],
                        f"test-{size}",
                    )
                    for feature in unique_features
                ]
                ok(f"[catalog batch {size}] invalid features are filtered, valid order retained",
                   len(rows) == size + 2 and stored == expected,
                   f"parsed={len(rows)} stored={len(stored)} expected={len(expected)}")
                ok(f"[catalog batch {size}] conflict-aware inserted count is exact",
                   inserted == size, f"inserted={inserted} expected={size}")
                ok(f"[catalog batch {size}] non-empty batch uses one SQL round trip",
                   calls == 1, f"calls={calls}")

            cur.execute("""
                SELECT magnitude, place, latitude, longitude, region_id
                FROM earthquake_catalog WHERE external_id='already-existing'
            """)
            preserved = cur.fetchone()
            ok("catalog conflict is insert-only and existing payload remains unchanged",
               preserved == (9.0, "Original row", 1.0, 2.0, "seed"), f"stored={preserved}")

            counter.reset()
            inserted_empty = NEW._eq_catalog_insert_rows(cur, [])
            ok("empty catalog batch is a no-op without a database call",
               inserted_empty == 0 and counter.n == 0,
               f"inserted={inserted_empty} calls={counter.n}")
    except Exception as exc:
        ok("earthquake catalog batch insert fixture completes", False, repr(exc))
    finally:
        conn.rollback()
        conn.close()


def test_world_backfill_runtime_batches():
    print("\n=== Phase 4) runtime world-backfill batch and year-window regression ===")
    conn = get_connection()
    counter = Counter()
    proxy = CountingConnection(conn, counter)
    saved_get_connection = NEW.get_connection
    saved_year_finder = NEW._eq_world_filled_year_windows
    saved_year_count = NEW.EQ_INTEL_HIST_YEARS
    now_cairo = _datetime(2026, 10, 23, 12, 0)
    requested_windows = []

    def fake_get(_url, params, timeout, headers):
        requested_windows.append((params["starttime"], params["endtime"]))
        start_day = _date.fromisoformat(params["starttime"]) + _timedelta(days=1)
        event_time = _datetime.fromisoformat(f"{start_day.isoformat()}T12:00:00").replace(
            tzinfo=NEW.ZoneInfo("UTC")
        )
        timestamp_ms = int(event_time.timestamp() * 1000)
        year_tag = params["starttime"]
        features = [
            {
                "id": f"phase4-world-{year_tag}-{index}",
                "properties": {
                    "time": timestamp_ms,
                    "mag": 4.2,
                    "place": f"World fixture {year_tag} #{index}",
                },
                "geometry": {"coordinates": [31.2 + index / 1000, 30.1, 8]},
            }
            for index in range(100)
        ]
        return SimpleNamespace(ok=True, status_code=200, json=lambda: {"features": features})

    try:
        with conn.cursor() as raw:
            raw.execute("""
                CREATE TEMP TABLE earthquake_catalog (
                    catalog_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    source TEXT NOT NULL,
                    external_id TEXT NOT NULL,
                    occurred_at TIMESTAMP,
                    magnitude DOUBLE PRECISION,
                    depth_km DOUBLE PRECISION,
                    place TEXT,
                    latitude DOUBLE PRECISION,
                    longitude DOUBLE PRECISION,
                    region_id TEXT NOT NULL,
                    UNIQUE (source, external_id)
                ) ON COMMIT DROP;
            """)
        NEW.get_connection = lambda: proxy
        NEW._eq_world_filled_year_windows = lambda _cursor, _windows: set()
        NEW.EQ_INTEL_HIST_YEARS = 2
        counter.reset()
        with patch("requests.get", side_effect=fake_get):
            result = NEW._eq_world_backfill_core(now_cairo)
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM earthquake_catalog WHERE region_id='world'")
            rows_count = cur.fetchone()[0]
            cur.execute("SELECT external_id FROM earthquake_catalog ORDER BY catalog_id")
            ordered_ids = [row[0] for row in cur.fetchall()]
        expected_windows = [("2024-10-23", "2025-10-23"), ("2025-10-23", "2026-10-23")]
        ok("runtime world backfill completes without year-window errors",
           result == ("world", 200, None), f"result={result}")
        ok("runtime world backfill uses bounded, correct date windows",
           requested_windows == expected_windows, f"windows={requested_windows}")
        ok("200 events are written in two year batches, not 200 INSERTs",
           counter.n == 2 and proxy.commits == 2,
           f"sql_calls={counter.n} commits={proxy.commits}")
        ok("world backfill preserves feature order and inserts all catalog rows",
           rows_count == 200 and ordered_ids[:3] == [
               "phase4-world-2024-10-23-0",
               "phase4-world-2024-10-23-1",
               "phase4-world-2024-10-23-2",
           ] and ordered_ids[100:103] == [
               "phase4-world-2025-10-23-0",
               "phase4-world-2025-10-23-1",
               "phase4-world-2025-10-23-2",
           ], f"rows={rows_count} first={ordered_ids[:3]} year2={ordered_ids[100:103]}")
    except Exception as exc:
        ok("runtime world backfill batching fixture completes", False, repr(exc))
    finally:
        NEW.get_connection = saved_get_connection
        NEW._eq_world_filled_year_windows = saved_year_finder
        NEW.EQ_INTEL_HIST_YEARS = saved_year_count
        conn.rollback()
        conn.close()


def test_bulk(old_mod):
    print("\n=== 3) add_global_eqs_bulk ===")
    base = {"month": "05", "country": "XX", "depth_km": "10", "region": "R", "status": "ok"}

    def eq(date, time, lat, lon, mag=4.0):
        return {"date": date, "time": time, "latitude": lat, "longitude": lon,
                "magnitude": mag, **base}

    cases = {
        "empty": [],
        "all_new": [eq("2024-05-01", "10:05:30", 12.34, 45.67, 4.1),
                    eq("2024-05-02", "11:06:30", 13.35, 46.68, 4.2)],
        "all_duplicates": [eq("2024-04-01", "03:15:59", 30.15, 31.25),   # seconds differ
                           eq("2024-04-02", "05:00:00", 29.10, 32.10)],
        "mixed": [eq("2024-04-01", "03:15:00", 30.15, 31.25),           # dup
                  eq("2024-05-03", "07:00:00", 20.00, 40.00),           # new
                  eq("2024-04-03", "06:00:00", 28.00, None),            # dup (NULL lon)
                  eq("2024-05-04", "08:00:00", None, 41.00),            # new (NULL lat)
                  eq("2024-05-05", "09:00:00", -12.05, -45.05)],        # new (negative halves)
        # in-file collision: the OLD per-row SELECT re-checked the table after each
        # INSERT, so the second row was seen as a duplicate of the first one —
        # Python round() (half-even) 30.15 -> 30.1 while PostgreSQL ROUND -> 30.2.
        "in_file_rounding_collision": [eq("2024-06-01", "10:05:30", 30.15, 31.25, 4.1),
                                       eq("2024-06-01", "10:05:45", 30.16, 31.26, 4.2)],
        "in_file_exact_duplicate": [eq("2024-06-02", "10:05:30", 30.15, 31.25),
                                    eq("2024-06-02", "10:05:40", 30.15, 31.25)],
        "null_location_collision": [eq("2024-06-03", "10:05:30", None, None),
                                    eq("2024-06-03", "10:05:40", None, None)],
    }
    for size in (1, 10, 100):
        scale_rows = []
        for i in range(size):
            day = (_date(2025, 1, 1) + _timedelta(days=i)).isoformat()
            scale_rows.append(eq(day, f"{i % 24:02}:15:30",
                                 -70.0 + i * 0.2, 80.0 + i * 0.2, 4.1))
        cases[f"scale_{size}"] = scale_rows

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            reset_db(cur)
        conn.commit()
        with conn.cursor() as cur:
            seed_earthquakes(cur)
        conn.commit()
    finally:
        conn.close()

    # baseline (no rows) — every case rolls back, so the seed stays untouched
    base_old = call_bulk(old_mod, [])
    base_new = call_bulk(NEW, [])
    base_rows = len(base_old["stored"])
    ok("[empty] returned message identical", base_old["result"] == base_new["result"],
       f"old={base_old['result']} new={base_new['result']}")
    ok("[empty] stored rows identical", base_old["stored"] == base_new["stored"])
    ok("[empty] no insert/dedupe statement issued",
       base_old["queries"] == base_new["queries"],
       f"old={base_old['queries']} new={base_new['queries']}")

    for name, rows in cases.items():
        if name == "empty":
            continue
        old = call_bulk(old_mod, rows)
        new = call_bulk(NEW, rows)
        unique_rows = len({(r["date"], r["time"][:5] if r["time"] else "",
                            round(r["latitude"], 1) if r["latitude"] is not None else None,
                            round(r["longitude"], 1) if r["longitude"] is not None else None)
                           for r in rows})
        inserted = len(old["stored"]) - base_rows
        d_old = old["queries"] - base_old["queries"]
        d_new = new["queries"] - base_new["queries"]
        print(f"  · case '{name}': rows={len(rows)} unique={unique_rows} inserted={inserted}  "
              f"extra queries old={d_old} new={d_new}  old_msg={old['result']['message']!r}")
        ok(f"[{name}] returned message identical", old["result"] == new["result"],
           f"old={old['result']} new={new['result']}")
        ok(f"[{name}] stored rows identical", old["stored"] == new["stored"],
           f"old={old['stored']} new={new['stored']}")
        ok(f"[{name}] old cost = 1 check per unique row + 1 insert per new row ({unique_rows + inserted})",
           d_old == unique_rows + inserted, f"old extra={d_old} expected={unique_rows + inserted}")
        ok(f"[{name}] new cost is fixed: batch check + one executemany ({1 + 1})",
           d_new == 2, f"new extra={d_new}")
        ok(f"[{name}] commit/rollback semantics unchanged",
           old["commits"] == new["commits"] == 1 and old["rollbacks"] == new["rollbacks"] == 0,
           f"old={old['commits']}/{old['rollbacks']} new={new['commits']}/{new['rollbacks']}")


# ─────────────────────────────────────────────────────────────────────────────
def main():
    print(f"test database: {_parsed.hostname}{_parsed.path}")
    print("loading pre-Phase-1 implementation (git show 7f57fe0000c1fb36a8e3e7b996352fb4812600e0:main.py) ...")
    old_mod = load_legacy_module()
    print("loaded.\n")

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            reset_db(cur)
        conn.commit()
    finally:
        conn.close()

    test_mission_details(old_mod)
    test_materialize(old_mod)
    test_trigger_assumptions()
    test_identity_batch(old_mod)
    test_notification_batch(old_mod)
    test_recent_realtime_dedupe_window()
    test_participant_notification_dedupe_batch()
    test_realtime_dedupe_is_recipient_scoped()
    test_wireless_delivery_batch(old_mod)
    test_end_participation_presence_batch()
    test_cross_source_batch()
    test_cross_source_fallback_batch()
    test_local_history_batch(old_mod)
    test_catalog_baseline_batch()
    test_secondary_history_batch(old_mod)
    test_world_catalog_year_window_batch()
    test_earthquake_catalog_batch_insert()
    test_world_backfill_runtime_batches()
    test_wireless_inventory_calc_batch()
    test_jl_event_preserves_creator_recipient()
    test_weather_history_mixed_numeric_batch()
    test_update_user_branches_route_batch()
    test_batched_maintenance_writes()
    test_end_participation_writes_batch()
    test_join_leave_catalog_write_batch()
    test_mission_assignment_write_batch()
    test_mission_route_write_batch()
    test_bulk(old_mod)

    # leave the disposable DB empty
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            reset_db(cur)
        conn.commit()
    finally:
        conn.close()

    print(f"\nRESULT: {PASS} passed, {FAIL} failed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
