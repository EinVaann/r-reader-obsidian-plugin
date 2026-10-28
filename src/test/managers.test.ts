import { describe, expect, it, vi } from 'vitest';
import { AnnotationManager, makeId } from '../annotations/AnnotationManager';
import { HIGHLIGHT_COLORS, emptyAnnotations, type Bookmark, type Highlight } from '../annotations/types';
import { ProgressManager } from '../reading-progress/ProgressManager';
import { metaAuthor, metaTitle } from '../util/bookMeta';
import { DEFAULT_SETTINGS } from '../settings/settings';
import { createReaderStore, createSettingsStore } from '../reader/store';

const plugin = () => ({ persist: vi.fn(async () => {}) }) as never;
const hl = (id: string, extra: Partial<Highlight> = {}): Highlight => ({
  id, chapterIndex: 0, text: id, prefix: '', suffix: '', color: 'yellow', createdAt: 1, ...extra,
});
const bm = (id: string): Bookmark => ({ id, chapterIndex: 1, name: id, createdAt: 1 });

describe('AnnotationManager', () => {
  it('creates an empty entry on first get and keeps it live', () => {
    const m = new AnnotationManager(plugin());
    const a = m.get('a.epub');
    expect(a).toEqual(emptyAnnotations());
    expect(m.get('a.epub')).toBe(a);
  });

  it('repairs partial shapes loaded from older data', () => {
    const m = new AnnotationManager(plugin());
    m.load({ 'a.epub': { highlights: undefined, bookmarks: 'x' } as never });
    const a = m.get('a.epub');
    expect(a.highlights).toEqual([]);
    expect(a.bookmarks).toEqual([]);
  });

  it('adds, updates and removes highlights, persisting each time', async () => {
    const p = plugin();
    const m = new AnnotationManager(p);
    await m.addHighlight('a', hl('1'));
    await m.addHighlight('a', hl('2'));
    await m.updateHighlight('a', '1', { note: 'hi', color: 'pink' });
    expect(m.get('a').highlights[0]).toMatchObject({ note: 'hi', color: 'pink' });
    await m.removeHighlight('a', '2');
    expect(m.get('a').highlights.map((h) => h.id)).toEqual(['1']);
    expect((p as unknown as { persist: { mock: { calls: unknown[] } } }).persist.mock.calls).toHaveLength(4);
  });

  it('updating a missing highlight is a no-op that does not persist', async () => {
    const p = plugin();
    const m = new AnnotationManager(p);
    await m.updateHighlight('a', 'nope', { note: 'x' });
    expect((p as never as { persist: ReturnType<typeof vi.fn> }).persist).not.toHaveBeenCalled();
  });

  it('adds and removes bookmarks and counts highlights per book', async () => {
    const m = new AnnotationManager(plugin());
    await m.addBookmark('a', bm('b1'));
    await m.addBookmark('a', bm('b2'));
    await m.removeBookmark('a', 'b1');
    expect(m.get('a').bookmarks.map((b) => b.id)).toEqual(['b2']);
    expect(m.highlightCount('a')).toBe(0);
    expect(m.highlightCount('unknown')).toBe(0);
    await m.addHighlight('a', hl('1'));
    expect(m.highlightCount('a')).toBe(1);
  });

  it('keeps books independent; getAll exposes the live map', async () => {
    const m = new AnnotationManager(plugin());
    await m.addHighlight('a', hl('1'));
    await m.addHighlight('b', hl('2'));
    expect(Object.keys(m.getAll()).sort()).toEqual(['a', 'b']);
    expect(m.get('a').highlights).toHaveLength(1);
  });

  it('makeId yields distinct non-empty ids', () => {
    const ids = new Set(Array.from({ length: 500 }, makeId));
    expect(ids.size).toBe(500);
    expect([...ids].every((i) => /^[a-z0-9]+$/.test(i))).toBe(true);
  });

  it('exposes the four highlight colors', () => {
    expect(HIGHLIGHT_COLORS).toEqual(['yellow', 'green', 'blue', 'pink']);
  });
});

describe('ProgressManager', () => {
  it('returns null for unknown books', () => {
    const m = new ProgressManager(plugin());
    expect(m.get('x')).toBeNull();
    expect(m.getAnchor('x')).toBeNull();
    expect(m.getLastRead('x')).toBeNull();
  });

  it('saves position, stamps lastRead and persists', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(12345);
    const p = plugin();
    const m = new ProgressManager(p);
    await m.save('a', 0.4, { chapter: 2, block: 3, offset: 0.5 });
    expect(m.get('a')).toBe(0.4);
    expect(m.getAnchor('a')).toEqual({ chapter: 2, block: 3, offset: 0.5 });
    expect(m.getLastRead('a')).toBe(12345);
    expect((p as never as { persist: ReturnType<typeof vi.fn> }).persist).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('drops a stale anchor when saved without one', async () => {
    const m = new ProgressManager(plugin());
    await m.save('a', 0.1, { chapter: 0, block: 0, offset: 0 });
    await m.save('a', 0.2, null);
    expect(m.getAnchor('a')).toBeNull();
    expect(m.get('a')).toBe(0.2);
  });

  it('supports string (CFI-like) positions and 0 as a valid value', async () => {
    const m = new ProgressManager(plugin());
    await m.save('a', 'epubcfi(/6/2)');
    expect(m.get('a')).toBe('epubcfi(/6/2)');
    await m.save('b', 0);
    expect(m.get('b')).toBe(0);
  });

  it('load seeds all maps; partial loads keep the rest', () => {
    const m = new ProgressManager(plugin());
    m.load({ a: 0.5 }, { a: 9 }, { a: { chapter: 1, block: 1, offset: 0 } });
    expect(m.getAll()).toEqual({ a: 0.5 });
    expect(m.getAllLastRead()).toEqual({ a: 9 });
    expect(m.getAllAnchors().a.chapter).toBe(1);
    m.load({ b: 1 });
    expect(m.getAll()).toEqual({ b: 1 });
    expect(m.getAllLastRead()).toEqual({ a: 9 });
  });
});

describe('bookMeta', () => {
  it('title: string, language map, empty fallback', () => {
    expect(metaTitle({ title: '  Dune ' }, 'f')).toBe('Dune');
    expect(metaTitle({ title: { en: 'Dune', fr: 'Dune FR' } }, 'f')).toBe('Dune');
    expect(metaTitle({ title: '   ' }, 'file')).toBe('file');
    expect(metaTitle(null, 'file')).toBe('file');
    expect(metaTitle({ title: {} }, 'file')).toBe('file');
  });

  it('author: contributors, language maps, plain strings, creator fallback', () => {
    expect(metaAuthor({ author: [{ name: 'A' }, { name: { en: 'B' } }, { name: '  ' }] })).toBe('A, B');
    expect(metaAuthor({ author: 'Solo ' })).toBe('Solo');
    expect(metaAuthor({ creator: [{ name: 'C' }] })).toBe('C');
    expect(metaAuthor({ author: [] })).toBeUndefined();
    expect(metaAuthor({ author: [{ name: '' }] })).toBeUndefined();
    expect(metaAuthor(undefined)).toBeUndefined();
    expect(metaAuthor({})).toBeUndefined();
  });
});

describe('stores and settings', () => {
  it('settings store copies the settings object and notifies subscribers', () => {
    const s = { ...DEFAULT_SETTINGS };
    const store = createSettingsStore(s);
    expect(store.getState().settings).toEqual(s);
    expect(store.getState().settings).not.toBe(s);
    const seen = vi.fn();
    store.subscribe(seen);
    store.setState({ settings: { ...s, theme: 'sepia' } });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(store.getState().settings.theme).toBe('sepia');
    expect(s.theme).toBe('obsidian');
  });

  it('reader store starts loading with the book title as chapter label', () => {
    const st = createReaderStore('My Book').getState();
    expect(st).toMatchObject({ loading: true, ready: false, error: null, panel: null, chapterLabel: 'My Book', storyView: null });
    expect(st.progress).toEqual({ current: 0, total: 0, fraction: 0 });
  });

  it('reader stores are independent per book', () => {
    const a = createReaderStore('A');
    const b = createReaderStore('B');
    a.setState({ panel: 'toc' });
    expect(b.getState().panel).toBeNull();
  });

  it('default settings are sane', () => {
    const d = DEFAULT_SETTINGS;
    expect(['obsidian', 'light', 'dark', 'sepia']).toContain(d.theme);
    expect(d.fontSize).toBeGreaterThan(0);
    expect(d.lineHeight).toBeGreaterThan(1);
    expect(d.tapScrollScreens).toBeGreaterThan(0);
    expect(d.tapScrollScreens).toBeLessThanOrEqual(1);
    expect(d.tapScrollDuration).toBeGreaterThanOrEqual(0);
    expect(HIGHLIGHT_COLORS).toContain(d.defaultHighlightColor);
    expect(d.readingDataPath).toBe('');
    expect(d.libraryCollapsed).toEqual([]);
    expect(['books', 'ark']).toContain(d.libraryTab);
    expect(['script', 'vn']).toContain(d.storyDefaultView);
  });
});
