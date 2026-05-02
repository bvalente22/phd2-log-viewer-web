import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLog } from '../parseLog';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'synthetic.log'), 'utf-8');

describe('parseLog', () => {
  it('parses the synthetic log into one calibration and one guiding section', () => {
    const log = parseLog(FIXTURE);
    expect(log.phdVersion).toBe('2.6.11');
    expect(log.calibrations.length).toBe(1);
    expect(log.sessions.length).toBe(1);
    expect(log.sections.length).toBe(2);
    expect(log.sections[0]).toEqual({ type: 'CALIBRATION', idx: 0 });
    expect(log.sections[1]).toEqual({ type: 'GUIDING', idx: 0 });
  });

  it('parses calibration entries', () => {
    const log = parseLog(FIXTURE);
    const cal = log.calibrations[0];
    expect(cal.device).toBe('MOUNT');
    expect(cal.entries.length).toBe(5);
    expect(cal.entries[0].direction).toBe('WEST');
    expect(cal.entries[3].direction).toBe('NORTH');
  });

  it('parses guiding entries with correct direction-flipped durations', () => {
    const log = parseLog(FIXTURE);
    const s = log.sessions[0];
    expect(s.entries.length).toBe(16);
    expect(s.entries[0].radur).toBe(-100);
    expect(s.entries[0].decdur).toBe(50);
    expect(s.entries[2].radur).toBe(-200);
    expect(s.entries[2].decdur).toBe(-100);
    expect(s.entries[4].radur).toBe(100);
  });

  it('captures pixel scale, declination, mount header info', () => {
    const log = parseLog(FIXTURE);
    const s = log.sessions[0];
    expect(s.pixelScale).toBeCloseTo(1.5);
    expect(s.declination).toBeCloseTo(30 * Math.PI / 180);
    expect(s.mount.isValid).toBe(true);
    expect(s.mount.xRate).toBeCloseTo(5.0);
    expect(s.mount.xlim.minMo).toBeCloseTo(0.10);
    expect(s.mount.ylim.minMo).toBeCloseTo(0.20);
    expect(s.mount.xlim.maxDur).toBeCloseTo(2000);
  });

  it('captures INFO events with prefix stripped', () => {
    const log = parseLog(FIXTURE);
    const s = log.sessions[0];
    expect(s.infos.length).toBe(4);
    expect(s.infos[0].info).toBe('state=1');
    expect(s.infos[1].info).toBe('state=0');
    expect(s.infos[2].info).toBe('MountGuidingEnabled = false');
    expect(s.infos[3].info).toBe('MountGuidingEnabled = true');
  });

  it('records duration as last entry dt', () => {
    const log = parseLog(FIXTURE);
    expect(log.sessions[0].duration).toBe(16);
  });

  it('marks frames inside the unguided window as guiding=false and the rest as guiding=true', () => {
    const log = parseLog(FIXTURE);
    const entries = log.sessions[0].entries;
    // Frames 1-5 (idx 0..4) and frames 9-16 (idx 8..15) are guided.
    expect(entries[0].guiding).toBe(true);
    expect(entries[1].guiding).toBe(true);
    expect(entries[2].guiding).toBe(true);
    expect(entries[3].guiding).toBe(true);
    expect(entries[4].guiding).toBe(true);
    for (let i = 8; i < entries.length; i++) {
      expect(entries[i].guiding).toBe(true);
    }
    // Frames 6-8 (idx 5..7) sit inside the unguided window.
    expect(entries[5].guiding).toBe(false);
    expect(entries[6].guiding).toBe(false);
    expect(entries[7].guiding).toBe(false);
  });
});
