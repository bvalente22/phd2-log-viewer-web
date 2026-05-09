import { describe, expect, it } from 'vitest';
import { parseBltText, validateDebugLogHeader, BltStreamParser } from '../parseBlt';

/** Hand-built BLT log fragment that exercises the full state machine.
 *  Real PHD2 lines are wrapped in the same format; we add the
 *  surrounding lines that the parser must skip (no "BLT" tag). */
function syntheticBlt(): string {
  return [
    '20:30:00.000 0.000 1234 PHD2 begins execution at 2026-05-03',
    '20:30:01.000 0.001 1234 ContextManager: starting',
    '20:55:06.264 0.001 1234 BLT starting North backlash clearing using pulse width of 425, looking for moves >= 4 px',
    '20:55:30.416 0.001 1234 BLT: Starting North moves at Dec=0.00',
    '20:55:30.417 0.001 1234 BLT: Moving North for 425 ms, step 1 / 4, DecLoc = 0.00, DeltaDec = 0.00',
    '20:55:33.054 0.001 1234 BLT: Moving North for 425 ms, step 2 / 4, DecLoc = 10.00, DeltaDec = 10.00',
    '20:55:35.658 0.001 1234 BLT: Moving North for 425 ms, step 3 / 4, DecLoc = 20.00, DeltaDec = 10.00',
    '20:55:38.389 0.001 1234 BLT: Moving North for 425 ms, step 4 / 4, DecLoc = 30.00, DeltaDec = 10.00',
    '20:55:41.036 0.001 1234 BLT: North pulses ended at Dec location 40.00, TotalDecDelta=40.00 px',
    // South phase: first two moves are tiny (still inside the backlash),
    // third one finally clears (size 9.5 px south, > 0.9*10 = 9 threshold).
    '20:55:45.000 0.001 1234 BLT: Moving South for 425 ms, step 1 / 5, DecLoc = 39.50, DeltaDec = -0.50',
    '20:55:48.000 0.001 1234 BLT: Moving South for 425 ms, step 2 / 5, DecLoc = 39.10, DeltaDec = -0.40',
    '20:55:51.000 0.001 1234 BLT: Moving South for 425 ms, step 3 / 5, DecLoc = 30.10, DeltaDec = -9.00',
    '20:55:54.000 0.001 1234 BLT: Moving South for 425 ms, step 4 / 5, DecLoc = 20.50, DeltaDec = -9.60',
    '20:55:55.000 0.001 1234 BLT: Backlash amount = something',
  ].join('\n');
}

describe('validateDebugLogHeader', () => {
  it('accepts a "begins execution" header', () => {
    expect(validateDebugLogHeader('20:30:00 0.000 1234 PHD2 begins execution at 2026-05-03'))
      .toBeNull();
  });
  it('accepts a "continues execution" header', () => {
    expect(validateDebugLogHeader('20:30:00 0.000 1234 PHD2 continues execution at 2026-05-03'))
      .toBeNull();
  });
  it('rejects a guide-log header', () => {
    expect(validateDebugLogHeader('PHD2 version 2.6.14 [Windows], Log version 2.5'))
      .not.toBeNull();
  });
});

describe('parseBltText', () => {
  it('extracts a single sequence with timestamp + pulse size', () => {
    const seqs = parseBltText(syntheticBlt());
    expect(seqs.length).toBe(1);
    expect(seqs[0].timestamp).toBe('20:55:06');
    expect(seqs[0].pulseSize).toBe(425);
  });

  it('captures north points + computes deltas', () => {
    const seqs = parseBltText(syntheticBlt());
    expect(seqs[0].northPoints).toEqual([0, 10, 20, 30, 40]);
    // Deltas are differences between consecutive raw points. Spec
    // skips the first point's "delta" because lastDecPos starts at 0.
    expect(seqs[0].northDeltas.length).toBeGreaterThanOrEqual(3);
  });

  it('captures south points + computes deltas', () => {
    const seqs = parseBltText(syntheticBlt());
    expect(seqs[0].southPoints).toEqual([39.5, 39.1, 30.1, 20.5]);
    expect(seqs[0].southDeltas.length).toBeGreaterThanOrEqual(3);
  });

  it('runs ComputeResult and produces a positive backlash estimate', () => {
    const seqs = parseBltText(syntheticBlt());
    const s = seqs[0];
    expect(s.medianNorthMove).toBeGreaterThan(0);
    expect(s.northRate).toBeGreaterThan(0);
    expect(s.blPx).toBeGreaterThanOrEqual(0);
    expect(s.blMs).toBeGreaterThanOrEqual(0);
  });

  it('detects multiple sequences in the same log', () => {
    const second = syntheticBlt().replace(/20:55/g, '21:10');
    const combined = [syntheticBlt(), second].join('\n');
    const seqs = parseBltText(combined);
    expect(seqs.length).toBe(2);
    expect(seqs[0].timestamp).toBe('20:55:06');
    expect(seqs[1].timestamp).toBe('21:10:06');
  });

  it('finalizes a truncated sequence (no BACKLASH AMOUNT)', () => {
    // Drop the final "BACKLASH AMOUNT" line — parser should still
    // finalize on EOF.
    const truncated = syntheticBlt().split('\n').slice(0, -1).join('\n');
    const seqs = parseBltText(truncated);
    expect(seqs.length).toBe(1);
  });

  it('honors PROCESS HALTED as an end marker', () => {
    const halted = syntheticBlt().replace(
      'BLT: Backlash amount = something',
      'BLT: measurement process halted by user or by error',
    );
    const seqs = parseBltText(halted);
    expect(seqs.length).toBe(1);
  });

  it('skips non-BLT lines fast', () => {
    // 100k lines of garbage + one BLT sequence — parser should still
    // produce one valid sequence and not get distracted by noise.
    const noise = Array.from({ length: 5000 }, (_, i) =>
      `20:30:${String(i % 60).padStart(2, '0')}.000 0.001 ${i} INFO some unrelated event`).join('\n');
    const seqs = parseBltText(`${noise}\n${syntheticBlt()}\n${noise}`);
    expect(seqs.length).toBe(1);
  });

  it('returns empty array for a log with no BLT sequences', () => {
    const seqs = parseBltText('20:30:00.000 0.000 1234 PHD2 begins execution\n20:30:01 INFO nothing here\n');
    expect(seqs).toEqual([]);
  });
});

describe('BltStreamParser', () => {
  it('produces the same result as parseBltText regardless of chunk size', () => {
    const text = syntheticBlt();
    const allAtOnce = parseBltText(text);
    // Push the text in 7-char chunks (likely splitting lines mid-way).
    const stream = new BltStreamParser();
    for (let i = 0; i < text.length; i += 7) {
      stream.push(text.slice(i, i + 7));
    }
    const streamed = stream.finalize();
    expect(streamed.length).toBe(allAtOnce.length);
    expect(streamed[0].timestamp).toBe(allAtOnce[0].timestamp);
    expect(streamed[0].northPoints).toEqual(allAtOnce[0].northPoints);
    expect(streamed[0].southPoints).toEqual(allAtOnce[0].southPoints);
    expect(streamed[0].blPx).toBeCloseTo(allAtOnce[0].blPx, 5);
  });
});
