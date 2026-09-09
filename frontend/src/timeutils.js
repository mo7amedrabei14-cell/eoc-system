// ⏰ timeutils — أداة الزمن الموحّدة: العرض 12 ساعة حصراً (AM/PM) لكل السطوح،
// والآلة (التخزين/الإرسال/الحساب) تبقى 24 ساعة كما هي. موضع التحويل الواحد
// الذي تستهلكه كل نقطة عرض: النماذج، الجداول، البطاقات، الحوارات، الإشعارات،
// سجل المهمة، القوة البشرية، وتصدير الإكسيل.
// القاعدة: DD/MM/YYYY دائماً للعرض — لا تُفهم DD/MM/YYYY أبداً كـ MM/DD/YYYY.

const pad = (n) => String(Number(n)).padStart(2, '0');

// أي صيغة وقت (02:35 PM، 14:35، 12:00 AM، 12:5، 10:30:00) → HH:MM آلة 24 ساعة،
// أو '' إن لم تكن صالحة. يدعم مؤشرَي مركبة ص/م وعربية (AM/PM و ص/م).
export function normTime(t) {
  if (!t) return '';
  const m = String(t).trim().match(/(\d{1,2}):(\d{1,2})(?::\d{1,2})?\s*(AM|PM|ص|م)?/i);
  if (!m) return '';
  let h = Math.min(Math.max(+m[1], 0), 23);
  const mm = Math.min(Math.max(+m[2], 0), 59);
  const mer = (m[3] || '').toUpperCase();
  if (mer === 'PM' || mer === 'م') { if (h < 12) h += 12; }
  if (mer === 'AM' || mer === 'ص') { if (h === 12) h = 0; }
  return `${pad(h)}:${pad(mm)}`;
}

// 14:35 → '02:35 PM' — التحويل الوحيد للعرض (وقت فقط). يمرر القيمة كما هي عند الفشل.
export function formatTime12(t) {
  if (!t) return '';
  const n = normTime(t);
  if (!n) return String(t);
  const [h, mm] = n.split(':').map(Number);
  return `${pad(h % 12 || 12)}:${pad(mm)} ${h < 12 ? 'AM' : 'PM'}`;
}

// '2026-09-09 13:37' → '09/09/2026 01:37 PM'؛ تاريخ فقط يمرر DD/MM/YYYY.
// «تاريخ إنشاء المهمة» ومؤشرات السيرفر تقف هنا أيضاً.
export function formatDateTime12(val) {
  if (!val) return '-';
  const s = String(val).trim();
  if (!s) return '-';
  // (1) ISO قياسي من السيرفر: YYYY-MM-DD (أو مع وقت/ثواني/مؤشر) → DD/MM/YYYY
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::\d{1,2})?\s*(AM|PM|ص|م)?)?/i);
  if (iso) {
    const [, yy, mo, dd, hh, mm, mer] = iso;
    const datePart = `${pad(dd)}/${pad(mo)}/${yy}`;
    if (hh === undefined) return datePart;
    const timeToken = `${pad(hh)}:${pad(mm)}${mer ? ' ' + mer.toUpperCase() : ''}`;
    return `${datePart} ${formatTime12(timeToken)}`;
  }
  // (2) قيمة معروضة قبل التحويل بصيغة DD/MM/YYYY — تُحفَظ أجزاؤها؛ الوقت يُحوَّل لـ 12 ساعة
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::\d{1,2})?\s*(AM|PM|ص|م)?)?/i);
  if (dmy) {
    const [, dd, mo, yy, hh, mm, mer] = dmy;
    const datePart = `${pad(dd)}/${pad(mo)}/${yy}`;
    if (hh === undefined) return datePart;
    const timeToken = `${pad(hh)}:${pad(mm)}${mer ? ' ' + mer.toUpperCase() : ''}`;
    return `${datePart} ${formatTime12(timeToken)}`;
  }
  return s;
}

// 🔄 الوصول الآلي (المخفي) — قيم البدء للوقت في صيغة HH:MM (المعريف id للمكوّنات).
// يُصدَّر لوحدة التحويل فقط لكنه يدعم إعادة استخدامه في TimeInput عند الاقتضاء.
export const toMachine = normTime;