import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashLogText, getAnnotation, putAnnotation, markSeen,
  deleteAnnotation, _allAnnotationKeys,
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
