// The field ward: while Gourdlight Eve runs, the wildlife of Boar Meadow keeps out of Old
// Thatchgrin's pumpkin patch.
//
// The field (scarecrow_field.ts) shares the outskirts of the meadow's boar camp, and Mogger's
// den sits just past its rim, so without a ward their idle wander walks level-2 boars and
// Mogger through a fight tuned for a group. The ward is a keep-out disc round the field,
// applied ONLY to an idle, wild, out-of-encounter mob's wander:
//   - a wander target picked inside the disc is pushed out onto the rim along its radius;
//   - a target whose straight walk would cut across the disc (a boar on one side of the
//     field heading for the far side) is swapped for a short step round the rim toward
//     it, so the mob skirts the field instead of crossing it;
//   - an idle mob standing inside the disc with nowhere to go (a camp spawn that landed
//     there, a mob home from a leash) is given the rim point straight out as its target.
// A mob that is chasing, attacking, fleeing or walking home is never touched (a pull is a
// pull; the leash already brings it back), and nothing here runs outside the event, so
// Boar Meadow is byte-identical the rest of the year.
//
// Draws no rng and allocates no entity: it only rewrites `wanderTarget` (and the wander
// timeout a fresh target carries). That still shifts WHEN a warded mob's locomotion rolls
// its next wander pause, so while the event runs the meadow's draw timing differs from a
// closed event's; it stays deterministic (same seed and feed, same draws). Runs once a
// tick from updateScarecrow, after every mob has stepped, over one small grid window.

import {
  GOURDLIGHT_CROW_ID,
  STRAWLING_ID,
  SWELLING_GOURD_ID,
  THATCHGRIN_ID,
} from '../content/gourdlight_eve_scarecrow';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import {
  resolveScarecrowField,
  SCARECROW_FIELD_OPEN_RADIUS,
  SCARECROW_FIELD_RADIUS,
} from './scarecrow_field';

/** The ward's radius: the fight disc plus room for the boss's reach (yards). Inside the
 *  field's open radius, so the rim is always clear ground. */
export const SCARECROW_FIELD_WARD_RADIUS = SCARECROW_FIELD_RADIUS + 6;
/** How far past the rim a pushed target lands, so a mob settling on it stays outside. */
export const SCARECROW_FIELD_WARD_MARGIN = 1;
/** Mobs this far past the rim are checked too: a wander target is at most nine yards from
 *  its spawn, so a mob still walking toward one is caught well before it reaches the rim. */
const WARD_QUERY_PAD = 12;
/** The timeout a fresh idle wander target carries (mob/locomotion.ts uses the same). */
const WANDER_TIMEOUT = 30;

const ENCOUNTER_TEMPLATES: ReadonlySet<string> = new Set([
  THATCHGRIN_ID,
  STRAWLING_ID,
  GOURDLIGHT_CROW_ID,
  SWELLING_GOURD_ID,
]);

/** Whether the ward governs this entity: a live, idle, wild mob outside the encounter. */
export function wardedByScarecrowField(e: Entity): boolean {
  return (
    e.kind === 'mob' &&
    !e.dead &&
    e.ownerId === null &&
    !e.summonedAdd &&
    !e.inCombat &&
    e.aiState === 'idle' &&
    !ENCOUNTER_TEMPLATES.has(e.templateId)
  );
}

/**
 * Push one point out of the ward disc onto its rim (plus the margin). Returns false and
 * leaves `out` alone when the point is already outside. A point on the exact centre goes
 * along `fallbackX/Z` (the mob's own offset), else due +x.
 */
export function pushOutOfWard(
  cx: number,
  cz: number,
  x: number,
  z: number,
  fallbackX: number,
  fallbackZ: number,
  out: { x: number; z: number },
): boolean {
  const radius = SCARECROW_FIELD_WARD_RADIUS;
  let dx = x - cx;
  let dz = z - cz;
  let d = Math.hypot(dx, dz);
  if (d >= radius) return false;
  if (d < 1e-6) {
    dx = fallbackX - cx;
    dz = fallbackZ - cz;
    d = Math.hypot(dx, dz);
    if (d < 1e-6) {
      dx = 1;
      dz = 0;
      d = 1;
    }
  }
  const r = radius + SCARECROW_FIELD_WARD_MARGIN;
  out.x = cx + (dx / d) * r;
  out.z = cz + (dz / d) * r;
  return true;
}

/**
 * Whether the straight walk from (px, pz) to (tx, tz) passes inside the ward disc. The
 * walker itself standing inside is not a crossing (it is walking out).
 */
export function walkCrossesWard(
  cx: number,
  cz: number,
  px: number,
  pz: number,
  tx: number,
  tz: number,
): boolean {
  const radius = SCARECROW_FIELD_WARD_RADIUS;
  if (Math.hypot(px - cx, pz - cz) < radius) return false;
  const sx = tx - px;
  const sz = tz - pz;
  const len2 = sx * sx + sz * sz;
  const t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((cx - px) * sx + (cz - pz) * sz) / len2)) : 0;
  return Math.hypot(px + sx * t - cx, pz + sz * t - cz) < radius;
}

/**
 * The step round the rim that replaces a crossing walk: same distance from the centre as
 * the walker (never nearer than the rim plus margin), turned toward the target's bearing
 * by no more than the arc whose chord still clears the disc. Written into `out`.
 */
export function skirtWard(
  cx: number,
  cz: number,
  px: number,
  pz: number,
  tx: number,
  tz: number,
  out: { x: number; z: number },
): void {
  const radius = SCARECROW_FIELD_WARD_RADIUS;
  const rr = Math.max(Math.hypot(px - cx, pz - cz), radius + SCARECROW_FIELD_WARD_MARGIN);
  const from = Math.atan2(px - cx, pz - cz);
  const to = Math.atan2(tx - cx, tz - cz);
  let turn = to - from;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  // A chord between two points at rr, half-angle h, comes within rr cos h of the centre.
  const maxTurn = 2 * Math.acos(Math.min(1, (radius + 0.25) / rr));
  const step = Math.max(-maxTurn, Math.min(maxTurn, turn));
  out.x = cx + Math.sin(from + step) * rr;
  out.z = cz + Math.cos(from + step) * rr;
}

const scratch = { x: 0, z: 0 };

/** One tick of the ward. The caller has already checked that Gourdlight Eve is running. */
export function wardScarecrowField(ctx: SimContext): void {
  const field = resolveScarecrowField(ctx.cfg.seed);
  if (!field) return;
  const cx = field.x;
  const cz = field.z;
  ctx.grid.forEachInRadius(cx, cz, SCARECROW_FIELD_WARD_RADIUS + WARD_QUERY_PAD, (e) => {
    if (!wardedByScarecrowField(e)) return;
    const target = e.wanderTarget;
    if (target) {
      let tx = target.x;
      let tz = target.z;
      let moved = pushOutOfWard(cx, cz, tx, tz, e.pos.x, e.pos.z, scratch);
      if (moved) {
        tx = scratch.x;
        tz = scratch.z;
      }
      if (walkCrossesWard(cx, cz, e.pos.x, e.pos.z, tx, tz)) {
        skirtWard(cx, cz, e.pos.x, e.pos.z, tx, tz, scratch);
        tx = scratch.x;
        tz = scratch.z;
        moved = true;
      }
      if (moved) e.wanderTarget = ctx.groundPos(tx, tz);
      return;
    }
    if (pushOutOfWard(cx, cz, e.pos.x, e.pos.z, e.spawnPos.x, e.spawnPos.z, scratch)) {
      e.wanderTarget = ctx.groundPos(scratch.x, scratch.z);
      e.wanderTimer = WANDER_TIMEOUT;
    }
  });
}

// The ward must sit inside the field's open sky, or its rim could land in a tree.
if (SCARECROW_FIELD_WARD_RADIUS + SCARECROW_FIELD_WARD_MARGIN > SCARECROW_FIELD_OPEN_RADIUS) {
  throw new Error('scarecrow field ward reaches past the open radius');
}
