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

import type { SimContext } from './sim_context';
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
export type PendingProjectile = {
  x: number;
  z: number;
  sourceId: number;
  targetId: number;
  ttl: number; // seconds of flight remaining before the bolt gives up and fizzles
  resolve: (source: Entity, target: Entity) => void;
};

/** Queue a projectile launched now from `source` at `target`; `resolve` runs at the
 *  landing tick with the still-live source and target. The caller emits the
 *  `fx:'projectile'` visual itself (the renderer needs it immediately at launch). */
export function scheduleProjectile(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  resolve: (source: Entity, target: Entity) => void,
): void {
  ctx.pendingProjectiles.push({
    x: source.pos.x,
    z: source.pos.z,
    sourceId: source.id,
    targetId: target.id,
    ttl: PROJECTILE_MAX_FLIGHT,
    resolve,
  });
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
  const stillFlying: PendingProjectile[] = [];
  for (const proj of ctx.pendingProjectiles) {
    const source = ctx.entities.get(proj.sourceId);
    const target = ctx.entities.get(proj.targetId);
    if (!source || source.dead || !target || target.dead) continue; // fizzle
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
  ctx.pendingProjectiles = stillFlying;
}
