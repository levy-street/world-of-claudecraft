// Contract pins for the two Mirefen mudfin hut models
// (`public/models/props/mudfin_hut_{a,b}.glb`), the huts src/render/props.ts
// draws at the five mud huts west of Fenbridge from src/sim/mudfin_huts.ts.
//
// They are the art lead's Tripo3D web models, baked by
// scripts/assets/build_mudfin_huts.mjs (simplify, real-size seat, 512px albedo,
// meshopt) and then KTX2-encoded by scripts/assets/compress_glb_textures.mjs.
// The Tripo sources stay out of git (CREDITS.md), so there is no honest source
// fingerprint: like tests/battleground_rune_models.test.ts, each shipped binary
// is pinned by sha256 of its exact bytes AND by parsed shape, and the parsed
// half also holds the size the colliders assume (the drawn height and the wall
// inside the eaves), so a re-bake at another size cannot slip under them.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import { glbJsonChunk } from '../scripts/assets/lib/glb_texture_compression_core.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { MUDFIN_HUT_PROP_KEYS, PROP_ASSET_DEFS } from '../src/render/props';
import { MUDFIN_HUT_MODELS, type MudfinHutModel } from '../src/sim/mudfin_huts';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MANIFEST_HASH_LENGTH = 12;
/** The prop family's hard cap (scripts/asset_pipeline/lib/families.mjs). */
const PROP_TRIANGLE_CAP = 6000;
/** KTX2 albedos make these bigger on disk than webp; an unbaked re-drop is MBs. */
const HUT_BYTE_CEILING = 600 * 1024;

interface HutModelContract {
  readonly model: MudfinHutModel;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly triangles: number;
  readonly vertices: number;
  readonly materialName: string;
  readonly textureName: string;
  /** Scene bounds, node transform applied: what the runtime measures. */
  readonly halfWidthX: number;
  readonly halfWidthZ: number;
}

const HUT_CONTRACTS: readonly HutModelContract[] = [
  {
    model: 'a',
    url: '/models/props/mudfin_hut_a.glb',
    bytes: 415_848,
    sha256: '8204b87bdf1c6608f2e999f0635f6af97898d4dd37a12c0fb5a1dd2061482545',
    triangles: 5500,
    vertices: 8078,
    materialName: 'tripo_mat_eb758834-980b-4e39-8e79-500400ebe604',
    textureName: 'tripo_image_eb758834-980b-4e39-8e79-500400ebe604_0_0',
    halfWidthX: 2.635,
    halfWidthZ: 2.635,
  },
  {
    model: 'b',
    url: '/models/props/mudfin_hut_b.glb',
    bytes: 372_660,
    sha256: '84ae6f74ce9d00da9caa90e737c4a76d6a17e59492ed4e6ad3d62280729636b2',
    triangles: 3000,
    vertices: 4693,
    materialName: 'tripo_mat_7a62faa7-b6a7-478b-bb16-07ab9512bdbf',
    textureName: 'tripo_image_7a62faa7-b6a7-478b-bb16-07ab9512bdbf_0_0',
    halfWidthX: 2.4532,
    halfWidthZ: 2.8345,
  },
];

function assetPath(url: string): string {
  return path.join(PUBLIC_DIR, url.replace(/^\//, ''));
}

async function readHut(contract: HutModelContract) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return (await io.read(assetPath(contract.url))).getRoot();
}

describe('Mirefen mudfin hut models', () => {
  it('pins one model per hut design, each registered as the prop the huts draw', () => {
    expect(HUT_CONTRACTS.map((c) => c.model).sort()).toEqual(
      (Object.keys(MUDFIN_HUT_MODELS) as MudfinHutModel[]).sort(),
    );
    for (const contract of HUT_CONTRACTS) {
      const key = MUDFIN_HUT_PROP_KEYS[contract.model];
      expect(PROP_ASSET_DEFS[key]?.url).toBe(contract.url);
      // no baked yaw: the door faces +Z in the file, and mudfin_huts.ts turns it
      expect(PROP_ASSET_DEFS[key]?.yaw).toBeUndefined();
    }
  });

  it.each(HUT_CONTRACTS)(
    'hut $model ships the pinned bytes, sha256 and manifest hash',
    (contract) => {
      const file = assetPath(contract.url);
      expect(existsSync(file)).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.length).toBe(contract.bytes);
      expect(bytes.length).toBeLessThanOrEqual(HUT_BYTE_CEILING);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      expect(sha256).toBe(contract.sha256);
      const mutated = Buffer.from(bytes);
      mutated[Math.floor(mutated.length / 2)] ^= 1;
      expect(createHash('sha256').update(mutated).digest('hex')).not.toBe(contract.sha256);
      const rel = contract.url.replace(/^\//, '');
      const parsed = path.posix.parse(rel);
      expect(MEDIA_ASSETS[rel]).toBe(
        path.posix.join(
          '/media',
          parsed.dir,
          `${parsed.name}.${sha256.slice(0, MANIFEST_HASH_LENGTH)}${parsed.ext}`,
        ),
      );
    },
  );

  it.each(HUT_CONTRACTS)('hut $model keeps KTX2 and meshopt REQUIRED', (contract) => {
    const json = glbJsonChunk(readFileSync(assetPath(contract.url))) as {
      extensionsUsed?: string[];
      extensionsRequired?: string[];
      images?: Array<{ name?: string; mimeType?: string }>;
    };
    const expected = ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu'];
    expect([...(json.extensionsUsed ?? [])].sort()).toEqual(expected);
    expect([...(json.extensionsRequired ?? [])].sort()).toEqual(expected);
    expect(json.images).toHaveLength(1);
    expect(json.images?.[0].mimeType).toBe('image/ktx2');
    expect(json.images?.[0].name).toBe(contract.textureName);
  });

  it.each(HUT_CONTRACTS)(
    'hut $model keeps its parsed shape and the size the colliders assume',
    async (contract) => {
      const root = await readHut(contract);
      expect(root.listMeshes()).toHaveLength(1);
      expect(root.listMaterials()).toHaveLength(1);
      expect(root.listTextures()).toHaveLength(1);
      expect(root.listAnimations()).toHaveLength(0);
      const primitive = root.listMeshes()[0].listPrimitives()[0];
      expect(root.listMeshes()[0].listPrimitives()).toHaveLength(1);
      expect(primitive.listSemantics().sort()).toEqual(['NORMAL', 'POSITION', 'TEXCOORD_0']);
      expect(primitive.getAttribute('POSITION')?.getCount()).toBe(contract.vertices);
      const triangles = (primitive.getIndices()?.getCount() ?? 0) / 3;
      expect(triangles).toBe(contract.triangles);
      expect(triangles).toBeLessThanOrEqual(PROP_TRIANGLE_CAP);

      const material = root.listMaterials()[0];
      expect(material.getName()).toBe(contract.materialName);
      expect(material.getDoubleSided()).toBe(true);
      expect(material.getNormalTexture()).toBeNull();
      const albedo = material.getBaseColorTexture();
      expect(albedo?.getMimeType()).toBe('image/ktx2');
      expect(albedo?.getSize()).toEqual([512, 512]);

      // Real size, base on the ground, centred: what props.ts draws at scale 1.
      const spec = MUDFIN_HUT_MODELS[contract.model];
      const bounds = getBounds(root.listScenes()[0]);
      expect(bounds.min[1]).toBeCloseTo(0, 3);
      expect(bounds.max[1]).toBeCloseTo(spec.height, 3);
      expect(bounds.max[0]).toBeCloseTo(contract.halfWidthX, 3);
      expect(bounds.max[2]).toBeCloseTo(contract.halfWidthZ, 3);
      expect(bounds.min[0]).toBeCloseTo(-contract.halfWidthX, 3);
      expect(bounds.min[2]).toBeCloseTo(-contract.halfWidthZ, 3);
      // The solid wall sits inside the thatch eaves, never outside the model.
      expect(spec.radius).toBeLessThan(Math.min(contract.halfWidthX, contract.halfWidthZ));
      expect(spec.radius).toBeGreaterThan(
        Math.min(contract.halfWidthX, contract.halfWidthZ) * 0.75,
      );
    },
  );
});
