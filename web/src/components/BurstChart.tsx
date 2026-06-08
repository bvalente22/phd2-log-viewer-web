import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { BurstRun, BurstCandidate } from '../parser/burstAnalysis';
import { useViewStore } from '../state/viewStore';
import { themeOf, raDecColors } from '../themes';

const ENVELOPE_COLOR = '#fbbf24';      // amber — distinguishes the energy series from the trace
const PEAK_COLOR = '#22d3ee';          // cyan — envelope peaks
const ACF_COLOR = '#a78bfa';           // violet
const FFT_COLOR = '#34d399';           // emerald
const CANDIDATE_LINE = 'rgba(34, 211, 238, 0.65)';
const HARMONIC_LINE = 'rgba(245, 158, 11, 0.45)';

interface BurstChartProps {
  run: BurstRun;
  scaleMode: 'PIXELS' | 'ARCSEC';
}

/** Stacked panel of diagnostic charts for the Bursts tab.
 *  Each chart fills a fixed-height row; the parent scrolls vertically.
 *
 *  1. Raw vs. detrended drift — what came in, what the pipeline fed
 *     to the energy stage.
 *  2. Spike-energy envelope with detected peaks.
 *  3. Autocorrelation of the envelope vs. lag, with candidate periods
 *     marked as vertical lines.
 *  4. FFT periodogram of the envelope, candidates marked again.
 */
export function BurstChart({ run, scaleMode }: BurstChartProps) {
  const { t: tChart } = useTranslation('chart');
  const { t } = useTranslation('analysis');
  const themeId = useViewStore((s) => s.theme);
  const tc = themeOf(themeId).plot;

  const idA = useId().replace(/:/g, '_');
  const idB = useId().replace(/:/g, '_');
  const idC = useId().replace(/:/g, '_');
  const idD = useId().replace(/:/g, '_');

  const k = scaleMode === 'ARCSEC' ? run.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';
  const swapRaDec = useViewStore((s) => s.swapRaDec);
  const { ra: RA_COLOR, dec: DEC_COLOR } = raDecColors(swapRaDec);
  const traceColor = run.axis === 'ra' ? RA_COLOR : DEC_COLOR;

  // Vertical-line shapes for candidate periods, reused across the ACF and FFT charts.
  const candidateShapes = useMemo(() => {
    const shapes: NonNullable<Layout['shapes']> = [];
    for (const c of run.candidates) {
      const isFundamental = c.harmonic === 'fundamental' || c.harmonic === null;
      shapes.push({
        type: 'line',
        xref: 'x', yref: 'paper',
        x0: c.periodSec, x1: c.periodSec,
        y0: 0, y1: 1,
        line: { color: isFundamental ? CANDIDATE_LINE : HARMONIC_LINE, width: 1.5, dash: isFundamental ? 'solid' : 'dot' },
      });
    }
    return shapes;
  }, [run.candidates]);

  // ---------- Pane 1: raw + detrended ----------
  const drift = useMemo<Data[]>(() => {
    const ts = Array.from(run.t);
    const rawScaled = Array.from(run.raw).map((v) => v * k);
    const detScaled = Array.from(run.detrended).map((v) => v * k);
    return [
      {
        x: ts, y: rawScaled,
        type: 'scattergl', mode: 'lines',
        name: t('burst.rawTrace'),
        line: { color: traceColor, width: 1 },
      } as Data,
      {
        x: ts, y: detScaled,
        type: 'scattergl', mode: 'lines',
        name: t('burst.detrendedTrace'),
        line: { color: ENVELOPE_COLOR, width: 1 },
        opacity: 0.85,
      } as Data,
    ];
  }, [run, k, t, traceColor]);

  // ---------- Pane 2: envelope + peaks ----------
  const envelopeTraces = useMemo<Data[]>(() => {
    const ts = Array.from(run.t);
    const env = Array.from(run.envelope).map((v) => v * k);
    const peakXs = run.peakIndices.map((i) => run.t[i]);
    const peakYs = run.peakIndices.map((i) => run.envelope[i] * k);
    return [
      {
        x: ts, y: env,
        type: 'scattergl', mode: 'lines',
        name: t('burst.envelope'),
        line: { color: ENVELOPE_COLOR, width: 1.5 },
      } as Data,
      {
        x: peakXs, y: peakYs,
        type: 'scattergl', mode: 'markers',
        name: t('burst.envelopePeaks'),
        marker: {
          color: PEAK_COLOR,
          size: 9,
          line: { width: 1, color: 'rgba(0,0,0,0.5)' },
        },
      } as Data,
    ];
  }, [run, k, t]);

  const envThresholdShapes = useMemo<NonNullable<Layout['shapes']>>(() => {
    const m = run.envelopeMedian * k;
    const sig = run.envelopeSigma * k;
    const opts = run.options;
    const thr = m + opts.peakThresholdSigma * sig;
    return [
      {
        type: 'line', xref: 'paper', yref: 'y',
        x0: 0, x1: 1, y0: thr, y1: thr,
        line: { color: 'rgba(245, 158, 11, 0.5)', width: 1, dash: 'dash' },
      },
    ];
  }, [run, k]);

  // ---------- Pane 3: autocorrelation ----------
  const acfTraces = useMemo<Data[]>(() => {
    const lags = Array.from(run.acfLags);
    const acf = Array.from(run.acfValues);
    return [
      {
        x: lags, y: acf,
        type: 'scattergl', mode: 'lines',
        name: 'ACF',
        line: { color: ACF_COLOR, width: 1.5 },
      } as Data,
    ];
  }, [run]);

  // ---------- Pane 4: FFT periodogram ----------
  const fftTraces = useMemo<Data[]>(() => {
    // Restrict to the period search range so the chart is interpretable.
    const pMin = run.options.periodMinSec;
    const pMax = run.options.periodMaxSec;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < run.fftPeriod.length; i++) {
      const p = run.fftPeriod[i];
      if (p >= pMin && p <= pMax) {
        xs.push(p);
        ys.push(run.fftAmplitude[i]);
      }
    }
    return [
      {
        x: xs, y: ys,
        type: 'scattergl', mode: 'lines',
        name: 'FFT',
        line: { color: FFT_COLOR, width: 1.5 },
      } as Data,
    ];
  }, [run]);

  const driftLayout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 20, b: 30 },
    paper_bgcolor: tc.paper,
    plot_bgcolor: tc.plot,
    font: { color: tc.font, size: 11 },
    xaxis: { title: { text: tChart('axes.time') }, gridcolor: tc.grid, zerolinecolor: tc.zeroline, fixedrange: false },
    yaxis: { title: { text: unit }, gridcolor: tc.grid, zerolinecolor: tc.zerolineStrong, zerolinewidth: 1, fixedrange: false },
    showlegend: true,
    legend: { orientation: 'h', y: 1.18 },
    dragmode: false,
    hovermode: 'x',
  };

  const envelopeLayout: Partial<Layout> = {
    ...driftLayout,
    yaxis: { ...driftLayout.yaxis, title: { text: t('burst.energyAxis', { unit }) } },
    shapes: envThresholdShapes,
  };

  const acfLayout: Partial<Layout> = {
    ...driftLayout,
    xaxis: { title: { text: t('burst.acfLagAxis') }, gridcolor: tc.grid, zerolinecolor: tc.zeroline, fixedrange: false },
    yaxis: { title: { text: t('burst.acfValue') }, gridcolor: tc.grid, zerolinecolor: tc.zerolineStrong, zerolinewidth: 1, fixedrange: false, range: [-0.5, 1] },
    shapes: candidateShapes,
  };

  const fftLayout: Partial<Layout> = {
    ...driftLayout,
    xaxis: { title: { text: t('burst.periodAxis') }, type: 'log', gridcolor: tc.grid, zerolinecolor: tc.zeroline, fixedrange: false },
    yaxis: { title: { text: t('burst.fftAmpAxis') }, gridcolor: tc.grid, zerolinecolor: tc.zerolineStrong, zerolinewidth: 1, fixedrange: false },
    shapes: candidateShapes,
  };

  return (
    <div className="flex flex-col gap-2 overflow-y-auto p-2">
      <ChartCard title={t('burst.paneRawDetrended')} id={idA} data={drift} layout={driftLayout} />
      <ChartCard title={t('burst.paneEnvelope')} id={idB} data={envelopeTraces} layout={envelopeLayout} />
      <ChartCard title={t('burst.paneAutocorrelation')} id={idC} data={acfTraces} layout={acfLayout} />
      <ChartCard title={t('burst.paneFft')} id={idD} data={fftTraces} layout={fftLayout} />
    </div>
  );
}

function ChartCard({ title, id, data, layout }: { title: string; id: string; data: Data[]; layout: Partial<Layout> }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/40">
      <div className="border-b border-slate-800 px-3 py-1 text-[11px] uppercase tracking-wider text-slate-400">
        {title}
      </div>
      <div className="h-[260px]">
        <Plot
          divId={id}
          data={data}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </div>
    </div>
  );
}

/** Candidates table — surfaces every candidate with its harmonic flag,
 *  ACF strength, and peak-spacing support. Rendered separately from the
 *  chart stack so the modal layout can place it as a sticky bottom row. */
export function BurstCandidatesTable({ run, scaleMode }: { run: BurstRun; scaleMode: 'PIXELS' | 'ARCSEC' }) {
  const { t } = useTranslation('analysis');
  void scaleMode;
  if (run.candidates.length === 0) {
    return <div className="text-slate-500">{t('burst.noCandidates')}</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="text-slate-400">
            <th className="px-2 py-1 text-left">{t('burst.colRank')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colPeriod')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colFreq')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colAcf')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colProm')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colSupport')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colMedianIv')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colStdIv')}</th>
            <th className="px-2 py-1 text-left">{t('burst.colHarmonic')}</th>
            <th className="px-2 py-1 text-right">{t('burst.colConfidence')}</th>
            <th className="px-2 py-1 text-left">{t('burst.colRating')}</th>
          </tr>
        </thead>
        <tbody>
          {run.candidates.map((c, i) => (
            <Row key={i} index={i} c={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ index, c }: { index: number; c: BurstCandidate }) {
  const { t } = useTranslation('analysis');
  const harmonicLabel =
    c.harmonic === 'fundamental' ? t('burst.harmonicFundamental')
    : c.harmonic === 'half' ? t('burst.harmonicHalf')
    : c.harmonic === 'double' ? t('burst.harmonicDouble')
    : '—';
  const ratingLabel =
    c.rating === 'strong' ? t('burst.ratingStrong')
    : c.rating === 'moderate' ? t('burst.ratingModerate')
    : t('burst.ratingWeak');
  const ratingClass =
    c.rating === 'strong' ? 'text-emerald-400'
    : c.rating === 'moderate' ? 'text-amber-300'
    : 'text-slate-500';
  return (
    <tr className="border-t border-slate-800 text-slate-200">
      <td className="px-2 py-1 text-amber-300">#{index + 1}</td>
      <td className="px-2 py-1 text-right">{c.periodSec.toFixed(1)}s</td>
      <td className="px-2 py-1 text-right">{(c.freqHz * 1000).toFixed(2)}mHz</td>
      <td className="px-2 py-1 text-right">{c.acfValue.toFixed(2)}</td>
      <td className="px-2 py-1 text-right">{c.acfProminence.toFixed(2)}</td>
      <td className="px-2 py-1 text-right">{c.supportingBurstCount}</td>
      <td className="px-2 py-1 text-right">{c.medianIntervalSec > 0 ? `${c.medianIntervalSec.toFixed(1)}s` : '—'}</td>
      <td className="px-2 py-1 text-right">{c.intervalStdSec > 0 ? `${c.intervalStdSec.toFixed(1)}s` : '—'}</td>
      <td className="px-2 py-1">{harmonicLabel}</td>
      <td className="px-2 py-1 text-right">{(c.confidence * 100).toFixed(0)}%</td>
      <td className={`px-2 py-1 ${ratingClass}`}>{ratingLabel}</td>
    </tr>
  );
}
