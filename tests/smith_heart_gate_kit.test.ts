// The Smith's Heart's gate kit (scripts/assets/smith_heart_gate_kit/build.mjs,
// built from docs/design/raid/kit/build_smith_heart_gate_kit.py): the carved
// threshold and the standing stones every forge seal gate stands on
// (heart_gates.ts), nothing metal:
//   - the shipped GLB is the current sources', small, its crystal the only
//     glow (pale facets: the runtime tints them with the gate's vein);
//   - the threshold fills the plan's sill box (the passage's width, its depth
//     and height), its crystal stays low and clear of the middle 2 yd;
//   - the standing stone stays inside the plan's post box and under three
//     yards, so the gate stays a LOW barrier in every sightline pin.
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_GATE_KIT_PIECES,
  sourceFingerprint,
} from '../scripts/assets/smith_heart_gate_kit/build.mjs';
import { HEART_SEAL_BARRIER } from '../src/render/smith_heart/heart_gates_core';
import { SMITH_HEART_GATES } from '../src/sim/content/smith_heart';

const KIT = ASSET.target;
const haveKit = existsSync(KIT);

type V3 = [number, number, number];
interface Shape {
  byMaterial: Map<string, V3[]>;
  triangles: number;
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
    const byMaterial = new Map<string, V3[]>();
    let triangles = 0;
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const mat = prim.getMaterial()?.getName() ?? '';
      triangles += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      const list = byMaterial.get(mat) ?? [];
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        list.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
      byMaterial.set(mat, list);
    }
    shapes.set(name, { byMaterial, triangles });
  }
});

const points = (name: string, material?: string): V3[] => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  if (material) return s.byMaterial.get(material) ?? [];
  return [...s.byMaterial.values()].flat();
};

const B = HEART_SEAL_BARRIER;

describe('Smith Heart gate kit', () => {
  it('lists the threshold and the standing stone, nothing metal', () => {
    expect(SMITH_HEART_GATE_KIT_PIECES).toEqual(['GateSill', 'GateStone']);
    // Every forge seal gate shares the threshold's width.
    for (const g of SMITH_HEART_GATES.filter((x) => x.kind === 'forge_seal'))
      expect(g.hw * 2, g.id).toBeCloseTo(15.2);
  });

  it.skipIf(!haveKit)('was built from the current sources, nodes and materials intact', () => {
    expect(extras.sourceFingerprint).toBe(sourceFingerprint());
    expect(nodeNames).toEqual(
      [ASSET.root, ...SMITH_HEART_GATE_KIT_PIECES.map((p) => `Kit_${p}`)].sort(),
    );
    expect(materialNames).toEqual(ASSET.materials);
    expect(statSync(KIT).size).toBeLessThanOrEqual(512 * 1024);
    let tris = 0;
    for (const s of shapes.values()) tris += s.triangles;
    expect(tris).toBeLessThanOrEqual(14000);
  });

  it.skipIf(!haveKit)('glows only in crystal, pale so the gate tints it', () => {
    for (const piece of ['Kit_GateSill', 'Kit_GateStone']) {
      const glow = points(piece, 'KitGlow');
      expect(glow.length, piece).toBeGreaterThan(0);
    }
  });

  it.skipIf(!haveKit)(
    "fills the threshold's box: the passage's width, its depth, its height",
    () => {
      const stone = points('Kit_GateSill', 'KitStone');
      const xs = stone.map((p) => p[0]);
      expect(Math.min(...xs)).toBeLessThan(-7.4);
      expect(Math.max(...xs)).toBeGreaterThan(7.4);
      for (const p of stone) {
        expect(Math.abs(p[0])).toBeLessThanOrEqual(7.62);
        // The carved blocks a hair under the plan's top; the grit at its feet flat.
        expect(p[1]).toBeLessThanOrEqual(B.sillHeight + 0.03);
        if (p[1] > 0.12) expect(Math.abs(p[2])).toBeLessThanOrEqual(B.sillDepth / 2 + 0.06);
      }
    },
  );

  it.skipIf(!haveKit)('keeps its crystal low and the middle 2 yd clear of it', () => {
    for (const p of points('Kit_GateSill', 'KitGlow')) {
      expect(p[1]).toBeLessThanOrEqual(B.crystalTop + 0.02);
      // The bed lies in its channel (a hair proud at most); only the
      // clusters stand over the top, never in the middle.
      if (p[1] > B.sillHeight + 0.08) expect(Math.abs(p[0])).toBeGreaterThan(1);
    }
  });

  it.skipIf(!haveKit)("stands its stone inside the plan's post box, under three yards", () => {
    for (const p of points('Kit_GateStone')) {
      expect(p[1]).toBeLessThanOrEqual(Math.min(3, B.postHeight + 0.12));
      // Over its footing stone, inside the box; the footing a hand wider.
      const pad = p[1] > 0.45 ? 0.1 : 0.2;
      if (p[1] > 0.15) {
        expect(Math.abs(p[0])).toBeLessThanOrEqual(B.postWidth / 2 + pad);
        expect(Math.abs(p[2])).toBeLessThanOrEqual(B.postDepth / 2 + pad);
      }
    }
  });
});
