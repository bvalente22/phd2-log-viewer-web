import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

/**
 * Quick happy-path smoke test. Loads the synthetic fixture, picks a guiding
 * section, confirms the chart and stats render. The thorough coverage lives
 * in ui.spec.ts.
 */
test('drop-and-view smoke', async ({ page }) => {
  await page.goto('/');
  // Clear persisted view settings between runs so the test is deterministic.
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.getByText('Drop a PHD2 guide log here')).toBeVisible();

  const text = readFileSync(FIXTURE, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });

  // Section labels use "Guide · <date>" / "Cal · <date>". Scope to the
  // sidebar — after section selection, the SectionSummary strip in main
  // also shows "Guide · …", so an unscoped getByText would multi-match.
  const sidebar = page.locator('aside');
  await expect(sidebar.getByText('Guide ·', { exact: false }).first()).toBeVisible();
  await sidebar.getByText('Guide ·', { exact: false }).first().click();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();
  // The Total row in StatsGrid is labeled "Total" (the cell label "RMS"
  // matches the per-axis rows; the row label disambiguates).
  await expect(page.getByText('Total', { exact: true }).first()).toBeVisible();
});
