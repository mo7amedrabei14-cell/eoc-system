import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// 🧯 أولاً: التقاط الأخطاء العام + الإبلاغ للسيرفر + حرس «الواجهة لم تكتمل».
//    (الملف بلا أي اعتماد على وحدات التطبيق — عشان يفضل شغال حتى لو فشلت.)
import { installClientErrorReporting, startMountWatchdog, reportClientError, showFatalScreen } from './clientErrorReport.js'
import RootErrorBoundary from './RootErrorBoundary.jsx'

installClientErrorReporting()
startMountWatchdog()

// ─────────────────────────────────────────────────────────────────────────────
// 🧱 لماذا تحميل التطبيق *ديناميكياً* وليس بـ import ثابت؟
// لأن الترتيب مصيري: الحالة اللي بنحمي منها هي «خطأ وقت تحميل وحدة في التطبيق»
// (مرجع قبل تعريفه — TDZ). لو التطبيق محمّل بـ import ثابت، الملفات كلها بتتدمج
// في *نفس* الحزمة (chunk)، ولو أي وحدة فيها رميت خطأ وقت التقييم، الحزمة كلها
// بتفشل قبل تنفيذ سطر واحد من كود الالتقاط ⇒ نرجع لنفس المشكلة: شاشة بيضا صامتة.
//
// الحزمة الديناميكية تُفصل دائماً في ملف مستقل: حزمة الدخول دي (React + الالتقاط)
// بتُقيَّم وتثبّت المستمعين أولاً، وبعدها تُحمَّل حزمة التطبيق (12 ألف سطر). فلو
// انهارت، الرفض يلتقطه المستمع ⇒ بلاغ للسيرفر + شاشة واضحة بالسبب الحقيقي.
// ─────────────────────────────────────────────────────────────────────────────
const mount = (App) => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </StrictMode>,
  )
}

try {
  const { default: App } = await import('./App.jsx')
  mount(App)
} catch (error) {
  const message = (error && error.message) || String(error)
  const stack = (error && error.stack) || ''
  reportClientError({ kind: 'module', message, stack })
  showFatalScreen({
    kind: 'module',
    title: 'تعذّر تحميل الواجهة',
    message: 'فشل تحميل ملفات التطبيق على هذا الجهاز، فما اشتغلت الشاشة. أعد التحميل — ولو تكرر، التفاصيل مسجلة على السيرفر وهي كافية لتحديد السبب.',
    detail: stack ? `${message}\n\n${stack}` : message,
    report: false, // سبق إبلاغه أعلاه
  })
}
