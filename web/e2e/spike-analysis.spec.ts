import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The user's Peak-86sec sample log lives in the gitignored sample data
// folder at the repo root. The .gitignore is for "don't commit" — the
// folder itself is part of every dev box. If the file is missing
// (CI / fresh clone), skip rather than fail.
const PEAK_LOG = join(__dirname, '..', '..', 'sample data', 'Peak-86sec-PHD2_GuideLog_2026-05-03_203012.txt');

test.describe('Spike Analysis (kind=spike)', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!existsSync(PEAK_LOG),
      `Peak-86sec sample log missing at ${PEAK_LOG} — gitignored fixture, skip when absent.`);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  /** Common setup: drop the Peak-86sec file, pick the largest guiding
   *  session, open the Analysis modal via the menu, switch to Spikes. */
  const openSpikeMode = async (page: import('@playwright/test').Page) => {
    const text = readFileSync(PEAK_LOG, 'utf-8');
    await page.setInputFiles('input[type=file]', {
      name: 'Peak-86sec.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(text, 'utf-8'),
    });
    // The Peak-86sec file has 8 sessions; the largest is the 4906-frame
    // one starting 22:45:35. Picking by clicking its sidebar entry.
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Guide ·', { exact: false }).first()).toBeVisible();
    // Click the session whose sub-line shows 4906 frames — that's our
    // big test bed.
    const big = sidebar.locator('button').filter({ hasText: '4,906' }).first();
    if (await big.isVisible().catch(() => false)) {
      await big.click();
    } else {
      // Some locales might format the number without the comma; fall back
      // to the largest guide entry by index. The big session is index 5
      // in the file (0-based among sessions).
      await sidebar.getByText('Guide ·', { exact: false }).nth(5).click();
    }
    await expect(page.locator('.js-plotly-plot')).toBeVisible();
    // Open Analysis modal
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analysis' }).click();
    await expect(page.locator('.fixed.inset-0 .js-plotly-plot')).toHaveCount(2);
    // Switch to Spikes tab
    await page.getByRole('button', { name: 'Spikes' }).click();
    await expect(page.getByText('ANALYSIS: Spikes')).toBeVisible();
  };

  test('Spike mode opens, runs analysis, and surfaces spike events', async ({ page }) => {
    await openSpikeMode(page);
    // The bottom panel header for spike mode reads "Top 3 spike periods".
    await expect(page.getByText('Top 3 spike periods')).toBeVisible();
    // The run-stats line names the count of spike events; on the
    // Peak-86sec real session there should be many (the user's
    // `node spike-explore.mjs` showed ~125 events at k=3).
    const stats = page.locator('text=/\\d+ events · σ_robust/');
    await expect(stats).toBeVisible();
    const statsText = await stats.first().innerText();
    const m = statsText.match(/(\d+) events/);
    expect(m).not.toBeNull();
    if (m) {
      const count = Number(m[1]);
      expect(count).toBeGreaterThan(50);
    }
  });

  test('Spike top-3 includes a period in the 60-120s range', async ({ page }) => {
    await openSpikeMode(page);
    // The cluster of real-data periods (per the offline analysis) sits
    // in 60-120s. Assert at least one of the surfaced top-3 periods
    // falls in that window. The HF filter is now a low-pass on the
    // signal itself (not just the display), and at the default 8s
    // some content is already attenuated; turn it OFF (slider = 0) so
    // we test against the unfiltered series. The HF filter is the
    // second range input (first is the sigma slider).
    const hfFilter = page.locator('.fixed.inset-0 input[type=range]').nth(1);
    await hfFilter.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '0');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Read out the period values from the top-3 panel cards. Each card
    // contains "Period: <number>s".
    await expect(page.locator('text=/Period:\\s+\\d+/').first()).toBeVisible();
    const cards = await page.locator('text=/Period:\\s+\\d+/').allInnerTexts();
    const periods = cards.map((c) => {
      const m = c.match(/Period:\s+(\d+(?:\.\d+)?)/);
      return m ? Number(m[1]) : Number.NaN;
    }).filter((n) => Number.isFinite(n));
    expect(periods.length).toBeGreaterThan(0);
    const inRange = periods.some((p) => p >= 60 && p <= 120);
    expect(inRange).toBe(true);
  });

  test('Switching axis from RA to Dec re-runs analysis', async ({ page }) => {
    await openSpikeMode(page);
    // Capture the spike count for RA.
    const stats = page.locator('text=/\\d+ events · σ_robust/').first();
    await expect(stats).toBeVisible();
    const raText = await stats.innerText();
    // The "Dec" axis chip lives in the modal toolbar — scope to .fixed.inset-0
    // because there's also a "Dec" master chip in the underlying chart
    // toolbar that's still in the DOM beneath the modal.
    await page.locator('.fixed.inset-0').getByRole('button', { name: 'Dec', exact: true }).click();
    await expect(stats).not.toHaveText(raText, { timeout: 5000 });
  });

  test('HF-filter slider defaults to off (0)', async ({ page }) => {
    await openSpikeMode(page);
    // The HF filter slider drives a low-pass on the drift-corrected
    // series, so the default is off — users opt in to smoothing.
    // Slider is the second range input (first is the sigma slider).
    const hfFilter = page.locator('.fixed.inset-0 input[type=range]').nth(1);
    await expect(hfFilter).toHaveValue('0');
    // The readout reads "off" at slider=0.
    await expect(page.locator('.fixed.inset-0').getByText('off', { exact: true })).toBeVisible();
  });

  test('Hovering the periodogram highlights aligned events on the spike chart', async ({ page }) => {
    await openSpikeMode(page);
    // Behavior under test: hovering the periodogram should add an
    // overlay trace to the spike chart with the events aligned to
    // the hovered period. Trace count rises by 1 when hover is
    // active, drops back when it clears.
    const traceCounts = async () => {
      return page.evaluate(() => {
        const plots = document.querySelectorAll<HTMLElement>('.fixed.inset-0 .js-plotly-plot');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upper = plots[0] as any;
        return upper?._fullData?.length ?? 0;
      });
    };
    const before = await traceCounts();
    expect(before).toBeGreaterThan(0);
    // Synthesize a periodogram hover at a believable spike period.
    await page.evaluate(() => {
      const plots = document.querySelectorAll<HTMLElement>('.fixed.inset-0 .js-plotly-plot');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const periodogram = plots[1] as any;
      if (typeof periodogram.emit === 'function') {
        // 100s is in the spike-period cluster on the Peak-86sec file.
        periodogram.emit('plotly_hover', { points: [{ x: 100 }] });
      }
    });
    await page.waitForTimeout(200);
    const after = await traceCounts();
    // Highlight overlay should add a trace.
    expect(after).toBeGreaterThan(before);
  });

  test('Direction toggle (+) excludes negative-side spikes', async ({ page }) => {
    await openSpikeMode(page);
    const stats = page.locator('text=/\\d+ events · σ_robust/').first();
    await expect(stats).toBeVisible();
    const both = await stats.innerText();
    const bothCount = Number(both.match(/(\d+) events/)?.[1]);
    expect(bothCount).toBeGreaterThan(0);
    // The direction chips live in the modal toolbar. Click the "+" chip.
    await page.locator('.fixed.inset-0').getByRole('button', { name: '+', exact: true }).click();
    await expect(stats).not.toHaveText(both, { timeout: 5000 });
    const pos = await stats.innerText();
    const posCount = Number(pos.match(/(\d+) events/)?.[1]);
    // Positive-only is strictly a subset; count must drop.
    expect(posCount).toBeLessThan(bothCount);
    expect(posCount).toBeGreaterThan(0);
  });

  test('Sigma slider changes the spike count', async ({ page }) => {
    await openSpikeMode(page);
    const stats = page.locator('text=/\\d+ events · σ_robust/').first();
    await expect(stats).toBeVisible();
    const before = await stats.innerText();
    // React's controlled <input type=range> needs the value setter that
    // React's synthetic event system intercepts. Setting `el.value = ...`
    // directly bypasses the React-attached descriptor; using the
    // HTMLInputElement.value PROTOTYPE setter (which React monkey-patches)
    // and then dispatching is the standard recipe.
    // Two range inputs in spike mode: [0] sigma, [1] HF filter. Pick first.
    const slider = page.locator('.fixed.inset-0 input[type=range]').first();
    await slider.evaluate((el: HTMLInputElement) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, '5');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Strict k=5 should detect FEWER events than the default k=3.
    await expect(stats).not.toHaveText(before, { timeout: 5000 });
    const after = await stats.innerText();
    const beforeCount = Number(before.match(/(\d+) events/)?.[1]);
    const afterCount = Number(after.match(/(\d+) events/)?.[1]);
    expect(afterCount).toBeLessThan(beforeCount);
  });
});
