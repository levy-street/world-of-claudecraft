import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import { DEED_BESPOKE_CRESTS, deedCrestId } from '../src/ui/deeds_view';
import { DEED_ART_PENDING, deedImageUrl, iconDataUrl } from '../src/ui/icons';

// Gate for the committed Book of Deeds WebP icons (mirror of tests/skill_icons.test.ts and
// tests/item_icons.test.ts). Art under public/ui/deeds/<deed_id>.webp is the source of truth
// (128px WebP, downscaled from a reviewed 512px source by scripts/convert_deed_icons_webp.mjs),
// served through iconDataUrl for kind 'crest' when the crest id shaped `deed_<deed_id>` is
// art-backed. The guard is a bijection plus a scope + fallback check:
//   A) DEED_IMAGE_IDS is an exact set-equality with the committed .webp files, BOTH directions
//      (a deleted/renamed webp, or a committed webp with no wired id, reds here);
//   A2) every committed webp is a valid RIFF/WEBP file (zero-byte or renamed-png fails here
//      instead of rendering a broken img);
//   B) only .webp art is committed under public/ui/deeds (no unconverted png, no stray file);
//   C) every art-backed id is a real live deed in DEED_ORDER (no deferred/cut/orphan id ships art);
//   plus the resolution contract: an art-backed deed card resolves to its WebP URL, an artless
//   deed and every deferred/cut id resolve to no image (so iconDataUrl falls through to the
//   procedural crest, never a broken img). Filesystem + early-return-url only (no canvas), so it
//   runs headless in the default node env.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const deedsDir = path.join(publicDir, 'ui/deeds');

// Dotfiles (a local .DS_Store) are ignored so the gate does not false-positive on dev cruft.
const isDotfile = (p: string): boolean => path.basename(p).startsWith('.');

// A real WebP starts with a RIFF container whose form-type is "WEBP" (bytes 8..12). This rejects
// a zero-byte/truncated write and a foreign raster (e.g. a PNG) renamed to .webp.
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

// Read dimensions directly from each WebP encoding mode. This rejects a valid
// RIFF/WEBP container whose canvas silently drifted from the served 128px square.
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

const committedIds = (): string[] =>
  existsSync(deedsDir)
    ? readdirSync(deedsDir)
        .filter((f) => path.extname(f).toLowerCase() === '.webp')
        .map((f) => path.basename(f, '.webp'))
    : [];

function professionManifestDeedIds(): string[] {
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, 'docs/design/professions-asset-manifest.json'), 'utf8'),
  ) as unknown;
  const ids: string[] = [];
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (
      typeof record.id === 'string' &&
      record.id.startsWith('deed_prof_') &&
      typeof record.deedId === 'string'
    )
      ids.push(record.deedId);
    for (const value of Object.values(record)) collect(value);
  };
  collect(manifest);
  return [...new Set(ids)].sort();
}

// The deferred (account-level + currently-unearnable) and cut ids: the maintainer's icon set
// ships PNGs for these, but the ingest script skips them (they are not live deeds), so no art may
// ever reach the committed tree. Pinned literally to catch a future stray ingest.
const ORPHAN_IDS = [
  'feat_before_the_book',
  'feat_founders_circle',
  'feat_realm_chronicler',
  'feat_realm_first_cap',
  'feat_realm_first_nythraxis',
  'feat_realm_first_thunzharr',
  'feat_top_of_the_book',
  'prog_ninefold',
  'prog_ringwright',
  'prog_three_paths',
  'pvp_vcup_bet_flex',
];

// All five deed records added on this branch. Only the first is owned by the
// professions packet directly; the other four arrived with its release-base
// integration, and are pinned here so this branch cannot ship new fallback art.
const BRANCH_DEED_ART_IDS = [
  'chr_peaks_gatherer',
  'chr_marsh_rares_ii',
  'chr_peaks_rares_ii',
  'chr_gleamstag',
  'chr_hollow_rares',
] as const;

// The final painted-icon replacement wave. These are separate freshly composed
// generated crests, not recolours of one another or additions to the commissioned
// deed batch. Their exact accepted identities are pinned by the wave manifest.
const MISSING_PAINTED_DEED_IDS = [
  'dgn_wildheart_basin',
  'dgn_wildheart_basin_heroic',
  'pvp_card_duel_first_win',
] as const;

// The exhaustive art-debt ledger. It stays empty while every live deed has painted art, and a
// future artless deed must enter this set explicitly rather than hiding behind a category crest.
const DEED_ART_PENDING_IDS = [...DEED_ART_PENDING];

describe('Book of Deeds webp icons', () => {
  it('has art-backed deed ids wired (guards the fixture)', () => {
    expect(DEED_IMAGE_IDS.size).toBeGreaterThan(0);
  });

  it('ships painted crests for every profession deed declared by the feature manifest', () => {
    const ids = professionManifestDeedIds();
    expect(ids).toHaveLength(30);
    expect(
      ids,
      'the tuning packet manifest must retain its new Thornpeak gathering deed',
    ).toContain('chr_peaks_gatherer');
    for (const id of ids) {
      expect(DEED_IMAGE_IDS.has(id), `${id} must be present in the generated deed registry`).toBe(
        true,
      );
      expect(existsSync(path.join(deedsDir, `${id}.webp`)), `${id}.webp must be committed`).toBe(
        true,
      );
      expect(webpSize(path.join(deedsDir, `${id}.webp`)), `${id}.webp dimensions`).toEqual({
        width: 128,
        height: 128,
      });
    }
  });

  it('records the five generated crests and their licensed reference lineage', () => {
    const credits = readFileSync(path.join(repoRoot, 'CREDITS.md'), 'utf8');
    const provenancePath = path.join(
      repoRoot,
      'docs/achievements/professions-tuning-art-provenance.md',
    );
    expect(existsSync(provenancePath), 'generated deed art needs a committed lineage record').toBe(
      true,
    );
    const provenance = readFileSync(provenancePath, 'utf8');
    for (const id of BRANCH_DEED_ART_IDS) {
      expect(credits, `${id} must remain in the operative media credits`).toContain(id);
      expect(provenance, `${id} must retain its prompt/lineage record`).toContain(id);
    }
    expect(credits).toContain('OpenAI built-in image generation');
    expect(credits).toContain('grubjaw_tusk');
    expect(credits).toContain('old_cragmaws_pelt');
    expect(provenance).toContain('CraftPix Premium');
    expect(provenance).toContain('simple_fishing_pole');
  });

  it('A) DEED_IMAGE_IDS is an exact bijection with the committed .webp files', () => {
    const files = new Set(committedIds());
    const wired = new Set(DEED_IMAGE_IDS);
    const missingFile = [...wired].filter((id) => !files.has(id)).sort();
    const unwiredFile = [...files].filter((id) => !wired.has(id)).sort();
    expect(
      missingFile,
      'wired deed ids with no committed webp (deleted/renamed art); re-run npm run assets:deeds',
    ).toEqual([]);
    expect(
      unwiredFile,
      'committed webp with no DEED_IMAGE_IDS entry (unwired art); re-run npm run assets:deeds',
    ).toEqual([]);
    expect(files.size).toBe(wired.size);
  });

  it('A2) every committed webp decodes as a transparent 128px crest', async () => {
    const broken: string[] = [];
    const byHash = new Map<string, string[]>();
    for (const id of DEED_IMAGE_IDS) {
      const file = path.join(deedsDir, `${id}.webp`);
      if (!existsSync(file)) {
        broken.push(`${id} (missing file)`);
        continue;
      }
      if (!isValidWebp(file)) {
        broken.push(`${id} (not a valid webp: bad RIFF/WEBP header)`);
        continue;
      }
      const bytes = readFileSync(file);
      if (bytes.length > 15 * 1024) broken.push(`${id} (${bytes.length} bytes exceeds 15 KiB)`);
      const hash = createHash('sha256').update(bytes).digest('hex');
      byHash.set(hash, [...(byHash.get(hash) ?? []), id]);
      try {
        const metadata = await sharp(file).metadata();
        if (metadata.width !== 128 || metadata.height !== 128)
          broken.push(`${id} (${metadata.width}x${metadata.height}, expected 128x128)`);
        if (!metadata.hasAlpha) broken.push(`${id} (missing alpha channel)`);
        const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let transparent = false;
        let opaque = false;
        for (let i = 3; i < decoded.data.length; i += decoded.info.channels) {
          if (decoded.data[i] === 0) transparent = true;
          if (decoded.data[i] === 255) opaque = true;
        }
        if (!transparent || !opaque)
          broken.push(`${id} (must contain both transparent and opaque pixels)`);
      } catch {
        broken.push(`${id} (webp payload cannot be decoded)`);
      }
    }
    for (const ids of byHash.values()) {
      if (ids.length > 1) broken.push(`${ids.join(', ')} (byte-identical deed art)`);
    }
    expect(broken).toEqual([]);
  });

  it('A3) the five branch-added crests keep the deed frame geometry', async () => {
    expect(BRANCH_DEED_ART_IDS).toHaveLength(5);
    for (const id of BRANCH_DEED_ART_IDS) {
      expect(DEED_IMAGE_IDS.has(id), `${id} must be wired`).toBe(true);
      const decoded = await sharp(path.join(deedsDir, `${id}.webp`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let minX = decoded.info.width;
      let minY = decoded.info.height;
      let maxX = -1;
      let maxY = -1;
      let visible = 0;
      for (let y = 0; y < decoded.info.height; y++) {
        for (let x = 0; x < decoded.info.width; x++) {
          const alpha = decoded.data[(y * decoded.info.width + x) * decoded.info.channels + 3];
          if (alpha < 8) continue;
          visible++;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      expect(minX, `${id} left padding`).toBeGreaterThanOrEqual(7);
      expect(minY, `${id} top padding`).toBeGreaterThanOrEqual(7);
      expect(maxX, `${id} right padding`).toBeLessThanOrEqual(120);
      expect(maxY, `${id} bottom padding`).toBeLessThanOrEqual(120);
      expect(Math.abs((minX + maxX) / 2 - 63.5), `${id} horizontal center`).toBeLessThanOrEqual(2);
      expect(Math.abs((minY + maxY) / 2 - 63.5), `${id} vertical center`).toBeLessThanOrEqual(2);
      const coverage = visible / (decoded.info.width * decoded.info.height);
      expect(coverage, `${id} visible coverage`).toBeGreaterThanOrEqual(0.35);
      expect(coverage, `${id} visible coverage`).toBeLessThanOrEqual(0.6);
    }
  });

  it('A4) the three final generated crests keep their tighter reviewed frame geometry', async () => {
    expect(MISSING_PAINTED_DEED_IDS).toHaveLength(3);
    for (const id of MISSING_PAINTED_DEED_IDS) {
      expect(DEED_IMAGE_IDS.has(id), `${id} must be wired`).toBe(true);
      const decoded = await sharp(path.join(deedsDir, `${id}.webp`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let minX = decoded.info.width;
      let minY = decoded.info.height;
      let maxX = -1;
      let maxY = -1;
      let visible = 0;
      for (let y = 0; y < decoded.info.height; y++) {
        for (let x = 0; x < decoded.info.width; x++) {
          const alpha = decoded.data[(y * decoded.info.width + x) * decoded.info.channels + 3];
          if (alpha < 8) continue;
          visible++;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      expect(minX, `${id} left alpha bound`).toBeGreaterThanOrEqual(14);
      expect(minX, `${id} left alpha bound`).toBeLessThanOrEqual(15);
      expect(minY, `${id} top alpha bound`).toBe(14);
      expect(maxX, `${id} right alpha bound`).toBe(113);
      expect(maxY, `${id} bottom alpha bound`).toBe(113);
      expect(Math.abs((minX + maxX) / 2 - 63.5), `${id} horizontal center`).toBeLessThanOrEqual(
        0.5,
      );
      expect(Math.abs((minY + maxY) / 2 - 63.5), `${id} vertical center`).toBe(0);
      const coverage = visible / (decoded.info.width * decoded.info.height);
      expect(coverage, `${id} visible coverage`).toBeGreaterThanOrEqual(0.41);
      expect(coverage, `${id} visible coverage`).toBeLessThanOrEqual(0.45);
    }
  });

  it('B) commits only .webp art under public/ui/deeds (no png/stray files)', () => {
    const stray = existsSync(deedsDir)
      ? readdirSync(deedsDir)
          .filter((f) => !isDotfile(f) && path.extname(f).toLowerCase() !== '.webp')
          .sort()
      : [];
    expect(stray, 'only .webp art may live under public/ui/deeds').toEqual([]);
  });

  it('C) every art-backed id is a real live deed (no deferred/cut/orphan id ships art)', () => {
    const live = new Set(DEED_ORDER);
    const notLive = [...DEED_IMAGE_IDS].filter((id) => !live.has(id) || !DEEDS[id]).sort();
    expect(notLive, 'DEED_IMAGE_IDS ids must all be live DEED_ORDER deeds').toEqual([]);
  });

  it('an art-backed deed card resolves to its WebP URL, never a data URL', () => {
    const id = [...DEED_IMAGE_IDS].sort()[0];
    const crestId = deedCrestId(id, DEEDS[id].category);
    expect(crestId).toBe(`deed_${id}`);
    expect(deedImageUrl(crestId)).toBe(`/ui/deeds/${id}.webp`);
    // iconDataUrl short-circuits to the same static url before the procedural canvas path
    // (node-safe; no canvas). The image branch never enters urlCache, so procedural and image
    // urls for a crest id can never collide there.
    expect(iconDataUrl('crest', crestId)).toBe(`/ui/deeds/${id}.webp`);
    expect(iconDataUrl('crest', crestId).startsWith('data:')).toBe(false);
    // A deed that is BOTH bespoke and art-backed serves the painted WebP: the image branch
    // outranks the procedural bespoke recipe, not just the base crest.
    const bespokeWithArt = [...DEED_BESPOKE_CRESTS].find((b) => DEED_IMAGE_IDS.has(b));
    expect(bespokeWithArt, 'expected a bespoke deed that also ships art').toBeDefined();
    if (bespokeWithArt) {
      expect(iconDataUrl('crest', `deed_${bespokeWithArt}`)).toBe(
        `/ui/deeds/${bespokeWithArt}.webp`,
      );
    }
  });

  it('resolves every live deed to its own painted WebP with no release art debt', () => {
    const artless = DEED_ORDER.filter((id) => !DEED_IMAGE_IDS.has(id));
    expect(DEED_ART_PENDING_IDS, 'release-live deed art debt must stay empty').toEqual([]);
    expect(artless, 'every release-live deed must have painted art').toEqual([]);
    expect(DEED_ORDER, 'the merged live deed catalog').toHaveLength(271);
    expect(DEED_IMAGE_IDS.size, 'every live deed is painted').toBe(271);
    for (const id of DEED_ORDER) {
      const crestId = deedCrestId(id, DEEDS[id].category);
      expect(crestId, `${id} must keep its bespoke crest identity`).toBe(`deed_${id}`);
      expect(deedImageUrl(crestId), id).toBe(`/ui/deeds/${id}.webp`);
    }
    expect(DEED_IMAGE_IDS.has('synthetic_artless')).toBe(false);
    expect(deedImageUrl('deed_synthetic_artless')).toBeNull();
    // The category base crests never resolve to a deed image either.
    expect(deedImageUrl('deed_cat_progression')).toBeNull();
    expect(deedImageUrl('deed_cat_dungeon')).toBeNull();
    expect(deedImageUrl('deed_cat_chronicle')).toBeNull();
    // A non-deed_ crest id misses this helper's prefix guard; crestIconUrl owns those paintings.
    expect(deedImageUrl('status_npc')).toBeNull();
    expect(deedImageUrl('family_wolf')).toBeNull();
  });

  it('a deferred or cut id never resolves to a committed image', () => {
    for (const id of ORPHAN_IDS) {
      expect(DEED_IMAGE_IDS.has(id), `${id} is deferred/cut; must not ship art`).toBe(false);
      expect(deedImageUrl(`deed_${id}`), `${id} must have no committed image`).toBeNull();
      expect(
        existsSync(path.join(deedsDir, `${id}.webp`)),
        `${id}.webp must not be committed`,
      ).toBe(false);
    }
  });
});
