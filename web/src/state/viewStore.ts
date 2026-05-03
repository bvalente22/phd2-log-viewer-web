import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CoordMode = 'RA_DEC' | 'DX_DY';
export type Device = 'MOUNT' | 'AO';
export type VerticalMode = 'PAN' | 'ZOOM';
export type ScaleMode = 'PIXELS' | 'ARCSEC';
export type GraphMode = 'TIME' | 'SCATTER';

export interface TraceVisibility {
  ra: boolean;
  dec: boolean;
  raPulses: boolean;
  decPulses: boolean;
  mass: boolean;
  snr: boolean;
  events: boolean;
}

interface ViewState {
  coordMode: CoordMode;
  device: Device;
  verticalMode: VerticalMode;
  scaleMode: ScaleMode;
  graphMode: GraphMode;
  scaleLocked: boolean;
  /**
   * When true, the Y axis range is computed from a robust percentile of the
   * visible data instead of its raw min/max. This keeps dithers and other
   * outliers from forcing the scale wide enough that the routine guiding
   * (typically <2 arc-sec) becomes a flat line. See GuideGraph.tsx for the
   * actual percentile choice.
   */
  autoScaleY: boolean;
  lockedYRange: [number, number] | null;
  traces: TraceVisibility;
  exclusions: Map<number, Uint8Array>;

  setCoordMode: (m: CoordMode) => void;
  setDevice: (d: Device) => void;
  setVerticalMode: (v: VerticalMode) => void;
  setScaleMode: (m: ScaleMode) => void;
  setGraphMode: (m: GraphMode) => void;
  setAutoScaleY: (b: boolean) => void;
  setScaleLocked: (b: boolean, range?: [number, number]) => void;
  toggleTrace: (k: keyof TraceVisibility) => void;

  ensureMask: (sessionIdx: number, entryCount: number) => Uint8Array;
  setMask: (sessionIdx: number, mask: Uint8Array) => void;
  includeAll: (sessionIdx: number, entryCount: number) => void;
  excludeAll: (sessionIdx: number, entryCount: number) => void;
  excludeRange: (sessionIdx: number, entryCount: number, fromFrame: number, toFrame: number, frames: number[]) => void;
  includeRange: (sessionIdx: number, entryCount: number, fromFrame: number, toFrame: number, frames: number[]) => void;
}

// View preferences are persisted to localStorage so toggles survive a reload.
// Per-section exclusion masks and the lockedYRange snapshot are NOT persisted
// because they only make sense with the currently-loaded log; the partialize
// option below filters them out.
export const useViewStore = create<ViewState>()(persist((set, get) => ({
  coordMode: 'RA_DEC',
  device: 'MOUNT',
  verticalMode: 'PAN',
  scaleMode: 'ARCSEC',
  graphMode: 'TIME',
  scaleLocked: false,
  autoScaleY: true,
  lockedYRange: null,
  traces: { ra: true, dec: true, raPulses: true, decPulses: true, mass: false, snr: false, events: false },
  exclusions: new Map(),

  setCoordMode: (m) => set({ coordMode: m }),
  setDevice: (d) => set({ device: d }),
  setVerticalMode: (v) => set({ verticalMode: v }),
  setScaleMode: (m) => set({ scaleMode: m }),
  setGraphMode: (m) => set({ graphMode: m }),
  setAutoScaleY: (b) => set({ autoScaleY: b }),
  setScaleLocked: (b, range) => set({ scaleLocked: b, lockedYRange: b && range ? range : null }),
  toggleTrace: (k) => set((s) => ({ traces: { ...s.traces, [k]: !s.traces[k] } })),

  ensureMask: (sessionIdx, entryCount) => {
    const m = get().exclusions.get(sessionIdx);
    if (m && m.length === entryCount) return m;
    const fresh = new Uint8Array(entryCount);
    const next = new Map(get().exclusions);
    next.set(sessionIdx, fresh);
    set({ exclusions: next });
    return fresh;
  },

  setMask: (sessionIdx, mask) => {
    const next = new Map(get().exclusions);
    next.set(sessionIdx, mask);
    set({ exclusions: next });
  },

  includeAll: (sessionIdx, entryCount) => {
    const fresh = new Uint8Array(entryCount);
    const next = new Map(get().exclusions);
    next.set(sessionIdx, fresh);
    set({ exclusions: next });
  },

  excludeAll: (sessionIdx, entryCount) => {
    const m = new Uint8Array(entryCount);
    m.fill(1);
    const next = new Map(get().exclusions);
    next.set(sessionIdx, m);
    set({ exclusions: next });
  },

  excludeRange: (sessionIdx, entryCount, fromFrame, toFrame, frames) => {
    const cur = get().exclusions.get(sessionIdx) ?? new Uint8Array(entryCount);
    const m = new Uint8Array(cur);
    const lo = Math.min(fromFrame, toFrame);
    const hi = Math.max(fromFrame, toFrame);
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] >= lo && frames[i] <= hi) m[i] = 1;
    }
    const next = new Map(get().exclusions);
    next.set(sessionIdx, m);
    set({ exclusions: next });
  },

  includeRange: (sessionIdx, entryCount, fromFrame, toFrame, frames) => {
    const cur = get().exclusions.get(sessionIdx) ?? new Uint8Array(entryCount);
    const m = new Uint8Array(cur);
    const lo = Math.min(fromFrame, toFrame);
    const hi = Math.max(fromFrame, toFrame);
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] >= lo && frames[i] <= hi) m[i] = 0;
    }
    const next = new Map(get().exclusions);
    next.set(sessionIdx, m);
    set({ exclusions: next });
  },
}), {
  name: 'phd-view-settings',
  // Persist UI preferences only; exclusion masks and lockedYRange are
  // session-scoped and would be misleading to restore against a different log.
  partialize: (s) => ({
    coordMode: s.coordMode,
    device: s.device,
    verticalMode: s.verticalMode,
    scaleMode: s.scaleMode,
    graphMode: s.graphMode,
    scaleLocked: s.scaleLocked,
    autoScaleY: s.autoScaleY,
    traces: s.traces,
  }),
}));
