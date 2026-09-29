/* ─────────────────────────────────────────────────────────────────────────────
   🛡️ حاجز الخطأ الجذري — أي انهيار في الرسم يعرض شاشة واضحة + يُبلّغ السيرفر
   ─────────────────────────────────────────────────────────────────────────────
   ملاحظة: ملف Dashboard.jsx فيه حاجز قديم باسم AppErrorBoundary غير مستخدَم في
   أي مكان (معرَّف فقط). هذا الملف هو المستخدَم فعلاً من main.jsx، وسُمّي باسم
   مختلف عمداً حتى لا يختلط بالقديم أثناء أي تعديل متزامن على Dashboard.jsx.

   ما يغطّيه هذا الحاجز: أخطاء الرسم/دورة الحياة/البناء داخل React.
   ما يغطّيه clientErrorReport.js: ما لا يلتقطه React إطلاقاً (فشل تحميل وحدة،
   أخطاء غير متزامنة، وعود مرفوضة) — والحالتان تعرضان *نفس* الشاشة.
   ───────────────────────────────────────────────────────────────────────────── */

import { Component } from 'react';
import { markAppMounted, reportClientError, showFatalScreen } from './clientErrorReport.js';

export class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    // 🟢 أول رسم ناجح ⇒ نوقف مؤقّت «لم يبدأ التطبيق» في clientErrorReport.js
    markAppMounted();
  }

  componentDidCatch(error, info) {
    try {
      const message = (error && error.message) || String(error);
      const stack = [error && error.stack, info && info.componentStack].filter(Boolean).join('\n\n');
      // 1) بلاغ للسيرفر (يبقى الأثر بعد قفل الجهاز)
      reportClientError({ kind: 'boundary', message, stack });
      // 2) شاشة بديلة واضحة بدل ما المستخدم يشوف فراغ
      showFatalScreen({
        kind: 'boundary',
        title: 'حصل خطأ في العرض',
        message: 'التطبيق واجه خطأ أثناء عرض الشاشة. جرّب إعادة التحميل — ولو تكرر، التفاصيل مسجلة على السيرفر وهي كافية لتحديد السبب.',
        detail: stack ? `${message}\n\n${stack}` : message,
        report: false, // سبق إبلاغه أعلاه — لا نكرر البلاغ
      });
    } catch { /* الحاجز نفسه لا يرمي أبداً */ }
  }

  render() {
    // الشاشة البديلة طبقة DOM فوق كل شيء، فلا داعي لرسم بديل داخل React
    return this.state.error ? null : this.props.children;
  }
}

export default RootErrorBoundary;
