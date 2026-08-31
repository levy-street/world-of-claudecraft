// Snap the chase camera behind a teleported player for authored arrivals that
// also set the character's heading: Proving Shore ferry crossings and dungeon
// entries.
//
// A walked frame moves the player a fraction of a yard and the camera yaw is
// the player's own business. The ferry TELEPORT sets the player down facing
// whatever the landing authored, and leaving the camera pointed wherever it
// was makes the landing disorienting: the Proving Shore arrival deliberately
// faces Warden Tam's Gauntlet gate, and a stale yaw would have a brand-new
// player staring at open sea. Snapping the yaw to the landed facing shows
// them exactly what the landing meant them to see.
//
// The dungeon entry arm is deliberate: enterDungeon resets facing to 0, but a
// stale camera yaw in Mouse Camera mode is streamed back as authoritative
// facing on the next input frame. Snapping before input is sampled keeps the
// client aligned with the shared sim entry heading. Dungeon exits, portals,
// hearthstones, and graveyard releases still preserve camera yaw.
//
// The teleport test reuses zone_transition.ts's displacement classifier: the
// same per-frame threshold that decides a blocking loading screen decides a
// camera snap, so the two can never disagree about what a teleport is.
//
// Pure and host-agnostic: the caller (main.ts's frame loop, which already
// measures per-frame displacement for zone warmup) applies the returned yaw.

import { isOnProvingShore } from '../sim/content/proving_shore';
import { isDungeonEntryTransition } from '../sim/data';
import { type KeyboardTurnState, newKeyboardTurnState } from './keyboard_turn_facing';
import { TELEPORT_DISPLACEMENT_YD } from './zone_transition';

/** The camera yaw to use this frame: the player's landed facing after a
 *  teleport-scale displacement, the current yaw otherwise. Unscoped core,
 *  exported for focused policy tests. */
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

/** Ferry-only snap policy retained for focused ferry tests. A
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

/** True when a teleport-scale displacement crosses into a different dungeon
 *  definition. This covers overworld doors and internal raid-room gates while
 *  leaving dungeon exits and unrelated teleports alone. */
export function isDungeonEntryTeleport(
  fromX: number,
  toX: number,
  displacementYd: number,
): boolean {
  if (displacementYd <= TELEPORT_DISPLACEMENT_YD) return false;
  return isDungeonEntryTransition(fromX, toX);
}

export type TeleportCameraArrival = 'ferry' | 'dungeon' | null;

export interface TeleportCameraFacingState {
  camYaw: number;
  lastInterpFacing: number | null;
  pendingReleaseFacing: number | null;
  prevCameraDrivenFacing: boolean;
  keyboardTurn: KeyboardTurnState;
}

export interface TeleportCameraFacingUpdate extends TeleportCameraFacingState {
  movementFacing: number;
}

/** Aligns every client-side heading owner before held movement is sampled. */
export function teleportCameraFacingState(
  arrival: Exclude<TeleportCameraArrival, null>,
  landedFacing: number,
  current: TeleportCameraFacingState,
): TeleportCameraFacingUpdate {
  if (arrival === 'ferry') {
    return {
      ...current,
      camYaw: landedFacing,
      keyboardTurn: { ...current.keyboardTurn },
      movementFacing: landedFacing,
    };
  }
  return {
    camYaw: landedFacing,
    lastInterpFacing: landedFacing,
    pendingReleaseFacing: null,
    prevCameraDrivenFacing: false,
    keyboardTurn: newKeyboardTurnState(),
    movementFacing: landedFacing,
  };
}

/** Allocation-free arrival classification for the per-frame main loop. */
export function teleportCameraArrivalKind(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  displacementYd: number,
): TeleportCameraArrival {
  if (isDungeonEntryTeleport(fromX, toX, displacementYd)) return 'dungeon';
  if (isIslandFerryTeleport(fromX, fromZ, toX, toZ, displacementYd)) return 'ferry';
  return null;
}

/** Classifies one completed simulation tick from its before and after poses. */
export function teleportCameraArrivalBetween(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): TeleportCameraArrival {
  return teleportCameraArrivalKind(fromX, fromZ, toX, toZ, Math.hypot(toX - fromX, toZ - fromZ));
}

/** Uses the sim entry generation so same-position and same-room entries count. */
export function teleportCameraArrivalAfterTick(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  beforeEntrySeq: number,
  afterEntrySeq: number,
): TeleportCameraArrival {
  return afterEntrySeq !== beforeEntrySeq
    ? 'dungeon'
    : teleportCameraArrivalBetween(fromX, fromZ, toX, toZ);
}
