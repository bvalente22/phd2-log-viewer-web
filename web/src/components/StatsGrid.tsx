import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';
import { fmtNumber, fmtInteger, fmtRoundedInt } from '../i18n/format';
import { guidingMetric } from './guidingMetric';

const fmt = (n: number, d = 3) => fmtNumber(n, d);

/** Stats tab of the guiding footer: Total / RA / Dec rows + frame counts.
 *  The Polar Alignment readout used to live here too — it moved to
 *  PolarAlignmentPanel when the footer became tabbed (StatsTabs). */
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

  // RMS comes first in the Total row so the combined RMS lines up
  // visually with the per-axis RMS values that lead the RA / Dec rows
  // — the headline guiding metric reads top-to-bottom in a single
  // column. The cell label uses the bare "RMS" key (same width as the
  // RA / Dec rows) so the values themselves land in the same column;
  // the row label "Total" already provides the disambiguation.
  const arVal = guidingMetric.compute(s.rmsRa, s.rmsDec);
  const common: [string, string][] = [
    [t('guide.rms'), v(s.rmsTotal)],
    [t('guide.duration'), `${fmtRoundedInt(s.durationSec)} ${t('guide.secondsSuffix')}`],
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
    <div className="px-4 py-2 text-sm">
      <div className="flex flex-col gap-1">
        <Row label={t('rows.total')} items={common} />
        <Row label="RA" color="text-sky-400" items={raRow} />
        <Row label="Dec" color="text-rose-400" items={decRow} />

        {/* Frame counts sit just below the RMS rows, smaller and de-emphasized. */}
        <div className="flex flex-wrap gap-x-4 text-[10px] text-slate-500">
          <span>{t('guide.included')}: {fmtInteger(s.includedCount)}</span>
          <span>{t('guide.excluded')}: {fmtInteger(s.excludedCount)}</span>
        </div>
      </div>
    </div>
  );
}
