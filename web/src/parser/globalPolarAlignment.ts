import type { GuideLog } from './types';
import { computePolarAlignment, PAE_CONSTANT } from './polarAlignment';

export const MIN_GLOBAL_FRAMES = 30;

export type GlobalConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export interface GlobalPolarAlignment {
  totalArcMin: number;
  altArcMin: number;
  azArcMin: number;
  confidence: GlobalConfidence;
  sectionCount: number;
  haSpreadHours: number;
  relResidual: number;
}

const INSUFFICIENT: GlobalPolarAlignment = {
  totalArcMin: 0, altArcMin: 0, azArcMin: 0,
  confidence: 'insufficient', sectionCount: 0, haSpreadHours: 0, relResidual: 0,
};

export function computeGlobalPolarAlignment(
  log: GuideLog,
  masks?: Map<number, Uint8Array>,
): GlobalPolarAlignment {
  // Collect qualifying guiding sections: determinable PAE, enough frames, has HA.
  type Pt = { e: number; H: number; haHours: number; pier: string | null };
  const pts: Pt[] = [];
  for (const sec of log.sections) {
    if (sec.type !== 'GUIDING') continue;
    const session = log.sessions[sec.idx];
    const pa = computePolarAlignment(session, masks?.get(sec.idx));
    if (!pa.paeDeterminable || pa.includedCount < MIN_GLOBAL_FRAMES || pa.effectiveHaHours === null) continue;
    const cosDec = Math.cos(session.declination);
    if (Math.abs(cosDec) <= 1e-6) continue;
    const e = (PAE_CONSTANT * (pa.driftDecPxMin * session.pixelScale)) / cosDec; // signed
    const haHours = pa.effectiveHaHours;
    const H = (haHours * 15 * Math.PI) / 180;
    pts.push({ e, H, haHours, pier: session.pierSide });
  }

  if (pts.length < 2) return { ...INSUFFICIENT, sectionCount: pts.length };

  // Pier-side normalization: a meridian flip inverts the measured Dec-drift sign.
  const refPier = pts[0].pier;
  for (const p of pts) if (p.pier != null && refPier != null && p.pier !== refPier) p.e = -p.e;

  const haHoursArr = pts.map((p) => p.haHours);
  const haSpreadHours = Math.max(...haHoursArr) - Math.min(...haHoursArr);

  // 2x2 normal equations for e = A cos H + E sin H.
  let Scc = 0, Scs = 0, Sss = 0, bc = 0, bs = 0;
  for (const { e, H } of pts) {
    const c = Math.cos(H), s = Math.sin(H);
    Scc += c * c; Scs += c * s; Sss += s * s; bc += e * c; bs += e * s;
  }
  const det = Scc * Sss - Scs * Scs;
  if (haSpreadHours < 1.0 || Math.abs(det) < 1e-9) {
    return { ...INSUFFICIENT, sectionCount: pts.length, haSpreadHours };
  }
  const A = (bc * Sss - bs * Scs) / det; // azimuth (signed)
  const E = (bs * Scc - bc * Scs) / det; // altitude (signed)

  // Residual.
  let sse = 0;
  for (const { e, H } of pts) {
    const r = e - (A * Math.cos(H) + E * Math.sin(H));
    sse += r * r;
  }
  const residualRms = Math.sqrt(sse / pts.length);
  const totalArcMin = Math.hypot(A, E);
  const relResidual = residualRms / Math.max(totalArcMin, 0.5);

  let confidence: GlobalConfidence;
  if (haSpreadHours >= 3.0 && relResidual < 0.25) confidence = 'high';
  else if (haSpreadHours >= 1.5 && relResidual < 0.5) confidence = 'medium';
  else confidence = 'low';

  return {
    totalArcMin,
    altArcMin: Math.abs(E),
    azArcMin: Math.abs(A),
    confidence,
    sectionCount: pts.length,
    haSpreadHours,
    relResidual,
  };
}
