/**
 * Test-only ZIP writer: builds real archives in memory so the reader is tested
 * against genuine bytes (the real sample bundles live in the gitignored
 * `sample data/`). Deflate uses the platform CompressionStream, so callers must
 * run in vitest's `node` environment. CRCs are written as 0 — the reader
 * doesn't verify them.
 */

export interface FixtureEntry {
  path: string;
  data: string | Uint8Array<ArrayBuffer>;
  /** 0 = stored, 8 = deflate (default), anything else = an unsupported method. */
  method?: number;
  /** Extra general-purpose flag bits (e.g. 0x0001 = encrypted). */
  flags?: number;
}

export interface FixtureOptions {
  /** Write ZIP64 records (saturated classic fields + extra field + ZIP64 EOCD). */
  zip64?: boolean;
  /** Archive comment after the EOCD (the reader must scan past it). */
  comment?: string;
}

const enc = new TextEncoder();

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class Writer {
  parts: Uint8Array<ArrayBuffer>[] = [];
  length = 0;
  push(bytes: Uint8Array<ArrayBuffer>) { this.parts.push(bytes); this.length += bytes.length; }
  record(size: number, fill: (v: DataView) => void) {
    const b = new Uint8Array(size);
    fill(new DataView(b.buffer));
    this.push(b);
  }
}

const setU64 = (v: DataView, at: number, n: number) => {
  v.setUint32(at, n % 0x1_0000_0000, true);
  v.setUint32(at + 4, Math.floor(n / 0x1_0000_0000), true);
};

export async function makeZip(entries: FixtureEntry[], opts: FixtureOptions = {}): Promise<Blob> {
  const out = new Writer();
  const central = new Writer();
  for (const e of entries) {
    const name = enc.encode(e.path);
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const method = e.method ?? 8;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const flags = 0x0800 | (e.flags ?? 0); // UTF-8 names
    const offset = out.length;

    out.record(30, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, flags, true);
      v.setUint16(8, method, true);
      v.setUint32(18, opts.zip64 ? 0xffffffff : body.length, true);
      v.setUint32(22, opts.zip64 ? 0xffffffff : raw.length, true);
      v.setUint16(26, name.length, true);
    });
    out.push(name);
    out.push(body);

    const extraLen = opts.zip64 ? 4 + 24 : 0;
    central.record(46, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 45, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, flags, true);
      v.setUint16(10, method, true);
      v.setUint32(20, opts.zip64 ? 0xffffffff : body.length, true);
      v.setUint32(24, opts.zip64 ? 0xffffffff : raw.length, true);
      v.setUint16(28, name.length, true);
      v.setUint16(30, extraLen, true);
      v.setUint32(42, opts.zip64 ? 0xffffffff : offset, true);
    });
    central.push(name);
    if (opts.zip64) {
      central.record(extraLen, (v) => {
        v.setUint16(0, 0x0001, true);
        v.setUint16(2, 24, true);
        setU64(v, 4, raw.length);   // uncompressed
        setU64(v, 12, body.length); // compressed
        setU64(v, 20, offset);      // local header offset
      });
    }
  }

  const cdOffset = out.length;
  for (const p of central.parts) out.push(p);
  const cdSize = central.length;

  if (opts.zip64) {
    const z64Offset = out.length;
    out.record(56, (v) => {
      v.setUint32(0, 0x06064b50, true);
      setU64(v, 4, 44);
      v.setUint16(12, 45, true);
      v.setUint16(14, 45, true);
      setU64(v, 24, entries.length);
      setU64(v, 32, entries.length);
      setU64(v, 40, cdSize);
      setU64(v, 48, cdOffset);
    });
    out.record(20, (v) => {
      v.setUint32(0, 0x07064b50, true);
      setU64(v, 8, z64Offset);
      v.setUint32(16, 1, true);
    });
  }

  const comment = enc.encode(opts.comment ?? '');
  out.record(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, opts.zip64 ? 0xffff : entries.length, true);
    v.setUint16(10, opts.zip64 ? 0xffff : entries.length, true);
    v.setUint32(12, opts.zip64 ? 0xffffffff : cdSize, true);
    v.setUint32(16, opts.zip64 ? 0xffffffff : cdOffset, true);
    v.setUint16(20, comment.length, true);
  });
  out.push(comment);
  return new Blob(out.parts);
}

/** A zip fixture as a File (what a drop / picker hands the app). */
export async function makeZipFile(name: string, entries: FixtureEntry[], opts?: FixtureOptions): Promise<File> {
  return new File([await makeZip(entries, opts)], name, { type: 'application/zip' });
}
