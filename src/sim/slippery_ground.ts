// Slippery ground: a player wearing the SLIPPERY_GROUND_AURA walks on ice.
// Their grounded movement keeps momentum (player_motion.ts stepPlayerMotion):
// the ground velocity steers toward what the keys ask for at only `grip` yards
// a second per second, so a run takes a moment to build, a stop slides on, and
// a turn swings wide. Speed never exceeds the ordinary run, so the server's
// step check never reads a slide as a teleport.
//
// The aura is the whole signal: an encounter puts it on whoever stands on its
// ice (the Lady of the Bonechill's Rime Path and frozen ravine, encounters/
// hollow_crypt), the wire mirrors it with every aura (value2 carries the grip),
// and the shared kernel steps the slide on every host. Online, the slide's
// ground velocity is state the reconcile wire does not carry, so the server
// counts the ice as a movement override (server/movement_override_epoch.ts):
// the client stands its prediction down on the ice and draws the authoritative
// slide, restarting cleanly when the player steps off.
//
// Pure: no SimContext, no rng.

import type { Entity } from './types';

/** The aura id the motion kernel keys on (its kind is a quiet 'slow' of 1). */
export const SLIPPERY_GROUND_AURA = 'slippery_ground';
/** Yards a second per second the ground velocity may change on ice when the
 *  aura names no grip (value2). */
export const SLIPPERY_DEFAULT_GRIP = 8;
/** A slide slower than this (yd/s) with no keys held stops dead. */
export const SLIPPERY_REST_SPEED = 0.15;

/** The grip of the ice under `e` (yd/s per second), or 0 off the ice. */
export function slipperyGrip(e: Pick<Entity, 'auras'>): number {
  for (const a of e.auras) {
    if (a.id !== SLIPPERY_GROUND_AURA) continue;
    const g = a.value2;
    return g !== undefined && g > 0 ? g : SLIPPERY_DEFAULT_GRIP;
  }
  return 0;
}

/**
 * One tick of the ground velocity on ice: (vx, vz) steered toward the wish
 * velocity (wx, wz) by at most `grip * dt`, as a vector, capped at `cap`.
 * With no wish it decays toward rest and stops dead under SLIPPERY_REST_SPEED.
 * Pure; writes into `out`.
 */
export function slideVelocity(
  vx: number,
  vz: number,
  wx: number,
  wz: number,
  grip: number,
  cap: number,
  dt: number,
  out: { x: number; z: number },
): void {
  let dvx = wx - vx;
  let dvz = wz - vz;
  const step = grip * dt;
  const d = Math.hypot(dvx, dvz);
  if (d > step && d > 1e-9) {
    dvx *= step / d;
    dvz *= step / d;
  }
  let nx = vx + dvx;
  let nz = vz + dvz;
  const speed = Math.hypot(nx, nz);
  if (speed > cap && speed > 1e-9) {
    nx *= cap / speed;
    nz *= cap / speed;
  }
  if (wx === 0 && wz === 0 && Math.hypot(nx, nz) < SLIPPERY_REST_SPEED) {
    nx = 0;
    nz = 0;
  }
  out.x = nx;
  out.z = nz;
}
