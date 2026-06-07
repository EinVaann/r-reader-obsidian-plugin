import { App, PluginSettingTab, Setting } from 'obsidian';
import type RReaderPlugin from '../../main';
import type { Theme, ScrollMode } from './settings';

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
  }
}
