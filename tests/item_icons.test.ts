import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  ITEM_ART_PENDING,
  ITEM_IMAGE_IDS,
  iconDataUrl,
  isUnknownIconRecipe,
  itemIconRecipe,
  itemImageUrl,
  UI_ITEM_IMAGE_IDS,
} from '../src/ui/icons';
import { ITEM_WEAPON_VARIANTS } from '../src/ui/weapon_variants';

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
//   H) every real non-weapon item is image-backed, so the legacy procedural compositor is
//      reserved for UI fallbacks and future development only.
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

// These are the final originals replacing the tuning packet's temporary derived
// material, rod and charm art. Keep both the literal inventory and the former
// hashes: a later script must not silently put any placeholder back.
const PROFESSION_TUNING_ICON_IDS = [
  'fine_copper_ore',
  'fine_iron_ore',
  'fine_thorium_ore',
  'fine_ironbark_log',
  'fine_ashwood_log',
  'fine_elderwood_log',
  'fine_silverleaf_herb',
  'fine_goldleaf_herb',
  'fine_sunpetal_herb',
  'stormreel_fishing_rod',
  'tidewrought_fishing_rod',
  'gatherers_cache',
  'artisans_eye',
] as const;

const RETIRED_PLACEHOLDER_SHA256: Record<(typeof PROFESSION_TUNING_ICON_IDS)[number], string> = {
  fine_copper_ore: '0b5ecf01e9fdaa33724ed8862321f55782cac76bf3b97415482da6c49077dd06',
  fine_iron_ore: '4c8dba4958f35b147097807df4351add19ca9bd01334ca2de103db226d946bc7',
  fine_thorium_ore: 'a6d24dc7cbada4f757ba18d22a2f02c773b87337683b8aa99503abcf9c62f396',
  fine_ironbark_log: '92d9987741b0e1ba492e8265facdaab375bda7874a6397a61454721eddadfe40',
  fine_ashwood_log: 'ca9c2788532740680b366dd2195a6885c36c46482bff6eaa45a807825595c1c2',
  fine_elderwood_log: '4c24fdfb4305977a9df0498f8ea2e265f1ae618f90de66141862ce7f09f63853',
  fine_silverleaf_herb: '6400393de74c8e815b35800accad3c48f201506a12b51d2c39eb38bfd5f560dd',
  fine_goldleaf_herb: '72948f90131e99cce8167796ff6c4144c0fe7b01bd201f48ceefc8b4ca7e1451',
  fine_sunpetal_herb: '2ae01cc1b8b205f783cc967a4e67f5f56c9492363b25ab59d22b7cda9437fa51',
  stormreel_fishing_rod: '0a80b88d70e6ad865745cd3d96957abec33f48ddf78b72dfe5c5c57d994bff8a',
  tidewrought_fishing_rod: '6c5ab95babd52263c0835c69056768c0da1d136ab5e0a9caba2e84524d5222ba',
  gatherers_cache: 'b1e133d3cd1c259dfd2312ce459bd125d9fe4ffc54e5846313882253f5ac3105',
  artisans_eye: '74172be10b6ea60d17725e647506d92481e45efed5ac61b2c4a1157687385a77',
};

// Pin the exact reviewed shipping paintings, not just the retired encodings. That keeps a
// re-encoded placeholder, shifted crop, or unreviewed generator rerun from evading the old-hash
// guard while still satisfying the generic WebP dimensions and opacity checks below.
const ACCEPTED_TUNING_ICON_SHA256: Record<(typeof PROFESSION_TUNING_ICON_IDS)[number], string> = {
  fine_copper_ore: 'db9c1232ac7bf51d86bd570bba2063f89e48e76c6f0c266b177a3b5c52b1d8d9',
  fine_iron_ore: '240c74fd913ccdf509a423aa11a0319013ec6c225a9f522c21bdefdcc1dd0817',
  fine_thorium_ore: '318dc3dc7b41bb9fc868a1221b91b9f53f550566601ea35f8124546c54d62bd9',
  fine_ironbark_log: 'e45ee2deeff2b8b727ab0003db2b30eadb361f1fc7153ebc9c8f17b5de2eccfd',
  fine_ashwood_log: '50842add1fba62e21fcf48fdbf9265b527f8d4e9754ea5cd853373575b2e4f5c',
  fine_elderwood_log: 'c22a2f3e6f80924618a128ef4f4d1810069b36929897220a76b88459cd9d7e69',
  fine_silverleaf_herb: 'fbf9c46d1f9950a14527358937f11e4f58441fb3728676b508e92cfc460f5c94',
  fine_goldleaf_herb: '2bb651fc7a3f3cc1ff95eb9353495fc3f666217dbfc51d554c535f351128dd76',
  fine_sunpetal_herb: 'f87f0bc77eb6533c7ccd4043e929cc2741b643b5a4c5f750082cf15902227372',
  stormreel_fishing_rod: 'ad40f43616702dba9597cce052ce1d6f206cb5f393a311528cfa5f19860dee3b',
  tidewrought_fishing_rod: '2557439614fc44ca929b8769ad82e3796f13385b4f3f506ff290174882f199fa',
  gatherers_cache: 'b99f67cd54bb2a6038703311d8f7576282e13a932b4e174070f3c05112e02c8c',
  artisans_eye: '19635d3bd0074bcadb4cb7e60ba5cb5fc7eeb8ef6341e95808323a623345f1ea',
};

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
  entries: {
    itemId: string;
    name: string;
    sourcePack: string;
    sourceFile?: string;
    license?: string;
  }[];
  generatedBatches?: {
    source: string;
    license: string;
    styleReference: string;
    commonPrompt: string;
    itemIds: string[];
  }[];
};
const mapping = (): Mapping =>
  JSON.parse(readFileSync(path.join(itemsDir, 'mapping.json'), 'utf8')) as Mapping;

function missingPaintedWaveItemIds(): string[] {
  const accepted = JSON.parse(
    readFileSync(
      path.join(repoRoot, 'docs/achievements/missing-painted-icons-accepted-art.json'),
      'utf8',
    ),
  ) as { targetSets: { items: string[] } };
  return accepted.targetSets.items;
}

describe('item webp icons', () => {
  it('has image-backed item ids wired (guards the fixture)', () => {
    expect(ITEM_IMAGE_IDS.size).toBeGreaterThan(0);
  });

  it('A) every image-backed item id resolves to a committed, decodable .webp', async () => {
    const broken: string[] = [];
    for (const id of [...ITEM_IMAGE_IDS, ...UI_ITEM_IMAGE_IDS]) {
      if (ITEM_ART_PENDING.has(id)) continue; // covered by A2/A3 below
      const url = itemImageUrl(id);
      expect(url, `${id} must resolve to a webp url`).toMatch(/^\/ui\/items\/.+\.webp$/);
      const file = path.join(publicDir, (url as string).replace(/^\//, ''));
      if (!existsSync(file)) broken.push(`${id} -> ${url} (missing file)`);
      else if (!isValidWebp(file)) broken.push(`${id} -> ${url} (not a valid webp)`);
      else {
        try {
          await sharp(file).raw().toBuffer();
        } catch {
          broken.push(`${id} -> ${url} (webp payload cannot be decoded)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  // A2/A3 keep the pending list from becoming a dumping ground. Guard A skips those ids, so
  // without these two arms an item could be parked here forever, or a NEW artless item could
  // be added to the list to silence a real failure.
  it('A2) every art-pending id is a real, non-weapon item that genuinely has no art yet', () => {
    const stale: string[] = [];
    for (const id of ITEM_ART_PENDING) {
      const def = (ITEMS as Record<string, { kind?: string }>)[id];
      if (!def) stale.push(`${id} (no such item: drop it from ITEM_ART_PENDING)`);
      else if (def.kind === 'weapon') stale.push(`${id} (weapon: never belongs in the item set)`);
      else if (existsSync(path.join(itemsDir, `${id}.webp`))) {
        stale.push(`${id} (art IS committed now: remove it from ITEM_ART_PENDING)`);
      }
    }
    expect(stale, 'ITEM_ART_PENDING must shrink as art lands, and never outlive its items').toEqual(
      [],
    );
  });

  it('A3) a pending id serves the drawn icon instead of a url pointing at a missing file', () => {
    // The whole point of the pending list: itemImageUrl declines, so iconDataUrl composes the
    // procedural recipe rather than handing an <img> a 404. Asserted on the real surface the
    // bag bar, tooltips, loot and the vendor call.
    for (const id of ITEM_ART_PENDING) {
      expect(itemImageUrl(id), `${id} must not resolve to uncommitted art`).toBeNull();
    }
    expect(ITEM_ART_PENDING.size, 'the accepted painted-art wave clears all enumerated debt').toBe(
      0,
    );
    // And the inverse: an id with committed art must still win the static url.
    expect(itemImageUrl('linen_pouch')).toBe('/ui/items/linen_pouch.webp');
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
    const curated = m.entries.map((e) => e.itemId);
    const generated = (m.generatedBatches ?? []).flatMap((batch) => batch.itemIds);
    const listed = [...curated, ...generated];
    expect(
      listed.filter((id, index) => listed.indexOf(id) !== index),
      'an icon must have exactly one provenance owner',
    ).toEqual([]);
    expect(
      files.filter((id) => !listed.includes(id)),
      'art without provenance: add its entry (source + license) to mapping.json',
    ).toEqual([]);
    expect(
      listed.filter((id) => !files.includes(id)),
      'mapping.json lists art that is not committed: drop the stale entry',
    ).toEqual([]);
    for (const entry of m.entries) {
      expect(entry.name, `${entry.itemId} must name its source asset`).toBeTruthy();
      expect(entry.sourcePack, `${entry.itemId} must identify its source pack`).toBeTruthy();
    }
    expect(m.generatedBatches, 'generated art must retain its batch provenance').not.toEqual([]);
    for (const batch of m.generatedBatches ?? []) {
      expect(batch.source).toBeTruthy();
      expect(batch.license).toContain('project asset');
      expect(batch.styleReference).toBeTruthy();
      expect(batch.commonPrompt).toBeTruthy();
    }
    // The legacy bag family is project-owned art, so each curated entry overrides the
    // file-level CraftPix license. Silkspun Satchel is separately generated and therefore
    // belongs only to generatedBatches, never to the ordinary CraftPix-governed entries.
    for (const id of [...BAG_IDS.filter((bagId) => bagId !== 'silkspun_satchel'), 'backpack']) {
      const entry = m.entries.find((e) => e.itemId === id);
      expect(entry?.license, `${id} must carry its own license override`).toContain(
        'World of ClaudeCraft original art',
      );
    }
    expect(m.entries.some((entry) => entry.itemId === 'silkspun_satchel')).toBe(false);
    const silkspunOwners = (m.generatedBatches ?? []).filter((batch) =>
      batch.itemIds.includes('silkspun_satchel'),
    );
    expect(silkspunOwners, 'silkspun_satchel generated-art owner').toHaveLength(1);
    expect(silkspunOwners[0].source).toBe('OpenAI built-in image generation');
    expect(silkspunOwners[0].license).toContain('project asset');
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

  it('F3) ships the final tuning originals and can never regress to their placeholders', async () => {
    const m = mapping();
    expect(PROFESSION_TUNING_ICON_IDS).toHaveLength(13);
    for (const id of PROFESSION_TUNING_ICON_IDS) {
      const file = path.join(itemsDir, `${id}.webp`);
      const bytes = readFileSync(file);
      expect(
        bytes.length,
        `${id} must stay within the item-icon weight budget`,
      ).toBeLessThanOrEqual(15 * 1024);
      const hash = createHash('sha256').update(bytes).digest('hex');
      expect(hash, `${id} must not regress to the retired generated placeholder`).not.toBe(
        RETIRED_PLACEHOLDER_SHA256[id],
      );
      expect(hash, `${id} must remain the accepted, centered shipping painting`).toBe(
        ACCEPTED_TUNING_ICON_SHA256[id],
      );

      const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info.width, `${id} decoded width`).toBe(128);
      expect(decoded.info.height, `${id} decoded height`).toBe(128);
      const alpha = decoded.data.filter((_, index) => index % decoded.info.channels === 3);
      expect(
        alpha.every((value) => value === 255),
        `${id} must keep an opaque item backdrop`,
      ).toBe(true);

      const owners = (m.generatedBatches ?? []).filter((batch) => batch.itemIds.includes(id));
      expect(owners, `${id} must have exactly one generated-art provenance owner`).toHaveLength(1);
      expect(owners[0].source).toBe('OpenAI built-in image generation');
    }
  });

  it('F4) records every final-wave item once as project-generated art', () => {
    const ids = missingPaintedWaveItemIds();
    expect(ids).toHaveLength(101);
    expect(ids).toEqual([...new Set(ids)].sort());
    const m = mapping();
    for (const id of ids) {
      expect(itemImageUrl(id), `${id} runtime URL`).toBe(`/ui/items/${id}.webp`);
      expect(
        m.entries.some((entry) => entry.itemId === id),
        `${id} must not inherit CraftPix`,
      ).toBe(false);
      const owners = (m.generatedBatches ?? []).filter((batch) => batch.itemIds.includes(id));
      expect(owners, `${id} must have one generated provenance owner`).toHaveLength(1);
      expect(owners[0].source).toBe('OpenAI built-in image generation');
      expect(owners[0].license).toContain('project asset');
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

  it('H) every non-weapon item resolves to committed painted art', () => {
    const expected = Object.values(ITEMS)
      .filter((item) => item.kind !== 'weapon')
      .map((item) => item.id)
      .sort();
    expect(
      [...ITEM_IMAGE_IDS].sort(),
      'non-weapon items must never fall back to the legacy procedural compositor',
    ).toEqual(expected);
    for (const id of expected) {
      // Art-pending ids deliberately serve the drawn recipe instead (A2/A3 gate the list, and
      // iconDataUrl would need a DOM canvas here anyway). Every other item must serve its WebP.
      if (ITEM_ART_PENDING.has(id)) continue;
      expect(iconDataUrl('item', id), `${id} must serve its committed WebP`).toBe(
        `/ui/items/${id}.webp`,
      );
    }
  });

  it('I) every item icon has distinct committed artwork', () => {
    const byHash = new Map<string, string[]>();
    for (const file of webpFiles()) {
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      const ids = byHash.get(hash) ?? [];
      ids.push(path.basename(file, '.webp'));
      byHash.set(hash, ids);
    }
    expect(
      [...byHash.values()].filter((ids) => ids.length > 1),
      'different item ids must not ship byte-identical placeholder art',
    ).toEqual([]);
  });

  it('J) mapped weapons keep their rendered model thumbnails', () => {
    const weaponIds = new Set(
      Object.values(ITEMS)
        .filter((item) => item.kind === 'weapon')
        .map((item) => item.id),
    );
    const strayMappings = Object.keys(ITEM_WEAPON_VARIANTS).filter((id) => !weaponIds.has(id));
    expect(strayMappings, 'thumbnail mappings must only target real weapons').toEqual([]);
    for (const id of Object.keys(ITEM_WEAPON_VARIANTS)) {
      expect(iconDataUrl('item', id), `${id} must keep its rendered weapon thumbnail`).toBe(
        `/ui/weapons/${ITEM_WEAPON_VARIANTS[id]}.jpg`,
      );
    }
  });
});

describe('unknown item ids resolve to the shared fallback recipe (stale-client premise)', () => {
  it('lands every unresolvable id on the fallback, prototype keys included, never a throw', () => {
    // Every stale-client fallback surface funnels unknown server ids into
    // iconDataUrl; this is the canvas-free pin that the recipe layer under it
    // tolerates ANY string. ITEMS and ITEM_RECIPES are prototype-bearing
    // Records, so keys like __proto__ resolve truthy non-defs (and
    // 'constructor' resolves a function whose .name IS a string): the
    // OWN-PROPERTY gates in resolveRecipe's item arm and itemFallback are
    // what send every one of them to the fallback recipe.
    const unknown = itemIconRecipe('no_such_item_id_v1');
    expect(isUnknownIconRecipe(unknown)).toBe(true);
    expect(isUnknownIconRecipe(itemIconRecipe('no_such_item_id_v2'))).toBe(true);
    for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(isUnknownIconRecipe(itemIconRecipe(hostile)), hostile).toBe(true);
    }
    // The weapon-art arm shares the gate: without it, a prototype key
    // stringifies a prototype member into a garbage /ui/weapons/ URL before
    // the recipe layer is ever consulted (canvas-bound at runtime, so pinned
    // at the source).
    const iconsSource = readFileSync(new URL('../src/ui/icons.ts', import.meta.url), 'utf8');
    expect(iconsSource).toContain('Object.hasOwn(ITEM_ICON_IMAGES, id)');
    // A real def without committed art takes its DERIVED recipe, not the
    // fallback, so this pin cannot pass by everything falling through.
    const derived = Object.values(ITEMS).find(
      (item) => !ITEM_WEAPON_VARIANTS[item.id] && itemIconRecipe(item.id) !== unknown,
    );
    expect(derived).toBeTruthy();
  });
});
