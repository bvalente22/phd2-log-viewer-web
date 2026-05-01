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

      for (const cal of log.calibrations) {
        expect(['MOUNT', 'AO']).toContain(cal.device);
        expect(cal.entries.length).toBeGreaterThan(0);
      }
    });
  }
});
