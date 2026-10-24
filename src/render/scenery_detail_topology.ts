import type * as THREE from 'three';

interface Topology {
  positions: Float32Array;
  indices: Uint32Array;
  components: { vertices: number[]; indices: number[] }[];
}
// Source geometries are immutable during a scenery session. Weak ownership
// shares connectivity across its levels without extending the asset lifetime.
const cache = new WeakMap<THREE.BufferGeometry, Topology>();

export function releaseSceneryTopology(geometry: THREE.BufferGeometry): void {
  cache.delete(geometry);
}

/** Weld positions only for connectivity analysis. Render vertices, UV seams,
 * normals and source indices are never rewritten by this analysis. */
export function sceneryComponents(geometry: THREE.BufferGeometry): Topology {
  const cached = cache.get(geometry);
  if (cached) return cached;
  const attribute = geometry.getAttribute('position');
  const positions = new Float32Array(attribute.count * 3);
  const indices = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: attribute.count }, (_, i) => i);
  const parents = Int32Array.from({ length: attribute.count }, (_, i) => i);
  const root = (vertex: number): number => {
    while (parents[vertex] !== vertex) {
      parents[vertex] = parents[parents[vertex]];
      vertex = parents[vertex];
    }
    return vertex;
  };
  const points = new Map<string, number>();
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i),
      y = attribute.getY(i),
      z = attribute.getZ(i);
    positions.set([x, y, z], i * 3);
    const key = `${x},${y},${z}`;
    const other = points.get(key);
    if (other !== undefined) parents[root(i)] = root(other);
    else points.set(key, i);
  }
  for (let i = 0; i < indices.length; i += 3) {
    parents[root(indices[i])] = root(indices[i + 1]);
    parents[root(indices[i])] = root(indices[i + 2]);
  }
  const groups = new Map<number, { vertices: Set<number>; indices: number[] }>();
  for (const i of indices) {
    const key = root(i);
    let component = groups.get(key);
    if (!component) {
      component = { vertices: new Set(), indices: [] };
      groups.set(key, component);
    }
    component.vertices.add(i);
    component.indices.push(i);
  }
  const result = {
    positions,
    indices,
    components: [...groups.values()].map((c) => ({
      vertices: [...c.vertices],
      indices: c.indices,
    })),
  };
  cache.set(geometry, result);
  return result;
}
