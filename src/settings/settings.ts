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
}

export const DEFAULT_SETTINGS: PluginSettings = {
  theme: 'dark',
  fontFamily: 'Georgia, serif',
  fontSize: 18,
  lineHeight: 1.6,
  scrollMode: 'continuous',
  touchToScroll: true,
  hideBarsOnMobile: false,
};
