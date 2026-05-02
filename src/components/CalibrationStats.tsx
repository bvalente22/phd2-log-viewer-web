import { useMemo } from 'react';
import { useLogStore } from '../state/logStore';
import type { Calibration, CalibrationEntry } from '../parser';

const fmt = (n: number, d = 2) => Number.isFinite(n) ? n.toFixed(d) : '—';
const fmtAngle = (rad: number) => `${fmt((rad * 180) / Math.PI, 1)}°`;

/**
 * Pull a numeric value following a literal key like ", xRate = " out of the
 * calibration's raw header line. Same approach as CalibrationPlot — the
 * parser keeps `cal.hdr` as raw text rather than splitting it into a Mount
 * struct.
 */
const pullAfter = (line: string, key: string): number | null => {
  const i = line.indexOf(key);
  if (i < 0) return null;
  const v = parseFloat(line.slice(i + key.length));
  return Number.isFinite(v) ? v : null;
};

/**
 * Compute how perpendicular the two calibration axes are. With well-aligned
 * gear, xAngle and yAngle should differ by exactly 90°; orthogonality error
 * is the deviation from that, signed (negative means yAngle "leans into"
 * xAngle, positive means it leans away).
 */
const orthogonalityError = (xAngle: number, yAngle: number): number => {
  // Wrap both into [-pi, pi], then return the difference from pi/2.
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const diff = wrap(yAngle - xAngle);
  return diff - Math.PI / 2;
};

/**
 * Net displacement of the last vs. first step in a direction, used to derive
 * "effective rate" — how many pixels per step the mount is actually moving in
 * that direction (matches what the desktop labels as the rate ratio test).
 */
const netDisplacement = (entries: CalibrationEntry[], dir: CalibrationEntry['direction']) => {
  let first: CalibrationEntry | null = null;
  let last: CalibrationEntry | null = null;
  for (const e of entries) {
    if (e.direction === dir) {
      if (!first) first = e;
      last = e;
    }
  }
  if (!first || !last || first === last) return 0;
  return Math.hypot(last.dx - first.dx, last.dy - first.dy);
};

const directionCount = (cal: Calibration, dir: CalibrationEntry['direction']) =>
  cal.entries.filter((e) => e.direction === dir).length;

export function CalibrationStats() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);

  const stats = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'CALIBRATION') return null;
    const cal = log.calibrations[sec.idx];
    const mountLine = cal.hdr.find((l) => l.startsWith('Mount = ') || l.startsWith('AO = ')) ?? '';
    const xRate = pullAfter(mountLine, ', xRate = ');
    const yRate = pullAfter(mountLine, ', yRate = ');
    const xAngle = pullAfter(mountLine, ', xAngle = ');
    const yAngle = pullAfter(mountLine, ', yAngle = ');

    const orth = xAngle !== null && yAngle !== null
      ? orthogonalityError(xAngle, yAngle)
      : null;
    const rateRatio = xRate !== null && yRate !== null && yRate !== 0 ? xRate / yRate : null;

    return {
      cal,
      device: cal.device,
      xRate, yRate, xAngle, yAngle,
      orth,
      rateRatio,
      counts: {
        WEST: directionCount(cal, 'WEST'),
        EAST: directionCount(cal, 'EAST'),
        BACKLASH: directionCount(cal, 'BACKLASH'),
        NORTH: directionCount(cal, 'NORTH'),
        SOUTH: directionCount(cal, 'SOUTH'),
      },
      netWest: netDisplacement(cal.entries, 'WEST'),
      netNorth: netDisplacement(cal.entries, 'NORTH'),
    };
  }, [log, sectionIdx]);

  if (!stats) return null;

  // Stats grouped by topic, mirroring the layout used for guiding sections.
  const common: { k: string; v: string; tip: string }[] = [
    { k: 'Device', v: stats.device, tip: 'Whether this calibration is for a Mount or an AO unit' },
    { k: 'Steps', v: String(stats.cal.entries.length), tip: 'Total calibration steps recorded' },
    {
      k: 'Orthogonality',
      v: stats.orth !== null ? `${fmt((stats.orth * 180) / Math.PI, 2)}°` : '—',
      tip: 'Deviation of the angle between the RA and Dec axes from 90°. Values within ±5° are usually fine.',
    },
    {
      k: 'Rate ratio',
      v: stats.rateRatio !== null ? fmt(stats.rateRatio, 3) : '—',
      tip: 'xRate / yRate. A ratio far from 1 hints that the mount steps very differently in RA vs. Dec.',
    },
  ];
  const ra: { k: string; v: string; tip: string }[] = [
    {
      k: 'xRate',
      v: stats.xRate !== null ? `${fmt(stats.xRate, 2)} px/s` : '—',
      tip: 'How many pixels the star moves per second of RA pulse',
    },
    {
      k: 'xAngle',
      v: stats.xAngle !== null ? fmtAngle(stats.xAngle) : '—',
      tip: 'Camera-frame angle of the RA axis (0° = horizontal)',
    },
    { k: 'West steps', v: String(stats.counts.WEST), tip: 'Number of West calibration pulses recorded' },
    { k: 'East steps', v: String(stats.counts.EAST), tip: 'Number of East calibration pulses recorded' },
    { k: 'Net W travel', v: `${fmt(stats.netWest)} px`, tip: 'Distance from the first to the last West step' },
  ];
  const dec: { k: string; v: string; tip: string }[] = [
    {
      k: 'yRate',
      v: stats.yRate !== null ? `${fmt(stats.yRate, 2)} px/s` : '—',
      tip: 'How many pixels the star moves per second of Dec pulse',
    },
    {
      k: 'yAngle',
      v: stats.yAngle !== null ? fmtAngle(stats.yAngle) : '—',
      tip: 'Camera-frame angle of the Dec axis (should differ from xAngle by ~90°)',
    },
    { k: 'North steps', v: String(stats.counts.NORTH), tip: 'Number of North calibration pulses recorded' },
    { k: 'South steps', v: String(stats.counts.SOUTH), tip: 'Number of South calibration pulses recorded' },
    { k: 'Backlash', v: String(stats.counts.BACKLASH), tip: 'Number of backlash-detection steps' },
    { k: 'Net N travel', v: `${fmt(stats.netNorth)} px`, tip: 'Distance from the first to the last North step' },
  ];

  const Cell = ({ k, v, tip }: { k: string; v: string; tip: string }) => (
    <button
      className="flex items-baseline gap-2 text-left hover:opacity-80"
      onClick={() => navigator.clipboard?.writeText(v)}
      title={`${k}: ${v} — ${tip}. Click to copy.`}
    >
      <span className="text-xs text-slate-400">{k}</span>
      <span className="font-mono text-slate-100">{v}</span>
    </button>
  );

  const Row = ({ label, color, items }: {
    label: string; color?: string; items: { k: string; v: string; tip: string }[];
  }) => (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
      <span className={`w-12 text-xs font-semibold uppercase tracking-wide ${color ?? 'text-slate-400'}`}>{label}</span>
      {items.map((it) => <Cell key={it.k} {...it} />)}
    </div>
  );

  return (
    <div className="flex flex-col gap-1 px-4 py-2 text-sm">
      <Row label="Total" items={common} />
      <Row label="RA" color="text-sky-400" items={ra} />
      <Row label="Dec" color="text-rose-400" items={dec} />
    </div>
  );
}
