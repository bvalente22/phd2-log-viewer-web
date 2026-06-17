import { describe, it, expect } from 'vitest';
import { paePlotDot } from '../PolarAlignmentPlot';

describe('paePlotDot', () => {
  const perMin = 70 / 6; // radius 70 spans 6′
  it('places the dot at distance = total PAE from center', () => {
    const d = paePlotDot(3, 3, 0, perMin, 80, 80); // all azimuth → on +x axis
    expect(Math.hypot(d.x - 80, d.y - 80)).toBeCloseTo(3 * perMin, 4);
    expect(d.x).toBeGreaterThan(80); // azimuth → right
    expect(d.y).toBeCloseTo(80, 4);
  });
  it('all-altitude points straight up', () => {
    const d = paePlotDot(3, 3, 0.0001, perMin, 80, 80); // alt dominates
    expect(d.y).toBeLessThan(80); // up
  });
  it('clamps distance to the 6′ edge', () => {
    const d = paePlotDot(12, 12, 0, perMin, 80, 80);
    expect(Math.hypot(d.x - 80, d.y - 80)).toBeCloseTo(6 * perMin, 4);
  });
  it('centers the dot when there is no split (null contributions)', () => {
    const d = paePlotDot(3, null, null, perMin, 80, 80);
    expect(d.x).toBeCloseTo(80, 4);
    expect(d.y).toBeCloseTo(80, 4);
  });
});
