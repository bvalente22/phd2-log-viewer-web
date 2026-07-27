import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashLogText, getAnnotation, putAnnotation, markSeen,
  deleteAnnotation, _allAnnotationKeys,
  toMountType, effectiveWormPeriod, normalizeWormPeriod,
  DEFAULT_MOUNT_TYPE, type Annotation,
} from '../annotations';

beforeEach(async () => {
  for (const k of await _allAnnotationKeys()) {
    // strip the 'anno:' prefix back to the bare key for deleteAnnotation
    await deleteAnnotation(k.slice('anno:'.length));
  }
});

describe('hashLogText', () => {
  it('is stable for identical text', () => {
    expect(hashLogText('hello world')).toBe(hashLogText('hello world'));
  });
  it('differs for changed text', () => {
    expect(hashLogText('hello world')).not.toBe(hashLogText('hello worle'));
  });
  it('differs when only length differs', () => {
    expect(hashLogText('aa')).not.toBe(hashLogText('aaa'));
  });
});

describe('annotations store', () => {
  it('round-trips name + notes', async () => {
    const rec = await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Backyard', notes: 'windy' });
    expect(rec.seen).toBe(true);
    const got = await getAnnotation('k1');
    expect(got?.friendlyName).toBe('Backyard');
    expect(got?.notes).toBe('windy');
    expect(got?.filename).toBe('f.log');
  });

  it('preserves an unspecified field on partial update', async () => {
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Backyard', notes: 'windy' });
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Renamed' }); // notes omitted
    const got = await getAnnotation('k1');
    expect(got?.friendlyName).toBe('Renamed');
    expect(got?.notes).toBe('windy');
  });

  it('clears a field when explicitly null', async () => {
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: 'Backyard', notes: 'windy' });
    await putAnnotation({ key: 'k1', filename: 'f.log', friendlyName: null, notes: null });
    const got = await getAnnotation('k1');
    expect(got?.friendlyName).toBeNull();
    expect(got?.notes).toBeNull();
    expect(got?.seen).toBe(true); // still seen → no re-prompt
  });

  it('markSeen creates an empty seen record and does not clobber an existing one', async () => {
    const a = await markSeen('k2', 'g.log');
    expect(a.friendlyName).toBeNull();
    expect(a.seen).toBe(true);
    await putAnnotation({ key: 'k2', filename: 'g.log', friendlyName: 'Named' });
    const b = await markSeen('k2', 'g.log'); // must not wipe the name
    expect(b.friendlyName).toBe('Named');
  });
});

describe('mount attributes', () => {
  it('defaults mountType to GEM and worm period to 0 (unknown)', async () => {
    const rec = await putAnnotation({ key: 'm1', filename: 'f.log', friendlyName: 'x' });
    expect(rec.mountType).toBe(DEFAULT_MOUNT_TYPE);
    expect(rec.mountType).toBe('gem');
    expect(rec.wormPeriodSec).toBe(0);
  });

  it('round-trips mountType + worm period', async () => {
    await putAnnotation({
      key: 'm2', filename: 'f.log', mountType: 'strainwave', wormPeriodSec: 383.25,
    });
    const got = await getAnnotation('m2');
    expect(got?.mountType).toBe('strainwave');
    expect(got?.wormPeriodSec).toBe(383.25);
  });

  it('rounds the worm period to 2dp on write', async () => {
    const rec = await putAnnotation({ key: 'm3', filename: 'f.log', wormPeriodSec: 478.126789 });
    expect(rec.wormPeriodSec).toBe(478.13);
  });

  it('normalizes a negative / non-finite worm period to 0 (unknown)', async () => {
    expect((await putAnnotation({ key: 'm4', filename: 'f.log', wormPeriodSec: -5 })).wormPeriodSec).toBe(0);
    expect((await putAnnotation({ key: 'm5', filename: 'f.log', wormPeriodSec: NaN })).wormPeriodSec).toBe(0);
    expect(normalizeWormPeriod(Infinity)).toBe(0);
    expect(normalizeWormPeriod('600' as unknown)).toBe(0);
  });

  it('preserves mount attributes when only name/notes are updated', async () => {
    await putAnnotation({
      key: 'm6', filename: 'f.log', mountType: 'altaz', wormPeriodSec: 240,
    });
    // Mirrors the "Clear" button: blanks the annotation text only. Hardware
    // config must survive — it isn't part of what Clear means.
    await putAnnotation({ key: 'm6', filename: 'f.log', friendlyName: null, notes: null });
    const got = await getAnnotation('m6');
    expect(got?.mountType).toBe('altaz');
    expect(got?.wormPeriodSec).toBe(240);
  });

  it('reads a legacy record (no mount fields) as GEM / unknown', async () => {
    // Records written before these fields existed must not break or silently
    // become an invalid mount type.
    expect(toMountType(undefined)).toBe('gem');
    expect(toMountType('nonsense')).toBe('gem');
    expect(toMountType('altaz')).toBe('altaz');
    const legacy = {
      key: 'old', filename: 'f.log', friendlyName: 'n', notes: null,
      seen: true, updatedAt: 0,
    } as Annotation;
    expect(effectiveWormPeriod(legacy)).toBeNull();
  });
});

describe('effectiveWormPeriod', () => {
  const mk = (wormPeriodSec?: number): Annotation => ({
    key: 'k', filename: 'f', friendlyName: null, notes: null,
    seen: true, updatedAt: 0, wormPeriodSec,
  });

  it('treats 0 / absent / negative as unknown', () => {
    expect(effectiveWormPeriod(mk(0))).toBeNull();
    expect(effectiveWormPeriod(mk(undefined))).toBeNull();
    expect(effectiveWormPeriod(mk(-1))).toBeNull();
    expect(effectiveWormPeriod(null)).toBeNull();
    expect(effectiveWormPeriod(undefined)).toBeNull();
  });

  it('returns a positive period', () => {
    expect(effectiveWormPeriod(mk(478.13))).toBe(478.13);
  });
});
