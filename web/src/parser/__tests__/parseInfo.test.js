import { describe, it, expect } from 'vitest';
import { addInfo } from '../parseInfo';
describe('addInfo', () => {
    it('strips SETTLING STATE CHANGE prefix', () => {
        const infos = [];
        addInfo(infos, 5, 'SETTLING STATE CHANGE, state=1');
        expect(infos[0].info).toBe('state=1');
    });
    it('strips Guiding parameter change prefix', () => {
        const infos = [];
        addInfo(infos, 5, 'Guiding parameter change, RA aggressiveness = 0.7');
        expect(infos[0].info).toBe('RA aggressiveness = 0.7');
    });
    it('trims DITHER , new lock pos suffix', () => {
        const infos = [];
        addInfo(infos, 5, 'DITHER 0.5, 0.5, new lock pos 1.0,2.0');
        expect(infos[0].info).toBe('DITHER 0.5, 0.5');
    });
    it('strips trailing zeros after last decimal', () => {
        const infos = [];
        addInfo(infos, 5, 'aggressiveness = 0.70000');
        expect(infos[0].info).toBe('aggressiveness = 0.7');
    });
    it('coalesces repeated identical events on adjacent frames', () => {
        const infos = [];
        addInfo(infos, 5, 'Star lost');
        addInfo(infos, 6, 'Star lost');
        addInfo(infos, 7, 'Star lost');
        expect(infos.length).toBe(1);
        expect(infos[0].repeats).toBe(3);
    });
    it('replaces prior parameter-change at same idx when key matches', () => {
        const infos = [];
        addInfo(infos, 5, 'aggressiveness = 0.5');
        addInfo(infos, 5, 'aggressiveness = 0.7');
        expect(infos.length).toBe(1);
        expect(infos[0].info).toBe('aggressiveness = 0.7');
    });
    it('replaces SET LOCK POS with DITHER at same idx', () => {
        const infos = [];
        addInfo(infos, 5, 'SET LOCK POS 1.0, 2.0');
        addInfo(infos, 5, 'DITHER 0.5, 0.5');
        expect(infos.length).toBe(1);
        expect(infos[0].info).toBe('DITHER 0.5, 0.5');
    });
});
