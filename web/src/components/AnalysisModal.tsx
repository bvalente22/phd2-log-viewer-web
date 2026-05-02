import { useEffect } from 'react';
import { useAnalysisStore } from '../state/analysisStore';
import { DriftChart } from './DriftChart';
import { PeriodogramChart } from './PeriodogramChart';

const formatClockUTC = (ms: number | null, dt: number): string => {
  if (ms === null) return '—';
  const t = new Date(ms + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

/**
 * Full-screen analysis overlay. Mounts at the page root so it overlays
 * everything; renders nothing when the analysisStore says state==='closed'.
 */
export function AnalysisModal() {
  const s = useAnalysisStore();
  useEffect(() => {
    if (s.state !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') s.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  if (s.state === 'closed') return null;

  const { garun, kind, showRa, showDec, scaleMode } = s;
  const startClock = formatClockUTC(garun.starts, garun.t[0] ?? 0);
  const endClock = formatClockUTC(garun.starts, garun.t[garun.t.length - 1] ?? 0);
  let title: string;
  if (kind === 'unguided') {
    title = `Analysis · unguided section · frames ${garun.range.begin}-${garun.range.end}`;
  } else if (kind === 'all-raw-ra') {
    title = `Analysis · RA corrections removed · ${garun.t.length} frames · ${startClock} — ${endClock}`;
  } else {
    title = `Analysis · ${garun.t.length} frames · ${startClock} — ${endClock}`;
  }

  const ToggleChip = ({
    label, active, onClick, title: tip,
  }: { label: string; active: boolean; onClick: () => void; title?: string }) => (
    <button
      onClick={onClick}
      title={tip}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        active ? 'bg-sky-700 text-white hover:bg-sky-600' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-2">
        <h2 className="text-sm font-medium" title="Source range and analysis mode for this run">{title}</h2>
        <button
          className="rounded px-2 py-0.5 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          onClick={s.close}
          title="Close the analysis view (Esc)"
        >
          ✕
        </button>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
        <span className="mr-1 text-slate-500" title="Toggle individual drift traces">show:</span>
        <ToggleChip label="RA" active={showRa} onClick={() => s.setShowRa(!showRa)} title="Show/hide drift-corrected RA trace" />
        <ToggleChip label="Dec" active={showDec} onClick={() => s.setShowDec(!showDec)} title="Show/hide drift-corrected Dec trace" />
        <span className="ml-3 mr-1 text-slate-500" title="Y-axis units">scale:</span>
        <ToggleChip label="arc-sec" active={scaleMode === 'ARCSEC'} onClick={() => s.setScaleMode('ARCSEC')} title="Display Y in arc-seconds" />
        <ToggleChip label="pixels" active={scaleMode === 'PIXELS'} onClick={() => s.setScaleMode('PIXELS')} title="Display Y in pixels" />
        <span
          className="ml-auto text-slate-600"
          title="Mouse wheel zooms X around the cursor. Plain drag pans X and zooms Y. Hover the periodogram to snap the cursor to the nearest peak."
        >
          scroll = X zoom · drag = X pan + Y zoom · hover periodogram = peak snap
        </span>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 border-b border-slate-800">
          <DriftChart garun={garun} showRa={showRa} showDec={showDec} scaleMode={scaleMode} />
        </div>
        <div className="flex-1">
          <PeriodogramChart garun={garun} scaleMode={scaleMode} />
        </div>
      </div>
    </div>
  );
}
