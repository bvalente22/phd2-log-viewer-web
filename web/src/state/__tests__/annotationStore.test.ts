import { describe, it, expect, beforeEach } from 'vitest';
import { useAnnotationStore, parseAttrNumber } from '../annotationStore';
import { getAnnotation, deleteAnnotation, _allAnnotationKeys } from '../../storage/annotations';
import {
  getImagingSettings, putImagingSettings, deleteImagingSettings, _allImagingSettingsKeys,
} from '../../storage/imagingSettings';

beforeEach(async () => {
  for (const k of await _allAnnotationKeys()) await deleteAnnotation(k.slice('anno:'.length));
  for (const k of await _allImagingSettingsKeys()) await deleteImagingSettings(k.slice('imaging:'.length));
  useAnnotationStore.setState({ current: null, currentKey: null, modal: null, revision: 0 });
});

describe('annotationStore', () => {
  it('first open of an unseen log opens the first-open prompt prefilled with the date from the filename', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'PHD2_GuideLog_2026-03-30_161541.txt');
    const m = useAnnotationStore.getState().modal;
    expect(m?.mode).toBe('first-open');
    expect(m?.name).toBe('2026-03-30');
    expect(useAnnotationStore.getState().current).toBeNull();
  });

  it('first-open prompt falls back to the filename when no date is present', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    expect(useAnnotationStore.getState().modal?.name).toBe('log.txt');
  });

  it('loading a seen log does not prompt and sets current', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    await useAnnotationStore.getState().skipFirstOpen(); // marks seen
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    expect(useAnnotationStore.getState().modal).toBeNull();
    expect(useAnnotationStore.getState().current?.seen).toBe(true);
  });

  it('save persists name + notes, bumps revision, updates current', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    useAnnotationStore.getState().setDraftName('Backyard');
    useAnnotationStore.getState().setDraftNotes('windy night');
    const before = useAnnotationStore.getState().revision;
    await useAnnotationStore.getState().save();
    expect(useAnnotationStore.getState().revision).toBe(before + 1);
    expect(useAnnotationStore.getState().modal).toBeNull();
    const rec = await getAnnotation('k1');
    expect(rec?.friendlyName).toBe('Backyard');
    expect(rec?.notes).toBe('windy night');
    expect(useAnnotationStore.getState().current?.friendlyName).toBe('Backyard');
  });

  it('clearCurrentInModal blanks name + notes but keeps the seen record', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    useAnnotationStore.getState().setDraftName('Backyard');
    await useAnnotationStore.getState().save();
    await useAnnotationStore.getState().openEditor('k1', 'log.txt');
    await useAnnotationStore.getState().clearCurrentInModal();
    const rec = await getAnnotation('k1');
    expect(rec?.friendlyName).toBeNull();
    expect(rec?.notes).toBeNull();
    expect(rec?.seen).toBe(true);
  });

  it('setDraftNotes caps at NOTES_MAXLEN', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    useAnnotationStore.getState().setDraftNotes('x'.repeat(40000));
    expect(useAnnotationStore.getState().modal?.notes.length).toBe(32768);
  });
});

describe('parseAttrNumber', () => {
  it('parses a plain and a 2dp value', () => {
    expect(parseAttrNumber('478')).toBe(478);
    expect(parseAttrNumber('1.25')).toBe(1.25);
  });
  it('rounds to 2dp', () => {
    expect(parseAttrNumber('478.126789')).toBe(478.13);
  });
  it('treats blank / garbage / zero / negative as unknown (0)', () => {
    for (const s of ['', '   ', 'abc', '0', '-3', '.']) expect(parseAttrNumber(s)).toBe(0);
  });
  it('accepts a partially-typed decimal without throwing', () => {
    // The field keeps raw text while typing, so "1." reaches the parser.
    expect(parseAttrNumber('1.')).toBe(1);
  });
});

describe('mount attribute drafts', () => {
  it('defaults a fresh editor to GEM, no encoders, blank numeric fields', async () => {
    await useAnnotationStore.getState().openEditor('k9', 'log.txt');
    const m = useAnnotationStore.getState().modal;
    expect(m?.mountType).toBe('gem');
    expect(m?.hasEncoders).toBe(false);
    expect(m?.wormPeriodText).toBe('');
    expect(m?.imagingScaleText).toBe('');
  });

  it('saves the encoders flag and reloads it into the editor', async () => {
    await useAnnotationStore.getState().openEditor('k14', 'log.txt');
    useAnnotationStore.getState().setDraftHasEncoders(true);
    await useAnnotationStore.getState().save();
    expect((await getAnnotation('k14'))?.hasEncoders).toBe(true);

    await useAnnotationStore.getState().openEditor('k14', 'log.txt');
    expect(useAnnotationStore.getState().modal?.hasEncoders).toBe(true);

    // Un-ticking must persist too.
    useAnnotationStore.getState().setDraftHasEncoders(false);
    await useAnnotationStore.getState().save();
    expect((await getAnnotation('k14'))?.hasEncoders).toBe(false);
  });

  it('promoting a worm period does not disturb the encoders flag', async () => {
    await useAnnotationStore.getState().openEditor('k15', 'log.txt');
    useAnnotationStore.getState().setDraftHasEncoders(true);
    await useAnnotationStore.getState().save();
    await useAnnotationStore.getState().setWormPeriodForLog('k15', 'log.txt', 383.25);
    const rec = await getAnnotation('k15');
    expect(rec?.wormPeriodSec).toBe(383.25);
    expect(rec?.hasEncoders).toBe(true);
  });

  it('saves mount type + worm period, and reloads them into the editor', async () => {
    await useAnnotationStore.getState().openEditor('k9', 'log.txt');
    useAnnotationStore.getState().setDraftMountType('strainwave');
    useAnnotationStore.getState().setDraftWormPeriod('383.25');
    await useAnnotationStore.getState().save();

    const rec = await getAnnotation('k9');
    expect(rec?.mountType).toBe('strainwave');
    expect(rec?.wormPeriodSec).toBe(383.25);

    await useAnnotationStore.getState().openEditor('k9', 'log.txt');
    const m = useAnnotationStore.getState().modal;
    expect(m?.mountType).toBe('strainwave');
    expect(m?.wormPeriodText).toBe('383.25');
  });

  it('a blank worm period saves as 0 (unknown), not NaN', async () => {
    await useAnnotationStore.getState().openEditor('k9', 'log.txt');
    useAnnotationStore.getState().setDraftWormPeriod('   ');
    await useAnnotationStore.getState().save();
    expect((await getAnnotation('k9'))?.wormPeriodSec).toBe(0);
  });

  it('setWormPeriodForLog writes the worm period without touching name/notes', async () => {
    await useAnnotationStore.getState().openEditor('k9', 'log.txt');
    useAnnotationStore.getState().setDraftName('Backyard');
    useAnnotationStore.getState().setDraftNotes('windy');
    await useAnnotationStore.getState().save();

    // This is the "promote an edited Primary to the mount worm period" path.
    await useAnnotationStore.getState().setWormPeriodForLog('k9', 'log.txt', 478.13);
    const rec = await getAnnotation('k9');
    expect(rec?.wormPeriodSec).toBe(478.13);
    expect(rec?.friendlyName).toBe('Backyard');
    expect(rec?.notes).toBe('windy');
  });
});

describe('imaging scale is shared, not duplicated', () => {
  it('writes the scale to the imaging sidecar rather than the annotation', async () => {
    await useAnnotationStore.getState().openEditor('k10', 'log.txt');
    useAnnotationStore.getState().setDraftImagingScale('1.23');
    await useAnnotationStore.getState().save();

    // Lands in the shared `imaging:` record the Image Impact panel reads...
    expect((await getImagingSettings('k10'))?.imagingScale).toBe(1.23);
    // ...and NOT as a second copy on the annotation.
    expect((await getAnnotation('k10') as unknown as Record<string, unknown>).imagingScale)
      .toBeUndefined();
  });

  it('surfaces a scale set elsewhere (Image Impact panel) in the dialog', async () => {
    await putImagingSettings({ key: 'k11', imagingScale: 2.5, seeingFwhm: 3 });
    await useAnnotationStore.getState().openEditor('k11', 'log.txt');
    expect(useAnnotationStore.getState().modal?.imagingScaleText).toBe('2.5');
  });

  it('preserves seeing FWHM when only the scale is edited', async () => {
    await putImagingSettings({ key: 'k12', imagingScale: 1, seeingFwhm: 2.8 });
    await useAnnotationStore.getState().openEditor('k12', 'log.txt');
    useAnnotationStore.getState().setDraftImagingScale('1.5');
    await useAnnotationStore.getState().save();
    const rec = await getImagingSettings('k12');
    expect(rec?.imagingScale).toBe(1.5);
    expect(rec?.seeingFwhm).toBe(2.8); // untouched
  });

  it('does not create an imaging record when the scale was never touched', async () => {
    // Opening the dialog for an unrelated edit and hitting Save must not stamp a
    // scale of 0 onto a log that never had one.
    await useAnnotationStore.getState().openEditor('k13', 'log.txt');
    useAnnotationStore.getState().setDraftName('Just a rename');
    await useAnnotationStore.getState().save();
    expect(await getImagingSettings('k13')).toBeUndefined();
  });
});
