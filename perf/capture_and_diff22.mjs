import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch();
const errors = {};

async function capture(name, url) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const targetOrigin = new URL(url).origin;
  errors[name] = [];
  page.on('pageerror', error => errors[name].push(error.message));
  await page.route('**/*', route => {
    const requestUrl = route.request().url();
    if (/^https?:/.test(requestUrl) && new URL(requestUrl).origin !== targetOrigin) return route.abort();
    return route.continue();
  });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const lamp = page.locator('.lx-lamp-cord');
  await lamp.waitFor({ state: 'visible', timeout: 120000 });
  await lamp.focus();
  await page.keyboard.press('Enter');
  await page.locator('form').waitFor({ state: 'visible', timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `perf/login22_${name}_matched.png` });
  await context.close();
}

await capture('before', 'http://localhost:4174/');
await capture('after', 'http://localhost:4173/');

const before = fs.readFileSync('perf/login22_before_matched.png').toString('base64');
const after = fs.readFileSync('perf/login22_after_matched.png').toString('base64');
const page = await browser.newPage();
const result = await page.evaluate(async ({ before, after }) => {
  const load = base64 => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `data:image/png;base64,${base64}`;
  });
  const [a, b] = await Promise.all([load(before), load(after)]);
  if (a.width !== b.width || a.height !== b.height) throw new Error('Screenshot dimensions differ');
  const canvasA = document.createElement('canvas');
  const canvasB = document.createElement('canvas');
  const diffCanvas = document.createElement('canvas');
  for (const canvas of [canvasA, canvasB, diffCanvas]) {
    canvas.width = a.width;
    canvas.height = a.height;
  }
  const contextA = canvasA.getContext('2d');
  const contextB = canvasB.getContext('2d');
  contextA.drawImage(a, 0, 0);
  contextB.drawImage(b, 0, 0);
  const pixelsA = contextA.getImageData(0, 0, a.width, a.height).data;
  const pixelsB = contextB.getImageData(0, 0, a.width, a.height).data;
  const diffContext = diffCanvas.getContext('2d');
  const diff = diffContext.createImageData(a.width, a.height);
  let changedPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  for (let i = 0; i < pixelsA.length; i += 4) {
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(pixelsA[i + channel] - pixelsB[i + channel]);
      if (delta) changed = true;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      totalChannelDelta += delta;
      diff.data[i + channel] = delta;
      if (channel === 3) diff.data[i + channel] = 255;
    }
    if (changed) changedPixels += 1;
  }
  diffContext.putImageData(diff, 0, 0);
  return {
    width: a.width,
    height: a.height,
    totalPixels: a.width * a.height,
    changedPixels,
    changedPercent: changedPixels / (a.width * a.height) * 100,
    maxChannelDelta,
    meanChannelDelta: totalChannelDelta / (a.width * a.height * 4),
    diffPng: diffCanvas.toDataURL('image/png').split(',')[1],
  };
}, { before, after });

fs.writeFileSync('perf/login22_diff_matched.png', Buffer.from(result.diffPng, 'base64'));
delete result.diffPng;
result.pageErrors = errors;
fs.writeFileSync('perf/login22_diff_matched.json', JSON.stringify(result, null, 2));
await browser.close();
console.log(JSON.stringify(result, null, 2));
