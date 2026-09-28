/* ─────────────────────────────────────────────────────────────────────────────
   ☁️ حالة العمل على السيرفر — مسودات الاستمارات + طابور الإرسال المعلّق
   ─────────────────────────────────────────────────────────────────────────────
   الجذر اللي بيحله الملف ده: كل «شغل لسه ما اترسلش» (مسودة استمارة/إرسال فاشل/
   خلايا طقس معلّقة) كان محفوظاً في متصفح *جهاز واحد* ⇒ مع فريق يعمل من أكثر من
   7 أجهزة: أي جهاز تاني ما بيشوفش شغل غيره، وضياع الجهاز = ضياع الشغل نهائياً.

   دلوقتي السيرفر هو المصدر (لكل مستخدم)، والمخزن المحلي بقى مجرد مخزن مؤقت
   للانقطاع (لو الشبكة واقعة بنكتب محلياً وبنرفع أول ما ترجع).
   ───────────────────────────────────────────────────────────────────────────── */

// ملاحظة: لاحقة .js مقصودة — الملف ده بيتحمّل من اختبارات Node (node --test)
// حيث لا يوجد resolver بلا لاحقة (Vite بيقبل الشكلين).
import { BASE } from './apiBase.js';

export const WORKSPACE_API = `${BASE}/api/workspace`;

/** توكن الجلسة — يُقرأ لحظة الاستدعاء (مش وقت الاستيراد). */
export const authToken = () => {
  try { return (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('access_token')) || ''; }
  catch { return ''; }
};

const headers = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token || authToken()}` });

/** كل حالات العمل للمستخدم الحالي (اختياري: نوع واحد). */
export async function fetchWorkspace(kind = null) {
  const token = authToken();
  if (!token) return null;                       // لا جلسة ⇒ لا محاولة (المخزن المحلي هو المتاح)
  try {
    const res = await fetch(`${WORKSPACE_API}${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`, { headers: headers(token) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return null; }                        // انقطاع أو CORS ⇒ نجرب محلياً
}

/** حفظ/تحديث حالة عمل على السيرفر (upsert). `keepalive` لإرسال أخير عند إغلاق الصفحة. */
export async function saveWorkspace({ kind, scope, payload, meta = null, keepalive = false }) {
  const token = authToken();
  if (!token || !scope) return false;
  try {
    const res = await fetch(WORKSPACE_API, {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({ kind, scope, payload, meta }),
      keepalive,
    });
    return res.ok;
  } catch { return false; }                       // محفوظ محلياً — يُرفع في الدورة الجاية
}

/** حذف حالة عمل من السيرفر (بعد حفظ ناجح أو تسليم الإرسال). */
export async function deleteWorkspace({ kind, scope, keepalive = false }) {
  const token = authToken();
  if (!token || !scope) return false;
  try {
    const res = await fetch(`${WORKSPACE_API}?kind=${encodeURIComponent(kind)}&scope=${encodeURIComponent(scope)}`, {
      method: 'DELETE',
      headers: headers(token),
      keepalive,
    });
    return res.ok;
  } catch { return false; }
}
