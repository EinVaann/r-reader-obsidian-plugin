import { setIcon } from 'obsidian';
import type { ChapterProgress } from '../types';

/** Above this many screens, dots are thinned to every Nth screen. */
const MAX_DOTS = 40;

export interface SideRailHandlers {
  /** Scrub to a 0..1 fraction of the current chapter. */
  seek: (fraction: number) => void;
  /** Previous (-1) / next (1) chapter. */
  jump: (dir: 1 | -1) => void;
}

/**
 * Mobile side rail: chapter-scoped vertical scrubber with page numbers,
 * a dot per screen, and prev/next chapter buttons above and below.
 */
export class SideRail {
  readonly el: HTMLElement;
  private pageEl: HTMLElement;
  private pagesEl: HTMLElement;
  private fill: HTMLElement;
  private thumb: HTMLElement;
  private dotsEl: HTMLElement;
  private dots: { fraction: number; el: HTMLElement }[] = [];
  private pages = 0;
  private dragging = false;

  constructor(parent: HTMLElement, private handlers: SideRailHandlers) {
    this.el = parent.createDiv({ cls: 'rr-rail' });

    const up = this.el.createEl('button', { cls: 'rr-rail-btn', attr: { 'aria-label': 'Previous chapter' } });
    setIcon(up, 'arrow-up-to-line');
    up.onclick = () => this.handlers.jump(-1);

    const panel = this.el.createDiv({ cls: 'rr-rail-panel' });
    this.pageEl = panel.createDiv({ cls: 'rr-rail-num', text: '–' });
    const track = panel.createDiv({ cls: 'rr-rail-track', attr: { 'aria-label': 'Chapter progress' } });
    track.createDiv({ cls: 'rr-rail-line' });
    this.fill = track.createDiv({ cls: 'rr-rail-fill' });
    this.dotsEl = track.createDiv({ cls: 'rr-rail-dots' });
    this.thumb = track.createDiv({ cls: 'rr-rail-thumb' });
    this.pagesEl = panel.createDiv({ cls: 'rr-rail-num', text: '–' });

    const down = this.el.createEl('button', { cls: 'rr-rail-btn', attr: { 'aria-label': 'Next chapter' } });
    setIcon(down, 'arrow-down-to-line');
    down.onclick = () => this.handlers.jump(1);

    this.wireTrack(track);
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

  update(p: ChapterProgress): void {
    this.pageEl.setText(String(p.page));
    this.pagesEl.setText(String(p.pages));
    if (p.pages !== this.pages) this.buildDots(p.pages);
    // Don't fight the finger while dragging.
    if (!this.dragging) this.setFraction(p.fraction);
  }

  private buildDots(pages: number): void {
    this.pages = pages;
    this.dotsEl.empty();
    this.dots = [];
    if (pages < 2) return;
    const step = Math.ceil(pages / MAX_DOTS);
    for (let i = 0; i < pages; i += step) {
      const fraction = i / (pages - 1);
      const el = this.dotsEl.createDiv({ cls: 'rr-rail-dot' });
      el.style.top = `${fraction * 100}%`;
      this.dots.push({ fraction, el });
    }
  }

  private setFraction(f: number): void {
    const pct = `${f * 100}%`;
    this.fill.style.height = pct;
    this.thumb.style.top = pct;
    for (const d of this.dots) d.el.toggleClass('is-passed', d.fraction <= f + 1e-6);
  }

  destroy(): void {
    this.el.remove();
  }
}
