import type { PluginSettings } from '../settings/settings';
import type { ProgressManager } from '../reading-progress/ProgressManager';
import type { Reader, ReaderHost } from '../types';

// Lazily imported at runtime
type EpubLocations = {
  generate: (chars: number) => Promise<string[]>;
  locationFromCfi: (cfi: string) => number;
  total: number;
};
type EpubBook = {
  ready: Promise<void>;
  locations: EpubLocations;
  renderTo: (el: HTMLElement, opts: Record<string, unknown>) => EpubRendition;
  destroy: () => void;
};
type EpubRendition = {
  display: (target?: string) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  themes: {
    register: (name: string, styles: Record<string, Record<string, string>>) => void;
    select: (name: string) => void;
    fontSize: (size: string) => void;
    font: (font: string) => void;
    override: (name: string, value: string, important?: boolean) => void;
  };
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  destroy: () => void;
};

const THEME_COLORS: Record<string, { bg: string; fg: string }> = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#1e1e2e', fg: '#cdd6f4' },
  sepia: { bg: '#f4ecd8', fg: '#3b2a1a' },
};

export class EpubReader implements Reader {
  private container: HTMLElement;
  private filePath: string;
  private settings: PluginSettings;
  private progress: ProgressManager;
  private host: ReaderHost;
  private book: EpubBook | null = null;
  private rendition: EpubRendition | null = null;
  private locationsReady = false;

  constructor(
    container: HTMLElement,
    filePath: string,
    settings: PluginSettings,
    progress: ProgressManager,
    host: ReaderHost,
  ) {
    this.container = container;
    this.filePath = filePath;
    this.settings = settings;
    this.progress = progress;
    this.host = host;
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
      manager: this.settings.scrollMode === 'continuous' ? 'continuous' : 'default',
      spread: 'none',
      allowScriptedContent: false,
    });
    this.rendition = rendition;

    this.applyTheme(rendition);

    const savedCfi = this.progress.get(this.filePath);
    await rendition.display(typeof savedCfi === 'string' ? savedCfi : undefined);

    rendition.on('relocated', (location: { start: { cfi: string } }) => {
      const cfi = location.start.cfi;
      this.progress.save(this.filePath, cfi);
      this.reportProgress(cfi);
    });

    // Generate locations in the background to enable global page numbers.
    // This can take a moment for large books, so it doesn't block first paint.
    book.locations
      .generate(1024)
      .then(() => {
        this.locationsReady = true;
      })
      .catch(() => {
        /* locations are best-effort */
      });
  }

  private reportProgress(cfi: string): void {
    if (!this.book) return;
    if (this.locationsReady && this.book.locations.total > 0) {
      const current = this.book.locations.locationFromCfi(cfi) + 1;
      this.host.setProgress(current, this.book.locations.total);
    } else {
      this.host.setProgress(0, 0);
    }
  }

  private applyTheme(rendition: EpubRendition): void {
    const { theme, fontFamily, fontSize, lineHeight } = this.settings;
    const colors = THEME_COLORS[theme] ?? THEME_COLORS.light;

    rendition.themes.register('rr', {
      body: {
        background: colors.bg,
        color: colors.fg,
        'font-family': fontFamily,
        'line-height': String(lineHeight),
        padding: '0 1em',
      },
      'p, li, div, span': { 'line-height': String(lineHeight) },
      a: { color: colors.fg },
    });
    rendition.themes.select('rr');
    rendition.themes.fontSize(`${fontSize}px`);
    rendition.themes.font(fontFamily);

    this.container.style.background = colors.bg;
  }

  navigate(dir: 1 | -1): void {
    if (!this.rendition) return;
    if (dir > 0) void this.rendition.next();
    else void this.rendition.prev();
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
