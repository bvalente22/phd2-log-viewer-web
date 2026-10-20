// @vitest-environment node
// Real Blob/File + (De)CompressionStream for the zip fixtures.
import { describe, it, expect } from 'vitest';
import { buildLogBundle, debugLogNameFor } from '../logBundle';
import { makeZipFile } from './zipFixture';

const guideName = (ts: string) => `PHD2_GuideLog_${ts}.txt`;
const debugName = (ts: string) => `PHD2_DebugLog_${ts}.txt`;
const fakeHandle = (name: string) => ({ kind: 'file', name }) as unknown as FileSystemFileHandle;

describe('debugLogNameFor', () => {
  it('swaps GuideLog for DebugLog, keeping the timestamp', () => {
    expect(debugLogNameFor('PHD2_GuideLog_2026-09-15_160234.txt')).toBe('PHD2_DebugLog_2026-09-15_160234.txt');
  });
});

describe('buildLogBundle', () => {
  it('pairs every guide log in a multi-night zip with its debug log, newest first', async () => {
    // Same shape as PHD2's "Upload Log Files" bundle: flat, pairs interleaved.
    const zip = await makeZipFile('PHD2_logs_8Crq.zip', [
      { path: guideName('2026-09-08_140319'), data: 'guide 0908' },
      { path: debugName('2026-09-08_140319'), data: 'debug 0908' },
      { path: guideName('2026-09-15_160234'), data: 'guide 0915' },
      { path: debugName('2026-09-15_160234'), data: 'debug 0915' },
      { path: guideName('2026-08-17_160255'), data: 'guide 0817' },
      { path: debugName('2026-08-17_160255'), data: 'debug 0817' },
    ]);
    const bundle = await buildLogBundle([zip]);
    expect(bundle.label).toBe('PHD2_logs_8Crq.zip');
    expect(bundle.logs.map((l) => l.guide.name)).toEqual([
      guideName('2026-09-15_160234'),
      guideName('2026-09-08_140319'),
      guideName('2026-08-17_160255'),
    ]);
    expect(bundle.logs.map((l) => l.debug?.name)).toEqual([
      debugName('2026-09-15_160234'),
      debugName('2026-09-08_140319'),
      debugName('2026-08-17_160255'),
    ]);
    expect(bundle.logs[0].dateLabel).toBe('2026-09-15 · 16:02');
    expect(await (await bundle.logs[1].guide.read()).text()).toBe('guide 0908');
    expect(await (await bundle.logs[1].debug!.read()).text()).toBe('debug 0908');
    expect(bundle.logs[0].guide.size).toBe('guide 0915'.length);
  });

  it('keeps a guide log whose debug log is missing, unpaired', async () => {
    const zip = await makeZipFile('b.zip', [
      { path: guideName('2026-09-15_160234'), data: 'g1' },
      { path: guideName('2026-09-11_160158'), data: 'g2' },
      { path: debugName('2026-09-11_160158'), data: 'd2' },
    ]);
    const { logs } = await buildLogBundle([zip]);
    expect(logs.map((l) => [l.guide.name, l.debug?.name ?? null])).toEqual([
      [guideName('2026-09-15_160234'), null],
      [guideName('2026-09-11_160158'), debugName('2026-09-11_160158')],
    ]);
  });

  it('matches pairs through zip folders and ignores macOS resource-fork junk', async () => {
    const zip = await makeZipFile('mac.zip', [
      { path: 'Night 1/' + guideName('2026-09-15_160234'), data: 'g' },
      { path: 'Night 1/' + debugName('2026-09-15_160234'), data: 'd' },
      { path: '__MACOSX/Night 1/._' + guideName('2026-09-15_160234'), data: 'junk' },
      { path: 'Night 1/._' + debugName('2026-09-15_160234'), data: 'junk' },
    ]);
    const { logs } = await buildLogBundle([zip]);
    expect(logs).toHaveLength(1);
    expect(logs[0].guide.name).toBe(guideName('2026-09-15_160234'));
    expect(await (await logs[0].debug!.read()).text()).toBe('d');
  });

  it('treats several loose pairs like a bundle (no label)', async () => {
    const files = [
      new File(['g1'], guideName('2026-09-11_160158')),
      new File(['d2'], debugName('2026-09-15_160234')),
      new File(['g2'], guideName('2026-09-15_160234')),
      new File(['d1'], debugName('2026-09-11_160158')),
    ];
    const bundle = await buildLogBundle(files);
    expect(bundle.label).toBeNull();
    expect(bundle.logs.map((l) => [l.guide.name, l.debug?.name])).toEqual([
      [guideName('2026-09-15_160234'), debugName('2026-09-15_160234')],
      [guideName('2026-09-11_160158'), debugName('2026-09-11_160158')],
    ]);
  });

  it('pairs a lone guide + debug log even when renamed, like the old single-pair drop', async () => {
    const { logs } = await buildLogBundle([
      new File(['g'], 'my_night_GuideLog.txt'),
      new File(['d'], 'PHD2_DebugLog_whatever.txt'),
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0].debug?.name).toBe('PHD2_DebugLog_whatever.txt');
  });

  it('falls back to a non-PHD2-named file as the guide log when nothing is named GuideLog', async () => {
    const { logs } = await buildLogBundle([new File(['g'], 'renamed.txt')]);
    expect(logs.map((l) => l.guide.name)).toEqual(['renamed.txt']);
  });

  it('returns no logs when the drop holds only a debug log', async () => {
    const { logs } = await buildLogBundle([new File(['d'], debugName('2026-09-15_160234'))]);
    expect(logs).toEqual([]);
  });

  it('links a loose debug log to its own handle and a zipped one to the zip + entry path', async () => {
    const zip = await makeZipFile('bundle.zip', [
      { path: 'logs/' + guideName('2026-09-15_160234'), data: 'g' },
      { path: 'logs/' + debugName('2026-09-15_160234'), data: 'd' },
    ]);
    const zipHandle = fakeHandle('bundle.zip');
    const zipped = await buildLogBundle([zip], [zipHandle]);
    expect(zipped.logs[0].debug?.link).toEqual({ handle: zipHandle, entry: 'logs/' + debugName('2026-09-15_160234') });

    const debugHandle = fakeHandle(debugName('2026-09-11_160158'));
    const loose = await buildLogBundle(
      [new File(['g'], guideName('2026-09-11_160158')), new File(['d'], debugName('2026-09-11_160158'))],
      [debugHandle],
    );
    expect(loose.logs[0].debug?.link).toEqual({ handle: debugHandle });
    expect(loose.logs[0].guide.link).toBeNull(); // no handle offered for it
  });

  it('propagates a ZipError for an unreadable zip', async () => {
    const bad = new File(['not really a zip'], 'broken.zip');
    await expect(buildLogBundle([bad])).rejects.toMatchObject({ name: 'ZipError', code: 'not-zip' });
  });
});
