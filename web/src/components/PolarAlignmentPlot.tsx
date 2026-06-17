import { useTranslation } from 'react-i18next';
import { polarAlignmentBand } from './guidingMetric';

// Geometry: viewBox 160×190, target centered at (CX,CY), radius R spans 6′.
const CX = 80, CY = 80, R = 70;
const PER_MIN = R / 6;
const GREEN_R = 2 * PER_MIN; // ≤2′
const YELLOW_R = 5 * PER_MIN; // ≤5′
const MAX_MIN = 6;

const BAND_HEX: Record<'green' | 'yellow' | 'red', string> = {
  green: '#10b981', yellow: '#facc15', red: '#ef4444',
};

// Pure: dot position for the total error + Alt/Az split. Distance = total PAE
// (clamped to 6′); angle = atan2(alt, az) in the upper-right quadrant (magnitude
// only — directional placement is a future phase). Null split → centered.
export function paePlotDot(
  paeTotal: number, altArcMin: number | null, azArcMin: number | null,
  perMin: number, cx: number, cy: number,
): { x: number; y: number; r: number } {
  const r = Math.min(paeTotal, MAX_MIN) * perMin;
  if (altArcMin === null || azArcMin === null || paeTotal <= 0) {
    return { x: cx, y: cy, r };
  }
  const ang = Math.atan2(altArcMin, azArcMin); // alt → Y-up, az → X-right; both ≥ 0 → first quadrant
  return { x: cx + Math.cos(ang) * r, y: cy - Math.sin(ang) * r, r };
}

// Even-odd donut between outer radius ro and inner radius ri.
const donut = (ro: number, ri: number) =>
  `M${CX - ro},${CY} a${ro},${ro} 0 1 0 ${2 * ro},0 a${ro},${ro} 0 1 0 ${-2 * ro},0 Z ` +
  `M${CX - ri},${CY} a${ri},${ri} 0 1 0 ${2 * ri},0 a${ri},${ri} 0 1 0 ${-2 * ri},0 Z`;

interface Props {
  paeTotal: number;
  altArcMin: number | null;
  azArcMin: number | null;
  altTrust: boolean;
  azTrust: boolean;
  hasHa: boolean;
}

export default function PolarAlignmentPlot({ paeTotal, altArcMin, azArcMin, altTrust, azTrust, hasHa }: Props) {
  const { t } = useTranslation('stats');
  const band = polarAlignmentBand(paeTotal);
  const dot = paePlotDot(paeTotal, altArcMin, azArcMin, PER_MIN, CX, CY);
  const showAzWarn = hasHa && !azTrust;
  const showAltWarn = hasHa && !altTrust;

  return (
    <svg viewBox="0 0 160 190" width="150" height="178" role="img" aria-label={t('pa.tooltip')}>
      <title>{t('pa.tooltip')}</title>
      <path fillRule="evenodd" fill={BAND_HEX.red} fillOpacity="0.18" d={donut(R, YELLOW_R)} />
      <path fillRule="evenodd" fill={BAND_HEX.yellow} fillOpacity="0.22" d={donut(YELLOW_R, GREEN_R)} />
      <circle cx={CX} cy={CY} r={GREEN_R} fill={BAND_HEX.green} fillOpacity="0.24" />
      <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke="#64748b" strokeOpacity="0.45" />
      <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke="#64748b" strokeOpacity="0.45" />
      <text x={CX} y={CY - R - 3} fill="#94a3b8" fontSize="9" textAnchor="middle">Alt</text>
      <text x={CX + R + 1} y={CY - 3} fill="#94a3b8" fontSize="9" textAnchor="end">Az</text>
      {paeTotal > 0 && (
        <>
          <line x1={CX} y1={CY} x2={dot.x} y2={dot.y} stroke="#e2e8f0" strokeWidth="2" />
          <circle cx={dot.x} cy={dot.y} r="5" fill={BAND_HEX[band]} stroke="#fff" strokeWidth="1.4" />
        </>
      )}
      <text x={CX} y={182} fill={BAND_HEX[band]} fontSize="15" fontWeight="700" textAnchor="middle">
        {paeTotal.toFixed(1)}′
      </text>
      {showAzWarn && (
        <g>
          <title>{t('pa.azLowConf')}</title>
          <circle cx={CX + R * 0.62} cy={CY - 9} r="8" fill="#facc15" />
          <text x={CX + R * 0.62} y={CY - 5} fontSize="12" fontWeight="800" fill="#1f2937" textAnchor="middle">!</text>
        </g>
      )}
      {showAltWarn && (
        <g>
          <title>{t('pa.altLowConf')}</title>
          <circle cx={CX + 9} cy={CY - R * 0.62} r="8" fill="#facc15" />
          <text x={CX + 9} y={CY - R * 0.62 + 4} fontSize="12" fontWeight="800" fill="#1f2937" textAnchor="middle">!</text>
        </g>
      )}
    </svg>
  );
}
