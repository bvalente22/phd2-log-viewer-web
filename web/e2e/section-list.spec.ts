import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MULTI = join(__dirname, '..', 'src', 'parser', '__tests__', 'fixtures', 'multi-session.log');

/**
 * Tests for SectionList readability + GA badge:
 *   - filename in the page header renders at the smaller xs size so
 *     long names fit without wrapping the header
 *   - section labels render at text-xs / font-normal (not text-sm /
 *     font-medium) and are allowed to wrap, so a full
 *     "Guide · YYYY-MM-DD HH:MM:SS" stays visible in a 260px sidebar
 *   - sessions that contain GA Result lines get a "GA" badge; sessions
 *     without don't
 */

const dropMulti = async (page: Page) => {
  const text = readFileSync(MULTI, 'utf-8');
  await page.setInputFiles('input[type=file]', {
    name: 'PHD2_GuideLog_2024-01-15_220000_long_filename_for_readability.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf-8'),
  });
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('section labels render at the smaller text-xs / font-normal size', async ({ page }) => {
  await dropMulti(page);
  const labels = page.locator('aside ul li button span.flex-1 > span span.break-words');
  await expect(labels.first()).toBeVisible();
  // Inspect the computed style of the first label — text-xs is 12px in
  // the project's Tailwind config, font-normal is weight 400.
  const styles = await labels.first().evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight };
  });
  expect(styles.fontSize).toBe('12px');
  // font-normal is the default; computed value typically '400'.
  expect(styles.fontWeight === '400' || styles.fontWeight === 'normal').toBeTruthy();
});

test('filename in the page header renders at text-xs', async ({ page }) => {
  await dropMulti(page);
  // The filename span has `title=` set to the full filename.
  const fname = page.locator('header span[title*="PHD2_GuideLog"]');
  await expect(fname.first()).toBeVisible();
  const fontSize = await fname.first().evaluate(
    (el) => window.getComputedStyle(el).fontSize,
  );
  expect(fontSize).toBe('12px');
});

test('first guiding session has a GA badge; second does not', async ({ page }) => {
  await dropMulti(page);
  const items = page.locator('aside ul li');
  await expect(items).toHaveCount(2);
  // First session has GA Result lines in the fixture.
  await expect(items.nth(0).getByText('GA', { exact: true })).toBeVisible();
  // Second session has no GA lines.
  await expect(items.nth(1).getByText('GA', { exact: true })).toHaveCount(0);
});

test('GA badge is bordered amber (visual signal at a glance)', async ({ page }) => {
  await dropMulti(page);
  const badge = page.locator('aside ul li').nth(0).getByText('GA', { exact: true });
  await expect(badge).toBeVisible();
  const colors = await badge.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return {
      borderTopColor: cs.borderTopColor,
      borderTopStyle: cs.borderTopStyle,
      borderTopWidth: cs.borderTopWidth,
    };
  });
  // Amber-500 base RGB is 245,158,11. The /70 alpha modifier rounds
  // around rgb(245, 158, 11) with alpha 0.7 — assert the channel ratios
  // are amber rather than the exact alpha (which Tailwind / browsers
  // can vary slightly on).
  expect(colors.borderTopStyle).toBe('solid');
  expect(colors.borderTopWidth).not.toBe('0px');
  // Crude amber check: red channel high, green mid, blue low.
  const m = colors.borderTopColor.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
  expect(m).not.toBeNull();
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(120);
    expect(g).toBeLessThan(200);
    expect(b).toBeLessThan(60);
  }
});

test('clicking a section with the GA badge selects it', async ({ page }) => {
  await dropMulti(page);
  const firstItem = page.locator('aside ul li').nth(0);
  const button = firstItem.locator('button');
  await button.click();
  // Selected items get bg-slate-800 + text-sky-300; check class presence.
  const cls = await button.getAttribute('class');
  expect(cls ?? '').toContain('text-sky-300');
});
