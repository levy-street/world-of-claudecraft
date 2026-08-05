// Goal-driven auto-quest policy for the Idle Classic engine.
//
// The character now:
// 1. Navigates TO quest givers to accept available quests
// 2. Navigates TO quest objectives (kill mobs, collect items, interact)
// 3. Navigates BACK to turn-in NPCs to complete quests
//
// Priority: turn-in > objectives > accept > idle (combat takes over).
//
// Deterministic: no Math.random, no wall clock — reads only sim state.

import { QUESTS } from '../src/sim/data';
import { questObjectiveAreas } from '../src/sim/quest_targets';
import type { Sim } from '../src/sim/sim';
import type { QuestDef } from '../src/sim/types';
import { dist2d, type Entity, INTERACT_RANGE, type SimEvent, type Vec3 } from '../src/sim/types';
import { steerToward } from './movement';

const NOOP = 0;

export interface QuestStepResult {
  readonly action: number;
  readonly didQuestAction: boolean;
  readonly log: string[];
  readonly blocked: boolean;
  /**
   * World-space goal the quest layer is navigating the character toward this
   * step (the NPC it must reach/turn to), or null when the quest action is a
   * stationary one (interact in place, or no quest activity). The IdleEngine
   * drives movement PER TICK toward this goal because the once-per-step
   * action surface cannot steer (a held TURN rotates PI rad/step and never
   * converges). Mutually exclusive with didQuestAction == true.
   */
  readonly goalPos: Vec3 | null;
}

// ---------------------------------------------------------------------------
// Entity resolution helpers
// ---------------------------------------------------------------------------

/** Find a live NPC entity by template id. */
function findNpcEntity(sim: Sim, templateId: string): Entity | null {
  for (const e of sim.entities.values()) {
    if (e.kind !== 'npc' || e.dead) continue;
    if (e.templateId === templateId) return e;
  }
  return null;
}

/** Find the nearest live mob by template id. */
function findNearestMob(sim: Sim, templateId: string, fromPos: Vec3): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    if (e.templateId !== templateId) continue;
    const d = dist2d(fromPos, e.pos);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Resolve the NPC for a quest (turn-in or giver)
// ---------------------------------------------------------------------------

function resolveTurninNpc(qDef: QuestDef): string | null {
  if (qDef.turnInNpcId) return qDef.turnInNpcId;
  if (qDef.turnInNpcIds && qDef.turnInNpcIds.length > 0) return qDef.turnInNpcIds[0];
  if (qDef.giverNpcId) return qDef.giverNpcId;
  return null;
}

// ---------------------------------------------------------------------------
// Check if a quest's prerequisites are met
// ---------------------------------------------------------------------------

function prerequisitesMet(qDef: QuestDef, sim: Sim, pid: number): boolean {
  if (qDef.requiresQuest && sim.questState(qDef.requiresQuest, pid) !== 'done') return false;
  if (qDef.minLevel !== undefined && sim.player.level < qDef.minLevel) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Main entry: evaluate quest state and return next action
// ---------------------------------------------------------------------------

/**
 * Evaluate the quest state and return the next steering action.
 *
 * Priority:
 * 1. Steer toward the turn-in NPC of a 'ready' quest (or turn in if near).
 * 2. Navigate toward incomplete objectives of 'active' quests.
 * 3. Steer toward the giver NPC of an 'available' quest (or accept if near).
 * 4. Otherwise → NOOP (auto_combat takes over).
 */
export function evaluateQuest(sim: Sim, _events: SimEvent[]): QuestStepResult {
  const p = sim.player;
  const pid = sim.primaryId;
  const log: string[] = [];

  // Phase 1: turn in ready quests.
  for (const qDef of Object.values(QUESTS)) {
    if (qDef.retired) continue;
    const state = sim.questState(qDef.id, pid);
    if (state !== 'ready') continue;

    const npcTemplateId = resolveTurninNpc(qDef);
    if (!npcTemplateId) continue;

    const npcEntity = findNpcEntity(sim, npcTemplateId);
    if (!npcEntity) continue;

    const d = dist2d(p.pos, npcEntity.pos);
    if (d <= INTERACT_RANGE) {
      sim.turnInQuest(qDef.id, pid);
      log.push(`Turned in: ${qDef.name}`);
      return { action: NOOP, didQuestAction: true, log, blocked: false, goalPos: null };
    }

    // Navigate toward the turn-in NPC.
    const steer = steerToward(p.pos, p.facing, npcEntity.pos);
    log.push(`Going to turn in ${qDef.name} (${Math.round(d)} yd)`);
    return {
      action: steer.action,
      didQuestAction: false,
      log,
      blocked: !steer.arrived,
      goalPos: { ...npcEntity.pos },
    };
  }

  // Phase 2: navigate toward active quest objectives.
  // Use questObjectiveAreas() to find where incomplete objectives are.
  const activeLog = new Map<string, { questId: string; counts: number[]; state: 'active' }>();
  for (const qDef of Object.values(QUESTS)) {
    if (qDef.retired) continue;
    const state = sim.questState(qDef.id, pid);
    if (state !== 'active') continue;
    const qp = sim.questLog.get(qDef.id);
    if (qp) activeLog.set(qDef.id, { questId: qp.questId, counts: qp.counts, state: 'active' });
  }

  if (activeLog.size > 0) {
    const areas = questObjectiveAreas(
      activeLog as ReadonlyMap<string, { questId: string; counts: number[]; state: 'active' }>,
    );
    if (areas.length > 0) {
      // Find the closest objective area.
      let bestArea = areas[0];
      let bestDist = Infinity;
      for (const area of areas) {
        const d = dist2d(p.pos, { x: area.center.x, y: 0, z: area.center.z });
        if (d < bestDist) {
          bestDist = d;
          bestArea = area;
        }
      }

      // Check if we're close enough to the area center to start fighting.
      if (bestDist <= bestArea.radius + 5) {
        // We're in the objective area — let auto_combat handle it.
        // But first, try to find a specific quest target mob to prioritize.
        for (const ref of bestArea.objectives) {
          const qDef = QUESTS[ref.questId];
          if (!qDef) continue;
          const obj = qDef.objectives[ref.objectiveIndex];
          if (obj.type === 'kill' && obj.targetMobId) {
            const targetMob = findNearestMob(sim, obj.targetMobId, p.pos);
            if (targetMob && dist2d(p.pos, targetMob.pos) <= 30) {
              // Found a quest target mob nearby — let combat handle it.
              log.push(`In objective area, hunting ${targetMob.name}`);
              return { action: NOOP, didQuestAction: false, log, blocked: false, goalPos: null };
            }
          }
        }
        // In area but no specific target visible — wander to find mobs.
        log.push(`In objective area, searching for targets`);
        return { action: NOOP, didQuestAction: false, log, blocked: false, goalPos: null };
      }

      // Not in the area yet — navigate toward the center.
      const steer = steerToward(p.pos, p.facing, {
        x: bestArea.center.x,
        y: 0,
        z: bestArea.center.z,
      });
      log.push(`Heading to objective area (${Math.round(bestDist)} yd, r=${bestArea.radius})`);
      return {
        action: steer.action,
        didQuestAction: false,
        log,
        blocked: !steer.arrived,
        goalPos: { x: bestArea.center.x, y: 0, z: bestArea.center.z },
      };
    }
  }

  // Phase 3: accept available quests (navigate toward giver if not nearby).
  // First pass: accept any quest whose giver is already in INTERACT_RANGE.
  // Second pass: navigate toward the closest giver (sorted by distance).
  // Sorting is critical: without it, Object.values() iteration order dictates
  // which quest is picked, causing the character to walk past a nearby giver
  // (e.g. marshal at 8 yd) to accept a quest from a distant one (e.g. foreman
  // at 23 yd) — the character then spends steps walking to the wrong NPC while
  // the nearby one sits ignored.
  const candidates: { qDef: (typeof QUESTS)[string]; npc: Entity; dist: number }[] = [];
  for (const qDef of Object.values(QUESTS)) {
    if (qDef.retired) continue;
    if (!qDef.giverNpcId) continue;
    const state = sim.questState(qDef.id, pid);
    if (state !== 'available') continue;
    if (!prerequisitesMet(qDef, sim, pid)) continue;
    const npcEntity = findNpcEntity(sim, qDef.giverNpcId);
    if (!npcEntity) continue;
    const d = dist2d(p.pos, npcEntity.pos);
    candidates.push({ qDef, npc: npcEntity, dist: d });
    if (d <= INTERACT_RANGE) {
      sim.acceptQuest(qDef.id, undefined, pid);
      log.push(`Accepted: ${qDef.name}`);
      return { action: NOOP, didQuestAction: true, log, blocked: false, goalPos: null };
    }
  }
  // Navigate toward the closest giver NPC.
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.dist - b.dist);
    const best = candidates[0];
    const steer = steerToward(p.pos, p.facing, best.npc.pos);
    log.push(`Going to accept ${best.qDef.name} (${Math.round(best.dist)} yd)`);
    return {
      action: steer.action,
      didQuestAction: false,
      log,
      blocked: !steer.arrived,
      goalPos: { ...best.npc.pos },
    };
  }

  // No quest goal — fall through to combat.
  return { action: NOOP, didQuestAction: false, log, blocked: false, goalPos: null };
}
