import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog } from '../parseLog';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cases = [
  { logPath: 'fixtures/synthetic.log', goldenPath: 'fixtures/synthetic.golden.json' },
];

describe('golden snapshots', () => {
  for (const c of cases) {
    it(`matches snapshot for ${c.logPath}`, () => {
      const text = readFileSync(join(__dirname, c.logPath), 'utf-8');
      const golden = JSON.parse(readFileSync(join(__dirname, c.goldenPath), 'utf-8'));
      const log = parseLog(text);

      expect(log.phdVersion).toBe(golden.phdVersion);
      expect(log.sections.length).toBe(golden.sectionCount);
      expect(log.sessions.length).toBe(golden.sessions.length);
      expect(log.calibrations.length).toBe(golden.calibrations.length);

      log.sessions.forEach((s, i) => {
        const g = golden.sessions[i];
        expect(s.entries.length).toBe(g.entryCount);
        expect(s.infos.length).toBe(g.infoCount);
        expect(s.pixelScale).toBeCloseTo(g.pixelScale);
        expect(s.duration).toBeCloseTo(g.duration);
        expect(s.mount.isValid).toBe(g.mountValid);
        expect(s.entries.every(e => e.guiding === g.guidingEnabled)).toBe(true);
      });

      log.calibrations.forEach((cal, i) => {
        const g = golden.calibrations[i];
        expect(cal.device).toBe(g.device);
        expect(cal.entries.length).toBe(g.entryCount);
      });
    });
  }
});
