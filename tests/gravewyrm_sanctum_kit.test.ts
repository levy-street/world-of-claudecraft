// The Gravewyrm Sanctum kit's contracts (scripts/assets/gravewyrm_sanctum_kit/
// build.mjs, built from docs/design/dungeon-rework/kit/build_gravewyrm_sanctum_kit.py):
// the shipped GLB is the current sources' (fingerprint, nodes, materials), it
// fits the dungeon kit budget (README section 11: at most 4 MB), every piece
// carries a sane triangle count, and the pieces the runtime animates, tiles or
// walks on keep their contract sizes and frames:
//   - the walkable decks (the Ice Bridge, the Chain Bridge) lie flat on their
//     origin, and the lips (crevasse edges, rock cliff) never rise above theirs;
//   - the ice wall's shards compose one 14 x 9 wall in a shared frame;
//   - the Calving Face is a hundred yards of ice, and the wyrm and its heart
//     lie inside it, behind its front, in the same frame;
//   - the gate tunnel's opening is clear, the seal pillars stand 12 yd.
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  GRAVEWYRM_SANCTUM_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/gravewyrm_sanctum_kit/build.mjs';

const KIT = ASSET.target;
const haveKit = existsSync(KIT);

type V3 = [number, number, number];
interface Shape {
  min: V3;
  max: V3;
  points: V3[];
  triangles: number;
  materials: Set<string>;
}

const shapes = new Map<string, Shape>();
let extras: Record<string, unknown> = {};
let nodeNames: string[] = [];
let materialNames: string[] = [];

beforeAll(async () => {
  if (!haveKit) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(KIT)));
  extras = (doc.getRoot().getExtras() ?? {}) as Record<string, unknown>;
  nodeNames = doc
    .getRoot()
    .listNodes()
    .map((n) => n.getName())
    .sort();
  materialNames = doc
    .getRoot()
    .listMaterials()
    .map((m) => m.getName())
    .sort();
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_')) continue;
    const points: V3[] = [];
    const materials = new Set<string>();
    let triangles = 0;
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      materials.add(prim.getMaterial()?.getName() ?? '');
      triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        points.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
    }
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of points)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    shapes.set(name, { min, max, points, triangles, materials });
  }
});

const shape = (name: string): Shape => shapes.get(name) as Shape;

describe('Gravewyrm Sanctum kit: the piece list and the shipped GLB', () => {
  it('lists every piece of the design once, the showpiece and the gates included', () => {
    const list = GRAVEWYRM_SANCTUM_KIT_PIECES;
    expect(new Set(list).size).toBe(list.length);
    for (const piece of [
      'CalvingFace',
      'FaceCalved',
      'FaceCrack_0',
      'FaceCrack_1',
      'FacePlateFallen',
      'FaceCrack_2a',
      'FaceCrack_2d',
      'FaceCrack_3',
      'WyrmSilhouette',
      'WyrmHeart',
      'RuneWall',
      'ChainAnchor',
      'SmithsHammer',
      'ChainBridge',
      'GateTunnel',
      'KeystoneSocket',
      'IcePlate',
      'IcePlateCracked',
      'ChainGate',
      'ChainGatePost',
      'IceWall_A',
      'IceWall_G',
      'SealPillar_Hammer',
      'SealPillarCracked_Bellows',
      'SealShackle',
    ])
      expect(list, piece).toContain(piece);
    for (const p of list) expect(p, p).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...GRAVEWYRM_SANCTUM_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it.skipIf(!haveKit)('keeps every piece inside its triangle budget', () => {
    // Tiles drawn by the dozen stay light; a hero piece at most 24k.
    const tiles = new Set([
      'Kit_CrevasseEdgeA',
      'Kit_CrevasseEdgeB',
      'Kit_CrevasseEdgeC',
      'Kit_ChainLink',
      'Kit_ChainBridge',
      'Kit_RockCliff',
      'Kit_HaulRoadKerb',
      'Kit_MeltChannel',
      'Kit_IcePlate',
      'Kit_IcePlateCracked',
      'Kit_PressureRidge',
      'Kit_Sastrugi',
    ]);
    let total = 0;
    for (const [name, s] of shapes) {
      expect(s.triangles, name).toBeGreaterThan(0);
      expect(s.triangles, name).toBeLessThanOrEqual(tiles.has(name) ? 2500 : 24000);
      total += s.triangles;
    }
    expect(total).toBeLessThan(400_000);
  });

  it.skipIf(!haveKit)('puts the glow and the clear ice where the runtime expects them', () => {
    expect(shape('Kit_WyrmHeart').materials).toEqual(new Set(['KitGlow']));
    expect(shape('Kit_CalvingFace').materials.has('KitGlass')).toBe(true);
    expect(shape('Kit_FaceCrack_3').materials.has('KitGlow')).toBe(true);
    expect(shape('Kit_IcePlateCracked').materials.has('KitGlow')).toBe(true);
    expect(shape('Kit_IcePlate').materials.has('KitGlow')).toBe(false);
    for (const t of ['Hammer', 'Tongs', 'Anvil', 'Bellows'])
      expect(shape(`Kit_SealPillar_${t}`).materials.has('KitGlow'), t).toBe(true);
  });
});

describe('Gravewyrm Sanctum kit: the walked, tiled and animated pieces', () => {
  it.skipIf(!haveKit)('lays both bridge decks flat on their origin', () => {
    const chain = shape('Kit_ChainBridge');
    // A 12.5 yd module along X (links run past both ends), about 6 wide.
    expect(chain.max[1]).toBeLessThanOrEqual(0.05);
    expect(chain.max[2] - chain.min[2]).toBeGreaterThan(5.5);
    expect(chain.max[2] - chain.min[2]).toBeLessThan(7.5);
    const deck = chain.points.filter((p) => Math.abs(p[0]) < 5.5 && Math.abs(p[2]) < 2.2);
    expect(Math.max(...deck.map((p) => p[1]))).toBeGreaterThan(-0.1);
    const ice = shape('Kit_IceBridge');
    expect(ice.max[0] - ice.min[0]).toBeGreaterThan(26);
    const top = ice.points.filter((p) => Math.abs(p[0]) < 12 && Math.abs(p[2]) < 2.4);
    for (const p of top) expect(p[1]).toBeLessThan(0.3);
    expect(Math.max(...top.map((p) => p[1]))).toBeGreaterThan(-0.1);
  });

  it.skipIf(!haveKit)('keeps every lip at or under its origin', () => {
    for (const k of ['A', 'B']) expect(shape(`Kit_CrevasseEdge${k}`).max[1]).toBeLessThan(0.05);
    expect(shape('Kit_CrevasseEdgeC').max[1]).toBeLessThan(0.46);
    expect(shape('Kit_RockCliff').max[1]).toBeLessThan(0.05);
    for (const k of ['A', 'B', 'C']) expect(shape(`Kit_CrevasseEdge${k}`).min[1]).toBeLessThan(-60);
  });

  it.skipIf(!haveKit)('composes the ice wall from its shards in one frame', () => {
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    for (const k of 'ABCDEFG') {
      const s = shape(`Kit_IceWall_${k}`);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], s.min[i]);
        max[i] = Math.max(max[i], s.max[i]);
      }
    }
    expect(max[0] - min[0]).toBeGreaterThan(13.5);
    expect(max[0] - min[0]).toBeLessThan(15);
    expect(max[1]).toBeGreaterThan(8.8);
    expect(max[1]).toBeLessThan(10);
    expect(min[1]).toBeGreaterThan(-0.3);
  });

  it.skipIf(!haveKit)('stands the seal pillars 12 yd with their rings over them', () => {
    for (const t of ['Hammer', 'Tongs', 'Anvil', 'Bellows'])
      for (const prefix of ['Kit_SealPillar_', 'Kit_SealPillarCracked_']) {
        const s = shape(prefix + t);
        expect(s.max[1], prefix + t).toBeGreaterThan(12);
        expect(s.max[1], prefix + t).toBeLessThan(16);
        expect(s.min[1], prefix + t).toBeGreaterThan(-0.5);
      }
  });

  it.skipIf(!haveKit)('keeps the gate tunnel 12 wide and its opening clear', () => {
    const t = shape('Kit_GateTunnel');
    // The bore runs toward the glTF's -Z (the kit's +Y); nothing stands in it
    // (10 wide and 7.5 high anywhere; the vault rises to 11 in the middle).
    const blocked = t.points.filter(
      (p) => Math.abs(p[0]) < 5 && p[1] > 0.3 && p[1] < 7.5 && p[2] < -0.5 && p[2] > -20,
    );
    expect(blocked).toEqual([]);
    expect(t.max[0] - t.min[0]).toBeGreaterThan(28);
  });

  it.skipIf(!haveKit)('sizes the mast-thick chain link and the hammer', () => {
    const link = shape('Kit_ChainLink');
    expect(link.max[0] - link.min[0]).toBeGreaterThan(9.5);
    expect(link.max[0] - link.min[0]).toBeLessThan(10);
    expect(link.max[1] - link.min[1]).toBeGreaterThan(5.8);
    const hammer = shape('Kit_SmithsHammer');
    expect(hammer.max[0] - hammer.min[0]).toBeGreaterThan(5);
    expect(hammer.max[2] - hammer.min[2]).toBeGreaterThan(12);
  });
});

describe('Gravewyrm Sanctum kit: the Calving Face and the wyrm inside it', () => {
  it.skipIf(!haveKit)('raises a hundred yards of ice 160 wide', () => {
    const face = shape('Kit_CalvingFace');
    expect(face.max[0] - face.min[0]).toBeGreaterThan(140);
    expect(face.max[0] - face.min[0]).toBeLessThan(181);
    expect(face.max[1]).toBeGreaterThan(95);
    const calved = shape('Kit_FaceCalved');
    expect(Math.abs(calved.max[0] - face.max[0])).toBeLessThan(1);
  });

  it.skipIf(!haveKit)('lies the wyrm and its heart inside the face, behind the front', () => {
    const face = shape('Kit_CalvingFace');
    const wyrm = shape('Kit_WyrmSilhouette');
    const heart = shape('Kit_WyrmHeart');
    for (const s of [wyrm, heart])
      for (let k = 0; k < 3; k++) {
        expect(s.min[k]).toBeGreaterThan(face.min[k]);
        expect(s.max[k]).toBeLessThan(face.max[k]);
      }
    // The face's front is near glTF z 0 (the kit's -Y is +Z): the wyrm is
    // behind it, its snout a few yards inside the ice.
    expect(wyrm.max[2]).toBeLessThan(0);
    // A great wyrm, not a blob: long, tall and winged.
    expect(wyrm.max[0] - wyrm.min[0]).toBeGreaterThan(55);
    expect(wyrm.max[1] - wyrm.min[1]).toBeGreaterThan(40);
    // The heart sits in the chest, below the wing's reach.
    expect(heart.max[1]).toBeLessThan(25);
  });

  it.skipIf(!haveKit)('lays every crack overlay over the face', () => {
    const face = shape('Kit_CalvingFace');
    for (const name of [
      'Kit_FaceCrack_0',
      'Kit_FaceCrack_1',
      'Kit_FaceCrack_2a',
      'Kit_FaceCrack_2b',
      'Kit_FaceCrack_2c',
      'Kit_FaceCrack_2d',
      'Kit_FaceCrack_3',
    ]) {
      const s = shape(name);
      expect(s.min[0], name).toBeGreaterThan(face.min[0]);
      expect(s.max[0], name).toBeLessThan(face.max[0]);
      expect(s.max[1], name).toBeLessThan(face.max[1] + 1);
      expect(s.min[1], name).toBeGreaterThan(-1);
    }
  });
});
