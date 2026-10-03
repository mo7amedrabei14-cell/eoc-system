"""🌪️ باك فيل تاريخ الطبقات الإضافية — تشغيل يدوي مرة واحدة (سيول 1984+ · موج 1996+ · PM2.5 2013+)"""
import os, time
from datetime import date
import psycopg
import requests
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]
S = requests.Session()
AIR = "https://air-quality-api.open-meteo.com/v1/air-quality"
MARINE = "https://marine-api.open-meteo.com/v1/marine"
FLOOD = "https://flood-api.open-meteo.com/v1/flood"
TODAY = date.today()

def get(url, **params):
    for a in range(3):
        try:
            r = S.get(url, params=params, timeout=90)
            if r.status_code == 200:
                return r.json()
            time.sleep(5 * (a + 1))
        except Exception:
            time.sleep(5 * (a + 1))
    return None

def main():
    conn = psycopg.connect(DATABASE_URL)
    with conn.cursor() as cur:
        cur.execute("SELECT id, latitude, longitude FROM weather_locations WHERE is_active = TRUE ORDER BY id")
        locs = cur.fetchall()
    total = 0
    for lid, lat, lon in locs:
        print(f"📍 {lid} ({lat},{lon})")
        rows = []
        data = get(FLOOD, latitude=lat, longitude=lon, daily="river_discharge",
                   start_date="1984-01-01", end_date=str(TODAY))
        if data:
            for d, v in zip(data.get("daily", {}).get("time") or [], data.get("daily", {}).get("river_discharge") or []):
                if v is not None:
                    rows.append((lid, d, "flood", round(float(v), 2)))
        data = get(MARINE, latitude=lat, longitude=lon, daily="wave_height_max",
                   start_date="1996-01-01", end_date=str(TODAY))
        if data:
            for d, v in zip(data.get("daily", {}).get("time") or [], data.get("daily", {}).get("wave_height_max") or []):
                if v is not None:
                    rows.append((lid, d, "wave", round(float(v), 3)))
        for y in range(2013, TODAY.year + 1):
            data = get(AIR, latitude=lat, longitude=lon, hourly="pm2_5,dust",
                       start_date=f"{y}-01-01", end_date=f"{y}-12-31")
            if not data:
                continue
            hrs = data.get("hourly", {})
            pm, du = {}, {}
            for t, pv, dv in zip(hrs.get("time") or [], hrs.get("pm2_5") or [], hrs.get("dust") or []):
                d = str(t)[:10]
                if pv is not None: pm[d] = max(pm.get(d, -1), float(pv))
                if dv is not None: du[d] = max(du.get(d, -1), float(dv))
            rows += [(lid, d, "pm25", round(v, 2)) for d, v in pm.items()]
            rows += [(lid, d, "dust", round(v, 2)) for d, v in du.items()]
            time.sleep(1.0)
        with conn.cursor() as cur:
            cur.executemany("""
                INSERT INTO weather_extra_history (location_id, record_date, layer, value, data_source)
                VALUES (%s, %s, %s, %s, 'open-meteo-backfill')
                ON CONFLICT (location_id, record_date, layer) DO NOTHING
            """, rows)
        conn.commit()
        total += len(rows)
        print(f"  ✅ {len(rows)} صف")
        time.sleep(1.0)
    print(f"\n🎉 تم: {total} صف تاريخي")

if __name__ == "__main__":
    main()
