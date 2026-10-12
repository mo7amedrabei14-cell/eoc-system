import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const OFFICIAL_OSIRIS_URL = 'https://osirisai.live/';

function resolveSelfHostedOsirisUrl() {
  const candidate = String(import.meta.env?.VITE_OSIRIS_URL || '').trim();
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    if (!['https:', 'http:'].includes(parsed.protocol)) return '';
    // The public demo explicitly blocks cross-origin framing. Never silently
    // fall back to it; only embed the separately hosted, frame-enabled instance.
    if (parsed.hostname === 'osirisai.live' || parsed.hostname.endsWith('.osirisai.live')) return '';
    return parsed.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

const OSIRIS_EMBED_URL = resolveSelfHostedOsirisUrl();

function OsirisAiView({ lang = 'ar' }) {
  const wrapRef = useRef(null);
  const cardRef = useRef(null);
  const refreshTimeoutRef = useRef(null);
  const refreshLockRef = useRef(false);
  const [frameH, setFrameH] = useState(null);
  const [serviceCheckKey, setServiceCheckKey] = useState(0);
  const [serviceStatus, setServiceStatus] = useState(OSIRIS_EMBED_URL ? 'checking' : 'unconfigured');
  const [frameKey, setFrameKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const isFullscreen = nativeFullscreen || fallbackFullscreen;
  const isArabic = lang === 'ar';
  const isLocalDevelopment = Boolean(import.meta.env?.DEV);
  const isLocalService = Boolean(
    OSIRIS_EMBED_URL
    && ['localhost', '127.0.0.1'].includes(new URL(OSIRIS_EMBED_URL).hostname),
  );

  useEffect(() => {
    if (!OSIRIS_EMBED_URL) return undefined;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    // An opaque no-cors response is enough: this probe checks reachability only.
    fetch(new URL('/api/health', OSIRIS_EMBED_URL).href, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(() => {
        if (active) setServiceStatus('ready');
      })
      .catch(() => {
        if (active) setServiceStatus('unavailable');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [serviceCheckKey]);

  useLayoutEffect(() => {
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const scroller = document.getElementById('main-scroll-container');
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      const parent = el.parentElement;
      const parentPad = parent ? (parseFloat(getComputedStyle(parent).paddingBottom) || 0) : 0;
      const available = bottom - el.getBoundingClientRect().top - parentPad;
      const next = Math.max(360, Math.floor(available));
      setFrameH(previous => (previous === next ? previous : next));
    };

    measure();
    window.addEventListener('resize', measure);
    const scroller = document.getElementById('main-scroll-container');
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (wrapRef.current) observer?.observe(wrapRef.current);
    if (scroller) observer?.observe(scroller);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      const active = document.fullscreenElement === cardRef.current;
      setNativeFullscreen(active);
      if (active) setFallbackFullscreen(false);
    };
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  useEffect(() => () => {
    if (refreshTimeoutRef.current !== null) window.clearTimeout(refreshTimeoutRef.current);
  }, []);

  useEffect(() => {
    const closeFallbackOnEscape = (event) => {
      if (event.key === 'Escape' && fallbackFullscreen) setFallbackFullscreen(false);
    };
    window.addEventListener('keydown', closeFallbackOnEscape);
    return () => window.removeEventListener('keydown', closeFallbackOnEscape);
  }, [fallbackFullscreen]);

  const refreshContent = () => {
    if (refreshLockRef.current) return;
    refreshLockRef.current = true;
    setRefreshing(true);
    setFrameLoaded(false);
    setFrameKey(value => value + 1);
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshLockRef.current = false;
      refreshTimeoutRef.current = null;
      setRefreshing(false);
    }, 1400);
  };

  const toggleFullscreen = async () => {
    const card = cardRef.current;
    if (!card) return;
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      return;
    }
    if (document.fullscreenElement === card) {
      try {
        await document.exitFullscreen();
      } catch {
        setFallbackFullscreen(false);
      }
      return;
    }
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        await document.exitFullscreen();
      }
      if (typeof card.requestFullscreen !== 'function') throw new Error('Fullscreen API unavailable');
      await card.requestFullscreen();
      setFallbackFullscreen(false);
    } catch {
      setFallbackFullscreen(true);
    }
  };

  const externalUrl = OSIRIS_EMBED_URL || OFFICIAL_OSIRIS_URL;
  const externalLabel = isArabic ? 'فتح OSIRIS في نافذة جديدة' : 'Open OSIRIS in a new tab';
  const refreshLabel = isArabic ? 'تحديث الخريطة' : 'Refresh map';
  const fullscreenLabel = isArabic
    ? (isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة')
    : (isFullscreen ? 'Exit full screen' : 'Full screen');
  const wrapperStyle = { height: frameH ? String(frameH) + 'px' : '70vh' };

  if (!OSIRIS_EMBED_URL || serviceStatus !== 'ready') {
    const missingConfiguration = !OSIRIS_EMBED_URL;
    const statusMessage = missingConfiguration
      ? (isArabic
        ? 'لم يتم إعداد عنوان نسخة OSIRIS المستضافة بعد. يجب تشغيل النسخة المستقلة والسماح بالتضمين من دومين EOC قبل عرض الخريطة هنا.'
        : 'The self-hosted OSIRIS URL is not configured yet. Start the standalone instance and allow embedding from the EOC origin before loading the map here.')
      : serviceStatus === 'checking'
        ? (isArabic ? 'جارٍ التحقق من اتصال خدمة OSIRIS…' : 'Checking the OSIRIS service connection…')
        : isLocalService
          ? (isArabic
            ? 'خدمة OSIRIS المحلية لا تستجيب على المنفذ 3001. شغّل حاويات OSIRIS ثم اضغط إعادة المحاولة.'
            : 'The local OSIRIS service is not responding on port 3001. Start the OSIRIS containers, then retry.')
          : (isArabic
            ? 'تعذر الاتصال بنسخة OSIRIS المستضافة. تحقق من عنوان VITE_OSIRIS_URL ومن أن الخدمة تعمل عبر HTTPS.'
            : 'The self-hosted OSIRIS instance is unreachable. Check VITE_OSIRIS_URL and confirm the service is running over HTTPS.');
    return (
      <div ref={wrapRef} className="flex flex-col p-2 md:p-3 min-h-0" style={wrapperStyle} dir={isArabic ? 'rtl' : 'ltr'}>
        <section className="card-surface relative flex flex-1 min-h-0 items-center justify-center overflow-hidden rounded-3xl border border-[var(--border)] p-6 md:p-10">
          <div className="pointer-events-none absolute inset-0 opacity-80" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(199,0,0,.16), transparent 58%)' }} />
          <div className="relative z-10 flex max-w-xl flex-col items-center text-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--accent)]">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
              </svg>
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-[var(--ink)]">OSIRIS AI</h2>
            <p className="max-w-lg text-sm md:text-base leading-7 text-[var(--muted)]">{statusMessage}</p>
            {missingConfiguration && (
              <p className="text-xs leading-6 text-[var(--faint)]">
                {isArabic ? 'متغير الإعداد المطلوب: VITE_OSIRIS_URL' : 'Required build setting: VITE_OSIRIS_URL'}
              </p>
            )}
            {!missingConfiguration && isLocalDevelopment && isLocalService && serviceStatus === 'unavailable' && (
              <div className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-left" dir="ltr">
                <p className="mb-2 text-xs font-semibold text-[var(--muted)]">PowerShell — from repository root</p>
                <code className="block whitespace-pre-wrap break-all text-xs leading-6 text-[var(--ink)]">cd .\\deployment\\osiris-embed; docker compose up -d --build</code>
              </div>
            )}
            {!missingConfiguration && (
              <button
                type="button"
                disabled={serviceStatus === 'checking'}
                onClick={() => { setServiceStatus('checking'); setServiceCheckKey(value => value + 1); }}
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
              >
                {isArabic ? 'إعادة المحاولة' : 'Try again'}
              </button>
            )}
            <a
              href={OFFICIAL_OSIRIS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {isArabic ? 'فتح الموقع الرسمي خارج النظام' : 'Open official site externally'}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
              </svg>
            </a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="flex flex-col p-2 md:p-3 min-h-0" style={wrapperStyle} dir={isArabic ? 'rtl' : 'ltr'}>
      <div
        ref={cardRef}
        className={'card-surface relative flex-1 min-h-0 overflow-hidden rounded-3xl border border-[var(--border)] ' + (fallbackFullscreen ? 'fixed inset-0 z-[9999] h-screen w-screen !rounded-none !border-0' : '')}
      >
        <iframe
          key={frameKey}
          title="OSIRIS AI"
          src={OSIRIS_EMBED_URL}
          onLoad={() => setFrameLoaded(true)}
          className="absolute inset-0 h-full w-full border-0 bg-black"
          allow="fullscreen; clipboard-read; clipboard-write; camera; microphone"
          allowFullScreen
          loading="eager"
          referrerPolicy="strict-origin-when-cross-origin"
        />

        {!frameLoaded && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--surface)] text-[var(--muted)]" role="status" aria-live="polite">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" />
            <span className="text-sm">{isArabic ? 'جارٍ تحميل OSIRIS…' : 'Loading OSIRIS…'}</span>
          </div>
        )}

        <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={externalLabel}
            aria-label={externalLabel}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)]/90 px-3 py-1.5 text-xs font-bold text-[var(--ink)] shadow-[var(--shadow-1)] backdrop-blur-md transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
            </svg>
            {isArabic ? 'فتح خارج النظام' : 'Open externally'}
          </a>
          <button
            type="button"
            onClick={refreshContent}
            disabled={refreshing}
            title={refreshLabel}
            aria-label={refreshLabel}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)]/90 px-3 py-1.5 text-xs font-bold text-[var(--ink)] shadow-[var(--shadow-1)] backdrop-blur-md transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            <svg className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
            </svg>
            {isArabic ? 'تحديث' : 'Refresh'}
          </button>
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          title={fullscreenLabel}
          aria-label={fullscreenLabel}
          aria-pressed={isFullscreen}
          className="absolute right-3 top-3 z-30 inline-flex items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)]/90 px-3 py-1.5 text-xs font-bold text-[var(--ink)] shadow-[var(--shadow-1)] backdrop-blur-md transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {isFullscreen ? (
              <>
                <path d="M8 3v5H3M16 3v5h5M3 16h5v5M21 16h-5v5" />
              </>
            ) : (
              <>
                <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" />
              </>
            )}
          </svg>
          {fullscreenLabel}
        </button>
      </div>
    </div>
  );
}

export default OsirisAiView;
