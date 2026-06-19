import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';
import { fmtNumber, wrapTip } from '../i18n/format';
import { polarAlignmentBand, BAND_CLASSES } from './guidingMetric';
import PolarAlignmentPlot from './PolarAlignmentPlot';
import { computeGlobalPolarAlignment } from '../parser/globalPolarAlignment';

const fmt = (n: number, d = 3) => fmtNumber(n, d);

/**
 * Polar Alignment tab — the per-section PA readout (This Section ⟷ All Sections
 * toggle, total PAE band badge, Alt/Az split, drift / confidence line) plus the
 * bullseye plot. Lifted out of StatsGrid when the guiding footer became tabbed
 * (see docs/superpowers/specs/2026-06-19-tabbed-stats-footer-design.md).
 */
export function PolarAlignmentPanel() {
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
  const drift = (px: number) => `${fmt(arcsec ? px * k : px)} ${unit}${t('guide.perMinSuffix')}`;

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

  const isAll = paView === 'all';
  const g = global;
  // Confidence is still computed (it gates `determinable` below) but no longer
  // shown in the UI — the All-Sections line reports only the section count.
  // values shown in the active mode
  const total = isAll ? (g && g.confidence !== 'insufficient' ? g.totalArcMin : null) : s.paeArcMin;
  const altV = isAll ? (g && g.confidence !== 'insufficient' ? g.altArcMin : null) : s.altArcMin;
  const azV = isAll ? (g && g.confidence !== 'insufficient' ? g.azArcMin : null) : s.azArcMin;
  const bandVal = total ?? 0;
  const determinable = isAll ? !!(g && g.confidence !== 'insufficient') : s.paeDeterminable;
  const haTip = s.effectiveHaHours !== null ? wrapTip(t('pa.effectiveHaTip', { ha: fmt(s.effectiveHaHours, 1) })) : undefined;
  const toggle = () => setPaView((v) => (v === 'section' ? 'all' : 'section'));

  return (
    <div className="flex flex-wrap items-start gap-4 px-4 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          onClick={toggle}
          className="mb-0.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-400 hover:opacity-80"
          title={wrapTip(isAll ? t('pa.allTip', { count: g?.sectionCount ?? 0 }) : t('pa.tooltip'))}
        >
          {t('rows.polarAlign')}
          <span className="inline-flex items-center gap-1 rounded border border-slate-500 bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-100 shadow-sm hover:bg-slate-600">
            {isAll ? t('pa.modeAll') : t('pa.modeSection')}
            <span className="text-slate-400">⟳</span>
          </span>
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

        {/* Line 3: Section → drift; All Sections → section count only */}
        {isAll ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-xs text-slate-500">{g?.sectionCount ?? 0} sections</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Cell k="RA Drift" v={drift(s.driftRa)} />
            <Cell k="Dec Drift" v={drift(s.driftDec)} />
          </div>
        )}
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
