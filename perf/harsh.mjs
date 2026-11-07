import { chromium } from 'playwright';
const [,, url, storageState] = process.argv;
const b = await chromium.launch();
const context = await b.newContext(storageState ? { storageState } : {});
const p = await context.newPage();
const targetOrigin = new URL(url).origin;
await p.route('**/*', route => {
  const requestUrl = route.request().url();
  if (/^https?:/.test(requestUrl) && new URL(requestUrl).origin !== targetOrigin) return route.abort();
  return route.continue();
});
const c = await context.newCDPSession(p);
await c.send('Network.enable');
await c.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 25 * 1024 });
await c.send('Emulation.setCPUThrottlingRate', { rate: 6 });
const t0 = Date.now();
// Wait for the real login UI so slow in-flight app chunks cannot be omitted.
await p.goto(url, { waitUntil: 'load', timeout: 120000 });
await p.locator('.lx-lamp-cord').waitFor({ state: 'visible', timeout: 120000 });
await p.waitForLoadState('networkidle', { timeout: 120000 });
const m = await p.evaluate(() => new Promise(r => {
  let lcp = 0;
  new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  setTimeout(() => {
    const res = performance.getEntriesByType('resource');
    r({ lcp, requests: res.length, transferKB: Math.round(res.reduce((s, x) => s + x.transferSize, 0) / 1024) });
  }, 3000);
}));
console.log(JSON.stringify({ url, loadMs: Date.now() - t0, ...m }));
await b.close();
