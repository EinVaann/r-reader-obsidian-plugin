import { expect, test } from '@playwright/test';
import { annotations, log, open, pageErrors, progress, scrollBookTo, scrollTop, setReader, setting } from './harness';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

test.describe('EPUB reader: rendering', () => {
  test('renders every chapter with the book title and TOC label', async ({ page }) => {
    await open(page, 'view=reader');
    await expect(page.locator('.rr-chapter')).toHaveCount(3);
    await expect(page.locator('.rr-topbar-title')).toHaveText('Chapter 1: The Harbor');
    await expect(page.locator('.rr-chapter h1')).toHaveText(['Chapter 1: The Harbor', 'Chapter 2: The Lantern', 'Chapter 3: The Fog']);
    await expect(page.locator('.rr-slider-label')).toHaveText(/^1 \/ \d+$/);
  });

  test("strips the book's own styles and scripts", async ({ page }) => {
    await open(page, 'view=reader&theme=light');
    await expect(page.locator('.rr-epub-content style, .rr-epub-content script')).toHaveCount(0);
    // The fixture's `p { color: red }` must not leak through.
    const color = await page.locator('.rr-chapter p').first().evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe('rgb(26, 26, 26)');
  });

  // Known bug: EpubReader.resolveImages calls loadBlob(href) without a media
  // type, so SVG images get a typeless blob the browser refuses to draw.
  test.fail('SVG images inside the EPUB load', async ({ page }) => {
    await open(page, 'view=reader');
    const img = page.locator('.rr-chapter figure img');
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 3000 }).toBeGreaterThan(0);
  });

  test('no-image mode shows placeholders', async ({ page }) => {
    await open(page, 'view=reader&noImageMode=1');
    await expect(page.locator('.rr-chapter img')).toHaveCount(0);
    await expect(page.locator('.rr-img-placeholder')).toHaveText('🖼 A lantern');
  });

  test('shows an error when the file cannot be read', async ({ page }) => {
    await page.route('**/vault/Books/**', (r) => r.fulfill({ status: 404 }));
    await open(page, 'view=reader');
    await expect(page.locator('.rr-error')).toContainText('Failed to open .epub');
    await expect(page.locator('.rr-loading.is-visible')).toHaveCount(0);
    await expect(page).toHaveScreenshot('error.png');
  });
});

test.describe('EPUB reader: themes', () => {
  const cases = [
    { name: 'obsidian-light', q: 'theme=obsidian', bg: 'rgb(255, 255, 255)' },
    { name: 'obsidian-dark', q: 'theme=obsidian&obsidian=dark', bg: 'rgb(30, 30, 30)' },
    { name: 'light', q: 'theme=light&obsidian=dark', bg: 'rgb(255, 255, 255)' },
    { name: 'dark', q: 'theme=dark', bg: 'rgb(30, 30, 46)' },
    { name: 'sepia', q: 'theme=sepia', bg: 'rgb(244, 236, 216)' },
  ];
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await open(page, `view=reader&${c.q}`);
      await expect(page.locator('.rr-epub-content')).toHaveCSS('background-color', c.bg);
      await expect(page).toHaveScreenshot(`theme-${c.name}.png`);
    });
  }

  test('typography settings apply', async ({ page }) => {
    await open(page, 'view=reader&fontSize=24&lineHeight=2&fontFamily=Arial');
    const p = page.locator('.rr-chapter p').first();
    await expect(p).toHaveCSS('font-size', '24px');
    await expect(p).toHaveCSS('line-height', '48px');
    await expect(page.locator('.rr-epub-content')).toHaveCSS('font-family', 'Arial');
    await expect(page).toHaveScreenshot('typography-large.png');
  });
});

test.describe('EPUB reader: navigation and progress', () => {
  test('Next / Previous scroll by the configured screen fraction', async ({ page }) => {
    await open(page, 'view=reader&tapScrollDuration=0&tapScrollScreens=0.5');
    const height = await page.locator('.rr-epub-scroll').evaluate((el) => el.clientHeight);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(height * 0.4);
    const after = await scrollTop(page);
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect.poll(() => scrollTop(page)).toBeLessThan(after);
  });

  test('scrolling updates the chapter label, page indicator and slider', async ({ page }) => {
    await open(page, 'view=reader');
    const total = await page.locator('.rr-epub-scroll').evaluate((el) => el.scrollHeight);
    const ch3 = await page.locator('.rr-chapter[data-index="2"]').evaluate((el) => (el as HTMLElement).offsetTop);
    await scrollBookTo(page, ch3 + 50);
    await expect(page.locator('.rr-topbar-title')).toHaveText('Chapter 3: The Fog');
    await expect(page.locator('.rr-page-indicator')).not.toHaveText('0%');
    const fill = await page.locator('.rr-slider-fill').evaluate((el) => parseFloat((el as HTMLElement).style.width));
    expect(fill).toBeGreaterThan(50);
    expect(total).toBeGreaterThan(ch3);
  });

  test('clicking the slider seeks through the book', async ({ page }) => {
    await open(page, 'view=reader');
    const box = (await page.locator('.rr-slider').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.97, box.y + box.height / 2);
    await expect(page.locator('.rr-topbar-title')).toHaveText('Chapter 3: The Fog');
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(1000);
  });

  test('saves progress after scrolling stops', async ({ page }) => {
    await open(page, 'view=reader');
    await scrollBookTo(page, 1500);
    await expect.poll(() => progress(page), { timeout: 4000 }).toBeGreaterThan(0);
  });

  test('restores the saved position on open', async ({ page }) => {
    await open(page, 'view=reader&seed=1');
    await expect(page.locator('.rr-topbar-title')).toHaveText('Chapter 2: The Lantern');
    expect(await scrollTop(page)).toBeGreaterThan(500);
  });
});

test.describe('EPUB reader: panels', () => {
  test('table of contents lists chapters and jumps', async ({ page }) => {
    await open(page, 'view=reader');
    await page.getByRole('button', { name: 'Table of contents' }).click();
    const items = page.locator('.rr-toc-item');
    await expect(items).toHaveText(['Chapter 1: The Harbor', 'Chapter 2: The Lantern', 'Chapter 3: The Fog']);
    await expect(page).toHaveScreenshot('panel-toc.png');
    await page.locator('.rr-toc-search').fill('fog');
    await expect(items).toHaveText(['Chapter 3: The Fog']);
    await items.first().click();
    await expect(page.locator('.rr-topbar-title')).toHaveText('Chapter 3: The Fog');
  });

  test('search finds matches and jumps to one', async ({ page }) => {
    await open(page, 'view=reader');
    await page.getByRole('button', { name: 'Search in book' }).click();
    await page.locator('.rr-search-input').fill('secret');
    await page.locator('.rr-search-input').press('Enter');
    const results = page.locator('.rr-search-result');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText('secret');
    await expect(page).toHaveScreenshot('panel-search.png');
    await results.first().click();
    await expect(page.locator('.rr-epub-content .rr-search-hit').first()).toBeVisible();
  });

  test('search with no matches says so', async ({ page }) => {
    await open(page, 'view=reader');
    await page.getByRole('button', { name: 'Search in book' }).click();
    await page.locator('.rr-search-input').fill('zzzqqq');
    await page.locator('.rr-search-input').press('Enter');
    await expect(page.locator('.rr-search-result')).toHaveCount(0);
    await expect(page.locator('.rr-search-count')).toBeVisible();
  });

  test('quick settings change the theme and font size live', async ({ page }) => {
    await open(page, 'view=reader&seed=1');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await expect(page.locator('.rr-quick-settings')).toBeVisible();
    await expect(page.locator('.rr-bookmark-jump')).toHaveText(['The lantern']);
    await expect(page).toHaveScreenshot('panel-settings.png');

    await page.locator('.rr-qs-chip', { hasText: 'sepia' }).click();
    await expect(page.locator('.rr-epub-content')).toHaveCSS('background-color', 'rgb(244, 236, 216)');
    await page.locator('.rr-qs-row', { hasText: 'Font size' }).locator('.rr-qs-chip', { hasText: '+' }).click();
    await expect(page.locator('.rr-qs-value').first()).toHaveText('19px');
    await expect(page.locator('.rr-chapter p').first()).toHaveCSS('font-size', '19px');
    expect([await setting(page, 'theme'), await setting(page, 'fontSize')]).toEqual(['sepia', 19]);
  });

  test('panels close with their close button, Escape, or a click outside', async ({ page }) => {
    await open(page, 'view=reader');
    await page.getByRole('button', { name: 'Table of contents' }).click();
    await page.locator('.rr-toc-close').click();
    await expect(page.locator('.rr-toc-panel')).toHaveCount(0);

    await page.getByRole('button', { name: 'Search in book' }).click();
    await expect(page.locator('.rr-search-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.rr-search-panel')).toHaveCount(0);

    await page.getByRole('button', { name: 'Table of contents' }).click();
    await page.mouse.click(100, 300);
    await expect(page.locator('.rr-toc-panel')).toHaveCount(0);
  });

  test('adding a bookmark prompts for a name (prefilled with the chapter)', async ({ page }) => {
    await open(page, 'view=reader');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page.locator('.rr-qs-chip', { hasText: '+ Add' }).click();
    const input = page.locator('.dev-modal .rr-prompt-input');
    await expect(input).toHaveValue('Chapter 1: The Harbor');
    await expect(page.locator('.dev-modal')).toHaveScreenshot('bookmark-prompt.png');
    await input.fill('Start here');
    await input.press('Enter');
    await expect(page.locator('.dev-modal')).toHaveCount(0);
    expect((await annotations(page)).bookmarks).toMatchObject([{ name: 'Start here', chapterIndex: 0 }]);
    expect(await log(page)).toContain('[Notice] R Reader: bookmarked “Start here”');
  });

  test('cancelling the bookmark prompt adds nothing', async ({ page }) => {
    await open(page, 'view=reader');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page.locator('.rr-qs-chip', { hasText: '+ Add' }).click();
    await page.locator('.dev-modal button', { hasText: 'Cancel' }).click();
    expect((await annotations(page)).bookmarks).toHaveLength(0);
  });

  test('export writes the notes file', async ({ page }) => {
    await open(page, 'view=reader&seed=1');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page.locator('.rr-qs-chip', { hasText: 'Export to note' }).click();
    await expect.poll(() => log(page)).toContain('create R Reader Notes/The Harbor Lantern.md');
    expect(await log(page)).toContain('[Notice] R Reader: exported notes to R Reader Notes/The Harbor Lantern.md');
  });

  test('export with nothing to export says so', async ({ page }) => {
    await open(page, 'view=reader');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page.locator('.rr-qs-chip', { hasText: 'Export to note' }).click();
    await expect.poll(() => log(page)).toContain('[Notice] R Reader: no highlights or bookmarks to export yet');
  });

  test('bookmark jump and delete', async ({ page }) => {
    await open(page, 'view=reader&seed=1');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page.locator('.rr-bookmark-jump').click();
    await expect(page.locator('.rr-topbar-title')).toHaveText('Chapter 3: The Fog');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await page.getByRole('button', { name: 'Delete bookmark' }).click();
    await expect(page.locator('.rr-bookmark-row')).toHaveCount(0);
    expect((await annotations(page)).bookmarks).toHaveLength(0);
  });
});

test.describe('EPUB reader: highlights', () => {
  test('saved highlights are drawn in their color', async ({ page }) => {
    await open(page, 'view=reader&seed=1');
    const hl = page.locator('.rr-highlight[data-hl-id="h1"]');
    await expect(hl).toHaveText('Every harbor keeps a secret.');
    await expect(hl).toHaveClass(/rr-hl-green/);
    await hl.scrollIntoViewIfNeeded();
    await expect(hl).toHaveScreenshot('highlight-green.png');
  });

  test('selecting text offers the toolbar and creates a highlight', async ({ page }) => {
    await open(page, 'view=reader');
    const p = page.locator('.rr-chapter p').first();
    const box = (await p.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + 10, { steps: 8 });
    await page.mouse.up();
    const toolbar = page.locator('.rr-selection-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(page).toHaveScreenshot('selection-toolbar.png');
    await toolbar.locator('.rr-st-swatch.rr-hl-blue').click();

    await expect(page.locator('.rr-highlight.rr-hl-blue').first()).toBeVisible();
    const saved = (await annotations(page)).highlights;
    expect(saved).toHaveLength(1);
    expect(saved[0].color).toBe('blue');
    expect(saved[0].text.length).toBeGreaterThan(5);
  });

  test('clicking a highlight opens the editor; note, recolor and delete', async ({ page }) => {
    await open(page, 'view=reader&seed=1');
    const hl = page.locator('.rr-highlight[data-hl-id="h1"]');
    await hl.scrollIntoViewIfNeeded();
    await hl.click();
    const editor = page.locator('.rr-hl-editor');
    await expect(editor).toBeVisible();
    await expect(editor.locator('.rr-hl-note')).toHaveValue('theme of the book');
    await expect(editor).toHaveScreenshot('highlight-editor.png');

    await editor.locator('.rr-st-swatch.rr-hl-pink').click();
    await expect(hl).toHaveClass(/rr-hl-pink/);
    await editor.locator('.rr-hl-delete').click();
    await expect(page.locator('.rr-highlight[data-hl-id="h1"]')).toHaveCount(0);
    expect((await annotations(page)).highlights).toHaveLength(0);
  });
});

test('immersive mode hides the bars and restores them', async ({ page }) => {
  await open(page, 'view=reader');
  await setReader(page, { chromeHidden: true });
  await expect(page.locator('.rr-reader-root')).toHaveClass(/rr-chrome-hidden/);
  await expect(page).toHaveScreenshot('immersive.png');
  await setReader(page, { chromeHidden: false });
  await expect(page.locator('.rr-topbar')).toBeVisible();
});
