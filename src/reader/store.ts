import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PluginSettings, StoryView } from '../settings/settings';

/**
 * Plugin-wide settings, mirrored into a store so every open reader and the
 * library re-render when they change (from the quick-settings menu, the
 * settings tab, or a command). `plugin.settings` stays the source of truth;
 * `saveSettings` publishes a fresh copy here.
 */
export type SettingsStore = StoreApi<{ settings: PluginSettings }>;

export function createSettingsStore(settings: PluginSettings): SettingsStore {
  return createStore(() => ({ settings: { ...settings } }));
}

/** Which overlay is open. One at a time: opening one closes the others. */
export type ReaderPanel = 'toc' | 'search' | 'settings' | null;

/**
 * UI state for one open book. The EpubReader reports into it (through the
 * ReaderView acting as its host); the React frame renders from it.
 *
 * `progress` changes on every scroll frame — components that show it read it
 * with `store.subscribe` and write the DOM directly instead of re-rendering.
 */
export interface ReaderState {
  /** Screen counter + whole-book fraction (0..1). */
  progress: { current: number; total: number; fraction: number };
  /** Chapter-start fractions, drawn as dots on the slider / rail. */
  milestones: number[];
  /** Nearest table-of-contents label for the text in view. */
  chapterLabel: string;
  /** Whether there's a previous / next table-of-contents entry. */
  entryNav: { prev: boolean; next: boolean };
  loading: boolean;
  /** Why the book failed to open, if it did. */
  error: string | null;
  /** The book is mounted and the reader API is usable. */
  ready: boolean;
  /** Immersive mode: bars hidden. */
  chromeHidden: boolean;
  panel: ReaderPanel;
  /** Bumped when this book's bookmarks change, so lists re-read them. */
  bookmarksVersion: number;
  /** For `.ark` stories, the view on screen; null for other books. */
  storyView: StoryView | null;
}

export type ReaderStore = StoreApi<ReaderState>;

export function createReaderStore(title: string): ReaderStore {
  return createStore<ReaderState>(() => ({
    progress: { current: 0, total: 0, fraction: 0 },
    milestones: [],
    chapterLabel: title,
    entryNav: { prev: false, next: false },
    loading: true,
    error: null,
    ready: false,
    chromeHidden: false,
    panel: null,
    bookmarksVersion: 0,
    storyView: null,
  }));
}
