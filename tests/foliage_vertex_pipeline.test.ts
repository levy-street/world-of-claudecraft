import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FOLIAGE_TOWN_TREE_ASSETS,
  optimizeFoliageVertexDocument,
  triangleAttributeFingerprint,
} from '../scripts/assets/foliage_vertex_pipeline.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

const ROOT = path.join(__dirname, '..');
const EXPECTED_ASSETS = [
  {
    path: 'models/foliage/pine_1.glb',
    inputSha256: 'c8558005e4a72f73f0160725d90b8f53cee729d398bb724551eaf01aa9776c48',
    outputSha256: '7f52ad76887cb8761baa53599092af5963555bd07e18830d6d60005cb4c228e0',
    semanticSha256: '32cf5eb8d2c3ba033211cc1a2da8e7c378a4f37be6b15d4475bc15150e3f606c',
    vertices: 2_963,
    triangles: 3_864,
  },
  {
    path: 'models/foliage/pine_2.glb',
    inputSha256: 'ed9dd61570f8432c882dbb0b81e5e77ff2ff564b158147b9e63a143ce06f30af',
    outputSha256: 'c5f6ffdf3fa12fe29b9ecc7d79a7499b56d21d130071a7517cd773f9f76e6d02',
    semanticSha256: 'f770883f8b39fd5e56ddd2b0af61a0d388663fa3f0ba1781095052717cb2bd3f',
    vertices: 2_872,
    triangles: 3_586,
  },
  {
    path: 'models/foliage/pine_4.glb',
    inputSha256: '2acecfb53e6fd70a255f2c599ac2cf101c44156c08ca3721e22381d1e8cae7af',
    outputSha256: '86cf70b0b1487e19e164a7a3052861163d15142249d82c2c55f3102c43685a59',
    semanticSha256: '86c42efa31f308a46cb417f9efbbc566f113fc7639f45d2f86de5807812126a1',
    vertices: 2_896,
    triangles: 3_267,
  },
  {
    path: 'models/foliage/pine_5.glb',
    inputSha256: 'efd99c71ca9b519acab46520675f2927721d6dc209a06702f769823c660b9bb3',
    outputSha256: '3b5c92dc85d2f12dd922783a2553dce309c134a8747978023da29d8c475f0d8d',
    semanticSha256: 'fc3828d63bb8d3b17d07379f107ff9929a39ff4df96b96ed9ff4d9c2547ae7a0',
    vertices: 1_552,
    triangles: 1_558,
  },
  {
    path: 'models/foliage/oak_1.glb',
    inputSha256: 'e8c8b7e02173490bfe5e802fad47c1b7824b787bb6c9274163bde7fda065c102',
    outputSha256: '9d1eeeeb62ef51bd77f0a1ffffb676b4d2b05358587d3bd3aa760884d940d6e7',
    semanticSha256: '185b2405fcda84e9a8fe12cb8304f3978c8ec8a879e386ad3a00f0e1964d3622',
    vertices: 6_661,
    triangles: 6_211,
  },
  {
    path: 'models/foliage/oak_2.glb',
    inputSha256: 'a84eda33a5cf5a34107b32a148acb769818d7a6702d7d48a555a36b05d1aa2a0',
    outputSha256: '79a7292b87d5e5732020fca0c14e977dca120bc5fc69b059874204e79e153813',
    semanticSha256: 'd236e67d643e353c1d5b9c7be7c4b23baba202cdd9f08863b60bb25592f7cee7',
    vertices: 5_388,
    triangles: 5_580,
  },
  {
    path: 'models/foliage/oak_3.glb',
    inputSha256: '9941db1c8735e39f3b05a58ed83724a6c7183ee805eeb54e117be099ccfcec5c',
    outputSha256: '2f5168e2f4fbc5bcbca7ec725a4e974a0368b3fa85580834830c4f6b52fd0a97',
    semanticSha256: 'd647d8d6dc809fab367644c836f13681a61151419d70efe996ac6cb9a02044ee',
    vertices: 4_438,
    triangles: 3_351,
  },
  {
    path: 'models/foliage/oak_4.glb',
    inputSha256: '269ded8a02330de8af6d2ddd04d3c5328f9891e4101156e3af385eefe246cb65',
    outputSha256: '44060a024598f61f5065c7a7ad17619799222a94221f5cd8e67631951e4944e0',
    semanticSha256: '09393239e7b85721fca5c4fbcfc65c9e306a3715771b8a5c1a03859bbd7ce412',
    vertices: 3_578,
    triangles: 3_984,
  },
  {
    path: 'models/foliage/oak_5.glb',
    inputSha256: 'efb946c0de2de9418fb247d02ce4b840a13ba0ac7c8f06d8d69d02050670ccca',
    outputSha256: '4091858276e23c8bf100003034dc2b6507e2a333cfc687d1a2e4773b45a0c7d6',
    semanticSha256: 'e6857409d1c8bf9db528a1ca038a9782139fdfb746e7b3a9126671061c7da35b',
    vertices: 3_746,
    triangles: 3_140,
  },
] as const;

function vertexKey(
  primitive: ReturnType<Document['createPrimitive']>,
  vertexIndex: number,
): string {
  return primitive
    .listSemantics()
    .sort()
    .map((semantic) => {
      const accessor = primitive.getAttribute(semantic);
      if (!accessor) throw new Error(`missing ${semantic}`);
      const array = accessor.getArray();
      if (!array) throw new Error(`${semantic} has no array`);
      const byteLength = accessor.getElementSize() * array.BYTES_PER_ELEMENT;
      const byteOffset = array.byteOffset + vertexIndex * byteLength;
      const bytes = Buffer.from(array.buffer, byteOffset, byteLength).toString('hex');
      return `${semantic}:${accessor.getComponentType()}:${accessor.getNormalized()}:${bytes}`;
    })
    .join('|');
}

describe('foliage vertex pipeline', () => {
  let io: NodeIO;

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
  });

  it('preserves triangle winding and every corner attribute bit while welding', async () => {
    const document = new Document();
    const buffer = document.createBuffer();
    const position = document
      .createAccessor('position')
      .setType('VEC3')
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]))
      .setBuffer(buffer);
    const normal = document
      .createAccessor('normal')
      .setType('VEC3')
      .setNormalized(true)
      .setArray(new Int8Array([0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0, 0, 127, 0]))
      .setBuffer(buffer);
    const indices = document
      .createAccessor('indices')
      .setType('SCALAR')
      .setArray(new Uint16Array([0, 1, 2, 3, 4, 5]))
      .setBuffer(buffer);
    const primitive = document
      .createPrimitive()
      .setAttribute('POSITION', position)
      .setAttribute('NORMAL', normal)
      .setIndices(indices);
    document.createMesh().addPrimitive(primitive);

    const before = triangleAttributeFingerprint(document);
    await optimizeFoliageVertexDocument(document, MeshoptEncoder);

    expect(triangleAttributeFingerprint(document)).toBe(before);
    expect(primitive.getAttribute('POSITION')?.getCount()).toBe(4);
    expect(primitive.getIndices()?.getArray()).toBeInstanceOf(Uint16Array);
  });

  it('keeps the migration inventory complete and independently pinned', () => {
    expect(FOLIAGE_TOWN_TREE_ASSETS).toEqual(
      EXPECTED_ASSETS.map(({ path: assetPath, inputSha256, outputSha256, semanticSha256 }) => ({
        path: assetPath,
        inputSha256,
        outputSha256,
        semanticSha256,
      })),
    );
  });

  for (const asset of EXPECTED_ASSETS) {
    it(`pins exact welded geometry and artifact bytes for ${asset.path}`, async () => {
      const assetPath = path.join(ROOT, 'public', asset.path);
      const bytes = readFileSync(assetPath);
      const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
      expect(artifactSha256).toBe(asset.outputSha256);
      const parsed = path.posix.parse(asset.path);
      expect(MEDIA_ASSETS[asset.path]).toBe(
        path.posix.join(
          '/media',
          parsed.dir,
          `${parsed.name}.${artifactSha256.slice(0, 12)}${parsed.ext}`,
        ),
      );

      const document = await io.read(assetPath);
      expect(triangleAttributeFingerprint(document)).toBe(asset.semanticSha256);

      let vertices = 0;
      let triangles = 0;
      for (const mesh of document.getRoot().listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          const position = primitive.getAttribute('POSITION');
          const index = primitive.getIndices();
          expect(position).toBeDefined();
          expect(index).toBeDefined();
          if (!position || !index) continue;
          const indexArray = index.getArray();
          expect(indexArray).toBeInstanceOf(Uint16Array);
          if (!indexArray) continue;
          expect(Math.max(...indexArray)).toBeLessThanOrEqual(65_534);
          vertices += position.getCount();
          triangles += index.getCount() / 3;

          const uniqueVertices = new Set<string>();
          for (let vertex = 0; vertex < position.getCount(); vertex++) {
            uniqueVertices.add(vertexKey(primitive, vertex));
          }
          expect(uniqueVertices.size).toBe(position.getCount());
        }
      }
      expect({ vertices, triangles }).toEqual({
        vertices: asset.vertices,
        triangles: asset.triangles,
      });
    });
  }
});
