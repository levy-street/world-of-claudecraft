// The harbor route marker's pure decisions (the painter is
// harbor_route_markers.ts): which named parts of the one shared model a
// graphics tier keeps, the shape of the destination plate the painter draws
// the name on, and the plate canvas the name is painted into (its size per
// memory profile and every paint metric in canvas pixels). Three-, DOM- and
// i18n-free.
//
// Fairness (docs/design/graphics-settings-fairness.md): the sign's whole
// message is "a ship stops here, it goes THERE, board THAT way", so the parts
// that carry it (the post, the arrow board with its destination plate, the
// anchor roundel) and the destination name itself are kept on EVERY tier. A
// lower preset sheds only dressing: the metal trim below medium, the lantern,
// its chain and the rope coil below high. The tier is the STATIC effects tier
// (GFX.effectsTier: the preset, lowered by the Advanced Effects-quality
// setting), never the frame-rate governor.

import type { GfxTier } from './gfx';

/** The parts that carry the sign's message: never shed. */
export const HARBOR_ROUTE_MARKER_CRITICAL_PARTS = ['Post', 'SignBoard', 'MaritimeIcon'] as const;
/** Medium and up: iron bands, straps, brackets, bolts, the knee brace. */
export const HARBOR_ROUTE_MARKER_TRIM_PARTS = ['MetalTrim'] as const;
/** High and up: the bracket lantern, its chain, the rope coil. */
export const HARBOR_ROUTE_MARKER_OPTIONAL_PARTS = [
  'OptionalLantern',
  'OptionalChain',
  'OptionalRope',
] as const;

const TIER_RANK: Readonly<Record<GfxTier, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  ultra: 3,
  insane: 4,
};

/** The model's named parts a tier draws (the destination name is drawn on
 *  every tier, see HARBOR_ROUTE_MARKER_TEXT_ON_EVERY_TIER). */
export function harborRouteMarkerParts(tier: GfxTier): readonly string[] {
  const rank = TIER_RANK[tier];
  const parts: string[] = [...HARBOR_ROUTE_MARKER_CRITICAL_PARTS];
  if (rank >= TIER_RANK.medium) parts.push(...HARBOR_ROUTE_MARKER_TRIM_PARTS);
  if (rank >= TIER_RANK.high) parts.push(...HARBOR_ROUTE_MARKER_OPTIONAL_PARTS);
  return parts;
}

/** The destination name has no tier switch at all: this documents that for
 *  the fairness pin (the painter draws both faces unconditionally). */
export const HARBOR_ROUTE_MARKER_TEXT_ON_EVERY_TIER = true;

/** The destination plate's size (the model's DestinationTextAnchor extras). */
export interface HarborRouteMarkerPlate {
  /** The painted panel, yards. */
  width: number;
  height: number;
  /** The panel's clipped corners, yards. */
  corner: number;
  /** Each text plane stands this far off the board's centre plane. */
  faceOffset: number;
  /** The share of the plate the lettering may fill. */
  textWidth: number;
  textHeight: number;
}

/**
 * The plate outline as a triangle fan around its centre, in the anchor's
 * frame (x along the board, y up), with the UV of every point. The painter
 * builds one plane per face from it; the clipped corners match the model's
 * painted panel so the plate covers it exactly.
 */
export function harborRouteMarkerPlateFan(plate: HarborRouteMarkerPlate): {
  positions: number[];
  uvs: number[];
  indices: number[];
} {
  const hw = plate.width / 2;
  const hh = plate.height / 2;
  const c = Math.min(plate.corner, hw, hh);
  const outline: [number, number][] = [
    [-hw + c, -hh],
    [hw - c, -hh],
    [hw, -hh + c],
    [hw, hh - c],
    [hw - c, hh],
    [-hw + c, hh],
    [-hw, hh - c],
    [-hw, -hh + c],
  ];
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  for (const [x, y] of outline) {
    positions.push(x, y, 0);
    uvs.push((x + hw) / plate.width, (y + hh) / plate.height);
  }
  const indices: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    indices.push(0, 1 + i, 1 + ((i + 1) % outline.length));
  }
  return { positions, uvs, indices };
}

/**
 * The two text planes on a marker: the front face (+z) and the back face
 * (-z, turned half a turn about y so its lettering reads left to right from
 * behind). Neither is ever mirrored (no negative scale): whichever side a
 * player stands on, the name reads the right way round.
 */
export function harborRouteMarkerTextFaces(
  plate: HarborRouteMarkerPlate,
): readonly { z: number; yaw: number }[] {
  return [
    { z: plate.faceOffset, yaw: 0 },
    { z: -plate.faceOffset, yaw: Math.PI },
  ];
}

// ---------------------------------------------------------------------------
// The plate canvas per memory profile
// ---------------------------------------------------------------------------
//
// Every world entry paints one canvas per destination and uploads it with a
// full mip chain; on iOS WebKit that backing store and texture count against
// the WebContent process ceiling that kills the page. On a phone, at the iOS
// profile's capped pixel ratio, a plate spans fewer render pixels than the
// half-size canvas has at every ordinary reading distance (it passes 512 only
// with the camera about 2 yd from the board), so the full-size top level buys
// nothing there; a large iPad passes it inside about 5 yd, where the name is
// magnified and softer, never smaller. So the iOS memory profile (every iOS
// WebKit host, the tight rung included) paints at half each side, a quarter
// of the texels. The profile is static for a page (it follows the platform),
// so a plate never changes size once painted.
//
// Fairness: the destination name is what a player reads to pick a ferry, so
// it is painted on every profile and every tier; the half-size canvas keeps
// the aspect and scales every metric below with it, so the lettering fills the
// same share of the plate and a long localized name shrinks exactly as far.

/** The plate canvas: wide like the painted panel (about 3 to 1). */
export interface HarborRouteMarkerPlateCanvasSize {
  readonly width: number;
  readonly height: number;
}

/** Full size, every profile outside the iOS memory profile. */
export const HARBOR_ROUTE_MARKER_PLATE_CANVAS: HarborRouteMarkerPlateCanvasSize = Object.freeze({
  width: 1024,
  height: 340,
});

/** The iOS memory profile: half each side, same aspect. */
export const HARBOR_ROUTE_MARKER_PLATE_CANVAS_IOS: HarborRouteMarkerPlateCanvasSize = Object.freeze(
  { width: 512, height: 170 },
);

/** The profile flag the canvas size reads (a slice of GfxSettings). */
export interface HarborRouteMarkerPlateMemoryProfile {
  readonly iosMemoryProfile: boolean;
}

export function harborRouteMarkerPlateCanvasSize(
  profile: HarborRouteMarkerPlateMemoryProfile,
): HarborRouteMarkerPlateCanvasSize {
  return profile.iosMemoryProfile
    ? HARBOR_ROUTE_MARKER_PLATE_CANVAS_IOS
    : HARBOR_ROUTE_MARKER_PLATE_CANVAS;
}

/** The painter's absolute metrics, canvas pixels. */
export interface HarborRouteMarkerPlatePaint {
  /** The sign-writer's keyline inside the edge: stroke width and inset. */
  readonly keylineWidth: number;
  readonly keylineInset: number;
  /** The pale lift under the ink, offset right and down. */
  readonly liftX: number;
  readonly liftY: number;
  /** The fit loop stops above this font size, stepping down by the step. */
  readonly minFontPx: number;
  readonly fontStepPx: number;
}

/** The metrics as authored on the full-size canvas. */
const FULL_SIZE_PAINT: HarborRouteMarkerPlatePaint = Object.freeze({
  keylineWidth: 6,
  keylineInset: 22,
  liftX: 2,
  liftY: 3,
  minFontPx: 28,
  fontStepPx: 4,
});

/** The paint metrics for a canvas this tall: the full-size metrics scaled by
 *  its height against the full-size canvas (exactly the authored numbers on
 *  the full-size canvas). */
export function harborRouteMarkerPlatePaint(canvasHeight: number): HarborRouteMarkerPlatePaint {
  const k = canvasHeight / HARBOR_ROUTE_MARKER_PLATE_CANVAS.height;
  return {
    keylineWidth: FULL_SIZE_PAINT.keylineWidth * k,
    keylineInset: FULL_SIZE_PAINT.keylineInset * k,
    liftX: FULL_SIZE_PAINT.liftX * k,
    liftY: FULL_SIZE_PAINT.liftY * k,
    minFontPx: FULL_SIZE_PAINT.minFontPx * k,
    fontStepPx: FULL_SIZE_PAINT.fontStepPx * k,
  };
}

/**
 * The lettering size: from `startPx`, step down until `fits` accepts a size,
 * never stepping to a size at or below the floor. When nothing fits, the last
 * size tried is kept and the painter's fillText maxWidth squeezes the name,
 * so it is never clipped. `fits` is called once per size tried, largest first.
 */
export function harborRouteMarkerPlateFontPx(
  startPx: number,
  paint: HarborRouteMarkerPlatePaint,
  fits: (px: number) => boolean,
): number {
  let size = startPx;
  for (;;) {
    if (fits(size)) return size;
    const next = size - paint.fontStepPx;
    if (next <= paint.minFontPx) return size;
    size = next;
  }
}
