// The colour pass may simplify scenery; its original shadow remains intact.
// Three reads the geometry index / instance count after onBeforeShadow and
// restores colour state through onAfterShadow. No material or light changes.
import type * as THREE from 'three';

export function preserveSceneryShadow(
  mesh: THREE.Mesh,
  source: THREE.BufferGeometry,
  count: number | null,
): () => void {
  const before = mesh.onBeforeShadow;
  const after = mesh.onAfterShadow;
  let previousCount = 0;
  let previousIndex: THREE.BufferAttribute | null = null;
  let previousPosition: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  let previousDrawCount = Infinity;
  mesh.onBeforeShadow = function (...args): void {
    before.apply(this, args);
    const geometry = args[4];
    previousIndex = geometry.index;
    previousPosition = geometry.getAttribute('position');
    geometry.index = source.index;
    geometry.setAttribute('position', source.getAttribute('position'));
    const instanced = this as THREE.InstancedMesh;
    previousDrawCount = geometry.drawRange.count;
    if (!instanced.isInstancedMesh)
      geometry.drawRange.count = count === 0 ? 0 : source.drawRange.count;
    if (instanced.isInstancedMesh && count !== null) {
      previousCount = instanced.count;
      instanced.count = count;
    }
  };
  mesh.onAfterShadow = function (...args): void {
    args[4].index = previousIndex;
    args[4].setAttribute('position', previousPosition);
    args[4].drawRange.count = previousDrawCount;
    const instanced = this as THREE.InstancedMesh;
    if (instanced.isInstancedMesh && count !== null) instanced.count = previousCount;
    after.apply(this, args);
  };
  return () => {
    mesh.onBeforeShadow = before;
    mesh.onAfterShadow = after;
  };
}
