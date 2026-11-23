// The Jaguar Maw's shipping GLBs (scripts/assets/wildheart_basin_entrance/build.mjs,
// authored by docs/design/dungeon-rework/entrance/build_wildheart_entrance.py):
// exact bytes, the live authoring fingerprint, the media manifest rows, the
// Blender nodes and materials the runtime keys on, and the landmark budget
// (texture free, vertex colour only, meshopt, split in three files so the
// growth casts no shadow and the court ghosts apart from the idol; the three
// share one cull group and carry no LOD levels).
//
// The budget was 50,000 triangles and one megabyte (the Sunken Bastion
// entrance's, which ships 49,082 and 859 KB). The head is now a skin of fitted
// megaliths over a carved form, and with no texture every joint, chamfer,
// chip and weathering gradient inside a block is geometry and vertex colour:
// the idol alone is 39,618 triangles. The caps are 62,000 triangles and
// 1,230,000 bytes (the shipped totals plus about two percent), a one-off for
// this landmark and not the entrance family's number; the growth was cut from
// 22,735 to 17,072 to pay for part of it.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { describe, expect, it } from 'vitest';
import {
  sourceFingerprint,
  WILDHEART_BASIN_ENTRANCE_ASSETS,
} from '../scripts/assets/wildheart_basin_entrance/build.mjs';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { wildheartBasinEntrancePreloadInternalsForTest } from '../src/render/wildheart_basin_entrance';
import {
  WILDHEART_EAR_TOP,
  WILDHEART_OVERHANG_SOLIDS,
} from '../src/render/wildheart_basin_entrance_core';

const ROOT = path.join(__dirname, '..');

const PINS: Record<string, { sha: string; bytes: number; triangles: number; maxBytes: number }> = {
  'public/models/props/wildheart_basin_entrance.glb': {
    sha: '1d8c81c3104724698b72f8b2e7803106e6213954bb977b852c77c729ad9c99a2',
    bytes: 724112,
    triangles: 39618,
    maxBytes: 740 * 1024,
  },
  'public/models/props/wildheart_basin_entrance_court.glb': {
    sha: 'a4bb7c0d31b60198795a0ae7b28a7e03f43951e534fea922fb3b80221fb2641e',
    bytes: 92348,
    triangles: 4738,
    maxBytes: 120 * 1024,
  },
  'public/models/props/wildheart_basin_entrance_growth.glb': {
    sha: 'abfeaedc4eb0bdc40389bf9bf5a17d11978076e97b74054a5a0cb70f9822b1b8',
    bytes: 390596,
    triangles: 17072,
    maxBytes: 400 * 1024,
  },
};

describe('the Jaguar Maw shipping assets', () => {
  it('the runtime preloads exactly the three shipped GLBs', () => {
    expect(wildheartBasinEntrancePreloadInternalsForTest.urls).toEqual(
      WILDHEART_BASIN_ENTRANCE_ASSETS.map((a) => `/${a.target.replace(/^public\//, '')}`),
    );
    expect(Object.keys(PINS).sort()).toEqual(
      WILDHEART_BASIN_ENTRANCE_ASSETS.map((a) => a.target).sort(),
    );
  });

  for (const asset of WILDHEART_BASIN_ENTRANCE_ASSETS) {
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
    for (const asset of WILDHEART_BASIN_ENTRANCE_ASSETS) {
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
    expect(primitives).toBeGreaterThanOrEqual(WILDHEART_BASIN_ENTRANCE_ASSETS.length);
    expect([...sets]).toEqual(['COLOR_0,NORMAL,POSITION']);
  });

  it('the whole landmark stays inside its budget', () => {
    const pins = Object.values(PINS);
    // the shipped totals (61,428 triangles, 1,207,056 bytes) plus about two
    // percent: a named one-off for this landmark, not the family's number
    expect(pins.reduce((sum, p) => sum + p.triangles, 0)).toBeLessThanOrEqual(62_000);
    expect(pins.reduce((sum, p) => sum + p.bytes, 0)).toBeLessThanOrEqual(1_230_000);
  });

  it('the stone over head height stands inside the overhang occluder boxes', async () => {
    // The skull is carved wider than its collider rows and the upper jaw
    // hangs over the way in. The render ghosts that stone through
    // WILDHEART_OVERHANG_SOLIDS: a rebuild that carves it further out must
    // move those boxes with it. Read here from the shipped file: every vertex
    // of the idol from the jaw's underside to the ears' tips (the fig's limbs
    // start over them).
    await MeshoptDecoder.ready;
    const doc = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .readBinary(readFileSync(path.join(ROOT, WILDHEART_BASIN_ENTRANCE_ASSETS[0].target)));
    const [jaw, skull] = WILDHEART_OVERHANG_SOLIDS;
    const inside = (o: (typeof WILDHEART_OVERHANG_SOLIDS)[number], x: number, lz: number) =>
      Math.abs(x - o.lx) <= o.hw && Math.abs(lz - o.lz) <= o.hd;
    let seen = 0;
    let outside = 0;
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute('POSITION');
        if (!position) continue;
        const v = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);
          const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          const lz = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
          if (y < jaw.baseY || y > WILDHEART_EAR_TOP) continue;
          seen++;
          if (!inside(jaw, x, lz) && !inside(skull, x, lz)) outside++;
        }
      }
    }
    expect(seen).toBeGreaterThan(40_000);
    expect(outside).toBe(0);
  });

  it("the ears' tips stand under the top of the head's occluder box", async () => {
    // The ears are the idol's highest stone, over the sim's camera top for
    // the head (15.8) and over the crown (17.2). The render raises the head's
    // occluder box to WILDHEART_EAR_TOP: a rebuild that grows the ears must
    // move that number with them. Read here from the shipped file: the stone
    // over each skull corner, under the fig's fork (its limbs start at 23).
    await MeshoptDecoder.ready;
    const doc = await new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
      .readBinary(readFileSync(path.join(ROOT, WILDHEART_BASIN_ENTRANCE_ASSETS[0].target)));
    const tips = { west: -Infinity, east: -Infinity };
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const m = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute('POSITION');
        if (!position) continue;
        const v = [0, 0, 0];
        for (let i = 0; i < position.getCount(); i++) {
          position.getElement(i, v);
          const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          const lz = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
          if (y < 17.4 || y > 22 || lz < 2 || lz > 9.5 || Math.abs(x) < 4.5) continue;
          const side = x > 0 ? 'west' : 'east';
          tips[side] = Math.max(tips[side], y);
        }
      }
    }
    // both ears stand over the crown (the east one has lost its outer corner,
    // and the idol's lean lifts what is left of it over the west one's tip)
    for (const tip of [tips.west, tips.east]) {
      expect(tip).toBeGreaterThan(18.5);
      expect(tip).toBeLessThanOrEqual(WILDHEART_EAR_TOP);
      expect(WILDHEART_EAR_TOP - tip).toBeLessThan(1);
    }
  });

  it("the model reaches from under the bank to the fig's crown and no further than its footprint", async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const bounds: Record<string, { min: number[]; max: number[] }> = {};
    for (const asset of WILDHEART_BASIN_ENTRANCE_ASSETS) {
      const doc = await io.readBinary(readFileSync(path.join(ROOT, asset.target)));
      // scene bounds: the meshopt quantization scale lives on the nodes
      const b = getBounds(doc.getRoot().listScenes()[0]);
      bounds[asset.pieces[0]] = { min: [...b.min], max: [...b.max] };
    }
    // door-local: x west, y up, z north. The door stands on a rise: the
    // idol's foot is cut under the bank on its lagoon side, five yards under
    // the door, and its roots run on down into the shallows, six yards under;
    // the fig rooted in its crown carries its limbs (in the idol's file) and
    // its leaves (the growth) to eighteen character heights over the door,
    // clear of the ears.
    const idol = bounds.Entrance_Idol;
    expect(idol.max[1]).toBeGreaterThan(24);
    expect(idol.max[1]).toBeLessThan(34);
    expect(idol.min[1]).toBeLessThan(-5);
    expect(idol.min[1]).toBeGreaterThan(-7.5);
    const growth = bounds.Entrance_Growth;
    expect(growth.max[1]).toBeGreaterThan(27);
    expect(growth.max[1]).toBeLessThan(36);
    // the causeway's foot, fifteen yards before the door
    const court = bounds.Entrance_Court;
    expect(court.min[2]).toBeLessThan(-14);
    for (const b of Object.values(bounds)) {
      // east it stops well short of the ring of columns (its edge is eleven
      // yards east of the door); west and north it reaches the lagoon
      expect(b.min[0]).toBeGreaterThan(-13);
      expect(b.max[0]).toBeLessThan(21);
      expect(b.min[2]).toBeGreaterThan(-19);
      expect(b.max[2]).toBeLessThan(24);
    }
  });
});
