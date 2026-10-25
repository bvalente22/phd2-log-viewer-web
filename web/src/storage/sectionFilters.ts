import { get, set, del, keys } from 'idb-keyval';
import type { SettlingPolicy } from '../state/viewStore';

const PREFIX = 'filters:';

/**
 * Per-log section filter state, persisted by the log's content hash (the same
 * `meta.hash` the annotation / primary-period sidecars use), so reopening a log
 * — from Recents, the folder pane or a fresh drop of the same file — resumes
 * where it left off: every guiding section's exclusion mask and settling
 * policy, plus the section that was selected.
 *
 * Masks and policies are stored as [sessionIdx, value] pairs so they round-trip
 * straight into the viewStore Maps. A guiding section with no entry was never
 * viewed; it still has its default (first-view) settling exclusions.
 */
export interface SectionFiltersRecord {
  /** Log content hash — the match key (without the `filters:` prefix). */
  key: string;
  /** Index into `log.sections` that was selected. */
  selectedSection: number;
  /** Per guide-session exclusion mask (1 = excluded), keyed by sessionIdx. */
  masks: [number, Uint8Array][];
  /** Per guide-session settling policy in force, keyed by sessionIdx. */
  policies: [number, SettlingPolicy][];
  updatedAt: number;
}

export async function getSectionFilters(key: string): Promise<SectionFiltersRecord | undefined> {
  return get<SectionFiltersRecord>(PREFIX + key);
}

export async function putSectionFilters(
  p: Omit<SectionFiltersRecord, 'updatedAt'>,
): Promise<SectionFiltersRecord> {
  const rec: SectionFiltersRecord = { ...p, updatedAt: Date.now() };
  await set(PREFIX + p.key, rec);
  return rec;
}

export async function deleteSectionFilters(key: string): Promise<void> {
  await del(PREFIX + key);
}

/** Test/maintenance helper — every section-filters key (with the `filters:` prefix). */
export async function _allSectionFiltersKeys(): Promise<string[]> {
  return (await keys()).map(String).filter((k) => k.startsWith(PREFIX));
}
