// Landing and scuff dust, tinted by the surface the body came down on.
//
// Lifted out of renderer.ts, which is a named monolith under the line-count
// ratchet (root CLAUDE.md, Modularity). It holds no coordinator state: it needs
// the particle pool, a surface lookup, and somewhere to put a vector.

import * as THREE from 'three';
import type { Surface } from './audio_sink';
import type { Vfx } from './vfx';

/** Dust colour per surface. Water swallows a puff, so it emits nothing. */
const PUFF_COLOR: Partial<Record<Surface, number>> = {
  stone: 0x9b9a95,
  wood: 0xa8895f,
  snow: 0xe6eef5,
  dirt: 0xa38257,
};
const PUFF_COLOR_DEFAULT = 0x8d9a63;
/** Below this the puff is invisible anyway, so it is not spawned. */
const MIN_POWER = 0.02;

/** Reused per call: this runs on landings and ledge scuffs, per body. */
const tmp = new THREE.Vector3();

export function emitGroundPuff(
  vfx: Vfx,
  surfaceAt: (x: number, z: number, y: number) => Surface,
  x: number,
  y: number,
  z: number,
  power: number,
): void {
  const p = Math.min(1, power);
  if (p <= MIN_POWER) return;
  const surface = surfaceAt(x, z, y);
  if (surface === 'water') return;
  tmp.set(x, y, z);
  vfx.groundPuff(tmp, p, PUFF_COLOR[surface] ?? PUFF_COLOR_DEFAULT);
}
