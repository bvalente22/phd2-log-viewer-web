import type { GuideSession } from './types';
import { computePolarAlignment } from './polarAlignment';

export type ExclusionMask = Uint8Array;

export interface SessionStats {
  rmsRa: number;
  rmsDec: number;
  rmsTotal: number;
  peakRa: number;
  peakDec: number;
  meanRa: number;
  meanDec: number;
  driftRa: number;
  driftDec: number;
  rmsRaArcsec: number;
  rmsDecArcsec: number;
  rmsTotalArcsec: number;
  driftRaArcsec: number;
  driftDecArcsec: number;
  paeArcMin: number;
  paeDeterminable: boolean;
  altArcMin: number | null;
  azArcMin: number | null;
  altTrust: boolean;
  azTrust: boolean;
  hourAngleHours: number | null;
  effectiveHaHours: number | null;
  ellipse: { theta: number; lx: number; ly: number; elongation: number };
  durationSec: number;
  includedCount: number;
  excludedCount: number;
}

const pcaEllipse = (ras: number[], decs: number[]) => {
  const n = ras.length;
  if (n < 2) return { theta: 0, lx: 0, ly: 0, elongation: 1 };
  let mra = 0, mdec = 0;
  for (let i = 0; i < n; i++) { mra += ras[i]; mdec += decs[i]; }
  mra /= n; mdec /= n;
  let cxx = 0, cxy = 0, cyy = 0;
  for (let i = 0; i < n; i++) {
    const a = ras[i] - mra;
    const b = decs[i] - mdec;
    cxx += a * a; cxy += a * b; cyy += b * b;
  }
  cxx /= n; cxy /= n; cyy /= n;
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.max(0, tr * tr / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = tr / 2 - Math.sqrt(disc);
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const lx = Math.sqrt(Math.max(0, l1));
  const ly = Math.sqrt(Math.max(0, l2));
  const elongation = ly === 0 ? Infinity : lx / ly;
  return { theta, lx, ly, elongation };
};

export function calcStats(s: GuideSession, mask?: ExclusionMask): SessionStats {
  const ras: number[] = [];
  const decs: number[] = [];
  let included = 0;
  let excluded = 0;

  for (let i = 0; i < s.entries.length; i++) {
    const e = s.entries[i];
    const masked = mask && mask[i] === 1;
    if (!e.included || masked) {
      excluded++;
      continue;
    }
    included++;
    ras.push(e.raraw);
    decs.push(e.decraw);
  }

  const peakRa = ras.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const peakDec = decs.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const meanRa = ras.length ? ras.reduce((a, b) => a + b, 0) / ras.length : 0;
  const meanDec = decs.length ? decs.reduce((a, b) => a + b, 0) / decs.length : 0;

  // RMS is the standard deviation of the displacement (RMS *about the mean*),
  // matching the desktop PHDLogView's CalcStats: it accumulates sum and sumsq
  // and returns sqrt(sumsq/n - mean^2). Computing RMS about zero instead would
  // fold any net pointing/drift offset into the figure (RMS_zero^2 = var +
  // mean^2), inflating it most on the axis with the larger mean offset — which
  // is exactly the Dec-vs-RA discrepancy users see against the desktop app.
  const rmsAboutMean = (a: number[], mean: number) =>
    a.length ? Math.sqrt(a.reduce((x, y) => x + (y - mean) * (y - mean), 0) / a.length) : 0;
  const rmsRa = rmsAboutMean(ras, meanRa);
  const rmsDec = rmsAboutMean(decs, meanDec);
  const rmsTotal = Math.sqrt(rmsRa * rmsRa + rmsDec * rmsDec);

  const pa = computePolarAlignment(s, mask);
  const driftRa = pa.driftRaPxMin;
  const driftDec = pa.driftDecPxMin;

  const ellipse = pcaEllipse(ras, decs);

  const paeArcMin = pa.paeTotalArcMin;

  return {
    rmsRa, rmsDec, rmsTotal,
    peakRa, peakDec,
    meanRa, meanDec,
    driftRa, driftDec,
    rmsRaArcsec: rmsRa * s.pixelScale,
    rmsDecArcsec: rmsDec * s.pixelScale,
    rmsTotalArcsec: rmsTotal * s.pixelScale,
    driftRaArcsec: driftRa * s.pixelScale,
    driftDecArcsec: driftDec * s.pixelScale,
    paeArcMin,
    paeDeterminable: pa.paeDeterminable,
    altArcMin: pa.altArcMin,
    azArcMin: pa.azArcMin,
    altTrust: pa.altTrust,
    azTrust: pa.azTrust,
    hourAngleHours: pa.hourAngleHours,
    effectiveHaHours: pa.effectiveHaHours,
    ellipse,
    durationSec: s.duration,
    includedCount: included,
    excludedCount: excluded,
  };
}
