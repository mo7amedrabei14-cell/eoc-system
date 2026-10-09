import { useEffect, useState } from 'react';
import { WORKING_EVENTS } from '../workingToast';

export default function WorkingToast() {
  const [text, setText] = useState('');

  useEffect(() => {
    const onShow = (event) => setText((event.detail && event.detail.text) || 'جاري التنفيذ…');
    const onHide = () => setText('');
    window.addEventListener(WORKING_EVENTS.SHOW, onShow);
    window.addEventListener(WORKING_EVENTS.HIDE, onHide);
    return () => {
      window.removeEventListener(WORKING_EVENTS.SHOW, onShow);
      window.removeEventListener(WORKING_EVENTS.HIDE, onHide);
    };
  }, []);

  if (!text) return null;

  return (
    <div className="fixed bottom-5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 z-[200] pointer-events-none">
      <div className="working-pill">
        <span className="working-orbit" aria-hidden="true"><i /><i /></span>
        <span className="working-text">{text}</span>
        <span className="working-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="working-line" aria-hidden="true" />
      </div>
    </div>
  );
}
