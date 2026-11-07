# توثيق المكدس

تاريخ الفحص: 2026-11-04

| السؤال | النتيجة | الدليل |
|---|---|---|
| إطار الخلفية | FastAPI على Starlette/Uvicorn | `main.py`، `Dockerfile:12` |
| نوع القاعدة ومكتبة الاتصال | PostgreSQL عبر Psycopg 3 (`psycopg`/`psycopg-binary`) | `requirements.txt:3-4`، `db.py:121` |
| اتصال القاعدة | اتصال جديد لكل نداء `get_connection`؛ لا يوجد `ConnectionPool` داخلي. يوجد دعم PgBouncer/Aiven pooler وتعطيل prepared statements عند استخدامه | `db.py:43-128` |
| بناء الواجهة | React 19 + React Router + Vite 8، تطبيق SPA | `frontend/package.json:13-22`، `frontend/src/App.jsx:183-187` |
| خدمة الملفات الثابتة | نشر الواجهة الحالي على Vercel كمشروع مستقل؛ محلياً تخدمها `vite preview`. لا يعتمد الإنتاج على FastAPI لخدمة الواجهة | `frontend/vercel.json`، `plan.md` |
| النشر الخلفي | Vercel Serverless وفق توثيق المشروع؛ `Dockerfile` يوفر أيضاً تشغيل Uvicorn | `vercel.json`، `Dockerfile:12` |
| CDN | Vercel موثق كاستضافة للواجهة، لذا شبكة الاستضافة موجودة؛ لا توجد خدمة CDN أخرى مضافة في هذا الفحص | `plan.md`، `frontend/vercel.json` |
| Redis / طابور مهام دائم | لا يوجد `REDIS_URL` أو Redis/Celery/arq/RQ. توجد مجدولات ومهام داخل العملية، وليست طابوراً دائماً | نتيجة البحث الساكن، `main.py`، `ai_radar.py`، `earthquake_intel.py` |
| OpenTelemetry | لا يوجد `OTEL_EXPORTER_OTLP_ENDPOINT` أو إعداد OTel | نتيجة البحث الساكن |
| عدد workers | عملية Uvicorn واحدة؛ لا يوجد `--workers`، والقيمة الافتراضية 1 | `Dockerfile:12` |
| الضغط | `GZipMiddleware(minimum_size=1024)` موجود؛ رؤوس SSE تمنع buffering وتستخدم `no-cache, no-transform` | `main.py:1238`، `main.py:6687-6692` |
| المكتبات الثقيلة | Framer Motion، Leaflet/React-Leaflet، ExcelJS وJSZip. لا توجد React Query/SWR أو مكتبة virtualization | `frontend/package.json:13-22` |
| الخطوط | خطوط نظام محلية؛ لا يوجد Google Fonts أو `@font-face` أو ملفات TTF/WOFF محمّلة | `frontend/src/index.css:585`، `frontend/index.html` |
| سكربتات خارجية | لا توجد سكربتات أو CSS خارجية في `index.html` | `frontend/index.html` |

## بوابات CI الموجودة

- `frontend-motion-audit.yml`
- `apify_social_tests.yml`
- `dashboard-loading-check.yml`
- `earthquake-schema-guard.yml`
- `n1_query_optimization_tests.yml`
- `earthquake_cron.yml`
- `weather_cron.yml`
- `ai_cron.yml`

لا يوجد workflow لاختبار الأداء. لم تُعدّل أي بوابة موجودة؛ التعديل المحلي السابق في `.github/workflows/ai_cron.yml` ليس جزءاً من هذا العمل.

## حدود البيئة المحلية

- Docker غير متاح (`docker: command not found`).
- لا توجد PostgreSQL محلية أو أدوات `psql`/`pg_isready`، ولا قاعدة على `127.0.0.1:55432`.
- `_make_seed.py` موجود لكنه يحتاج قاعدة فعلية، و`create_test_users.py` غير موجود.
- لذلك تعذر Locust و`pg_stat_statements` ولقطات API والصفحات المحمية وقياس زمن أحداث SSE. لم تُستخدم قاعدة الإنتاج ولم تُنشأ بيانات أو لقطات بديلة.
- بيئة القياس المتاحة: Python 3.14.7 من `.venv`، Node.js 24.18.0، وبناء Vite إنتاجي على `127.0.0.1:4173`.
