import type { PluginSettings } from '../settings/settings';
import type { ProgressManager } from '../reading-progress/ProgressManager';

// Lazily imported at runtime
type EpubBook = {
  ready: Promise<void>;
  renderTo: (el: HTMLElement, opts: Record<string, unknown>) => EpubRendition;
  destroy: () => void;
};
type EpubRendition = {
  display: (cfi?: string) => Promise<void>;
  themes: {
    register: (name: string, styles: Record<string, Record<string, string>>) => void;
    select: (name: string) => void;
    fontSize: (size: string) => void;
    font: (font: string) => void;
  };
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  destroy: () => void;
};

const THEMES: Record<string, Record<string, Record<string, string>>> = {
  light: {
    body: { background: '#ffffff', color: '#1a1a1a' },
    'p, li': { 'line-height': 'var(--rr-line-height)' },
  },
  dark: {
    body: { background: '#1e1e2e', color: '#cdd6f4' },
    'p, li': { 'line-height': 'var(--rr-line-height)' },
  },
  sepia: {
    body: { background: '#f4ecd8', color: '#3b2a1a' },
    'p, li': { 'line-height': 'var(--rr-line-height)' },
  },
};

export class EpubReader {
  private container: HTMLElement;
  private filePath: string;
  private settings: PluginSettings;
  private progress: ProgressManager;
  private book: EpubBook | null = null;
  private rendition: EpubRendition | null = null;

  constructor(
    container: HTMLElement,
    filePath: string,
    settings: PluginSettings,
    progress: ProgressManager,
  ) {
    this.container = container;
    this.filePath = filePath;
    this.settings = settings;
    this.progress = progress;
  }

  async mount(fileArrayBuffer: ArrayBuffer): Promise<void> {
    const { default: Epub } = await import('epubjs');

    this.container.addClass('rr-epub-container');

    const book = Epub(fileArrayBuffer) as EpubBook;
    this.book = book;

    await book.ready;

    const rendition = book.renderTo(this.container, {
      width: '100%',
      height: '100%',
      flow: this.settings.scrollMode === 'continuous' ? 'scrolled-continuous' : 'paginated',
      allowScriptedContent: false,
    });
    this.rendition = rendition;

    this.applyTheme(rendition);

    const savedCfi = this.progress.get(this.filePath);
    await rendition.display(typeof savedCfi === 'string' ? savedCfi : undefined);

    rendition.on('relocated', (location: { start: { cfi: string } }) => {
      this.progress.save(this.filePath, location.start.cfi);
    });
  }

  private applyTheme(rendition: EpubRendition): void {
    const { theme, fontFamily, fontSize } = this.settings;
    for (const [name, styles] of Object.entries(THEMES)) {
      rendition.themes.register(name, styles);
    }
    rendition.themes.select(theme);
    rendition.themes.fontSize(`${fontSize}px`);
    rendition.themes.font(fontFamily);
  }

  applySettings(settings: PluginSettings): void {
    this.settings = settings;
    if (this.rendition) {
      this.applyTheme(this.rendition);
    }
  }

  destroy(): void {
    this.rendition?.destroy();
    this.book?.destroy();
    this.rendition = null;
    this.book = null;
  }
}
