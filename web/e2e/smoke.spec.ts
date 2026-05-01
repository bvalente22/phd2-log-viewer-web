import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'synthetic.log');

test('drop-and-view smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Drop a PHD2 guide log here')).toBeVisible();

  const text = readFileSync(FIXTURE, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'synthetic.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });

  await expect(page.getByText('Guide:', { exact: false })).toBeVisible();
  await page.getByText('Guide:', { exact: false }).first().click();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();
  await expect(page.getByText('RMS Total')).toBeVisible();
});
