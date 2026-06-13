import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'imaging:';

/**
 * Per-guide-log imaging settings for the Image Impact panel, persisted by the
 * log's content hash (the same `meta.hash` annotations / primary period use).
 * One record per log: the imaging scale (arcsec/pixel) and seeing FWHM (arcsec)
 * the user set while viewing it. Used only in per-log mode (the "Remember
 * settings" checkbox switches the panel to a single global value instead).
 */
export interface ImagingSettingsRecord {
  key: string;
  imagingScale: number;
  seeingFwhm: number;
  updatedAt: number;
}

export async function getImagingSettings(key: string): Promise<ImagingSettingsRecord | undefined> {
  return get<ImagingSettingsRecord>(PREFIX + key);
}

export async function putImagingSettings(p: {
  key: string; imagingScale: number; seeingFwhm: number;
}): Promise<ImagingSettingsRecord> {
  const rec: ImagingSettingsRecord = {
    key: p.key, imagingScale: p.imagingScale, seeingFwhm: p.seeingFwhm, updatedAt: Date.now(),
  };
  await set(PREFIX + p.key, rec);
  return rec;
}

export async function deleteImagingSettings(key: string): Promise<void> {
  await del(PREFIX + key);
}

/** Test/maintenance helper — every imaging-settings key (with the `imaging:` prefix). */
export async function _allImagingSettingsKeys(): Promise<string[]> {
  return (await keys()).map(String).filter((k) => k.startsWith(PREFIX));
}
