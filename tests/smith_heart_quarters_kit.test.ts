// The Anvil of the World's four quarters in the Heart kit (phase 2K, design
// doc section 5.21; docs/design/raid/kit/quarter_pieces.py, shipped in
// public/models/props/smith_heart_heart_kit.glb), pinned against the sim's
// geometry core (src/sim/content/smith_heart_quarters.ts):
//   - each quarter's paving lies in its own quarter by the core (but where a
//     ridge's foot covers it), inside the walk, every top under the floor
//     telegraphs' lift (nothing hides a footprint), its seams in its glow
//     slot, the Quench's ice glaze on the ice slot;
//   - the ridge is low enough to walk over on the walk (no collider: it is
//     a border, not a wall), runs on the core's ridge 0 line, carries its
//     vein of crystal, and rises into its horn only past the lip;
//   - the dais is the central ring's, as low, its crystal lit by the ring;
//   - the arrival's torn rocks rest in the quarters, never on a ridge.
// The glTF frame is the kit's Blender frame turned y up: (x, z, -y), the
// pieces at the platform's centre, so a point's (x, z) is room-local.

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_HEART_KIT_PIECES,
} from '../scripts/assets/smith_heart_heart_kit/build.mjs';
import { HEART_QUARTER_PIECES } from '../src/render/smith_heart/heart_quarters';
import { COLOSSUS_PIECES, colossusRestPoint } from '../src/render/smith_heart_fx/final_fx_core';
import {
  HEART_ROOM,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEINS,
} from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTERS,
  heartQuarterAt,
  heartRidgeDistance,
  heartRidgePoint,
} from '../src/sim/content/smith_heart_quarters';

const haveKit = existsSync(ASSET.target);
type V3 = [number, number, number];
const shapes = new Map<string, Map<string, V3[]>>();

beforeAll(async () => {
  if (!haveKit) return;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(readFileSync(ASSET.target)));
  for (const node of doc.getRoot().listNodes()) {
    const name = node.getName();
    if (!name.startsWith('Kit_')) continue;
    const by = new Map<string, V3[]>();
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const mat = prim.getMaterial()?.getName() ?? '';
      const list = by.get(mat) ?? [];
      const e: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        list.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
      }
      by.set(mat, list);
    }
    shapes.set(name, by);
  }
});

const points = (name: string, material?: string): V3[] => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  if (material) return s.get(material) ?? [];
  return [...s.values()].flat();
};
/** Room-local (x, z) to the core's instance-local frame. */
const at = (x: number, z: number) => ({ x: HEART_ROOM.x + x, z: HEART_ROOM.z + z });
/** The floor telegraphs' lift over the floor (floor_telegraph/telegraph_kit.ts). */
const TELEGRAPH_LIFT = 0.07;
const { ringR, rimR, ridgeHalfWidth } = HEART_QUARTERS;
/** The plan distance (yards, square across the ridge) from ridge 0's line. */
const ridgeLine = Array.from({ length: 400 }, (_, i) =>
  heartRidgePoint(0, ringR - 1 + (i * (rimR - ringR + 2)) / 399),
);
const ridgeGap = (x: number, z: number) =>
  Math.min(...ridgeLine.map((q) => Math.hypot(q.x - x, q.z - z)));

describe('the four quarters in the kit', () => {
  it('lists the quarters, the ridge and the dais', () => {
    for (const p of [
      'QuarterHammer',
      'QuarterBreath',
      'QuarterQuench',
      'QuarterHeat',
      'HeartRidge',
      'HeartDais',
    ])
      expect(SMITH_HEART_HEART_KIT_PIECES, p).toContain(p);
    for (const v of SMITH_HEART_VEINS) expect(HEART_QUARTER_PIECES[v]).toMatch(/^Kit_Quarter/);
  });

  it.skipIf(!haveKit)(
    'lays each quarter in its own quarter, inside the walk, under every telegraph',
    () => {
      for (const vein of SMITH_HEART_VEINS) {
        const piece = HEART_QUARTER_PIECES[vein];
        let inside = 0;
        for (const [x, y, z] of points(piece)) {
          const r = Math.hypot(x, z);
          expect(r, `${piece} r`).toBeLessThanOrEqual(rimR + 0.15);
          expect(r, `${piece} r`).toBeGreaterThanOrEqual(ringR - 0.4);
          expect(y, `${piece} at r ${r.toFixed(1)}`).toBeLessThan(TELEGRAPH_LIFT - 0.01);
          const p = at(x, z);
          const nearRidge = [0, 1, 2, 3].some(
            (k) => heartRidgeDistance(k, p.x, p.z) < ridgeHalfWidth + 0.3,
          );
          if (r > ringR + 0.3 && !nearRidge) {
            expect(heartQuarterAt(p.x, p.z), `${piece} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(
              vein,
            );
            inside++;
          }
        }
        expect(inside, piece).toBeGreaterThan(500);
        // Its seams wake (the glow slot): the sheet under its joints and the
        // marks on its stones.
        const glow = points(piece, 'KitGlow');
        expect(glow.length, piece).toBeGreaterThan(200);
        expect(glow.some(([, y]) => y > 0.01) || vein === 'breath', piece).toBe(true);
      }
      // The Quench's stones glazed under ice.
      expect(points(HEART_QUARTER_PIECES.quench, 'KitIce').length).toBeGreaterThan(200);
    },
  );

  it.skipIf(!haveKit)(
    'keeps the ridge low on the walk, on the core line, its horn past the lip',
    () => {
      let onWalk = 0;
      let top = 0;
      for (const [x, y, z] of points('Kit_HeartRidge')) {
        const r = Math.hypot(x, z);
        if (r < rimR - 0.1) {
          // Low enough to step over: no collider, a border not a wall.
          expect(y, `ridge at r ${r.toFixed(1)}`).toBeLessThanOrEqual(0.25);
          if (r > ringR) {
            const p = at(x, z);
            // Its spine and the knuckles half sunk along its flanks.
            expect(ridgeGap(p.x, p.z), `ridge at r ${r.toFixed(1)}`).toBeLessThan(
              ridgeHalfWidth + 1.2,
            );
            onWalk++;
          }
        } else top = Math.max(top, y);
      }
      expect(onWalk).toBeGreaterThan(400);
      // The horn: well over a body past the lip.
      expect(top).toBeGreaterThan(6);
      expect(points('Kit_HeartRidge', 'KitGlow').length).toBeGreaterThan(100);
    },
  );

  it.skipIf(!haveKit)(
    'keeps the dais in the central ring, as low, its crystal lit by the ring',
    () => {
      for (const [x, y, z] of points('Kit_HeartDais')) {
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(ringR + 0.4);
        expect(y).toBeLessThanOrEqual(0.25);
      }
      expect(points('Kit_HeartDais', 'KitGlow').length).toBeGreaterThan(100);
    },
  );

  it('adds no collider for the ridges or the dais (bodies walk over them)', () => {
    for (const p of SMITH_HEART_FIELD.props)
      expect(p.kind, p.kind).not.toMatch(/ridge|dais|quarter/i);
  });

  it("rests the arrival's torn rocks inside the quarters, never on a ridge", () => {
    for (const p of COLOSSUS_PIECES) {
      if (p.rest.chasm) continue;
      const rest = colossusRestPoint(p);
      const zone = heartQuarterAt(rest.x, rest.z);
      expect(zone, p.id).not.toBe('ring');
      for (let k = 0; k < 4; k++)
        expect(heartRidgeDistance(k, rest.x, rest.z), `${p.id} ridge ${k}`).toBeGreaterThan(
          p.size / 2 + ridgeHalfWidth,
        );
    }
  });
});
