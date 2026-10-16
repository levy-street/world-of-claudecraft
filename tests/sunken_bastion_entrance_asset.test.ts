// The Drowned Gate Tower's shipping GLBs (scripts/assets/sunken_bastion_entrance/build.mjs,
// authored by docs/design/dungeon-rework/entrance/build_bastion_entrance.py):
// exact bytes, the live authoring fingerprint, the media manifest rows, the
// Blender nodes and materials the runtime keys on, and the landmark budget
// (texture free, vertex colour only, meshopt; under 50,000 triangles and one
// megabyte across the three files, split so the growth and the ruins cull and
// shed apart from the gatehouse).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  SUNKEN_BASTION_ENTRANCE_ASSETS,
  sourceFingerprint,
} from '../scripts/assets/sunken_bastion_entrance/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { sunkenBastionEntrancePreloadInternalsForTest } from '../src/render/sunken_bastion_entrance';

const ROOT = path.join(__dirname, '..');

const PINS: Record<string, { sha: string; bytes: number; triangles: number; maxBytes: number }> = {
  'public/models/props/sunken_bastion_entrance.glb': {
    sha: '17d8f74d830bd2b2d4bda48f1984726e9575b5caa9dec1b1a04fc7830732321b',
    bytes: 476212,
    triangles: 28172,
    maxBytes: 560 * 1024,
  },
  'public/models/props/sunken_bastion_entrance_ruins.glb': {
    sha: 'd01c78b22b15891fd2b60d15d8194d81356252e7b6a21ff889f81a53095eb598',
    bytes: 141212,
    triangles: 6488,
    maxBytes: 190 * 1024,
  },
  'public/models/props/sunken_bastion_entrance_growth.glb': {
    sha: '4947bbc6bb476335a2cb79eea2dc1b26e450b87ad969b17f51c8c89f4cc1bfaf',
    bytes: 241536,
    triangles: 14422,
    maxBytes: 280 * 1024,
  },
};

describe('the Drowned Gate Tower shipping assets', () => {
  it('the runtime preloads exactly the three shipped GLBs', () => {
    expect(sunkenBastionEntrancePreloadInternalsForTest.urls).toEqual(
      SUNKEN_BASTION_ENTRANCE_ASSETS.map((a) => `/${a.target.replace(/^public\//, '')}`),
    );
    expect(Object.keys(PINS).sort()).toEqual(
      SUNKEN_BASTION_ENTRANCE_ASSETS.map((a) => a.target).sort(),
    );
  });

  for (const asset of SUNKEN_BASTION_ENTRANCE_ASSETS) {
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
      // the leaf cards and the cloth are the only double-sided surface
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
    for (const asset of SUNKEN_BASTION_ENTRANCE_ASSETS) {
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
    expect(primitives).toBeGreaterThanOrEqual(SUNKEN_BASTION_ENTRANCE_ASSETS.length);
    expect([...sets]).toEqual(['COLOR_0,NORMAL,POSITION']);
  });

  it('the whole landmark stays inside its budget', () => {
    const pins = Object.values(PINS);
    expect(pins.reduce((sum, p) => sum + p.triangles, 0)).toBeLessThanOrEqual(50_000);
    expect(pins.reduce((sum, p) => sum + p.bytes, 0)).toBeLessThanOrEqual(1024 * 1024);
  });

  it("the model reaches from the knoll's foot to the west tower's crown and no further than its footprint", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const asset of SUNKEN_BASTION_ENTRANCE_ASSETS) {
      const doc = await io.readBinary(readFileSync(path.join(ROOT, asset.target)));
      // scene bounds: the meshopt quantization scale lives on the nodes
      const bounds = getBounds(doc.getRoot().listScenes()[0]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], bounds.min[k]);
        max[k] = Math.max(max[k], bounds.max[k]);
      }
    }
    // door-local: x west, y up, z north. The west tower's crown stands seven
    // character heights over the door; the knoll falls away steeply, so the
    // lowest rubble on its west slope lies well under the door's own height.
    expect(max[1]).toBeGreaterThan(12.5);
    expect(max[1]).toBeLessThan(15.5);
    expect(min[1]).toBeLessThan(-6);
    expect(min[1]).toBeGreaterThan(-11);
    expect(min[0]).toBeGreaterThan(-24);
    expect(max[0]).toBeLessThan(14);
    expect(min[2]).toBeGreaterThan(-14);
    expect(max[2]).toBeLessThan(11);
  });
});
