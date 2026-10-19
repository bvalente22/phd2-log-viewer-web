import { describe, it, expect } from 'vitest';
import { spreadMarkers } from '../peakMarkerLayout';

const GAP = 22;

describe('spreadMarkers', () => {
  it('returns [] for empty input', () => {
    expect(spreadMarkers([], GAP)).toEqual([]);
  });

  it('leaves well-separated chips exactly where they are', () => {
    expect(spreadMarkers([600, 100, 400], GAP)).toEqual([600, 100, 400]);
  });

  it('leaves chips exactly minGap apart untouched', () => {
    expect(spreadMarkers([100, 122], GAP)).toEqual([100, 122]);
  });

  it('spreads two colliding chips symmetrically about their mean, keeping order', () => {
    // Input order is rank order (peak 2 at 598, peak 3 at 586), not x order.
    const [p2, p3] = spreadMarkers([598, 586], GAP);
    expect(p3).toBeCloseTo(581);
    expect(p2).toBeCloseTo(603);
    expect(p2 - p3).toBeCloseTo(GAP);
  });

  it('spreads three stacked chips into an evenly spaced run', () => {
    const out = spreadMarkers([300, 300, 300], GAP);
    expect(out).toEqual([278, 300, 322]);
  });

  it('re-merges when a spread run collides with its left neighbor', () => {
    // 100 and 125 are clear of each other, but 140 collides with 125; their
    // spread run (121.5, 143.5) then collides with 100, so all three merge.
    const out = spreadMarkers([100, 125, 140], GAP);
    const sorted = [...out].sort((a, b) => a - b);
    expect(sorted[1] - sorted[0]).toBeCloseTo(GAP);
    expect(sorted[2] - sorted[1]).toBeCloseTo(GAP);
    expect((sorted[0] + sorted[1] + sorted[2]) / 3).toBeCloseTo((100 + 125 + 140) / 3);
    // Order preserved: input 0 is still leftmost, input 2 rightmost.
    expect(out[0]).toBeLessThan(out[1]);
    expect(out[1]).toBeLessThan(out[2]);
  });

  it('only spreads the colliding pair, not a distant chip', () => {
    const out = spreadMarkers([900, 500, 505], GAP);
    expect(out[0]).toBe(900);
    expect(out[2] - out[1]).toBeCloseTo(GAP);
  });
});
