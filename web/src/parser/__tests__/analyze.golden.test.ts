import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog } from '../parseLog';
import { analyze } from '../analyze';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, 'fixtures', 'synthetic.log');
const SNAP = join(__dirname, 'fixtures', 'analyze.golden.json');

describe('analyze golden', () => {
  it('matches the locked snapshot for synthetic.log', () => {
    const text = readFileSync(LOG, 'utf-8');
    const log = parseLog(text);
    const session = log.sessions[0];
    const ga = analyze(session, { range: { begin: 0, end: session.entries.length }, undoRaCorrections: false });
    const summary = {
      len: ga.t.length,
      nfft: ga.fftPeriod.length,
      fftAmpMax: ga.fftAmpMax,
      driftRa: ga.driftRa,
      driftDec: ga.driftDec,
      fftPeriodFirst: ga.fftPeriod[0],
      fftPeriodLast: ga.fftPeriod[ga.fftPeriod.length - 1],
    };
    if (!existsSync(SNAP) || JSON.parse(readFileSync(SNAP, 'utf-8')).len === null) {
      writeFileSync(SNAP, JSON.stringify(summary, null, 2));
      return;
    }
    const expected = JSON.parse(readFileSync(SNAP, 'utf-8'));
    expect(summary.len).toBe(expected.len);
    expect(summary.nfft).toBe(expected.nfft);
    expect(summary.fftAmpMax).toBeCloseTo(expected.fftAmpMax, 6);
    expect(summary.driftRa).toBeCloseTo(expected.driftRa, 6);
    expect(summary.driftDec).toBeCloseTo(expected.driftDec, 6);
    expect(summary.fftPeriodFirst).toBeCloseTo(expected.fftPeriodFirst, 6);
    expect(summary.fftPeriodLast).toBeCloseTo(expected.fftPeriodLast, 6);
  });
});
