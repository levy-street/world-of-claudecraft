// Snap the chase camera behind a teleported player, SCOPED to the Proving
// Shore's ferry crossings.
//
// A walked frame moves the player a fraction of a yard and the camera yaw is
// the player's own business. The ferry TELEPORT sets the player down facing
// whatever the landing authored, and leaving the camera pointed wherever it
// was makes the landing disorienting: the Proving Shore arrival deliberately
// faces Warden Tam's Gauntlet gate, and a stale yaw would have a brand-new
// player staring at open sea. Snapping the yaw to the landed facing shows
// them exactly what the landing meant them to see.
//
// The scoping is deliberate (PR #3467 review, finding 6): every OTHER
// teleport in the game (portals, dungeon doors, hearthstone, graveyard
// release) has always kept the player's camera where they left it, and
// re-aiming all of them is a global feel change, not a tutorial one. So the
// snap fires only when the displacement touches the island rectangle on
// either end, which is exactly the two ferry rides. Widening it is its own
// change with its own tests.
//
// The teleport test reuses zone_transition.ts's displacement classifier: the
// same per-frame threshold that decides a blocking loading screen decides a
// camera snap, so the two can never disagree about what a teleport is.
//
// Pure and host-agnostic: the caller (main.ts's frame loop, which already
// measures per-frame displacement for zone warmup) applies the returned yaw.

import { isOnProvingShore } from '../sim/content/proving_shore';
import { TELEPORT_DISPLACEMENT_YD } from './zone_transition';

/** The camera yaw to use this frame: the player's landed facing after a
 *  teleport-scale displacement, the current yaw otherwise. Unscoped core,
 *  exported for tests; live callers go through islandTeleportCameraYaw. */
export function teleportCameraYaw(
  displacementYd: number,
  landedFacing: number,
  currentYaw: number,
): number {
  return displacementYd > TELEPORT_DISPLACEMENT_YD ? landedFacing : currentYaw;
}

/** The one authority for "this frame's displacement is a ferry ride": a
 *  teleport-scale jump that starts or ends on the Proving Shore. The camera
 *  snap and main.ts's always-cover arrival rule both read it, so the two can
 *  never disagree about which jumps are the crossing. */
export function isIslandFerryTeleport(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  displacementYd: number,
): boolean {
  if (displacementYd <= TELEPORT_DISPLACEMENT_YD) return false;
  return isOnProvingShore(fromX, fromZ) || isOnProvingShore(toX, toZ);
}

/** The live entry point: the snap decision plus the ferry scoping. A
 *  displacement that neither starts nor ends on the Proving Shore keeps the
 *  current yaw no matter its size. */
export function islandTeleportCameraYaw(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  displacementYd: number,
  landedFacing: number,
  currentYaw: number,
): number {
  if (!isIslandFerryTeleport(fromX, fromZ, toX, toZ, displacementYd)) return currentYaw;
  return landedFacing;
}
