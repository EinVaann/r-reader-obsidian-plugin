import type { PluginSettings } from './settings/settings';

/** Host hooks the reader uses to report state back to the view chrome. */
export interface ReaderHost {
  /**
   * Report reading progress. `current`/`total` are screen/page counts for the
   * indicator; `fraction` (0..1) drives the progress slider.
   */
  setProgress(current: number, total: number, fraction: number): void;
  /** Toggle the loading overlay while content is being rendered. */
  setLoading(loading: boolean): void;
}

/** Common interface implemented by every format reader. */
export interface Reader {
  mount(data: ArrayBuffer): Promise<void>;
  applySettings(settings: PluginSettings): void;
  /** Move one page/screen forward (1) or backward (-1). */
  navigate(dir: 1 | -1): void;
  /** Jump to a 0..1 fraction of the whole book (progress slider). */
  seek(fraction: number): void;
  destroy(): void;
}
