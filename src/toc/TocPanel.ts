import { setIcon } from 'obsidian';
import type { TocEntry } from '../readers/EpubReader';

export interface TocPanelOptions {
  getToc: () => TocEntry[];
  onJump: (entry: TocEntry) => void;
  isMobile: boolean;
  /** Whether to close the panel after a jump. */
  closeAfterJump: () => boolean;
}

/**
 * Searchable table of contents.
 * - Desktop: a floating popover anchored under the TOC button.
 * - Mobile: a full-screen overlay over the reader for a roomier list.
 */
export class TocPanel {
  private rootEl: HTMLElement;
  private opts: TocPanelOptions;
  private el: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private entries: TocEntry[] = [];
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private outsideListener: ((e: Event) => void) | null = null;

  constructor(rootEl: HTMLElement, opts: TocPanelOptions) {
    this.rootEl = rootEl;
    this.opts = opts;
  }

  isOpen(): boolean {
    return this.el !== null;
  }

  toggle(anchorEl?: HTMLElement): void {
    if (this.isOpen()) this.close();
    else this.open(anchorEl);
  }

  open(anchorEl?: HTMLElement): void {
    this.entries = this.opts.getToc();
    if (this.entries.length === 0) return;
    this.close();

    const panel = this.rootEl.createDiv({
      cls: this.opts.isMobile ? 'rr-toc-overlay' : 'rr-toc-panel',
    });
    this.el = panel;

    // Header: search box + close button (sidebar on desktop, overlay on mobile).
    const header = panel.createDiv({ cls: 'rr-toc-header' });
    const search = header.createEl('input', {
      cls: 'rr-toc-search',
      attr: { type: 'text', placeholder: 'Search chapters…' },
    });
    search.oninput = () => this.renderList(search.value);
    const close = header.createEl('button', { cls: 'rr-toc-close', attr: { 'aria-label': 'Close' } });
    setIcon(close, 'x');
    close.onclick = () => this.close();

    this.listEl = panel.createDiv({ cls: 'rr-toc-list' });
    this.renderList('');

    // Close on Esc; desktop also closes on outside click.
    this.keyListener = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this.keyListener);
    if (!this.opts.isMobile) {
      this.outsideListener = (e: Event) => {
        const t = e.target as Node;
        if (this.el && !this.el.contains(t) && t !== anchorEl) this.close();
      };
      document.addEventListener('pointerdown', this.outsideListener, true);
    }

    requestAnimationFrame(() => search.focus());
  }

  private renderList(query: string): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const q = query.trim().toLowerCase();
    const matches = q
      ? this.entries.filter((e) => e.label.toLowerCase().includes(q))
      : this.entries;

    if (matches.length === 0) {
      this.listEl.createDiv({ cls: 'rr-toc-empty', text: 'No matching chapters' });
      return;
    }
    for (const entry of matches) {
      const item = this.listEl.createEl('button', { cls: 'rr-toc-item' });
      // Indent by depth only when not filtering (filtered list reads better flat).
      if (!q && entry.depth > 0) item.style.paddingLeft = `${12 + entry.depth * 16}px`;
      item.createSpan({ text: entry.label });
      item.onclick = () => {
        this.opts.onJump(entry);
        if (this.opts.closeAfterJump()) this.close();
      };
    }
  }

  close(): void {
    if (this.keyListener) document.removeEventListener('keydown', this.keyListener);
    if (this.outsideListener) document.removeEventListener('pointerdown', this.outsideListener, true);
    this.keyListener = null;
    this.outsideListener = null;
    this.el?.remove();
    this.el = null;
    this.listEl = null;
  }
}
