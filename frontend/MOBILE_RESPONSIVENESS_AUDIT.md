# Mobile Responsiveness Audit — EOC React Frontend (375px / iPhone)

**Scope**: Read-only audit of `src/Dashboard.jsx` (~8000 lines) and `src/index.css`.  
**Breakpoints**: Tailwind defaults (`sm: ≥640px`, `md: ≥768px`, `lg: ≥1024px`, `xl: ≥1280px`).  
**Direction**: RTL-first (`dir="rtl"` on `<html>`), LTR English supported.  
**Target**: ~375px viewport (iPhone SE / 12/13/14 mini width).

---

## PRIORITY 1 — HandoverView (`function HandoverView`, Dashboard.jsx:5870–6343)

| # | File:Line | What Breaks at ~375px | Current Classes / Code | Minimal Fix |
|---|-----------|----------------------|------------------------|-------------|
| **P1-1** | **Dashboard.jsx:6276** | Shift/Department matrix inputs (`w-24` = 96px each) × 4 departments + shift labels + totals column → table requires **~560px** min-width. Horizontal scroll works (`overflow-x-auto`), but on 375px the user must scroll ~185px to see all columns. Touch targets on inputs are small. | `<input className="!py-1.5 !px-2 text-center w-24 mx-auto ...">` | Keep horizontal scroll but improve usability: <br>1. Reduce input width: `w-20` (80px) → saves 64px total. <br>2. Add `min-w-[480px]` on `<table>` (down from 560px). <br>3. Increase tap target: `!py-2.5 !px-2 text-base` (44px height). |
| **P1-2** | **Dashboard.jsx:6233, 6298** | Issues / Follow-ups dynamic rows use `icon-btn` (32px) for delete — **below 44×44px touch target**. On mobile, finger covers the icon; hard to hit. | `<button className="icon-btn icon-btn-danger shrink-0"><TrashIcon /></button>` | Replace with larger touch target: <br>`className="p-2.5 rounded-xl hover:bg-[var(--accent-soft)] text-[var(--accent)] active:scale-95 transition"` <br>and `TrashIcon className="w-5 h-5"` → 40×40px tap area. |
| **P1-3** | **Dashboard.jsx:6108** | Header `flex flex-wrap items-center justify-between gap-3` — wraps correctly. **But** `actionbar` has `shrink-0` (line 6110) preventing button compression; `btn-primary` has `whitespace-nowrap` (line 6126) forcing long Arabic text to overflow or push layout. | `className="actionbar shrink-0"` + `<button className="btn-primary whitespace-nowrap ...">` | Remove `shrink-0` from actionbar. On `btn-primary`, replace `whitespace-nowrap` with `flex-shrink-0 min-w-0` + `truncate` on inner span, or simply drop `whitespace-nowrap` and let text wrap (button grows vertically). |
| **P1-4** | **Dashboard.jsx:6135–6174** | Daily-log table wrapped in `table-shell overflow-x-auto` with **no `min-w` on `<table>`**. 8 columns with `whitespace-nowrap` — columns compress to content width, causing cramped text on mobile. | `<table className="w-full text-right text-sm whitespace-nowrap">` | Add `min-w-[520px]` on `<table>` (or per-column `min-w`) so horizontal scroll is predictable and headers don't collapse. |
| **P1-5** | **Dashboard.jsx:6177–6322** (modal) | Modal structure is **good**: `modal-backdrop p-4`, `modal-card w-full max-w-6xl h-full max-h-[95vh]`, body `p-6 overflow-y-auto flex-1`, footer `flex flex-col-reverse md:flex-row flex-wrap [&>button]:w-full md:[&>button]:w-auto`. **Only issue**: close button uses `icon-btn icon-btn-danger` (32px) — small touch target. | Line 6183: `<button className="icon-btn icon-btn-danger">` | Change to `className="p-2.5 rounded-xl hover:bg-[var(--surface-hover)]"` with inline SVG `w-5 h-5`. |
| **P1-6** | **Dashboard.jsx:6100** | KPI/StatCard grid: `grid grid-cols-2 md:grid-cols-4 gap-4` — **correctly shows 2 columns on mobile** (≈170px each). No issue. | ✅ **No fix needed** | — |

---

## PRIORITY 2 — SYSTEM-WIDE (All Other Views + Shared Chrome)

### 2.1 Touch Targets (Global CSS)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-1** | **index.css:789–805** | `.icon-btn` = `w-8 h-8` (32×32px) — **below 44px minimum** per WCAG 2.5.5 / Apple HIG / Material. Used on **every modal close button, table action icon, header hamburger, sidebar logout**. | ```css\n.icon-btn { @apply inline-flex items-center justify-center w-8 h-8 rounded-xl ... }\n``` | Increase to 44px: <br>`@apply w-11 h-11` (44×44px). <br>Also bump inner SVG: `.icon-btn svg { @apply w-5 h-5 }` (was w-4 h-4). |
| **P2-2** | **index.css:854** | `.action-btn--icon` = `width: 2.4rem` (38.4px) — **borderline**, no height set (relies on `.action-btn` 44px height). If used without parent `.action-btn`, collapses. | ```css\n.action-btn--icon { width: 2.4rem; padding: 0; }\n``` | Add explicit height: `height: 2.75rem; /* 44px */ width: 2.75rem;` and `padding: 0;`. |
| **P2-3** | **index.css:893–928** | `.btn-primary` = `height: 2.75rem` (44px) — **GOOD**. But `whitespace-nowrap` often added in JSX (see P1-3, Missions filter) forces overflow. | `.btn-primary { height: 2.75rem; padding: 0 1.35rem; ... }` | **CSS**: add `min-width: 0; flex-shrink: 1;` to allow shrink. **JSX**: avoid `whitespace-nowrap`; use `truncate` on inner text if needed. |

---

### 2.2 Missions View (`function MissionsView`, ~3751–4699)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-4** | **Dashboard.jsx:3863** | StatCard grid: `grid grid-cols-2 md:grid-cols-5 gap-3`. On `md` (≥768px, iPad portrait) **5 cards in one row** = ~140px each — **too cramped** for KPI cards with icons + values. | `className="grid grid-cols-2 md:grid-cols-5 gap-3"` | Change to `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3` — 2 on phone, 3 on small tablet, 5 on desktop. |
| **P2-5** | **Dashboard.jsx:3883** | Main table: wrapped in `flex-1 overflow-auto custom-scrollbar relative` but **no `min-w` on `<table>`**. 15 columns, all `whitespace-nowrap` — columns compress unpredictably. | `<table className="w-full text-right text-sm whitespace-nowrap">` | Add `min-w-[1200px]` on `<table>` (or sum of column `min-w` values) so horizontal scroll is stable. |
| **P2-6** | **Dashboard.jsx:3874** | Expanded full-screen table: `fixed inset-4 z-[150]` → on 375px = `left:16px right:16px` (343px wide). **Works but tight**; close button uses `icon-btn` (32px, see P2-1). | `className="fixed inset-4 z-[150] ..."` | Keep `inset-4`; fix close button via P2-1. |
| **P2-7** | **Dashboard.jsx:3972–3973** | Mission modal: `modal-backdrop p-4`, `modal-card w-full max-w-6xl h-full max-h-[95vh]` — **good**. Footer at line 4620: `flex flex-col-reverse md:flex-row flex-wrap justify-end gap-3 [&>button]:w-full md:[&>button]:w-auto` — **excellent responsive pattern**. | ✅ **No fix needed** | — |
| **P2-8** | **Dashboard.jsx:3806** | Filter/actionbar: `actionbar justify-center md:justify-end w-full md:w-auto` with `actionbar-segment w-full sm:w-auto`. **Wraps correctly** (`.actionbar` has `flex-wrap: wrap` in CSS). | ✅ **No fix needed** | — |

---

### 2.3 Audit / System Log View (`function AuditLogsView`, ~5218–5360)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-9** | **Dashboard.jsx:5305** | Toolbar: 6 filter buttons + search input + EocSelect + export button in **single `flex items-center gap-3 w-full flex-1 overflow-x-auto`** row. On 375px, **horizontal scroll on a toolbar is poor UX** — users miss filters. | `className="flex items-center gap-3 w-full flex-1 overflow-x-auto custom-scrollbar pb-2 md:pb-0"` | Change to **wrap**: `flex flex-wrap items-center gap-3` (drop `overflow-x-auto`). Let buttons stack. Keep search input `flex-1 min-w-[180px]`. |
| **P2-10** | **Dashboard.jsx:5333–5334** | Table: `flex-1 overflow-auto` wrapper, `<table className="w-full text-right text-sm whitespace-nowrap">` — 5 columns with fixed widths (`w-48`, `w-24`, `w-48`, `w-40`, flex). Total ~700px → scrolls. **No `min-w` on table**; columns may compress. | `<table className="w-full text-right text-sm whitespace-nowrap">` | Add `min-w-[700px]` on `<table>`. |
| **P2-11** | **Dashboard.jsx:5296** | Header: `flex flex-col md:flex-row justify-between items-center gap-4` — **good**, stacks on mobile. | ✅ **No fix needed** | — |

---

### 2.4 Local News View (`function LocalNewsView`, ~5393–5740)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-12** | **Dashboard.jsx:5621** | Header: `flex flex-col lg:flex-row justify-between items-center gap-4` — **good**, stacks on mobile. | ✅ **No fix needed** | — |
| **P2-13** | **Dashboard.jsx:5625** | Filter row: `flex flex-wrap items-center gap-2 w-full` — **wraps correctly**. | ✅ **No fix needed** | — |
| **P2-14** | **Dashboard.jsx:5677–5678** | Table: `flex-1 overflow-auto` + `<table className="w-full text-right whitespace-nowrap text-sm">` — 7 columns, **no `min-w`**. | `<table className="w-full text-right whitespace-nowrap text-sm">` | Add `min-w-[700px]` on `<table>`. |
| **P2-15** | **Dashboard.jsx:5726** | Modal close button uses **TrashIcon** instead of X/Close — **UX bug** (not mobile-specific). | `<TrashIcon />` | Replace with X icon: `<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>` |
| **P2-16** | **Dashboard.jsx:5722–5723** | Modal: `modal-backdrop p-4`, `w-full max-w-5xl h-full max-h-[95vh]` with `overflow-y-auto` on body — **good**. | ✅ **No fix needed** | — |

---

### 2.5 Global Disasters View (`function GlobalDisastersView`, ~6538–6660)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-17** | **Dashboard.jsx:6539** | Header: `flex flex-col lg:flex-row` — **good**. Title has `whitespace-nowrap` (line 6542) — may overflow on very long text. | `<h2 className="... whitespace-nowrap ...">` | Drop `whitespace-nowrap`; add `truncate` if needed. |
| **P2-18** | **Dashboard.jsx:6587–6588** | Table: `flex-1 overflow-auto` + `<table className="w-full text-right whitespace-nowrap text-sm">` — 7 columns, **no `min-w`**. | `<table className="w-full text-right whitespace-nowrap text-sm">` | Add `min-w-[700px]` on `<table>`. |
| **P2-19** | **Dashboard.jsx:6638–6639** | Modal: `modal-backdrop p-4`, `w-full max-w-5xl h-full max-h-[95vh]` with scroll body — **good**. Close button uses `icon-btn` (32px, see P2-1). | Line 6642: `<button className="icon-btn ..."><TrashIcon /></button>` | Fix via P2-1 (icon-btn → 44px). |

---

### 2.6 Earthquakes View (`function EarthquakesView`, ~7000–7160)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-20** | **Dashboard.jsx:7037** | Header: `flex flex-col md:flex-row justify-between items-center gap-4` — **good**. | ✅ **No fix needed** | — |
| **P2-21** | **Dashboard.jsx:7041** | Button cluster: `flex flex-wrap items-center gap-3 w-full md:w-auto mt-4 md:mt-0` — **wraps correctly**. | ✅ **No fix needed** | — |
| **P2-22** | **Dashboard.jsx:7066, 7106** | Two tables: both `flex-1 overflow-auto` + `<table className="w-full text-right whitespace-nowrap text-sm">` — 8 and 6 columns, **no `min-w`**. | `<table className="w-full text-right whitespace-nowrap text-sm">` | Add `min-w-[800px]` (global) / `min-w-[600px]` (Egypt) on respective `<table>` elements. |
| **P2-23** | **Dashboard.jsx:7142–7143** | **CRITICAL**: Global earthquake modal uses `modal-backdrop p-4` + `w-full max-w-3xl p-6` — **NO `modal-card`, NO `h-full max-h-[95vh]`, NO `overflow-y-auto` wrapper**. Content (form with many fields) **will overflow viewport on mobile**; no scroll, no backdrop blur animation. | ```jsx\n<div className=\"modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4\">\n  <div className=\"bg-[var(--surface)] border border-[var(--border)] rounded-3xl w-full max-w-3xl p-6 shadow-2xl animate-fade-in-up\">\n``` | Wrap in proper modal structure: <br>```jsx\n<div className=\"modal-backdrop fixed inset-0 flex items-center justify-center z-[100] p-4\">\n  <div className=\"modal-card w-full max-w-3xl h-full max-h-[95vh] flex flex-col overflow-hidden\">\n    <div className=\"p-5 border-b ... shrink-0\">...</div>\n    <div className=\"p-6 overflow-y-auto custom-scrollbar flex-1\">...</div>\n    <div className=\"p-4 border-t ... shrink-0\">...</div>\n  </div>\n</div>\n``` |

---

### 2.7 AI News View (`function AINewsView`, ~7615–7695)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-24** | **Dashboard.jsx:7616** | Header: `flex flex-col lg:flex-row` — **good**. | ✅ **No fix needed** | — |
| **P2-25** | **Dashboard.jsx:7621** | Buttons: `flex flex-wrap gap-3` — **wraps correctly**. | ✅ **No fix needed** | — |
| **P2-26** | **Dashboard.jsx:7645–7646** | Table: `flex-1 overflow-auto` + `<table className="w-full text-right whitespace-nowrap text-sm">` — 6 columns, **no `min-w`**. | `<table className="w-full text-right whitespace-nowrap text-sm">` | Add `min-w-[700px]` on `<table>`. |
| **P2-27** | **Dashboard.jsx:7668** | **CRITICAL**: Description column has `w-[500px] min-w-[500px] whitespace-normal` — **forces 500px minimum** on a single column. On 375px, table **minimum width >500px** just for this column; horizontal scroll required before seeing any other column. | `<td className=\"p-3 ... w-[500px] min-w-[500px] whitespace-normal\">` | Reduce to reasonable mobile-friendly minimum: `min-w-[200px] max-w-[400px]` (or use `w-full` with `max-w-[400px]` and let table scroll). Better: remove fixed `w-[500px]`, use `min-w-[180px] max-w-[320px]`. |
| **P2-28** | **Dashboard.jsx:7699–7700** | Modal: `modal-backdrop p-4`, `w-full max-w-5xl h-full max-h-[95vh]` with `overflow-y-auto` — **good**. Close button uses `icon-btn` (32px, see P2-1). | Line 7703: `<button className=\"... p-2 rounded-xl\"><TrashIcon /></button>` | Fix via P2-1. |

---

### 2.8 Human Resources View (`function HumanResourcesView`, ~8042–8137)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-29** | **Dashboard.jsx:8043** | Filter header: `flex flex-col lg:flex-row` — **good**. | ✅ **No fix needed** | — |
| **P2-30** | **Dashboard.jsx:8076–8090** | Active filter buttons: `flex items-center gap-1.5 p-1 rounded-2xl` with individual buttons `px-4 py-2 rounded-xl text-sm font-bold`. **Wraps** (parent is flex-wrap from header). Touch targets = 44px height (`py-2` = 8px + text) — **OK**. | ✅ **No fix needed** | — |
| **P2-31** | **Dashboard.jsx:8097–8098** | Table: `flex-1 overflow-auto` + `<table className="w-full text-right whitespace-nowrap text-sm">` — **10 columns**, **no `min-w`**. Will scroll heavily. | `<table className="w-full text-right whitespace-nowrap text-sm">` | Add `min-w-[1000px]` on `<table>`. |

---

### 2.9 Home / Inventory Table (`function BranchesInventoryView`, ~2478–2540)

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-32** | **Dashboard.jsx:2478–2540** | **35+ columns** intentionally horizontal-scrolling. Wrapper: `flex-1 overflow-auto custom-scrollbar`, table: `w-full text-center text-xs whitespace-nowrap`. First column sticky right. **Functional by design** — no fix unless UX demands column hiding. | ✅ **Acceptable as-is** | Optional: add `min-w-[2000px]` on `<table>` for stable scroll. |

---

### 2.10 Shared Chrome — Sidebar, Header, Modals

| # | File:Line | What Breaks | Current Code | Minimal Fix |
|---|-----------|-------------|--------------|-------------|
| **P2-33** | **Dashboard.jsx:1850** | Sidebar mobile backdrop: `fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] md:hidden` — **excellent pattern**. Sidebar slides `right-0 w-64` / `-right-80`. **Works well**. | ✅ **No fix needed** | — |
| **P2-34** | **Dashboard.jsx:1908** | Header hamburger: `icon-btn !w-11 !h-11 shrink-0` — **44×44px** (good) because of `!w-11 !h-11` override. But relies on override; base `.icon-btn` is 32px (P2-1). | `className=\"icon-btn !w-11 !h-11 shrink-0\"` | Fix base `.icon-btn` (P2-1) → can drop `!w-11 !h-11`. |
| **P2-35** | **Dashboard.jsx:1915–1926** | Title `truncate` + status badge `hidden sm:inline-flex` — **good**, hides badge on mobile. | ✅ **No fix needed** | — |
| **P2-36** | **Dashboard.jsx:2292–2311** | Home header: `flex flex-col md:flex-row justify-between items-start md:items-end gap-5` + chips `flex flex-wrap items-center gap-2` — **wraps correctly**. | ✅ **No fix needed** | — |
| **P2-37** | **Dashboard.jsx:2314** | Home KPI grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4` — **correct**: 1 col on phone, 2 on small tablet, 3 on desktop. | ✅ **No fix needed** | — |
| **P2-38** | **index.css:2500–2501** | Mobile modal height override: `.modal-card, [class*=\"max-h-[95vh]\"] { max-height: 92dvh; }` — **good**, uses `dvh` for dynamic viewport (address bar). | ✅ **No fix needed** | — |
| **P2-39** | **Dashboard.jsx:5199** | `StatCard`: `kpi-card card-surface p-5 rounded-3xl h-32` (128px fixed height). Works in grids. `InventoryCard`: `kpi-card ... h-32` — same. **No min/max width** but grid controls sizing. | ✅ **No fix needed** | — |
| **P2-40** | **Dashboard.jsx:3763–3802** | Missions filter header: multiple `segmented` groups, `actionbar-segment w-full sm:w-auto` — **wraps correctly** due to `.actionbar { flex-wrap: wrap }` in CSS. | ✅ **No fix needed** | — |

---

## SUMMARY — TOP 5 HIGHEST-IMPACT FIXES

| Rank | Finding | Impact | Effort |
|------|---------|--------|--------|
| 1 | **P2-1: `.icon-btn` 32px → 44px globally** | Affects **every modal close, every table action, hamburger, logout** — single CSS change fixes touch targets everywhere. | 1 line CSS |
| 2 | **P2-23: Earthquake global modal missing scroll wrapper** | Content **completely inaccessible** on mobile if form taller than viewport. | ~10 lines JSX |
| 3 | **P2-27: AI News description `min-w-[500px]`** | Forces **>500px table width** on 375px screen — horizontal scroll before any data visible. | 1 line JSX |
| 4 | **P2-9: Audit toolbar horizontal scroll** | 6+ filter buttons hidden in scroll — users **can't find filters** on mobile. | 1 line JSX (add `flex-wrap`) |
| 5 | **P1-2: Handover issues/follow-ups delete buttons 32px** | Core Handover action (delete row) **hard to tap** on mobile. | 1 line JSX per occurrence (2 places) |

---

## QUICK CSS PATCH (apply to `index.css`)

```css
/* 1. Fix all icon buttons to 44×44px touch target */
.icon-btn {
  @apply inline-flex items-center justify-center w-11 h-11 rounded-xl transition-colors; /* was w-8 h-8 */
}
.icon-btn svg {
  @apply w-5 h-5; /* was w-4 h-4 */
}

/* 2. Fix action-btn--icon to explicit 44px square */
.action-btn--icon {
  width: 2.75rem;  /* 44px */
  height: 2.75rem; /* 44px */
  padding: 0;
}

/* 3. Allow btn-primary to shrink/wrap text */
.btn-primary {
  min-width: 0;
  flex-shrink: 1;
}
```

---

## VERIFICATION CHECKLIST (post-fix)

- [ ] `.icon-btn` = 44×44px on all modals, tables, header, sidebar
- [ ] Earthquake global modal scrolls on 375px (open, fill form, verify scroll)
- [ ] AI News table description column ≤320px min-width
- [ ] Audit toolbar filters wrap (no horizontal scroll on toolbar)
- [ ] Handover matrix inputs ≥44px height, table min-width ≤480px
- [ ] Handover issues/follow-ups delete buttons 44×44px
- [ ] Missions StatCard grid: 2 cols (phone) / 3 cols (tablet) / 5 cols (desktop)
- [ ] All tables have explicit `min-w-[Npx]` matching column sum
- [ ] No `whitespace-nowrap` on buttons that should wrap text

---

*Generated by read-only audit. No edits applied. All line numbers reference `src/Dashboard.jsx` and `src/index.css` as of audit date.*