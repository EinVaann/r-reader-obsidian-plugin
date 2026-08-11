import { FileView, Notice, Platform, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type RReaderPlugin from '../main';
import { EpubReader } from './readers/EpubReader';
import { MobileControls } from './mobile/MobileControls';
import { SelectionToolbar } from './annotations/SelectionToolbar';
import { TocPanel } from './toc/TocPanel';
import { SearchController } from './search/SearchController';
import { makeId } from './annotations/AnnotationManager';
import type { Highlight, HighlightColor } from './annotations/types';
import type { QuoteAnchor } from './annotations/anchor';
import { exportBookNotes } from './export/exportNotes';
import { promptForText } from './ui/PromptModal';
import { metaAuthor, metaTitle, type BookMeta } from './util/bookMeta';
import type { Reader, ReaderHost } from './types';
import type { Theme } from './settings/settings';

/** Curated reading fonts offered in the quick-settings popover. */
const FONT_OPTIONS: { label: string; value: string }[] = [
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

export const READER_VIEW_TYPE = 'r-reader-view';

export class ReaderView extends FileView implements ReaderHost {
  plugin: RReaderPlugin;
  private reader: Reader | null = null;
  private mobile: MobileControls | null = null;

  private rootEl: HTMLElement | null = null;
  private contentArea: HTMLElement | null = null;
  private pageIndicator: HTMLElement | null = null;
  private settingsPanel: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private sliderEl: HTMLElement | null = null;
  private sliderFill: HTMLElement | null = null;
  private sliderThumb: HTMLElement | null = null;
  private sliderLabel: HTMLElement | null = null;
  private sliderActive = false;
  private chromeHidden = false;

  private selectionToolbar: SelectionToolbar | null = null;
  private tocPanel: TocPanel | null = null;
  private searchController: SearchController | null = null;
  private tocButton: HTMLElement | null = null;
  private searchButton: HTMLElement | null = null;
  private lastQuery = '';
  private currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  /** The active reader as an EpubReader (the only reader type today), or null. */
  private get epub(): EpubReader | null {
    return this.reader instanceof EpubReader ? this.reader : null;
  }

  getViewType(): string {
    return READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'R Reader';
  }

  // --- ReaderHost ---
  setProgress(current: number, total: number, fraction: number): void {
    const text = total > 0 ? `${current} / ${total}` : '…';
    this.pageIndicator?.setText(text);
    this.sliderLabel?.setText(text);
    // Don't fight the user while they're dragging the slider.
    if (!this.sliderActive) this.updateSliderVisual(fraction);
  }

  private updateSliderVisual(fraction: number): void {
    const pct = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    if (this.sliderFill) this.sliderFill.style.width = pct;
    if (this.sliderThumb) this.sliderThumb.style.left = pct;
  }

  setLoading(loading: boolean): void {
    this.loadingEl?.toggleClass('is-visible', loading);
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.reader?.destroy();
    this.mobile?.unmount();

    const { settings } = this.plugin;

    // Full-bleed: drop Obsidian's default view padding and anchor the
    // absolutely-positioned reader root to the view content box.
    this.contentEl.style.padding = '0';
    this.contentEl.style.position = 'relative';

    const root = this.contentEl.createDiv({ cls: 'rr-reader-root' });
    if (Platform.isMobile) root.addClass('rr-mobile');
    this.applyCssVars(root);
    this.rootEl = root;

    this.buildTopBar(root);

    const content = root.createDiv({ cls: 'rr-content' });
    this.contentArea = content;

    const overlay = content.createDiv({ cls: 'rr-loading is-visible' });
    overlay.createDiv({ cls: 'rr-spinner' });
    overlay.createDiv({ cls: 'rr-loading-text', text: 'Loading…' });
    this.loadingEl = overlay;

    // Bottom progress bar with a scrub slider (primary navigation on mobile).
    this.buildBottomBar(root);

    const arrayBuffer = await this.app.vault.readBinary(file);
    const ext = file.extension.toLowerCase();

    if (ext === 'epub') {
      const highlights = this.plugin.annotationManager.get(file.path).highlights;
      this.reader = new EpubReader(
        content,
        file.path,
        settings,
        this.plugin.progressManager,
        this,
        this.plugin.epubCache,
        file.stat.mtime,
        highlights,
      );
    } else {
      content.createEl('p', { text: `Unsupported format: .${ext}` });
      return;
    }

    try {
      await this.reader.mount(arrayBuffer);
    } catch (e) {
      this.setLoading(false);
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      content.createDiv({ cls: 'rr-error', text: `Failed to open EPUB:\n${msg}` });
      console.error('R Reader: mount failed', e);
      return;
    }

    this.setupAnnotationLayer(file);

    if (Platform.isMobile && settings.touchToScroll) {
      this.mobile = new MobileControls(
        content,
        (dir) => this.reader?.navigate(dir),
        () => this.toggleChrome(),
      );
      this.mobile.mount();
    }

    // Position the bottom bar above Obsidian's own mobile navbar.
    if (Platform.isMobile) {
      this.measureMobileNavbar();
      requestAnimationFrame(() => this.measureMobileNavbar());
      this.registerDomEvent(window, 'resize', () => this.measureMobileNavbar());
    }

    // Start immersive on mobile if the user opted in.
    if (Platform.isMobile && settings.hideBarsOnMobile) {
      this.setChromeHidden(true);
    }
  }

  /** Measure Obsidian's mobile bottom navbar so our bottom bar can sit above it. */
  private measureMobileNavbar(): void {
    if (!this.rootEl) return;
    const navbar = document.body.querySelector<HTMLElement>('.mobile-navbar');
    const h = navbar && navbar.offsetParent !== null ? navbar.offsetHeight : 0;
    this.rootEl.style.setProperty('--rr-navbar-h', `${h}px`);
  }

  private applyCssVars(el: HTMLElement): void {
    const { settings } = this.plugin;
    el.style.setProperty('--rr-font-family', settings.fontFamily);
    el.style.setProperty('--rr-font-size', `${settings.fontSize}px`);
    el.style.setProperty('--rr-line-height', String(settings.lineHeight));
  }

  private buildTopBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'rr-topbar' });

    // Left: version badge (also confirms which build is loaded) + title.
    bar.createDiv({ cls: 'rr-topbar-title', text: `v${this.plugin.manifest.version}` });

    const toc = bar.createEl('button', { cls: 'rr-iconbtn rr-keep-mobile', attr: { 'aria-label': 'Table of contents' } });
    setIcon(toc, 'list');
    toc.onclick = () => this.openTableOfContents();
    this.tocButton = toc;

    const search = bar.createEl('button', { cls: 'rr-iconbtn rr-keep-mobile', attr: { 'aria-label': 'Search in book' } });
    setIcon(search, 'search');
    search.onclick = () => this.openSearch();
    this.searchButton = search;

    const prev = bar.createEl('button', { cls: 'rr-iconbtn', attr: { 'aria-label': 'Previous' } });
    setIcon(prev, 'chevron-left');
    prev.onclick = () => this.reader?.navigate(-1);

    this.pageIndicator = bar.createDiv({ cls: 'rr-page-indicator', text: '…' });

    const next = bar.createEl('button', { cls: 'rr-iconbtn', attr: { 'aria-label': 'Next' } });
    setIcon(next, 'chevron-right');
    next.onclick = () => this.reader?.navigate(1);

    const gear = bar.createEl('button', { cls: 'rr-iconbtn rr-gear', attr: { 'aria-label': 'Reader settings' } });
    setIcon(gear, 'settings-2');
    gear.onclick = () => this.toggleSettingsPanel(root);
  }

  private buildBottomBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'rr-bottombar' });

    // Centered page count above a custom full-width progress slider.
    this.sliderLabel = bar.createDiv({ cls: 'rr-slider-label', text: '…' });

    // Custom slider built from divs (no native <input type=range>, which won't
    // reliably stretch full width in the mobile WebView). A div track with
    // left:0/right:0 is always full width.
    const slider = bar.createDiv({ cls: 'rr-slider', attr: { 'aria-label': 'Reading progress' } });
    this.sliderEl = slider;
    slider.createDiv({ cls: 'rr-slider-track' });
    this.sliderFill = slider.createDiv({ cls: 'rr-slider-fill' });
    this.sliderThumb = slider.createDiv({ cls: 'rr-slider-thumb' });

    const seekFromX = (clientX: number): void => {
      const rect = slider.getBoundingClientRect();
      const frac = rect.width > 0 ? Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) : 0;
      this.updateSliderVisual(frac);
      this.reader?.seek(frac);
    };

    slider.addEventListener('pointerdown', (e: PointerEvent) => {
      this.sliderActive = true;
      slider.setPointerCapture(e.pointerId);
      seekFromX(e.clientX);
      e.preventDefault();
      e.stopPropagation();
    });
    slider.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.sliderActive) {
        seekFromX(e.clientX);
        e.stopPropagation();
      }
    });
    const end = (e: PointerEvent): void => {
      if (!this.sliderActive) return;
      this.sliderActive = false;
      e.stopPropagation();
      try { slider.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);

    // Prevent the OS / Obsidian swipe-back gesture from firing while the user
    // scrubs the slider. Touch events are what the native swipe detector sees,
    // so we block them here at the slider level (passive:false so preventDefault works).
    slider.addEventListener('touchstart', (e: TouchEvent) => {
      e.stopPropagation();
    }, { passive: true });
    slider.addEventListener('touchmove', (e: TouchEvent) => {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
  }

  private toggleChrome(): void {
    this.setChromeHidden(!this.chromeHidden);
  }

  /** Wire up highlighting (selection toolbar + highlight-click editor). */
  private setupAnnotationLayer(file: TFile): void {
    const epub = this.epub;
    if (!epub || !this.rootEl) return;
    const contentEl = epub.getContentEl();
    if (!contentEl) return;
    this.currentFile = file;
    const path = file.path;

    const toolbar = new SelectionToolbar(this.rootEl, contentEl, {
      captureSelection: () => epub.captureCurrentSelection(),
      defaultColor: () => this.plugin.settings.defaultHighlightColor,
      getHighlight: (id) => this.plugin.annotationManager.get(path).highlights.find((h) => h.id === id),
      onCreate: (anchor: QuoteAnchor, color: HighlightColor): Highlight | null => {
        const h: Highlight = {
          id: makeId(),
          chapterIndex: anchor.chapterIndex,
          text: anchor.text,
          prefix: anchor.prefix,
          suffix: anchor.suffix,
          color,
          createdAt: Date.now(),
        };
        if (!epub.renderHighlight(h)) {
          new Notice('R Reader: could not place that highlight');
          return null;
        }
        void this.plugin.annotationManager.addHighlight(path, h);
        return h;
      },
      onRecolor: (id, color) => {
        epub.setHighlightColor(id, color);
        void this.plugin.annotationManager.updateHighlight(path, id, { color });
      },
      onSetNote: (id, note) => {
        void this.plugin.annotationManager.updateHighlight(path, id, { note });
      },
      onDelete: (id) => {
        epub.removeHighlightSpans(id);
        void this.plugin.annotationManager.removeHighlight(path, id);
      },
    });
    toolbar.mount();
    this.selectionToolbar = toolbar;

    epub.onHighlightClick = (id, el) => toolbar.openHighlightEditor(id, el);
  }

  // --- Public actions for command-palette commands ---
  /** Toggle distraction-free reading (hide the top/bottom bars). */
  toggleImmersive(): void {
    this.toggleChrome();
  }

  /** Scroll a screen forward (1) or backward (-1). */
  pageNavigate(dir: 1 | -1): void {
    this.reader?.navigate(dir);
  }

  /** Open the in-reader quick-settings popover (theme/font/bookmarks). */
  openQuickSettings(): void {
    if (this.rootEl) this.toggleSettingsPanel(this.rootEl);
  }

  /** Open the searchable table of contents (popover on desktop, overlay on mobile). */
  openTableOfContents(): void {
    const epub = this.epub;
    if (!epub || !this.rootEl) return;
    if (!this.tocPanel) {
      this.tocPanel = new TocPanel(this.rootEl, {
        getToc: () => epub.getToc(),
        onJump: (entry) => epub.goToChapter(entry.index, entry.id),
        isMobile: Platform.isMobile,
        closeAfterJump: () => this.plugin.settings.closeMenuAfterTocJump,
      });
    }
    this.tocPanel.toggle(this.tocButton ?? undefined);
  }

  /** Open the in-book search (popover on desktop, overlay on mobile). */
  openSearch(): void {
    const epub = this.epub;
    if (!epub || !this.rootEl) return;
    if (!this.searchController) {
      this.searchController = new SearchController(this.rootEl, {
        search: (q) => { this.lastQuery = q; return epub.search(q); },
        onJump: (hit) => epub.jumpToMatch(hit.chapterIndex, this.lastQuery),
        onClose: () => epub.clearSearchMark(),
        isMobile: Platform.isMobile,
      });
    }
    this.searchController.toggle(this.searchButton ?? undefined);
  }

  /** Bookmark the current reading position (prompts for a name). */
  async addBookmarkAtCurrent(): Promise<void> {
    const epub = this.epub;
    const file = this.currentFile;
    if (!epub || !file) return;
    const loc = epub.getCurrentLocation();
    const toc = epub.getToc();
    let label = '';
    for (const e of toc) if (e.index >= 0 && e.index <= loc.chapterIndex) label = e.label;
    const count = this.plugin.annotationManager.get(file.path).bookmarks.length;
    const defaultName = label || `Bookmark ${count + 1}`;

    const name = await promptForText(this.app, {
      title: 'Name this bookmark',
      defaultValue: defaultName,
      placeholder: 'Bookmark name',
    });
    if (name === null) return; // cancelled

    await this.plugin.annotationManager.addBookmark(file.path, {
      id: makeId(),
      chapterIndex: loc.chapterIndex,
      anchorId: loc.anchorId,
      fraction: loc.fraction,
      name,
      createdAt: Date.now(),
    });
    new Notice(`R Reader: bookmarked “${name}”`);
  }

  /** Export this book's highlights + bookmarks to a Markdown note. */
  async exportNotes(): Promise<void> {
    const epub = this.epub;
    const file = this.currentFile;
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

  private setChromeHidden(hidden: boolean): void {
    this.chromeHidden = hidden;
    this.rootEl?.toggleClass('rr-chrome-hidden', hidden);
    // Also hide Obsidian's own mobile chrome (view header + bottom navbar) for
    // a true full-screen read. Scoped to a body class we remove on teardown.
    if (Platform.isMobile) {
      document.body.toggleClass('rr-immersive', hidden);
      // When bars return, Obsidian's navbar reappears — re-measure the offset.
      if (!hidden) requestAnimationFrame(() => this.measureMobileNavbar());
    }
    // Hiding the bars should also dismiss the open settings popover.
    if (hidden && this.settingsPanel) {
      this.settingsPanel.remove();
      this.settingsPanel = null;
    }
  }

  private toggleSettingsPanel(root: HTMLElement): void {
    if (this.settingsPanel) {
      this.settingsPanel.remove();
      this.settingsPanel = null;
      return;
    }
    const panel = root.createDiv({ cls: 'rr-quick-settings' });
    this.settingsPanel = panel;
    const { settings } = this.plugin;

    // Theme row
    const themeRow = panel.createDiv({ cls: 'rr-qs-row' });
    themeRow.createSpan({ text: 'Theme', cls: 'rr-qs-label' });
    const themes: Theme[] = ['obsidian', 'light', 'dark', 'sepia'];
    for (const t of themes) {
      const btn = themeRow.createEl('button', { cls: 'rr-qs-chip', text: t });
      if (settings.theme === t) btn.addClass('is-active');
      btn.onclick = async () => {
        this.plugin.settings.theme = t;
        await this.plugin.saveSettings();
        themeRow.findAll('.rr-qs-chip').forEach((c) => c.removeClass('is-active'));
        btn.addClass('is-active');
      };
    }

    // Font size row
    this.buildStepperRow(panel, 'Font size', () => `${this.plugin.settings.fontSize}px`, async (delta) => {
      this.plugin.settings.fontSize = Math.min(36, Math.max(12, this.plugin.settings.fontSize + delta));
      await this.plugin.saveSettings();
    });

    // Line height row
    this.buildStepperRow(panel, 'Line height', () => this.plugin.settings.lineHeight.toFixed(1), async (delta) => {
      const next = Math.min(2.5, Math.max(1.0, this.plugin.settings.lineHeight + delta * 0.1));
      this.plugin.settings.lineHeight = Math.round(next * 10) / 10;
      await this.plugin.saveSettings();
    });

    // Font family row
    this.buildFontRow(panel);

    // Bookmarks list + add button
    this.buildBookmarksSection(panel);

    // Export reading notes
    const exportRow = panel.createDiv({ cls: 'rr-qs-row' });
    exportRow.createSpan({ text: 'Notes', cls: 'rr-qs-label' });
    const exportBtn = exportRow.createEl('button', { cls: 'rr-qs-chip rr-qs-wide', text: 'Export to note' });
    exportBtn.onclick = () => void this.exportNotes();
  }

  private buildBookmarksSection(panel: HTMLElement): void {
    const epub = this.epub;
    const file = this.currentFile;
    if (!epub || !file) return;

    const header = panel.createDiv({ cls: 'rr-qs-row' });
    header.createSpan({ text: 'Bookmarks', cls: 'rr-qs-label' });
    const add = header.createEl('button', { cls: 'rr-qs-chip', text: '+ Add' });
    add.onclick = async () => {
      await this.addBookmarkAtCurrent();
      // Rebuild the list in place.
      this.settingsPanel?.remove();
      this.settingsPanel = null;
      if (this.rootEl) this.toggleSettingsPanel(this.rootEl);
    };

    const bookmarks = this.plugin.annotationManager.get(file.path).bookmarks;
    if (bookmarks.length === 0) return;

    const list = panel.createDiv({ cls: 'rr-bookmark-list' });
    for (const b of bookmarks) {
      const row = list.createDiv({ cls: 'rr-bookmark-row' });
      const jump = row.createEl('button', { cls: 'rr-bookmark-jump', text: b.name });
      jump.onclick = () => {
        epub.goToLocation(b);
        if (this.plugin.settings.closeMenuAfterTocJump) {
          this.settingsPanel?.remove();
          this.settingsPanel = null;
        }
      };
      const del = row.createEl('button', { cls: 'rr-bookmark-del', attr: { 'aria-label': 'Delete bookmark' } });
      setIcon(del, 'trash-2');
      del.onclick = async () => {
        await this.plugin.annotationManager.removeBookmark(file.path, b.id);
        row.remove();
      };
    }
  }

  private buildFontRow(panel: HTMLElement): void {
    const row = panel.createDiv({ cls: 'rr-qs-row' });
    row.createSpan({ text: 'Font', cls: 'rr-qs-label' });
    const select = row.createEl('select', { cls: 'rr-qs-select' });

    const current = this.plugin.settings.fontFamily;
    const options = FONT_OPTIONS.slice();
    if (!options.some((o) => o.value === current)) {
      options.unshift({ label: 'Custom', value: current });
    }
    for (const opt of options) {
      const el = select.createEl('option', { text: opt.label, value: opt.value });
      el.style.fontFamily = opt.value;
      if (opt.value === current) el.selected = true;
    }
    select.onchange = async () => {
      this.plugin.settings.fontFamily = select.value;
      await this.plugin.saveSettings();
    };
  }

  private buildStepperRow(
    panel: HTMLElement,
    label: string,
    value: () => string,
    onStep: (delta: number) => Promise<void>,
  ): void {
    const row = panel.createDiv({ cls: 'rr-qs-row' });
    row.createSpan({ text: label, cls: 'rr-qs-label' });
    const minus = row.createEl('button', { cls: 'rr-qs-chip', text: '−' });
    const val = row.createSpan({ cls: 'rr-qs-value', text: value() });
    const plus = row.createEl('button', { cls: 'rr-qs-chip', text: '+' });
    minus.onclick = async () => { await onStep(-1); val.setText(value()); };
    plus.onclick = async () => { await onStep(1); val.setText(value()); };
  }

  onUnloadFile(_file: TFile): Promise<void> {
    this.teardown();
    return Promise.resolve();
  }

  /** Called by the plugin when settings change; updates the open reader live. */
  refreshSettings(): void {
    if (this.rootEl) this.applyCssVars(this.rootEl);
    this.reader?.applySettings(this.plugin.settings);
  }

  private teardown(): void {
    // Always restore Obsidian's chrome when leaving the reader.
    document.body.removeClass('rr-immersive');
    this.selectionToolbar?.unmount();
    this.selectionToolbar = null;
    this.tocPanel?.close();
    this.tocPanel = null;
    this.searchController?.close();
    this.searchController = null;
    this.tocButton = null;
    this.searchButton = null;
    this.currentFile = null;
    this.lastQuery = '';
    this.reader?.destroy();
    this.reader = null;
    this.mobile?.unmount();
    this.mobile = null;
    this.rootEl = null;
    this.contentArea = null;
    this.pageIndicator = null;
    this.settingsPanel = null;
    this.loadingEl = null;
    this.sliderEl = null;
    this.sliderFill = null;
    this.sliderThumb = null;
    this.sliderLabel = null;
    this.sliderActive = false;
    this.chromeHidden = false;
  }

  async onClose(): Promise<void> {
    this.teardown();
  }
}
