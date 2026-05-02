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
    return { stats: calcStats(session, mask), pixelScale: session.pixelScale };
  }, [log, sectionIdx, exclusions]);

  if (!stats) return null;
  const s = stats.stats;
  const k = stats.pixelScale;
  const arcsec = scaleMode === 'ARCSEC';
  const unit = arcsec ? '″' : 'px';
  const v = (px: number) => `${fmt(arcsec ? px * k : px)} ${unit}`;
  const drift = (px: number) => `${fmt(arcsec ? px * k : px)} ${unit}/min`;

  const common: [string, string][] = [
    ['Duration', `${Math.round(s.durationSec)} s`],
    ['Included', String(s.includedCount)],
    ['Excluded', String(s.excludedCount)],
    ['RMS Total', v(s.rmsTotal)],
    ['PAE', `${fmt(s.paeArcMin, 2)}′`],
  ];
  const raRow: [string, string][] = [
    ['RMS', v(s.rmsRa)],
    ['Peak', v(s.peakRa)],
    ['Mean', v(s.meanRa)],
    ['Drift', drift(s.driftRa)],
  ];
  const decRow: [string, string][] = [
    ['RMS', v(s.rmsDec)],
    ['Peak', v(s.peakDec)],
    ['Mean', v(s.meanDec)],
    ['Drift', drift(s.driftDec)],
  ];

  const copy = (val: string) => navigator.clipboard?.writeText(val);

  const Cell = ({ k: label, v: val }: { k: string; v: string }) => (
    <button
      className="flex items-baseline gap-2 text-left hover:opacity-80"
      onClick={() => copy(val)}
      title={`${label}: ${val} — click to copy`}
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

  return (
    <div className="flex flex-col gap-1 px-4 py-2 text-sm">
      <Row label="Total" items={common} />
      <Row label="RA" color="text-sky-400" items={raRow} />
      <Row label="Dec" color="text-rose-400" items={decRow} />
    </div>
  );
}
