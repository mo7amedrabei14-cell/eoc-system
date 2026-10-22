# fix_emsc_links.py — تعبئة روابط تفاصيل EMSC لكل الرصود القديمة (unid موجود أصلاً)
from db import get_connection


def update_emsc_detail_links(cursor, rows):
    """Update EMSC detail URLs with one set-based UPDATE; return attempted valid rows."""
    updates = []
    for eq_id, ext in rows:
        unid = str(ext)[5:]  # preserve the existing emsc- prefix handling
        if not unid:
            continue
        updates.append((
            eq_id,
            f"https://www.seismicportal.eu/eventdetails.html?unid={unid}",
        ))
    if not updates:
        return 0

    cursor.execute("""
        WITH incoming AS (
            SELECT eq_intel_id, detail_url
            FROM unnest(%s::bigint[], %s::text[]) AS u(eq_intel_id, detail_url)
        )
        UPDATE earthquake_intel AS e
        SET raw = jsonb_set(
            COALESCE(e.raw, '{}'::jsonb),
            '{detail_url}',
            to_jsonb(i.detail_url)
        )
        FROM incoming AS i
        WHERE e.eq_intel_id = i.eq_intel_id;
    """, (
        [eq_id for eq_id, _url in updates],
        [url for _eq_id, url in updates],
    ))
    # The old script counted each valid selected source row after issuing its UPDATE.
    return len(updates)


def main():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT eq_intel_id, external_id
                FROM earthquake_intel
                WHERE source = 'emsc'
                  AND external_id LIKE 'emsc-%';
            """)
            rows = cur.fetchall()
            updated = update_emsc_detail_links(cur, rows)
        conn.commit()
        print(f"✅ تم تعبئة روابط التفاصيل لعدد {updated} رصد من EMSC")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    input("اضغط Enter للإغلاق...")


if __name__ == "__main__":
    main()
