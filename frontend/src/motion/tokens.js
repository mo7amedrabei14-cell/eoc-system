// ═══════════════════════════════════════════════════════════════════════════
// 🎛️ طبقة الحركة — التوكنات (Motion Tokens)
// ---------------------------------------------------------------------------
// كل الثوابت التي تتحكم في «إحساس» النظام: نوابض (springs) بدل easing الخطي،
// وتنويعات (variants) للدخول المتتابع، ووصفات لمسية للمرور/الضغط.
//
// قواعد صارمة:
//  • transform + opacity فقط (لا width/height/top ⇒ لا reflow، لا jank).
//  • لا منطق أعمال هنا — توكنات بصرية صافية تُستهلك من الواجهات.
// ═══════════════════════════════════════════════════════════════════════════

// ── النوابض ────────────────────────────────────────────────────────────────
// الإحساس الافتراضي الفخم: سريع الاستجابة، بلا ارتداد مبالغ فيه.
export const SPRING = { type: 'spring', stiffness: 400, damping: 30 };
// لوحات/أغلفة كبيرة: نابض أهدأ حتى لا تبدو الحركة عصبية.
export const SPRING_SOFT = { type: 'spring', stiffness: 300, damping: 28 };
// عناصر صغيرة تنقر (شرائح/نقاط/شارات): أسرع قليلاً وأكثر «طقطقة».
export const SPRING_SNAP = { type: 'spring', stiffness: 520, damping: 34 };
// تحركات مكانية واسعة (FLIP): نابض متوازن يعطي انزلاقاً سلساً.
export const SPRING_LAYOUT = { type: 'spring', stiffness: 380, damping: 32 };

// ── Easing للمخارج القصيرة (الخروج لا يجب أن يُحسّ) ────────────────────────
export const EASE_OUT = [0.16, 1, 0.3, 1];
export const EXIT_FAST = { duration: 0.16, ease: EASE_OUT };

// ── دخول متتابع (Staggered Entrances) ──────────────────────────────────────
// الأب: يوزّع التأخير على أبنائه بـ 0.05s بين كل عنصر وآخر (Cascade).
export const staggerParent = (staggerChildren = 0.05, delayChildren = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren, delayChildren } },
});

// الابن الافتراضي: صعود ناعم + تلاشٍ — مشاهدة «تتالي» واضحة بلا قفز.
export const RISE = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: SPRING },
};

// صعود أنعم للصفوف/الجداول (إزاحة أقل = إحساس أخف في القوائم الطويلة).
export const RISE_SM = {
  hidden: { opacity: 0, y: 7 },
  show: { opacity: 1, y: 0, transition: SPRING },
};

// ظهور بنبضة (بطاقات KPI/شارات): يبدأ مصغّراً قليلاً ثم يستقر.
export const POP = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: SPRING_SNAP },
};

// انزلاق من الجانب (شرائح جانبية/صفوف إشعارات): إزاحة صغيرة على المحور الأفقي.
export const SLIDE_SIDE = {
  hidden: { opacity: 0, x: -10 },
  show: { opacity: 1, x: 0, transition: SPRING },
};

// ── انتقال المحتوى بين التبويبات (Page/Tab Transition) ─────────────────────
export const TAB_PAGE = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: SPRING_SOFT },
  exit: { opacity: 0, y: -6, transition: EXIT_FAST },
};

// ── الغطاء (Scrim) + اللوح (Panel) للطبقات العائمة ─────────────────────────
export const SCRIM = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: EASE_OUT } },
  exit: { opacity: 0, transition: EXIT_FAST },
};

export const PANEL_POP = {
  initial: { opacity: 0, y: -14, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: SPRING_SNAP },
  exit: { opacity: 0, y: -10, scale: 0.985, transition: EXIT_FAST },
};

// ── اللمس (Tactile Micro-Interactions) ─────────────────────────────────────
// hover: تكبير 1.01 + رفع خفيف (بصريات فقط) · tap: انضغاط 0.98.
export const TACTILE = {
  whileHover: { scale: 1.01 },
  whileTap: { scale: 0.98 },
  transition: SPRING,
};

export const TACTILE_LIFT = {
  whileHover: { y: -3, scale: 1.01 },
  whileTap: { scale: 0.98 },
  transition: SPRING,
};

export const TAP_ONLY = { whileTap: { scale: 0.98 }, transition: SPRING_SNAP };

// ── ميكرو-تفاعلات إضافية (Enhanced Micro-Interactions) ──────────────────────
// زر: ضغط نابضي حاد + لمعان
export const BTN_PRESS = {
  whileTap: { scale: 0.96 },
  transition: SPRING_SNAP,
};

// بطاقة: رفع عند المرور + توهج حافة
export const CARD_HOVER = {
  whileHover: { y: -4, scale: 1.005 },
  transition: SPRING_SOFT,
};

// توست: دخول دائري (clip-path) + تمدد
export const TOAST_IN = {
  initial: { opacity: 0, scale: 0.6, y: -16 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { ...SPRING_SNAP, duration: 0.55 } },
  exit: { opacity: 0, scale: 0.6, y: -10, transition: EXIT_FAST },
};

// مودال: قفز نابضي + خلفية تتلاشى
export const MODAL_ENTER = {
  initial: { opacity: 0, scale: 0.97, y: 26 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING_SOFT },
  exit: { opacity: 0, scale: 0.98, y: 14, transition: EXIT_FAST },
};

// القائمة المنبثقة: ازدهار قزحي (clip-path iris) + صعود
export const DROPDOWN_OPEN = {
  initial: { opacity: 0, scale: 0.96, y: -14, clipPath: 'circle(0% at 50% 0%)' },
  animate: { opacity: 1, scale: 1, y: 0, clipPath: 'circle(130% at 50% 0%)', transition: SPRING_SNAP },
  exit: { opacity: 0, scale: 0.98, y: -8, clipPath: 'circle(0% at 50% 0%)', transition: EXIT_FAST },
};

// حلقة التركيز: نبض خفيف عند الظهور
export const FOCUS_RING = {
  initial: { scale: 0.9, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: { ...SPRING, duration: 0.3 } },
};
