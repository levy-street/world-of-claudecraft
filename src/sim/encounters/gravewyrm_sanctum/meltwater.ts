// The Ritual Vault's meltwater (docs/design/dungeon-rework/gravewyrm_sanctum.md
// section 6.2, G24 on G10 zones): the floor is cold lake ice (safe) except
// where it is water: the three thaw pools round the pyres, the strips a
// Soulfire Trench melts for 20 s, and on heroic the puddles a still Bonewalker
// melts under itself. A Bonewalker that dies in meltwater is Unquenched (it
// rises again); one that dies on cold ice is Held. Pure geometry, world
// coordinates, zero rng, Three-free: the renderer paints the same shapes.

import { inLane } from '../../mob/trash_kit/lane';

export interface MeltCircle {
  x: number;
  z: number;
  r: number;
}

export interface MeltStrip {
  /** The strip's start, its yaw (sim convention: 0 = +z) and its length. */
  x: number;
  z: number;
  yaw: number;
  length: number;
}

export interface MeltZones {
  pools: readonly MeltCircle[];
  strips: readonly MeltStrip[];
  puddles: readonly MeltCircle[];
  /** A strip's full width (yards). */
  stripWidth: number;
}

/** Is (px, pz) standing in meltwater? */
export function inMeltwater(zones: MeltZones, px: number, pz: number): boolean {
  for (const c of zones.pools) if (Math.hypot(px - c.x, pz - c.z) <= c.r) return true;
  for (const c of zones.puddles) if (Math.hypot(px - c.x, pz - c.z) <= c.r) return true;
  const half = zones.stripWidth / 2;
  for (const s of zones.strips) if (inLane(s.x, s.z, s.yaw, s.length, half, px, pz)) return true;
  return false;
}

/** How far a ray from (x, z) along `yaw` runs before it leaves the circle
 *  (the vault's rim), at most `max`. A start outside the circle gives 0. */
export function rayToRim(x: number, z: number, yaw: number, rim: MeltCircle, max: number): number {
  const ax = Math.sin(yaw);
  const az = Math.cos(yaw);
  const dx = x - rim.x;
  const dz = z - rim.z;
  const c = dx * dx + dz * dz - rim.r * rim.r;
  if (c > 0) return 0;
  const b = dx * ax + dz * az;
  const t = -b + Math.sqrt(Math.max(0, b * b - c));
  return Math.max(0, Math.min(max, t));
}
