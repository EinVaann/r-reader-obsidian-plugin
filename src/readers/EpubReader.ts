import type { PluginSettings } from '../settings/settings';
import type { ProgressManager } from '../reading-progress/ProgressManager';
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
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  dark: { bg: '#1e1e2e', fg: '#cdd6f4' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636' },
};

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

    // Cache check — skip the slow render loop if we have a fresh entry.
    const cached = this.cache?.get(this.filePath);
    if (cached && cached.mtime === this.mtime) {
      // Cache hit: inject the pre-rendered (clean, highlight-free) HTML.
      this.contentEl.innerHTML = cached.html;
    } else {
      // Cache miss (or stale): render every section and then store the result.
      if (cached) this.cache?.delete(this.filePath); // remove stale entry

      for (let i = 0; i < this.sections.length; i++) {
        if (this.destroyed) return;
        await this.renderSection(i);
        // Surface load progress in the page indicator while building.
        this.host.setProgress(i + 1, this.sections.length, (i + 1) / this.sections.length);
        // Reveal the reader as soon as the first chapter is in the DOM, then keep
        // building the rest in the background, yielding so scroll/taps stay live.
        if (i === 0) this.host.setLoading(false);
        await this.yieldToEventLoop();
      }
      if (this.destroyed) return;

      // Store the CLEAN html (before highlights are applied) so editing a
      // highlight never bakes stale highlight spans into the cache. Transfer
      // objectUrl ownership to the cache so destroy() won't revoke them.
      if (this.cache) {
        this.cache.set(this.filePath, {
          html: this.contentEl.innerHTML,
          mtime: this.mtime,
          objectUrls: [...this.objectUrls],
        });
        this.objectUrls = []; // cache owns them now
      }
    }
    if (this.destroyed) return;

    this.setupScrollTracking();
    this.host.setLoading(false);

    // Apply saved highlights over the clean HTML (live pass, never cached).
    this.applyHighlights(this.initialHighlights);

    // Restore saved position (stored as a 0..1 fraction of total scroll).
    const saved = this.progress.get(this.filePath);
    if (typeof saved === 'number' && saved > 0) {
      const max = scroll.scrollHeight - scroll.clientHeight;
      scroll.scrollTop = saved * max;
    }
    this.reportProgress();
  }

  /** Yield a frame so the WebView can paint/scroll between chapter renders. */
  private yieldToEventLoop(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private async renderSection(index: number): Promise<void> {
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
    const c = THEME_COLORS[theme] ?? THEME_COLORS.light;

    this.scrollEl.style.background = c.bg;
    // Tint the reader root too, so safe-area insets blend with the page.
    const root = this.container.closest('.rr-reader-root');
    if (root instanceof HTMLElement) root.style.background = c.bg;
    this.styleEl.textContent = `
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
        this.reportProgress();
        this.saveProgress();
      });
    };
    el.addEventListener('scroll', this.scrollHandler, { passive: true });
  }

  private reportProgress(): void {
    const el = this.scrollEl;
    if (!el) return;
    const totalScreens = Math.max(1, Math.ceil(el.scrollHeight / el.clientHeight));
    const currentScreen = Math.min(totalScreens, Math.floor(el.scrollTop / el.clientHeight) + 1);
    const max = el.scrollHeight - el.clientHeight;
    const fraction = max > 0 ? el.scrollTop / max : 0;
    this.host.setProgress(currentScreen, totalScreens, fraction);
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
    this.progress.save(this.filePath, fraction);
  }

  navigate(dir: 1 | -1): void {
    if (!this.scrollEl) return;
    this.scrollEl.scrollBy({ top: dir * this.scrollEl.clientHeight * 0.9, behavior: 'smooth' });
  }

  applySettings(settings: PluginSettings): void {
    this.settings = settings;
    this.applyTheme();
  }

  /** Flattened table of contents for the chapter picker. */
  getToc(): TocEntry[] {
    const out: TocEntry[] = [];
    const book = this.book;
    if (!book?.toc) return out;
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
