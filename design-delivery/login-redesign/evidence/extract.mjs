// ═══════════════════════════════════════════════════════════════════════════
// 🔎 مُستخرِج الأدلة (Evidence extractor) — يجعل كل رقم في التقرير قابلًا للتحقق
// ---------------------------------------------------------------------------
// يقرأ مخارج أداة القياس (`audit-harness.mjs`) ويُعيد اشتقاق الأرقام الرئيسية
// بنفس تعريفات الأداة نفسها — لا حساب يدوي ولا أرقام مكتوبة بخط اليد.
//
// التشغيل:
//   1) cd <repo root>
//   2) node design-delivery/login-redesign/audit-harness.mjs layout final
//      node design-delivery/login-redesign/audit-harness.mjs flow   final
//      LX_PROBE=noAurora node design-delivery/login-redesign/audit-harness.mjs flow off1
//   3) node design-delivery/login-redesign/evidence/extract.mjs
//
// المخرج: evidence/summary.json (نفس ما يُطبع على الشاشة)
// المصدر الافتراضي: _lx_out/ (يمكن تغييره بـ LX_OUT)
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.env.LX_OUT || '_lx_out';
// fileURLToPath لا .pathname: المسار يحتوي مسافة (`EOC System`) والنسخة المُرمَّزة (`%20`)
// كانت تُنشئ شجرة موازية باسم حرفي — أُصلح ويُكتب الآن بجانب هذا الملف.
const HERE = path.dirname(fileURLToPath(import.meta.url));

const read = (tag, mode) => {
  const p = path.join(OUT, `${tag}-${mode}.json`);
  if (!fs.existsSync(p)) return null;
  return { path: p, data: JSON.parse(fs.readFileSync(p, 'utf8')) };
};

/* ── ١) عدم التمرير: نفس تعريف «التمرير الحقيقي» عند الأداة ────────────────
   يُعدّ الحالة «غير نظيفة» إذا فاض المقاس (أكثر من 1px) أو وُجد عنصر متجاوز
   غير مقصوص بتصميمه، أو أي حاوية قابلة للتمرير. */
const overshoot = (a, b) => Math.max(0, a - b);

function auditSnapshot(label, s) {
  if (!s) return null;
  const bad = {
    doc: overshoot(s.doc.scrollH, s.doc.clientH) > 1 || overshoot(s.doc.scrollW, s.doc.clientW) > 1,
    body: overshoot(s.body.scrollH, s.doc.clientH) > 1 || overshoot(s.body.scrollW, s.doc.clientW) > 1,
    lx: !!s.lxScroll && (overshoot(s.lxScroll.scrollH, s.lxScroll.clientH) > 1 || overshoot(s.lxScroll.scrollW, s.lxScroll.clientW) > 1),
    oversize: (s.oversizeCount ?? 0) > 0,
    scrollers: (s.innerScrollers ?? []).length > 0,
  };
  const clean = !Object.values(bad).includes(true);
  return {
    label,
    clean,
    bad,
    innerScrollers: (s.innerScrollers ?? []).length,
    oversizeCount: s.oversizeCount ?? 0,
    contrastMin: s.contrastMin ?? null,
    contrastFail: s.contrastFail ?? null,
    overflowPx: {
      h: overshoot(s.doc.scrollH, s.doc.clientH),
      w: overshoot(s.doc.scrollW, s.doc.clientW),
    },
  };
}

function layoutAudit(l) {
  if (!l) return null;
  const rows = l.rows ?? [];
  const cells = [];
  for (const r of rows) {
    for (const state of ['gate', 'login']) {
      const a = auditSnapshot(`${r.w}x${r.h} ${r.theme}/${r.lang} ${state}`, r[state]);
      if (a) { a.viewport = `${r.w}x${r.h}`; a.theme = r.theme; a.lang = r.lang; cells.push(a); }
    }
  }
  const zoomCells = [];
  for (const z of l.zoomRows ?? []) {
    for (const state of ['gate', 'login']) {
      const a = auditSnapshot(`${z.physical} zoom${z.zoom} ${state}`, z[state]);
      if (a) { a.zoom = z.zoom; a.physical = z.physical; zoomCells.push(a); }
    }
  }
  const all = [...cells, ...zoomCells];
  const unclean = all.filter((c) => !c.clean);
  return {
    rows: rows.length,
    zoomRows: (l.zoomRows ?? []).length,
    cells: all.length,
    cleanCells: all.length - unclean.length,
    unclean: unclean.map((c) => ({ label: c.label, bad: c.bad })),
    maxOverflowPx: all.reduce((m, c) => Math.max(m, c.overflowPx.h, c.overflowPx.w), 0),
    totalInnerScrollers: all.reduce((n, c) => n + c.innerScrollers, 0),
    contrastMin: Math.min(...all.map((c) => c.contrastMin ?? Infinity).filter(Number.isFinite)),
    contrastFailSum: all.reduce((n, c) => n + (c.contrastFail ?? 0), 0),
    contrastMinByTheme: ['dark', 'light'].reduce((acc, th) => {
      const v = all.filter((c) => c.theme === th).map((c) => c.contrastMin ?? Infinity).filter(Number.isFinite);
      acc[th] = v.length ? Math.min(...v) : null;
      return acc;
    }, {}),
    perViewport: [...new Set(all.map((c) => c.viewport ?? c.physical))].map((vp) => ({
      viewport: vp,
      cells: all.filter((c) => (c.viewport ?? c.physical) === vp).length,
      clean: all.filter((c) => (c.viewport ?? c.physical) === vp && c.clean).length,
    })),
  };
}

/* ── ٢) القفزات/الإطارات: من تشغيل على الشجرة النهائية ────────────────── */
function flowAudit(f) {
  if (!f) return null;
  const raw = f.data ?? f;
  const c = raw.cases ?? {};
  const fr = (name) => (c[name]?.frames ? { p50: c[name].frames.p50, p95: c[name].frames.p95, max: c[name].frames.max, count: c[name].frames.count } : null);
  const jump = (name, sel) => c[name]?.timeline?.elements?.[sel]?.maxRectJumpPx ?? null;
  const pops = (name, sel) => c[name]?.timeline?.elements?.[sel]
    ? { hardPops: c[name].timeline.elements[sel].hardPops, maxOpacityJumpPerFrame: c[name].timeline.elements[sel].maxOpacityJumpPerFrame }
    : null;
  const caps = c.capsLock;
  const rm = c.reducedMotion;
  const rmBoard = rm?.gateEntrance?.elements?.['.lx-gate-board'];
  return {
    generated: raw.generated,
    cases: Object.keys(c),
    cls: { load: c.loadGate?.cls ?? null, cross: c.gateToLogin?.cls ?? null, error: c.errorPath?.cls ?? null },
    frames: { load: fr('loadGate'), cross: fr('gateToLogin'), error: fr('errorPath') },
    errorShift: { card: jump('errorPath', '.lx-card'), submit: jump('errorPath', '.lx-submit'), group: jump('errorPath', '.lx-group') },
    capsLockShift: caps ? {
      cardHBefore: caps.before?.cardH, cardHAfter: caps.after?.cardH,
      btnYBefore: caps.before?.btnY, btnYAfter: caps.after?.btnY,
      hintHBefore: caps.before?.hintH, hintHAfter: caps.after?.hintH,
    } : null,
    crest: { pops: pops('gateToLogin', '.lx-crest'), frame: jump('gateToLogin', '.lx-crest') },
    card: { pops: pops('gateToLogin', '.lx-card') },
    reducedMotion: rm ? { reduce: rm.reduce, firstVisibleMs: rmBoard?.firstVisibleMs ?? null, settleMs: rmBoard?.settleMs ?? null, instant: rmBoard ? rmBoard.firstVisibleMs === rmBoard.settleMs : null } : null,
    keyboardGate: c.keyboardGate ? { tabsBeforeUnlock: c.keyboardGate.tabsBeforeUnlock, focusAfterUnlock: c.keyboardGate.focusAfterUnlock, tabsAfterUnlock: c.keyboardGate.tabsAfterUnlock } : null,
    staticChecks: c.gateToLogin?.static ? {
      oversizeCount: c.gateToLogin.static.oversizeCount,
      innerScrollers: (c.gateToLogin.static.innerScrollers ?? []).length,
      contrastMin: c.gateToLogin.static.contrastMin,
      contrastFail: c.gateToLogin.static.contrastFail,
      hitFails: (c.gateToLogin.static.hitFails ?? []).length,
      fontSizes: c.gateToLogin.static.fontSizesSorted,
    } : null,
  };
}

/* ── ٣) مسبار الهالة: A / B متعاقبان ──────────────────────────────────── */
const aurora = (['abOn1', 'abOff1', 'abOff2', 'abOn2'])
  .map((tag) => { const r = read(tag, 'flow'); return r ? { tag, cross: r.data.cases?.gateToLogin?.frames?.p50 ?? null, p95: r.data.cases?.gateToLogin?.frames?.p95 ?? null } : null; })
  .filter(Boolean);

const summary = {
  generated: new Date().toISOString(),
  source: OUT,
  layout: layoutAudit(read('after', 'layout')?.data ?? read('final', 'layout')?.data),
  flow: flowAudit(read('fix1', 'flow') ?? read('final', 'flow')),
  auroraAB: aurora,
};

fs.mkdirSync(HERE, { recursive: true });
fs.writeFileSync(path.join(HERE, 'summary.json'), JSON.stringify(summary, null, 2));

/* ── تقرير مكثّف على الشاشة ───────────────────────────────────────────── */
const L = summary.layout, F = summary.flow;
if (L) {
  console.log(`layout : ${L.rows} صفًّا + ${L.zoomRows} زوم ⇒ ${L.cells} حالة · نظيفة ${L.cleanCells}/${L.cells} · غير نظيفة ${L.unclean.length}`);
  console.log(`         أقصى فائض ${L.maxOverflowPx}px · حاويات تمرير ${L.totalInnerScrollers} · تباين أدنى داكن ${L.contrastMinByTheme?.dark?.toFixed?.(2)} / فاتح ${L.contrastMinByTheme?.light?.toFixed?.(2)} · فشل AA ${L.contrastFailSum}`);
}
if (F) {
  console.log(`flow   : ${F.cases.join(' · ')}`);
  console.log(`         CLS تحميل/عبور/خطأ = ${F.cls.load} / ${F.cls.cross} / ${F.cls.error}`);
  console.log(`         إطارات: عبور p50=${F.frames.cross?.p50} p95=${F.frames.cross?.p95} · خطأ p50=${F.frames.error?.p50} · تحميل max=${F.frames.load?.max}`);
  console.log(`         انزياح الخطأ: بطاقة Δy=${F.errorShift.card?.y}px Δh=${F.errorShift.card?.h}px · زر Δy=${F.errorShift.submit?.y}px`);
  console.log(`         Caps Lock: cardH ${F.capsLockShift?.cardHBefore}→${F.capsLockShift?.cardHAfter} · btnY ${F.capsLockShift?.btnYBefore}→${F.capsLockShift?.btnYAfter}`);
  console.log(`         الختم: hardPops=${F.crest.pops?.hardPops} · maxOpacityJumpPerFrame=${F.crest.pops?.maxOpacityJumpPerFrame}`);
  console.log(`         تقليل الحركة: instant=${F.reducedMotion?.instant} (${F.reducedMotion?.firstVisibleMs}ms == ${F.reducedMotion?.settleMs}ms)`);
  console.log(`         تركيز قبل الفتح: ${(F.keyboardGate?.tabsBeforeUnlock ?? []).map((t) => t.cls?.trim() || t.tag).join(' → ')}`);
  console.log(`         static: oversize=${F.staticChecks?.oversizeCount} scrollers=${F.staticChecks?.innerScrollers} تباين أدنى=${F.staticChecks?.contrastMin} فشل AA=${F.staticChecks?.contrastFail} أهداف لمس راسبة=${F.staticChecks?.hitFails}`);
}
if (summary.auroraAB.length) {
  console.log('aurora :', summary.auroraAB.map((a) => `${a.tag} p50=${a.cross}/p95=${a.p95}`).join(' · '));
}
if (L?.unclean?.length) console.log('⚠️ حالات غير نظيفة:', JSON.stringify(L.unclean));
console.log(`→ evidence/summary.json (${L?.unclean?.length ? 'يحتاج مراجعة' : 'لا فشل'})`);
