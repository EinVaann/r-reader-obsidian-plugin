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
type EpubContents = { document: Document };
type EpubRendition = {
  display: (target?: string) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  manager?: { container?: HTMLElement };
  hooks: { content: { register: (cb: (contents: EpubContents) => void) => void } };
  themes: {
    register: (name: string, styles: Record<string, Record<string, string>>) => void;
    select: (name: string) => void;
    fontSize: (size: string) => void;
    font: (font: string) => void;
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
  private scrollEl: HTMLElement | null = null;
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

  private get isContinuous(): boolean {
    return this.settings.scrollMode === 'continuous';
  }

  async mount(fileArrayBuffer: ArrayBuffer): Promise<void> {
    this.host.setLoading(true);
    const { default: Epub } = await import('epubjs');

    this.container.addClass('rr-epub-container');

    const book = Epub(fileArrayBuffer) as EpubBook;
    this.book = book;

    await book.ready;

    // "scrolled-continuous" gives true whole-book scrolling (sections load as
    // you scroll). Its continuous view manager can throw a removeChild
    // NotFoundError while trimming off-screen views during fast scrolling; we
    // guard against that below by hardening the container's removeChild.
    const rendition = book.renderTo(this.container, {
      width: '100%',
      height: '100%',
      flow: this.isContinuous ? 'scrolled-continuous' : 'paginated',
      manager: this.isContinuous ? 'continuous' : 'default',
      spread: 'none',
      allowScriptedContent: false,
    });
    this.rendition = rendition;

    // Strip the book's bundled <link> stylesheets (loaded as blob: URLs that
    // Obsidian's CSP blocks anyway) and any <script> tags (the iframe is
    // sandboxed without scripts). This removes the console spam and a source
    // of layout churn; our injected theme handles styling.
    rendition.hooks.content.register((contents: EpubContents) => {
      const doc = contents.document;
      doc.querySelectorAll('link[rel="stylesheet"], link[href^="blob:"], script').forEach((el) => el.remove());
    });

    this.applyTheme(rendition);

    const savedCfi = this.progress.get(this.filePath);
    await rendition.display(typeof savedCfi === 'string' ? savedCfi : undefined);

    // Grab the manager's scroll container and harden it against the
    // continuous-manager removeChild crash.
    this.scrollEl = rendition.manager?.container ?? null;
    this.hardenRemoveChild(this.scrollEl);

    this.host.setLoading(false);

    rendition.on('relocated', (location: { start: { cfi: string } }) => {
      const cfi = location.start.cfi;
      this.progress.save(this.filePath, cfi);
      this.reportProgress(cfi);
    });

    // Generate locations in the background to enable global page numbers.
    book.locations
      .generate(1024)
      .then(() => {
        this.locationsReady = true;
      })
      .catch(() => {
        /* locations are best-effort */
      });
  }

  /**
   * epub.js's continuous manager calls container.removeChild(view) while
   * trimming views, and under fast scrolling the node has sometimes already
   * been detached, throwing NotFoundError and killing the render queue
   * (blank/white pages). Wrap removeChild to no-op safely in that case.
   */
  private hardenRemoveChild(el: HTMLElement | null): void {
    if (!el) return;
    const original = el.removeChild.bind(el);
    el.removeChild = function <T extends Node>(child: T): T {
      if (child && child.parentNode === el) {
        return original(child) as T;
      }
      return child; // already removed / not a child — ignore safely
    };
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
    if (this.isContinuous && this.scrollEl) {
      // Continuous scroll: move by a screenful, not a whole section.
      this.scrollEl.scrollBy({ top: dir * this.scrollEl.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    // Paginated: turn the page.
    this.host.setLoading(true);
    const move = dir > 0 ? this.rendition.next() : this.rendition.prev();
    Promise.resolve(move).finally(() => this.host.setLoading(false));
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
    this.scrollEl = null;
  }
}
