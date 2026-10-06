// ═══════════════════════════════════════════════════════════════════════════
// 🧩 طبقة الحركة — العناصر الأولية (Motion Primitives)
// ---------------------------------------------------------------------------
// أغلفة صغيرة تُركَّب حول الواجهات الموجودة دون لمس أي منطق: تمرّر className
// وأي props كما هي إلى framer-motion، وتضيف فقط سلوك الحركة.
//
//   • MotionProvider → يضبط النابض الافتراضي ويحترم «تقليل الحركة» في النظام.
//   • StaggerGroup   → أب يوزّع الدخول المتتابع على أبنائه (staggerChildren).
//   • StaggerItem    → ابن يستقبل تنويعة الدخول (RISE / POP / ... تلقائياً).
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react';
import { motion, MotionConfig } from 'framer-motion';
import { SPRING, RISE } from './tokens';

/**
 * يغلّف التطبيق كله: كل حركة بلا transition صريح ترث النابض الفخم،
 * و«تقليل الحركة» في نظام التشغيل يُحترم تلقائياً (reducedMotion="user")
 * فيتحوّل كل شيء إلى تلاشٍ فوري بدل إزاحات.
 */
export function MotionProvider({ children }) {
  return (
    <MotionConfig reducedMotion="user" transition={SPRING}>
      {children}
    </MotionConfig>
  );
}

/**
 * أب الدخول المتتابع — motion.div بنفس className المطلوب.
 * initial/animate قابلان للتجاوز لأغلفة تُفتح لاحقاً (مثلاً مع whileInView).
 */
export function StaggerGroup({
  children,
  className = '',
  stagger = 0.05,
  delay = 0,
  initial = 'hidden',
  animate = 'show',
  ...rest
}) {
  return (
    <motion.div
      className={className}
      initial={initial}
      animate={animate}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger, delayChildren: delay } },
      }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/**
 * ابن داخل StaggerGroup — يستقبل التنويعة تلقائياً من الأب (variants inheritance).
 * خارج مجموعة متتابعة يبقى عنصراً ساكناً تماماً (بلا initial/animate ⇒ بلا حركة).
 */
export function StaggerItem({ children, className = '', variants = RISE, ...rest }) {
  return (
    <motion.div className={className} variants={variants} {...rest}>
      {children}
    </motion.div>
  );
}

/**
 * هل نحن في مقاس «دُرج الموبايل»؟ (نفس نقطة كسر mobile.css = 767px)
 * ---------------------------------------------------------------------
 * قيمة عرضية للحركة فقط: تُستخدم لتحديد هل الشريط الجانبي يُسحَب بـ transform
 * (موبايل) أم يبقى مثبّتاً (ديسكتوب). لا تقرأ ولا تكتب أي منطق — مجرد استعلام
 * وسائط يُشترك فيه عند نقطة الكسر نفسها التي يستخدمها CSS، فيبقى الاثنان متطابقين.
 */
export function useIsMobileDrawer(query = '(max-width: 767px)') {
  const read = () => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  );
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange); // متصفحات قديمة
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [query]);

  return matches;
}
