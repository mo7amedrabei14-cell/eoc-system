# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

FastAPI backend (`main.py`) + Aiven PostgreSQL + React/Vite frontend, Arabic/RTL and responsive. Deployed to Vercel; local edits require re-deploy to take effect. Schema is idempotent via `ensure_schema()` in `main.py` plus dated `migrations/*.sql`.

**Deployment configurations in the repository (two separate `vercel.json` files):**
- **Backend** — root `vercel.json` builds `main.py` with `@vercel/python`; route `/(.*)` → `main.py`. This configuration serves the API.
- **Frontend** — `frontend/vercel.json` is a SPA rewrite (`/(.*)` → `/index.html`). This configuration serves the React app.
- Whether these two configurations correspond to two distinct Vercel projects is **not confirmed** — no read-only Vercel dashboard access was available this session.

**Frontend API configuration** (`frontend/src/apiBase.js`): `BASE = ENV.VITE_API_BASE !== undefined ? ENV.VITE_API_BASE : (ENV.DEV ? '' : 'https://eoc-system-alpha.vercel.app')`. In Vite dev mode, `/api` and `/token` are proxied to `http://localhost:8000` (`frontend/vite.config.js`). This is the frontend's own setting and is independent of the backend-side URL configuration.

**Backend-side URL configuration**: `ai_radar.py`, `earthquake_intel.py`, and `weather_intel.py` fall back to `https://eoc-system-alpha.vercel.app` via the `SYSTEM_API_URL` environment variable. This is a separate setting from the frontend's `VITE_API_BASE` / `apiBase.js` fallback.

**Active production domain: UNVERIFIED.** `https://eoc-system-alpha.vercel.app` is the configured production fallback in the inspected source (both frontend and backend sides). `https://eoc-system-b12f.vercel.app` has **no reference** in any inspected code or configuration file — the `b12f` string appears only in this `PRODUCT.md`. Observed HTTP responses (200 for `alpha`, 402 for `b12f`) do **not** conclusively identify the active production domain. Confirm in Vercel Project Settings → Domains before recording either as live.

## Users

Egyptian Red Crescent Emergency Operations Center (EOC) personnel working from the central operations center. They monitor incidents, operational indicators, branch readiness, resources, alerts, and response coordination — primarily centralized operational monitoring, not field-only work.

Roles and access levels, preserved exactly: **Operation → Joker → Supervisor → Manager → Rabea / Global**. The Youth & Volunteers role (`yveoc`) has its existing restricted access, including read-only mission permissions where currently configured. Do not rename these roles to generic Owner/Admin/other names.

## Product Purpose

A digital operations platform for coordination, monitoring, reporting, and decision-making at the Egyptian Red Crescent EOC. Success is a single operational source of truth where every mutation is audited and exportable.

## Positioning

A single source of truth for missions, handovers, news, and disasters. Its mechanism — consolidated operational record with audit-tracked mutations and Excel exports — is not trivially copyable by a generic coordination tool.

## Operating Context

Centralized EOC monitoring across modules: missions (المهام), local/global news, global disasters, supervisors handover, AI radar, weather, and system log. Workflows include role-gated leader pages (`isOwner || isSupervisor`), per-module CRUD with export, audit logging on every mutation, and Arabic-first data with English UI chrome.

## Capabilities and Constraints

- Navigation: `App.jsx` renders `<BrowserRouter>` with `<Routes>` (`/` → Login, `/dashboard` → Dashboard, `/*` → Navigate to `/`). Tab navigation inside the dashboard remains state-based in `Dashboard.jsx` via `activeTab` + `renderContent` switch. Sidebar item order is the product requirement.
- Localization: no i18n library. UI strings use `{lang === 'ar' ? '…' : '…'}` ternaries; static chrome translated by a DOM-walker via the `ENGLISH_UI` map. Boundary: user-entered data and Excel export filenames/headers stay Arabic; no Arabic may remain in the UI in English mode.
- Server-side audit: every mutation calls `create_audit_log(cursor, user_id, action, mission_id=None, entity_type=..., entity_id=..., details={'action_text': …})`. A new `entity_type` auto-appears under the System Log filter with zero UI changes.
- Excel export standard (all 14 `.xlsx` exports): RTL sheet, all cells centered H+V with thin borders, header row `#cbcbcb` bold, built via `exceljs` + shared `gridFromRows`/`exportWorkbook` helpers; individual record exports use the green `DownloadConfirmModal`.
- Form-locking (double-submit prevention): `submitLockRef = useRef(false)` guard, `saving*` state, inert + opacity form container, disabled buttons with label swap. Applied to Local News, Global Disasters, and Supervisors Handover. **Missions is excluded** — it has this behavior via `isSubmitting` and must never be touched.
- Deploy: frontend API base is configured via `VITE_API_BASE` in `frontend/src/apiBase.js` (production fallback `https://eoc-system-alpha.vercel.app`); backend-side URL is configured via `SYSTEM_API_URL` in `ai_radar.py`, `earthquake_intel.py`, `weather_intel.py` (same fallback). These are two separate settings, not one shared backend-base value. Active production domain **unverified** (see Platform/Stack). Schema idempotent via `ensure_schema()` + dated migrations.
- **Visual-only changes are the permitted scope.** Backend logic, APIs, authentication, authorization, RBAC, database schema, data models, business logic, and existing workflows are out of scope unless explicitly requested.
- **No forced scaling:** no `transform: scale()`, forced browser zoom, or root font-size changes. Fix spacing/sizing/overflow directly.
- Responsive targets: 1920x1080 at 100% zoom, 1440x900, 1366x768, and mobile.

## Brand Commitments

Egyptian Red Crescent EOC identity. Arabic-first voice with English UI chrome; dark and light themes; RTL/LTR compatibility. Existing name, logos, navigation items, and workflows are preserved unless explicitly changed.

## Evidence on Hand

`main.py` (FastAPI app, audit, schema), `package.json` (jszip, opennextjs/cloudflare, wrangler), `README.md`, `Eoc Data Base.sql`, dated `migrations/*.sql`, `SECURITY_AUDIT.md`, `SECURITY_VERIFICATION.md`, `VISUAL_TRANSFORM_PLAN.md`. Absences future work must not fabricate: no invented customers, testimonials, benchmarks, pricing, or licensing; no new permissions or features beyond what exists.

## Product Principles

1. Preserve the existing role hierarchy and access model exactly; never rename roles.
2. Keep the existing navigation architecture (BrowserRouter routes in `App.jsx`, state-based `activeTab` + `renderContent` tabs in `Dashboard.jsx`) and sidebar order; do not replace it.
3. Respect the localization boundary: Arabic data and exports, English UI chrome.
4. Every mutation is audited; new entity types appear in the System Log automatically.
5. Visual-only changes; never modify backend logic, schema, auth, or workflows.

## Accessibility & Inclusion

Dark/light themes and RTL/LTR support are required. Mobile responsiveness and desktop layouts at 1920x1080, 1440x900, 1366x768 must not break.