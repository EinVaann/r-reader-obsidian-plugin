import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import type RReaderPlugin from '../main';
import { EpubReader } from './readers/EpubReader';
import { PdfReader } from './readers/PdfReader';
import { MobileControls } from './mobile/MobileControls';

export const READER_VIEW_TYPE = 'r-reader-view';

type AnyReader = EpubReader | PdfReader;

export class ReaderView extends FileView {
  plugin: RReaderPlugin;
  private reader: AnyReader | null = null;
  private mobile: MobileControls | null = null;
  private readerContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return READER_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? 'R Reader';
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.reader?.destroy();
    this.mobile?.unmount();

    const { settings } = this.plugin;

    // Apply CSS variables before mounting reader — avoids flash of unstyled content
    const container = this.contentEl.createDiv({ cls: 'rr-reader-root' });
    container.style.setProperty('--rr-font-family', settings.fontFamily);
    container.style.setProperty('--rr-font-size', `${settings.fontSize}px`);
    container.style.setProperty('--rr-line-height', String(settings.lineHeight));
    this.readerContainer = container;

    const arrayBuffer = await this.app.vault.readBinary(file);
    const ext = file.extension.toLowerCase();

    if (ext === 'epub') {
      const reader = new EpubReader(container, file.path, settings, this.plugin.progressManager);
      this.reader = reader;
      await reader.mount(arrayBuffer);
    } else if (ext === 'pdf') {
      const reader = new PdfReader(container, file.path, settings, this.plugin.progressManager);
      this.reader = reader;
      await reader.mount(arrayBuffer);
    } else {
      container.createEl('p', { text: `Unsupported format: .${ext}` });
    }

    if (settings.touchToScroll) {
      this.mobile = new MobileControls(container);
      this.mobile.mount();
    }
  }

  onUnloadFile(_file: TFile): Promise<void> {
    this.reader?.destroy();
    this.reader = null;
    this.mobile?.unmount();
    this.mobile = null;
    this.readerContainer = null;
    return Promise.resolve();
  }

  /** Called by the plugin when settings change; updates the open reader live. */
  refreshSettings(): void {
    const { settings } = this.plugin;
    if (this.readerContainer) {
      this.readerContainer.style.setProperty('--rr-font-family', settings.fontFamily);
      this.readerContainer.style.setProperty('--rr-font-size', `${settings.fontSize}px`);
      this.readerContainer.style.setProperty('--rr-line-height', String(settings.lineHeight));
    }
    if (this.reader instanceof EpubReader) {
      this.reader.applySettings(settings);
    } else if (this.reader instanceof PdfReader) {
      this.reader.applySettings(settings);
    }
  }

  async onClose(): Promise<void> {
    this.reader?.destroy();
    this.mobile?.unmount();
  }
}
