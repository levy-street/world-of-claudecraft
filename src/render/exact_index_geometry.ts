import * as THREE from 'three';

interface AttributeLayout {
  name: string;
  attribute: THREE.BufferAttribute;
  bytes: Uint8Array;
  byteStride: number;
}

type TypedArrayConstructor = new (length: number) => THREE.TypedArray;

function attributeLayouts(source: THREE.BufferGeometry): AttributeLayout[] {
  const position = source.getAttribute('position');
  if (!position) throw new Error('Exact geometry indexing requires positions');
  if (source.getIndex()) throw new Error('Exact geometry indexing requires non-indexed geometry');
  if (Object.keys(source.morphAttributes).length > 0) {
    throw new Error('Exact geometry indexing does not support morph attributes');
  }

  return Object.entries(source.attributes)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, attribute]) => {
      if (attribute instanceof THREE.InterleavedBufferAttribute) {
        throw new Error('Exact geometry indexing requires normalized buffer attributes');
      }
      if (attribute.count !== position.count) {
        throw new Error(`Exact geometry indexing found a mismatched ${name} attribute`);
      }
      return {
        name,
        attribute,
        bytes: new Uint8Array(
          attribute.array.buffer,
          attribute.array.byteOffset,
          attribute.array.byteLength,
        ),
        byteStride: attribute.itemSize * attribute.array.BYTES_PER_ELEMENT,
      };
    });
}

function exactTupleKey(layouts: readonly AttributeLayout[], vertexIndex: number): string {
  let key = '';
  for (const layout of layouts) {
    const start = vertexIndex * layout.byteStride;
    const end = start + layout.byteStride;
    for (let offset = start; offset < end; offset++) {
      key += String.fromCharCode(layout.bytes[offset]);
    }
  }
  return key;
}

/**
 * Replace an expanded triangle stream with an indexed stream of byte-identical
 * full attribute tuples. Triangle order and every shader input stay unchanged.
 */
export function indexExactVertexTuples(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const layouts = attributeLayouts(source);
  const vertexCount = source.getAttribute('position').count;
  const tupleIndices = new Array<number>(vertexCount);
  const representatives: number[] = [];
  const tupleIndexByKey = new Map<string, number>();

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    const key = exactTupleKey(layouts, vertexIndex);
    let tupleIndex = tupleIndexByKey.get(key);
    if (tupleIndex === undefined) {
      tupleIndex = representatives.length;
      tupleIndexByKey.set(key, tupleIndex);
      representatives.push(vertexIndex);
    }
    tupleIndices[vertexIndex] = tupleIndex;
  }

  const indexed = source.clone();
  for (const { name, attribute } of layouts) {
    const ArrayType = attribute.array.constructor as TypedArrayConstructor;
    const compactArray = new ArrayType(representatives.length * attribute.itemSize);
    for (let tupleIndex = 0; tupleIndex < representatives.length; tupleIndex++) {
      const sourceOffset = representatives[tupleIndex] * attribute.itemSize;
      const targetOffset = tupleIndex * attribute.itemSize;
      for (let component = 0; component < attribute.itemSize; component++) {
        compactArray[targetOffset + component] = attribute.array[sourceOffset + component];
      }
    }
    const compactAttribute = new THREE.BufferAttribute(
      compactArray,
      attribute.itemSize,
      attribute.normalized,
    );
    compactAttribute.name = attribute.name;
    compactAttribute.setUsage(attribute.usage);
    compactAttribute.gpuType = attribute.gpuType;
    indexed.setAttribute(name, compactAttribute);
  }

  const IndexArray = representatives.length <= 65_535 ? Uint16Array : Uint32Array;
  indexed.setIndex(new THREE.BufferAttribute(new IndexArray(tupleIndices), 1));
  return indexed;
}
