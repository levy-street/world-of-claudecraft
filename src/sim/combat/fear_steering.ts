// Feared-PLAYER wall guard. Fear runs a player on one fixed heading for its whole
// duration, so a heading pointed at a wall marches them into it. This steers that
// heading away: probe FEAR_WALL_LOOKAHEAD yards ahead and, if blocked, turn to the
// most open heading. Deterministic (probes the collider set via
// ctx.resolveMovePoint, which is seed-deterministic and applies the player's own
// mover height; draws no rng), so the parity draw order is untouched. The caller
// (Sim.updateFearMovement) applies it to players only, so feared-mob movement, and
// the parity draw order with it, stays byte-identical.
import { PLAYER_BODY_RADIUS } from '../pathfind';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';

export const FEAR_WALL_LOOKAHEAD = 2; // yards ahead to watch for a wall (turn late, near the wall)
const FEAR_WALL_PROBE_STEP = 1; // radius-0.5 probe discs are tangent at a 1yd step, so no gap along the ray
const FEAR_TURN_FAN = [
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 2,
  -Math.PI / 2,
  (3 * Math.PI) / 4,
  -(3 * Math.PI) / 4,
  Math.PI,
]; // headings to try (smallest turn first, ties broken by fan order) when blocked ahead

// Yards the entity can travel straight along `heading` before a wall, capped at
// FEAR_WALL_LOOKAHEAD. Mover-aware via ctx.resolveMovePoint, so a low prop the
// player steps over is not mistaken for a wall.
export function fearWallOpenDistance(ctx: SimContext, e: Entity, heading: number): number {
  const sinA = Math.sin(heading);
  const cosA = Math.cos(heading);
  for (let d = FEAR_WALL_PROBE_STEP; d <= FEAR_WALL_LOOKAHEAD; d += FEAR_WALL_PROBE_STEP) {
    const x = e.pos.x + sinA * d;
    const z = e.pos.z + cosA * d;
    const r = ctx.resolveMovePoint(x, z, PLAYER_BODY_RADIUS, e);
    if (Math.hypot(r.x - x, r.z - z) > 0.05) return d - FEAR_WALL_PROBE_STEP;
  }
  return FEAR_WALL_LOOKAHEAD;
}

// If the flee heading is clear for the lookahead, keep it; otherwise turn to the
// most open heading in FEAR_TURN_FAN (smallest turn first, ties by fan order). In
// a fully enclosed pocket (every candidate blocked no farther than the straight
// one) the original heading is kept, degrading gracefully to the pre-guard pin
// rather than jittering.
export function steerFearFromWalls(ctx: SimContext, e: Entity, heading: number): number {
  let bestOpen = fearWallOpenDistance(ctx, e, heading);
  if (bestOpen >= FEAR_WALL_LOOKAHEAD) return heading;
  let best = heading;
  for (const off of FEAR_TURN_FAN) {
    const open = fearWallOpenDistance(ctx, e, heading + off);
    if (open > bestOpen) {
      bestOpen = open;
      best = heading + off;
    }
  }
  return best;
}
