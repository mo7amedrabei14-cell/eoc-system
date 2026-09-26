import { useCallback, useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   💾 المسودات المحلية — الواجهة (الهوك + الشرايط)
   ─────────────────────────────────────────────────────────────────────────────
   المخزن النقي (save/read/clear/prune + التقاط حقول الـ DOM) اتنقل لـ
   `frontend/src/draftsStore.js` عشان يبقى قابل للاختبار في Node بدون متصفح
   (src/__tests__/draftsStore.test.js). الملف ده بيسيب نفس الواجهة القديمة
   (نفس الأسماء المصدَّرة) فأي استيراد من './drafts' يفضل شغال زي ما هو.
   ───────────────────────────────────────────────────────────────────────────── */

import { draftKey, hasContent, readDraft, saveDraft, clearDraft } from './draftsStore';

// ملاحظة معمارية: الدوال النقية (captureFields / applyFields / applyFieldsWhenReady /
// listDrafts / pruneDrafts) بتُستورد مباشرةً من './draftsStore' في أماكن استخدامها،
// فمافيش إعادة تصدير من هنا — والملف ده يفضل «هوك + مكوّنات» فقط كما يطلب الـ lint.

/* ─────────────────────────────────────────────────────────────────────────────
   🪝 الهوك: حفظ تلقائي + اكتشاف مسودة قديمة + استرجاع/تجاهل
   ───────────────────────────────────────────────────────────────────────────── */
// التعطيل مقصود: الهوك والمكوّنات المحلية في ملف واحد عشان الواجهة تستورد من
// باب واحد ('./drafts') — نفس الأسلوب المتبع في باقي ملفات الواجهة.
// eslint-disable-next-line react-refresh/only-export-components -- قرار مقصود
export function useFormDraft({
  form,
  scope = '',
  enabled = true,
  capture,
  apply,
  intervalMs = 1500,
}) {
  const key = draftKey(form, scope);
  const [pending, setPending] = useState(null);   // مسودة من جلسة سابقة (تنتظر قرار المستخدم)
  const [savedAt, setSavedAt] = useState(null);   // آخر حفظ تلقائي في هذه الجلسة
  const captureRef = useRef(capture);
  const applyRef = useRef(apply);
  const enabledRef = useRef(enabled);
  const keyRef = useRef(key);
  // ✍️ مزامنة «أحدث قيمة» بعد كل رسم (مش أثناء الرسم — قاعدة react-hooks/refs):
  //    الـ refs دي بتتقرأ من دوال مؤجّلة (interval / pagehide) فمحتاجة أحدث قيمة
  //    من غير ما نعيد بناء المستمعين في كل رسم.
  useEffect(() => {
    captureRef.current = capture;
    applyRef.current = apply;
    enabledRef.current = enabled;
    keyRef.current = key;
  });

  // 🔎 عند فتح الاستمارة (أو تغيّر النطاق: مهمة/خبر آخر) نبحث عن مسودة محفوظة
  useEffect(() => {
    if (!enabled) return;
    const found = readDraft(key);
    // التعطيل موضعي ومقصود: القراءة هنا من مخزن خارجي (localStorage) عند تغيّر
    // المفتاح، مش اشتقاق حالة من الـ props — فمفيش داعي لإعادة الحساب كل رسم.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(found && hasContent(found.payload) ? found : null);
    setSavedAt(null);
  }, [key, enabled]);

  const saveNow = useCallback(() => {
    if (!enabledRef.current) return null;
    let payload;
    try { payload = captureRef.current?.(); } catch { payload = null; }
    if (!hasContent(payload)) return null;
    saveDraft(keyRef.current, payload);
    setSavedAt(Date.now());
    return payload;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(saveNow, intervalMs);   // الحفظ الدوري أثناء الكتابة
    const flush = () => { if (document.visibilityState !== 'visible') saveNow(); };
    const onHide = () => saveNow();                   // قفل التاب/الجهاز — آخر فرصة قبل الفقد
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', onHide);
      // ملاحظة مقصودة: لا نحفظ عند الإزالة (unmount) لأن الاستمارة بتُزال بعد
      // الحفظ الناجح — وقتها المسودة اتنضفت بالفعل ولا يجب أن نعيد كتابتها.
    };
  }, [enabled, saveNow, intervalMs]);

  const restore = useCallback(async () => {
    const found = pending || readDraft(keyRef.current);
    if (!found) return false;
    setPending(null);
    try { await applyRef.current?.(found.payload, found); } catch { /* الاسترجاع أفضل جهد */ }
    setSavedAt(found.savedAt || null);
    return true;
  }, [pending]);

  const discard = useCallback(() => { clearDraft(keyRef.current); setPending(null); }, []);
  const clear = useCallback(() => { clearDraft(keyRef.current); setPending(null); setSavedAt(null); }, []);

  return { key, pending, savedAt, hasDraft: !!pending, restore, discard, clear, saveNow };
}

const formatDraftTime = (ts) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('ar-EG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

/** 🟡 شريط «فيه مسودة محفوظة» — زرار واحد للاسترجاع وزرار للتجاهل */
export function DraftRestoreBar({ pending, onRestore, onDiscard, lang = 'ar', label = '' }) {
  if (!pending) return null;
  const T = (ar, en) => (lang === 'en' ? en : ar);
  return (
    <div className="draft-restore-bar" dir={lang === 'en' ? 'ltr' : 'rtl'} role="status">
      <span className="draft-restore-icon" aria-hidden="true">💾</span>
      <span className="draft-restore-text">
        <b>{T('فيه مسودة محفوظة على الجهاز', 'A saved draft exists on this device')}</b>
        {label ? ` — ${label}` : ''}
        {' · '}
        {T('آخر حفظ', 'saved')}: {formatDraftTime(pending.savedAt)}
      </span>
      <span className="draft-restore-actions">
        <button type="button" onClick={onRestore} className="btn-warn draft-restore-btn">
          {T('↩️ استرجع المسودة', '↩️ Restore draft')}
        </button>
        <button type="button" onClick={onDiscard} className="btn-ghost draft-restore-btn">
          {T('🗑️ تجاهل', '🗑️ Discard')}
        </button>
      </span>
    </div>
  );
}

/** 🟢 مؤشر صغير «بيتحفظ عندك» — يطمّن المستخدم إن الشغل محفوظ محلياً */
export function DraftSavedHint({ savedAt, lang = 'ar' }) {
  if (!savedAt) return null;
  const T = (ar, en) => (lang === 'en' ? en : ar);
  return (
    <span className="draft-saved-hint" title={T('نسخة محلية على جهازك — مش هتضيع لو الاتصال قطع', 'Local copy on your device — safe even if the connection drops')}>
      💾 {T('محفوظ عندك', 'saved locally')}
    </span>
  );
}
