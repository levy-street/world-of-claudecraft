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

// The four Masterwrought inscription tome held models: the first held_offhand
// item GLBs, produced by the deterministic procedural pipeline
// (scripts/assets/inscription_tomes, the eastbrook mailbox archetype). Byte,
// hash, topology, budget, and fingerprint pins; the render-side wiring pins
// (ITEM_OFFHAND_MODELS rows, VAR_BOOK grips) live in
// tests/held_weapon_models.test.ts.
//
// The family is the phase 06 trio plus the phase 09 apex voidbound grimoire,
// which joined at phase 18 and took voidbound_grimoire out of the conscious
// no-model pin in tests/held_weapon_models.test.ts in the same change.

const REPO_ROOT = path.join(__dirname, '..');
// pnpm-lock.yaml is a pinned input of this family's source fingerprint, so
// every release lockfile bump re-mints the extras stamps and hashes via
// scripts/assets/remint_lockfile_fingerprints.mjs with the geometry unchanged
// (bytes, triangles, and bounds pins never move): first for the v0.37.0
// three@0.165.0 patch-hash bump, then v0.38.0, and most recently for the
// v0.39.0 merge's Three.js r165 to r185 bump (patches/three@0.185.1.patch).
// Moved again at phase 18 by a REAL source change, not an absorb: the family
// gained a fourth tome (model.js, the spec, the exporter, and the phase 09
// reference SVG), so all four GLBs were re-exported from source. The three
// phase 06 tomes came back byte-identical in size, triangles and bounds, with
// only their stamped fingerprint (and so their sha256) moved. That re-export
// also discharged the v0.42.0 lockfile drift this family still owed.
// Re-minted during PR cleanup after moving non-shipping preview output from a
// retired screenshot directory into ignored tmp/. Geometry and byte counts did
// not change; only the two source-fingerprint stamps and resulting hashes did.
// Re-minted 2026-09-08 via scripts/assets/remint_lockfile_fingerprints.mjs after
// the release/v0.42.0 merge moved pnpm-lock.yaml (a fingerprint input, leaf-only
// hash change) for this four-tome family: both extras stamps on every GLB were
// restamped in place with byte counts, triangles, and bounds held exactly. No
// source file changed.
const SOURCE_FINGERPRINT = '4a1397df8d238778158103603db2e2b515db820aa8aa74bc60e08c20804174bc';

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
    sha256: 'f6bc18b341bbe861a73af99c8fdde3cd6212679e57b55f4c7bdf1939f650c671',
    triangles: 404,
    bounds: { min: [-0.1763, -0.1, -0.0555], max: [0.163, 0.3, 0.0622] },
  },
  tome_goldleaf: {
    itemId: 'goldleaf_folio',
    rootName: 'InscriptionTomeGoldleaf',
    bytes: 12_948,
    sha256: '9143d80d07e037970b654e0b26073afaf08afafe4f4661b2afb124158aaad308',
    triangles: 512,
    bounds: { min: [-0.1866, -0.1668, -0.0605], max: [0.1705, 0.33, 0.0672] },
  },
  tome_sunpetal: {
    itemId: 'sunpetal_grimoire',
    rootName: 'InscriptionTomeSunpetal',
    bytes: 13_956,
    sha256: 'b60102a7f97357d8c77ce164fbeda7ee941ae5a3ca84d316120a7dcd3f8564ea',
    triangles: 584,
    bounds: { min: [-0.2007, -0.1668, -0.068], max: [0.1805, 0.36, 0.0863] },
  },
  // The phase 09 apex rung: the largest of the family, no bookmark ribbon (the
  // icon's fore-edge clasp holds it shut instead), and a void sigil in place of
  // the leaf or the sun boss.
  tome_voidbound: {
    itemId: 'voidbound_grimoire',
    rootName: 'InscriptionTomeVoidbound',
    bytes: 16_556,
    sha256: '6c0d21111805627c8390d26534f6948b1efb0997c4a59f5aa2f55b305ba038b2',
    triangles: 724,
    bounds: { min: [-0.211, -0.1, -0.073], max: [0.188, 0.38, 0.086] },
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
      'docs/achievements/masterwrought-phase09-art/voidbound_grimoire.svg',
      'scripts/assets/inscription_tomes/model.js',
      'scripts/assets/inscription_tomes/export_entry.js',
      'scripts/assets/inscription_tomes/export_inscription_tomes.mjs',
      'scripts/assets/inscription_tomes/source_fingerprint.mjs',
      'scripts/assets/specs/inscription_tomes.json',
      'scripts/assets/build_assets.mjs',
      'pnpm-lock.yaml',
    ]);
    expect(inscriptionTomesSourceFingerprint(REPO_ROOT)).toBe(SOURCE_FINGERPRINT);
    const exporter = readFileSync(
      path.join(REPO_ROOT, 'scripts/assets/inscription_tomes/export_inscription_tomes.mjs'),
      'utf8',
    );
    expect(exporter).toContain("path.join(ROOT, 'tmp/inscription_tomes_preview')");
    expect(exporter).not.toContain('docs/screenshots/');
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
