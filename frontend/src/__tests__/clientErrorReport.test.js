/* ─────────────────────────────────────────────────────────────────────────────
   🧪 اختبارات التقاط أخطاء الواجهة + الشاشة البديلة
   ─────────────────────────────────────────────────────────────────────────────
   السبب: التطبيق ظهر لمرة شاشة *بيضا تماماً* لأن خطأ في تحميل وحدة (مرجع قبل
   تعريفه) أوقف كل شيء بلا أي رسالة ولا أثر على السيرفر. الاختبارات دي بتثبّت
   القواعد اللي تمنع تكرارها:

     1) أي خطأ ⇒ بلاغ واحد للسيرفر (بلا تكرار في نفس الجلسة).
     2) لا شاشة بيضا: لو التطبيق *لم* يركّب ⇒ شاشة بديلة واضحة فيها إعادة تحميل.
     3) لا نغطي على تطبيق شغّال (لو اتركّب، ما نعرضش شاشة فوقه).
     4) الإبلاغ لا يرمي استثناءً أبداً (عطل الشبكة لا يزوّد العطل).
     5) ⚠️ أمن: رسالة الخطأ تُعرض كنص (textContent) لا HTML — الرسالة نص غير
        موثوق (قد تحمل مدخلات مستخدم)، وany innerHTML = ثغرة XSS.
     6) الرابط المُخزَّن بلا باراميترات (قد تحمل توكن/بيانات).

   التشغيل: cd frontend && npm test
   ───────────────────────────────────────────────────────────────────────────── */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIENT_ERRORS_API,
  FATAL_SCREEN_ID,
  MOUNT_FLAG,
  sanitizeUrl,
  reportClientError,
  showFatalScreen,
  installClientErrorReporting,
  startMountWatchdog,
  markAppMounted,
  __resetClientErrorState,
} from '../clientErrorReport.js';

/* ── DOM وهمي بسيط: createElement + appendChild + getElementById + style ── */
function makeFakeDom() {
  const byId = new Map();
  const makeEl = (tag) => {
    const el = {
      tagName: tag,
      style: {},
      children: [],
      childNodes: [],
      attributes: {},
      listeners: {},
      textContent: '',
      type: '',
      id: '',
      parentNode: null,
      appendChild(child) {
        this.children.push(child);
        this.childNodes.push(child);
        child.parentNode = this;
        if (child.id) byId.set(child.id, child);
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter((c) => c !== child);
        this.childNodes = this.childNodes.filter((c) => c !== child);
        if (child.id) byId.delete(child.id);
        child.parentNode = null;
        return child;
      },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      /** متعمّد: لو استُخدم innerHTML في الكود الأصلي يظهر هنا ونفشل الاختبار */
      set innerHTML(v) { this._innerHTML = v; },
      get innerHTML() { return this._innerHTML; },
    };
    return el;
  };
  const body = makeEl('body');
  return {
    _makeEl: makeEl,
    _byId: byId,
    body,
    documentElement: makeEl('html'),
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) || null,
  };
}

function makeFakeWindow() {
  const listeners = {};
  return {
    listeners,
    location: { href: 'http://localhost:5174/dashboard', reloaded: 0, reload() { this.reloaded += 1; } },
    navigator: { userAgent: 'node-test', clipboard: { written: [], writeText(t) { this.written.push(t); return Promise.resolve(); } } },
    sessionStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); } },
    localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); } },
    addEventListener(type, fn) { listeners[type] = fn; },
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); return id; },
    clearTimeout: (id) => clearTimeout(id),
  };
}

let dom;
let win;
let calls;

const installFakes = ({ withDom = true } = {}) => {
  dom = makeFakeDom();
  win = makeFakeWindow();
  calls = [];
  globalThis.window = win;
  if (withDom) globalThis.document = dom; else delete globalThis.document;
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve({ ok: true, status: 200 });
  };
};

beforeEach(() => {
  __resetClientErrorState();
  installFakes();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/* ───────────────────────── 1) الرابط بلا باراميترات ───────────────────────── */

test('🔒 sanitizeUrl يحذف الباراميترات والهاش (قد تحمل توكن/بيانات)', () => {
  assert.equal(sanitizeUrl('http://localhost:5174/dashboard?access_token=SECRET#x'), 'http://localhost:5174/dashboard');
  assert.equal(sanitizeUrl('https://eoc.example.com/api/missions?ids=1,2,3'), 'https://eoc.example.com/api/missions');
  assert.equal(sanitizeUrl(''), '');
});

test('الرابط الطويل يُقصّ ولا يُرسل كما هو', () => {
  const long = 'https://x.example.com/' + 'a'.repeat(600);
  assert.ok(sanitizeUrl(long).length <= 301);
});

/* ───────────────────────── 2) الإبلاغ للسيرفر ───────────────────────── */

test('بلاغ الخطأ يوصل للمسار الصحيح بنوع JSON وkeepalive', async () => {
  const ok = await reportClientError({ kind: 'module', message: 'boom', stack: 'at x (a.js:1:1)', url: 'http://localhost:5174/dashboard?token=SECRET' });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CLIENT_ERRORS_API);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.keepalive, true);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.kind, 'module');
  assert.equal(body.message, 'boom');
  assert.equal(body.url, 'http://localhost:5174/dashboard');       // بلا باراميترات
  assert.equal(body.user_agent, 'node-test');
  assert.ok(!('token' in body), 'لا يجب إرسال أي توكن داخل الجسم');
});

test('التوكن يُرسل في الترويسة فقط (ربط البلاغ بالحساب) ولا يُخزَّن في الجسم', async () => {
  win.sessionStorage.setItem('access_token', 'TEST_TOKEN_VALUE');
  await reportClientError({ kind: 'error', message: 'with token' });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer TEST_TOKEN_VALUE');
  assert.ok(!JSON.parse(calls[0].options.body).token, 'التوكن لا يُكتب داخل الجسم');

  __resetClientErrorState();
  win.sessionStorage.getItem = () => null;
  win.localStorage.getItem = () => null;
  await reportClientError({ kind: 'error', message: 'no token' });
  assert.equal(calls[1].options.headers.Authorization, undefined, 'بلا جلسة: بلاغ بلا مصادقة (مقبول عمداً)');
});

test('نفس الخطأ لا يُبلَّغ مرتين في نفس الجلسة (وforce يتجاوز الحماية)', async () => {
  await reportClientError({ kind: 'error', message: 'same', stack: 'at x' });
  await reportClientError({ kind: 'error', message: 'same', stack: 'at x' });
  assert.equal(calls.length, 1);
  await reportClientError({ kind: 'error', message: 'same', stack: 'at x', force: true });
  assert.equal(calls.length, 2);
});

test('🛡️ فشل الشبكة لا يرمي استثناءً ولا يوقف التطبيق', async () => {
  globalThis.fetch = () => { throw new Error('network down'); };
  assert.equal(await reportClientError({ kind: 'error', message: 'still safe' }), false);
  delete globalThis.fetch;
  assert.equal(await reportClientError({ kind: 'error', message: 'no fetch at all' }), false);
});

test('رسالة الرسالة والأثر يُقصّان قبل الإرسال', async () => {
  await reportClientError({ kind: 'error', message: 'م'.repeat(900), stack: 's'.repeat(9000) });
  const body = JSON.parse(calls[0].options.body);
  assert.ok(body.message.length <= 501);
  assert.ok(body.stack.length <= 4001);
});

/* ───────────────────────── 3) الشاشة البديلة ───────────────────────── */

const fatal = () => dom.getElementById(FATAL_SCREEN_ID);

/** يجمع كل عناصر الشجرة بترتيب العرض (الشاشة البديلة شجرة متشعّبة: صف أزرار داخل البطاقة) */
const collectTags = (node, tag) => {
  const out = [];
  const walk = (n) => {
    if (!n || !n.children) return;
    for (const child of n.children) {
      if (child.tagName === tag) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
};

test('لا شاشة بيضا: تظهر شاشة بديلة واضحة فيها زر إعادة التحميل', () => {
  assert.equal(showFatalScreen({ kind: 'module', title: 'تعذّر تحميل الواجهة', message: 'سبب واضح', detail: 'at Dashboard.jsx:1:1', report: false }), true);
  assert.ok(fatal(), 'الشاشة البديلة يجب أن تكون معروضة');
  const texts = fatal().children[0].children.map((c) => c.textContent).join(' | ');
  assert.match(texts, /تعذّر تحميل الواجهة/);
  assert.match(texts, /سبب واضح/);
  const buttons = collectTags(fatal(), 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['إعادة التحميل', 'نسخ التفاصيل']);
});

test('الشاشة البديلة idempotent (نسخة واحدة فقط مهما تكرر الخطأ)', () => {
  showFatalScreen({ message: 'أول', report: false });
  showFatalScreen({ message: 'ثاني', report: false });
  const overlays = dom.body.children.filter((c) => c.id === FATAL_SCREEN_ID);
  assert.equal(overlays.length, 1);
});

test('🔐 رسالة الخطأ تُعرض كنص لا HTML (منع XSS من نص غير موثوق)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  showFatalScreen({ message: 'خطأ', detail: evil, report: false });
  const pre = collectTags(fatal(), 'pre')[0];
  assert.equal(pre.textContent, evil);
  assert.equal(pre.innerHTML, undefined, 'ممنوع استخدام innerHTML في الشاشة البديلة');
});

test('زر إعادة التحميل يعيد تحميل الصفحة فعلاً', () => {
  showFatalScreen({ message: 'خطأ', report: false });
  const reloadBtn = collectTags(fatal(), 'button')[0];
  reloadBtn.listeners.click();
  assert.equal(win.location.reloaded, 1);
});

test('الشاشة البديلة تُبلّغ السيرفر تلقائياً (report الافتراضي)', async () => {
  showFatalScreen({ kind: 'module', message: 'انهيار تحميل' });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).message, 'انهيار تحميل');
});

test('بلا document لا شيء يرمي استثناءً (بيئة بلا DOM)', () => {
  installFakes({ withDom: false });
  assert.equal(showFatalScreen({ message: 'x' }), false);
});

/* ───────────────────────── 4) المستمعون العامّون ───────────────────────── */

test('التثبيت idempotent ويُسجّل مستمعَي error وunhandledrejection', () => {
  assert.equal(installClientErrorReporting(), true);
  assert.equal(installClientErrorReporting(), true);
  assert.equal(typeof win.listeners.error, 'function');
  assert.equal(typeof win.listeners.unhandledrejection, 'function');
});

test('خطأ تحميل وحدة قبل تركيب التطبيق ⇒ بلاغ + شاشة بديلة', async () => {
  installClientErrorReporting();
  win.listeners.error({ error: new Error("Cannot access 'W_REGION_NAME_MAP' before initialization"), message: 'x', filename: 'Dashboard.jsx', lineno: 7772 });
  await flush();
  assert.equal(calls.length, 1);
  assert.match(JSON.parse(calls[0].options.body).message, /W_REGION_NAME_MAP/);
  assert.ok(fatal(), 'يجب أن تظهر الشاشة البديلة بدل الشاشة البيضا');
});

test('بعد تركيب التطبيق: يُبلَّغ عن الخطأ ولا نغطّي الشاشة (تطبيق شغّال)', async () => {
  installClientErrorReporting();
  markAppMounted();
  win.listeners.error({ error: new Error('async boom') });
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(fatal(), null, 'لا نعرض شاشة فوق تطبيق شغّال');
  assert.equal(win[MOUNT_FLAG], true);
});

test('وعد مرفوض يُبلَّغ عنه أيضاً', async () => {
  installClientErrorReporting();
  win.listeners.unhandledrejection({ reason: new Error('promise failed') });
  await flush();
  assert.equal(JSON.parse(calls[0].options.body).kind, 'unhandledrejection');
});

/* ───────────────────────── 5) حرس «لم يبدأ التطبيق» ───────────────────────── */

test('لو #root فضل فاضي والتطبيق لم يركّب ⇒ شاشة بديلة', async () => {
  const root = dom._makeEl('div');
  root.id = 'root';
  dom.body.appendChild(root);
  startMountWatchdog({ ms: 5 });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(fatal(), 'الشاشة البديلة تحمي من الصفحة الفاضية بلا أي خطأ');
});

test('لو في رسم فعلي داخل #root لا نعرض شيئاً (تجنّب الإنذار الكاذب)', async () => {
  const root = dom._makeEl('div');
  root.id = 'root';
  root.appendChild(dom._makeEl('section'));
  dom.body.appendChild(root);
  startMountWatchdog({ ms: 5 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fatal(), null);
});

test('لو التطبيق اتركّب، الحرس لا يعرض شيئاً حتى لو #root فاضي', async () => {
  const root = dom._makeEl('div');
  root.id = 'root';
  dom.body.appendChild(root);
  markAppMounted();
  startMountWatchdog({ ms: 5 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fatal(), null);
});
