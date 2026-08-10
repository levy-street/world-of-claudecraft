// Which art one Reliquary relic slot paints, for the page grid and the recent
// strip alike. Pure and DOM-free: it answers with a DESCRIPTOR (an item id, a
// public URL, or a deed crest id) and never mints markup, so the window stays
// the only module that touches the DOM and a Vitest can drive every kind
// without a canvas.
//
// Before this module only item relics resolved real art; mounts, weapon skins,
// titles, and profession marks all fell through to knownItemIconHtml, whose
// icon id is not an item id, so every one of them landed on the procedural
// UNKNOWN_RECIPE ghost. Each kind already had committed art reachable from an
// existing seam; this is the ladder that walks to it:
//   mount        the reins ItemDef (mountItemId), so the cell paints exactly
//                what the bag paints
//   weapon_skin  the Season 1 Armory store thumbnail (armorySkinArt)
//   title        the deed crest (deedCrestId), painted where art is committed
//                and the display-category crest everywhere else
//   mark         the masterwork seal, the per-craft profession art, or the
//                gathering profession that works the field note's node type
// A slot with no answer returns null and the window keeps its previous
// behavior, so an id this bundle does not know still renders something.
//
// One mark has no committed art anywhere and takes an authored inline glyph
// instead of the ghost: gather_event:perfect_specimen fires on corpse harvest,
// which belongs to no gathering profession, so there is no profession image
// to borrow. The 19 slain:* rare kill proofs use their exact committed mob
// portraits and retain the authored trophy skull only as a load-error fallback.
//
// This module is an ART SOURCE (the icons.ts family), not a painter, which is
// why the authored glyph's palette lives here as literal colors: the painter
// hygiene scan that bans hex out of reliquary_window.ts is about a painter
// re-deciding a token, and that file still carries none.

import { DEEDS } from '../sim/content/deeds';
import { FIELD_NOTE_PROFESSIONS, RELIQUARY_MARK_IDS } from '../sim/content/reliquary';
import { WEAPON_SKINS } from '../sim/content/weapon_skins';
import { ITEMS } from '../sim/data';
import { mountItemId } from '../sim/mounts';
import { deedCrestHasPaintedArt, deedCrestId } from './deeds_view';
import { knownItemDef, ownEntry } from './known_item';
import { MASTERWORK_SEAL_IMAGE_URL, professionImageUrl } from './profession_art';
import type { ReliquaryRelicNameKind } from './reliquary_view';
import { targetPortraitUrl } from './target_portrait_view';
import { ARMORY_SKIN_ART_DIR, armorySkinArt } from './woc_store_view';

/**
 * Where a relic cell's art comes from. Three arms because the three pipelines
 * that own the art are genuinely different, and the window paints each one its
 * own way: an ITEM keeps going through the shared itemIcon painter (so a mount
 * cell and the reins stack in the bag can never disagree), a URL is a committed
 * public file painted directly, and a CREST goes through iconDataUrl, which
 * short-circuits to painted art or composites the category recipe.
 */
export type ReliquaryCellArt =
  | { kind: 'item'; itemId: string }
  | { kind: 'url'; url: string; fallbackUrl?: string }
  | { kind: 'crest'; crestId: string };

/** The relic slot shape both Reliquary art surfaces hand in (a grid cell and a
 *  recent find are the same pair, and the recent ring's wire-shaped 'unknown'
 *  kind rides along). */
export interface ReliquaryArtSlot {
  kind: ReliquaryRelicNameKind;
  id: string;
}

const MASTERWORK_PREFIX = 'masterwork:';
/** The lifetime first-masterwork mark, which names no single craft. */
const MASTERWORK_FIRST_ID = 'masterwork:first';
/** The corpse-harvest field note, the one catalogued relic no committed art
 *  covers (see the header). */
const PERFECT_SPECIMEN_MARK_ID = 'gather_event:perfect_specimen';
/** Painted-art id prefixes on the profession sheet (profession_art.ts). */
const CRAFT_IMAGE_PREFIX = 'prof_';
const GATHER_IMAGE_PREFIX = 'gather_';

/** Marker id carried by the specimen glyph, so a test can pin the authored art
 *  by something stabler than a color. */
export const RELIQUARY_SPECIMEN_GLYPH_ID = 'woc-specimen-glyph';

// The corpse-harvest specimen flask: a corked glass vial of a preserved
// sample, painted in the direction DESIGN.md section 6 sets for this surface
// (rich color, heavy dark outline, light from the top left) rather than a flat
// monochrome vector, which would read as foreign next to the painted profession
// sheet it sits beside. Authored inline as an SVG data URL so it needs no
// asset pipeline, no canvas, and no network, and so a Node test can assert the
// exact bytes the window paints. Double-quoted attributes only, and NO
// apostrophes anywhere in the markup: encodeURIComponent leaves an apostrophe
// unescaped, and the window's unconditional esc() would rewrite it inside the
// src attribute (the encoding-survives-esc pin in the module's test).
const SPECIMEN_FLASK_PATH = 'M26 13v11L13 47a20 20 0 0 0 38 0L38 24V13z';
const SPECIMEN_GLYPH_SVG =
  `<svg id="${RELIQUARY_SPECIMEN_GLYPH_ID}" xmlns="http://www.w3.org/2000/svg" ` +
  'viewBox="0 0 64 64" width="64" height="64">' +
  '<defs>' +
  '<linearGradient id="g" x1="16%" y1="6%" x2="86%" y2="96%">' +
  '<stop offset="0" stop-color="#b6f4ff"/><stop offset="44%" stop-color="#33a6d8"/>' +
  '<stop offset="1" stop-color="#0a3556"/></linearGradient>' +
  '<linearGradient id="c" x1="14%" y1="0%" x2="86%" y2="100%">' +
  '<stop offset="0" stop-color="#f8e09a"/><stop offset="1" stop-color="#845d1f"/></linearGradient>' +
  `<clipPath id="f"><path d="${SPECIMEN_FLASK_PATH}"/></clipPath>` +
  '</defs>' +
  `<path d="${SPECIMEN_FLASK_PATH}" fill="url(#g)" stroke="#0a0603" stroke-width="3.5" ` +
  'stroke-linejoin="round"/>' +
  '<g clip-path="url(#f)"><rect x="6" y="42" width="52" height="26" fill="#0e6ea3"/>' +
  '<rect x="6" y="42" width="52" height="2.5" fill="#8fe6ff" opacity="0.75"/></g>' +
  '<circle cx="26" cy="49" r="4.2" fill="#d4f8ff" opacity="0.8"/>' +
  '<circle cx="37" cy="53" r="2.6" fill="#d4f8ff" opacity="0.6"/>' +
  '<path d="M29 17c0 6-6 8-6 15" fill="none" stroke="#f2feff" stroke-width="3.2" ' +
  'stroke-linecap="round" opacity="0.9"/>' +
  '<rect x="22" y="4" width="20" height="10" rx="3" fill="url(#c)" stroke="#0a0603" ' +
  'stroke-width="3.5"/>' +
  '<path d="M25 6.5h6" fill="none" stroke="#fff6d8" stroke-width="2" stroke-linecap="round" ' +
  'opacity="0.8"/>' +
  '</svg>';

/** The specimen glyph as an `<img>`-ready src. Percent-encoded rather than
 *  base64: it survives the window's unconditional esc() byte for byte (the
 *  encoding leaves no `&`, `<`, `>`, `"` or `'` behind), and it stays greppable
 *  in a rendered page. */
export const RELIQUARY_SPECIMEN_GLYPH_URL = `data:image/svg+xml,${encodeURIComponent(
  SPECIMEN_GLYPH_SVG,
)}`;

/** Marker id carried by the slain-trophy glyph, the RELIQUARY_SPECIMEN_GLYPH_ID
 *  sibling, so a test can pin the authored art by something stabler than a
 *  color. */
export const RELIQUARY_SLAIN_GLYPH_ID = 'woc-slain-glyph';

/** The `slain:` visited namespace prefix the kill-credit site writes
 *  (src/sim/deeds.ts). */
const SLAIN_MARK_PREFIX = 'slain:';

// The rare-slain trophy: a horned beast skull, same authored-inline regime and
// DESIGN.md section 6 direction as the specimen flask above (rich color, heavy
// dark outline, light from the top left; double-quoted attributes, no
// apostrophes, encoding survives the window's esc()). It is the safe fallback
// for the exact mob portraits, so a missing/mixed-deploy WebP still paints a
// recognizable slain trophy rather than browser-broken art.
const SLAIN_SKULL_PATH =
  'M20 24c0-8 5-13 12-13s12 5 12 13c0 5-2 8-4 10v9l-4 7h-8l-4-7v-9c-2-2-4-5-4-10z';
const SLAIN_GLYPH_SVG =
  `<svg id="${RELIQUARY_SLAIN_GLYPH_ID}" xmlns="http://www.w3.org/2000/svg" ` +
  'viewBox="0 0 64 64" width="64" height="64">' +
  '<defs>' +
  '<linearGradient id="b" x1="16%" y1="6%" x2="86%" y2="96%">' +
  '<stop offset="0" stop-color="#fdf6dd"/><stop offset="46%" stop-color="#d9c290"/>' +
  '<stop offset="1" stop-color="#8a6b3c"/></linearGradient>' +
  '<linearGradient id="h" x1="10%" y1="0%" x2="90%" y2="100%">' +
  '<stop offset="0" stop-color="#7d5a30"/><stop offset="1" stop-color="#3c2812"/></linearGradient>' +
  '</defs>' +
  '<path d="M18 26C10 24 6 17 7 9c6 1 11 6 13 12z" fill="url(#h)" stroke="#0a0603" ' +
  'stroke-width="3.5" stroke-linejoin="round"/>' +
  '<path d="M46 26c8-2 12-9 11-17-6 1-11 6-13 12z" fill="url(#h)" stroke="#0a0603" ' +
  'stroke-width="3.5" stroke-linejoin="round"/>' +
  `<path d="${SLAIN_SKULL_PATH}" fill="url(#b)" stroke="#0a0603" stroke-width="3.5" ` +
  'stroke-linejoin="round"/>' +
  '<circle cx="26.5" cy="27" r="3.6" fill="#171009"/>' +
  '<circle cx="37.5" cy="27" r="3.6" fill="#171009"/>' +
  '<circle cx="25.6" cy="26" r="1.1" fill="#f8ecc9" opacity="0.85"/>' +
  '<path d="M32 33l-2.6 5h5.2z" fill="#171009"/>' +
  '<path d="M27 43v5M32 44v6M37 43v5" fill="none" stroke="#171009" stroke-width="2.4" ' +
  'stroke-linecap="round"/>' +
  '<path d="M23 15c2-2 5-3 8-3" fill="none" stroke="#fffbe9" stroke-width="2.6" ' +
  'stroke-linecap="round" opacity="0.8"/>' +
  '</svg>';

/** The slain-trophy glyph as an `<img>`-ready src (percent-encoded for the
 *  same esc()-survival reason as the specimen glyph). */
export const RELIQUARY_SLAIN_GLYPH_URL = `data:image/svg+xml,${encodeURIComponent(
  SLAIN_GLYPH_SVG,
)}`;

/**
 * Art for one relic slot, or null when this bundle cannot place it (an id from
 * a newer server, a content id that moved, a kind with no art seam). Null is a
 * real answer, not a failure: the caller keeps its existing fallback.
 *
 * Every Record read is own-property gated (ownEntry / knownItemDef): recent
 * finds arrive off the wire, and a bare index of a prototype key resolves a
 * truthy Function that would send a junk id down the known arm (the R34
 * contract in known_item.ts).
 */
export function reliquaryCellArt(slot: ReliquaryArtSlot): ReliquaryCellArt | null {
  if (slot.kind === 'item' || slot.kind === 'unknown') {
    return knownItemDef(ITEMS, slot.id) ? { kind: 'item', itemId: slot.id } : null;
  }
  if (slot.kind === 'mount') {
    // The mount's reins, so the cell resolves the same def the bag does and
    // inherits its quality, tooltip art, and any future item-art change for
    // free. mountItemId already answers null for an unknown key.
    const reinsId = mountItemId(slot.id);
    if (reinsId === null) return null;
    return knownItemDef(ITEMS, reinsId) ? { kind: 'item', itemId: reinsId } : null;
  }
  if (slot.kind === 'weapon_skin') {
    // armorySkinArt is a bare string builder with no membership check of its
    // own, so the catalog gate lives here or a junk id would mint a 404 URL.
    return ownEntry(WEAPON_SKINS, slot.id) ? { kind: 'url', url: armorySkinArt(slot.id) } : null;
  }
  if (slot.kind === 'title') {
    // A title relic IS its deed, so the Reliquary shows the crest the Book of
    // Deeds shows. deedCrestId is total over a known deed: painted art where it
    // is committed, the display-category crest everywhere else, so the title
    // shelf never shows a ghost even while art trails the deed.
    const deed = ownEntry(DEEDS, slot.id);
    return deed ? { kind: 'crest', crestId: deedCrestId(slot.id, deed.category) } : null;
  }
  if (slot.kind === 'mark') return markArt(slot.id);
  return null;
}

/**
 * True when this art paints its own BRIGHT background, so the missing-state
 * silhouette filter (brightness-darken) would render a solid dark tile
 * instead of a shape. Two catalog-reachable families qualify: the Armory
 * store thumbnails (painted cards, no alpha) and every PROCEDURAL crest
 * (the deed_cat_* category fallbacks plus a bespoke crest whose art has not
 * landed; the compositor fills its whole tile with an opaque radial). The
 * other families stay legible under the darken without a carve-out: the
 * professions sheet, painted `deed_<id>` crests, and the specimen/slain
 * fallback glyphs carry a real alpha matte. Item art and mob portraits use
 * dark-card compositions: a bright subject on a near-black card that still
 * reads when darkened. tests/reliquary_cell_art.test.ts pins the per-family
 * premise off the shipped image files, including that every catalogued item
 * relic really resolves to one of those two committed pipelines, so a
 * family flipping (or a first procedural item relic) reds there instead of
 * silently landing on the wrong filter.
 */
export function reliquaryCellArtOpaque(art: ReliquaryCellArt): boolean {
  if (art.kind === 'url') return art.url.startsWith(`${ARMORY_SKIN_ART_DIR}/`);
  if (art.kind === 'crest') return !deedCrestHasPaintedArt(art.crestId);
  return false;
}

/** Profession-sheet art for one lifetime mark. The masterwork family keys off
 *  its craft; field notes key off FIELD_NOTE_PROFESSIONS, the catalog's own
 *  flavor-to-profession map, so nothing here re-lists that pairing. */
function markArt(markId: string): ReliquaryCellArt | null {
  if (markId === MASTERWORK_FIRST_ID) return { kind: 'url', url: MASTERWORK_SEAL_IMAGE_URL };
  if (markId === PERFECT_SPECIMEN_MARK_ID) {
    return { kind: 'url', url: RELIQUARY_SPECIMEN_GLYPH_URL };
  }
  if (markId.startsWith(MASTERWORK_PREFIX)) {
    const craft = markId.slice(MASTERWORK_PREFIX.length);
    return imageArt(`${CRAFT_IMAGE_PREFIX}${craft}`);
  }
  const profession = ownEntry(FIELD_NOTE_PROFESSIONS, markId);
  if (profession !== undefined) return imageArt(`${GATHER_IMAGE_PREFIX}${profession}`);
  // Rares of the Realm kill proofs: catalog-gated (RELIQUARY_MARK_IDS is the
  // same allowlist noteReliquaryMark writes through), so a junk `slain:` id off
  // the wire still answers null instead of minting trophy art for it.
  if (markId.startsWith(SLAIN_MARK_PREFIX) && RELIQUARY_MARK_IDS.has(markId)) {
    const templateId = markId.slice(SLAIN_MARK_PREFIX.length);
    const portraitUrl = targetPortraitUrl(templateId, true);
    return portraitUrl === null
      ? { kind: 'url', url: RELIQUARY_SLAIN_GLYPH_URL }
      : { kind: 'url', url: portraitUrl, fallbackUrl: RELIQUARY_SLAIN_GLYPH_URL };
  }
  return null;
}

/** A profession-sheet image id as art, or null when that art is not committed
 *  (professionImageUrl carries the PROFESSION_IMAGE_IDS gate). */
function imageArt(imageId: string): ReliquaryCellArt | null {
  const url = professionImageUrl(imageId);
  return url === null ? null : { kind: 'url', url };
}
