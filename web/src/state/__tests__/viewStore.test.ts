import { describe, it, expect } from 'vitest';
import { clampSidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX, SIDEBAR_DEFAULT } from '../viewStore';

describe('clampSidebarWidth', () => {
  it('passes through an in-range value', () => {
    expect(clampSidebarWidth(300)).toBe(300);
  });
  it('clamps below the minimum', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN);
  });
  it('clamps above the maximum', () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX);
  });
  it('exposes a default within bounds', () => {
    expect(SIDEBAR_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_MIN);
    expect(SIDEBAR_DEFAULT).toBeLessThanOrEqual(SIDEBAR_MAX);
  });
});
