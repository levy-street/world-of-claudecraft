// Climbable ladders. An asset authors them in its collision override (the
// Blender build's sidecar `ladders`, installed by
// scripts/assets/deepglass/install_authored.mjs): each is a flat rung face with
// an outward normal (the side a climber hangs on), a half width, and the floor
// it stands on / the floor its top steps off onto.
//
// A body that walks INTO a ladder latches on and climbs, CS2-style: W goes up,
// or down while the view is aimed down (the same camera dive band swimming
// reads, `inp.dive`); S goes down; strafing slides along the rungs; jump lets
// go and pushes off. No gravity and no fall damage while on it. It steps off
// at the top onto that floor (over the top edge when the floor is behind the
// rungs) and at the bottom onto the ground. The renderer plays the floating
// tread pose for a climber (renderer.ts reads `climbing` into the anim state).

import { authoredLaddersForPath } from './asset_collision';
import { getActiveWorldContent } from './data';
import type { Entity, MoveInput, WorldContent } from './types';
import { groundHeightNear, terrainHeight } from './world';

/** One authored ladder in an asset's model frame (glTF x, z; y up from the
 *  model base). The rung face stands at (x, z); `ry` yaws its outward normal
 *  off the model's +X (three.js rotation.y convention); `hw` is half the rung
 *  width; y0/y1 the floor under it and the floor its top steps off onto. */
export interface AuthoredLadder {
  x: number;
  z: number;
  ry?: number;
  hw: number;
  y0: number;
  y1: number;
}

interface WorldLadder {
  fx: number; // rung face centre
  fz: number;
  nx: number; // outward normal (toward the climber)
  nz: number;
  hw: number;
  y0: number;
  y1: number;
}

/** Vertical climb rate, yd/s. */
export const CLIMB_SPEED = 3.4;
/** Sideways slide along the rungs, yd/s. */
const SIDE_SPEED = 1.6;
/** Where a climber's centre hangs: a body radius off the rung face. */
const STANCE = 0.56;
/** How far out from the face a body still grabs the ladder. */
const REACH = 1.1;
/** Past this much beyond a side rail the climber has slid off. */
const SIDE_SLACK = 0.35;
/** How squarely a body must face the rungs to grab them (cos 60 deg). */
const FACE_MIN = 0.5;

const cache = new WeakMap<WorldContent, Map<number, WorldLadder[]>>();

/** Drop the cached ladder list for `content` (placements changed). */
export function invalidateLadders(content: WorldContent): void {
  cache.delete(content);
}

function laddersFor(content: WorldContent, seed: number): WorldLadder[] {
  let bySeed = cache.get(content);
  if (!bySeed) {
    bySeed = new Map();
    cache.set(content, bySeed);
  }
  let out = bySeed.get(seed);
  if (out) return out;
  out = [];
  for (const p of content.placements ?? []) {
    // Collision off is a real choice: no ladder to climb either.
    if (!p.collideRadius || p.collideRadius <= 0) continue;
    const authored = authoredLaddersForPath(p.path);
    if (authored.length === 0) continue;
    const s = p.scale > 0 ? p.scale : 1;
    const sx = s * (p.scaleX ?? 1);
    const sy = s * (p.scaleY ?? 1);
    const sz = s * (p.scaleZ ?? 1);
    const base = (p.detached ? (p.groundY ?? 0) : terrainHeight(p.x, p.z, seed)) + (p.y ?? 0);
    const c = Math.cos(p.rotY);
    const sn = Math.sin(p.rotY);
    for (const l of authored) {
      const lx = l.x * sx;
      const lz = l.z * sz;
      const a = p.rotY + (l.ry ?? 0);
      out.push({
        fx: p.x + lx * c + lz * sn,
        fz: p.z - lx * sn + lz * c,
        nx: Math.cos(a),
        nz: -Math.sin(a),
        hw: l.hw * s,
        y0: base + l.y0 * sy,
        y1: base + l.y1 * sy,
      });
    }
  }
  bySeed.set(seed, out);
  return out;
}

interface Hold {
  l: WorldLadder;
  u: number; // along the rungs (tangent = normal turned +90 deg)
}

/** The ladder a body at (x, z) with its feet at `feetY` can hold, or null. */
function ladderNear(seed: number, x: number, z: number, feetY: number): Hold | null {
  let best: Hold | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const l of laddersFor(getActiveWorldContent(), seed)) {
    if (feetY < l.y0 - 0.6 || feetY > l.y1 + 0.35) continue;
    const dx = x - l.fx;
    const dz = z - l.fz;
    const d = dx * l.nx + dz * l.nz;
    if (d < -0.2 || d > REACH) continue;
    const u = -dx * l.nz + dz * l.nx;
    if (Math.abs(u) > l.hw + SIDE_SLACK) continue;
    if (d < bestD) {
      bestD = d;
      best = { l, u };
    }
  }
  return best;
}

function hang(p: Entity, l: WorldLadder, u: number): void {
  p.pos.x = l.fx + l.nx * STANCE - l.nz * u;
  p.pos.z = l.fz + l.nz * STANCE + l.nx * u;
}

function letGo(p: Entity, l: WorldLadder, pushOff: boolean, jumpVelocity: number): void {
  p.climbing = false;
  p.onGround = false;
  p.fallStartY = p.pos.y;
  if (pushOff) {
    p.vx = l.nx * 3.2;
    p.vz = l.nz * 3.2;
    p.vy = jumpVelocity * 0.55;
    p.jumping = true;
  } else {
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
    p.jumping = false;
  }
}

/**
 * The ladder half of a movement tick. Returns true when a ladder owns the
 * body this tick (it latched on, climbed, or pushed off), false to leave the
 * tick to the normal ground/swim pipeline. `canClimb` is the caller's gate
 * (alive, not rooted, stunned, mounted or swimming).
 */
export function stepLadder(
  seed: number,
  p: Entity,
  inp: MoveInput,
  canClimb: boolean,
  dt: number,
  jumpVelocity: number,
): boolean {
  const hold = ladderNear(seed, p.pos.x, p.pos.z, p.pos.y);
  if (p.climbing) {
    if (!hold || !canClimb) {
      if (hold) letGo(p, hold.l, false, jumpVelocity);
      else p.climbing = false;
      return false;
    }
    if (inp.jump) {
      letGo(p, hold.l, true, jumpVelocity);
      return true;
    }
    return climb(seed, p, hold, inp, dt);
  }
  if (!hold || !canClimb || !inp.forward) return false;
  // A body in the middle of its own jump never re-grabs the rungs it just
  // pushed off; walking onto them, or falling past them, does.
  if (!p.onGround && p.jumping) return false;
  const { l } = hold;
  const facing = -(Math.sin(p.facing) * l.nx + Math.cos(p.facing) * l.nz);
  if (facing < FACE_MIN) return false;
  // At the top, only a body aimed DOWN the ladder takes it (the other way is
  // walking past the hatch).
  if (p.pos.y >= l.y1 - 0.2 && !inp.dive) return false;
  p.climbing = true;
  p.facing = Math.atan2(-l.nx, -l.nz);
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.jumping = false;
  return climb(seed, p, hold, inp, dt);
}

function climb(seed: number, p: Entity, hold: Hold, inp: MoveInput, dt: number): boolean {
  const { l } = hold;
  // S always goes down, as does the dive key or a view aimed down; W (or the
  // look-up band) goes up otherwise. `surface` is the camera's level-or-up
  // band, set whenever a move key is held with the view that high, so it must
  // never outvote S.
  const down = inp.back || (inp.dive && !inp.surface);
  const up = !down && (inp.forward || inp.surface);
  const vy = up ? CLIMB_SPEED : down ? -CLIMB_SPEED : 0;
  // Screen-right for a body facing the rungs is (-cos f, sin f); along the
  // tangent (-nz, nx) that is the sign of the strafe.
  const strafe = (inp.strafeRight ? 1 : 0) - (inp.strafeLeft ? 1 : 0);
  const rightU = -Math.cos(p.facing) * -l.nz + Math.sin(p.facing) * l.nx;
  const u = hold.u + strafe * Math.sign(rightU || 1) * SIDE_SPEED * dt;
  if (Math.abs(u) > l.hw + SIDE_SLACK * 0.5) {
    letGo(p, l, false, 0);
    return false;
  }
  let y = p.pos.y + vy * dt;
  p.climbing = true;
  p.onGround = true;
  p.jumping = false;
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  if (y >= l.y1) {
    // Topped out: onto the top floor where the climber hangs (a hatch in a
    // platform), else over the top edge onto the floor behind the rungs.
    y = l.y1;
    hang(p, l, Math.max(-l.hw, Math.min(l.hw, u)));
    if (groundHeightNear(p.pos.x, p.pos.z, seed, y) < y - 0.3) {
      p.pos.x -= l.nx * (STANCE + 0.7);
      p.pos.z -= l.nz * (STANCE + 0.7);
    }
    p.pos.y = y;
    p.fallStartY = y;
    p.climbing = false;
    return true;
  }
  if (y <= l.y0) {
    y = l.y0;
    if (down) {
      hang(p, l, Math.max(-l.hw, Math.min(l.hw, u)));
      p.pos.y = y;
      p.fallStartY = y;
      p.climbing = false;
      return true;
    }
  }
  hang(p, l, u);
  p.pos.y = y;
  p.fallStartY = y;
  return true;
}
