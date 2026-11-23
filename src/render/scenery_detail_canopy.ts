import * as THREE from 'three';
import { sceneryReduction } from './scenery_detail_core';
import { onReleaseSceneryTopology, sceneryComponents } from './scenery_detail_topology';

interface Card {
  vertices: number[];
  indices: number[];
  center: number[];
}

interface CanopyAnalysis {
  positions: Float32Array;
  triangleCount: number;
  minimum: [number, number, number];
  maximum: [number, number, number];
  nonCardIndices: number[];
  orientations: [Card[], Card[], Card[]];
}

const canopyCache = new WeakMap<THREE.BufferGeometry, CanopyAnalysis | null>();
onReleaseSceneryTopology((geometry) => {
  canopyCache.delete(geometry);
});

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

function analyzeCanopy(geometry: THREE.BufferGeometry): CanopyAnalysis | null {
  if (canopyCache.has(geometry)) return canopyCache.get(geometry) ?? null;
  const { positions, indices, components } = sceneryComponents(geometry);
  const cards: { vertices: number[]; indices: number[] }[] = [];
  const nonCardIndices: number[] = [];
  let cardIndexCount = 0;
  for (const c of components) {
    if (c.indices.length <= 18) {
      cards.push(c);
      cardIndexCount += c.indices.length;
    } else {
      nonCardIndices.push(...c.indices);
    }
  }
  if (cards.length < 24 || cardIndexCount < indices.length * 0.8) {
    canopyCache.set(geometry, null);
    return null;
  }
  const minimum: [number, number, number] = [Infinity, Infinity, Infinity];
  const maximum: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let idx = 0; idx < indices.length; idx++) {
    const base = indices[idx] * 3;
    const x = positions[base];
    const y = positions[base + 1];
    const z = positions[base + 2];
    if (x < minimum[0]) minimum[0] = x;
    if (x > maximum[0]) maximum[0] = x;
    if (y < minimum[1]) minimum[1] = y;
    if (y > maximum[1]) maximum[1] = y;
    if (z < minimum[2]) minimum[2] = z;
    if (z > maximum[2]) maximum[2] = z;
  }
  const orientations: [Card[], Card[], Card[]] = [[], [], []];
  for (const card of cards) {
    const center = [0, 0, 0];
    const vLen = card.vertices.length;
    for (let v = 0; v < vLen; v++) {
      const base = card.vertices[v] * 3;
      center[0] += positions[base] / vLen;
      center[1] += positions[base + 1] / vLen;
      center[2] += positions[base + 2] / vLen;
    }
    const i0 = card.indices[0] * 3;
    const i1 = card.indices[1] * 3;
    const i2 = card.indices[2] * 3;
    const ax = positions[i0],
      ay = positions[i0 + 1],
      az = positions[i0 + 2];
    const bx = positions[i1] - ax,
      by = positions[i1 + 1] - ay,
      bz = positions[i1 + 2] - az;
    const cx = positions[i2] - ax,
      cy = positions[i2 + 1] - ay,
      cz = positions[i2 + 2] - az;
    const nx = Math.abs(by * cz - bz * cy);
    const ny = Math.abs(bz * cx - bx * cz);
    const nz = Math.abs(bx * cy - by * cx);
    const axis = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
    orientations[axis].push({ vertices: card.vertices, indices: card.indices, center });
  }
  const analysis: CanopyAnalysis = {
    positions,
    triangleCount: indices.length / 3,
    minimum,
    maximum,
    nonCardIndices,
    orientations,
  };
  canopyCache.set(geometry, analysis);
  return analysis;
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
  const analysis = analyzeCanopy(geometry);
  if (!analysis) return null;
  const { positions, triangleCount, minimum, maximum, nonCardIndices, orientations } = analysis;
  const ratio = Math.min(
    [1, 0.8, 0.55, 0.34, 0.2, 0.12][level] * (palm && level >= 2 ? 0.8 : 1),
    sceneryReduction(level, triangleCount, palm).triangles / triangleCount,
  );
  const result = nonCardIndices.slice();
  const output = positions.slice();
  for (const plane of orientations) {
    if (!plane.length) continue;
    const target = Math.max(1, Math.ceil(plane.length * ratio));
    const clusters: Card[][] = [];
    partition(plane.slice(), target, clusters);
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
    index: new THREE.BufferAttribute(new Uint32Array(result), 1),
    position: new THREE.BufferAttribute(output, 3),
  };
}
