import { distToBed } from '../sim/professions/farming';
import { INTERACT_RANGE, type Vec3 } from '../sim/types';
import type { FarmPatchDef, FarmPlotView } from '../world_api/farming';

/** The world slice the bed press needs (Phase 9b): static bed content plus
 *  the caller's own plots. `NearbyInteractionWorld` (and `IWorld` behind it)
 *  satisfies this structurally. Pure module: no DOM, no Three, no HUD. */
export interface FarmBedInteractWorld {
  farmPatches: readonly FarmPatchDef[];
  myFarmPlots: readonly FarmPlotView[];
}

/** Nearest garden bed within reach of the player, or null. Measured with the
 *  sim's OWN `distToBed` (farming.ts), not a re-derived walk, so the reach
 *  math can never drift from the deny it mirrors. The boundary is INCLUSIVE
 *  (`<= INTERACT_RANGE`) to mirror the sim's own deny,
 *  `distToBed(p.pos, bed) > INTERACT_RANGE`, so the client never refuses a
 *  press the sim would accept. Ties go to the first bed in content order (the
 *  strict `<` on best keeps the earlier bed); beds sit on a 5 yard pitch, so
 *  reach never covers two in practice. */
export function nearestInteractableBed(
  farmPatches: readonly FarmPatchDef[],
  playerPos: Vec3,
): string | null {
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const patch of farmPatches) {
    for (const bed of patch.beds) {
      const distance = distToBed(playerPos, bed);
      if (distance <= INTERACT_RANGE && distance < bestDistance) {
        bestId = bed.id;
        bestDistance = distance;
      }
    }
  }
  return bestId;
}

/** Which MODE the bed window opens in for this bed, and which sentence the
 *  press affordance states: 'harvest' when the caller has a plot there (ANY
 *  status; the window shows the status and its Harvest control is the only
 *  harvestCrop send), else 'plant'. The generic press itself only OPENS the
 *  window either way (intentional gathering PR1); it never harvests. */
export function decideFarmBedAction(
  world: FarmBedInteractWorld,
  bedId: string,
): 'harvest' | 'plant' {
  return world.myFarmPlots.some((plot) => plot.bedId === bedId) ? 'harvest' : 'plant';
}
