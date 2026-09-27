# -*- coding: utf-8 -*-
"""يستبدل نوافذ التأكيد القديمة بالتصميم الجديد (Aperture Dialog) في Dashboard.jsx"""
from pathlib import Path
import sys

SRC = Path(r"C:\Users\mo7am\OneDrive\Work\EOC System\frontend\src\Dashboard.jsx")

START = "// 🧩 اختيار تصدير السجل الشامل — بالتصنيفات (تصنيف/نوع/تفاصيل النشاط + النوع + اسم النوع) أو بدونها"
END   = "// 🎯 تنبيه الإجراءات — «Prism Slab»"

NEW = r"""// 🪟 Aperture Dialog — الهيكل الموحّد لكل نوافذ التأكيد
//    دخول: بتفتح بضباب + 4 أقواس بتتقفل على الأركان بالتتابع.
//    خروج: بتقفل بضباب وترجع لورا. ESC يقفل، والضغط على الخلفية يقفل.
function ApertureDialog({ show, tone = 'danger', title, message, onClose, children, actions, maxWidth = 470 }) {
  const [mounted, setMounted] = useState(show);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (show) { setMounted(true); setLeaving(false); return undefined; }
    if (!mounted) return undefined;
    setLeaving(true);
    const t = setTimeout(() => { setMounted(false); setLeaving(false); }, 240);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    if (!mounted) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className={`apx-layer apx-${tone} ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="apx-scrim" onClick={() => onClose && onClose()} />
      <div className="apx-panel" style={{ maxWidth }}>
        <span className="apx-bracket apx-b1" aria-hidden="true" />
        <span className="apx-bracket apx-b2" aria-hidden="true" />
        <span className="apx-bracket apx-b3" aria-hidden="true" />
        <span className="apx-bracket apx-b4" aria-hidden="true" />
        <div className="apx-head">
          <span className="apx-mark">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {tone === 'danger'
                ? <><path d="M12 3.2l9.4 16.3H2.6z" /><path d="M12 9v4.4" /><circle cx="12" cy="16.6" r="1.05" fill="currentColor" stroke="none" /></>
                : <path d="M4.6 12.4l5 5L19.6 7" />}
            </svg>
          </span>
          <h3 className="apx-title">{title}</h3>
        </div>
        {message && <p className="apx-msg">{message}</p>}
        {children}
        {actions && <div className="apx-actions">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}

// 🧩 اختيار تصدير السجل الشامل — بالتصنيفات أو بدونها
function ExportChoiceModal({ show, title = 'تنزيل السجل الشامل للمهام', message, onCancel, onWithCategories, onWithoutCategories }) {
  return (
    <ApertureDialog
      show={show}
      tone="calm"
      title={title}
      message={message}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="apx-btn apx-btn-ghost" onClick={onWithoutCategories}>بدون تصنيفات</button>
          <button type="button" className="apx-btn apx-btn-main" onClick={onWithCategories}>بالتصنيفات</button>
        </>
      }
    />
  );
}

// 📥 مُؤكِّد تنزيل سجل فردي
function DownloadConfirmModal({ show, title = 'تنزيل السجل', message = 'هل تود تحميل هذا السجل الفردي ؟', onCancel, onConfirm, confirmLabel = 'نعم', cancelLabel = 'إلغاء' }) {
  return (
    <ApertureDialog
      show={show}
      tone="calm"
      title={title}
      message={message}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="apx-btn apx-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="apx-btn apx-btn-main" onClick={onConfirm}>{confirmLabel}</button>
        </>
      }
    />
  );
}

// ⚠️ مُؤكِّد العمليات الخطيرة — نفس السلوك: زر معطّل أثناء التنفيذ + رمز تأكيد
function DangerConfirmModal({ show, title = 'تأكيد الحذف', message, onCancel, onConfirm, confirmLabel = 'نعم، احذف الكل', confirmationCode = '', onConfirmationCodeChange, showConfirmationInput = false }) {
  const [isProcessing, setIsProcessing] = useState(false);

  const codeOk = !showConfirmationInput || confirmationCode === '301014';

  const handleConfirm = async () => {
    if (isProcessing || !codeOk) return;
    setIsProcessing(true);
    try { await onConfirm(); } finally { setIsProcessing(false); }
  };

  const safeCancel = () => { if (!isProcessing) onCancel(); };

  return (
    <ApertureDialog
      show={show}
      tone="danger"
      title={title}
      message={message}
      onClose={safeCancel}
      actions={
        <>
          <button type="button" className="apx-btn apx-btn-ghost" onClick={safeCancel} disabled={isProcessing}>إلغاء</button>
          <button type="button" className="apx-btn apx-btn-main" onClick={handleConfirm} disabled={isProcessing || !codeOk}>
            {isProcessing ? 'جاري الحذف...' : confirmLabel}
          </button>
        </>
      }
    >
      {showConfirmationInput && (
        <input
          type="password"
          value={confirmationCode}
          onChange={(e) => onConfirmationCodeChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isProcessing && codeOk) handleConfirm(); }}
          placeholder="أدخل رمز التأكيد"
          autoComplete="new-password"
          name="clear_all_confirmation"
          className="apx-code"
        />
      )}
    </ApertureDialog>
  );
}"""

s = SRC.read_text(encoding="utf-8")

if "ApertureDialog" in s:
    sys.exit("⏭️ التعديل معمول بالفعل — مفيش حاجة تتغير.")

i = s.find(START)
j = s.find(END)
if i == -1 or j == -1 or j < i:
    sys.exit("❌ مش لاقي علامات البداية/النهاية — ابعتلي الملف تاني.")
if "animate-fade-in-up" not in s[i:j]:
    sys.exit("❌ المنطقة اللي لقيتها مش هي المطلوبة — وقفت من غير أي تغيير.")

backup = SRC.with_name("Dashboard.jsx.bak")
backup.write_text(s, encoding="utf-8")
SRC.write_text(s[:i] + NEW + "\n\n" + s[j:], encoding="utf-8")

print("✅ تم الاستبدال بنجاح")
print("   نسخة احتياطية: " + str(backup))
