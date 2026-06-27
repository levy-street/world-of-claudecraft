// Resolves a quest objective to map coordinate(s) so the UI can pin it on the
// map (issue #928). Pure data lookup over the content tables — no DOM/render/UI
// imports, so it stays inside the src/sim purity boundary and is unit-testable.
//
// Coordinate sources, by objective type:
//   kill                       -> the target mob's spawn camp center(s) + radius
//   collect (ground object)    -> the GroundObjectDef.positions
//   collect (mob drop)         -> the spawn camp(s) of the mob(s) that drop it
//   interact (ground object)   -> the GroundObjectDef.positions
//   interact (npc)             -> the NPC's position
// When every objective is complete, the quest points at its turn-in NPC.

import { CAMPS, GROUND_OBJECTS, MOBS, NPCS, QUESTS } from '../data';
import type { QuestObjective } from '../types';

/** A point of interest for an objective. `radius > 0` means a roam/search area
 *  (a mob camp); `radius === 0` is an exact spot (NPC or ground object). */
export interface ObjectiveLocation {
  x: number;
  z: number;
  radius: number;
}

const campsForMob = (mobId: string): ObjectiveLocation[] =>
  CAMPS.filter((c) => c.mobId === mobId).map((c) => ({ x: c.center.x, z: c.center.z, radius: c.radius }));

const mobsDroppingItem = (itemId: string): string[] =>
  Object.values(MOBS).filter((m) => (m.loot || []).some((l) => l.itemId === itemId)).map((m) => m.id);

const groundObjectLocations = (itemId: string): ObjectiveLocation[] => {
  const def = GROUND_OBJECTS.find((g) => g.itemId === itemId);
  return def ? def.positions.map((p) => ({ x: p.x, z: p.z, radius: 0 })) : [];
};

/** All known map locations for a single objective, or `null` if none resolve. */
export function resolveObjectiveLocations(o: QuestObjective): ObjectiveLocation[] | null {
  let locs: ObjectiveLocation[] = [];
  if (o.type === 'kill' && o.targetMobId) {
    locs = campsForMob(o.targetMobId);
  } else if (o.type === 'collect') {
    if (o.itemId) {
      locs = groundObjectLocations(o.itemId);
      if (!locs.length) locs = mobsDroppingItem(o.itemId).flatMap(campsForMob);
    }
  } else if (o.type === 'interact') {
    if (o.targetObjectItemId) locs = groundObjectLocations(o.targetObjectItemId);
    if (!locs.length && o.targetNpcId) {
      const npc = NPCS[o.targetNpcId];
      if (npc) locs = [{ x: npc.pos.x, z: npc.pos.z, radius: 0 }];
    }
  }
  return locs.length ? locs : null;
}

/** Map locations to pin for a tracked quest. Skips objectives already complete
 *  (pass per-objective `counts`); once all are done, returns the turn-in NPC. */
export function questObjectiveLocations(questId: string, counts?: readonly number[]): ObjectiveLocation[] {
  const quest = QUESTS[questId];
  if (!quest) return [];
  const out: ObjectiveLocation[] = [];
  let anyIncomplete = false;
  quest.objectives.forEach((o, i) => {
    if (counts && (counts[i] ?? 0) >= o.count) return; // objective done
    anyIncomplete = true;
    const locs = resolveObjectiveLocations(o);
    if (locs) out.push(...locs);
  });
  if (!anyIncomplete) {
    const turnInId = (quest.turnInNpcIds && quest.turnInNpcIds[0]) || quest.turnInNpcId;
    const npc = turnInId ? NPCS[turnInId] : undefined;
    if (npc) out.push({ x: npc.pos.x, z: npc.pos.z, radius: 0 });
  }
  return out;
}
