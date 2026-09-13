// CDP driver v3: open the app, log in via injected localStorage (token+user),
// navigate to the missions table, click the eye icon on mission 331,
// and report render-crash symptoms + console errors.
import WebSocket from './frontend/node_modules/ws/index.js';
import fs from 'node:fs';

const CDP_PORT = 9222;
const APP = 'http://localhost:5173/dashboard';
const MISSION_NAME = 'استمارة مهمة تأمين - مول سيتي ستارز';
const SIDEBAR = 'سجل المهام الميدانية';

const seed = JSON.parse(fs.readFileSync('_seed.json', 'utf-8'));
const token = seed.access_token;
const userJSON = JSON.stringify(seed.user);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function httpJSON(method, url) {
  const res = await fetch(url, { method });
  return res.json();
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function makeRPC(ws) {
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { send, events };
}
function exceptions(events) {
  return events.filter(m =>
    m.method === 'Runtime.exceptionThrown' ||
    (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') ||
    (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error'));
}
async function evalJS(send, expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EVAL_EXC: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}

async function main() {
  const target = await httpJSON('PUT', `http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(APP)}`);
  const ws = await connect(target.webSocketDebuggerUrl);
  const { send, events } = makeRPC(ws);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // Login seed + hard-navigate to /dashboard
  await sleep(2500);
  await evalJS(send, `localStorage.setItem('access_token', ${JSON.stringify(token)});
    localStorage.setItem('user', ${JSON.stringify(userJSON)});
    location.replace('/dashboard'); 'ok'`);
  await sleep(4000);

  // Click the missions sidebar item so the table renders
  const sideInfo = await evalJS(send, `(() => {
    const out = [];
    document.querySelectorAll('button, a').forEach(el => {
      const t = (el.innerText || '').trim().replace(/\\s+/g, ' ');
      if (t && t.length < 60) out.push(el.tagName + '|' + el.className.toString().slice(0,40) + '|' + t);
    });
    return out.slice(0, 80).join('\\n');
  })()`);
  console.log('NAV ITEMS:\n' + sideInfo);

  const clickedSidebar = await evalJS(send, `(() => {
    const els = [...document.querySelectorAll('button, a')];
    const el = els.find(e => (e.innerText || '').trim().replace(/\\s+/g,' ') === ${JSON.stringify(SIDEBAR)});
    if (!el) return 'no sidebar item';
    el.click();
    return 'clicked ' + el.tagName + ' ' + el.className;
  })()`);
  console.log('SIDEBAR:', clickedSidebar);
  await sleep(2500);

  // Clear the date filter so ALL missions become visible (mission 331 created 09-12)
  const clearedDate = await evalJS(send, `(() => {
    const btns = [...document.querySelectorAll('button')];
    const el = btns.find(b => (b.innerText || '').trim() === 'إلغاء التاريخ');
    if (!el) return 'no clear-date btn';
    el.click();
    return 'cleared';
  })()`);
  console.log('CLEAR DATE:', clearedDate);
  await sleep(2000);

  // Poll for the mission list
  let hasCells = 0;
  let found331 = false;
  for (let i = 0; i < 12; i++) {
    hasCells = Number(await evalJS(send, `document.querySelectorAll('.mission-name-cell').length`));
    found331 = (await evalJS(send, `[...document.querySelectorAll('.mission-name-cell')].some(el =>
      (el.title || el.textContent || '').trim() === ${JSON.stringify(MISSION_NAME)})`)) === true;
    if (hasCells > 0 && found331) break;
    await sleep(1000);
  }
  console.log('MISSION CELLS:', hasCells, '| FOUND 331:', found331);
  if (hasCells === 0 || !found331) {
    const content = await evalJS(send, `document.body.innerText.replace(/\\n{2,}/g,'\\n').split('\\n')
      .filter(l => l.trim()).slice(-40).join('\\n')`);
    console.log('CONTENT TAIL:\n' + content);
  }

  // Click the eye icon on mission 331
  // Install window error recorder
  await evalJS(send, `window.__errs = []; window.__errsPushed = false;
    if (!window.__errsPushed) { window.__errsPushed = true;
      window.addEventListener('error', e => window.__errs.push('ERR: ' + (e.message || '') + ' @ ' + (e.filename||'') + ':' + (e.lineno||'')));
      window.addEventListener('unhandledrejection', e => window.__errs.push('REJ: ' + String(e.reason))); }`);

  const click = await evalJS(send, `(() => {
    const cells = [...document.querySelectorAll('.mission-name-cell')];
    const cell = cells.find(el => (el.title || el.textContent || '').trim() === ${JSON.stringify(MISSION_NAME)});
    if (!cell) { return JSON.stringify({found:false, titles: cells.slice(0,15).map(c => (c.title||c.textContent||'').trim())}); }
    const tr = cell.closest('tr');
    const eye = tr.querySelector('.icon-btn[title="فتح المهمة"]') || tr.querySelector('button.icon-btn[title="فتح المهمة"]');
    if (!eye) return JSON.stringify({found:true, noEye:true});
    const before = document.getElementById('root')?.innerHTML?.length || 0;
    eye.click();
    return JSON.stringify({found:true, clicked:true, beforeRootLen: before});
  })()`);
  console.log('CLICK:', click);
  await sleep(4500);

  const snap = await evalJS(send, `JSON.stringify({
    rootLen: document.getElementById('root')?.innerHTML?.length||0,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    hasBackdrop: !!document.querySelector('.modal-backdrop'),
    hasModalCard: !!document.querySelector('.modal-card'),
    hasSkeleton: !!document.querySelector('.skeleton'),
    hasErrorCard: (document.body.innerText||'').includes('تعذر فتح الاستمارة'),
    winErrs: window.__errs || [],
    bodyStart: (document.body?.innerText||'').slice(0,220),
  })`);
  console.log('SNAP:', snap);

  // Screenshot for visual confirmation
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync('_repro.png', Buffer.from(shot.data, 'base64'));
      console.log('SCREENSHOT saved _repro.png');
    }
  } catch (e) { console.log('shot failed:', e.message); }

  const errs = exceptions(events);
  console.log('EVENTS (' + errs.length + '):');
  for (const e of errs.slice(-40)) {
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      const desc = d.exception?.description || d.text || '';
      console.log(' EXC:', desc.split('\n').slice(0, 6).join(' | ').slice(0, 700));
    } else if (e.method === 'Runtime.consoleAPICalled') {
      console.log(' CERR:', e.params.args.map(x => x.value ?? x.description).join(' ').slice(0, 400));
    } else {
      console.log(' LOGERR:', (e.params.entry.text || '').slice(0, 400));
    }
  }
  process.exit(0);
}

main().catch(e => { console.error('DRIVER FAIL:', e); process.exit(1); });