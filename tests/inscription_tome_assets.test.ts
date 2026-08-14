import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  INSCRIPTION_TOMES_SOURCE_FILES,
  inscriptionTomesSourceFingerprint,
} from '../scripts/assets/inscription_tomes/source_fingerprint.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';

// The three Masterwrought phase 06 inscription tome held models: the first
// held_offhand item GLBs, produced by the deterministic procedural pipeline
// (scripts/assets/inscription_tomes, the eastbrook mailbox archetype). Byte,
// hash, topology, budget, and fingerprint pins; the render-side wiring pins
// (ITEM_OFFHAND_MODELS rows, VAR_BOOK grips) live in
// tests/held_weapon_models.test.ts.

const REPO_ROOT = path.join(__dirname, '..');
// Re-pinned for the phase 07 merge of release/v0.37.0: the release bumped the
// three@0.165.0 patch hash in pnpm-lock.yaml, a pinned input of this family's
// source fingerprint, so the extras stamps and hashes were re-minted via
// scripts/assets/remint_lockfile_fingerprints.mjs. Geometry is unchanged
// (bytes, triangles, and bounds pins did not move).
const SOURCE_FINGERPRINT = '1fa804f97e8c97ea63faefc3570a4907c3f1c023f80fc1562662217ca5cb6ef5';

interface TomePin {
  itemId: string;
  rootName: string;
  bytes: number;
  sha256: string;
  triangles: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

const TOME_PINS: Record<string, TomePin> = {
  tome_silverleaf: {
    itemId: 'silverleaf_primer',
    rootName: 'InscriptionTomeSilverleaf',
    bytes: 11_136,
    sha256: 'a671d8a3003531b660ddf239fca31cd950ff68e35226eee250bf15cb86bbd551',
    triangles: 404,
    bounds: { min: [-0.1763, -0.1, -0.0555], max: [0.163, 0.3, 0.0622] },
  },
  tome_goldleaf: {
    itemId: 'goldleaf_folio',
    rootName: 'InscriptionTomeGoldleaf',
    bytes: 12_948,
    sha256: 'a4af1cabc3b6ec76d6e9d2761752cd150667eb81a1dbed4a2e15b5971cd7d0b4',
    triangles: 512,
    bounds: { min: [-0.1866, -0.1668, -0.0605], max: [0.1705, 0.33, 0.0672] },
  },
  tome_sunpetal: {
    itemId: 'sunpetal_grimoire',
    rootName: 'InscriptionTomeSunpetal',
    bytes: 13_956,
    sha256: '8c784e21653322521ac72a10590fc1cd6e01ad2777032cd7838ed8228c3c3c43',
    triangles: 584,
    bounds: { min: [-0.2007, -0.1668, -0.068], max: [0.1805, 0.36, 0.0863] },
  },
};

const BYTE_CEILING = 48 * 1024;
const TRIANGLE_CEILING = 2200;
const BOUNDS_TOLERANCE = 2e-3;

async function readGlb(key: string) {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(path.join(REPO_ROOT, `public/models/weapons/${key}.glb`));
}

describe('inscription tome held models', () => {
  it('pins the deterministic source inventory and the optimizer specification', () => {
    expect(INSCRIPTION_TOMES_SOURCE_FILES).toEqual([
      'docs/achievements/masterwrought-phase06-art/silverleaf_primer.svg',
      'docs/achievements/masterwrought-phase06-art/goldleaf_folio.svg',
      'docs/achievements/masterwrought-phase06-art/sunpetal_grimoire.svg',
      'scripts/assets/inscription_tomes/model.js',
      'scripts/assets/inscription_tomes/export_entry.js',
      'scripts/assets/inscription_tomes/export_inscription_tomes.mjs',
      'scripts/assets/inscription_tomes/source_fingerprint.mjs',
      'scripts/assets/specs/inscription_tomes.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(inscriptionTomesSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const spec = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'scripts/assets/specs/inscription_tomes.json'), 'utf8'),
    );
    expect(spec).toEqual({
      items: Object.keys(TOME_PINS).map((key) => ({
        src: `tmp/asset_src/inscription_tomes/${key}-final.glb`,
        out: `models/weapons/${key}.glb`,
        type: 'static',
        keepExtras: true,
      })),
    });
  });

  for (const [key, pin] of Object.entries(TOME_PINS)) {
    it(`${key}: bytes, hash, topology, budget, and fingerprint hold`, async () => {
      const filePath = path.join(REPO_ROOT, `public/models/weapons/${key}.glb`);
      const bytes = readFileSync(filePath);
      expect(bytes.length).toBe(pin.bytes);
      expect(bytes.length).toBeLessThanOrEqual(BYTE_CEILING);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256);

      const document = await readGlb(key);
      const root = document.getRoot();
      expect(
        root
          .listExtensionsRequired()
          .map((extension) => extension.extensionName)
          .sort(),
      ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
      expect(
        root
          .listExtensionsUsed()
          .map((extension) => extension.extensionName)
          .sort(),
      ).toEqual(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
      expect(root.listScenes()).toHaveLength(1);
      expect(root.listCameras()).toHaveLength(0);
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      expect(root.listSkins()).toHaveLength(0);

      const scene = root.listScenes()[0];
      expect(scene.listChildren().map((node) => node.getName())).toEqual([pin.rootName]);

      const meshes = root.listMeshes();
      expect(meshes).toHaveLength(2);
      let triangles = 0;
      const materialNames: string[] = [];
      for (const mesh of meshes) {
        const primitives = mesh.listPrimitives();
        expect(primitives).toHaveLength(1);
        const primitive = primitives[0];
        expect(primitive.getMode()).toBe(Primitive.Mode.TRIANGLES);
        expect(primitive.listSemantics().sort()).toEqual(['COLOR_0', 'NORMAL', 'POSITION']);
        materialNames.push(primitive.getMaterial()?.getName() ?? '');
        const indices = primitive.getIndices();
        const position = primitive.getAttribute('POSITION');
        triangles += (indices?.getCount() ?? position?.getCount() ?? 0) / 3;
      }
      expect(materialNames.sort()).toEqual(['TomeMetal', 'TomeOpaque']);
      expect(triangles).toBe(pin.triangles);
      expect(triangles).toBeLessThanOrEqual(TRIANGLE_CEILING);

      const bounds = getBounds(scene);
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(bounds.min[axis] - pin.bounds.min[axis]), `min[${axis}]`).toBeLessThan(
          BOUNDS_TOLERANCE,
        );
        expect(Math.abs(bounds.max[axis] - pin.bounds.max[axis]), `max[${axis}]`).toBeLessThan(
          BOUNDS_TOLERANCE,
        );
      }

      const runtimeNode = root.listNodes().find((node) => node.getExtras()?.sculptRuntime);
      expect(runtimeNode?.getName()).toBe(pin.rootName);
      const runtime = (
        runtimeNode?.getExtras() as {
          sculptRuntime?: {
            itemId?: string;
            stage?: string;
            coordinateFrame?: { front?: string; origin?: string };
          };
        }
      )?.sculptRuntime;
      expect(runtime?.itemId).toBe(pin.itemId);
      expect(runtime?.stage).toBe('final');
      expect(runtime?.coordinateFrame?.front).toBe('+Z');
      expect(runtime?.coordinateFrame?.origin).toBe('grip');

      // The stamped fingerprint matches a LIVE recompute over the pinned
      // source list, so editing any input without re-exporting turns this red.
      expect(root.getExtras()?.sourceFingerprint).toBe(SOURCE_FINGERPRINT);
      expect(inscriptionTomesSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    });

    it(`${key}: registered in the media manifest with its content hash`, () => {
      expect(MEDIA_ASSETS[`models/weapons/${key}.glb`]).toBe(
        `/media/models/weapons/${key}.${pin.sha256.slice(0, 12)}.glb`,
      );
    });
  }
});
