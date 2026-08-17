// Shared WebP header readers for asset-contract suites. Extracted from
// tests/chrome_icons.test.ts when tests/reliquary_cell_art.test.ts grew its
// own copy and the two diverged on the VP8L alpha bit: the original masked
// 0x08 on the byte after the size bits, which is bit 27 of the header word
// at offset 21, the MSB of height-1, NOT the alpha_is_used flag at bit 28.
// One implementation, spec-correct, so the next suite cannot fork it again.
import { closeSync, openSync, readSync } from 'node:fs';

export function webpHeader(file: string): { tag: string; buf: Buffer } {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(32);
    readSync(fd, buf, 0, 32, 0);
    return { tag: buf.toString('ascii', 12, 16), buf };
  } finally {
    closeSync(fd);
  }
}

/** Dimensions, read directly from each WebP encoding mode. */
export function webpSize(file: string): { width: number; height: number } {
  const { tag, buf } = webpHeader(file);
  if (tag === 'VP8 ')
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (tag === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (tag === 'VP8X')
    return {
      width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  throw new Error(`unknown webp chunk "${tag}" in ${file}`);
}

/**
 * Alpha presence. An extended (VP8X) file declares it in bit 4 of its
 * feature byte at offset 20. A lossless (VP8L) stream declares it in
 * alpha_is_used, bit 28 of the 32-bit word at offset 21 (after the 0x2f
 * signature byte: 14 width bits, 14 height bits, then the flag), verified
 * against the tree's real VP8L-with-alpha files under public/ui/procs. A
 * plain lossy VP8 chunk has no alpha channel at all, so it answers false by
 * construction.
 */
export function webpHasAlpha(file: string): boolean {
  const { tag, buf } = webpHeader(file);
  if (tag === 'VP8X') return (buf.readUInt8(20) & 0x10) !== 0;
  if (tag === 'VP8L') return ((buf.readUInt32LE(21) >>> 28) & 1) !== 0;
  return false;
}
