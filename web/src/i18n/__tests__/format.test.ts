import { describe, it, expect } from 'vitest';
import { wrapTip } from '../format';

describe('wrapTip', () => {
  it('wraps to <= max chars per line on word boundaries', () => {
    const out = wrapTip('the quick brown fox jumps over', 10);
    for (const line of out.split('\n')) expect(line.length).toBeLessThanOrEqual(10);
    expect(out).toContain('\n');
  });
  it('hard-breaks a token longer than max', () => {
    const out = wrapTip('supercalifragilistic', 6);
    expect(out.split('\n').every((l) => l.length <= 6)).toBe(true);
  });
  it('defaults to 44', () => {
    expect(wrapTip('x'.repeat(50)).split('\n').length).toBeGreaterThan(1);
  });
});
