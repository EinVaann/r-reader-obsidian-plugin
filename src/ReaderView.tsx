import { FileView, Notice, Platform, TFile, WorkspaceLeaf } from 'obsidian';
import type RReaderPlugin from '../main';
import { EpubReader, type FoliateBook } from './readers/EpubReader';
import { openArkBook } from './readers/ark/arkBook';
import { ArkInteractions } from './readers/ark/ArkInteractions';
import { MobileControls } from './mobile/MobileControls';
import { makeId } from './annotations/AnnotationManager';
import type { Highlight } from './annotations/types';
import { exportBookNotes } from './export/exportNotes';
import { promptForText } from './ui/PromptModal';
import { metaAuthor, metaTitle, type BookMeta } from './util/bookMeta';
import type { ReaderHost } from './types';
import { mountReact } from './react/mount';
import { createReaderStore, type ReaderPanel, type ReaderStore } from './reader/store';
import { ReaderContext, type HighlightActions, type ReaderActions, type ReaderContextValue } from './reader/context';
import { ReaderApp } from './reader/ReaderApp';

export const READER_VIEW_TYPE = 'r-reader-view';

const isArk = (file: TFile): boolean => file.extension.toLowerCase() === 'ark';

/**
 * A reader pane. Obsidian side only: it owns the EpubReader (which renders the
 * book) and acts as its host, publishing progress / chapter / loading state
 * into a store the React frame (`ReaderApp`) renders from.
 */
export class ReaderView extends FileView implements ReaderHost {
  plugin: RReaderPlugin;
  private reader: EpubReader | null = null;
  private mobile: MobileControls | null = null;
  private store: ReaderStore | null = null;
  private unmount: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  /** The element the current book is mounted in (guards double mounts). */
  private bookEl: HTMLElement | null = null;
  private highlightClick: ((id: string, el: HTMLElement) => void) | null = null;
  /** Choice / audio handling for an open `.ark` story. */
  private ark: ArkInteractions | null = null;
  /** Tab title from the book's metadata, when it beats the file name. */
  private bookTitle: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.bookTitle ?? this.file?.basename ?? 'R Reader';
  }

  async onOpen(): Promise<void> {
    // Keep the bottom bar above Obsidian's own mobile navbar.
    if (Platform.isMobile) this.registerDomEvent(window, 'resize', () => this.measureMobileNavbar());
  }

  // --- ReaderHost (called by the EpubReader) ---------------------------------

  setProgress(current: number, total: number, fraction: number): void {
    this.store?.setState({ progress: { current, total, fraction } });
  }

  setMilestones(fractions: number[]): void {
    this.store?.setState({ milestones: fractions });
  }

  setChapterLabel(label: string): void {
    if (this.store && this.store.getState().chapterLabel !== label) this.store.setState({ chapterLabel: label });
  }

  setEntryNav(prev: boolean, next: boolean): void {
    const nav = this.store?.getState().entryNav;
    if (nav && (nav.prev !== prev || nav.next !== next)) this.store!.setState({ entryNav: { prev, next } });
  }

  setLoading(loading: boolean): void {
    this.store?.setState({ loading });
  }

  // --- File lifecycle --------------------------------------------------------

  async onLoadFile(file: TFile): Promise<void> {
    this.teardown();
    // Full-bleed: drop Obsidian's view padding; the reader root fills the view.
    this.contentEl.empty();
    this.contentEl.style.padding = '0';
    this.contentEl.style.position = 'relative';

    const store = createReaderStore(file.basename);
    this.store = store;
    // Immersive mode also hides Obsidian's own mobile chrome.
    this.unsubscribe = store.subscribe((s, prev) => {
      if (s.chromeHidden !== prev.chromeHidden) this.onChromeChange(s.chromeHidden);
    });

    const ctx: ReaderContextValue = {
      app: this.app,
      store,
      settings: this.plugin.settingsStore,
      actions: this.makeActions(file),
      highlights: this.makeHighlightActions(file),
      isMobile: Platform.isMobile,
      version: this.plugin.manifest.version,
    };
    this.unmount = mountReact(
      this.app,
      this.contentEl,
      <ReaderContext.Provider value={ctx}>
        <ReaderApp title={file.basename} />
      </ReaderContext.Provider>,
    );
  }

  onUnloadFile(_file: TFile): Promise<void> {
    this.teardown();
    return Promise.resolve();
  }

  async onClose(): Promise<void> {
    this.teardown();
  }

  /** Mount the book once the React frame has rendered its (empty) book element. */
  private async openBook(file: TFile, contentArea: HTMLElement, bookEl: HTMLElement): Promise<void> {
    const store = this.store;
    if (!store) return;
    const ext = file.extension.toLowerCase();
    if (ext !== 'epub' && ext !== 'ark') {
      store.setState({ loading: false, error: `Unsupported format: .${file.extension}` });
      return;
    }

    const { settings } = this.plugin;
    let source: ArrayBuffer | FoliateBook;
    try {
      source =
        ext === 'ark'
          ? await openArkBook(this.app, file, { nickname: settings.storyNickname, assetsFolder: settings.storyAssetsFolder })
          : await this.app.vault.readBinary(file);
    } catch (e) {
      store.setState({ loading: false, error: `Failed to open .${ext}:\n${e instanceof Error ? e.message : String(e)}` });
      console.error('R Reader: open failed', e);
      return;
    }
    if (this.store !== store) return; // switched to another file meanwhile

    const reader = new EpubReader(
      bookEl,
      file.path,
      settings,
      this.plugin.progressManager,
      this,
      this.plugin.epubCache,
      file.stat.mtime,
      isArk(file) ? [] : this.plugin.annotationManager.get(file.path).highlights,
    );
    this.reader = reader;
    try {
      await (source instanceof ArrayBuffer ? reader.mount(source) : reader.mountBook(source));
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      store.setState({ loading: false, error: `Failed to open .${ext}:\n${msg}` });
      console.error('R Reader: mount failed', e);
      return;
    }
    if (this.store !== store) return;

    const contentEl = reader.getContentEl();
    if (ext === 'ark' && contentEl) {
      this.ark = new ArkInteractions(contentEl, reader.getScrollEl());
      this.ark.setNickname(settings.storyNickname);
      this.ark.setAutoplay(settings.storyAutoplayMusic);
    }
    // Stories are named by their manifest ("manifest.ark"); show the story title instead.
    this.bookTitle = ext === 'ark' ? reader.getMetadata()?.title ?? null : null;
    if (this.bookTitle) (this.leaf as unknown as { updateHeader?: () => void }).updateHeader?.();

    reader.onHighlightClick = (id, el) => this.highlightClick?.(id, el);
    store.setState({ ready: true });

    if (Platform.isMobile) {
      if (settings.touchToScroll) {
        this.mobile = new MobileControls(contentArea, (dir) => this.reader?.navigate(dir), () => this.toggleChrome());
        this.mobile.mount();
      }
      this.measureMobileNavbar();
      requestAnimationFrame(() => this.measureMobileNavbar());
      // Start immersive if the user opted in.
      if (settings.hideBarsOnMobile) store.setState({ chromeHidden: true });
    }
  }

  private teardown(): void {
    // Always restore Obsidian's chrome when leaving the reader.
    document.body.removeClass('rr-immersive');
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ark?.destroy();
    this.ark = null;
    this.bookTitle = null;
    this.reader?.destroy();
    this.reader = null;
    this.mobile?.unmount();
    this.mobile = null;
    this.unmount?.();
    this.unmount = null;
    this.store = null;
    this.bookEl = null;
    this.highlightClick = null;
  }

  // --- Actions for the React frame -------------------------------------------

  private makeActions(file: TFile): ReaderActions {
    const epub = (): EpubReader | null => this.reader;
    return {
      contentReady: (contentArea, bookEl) => {
        // StrictMode runs layout effects twice in development; mount once.
        if (this.bookEl === bookEl) return;
        this.bookEl = bookEl;
        void this.openBook(file, contentArea, bookEl);
      },
      navigate: (dir) => epub()?.navigate(dir),
      seek: (f) => epub()?.seek(f),
      jumpEntry: (dir) => epub()?.jumpEntry(dir),
      toggleChrome: () => this.toggleChrome(),
      setPanel: (panel) => this.setPanel(panel),

      getToc: () => epub()?.getToc() ?? [],
      jumpToToc: (entry) => epub()?.goToChapter(entry.index, entry.id),
      search: (q) => epub()?.search(q) ?? [],
      jumpToHit: (hit, q) => epub()?.jumpToMatch(hit.chapterIndex, q),
      clearSearch: () => epub()?.clearSearchMark(),

      getBookmarks: () => this.plugin.annotationManager.get(file.path).bookmarks,
      addBookmark: () => this.addBookmarkAtCurrent(),
      goToBookmark: (b) => epub()?.goToLocation(b),
      deleteBookmark: async (id) => {
        await this.plugin.annotationManager.removeBookmark(file.path, id);
        this.bumpBookmarks();
      },
      exportNotes: () => void this.exportNotes(),

      updateSettings: (patch) => {
        Object.assign(this.plugin.settings, patch);
        void this.plugin.saveSettings();
      },
    };
  }

  private makeHighlightActions(file: TFile): HighlightActions {
    const path = file.path;
    const notes = this.plugin.annotationManager;
    // No content element means no selection toolbar: stories (.ark) aren't highlightable.
    const highlightable = !isArk(file);
    return {
      getContentEl: () => (highlightable ? this.reader?.getContentEl() ?? null : null),
      captureSelection: () => this.reader?.captureCurrentSelection() ?? null,
      getHighlight: (id) => notes.get(path).highlights.find((h) => h.id === id),
      create: (anchor, color) => {
        const h: Highlight = {
          id: makeId(),
          chapterIndex: anchor.chapterIndex,
          text: anchor.text,
          prefix: anchor.prefix,
          suffix: anchor.suffix,
          color,
          createdAt: Date.now(),
        };
        if (!this.reader?.renderHighlight(h)) {
          new Notice('R Reader: could not place that highlight');
          return null;
        }
        void notes.addHighlight(path, h);
        return h;
      },
      recolor: (id, color) => {
        this.reader?.setHighlightColor(id, color);
        void notes.updateHighlight(path, id, { color });
      },
      setNote: (id, note) => void notes.updateHighlight(path, id, { note }),
      remove: (id) => {
        this.reader?.removeHighlightSpans(id);
        void notes.removeHighlight(path, id);
      },
      onHighlightClick: (handler) => {
        this.highlightClick = handler;
      },
    };
  }

  private setPanel(panel: ReaderPanel): void {
    // Nothing to show for a book without a table of contents.
    if (panel === 'toc' && (this.reader?.getToc().length ?? 0) === 0) return;
    this.store?.setState({ panel });
  }

  private bumpBookmarks(): void {
    this.store?.setState((s) => ({ bookmarksVersion: s.bookmarksVersion + 1 }));
  }

  private toggleChrome(): void {
    const store = this.store;
    if (!store) return;
    const hidden = !store.getState().chromeHidden;
    // Hiding the bars also dismisses the quick-settings menu.
    store.setState(hidden && store.getState().panel === 'settings' ? { chromeHidden: hidden, panel: null } : { chromeHidden: hidden });
  }

  private onChromeChange(hidden: boolean): void {
    if (!Platform.isMobile) return;
    document.body.toggleClass('rr-immersive', hidden);
    // When the bars return, Obsidian's navbar reappears — re-measure the offset.
    if (!hidden) requestAnimationFrame(() => this.measureMobileNavbar());
  }

  /** Measure Obsidian's mobile bottom navbar so our bottom bar can sit above it. */
  private measureMobileNavbar(): void {
    const root = this.contentEl.querySelector<HTMLElement>('.rr-reader-root');
    if (!root) return;
    const navbar = document.body.querySelector<HTMLElement>('.mobile-navbar');
    let h = 0;
    if (navbar && navbar.offsetParent !== null) {
      // The floating navbar sits above a bottom gap offsetHeight doesn't include.
      const overlap = root.getBoundingClientRect().bottom - navbar.getBoundingClientRect().top;
      h = Math.max(0, Math.ceil(overlap));
    }
    root.style.setProperty('--rr-navbar-h', `${h}px`);
  }

  // --- Commands (also used by the frame) -------------------------------------

  /** Toggle distraction-free reading (hide the top/bottom bars). */
  toggleImmersive(): void {
    this.toggleChrome();
  }

  /** Scroll a screen forward (1) or backward (-1). */
  pageNavigate(dir: 1 | -1): void {
    this.reader?.navigate(dir);
  }

  openQuickSettings(): void {
    this.togglePanel('settings');
  }

  openTableOfContents(): void {
    this.togglePanel('toc');
  }

  openSearch(): void {
    this.togglePanel('search');
  }

  private togglePanel(panel: Exclude<ReaderPanel, null>): void {
    this.setPanel(this.store?.getState().panel === panel ? null : panel);
  }

  /** Bookmark the current reading position (prompts for a name). */
  async addBookmarkAtCurrent(): Promise<void> {
    const epub = this.reader;
    const file = this.file;
    if (!epub || !file) return;
    const loc = epub.getCurrentLocation();
    let label = '';
    for (const e of epub.getToc()) if (e.index >= 0 && e.index <= loc.chapterIndex) label = e.label;
    const count = this.plugin.annotationManager.get(file.path).bookmarks.length;

    const name = await promptForText(this.app, {
      title: 'Name this bookmark',
      defaultValue: label || `Bookmark ${count + 1}`,
      placeholder: 'Bookmark name',
    });
    if (name === null) return;

    await this.plugin.annotationManager.addBookmark(file.path, {
      id: makeId(),
      chapterIndex: loc.chapterIndex,
      anchorId: loc.anchorId,
      fraction: loc.fraction,
      name,
      createdAt: Date.now(),
    });
    this.bumpBookmarks();
    new Notice(`R Reader: bookmarked “${name}”`);
  }

  /** Export this book's highlights + bookmarks to a Markdown note. */
  async exportNotes(): Promise<void> {
    const epub = this.reader;
    const file = this.file;
    if (!epub || !file) return;
    const ann = this.plugin.annotationManager.get(file.path);
    if (ann.highlights.length === 0 && ann.bookmarks.length === 0) {
      new Notice('R Reader: no highlights or bookmarks to export yet');
      return;
    }
    const meta = (epub.getMetadata() ?? {}) as BookMeta;
    await exportBookNotes(
      this.app,
      file,
      ann,
      epub.getToc(),
      { title: metaTitle(meta, file.basename), author: metaAuthor(meta) },
      this.plugin.settings.notesExportFolder,
    );
  }

  /** Called by the plugin when settings change; the reader re-themes live. */
  refreshSettings(): void {
    this.reader?.applySettings(this.plugin.settings);
    this.ark?.setNickname(this.plugin.settings.storyNickname);
    this.ark?.setAutoplay(this.plugin.settings.storyAutoplayMusic);
  }
}
