import type { HighlightColor } from '../annotations/types';

/** 'obsidian' follows the active Obsidian theme (like the library view does). */
export type Theme = 'obsidian' | 'light' | 'dark' | 'sepia';
export type ScrollMode = 'paginated' | 'continuous';
/** Where the reading-progress slider sits: a bottom bar, or a floating right rail. */
export type ProgressBarPosition = 'bottom' | 'right';
/** `.ark` story view: scrolling script, or visual novel. */
export type StoryView = 'script' | 'vn';

export interface PluginSettings {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollMode: ScrollMode;
  touchToScroll: boolean;
  /** How far a tap / page-turn scrolls, in units of one screen height. */
  tapScrollScreens: number;
  /** Duration (ms) of the tap / page-turn scroll animation; 0 = instant. */
  tapScrollDuration: number;
  /** On mobile, start with the top/bottom bars hidden (tap center to show). */
  hideBarsOnMobile: boolean;
  /** Bottom bar, or a slim vertical bar floating on the right edge. */
  progressBarPosition: ProgressBarPosition;
  /** Apply Obsidian's "detect all file extensions" on load. This plugin
   *  setting syncs via data.json, so EPUBs show on every device. */
  detectAllExtensions: boolean;
  /** Render a text placeholder instead of images. */
  noImageMode: boolean;
  /** Close the quick-settings menu after jumping to a TOC chapter. */
  closeMenuAfterTocJump: boolean;
  /** Vault folder where exported reading notes are written. */
  notesExportFolder: string;
  /** Default color used when creating a highlight. */
  defaultHighlightColor: HighlightColor;
  /** Name shown for {@nickname} in `.ark` stories. */
  storyNickname: string;
  /** Vault folder with the stories' shared `media.json` and media files. */
  storyAssetsFolder: string;
  /** In `.ark` stories, play the music of the scene being read while scrolling. */
  storyAutoplayMusic: boolean;
  /** How `.ark` stories open: the scrolling script, or the visual-novel stage. */
  storyDefaultView: StoryView;
  /** Visual-novel view: letters per second for typed-out lines; 0 shows lines at once. */
  storyTextSpeed: number;
  /** Story music off (the top-bar speaker button); sound effects still play. */
  storyMusicMuted: boolean;
  /** Group the library by folder (vs. one flat grid). */
  libraryGroupByFolder: boolean;
  /** Library section keys (folder paths / "__recent" / "__all") collapsed by the user. */
  libraryCollapsed: string[];
  /** Library tab last shown: EPUB books, or `.ark` stories by storyline. */
  libraryTab: 'books' | 'ark';
  /** Set once the old 'dark' default has been migrated to the 'obsidian' theme. */
  themeMigratedToObsidian: boolean;
  /** Set once the progress bar has been moved to the side rail by default. */
  progressMigratedToRight: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  theme: 'obsidian',
  fontFamily: 'Georgia, serif',
  fontSize: 18,
  lineHeight: 1.6,
  scrollMode: 'continuous',
  touchToScroll: true,
  tapScrollScreens: 0.5,
  tapScrollDuration: 250,
  hideBarsOnMobile: false,
  progressBarPosition: 'right',
  detectAllExtensions: true,
  noImageMode: false,
  closeMenuAfterTocJump: true,
  notesExportFolder: 'R Reader Notes',
  defaultHighlightColor: 'yellow',
  storyNickname: 'Doctor',
  storyAssetsFolder: 'Arknights Story Assets',
  storyAutoplayMusic: true,
  storyDefaultView: 'script',
  storyTextSpeed: 0,
  storyMusicMuted: false,
  libraryGroupByFolder: true,
  libraryCollapsed: [],
  libraryTab: 'books',
  themeMigratedToObsidian: true,
  progressMigratedToRight: true,
};
