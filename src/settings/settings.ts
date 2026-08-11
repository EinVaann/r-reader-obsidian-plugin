import type { HighlightColor } from '../annotations/types';

/** 'obsidian' follows the active Obsidian theme (like the library view does). */
export type Theme = 'obsidian' | 'light' | 'dark' | 'sepia';
export type ScrollMode = 'paginated' | 'continuous';

export interface PluginSettings {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollMode: ScrollMode;
  touchToScroll: boolean;
  /** How far a tap / page-turn scrolls, in units of one screen height. */
  tapScrollScreens: number;
  /** On mobile, start with the top/bottom bars hidden (tap center to show). */
  hideBarsOnMobile: boolean;
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
  /** Group the library by folder (vs. one flat grid). */
  libraryGroupByFolder: boolean;
  /** Library section keys (folder paths / "__recent" / "__all") collapsed by the user. */
  libraryCollapsed: string[];
  /** Set once the old 'dark' default has been migrated to the 'obsidian' theme. */
  themeMigratedToObsidian: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  theme: 'obsidian',
  fontFamily: 'Georgia, serif',
  fontSize: 18,
  lineHeight: 1.6,
  scrollMode: 'continuous',
  touchToScroll: true,
  tapScrollScreens: 0.5,
  hideBarsOnMobile: false,
  detectAllExtensions: true,
  noImageMode: false,
  closeMenuAfterTocJump: true,
  notesExportFolder: 'R Reader Notes',
  defaultHighlightColor: 'yellow',
  libraryGroupByFolder: true,
  libraryCollapsed: [],
  themeMigratedToObsidian: true,
};
