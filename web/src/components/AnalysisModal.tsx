import { useEffect, useMemo } from 'react';
import { useAnalysisStore } from '../state/analysisStore';
import { DriftChart } from './DriftChart';
import { PeriodogramChart } from './PeriodogramChart';
import type { GARun } from '../parser/analyze';

const formatClockUTC = (ms: number | null, dt: number): string => {
  if (ms === null) return '—';
  const t = new Date(ms + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

/**
 * Identify the top-N local-maximum peaks in the periodogram (a[i] > a[i-1] &&
 * a[i] > a[i+1]) and return them sorted by descending amplitude. Skips the
 * boundary samples so we don't flag the edges of the FFT range as "peaks".
 */
function topPeaks(garun: GARun, n: number): { period: number; amplitude: number }[] {
  const periods = garun.fftPeriod;
  const amps = garun.fftAmplitude;
  const peaks: { period: number; amplitude: number }[] = [];
  for (let i = 1; i < periods.length - 1; i++) {
    if (amps[i] > amps[i - 1] && amps[i] > amps[i + 1]) {
      peaks.push({ period: periods[i], amplitude: amps[i] });
    }
  }
  peaks.sort((a, b) => b.amplitude - a.amplitude);
  return peaks.slice(0, n);
}

/**
 * Full-screen analysis overlay. Mounts at the page root so it overlays
 * everything; renders nothing when the analysisStore says state==='closed'.
 *
 * Visual treatment is deliberately heavier than a typical app panel — fully
 * opaque background, a colored banner header, and a prominent "Close" pill —
 * so it's obvious to the user that they're in a modal context separate from
 * the main viewer.
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

  const peaks = useMemo(
    () => (s.state === 'open' ? topPeaks(s.garun, 3) : []),
    [s],
  );

  if (s.state === 'closed') return null;

  const { garun, kind, showRa, showDec, scaleMode } = s;
  const startClock = formatClockUTC(garun.starts, garun.t[0] ?? 0);
  const endClock = formatClockUTC(garun.starts, garun.t[garun.t.length - 1] ?? 0);
  let title: string;
  if (kind === 'unguided') {
    title = `unguided section · frames ${garun.range.begin}-${garun.range.end}`;
  } else if (kind === 'all-raw-ra') {
    title = `RA corrections removed · ${garun.t.length} frames · ${startClock} — ${endClock}`;
  } else {
    title = `${garun.t.length} frames · ${startClock} — ${endClock}`;
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
    // Fully opaque (not /95) so the underlying viewer doesn't bleed through —
    // the user explicitly requested that the analysis screen show only the
    // analysis, hiding the regular chart entirely.
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100">
      {/* Distinct accent banner so the modal is unmistakable. */}
      <header className="flex items-center justify-between border-b-2 border-sky-700 bg-sky-950/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className="rounded bg-sky-700 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white"
            title="You are in the Analysis modal — click 'Close' or press Esc to return"
          >
            Analysis
          </span>
          <h2 className="text-sm font-medium text-slate-200" title="Source range and analysis mode for this run">
            {title}
          </h2>
        </div>
        <button
          className="flex items-center gap-1 rounded bg-slate-800 px-3 py-1 text-sm text-slate-200 ring-1 ring-slate-700 hover:bg-rose-700 hover:text-white hover:ring-rose-600"
          onClick={s.close}
          title="Close the analysis view (Esc)"
        >
          <span className="text-base leading-none">✕</span>
          <span>Close</span>
          <span className="ml-1 text-xs text-slate-400">Esc</span>
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
          scroll = X zoom · drag = X pan + Y zoom · hover = vertical cursor + readout
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
      {/* Top-3 peaks summary. Reads the same FFT result the periodogram is
          drawing — caller can spot the dominant periodic-error contributors
          at a glance without hovering. */}
      <div className="border-t-2 border-sky-800 bg-slate-900/70 px-4 py-2 text-xs">
        <div className="mb-1 font-semibold uppercase tracking-wider text-slate-400">
          Top 3 peaks
        </div>
        {peaks.length === 0 ? (
          <div className="text-slate-500">No periodogram peaks detected (signal may be too short or flat).</div>
        ) : (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
            {peaks.map((p, i) => {
              const aArc = p.amplitude * garun.pixelScale;
              const aPx = p.amplitude;
              const ppArc = 2 * aArc;
              const ppPx = 2 * aPx;
              const rmsArc = aArc / Math.SQRT2;
              const rmsPx = aPx / Math.SQRT2;
              return (
                <div
                  key={i}
                  className="rounded border border-slate-700 bg-slate-900 px-3 py-1 font-mono text-slate-200"
                  title={`Peak ${i + 1}: a periodic-error component at ${p.period.toFixed(1)} second period`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-sky-400">#{i + 1}</div>
                  <div>Period: {p.period.toFixed(1)}s</div>
                  <div>Amplitude: {aArc.toFixed(2)}″ ({aPx.toFixed(2)}px)</div>
                  <div>P-P: {ppArc.toFixed(2)}″ ({ppPx.toFixed(2)}px)</div>
                  <div>RMS: {rmsArc.toFixed(2)}″ ({rmsPx.toFixed(2)}px)</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
