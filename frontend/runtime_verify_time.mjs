// Runtime verification: premium Time Picker (TimeInput) in Dashboard.jsx
// Serves the built `dist`, fakes every /api/* request, drives local Chrome headless.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const DIST = decodeURIComponent(new URL('./dist', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const PORT = 5173;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.startsWith('/api/')) { res.writeHead(404); res.end('{}'); return; }
  if (p === '/') p = '/index.html';
  const file = normalize(join(DIST, p));
  if (p.startsWith('/assets/') && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } else {
    const idx = join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(existsSync(idx) ? readFileSync(idx) : 'index missing');
  }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

// ---- Canned API data ----
const MISSION = {
  mission_id: 1, mission_code: '#T-100', mission_name: 'مهمة اختبار', mission_classification: 'عادية',
  status: 'Active', branch: 'القاهرة', exit_date: '2026-09-08', departure_time: '09:00', arrival_time: null,
  completion_time: null, created_at: '2026-09-08 08:00:00'
};
function apiPayload(url) {
  if (url.includes('/api/missions')) return JSON.stringify([MISSION]);
  if (url.includes('/api/branches/locations')) return JSON.stringify([]);
  if (url.includes('/api/dashboard/stats')) return JSON.stringify({});
  if (url.includes('/api/local-news')) return JSON.stringify([]);
  if (url.includes('/api/global-disasters')) return JSON.stringify([]);
  if (url.includes('/api/earthquakes/global')) return JSON.stringify([]);
  if (url.includes('/api/earthquakes/egypt')) return JSON.stringify([]);
  if (url.includes('/api/volunteers/all')) return JSON.stringify([]);
  if (url.includes('/api/human-resources')) return JSON.stringify([]);
  if (url.includes('/api/realtime/events')) return JSON.stringify({ events: [] });
  if (url.includes('/api/ai-news')) return JSON.stringify([]);
  if (url.includes('/api/audit-logs')) return JSON.stringify([]);
  return JSON.stringify({ detail: 'not-found' });
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,900', '--force-device-scale-factor=1']
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let apiHits = 0;
await page.setRequestInterception(true);
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/api/')) {
    apiHits++;
    const isOpt = req.method() === 'OPTIONS';
    req.respond({
      status: isOpt ? 204 : 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type,Idempotency-Key'
      },
      body: isOpt ? '' : apiPayload(u)
    });
  } else { req.continue(); }
});

const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

let PASS = 0, FAIL = 0;
const check = (name, cond, extra = '') => {
  if (cond) { PASS++; console.log(`  ✔ ${name}`); }
  else { FAIL++; console.log(`  ✘ ${name}  ${extra}`); }
};

try {
  // 1) boot app, plant localStorage, land on /dashboard
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('access_token', 'fake-token');
    localStorage.setItem('user', JSON.stringify({ role: 'OWNER', is_global_admin: true, full_name: 'مختبر', username: 'tester', branch: 'القاهرة' }));
  });
  await page.goto(`http://127.0.0.1:${PORT}/dashboard`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3500));

  const bootLen = await page.evaluate(() => (document.body.innerText || '').length);
  check('dashboard rendered non-blank', bootLen > 200, `len=${bootLen}`);
  check('api requests intercepted', apiHits > 0, `hits=${apiHits}`);
  if (bootLen <= 200 || apiHits === 0) {
    console.log('  [debug] pageerrors:', JSON.stringify(pageErrors));
    console.log('  [debug] console errors:', JSON.stringify(consoleErrors.slice(0, 5)));
    const dbg = await page.evaluate(() => ({
      path: location.pathname,
      rootHTML: (document.getElementById('root') || {}).innerHTML ? document.getElementById('root').innerHTML.slice(0, 300) : '(no root)',
      bodyHTML: (document.body.innerHTML || '').slice(0, 300),
      scripts: [...document.scripts].map(s => s.src),
      token: localStorage.getItem('access_token'),
      user: localStorage.getItem('user')
    }));
    console.log('  [debug] page state:', JSON.stringify(dbg, null, 1));
    throw new Error('boot check failed — see debug above');
  }

  // 2) open the missions screen
  const navClicked = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, a, div')];
    const el = nodes.find(n => (n.textContent || '').includes('المهام الميدانية') && n.textContent.trim().length < 40);
    if (el) { el.click(); return true; } return false;
  });
  check('missions nav found & clicked', navClicked);
  await new Promise(r => setTimeout(r, 1200));

  // 3) open the "إنشاء مهمة" modal
  const createClicked = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button')];
    const el = nodes.find(n => (n.textContent || '').trim().includes('إنشاء مهمة'));
    if (el) { el.click(); return true; } return false;
  });
  check('create-mission button clicked', createClicked);
  await new Promise(r => setTimeout(r, 1500));

  // 4) time fields present (3 visible HH:MM inputs + hidden id-bearing inputs)
  const timeFields = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('input[placeholder="HH:MM"]')].map(i => ({
      type: i.type, val: i.value, id: i.id || '', rect: i.getBoundingClientRect()
    }));
    const hidden = ['f_departure_time', 'f_arrival_time', 'f_completion_time'].map(id => {
      const el = document.getElementById(id);
      return { id, found: !!el, type: el ? el.type : '', value: el ? el.value : '' };
    });
    return { visible, hidden };
  });
  check('3 visible HH:MM time fields in mission form', timeFields.visible.length === 3, `got ${timeFields.visible.length}`);
  check('hidden inputs carry the ids + native value contract', timeFields.hidden.every(h => h.found && h.type === 'time'), JSON.stringify(timeFields.hidden));

  // 5) click the departure time field → premium picker opens
  const opened = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input[placeholder="HH:MM"]')][0];
    inp.focus();
    inp.click();
    return true;
  });
  await new Promise(r => setTimeout(r, 700));
  const popupInfo = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'تم');
    if (!btn) return null;
    const pop = btn.closest('.border');
    const btns = pop ? [...pop.querySelectorAll('button')] : [];
    const hasHeader = (pop ? pop.textContent : '').includes('الوقت');
    const hourBtns = btns.slice(0, 24).map(b => b.textContent.trim());
    const minBtns = btns.slice(24, 84).map(b => b.textContent.trim());
    return { hasHeader, hoursOK: hourBtns.length === 24 && hourBtns[0] === '00' && hourBtns[23] === '23', minsOK: minBtns.length === 60 && minBtns[0] === '00' && minBtns[59] === '59', rect: pop && pop.getBoundingClientRect() };
  });
  check('clicking time field opens premium picker popup', !!popupInfo && popupInfo.hasHeader, JSON.stringify(popupInfo));
  check('hour wheel = 00..23 and minute wheel = 00..59 (1-min granularity)', !!popupInfo && popupInfo.hoursOK && popupInfo.minsOK, JSON.stringify(popupInfo));

  // 6) pick 14 (hour) then 30 (minutes), each as its own event task (real-user pacing).
  //    Button layout in the popup is deterministic: hours[0..23], minutes[24..83], تم=last.
  const clickBtnAt = (absIdx) => page.evaluate((ai) => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'تم');
    if (!btn) return false;
    const pop = btn.closest('.border');
    const btns = [...pop.querySelectorAll('button')];
    const target = ai >= 0 ? btns[ai] : btns[btns.length - 1];
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, absIdx);
  const clickedHour = await clickBtnAt(14); // hour '14' (hours start at index 0)
  await new Promise(r => setTimeout(r, 350));
  const clickedMin = await clickBtnAt(24 + 30); // minute '30'
  await new Promise(r => setTimeout(r, 350));
  check('hour "14" clicked in hour wheel', clickedHour);
  check('minute "30" clicked in minute wheel', clickedMin);
  const preview = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'تم');
    const pop = btn.closest('.border');
    return (pop.textContent.match(/\d{2}:\d{2}/) || [''])[0];
  });
  check('live clock preview shows 14:30 after wheel picks', preview === '14:30', `preview=${preview}`);
  const okClicked = await clickBtnAt(-1); // «تم» = last button
  await new Promise(r => setTimeout(r, 700));
  const afterPick = await page.evaluate(() => {
    const hiddenVal = document.getElementById('f_departure_time')?.value;
    const visibleVal = [...document.querySelectorAll('input[placeholder="HH:MM"]')][0]?.value;
    return { hiddenVal, visibleVal };
  });
  check('picking 14:30 writes HH:MM to hidden id input', afterPick.hiddenVal === '14:30', `hidden=${afterPick.hiddenVal}`);
  check('visible time field shows 14:30', afterPick.visibleVal === '14:30', `visible=${afterPick.visibleVal}`);

  // 7) picker closed after تم, app still alive (no white screen), no errors
  await new Promise(r => setTimeout(r, 800));
  const finalState = await page.evaluate(() => ({
    len: (document.body.innerText || '').length,
    openBtns: [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'تم').length,
    bodyVisible: getComputedStyle(document.body).display !== 'none'
  }));
  check('picker closed after تم (no lingering popup)', finalState.openBtns === 0, `open=${finalState.openBtns}`);
  check('app still rendered, no white screen', finalState.len > 200 && finalState.bodyVisible, `len=${finalState.len}`);
  check('zero uncaught page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
  check('zero console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));

  // 8) DateInput (merged date+time) left untouched — native calendar field still present
  const datalist = await page.evaluate(() => (document.getElementById('f_exit_date')?.type || ''));
  check('merged date+time DateInput untouched (f_exit_date hidden input intact)', datalist === 'date', `type=${datalist}`);
} catch (err) {
  FAIL++;
  console.log('  ✘ harness crash:', err && err.message ? err.message : err);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n===== RESULT: ${PASS} passed, ${FAIL} failed =====`);
process.exit(FAIL ? 1 : 0);