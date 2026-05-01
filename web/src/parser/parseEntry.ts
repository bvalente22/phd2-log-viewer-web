import type { GuideEntry, WhichMount } from './types';

const toLong = (s: string): number | null => {
  if (!s) return null;
  const v = parseInt(s, 10);
  return Number.isFinite(v) ? v : null;
};

const toDouble = (s: string): number | null => {
  if (!s) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

export function parseEntry(ln: string): GuideEntry | null {
  const cols = ln.split(',');
  if (cols.length < 15) return null;

  const frame = toLong(cols[0]);
  if (frame === null) return null;

  const dt = toDouble(cols[1]);
  if (dt === null) return null;

  const mountStr = cols[2];
  let mount: WhichMount;
  if (mountStr === '"Mount"') mount = 'MOUNT';
  else if (mountStr === '"AO"') mount = 'AO';
  else mount = 'MOUNT';

  const numOrZero = (s: string | undefined): number => {
    if (s === undefined || s === '') return 0;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : NaN;
  };

  const dx = numOrZero(cols[3]);
  const dy = numOrZero(cols[4]);
  const raraw = numOrZero(cols[5]);
  const decraw = numOrZero(cols[6]);
  const raguide = numOrZero(cols[7]);
  const decguide = numOrZero(cols[8]);
  if ([dx, dy, raraw, decraw, raguide, decguide].some(Number.isNaN)) return null;

  let radur = cols[9] === '' ? 0 : (() => {
    const v = parseInt(cols[9], 10);
    return Number.isFinite(v) ? v : NaN;
  })();
  if (Number.isNaN(radur)) return null;

  const raDir = cols[10];
  if (raDir) {
    if (raDir[0] === 'E') {
      // positive
    } else if (raDir[0] === 'W') {
      radur = -radur;
    } else {
      return null;
    }
  }

  let decdur = cols[11] === '' ? 0 : (() => {
    const v = parseInt(cols[11], 10);
    return Number.isFinite(v) ? v : NaN;
  })();
  if (Number.isNaN(decdur)) return null;

  const decDir = cols[12];
  if (decDir) {
    if (decDir[0] === 'N') {
      // positive
    } else if (decDir[0] === 'S') {
      decdur = -decdur;
    } else {
      return null;
    }
  }

  if (cols[13] !== undefined && cols[13] !== '') {
    const v = parseInt(cols[13], 10);
    if (!Number.isFinite(v)) return null;
    radur = v;
  }
  if (cols[14] !== undefined && cols[14] !== '') {
    const v = parseInt(cols[14], 10);
    if (!Number.isFinite(v)) return null;
    decdur = v;
  }

  const mass = cols[15] === undefined || cols[15] === '' ? 0 : parseInt(cols[15], 10);
  const snr = cols[16] === undefined || cols[16] === '' ? 0 : parseFloat(cols[16]);
  const err = cols[17] === undefined || cols[17] === '' ? 0 : parseInt(cols[17], 10);
  if ([mass, snr, err].some((v) => !Number.isFinite(v))) return null;

  let info = '';
  if (cols[18] !== undefined && cols[18] !== '') {
    info = cols[18];
    if (info.length >= 2 && info.startsWith('"') && info.endsWith('"')) {
      info = info.slice(1, info.length - 1);
    }
  }

  return {
    frame,
    dt,
    mount,
    included: true,
    guiding: false,
    dx,
    dy,
    raraw,
    decraw,
    raguide,
    decguide,
    radur,
    decdur,
    mass,
    snr,
    err,
    info,
  };
}
