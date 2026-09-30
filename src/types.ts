import type { PluginSettings } from './settings/settings';

export interface ChapterProgress {
  /** 1-based screen within the chapter. */
  page: number;
  pages: number;
  /** 0..1 through the chapter's scrollable span. */
  fraction: number;
  /** Nearest table-of-contents label for the chapter. */
  label: string;
}

/** Host hooks the reader uses to report state back to the view chrome. */
export interface ReaderHost {
  /**
   * Report reading progress. `current`/`total` are screen/page counts for the
   * indicator; `fraction` (0..1) drives the progress slider.
   */
  setProgress(current: number, total: number, fraction: number): void;
  /** Chapter-start positions (0..1 fractions) drawn as dots on the slider. */
  setMilestones(fractions: number[]): void;
  /** Screen position within the current chapter, for the side rail. */
  setChapterProgress(p: ChapterProgress): void;
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
