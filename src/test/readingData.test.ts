import { describe, expect, it } from 'vitest';
import { emptyReadingData, mergeReadingData, normalizeDataPath, readingDataFrom } from '../reading-progress/readingData';
import type { Highlight } from '../annotations/types';

const hl = (id: string, note = ''): Highlight => ({
  id, chapterIndex: 0, text: id, prefix: '', suffix: '', color: 'yellow', note, createdAt: 0,
});

describe('normalizeDataPath', () => {
  it('keeps empty as the plugin default', () => {
    expect(normalizeDataPath('   ')).toBe('');
  });
  it('tidies slashes and adds .json', () => {
    expect(normalizeDataPath(' /Reading\\\\data//progress/ ')).toBe('Reading/data/progress.json');
    expect(normalizeDataPath('a/b.JSON')).toBe('a/b.JSON');
  });
});

describe('readingDataFrom', () => {
  it('fills missing fields', () => {
    expect(readingDataFrom(null)).toEqual(emptyReadingData());
    expect(readingDataFrom({ progress: { a: 0.5 }, anchors: [] }).anchors).toEqual({});
  });
});

describe('mergeReadingData', () => {
  it('takes each book from whichever side was read last', () => {
    const cur = emptyReadingData();
    cur.progress = { a: 0.1, b: 0.9 };
    cur.lastRead = { a: 100, b: 300 };
    cur.anchors = { a: { chapter: 1, block: 2, offset: 0 } };
    const other = emptyReadingData();
    other.progress = { a: 0.5, b: 0.2, c: 0.3 };
    other.lastRead = { a: 200, b: 50, c: 10 };

    const m = mergeReadingData(cur, other);
    expect(m.progress).toEqual({ a: 0.5, b: 0.9, c: 0.3 });
    expect(m.lastRead).toEqual({ a: 200, b: 300, c: 10 });
    // `a` came from the side without an anchor, so the stale anchor is dropped.
    expect(m.anchors).toEqual({});
  });

  it('unites highlights and bookmarks by id', () => {
    const cur = emptyReadingData();
    cur.lastRead = { a: 1 };
    cur.annotations = { a: { highlights: [hl('x', 'mine'), hl('y')], bookmarks: [] } };
    const other = emptyReadingData();
    other.annotations = {
      a: { highlights: [hl('x', 'theirs'), hl('z')], bookmarks: [] },
      b: { highlights: [], bookmarks: [{ id: 'k', chapterIndex: 0, name: 'k', createdAt: 0 }] },
    };

    const m = mergeReadingData(cur, other);
    expect(m.annotations.a.highlights.map((h) => [h.id, h.note])).toEqual([['x', 'mine'], ['y', ''], ['z', '']]);
    expect(m.annotations.b.bookmarks).toHaveLength(1);
  });
});
