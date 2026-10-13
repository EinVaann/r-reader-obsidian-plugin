// @vitest-environment happy-dom
/**
 * Smoke tests for the React frame and library. The EpubReader can't run here
 * (it parses real EPUBs), so a fake stands in for the actions it backs; what's
 * tested is the frame: rendering, store → DOM updates, panels, and — most
 * importantly — that React never touches the book's DOM.
 */
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import { mountReact } from '../react/mount';
import { ReaderApp } from '../reader/ReaderApp';
import { ReaderContext, type HighlightActions, type ReaderActions, type ReaderContextValue } from '../reader/context';
import { createReaderStore, createSettingsStore } from '../reader/store';
import { DEFAULT_SETTINGS } from '../settings/settings';
import type { Bookmark } from '../annotations/types';
import type { TocEntry } from '../readers/EpubReader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

const app = {} as App;
let cleanup: (() => void)[] = [];
afterEach(() => {
  act(() => cleanup.splice(0).forEach((fn) => fn()));
  document.body.innerHTML = '';
});

const TOC: TocEntry[] = [
  { label: 'Part One', index: 1, depth: 0 },
  { label: 'Chapter 1: The Harbor', index: 1, depth: 1 },
  { label: 'Chapter 2: The Lantern', index: 2, depth: 1 },
  { label: 'Part Two', index: 3, depth: 0 },
];

function setup(opts: { isMobile?: boolean } = {}) {
  const store = createReaderStore('Long Mock Novel');
  const settingsData = { ...DEFAULT_SETTINGS };
  const settings = createSettingsStore(settingsData);
  const bookmarks: Bookmark[] = [{ id: 'b1', chapterIndex: 2, name: 'Lantern scene', createdAt: 1 }];
  const calls: string[] = [];
  let contentReady: { content: HTMLElement; book: HTMLElement } | null = null;
  const readyBooks: HTMLElement[] = [];

  const actions: ReaderActions = {
    contentReady: (content, book) => {
      contentReady = { content, book };
      readyBooks.push(book);
    },
    navigate: (d) => calls.push(`navigate ${d}`),
    seek: (f) => calls.push(`seek ${f.toFixed(2)}`),
    jumpEntry: (d) => calls.push(`jumpEntry ${d}`),
    toggleChrome: () => store.setState((s) => ({ chromeHidden: !s.chromeHidden })),
    setPanel: (panel) => store.setState({ panel }),
    getToc: () => TOC,
    jumpToToc: (e) => calls.push(`toc ${e.label}`),
    search: (q) => [{ chapterIndex: 2, label: 'Chapter 2', snippet: `the ${q} glowed over the ${q} harbor` }],
    jumpToHit: (h, q) => calls.push(`hit ${h.chapterIndex} ${q}`),
    clearSearch: () => calls.push('clearSearch'),
    getBookmarks: () => bookmarks,
    addBookmark: async () => void calls.push('addBookmark'),
    goToBookmark: (b) => calls.push(`bookmark ${b.name}`),
    deleteBookmark: async (id) => {
      bookmarks.splice(bookmarks.findIndex((b) => b.id === id), 1);
      store.setState((s) => ({ bookmarksVersion: s.bookmarksVersion + 1 }));
    },
    exportNotes: () => calls.push('export'),
    updateSettings: (patch) => {
      Object.assign(settingsData, patch);
      settings.setState({ settings: { ...settingsData } });
    },
    toggleStoryView: () => store.setState((s) => ({ storyView: s.storyView === 'vn' ? 'script' : 'vn' })),
  };
  let clickHandler: ((id: string, el: HTMLElement) => void) | null = null;
  const highlights: HighlightActions = {
    getContentEl: () => contentReady?.book.querySelector<HTMLElement>('.rr-epub-content') ?? null,
    captureSelection: () => null,
    getHighlight: (id) => (id === 'h1' ? { id, chapterIndex: 1, text: 'lantern', prefix: '', suffix: '', color: 'yellow', note: 'remember', createdAt: 1 } : undefined),
    create: () => null,
    recolor: (id, c) => calls.push(`recolor ${id} ${c}`),
    setNote: (id, n) => calls.push(`note ${id} ${n}`),
    remove: (id) => calls.push(`remove ${id}`),
    onHighlightClick: (h) => (clickHandler = h),
  };
  const ctx: ReaderContextValue = { app, store, settings, actions, highlights, isMobile: !!opts.isMobile, version: '9.9.9' };

  const host = document.body.createDiv();
  act(() => {
    cleanup.push(mountReact(app, host, <ReaderContext.Provider value={ctx}><ReaderApp title="Long Mock Novel" /></ReaderContext.Provider>));
  });
  return { host, store, settings, calls, bookmarks, readyBooks, book: () => contentReady!.book, content: () => contentReady!.content, click: () => clickHandler };
}

const $ = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
const $$ = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)];
const setInput = (el: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('reader frame', () => {
  it('renders the bars and hands one empty book element to the reader', () => {
    const { host, readyBooks, book } = setup();
    expect($('.rr-topbar', host)).not.toBeNull();
    expect($('.rr-bottombar', host)).not.toBeNull();
    expect($('.rr-loading.is-visible', host)).not.toBeNull();
    // StrictMode (dev) runs the effect twice; it's always the same element, and
    // ReaderView mounts the book only once per element.
    expect(new Set(readyBooks).size).toBe(1);
    expect(book().classList.contains('rr-epub-container')).toBe(true);
    expect(book().childElementCount).toBe(0);
  });

  it('top-bar buttons carry the classes the mobile CSS keeps visible', () => {
    const { host } = setup();
    const label = (l: string) => $(`[aria-label="${l}"]`, host)!;
    expect(label('Table of contents').classList.contains('rr-keep-mobile')).toBe(true);
    expect(label('Search in book').classList.contains('rr-keep-mobile')).toBe(true);
    expect(label('Reader settings').classList.contains('rr-gear')).toBe(true);
  });

  it('never touches the book DOM while the frame re-renders', () => {
    const { host, store, settings, book } = setup();
    // What the EpubReader would render.
    const scroll = book().createDiv({ cls: 'rr-epub-scroll' });
    const content = scroll.createDiv({ cls: 'rr-epub-content' });
    content.innerHTML = '<p>Call me <span data-hl-id="h1" class="rr-hl rr-hl-yellow">lantern</span>.</p><mark class="rr-search-mark">x</mark>';
    const snapshot = book().innerHTML;

    act(() => {
      store.setState({ loading: false, ready: true, chapterLabel: 'Chapter 7', milestones: [0.1, 0.5], entryNav: { prev: true, next: true } });
      store.setState({ progress: { current: 3, total: 40, fraction: 0.3 } });
      store.setState({ panel: 'settings' });
      settings.setState({ settings: { ...settings.getState().settings, fontSize: 24, theme: 'sepia' } });
      store.setState({ chromeHidden: true, panel: null });
    });
    expect(book().innerHTML).toBe(snapshot);
    expect(book().firstElementChild).toBe(scroll);
    expect($('.rr-reader-root', host)!.style.getPropertyValue('--rr-font-size')).toBe('24px');
    expect($('.rr-reader-root', host)!.classList.contains('rr-chrome-hidden')).toBe(true);
  });

  it('progress updates reach the slider and indicator without re-rendering', () => {
    const { host, store, calls } = setup();
    act(() => store.setState({ milestones: [0.25, 0.75] }));
    act(() => store.setState({ progress: { current: 12, total: 40, fraction: 0.5 } }));
    expect($('.rr-slider-label', host)!.textContent).toBe('12 / 40');
    expect($('.rr-page-indicator', host)!.textContent).toBe('50%');
    expect($('.rr-slider-fill', host)!.style.width).toBe('50%');
    expect($$('.rr-slider-dot.is-passed', host)).toHaveLength(1);
    // Navigation buttons reach the reader.
    act(() => $('[aria-label="Next"]', host)!.click());
    expect(calls).toContain('navigate 1');
  });

  it('stories get view-switch and music buttons; the music button toggles the setting', () => {
    const { host, store, settings } = setup();
    expect($('[aria-label="Turn music off"]', host)).toBeNull(); // not a story
    act(() => store.setState({ storyView: 'script' }));
    expect($('[aria-label="Switch to visual-novel view"]', host)).not.toBeNull();
    act(() => $('[aria-label="Turn music off"]', host)!.click());
    expect(settings.getState().settings.storyMusicMuted).toBe(true);
    act(() => $('[aria-label="Turn music on"]', host)!.click());
    expect(settings.getState().settings.storyMusicMuted).toBe(false);
  });

  it('chapter label follows the store', () => {
    const { host, store } = setup();
    expect($('.rr-topbar-title', host)!.textContent).toBe('Long Mock Novel');
    act(() => store.setState({ chapterLabel: 'Chapter 2: The Lantern' }));
    expect($('.rr-topbar-title', host)!.textContent).toBe('Chapter 2: The Lantern');
  });

  it('table of contents: filters, jumps, and closes after a jump', () => {
    const { host, store, calls } = setup();
    act(() => $('[aria-label="Table of contents"]', host)!.click());
    expect($$('.rr-toc-item', host)).toHaveLength(4);
    expect($$('.rr-toc-item', host)[1].style.paddingLeft).toBe('28px'); // nested entry indents
    act(() => setInput($('.rr-toc-search', host) as HTMLInputElement, 'lantern'));
    expect($$('.rr-toc-item', host).map((b) => b.textContent)).toEqual(['Chapter 2: The Lantern']);
    act(() => $$('.rr-toc-item', host)[0].click());
    expect(calls).toContain('toc Chapter 2: The Lantern');
    expect(store.getState().panel).toBeNull();
  });

  it('search: debounced results with highlighted snippet; closing clears the mark', async () => {
    vi.useFakeTimers();
    try {
      const { host, store, calls } = setup();
      act(() => $('[aria-label="Search in book"]', host)!.click());
      act(() => setInput($('.rr-search-input', host) as HTMLInputElement, 'zephyrine'));
      expect($$('.rr-search-result', host)).toHaveLength(0); // still debouncing
      await act(async () => vi.advanceTimersByTime(250));
      expect($('.rr-search-count', host)!.textContent).toBe('1 result');
      expect($$('.rr-search-result-snippet mark', host)).toHaveLength(2);
      act(() => $('.rr-search-result', host)!.click());
      expect(calls).toContain('hit 2 zephyrine');
      act(() => store.setState({ panel: null }));
      expect(calls).toContain('clearSearch');
    } finally {
      vi.useRealTimers();
    }
  });

  it('quick settings: theme, font size, bookmarks', () => {
    const { host, settings, calls } = setup();
    act(() => $('[aria-label="Reader settings"]', host)!.click());
    const chip = (text: string) => $$('.rr-qs-chip', host).find((b) => b.textContent === text)!;
    act(() => chip('sepia').click());
    expect(settings.getState().settings.theme).toBe('sepia');
    expect(chip('sepia').classList.contains('is-active')).toBe(true);
    act(() => chip('+').click());
    expect(settings.getState().settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize + 1);
    expect($('.rr-qs-version', host)!.textContent).toBe('R Reader v9.9.9');
    // Bookmarks: jump, then delete.
    act(() => $('.rr-bookmark-jump', host)!.click());
    expect(calls).toContain('bookmark Lantern scene');
    act(() => $('[aria-label="Reader settings"]', host)!.click());
    act(() => $('.rr-bookmark-del', host)!.click());
    return new Promise<void>((r) => setTimeout(r, 0)).then(() => {
      expect($$('.rr-bookmark-row', host)).toHaveLength(0);
    });
  });

  it('one panel at a time', () => {
    const { host, store } = setup();
    act(() => $('[aria-label="Table of contents"]', host)!.click());
    act(() => $('[aria-label="Reader settings"]', host)!.click());
    expect(store.getState().panel).toBe('settings');
    expect($('.rr-toc-panel', host)).toBeNull();
  });

  it('tapping a highlight opens its editor on <body>', () => {
    const { store, book, click, calls } = setup();
    const content = book().createDiv({ cls: 'rr-epub-scroll' }).createDiv({ cls: 'rr-epub-content' });
    const span = content.createSpan({ text: 'lantern' });
    act(() => store.setState({ ready: true, loading: false }));
    act(() => click()!('h1', span));
    const editor = $('body > .rr-hl-editor')!;
    expect(editor).not.toBeNull();
    expect((editor.querySelector('textarea') as HTMLTextAreaElement).value).toBe('remember');
    act(() => (editor.querySelector('.rr-hl-blue') as HTMLElement).click());
    expect(calls).toContain('recolor h1 blue');
    act(() => (editor.querySelector('.rr-hl-done') as HTMLElement).click());
    expect($('body > .rr-hl-editor')).toBeNull();
  });

  it('mobile: side rail with entry buttons, and the progress-position option', () => {
    const { host, store, calls } = setup({ isMobile: true });
    expect($('.rr-reader-root.rr-mobile.rr-progress-right', host)).not.toBeNull();
    act(() => store.setState({ entryNav: { prev: false, next: true }, progress: { current: 5, total: 40, fraction: 0.1 } }));
    expect(($('[aria-label="Previous entry"]', host) as HTMLButtonElement).disabled).toBe(true);
    act(() => $('[aria-label="Next entry"]', host)!.click());
    expect(calls).toContain('jumpEntry 1');
    expect($$('.rr-rail-num', host).map((n) => n.textContent)).toEqual(['5', '40']);
    act(() => $('[aria-label="Reader settings"]', host)!.click());
    expect($$('.rr-qs-label', host).map((l) => l.textContent)).toContain('Progress');
  });
});

describe('library', () => {
  it('lists books by folder with recent reads, progress, highlights and lazy covers', async () => {
    const { LibraryView } = await import('../library/LibraryView');
    globalThis.IntersectionObserver = class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(el: Element) {
        queueMicrotask(() => this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver));
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;

    const mk = (p: string) => new (TFile as unknown as new (path: string) => TFile)(p);
    const files = [mk('Books/Novel.epub'), mk('Books/Sampler.epub'), mk('Tiny.epub'), mk('notes.md')];
    files[0].parent = { path: 'Books' } as TFile['parent'];
    files[1].parent = { path: 'Books' } as TFile['parent'];
    const settingsData = { ...DEFAULT_SETTINGS };
    const plugin = {
      settings: settingsData,
      settingsStore: createSettingsStore(settingsData),
      saveSettings: async () => plugin.settingsStore.setState({ settings: { ...settingsData } }),
      progressManager: {
        get: (p: string) => (p === 'Books/Novel.epub' ? 0.42 : undefined),
        getLastRead: (p: string) => (p === 'Books/Novel.epub' ? 5 : undefined),
      },
      annotationManager: { highlightCount: (p: string) => (p === 'Books/Novel.epub' ? 3 : 0) },
      coverCache: {
        getDetails: async (f: TFile) => ({ coverUrl: f.basename === 'Novel' ? 'blob:cover' : null, title: `${f.basename} (title)`, author: 'R. Tester' }),
        invalidateAll: async () => {},
      },
    };
    const view = new (LibraryView as unknown as new (leaf: unknown, plugin: unknown) => { contentEl: HTMLElement; app: unknown; onOpen(): Promise<void>; onClose(): Promise<void>; registerEvent(): void })(null, plugin);
    view.contentEl = document.body.createDiv();
    view.app = { vault: { getFiles: () => files, on: () => ({}) }, workspace: { getLeaf: () => ({ openFile: async () => {} }) } };
    view.registerEvent = () => {};
    await act(async () => view.onOpen());
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    cleanup.push(() => void view.onClose());

    const titles = $$('.rr-library-section-title', view.contentEl).map((t) => t.textContent);
    // "/" (vault root) sorts before folder names, as in the old library.
    expect(titles).toEqual(['Recently read', 'Vault root', 'Books']);
    expect($$('.rr-book-card', view.contentEl)).toHaveLength(4); // 1 recent + 2 + 1
    const novel = $('.rr-book-card', view.contentEl)!;
    expect(novel.querySelector('.rr-book-pct')!.textContent).toBe('42%');
    expect(novel.querySelector('.rr-book-hl')!.textContent).toBe('3 ✎');
    expect(novel.querySelector('img')!.getAttribute('src')).toBe('blob:cover');
    expect(novel.querySelector('.rr-book-title')!.textContent).toBe('Novel (title)');

    // Collapse a section: its cards go away and the choice is saved.
    await act(async () => $$('.rr-library-section-head', view.contentEl)[2].click());
    expect(settingsData.libraryCollapsed).toEqual(['Books']);
    expect($$('.rr-book-card', view.contentEl)).toHaveLength(2);

    // Search narrows the list.
    await act(async () => setInput($('.rr-library-search', view.contentEl) as HTMLInputElement, 'tiny'));
    expect($$('.rr-library-section-title', view.contentEl).map((t) => t.textContent)).toEqual(['Vault root']);
  });

  it('Arknights tab: stories by storyline in reading order, with recent reads', async () => {
    const { LibraryView } = await import('../library/LibraryView');
    const mk = (p: string) => {
      const f = new (TFile as unknown as new (path: string) => TFile)(p);
      const folder = p.split('/').slice(0, -1);
      f.parent = { path: folder.join('/'), name: folder[folder.length - 1] } as TFile['parent'];
      return f;
    };
    const files = [
      mk('AK/Small Stories/Tales of Terra/13 - A Kazdelian Rescue.ark'),
      mk('AK/Big Stories/Tales of Terra/01 - Code of Brawl.ark'),
      mk('AK/Big Stories/Unassigned Side Stories/02 - Delicious On Terra.ark'),
      mk('AK/Big Stories/Main Theme/02 - Evil Time Part 2.ark'),
      mk('AK/Big Stories/Main Theme/01 - Evil Time Part 1.ark'),
      mk('Books/Novel.epub'),
    ];
    const settingsData = { ...DEFAULT_SETTINGS, libraryTab: 'ark' as const };
    const plugin = {
      settings: settingsData,
      settingsStore: createSettingsStore(settingsData),
      saveSettings: async () => plugin.settingsStore.setState({ settings: { ...settingsData } }),
      progressManager: {
        get: (p: string) => (p.endsWith('Part 2.ark') ? 0.5 : undefined),
        getLastRead: (p: string) => (p.endsWith('Part 2.ark') ? 5 : undefined),
      },
      annotationManager: { highlightCount: () => 0 },
      coverCache: { getDetails: async () => ({ coverUrl: null, title: '', author: '' }), invalidateAll: async () => {} },
    };
    const view = new (LibraryView as unknown as new (leaf: unknown, plugin: unknown) => { contentEl: HTMLElement; app: unknown; onOpen(): Promise<void>; onClose(): Promise<void>; registerEvent(): void })(null, plugin);
    view.contentEl = document.body.createDiv();
    view.app = { vault: { getFiles: () => files, on: () => ({}) }, workspace: { getLeaf: () => ({ openFile: async () => {} }) } };
    view.registerEvent = () => {};
    await act(async () => view.onOpen());
    cleanup.push(() => void view.onClose());

    expect($$('.rr-library-tab', view.contentEl).map((t) => t.textContent)).toEqual(['Books', 'Arknights']);
    expect($$('.rr-library-section-title', view.contentEl).map((t) => t.textContent)).toEqual([
      'Recently read',
      'Main Theme',
      'Tales of Terra',
      'Unassigned Side Stories',
    ]);
    const rows = (i: number) =>
      $$('.rr-library-section', view.contentEl)[i].querySelectorAll('.rr-story-row');
    expect(Array.from(rows(1)).map((r) => r.querySelector('.rr-story-title')!.textContent)).toEqual(['Evil Time Part 1', 'Evil Time Part 2']);
    // Big and Small Stories of one storyline merge, in story-number order.
    expect(Array.from(rows(2)).map((r) => r.querySelector('.rr-story-num')!.textContent)).toEqual(['01', '13']);
    expect(rows(0)[0].querySelector('.rr-story-line')!.textContent).toBe('Main Theme');
    expect(rows(0)[0].querySelector('.rr-story-pct')!.textContent).toBe('50%');

    // Search covers storyline names; switching tabs is remembered.
    await act(async () => setInput($('.rr-library-search', view.contentEl) as HTMLInputElement, 'terra'));
    expect($$('.rr-story-title', view.contentEl).map((t) => t.textContent)).toEqual(['Code of Brawl', 'A Kazdelian Rescue', 'Delicious On Terra']);
    await act(async () => $$('.rr-library-tab', view.contentEl)[0].click());
    expect(settingsData.libraryTab).toBe('books');
    expect($$('.rr-story-row', view.contentEl)).toHaveLength(0);
  });
});
