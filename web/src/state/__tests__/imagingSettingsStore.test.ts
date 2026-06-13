import { describe, it, expect, beforeEach } from 'vitest';
import { useImagingSettingsStore } from '../imagingSettingsStore';
import { getImagingSettings, deleteImagingSettings, _allImagingSettingsKeys } from '../../storage/imagingSettings';

beforeEach(async () => {
  for (const k of await _allImagingSettingsKeys()) await deleteImagingSettings(k.slice('imaging:'.length));
  useImagingSettingsStore.setState({ hash: null, record: null });
});

const S = () => useImagingSettingsStore.getState();

describe('imagingSettingsStore', () => {
  it('loadForLog with no stored value sets record null', async () => {
    await S().loadForLog('h1');
    expect(S().hash).toBe('h1');
    expect(S().record).toBeNull();
  });

  it('setForLog persists both fields and updates record; survives a reload', async () => {
    await S().loadForLog('h1');
    await S().setForLog('h1', 0.8, 2.5);
    expect(S().record).toMatchObject({ imagingScale: 0.8, seeingFwhm: 2.5 });
    expect(await getImagingSettings('h1')).toMatchObject({ imagingScale: 0.8, seeingFwhm: 2.5 });
    S().clear();
    await S().loadForLog('h1');
    expect(S().record).toMatchObject({ imagingScale: 0.8, seeingFwhm: 2.5 });
  });

  it('switching logs restores/clears the record (no bleed across logs)', async () => {
    await S().loadForLog('h1');
    await S().setForLog('h1', 0.8, 2.5);
    await S().loadForLog('h2');
    expect(S().hash).toBe('h2');
    expect(S().record).toBeNull();
  });
});
