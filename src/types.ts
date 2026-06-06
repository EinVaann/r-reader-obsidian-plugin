import type { PluginSettings } from './settings/settings';

/** Host hooks the reader uses to report state back to the view chrome. */
export interface ReaderHost {
  /** Report reading progress so the top bar can show "current / total". */
  setProgress(current: number, total: number): void;
}

/** Common interface implemented by every format reader. */
export interface Reader {
  mount(data: ArrayBuffer): Promise<void>;
  applySettings(settings: PluginSettings): void;
  /** Move one page/screen forward (1) or backward (-1). */
  navigate(dir: 1 | -1): void;
  destroy(): void;
}
