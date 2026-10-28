import { expect, test, type Page } from '@playwright/test';
import { open, pageErrors, setting } from './harness';

test.afterEach(({ page }) => expect(pageErrors(page)).toEqual([]));

const vn = (page: Page) => page.locator('.rr-vn');
/** Tap the stage's "next" zone (bottom-right; top-left goes back, the centre toggles the bars). */
async function tapNext(page: Page): Promise<void> {
  const box = (await vn(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.8);
}
/** Advance the visual-novel view until a line with `text` shows. */
async function advanceTo(page: Page, text: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    if (((await page.locator('.rr-vn-text').textContent()) ?? '').includes(text)) return;
    await tapNext(page);
  }
  await expect(page.locator('.rr-vn-text')).toContainText(text);
}

test.describe('.ark story: script view', () => {
  test('renders title, music, scene, dialogue with portraits and choices', async ({ page }) => {
    await open(page, 'view=story');
    await expect(page.locator('.rr-topbar-title')).toHaveText('Prologue');
    await expect(page.locator('.rr-ark-title').first()).toHaveText('Prologue');
    await expect(page.locator('.rr-ark-tag').first()).toHaveText('Before Dawn');
    await expect(page.locator('.rr-ark-music').first()).toContainText('$theme');
    await expect(page.locator('.rr-ark-scene img').first()).toBeVisible();
    await expect(page.locator('.rr-ark-nick').first()).toHaveText('Doctor');
    await expect(page.getByRole('button', { name: 'Switch to visual-novel view' })).toBeVisible();
    await expect(page).toHaveScreenshot('script-top.png');
  });

  test('two-sprite lines dim the unfocused portrait', async ({ page }) => {
    await open(page, 'view=story');
    const line = page.locator('.rr-ark-line.has-portrait').first();
    await line.scrollIntoViewIfNeeded();
    await expect(line.locator('.rr-ark-portrait')).toHaveCount(2);
    await expect(line.locator('.rr-ark-portrait').nth(1)).toHaveClass(/is-dim/);
    await expect(line).toHaveScreenshot('dialogue-portraits.png');
  });

  test('picking an option shows only its branch', async ({ page }) => {
    await open(page, 'view=story');
    const choice = page.locator('.rr-ark-choice').first();
    await choice.scrollIntoViewIfNeeded();
    const first = page.locator('.rr-ark-branch', { hasText: 'Somewhere safe' });
    const second = page.locator('.rr-ark-branch', { hasText: 'Take your time' });
    await expect(first).toBeVisible();
    await expect(second).toBeHidden();
    await choice.locator('.rr-ark-option').nth(1).click();
    await expect(choice.locator('.rr-ark-option').nth(1)).toHaveClass(/is-selected/);
    await expect(first).toBeHidden();
    await expect(second).toBeVisible();
    await expect(choice).toHaveScreenshot('choice-second.png');
  });

  test('tapping a scene image opens it full size; Escape closes it', async ({ page }) => {
    await open(page, 'view=story');
    await page.locator('.rr-ark-scene img').first().click();
    await expect(page.locator('.rr-ark-lightbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.rr-ark-lightbox')).toHaveCount(0);
  });

  test('music button toggles the mute setting', async ({ page }) => {
    await open(page, 'view=story');
    await page.getByRole('button', { name: 'Turn music off' }).click();
    await expect(page.getByRole('button', { name: 'Turn music on' })).toBeVisible();
    expect(await setting(page, 'storyMusicMuted')).toBe(true);
  });

  test('nickname setting fills {@nickname}', async ({ page }) => {
    await open(page, 'view=story&storyNickname=Captain');
    await expect(page.locator('.rr-ark-nick').first()).toHaveText('Captain');
  });

  test('table of contents lists the chapters and jumps', async ({ page }) => {
    await open(page, 'view=story');
    await page.getByRole('button', { name: 'Table of contents' }).click();
    await expect(page.locator('.rr-toc-item')).toHaveText(['Prologue', 'Chapter One']);
    await page.locator('.rr-toc-item', { hasText: 'Chapter One' }).click();
    await expect(page.locator('.rr-ark-title', { hasText: 'Chapter One' })).toBeInViewport();
  });

  // Known bug: a last chapter shorter than the screen never reaches the top of
  // the viewport, so the label keeps showing the previous chapter at 100%.
  test.fail('jumping to a short last chapter updates the top-bar label', async ({ page }) => {
    await open(page, 'view=story');
    await page.getByRole('button', { name: 'Table of contents' }).click();
    await page.locator('.rr-toc-item', { hasText: 'Chapter One' }).click();
    await expect(page.locator('.rr-topbar-title')).toHaveText('Chapter One', { timeout: 2000 });
  });

  test('stories are not highlightable', async ({ page }) => {
    await open(page, 'view=story');
    await page.locator('.rr-ark-narration').first().dblclick();
    await expect(page.locator('.rr-selection-toolbar')).toHaveCount(0);
  });
});

test.describe('.ark story: visual-novel view', () => {
  test('opens from the top bar and shows the stage', async ({ page }) => {
    await open(page, 'view=story');
    await page.getByRole('button', { name: 'Switch to visual-novel view' }).click();
    await expect(vn(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to script view' })).toBeVisible();
    await expect(page.locator('.rr-vn-bg').first()).toBeVisible();
  });

  test('walks through narration, two-sprite dialogue and a choice', async ({ page }) => {
    await open(page, 'view=story&storyDefaultView=vn');
    await advanceTo(page, 'The rain had not stopped');
    await expect(page).toHaveScreenshot('vn-narration.png');

    await advanceTo(page, 'You are finally awake, Doctor.');
    await expect(page.locator('.rr-vn-speaker')).toHaveText('Medic');
    await expect(page.locator('.rr-vn-char')).toHaveCount(2);
    await expect(page).toHaveScreenshot('vn-dialogue.png');

    await advanceTo(page, 'move');
    await tapNext(page);
    const options = page.locator('.rr-vn-option');
    await expect(options).toHaveCount(2);
    await expect(page).toHaveScreenshot('vn-choice.png');
    // "Next" does not skip a choice.
    await vn(page).press('Space');
    await expect(options).toHaveCount(2);

    await options.nth(1).click();
    await expect(page.locator('.rr-vn-text')).toContainText('Take your time.');
    // The pick is mirrored in the script view.
    await expect(page.locator('.rr-ark-option').nth(1)).toHaveClass(/is-selected/);
  });

  test('Back returns to the previous line; Log lists what was read', async ({ page }) => {
    await open(page, 'view=story&storyDefaultView=vn');
    await advanceTo(page, 'You are finally awake');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('.rr-vn-text')).toContainText('The rain had not stopped');
    await page.getByRole('button', { name: 'Log' }).click();
    await expect(page.locator('.rr-vn-log')).toBeVisible();
    await expect(page.locator('.rr-vn-log-item').first()).toContainText('The rain had not stopped');
    await expect(page.locator('.rr-vn-log')).toHaveScreenshot('vn-log.png');
  });

  test('keyboard: Space / Enter advance', async ({ page }) => {
    await open(page, 'view=story&storyDefaultView=vn');
    await advanceTo(page, 'The rain had not stopped');
    await vn(page).press('Space');
    await expect(page.locator('.rr-vn-text')).toContainText('You are finally awake');
  });

  test('back to script view keeps the place', async ({ page }) => {
    await open(page, 'view=story&storyDefaultView=vn');
    await advanceTo(page, 'Can you stand');
    await page.getByRole('button', { name: 'Switch to script view' }).click();
    await expect(vn(page)).toHaveCount(0);
    await expect(page.locator('.rr-ark-line', { hasText: 'Can you stand' })).toBeInViewport();
  });
});
