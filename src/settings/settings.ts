import type { HighlightColor } from '../annotations/types';

export type Theme = 'light' | 'dark' | 'sepia';
export type ScrollMode = 'paginated' | 'continuous';

export interface PluginSettings {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollMode: ScrollMode;
  touchToScroll: boolean;
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
}

export const DEFAULT_SETTINGS: PluginSettings = {
  theme: 'dark',
  fontFamily: 'Georgia, serif',
  fontSize: 18,
  lineHeight: 1.6,
  scrollMode: 'continuous',
  touchToScroll: true,
  hideBarsOnMobile: false,
  detectAllExtensions: true,
  noImageMode: false,
  closeMenuAfterTocJump: true,
  notesExportFolder: 'R Reader Notes',
  defaultHighlightColor: 'yellow',
  libraryGroupByFolder: true,
  libraryCollapsed: [],
};
