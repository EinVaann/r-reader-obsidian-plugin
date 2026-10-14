import type { ReadingAnchor } from './ProgressManager';
import type { BookAnnotations } from '../annotations/types';

/** Everything recorded while reading: positions plus highlights and bookmarks. */
export interface ReadingData {
  progress: Record<string, string | number>;
  lastRead: Record<string, number>;
  anchors: Record<string, ReadingAnchor>;
  annotations: Record<string, BookAnnotations>;
}

export function emptyReadingData(): ReadingData {
  return { progress: {}, lastRead: {}, anchors: {}, annotations: {} };
}

/** Pick the reading-data fields out of parsed JSON, tolerating missing or odd shapes. */
export function readingDataFrom(raw: unknown): ReadingData {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rec = <T>(v: unknown): Record<string, T> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {};
  return {
    progress: rec(o.progress),
    lastRead: rec(o.lastRead),
    anchors: rec(o.anchors),
    annotations: rec(o.annotations),
  };
}

/**
 * Tidy a vault-relative path typed into settings. '' means the plugin's own
 * data.json; anything else is a vault file, given a `.json` extension if missing.
 */
export function normalizeDataPath(raw: string): string {
  const p = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!p) return '';
  return p.toLowerCase().endsWith('.json') ? p : `${p}.json`;
}

/**
 * Combine the data in memory with what an existing file at the new location
 * holds, so switching locations never drops either side. Per book, the side
 * read more recently wins the position; highlights and bookmarks are united by
 * id (the more recent side wins an id both have).
 */
export function mergeReadingData(current: ReadingData, other: ReadingData): ReadingData {
  const out = emptyReadingData();
  const books = new Set([
    ...Object.keys(current.progress),
    ...Object.keys(other.progress),
    ...Object.keys(current.annotations),
    ...Object.keys(other.annotations),
  ]);
  for (const book of books) {
    const otherNewer = (other.lastRead[book] ?? -1) > (current.lastRead[book] ?? -1);
    const [win, lose] = otherNewer ? [other, current] : [current, other];
    const src = book in win.progress ? win : lose;
    if (book in src.progress) {
      out.progress[book] = src.progress[book];
      if (src.anchors[book]) out.anchors[book] = src.anchors[book];
    }
    const t = Math.max(current.lastRead[book] ?? -1, other.lastRead[book] ?? -1);
    if (t >= 0) out.lastRead[book] = t;
    const a = win.annotations[book];
    const b = lose.annotations[book];
    if (a || b) {
      out.annotations[book] = {
        highlights: unionById(a?.highlights ?? [], b?.highlights ?? []),
        bookmarks: unionById(a?.bookmarks ?? [], b?.bookmarks ?? []),
      };
    }
  }
  return out;
}

/** Items of `first`, then those of `second` whose id isn't already taken. */
function unionById<T extends { id: string }>(first: T[], second: T[]): T[] {
  const seen = new Set(first.map((x) => x.id));
  return [...first, ...second.filter((x) => !seen.has(x.id))];
}
