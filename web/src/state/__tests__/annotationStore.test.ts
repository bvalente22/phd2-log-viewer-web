import { describe, it, expect, beforeEach } from 'vitest';
import { useAnnotationStore } from '../annotationStore';
import { getAnnotation, deleteAnnotation, _allAnnotationKeys } from '../../storage/annotations';

beforeEach(async () => {
  for (const k of await _allAnnotationKeys()) await deleteAnnotation(k.slice('anno:'.length));
  useAnnotationStore.setState({ current: null, currentKey: null, modal: null, revision: 0 });
});

describe('annotationStore', () => {
  it('first open of an unseen log opens the first-open prompt prefilled with the filename', async () => {
    await useAnnotationStore.getState().loadForLog('k1', 'log.txt');
    const m = useAnnotationStore.getState().modal;
    expect(m?.mode).toBe('first-open');
    expect(m?.name).toBe('log.txt');
    expect(useAnnotationStore.getState().current).toBeNull();
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
