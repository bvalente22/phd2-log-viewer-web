import { useViewStore } from '../state/viewStore';
import { themeOf, type PlotThemeColors } from '../themes';

/**
 * Identity color for the top-N peak at `index` (0 = peak #1), or null past the
 * palette. Colors are assigned by rank and never cycled — a 4th peak would get
 * no marker rather than reuse peak #1's color. The periodogram's dotted period
 * lines, the chips beneath it, and the summary cards all read from here so
 * they can't drift apart.
 */
export const peakColor = (tc: PlotThemeColors, index: number): string | null =>
  tc.peakMarkers[index] ?? null;

/**
 * Numbered, color-filled rank chip ("1", "2", "3") for a top period. The same
 * chip sits under the periodogram at each peak's dotted line and on the
 * matching summary card, which is what ties a line to its card.
 */
export function PeakChip({ rank, title }: { rank: number; title?: string }) {
  const tc = themeOf(useViewStore((v) => v.theme)).plot;
  const color = peakColor(tc, rank - 1);
  if (!color) return null;
  return (
    <span
      className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold shadow"
      // Every marker color clears 5:1 against the plot paper, so the paper
      // color doubles as the chip's ink on every theme.
      style={{ backgroundColor: color, color: tc.paper }}
      title={title}
    >
      {rank}
    </span>
  );
}
