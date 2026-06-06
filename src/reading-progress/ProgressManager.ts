import type RReaderPlugin from '../../main';

interface ProgressData {
  progress: Record<string, string | number>;
}

export class ProgressManager {
  private plugin: RReaderPlugin;
  private data: ProgressData = { progress: {} };

  constructor(plugin: RReaderPlugin) {
    this.plugin = plugin;
  }

  async load(): Promise<void> {
    const saved = await this.plugin.loadData() as ProgressData | null;
    if (saved?.progress) {
      this.data = saved;
    }
  }

  async save(filePath: string, position: string | number): Promise<void> {
    this.data.progress[filePath] = position;
    await this.plugin.saveData(this.data);
  }

  get(filePath: string): string | number | null {
    return this.data.progress[filePath] ?? null;
  }
}
