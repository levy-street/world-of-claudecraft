// Cut one KTX2 texture in two valid KTX2 files along its top mip level (the WOC armor split,
// 2026-10-03; build_woc_split.mjs): the HALF (levels 1 to n, a texture of its own at half the
// size) and the TOP (level 0 alone, a one-level texture). A texture's top level is three
// quarters of its bytes and only a close-up samples it, so the medium armor file ships the half
// and the top file ships level 0, which the runtime lays back over the half
// (src/render/characters/woc_armor_top_levels.ts). Pure: bytes in, bytes out, no I/O.
//
// The container (KTX 2.0 specification, section 3), every number little endian:
//   identifier          12 bytes, the KTX 20 magic
//   header              vkFormat, typeSize, pixelWidth, pixelHeight, pixelDepth, layerCount,
//                       faceCount, levelCount, supercompressionScheme (nine 32 bit fields)
//   index               dfdByteOffset, dfdByteLength, kvdByteOffset, kvdByteLength (32 bit),
//                       sgdByteOffset, sgdByteLength (64 bit)
//   level index         per level, level 0 (the largest) first: byteOffset, byteLength,
//                       uncompressedByteLength (64 bit each)
//   data format descriptor, key/value data, supercompression global data
//   level data          SMALLEST level first, level 0 last
// A cut keeps the descriptor and the key/value data byte for byte (neither says anything about
// size or level count here), rewrites the header's size and level count and every offset, and
// moves each level's bytes as they are.
//
// Only what the split build encodes is taken: a plain 2D texture (no depth, no array layers,
// one face) of UASTC blocks (vkFormat UNDEFINED, descriptor colour model UASTC) under Zstandard
// supercompression, with two levels or more. Zstandard compresses every level on its own, so a
// level's bytes stand alone; it needs no global data; and a supercompressed level is aligned to
// one byte, so nothing is padded. Anything else is refused with the reason: BasisLZ (ETC1S)
// keeps per-image records in its global data that a cut would have to rewrite, and an
// uncompressed payload carries alignment rules this does not.

/** The KTX 2.0 file identifier. */
export const KTX2_IDENTIFIER = Uint8Array.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** supercompressionScheme: Zstandard. */
export const KTX2_SUPERCOMPRESSION_ZSTD = 2;
/** Data format descriptor colour model: UASTC. */
export const KTX2_DF_MODEL_UASTC = 166;
/** Bytes before the level index: the identifier, the header and the index. */
export const KTX2_LEVEL_INDEX_OFFSET = 80;
/** Bytes of one level index entry. */
export const KTX2_LEVEL_INDEX_ENTRY = 24;

function fail(why) {
  throw new Error(`ktx2_levels: ${why}`);
}

/** A 64 bit field that fits a JavaScript number (any file this size does). */
function u64(view, at) {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`a 64 bit field at ${at} is too large`);
  return Number(value);
}

/** Read a KTX2 container into its header fields, its descriptor, key/value and global data,
 *  and its levels (level 0 first), each with its bytes. Checks the layout only. */
export function readKtx2(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < KTX2_LEVEL_INDEX_OFFSET) fail(`${b.length} bytes is shorter than a KTX2 header`);
  for (let i = 0; i < KTX2_IDENTIFIER.length; i++) {
    if (b[i] !== KTX2_IDENTIFIER[i]) fail('not a KTX2 file (bad identifier)');
  }
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (at) => view.getUint32(at, true);
  const header = {
    vkFormat: u32(12),
    typeSize: u32(16),
    pixelWidth: u32(20),
    pixelHeight: u32(24),
    pixelDepth: u32(28),
    layerCount: u32(32),
    faceCount: u32(36),
    levelCount: u32(40),
    supercompressionScheme: u32(44),
  };
  const index = {
    dfdByteOffset: u32(48),
    dfdByteLength: u32(52),
    kvdByteOffset: u32(56),
    kvdByteLength: u32(60),
    sgdByteOffset: u64(view, 64),
    sgdByteLength: u64(view, 72),
  };
  const count = Math.max(1, header.levelCount);
  const levelsEnd = KTX2_LEVEL_INDEX_OFFSET + KTX2_LEVEL_INDEX_ENTRY * count;
  if (levelsEnd > b.length) fail('the level index runs past the end of the file');
  const span = (offset, length, what) => {
    if (length === 0) return new Uint8Array(0);
    if (offset < levelsEnd || offset + length > b.length) fail(`the ${what} lies outside the file`);
    return b.subarray(offset, offset + length);
  };
  const levels = [];
  for (let i = 0; i < count; i++) {
    const at = KTX2_LEVEL_INDEX_OFFSET + KTX2_LEVEL_INDEX_ENTRY * i;
    const byteOffset = u64(view, at);
    const byteLength = u64(view, at + 8);
    levels.push({
      byteOffset,
      byteLength,
      uncompressedByteLength: u64(view, at + 16),
      data: span(byteOffset, byteLength, `level ${i}`),
    });
  }
  return {
    ...header,
    ...index,
    dfd: span(index.dfdByteOffset, index.dfdByteLength, 'data format descriptor'),
    kvd: span(index.kvdByteOffset, index.kvdByteLength, 'key/value data'),
    sgd: span(index.sgdByteOffset, index.sgdByteLength, 'supercompression global data'),
    levels,
  };
}

/** Refuse anything but the one shape a cut is written for (see the header). */
export function assertSplittableKtx2(ktx) {
  if (ktx.supercompressionScheme !== KTX2_SUPERCOMPRESSION_ZSTD) {
    fail(`supercompression scheme ${ktx.supercompressionScheme} is not Zstandard (2)`);
  }
  if (ktx.vkFormat !== 0) fail(`vkFormat ${ktx.vkFormat} is not a UASTC (UNDEFINED) texture`);
  if (ktx.dfd.length < 16 || ktx.dfd[12] !== KTX2_DF_MODEL_UASTC) {
    fail(`the data format descriptor's colour model ${ktx.dfd[12]} is not UASTC (166)`);
  }
  if (ktx.sgdByteLength !== 0) fail('a Zstandard texture carries no supercompression global data');
  if (ktx.pixelWidth < 1 || ktx.pixelHeight < 1 || ktx.pixelDepth !== 0) {
    fail(`a ${ktx.pixelWidth} x ${ktx.pixelHeight} x ${ktx.pixelDepth} texture is not 2D`);
  }
  if (ktx.layerCount > 1 || ktx.faceCount !== 1) {
    fail('only a plain 2D texture is cut (no array layers, one face)');
  }
  if (ktx.levelCount < 2) fail(`${ktx.levelCount} level(s): nothing to cut`);
}

/**
 * Write a KTX2 container: `ktx` carries the header fields, `dfd`, `kvd` and `levels` (level 0
 * first, each with its `data` and `uncompressedByteLength`). Laid out as the encoder lays a
 * supercompressed texture out: the level index, the descriptor, the key/value data, then the
 * levels smallest first, packed (one byte alignment) right after the key/value data. A
 * Zstandard texture only: no global data.
 */
export function writeKtx2(ktx) {
  const levels = ktx.levels;
  if (levels.length < 1) fail('a texture needs a level');
  if ((ktx.sgd?.length ?? 0) !== 0) fail('writing supercompression global data is not supported');
  const dfdByteOffset = KTX2_LEVEL_INDEX_OFFSET + KTX2_LEVEL_INDEX_ENTRY * levels.length;
  const kvdByteOffset = dfdByteOffset + ktx.dfd.length;
  const dataStart = kvdByteOffset + ktx.kvd.length;
  let size = dataStart;
  for (const level of levels) size += level.data.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(KTX2_IDENTIFIER, 0);
  const fields = [
    ktx.vkFormat,
    ktx.typeSize,
    ktx.pixelWidth,
    ktx.pixelHeight,
    ktx.pixelDepth,
    ktx.layerCount,
    ktx.faceCount,
    levels.length,
    ktx.supercompressionScheme,
  ];
  fields.forEach((value, i) => {
    view.setUint32(12 + 4 * i, value, true);
  });
  view.setUint32(48, dfdByteOffset, true);
  view.setUint32(52, ktx.dfd.length, true);
  // a key/value block of no bytes has no offset (the specification's zero)
  view.setUint32(56, ktx.kvd.length > 0 ? kvdByteOffset : 0, true);
  view.setUint32(60, ktx.kvd.length, true);
  view.setBigUint64(64, 0n, true);
  view.setBigUint64(72, 0n, true);
  out.set(ktx.dfd, dfdByteOffset);
  out.set(ktx.kvd, kvdByteOffset);
  let at = dataStart;
  for (let i = levels.length - 1; i >= 0; i--) {
    const level = levels[i];
    const entry = KTX2_LEVEL_INDEX_OFFSET + KTX2_LEVEL_INDEX_ENTRY * i;
    view.setBigUint64(entry, BigInt(at), true);
    view.setBigUint64(entry + 8, BigInt(level.data.length), true);
    view.setBigUint64(entry + 16, BigInt(level.uncompressedByteLength), true);
    out.set(level.data, at);
    at += level.data.length;
  }
  return out;
}

/**
 * Cut a UASTC + Zstandard KTX2 texture along its top level: `half` is levels 1 to n at half the
 * size (a GPU's halving: each side floored, never below one), `top` is level 0 alone at the full
 * size. Every level's bytes move as they are, so half's levels and top's level together are the
 * original's, byte for byte.
 */
export function splitKtx2TopLevel(bytes) {
  const ktx = readKtx2(bytes);
  assertSplittableKtx2(ktx);
  const [level0, ...below] = ktx.levels;
  const top = writeKtx2({ ...ktx, levels: [level0] });
  const half = writeKtx2({
    ...ktx,
    pixelWidth: Math.max(1, ktx.pixelWidth >> 1),
    pixelHeight: Math.max(1, ktx.pixelHeight >> 1),
    levels: below,
  });
  return { half, top };
}
