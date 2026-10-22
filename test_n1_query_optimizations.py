# -*- coding: utf-8 -*-
"""N+1 optimization proof — equivalence + measured round-trips.

Covers the three changed functions only:
  1. get_mission_details        (2 SELECTs per participant  -> 2 batch SELECTs)
  2. materialize_jl_segments    (3 queries per participant   -> 3 fixed reads)
  3. add_global_eqs_bulk        (dup-check + INSERT per row  -> 1 batch + 1 executemany)

The ORIGINAL implementations are not re-typed here: they are loaded from
`git show HEAD:main.py` and imported as a second module, so both sides run the
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
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlparse

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

# Both modules (current + HEAD) connect through db.get_connection -> DATABASE_URL.
os.environ["DATABASE_URL"] = TEST_URL
os.environ.setdefault("EOC_EQ_LOCAL_ENGINE", "0")
os.environ.setdefault("EOC_EQ_WORLD_BACKFILL", "0")
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
import main as NEW  # noqa: E402
from db import get_connection  # noqa: E402

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
# HEAD (pre-optimization) implementation loaded as its own module
# ─────────────────────────────────────────────────────────────────────────────
def load_head_module():
    src = subprocess.run(
        ["git", "show", "HEAD:main.py"], cwd=str(ROOT),
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout
    path = Path(tempfile.mkdtemp(prefix="n1_head_")) / "main_head_snapshot.py"
    path.write_text(src, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("main_head_snapshot", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["main_head_snapshot"] = mod
    spec.loader.exec_module(mod)
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
        # 3 fixed reads + 3 per participant + audit/event reads (E)  ->  6 fixed reads + E
        event_reads = old["reads"] - (3 + 3 * n)
        ok(f"[{name}] reads: 3+3N+E ({old['reads']}) -> 6+E ({new['reads']}), E={event_reads}",
           new["reads"] == 6 + event_reads, f"old={old['reads']} new={new['reads']} n={n}")
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
    """The status read was hoisted out of the loop: prove nothing can change it."""
    print("\n=== mission-status read (hoisted) — assumptions ===")
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
                FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                WHERE NOT t.tgisinternal
                  AND c.relname IN ('missions', 'mission_participants',
                                    'mission_participant_sessions', 'mission_participant_itineraries')
                """)
            triggers = cur.fetchall()
    finally:
        conn.close()
    session_triggers = [t for t in triggers if t[0] == "mission_participant_sessions"]
    mission_status_triggers = [t for t in triggers
                               if t[0] == "missions" and "status" in t[2].lower()
                               and "field_operation_status" not in t[2].lower()]
    ok("no trigger on mission_participant_sessions", not session_triggers, str(session_triggers))
    ok("no trigger updates missions.status on our writes", not mission_status_triggers,
       str(mission_status_triggers))


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
    print("loading HEAD implementation (git show HEAD:main.py) ...")
    old_mod = load_head_module()
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
