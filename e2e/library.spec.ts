import { expect, test } from '@playwright/test';
import { log, open, pageErrors, setting } from './harness';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const sectionTitles = (page: import('@playwright/test').Page) => page.locator('.rr-library-section-title').allTextContents();

test.describe('library', () => {
  test('books tab: recently read, then folders, with covers and progress', async ({ page }) => {
    await open(page, 'view=library&seed=1');
    await expect(page.locator('.rr-library-tabs')).toBeVisible();
    expect(await sectionTitles(page)).toEqual(expect.arrayContaining(['Recently read']));
    const harbor = page.locator('.rr-book-card[data-path="Books/The Harbor Lantern.epub"]').first();
    await expect(harbor.locator('.rr-book-title')).toHaveText('The Harbor Lantern');
    await expect(harbor.locator('.rr-book-author')).toHaveText('Ada Tester');
    await expect(harbor.locator('.rr-book-pct')).toHaveText('42%');
    await expect(harbor.locator('.rr-book-hl')).toHaveText('1 ✎');
    await expect(page.locator('.rr-book-card[data-path="Classics/Old Tales.epub"] .rr-book-pct')).toHaveText('Unread');
    await expect(page).toHaveScreenshot('books.png');
  });

  test('dark Obsidian theme', async ({ page }) => {
    await open(page, 'view=library&seed=1&obsidian=dark');
    await expect(page).toHaveScreenshot('books-dark.png');
  });

  test('search filters the books', async ({ page }) => {
    await open(page, 'view=library');
    await page.locator('.rr-library-search').fill('sea');
    await expect(page.locator('.rr-book-card')).toHaveCount(1);
    await expect(page.locator('.rr-book-card .rr-book-title')).toHaveText('Sea Charts');
    await page.locator('.rr-library-search').fill('nothing-matches');
    await expect(page.locator('.rr-book-card')).toHaveCount(0);
    await expect(page.locator('.rr-library-empty')).toBeVisible();
  });

  test('"Group by folder" off shows one flat grid', async ({ page }) => {
    await open(page, 'view=library');
    await page.locator('.rr-library-group input').uncheck();
    expect(await setting(page, 'libraryGroupByFolder')).toBe(false);
    await expect(page.locator('.rr-book-card')).toHaveCount(3);
  });

  test('collapsing a section hides its books and is remembered', async ({ page }) => {
    await open(page, 'view=library');
    const head = page.locator('.rr-library-section-head').first();
    const before = await page.locator('.rr-book-card').count();
    await head.click();
    await expect.poll(() => page.locator('.rr-book-card').count()).toBeLessThan(before);
    expect(((await setting(page, 'libraryCollapsed')) as string[]).length).toBe(1);
  });

  test('clicking a card opens the book', async ({ page }) => {
    await open(page, 'view=library');
    await page.locator('.rr-book-card[data-path="Classics/Old Tales.epub"]').click();
    expect(await log(page)).toContain('open Classics/Old Tales.epub');
  });

  test('Arknights tab lists stories and remembers the tab', async ({ page }) => {
    await open(page, 'view=library&seed=1');
    await page.locator('.rr-library-tabs button', { hasText: 'Arknights' }).click();
    expect(await sectionTitles(page)).toEqual(['Recently read', 'Stories']);
    await expect(page.locator('.rr-story-row')).toHaveCount(3);
    expect(await setting(page, 'libraryTab')).toBe('ark');
    await expect(page).toHaveScreenshot('stories.png');
    await page.locator('.rr-story-row').first().click();
    expect((await log(page)).some((l) => l.startsWith('open Stories/'))).toBe(true);
  });
});
