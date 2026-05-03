import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

const dropFixture = async (page: import('@playwright/test').Page) => {
  const text = readFileSync(SYNTHETIC, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });
};

test.describe('Logs folder browser', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('empty-state shows the "Choose logs folder…" button when supported', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'File System Access API only available in Chromium');
    await expect(page.getByRole('button', { name: 'Choose logs folder…' })).toBeVisible();
  });

  test('sidebar pane appears after a log is loaded', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'File System Access API only available in Chromium');
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    // The sidebar's "Logs folder" header must be visible.
    await expect(page.getByRole('button', { name: /Logs folder/ })).toBeVisible();
    // And the embedded "Choose folder…" button when no folder is configured.
    await expect(page.getByRole('button', { name: 'Choose folder…' })).toBeVisible();
  });
});
