import { setIcon } from 'obsidian';

/** Minimum on-screen spacing between chapter dots; closer ones are dropped. */
const MIN_DOT_GAP_PX = 9;

export interface SideRailHandlers {
  /** Scrub to a 0..1 fraction of the whole book. */
  seek: (fraction: number) => void;
  /** Previous (-1) / next (1) table-of-contents entry. */
  jump: (dir: 1 | -1) => void;
}

/**
 * Mobile side rail: whole-book vertical scrubber with page numbers, a dot per
 * chapter, and prev/next table-of-contents entry buttons above and below.
 */
export class SideRail {
  readonly el: HTMLElement;
  private pageEl: HTMLElement;
  private pagesEl: HTMLElement;
  private track: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private dotsEl: HTMLElement;
  private upBtn: HTMLButtonElement;
  private downBtn: HTMLButtonElement;
  private dots: { fraction: number; el: HTMLElement }[] = [];
  private dotFractions: number[] = [];
  private fraction = 0;
  private dragging = false;

  constructor(parent: HTMLElement, private handlers: SideRailHandlers) {
    this.el = parent.createDiv({ cls: 'rr-rail' });

    this.upBtn = this.el.createEl('button', { cls: 'rr-rail-btn', attr: { 'aria-label': 'Previous entry' } });
    setIcon(this.upBtn, 'arrow-up-to-line');
    this.upBtn.onclick = () => this.handlers.jump(-1);

    const panel = this.el.createDiv({ cls: 'rr-rail-panel' });
    this.pageEl = panel.createDiv({ cls: 'rr-rail-num', text: '–' });
    this.track = panel.createDiv({ cls: 'rr-rail-track', attr: { 'aria-label': 'Reading progress' } });
    this.track.createDiv({ cls: 'rr-rail-line' });
    this.fill = this.track.createDiv({ cls: 'rr-rail-fill' });
    this.dotsEl = this.track.createDiv({ cls: 'rr-rail-dots' });
    this.thumb = this.track.createDiv({ cls: 'rr-rail-thumb' });
    this.pagesEl = panel.createDiv({ cls: 'rr-rail-num', text: '–' });

    this.downBtn = this.el.createEl('button', { cls: 'rr-rail-btn', attr: { 'aria-label': 'Next entry' } });
    setIcon(this.downBtn, 'arrow-down-to-line');
    this.downBtn.onclick = () => this.handlers.jump(1);

    this.wireTrack(this.track);
  }

  private wireTrack(track: HTMLElement): void {
    const seekFrom = (e: PointerEvent): void => {
      const rect = track.getBoundingClientRect();
      const f = rect.height > 0 ? Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) : 0;
      this.setFraction(f);
      this.handlers.seek(f);
    };
    track.addEventListener('pointerdown', (e: PointerEvent) => {
      this.dragging = true;
      track.setPointerCapture(e.pointerId);
      seekFrom(e);
      e.preventDefault();
      e.stopPropagation();
    });
    track.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.dragging) return;
      seekFrom(e);
      e.stopPropagation();
    });
    const end = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      e.stopPropagation();
      try { track.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    // Keep Obsidian's swipe gestures from firing while scrubbing.
    track.addEventListener('touchstart', (e: TouchEvent) => e.stopPropagation(), { passive: true });
    track.addEventListener('touchmove', (e: TouchEvent) => {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
  }

  /** Current / total screens of the book and the 0..1 position. */
  update(current: number, total: number, fraction: number): void {
    this.pageEl.setText(total > 0 ? String(current) : '–');
    this.pagesEl.setText(total > 0 ? String(total) : '–');
    // Don't fight the finger while dragging.
    if (!this.dragging) this.setFraction(fraction);
    // The track may have had no height when dots were first laid out.
    if (this.dots.length === 0 && this.dotFractions.length > 0) this.renderDots();
  }

  /** Chapter-start positions (0..1). */
  setDots(fractions: number[]): void {
    this.dotFractions = fractions;
    this.renderDots();
  }

  setNav(hasPrev: boolean, hasNext: boolean): void {
    this.upBtn.disabled = !hasPrev;
    this.downBtn.disabled = !hasNext;
  }

  private renderDots(): void {
    this.dotsEl.empty();
    this.dots = [];
    const h = this.track.clientHeight;
    if (h <= 0) return;
    const minGap = MIN_DOT_GAP_PX / h;
    let last = -Infinity;
    for (const fraction of this.dotFractions) {
      if (fraction - last < minGap) continue;
      last = fraction;
      const el = this.dotsEl.createDiv({ cls: 'rr-rail-dot' });
      el.style.top = `${fraction * 100}%`;
      this.dots.push({ fraction, el });
    }
    this.setFraction(this.fraction);
  }

  private setFraction(f: number): void {
    this.fraction = f;
    const pct = `${f * 100}%`;
    this.fill.style.height = pct;
    this.thumb.style.top = pct;
    for (const d of this.dots) d.el.toggleClass('is-passed', d.fraction <= f + 1e-6);
  }

  destroy(): void {
    this.el.remove();
  }
}
