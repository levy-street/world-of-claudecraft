// @vitest-environment happy-dom
//
// Per-kind owned-cell art for The Reliquary (src/ui/reliquary_cell_art.ts plus
// the thin ReliquaryWindow consumer). Before this module every non-item relic
// resolved through knownItemIconHtml with a NON-item id, so mounts, weapon
// skins, titles, and profession marks all painted the procedural UNKNOWN_RECIPE
// ghost. The acceptance pin is the catalog sweep below: no catalogued relic
// ghosts.
//
// The literal arms name the exact art each kind must reach, derived from typed
// literals rather than from a second call to the code under test, so a resolver
// that silently changed families would redden instead of agreeing with itself.
// The negative arms prove the membership guards: a junk id must return null
// (the caller's stale-client fallback) rather than mint a URL to a 404.
//
// happy-dom ships no 2D canvas, so nothing here may depend on compositing one.
// It does not need to: every art path these tests assert resolves to a static
// URL or an authored data URL, and icons.ts short-circuits both before the
// canvas. The procedural crest fall-back is asserted at the DESCRIPTOR level
// (the crest id), which is where the decision actually lives.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { MOUNTS } from '../src/sim/content/mounts';
import {
  FIELD_NOTE_PROFESSIONS,
  RELIQUARY_HORIZON_TITLES,
  RELIQUARY_PAGES,
  type ReliquaryRelicDef,
} from '../src/sim/content/reliquary';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { ITEMS } from '../src/sim/data';
import { mountItemId } from '../src/sim/mounts';
import {
  deedImageUrl,
  iconDataUrl,
  isUnknownIconRecipe,
  itemIconRecipe,
  itemImageUrl,
  needsIconDataUrlWarm,
  weaponIconUrl,
} from '../src/ui/icons';
import {
  RELIQUARY_SLAIN_GLYPH_ID,
  RELIQUARY_SLAIN_GLYPH_URL,
  RELIQUARY_SPECIMEN_GLYPH_ID,
  RELIQUARY_SPECIMEN_GLYPH_URL,
  type ReliquaryArtSlot,
  reliquaryCellArt,
  reliquaryCellArtOpaque,
} from '../src/ui/reliquary_cell_art';
import { ReliquaryWindow, type ReliquaryWindowDeps } from '../src/ui/reliquary_window';
import { knownItemIconHtml } from '../src/ui/unknown_item_icon';
import { webpHasAlpha } from './helpers/webp_header';

const REPO_ROOT = join(__dirname, '..');

/** The slot id of one catalog relic, whatever its kind. */
function slotId(relic: ReliquaryRelicDef): string {
  if (relic.kind === 'item') return relic.itemId;
  if (relic.kind === 'mark') return relic.markId;
  if (relic.kind === 'mount') return relic.mountId;
  if (relic.kind === 'weapon_skin') return relic.skinId;
  return relic.deedId;
}

/** Every relic on every page, as the slot pair both art surfaces hand in. */
const CATALOG_SLOTS: ReliquaryArtSlot[] = RELIQUARY_PAGES.flatMap((page) =>
  page.relics.map((relic) => ({ kind: relic.kind, id: slotId(relic) })),
);

// ---------------------------------------------------------------------------
// 1. Catalog sweep (the acceptance pin)
// ---------------------------------------------------------------------------

describe('catalog coverage', () => {
  it('sweeps a real, non-empty slice of the catalog (anti-vacuity)', () => {
    // A page table that stopped loading, or a slotId() that returned '' for
    // every row, would make the coverage pin below assert over nothing.
    expect(CATALOG_SLOTS.length).toBeGreaterThan(200);
    expect(CATALOG_SLOTS.every((slot) => slot.id !== '')).toBe(true);
    // All five authored kinds are really in the sweep, so the coverage pin is
    // not carried by the item shelves alone.
    expect([...new Set(CATALOG_SLOTS.map((slot) => slot.kind))].sort()).toEqual([
      'item',
      'mark',
      'mount',
      'title',
      'weapon_skin',
    ]);
  });

  it('resolves art for EVERY relic on EVERY page (no ghost for a catalogued relic)', () => {
    const ghosted = CATALOG_SLOTS.filter((slot) => reliquaryCellArt(slot) === null).map(
      (slot) => `${slot.kind}:${slot.id}`,
    );
    expect(ghosted, `catalogued relics with no art:\n${ghosted.join('\n')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Literal per-kind pins
// ---------------------------------------------------------------------------

describe('mount relics resolve their reins item', () => {
  it('routes a named mount to its reins ItemDef, not the mount key', () => {
    // The premise, so a renamed reins item fails loudly here rather than
    // quietly making the expectation trivially true.
    const reins = ITEMS.reins_terrorspark_groundshaker;
    expect(reins?.kind, 'content premise: the reins are a mount item').toBe('mount');
    expect(reins?.kind === 'mount' ? reins.mount : null).toBe('terrorspark_groundshaker');
    expect(reliquaryCellArt({ kind: 'mount', id: 'terrorspark_groundshaker' })).toEqual({
      kind: 'item',
      itemId: 'reins_terrorspark_groundshaker',
    });
    expect(reliquaryCellArt({ kind: 'mount', id: 'valorsteed' })).toEqual({
      kind: 'item',
      itemId: 'reins_valorsteed',
    });
  });

  it('lands every catalog mount on committed reins art', () => {
    for (const key of Object.keys(MOUNTS)) {
      const art = reliquaryCellArt({ kind: 'mount', id: key });
      expect(art, key).toEqual({ kind: 'item', itemId: `reins_${key}` });
    }
  });

  it('keeps every mount rarity in agreement with its reins item quality', () => {
    // The cell frame and tooltip take their rung from MOUNTS[key].rarity while
    // the icon img (via deps.itemIcon) takes its rung from the reins
    // ItemDef.quality. Nothing structural forces the two content tables to
    // agree, so a content edit to one side would paint an icon rung that
    // disagrees with its own cell frame; this pin makes that a red instead.
    for (const [key, def] of Object.entries(MOUNTS)) {
      const reinsId = mountItemId(key);
      expect(reinsId, key).not.toBeNull();
      const reins = ITEMS[reinsId as string];
      // Assert the def exists before comparing: the `?? 'common'` fallback
      // below matches common defs that omit quality, and must never stand in
      // for a deleted reins item on the one common-rarity mount.
      expect(reins, key).toBeDefined();
      expect(reins?.quality ?? 'common', key).toBe(def.rarity);
    }
  });
});

describe('weapon skin relics resolve the Armory thumbnail', () => {
  it('routes a named skin to its store thumbnail URL', () => {
    expect(WEAPON_SKINS.brasscap_axe, 'content premise: brasscap_axe is a live skin').toBeDefined();
    expect(reliquaryCellArt({ kind: 'weapon_skin', id: 'brasscap_axe' })).toEqual({
      kind: 'url',
      url: '/ui/store/armory/brasscap_axe.webp',
    });
    expect(reliquaryCellArt({ kind: 'weapon_skin', id: 'ashspark_dagger' })).toEqual({
      kind: 'url',
      url: '/ui/store/armory/ashspark_dagger.webp',
    });
  });
});

describe('title relics resolve the deed crest', () => {
  it('routes a PAINTED title deed to its own crest', () => {
    expect(deedImageUrl('deed_prog_veteran'), 'content premise: prog_veteran ships crest art').toBe(
      '/ui/deeds/prog_veteran.webp',
    );
    expect(reliquaryCellArt({ kind: 'title', id: 'prog_veteran' })).toEqual({
      kind: 'crest',
      crestId: 'deed_prog_veteran',
    });
  });

  it('routes a Reliquary title deed to its own newly painted crest', () => {
    expect(RELIQUARY_HORIZON_TITLES).toContain('col_reliquary_rank_2');
    expect(DEEDS.col_reliquary_rank_2?.category).toBe('collection');
    expect(deedImageUrl('deed_col_reliquary_rank_2')).toBe('/ui/deeds/col_reliquary_rank_2.webp');
    const art = reliquaryCellArt({ kind: 'title', id: 'col_reliquary_rank_2' });
    expect(art).toEqual({ kind: 'crest', crestId: 'deed_col_reliquary_rank_2' });
  });

  it('routes every title on the shelf to a committed per-deed crest', () => {
    const pending = RELIQUARY_HORIZON_TITLES.filter((id) => deedImageUrl(`deed_${id}`) === null);
    expect(pending, 'the title shelf must not use category fallback art').toEqual([]);
    for (const id of RELIQUARY_HORIZON_TITLES) {
      expect(reliquaryCellArt({ kind: 'title', id }), id).toEqual({
        kind: 'crest',
        crestId: `deed_${id}`,
      });
    }
  });
});

describe('profession mark relics resolve the profession sheet', () => {
  it('routes the lifetime first-masterwork mark to the seal', () => {
    expect(reliquaryCellArt({ kind: 'mark', id: 'masterwork:first' })).toEqual({
      kind: 'url',
      url: '/ui/professions/masterwork_seal.webp',
    });
  });

  it('routes a per-craft masterwork mark to that craft art', () => {
    expect(reliquaryCellArt({ kind: 'mark', id: 'masterwork:weaponcrafting' })).toEqual({
      kind: 'url',
      url: '/ui/professions/prof_weaponcrafting.webp',
    });
    expect(reliquaryCellArt({ kind: 'mark', id: 'masterwork:leatherworking' })).toEqual({
      kind: 'url',
      url: '/ui/professions/prof_leatherworking.webp',
    });
  });

  it('routes each rare field note to the gathering profession that works its node', () => {
    // The pairing is the catalog's (FIELD_NOTE_PROFESSIONS); asserted here as a
    // premise so a content change to the map cannot silently redirect the art.
    // The map is frozen at the source (it now escapes its module and rides the
    // client bundle); pin the freeze so a refactor cannot quietly drop it.
    expect(Object.isFrozen(FIELD_NOTE_PROFESSIONS)).toBe(true);
    expect(FIELD_NOTE_PROFESSIONS['gather_event:pristine_vein']).toBe('mining');
    expect(reliquaryCellArt({ kind: 'mark', id: 'gather_event:pristine_vein' })).toEqual({
      kind: 'url',
      url: '/ui/professions/gather_mining.webp',
    });
    expect(reliquaryCellArt({ kind: 'mark', id: 'gather_event:ancient_heartwood' })).toEqual({
      kind: 'url',
      url: '/ui/professions/gather_logging.webp',
    });
    expect(reliquaryCellArt({ kind: 'mark', id: 'gather_event:moonlit_bloom' })).toEqual({
      kind: 'url',
      url: '/ui/professions/gather_herbalism.webp',
    });
  });
});

describe('the corpse-harvest specimen glyph', () => {
  const SPECIMEN_ID = 'gather_event:perfect_specimen';
  // sha256 of the full data URL; re-pin here on a deliberate art edit.
  const SPECIMEN_GLYPH_SHA256 = 'd8f1dd69de9efa193f5bf1131184abd7b8c09d873c5447df8de682f399e02091';

  it('is the authored SVG, not a borrowed profession image', () => {
    // The premise the whole glyph exists for: this mark belongs to no gathering
    // profession, so the catalog map has no entry to borrow art from.
    expect(FIELD_NOTE_PROFESSIONS[SPECIMEN_ID]).toBeUndefined();
    const art = reliquaryCellArt({ kind: 'mark', id: SPECIMEN_ID });
    expect(art).toEqual({ kind: 'url', url: RELIQUARY_SPECIMEN_GLYPH_URL });
    // Literal shape pins, so a re-encoding or a swapped glyph reddens.
    expect(RELIQUARY_SPECIMEN_GLYPH_URL.startsWith('data:image/svg+xml,')).toBe(true);
    expect(RELIQUARY_SPECIMEN_GLYPH_URL).toContain('woc-specimen-glyph');
    expect(RELIQUARY_SPECIMEN_GLYPH_ID).toBe('woc-specimen-glyph');
    // Byte pin on the authored art itself (the equality above compares the
    // constant to its own import, which cannot see a redraw). To update after
    // a deliberate art edit, re-pin this digest in the same commit.
    expect(createHash('sha256').update(RELIQUARY_SPECIMEN_GLYPH_URL).digest('hex')).toBe(
      SPECIMEN_GLYPH_SHA256,
    );
  });

  it('is NOT the procedural unknown-icon ghost the slot used to get', () => {
    // Both halves of the old behavior, pinned canvas-free: this id ships no
    // static art (so the ghost path had to composite) and the recipe it would
    // have composited IS the shared UNKNOWN_RECIPE fallback.
    expect(needsIconDataUrlWarm('item', SPECIMEN_ID)).toBe(true);
    expect(isUnknownIconRecipe(itemIconRecipe(SPECIMEN_ID))).toBe(true);
    expect(RELIQUARY_SPECIMEN_GLYPH_URL).not.toContain('base64');
  });

  it('percent-encodes to a src the window escaper cannot alter', () => {
    // esc() rewrites & < > " and ', so any of them surviving the encoding would
    // corrupt the src on the way into the attribute.
    expect(RELIQUARY_SPECIMEN_GLYPH_URL).not.toMatch(/[&<>"']/);
    const svg = decodeURIComponent(
      RELIQUARY_SPECIMEN_GLYPH_URL.slice('data:image/svg+xml,'.length),
    );
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    // Multi-color painted style, not a flat monochrome vector.
    expect([...svg.matchAll(/#[0-9a-f]{6}/g)].length).toBeGreaterThan(4);
  });
});

describe('the rare-slain portraits (Phase 21)', () => {
  // sha256 of the full data URL; re-pin here on a deliberate art edit.
  const SLAIN_GLYPH_SHA256 = '9c856cb96227af2a87550e356091cbec899fed129e2099f23146232a2ce75035';

  it('routes every catalogued slain mark to its exact committed mob portrait', () => {
    // These marks have no profession art to borrow, but each template already
    // has the same committed portrait the target frame uses. The authored
    // trophy stays attached only as the runtime load/decode fallback.
    expect(FIELD_NOTE_PROFESSIONS['slain:old_greyjaw']).toBeUndefined();
    const slainIds = RELIQUARY_PAGES.flatMap((page) =>
      page.relics.flatMap((relic) =>
        relic.kind === 'mark' && relic.markId.startsWith('slain:') ? [relic.markId] : [],
      ),
    );
    // Anti-vacuity: the catalog really carries the 19 kill proofs.
    expect(slainIds.length).toBe(19);
    for (const id of slainIds) {
      const templateId = id.slice('slain:'.length);
      const portraitUrl = `/ui/mobs/${templateId}.webp`;
      expect(existsSync(join(REPO_ROOT, 'public', portraitUrl))).toBe(true);
      expect(reliquaryCellArt({ kind: 'mark', id })).toEqual({
        kind: 'url',
        url: portraitUrl,
        fallbackUrl: RELIQUARY_SLAIN_GLYPH_URL,
      });
    }
    // Literal shape pins, so a re-encoding or a swapped glyph reddens.
    expect(RELIQUARY_SLAIN_GLYPH_URL.startsWith('data:image/svg+xml,')).toBe(true);
    expect(RELIQUARY_SLAIN_GLYPH_URL).toContain('woc-slain-glyph');
    expect(RELIQUARY_SLAIN_GLYPH_ID).toBe('woc-slain-glyph');
    // Byte pin on the authored art itself, the specimen-glyph regime: re-pin
    // this digest in the same commit as a deliberate art edit.
    expect(createHash('sha256').update(RELIQUARY_SLAIN_GLYPH_URL).digest('hex')).toBe(
      SLAIN_GLYPH_SHA256,
    );
  });

  it('percent-encodes to a src the window escaper cannot alter', () => {
    expect(RELIQUARY_SLAIN_GLYPH_URL).not.toMatch(/[&<>"']/);
    const svg = decodeURIComponent(RELIQUARY_SLAIN_GLYPH_URL.slice('data:image/svg+xml,'.length));
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    // Multi-color painted style, not a flat monochrome vector.
    expect([...svg.matchAll(/#[0-9a-f]{6}/g)].length).toBeGreaterThan(4);
    expect(RELIQUARY_SLAIN_GLYPH_URL).not.toContain('base64');
  });

  it('is catalog-gated: an uncatalogued slain id answers null, not trophy art', () => {
    // The same allowlist noteReliquaryMark writes through, so a junk id off
    // the wire (or a rare retired from the catalog) keeps the caller fallback.
    expect(reliquaryCellArt({ kind: 'mark', id: 'slain:not_a_rare' })).toBeNull();
    expect(reliquaryCellArt({ kind: 'mark', id: 'slain:forest_wolf' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Negative arms (the membership guards)
// ---------------------------------------------------------------------------

describe('unknown ids fall through to the caller fallback', () => {
  it('returns null for a junk id of every kind', () => {
    const junk: ReliquaryArtSlot[] = [
      { kind: 'item', id: 'not_a_real_item' },
      { kind: 'unknown', id: 'not_a_real_item' },
      { kind: 'mount', id: 'not_a_real_mount' },
      { kind: 'weapon_skin', id: 'not_a_real_skin' },
      { kind: 'title', id: 'not_a_real_deed' },
      { kind: 'mark', id: 'not_a_real_mark' },
      { kind: 'mark', id: 'masterwork:notacraft' },
      { kind: 'mark', id: 'gather_event:nosuchflavor' },
      // Path-traversal shapes: the Set/allowlist membership gates are what
      // keep a wire-supplied id from minting a filesystem-shaped URL; these
      // arms document that intent, not just the typo case above.
      { kind: 'mark', id: 'masterwork:../../x' },
      { kind: 'weapon_skin', id: '../../../etc/passwd' },
      { kind: 'title', id: '../prog_veteran' },
    ];
    for (const slot of junk) {
      expect(reliquaryCellArt(slot), `${slot.kind}:${slot.id}`).toBeNull();
    }
  });

  it('returns null for a prototype key on every table-backed kind (R34)', () => {
    // A bare Record index resolves 'constructor' to a truthy Function, which
    // would send a junk id down the known arm and mint art for nothing.
    for (const id of ['constructor', '__proto__', 'toString']) {
      expect(reliquaryCellArt({ kind: 'item', id }), id).toBeNull();
      expect(reliquaryCellArt({ kind: 'unknown', id }), id).toBeNull();
      expect(reliquaryCellArt({ kind: 'weapon_skin', id }), id).toBeNull();
      expect(reliquaryCellArt({ kind: 'title', id }), id).toBeNull();
      expect(reliquaryCellArt({ kind: 'mark', id }), id).toBeNull();
      expect(reliquaryCellArt({ kind: 'mount', id }), id).toBeNull();
    }
  });

  it('flags exactly the two self-backgrounded families as opaque (literal arms)', () => {
    // The carve-out premise at the DESCRIPTOR level: Armory cards and the
    // display-category fallback crests paint their own background; every
    // other family carries an alpha matte (byte-pinned by the shipped-art
    // sweep below). Literals, not a second resolver call, per the file rule.
    expect(reliquaryCellArtOpaque({ kind: 'url', url: '/ui/store/armory/brasscap_axe.webp' })).toBe(
      true,
    );
    expect(reliquaryCellArtOpaque({ kind: 'crest', crestId: 'deed_cat_pvp' })).toBe(true);
    expect(
      reliquaryCellArtOpaque({ kind: 'url', url: '/ui/professions/masterwork_seal.webp' }),
    ).toBe(false);
    // Mob portraits are opaque dark-card art like the item family, not a
    // bright self-backgrounded card that needs the gentler carve-out.
    expect(reliquaryCellArtOpaque({ kind: 'url', url: '/ui/mobs/old_greyjaw.webp' })).toBe(false);
    expect(reliquaryCellArtOpaque({ kind: 'url', url: RELIQUARY_SPECIMEN_GLYPH_URL })).toBe(false);
    // The slain trophy glyph carries a real alpha matte like the specimen
    // flask, so it stays on the silhouette-darken side of the carve-out.
    expect(reliquaryCellArtOpaque({ kind: 'url', url: RELIQUARY_SLAIN_GLYPH_URL })).toBe(false);
    expect(reliquaryCellArtOpaque({ kind: 'crest', crestId: 'deed_prog_veteran' })).toBe(false);
    expect(reliquaryCellArtOpaque({ kind: 'item', itemId: 'reins_valorsteed' })).toBe(false);
    // Prefix BOUNDARY on the url arm: a sibling directory must not ride the
    // carve-out (the trailing slash is load-bearing).
    expect(reliquaryCellArtOpaque({ kind: 'url', url: '/ui/store/armory-promo/x.webp' })).toBe(
      false,
    );
    // The crest arm keys on PAINTED-ART MEMBERSHIP, not the deed_cat_ prefix:
    // any crest the compositor must paint procedurally (a category fallback,
    // a bespoke crest whose commissioned art has not landed, an unknown id)
    // is an opaque tile by construction. The bespoke-pending shape is pinned
    // synthetically because its live population is empty today (all 21
    // DEED_BESPOKE_CRESTS ids ship committed art): a deed_<id> crest absent
    // from DEED_IMAGE_IDS must ride the carve-out, which is exactly the case
    // the retired prefix test answered wrongly.
    expect(reliquaryCellArtOpaque({ kind: 'crest', crestId: 'deed_category_thing' })).toBe(true);
    expect(
      reliquaryCellArtOpaque({ kind: 'crest', crestId: 'deed_some_future_bespoke_pending' }),
    ).toBe(true);
    // A crest id with no deed_ prefix at all (class/talent crests) is
    // unreachable from the catalog (reliquaryCellArt only mints crest ids
    // via deedCrestId) but pinned so the answer is named: procedural, so
    // opaque if it ever arrived.
    expect(reliquaryCellArtOpaque({ kind: 'crest', crestId: 'class_warrior' })).toBe(true);
  });

  it('agrees with the resolver on real catalog slots (both directions)', () => {
    const skin = reliquaryCellArt({ kind: 'weapon_skin', id: 'brasscap_axe' });
    expect(skin !== null && reliquaryCellArtOpaque(skin)).toBe(true);
    for (const id of RELIQUARY_HORIZON_TITLES) {
      const painted = reliquaryCellArt({ kind: 'title', id });
      expect(painted).toEqual({ kind: 'crest', crestId: `deed_${id}` });
      expect(painted !== null && reliquaryCellArtOpaque(painted), id).toBe(false);
    }
    const mount = reliquaryCellArt({ kind: 'mount', id: 'valorsteed' });
    expect(mount !== null && reliquaryCellArtOpaque(mount)).toBe(false);
  });

  it('agrees with deedImageUrl on EVERY catalogued crest (both premise halves)', () => {
    // The crest arm's whole contract in one derived sweep: opaque exactly
    // when no committed painted file backs the crest, which covers the
    // category fallbacks AND a future bespoke crest whose art trails its
    // deed (deedCrestId answers deed_<id> for those, so a prefix test would
    // wrongly leave them on the silhouette filter).
    let crests = 0;
    for (const slot of CATALOG_SLOTS) {
      const art = reliquaryCellArt(slot);
      if (art === null || art.kind !== 'crest') continue;
      crests += 1;
      expect(reliquaryCellArtOpaque(art), art.crestId).toBe(deedImageUrl(art.crestId) === null);
    }
    expect(crests, 'anti-vacuity: the titles shelf really contributed crests').toBeGreaterThan(30);
  });

  it('every catalogued item relic resolves to a COMMITTED dark-card pipeline', () => {
    // The item arm of reliquaryCellArtOpaque answers false uncondition-
    // ally, resting on this premise: every item the catalog can show ships
    // either a /ui/items webp (non-weapons, alpha-less but dark-card) or a
    // /ui/weapons rendered-model jpg (weapons via ITEM_WEAPON_VARIANTS,
    // measured dark: mean luma ~25/255), both of which stay legible under
    // the silhouette darken. A catalogued item that falls through to the
    // procedural compositor instead would paint an opaque radial tile, so
    // the FIRST such relic reds here and must extend the predicate rather
    // than land silently on the wrong filter.
    const procedural: string[] = [];
    let itemsWebp = 0;
    let weaponsJpg = 0;
    for (const slot of CATALOG_SLOTS) {
      const art = reliquaryCellArt(slot);
      if (art === null || art.kind !== 'item') continue;
      if (itemImageUrl(art.itemId) !== null) itemsWebp += 1;
      else if (weaponIconUrl(art.itemId) !== null) weaponsJpg += 1;
      else procedural.push(art.itemId);
    }
    // Per-pipeline floors, so the "both committed pipelines" claim cannot go
    // vacuous if one family empties out of the catalog.
    expect(itemsWebp, 'anti-vacuity: the items-webp pipeline really contributed').toBeGreaterThan(
      50,
    );
    expect(weaponsJpg, 'anti-vacuity: the weapons-jpg pipeline really contributed').toBeGreaterThan(
      10,
    );
    expect(
      procedural,
      `catalogued item relics with only procedural art (extend reliquaryCellArtOpaque):\n${procedural.join('\n')}`,
    ).toEqual([]);
  });

  it('preserves the item passthrough for a real item id (behavior unchanged)', () => {
    expect(reliquaryCellArt({ kind: 'item', id: 'cryptbone_helm' })).toEqual({
      kind: 'item',
      itemId: 'cryptbone_helm',
    });
    // The recent ring's wire-shaped kind resolves the same way.
    expect(reliquaryCellArt({ kind: 'unknown', id: 'cryptbone_helm' })).toEqual({
      kind: 'item',
      itemId: 'cryptbone_helm',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Every URL the resolver can emit names a file that ships
// ---------------------------------------------------------------------------

describe('shipped art files', () => {
  it('backs every catalog-reachable public URL with a committed file', () => {
    const missing: string[] = [];
    const families = new Set<string>();
    for (const slot of CATALOG_SLOTS) {
      const art = reliquaryCellArt(slot);
      if (art === null || art.kind !== 'url' || !art.url.startsWith('/')) continue;
      families.add(art.url.slice(0, art.url.lastIndexOf('/')));
      if (!existsSync(join(REPO_ROOT, 'public', art.url.slice(1)))) missing.push(art.url);
    }
    // Anti-vacuity: all URL families the catalog reaches are really swept, so
    // a resolver that stopped emitting URLs could not pass by emitting none.
    expect([...families].sort()).toEqual(['/ui/mobs', '/ui/professions', '/ui/store/armory']);
    expect(missing, `art URLs with no committed file:\n${missing.join('\n')}`).toEqual([]);
  });

  it('pins the opacity premise per family off the shipped WebP headers', () => {
    // The premise under reliquaryCellArtOpaque: the silhouette filter needs
    // either a real alpha matte (professions sheet, painted deed crests) or
    // dark-backgrounded icon-style art (the item family and mob portraits;
    // their bright subjects on near-black cards still read under
    // brightness(0.18)). What it cannot work on is BRIGHT self-backgrounded art: the
    // Armory cards (pinned opaque here, all of them; the sweep is
    // CATALOG-bounded, a skin added to WEAPON_SKINS without a reliquary slot
    // is unswept here and surfaces in reliquary_content instead) and the
    // procedural deed_cat_* composites (opaque by construction in icons.ts
    // BACKGROUNDS, no file to read; that half of the premise is prose-only
    // here). A professions or painted-crest file losing its matte,
    // or an Armory card gaining one, must consciously re-pin here AND
    // revisit the predicate instead of silently landing on the wrong filter.
    const hasAlpha = (file: string): boolean => {
      expect(readFileSync(file).toString('ascii', 0, 4), file).toBe('RIFF');
      return webpHasAlpha(file);
    };
    const staticCrestUrl = (crestId: string): string | null => {
      const url = deedImageUrl(crestId);
      return url?.startsWith('/') && url.endsWith('.webp') ? url : null;
    };
    const families = new Set<string>();
    for (const slot of CATALOG_SLOTS) {
      const art = reliquaryCellArt(slot);
      if (art === null || art.kind === 'item') continue;
      const url =
        art.kind === 'url' && art.url.startsWith('/') && art.url.endsWith('.webp')
          ? art.url
          : art.kind === 'crest'
            ? staticCrestUrl(art.crestId)
            : null;
      if (url === null) continue;
      families.add(url.slice(0, url.lastIndexOf('/')));
      const expectAlpha = !url.startsWith('/ui/store/armory/') && !url.startsWith('/ui/mobs/');
      expect(hasAlpha(join(REPO_ROOT, 'public', url.slice(1))), url).toBe(expectAlpha);
    }
    // Anti-vacuity: all four file-backed non-item families really swept.
    expect([...families].sort()).toEqual([
      '/ui/deeds',
      '/ui/mobs',
      '/ui/professions',
      '/ui/store/armory',
    ]);
  });

  it('backs the item and crest families with committed files too', () => {
    // Those two do not carry a URL in the descriptor: the item arm goes through
    // the shared itemIcon painter and the crest arm through iconDataUrl, so the
    // file check follows the same resolvers the window uses.
    const reins = reliquaryCellArt({ kind: 'mount', id: 'terrorspark_groundshaker' });
    expect(reins?.kind).toBe('item');
    const reinsUrl = iconDataUrl('item', 'reins_terrorspark_groundshaker');
    expect(reinsUrl).toBe('/ui/items/reins_terrorspark_groundshaker.webp');
    expect(existsSync(join(REPO_ROOT, 'public', reinsUrl.slice(1)))).toBe(true);

    const crest = reliquaryCellArt({ kind: 'title', id: 'prog_veteran' });
    expect(crest).toEqual({ kind: 'crest', crestId: 'deed_prog_veteran' });
    const crestUrl = iconDataUrl('crest', 'deed_prog_veteran');
    expect(crestUrl).toBe('/ui/deeds/prog_veteran.webp');
    expect(existsSync(join(REPO_ROOT, 'public', crestUrl.slice(1)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. The window paints the descriptor into the class the grid CSS needs
// ---------------------------------------------------------------------------

interface ArtRig {
  el: HTMLElement;
  window: ReliquaryWindow;
}

function makeRig(seed: { recent?: string[]; marks?: string[] } = {}): ArtRig {
  const recent = seed.recent ?? [];
  const marks = new Set(seed.marks ?? []);
  const el = document.createElement('div');
  el.id = 'reliquary-window';
  document.body.appendChild(el);
  const opener = document.createElement('button');
  document.body.appendChild(opener);

  const deps: ReliquaryWindowDeps = {
    root: () => el,
    world: () =>
      ({
        cfg: { playerClass: 'warrior' },
        player: { name: 'Artwright' },
        deedStats: { itemsDiscovered: new Set<string>() },
        reliquaryMarks: marks,
        reliquaryRecent: recent,
        reliquaryFirstFind: {},
        ownedMounts: () => [],
        accountCosmetics: { weaponSkinIds: [] as string[] },
        deedsEarned: new Map<string, string>(),
        reliquaryPageClearCount: () => undefined,
        reliquaryCatalogCompletion: () => ({ owned: 0, total: CATALOG_SLOTS.length }),
        reliquaryCuratorRank: () => 0,
        reliquaryPageCompletion: (pageId: string) => {
          const page = RELIQUARY_PAGES.find((p) => p.id === pageId);
          if (!page) return null;
          return { owned: 0, total: page.relics.length, complete: false };
        },
        reliquaryRarity: () => Promise.resolve(null),
      }) as never,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => false,
    captureFocus: () => opener,
    restoreFocus: () => {},
    onPinChanged: () => {},
    // The production body verbatim (Hud.itemIcon is `knownItemIconHtml(item)`,
    // pinned below), so the markup these tests read is the markup a player gets.
    itemIcon: (item) => knownItemIconHtml(item),
    moneyHtml: () => '',
    itemTooltip: (item) => `<div data-item-tooltip="${item.id}"></div>`,
    attachTooltip: () => {},
  };
  return { el, window: new ReliquaryWindow(deps) };
}

/** Open the window and navigate to one page, the way a player clicks in. */
function openPage(
  rig: ArtRig,
  nav: 'conquerors' | 'horizons' | 'professions',
  pageId: string,
): void {
  rig.window.open(nav);
  const row = rig.el.querySelector<HTMLElement>(`[data-page="${pageId}"]`);
  if (!row) throw new Error(`contract: the ${nav} shelf lists ${pageId}`);
  row.click();
}

/** The one grid cell for a relic id, and the img inside it. */
function cellArt(rig: ArtRig, relicId: string): HTMLImageElement {
  const cell = rig.el.querySelector<HTMLElement>(`.reliquary-cell[data-cell-id="${relicId}"]`);
  if (!cell) throw new Error(`contract: the open page paints a cell for ${relicId}`);
  const img = cell.querySelector<HTMLImageElement>('.reliquary-cell-art img');
  if (!img) throw new Error(`contract: the ${relicId} cell paints art`);
  return img;
}

describe('ReliquaryWindow cell markup', () => {
  it('keeps the deps.itemIcon stub honest against the real Hud body', () => {
    // Anti-drift for the rig above: if Hud stops delegating to
    // knownItemIconHtml, the mount assertions below stop describing production.
    // Comment-stripped, so prose quoting the body cannot satisfy the pin.
    const hud = readFileSync(join(REPO_ROOT, 'src/ui/hud.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .map((line) => line.replace(/\s\/\/.*$/, ''))
      .join('\n');
    expect(hud).toMatch(
      /private itemIcon\(item: ItemDef\): string \{\s*return knownItemIconHtml\(item\);/,
    );
  });

  it('paints a mount cell as the reins art in the item-icon shape', () => {
    const rig = makeRig();
    openPage(rig, 'horizons', 'horizons_mounts');
    const img = cellArt(rig, 'terrorspark_groundshaker');
    // The class is load-bearing: .reliquary-cell-art .item-icon is what sizes
    // the art to 70% and what the missing state silhouettes.
    expect(img.getAttribute('class')).toBe('item-icon q-epic');
    expect(img.getAttribute('src')).toBe('/ui/items/reins_terrorspark_groundshaker.webp');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('draggable')).toBe('false');
    // The CELL frame's rung comes from cellQuality's mountDef arm (the img's
    // comes from the reins ItemDef); deleting that arm frames q-common.
    const cell = rig.el.querySelector<HTMLElement>(
      '.reliquary-cell[data-cell-id="terrorspark_groundshaker"]',
    );
    expect(cell?.className, 'cell frame rung').toContain('q-epic');
  });

  it('paints a profession mark cell as the profession art', () => {
    const rig = makeRig();
    openPage(rig, 'professions', 'professions_masterwork');
    const seal = cellArt(rig, 'masterwork:first');
    expect(seal.getAttribute('class')).toBe('item-icon q-epic');
    expect(seal.getAttribute('src')).toBe('/ui/professions/masterwork_seal.webp');
    const craft = cellArt(rig, 'masterwork:weaponcrafting');
    expect(craft.getAttribute('src')).toBe('/ui/professions/prof_weaponcrafting.webp');
  });

  it('paints the corpse-harvest specimen cell as the authored glyph', () => {
    const rig = makeRig();
    openPage(rig, 'professions', 'professions_field_notes');
    const img = cellArt(rig, 'gather_event:perfect_specimen');
    expect(img.getAttribute('class')).toBe('item-icon q-rare');
    expect(img.getAttribute('src')).toBe(RELIQUARY_SPECIMEN_GLYPH_URL);
    // Its neighbour on the same page takes the borrowed profession art, so the
    // glyph is demonstrably specific to this slot and not a page-wide default.
    expect(cellArt(rig, 'gather_event:pristine_vein').getAttribute('src')).toBe(
      '/ui/professions/gather_mining.webp',
    );
  });

  it('paints a slain mark with its exact portrait and swaps to the trophy on error', () => {
    const rig = makeRig();
    openPage(rig, 'conquerors', 'conquerors_rares_of_the_realm');
    const img = cellArt(rig, 'slain:old_greyjaw');

    // Success path: distinct committed portrait first, with the fallback
    // carried on the mounted node rather than replacing the primary art.
    expect(img.getAttribute('src')).toBe('/ui/mobs/old_greyjaw.webp');
    expect(img.getAttribute('data-icon-fallback-src')).toBe(RELIQUARY_SLAIN_GLYPH_URL);

    // Failure path: one error swaps to the authored data URL and disarms the
    // listener/attribute, so even a corrupt fallback cannot recurse.
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(RELIQUARY_SLAIN_GLYPH_URL);
    expect(img.hasAttribute('data-icon-fallback-src')).toBe(false);
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(RELIQUARY_SLAIN_GLYPH_URL);
  });

  it('paints a painted-crest title cell through the crest branch, no canvas', () => {
    // The one window branch no other arm executes (QA gate should-fix): a
    // mutant reverting the crest arm to the ghost across the titles
    // shelf must red here. prog_veteran ships painted crest art, so
    // iconDataUrl short-circuits to the static URL and happy-dom needs no
    // canvas.
    const rig = makeRig();
    openPage(rig, 'horizons', 'horizons_titles');
    const img = cellArt(rig, 'prog_veteran');
    expect(img.getAttribute('class')).toBe('item-icon q-epic');
    expect(img.getAttribute('src')).toBe('/ui/deeds/prog_veteran.webp');
    // Shelf totality: EVERY title cell paints an art img (which also pins the
    // crestIconSrc path and prevents any row from falling back to a blank img).
    const cells = rig.el.querySelectorAll('.reliquary-cell').length;
    expect(cells).toBeGreaterThan(30);
    expect(rig.el.querySelectorAll('.reliquary-cell .reliquary-cell-art img').length).toBe(cells);
  });

  it('paints opaque-art cells in the exact shape the missing-state carve-out targets', () => {
    // Joins the CSS declaration pin (reliquary_window.test.ts) to real cell
    // output BY CONSTRUCTION: the selector is read out of the live stylesheet,
    // so renaming it in CSS while updating only the declaration pin cannot
    // leave this arm green against a stale literal. An opaque Armory card or
    // category-fallback crest renders as a black tile whenever this breaks.
    const componentsCss = readFileSync(join(REPO_ROOT, 'src/styles/components.css'), 'utf8');
    // Commas excluded so a deleted carve-out cannot silently retarget the
    // extraction onto the forced-colors block's two-selector list (the arm
    // would still red, but pointing at the wrong cause).
    const selectorMatch = componentsCss.match(
      /^\s*(\.[^{},]*data-cell-art[^{},]*opaque[^{},]*)\{/m,
    );
    if (!selectorMatch) throw new Error('contract: the opaque-art carve-out rule exists');
    const liveSelector = selectorMatch[1].trim();
    expect(liveSelector).toContain('.reliquary-cell--missing');
    const rig = makeRig();
    openPage(rig, 'horizons', 'horizons_weapon_skins');
    const img = cellArt(rig, 'brasscap_axe');
    expect(img.getAttribute('src')).toBe('/ui/store/armory/brasscap_axe.webp');
    // The rung comes from cellQuality's WEAPON_SKINS arm (brasscap_axe is a
    // guildmark uncommon); deleting that arm paints q-common and reds here.
    expect(img.getAttribute('class')).toBe('item-icon q-uncommon');
    expect(img.matches(liveSelector)).toBe(true);
    // Painted title crests and mount reins stay on the silhouette treatment.
    // The negative arms assert the missing STATE and the attribute's absence
    // separately, so a rig that ever seeds ownership cannot make them pass
    // vacuously. No live title uses the category fallback now that every deed
    // has accepted painted art.
    openPage(rig, 'horizons', 'horizons_titles');
    const paintedImg = cellArt(rig, 'prog_veteran');
    expect(paintedImg.closest('.reliquary-cell--missing')).not.toBeNull();
    expect(paintedImg.closest('.reliquary-cell')?.hasAttribute('data-cell-art')).toBe(false);
    expect(paintedImg.matches(liveSelector)).toBe(false);
    openPage(rig, 'horizons', 'horizons_mounts');
    const mountImg = cellArt(rig, 'valorsteed');
    expect(mountImg.closest('.reliquary-cell--missing')).not.toBeNull();
    expect(mountImg.closest('.reliquary-cell')?.hasAttribute('data-cell-art')).toBe(false);
    expect(mountImg.matches(liveSelector)).toBe(false);
  });

  it('shares the resolver with the Overview recent strip', () => {
    // The chip and the cell are one implementation (cellIconHtml), so a mark
    // that just landed shows the same profession art in the strip as on its
    // shelf. A mark is the right probe here rather than a mount: the recent
    // ring classifies only item / mark / unknown (reliquary_view buildRecent),
    // so 'mark' is the one non-item kind a chip can actually carry.
    const rig = makeRig({ recent: ['masterwork:first'], marks: ['masterwork:first'] });
    rig.window.open('overview');
    const chip = rig.el.querySelector<HTMLImageElement>('.reliquary-recent-icon img');
    if (!chip) throw new Error('contract: a recent find paints its art in the chip');
    expect(chip.getAttribute('src')).toBe('/ui/professions/masterwork_seal.webp');
    expect(chip.getAttribute('class')).toBe('item-icon q-epic');
    // The same slot on its shelf paints byte-identical art (one resolver).
    openPage(rig, 'professions', 'professions_masterwork');
    expect(cellArt(rig, 'masterwork:first').outerHTML).toBe(chip.outerHTML);
  });

  it('shares the resolver with the strip for an ITEM find too', () => {
    // The strip's other reachable kind: an item chip routes through
    // deps.itemIcon exactly like the grid's item arm (and unlike the mark
    // arm's itemIconImgHtml), so the join is worth pinning per kind. The
    // grid passes its pre-resolved descriptor into cellIconHtml while the
    // strip omits the argument; byte-identity here is what proves the
    // default-parameter path cannot desync the two.
    const rig = makeRig({ recent: ['cryptbone_helm'] });
    rig.window.open('overview');
    const chip = rig.el.querySelector<HTMLImageElement>('.reliquary-recent-icon img');
    if (!chip) throw new Error('contract: a recent item find paints its art in the chip');
    openPage(rig, 'conquerors', 'conquerors_hollow_crypt');
    expect(cellArt(rig, 'cryptbone_helm').outerHTML).toBe(chip.outerHTML);
  });
});
