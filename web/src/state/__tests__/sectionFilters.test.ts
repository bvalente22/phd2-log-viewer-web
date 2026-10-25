import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useLogStore, flushSectionFilterSave } from '../logStore';
import { useViewStore } from '../viewStore';
import {
  getSectionFilters, deleteSectionFilters, _allSectionFiltersKeys,
} from '../../storage/sectionFilters';
import { hashLogText } from '../../storage/annotations';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'parser', '__tests__', 'fixtures');
const MULTI = readFileSync(join(FIXTURES, 'multi-session.log'), 'utf-8');
const SYNTH = readFileSync(join(FIXTURES, 'synthetic.log'), 'utf-8');

const load = (text: string, name: string) =>
  useLogStore.getState().loadFromText(text, name, { persist: false });

/** The last section of the open log and its guide session. */
const lastGuideSection = () => {
  const log = useLogStore.getState().log!;
  const sectionIdx = log.sections.length - 1;
  const sec = log.sections[sectionIdx];
  expect(sec.type).toBe('GUIDING');
  return { sectionIdx, sessionIdx: sec.idx, session: log.sessions[sec.idx] };
};

beforeEach(async () => {
  await flushSectionFilterSave();
  useLogStore.getState().clear();
  for (const k of await _allSectionFiltersKeys()) await deleteSectionFilters(k.slice('filters:'.length));
});

describe('per-log section filters', () => {
  it('reopening a log restores its exclusions, settling policy and selected section', async () => {
    await load(MULTI, 'multi.log');
    const { sectionIdx, sessionIdx, session } = lastGuideSection();
    useLogStore.getState().selectSection(sectionIdx);
    useViewStore.getState().excludeAll(sessionIdx, session.entries.length);
    useViewStore.getState().applySettlingPolicy(sessionIdx, session, 'web');
    await flushSectionFilterSave();

    // A different log in between starts clean...
    await load(SYNTH, 'synthetic.log');
    expect(useViewStore.getState().exclusions.size).toBe(0);
    expect(useLogStore.getState().selectedSection).toBe(0);

    // ...and the first one resumes where it left off.
    await load(MULTI, 'multi.log');
    expect(useLogStore.getState().selectedSection).toBe(sectionIdx);
    const mask = useViewStore.getState().exclusions.get(sessionIdx)!;
    expect(mask.length).toBe(session.entries.length);
    expect(mask.every((b) => b === 1)).toBe(true);
    expect(useViewStore.getState().settlingPolicy.get(sessionIdx)).toBe('web');
  });

  it('closing a log does not save its emptied masks over its filters', async () => {
    await load(MULTI, 'multi.log');
    const { sessionIdx, session } = lastGuideSection();
    useViewStore.getState().excludeAll(sessionIdx, session.entries.length);
    await flushSectionFilterSave();

    useLogStore.getState().clear();
    await flushSectionFilterSave();
    expect((await getSectionFilters(hashLogText(MULTI)))?.masks).toHaveLength(1);
  });

  it('a save still pending when the next log loads lands on the log it belongs to', async () => {
    await load(MULTI, 'multi.log');
    const { sessionIdx, session } = lastGuideSection();
    useViewStore.getState().excludeAll(sessionIdx, session.entries.length);
    // No flush: the debounced save is still pending when the next log loads.
    await load(SYNTH, 'synthetic.log');
    await flushSectionFilterSave();

    expect((await getSectionFilters(hashLogText(MULTI)))?.masks).toHaveLength(1);
    expect(await getSectionFilters(hashLogText(SYNTH))).toBeUndefined();
  });
});
