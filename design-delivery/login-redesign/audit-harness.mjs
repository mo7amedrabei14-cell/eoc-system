// Login/Gate audit harness (dev-only scratch tool, never committed).
// Drives the cached Playwright chromium shell over raw CDP:
//   • installs instrumentation BEFORE any page script (real CLS, LoAF, frame deltas,
//     per-frame opacity/rect timeline of the gate + card)
//   • drives the real drag gesture, the real 401 error path, the real keyboard path
//   • measures no-scroll / overflow / hit-testing / AA contrast / design tokens
//   • writes JSON evidence + screenshots
//
// Usage:
//   node _lx_audit.mjs flow      # transition, pop-in, error shift, keyboard, reduced motion
//   node _lx_audit.mjs layout    # no-scroll matrix (viewports + zoom), dark/light × ar/en
//   node _lx_audit.mjs shots     # before/after screenshot set
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from '../../node_modules/ws/index.js';

const CHROME = 'C:/Users/mo7am/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const URL = process.env.LX_URL || 'http://localhost:5174/';
const PORT = 0; // resolved per launch (random free port)
const portBase = 9400 + Math.floor(Math.random() * 400);
const OUT = process.env.LX_OUT || '_lx_out';
const mode = process.argv[2] || 'flow';
const tag = process.argv[3] || 'x'; // 'before' | 'after'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rmSafe = (p, tries = 6) => { for (let i = 0; i < tries; i++) { try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch { /* locked by chrome, retry */ } } return false; };
const pad = (n) => String(n).padStart(2, '0');

/* ── what the per-frame sampler watches (missing selectors are skipped) ───── */
const SELS = [
  '.lx-scene', '.lx-pill-btn', '.lx-switch',
  '.lx-gate', '.lx-gate-board', '.lx-gate-emblem', '.lx-crest-stack', '.lx-crest', '.lx-gate-title', '.lx-gate-sub',
  '.lx-gate-slider', '.lx-track', '.lx-track-label', '.lx-handle',
  '.lx-stage', '.lx-card', '.lx-card-head', '.lx-logo-tile', '.lx-brand-name', '.lx-card-body',
  '.lx-form-column', '.lx-intro', '.lx-title', '.lx-sub', '.lx-username', '.lx-password', '.lx-group', '.lx-label',
  '.lx-input-wrap', '.lx-input', '.lx-eye', '.lx-submit', '.lx-trust', '.lx-error', '.lx-caps', '.lx-hint',
  '.lx-otp-panel', '.otp-orbit-zone',
];

function instrument(theme, lang) {
  return `(() => {
  try {
    localStorage.setItem('dashboard-theme', ${JSON.stringify(theme)});
    localStorage.setItem('dashboard-language', ${JSON.stringify(lang)});
  } catch (e) {}
  const SELS = ${JSON.stringify(SELS)};
  const W = window;
  const S = W.__lx = { cls: 0, shifts: [], loaf: [], frames: [], tl: [], marks: {}, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const src = (e.sources || []).map((s) => (s.node && (s.node.className || s.node.nodeName)) || '').join('|');
        S.shifts.push({ v: +e.value.toFixed(5), t: Math.round(e.startTime), recent: !!e.hadRecentInput, src });
        if (!e.hadRecentInput) S.cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) S.loaf.push({ t: Math.round(e.startTime), dur: +e.duration.toFixed(1), block: +e.blockingDuration.toFixed(1), style: +e.styleAndLayoutStart ? Math.round(e.styleAndLayoutStart - e.startTime) : null });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}
  const t0 = performance.now();
  let last = t0;
  let frame = 0;
  let cache = new Map();
  function effOpacity(el) {
    const hit = cache.get(el);
    if (hit !== undefined) return hit;
    const own = +getComputedStyle(el).opacity;
    const par = el.parentElement;
    const val = par ? own * effOpacity(par) : own;
    cache.set(el, val);
    return val;
  }
  function sample(t) {
    cache = new Map();
    for (const sel of SELS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // effective opacity = product down the ancestor chain (cached per frame:
      // the sampler itself must not become the frame-budget bottleneck).
      let op = +effOpacity(el).toFixed(3);
      const visChain = cs.visibility !== 'hidden' && cs.display !== 'none';
      const row = {
        s: sel, f: frame, t: Math.round(t),
        op,
        x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10,
        w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
        tr: cs.transform === 'none' ? '' : cs.transform,
        d: cs.display, v: visChain ? 'visible' : 'hidden',
      };
      const p = S.__last && S.__last[sel];
      if (!p || p.op !== row.op || p.x !== row.x || p.y !== row.y || p.w !== row.w || p.h !== row.h || p.d !== row.d || p.v !== row.v) {
        S.tl.push(row);
        (S.__last || (S.__last = {}))[sel] = row;
      }
    }
  }
  function tick(now) {
    S.frames.push(Math.round((now - last) * 10) / 10);
    last = now;
    frame++;
    sample(Math.round(now - t0));
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  S.mark = (name) => { S.marks[name] = Math.round(performance.now() - t0); };
  S.snapshot = () => JSON.stringify({
    cls: +S.cls.toFixed(5),
    reduce: S.reduce,
    shifts: S.shifts,
    loaf: S.loaf,
    frames: S.frames,
    tl: S.tl,
    marks: S.marks,
  });
})();`;
}

/* ── static audits run in the page after settle ──────────────────────────── */
const STATIC_AUDIT = `(() => {
  const out = {};
  const de = document.documentElement;
  out.viewport = { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, zoom: +(outerWidth ? (outerWidth / innerWidth).toFixed(3) : 1) };
  out.doc = { scrollH: de.scrollHeight, clientH: de.clientHeight, scrollW: de.scrollWidth, clientW: de.clientWidth };
  out.body = { scrollH: document.body.scrollHeight, scrollW: document.body.scrollWidth };
  const lx = document.querySelector('.lx');
  out.lxScroll = lx ? { scrollH: lx.scrollHeight, clientH: lx.clientHeight, scrollW: lx.scrollWidth, clientW: lx.clientWidth } : null;
  // oversize: anything drawn outside the viewport
  const over = [];
  document.querySelectorAll('.lx *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const dx = Math.max(0, -r.left) + Math.max(0, r.right - innerWidth);
    const dy = Math.max(0, -r.top) + Math.max(0, r.bottom - innerHeight);
    if (dx > 0.5 || dy > 0.5) {
      let clipped = false, p = el.parentElement;
      while (p && !clipped) {
        const cs = getComputedStyle(p);
        if ((cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && (cs.overflow !== 'visible')) clipped = true;
        p = p.parentElement;
      }
      over.push({ sel: el.className && String(el.className).slice(0, 60), dx: +dx.toFixed(1), dy: +dy.toFixed(1), clipped });
    }
  });
  // عنصر خلفية مقصوص بتصميمه (هالة/تدرّج) ليس عيبًا — يُفصل عن الفائض الحقيقي
  const real = over.filter((o) => !o.clipped);
  out.oversize = real.slice(0, 25);
  out.oversizeCount = real.length;
  out.oversizeClippedByDesign = over.length - real.length;
  // clipped content inside scroll containers
  const scrollers = [];
  document.querySelectorAll('.lx *').forEach((el) => {
    const cs = getComputedStyle(el);
    const scrolls = (cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowX === 'auto' || cs.overflowX === 'scroll');
    if (!scrolls) return;
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) {
      scrollers.push({ sel: String(el.className).slice(0, 60), sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth });
    }
  });
  out.innerScrollers = scrollers;
  // hit-testing: nothing transparent may sit on top of a *visible* control
  // (عناصر مخفية/خاملة في لوح غير نشط تُستثنى — لا يمكن أن تُنقر أصلاً)
  const hits = [];
  const effOp = (el) => { let op = +getComputedStyle(el).opacity; let p = el.parentElement; while (p && op > 0.001) { op *= +getComputedStyle(p).opacity; p = p.parentElement; } return op; };
  const isExposed = (el) => {
    if (el.closest('[inert]')) return false;
    if (getComputedStyle(el).visibility === 'hidden') return false;
    return effOp(el) > 0.05;
  };
  document.querySelectorAll('.lx button, .lx input, .lx [role="slider"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (!isExposed(el)) return;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    hits.push({ sel: String(el.className).slice(0, 40) || el.tagName, ok: top === el || (top && el.contains(top)), top: top ? String(top.className).slice(0, 40) || top.tagName : null });
  });
  out.hits = hits;
  // rects of the primary surfaces
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), cx: +(r.left + r.width / 2).toFixed(1), cy: +(r.top + r.height / 2).toFixed(1) }; };
  out.rects = {
    gateBoard: rect('.lx-gate-board'), card: rect('.lx-card'), track: rect('.lx-track'), handle: rect('.lx-handle'),
    title: rect('.lx-title'), submit: rect('.lx-submit'), firstField: rect('.lx-input-wrap'), group: rect('.lx-group'),
  };
  // contrast (WCAG AA) for every visible text node
  const parse = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map((v) => parseFloat(v)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over_ = (fg, bg) => { const a = fg.a + bg.a * (1 - fg.a); return { r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a, g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a, b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a, a }; };
  const bgOf = (el) => {
    let acc = null, p = el;
    while (p) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c && c.a > 0) acc = acc ? { ...over_(acc, c), a: acc.a + c.a * (1 - acc.a) } : c;
      if (acc && acc.a >= 0.999) return acc;
      p = p.parentElement;
    }
    return acc || { r: 255, g: 255, b: 255, a: 1 };
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const texts = [];
  document.querySelectorAll('.lx *').forEach((el) => {
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || +cs.opacity === 0 || cs.display === 'none') return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fg = parse(cs.color); if (!fg) return;
    const bg = bgOf(el);
    const f = over_(fg, bg);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const cr = +ratio(f, bg).toFixed(2);
    texts.push({ sel: String(el.className).slice(0, 44) || el.tagName, size, weight, cr, need: large ? 3 : 4.5, pass: cr >= (large ? 3 : 4.5) });
  });
  out.contrast = texts;
  out.contrastFail = texts.filter((t) => !t.pass);
  // design token census: distinct rendered values under .lx
  const census = (make) => { const m = new Map(); document.querySelectorAll('.lx, .lx *').forEach((el) => { const cs = getComputedStyle(el); for (const v of [].concat(make(el, cs)).filter(Boolean)) { if (v === 'none' || v === 'normal' || v === 'rgba(0, 0, 0, 0)' || v === '0px') continue; m.set(v, (m.get(v) || 0) + 1); } }); return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1])); };
  out.tokens = {
    fontSize: census((el, cs) => el.childNodes.length && Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) ? cs.fontSize : ''),
    color: census((el, cs) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) ? cs.color : ''),
    backgroundImage: census((el, cs) => cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 90) : ''),
    boxShadow: census((el, cs) => cs.boxShadow !== 'none' ? cs.boxShadow.slice(0, 80) : ''),
    borderRadius: census((el, cs) => cs.borderRadius !== '0px' ? cs.borderRadius : ''),
    borderWidth: census((el, cs) => { const w = cs.borderTopWidth; return w && w !== '0px' ? w : ''; }),
    fontFamily: census((el, cs) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) ? cs.fontFamily.split(',')[0] : ''),
    transitionDuration: census((el, cs) => cs.transitionDuration !== '0s' ? cs.transitionDuration : ''),
    letterSpacing: census((el, cs) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()) ? cs.letterSpacing : ''),
  };
  out.fontSizesSorted = Object.keys(out.tokens.fontSize).map(parseFloat).sort((a, b) => a - b);
  // gate verification + focus order
  out.a11y = {
    knob: (() => { const k = document.querySelector('.lx [role="slider"]'); return k ? { label: k.getAttribute('aria-label'), now: k.getAttribute('aria-valuenow'), min: k.getAttribute('aria-valuemin'), max: k.getAttribute('aria-valuemax'), describedby: k.getAttribute('aria-describedby'), tab: k.tabIndex } : null; })(),
    live: Array.from(document.querySelectorAll('.lx [aria-live], .lx [role="alert"], .lx [role="status"]')).map((e) => ({ role: e.getAttribute('role'), live: e.getAttribute('aria-live'), text: (e.textContent || '').trim().slice(0, 60) })),
    inputs: Array.from(document.querySelectorAll('.lx input')).map((e) => ({ type: e.type, autocomplete: e.getAttribute('autocomplete'), label: e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].textContent.trim()), hasId: !!e.id })),
    tabIndexes: Array.from(document.querySelectorAll('.lx button, .lx input, .lx [role="slider"], .lx a')).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 30), tab: e.tabIndex })),
  };
  out.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  out.activeEl = document.activeElement ? (String(document.activeElement.className).slice(0, 40) || document.activeElement.tagName) : null;
  return JSON.stringify(out);
})()`;

/* ── timeline analysis (node side) ───────────────────────────────────────── */
function analyse(tl, marks) {
  const bySel = new Map();
  for (const row of tl) {
    if (!bySel.has(row.s)) bySel.set(row.s, []);
    bySel.get(row.s).push(row);
  }
  const res = {};
  for (const [sel, rows] of bySel) {
    const vis = rows.filter((r) => r.op > 0.02 && r.w > 0 && r.d !== 'none' && r.v !== 'hidden');
    const first = vis[0] || null;
    let maxOpJump = 0, maxDx = 0, maxDy = 0, maxDw = 0, maxDh = 0, jumps = [];
    for (let i = 1; i < vis.length; i++) {
      const a = vis[i - 1], b = vis[i];
      const dop = +(b.op - a.op).toFixed(3);
      if (dop > maxOpJump) { maxOpJump = dop; }
      if (dop >= 0.35) jumps.push({ t: b.t, dop, dt: b.t - a.t });
      maxDx = Math.max(maxDx, Math.abs(b.x - a.x));
      maxDy = Math.max(maxDy, Math.abs(b.y - a.y));
      maxDw = Math.max(maxDw, Math.abs(b.w - a.w));
      maxDh = Math.max(maxDh, Math.abs(b.h - a.h));
    }
    // settle: last frame where opacity/rect still changing
    let settle = first ? first.t : null;
    for (let i = 1; i < vis.length; i++) {
      const a = vis[i - 1], b = vis[i];
      if (b.op - a.op > 0.005 || Math.abs(b.x - a.x) > 0.5 || Math.abs(b.y - a.y) > 0.5 || Math.abs(b.w - a.w) > 0.5 || Math.abs(b.h - a.h) > 0.5) settle = b.t;
    }
    res[sel] = {
      firstVisibleMs: first ? first.t : null,
      settleMs: settle,
      maxOpacityJumpPerFrame: +maxOpJump.toFixed(3),
      hardPops: jumps.length,
      popDetails: jumps.slice(0, 6),
      maxRectJumpPx: { x: +maxDx.toFixed(1), y: +maxDy.toFixed(1), w: +maxDw.toFixed(1), h: +maxDh.toFixed(1) },
      samples: vis.length,
      finalRect: vis.length ? { x: vis[vis.length - 1].x, y: vis[vis.length - 1].y, w: vis[vis.length - 1].w, h: vis[vis.length - 1].h } : null,
    };
  }
  return { elements: res, marks };
}

function frameStats(frames, fromIndex = 0) {
  const f = frames.slice(fromIndex).filter((v) => v > 0);
  if (!f.length) return null;
  const sorted = [...f].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    count: f.length,
    p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +sorted[sorted.length - 1].toFixed(2),
    over33ms: f.filter((v) => v > 33.4).length,
    over50ms: f.filter((v) => v > 50).length,
    mean: +(f.reduce((a, b) => a + b, 0) / f.length).toFixed(2),
  };
}

/* ── CDP plumbing ────────────────────────────────────────────────────────── */
class Session {
  constructor(ws, rpc) { this.ws = ws; this.rpc = rpc; this.events = []; }
  async evaluate(expression) {
    const r = await this.rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  }
  async shot(file, quality = 88) {
    const r = await this.rpc('Page.captureScreenshot', { format: 'jpeg', quality, captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  }
  async metrics(w, h, zoom = 1) {
    await this.rpc('Emulation.setDeviceMetricsOverride', { width: Math.round(w), height: Math.round(h), deviceScaleFactor: 1, mobile: false });
  }
  async setMedia(reduce) {
    await this.rpc('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
  }
  async mouse(type, x, y, extra = {}) {
    await this.rpc('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), ...extra });
  }
  async key(key, code, keyCode, extra = {}) {
    await this.rpc('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...extra });
    await this.rpc('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, ...extra });
  }
  async drag(sel = '.lx-handle', steps = 16, stepDelay = 22) {
    const r = await this.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const tr = document.querySelector('.lx-track') || el.parentElement; if (!el || !tr) return null; const a = el.getBoundingClientRect(), b = tr.getBoundingClientRect(); return { hx: a.left + a.width / 2, hy: a.top + a.height / 2, rx: b.right - a.width / 2 - 4, ry: b.top + b.height / 2 }; })()`);
    if (!r) throw new Error('drag target missing: ' + sel);
    await this.mouse('mouseMoved', r.hx, r.hy);
    await this.mouse('mousePressed', r.hx, r.hy, { button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await this.mouse('mouseMoved', r.hx + ((r.rx - r.hx) * i) / steps, r.ry, { button: 'left', buttons: 1 });
      await sleep(stepDelay);
    }
    await this.mouse('mouseReleased', r.rx, r.ry, { button: 'left', clickCount: 1, buttons: 0 });
    return { from: { x: Math.round(r.hx), y: Math.round(r.hy) }, to: { x: Math.round(r.rx), y: Math.round(r.ry) } };
  }
}

async function launch(theme, lang, w, h, reduce = false) {
  const profile = path.join(process.cwd(), '_lx_profile_' + process.pid + '_' + Math.random().toString(36).slice(2, 7));
  const logPath = path.join(OUT, `chrome-${process.pid}.log`);
  let logFd = fs.openSync(logPath, 'w');
  let chrome = null;
  let port = portBase;
  let exited = null;
  let targets = null;
  for (let attempt = 0; attempt < 6 && !targets; attempt++) {
    port = portBase + attempt;
    rmSafe(profile);
    logFd = fs.openSync(logPath, 'w');
    exited = null;
    chrome = spawn(CHROME, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${Math.max(w, 800)},${Math.max(h, 600)}`,
      '--no-first-run', '--no-default-browser-check', 'about:blank',
    ], { stdio: ['ignore', logFd, logFd] });
    chrome.on('exit', (code, sig) => { exited = { code, sig }; });
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await res.json();
        if (list && list.length && list.some((t) => t.type === 'page')) { targets = list; break; }
      } catch { /* not ready */ }
    }
    if (!targets) { try { chrome.kill('SIGKILL'); } catch {} await sleep(300); }
  }
  if (!targets) {
    const log = (() => { try { return fs.readFileSync(logPath, 'utf8').slice(0, 500); } catch { return '(no log)'; } })();
    rmSafe(profile);
    throw new Error(`devtools endpoint never came up (port=${port} exited=${JSON.stringify(exited)}) log: ${log}`);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0;
  const pending = new Map();
  const s = new Session(ws, (method, params = {}) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); }));
  const origRpc = s.rpc;
  s.rpc = (method, params = {}) => {
    const mid = ++id;
    return new Promise((res) => { pending.set(mid, (msg) => { if (msg.error) throw new Error(method + ': ' + JSON.stringify(msg.error)); else res(msg); }); ws.send(JSON.stringify({ id: mid, method, params })); });
  };
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) { const cb = pending.get(msg.id); pending.delete(msg.id); cb(msg); }
    else if (msg.method) s.events.push(msg);
  });
  await s.rpc('Page.enable');
  await s.rpc('Runtime.enable');
  await s.rpc('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  if (reduce) await s.setMedia(true);
  await s.rpc('Page.addScriptToEvaluateOnNewDocument', { source: instrument(theme, lang) });
  // عزل تجريبي: هل الهالة الخلفية هي سبب أي إطار متأخر؟ (LX_PROBE=noAurora)
  if (process.env.LX_PROBE === 'noAurora') {
    await s.rpc('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const st = document.createElement('style'); st.textContent = '.lx-aurora{display:none!important}'; (document.head || document.documentElement).appendChild(st); })();`,
    });
  }
  return { chrome, s, profile, close: async () => { try { ws.close(); } catch {} chrome.kill('SIGKILL'); await sleep(250); rmSafe(profile); } };
}

async function goto(s, url = URL, waitMs = 2600) {
  await s.rpc('Page.navigate', { url });
  await sleep(waitMs);
}

async function readSnapshot(s) {
  const raw = await s.evaluate('window.__lx.snapshot()');
  return JSON.parse(raw);
}

async function staticAudit(s) {
  const raw = await s.evaluate(STATIC_AUDIT);
  return JSON.parse(raw);
}

/* ── scenarios ───────────────────────────────────────────────────────────── */
const $ = (o) => o;
const layoutMatrix = [
  [1920, 1080], [1600, 900], [1536, 864], [1440, 900], [1366, 768], [1280, 720], [1024, 768],
  [390, 844], [360, 640], [844, 390], [320, 568],
];
const zoomMatrix = [[1920, 1080, 1.1], [1920, 1080, 1.25], [1366, 768, 1.25], [1366, 768, 1.1]];
const themeLang = [['dark', 'ar'], ['light', 'ar'], ['dark', 'en'], ['light', 'en']];
const shotMatrix = [[1920, 1080], [1366, 768], [390, 844]];

async function runFlow() {
  const out = { tag, url: URL, generated: new Date().toISOString(), cases: {} };
  try {

  // ── 1) load → gate entrance + real CLS / LoAF / frames
  {
    const { s, close } = await launch('dark', 'ar', 1920, 1080);
    try {
      await goto(s);
      const snap = await readSnapshot(s);
      const st = await staticAudit(s);
      out.cases.loadGate = {
        cls: snap.cls,
        shifts: snap.shifts,
        loaf: snap.loaf,
        frames: frameStats(snap.frames),
        timeline: analyse(snap.tl, snap.marks),
        static: st,
      };
      await s.shot(path.join(OUT, `${tag}-gate-1920x1080-dark-ar.jpg`));
    } finally { await close(); }
  }

  // ── 2) gate → login transition (the pop-in complaint lives here)
  {
    const { s, close } = await launch('dark', 'ar', 1920, 1080);
    try {
      await goto(s, URL, 2200);
      await s.evaluate('window.__lx.tl.length = 0; window.__lx.shifts.length = 0; window.__lx.loaf.length = 0; window.__lx.frames.length = 0; window.__lx.__last = null; window.__lx.cls = 0; window.__lx.mark("beforeDrag")');
      await s.drag('.lx-handle', 16, 22);
      await s.evaluate('window.__lx.mark("released")');
      await sleep(2000);
      const snap = await readSnapshot(s);
      const st = await staticAudit(s);
      out.cases.gateToLogin = {
        cls: snap.cls,
        shifts: snap.shifts,
        loaf: snap.loaf,
        frames: frameStats(snap.frames),
        timeline: analyse(snap.tl, snap.marks),
        tlRaw: snap.tl,
        static: st,
      };
      await s.shot(path.join(OUT, `${tag}-login-1920x1080-dark-ar.jpg`));
    } finally { await close(); }
  }

  // ── 3) error path: 401 from the real backend → does content jump?
  {
    const { s, close } = await launch('dark', 'ar', 1920, 1080);
    try {
      await goto(s, URL, 2200);
      await s.drag('.lx-handle', 16, 22);
      await sleep(1500);
      await s.evaluate(`(() => { const u = document.querySelector('.lx-username') || document.querySelector('#lx-username'); if (u) u.focus(); return !!u; })()`);
      await s.rpc('Input.insertText', { text: 'nouser_' + Date.now() });
      await s.evaluate(`(() => { const p = document.querySelector('.lx-password') || document.querySelector('#lx-password'); if (p) p.focus(); return !!p; })()`);
      await s.rpc('Input.insertText', { text: 'wrongpass' });
      await s.evaluate('window.__lx.tl.length = 0; window.__lx.shifts.length = 0; window.__lx.loaf.length = 0; window.__lx.frames.length = 0; window.__lx.__last = null; window.__lx.cls = 0; window.__lx.mark("beforeSubmit")');
      const before = await s.evaluate(`JSON.stringify({ card: (() => { const r = document.querySelector('.lx-card').getBoundingClientRect(); return { y: r.top, h: r.height }; })(), btn: (() => { const r = document.querySelector('.lx-submit').getBoundingClientRect(); return { y: r.top }; })() })`);
      const btn = await s.evaluate(`(() => { const r = document.querySelector('.lx-submit').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await s.mouse('mouseMoved', btn.x, btn.y);
      await s.mouse('mousePressed', btn.x, btn.y, { button: 'left', clickCount: 1, buttons: 1 });
      await s.mouse('mouseReleased', btn.x, btn.y, { button: 'left', clickCount: 1, buttons: 0 });
      await sleep(3200);
      await s.evaluate('window.__lx.mark("afterError")');
      const snap = await readSnapshot(s);
      const st = await staticAudit(s);
      const after = await s.evaluate(`JSON.stringify({ card: (() => { const r = document.querySelector('.lx-card').getBoundingClientRect(); return { y: r.top, h: r.height }; })(), btn: (() => { const r = document.querySelector('.lx-submit').getBoundingClientRect(); return { y: r.top }; })(), alert: (() => { const a = document.querySelector('.lx-alert'); return a ? { shown: a.classList.contains('is-shown'), h: Math.round(a.getBoundingClientRect().height), text: (a.textContent || '').trim().slice(0, 60) } : null; })(), err: document.querySelector('.lx-error') ? document.querySelector('.lx-error').textContent.trim().slice(0, 80) : null })`);
      out.cases.errorPath = {
        before: JSON.parse(before), after: JSON.parse(after),
        cls: snap.cls, shifts: snap.shifts, loaf: snap.loaf, frames: frameStats(snap.frames),
        timeline: analyse(snap.tl, snap.marks), tlRaw: snap.tl, static: st,
      };
      await s.shot(path.join(OUT, `${tag}-login-error-dark-ar.jpg`));
    } finally { await close(); }
  }

  // ── 4) caps lock hint → does it push the button?
  {
    // أضيق مقاس: نتأكد أن تنبيه Caps Lock يسكن السطر المحجوز ولا يزحزح شيئًا
    const { s, close } = await launch('dark', 'ar', 320, 568);
    try {
      await goto(s, URL, 2200);
      await s.drag('.lx-handle', 16, 22);
      await sleep(1500);
      const before = await s.evaluate(`(() => { const b = document.querySelector('.lx-submit'); const c = document.querySelector('.lx-card'); const h = document.querySelector('.lx-hint'); const r = b.getBoundingClientRect(), cr = c.getBoundingClientRect(); return JSON.stringify({ btnY: +r.top.toFixed(1), cardH: +cr.height.toFixed(1), cardY: +cr.top.toFixed(1), hintH: +h.getBoundingClientRect().height.toFixed(1) }); })()`);
      await s.evaluate(`window.__lx.tl.length = 0; window.__lx.__last = null; window.__lx.mark("beforeCaps")`);
      await s.evaluate(`(() => {
        const p = document.querySelector('.lx-password') || document.querySelector('#lx-password');
        if (!p) return false;
        const ev = new KeyboardEvent('keyup', { key: 'a', bubbles: true });
        Object.defineProperty(ev, 'getModifierState', { value: (k) => k === 'CapsLock' });
        p.dispatchEvent(ev);
        return true;
      })()`);
      await sleep(900);
      const after = await s.evaluate(`(() => { const b = document.querySelector('.lx-submit'); const c = document.querySelector('.lx-card'); const h = document.querySelector('.lx-hint'); const r = b.getBoundingClientRect(), cr = c.getBoundingClientRect(); return JSON.stringify({ btnY: +r.top.toFixed(1), cardH: +cr.height.toFixed(1), cardY: +cr.top.toFixed(1), hintH: +h.getBoundingClientRect().height.toFixed(1), caps: !!document.querySelector('.lx-hint-caps') || !!document.querySelector('.lx-caps') }); })()`);
      const snap = await readSnapshot(s);
      out.cases.capsLock = { before: JSON.parse(before), after: JSON.parse(after), timeline: analyse(snap.tl, snap.marks) };
    } finally { await close(); }
  }

  // ── 5) keyboard-only gate
  {
    const { s, close } = await launch('dark', 'ar', 1280, 800);
    try {
      await goto(s, URL, 2200);
      // ترتيب التركيز الحقيقي قبل الفتح: يجب ألا يصل Tab إلى نموذج مخفي
      const tabRead = () => s.evaluate(`JSON.stringify({ tag: document.activeElement.tagName, cls: String(document.activeElement.className).slice(0, 34), role: document.activeElement.getAttribute && document.activeElement.getAttribute('role') })`);
      const tabsBefore = [];
      await s.evaluate('document.activeElement && document.activeElement.blur(); document.body.focus();');
      for (let i = 0; i < 6; i++) { await s.key('Tab', 'Tab', 9); await sleep(120); tabsBefore.push(JSON.parse(await tabRead())); }

      const steps = [];
      const focusRes = await s.evaluate(`(() => { const k = document.querySelector('.lx [role="slider"]'); if (!k) return 'NO_KNOB:' + document.body.innerHTML.slice(0, 120); k.focus(); return 'focused'; })()`);
      steps.push({ step: 'focus', result: focusRes });
      const read = () => s.evaluate(`(() => { const k = document.querySelector('.lx [role="slider"]'); return JSON.stringify({ found: !!k, now: k ? +k.getAttribute('aria-valuenow') : null, label: k ? k.getAttribute('aria-label') : null, gate: !!document.querySelector('.lx-gate') }); })()`);
      steps.push({ step: 'afterFocus', ...JSON.parse(await read()) });
      for (let i = 0; i < 9; i++) {
        await s.key('ArrowRight', 'ArrowRight', 39);
        await sleep(220);
        steps.push({ step: 'arrow' + (i + 1), ...JSON.parse(await read()) });
      }
      await s.key('Enter', 'Enter', 13);
      await sleep(1600);
      steps.push({ step: 'enter', ...JSON.parse(await read()) });
      const focus = await s.evaluate(`JSON.stringify({ active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null, id: document.activeElement ? document.activeElement.id : null })`);
      // ترتيب التركيز الحقيقي بعد الفتح: النموذج ثم التحكمات، بلا أي خانة OTP مخفية
      const tabsAfter = [];
      for (let i = 0; i < 8; i++) { await s.key('Tab', 'Tab', 9); await sleep(120); tabsAfter.push(JSON.parse(await tabRead())); }
      out.cases.keyboardGate = { tabsBeforeUnlock: tabsBefore, steps, focusAfterUnlock: JSON.parse(focus), tabsAfterUnlock: tabsAfter };
    } finally { await close(); }
  }

  // ── 6) reduced motion: everything must still appear, instantly, no animation
  {
    const { s, close } = await launch('dark', 'ar', 1440, 900, true);
    try {
      await goto(s);
      const snap1 = await readSnapshot(s);
      await s.evaluate('window.__lx.tl.length = 0; window.__lx.__last = null; window.__lx.mark("preDrag")');
      await s.drag('.lx-handle', 14, 20);
      await sleep(1400);
      const snap2 = await readSnapshot(s);
      const st = await staticAudit(s);
      out.cases.reducedMotion = {
        reduce: snap2.reduce,
        gateEntrance: analyse(snap1.tl, snap1.marks),
        transition: analyse(snap2.tl, snap2.marks),
        static: st,
      };
      await s.shot(path.join(OUT, `${tag}-login-1440x900-reduced-dark-ar.jpg`));
    } finally { await close(); }
  }

  } catch (e) {
    out.fatal = String((e && e.message) || e);
    console.error('case failed:', out.fatal);
  } finally {
    fs.writeFileSync(path.join(OUT, `${tag}-flow.json`), JSON.stringify(out, null, 1));
  }
  return out;
}

async function runLayout() {
  const out = { tag, generated: new Date().toISOString(), rows: [], zoomRows: [], themeLang: [] };
  try {

  for (const [w, h] of layoutMatrix) {
    for (const [theme, lang] of [['dark', 'ar'], ['light', 'ar'], ['dark', 'en'], ['light', 'en']]) {
      const { s, close } = await launch(theme, lang, w, h);
      try {
        await goto(s, URL, 2200);
        const gate = await staticAudit(s);
        await s.drag('.lx-handle', 10, 14).catch(() => null);
        await sleep(1400);
        const login = await staticAudit(s);
        out.rows.push({ w, h, theme, lang, gate: trimStatic(gate), login: trimStatic(login) });
      } finally { await close(); }
    }
  }

  for (const [pw, ph, z] of zoomMatrix) {
    const w = Math.round(pw / z), h = Math.round(ph / z);
    const { s, close } = await launch('dark', 'ar', w, h);
    try {
      await goto(s, URL, 2200);
      const gate = await staticAudit(s);
      await s.drag('.lx-handle', 10, 14).catch(() => null);
      await sleep(1400);
      const login = await staticAudit(s);
      out.zoomRows.push({ physical: `${pw}x${ph}`, zoom: z, cssViewport: `${w}x${h}`, gate: trimStatic(gate), login: trimStatic(login) });
    } finally { await close(); }
  }

  for (const [theme, lang] of themeLang) {
    const { s, close } = await launch(theme, lang, 1920, 1080);
    try {
      await goto(s, URL, 2200);
      const gate = await staticAudit(s);
      await s.shot(path.join(OUT, `${tag}-gate-1920x1080-${theme}-${lang}.jpg`));
      await s.drag('.lx-handle', 10, 14).catch(() => null);
      await sleep(1400);
      const login = await staticAudit(s);
      await s.shot(path.join(OUT, `${tag}-login-1920x1080-${theme}-${lang}.jpg`));
      out.themeLang.push({ theme, lang, gate: trimStatic(gate), login: trimStatic(login) });
    } finally { await close(); }
  }

  } catch (e) {
    out.fatal = String((e && e.message) || e);
    console.error('layout case failed:', out.fatal);
  } finally {
    fs.writeFileSync(path.join(OUT, `${tag}-layout.json`), JSON.stringify(out, null, 1));
  }
  return out;
}

function trimStatic(st) {
  return $({
    viewport: st.viewport, doc: st.doc, body: st.body, lxScroll: st.lxScroll,
    oversizeCount: st.oversizeCount, oversize: st.oversize.slice(0, 6), innerScrollers: st.innerScrollers,
    hitFails: st.hits.filter((h) => !h.ok), rects: st.rects,
    contrastMin: st.contrast.length ? Math.min(...st.contrast.map((c) => c.cr)) : null,
    contrastWorst: st.contrast.slice().sort((a, b) => a.cr - b.cr).slice(0, 8),
    contrastFail: st.contrastFail,
    fontSizesSorted: st.fontSizesSorted, tokens: st.tokens, a11y: st.a11y, activeEl: st.activeEl,
  });
}

/* شريط إطارات حقيقي لانتقال البوابة ← الدخول: لقطات متتابعة بأزمنة مقيسة فعليًّا. */
async function runSequence() {
  const out = { tag, frames: [] };
  const { s, close } = await launch('dark', 'ar', 1440, 900);
  try {
    await goto(s, URL, 2200);
    await s.evaluate(`window.__lx.mark('preDrag')`);
    const handle = await s.evaluate(`(() => { const el = document.querySelector('.lx-handle'); const tr = document.querySelector('.lx-track'); const a = el.getBoundingClientRect(), b = tr.getBoundingClientRect(); return { hx: a.left + a.width / 2, hy: a.top + a.height / 2, rx: b.right - a.width / 2 - 4, ry: b.top + b.height / 2 }; })()`);
    await s.mouse('mouseMoved', handle.hx, handle.hy);
    await s.mouse('mousePressed', handle.hx, handle.hy, { button: 'left', clickCount: 1, buttons: 1 });
    for (let i = 1; i <= 4; i++) {
      await s.mouse('mouseMoved', handle.hx + ((handle.rx - handle.hx) * i) / 4, handle.ry, { button: 'left', buttons: 1 });
      await sleep(30);
    }
    await s.evaluate(`window.__lx.mark('release')`);
    await s.mouse('mouseReleased', handle.rx, handle.ry, { button: 'left', clickCount: 1, buttons: 0 });
    for (let i = 0; i < 7; i++) {
      const t = await s.evaluate(`Math.round(performance.now() - window.__lx.marks.release)`);
      const file = path.join(OUT, `${tag}-sequence-${pad(i + 1)}-t${t}ms.jpg`);
      await s.shot(file, 80);
      out.frames.push({ n: i + 1, tMs: t, file: path.basename(file) });
      await sleep(60);
    }
    fs.writeFileSync(path.join(OUT, `${tag}-sequence.json`), JSON.stringify(out, null, 1));
  } finally { await close(); }
  return out;
}

async function runShots() {
  const out = { shots: [] };
  for (const [w, h] of shotMatrix) {
    for (const [theme, lang] of themeLang) {
      const { s, close } = await launch(theme, lang, w, h);
      try {
        await goto(s, URL, 2200);
        await s.shot(path.join(OUT, `${tag}-gate-${w}x${h}-${theme}-${lang}.jpg`));
        await s.drag('.lx-handle', 12, 18).catch(() => null);
        await sleep(1800);
        await s.shot(path.join(OUT, `${tag}-login-${w}x${h}-${theme}-${lang}.jpg`));
        out.shots.push(`${tag}-${w}x${h}-${theme}-${lang}`);
      } finally { await close(); }
    }
  }
  fs.writeFileSync(path.join(OUT, `${tag}-shots.json`), JSON.stringify(out, null, 1));
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();
  if (mode === 'flow') await runFlow();
  else if (mode === 'layout') await runLayout();
  else if (mode === 'shots') await runShots();
  else if (mode === 'sequence') await runSequence();
  else throw new Error('unknown mode: ' + mode);
  console.log(`[${mode}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}/${tag}-${mode}.json`);
}

main().catch((e) => { console.error('FAILED', e && e.message); process.exit(1); });
