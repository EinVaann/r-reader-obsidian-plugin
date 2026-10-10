import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { App } from 'obsidian';
import type { PluginSettings } from '../settings/settings';
import type { SearchHit, TocEntry } from '../readers/EpubReader';
import type { Bookmark, Highlight, HighlightColor } from '../annotations/types';
import type { QuoteAnchor } from '../annotations/anchor';
import type { ReaderPanel, ReaderState, ReaderStore, SettingsStore } from './store';

/** What the React frame asks the ReaderView (and through it, the EpubReader) to do. */
export interface ReaderActions {
  /** The frame has rendered: mount the book into `bookEl`; `contentEl` takes tap zones. */
  contentReady: (contentEl: HTMLElement, bookEl: HTMLElement) => void;
  navigate: (dir: 1 | -1) => void;
  seek: (fraction: number) => void;
  jumpEntry: (dir: 1 | -1) => void;
  toggleChrome: () => void;
  setPanel: (panel: ReaderPanel) => void;

  getToc: () => TocEntry[];
  jumpToToc: (entry: TocEntry) => void;
  search: (query: string) => SearchHit[];
  jumpToHit: (hit: SearchHit, query: string) => void;
  clearSearch: () => void;

  getBookmarks: () => Bookmark[];
  addBookmark: () => Promise<void>;
  goToBookmark: (b: Bookmark) => void;
  deleteBookmark: (id: string) => Promise<void>;
  exportNotes: () => void;

  updateSettings: (patch: Partial<PluginSettings>) => void;
}

/** Hooks the selection toolbar uses to create and edit highlights. */
export interface HighlightActions {
  /** The rendered book's content element (selections are only handled inside it). */
  getContentEl: () => HTMLElement | null;
  captureSelection: () => QuoteAnchor | null;
  getHighlight: (id: string) => Highlight | undefined;
  /** Persist + render a new highlight; null if it couldn't be anchored. */
  create: (anchor: QuoteAnchor, color: HighlightColor) => Highlight | null;
  recolor: (id: string, color: HighlightColor) => void;
  setNote: (id: string, note: string) => void;
  remove: (id: string) => void;
  /** Called with (id, element) when a highlight in the book is tapped. */
  onHighlightClick: (handler: ((id: string, el: HTMLElement) => void) | null) => void;
}

export interface ReaderContextValue {
  app: App;
  store: ReaderStore;
  settings: SettingsStore;
  actions: ReaderActions;
  highlights: HighlightActions;
  isMobile: boolean;
  version: string;
}

export const ReaderContext = createContext<ReaderContextValue | null>(null);

export function useReaderContext(): ReaderContextValue {
  const ctx = useContext(ReaderContext);
  if (!ctx) throw new Error('useReaderContext() outside a reader');
  return ctx;
}

/** Subscribe to a slice of this book's UI state. */
export function useReader<T>(selector: (s: ReaderState) => T): T {
  return useStore(useReaderContext().store, selector);
}

/** Subscribe to a slice of the plugin settings. */
export function useSettings<T>(selector: (s: PluginSettings) => T): T {
  return useStore(useReaderContext().settings, (s) => selector(s.settings));
}
