// Shared dequantizer for GLB geometry baking (foliage, dungeon kits, event
// scenes). The shipped GLBs are meshopt-quantized: positions/normals/uvs/colors
// live in normalized integer (sometimes interleaved) attributes with a
// dequantization node transform. Reading through getComponent denormalizes
// quantized sources and flattens interleaved ones, so the result is a plain
// float32 attribute that applyMatrix4/mergeGeometries/instancing can consume
// without clamping world-space values into the [-1, 1] range.
import * as THREE from 'three';

export function toFloatAttribute(
  attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  if ((attr as THREE.BufferAttribute).isBufferAttribute && !attr.normalized) {
    const plain = attr as THREE.BufferAttribute;
    if (plain.array instanceof Float32Array) return plain.clone();
  }
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) {
    for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  }
  return new THREE.BufferAttribute(out, attr.itemSize);
}
