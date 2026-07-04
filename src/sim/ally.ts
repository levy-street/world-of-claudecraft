// World-owned allied combat units: the substrate under the defense-event and
// escort mechanics (src/sim/events/). An ally is a MOB carrying the
// MobTemplate.allyOfPlayers flag with NO owner: it rides every existing mob
// surface (wire, nameplates, hp bars, spatial grids, corpse) while being
// friendly to every player and a real target for hostile mobs.
//
// Design constraints this module owns (see docs/plans and the phase-5 design):
// - updateMob dispatches allies here BEFORE the hostility safety net in
//   mob/locomotion.ts, which would otherwise re-hostile any owner-less
//   non-hostile mob every tick; the brain also re-asserts hostile = false.
// - Allies NEVER run the idle-wander path (it draws rng): an idle ally is
//   rng-draw-silent, so ambient parity goldens stay unchanged by the substrate.
// - Allies never respawn through respawnMob (which revives hostile): death
//   parks the corpse (respawnTimer Infinity) and notifies the owning event
//   module through ctx.onAllyDeath; the module owns the respawn.
// - Movement/behavior comes from an AllyDirective the owning module sets in
//   ctx.allyDirectives (post to hold, engage radius, optional walk target).
//
// System module behind SimContext: functions only, no module state, no rng.

import { MOBS } from './data';
import { createMob } from './entity';
import type { SimContext } from './sim_context';
import { angleTo, DT, dist2d, type Entity, MELEE_RANGE, type Vec3 } from './types';

// How long an ally corpse lingers before the owning event module may replace
// it (the module drops the entity itself; this is display time).
export const ALLY_CORPSE_SECONDS = 10;
// Beyond this distance from its post an ally abandons the fight and walks home
// (same scale as the wild-mob leash).
export const ALLY_LEASH = 45;
// Default acquisition radius when the directive does not narrow it.
export const ALLY_DEFAULT_ENGAGE_RADIUS = 30;
const ALLY_HOME_EPSILON = 2;
const ALLY_MEND_OUT_OF_COMBAT_SECONDS = 5;

/** Per-ally behavior directive, produced by the owning event module and
 *  consumed by the shared brain below. Lives in ctx.allyDirectives. */
export interface AllyDirective {
  /** Home/leash anchor (the defense post, or the escort's current origin). */
  post: Vec3;
  /** Acquire hostiles within this range of the ALLY. */
  engageRadius: number;
  /** Escort walk target; null holds the post. Combat always preempts. */
  moveTo: Vec3 | null;
}

/** The substrate predicate: a live-or-dead world-owned allied mob. */
export function isWorldAlly(e: Entity): boolean {
  return e.kind === 'mob' && e.ownerId === null && !!MOBS[e.templateId]?.allyOfPlayers;
}

/** Spawn an ally at ground level with its directive registered. Draws no rng
 *  (fixed level, position, facing), so ctor-time use never shifts world-gen
 *  draw order; ids advance like every other spawn. */
export function spawnAllyAt(
  ctx: SimContext,
  templateId: string,
  level: number,
  x: number,
  z: number,
  facing: number,
  directive: AllyDirective,
): Entity {
  const template = MOBS[templateId];
  const e = createMob(ctx.nextId++, template, level, ctx.groundPos(x, z));
  e.hostile = false;
  e.facing = facing;
  ctx.addEntity(e);
  ctx.allyDirectives.set(e.id, directive);
  return e;
}

/** Nearest engageable hostile: a live hostile mob inside the engage radius
 *  that is already fighting the site (the ally is on its hate table, or it is
 *  chasing a player, a pet, or an ally). Deterministic and rng-free: pure
 *  nearest-by-distance over the spatial grid, ties broken by entity id. */
function pickAllyTarget(ctx: SimContext, ally: Entity, engageRadius: number): Entity | null {
  let best: Entity | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  ctx.grid.forEachInRadius(ally.pos.x, ally.pos.z, engageRadius, (e, d2) => {
    if (e.kind !== 'mob' || e.dead || !e.hostile || e.aiState === 'evade') return;
    const engaged =
      e.threat.has(ally.id) ||
      (e.aggroTargetId !== null &&
        (() => {
          const t = ctx.entities.get(e.aggroTargetId);
          return !!t && (t.kind === 'player' || t.ownerId !== null || isWorldAlly(t));
        })());
    if (!engaged) return;
    if (d2 < bestD || (d2 === bestD && best !== null && e.id < best.id)) {
      bestD = d2;
      best = e;
    }
  });
  return best;
}

/** The shared per-tick ally brain (dispatched from mob/locomotion.ts before
 *  the hostility safety net). Fight what threatens the site, else walk the
 *  directive, else hold the post and mend. NO idle wander: an idle ally must
 *  stay rng-draw-silent. */
export function updateWorldAlly(ctx: SimContext, ally: Entity): void {
  // Mirror of the vision_/bell exemptions: whatever path flipped it, an ally
  // is never hostile.
  ally.hostile = false;
  const directive = ctx.allyDirectives.get(ally.id);
  const post = directive?.post ?? ally.spawnPos;
  const engageRadius = directive?.engageRadius ?? ALLY_DEFAULT_ENGAGE_RADIUS;

  // Leash: dragged too far from the post, drop the fight and walk home.
  const fromPost = dist2d(ally.pos, post);
  if (fromPost > ALLY_LEASH) {
    ally.aggroTargetId = null;
    ally.inCombat = false;
    ctx.moveToward(ally, post, ally.moveSpeed * ctx.moveSpeedMult(ally));
    return;
  }

  const target = pickAllyTarget(ctx, ally, engageRadius);
  if (target) {
    ally.inCombat = true;
    ally.aggroTargetId = target.id;
    const reach = MELEE_RANGE * 0.9;
    const d = dist2d(ally.pos, target.pos);
    if (d > reach) {
      ally.swingTimer = Math.max(0, (ally.swingTimer ?? 0) - DT);
      if (!ctx.isRooted(ally)) {
        ctx.moveToward(ally, target.pos, ally.moveSpeed * ctx.moveSpeedMult(ally));
      }
    } else {
      ally.facing = angleTo(ally.pos, target.pos);
      ally.swingTimer = (ally.swingTimer ?? 0) - DT;
      if (ally.swingTimer <= 0) {
        ctx.mobSwing(ally, target);
        ally.swingTimer = ally.weapon.speed * ctx.swingIntervalMult(ally);
      }
    }
    return;
  }

  ally.aggroTargetId = null;
  ally.inCombat = false;
  ally.swingTimer = Math.max(0, (ally.swingTimer ?? 0) - DT);

  // Escort walk (combat above always preempts it).
  if (directive?.moveTo) {
    ctx.moveToward(ally, directive.moveTo, ally.moveSpeed * ctx.moveSpeedMult(ally));
    return;
  }

  // Hold the post; out of combat long enough, quietly mend to full.
  if (fromPost > ALLY_HOME_EPSILON) {
    ctx.moveToward(ally, post, ally.moveSpeed * ctx.moveSpeedMult(ally));
    return;
  }
  if (ally.hp < ally.maxHp && ally.combatTimer > ALLY_MEND_OUT_OF_COMBAT_SECONDS) {
    ally.hp = ally.maxHp;
    ctx.emit({ type: 'heal', targetId: ally.id, amount: ally.maxHp });
  }
}
