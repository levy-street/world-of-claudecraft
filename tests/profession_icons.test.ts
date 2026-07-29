import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRAFT_RING, GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import {
  hasProfessionIconRecipe,
  PROFESSION_IMAGE_IDS,
  professionIconUrl,
  professionImageUrl,
} from '../src/ui/icons';

// Gate for the committed WebP profession icons (mirror of tests/item_icons.test.ts). Art
// under public/ui/professions/<id>.webp is the source of truth (WebP only, normalized by
// scripts/convert_profession_icons_webp.mjs), served by professionIconUrl for the
// professions UI. The 14 profession/gathering row icons retain procedural recipes as a
// deliberate fallback; the archetype crests and masterwork seal are raster-only. The guard is
// a bijection plus a recipe-coverage check:
//   A) every id in PROFESSION_IMAGE_IDS resolves to a committed, VALID .webp;
//   B) only .webp art (+ mapping.json) is committed under public/ui/professions;
//   C) every committed .webp is a WIRED id, and every wired id is a known raster manifest id;
//   D) every profession/gathering row id has an explicit procedural recipe, so an unshipped image
//      renders a deliberate placeholder, never the generic unknown-icon fallback;
//   E) every profession/gathering row id actually composes end to end (a valid data URL) when no
//      image is committed for it;
//   F) mapping.json provenance stays a bijection with the committed files at the declared
//      128px square.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const professionsDir = path.join(publicDir, 'ui/professions');

// The full icon id set of docs/design/professions-asset-manifest.json wave one: the ten
// craft-wheel crafts plus the gathering skills. Derived from the sim content tables so a
// renamed craft fails loudly here; gather_fishing now derives from the sim content like the
// other gathering skills (fishing joined GATHERING_PROFESSION_IDS).
const CRAFT_ICON_IDS = CRAFT_RING.map((c) => `prof_${c.id}`);
const GATHER_ICON_IDS = GATHERING_PROFESSION_IDS.map((id) => `gather_${id}`);
const RECIPE_ICON_IDS = [...CRAFT_ICON_IDS, ...GATHER_ICON_IDS];
const ART_ICON_IDS = [
  'archetype_apothecary',
  'archetype_arcanist',
  'archetype_bladewright',
  'archetype_bombardier',
  'archetype_cogsmith',
  'archetype_gembinder',
  'archetype_mageweaver',
  'archetype_outfitter',
  'archetype_smith',
  'archetype_trapper',
  ...RECIPE_ICON_IDS,
  'masterwork_seal',
];

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

// A real WebP starts with a RIFF container whose form-type is "WEBP" (bytes 8..12). This
// rejects a zero-byte/truncated write and a foreign raster (e.g. a PNG) renamed to .webp.
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

// Dimensions straight out of the WebP header (lossy VP8, lossless VP8L, extended VP8X), so
// the size guard needs no image dependency (same reader as tests/item_icons.test.ts).
function webpSize(file: string): { width: number; height: number } {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(32);
    readSync(fd, buf, 0, 32, 0);
    const tag = buf.toString('ascii', 12, 16);
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
  } finally {
    closeSync(fd);
  }
}

const webpFiles = (): string[] =>
  walk(professionsDir).filter((p) => path.extname(p).toLowerCase() === '.webp');

type Mapping = {
  license: string;
  iconSize: number;
  entries: {
    id: string;
    name: string;
    batch: string;
    acceptedVersion: string;
    source: string;
    sourceSha256: string;
    license: string;
  }[];
};
const mapping = (): Mapping =>
  JSON.parse(readFileSync(path.join(professionsDir, 'mapping.json'), 'utf8')) as Mapping;

// The default vitest env has no working 2D canvas, so the compose-path guard (E) swaps in
// a recording stub: every ctx member is an absorbing function (gradients answer
// addColorStop), and toDataURL returns a fixed valid PNG data URL. A recipe referencing a
// broken painter still throws through this stub; only rasterization itself is faked
// (the idiom of tests/unit_portrait_painter.test.ts).
const STUB_DATA_URL = 'data:image/png;base64,c3R1Yg==';

function fakeCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const target: Record<string | symbol, unknown> = {};
  return new Proxy(target, {
    get: (t, prop) => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop in t) return t[prop];
      return () => {};
    },
    set: (t, prop, value) => {
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function stubCanvasDocument(): void {
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      expect(tag).toBe('canvas');
      return {
        width: 0,
        height: 0,
        getContext: () => fakeCtx(),
        toDataURL: () => STUB_DATA_URL,
      } as unknown as HTMLCanvasElement;
    },
  });
}

describe('profession webp icons', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('covers exactly the profession and gathering ids that retain procedural recipes', () => {
    expect([...RECIPE_ICON_IDS].sort()).toEqual([
      'gather_fishing',
      'gather_herbalism',
      'gather_logging',
      'gather_mining',
      'prof_alchemy',
      'prof_armorcrafting',
      'prof_cooking',
      'prof_enchanting',
      'prof_engineering',
      'prof_inscription',
      'prof_jewelcrafting',
      'prof_leatherworking',
      'prof_tailoring',
      'prof_weaponcrafting',
    ]);
  });

  it('stays in lockstep with every profession raster id the asset manifest declares', () => {
    // The pins above are literal lists; this guard reads the manifest itself so the
    // commissioned profession, gathering, archetype, and masterwork set cannot drift.
    // Deed crest ids are deed_prof_*, a different namespace, and stay out by prefix.
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'docs/design/professions-asset-manifest.json'), 'utf8'),
    ) as unknown;
    const declared: string[] = [];
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) collect(item);
      } else if (node !== null && typeof node === 'object') {
        const rec = node as Record<string, unknown>;
        if (
          typeof rec.id === 'string' &&
          (/^(prof|gather|archetype)_/.test(rec.id) || rec.id === 'masterwork_seal')
        )
          declared.push(rec.id);
        for (const value of Object.values(rec)) collect(value);
      }
    };
    collect(manifest);
    expect([...declared].sort()).toEqual([...ART_ICON_IDS].sort());
  });

  it('A) every image-backed profession id resolves to a committed, valid .webp', () => {
    const broken: string[] = [];
    for (const id of PROFESSION_IMAGE_IDS) {
      const url = professionImageUrl(id);
      expect(url, `${id} must resolve to a webp url`).toMatch(/^\/ui\/professions\/.+\.webp$/);
      const file = path.join(publicDir, (url as string).replace(/^\//, ''));
      if (!existsSync(file)) broken.push(`${id} -> ${url} (missing file)`);
      else if (!isValidWebp(file)) broken.push(`${id} -> ${url} (not a valid webp)`);
    }
    expect(broken).toEqual([]);
  });

  it('B) commits only webp art (+ mapping.json) under public/ui/professions', () => {
    const stray = walk(professionsDir)
      .filter((p) => !isDotfile(p) && !isMapping(p) && path.extname(p).toLowerCase() !== '.webp')
      .map((p) => path.relative(repoRoot, p));
    expect(
      stray,
      'run the profession icon converter; only .webp + mapping.json may live here',
    ).toEqual([]);
  });

  it('C) committed webps and wired ids stay a bijection inside the manifest id set', () => {
    const orphans: string[] = [];
    for (const file of webpFiles()) {
      const id = path.basename(file, '.webp');
      if (!PROFESSION_IMAGE_IDS.has(id))
        orphans.push(`${path.relative(repoRoot, file)} (not in PROFESSION_IMAGE_IDS)`);
    }
    expect(orphans, 'remove dead-weight art or wire the id into PROFESSION_IMAGE_IDS').toEqual([]);
    expect(
      [...PROFESSION_IMAGE_IDS].filter((id) => !ART_ICON_IDS.includes(id)),
      'PROFESSION_IMAGE_IDS covers only raster ids declared by the professions manifest',
    ).toEqual([]);
  });

  it('D) every profession/gathering row id has an explicit procedural recipe', () => {
    expect(
      RECIPE_ICON_IDS.filter((id) => !hasProfessionIconRecipe(id)),
      'an unshipped image must fall back to a deliberate recipe, never the unknown icon',
    ).toEqual([]);
  });

  it('E) every profession/gathering row id composes through its image or fallback recipe', () => {
    stubCanvasDocument();
    for (const id of RECIPE_ICON_IDS) {
      const url = professionIconUrl(id, 46);
      if (PROFESSION_IMAGE_IDS.has(id)) {
        expect(url, `${id} is art-backed and must serve its committed webp`).toBe(
          `/ui/professions/${id}.webp`,
        );
      } else {
        expect(url, `${id} must render its procedural recipe`).toBe(STUB_DATA_URL);
      }
    }
  });

  it('E2) independently exercises every procedural fallback while production stays art-backed', () => {
    stubCanvasDocument();
    const productionIds = [...PROFESSION_IMAGE_IDS];
    const mutableImageIds = PROFESSION_IMAGE_IDS as Set<string>;
    for (const id of RECIPE_ICON_IDS) {
      expect(PROFESSION_IMAGE_IDS.has(id), `${id} must begin art-backed in production`).toBe(true);
      expect(professionImageUrl(id)).toBe(`/ui/professions/${id}.webp`);
    }

    // Simulate the row-art set omitted from a deployment without changing the canonical registry.
    // This is the only way to drive these recipes now that every production row id has art.
    try {
      for (const id of RECIPE_ICON_IDS) mutableImageIds.delete(id);
      for (const id of RECIPE_ICON_IDS) {
        expect(professionImageUrl(id)).toBeNull();
        expect(professionIconUrl(id, 47), `${id} must compose its explicit recipe`).toBe(
          STUB_DATA_URL,
        );
      }
    } finally {
      // Restore both membership and iteration order so later exactness checks observe the real
      // generated registry even when an assertion above fails.
      mutableImageIds.clear();
      for (const productionId of productionIds) mutableImageIds.add(productionId);
    }

    expect([...PROFESSION_IMAGE_IDS]).toEqual(productionIds);
  });

  it('F) mapping.json provenance stays a bijection with the committed files at 128px', () => {
    const m = mapping();
    expect(
      m.iconSize,
      'the served icon square (mirrored by scripts/convert_profession_icons_webp.mjs)',
    ).toBe(128);
    const files = webpFiles().map((f) => path.basename(f, '.webp'));
    const listed = m.entries.map((e) => e.id);
    expect(new Set(listed).size, 'mapping.json must not contain duplicate provenance ids').toBe(
      listed.length,
    );
    expect(
      files.filter((id) => !listed.includes(id)),
      'art without provenance: add its entry (source + license) to mapping.json',
    ).toEqual([]);
    expect(
      listed.filter((id) => !files.includes(id)),
      'mapping.json lists art that is not committed: drop the stale entry',
    ).toEqual([]);
    expect(m.license).toContain('World of ClaudeCraft original art');
    for (const entry of m.entries) {
      expect(entry.name.trim(), `${entry.id} must retain a human-readable name`).not.toBe('');
      expect(entry.batch, `${entry.id} batch`).toMatch(/^batch-\d+$/);
      expect(entry.acceptedVersion, `${entry.id} accepted version`).toMatch(/^v\d+$/);
      // Batch-relative like the items mapping's sourceFile: the masters are
      // maintainer-held (not in the repo), and this file deploys verbatim to
      // the live site, so it never publishes a local working path.
      expect(entry.source, `${entry.id} source master`).toBe(
        `${entry.batch}/masters/${entry.id}.png`,
      );
      expect(entry.sourceSha256, `${entry.id} source master SHA-256`).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.license, `${entry.id} license`).toBe(
        'World of ClaudeCraft original art (project-owned, created for this game)',
      );
    }
    const wrong: string[] = [];
    for (const file of webpFiles()) {
      const { width, height } = webpSize(file);
      if (width !== m.iconSize || height !== m.iconSize)
        wrong.push(`${path.basename(file)} (${width}x${height})`);
    }
    expect(wrong, 'run `npm run assets:professions`; art is served at one fixed square').toEqual(
      [],
    );
  });
});
