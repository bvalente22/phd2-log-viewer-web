import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'anno:';

/**
 * Mount drive type. Governs which periodic-error behaviour is expected:
 * a GEM has a worm with a characteristic period, strainwave/harmonic drives
 * have much shorter high-frequency error, and Alt/Az has no worm period in the
 * RA sense at all. `gem` is the default for new records.
 */
export type MountType = 'gem' | 'strainwave' | 'altaz';

export const MOUNT_TYPES: readonly MountType[] = ['gem', 'strainwave', 'altaz'];

export const DEFAULT_MOUNT_TYPE: MountType = 'gem';

export interface Annotation {
  /** Content hash of the log text — the match key. */
  key: string;
  friendlyName: string | null;
  notes: string | null;
  /**
   * Mount drive type. Optional on disk: records written before this field
   * existed have no value, and are read as `DEFAULT_MOUNT_TYPE`.
   */
  mountType?: MountType;
  /**
   * Mount worm period in seconds, to 2dp. `0` means "unknown" — the user
   * explicitly cleared it or never set it — and is treated as absent by every
   * consumer, so a zero never masquerades as a real period. Absent on records
   * written before this field existed.
   */
  wormPeriodSec?: number;
  /** Last-seen filename, for display / recovery. */
  filename: string;
  /** Set once the log has been opened, so we never re-prompt. */
  seen: true;
  updatedAt: number;
}

/** Normalize a stored/unknown value to a valid MountType. */
export function toMountType(v: unknown): MountType {
  return MOUNT_TYPES.includes(v as MountType) ? (v as MountType) : DEFAULT_MOUNT_TYPE;
}

/**
 * The worm period to actually use, or null when unknown. Centralizes the
 * "0 / negative / non-finite / absent all mean unknown" rule so no consumer
 * has to reimplement it.
 */
export function effectiveWormPeriod(a: Annotation | null | undefined): number | null {
  const v = a?.wormPeriodSec;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * FNV-1a (32-bit) hash of the log text, concatenated with the text length to
 * widen the effective key space. Returned as hex. Not cryptographic — just a
 * stable content fingerprint so the same log re-opened maps to the same
 * annotation record. Collisions across a personal log collection are
 * negligible. See docs/superpowers/specs/2026-06-02-log-annotations-design.md.
 */
export function hashLogText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const a = (h >>> 0).toString(16).padStart(8, '0');
  const b = (text.length >>> 0).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

export async function getAnnotation(key: string): Promise<Annotation | undefined> {
  return get<Annotation>(PREFIX + key);
}

/**
 * Upsert. A field passed as `undefined` (or omitted) keeps the existing value;
 * passing `null` clears it. `seen` is always forced true. Returns the written
 * record.
 */
export async function putAnnotation(p: {
  key: string;
  filename: string;
  friendlyName?: string | null;
  notes?: string | null;
  mountType?: MountType;
  wormPeriodSec?: number;
}): Promise<Annotation> {
  const existing = await get<Annotation>(PREFIX + p.key);
  const rec: Annotation = {
    key: p.key,
    filename: p.filename,
    friendlyName: p.friendlyName !== undefined ? p.friendlyName : existing?.friendlyName ?? null,
    notes: p.notes !== undefined ? p.notes : existing?.notes ?? null,
    mountType: p.mountType !== undefined
      ? toMountType(p.mountType)
      : toMountType(existing?.mountType),
    // Round to 2dp on write so the stored value matches what the field accepts;
    // anything non-finite/negative normalizes to 0 ("unknown").
    wormPeriodSec: p.wormPeriodSec !== undefined
      ? normalizeWormPeriod(p.wormPeriodSec)
      : normalizeWormPeriod(existing?.wormPeriodSec),
    seen: true,
    updatedAt: Date.now(),
  };
  await set(PREFIX + p.key, rec);
  return rec;
}

/** Clamp to a finite, non-negative value rounded to 2dp; anything else → 0. */
export function normalizeWormPeriod(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v * 100) / 100;
}

/**
 * Record that a log has been seen without naming it, so the first-open prompt
 * never fires again. No-op (returns the existing record) when one already
 * exists — must never clobber a name/notes the user already saved.
 */
export async function markSeen(key: string, filename: string): Promise<Annotation> {
  const existing = await get<Annotation>(PREFIX + key);
  if (existing) return existing;
  const rec: Annotation = {
    key,
    filename,
    friendlyName: null,
    notes: null,
    mountType: DEFAULT_MOUNT_TYPE,
    wormPeriodSec: 0,
    seen: true,
    updatedAt: Date.now(),
  };
  await set(PREFIX + key, rec);
  return rec;
}

export async function deleteAnnotation(key: string): Promise<void> {
  await del(PREFIX + key);
}

/** Test/maintenance helper — every annotation key (with the `anno:` prefix). */
export async function _allAnnotationKeys(): Promise<string[]> {
  return (await keys()).map(String).filter((k) => k.startsWith(PREFIX));
}
