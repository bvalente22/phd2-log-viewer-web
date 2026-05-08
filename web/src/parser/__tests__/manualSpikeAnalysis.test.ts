import { describe, expect, it } from 'vitest';
import { manualSpikeStats, type ManualSpikeRun } from '../manualSpikeAnalysis';

/** Minimal hand-built ManualSpikeRun for stats testing — bypasses the
 *  full pipeline so we can assert the math directly. */
function makeRun(values: number[], median = 0, dt = 2): ManualSpikeRun {
  const t = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) t[i] = (i + 1) * dt;
  return {
    axis: 'ra',
    pixelScale: 1,
    starts: 0,
    dt,
    t,
    detrended: Float64Array.from(values),
    median,
    sigma: 0.1,
  };
}

describe('manualSpikeStats', () => {
  it('returns zeros for empty selection', () => {
    const run = makeRun([0, 0, 0, 0]);
    const stats = manualSpikeStats(run, []);
    expect(stats).toEqual({
      count: 0,
      meanPeriodSec: 0,
      intervalStdSec: 0,
      meanAmplitude: 0,
    });
  });

  it('amplitude only with one point', () => {
    const run = makeRun([0, 1.5, 0, 0]);
    const stats = manualSpikeStats(run, [1]);
    expect(stats.count).toBe(1);
    expect(stats.meanAmplitude).toBe(1.5);
    expect(stats.meanPeriodSec).toBe(0);
  });

  it('mean period from two evenly-spaced selections', () => {
    // Indices 1, 5 at dt=2 → t=4, t=12. One interval = 8s.
    const run = makeRun([0, 1.5, 0, 0, 0, 1.5, 0, 0]);
    const stats = manualSpikeStats(run, [1, 5]);
    expect(stats.count).toBe(2);
    expect(stats.meanPeriodSec).toBeCloseTo(8, 5);
    expect(stats.intervalStdSec).toBe(0);
    expect(stats.meanAmplitude).toBeCloseTo(1.5, 5);
  });

  it('mean period averages multiple intervals', () => {
    // Indices 0, 2, 4 at dt=2 → t=2, 6, 10. Intervals: 4, 4. Mean 4.
    const run = makeRun([1, 0, 1, 0, 1]);
    const stats = manualSpikeStats(run, [0, 2, 4]);
    expect(stats.count).toBe(3);
    expect(stats.meanPeriodSec).toBeCloseTo(4, 5);
    expect(stats.intervalStdSec).toBe(0);
  });

  it('reports interval std for irregular spacing', () => {
    // Indices 0, 1, 4 → t=2, 4, 10. Intervals: 2, 6.
    const run = makeRun([1, 1, 0, 0, 1]);
    const stats = manualSpikeStats(run, [0, 1, 4]);
    expect(stats.count).toBe(3);
    expect(stats.meanPeriodSec).toBeCloseTo(4, 5);
    expect(stats.intervalStdSec).toBeCloseTo(2, 5);
  });

  it('handles unsorted input by sorting on time', () => {
    // Same as the evenly-spaced test but indices passed in reverse order.
    const run = makeRun([0, 1.5, 0, 0, 0, 1.5, 0, 0]);
    const stats = manualSpikeStats(run, [5, 1]);
    expect(stats.meanPeriodSec).toBeCloseTo(8, 5);
  });

  it('amplitude uses |value − median|', () => {
    // Median 0.5, selections at values 1.5 and -0.5 → |1.0| and |1.0| → 1.0
    const run = makeRun([1.5, -0.5], 0.5);
    const stats = manualSpikeStats(run, [0, 1]);
    expect(stats.meanAmplitude).toBeCloseTo(1.0, 5);
  });
});
