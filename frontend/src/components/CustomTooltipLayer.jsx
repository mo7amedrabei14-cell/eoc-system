import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const TOOLTIP_ID = 'eoc-custom-tooltip';
const MAX_TOOLTIP_WIDTH = 272;
const EDGE_GAP = 12;

function findTrigger(target) {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-sidebar-tooltip], [title]');
}

function getLabel(trigger) {
  return trigger.getAttribute('data-sidebar-tooltip')
    || trigger.getAttribute('title')
    || trigger.dataset.customTooltipTitle
    || '';
}

function getPlacement(trigger, direction) {
  const rect = trigger.getBoundingClientRect();
  const isSidebar = trigger.hasAttribute('data-sidebar-tooltip');

  if (isSidebar) {
    const side = rect.left + rect.width / 2 > window.innerWidth / 2 ? 'left' : 'right';
    return {
      placement: side,
      left: side === 'left' ? rect.left - 10 : rect.right + 10,
      top: Math.max(EDGE_GAP, Math.min(rect.top + rect.height / 2, window.innerHeight - EDGE_GAP)),
      direction,
    };
  }

  const width = Math.min(MAX_TOOLTIP_WIDTH, window.innerWidth - EDGE_GAP * 2);
  const centerX = rect.left + rect.width / 2;
  const left = Math.max(EDGE_GAP + width / 2, Math.min(centerX, window.innerWidth - EDGE_GAP - width / 2));
  const placement = rect.bottom + 56 <= window.innerHeight ? 'below' : 'above';

  return {
    placement,
    left,
    top: placement === 'below' ? rect.bottom + 8 : rect.top - 8,
    direction,
  };
}

export default function CustomTooltipLayer() {
  const [tooltip, setTooltip] = useState(null);
  const activeRef = useRef(null);

  useEffect(() => {
    const clearActive = () => {
      const active = activeRef.current;
      if (!active) return;

      activeRef.current = null;
      const { trigger, nativeTitle } = active;

      if (trigger.isConnected) {
        if (nativeTitle !== null && trigger.getAttribute('title') === '') {
          trigger.setAttribute('title', nativeTitle);
        }
        delete trigger.dataset.customTooltipTitle;
        const remainingDescriptions = (trigger.getAttribute('aria-describedby') || '')
          .split(/\s+/)
          .filter((id) => id && id !== TOOLTIP_ID);
        if (remainingDescriptions.length) trigger.setAttribute('aria-describedby', remainingDescriptions.join(' '));
        else trigger.removeAttribute('aria-describedby');
      }
      setTooltip(null);
    };

    const show = (event) => {
      if (event.type === 'pointerover' && event.pointerType === 'touch') return;
      if (event.type === 'focusin' && !event.target.matches?.(':focus-visible')) return;

      const trigger = findTrigger(event.target);
      if (!trigger) return;
      if (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget)) return;
      if (activeRef.current?.trigger === trigger) return;

      clearActive();
      const nativeTitle = trigger.getAttribute('title');
      const label = getLabel(trigger);
      if (!label.trim()) return;

      const describedBy = trigger.getAttribute('aria-describedby');
      if (nativeTitle !== null) {
        trigger.dataset.customTooltipTitle = nativeTitle;
        trigger.setAttribute('title', '');
      }
      const descriptions = new Set((describedBy || '').split(/\s+/).filter(Boolean));
      descriptions.add(TOOLTIP_ID);
      trigger.setAttribute('aria-describedby', [...descriptions].join(' '));

      const direction = document.documentElement.getAttribute('dir') || 'ltr';
      activeRef.current = { trigger, nativeTitle, describedBy };
      setTooltip({ trigger, label, ...getPlacement(trigger, direction) });
    };

    const hide = (event) => {
      const trigger = findTrigger(event.target);
      if (!trigger || trigger !== activeRef.current?.trigger) return;
      if (event.relatedTarget instanceof Node && trigger.contains(event.relatedTarget)) return;
      if (event.type === 'pointerout' && trigger.contains(document.activeElement)
        && document.activeElement.matches(':focus-visible')) return;
      if (event.type === 'focusout' && trigger.matches(':hover')) return;
      clearActive();
    };

    const clearOnViewportChange = () => clearActive();
    document.addEventListener('pointerover', show, true);
    document.addEventListener('pointerout', hide, true);
    document.addEventListener('focusin', show, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('scroll', clearOnViewportChange, true);
    window.addEventListener('resize', clearOnViewportChange);

    return () => {
      document.removeEventListener('pointerover', show, true);
      document.removeEventListener('pointerout', hide, true);
      document.removeEventListener('focusin', show, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('scroll', clearOnViewportChange, true);
      window.removeEventListener('resize', clearOnViewportChange);
      const active = activeRef.current;
      if (active?.trigger.isConnected) {
        if (active.nativeTitle !== null && active.trigger.getAttribute('title') === '') {
          active.trigger.setAttribute('title', active.nativeTitle);
        }
        delete active.trigger.dataset.customTooltipTitle;
        if (active.describedBy) active.trigger.setAttribute('aria-describedby', active.describedBy);
        else active.trigger.removeAttribute('aria-describedby');
      }
      activeRef.current = null;
    };
  }, []);

  if (!tooltip || !tooltip.trigger.isConnected) return null;

  return createPortal(
    <div
      id={TOOLTIP_ID}
      className="app-tooltip"
      data-placement={tooltip.placement}
      dir={tooltip.direction}
      role="tooltip"
      style={{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }}
    >
      {tooltip.label}
    </div>,
    document.body,
  );
}
