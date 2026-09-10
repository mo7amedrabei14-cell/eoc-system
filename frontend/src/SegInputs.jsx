// SegInputs.jsx — حقول تاريخ/وقت مقسّمة موحّدة للمشروع
// كل الأجزاءolec calc مدمجة هنا ل evitar circular import مع Dashboard.jsx

import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { normTime, formatTime12, formatDateTime12 } from './timeutils';

/* ─── مساعدات الوقت المساعدة (مُنسوخة من Dashboard.jsx为了避免 circular import) ─── */

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const hour12 = (hh24) => { const h = Math.min(Math.max(parseInt(hh24, 10) || 0, 0), 23); return h % 12 || 12; };
const meridian = (hh24) => (Math.min(Math.max(parseInt(hh24, 10) || 0, 0), 23) < 12 ? 'AM' : 'PM');
const to12Display = (clock) => {
  const [H, M] = (clock || '00:00').split(':');
  return `${String(hour12(H)).padStart(2, '0')}:${(M || '00')} ${meridian(H)}`;
};
const from12Wheel = (h12, mer) => {
  let h = Math.min(Math.max(parseInt(h12, 10) || 0, 1), 12) % 12;
  if (mer === 'PM' || mer === 'م') h += 12;
  return String(h).padStart(2, '0');
};
const flipMeridian = (clock, desiredMer) => {
  const [H, M] = (clock || '00:00').split(':');
  const h = Math.min(Math.max(parseInt(H, 10) || 0, 0), 23);
  const curMer = h < 12 ? 'AM' : 'PM';
  if (curMer === desiredMer) return clock;
  let h24 = desiredMer === 'PM' ? h + 12 : h - 12;
  if (h24 < 0) h24 += 24;
  if (h24 > 23) h24 -= 24;
  return `${String(h24).padStart(2, '0')}:${(M || '00')}`;
};
function nowTimeStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

/* ─── TimeWheel — عجلة لف رأسية (ساعات/دقائق) ─── */
const TimeWheel = ({ items, value, onChange, heightClass = 'h-28' }) => {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = items.indexOf(value);
    if (idx >= 0) {
      const ch = el.children[idx];
      if (ch && ch.scrollIntoView) ch.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [value, items]);
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-7 bg-gradient-to-b from-[var(--surface-2)] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-7 bg-gradient-to-t from-[var(--surface-2)] to-transparent" />
      <div ref={ref} className={`${heightClass} overflow-y-auto snap-y snap-mandatory px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>
        {items.map((it) => {
          const on = it === value;
          return (
            <button key={it} type="button" onClick={() => onChange(it)}
              className={`block h-8 w-12 mx-auto text-sm rounded-lg flex items-center justify-center transition snap-center
                ${on ? 'bg-[var(--accent)] text-white font-bold shadow-lg scale-[1.05]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'}`}>
              {it}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ─── Segment config ─── */
const DATE_SEGS = [
  { key: 'dd', len: 2, max: 31, ph: 'DD' },
  { key: 'mm', len: 2, max: 12, ph: 'MM' },
  { key: 'yyyy', len: 4, max: 9999, ph: 'YYYY' },
];
const TIME_SEGS = [
  { key: 'hh', len: 2, max: 12, ph: 'HH' },
  { key: 'mm', len: 2, max: 59, ph: 'MM' },
  { key: 'ampm', len: 2, max: null, ph: 'AM' },
];

const pad = (n) => String(n).padStart(2, '0');

/* ─── Segment parsing ─── */
function parseDateSegs(display) {
  const m = (display || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{1,4})$/);
  if (m) return [m[1].padStart(2, '0'), m[2].padStart(2, '0'), m[3].padStart(4, '0')];
  return ['','',''];
}
function parseTimeSegs(display) {
  const m = (display || '').match(/^(\d{1,2}):(\d{1,2})\s*(AM|PM|am|pm|ع|م|ص|م)?$/);
  if (m) {
    const mm = m[2].padStart(2, '0');
    let ampm = 'AM';
    const raw = (m[3] || '').toUpperCase();
    if (raw === 'PM' || raw === 'م' || raw === 'M') ampm = 'PM';
    return [m[1].padStart(2, '0'), mm, ampm];
  }
  return ['','','AM'];
}

/* ─── Keyboard: clamp helper ─── */
function clampSegInput(currentVal, digit, segIdx, segDefs) {
  const def = segDefs[segIdx];
  const isFirst = currentVal.length === 0;
  let next;
  if (isFirst) {
    next = digit;
  } else if (currentVal.length === 1 && def.len >= 2) {
    const tens = parseInt(currentVal + digit, 10);
    if (tens > def.max) return { val: digit, full: false }; // clamp & restart
    next = currentVal + digit;
  } else {
    next = currentVal + digit;
  }
  // Validate: first char of hours segment (12h)
  if (segDefs === TIME_SEGS && segIdx === 0) {
    if (next.length === 1 && parseInt(next, 10) > 1 && parseInt(next, 10) < 10) {
      // Single digit 2-9 → auto-advance (implicitly 02-09)
      return { val: next, full: true };
    }
  }
  return { val: next, full: next.length >= def.len };
}

/* ─── Keyboard: char → digit/ampm check ─── */
function isDigit(ch) { return ch >= '0' && ch <= '9'; }

/* ═══════════════════════════════════════════════════════════
   SEG DATE FIELD
   ═══════════════════════════════════════════════════════════ */
export const SegDateField = ({ value, onChange, defaultValue, id, className = '', disabled, max, ...props }) => {
  const initial = (value !== undefined && value !== null) ? value : (defaultValue || '');
  const initDisplay = initial ? formatDateTime12(initial).split(' ')[0] : '';
  const initSegs = parseDateSegs(initDisplay);

  const [segs, setSegs] = useState(initSegs);
  const [machine, setMachine] = useState(() => normTime(initial) ? initial : initial);
  const [activeSeg, setActiveSeg] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [view, setView] = useState(() => {
    const m = String(initial || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { y: +m[1], mo: +m[2] };
    const now = new Date(); return { y: now.getFullYear(), mo: now.getMonth() + 1 };
  });
  const [selDate, setSelDate] = useState(() => {
    const m = String(initial || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    return '';
  });
  const textRef = useRef(null);
  const popRef = useRef(null);
  const ownEmission = useRef(false);

  // Build display from segments
  const display = segs[0] || segs[1] || segs[2]
    ? `${segs[0] || '__'}/${segs[1] || '__'}/${segs[2] || '____'}`
    : '';

  // Complete check & emission
  useEffect(() => {
    const [dd, mm, yyyy] = segs;
    if (dd.length === 2 && mm.length === 2 && yyyy.length === 4) {
      const iso = `${yyyy}-${mm}-${dd}`;
      if (machine !== iso) {
        setMachine(iso);
        ownEmission.current = true;
        if (onChange) onChange({ target: { value: iso } });
        setTimeout(() => { ownEmission.current = false; }, 0);
      }
    }
  }, [segs]);

  // Controlled value sync
  useEffect(() => {
    if (value !== undefined && value !== null && !ownEmission.current) {
      const iso = String(value || '');
      const m = iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) setSegs([pad(+m[2]), pad(+m[3]), m[1]]);
      else setSegs(['','','']);
      setMachine(iso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const segDefs = DATE_SEGS;

  const setSeg = (idx, val) => {
    const next = [...segs]; next[idx] = val; setSegs(next);
  };

  const advanceSeg = (fromIdx) => {
    if (fromIdx < segDefs.length - 1) setActiveSeg(fromIdx + 1);
  };

  const retreatSeg = (fromIdx) => {
    if (fromIdx > 0) setActiveSeg(fromIdx - 1);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    const k = e.key;
    const si = activeSeg;

    if (k === 'ArrowRight') { e.preventDefault(); advanceSeg(si); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); retreatSeg(si); return; }
    if (k === 'Home') { e.preventDefault(); setActiveSeg(0); return; }
    if (k === 'End') { e.preventDefault(); setActiveSeg(segDefs.length - 1); return; }
    if (k === 'Tab') return; // let natural tab

    if (k === 'Backspace') {
      e.preventDefault();
      if (segs[si].length > 0) { setSeg(si, segs[si].slice(0, -1)); }
      else { retreatSeg(si); }
      return;
    }
    if (k === 'Delete') {
      e.preventDefault();
      setSeg(si, '');
      return;
    }

    if (isDigit(k)) {
      e.preventDefault();
      const { val, full } = clampSegInput(segs[si], k, si, segDefs);
      setSeg(si, val);
      if (full) advanceSeg(si);
      return;
    }
  };

  const handleInputClick = (e) => {
    // Map caret position to segment — select-and-replace
    const raw = e.target.value;
    const pos = e.target.selectionStart || 0;
    if (pos <= 2) setActiveSeg(0);
    else if (pos <= 5) setActiveSeg(1);
    else setActiveSeg(2);
    // Select all text for replace-on-type behavior
    e.target.select();
  };

  // ─── Calendar popup ───
  const GAP = 8, EDGE = 8;

  const positionPopup = () => {
    const el = textRef.current, pop = popRef.current;
    if (!el || !pop) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = r.bottom + GAP;
    if (top + ph > vh - EDGE) top = r.top - GAP - ph;
    if (top < EDGE) top = EDGE;
    let left = r.left;
    if (left + pw > vw - EDGE) left = vw - pw - EDGE;
    if (left < EDGE) left = EDGE;
    setPos({ top, left });
  };

  const openCalendar = () => {
    if (disabled) return;
    const el = textRef.current;
    if (el) { const r = el.getBoundingClientRect(); setPos({ top: r.bottom + GAP, left: r.left }); }
    setOpen(true);
  };

  useLayoutEffect(() => { if (open) positionPopup(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (textRef.current && textRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => positionPopup();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const pickDay = (dIso) => {
    setSelDate(dIso);
    const m = dIso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) setSegs([pad(+m[2]), pad(+m[3]), m[1]]);
    setView({ y: +m[1], mo: +m[2] });
    setOpen(false);
  };

  const changeMonth = (delta) => setView(v => {
    let mo = v.mo + delta, y = v.y;
    if (mo < 1) { mo = 12; y--; }
    if (mo > 12) { mo = 1; y++; }
    return { y, mo };
  });

  const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const WEEK = ['ح','ن','ث','ر','خ','ج','س'];
  const { y, mo } = view;
  const start = new Date(y, mo - 1, 1).getDay();
  const dim = new Date(y, mo, 0).getDate();
  const todayISO = `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}-${pad(new Date().getDate())}`;
  const cells = [];
  for (let i = 0; i < start; i++) cells.push(<span key={'e' + i} className="h-9" />);
  for (let d = 1; d <= dim; d++) {
    const iso = `${y}-${pad(mo)}-${pad(d)}`;
    const overMax = max && iso > max;
    const isSel = iso === selDate;
    const isToday = iso === todayISO;
    cells.push(
      <button key={d} type="button" disabled={overMax} onClick={() => pickDay(iso)}
        className={`h-9 w-9 text-xs rounded-lg transition flex items-center justify-center
          ${overMax ? 'opacity-25 cursor-not-allowed' : 'hover:bg-[var(--surface-hover)]'}
          ${isSel ? 'bg-[var(--accent)] text-white font-bold' : 'text-[var(--ink-2)]'}
          ${isToday && !isSel ? 'ring-1 ring-[var(--accent)]' : ''}`}>
        {d}
      </button>
    );
  }

  return (
    <>
      <div className="relative">
        <input
          ref={textRef}
          type="text"
          value={display}
          placeholder="DD/MM/YYYY"
          className={`${className} text-center pr-7 pl-7`}
          dir="ltr"
          onChange={() => {}} // no-op: segments manage display
          onKeyDown={handleKeyDown}
          onClick={handleInputClick}
          disabled={disabled}
          autoComplete="off"
          {...props}
        />
        {id && <input id={id} type="date" value={machine || ''} onChange={() => {}} tabIndex={-1} aria-hidden="true" disabled={disabled}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }} />}
        <button type="button" onClick={openCalendar} disabled={disabled}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-6 text-[var(--muted-2)] hover:text-white text-sm" title="فتح التقويم">📅</button>
      </div>
      {open && createPortal(
        <div ref={popRef} className="fixed z-[9999] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl p-3 w-[280px]"
          style={{ top: pos.top, left: pos.left, position: 'fixed' }}>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => changeMonth(-1)} className="w-7 h-7 rounded hover:bg-[var(--surface-hover)] text-[var(--ink-2)] text-lg leading-none">‹</button>
            <div className="text-sm font-bold text-[var(--ink-2)]">{MONTHS[mo - 1]} {y}</div>
            <button type="button" onClick={() => changeMonth(1)} className="w-7 h-7 rounded hover:bg-[var(--surface-hover)] text-[var(--ink-2)] text-lg leading-none">›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEK.map((w, i) => <div key={i} className="h-6 text-[10px] text-[var(--muted-2)] flex items-center justify-center">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">{cells}</div>
        </div>,
        document.body
      )}
    </>
  );
};

/* ═══════════════════════════════════════════════════════════
   SEG TIME FIELD
   ═══════════════════════════════════════════════════════════ */
export const SegTimeField = ({ value, onChange, defaultValue, id, className = '', disabled, ...props }) => {
  const initial = (value !== undefined && value !== null) ? value : (defaultValue || '');
  const initMachine = normTime(initial) || '';
  const initDisplay = initMachine ? to12Display(initMachine) : '';

  const [segs, setSegs] = useState(() => parseTimeSegs(initDisplay));
  const [machine, setMachine] = useState(initMachine);
  const [activeSeg, setActiveSeg] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [clock, setClock] = useState(initMachine || nowTimeStr());
  const [ampm, setAmpm] = useState(() => meridian(initMachine || nowTimeStr()));
  const textRef = useRef(null);
  const popRef = useRef(null);
  const ownEmission = useRef(false);

  const display = segs[0] || segs[1]
    ? `${segs[0] || '__'}:${segs[1] || '__'} ${segs[2] || 'AM'}`
    : '';

  // Complete check & emission
  useEffect(() => {
    const [hh, mm, ap] = segs;
    if (hh.length === 2 && mm.length === 2 && (ap === 'AM' || ap === 'PM')) {
      const machineH = from12Wheel(hh, ap);
      const iso = `${machineH}:${mm}`;
      if (machine !== iso) {
        setMachine(iso);
        ownEmission.current = true;
        if (onChange) onChange({ target: { value: iso } });
        setTimeout(() => { ownEmission.current = false; }, 0);
      }
    }
  }, [segs]);

  // Controlled value sync
  useEffect(() => {
    if (value !== undefined && value !== null && !ownEmission.current) {
      const n = normTime(value) || '';
      if (n) {
        setSegs(parseTimeSegs(to12Display(n)));
        setClock(n);
        setAmpm(meridian(n));
      } else {
        setSegs(['','','AM']); setClock(nowTimeStr()); setAmpm(meridian(nowTimeStr()));
      }
      setMachine(n);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const segDefs = TIME_SEGS;

  const setSeg = (idx, val) => {
    const next = [...segs]; next[idx] = val; setSegs(next);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    const k = e.key;
    const si = activeSeg;

    if (k === 'ArrowRight') { e.preventDefault(); if (si < segDefs.length - 1) setActiveSeg(si + 1); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); if (si > 0) setActiveSeg(si - 1); return; }
    if (k === 'Home') { e.preventDefault(); setActiveSeg(0); return; }
    if (k === 'End') { e.preventDefault(); setActiveSeg(2); return; }
    if (k === 'Tab') return;

    // AM/PM segment: ArrowUp/Down toggle, A/P direct
    if (si === 2) {
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const newAp = segs[2] === 'AM' ? 'PM' : 'AM';
        setSeg(2, newAp);
        return;
      }
      const ch = k.toUpperCase();
      if (ch === 'A' || ch === 'ص') { e.preventDefault(); setSeg(2, 'AM'); return; }
      if (ch === 'P' || ch === 'م') { e.preventDefault(); setSeg(2, 'PM'); return; }
      return;
    }

    if (k === 'Backspace') {
      e.preventDefault();
      if (segs[si].length > 0) setSeg(si, segs[si].slice(0, -1));
      else if (si > 0) setActiveSeg(si - 1);
      return;
    }
    if (k === 'Delete') { e.preventDefault(); setSeg(si, ''); return; }

    if (isDigit(k)) {
      e.preventDefault();
      const { val, full } = clampSegInput(segs[si], k, si, segDefs);
      setSeg(si, val);
      if (full && si < segDefs.length - 1) setActiveSeg(si + 1);
      return;
    }
  };

  const handleInputClick = (e) => {
    const pos = e.target.selectionStart || 0;
    if (pos <= 2) setActiveSeg(0);
    else if (pos <= 5) setActiveSeg(1);
    else setActiveSeg(2);
    e.target.select();
  };

  // ─── Time wheel popup ───
  const GAP = 8, EDGE = 8;

  const positionPopup = () => {
    const el = textRef.current, pop = popRef.current;
    if (!el || !pop) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = r.bottom + GAP;
    if (top + ph > vh - EDGE) top = r.top - GAP - ph;
    if (top < EDGE) top = EDGE;
    let left = r.left;
    if (left + pw > vw - EDGE) left = vw - pw - EDGE;
    if (left < EDGE) left = EDGE;
    setPos({ top, left });
  };

  const openPicker = () => {
    if (disabled) return;
    const el = textRef.current;
    if (el) { const r = el.getBoundingClientRect(); setPos({ top: r.bottom + GAP, left: r.left }); }
    setOpen(true);
  };

  useLayoutEffect(() => { if (open) positionPopup(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (textRef.current && textRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => positionPopup();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const applyWheel = () => {
    const hh = hour12((clock || '00').split(':')[0]);
    const mm = (clock || '00').split(':')[1] || '00';
    setSegs([pad(hh), mm, ampm]);
    setOpen(false);
  };

  const hh12 = String(hour12((clock || '00').split(':')[0])).padStart(2, '0');
  const mmWheel = (clock || '00').split(':')[1] || '00';

  return (
    <>
      <div className="relative">
        <input
          ref={textRef}
          type="text"
          value={display}
          placeholder="hh:mm AM"
          className={`${className} cursor-pointer text-center pr-7 pl-7`}
          dir="ltr"
          onChange={() => {}}
          onKeyDown={handleKeyDown}
          onClick={handleInputClick}
          disabled={disabled}
          autoComplete="off"
          {...props}
        />
        {id && <input id={id} type="time" value={machine || ''} onChange={() => {}} tabIndex={-1} aria-hidden="true" disabled={disabled}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }} />}
        <button type="button" onClick={openPicker} disabled={disabled}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-6 text-[var(--muted-2)] hover:text-white text-sm" title="فتح منتقي الوقت">🕐</button>
      </div>
      {open && createPortal(
        <div ref={popRef} className="fixed z-[9999] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl p-3 w-[280px]"
          style={{ top: pos.top, left: pos.left, position: 'fixed' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--muted-2)] font-bold">الوقت</span>
            <span className="text-lg font-bold text-[var(--ink-2)]" dir="ltr">{clock ? to12Display(clock) : '--:--'}</span>
          </div>
          <div className="flex items-start justify-center gap-2" dir="ltr">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-[var(--muted-2)] font-bold">ساعات</span>
              <TimeWheel items={HOURS} value={hh12}
                onChange={(h) => setClock(prev => `${from12Wheel(h, ampm)}:${(prev.split(':')[1] || '00')}`)} />
            </div>
            <span className="text-2xl font-bold text-[var(--accent)] mt-10 select-none">:</span>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-[var(--muted-2)] font-bold">دقائق</span>
              <TimeWheel items={MINUTES} value={mmWheel}
                onChange={(m) => setClock(prev => `${(prev.split(':')[0] || '00')}:${m}`)} />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-[var(--muted-2)] font-bold">الفترة</span>
              <div className="flex flex-col gap-1 mt-2">
                <button type="button" onClick={() => { setAmpm('AM'); setClock(flipMeridian(clock, 'AM')); }}
                  className={`px-2.5 py-1.5 text-[11px] rounded-md font-bold ${ampm === 'AM' ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'}`}>AM</button>
                <button type="button" onClick={() => { setAmpm('PM'); setClock(flipMeridian(clock, 'PM')); }}
                  className={`px-2.5 py-1.5 text-[11px] rounded-md font-bold ${ampm === 'PM' ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'}`}>PM</button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)]">
            <button type="button" onClick={applyWheel}
              className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white font-bold hover:opacity-90">تم</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

/* ═══════════════════════════════════════════════════════════
   SEG DATE-TIME FIELD
   ═══════════════════════════════════════════════════════════ */
export const SegDateTimeField = ({ value, onChange, defaultValue, id, className = '', disabled, max, ...props }) => {
  const initial = (value !== undefined && value !== null) ? value : (defaultValue || '');
  const initDisplay = initial ? formatDateTime12(initial) : '';
  // Parse "DD/MM/YYYY HH:MM AM" → 5 segments
  const initParsed = initDisplay.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})\s*(AM|PM)?$/i);
  const initSegs = initParsed
    ? [initParsed[1].padStart(2, '0'), initParsed[2].padStart(2, '0'), initParsed[3].padStart(4, '0'),
       initParsed[4].padStart(2, '0'), initParsed[5].padStart(2, '0'),
       (initParsed[6] || 'AM').toUpperCase()]
    : ['','','','','','AM'];

  const DT_SEGS = [
    { key: 'dd', len: 2, max: 31, ph: 'DD' },
    { key: 'mm', len: 2, max: 12, ph: 'MM' },
    { key: 'yyyy', len: 4, max: 9999, ph: 'YYYY' },
    { key: 'hh', len: 2, max: 12, ph: 'HH' },
    { key: 'mm2', len: 2, max: 59, ph: 'MM' },
    { key: 'ampm', len: 2, max: null, ph: 'AM' },
  ];

  const [segs, setSegs] = useState(initSegs);
  const [machine, setMachine] = useState(() => {
    const m = String(initial || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2}))/);
    return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}T${pad(+m[4])}:${m[5]}` : initial;
  });
  const [activeSeg, setActiveSeg] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const textRef = useRef(null);
  const popRef = useRef(null);
  const ownEmission = useRef(false);

  const display = `${segs[0] || '__'}/${segs[1] || '__'}/${segs[2] || '____'} ${segs[3] || '__'}:${segs[4] || '__'} ${segs[5] || 'AM'}`;

  useEffect(() => {
    const [dd, mm, yyyy, hh, mm2, ap] = segs;
    if (dd.length === 2 && mm.length === 2 && yyyy.length === 4 && hh.length === 2 && mm2.length === 2 && (ap === 'AM' || ap === 'PM')) {
      const machineH = from12Wheel(hh, ap);
      const iso = `${yyyy}-${mm}-${dd}T${machineH}:${mm2}`;
      if (machine !== iso) {
        setMachine(iso);
        ownEmission.current = true;
        if (onChange) onChange({ target: { value: iso } });
        setTimeout(() => { ownEmission.current = false; }, 0);
      }
    }
  }, [segs]);

  useEffect(() => {
    if (value !== undefined && value !== null && !ownEmission.current) {
      const s = String(value || '');
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{1,2}):(\d{2}))/);
      if (m) {
        const h24 = +m[4], mm = pad(+m[5]);
        const ap = h24 < 12 ? 'AM' : 'PM';
        const hh = pad(h24 % 12 || 12);
        setSegs([pad(+m[2]), pad(+m[3]), m[1], hh, mm, ap]);
      } else setSegs(['','','','','','AM']);
      setMachine(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const segDefs = DT_SEGS;

  const setSeg = (idx, val) => {
    const next = [...segs]; next[idx] = val; setSegs(next);
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    const k = e.key;
    const si = activeSeg;

    if (k === 'ArrowRight') { e.preventDefault(); if (si < segDefs.length - 1) setActiveSeg(si + 1); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); if (si > 0) setActiveSeg(si - 1); return; }
    if (k === 'Home') { e.preventDefault(); setActiveSeg(0); return; }
    if (k === 'End') { e.preventDefault(); setActiveSeg(5); return; }
    if (k === 'Tab') return;

    if (si === 5) { // AM/PM
      if (k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault(); setSeg(5, segs[5] === 'AM' ? 'PM' : 'AM'); return;
      }
      const ch = k.toUpperCase();
      if (ch === 'A' || ch === 'ص') { e.preventDefault(); setSeg(5, 'AM'); return; }
      if (ch === 'P' || ch === 'م') { e.preventDefault(); setSeg(5, 'PM'); return; }
      return;
    }

    if (k === 'Backspace') {
      e.preventDefault();
      if (segs[si].length > 0) setSeg(si, segs[si].slice(0, -1));
      else if (si > 0) setActiveSeg(si - 1);
      return;
    }
    if (k === 'Delete') { e.preventDefault(); setSeg(si, ''); return; }

    if (isDigit(k)) {
      e.preventDefault();
      const { val, full } = clampSegInput(segs[si], k, si, segDefs);
      setSeg(si, val);
      if (full && si < segDefs.length - 1) setActiveSeg(si + 1);
      return;
    }
  };

  const handleInputClick = (e) => {
    const pos = e.target.selectionStart || 0;
    if (pos <= 2) setActiveSeg(0);
    else if (pos <= 5) setActiveSeg(1);
    else if (pos <= 10) setActiveSeg(2);
    else if (pos <= 13) setActiveSeg(3);
    else if (pos <= 16) setActiveSeg(4);
    else setActiveSeg(5);
    e.target.select();
  };

  const GAP = 8, EDGE = 8;

  const positionPopup = () => {
    const el = textRef.current, pop = popRef.current;
    if (!el || !pop) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = r.bottom + GAP;
    if (top + ph > vh - EDGE) top = r.top - GAP - ph;
    if (top < EDGE) top = EDGE;
    let left = r.left;
    if (left + pw > vw - EDGE) left = vw - pw - EDGE;
    if (left < EDGE) left = EDGE;
    setPos({ top, left });
  };

  const openPicker = () => {
    if (disabled) return;
    const el = textRef.current;
    if (el) { const r = el.getBoundingClientRect(); setPos({ top: r.bottom + GAP, left: r.left }); }
    setOpen(true);
  };

  useLayoutEffect(() => { if (open) positionPopup(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (textRef.current && textRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onMove = () => positionPopup();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  const applyWheel = () => {
    // Read clock → set HH, MM, AM/PM segments
    const hh = hour12((clock || '00').split(':')[0]);
    const mm = (clock || '00').split(':')[1] || '00';
    setSegs(prev => [...prev.slice(0, 3), pad(hh), mm, ampm]);
    setOpen(false);
  };

  const [clock, setClock] = useState(() => {
    const m = String(initial || '').match(/T(\d{1,2}):(\d{2})/);
    if (m) return `${pad(+m[1])}:${m[2]}`;
    return nowTimeStr();
  });
  const [ampm, setAmpm] = useState(() => {
    const m = String(initial || '').match(/T(\d{1,2}):(\d{2})/);
    return m ? meridian(pad(+m[1])) : meridian(nowTimeStr());
  });

  // Sync clock/ampm from segs when user types
  useEffect(() => {
    const [,, , hh, mm, ap] = segs;
    if (hh && hh.length === 2 && mm && mm.length === 2) {
      setClock(`${from12Wheel(hh, ap)}:${mm}`);
      if (ap === 'AM' || ap === 'PM') setAmpm(ap);
    }
  }, [segs[3], segs[4], segs[5]]);

  const hh12 = String(hour12((clock || '00').split(':')[0])).padStart(2, '0');
  const mmWheel = (clock || '00').split(':')[1] || '00';

  return (
    <>
      <div className="relative">
        <input
          ref={textRef}
          type="text"
          value={display}
          placeholder="DD/MM/YYYY HH:MM AM"
          className={`${className} cursor-pointer pr-7 pl-7`}
          dir="ltr"
          onChange={() => {}}
          onKeyDown={handleKeyDown}
          onClick={handleInputClick}
          disabled={disabled}
          autoComplete="off"
          {...props}
        />
        {id && <input id={id} type="datetime-local" value={machine || ''} onChange={() => {}} tabIndex={-1} aria-hidden="true" disabled={disabled}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }} />}
        <button type="button" onClick={openPicker} disabled={disabled}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-6 text-[var(--muted-2)] hover:text-white text-sm" title="فتح منتقي الوقت">📅</button>
      </div>
      {open && createPortal(
        <div ref={popRef} className="fixed z-[9999] rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl p-3 w-[280px]"
          style={{ top: pos.top, left: pos.left, position: 'fixed' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--muted-2)] font-bold">الوقت</span>
            <span className="text-lg font-bold text-[var(--ink-2)]" dir="ltr">{clock ? to12Display(clock) : '--:--'}</span>
          </div>
          <div className="flex items-start justify-center gap-2" dir="ltr">
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-[var(--muted-2)] font-bold">ساعات</span>
              <TimeWheel items={HOURS} value={hh12}
                onChange={(h) => setClock(prev => `${from12Wheel(h, ampm)}:${(prev.split(':')[1] || '00')}`)} />
            </div>
            <span className="text-2xl font-bold text-[var(--accent)] mt-10 select-none">:</span>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-[var(--muted-2)] font-bold">دقائق</span>
              <TimeWheel items={MINUTES} value={mmWheel}
                onChange={(m) => setClock(prev => `${(prev.split(':')[0] || '00')}:${m}`)} />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-[var(--muted-2)] font-bold">الفترة</span>
              <div className="flex flex-col gap-1 mt-2">
                <button type="button" onClick={() => { setAmpm('AM'); setClock(flipMeridian(clock, 'AM')); }}
                  className={`px-2.5 py-1.5 text-[11px] rounded-md font-bold ${ampm === 'AM' ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'}`}>AM</button>
                <button type="button" onClick={() => { setAmpm('PM'); setClock(flipMeridian(clock, 'PM')); }}
                  className={`px-2.5 py-1.5 text-[11px] rounded-md font-bold ${ampm === 'PM' ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-[var(--surface-hover)]'}`}>PM</button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border)]">
            <button type="button" onClick={applyWheel}
              className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-[var(--accent)] text-white font-bold hover:opacity-90">تم</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
