import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';
import { fmtNumber, fmtInteger, fmtRoundedInt, wrapTip } from '../i18n/format';
import { guidingMetric, polarAlignmentBand, BAND_CLASSES } from './guidingMetric';
import PolarAlignmentPlot from './PolarAlignmentPlot';
import { computeGlobalPolarAlignment } from '../parser/globalPolarAlignment';

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

  const global = useMemo(
    () => (log ? computeGlobalPolarAlignment(log, exclusions) : null),
    [log, exclusions],
  );
  const [paView, setPaView] = useState<'section' | 'all'>('section');

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

  const isAll = paView === 'all';
  const g = global;
  const confKey = g ? `pa.conf${g.confidence[0].toUpperCase()}${g.confidence.slice(1)}` : 'pa.confInsufficient';
  const confColor = g?.confidence === 'high' ? 'text-emerald-400'
    : g?.confidence === 'medium' ? 'text-amber-300'
    : g?.confidence === 'low' ? 'text-rose-400' : 'text-slate-400';
  // values shown in the active mode
  const total = isAll ? (g && g.confidence !== 'insufficient' ? g.totalArcMin : null) : s.paeArcMin;
  const altV = isAll ? (g && g.confidence !== 'insufficient' ? g.altArcMin : null) : s.altArcMin;
  const azV = isAll ? (g && g.confidence !== 'insufficient' ? g.azArcMin : null) : s.azArcMin;
  const bandVal = total ?? 0;
  const determinable = isAll ? !!(g && g.confidence !== 'insufficient') : s.paeDeterminable;
  const haTip = s.effectiveHaHours !== null ? wrapTip(t('pa.effectiveHaTip', { ha: fmt(s.effectiveHaHours, 1) })) : undefined;
  const toggle = () => setPaView((v) => (v === 'section' ? 'all' : 'section'));

  // RA / Dec are PHD2 jargon — kept in English across all locales.
  return (
    <div className="flex flex-wrap items-start gap-4 px-4 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Row label={t('rows.total')} items={common} />
        <Row label="RA" color="text-sky-400" items={raRow} />
        <Row label="Dec" color="text-rose-400" items={decRow} />

        {/* Polar Alignment — one toggling area (Section ⟷ All Sections) */}
        <div className="mt-1 border-t border-slate-700/60 pt-1">
          <button
            type="button"
            onClick={toggle}
            className="mb-0.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-400 hover:opacity-80"
            title={wrapTip(isAll ? t('pa.allTip', { count: g?.sectionCount ?? 0 }) : t('pa.tooltip'))}
          >
            {t('rows.polarAlign')}
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-100">
              {isAll ? t('pa.modeAll') : t('pa.modeSection')}
            </span>
            <span className="text-[10px] text-slate-500">⟳</span>
          </button>

          {/* Line 1: total */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {determinable
              ? <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${BAND_CLASSES[polarAlignmentBand(bandVal)]}`}>{`${fmt(bandVal, 2)}′`}</span>
              : <span className="font-mono text-xs text-slate-400">—</span>}
          </div>

          {/* Line 2: Alt / Az (section shows "!" markers; All Sections does not) */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Alt</span>
              <span className="font-mono text-slate-100">{altV === null ? '—' : `${fmt(altV, 2)}′`}</span>
              {!isAll && hasHa && !s.altTrust && <span className="cursor-help font-bold text-amber-400" title={wrapTip(t('pa.altLowConf'))}>!</span>}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">Az</span>
              <span className="font-mono text-slate-100">{azV === null ? '—' : `${fmt(azV, 2)}′`}</span>
              {!isAll && hasHa && !s.azTrust && <span className="cursor-help font-bold text-amber-400" title={wrapTip(t('pa.azLowConf'))}>!</span>}
            </span>
          </div>

          {/* Line 3: Section → drift; All Sections → confidence */}
          {isAll ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm" title={wrapTip(t(`pa.confTip${(g?.confidence ?? 'insufficient')[0].toUpperCase()}${(g?.confidence ?? 'insufficient').slice(1)}`, { spread: fmt(g?.haSpreadHours ?? 0, 1) }))}>
              <span className="flex items-baseline gap-2">
                <span className="text-xs text-slate-400">{t('pa.confidence')}</span>
                <span className={`font-mono font-semibold ${confColor}`}>{t(confKey)}</span>
              </span>
              <span className="text-xs text-slate-500">· {g?.sectionCount ?? 0} sections</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <Cell k="RA Drift" v={drift(s.driftRa)} />
              <Cell k="Dec Drift" v={drift(s.driftDec)} />
            </div>
          )}
        </div>
      </div>

      {/* The bullseye toggles with the area */}
      <button type="button" onClick={toggle} className="shrink-0" title={wrapTip(isAll ? t('pa.allTip', { count: g?.sectionCount ?? 0 }) : t('pa.tooltip'))}>
        <PolarAlignmentPlot
          paeTotal={bandVal}
          altArcMin={altV}
          azArcMin={azV}
          altTrust={isAll ? true : s.altTrust}
          azTrust={isAll ? true : s.azTrust}
          hasHa={isAll ? false : hasHa}
          determinable={determinable}
          titleText={isAll ? t('pa.allTip', { count: g?.sectionCount ?? 0 }) : (haTip ? t('pa.effectiveHaTip', { ha: fmt(s.effectiveHaHours ?? 0, 1) }) : t('pa.tooltip'))}
        />
      </button>
    </div>
  );
}
