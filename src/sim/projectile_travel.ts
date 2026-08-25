// Projectile travel timing: defer a projectile's damage until it visually lands.
//
// The sim was hitscan: a ranged cast / shot / pet bolt emitted its `fx:'projectile'`
// visual AND resolved its damage in the SAME 20 Hz tick, while the renderer
// (src/render/vfx.ts) flew the bolt at PROJECTILE_SPEED yd/s toward the target. The
// damage number therefore popped before the bolt arrived. This leaf re-times that:
// the call site emits the visual now and schedules the WHOLE resolution (hit roll,
// crit/damage rng draws, dealDamage / runEffects) to run when the bolt reaches the
// target, one or more ticks later. Because every rng draw is deferred to the landing
// tick, a projectile whose caster or target dies or despawns mid-flight FIZZLES: it
// draws nothing and deals nothing (the alive guard in advancePendingProjectiles).
//
// The bolt HOMES on its live target, exactly like the renderer: each tick it steps
// PROJECTILE_SPEED * DT yards toward the target's CURRENT position and impacts on the
// tick it comes within reach. Storing a fixed launch-time landing tick would desync
// from the visual whenever the target moves during flight (a target kiting away pushes
// the bolt's real impact later; running in pulls it earlier); stepping toward the live
// position tracks the renderer's homing instead.
//
// `src/sim`-pure: the homing math (stepProjectile + constants) is a pure function of
// numbers a Vitest drives directly; scheduleProjectile/advance take the SimContext seam
// by TYPE only (no DOM/Three/Math.random/Date.now), so the architecture guard
// (tests/architecture.test.ts) stays green.

import {
  BALLISTIC_PROJECTILE_RADIUS,
  entityCombatRadius,
  segmentCircleTimeOfImpact,
} from './combat/directional_attack';
import type { SimContext } from './sim_context';
import { evadeIncomingAttack } from './player_dodge';
import { DT, type Entity } from './types';

// Yards per second. Matches the homing projectile speed in src/render/vfx.ts so the
// damage lands in step with the bolt the player actually sees. Keep the two in sync.
export const PROJECTILE_SPEED = 26;

// Impact radius in yards: the bolt lands once it is within this of the live target (or
// one tick's step, whichever is larger). Mirrors the `Math.max(0.7, step)` arrival test
// in src/render/vfx.ts so the sim resolves on the same tick the visual flashes.
export const PROJECTILE_REACH = 0.7;

// Seconds a bolt may spend chasing before it lands by force. A released projectile can
// never be escaped, so a target kiting at or above PROJECTILE_SPEED (which the homing can
// never physically catch) takes the hit at this deadline rather than getting away. Matches
// the bolt's ttl in src/render/vfx.ts, so the damage lands as the visual gives up.
export const PROJECTILE_MAX_FLIGHT = 3;

/** One tick of homing: move (x, z) toward (tx, tz) by `step` yards. Returns the new
 *  position and whether the bolt is now within reach (it impacts this tick). Pure:
 *  same inputs give the same output, so a bolt's whole flight is deterministic. */
export function stepProjectile(
  x: number,
  z: number,
  tx: number,
  tz: number,
  step: number,
): { x: number; z: number; hit: boolean } {
  const dx = tx - x;
  const dz = tz - z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= Math.max(PROJECTILE_REACH, step)) return { x: tx, z: tz, hit: true };
  const k = step / dist;
  return { x: x + dx * k, z: z + dz * k, hit: false };
}

// A projectile in flight: re-resolved by id at the landing tick so a stale Entity ref
// can never be hit. `resolve` runs only when both ends are still alive (see advance).
// `x`/`z` are the bolt's live horizontal position, stepped toward the target each tick.
export type PendingHomingProjectile = {
  kind?: 'homing';
  x: number;
  z: number;
  sourceId: number;
  targetId: number;
  ttl: number; // seconds of flight remaining before the bolt gives up and fizzles
  resolve: (source: Entity, target: Entity) => void;
  fizzle?: () => void;
};

export type PendingBallisticProjectile = {
  kind: 'ballistic';
  trajectoryId: string;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  sourceId: number;
  targetId?: never;
  speed: number;
  radius: number;
  travelled: number;
  minDistance: number;
  maxDistance: number;
  school: string;
  ability: string | null;
  resolve: (source: Entity, target: Entity) => void;
  fizzle?: () => void;
};

export type PendingProjectile = PendingHomingProjectile | PendingBallisticProjectile;

/** Queue a projectile launched now from `origin` (the source position by default) at
 *  `target`; `resolve` runs at the landing tick with the still-live authority source and
 *  target. A custom origin lets ricochets travel from the previous impact while caster
 *  liveness and attribution remain authoritative. The caller emits the `fx:'projectile'`
 *  visual itself (the renderer needs it immediately at launch). */
export function scheduleProjectile(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  resolve: (source: Entity, target: Entity) => void,
  origin: Readonly<{ x: number; z: number }> = source.pos,
  fizzle?: () => void,
): void {
  ctx.pendingProjectiles.push({
    kind: 'homing',
    x: origin.x,
    z: origin.z,
    sourceId: source.id,
    targetId: target.id,
    ttl: PROJECTILE_MAX_FLIGHT,
    resolve,
    fizzle,
  });
}

export interface BallisticProjectileOptions {
  angle: number;
  maxDistance: number;
  minDistance?: number;
  speed?: number;
  radius?: number;
  school: string;
  ability?: string;
  attackAnimation?: 'ranged-shot';
  wand?: true;
}

export function scheduleBallisticProjectile(
  ctx: SimContext,
  source: Entity,
  options: BallisticProjectileOptions,
  resolve: (source: Entity, target: Entity) => void,
  fizzle?: () => void,
): string {
  const angle = Math.atan2(Math.sin(options.angle), Math.cos(options.angle));
  const trajectoryId = `${source.id}:${ctx.tickCount}:${ctx.pendingProjectiles.length}`;
  const dirX = Math.sin(angle);
  const dirZ = Math.cos(angle);
  const speed = Math.max(0.01, options.speed ?? PROJECTILE_SPEED);
  const radius = Math.max(0, options.radius ?? BALLISTIC_PROJECTILE_RADIUS);
  const maxDistance = Math.max(0, options.maxDistance);
  ctx.pendingProjectiles.push({
    kind: 'ballistic',
    trajectoryId,
    x: source.pos.x,
    z: source.pos.z,
    dirX,
    dirZ,
    sourceId: source.id,
    speed,
    radius,
    travelled: 0,
    minDistance: Math.max(0, options.minDistance ?? 0),
    maxDistance,
    school: options.school,
    ability: options.ability ?? null,
    resolve,
    fizzle,
  });
  ctx.emit({
    type: 'projectileLaunch',
    trajectoryId,
    sourceId: source.id,
    x: source.pos.x,
    z: source.pos.z,
    dirX,
    dirZ,
    speed,
    maxDistance,
    radius,
    school: options.school,
    ability: options.ability,
    attackAnimation: options.attackAnimation,
    wand: options.wand,
  });
  return trajectoryId;
}

function wallImpactDistance(
  ctx: SimContext,
  source: Entity,
  from: Readonly<{ x: number; z: number }>,
  dirX: number,
  dirZ: number,
  distance: number,
): number | null {
  const end = { x: from.x + dirX * distance, z: from.z + dirZ * distance };
  if (!ctx.projectilePathClear || ctx.projectilePathClear(source, from, end)) return null;
  let clear = 0;
  let blocked = distance;
  for (let i = 0; i < 10; i++) {
    const mid = (clear + blocked) / 2;
    const probe = { x: from.x + dirX * mid, z: from.z + dirZ * mid };
    if (!ctx.projectilePathClear || ctx.projectilePathClear(source, from, probe)) clear = mid;
    else blocked = mid;
  }
  return blocked;
}

function advanceBallisticProjectile(
  ctx: SimContext,
  projectile: PendingBallisticProjectile,
  source: Entity,
): boolean {
  const remaining = Math.max(0, projectile.maxDistance - projectile.travelled);
  const distance = Math.min(remaining, projectile.speed * DT);
  if (distance <= 1e-9) {
    ctx.emit({
      type: 'projectileImpact',
      trajectoryId: projectile.trajectoryId,
      x: projectile.x,
      z: projectile.z,
      reason: 'range',
    });
    projectile.fizzle?.();
    return false;
  }
  const wallImpact = wallImpactDistance(
    ctx,
    source,
    projectile,
    projectile.dirX,
    projectile.dirZ,
    distance,
  );
  let entityImpact: { entity: Entity; distance: number } | null = null;
  const midX = projectile.x + projectile.dirX * distance * 0.5;
  const midZ = projectile.z + projectile.dirZ * distance * 0.5;
  const visited = new Set<number>();
  const considerEntity = (entity: Entity): void => {
    if (visited.has(entity.id)) return;
    visited.add(entity.id);
    if (entity.id === source.id || entity.dead || !ctx.isHostileTo(source, entity)) return;
    const impact = segmentCircleTimeOfImpact(
      projectile,
      { x: projectile.dirX, z: projectile.dirZ },
      distance,
      entity.pos,
      projectile.radius + entityCombatRadius(entity),
    );
    if (impact === null || projectile.travelled + impact < projectile.minDistance - 1e-9) return;
    if (
      !entityImpact ||
      impact < entityImpact.distance - 1e-9 ||
      (Math.abs(impact - entityImpact.distance) <= 1e-9 && entity.id < entityImpact.entity.id)
    ) {
      entityImpact = { entity, distance: impact };
    }
  };
  const queryRadius = distance * 0.5 + 2.25;
  // Mobs/pets and players live in separate spatial indices. Querying both is
  // required for duel, arena and battleground interception; the id set keeps a
  // future overlapping index implementation deterministic and duplicate-free.
  ctx.grid.forEachInRadius(midX, midZ, queryRadius, considerEntity);
  ctx.playerGrid.forEachInRadius(midX, midZ, queryRadius, considerEntity);
  const hit = entityImpact as { entity: Entity; distance: number } | null;
  if (hit && (wallImpact === null || hit.distance <= wallImpact + 1e-9)) {
    projectile.x += projectile.dirX * hit.distance;
    projectile.z += projectile.dirZ * hit.distance;
    ctx.emit({
      type: 'projectileImpact',
      trajectoryId: projectile.trajectoryId,
      x: projectile.x,
      z: projectile.z,
      targetId: hit.entity.id,
      reason: 'entity',
    });
    if (!evadeIncomingAttack(ctx, source, hit.entity, projectile.school, projectile.ability)) {
      projectile.resolve(source, hit.entity);
    }
    return false;
  }
  if (wallImpact !== null) {
    projectile.x += projectile.dirX * wallImpact;
    projectile.z += projectile.dirZ * wallImpact;
    ctx.emit({
      type: 'projectileImpact',
      trajectoryId: projectile.trajectoryId,
      x: projectile.x,
      z: projectile.z,
      reason: 'wall',
    });
    projectile.fizzle?.();
    return false;
  }
  projectile.x += projectile.dirX * distance;
  projectile.z += projectile.dirZ * distance;
  projectile.travelled += distance;
  if (projectile.travelled >= projectile.maxDistance - 1e-9) {
    ctx.emit({
      type: 'projectileImpact',
      trajectoryId: projectile.trajectoryId,
      x: projectile.x,
      z: projectile.z,
      reason: 'range',
    });
    projectile.fizzle?.();
    return false;
  }
  return true;
}

/** Advance every in-flight projectile one tick toward its live target, in launch order
 *  (reordering IS drift), resolving the ones that arrive. A bolt that chases past
 *  PROJECTILE_MAX_FLIGHT without catching the target lands by force at the deadline: once
 *  released, a projectile cannot be escaped by outrunning it (the only escape is being out
 *  of cast range when it fires, gated at the launch sites). A bolt fizzles (resolves to
 *  nothing) ONLY when its caster or target has died or despawned mid-flight, so no damage,
 *  threat, or kill credit ever lands on a corpse. */
export function advancePendingProjectiles(ctx: SimContext): void {
  if (ctx.pendingProjectiles.length === 0) return;
  const step = PROJECTILE_SPEED * DT;
  const launchedBeforeTick = ctx.pendingProjectiles;
  ctx.pendingProjectiles = [];
  const stillFlying: PendingProjectile[] = [];
  for (const proj of launchedBeforeTick) {
    const source = ctx.entities.get(proj.sourceId);
    if (proj.kind === 'ballistic') {
      if (!source) {
        ctx.emit({
          type: 'projectileImpact',
          trajectoryId: proj.trajectoryId,
          x: proj.x,
          z: proj.z,
          reason: 'sourceDespawn',
        });
        proj.fizzle?.();
        continue;
      }
      if (advanceBallisticProjectile(ctx, proj, source)) stillFlying.push(proj);
      continue;
    }
    const target = ctx.entities.get(proj.targetId);
    if (!source || source.dead || !target || target.dead) {
      proj.fizzle?.();
      continue;
    }
    const next = stepProjectile(proj.x, proj.z, target.pos.x, target.pos.z, step);
    if (next.hit) {
      proj.resolve(source, target);
      continue;
    }
    proj.ttl -= DT;
    if (proj.ttl <= 0) {
      // A released projectile cannot be escaped: a target faster than the bolt can never
      // be physically caught, so at the flight deadline the bolt lands anyway rather than
      // giving up. The only way to avoid a projectile is to be out of cast range when it
      // FIRES (gated at every launch site), not to outrun it after launch.
      proj.resolve(source, target);
      continue;
    }
    proj.x = next.x;
    proj.z = next.z;
    stillFlying.push(proj);
  }
  ctx.pendingProjectiles = [...stillFlying, ...ctx.pendingProjectiles];
}
