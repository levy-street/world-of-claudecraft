// Pure, host-agnostic furniture for the M-map's Thornhollow Fields ATLAS PLATE:
// the drawn marks (painted tree crowns, boulder and rubble stipples) and the
// landmark label anchors. The plate's per-pixel ground work lives in
// src/ui/bg_field_relief_core.ts; this module is everything the painter draws
// as SHAPES over it, reduced to plain numbers a Vitest can assert on.
//
// Both tables are projections of the authored map (thornhollow_field.generated),
// never invented dressing: a crown stands where a tree really stands, a stipple
// where a boulder or a rubble pile really sits, and a label sits on the
// rectangle the map itself names. The field is point-symmetric, so both tables
// come out mirrored and survive the 180-degree turn the away team's plate takes.
//
// DOM-free and i18n-free (the battleground pure-core rule): a label carries a
// stable ID, and the painter resolves it to a t() string at plate-build time.

import {
  TH_GRAVEYARDS,
  TH_HALF_X,
  TH_HALF_Z,
  TH_LOCATIONS,
  TH_PLACEMENTS,
} from '../../../sim/thornhollow_field.generated';

export type BgAtlasMarkKind = 'crown' | 'boulder';

export interface BgAtlasMark {
  /** Field-local yards. */
  x: number;
  z: number;
  /** Drawn radius, yards. */
  r: number;
  kind: BgAtlasMarkKind;
}

/** How far OUTSIDE the field rectangle marks are harvested. The plate keeps a
 *  margin around the field for the wooded lip the hollow sits in, and no map
 *  window is wide enough to show more than this many yards of it. Marks that
 *  fall off the plate are simply drawn off-canvas. */
export const BG_ATLAS_MARK_MARGIN = 16;

// Which placements become which mark. Trees are the crowns; loose rock and the
// collapsed masonry are the stipples. Bushes and ferns are deliberately absent:
// the plate runs about 1.7 pixels per yard, where a bush is a third of a pixel
// and four hundred of them would read as dirt on the lens, not as scrub. The
// fbm mottle in the relief core already carries ground texture at that scale.
const CROWN_ASSET = /^foliage\/(?:oak|pine|twisted)/;
const BOULDER_ASSET = /^(?:foliage\/rock|dungeon\/rubble_large)/;

// Drawn size per unit of placement scale, yards. A crown is a canopy seen from
// above (wider than its trunk); a boulder is about its own footprint.
const CROWN_R_PER_SCALE = 1.05;
const BOULDER_R_PER_SCALE = 1.5;

let marks: readonly BgAtlasMark[] | null = null;

/**
 * Every crown and stipple the plate draws, in the authored placement order.
 *
 * Materializes TH_PLACEMENTS, which is a lazy JSON.parse behind a Proxy. That
 * is a one-time cost paid on the first plate build (the plate is cached per
 * size), and the renderer has already paid it in any world that drew the field.
 */
export function bgAtlasMarks(): readonly BgAtlasMark[] {
  if (marks) return marks;
  const out: BgAtlasMark[] = [];
  const maxX = TH_HALF_X + BG_ATLAS_MARK_MARGIN;
  const maxZ = TH_HALF_Z + BG_ATLAS_MARK_MARGIN;
  for (const p of TH_PLACEMENTS) {
    if (Math.abs(p.x) > maxX || Math.abs(p.z) > maxZ) continue;
    if (CROWN_ASSET.test(p.assetId)) {
      out.push({ x: p.x, z: p.z, r: p.scale * CROWN_R_PER_SCALE, kind: 'crown' });
    } else if (BOULDER_ASSET.test(p.assetId)) {
      out.push({ x: p.x, z: p.z, r: p.scale * BOULDER_R_PER_SCALE, kind: 'boulder' });
    }
  }
  marks = out;
  return marks;
}

/** The landmarks the plate names. One stable id per label; the painter owns the
 *  t() key it resolves to. */
export type BgAtlasLabelId =
  | 'crimsonKeep'
  | 'azureKeep'
  | 'crimsonField'
  | 'azureField'
  | 'ruinCourtyard'
  | 'graveyard';

export interface BgAtlasLabel {
  id: BgAtlasLabelId;
  /** Field-local yards of the label's centre. */
  x: number;
  z: number;
  /** REGION names are the three chambers and the two keeps; PLACE names are the
   *  smaller things standing inside one. The painter sizes them apart. */
  tier: 'region' | 'place';
}

// The authored rectangle each region label is read off. Named by the map's own
// LOCATION names, the same way the painter reads its keep rects, so a renamed
// or removed rectangle drops its label instead of drawing it in the wrong place
// (tests/battleground_atlas_view.test.ts pins that all five resolve).
const REGION_BY_NAME: ReadonlyArray<readonly [string, BgAtlasLabelId]> = [
  ['Crimson Keep', 'crimsonKeep'],
  ['Azure Keep', 'azureKeep'],
  ['Crimson Field', 'crimsonField'],
  ['Azure Field', 'azureField'],
  ['The Ruin Courtyard', 'ruinCourtyard'],
];

// A keep label sits at the BACK of its keep, this far inside the rear wall,
// rather than at the rectangle's centre: the centre is the flag stand, and the
// stand's banner glyph flies UP-SCREEN from it, straight across the middle of
// the rectangle in the AWAY team's view.
const KEEP_LABEL_INSET = 6;

// A graveyard label sits this far field-side of its plot rather than on it: the
// plot's dirt and its side tint are painted per redraw OVER the cached plate,
// so a name written inside the rails would be buried on the very next frame.
const GRAVEYARD_LABEL_GAP = 4;

let labels: readonly BgAtlasLabel[] | null = null;

/** Every landmark label anchor, in a stable order (regions, then places). */
export function bgAtlasLabels(): readonly BgAtlasLabel[] {
  if (labels) return labels;
  const out: BgAtlasLabel[] = [];
  for (const [name, id] of REGION_BY_NAME) {
    const rect = TH_LOCATIONS.find((l) => l.name === name);
    if (!rect) continue;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    // The two keeps back onto the field's short edges, so "away from the
    // centre" is the rectangle's far end.
    const keep = id === 'crimsonKeep' || id === 'azureKeep';
    const z = keep ? (cz < 0 ? rect.minZ : rect.maxZ) - Math.sign(cz) * KEEP_LABEL_INSET : cz;
    out.push({ id, x: cx, z, tier: 'region' });
  }
  for (const plot of TH_GRAVEYARDS) {
    // Toward the field centre, which is a point-symmetric rule: the mirrored
    // plot's label mirrors with it.
    const z = plot.z - Math.sign(plot.z) * (plot.hd + GRAVEYARD_LABEL_GAP);
    out.push({ id: 'graveyard', x: plot.x, z, tier: 'place' });
  }
  labels = out;
  return labels;
}
