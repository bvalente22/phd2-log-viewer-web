import {
  GUIDING_BEGINS, GUIDING_HEADING, GUIDING_ENDS,
  CALIBRATION_BEGINS, CALIBRATION_HEADING, CALIBRATION_ENDS,
  VERSION_PREFIX, MOUNT_KEY, AO_KEY, PX_SCALE,
  XALGO, YALGO, MINMOVE, INFO_KEY,
  startsWith, isEmpty, rtrim, getDbl, starWasFound,
} from './tokens';
import { newGuideLog, newGuideSession, newCalibration } from './types';
import type {
  GuideLog, GuideSession, Calibration, Mount, Limits,
} from './types';
import { parseEntry } from './parseEntry';
import { parseCalibration, isAoDirectionToken } from './parseCalibration';
import { addInfo } from './parseInfo';
import { fixupNonMonotonic } from './fixupMonotonic';

type State = 'SKIP' | 'GUIDING_HDR' | 'GUIDING' | 'CAL_HDR' | 'CALIBRATING';
type HdrState = 'GLOBAL' | 'AO' | 'MOUNT';

const parseMount = (ln: string, m: Mount): void => {
  m.isValid = true;
  m.xAngle = getDbl(ln, ', xAngle = ', 0.0);
  m.xRate = getDbl(ln, ', xRate = ', 1.0);
  m.yAngle = getDbl(ln, ', yAngle = ', Math.PI / 2);
  m.yRate = getDbl(ln, ', yRate = ', 1.0);
  if (m.xRate < 0.05) m.xRate *= 1000;
  if (m.yRate < 0.05) m.yRate *= 1000;
};

const getMinMo = (ln: string, lim: Limits): void => {
  lim.minMo = getDbl(ln, MINMOVE, 0);
};

const parseIsoCombined = (s: string): number | null => {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  // PHD2 records local wall-clock time at the capture site (no timezone
  // marker in the log). Treat the digits as local time so the chart's
  // clock-time X axis shows the same hh:mm:ss the user saw when they
  // captured the session, regardless of where the log is being viewed
  // now. Matches the original wxWidgets desktop viewer, which uses
  // `wxDateTime` constructed from the log digits (also local time), and
  // is consistent with `filename.ts:37` which already uses local time
  // for the on-disk filename timestamp.
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
};

export function parseLog(text: string): GuideLog {
  const log = newGuideLog();
  let st: State = 'SKIP';
  let hdrst: HdrState = 'GLOBAL';
  let axis: 'X' | 'Y' | '' = '';
  let s: GuideSession | null = null;
  let cal: Calibration | null = null;
  let mountEnabled = false;

  const lines = text.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const ln = rtrim(lines[lineIdx]);

    if (st === 'SKIP') {
      if (startsWith(ln, GUIDING_BEGINS)) {
        st = 'GUIDING_HDR';
        hdrst = 'GLOBAL';
        axis = '';
        mountEnabled = false;
        const date = ln.slice(GUIDING_BEGINS.length);
        const session = newGuideSession(date);
        session.startsMs = parseIsoCombined(date);
        log.sessions.push(session);
        log.sections.push({ type: 'GUIDING', idx: log.sessions.length - 1 });
        s = log.sessions[log.sessions.length - 1];
        continue;
      }
      if (startsWith(ln, CALIBRATION_BEGINS)) {
        st = 'CAL_HDR';
        const date = ln.slice(CALIBRATION_BEGINS.length);
        const c = newCalibration(date);
        c.startsMs = parseIsoCombined(date);
        log.calibrations.push(c);
        log.sections.push({ type: 'CALIBRATION', idx: log.calibrations.length - 1 });
        cal = log.calibrations[log.calibrations.length - 1];
        continue;
      }
      if (startsWith(ln, VERSION_PREFIX)) {
        const start = VERSION_PREFIX.length;
        let end = ln.indexOf(', Log version ', start);
        if (end < 0) {
          const m = ln.slice(start).search(/[ \t\r\n]/);
          end = m < 0 ? ln.length : start + m;
        }
        log.phdVersion = ln.slice(start, end);
      }
      continue;
    }

    if (st === 'GUIDING_HDR' && s) {
      if (startsWith(ln, GUIDING_HEADING)) {
        st = 'GUIDING';
        continue;
      }
      if (startsWith(ln, MOUNT_KEY)) {
        parseMount(ln, s.mount);
        hdrst = 'MOUNT';
        mountEnabled = /, guiding enabled(,|$)/.test(ln);
      } else if (startsWith(ln, AO_KEY)) {
        parseMount(ln, s.ao);
        hdrst = 'AO';
      } else if (startsWith(ln, PX_SCALE)) {
        s.pixelScale = getDbl(ln, 'Pixel scale = ', 1);
      } else if (startsWith(ln, XALGO)) {
        getMinMo(ln, hdrst === 'MOUNT' ? s.mount.xlim : s.ao.xlim);
        axis = 'X';
      } else if (startsWith(ln, YALGO)) {
        getMinMo(ln, hdrst === 'MOUNT' ? s.mount.ylim : s.ao.ylim);
        axis = 'Y';
      } else if (startsWith(ln, MINMOVE)) {
        if (axis === 'X') getMinMo(ln, hdrst === 'MOUNT' ? s.mount.xlim : s.ao.xlim);
        else if (axis === 'Y') getMinMo(ln, hdrst === 'MOUNT' ? s.mount.ylim : s.ao.ylim);
      } else if (ln.includes('Max RA duration = ')) {
        const mnt = hdrst === 'MOUNT' ? s.mount : s.ao;
        mnt.xlim.maxDur = getDbl(ln, 'Max RA duration = ', 0);
        mnt.ylim.maxDur = getDbl(ln, 'Max DEC duration = ', 0);
      } else if (startsWith(ln, 'RA = ')) {
        const decDeg = getDbl(ln, ' hr, Dec = ', 0);
        s.declination = (decDeg * Math.PI) / 180;
        // Hour angle (hours) — presence-checked because 0h is a valid value
        // (the meridian), so a missing field must stay null, not default to 0.
        if (ln.indexOf('Hour angle = ') >= 0) {
          s.hourAngleHours = getDbl(ln, 'Hour angle = ', 0);
        }
        const pi = ln.indexOf('Pier side = ');
        if (pi >= 0) {
          s.pierSide = ln.slice(pi + 'Pier side = '.length).split(',')[0].trim();
        }
      }
      s.hdr.push(ln);
      continue;
    }

    if (st === 'GUIDING' && s) {
      if (isEmpty(ln) || startsWith(ln, GUIDING_ENDS)) {
        if (s.entries.length > 0) {
          s.duration = s.entries[s.entries.length - 1].dt;
        }
        s = null;
        st = 'SKIP';
        continue;
      }
      const c0 = ln.charCodeAt(0);
      if (c0 >= 49 && c0 <= 57) {
        const e = parseEntry(ln);
        if (!e) continue;
        if (!starWasFound(e.err)) {
          e.included = false;
          const synth = e.info || 'Frame dropped';
          addInfo(s.infos, s.entries.length, synth);
          if (!e.info) e.info = synth;
        } else {
          e.included = true;
        }
        e.guiding = mountEnabled;
        s.entries.push(e);
        continue;
      }
      if (startsWith(ln, INFO_KEY)) {
        addInfo(s.infos, s.entries.length, ln.slice(INFO_KEY.length));
        const p = ln.indexOf('MountGuidingEnabled = ');
        if (p >= 0) {
          mountEnabled = ln.slice(p + 22, p + 26) === 'true';
        }
      }
      continue;
    }

    if (st === 'CAL_HDR' && cal) {
      if (startsWith(ln, CALIBRATION_HEADING)) {
        st = 'CALIBRATING';
        continue;
      }
      cal.hdr.push(ln);
      continue;
    }

    if (st === 'CALIBRATING' && cal) {
      if (isEmpty(ln) || startsWith(ln, CALIBRATION_ENDS)) {
        cal = null;
        st = 'SKIP';
        continue;
      }
      const tok = ln.split(',', 1)[0];
      if (['West', 'East', 'Backlash', 'North', 'South', 'Left', 'Up'].includes(tok)) {
        if (isAoDirectionToken(tok)) cal.device = 'AO';
        const e = parseCalibration(ln);
        if (e) cal.entries.push(e);
      } else {
        cal.hdr.push(ln);
      }
      continue;
    }
  }

  if (s) {
    const session = s as GuideSession;
    if (session.entries.length > 0) {
      session.duration = session.entries[session.entries.length - 1].dt;
    }
  }

  for (const sec of log.sections) {
    if (sec.type === 'GUIDING') fixupNonMonotonic(log.sessions[sec.idx]);
  }

  return log;
}
