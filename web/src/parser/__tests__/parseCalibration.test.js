import { describe, it, expect } from 'vitest';
import { parseCalibration } from '../parseCalibration';
describe('parseCalibration', () => {
    it('parses a Mount West entry', () => {
        const e = parseCalibration('West,1,0.5,-0.2,1,2,0.8');
        expect(e.direction).toBe('WEST');
        expect(e.step).toBe(1);
        expect(e.dx).toBeCloseTo(0.5);
        expect(e.dy).toBeCloseTo(-0.2);
    });
    it('treats Left as WEST (AO)', () => {
        const e = parseCalibration('Left,3,0.1,0.0,0,0,0.1');
        expect(e.direction).toBe('WEST');
    });
    it('treats Up as NORTH (AO)', () => {
        const e = parseCalibration('Up,2,0.0,0.4,0,0,0.4');
        expect(e.direction).toBe('NORTH');
    });
    it('parses Backlash', () => {
        const e = parseCalibration('Backlash,1,0,0.05,0,0,0.05');
        expect(e.direction).toBe('BACKLASH');
    });
    it('returns null for unknown direction', () => {
        expect(parseCalibration('Sideways,1,0,0,0,0,0')).toBeNull();
    });
});
