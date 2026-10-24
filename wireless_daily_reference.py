"""Concurrency-safe, date-scoped reference numbers for wireless deliveries."""
from datetime import date


_UPSERT_DAILY_COUNTER = """
    INSERT INTO wireless_delivery_daily_counters (reference_date, last_number)
    VALUES (%s, 1)
    ON CONFLICT (reference_date) DO UPDATE
    SET last_number = wireless_delivery_daily_counters.last_number + 1,
        updated_at = (now() AT TIME ZONE 'Africa/Cairo')
    RETURNING last_number;
"""


def next_wireless_delivery_code(cursor, received_date):
    """Allocate the next reference for a received date in one atomic DB statement.

    PostgreSQL's ON CONFLICT update serializes concurrent allocations for the same
    date. A failed delivery transaction rolls the counter update back with it.
    """
    try:
        reference_date = date.fromisoformat(str(received_date).strip())
    except (TypeError, ValueError) as exc:
        raise ValueError("received_date must be an ISO date (YYYY-MM-DD)") from exc

    cursor.execute(_UPSERT_DAILY_COUNTER, (reference_date,))
    row = cursor.fetchone()
    if not row or row[0] is None:
        raise RuntimeError("Could not allocate wireless daily reference")

    sequence = int(row[0])
    if sequence < 1:
        raise RuntimeError("Wireless daily reference counter returned an invalid number")

    # Keep the reference globally unique while restarting the serial each date.
    return f"#WH-{reference_date:%Y%m%d}-{sequence:05d}"
