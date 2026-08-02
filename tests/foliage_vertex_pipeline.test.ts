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
    inputSha256: '98ed996bb94e6b18c0a04ab085e616df75660a2bd05f573559cd390977866da7',
    outputSha256: '18d21cee2d4141a31ca6c238836e66242d4ca259a874eb2c53c120ba94491f2d',
    semanticSha256: '7e8cd6701560a75be570e59683ef37d985b7a2d28e66fc25a35ec68217f85b0b',
    vertices: 2_963,
    triangles: 3_864,
  },
  {
    path: 'models/foliage/pine_2.glb',
    inputSha256: '834bf5e8b1e3b900f2dded396256982ecdf7d249d4171044a590e3d2e2290e43',
    outputSha256: 'e3c2d2a2b06b7ad2fb9d186e72797a00287b786d595539c0994880cbcc944bb5',
    semanticSha256: 'eb3e27dde17f382bd5896b407e2b69121be0d11e525dcadaf0afba0c673d077e',
    vertices: 2_872,
    triangles: 3_586,
  },
  {
    path: 'models/foliage/pine_4.glb',
    inputSha256: '661db79755554b09bc13fd203f4cd9b8260f56bf1ad08704fa405de7345eb7f3',
    outputSha256: '25b84be096d31f1ff8d542fd4c5fadb7b1c68f9aa15e3e558625d0ecde5378be',
    semanticSha256: 'f352d2dca2d347a36b95490f929cc5bdd7752a32b93fe38084c0d62e233a7755',
    vertices: 2_896,
    triangles: 3_267,
  },
  {
    path: 'models/foliage/pine_5.glb',
    inputSha256: '107c5b94dea05c61774672c1bd3f41305546db38139090427eb3135be9f0232b',
    outputSha256: 'd01e51913814971091b91b55006fd00021d032922d5b8c1bd881cf433da65613',
    semanticSha256: 'cb2a39dffda97cfcefed51b9cdf5d6d7cf714099aeacf13767ad981ebc118f4f',
    vertices: 1_552,
    triangles: 1_558,
  },
  {
    path: 'models/foliage/oak_1.glb',
    inputSha256: '9fa24265948fc72456e27b570cd46bc14f2cd60f09931e3cce55b74f5b7a5f76',
    outputSha256: '9510f3ba02e6395e7ea0b4f766652d9159efcd9593ac56b5f907f7553d6dc5e1',
    semanticSha256: '0339cafbc34ad4eec07dfc3ab4ca8d5880b6e3aec5409f736630bf4bdd53a1c3',
    vertices: 6_661,
    triangles: 6_211,
  },
  {
    path: 'models/foliage/oak_2.glb',
    inputSha256: 'a99702fdde76f8b48a1e5ae3287da5349000c76cdd6d532fa315639a672a84e3',
    outputSha256: 'eeea227bbd3779ed6b932aa75d9170b49a601743af2eee055e52ef97803f7bc6',
    semanticSha256: '63cd03dfe2e01ee339bca0b908d76b5acdf0865027785544f35b2fa15ebeba7f',
    vertices: 5_388,
    triangles: 5_580,
  },
  {
    path: 'models/foliage/oak_3.glb',
    inputSha256: 'ed7f608bcd85716cacf83dde160f565576f53cbd565bf8e2f030cf93bf6743de',
    outputSha256: 'f5c66922b92e5fc5902af717159bd616bd4ff984ea1b0a51d7d5b780e5c6cef7',
    semanticSha256: '580229329f70929a66467d82fe4c6b504cf379eb22ce8ae7eca2234790d28c18',
    vertices: 4_438,
    triangles: 3_351,
  },
  {
    path: 'models/foliage/oak_4.glb',
    inputSha256: 'c4327b55443539d35fb858abca8bcdb177a13260e37202845be2348cc4e6d763',
    outputSha256: 'a8d015f28af796a92bbfa083f50b5d53f187c9db12bc04ebefe8a3b8269fb0e7',
    semanticSha256: 'fa170cdea2c695e102bdd18e136a0212a95a8e47c810eb51a8f2ec7c447d5294',
    vertices: 3_578,
    triangles: 3_984,
  },
  {
    path: 'models/foliage/oak_5.glb',
    inputSha256: '76e31c5bf89914bfbd52a09111096e2609c7a32dad36a11e4c307049f4b050d1',
    outputSha256: '6de684b3a783d6406444c351bc55fedd2a467ddc71840174c9bf9c45438173ae',
    semanticSha256: 'fa9ca9875ba24546cafe6dc9150e0f0d4ac140d839697d63fd7dce42bf44dd4e',
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
