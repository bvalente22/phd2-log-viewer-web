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
    // Section labels appear in BOTH the sidebar and (after selection) the
    // SectionSummary strip in main — scope to the sidebar to avoid the
    // multi-match. Filename appears in both header and SectionSummary
    // too; scope to header for the assertion.
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Cal ·', { exact: false })).toBeVisible();
    await expect(sidebar.getByText('Guide ·', { exact: false })).toBeVisible();
    await expect(page.locator('header').getByText('synthetic.log')).toBeVisible();
    await expect(page.getByText('PHD2 v2.6.11')).toBeVisible();
  });

  test('clicking a guiding section renders chart, toolbar, and stats', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
    // Toolbar groups (PR #13 removed the "show:" prefix when trace
    // toggles got grouped under axis master chips).
    await expect(page.getByText('view:', { exact: false })).toBeVisible();
    await expect(page.getByText('coord:', { exact: false })).toBeVisible();
    await expect(page.getByText('scale:', { exact: false })).toBeVisible();
    // Stats grid: PR #11 shortened the Total-row cell label from "RMS
    // Total" to plain "RMS"; the row label "Total" disambiguates.
    await expect(page.getByText('Total', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^RMS\s/ }).first()).toBeVisible();
  });

  test('clicking a calibration section renders cal plot and cal stats', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Cal ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
    await expect(page.getByText('Calibration ·', { exact: false }).first()).toBeVisible();
    // Cal stats panel cells. Use getByRole('button') because the same
    // text ("xRate", "yRate") also appears verbatim in the SectionHeader's
    // collapsed-peek line and the full-header <pre> block, so a bare
    // getByText hits 3 elements.
    await expect(page.getByRole('button', { name: /^Orthogonality/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Rate ratio/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^xRate/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^yRate/ })).toBeVisible();
  });

  test('toolbar trace toggles change visual state', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    // PR #13 made the "RA" chip the AXIS MASTER (tone='ra' → bg-sky-600);
    // the sub-trace error chip is now labeled "trace". Master toggles
    // hide/restore the entire RA group via snapshot/restore semantics.
    const ra = page.getByRole('button', { name: 'RA', exact: true });
    await expect(ra).toHaveClass(/bg-sky-600/);
    await ra.click();
    await expect(ra).not.toHaveClass(/bg-sky-600/);
    await ra.click();
    await expect(ra).toHaveClass(/bg-sky-600/);
  });

  test('scale toggle switches between arc-sec and pixels', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    const arcsec = page.getByRole('button', { name: 'arc-sec' });
    const pixels = page.getByRole('button', { name: 'pixels' });
    await expect(arcsec).toHaveClass(/bg-sky-700/);
    await pixels.click();
    await expect(pixels).toHaveClass(/bg-sky-700/);
    await expect(arcsec).not.toHaveClass(/bg-sky-700/);
  });

  test('coord toggle switches RA/Dec ↔ dx/dy', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    const radec = page.getByRole('button', { name: 'RA/Dec' });
    const dxdy = page.getByRole('button', { name: 'dx/dy' });
    await expect(radec).toHaveClass(/bg-sky-700/);
    await dxdy.click();
    await expect(dxdy).toHaveClass(/bg-sky-700/);
    await expect(radec).not.toHaveClass(/bg-sky-700/);
  });

  test('view toggle switches time ↔ scatter and disables coord/show in scatter', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    const time = page.getByRole('button', { name: 'time', exact: true });
    const scatter = page.getByRole('button', { name: 'scatter', exact: true });
    await expect(time).toHaveClass(/bg-sky-700/);
    await scatter.click();
    await expect(scatter).toHaveClass(/bg-sky-700/);
    // In scatter view, the per-axis sub-trace toggles are disabled. PR
    // #13 renamed "RA pulses" → "pulses" (axis prefix dropped because
    // the axis master button now prefixes the group). The chart has
    // RA and Dec "pulses" buttons; pick the first.
    await expect(page.getByRole('button', { name: 'pulses', exact: true }).first()).toBeDisabled();
  });

  test('auto-Y toggle is on by default and can be turned off', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    const autoY = page.getByRole('button', { name: 'auto Y' });
    await expect(autoY).toHaveClass(/bg-sky-700/);
    await autoY.click();
    await expect(autoY).not.toHaveClass(/bg-sky-700/);
  });

  test('right-click context menu surfaces include / exclude items', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Include all frames' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Exclude all frames' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Exclude dithers / settling' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reset section' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Reset zoom' })).toBeVisible();
  });

  test('exclude-all then reset cycles the excluded count', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();

    // PR #41abf0c removed the toolbar "0 / N excluded" counter (redundant
    // with the StatsGrid "Excluded" cell). Read the StatsGrid value
    // instead. The two-span layout concatenates into accessible name
    // without whitespace ("Excluded21"); the title attribute carries
    // the human-readable form ("Excluded: 21 — click to copy") and is
    // more robust to assert against.
    //
    // Note: initial state isn't 0 — GuideGraph auto-excludes settling
    // windows on first view of a section, so the synthetic fixture
    // starts with 1 excluded. The cycle this test exercises is
    // exclude-all → reset, both observable as a non-empty change.
    const excludedButton = () => page.getByRole('button', { name: /^Excluded/ }).filter({
      hasText: /^Excluded\d+$/,
    });

    // Right-click → Exclude all
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Exclude all frames' }).click();
    // synthetic fixture has 21 frames → all should now be excluded.
    await expect(excludedButton()).toHaveAttribute('title', /Excluded:\s*21/);

    // Reset section → mask cleared (includeAll). Back to 0.
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reset section' }).click();
    await expect(excludedButton()).toHaveAttribute('title', /Excluded:\s*0/);
  });

  test('recents dropdown shows previously-loaded logs and marks the active one', async ({ page }) => {
    // RecentsDropdown reads the IndexedDB list once on mount, so the
    // entry the dropFixture writes won't appear until we reload (or
    // until the component otherwise re-fetches). After reload the log
    // is no longer loaded — clicking the entry reopens it, after which
    // it's the "current" one in the dropdown.
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    // Wait for parse + putRecent to land BEFORE reloading. setInputFiles
    // resolves before logStore.loadFromText finishes its async chain
    // (parseLogAsync → putRecent → set), so a too-eager reload can race
    // the IDB write and leave Recents empty.
    await expect(page.locator('aside').getByText('Guide ·', { exact: false })).toBeVisible();
    await page.reload();
    // Wait for RecentsDropdown's async listRecents() to land on count=1
    // before clicking. Without this the toggle reads "Recent logs (0)"
    // for a few hundred ms after reload, even though IDB has the entry.
    await expect(page.getByRole('button', { name: 'Recent logs (1)' })).toBeVisible({ timeout: 10000 });
    const recentsToggle = page.getByRole('button', { name: 'Recent logs (1)' });
    await recentsToggle.click();
    const entry = page.getByRole('button', { name: /^synthetic\.log/ }).first();
    await expect(entry).toBeVisible();
    await entry.click();
    // Reopen marks the entry "(current)" — open the dropdown again to verify.
    await recentsToggle.click();
    await expect(page.getByText('(current)')).toBeVisible();
  });

  // The "Open another" button was removed in the theme-system PR; the
  // open-log pane is now always reachable via the LogsFolderPane in the
  // sidebar, so the dedicated button is gone. Test deleted accordingly.

  test('per-section view memory: zoomed range is preserved when returning to a section', async ({ page }) => {
    // After scroll-zooming the guide section, switching to the calibration
    // section and back should restore the *zoomed* view — not reset to the
    // section's full-data default.
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();

    const readXRange = () => page.evaluate(() => {
      const div = document.querySelector('.js-plotly-plot') as HTMLElement & {
        _fullLayout?: { xaxis?: { range: [number, number] } };
      } | null;
      const r = div?._fullLayout?.xaxis?.range;
      return r ? [Number(r[0]), Number(r[1])] : null;
    });

    const initial = await readXRange();
    expect(initial).not.toBeNull();

    // Scroll-zoom several times in the middle of the chart — Plotly's
    // built-in scrollZoom shrinks the visible range around the cursor.
    const plot = page.locator('.js-plotly-plot');
    const box = await plot.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(120);

    const zoomed = await readXRange();
    expect(zoomed).not.toBeNull();
    const initialSpan = (initial as number[])[1] - (initial as number[])[0];
    const zoomedSpan = (zoomed as number[])[1] - (zoomed as number[])[0];
    // Sanity: scrollZoom actually shrunk the range.
    expect(zoomedSpan).toBeLessThan(initialSpan * 0.95);

    // Bounce to calibration and back.
    await page.locator('aside').getByText('Cal ·', { exact: false }).first().click();
    await page.waitForTimeout(120);
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    await page.waitForTimeout(150);

    const restored = await readXRange();
    expect(restored).not.toBeNull();
    const restoredSpan = (restored as number[])[1] - (restored as number[])[0];
    // The restored span should match the zoomed span much more closely than
    // the original full-extent span — that's the per-section memory at work.
    expect(Math.abs(restoredSpan - zoomedSpan)).toBeLessThan(initialSpan * 0.1);
  });

  test('CSV export downloads a file with the section data', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    const downloadPromise = page.waitForEvent('download');
    // Button label is "Export CSV" (verbatim from i18n toolbar.export.csv).
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('PNG export button is enabled when a guiding section is loaded', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    // Button label is "Export PNG" — same i18n pattern as CSV.
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  });

  test('view-settings persistence: pixel mode survives reload', async ({ page }) => {
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    await page.getByRole('button', { name: 'pixels' }).click();
    await page.reload();
    // After reload there's no log loaded, but the persisted scale chip lives
    // in the toolbar only when a guiding section is selected. Re-load the
    // synthetic and pick a section, then verify the chip is still active.
    await dropFixture(page, SYNTHETIC, 'synthetic.log');
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
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
    await expect(page.locator('aside').getByText('Guide ·', { exact: false }).first()).toBeVisible();
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
    // PR #11: Total-row cell renamed "RMS Total" → "RMS"; assert via row label.
    await expect(page.getByText('Total', { exact: true }).first()).toBeVisible();
  });

  test('calibration section in real sample renders cal stats', async ({ page }) => {
    if (!smallest) return;
    await dropFixture(page, smallest.path, smallest.name);
    const calLink = page.locator('aside').getByText('Cal ·', { exact: false }).first();
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
    await page.locator('aside').getByText('Guide ·', { exact: false }).first().click();
    // After load, auto Y should be active (default true).
    await expect(page.getByRole('button', { name: 'auto Y' })).toHaveClass(/bg-sky-700/);
    // Toggle off then on — should not throw.
    await page.getByRole('button', { name: 'auto Y' }).click();
    await page.getByRole('button', { name: 'auto Y' }).click();
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
  });
});
