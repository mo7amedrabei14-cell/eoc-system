// Screenshot driver for login redesign work (dev-only scratch tool).
// Launches the cached headless chromium shell, drives it over CDP, saves PNGs.
// Usage: node _shot.mjs <url> <outPng> [waitMs] [evalJs] [evalWaitMs]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from './node_modules/ws/index.js';

const CHROME = 'C:/Users/mo7am/AppData/Local/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe';
const [url, out, waitMs = '2500', evalJs = '', evalWaitMs = '800', dragSelector = ''] = process.argv.slice(2);
const PORT = 9223;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJSON(method, u) {
  const res = await fetch(u, { method });
  return res.json();
}

async function main() {
  const profile = path.join(process.cwd(), '_shot_profile');
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1920,1080',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    // wait for devtools endpoint
    let targets = null;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try {
        targets = await httpJSON('GET', `http://127.0.0.1:${PORT}/json/list`);
        if (targets && targets.length) break;
      } catch { /* not up yet */ }
    }
    if (!targets || !targets.length) throw new Error('chrome devtools endpoint never came up');
    const page = targets.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    let id = 0;
    const pending = new Map();
    const events = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      else if (msg.method) events.push(msg);
    });
    const rpc = (method, params = {}) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

    await rpc('Page.enable');
    await rpc('Runtime.enable');
    await rpc('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await rpc('Page.navigate', { url });
    await sleep(Number(waitMs));

    if (evalJs) {
      await rpc('Runtime.evaluate', { expression: evalJs, awaitPromise: true, returnByValue: true });
      await sleep(Number(evalWaitMs));
    }

    if (dragSelector) {
      const rectRes = await rpc('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(dragSelector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
        returnByValue: true,
      });
      const r = rectRes.result?.result?.value;
      if (!r) throw new Error(`drag selector not found: ${dragSelector}`);
      const y = r.y + r.h / 2;
      const fromX = r.x + 40;
      const toX = r.x + r.w - 40;
      await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX, y });
      await rpc('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y, button: 'left', clickCount: 1 });
      const steps = 14;
      for (let i = 1; i <= steps; i++) {
        await rpc('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX + ((toX - fromX) * i) / steps, y, button: 'left' });
        await sleep(28);
      }
      await rpc('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y, button: 'left', clickCount: 1 });
      await sleep(Number(evalWaitMs));
    }

    const shot = await rpc('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown');
    for (const e of errors.slice(0, 5)) {
      console.log('PAGE ERROR:', JSON.stringify(e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text).slice(0, 400));
    }
    const consoleErrs = events.filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
    for (const e of consoleErrs.slice(0, 5)) {
      console.log('CONSOLE ERROR:', JSON.stringify(e.params.args?.map((a) => a.value ?? a.description)).slice(0, 400));
    }
    console.log('SAVED', out);
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
