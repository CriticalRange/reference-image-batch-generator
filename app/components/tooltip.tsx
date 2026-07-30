'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  /** Delay before showing (ms). */
  delay?: number;
  /** Delay before hiding (ms) — allows slight fade-out room. */
  hideDelay?: number;
  disabled?: boolean;
  /** Extra class on the floating tooltip panel. */
  className?: string;
  /** Extra class on the trigger wrapper (e.g. absolute positioning). */
  triggerClassName?: string;
  maxWidth?: number;
};

type TooltipCoords = {
  top: number;
  left: number;
  side: TooltipSide;
};

const SHOW_DELAY_MS = 140;
const HIDE_DELAY_MS = 80;
const EXIT_MS = 160;
const VIEWPORT_PAD = 8;
const GAP = 8;

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = SHOW_DELAY_MS,
  hideDelay = HIDE_DELAY_MS,
  disabled = false,
  className,
  triggerClassName,
  maxWidth = 280
}: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const measure = useCallback((): TooltipCoords | null => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger || !tip) return null;

    const rect = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const placements: Record<TooltipSide, { top: number; left: number }> = {
      top: {
        top: rect.top - GAP - tipRect.height,
        left: rect.left + rect.width / 2 - tipRect.width / 2
      },
      bottom: {
        top: rect.bottom + GAP,
        left: rect.left + rect.width / 2 - tipRect.width / 2
      },
      left: {
        top: rect.top + rect.height / 2 - tipRect.height / 2,
        left: rect.left - GAP - tipRect.width
      },
      right: {
        top: rect.top + rect.height / 2 - tipRect.height / 2,
        left: rect.right + GAP
      }
    };

    let resolvedSide = side;
    let { top, left } = placements[side];

    // Flip when the preferred side overflows the viewport.
    if (side === 'top' && top < VIEWPORT_PAD) {
      resolvedSide = 'bottom';
      ({ top, left } = placements.bottom);
    } else if (side === 'bottom' && top + tipRect.height > vh - VIEWPORT_PAD) {
      resolvedSide = 'top';
      ({ top, left } = placements.top);
    } else if (side === 'left' && left < VIEWPORT_PAD) {
      resolvedSide = 'right';
      ({ top, left } = placements.right);
    } else if (side === 'right' && left + tipRect.width > vw - VIEWPORT_PAD) {
      resolvedSide = 'left';
      ({ top, left } = placements.left);
    }

    left = Math.min(Math.max(left, VIEWPORT_PAD), vw - tipRect.width - VIEWPORT_PAD);
    top = Math.min(Math.max(top, VIEWPORT_PAD), vh - tipRect.height - VIEWPORT_PAD);

    return { top, left, side: resolvedSide };
  }, [side]);

  const open = useCallback(() => {
    if (disabled || !content) return;
    clearTimers();
    showTimerRef.current = setTimeout(() => {
      setMounted(true);
      // Wait a frame so the element exists, then measure + fade in.
      requestAnimationFrame(() => {
        const next = measure();
        if (next) setCoords(next);
        requestAnimationFrame(() => setVisible(true));
      });
    }, delay);
  }, [clearTimers, content, delay, disabled, measure]);

  const close = useCallback(() => {
    clearTimers();
    hideTimerRef.current = setTimeout(() => {
      setVisible(false);
      exitTimerRef.current = setTimeout(() => {
        setMounted(false);
        setCoords(null);
      }, EXIT_MS);
    }, hideDelay);
  }, [clearTimers, hideDelay]);

  useLayoutEffect(() => {
    if (!mounted) return;

    const update = () => {
      const next = measure();
      if (next) setCoords(next);
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [mounted, measure, content]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, close]);

  const style: CSSProperties | undefined = coords
    ? {
        top: coords.top,
        left: coords.left,
        maxWidth
      }
    : {
        // Off-screen until first measure so size is available without flashing.
        top: -9999,
        left: -9999,
        maxWidth,
        visibility: 'hidden'
      };

  const tooltipNode =
    portalReady && mounted && content ? (
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        className={`ui-tooltip ui-tooltip--${coords?.side ?? side}${visible ? ' is-visible' : ''}${
          className ? ` ${className}` : ''
        }`}
        style={style}
      >
        {content}
      </div>
    ) : null;

  return (
    <>
      <span
        ref={triggerRef}
        className={['ui-tooltip-trigger', triggerClassName].filter(Boolean).join(' ')}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        aria-describedby={mounted ? tooltipId : undefined}
      >
        {children}
      </span>
      {tooltipNode ? createPortal(tooltipNode, document.body) : null}
    </>
  );
}

/** Field help: info icon with shared themed tooltip. */
export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip content={text} side="right" delay={100}>
      <button type="button" className="info-hint" aria-label={text}>
        <InfoIcon />
      </button>
    </Tooltip>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="8" r="1.2" fill="currentColor" />
      <path d="M12 11.3v5.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
