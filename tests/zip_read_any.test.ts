import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { type BundleFile, zipReadAny, zipStore } from '../src/editor/bundle';

// Build a DEFLATE zip the way standard tools do (central directory + method 8),
// so zipReadAny is exercised against a foreign-produced layout, not just our
// own STORED writer.
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function foreignZip(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  const enc = new TextEncoder();
  const push16 = (arr: number[], v: number) => arr.push(v & 0xff, (v >> 8) & 0xff);
  const push32 = (arr: number[], v: number) =>
    arr.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  for (const f of files) {
    const name = enc.encode(f.path);
    const comp = new Uint8Array(deflateRawSync(f.bytes));
    const crc = crc32(f.bytes);
    const localOff = chunks.length;
    push32(chunks, 0x04034b50);
    push16(chunks, 20); // version needed
    push16(chunks, 0); // flags
    push16(chunks, 8); // DEFLATE
    push16(chunks, 0);
    push16(chunks, 0); // time/date
    push32(chunks, crc);
    push32(chunks, comp.length);
    push32(chunks, f.bytes.length);
    push16(chunks, name.length);
    push16(chunks, 0);
    for (const b of name) chunks.push(b);
    for (const b of comp) chunks.push(b);
    push32(central, 0x02014b50);
    push16(central, 20);
    push16(central, 20);
    push16(central, 0);
    push16(central, 8);
    push16(central, 0);
    push16(central, 0);
    push32(central, crc);
    push32(central, comp.length);
    push32(central, f.bytes.length);
    push16(central, name.length);
    push16(central, 0);
    push16(central, 0);
    push16(central, 0);
    push16(central, 0);
    push32(central, 0);
    push32(central, localOff);
    for (const b of name) central.push(b);
  }
  const cdOff = chunks.length;
  for (const b of central) chunks.push(b);
  const eocd: number[] = [];
  push32(eocd, 0x06054b50);
  push16(eocd, 0);
  push16(eocd, 0);
  push16(eocd, files.length);
  push16(eocd, files.length);
  push32(eocd, central.length);
  push32(eocd, cdOff);
  push16(eocd, 0);
  for (const b of eocd) chunks.push(b);
  return new Uint8Array(chunks);
}

const enc = new TextEncoder();
const text = (files: BundleFile[] | null, path: string): string | null => {
  const f = files?.find((x) => x.path === path);
  return f ? new TextDecoder().decode(f.bytes) : null;
};

describe('zipReadAny', () => {
  it('reads our own STORED bundles', async () => {
    const zip = zipStore([
      { path: 'map.json', bytes: enc.encode('{"a":1}') },
      { path: 'models/abc.glb', bytes: new Uint8Array([1, 2, 3]) },
    ]);
    const files = await zipReadAny(zip);
    expect(files?.map((f) => f.path)).toEqual(['map.json', 'models/abc.glb']);
    expect(text(files, 'map.json')).toBe('{"a":1}');
  });

  it('reads foreign DEFLATE zips and skips macOS junk', async () => {
    const zip = foreignZip([
      { path: '__MACOSX/._map.json', bytes: enc.encode('junk') },
      { path: 'folder/.DS_Store', bytes: enc.encode('junk') },
      { path: 'folder/map.json', bytes: enc.encode('{"hello":"world"}') },
    ]);
    const files = await zipReadAny(zip);
    expect(files?.map((f) => f.path)).toEqual(['folder/map.json']);
    expect(text(files, 'folder/map.json')).toBe('{"hello":"world"}');
  });

  it('rejects non-zip bytes and corrupted payloads', async () => {
    expect(await zipReadAny(enc.encode('{"not":"a zip"}'))).toBeNull();
    const zip = foreignZip([{ path: 'map.json', bytes: enc.encode('{"a":1}') }]);
    // Entry 0's local header sits at offset 0: 30-byte header + 8-byte name,
    // then the deflate payload. Flip a byte INSIDE the payload.
    zip[30 + 'map.json'.length + 2] ^= 0xff;
    expect(await zipReadAny(zip)).toBeNull();
  });
});
