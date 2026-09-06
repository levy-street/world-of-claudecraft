// On-hit knockback: hurl `target` up to `distance` yards straight away from
// `source`. Instantaneous displacement (no aura) walked in small steps so it can
// be terrain-clamped exactly like a warrior charge, the shove stops at the last
// safe footing before deep water or a cliff rather than stranding the victim off
// the world. Each step is also collider-swept (resolveMove, the same walker uses)
// so a wall (an arena side wall in particular) stops the shove instead of letting
// it tunnel through in one coarse hop. Returns the yards actually moved (0 if
// blocked immediately).

import { seatGroundedAt } from './colliders';
import { isVeilboundMarchActive } from './combat/paladin_veilbound_state';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from './pathfind';
import { SKIN_WIDTH } from './physics';
import { rideSteepnessAt, stepWaterLevel } from './ride_height';
import type { SimContext } from './sim_context';
import type { Entity } from './types';
import { groundHeight, waterLevelAt } from './world';

const BODY_RADIUS = PLAYER_BODY_RADIUS;
const MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
const SWIM_DEPTH = PLAYER_SWIM_DEPTH;

export function applyKnockback(
  ctx: SimContext,
  source: Entity,
  target: Entity,
  distance: number,
): number {
  if (source.id !== target.id && ctx.isIceBlocked(target)) return 0;
  if (source.id !== target.id && isVeilboundMarchActive(target)) return 0;
  if (ctx.cfg.devCommands && ctx.players.get(target.id)?.devAnchored) return 0;
  // Knockback resistance (the caster tier-set 2-piece grants 100%) is applied
  // centrally here so no caller can bypass it: a fully-resisted shove moves 0 yards
  // and never displaces the victim, so a caster keeps casting through it.
  distance *= 1 - (target.knockbackResistance ?? 0);
  if (distance <= 0) return 0;
  let dx = target.pos.x - source.pos.x;
  let dz = target.pos.z - source.pos.z;
  let len = Math.hypot(dx, dz);
  if (len < 1e-4) {
    // exactly overlapping: shove along the mob's facing so the direction is stable
    dx = Math.sin(source.facing);
    dz = Math.cos(source.facing);
    len = 1;
  }
  const ux = dx / len,
    uz = dz / len;
  const STEP = 0.5;
  let moved = 0;
  let cx = target.pos.x,
    cz = target.pos.z;
  while (moved < distance) {
    const adv = Math.min(STEP, distance - moved);
    const nx = cx + ux * adv,
      nz = cz + uz * adv;
    const h1 = groundHeight(nx, nz, ctx.cfg.seed);
    if (h1 < waterLevelAt(nx, nz, ctx.cfg.seed) - SWIM_DEPTH) break; // would land in deep water
    // ridden-surface slopes (ride_height.ts): a submerged bed bump does not
    // stop a shove crossing shallow water. No shore step-out here: a forced
    // displacement conservatively stops at a bank face.
    const wls = stepWaterLevel(cx, cz, nx, nz, ctx.cfg.seed);
    const r0 = Math.max(groundHeight(cx, cz, ctx.cfg.seed), wls);
    const r1 = Math.max(h1, wls);
    if (
      r1 > r0 &&
      ((r1 - r0) / adv > MAX_CLIMB_SLOPE ||
        (h1 >= wls && rideSteepnessAt(nx, nz, ctx.cfg.seed) > MAX_CLIMB_SLOPE))
    ) {
      break; // would slam into a cliff
    }
    // resolveMove sweeps cx,cz -> nx,nz against static colliders (walls,
    // pillars, delve module bounds/doors) in small sub-steps, so a thin wall
    // stops the shove at its face instead of the coarse 0.5yd hop skipping
    // over it. Resolved with a SKIN_WIDTH-padded radius (the same contact
    // gap the open-world physics solver keeps, physics/sweep.ts) rather than
    // the bare body radius: an unpadded push-out lands the victim at EXACT
    // zero clearance against the wall, and the swept solver treats a body
    // sitting exactly tangent to a collider as blocked in every direction,
    // including straight away, so ordinary movement can no longer pull free.
    // Ordinary walking never produces that exact state itself (its own
    // slide already stops a skin short of contact); the shove is the one
    // path that lands on the boundary, so it is the one that must keep the
    // margin.
    const resolved = ctx.resolveMove(cx, cz, nx, nz, BODY_RADIUS + SKIN_WIDTH, target);
    const blocked = Math.hypot(resolved.x - nx, resolved.z - nz) > BODY_RADIUS * 0.25;
    cx = resolved.x;
    cz = resolved.z;
    moved += adv;
    if (blocked) break; // hit a wall: stop the shove here
  }
  if (moved <= 0) return 0;
  // Support-aware seat: a victim shoved along crate tops stays on them, and
  // one shoved through a passed-over prop footprint is nudged clear instead
  // of being embedded at terrain height inside it.
  const seat = seatGroundedAt(ctx.cfg.seed, cx, cz, BODY_RADIUS, target.pos.y);
  target.pos.x = seat.x;
  target.pos.z = seat.z;
  target.pos.y = seat.y;
  target.vy = 0;
  target.onGround = true;
  target.fallStartY = target.pos.y;
  return moved;
}
