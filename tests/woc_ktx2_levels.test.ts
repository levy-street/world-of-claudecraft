import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error three ships ktx-parse (the reader KTX2Loader uses) untyped
import { read as readWithKtxParse } from 'three/examples/jsm/libs/ktx-parse.module.js';
import { describe, expect, it } from 'vitest';
import {
  KTX2_IDENTIFIER,
  readKtx2,
  splitKtx2TopLevel,
} from '../scripts/assets/woc_character/ktx2_levels.mjs';

// The KTX2 top-level cut of the WOC armor build (scripts/assets/woc_character/ktx2_levels.mjs,
// 2026-10-03): a texture becomes its HALF (levels 1 to n at half the size) and its TOP (level 0
// alone), two valid containers whose levels together are the original's byte for byte. A
// hand-built fixture pins the layout arithmetic against offsets written out here by hand, a
// real encoder output (the body atlas the split build encodes into base_male.glb) pins the
// bytes, and the KTX-Software validator, where this machine has it, pins the containers.

const ROOT = path.resolve(__dirname, '..');

/** The UASTC data format descriptor the encoder writes (44 bytes: its total size, one basic
 *  block, one sample), colour model at byte 12. */
function uastcDfd(model = 166): Uint8Array {
  const b = Buffer.alloc(44);
  b.writeUInt32LE(44, 0);
  b.writeUInt32LE(0, 4); // vendor 0, descriptor type 0
  b.writeUInt16LE(2, 8); // version
  b.writeUInt16LE(40, 10); // block size
  b[12] = model;
  b[13] = 1; // BT.709 primaries
  b[14] = 2; // sRGB transfer
  b[15] = 0;
  b.set([3, 3, 0, 0], 16); // 4 x 4 blocks
  b.set([16, 0, 0, 0, 0, 0, 0, 0], 20); // 16 bytes a block
  b.set([0, 0, 127, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255], 28);
  return new Uint8Array(b);
}

/** One key/value entry, padded to 4: "KTXwriter" = "test" (4 + 15 bytes, 1 of padding). */
const KVD = new Uint8Array(Buffer.from([19, 0, 0, 0, ...Buffer.from('KTXwriter\0test\0'), 0]));

/** Level payloads of odd lengths (a supercompressed level is aligned to one byte). */
const LEVEL = [
  new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6]), // level 0, 8 x 4
  new Uint8Array([0xb0, 0xb1, 0xb2, 0xb3, 0xb4]), // level 1, 4 x 2
  new Uint8Array([0xc0, 0xc1, 0xc2]), // level 2, 2 x 1
];
const UNCOMPRESSED = [32, 16, 16];

/** The 8 x 4, three-level fixture laid out BY HAND:
 *    0 identifier  12 header  48 index  80 level index (3 x 24)  152 DFD (44)  196 KVD (20)
 *    216 level 2 (3)  219 level 1 (5)  224 level 0 (7)  231 end */
function fixture(
  patch: Partial<{
    scheme: number;
    vkFormat: number;
    layers: number;
    faces: number;
    depth: number;
    levels: number;
    model: number;
    sgd: [number, number];
  }> = {},
): Uint8Array {
  const b = Buffer.alloc(231);
  b.set(KTX2_IDENTIFIER, 0);
  const header = [
    patch.vkFormat ?? 0,
    1,
    8,
    4,
    patch.depth ?? 0,
    patch.layers ?? 0,
    patch.faces ?? 1,
    patch.levels ?? 3,
    patch.scheme ?? 2,
  ];
  header.forEach((v, i) => {
    b.writeUInt32LE(v, 12 + 4 * i);
  });
  b.writeUInt32LE(152, 48);
  b.writeUInt32LE(44, 52);
  b.writeUInt32LE(196, 56);
  b.writeUInt32LE(20, 60);
  b.writeBigUInt64LE(BigInt(patch.sgd?.[0] ?? 0), 64);
  b.writeBigUInt64LE(BigInt(patch.sgd?.[1] ?? 0), 72);
  const at = [224, 219, 216];
  for (let i = 0; i < 3; i++) {
    b.writeBigUInt64LE(BigInt(at[i]), 80 + 24 * i);
    b.writeBigUInt64LE(BigInt(LEVEL[i].length), 88 + 24 * i);
    b.writeBigUInt64LE(BigInt(UNCOMPRESSED[i]), 96 + 24 * i);
    b.set(LEVEL[i], at[i]);
  }
  b.set(uastcDfd(patch.model), 152);
  b.set(KVD, 196);
  return new Uint8Array(b);
}

/** Read a written container's fields back with nothing but a DataView. */
function fields(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => v.getUint32(at, true);
  const u64 = (at: number) => Number(v.getBigUint64(at, true));
  const levelCount = u32(40);
  return {
    width: u32(20),
    height: u32(24),
    levelCount,
    scheme: u32(44),
    dfd: [u32(48), u32(52)],
    kvd: [u32(56), u32(60)],
    sgd: [u64(64), u64(72)],
    levels: Array.from({ length: levelCount }, (_, i) => [
      u64(80 + 24 * i),
      u64(88 + 24 * i),
      u64(96 + 24 * i),
    ]),
  };
}

const slice = (bytes: Uint8Array, [offset, length]: number[]) => [
  ...bytes.subarray(offset, offset + length),
];

describe('the KTX2 top-level cut, on a fixture laid out by hand', () => {
  it('reads the fixture where it was written', () => {
    const k = readKtx2(fixture());
    expect([k.pixelWidth, k.pixelHeight, k.levelCount, k.supercompressionScheme]).toEqual([
      8, 4, 3, 2,
    ]);
    expect([k.dfdByteOffset, k.dfdByteLength, k.kvdByteOffset, k.kvdByteLength]).toEqual([
      152, 44, 196, 20,
    ]);
    expect(k.levels.map((l) => [l.byteOffset, l.byteLength, l.uncompressedByteLength])).toEqual([
      [224, 7, 32],
      [219, 5, 16],
      [216, 3, 16],
    ]);
    expect(k.levels.map((l) => [...l.data])).toEqual(LEVEL.map((l) => [...l]));
  });

  it('writes the top as level 0 alone at the full size', () => {
    const { top } = splitKtx2TopLevel(fixture());
    // 80 + one 24-byte entry = 104 for the descriptor, 148 for the key/value data, the level
    // right after it at 168, 175 bytes in all
    expect(top.length).toBe(175);
    expect([...top.subarray(0, 12)]).toEqual([...KTX2_IDENTIFIER]);
    const f = fields(top);
    expect([f.width, f.height, f.levelCount, f.scheme]).toEqual([8, 4, 1, 2]);
    expect(f.dfd).toEqual([104, 44]);
    expect(f.kvd).toEqual([148, 20]);
    expect(f.sgd).toEqual([0, 0]);
    expect(f.levels).toEqual([[168, 7, 32]]);
    expect(slice(top, f.levels[0])).toEqual([...LEVEL[0]]);
    expect(slice(top, f.dfd)).toEqual([...uastcDfd()]);
    expect(slice(top, f.kvd)).toEqual([...KVD]);
    // the header fields the cut keeps: vkFormat, type size, depth, layers, faces
    const v = new DataView(top.buffer, top.byteOffset);
    expect([12, 16, 28, 32, 36].map((at) => v.getUint32(at, true))).toEqual([0, 1, 0, 0, 1]);
  });

  it('writes the half as levels 1 to n at half the size, smallest level first', () => {
    const { half } = splitKtx2TopLevel(fixture());
    // 80 + two entries = 128 for the descriptor, 172 for the key/value data, level 2 at 192,
    // level 1 at 195, 200 bytes in all
    expect(half.length).toBe(200);
    const f = fields(half);
    expect([f.width, f.height, f.levelCount, f.scheme]).toEqual([4, 2, 2, 2]);
    expect(f.dfd).toEqual([128, 44]);
    expect(f.kvd).toEqual([172, 20]);
    expect(f.levels).toEqual([
      [195, 5, 16],
      [192, 3, 16],
    ]);
    expect(slice(half, f.levels[0])).toEqual([...LEVEL[1]]);
    expect(slice(half, f.levels[1])).toEqual([...LEVEL[2]]);
    expect(slice(half, f.dfd)).toEqual([...uastcDfd()]);
    expect(slice(half, f.kvd)).toEqual([...KVD]);
  });

  it('halves an odd size the way a GPU does', () => {
    const odd = fixture();
    const v = new DataView(odd.buffer);
    v.setUint32(20, 5, true);
    v.setUint32(24, 3, true);
    const f = fields(splitKtx2TopLevel(odd).half);
    expect([f.width, f.height]).toEqual([2, 1]);
  });

  it('refuses every texture it is not written for, saying why', () => {
    const cut = (bytes: Uint8Array) => () => splitKtx2TopLevel(bytes);
    expect(cut(fixture({ scheme: 0 }))).toThrow(/not Zstandard/);
    expect(cut(fixture({ scheme: 1 }))).toThrow(/not Zstandard/);
    expect(cut(fixture({ vkFormat: 37 }))).toThrow(/UASTC/);
    expect(cut(fixture({ model: 163 }))).toThrow(/colour model 163/);
    expect(cut(fixture({ sgd: [152, 4] }))).toThrow(/global data/);
    expect(cut(fixture({ layers: 2 }))).toThrow(/array layers/);
    expect(cut(fixture({ faces: 6 }))).toThrow(/one face/);
    expect(cut(fixture({ depth: 2 }))).toThrow(/not 2D/);
    expect(cut(fixture({ levels: 1 }))).toThrow(/nothing to cut/);
    const bad = fixture();
    bad[0] = 0;
    expect(cut(bad)).toThrow(/identifier/);
    expect(cut(fixture().subarray(0, 228))).toThrow(/outside the file/);
    expect(cut(fixture().subarray(0, 60))).toThrow(/shorter than a KTX2 header/);
  });
});

/** The KTX2 image of a GLB, by index. */
function glbImage(file: string, index = 0): Uint8Array {
  const b = readFileSync(file);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  const bin = b.subarray(20 + len + 8);
  const view = json.bufferViews[json.images[index].bufferView];
  const at = view.byteOffset ?? 0;
  return new Uint8Array(bin.subarray(at, at + view.byteLength));
}

/** The KTX-Software CLI, where this machine has one (KTX_BIN, or the checkout's tmp/). */
function ktxBin(): string | null {
  const candidates = [
    process.env.KTX_BIN,
    path.join(ROOT, 'tmp', 'ktx-software', 'bin'),
    path.join(os.homedir(), 'world-of-claudecraft', 'tmp', 'ktx-software', 'bin'),
  ];
  for (const dir of candidates) if (dir && existsSync(path.join(dir, 'ktx'))) return dir;
  return null;
}

describe('the KTX2 top-level cut, on real encoder output', () => {
  // the body atlas the split build encodes from its PNG master: UASTC, Zstandard, its whole
  // mip chain generated by the encoder
  const original = glbImage(path.join(ROOT, 'public/models/chars/players/woc/base_male.glb'));
  const { half, top } = splitKtx2TopLevel(original);

  it('moves every level byte for byte: the top and the half together are the original', () => {
    const o = readKtx2(original);
    expect(o.levelCount).toBeGreaterThan(5);
    const h = readKtx2(half);
    const t = readKtx2(top);
    expect([t.pixelWidth, t.pixelHeight, t.levelCount]).toEqual([o.pixelWidth, o.pixelHeight, 1]);
    expect([h.pixelWidth, h.pixelHeight, h.levelCount]).toEqual([
      o.pixelWidth / 2,
      o.pixelHeight / 2,
      o.levelCount - 1,
    ]);
    const levels = [...t.levels, ...h.levels];
    expect(levels).toHaveLength(o.levels.length);
    levels.forEach((level, i) => {
      expect(Buffer.from(level.data).equals(Buffer.from(o.levels[i].data)), `level ${i}`).toBe(
        true,
      );
      expect(level.uncompressedByteLength, `level ${i}`).toBe(o.levels[i].uncompressedByteLength);
    });
    expect(Buffer.from(h.dfd).equals(Buffer.from(o.dfd))).toBe(true);
    expect(Buffer.from(t.kvd).equals(Buffer.from(o.kvd))).toBe(true);
    // nothing but the header, the index and the level index is added
    expect(half.length + top.length).toBe(original.length + o.dfd.length + o.kvd.length + 80);
  });

  it('writes containers another reader takes (three.js ktx-parse, the one KTX2Loader uses)', () => {
    for (const [bytes, levels, width] of [
      [half, readKtx2(original).levelCount - 1, 256],
      [top, 1, 512],
    ] as const) {
      const parsed = readWithKtxParse(bytes);
      expect(parsed.levelCount).toBe(levels);
      expect(parsed.pixelWidth).toBe(width);
      expect(parsed.supercompressionScheme).toBe(2);
      expect(parsed.levels).toHaveLength(levels);
    }
  });

  const bin = ktxBin();
  it.skipIf(bin === null)('passes the KTX-Software validator, both halves of the cut', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'woc-ktx2-levels-'));
    try {
      for (const [name, bytes] of [
        ['half.ktx2', half],
        ['top.ktx2', top],
        ['original.ktx2', original],
      ] as const) {
        const file = path.join(dir, name);
        writeFileSync(file, bytes);
        const env = {
          ...process.env,
          DYLD_FALLBACK_LIBRARY_PATH: bin as string,
          LD_LIBRARY_PATH: bin as string,
        };
        // throws (a non-zero exit) on any error the validator reports
        execFileSync(path.join(bin as string, 'ktx'), ['validate', file], { env, stdio: 'pipe' });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
