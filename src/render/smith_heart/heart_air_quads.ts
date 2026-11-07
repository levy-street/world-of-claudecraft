// The Smith's Heart's air systems' one geometry (the Hammer's, the Breath's
// and the Quench's air): merged quads drawn in one draw, each built in view
// space by its vertex shader from a corner, the quad's base point, its
// params and (a segment's) far end. No per-frame CPU: every motion runs in
// the shaders on the shared clock.

import * as THREE from 'three';

const QUAD = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

export type HeartAirV3 = readonly [number, number, number];
export type HeartAirV4 = readonly [number, number, number, number];

/** Merged quads: per vertex a corner (`aCorner`), the quad's base point
 *  (`position`, so three's bounds see the system's extent), its params
 *  (`aParams`) and, when given, a second point (`aOther`: a segment's far
 *  end). */
export function heartQuadGeometry(
  bases: readonly HeartAirV3[],
  params: readonly HeartAirV4[],
  others?: readonly HeartAirV3[],
): THREE.BufferGeometry {
  const n = bases.length;
  const corner = new Float32Array(n * 8);
  const base = new Float32Array(n * 12);
  const other = others ? new Float32Array(n * 12) : null;
  const prm = new Float32Array(n * 16);
  const idx = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    for (let v = 0; v < 4; v++) {
      corner.set(QUAD[v], (i * 4 + v) * 2);
      base.set(bases[i], (i * 4 + v) * 3);
      if (other && others) other.set(others[i], (i * 4 + v) * 3);
      prm.set(params[i], (i * 4 + v) * 4);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  if (other) g.setAttribute('aOther', new THREE.BufferAttribute(other, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aParams', new THREE.BufferAttribute(prm, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
