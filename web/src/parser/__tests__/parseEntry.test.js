import { describe, it, expect } from 'vitest';
import { parseEntry } from '../parseEntry';
describe('parseEntry', () => {
    it('parses a typical mount row with East/North directions (durations stay positive)', () => {
        const ln = '42,12.345,"Mount",0.10,-0.20,0.05,-0.07,0.04,-0.06,150,E,80,N,,,1234,12.5,0';
        const e = parseEntry(ln);
        expect(e).not.toBeNull();
        expect(e.frame).toBe(42);
        expect(e.dt).toBeCloseTo(12.345);
        expect(e.mount).toBe('MOUNT');
        expect(e.dx).toBeCloseTo(0.10);
        expect(e.dy).toBeCloseTo(-0.20);
        expect(e.raraw).toBeCloseTo(0.05);
        expect(e.decraw).toBeCloseTo(-0.07);
        expect(e.raguide).toBeCloseTo(0.04);
        expect(e.decguide).toBeCloseTo(-0.06);
        expect(e.radur).toBe(150);
        expect(e.decdur).toBe(80);
        expect(e.mass).toBe(1234);
        expect(e.snr).toBeCloseTo(12.5);
        expect(e.err).toBe(0);
        expect(e.info).toBe('');
    });
    it('flips RADuration sign for West and DECDuration for South', () => {
        const ln = '1,1.0,"Mount",0,0,0,0,0,0,200,W,300,S,,,0,0,0';
        const e = parseEntry(ln);
        expect(e.radur).toBe(-200);
        expect(e.decdur).toBe(-300);
    });
    it('parses AO row with XStep/YStep overwriting radur/decdur', () => {
        const ln = '5,5.0,"AO",0,0,0,0,0,0,100,E,50,N,7,-3,0,0,0';
        const e = parseEntry(ln);
        expect(e.mount).toBe('AO');
        expect(e.radur).toBe(7);
        expect(e.decdur).toBe(-3);
    });
    it('captures trailing info column with quotes stripped', () => {
        const ln = '9,9.0,"Mount",0,0,0,0,0,0,0,E,0,N,,,0,0,2,"Star lost - low SNR"';
        const e = parseEntry(ln);
        expect(e.err).toBe(2);
        expect(e.info).toBe('Star lost - low SNR');
    });
    it('treats unknown mount string as MOUNT (older logs)', () => {
        const ln = '1,1.0,"My Mount Name",0,0,0,0,0,0,0,E,0,N,,,0,0,0';
        const e = parseEntry(ln);
        expect(e.mount).toBe('MOUNT');
    });
    it('returns null on a malformed row', () => {
        expect(parseEntry('not,a,row')).toBeNull();
    });
});
