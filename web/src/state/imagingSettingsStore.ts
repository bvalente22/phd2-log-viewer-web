import { create } from 'zustand';
import {
  getImagingSettings, putImagingSettings, type ImagingSettingsRecord,
} from '../storage/imagingSettings';

/**
 * Holds the per-log imaging settings (scale + seeing) for the currently-loaded
 * guide log. `loadForLog` is called from logStore when a log opens, so a
 * different log restores/clears the record. Edits in per-log mode go through
 * `setForLog` (writes the full record). When the "Remember settings" checkbox
 * is on, the panel ignores this store and uses the global viewStore values.
 */
interface ImagingSettingsState {
  hash: string | null;
  record: ImagingSettingsRecord | null;
  loadForLog: (hash: string) => Promise<void>;
  setForLog: (hash: string, imagingScale: number, seeingFwhm: number) => Promise<void>;
  clear: () => void;
}

export const useImagingSettingsStore = create<ImagingSettingsState>((set, get) => ({
  hash: null,
  record: null,

  loadForLog: async (hash) => {
    set({ hash, record: null });
    const rec = await getImagingSettings(hash);
    if (get().hash !== hash) return; // ignore a stale read if the log changed
    set({ record: rec ?? null });
  },

  setForLog: async (hash, imagingScale, seeingFwhm) => {
    const rec = await putImagingSettings({ key: hash, imagingScale, seeingFwhm });
    if (get().hash !== hash) return;
    set({ record: rec });
  },

  clear: () => set({ hash: null, record: null }),
}));
