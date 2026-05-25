import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog } from '../index';
import { analyze, findUnguidedWindow } from '../analyze';
import { densePeriodogram, curveTopPeaks } from '../perioPeaks';

const __dirname = dirname(fileURLToPath(import.meta.url));
// `sample data/` is gitignored, so this only runs on a machine that has the
// real fixtures (matches realLogs.test.ts's skip-if pattern).
const LOG = join(
  __dirname, '..', '..', '..', '..',
  'sample data', 'unguided_example', 'PHD2_GuideLog_2026-05-23_021746.txt',
);

describe.skipIf(!existsSync(LOG))('unguided periodogram matches the desktop log viewer', () => {
  it('reports the worm-period peak the desktop shows (~409.7s / 2.3"), and the table matches the curve', () => {
    const log = parseLog(readFileSync(LOG, 'utf-8'));
    const session = log.sessions.find((s) => findUnguidedWindow(s) !== null);
    expect(session).toBeDefined();
    const win = findUnguidedWindow(session!)!;
    const ga = analyze(session!, { range: win, undoRaCorrections: false });

    // No zero-padding: longest period must be the desktop's n0*dt, not the
    // power-of-two-padded ceiling that pushed it out to ~618s before the fix.
    const longest = ga.fftPeriod[ga.fftPeriod.length - 1];
    expect(longest).toBeGreaterThan(420);
    expect(longest).toBeLessThan(470); // ~444s = n0*dt, NOT the old ~618s

    const curve = densePeriodogram(ga.fftPeriod, ga.fftSpline);
    const peaks = curveTopPeaks(curve, 3, 600);
    expect(peaks.length).toBeGreaterThan(0);

    // Desktop PHDLogView reports Period 409.7s, Amplitude 2.3" for this window.
    const px = ga.pixelScale; // arcsec per pixel
    expect(peaks[0].period).toBeGreaterThan(395);
    expect(peaks[0].period).toBeLessThan(425); // 409.7s ± a few seconds
    expect(peaks[0].amplitude * px).toBeGreaterThan(2.2);
    expect(peaks[0].amplitude * px).toBeLessThan(2.45); // 2.3"

    // Table == graph: the #1 peak is the global max of the plotted curve.
    let curveMax = -Infinity;
    for (let i = 0; i < curve.x.length; i++) {
      if (curve.x[i] <= 600 && curve.y[i] > curveMax) curveMax = curve.y[i];
    }
    expect(peaks[0].amplitude).toBeCloseTo(curveMax, 6);
  });
});
