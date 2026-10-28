import { expect, test } from '@playwright/test';
import { open, pageErrors, scrollTop } from './harness';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

/** Tap the book at a fraction of its height (MobileControls splits it in thirds). */
async function tapBook(page: import('@playwright/test').Page, yFrac: number): Promise<void> {
  const box = (await page.locator('.rr-content').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * yFrac);
}

test.describe('phone', () => {
  test('reader uses the side rail instead of the bottom bar', async ({ page }) => {
    await open(page, 'view=reader&mobile=1');
    await expect(page.locator('.rr-reader-root')).toHaveClass(/rr-mobile/);
    await expect(page.locator('.rr-rail')).toBeVisible();
    await expect(page.locator('.rr-bottombar')).toBeHidden();
    await expect(page).toHaveScreenshot('reader.png');
  });

  test('bottom bar when the progress setting says so', async ({ page }) => {
    await open(page, 'view=reader&mobile=1&progressBarPosition=bottom');
    await expect(page.locator('.rr-bottombar')).toBeVisible();
    await expect(page).toHaveScreenshot('reader-bottom-bar.png');
  });

  test('tap zones: bottom third pages forward, top third back, middle toggles the bars', async ({ page }) => {
    await open(page, 'view=reader&mobile=1&tapScrollDuration=0');
    await tapBook(page, 0.85);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(100);
    const after = await scrollTop(page);
    await tapBook(page, 0.15);
    await expect.poll(() => scrollTop(page)).toBeLessThan(after);

    await tapBook(page, 0.5);
    await expect(page.locator('.rr-reader-root')).toHaveClass(/rr-chrome-hidden/);
    await expect(page).toHaveScreenshot('reader-immersive.png');
    await tapBook(page, 0.5);
    await expect(page.locator('.rr-reader-root')).not.toHaveClass(/rr-chrome-hidden/);
  });

  test('"hide bars on mobile" starts immersive', async ({ page }) => {
    await open(page, 'view=reader&mobile=1&hideBarsOnMobile=1');
    await expect(page.locator('.rr-reader-root')).toHaveClass(/rr-chrome-hidden/);
  });

  test('table of contents is a full-screen overlay', async ({ page }) => {
    await open(page, 'view=reader&mobile=1');
    await page.getByRole('button', { name: 'Table of contents' }).click();
    await expect(page.locator('.rr-toc-overlay')).toBeVisible();
    await expect(page).toHaveScreenshot('toc-overlay.png');
  });

  test('quick settings offer the progress-bar position', async ({ page }) => {
    await open(page, 'view=reader&mobile=1');
    await page.getByRole('button', { name: 'Reader settings' }).click();
    await expect(page.locator('.rr-qs-row', { hasText: 'Progress' })).toBeVisible();
    await expect(page).toHaveScreenshot('quick-settings.png');
  });

  test('visual-novel view fits the phone', async ({ page }) => {
    await open(page, 'view=story&mobile=1&storyDefaultView=vn');
    await expect(page.locator('.rr-vn')).toBeVisible();
    const overflow = await page.locator('.rr-vn').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot('vn.png');
  });

  test('library on a phone', async ({ page }) => {
    await open(page, 'view=library&seed=1&mobile=1');
    const overflow = await page.locator('.rr-library-body').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page).toHaveScreenshot('library.png');
  });
});
