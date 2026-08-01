import { createHash } from 'node:crypto';
import { Primitive } from '@gltf-transform/core';
import { reorder, weld } from '@gltf-transform/functions';

export const FOLIAGE_TOWN_TREE_ASSETS = Object.freeze([
  {
    path: 'models/foliage/pine_1.glb',
    inputSha256: 'c8558005e4a72f73f0160725d90b8f53cee729d398bb724551eaf01aa9776c48',
    outputSha256: '7f52ad76887cb8761baa53599092af5963555bd07e18830d6d60005cb4c228e0',
    semanticSha256: '32cf5eb8d2c3ba033211cc1a2da8e7c378a4f37be6b15d4475bc15150e3f606c',
  },
  {
    path: 'models/foliage/pine_2.glb',
    inputSha256: 'ed9dd61570f8432c882dbb0b81e5e77ff2ff564b158147b9e63a143ce06f30af',
    outputSha256: 'c5f6ffdf3fa12fe29b9ecc7d79a7499b56d21d130071a7517cd773f9f76e6d02',
    semanticSha256: 'f770883f8b39fd5e56ddd2b0af61a0d388663fa3f0ba1781095052717cb2bd3f',
  },
  {
    path: 'models/foliage/pine_4.glb',
    inputSha256: '2acecfb53e6fd70a255f2c599ac2cf101c44156c08ca3721e22381d1e8cae7af',
    outputSha256: '86cf70b0b1487e19e164a7a3052861163d15142249d82c2c55f3102c43685a59',
    semanticSha256: '86c42efa31f308a46cb417f9efbbc566f113fc7639f45d2f86de5807812126a1',
  },
  {
    path: 'models/foliage/pine_5.glb',
    inputSha256: 'efd99c71ca9b519acab46520675f2927721d6dc209a06702f769823c660b9bb3',
    outputSha256: '3b5c92dc85d2f12dd922783a2553dce309c134a8747978023da29d8c475f0d8d',
    semanticSha256: 'fc3828d63bb8d3b17d07379f107ff9929a39ff4df96b96ed9ff4d9c2547ae7a0',
  },
  {
    path: 'models/foliage/oak_1.glb',
    inputSha256: 'e8c8b7e02173490bfe5e802fad47c1b7824b787bb6c9274163bde7fda065c102',
    outputSha256: '9d1eeeeb62ef51bd77f0a1ffffb676b4d2b05358587d3bd3aa760884d940d6e7',
    semanticSha256: '185b2405fcda84e9a8fe12cb8304f3978c8ec8a879e386ad3a00f0e1964d3622',
  },
  {
    path: 'models/foliage/oak_2.glb',
    inputSha256: 'a84eda33a5cf5a34107b32a148acb769818d7a6702d7d48a555a36b05d1aa2a0',
    outputSha256: '79a7292b87d5e5732020fca0c14e977dca120bc5fc69b059874204e79e153813',
    semanticSha256: 'd236e67d643e353c1d5b9c7be7c4b23baba202cdd9f08863b60bb25592f7cee7',
  },
  {
    path: 'models/foliage/oak_3.glb',
    inputSha256: '9941db1c8735e39f3b05a58ed83724a6c7183ee805eeb54e117be099ccfcec5c',
    outputSha256: '2f5168e2f4fbc5bcbca7ec725a4e974a0368b3fa85580834830c4f6b52fd0a97',
    semanticSha256: 'd647d8d6dc809fab367644c836f13681a61151419d70efe996ac6cb9a02044ee',
  },
  {
    path: 'models/foliage/oak_4.glb',
    inputSha256: '269ded8a02330de8af6d2ddd04d3c5328f9891e4101156e3af385eefe246cb65',
    outputSha256: '44060a024598f61f5065c7a7ad17619799222a94221f5cd8e67631951e4944e0',
    semanticSha256: '09393239e7b85721fca5c4fbcfc65c9e306a3715771b8a5c1a03859bbd7ce412',
  },
  {
    path: 'models/foliage/oak_5.glb',
    inputSha256: 'efb946c0de2de9418fb247d02ce4b840a13ba0ac7c8f06d8d69d02050670ccca',
    outputSha256: '4091858276e23c8bf100003034dc2b6507e2a333cfc687d1a2e4773b45a0c7d6',
    semanticSha256: 'e6857409d1c8bf9db528a1ca038a9782139fdfb746e7b3a9126671061c7da35b',
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
