// Pet AI tick (P1a), extracted from the Sim monolith.
//
// This module owns the per-tick brain for hunter/warlock pets: the updatePet
// dispatcher (owner-resolve + despawn guard, stun guard, aspect sync, taunt timer +
// out-of-combat regen, target acquisition incl. leash drop, then the combat arm
// (ranged-DPS bolt dispatch, close/reach, auto/manual taunt, melee-vs-ranged swing)
// or the heel arm) plus its satellites petFollow (A*-cached heel locomotion + the
// last-resort teleport), petRangedAttack (the imp-bolt projectile), and
// petPickTarget (assist/aggressive target selection with the anti-AFK owner-idle
// gate). It runs INSIDE the shared updateMob mob-AI pass (mob/locomotion.ts calls
// ctx.updatePet in entity-iteration order), so its rng draws are interleaved with
// every other mob's.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam) or
// to a sibling function in this module. Statement order, branch order, the
// `return`-vs-fallthrough early exits, and EVERY rng draw position (the imp-bolt
// crit roll + damage roll in petRangedAttack, plus any draws inside the shared
// mobSwing/dealDamage/moveToward/updateRangedPetAttack callees the dispatcher calls)
// are preserved exactly so the parity gate's full-state trace AND rng draw-order log
// stay byte-identical. The in-place Entity mutation is intentional (the refactor's
// immutability waiver). The shared movement/combat entry points (updateRangedPetAttack,
// mobSwing, applyTaunt, moveToward), the pet-management helpers (syncPetAspect,
// despawnPersistentPet), and the stat/predicate helpers (effectiveAttackPower,
// isHostileTo, isStunned, isRooted, moveSpeedMult, swingIntervalMult, mobCanSwim,
// rebucket, dealDamage) all stay on Sim and are reached through the seam.
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). data/types/pathfind/colliders are
// imported directly (already pure); everything that touches not-yet-extracted Sim
// state routes through the seam.

import { lineOfSightClear } from '../colliders';
import { MOBS } from '../data';
import { isTrivialTo } from '../mob/targeting';
import { findPlayerPath, PLAYER_BODY_RADIUS } from '../pathfind';
import { scheduleProjectile } from '../projectile_travel';
import type { SimContext } from '../sim_context';
import {
  type Aura,
  angleTo,
  DT,
  dist2d,
  type Entity,
  MELEE_RANGE,
  PET_GROWL_INTERVAL,
  PET_TELEPORT_DISTANCE,
  RUN_SPEED,
} from '../types';

const BODY_RADIUS = PLAYER_BODY_RADIUS;
const PET_LEASH = 40; // yards from the owner before a pet gives up its target
const PET_FOLLOW_DISTANCE = 3.5;
const PET_PATH_RECALC = 0.5; // seconds between heel-path A* recomputes per pet (throttle)
const PET_PATH_SPAN = 96; // A* search half-window in cells; covers the teleport distance + slack
const PET_PATH_STALE_DISTANCE = 4; // path end this far from the (now-moved) owner: recompute the heel route
const PET_WAYPOINT_REACHED = 1; // pet within this of the next waypoint: pop it and home on the next leg
const PET_ASSIST_RANGE = 50; // how far the pet scans for enemies engaging the pair
const PET_AGGRESSIVE_RANGE = 18; // aggressive pets look for idle enemies this close
// A pet pulls idle wild mobs by proximity just like its owner. The max mob detection
// radius is 20 (see the clamp below), so any mob that could notice the pet is within
// 20yd of it; scanning from the pet (there are at most a handful) keeps this off every
// idle mob's per-tick path, so work scales with pet count, not mob count.
const PET_PULL_SCAN = 20;
// Anti-AFK: an aggressive pet only proactively pulls fresh targets while its
// owner has acted (moved, cast, or commanded the pet) within this many ticks.
// 1200 ticks = 60s at 20Hz. Stops hunters/warlocks parking an aggressive pet to
// farm XP/loot while AFK; the pet still DEFENDS an idle owner. Tunable.
const PET_OWNER_IDLE_TICKS = 1200;

export function updatePet(ctx: SimContext, pet: Entity): void {
  const owner = pet.ownerId !== null ? ctx.entities.get(pet.ownerId) : null;
  if (owner?.kind !== 'player' || !ctx.players.has(owner.id)) {
    ctx.despawnPersistentPet(pet);
    return;
  }
  if (ctx.isStunned(pet)) return;
  ctx.syncPetAspect(pet, owner);
  pet.petTauntTimer = Math.max(0, pet.petTauntTimer - DT);
  if (!pet.inCombat && ctx.tickCount % 40 === 0 && pet.hp < pet.maxHp) {
    pet.hp = Math.min(pet.maxHp, pet.hp + Math.max(1, Math.round(pet.maxHp * 0.02)));
  }

  pullNearbyMobs(ctx, pet);

  let target = pet.aggroTargetId !== null ? (ctx.entities.get(pet.aggroTargetId) ?? null) : null;
  if (target && (target.dead || !ctx.isHostileTo(pet, target))) target = null;
  if (target && dist2d(owner.pos, pet.pos) > PET_LEASH) target = null;
  if (!target && !owner.dead) target = petPickTarget(ctx, pet, owner);
  pet.aggroTargetId = target?.id ?? null;
  pet.inCombat = target !== null;
  if (!target) pet.petManualTauntPending = false;

  if (target) {
    // ranged demon (imp) holds its distance and hurls bolts; melee pets close
    // in, taunt to hold threat (voidwalker tank), and swing
    const ranged = MOBS[pet.templateId]?.petRanged;
    const template = MOBS[pet.templateId];
    if (!ranged && template?.petRole === 'ranged_dps' && template.petSpell) {
      ctx.updateRangedPetAttack(pet, target, template.petSpell);
      return;
    }
    const reach = ranged ? ranged.range : MELEE_RANGE * 0.8;
    const d = dist2d(pet.pos, target.pos);
    if (d > reach) {
      if (!ctx.isRooted(pet))
        ctx.moveToward(pet, target.pos, pet.moveSpeed * ctx.moveSpeedMult(pet));
      pet.swingTimer = Math.max(0, pet.swingTimer - DT);
    } else {
      pet.facing = angleTo(pet.pos, target.pos);
      if (
        target.kind === 'mob' &&
        !ranged &&
        pet.petTauntTimer <= 0 &&
        (pet.petAutoTaunt || pet.petManualTauntPending)
      ) {
        ctx.applyTaunt(pet, target);
        pet.petManualTauntPending = false;
        pet.petTauntTimer = PET_GROWL_INTERVAL;
      }
      pet.swingTimer -= DT;
      if (pet.swingTimer <= 0) {
        if (ranged) petRangedAttack(ctx, pet, target, ranged);
        else ctx.mobSwing(pet, target);
        pet.swingTimer = pet.weapon.speed * ctx.swingIntervalMult(pet);
      }
    }
    return;
  }

  // heel
  pet.swingTimer = Math.max(0, pet.swingTimer - DT);
  petFollow(ctx, pet, owner);
}

// A pet standing inside an idle wild mob's detection radius pulls it, exactly as its
// owner would: the mob notices the pet sent in ahead instead of waiting for the pet's
// first strike. This mirrors the player proximity-aggro pass (mob/locomotion) but runs
// from the pet side so a pet-free region costs nothing.
function pullNearbyMobs(ctx: SimContext, pet: Entity): void {
  ctx.grid.forEachInRadius(pet.pos.x, pet.pos.z, PET_PULL_SCAN, (m, d2) => {
    // wild, live, idle mobs only (skip pets/adds, corpses, already-engaged, visions)
    if (m.ownerId !== null || m.kind !== 'mob' || m.dead) return;
    if (m.aiState !== 'idle' || !m.hostile || m.templateId.startsWith('vision_')) return;
    if (isTrivialTo(m, pet)) return;
    const radius = Math.max(
      4,
      Math.min(20, (MOBS[m.templateId]?.aggroRadius ?? 0) + (m.level - pet.level) * 1.5),
    );
    if (Math.sqrt(d2) < radius) ctx.aggroMob(m, pet, true);
  });
}

// Heel locomotion: route the pet to its owner AROUND obstacles instead of
// letting greedy slide-steering wedge on a wall and then snapping the pet to
// the owner. Mirrors the warrior-charge path cache (`petPath`): A* is recomputed
// at most every PET_PATH_RECALC and otherwise the cached waypoints are followed.
// The 60yd teleport is kept only as a true last resort, for when no route to the
// owner exists at all (e.g. owner stranded across un-navigable terrain).
export function petFollow(ctx: SimContext, pet: Entity, owner: Entity): void {
  pet.petPathCooldown = Math.max(0, pet.petPathCooldown - DT);
  const d = dist2d(pet.pos, owner.pos);
  if (d <= PET_FOLLOW_DISTANCE) {
    pet.petPath = [];
    return;
  }
  if (ctx.isRooted(pet)) return;

  const swim = ctx.mobCanSwim(MOBS[pet.templateId]);
  const recompute = (): void => {
    pet.petPath = findPlayerPath(ctx.cfg.seed, pet.pos, owner.pos, PET_PATH_SPAN, false, swim).map(
      (w) => ({ x: w.x, y: 0, z: w.z }),
    );
    pet.petPathCooldown = PET_PATH_RECALC;
  };
  // recompute when the throttle has elapsed and the cache is stale: empty, or
  // its end no longer lands near the (now-moved) owner. findPlayerPath returns a
  // single-waypoint straight line (length 1) when the goal is unreachable.
  const end = pet.petPath[pet.petPath.length - 1];
  const stale = !end || dist2d(end, owner.pos) > PET_PATH_STALE_DISTANCE;
  if (pet.petPathCooldown <= 0 && stale) recompute();
  // drop waypoints we've reached; the last leg homes on the live owner position.
  while (pet.petPath.length > 1 && dist2d(pet.pos, pet.petPath[0]) < PET_WAYPOINT_REACHED)
    pet.petPath.shift();

  // Last-resort teleport: only when the owner is far AND genuinely unreachable.
  // We confirm with a FRESH path (ignoring the throttle) so a stale single-point
  // cache from a moment ago can never trigger a spurious snap while a real route
  // exists — e.g. right after a combat→heel transition.
  if (
    pet.petPath.length <= 1 &&
    d > PET_TELEPORT_DISTANCE &&
    !lineOfSightClear(ctx.cfg.seed, pet.pos, owner.pos, BODY_RADIUS)
  ) {
    recompute();
    if (pet.petPath.length <= 1) {
      pet.pos = { ...owner.pos };
      pet.prevPos = { ...pet.pos };
      pet.petPath = [];
      // a warp is a teleport: keep the spatial grid exact this tick instead of
      // waiting for the end-of-tick refresh, so same-tick aggro/AoE queries
      // don't miss the pet at its old cell (matches every other teleport site)
      ctx.rebucket(pet);
      return;
    }
  }

  const routed = pet.petPath.length > 1;
  const aim = routed ? pet.petPath[0] : owner.pos;
  const speed = Math.max(pet.moveSpeed, RUN_SPEED * 1.1) * ctx.moveSpeedMult(pet);
  ctx.moveToward(pet, aim, speed);
}

/** A ranged demon pet (imp) hurls a spell-school bolt: a telegraphed
 *  projectile that bypasses armor, mirroring the player caster path. Damage
 *  comes from the mob's weapon range + AP, exactly like its melee siblings. */
export function petRangedAttack(
  ctx: SimContext,
  pet: Entity,
  target: Entity,
  ranged: { range: number; school: Aura['school'] },
): void {
  ctx.emit({
    type: 'spellfx',
    sourceId: pet.id,
    targetId: target.id,
    school: ranged.school,
    fx: 'projectile',
  });
  // The imp's bolt resolves on arrival (projectile_travel), not the tick it is hurled;
  // it fizzles if the pet or its target dies before impact.
  scheduleProjectile(ctx, pet, target, (src, tgt) => {
    const crit = ctx.rng.chance(0.05);
    let dmg =
      ctx.rng.range(src.weapon.min, src.weapon.max) +
      (ctx.effectiveAttackPower(src) / 14) * src.weapon.speed;
    if (crit) dmg *= 2;
    ctx.dealDamage(src, tgt, Math.max(1, Math.round(dmg)), crit, ranged.school, null, 'hit');
  });
}

export function petPickTarget(ctx: SimContext, pet: Entity, owner: Entity): Entity | null {
  if (pet.petMode === 'passive') return null;
  // Anti-AFK: an aggressive pet only proactively pulls fresh targets while its
  // owner is actually playing. An idle owner's pet still defends (engagingUs /
  // ownerOffense below) but cannot farm the area alone (hunter/warlock).
  const ownerMeta = ctx.players.get(owner.id);
  const ownerIdle = !ownerMeta || ctx.tickCount - ownerMeta.lastActiveTick > PET_OWNER_IDLE_TICKS;
  let best: Entity | null = null;
  let bestD = pet.petMode === 'aggressive' ? PET_AGGRESSIVE_RANGE : PET_ASSIST_RANGE;
  for (const m of ctx.entities.values()) {
    if (m.id === pet.id || m.dead || !ctx.isHostileTo(pet, m)) continue;
    const engagingUs =
      m.kind === 'mob' && (m.aggroTargetId === owner.id || m.aggroTargetId === pet.id);
    const ownerOffense =
      owner.targetId === m.id && (owner.autoAttack || (m.kind === 'mob' && m.threat.has(owner.id)));
    const aggressive =
      pet.petMode === 'aggressive' && !ownerIdle && dist2d(pet.pos, m.pos) <= PET_AGGRESSIVE_RANGE;
    if (!engagingUs && !ownerOffense && !aggressive) continue;
    const d = dist2d(pet.pos, m.pos);
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}
