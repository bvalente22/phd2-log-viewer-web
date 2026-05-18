import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalysisStore, type AnalysisKind } from '../state/analysisStore';
import { DriftChart } from './DriftChart';
import { PeriodogramChart } from './PeriodogramChart';
import { SpikeChart } from './SpikeChart';
import { BurstChart, BurstCandidatesTable } from './BurstChart';
import { BurstControls } from './BurstControls';
import { BurstSettleDialog } from './BurstSettleDialog';
import { SimpleSpikeChart } from './SimpleSpikeChart';
import { ManualSpikeChart } from './ManualSpikeChart';
import { manualSpikeStats } from '../parser/manualSpikeAnalysis';
import { fmtNumber } from '../i18n/format';
import type { GARun } from '../parser/analyze';
import { pickTopSpikePeriods, type SpikeRun } from '../parser/spikeAnalysis';
import { Spline } from '../parser/spline';

const formatClockUTC = (ms: number | null, dt: number): string => {
  if (ms === null) return '—';
  const t = new Date(ms + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

/**
 * Identify the top-N local-maximum peaks in the periodogram (a[i] > a[i-1] &&
 * a[i] > a[i+1]) and return them sorted by descending amplitude. Skips the
 * boundary samples so we don't flag the edges of the FFT range as "peaks",
 * and skips any peak whose period exceeds `maxPeriodSec` so very-long-period
 * components (drift artefacts) don't dominate the summary.
 */
function topPeaks(garun: GARun, n: number, maxPeriodSec: number): { period: number; amplitude: number }[] {
  const periods = garun.fftPeriod;
  const amps = garun.fftAmplitude;
  const peaks: { period: number; amplitude: number }[] = [];
  for (let i = 1; i < periods.length - 1; i++) {
    if (periods[i] > maxPeriodSec) continue;
    if (amps[i] > amps[i - 1] && amps[i] > amps[i + 1]) {
      peaks.push({ period: periods[i], amplitude: amps[i] });
    }
  }
  peaks.sort((a, b) => b.amplitude - a.amplitude);
  return peaks.slice(0, n);
}

/**
 * Adapter: shape a SpikeRun so it satisfies the GARun interface used by
 * PeriodogramChart. The chart only reads .fftPeriod / .fftAmplitude /
 * .fftSpline / .pixelScale; we fill the rest with placeholders so the
 * type-checker is happy without dragging the spike-specific fields into
 * the chart's prop surface. PeriodogramChart's color/label paths handle
 * `kind === 'spike'` directly.
 */
function spikeAsGARun(run: SpikeRun): GARun {
  return {
    starts: run.starts,
    pixelScale: run.pixelScale,
    range: { begin: 0, end: run.t.length },
    undoRaCorrections: false,
    driftRa: 0, driftDec: 0,
    t: run.t,
    rac: run.values, decc: run.values,
    fftPeriod: run.fftPeriod,
    fftAmplitude: run.fftAmplitude,
    fftAmpMax: run.fftAmpMax,
    fftSpline: run.fftSpline as unknown as Spline,
  } as GARun;
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
  const { t } = useTranslation('analysis');
  const s = useAnalysisStore();
  // Threshold input for Manual Spike auto-select (in arc-seconds). Kept
  // as a string so the user can type a leading "-" or a partial decimal
  // without React clobbering the field. Parsed at Select-click time.
  const [manualSpikeThresholdInput, setManualSpikeThresholdInput] = useState('');
  useEffect(() => {
    if (s.state !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') s.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const peaks = useMemo(() => {
    if (s.state !== 'open') return [];
    if (s.kind === 'spike') return [];
    return topPeaks(s.garun, 3, s.maxPeriodSec);
  }, [s]);

  const spikePeriods = useMemo(() => {
    if (s.state !== 'open') return [];
    if (s.kind !== 'spike' || !s.spikeRun) return [];
    return pickTopSpikePeriods(s.spikeRun, 3, {
      minPeriodSec: s.spikeMinPeriodSec ?? undefined,
    });
  }, [s]);

  if (s.state === 'closed') return null;

  const {
    garun, garunOther, kind, showRa, showDec, scaleMode, maxPeriodSec, yMaxLockPx, yMaxViewPx,
    spikeSource, spikeRun, spikeAxis, spikeDirection, spikeK, spikeMinPeriodSec,
    // burstSource intentionally not destructured — the Bursts tab is
    // hidden, so we don't gate its tab visibility by this anymore.
    burstRun, burstOpts, burstAutoAdjusting, burstAutoBestPct, burstPendingSettle,
    simpleSpikeRun, simpleSpikeAxis, simpleSpikeDirection,
    manualSpikeRun, manualSpikeAxis, manualSpikeSelections,
    useAllFramesForFFT, originalMask,
  } = s;
  // The "all frames" toggle is only meaningful when there's actually a
  // mask to bypass. Hide it otherwise (logs without dithers/settles).
  const hasMask = originalMask !== undefined && originalMask.some((v) => v === 1);
  // The active dataset PeriodogramChart should render. In spike mode we
  // adapt the SpikeRun; otherwise it's the regular GARun pair.
  const activePerioRun: GARun = kind === 'spike' && spikeRun
    ? spikeAsGARun(spikeRun)
    : garun;
  // Counterpart only applies to the residual ↔ raw-RA pair.
  const activePerioOther = kind === 'spike' ? null : garunOther;

  // Y-lock fallback max — pulls from whichever periodogram is active.
  let observedMaxPx = 0;
  for (let i = 0; i < activePerioRun.fftAmplitude.length; i++) {
    if (activePerioRun.fftAmplitude[i] > observedMaxPx) observedMaxPx = activePerioRun.fftAmplitude[i];
  }
  if (activePerioOther) {
    for (let i = 0; i < activePerioOther.fftAmplitude.length; i++) {
      if (activePerioOther.fftAmplitude[i] > observedMaxPx) observedMaxPx = activePerioOther.fftAmplitude[i];
    }
  }

  const startClock = formatClockUTC(garun.starts, garun.t[0] ?? 0);
  const endClock = formatClockUTC(garun.starts, garun.t[garun.t.length - 1] ?? 0);
  // Title is mode-agnostic: it just describes the dataset (frame count
  // + clock range, or unguided frame range). The mode itself is
  // surfaced as the heading "ANALYSIS: <mode>".
  const title = kind === 'unguided'
    ? t('title.unguided', { begin: garun.range.begin, end: garun.range.end })
    : t('title.default', { frames: garun.t.length, start: startClock, end: endClock });
  const modeLabel = kind === 'unguided'
    ? t('mode.unguided')
    : kind === 'all-raw-ra'
    ? t('mode.rawRa')
    : kind === 'spike'
    ? t('mode.spike')
    : kind === 'burst'
    ? t('mode.burst')
    : kind === 'simple-spike'
    ? t('mode.simpleSpike')
    : kind === 'manual-spike'
    ? t('mode.manualSpike')
    : t('mode.selected');
  // 'all' / 'all-raw-ra' tabs always appear when their counterpart is
  // available. Spike / Bursts / Simple Spikes all appear whenever the
  // modal was opened with a spikeSource (i.e. for kind 'all' /
  // 'all-raw-ra'; not for 'unguided'). They all reuse the same source
  // ref — the per-tab pointers in the store are aliases.
  const showResidualTabs = kind !== 'unguided' && !!garunOther;
  // Spike, Burst, and Simple tabs are temporarily hidden — the user
  // wants only Residual / Raw RA / Manual Spike for now. The code,
  // state, and components are all still in place; flip these flags
  // back to the original conditions to restore the tabs.
  const showSpikeTab = false; // kind !== 'unguided' && !!spikeSource;
  const showBurstTab = false; // kind !== 'unguided' && !!burstSource;
  const showSimpleSpikeTab = false; // kind !== 'unguided' && !!spikeSource;
  const showManualSpikeTab = kind !== 'unguided' && !!spikeSource;
  const showAnyTabs = showResidualTabs || showSpikeTab || showBurstTab || showSimpleSpikeTab || showManualSpikeTab;

  const ToggleChip = ({
    label, active, onClick, title: tip, disabled,
  }: { label: string; active: boolean; onClick: () => void; title?: string; disabled?: boolean }) => (
    <button
      onClick={onClick}
      title={tip}
      disabled={disabled}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        disabled
          ? 'cursor-not-allowed bg-slate-900 text-slate-600'
          : active
          ? 'bg-sky-700 text-white hover:bg-sky-600'
          : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );

  // Mode tab — wears the same amber palette as the header so it visually
  // belongs to the heading group, not to the chart toolbar below. Active
  // tab is the saturated amber-700 fill (matches the ANALYSIS pill); the
  // inactive tab is a hollow chip on the amber-200 banner background.
  const ModeTab = ({
    target, current, label, onClick, tip,
  }: {
    target: AnalysisKind;
    current: AnalysisKind;
    label: string;
    onClick: () => void;
    tip: string;
  }) => {
    const active = target === current;
    return (
      <button
        type="button"
        onClick={onClick}
        title={tip}
        aria-pressed={active}
        className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${
          active
            ? 'bg-amber-700 text-amber-50'
            : 'bg-amber-50 text-amber-900 ring-1 ring-amber-600 hover:bg-white'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100">
      {/* Wheat / amber-toned banner — complementary to the sky-blue
          accents used everywhere else in the app, so the modal context
          is visually unmistakable. The leading pill reads
          "ANALYSIS: <mode>"; the tabs to its right let the user flip
          between residual error / raw RA / spikes without going back
          to the chart context menu. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-700 bg-amber-200 px-4 py-3 text-amber-950">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="rounded bg-amber-700 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-50"
            title={t('labelTooltip', { mode: modeLabel })}
          >
            {t('label')}: {modeLabel}
          </span>
          {showAnyTabs && (
            <div className="flex items-center gap-1" role="tablist" aria-label={t('mode.tabsLabel')}>
              {showResidualTabs && (
                <>
                  {/* Tab order: Raw RA first (the default opened tab,
                      matching the desktop's startup view), then Residual
                      error second. Reorder reflects how users typically
                      diagnose PE — read the raw signal first, then
                      compare against the residual-after-correction
                      signal. */}
                  <ModeTab target="all-raw-ra" current={kind} label={t('mode.rawRa')}
                    onClick={() => s.setKind('all-raw-ra')} tip={t('mode.rawRaTooltip')} />
                  <ModeTab target="all" current={kind} label={t('mode.selected')}
                    onClick={() => s.setKind('all')} tip={t('mode.selectedTooltip')} />
                </>
              )}
              {showSpikeTab && (
                <ModeTab target="spike" current={kind} label={t('mode.spike')}
                  onClick={() => s.setKind('spike')} tip={t('mode.spikeTooltip')} />
              )}
              {showBurstTab && (
                <ModeTab target="burst" current={kind} label={t('mode.burst')}
                  onClick={() => s.setKind('burst')} tip={t('mode.burstTooltip')} />
              )}
              {showSimpleSpikeTab && (
                <ModeTab target="simple-spike" current={kind} label={t('mode.simpleSpike')}
                  onClick={() => s.setKind('simple-spike')} tip={t('mode.simpleSpikeTooltip')} />
              )}
              {showManualSpikeTab && (
                <ModeTab target="manual-spike" current={kind} label={t('mode.manualSpike')}
                  onClick={() => s.setKind('manual-spike')} tip={t('mode.manualSpikeTooltip')} />
              )}
            </div>
          )}
          <h2 className="text-sm font-medium" title={t('titleTooltip')}>
            {title}
          </h2>
        </div>
        <button
          className="flex items-center gap-1 rounded bg-amber-50 px-3 py-1 text-sm text-amber-950 ring-1 ring-amber-700 hover:bg-rose-700 hover:text-white hover:ring-rose-600"
          onClick={s.close}
          title={t('closeTooltip')}
        >
          <span className="text-base leading-none">✕</span>
          <span>{t('close')}</span>
          <span className="ms-1 text-xs opacity-70">{t('esc')}</span>
        </button>
      </header>
      {kind === 'manual-spike' && manualSpikeRun ? (
        // Manual Spike tab: same chart layout as Simple but the spike
        // markers come from user clicks (left = add, right = remove).
        // Bottom panel shows the period + amplitude in BIG text.
        (() => {
          // Per-axis selections — switching axis brings up its own pick set.
          const activeSelections = manualSpikeSelections[manualSpikeAxis];
          const otherCount = manualSpikeSelections[manualSpikeAxis === 'ra' ? 'dec' : 'ra'].length;
          const stats = manualSpikeStats(manualSpikeRun, activeSelections);
          const ps = manualSpikeRun.pixelScale;
          const meanArc = stats.meanAmplitude * ps;
          return (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
                <span className="me-1 text-slate-500" title={t('manualSpike.axisTooltip')}>{t('manualSpike.axis')}:</span>
                <ToggleChip label="RA" active={manualSpikeAxis === 'ra'} onClick={() => s.setManualSpikeAxis('ra')} title={t('manualSpike.axisRaTooltip')} />
                <ToggleChip label="Dec" active={manualSpikeAxis === 'dec'} onClick={() => s.setManualSpikeAxis('dec')} title={t('manualSpike.axisDecTooltip')} />
                <span className="ms-3 me-1 text-slate-500" title={t('scaleTooltip')}>{t('scale')}:</span>
                <ToggleChip label="arc-sec" active={scaleMode === 'ARCSEC'} onClick={() => s.setScaleMode('ARCSEC')} title={t('arcsecTooltip')} />
                <ToggleChip label="pixels" active={scaleMode === 'PIXELS'} onClick={() => s.setScaleMode('PIXELS')} title={t('pixelsTooltip')} />
                <button
                  type="button"
                  onClick={s.resetManualSpikePoints}
                  disabled={stats.count === 0 && otherCount === 0}
                  className="ms-3 rounded bg-slate-800 px-3 py-0.5 text-xs text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-rose-700 hover:text-white hover:ring-rose-600 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-600"
                  title={t('manualSpike.resetTooltip')}
                >
                  {t('manualSpike.reset')}
                </button>
                {/* Auto-select-by-threshold: positive values pick samples
                    at or above the threshold; negative values pick at or
                    below. Replaces (not adds to) the active-axis pick set. */}
                <span className="ms-3 me-1 text-slate-500" title={t('manualSpike.thresholdTooltip')}>
                  {t('manualSpike.threshold')}:
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  value={manualSpikeThresholdInput}
                  placeholder={t('manualSpike.thresholdPlaceholder')}
                  onChange={(e) => setManualSpikeThresholdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = parseFloat(manualSpikeThresholdInput);
                      if (Number.isFinite(v) && v !== 0) s.selectManualSpikePointsByThreshold(v);
                    }
                  }}
                  className="w-20 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 ring-1 ring-slate-700 focus:outline-none focus:ring-amber-600"
                  title={t('manualSpike.thresholdInputTooltip')}
                />
                <span className="text-slate-500" title={t('manualSpike.thresholdUnitTooltip')}>″</span>
                <button
                  type="button"
                  onClick={() => {
                    const v = parseFloat(manualSpikeThresholdInput);
                    if (Number.isFinite(v) && v !== 0) s.selectManualSpikePointsByThreshold(v);
                  }}
                  disabled={!Number.isFinite(parseFloat(manualSpikeThresholdInput)) || parseFloat(manualSpikeThresholdInput) === 0}
                  className="rounded bg-slate-800 px-3 py-0.5 text-xs text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-sky-700 hover:text-white hover:ring-sky-600 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-600"
                  title={t('manualSpike.selectTooltip')}
                >
                  {t('manualSpike.select')}
                </button>
                <span className="ms-auto text-slate-600">
                  {t('manualSpike.gestureHint')}
                </span>
              </div>
              <div className="flex flex-1 flex-col overflow-hidden">
                <ManualSpikeChart
                  run={manualSpikeRun}
                  scaleMode={scaleMode}
                  selectedIndices={activeSelections}
                  onAddPoint={s.addManualSpikePoint}
                  onRemovePoint={s.removeManualSpikePoint}
                />
              </div>
              <div className="border-t-2 border-amber-800 bg-slate-900/70 px-4 py-3 text-xs">
                <div className="mb-2 flex items-center gap-3">
                  <span className="font-semibold uppercase tracking-wider text-slate-400">
                    {t('manualSpike.summary')}
                  </span>
                  <span className="text-slate-500">
                    {otherCount > 0
                      ? t('manualSpike.runStatsBothAxes', {
                          count: stats.count,
                          axis: manualSpikeAxis.toUpperCase(),
                          otherCount,
                          otherAxis: (manualSpikeAxis === 'ra' ? 'Dec' : 'RA'),
                        })
                      : t('manualSpike.runStats', { count: stats.count })}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="rounded border border-amber-700/50 bg-slate-900 px-4 py-3 font-mono text-slate-200">
                    <div className="text-[10px] uppercase tracking-wider text-amber-300">
                      {t('manualSpike.periodLabel')}
                    </div>
                    <div className="text-3xl font-bold">
                      {stats.count >= 2 ? `${fmtNumber(stats.meanPeriodSec, 1)}s` : t('manualSpike.periodNone')}
                    </div>
                    {stats.count >= 2 && (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                        <div>{t('manualSpike.medianPeriod', { value: fmtNumber(stats.medianPeriodSec, 1) })}</div>
                        {stats.count >= 3 && (
                          <div>{t('manualSpike.intervalStd', { std: fmtNumber(stats.intervalStdSec, 1) })}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="rounded border border-amber-700/50 bg-slate-900 px-4 py-3 font-mono text-slate-200">
                    <div className="text-[10px] uppercase tracking-wider text-amber-300">
                      {t('manualSpike.amplitudeLabel')}
                    </div>
                    <div className="text-3xl font-bold">
                      {stats.count >= 1
                        ? `${fmtNumber(meanArc, 2)}″ (${fmtNumber(stats.meanAmplitude, 2)}px)`
                        : t('manualSpike.amplitudeNone')}
                    </div>
                    {stats.count >= 2 && (
                      <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                        <div>
                          {t('manualSpike.minAmplitude', {
                            arc: fmtNumber(stats.minAmplitude * ps, 2),
                            px: fmtNumber(stats.minAmplitude, 2),
                          })}
                        </div>
                        <div>
                          {t('manualSpike.maxAmplitude', {
                            arc: fmtNumber(stats.maxAmplitude * ps, 2),
                            px: fmtNumber(stats.maxAmplitude, 2),
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          );
        })()
      ) : kind === 'simple-spike' && simpleSpikeRun ? (
        // Simple Spikes tab: minimal single-chart layout. Toolbar has
        // axis + direction chips + scale; chart fills the body; bottom
        // panel shows just the two summary numbers (period + mean
        // amplitude).
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
            <span className="me-1 text-slate-500" title={t('simpleSpike.axisTooltip')}>{t('simpleSpike.axis')}:</span>
            <ToggleChip label="RA" active={simpleSpikeAxis === 'ra'} onClick={() => s.setSimpleSpikeAxis('ra')} title={t('simpleSpike.axisRaTooltip')} />
            <ToggleChip label="Dec" active={simpleSpikeAxis === 'dec'} onClick={() => s.setSimpleSpikeAxis('dec')} title={t('simpleSpike.axisDecTooltip')} />
            <span className="ms-3 me-1 text-slate-500" title={t('simpleSpike.directionTooltip')}>{t('simpleSpike.direction')}:</span>
            <ToggleChip label="±" active={simpleSpikeDirection === 'both'} onClick={() => s.setSimpleSpikeDirection('both')} title={t('simpleSpike.dirBothTooltip')} />
            <ToggleChip label="+" active={simpleSpikeDirection === 'positive'} onClick={() => s.setSimpleSpikeDirection('positive')} title={t('simpleSpike.dirPositiveTooltip')} />
            <ToggleChip label="−" active={simpleSpikeDirection === 'negative'} onClick={() => s.setSimpleSpikeDirection('negative')} title={t('simpleSpike.dirNegativeTooltip')} />
            <span className="ms-3 me-1 text-slate-500" title={t('scaleTooltip')}>{t('scale')}:</span>
            <ToggleChip label="arc-sec" active={scaleMode === 'ARCSEC'} onClick={() => s.setScaleMode('ARCSEC')} title={t('arcsecTooltip')} />
            <ToggleChip label="pixels" active={scaleMode === 'PIXELS'} onClick={() => s.setScaleMode('PIXELS')} title={t('pixelsTooltip')} />
            <span className="ms-auto text-slate-600">{t('gestureHint')}</span>
          </div>
          <div className="flex flex-1 flex-col overflow-hidden">
            <SimpleSpikeChart run={simpleSpikeRun} scaleMode={scaleMode} />
          </div>
          <div className="border-t-2 border-amber-800 bg-slate-900/70 px-4 py-2 text-xs">
            <div className="mb-1 flex items-center gap-3">
              <span className="font-semibold uppercase tracking-wider text-slate-400">
                {t('simpleSpike.summary')}
              </span>
              <span className="text-slate-500" title={t('simpleSpike.runStatsTooltip')}>
                {t('simpleSpike.runStats', {
                  count: simpleSpikeRun.spikeIndices.length,
                  sigma: fmtNumber(
                    simpleSpikeRun.sigma * (scaleMode === 'ARCSEC' ? simpleSpikeRun.pixelScale : 1),
                    2,
                  ),
                  unit: scaleMode === 'ARCSEC' ? '″' : 'px',
                })}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              <div
                className="rounded border border-amber-700/50 bg-slate-900 px-3 py-1 font-mono text-slate-200"
                title={t('simpleSpike.periodTooltip')}
              >
                <div className="text-[10px] uppercase tracking-wider text-amber-300">{t('simpleSpike.periodLabel')}</div>
                <div className="text-base">
                  {simpleSpikeRun.periodSec > 0
                    ? `${fmtNumber(simpleSpikeRun.periodSec, 1)}s`
                    : t('simpleSpike.periodNone')}
                </div>
              </div>
              <div
                className="rounded border border-amber-700/50 bg-slate-900 px-3 py-1 font-mono text-slate-200"
                title={t('simpleSpike.amplitudeTooltip')}
              >
                <div className="text-[10px] uppercase tracking-wider text-amber-300">{t('simpleSpike.amplitudeLabel')}</div>
                <div className="text-base">
                  {simpleSpikeRun.spikeIndices.length > 0
                    ? `${fmtNumber(simpleSpikeRun.meanAmplitude * simpleSpikeRun.pixelScale, 2)}″ (${fmtNumber(simpleSpikeRun.meanAmplitude, 2)}px)`
                    : t('simpleSpike.amplitudeNone')}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : kind === 'burst' && burstRun && burstOpts ? (
        // Bursts tab: completely different layout — its own controls
        // pane (multi-row knob grid), then a vertically-stacked column
        // of diagnostic charts, then the candidates table at the bottom.
        // The shared toolbar (scale chips + Y-lock) doesn't apply here
        // because burst charts manage their own y-axes.
        <>
          <BurstControls
            opts={burstOpts}
            setOpts={s.setBurstOpts}
            onReset={s.resetBurstOpts}
            onAutoAdjust={s.autoAdjustBurstOpts}
            autoAdjusting={burstAutoAdjusting}
            autoBestPct={burstAutoBestPct}
          />
          {burstPendingSettle && (
            <BurstSettleDialog
              bestPct={burstPendingSettle.bestPct}
              currentPct={burstPendingSettle.currentPct}
              onResolve={s.resolveBurstPendingSettle}
            />
          )}
          <div className="flex flex-1 flex-col overflow-hidden">
            <BurstChart run={burstRun} scaleMode={scaleMode} />
          </div>
          <div className="border-t-2 border-amber-800 bg-slate-900/70 px-4 py-2 text-xs">
            <div className="mb-1 flex items-center gap-3">
              <span className="font-semibold uppercase tracking-wider text-slate-400">
                {t('burst.candidates')}
              </span>
              <span className="text-slate-500" title={t('burst.runStatsTooltip')}>
                {t('burst.runStats', {
                  peaks: burstRun.peakIndices.length,
                  dt: burstRun.dt.toFixed(2),
                })}
              </span>
            </div>
            <BurstCandidatesTable run={burstRun} scaleMode={scaleMode} />
          </div>
        </>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
        {kind === 'spike' ? (
          // Spike mode: RA/Dec become an axis selector (mutex). The
          // sigma slider tunes k; the min-period input filters the
          // top-3 list to drop e.g. PHD2's algorithmic-echo peak.
          <>
            <span className="me-1 text-slate-500" title={t('spike.axisTooltip')}>{t('spike.axis')}:</span>
            <ToggleChip label="RA" active={spikeAxis === 'ra'} onClick={() => s.setSpikeAxis('ra')} title={t('spike.axisRaTooltip')} />
            <ToggleChip label="Dec" active={spikeAxis === 'dec'} onClick={() => s.setSpikeAxis('dec')} title={t('spike.axisDecTooltip')} />
            <span className="ms-3 me-1 text-slate-500" title={t('spike.directionTooltip')}>{t('spike.direction')}:</span>
            <ToggleChip label={t('spike.dirBoth')} active={spikeDirection === 'both'} onClick={() => s.setSpikeDirection('both')} title={t('spike.dirBothTooltip')} />
            <ToggleChip label="+" active={spikeDirection === 'positive'} onClick={() => s.setSpikeDirection('positive')} title={t('spike.dirPositiveTooltip')} />
            <ToggleChip label="−" active={spikeDirection === 'negative'} onClick={() => s.setSpikeDirection('negative')} title={t('spike.dirNegativeTooltip')} />
            <span className="ms-3 me-1 text-slate-500" title={t('spike.kTooltip')}>{t('spike.k')}:</span>
            <input
              type="range" min={1} max={6} step={0.5}
              value={spikeK}
              onChange={(e) => s.setSpikeK(Number(e.target.value))}
              className="h-1 w-32 accent-amber-500"
              title={t('spike.kSliderTooltip')}
            />
            <span className="font-mono text-amber-300">k={spikeK.toFixed(1)}σ</span>
            <span className="ms-3 me-1 text-slate-500" title={t('spike.hiFreqFilterTooltip')}>{t('spike.hiFreqFilter')}:</span>
            <input
              type="range" min={0} max={300} step={1}
              value={spikeMinPeriodSec ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value);
                s.setSpikeMinPeriod(v > 0 ? v : null);
              }}
              className="h-1 w-32 accent-amber-500"
              title={t('spike.hiFreqFilterSliderTooltip')}
            />
            <span className="font-mono text-amber-300">
              {(spikeMinPeriodSec ?? 0) > 0
                ? t('spike.hiFreqFilterValue', { seconds: spikeMinPeriodSec ?? 0 })
                : t('spike.hiFreqFilterOff')}
            </span>
          </>
        ) : (
          <>
            <span className="me-1 text-slate-500" title={t('showTooltip')}>{t('show')}:</span>
            <ToggleChip label="RA" active={showRa} onClick={() => s.setShowRa(!showRa)} title={t('raDriftTooltip')} />
            <ToggleChip label="Dec" active={showDec} onClick={() => s.setShowDec(!showDec)} title={t('decDriftTooltip')} />
          </>
        )}
        <span className="ms-3 me-1 text-slate-500" title={t('scaleTooltip')}>{t('scale')}:</span>
        <ToggleChip label="arc-sec" active={scaleMode === 'ARCSEC'} onClick={() => s.setScaleMode('ARCSEC')} title={t('arcsecTooltip')} />
        <ToggleChip label="pixels" active={scaleMode === 'PIXELS'} onClick={() => s.setScaleMode('PIXELS')} title={t('pixelsTooltip')} />
        {/* "All frames" toggle — bypasses the auto-applied
            dither/settling exclusion mask for the FFT analysis only.
            ON matches the original desktop's default behavior (it
            never auto-applied the mask). Hidden when there's no mask
            to bypass. */}
        {kind !== 'spike' && hasMask && (
          <>
            <span className="ms-3 me-1 text-slate-500" title={t('allFramesTooltip')}>{t('allFrames')}:</span>
            <ToggleChip
              label={useAllFramesForFFT ? t('allFramesOn') : t('allFramesOff')}
              active={useAllFramesForFFT}
              onClick={() => s.setUseAllFramesForFFT(!useAllFramesForFFT)}
              title={useAllFramesForFFT ? t('allFramesOnTooltip') : t('allFramesOffTooltip')}
            />
          </>
        )}
        {/* Periodogram-only Y-axis lock. */}
        <span className="ms-3 me-1 text-slate-500" title={t('yLockTooltip')}>{t('yLock')}:</span>
        <ToggleChip
          label={yMaxLockPx !== null ? t('yLockOn') : t('yLockOff')}
          active={yMaxLockPx !== null}
          onClick={() => s.toggleYLock(observedMaxPx)}
          title={yMaxLockPx !== null ? t('yLockClearTooltip') : t('yLockSetTooltip')}
        />
        <button
          type="button"
          onClick={s.resetYZoom}
          disabled={yMaxLockPx !== null || yMaxViewPx === null}
          className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-600"
          title={t('resetYTooltip')}
        >
          {t('resetY')}
        </button>
        <span className="ms-auto text-slate-600">
          {t('gestureHint')}
        </span>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 border-b border-slate-800">
          {kind === 'spike' && spikeRun ? (
            <SpikeChart run={spikeRun} scaleMode={scaleMode} />
          ) : (
            <DriftChart garun={garun} showRa={showRa} showDec={showDec} scaleMode={scaleMode} />
          )}
        </div>
        <div className="flex-1">
          <PeriodogramChart
            garun={activePerioRun}
            garunOther={activePerioOther}
            kind={kind}
            scaleMode={scaleMode}
            yMaxLockPx={yMaxLockPx}
            yMaxViewPx={yMaxViewPx}
          />
        </div>
      </div>
      {/* Bottom panel — top-3 peaks for residual / raw-RA / unguided
          modes, top-3 spike periods + spike-event metadata for spike
          mode. The "max period" filter only applies to the regular
          peaks view; spike mode uses its own min-period filter from
          the toolbar above. */}
      <div className="border-t-2 border-amber-800 bg-slate-900/70 px-4 py-2 text-xs">
        <div className="mb-1 flex items-center gap-3">
          <span className="font-semibold uppercase tracking-wider text-slate-400">
            {kind === 'spike' ? t('spike.topPeriods') : t('topPeaks')}
          </span>
          {kind !== 'spike' && (
            <label className="flex items-center gap-1 text-slate-400" title={t('maxPeriodTooltip')}>
              <span>{t('maxPeriod')}</span>
              <input
                type="number"
                min={10}
                step={10}
                value={maxPeriodSec}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) s.setMaxPeriodSec(v);
                }}
                className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-slate-200"
              />
              <span>{t('maxPeriodSuffix')}</span>
            </label>
          )}
          {kind === 'spike' && spikeRun && (
            <span className="text-slate-500" title={t('spike.runStatsTooltip')}>
              {t('spike.runStats', {
                count: spikeRun.events.length,
                sigma: fmtNumber(spikeRun.sigma * (scaleMode === 'ARCSEC' ? spikeRun.pixelScale : 1), 2),
                unit: scaleMode === 'ARCSEC' ? '″' : 'px',
              })}
            </span>
          )}
        </div>
        {kind === 'spike' ? (
          spikePeriods.length === 0 ? (
            <div className="text-slate-500">{t('spike.noPeriods')}</div>
          ) : (
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
              {spikePeriods.map((p, i) => {
                // Two amplitudes per pick:
                //   - meanMagnitude: average |deviation| across the
                //     events that align with this period — a typical
                //     spike's actual size.
                //   - amplitude: the periodogram value, normalized by
                //     total event count (= meanMagnitude × aligned
                //     fraction). Ranks peaks but reads small.
                // We surface meanMagnitude as the headline number
                // because it matches the user's mental model
                // ("how big is each spike at this period").
                const ps = spikeRun?.pixelScale ?? 1;
                const meanArc = p.meanMagnitude * ps;
                const meanPx = p.meanMagnitude;
                return (
                  <div
                    key={i}
                    className="rounded border border-amber-700/50 bg-slate-900 px-3 py-1 font-mono text-slate-200"
                    title={t('spike.periodTitle', {
                      index: i + 1,
                      period: fmtNumber(p.period, 1),
                      aligned: p.alignedEvents,
                    })}
                  >
                    <div className="text-[10px] uppercase tracking-wider text-amber-300">{t('peakIndex', { index: i + 1 })}</div>
                    <div>{t('period')}: {fmtNumber(p.period, 1)}s</div>
                    <div>{t('spike.magnitude')}: {fmtNumber(meanArc, 2)}″ ({fmtNumber(meanPx, 2)}px)</div>
                    <div>{t('spike.alignedEvents', { count: p.alignedEvents })}</div>
                  </div>
                );
              })}
            </div>
          )
        ) : peaks.length === 0 ? (
          <div className="text-slate-500">
            {t('noPeaks', { seconds: maxPeriodSec })}
          </div>
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
                  title={t('peakTitle', { index: i + 1, period: fmtNumber(p.period, 1) })}
                >
                  <div className="text-[10px] uppercase tracking-wider text-sky-400">{t('peakIndex', { index: i + 1 })}</div>
                  <div>{t('period')}: {fmtNumber(p.period, 1)}s</div>
                  <div>{t('amplitude')}: {fmtNumber(aArc, 2)}″ ({fmtNumber(aPx, 2)}px)</div>
                  <div>{t('pp')}: {fmtNumber(ppArc, 2)}″ ({fmtNumber(ppPx, 2)}px)</div>
                  <div>{t('rms')}: {fmtNumber(rmsArc, 2)}″ ({fmtNumber(rmsPx, 2)}px)</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
