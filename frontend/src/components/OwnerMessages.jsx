import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BASE } from '../apiBase';

function readToken() {
  try {
    return sessionStorage.getItem('access_token') || localStorage.getItem('access_token') || '';
  } catch {
    return '';
  }
}

async function apiRequest(path, options = {}) {
  const token = readToken();
  if (!token) throw new Error('الجلسة غير متاحة. أعد تسجيل الدخول.');

  const { timeoutMs = 12000, ...requestOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BASE + path, {
      ...requestOptions,
      signal: controller.signal,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
        ...(requestOptions.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : 'تعذر إكمال الطلب (HTTP ' + response.status + ').';
      throw new Error(detail);
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('انتهت مهلة الاتصال بالسيرفر بعد 12 ثانية. تحقق من اتصال الـBackend ثم اضغط «إعادة المحاولة».');
    }
    if (error instanceof TypeError) {
      throw new Error('تعذر الاتصال بالـBackend. تحقق من عنوان API وحالة السيرفر، ثم أعد المحاولة.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function textFor(lang, ar, en) {
  return lang === 'en' ? en : ar;
}

export default function OwnerMessages({ isOwner, lang = 'ar' }) {
  const [pendingMessages, setPendingMessages] = useState([]);
  const [acknowledgingId, setAcknowledgingId] = useState(null);
  const [ackError, setAckError] = useState('');
  const acknowledgedIds = useRef(new Set());
  const successfulSendTimer = useRef(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [recipients, setRecipients] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientError, setRecipientError] = useState('');
  const [recipientLoadAttempt, setRecipientLoadAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);

  useEffect(() => {
    const openComposer = () => {
      if (!isOwner) return;
      if (successfulSendTimer.current) {
        window.clearTimeout(successfulSendTimer.current);
        successfulSendTimer.current = null;
      }
      setComposerOpen(true);
      setFeedback('');
      setFeedbackError(false);
    };
    window.addEventListener('eoc-open-owner-message-composer', openComposer);
    return () => window.removeEventListener('eoc-open-owner-message-composer', openComposer);
  }, [isOwner]);

  useEffect(() => () => {
    if (successfulSendTimer.current) window.clearTimeout(successfulSendTimer.current);
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const loadPending = async () => {
      if (inFlight || !readToken()) return;
      inFlight = true;
      try {
        const data = await apiRequest('/api/owner-messages/pending');
        if (!active || !Array.isArray(data)) return;
        setPendingMessages(data.filter((item) => !acknowledgedIds.current.has(String(item.message_id))));
      } catch {
        // الشبكة أو الجلسة قد تكون غير جاهزة بعد؛ تظل أي رسالة معروضة كما هي.
      } finally {
        inFlight = false;
      }
    };
    loadPending();
    const interval = window.setInterval(loadPending, 8000);
    const onFocus = () => { if (!document.hidden) loadPending(); };
    const onOwnerMessagePending = () => loadPending();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('eoc-owner-message-pending', onOwnerMessagePending);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('eoc-owner-message-pending', onOwnerMessagePending);
    };
  }, []);

  useEffect(() => {
    if (!composerOpen || !isOwner) return undefined;
    let active = true;
    setLoadingRecipients(true);
    setRecipientError('');
    setRecipients([]);
    setSelectedIds([]);
    apiRequest('/api/owner-messages/users')
      .then((data) => {
        if (!active) return;
        if (!Array.isArray(data)) throw new Error('استجابة قائمة المستخدمين غير صحيحة.');
        setRecipients(data);
      })
      .catch((error) => {
        if (active) setRecipientError(error.message || 'تعذر تحميل قائمة المستخدمين.');
      })
      .finally(() => { if (active) setLoadingRecipients(false); });
    return () => { active = false; };
  }, [composerOpen, isOwner, recipientLoadAttempt]);

  const toggleRecipient = (userId) => {
    setSelectedIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  };
  const allSelected = recipients.length > 0 && selectedIds.length === recipients.length;
  const toggleAll = () => setSelectedIds(allSelected ? [] : recipients.map((user) => user.user_id));

  const sendMessage = async () => {
    if (!isOwner || sending || !messageText.trim() || selectedIds.length === 0) return;
    setSending(true);
    setFeedback('');
    setFeedbackError(false);
    try {
      const result = await apiRequest('/api/owner-messages', {
        method: 'POST',
        body: JSON.stringify({ message: messageText.trim(), recipient_ids: selectedIds }),
      });
      const deliveredCount = Number(result.recipient_count);
      if (!Number.isFinite(deliveredCount) || deliveredCount !== selectedIds.length) {
        throw new Error('استجابة الخادم لا تؤكد عدد المستلمين المتوقع. تحقق من حالة الرسالة قبل إعادة إرسالها.');
      }
      setFeedback(textFor(lang, 'تم إرسال الرسالة إلى ' + deliveredCount + ' مستخدم.', 'Message sent to ' + deliveredCount + ' user(s).'));
      setMessageText('');
      setSelectedIds([]);
      if (successfulSendTimer.current) window.clearTimeout(successfulSendTimer.current);
      successfulSendTimer.current = window.setTimeout(() => {
        setComposerOpen(false);
        successfulSendTimer.current = null;
      }, 850);
    } catch (error) {
      setFeedback(error.message || textFor(lang, 'فشل إرسال الرسالة.', 'Failed to send the message.'));
      setFeedbackError(true);
    } finally {
      setSending(false);
    }
  };

  const acknowledge = async (message) => {
    if (acknowledgingId !== null) return;
    const id = String(message.message_id);
    setAcknowledgingId(message.message_id);
    setAckError('');
    acknowledgedIds.current.add(id);
    try {
      await apiRequest('/api/owner-messages/' + encodeURIComponent(id) + '/acknowledge', { method: 'POST' });
      setPendingMessages((current) => current.filter((item) => String(item.message_id) !== id));
    } catch (error) {
      acknowledgedIds.current.delete(id);
      setAckError(error.message || textFor(lang, 'تعذر تأكيد الاستلام. حاول مرة أخرى.', 'Could not acknowledge this message. Try again.'));
    } finally {
      setAcknowledgingId(null);
    }
  };

  const currentMessage = pendingMessages[0] || null;
  const portalReady = typeof document !== 'undefined';

  return (
    <>
      {portalReady && currentMessage && createPortal(
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" dir={lang === 'en' ? 'ltr' : 'rtl'}>
          <section role="alertdialog" aria-modal="true" aria-labelledby="owner-message-title" aria-describedby="owner-message-body" className="w-full max-w-xl overflow-hidden rounded-3xl border border-[var(--accent)]/45 bg-[var(--surface)] text-[var(--ink)] shadow-2xl">
            <div className="border-b border-[var(--border)] bg-[var(--surface-2)] px-6 py-5">
              <p className="text-xs font-extrabold tracking-widest text-[var(--accent)]">{textFor(lang, 'رسالة نظام مهمة', 'IMPORTANT SYSTEM MESSAGE')}</p>
              <h2 id="owner-message-title" className="mt-2 text-xl font-black">{textFor(lang, 'رسالة من المالك', 'Message from the owner')}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{textFor(lang, 'من', 'From')} {currentMessage.sender_name || textFor(lang, 'المالك', 'Owner')}</p>
            </div>
            <div id="owner-message-body" className="whitespace-pre-wrap break-words px-6 py-6 text-base leading-8">{currentMessage.message}</div>
            {ackError && <p role="alert" className="mx-6 mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{ackError}</p>}
            <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-6 py-4">
              <button type="button" className="rounded-xl border border-[var(--border)] px-5 py-3 font-bold transition hover:bg-[var(--surface-hover)] disabled:opacity-60" disabled={acknowledgingId !== null} onClick={() => acknowledge(currentMessage)}>
                {acknowledgingId === currentMessage.message_id ? textFor(lang, 'جاري التأكيد…', 'Confirming…') : textFor(lang, 'شكرًا', 'Thank you')}
              </button>
              <button type="button" className="rounded-xl bg-[var(--accent)] px-6 py-3 font-bold text-white shadow-lg transition hover:brightness-110 disabled:opacity-60" disabled={acknowledgingId !== null} onClick={() => acknowledge(currentMessage)}>
                {acknowledgingId === currentMessage.message_id ? textFor(lang, 'جاري التأكيد…', 'Confirming…') : textFor(lang, 'تمام', 'Got it')}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {portalReady && composerOpen && isOwner && createPortal(
        <div className="fixed inset-0 z-[10040] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" dir={lang === 'en' ? 'ltr' : 'rtl'}>
          <section role="dialog" aria-modal="true" aria-labelledby="owner-message-compose-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
              <div>
                <p className="text-xs font-extrabold tracking-widest text-[var(--accent)]">{textFor(lang, 'إدارة النظام', 'SYSTEM CONTROL')}</p>
                <h2 id="owner-message-compose-title" className="mt-2 text-xl font-black">{textFor(lang, 'إرسال رسالة نظام', 'Send a system message')}</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">{textFor(lang, 'ستظل الرسالة ظاهرة لكل مستلم حتى يؤكد استلامها.', 'Each recipient sees the message until they acknowledge it.')}</p>
              </div>
              <button type="button" onClick={() => setComposerOpen(false)} className="shrink-0 rounded-xl border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-hover)]">{textFor(lang, 'إغلاق', 'Close')}</button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="text-sm font-bold" htmlFor="owner-message-recipients">{textFor(lang, 'المستلمون', 'Recipients')}</label>
                  <button type="button" onClick={toggleAll} disabled={loadingRecipients || recipients.length === 0} className="text-sm font-bold text-[var(--accent)] disabled:opacity-50">{allSelected ? textFor(lang, 'إلغاء تحديد الكل', 'Clear selection') : textFor(lang, 'اختيار الكل', 'Select all')}</button>
                </div>
                <div id="owner-message-recipients" className="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-2">
                  {loadingRecipients ? (
                    <p role="status" className="p-3 text-sm text-[var(--muted)]">{textFor(lang, 'جاري تحميل المستخدمين… (حتى 12 ثانية)', 'Loading users… (up to 12 seconds)')}</p>
                  ) : recipientError ? (
                    <div className="space-y-3 p-3">
                      <p role="alert" className="whitespace-pre-wrap text-sm text-red-600">{recipientError}</p>
                      <button type="button" onClick={() => setRecipientLoadAttempt((attempt) => attempt + 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold hover:bg-[var(--surface-hover)]">
                        {textFor(lang, 'إعادة المحاولة', 'Try again')}
                      </button>
                    </div>
                  ) : recipients.length === 0 ? (
                    <p className="p-3 text-sm text-[var(--muted)]">{textFor(lang, 'لا يوجد مستخدمون نشطون للاختيار.', 'No active users available.')}</p>
                  ) : recipients.map((user) => (
                    <label key={user.user_id} className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-[var(--surface-hover)]">
                      <input type="checkbox" checked={selectedIds.includes(user.user_id)} onChange={() => toggleRecipient(user.user_id)} className="h-4 w-4 accent-[var(--accent)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{user.full_name || user.username}</span>
                        <span className="block truncate text-xs text-[var(--muted)]">@{user.username}{user.role ? ' · ' + user.role : ''}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{textFor(lang, 'المحددون', 'Selected')}: {selectedIds.length}</p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-bold" htmlFor="owner-message-text">{textFor(lang, 'نص الرسالة', 'Message')}</label>
                <textarea id="owner-message-text" value={messageText} onChange={(event) => setMessageText(event.target.value)} rows={5} maxLength={3000} placeholder={textFor(lang, 'اكتب الرسالة التي يجب أن يقرأها المستخدم…', 'Write the message users need to read…')} className="block w-full min-w-0 max-w-full box-border field text-sm" style={{ width: '100%', minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', display: 'block' }} />
                <p className="mt-1 text-end text-xs text-[var(--muted)]">{messageText.length}/3000</p>
              </div>
              {feedback && <p role={feedbackError ? 'alert' : 'status'} className={'rounded-xl px-4 py-3 text-sm font-semibold ' + (feedbackError ? 'border border-red-500/30 bg-red-500/10 text-red-600' : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700')}>{feedback}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-[var(--border)] bg-[var(--surface-2)] px-6 py-4">
              <button type="button" onClick={() => setComposerOpen(false)} className="rounded-xl border border-[var(--border)] px-5 py-3 font-bold hover:bg-[var(--surface-hover)]">{textFor(lang, 'إلغاء', 'Cancel')}</button>
              <button type="button" onClick={sendMessage} disabled={sending || loadingRecipients || selectedIds.length === 0 || !messageText.trim()} className="rounded-xl bg-[var(--accent)] px-6 py-3 font-bold text-white shadow-lg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">{sending ? textFor(lang, 'جارٍ الإرسال…', 'Sending…') : textFor(lang, 'إرسال الرسالة', 'Send message')}</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
