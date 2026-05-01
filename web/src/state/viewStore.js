import { create } from 'zustand';
export const useViewStore = create((set, get) => ({
    coordMode: 'RA_DEC',
    device: 'MOUNT',
    verticalMode: 'PAN',
    scaleLocked: false,
    lockedYRange: null,
    traces: { ra: true, dec: true, raPulses: false, decPulses: false, mass: false, snr: false },
    exclusions: new Map(),
    setCoordMode: (m) => set({ coordMode: m }),
    setDevice: (d) => set({ device: d }),
    setVerticalMode: (v) => set({ verticalMode: v }),
    setScaleLocked: (b, range) => set({ scaleLocked: b, lockedYRange: b && range ? range : null }),
    toggleTrace: (k) => set((s) => ({ traces: { ...s.traces, [k]: !s.traces[k] } })),
    ensureMask: (sessionIdx, entryCount) => {
        const m = get().exclusions.get(sessionIdx);
        if (m && m.length === entryCount)
            return m;
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
            if (frames[i] >= lo && frames[i] <= hi)
                m[i] = 1;
        }
        const next = new Map(get().exclusions);
        next.set(sessionIdx, m);
        set({ exclusions: next });
    },
}));
