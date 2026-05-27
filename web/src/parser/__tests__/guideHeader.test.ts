import { describe, it, expect } from 'vitest';
import { parseGuideHeader } from '../guideHeader';

// Real header fragments sampled from fixtures in `sample data/`.
const coord =
  'RA = 15.21 hr, Dec = -90.0 deg, Hour angle = -6.00 hr, Pier side = West, Rotator pos = N/A, Alt = 20.1 deg, Az = 180.0 deg';
const coordRot =
  'RA = 11.16 hr, Dec = -0.0 deg, Hour angle = -0.22 hr, Pier side = East, Rotator pos = 191.1, Alt = 59.4 deg, Az = 173.4 deg';

describe('parseGuideHeader', () => {
  it('extracts pier side, hour angle, altitude; rotator N/A -> null', () => {
    const info = parseGuideHeader([coord]);
    expect(info.pierSide).toBe('West');
    expect(info.hourAngle).toBe('-6.00');
    expect(info.altitude).toBe('20.1');
    expect(info.rotator).toBeNull();
  });

  it('reads a present rotator position and East pier', () => {
    const info = parseGuideHeader([coordRot]);
    expect(info.pierSide).toBe('East');
    expect(info.rotator).toBe('191.1');
  });

  it('parses backlash enabled with pulse', () => {
    const info = parseGuideHeader(['Backlash comp = enabled, pulse = 163 ms']);
    expect(info.backlash).toEqual({ enabled: true, pulseMs: '163' });
  });

  it('parses backlash disabled (amount dropped by the view)', () => {
    const info = parseGuideHeader(['Backlash comp = disabled, pulse = 470 ms']);
    expect(info.backlash).toEqual({ enabled: false, pulseMs: '470' });
  });

  it('Hysteresis: agg fraction shown verbatim, name + min move', () => {
    const a = parseGuideHeader([
      'X guide algorithm = Hysteresis, Hysteresis = 0.100, Aggression = 0.450, Minimum move = 0.098',
    ]).ra;
    expect(a).toEqual({ name: 'Hysteresis', param: 'agg 0.45', minMove: '0.098' });
  });

  it('Lowpass2: Aggressiveness shown as aggr', () => {
    const a = parseGuideHeader([
      'X guide algorithm = Lowpass2, Aggressiveness = 32.000, Minimum move = 0.300',
    ]).ra;
    expect(a).toEqual({ name: 'Lowpass2', param: 'aggr 32', minMove: '0.3' });
  });

  it('Resist Switch: space-separated, percent agg, min-move-before-agg', () => {
    const a = parseGuideHeader([
      'Y guide algorithm = Resist Switch, Minimum move = 0.200 Aggression = 100% FastSwitch = enabled',
    ]).dec;
    expect(a).toEqual({ name: 'Resist Switch', param: 'agg 100%', minMove: '0.2' });
  });

  it('Lowpass: no aggression -> falls back to slope weight', () => {
    const a = parseGuideHeader([
      'Y guide algorithm = Lowpass, Slope weight = 5.000, Minimum move = 0.250',
    ]).dec;
    expect(a).toEqual({ name: 'Lowpass', param: 'slope wt 5', minMove: '0.25' });
  });

  it('maps X->RA and Y->Dec', () => {
    const info = parseGuideHeader([
      'X guide algorithm = Lowpass2, Aggressiveness = 40.000, Minimum move = 0.150',
      'Y guide algorithm = Hysteresis, Hysteresis = 0.100, Aggression = 0.700, Minimum move = 0.13',
    ]);
    expect(info.ra?.name).toBe('Lowpass2');
    expect(info.dec?.name).toBe('Hysteresis');
  });

  it('returns all-null when header lacks the relevant lines', () => {
    const info = parseGuideHeader(['Equipment Profile = ASI MACH1', 'Exposure = 2000 ms']);
    expect(info).toEqual({
      pierSide: null, hourAngle: null, altitude: null, rotator: null,
      backlash: null, ra: null, dec: null,
    });
  });
});
