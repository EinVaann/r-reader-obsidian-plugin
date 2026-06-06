import { Plugin } from 'obsidian';
import { READER_VIEW_TYPE, ReaderView } from './src/ReaderView';
import { RReaderSettingsTab } from './src/settings/SettingsTab';
import { DEFAULT_SETTINGS, type PluginSettings } from './src/settings/settings';
import { ProgressManager } from './src/reading-progress/ProgressManager';

export default class RReaderPlugin extends Plugin {
  settings!: PluginSettings;
  progressManager!: ProgressManager;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
    this.progressManager = new ProgressManager(this);
    await this.progressManager.load();

    this.registerView(READER_VIEW_TYPE, (leaf) => new ReaderView(leaf, this));
    this.registerExtensions(['epub', 'pdf'], READER_VIEW_TYPE);

    this.addSettingTab(new RReaderSettingsTab(this.app, this));

    this.addRibbonIcon('book-open', 'R Reader', () => {
      // Opens the most recent reader leaf, or just a notice
      const leaves = this.app.workspace.getLeavesOfType(READER_VIEW_TYPE);
      if (leaves.length > 0) {
        this.app.workspace.revealLeaf(leaves[0]);
      }
    });
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
