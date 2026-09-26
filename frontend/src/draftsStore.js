/* ─────────────────────────────────────────────────────────────────────────────
   💾 مخزن المسودات المحلية — الجزء النقي (بدون React/JSX)
   ─────────────────────────────────────────────────────────────────────────────
   مطلوع من drafts.jsx عشان يبقى قابل للاختبار في Node
   (frontend/src/__tests__/draftsStore.test.js) — أما الواجهة (الهوك والشرايط)
   فباقية في drafts.jsx وبتستورد من هنا.

   المشكلة اللي بيحلها: الشباب بيملأوا الاستمارة (مهمة/طقس/خبر/تسليم) وبعدين
   الكهرباء تقطع، أو الجهاز يقفل، أو السيرفر يوقع — فيرجعوا يكتبوا كل حاجة من الأول.
   ───────────────────────────────────────────────────────────────────────────── */

const PREFIX = 'eoc_draft_v1:';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // أسبوع — بعدها المسودة القديمة تتنضف لحالها
const MAX_DRAFTS = 40;                         // سقف صحي حتى لا تتخم الـ localStorage

const STORAGE = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export const DRAFT_PREFIX = PREFIX;
export const DRAFT_RETENTION_MS = RETENTION_MS;
export const MAX_DRAFTS_COUNT = MAX_DRAFTS;

export const draftKey = (form, scope = '') => `${PREFIX}${form}${scope ? `:${scope}` : ''}`;

/** هل في المسودة أي محتوى فعلي؟ (نتجاهل الاستمارات الفارغة فلا نزعج المستخدم) */
export const hasContent = (value, depth = 0) => {
  if (depth > 6) return false;
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return !Number.isNaN(value);
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some(v => hasContent(v, depth + 1));
  if (typeof value === 'object') {
    if (value.checked !== undefined) return !!value.checked;
    return Object.values(value).some(v => hasContent(v, depth + 1));
  }
  return false;
};

export function readDraft(key) {
  try {
    const raw = STORAGE()?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const savedAt = Number(parsed.savedAt) || 0;
    if (savedAt && Date.now() - savedAt > RETENTION_MS) { STORAGE()?.removeItem(key); return null; }
    return { payload: parsed.payload, savedAt };
  } catch { return null; }
}

export function saveDraft(key, payload) {
  try {
    STORAGE()?.setItem(key, JSON.stringify({ payload, savedAt: Date.now(), v: 1 }));
    pruneDrafts();
    return true;
  } catch {
    // الحجم ممتلئ: ننضف الأقدم ونحاول تاني مرة واحدة
    try { pruneDrafts(true); STORAGE()?.setItem(key, JSON.stringify({ payload, savedAt: Date.now(), v: 1 })); return true; } catch { return false; }
  }
}

export function clearDraft(key) { try { STORAGE()?.removeItem(key); } catch { /* ignore */ } }

/** كل المسودات الحالية (لوحة الاسترجاع العامة + التنضيف) */
export function listDrafts() {
  const out = [];
  const store = STORAGE();
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const found = readDraft(key);
      if (!found) continue;
      out.push({ key, ...found });
    }
  } catch { /* ignore */ }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function pruneDrafts(aggressive = false) {
  const all = listDrafts();
  const keep = aggressive ? 8 : MAX_DRAFTS;
  all.slice(keep).forEach(d => clearDraft(d.key));
}

/* ── التقاط حقول الاستمارة من الـ DOM ──
   أكثر استمارات النظام تقرأ قيمها بـ `document.getElementById('f_*')` (حقول غير
   مُتحكَّم فيها من React)، فاللقط هنا بالـ id لكل input/select/textarea. الحقول
   الحساسة (كلمة مرور / ملفات) مستثناة تماماً ولا تُخزَّن أبداً. */
const FIELD_SELECTOR = 'input, select, textarea';

export function captureFields(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return {};
  const out = {};
  root.querySelectorAll(FIELD_SELECTOR).forEach((node) => {
    const id = node.id;
    if (!id) return;
    // الحقول الحساسة لا تُخزَّن أبداً (كلمات المرور/الملفات) — أما الحقول المخفية
    // فمطلوبة: حقول SegInputs وأي محددات مخصّصة بتنقل قيمتها فيها.
    if (node.type === 'password' || node.type === 'file') return;
    if (node.disabled) return;
    if (node.type === 'checkbox' || node.type === 'radio') out[id] = { checked: !!node.checked };
    else out[id] = node.value;
  });
  return out;
}

export function applyFields(root, snapshot) {
  if (!snapshot) return 0;
  let applied = 0;
  Object.entries(snapshot).forEach(([id, val]) => {
    const node = (root && typeof root.querySelector === 'function' ? root.querySelector(`#${id}`) : null)
      || (typeof document !== 'undefined' ? document.getElementById(id) : null);
    if (!node) return;
    if (node.type === 'password' || node.type === 'file') return;
    if (val && typeof val === 'object') {
      if ('checked' in val && node.checked !== !!val.checked) {
        node.checked = !!val.checked;
        node.dispatchEvent(new Event('change', { bubbles: true }));
        applied += 1;
      }
      return;
    }
    if (String(node.value) === String(val ?? '')) return;
    node.value = val ?? '';
    // أحداث حقيقية حتى تلتقطها أي مستمعات React/JS في الاستمارة
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    applied += 1;
  });
  return applied;
}

/** حقول الصفوف الديناميكية (مشاركين/مركبات/مستفيدين) مش بتوجد غير بعد رسم React
 *  للصفوف من الحالة ⇒ نعيد المحاولة لحد ما كل الحقول تبقى موجودة (أو ينتهي عدد المحاولات). */
export function applyFieldsWhenReady(root, snapshot, { attempts = 16, intervalMs = 150, findById } = {}) {
  const find = findById || ((id) => (typeof document !== 'undefined' ? document.getElementById(id) : null));
  return new Promise((resolve) => {
    const ids = Object.keys(snapshot || {});
    let tries = 0;
    const tick = () => {
      tries += 1;
      const missing = ids.some(id => !find(id));
      if (!missing || tries >= attempts) { resolve(applyFields(root, snapshot)); return; }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
