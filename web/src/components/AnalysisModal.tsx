import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalysisStore, type AnalysisKind } from '../state/analysisStore';
import { useViewStore } from '../state/viewStore';
import { useLogStore } from '../state/logStore';
import { usePrimaryPeriodStore } from '../state/primaryPeriodStore';
import { PrimaryPeriodField } from './PrimaryPeriodField';
import { CHIP_TONE, swapTone, type ChipTone } from './chipTones';
import { themeOf } from '../themes';
import { DriftChart } from './DriftChart';
import { PeriodogramChart, FIT_ACTIVE_TRACE_Y } from './PeriodogramChart';
import { SpikeChart } from './SpikeChart';
import { BurstChart, BurstCandidatesTable } from './BurstChart';
import { BurstControls } from './BurstControls';
import { BurstSettleDialog } from './BurstSettleDialog';
import { SimpleSpikeChart } from './SimpleSpikeChart';
import { ManualSpikeChart } from './ManualSpikeChart';
import { manualSpikeStats } from '../parser/manualSpikeAnalysis';
import { fmtNumber } from '../i18n/format';
import type { GARun } from '../parser/analyze';
import { densePeriodogram, curveTopPeaks, primaryPeriod, periodRatio, rampValue } from '../parser/perioPeaks';
import { parseGuideHeader } from '../parser/guideHeader';
import { pickTopSpikePeriods, type SpikeRun } from '../parser/spikeAnalysis';
import { Spline } from '../parser/spline';

// --- Mode-tab accent helpers --------------------------------------------
// The Raw-RA / Residual-error mode tabs are tinted to match their own
// periodogram trace color (themes.ts fftRawRa = teal, fftResidual = amber),
// so the tab visually "owns" the curve it plots. Trace colors are
// theme-aware, so the tab tint changes with the theme too. The banner the
// tabs sit on is always the light amber-200 header, so we contrast-pick the
// label color rather than trusting the raw accent to stay legible.
const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const rgbToHex = (r: number, g: number, b: number): string => {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
};
/** Relative luminance (sRGB, 0..1) — WCAG coefficients. */
const luminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Linear blend of two hex colors; t=0 → a, t=1 → b. */
const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
};
/** Black or near-white, whichever reads better on a filled `bg`. */
const inkOn = (bg: string): string => (luminance(bg) > 0.45 ? '#0f172a' : '#ffffff');
/** A version of `accent` dark enough to read as text on the light banner;
 *  already-deep accents (paper/monochrome) pass through unchanged. */
const inkForLight = (accent: string): string =>
  luminance(accent) > 0.45 ? mix(accent, '#0f172a', 0.5) : accent;

const formatClockUTC = (ms: number | null, dt: number): string => {
  if (ms === null) return '—';
  const t = new Date(ms + dt * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
};

/**
 * Top-N peaks of the periodogram, read from the SAME Akima curve the chart
 * plots (via `densePeriodogram`) rather than the raw FFT bins — so the summary
 * cards and the numbered chips always land on the curve's visible peaks. This
 * mirrors the desktop, which reports the peak the cursor reads off the smooth
 * curve (AnalysisWin.cpp:864-914), not a discrete bin. Peaks above
 * `maxPeriodSec` (drift artefacts) are excluded so they don't dominate.
 */
function topPeaks(garun: GARun, n: number, maxPeriodSec: number): { period: number; amplitude: number }[] {
  const curve = densePeriodogram(garun.fftPeriod, garun.fftSpline);
  return curveTopPeaks(curve, n, maxPeriodSec);
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
    // Spike mode renders SpikeChart, not DriftChart, so the per-sample
    // frame/raw arrays are never read — empty placeholders satisfy the type.
    frame: new Int32Array(0), raRaw: new Float64Array(0), decRaw: new Float64Array(0),
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
  // Theme-aware periodogram trace colors, reused to tint the mode tabs so
  // each tab matches the curve it plots (Raw RA → teal, Residual → amber).
  const themeId = useViewStore((v) => v.theme);
  const tc = themeOf(themeId).plot;
  // Global RA/Dec color preference — the RA/Dec "show" chips track it so they
  // match the guide-section toolbar's RA/Dec buttons (and flip when swapped).
  const swapRaDec = useViewStore((v) => v.swapRaDec);
  // Threshold slider position for Manual Spike auto-select, in arc-sec.
  // Stored as a number; default 0 (the median). Renders a live preview
  // line on the chart so the user can see where Select would cut before
  // committing. Resets to 0 whenever the active axis changes — the y-
  // extent (and therefore the slider's range) depends on the axis.
  const [manualSpikeThresholdArc, setManualSpikeThresholdArc] = useState(0);
  // Show/hide the top (drift / spike) chart. When hidden, the periodogram
  // (also flex-1) is the only chart in the column so it expands to fill.
  const [showTopChart, setShowTopChart] = useState(true);
  const manualSpikeAxisForEffect = s.state === 'open' ? s.manualSpikeAxis : null;
  useEffect(() => {
    setManualSpikeThresholdArc(0);
  }, [manualSpikeAxisForEffect]);
  // Keyboard shortcuts (mode tabs + Esc). Each is the keyboard equivalent of
  // clicking the matching mode tab, and only fires when that tab is actually
  // available — same gating as the tab's render condition. Ignored while a
  // field is focused (e.g. the Max Period / threshold inputs) so typing isn't
  // hijacked:
  //   a → Raw RA, d → Residual error, f → Manual Spike, Esc → close.
  useEffect(() => {
    if (s.state !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (s.state !== 'open') return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'Escape') { if (!typing) s.close(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const hasResidualTabs = s.kind !== 'unguided' && !!s.garunOther;
      const hasManualSpike = s.kind !== 'unguided' && !!s.spikeSource;
      switch (e.key.toLowerCase()) {
        case 'a': if (hasResidualTabs) { s.setKind('all-raw-ra'); e.preventDefault(); } break;
        case 'd': if (hasResidualTabs) { s.setKind('all'); e.preventDefault(); } break;
        case 'f': if (hasManualSpike) { s.setKind('manual-spike'); e.preventDefault(); } break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  // Auto-detected Primary period: the dominant (largest-amplitude) peak <= Max
  // Period on the RAW RA curve, on BOTH tabs (setKind swaps garun/garunOther, so
  // the Raw-RA run is the member with undoRaCorrections === true; unguided has a
  // single curve). This is the FALLBACK — the persisted per-log value wins.
  const autoPrimaryRaw = useMemo<number | null>(() => {
    if (s.state !== 'open') return null;
    if (s.kind === 'spike') return null;
    const rawRa = s.kind === 'unguided'
      ? s.garun
      : s.garun.undoRaCorrections
      ? s.garun
      : s.garunOther && s.garunOther.undoRaCorrections
      ? s.garunOther
      : null;
    if (!rawRa) return null;
    const curve = densePeriodogram(rawRa.fftPeriod, rawRa.fftSpline);
    return primaryPeriod(curve, s.maxPeriodSec);
  }, [s]);

  // Persisted per-log Primary period (one value per guide log; survives section
  // switches + reloads; a different log recomputes). The stored value wins over
  // the auto value; the EFFECTIVE `primaryPeriodSec` below drives both Ratio
  // readouts and the top-3 cap.
  const logHash = useLogStore((l) => l.meta?.hash ?? null);
  // Declination-correction factor for the active guide section: 1/cos(Dec).
  // RA periodic-error amplitudes scale with cos(Dec) as the mount tracks, so
  // dividing by cos(Dec) (× 1/cos) projects the measured guide error back to the
  // value it would have at the celestial equator. Null when the section isn't a
  // guiding section, has no parsed sky Dec, or sits within ~0.001° of a pole
  // (where 1/cos blows up). The Analysis modal opens over the selected section,
  // so `selectedSection` is the analyzed one.
  const log = useLogStore((l) => l.log);
  const selectedSection = useLogStore((l) => l.selectedSection);
  const decCorr = useMemo<{ factor: number; deg: number } | null>(() => {
    if (!log || selectedSection < 0) return null;
    const sec = log.sections[selectedSection];
    if (!sec || sec.type !== 'GUIDING') return null;
    const decStr = parseGuideHeader(log.sessions[sec.idx].hdr).declination;
    if (decStr == null) return null;
    const deg = parseFloat(decStr);
    if (!Number.isFinite(deg)) return null;
    const c = Math.cos((deg * Math.PI) / 180);
    if (Math.abs(c) < 1e-6) return null;
    return { factor: 1 / c, deg };
  }, [log, selectedSection]);
  const primaryRecord = usePrimaryPeriodStore((p) => p.record);
  const primaryLoadedHash = usePrimaryPeriodStore((p) => p.loadedHash);
  const setAutoIfStrongerPrimary = usePrimaryPeriodStore((p) => p.setAutoIfStronger);
  const setEditedPrimary = usePrimaryPeriodStore((p) => p.setEdited);
  const setAutoPrimary = usePrimaryPeriodStore((p) => p.setAuto);
  const primaryPeriodSec = primaryRecord?.value ?? autoPrimaryRaw;

  // How many cycles of the auto primary this section spans (duration ÷ primary).
  // A short section (e.g. one too brief to resolve the ~370s worm) yields a
  // low, unreliable value; the store uses this so a stronger section's auto
  // value can supersede a weaker one's — the per-log Primary tracks the best
  // section, not just the first one opened. Time span is identical on both
  // Raw-RA and Residual runs, so `s.garun.t` is fine here.
  const sectionCycles = useMemo(() => {
    if (s.state !== 'open' || s.kind === 'spike' || autoPrimaryRaw == null || autoPrimaryRaw <= 0) return 0;
    const t = s.garun.t;
    const durationSec = t.length >= 2 ? t[t.length - 1] - t[0] : 0;
    return durationSec / autoPrimaryRaw;
  }, [s, autoPrimaryRaw]);

  // Store this section's auto value if it's a better estimate than what's stored
  // (or nothing is). Gated on loadedHash so we never write before the sidecar
  // read completes. The store keeps user edits and weaker auto values.
  useEffect(() => {
    if (s.state !== 'open' || !logHash) return;
    if (primaryLoadedHash !== logHash || autoPrimaryRaw == null) return;
    void setAutoIfStrongerPrimary(logHash, autoPrimaryRaw, sectionCycles);
  }, [s.state, logHash, primaryLoadedHash, autoPrimaryRaw, sectionCycles, setAutoIfStrongerPrimary]);

  const peaks = useMemo(() => {
    if (s.state !== 'open') return [];
    if (s.kind === 'spike') return [];
    // The top-3 peaks can never be LONGER than the primary period (the dominant
    // PE peak), and never longer than the Max Period filter. Cap at the smaller
    // of the two; fall back to Max Period when there's no primary.
    const cap = primaryPeriodSec != null ? Math.min(primaryPeriodSec, s.maxPeriodSec) : s.maxPeriodSec;
    return topPeaks(s.garun, 3, cap);
  }, [s, primaryPeriodSec]);

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

  // Y-lock fallback max — kept consistent with the first-paint default
  // (FIT_ACTIVE_TRACE_Y). Default: include the counterpart so locking without
  // a prior zoom pins the SAME (Raw-RA) scale the user is looking at. When the
  // switch fits the active tab only, lock to the active trace alone.
  let observedMaxPx = 0;
  const lockRuns = FIT_ACTIVE_TRACE_Y || !activePerioOther
    ? [activePerioRun]
    : [activePerioRun, activePerioOther];
  for (const run of lockRuns) {
    for (let i = 0; i < run.fftAmplitude.length; i++) {
      if (run.fftAmplitude[i] > observedMaxPx) observedMaxPx = run.fftAmplitude[i];
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
    label, active, onClick, title: tip, disabled, tone,
  }: { label: string; active: boolean; onClick: () => void; title?: string; disabled?: boolean; tone?: ChipTone }) => {
    // With a `tone` (the RA/Dec chips), use the shared muted palette so they
    // match the guide-section toolbar. Without one, keep the neutral sky chip.
    const palette = tone ? CHIP_TONE[tone] : null;
    const cls = disabled
      ? 'cursor-not-allowed bg-slate-900 text-slate-600'
      : palette
      ? (active ? palette.active : palette.inactive)
      : active
      ? 'bg-sky-700 text-white hover:bg-sky-600'
      : 'bg-slate-800 text-slate-400 hover:bg-slate-700';
    return (
      <button
        onClick={onClick}
        title={tip}
        disabled={disabled}
        className={`rounded px-2 py-0.5 text-xs transition-colors ${cls}`}
      >
        {label}
      </button>
    );
  };

  // Mode tab. When given an `accent` (the tab's own periodogram trace color),
  // the chip is tinted to match that curve — active = filled with the accent
  // and a contrast-picked label; inactive = a hollow accent-ringed chip with
  // the accent (darkened if needed) as its label color. Without an accent it
  // falls back to the original amber palette (used by Manual Spike), so that
  // tab is visually unchanged. The banner behind the tabs is always the light
  // amber-200 header, hence the contrast-picking.
  const ModeTab = ({
    target, current, label, onClick, tip, accent,
  }: {
    target: AnalysisKind;
    current: AnalysisKind;
    label: string;
    onClick: () => void;
    tip: string;
    accent?: string;
  }) => {
    const active = target === current;
    if (!accent) {
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
    }
    const style: CSSProperties = active
      ? {
          backgroundColor: accent,
          color: inkOn(accent),
          boxShadow: `inset 0 0 0 1px ${mix(accent, '#000000', 0.25)}`,
        }
      : {
          backgroundColor: '#fffdf7',
          color: inkForLight(accent),
          boxShadow: `inset 0 0 0 1px ${accent}`,
        };
    return (
      <button
        type="button"
        onClick={onClick}
        title={tip}
        aria-pressed={active}
        className="rounded px-2 py-0.5 text-xs font-semibold transition-colors"
        style={style}
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
          {/* ANALYSIS wordmark — a prominent area title (not a pill/button),
              with the same chart-peak glyph as the toolbar's Analysis button
              so the modal reads as a continuation of that action. The active
              mode is conveyed by the highlighted tab, not this label. */}
          <div className="flex items-center gap-2" title={t('labelTooltip', { mode: modeLabel })}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="text-amber-800"
            >
              <path d="M3 17l4-6 4 3 5-9 4 7" />
            </svg>
            <h2 className="text-xl font-extrabold uppercase leading-none tracking-wide text-amber-950">
              {t('label')}
            </h2>
          </div>
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
                    onClick={() => s.setKind('all-raw-ra')} tip={`${t('mode.rawRaTooltip')} (a)`}
                    accent={tc.fftRawRa} />
                  <ModeTab target="all" current={kind} label={t('mode.selected')}
                    onClick={() => s.setKind('all')} tip={`${t('mode.selectedTooltip')} (d)`}
                    accent={tc.fftResidual} />
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
                  onClick={() => s.setKind('manual-spike')} tip={`${t('mode.manualSpikeTooltip')} (f)`} />
              )}
            </div>
          )}
          <span className="text-sm text-amber-900" title={t('titleTooltip')}>
            {title}
          </span>
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
          // Slider range — symmetric ± from the larger of |min| / |max|
          // of the detrended-minus-median series, in arc-seconds. A
          // symmetric range gives the slider a natural zero midpoint
          // and keeps both Above (positive) and Below (negative) picks
          // reachable from the same control. Round outward to the
          // nearest 0.01 so the slider step (0.01) lands cleanly on
          // the endpoints.
          let maxAbsArc = 0;
          for (let i = 0; i < manualSpikeRun.detrended.length; i++) {
            const a = Math.abs(manualSpikeRun.detrended[i] - manualSpikeRun.median) * ps;
            if (a > maxAbsArc) maxAbsArc = a;
          }
          maxAbsArc = Math.ceil(maxAbsArc * 100) / 100;
          if (maxAbsArc === 0) maxAbsArc = 0.01; // pathological flat trace — keep slider usable
          const thresholdActive = manualSpikeThresholdArc !== 0 && Number.isFinite(manualSpikeThresholdArc);
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
                {/* Auto-select slider — symmetric ± range covering the
                    chart's full y-extent in arc-sec. Dragging moves a
                    live cyan dashed preview line on the chart; clicking
                    Select commits the line into a pick set (positive →
                    samples at or above; negative → at or below).
                    Replaces (not adds to) the active-axis pick set. */}
                <span className="ms-3 me-1 text-slate-500" title={t('manualSpike.thresholdTooltip')}>
                  {t('manualSpike.threshold')}:
                </span>
                <input
                  type="range"
                  min={-maxAbsArc}
                  max={maxAbsArc}
                  step={0.01}
                  value={manualSpikeThresholdArc}
                  onChange={(e) => setManualSpikeThresholdArc(parseFloat(e.target.value))}
                  className="w-40 cursor-pointer accent-cyan-500"
                  title={t('manualSpike.thresholdSliderTooltip')}
                />
                <span
                  className={`min-w-[3.5rem] font-mono text-xs tabular-nums ${thresholdActive ? 'text-cyan-300' : 'text-slate-500'}`}
                  title={t('manualSpike.thresholdValueTooltip')}
                >
                  {manualSpikeThresholdArc >= 0 ? '+' : ''}{manualSpikeThresholdArc.toFixed(2)}″
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (thresholdActive) s.selectManualSpikePointsByThreshold(manualSpikeThresholdArc);
                  }}
                  disabled={!thresholdActive}
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
                  thresholdLineArc={manualSpikeThresholdArc}
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
            <ToggleChip label="RA" active={showRa} onClick={() => s.setShowRa(!showRa)} title={t('raDriftTooltip')} tone={swapTone('ra', swapRaDec)} />
            <ToggleChip label="Dec" active={showDec} onClick={() => s.setShowDec(!showDec)} title={t('decDriftTooltip')} tone={swapTone('dec', swapRaDec)} />
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
        {/* Show/hide the top (drift / spike) chart. Hidden → the periodogram
            fills the chart column. */}
        <span className="ms-3 me-1 text-slate-500" title={t('topGraphTooltip')}>{t('topGraph')}:</span>
        <ToggleChip
          label={showTopChart ? t('topGraphHide') : t('topGraphShow')}
          active={showTopChart}
          onClick={() => setShowTopChart(!showTopChart)}
          title={t('topGraphTooltip')}
        />
        <span className="ms-auto text-slate-600">
          {t('gestureHint')}
        </span>
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        {showTopChart && (
          <div className="flex-1 border-b border-slate-800">
            {kind === 'spike' && spikeRun ? (
              <SpikeChart run={spikeRun} scaleMode={scaleMode} />
            ) : (
              <DriftChart garun={garun} showRa={showRa} showDec={showDec} scaleMode={scaleMode} />
            )}
          </div>
        )}
        <div className="flex-1">
          <PeriodogramChart
            garun={activePerioRun}
            garunOther={activePerioOther}
            kind={kind}
            scaleMode={scaleMode}
            yMaxLockPx={yMaxLockPx}
            yMaxViewPx={yMaxViewPx}
            topPeaks={kind === 'spike' ? spikePeriods : peaks}
            primaryPeriodSec={primaryPeriodSec}
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
          {kind !== 'spike' && primaryPeriodSec != null && logHash && (
            <PrimaryPeriodField
              value={primaryPeriodSec}
              edited={primaryRecord?.source === 'edited'}
              canReset={autoPrimaryRaw != null}
              onCommit={(v) => void setEditedPrimary(logHash, v)}
              onReset={() => { if (autoPrimaryRaw != null) void setAutoPrimary(logHash, autoPrimaryRaw, sectionCycles); }}
            />
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
                  <div>
                    {t('period')}: {fmtNumber(p.period, 1)}s
                    {primaryPeriodSec !== null && (
                      <>{'  '}{t('ratio')} {fmtNumber(periodRatio(primaryPeriodSec, p.period), 1)}x</>
                    )}
                    {'  '}{t('ramp')} {fmtNumber(rampValue(scaleMode === 'ARCSEC' ? aArc : aPx, p.period), 2)}
                  </div>
                  <div>
                    {t('amplitude')}: {fmtNumber(aArc, 2)}″ ({fmtNumber(aPx, 2)}px)
                    {decCorr && (
                      <span className="text-sky-300/80" title={t('decCorrTooltip', { deg: fmtNumber(decCorr.deg, 1) })}>
                        {'  '}· {t('decCorr')} {fmtNumber(aArc * decCorr.factor, 2)}″ ({fmtNumber(aPx * decCorr.factor, 2)}px)
                      </span>
                    )}
                  </div>
                  <div>
                    {t('pp')}: {fmtNumber(ppArc, 2)}″ ({fmtNumber(ppPx, 2)}px)
                    {decCorr && (
                      <span className="text-sky-300/80" title={t('decCorrTooltip', { deg: fmtNumber(decCorr.deg, 1) })}>
                        {'  '}· {t('decCorr')} {fmtNumber(ppArc * decCorr.factor, 2)}″ ({fmtNumber(ppPx * decCorr.factor, 2)}px)
                      </span>
                    )}
                  </div>
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
