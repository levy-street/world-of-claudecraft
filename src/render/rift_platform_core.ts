// Pure planner for the rift raised "sanctum" tier (the staircase + rear deck a
// RiftPlatform describes). Extracted from dungeon.ts (monolith ratchet), which
// is the thin Three consumer. Deterministic and DOM/Three-free so the geometry
// contract unit-tests headless.
//
// The contract: the sim lifts a walker by riftPlatformLift(localZ) across the
// WHOLE room width, so every slab must reach the wall face at its own z. The
// previous builder hard-capped the half-width (22) below the widths boss rooms
// generate (wMax up to 37, +2 for a polygon shell), so a wide sanctum left a
// bare strip on each side where players floated over the lower floor. Slabs
// now read their half-width from the room shell: the polygon outline where one
// exists (sliced in z so a tapering room is followed), else the rectangular
// wallX, inset just enough to tuck under the wall face.

import { polygonXAtZ } from '../sim/geometry2d';
import type { RiftPlatform } from '../sim/rift/types';

/** The shell facts the planner reads off a DungeonLayout (structural subset). */
export interface RiftPlatformShell {
  zMax: number;
  wallX?: number;
  shellPolygon?: ReadonlyArray<{ x: number; z: number }>;
}

/** One axis-aligned slab: centred at (0, top/2, z), spanning |x| <= halfW,
 *  from the floor up to `top`, `depth` deep in z. */
export interface RiftPlatformSlab {
  z: number;
  depth: number;
  halfW: number;
  top: number;
}

/** How far inside the wall face a slab ends (tucks under the wall panel). */
export const RIFT_PLATFORM_WALL_INSET = 0.5;
/** Fallback rectangular half-width when the layout carries neither shell. */
const DEFAULT_WALL_X = 18;
/** Deck slice depth (yd): the rear deck is banded so a polygon shell that
 *  narrows toward the dais is followed, not straddled by one wide box. */
const DECK_SLICE = 2.5;
/** Stair tread target (yd); step count is clamped so a short steep sanctum and a
 *  long gentle climb both read as proper stairs, not a few giant blocks. */
const TREAD = 2.2;

/** Half-width available to a slab spanning [z0, z1]: the WIDEST wall crossing
 *  over that band (both ends and the midpoint), less the inset. Widest, not
 *  narrowest: the sim lifts a walker across the whole width, so a slab that
 *  stops short of the wall anywhere in its band leaves a floating strip, while
 *  one that reaches the band's widest point merely tucks under the wall panel
 *  where the shell is narrower. Never wider than the rectangular wallX, so a
 *  polygon that bulges past its bounding wall cannot push a slab out. */
export function riftPlatformHalfWidthAt(shell: RiftPlatformShell, z0: number, z1: number): number {
  const wallX = shell.wallX ?? DEFAULT_WALL_X;
  let w = wallX;
  const poly = shell.shellPolygon;
  if (poly && poly.length >= 3) {
    let widest: number | null = null;
    for (const z of [z0, (z0 + z1) / 2, z1]) {
      const x = polygonXAtZ(poly, z, 1);
      if (x !== null && (widest === null || x > widest)) widest = x;
    }
    if (widest !== null && widest < w) w = widest;
  }
  return Math.max(1, w - RIFT_PLATFORM_WALL_INSET);
}

/** Merge runs of adjacent deck slices that share a half-width into one slab, so a
 *  rectangular room's rear deck stays the single box it always was and only a
 *  shell that actually changes width pays for extra bands. */
function coalesce(slabs: RiftPlatformSlab[]): RiftPlatformSlab[] {
  const out: RiftPlatformSlab[] = [];
  for (const s of slabs) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.top - s.top) < 1e-6 && Math.abs(prev.halfW - s.halfW) < 1e-6) {
      const z0 = Math.min(prev.z - prev.depth / 2, s.z - s.depth / 2);
      const z1 = Math.max(prev.z + prev.depth / 2, s.z + s.depth / 2);
      prev.z = (z0 + z1) / 2;
      prev.depth = z1 - z0;
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/** Plan the staircase (rampZ0..rampZ1, tops approximating the linear sim lift at
 *  each step's centre) followed by the rear deck (rampZ1..zMax) at `height`.
 *  Same-width deck slices are coalesced (see `coalesce`). */
export function riftPlatformSlabs(
  shell: RiftPlatformShell,
  platform: RiftPlatform,
): RiftPlatformSlab[] {
  const { rampZ0, rampZ1, height } = platform;
  const out: RiftPlatformSlab[] = [];
  const rampLen = rampZ1 - rampZ0;
  const steps = Math.max(5, Math.min(20, Math.round(rampLen / TREAD)));
  const stepDepth = rampLen / steps;
  for (let i = 0; i < steps; i++) {
    const z0 = rampZ0 + i * stepDepth;
    const z1 = z0 + stepDepth;
    out.push({
      z: z0 + stepDepth / 2,
      depth: stepDepth + 0.05,
      halfW: riftPlatformHalfWidthAt(shell, z0, z1),
      top: (height * (i + 1)) / steps,
    });
  }
  const deckDepth = Math.max(2, shell.zMax - rampZ1);
  const slices = Math.max(1, Math.ceil(deckDepth / DECK_SLICE));
  const sliceDepth = deckDepth / slices;
  const deck: RiftPlatformSlab[] = [];
  for (let i = 0; i < slices; i++) {
    const z0 = rampZ1 + i * sliceDepth;
    const z1 = z0 + sliceDepth;
    deck.push({
      z: z0 + sliceDepth / 2,
      depth: sliceDepth + 0.05,
      halfW: riftPlatformHalfWidthAt(shell, z0, z1),
      top: height,
    });
  }
  return out.concat(coalesce(deck));
}
