// Baked GLB primitives can quantize non-position attributes (e.g. `uv` as a
// normalized Uint16Array) differently per primitive. THREE.BufferGeometryUtils
// .mergeGeometries() requires every geometry's copy of a given attribute name
// to share the exact same typed-array constructor, so merging primitives whose
// `uv` came from different source primitives can fail even though the values
// themselves are compatible. Reading through get* denormalizes a quantized
// source, so rebuilding into a fresh, un-normalized Float32Array attribute
// makes differently quantized primitives mergeable.
import * as THREE from 'three';

export function dequantizeAttribute(attr: THREE.BufferAttribute): THREE.BufferAttribute {
  const { count, itemSize } = attr;
  const arr = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i++)
    for (let c = 0; c < itemSize; c++) arr[i * itemSize + c] = attr.getComponent(i, c);
  return new THREE.BufferAttribute(arr, itemSize);
}
