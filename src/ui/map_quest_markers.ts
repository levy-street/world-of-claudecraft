// Map markers for the player's tracked quest (issue #928). Thin host-agnostic
// wrapper over the sim resolver: returns the objective location(s) that fall in
// the currently-shown zone band, ready for the HUD to draw as pins / search
// circles. Pure data — the HUD owns the canvas drawing.
import { questObjectiveLocations, type ObjectiveLocation } from '../sim/quests/quest_objective_locator';

export type QuestMapMarker = ObjectiveLocation;

export function trackedQuestMapMarkers(
  questId: string | null,
  counts: readonly number[] | undefined,
  zMin: number,
  zMax: number,
): QuestMapMarker[] {
  if (!questId) return [];
  return questObjectiveLocations(questId, counts).filter((m) => m.z >= zMin && m.z < zMax);
}
