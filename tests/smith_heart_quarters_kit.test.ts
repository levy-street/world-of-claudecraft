// The Anvil of the World's four quarters in the Heart kit (phases 2K and 2L,
// design doc section 5.21; docs/design/raid/kit/quarter_pieces.py, shipped in
// public/models/props/smith_heart_heart_kit.glb), pinned against the sim's
// geometry core (src/sim/content/smith_heart_quarters.ts):
//   - each quarter's paving lies in its own quarter by the core (but where a
//     ridge's foot covers it), inside the walk, every top under the floor
//     telegraphs' lift (nothing hides a footprint), its marks in its glow
//     slot, the Quench's ice glazed over it (glow faces painted blue, the
//     runtime's ice);
//   - phase 2L: the four quarters read apart in value (the Quench palest,
//     the Hammer, the Breath, the Heat darkest), never as a lit grid (their
//     joints' dirt darker than their stones), the Heat's fire under its
//     fissures, painted stone (many painted vertices per stone, never one
//     flat colour);
//   - the ridge's spine is low enough to walk over on the walk (no collider:
//     a border, not a wall), runs on the core's ridge 0 line, carries its
//     vein of light, and its horn rises only past the lip;
//   - the arrival's sockets: the kit's list is the colossus's, each carved
//     into the quarter it lies in as a pit (its floor deep under the walk,
//     no whole stone over it);
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
import { HEART_QUARTER_PIECES, HEART_RIDGE_PIECES } from '../src/render/smith_heart/heart_quarters';
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
type C3 = [number, number, number];
const shapes = new Map<string, Map<string, V3[]>>();
const colours = new Map<string, Map<string, C3[]>>();

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
    const cby = new Map<string, C3[]>();
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const col = prim.getAttribute('COLOR_0');
      const mat = prim.getMaterial()?.getName() ?? '';
      const list = by.get(mat) ?? [];
      const clist = cby.get(mat) ?? [];
      const e: number[] = [];
      const c: number[] = [];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, e);
        list.push([
          m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
        ]);
        if (col) {
          col.getElement(i, c);
          // Normalized integer colours read as 0..1 through the accessor.
          const k = col.getNormalized() || col.getComponentType() === 5126 ? 1 : 1 / 255;
          clist.push([c[0] * k, c[1] * k, c[2] * k]);
        }
      }
      by.set(mat, list);
      cby.set(mat, clist);
    }
    shapes.set(name, by);
    colours.set(name, cby);
  }
});

const points = (name: string, material?: string): V3[] => {
  const s = shapes.get(name);
  if (!s) throw new Error(`no kit piece ${name}`);
  if (material) return s.get(material) ?? [];
  return [...s.values()].flat();
};
const colourOf = (name: string, material: string): C3[] => colours.get(name)?.get(material) ?? [];
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
/** Linear luminance. */
const lum = (c: C3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** The kit's sockets (quarter_geom.py SOCKETS): bearing, r, size. */
const SOCKETS = (() => {
  const src = readFileSync('docs/design/raid/kit/quarter_geom.py', 'utf8');
  const block = src.slice(
    src.indexOf('SOCKETS = ('),
    src.indexOf('\n)\n', src.indexOf('SOCKETS = (')),
  );
  return [...block.matchAll(/\(([\d.]+), ([\d.]+), ([\d.]+)\)/g)].map((m) => ({
    bearing: Number(m[1]),
    r: Number(m[2]),
    size: Number(m[3]),
  }));
})();

describe('the four quarters in the kit', () => {
  it('lists the quarters, the ridge, its horn and the dais', () => {
    for (const p of [
      'QuarterHammer',
      'QuarterBreath',
      'QuarterQuench',
      'QuarterHeat',
      'HeartRidge',
      'HeartRidgeHorn',
      'HeartDais',
    ])
      expect(SMITH_HEART_HEART_KIT_PIECES, p).toContain(p);
    // The sockets are the quarters' own since phase 2L.
    expect(SMITH_HEART_HEART_KIT_PIECES).not.toContain('TornSocket');
    for (const v of SMITH_HEART_VEINS) expect(HEART_QUARTER_PIECES[v]).toMatch(/^Kit_Quarter/);
    expect(HEART_RIDGE_PIECES).toEqual({ spine: 'Kit_HeartRidge', horn: 'Kit_HeartRidgeHorn' });
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
        // Its marks wake (the glow slot): the cracks, scorings, veins,
        // fissures and ice laid in its stone.
        const glow = points(piece, 'KitGlow');
        expect(glow.length, piece).toBeGreaterThan(200);
        expect(
          glow.some(([, y]) => y > 0.01),
          piece,
        ).toBe(true);
      }
      // The Quench's ice: glow faces painted blue (the runtime's ice tag).
      const ice = colourOf(HEART_QUARTER_PIECES.quench, 'KitGlow').filter((c) => c[2] - c[0] > 0.2);
      expect(ice.length).toBeGreaterThan(200);
      // No other quarter carries the ice tag.
      for (const v of ['hammer', 'breath', 'heat'] as const)
        expect(
          colourOf(HEART_QUARTER_PIECES[v], 'KitGlow').filter((c) => c[2] - c[0] > 0.2).length,
          v,
        ).toBe(0);
      // The Heat's fire lies under its fissures (a bed under the walk).
      expect(
        points(HEART_QUARTER_PIECES.heat, 'KitGlow').filter(([, y]) => y < -0.02).length,
      ).toBeGreaterThan(200);
    },
  );

  it.skipIf(!haveKit)(
    'paints every quarter as stone, the four apart in value, never a lit grid',
    () => {
      const tops = (vein: (typeof SMITH_HEART_VEINS)[number]) => {
        const pts = points(HEART_QUARTER_PIECES[vein], 'KitStone');
        const cols = colourOf(HEART_QUARTER_PIECES[vein], 'KitStone');
        return cols.filter((_, i) => pts[i][1] > 0.005).map(lum);
      };
      const v = Object.fromEntries(SMITH_HEART_VEINS.map((q) => [q, mean(tops(q))])) as Record<
        string,
        number
      >;
      // A value ladder (greyscale reads them apart, not hue alone).
      expect(v.quench).toBeGreaterThan(v.hammer * 1.25);
      expect(v.hammer).toBeGreaterThan(v.breath * 1.25);
      expect(v.breath).toBeGreaterThan(v.heat * 1.6);
      for (const vein of SMITH_HEART_VEINS) {
        const t = tops(vein);
        // Painted: thousands of painted points, their value drifting
        // (never one flat colour per stone).
        expect(t.length, vein).toBeGreaterThan(3000);
        const m = mean(t);
        const sd = Math.sqrt(mean(t.map((x) => (x - m) * (x - m))));
        expect(sd / m, vein).toBeGreaterThan(0.08);
      }
      // The joints' dirt (the rim piece's bed under the walk) darker than
      // the stones of the quarter round it: no lit grid.
      const bed = points('Kit_AnvilFloor', 'KitStone');
      const bedCol = colourOf('Kit_AnvilFloor', 'KitStone');
      for (const vein of SMITH_HEART_VEINS) {
        const dirt: number[] = [];
        bed.forEach(([x, y, z], i) => {
          if (Math.abs(y + 0.06) > 0.005) return;
          const p = at(x, z);
          if ([0, 1, 2, 3].some((k) => heartRidgeDistance(k, p.x, p.z) < 3)) return;
          if (heartQuarterAt(p.x, p.z) === vein) dirt.push(lum(bedCol[i]));
        });
        expect(dirt.length, vein).toBeGreaterThan(50);
        expect(mean(dirt), vein).toBeLessThan(v[vein] * 0.75);
      }
    },
  );

  it.skipIf(!haveKit)(
    'keeps the spine low on the walk, on the core line, its horn past the lip',
    () => {
      let onWalk = 0;
      let crest = 0;
      for (const [x, y, z] of points('Kit_HeartRidge')) {
        const r = Math.hypot(x, z);
        // The spine ends at the rim (the horn goes on).
        expect(r, 'spine r').toBeLessThan(rimR + 0.9);
        // Low enough to step over: no collider, a border not a wall (drawn
        // so a telegraph always shows over it, HEART_PLATFORM_ORDER).
        expect(y, `spine at r ${r.toFixed(1)}`).toBeLessThanOrEqual(0.6);
        crest = Math.max(crest, y);
        if (r > ringR && r < rimR - 0.1) {
          const p = at(x, z);
          // Its spine and the knuckles half sunk along its foot.
          expect(ridgeGap(p.x, p.z), `spine at r ${r.toFixed(1)}`).toBeLessThan(
            ridgeHalfWidth + 1.9,
          );
          onWalk++;
        }
      }
      expect(onWalk).toBeGreaterThan(400);
      // A spine, not a kerb (phase 2K's crest was a quarter of a yard).
      expect(crest).toBeGreaterThan(0.42);
      expect(points('Kit_HeartRidge', 'KitGlow').length).toBeGreaterThan(100);
      let top = 0;
      for (const [x, y, z] of points('Kit_HeartRidgeHorn')) {
        const r = Math.hypot(x, z);
        if (r < rimR - 0.1) expect(y, `horn at r ${r.toFixed(1)}`).toBeLessThanOrEqual(0.6);
        top = Math.max(top, y);
      }
      // The horn: well over a body past the lip.
      expect(top).toBeGreaterThan(6);
    },
  );

  it('carves a socket wherever the colossus tears a piece out (the same list)', () => {
    const big = COLOSSUS_PIECES.filter((p) => p.joint !== 'shard');
    expect(SOCKETS.length).toBe(big.length);
    for (const p of big)
      expect(
        SOCKETS.some((s) => s.bearing === p.rest.bearing && s.r === p.rest.r && s.size === p.size),
        p.id,
      ).toBe(true);
  });

  it.skipIf(!haveKit)(
    'carves each socket as a pit in its own quarter, no whole stone over it',
    () => {
      for (const s of SOCKETS) {
        const a = (s.bearing * Math.PI) / 180;
        const cx = Math.sin(a) * s.r;
        const cz = Math.cos(a) * s.r;
        const zone = heartQuarterAt(at(cx, cz).x, at(cx, cz).z);
        expect(zone).not.toBe('ring');
        if (zone === 'ring') continue;
        const R = 0.85 + s.size * 0.085;
        const near = points(HEART_QUARTER_PIECES[zone]).filter(
          ([x, , z]) => Math.hypot(x - cx, z - cz) < R * 0.45,
        );
        expect(near.length, `socket ${s.bearing}`).toBeGreaterThan(3);
        // Its floor deep under the walk, nothing of the paving up there.
        expect(Math.min(...near.map(([, y]) => y)), `socket ${s.bearing}`).toBeLessThan(-0.35);
        expect(Math.max(...near.map(([, y]) => y)), `socket ${s.bearing}`).toBeLessThan(0.0);
      }
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
