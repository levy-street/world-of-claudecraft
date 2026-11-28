// The four vein grooves' light as one ribbon mesh, shared by the Masterless
// Strength's arrival (final_arrival_beam.ts: the light running down to it)
// and its death (final_death_fx.ts: its essence racing back down to the
// well). Two strips per groove, laid on the grooves' own polylines
// (final_arrival_core.ts `arrivalStreamPath`, ../smith_heart/
// heart_vein_groove_core.ts): the ribbon flat in the groove, then a low veil
// of light standing on its centreline (`aRise` 0 at its foot, 1 at its top;
// the ribbon's -1), so a groove's light still reads from the terrace, where
// the floor is seen almost edge on. Each vertex carries `aAlong` (0 at the
// altar to 1 at the well, by length), `aSide` (signed yards across the
// groove) and `aVein` (the groove's index); the shaders are the caller's.
//
// Built once (no per-frame allocation); its floor heights are laid once per
// slot (`layGrooveRibbon`).

import * as THREE from 'three';
import { type ArrivalStreamPath, arrivalStreamLift } from './final_arrival_core';

/** A ribbon's measures (yards). */
export interface GrooveRibbonSpec {
  /** The flat ribbon's half width at the altar and at the well. */
  half: number;
  halfEnd: number;
  /** How far it floats over the floor, clear of its paint. */
  lift: number;
  /** The veil's height. */
  veil: number;
}

export interface GrooveRibbon {
  readonly geometry: THREE.BufferGeometry;
  readonly position: THREE.BufferAttribute;
  /** Each vertex's height over the walk (the leap over the kerb). */
  readonly lift: Float32Array;
  /** The longest groove's length (yards; the shaders' yard scale). */
  readonly length: number;
}

export function buildGrooveRibbon(
  paths: readonly ArrivalStreamPath[],
  spec: GrooveRibbonSpec,
): GrooveRibbon {
  const pts = paths[0].x.length;
  const strip = paths.length * pts * 2;
  const n = strip * 2;
  const pos = new Float32Array(n * 3);
  const along = new Float32Array(n);
  const side = new Float32Array(n);
  const vein = new Float32Array(n);
  const rise = new Float32Array(n).fill(-1);
  const lift = new Float32Array(n);
  const index: number[] = [];
  let length = 0;
  paths.forEach((path, i) => {
    length = Math.max(length, path.length);
    for (let s = 0; s < pts; s++) {
      // Square to the run here (its neighbours' chord), in the plan.
      const a0 = Math.max(0, s - 1);
      const a1 = Math.min(pts - 1, s + 1);
      const tx = path.x[a1] - path.x[a0];
      const tz = path.z[a1] - path.z[a0];
      const tl = Math.hypot(tx, tz) || 1;
      const px = -tz / tl;
      const pz = tx / tl;
      const k = path.along[s] / path.length;
      const half = spec.half + (spec.halfEnd - spec.half) * k * k;
      for (let e = 0; e < 2; e++) {
        const j = (i * pts + s) * 2 + e;
        const sd = e === 0 ? -half : half;
        // Instance-local (the mesh stands at the slot's origin).
        pos[j * 3] = path.x[s] + px * sd;
        pos[j * 3 + 1] = spec.lift;
        lift[j] = spec.lift + arrivalStreamLift(path.r[s]);
        pos[j * 3 + 2] = path.z[s] + pz * sd;
        along[j] = k;
        side[j] = sd;
        vein[j] = i;
      }
      for (let e = 0; e < 2; e++) {
        const j = strip + (i * pts + s) * 2 + e;
        pos[j * 3] = path.x[s];
        pos[j * 3 + 1] = spec.lift;
        pos[j * 3 + 2] = path.z[s];
        lift[j] = spec.lift + arrivalStreamLift(path.r[s]) + e * spec.veil;
        along[j] = k;
        side[j] = 0;
        vein[j] = i;
        rise[j] = e;
      }
      if (s < pts - 1) {
        const a = (i * pts + s) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        const b = strip + a;
        index.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(pos, 3);
  geometry.setAttribute('position', position);
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geometry.setAttribute('aVein', new THREE.BufferAttribute(vein, 1));
  geometry.setAttribute('aRise', new THREE.BufferAttribute(rise, 1));
  geometry.setIndex(index);
  return { geometry, position, lift, length };
}

/** Lay the ribbon's floor heights for the slot at (ox, oz) (once a slot). */
export function layGrooveRibbon(
  r: GrooveRibbon,
  ox: number,
  oz: number,
  groundY: (x: number, z: number) => number,
): void {
  const a = r.position.array as Float32Array;
  for (let j = 0; j < a.length; j += 3)
    a[j + 1] = groundY(ox + a[j], oz + a[j + 2]) + r.lift[j / 3];
  r.position.needsUpdate = true;
}
