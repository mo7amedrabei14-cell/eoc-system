"""
استخبارات الطقس — Gap-aware historical backfill
================================================
Fill weather_history_daily from the Open-Meteo Archive using
weather_locations.id as the canonical identity.

The script reads existing dates from PostgreSQL before making any archive
request, converts missing dates to contiguous ranges, and requests only those
ranges. PostgreSQL remains the source of truth when the script is restarted.

Only INSERT is used. Existing historical rows are never updated or deleted:
ON CONFLICT (location_id, record_date, data_source) DO NOTHING
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Optional
from zoneinfo import ZoneInfo

try:
    import psycopg
    import requests
    from dotenv import load_dotenv
except ImportError as exc:  # pragma: no cover - depends on the runtime image
    print(
        f"missing dependency: {exc}. Install with: "
        "pip install psycopg[binary] python-dotenv requests"
    )
    sys.exit(1)

# Windows consoles commonly default to cp1252. Reconfigure output so Arabic
# diagnostics and report paths do not fail during module initialization.
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, OSError):  # pragma: no cover - unusual host stdout
    pass

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

TZ = ZoneInfo("Africa/Cairo")
TODAY = datetime.now(TZ).date()
DATABASE_URL = os.environ.get("DATABASE_URL")


def _env_int(name: str, default: int, minimum: Optional[int] = None) -> int:
    raw = os.environ.get(name)
    try:
        value = int(raw) if raw is not None else int(default)
    except (TypeError, ValueError):
        raise SystemExit(f"{name} must be an integer; got {raw!r}")
    if minimum is not None and value < minimum:
        raise SystemExit(f"{name} must be >= {minimum}; got {value}")
    return value


def _env_float(name: str, default: float, minimum: Optional[float] = None) -> float:
    raw = os.environ.get(name)
    try:
        value = float(raw) if raw is not None else float(default)
    except (TypeError, ValueError):
        raise SystemExit(f"{name} must be a number; got {raw!r}")
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise SystemExit(f"{name} must be a finite number; got {raw!r}")
    if minimum is not None and value < minimum:
        raise SystemExit(f"{name} must be >= {minimum}; got {value}")
    return float(value)


BACKFILL_MIN_YEAR = _env_int("BACKFILL_MIN_YEAR", 1996, 1)
BACKFILL_MAX_YEAR = min(
    _env_int("BACKFILL_MAX_YEAR", TODAY.year, 1),
    TODAY.year,
)
REQUEST_DELAY = _env_float("BACKFILL_REQUEST_DELAY", 2.0, 0.0)
HTTP_TIMEOUT = _env_float("BACKFILL_HTTP_TIMEOUT", 60.0, 1.0)
MAX_RETRIES = _env_int("BACKFILL_MAX_RETRIES", 5, 1)
RETRY_INITIAL_DELAY = _env_float("BACKFILL_RETRY_INITIAL_DELAY", 5.0, 0.0)
RETRY_MAX_DELAY = _env_float("BACKFILL_RETRY_MAX_DELAY", 300.0, 0.0)
GLOBAL_429_COOLDOWN = _env_float("BACKFILL_GLOBAL_429_COOLDOWN", 60.0, 0.0)
ARCHIVE_AVAILABILITY_LOOKBACK_DAYS = _env_int(
    "BACKFILL_ARCHIVE_AVAILABILITY_LOOKBACK_DAYS",
    14,
    1,
)
ARCHIVE_AVAILABILITY_MAX_WINDOWS = _env_int(
    "BACKFILL_ARCHIVE_AVAILABILITY_MAX_WINDOWS",
    4,
    1,
)
MAX_DAYS_PER_REQUEST = _env_int("BACKFILL_MAX_DAYS_PER_REQUEST", 31, 1)
DATA_SOURCE = os.environ.get("BACKFILL_DATA_SOURCE", "era5-archive").strip()
if not DATA_SOURCE:
    raise SystemExit("BACKFILL_DATA_SOURCE cannot be empty")
REPORT_PATH = Path(
    os.environ.get(
        "BACKFILL_REPORT_PATH",
        str(PROJECT_DIR / "weather_backfill_report.json"),
    )
)
EXPECTED_LOCATION_COUNT = _env_int("EXPECTED_WEATHER_LOCATION_COUNT", 27, 1)

EXPECTED_START = date(BACKFILL_MIN_YEAR, 1, 1)
EXPECTED_END = min(date(BACKFILL_MAX_YEAR, 12, 31), TODAY - timedelta(days=1))

ARCHIVE_VARS = [
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "wind_speed_10m_max",
    "wind_gusts_10m_max",
    "relative_humidity_2m_mean",
    "cloud_cover_mean",
]

class BackfillError(RuntimeError):
    """Base error for an isolated backfill failure."""


class ArchiveEmptyError(BackfillError):
    """Raised when Open-Meteo returns no daily observations."""


class HTTPRequestError(BackfillError):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class RateLimitError(HTTPRequestError):
    def __init__(
        self,
        message: str,
        retry_after: Optional[float] = None,
    ):
        super().__init__(message, status_code=429)
        self.retry_after = retry_after


@dataclass(frozen=True)
class DateRange:
    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def as_dict(self) -> dict[str, str]:
        return {
            "start_date": self.start.isoformat(),
            "end_date": self.end.isoformat(),
        }


@dataclass(frozen=True)
class Location:
    location_id: int
    name_ar: str
    name_en: str
    latitude: Optional[float]
    longitude: Optional[float]


CURRENT_YEAR_START = date(TODAY.year, 1, 1)
_global_cooldown_until = 0.0
_effective_history_end = EXPECTED_END
_archive_latest_date: Optional[date] = None
_archive_unavailable_from: Optional[date] = None
_archive_latest_date_verified = False


def iso_now() -> str:
    return datetime.now(TZ).isoformat()


def parse_api_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.strptime(value.strip(), "%Y-%m-%d").date()
        except ValueError as exc:
            raise BackfillError(f"invalid API date: {value!r}") from exc
    raise BackfillError(f"invalid API date value: {value!r}")


def parse_retry_after(value: Optional[str]) -> Optional[float]:
    """Parse Retry-After seconds or an HTTP-date without guessing."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.isdigit():
        return max(0.0, float(text))

    try:
        retry_at = parsedate_to_datetime(text)
    except (TypeError, ValueError, OverflowError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    seconds = (
        retry_at.astimezone(timezone.utc)
        - datetime.now(timezone.utc)
    ).total_seconds()
    return max(0.0, seconds)


def backoff_delay(attempt: int, initial_delay: float = RETRY_INITIAL_DELAY) -> float:
    """Exponential backoff with bounded jitter for one retry attempt."""
    base = min(RETRY_MAX_DELAY, initial_delay * (2**attempt))
    if base <= 0:
        return 0.0
    return min(RETRY_MAX_DELAY, base * random.uniform(0.5, 1.5))


def sleep_with_reason(seconds: float, reason: str) -> None:
    if seconds <= 0:
        return
    print(f"  ⏱ {reason}: waiting {seconds:.1f}s", flush=True)
    time.sleep(seconds)


def wait_for_global_cooldown() -> None:
    global _global_cooldown_until
    remaining = _global_cooldown_until - time.monotonic()
    if remaining > 0:
        sleep_with_reason(remaining, "global 429 cooldown")


def set_global_cooldown(seconds: float) -> None:
    global _global_cooldown_until
    _global_cooldown_until = time.monotonic() + max(0.0, seconds)


def http_get_json(
    url: str,
    params: Optional[dict[str, Any]] = None,
    timeout: float = HTTP_TIMEOUT,
    max_retries: int = MAX_RETRIES,
    retry_delay: float = RETRY_INITIAL_DELAY,
    on_429: Optional[Callable[[Optional[float]], None]] = None,
) -> dict[str, Any]:
    """Fetch JSON with finite retries and explicit 429 handling.

    Retry-After is authoritative when present. Exponential backoff is capped,
    jittered, and used when Retry-After is absent. Every request is sequential;
    this function never starts a worker or concurrent request.
    """
    for attempt in range(max_retries):
        wait_for_global_cooldown()
        try:
            response = requests.get(
                url,
                params=params or {},
                timeout=float(timeout),
            )
        except requests.exceptions.RequestException as exc:
            if attempt == max_retries - 1:
                raise BackfillError(f"HTTP request failed after {max_retries} attempts: {exc}") from exc
            delay = backoff_delay(attempt, retry_delay)
            print(
                f"  🌐 network error; retry {attempt + 1}/{max_retries} "
                f"in {delay:.1f}s: {exc}",
                flush=True,
            )
            sleep_with_reason(delay, "network retry")
            continue

        status = response.status_code
        if status == 429:
            retry_after = parse_retry_after(response.headers.get("Retry-After"))
            if on_429 is not None:
                on_429(retry_after)
            cooldown = max(GLOBAL_429_COOLDOWN, retry_after or 0.0)
            set_global_cooldown(cooldown)
            if attempt < max_retries - 1:
                delay = max(retry_after or 0.0, backoff_delay(attempt, retry_delay))
                print(
                    f"  🚦 HTTP 429; retry {attempt + 1}/{max_retries} "
                    f"in {delay:.1f}s",
                    flush=True,
                )
                sleep_with_reason(delay, "429 retry")
                continue
            detail = (
                f"Retry-After={retry_after:.1f}s"
                if retry_after is not None
                else "Retry-After header missing"
            )
            raise RateLimitError(
                f"Open-Meteo rate limit persisted after {max_retries} attempts; {detail}",
                retry_after=retry_after,
            )

        if status == 200:
            try:
                payload = response.json()
            except ValueError as exc:
                raise BackfillError("Open-Meteo returned invalid JSON") from exc
            if not isinstance(payload, dict):
                raise BackfillError("Open-Meteo JSON root is not an object")
            return payload

        if status in (408, 425) or 500 <= status < 600:
            if attempt < max_retries - 1:
                delay = backoff_delay(attempt, retry_delay)
                print(
                    f"  🌐 HTTP {status}; retry {attempt + 1}/{max_retries} "
                    f"in {delay:.1f}s",
                    flush=True,
                )
                sleep_with_reason(delay, "transient HTTP retry")
                continue
            raise HTTPRequestError(
                f"Open-Meteo HTTP {status} after {max_retries} attempts",
                status_code=status,
            )

        raise HTTPRequestError(
            f"Open-Meteo HTTP {status} (not retried)",
            status_code=status,
        )

    raise BackfillError("HTTP retry loop exited unexpectedly")


def fetch_locations_pg() -> list[Location]:
    """Fetch active locations using weather_locations.id as identity."""
    if not DATABASE_URL:
        raise SystemExit("DATABASE_URL is not set in the environment or .env")
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, name_ar, name_en, latitude, longitude
                FROM weather_locations
                WHERE is_active = TRUE
                ORDER BY id
                """
            )
            rows = cur.fetchall()

    locations: list[Location] = []
    for row in rows:
        loc_id, name_ar, name_en, latitude, longitude = row
        locations.append(
            Location(
                location_id=int(loc_id),
                name_ar=str(name_ar),
                name_en=str(name_en),
                latitude=float(latitude),
                longitude=float(longitude),
            )
        )
    return locations


def fetch_existing_state(
    location_ids: list[int],
    start: date,
    end: date,
) -> tuple[dict[int, int], dict[int, set[date]]]:
    """Read existing counts and dates before the first archive request."""
    counts = {location_id: 0 for location_id in location_ids}
    dates_by_location: dict[int, set[date]] = {
        location_id: set() for location_id in location_ids
    }
    if not location_ids or start > end:
        return counts, dates_by_location

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT location_id, count(*)
                FROM weather_history_daily
                WHERE location_id = ANY(%s)
                GROUP BY location_id
                """,
                (location_ids,),
            )
            for location_id, count in cur.fetchall():
                counts[int(location_id)] = int(count)

            cur.execute(
                """
                SELECT location_id, record_date
                FROM weather_history_daily
                WHERE location_id = ANY(%s)
                  AND record_date BETWEEN %s AND %s
                ORDER BY location_id, record_date
                """,
                (location_ids, start, end),
            )
            for location_id, record_date in cur.fetchall():
                dates_by_location.setdefault(int(location_id), set()).add(record_date)

    return counts, dates_by_location


def dates_to_ranges(dates: set[date]) -> list[DateRange]:
    """Convert arbitrary dates into minimal contiguous ranges."""
    ordered = sorted(dates)
    if not ordered:
        return []

    ranges: list[DateRange] = []
    range_start = ordered[0]
    previous = ordered[0]
    for current in ordered[1:]:
        if current == previous + timedelta(days=1):
            previous = current
            continue
        ranges.append(DateRange(range_start, previous))
        range_start = current
        previous = current
    ranges.append(DateRange(range_start, previous))
    return ranges


def split_range(date_range: DateRange, max_days: int = MAX_DAYS_PER_REQUEST) -> list[DateRange]:
    """Split a contiguous range into API-sized chunks without changing dates."""
    if max_days < 1:
        raise ValueError("max_days must be positive")
    if date_range.start > date_range.end:
        return []

    result: list[DateRange] = []
    current_start = date_range.start
    while current_start <= date_range.end:
        current_end = min(date_range.end, current_start + timedelta(days=max_days - 1))
        result.append(DateRange(current_start, current_end))
        current_start = current_end + timedelta(days=1)
    return result


def missing_ranges(
    existing_dates: set[date],
    start: date,
    end: date,
) -> list[DateRange]:
    """Calculate missing dates in the configured historical window."""
    if start > end:
        return []
    missing: set[date] = set()
    current = start
    while current <= end:
        if current not in existing_dates:
            missing.add(current)
        current += timedelta(days=1)
    return dates_to_ranges(missing)


def gap_ranges_for_location(
    existing_dates: set[date],
    start: date = EXPECTED_START,
    end: date = EXPECTED_END,
) -> list[DateRange]:
    """Return API-sized ranges for only the dates missing in PostgreSQL."""
    ranges: list[DateRange] = []
    for contiguous in missing_ranges(existing_dates, start, end):
        ranges.extend(split_range(contiguous))
    return ranges


def parse_archive_payload(
    payload: dict[str, Any],
    location: Location,
    requested_range: DateRange,
) -> tuple[list[dict[str, Any]], date]:
    daily = payload.get("daily")
    if not isinstance(daily, dict):
        raise BackfillError("Open-Meteo response has no daily object")
    times = daily.get("time")
    if not isinstance(times, (list, tuple)) or not times:
        raise BackfillError("Open-Meteo response has no daily.time values")

    parsed_dates: list[date] = []
    seen: set[date] = set()
    for raw_date in times:
        parsed = parse_api_date(raw_date)
        if parsed < requested_range.start or parsed > requested_range.end:
            raise BackfillError(
                f"Open-Meteo returned {parsed.isoformat()} outside requested "
                f"range {requested_range.start}..{requested_range.end}"
            )
        if parsed in seen:
            raise BackfillError(f"Open-Meteo returned duplicate date {parsed.isoformat()}")
        seen.add(parsed)
        parsed_dates.append(parsed)

    variable_values: dict[str, list[Any]] = {}
    for archive_name in ARCHIVE_VARS:
        values = daily.get(archive_name)
        if values is None:
            values = [None] * len(times)
        if not isinstance(values, (list, tuple)) or len(values) != len(times):
            raise BackfillError(
                f"Open-Meteo variable {archive_name} has an invalid length"
            )
        variable_values[archive_name] = list(values)

    rows: list[dict[str, Any]] = []
    for index, record_date in enumerate(parsed_dates):
        rows.append(
            {
                "location_id": location.location_id,
                "record_date": record_date,
                "tmax": variable_values["temperature_2m_max"][index],
                "tmin": variable_values["temperature_2m_min"][index],
                "precip_mm": variable_values["precipitation_sum"][index],
                "wind_max_kph": variable_values["wind_speed_10m_max"][index],
                "wind_gusts_kph": variable_values["wind_gusts_10m_max"][index],
                "humidity_mean_pct": variable_values["relative_humidity_2m_mean"][index],
                "cloud_cover_mean_pct": variable_values["cloud_cover_mean"][index],
                "data_source": DATA_SOURCE,
            }
        )
    return rows, max(parsed_dates)


def insert_history_rows(rows: list[dict[str, Any]]) -> dict[str, int]:
    """Insert only new rows; never update or delete historical data."""
    if not rows:
        return {"inserted": 0, "skipped": 0}
    if not DATABASE_URL:
        raise SystemExit("DATABASE_URL is not set in the environment or .env")

    inserted = 0
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            for row in rows:
                cur.execute(
                    """
                    INSERT INTO weather_history_daily
                    (location_id, record_date, tmax, tmin, precip_mm,
                     wind_max_kph, wind_gusts_kph, humidity_mean_pct,
                     cloud_cover_mean_pct, data_source)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (location_id, record_date, data_source) DO NOTHING
                    RETURNING location_id
                    """,
                    (
                        row["location_id"],
                        row["record_date"],
                        row.get("tmax"),
                        row.get("tmin"),
                        row.get("precip_mm"),
                        row.get("wind_max_kph"),
                        row.get("wind_gusts_kph"),
                        row.get("humidity_mean_pct"),
                        row.get("cloud_cover_mean_pct"),
                        row.get("data_source", DATA_SOURCE),
                    ),
                )
                if cur.fetchone() is not None:
                    inserted += 1
            conn.commit()

    return {"inserted": inserted, "skipped": max(0, len(rows) - inserted)}


def verify_coverage(
    location_ids: list[int],
    start: date,
    end: date,
) -> dict[int, dict[str, Any]]:
    """Read final coverage from PostgreSQL; this performs no HTTP requests."""
    result: dict[int, dict[str, Any]] = {
        location_id: {
            "expected_days": 0,
            "covered_days": 0,
            "missing_days": 0,
            "latest_record_date": None,
        }
        for location_id in location_ids
    }
    if not location_ids or start > end:
        return result

    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH locs AS (
                    SELECT id AS location_id
                    FROM weather_locations
                    WHERE id = ANY(%s)
                ),
                dates AS (
                    SELECT generate_series(%s::date, %s::date, interval '1 day')::date
                           AS record_date
                ),
                distinct_history AS (
                    SELECT DISTINCT location_id, record_date
                    FROM weather_history_daily
                )
                SELECT l.location_id,
                       count(d.record_date) AS expected_days,
                       count(h.record_date) AS covered_days,
                       count(d.record_date) - count(h.record_date) AS missing_days,
                       max(h.record_date) AS latest_record_date
                FROM locs l
                CROSS JOIN dates d
                LEFT JOIN distinct_history h
                  ON h.location_id = l.location_id
                 AND h.record_date = d.record_date
                GROUP BY l.location_id
                ORDER BY l.location_id
                """,
                (location_ids, start, end),
            )
            for location_id, expected, covered, missing, latest in cur.fetchall():
                result[int(location_id)] = {
                    "expected_days": int(expected),
                    "covered_days": int(covered),
                    "missing_days": int(missing),
                    "latest_record_date": latest.isoformat() if latest else None,
                }
    return result


def record_error(
    report: dict[str, Any],
    exc: BaseException,
    phase: str,
    date_range: Optional[DateRange] = None,
) -> None:
    error: dict[str, Any] = {
        "type": type(exc).__name__,
        "phase": phase,
        "message": str(exc),
    }
    if date_range is not None:
        error["range"] = date_range.as_dict()
    report["errors"].append(error)


def new_location_report(location: Location) -> dict[str, Any]:
    return {
        "location_id": location.location_id,
        "name_ar": location.name_ar,
        "name_en": location.name_en,
        "requested_ranges": [],
        "rows_existing_before": 0,
        "rows_inserted": 0,
        "rows_skipped_existing": 0,
        "errors": [],
        "http_429_count": 0,
        "last_successful_date": None,
        "latest_archive_date": None,
        "latest_archive_date_verified": False,
        "started_at": iso_now(),
        "finished_at": None,
        "status": "pending",
        "missing_days_before": 0,
        "remaining_gap_count": None,
        "remaining_latest_record_date": None,
    }


def fetch_archive_range(
    location: Location,
    date_range: DateRange,
    report: dict[str, Any],
) -> bool:
    """Fetch and insert one missing range, isolated from other ranges."""
    report["requested_ranges"].append(date_range.as_dict())

    def count_429(retry_after: Optional[float]) -> None:
        report["http_429_count"] += 1

    try:
        payload = http_get_json(
            "https://archive-api.open-meteo.com/v1/archive",
            params={
                "latitude": location.latitude,
                "longitude": location.longitude,
                "start_date": date_range.start.isoformat(),
                "end_date": date_range.end.isoformat(),
                "daily": ",".join(ARCHIVE_VARS),
                "timezone": "Africa/Cairo",
            },
            timeout=HTTP_TIMEOUT,
            max_retries=MAX_RETRIES,
            retry_delay=RETRY_INITIAL_DELAY,
            on_429=count_429,
        )
        rows, latest_date = parse_archive_payload(payload, location, date_range)
        insert_result = insert_history_rows(rows)
        report["rows_inserted"] += insert_result["inserted"]
        report["rows_skipped_existing"] += insert_result["skipped"]
        report["last_successful_date"] = max(
            value
            for value in [report["last_successful_date"], latest_date.isoformat()]
            if value is not None
        )
        report["latest_archive_date"] = max(
            value
            for value in [report["latest_archive_date"], latest_date.isoformat()]
            if value is not None
        )
        if date_range.end == EXPECTED_END and latest_date < date_range.end:
            report["latest_archive_date_verified"] = True
        print(
            f"  ✅ {date_range.start}..{date_range.end}: "
            f"inserted={insert_result['inserted']} "
            f"skipped={insert_result['skipped']} "
            f"latest={latest_date}",
            flush=True,
        )
        return True
    except RateLimitError as exc:
        record_error(report, exc, "archive_request", date_range)
        print(f"  ❌ {date_range.start}..{date_range.end}: {exc}", flush=True)
        return False
    except (BackfillError, ValueError, TypeError, OverflowError) as exc:
        record_error(report, exc, "archive_request", date_range)
        print(f"  ❌ {date_range.start}..{date_range.end}: {exc}", flush=True)
        return False


def write_report(report: dict[str, Any]) -> None:
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = REPORT_PATH.with_suffix(REPORT_PATH.suffix + ".tmp")
    with temporary_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary_path.replace(REPORT_PATH)


def summarize_reports(location_reports: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "locations_total": len(location_reports),
        "locations_completed": sum(
            1 for item in location_reports if item["status"] == "completed"
        ),
        "locations_with_remaining_gaps": sum(
            1
            for item in location_reports
            if (item.get("remaining_gap_count") or 0) > 0
        ),
        "locations_with_errors": sum(
            1 for item in location_reports if item["errors"]
        ),
        "rows_existing_before": sum(
            int(item["rows_existing_before"]) for item in location_reports
        ),
        "rows_inserted": sum(int(item["rows_inserted"]) for item in location_reports),
        "rows_skipped_existing": sum(
            int(item["rows_skipped_existing"]) for item in location_reports
        ),
        "http_429_count": sum(int(item["http_429_count"]) for item in location_reports),
    }


def run_backfill() -> dict[str, Any]:
    if EXPECTED_START > EXPECTED_END:
        raise SystemExit(
            f"no historical dates are available in the configured range "
            f"{EXPECTED_START}..{EXPECTED_END}"
        )

    print(
        f"\n[{iso_now()}] starting gap-aware weather history backfill",
        flush=True,
    )
    print(
        f"  range={EXPECTED_START}..{EXPECTED_END} | "
        f"request_delay={REQUEST_DELAY:.2f}s | "
        f"max_retries={MAX_RETRIES} | max_range_days={MAX_DAYS_PER_REQUEST}",
        flush=True,
    )
    print(
        "  policy=INSERT only; ON CONFLICT DO NOTHING; "
        "PostgreSQL is the resume source of truth",
        flush=True,
    )

    locations = fetch_locations_pg()
    location_ids = [location.location_id for location in locations]
    if len(locations) != EXPECTED_LOCATION_COUNT:
        print(
            f"  ⚠ location count is {len(locations)}; expected "
            f"{EXPECTED_LOCATION_COUNT}. Processing every active ID returned by DB.",
            flush=True,
        )

    existing_counts, existing_dates = fetch_existing_state(
        location_ids,
        EXPECTED_START,
        EXPECTED_END,
    )
    reports: list[dict[str, Any]] = []

    for location in locations:
        report = new_location_report(location)
        report["rows_existing_before"] = existing_counts.get(location.location_id, 0)
        ranges = gap_ranges_for_location(
            existing_dates.get(location.location_id, set()),
            EXPECTED_START,
            EXPECTED_END,
        )
        report["missing_days_before"] = sum(item.days for item in ranges)
        reports.append(report)
        print(
            f"\n📍 {location.name_ar} / {location.name_en} "
            f"(id={location.location_id}): missing_days={report['missing_days_before']}",
            flush=True,
        )

        if not ranges:
            report["status"] = "completed"
            print("  ✅ no missing dates in the configured window", flush=True)
            continue

        try:
            for date_range in ranges:
                fetch_archive_range(location, date_range, report)
                if REQUEST_DELAY > 0:
                    sleep_with_reason(REQUEST_DELAY, "between successful requests")
        except (BackfillError, ValueError, TypeError, OverflowError) as exc:
            # The per-range helper normally isolates failures. This boundary
            # protects setup/validation failures from stopping other locations.
            record_error(report, exc, "location")
            print(f"  ❌ location setup failed: {exc}", flush=True)

        report["status"] = "partial" if report["errors"] else "completed"

    final_coverage = verify_coverage(location_ids, EXPECTED_START, EXPECTED_END)
    for report in reports:
        location_id = report["location_id"]
        coverage = final_coverage.get(location_id, {})
        report["remaining_gap_count"] = coverage.get("missing_days")
        report["remaining_latest_record_date"] = coverage.get("latest_record_date")
        if report["remaining_gap_count"] == 0 and not report["errors"]:
            report["status"] = "completed"
        elif report["remaining_gap_count"] == 0:
            report["status"] = "completed_with_errors"
        elif report["rows_inserted"] > 0 or report["rows_skipped_existing"] > 0:
            report["status"] = "partial"
        else:
            report["status"] = "failed"
        report["finished_at"] = iso_now()

    report_document: dict[str, Any] = {
        "report_version": 1,
        "generated_at": iso_now(),
        "database_source_of_truth": True,
        "canonical_identity": "weather_locations.id",
        "data_source": DATA_SOURCE,
        "configured_range": {
            "start": EXPECTED_START.isoformat(),
            "end": EXPECTED_END.isoformat(),
        },
        "expected_location_count": EXPECTED_LOCATION_COUNT,
        "actual_location_count": len(locations),
        "location_count_matches_expected": len(locations) == EXPECTED_LOCATION_COUNT,
        "summary": summarize_reports(reports),
        "locations": reports,
    }
    write_report(report_document)
    print(f"\n📄 final JSON report: {REPORT_PATH}", flush=True)
    print(f"  summary: {json.dumps(report_document['summary'], ensure_ascii=False)}", flush=True)
    return report_document


def main() -> int:
    try:
        run_backfill()
    except (BackfillError, psycopg.Error, OSError, ValueError) as exc:
        print(f"fatal backfill error: {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
