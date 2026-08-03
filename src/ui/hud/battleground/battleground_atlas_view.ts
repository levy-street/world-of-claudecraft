// Pure, host-agnostic furniture for the M-map's Thornhollow Fields ATLAS PLATE:
// the drawn marks (painted tree crowns, boulder and rubble stipples, graveyard
// headstones) and the landmark label anchors. The plate's per-pixel ground work
// lives in src/ui/bg_field_relief_core.ts; this module is everything the painter
// draws as SHAPES over it, reduced to plain numbers a Vitest can assert on.
//
// Both tables are projections of the authored map (thornhollow_field.generated),
// never invented dressing: a crown stands where a tree really stands, a stipple
// where a boulder or a rubble pile really sits, a headstone row sits on the
// authored graveyard rectangle, and a label sits on the rectangle the map itself
// names. The field is point-symmetric, so both tables come out mirrored and
// survive the 180-degree turn the away team's plate takes.
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

export type BgAtlasMarkKind = 'crown' | 'boulder' | 'headstone';

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

// Headstones. The plate paints the two graveyard plots as their own ground
// surface (bg_field_relief_core's BG_SURFACE_GRAVE), and these are the stipples
// that say what the ground IS: a fixed row-and-column grid inset in the authored
// plot rectangle, so they are deterministic, symmetric with the plots, and
// nothing here invents a position the map does not already declare. The
// fractions are of the plot's own half-extents, so a re-authored plot carries
// its stones with it.
const HEADSTONE_R = 0.8;
const HEADSTONE_COL_FRACS: readonly number[] = [-0.62, 0, 0.62];
const HEADSTONE_ROW_FRACS: readonly number[] = [-0.45, 0.45];

let marks: readonly BgAtlasMark[] | null = null;

/**
 * Every crown, stipple and headstone the plate draws, in the authored placement
 * order (the graveyard stones last).
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
  for (const plot of TH_GRAVEYARDS) {
    for (const rowFrac of HEADSTONE_ROW_FRACS) {
      for (const colFrac of HEADSTONE_COL_FRACS) {
        out.push({
          x: plot.x + colFrac * plot.hw,
          z: plot.z + rowFrac * plot.hd,
          r: HEADSTONE_R,
          kind: 'headstone',
        });
      }
    }
  }
  marks = out;
  return marks;
}

/** The landmarks the plate names. One stable id per label; the painter owns the
 *  t() key it resolves to. */
export type BgAtlasLabelId = 'crimsonKeep' | 'azureKeep' | 'ruinCourtyard' | 'graveyard';

export interface BgAtlasLabel {
  id: BgAtlasLabelId;
  /** Field-local yards of the label's centre. */
  x: number;
  z: number;
  /** REGION names are the three chambers and the two keeps; PLACE names are the
   *  smaller things standing inside one. The painter sizes them apart. */
  tier: 'region' | 'place';
}

// The authored rectangles each region label is read off. Named by the map's own
// LOCATION names, the same way the painter reads its keep rects, so a renamed
// or removed rectangle drops its label instead of drawing it in the wrong place
// (tests/battleground_atlas_view.test.ts pins that every one resolves).
//
// ONE NAME PER TERRITORY. A keep and the chamber in front of it are one place a
// player calls out ("their keep", "up at Azure"), so the plate writes one title
// per end rather than a Keep name and a Field name a few glyph heights apart.
// The anchor is the MIDPOINT of the two rectangles' own anchors: the keep's
// back-of-the-keep anchor and the field chamber's centre, so the merged title
// straddles the pair it names and is still derived entirely from the authored
// rectangles.
const KEEP_TERRITORIES: ReadonlyArray<readonly [string, string, BgAtlasLabelId]> = [
  ['Crimson Keep', 'Crimson Field', 'crimsonKeep'],
  ['Azure Keep', 'Azure Field', 'azureKeep'],
];

// The regions named on their own rectangle's centre.
const CENTRE_REGIONS: ReadonlyArray<readonly [string, BgAtlasLabelId]> = [
  ['The Ruin Courtyard', 'ruinCourtyard'],
];

// A keep's own anchor sits at the BACK of its keep, this far inside the rear
// wall, rather than at the rectangle's centre: the centre is the flag stand, and
// the stand's banner glyph flies UP-SCREEN from it, straight across the middle
// of the rectangle in the AWAY team's view.
const KEEP_LABEL_INSET = 6;

// A graveyard label sits this far field-side of its plot rather than on it: the
// plot is drawn ground now (its own surface family in the relief core, with
// headstone stipples on it), and a name written across the stones would fight
// them for the same few pixels.
const GRAVEYARD_LABEL_GAP = 4;

let labels: readonly BgAtlasLabel[] | null = null;

/** The centre of an authored LOCATION rectangle, or null if the map no longer
 *  declares it under that name. */
function locationCentre(name: string): { x: number; z: number } | null {
  const rect = TH_LOCATIONS.find((l) => l.name === name);
  if (!rect) return null;
  return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
}

/** Every landmark label anchor, in a stable order (regions, then places). */
export function bgAtlasLabels(): readonly BgAtlasLabel[] {
  if (labels) return labels;
  const out: BgAtlasLabel[] = [];
  for (const [keepName, fieldName, id] of KEEP_TERRITORIES) {
    const rect = TH_LOCATIONS.find((l) => l.name === keepName);
    if (!rect) continue;
    const cx = (rect.minX + rect.maxX) / 2;
    const cz = (rect.minZ + rect.maxZ) / 2;
    // The two keeps back onto the field's short edges, so "away from the
    // centre" is the rectangle's far end.
    const keepZ = (cz < 0 ? rect.minZ : rect.maxZ) - Math.sign(cz) * KEEP_LABEL_INSET;
    // Halfway to the chamber this keep owns. A map that dropped the chamber
    // rectangle keeps the title on the keep rather than losing it.
    const field = locationCentre(fieldName);
    out.push({ id, x: cx, z: field ? (keepZ + field.z) / 2 : keepZ, tier: 'region' });
  }
  for (const [name, id] of CENTRE_REGIONS) {
    const centre = locationCentre(name);
    if (!centre) continue;
    out.push({ id, x: centre.x, z: centre.z, tier: 'region' });
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
