// verify_12h.mjs — تحقق نقي من وحدة الزمن الموحّدة timeutils.js:
// العرض 12 ساعة فقط (AM/PM) والآلة 24 ساعة. بلا متصفح — node مباشرة.
import { normTime, formatTime12, formatDateTime12 } from './frontend/src/timeutils.js';

let pass = 0, fail = 0;
const ok = (name, got, exp) => {
  const good = got === exp;
  if (good) pass++; else fail++;
  console.log(`[${good ? 'OK' : 'FAIL'}] ${name}: got=${JSON.stringify(got)} expected=${JSON.stringify(exp)}`);
};

// ── normTime: أي صيغة → آلة 24 ساعة ──
ok('normTime 02:35 PM → 14:35', normTime('02:35 PM'), '14:35');
ok('normTime 02:35 pm (حروف صغيرة) → 14:35', normTime('02:35 pm'), '14:35');
ok('normTime 12:00 AM → 00:00', normTime('12:00 AM'), '00:00');
ok('normTime 12:00 PM → 12:00', normTime('12:00 PM'), '12:00');
ok('normTime 14:35 → 14:35 (24س محفوظة)', normTime('14:35'), '14:35');
ok('normTime 12:5 → 12:05', normTime('12:5'), '12:05');
ok('normTime 10:30:00 → 10:30 (ثواني مُتجاهَلة)', normTime('10:30:00'), '10:30');
ok('normTime فارغ → \'\'', normTime(''), '');
ok('normTime ص-عربي 05:00 ص → 05:00', normTime('05:00 ص'), '05:00');
ok('normTime م-عربي 07:30 م → 19:30', normTime('07:30 م'), '19:30');

// ── formatTime12: عرض 12 ساعة فقط ──
ok('formatTime12 14:35 → 02:35 PM', formatTime12('14:35'), '02:35 PM');
ok('formatTime12 00:00 → 12:00 AM', formatTime12('00:00'), '12:00 AM');
ok('formatTime12 15:05 → 03:05 PM', formatTime12('15:05'), '03:05 PM');
ok('formatTime12 09:09 → 09:09 AM', formatTime12('09:09'), '09:09 AM');
ok('formatTime12 فارغ → \'\'', formatTime12(''), '');

// ── formatDateTime12: تاريخ + وقت → DD/MM/YYYY hh:mm AM/PM ──
ok('formatDateTime12 2026-09-09 13:37 → 09/09/2026 01:37 PM', formatDateTime12('2026-09-09 13:37'), '09/09/2026 01:37 PM');
ok('formatDateTime12 تاريخ فقط يمرر DD/MM/YYYY', formatDateTime12('2026-09-09'), '09/09/2026');
ok('formatDateTime12 2026-09-09 00:05 → 09/09/2026 12:05 AM', formatDateTime12('2026-09-09 00:05'), '09/09/2026 12:05 AM');
ok('formatDateTime12 2026-09-09 23:59 → 09/09/2026 11:59 PM', formatDateTime12('2026-09-09 23:59'), '09/09/2026 11:59 PM');
ok('formatDateTime12 2026-09-09 13:37:45 (ثواني) → 01:37 PM', formatDateTime12('2026-09-09 13:37:45'), '09/09/2026 01:37 PM');
ok('formatDateTime12 صيغة DD/MM/YYYY المحفوظة مع وقت → 12س', formatDateTime12('09/09/2026 13:37'), '09/09/2026 01:37 PM');
ok('formatDateTime12 قيمة مرسلة كـ DD/MM/YYYY hh:mm AM/PM لا تنقلب (PM محفوظ)', formatDateTime12('09/09/2026 01:37 PM'), '09/09/2026 01:37 PM');
ok('formatDateTime12 فارغ → -', formatDateTime12(''), '-');
ok('formatDateTime12 null → -', formatDateTime12(null), '-');

// ── عدم التنويع: قيمة معاد تنسيقها تُمرر دون قلب المؤشر ──
ok('formatTime12(formatTime12("14:35")) ثابت', formatTime12('02:35 PM'), '02:35 PM');

console.log(`\n===== TIMEUTILS (verify_12h): ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);