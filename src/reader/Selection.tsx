import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../annotations/types';
import type { QuoteAnchor } from '../annotations/anchor';
import { useReaderContext, useSettings } from './context';

/**
 * Place a floating element over a rect: centered, above it if there's room
 * (below otherwise), kept inside the viewport. Fixed positioning, so scroll
 * parents don't matter.
 */
function usePlaceOver(ref: React.RefObject<HTMLElement | null>, rect: DOMRect | null): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const win = el.ownerDocument.defaultView ?? window;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(8, Math.min(left, win.innerWidth - w - 8));
    let top = rect.top - h - 8;
    if (top < 8) top = Math.min(rect.bottom + 8, win.innerHeight - h - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  }, [ref, rect]);
}

function Swatches({ onPick }: { onPick: (c: HighlightColor) => void }) {
  return (
    <div className="rr-st-swatches">
      {HIGHLIGHT_COLORS.map((color) => (
        <button key={color} className={`rr-st-swatch rr-hl-${color}`} aria-label={color} onClick={() => onPick(color)} />
      ))}
    </div>
  );
}

const FLOATING = { position: 'fixed', visibility: 'hidden', left: 0, top: 0 } as const;

/**
 * Highlighting UI over the book: a color toolbar above a live text selection,
 * and an editor (recolor / note / delete) when an existing highlight is tapped.
 * Both float on <body> so no overflow-hidden ancestor clips them.
 */
export function SelectionLayer({ contentEl }: { contentEl: HTMLElement }) {
  const { highlights, isMobile } = useReaderContext();
  const defaultColor = useSettings((s) => s.defaultHighlightColor);
  const doc = contentEl.ownerDocument;

  // The anchor is captured the moment the bar appears, while the selection is
  // live: tapping a swatch collapses the selection before its click fires.
  const [bar, setBar] = useState<{ rect: DOMRect; anchor: QuoteAnchor } | null>(null);
  const [editor, setEditor] = useState<{ id: string; rect: DOMRect } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  usePlaceOver(barRef, bar?.rect ?? null);
  usePlaceOver(editorRef, editor?.rect ?? null);

  const selectionInContent = (): boolean => {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const node = sel.getRangeAt(0).commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return !!el && contentEl.contains(el);
  };

  useEffect(() => {
    // Show the bar shortly after a selection settles (mouse and touch alike).
    let timer = 0;
    const onSelection = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!selectionInContent()) return setBar(null);
        const rect = doc.getSelection()!.getRangeAt(0).getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const anchor = highlights.captureSelection();
        setEditor(null);
        setBar(anchor ? { rect, anchor } : null);
      }, 120);
    };
    // Tapping elsewhere dismisses the bar / editor.
    const onDown = (e: Event): void => {
      const t = e.target as Node;
      if (barRef.current && !barRef.current.contains(t) && !selectionInContent()) setBar(null);
      if (editorRef.current && !editorRef.current.contains(t)) setEditor(null);
    };
    // On mobile, our toolbar replaces the native Copy / Share menu over book text.
    const onContext = (e: Event): void => {
      if (selectionInContent()) e.preventDefault();
    };
    doc.addEventListener('selectionchange', onSelection);
    doc.addEventListener('pointerdown', onDown, true);
    if (isMobile) contentEl.addEventListener('contextmenu', onContext);
    highlights.onHighlightClick((id, el) => {
      setBar(null);
      setEditor({ id, rect: el.getBoundingClientRect() });
    });
    return () => {
      window.clearTimeout(timer);
      doc.removeEventListener('selectionchange', onSelection);
      doc.removeEventListener('pointerdown', onDown, true);
      contentEl.removeEventListener('contextmenu', onContext);
      highlights.onHighlightClick(null);
    };
    // selectionInContent only reads stable refs.
  }, [doc, contentEl, highlights, isMobile]);

  // Keep the text selection when pressing the bar (passive: false, so it can preventDefault).
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const keep = (e: Event): void => e.preventDefault();
    el.addEventListener('mousedown', keep);
    el.addEventListener('touchstart', keep, { passive: false });
    return () => {
      el.removeEventListener('mousedown', keep);
      el.removeEventListener('touchstart', keep);
    };
  }, [bar !== null]);

  const create = (color: HighlightColor, withNote = false): void => {
    const anchor = bar?.anchor ?? highlights.captureSelection();
    setBar(null);
    if (!anchor) return;
    const created = highlights.create(anchor, color);
    doc.getSelection()?.removeAllRanges();
    if (created && withNote) {
      const span = contentEl.querySelector<HTMLElement>(`span[data-hl-id="${CSS.escape(created.id)}"]`);
      if (span) setEditor({ id: created.id, rect: span.getBoundingClientRect() });
    }
  };

  const editing = editor ? highlights.getHighlight(editor.id) : undefined;

  return (
    <>
      {bar &&
        createPortal(
          <div ref={barRef} className="rr-selection-toolbar" style={FLOATING}>
            <Swatches onPick={(c) => create(c)} />
            <button className="rr-st-note" onClick={() => create(defaultColor, true)}>
              Note
            </button>
          </div>,
          doc.body,
        )}
      {editor &&
        editing &&
        createPortal(
          <div ref={editorRef} className="rr-hl-editor" style={FLOATING}>
            <Swatches onPick={(c) => highlights.recolor(editor.id, c)} />
            <textarea
              className="rr-hl-note"
              placeholder="Add a note…"
              defaultValue={editing.note ?? ''}
              autoFocus={!isMobile}
              onInput={(e) => highlights.setNote(editor.id, e.currentTarget.value)}
            />
            <div className="rr-hl-actions">
              <button
                className="rr-hl-delete"
                onClick={() => {
                  highlights.remove(editor.id);
                  setEditor(null);
                }}
              >
                Delete
              </button>
              <button className="rr-hl-done" onClick={() => setEditor(null)}>
                Done
              </button>
            </div>
          </div>,
          doc.body,
        )}
    </>
  );
}
