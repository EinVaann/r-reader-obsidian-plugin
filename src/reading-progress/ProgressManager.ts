import type RReaderPlugin from '../../main';

export class ProgressManager {
  private plugin: RReaderPlugin;
  private progress: Record<string, string | number> = {};
  /** Epoch millis of the last time each book's progress was saved. */
  private lastRead: Record<string, number> = {};

  constructor(plugin: RReaderPlugin) {
    this.plugin = plugin;
  }

  /** Seed from the data loaded at plugin startup. */
  load(progress?: Record<string, string | number>, lastRead?: Record<string, number>): void {
    if (progress) this.progress = progress;
    if (lastRead) this.lastRead = lastRead;
  }

  async save(filePath: string, position: string | number): Promise<void> {
    this.progress[filePath] = position;
    this.lastRead[filePath] = Date.now();
    await this.plugin.persist();
  }

  get(filePath: string): string | number | null {
    return this.progress[filePath] ?? null;
  }

  getAll(): Record<string, string | number> {
    return this.progress;
  }

  /** Epoch millis a book was last read, or null if never. */
  getLastRead(filePath: string): number | null {
    return this.lastRead[filePath] ?? null;
  }

  getAllLastRead(): Record<string, number> {
    return this.lastRead;
  }
}
