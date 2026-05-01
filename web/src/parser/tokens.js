export const VERSION_PREFIX = 'PHD2 version ';
export const GUIDING_BEGINS = 'Guiding Begins at ';
export const GUIDING_HEADING = 'Frame,Time,mount';
export const MOUNT_KEY = 'Mount = ';
export const AO_KEY = 'AO = ';
export const PX_SCALE = 'Pixel scale = ';
export const GUIDING_ENDS = 'Guiding Ends';
export const INFO_KEY = 'INFO: ';
export const CALIBRATION_BEGINS = 'Calibration Begins at ';
export const CALIBRATION_HEADING = 'Direction,Step,dx,dy,x,y,Dist';
export const CALIBRATION_ENDS = 'Calibration complete';
export const XALGO = 'X guide algorithm = ';
export const YALGO = 'Y guide algorithm = ';
export const MINMOVE = 'Minimum move = ';
export const startsWith = (s, p) => s.length >= p.length && s.slice(0, p.length) === p;
export const endsWith = (s, p) => s.length >= p.length && s.slice(s.length - p.length) === p;
export const isEmpty = (s) => /^\s*$/.test(s);
export const rtrim = (s) => s.replace(/[\s\r\n]+$/, '');
export const starWasFound = (err) => err === 0 || err === 1;
export const getDbl = (ln, key, dflt) => {
    const i = ln.indexOf(key);
    if (i < 0)
        return dflt;
    const tail = ln.slice(i + key.length);
    const v = parseFloat(tail);
    return Number.isFinite(v) ? v : dflt;
};
