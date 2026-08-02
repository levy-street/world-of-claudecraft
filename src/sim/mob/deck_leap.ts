// Deck-to-deck leaping (MobTemplate.deckLeap): the parkour half of a rift
// course's bestiary, descended from the Blackspan Galleries' vaulters.
//
// Mobs have no vertical integrator: in a rift their y is an absolute set from
// the floor lift each tick, so a course sentry cannot follow a climber at
// all, and the course would be a safe gallery. A leaper crosses instead: when
// its live target stands on a different tier, or across a gap with no deck
// between, it arcs there and lands hunting. Landing on the ROOM FLOOR is
// legal and desirable: a vaulter dropping off its deck onto a runner below
// is the mechanic at its best.
//
// Two invariants make an arc safe on a body with no physics:
//
//   1. A leap in flight OWNS the mob's movement. The rift lift pass and the
//      locomotion dispatcher both yield while `mobLeap` is set, or the body
//      would be snapped back to a floor mid-arc.
//   2. A leap ALWAYS completes, through stun, root, and death. A mob killed
//      mid-arc finishes on its landing, so the corpse is lootable.
//
// Determinism: zero rng in any branch. Landing selection is a fixed scan,
// the arc is closed form in elapsed time, and the module is inert for any
// template without `deckLeap`.

import { DUNGEON_FLOOR_Y, MOBS } from '../data';
import { riftCourseRegionAt, riftCourseSupportY } from '../rift/course_runtime';
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity, steadyAngleTo } from '../types';

const SCAN_STEP = 0.7;
const MIN_LEAP = 2.2;
const LANDING_RADIUS = 0.5;
const FLIGHT_PER_YARD = 0.045;
const FLIGHT_BASE = 0.3;
const FLIGHT_MIN = 0.36;
const FLIGHT_MAX = 1.05;
/** Height difference that reads as "a different tier": below it the walker
 *  is fine and a leap would be a pathfinding tic. */
const TIER_SPLIT = 1.2;

function arcApex(distance: number, rise: number): number {
  return 1.15 + Math.max(0, rise) * 0.4 + distance * 0.055;
}

function flightDuration(distance: number): number {
  return Math.min(FLIGHT_MAX, Math.max(FLIGHT_MIN, FLIGHT_BASE + distance * FLIGHT_PER_YARD));
}

/** The standing height at a world point for a body reaching from `fromY`:
 *  the best course deck within rise reach, else the room floor. */
function standHeightAt(ctx: SimContext, x: number, z: number, fromY: number, rise: number): number {
  const deck = riftCourseSupportY(ctx.riftCollisionToken, x, z, fromY + rise);
  return deck > Number.NEGATIVE_INFINITY ? deck : DUNGEON_FLOOR_Y;
}

/**
 * Choose the landing for a leap toward `target`, or null when the walker is
 * fine: same tier, and continuous standing all the way there.
 */
function chooseLanding(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  spec: { range: number; rise: number },
): { x: number; y: number; z: number } | null {
  const dx = target.pos.x - mob.pos.x;
  const dz = target.pos.z - mob.pos.z;
  const toTarget = Math.hypot(dx, dz);
  if (toTarget < MIN_LEAP || toTarget > spec.range) return null;

  const targetStand = standHeightAt(ctx, target.pos.x, target.pos.z, mob.pos.y, spec.rise);
  if (targetStand > mob.pos.y + spec.rise + 0.2) return null; // beyond the arc
  const tierSplit = Math.abs(targetStand - mob.pos.y) > TIER_SPLIT;

  // Walkability probe: is there continuous standing at the MOB's tier along
  // the line? A break means a gap only an arc crosses.
  let broken = false;
  const ux = dx / toTarget;
  const uz = dz / toTarget;
  for (let d = SCAN_STEP; d < toTarget; d += SCAN_STEP) {
    const stand = standHeightAt(ctx, mob.pos.x + ux * d, mob.pos.z + uz * d, mob.pos.y, spec.rise);
    if (Math.abs(stand - mob.pos.y) > 1.0) {
      broken = true;
      break;
    }
  }
  if (!tierSplit && !broken) return null; // a walk, not a leap

  // Land beside the target, on whatever holds a body there.
  const backX = target.pos.x - ux * 0.9;
  const backZ = target.pos.z - uz * 0.9;
  const resolved = ctx.resolveMovePoint(backX, backZ, LANDING_RADIUS, mob);
  if (Math.hypot(resolved.x - backX, resolved.z - backZ) > LANDING_RADIUS * 0.5) return null;
  return {
    x: backX,
    z: backZ,
    y: standHeightAt(ctx, backX, backZ, mob.pos.y, spec.rise),
  };
}

/** Trigger check, called once per engaged tick from the locomotion hook
 *  beside the charge trigger. Inert outside a course region. */
export function tryDeckLeap(ctx: SimContext, mob: Entity): void {
  const spec = MOBS[mob.templateId]?.deckLeap;
  if (!spec) return;
  if (mob.mobLeap) return;
  if ((mob.mobLeapReadyAt ?? 0) > ctx.time) return;
  if (!mob.inCombat) return;
  if (ctx.isStunned(mob) || ctx.isRooted(mob)) return;
  if (!riftCourseRegionAt(ctx.riftCollisionToken, mob.pos.x, mob.pos.z)) return;
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) return;
  const landing = chooseLanding(ctx, mob, target, spec);
  if (!landing) return;

  const distance = dist2d(mob.pos, landing);
  mob.mobLeap = {
    fromX: mob.pos.x,
    fromY: mob.pos.y,
    fromZ: mob.pos.z,
    toX: landing.x,
    toY: landing.y,
    toZ: landing.z,
    elapsed: 0,
    duration: flightDuration(distance),
    apex: arcApex(distance, landing.y - mob.pos.y),
  };
  mob.mobLeapReadyAt = ctx.time + spec.cooldown;
  mob.facing = steadyAngleTo(mob.pos, landing, mob.facing);
  mob.onGround = false;
  ctx.emit({ type: 'mobLeap', entityId: mob.id, x: landing.x, y: landing.y, z: landing.z });
}

/**
 * Advance an arc in flight. Returns true while the leap owns the mob's
 * movement this tick (the locomotion dispatcher and the rift lift pass both
 * yield on it). `onGround` stays false for the whole arc: that is the one
 * field the wire and the jump animation read.
 */
export function updateDeckLeap(ctx: SimContext, mob: Entity): boolean {
  const flight = mob.mobLeap;
  if (!flight) return false;
  if (mob.dead) {
    landDeckLeap(mob);
    return false;
  }
  flight.elapsed += DT;
  const progress = Math.min(1, flight.elapsed / flight.duration);
  if (progress >= 1) {
    landDeckLeap(mob);
    const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
    if (target && !target.dead) mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    return true;
  }
  const baseY = flight.fromY + (flight.toY - flight.fromY) * progress;
  mob.pos.x = flight.fromX + (flight.toX - flight.fromX) * progress;
  mob.pos.z = flight.fromZ + (flight.toZ - flight.fromZ) * progress;
  mob.pos.y = baseY + flight.apex * 4 * progress * (1 - progress);
  mob.onGround = false;
  return true;
}

function landDeckLeap(mob: Entity): void {
  const flight = mob.mobLeap;
  if (!flight) return;
  mob.pos.x = flight.toX;
  mob.pos.y = flight.toY;
  mob.pos.z = flight.toZ;
  mob.mobLeap = null;
  mob.onGround = true;
}

/** Evade-home / respawn / death reset: an in-flight arc is finished first
 *  (there is nowhere else to put the body), then the cooldown clears. */
export function resetDeckLeap(mob: Entity): void {
  landDeckLeap(mob);
  mob.mobLeapReadyAt = 0;
}
