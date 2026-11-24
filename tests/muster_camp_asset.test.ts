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
const SOURCE_FINGERPRINT = 'e3ae415949ad45f23642bb5efa86089e71f48c0afbd1c0d5bcc57bc2e8ebfa54';

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
    sha256: '403d253c8470249291deb582fcc7c883c23b8b5f3d2e0c60debe8af731e7fc8f',
    triangles: 1426,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterBarricade: {
    bytes: 41_688,
    sha256: 'd0d368d55f7a9c036cf64aa3e5896af52557176270650370571b47274f50cb72',
    triangles: 1760,
    primitives: 4,
    materials: ['MusterCloth', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterGate: {
    bytes: 54_372,
    sha256: 'e073373cf629370f9e329d0c4574aa8016f8ec86d43631d599f040001e5ffcc6',
    triangles: 2568,
    primitives: 4,
    materials: ['MusterCloth', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterWatchtower: {
    bytes: 68_272,
    sha256: '6c284ce9346b98bdd59f0b7f706ad421d28ccb4a1bcc0b4efacc9584700aa42d',
    triangles: 3464,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterTentLarge: {
    bytes: 21_404,
    sha256: '1dab5280289193a03440c8b09e758cdaacab026c25a6d40e62cf43fe9e92a272',
    triangles: 702,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterTentSmall: {
    bytes: 20_960,
    sha256: '2646398de502934a350dd740191b863aa9de281d3c2fbd8f9801dbc04f90f07d',
    triangles: 678,
    primitives: 3,
    materials: ['MusterCloth', 'MusterRock', 'MusterWood'],
  },
  musterWeaponRack: {
    bytes: 43_748,
    sha256: '483e1cc3334e2c81855907d482b4d3e0bb57fef4917ad0a0e00edba6d26e4c24',
    triangles: 1830,
    primitives: 5,
    materials: ['MusterCloth', 'MusterCrystal', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterLanternPost: {
    bytes: 20_624,
    sha256: '9dcfa64f1c392d9968b654d868d91d3cc73954f8fc06dc11ed3d429e8302ff72',
    triangles: 520,
    primitives: 5,
    materials: ['MusterCloth', 'MusterGlow', 'MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterCrate: {
    bytes: 14_816,
    sha256: '60c5dfcf529e71c15704f22cae8791ab08ec1937f78f4dcbe0c1ed6d3b80c4a0',
    triangles: 572,
    primitives: 2,
    materials: ['MusterIron', 'MusterWood'],
  },
  musterBarrel: {
    bytes: 7_548,
    sha256: 'b543e0d089b03b26b8598401f5bd69ad3628af7491b1e7cd7c42e57326501e70',
    triangles: 188,
    primitives: 2,
    materials: ['MusterIron', 'MusterWood'],
  },
  musterSacks: {
    bytes: 11_212,
    sha256: '522e93d32eefd1651a19bb7eba670eec451def785ebc436fb549d1aa116fd7c6',
    triangles: 408,
    primitives: 1,
    materials: ['MusterCloth'],
  },
  musterCartWheel: {
    bytes: 16_992,
    sha256: '9c09c272569a94758d6f4d15e8ddea33cfe60b853a00c22ef280e8fdffc09239',
    triangles: 620,
    primitives: 3,
    materials: ['MusterIron', 'MusterRock', 'MusterWood'],
  },
  musterTorch: {
    bytes: 18_476,
    sha256: 'a65e6bdf3159e173a0d3c452982b30453149fc6c5ce61ac6ba391d805abf4283',
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
