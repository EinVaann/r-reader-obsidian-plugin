/** Helpers for driving the dev harness from Playwright tests. */
import { expect, type Page } from '@playwright/test';

export const BOOK = 'Books/The Harbor Lantern.epub';

/** Open a harness scene (query string) and wait until it has rendered; fails on page errors. */
export async function open(page: Page, query = ''): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  (page as Page & { __errors?: string[] }).__errors = errors;
  await page.goto(`/index.html?${query}`);
  await page.waitForFunction(() => {
    if (window.__error) return true;
    if (window.__store === undefined) return false;
    const s = window.__store?.getState();
    if (!s) return !!document.querySelector('.rr-library-body');
    return (s.ready && !s.loading) || !!s.error;
  });
  expect(await page.evaluate(() => window.__error ?? null)).toBeNull();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

/** Page errors so far (checked after every test). */
export const pageErrors = (page: Page): string[] => (page as Page & { __errors?: string[] }).__errors ?? [];

/** Actions the fake Obsidian received (open file, notices…). */
export const log = (page: Page) => page.evaluate(() => window.__log);

/** A plugin setting's current value. */
export const setting = (page: Page, key: string) => page.evaluate((k) => (window.__plugin.settings as unknown as Record<string, unknown>)[k], key);

/** Saved annotations for the fixture book. */
export const annotations = (page: Page) => page.evaluate((b) => window.__plugin.annotationManager.get(b), BOOK);

/** Saved progress for a file. */
export const progress = (page: Page, file = BOOK) => page.evaluate((f) => window.__plugin.progressManager.get(f), file);

/** Patch the open book's UI store. */
export const setReader = (page: Page, patch: Record<string, unknown>) => page.evaluate((p) => window.__store!.setState(p), patch);

export const scrollTop = (page: Page): Promise<number> => page.locator('.rr-epub-scroll').evaluate((el) => el.scrollTop);

/** Scroll the book to an absolute offset and let the reader catch up. */
export async function scrollBookTo(page: Page, top: number): Promise<void> {
  await page.locator('.rr-epub-scroll').evaluate((el, t) => el.scrollTo(0, t), top);
  await page.waitForTimeout(150);
}
