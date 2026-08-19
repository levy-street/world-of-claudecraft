import { dist2d, INTERACT_RANGE, type Vec3 } from '../sim/types';
import type { FarmPatchDef, FarmPlotView } from '../world_api/farming';

/** The world slice the bed press needs (Phase 9b): static bed content plus
 *  the caller's own plots. `NearbyInteractionWorld` (and `IWorld` behind it)
 *  satisfies this structurally. Pure module: no DOM, no Three, no HUD. */
export interface FarmBedInteractWorld {
  farmPatches: readonly FarmPatchDef[];
  myFarmPlots: readonly FarmPlotView[];
}

/** Nearest garden bed within reach of the player, by 2D distance, or null.
 *  The boundary is INCLUSIVE (`<= INTERACT_RANGE`) to mirror the sim's own
 *  deny, `distToBed(p.pos, bed) > INTERACT_RANGE`, so the client never
 *  refuses a press the sim would accept. Ties go to the first bed in
 *  content order (the strict `<` on best keeps the earlier bed); beds sit
 *  on a 5 yard pitch, so reach never covers two in practice. */
export function nearestInteractableBed(
  farmPatches: readonly FarmPatchDef[],
  playerPos: Vec3,
): string | null {
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const patch of farmPatches) {
    for (const bed of patch.beds) {
      const distance = dist2d(playerPos, { x: bed.x, y: playerPos.y, z: bed.z });
      if (distance <= INTERACT_RANGE && distance < bestDistance) {
        bestId = bed.id;
        bestDistance = distance;
      }
    }
  }
  return bestId;
}

/** What the press does at a bed: 'harvest' when the caller has a plot there
 *  (ANY status: the sim's own farmDenied not_ready answers a growing plot,
 *  so the client never reads plot.status), else 'plant' (open the sheet). */
export function decideFarmBedAction(
  world: FarmBedInteractWorld,
  bedId: string,
): 'harvest' | 'plant' {
  return world.myFarmPlots.some((plot) => plot.bedId === bedId) ? 'harvest' : 'plant';
}
