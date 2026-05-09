import { useTranslation } from 'react-i18next';
import type {
  BurstAnalysisOptions,
  EnergyMethod,
  DirectionFilter,
  BurstAxis,
} from '../parser/burstAnalysis';

interface BurstControlsProps {
  opts: BurstAnalysisOptions;
  setOpts: (patch: Partial<BurstAnalysisOptions>) => void;
  onReset: () => void;
  onAutoAdjust: () => void;
  autoAdjusting: boolean;
  /** Highest displayed-percent confidence the running auto-adjust
   *  search has observed since the last Auto adjust click; null when
   *  no run has happened yet. */
  autoBestPct: number | null;
}

/** Multi-row knob grid for the Bursts tab. Each row groups related
 *  controls (data source / preprocessing / energy / peak detection /
 *  period search). Sliders are interactive — every change re-runs
 *  analyzeBursts. The runtime cost is small (a few ms on typical PHD2
 *  logs) so debouncing isn't needed yet. */
export function BurstControls({ opts, setOpts, onReset, onAutoAdjust, autoAdjusting, autoBestPct }: BurstControlsProps) {
  const { t } = useTranslation('analysis');
  return (
    <div className="border-b border-slate-800 px-3 py-2 text-xs">
      <div className="mb-2 flex items-center justify-end gap-2">
        {autoBestPct !== null && (
          <span
            className="rounded bg-slate-800 px-2 py-0.5 font-mono text-amber-300 ring-1 ring-slate-700"
            title={t('burst.autoBestTooltip')}
          >
            {t('burst.autoBest', { pct: autoBestPct })}
          </span>
        )}
        <button
          type="button"
          onClick={onAutoAdjust}
          title={autoAdjusting ? t('burst.autoStopTooltip') : t('burst.autoAdjustTooltip')}
          className={
            autoAdjusting
              ? 'rounded bg-rose-700 px-3 py-0.5 text-xs text-white ring-1 ring-rose-600 transition-colors hover:bg-rose-600'
              : 'rounded bg-emerald-700 px-3 py-0.5 text-xs text-white ring-1 ring-emerald-600 transition-colors hover:bg-emerald-600'
          }
        >
          {autoAdjusting ? t('burst.autoStop') : t('burst.autoAdjust')}
        </button>
        <button
          type="button"
          onClick={onReset}
          disabled={autoAdjusting}
          title={t('burst.resetTooltip')}
          className="rounded bg-slate-800 px-3 py-0.5 text-xs text-slate-200 ring-1 ring-slate-700 transition-colors hover:bg-rose-700 hover:text-white hover:ring-rose-600 disabled:cursor-not-allowed disabled:bg-slate-900 disabled:text-slate-600"
        >
          {t('burst.reset')}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-3">
        {/* Row group 1: source axis + direction + energy method */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500" title={t('burst.axisTooltip')}>{t('burst.axis')}:</span>
          <Chip label="RA" active={opts.axis === 'ra'} onClick={() => setOpts({ axis: 'ra' as BurstAxis })} />
          <Chip label="Dec" active={opts.axis === 'dec'} onClick={() => setOpts({ axis: 'dec' as BurstAxis })} />
          <span className="ms-2 text-slate-500" title={t('burst.directionTooltip')}>{t('burst.direction')}:</span>
          <Chip label="±" active={opts.direction === 'both'} onClick={() => setOpts({ direction: 'both' as DirectionFilter })} />
          <Chip label="+" active={opts.direction === 'positive'} onClick={() => setOpts({ direction: 'positive' as DirectionFilter })} />
          <Chip label="−" active={opts.direction === 'negative'} onClick={() => setOpts({ direction: 'negative' as DirectionFilter })} />
          <span className="ms-2 text-slate-500" title={t('burst.energyTooltip')}>{t('burst.energy')}:</span>
          <Chip label="|x|" active={opts.energyMethod === 'abs'} onClick={() => setOpts({ energyMethod: 'abs' as EnergyMethod })} />
          <Chip label="x²" active={opts.energyMethod === 'square'} onClick={() => setOpts({ energyMethod: 'square' as EnergyMethod })} />
          <Chip label="RMS" active={opts.energyMethod === 'rms'} onClick={() => setOpts({ energyMethod: 'rms' as EnergyMethod })} />
          <ToggleChip
            label={t('burst.normalize')}
            active={opts.robustNormalize}
            onClick={() => setOpts({ robustNormalize: !opts.robustNormalize })}
            title={t('burst.normalizeTooltip')}
          />
        </div>

        {/* Row group 2: preprocessing windows + envelope smoothing */}
        <div className="flex flex-wrap items-center gap-3">
          <Slider
            label={t('burst.highPass')} title={t('burst.highPassTooltip')}
            min={0} max={300} step={1}
            value={opts.highPassPeriodSec}
            onChange={(v) => setOpts({ highPassPeriodSec: v })}
            format={(v) => v > 0 ? `${v}s` : t('burst.off')}
          />
          <Slider
            label={t('burst.lowPass')} title={t('burst.lowPassTooltip')}
            min={0} max={120} step={1}
            value={opts.lowPassPeriodSec}
            onChange={(v) => setOpts({ lowPassPeriodSec: v })}
            format={(v) => v > 0 ? `${v}s` : t('burst.off')}
          />
          <Slider
            label={t('burst.envelope')} title={t('burst.envelopeTooltip')}
            min={0} max={120} step={1}
            value={opts.envelopeSmoothSec}
            onChange={(v) => setOpts({ envelopeSmoothSec: v })}
            format={(v) => v > 0 ? `${v}s` : t('burst.off')}
          />
        </div>

        {/* Row group 3: peak detection + period search */}
        <div className="flex flex-wrap items-center gap-3">
          <Slider
            label={t('burst.peakProminence')} title={t('burst.peakProminenceTooltip')}
            min={0.1} max={5} step={0.1}
            value={opts.peakProminenceSigma}
            onChange={(v) => setOpts({ peakProminenceSigma: v })}
            format={(v) => `${v.toFixed(1)}σ`}
          />
          <Slider
            label={t('burst.peakThreshold')} title={t('burst.peakThresholdTooltip')}
            min={-2} max={5} step={0.1}
            value={opts.peakThresholdSigma}
            onChange={(v) => setOpts({ peakThresholdSigma: v })}
            format={(v) => `${v.toFixed(1)}σ`}
          />
          <Slider
            label={t('burst.minSpacing')} title={t('burst.minSpacingTooltip')}
            min={1} max={300} step={1}
            value={opts.minPeakSpacingSec}
            onChange={(v) => setOpts({ minPeakSpacingSec: v })}
            format={(v) => `${v}s`}
          />
          <Slider
            label={t('burst.periodMin')} title={t('burst.periodMinTooltip')}
            min={2} max={300} step={1}
            value={opts.periodMinSec}
            onChange={(v) => setOpts({ periodMinSec: v })}
            format={(v) => `${v}s`}
          />
          <Slider
            label={t('burst.periodMax')} title={t('burst.periodMaxTooltip')}
            min={20} max={1200} step={5}
            value={opts.periodMaxSec}
            onChange={(v) => setOpts({ periodMaxSec: v })}
            format={(v) => `${v}s`}
          />
        </div>
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        active ? 'bg-sky-700 text-white hover:bg-sky-600' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function ToggleChip({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-2 py-0.5 text-xs transition-colors ${
        active ? 'bg-emerald-700 text-white hover:bg-emerald-600' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

function Slider({
  label, title, min, max, step, value, onChange, format,
}: {
  label: string;
  title?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="flex items-center gap-1" title={title}>
      <span className="text-slate-500">{label}:</span>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-24 accent-amber-500"
      />
      <span className="font-mono text-amber-300 min-w-[3.5rem] text-right">{format(value)}</span>
    </label>
  );
}
