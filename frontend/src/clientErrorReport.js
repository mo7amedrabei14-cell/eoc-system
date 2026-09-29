/* ─────────────────────────────────────────────────────────────────────────────
   🧯 التقاط أخطاء الواجهة + شاشة بديلة واضحة + إبلاغ السيرفر
   ─────────────────────────────────────────────────────────────────────────────
   الجذر اللي بيحله الملف ده: خطأ وقت *تحميل وحدة* (مثل مرجع قبل تعريفه — TDZ في
   Dashboard.jsx) كان بيوقف تحميل التطبيق كله، والمستخدم يشوف شاشة بيضا تماماً
   بلا أي رسالة ولا أي أثر على السيرفر — فلا المستخدم يعرف يعمل إيه، ولا المالك
   يعرف إن فيه مشكلة أصلاً.

   ثلاث قواعد مثبّتة هنا:
     1) أي خطأ (فشل تحميل وحدة / خطأ غير متزامن / انهيار رسم) ⇒ *يُبلَّغ للسيرفر*
        (POST /api/client-errors) ليبقى الأثر بعد ما المستخدم يقفل الجهاز.
     2) لا شاشة بيضا أبداً: شاشة بديلة واضحة فيها السبب + زر إعادة تحميل + نسخ
        التفاصيل. وتُعرض *فقط* لو التطبيق لم يُركَّب بعد — لو اتركّب، الـ Error
        Boundary هو اللي بيتولى العرض، فلا نغطي على تطبيق شغال.
     3) الملف ده *بلا أي اعتماد* (لا React ولا ملفات التطبيق غير apiBase) لأن
        الحالة اللي بيحمي منها هي بالظبط «فشل تحميل باقي الملفات». ولذلك كل
        الوصول لـ window/document/fetch داخل دوال + typeof، والبناء بـ
        createElement/textContent فقط (لا innerHTML إطلاقاً — رسالة الخطأ نص
        غير موثوق، وقد يحمل اسم ملف/قيمة من المستخدم).

   التشغيل:  node --test src/__tests__/clientErrorReport.test.js
   ───────────────────────────────────────────────────────────────────────────── */

// لاحقة .js مقصودة: الملف بيتحمّل من اختبارات Node (node --test)
import { BASE } from './apiBase.js';

export const CLIENT_ERRORS_API = `${BASE}/api/client-errors`;
export const FATAL_SCREEN_ID = 'eoc-fatal-screen';
export const MOUNT_FLAG = '__EOC_APP_MOUNTED__';

// نفس حدود السيرفر (قصّ على الطرفين حتى لا يُرسل حمولة كبيرة بلا داعٍ)
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_URL = 300;
const MAX_USER_AGENT = 300;
const DEFAULT_WATCHDOG_MS = 20000;

const TRUNCATE_MARK = '…';

const win = () => (typeof window !== 'undefined' ? window : null);
const doc = () => (typeof document !== 'undefined' ? document : null);

const cut = (value, max) => {
  const text = value == null ? '' : String(value);
  return text.length > max ? text.slice(0, max) + TRUNCATE_MARK : text;
};

/** توكن الجلسة إن وُجد — يُقرأ لحظة الاستدعاء، ولا يُخزَّن ولا يُرسل داخل الجسم. */
const sessionToken = () => {
  const w = win();
  if (!w) return '';
  try {
    return (w.sessionStorage && w.sessionStorage.getItem('access_token'))
      || (w.localStorage && w.localStorage.getItem('access_token'))
      || '';
  } catch {
    return '';
  }
};

/**
 * 🔒 يحذف الباراميترات والهاش من الرابط — قد تحمل توكن/بيانات حساسة،
 *    والسجل على السيرفر مقروء للمالك، فلا داعي لتخزينها.
 */
export function sanitizeUrl(raw) {
  if (!raw) return '';
  try {
    const text = String(raw).trim();
    const parsed = new URL(text, 'http://localhost');
    const base = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? parsed.origin : '';
    return cut(base + (parsed.pathname || ''), MAX_URL);
  } catch {
    return cut(String(raw).split('?')[0].split('#')[0], MAX_URL);
  }
}

/** أول سطر من الأثر — أساس «نفس الخطأ» في التجميع على السيرفر. */
const firstStackLine = (stack) => (String(stack || '').trim().split('\n')[0] || '').slice(0, 200);

// منع تكرار نفس الخطأ في نفس الجلسة (خطأ داخل حلقة رسم كان هيولّد آلاف البلاغات)
const seen = new Set();
const seenKey = (kind, message, stack) => `${kind}|${message}|${firstStackLine(stack)}`;

/** هل التطبيق (React) اتركّب فعلاً؟ */
export const isAppMounted = () => Boolean(win() && win()[MOUNT_FLAG]);

/** يُستدعى من حاجز الخطأ بعد أول رسم ناجح — يوقف مؤقّت «لم يبدأ التطبيق». */
export function markAppMounted() {
  const w = win();
  if (w) {
    try { w[MOUNT_FLAG] = true; } catch { /* تجاهل */ }
  }
}

/**
 * إبلاغ السيرفر عن خطأ واجهة. لا يرمي استثناءً أبداً ولا يحجب المستخدم:
 * بيرجّع true لو اتبعت، وfalse بهدوء لو مفيش شبكة/دالة fetch أو الجلسة اتقفلت.
 * `force` لتجاوز منع التكرار (يستخدمه الاختبار).
 */
export function reportClientError({ kind = 'error', message, stack, url, userAgent, force = false } = {}) {
  const w = win();
  const text = cut((message || '').trim(), MAX_MESSAGE);
  if (!text) return Promise.resolve(false);

  const key = seenKey(kind, text, stack);
  if (!force && seen.has(key)) return Promise.resolve(false);
  seen.add(key);

  if (typeof fetch !== 'function') return Promise.resolve(false);

  const boot = (w && w.__EOC_BOOT__) || {};
  const body = {
    kind: cut(kind, 40),
    message: text,
    stack: cut(stack, MAX_STACK) || null,
    url: sanitizeUrl(url || (w && w.location && w.location.href)) || null,
    user_agent: cut(userAgent || (w && w.navigator && w.navigator.userAgent), MAX_USER_AGENT) || null,
    app_revision: cut(boot.appRevision, 120) || null,
    boot_id: cut(boot.bootId, 64) || null,
  };

  // 🪪 التوكن في الترويسة فقط (لا داخل الجسم): يربط البلاغ بصاحبه ليعرف المالك
  //    أي حساب/جهاز واجه المشكلة — ونفس مسار التوكن المستخدم في كل استدعاءات التطبيق.
  const headers = { 'Content-Type': 'application/json' };
  const token = sessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    return fetch(CLIENT_ERRORS_API, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      keepalive: true, // آخر إرسال: لازم يفلت حتى لو الصفحة بتتقفل أو بتتعمل reload
    })
      .then((res) => Boolean(res && res.ok))
      .catch(() => false);
  } catch {
    return Promise.resolve(false); // fetch نفسه رمى (سياسة متصفح/وضع خاص)
  }
}

const PALETTE = {
  dark: { bg: '#0a0a0b', panel: '#141416', border: '#2a2a2f', text: '#f6f6f7', muted: '#a7a9b2', accent: '#c70000', pre: '#0f0f11', preText: '#ffb4b4' },
  light: { bg: '#f2f2f5', panel: '#ffffff', border: '#dcdce2', text: '#14141a', muted: '#5c6070', accent: '#c70000', pre: '#f7f7fa', preText: '#a30000' },
};

/**
 * 🛡️ شاشة بديلة واضحة *بلا React* — تُبنى بـ DOM خالص (createElement + textContent)
 *    لأنها بالظبط الحالة اللي مفيش فيها تطبيق شغال. idempotent: لا تتكرر أبداً.
 *    ترجّع true لو الشاشة معروضة (كانت موجودة أو اتعرضت الآن).
 */
export function showFatalScreen({ title, message, detail, kind = 'module', report = true } = {}) {
  const d = doc();
  if (!d || !d.body) return false;

  try {
    const existing = d.getElementById(FATAL_SCREEN_ID);
    if (existing) return true;

    const isLight = (d.documentElement && d.documentElement.getAttribute('data-theme')) === 'light';
    const c = isLight ? PALETTE.light : PALETTE.dark;

    if (report) {
      reportClientError({
        kind: kind === 'watchdog' ? 'error' : kind,
        message: message || title || 'واجهة غير محمّلة',
        stack: detail,
      });
    }

    const overlay = d.createElement('div');
    overlay.id = FATAL_SCREEN_ID;
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('dir', 'rtl');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483000',
      display: 'grid', placeItems: 'center', padding: '24px',
      background: c.bg, color: c.text, textAlign: 'center',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
      overflow: 'auto',
    });

    const card = d.createElement('div');
    Object.assign(card.style, {
      maxWidth: '620px', width: '100%', background: c.panel,
      border: `1px solid ${c.border}`, borderRadius: '18px', padding: '28px 22px',
    });
    overlay.appendChild(card);

    const icon = d.createElement('div');
    icon.textContent = '⚠️';
    Object.assign(icon.style, { fontSize: '46px', lineHeight: '1.1', marginBottom: '10px' });
    card.appendChild(icon);

    const heading = d.createElement('h1');
    heading.textContent = title || 'تعذّر تحميل الواجهة';
    Object.assign(heading.style, { fontSize: '22px', fontWeight: '900', margin: '0 0 10px' });
    card.appendChild(heading);

    const body = d.createElement('p');
    body.textContent = message || 'حصل خطأ منع تحميل التطبيق على هذا الجهاز. التفاصيل اتسجّلت على السيرفر، وكل اللي عليك تعيد التحميل.';
    Object.assign(body.style, { fontSize: '15px', lineHeight: '1.9', color: c.muted, margin: '0 0 16px' });
    card.appendChild(body);

    if (detail) {
      const pre = d.createElement('pre');
      // ⚠️ textContent لا innerHTML: رسالة الخطأ نص غير موثوق (قد تحمل مدخلات المستخدم)
      pre.textContent = cut(detail, 1200);
      Object.assign(pre.style, {
        direction: 'ltr', textAlign: 'start', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: c.pre, color: c.preText, border: `1px solid ${c.border}`,
        borderRadius: '12px', padding: '12px', fontSize: '12px',
        maxHeight: '200px', overflow: 'auto', margin: '0 0 18px',
      });
      card.appendChild(pre);
    }

    const row = d.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' });
    card.appendChild(row);

    const reloadBtn = d.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.textContent = 'إعادة التحميل';
    Object.assign(reloadBtn.style, {
      padding: '12px 22px', borderRadius: '12px', border: '0', cursor: 'pointer',
      background: c.accent, color: '#fff', fontWeight: '900', fontSize: '15px',
    });
    reloadBtn.addEventListener('click', () => {
      try { win()?.location?.reload(); } catch { /* تجاهل */ }
    });
    row.appendChild(reloadBtn);

    const copyBtn = d.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = 'نسخ التفاصيل';
    Object.assign(copyBtn.style, {
      padding: '12px 22px', borderRadius: '12px', cursor: 'pointer',
      background: 'transparent', color: c.text, border: `1px solid ${c.border}`,
      fontWeight: '700', fontSize: '15px',
    });
    const detailsText = [
      `الشاشة: ${win()?.location?.href || ''}`,
      `الوقت: ${new Date().toISOString()}`,
      `السبب: ${message || title || ''}`,
      detail ? `\n${detail}` : '',
    ].join('\n');
    copyBtn.addEventListener('click', async () => {
      copyBtn.textContent = 'جارٍ النسخ…';
      try {
        const nav = win()?.navigator;
        if (nav && nav.clipboard && nav.clipboard.writeText) {
          await nav.clipboard.writeText(detailsText);
        }
        copyBtn.textContent = 'تم النسخ ✓';
      } catch {
        copyBtn.textContent = 'انسخ يدوياً من الأعلى';
      }
    });
    row.appendChild(copyBtn);

    const foot = d.createElement('p');
    foot.textContent = 'البلاغ اتسجّل على السيرفر — لو تكرر، المالك يقدر يشوفه من سجل أخطاء الواجهة.';
    Object.assign(foot.style, { fontSize: '12px', color: c.muted, margin: '16px 0 0' });
    card.appendChild(foot);

    d.body.appendChild(overlay);
    return true;
  } catch {
    return false; // حتى لو بناء الشاشة فشل، الملف ما يرميش استثناء (ممنوع يزوّد العطل)
  }
}

/** يُخفي الشاشة البديلة (بعد نجاح إعادة المحاولة داخل نفس الصفحة). */
export function hideFatalScreen() {
  const d = doc();
  if (!d) return false;
  try {
    const el = d.getElementById(FATAL_SCREEN_ID);
    if (el && el.parentNode) { el.parentNode.removeChild(el); return true; }
  } catch { /* تجاهل */ }
  return false;
}

/**
 * 📡 تثبيت المستمعين العامّين: أخطاء التحميل/التنفيذ + الوعود المرفوضة.
 * idempotent (لا يتكرر التثبيت) ويرجّع true لو مثبّت.
 */
export function installClientErrorReporting() {
  const w = win();
  if (!w || typeof w.addEventListener !== 'function') return false;
  if (w.__EOC_ERROR_HOOKS__) return true;

  const onError = (event) => {
    try {
      const err = event && event.error;
      const message = (err && err.message) || (event && event.message) || 'خطأ غير معروف في الواجهة';
      const stack = (err && err.stack) || [event?.filename, event?.lineno ? `:${event.lineno}` : ''].join('');
      reportClientError({ kind: 'error', message, stack });
      // لا نغطي على تطبيق شغّال: الشاشة البديلة فقط لو React لم يركّب بعد
      if (!isAppMounted()) {
        showFatalScreen({
          kind: 'module',
          title: 'تعذّر تحميل الواجهة',
          message: 'حصل خطأ أثناء تحميل الصفحة، فما اكتمل تشغيل التطبيق على هذا الجهاز. أعد التحميل — ولو تكرر، التفاصيل مسجلة على السيرفر.',
          detail: stack ? `${message}\n${stack}` : message,
          report: false, // سبق إبلاغه أعلاه
        });
      }
    } catch { /* ممنوع أي استثناء من داخل معالج عام */ }
  };

  const onRejection = (event) => {
    try {
      const reason = event && event.reason;
      const message = (reason && reason.message) || (typeof reason === 'string' ? reason : '') || 'وعد مرفوض بلا رسالة';
      const stack = (reason && reason.stack) || '';
      reportClientError({ kind: 'unhandledrejection', message, stack });
      if (!isAppMounted()) {
        showFatalScreen({
          kind: 'unhandledrejection',
          title: 'تعذّر تشغيل الواجهة',
          message: 'فشل تحميل مطلوب لتشغيل التطبيق على هذا الجهاز. أعد التحميل — ولو تكرر، التفاصيل مسجلة على السيرفر.',
          detail: stack ? `${message}\n${stack}` : message,
          report: false,
        });
      }
    } catch { /* تجاهل */ }
  };

  w.addEventListener('error', onError);
  w.addEventListener('unhandledrejection', onRejection);
  try { w.__EOC_ERROR_HOOKS__ = true; } catch { /* تجاهل */ }
  return true;
}

/**
 * ⏱️ حرس «الصفحة البيضا بلا أي خطأ»: لو #root فضل فاضي بعد المهلة ولم يركّب
 * التطبيق ⇒ نعرض الشاشة البديلة بدل الانتظار الأبدي أمام شاشة فاضية.
 * (يستخدمه الاختبار بـ ms صغير.) يرجّع دالة إلغاء.
 */
export function startMountWatchdog({ ms = DEFAULT_WATCHDOG_MS, rootId = 'root', report = true } = {}) {
  const w = win();
  const d = doc();
  if (!w || !d || typeof w.setTimeout !== 'function') return () => {};

  const timer = w.setTimeout(() => {
    try {
      if (isAppMounted()) return;
      const root = d.getElementById(rootId);
      if (root && root.childNodes && root.childNodes.length > 0) return; // فيه رسم ⇒ التطبيق حي
      showFatalScreen({
        kind: 'watchdog',
        title: 'الواجهة لم تكتمل',
        message: `التطبيق لم يظهر خلال ${Math.round(ms / 1000)} ثانية. غالباً الوحدة لم تُحمّل أو فشلت قبل الرسم — أعد التحميل، ولو تكرر البلاغ مسجّل على السيرفر.`,
        report,
      });
    } catch { /* تجاهل */ }
  }, Math.max(0, Number(ms) || 0));

  return () => { try { w.clearTimeout(timer); } catch { /* تجاهل */ } };
}

/** 🧪 للاختبارات فقط: تصفير الحالة الداخلية (منع التكرار + علم التثبيت). */
export function __resetClientErrorState() {
  seen.clear();
  const w = win();
  if (w) {
    try {
      delete w.__EOC_ERROR_HOOKS__;
      delete w[MOUNT_FLAG];
    } catch { /* تجاهل */ }
  }
}

// 🧰 أدوات يدوية للتشخيص: من كونسول المتصفح (أو من نسخة اختبار)
const w = win();
if (w) {
  try {
    w.__EOC_REPORT_ERROR__ = reportClientError;
    w.__EOC_SHOW_FATAL__ = showFatalScreen;
  } catch { /* تجاهل */ }
}
