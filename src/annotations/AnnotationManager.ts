import type RReaderPlugin from '../../main';
import {
  type BookAnnotations,
  type Bookmark,
  type Highlight,
  emptyAnnotations,
} from './types';

/**
 * Holds highlights + bookmarks per file path in memory and persists them via
 * `plugin.persist()` (same data.json as settings + progress). Mirrors the
 * shape and lifecycle of ProgressManager.
 */
export class AnnotationManager {
  private plugin: RReaderPlugin;
  private data: Record<string, BookAnnotations> = {};

  constructor(plugin: RReaderPlugin) {
    this.plugin = plugin;
  }

  /** Seed from the data loaded at plugin startup. */
  load(data?: Record<string, BookAnnotations>): void {
    if (data) this.data = data;
  }

  getAll(): Record<string, BookAnnotations> {
    return this.data;
  }

  /** Annotations for a book (always returns a live object you can read from). */
  get(filePath: string): BookAnnotations {
    let entry = this.data[filePath];
    if (!entry) {
      entry = emptyAnnotations();
      this.data[filePath] = entry;
    }
    // Defensive: tolerate older/partial shapes.
    if (!Array.isArray(entry.highlights)) entry.highlights = [];
    if (!Array.isArray(entry.bookmarks)) entry.bookmarks = [];
    return entry;
  }

  // --- Highlights ---
  async addHighlight(filePath: string, h: Highlight): Promise<void> {
    this.get(filePath).highlights.push(h);
    await this.plugin.persist();
  }

  async updateHighlight(filePath: string, id: string, patch: Partial<Highlight>): Promise<void> {
    const h = this.get(filePath).highlights.find((x) => x.id === id);
    if (!h) return;
    Object.assign(h, patch);
    await this.plugin.persist();
  }

  async removeHighlight(filePath: string, id: string): Promise<void> {
    const entry = this.get(filePath);
    entry.highlights = entry.highlights.filter((x) => x.id !== id);
    await this.plugin.persist();
  }

  // --- Bookmarks ---
  async addBookmark(filePath: string, b: Bookmark): Promise<void> {
    this.get(filePath).bookmarks.push(b);
    await this.plugin.persist();
  }

  async removeBookmark(filePath: string, id: string): Promise<void> {
    const entry = this.get(filePath);
    entry.bookmarks = entry.bookmarks.filter((x) => x.id !== id);
    await this.plugin.persist();
  }

  /** Count of highlights for a book (used by the library cards). */
  highlightCount(filePath: string): number {
    return this.data[filePath]?.highlights?.length ?? 0;
  }
}

/** Small unique id generator (no external dep). */
export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
