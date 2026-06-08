import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'primary:';

/**
 * Per-guide-log Primary period, persisted by the log's content hash (the same
 * `meta.hash` the annotations sidecar uses). One value per log: the auto-
 * detected dominant peak the first time the log is analyzed, or the value the
 * user typed. Survives reloads / reopening the same log; a different log has no
 * record and so recalculates. `value` is in seconds (canonical, independent of
 * the arc-sec/pixels display toggle).
 */
export interface PrimaryPeriodRecord {
  /** Log content hash — the match key (without the `primary:` prefix). */
  key: string;
  value: number;
  source: 'auto' | 'edited';
  /**
   * For `auto` records: how many cycles of `value` the section that produced it
   * spanned (section duration ÷ value). A later section that resolves MORE
   * cycles supersedes a weaker auto value, so a short section (e.g. one too
   * brief to resolve the worm period) can't lock in a bogus Primary. Absent on
   * `edited` records and on pre-existing records (treated as 0 → upgradable).
   */
  cycles?: number;
  updatedAt: number;
}

export async function getPrimaryPeriod(key: string): Promise<PrimaryPeriodRecord | undefined> {
  return get<PrimaryPeriodRecord>(PREFIX + key);
}

export async function putPrimaryPeriod(p: {
  key: string;
  value: number;
  source: 'auto' | 'edited';
  cycles?: number;
}): Promise<PrimaryPeriodRecord> {
  const rec: PrimaryPeriodRecord = {
    key: p.key,
    value: p.value,
    source: p.source,
    ...(p.cycles !== undefined ? { cycles: p.cycles } : {}),
    updatedAt: Date.now(),
  };
  await set(PREFIX + p.key, rec);
  return rec;
}

export async function deletePrimaryPeriod(key: string): Promise<void> {
  await del(PREFIX + key);
}

/** Test/maintenance helper — every primary-period key (with the `primary:` prefix). */
export async function _allPrimaryPeriodKeys(): Promise<string[]> {
  return (await keys()).map(String).filter((k) => k.startsWith(PREFIX));
}
