import { useMemo } from 'react';
import { useLogStore } from '../state/logStore';
import { useViewStore } from '../state/viewStore';
import { calcStats } from '../parser';

const fmt = (n: number, d = 3) => Number.isFinite(n) ? n.toFixed(d) : '—';

export function StatsGrid() {
  const log = useLogStore((s) => s.log);
  const sectionIdx = useLogStore((s) => s.selectedSection);
  const exclusions = useViewStore((s) => s.exclusions);

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

  const rows: [string, string][] = [
    ['RMS Total', `${fmt(s.rmsTotal)} px / ${fmt(s.rmsTotalArcsec)}″`],
    ['RMS RA', `${fmt(s.rmsRa)} px / ${fmt(s.rmsRaArcsec)}″`],
    ['RMS Dec', `${fmt(s.rmsDec)} px / ${fmt(s.rmsDecArcsec)}″`],
    ['Peak RA', fmt(s.peakRa)],
    ['Peak Dec', fmt(s.peakDec)],
    ['Drift RA', `${fmt(s.driftRa)} px/min`],
    ['Drift Dec', `${fmt(s.driftDec)} px/min`],
    ['PAE', `${fmt(s.paeArcMin, 2)}′`],
    ['Included', String(s.includedCount)],
    ['Excluded', String(s.excludedCount)],
    ['Duration', `${Math.round(s.durationSec)} s`],
  ];

  const copy = (val: string) => navigator.clipboard?.writeText(val);

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-3 text-sm">
      {rows.map(([k, v]) => (
        <button
          key={k}
          className="contents text-left hover:opacity-80"
          onClick={() => copy(v)}
          title="Click to copy"
        >
          <span className="text-slate-400">{k}</span>
          <span className="font-mono text-slate-100">{v}</span>
        </button>
      ))}
    </div>
  );
}
