import * as THREE from 'three';

type TypedArrayConstructor = new (length: number) => THREE.TypedArray;

const packedTemplates = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function clonePackedAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
): THREE.BufferAttribute {
  if (!(attribute instanceof THREE.InterleavedBufferAttribute)) return attribute.clone();

  const ArrayType = attribute.array.constructor as TypedArrayConstructor;
  const array = new ArrayType(attribute.count * attribute.itemSize);
  for (let index = 0; index < attribute.count; index++) {
    const sourceOffset = index * attribute.data.stride + attribute.offset;
    const targetOffset = index * attribute.itemSize;
    for (let component = 0; component < attribute.itemSize; component++) {
      array[targetOffset + component] = attribute.array[sourceOffset + component];
    }
  }
  return new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized);
}

// The bake keeps exactly the streams the static merge consumes. This is not a
// tidy-up: mergeGeometries requires every merged geometry to carry the SAME
// attribute set, so silently forwarding whatever extra streams a GLB happens to
// ship would make a merge fail as soon as one source differs from its bucket.
const BAKED_ATTRIBUTES = ['position', 'normal', 'uv'] as const;

function packedTemplate(source: THREE.BufferGeometry): THREE.BufferGeometry {
  let template = packedTemplates.get(source);
  if (template) return template;
  if (Object.keys(source.morphAttributes).length > 0) {
    throw new Error('Static geometry bake cloning does not support morph attributes');
  }

  template = new THREE.BufferGeometry();
  for (const name of BAKED_ATTRIBUTES) {
    const attribute = source.getAttribute(name);
    if (attribute) template.setAttribute(name, clonePackedAttribute(attribute));
  }
  packedTemplates.set(source, template);
  return template;
}

/**
 * Return a mutable, tightly packed clone of an immutable loader geometry.
 * Interleaved source attributes are copied once into a WeakMap template, so
 * shared GLB geometry never repeats the strided de-interleave work.
 */
export function cloneGeometryForBake(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const clone = packedTemplate(source).clone();
  if (source.index) clone.setIndex(source.index.clone());
  return clone;
}
