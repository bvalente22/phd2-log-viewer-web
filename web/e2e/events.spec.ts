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

test.describe('Inline event labels', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
  });

  test('default off — no inline event annotations rendered', async ({ page }) => {
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(0);
  });

  test('toggling Events on adds annotations and toggling off removes them', async ({ page }) => {
    const eventsChip = page.getByRole('button', { name: 'Events', exact: true });
    await expect(eventsChip).toBeVisible();

    await eventsChip.click();
    // Synthetic fixture has 4 INFO events. Each produces its own annotation
    // even when stacked into rows.
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(4);

    // At least one annotation contains the synthetic fixture's known text.
    await expect(page.locator('.js-plotly-plot .annotation-text', { hasText: 'state=1' })).toBeVisible();

    await eventsChip.click();
    await expect(page.locator('.js-plotly-plot .annotation-text')).toHaveCount(0);
  });

  test('Events chip is disabled in scatter view', async ({ page }) => {
    const scatterChip = page.getByRole('button', { name: 'scatter', exact: true });
    await scatterChip.click();
    const eventsChip = page.getByRole('button', { name: 'Events', exact: true });
    await expect(eventsChip).toBeDisabled();
  });
});
