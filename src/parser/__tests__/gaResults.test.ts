import { describe, it, expect } from 'vitest';
import { extractGAResults } from '../gaResults';
import type { GuideSession, InfoEntry, GuideEntry } from '../types';
import { newGuideSession } from '../types';

const makeEntry = (frame: number, dt: number): GuideEntry => ({
  frame, dt,
  mount: 'MOUNT',
  included: true,
  guiding: true,
  dx: 0, dy: 0,
  raraw: 0, decraw: 0,
  raguide: 0, decguide: 0,
  radur: 0, decdur: 0,
  mass: 0, snr: 0, err: 0,
  info: '',
});

const sessionWithInfos = (infos: { idx: number; info: string }[]): GuideSession => {
  const s = newGuideSession('2026-01-17 22:00:00');
  // Provide enough entries so info.idx resolves to a real entry for time lookup.
  const maxIdx = infos.reduce((m, i) => Math.max(m, i.idx), -1);
  for (let i = 0; i <= maxIdx + 1; i++) s.entries.push(makeEntry(i + 1, i * 4));
  s.infos = infos.map((i): InfoEntry => ({ idx: i.idx, repeats: 1, info: i.info }));
  return s;
};

describe('extractGAResults', () => {
  it('returns an empty array when there are no GA events', () => {
    const s = sessionWithInfos([
      { idx: 0, info: 'DITHER by 1.0, 2.0' },
      { idx: 1, info: 'Settling started' },
    ]);
    expect(extractGAResults(s)).toEqual([]);
  });

  it('extracts a single run with recommendations and metrics', () => {
    const s = sessionWithInfos([
      { idx: 5, info: 'Guiding parameter change, MountGuidingEnabled = false' },
      { idx: 7, info: 'GA Result - SNR=399.6, Samples=43, RA HPF-RMS= 0.02 px' },
      { idx: 7, info: 'GA Result - RA Peak= 0.21 px ( 0.61 arc-sec )' },
      { idx: 7, info: 'GA Result - Recommendation: Try setting RA min-move to 0.15' },
      { idx: 7, info: 'GA Result - Recommendation: Try setting Dec min-move to 0.15' },
      { idx: 9, info: 'Guiding parameter change, MountGuidingEnabled = true' },
    ]);
    const runs = extractGAResults(s);
    expect(runs).toHaveLength(1);
    expect(runs[0].startIdx).toBe(5);
    expect(runs[0].endIdx).toBe(9);
    expect(runs[0].recommendations).toEqual([
      'Try setting RA min-move to 0.15',
      'Try setting Dec min-move to 0.15',
    ]);
    expect(runs[0].metrics).toEqual([
      'SNR=399.6, Samples=43, RA HPF-RMS= 0.02 px',
      'RA Peak= 0.21 px ( 0.61 arc-sec )',
    ]);
    expect(runs[0].startTime).toBeDefined();
    expect(runs[0].endTime).toBeDefined();
  });

  it('skips MountGuidingEnabled toggles that contain no GA output', () => {
    const s = sessionWithInfos([
      { idx: 0, info: 'Guiding parameter change, MountGuidingEnabled = false' },
      { idx: 1, info: 'Guiding parameter change, MountGuidingEnabled = true' },
    ]);
    expect(extractGAResults(s)).toEqual([]);
  });

  it('handles multiple GA runs in one session', () => {
    const s = sessionWithInfos([
      { idx: 0, info: 'Guiding parameter change, MountGuidingEnabled = false' },
      { idx: 1, info: 'GA Result - Recommendation: Re-do calibration' },
      { idx: 2, info: 'Guiding parameter change, MountGuidingEnabled = true' },
      // ... session continues, then a second GA run later ...
      { idx: 50, info: 'Guiding parameter change, MountGuidingEnabled = false' },
      { idx: 51, info: 'GA Result - SNR=296.3' },
      { idx: 51, info: 'GA Result - Recommendation: Try Lowpass2 for Dec' },
      { idx: 52, info: 'Guiding parameter change, MountGuidingEnabled = true' },
    ]);
    const runs = extractGAResults(s);
    expect(runs).toHaveLength(2);
    expect(runs[0].recommendations).toEqual(['Re-do calibration']);
    expect(runs[0].metrics).toEqual([]);
    expect(runs[1].recommendations).toEqual(['Try Lowpass2 for Dec']);
    expect(runs[1].metrics).toEqual(['SNR=296.3']);
  });

  it('emits a trailing run when guiding never resumes before session end', () => {
    const s = sessionWithInfos([
      { idx: 0, info: 'Guiding parameter change, MountGuidingEnabled = false' },
      { idx: 1, info: 'GA Result - Recommendation: Improve focus' },
      // No "MountGuidingEnabled = true" to close the run.
    ]);
    const runs = extractGAResults(s);
    expect(runs).toHaveLength(1);
    expect(runs[0].endIdx).toBeNull();
    expect(runs[0].endTime).toBeUndefined();
    expect(runs[0].recommendations).toEqual(['Improve focus']);
  });

  it('ignores GA Result lines that fall outside an open run', () => {
    const s = sessionWithInfos([
      // GA Result without a preceding `MountGuidingEnabled = false` is
      // malformed and should be discarded rather than crashing or
      // attaching to the next run.
      { idx: 0, info: 'GA Result - Recommendation: stray' },
      { idx: 5, info: 'Guiding parameter change, MountGuidingEnabled = false' },
      { idx: 6, info: 'GA Result - Recommendation: real one' },
      { idx: 7, info: 'Guiding parameter change, MountGuidingEnabled = true' },
    ]);
    const runs = extractGAResults(s);
    expect(runs).toHaveLength(1);
    expect(runs[0].recommendations).toEqual(['real one']);
  });
});
