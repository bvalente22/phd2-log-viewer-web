import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { fmtNumber, fmtInteger } from '../i18n/format';
import type { Calibration, CalibrationEntry } from '../parser';

const fmt = (n: number, d = 2) => fmtNumber(n, d);
const fmtAngle = (rad: number) => `${fmt((rad * 180) / Math.PI, 1)}°`;

/**
 * Pull a numeric value following a literal key like ", xRate = " out of a
 * raw header line.
 */
const pullAfter = (line: string, key: string): number | null => {
  const i = line.indexOf(key);
  if (i < 0) return null;
  const v = parseFloat(line.slice(i + key.length));
  return Number.isFinite(v) ? v : null;
};

/**
 * PHD2's calibration *header* doesn't store xRate/yRate/xAngle/yAngle — the
 * whole point of running calibration is to determine those values, which then
 * appear later in the guiding session's mount header. We therefore compute the
 * rates and angles directly from the entries here, replicating the geometry
 * the desktop app uses to draw the calibration plot's RA/Dec axis lines (see
 * LogViewFrame.cpp:1422-1437):
 *
 *   - The RA axis runs from the first West step (step 0, at the origin) to
 *     the last West step. Its angle in the camera frame is atan2(dy, dx).
 *   - Likewise for Dec using North steps.
 *   - The rate (px/sec) is the distance divided by total pulse time, where
 *     each step is the "Calibration Step = N ms" value parsed from the
 *     header. If we can't find the step duration we fall back to per-step
 *     pixel speed (px/step) so the field still surfaces something useful.
 */
interface AxisFit {
  rate: number;       // pixels per second (or per step if no duration)
  unit: string;       // "px/s" when we have step ms, otherwise "px/step"
  angle: number;      // radians, atan2(dy, dx) of the net displacement
  pulses: number;     // total step count covered
  distance: number;   // net pixel distance from first to last
}

const fitAxis = (
  entries: CalibrationEntry[],
  dir: CalibrationEntry['direction'],
  stepMs: number | null,
): AxisFit | null => {
  let first: CalibrationEntry | null = null;
  let last: CalibrationEntry | null = null;
  for (const e of entries) {
    if (e.direction === dir) {
      if (!first) first = e;
      last = e;
    }
  }
  if (!first || !last || first === last) return null;
  const ddx = last.dx - first.dx;
  const ddy = last.dy - first.dy;
  const distance = Math.hypot(ddx, ddy);
  const pulses = last.step - first.step;
  if (pulses <= 0) return null;
  const angle = Math.atan2(ddy, ddx);
  if (stepMs && stepMs > 0) {
    const totalSec = (pulses * stepMs) / 1000;
    return { rate: distance / totalSec, unit: 'px/s', angle, pulses, distance };
  }
  return { rate: distance / pulses, unit: 'px/step', angle, pulses, distance };
};

const directionCount = (cal: Calibration, dir: CalibrationEntry['direction']) =>
  cal.entries.filter((e) => e.direction === dir).length;

/**
 * Orthogonality error: how far off-perpendicular the two computed axes are.
 * Ideal mount geometry has yAngle - xAngle = ±90°; we report the deviation
 * from 90° (always returning a value in (-π/2, π/2]).
 */
const orthogonalityError = (xAngle: number, yAngle: number): number => {
  let diff = yAngle - xAngle;
  // Wrap into (-pi, pi] then collapse to a 90° comparison regardless of
  // direction sign so a -90° and a +90° both read as "perfectly orthogonal".
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff <= -Math.PI) diff += 2 * Math.PI;
  const absDiff = Math.abs(diff);
  return absDiff - Math.PI / 2;
};

export function CalibrationStats() {
  const { t } = useTranslation('stats');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);

  const stats = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'CALIBRATION') return null;
    const cal = log.calibrations[sec.idx];
    // Calibration step duration appears on the Mount line as
    // "Calibration Step = 450 ms".
    const mountLine = cal.hdr.find((l) => l.includes('Calibration Step = ')) ?? '';
    const stepMs = pullAfter(mountLine, 'Calibration Step = ');

    const xFit = fitAxis(cal.entries, 'WEST', stepMs);
    const yFit = fitAxis(cal.entries, 'NORTH', stepMs);

    const orth = xFit && yFit ? orthogonalityError(xFit.angle, yFit.angle) : null;
    const rateRatio = xFit && yFit && yFit.rate !== 0 ? xFit.rate / yFit.rate : null;

    return {
      cal,
      stepMs,
      xFit,
      yFit,
      orth,
      rateRatio,
      counts: {
        WEST: directionCount(cal, 'WEST'),
        EAST: directionCount(cal, 'EAST'),
        BACKLASH: directionCount(cal, 'BACKLASH'),
        NORTH: directionCount(cal, 'NORTH'),
        SOUTH: directionCount(cal, 'SOUTH'),
      },
    };
  }, [log, sectionIdx]);

  if (!stats) return null;

  const fmtRate = (fit: AxisFit | null): string =>
    fit ? `${fmt(fit.rate, 3)} ${fit.unit}` : '—';
  const fmtRateAngle = (fit: AxisFit | null): string =>
    fit ? fmtAngle(fit.angle) : '—';

  const common: { k: string; v: string; tip: string }[] = [
    { k: t('calibration.device'), v: stats.cal.device, tip: t('calibration.deviceTooltip') },
    { k: t('calibration.steps'), v: fmtInteger(stats.cal.entries.length), tip: t('calibration.stepsTooltip') },
    {
      k: t('calibration.stepDur'),
      v: stats.stepMs !== null ? `${fmt(stats.stepMs, 0)} ${t('calibration.msSuffix')}` : '—',
      tip: t('calibration.stepDurTooltip'),
    },
    {
      k: t('calibration.orthogonality'),
      v: stats.orth !== null ? `${fmt((stats.orth * 180) / Math.PI, 2)}°` : '—',
      tip: t('calibration.orthogonalityTooltip'),
    },
    {
      k: t('calibration.rateRatio'),
      v: stats.rateRatio !== null ? fmt(stats.rateRatio, 3) : '—',
      tip: t('calibration.rateRatioTooltip'),
    },
  ];
  const ra: { k: string; v: string; tip: string }[] = [
    { k: t('calibration.xRate'), v: fmtRate(stats.xFit), tip: t('calibration.xRateTooltip') },
    { k: t('calibration.xAngle'), v: fmtRateAngle(stats.xFit), tip: t('calibration.xAngleTooltip') },
    {
      k: t('calibration.wTravel'),
      v: stats.xFit
        ? t('calibration.travelLabel', { distance: fmt(stats.xFit.distance, 2), pulses: fmtInteger(stats.xFit.pulses) })
        : '—',
      tip: t('calibration.wTravelTooltip'),
    },
    { k: t('calibration.west'), v: fmtInteger(stats.counts.WEST), tip: t('calibration.westTooltip') },
    { k: t('calibration.east'), v: fmtInteger(stats.counts.EAST), tip: t('calibration.eastTooltip') },
  ];
  const dec: { k: string; v: string; tip: string }[] = [
    { k: t('calibration.yRate'), v: fmtRate(stats.yFit), tip: t('calibration.yRateTooltip') },
    { k: t('calibration.yAngle'), v: fmtRateAngle(stats.yFit), tip: t('calibration.yAngleTooltip') },
    {
      k: t('calibration.nTravel'),
      v: stats.yFit
        ? t('calibration.travelLabel', { distance: fmt(stats.yFit.distance, 2), pulses: fmtInteger(stats.yFit.pulses) })
        : '—',
      tip: t('calibration.nTravelTooltip'),
    },
    { k: t('calibration.north'), v: fmtInteger(stats.counts.NORTH), tip: t('calibration.northTooltip') },
    { k: t('calibration.south'), v: fmtInteger(stats.counts.SOUTH), tip: t('calibration.southTooltip') },
    { k: t('calibration.backlash'), v: fmtInteger(stats.counts.BACKLASH), tip: t('calibration.backlashTooltip') },
  ];

  const Cell = ({ k, v, tip }: { k: string; v: string; tip: string }) => (
    <button
      className="flex items-baseline gap-2 text-start hover:opacity-80"
      onClick={() => navigator.clipboard?.writeText(v)}
      title={t('copyTooltipDetailed', { label: k, value: v, tip })}
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

  // RA / Dec are PHD2 jargon — kept in English across all locales.
  return (
    <div className="flex flex-col gap-1 px-4 py-2 text-sm">
      <Row label={t('rows.total')} items={common} />
      <Row label="RA" color="text-sky-400" items={ra} />
      <Row label="Dec" color="text-rose-400" items={dec} />
    </div>
  );
}
