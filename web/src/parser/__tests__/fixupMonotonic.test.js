import { describe, it, expect } from 'vitest';
import { fixupNonMonotonic } from '../fixupMonotonic';
import { newGuideSession } from '../types';
const mkEntry = (frame, dt) => ({
    frame, dt, mount: 'MOUNT', included: true, guiding: true,
    dx: 0, dy: 0, raraw: 0, decraw: 0, raguide: 0, decguide: 0,
    radur: 0, decdur: 0, mass: 0, snr: 0, err: 0, info: '',
});
describe('fixupNonMonotonic', () => {
    it('leaves monotonic sessions untouched', () => {
        const s = newGuideSession('x');
        s.entries = [mkEntry(1, 1), mkEntry(2, 2), mkEntry(3, 3)];
        fixupNonMonotonic(s);
        expect(s.entries.map(e => e.dt)).toEqual([1, 2, 3]);
        expect(s.infos.length).toBe(0);
    });
    it('repairs a backward jump using the median positive interval and inserts info event', () => {
        const s = newGuideSession('x');
        s.entries = [
            mkEntry(1, 1), mkEntry(2, 2), mkEntry(3, 3),
            mkEntry(4, 0), mkEntry(5, 1), mkEntry(6, 2),
        ];
        fixupNonMonotonic(s);
        const dts = s.entries.map(e => e.dt);
        for (let i = 1; i < dts.length; i++) {
            expect(dts[i]).toBeGreaterThan(dts[i - 1]);
        }
        expect(s.infos.length).toBe(1);
        expect(s.infos[0].info).toBe('Timestamp jumped backwards');
    });
});
