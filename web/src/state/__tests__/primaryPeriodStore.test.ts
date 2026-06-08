import { describe, it, expect, beforeEach } from 'vitest';
import { usePrimaryPeriodStore } from '../primaryPeriodStore';
import { getPrimaryPeriod, deletePrimaryPeriod, _allPrimaryPeriodKeys } from '../../storage/primaryPeriod';

beforeEach(async () => {
  for (const k of await _allPrimaryPeriodKeys()) await deletePrimaryPeriod(k.slice('primary:'.length));
  usePrimaryPeriodStore.setState({ hash: null, record: null, loadedHash: null });
});

const S = () => usePrimaryPeriodStore.getState();

describe('primaryPeriodStore', () => {
  it('loadForLog with no stored value sets record null and marks the hash loaded', async () => {
    await S().loadForLog('h1');
    expect(S().record).toBeNull();
    expect(S().loadedHash).toBe('h1');
  });

  it('initAuto writes only when none is stored; a second initAuto does not overwrite', async () => {
    await S().loadForLog('h1');
    await S().initAuto('h1', 376.7);
    expect(S().record).toMatchObject({ value: 376.7, source: 'auto' });
    // record is now present → a second initAuto with a different value is a no-op
    await S().initAuto('h1', 999);
    expect(S().record?.value).toBe(376.7);
    expect((await getPrimaryPeriod('h1'))?.value).toBe(376.7);
  });

  it('initAuto is a no-op before the load for that hash completes', async () => {
    // never called loadForLog → loadedHash !== 'h1'
    await S().initAuto('h1', 376.7);
    expect(S().record).toBeNull();
    expect(await getPrimaryPeriod('h1')).toBeUndefined();
  });

  it('setEdited persists source=edited and survives a reload of the same log', async () => {
    await S().loadForLog('h1');
    await S().initAuto('h1', 376.7);
    await S().setEdited('h1', 410);
    expect(S().record).toMatchObject({ value: 410, source: 'edited' });
    // simulate a fresh session: clear in-memory, reload same hash
    S().clear();
    await S().loadForLog('h1');
    expect(S().record).toMatchObject({ value: 410, source: 'edited' });
  });

  it('setAuto (reset-to-auto) overwrites an edited value', async () => {
    await S().loadForLog('h1');
    await S().setEdited('h1', 410);
    await S().setAuto('h1', 388.2);
    expect(S().record).toMatchObject({ value: 388.2, source: 'auto' });
    expect((await getPrimaryPeriod('h1'))?.source).toBe('auto');
  });

  it('switching to a different log restores/clears the record (different log recalculates)', async () => {
    await S().loadForLog('h1');
    await S().setEdited('h1', 410);
    await S().loadForLog('h2'); // h2 has no stored value
    expect(S().hash).toBe('h2');
    expect(S().record).toBeNull();
    expect(S().loadedHash).toBe('h2');
  });
});
