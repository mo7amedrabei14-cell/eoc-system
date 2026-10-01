#!/usr/bin/env python3
"""
🌍 باك فيل كتالوج زلازل العالم كله (30 سنة — M≥4.0) — سكربت مستقل
==================================================================
يشغّله المالك يدوياً خارج السيرفر، يتصل بقاعدة البيانات مباشرة (بدون تشغيل
السيرفر أو أي خيوط خلفية) ويسحب 30 سنة من كتالوج USGS الرسمي سنةً بسنة.

- مصدر الحقيقة: https://earthquake.usgs.gov/fdsnws/event/1/query (M≥4.0 عالمياً)
- كل سنة طلب واحد (عدد زلازل العالم سنوياً < 20000 = حد الطلب الواحد)
- الفريد (source, external_id) ⇒ تشغيل السكربت مراراً آمن ولا يُنشئ نسخاً
- السنوات المعبَّأة مسبقاً تُتخطى تلقائياً (استكمال لا إعادة) — إلا مع --force
- يطبع التقدم سنةً بسنة + الإحصاء النهائي (العدد/التغطية/لكل منطقة)

التشغيل:
    python backfill_world_catalog.py            # تخطي السنوات المعبأة
    python backfill_world_catalog.py --force    # إعادة سحب كل السنوات
"""

import os
import sys
import time

# 🔤 حماية من مشاكل ترميز كونسول ويندوز
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests

# ── ثوابت مطابقة للسيرفر (main.py) — لا نستورد main.py إطلاقاً حتى لا تُقلع خيوطه
EQ_CATALOG_MINMAG = 4.0
EQ_INTEL_HIST_YEARS = 30
YEAR_LIMIT = 20000          # حد الطلب الواحد من USGS (عدد زلازل العالم/سنة أقل منه)
TIMEOUT_PER_YEAR = 180
UA = {"User-Agent": "EOC-Earthquake-Intel/1.0"}

FORCE = "--force" in sys.argv


def get_connection():
    """اتصال مباشر بقاعدة البيانات بنفس إعدادات المشروع (pooler إن كان مضبوطاً)."""
    from db import get_connection as _gc
    return _gc()


def fetch_year_features(year_start_iso, year_end_iso):
    resp = requests.get(
        "https://earthquake.usgs.gov/fdsnws/event/1/query",
        params={
            "format": "geojson",
            "starttime": year_start_iso,
            "endtime": year_end_iso,
            "minmagnitude": EQ_CATALOG_MINMAG,
            "orderby": "time",
            "limit": YEAR_LIMIT,
        },
        timeout=TIMEOUT_PER_YEAR,
        headers=UA,
    )
    if not resp.ok:
        raise RuntimeError(f"USGS HTTP {resp.status_code}")
    return (resp.json() or {}).get("features", []) or []


def main():
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    now_cairo = datetime.now(ZoneInfo("Africa/Cairo")).replace(tzinfo=None)
    start_date = now_cairo - timedelta(days=EQ_INTEL_HIST_YEARS * 365)

    print("=" * 64)
    print("🌍 باك فيل كتالوج زلازل العالم — 30 سنة (M≥4.0) من USGS")
    print("=" * 64)

    conn = get_connection()
    total_inserted = 0
    t_all = time.time()
    try:
        with conn.cursor() as cur:
            # فحص أولي
            cur.execute("SELECT COUNT(*) FROM earthquake_catalog;")
            base = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM earthquake_catalog WHERE region_id='world';")
            already = cur.fetchone()[0]
            print(f"حالة القاعدة: إجمالي الكتالوج={base} · العالم كله (region_id='world')={already}")
            if already > 0 and not FORCE:
                print("ℹ️ توجد بيانات عالمية مسبقاً — سيتم استكمال السنوات الناقصة فقط (استخدم --force لإعادة السحب).")

            for y in range(EQ_INTEL_HIST_YEARS):
                year_start = start_date.replace(year=start_date.year + y)
                year_end = year_start.replace(year=year_start.year + 1)
                if year_start > now_cairo:
                    break
                year_end_eff = min(year_end, now_cairo)
                ys, ye = year_start.date().isoformat(), year_end_eff.date().isoformat()

                if not FORCE:
                    cur.execute(
                        "SELECT 1 FROM earthquake_catalog WHERE region_id='world' AND occurred_at >= %s AND occurred_at < %s LIMIT 1;",
                        (year_start, year_end_eff),
                    )
                    if cur.fetchone():
                        print(f"  ⏭️  {year_start.year} — معبأة مسبقاً، تخطي")
                        continue

                t0 = time.time()
                try:
                    features = fetch_year_features(ys, ye)
                except Exception as e:
                    print(f"  ✗ {year_start.year} — فشل السحب: {str(e)[:100]} (يمكن إعادة تشغيل السكربت للاستكمال)")
                    continue

                rows = []
                for f in features:
                    props = (f or {}).get("properties") or {}
                    geom = (f or {}).get("geometry") or {}
                    coords = (geom.get("coordinates") or [None, None, None])
                    lon, lat, depth = (list(coords) + [None, None, None])[:3]
                    ext = str(f.get("id") or props.get("code") or "").strip()
                    t_ms = props.get("time")
                    if not ext or t_ms is None or lat is None:
                        continue
                    try:
                        occ = datetime.fromtimestamp(float(t_ms) / 1000.0, tz=ZoneInfo("UTC")).astimezone(ZoneInfo("Africa/Cairo")).replace(tzinfo=None)
                    except Exception:
                        continue
                    rows.append((
                        ext[:160], occ, props.get("mag"), depth,
                        (props.get("place") or "")[:240] or None, lat, lon,
                    ))

                inserted = 0
                try:
                    # psycopg3: executemany سريع (pipeline) — فريد (source, external_id)
                    with conn.cursor() as ins:
                        ins.executemany("""
                            INSERT INTO earthquake_catalog
                                (source, external_id, occurred_at, magnitude, depth_km,
                                 place, latitude, longitude, region_id)
                            VALUES ('usgs', %s, %s, %s, %s, %s, %s, %s, 'world')
                            ON CONFLICT (source, external_id) DO NOTHING;
                        """, rows)
                    conn.commit()
                    inserted = ins.rowcount if ins.rowcount and ins.rowcount > 0 else 0
                except Exception as e:
                    conn.rollback()
                    print(f"  ✗ {year_start.year} — فشل الإدخال: {str(e)[:100]}")
                    continue

                total_inserted += len(rows)
                print(f"  ✓ {year_start.year} — سُحب {len(rows)} · جديد {inserted} · {time.time()-t0:.1f}s")

        # الإحصاء النهائي
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), MIN(occurred_at), MAX(occurred_at) FROM earthquake_catalog WHERE region_id='world';")
            total, mn, mx = cur.fetchone()
            cur.execute("SELECT region_id, COUNT(*) FROM earthquake_catalog GROUP BY region_id ORDER BY 2 DESC;")
            per_region = cur.fetchall()
        print("=" * 64)
        print(f"✅ تم — إجمالي صفوف العالم كله: {int(total or 0):,}")
        print(f"   التغطية: {mn} ← {mx}")
        print("   لكل منطقة: " + ", ".join(f"{rid}={int(c):,}" for rid, c in per_region))
        print(f"   الزمن الكلي: {time.time()-t_all:.0f}s")
        print("💡 ملاحظة: السيرفر يكتشف الكتالوج الجديد تلقائياً خلال 5 دقائق (أو أعد تشغيله فوراً).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
