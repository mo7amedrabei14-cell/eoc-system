/* ─────────────────────────────────────────────────────────────────────────────
   🧪 مساعدات المتصفح الوهمي للاختبارات (Node مافيهوش localStorage/window)
   ─────────────────────────────────────────────────────────────────────────────
   ملاحظة مقصودة: الملف ده مش اسمه *.test.js عشان `node --test` ميشغّلوش كاختبار.
   ───────────────────────────────────────────────────────────────────────────── */

/** localStorage وهمي بنفس واجهة المتصفح (Map وراه) */
export function makeFakeStorage({ failOnSet = false } = {}) {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => {
      if (failOnSet) throw new Error('QuotaExceededError');
      map.set(String(k), String(v));
    },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => { map.clear(); },
    /** للاختبارات: كل اللي متخزن فعلاً */
    _dump: () => Object.fromEntries(map),
  };
}

/** نركّب localStorage وهمي على الكائن العام (بحماية من خاصية غير قابلة للكتابة) */
export function installFakeStorage(options) {
  const storage = makeFakeStorage(options);
  try {
    globalThis.localStorage = storage;
  } catch {
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  }
  if (globalThis.localStorage !== storage) {
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  }
  return storage;
}

/** window وهمي بيسجّل الأحداث — للتحقق من إشعار «الطابور اتغير» */
export function installFakeWindow() {
  const events = [];
  const win = {
    events,
    dispatched: () => events.map(e => e.type),
    dispatchEvent: (ev) => { events.push(ev); return true; },
  };
  try {
    globalThis.window = win;
  } catch {
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  }
  if (globalThis.window !== win) {
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true, writable: true });
  }
  return win;
}

/** حقل/حاوية DOM وهمية لاختبار التقاط الحقول */
export function fakeNode({ id = '', type = 'text', value = '', checked = false, disabled = false } = {}) {
  const fired = [];
  return {
    id,
    type,
    value,
    checked,
    disabled,
    fired,
    dispatchEvent: (ev) => { fired.push(ev.type); return true; },
  };
}

/** جذر استمارة وهمي: querySelectorAll بتاع captureFields + querySelector بتاع applyFields
 *  ملاحظة: بنحتفظ بنفس المصفوفة (مش نسخة) عشان نقدر نضيف حقول أثناء الاختبار
 *  ونحاكي ظهور صفوف React الديناميكية بعد شوية وقت. */
export function fakeRoot(nodes = []) {
  return {
    nodes,
    querySelectorAll: () => nodes,
    querySelector: (sel) => nodes.find(n => `#${n.id}` === sel) || null,
  };
}
