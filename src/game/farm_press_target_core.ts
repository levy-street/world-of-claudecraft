// Which of the two FARMING interact targets a press takes when both are in
// reach: the placed feast, or the garden bed under it. Previously nothing on
// screen said whether a press would hit the feast or the bed, so a player who
// walked to their bed and found a feast dropped on top of it ate instead of
// harvesting, with no way to predict it.
//
// THE CLAIM IS COMPARATIVE, AND DELIBERATELY SO. This module says the feast
// takes the press BEFORE the bed. It does NOT say the press hits the feast,
// because tryNearbyInteraction (nearby_interaction.ts) ranks corpses, delve
// objects, lootable objects, npcs and escorts ABOVE both farming
// arms, so an absolute claim would be false whenever any of those is also in
// reach. The comparative claim is true under ruling 11b-R3c-1 whatever else is
// standing there, because that ruling orders exactly this pair. Do not
// "improve" the copy this feeds into an absolute "your press does X": making
// that honest needs a decide/dispatch split of tryNearbyInteraction (one pass
// that RESOLVES the winning arm, a second that dispatches it) so the affordance
// and the press read the same answer, which is the follow-up this module is
// scoped under, not a wording change.
//
// It composes the two shipped resolvers rather than re-deriving either: a
// second copy of the reach math is how the client starts refusing presses the
// sim would accept. Pure module (no DOM, no Three, no HUD) and ALLOCATION-FREE:
// it returns a string union, which doubles as the consumer's repaint signature.
// It lives here beside feast_interact.ts and farm_bed_interact.ts rather than
// under src/ui so the decide/dispatch follow-up above can consume it from
// nearby_interaction.ts without a game -> ui import.

import type { Entity, Vec3 } from '../sim/types';
import type { FarmPatchDef, FarmPlotView } from '../world_api/farming';
import { decideFarmBedAction, nearestInteractableBed } from './farm_bed_interact';
import { nearestInteractableFeast } from './feast_interact';

/** The world slice the resolution needs: the entity roster the feast scan
 *  walks, plus the static bed content and the caller's own plots the bed scan
 *  and its harvest/plant decision read. `NearbyInteractionWorld` (and `IWorld`
 *  behind it) satisfies this structurally, so the live call site passes the
 *  world whole. */
export interface FarmPressTargetWorld {
  entities: ReadonlyMap<number, Entity>;
  farmPatches: readonly FarmPatchDef[];
  myFarmPlots: readonly FarmPlotView[];
}

/** The ambiguity, named by what the bed press GIVES UP: a feast in reach beats
 *  a bed the caller has a plot in ('feast_over_harvest': the press would have
 *  opened the bed window in harvest mode, never harvested by itself) or a free
 *  bed ('feast_over_plant': the plant sheet). One value per distinct sentence,
 *  so the consumer maps it straight to a key and diffs it as a repaint
 *  signature. */
export type FarmPressTarget = 'feast_over_harvest' | 'feast_over_plant';

/** The resolved farming press ambiguity, or null when there is none: no bed in
 *  reach, no feast in reach, or a dead player (the dispatcher gates BOTH
 *  farming arms on `!player.dead`, so a ghost standing in a garden has no
 *  ambiguity to report).
 *
 *  The BED is resolved first on purpose. Both scans are needed for a non-null
 *  answer, so the order cannot change the result, but the bed walk covers a
 *  short static content list while the feast walk covers the whole
 *  interest-scoped entity roster: checking the bed first skips that roster
 *  entirely everywhere in the world that has no garden bed, which is almost
 *  everywhere. */
export function farmPressTarget(
  world: FarmPressTargetWorld,
  playerPos: Vec3,
  playerDead: boolean,
): FarmPressTarget | null {
  if (playerDead) return null;
  const bedId = nearestInteractableBed(world.farmPatches, playerPos);
  if (bedId === null) return null;
  if (nearestInteractableFeast(world.entities, playerPos) === null) return null;
  return decideFarmBedAction(world, bedId) === 'harvest'
    ? 'feast_over_harvest'
    : 'feast_over_plant';
}
