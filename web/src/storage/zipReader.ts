/**
 * Minimal, dependency-free ZIP reader for log bundles (e.g. PHD2's
 * "Upload Log Files" `PHD2_logs_XXXX.zip`).
 *
 * Works on a `Blob` (a dropped/picked `File`) without loading the whole archive
 * into memory: it reads the end-of-central-directory record from the tail, then
 * the central directory, and only slices + decompresses an entry when asked.
 * That matters here — a bundle's debug logs run to tens of MB each, and only
 * the one the user actually opens should ever be inflated.
 *
 * Decompression uses the platform `DecompressionStream('deflate-raw')`
 * (Chromium 103+, Firefox 113+, Safari 16.4+), so no zip library is needed.
 * Supported: stored (0) and deflate (8) entries, data descriptors, and ZIP64
 * sizes/offsets. Not supported (rejected with a `ZipError`): encrypted entries
 * and other compression methods (Deflate64, BZip2, LZMA, …). CRCs are not
 * verified; a corrupt deflate stream still fails loudly in the decompressor.
 */

export type ZipErrorCode = 'not-zip' | 'corrupt' | 'encrypted' | 'unsupported-method' | 'no-decompression';

export class ZipError extends Error {
  constructor(public readonly code: ZipErrorCode, message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

export interface ZipEntry {
  /** Full path inside the archive, `/`-separated (e.g. `logs/PHD2_GuideLog_….txt`). */
  path: string;
  /** Last path segment — what the log-pairing logic matches on. */
  name: string;
  /** Uncompressed size in bytes. */
  size: number;
  compressedSize: number;
  method: number;
  flags: number;
  localHeaderOffset: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const ZIP64_LOCATOR_LEN = 20;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

const readBytes = async (blob: Blob, start: number, end: number): Promise<DataView> =>
  new DataView(await blob.slice(start, end).arrayBuffer());

// DataView has no native u64 getter that returns a number; zip offsets/sizes fit
// comfortably in 2^53, so combine the halves.
const u64 = (v: DataView, at: number): number =>
  v.getUint32(at, true) + v.getUint32(at + 4, true) * 0x1_0000_0000;

/** True when the blob starts with a ZIP local-file or EOCD signature. */
export async function looksLikeZip(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false;
  const sig = (await readBytes(blob, 0, 4)).getUint32(0, true);
  return sig === SIG_LOCAL || sig === SIG_EOCD;
}

/** List the file entries (directories omitted) from the central directory. */
export async function listZipEntries(zip: Blob): Promise<ZipEntry[]> {
  if (zip.size < EOCD_MIN) throw new ZipError('not-zip', 'File is too small to be a zip archive.');

  // The EOCD record sits at the very end, after an optional comment of up to
  // 64 KiB; read enough tail to cover that plus a ZIP64 locator before it.
  const tailStart = Math.max(0, zip.size - (EOCD_MIN + MAX_COMMENT + ZIP64_LOCATOR_LEN));
  const tail = await readBytes(zip, tailStart, zip.size);
  let eocd = -1;
  for (let i = tail.byteLength - EOCD_MIN; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('not-zip', 'No zip end-of-central-directory record found.');

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  // ZIP64: the classic fields are saturated and the real values live in the
  // ZIP64 EOCD record, found through the locator just before the classic EOCD.
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - ZIP64_LOCATOR_LEN;
    if (loc < 0 || tail.getUint32(loc, true) !== SIG_ZIP64_LOCATOR) {
      throw new ZipError('corrupt', 'ZIP64 archive is missing its locator record.');
    }
    const z64At = u64(tail, loc + 8);
    const z64 = await readBytes(zip, z64At, z64At + 56);
    if (z64.getUint32(0, true) !== SIG_ZIP64_EOCD) {
      throw new ZipError('corrupt', 'ZIP64 end-of-central-directory record is invalid.');
    }
    count = u64(z64, 32);
    cdSize = u64(z64, 40);
    cdOffset = u64(z64, 48);
  }
  if (cdOffset + cdSize > zip.size) throw new ZipError('corrupt', 'Zip central directory lies outside the file.');

  const cd = await readBytes(zip, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) {
      throw new ZipError('corrupt', 'Zip central directory is truncated or malformed.');
    }
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    // Bit 11 marks UTF-8 names; otherwise CP437, for which windows-1252 is the
    // closest decoder available (PHD2's own names are plain ASCII either way).
    const path = new TextDecoder(flags & FLAG_UTF8 ? 'utf-8' : 'windows-1252').decode(nameBytes);

    // ZIP64 extended-info extra field (0x0001) carries, in this order, only the
    // values whose classic field is saturated.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, q); q += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = u64(cd, q); }
      }
      e += 4 + len;
    }

    if (!path.endsWith('/')) {
      entries.push({
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        size, compressedSize, method, flags, localHeaderOffset,
      });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Extract one entry as a `File` named after its last path segment. Only this
 * entry's bytes are read and inflated.
 */
export async function readZipEntry(zip: Blob, entry: ZipEntry): Promise<File> {
  if (entry.flags & FLAG_ENCRYPTED) {
    throw new ZipError('encrypted', `${entry.name} is encrypted (password-protected zip).`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError('unsupported-method', `${entry.name} uses an unsupported zip compression method (${entry.method}).`);
  }
  // The data starts after the LOCAL header, whose name/extra lengths can differ
  // from the central directory's copy — so read them from the local header.
  const local = await readBytes(zip, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  if (local.getUint32(0, true) !== SIG_LOCAL) {
    throw new ZipError('corrupt', `Local header for ${entry.name} is invalid.`);
  }
  const dataStart = entry.localHeaderOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const data = zip.slice(dataStart, dataStart + entry.compressedSize);
  let blob: Blob;
  if (entry.method === 0) {
    blob = data;
  } else {
    if (typeof DecompressionStream === 'undefined') {
      throw new ZipError('no-decompression', 'This browser cannot decompress zip files.');
    }
    try {
      blob = await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    } catch {
      throw new ZipError('corrupt', `${entry.name} could not be decompressed (corrupt archive?).`);
    }
  }
  return new File([blob], entry.name, { type: 'text/plain' });
}
