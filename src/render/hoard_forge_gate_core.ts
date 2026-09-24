// The FORGE GATE: how a door through the Emberforge Tyrant's ring of fire is
// made to read as a door. Pure: no Three.js, no DOM. WHERE a door is comes from
// the shared sim core (src/sim/rift/hoard_forge_hammer_core.ts), so a drawn gate
// is a safe gate; the adapter (hoard_forge_gate.ts) only turns this file's
// numbers into vertices.
//
// A gap that is merely dark reads as a broken circle (playtest). Each gate says
// "cross HERE" three ways that do not lean on colour alone, on every graphics
// tier: a forge POST capping the fire at either edge, a pale-gold STRIP through
// the wall with a threshold joining the posts, and CHEVRONS pointing the way
// through.

import { FORGE_HAMMER, forgeGapAngle } from '../sim/rift/hoard_forge_hammer_core';

export const FORGE_GATE_LOOK = Object.freeze({
  iron: 0x2a2627,
  ironEmissive: 0x3a1a08,
  molten: 0xffa336,
  /** Forge gold, far from the fire's red and orange, dark enough for the chevrons. */
  stripEdge: 0x8a5a16,
  stripCore: 0xd9a441,
  /** White-hot on the gold: shape first, never colour alone. */
  chevron: 0xfffaf0,
  /** The posts are boss-room furniture: read from a raid camera, not a close-up. */
  postScale: 1.4,
  /** A post stands this far INTO the fire from the gap's edge, so it caps the
   *  flames without standing in the safe ground. */
  postInset: 0.75,
  /** VISUAL_SAFETY_MARGIN: the drawn strip stops this short of the true edge, so
   *  what looks safe is never the last inch of what is. */
  safetyMargin: 0.4,
  /** A wide late gap still gets a corridor, never a gold field. */
  stripHalfWidthMax: 3,
  /** The corridor runs from this far inside the ring to this far ahead of it. */
  stripBehind: 1.4,
  stripAhead: 3.0,
  thresholdWidth: 0.45,
  thresholdSegments: 8,
  chevrons: 3,
  chevronSpacing: 1.25,
  /** Ring columns over which the fire climbs toward a post. */
  edgeReach: 4,
  /** How much taller the wall of fire stands right beside a post. */
  edgeLift: 1.1,
});

/** Where the gates stand: on the ring, and at the blow's edge before it exists
 *  (the way through is known during the warning, never found as fire arrives). */
export function forgeGateRadius(ringRadius: number): number {
  return Math.max(FORGE_HAMMER.ringSafeRadius, ringRadius);
}

export interface ForgeGateFrame {
  /** Bearing of the gap's middle (0 faces +z), and its unit radial. */
  middle: number;
  radialX: number;
  radialZ: number;
  /** The two posts' bearings: just outside the gap's true edges. */
  postA: number;
  postB: number;
  /** The true edges, pulled in by the safety margin: the threshold's ends. */
  edgeA: number;
  edgeB: number;
  /** Half the corridor's width in yards. */
  halfWidth: number;
}

export function forgeGateFrame(
  cueId: number,
  gap: number,
  radius: number,
  out: ForgeGateFrame,
): ForgeGateFrame {
  const look = FORGE_GATE_LOOK;
  const middle = forgeGapAngle(cueId, gap);
  const half = FORGE_HAMMER.gapHalfAngle;
  const r = Math.max(1, radius);
  out.middle = middle;
  out.radialX = Math.sin(middle);
  out.radialZ = Math.cos(middle);
  out.postA = middle - half - look.postInset / r;
  out.postB = middle + half + look.postInset / r;
  out.edgeA = middle - half + look.safetyMargin / r;
  out.edgeB = middle + half - look.safetyMargin / r;
  out.halfWidth = Math.max(
    0.6,
    Math.min(look.stripHalfWidthMax, r * Math.sin(half) - look.safetyMargin),
  );
  return out;
}

/** Per ring column, how near a door it burns (1 beside a post, 0 well away): the
 *  fire climbs toward the post that ends it instead of just stopping. */
export function writeRingEdge(mask: Float32Array, out: Float32Array): void {
  const columns = mask.length - 1;
  const reach = FORGE_GATE_LOOK.edgeReach;
  for (let column = 0; column <= columns; column++) {
    let edge = 0;
    if (mask[column] > 0) {
      for (let step = 1; step <= reach; step++) {
        const before = mask[(column - step + columns) % columns];
        const after = mask[(column + step) % columns];
        if (before === 0 || after === 0) {
          edge = 1 - (step - 1) / reach;
          break;
        }
      }
    }
    out[column] = edge;
  }
}

/** Vertices one gate writes: the threshold arc, the corridor's border and core,
 *  and the chevrons (two quads each). */
export const FORGE_GATE_VERTICES =
  (FORGE_GATE_LOOK.thresholdSegments + 1) * 2 + 8 + FORGE_GATE_LOOK.chevrons * 8;
