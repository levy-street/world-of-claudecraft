import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_CLASSES } from '../src/sim/types';
import { CLASS_ART_IDS, classIconUrl, hasClassIconArt } from '../src/ui/class_icon_art';

// Gate for the painted class emblems (sibling of tests/chrome_icons.test.ts). Art under
// public/ui/classes/<id>.webp is the source of truth (256px WebP, normalized by
// scripts/convert_class_icons_webp.mjs), served as a plain <img src> by the class picker on
// both character screens.
//
// The id set here is CLOSED, it is exactly PlayerClass, so the guard is a three-way
// bijection plus a validity pass:
//   A) CLASS_ART_IDS is exact set-equality with the committed .webp files, BOTH directions;
//   B) CLASS_ART_IDS is exact set-equality with ALL_CLASSES, BOTH directions, so adding a
//      tenth class reds this suite instead of shipping a rail with a hole in it;
//   C) only .webp art is committed under public/ui/classes (the converter deletes the
//      foreign original, and a stray .png would be dead weight nothing ever requests);
//   D) every committed webp is a valid RIFF/WEBP at the served 256px square;
//   plus the URL contract classIconUrl/hasClassIconArt promise.
// Filesystem + pure functions only, so it runs in the default node env with no canvas.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const classesDir = path.join(repoRoot, 'public/ui/classes');
const ICON_SIZE = 256;

// A real WebP starts with a RIFF container whose form-type is "WEBP" (bytes 8..12).
function webpHeader(file: string): { riff: boolean; tag: string; buf: Buffer } {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(32);
    const n = readSync(fd, buf, 0, 32, 0);
    return {
      riff:
        n === 32 &&
        buf.toString('ascii', 0, 4) === 'RIFF' &&
        buf.toString('ascii', 8, 12) === 'WEBP',
      tag: buf.toString('ascii', 12, 16),
      buf,
    };
  } finally {
    closeSync(fd);
  }
}

// Dimensions, read directly from each WebP encoding mode.
function webpSize(file: string): { width: number; height: number } {
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

const committed = (): string[] =>
  existsSync(classesDir)
    ? readdirSync(classesDir).filter((f) => !path.basename(f).startsWith('.'))
    : [];
const committedIds = (): string[] =>
  committed()
    .filter((f) => path.extname(f).toLowerCase() === '.webp')
    .map((f) => path.basename(f, '.webp'))
    .sort();

describe('class emblem art', () => {
  it('has one committed webp per class, in both directions', () => {
    expect(committedIds()).toEqual([...CLASS_ART_IDS].sort());
  });

  it('covers exactly ALL_CLASSES, so a new class cannot ship without art', () => {
    expect([...CLASS_ART_IDS].sort()).toEqual([...ALL_CLASSES].sort());
  });

  it('commits only webp art', () => {
    const foreign = committed().filter((f) => path.extname(f).toLowerCase() !== '.webp');
    expect(foreign).toEqual([]);
  });

  it('ships every emblem as a valid webp at the served square', () => {
    for (const id of committedIds()) {
      const file = path.join(classesDir, `${id}.webp`);
      expect(webpHeader(file).riff, `${id}.webp is not a RIFF/WEBP file`).toBe(true);
      expect(webpSize(file), `${id}.webp is not ${ICON_SIZE}px square`).toEqual({
        width: ICON_SIZE,
        height: ICON_SIZE,
      });
    }
  });

  it('resolves each class to its committed file and nothing else to anything', () => {
    for (const cls of ALL_CLASSES) {
      expect(hasClassIconArt(cls)).toBe(true);
      expect(classIconUrl(cls)).toBe(`/ui/classes/${cls}.webp`);
    }
    expect(hasClassIconArt('class_druid')).toBe(false);
    expect(classIconUrl('class_druid')).toBeNull();
    expect(classIconUrl('')).toBeNull();
  });

  it('is what the class picker paints its chips with', () => {
    // The chips are built in main.ts (decorateClassChips), which is far too entangled to
    // import here; pin the seam instead, so swapping the emblems back out for headshots
    // has to come through this test.
    const main = readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');
    expect(main).toContain('img.src = classIconUrl(cls)');
  });
});
