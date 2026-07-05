// Pure quest-objective target/location resolution over the static content
// tables, shared by the presentation layers: the world map draws translucent
// "your objective lives here" areas from questObjectiveAreas(), and the mob
// hover tooltip lists the objectives a mob advances via questObjectivesForMob(). A host-agnostic leaf
// like threat.ts / format_money.ts: no DOM, no rng, no Sim state. Everything
// derives from the QUESTS/CAMPS/MOBS/GROUND_OBJECTS/NPCS content plus the
// player's live quest log, so the offline Sim and the online ClientWorld
// mirror produce identical output, and (unlike world.entities) none of it is
// interest-radius limited: a camp far across the zone still resolves.

import { CAMPS, GROUND_OBJECTS, MOBS, NPCS, QUESTS } from './data';
import type { QuestObjective, QuestProgress } from './types';

/** Identity of one quest objective (the map tooltip resolves its localized
 *  label + live counts from this; the pure layers never carry text). */
export interface QuestObjectiveRef {
  questId: string;
  objectiveIndex: number;
}

/** One circular "this objective happens here" area, in world coords. When
 *  several objectives share the exact circle (two quests hunting one camp),
 *  their refs merge onto one area instead of stacking translucent fills. */
export interface QuestObjectiveArea {
  center: { x: number; z: number };
  radius: number;
  objectives: QuestObjectiveRef[];
}

// Padding added around a camp's spawn radius so the drawn area comfortably
// covers mobs that wandered a little off their spawn ring.
const CAMP_AREA_PAD = 4;
// Radius drawn around a lone point target (an interact NPC or single object).
const POINT_AREA_RADIUS = 6;

// The player's active quests' objectives that still need progress. 'ready'
// and 'done' quests contribute nothing (the '?' turn-in marker guides those).
function incompleteObjectives(
  questLog: ReadonlyMap<string, QuestProgress>,
): { questId: string; objectiveIndex: number; obj: QuestObjective }[] {
  const out: { questId: string; objectiveIndex: number; obj: QuestObjective }[] = [];
  for (const qp of questLog.values()) {
    if (qp.state !== 'active') continue;
    const quest = QUESTS[qp.questId];
    if (!quest) continue;
    quest.objectives.forEach((obj, i) => {
      if ((qp.counts[i] ?? 0) < obj.count)
        out.push({ questId: qp.questId, objectiveIndex: i, obj });
    });
  }
  return out;
}

// Mobs whose loot feeds this quest's collect objective. Loot entries are
// tagged with the questId they exist for, the same key quest_credit joins on.
function mobsDroppingQuestItem(itemId: string, questId: string): string[] {
  const out: string[] = [];
  for (const [mobId, def] of Object.entries(MOBS)) {
    if (def.loot.some((l) => l.itemId === itemId && l.questId === questId)) out.push(mobId);
  }
  return out;
}

/** One quest objective a hovered mob advances, with its live counts: the
 *  identity + numbers behind the Questie-style mob-tooltip quest lines. */
export interface MobQuestObjective {
  questId: string;
  objectiveIndex: number;
  current: number;
  total: number;
}

/**
 * The player's active, incomplete objectives this mob's template advances:
 * kill objectives targeting it, plus collect objectives fed by its tagged
 * loot. The mob tooltip renders one quest-title + progress pair per entry,
 * so the player knows "this one counts" (and how far along they are).
 */
export function questObjectivesForMob(
  questLog: ReadonlyMap<string, QuestProgress>,
  mobTemplateId: string,
): MobQuestObjective[] {
  const out: MobQuestObjective[] = [];
  const loot = MOBS[mobTemplateId]?.loot;
  for (const { questId, objectiveIndex, obj } of incompleteObjectives(questLog)) {
    const advances =
      (obj.type === 'kill' && obj.targetMobId === mobTemplateId) ||
      (obj.type === 'collect' &&
        !!obj.itemId &&
        !!loot?.some((l) => l.itemId === obj.itemId && l.questId === questId));
    if (!advances) continue;
    const qp = questLog.get(questId);
    out.push({
      questId,
      objectiveIndex,
      current: Math.min(qp?.counts[objectiveIndex] ?? 0, obj.count),
      total: obj.count,
    });
  }
  return out;
}

/**
 * Circular world areas where the player's active, incomplete objectives are
 * carried out (the classic quest-POI blobs): the camps of kill/collect target
 * mobs, the spread of collect/interact ground objects, and interact NPCs.
 * Deduped by circle so overlapping objectives don't stack translucent fills.
 */
export function questObjectiveAreas(
  questLog: ReadonlyMap<string, QuestProgress>,
): QuestObjectiveArea[] {
  const out: QuestObjectiveArea[] = [];
  const byCircle = new Map<string, QuestObjectiveArea>();
  const push = (ref: QuestObjectiveRef, center: { x: number; z: number }, radius: number): void => {
    const key = `${center.x},${center.z},${radius}`;
    const existing = byCircle.get(key);
    if (existing) {
      // Same circle again: merge the objective identity instead of a second fill.
      if (
        !existing.objectives.some(
          (o) => o.questId === ref.questId && o.objectiveIndex === ref.objectiveIndex,
        )
      )
        existing.objectives.push(ref);
      return;
    }
    const area: QuestObjectiveArea = { center, radius, objectives: [ref] };
    byCircle.set(key, area);
    out.push(area);
  };
  const pushMobCamps = (ref: QuestObjectiveRef, mobId: string): void => {
    for (const camp of CAMPS) {
      // fresh {x,z}: never alias the shared CAMPS content the sim spawns from
      if (camp.mobId === mobId)
        push(ref, { x: camp.center.x, z: camp.center.z }, camp.radius + CAMP_AREA_PAD);
    }
  };
  // One enclosing circle per ground-object definition: centroid of its spawn
  // positions plus the farthest point (a simple bound is plenty at map scale).
  const pushObjectCluster = (ref: QuestObjectiveRef, itemId: string): void => {
    for (const def of GROUND_OBJECTS) {
      if (def.itemId !== itemId || def.positions.length === 0) continue;
      let cx = 0;
      let cz = 0;
      for (const p of def.positions) {
        cx += p.x;
        cz += p.z;
      }
      cx /= def.positions.length;
      cz /= def.positions.length;
      let r = 0;
      for (const p of def.positions) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
      push(ref, { x: cx, z: cz }, Math.max(POINT_AREA_RADIUS, r + CAMP_AREA_PAD));
    }
  };
  for (const { questId, objectiveIndex, obj } of incompleteObjectives(questLog)) {
    const ref: QuestObjectiveRef = { questId, objectiveIndex };
    if (obj.type === 'kill' && obj.targetMobId) pushMobCamps(ref, obj.targetMobId);
    else if (obj.type === 'collect' && obj.itemId) {
      for (const mobId of mobsDroppingQuestItem(obj.itemId, questId)) pushMobCamps(ref, mobId);
      pushObjectCluster(ref, obj.itemId);
    } else if (obj.type === 'interact') {
      if (obj.targetObjectItemId) pushObjectCluster(ref, obj.targetObjectItemId);
      const npc = obj.targetNpcId ? NPCS[obj.targetNpcId] : undefined;
      // fresh {x,z}: never alias the shared NPCS content the sim places from
      if (npc) push(ref, { x: npc.pos.x, z: npc.pos.z }, POINT_AREA_RADIUS);
    }
  }
  return out;
}
