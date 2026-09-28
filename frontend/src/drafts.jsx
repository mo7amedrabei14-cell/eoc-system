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
import { fetchWorkspace, saveWorkspace, deleteWorkspace } from './workspace';

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
  serverSyncMs = 8000,
}) {
  const key = draftKey(form, scope);
  // ☁️ نطاق المسودة على السيرفر — نفس المفتاح من أي جهاز/متصفح لنفس الحساب
  const serverScope = `${form}${scope ? `:${scope}` : ''}`;
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

  // ☁️ رفع مُهدَّأ للسيرفر: الحفظ المحلي يحدث فوراً، والرفع كل serverSyncMs
  //    (حتى لا نغرق القاعدة بكتابة كل 1.5 ثانية لكل جهاز).
  const lastPushRef = useRef(0);
  const pendingPushRef = useRef(null);
  // نطاق السيرفر في مرجع حي (القيم بتتقرأ من دوال مؤجلة: مؤقت/إغلاق الصفحة)
  const serverScopeRef = useRef(serverScope);
  const pushServer = useCallback((payload, { force = false, keepalive = false } = {}) => {
    const now = Date.now();
    pendingPushRef.current = { payload, keepalive };
    if (!force && now - lastPushRef.current < serverSyncMs) return;
    lastPushRef.current = now;
    const job = pendingPushRef.current;
    pendingPushRef.current = null;
    if (job) saveWorkspace({ kind: 'draft', scope: serverScopeRef.current, payload: job.payload, keepalive: job.keepalive });
  }, [serverSyncMs]);
  const pushServerRef = useRef(pushServer);
  // ✍️ مزامنة «أحدث قيمة» بعد الرسم (نفس نمط بقية المراجع في الهوك)
  useEffect(() => {
    serverScopeRef.current = serverScope;
    pushServerRef.current = pushServer;
  });

  // 🔎 عند فتح الاستمارة (أو تغيّر النطاق: مهمة/خبر آخر) نبحث عن مسودة محفوظة:
  //    السيرفر أولاً (فهو من يحمل شغل بقية الأجهزة)، والمخزن المحلي احتياطي
  //    للانقطاع أو حين لا توجد جلسة/شبكة.
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    (async () => {
      // التفريغ داخل جسم دالة غير متزامنة (مش متزامناً أثناء الـ effect)
      setPending(null);
      setSavedAt(null);
      const local = readDraft(key);
      const remote = await fetchWorkspace('draft');
      if (cancelled) return;
      const item = (remote || []).find(x => x && x.scope === serverScope);
      const remoteDraft = item && hasContent(item.payload)
        ? { payload: item.payload, savedAt: Date.parse(item.updated_at) || 0, fromServer: true }
        : null;
      // الأحدث يفوز: لا ندهس شغلاً محلياً أحدث لم يُرفع بعد
      const chosen = (remoteDraft && (!local || (remoteDraft.savedAt || 0) >= (local.savedAt || 0)))
        ? remoteDraft
        : (local && hasContent(local.payload) ? local : remoteDraft);
      setPending(chosen || null);
    })();
    return () => { cancelled = true; };
  }, [key, serverScope, enabled]);

  const saveNow = useCallback((opts = {}) => {
    if (!enabledRef.current) return null;
    let payload;
    try { payload = captureRef.current?.(); } catch { payload = null; }
    if (!hasContent(payload)) return null;
    saveDraft(keyRef.current, payload);        // نسخة محلية: احتياطي الانقطاع
    setSavedAt(Date.now());
    pushServerRef.current?.(payload, opts);    // ☁️ الحفظ الحقيقي: على السيرفر
    return payload;
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(saveNow, intervalMs);   // الحفظ الدوري أثناء الكتابة
    const flush = () => { if (document.visibilityState !== 'visible') saveNow(); };
    // 🚪 قفل التاب/الجهاز: حفظ محلي فوري + رفع أخير بـ keepalive (آخر فرصة قبل الفقد)
    const onHide = () => saveNow({ force: true, keepalive: true });
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

  // 🗑️ الحذف يشمل السيرفر أيضاً — فلا تظهر مسودة ملغاة على جهاز آخر
  const discard = useCallback(() => {
    clearDraft(keyRef.current);
    deleteWorkspace({ kind: 'draft', scope: serverScopeRef.current });
    setPending(null);
  }, []);
  const clear = useCallback(() => {
    clearDraft(keyRef.current);
    deleteWorkspace({ kind: 'draft', scope: serverScopeRef.current });
    setPending(null);
    setSavedAt(null);
  }, []);

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
      <span className="draft-restore-icon" aria-hidden="true">☁️</span>
      <span className="draft-restore-text">
        <b>{T('فيه مسودة محفوظة على السيرفر', 'A saved draft exists on the server')}</b>
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
    <span className="draft-saved-hint" title={T('محفوظة على السيرفر — متاحة من أي جهاز ولن تضيع لو الاتصال قطع', 'Saved on the server — available from any device, safe if the connection drops')}>
      ☁️ {T('محفوظة على السيرفر', 'saved on server')}
    </span>
  );
}
