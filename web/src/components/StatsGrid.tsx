import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';
import { fmtNumber, fmtInteger, fmtRoundedInt } from '../i18n/format';
import { guidingMetric, polarAlignmentBand, BAND_CLASSES } from './guidingMetric';
import PolarAlignmentPlot from './PolarAlignmentPlot';

const fmt = (n: number, d = 3) => fmtNumber(n, d);

export function StatsGrid() {
  const { t } = useTranslation('stats');
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);
  const scaleMode = useViewStore((s) => s.scaleMode);

  const stats = useMemo(() => {
    if (!log || sectionIdx < 0) return null;
    const sec = log.sections[sectionIdx];
    if (!sec || sec.type !== 'GUIDING') return null;
    const session = log.sessions[sec.idx];
    const mask = exclusions.get(sec.idx);
    return { stats: calcStats(session, mask), pixelScale: session.pixelScale };
  }, [log, sectionIdx, exclusions]);

  if (!stats) return null;
  const s = stats.stats;
  const k = stats.pixelScale;
  const arcsec = scaleMode === 'ARCSEC';
  const unit = arcsec ? '″' : 'px';
  const v = (px: number) => `${fmt(arcsec ? px * k : px)} ${unit}`;
  const drift = (px: number) => `${fmt(arcsec ? px * k : px)} ${unit}${t('guide.perMinSuffix')}`;

  // RMS comes first in the Total row so the combined RMS lines up
  // visually with the per-axis RMS values that lead the RA / Dec rows
  // — the headline guiding metric reads top-to-bottom in a single
  // column. The cell label uses the bare "RMS" key (same width as the
  // RA / Dec rows) so the values themselves land in the same column;
  // the row label "Total" already provides the disambiguation.
  // duration / included / excluded / pae trail behind in their
  // previous order.
  const arVal = guidingMetric.compute(s.rmsRa, s.rmsDec);
  const common: [string, string][] = [
    [t('guide.rms'), v(s.rmsTotal)],
    [t('guide.duration'), `${fmtRoundedInt(s.durationSec)} ${t('guide.secondsSuffix')}`],
    [t('guide.included'), fmtInteger(s.includedCount)],
    [t('guide.excluded'), fmtInteger(s.excludedCount)],
    [t(guidingMetric.labelKey), arVal === null ? '—' : fmt(arVal, 2)],
  ];
  const raRow: [string, string][] = [
    [t('guide.rms'), v(s.rmsRa)],
    [t('guide.peak'), v(s.peakRa)],
    [t('guide.mean'), v(s.meanRa)],
  ];
  const decRow: [string, string][] = [
    [t('guide.rms'), v(s.rmsDec)],
    [t('guide.peak'), v(s.peakDec)],
    [t('guide.mean'), v(s.meanDec)],
  ];

  const hasHa = s.hourAngleHours !== null;
  const paBand = polarAlignmentBand(s.paeArcMin);
  // "!" marker shown on a low-confidence axis (only meaningful when HA exists).
  const altWarn = hasHa && !s.altTrust;
  const azWarn = hasHa && !s.azTrust;
  const fmtPa = (n: number | null) => (n === null ? '—' : `${fmt(n, 2)}′`);

  const copy = (val: string) => navigator.clipboard?.writeText(val);

  const Cell = ({ k: label, v: val }: { k: string; v: string }) => (
    <button
      className="flex items-baseline gap-2 text-start hover:opacity-80"
      onClick={() => copy(val)}
      title={t('copyTooltip', { label, value: val })}
    >
      <span className="text-xs text-slate-400">{label}</span>
      <span className="font-mono text-slate-100">{val}</span>
    </button>
  );

  const Row = ({ label, color, items }: { label: string; color?: string; items: [string, string][] }) => (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
      <span className={`w-12 text-xs font-semibold uppercase tracking-wide ${color ?? 'text-slate-400'}`}>{label}</span>
      {items.map(([k, val]) => <Cell key={k} k={k} v={val} />)}
    </div>
  );

  // RA / Dec are PHD2 jargon — kept in English across all locales.
  return (
    <div className="flex flex-wrap items-start gap-4 px-4 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Row label={t('rows.total')} items={common} />
        <Row label="RA" color="text-sky-400" items={raRow} />
        <Row label="Dec" color="text-rose-400" items={decRow} />

        {/* Polar Alignment — its own subtitled area beneath total/ra/dec. */}
        <div className="mt-1 border-t border-slate-700/60 pt-1">
          <div className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-violet-400" title={t('pa.tooltip')}>
            {t('rows.polarAlign')}
          </div>
          {/* Line 1: total PAE, stoplight-coloured badge */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {s.paeDeterminable ? (
              <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${BAND_CLASSES[paBand]}`}>
                {`${fmt(s.paeArcMin, 2)}′`}
              </span>
            ) : (
              <span className="font-mono text-xs text-slate-400">—</span>
            )}
          </div>
          {/* Line 2: Alt / Az contributions with low-confidence markers */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Alt</span>
              <span className="font-mono text-slate-100">{fmtPa(s.altArcMin)}</span>
              {altWarn && <span className="cursor-help font-bold text-amber-400" title={t('pa.altLowConf')}>!</span>}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Az</span>
              <span className="font-mono text-slate-100">{fmtPa(s.azArcMin)}</span>
              {azWarn && <span className="cursor-help font-bold text-amber-400" title={t('pa.azLowConf')}>!</span>}
            </span>
          </div>
          {/* Line 3: RA / Dec drift (input to the calculation) */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Cell k="RA Drift" v={drift(s.driftRa)} />
            <Cell k="Dec Drift" v={drift(s.driftDec)} />
          </div>
        </div>
      </div>

      <PolarAlignmentPlot
        paeTotal={s.paeArcMin}
        altArcMin={s.altArcMin}
        azArcMin={s.azArcMin}
        altTrust={s.altTrust}
        azTrust={s.azTrust}
        hasHa={hasHa}
        determinable={s.paeDeterminable}
      />
    </div>
  );
}
