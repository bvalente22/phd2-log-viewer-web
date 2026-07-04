import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog, calcStats } from '../index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, '..', '..', '..', '..', 'sample data');

const sampleFiles = existsSync(SAMPLES_DIR)
  ? readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.txt') || f.endsWith('.log'))
  : [];

describe.skipIf(sampleFiles.length === 0)('real PHD2 sample logs', () => {
  for (const f of sampleFiles) {
    it(`parses ${f} without errors and produces non-empty stats`, () => {
      const text = readFileSync(join(SAMPLES_DIR, f), 'utf-8');
      const log = parseLog(text);

      expect(log.phdVersion.length).toBeGreaterThan(0);
      expect(log.sections.length).toBeGreaterThan(0);

      for (const s of log.sessions) {
        // Every session should have a date and at least one entry's worth of structure
        expect(s.date.length).toBeGreaterThan(0);
        // Stats should compute without throwing and yield finite numbers
        const st = calcStats(s);
        expect(Number.isFinite(st.rmsTotal)).toBe(true);
        expect(Number.isFinite(st.driftRa)).toBe(true);
        expect(Number.isFinite(st.driftDec)).toBe(true);
        expect(Number.isFinite(st.paeArcMin)).toBe(true);
        expect(st.includedCount + st.excludedCount).toBe(s.entries.length);
      }

      // A log records one calibration per "Calibration Begins" marker, but a
      // real session can abort a calibration before any step runs (star lost,
      // repeated restarts — e.g. the 22:15:39 / :44 cluster in the residual
      // sample, each ending right after the "Direction,Step,…" header with no
      // rows). Those parse to a valid calibration with zero entries, so we
      // don't require every calibration to have steps — instead we require the
      // log to have at least one non-empty calibration, and that whatever
      // entries DO exist are well-formed (finite coordinates).
      if (log.calibrations.length > 0) {
        expect(log.calibrations.some((cal) => cal.entries.length > 0)).toBe(true);
      }
      for (const cal of log.calibrations) {
        expect(['MOUNT', 'AO']).toContain(cal.device);
        for (const e of cal.entries) {
          expect(Number.isFinite(e.dx)).toBe(true);
          expect(Number.isFinite(e.dy)).toBe(true);
        }
      }
    });
  }
});
