import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SearchHit } from '../readers/EpubReader';
import type { ProgressBarPosition, Theme } from '../settings/settings';
import { Icon } from '../react/Icon';
import { useReader, useReaderContext, useSettings } from './context';

/** Curated reading fonts offered in the quick-settings menu. */
export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Libron', value: 'Libron, Georgia, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", Times, serif' },
  { label: 'Palatino', value: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { label: 'System Sans', value: 'system-ui, -apple-system, sans-serif' },
  { label: 'Helvetica', value: '"Helvetica Neue", Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Bricolage Grotesque', value: '"Bricolage Grotesque", system-ui, sans-serif' },
  { label: 'Fira Code', value: '"Fira Code", ui-monospace, "Courier New", monospace' },
  { label: 'Monospace', value: '"Courier New", ui-monospace, monospace' },
];

/** Marks a button that toggles a panel, so clicking it isn't an "outside" click. */
export const PANEL_TOGGLE = 'data-rr-panel-toggle';

/**
 * Close a panel on Escape, and (desktop popovers) on a pointer-down outside
 * it — ignoring the button that toggles it.
 */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void, outside: boolean): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const doc = ref.current?.ownerDocument ?? document;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close.current();
    };
    const onDown = (e: Event): void => {
      const t = e.target as Element | null;
      if (!t || ref.current?.contains(t) || t.closest?.(`[${PANEL_TOGGLE}]`)) return;
      close.current();
    };
    doc.addEventListener('keydown', onKey);
    if (outside) doc.addEventListener('pointerdown', onDown, true);
    return () => {
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('pointerdown', onDown, true);
    };
  }, [ref, outside]);
}

/** Focus an input once its panel is on screen. */
function useAutoFocus(ref: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}

/**
 * Searchable table of contents: a popover under the TOC button on desktop, a
 * full-screen overlay on mobile.
 */
export function TocPanel() {
  const { actions, isMobile } = useReaderContext();
  const closeAfterJump = useSettings((s) => s.closeMenuAfterTocJump);
  const entries = useMemo(() => actions.getToc(), [actions]);
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = (): void => actions.setPanel(null);
  useDismiss(panel, close, !isMobile);
  useAutoFocus(input);

  const q = query.trim().toLowerCase();
  const matches = q ? entries.filter((e) => e.label.toLowerCase().includes(q)) : entries;

  return (
    <div ref={panel} className={isMobile ? 'rr-toc-overlay' : 'rr-toc-panel'}>
      <div className="rr-toc-header">
        <input ref={input} className="rr-toc-search" type="text" placeholder="Search chapters…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="rr-toc-close" aria-label="Close" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="rr-toc-list">
        {matches.length === 0 && <div className="rr-toc-empty">No matching chapters</div>}
        {matches.map((entry, i) => (
          <button
            key={i}
            className="rr-toc-item"
            // Indent by depth only when not filtering (a filtered list reads better flat).
            style={!q && entry.depth > 0 ? { paddingLeft: `${12 + entry.depth * 16}px` } : undefined}
            onClick={() => {
              actions.jumpToToc(entry);
              if (closeAfterJump) close();
            }}
          >
            <span>{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Highlight every occurrence of `query` in a search snippet. */
function Snippet({ text, query }: { text: string; query: string }) {
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let from = 0;
  let idx = lower.indexOf(q);
  while (q && idx >= 0) {
    if (idx > from) parts.push(text.slice(from, idx));
    parts.push(<mark key={idx}>{text.slice(idx, idx + q.length)}</mark>);
    from = idx + q.length;
    idx = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <div className="rr-search-result-snippet">{parts}</div>;
}

/** In-book full-text search: popover on desktop, overlay on mobile. */
export function SearchPanel() {
  const { actions, isMobile } = useReaderContext();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; hits: SearchHit[] } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = (): void => actions.setPanel(null);
  useDismiss(panel, close, !isMobile);
  useAutoFocus(input);

  // Debounced: searching the whole book on every keystroke is wasted work.
  useEffect(() => {
    const q = query.trim();
    const timer = window.setTimeout(() => setResult(q.length < 2 ? null : { query: q, hits: actions.search(q) }), 200);
    return () => window.clearTimeout(timer);
  }, [query, actions]);
  // Leaving search removes the last jump's highlight from the book.
  useEffect(() => () => actions.clearSearch(), [actions]);

  const count = !result
    ? 'Type at least 2 characters'
    : result.hits.length === 0
      ? 'No results'
      : `${result.hits.length} result${result.hits.length === 1 ? '' : 's'}`;

  return (
    <div ref={panel} className={isMobile ? 'rr-search-overlay' : 'rr-search-panel'}>
      <div className="rr-search-header">
        <Icon name="search" className="rr-search-icon" />
        <input ref={input} className="rr-search-input" type="text" placeholder="Search in book…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="rr-search-close" aria-label="Close" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="rr-search-count">{query.trim() ? count : ''}</div>
      <div className="rr-search-results">
        {result?.hits.map((hit, i) => (
          <button key={i} className="rr-search-result" onClick={() => actions.jumpToHit(hit, result.query)}>
            <div className="rr-search-result-label">{hit.label}</div>
            <Snippet text={hit.snippet} query={result.query} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rr-qs-row">
      <span className="rr-qs-label">{label}</span>
      {children}
    </div>
  );
}

function Chips<T extends string>({ options, value, onPick }: { options: { value: T; label: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'rr-qs-chip is-active' : 'rr-qs-chip'} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </>
  );
}

function Stepper({ label, value, onStep }: { label: string; value: string; onStep: (delta: 1 | -1) => void }) {
  return (
    <Row label={label}>
      <button className="rr-qs-chip" onClick={() => onStep(-1)}>
        −
      </button>
      <span className="rr-qs-value">{value}</span>
      <button className="rr-qs-chip" onClick={() => onStep(1)}>
        +
      </button>
    </Row>
  );
}

/** Quick settings: theme, typography, progress bar position, bookmarks, export. */
export function QuickSettings() {
  const { actions, isMobile, version } = useReaderContext();
  const s = useSettings((x) => x);
  // Re-read the bookmarks whenever they change.
  useReader((r) => r.bookmarksVersion);
  const bookmarks = actions.getBookmarks();
  const panel = useRef<HTMLDivElement>(null);
  useDismiss(panel, () => actions.setPanel(null), false);

  const fonts = FONT_OPTIONS.some((o) => o.value === s.fontFamily) ? FONT_OPTIONS : [{ label: 'Custom', value: s.fontFamily }, ...FONT_OPTIONS];

  return (
    <div ref={panel} className="rr-quick-settings">
      <Row label="Theme">
        <Chips<Theme>
          options={(['obsidian', 'light', 'dark', 'sepia'] as Theme[]).map((t) => ({ value: t, label: t }))}
          value={s.theme}
          onPick={(theme) => actions.updateSettings({ theme })}
        />
      </Row>
      <Stepper label="Font size" value={`${s.fontSize}px`} onStep={(d) => actions.updateSettings({ fontSize: Math.min(36, Math.max(12, s.fontSize + d)) })} />
      <Stepper
        label="Line height"
        value={s.lineHeight.toFixed(1)}
        onStep={(d) => actions.updateSettings({ lineHeight: Math.round(Math.min(2.5, Math.max(1.0, s.lineHeight + d * 0.1)) * 10) / 10 })}
      />
      <Row label="Font">
        <select className="rr-qs-select" value={s.fontFamily} onChange={(e) => actions.updateSettings({ fontFamily: e.target.value })}>
          {fonts.map((o) => (
            <option key={o.value} value={o.value} style={{ fontFamily: o.value }}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {/* The side rail is mobile-only. */}
      {isMobile && (
        <Row label="Progress">
          <Chips<ProgressBarPosition>
            options={[
              { value: 'bottom', label: 'bottom' },
              { value: 'right', label: 'side' },
            ]}
            value={s.progressBarPosition}
            onPick={(progressBarPosition) => actions.updateSettings({ progressBarPosition })}
          />
        </Row>
      )}

      <Row label="Bookmarks">
        <button className="rr-qs-chip" onClick={() => void actions.addBookmark()}>
          + Add
        </button>
      </Row>
      {bookmarks.length > 0 && (
        <div className="rr-bookmark-list">
          {bookmarks.map((b) => (
            <div key={b.id} className="rr-bookmark-row">
              <button
                className="rr-bookmark-jump"
                onClick={() => {
                  actions.goToBookmark(b);
                  if (s.closeMenuAfterTocJump) actions.setPanel(null);
                }}
              >
                {b.name}
              </button>
              <button className="rr-bookmark-del" aria-label="Delete bookmark" onClick={() => void actions.deleteBookmark(b.id)}>
                <Icon name="trash-2" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Row label="Notes">
        <button className="rr-qs-chip rr-qs-wide" onClick={actions.exportNotes}>
          Export to note
        </button>
      </Row>
      <div className="rr-qs-version">R Reader v{version}</div>
    </div>
  );
}
