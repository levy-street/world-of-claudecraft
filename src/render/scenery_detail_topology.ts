import type * as THREE from 'three';

interface Topology {
  positions: Float32Array;
  indices: Uint32Array;
  components: { vertices: number[]; indices: number[] }[];
}
// Source geometries are immutable during a scenery session. Weak ownership
// shares connectivity across its levels without extending the asset lifetime.
const cache = new WeakMap<THREE.BufferGeometry, Topology>();
const refs = new WeakMap<THREE.BufferGeometry, number>();
const releaseListeners: ((geometry: THREE.BufferGeometry) => void)[] = [];

export function onReleaseSceneryTopology(listener: (geometry: THREE.BufferGeometry) => void): void {
  releaseListeners.push(listener);
}

export function retainSceneryTopology(geometry: THREE.BufferGeometry): void {
  refs.set(geometry, (refs.get(geometry) ?? 0) + 1);
}

export function releaseSceneryTopology(geometry: THREE.BufferGeometry): void {
  const remaining = (refs.get(geometry) ?? 1) - 1;
  if (remaining > 0) {
    refs.set(geometry, remaining);
    return;
  }
  refs.delete(geometry);
  cache.delete(geometry);
  for (const listener of releaseListeners) listener(geometry);
}

/** Weld positions only for connectivity analysis. Render vertices, UV seams,
 * normals and source indices are never rewritten by this analysis. */
export function sceneryComponents(geometry: THREE.BufferGeometry): Topology {
  const cached = cache.get(geometry);
  if (cached) return cached;
  const attribute = geometry.getAttribute('position');
  const vertexCount = attribute.count;
  const positions = new Float32Array(vertexCount * 3);
  const posBits = new Int32Array(positions.buffer);
  let indices: Uint32Array;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array);
  } else {
    indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
  }
  const parents = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parents[i] = i;
  const root = (vertex: number): number => {
    while (parents[vertex] !== vertex) {
      parents[vertex] = parents[parents[vertex]];
      vertex = parents[vertex];
    }
    return vertex;
  };

  let tableSize = 16;
  while (tableSize < vertexCount * 2) tableSize <<= 1;
  const mask = tableSize - 1;
  const head = new Int32Array(tableSize).fill(-1);
  const next = new Int32Array(vertexCount).fill(-1);

  for (let i = 0; i < vertexCount; i++) {
    const rawX = attribute.getX(i);
    const rawY = attribute.getY(i);
    const rawZ = attribute.getZ(i);
    const base = i * 3;
    positions[base] = rawX === 0 ? 0 : rawX;
    positions[base + 1] = rawY === 0 ? 0 : rawY;
    positions[base + 2] = rawZ === 0 ? 0 : rawZ;
    const bx = posBits[base];
    const by = posBits[base + 1];
    const bz = posBits[base + 2];
    const hash =
      (Math.imul(bx, 73856093) ^ Math.imul(by, 19349663) ^ Math.imul(bz, 83492791)) & mask;
    let other = head[hash];
    while (other !== -1) {
      const ob = other * 3;
      if (posBits[ob] === bx && posBits[ob + 1] === by && posBits[ob + 2] === bz) {
        parents[root(i)] = root(other);
        break;
      }
      other = next[other];
    }
    if (other === -1) {
      next[i] = head[hash];
      head[hash] = i;
    }
  }
  for (let i = 0; i < indices.length; i += 3) {
    parents[root(indices[i])] = root(indices[i + 1]);
    parents[root(indices[i])] = root(indices[i + 2]);
  }
  const componentMap = new Int32Array(vertexCount).fill(-1);
  const seenInComponent = new Int32Array(vertexCount).fill(-1);
  const components: { vertices: number[]; indices: number[] }[] = [];
  for (let idx = 0; idx < indices.length; idx++) {
    const i = indices[idx];
    const key = root(i);
    let compIdx = componentMap[key];
    if (compIdx === -1) {
      compIdx = components.length;
      componentMap[key] = compIdx;
      components.push({ vertices: [], indices: [] });
    }
    const component = components[compIdx];
    if (seenInComponent[i] !== compIdx) {
      seenInComponent[i] = compIdx;
      component.vertices.push(i);
    }
    component.indices.push(i);
  }
  const result = {
    positions,
    indices,
    components,
  };
  cache.set(geometry, result);
  return result;
}
