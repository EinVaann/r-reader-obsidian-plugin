import type RReaderPlugin from '../../main';

export class ProgressManager {
  private plugin: RReaderPlugin;
  private progress: Record<string, string | number> = {};

  constructor(plugin: RReaderPlugin) {
    this.plugin = plugin;
  }

  /** Seed from the data loaded at plugin startup. */
  load(progress?: Record<string, string | number>): void {
    if (progress) this.progress = progress;
  }

  async save(filePath: string, position: string | number): Promise<void> {
    this.progress[filePath] = position;
    await this.plugin.persist();
  }

  get(filePath: string): string | number | null {
    return this.progress[filePath] ?? null;
  }

  getAll(): Record<string, string | number> {
    return this.progress;
  }
}
