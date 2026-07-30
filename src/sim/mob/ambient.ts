// Ambient, purely-decorative world mobs: the Highwatch stable horses. Unlike the
// bell/vale-cup/yumi inert arms in mob/locomotion.ts (which never move), these DO
// wander, so they can't be a no-op arm: this module owns the small wander
// behaviour behind the SimContext seam and the locomotion dispatcher routes
// ambient mobs here.
//
// Contract kept every tick: never hostile, never aggro/combat/evade-home, and
// therefore never a valid enemy target (isHostileTo reads mob.hostile, so a
// non-hostile wild mob is un-attackable, un-tameable, and skipped by tab-target)
// and never re-hostiled by the dispatcher's leaked-mob safety net (this arm
// returns before it, exactly like the inert arms). They wander a bounded patch
// inside the paddock so the horses never cross a fence.
//
// Determinism WITHOUT perturbing the shared stream: the wander draws a PRIVATE
// per-tick Rng sub-stream seeded from the deterministic sim clock (ctx.tickCount)
// and the mob's stable entity id, NEVER the shared ctx.rng. It shares the reason
// the bell/vale-cup arms avoid wander: an ambient system must not shift the shared
// draw order (it would fork every seed-pinned test and golden trace).
// Ambient mobs also spawn RNG-free (Sim's camp loop, gated on template.ambient).
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now (tests/architecture.test.ts).

import { STABLE_PASTURE } from '../content/mounts';
import { MOBS } from '../data';
import { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import { DT, type Entity } from '../types';

/** Max wander radius (world units) around a horse's spawn point. */
const WANDER_RADIUS = 8;
/** Slow amble: the same fraction of moveSpeed the idle-wander path uses. */
const WANDER_SPEED_MULT = 0.35;

/** True for a purely-ambient world mob the dispatcher hands to updateAmbientMob
 *  instead of the hostile idle/chase/flee/evade AI. */
export function isAmbientMob(mob: Entity): boolean {
  return MOBS[mob.templateId]?.ambient === true;
}

/** A fresh deterministic sub-stream for THIS mob on THIS tick, reproducible from
 *  the sim clock + the mob's stable id alone, so the wander never touches the shared
 *  ctx.rng and perturbs no golden/seed test. */
function ambientRng(ctx: SimContext, mob: Entity): Rng {
  const seed = (((ctx.tickCount * 0x9e3779b1) >>> 0) ^ ((mob.id * 0x85ebca6b) >>> 0)) >>> 0;
  return new Rng(seed);
}

/** Clamp a point into the north pasture (STABLE_PASTURE, already inset for body
 *  clearance and kept NORTH of the divider so a horse can never cross into the
 *  course arena). The pasture is convex, so moving toward an in-bounds target from an
 *  in-bounds position keeps the horse in-bounds every step. */
function clampToPasture(x: number, z: number): { x: number; z: number } {
  return {
    x: Math.min(STABLE_PASTURE.xMax, Math.max(STABLE_PASTURE.xMin, x)),
    z: Math.min(STABLE_PASTURE.zMax, Math.max(STABLE_PASTURE.zMin, z)),
  };
}

/** Drive one ambient stable horse: pin it non-hostile/out of combat, then run the
 *  bounded idle wander. Mirrors the dispatcher's idle-wander shape (wanderTimer/
 *  wanderTarget) but every candidate target is clamped inside the paddock so the
 *  horse can never leave the fenced yard, and every draw comes off the private
 *  sub-stream above. */
export function updateAmbientMob(ctx: SimContext, mob: Entity): void {
  // Held non-hostile every tick (createMob spawns every mob hostile): keeps the
  // horse un-attackable/untargetable and immune to the leaked-mob safety net.
  mob.hostile = false;
  mob.inCombat = false;
  mob.aiState = 'idle';
  mob.aggroTargetId = null;
  clearThreat(mob);

  const rng = ambientRng(ctx, mob);
  mob.wanderTimer -= DT;
  if (mob.wanderTimer <= 0) {
    if (mob.wanderTarget) {
      mob.wanderTarget = null;
      mob.wanderTimer = rng.range(3, 10);
    } else {
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(2, WANDER_RADIUS);
      const t = clampToPasture(
        mob.spawnPos.x + Math.sin(ang) * r,
        mob.spawnPos.z + Math.cos(ang) * r,
      );
      mob.wanderTarget = ctx.groundPos(t.x, t.z);
      mob.wanderTimer = 30;
    }
  }
  if (mob.wanderTarget) {
    const arrived = ctx.moveToward(mob, mob.wanderTarget, mob.moveSpeed * WANDER_SPEED_MULT);
    if (arrived) {
      mob.wanderTarget = null;
      mob.wanderTimer = rng.range(3, 10);
    }
  }
}
