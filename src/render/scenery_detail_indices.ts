import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { prepareSceneryBandGeometry, sceneryBandIndices } from './scenery_bands/geometry';
import { buildCanopyDetail } from './scenery_detail_canopy';
import { sceneryReduction } from './scenery_detail_core';
import { sceneryComponents } from './scenery_detail_topology';

export const scenerySimplifierReady = Promise.all([
  MeshoptSimplifier.ready,
  prepareSceneryBandGeometry(),
]);
export { releaseSceneryTopology, retainSceneryTopology } from './scenery_detail_topology';

/** One model/level per preparation unit, never called from a distance flip.
 * Standard simplification protects UV seams. Palm crowns allow seam collapse,
 * but never use sloppy clustering, which produced detached canopy fragments. */
export function buildSceneryDetailIndex(
  geometry: THREE.BufferGeometry,
  level: number,
  palm: boolean,
): THREE.BufferAttribute {
  if (level >= 3) {
    const triangles = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    const policy = sceneryReduction(level, triangles, palm);
    return new THREE.BufferAttribute(
      sceneryBandIndices(
        geometry,
        policy.triangles,
        level >= 4 ? 'coarse' : palm ? 'palm' : 'quality',
      ),
      1,
    );
  }
  const { positions, indices: base, components } = sceneryComponents(geometry);
  const policy = sceneryReduction(level, base.length / 3, palm);
  if (policy.triangles * 3 >= base.length) return new THREE.BufferAttribute(base, 1);
  const locks = new Uint8Array(positions.length / 3);
  // Keep the extremities of every connected surface. Otherwise thin fronds
  // can disappear altogether at coarse levels even with a small QEM error.
  for (const component of components)
    for (let axis = 0; axis < 3; axis++) {
      for (const sign of [-1, 1]) {
        let best = -Infinity,
          vertex = component.vertices[0];
        for (const i of component.vertices)
          if (positions[i * 3 + axis] * sign > best) {
            best = positions[i * 3 + axis] * sign;
            vertex = i;
          }
        locks[vertex] = 1;
      }
    }
  const [indices] = MeshoptSimplifier.simplifyWithAttributes(
    base,
    positions,
    3,
    new Float32Array(),
    0,
    [],
    locks,
    policy.triangles * 3,
    policy.error,
    palm ? ['Permissive'] : [],
  );
  return new THREE.BufferAttribute(indices.length ? indices : base, 1);
}

export function buildSceneryDetail(
  geometry: THREE.BufferGeometry,
  level: number,
  palm: boolean,
  canopy: boolean,
): { index: THREE.BufferAttribute; position?: THREE.BufferAttribute } {
  if (canopy) {
    const cards = buildCanopyDetail(geometry, level, palm);
    if (cards) return cards;
  }
  return { index: buildSceneryDetailIndex(geometry, level, palm) };
}
