import * as THREE from 'three';
import { sceneryReduction } from './scenery_detail_core';
import { sceneryComponents } from './scenery_detail_topology';

interface Card {
  vertices: number[];
  indices: number[];
  center: number[];
}

// Visit each spatial branch once. Repeatedly searching the entire frontier
// made construction quadratic in the number of leaves on a large crown.
function partition(cards: Card[], count: number, output: Card[][]): void {
  if (count <= 1 || cards.length <= 1) {
    output.push(cards);
    return;
  }
  let axis = 0,
    spread = -1;
  for (let dimension = 0; dimension < 3; dimension++) {
    let lo = Infinity,
      hi = -Infinity;
    for (const card of cards) {
      lo = Math.min(lo, card.center[dimension]);
      hi = Math.max(hi, card.center[dimension]);
    }
    if (hi - lo > spread) {
      axis = dimension;
      spread = hi - lo;
    }
  }
  cards.sort((a, b) => a.center[axis] - b.center[axis]);
  const midpoint = Math.ceil(cards.length / 2);
  const leftCount = Math.min(midpoint, Math.max(1, Math.round((count * midpoint) / cards.length)));
  partition(cards.slice(0, midpoint), leftCount, output);
  partition(cards.slice(midpoint), count - leftCount, output);
}

/** Distant leaf cards keep the same texture/UVs/normals and material. Spatial
 * clusters replace many tiny leaves with fewer larger leaves, rather than
 * treating disconnected leaf surfaces as expendable mesh debris. Grouping by
 * plane orientation keeps the crown present when viewed from different sides. */
export function buildCanopyDetail(
  geometry: THREE.BufferGeometry,
  level: number,
  palm: boolean,
): { index: THREE.BufferAttribute; position: THREE.BufferAttribute } | null {
  const { positions, indices, components } = sceneryComponents(geometry);
  const cards = components.filter((c) => c.indices.length <= 18);
  if (cards.length < 24 || cards.reduce((n, c) => n + c.indices.length, 0) < indices.length * 0.8)
    return null;
  const ratio = Math.min(
    [1, 0.8, 0.55, 0.34, 0.2, 0.12][level] * (palm && level >= 2 ? 0.8 : 1),
    sceneryReduction(level, indices.length / 3, palm).triangles / (indices.length / 3),
  );
  const minimum = [Infinity, Infinity, Infinity],
    maximum = [-Infinity, -Infinity, -Infinity];
  for (const i of indices)
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], positions[i * 3 + axis]);
      maximum[axis] = Math.max(maximum[axis], positions[i * 3 + axis]);
    }
  const orientations: Card[][] = [[], [], []];
  for (const card of cards) {
    const center = [0, 0, 0];
    for (const i of card.vertices)
      for (let axis = 0; axis < 3; axis++)
        center[axis] += positions[i * 3 + axis] / card.vertices.length;
    const a = new THREE.Vector3().fromArray(positions, card.indices[0] * 3);
    const b = new THREE.Vector3().fromArray(positions, card.indices[1] * 3).sub(a);
    const c = new THREE.Vector3().fromArray(positions, card.indices[2] * 3).sub(a);
    b.cross(c);
    const normal = [Math.abs(b.x), Math.abs(b.y), Math.abs(b.z)];
    const axis = normal.indexOf(Math.max(...normal));
    orientations[axis].push({ ...card, center });
  }
  const result: number[] = [];
  for (const c of components) if (c.indices.length > 18) result.push(...c.indices);
  const output = positions.slice();
  for (const plane of orientations) {
    if (!plane.length) continue;
    const target = Math.max(1, Math.ceil(plane.length * ratio));
    const clusters: Card[][] = [];
    partition(plane, target, clusters);
    for (const cluster of clusters) {
      const center = [0, 0, 0];
      for (const card of cluster)
        for (let axis = 0; axis < 3; axis++) center[axis] += card.center[axis] / cluster.length;
      let representative = cluster[0],
        nearest = Infinity;
      for (const card of cluster) {
        const distance = card.center.reduce((d, value, axis) => d + (value - center[axis]) ** 2, 0);
        if (distance < nearest) {
          representative = card;
          nearest = distance;
        }
      }
      const scale = Math.min(3.25, Math.sqrt(cluster.length));
      for (const i of representative.vertices)
        for (let axis = 0; axis < 3; axis++) {
          output[i * 3 + axis] = Math.max(
            minimum[axis],
            Math.min(
              maximum[axis],
              center[axis] + (positions[i * 3 + axis] - representative.center[axis]) * scale,
            ),
          );
        }
      result.push(...representative.indices);
    }
  }
  return {
    index: new THREE.BufferAttribute(Uint32Array.from(result), 1),
    position: new THREE.BufferAttribute(output, 3),
  };
}
