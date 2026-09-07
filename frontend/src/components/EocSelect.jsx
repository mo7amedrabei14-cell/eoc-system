import { useState, useEffect, useMemo, useLayoutEffect, useRef, Children } from 'react';
import { createPortal } from 'react-dom';

// ═══════════════════════════════════════════════════════════════════════════
// EocSelect — بديل فاخر لـ <select> الأصلي في نظام الإدارة
// ----------------------------------------------------------------------
// • الغلاف (shell) = تحكّم مرئي بالكامل (أنيميشن المذنّب عند التركيز/الفتح،
//   جولة 180° للسهم، تلوين الخيار المحدد). الدعم: Light/Dark + RTL/LTR.
// • داخله <select> حقيقي شفّاف يحتفظ بنفس id وبنفس الخيارات، حتّى تظل كل
//   منطق القراءة يعمل كما هو: getElementById(id)?.value و options[i] و
//   getSelectedOptionSourceText — صفر تغيير في منطق الأعمال أو القيم.
// • القائمة تُنقل (portal) إلى document.body بتموضع fixed حتّى لا تُقتطع
//   داخل أي حاوية overflow-hidden / overflow-x-auto.
// • واجهة الخصائص = مجموعة خاصة بـ <select> الأصلي (id, name, value,
//   defaultValue, onChange, onKeyDown, disabled, children) تُمرَّر حرفياً
//   للـ select الحقيقي، مع إضافتي: className → للغلاف، variant = field/cell/toolbar.
// ═══════════════════════════════════════════════════════════════════════════

const EocSelect = ({
  children,
  className = '',
  variant = 'field',
  value,          // محكوم (controlled)
  defaultValue,   // غير محكوم
  onChange,
  onKeyDown,
  disabled = false,
  ...nativeProps  // id, name, required, ... → تصل للـ select الحقيقي
}) => {
  const rootRef = useRef(null);
  const nativeRef = useRef(null);
  const menuRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(-1);
  const suppressClick = useRef(false);

  const isControlled = value !== undefined;

  // استخراج الخيارات من أبناء الـ <option> — نفس النصوص التي يعرضها الـ select
  const options = useMemo(
    () =>
      Children.toArray(children)
        .filter((c) => c && typeof c === 'object' && c.type === 'option')
        .map((c) => {
          const p = c.props || {};
          const text = String(Children.toArray(p.children).join('') ?? '');
          return {
            // option بدون value => قيمته نصّها (سلوك native أصيل)
            value: p.value !== undefined ? p.value : text,
            text,
            disabled: !!p.disabled,
            i18nSource: p['data-i18n-source'],
          };
        }),
    [children]
  );

  const currentValue = isControlled ? value : val;
  const selectedIndex = options.findIndex((o) => String(o.value) === String(currentValue));

  // النص المعروض في الغلاف
  let labelText = '';
  let labelEmpty = false;
  if (selectedIndex >= 0) {
    labelText = options[selectedIndex].text;
    labelEmpty = options[selectedIndex].disabled && String(options[selectedIndex].value) === '';
  } else if (String(currentValue) !== '') {
    // قيمة حقيقية لم يصل خيارها بعد (مثلاً مسارات مخصصة تُحمَّل لاحقاً) — نعرضها نصّاً
    labelText = String(currentValue);
  } else {
    const ph = options.find((o) => o.disabled && String(o.value) === '');
    labelText = ph ? ph.text : '';
    labelEmpty = true;
  }

  // مزامنة العرض مع قيمة الـ select الحقيقي — تدعم تحميل defaultValue غير المتزامن.
  // نتّبع التغيير فقط عندما تتغيّر قيمة defaultValue نفسها (عبر ref)، ولن نشغّل
  // الإعادة إلا عند تغيّر الأطفال فعلاً — كي لا يستعيد اختيار المستخدم تلقائيًّا
  // عند أي إعادة رسم من الأب (Search/typing/etc).
  const lastDefault = useRef();
  useLayoutEffect(() => {
    const n = nativeRef.current;
    if (!n || isControlled) return;
    if (lastDefault.current !== defaultValue) {
      lastDefault.current = defaultValue;
      if (defaultValue !== undefined) {
        const found = options.some((o) => String(o.value) === String(defaultValue));
        if (found) n.value = defaultValue; // تبني القيمة بمجرد توفر خيارها
      }
    }
    setVal(n.value !== undefined ? n.value : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue, value, isControlled, options]);

  // تموضع القائمة عند فتحها (تفتح للأسفل، وتقلب للأعلى قرب نهاية الشاشة)
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    const dir = getComputedStyle(rootRef.current).direction || 'rtl';
    const vw = window.innerWidth;
    const maxW = Math.min(340, vw - 16);
    const maxMenuH = Math.min(300, window.innerHeight * 0.7);
    const openUp = window.innerHeight - rect.bottom < maxMenuH + 12;

    // top/bottom مشتركان للاتجاهين؛ الاختلاف الوحيد هو إرساء الالتصاق (يمين/يسار)
    const style = {
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      left: dir === 'rtl' ? undefined : Math.min(Math.max(rect.left, 8), vw - maxW),
      right: dir === 'rtl' ? Math.min(Math.max(vw - rect.right, 8), vw - maxW) : undefined,
    };
    setPos({ minW: rect.width, maxW, openUp, ...style });
  }, [open]);

  // إغلاق عند الضغط خارج الغلاف/القائمة، أو عند التمرير أو تغيير حجم النافذة
  useEffect(() => {
    if (!open) return undefined;
    const close = () => { setOpen(false); setActive(-1); };
    const onDocPointerDown = (e) => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (root?.contains(e.target) || menu?.contains(e.target)) return;
      close();
    };
    // 💡 الموبايل: التمرير داخل قائمة الخيارات نفسها (لفّ الإصبع للوصول لخيار أبعد)
    // كان يقفل القائمة لأن مستمع scroll يلتقط بالمرور أي تمرير حدث داخل القائمة
    // المنبوذة (scroll لا يتبث نحو window، لكن الالتقاط في طور السقوط يصل إليها).
    // الحل الجذري: على الأجهزة التي مؤشرها الأساسي لمس (pointer: coarse) لا نُغلق
    // إلا عند التمرير خارج القائمة (الخلفية/الصفحة)؛ التمرير داخل القائمة يبقيها
    // مفتوحة وقائمة الخيارات كلها في متناول الإصبع.
    // على سطح المكتب (مؤشر أساسي دقيق) السلوك يبقى حرفياً كما هو الآن دون أي تغيير.
    const onScroll = (e) => {
      const menu = menuRef.current;
      const isCoarsePrimary = window.matchMedia('(pointer: coarse)').matches;
      if (isCoarsePrimary && menu && e.target instanceof Node && menu.contains(e.target)) return;
      close();
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const closeMenu = () => { setOpen(false); setActive(-1); };
  const openMenu = () => { if (disabled) return; setActive(selectedIndex); setOpen(true); };
  const toggleOpen = () => { if (disabled) return; if (open) closeMenu(); else openMenu(); };

  const commit = (opt) => {
    if (!opt || opt.disabled) return; // خيار «اختر...» غير قابل للاختيار
    const n = nativeRef.current;
    if (!n) return;
    n.value = opt.value;
    if (!isControlled) setVal(String(opt.value));
    onChange?.({
      target: n,
      currentTarget: n,
      preventDefault: () => {},
      stopPropagation: () => {},
    });
    closeMenu();
  };

  const handlePointerDown = (e) => {
    if (disabled) return;
    e.preventDefault(); // يمنع قائمة النظام الأصلية + تكبير iOS
    if (e.pointerType === 'touch') {
      // اللمس: نفتح فورًا في pointerdown ولا نركز على الـ select (يُحضر عجلة iOS)
      toggleOpen();
      suppressClick.current = true; // اللمس: click لاحق لن يقلب مرة أخرى
    } else {
      nativeRef.current?.focus(); // الماوس: التركيز + click يفتح
      suppressClick.current = false;
    }
  };

  const handleClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    toggleOpen();
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const { key } = e;
    if (open) {
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => {
          let n = a < 0 ? (selectedIndex >= 0 ? selectedIndex : 0) : a;
          const dir = key === 'ArrowDown' ? 1 : -1;
          n += dir;
          while (n >= 0 && n < options.length && options[n].disabled) n += dir;
          return Math.min(Math.max(n, 0), options.length - 1);
        });
      } else if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        if (active >= 0 && active < options.length) commit(options[active]);
      } else if (key === 'Escape' || key === 'Tab') {
        closeMenu();
      }
    } else if (key === 'ArrowDown' || key === 'ArrowUp' || key === ' ' || key === 'Enter') {
      e.preventDefault();
      openMenu();
    }
  };

  return (
    <div
      ref={rootRef}
      className={`eoc-select eoc-select--${variant}${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''} ${className}`}
    >
      <select
        ref={nativeRef}
        className="eoc-select__native"
        disabled={disabled}
        value={isControlled ? value : undefined}
        defaultValue={isControlled ? undefined : defaultValue}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...nativeProps}
      >
        {children}
      </select>

      <div className="eoc-select__value" aria-hidden="true">
        <span className={`eoc-select__label${labelEmpty ? ' is-empty' : ''}`}>{labelText}</span>
        <svg className="eoc-select__caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={`eoc-select__menu${pos?.openUp ? ' is-up' : ''}`}
            role="presentation"
            aria-hidden="true"
            style={pos ? { minWidth: pos.minW, maxWidth: pos.maxW, left: pos.left, right: pos.right, top: pos.top, bottom: pos.bottom } : undefined}
          >
            {options.map((o, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                className={[
                  'eoc-select__option',
                  i === selectedIndex ? 'is-selected' : '',
                  o.disabled ? 'is-placeholder' : '',
                  i === active ? 'is-active' : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(o)}
              >
                <svg className="eoc-select__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="eoc-select__option__text">{o.text}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};

export default EocSelect;