import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ItemView, Notice, type TFile, type WorkspaceLeaf } from 'obsidian';
import type RReaderPlugin from '../../main';
import { mountReact, useApp } from '../react/mount';
import { Icon } from '../react/Icon';
import type { CoverDetails } from './CoverCache';

export const LIBRARY_VIEW_TYPE = 'r-reader-library';

/** How many books to surface in the "Recently read" row. */
const RECENT_LIMIT = 6;
/** Stable section keys for the non-folder sections (used for collapse state). */
const KEY_RECENT = '__recent';
const KEY_ALL = '__all';

/** A grid of all EPUBs in the vault with covers, progress, and highlight counts. */
export class LibraryView extends ItemView {
  private unmount: (() => void) | null = null;
  /** Listeners re-reading the book list (vault changes, `render()`). */
  private listeners = new Set<() => void>();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: RReaderPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return LIBRARY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'R Reader library';
  }

  getIcon(): string {
    return 'library';
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass('rr-library-root');
    const subscribe = (fn: () => void): (() => void) => {
      this.listeners.add(fn);
      return () => void this.listeners.delete(fn);
    };
    this.unmount = mountReact(
      this.app,
      this.contentEl,
      <LibraryContext.Provider value={{ plugin: this.plugin, scrollEl: this.contentEl }}>
        <Library subscribe={subscribe} />
      </LibraryContext.Provider>,
    );
    // Books added, removed or renamed while the library is open.
    for (const event of ['create', 'delete', 'rename'] as const) {
      this.registerEvent(this.app.vault.on(event as 'create', (f) => {
        if ('extension' in f && (f as TFile).extension.toLowerCase() === 'epub') this.render();
      }));
    }
  }

  async onClose(): Promise<void> {
    this.unmount?.();
    this.unmount = null;
  }

  /** Re-read the books (and their progress / highlight counts). */
  render(): void {
    for (const fn of this.listeners) fn();
  }
}

const LibraryContext = createContext<{ plugin: RReaderPlugin; scrollEl: HTMLElement } | null>(null);

function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('outside the library');
  return ctx;
}

function Library({ subscribe }: { subscribe: (fn: () => void) => () => void }) {
  const app = useApp();
  const { plugin, scrollEl } = useLibrary();
  const settings = useStore(plugin.settingsStore, (s) => s.settings);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), [subscribe]);

  // One lazy-loading observer for every card: details load as cards near the viewport.
  const observer = useMemo(() => new CardObserver(scrollEl), [scrollEl]);
  useEffect(() => () => observer.disconnect(), [observer]);

  const all = useMemo(() => app.vault.getFiles().filter((f) => f.extension.toLowerCase() === 'epub'), [app, tick]);
  const q = query.trim().toLowerCase();
  const files = q ? all.filter((f) => f.basename.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) : all;

  const recent = files
    .filter((f) => plugin.progressManager.getLastRead(f.path) != null)
    .sort((a, b) => (plugin.progressManager.getLastRead(b.path) ?? 0) - (plugin.progressManager.getLastRead(a.path) ?? 0))
    .slice(0, RECENT_LIMIT);

  const sections: { key: string; title: string; files: TFile[] }[] = [];
  if (recent.length > 0) sections.push({ key: KEY_RECENT, title: 'Recently read', files: recent });
  if (settings.libraryGroupByFolder) {
    const groups = new Map<string, TFile[]>();
    for (const f of files) {
      const folder = f.parent?.path ?? '/';
      groups.set(folder, [...(groups.get(folder) ?? []), f]);
    }
    for (const folder of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const list = groups.get(folder)!.sort((a, b) => a.basename.localeCompare(b.basename));
      sections.push({ key: folder, title: folder === '/' ? 'Vault root' : folder, files: list });
    }
  } else {
    sections.push({ key: KEY_ALL, title: 'All books', files: [...files].sort((a, b) => a.basename.localeCompare(b.basename)) });
  }

  const refreshMeta = async (): Promise<void> => {
    setRefreshing(true);
    await plugin.coverCache.invalidateAll();
    new Notice('R Reader: rebuilding covers & metadata');
    setRefreshing(false);
    setTick((t) => t + 1);
  };

  return (
    <>
      <div className="rr-library-header">
        <h2>Library</h2>
        <div className="rr-library-actions">
          <button className="rr-library-refresh" onClick={() => setTick((t) => t + 1)}>
            Refresh
          </button>
          <button className="rr-library-refresh" title="Re-extract covers and metadata for all books" disabled={refreshing} onClick={() => void refreshMeta()}>
            {refreshing ? 'Refreshing…' : 'Refresh meta'}
          </button>
        </div>
      </div>

      <div className="rr-library-controls">
        <input className="rr-library-search" type="search" placeholder="Search by title, author, or file…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="rr-library-group">
          <input
            type="checkbox"
            checked={settings.libraryGroupByFolder}
            onChange={(e) => {
              plugin.settings.libraryGroupByFolder = e.target.checked;
              void plugin.saveSettings();
            }}
          />
          <span>Group by folder</span>
        </label>
      </div>

      <div className="rr-library-body">
        {all.length === 0 && <div className="rr-library-empty">No EPUB files found in this vault.</div>}
        {all.length > 0 && files.length === 0 && <div className="rr-library-empty">No books match “{query.trim()}”.</div>}
        {files.length > 0 &&
          sections.map((s) => <Section key={s.key} sectionKey={s.key} title={s.title} files={s.files} observer={observer} tick={tick} />)}
      </div>
    </>
  );
}

/** A collapsible titled section with a grid of book cards. */
function Section({ sectionKey, title, files, observer, tick }: { sectionKey: string; title: string; files: TFile[]; observer: CardObserver; tick: number }) {
  const { plugin } = useLibrary();
  const collapsed = useStore(plugin.settingsStore, (s) => s.settings.libraryCollapsed.includes(sectionKey));
  const toggle = (): void => {
    const set = new Set(plugin.settings.libraryCollapsed);
    if (collapsed) set.delete(sectionKey);
    else set.add(sectionKey);
    plugin.settings.libraryCollapsed = [...set];
    void plugin.saveSettings();
  };

  return (
    <div className={collapsed ? 'rr-library-section is-collapsed' : 'rr-library-section'}>
      <div className="rr-library-section-head" onClick={toggle}>
        <Icon name="chevron-right" className="rr-library-chevron" />
        <span className="rr-library-section-title">{title}</span>
        <span className="rr-library-count">{files.length}</span>
      </div>
      {/* Collapsed sections don't render their cards at all. */}
      {!collapsed && (
        <div className="rr-library-grid">
          {files.map((f) => (
            <BookCard key={f.path} file={f} observer={observer} tick={tick} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Calls each card's loader the first time it comes near the viewport. */
class CardObserver {
  private loaders = new WeakMap<Element, () => void>();
  private io: IntersectionObserver;

  constructor(root: HTMLElement) {
    this.io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.io.unobserve(entry.target);
          this.loaders.get(entry.target)?.();
        }
      },
      { root, rootMargin: '200px' },
    );
  }

  observe(el: Element, load: () => void): () => void {
    this.loaders.set(el, load);
    this.io.observe(el);
    return () => this.io.unobserve(el);
  }

  disconnect(): void {
    this.io.disconnect();
  }
}

const BookCard = memo(function BookCard({ file, observer, tick }: { file: TFile; observer: CardObserver; tick: number }) {
  const app = useApp();
  const { plugin } = useLibrary();
  const ref = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<CoverDetails | null>(null);

  // Cover, title and author load lazily (parsing an EPUB is slow on a cold cache).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const stop = observer.observe(el, () => {
      plugin.coverCache
        .getDetails(file)
        .then((d) => !cancelled && setDetails(d))
        .catch((e) => console.error('R Reader: failed to load library card', file.path, e));
    });
    return () => {
      cancelled = true;
      stop();
    };
    // tick: "Refresh meta" re-extracts, so reload details.
  }, [file, observer, plugin, tick]);

  const saved = plugin.progressManager.get(file.path);
  const frac = typeof saved === 'number' ? Math.max(0, Math.min(1, saved)) : 0;
  const highlights = plugin.annotationManager.highlightCount(file.path);

  return (
    <div ref={ref} className="rr-book-card" data-path={file.path} onClick={() => void app.workspace.getLeaf(false).openFile(file)}>
      <div className="rr-book-cover">
        {details?.coverUrl ? (
          <img className="rr-book-cover-img" src={details.coverUrl} alt={file.basename} loading="lazy" />
        ) : (
          <div className="rr-book-cover-fallback">{file.basename}</div>
        )}
      </div>
      <div className="rr-book-meta">
        <div className="rr-book-title">{details?.title || file.basename}</div>
        <div className="rr-book-author">{details?.author ?? ''}</div>
      </div>
      <div className="rr-book-progress">
        <div className="rr-book-progress-fill" style={{ width: `${frac * 100}%` }} />
      </div>
      <div className="rr-book-footer">
        <span className="rr-book-pct">{frac > 0 ? `${Math.round(frac * 100)}%` : 'Unread'}</span>
        {highlights > 0 && <span className="rr-book-hl">{highlights} ✎</span>}
      </div>
    </div>
  );
});
