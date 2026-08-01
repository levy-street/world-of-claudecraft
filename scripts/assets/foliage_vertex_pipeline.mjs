import { createHash } from 'node:crypto';
import { Primitive } from '@gltf-transform/core';
import { reorder, weld } from '@gltf-transform/functions';

export const FOLIAGE_TOWN_TREE_ASSETS = Object.freeze([
  {
    path: 'models/foliage/pine_1.glb',
    inputSha256: '98ed996bb94e6b18c0a04ab085e616df75660a2bd05f573559cd390977866da7',
    outputSha256: '18d21cee2d4141a31ca6c238836e66242d4ca259a874eb2c53c120ba94491f2d',
    semanticSha256: '7e8cd6701560a75be570e59683ef37d985b7a2d28e66fc25a35ec68217f85b0b',
  },
  {
    path: 'models/foliage/pine_2.glb',
    inputSha256: '834bf5e8b1e3b900f2dded396256982ecdf7d249d4171044a590e3d2e2290e43',
    outputSha256: 'e3c2d2a2b06b7ad2fb9d186e72797a00287b786d595539c0994880cbcc944bb5',
    semanticSha256: 'eb3e27dde17f382bd5896b407e2b69121be0d11e525dcadaf0afba0c673d077e',
  },
  {
    path: 'models/foliage/pine_4.glb',
    inputSha256: '661db79755554b09bc13fd203f4cd9b8260f56bf1ad08704fa405de7345eb7f3',
    outputSha256: '25b84be096d31f1ff8d542fd4c5fadb7b1c68f9aa15e3e558625d0ecde5378be',
    semanticSha256: 'f352d2dca2d347a36b95490f929cc5bdd7752a32b93fe38084c0d62e233a7755',
  },
  {
    path: 'models/foliage/pine_5.glb',
    inputSha256: '107c5b94dea05c61774672c1bd3f41305546db38139090427eb3135be9f0232b',
    outputSha256: 'd01e51913814971091b91b55006fd00021d032922d5b8c1bd881cf433da65613',
    semanticSha256: 'cb2a39dffda97cfcefed51b9cdf5d6d7cf714099aeacf13767ad981ebc118f4f',
  },
  {
    path: 'models/foliage/oak_1.glb',
    inputSha256: '9fa24265948fc72456e27b570cd46bc14f2cd60f09931e3cce55b74f5b7a5f76',
    outputSha256: '9510f3ba02e6395e7ea0b4f766652d9159efcd9593ac56b5f907f7553d6dc5e1',
    semanticSha256: '0339cafbc34ad4eec07dfc3ab4ca8d5880b6e3aec5409f736630bf4bdd53a1c3',
  },
  {
    path: 'models/foliage/oak_2.glb',
    inputSha256: 'a99702fdde76f8b48a1e5ae3287da5349000c76cdd6d532fa315639a672a84e3',
    outputSha256: 'eeea227bbd3779ed6b932aa75d9170b49a601743af2eee055e52ef97803f7bc6',
    semanticSha256: '63cd03dfe2e01ee339bca0b908d76b5acdf0865027785544f35b2fa15ebeba7f',
  },
  {
    path: 'models/foliage/oak_3.glb',
    inputSha256: 'ed7f608bcd85716cacf83dde160f565576f53cbd565bf8e2f030cf93bf6743de',
    outputSha256: 'f5c66922b92e5fc5902af717159bd616bd4ff984ea1b0a51d7d5b780e5c6cef7',
    semanticSha256: '580229329f70929a66467d82fe4c6b504cf379eb22ce8ae7eca2234790d28c18',
  },
  {
    path: 'models/foliage/oak_4.glb',
    inputSha256: 'c4327b55443539d35fb858abca8bcdb177a13260e37202845be2348cc4e6d763',
    outputSha256: 'a8d015f28af796a92bbfa083f50b5d53f187c9db12bc04ebefe8a3b8269fb0e7',
    semanticSha256: 'fa170cdea2c695e102bdd18e136a0212a95a8e47c810eb51a8f2ec7c447d5294',
  },
  {
    path: 'models/foliage/oak_5.glb',
    inputSha256: '76e31c5bf89914bfbd52a09111096e2609c7a32dad36a11e4c307049f4b050d1',
    outputSha256: '6de684b3a783d6406444c351bc55fedd2a467ddc71840174c9bf9c45438173ae',
    semanticSha256: 'fa9ca9875ba24546cafe6dc9150e0f0d4ac140d839697d63fd7dce42bf44dd4e',
  },
]);

function hashField(hash, value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function hashAccessorElement(hash, accessor, index) {
  const array = accessor.getArray();
  if (!array) throw new Error(`Accessor ${accessor.getName() || '<unnamed>'} has no array`);
  const bytesPerElement = array.BYTES_PER_ELEMENT;
  const byteOffset = array.byteOffset + index * accessor.getElementSize() * bytesPerElement;
  hash.update(
    new Uint8Array(array.buffer, byteOffset, accessor.getElementSize() * bytesPerElement),
  );
}

function cornerHash(primitive, vertexIndex) {
  const hash = createHash('sha256');
  const semantics = primitive.listSemantics().sort();
  for (const semantic of semantics) {
    const accessor = primitive.getAttribute(semantic);
    if (!accessor) throw new Error(`Primitive lost ${semantic}`);
    hashField(
      hash,
      `${semantic}:${accessor.getComponentType()}:${accessor.getType()}:${accessor.getNormalized()}`,
    );
    hashAccessorElement(hash, accessor, vertexIndex);
  }
  for (const [targetIndex, target] of primitive.listTargets().entries()) {
    for (const semantic of target.listSemantics().sort()) {
      const accessor = target.getAttribute(semantic);
      if (!accessor) throw new Error(`Morph target ${targetIndex} lost ${semantic}`);
      hashField(
        hash,
        `target:${targetIndex}:${semantic}:${accessor.getComponentType()}:${accessor.getType()}:${accessor.getNormalized()}`,
      );
      hashAccessorElement(hash, accessor, vertexIndex);
    }
  }
  return hash.digest('hex');
}

/**
 * Fingerprint the winding-preserving corner attributes of every triangle
 * while ignoring triangle submission order, cyclic corner rotation, and
 * numeric vertex IDs. Equal fingerprints prove that a weld/cache/fetch
 * reorder retained every triangle and shader-visible vertex value bit for bit.
 */
export function triangleAttributeFingerprint(document) {
  const hash = createHash('sha256');
  for (const [meshIndex, mesh] of document.getRoot().listMeshes().entries()) {
    for (const [primitiveIndex, primitive] of mesh.listPrimitives().entries()) {
      if (primitive.getMode() !== Primitive.Mode.TRIANGLES) {
        throw new Error(`Mesh ${meshIndex} primitive ${primitiveIndex} is not TRIANGLES`);
      }
      const indices = primitive.getIndices()?.getArray();
      const position = primitive.getAttribute('POSITION');
      if (!position)
        throw new Error(`Mesh ${meshIndex} primitive ${primitiveIndex} has no POSITION`);
      const cornerCount = indices?.length ?? position.getCount();
      if (cornerCount % 3 !== 0) {
        throw new Error(`Mesh ${meshIndex} primitive ${primitiveIndex} has partial triangles`);
      }
      const triangles = [];
      for (let corner = 0; corner < cornerCount; corner += 3) {
        const a = indices ? indices[corner] : corner;
        const b = indices ? indices[corner + 1] : corner + 1;
        const c = indices ? indices[corner + 2] : corner + 2;
        const corners = [
          cornerHash(primitive, a),
          cornerHash(primitive, b),
          cornerHash(primitive, c),
        ];
        // EXT_meshopt's index codec may rotate (a,b,c) to (b,c,a) while
        // retaining winding. Canonicalize only cyclic rotations, never the
        // reversed order.
        triangles.push(
          [
            `${corners[0]}:${corners[1]}:${corners[2]}`,
            `${corners[1]}:${corners[2]}:${corners[0]}`,
            `${corners[2]}:${corners[0]}:${corners[1]}`,
          ].sort()[0],
        );
      }
      triangles.sort();
      hashField(
        hash,
        `mesh:${meshIndex}:primitive:${primitiveIndex}:triangles:${triangles.length}`,
      );
      for (const triangle of triangles) hashField(hash, triangle);
    }
  }
  return hash.digest('hex');
}

/**
 * Merge only bitwise-identical complete vertices, then optimize triangle and
 * vertex storage order for GPU locality. This changes no attribute value or
 * triangle, and runs only in the offline asset pipeline.
 */
export async function optimizeFoliageVertexDocument(document, encoder) {
  await document.transform(
    weld(),
    reorder({
      encoder,
      target: 'performance',
    }),
  );
}
