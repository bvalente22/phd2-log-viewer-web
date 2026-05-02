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

test.describe('Analysis modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('Analyze selected frames opens the modal with both charts', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected frames' }).click();

    await expect(page.getByRole('heading', { name: /Analysis · \d+ frames/ })).toBeVisible();
    await expect(page.locator('.fixed.inset-0 .js-plotly-plot')).toHaveCount(2);
    await page.getByRole('button', { name: '✕' }).click();
    await expect(page.locator('.fixed.inset-0')).not.toBeVisible();
  });

  test('Analyze selected, raw RA shows "RA corrections removed" in the title', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected, raw RA' }).click();
    await expect(page.getByRole('heading', { name: /RA corrections removed/ })).toBeVisible();
  });

  test('Analyze unguided section shows "unguided section" in the title', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze unguided section' }).click();
    await expect(page.getByRole('heading', { name: /unguided section/ })).toBeVisible();
  });

  test('hovering the periodogram populates a Period: readout', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected frames' }).click();
    await expect(page.locator('.fixed.inset-0 .js-plotly-plot')).toHaveCount(2);
    // Synthesize Plotly's plotly_hover event directly on the periodogram
    // div. react-plotly.js' onHover prop calls back with ev.points[0].x;
    // dispatching a CustomEvent with that shape exercises the same code
    // path the real cursor would.
    await page.evaluate(() => {
      const plots = document.querySelectorAll<HTMLElement>('.fixed.inset-0 .js-plotly-plot');
      const periodogram = plots[plots.length - 1];
      if (!periodogram) throw new Error('periodogram div missing');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev = new CustomEvent('plotly_hover', { detail: { points: [{ x: 5 }] } });
      // react-plotly.js wires onHover via Plotly's internal `.on` system.
      // The DOM div also re-emits via jQuery-style events; for tests we can
      // call the registered listeners directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const div = periodogram as any;
      if (typeof div.emit === 'function') {
        div.emit('plotly_hover', { points: [{ x: 5 }] });
      } else {
        periodogram.dispatchEvent(ev);
      }
    });
    await expect(page.locator('.fixed.inset-0 .font-mono').last()).toContainText(/Period:/, { timeout: 5000 });
  });

  test('Esc closes the modal', async ({ page }) => {
    await dropFixture(page);
    await page.getByText('Guide ·', { exact: false }).first().click();
    await page.locator('.js-plotly-plot').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Analyze selected frames' }).click();
    await expect(page.locator('.fixed.inset-0')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.fixed.inset-0')).not.toBeVisible();
  });
});
