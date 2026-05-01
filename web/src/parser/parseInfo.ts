import type { InfoEntry } from './types';

const SETTLING_PFX = 'SETTLING STATE CHANGE, ';
const PARAM_PFX = 'Guiding parameter change, ';

const beforeLast = (s: string, ch: string): string => {
  const i = s.lastIndexOf(ch);
  return i < 0 ? s : s.slice(0, i);
};

export function addInfo(infos: InfoEntry[], idx: number, raw: string): void {
  let info = raw;

  if (info.startsWith(SETTLING_PFX)) info = info.slice(SETTLING_PFX.length);
  else if (info.startsWith(PARAM_PFX)) info = info.slice(PARAM_PFX.length);

  if (info.startsWith('DITHER')) {
    const p = info.indexOf(', new lock pos');
    if (p >= 0) info = info.slice(0, p);
  }

  if (info.endsWith('00')) {
    info = info.replace(/(\.[0-9]*?)0+$/, '$1');
    if (info.endsWith('.')) info = info.slice(0, -1);
  }

  if (infos.length > 0) {
    const prev = infos[infos.length - 1];

    if (prev.info === info && idx >= prev.idx && idx <= prev.idx + prev.repeats) {
      prev.repeats += 1;
      return;
    }

    if (prev.idx === idx) {
      if (prev.info.includes('=') && info.startsWith(beforeLast(prev.info, '='))) {
        prev.info = info;
        return;
      }
      if (info.startsWith('DITHER') && prev.info.startsWith('SET LOCK POS')) {
        prev.info = info;
        return;
      }
    }
  }

  infos.push({ idx, repeats: 1, info });
}
