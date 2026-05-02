import { useId, useMemo, useState, useCallback, useEffect } from 'react';
import Plot from 'react-plotly.js';
import type { Data, Layout } from 'plotly.js';
import type { GARun } from '../parser/analyze';
import { useChartGestures } from './useChartGestures';

const PEAK_PX = 8;
const FFT_COLOR = '#a3e635';

interface PlotDiv extends HTMLDivElement {
  _fullLayout?: {
    xaxis?: { _offset: number; _length: number; range: [number, number]; type?: string };
  };
}

interface PeriodogramChartProps {
  garun: GARun;
  scaleMode: 'PIXELS' | 'ARCSEC';
}

/**
 * Periodogram (period vs. amplitude). Mirrors PaintFFT in
 * AnalysisWin.cpp:1076-1182 plus the OnMove peak-snap logic at lines
 * 853-918. The hover readout is the periodic-error report — period,
 * amplitude (″/px), peak-to-peak, RMS — that the desktop puts in its
 * status bar.
 */
export function PeriodogramChart({ garun, scaleMode }: PeriodogramChartProps) {
  const plotId = useId().replace(/:/g, '_');
  const [hover, setHover] = useState<string | null>(null);

  const k = scaleMode === 'ARCSEC' ? garun.pixelScale : 1;
  const unit = scaleMode === 'ARCSEC' ? '″' : 'px';

  const traces = useMemo<Data[]>(() => [
    {
      x: Array.from(garun.fftPeriod),
      y: Array.from(garun.fftAmplitude).map((v) => v * k),
      type: 'scatter', mode: 'lines',
      name: 'amplitude',
      line: { color: FFT_COLOR, width: 1.5 },
      fill: 'tozeroy',
      fillcolor: 'rgba(163, 230, 53, 0.1)',
    } as Data,
  ], [garun, k]);

  useChartGestures(plotId, {}, { enableModifierSelect: false });

  /**
   * Find the closest local-max peak in the periodogram within ±PEAK_PX of the
   * cursor's screen position. Mirrors AnalysisWin.cpp:864-907.
   */
  const snapToPeak = useCallback((cursorPeriod: number): { period: number; amplitude: number } => {
    const div = document.getElementById(plotId) as PlotDiv | null;
    const xa = div?._fullLayout?.xaxis;
    if (!xa || !xa._length) {
      return { period: cursorPeriod, amplitude: garun.fftSpline.at(cursorPeriod) };
    }
    const periods = garun.fftPeriod;
    const amps = garun.fftAmplitude;
    const isLog = xa.type === 'log';
    const toPx = (p: number): number => {
      if (isLog) {
        const r0 = Math.pow(10, xa.range[0]);
        const r1 = Math.pow(10, xa.range[1]);
        return ((Math.log10(p) - Math.log10(r0)) / (Math.log10(r1) - Math.log10(r0))) * xa._length;
      }
      return ((p - xa.range[0]) / (xa.range[1] - xa.range[0])) * xa._length;
    };
    const cursorPx = toPx(cursorPeriod);
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 1; i < periods.length - 1; i++) {
      const px = toPx(periods[i]);
      if (Math.abs(px - cursorPx) > PEAK_PX) continue;
      if (amps[i] > amps[i - 1] && amps[i] > amps[i + 1]) {
        const d = Math.abs(px - cursorPx);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
    }
    if (bestIdx >= 0) return { period: periods[bestIdx], amplitude: amps[bestIdx] };
    return { period: cursorPeriod, amplitude: garun.fftSpline.at(cursorPeriod) };
  }, [plotId, garun]);

  const onHover = useCallback((ev: { points?: Array<{ x?: number }> }) => {
    const x = ev.points?.[0]?.x;
    if (typeof x !== 'number') return;
    const { period, amplitude } = snapToPeak(x);
    const aPx = amplitude;
    const aArc = amplitude * garun.pixelScale;
    const ppArc = 2 * aArc;
    const ppPx = 2 * aPx;
    const rmsArc = aArc / Math.SQRT2;
    const rmsPx = aPx / Math.SQRT2;
    setHover(
      `Period: ${period.toFixed(1)}s  Amplitude: ${aArc.toFixed(2)}″ (${aPx.toFixed(2)}px)  ` +
      `P-P: ${ppArc.toFixed(2)}″ (${ppPx.toFixed(2)}px)  ` +
      `RMS: ${rmsArc.toFixed(2)}″ (${rmsPx.toFixed(2)}px)`,
    );
  }, [garun, snapToPeak]);

  // Quiet the unused-variable warning for `unit/k` when scaleMode is PIXELS.
  useEffect(() => { void unit; void k; }, [unit, k]);

  const layout: Partial<Layout> = {
    autosize: true,
    margin: { l: 60, r: 30, t: 10, b: 40 },
    paper_bgcolor: '#0f172a',
    plot_bgcolor: '#0f172a',
    font: { color: '#cbd5e1', size: 11 },
    xaxis: {
      title: { text: 'period (s)' }, gridcolor: '#1e293b', zerolinecolor: '#334155',
      type: 'log', autorange: true, fixedrange: false,
    },
    yaxis: {
      title: { text: `amplitude (${unit === '″' ? 'arc-sec' : 'px'})` },
      gridcolor: '#1e293b', zerolinecolor: '#334155',
      autorange: true, fixedrange: true,
    },
    showlegend: false,
    dragmode: false,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <Plot
          divId={plotId}
          data={traces}
          layout={layout}
          config={{ displayModeBar: false, responsive: true, scrollZoom: true, doubleClick: false }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
          onHover={onHover as never}
          onUnhover={() => setHover(null)}
        />
      </div>
      <div className="border-t border-slate-800 bg-slate-900/40 px-3 py-1 font-mono text-[11px] text-slate-300 min-h-[24px] whitespace-pre-wrap">
        {hover ?? ' '}
      </div>
    </div>
  );
}
