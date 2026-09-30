import type RReaderPlugin from '../../main';

/** Layout-independent reading position: a block inside a chapter plus how far into it. */
export interface ReadingAnchor {
  chapter: number;
  /** Index of the block element within its chapter. */
  block: number;
  /** 0..1 fraction of that block's height scrolled past the top of the viewport. */
  offset: number;
}

export class ProgressManager {
  private plugin: RReaderPlugin;
  private progress: Record<string, string | number> = {};
  /** Epoch millis of the last time each book's progress was saved. */
  private lastRead: Record<string, number> = {};
  /** Precise position per book; `progress` stays a plain fraction for the library. */
  private anchors: Record<string, ReadingAnchor> = {};

  constructor(plugin: RReaderPlugin) {
    this.plugin = plugin;
  }

  /** Seed from the data loaded at plugin startup. */
  load(
    progress?: Record<string, string | number>,
    lastRead?: Record<string, number>,
    anchors?: Record<string, ReadingAnchor>,
  ): void {
    if (progress) this.progress = progress;
    if (lastRead) this.lastRead = lastRead;
    if (anchors) this.anchors = anchors;
  }

  async save(filePath: string, position: string | number, anchor?: ReadingAnchor | null): Promise<void> {
    this.progress[filePath] = position;
    this.lastRead[filePath] = Date.now();
    if (anchor) this.anchors[filePath] = anchor;
    else delete this.anchors[filePath];
    await this.plugin.persist();
  }

  get(filePath: string): string | number | null {
    return this.progress[filePath] ?? null;
  }

  getAnchor(filePath: string): ReadingAnchor | null {
    return this.anchors[filePath] ?? null;
  }

  getAll(): Record<string, string | number> {
    return this.progress;
  }

  getAllAnchors(): Record<string, ReadingAnchor> {
    return this.anchors;
  }

  /** Epoch millis a book was last read, or null if never. */
  getLastRead(filePath: string): number | null {
    return this.lastRead[filePath] ?? null;
  }

  getAllLastRead(): Record<string, number> {
    return this.lastRead;
  }
}
