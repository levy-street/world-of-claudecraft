// The Seal Gate's shipping GLBs (scripts/assets/sanctum_seal_gate/build.mjs,
// authored by docs/design/dungeon-rework/entrance/build_sanctum_entrance.py):
// exact bytes, the live authoring fingerprint, the media manifest rows, the
// Blender nodes and materials the runtime keys on, and the set piece's
// open-world budget: the three GLBs together at most 62,000 triangles and
// 1,230,000 bytes (the Wildheart entrance's ceiling), vertex colour only, no
// textures.
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
    sha: '3b5d07ab0adad7bbd65b0d219edb16931501280705692b81a5aaf6526db981b3',
    bytes: 231376,
    triangles: 34656,
    maxBytes: 600 * 1024,
  },
  'public/models/props/sanctum_seal_gate_props.glb': {
    sha: '3d1231fdd49182140bb447df9487a1fb004d7ebf5c5d7dcfdb5505574cd07564',
    bytes: 174740,
    triangles: 14726,
    maxBytes: 400 * 1024,
  },
  'public/models/props/sanctum_seal_gate_ice.glb': {
    sha: 'b502616fd9128591602a13b12dbd9d5226e7fcb9f9710f233fbc317fdd09a5ea',
    bytes: 64384,
    triangles: 9563,
    maxBytes: 200 * 1024,
  },
};

/** The whole set piece's open-world ceiling (the Wildheart entrance's). */
const SET_PIECE_MAX_TRIANGLES = 62000;
const SET_PIECE_MAX_BYTES = 1230000;

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

  it('the three GLBs together stay inside the set piece budget', () => {
    const pins = Object.values(PINS);
    const triangles = pins.reduce((sum, pin) => sum + pin.triangles, 0);
    const bytes = SANCTUM_SEAL_GATE_ASSETS.reduce(
      (sum, asset) => sum + readFileSync(path.join(ROOT, asset.target)).length,
      0,
    );
    expect(triangles).toBeLessThanOrEqual(SET_PIECE_MAX_TRIANGLES);
    expect(bytes).toBeLessThanOrEqual(SET_PIECE_MAX_BYTES);
    // the gate itself carries the most detail; the far icefall the least of the masses
    expect(PINS['public/models/props/sanctum_seal_gate.glb'].triangles).toBeGreaterThan(
      PINS['public/models/props/sanctum_seal_gate_ice.glb'].triangles,
    );
  });
});
