// @vitest-environment node
// Node provides real Blob.stream / CompressionStream / DecompressionStream,
// which the reader (and the fixture writer) rely on.
import { describe, it, expect } from 'vitest';
import { listZipEntries, readZipEntry, looksLikeZip, ZipError } from '../zipReader';
import { makeZip } from './zipFixture';

const GUIDE = 'PHD2 version 2.6.13, Log version 2.5. Log enabled at 2026-09-15 16:02:34\n'.repeat(200);
const DEBUG = '16:02:34.123 00.000 1234 Guiding started\n'.repeat(500);

describe('zipReader', () => {
  it('lists file entries with name, path and sizes, skipping directories', async () => {
    const zip = await makeZip([
      { path: 'logs/', data: '', method: 0 },
      { path: 'logs/PHD2_GuideLog_2026-09-15_160234.txt', data: GUIDE },
      { path: 'PHD2_DebugLog_2026-09-15_160234.txt', data: DEBUG, method: 0 },
    ]);
    const entries = await listZipEntries(zip);
    expect(entries.map((e) => e.path)).toEqual([
      'logs/PHD2_GuideLog_2026-09-15_160234.txt',
      'PHD2_DebugLog_2026-09-15_160234.txt',
    ]);
    expect(entries[0].name).toBe('PHD2_GuideLog_2026-09-15_160234.txt');
    expect(entries[0].size).toBe(GUIDE.length);
    expect(entries[0].compressedSize).toBeLessThan(GUIDE.length); // actually deflated
  });

  it('extracts deflated and stored entries byte-for-byte, named by basename', async () => {
    const zip = await makeZip([
      { path: 'logs/PHD2_GuideLog_x.txt', data: GUIDE },
      { path: 'PHD2_DebugLog_x.txt', data: DEBUG, method: 0 },
    ]);
    const [g, d] = await listZipEntries(zip);
    const guide = await readZipEntry(zip, g);
    expect(guide.name).toBe('PHD2_GuideLog_x.txt');
    expect(await guide.text()).toBe(GUIDE);
    expect(await (await readZipEntry(zip, d)).text()).toBe(DEBUG);
  });

  it('finds the end record behind an archive comment', async () => {
    const zip = await makeZip([{ path: 'a.txt', data: 'hello' }], { comment: 'sent from PHD2 '.repeat(50) });
    const [e] = await listZipEntries(zip);
    expect(await (await readZipEntry(zip, e)).text()).toBe('hello');
  });

  it('reads ZIP64 archives (saturated classic fields, real values in extra fields)', async () => {
    const zip = await makeZip([
      { path: 'PHD2_GuideLog_x.txt', data: GUIDE },
      { path: 'PHD2_DebugLog_x.txt', data: DEBUG },
    ], { zip64: true });
    const entries = await listZipEntries(zip);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['PHD2_GuideLog_x.txt', GUIDE.length],
      ['PHD2_DebugLog_x.txt', DEBUG.length],
    ]);
    expect(await (await readZipEntry(zip, entries[1])).text()).toBe(DEBUG);
  });

  it('rejects encrypted entries and unsupported compression methods with a coded ZipError', async () => {
    const zip = await makeZip([
      { path: 'secret.txt', data: 'x', method: 0, flags: 0x0001 },
      { path: 'bzip.txt', data: 'x', method: 12 },
    ]);
    const [enc, bz] = await listZipEntries(zip);
    await expect(readZipEntry(zip, enc)).rejects.toMatchObject({ name: 'ZipError', code: 'encrypted' });
    await expect(readZipEntry(zip, bz)).rejects.toMatchObject({ name: 'ZipError', code: 'unsupported-method' });
  });

  it('rejects a non-zip file as not-zip', async () => {
    const notZip = new Blob([GUIDE]);
    await expect(listZipEntries(notZip)).rejects.toBeInstanceOf(ZipError);
    await expect(listZipEntries(notZip)).rejects.toMatchObject({ code: 'not-zip' });
    await expect(listZipEntries(new Blob(['tiny']))).rejects.toMatchObject({ code: 'not-zip' });
  });

  it('looksLikeZip sniffs the signature, not the extension', async () => {
    expect(await looksLikeZip(await makeZip([{ path: 'a.txt', data: 'a' }]))).toBe(true);
    expect(await looksLikeZip(new Blob([GUIDE]))).toBe(false);
    expect(await looksLikeZip(new Blob([]))).toBe(false);
  });
});
