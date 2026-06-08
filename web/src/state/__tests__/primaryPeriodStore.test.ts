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

  it('setAutoIfStronger stores when nothing is stored yet', async () => {
    await S().loadForLog('h1');
    await S().setAutoIfStronger('h1', 376.7, 6.0);
    expect(S().record).toMatchObject({ value: 376.7, source: 'auto', cycles: 6.0 });
  });

  it('a stronger section (more cycles) supersedes a weaker auto value; a weaker one does not', async () => {
    await S().loadForLog('h1');
    await S().setAutoIfStronger('h1', 48.6, 1.5); // weak short section
    expect(S().record?.value).toBe(48.6);
    await S().setAutoIfStronger('h1', 369.8, 6.9); // strong section — upgrades
    expect(S().record).toMatchObject({ value: 369.8, cycles: 6.9 });
    await S().setAutoIfStronger('h1', 459, 1.4); // weaker — ignored
    expect(S().record?.value).toBe(369.8);
  });

  it('treats a pre-existing record with no cycles as upgradable (self-heal)', async () => {
    await S().loadForLog('h1');
    await S().setAutoIfStronger('h1', 48.6, 0); // legacy/weak, cycles 0
    await S().setAutoIfStronger('h1', 369.8, 6.9);
    expect(S().record?.value).toBe(369.8);
  });

  it('setAutoIfStronger never overwrites a user edit', async () => {
    await S().loadForLog('h1');
    await S().setEdited('h1', 410);
    await S().setAutoIfStronger('h1', 369.8, 9.9);
    expect(S().record).toMatchObject({ value: 410, source: 'edited' });
  });

  it('setAutoIfStronger is a no-op before the load for that hash completes', async () => {
    await S().setAutoIfStronger('h1', 376.7, 6.0); // never loaded
    expect(S().record).toBeNull();
    expect(await getPrimaryPeriod('h1')).toBeUndefined();
  });

  it('setEdited persists source=edited and survives a reload of the same log', async () => {
    await S().loadForLog('h1');
    await S().setAutoIfStronger('h1', 376.7, 6.0);
    await S().setEdited('h1', 410);
    expect(S().record).toMatchObject({ value: 410, source: 'edited' });
    S().clear();
    await S().loadForLog('h1');
    expect(S().record).toMatchObject({ value: 410, source: 'edited' });
  });

  it('setAuto (reset-to-auto) overwrites an edited value with the current section', async () => {
    await S().loadForLog('h1');
    await S().setEdited('h1', 410);
    await S().setAuto('h1', 388.2, 4.5);
    expect(S().record).toMatchObject({ value: 388.2, source: 'auto', cycles: 4.5 });
  });

  it('switching to a different log restores/clears the record', async () => {
    await S().loadForLog('h1');
    await S().setEdited('h1', 410);
    await S().loadForLog('h2');
    expect(S().hash).toBe('h2');
    expect(S().record).toBeNull();
    expect(S().loadedHash).toBe('h2');
  });
});
