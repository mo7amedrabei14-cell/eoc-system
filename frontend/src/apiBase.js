// 🔧 مصدر واحد لعنوان الـ API (module scope — لا يُعرَّف داخل مكوّن).
// 💡 Vite dev يستخدم البروكسي إلى localhost:8000 (vite.config.js)، والإنتاج
//    يستخدم الرابط المنشور. قابل للتغيير بـ VITE_API_BASE عند الحاجة.
//
// ملاحظة: `import.meta.env` موجود في Vite وغير موجود في Node ⇒ بنقراه ككائن
// فاضي بدل ما ننهار، عشان ملفات النواة (outbox/draftsStore/serverHealthCore)
// تفضل قابلة للاستيراد في الاختبارات (node --test) من غير متصفح.
const ENV = import.meta.env || {};

export const BASE = ENV.VITE_API_BASE !== undefined
  ? ENV.VITE_API_BASE
  : (ENV.DEV ? '' : 'https://eoc-system-qaol.vercel.app');

export default BASE;
