/* ─────────────────────────────────────────────────────────────────────────────
   🩺 قلب حارس السيرفر — الجزء النقي (بدون React/JSX)
   ─────────────────────────────────────────────────────────────────────────────
   مطلوع من serverHealth.jsx عشان يبقى قابل للاختبار في Node
   (frontend/src/__tests__/serverHealthCore.test.js).

   القواعد المثبّتة بالاختبارات — وكل قاعدة ليها سبب حقيقي من الميدان:
     • نبضتين فاشلتين متتاليتين = وقوع حقيقي (نبضة واحدة ممكن تكون تعثّر شبكة).
     • «النت مقطوع عند المستخدم» ≠ «السيرفر مش مردود» ≠ «السيرفر شغال والداتا واقعة».
       التلاتة رسائل مختلفة تماماً لأن الخطوة اللي المستخدم يعملها مختلفة.
     • `boot_id` اتغير بعد انقطاع = السيرفر قام من جديد ⇒ لازم تحديث كامل للصفحة.
     • رد 502/503/504 من بوابة الاستضافة = السيرفر مش مردود (مش مشكلة داتا).
   ───────────────────────────────────────────────────────────────────────────── */
// ملاحظة: الامتداد مكتوب صراحةً (.js) عشان الملف ده يفضل قابل للاستيراد في
// اختبارات Node الخام من غير bundler — Vite بيحلّ الامتدادين عادي.
import { BASE } from './apiBase.js';

export const HEALTH_PATH = '/api/health';
export const DEFAULT_POLL_MS = 20000;      // الوضع الطبيعي: نبضة كل 20 ثانية (طلب GET خفيف جداً)
export const HIDDEN_POLL_MS = 60000;       // التاب المخفي: نبضة كل 60 ثانية — العودة = فحص فوري
export const SUSPECT_POLL_MS = 4000;       // أول فشل = «مش متأكدين» ⇒ نعيد بسرعة للتأكد (مش نستنى الدورة)
export const BLOCKED_POLL_MS = 5000;       // أثناء الوقوع: نجرب كل 5 ثواني حتى نعرف الرجوع فوراً
export const TIMEOUT_MS = 12000;           // أطول من connect_timeout=10s (db.py) حتى لا نعلن وقوعاً زائفاً
export const FAIL_THRESHOLD = 2;           // نبضتين فاشلتين متتاليتين = وقوع حقيقي
export const RECOVERY_BANNER_MS = 120000;  // مهلة شريط «تمت الاستعادة / السيرفر قام من جديد»

export const healthUrl = (now = Date.now()) => `${BASE}${HEALTH_PATH}?t=${now}`;

export async function checkServerHealth({ timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  try {
    const res = await fetch(healthUrl(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const latencyMs = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt));
    if (!res.ok) {
      // ❗ رد HTTP غير سليم (502/503/504 من بوابة الاستضافة أو البروكسي، أو 500):
      //    دي حكمها حكم «السيرفر مش مردود» — الخدمة نفسها مش شغالة، مش قاعدة البيانات.
      return { reachable: false, ok: false, status: res.status, latencyMs, error: `HTTP ${res.status} من بوابة الاستضافة` };
    }
    const info = await res.json().catch(() => null);
    if (!info || typeof info !== 'object') {
      return { reachable: true, ok: false, latencyMs, error: 'رد غير مفهوم من السيرفر' };
    }
    return { reachable: true, ok: true, dbOk: info?.database?.ok !== false, info, latencyMs };
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return {
      reachable: false,
      ok: false,
      error: timedOut ? `لا رد خلال ${Math.round(timeoutMs / 1000)} ثانية` : (error?.message || 'خطأ شبكة'),
      latencyMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * القرار النقي لنبضة واحدة:
 *   - نبضة سليمة ⇒ نصفّر العدّاد ونرفع الوقوع فوراً.
 *   - نبضة فاشلة ⇒ نزوّد العدّاد، ولو وصل الحد ⇐ «وقوع حقيقي» ونجيب السبب.
 * @returns {{ ok: boolean, failCount: number, blocked: boolean, reason: 'offline'|'unreachable'|'database'|null }}
 */
export function classifyHealth({ result, browserOnline = true, failCount = 0, failThreshold = FAIL_THRESHOLD }) {
  const healthy = !!(result?.ok && result?.dbOk !== false);
  if (healthy) return { ok: true, failCount: 0, blocked: false, reason: null };
  const failures = Number(failCount || 0) + 1;
  // ⚠️ السبب الحقيقي: النت عند المستخدم؟ ولا السيرفر نفسه مش مردود؟ ولا رد والداتا واقعة؟
  const reason = !browserOnline ? 'offline' : (result?.reachable ? 'database' : 'unreachable');
  return { ok: false, failCount: failures, blocked: failures >= failThreshold, reason };
}

/**
 * بعد نجاح النبضة: نحدّد هل السيرفر عمل رستر خلال الانقطاع؟ ونبني إشعار الرجوع.
 * @returns {{ bootId: string|null, revision: string|null, incident: object|null }}
 */
export function resolveRecovery({
  prevBootId = null,
  prevRevision = null,
  info = null,
  wasBlocked = false,
  outageMs = 0,
  now = Date.now(),
  bannerMs = RECOVERY_BANNER_MS,
}) {
  const bootId = info?.boot_id || prevBootId;
  const revision = info?.revision || prevRevision;
  const bootChanged = !!prevBootId && !!info?.boot_id && info.boot_id !== prevBootId;
  const revisionChanged = !!prevRevision && !!info?.revision && prevRevision !== 'dev' && info.revision !== prevRevision;
  const incident = wasBlocked
    ? {
      kind: (bootChanged || revisionChanged) ? 'restarted' : 'recovered',
      outageMs,
      bootChanged,
      revisionChanged,
      revision: info?.revision || null,
      at: now,
      expiresAt: now + bannerMs,
    }
    : null;
  return { bootId, revision, incident };
}
