import { GLIDER_QUEST_ID } from '../sim/content/world_quest_glider';
import { wispMazeActionsLocked } from '../sim/wisp_maze_action_lock';
import type { IWorld } from '../world_api';
import { diagonalMovementVisualFacing, type MovementVisualInput } from './movement_visual';

/** Countdown and flight both belong to the authoritative flight kernel. */
export function gliderControlsActive(world: Pick<IWorld, 'worldQuestLog'>): boolean {
  const progress = world.worldQuestLog.get(GLIDER_QUEST_ID);
  const phase = progress?.glider?.phase;
  return phase === 'countdown' || phase === 'flying';
}

/** Walking prediction and keyboard yaw integration cannot model these modes. */
export function scriptedMovementActive(world: Pick<IWorld, 'worldQuestLog'>): boolean {
  return gliderControlsActive(world) || wispMazeActionsLocked(world.worldQuestLog);
}

interface GliderInput {
  rightDown: boolean;
  camYaw: number;
  isMouselookActive(): boolean;
  readMoveInput(): import('../sim/types').MoveInput;
  clearClickMove(): void;
}

/** Orbiting or a held movement key never overwrites the flight kernel's yaw. */
export function gliderCameraFacing(
  input: Pick<GliderInput, 'rightDown' | 'camYaw' | 'isMouselookActive'>,
): number | null {
  return input.rightDown && input.isMouselookActive() ? input.camYaw : null;
}

/** Private maze walls and flight cannot use the ordinary click-to-move pathfinder. */
export function resolveGliderMove(world: Pick<IWorld, 'worldQuestLog'>, input: GliderInput) {
  const maze = wispMazeActionsLocked(world.worldQuestLog);
  if (!gliderControlsActive(world) && !maze) return null;
  input.clearClickMove();
  return {
    mi: input.readMoveInput(),
    facing: maze ? (input.isMouselookActive() ? input.camYaw : null) : gliderCameraFacing(input),
  };
}

/** The input callbacks for the activity kernels: a manned cannon pauses camera motion
 *  and glider flight steers by the flight kernel. Both read the world live. */
export function activityInputLocks(
  world: Pick<IWorld, 'worldQuestLog'> & { readonly vehicleSession: unknown },
): { isCameraMotionLocked: () => boolean; isGliderActive: () => boolean } {
  return {
    isCameraMotionLocked: () => world.vehicleSession !== null,
    isGliderActive: () => gliderControlsActive(world),
  };
}

/** The local diagonal visual yaw, withheld while the flight kernel owns facing. */
export function gliderAwareVisualFacing(
  world: Pick<IWorld, 'worldQuestLog'>,
  mi: MovementVisualInput,
  baseFacing: number,
): number | null {
  return gliderControlsActive(world) ? null : diagonalMovementVisualFacing(mi, baseFacing);
}

/** Local movement freezes through a mount race countdown and while a cannon is manned;
 *  the sim enforces both locks independently. */
export function raceOrVehicleMovementLocked(world: {
  mountRaceView(): { phase: string } | null;
  readonly vehicleSession: unknown;
}): boolean {
  return world.mountRaceView()?.phase === 'countdown' || world.vehicleSession !== null;
}
