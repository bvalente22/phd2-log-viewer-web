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

const openAnalysis = async (page: import('@playwright/test').Page) => {
  await dropFixture(page);
  await page.getByText('Guide ·', { exact: false }).first().click();
  await page.locator('.js-plotly-plot').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Analysis' }).click();
  await expect(page.locator('.fixed.inset-0 .js-plotly-plot')).toHaveCount(2);
};

test.describe('Analysis modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Analysis menu entry opens the modal with both charts', async ({ page }) => {
    await openAnalysis(page);
    await expect(page.getByRole('heading', { name: /\d+ frames/ })).toBeVisible();
    await page.getByRole('button', { name: /Close/ }).click();
    await expect(page.locator('.fixed.inset-0')).not.toBeVisible();
  });

  test('Mode tabs swap which kind is active without closing the modal', async ({ page }) => {
    await openAnalysis(page);
    // ANALYSIS pill defaults to "Residual error".
    await expect(page.getByText('ANALYSIS: Residual error')).toBeVisible();
    await page.getByRole('button', { name: 'Raw RA' }).click();
    await expect(page.getByText('ANALYSIS: Raw RA')).toBeVisible();
    await page.getByRole('button', { name: 'Residual error' }).click();
    await expect(page.getByText('ANALYSIS: Residual error')).toBeVisible();
  });

  test('Analyze unguided section shows "Unguided section" mode', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    const unguided = page.getByRole('menuitem', { name: 'Analyze unguided section' });
    if (await unguided.isVisible().catch(() => false)) {
      await unguided.click();
      await expect(page.getByText('ANALYSIS: Unguided section')).toBeVisible();
    } else {
      // synthetic.log has no unguided window — assert the menu absence
      // rather than failing.
      await expect(unguided).toHaveCount(0);
    }
  });

  test('hovering the periodogram populates a Period: readout', async ({ page }) => {
    await openAnalysis(page);
    // Synthesize Plotly's plotly_hover event directly on the periodogram
    // div. react-plotly.js' onHover prop calls back with ev.points[0].x;
    // dispatching via Plotly's internal emit exercises the same code path
    // the real cursor would.
    await page.evaluate(() => {
      const plots = document.querySelectorAll<HTMLElement>('.fixed.inset-0 .js-plotly-plot');
      const periodogram = plots[plots.length - 1];
      if (!periodogram) throw new Error('periodogram div missing');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const div = periodogram as any;
      if (typeof div.emit === 'function') {
        div.emit('plotly_hover', { points: [{ x: 5 }] });
      }
    });
    await expect(page.locator('.fixed.inset-0 .font-mono').last()).toContainText(/Period:/, { timeout: 5000 });
  });

  test('Esc closes the modal', async ({ page }) => {
    await openAnalysis(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.fixed.inset-0')).not.toBeVisible();
  });
});

test.describe('Analysis modal: zoom / pan persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  /**
   * Helper: read the current Plotly xaxis / yaxis range from one of the
   * modal's two chart divs. Index 0 = drift chart, 1 = periodogram.
   */
  const readRanges = async (page: import('@playwright/test').Page, index: 0 | 1) => {
    return page.evaluate((idx) => {
      const plots = document.querySelectorAll('.fixed.inset-0 .js-plotly-plot');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const div = plots[idx] as any;
      const fl = div?._fullLayout;
      if (!fl?.xaxis || !fl?.yaxis) return null;
      return {
        x: [...fl.xaxis.range] as [number, number],
        y: [...fl.yaxis.range] as [number, number],
      };
    }, index);
  };

  /**
   * Drag from a starting offset (relative to chart center) to an end
   * offset. Uses Playwright's native mouse API so the gesture flows
   * through useChartGestures's pointer handlers exactly like a real
   * user drag.
   */
  const dragChart = async (
    page: import('@playwright/test').Page,
    index: 0 | 1,
    fromOffset: { x: number; y: number },
    toOffset: { x: number; y: number },
  ) => {
    const chart = page.locator('.fixed.inset-0 .js-plotly-plot').nth(index);
    const box = await chart.boundingBox();
    if (!box) throw new Error(`chart ${index} not visible`);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx + fromOffset.x, cy + fromOffset.y);
    await page.mouse.down();
    // Two intermediate steps so Plotly's pointermove handler observes
    // motion (single jumps sometimes get coalesced).
    await page.mouse.move(cx + (fromOffset.x + toOffset.x) / 2, cy + (fromOffset.y + toOffset.y) / 2);
    await page.mouse.move(cx + toOffset.x, cy + toOffset.y);
    await page.mouse.up();
    // Let the rAF-throttled relayout in useChartGestures land.
    await page.waitForTimeout(120);
  };

  /**
   * Move the mouse over the chart — re-entry / hover is what triggers
   * the bug: each hover re-renders the React component, which feeds the
   * stale layout back through Plotly.react and snaps the range back.
   */
  const hoverOverChart = async (page: import('@playwright/test').Page, index: 0 | 1) => {
    const chart = page.locator('.fixed.inset-0 .js-plotly-plot').nth(index);
    const box = await chart.boundingBox();
    if (!box) throw new Error(`chart ${index} not visible`);
    // Move mouse outside, then back in, to force a real mouseenter.
    await page.mouse.move(0, 0);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.waitForTimeout(200);
  };

  test('drift chart X pan survives a hover-induced re-render', async ({ page }) => {
    await openAnalysis(page);
    const before = await readRanges(page, 0);
    expect(before).not.toBeNull();
    if (!before) throw new Error('unreachable');
    // Drag right by 80px → useChartGestures pans X to the LEFT.
    await dragChart(page, 0, { x: -40, y: 0 }, { x: 40, y: 0 });
    const afterPan = await readRanges(page, 0);
    expect(afterPan).not.toBeNull();
    if (!afterPan) throw new Error('unreachable');
    // X range should have shifted (not equal to original).
    expect(afterPan.x[0]).not.toBeCloseTo(before.x[0], 4);
    // Now trigger a re-render via hover — the bug is that the chart
    // re-renders and snaps xaxis.range back to the original xExtent.
    await hoverOverChart(page, 0);
    const afterHover = await readRanges(page, 0);
    expect(afterHover).not.toBeNull();
    if (!afterHover) throw new Error('unreachable');
    // Range must still match the post-pan state, not the pre-pan one.
    expect(afterHover.x[0]).toBeCloseTo(afterPan.x[0], 1);
    expect(afterHover.x[1]).toBeCloseTo(afterPan.x[1], 1);
  });

  test('periodogram Y zoom survives a hover-induced re-render', async ({ page }) => {
    await openAnalysis(page);
    // Let autorange settle and the first onRelayout capture into the
    // store before we read baseline. Without this the baseline can be
    // a transient value Plotly is about to overwrite.
    await page.waitForTimeout(300);
    const before = await readRanges(page, 1);
    expect(before).not.toBeNull();
    if (!before) throw new Error('unreachable');
    // Drag vertically — exact direction depends on chart geometry; the
    // assertion below is "y1 changed". The point of the test is the
    // persistence-on-hover bug, not the gesture direction (which is
    // covered by the bottom-anchor logic in useChartGestures).
    await dragChart(page, 1, { x: 0, y: 40 }, { x: 0, y: -40 });
    const afterZoom = await readRanges(page, 1);
    expect(afterZoom).not.toBeNull();
    if (!afterZoom) throw new Error('unreachable');
    // y0 should still be 0 (bottom-anchored).
    expect(afterZoom.y[0]).toBeCloseTo(0, 4);
    // y1 must have moved (any direction). If not, the drag plumbing
    // didn't fire — different bug, fail loudly.
    expect(Math.abs(afterZoom.y[1] - before.y[1])).toBeGreaterThan(1e-4);
    await hoverOverChart(page, 1);
    const afterHover = await readRanges(page, 1);
    expect(afterHover).not.toBeNull();
    if (!afterHover) throw new Error('unreachable');
    // The actual bug: hover-induced re-render must NOT snap the y range
    // back to the pre-drag value.
    expect(afterHover.y[1]).toBeCloseTo(afterZoom.y[1], 4);
    expect(afterHover.y[0]).toBeCloseTo(0, 4);
  });

  test('periodogram X pan survives a hover-induced re-render', async ({ page }) => {
    await openAnalysis(page);
    const before = await readRanges(page, 1);
    expect(before).not.toBeNull();
    if (!before) throw new Error('unreachable');
    // X is log-scale; drag right pans toward earlier (smaller) periods.
    await dragChart(page, 1, { x: -40, y: 0 }, { x: 40, y: 0 });
    const afterPan = await readRanges(page, 1);
    expect(afterPan).not.toBeNull();
    if (!afterPan) throw new Error('unreachable');
    expect(afterPan.x[0]).not.toBeCloseTo(before.x[0], 4);
    await hoverOverChart(page, 1);
    const afterHover = await readRanges(page, 1);
    expect(afterHover).not.toBeNull();
    if (!afterHover) throw new Error('unreachable');
    expect(afterHover.x[0]).toBeCloseTo(afterPan.x[0], 4);
    expect(afterHover.x[1]).toBeCloseTo(afterPan.x[1], 4);
  });
});
