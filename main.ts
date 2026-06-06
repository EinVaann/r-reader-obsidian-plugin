import { Plugin } from 'obsidian';
import { READER_VIEW_TYPE, ReaderView } from './src/ReaderView';
import { RReaderSettingsTab } from './src/settings/SettingsTab';
import { DEFAULT_SETTINGS, type PluginSettings } from './src/settings/settings';
import { ProgressManager } from './src/reading-progress/ProgressManager';

type ViewRegistry = {
  typeByExtension: Record<string, string>;
  unregisterExtensions: (exts: string[]) => void;
  registerExtensions: (exts: string[], viewType: string) => void;
};

export default class RReaderPlugin extends Plugin {
  settings!: PluginSettings;
  progressManager!: ProgressManager;
  /** Extensions we took over from another handler, with their original view type, to restore on unload. */
  private overriddenExtensions: Record<string, string> = {};

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
    this.progressManager = new ProgressManager(this);
    await this.progressManager.load();

    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
    this.registerReaderExtensions(['epub', 'pdf']);

    this.addSettingTab(new RReaderSettingsTab(this.app, this));

    this.addRibbonIcon('book-open', 'R Reader', () => {
      // Opens the most recent reader leaf, or just a notice
      const leaves = this.app.workspace.getLeavesOfType(READER_VIEW_TYPE);
      if (leaves.length > 0) {
        this.app.workspace.revealLeaf(leaves[0]);
      }
    });
  }

  /**
   * Register file extensions for the reader view, taking over any that another
   * handler (e.g. Obsidian's built-in PDF viewer) already owns. We record the
   * previous owner so it can be restored when the plugin unloads.
   */
  private registerReaderExtensions(exts: string[]): void {
    const registry = (this.app as unknown as { viewRegistry: ViewRegistry }).viewRegistry;
    for (const ext of exts) {
      const existing = registry?.typeByExtension?.[ext];
      if (existing && existing !== READER_VIEW_TYPE) {
        this.overriddenExtensions[ext] = existing;
        registry.unregisterExtensions([ext]);
      }
      try {
        this.registerExtensions([ext], READER_VIEW_TYPE);
      } catch (e) {
        console.error(`R Reader: could not register extension "${ext}"`, e);
      }
    }
  }

  onunload(): void {
    // Restore any extension handlers we took over (e.g. the built-in PDF viewer).
    const registry = (this.app as unknown as { viewRegistry: ViewRegistry }).viewRegistry;
    for (const [ext, viewType] of Object.entries(this.overriddenExtensions)) {
      try {
        registry?.unregisterExtensions([ext]);
        registry?.registerExtensions([ext], viewType);
      } catch (e) {
        console.error(`R Reader: could not restore extension "${ext}"`, e);
      }
    }
    this.overriddenExtensions = {};
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Propagate live to all open reader views
    this.app.workspace.getLeavesOfType(READER_VIEW_TYPE).forEach((leaf) => {
      const view = leaf.view;
      if (view instanceof ReaderView) {
        view.refreshSettings();
      }
    });
  }
}
