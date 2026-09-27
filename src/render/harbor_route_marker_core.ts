// The harbor route marker's pure decisions (the painter is
// harbor_route_markers.ts): which named parts of the one shared model a
// graphics tier keeps, and the shape of the destination plate the painter
// draws the name on. Three-, DOM- and i18n-free.
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
