import { useMemo } from 'react';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';

const fmt = (n: number, d = 3) => Number.isFinite(n) ? n.toFixed(d) : '—';

export function StatsGrid() {
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
    return { stats: calcStats(session, mask) };
  }, [log, sectionIdx, exclusions]);

  if (!stats) return null;
  const s = stats.stats;
  const arcsec = scaleMode === 'ARCSEC';
  const unit = arcsec ? '″' : 'px';
  const v = (px: number, asec: number) => `${fmt(arcsec ? asec : px)} ${unit}`;
  const drift = (px: number, asec: number) => `${fmt(arcsec ? asec : px)} ${unit}/min`;

  const rows: [string, string][] = [
    ['RMS Total', v(s.rmsTotal, s.rmsTotalArcsec)],
    ['RMS RA', v(s.rmsRa, s.rmsRaArcsec)],
    ['RMS Dec', v(s.rmsDec, s.rmsDecArcsec)],
    ['Peak RA', v(s.peakRa, s.peakRa * (s.rmsRaArcsec / (s.rmsRa || 1)))],
    ['Peak Dec', v(s.peakDec, s.peakDec * (s.rmsDecArcsec / (s.rmsDec || 1)))],
    ['Drift RA', drift(s.driftRa, s.driftRaArcsec)],
    ['Drift Dec', drift(s.driftDec, s.driftDecArcsec)],
    ['PAE', `${fmt(s.paeArcMin, 2)}′`],
    ['Included', String(s.includedCount)],
    ['Excluded', String(s.excludedCount)],
    ['Duration', `${Math.round(s.durationSec)} s`],
  ];

  const copy = (val: string) => navigator.clipboard?.writeText(val);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-sm">
      {rows.map(([k, val]) => (
        <button
          key={k}
          className="flex items-baseline gap-2 text-left hover:opacity-80"
          onClick={() => copy(val)}
          title="Click to copy"
        >
          <span className="text-xs text-slate-400">{k}</span>
          <span className="font-mono text-slate-100">{val}</span>
        </button>
      ))}
    </div>
  );
}
