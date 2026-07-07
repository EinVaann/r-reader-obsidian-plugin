import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type RReaderPlugin from '../../main';
import type { Theme, ScrollMode } from './settings';
import type { HighlightColor } from '../annotations/types';

export class RReaderSettingsTab extends PluginSettingTab {
  plugin: RReaderPlugin;

  constructor(app: App, plugin: RReaderPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Reading color scheme')
      .addDropdown((d) =>
        d
          .addOptions({ light: 'Light', dark: 'Dark', sepia: 'Sepia' })
          .setValue(this.plugin.settings.theme)
          .onChange(async (v) => {
            this.plugin.settings.theme = v as Theme;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Font size')
      .setDesc('Font size in pixels (12–36)')
      .addSlider((s) =>
        s
          .setLimits(12, 36, 1)
          .setValue(this.plugin.settings.fontSize)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.fontSize = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Line height')
      .setDesc('Line spacing (1.0–2.5)')
      .addSlider((s) =>
        s
          .setLimits(1.0, 2.5, 0.1)
          .setValue(this.plugin.settings.lineHeight)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.lineHeight = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Scroll mode')
      .setDesc('Continuous scrolling or paginated (EPUB only)')
      .addDropdown((d) =>
        d
          .addOptions({ continuous: 'Continuous', paginated: 'Paginated' })
          .setValue(this.plugin.settings.scrollMode)
          .onChange(async (v) => {
            this.plugin.settings.scrollMode = v as ScrollMode;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Touch-to-scroll (mobile)')
      .setDesc('Tap top/bottom thirds of screen to scroll; tap center to toggle bars')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.touchToScroll)
          .onChange(async (v) => {
            this.plugin.settings.touchToScroll = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Tap scroll distance')
      .setDesc('How far a tap or page-turn scrolls, measured in screens (0.25–2.0). Default 0.5.')
      .addSlider((s) =>
        s
          .setLimits(0.25, 2.0, 0.25)
          .setValue(this.plugin.settings.tapScrollScreens)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.tapScrollScreens = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Show EPUB files on all devices')
      .setDesc(
        'Enables Obsidian\'s "Detect all file extensions" automatically. Because this plugin setting syncs with your vault, EPUB files show up on every device without changing each device\'s own settings.',
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.detectAllExtensions)
          .onChange(async (v) => {
            this.plugin.settings.detectAllExtensions = v;
            await this.plugin.saveSettings();
            this.plugin.applyFileVisibility();
          }),
      );

    new Setting(containerEl)
      .setName('Close menu after chapter jump')
      .setDesc('When you pick a chapter from the table of contents, close the quick-settings menu after jumping.')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.closeMenuAfterTocJump)
          .onChange(async (v) => {
            this.plugin.settings.closeMenuAfterTocJump = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('No image mode')
      .setDesc('Render a text placeholder instead of images (faster, less memory). Reopen the book to apply.')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.noImageMode)
          .onChange(async (v) => {
            this.plugin.settings.noImageMode = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Hide bars on mobile')
      .setDesc('Start in full-screen reading mode; tap the center of the screen to show the bars')
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.hideBarsOnMobile)
          .onChange(async (v) => {
            this.plugin.settings.hideBarsOnMobile = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Default highlight color')
      .setDesc('Color used when you create a highlight (you can recolor any highlight later).')
      .addDropdown((d) =>
        d
          .addOptions({ yellow: 'Yellow', green: 'Green', blue: 'Blue', pink: 'Pink' })
          .setValue(this.plugin.settings.defaultHighlightColor)
          .onChange(async (v) => {
            this.plugin.settings.defaultHighlightColor = v as HighlightColor;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Notes export folder')
      .setDesc('Vault folder where "Export reading notes" writes a Markdown file per book.')
      .addText((t) =>
        t
          .setPlaceholder('R Reader Notes')
          .setValue(this.plugin.settings.notesExportFolder)
          .onChange(async (v) => {
            this.plugin.settings.notesExportFolder = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Clear EPUB cache')
      .setDesc('Books are cached in memory after the first load so re-opening them is instant. Clear this if a book looks wrong or after toggling no-image mode.')
      .addButton((b) =>
        b
          .setButtonText('Clear cache')
          .onClick(() => {
            this.plugin.clearEpubCache();
            new Notice('R Reader: EPUB cache cleared');
          }),
      );
  }
}
