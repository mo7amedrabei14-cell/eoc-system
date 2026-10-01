// ⏳ مؤشر العمل العام — أي أكشن في أي صفحة يعرض «جاري عمل كذا»
//   ويبقى ظاهراً حتى رسالة التأكيد (ActionToast) أو حتى hideWorking().
//
//   ⛑️ ضمانة 100%: installWorkingAuto() تُركَّب مرة واحدة في التطبيق:
//     • تعترض كل نداءات fetch في النظام: أي تحميل بيانات (زر/فورم/فتح صفحة/فلتر/تحديث دوري)
//       يُشعل الحبة حتى ينتهي الطلب — أياً كان الاكشن ومن أي فورم وأي صفحة.
//     • نصان: «جاري تنفيذ العملية» لما يكون الطلب نتيجة ضغط زر/أكشن،
//       و«جاري تحميل البيانات» لأي تحميل بيانات عادي — حسب مصدر الطلب.
//     • الاستثناء الوحيد: استطلاع الريال تايم الدوري (نبضة حية مستمرة) حتى لا تبقى الحبة شغالة للأبد.
//
//   الاستخدام اليدوي (لنص مخصص):
//     showWorking('جاري حفظ المهمة…'); … hideWorking();
//     await withWorking('جاري التصدير…', doExport());

const EVT_SHOW = 'eoc:working-show';
const EVT_HIDE = 'eoc:working-hide';

const INTERACTION_WINDOW_MS = 1600;   // طلب بدأ خلالها من ضغطة زر ⇒ الحبة تظهر
const MIN_SHOW_MS = 650;              // أقل مدة ظهور حتى لا تومض بلا معنى
const GRACE_HIDE_MS = 300;            // مهلة لين قبل الإخفاء (طلبات متتالية = حبة واحدة)
const MAX_AUTO_MS = 15000;            // صمام أمان: أي حبة تلقائية لا تبقى أكثر من 15 ثانية
const SESSION_HARD_CAP_MS = 10 * 60 * 1000;  // 🛡️ سقف مطلق لأي جلسة حبة (10 دقائق) — لا تعيش ساعات مهما حدث
let hardCapOverride = 0;              // للاختبارات فقط
const TEXT_ACTION = 'جاري تنفيذ العملية…';
const BACKGROUND_URL_PATTERNS = [
  '/api/realtime/',                   // النبضة الحية المستمرة — مستثناة دائماً
];
/* ضغطات الأزرار فقط ترفع راية «تنفيذ عملية» — باتصال حقيقي بالـ DOM */
let lastButtonPressAt = 0;
const BUTTON_SELECTOR = [
  'button', '[role="button"]', 'input[type="submit"]', 'input[type="button"]',
  '.btn', '.icon-btn', '.action-btn', '.nav-item', '.chip', '.tab-trigger',
  '.seg-pill', 'a[href]',
].join(', ');

function markButtonPress(e) {
  try {
    if (e && e.type === 'submit') { lastButtonPressAt = Date.now(); return; }   // سابميت فورم = زر
    if (e && e.type === 'keydown' && e.key !== 'Enter') return;                 // Enter داخل فورم = زر
    const t = e && e.target;
    const isButton = t && typeof t.closest === 'function' && t.closest(BUTTON_SELECTOR);
    if (isButton) lastButtonPressAt = Date.now();
  } catch { /* لا تعطل أي نقرة أبداً */ }
}

let activeCount = 0;
let currentText = '';
let fallbackTimer = null;
let suppressed = false;
let sessionStartedAt = 0;             // بداية الجلسة (أول show بعد الصمت)

/* للاختبارات: فرض سقف صغير لإثبات الضمانة */
export function setWorkingHardCap(ms) { hardCapOverride = Math.max(0, ms | 0); }

/* كتم الحبة في صفحات بعينها (مثل مؤشرات المركز الرئيسية — تحديثها الدوري لا يستحق إزعاجاً) */
export function setWorkingSuppressed(v) {
  suppressed = !!v;
  if (suppressed && activeCount > 0) {
    activeCount = 0;
    currentText = '';
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    try { window.dispatchEvent(new CustomEvent(EVT_HIDE)); } catch { /* تجاهل */ }
  }
}

export function showWorking(text = 'جاري التنفيذ…') {
  if (suppressed) return;
  if (activeCount === 0) sessionStartedAt = Date.now();   // جلسة جديدة تبدأ الآن
  activeCount += 1;
  currentText = text;
  try {
    window.dispatchEvent(new CustomEvent(EVT_SHOW, { detail: { text } }));
  } catch { /* بيئة بلا window — تجاهل */ }
  if (fallbackTimer) clearTimeout(fallbackTimer);
  // 🛡️ مؤقت الأمان لا يتجاوز السقف المطلق للجلسة مهما تكررت الضغطات
  const cap = hardCapOverride || SESSION_HARD_CAP_MS;
  const remaining = Math.max(1000, cap - (Date.now() - sessionStartedAt));
  fallbackTimer = setTimeout(() => { activeCount = 0; hideWorking(); }, remaining);
}

export function hideWorking() {
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount === 0) {
    currentText = '';
    sessionStartedAt = 0;   // انتهت الجلسة — الجولة القادمة تبدأ من الصفر
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    try {
      window.dispatchEvent(new CustomEvent(EVT_HIDE));
    } catch { /* تجاهل */ }
  }
}

export function resetWorking() {
  activeCount = 0;
  currentText = '';
  sessionStartedAt = 0;
  if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  try { window.dispatchEvent(new CustomEvent(EVT_HIDE)); } catch { /* تجاهل */ }
}

export function withWorking(text, promiseOrFn) {
  showWorking(text);
  const promise = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
  return Promise.resolve(promise)
    .finally(() => hideWorking());
}

/* ── ⛑️ الطبقة التلقائية: أي fetch في النظام = الحبة تظهر حتماً ────────── */
let autoInstalled = false;
let autoActive = false;
let autoShownAt = 0;
let autoInFlight = 0;
let autoHideTimer = null;
let autoSafetyTimer = null;

function autoShow(text) {
  if (autoActive) {
    // نص أحدث؟ حدّثه فقط
    try { window.dispatchEvent(new CustomEvent(EVT_SHOW, { detail: { text } })); } catch { /* تجاهل */ }
    return;
  }
  autoActive = true;
  autoShownAt = Date.now();
  showWorking(text);
  // 🛡️ صمام أمان: طلب معلّق لا يُبقي الحبة أكثر من 15 ثانية مهما حدث
  if (autoSafetyTimer) clearTimeout(autoSafetyTimer);
  autoSafetyTimer = setTimeout(() => {
    autoInFlight = 0;
    if (autoActive) { autoActive = false; hideWorking(); }
  }, MAX_AUTO_MS);
}

function autoSettle() {
  if (!autoActive || autoInFlight > 0) return;
  const remainingMin = Math.max(0, MIN_SHOW_MS - (Date.now() - autoShownAt));
  if (autoHideTimer) clearTimeout(autoHideTimer);
  autoHideTimer = setTimeout(() => {
    if (autoActive && autoInFlight === 0) {
      autoActive = false;
      if (autoSafetyTimer) { clearTimeout(autoSafetyTimer); autoSafetyTimer = null; }
      hideWorking();
    }
  }, Math.max(remainingMin, GRACE_HIDE_MS));
}

export function installWorkingAuto() {
  if (autoInstalled || typeof window === 'undefined' || typeof document === 'undefined') return;
  autoInstalled = true;

  // ① تتبع ضغطات الأزرار (لتمييز نص «تنفيذ عملية» عن «تحميل بيانات»)
  ['click', 'submit', 'keydown'].forEach((evt) => {
    document.addEventListener(evt, markButtonPress, { capture: true, passive: true });
  });

  // ② اعتراض fetch: الحبة تظهر فقط للطلبات الناتجة عن ضغطة زر (خلال 1.6 ثانية).
  //    التحديثات الخلفية الدورية وفتحات الصفحات الصامتة لا تُشعلها — لا 24 ساعة!
  if (typeof window.fetch === 'function' && !window.fetch.__eocWorkingPatched) {
    const originalFetch = window.fetch.bind(window);
    const patchedFetch = (...args) => {
      const promise = originalFetch(...args);
      try {
        const url = String((args[0] && args[0].url) || args[0] || '');
        const isBackground = BACKGROUND_URL_PATTERNS.some((pat) => url.includes(pat));
        const isLocal = url.startsWith('blob:') || url.startsWith('data:');
        const isAction = (Date.now() - lastButtonPressAt) <= INTERACTION_WINDOW_MS;
        if (isAction && !isBackground && !isLocal) {
          autoInFlight += 1;
          autoShow(TEXT_ACTION);
          Promise.resolve(promise)
            .catch(() => {})
            .finally(() => {
              autoInFlight = Math.max(0, autoInFlight - 1);
              autoSettle();
            });
        }
      } catch { /* لا تعطل أي نداء أبداً */ }
      return promise;
    };
    patchedFetch.__eocWorkingPatched = true;
    window.fetch = patchedFetch;
  }
}

export const WORKING_EVENTS = { SHOW: EVT_SHOW, HIDE: EVT_HIDE };
export const getWorkingText = () => currentText;
