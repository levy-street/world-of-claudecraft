import * as THREE from 'three';

/**
 * Convert quantized/interleaved attributes to the one representation accepted
 * by BufferGeometryUtils.mergeGeometries. GLBs commonly mix normalized integer
 * UVs with procedural Float32 UVs; merging those directly returns null.
 */
export function normalizeGeometryAttributesForMerge(geometry: THREE.BufferGeometry): void {
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    if (attribute instanceof THREE.BufferAttribute && attribute.array instanceof Float32Array) {
      if (!attribute.normalized) continue;
    }
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) {
      for (let component = 0; component < attribute.itemSize; component++) {
        values[i * attribute.itemSize + component] = attribute.getComponent(i, component);
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
}
