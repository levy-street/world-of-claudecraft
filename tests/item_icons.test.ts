import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { ITEM_IMAGE_IDS, iconDataUrl, itemImageUrl, UI_ITEM_IMAGE_IDS } from '../src/ui/icons';

// Gate for the committed WebP item icons (mirror of tests/skill_icons.test.ts). Art under
// public/ui/items/<id>.webp is the source of truth (WebP only), served by itemImageUrl for
// kind 'item' (bags, tooltips, loot, vendor, the /wiki guide). The guard is a bijection plus
// a scope check (wired ids are real, non-equipment items):
//   A) every id in ITEM_IMAGE_IDS resolves to a committed, VALID .webp;
//   B) only .webp art (+ mapping.json) is committed under public/ui/items;
//   C) every committed .webp is a WIRED id (an item id, or a UI pseudo-item id);
//   D) every wired ITEM id is a real ITEMS entry that is not a weapon (weapons ship rendered
//      model thumbnails via WEAPON_ICON_DIR; everything else, armor included, lives here),
//      and every UI pseudo-item id is deliberately NOT an item (the two sets stay disjoint);
//   E) the whole bag family (the 5 equippable bags + the implicit backpack) is image-backed,
//      so the bag bar never mixes painted art with a procedural fallback.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const itemsDir = path.join(publicDir, 'ui/items');

const isDotfile = (p: string): boolean => path.basename(p).startsWith('.');
const isMapping = (p: string): boolean => path.basename(p) === 'mapping.json';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

// The 6 equippable bags. Pinned as a literal (guard F walks it for the per-bag license
// override), so a renamed bag or a drifted `kind` fails loudly instead of dropping out of
// the coverage.
const BAG_IDS = [
  'gravewoven_bag',
  'linen_pouch',
  'mistcallers_duffel',
  'silkspun_satchel',
  'travelers_knapsack',
  'wolfhide_satchel',
];

// Dimensions straight out of the WebP header (lossy VP8, lossless VP8L, extended VP8X), so the
// size guard needs no image dependency. Layout: 12-byte RIFF/WEBP preamble, then a 4-char chunk
// tag at 12 and its 4-byte size at 16, so the chunk payload starts at byte 20.
function webpSize(file: string): { width: number; height: number } {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(32);
    readSync(fd, buf, 0, 32, 0);
    const tag = buf.toString('ascii', 12, 16);
    if (tag === 'VP8 ')
      // simple lossy: 14-bit width/height follow the 3-byte start code + 2-byte signature
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (tag === 'VP8L') {
      // lossless: 1-byte signature, then 14-bit width-1 and 14-bit height-1, little-endian
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (tag === 'VP8X')
      // extended: 24-bit canvas width-1 / height-1 after the 4-byte flags field
      return {
        width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
        height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
      };
    throw new Error(`unknown webp chunk "${tag}" in ${file}`);
  } finally {
    closeSync(fd);
  }
}

function isValidWebp(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(12);
    const n = readSync(fd, buf, 0, 12, 0);
    return (
      n === 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
    );
  } finally {
    closeSync(fd);
  }
}

const webpFiles = (): string[] =>
  walk(itemsDir).filter((p) => path.extname(p).toLowerCase() === '.webp');

type Mapping = {
  iconSize: number;
  entries: { itemId: string; name: string; sourcePack: string; license?: string }[];
};
const mapping = (): Mapping =>
  JSON.parse(readFileSync(path.join(itemsDir, 'mapping.json'), 'utf8')) as Mapping;

describe('item webp icons', () => {
  it('has image-backed item ids wired (guards the fixture)', () => {
    expect(ITEM_IMAGE_IDS.size).toBeGreaterThan(0);
  });

  it('A) every image-backed item id resolves to a committed, valid .webp', () => {
    const broken: string[] = [];
    for (const id of [...ITEM_IMAGE_IDS, ...UI_ITEM_IMAGE_IDS]) {
      const url = itemImageUrl(id);
      expect(url, `${id} must resolve to a webp url`).toMatch(/^\/ui\/items\/.+\.webp$/);
      const file = path.join(publicDir, (url as string).replace(/^\//, ''));
      if (!existsSync(file)) broken.push(`${id} -> ${url} (missing file)`);
      else if (!isValidWebp(file)) broken.push(`${id} -> ${url} (not a valid webp)`);
    }
    expect(broken).toEqual([]);
  });

  it('B) commits only webp art (+ mapping.json) under public/ui/items', () => {
    const stray = walk(itemsDir)
      .filter((p) => !isDotfile(p) && !isMapping(p) && path.extname(p).toLowerCase() !== '.webp')
      .map((p) => path.relative(repoRoot, p));
    expect(stray, 'run the item icon converter; only .webp + mapping.json may live here').toEqual(
      [],
    );
  });

  it('C) every committed webp is a wired item id', () => {
    const orphans: string[] = [];
    for (const file of webpFiles()) {
      const id = path.basename(file, '.webp');
      if (!ITEM_IMAGE_IDS.has(id) && !UI_ITEM_IMAGE_IDS.has(id))
        orphans.push(`${path.relative(repoRoot, file)} (not in ITEM_IMAGE_IDS/UI_ITEM_IMAGE_IDS)`);
    }
    expect(orphans, 'remove dead-weight art or wire the id into ITEM_IMAGE_IDS').toEqual([]);
  });

  it('D) every wired id is a real, non-weapon item', () => {
    const bad: string[] = [];
    for (const id of ITEM_IMAGE_IDS) {
      const def = (ITEMS as Record<string, { kind?: string }>)[id];
      if (!def) bad.push(`${id} (no such item)`);
      else if (def.kind === 'weapon') bad.push(`${id} (weapon: has its own rendered-JPG pipeline)`);
    }
    expect(
      bad,
      'ITEM_IMAGE_IDS covers real items only; weapons use WEAPON_ICON_DIR thumbnails instead',
    ).toEqual([]);
  });

  it('D2) every UI pseudo-item id is not a real item (the two sets stay disjoint)', () => {
    expect([...UI_ITEM_IMAGE_IDS], 'the backpack is the only UI pseudo-item today').toEqual([
      'backpack',
    ]);
    const leaked: string[] = [];
    for (const id of UI_ITEM_IMAGE_IDS) {
      if ((ITEMS as Record<string, unknown>)[id]) leaked.push(`${id} (is a real item)`);
      if (ITEM_IMAGE_IDS.has(id)) leaked.push(`${id} (also in ITEM_IMAGE_IDS)`);
    }
    expect(
      leaked,
      'UI_ITEM_IMAGE_IDS is only for icon ids with no ITEMS record (the implicit backpack); ' +
        'a real item belongs in ITEM_IMAGE_IDS, where guard D checks it',
    ).toEqual([]);
  });

  it('E) every bag, and the implicit backpack, renders painted art (not a procedural icon)', () => {
    const bagIds = Object.entries(ITEMS as Record<string, { kind?: string }>)
      .filter(([, def]) => def.kind === 'bag')
      .map(([id]) => id)
      .sort();
    // Pinned to the literal set, not just a count: a renamed bag (or one whose kind drifts off
    // 'bag') would otherwise drop silently out of the loop below and take its coverage with it.
    // A NEW bag belongs here AND in ITEM_IMAGE_IDS: adding it without art fails this test.
    expect(bagIds).toEqual([
      'gravewoven_bag',
      'linen_pouch',
      'mistcallers_duffel',
      'silkspun_satchel',
      'travelers_knapsack',
      'wolfhide_satchel',
    ]);
    // The backpack is the bag bar's first socket and has no ITEMS record, so it is wired as a
    // UI pseudo-item; without it the bar would mix one drawn icon in with the painted set.
    for (const id of [...bagIds, 'backpack']) {
      // iconDataUrl is the surface the bag bar, tooltips, loot, and the vendor actually call.
      // In this Node env it can ONLY return an image URL: an unwired id would fall through to
      // the canvas recipe and throw, so a dropped id fails here rather than silently
      // regressing to the procedural sack.
      expect(iconDataUrl('item', id), `${id} must serve committed bag art`).toBe(
        `/ui/items/${id}.webp`,
      );
    }
  });

  it('F) every committed icon has a provenance entry in mapping.json, and vice versa', () => {
    const m = mapping();
    const files = webpFiles().map((f) => path.basename(f, '.webp'));
    const listed = m.entries.map((e) => e.itemId);
    expect(
      files.filter((id) => !listed.includes(id)),
      'art without provenance: add its entry (source + license) to mapping.json',
    ).toEqual([]);
    expect(
      listed.filter((id) => !files.includes(id)),
      'mapping.json lists art that is not committed: drop the stale entry',
    ).toEqual([]);
    // The bag family is project-owned art, so each of its entries overrides the file-level
    // CraftPix license. A bag icon silently inheriting the pack license would misattribute it.
    for (const id of [...BAG_IDS, 'backpack']) {
      const entry = m.entries.find((e) => e.itemId === id);
      expect(entry?.license, `${id} must carry its own license override`).toContain(
        'World of ClaudeCraft original art',
      );
    }
  });

  it('G) every committed icon is the square declared by mapping.json (128px)', () => {
    const m = mapping();
    expect(
      m.iconSize,
      'the served icon square (mirrored by scripts/convert_item_icons_webp.mjs)',
    ).toBe(128);
    const wrong: string[] = [];
    for (const file of webpFiles()) {
      const { width, height } = webpSize(file);
      if (width !== m.iconSize || height !== m.iconSize)
        wrong.push(`${path.basename(file)} (${width}x${height})`);
    }
    expect(wrong, 'run `npm run assets:items`; item art is served at one fixed square').toEqual([]);
  });
});
