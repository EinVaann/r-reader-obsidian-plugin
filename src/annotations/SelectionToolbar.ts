import { Platform } from 'obsidian';
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from './types';
import type { QuoteAnchor } from './anchor';

/** Hooks the toolbar uses to talk to the reader/annotation layer. */
export interface SelectionToolbarHost {
  captureSelection(): QuoteAnchor | null;
  defaultColor(): HighlightColor;
  getHighlight(id: string): Highlight | undefined;
  /** Persist + render a new highlight; returns it (or null if not anchorable). */
  onCreate(anchor: QuoteAnchor, color: HighlightColor): Highlight | null;
  onRecolor(id: string, color: HighlightColor): void;
  onSetNote(id: string, note: string): void;
  onDelete(id: string): void;
}

/**
 * Floating selection toolbar (color swatches + note) shown over a live text
 * selection, plus the popover editor for tapping an existing highlight.
 */
export class SelectionToolbar {
  private rootEl: HTMLElement;
  private contentEl: HTMLElement;
  private host: SelectionToolbarHost;

  private bar: HTMLElement | null = null;
  private editor: HTMLElement | null = null;
  private selectionListener: (() => void) | null = null;
  private outsideListener: ((e: Event) => void) | null = null;

  constructor(rootEl: HTMLElement, contentEl: HTMLElement, host: SelectionToolbarHost) {
    this.rootEl = rootEl;
    this.contentEl = contentEl;
    this.host = host;
  }

  mount(): void {
    const doc = this.contentEl.ownerDocument;
    // Show the toolbar shortly after a selection settles (covers mouse + touch).
    let timer = 0;
    this.selectionListener = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => this.onSelectionChanged(), 120);
    };
    doc.addEventListener('selectionchange', this.selectionListener);

    // Dismiss the bar/editor when tapping elsewhere.
    this.outsideListener = (e: Event) => {
      const t = e.target as Node;
      if (this.bar && !this.bar.contains(t) && !this.isSelectionInContent()) this.hideBar();
      if (this.editor && !this.editor.contains(t)) this.hideEditor();
    };
    doc.addEventListener('pointerdown', this.outsideListener, true);
  }

  unmount(): void {
    const doc = this.contentEl.ownerDocument;
    if (this.selectionListener) doc.removeEventListener('selectionchange', this.selectionListener);
    if (this.outsideListener) doc.removeEventListener('pointerdown', this.outsideListener, true);
    this.selectionListener = null;
    this.outsideListener = null;
    this.hideBar();
    this.hideEditor();
  }

  private isSelectionInContent(): boolean {
    const sel = this.contentEl.ownerDocument.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return !!el && this.contentEl.contains(el);
  }

  private onSelectionChanged(): void {
    if (!this.isSelectionInContent()) {
      this.hideBar();
      return;
    }
    const sel = this.contentEl.ownerDocument.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    this.showBar(rect);
  }

  // --- Selection toolbar ---
  private showBar(rect: DOMRect): void {
    this.hideEditor();
    if (!this.bar) {
      this.bar = this.rootEl.createDiv({ cls: 'rr-selection-toolbar' });
      this.buildSwatches(this.bar, (color) => this.createFromSelection(color));
      const note = this.bar.createEl('button', { cls: 'rr-st-note', text: 'Note' });
      note.onclick = () => this.createFromSelection(this.host.defaultColor(), true);
    }
    this.position(this.bar, rect);
  }

  private buildSwatches(parent: HTMLElement, onPick: (c: HighlightColor) => void): void {
    const row = parent.createDiv({ cls: 'rr-st-swatches' });
    for (const color of HIGHLIGHT_COLORS) {
      const sw = row.createEl('button', { cls: `rr-st-swatch rr-hl-${color}`, attr: { 'aria-label': color } });
      sw.onclick = () => onPick(color);
    }
  }

  private createFromSelection(color: HighlightColor, openNote = false): void {
    const anchor = this.host.captureSelection();
    this.hideBar();
    if (!anchor) return;
    const created = this.host.onCreate(anchor, color);
    this.contentEl.ownerDocument.getSelection()?.removeAllRanges();
    if (created && openNote) {
      // Re-open the editor on the freshly-created highlight to add a note.
      const span = this.contentEl.querySelector<HTMLElement>(`span[data-hl-id="${CSS.escape(created.id)}"]`);
      if (span) this.openHighlightEditor(created.id, span);
    }
  }

  // --- Existing-highlight editor ---
  openHighlightEditor(id: string, anchorEl: HTMLElement): void {
    this.hideBar();
    this.hideEditor();
    const h = this.host.getHighlight(id);
    if (!h) return;

    const editor = this.rootEl.createDiv({ cls: 'rr-hl-editor' });
    this.editor = editor;

    // Color row.
    this.buildSwatches(editor, (color) => {
      this.host.onRecolor(id, color);
    });

    // Note textarea.
    const ta = editor.createEl('textarea', { cls: 'rr-hl-note', attr: { placeholder: 'Add a note…' } });
    ta.value = h.note ?? '';
    ta.oninput = () => this.host.onSetNote(id, ta.value);

    // Actions.
    const actions = editor.createDiv({ cls: 'rr-hl-actions' });
    const del = actions.createEl('button', { cls: 'rr-hl-delete', text: 'Delete' });
    del.onclick = () => { this.host.onDelete(id); this.hideEditor(); };
    const done = actions.createEl('button', { cls: 'rr-hl-done', text: 'Done' });
    done.onclick = () => this.hideEditor();

    this.position(editor, anchorEl.getBoundingClientRect());
    if (!Platform.isMobile) ta.focus();
  }

  // --- Shared positioning ---
  private position(el: HTMLElement, rect: DOMRect): void {
    // Fixed positioning → viewport coordinates, independent of scroll parents.
    el.style.position = 'fixed';
    el.style.visibility = 'hidden';
    // Measure after it's in the DOM.
    requestAnimationFrame(() => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left + rect.width / 2 - w / 2;
      left = Math.max(8, Math.min(left, vw - w - 8));
      // Prefer above the selection; flip below if there's no room.
      let top = rect.top - h - 8;
      if (top < 8) top = Math.min(rect.bottom + 8, vh - h - 8);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.visibility = 'visible';
    });
  }

  private hideBar(): void {
    this.bar?.remove();
    this.bar = null;
  }

  private hideEditor(): void {
    this.editor?.remove();
    this.editor = null;
  }
}
