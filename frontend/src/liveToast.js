// ═══════════════════════════════════════════════════════════════════════════
// 🔔 محرّك الإشعارات اللحظية — منطق نقي (بدون React ولا JSX) قابل للاختبار
//    الاختبارات: src/__tests__/liveToast.test.js
//    الغرض: كل قرار «ذكي» في التوست (لون النوع، التسمية، العمر، ساعة الوقفة)
//    يعيش هنا بدل ما يتوزّع جوّه Dashboard.jsx.
// ═══════════════════════════════════════════════════════════════════════════

// ── ① هوية كل نوع حدث: نبرة لونية (من توكنات الثيم) + مفتاح أيقونة ──────────
//    الألوان دلالية بحسب خريطة الألوان في index.css:
//    accent=الحسم/الخطر · info=معلومة · warn=انتباه · ok=اكتمال · data=قياس ميداني · ai=ذكاء اصطناعي
export const LIVE_TONES = {
  mission: { tone: 'accent', kind: 'mission' },
  local_news: { tone: 'info', kind: 'news' },
  global_disaster: { tone: 'accent', kind: 'disaster' },
  earthquake: { tone: 'warn', kind: 'quake' },
  eq_intel: { tone: 'quake', kind: 'quake' },  // 💛 نبرة زلزالية مخصصة — أصفر مميز يعرف فوراً
  weather: { tone: 'data', kind: 'weather' },
  handover: { tone: 'ok', kind: 'handover' },
  ai_news: { tone: 'ai', kind: 'ai' },
  audit: { tone: 'info', kind: 'audit' },
};

export const LIVE_FALLBACK = { tone: 'accent', kind: 'live' };

/** نبرة + أيقونة أي نوع حدث (مع احتياطي آمن لأي نوع جديد يضيفه الباك إند). */
export function notifyVisual(event_type) {
  return LIVE_TONES[event_type] || LIVE_FALLBACK;
}

// ── ② التسمية القصيرة التي تظهر أعلى التوست ────────────────────────────────
export const LIVE_LABELS = {
  mission: { ar: 'مهمة', en: 'Mission' },
  local_news: { ar: 'خبر محلي', en: 'Local news' },
  global_disaster: { ar: 'كارثة عالمية', en: 'Global disaster' },
  earthquake: { ar: 'رصد زلزالي', en: 'Seismic' },
  eq_intel: { ar: 'استخبارات زلزالية', en: 'Quake intel' },
  weather: { ar: 'طقس', en: 'Weather' },
  handover: { ar: 'تسليم وردية', en: 'Handover' },
  ai_news: { ar: 'رصد آلي', en: 'AI signal' },
  audit: { ar: 'سجل النظام', en: 'System log' },
};

// 🚨 نافذة إضافية للزلازل الاستخباراتية: تُعرض فوق الطابور المركزي فوراً
//    حتى لو كان التوست الأحادي مشغولاً — المطلوب أن يكون المستخدم أول من يعرف.
export const EQ_INTEL_EXTRA_TOASTS = 1;

// 🔊 إنذار الزلازل القريبة من وسط القارة: نغمة إيقاظ متكررة عبر Web Audio API
//    (بدون ملفات صوت خارجية — تضمن التشغيل من أول مرة). مطلوب تفاعل مستخدم واحد
//    سابقاً في الجلسة (نقرة/زر) لأن المتصفحات تحجب الصوت التلقائي — نفتح قناة
//    الصوت عند أول تفاعل حتى يكون الإنذار جاهزاً لحظة وقوع الزلزال.
let _eqAudioCtx = null;
let _eqSoundUnlocked = false;

export function unlockEarthquakeSound() {
  try {
    if (_eqSoundUnlocked) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    _eqAudioCtx = new Ctx();
    // تشغيل صامت للتهيئة: يفتح قناة الصوت بعد أول تفاعل مستخدم (سياسة المتصفحات)
    const osc = _eqAudioCtx.createOscillator();
    const gain = _eqAudioCtx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(_eqAudioCtx.destination);
    osc.start();
    osc.stop(_eqAudioCtx.currentTime + 0.05);
    _eqSoundUnlocked = true;
  } catch {
    // بدون صوت في سياقات مقيدة — الإشعار البصري يبقى كاملاً
  }
}

export function playEarthquakeAlarm(pattern = 'critical') {
  try {
    unlockEarthquakeSound();
    if (!_eqAudioCtx) return;
    if (_eqAudioCtx.state === 'suspended') _eqAudioCtx.resume();
    const ctx = _eqAudioCtx;
    const now = ctx.currentTime;
    const beep = (startOffset, freq, dur, vol = 0.28) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(vol, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + dur + 0.02);
    };
    if (pattern === 'critical') {
      // ثلاث صفعات إنذار حادة صاعدة — لا تُشبه أي نغمة توست عادية
      [0, 0.45, 0.9].forEach((offset, i) => beep(offset, 660 + i * 220, 0.32, 0.3));
    } else {
      // تنبيه مزدوج أهدأ للزلازل الخارجية
      beep(0, 520, 0.25, 0.22);
      beep(0.35, 520, 0.25, 0.22);
    }
  } catch {
    // فشل الصوت لا يجب أن يكسر الإشعار البصري أبداً
  }
}

export function notifyLabel(event_type, language = 'ar') {
  const entry = LIVE_LABELS[event_type];
  if (entry) return language === 'en' ? entry.en : entry.ar;
  return language === 'en' ? 'Live update' : 'تحديث لحظي';
}

// ── ③ عمر الحدث: «الآن» / «منذ 12 ث» — يُحسب لحظة الرسم فقط ────────────────
//    الغرض: التوست اللي كان في الطابور يبان صادقًا («منذ 40 ث») بدل ما يخدع المستخدم.
export function formatEventAge(created_at, language = 'ar', now = Date.now()) {
  if (created_at === null || created_at === undefined || created_at === '') return '';
  const ts = created_at instanceof Date ? created_at.getTime() : Date.parse(String(created_at));
  if (!Number.isFinite(ts)) return '';
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  const ar = language !== 'en';
  if (secs < 5) return ar ? 'الآن' : 'now';
  if (secs < 60) return ar ? `منذ ${secs} ث` : `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return ar ? `منذ ${mins} د` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return ar ? `منذ ${hours} س` : `${hours}h ago`;
}

// ── ④ ساعة التوست: الوقفة الحقيقية بالماوس ────────────────────────────────
//    العدّاد المركزي يعتمد على shownAt (لحظة الظهور). الوقفة تُخزَّن في pausedAt،
//    وعند الرجوع نُزيح shownAt بمقدار زمن الوقفة ⇒ الوقت المتبقي لا يتأثر إطلاقًا.
//    (الحركة في CSS تتوقف بنفس اللحظة عبر class ‎.is-paused‎ ⇒ الاثنان متزامنان.)

/** وقفة: تخزين لحظة الوقفة فقط (idempotent — الوقوف مرتين لا يفسد الحساب). */
export function pauseToastClock(t, now = Date.now()) {
  if (!t || t.pausedAt) return t;
  return { ...t, pausedAt: now };
}

/** رجوع: تُضاف مدّة الوقفة إلى shownAt فلا يخسر التوست أي جزء من عمره. */
export function resumeToastClock(t, now = Date.now()) {
  if (!t || !t.pausedAt) return t;
  const held = Math.max(0, now - t.pausedAt);
  return { ...t, pausedAt: null, shownAt: (t.shownAt ?? now) + held };
}

/** هل انقضى عمره؟ (لا ينقضي أبدًا وهو موقوف، ولا لو كان يلعب أنيميشن الخروج) */
export function shouldExpireToast(t, now = Date.now(), lifetimeMs = 9000) {
  if (!t || t.closing || t.pausedAt) return false;
  return Boolean(t.shownAt) && now - t.shownAt >= lifetimeMs;
}

// ── ⑤ تكرار الأحداث: مفتاح منطقي واحد للإشعار اللحظي ولائمة الجرس ──────────
//    السبب الجذري (مقيس من قاعدة البيانات): نفس الحركة تُسجَّل صفّين بنفس الثانية
//    (طلب مكرر/إعادة إرسال)، أو زلزال واحد باسمين «إضافة زلزال» + «إضافة زلزال محلي».
//    الـ event_id بيختلف فالمفتاح القديم كان بيعتبرهم حدثين مستقلين ⇒ إشعار مرتين.
//    الحل هنا: مفتاح منطقي (النوع + السجل + الفاعل + نص الحركة بعد التطبيع).

/** النافذة التي نعتبر داخلها الحدث مكرّرًا (الباك إند كمان عنده حارس 12 ثانية) */
export const DUPLICATE_WINDOW_MS = 20000;

// كلمات النطاق اللي بتفرق بين نصّين لنفس الحركة الواحدة
// كل الهجاءات (ياء/ألف مقصورة/تاء مربوطة/هاء) لأن الفلترة تحصل بعد التطبيع
const SCOPE_WORDS = new Set([
  'محلي', 'محلى', 'محلية', 'محليه',
  'عالمي', 'عالمى', 'عالمية', 'عالميه',
  'دولي', 'دولى', 'دولية', 'دوليه',
  'مصر', 'بمصر',
]);

/** تطبيع نص الحركة: تشكيل/تطويل محذوف · ألف موحّدة · ترقيم→مسافة · كلمات النطاق محذوفة · ياء/تاء موحّدة */
export function normalizeActionText(text) {
  if (!text) return '';
  let s = String(text).trim().toLowerCase();
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, '');      // تشكيل + تطويل
  s = s.replace(/[أإآ]/g, 'ا');                            // توحيد الألف
  s = s.replace(/[^\w\s\u0600-\u06FF]/g, ' ');            // ترقيم → مسافة
  s = s.split(/\s+/).filter((w) => w && !SCOPE_WORDS.has(w)).join(' ');
  s = s.replace(/ي/g, 'ى').replace(/ة/g, 'ه');            // توحيد الياء والتاء المربوطة
  return s.trim();
}

/** مفتاح الهوية المنطقية للحدث — الحدثان بنفس المفتاح = نفس الحركة ⇒ إشعار واحد */
export function logicalEventKey(e) {
  if (!e) return '';
  const scope = e.entity_id ?? e.mission_id ?? '';
  const actor = e.event_type === 'ai_news' ? 'auto' : (e.actor_user_id ?? '');
  return [e.event_type || '', scope, actor, normalizeActionText(e.action)].join('|');
}

/** هل شُفنا نفس الحدث المنطقي قريبًا؟ (النافذة محفوظة داخل قيمة الانتهاء نفسها) */
export function shouldSuppressDuplicate(recent, key, now = Date.now()) {
  if (!recent || !key) return false;
  const expiry = recent.get(key);
  return typeof expiry === 'number' && expiry > now;
}

/** تسجيل المفتاح بنافذة انتهاء + تنظيف المفتاح المنتهي (لا نمو لا نهائي في الذاكرة) */
export function rememberEventKey(recent, key, now = Date.now(), windowMs = DUPLICATE_WINDOW_MS) {
  if (!recent || !key) return recent;
  for (const [k, exp] of recent) if (exp <= now) recent.delete(k);
  recent.set(key, now + windowMs);
  return recent;
}

// ── ⑥ مونوجرام الفاعل: حرفان يقولان «مين عمل الحركة» من نظرة واحدة ───────────
//    الهدف بصري: الإشعار يحمل هوية صاحبه بدل نص رمادي طويل.
//    عربي/إنجليزي · اسم واحد ⇒ أول حرفين · اسمان ⇒ أول حرف من كل اسم.
//    اللقب/الرتبة في البداية تُحذف لأنها تُفقد المونوجرام معناه («م. محمد» → «مم» × ⇒ «مح»).
export function initialsFrom(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/^(?:م|أ|د|أ\.|د\.|م\.|eng|dr|mr|mrs|ms)\.?\s+/i, '');
  const words = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '';
  const letters = (w) => Array.from(w);
  if (words.length === 1) return letters(words[0]).slice(0, 2).join('');
  return letters(words[0])[0] + letters(words[1])[0];
}

/** هل انتهت أنيميشن الخروج ⇒ يُحذف نهائيًا؟ */
export function shouldPurgeToast(t, now = Date.now(), exitMs = 320) {
  if (!t || !t.closing) return false;
  return now - (t.closingAt ?? 0) >= exitMs;
}
