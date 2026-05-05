import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');
const SAMPLES_DIR = join(__dirname, '..', '..', 'sample data');

const setFile = async (
  page: import('@playwright/test').Page,
  selector: string,
  filename: string,
  text: string,
) =>
  page.setInputFiles(selector, {
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });

test.describe('Sidebar open-log pane', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('phd2-log-recents');
    });
    await page.reload();
  });

  test('replaces sidebar pane after first log; drop-zone elements visible', async ({ page }) => {
    // Land on home page, load a log via the home-page drop zone.
    const text = readFileSync(SYNTHETIC, 'utf-8');
    await setFile(page, 'input[type=file]', 'synthetic.log', text);

    // Sidebar pane header is "Open log" (replaces the old "Logs folder").
    await expect(page.getByRole('button', { name: /Open log/ })).toBeVisible();

    // Old folder UI is gone.
    await expect(page.getByRole('button', { name: 'Choose folder…' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reconnect' })).toHaveCount(0);

    // The sidebar drop zone shows "Drop a PHD2 guide log here" and the
    // pick-file button.
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Drop a PHD2 guide log here')).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'or pick a file' })).toBeVisible();
  });

  test('picking a file from the sidebar swaps in the new log', async ({ page }) => {
    // Load the synthetic fixture first via the home-page drop zone.
    const synthetic = readFileSync(SYNTHETIC, 'utf-8');
    await setFile(page, 'input[type=file]', 'synthetic.log', synthetic);

    // Header shows the current log name.
    await expect(page.locator('header').getByText('synthetic.log')).toBeVisible();

    // Now pick a real fixture from the sidebar's file input.
    const realName = 'PHD2_GuideLog_2026-01-17_184049.txt';
    const realText = readFileSync(join(SAMPLES_DIR, realName), 'utf-8');

    // The sidebar's file input is the second one on the page (the home-page
    // drop zone is gone once a log is loaded — only the sidebar input remains).
    await setFile(page, 'aside input[type=file]', realName, realText);

    // Header now reflects the swapped log.
    await expect(page.locator('header').getByText(realName)).toBeVisible();

    // And the section list re-rendered (synthetic Guide section was 2024;
    // real fixture starts in 2026).
    await expect(page.getByText('Guide ·', { exact: false }).first()).toBeVisible();
  });

  test('collapse/expand toggles the drop-zone visibility', async ({ page }) => {
    const text = readFileSync(SYNTHETIC, 'utf-8');
    await setFile(page, 'input[type=file]', 'synthetic.log', text);

    const sidebar = page.locator('aside');
    const header = page.getByRole('button', { name: /Open log/ });
    await expect(sidebar.getByText('Drop a PHD2 guide log here')).toBeVisible();
    await header.click();
    await expect(sidebar.getByText('Drop a PHD2 guide log here')).toHaveCount(0);
    await header.click();
    await expect(sidebar.getByText('Drop a PHD2 guide log here')).toBeVisible();
  });
});
