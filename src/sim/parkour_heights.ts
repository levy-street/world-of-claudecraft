// Parkour heights: the movement-blocking tops, the mantle band, standable
// support, the measured roof tops, and the pass-over gate every mover reads.
// A leaf extracted out of colliders.ts (which re-exports the public names,
// so existing './colliders' importers stand). Sim layer: no three.js imports.

import { type Collider, colliderTopAt } from './collider_shapes';
import { traversalBand } from './traversal_band';

/**
 * How far above a mover's feet a STANDABLE top may still sit and be treated as
 * passable while airborne: the mantle assist. A jump whose apex falls short of
 * a crate rim by up to this much still carries the body over, and the support
 * snap in the movement kernel then seats the feet on the top (the vault).
 *
 * It is pinned to the grounded stride band (`MAX_STEP_HEIGHT` in
 * `physics/character.ts`; the equality is pinned by
 * `tests/physics_character.test.ts`) rather than tuned on its own, for two
 * reasons. An airborne body must never lose ground a grounded stride crosses
 * for free, and this ONE number is read by BOTH halves of the tick: the
 * horizontal gates (`passesOver` here, `blocksAt` in the solver) and the
 * vertical support query (`floorHeightAt`'s `maxY` in `player_motion.ts`).
 * They must move together, or the horizontal pass admits a top the landing
 * snap then refuses to seat and the body tunnels into the prop. It also
 * leaves the traversal ladder gapless: `LEDGE_GRAB_MIN` is the same value, so
 * every standable top is either vaulted or grabbed, never a mid-air wall.
 * The literal lives here (not imported) because `physics/` imports this
 * module, never the reverse.
 *
 * This constant is the built-in world's value. Movement reads the band for the
 * ACTIVE content through traversal_band.ts (an authored map gets the Studio's
 * 1.0), so all three still move together.
 */
export const MANTLE_REACH = 0.9;
/** Float slack when comparing feet height against a collider top. */
export const MOVE_TOP_EPS = 1e-3;
// How much of the body radius must overlap a standable top before it supports
// the mover: standing needs the center meaningfully over the prop, while the
// full collision radius still gates entry, so a jump can graze past a rim
// without being captured by it.
export const SUPPORT_OVERLAP = 0.5;
// Physical movement tops (yards above the prop's ground). The visual/sight
// tops above stay untouched: cameraTopY for a campfire includes the flame,
// but the SOLID obstacle is only the log pile, which is what a jump clears.
// Exported so tests pin against the one authoritative value.
export const CAMPFIRE_MOVE_TOP = 0.55;
// Standable roofs, all MEASURED from the shipped GLBs at the scales the
// renderer places them (dequantized bounds; see docs/design/physics-asset-audit.md).
// The tops are SHAPED: gables falling from a ridge line to real eaves, so
// feet track the pitched surface the eye sees.
// Market stand (market_stand_1/2 scaled to 3.1 x 2.6 x 2.5, group sunk 0.06):
// a 3.1 x 2.5 BOX whose steep awning ridges along the stall's local x axis,
// falling from 2.54 at the ridge to 1.50 at the front/back edges. The eave is
// vault height (jump on at the edge), the ridge climb height.
export const STALL_HALF_W = 1.55;
export const STALL_HALF_D = 1.25;
export const STALL_CANOPY_TOP = 2.54;
export const STALL_CANOPY_EAVE = 1.5;
// Dock hut / chapel hall use house_3, whose roof ridges along the model's
// local z (the OBB depth) and whose eaves sit at 60 percent of the height:
// walls to ~1.57, then the big pitched roof. The hut is scaled to 2.6 tall.
export const DOCK_HUT_ROOF_TOP = 2.6;
export const DOCK_HUT_ROOF_EAVE = 1.57;

/** The mover's feet altitude plus how much standable lift it gets (the
 * airborne mantle assist). Both hosts derive it from the SAME entity fields so
 * the server sim and the client self extrapolator gate colliders identically. */
export interface MoverHeight {
  y: number;
  lift: number;
}

export function moverHeight(e: { pos: { y: number }; onGround: boolean }): MoverHeight {
  return { y: e.pos.y, lift: e.onGround ? 0 : traversalBand() };
}

/** Head clearance a mover with height needs to walk beneath an elevated slab
 *  (`passUnderY`): a touch above the tallest body so a deck one yard overhead
 *  still walls, while a real balcony admits the walk below. */
const PASS_UNDER_HEADROOM = 2.1;

// Does the mover pass clean over this collider at (x, z)? Full-height
// colliders (moveTopY undefined) never pass; standable tops grant the mantle
// lift. Sloped tops are sampled at the mover's own point, so the eaves of a
// roof pass a body the ridge would still wall. An elevated slab that carries
// `passUnderY` also passes the mover walking BENEATH it when their head
// clears its underside (the balcony-walk contract); height-less movers never
// reach here, so mobs and pathfinding still see a full-height solid.
export function passesOver(
  c: Collider,
  mover: MoverHeight | undefined,
  x: number,
  z: number,
): boolean {
  if (!mover || c.moveTopY === undefined) return false;
  if (c.passUnderY !== undefined && mover.y + PASS_UNDER_HEADROOM <= c.passUnderY) return true;
  return colliderTopAt(c, x, z) <= mover.y + (c.standable ? mover.lift : 0) + MOVE_TOP_EPS;
}
