import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import { PROCEDURAL_ITEM_BASES } from '../src/sim/content/procedural_loot';
import { ITEMS } from '../src/sim/data';
import { ITEM_IMAGE_IDS, iconDataUrl, itemImageUrl, UI_ITEM_IMAGE_IDS } from '../src/ui/icons';

// Gate for the committed WebP item icons (mirror of tests/skill_icons.test.ts). Art under
// public/ui/items/<id>.webp is the source of truth (WebP only), served by itemImageUrl for
// kind 'item' (bags, tooltips, loot, vendor, the /wiki guide). The guard is a bijection plus
// a scope check (wired ids are real, non-equipment items):
//   A) every id in ITEM_IMAGE_IDS resolves to a committed, VALID .webp;
//   B) only .webp art (+ mapping.json) is committed under public/ui/items;
//   C) every committed top-level .webp is a WIRED id (an item id, or a UI pseudo-item id);
//   H) Procedural Loot v1 is exactly 34 legacy aliases plus 191 nested static states, all
//      schema-pinned, provenance-mapped, image-valid, orphan-free, and budgeted;
//   D) every wired ITEM id is a real ITEMS entry; only procedural-launch weapons may opt out of the rendered
//      thumbnail pipeline; everything else, armor included, lives here),
//      and every UI pseudo-item id is deliberately NOT an item (the two sets stay disjoint);
//   E) the whole bag family (the 5 equippable bags + the implicit backpack) is image-backed,
//      so the bag bar never mixes painted art with a procedural fallback.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const itemsDir = path.join(publicDir, 'ui/items');

const isDotfile = (p: string): boolean => path.basename(p).startsWith('.');
const isMapping = (p: string): boolean =>
  path.basename(p) === 'mapping.json' && path.dirname(p) === itemsDir;

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

// Professions 2.0 materials commissioned as one coherent painted set. This literal pin makes
// dropping a single prepared material from the registry, public tree, or provenance map fail
// even though the older generic item-art bijection would remain internally consistent.
const PROFESSION_MATERIAL_IDS = [
  'arcane_dust',
  'arcane_essence',
  'arcane_shard',
  'arcanite_bar',
  'ashwood_log',
  'cooking_salt',
  'copper_ore',
  'elderwood_log',
  'game_meat',
  'glass_vial',
  'goldleaf_herb',
  'homespun_cloth',
  'iron_ore',
  'ironbark_log',
  'prime_cut',
  'pristine_hide',
  'pristine_silk',
  'pristine_venom_gland',
  'resonant_hide',
  'resonant_links',
  'resonant_steel',
  'resonant_thread',
  'resonant_timber',
  'rough_hide',
  'silverleaf_herb',
  'smithing_flux',
  'spider_leg',
  'spider_silk',
  'spool_of_thread',
  'sunpetal_herb',
  'tanning_agent',
  'thorium_ore',
  'venom_gland',
] as const;

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

const relativeItemPath = (file: string): string =>
  path.relative(itemsDir, file).split(path.sep).join('/');

const topLevelWebpFiles = (): string[] =>
  webpFiles().filter((file) => path.dirname(file) === itemsDir);

const PROCEDURAL_SET_ROOT = 'procedural/v1';
const PROCEDURAL_RARITY_FALLBACKS = [
  { rarity: 'common', path: 'common.webp' },
  { rarity: 'magic', path: 'magic.webp' },
  { rarity: 'rare', path: 'rare.webp' },
  { rarity: 'epic', path: 'epic.webp' },
  { rarity: 'legendary', path: 'legendary/_fallback.webp' },
] as const;

type ProceduralSetMapping = {
  version: number;
  root: string;
  baseIds: string[];
  rarityFallbacks: { rarity: string; path: string }[];
  legendaryPowers: { baseId: string; powerId: string; revision: number }[];
  sourcePack: string;
  sourceFile: string;
  license: string;
};

type Mapping = {
  iconSize: number;
  proceduralSets: ProceduralSetMapping[];
  entries: {
    itemId: string;
    name: string;
    sourcePack: string;
    sourceFile: string;
    license?: string;
  }[];
};
const mapping = (): Mapping =>
  JSON.parse(readFileSync(path.join(itemsDir, 'mapping.json'), 'utf8')) as Mapping;

const canonicalProceduralBaseIds = (): string[] => Object.keys(PROCEDURAL_ITEM_BASES).sort();

const canonicalProceduralPowers = (): ProceduralSetMapping['legendaryPowers'] =>
  Object.values(PROCEDURAL_LEGENDARY_POWERS)
    .flatMap((power) =>
      power.compatibleBaseIds.map((baseId) => ({
        baseId,
        powerId: power.id,
        revision: power.revision,
      })),
    )
    .sort(
      (a, b) =>
        a.baseId.localeCompare(b.baseId) ||
        a.powerId.localeCompare(b.powerId) ||
        a.revision - b.revision,
    );

function expectedNestedProceduralPaths(): string[] {
  const rarityPaths = canonicalProceduralBaseIds().flatMap((baseId) =>
    PROCEDURAL_RARITY_FALLBACKS.map(
      (fallback) => `${PROCEDURAL_SET_ROOT}/${baseId}/${fallback.path}`,
    ),
  );
  const powerPaths = canonicalProceduralPowers().map(
    ({ baseId, powerId, revision }) =>
      `${PROCEDURAL_SET_ROOT}/${baseId}/legendary/${powerId}.r${revision}.webp`,
  );
  return [...rarityPaths, ...powerPaths].sort();
}

const proceduralAssetFiles = (): string[] => {
  const baseIds = new Set(canonicalProceduralBaseIds());
  return webpFiles().filter((file) => {
    const relative = relativeItemPath(file);
    return (
      relative.startsWith(`${PROCEDURAL_SET_ROOT}/`) ||
      (!relative.includes('/') && baseIds.has(path.basename(file, '.webp')))
    );
  });
};

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

  it('C) every committed top-level webp is a wired item id', () => {
    const orphans: string[] = [];
    for (const file of topLevelWebpFiles()) {
      const id = path.basename(file, '.webp');
      if (!ITEM_IMAGE_IDS.has(id) && !UI_ITEM_IMAGE_IDS.has(id))
        orphans.push(`${path.relative(repoRoot, file)} (not in ITEM_IMAGE_IDS/UI_ITEM_IMAGE_IDS)`);
    }
    expect(orphans, 'remove dead-weight art or wire the id into ITEM_IMAGE_IDS').toEqual([]);
  });

  it('D) every wired id is a real item, with only procedural-launch weapon exceptions', () => {
    const bad: string[] = [];
    for (const id of ITEM_IMAGE_IDS) {
      const def = (ITEMS as Record<string, { kind?: string }>)[id];
      if (!def) bad.push(`${id} (no such item)`);
      else if (def.kind === 'weapon' && !PROCEDURAL_ITEM_BASES[id])
        bad.push(`${id} (weapon: has its own rendered-JPG pipeline)`);
    }
    expect(
      bad,
      'ITEM_IMAGE_IDS covers real items; only procedural-launch weapons may override thumbnails',
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
    const files = topLevelWebpFiles().map((f) => path.basename(f, '.webp'));
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

  it('F2) ships the complete project-owned professions material art set', () => {
    const m = mapping();
    const canonical = [...PROFESSION_MATERIAL_IDS].sort();
    const files = new Set(webpFiles().map((file) => path.basename(file, '.webp')));
    const projectOwnedIds = m.entries
      .filter((entry) => entry.sourcePack === 'woc_professions_art')
      .map((entry) => entry.itemId)
      .sort();
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'docs/design/professions-asset-manifest.json'), 'utf8'),
    ) as {
      categories: {
        name: string;
        assets?: {
          id: string;
          batch: string;
          acceptedVersion: string;
        }[];
      }[];
    };
    const manifestEntries = manifest.categories.find((category) =>
      category.name.startsWith('Material item icons'),
    )?.assets;
    expect(
      manifestEntries,
      'the material manifest category must enumerate its exact assets',
    ).toBeDefined();
    const declaredIds = (manifestEntries ?? []).map((entry) => entry.id).sort();

    // Reverse exactness matters here: the generic item-art bijection would accept a 34th file
    // if it were also wired and mapped. The commissioned professions set is intentionally the
    // literal 33-id set above, so any added or dropped project-owned material fails this arm.
    expect(projectOwnedIds).toEqual(canonical);
    expect(declaredIds).toEqual(canonical);
    expect(projectOwnedIds.filter((id) => files.has(id)).sort()).toEqual(canonical);
    expect(projectOwnedIds.filter((id) => ITEM_IMAGE_IDS.has(id)).sort()).toEqual(canonical);

    for (const id of PROFESSION_MATERIAL_IDS) {
      expect(ITEM_IMAGE_IDS.has(id), `${id} must be wired into ITEM_IMAGE_IDS`).toBe(true);
      expect(existsSync(path.join(itemsDir, `${id}.webp`)), `${id}.webp must be committed`).toBe(
        true,
      );
      const entry = m.entries.find((candidate) => candidate.itemId === id);
      expect(entry?.sourcePack, `${id} must retain its professions-art provenance`).toBe(
        'woc_professions_art',
      );
      const declared = manifestEntries?.find((candidate) => candidate.id === id);
      expect(entry?.sourceFile, `${id} mapping and manifest batch/version must agree`).toBe(
        `${declared?.batch}/masters/${id}.png (accepted ${declared?.acceptedVersion})`,
      );
      expect(entry?.license, `${id} must override the mapping's CraftPix default`).toContain(
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
  it('H) mapping.json declares the exact Procedural Loot v1 provenance contract', () => {
    const sets = mapping().proceduralSets;
    expect(sets, 'mapping.json must carry one scalable proceduralSets record').toHaveLength(1);
    const set = sets[0];
    expect(set.version).toBe(1);
    expect(set.root).toBe(PROCEDURAL_SET_ROOT);
    expect([...set.baseIds].sort()).toEqual(canonicalProceduralBaseIds());
    expect(set.baseIds).toHaveLength(34);
    expect(set.rarityFallbacks).toEqual(PROCEDURAL_RARITY_FALLBACKS);
    expect(set.legendaryPowers).toEqual(canonicalProceduralPowers());
    expect(set.legendaryPowers).toHaveLength(21);
    expect(set.sourcePack).toBe('woc_procedural_loot_art');
    expect(set.sourceFile).toContain('OpenAI image generation');
    expect(set.license).toContain('World of ClaudeCraft original art');
    expect(set.license).toContain('AI-assisted');
  });

  it('H2) has an exact 225-file procedural inventory: 34 aliases plus 191 nested states', () => {
    const expectedLegacy = canonicalProceduralBaseIds().map((baseId) => `${baseId}.webp`);
    const expectedNested = expectedNestedProceduralPaths();
    expect(expectedLegacy).toHaveLength(34);
    expect(expectedNested).toHaveLength(34 * 5 + 21);

    const actualLegacy = topLevelWebpFiles()
      .map(relativeItemPath)
      .filter((relative) => expectedLegacy.includes(relative))
      .sort();
    const actualNested = webpFiles()
      .map(relativeItemPath)
      .filter((relative) => relative.startsWith(`${PROCEDURAL_SET_ROOT}/`))
      .sort();

    expect({
      missingLegacy: expectedLegacy.filter((relative) => !actualLegacy.includes(relative)),
      unexpectedLegacy: actualLegacy.filter((relative) => !expectedLegacy.includes(relative)),
      missingNested: expectedNested.filter((relative) => !actualNested.includes(relative)),
      unexpectedNested: actualNested.filter((relative) => !expectedNested.includes(relative)),
    }).toEqual({
      missingLegacy: [],
      unexpectedLegacy: [],
      missingNested: [],
      unexpectedNested: [],
    });
  });

  it('H3) keeps every committed procedural file WebP-only, 128px, alpha, and sRGB', async () => {
    const invalid: string[] = [];
    for (const file of proceduralAssetFiles()) {
      const meta = await sharp(file).metadata();
      const relative = relativeItemPath(file);
      if (meta.format !== 'webp') invalid.push(`${relative} (format ${meta.format ?? 'unknown'})`);
      if (meta.width !== 128 || meta.height !== 128)
        invalid.push(`${relative} (${meta.width ?? '?'}x${meta.height ?? '?'})`);
      if (!meta.hasAlpha) invalid.push(`${relative} (missing alpha channel)`);
      if (meta.space !== 'srgb')
        invalid.push(`${relative} (colorspace ${meta.space ?? 'unknown'})`);
    }
    expect(invalid).toEqual([]);
  });

  it('H4) keeps procedural delivery below p95 20 KiB and 10 MiB total', () => {
    const sizes = proceduralAssetFiles()
      .map((file) => statSync(file).size)
      .sort((a, b) => a - b);
    expect(sizes.length).toBeGreaterThan(0);
    const p95 = sizes[Math.max(0, Math.ceil(sizes.length * 0.95) - 1)];
    const total = sizes.reduce((sum, size) => sum + size, 0);
    expect(p95, 'procedural icon p95 must stay at or below 20 KiB').toBeLessThanOrEqual(20 * 1024);
    expect(total, 'all 225 procedural icons must stay at or below 10 MiB').toBeLessThanOrEqual(
      10 * 1024 * 1024,
    );
  });

  it('I) recursively discovers nested converter inputs', () => {
    const source = readFileSync(path.join(repoRoot, 'scripts/convert_item_icons_webp.mjs'), 'utf8');
    expect(source).toMatch(/function sourceImages\(dir\)/);
    expect(source).toMatch(
      /if \(ent\.isDirectory\(\)\)\s*sources\.push\(\.\.\.sourceImages\(candidate\)\)/,
    );
    expect(source).toMatch(/const sources = sourceImages\(itemsDir\)\.sort\(\)/);
  });
});
