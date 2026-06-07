import { Plugin } from 'obsidian';
import { READER_VIEW_TYPE, ReaderView } from './src/ReaderView';
import { RReaderSettingsTab } from './src/settings/SettingsTab';
import { DEFAULT_SETTINGS, type PluginSettings } from './src/settings/settings';
import { ProgressManager } from './src/reading-progress/ProgressManager';

interface RReaderData {
  settings?: Partial<PluginSettings>;
  progress?: Record<string, string | number>;
}

export default class RReaderPlugin extends Plugin {
  settings!: PluginSettings;
  progressManager!: ProgressManager;

  async onload(): Promise<void> {
    // Settings and reading progress share one data.json. Read both from a
    // single { settings, progress } object (with migration from older shapes
    // where one or the other was stored at the top level).
    const raw = (await this.loadData()) as (RReaderData & Partial<PluginSettings>) | null;
    const settingsData: Partial<PluginSettings> = raw?.settings
      ?? (raw && 'theme' in raw ? (raw as Partial<PluginSettings>) : {});
    const progressData = raw?.progress ?? {};

    this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
    this.progressManager = new ProgressManager(this);
    this.progressManager.load(progressData);

    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
    this.registerExtensions(['epub'], READER_VIEW_TYPE);

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

    this.addRibbonIcon('book-open', 'R Reader', () => {
      const leaves = this.app.workspace.getLeavesOfType(READER_VIEW_TYPE);
      if (leaves.length > 0) {
        this.app.workspace.revealLeaf(leaves[0]);
      }
    });
  }

  /** Persist settings and reading progress together. */
  async persist(): Promise<void> {
    const data: RReaderData = {
      settings: this.settings,
      progress: this.progressManager.getAll(),
    };
    await this.saveData(data);
  }

  async saveSettings(): Promise<void> {
    await this.persist();
    // Propagate live to all open reader views
    this.app.workspace.getLeavesOfType(READER_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ReaderView) {
        view.refreshSettings();
      }
    });
  }
}
