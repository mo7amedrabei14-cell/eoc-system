import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/* ─────────────────────────────────────────────────────────────────────────────
   🩺 حارس السيرفر (Server Watchdog) — الواجهة (الهوك + الشاشات)
   ─────────────────────────────────────────────────────────────────────────────
   المشكلة اللي بيحلها:
   النظام قبل كده كان بيقول «الاتصال تمام» بمجرد أن `navigator.onLine === true`،
   يعني لو النت شغال والسيرفر نفسه واقع أو بيعمل رستر، الشاشة تفضل شكلها طبيعي
   والناس تفتكر إنها شغالة وتعمل استمارات — وكل الحفظ يفشل في الصمت.

   الحل: نبضة حقيقية على `/api/health` بتقول لنا السبب الحقيقي للوقوع، وكل ده
   بيتحوّل لشاشة كبيرة *حاجبة* عشان محدش يشتغل على نظام ميت.

   القلب النقي (النبضة + قاعدة «نبضتين فاشلتين = وقوع») اتنقل لـ
   `frontend/src/serverHealthCore.js` عشان يبقى قابل للاختبار في Node بدون
   متصفح: src/__tests__/serverHealthCore.test.js — والملف ده بيسيب نفس الواجهة
   القديمة، فأي استيراد من './serverHealth' يفضل شغال زي ما هو.
   ───────────────────────────────────────────────────────────────────────────── */
import {
  DEFAULT_POLL_MS,
  SUSPECT_POLL_MS,
  BLOCKED_POLL_MS,
  FAIL_THRESHOLD,
  RECOVERY_BANNER_MS,
  checkServerHealth,
  classifyHealth,
  resolveRecovery,
} from './serverHealthCore';

// ملاحظة معمارية: الثوابت والدوال النقية بتُستورد مباشرةً من './serverHealthCore'
// (بدون إعادة تصدير من هنا) حتى يظل الملف ده «مكوّنات + هوك» فقط — وهو الشرط اللي
// بيحافظ على Fast Refresh شغّال ومش بيولّد أخطاء lint.

// التعطيل مقصود: الهوك والمكوّنات المحلية في ملف واحد عشان الواجهة تستورد من
// باب واحد ('./serverHealth') — نفس الأسلوب المتبع في باقي ملفات الواجهة.
// eslint-disable-next-line react-refresh/only-export-components -- قرار مقصود
export function useServerHealth({ enabled = true, pollMs = DEFAULT_POLL_MS, failThreshold = FAIL_THRESHOLD } = {}) {
  const [state, setState] = useState({
    phase: 'ok',                 // ok | suspect | down
    reason: null,                // offline | unreachable | database
    info: null,
    latencyMs: null,
    lastOkAt: null,
    consecutiveFailures: 0,
    checking: false,
    lastError: null,
    checkedAt: null,
    incident: null,              // { kind: 'restarted' | 'recovered', outageMs, bootChanged, revisionChanged }
  });

  const failRef = useRef(0);
  const blockingRef = useRef(false);
  const firstFailAtRef = useRef(null);
  const bootRef = useRef(null);
  const revisionRef = useRef(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);
  const enabledRef = useRef(enabled);
  // ✍️ المزامنة بعد الرسم وليس أثناءه (قاعدة react-hooks/refs) — والقراءة نفسها
  //    بتحصل جوه دوال مؤجّلة (poll / loop) فمحتاجة أحدث قيمة من `enabled`.
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const poll = useCallback(async () => {
    if (!enabledRef.current) return null;
    setState(s => (s.checking ? s : { ...s, checking: true }));
    const result = await checkServerHealth();
    if (!mountedRef.current) return result;

    const now = Date.now();
    const browserOnline = typeof navigator === 'undefined' || navigator.onLine !== false;

    if (result.ok && result.dbOk !== false) {
      // ✅ السيرفر + قاعدة البيانات تمام — القرار كله من الدالة النقية resolveRecovery
      const wasBlocked = blockingRef.current;
      const outageMs = firstFailAtRef.current ? now - firstFailAtRef.current : 0;
      const rec = resolveRecovery({
        prevBootId: bootRef.current,
        prevRevision: revisionRef.current,
        info: result.info,
        wasBlocked,
        outageMs,
        now,
      });
      bootRef.current = rec.bootId;
      revisionRef.current = rec.revision;
      failRef.current = 0;
      blockingRef.current = false;
      firstFailAtRef.current = null;
      setState(s => ({
        ...s,
        phase: 'ok',
        reason: null,
        info: result.info || s.info,
        latencyMs: result.latencyMs,
        lastOkAt: now,
        consecutiveFailures: 0,
        checking: false,
        lastError: null,
        checkedAt: now,
        // إشعار الرجوع/الرستر يظهر مرة واحدة بعد أي انقطاع حقيقي فقط (مش مع كل نبضة عادية)
        incident: rec.incident || s.incident,
      }));
      return result;
    }

    // ⚠️ نبضة فاشلة: إما السيرفر مش مردود خالص، أو رد بس القاعدة واقعة
    //    القرار النقي في core: نبضتين = وقوع حقيقي، والسبب يفرّق بين تلات حالات
    const verdict = classifyHealth({ result, browserOnline, failCount: failRef.current, failThreshold });
    failRef.current = verdict.failCount;
    if (verdict.failCount === 1) firstFailAtRef.current = now;
    if (verdict.blocked) blockingRef.current = true;
    setState(s => ({
      ...s,
      phase: verdict.blocked ? 'down' : 'suspect',
      reason: verdict.reason,
      consecutiveFailures: verdict.failCount,
      checking: false,
      checkedAt: now,
      lastError: result.error || null,
      latencyMs: result.latencyMs,
      info: result.info || s.info,
      // انقطاع جديد يلغي إشعار الرجوع القديم حتى لا نطمئن على حالة ميتة
      incident: null,
    }));
    return result;
  }, [failThreshold]);

  useEffect(() => {
    if (!enabled) return undefined;
    mountedRef.current = true;
    let cancelled = false;
    const loop = async () => {
      await poll();
      if (cancelled || !mountedRef.current) return;
      // ⏱️ عند أي فشل: نعيد بسرعة للتأكد — الإعلان عن وقوع السيرفر يستحق نبضة
      //    زيادة فوراً، حتى لا نبقى على شاشة «شغالة» وهي ميتة.
      const wait = blockingRef.current
        ? BLOCKED_POLL_MS
        : (failRef.current > 0 ? SUSPECT_POLL_MS : pollMs);
      timerRef.current = setTimeout(loop, wait);
    };
    loop();

    // رجوع الشبكة عند المتصفح ⇒ نبضة فورية (بدل انتظار الدورة الجاية)
    const onNetworkChange = () => { if (!cancelled) poll(); };
    window.addEventListener('online', onNetworkChange);
    window.addEventListener('offline', onNetworkChange);
    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
      window.removeEventListener('online', onNetworkChange);
      window.removeEventListener('offline', onNetworkChange);
    };
  }, [enabled, poll, pollMs]);

  const dismissIncident = useCallback(() => setState(s => ({ ...s, incident: null })), []);
  const recheck = useCallback(() => poll(), [poll]);

  return {
    ...state,
    blocking: state.phase === 'down',
    suspect: state.phase === 'suspect',
    recheck,
    dismissIncident,
  };
}

/* ── نصوص الحالات: كل سبب وله كلام مختلف، لأن المشكلة مختلفة تماماً ── */
const REASON_COPY = {
  offline: {
    ar: {
      title: 'النت مقطوع عند جهازك',
      body: 'الجهاز نفسه مش واصل بالإنترنت. النظام مش هيقدر يحفظ أي حاجة لحد ما الشبكة ترجع.',
      step: 'اتأكد من الواي فاي أو كابل الشبكة، أو جرّب تشغّل بيانات الموبايل ثم اضغط «جرّب تاني».',
    },
    en: {
      title: 'Your device is offline',
      body: 'This device has no internet connection, so nothing can be saved until the network is back.',
      step: 'Check Wi-Fi / cable (or enable mobile data), then press "Try again".',
    },
  },
  unreachable: {
    ar: {
      title: 'مفيش اتصال بالسيرفر',
      body: 'السيرفر نفسه مش مردود (واقع أو بيعمل رستر) — وده مش مشكلة في النت عندك.',
      step: 'رستر السيرفر من جهاز الاستضافة، وبعدها اضغط Ctrl + Shift + R لتحديث كامل للصفحة.',
    },
    en: {
      title: 'No connection to the server',
      body: 'The server itself is not responding (down or restarting) — this is not your internet.',
      step: 'Restart the server on the hosting machine, then press Ctrl + Shift + R for a full refresh.',
    },
  },
  database: {
    ar: {
      title: 'السيرفر شغال بس قاعدة البيانات واقعة',
      body: 'السيرفر مردود، لكن قاعدة البيانات لا تستجيب — يعني كل عمليات الحفظ هتفشل فعلاً، فالشاشة دلوقتي مضلِّلة.',
      step: 'راجع اتصال قاعدة البيانات (Aiven) أو رستر السيرفر، وبعدها اضغط Ctrl + Shift + R.',
    },
    en: {
      title: 'Server is up but the database is down',
      body: 'The API answers, yet the database is not responding — every save will fail, so the screen would be misleading.',
      step: 'Check the database (Aiven) connection or restart the server, then press Ctrl + Shift + R.',
    },
  },
};

/* ─────────────────────────────────────────────────────────────────────────────
   🔌 شاشة الوقوع الحاجبة — تصميم بيوضّح فوراً إن النظام *مش* شغال
   ───────────────────────────────────────────────────────────────────────────── */
export function ServerDownOverlay({ health, lang = 'ar', pendingForms = 0 }) {
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!health?.blocking) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [health?.blocking]);

  if (!health?.blocking) return null;

  const copy = (REASON_COPY[health.reason] || REASON_COPY.unreachable)[lang === 'en' ? 'en' : 'ar'];
  const sinceOk = health.lastOkAt ? Math.max(0, Math.round((nowTick - health.lastOkAt) / 1000)) : null;
  const ago = (secs) => {
    if (secs === null) return lang === 'en' ? 'never' : 'غير معروف';
    if (secs < 60) return lang === 'en' ? `${secs}s ago` : `قبل ${secs} ثانية`;
    return lang === 'en' ? `${Math.round(secs / 60)}m ago` : `قبل ${Math.round(secs / 60)} دقيقة`;
  };

  const T = (ar, en) => (lang === 'en' ? en : ar);

  return createPortal(
    <div className="server-down-backdrop" dir={lang === 'en' ? 'ltr' : 'rtl'} role="alertdialog" aria-modal="true" aria-live="assertive">
      <div className="server-down-card animate-fade-in-up">
        {/* رسمة الفيشة المفصولة — تتحرك لتوضّح «الاتصال مقطوع» بلا كلام */}
        <div className="sd-illustration" aria-hidden="true">
          <span className="sd-ring" />
          <svg viewBox="0 0 220 120" className="sd-plug-svg">
            <rect x="12" y="34" width="58" height="52" rx="12" className="sd-socket-body" />
            <rect x="28" y="50" width="9" height="20" rx="4" className="sd-socket-slot" />
            <rect x="46" y="50" width="9" height="20" rx="4" className="sd-socket-slot" />
            <path d="M70 60 H118" className="sd-cable" />
            <g className="sd-plug">
              <rect x="118" y="42" width="46" height="36" rx="10" className="sd-plug-body" />
              <rect x="112" y="50" width="10" height="8" rx="3" className="sd-plug-pin" />
              <rect x="112" y="62" width="10" height="8" rx="3" className="sd-plug-pin" />
            </g>
            <path d="M164 60 C 186 60, 186 26, 206 26" className="sd-cable" />
          </svg>
        </div>

        <h2 className="server-down-title">{copy.title}</h2>
        <p className="server-down-body">{copy.body}</p>

        <div className="server-down-steps">
          <div className="server-down-step">
            <span className="sd-step-num">1</span>
            <span>{copy.step}</span>
          </div>
          <div className="server-down-step">
            <span className="sd-step-num">2</span>
            <span>
              {T(
                'تحديث كامل للصفحة: اضغط على الكيبورد ',
                'Full page refresh: press ',
              )}
              <kbd className="sd-kbd">Ctrl</kbd>
              <span className="sd-plus">+</span>
              <kbd className="sd-kbd">Shift</kbd>
              <span className="sd-plus">+</span>
              <kbd className="sd-kbd">R</kbd>
              {T(' (على الموبايل: اسحب الصفحة لتحت للتحديث).', ' (mobile: pull down to reload).')}
            </span>
          </div>
          <div className="server-down-step server-down-step--calm">
            <span className="sd-step-num sd-step-num--ok">✓</span>
            <span>
              {T(
                'متحاولش تعيد كتابة الاستمارة: أي حاجة كتبتها محفوظة على جهازك',
                'Do not retype anything: whatever you filled is saved on your device',
              )}
              {pendingForms > 0
                ? T(` (${pendingForms} استمارة في طابور الإرسال)، وهتتبعت لوحدها أول ما السيرفر يرد.`,
                  ` (${pendingForms} queued), and will be sent automatically once the server answers.`)
                : T(' وهتتبعت لوحدها أول ما السيرفر يرد.', ' and will be sent automatically once the server answers.')}
            </span>
          </div>
        </div>

        <div className="server-down-status">
          <span className="sd-dot" />
          <span>
            {T('آخر نبضة ناجحة: ', 'Last healthy ping: ')}
            <b>{ago(sinceOk)}</b>
            {health.consecutiveFailures > 0 && (
              <>
                {' · '}
                {T('محاولات فاشلة متتالية: ', 'consecutive failed checks: ')}
                <b>{health.consecutiveFailures}</b>
              </>
            )}
            {health.lastError && (
              <>
                {' · '}
                <span className="sd-err">{health.lastError}</span>
              </>
            )}
          </span>
        </div>

        <div className="server-down-actions">
          <button type="button" onClick={health.recheck} disabled={health.checking} className="btn-warn server-down-btn">
            {health.checking ? T('⏳ بيفحص الاتصال…', '⏳ Checking…') : T('🔄 جرّب تحديث الاتصال الآن', '🔄 Retry connection now')}
          </button>
          <button type="button" onClick={() => window.location.reload()} className="btn-ghost server-down-btn">
            {T('↻ تحديث الصفحة (Ctrl+Shift+R)', '↻ Reload page (Ctrl+Shift+R)')}
          </button>
        </div>

        <p className="server-down-foot">{T('النظام بيفحص السيرفر تلقائيًا كل 5 ثواني، والشاشة دي هتختفي لوحدها أول ما يرجع.', 'The system re-checks the server every 5 seconds; this screen disappears on its own once it recovers.')}</p>
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   🟢 شريط الرجوع: بعد انقطاع حقيقي — يقول للناس تعمل تحديث كامل
   ───────────────────────────────────────────────────────────────────────────── */
export function ServerRecoveryBanner({ health, lang = 'ar' }) {
  const incident = health?.incident;
  const dismiss = health?.dismissIncident;
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    if (!incident) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [incident]);

  useEffect(() => {
    if (!incident || !dismiss) return undefined;
    const left = Math.max(0, (incident.expiresAt || 0) - Date.now());
    const t = setTimeout(dismiss, left || RECOVERY_BANNER_MS);
    return () => clearTimeout(t);
  }, [incident, dismiss]);

  if (!incident) return null;
  const T = (ar, en) => (lang === 'en' ? en : ar);
  const restarted = incident.kind === 'restarted';
  const minutes = incident.outageMs ? Math.max(1, Math.round(incident.outageMs / 60000)) : 0;
  const left = Math.max(0, Math.round(((incident.expiresAt || 0) - nowTick) / 1000));

  return createPortal(
    <div className={`server-recover-banner ${restarted ? 'server-recover-banner--restart' : ''}`} dir={lang === 'en' ? 'ltr' : 'rtl'} role="status" aria-live="polite">
      <span className="sd-dot sd-dot--ok" />
      <div className="flex-1 min-w-0">
        <b>
          {restarted
            ? T('تم إعادة تشغيل السيرفر — اعمل تحديث كامل للصفحة (Ctrl+Shift+R)', 'The server was restarted — do a full page refresh (Ctrl+Shift+R)')
            : T('تمت استعادة الاتصال بالسيرفر — راجع إن البيانات اتحدّثت', 'Server connection restored — make sure the data is up to date')}
        </b>
        <span className="server-recover-sub">
          {minutes > 0
            ? T(` (مدة الانقطاع: ${minutes} دقيقة)`, ` (outage: ${minutes} min)`)
            : ''}
          {T(' لو الشاشة باينة قديمة، التحديث الكامل بيمنع أي تضارب.', ' If the screen looks stale, a full refresh avoids any mismatch.')}
        </span>
      </div>
      <button type="button" onClick={() => window.location.reload()} className="btn-warn server-recover-btn">
        {T('حدّث الآن', 'Refresh now')}
      </button>
      <button type="button" onClick={dismiss} className="server-recover-close" aria-label={T('إغلاق', 'Dismiss')}>
        ✕{left > 0 && left < 60 ? ` ${left}` : ''}
      </button>
    </div>,
    document.body,
  );
}
