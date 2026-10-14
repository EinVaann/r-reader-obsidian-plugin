import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { READER_VIEW_TYPE, ReaderView } from './src/ReaderView';
import { RReaderSettingsTab } from './src/settings/SettingsTab';
import { DEFAULT_SETTINGS, type PluginSettings, type Theme } from './src/settings/settings';
import { ProgressManager } from './src/reading-progress/ProgressManager';
import { AnnotationManager } from './src/annotations/AnnotationManager';
import type { HighlightColor } from './src/annotations/types';
import { HIGHLIGHT_COLORS } from './src/annotations/types';
import { LIBRARY_VIEW_TYPE, LibraryView } from './src/library/LibraryView';
import { CoverCache } from './src/library/CoverCache';
import type { EpubCacheEntry } from './src/readers/EpubReader';
import { createSettingsStore, type SettingsStore } from './src/reader/store';
import {
  type ReadingData,
  emptyReadingData,
  mergeReadingData,
  normalizeDataPath,
  readingDataFrom,
} from './src/reading-progress/readingData';

/** data.json. The reading data is left out when it lives in a vault file instead. */
interface RReaderData extends Partial<ReadingData> {
  settings?: Partial<PluginSettings>;
}

export default class RReaderPlugin extends Plugin {
  settings!: PluginSettings;
  progressManager!: ProgressManager;
  annotationManager!: AnnotationManager;
  /** In-memory cache of rendered EPUB HTML. Cleared on demand or plugin unload. */
  epubCache = new Map<string, EpubCacheEntry>();
  /** Library cover thumbnails + metadata, persisted to the plugin folder. */
  coverCache = new CoverCache(this);
  /** Settings mirrored for the React UI; refreshed by every saveSettings(). */
  settingsStore!: SettingsStore;
  /** Writes queued one after another, so an older snapshot never lands last. */
  private writeChain: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    // Settings always live in data.json. Reading progress and annotations sit
    // beside them there by default, or in the vault file `readingDataPath`
    // names. (Very old installs stored the settings at the top level.)
    const raw = (await this.loadData()) as (RReaderData & Partial<PluginSettings>) | null;
    const settingsData: Partial<PluginSettings> = raw?.settings
      ?? (raw && 'theme' in raw ? (raw as Partial<PluginSettings>) : {});

    this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
    // One-time move off the old hard-coded 'dark' default: existing vaults that
    // never touched the theme now follow the Obsidian theme like the library does.
    if (!settingsData.themeMigratedToObsidian) {
      if (this.settings.theme === 'dark') this.settings.theme = 'obsidian';
      this.settings.themeMigratedToObsidian = true;
    }
    // One-time switch of existing installs to the side progress rail.
    if (!settingsData.progressMigratedToRight) {
      this.settings.progressBarPosition = 'right';
      this.settings.progressMigratedToRight = true;
    }
    this.settingsStore = createSettingsStore(this.settings);
    this.settings.readingDataPath = normalizeDataPath(this.settings.readingDataPath);
    const reading = await this.loadReadingData(raw);
    this.progressManager = new ProgressManager(this);
    this.annotationManager = new AnnotationManager(this);
    this.useReadingData(reading);

    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
    this.registerView(LIBRARY_VIEW_TYPE, (leaf) => new LibraryView(leaf, this));
    this.registerExtensions(['epub', 'ark'], READER_VIEW_TYPE);
    this.applyFileVisibility();

    // "ResizeObserver loop completed with undelivered notifications" is a benign
    // browser warning (the spec defines it as non-fatal). Reflowing reader
    // content as images decode triggers it repeatedly and floods the console;
    // swallow just that message so real errors stay visible.
    this.registerDomEvent(
      window,
      'error',
      (e: ErrorEvent) => {
        if (e.message && e.message.startsWith('ResizeObserver loop')) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      { capture: true },
    );

    this.addSettingTab(new RReaderSettingsTab(this.app, this));

    // Ribbon: open the library (the hub for all books).
    this.addRibbonIcon('library', 'R Reader library', () => void this.openLibrary());

    this.addReaderCommands();
    this.addLibraryAndToolCommands();
  }

  /** Open (or reveal) the library view in a tab. */
  async openLibrary(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      (existing[0].view as LibraryView).render();
      return;
    }
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private addLibraryAndToolCommands(): void {
    this.addCommand({
      id: 'open-library',
      name: 'Open R Reader library',
      callback: () => void this.openLibrary(),
    });
    this.addCommand({
      id: 'open-toc',
      name: 'Open table of contents',
      checkCallback: (checking) => this.readerCommand(checking, (v) => v.openTableOfContents()),
    });
    this.addCommand({
      id: 'search-in-book',
      name: 'Search in book',
      checkCallback: (checking) => this.readerCommand(checking, (v) => v.openSearch()),
    });
    this.addCommand({
      id: 'add-bookmark',
      name: 'Add bookmark',
      checkCallback: (checking) => this.readerCommand(checking, (v) => void v.addBookmarkAtCurrent()),
    });
    this.addCommand({
      id: 'export-notes',
      name: 'Export reading notes to a note',
      checkCallback: (checking) => this.readerCommand(checking, (v) => void v.exportNotes()),
    });
    this.addCommand({
      id: 'cycle-highlight-color',
      name: 'Cycle default highlight color',
      callback: () => {
        const order = HIGHLIGHT_COLORS;
        const next = order[(order.indexOf(this.settings.defaultHighlightColor) + 1) % order.length];
        this.settings.defaultHighlightColor = next as HighlightColor;
        void this.saveSettings();
        new Notice(`R Reader: highlight color → ${next}`);
      },
    });
    this.addCommand({
      id: 'clear-epub-cache',
      name: 'Clear EPUB render cache',
      callback: () => {
        this.clearEpubCache();
        new Notice('R Reader: EPUB cache cleared');
      },
    });
  }

  private getActiveReader(): ReaderView | null {
    return this.app.workspace.getActiveViewOfType(ReaderView);
  }

  /** Run an action against the active reader; gates command availability. */
  private readerCommand(check: boolean, action: (view: ReaderView) => void): boolean {
    const view = this.getActiveReader();
    if (!view) return false;
    if (!check) action(view);
    return true;
  }

  private addReaderCommands(): void {
    this.addCommand({
      id: 'toggle-immersive',
      name: 'Toggle full-screen reading (hide bars)',
      checkCallback: (checking) => this.readerCommand(checking, (v) => v.toggleImmersive()),
    });
    this.addCommand({
      id: 'scroll-down',
      name: 'Scroll down (next screen)',
      checkCallback: (checking) => this.readerCommand(checking, (v) => v.pageNavigate(1)),
    });
    this.addCommand({
      id: 'scroll-up',
      name: 'Scroll up (previous screen)',
      checkCallback: (checking) => this.readerCommand(checking, (v) => v.pageNavigate(-1)),
    });
    this.addCommand({
      id: 'open-quick-settings',
      name: 'Open reader settings menu',
      checkCallback: (checking) => this.readerCommand(checking, (v) => v.openQuickSettings()),
    });
    this.addCommand({
      id: 'cycle-theme',
      name: 'Cycle theme (light / dark / sepia)',
      checkCallback: (checking) =>
        this.readerCommand(checking, () => {
          const order: Theme[] = ['light', 'dark', 'sepia'];
          this.settings.theme = order[(order.indexOf(this.settings.theme) + 1) % order.length];
          void this.saveSettings();
        }),
    });
    this.addCommand({
      id: 'increase-font',
      name: 'Increase font size',
      checkCallback: (checking) =>
        this.readerCommand(checking, () => {
          this.settings.fontSize = Math.min(36, this.settings.fontSize + 1);
          void this.saveSettings();
        }),
    });
    this.addCommand({
      id: 'decrease-font',
      name: 'Decrease font size',
      checkCallback: (checking) =>
        this.readerCommand(checking, () => {
          this.settings.fontSize = Math.max(12, this.settings.fontSize - 1);
          void this.saveSettings();
        }),
    });
  }

  /** Revoke all cached blob URLs and empty the render cache. */
  clearEpubCache(): void {
    for (const entry of this.epubCache.values()) {
      for (const url of entry.objectUrls) {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      }
    }
    this.epubCache.clear();
  }

  /** Drop rendered `.ark` stories; their media links depend on the assets folder setting. */
  clearStoryCache(): void {
    for (const path of [...this.epubCache.keys()]) {
      if (path.toLowerCase().endsWith('.ark')) this.epubCache.delete(path);
    }
  }

  /**
   * Apply Obsidian's "Detect all file extensions" (vault config
   * `showUnsupportedFiles`) so EPUB files are visible in the file explorer.
   * registerExtensions already makes them openable, but enabling this ensures
   * they appear on every device — driven by our synced plugin setting rather
   * than each device's local (unsynced) Obsidian config.
   */
  applyFileVisibility(): void {
    if (!this.settings.detectAllExtensions) return;
    const vault = this.app.vault as unknown as {
      getConfig?: (key: string) => unknown;
      setConfig?: (key: string, value: unknown) => void;
    };
    if (typeof vault.setConfig !== 'function') return;
    if (!vault.getConfig?.('showUnsupportedFiles')) {
      vault.setConfig('showUnsupportedFiles', true);
    }
  }

  /** Persist settings, reading progress, and annotations (each to where it lives). */
  persist(): Promise<void> {
    const run = this.writeChain.then(() => this.writeAll());
    this.writeChain = run.catch((e) => console.error('R Reader: could not save', e));
    return run;
  }

  private async writeAll(): Promise<void> {
    const reading = this.readingData();
    const path = this.settings.readingDataPath;
    if (path) {
      // The vault file first: if it fails, data.json keeps the last good copy.
      await this.writeVaultJson(path, reading);
      await this.saveData({ settings: this.settings } satisfies RReaderData);
    } else {
      await this.saveData({ settings: this.settings, ...reading } satisfies RReaderData);
    }
  }

  /** The in-memory reading data, as written to disk. */
  private readingData(): ReadingData {
    return {
      progress: this.progressManager.getAll(),
      lastRead: this.progressManager.getAllLastRead(),
      anchors: this.progressManager.getAllAnchors(),
      annotations: this.annotationManager.getAll(),
    };
  }

  private useReadingData(d: ReadingData): void {
    this.progressManager.load(d.progress, d.lastRead, d.anchors);
    this.annotationManager.load(d.annotations);
  }

  /**
   * Reading data from the configured vault file, else from data.json. A file
   * that doesn't exist yet (just configured, or not synced here) falls back to
   * data.json, so older data carries over on the next save.
   */
  private async loadReadingData(raw: RReaderData | null): Promise<ReadingData> {
    const path = this.settings.readingDataPath;
    if (!path) return readingDataFrom(raw);
    try {
      return (await this.readVaultJson(path)) ?? readingDataFrom(raw);
    } catch (e) {
      // Keep the unreadable file aside rather than overwrite it on the next save.
      const backup = `${path}.broken-${Date.now()}`;
      await this.app.vault.adapter.copy(path, backup).catch(() => {});
      console.error('R Reader: could not read reading data', e);
      new Notice(`R Reader: ${path} could not be read; a copy was kept as ${backup}`);
      return readingDataFrom(raw);
    }
  }

  /** Parsed reading data from a vault file, or null if there's no file. Throws on bad JSON. */
  private async readVaultJson(path: string): Promise<ReadingData | null> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) return null;
    return readingDataFrom(JSON.parse(await adapter.read(path)));
  }

  private async writeVaultJson(path: string, data: ReadingData): Promise<void> {
    const adapter = this.app.vault.adapter;
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (dir && !(await adapter.exists(dir))) await adapter.mkdir(dir);
    await adapter.write(path, JSON.stringify(data, null, 2));
  }

  /**
   * Move the reading data to another vault file ('' = data.json). If a file is
   * already there (another device, an older copy), the two are merged. The old
   * file is left as it was.
   */
  async setReadingDataPath(input: string): Promise<void> {
    const path = normalizeDataPath(input);
    if (path === this.settings.readingDataPath) return;
    await this.writeChain;
    // Throws on an unreadable file, before anything changes.
    const existing = path
      ? await this.readVaultJson(path)
      : readingDataFrom(await this.loadData());
    this.useReadingData(mergeReadingData(this.readingData(), existing ?? emptyReadingData()));
    this.settings.readingDataPath = path;
    await this.saveSettings();
    this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE).forEach((leaf) => {
      if (leaf.view instanceof LibraryView) leaf.view.render();
    });
  }

  onunload(): void {
    // Release library cover blob URLs (render-cache URLs are freed via clearEpubCache).
    this.coverCache.dispose();
  }

  async saveSettings(): Promise<void> {
    // Update the UI and the open books first; the write to disk can lag.
    this.settingsStore.setState({ settings: { ...this.settings } });
    this.app.workspace.getLeavesOfType(READER_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ReaderView) view.refreshSettings();
    });
    await this.persist();
  }
}
