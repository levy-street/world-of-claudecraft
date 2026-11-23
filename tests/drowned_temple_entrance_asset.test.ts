// The Moon Stair's shipping GLBs (scripts/assets/drowned_temple_entrance/build.mjs,
// authored by docs/design/dungeon-rework/entrance/build_temple_entrance.py):
// exact bytes, the live authoring fingerprint, the media manifest rows, the
// Blender nodes and materials the runtime keys on, and the landmark budget
// (texture free, vertex colour only, meshopt; under 50,000 triangles and one
// megabyte across the three files, one node per fading unit so only the side
// that stands in the camera's way ghosts).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  DROWNED_TEMPLE_ENTRANCE_ASSETS,
  sourceFingerprint,
} from '../scripts/assets/drowned_temple_entrance/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { drownedTempleEntrancePreloadInternalsForTest } from '../src/render/drowned_temple_entrance';

const ROOT = path.join(__dirname, '..');

const PINS: Record<string, { sha: string; bytes: number; triangles: number; maxBytes: number }> = {
  'public/models/props/drowned_temple_entrance.glb': {
    sha: '18ce9695c3a71844243496a9508827ee2cd1c16af11f90f23f1d41205bddf18f',
    bytes: 510152,
    triangles: 26879,
    maxBytes: 560 * 1024,
  },
  'public/models/props/drowned_temple_entrance_works.glb': {
    sha: 'f5ce3c05506d501dff95bd15665e1395001e6bfaca3f6b0621c8dd9329dc34ef',
    bytes: 112944,
    triangles: 5792,
    maxBytes: 170 * 1024,
  },
  'public/models/props/drowned_temple_entrance_growth.glb': {
    sha: '9be43c8bf322c80b0612099e6076779385f70e03cf8a728357cdc00c96c4c188',
    bytes: 261416,
    triangles: 13106,
    maxBytes: 290 * 1024,
  },
};

describe('the Moon Stair shipping assets', () => {
  it('the runtime preloads exactly the three shipped GLBs', () => {
    expect(drownedTempleEntrancePreloadInternalsForTest.urls).toEqual(
      DROWNED_TEMPLE_ENTRANCE_ASSETS.map((a) => `/${a.target.replace(/^public\//, '')}`),
    );
    expect(Object.keys(PINS).sort()).toEqual(
      DROWNED_TEMPLE_ENTRANCE_ASSETS.map((a) => a.target).sort(),
    );
  });

  for (const asset of DROWNED_TEMPLE_ENTRANCE_ASSETS) {
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
      expect(root.listSkins()).toHaveLength(0);
      expect(
        doc
          .getRoot()
          .listExtensionsUsed()
          .map((e) => e.extensionName),
      ).toContain('EXT_meshopt_compression');
      expect(
        root
          .listMaterials()
          .map((m) => m.getName())
          .sort(),
      ).toEqual(asset.materials);
      // the leaf cards are the only double-sided surface
      for (const material of root.listMaterials()) {
        expect(material.getDoubleSided(), material.getName()).toBe(
          material.getName() === 'KitLeaf',
        );
      }
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

  it('every primitive of the three GLBs wears one attribute set, and nothing is instanced', async () => {
    // The camera ghost's depth veil (src/render/set_piece_occluders.ts) keys its
    // programs on face culling and the mesh variant the fade family reads
    // (tangent, colour, morphs, instancing), NOT on uv1 to uv3 presence, and it
    // gives an instanced mesh no veil at all. Both hold for this landmark as
    // long as its primitives all carry the same attributes and no node is
    // instanced; a rebuild that adds a second uv set or instancing must meet
    // this pin before it meets a cold link on the fade's edge frame.
    await MeshoptDecoder.ready;
    const sets = new Set<string>();
    let primitives = 0;
    for (const asset of DROWNED_TEMPLE_ENTRANCE_ASSETS) {
      const doc = await new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
        .readBinary(readFileSync(path.join(ROOT, asset.target)));
      const root = doc.getRoot();
      expect(
        root.listExtensionsUsed().map((e) => e.extensionName),
        asset.target,
      ).not.toContain('EXT_mesh_gpu_instancing');
      for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
          primitives++;
          sets.add(prim.listSemantics().slice().sort().join(','));
          expect(prim.listTargets(), `${asset.target} ${mesh.getName()}`).toHaveLength(0);
        }
      }
    }
    expect(primitives).toBeGreaterThanOrEqual(DROWNED_TEMPLE_ENTRANCE_ASSETS.length);
    expect([...sets]).toEqual(['COLOR_0,NORMAL,POSITION']);
  });

  it('the whole landmark stays inside its budget', () => {
    const pins = Object.values(PINS);
    expect(pins.reduce((sum, p) => sum + p.triangles, 0)).toBeLessThanOrEqual(50_000);
    expect(pins.reduce((sum, p) => sum + p.bytes, 0)).toBeLessThanOrEqual(1024 * 1024);
  });

  it("the model reaches from the weir's foot in the pit to the horn's tip and no further than its footprint", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const asset of DROWNED_TEMPLE_ENTRANCE_ASSETS) {
      const doc = await io.readBinary(readFileSync(path.join(ROOT, asset.target)));
      // scene bounds: the meshopt quantization scale lives on the nodes
      const bounds = getBounds(doc.getRoot().listScenes()[0]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], bounds.min[k]);
        max[k] = Math.max(max[k], bounds.max[k]);
      }
    }
    // door-local: x west, y up, z north. The whole horn's tip stands fifteen
    // yards over the door's ground (eight character heights); the weir's foot
    // is bedded in the pit eight yards under it; the weir reaches from the
    // east bank to the west one and the stelae stand behind the pool.
    expect(max[1]).toBeGreaterThan(14.5);
    expect(max[1]).toBeLessThan(16);
    expect(min[1]).toBeLessThan(-7.5);
    expect(min[1]).toBeGreaterThan(-10);
    expect(min[0]).toBeGreaterThan(-25);
    expect(max[0]).toBeLessThan(15.5);
    expect(min[2]).toBeGreaterThan(-32.5);
    expect(max[2]).toBeLessThan(21.5);
  });
});
