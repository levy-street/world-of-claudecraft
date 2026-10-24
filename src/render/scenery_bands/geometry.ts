import type * as THREE from 'three';

let simplifier: typeof import('meshoptimizer').MeshoptSimplifier | undefined;
let loading: Promise<void> | undefined;
type Position = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

/** Foliage's per-cell ghost shells share authored position/index attributes.
 * Cache by those buffers, not the shell identity, across moving windows. */
export class SceneryIndexCache {
  private sources = new WeakMap<
    Position,
    Map<THREE.BufferAttribute | null, Map<string, Uint32Array>>
  >();

  private entries(geometry: THREE.BufferGeometry): Map<string, Uint32Array> {
    const position = geometry.attributes.position;
    let indices = this.sources.get(position);
    if (!indices) {
      indices = new Map();
      this.sources.set(position, indices);
    }
    let entries = indices.get(geometry.index);
    if (!entries) {
      entries = new Map();
      indices.set(geometry.index, entries);
    }
    return entries;
  }
  find(geometry: THREE.BufferGeometry, key: string): Uint32Array | undefined {
    return this.entries(geometry).get(key);
  }
  store(geometry: THREE.BufferGeometry, key: string, indices: Uint32Array): void {
    this.entries(geometry).set(key, indices);
  }
}

export function prepareSceneryBandGeometry(): Promise<void> {
  loading ??= import('meshoptimizer').then(async ({ MeshoptSimplifier }) => {
    await MeshoptSimplifier.ready;
    simplifier = MeshoptSimplifier;
  });
  return loading;
}

/** Matches the measured prototype, including its nonempty fallback. The
 * targets are per source part, not ratios of a possibly enormous original. */
export function sceneryBandIndices(
  geometry: THREE.BufferGeometry,
  targetTriangles: number,
  mode: 'quality' | 'palm' | 'coarse',
): Uint32Array {
  if (!simplifier) throw new Error('Scenery geometry has not been prepared');
  const MeshoptSimplifier = simplifier;
  const p = geometry.attributes.position;
  const base = geometry.index
    ? Uint32Array.from(geometry.index.array)
    : Uint32Array.from({ length: p.count }, (_, i) => i);
  const target = targetTriangles * 3;
  if (base.length <= target) return base;
  const positions = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    positions[i * 3] = p.getX(i);
    positions[i * 3 + 1] = p.getY(i);
    positions[i * 3 + 2] = p.getZ(i);
  }
  const [indices] =
    mode === 'coarse'
      ? MeshoptSimplifier.simplifySloppy(base, positions, 3, null, target, 1)
      : MeshoptSimplifier.simplify(
          base,
          positions,
          3,
          target,
          mode === 'palm' ? 0.03 : 0.01,
          mode === 'palm' ? ['Permissive'] : [],
        );
  if (mode === 'palm' && indices.length > target * 2) {
    const [coarse] = MeshoptSimplifier.simplifySloppy(base, positions, 3, null, target, 1);
    if (coarse.length) return coarse;
    const [fallback] = MeshoptSimplifier.simplify(base, positions, 3, target, 1, ['Permissive']);
    if (fallback.length) return fallback;
  }
  if (indices.length) return indices;
  if (mode === 'coarse') {
    const [fallback] = MeshoptSimplifier.simplify(base, positions, 3, target, 1, ['Permissive']);
    if (fallback.length) return fallback;
  }
  return base;
}
