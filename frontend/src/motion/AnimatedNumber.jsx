// ═══════════════════════════════════════════════════════════════════════════
// 🔢 طبقة الحركة — العدّاد النابض (Animated Number / count-up)
// ---------------------------------------------------------------------------
// يغلّف أي قيمة معروضة ويجعلها «تعدّ» بنابض بدل القفز الحاد، دون أن يغيّر
// النص المعروض إطلاقاً:
//   • أرقام (1234 / 1,234 / 5.2) → تنزلق من قيمتها الحالية إلى الجديدة.
//   • تواريخ ونصوص وشرطات (2026-10-06 / —) → تُعرض كما هي بلا أي تحريك.
//   • الفواصل والكسور ولواحق الوحدة («5.2 ريختر») تُحفظ حرفياً.
//
// قواعد صارمة:
//  • لا منطق أعمال: لا يقرأ حالة ولا يكتبها — يستقبل قيمة ويعرضها.
//  • الحركة على مستوى الرقم النصي فقط (لا تخطيط، لا قياس).
//  • احترام «تقليل الحركة» في نظام التشغيل ⇒ عرض مباشر بلا عدّ.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { SPRING } from './tokens';

// مطابقة كاملة: بادئة غير رقمية + رقم أساسي (فواصل آلاف/كسور اختيارية) + لاحقة
// غير رقمية. أي نص لا يطابق كاملاً (تاريخ، شرطة، كلمة) ⇒ يُعرض ساكناً.
const NUMBER_RE = /^([^0-9]*?)([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)([^0-9]*)$/;

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** يستخرج الرقم وهيكل تنسيقه، أو null إذا كانت القيمة غير رقمية بالكامل. */
function parseDisplay(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  const raw = String(value);
  if (!raw.trim()) return null;
  const m = NUMBER_RE.exec(raw);
  if (!m) return null;
  const [, prefix, core, suffix] = m;
  const target = Number(core.replace(/,/g, ''));
  if (!Number.isFinite(target)) return null;
  return {
    prefix,
    suffix,
    target,
    grouped: core.includes(','),
    decimals: core.includes('.') ? core.split('.')[1].length : 0,
  };
}

/** إعادة بناء النص بنفس فواصل/كسور القيمة الأصلية أثناء العدّ. */
function formatCount(current, meta) {
  const sign = current < 0 ? '-' : '';
  const fixed = Math.abs(current).toFixed(meta.decimals);
  let [int, frac] = fixed.split('.');
  if (meta.grouped) int = int.replace(/\B(?=([0-9]{3})+(?![0-9]))/g, ',');
  else if (int.length > 1) int = int.replace(/^0+(?=[0-9])/, '');
  return sign + int + (frac ? '.' + frac : '');
}

export function AnimatedNumber({ value, className = '' }) {
  const meta = useMemo(() => parseDisplay(value), [value]);
  const animated = !!meta && !REDUCED;
  const target = meta ? meta.target : 0;

  // النابض يبدأ من الصفر ⇒ أول ظهور يعدّ تصاعدياً، وأي تحديث ينزلق من القيمة
  // الحالية إلى الجديدة (صعوداً أو هبوطاً) بلا قفزة.
  const spring = useSpring(0, { stiffness: SPRING.stiffness, damping: SPRING.damping });

  useEffect(() => {
    if (!animated) return undefined;
    spring.set(target);
    return undefined;
  }, [target, animated, spring]);

  const text = useTransform(spring, (current) => (
    meta ? meta.prefix + formatCount(current, meta) + meta.suffix : ''
  ));

  if (!animated) {
    // تمرير حرفي 100%: نفس النص الذي كان سيُعرض قبل إضافة طبقة الحركة.
    return <span className={`inline-block tabular-nums ${className}`}>{value}</span>;
  }

  return <motion.span className={`inline-block tabular-nums ${className}`}>{text}</motion.span>;
}

export default AnimatedNumber;
