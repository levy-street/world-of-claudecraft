// Soft separation for engaged mobs: a pack fighting on one target reads as a
// tight cluster of bodies, never one blob standing inside itself.
//
// The owner's playtest (2026-10-04): "mobs can overlap one on top of another,
// they pile up". Mobs have no body collision with each other: every chaser
// walks the straight line to the same target and stops at the same desired
// range, so a pull of four or five lands them on the same few square feet.
// Asked for, on purpose, as SOFT: bodies may still overlap (up to about half
// their summed radii, SEPARATION_OVERLAP_ALLOWED), and a gentle push only
// spreads them out of each other; it is not a rigid ring, a slot system, or
// full collision.
//
// Rules (each one load-bearing):
// - Only an engaged mob (the chase/attack arm of mob/locomotion.ts, after its
//   combat profile ran) ever moves here, and only itself. Players and pets are
//   never pushed and never push; the encounter bodies never move (bosses,
//   minibosses, the great authored bodies, healers on their standoff: the
//   obstacle the others step round), nor does a mob planted for an area cast
//   (trash_kit/cast_hold.ts), rooted, pinned in place, or authored immobile.
// - Bigger bodies take more room: a mob's radius is its authored bodyRadius,
//   else its family's body (SEPARATION_FAMILY_RADIUS: a hound or a spider is
//   broader than a man) times its scale, and the push is shared by
//   radius so the small body gives way to the big one.
// - The push never carries a mob farther from its target than it already was,
//   or past its desired fighting range (mob_combat.ts): it slides the mob
//   ROUND its target, so reach, swings and damage are untouched.
// - Every step is swept against the static colliders (ctx.resolveMove) and
//   refused outright when the colliders would bend it, when the floor under it
//   would rise or fall more than SEPARATION_MAX_FLOOR_STEP (a ledge, a void
//   walkway's edge, a stair drop), when it climbs a cliff face moveToward
//   would refuse, or when it would wade a landlocked mob into deep water. A
//   refused push leaves the mob where it stood.
// - Zero rng, no new state: the push is a pure function of positions, radii
//   and ids (an exact stack splits along an id-hashed bearing), read through
//   the existing all-entity SpatialGrid: one small radius query per engaged
//   mob every SEPARATION_PERIOD_TICKS ticks (its turn set by its hashed id),
//   nothing per idle mob, and the ground probe only for a nudge worth taking.
//   A pack pressed against its fighting range (the clamp eats most of the
//   push) skips the futile nudge, so a blob that cannot spread settles.
// The pure core (separationRadius, addSeparation, clampSeparationStep,
// keepTargetDistance, separationPush) is host-agnostic and unit-tested in
// tests/mob_separation.test.ts; separateEngagedMob is the thin sim consumer.

import { MOBS } from '../data';
import { isPinnedInPlace } from '../instances/instance_combat_hold';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
import { swimSurfaceY } from '../player_motion';
import type { SimContext } from '../sim_context';
import { DT, type Entity, type MobTemplate } from '../types';
import { groundHeight, nearSteepWalls, terrainSteepnessAt, waterLevelAt } from '../world';
import { mobCombatProfile } from './combat_profile';

/** A man-sized mob body at scale 1 (yards): a touch broader than a player's
 *  0.5, since a mob carries its weapon and its shoulders wide. */
export const SEPARATION_BASE_RADIUS = 0.7;
/** The families whose bodies are broader than a man's at scale 1 (yards):
 *  four-legged and many-legged bodies, and the bulky ones. A presentation
 *  knob for how much room a body takes, never a combat value. */
export const SEPARATION_FAMILY_RADIUS: Readonly<Record<string, number>> = Object.freeze({
  beast: 1.1,
  spider: 1.1,
  burrower: 1.1,
  reptile: 1.1,
  dragonkin: 1,
  ogre: 1,
  elemental: 0.9,
});
/** The widest body the separation will make room for (yards). */
export const SEPARATION_MAX_RADIUS = 5;
/** Bodies may overlap by up to this fraction of their summed radii before the
 *  push starts: the centres never get pushed apart past (1 - this) x the sum. */
export const SEPARATION_OVERLAP_ALLOWED = 0.5;
/** Each mob looks for overlaps once every this many ticks (its phase set by
 *  its id, so a pack's members take turns): the hot-path cost is a quarter of
 *  a per-tick pass, and a settling nudge does not need 20 Hz. */
export const SEPARATION_PERIOD_TICKS = 4;
/** Fraction of the remaining penetration a mob closes per look (a soft
 *  spring: an exact stack of five spreads in about a second). */
export const SEPARATION_GAIN = 0.8;
/** Fastest a mob is ever nudged sideways (yards per second, averaged over a
 *  period): well under a walk, so the spread reads as bodies settling. */
export const SEPARATION_MAX_SPEED = 1.5;
/** Largest single nudge (yards): one period at the speed cap. */
export const SEPARATION_MAX_STEP = SEPARATION_MAX_SPEED * DT * SEPARATION_PERIOD_TICKS;
/** A nudge shorter than this is not worth a ground probe, nor a fresh
 *  snapshot record for every viewer (yards). */
export const SEPARATION_MIN_STEP = 0.05;
/** A pack pressed against its fighting range cannot spread any further: when
 *  the range clamp eats more than this fraction of the push, the nudge is
 *  futile and skipped, so a pinned blob settles instead of jittering. */
const SEPARATION_FUTILE_FRACTION = 0.5;
/** Highest floor rise or drop a single nudge may cross (yards). */
export const SEPARATION_MAX_FLOOR_STEP = 0.4;
/** Two bodies further apart than this vertically do not touch (a flier
 *  overhead, a rampart over a courtyard). */
const SEPARATION_VERTICAL_GAP = 2.5;
/** A mob this far above the floor under it is airborne and never nudged. */
const AIRBORNE_CLEARANCE = 1.5;

/** A body in the ground plane. */
export interface SeparationBody {
  id: number;
  x: number;
  z: number;
  radius: number;
}

/** The accumulated nudge for one mob this tick (yards). */
export interface SeparationStep {
  x: number;
  z: number;
}

/** A mob's separation radius: the authored body (MobTemplate.bodyRadius) when
 *  it has one, else its family's body (or the base body) scaled by its render
 *  scale, capped. */
export function separationRadius(
  bodyRadius: number | undefined,
  scale: number,
  family?: string,
): number {
  const base = (family !== undefined && SEPARATION_FAMILY_RADIUS[family]) || SEPARATION_BASE_RADIUS;
  const r = bodyRadius ?? base * (scale > 0 ? scale : 1);
  return Math.min(SEPARATION_MAX_RADIUS, Math.max(0.1, r));
}

/** How close two bodies may stand before the push starts (centre to centre). */
export function separationMinDistance(a: number, b: number): number {
  return (a + b) * (1 - SEPARATION_OVERLAP_ALLOWED);
}

/** The search radius that finds every neighbour a body of radius `r` can
 *  overlap past the allowance. */
export function separationQueryRadius(r: number): number {
  return separationMinDistance(r, SEPARATION_MAX_RADIUS);
}

/** A stable bearing for two bodies on the exact same spot: hashed from the
 *  pair's ids, and opposite for the two of them, so they split apart. */
function stackBearing(selfId: number, otherId: number): number {
  const lo = Math.min(selfId, otherId);
  const hi = Math.max(selfId, otherId);
  const h = Math.imul(lo ^ Math.imul(hi, 0x9e3779b1), 0x85ebca6b) >>> 0;
  const angle = (h / 4294967296) * Math.PI * 2;
  return selfId < otherId ? angle : angle + Math.PI;
}

/**
 * Add `other`'s push on `self` to `step`. `otherYields` says whether the other
 * body moves too (another engaged mob): then each takes its share by radius
 * (the small one gives way to the big one); a body that never moves (a boss, a
 * planted caster) leaves the whole of it to `self`.
 */
export function addSeparation(
  step: SeparationStep,
  self: SeparationBody,
  other: SeparationBody,
  otherYields: boolean,
): void {
  const min = separationMinDistance(self.radius, other.radius);
  let dx = self.x - other.x;
  let dz = self.z - other.z;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return;
  const d = Math.sqrt(d2);
  if (d < 1e-4) {
    const a = stackBearing(self.id, other.id);
    dx = Math.sin(a);
    dz = Math.cos(a);
  } else {
    dx /= d;
    dz /= d;
  }
  const share = otherYields ? other.radius / (self.radius + other.radius) : 1;
  const push = (min - d) * share * SEPARATION_GAIN;
  step.x += dx * push;
  step.z += dz * push;
}

/** Cap the summed nudge at `maxStep` (SEPARATION_MAX_STEP in the sim). */
export function clampSeparationStep(step: SeparationStep, maxStep: number): void {
  const len = Math.hypot(step.x, step.z);
  if (len <= maxStep || len === 0) return;
  step.x *= maxStep / len;
  step.z *= maxStep / len;
}

/**
 * Keep a nudged point (x, z) from drifting away from the target at (tx, tz):
 * it may sit no farther than max(the distance it stood at, `keep`), so the
 * push slides the mob round its target instead of out of its reach. Returns
 * the (possibly pulled-in) point.
 */
export function keepTargetDistance(
  x: number,
  z: number,
  tx: number,
  tz: number,
  stoodAt: number,
  keep: number,
): SeparationStep {
  const limit = Math.max(stoodAt, keep);
  const dx = x - tx;
  const dz = z - tz;
  const d = Math.hypot(dx, dz);
  if (d <= limit || d === 0) return { x, z };
  return { x: tx + (dx / d) * limit, z: tz + (dz / d) * limit };
}

/** The whole pure push for one body among its neighbours (tests; the sim
 *  consumer accumulates the same way straight off the grid walk). */
export function separationPush(
  self: SeparationBody,
  neighbours: readonly { body: SeparationBody; yields: boolean }[],
  maxStep = SEPARATION_MAX_STEP,
): SeparationStep {
  const step = { x: 0, z: 0 };
  for (const n of neighbours) {
    if (n.body.id !== self.id) addSeparation(step, self, n.body, n.yields);
  }
  clampSeparationStep(step, maxStep);
  return step;
}

/** Does this engaged mob give way to its neighbours (cheap fields only; the
 *  per-tick CC and hold checks run once, for the mob being moved)? */
function yieldsRoom(e: Entity, t: MobTemplate | undefined): boolean {
  if (e.aiState !== 'chase' && e.aiState !== 'attack') return false;
  if (e.moveSpeed <= 0) return false;
  if (e.castHold && e.castHold.castId === e.castingAbility) return false;
  // The encounter bodies hold their ground: bosses, minibosses (authored, a
  // dungeon spawn's stamped miniboss, a rift boss or miniboss), the great
  // bodies with an authored bodyRadius, mountain-sized phasers, and a healer
  // holding its standoff by its protectee. Everything else steps round them.
  if (e.dungeonSpawnMiniboss || e.riftMechanicSpacing !== undefined) return false;
  return !(
    t?.boss ||
    t?.worldBoss ||
    t?.bodyRadius !== undefined ||
    t?.phasesThroughObstacles ||
    t?.channelHeal
  );
}

/** Which of the SEPARATION_PERIOD_TICKS ticks is this mob's turn: its id
 *  mixed through a multiplicative hash, so a pack whose ids share a stride
 *  still spreads its turns across the period. */
export function separationTurn(id: number, tickCount: number): boolean {
  return ((Math.imul(id, 0x9e3779b1) >>> 0) + tickCount) % SEPARATION_PERIOD_TICKS === 0;
}

/** The floor a mob would stand on at (x, z), given the ground there: the same
 *  rule moveToward seats it by (a swimmer rides the surface over deep water). */
function floorOver(
  ctx: SimContext,
  x: number,
  z: number,
  ground: number,
  canSwim: boolean,
): number {
  const seed = ctx.cfg.seed;
  return canSwim && ground < waterLevelAt(x, z, seed) - PLAYER_SWIM_DEPTH
    ? swimSurfaceY(x, z, seed)
    : ground;
}

/**
 * One engaged tick's separation for `mob`, run by the chase/attack arm of
 * mob/locomotion.ts after the combat profile and the mechanics: nudge it out
 * of the bodies it stands inside, if it may move and the ground lets it.
 */
export function separateEngagedMob(ctx: SimContext, mob: Entity): void {
  if (!separationTurn(mob.id, ctx.tickCount)) return;
  const template = MOBS[mob.templateId];
  if (mob.dead || mob.ownerId !== null || !mob.hostile || !yieldsRoom(mob, template)) return;
  if (isPinnedInPlace(mob) || ctx.isRooted(mob)) return;
  const self: SeparationBody = {
    id: mob.id,
    x: mob.pos.x,
    z: mob.pos.z,
    radius: separationRadius(template?.bodyRadius, mob.scale, template?.family),
  };
  const step: SeparationStep = { x: 0, z: 0 };
  const y = mob.pos.y;
  // One scratch body for the whole walk: the hot path allocates nothing per
  // neighbour.
  const other: SeparationBody = { id: 0, x: 0, z: 0, radius: 0 };
  ctx.grid.forEachInRadius(self.x, self.z, separationQueryRadius(self.radius), (e) => {
    if (e === mob || e.kind !== 'mob' || e.dead || e.ownerId !== null || !e.hostile) return;
    if (Math.abs(e.pos.y - y) > SEPARATION_VERTICAL_GAP) return;
    other.id = e.id;
    other.x = e.pos.x;
    other.z = e.pos.z;
    const t = MOBS[e.templateId];
    other.radius = separationRadius(t?.bodyRadius, e.scale, t?.family);
    addSeparation(step, self, other, e.inCombat && yieldsRoom(e, t));
  });
  clampSeparationStep(step, SEPARATION_MAX_STEP);
  const pushed = Math.hypot(step.x, step.z);
  if (pushed < SEPARATION_MIN_STEP) return;

  let nx = self.x + step.x;
  let nz = self.z + step.z;
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : undefined;
  if (target && !target.dead) {
    const stoodAt = Math.hypot(self.x - target.pos.x, self.z - target.pos.z);
    const held = keepTargetDistance(
      nx,
      nz,
      target.pos.x,
      target.pos.z,
      stoodAt,
      mobCombatProfile(mob).desiredRange,
    );
    nx = held.x;
    nz = held.z;
  }
  const kept = Math.hypot(nx - self.x, nz - self.z);
  if (kept < SEPARATION_MIN_STEP || kept < pushed * SEPARATION_FUTILE_FRACTION) return;

  // The ground has the last word: a wall, a ledge, a void edge or deep water
  // refuses the whole nudge.
  const canSwim = ctx.mobCanSwim(template);
  const seed = ctx.cfg.seed;
  const floor0 = floorOver(ctx, self.x, self.z, groundHeight(self.x, self.z, seed), canSwim);
  if (y - floor0 > AIRBORNE_CLEARANCE) return;
  const ground1 = groundHeight(nx, nz, seed);
  if (!canSwim && ground1 < waterLevelAt(nx, nz, seed) - PLAYER_SWIM_DEPTH) return;
  const floor1 = floorOver(ctx, nx, nz, ground1, canSwim);
  if (Math.abs(floor1 - floor0) > SEPARATION_MAX_FLOOR_STEP) return;
  // The wall rule every mob step obeys (moveToward): no uphill step onto
  // ground too steep to climb, however short the step.
  if (
    floor1 > floor0 &&
    nearSteepWalls(nx, nz) &&
    terrainSteepnessAt(nx, nz, seed) > PLAYER_MAX_CLIMB_SLOPE
  )
    return;
  const swept = ctx.resolveMove(self.x, self.z, nx, nz, PLAYER_BODY_RADIUS, mob);
  if (Math.hypot(swept.x - nx, swept.z - nz) > 1e-3) return;
  mob.pos.x = nx;
  mob.pos.z = nz;
  mob.pos.y = y + (floor1 - floor0);
}
