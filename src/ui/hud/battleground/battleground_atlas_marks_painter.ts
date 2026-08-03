// The DRAWN atlas marks of Thornhollow Fields (painted tree crowns, boulder and
// rubble stipples, graveyard headstones), shared by BOTH battleground map
// backgrounds: the M-key field plan (battleground_map_painter.ts) and the cached
// minimap raster (src/ui/minimap_painter.ts). This is the drawn half of what
// src/ui/bg_field_relief_core.ts is the per-pixel half of, and it exists for the
// same reason: two surfaces describing one field must not drift, so there is ONE
// implementation of the mark read and ONE palette behind it.
//
// WHERE THE NUMBERS COME FROM. The mark positions are the pure core's
// (battleground_atlas_view.bgAtlasMarks), a projection of the authored map: a
// crown stands where a tree really stands, a stipple where a boulder or a rubble
// pile really sits, a headstone on the authored graveyard rectangle. This module
// owns only HOW one is painted: map_terrain.ts's hand-drawn crown read, a blob
// plus a lit face toward the northwest, so every mark on either surface is lit
// from the same corner the relief core's hillshade is.
//
// The palette is hardcoded on the documented map_terrain.ts precedent, with the
// extra reason the plate palettes carry: these are painted into a CACHED raster,
// over and around raw RGBA bytes a pure core wrote, where a CSS var is not
// readable at all, and the raster outlives any theme change that could follow.
// Everything a player reads as INTERFACE (team hues, the self arrow, the marker
// set) stays a resolved token in the calling painter.

import type { BgAtlasMark, BgAtlasMarkKind } from './battleground_atlas_view';
import { bgAtlasMarks } from './battleground_atlas_view';

// Green for the trees, grey for rock and rubble; headstones read as paler,
// colder stone than the field's boulders, so a plot stipples differently from a
// rock field at the same mark size.
const CROWN_FILL = '#4a5f38';
const CROWN_LIT = '#71894f';
const BOULDER_FILL = '#8e8b82';
const BOULDER_LIT = '#b3b0a6';
const HEADSTONE_FILL = '#9aa0a4';
const HEADSTONE_LIT = '#c3c8ca';

const MARK_PAINT: Record<BgAtlasMarkKind, readonly [fill: string, lit: string]> = {
  crown: [CROWN_FILL, CROWN_LIT],
  boulder: [BOULDER_FILL, BOULDER_LIT],
  headstone: [HEADSTONE_FILL, HEADSTONE_LIT],
};

// Draw order, not authoring order: the canopy goes down first, then the rock
// standing on the ground it shades, then the graveyard stones, which are the
// smallest marks and must not be buried by either.
const MARK_DRAW_ORDER: readonly BgAtlasMarkKind[] = ['crown', 'boulder', 'headstone'];

// The light is northwest on both surfaces, so a mark's lit face sits up-left of
// the blob it belongs to.
const LIT_OFFSET = 0.24; // fraction of a mark's radius, toward the light
const LIT_RADIUS = 0.66; // fraction of a mark's radius
const MARK_MIN_R_PX = 0.7; // below this a mark is grit, not a drawn thing
const FULL_CIRCLE = Math.PI * 2;

/** Field-local yards to raster pixels, in the surface's own projection. */
export interface BgMarkProjection {
  /** Field-local x (yards) to a raster column. */
  fx: (x: number) => number;
  /** Field-local z (yards) to a raster row. */
  fy: (z: number) => number;
  /** Pixels per yard, which is what sizes a mark. */
  s: number;
}

/** One painted atlas mark: a blob in `fill` with a lit face toward the
 *  northwest, the hand-drawn crown read map_terrain paints per pixel. */
function drawMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fill: string,
  lit: string,
): void {
  if (r < MARK_MIN_R_PX) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.arc(cx - r * LIT_OFFSET, cy - r * LIT_OFFSET, r * LIT_RADIUS, 0, FULL_CIRCLE);
  ctx.fill();
}

/**
 * Paint the field's atlas marks into `ctx` under the given projection, in the
 * fixed kind order above.
 *
 * `accept` selects which marks this pass draws, which is what lets the M-map
 * plate lay the crowns standing OUTSIDE the ramparts under its field slab and
 * everything else over it, from one implementation. Marks that project off the
 * raster are simply drawn off-canvas; the caller owns its own clipping.
 */
export function drawBgAtlasMarks(
  ctx: CanvasRenderingContext2D,
  proj: BgMarkProjection,
  accept?: (mark: BgAtlasMark) => boolean,
): void {
  const marks = bgAtlasMarks();
  for (const kind of MARK_DRAW_ORDER) {
    const [fill, lit] = MARK_PAINT[kind];
    for (const mark of marks) {
      if (mark.kind !== kind) continue;
      if (accept && !accept(mark)) continue;
      drawMark(ctx, proj.fx(mark.x), proj.fy(mark.z), mark.r * proj.s, fill, lit);
    }
  }
}
