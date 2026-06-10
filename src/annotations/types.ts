/** Annotation data model. Stored as structured JSON in the plugin's data.json,
 *  keyed by file path, so it syncs across devices like settings + progress. */

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

export const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];

/** A text highlight, re-anchored on load via a text-quote (prefix/exact/suffix). */
export interface Highlight {
  id: string;
  /** Spine/section index of the chapter the highlight lives in. */
  chapterIndex: number;
  /** The exact selected text. */
  text: string;
  /** ~40 chars of context immediately before `text` (for robust re-anchoring). */
  prefix: string;
  /** ~40 chars of context immediately after `text`. */
  suffix: string;
  color: HighlightColor;
  /** Optional annotation attached to the highlight. */
  note?: string;
  createdAt: number;
}

/** A named position the reader can jump back to. */
export interface Bookmark {
  id: string;
  chapterIndex: number;
  /** Nearest element id at capture time, when available. */
  anchorId?: string;
  /** Fallback: whole-book scroll fraction at capture time. */
  fraction?: number;
  name: string;
  createdAt: number;
}

/** All annotations for a single book. */
export interface BookAnnotations {
  highlights: Highlight[];
  bookmarks: Bookmark[];
}

export function emptyAnnotations(): BookAnnotations {
  return { highlights: [], bookmarks: [] };
}
