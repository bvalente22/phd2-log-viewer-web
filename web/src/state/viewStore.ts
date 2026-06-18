import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_THEME, type ThemeId } from '../themes';
import { computeSettlingMask } from '../parser/settling';
import type { GuideSession } from '../parser/types';

export type CoordMode = 'RA_DEC' | 'DX_DY';
export type Device = 'MOUNT' | 'AO';
export type VerticalMode = 'PAN' | 'ZOOM';
export type ScaleMode = 'PIXELS' | 'ARCSEC';
export type GraphMode = 'TIME' | 'SCATTER';
export type SettlingPolicy = 'desktop' | 'web';

/** Sidebar width bounds (px). Drag-resize is clamped to this range. */
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 260;
export const clampSidebarWidth = (n: number): number =>
  Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n));

/**
 * Return a fresh, editable copy of a session's exclusion mask sized to the
 * CURRENT session's entry count.
 *
 * The exclusions Map is keyed by per-log `sessionIdx` (0, 1, 2…). Loading a
 * second log whose session 0 has a different frame count would otherwise
 * leave a stale, wrong-length mask under the same key — and editing it via
 * `new Uint8Array(cur)` inherited that wrong length, so writes past the old
 * end were silently dropped on the typed array (the "ctrl-drag does nothing
 * until you pick a context-menu item" bug). Discarding any mask whose length
 * doesn't match `entryCount` (same guard as `ensureMask`) makes every edit
 * land on a correctly-sized buffer. `clearExclusions` on log-load is the
 * primary defense; this is belt-and-suspenders.
 */
const maskForEdit = (cur: Uint8Array | undefined, entryCount: number): Uint8Array =>
  cur && cur.length === entryCount ? new Uint8Array(cur) : new Uint8Array(entryCount);

export interface TraceVisibility {
  ra: boolean;
  dec: boolean;
  raPulses: boolean;
  decPulses: boolean;
  /**
   * RA / Dec mount-limit overlays (LogViewFrame.cpp:1554-1595): up to
   * four horizontal dotted lines per axis when toggled on, drawn in the
   * trace color at ±(maxDur * rate / 1000) and ±minMo (each pair only
   * when the corresponding limit is > 0 in the session header).
   */
  raLimits: boolean;
  decLimits: boolean;
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
  settlingPolicy: Map<number, SettlingPolicy>;
  /**
   * Show the Plotly range-slider strip beneath the chart. Defaults to off
   * because the slider noticeably slows large-trace drag interactions
   * (every relayout has to re-render the thumbnail too); user can toggle
   * it back on from the toolbar when they want a navigator.
   */
  showRangeSlider: boolean;
  /**
   * Per-axis sign flip for the correction-pulse bars. The chart's default
   * orientation matches the desktop's "north up / east down" convention
   * (see GuideGraph.tsx around the pulse traces), but the physical pulse
   * direction the mount was commanded depends on calibration polarity, so
   * some logs come out reading the wrong way. These toggles invert the
   * y-sign of the pulse bars without touching the underlying data, so the
   * tooltip readouts (raw signed `radur`/`decdur` ms) stay authoritative.
   */
  flipRaPulses: boolean;
  flipDecPulses: boolean;
  /**
   * Hide the left sidebar (open-log pane, recents dropdown, sessions list)
   * to give the chart the full window width. The sidebar collapses to a
   * thin vertical rail that holds only the expand toggle, so the user
   * always sees how to bring it back. Persisted across sessions.
   */
  sidebarCollapsed: boolean;
  /** Expanded-sidebar width in px. Persisted; clamped to [SIDEBAR_MIN,
   *  SIDEBAR_MAX]. Ignored while `sidebarCollapsed` (the rail is fixed 16px). */
  sidebarWidth: number;
  /**
   * Snapshots of the per-axis trace toggles, captured the moment an axis
   * goes "all off" via the master RA / Dec toolbar button. When the user
   * clicks the master button to bring the axis back on we restore the
   * subset that was visible BEFORE — explicitly NOT enabling all three
   * traces, since the user told us this is the desired behavior. Defaults
   * mirror the initial `traces` so a first-time master-on click still
   * shows something useful even if nothing has been snapshotted yet.
   */
  lastRaTraces: { ra: boolean; raPulses: boolean; raLimits: boolean };
  lastDecTraces: { dec: boolean; decPulses: boolean; decLimits: boolean };
  lastStarTraces: { mass: boolean; snr: boolean };
  /**
   * Active visual theme. Drives both the page chrome (via a
   * `data-theme=...` attribute set on <html>; CSS in index.css overrides
   * Tailwind's slate-* surface classes for non-default themes) and the
   * Plotly chart layout colors (read off `themes.ts` at render time).
   */
  theme: ThemeId;
  /**
   * Swap the RA / Dec trace colors (RA-blue/Dec-red ↔ RA-red/Dec-blue) across
   * every chart except the periodogram. Persisted per-browser like `theme`.
   */
  swapRaDec: boolean;
  /**
   * Imaging-scope settings for the Image Impact panel. Persisted across
   * sessions because they describe the user's imaging rig, not a log.
   * `imagingScale` is arcsec/pixel; `seeingFwhm` is the base seeing FWHM in
   * arcseconds (preset midpoint or a custom override).
   */
  imagingScale: number;
  seeingFwhm: number;
  /**
   * When true, the Image Impact panel uses one global imaging scale + seeing for
   * ALL logs (and persists them across sessions). When false (default), those
   * two values are remembered per guide log; a new log seeds from the global
   * values. Checking the box copies the current values into the global ones.
   */
  rememberImaging: boolean;

  setCoordMode: (m: CoordMode) => void;
  setDevice: (d: Device) => void;
  setVerticalMode: (v: VerticalMode) => void;
  setScaleMode: (m: ScaleMode) => void;
  setGraphMode: (m: GraphMode) => void;
  setAutoScaleY: (b: boolean) => void;
  setScaleLocked: (b: boolean, range?: [number, number]) => void;
  setShowRangeSlider: (b: boolean) => void;
  setFlipRaPulses: (b: boolean) => void;
  setFlipDecPulses: (b: boolean) => void;
  setSidebarCollapsed: (b: boolean) => void;
  setSidebarWidth: (n: number) => void;
  setTheme: (t: ThemeId) => void;
  setSwapRaDec: (b: boolean) => void;
  setImagingScale: (n: number) => void;
  setSeeingFwhm: (n: number) => void;
  setRememberImaging: (b: boolean) => void;
  toggleTrace: (k: keyof TraceVisibility) => void;
  /**
   * Per-axis master toggle. Off → snapshots the current sub-trace state and
   * disables all three. On → restores the snapshot (or enables just the
   * error trace as a sensible fallback when no meaningful snapshot exists).
   */
  toggleRaAxis: () => void;
  toggleDecAxis: () => void;
  toggleStarGroup: () => void;

  ensureMask: (sessionIdx: number, entryCount: number) => Uint8Array;
  setMask: (sessionIdx: number, mask: Uint8Array) => void;
  applySettlingPolicy: (sessionIdx: number, session: GuideSession, policy: SettlingPolicy) => void;
  includeAll: (sessionIdx: number, entryCount: number) => void;
  excludeAll: (sessionIdx: number, entryCount: number) => void;
  excludeRange: (sessionIdx: number, entryCount: number, fromFrame: number, toFrame: number, frames: number[]) => void;
  includeRange: (sessionIdx: number, entryCount: number, fromFrame: number, toFrame: number, frames: number[]) => void;
  /** Drop every per-session mask. Called when a new log loads so stale masks
   *  from the previous log can't collide by sessionIdx with the new one. */
  clearExclusions: () => void;
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
  traces: { ra: true, dec: true, raPulses: true, decPulses: true, raLimits: false, decLimits: false, mass: false, snr: false, events: false },
  exclusions: new Map(),
  settlingPolicy: new Map(),
  showRangeSlider: false,
  flipRaPulses: false,
  flipDecPulses: false,
  sidebarCollapsed: false,
  sidebarWidth: SIDEBAR_DEFAULT,
  lastRaTraces: { ra: true, raPulses: true, raLimits: false },
  lastDecTraces: { dec: true, decPulses: true, decLimits: false },
  // Guide-star traces start hidden by default (the chart already has a lot
  // going on with RA/Dec lines + pulses). The snapshot defaults enable
  // mass on first master-on click so the group does something useful.
  lastStarTraces: { mass: true, snr: false },
  theme: DEFAULT_THEME,
  swapRaDec: false,
  imagingScale: 1.0,
  seeingFwhm: 3.0,
  rememberImaging: false,

  setCoordMode: (m) => set({ coordMode: m }),
  setDevice: (d) => set({ device: d }),
  setVerticalMode: (v) => set({ verticalMode: v }),
  setScaleMode: (m) => set({ scaleMode: m }),
  setGraphMode: (m) => set({ graphMode: m }),
  setAutoScaleY: (b) => set({ autoScaleY: b }),
  setScaleLocked: (b, range) => set({ scaleLocked: b, lockedYRange: b && range ? range : null }),
  setShowRangeSlider: (b) => set({ showRangeSlider: b }),
  setFlipRaPulses: (b) => set({ flipRaPulses: b }),
  setFlipDecPulses: (b) => set({ flipDecPulses: b }),
  setSidebarCollapsed: (b) => set({ sidebarCollapsed: b }),
  setSidebarWidth: (n) => set({ sidebarWidth: clampSidebarWidth(n) }),
  setTheme: (t) => set({ theme: t }),
  setSwapRaDec: (b) => set({ swapRaDec: b }),
  setImagingScale: (n) => set({ imagingScale: n }),
  setSeeingFwhm: (n) => set({ seeingFwhm: n }),
  setRememberImaging: (b) => set({ rememberImaging: b }),
  toggleTrace: (k) => set((s) => ({ traces: { ...s.traces, [k]: !s.traces[k] } })),

  toggleRaAxis: () => set((s) => {
    const anyOn = s.traces.ra || s.traces.raPulses || s.traces.raLimits;
    if (anyOn) {
      // Falling edge: capture which subset is currently visible so we can
      // restore the same combination on the next "on" click.
      return {
        lastRaTraces: { ra: s.traces.ra, raPulses: s.traces.raPulses, raLimits: s.traces.raLimits },
        traces: { ...s.traces, ra: false, raPulses: false, raLimits: false },
      };
    }
    const snap = s.lastRaTraces;
    const hasSnap = snap.ra || snap.raPulses || snap.raLimits;
    return {
      traces: hasSnap
        ? { ...s.traces, ra: snap.ra, raPulses: snap.raPulses, raLimits: snap.raLimits }
        // Snapshot was empty (e.g. user manually turned everything off).
        // Surfacing just the error trace gives the master toggle something
        // useful to do instead of being a no-op.
        : { ...s.traces, ra: true },
    };
  }),

  toggleDecAxis: () => set((s) => {
    const anyOn = s.traces.dec || s.traces.decPulses || s.traces.decLimits;
    if (anyOn) {
      return {
        lastDecTraces: { dec: s.traces.dec, decPulses: s.traces.decPulses, decLimits: s.traces.decLimits },
        traces: { ...s.traces, dec: false, decPulses: false, decLimits: false },
      };
    }
    const snap = s.lastDecTraces;
    const hasSnap = snap.dec || snap.decPulses || snap.decLimits;
    return {
      traces: hasSnap
        ? { ...s.traces, dec: snap.dec, decPulses: snap.decPulses, decLimits: snap.decLimits }
        : { ...s.traces, dec: true },
    };
  }),

  toggleStarGroup: () => set((s) => {
    const anyOn = s.traces.mass || s.traces.snr;
    if (anyOn) {
      return {
        lastStarTraces: { mass: s.traces.mass, snr: s.traces.snr },
        traces: { ...s.traces, mass: false, snr: false },
      };
    }
    const snap = s.lastStarTraces;
    const hasSnap = snap.mass || snap.snr;
    return {
      traces: hasSnap
        ? { ...s.traces, mass: snap.mass, snr: snap.snr }
        // Empty snapshot fallback enables mass — the more legible of the
        // two metrics on the default dark theme.
        : { ...s.traces, mass: true },
    };
  }),

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

  applySettlingPolicy: (sessionIdx, session, policy) => {
    const entryCount = session.entries.length;
    const oldPolicy = get().settlingPolicy.get(sessionIdx) ?? 'desktop';
    const cur = get().exclusions.get(sessionIdx);
    const hasCur = cur != null && cur.length === entryCount;
    const settleFor = (p: SettlingPolicy) =>
      computeSettlingMask(session, undefined, { includeDithers: p === 'web' });
    const oldSettle = settleFor(oldPolicy);
    const newSettle = settleFor(policy);
    const next = new Uint8Array(entryCount);
    for (let i = 0; i < entryCount; i++) {
      // manual = a hand-excluded bit that wasn't part of the old policy's settling
      const manual = hasCur && cur![i] === 1 && oldSettle[i] === 0;
      next[i] = newSettle[i] === 1 || manual ? 1 : 0;
    }
    const nextEx = new Map(get().exclusions);
    nextEx.set(sessionIdx, next);
    const nextPol = new Map(get().settlingPolicy);
    nextPol.set(sessionIdx, policy);
    set({ exclusions: nextEx, settlingPolicy: nextPol });
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
    const m = maskForEdit(get().exclusions.get(sessionIdx), entryCount);
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
    const m = maskForEdit(get().exclusions.get(sessionIdx), entryCount);
    const lo = Math.min(fromFrame, toFrame);
    const hi = Math.max(fromFrame, toFrame);
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] >= lo && frames[i] <= hi) m[i] = 0;
    }
    const next = new Map(get().exclusions);
    next.set(sessionIdx, m);
    set({ exclusions: next });
  },

  clearExclusions: () => set({ exclusions: new Map(), settlingPolicy: new Map() }),
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
    showRangeSlider: s.showRangeSlider,
    flipRaPulses: s.flipRaPulses,
    flipDecPulses: s.flipDecPulses,
    sidebarCollapsed: s.sidebarCollapsed,
    sidebarWidth: s.sidebarWidth,
    lastRaTraces: s.lastRaTraces,
    lastDecTraces: s.lastDecTraces,
    lastStarTraces: s.lastStarTraces,
    theme: s.theme,
    swapRaDec: s.swapRaDec,
    imagingScale: s.imagingScale,
    seeingFwhm: s.seeingFwhm,
    rememberImaging: s.rememberImaging,
  }),
}));
