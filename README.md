# EOC System — Emergency Operations Center

A digital operations platform built to support coordination, monitoring, reporting, and decision-making for the Egyptian Red Crescent Emergency Operations Center (EOC).

> **Important:** This repository contains application code and operational integrations. Do not commit credentials, API tokens, database connection strings, unredacted beneficiary information, or confidential operational records.

## Main components

- **Frontend:** React + Vite, with Arabic/RTL and responsive interface support.
- **Backend:** Python FastAPI application in `main.py`.
- **Data:** PostgreSQL, accessed through the backend.
- **Intelligence workers:** Python scripts for AI/news intake, weather intelligence, and earthquake monitoring.
- **Automation:** GitHub Actions workflows under `.github/workflows/`.

## Repository map

| Path | Purpose |
| --- | --- |
| `main.py` | Backend API and application logic |
| `frontend/` | React/Vite application |
| `ai_radar.py` | News and social-source collection, validation, deduplication, and delivery to the EOC API |
| `weather_intel.py` | Weather-intelligence worker |
| `earthquake_intel.py` | Earthquake-intelligence worker |
| `.github/workflows/ai_cron.yml` | GitHub Actions workflow for AI Radar |
| `.github/workflows/weather_cron.yml` | GitHub Actions workflow for weather intelligence |
| `.github/workflows/earthquake_cron.yml` | GitHub Actions workflow for earthquake intelligence |
| `AI_RADAR_SOCIAL_SOURCES.md` | AI Radar connectors, deduplication, configuration, and verification notes |
| `AI_RADAR_APIFY_SOCIAL.md` | Apify social collection limits and safeguards |

## Run the frontend locally

Requirements: a supported Node.js version and npm.

```powershell
cd frontend
npm ci
npm run dev
```

To create a production build:

```powershell
npm run build
```

Run these commands from the `frontend/` directory. The frontend needs a reachable backend configured for the environment in which it is being run.

## Run the backend locally

Requirements: Python and the packages listed in `requirements.txt`, plus the required environment configuration.

On Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Configure required environment variables locally before starting the API. Never paste their values into source files, README content, issues, or logs. Deployment-specific settings are managed in the hosting provider and GitHub Actions settings.

## Automated workers

GitHub Actions is the repository's scheduling source for the workers listed below. The workflow files are the authoritative definition of their schedule and runtime configuration.

- **AI Radar:** `.github/workflows/ai_cron.yml` runs `ai_radar.py`.
- **Weather intelligence:** `.github/workflows/weather_cron.yml` runs `weather_intel.py`.
- **Earthquake intelligence:** `.github/workflows/earthquake_cron.yml` runs `earthquake_intel.py`.

GitHub scheduled runs can start later than the exact cron minute. A configured workflow and a successful workflow run are different things: inspect the repository's **Actions** tab to confirm recent runs and their status.

Workers use GitHub Actions Secrets and Variables for credentials and configuration. Depending on the source, AI Radar may use services such as Gemini and Apify. Those external APIs are data providers, not the scheduler itself.

## Configuration and security

Never add actual values for the following to tracked files:

- `SYSTEM_TOKEN`, `SYSTEM_API_URL`
- `GEMINI_API_KEY`, `APIFY_API_TOKEN`
- Platform tokens (for example X, Meta, or Reddit credentials)
- Database URLs/passwords and authentication secrets

Set the required values in **GitHub → Settings → Secrets and variables → Actions** and in the appropriate hosting environment. Only configure credentials and source identifiers for accounts and content you are authorized to access.

Before merging changes to workers or deployment files, review the diff and confirm that it does not alter the API contract, database schema, authentication, role permissions, or operational records unless the change explicitly requires it.

## Verification

- Review recent workflow runs in the GitHub **Actions** tab.
- Run the relevant offline tests before merging changes.
- Use a controlled live run when validating third-party API credentials; live runs can consume service quotas and may write genuine records to the EOC API.
- Treat screenshots and sample data as public only after confirming that sensitive details have been masked.

---

## ملخص بالعربية

هذا المستودع يحتوي على نظام مركز عمليات الطوارئ: واجهة React/Vite، وواجهة خلفية FastAPI، وتكامل مع PostgreSQL، وعمال لجمع وتحليل الأخبار والطقس والزلازل.

ملفات GitHub Actions داخل `.github/workflows/` هي المرجع الأساسي لجدولة المهام. راجع تبويب **Actions** للتأكد من أن التشغيل حدث فعليًا وبنجاح؛ وجود جدول زمني في الكود لا يضمن نجاح كل تشغيل.

لا ترفع مفاتيح API أو كلمات المرور أو بيانات المستفيدين أو البيانات التشغيلية الحساسة إلى Git. خزّن الأسرار في GitHub Actions Secrets أو في إعدادات بيئة الاستضافة المناسبة.
