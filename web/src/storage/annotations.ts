import { get, set, del, keys } from 'idb-keyval';

const PREFIX = 'anno:';

export interface Annotation {
  /** Content hash of the log text — the match key. */
  key: string;
  friendlyName: string | null;
  notes: string | null;
  /** Last-seen filename, for display / recovery. */
  filename: string;
  /** Set once the log has been opened, so we never re-prompt. */
  seen: true;
  updatedAt: number;
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
}): Promise<Annotation> {
  const existing = await get<Annotation>(PREFIX + p.key);
  const rec: Annotation = {
    key: p.key,
    filename: p.filename,
    friendlyName: p.friendlyName !== undefined ? p.friendlyName : existing?.friendlyName ?? null,
    notes: p.notes !== undefined ? p.notes : existing?.notes ?? null,
    seen: true,
    updatedAt: Date.now(),
  };
  await set(PREFIX + p.key, rec);
  return rec;
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
    key, filename, friendlyName: null, notes: null, seen: true, updatedAt: Date.now(),
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
