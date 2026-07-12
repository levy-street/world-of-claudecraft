import { closeSync, existsSync, openSync, readdirSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';
import { DEED_IMAGE_IDS } from '../src/ui/deed_image_ids';
import { DEED_BESPOKE_CRESTS, deedCrestId } from '../src/ui/deeds_view';
import { deedImageUrl, iconDataUrl } from '../src/ui/icons';

// Gate for the committed Book of Deeds WebP icons (mirror of tests/skill_icons.test.ts and
// tests/item_icons.test.ts). Art under public/ui/deeds/<deed_id>.webp is the source of truth
// (128px WebP, downscaled from the maintainer's 512px source by scripts/convert_deed_icons_webp.mjs),
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

const committedIds = (): string[] =>
  existsSync(deedsDir)
    ? readdirSync(deedsDir)
        .filter((f) => path.extname(f).toLowerCase() === '.webp')
        .map((f) => path.basename(f, '.webp'))
    : [];

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

describe('Book of Deeds webp icons', () => {
  it('has art-backed deed ids wired (guards the fixture)', () => {
    expect(DEED_IMAGE_IDS.size).toBeGreaterThan(0);
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

  it('A2) every committed webp is a valid RIFF/WEBP file', () => {
    const broken: string[] = [];
    for (const id of DEED_IMAGE_IDS) {
      const file = path.join(deedsDir, `${id}.webp`);
      if (!existsSync(file)) {
        broken.push(`${id} (missing file)`);
        continue;
      }
      if (!isValidWebp(file)) broken.push(`${id} (not a valid webp: bad RIFF/WEBP header)`);
    }
    expect(broken).toEqual([]);
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

  it('an artless deed card resolves to a procedural crest (no committed image)', () => {
    // Any live deeds awaiting art must land on their category base crest, which carries no
    // image URL and falls through to the procedural canvas path. A fully commissioned live
    // catalog makes this loop empty, so the synthetic id below keeps the branch pinned.
    const artless = DEED_ORDER.filter((id) => !DEED_IMAGE_IDS.has(id));
    for (const id of artless) {
      const crestId = deedCrestId(id, DEEDS[id].category);
      expect(deedImageUrl(crestId), `${id} -> ${crestId} must have no committed image`).toBeNull();
      expect(deedImageUrl(`deed_${id}`), `${id} itself must have no committed image`).toBeNull();
    }
    expect(DEED_IMAGE_IDS.has('synthetic_artless')).toBe(false);
    expect(deedImageUrl('deed_synthetic_artless')).toBeNull();
    // The category base crests never resolve to a deed image either.
    expect(deedImageUrl('deed_cat_progression')).toBeNull();
    expect(deedImageUrl('deed_cat_dungeon')).toBeNull();
    expect(deedImageUrl('deed_cat_chronicle')).toBeNull();
    // A non-deed_ crest id (a class or family unit-portrait crest) misses the prefix guard and
    // returns null, so those crests keep their procedural canvas path untouched.
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
