import type { PluginSettings } from '../settings/settings';
import type { ProgressManager, ReadingAnchor } from '../reading-progress/ProgressManager';
import type { Reader, ReaderHost } from '../types';
import type { Highlight, HighlightColor } from '../annotations/types';
import { captureSelection, findRange, snippet, unwrapById, wrapRange, type QuoteAnchor } from '../annotations/anchor';

// ce-guard must load before anything that registers custom elements.
import '../ce-guard';
// We use foliate-js purely as an EPUB parser (makeBook). The actual rendering
// is our own: all chapters stacked in one scroll container, in Obsidian's DOM
// (no iframes) for true whole-book continuous scrolling with no CSP issues.
import { makeBook } from '../vendor/foliate-js/view.js';

interface FoliateSection {
  load: () => Promise<string>; // blob: URL to resolved XHTML (avoided on mobile)
  unload?: () => void;
  createDocument: () => Promise<Document>;
  resolveHref?: (href: string) => string;
  linear?: string;
  size?: number;
}
interface FoliateTocItem {
  label?: string;
  href?: string;
  subitems?: FoliateTocItem[] | null;
}
interface FoliateBook {
  sections: FoliateSection[];
  toc?: FoliateTocItem[] | null;
  metadata?: { title?: string };
  resolveHref?: (href: string) => { index: number; anchor?: unknown } | null;
  loadBlob?: (href: string) => Promise<Blob> | Blob;
}

/** Flattened table-of-contents entry for the chapter picker. */
export interface TocEntry {
  label: string;
  index: number; // spine/section index
  id?: string; // optional in-chapter anchor id
  depth: number;
}

/** A full-text search hit within the book. */
export interface SearchHit {
  chapterIndex: number;
  label: string; // nearest TOC label for the chapter
  snippet: string;
}

/** Current reading location, captured for bookmarks. */
export interface ReaderLocation {
  chapterIndex: number;
  anchorId?: string;
  fraction: number;
}

/** One entry in the in-memory EPUB render cache (keyed by file path). */
export interface EpubCacheEntry {
  /** The rendered innerHTML of the content div. */
  html: string;
  /** File modification time at render time — used to detect stale entries. */
  mtime: number;
  /** Blob URLs for images; owned by the cache so destroy() doesn't revoke them. */
  objectUrls: string[];
}

const THEME_COLORS: Record<string, { bg: string; fg: string }> = {
  // Inherit whatever the active Obsidian theme uses, same as the library view.
  obsidian: { bg: 'var(--background-primary)', fg: 'var(--text-normal)' },
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#1e1e2e', fg: '#cdd6f4' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636' },
};

/** Elements used as reading-position anchors (stable across reflows). */
const BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, table, img, .rr-img-placeholder';
/** Save progress once scrolling has been idle this long. */
const SAVE_DEBOUNCE_MS = 1000;
/** Chapter dots closer than this (as a fraction of the bar) are merged. */
const MIN_MILESTONE_GAP = 0.012;

export class EpubReader implements Reader {
  private container: HTMLElement;
  private filePath: string;
  private settings: PluginSettings;
  private progress: ProgressManager;
  private host: ReaderHost;

  private book: FoliateBook | null = null;
  private sections: FoliateSection[] = [];
  private scrollEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private scrollHandler: (() => void) | null = null;
  private saveTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Block elements in document order, with their chapter and in-chapter index. */
  private blocks: { el: HTMLElement; chapter: number; index: number }[] = [];
  /** First index into `blocks` for each chapter. */
  private chapterBlockStart = new Map<number, number>();
  /** Rendered chapter elements in document order. */
  private chapterEls: HTMLElement[] = [];
  /** Flattened TOC; built once since it's read on every scroll frame. */
  private tocCache: TocEntry[] | null = null;
  /** Scroll offsets of TOC entries; reset whenever the layout reflows. */
  private entryPosCache: number[] | null = null;
  /** Current position, kept up to date on scroll and re-applied after reflows. */
  private anchor: ReadingAnchor | null = null;
  /** On-screen top of the scroll viewport when `anchor` was captured. */
  private anchorViewTop: number | null = null;
  /** Temporary top margin (px) that keeps text still when there's no room to scroll up. */
  private topSlack = 0;
  /** scrollTop we set ourselves when restoring, so the echo scroll doesn't re-capture. */
  private restoredTop: number | null = null;
  private milestoneKey = '';
  /** True once the loading overlay is gone and the reader is interactive. */
  private revealed = false;
  private objectUrls: string[] = [];
  private destroyed = false;

  private cache: Map<string, EpubCacheEntry> | null;
  private mtime: number;

  /** Highlights to apply once the book is rendered. */
  private initialHighlights: Highlight[] = [];
  /** Called when the user taps an existing highlight span. */
  onHighlightClick: ((id: string, el: HTMLElement) => void) | null = null;
  /** Transient <mark> from the last search jump, cleared on the next jump. */
  private searchMark: HTMLElement[] = [];

  constructor(
    container: HTMLElement,
    filePath: string,
    settings: PluginSettings,
    progress: ProgressManager,
    host: ReaderHost,
    cache: Map<string, EpubCacheEntry> | null = null,
    mtime = 0,
    highlights: Highlight[] = [],
  ) {
    this.container = container;
    this.filePath = filePath;
    this.settings = settings;
    this.progress = progress;
    this.host = host;
    this.cache = cache;
    this.mtime = mtime;
    this.initialHighlights = highlights;
  }

  async mount(fileArrayBuffer: ArrayBuffer): Promise<void> {
    this.host.setLoading(true);
    this.container.addClass('rr-epub-container');

    // foliate's makeBook reads file.name to detect format, so pass a File.
    const name = this.filePath.split('/').pop() || 'book.epub';
    const file = new File([fileArrayBuffer], name, { type: 'application/epub+zip' });
    const book = (await makeBook(file)) as FoliateBook;
    if (this.destroyed) return;
    this.book = book;
    // Render every spine section so chapter data-index aligns with the indices
    // returned by book.resolveHref (used by the TOC picker).
    this.sections = book.sections;

    // Scaffold: a single scroll container holding all chapters.
    const scroll = this.container.createDiv({ cls: 'rr-epub-scroll' });
    this.scrollEl = scroll;
    this.styleEl = document.createElement('style');
    scroll.appendChild(this.styleEl);
    this.contentEl = scroll.createDiv({ cls: 'rr-epub-content' });
    this.contentEl.addEventListener('click', this.handleContentClick);
    this.applyTheme();

    const savedAnchor = this.progress.getAnchor(this.filePath);
    const savedFraction = this.progress.get(this.filePath);

    // Cache check — skip the slow render loop if we have a fresh entry.
    const cached = this.cache?.get(this.filePath);
    if (cached && cached.mtime === this.mtime) {
      // Cache hit: inject the pre-rendered (clean, highlight-free) HTML.
      this.contentEl.innerHTML = cached.html;
      this.contentEl.querySelectorAll<HTMLElement>('.rr-chapter').forEach((ch) => this.prepareChapter(ch));
      this.reveal(savedAnchor, savedFraction);
    } else {
      // Cache miss (or stale): render every section and then store the result.
      if (cached) this.cache?.delete(this.filePath); // remove stale entry
      // Reveal once the chapter being read is in the DOM; later chapters append
      // below it, so the position never jumps. A bare fraction needs the whole book.
      const revealAt = savedAnchor
        ? Math.min(savedAnchor.chapter, this.sections.length - 1)
        : typeof savedFraction === 'number' && savedFraction > 0 ? this.sections.length - 1 : 0;
      const cleanHtml: string[] = [];

      for (let i = 0; i < this.sections.length; i++) {
        if (this.destroyed) return;
        const chapter = await this.renderSection(i);
        // Snapshot before highlights so the cache never holds highlight spans.
        cleanHtml.push(chapter.outerHTML);
        this.prepareChapter(chapter);
        if (!this.revealed) {
          // Loading progress, shown behind the overlay until reveal.
          this.host.setProgress(i + 1, this.sections.length, (i + 1) / this.sections.length);
          if (i >= revealAt) this.reveal(savedAnchor, savedFraction);
        }
        await this.yieldToEventLoop();
      }
      if (this.destroyed) return;

      // Transfer objectUrl ownership to the cache so destroy() won't revoke them.
      if (this.cache) {
        this.cache.set(this.filePath, {
          html: cleanHtml.join(''),
          mtime: this.mtime,
          objectUrls: [...this.objectUrls],
        });
        this.objectUrls = []; // cache owns them now
      }
      this.reveal(savedAnchor, savedFraction);
    }
    this.updateMilestones();
    this.reportProgress();
  }

  /** Jump to the saved position, then drop the loading overlay (once). */
  private reveal(savedAnchor: ReadingAnchor | null, savedFraction: string | number | null): void {
    const scroll = this.scrollEl;
    if (this.revealed || !scroll) return;
    this.revealed = true;
    if (savedAnchor && this.restoreAnchor(savedAnchor)) {
      this.anchor = savedAnchor;
      this.anchorViewTop = scroll.getBoundingClientRect().top;
    } else {
      if (typeof savedFraction === 'number' && savedFraction > 0) {
        const max = scroll.scrollHeight - scroll.clientHeight;
        scroll.scrollTop = savedFraction * max;
      }
      this.anchor = this.captureAnchor();
    }
    this.setupScrollTracking();
    this.setupResizeTracking();
    this.host.setLoading(false);
    this.updateMilestones();
    this.reportProgress();
  }

  /** Apply this chapter's saved highlights and index its anchorable blocks. */
  private prepareChapter(chapter: HTMLElement): void {
    const ci = Number(chapter.dataset.index);
    this.chapterEls.push(chapter);
    this.applyHighlights(this.initialHighlights.filter((h) => h.chapterIndex === ci));
    this.chapterBlockStart.set(ci, this.blocks.length);
    const els = chapter.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
    els.forEach((el, index) => this.blocks.push({ el, chapter: ci, index }));
  }

  /** The block at the top of the viewport and how far into it we've scrolled. */
  private captureAnchor(): ReadingAnchor | null {
    const el = this.scrollEl;
    if (!el || this.blocks.length === 0) return null;
    const viewTop = el.getBoundingClientRect().top;
    // Binary search: last block whose top is at/above the viewport top.
    let lo = 0;
    let hi = this.blocks.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.blocks[mid].el.getBoundingClientRect().top <= viewTop + 1) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    this.anchorViewTop = viewTop;
    // Above the first block (top of the book): anchor to it with a negative offset.
    const b = this.blocks[Math.max(0, found)];
    const rect = b.el.getBoundingClientRect();
    const raw = rect.height > 0 ? (viewTop - rect.top) / rect.height : 0;
    const offset = found < 0 ? Math.min(0, raw) : Math.max(0, Math.min(1, raw));
    return { chapter: b.chapter, block: b.index, offset };
  }

  /** scrollTop that puts the anchored block at the viewport top, or null if it's gone. */
  private anchorTarget(a: ReadingAnchor): number | null {
    const el = this.scrollEl;
    const start = this.chapterBlockStart.get(a.chapter);
    if (!el || start === undefined) return null;
    const b = this.blocks[start + a.block];
    if (!b || b.chapter !== a.chapter) return null;
    const rect = b.el.getBoundingClientRect();
    return el.scrollTop + rect.top - el.getBoundingClientRect().top + a.offset * rect.height;
  }

  /** Scroll so the anchored block sits at the viewport top. False if it can't be found. */
  private restoreAnchor(a: ReadingAnchor): boolean {
    const target = this.anchorTarget(a);
    if (target === null) return false;
    this.setScrollTop(target);
    return true;
  }

  private setScrollTop(target: number): void {
    const el = this.scrollEl!;
    const t = Math.round(target);
    if (Math.abs(el.scrollTop - t) > 1) {
      el.scrollTop = t;
      this.restoredTop = el.scrollTop;
    }
  }

  /**
   * Restore the anchor while following a viewport that moved on screen by `shift`
   * px, so text stays put visually. Near the top of the book there's nothing to
   * scroll back into, so a temporary top margin makes up the difference.
   */
  private restoreWithShift(a: ReadingAnchor, shift: number): void {
    const base = this.anchorTarget(a);
    if (base === null || !this.contentEl) return;
    const logical = base + shift - this.topSlack;
    const slack = Math.max(0, Math.round(-logical));
    if (slack !== this.topSlack) {
      this.topSlack = slack;
      this.contentEl.style.marginTop = slack > 0 ? `${slack}px` : '';
    }
    this.setScrollTop(logical + slack);
  }

  /** Keep the reading position fixed when the layout changes (fullscreen, font, resize). */
  private setupResizeTracking(): void {
    if (!this.scrollEl || !this.contentEl) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.anchor && this.scrollEl) {
        // If the viewport itself moved on screen (fullscreen toggle), follow it
        // so the text stays put visually, then re-anchor to the new viewport.
        const viewTop = this.scrollEl.getBoundingClientRect().top;
        const shift = this.anchorViewTop !== null ? viewTop - this.anchorViewTop : 0;
        if (Math.abs(shift) > 0.5) {
          this.restoreWithShift(this.anchor, shift);
          this.anchor = this.captureAnchor();
        } else {
          this.restoreAnchor(this.anchor);
        }
      }
      this.entryPosCache = null;
      this.updateMilestones();
      this.reportProgress();
    });
    this.resizeObserver.observe(this.scrollEl);
    this.resizeObserver.observe(this.contentEl);
  }

  /** Report chapter-start fractions to the host for the slider dots. */
  private updateMilestones(): void {
    const el = this.scrollEl;
    if (!el || !this.contentEl) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    const topLevel = this.getToc().filter((e) => e.depth === 0 && e.index >= 0).map((e) => e.index);
    const indices = topLevel.length > 0
      ? [...new Set(topLevel)].sort((a, b) => a - b)
      : this.sections.map((_, i) => i);
    const viewTop = el.getBoundingClientRect().top - el.scrollTop;
    const out: number[] = [];
    for (const i of indices) {
      const chapter = this.chapterEl(i);
      if (!chapter) continue;
      const f = Math.min(1, (chapter.getBoundingClientRect().top - viewTop) / max);
      if (f <= 0.001) continue;
      if (out.length > 0 && f - out[out.length - 1] < MIN_MILESTONE_GAP) continue;
      out.push(f);
    }
    const key = out.map((f) => f.toFixed(4)).join(',');
    if (key === this.milestoneKey) return;
    this.milestoneKey = key;
    this.host.setMilestones(out);
  }

  /** Yield a frame so the WebView can paint/scroll between chapter renders. */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private async renderSection(index: number): Promise<HTMLElement> {
    const section = this.sections[index];
    const chapter = this.contentEl!.createDiv({ cls: 'rr-chapter' });
    chapter.dataset.index = String(index);
    try {
      // createDocument() reads + parses the chapter directly (no blob-URL
      // fetch round-trip, which is unreliable in Obsidian's mobile WebView).
      const doc = await section.createDocument();
      const body = doc.body ?? doc.documentElement;

      // Strip scripts and the book's own stylesheets (we theme it ourselves).
      body.querySelectorAll('script, link, style').forEach((el) => el.remove());

      if (this.settings.noImageMode) {
        this.replaceImagesWithPlaceholders(doc);
      } else {
        await this.resolveImages(doc, section);
      }

      const imported = document.importNode(body, true);
      chapter.append(...Array.from(imported.childNodes));
    } catch (e) {
      console.error(`R Reader: failed to render section ${index}`, e);
    }
    return chapter;
  }

  /** Replace images with a text placeholder (no-image mode). */
  private replaceImagesWithPlaceholders(doc: Document): void {
    doc.querySelectorAll('img, picture, svg').forEach((el) => {
      if (!el.isConnected) return;
      const alt = el.getAttribute('alt') || el.getAttribute('title') || '';
      const ph = doc.createElement('div');
      ph.className = 'rr-img-placeholder';
      ph.textContent = alt ? `🖼 ${alt}` : '🖼 [Image]';
      el.replaceWith(ph);
    });
  }

  /** Replace image references with object URLs loaded via the book's loader. */
  private async resolveImages(doc: Document, section: FoliateSection): Promise<void> {
    const book = this.book;
    if (!book?.loadBlob) return;
    const resolve = (href: string): string => (section.resolveHref ? section.resolveHref(href) : href);
    const XLINK = 'http://www.w3.org/1999/xlink';

    const toBlobUrl = async (href: string): Promise<string | null> => {
      if (!href || href.startsWith('data:')) return null;
      try {
        const blob = await book.loadBlob!(resolve(href));
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        this.objectUrls.push(url);
        return url;
      } catch {
        return null;
      }
    };

    const tasks: Promise<void>[] = [];
    doc.querySelectorAll('img').forEach((img) => {
      img.setAttribute('loading', 'lazy');
      const src = img.getAttribute('src');
      if (src) tasks.push(toBlobUrl(src).then((u) => { if (u) img.setAttribute('src', u); }));
    });
    // SVG <image> (common for cover pages)
    doc.querySelectorAll('image').forEach((im) => {
      const href = im.getAttribute('href') ?? im.getAttributeNS(XLINK, 'href');
      if (href) tasks.push(toBlobUrl(href).then((u) => {
        if (u) { im.setAttribute('href', u); im.setAttributeNS(XLINK, 'href', u); }
      }));
    });
    await Promise.all(tasks);
  }

  private applyTheme(): void {
    if (!this.scrollEl || !this.styleEl) return;
    const { theme, fontFamily, fontSize, lineHeight } = this.settings;
    const c = THEME_COLORS[theme] ?? THEME_COLORS.obsidian;

    this.scrollEl.style.background = c.bg;
    // Tint the reader root too, so safe-area insets blend with the page.
    const root = this.container.closest('.rr-reader-root');
    if (root instanceof HTMLElement) root.style.background = c.bg;
    this.styleEl.textContent = `
      .rr-epub-scroll { overflow-anchor: none; }
      .rr-epub-content {
        color: ${c.fg};
        background: ${c.bg};
        font-family: ${fontFamily};
        font-size: ${fontSize}px;
        line-height: ${lineHeight};
        max-width: 42em;
        margin: 0 auto;
        padding: 1.5em 1.5em 6em;
      }
      .rr-epub-content :where(p, div, span, li, a, h1, h2, h3, h4, h5, h6,
        td, th, blockquote, em, strong, b, i, figcaption) {
        color: inherit !important;
        line-height: ${lineHeight};
      }
      .rr-epub-content img, .rr-epub-content svg {
        max-width: 100% !important;
        height: auto !important;
      }
      .rr-epub-content a { text-decoration: underline; }
      .rr-chapter { margin-bottom: 2em; }
    `;
  }

  private setupScrollTracking(): void {
    const el = this.scrollEl!;
    let ticking = false;
    this.scrollHandler = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!this.scrollEl) return;
        // Skip the echo of our own restore so rounding can't drift the anchor.
        const isEcho = this.restoredTop !== null && Math.abs(this.scrollEl.scrollTop - this.restoredTop) <= 1;
        this.restoredTop = null;
        if (!isEcho) this.anchor = this.captureAnchor();
        this.reportProgress();
        this.scheduleSave();
      });
    };
    el.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      this.saveProgress();
    }, SAVE_DEBOUNCE_MS);
  }

  private reportProgress(): void {
    const el = this.scrollEl;
    if (!el) return;
    const totalScreens = Math.max(1, Math.ceil(el.scrollHeight / el.clientHeight));
    const currentScreen = Math.min(totalScreens, Math.floor(el.scrollTop / el.clientHeight) + 1);
    const max = el.scrollHeight - el.clientHeight;
    const fraction = max > 0 ? el.scrollTop / max : 0;
    this.host.setProgress(currentScreen, totalScreens, fraction);
    this.reportLocation();
  }

  /** Scroll offset of an element's top within the scroll container. */
  private topInScroll(target: HTMLElement): number {
    const el = this.scrollEl!;
    return target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
  }

  /** Position in `chapterEls` of the chapter at the viewport top (binary search). */
  private currentChapterPos(): number {
    const el = this.scrollEl;
    if (!el || this.chapterEls.length === 0) return -1;
    const viewTop = el.getBoundingClientRect().top + 1;
    let lo = 0;
    let hi = this.chapterEls.length - 1;
    let found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.chapterEls[mid].getBoundingClientRect().top <= viewTop) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /** Chapter label for the top bar, plus whether prev/next entries exist. */
  private reportLocation(): void {
    const el = this.scrollEl;
    const pos = this.currentChapterPos();
    if (!el || pos < 0) return;
    this.host.setChapterLabel(this.labelForChapter(Number(this.chapterEls[pos].dataset.index)));
    const { prev, next } = this.neighbourEntries();
    this.host.setEntryNav(prev !== null, next !== null);
  }

  /**
   * Scroll offsets of every table-of-contents entry (sorted), or of each
   * non-empty section when the book has no TOC. Cached until the next reflow.
   */
  private entryPositions(): number[] {
    if (this.entryPosCache) return this.entryPosCache;
    const out: number[] = [];
    const toc = this.getToc().filter((e) => e.index >= 0);
    if (toc.length > 0) {
      for (const e of toc) {
        const chapter = this.chapterEl(e.index);
        if (!chapter) continue;
        let target: HTMLElement = chapter;
        if (e.id) {
          const found = chapter.querySelector<HTMLElement>(`#${CSS.escape(e.id)}`);
          if (found) target = found;
        }
        out.push(Math.round(this.topInScroll(target)));
      }
    } else {
      for (const ch of this.chapterEls) if (ch.offsetHeight >= 1) out.push(Math.round(this.topInScroll(ch)));
    }
    this.entryPosCache = [...new Set(out)].sort((a, b) => a - b);
    return this.entryPosCache;
  }

  /** The nearest entry positions above and below the viewport top (null if none). */
  private neighbourEntries(): { prev: number | null; next: number | null } {
    const el = this.scrollEl!;
    const top = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    let prev: number | null = null;
    let next: number | null = null;
    for (const p of this.entryPositions()) {
      if (p < top - 4) prev = p;
      else if (p > top + 4 && top < max - 1) { next = p; break; }
    }
    return { prev, next };
  }

  /** Jump to the previous (-1) or next (1) table-of-contents entry. */
  jumpEntry(dir: 1 | -1): void {
    const el = this.scrollEl;
    if (!el) return;
    const { prev, next } = this.neighbourEntries();
    const target = dir === 1 ? next : prev;
    if (target !== null) el.scrollTop = target;
  }

  seek(fraction: number): void {
    const el = this.scrollEl;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.min(1, fraction)) * max;
  }

  private saveProgress(): void {
    const el = this.scrollEl;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const fraction = max > 0 ? el.scrollTop / max : 0;
    void this.progress.save(this.filePath, fraction, this.anchor);
  }

  navigate(dir: 1 | -1): void {
    if (!this.scrollEl) return;
    const screens = this.settings.tapScrollScreens ?? 0.5;
    this.scrollEl.scrollBy({ top: dir * this.scrollEl.clientHeight * screens, behavior: 'smooth' });
  }

  applySettings(settings: PluginSettings): void {
    this.settings = settings;
    this.applyTheme();
  }

  /** Flattened table of contents for the chapter picker. */
  getToc(): TocEntry[] {
    if (this.tocCache) return this.tocCache;
    const out: TocEntry[] = [];
    const book = this.book;
    if (!book?.toc) return out;
    this.tocCache = out;
    const walk = (items: FoliateTocItem[], depth: number): void => {
      for (const item of items) {
        const href = item.href ?? '';
        const hash = href.includes('#') ? href.split('#')[1] : undefined;
        const resolved = book.resolveHref?.(href);
        out.push({
          label: (item.label ?? '').trim() || 'Untitled',
          index: resolved?.index ?? -1,
          id: hash,
          depth,
        });
        if (item.subitems) walk(item.subitems, depth + 1);
      }
    };
    walk(book.toc, 0);
    return out;
  }

  /** Handle clicks on links inside the rendered book. */
  private handleContentClick = (e: MouseEvent): void => {
    // A tap on an existing highlight opens its editor popover.
    const hl = (e.target as HTMLElement).closest('.rr-highlight');
    if (hl instanceof HTMLElement && hl.dataset.hlId && this.onHighlightClick) {
      e.preventDefault();
      this.onHighlightClick(hl.dataset.hlId, hl);
      return;
    }

    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;

    // External links open in the browser.
    if (/^(https?:|mailto:|tel:)/i.test(href)) {
      e.preventDefault();
      window.open(href, '_blank');
      return;
    }
    // Ignore pure JS / empty anchors.
    if (href.startsWith('javascript:') || href === '#') {
      e.preventDefault();
      return;
    }

    // Internal link: resolve to a chapter (+ anchor) and jump there.
    e.preventDefault();
    this.navigateToInternalHref(anchor, href);
  };

  private navigateToInternalHref(anchor: Element, href: string): void {
    const chapter = anchor.closest('.rr-chapter');
    if (!(chapter instanceof HTMLElement) || !this.book) return;
    const fromIndex = Number(chapter.dataset.index);
    const section = this.sections[fromIndex];
    const hash = href.includes('#') ? decodeURIComponent(href.split('#')[1]) : undefined;

    try {
      const resolved = section?.resolveHref ? section.resolveHref(href) : href;
      const target = this.book.resolveHref?.(resolved);
      if (target && typeof target.index === 'number' && target.index >= 0) {
        this.goToChapter(target.index, hash);
        return;
      }
    } catch {
      /* fall through to same-chapter anchor */
    }
    // Fallback: same-document anchor.
    if (hash) this.goToChapter(fromIndex, hash);
  }

  /** Scroll to a chapter (and optional in-chapter anchor) from the TOC. */
  goToChapter(index: number, id?: string): void {
    if (index < 0 || !this.contentEl) return;
    const chapter = this.contentEl.querySelector<HTMLElement>(`.rr-chapter[data-index="${index}"]`);
    if (!chapter) return;
    let target: Element = chapter;
    if (id) {
      const found =
        chapter.querySelector(`#${CSS.escape(id)}`) ??
        chapter.querySelector(`[name="${CSS.escape(id)}"]`);
      if (found) target = found;
    }
    target.scrollIntoView({ block: 'start' });
  }

  // --- Highlights ---

  /** The live content element (used by the selection toolbar for positioning). */
  getContentEl(): HTMLElement | null {
    return this.contentEl;
  }

  getScrollEl(): HTMLElement | null {
    return this.scrollEl;
  }

  private chapterEl(index: number): HTMLElement | null {
    return this.contentEl?.querySelector<HTMLElement>(`.rr-chapter[data-index="${index}"]`) ?? null;
  }

  /** Capture the current selection as a re-anchorable quote, or null. */
  captureCurrentSelection(): QuoteAnchor | null {
    const sel = (this.contentEl?.ownerDocument ?? document).getSelection();
    if (!sel) return null;
    return captureSelection(sel);
  }

  /** Apply a list of highlights over the rendered DOM. */
  applyHighlights(list: Highlight[]): void {
    for (const h of list) this.renderHighlight(h);
  }

  /** Wrap a single highlight's text in styled spans. Returns true if anchored. */
  renderHighlight(h: Highlight): boolean {
    const chapter = this.chapterEl(h.chapterIndex);
    if (!chapter) return false;
    // Avoid double-wrapping if it's already present.
    if (chapter.querySelector(`span[data-hl-id="${CSS.escape(h.id)}"]`)) return true;
    const range = findRange(chapter, h);
    if (!range) return false;
    wrapRange(range, `rr-highlight rr-hl-${h.color}`, { hlId: h.id });
    return true;
  }

  /** Recolor an existing highlight's spans in place. */
  setHighlightColor(id: string, color: HighlightColor): void {
    this.contentEl
      ?.querySelectorAll<HTMLElement>(`span[data-hl-id="${CSS.escape(id)}"]`)
      .forEach((span) => {
        span.className = `rr-highlight rr-hl-${color}`;
      });
  }

  /** Remove a highlight's spans and restore the underlying text. */
  removeHighlightSpans(id: string): void {
    if (this.contentEl) unwrapById(this.contentEl, id);
  }

  // --- Full-text search ---

  /** Nearest TOC label for a chapter index (for search result rows). */
  private labelForChapter(index: number): string {
    const toc = this.getToc();
    let best = '';
    for (const e of toc) {
      if (e.index >= 0 && e.index <= index) best = e.label;
    }
    return best || `Chapter ${index + 1}`;
  }

  /** Search the rendered chapters (text read straight from the DOM). */
  search(query: string, limit = 100): SearchHit[] {
    const q = query.trim().toLowerCase();
    const hits: SearchHit[] = [];
    if (q.length < 2 || !this.contentEl) return hits;
    const chapters = this.contentEl.querySelectorAll<HTMLElement>('.rr-chapter');
    for (const chapter of Array.from(chapters)) {
      const index = Number(chapter.dataset.index);
      const text = chapter.innerText;
      const lower = text.toLowerCase();
      let from = 0;
      let idx = lower.indexOf(q, from);
      let perChapter = 0;
      while (idx >= 0 && hits.length < limit && perChapter < 20) {
        hits.push({ chapterIndex: index, label: this.labelForChapter(index), snippet: snippet(text, idx, q.length) });
        perChapter++;
        from = idx + q.length;
        idx = lower.indexOf(q, from);
      }
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** Scroll to the first match of `query` within a chapter and flash it. */
  jumpToMatch(chapterIndex: number, query: string): void {
    this.clearSearchMark();
    const chapter = this.chapterEl(chapterIndex);
    if (!chapter) return;
    const range = findRange(chapter, { text: this.firstMatchText(chapter, query), prefix: '', suffix: '' });
    if (range) {
      this.searchMark = wrapRange(range, 'rr-search-hit', {});
      this.searchMark[0]?.scrollIntoView({ block: 'center' });
    } else {
      chapter.scrollIntoView({ block: 'start' });
    }
  }

  /** Exact-cased substring as it appears in the chapter (for accurate wrapping). */
  private firstMatchText(chapter: HTMLElement, query: string): string {
    const text = chapter.innerText;
    const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
    return idx >= 0 ? text.slice(idx, idx + query.trim().length) : query;
  }

  clearSearchMark(): void {
    for (const m of this.searchMark) {
      const parent = m.parentNode;
      if (!parent) continue;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    }
    this.searchMark = [];
  }

  // --- Bookmarks ---

  /** Capture the current reading position for a bookmark. */
  getCurrentLocation(): ReaderLocation {
    const el = this.scrollEl;
    const max = el ? el.scrollHeight - el.clientHeight : 0;
    const fraction = el && max > 0 ? el.scrollTop / max : 0;
    // Topmost chapter currently in view.
    let chapterIndex = 0;
    let anchorId: string | undefined;
    if (el && this.contentEl) {
      const top = el.scrollTop;
      const chapters = this.contentEl.querySelectorAll<HTMLElement>('.rr-chapter');
      for (const chapter of Array.from(chapters)) {
        if (chapter.offsetTop <= top + 4) chapterIndex = Number(chapter.dataset.index);
        else break;
      }
      // Nearest element with an id at/above the fold, for precise restore.
      const withId = this.contentEl.querySelectorAll<HTMLElement>('[id]');
      for (const node of Array.from(withId)) {
        if (node.offsetTop <= top + el.clientHeight * 0.5) anchorId = node.id;
        else break;
      }
    }
    return { chapterIndex, anchorId, fraction };
  }

  /** Jump to a saved bookmark location. */
  goToLocation(loc: { chapterIndex: number; anchorId?: string; fraction?: number }): void {
    if (loc.anchorId && this.contentEl?.querySelector(`#${CSS.escape(loc.anchorId)}`)) {
      this.goToChapter(loc.chapterIndex, loc.anchorId);
    } else if (this.chapterEl(loc.chapterIndex)) {
      this.goToChapter(loc.chapterIndex);
    } else if (typeof loc.fraction === 'number') {
      this.seek(loc.fraction);
    }
  }

  destroy(): void {
    this.destroyed = true;
    // Flush a pending debounced save before the scroll element goes away.
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.saveProgress();
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.blocks = [];
    this.chapterBlockStart.clear();
    this.chapterEls = [];
    this.tocCache = null;
    this.entryPosCache = null;
    this.anchor = null;
    if (this.scrollEl && this.scrollHandler) {
      this.scrollEl.removeEventListener('scroll', this.scrollHandler);
    }
    // Revoke image object URLs and unload sections to free memory.
    for (const url of this.objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    this.objectUrls = [];
    for (const section of this.sections) {
      try {
        section.unload?.();
      } catch {
        /* ignore */
      }
    }
    this.contentEl?.removeEventListener('click', this.handleContentClick);
    this.onHighlightClick = null;
    this.searchMark = [];
    this.scrollHandler = null;
    this.scrollEl = null;
    this.contentEl = null;
    this.styleEl = null;
    this.sections = [];
    this.book = null;
  }

  /** The book's metadata (title/author) once parsed; used by the library. */
  getMetadata(): { title?: string } | null {
    return this.book?.metadata ?? null;
  }
}
