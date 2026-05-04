import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalysisStore } from '../state/analysisStore';
import { DriftChart } from './DriftChart';
import { PeriodogramChart } from './PeriodogramChart';
import { fmtNumber } from '../i18n/format';
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
  useEffect(() => {
    if (s.state !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') s.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const peaks = useMemo(
    () => (s.state === 'open' ? topPeaks(s.garun, 3, s.maxPeriodSec) : []),
    [s],
  );

  if (s.state === 'closed') return null;

  const { garun, kind, showRa, showDec, scaleMode, maxPeriodSec } = s;
  const startClock = formatClockUTC(garun.starts, garun.t[0] ?? 0);
  const endClock = formatClockUTC(garun.starts, garun.t[garun.t.length - 1] ?? 0);
  let title: string;
  if (kind === 'unguided') {
    title = t('title.unguided', { begin: garun.range.begin, end: garun.range.end });
  } else if (kind === 'all-raw-ra') {
    title = t('title.rawRa', { frames: garun.t.length, start: startClock, end: endClock });
  } else {
    title = t('title.default', { frames: garun.t.length, start: startClock, end: endClock });
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
      {/* Wheat / amber-toned banner — complementary to the sky-blue accents
          used everywhere else in the app, so the modal context is visually
          unmistakable without clashing. */}
      <header className="flex items-center justify-between border-b-2 border-amber-700 bg-amber-200 px-4 py-3 text-amber-950">
        <div className="flex items-center gap-3">
          <span
            className="rounded bg-amber-700 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-50"
            title={t('labelTooltip')}
          >
            {t('label')}
          </span>
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
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1 text-xs">
        <span className="me-1 text-slate-500" title={t('showTooltip')}>{t('show')}:</span>
        <ToggleChip label="RA" active={showRa} onClick={() => s.setShowRa(!showRa)} title={t('raDriftTooltip')} />
        <ToggleChip label="Dec" active={showDec} onClick={() => s.setShowDec(!showDec)} title={t('decDriftTooltip')} />
        <span className="ms-3 me-1 text-slate-500" title={t('scaleTooltip')}>{t('scale')}:</span>
        <ToggleChip label="arc-sec" active={scaleMode === 'ARCSEC'} onClick={() => s.setScaleMode('ARCSEC')} title={t('arcsecTooltip')} />
        <ToggleChip label="pixels" active={scaleMode === 'PIXELS'} onClick={() => s.setScaleMode('PIXELS')} title={t('pixelsTooltip')} />
        <span className="ms-auto text-slate-600">
          {t('gestureHint')}
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
          at a glance without hovering. The "max period" filter excludes very
          long periods (>10 minutes by default) which are usually drift
          artefacts rather than real PE components. */}
      <div className="border-t-2 border-amber-800 bg-slate-900/70 px-4 py-2 text-xs">
        <div className="mb-1 flex items-center gap-3">
          <span className="font-semibold uppercase tracking-wider text-slate-400">
            {t('topPeaks')}
          </span>
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
        </div>
        {peaks.length === 0 ? (
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
    </div>
  );
}
