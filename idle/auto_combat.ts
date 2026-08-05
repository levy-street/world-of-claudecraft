// Priority-ladder auto combat policy for the Idle Classic engine.
//
// Returns ONE action index per step for `applyAction`.
// Assesses enemy difficulty: flees from strong mobs, fights level-appropriate ones.
// Deterministic (no Math.random, no wall clock).

import { ACTIONS } from '../src/sim/obs';
import type { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { angleTo, dist2d, MELEE_ARC, MELEE_RANGE, normAngle } from '../src/sim/types';
import { isTooDangerous } from './difficulty';
import { steerToward } from './movement';
import { assessThreat } from './threat_map';

const NOOP = 0;
const FORWARD = 1;
const TURN_LEFT = 3;
const TURN_RIGHT = 4;
const ATTACK = 9;
// Abilities index ACTIONS as 'ability_1'..'ability_N' starting right after
// 'attack' (index 9), so 'ability_1' is index 10. applyAction maps action N to
// slot parseInt('ability_'+(N-9))-1 = N-10, so ABILITY_1 must be 10 (slot 0).
const ABILITY_1 = 10;
const EAT_DRINK = ACTIONS.indexOf('eat_drink');

const MELEE_FACING_THRESHOLD = MELEE_ARC / 2;

// Per-Sim idle-scan throttle. Keyed by Sim instance (not a bare module
// global) so two IdleEngine instances stepping in the same process cannot
// perturb each other's "scan for a target every 2 idle steps" cadence, the
// determinism test's two engines stay independent even if interleaved.
const _idleSteps = new WeakMap<Sim, number>();
const idleSteps = (sim: Sim): number => _idleSteps.get(sim) ?? 0;
const setIdleSteps = (sim: Sim, v: number): void => {
  _idleSteps.set(sim, v);
};

// ---------------------------------------------------------------------------
// Target resolution with difficulty filtering
// ---------------------------------------------------------------------------

interface TargetResult {
  action?: number;
  target?: Entity;
}

function resolveTarget(sim: Sim): TargetResult {
  const p = sim.player;
  const { entities } = sim;

  if (p.dead) return { action: NOOP };

  // CRITICAL: pack-aware danger check BEFORE any movement decision.
  // If a lethal pack or affix mob is nearby, flee from the centroid.
  const danger = findDanger(sim);
  if (danger) {
    p.targetId = null;
    return { action: danger.action };
  }

  const targetId = p.targetId;
  if (targetId === null) {
    // No target, scan for one with difficulty filtering.
    setIdleSteps(sim, idleSteps(sim) + 1);

    if (idleSteps(sim) >= 2) {
      setIdleSteps(sim, 0);
      const best = findBestTarget(sim);
      if (best) {
        p.targetId = best.id;
        return { target: best };
      }
      // No suitable target, walk forward (the engine/navigation layer
      // will steer toward a level-appropriate camp when idle).
      return { action: FORWARD };
    }
    return { action: FORWARD };
  }

  const current = entities.get(targetId) ?? null;
  if (!current) {
    p.targetId = null;
    setIdleSteps(sim, idleSteps(sim) + 1);
    if (idleSteps(sim) >= 2) {
      setIdleSteps(sim, 0);
      const best = findBestTarget(sim);
      if (best) {
        p.targetId = best.id;
        return { target: best };
      }
    }
    return { action: FORWARD };
  }

  // Corpse, move on.
  if (current.dead) {
    p.targetId = null;
    setIdleSteps(sim, 0);
    return { action: FORWARD };
  }

  // Current target is too dangerous (by adaptive gap or affix), flee.
  if (isTooDangerous(p.level, current)) {
    p.targetId = null;
    setIdleSteps(sim, 0);
    return { action: fleeAction(p, current) };
  }

  // Non-hostile mob > 25 yd away, abandon.
  if (!current.hostile && dist2d(p.pos, current.pos) > 25) {
    p.targetId = null;
    setIdleSteps(sim, idleSteps(sim) + 1);
    return { action: FORWARD };
  }

  setIdleSteps(sim, 0);
  return { target: current };
}

/**
 * Assess danger of the area. Uses the pack-aware threat_map. Returns a flee
 * action when the area is lethal; null when safe/caution (let combat engage).
 */
function findDanger(sim: Sim): { action: number } | null {
  const threat = assessThreat(sim);
  if (threat.level !== 'lethal') return null;
  const p = sim.player;
  // Flee from the pack centroid (threat.fleeFrom) by turning away from it.
  const fleeFrom = threat.fleeFrom;
  if (!fleeFrom) return null;
  const awayAngle = angleTo(fleeFrom, p.pos);
  const rel = normAngle(awayAngle - p.facing);
  const action = Math.abs(rel) > Math.PI / 4 ? (rel > 0 ? TURN_LEFT : TURN_RIGHT) : FORWARD;
  return { action };
}

/**
 * Find the best target: nearest level-appropriate hostile mob within the
 * adaptive safe gap. NO filterless fallback, if there is no suitable
 * target, returns null and the engine navigates toward a camp instead.
 *
 * Uses isTooDangerous which accounts for both the level gap AND the
 * mob's template affixes (boss/rare/elite/worldBoss are always too
 * dangerous unless the player is at or above the mob's level).
 */
function findBestTarget(sim: Sim): Entity | null {
  const p = sim.player;
  let best: Entity | null = null;
  let bestDist = Infinity;
  const SEARCH_RADIUS = 55; // yards, wide enough to find the next camp, not infinite

  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
    if (isTooDangerous(p.level, e)) continue;
    const d = dist2d(p.pos, e.pos);
    if (d > SEARCH_RADIUS) continue;
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  // NO filterless fallback. When there is nothing here to fight,
  // the engine will steer toward a level-appropriate camp via
  // progression_target. This is intentional: wandering blindly into
  // an area with only strong mobs is how the player dies.
  return best;
}

/**
 * Compute a flee action: turn away from the threat and run.
 * For single mobs, the threat is the mob's position.
 * The pack-aware threat map uses its own flee centroid, computed in `findDanger`.
 */
function fleeAction(p: Entity, threat: Entity): number {
  // Angle FROM threat TO player = direction to run.
  const awayAngle = angleTo(threat.pos, p.pos);
  const rel = normAngle(awayAngle - p.facing);

  // If not facing away (more than 45 degrees off), turn to face away.
  if (Math.abs(rel) > Math.PI / 4) {
    return rel > 0 ? TURN_LEFT : TURN_RIGHT;
  }
  // Facing roughly away, run!
  return FORWARD;
}

// ---------------------------------------------------------------------------
// Gap closing
// ---------------------------------------------------------------------------
function closeGap(p: Entity, target: Entity): number {
  const meleeDist = dist2d(p.pos, target.pos);
  const rawRel = normAngle(angleTo(p.pos, target.pos) - p.facing);
  const closeEnough = meleeDist <= MELEE_RANGE + 2;
  const facingOk = Math.abs(rawRel) <= MELEE_FACING_THRESHOLD;

  if (closeEnough && facingOk) return -1;

  if (!closeEnough) {
    if (target.hostile && meleeDist < 20 && p.hp < p.maxHp) {
      return NOOP;
    }
    const steer = steerToward(p.pos, p.facing, target.pos);
    return steer.arrived ? FORWARD : steer.action;
  }

  // Close but target is behind, walk forward to bring it in front.
  if (Math.abs(rawRel) > Math.PI / 2) {
    return FORWARD;
  }
  return rawRel > 0 ? TURN_LEFT : TURN_RIGHT;
}

// ---------------------------------------------------------------------------
// Ability usage
// ---------------------------------------------------------------------------
function castReadyAbility(sim: Sim): number {
  const p = sim.player;
  const known = sim.known;
  for (let i = 0; i < known.length; i++) {
    const ab = known[i];
    if (!ab) continue;
    const cd = p.cooldowns.get(ab.def.id) ?? 0;
    if (cd > 0) continue;
    if (p.resource < ab.cost) continue;
    if (!ab.def.offGcd && p.gcdRemaining > 0) continue;
    return ABILITY_1 + i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------
export function pickAction(sim: Sim): number {
  const p = sim.player;

  // 1. Dead → auto-resurrect.
  if (p.dead) return NOOP;

  // 2. Resolve target (with difficulty filtering).
  const rt = resolveTarget(sim);
  if (rt.action !== undefined) return rt.action;

  const target = rt.target!;
  const distToTarget = dist2d(p.pos, target.pos);

  // 3. Gap-closing ability at 8-25 yd.
  if (distToTarget >= 8 && distToTarget <= 25) {
    const abAction = castReadyAbility(sim);
    if (abAction !== -1) return abAction;
  }

  // 4. Close gap.
  const gapAction = closeGap(p, target);
  if (gapAction !== -1) return gapAction;

  // 5. In melee range, not auto-attacking → start.
  if (!p.autoAttack) return ATTACK;

  // 6. Low HP → eat/drink.
  if (p.hp < p.maxHp * 0.3) return EAT_DRINK;

  // 7. Cast first ready ability.
  const abAction2 = castReadyAbility(sim);
  if (abAction2 !== -1) return abAction2;

  return NOOP;
}
