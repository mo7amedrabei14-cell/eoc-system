"""
🌍 استخبارات الزلازل — مشغّل الجدولة الخارجية (runner)
====================================================
هذا الملف لم يعد يسحب USGS بنفسه — بل يستدعي دورة المحرك داخل الخادم:
POST /api/earthquake-intel/engine/tick

لماذا؟ مصدر استيعاب واحد فقط (One Ingestion Source):
  • منطق الاستيعاب كله في مكان واحد (نواة _eq_intel_ingest_events في main.py):
    فريد source+external_id + cutoff 180 دقيقة + مرآة الكتالوج + بث الريال تايم + audit.
  • الخادم يقرر بنفسه: لو محرك الخيط المحلي حي (استضافة دائمة) يُرجع skipped —
    فلا استطلاع مزدوج بين GitHub Actions والمحرك المحلي أبداً.
  • ولو الخيط غير حي (Serverless) تنفَّذ الدورة عند كل كرن — السلوك القديم
    (كل 5 دقائق) محفوظ بلا أي انقطاع.
  • أسرع فورية: أي جدولة خارجية بدقيقة (Vercel Cron / كرون الاستضافة) تستطيع
    ضرب نفس النقطة — كلها تمر من نواة واحدة وقفل قيادة واحد (advisory lock).
"""

import os
import sys

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import requests

SYSTEM_TOKEN = os.environ.get("SYSTEM_TOKEN", "").strip()
SYSTEM_API_URL = (os.environ.get("SYSTEM_API_URL") or "https://eoc-system-qaol.vercel.app/").rstrip("/")
TICK_URL = SYSTEM_API_URL + "/api/earthquake-intel/engine/tick"


def run_once():
    if not SYSTEM_TOKEN:
        print("✋ SYSTEM_TOKEN غير مضبوط — لا يمكن تشغيل دورة المحرك.")
        sys.exit(1)

    try:
        resp = requests.post(
            TICK_URL,
            headers={"Authorization": f"Bearer {SYSTEM_TOKEN}", "Content-Type": "application/json"},
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()
    except Exception as e:
        print(f"✋ فشل استدعاء دورة المحرك: {e}")
        sys.exit(1)

    if result.get("skipped"):
        # المحرك المحلي حي في الخادم (استضافة دائمة) — هو المسؤول عن الدورية
        print(f"⏭️ المحرك المحلي حي (local_thread_active) — لا حاجة لدورة خارجية. {result}")
        return

    print(f"✅ دورة المحرك: feed={result.get('feed_events', 0)} جديد={result.get('inserted', 0)}")


if __name__ == "__main__":
    run_once()
