import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

const dropFixture = async (page: import('@playwright/test').Page) => {
  const text = readFileSync(FIXTURE, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });
};

/**
 * Annotation count baseline:
 *   - 2 cardinal labels (GuideNorth/GuideEast — added in commit 8ca3743,
 *     drawn whenever the corresponding RA/Dec trace is visible).
 *   - +4 INFO event annotations from the synthetic fixture when the
 *     Events toggle is on (2 SETTLING STATE CHANGE + 2 MountGuidingEnabled).
 */
const CARDINAL_COUNT = 2;
const INFO_COUNT = 4;

test.describe('Inline event labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await dropFixture(page);
    // Scope to the sidebar — once a section is selected the SectionSummary
    // strip in main also shows "Guide · …", which multi-matches.
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
  });

  test('default off — only cardinal labels render', async ({ page }) => {
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(CARDINAL_COUNT);
    await expect(page.locator('.js-plotly-plot .annotation-text', { hasText: 'GuideNorth' })).toBeVisible();
    await expect(page.locator('.js-plotly-plot .annotation-text', { hasText: 'GuideEast' })).toBeVisible();
  });

  test('toggling Events on adds INFO annotations and toggling off removes them', async ({ page }) => {
    const eventsChip = page.getByRole('button', { name: 'Events', exact: true });
    await expect(eventsChip).toBeVisible();

    await eventsChip.click();
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(CARDINAL_COUNT + INFO_COUNT);
    // At least one INFO annotation contains the synthetic fixture's known text.
    await expect(page.locator('.js-plotly-plot .annotation-text', { hasText: 'state=1' })).toBeVisible();

    await eventsChip.click();
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(CARDINAL_COUNT);
  });

  test('Events chip is disabled in scatter view', async ({ page }) => {
    const scatterChip = page.getByRole('button', { name: 'scatter', exact: true });
    await scatterChip.click();
    const eventsChip = page.getByRole('button', { name: 'Events', exact: true });
    await expect(eventsChip).toBeDisabled();
  });
});
