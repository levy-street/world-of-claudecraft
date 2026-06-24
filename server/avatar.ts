// Deterministic class+skin avatar art, generated server-side with zero image
// dependencies (just node:zlib for the PNG IDAT). A character has no uploaded
// portrait, so the avatar is a pure function of (class, skin): a class-colored,
// vertically-symmetric "identicon" emblem seeded by class+skin. Same inputs →
// byte-identical PNG every time, so it caches well and never drifts.
//
// Ops can drop real pre-rendered art at public/avatar/<class>/<skin>.png to
// override this fallback (the route prefers the static file when present).

import { deflateSync } from 'node:zlib';
import type { PlayerClass } from '../src/sim/types';

export const PLAYER_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

export const MAX_SKIN = 7;

// Card-design class colors (shared palette in WORLD-OF-CLAUDECRAFT.md §6).
const CLASS_COLOR: Record<PlayerClass, [number, number, number]> = {
  warrior: [0xc7, 0x9c, 0x6e],
  paladin: [0xf5, 0x8c, 0xba],
  hunter: [0xab, 0xd4, 0x73],
  rogue: [0xff, 0xf5, 0x69],
  priest: [0xff, 0xff, 0xff],
  shaman: [0x00, 0x70, 0xde],
  mage: [0x69, 0xcc, 0xf0],
  warlock: [0x94, 0x82, 0xc9],
  druid: [0xff, 0x7d, 0x0a],
};

export function isPlayerClass(s: string): s is PlayerClass {
  return (PLAYER_CLASSES as readonly string[]).includes(s);
}

export function isValidSkin(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_SKIN;
}

// FNV-1a over the seed string → 32-bit unsigned. Deterministic, no Math.random.
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function clamp8(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

function scale([r, g, b]: [number, number, number], f: number): [number, number, number] {
  return [clamp8(r * f), clamp8(g * f), clamp8(b * f)];
}

const SIZE = 256; // output is SIZE×SIZE
const GRID = 8; // 8×8 emblem grid, left half mirrored to the right
const CELL = SIZE / GRID;

// Build the raw RGB pixel buffer for the avatar (no PNG framing yet).
function renderPixels(cls: PlayerClass, skin: number): Buffer {
  const color = CLASS_COLOR[cls];
  // Background: a darkened class tint; foreground emblem: a skin-brightened tint.
  const bg = scale(color, 0.22);
  const fg = scale(color, 0.85 + skin * 0.04);
  // Seed the emblem on class+skin so each combo is visually distinct.
  let rng = hashSeed(`${cls}:${skin}`);
  const nextBit = (): boolean => {
    // xorshift32 step; take the top bit.
    rng ^= rng << 13;
    rng >>>= 0;
    rng ^= rng >> 17;
    rng ^= rng << 5;
    rng >>>= 0;
    return (rng & 0x80000000) !== 0;
  };

  // Decide each grid cell (left half), mirror horizontally for symmetry.
  const filled: boolean[][] = [];
  for (let row = 0; row < GRID; row++) {
    const r: boolean[] = new Array(GRID).fill(false);
    for (let col = 0; col < GRID / 2; col++) {
      const on = nextBit();
      r[col] = on;
      r[GRID - 1 - col] = on;
    }
    filled.push(r);
  }

  const pixels = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    const gridRow = Math.floor(y / CELL);
    for (let x = 0; x < SIZE; x++) {
      const gridCol = Math.floor(x / CELL);
      const [r, g, b] = filled[gridRow][gridCol] ? fg : bg;
      const o = (y * SIZE + x) * 3;
      pixels[o] = r;
      pixels[o + 1] = g;
      pixels[o + 2] = b;
    }
  }
  return pixels;
}

// ── Minimal PNG encoder (truecolor 8-bit RGB) ──────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Prepend a filter byte (0 = none) to each scanline.
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Public: a deterministic PNG avatar for (class, skin). Throws on bad inputs so
// the route can 404 a malformed request rather than serving garbage.
export function avatarPng(cls: PlayerClass, skin: number): Buffer {
  if (!isPlayerClass(cls)) throw new Error('invalid class');
  if (!isValidSkin(skin)) throw new Error('invalid skin');
  return encodePng(SIZE, SIZE, renderPixels(cls, skin));
}
