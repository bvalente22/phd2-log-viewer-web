import { test, expect, type Page } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');
const SAMPLES_DIR = join(__dirname, '..', '..', 'sample data');

/**
 * Full UI coverage. Each `test.describe` block focuses one feature area and
 * uses a fresh browser context (Playwright's default). The synthetic log is
 * tiny and predictable, so most assertions live on it. A second describe
 * block parametrizes a few interactions over real PHD2 sample logs when
 * those files are present (they are not committed to git).
 */

const dropFixture = async (page: Page, fixturePath: string, name: string) => {
  const text = readFileSync(fixturePath, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });
};

const resetState = async (page: Page) => {
  // Clear persisted view settings + any in-memory state from a previous run.
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    return new Promise<void>((res, rej) => {
      // Wipe IndexedDB so recents from prior tests don't leak.
      const req = indexedDB.deleteDatabase('keyval-store');
      req.onsuccess = () => res();
      req.onerror = () => rej(req.error);
      req.onblocked = () => res();
    });
  });
  await page.reload();
};

test.describe('synthetic log — full UI coverage', () => {
  test.beforeEach(async ({ page }) => {
    await resetState(page);
  });

  test('initial drop zone shows version, picker, and dropzone', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'PHD2 Log Viewer' })).toBeVisible();
    await expect(page.getByText('Drop a PHD2 guide log here')).toBeVisible();
    // Version badge format is "vX.Y.Z · <hash>"
    await expect(page.locator('text=/v\\d+\\.\\d+\\.\\d+ ·/').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'or pick a file' })).toBeVisible();
  });

  test('loading a log populates section list with both cal and guide sections', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await expect(page.getByText('Cal ·', { exact: false })).toBeVisible();
    await expect(page.getByText('Guide ·', { exact: false })).toBeVisible();
    // Header should show the loaded filename and PHD2 version.
    await expect(page.getByText('synthetic.log')).toBeVisible();
    await expect(page.getByText('PHD2 v2.6.11')).toBeVisible();
  });

  test('clicking a guiding section renders chart, toolbar, and stats', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
    // Toolbar groups
    await expect(page.getByText('view:', { exact: false })).toBeVisible();
    await expect(page.getByText('show:', { exact: false })).toBeVisible();
    await expect(page.getByText('coord:', { exact: false })).toBeVisible();
    await expect(page.getByText('scale:', { exact: false })).toBeVisible();
    // Stats grid rows
    await expect(page.getByText('RMS Total')).toBeVisible();
    await expect(page.getByRole('button', { name: /^RMS\s/ }).first()).toBeVisible();
  });

  test('clicking a calibration section renders cal plot and cal stats', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Cal ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
    await expect(page.getByText('Calibration ·', { exact: false }).first()).toBeVisible();
    // Cal stats panel cells
    await expect(page.getByText('Orthogonality')).toBeVisible();
    await expect(page.getByText('Rate ratio')).toBeVisible();
    await expect(page.getByText('xRate')).toBeVisible();
    await expect(page.getByText('yRate')).toBeVisible();
  });

  test('toolbar trace toggles change visual state', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    const ra = page.getByRole('button', { name: 'RA', exact: true });
    await expect(ra).toHaveClass(/bg-sky-700/);
    await ra.click();
    await expect(ra).not.toHaveClass(/bg-sky-700/);
    await ra.click();
    await expect(ra).toHaveClass(/bg-sky-700/);
  });

  test('scale toggle switches between arc-sec and pixels', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    const arcsec = page.getByRole('button', { name: 'arc-sec' });
    const pixels = page.getByRole('button', { name: 'pixels' });
    await expect(arcsec).toHaveClass(/bg-sky-700/);
    await pixels.click();
    await expect(pixels).toHaveClass(/bg-sky-700/);
    await expect(arcsec).not.toHaveClass(/bg-sky-700/);
  });

  test('coord toggle switches RA/Dec ↔ dx/dy', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    const radec = page.getByRole('button', { name: 'RA/Dec' });
    const dxdy = page.getByRole('button', { name: 'dx/dy' });
    await expect(radec).toHaveClass(/bg-sky-700/);
    await dxdy.click();
    await expect(dxdy).toHaveClass(/bg-sky-700/);
    await expect(radec).not.toHaveClass(/bg-sky-700/);
  });

  test('view toggle switches time ↔ scatter and disables coord/show in scatter', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    const time = page.getByRole('button', { name: 'time', exact: true });
    const scatter = page.getByRole('button', { name: 'scatter', exact: true });
    await expect(time).toHaveClass(/bg-sky-700/);
    await scatter.click();
    await expect(scatter).toHaveClass(/bg-sky-700/);
    // In scatter view, the trace toggles are disabled.
    await expect(page.getByRole('button', { name: 'RA pulses' })).toBeDisabled();
  });

  test('auto-Y toggle is on by default and can be turned off', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    const autoY = page.getByRole('button', { name: 'auto Y' });
    await expect(autoY).toHaveClass(/bg-sky-700/);
    await autoY.click();
    await expect(autoY).not.toHaveClass(/bg-sky-700/);
  });

  test('right-click context menu surfaces include / exclude items', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Include all frames' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Exclude all frames' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Exclude dithers / settling' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reset section' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reset zoom' })).toBeVisible();
  });

  test('exclude-all then reset cycles the excluded count', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();

    // Excluded count starts at 0/N.
    await expect(page.locator('text=/0\\s*\\/\\s*\\d+\\s+excluded/')).toBeVisible();

    // Right-click → Exclude all
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Exclude all frames' }).click();
    // After excluding all, the count text should be N/N.
    await expect(page.locator('text=/(\\d+)\\s*\\/\\s*\\1\\s+excluded/')).toBeVisible();

    // Reset section → back to 0.
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reset section' }).click();
    await expect(page.locator('text=/0\\s*\\/\\s*\\d+\\s+excluded/')).toBeVisible();
  });

  test('recents dropdown shows the just-loaded log and reopens it', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    // Open dropdown.
    await page.getByRole('button', { name: /Recent logs/ }).click();
    // The current log appears with "(current)" suffix.
    await expect(page.getByText('(current)')).toBeVisible();
    await expect(page.getByText('synthetic.log').first()).toBeVisible();
  });

  test('"Open another" returns to the drop zone', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.getByRole('button', { name: 'Open another' }).click();
    await expect(page.getByText('Drop a PHD2 guide log here')).toBeVisible();
  });

  test('view-settings persistence: pixel mode survives reload', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.getByRole('button', { name: 'pixels' }).click();
    await page.reload();
    // After reload there's no log loaded, but the persisted scale chip lives
    // in the toolbar only when a guiding section is selected. Re-load the
    // synthetic and pick a section, then verify the chip is still active.
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.getByText('Guide ·', { exact: false }).first().click();
    await expect(page.getByRole('button', { name: 'pixels' })).toHaveClass(/bg-sky-700/);
  });
});

/**
 * Real-PHD2-log coverage. These tests skip cleanly when the optional
 * `sample data/` directory at the repo root is absent (it isn't committed).
 * On the dev box where it does exist, they pick the smallest sample to keep
 * runtime down.
 */
const realSamples = existsSync(SAMPLES_DIR)
  ? readdirSync(SAMPLES_DIR)
      .filter((f) => f.endsWith('.txt') || f.endsWith('.log'))
      .map((f) => ({ name: f, path: join(SAMPLES_DIR, f), size: statSync(join(SAMPLES_DIR, f)).size }))
      .sort((a, b) => a.size - b.size)
  : [];

test.describe('real PHD2 sample logs', () => {
  const smallest = realSamples[0];

  test.beforeEach(async ({ page }) => {
    test.skip(realSamples.length === 0, 'No `sample data/` directory present at repo root — skipping real-log tests');
    await resetState(page);
  });

  test('loads smallest sample and shows sections + chart + stats', async ({ page }) => {
    if (!smallest) return;
    await dropFixture(page, smallest.path, smallest.name);
    await expect(page.getByText('Guide ·', { exact: false }).first()).toBeVisible();
    await page.getByText('Guide ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
    await expect(page.getByText('RMS Total')).toBeVisible();
  });

  test('calibration section in real sample renders cal stats', async ({ page }) => {
    if (!smallest) return;
    await dropFixture(page, smallest.path, smallest.name);
    const calLink = page.getByText('Cal ·', { exact: false }).first();
    if (await calLink.count() > 0) {
      await calLink.click();
      await expect(page.getByText('Orthogonality')).toBeVisible();
      // xRate should resolve to either px/s (when the header had Calibration
      // Step) or px/step (fallback). Both are accepted.
      await expect(page.locator('text=/px\\/(s|step)/').first()).toBeVisible();
    } else {
      test.skip(true, 'Sample has no calibration section');
    }
  });

  test('auto-Y keeps the typical guiding visible on real sample', async ({ page }) => {
    if (!smallest) return;
    await dropFixture(page, smallest.path, smallest.name);
    await page.getByText('Guide ·', { exact: false }).first().click();
    // After load, auto Y should be active (default true).
    await expect(page.getByRole('button', { name: 'auto Y' })).toHaveClass(/bg-sky-700/);
    // Toggle off then on — should not throw.
    await page.getByRole('button', { name: 'auto Y' }).click();
    await page.getByRole('button', { name: 'auto Y' }).click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
  });
});
