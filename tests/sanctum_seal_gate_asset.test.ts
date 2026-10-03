// The Seal Gate's shipping GLBs (scripts/assets/sanctum_seal_gate/build.mjs,
// authored by docs/design/dungeon-rework/entrance/build_sanctum_entrance.py):
// exact bytes, the live authoring fingerprint, the media manifest rows, the
// Blender nodes and materials the runtime keys on, and the open-world budget
// (docs: LORE_Y_ENTRADAS section 8, about 9,000 triangles and 150 KB for the
// main piece, vertex colour only, no textures).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  SANCTUM_SEAL_GATE_ASSETS,
  sourceFingerprint,
} from '../scripts/assets/sanctum_seal_gate/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { sanctumSealGatePreloadInternalsForTest } from '../src/render/sanctum_seal_gate';

const ROOT = path.join(__dirname, '..');

const PINS: Record<string, { sha: string; bytes: number; triangles: number; maxBytes: number }> = {
  'public/models/props/sanctum_seal_gate.glb': {
    sha: '9471577a536cff08546d973772efa1574c8bdd22ae2954dec5fe285f66c1ad24',
    bytes: 140812,
    triangles: 8504,
    maxBytes: 150 * 1024,
  },
  'public/models/props/sanctum_seal_gate_props.glb': {
    sha: '8ef3420bf4e30ae52d54a86283e7a1305bcb0f73a04f05bf3dbc31946258a202',
    bytes: 135988,
    triangles: 7742,
    maxBytes: 150 * 1024,
  },
  'public/models/props/sanctum_seal_gate_ice.glb': {
    sha: '1af7a36268c99827c0c15cf1ee62757cfbdb68e8efcdaae33a88badac5a1ba5f',
    bytes: 25340,
    triangles: 1231,
    maxBytes: 40 * 1024,
  },
};

describe('the Seal Gate shipping assets', () => {
  it('the runtime preloads exactly the three shipped GLBs', () => {
    expect(sanctumSealGatePreloadInternalsForTest.urls).toEqual(
      SANCTUM_SEAL_GATE_ASSETS.map((a) => `/${a.target.replace(/^public\//, '')}`),
    );
    expect(Object.keys(PINS).sort()).toEqual(SANCTUM_SEAL_GATE_ASSETS.map((a) => a.target).sort());
  });

  for (const asset of SANCTUM_SEAL_GATE_ASSETS) {
    it(`${asset.target}: exact bytes, live fingerprint, manifest row, nodes, materials, budget`, async () => {
      const pin = PINS[asset.target];
      const bytes = readFileSync(path.join(ROOT, asset.target));
      expect(bytes.length).toBe(pin.bytes);
      expect(bytes.length).toBeLessThanOrEqual(pin.maxBytes);
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(sha).toBe(pin.sha);
      const url = asset.target.replace(/^public\//, '');
      const stem = url.replace(/\.glb$/, '');
      expect(MEDIA_ASSETS[url]).toBe(`/media/${stem}.${sha.slice(0, 12)}.glb`);
      await MeshoptDecoder.ready;
      const doc = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .readBinary(bytes);
      const root = doc.getRoot();
      expect(root.getExtras().sourceFingerprint).toBe(sourceFingerprint(ROOT));
      expect(root.listTextures()).toHaveLength(0);
      expect(root.listAnimations()).toHaveLength(0);
      expect(
        root
          .listMaterials()
          .map((m) => m.getName())
          .sort(),
      ).toEqual(asset.materials);
      expect(
        root
          .listNodes()
          .map((n) => n.getName())
          .sort(),
      ).toEqual([asset.root, ...asset.pieces].sort());
      let triangles = 0;
      for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          expect(prim.listSemantics()).toContain('COLOR_0');
          triangles +=
            (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')?.getCount() ?? 0) / 3;
        }
      }
      expect(triangles).toBe(pin.triangles);
    });
  }

  it('the main gate stays inside the open-world budget', () => {
    expect(PINS['public/models/props/sanctum_seal_gate.glb'].triangles).toBeLessThanOrEqual(9000);
  });
});
