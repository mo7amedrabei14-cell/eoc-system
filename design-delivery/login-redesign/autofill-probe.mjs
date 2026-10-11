// ═══════════════════════════════════════════════════════════════════════════
// 🧪 مسبار autofill — ما يمكن إثباته وما لا يمكن في هذه البيئة
// ---------------------------------------------------------------------------
// الطلب كان: «الـ autofill في Chrome وSafari لا يكسر الألوان». وهذا الملف يقيس
// الحدّ الممكن بلا كذب:
//
//   (١) هل يمكن تحفيز حالة autofill نفسها؟ يُجرَّب خمسة أسماء للحالة عبر
//       `CSS.forcePseudoState` في Chromium headless — النتيجة المُسجَّلة: لا تأثير.
//   (٢) إذن ما الذي يفعله المُعلن المُسلَّم فعلًا؟ يُقرأ نصّ القاعدة **من CSSOM**
//       (لا إعادة صياغة)، ويُستبدل اسم حالة autofill بصفّ تجريبي وحده، ثم يُقاس
//       ما يُرسم على الحقل الحقيقي في الوضعين: لون التعبئة الداخلية مقابل السطح
//       المرئي خلف الحقل، ولون النص مقابل توكن الحبر ⇒ لا أصفر ولا أزرق بالتعريف.
//
// التشغيل: node design-delivery/login-redesign/autofill-probe.mjs [url]
// (يحتاج سيرفر التطوير على :5174، وChromium المخزّن عبر Playwright، و`ws` في node_modules)
// ═══════════════════════════════════════════════════════════════════════════
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from '../../node_modules/ws/index.js';

const CHROME = 'C:/Users/mo7am/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const PORT = 9341;
const URL_ = process.argv[2] || 'http://localhost:5174/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = path.join(process.cwd(), '_af_profile');
fs.rmSync(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });

let ws; let id = 0; const pending = new Map();
const rpc = (method, params = {}) => new Promise((res, rej) => {
  const mid = ++id;
  pending.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id: mid, method, params }));
});
const EVAL = (expression) => rpc('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result.value);

const READ = `(() => { const el = document.querySelector('#lx-username'); if (!el) return null;
  const cs = getComputedStyle(el);
  return { autofill: el.matches(':-webkit-autofill'), internal: el.matches(':-internal-autofill-selected'),
    textFill: cs.getPropertyValue('-webkit-text-fill-color').trim(), boxShadow: cs.boxShadow, caret: cs.caretColor }; })()`;

async function main() {
  let targets = null;
  for (let i = 0; i < 60; i++) { await sleep(250); try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) break; } catch { /* not up yet */ } }
  if (!targets?.length) throw new Error('devtools endpoint never came up');
  ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const cb = pending.get(m.id); pending.delete(m.id); cb(m); } });
  await rpc('Page.enable'); await rpc('Runtime.enable'); await rpc('DOM.enable'); await rpc('CSS.enable');
  await rpc('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await rpc('Page.navigate', { url: URL_ });
  await sleep(3500);

  /* ── (١) هل يمكن تحفيز الحالة؟ ─────────────────────────────────────────── */
  const doc = await rpc('DOM.getDocument', { depth: -1 });
  const node = await rpc('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#lx-username' });
  console.log('(1) forcing the autofill state — node', node.nodeId || 'NOT FOUND');
  const base = await EVAL(READ);
  const candidates = [':-webkit-autofill', '-webkit-autofill', ':-internal-autofill-selected', '-internal-autofill-selected', ':autofill'];
  const forced = [];
  for (const cand of candidates) {
    let err = null;
    try { await rpc('CSS.forcePseudoState', { nodeId: node.nodeId, forcedPseudoClasses: [cand] }); } catch (e) { err = e.message.slice(0, 70); }
    const now = await EVAL(READ);
    const applied = !err && now && (now.autofill || now.internal || now.boxShadow !== base.boxShadow);
    forced.push({ candidate: cand, applied, error: err });
    console.log(`    ${cand.padEnd(30)} ${err ? 'CDP error: ' + err : applied ? 'APPLIED' : 'no effect'}`);
    await rpc('CSS.forcePseudoState', { nodeId: node.nodeId, forcedPseudoClasses: [] });
  }

  /* ── (٢) ماذا يُرسم من المُعلن المُسلَّم فعلًا؟ ──────────────────────────── */
  for (const theme of ['dark', 'light']) {
    const out = await EVAL(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      const el = document.querySelector('#lx-username');
      let ruleText = null, decls = null;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules) {
          if (r.selectorText && r.selectorText.includes('autofill') && r.selectorText.includes('lx-input')) { ruleText = r.selectorText; decls = r.style.cssText; break; }
        }
        if (ruleText) break;
      }
      const probeSel = ruleText.split(',')
        .map((s) => s.trim().replace(/:hover$|:focus$/, '').replace(/:-webkit-autofill$/, '.lx-afprobe')).join(', ');
      const probe = document.createElement('style');
      probe.textContent = probeSel + ' { ' + decls + ' }';
      document.head.appendChild(probe);
      const g = (e) => { const cs = getComputedStyle(e); return { textFill: cs.getPropertyValue('-webkit-text-fill-color').trim(), boxShadow: cs.boxShadow }; };
      const before = g(el);
      el.classList.add('lx-afprobe');
      const after = g(el);
      el.classList.remove('lx-afprobe');
      probe.remove();
      let surfaceEl = el, surface = 'rgba(0, 0, 0, 0)', surfaceSel = null;
      while (surfaceEl && surfaceEl !== document.documentElement && surface === 'rgba(0, 0, 0, 0)') {
        surfaceEl = surfaceEl.parentElement; if (!surfaceEl) break;
        surface = getComputedStyle(surfaceEl).backgroundColor; surfaceSel = surfaceEl.className || surfaceEl.tagName;
      }
      const cs = getComputedStyle(el);
      return { theme: document.documentElement.dataset.theme, ruleText, decls, probeSel, before, after,
        surface, surfaceSel, ink: cs.getPropertyValue('--lx-ink').trim(), field: cs.getPropertyValue('--lx-field').trim(), text: cs.color };
    })()`);
    const fill = (out.after.boxShadow.match(/rgb[a]?\([^)]+\)/) || [null])[0];
    const same = (a, b) => !!a && !!b && a.replace(/\s/g, '') === b.replace(/\s/g, '');
    console.log(`\n(2) ${theme} theme`);
    console.log('    shipped selector :', out.ruleText);
    console.log('    declarations     :', out.decls);
    console.log('    surface behind the field :', out.surface, `(${out.surfaceSel})  vs --lx-field ${out.field}`);
    console.log('    ink text colour          :', out.text, `vs --lx-ink ${out.ink}`);
    console.log('    rule applied -> fill', fill, '· text', out.after.textFill);
    console.log('    ⇒ fill equals the visible surface :', same(fill, out.surface));
    console.log('    ⇒ text equals the ink colour      :', same(out.after.textFill, out.text));
  }
  console.log('\nحكم: الحالة نفسها غير قابلة للتحفيز هنا؛ ومُعلن القاعدة المُسلَّم يرسم',
    'تعبئة = السطح المرئي ونصًّا = الحبر في الوضعين (لا أصفر ولا أزرق).');
  if (forced.some((f) => f.applied)) console.log('⚠️ ملاحظة: تحفيز الحالة نجح فعلًا في هذه البيئة — أعِد النظر في الحكم أعلاه.');
}

main().catch((e) => { console.error('PROBE FAILED:', e.message); process.exitCode = 1; }).finally(async () => {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill('SIGKILL');
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* locked by chrome */ }
});
