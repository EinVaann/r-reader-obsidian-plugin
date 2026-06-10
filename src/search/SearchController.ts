import { setIcon } from 'obsidian';
import type { SearchHit } from '../readers/EpubReader';

export interface SearchOptions {
  search: (query: string) => SearchHit[];
  onJump: (hit: SearchHit) => void;
  onClose?: () => void;
  isMobile: boolean;
}

/**
 * In-book full-text search UI. Desktop = floating popover; mobile = full-screen
 * overlay. The actual indexing/search runs in EpubReader (reads the rendered
 * chapter text from the DOM — no re-parse).
 */
export class SearchController {
  private rootEl: HTMLElement;
  private opts: SearchOptions;
  private el: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private outsideListener: ((e: Event) => void) | null = null;
  private debounce = 0;

  constructor(rootEl: HTMLElement, opts: SearchOptions) {
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
    this.close();
    const panel = this.rootEl.createDiv({
      cls: this.opts.isMobile ? 'rr-search-overlay' : 'rr-search-panel',
    });
    this.el = panel;

    const header = panel.createDiv({ cls: 'rr-search-header' });
    const icon = header.createDiv({ cls: 'rr-search-icon' });
    setIcon(icon, 'search');
    const input = header.createEl('input', {
      cls: 'rr-search-input',
      attr: { type: 'text', placeholder: 'Search in book…' },
    });
    input.oninput = () => {
      window.clearTimeout(this.debounce);
      this.debounce = window.setTimeout(() => this.runSearch(input.value), 200);
    };
    if (this.opts.isMobile) {
      const close = header.createEl('button', { cls: 'rr-search-close', attr: { 'aria-label': 'Close' } });
      setIcon(close, 'x');
      close.onclick = () => this.close();
    }

    this.countEl = panel.createDiv({ cls: 'rr-search-count' });
    this.resultsEl = panel.createDiv({ cls: 'rr-search-results' });

    if (!this.opts.isMobile && anchorEl) this.positionUnder(panel, anchorEl);

    this.keyListener = (e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this.keyListener);
    if (!this.opts.isMobile) {
      this.outsideListener = (e: Event) => {
        const t = e.target as Node;
        if (this.el && !this.el.contains(t) && t !== anchorEl) this.close();
      };
      document.addEventListener('pointerdown', this.outsideListener, true);
    }

    requestAnimationFrame(() => input.focus());
  }

  private runSearch(query: string): void {
    if (!this.resultsEl || !this.countEl) return;
    this.resultsEl.empty();
    const q = query.trim();
    if (q.length < 2) {
      this.countEl.setText('Type at least 2 characters');
      return;
    }
    const hits = this.opts.search(q);
    this.countEl.setText(hits.length === 0 ? 'No results' : `${hits.length} result${hits.length === 1 ? '' : 's'}`);
    for (const hit of hits) {
      const row = this.resultsEl.createEl('button', { cls: 'rr-search-result' });
      row.createDiv({ cls: 'rr-search-result-label', text: hit.label });
      const snip = row.createDiv({ cls: 'rr-search-result-snippet' });
      this.renderSnippet(snip, hit.snippet, q);
      row.onclick = () => this.opts.onJump(hit);
    }
  }

  /** Render a snippet with the matched term emphasized. */
  private renderSnippet(el: HTMLElement, text: string, query: string): void {
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    let from = 0;
    let idx = lower.indexOf(q, from);
    if (idx < 0) { el.setText(text); return; }
    while (idx >= 0) {
      if (idx > from) el.appendText(text.slice(from, idx));
      el.createEl('mark', { text: text.slice(idx, idx + q.length) });
      from = idx + q.length;
      idx = lower.indexOf(q, from);
    }
    if (from < text.length) el.appendText(text.slice(from));
  }

  private positionUnder(panel: HTMLElement, anchorEl: HTMLElement): void {
    const rect = anchorEl.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.visibility = 'hidden';
    requestAnimationFrame(() => {
      const w = panel.offsetWidth;
      const vw = window.innerWidth;
      let left = rect.right - w;
      left = Math.max(8, Math.min(left, vw - w - 8));
      panel.style.left = `${left}px`;
      panel.style.top = `${rect.bottom + 6}px`;
      panel.style.visibility = 'visible';
    });
  }

  close(): void {
    if (this.keyListener) document.removeEventListener('keydown', this.keyListener);
    if (this.outsideListener) document.removeEventListener('pointerdown', this.outsideListener, true);
    this.keyListener = null;
    this.outsideListener = null;
    window.clearTimeout(this.debounce);
    this.el?.remove();
    this.el = null;
    this.resultsEl = null;
    this.countEl = null;
    this.opts.onClose?.();
  }
}
