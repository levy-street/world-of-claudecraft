// Mob target selection + threat switching (M1), extracted from the Sim monolith.
//
// This module owns the mob's per-tick target picker and threat-switch logic: the
// rules that decide which player a mob hits and when a taunt or pull-over forces a
// swap. retargetMob (target died/left), highestThreatTarget (the hate-table scan),
// updateMobTarget (the 110%/130% pull-over + taunt-force), and isTrivialTo (the
// trivial-con proximity-aggro guard).
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam:
// `entities` plus the two Nythraxis-add helpers that stay on Sim) or to the sibling
// `highestThreatTarget` in this module. Statement order, branch order, and the
// prune-during-iterate `mob.threat.delete(id)` loops are preserved exactly so the
// parity gate's full-state trace stays byte-identical. The in-place Entity mutation
// (aggroTargetId/aiState/forcedTargetTimer/threat) is intentional (the refactor's
// immutability waiver). None of these methods draw rng.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). threat.ts/types.ts/data are imported
// directly (already pure); only `entities` + the Nythraxis helpers route via the seam.

import { MOBS } from '../data';
import { combatProfileForMob } from '../mob_combat';
import type { SimContext } from '../sim_context';
import { addThreat, MELEE_SWITCH_MULT, RANGED_SWITCH_MULT } from '../threat';
import type { Entity } from '../types';
import { DT, dist2d, MELEE_RANGE } from '../types';

// Classic "trivial con" gap: a wild mob this far below the player's level stops
// auto-aggroing from proximity. Moved with isTrivialTo (its only reader).
const TRIVIAL_LEVEL_GAP = 10;

// When a mob's target dies/leaves it swings to its next-highest-threat
// attacker. With no living threat left, it evades home instead of grabbing a
// nearby bystander who never acted on the mob.
export function retargetMob(ctx: SimContext, mob: Entity): void {
  const next = highestThreatTarget(ctx, mob);
  if (next) {
    mob.aggroTargetId = next.id;
    mob.aiState = 'chase';
    mob.inCombat = true;
    mob.despawnTimer = undefined;
    return;
  }
  const nythraxisFallback = ctx.nythraxisAddFallbackTarget(mob);
  if (nythraxisFallback) {
    mob.aggroTargetId = nythraxisFallback.id;
    mob.aiState = 'chase';
    mob.inCombat = true;
    mob.despawnTimer = undefined;
    addThreat(mob, nythraxisFallback.id, 1);
    return;
  }
  if (ctx.scheduleNythraxisAddDespawnIfBossReset(mob)) return;
  mob.aggroTargetId = null;
  mob.aiState = 'evade';
}

/** Highest-threat living attacker on the table; prunes stale entries. */
export function highestThreatTarget(ctx: SimContext, mob: Entity): Entity | null {
  let best: Entity | null = null;
  let bestT = -1;
  for (const [id, t] of mob.threat) {
    const e = ctx.entities.get(id);
    if (!e || e.dead) {
      mob.threat.delete(id);
      continue;
    }
    if (t > bestT) {
      bestT = t;
      best = e;
    }
  }
  return best;
}

// Classic pull-over rules, applied every AI tick while fighting: an attacker
// takes aggro past 110% of the current target's threat in melee range of
// the mob, or past 130% at range. A taunt forces the target outright.
export function updateMobTarget(ctx: SimContext, mob: Entity): void {
  if (mob.forcedTargetTimer > 0) {
    mob.forcedTargetTimer -= DT;
    const forced = mob.forcedTargetId !== null ? ctx.entities.get(mob.forcedTargetId) : null;
    if (forced && !forced.dead) {
      mob.aggroTargetId = forced.id;
      return;
    }
  }
  if (mob.forcedTargetTimer <= 0) mob.forcedTargetId = null;
  const cur = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!cur || cur.dead) {
    const next = highestThreatTarget(ctx, mob);
    if (next) mob.aggroTargetId = next.id;
    return;
  }
  const curThreat = mob.threat.get(cur.id) ?? 0;
  let best = cur;
  let bestT = curThreat;
  // Melee vs ranged uses the mob's actual reach, floored at the classic 6yd
  // (MELEE_RANGE * 1.2): normal mobs keep the 6yd boundary, while an oversized
  // creature still counts a challenger standing at its feet as melee. The reach
  // depends only on the mob, so compute it once outside the candidate loop.
  const meleeReach = Math.max(
    MELEE_RANGE * 1.2,
    combatProfileForMob(mob.templateId, mob.scale).meleeRange,
  );
  for (const [id, t] of mob.threat) {
    if (id === cur.id || t <= bestT) continue;
    const e = ctx.entities.get(id);
    if (!e || e.dead) {
      mob.threat.delete(id);
      continue;
    }
    const inMelee = dist2d(mob.pos, e.pos) <= meleeReach;
    const needed = curThreat * (inMelee ? MELEE_SWITCH_MULT : RANGED_SWITCH_MULT);
    if (t > needed) {
      best = e;
      bestT = t;
    }
  }
  if (best !== cur) mob.aggroTargetId = best.id;
}

// Classic "trivial con": a wild mob far below the player's level stops
// auto-aggroing from proximity. Elites, rares, and bosses are never trivial.
export function isTrivialTo(mob: Entity, player: Entity): boolean {
  const template = MOBS[mob.templateId];
  if (template.elite || template.rare || template.boss) return false;
  return player.level - mob.level >= TRIVIAL_LEVEL_GAP;
}
