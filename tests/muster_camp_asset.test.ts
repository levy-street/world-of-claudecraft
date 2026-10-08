import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  MUSTER_TORCH_FLAME_HEIGHT as CONTRACT_FLAME_HEIGHT,
  MUSTER_CAMP_MATERIALS,
  MUSTER_CAMP_PIECES,
} from '../scripts/assets/muster_camp/contract.mjs';
import {
  MUSTER_CAMP_SOURCE_FILES,
  musterCampSourceFingerprint,
} from '../scripts/assets/muster_camp/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { MUSTER_KIT_PROP_DEFS, MUSTER_TORCH_FLAME_HEIGHT } from '../src/render/muster_camps';
import {
  MUSTER_CLUTTER_KEYS,
  MUSTER_PIECE_SPECS,
  type MusterKitKey,
} from '../src/sim/muster_camp_layout';

// The Mirefen muster camp kit (image-to-glb pipeline, Blender factory at
// scripts/assets/muster_camp/model.py). Pins the source inventory, the live source
// fingerprint, and every shipped GLB byte for byte. A change to any fingerprinted
// file means re-running scripts/assets/muster_camp/export_muster_camp.mjs, then
// `node scripts/build_media_manifest.mjs generate`, then re-pinning below from the
// summary the exporter prints (sizes stay put on a fingerprint-only re-export).

const REPO_ROOT = path.join(__dirname, '..');
const SOURCE_FINGERPRINT = '33601f25a47ec9f1127addc6c5a0f6317cf8c0dc86056d7bcab63796308bdc83';

interface Pin {
  bytes: number;
  sha256: string;
  triangles: number;
  primitives: number;
  materials: string[];
}

const PINS: Record<MusterKitKey, Pin> = {
  musterPalisade: {
    bytes: 37_092,
    sha256: '14701a1aaa4d2ee83f414401dfca5c402797c5f6722d3b334c5945d3ebe04854',
    triangles: 1426,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterBarricade: {
    bytes: 41_688,
    sha256: 'ba69f63f96dad867b3f0ece403349e67b51d5d95d0eab0cac32395ee1a39bca0',
    triangles: 1760,
    primitives: 4,
    materials: ['MusterCloth', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterGate: {
    bytes: 54_372,
    sha256: '1b4b494c3e0fc56885de787c1b612ab34231a1f6c0138382d299cf1b5acea5d9',
    triangles: 2568,
    primitives: 4,
    materials: ['MusterCloth', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterWatchtower: {
    bytes: 68_272,
    sha256: 'd8dd105ec0f32f81d1dfb5f7d5a93448f04fa3e9604e6a3377daae74870f31cb',
    triangles: 3464,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterTentLarge: {
    bytes: 21_404,
    sha256: '200baf8c0b9c7c52d7121e65a64b8cb95aeb6bbc2f082d9f89c21e634e9dd9bc',
    triangles: 702,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterTentSmall: {
    bytes: 20_960,
    sha256: '8ec3a442d7cfd2388ad7b5023c1ef285bde3df5775b84b927abe27c716bd3dd4',
    triangles: 678,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterWeaponRack: {
    bytes: 43_748,
    sha256: '86d6568e98d7c5c1d5a271fd6410fbcf4aaef5b0320fbb7cb1c2909ff15f260d',
    triangles: 1830,
    primitives: 5,
    materials: ['MusterCloth', 'MusterCrystal', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterLanternPost: {
    bytes: 20_624,
    sha256: '139bdb085fbdffc794184a32cc9978d5bd044b44514f4c536a6b86ae01f1a369',
    triangles: 520,
    primitives: 5,
    materials: ['MusterCloth', 'MusterGlow', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterCrate: {
    bytes: 14_816,
    sha256: '6494ce4c36336bef893e2237fe3453761f02f4fe31452e5dac65858aa066bb92',
    triangles: 572,
    primitives: 2,
    materials: ['MusterIron', 'MusterWood'],
  },
  musterBarrel: {
    bytes: 7_548,
    sha256: '046ea77c14953542a2e34bd3331ccedc5ac6b13aa4b59d6f13454a1e8a93f358',
    triangles: 188,
    primitives: 2,
    materials: ['MusterIron', 'MusterWood'],
  },
  musterSacks: {
    bytes: 11_212,
    sha256: '1ca6b3aa6eb049b05b35d39595971040f39cd150436ccea9c122cfb651c88787',
    triangles: 408,
    primitives: 1,
    materials: ['MusterCloth'],
  },
  musterCartWheel: {
    bytes: 16_992,
    sha256: 'aa67f83edb0212292debf27aefa82a8f6e1ae84dcec28df92847164a4390dc8e',
    triangles: 620,
    primitives: 3,
    materials: ['MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterTorch: {
    bytes: 18_476,
    sha256: '27c60c5bf261f4cdd88ce02d025a0653d5319a71dc9bf93fc4e2011b43a4598c',
    triangles: 368,
    primitives: 5,
    materials: ['MusterCloth', 'MusterGlow', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
};

async function io(): Promise<NodeIO> {
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
}

describe('Mirefen muster camp kit pipeline', () => {
  it('pins the deterministic source inventory, the live fingerprint and the optimizer spec', () => {
    expect(MUSTER_CAMP_SOURCE_FILES).toEqual([
      'scripts/assets/muster_camp/model.py',
      'scripts/assets/muster_camp/contract.mjs',
      'scripts/assets/muster_camp/export_muster_camp.mjs',
      'scripts/assets/muster_camp/source_fingerprint.mjs',
      'scripts/assets/specs/muster_camp.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(musterCampSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/muster_camp.json'), 'utf8'),
    );
    expect(spec.items).toEqual(
      MUSTER_CAMP_PIECES.map((piece) => ({
        src: `tmp/asset_src/muster_camp/${piece.file}.glb`,
        out: `models/props/${piece.file}.glb`,
        type: 'static',
        keepExtras: true,
      })),
    );
  });

  it('keeps the contract, the props registry and the layout core on one key set', () => {
    const keys = MUSTER_CAMP_PIECES.map((piece) => piece.key).sort();
    expect(Object.keys(PINS).sort()).toEqual(keys);
    expect(Object.keys(MUSTER_KIT_PROP_DEFS).sort()).toEqual(keys);
    expect(Object.keys(MUSTER_PIECE_SPECS).sort()).toEqual(keys);
    for (const piece of MUSTER_CAMP_PIECES) {
      const key = piece.key as MusterKitKey;
      expect(MUSTER_KIT_PROP_DEFS[key]).toEqual({
        url: `/models/props/${piece.file}.glb`,
        kit: 'muster',
      });
      expect(MUSTER_CLUTTER_KEYS.has(key)).toBe(piece.tierClass === 'clutter');
    }
    expect(MUSTER_TORCH_FLAME_HEIGHT).toBe(CONTRACT_FLAME_HEIGHT);
  });

  for (const piece of MUSTER_CAMP_PIECES) {
    const key = piece.key as MusterKitKey;
    it(`pins ${piece.file}.glb: bytes, structure, vertex colour, bounds, fingerprint`, async () => {
      const pin = PINS[key];
      const rel = `models/props/${piece.file}.glb`;
      const bytes = readFileSync(path.join(REPO_ROOT, 'public', rel));
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(bytes.length).toBe(pin.bytes);
      expect(sha).toBe(pin.sha256);
      expect(bytes.length).toBeLessThanOrEqual(piece.maxBytes);
      expect(MEDIA_ASSETS[rel]).toBe(`/media/models/props/${piece.file}.${sha.slice(0, 12)}.glb`);

      const document = await (await io()).readBinary(bytes);
      const root = document.getRoot();
      expect(
        root
          .listExtensionsUsed()
          .map((extension) => extension.extensionName)
          .sort(),
      ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      expect(root.listSkins()).toHaveLength(0);
      expect(root.listScenes()).toHaveLength(1);

      let triangles = 0;
      let primitives = 0;
      const materials = new Set<string>();
      for (const mesh of root.listMeshes()) {
        for (const primitive of mesh.listPrimitives()) {
          primitives++;
          const position = primitive.getAttribute('POSITION');
          triangles += (primitive.getIndices()?.getCount() ?? position?.getCount() ?? 0) / 3;
          expect(
            primitive.getAttribute('COLOR_0'),
            `${rel} primitive without COLOR_0`,
          ).not.toBeNull();
          materials.add(primitive.getMaterial()?.getName() ?? '');
        }
      }
      expect(triangles).toBe(pin.triangles);
      expect(triangles).toBeLessThanOrEqual(piece.maxTriangles);
      expect(primitives).toBe(pin.primitives);
      expect([...materials].sort()).toEqual(pin.materials);
      for (const name of materials) expect(MUSTER_CAMP_MATERIALS).toContain(name);

      const scene = root.listScenes()[0];
      const roots = scene.listChildren();
      expect(roots.map((node) => node.getName())).toEqual([key[0].toUpperCase() + key.slice(1)]);
      const runtime = roots[0].getExtras().sculptRuntime as Record<string, unknown>;
      expect(runtime).toMatchObject({
        schemaVersion: 1,
        kitKey: key,
        stage: 'final',
        tierClass: piece.tierClass,
        coordinateFrame: { front: '+Z', up: '+Y', right: '+X', units: 'world-yards' },
        collider: { shippingCollisionMesh: false },
      });
      expect(root.getExtras().sourceFingerprint).toBe(SOURCE_FINGERPRINT);
      expect(
        (root.getAsset().extras as { sourceFingerprint?: string } | undefined)?.sourceFingerprint,
      ).toBe(SOURCE_FINGERPRINT);

      // floor-seated, centred, and the layout core's footprint matches the model
      const { min, max } = getBounds(scene);
      expect(Math.abs(min[1])).toBeLessThanOrEqual(0.01);
      expect(Math.abs(min[0] + max[0])).toBeLessThanOrEqual(0.02);
      expect(Math.abs(min[2] + max[2])).toBeLessThanOrEqual(0.02);
      const spec = MUSTER_PIECE_SPECS[key];
      // tents leave their guy ropes out of the box, the tower its ladder foot
      expect(spec.halfWidth).toBeLessThanOrEqual(max[0] + 0.05);
      expect(spec.halfWidth).toBeGreaterThanOrEqual(max[0] - 0.55);
      expect(spec.halfDepth).toBeLessThanOrEqual(max[2] + 0.05);
      expect(spec.halfDepth).toBeGreaterThanOrEqual(max[2] - 0.65);

      if (key === 'musterTorch') {
        const flame = root.listNodes().find((node) => node.getName() === 'Socket_Flame');
        expect(flame).toBeDefined();
        expect(flame?.getWorldTranslation()[1]).toBeCloseTo(MUSTER_TORCH_FLAME_HEIGHT, 3);
      }
    });
  }

  it('sizes the kit next to the 2.6 yd player: stakes, tower, rack', async () => {
    const heightOf = async (file: string): Promise<number> => {
      const document = await (await io()).readBinary(
        readFileSync(path.join(REPO_ROOT, 'public/models/props', `${file}.glb`)),
      );
      return getBounds(document.getRoot().listScenes()[0]).max[1];
    };
    const palisade = await heightOf('muster_palisade');
    expect(palisade).toBeGreaterThanOrEqual(3.5);
    expect(palisade).toBeLessThanOrEqual(4.8);
    const tower = await heightOf('muster_watchtower');
    expect(tower).toBeGreaterThanOrEqual(9);
    expect(tower).toBeLessThanOrEqual(10.5);
    const rack = await heightOf('muster_weapon_rack');
    expect(rack).toBeGreaterThan(2.6);
  });
});
