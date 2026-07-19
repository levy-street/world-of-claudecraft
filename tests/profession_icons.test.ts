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
// professions window. The set legitimately ships EMPTY (every id has a procedural recipe),
// so every guard here must hold with zero committed files. The guard is a bijection plus a
// recipe-coverage check:
//   A) every id in PROFESSION_IMAGE_IDS resolves to a committed, VALID .webp;
//   B) only .webp art (+ mapping.json) is committed under public/ui/professions;
//   C) every committed .webp is a WIRED id, and every wired id is a known manifest icon id;
//   D) every manifest icon id has an explicit procedural recipe, so an unshipped image
//      renders a deliberate placeholder, never the generic unknown-icon fallback;
//   E) every manifest icon id actually composes end to end (a valid data URL) when no
//      image is committed for it;
//   F) mapping.json provenance stays a bijection with the committed files at the declared
//      128px square.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const professionsDir = path.join(publicDir, 'ui/professions');

// The full icon id set of docs/professions-2/asset-manifest.json wave one: the ten
// craft-wheel crafts plus the gathering skills. Derived from the sim content tables so a
// renamed craft fails loudly here; gather_fishing is pinned literally because the manifest
// ships it ahead of the sim (fishing lands in Phase 11).
const CRAFT_ICON_IDS = CRAFT_RING.map((c) => `prof_${c.id}`);
const GATHER_ICON_IDS = [...GATHERING_PROFESSION_IDS.map((id) => `gather_${id}`), 'gather_fishing'];
const ICON_IDS = [...CRAFT_ICON_IDS, ...GATHER_ICON_IDS];

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
  iconSize: number;
  entries: { id: string; name: string; source: string; license?: string }[];
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

  it('covers exactly the wave-one asset-manifest icon ids', () => {
    expect([...ICON_IDS].sort()).toEqual([
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

  it('stays in lockstep with the prof_/gather_ icon ids the asset manifest declares', () => {
    // The pin above is a literal list; this guard reads the manifest itself so
    // the two cannot drift apart silently. Deed crest ids are deed_prof_*, a
    // different namespace, and stay out of this window's set by prefix.
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'docs/professions-2/asset-manifest.json'), 'utf8'),
    ) as unknown;
    const declared: string[] = [];
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const item of node) collect(item);
      } else if (node !== null && typeof node === 'object') {
        const rec = node as Record<string, unknown>;
        if (typeof rec.id === 'string' && /^(prof|gather)_/.test(rec.id)) declared.push(rec.id);
        for (const value of Object.values(rec)) collect(value);
      }
    };
    collect(manifest);
    expect([...declared].sort()).toEqual([...ICON_IDS].sort());
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
      [...PROFESSION_IMAGE_IDS].filter((id) => !ICON_IDS.includes(id)),
      'PROFESSION_IMAGE_IDS covers manifest profession/gathering icon ids only',
    ).toEqual([]);
  });

  it('D) every manifest icon id has an explicit procedural recipe', () => {
    expect(
      ICON_IDS.filter((id) => !hasProfessionIconRecipe(id)),
      'an unshipped image must fall back to a deliberate recipe, never the unknown icon',
    ).toEqual([]);
  });

  it('E) every manifest icon id composes to a valid data URL when its image is absent', () => {
    stubCanvasDocument();
    for (const id of ICON_IDS) {
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

  it('F) mapping.json provenance stays a bijection with the committed files at 128px', () => {
    const m = mapping();
    expect(
      m.iconSize,
      'the served icon square (mirrored by scripts/convert_profession_icons_webp.mjs)',
    ).toBe(128);
    const files = webpFiles().map((f) => path.basename(f, '.webp'));
    const listed = m.entries.map((e) => e.id);
    expect(
      files.filter((id) => !listed.includes(id)),
      'art without provenance: add its entry (source + license) to mapping.json',
    ).toEqual([]);
    expect(
      listed.filter((id) => !files.includes(id)),
      'mapping.json lists art that is not committed: drop the stale entry',
    ).toEqual([]);
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
