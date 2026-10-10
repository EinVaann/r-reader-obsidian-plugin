import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useReader, useReaderContext } from './context';
import type { ReaderState } from './store';
import { Icon } from '../react/Icon';

/** Minimum on-screen spacing between side-rail chapter dots; closer ones are dropped. */
const MIN_DOT_GAP_PX = 9;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Follow the reading position without re-rendering: progress changes on every
 * scroll frame, so `apply` writes the DOM directly from a store subscription.
 */
function useProgressEffect(apply: (p: ReaderState['progress']) => void): void {
  const { store } = useReaderContext();
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useLayoutEffect(() => {
    applyRef.current(store.getState().progress);
    return store.subscribe((s, prev) => {
      if (s.progress !== prev.progress) applyRef.current(s.progress);
    });
  }, [store]);
}

/**
 * Pointer scrubbing on a track: seeks while dragging, and keeps Obsidian's /
 * the OS's swipe gestures from firing while the finger is on the track.
 */
function useScrub(axis: 'x' | 'y', onScrub: (fraction: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Native listener: React's touch handlers are passive, so they can't preventDefault.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const start = (e: TouchEvent): void => e.stopPropagation();
    const move = (e: TouchEvent): void => {
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
    };
  }, []);

  const fractionAt = (e: ReactPointerEvent): number => {
    const rect = ref.current!.getBoundingClientRect();
    const size = axis === 'x' ? rect.width : rect.height;
    const offset = axis === 'x' ? e.clientX - rect.left : e.clientY - rect.top;
    return size > 0 ? clamp01(offset / size) : 0;
  };

  const handlers = {
    onPointerDown: (e: ReactPointerEvent) => {
      dragging.current = true;
      ref.current?.setPointerCapture(e.pointerId);
      onScrub(fractionAt(e));
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (!dragging.current) return;
      onScrub(fractionAt(e));
      e.stopPropagation();
    },
    onPointerUp: (e: ReactPointerEvent) => end(e),
    onPointerCancel: (e: ReactPointerEvent) => end(e),
  };
  const end = (e: ReactPointerEvent): void => {
    if (!dragging.current) return;
    dragging.current = false;
    e.stopPropagation();
    try {
      ref.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return { ref, dragging, handlers };
}

/** The top bar's "42%" indicator. */
export function PageIndicator() {
  const ref = useRef<HTMLDivElement>(null);
  useProgressEffect((p) => {
    if (ref.current) ref.current.textContent = p.total > 0 ? `${Math.round(p.fraction * 100)}%` : '…';
  });
  return <div ref={ref} className="rr-page-indicator" />;
}

/**
 * Bottom bar: "current / total" above a full-width scrub slider with a dot per
 * chapter. Built from divs — a native range input won't reliably stretch full
 * width in the mobile WebView.
 */
export function BottomBar() {
  const { actions } = useReaderContext();
  const milestones = useReader((s) => s.milestones);
  const labelRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  const paint = (fraction: number): void => {
    const f = clamp01(fraction);
    const pct = `${f * 100}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (thumbRef.current) thumbRef.current.style.left = pct;
    dotsRef.current?.querySelectorAll<HTMLElement>('.rr-slider-dot').forEach((d) => {
      d.classList.toggle('is-passed', Number(d.dataset.f) <= f);
    });
  };

  const scrub = useScrub('x', (f) => {
    paint(f);
    actions.seek(f);
  });

  useProgressEffect((p) => {
    last.current = p.fraction;
    if (labelRef.current) labelRef.current.textContent = p.total > 0 ? `${p.current} / ${p.total}` : '…';
    // Don't fight the finger while it drags the slider.
    if (!scrub.dragging.current) paint(p.fraction);
  });
  // New dots: mark the passed ones.
  useLayoutEffect(() => paint(last.current), [milestones]);

  return (
    <div className="rr-bottombar">
      <div ref={labelRef} className="rr-slider-label">
        …
      </div>
      <div ref={scrub.ref} className="rr-slider" aria-label="Reading progress" {...scrub.handlers}>
        <div className="rr-slider-track">
          <div ref={fillRef} className="rr-slider-fill" />
          <div ref={dotsRef} className="rr-slider-dots">
            {milestones.map((f, i) => (
              <div key={i} className="rr-slider-dot" data-f={f} style={{ left: `${f * 100}%` }} />
            ))}
          </div>
        </div>
        <div ref={thumbRef} className="rr-slider-thumb" />
      </div>
    </div>
  );
}

/**
 * Mobile side rail: a whole-book vertical scrubber with screen numbers, a dot
 * per chapter, and previous / next table-of-contents entry buttons.
 */
export function SideRail() {
  const { actions } = useReaderContext();
  const milestones = useReader((s) => s.milestones);
  const nav = useReader((s) => s.entryNav);
  const pageRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const [trackHeight, setTrackHeight] = useState(0);

  const paint = (fraction: number): void => {
    const f = clamp01(fraction);
    const pct = `${f * 100}%`;
    if (fillRef.current) fillRef.current.style.height = pct;
    if (thumbRef.current) thumbRef.current.style.top = pct;
    dotsRef.current?.querySelectorAll<HTMLElement>('.rr-rail-dot').forEach((d) => {
      d.classList.toggle('is-passed', Number(d.dataset.f) <= f + 1e-6);
    });
  };

  const scrub = useScrub('y', (f) => {
    paint(f);
    actions.seek(f);
  });

  // The track's height decides which dots are too close to draw.
  useLayoutEffect(() => {
    const el = scrub.ref.current;
    if (!el) return;
    const update = (): void => setTrackHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrub.ref]);

  const dots: number[] = [];
  if (trackHeight > 0) {
    const minGap = MIN_DOT_GAP_PX / trackHeight;
    let prev = -Infinity;
    for (const f of milestones) {
      if (f - prev < minGap) continue;
      prev = f;
      dots.push(f);
    }
  }

  useProgressEffect((p) => {
    last.current = p.fraction;
    if (pageRef.current) pageRef.current.textContent = p.total > 0 ? String(p.current) : '–';
    if (pagesRef.current) pagesRef.current.textContent = p.total > 0 ? String(p.total) : '–';
    if (!scrub.dragging.current) paint(p.fraction);
  });
  useLayoutEffect(() => paint(last.current), [milestones, trackHeight]);

  return (
    <div className="rr-rail">
      <button className="rr-rail-btn" aria-label="Previous entry" disabled={!nav.prev} onClick={() => actions.jumpEntry(-1)}>
        <Icon name="arrow-up-to-line" />
      </button>
      <div className="rr-rail-panel">
        <div ref={pageRef} className="rr-rail-num">
          –
        </div>
        <div ref={scrub.ref} className="rr-rail-track" aria-label="Reading progress" {...scrub.handlers}>
          <div className="rr-rail-line" />
          <div ref={fillRef} className="rr-rail-fill" />
          <div ref={dotsRef} className="rr-rail-dots">
            {dots.map((f, i) => (
              <div key={i} className="rr-rail-dot" data-f={f} style={{ top: `${f * 100}%` }} />
            ))}
          </div>
          <div ref={thumbRef} className="rr-rail-thumb" />
        </div>
        <div ref={pagesRef} className="rr-rail-num">
          –
        </div>
      </div>
      <button className="rr-rail-btn" aria-label="Next entry" disabled={!nav.next} onClick={() => actions.jumpEntry(1)}>
        <Icon name="arrow-down-to-line" />
      </button>
    </div>
  );
}
