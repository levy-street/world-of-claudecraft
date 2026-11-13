// The Anvil of the World's walk in the Heart kit (phases 2K to 2N, design doc
// section 5.21; docs/design/raid/kit/quarter_pieces.py and landmark_pieces.py,
// shipped in public/models/props/smith_heart_heart_kit.glb), pinned against
// the sim's geometry core (src/sim/content/smith_heart_quarters.ts):
//   - each quarter's share of the one floor lies in its own quarter by the
//     core (but where a seam's foot covers it), inside the walk, every top
//     under the floor telegraphs' lift (nothing hides a footprint);
//   - phase 2M: ONE floor: the four quarters' stones within a few percent of
//     each other in value, each drifted toward its element in hue; painted
//     stone (since phase 2N one flat sheet carrying the broad paint, the
//     slabs painted on it at runtime), never a lit grid (the joints' dirt
//     darker than the stones);
//   - the element on the edges: each quarter's crackle in its glow slot
//     bursting out of the central circle's rim a short way into it (the
//     Heat's over a bed of fire), its border light along both its seams;
//   - the seam's spine is low enough to walk over (no collider: a border,
//     not a wall), runs on the core's ridge 0 line, carries its light, its
//     horn rises only past the lip;
//   - the central circle: a raised rim of dark rock between the well's edge
//     and the ring, walkable, its light lit by the ring; the well's floor
//     flat on the walk inside it, its glow faces the mist tag;
//   - each quarter's wall landmark past the rim, since phase 2N its
//     quarter's outer wall (running along the rim from seam to seam), great
//     and tall, never over the walk;
//   - the arrival's sockets: the kit's list is the colossus's, each carved
//     into the quarter it lies in as a pit;
//   - the arrival's torn rocks rest in the quarters, never on a seam.
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
import { HEART_RIDGE_HALVES } from '../src/render/smith_heart/heart_collapse_rig';
import { HEART_FLOOR_LOOK } from '../src/render/smith_heart/heart_floor_glsl';
import { HEART_LANDMARK_PIECES } from '../src/render/smith_heart/heart_landmarks';
import {
  HEART_LANDMARK_FRAME,
  HEART_LANDMARK_SPAN,
} from '../src/render/smith_heart/heart_landmarks_core';
import { HEART_QUARTER_PIECES, HEART_RIDGE_PIECES } from '../src/render/smith_heart/heart_quarters';
import { HEART_RING_LOOK } from '../src/render/smith_heart/heart_quarters_core';
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
/** Each piece's surface alone (broken rock is never drawn whole: class 0 of its tag). */
const surfaces = new Map<string, Map<string, V3[]>>();
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
    const sby = new Map<string, V3[]>();
    const cby = new Map<string, C3[]>();
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const a = prim.getAttribute('POSITION');
      if (!a) continue;
      const col = prim.getAttribute('COLOR_0');
      const mat = prim.getMaterial()?.getName() ?? '';
      const list = by.get(mat) ?? [];
      const slist = sby.get(mat) ?? [];
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
          if (Math.round(c[3] * k * 255) >> 6 === 0 || Math.round(c[3] * k * 255) === 255)
            slist.push(list[list.length - 1]);
        }
      }
      by.set(mat, list);
      sby.set(mat, slist);
      cby.set(mat, clist);
    }
    shapes.set(name, by);
    surfaces.set(name, sby);
    colours.set(name, cby);
  }
});

const points = (name: string, material?: string, surfaceOnly = false): V3[] => {
  const s = (surfaceOnly ? surfaces : shapes).get(name);
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
  it('lists the quarters, the ridge, its horn, the circle, its well and the landmarks', () => {
    for (const p of [
      'QuarterHammer',
      'QuarterBreath',
      'QuarterQuench',
      'QuarterHeat',
      'HeartRidgeA',
      'HeartRidgeB',
      'HeartRidgeHorn',
      'HeartDais',
      'HeartWell',
      'LandmarkHeat',
      'LandmarkHammer',
      'LandmarkQuench',
      'LandmarkBreath',
    ])
      expect(SMITH_HEART_HEART_KIT_PIECES, p).toContain(p);
    // The sockets are the quarters' own since phase 2L.
    expect(SMITH_HEART_HEART_KIT_PIECES).not.toContain('TornSocket');
    for (const v of SMITH_HEART_VEINS) expect(HEART_QUARTER_PIECES[v]).toMatch(/^Kit_Quarter/);
    expect(HEART_RIDGE_PIECES).toEqual({ horn: 'Kit_HeartRidgeHorn' });
    expect(HEART_RIDGE_HALVES).toEqual({ a: 'Kit_HeartRidgeA', b: 'Kit_HeartRidgeB' });
  });

  it.skipIf(!haveKit)(
    'lays each quarter in its own quarter, inside the walk, under every telegraph',
    () => {
      for (const vein of SMITH_HEART_VEINS) {
        const piece = HEART_QUARTER_PIECES[vein];
        let inside = 0;
        for (const [x, y, z] of points(piece, undefined, true)) {
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
        // Its element on its edges (the glow slot): the crackle out of the
        // circle's rim, a short way into the quarter, and its border light.
        const glow = points(piece, 'KitGlow');
        const gc = colourOf(piece, 'KitGlow');
        const border = glow.filter((_, i) => gc[i][1] - gc[i][0] > 0.2);
        const crackle = glow.filter((q, i) => gc[i][1] - gc[i][0] <= 0.2 && q[1] > 0.01);
        expect(crackle.length, `${piece} crackle`).toBeGreaterThan(150);
        // Phase 2N: thicker and reaching further out (still the edge, never
        // the open middle of the quarter).
        for (const [x, , z] of crackle)
          expect(Math.hypot(x, z), `${piece} crackle`).toBeLessThan(ringR + 20);
        // It bursts out of the rim: some of it right at its foot.
        expect(
          crackle.some(([x, , z]) => Math.hypot(x, z) < ringR + 1),
          piece,
        ).toBe(true);
        // The border light runs ring to rim along both its seams, at the
        // spine's foot.
        expect(border.length, `${piece} border`).toBeGreaterThan(300);
        const sides = new Set<number>();
        for (const [x, , z] of border) {
          const p = at(x, z);
          const near = [0, 1, 2, 3]
            .map((k) => ({ k, d: heartRidgeDistance(k, p.x, p.z) }))
            .sort((u, w) => u.d - w.d)[0];
          // Phase 2N: a core over a softer halo a little wider.
          expect(near.d, `${piece} border`).toBeLessThan(ridgeHalfWidth + 0.7);
          sides.add(near.k);
        }
        expect(sides.size, piece).toBe(2);
        expect(Math.max(...border.map(([x, , z]) => Math.hypot(x, z)))).toBeGreaterThan(rimR - 1);
      }
      // No quarter carries the old ice tag any more (one floor).
      for (const v of SMITH_HEART_VEINS)
        expect(
          colourOf(HEART_QUARTER_PIECES[v], 'KitGlow').filter((c) => c[2] - c[0] > 0.2).length,
          v,
        ).toBe(0);
      // The Heat's molten cracks lie over a bed of fire (under the walk).
      expect(
        points(HEART_QUARTER_PIECES.heat, 'KitGlow').filter(([, y]) => y < -0.02).length,
      ).toBeGreaterThan(100);
    },
  );

  it.skipIf(!haveKit)(
    'lays ONE floor: the quarters a few percent apart, each drifted toward its element',
    () => {
      const tops = (vein: (typeof SMITH_HEART_VEINS)[number]) => {
        const pts = points(HEART_QUARTER_PIECES[vein], 'KitStone');
        const cols = colourOf(HEART_QUARTER_PIECES[vein], 'KitStone');
        return cols.filter((_, i) => pts[i][1] > 0.005);
      };
      // The open floor, past the crackle's reach (the element's scars on
      // the edges are its own, never the stone's).
      const field = (vein: (typeof SMITH_HEART_VEINS)[number]) => {
        const pts = points(HEART_QUARTER_PIECES[vein], 'KitStone');
        const cols = colourOf(HEART_QUARTER_PIECES[vein], 'KitStone');
        return cols.filter(
          (_, i) => pts[i][1] > 0.005 && Math.hypot(pts[i][0], pts[i][2]) > ringR + 16,
        );
      };
      // The stones' own colour (the median: the element's scars and the
      // sockets' rubble on the edges never sway it).
      const median = (xs: number[]) => {
        const q = [...xs].sort((a, b) => a - b);
        return q[Math.floor(q.length / 2)] ?? 0;
      };
      const avg = (cs: C3[]): C3 => [
        median(cs.map((c) => c[0])),
        median(cs.map((c) => c[1])),
        median(cs.map((c) => c[2])),
      ];
      const c = Object.fromEntries(SMITH_HEART_VEINS.map((q) => [q, avg(field(q))])) as Record<
        string,
        C3
      >;
      const v = Object.fromEntries(SMITH_HEART_VEINS.map((q) => [q, lum(c[q])])) as Record<
        string,
        number
      >;
      // One stone: every quarter within 12 percent of every other in value.
      for (const a of SMITH_HEART_VEINS)
        for (const b of SMITH_HEART_VEINS) expect(v[a] / v[b], `${a}/${b}`).toBeLessThan(1.12);
      // Each a slight drift toward its element (hue, a few percent): the
      // Hammer and the Heat warmer than the Quench and the Breath, the
      // Quench the coldest, the Heat the reddest.
      const warm = (q: string) => c[q][0] / c[q][2];
      expect(warm('hammer')).toBeGreaterThan(warm('quench') * 1.05);
      expect(warm('heat')).toBeGreaterThan(warm('breath') * 1.05);
      expect(c.quench[2] / c.quench[0]).toBeGreaterThan(c.hammer[2] / c.hammer[0]);
      expect(c.heat[0] / c.heat[1]).toBeGreaterThan(c.hammer[0] / c.hammer[1]);
      // Never four floors: even the two furthest apart (the Heat's ember
      // and the Quench's cold) within a quarter of each other in warmth
      // (the colours read linear: back to the painted values), the
      // neighbours far closer.
      for (const a of SMITH_HEART_VEINS)
        for (const b of SMITH_HEART_VEINS)
          expect((warm(a) / warm(b)) ** (1 / 2.2), `${a}/${b}`).toBeLessThan(1.25);
      expect((warm('hammer') / warm('heat')) ** (1 / 2.2)).toBeLessThan(1.05);
      for (const vein of SMITH_HEART_VEINS) {
        const t = tops(vein).map(lum);
        // Painted: since phase 2N the slabs themselves are painted at
        // runtime (heart_floor_glsl.ts) over one flat sheet; the sheet's
        // own points carry the broad paint, their value drifting (never
        // one flat colour).
        expect(t.length, vein).toBeGreaterThan(1200);
        const m = mean(t);
        const sd = Math.sqrt(mean(t.map((x) => (x - m) * (x - m))));
        expect(sd / m, vein).toBeGreaterThan(0.06);
        // One flat sheet: the open floor's points all at the sheet's
        // height (the runtime paints only there).
        const pts = points(HEART_QUARTER_PIECES[vein], 'KitStone').filter(
          ([x, , z]) => Math.hypot(x, z) > ringR + 19 && Math.hypot(x, z) < rimR - 1,
        );
        const sheet = pts.filter(([, y]) => Math.abs(y - HEART_FLOOR_LOOK.sheetY) < 0.004);
        expect(sheet.length, vein).toBeGreaterThan(400);
        // Spread over the open floor out to the wall.
        expect(Math.max(...sheet.map(([x, , z]) => Math.hypot(x, z))), vein).toBeGreaterThan(
          rimR - 2,
        );
      }
      // The joints' dirt (the rim piece's bed under the walk) darker than
      // the stones of the quarter round it: no lit grid.
      for (const vein of SMITH_HEART_VEINS) {
        const piece = `Kit_AnvilFloor${vein.charAt(0).toUpperCase()}${vein.slice(1)}`;
        const bed = points(piece, 'KitStone');
        const bedCol = colourOf(piece, 'KitStone');
        const dirt: number[] = [];
        bed.forEach(([x, y, z], i) => {
          if (Math.abs(y + 0.06) > 0.005) return;
          const p = at(x, z);
          if ([0, 1, 2, 3].some((k) => heartRidgeDistance(k, p.x, p.z) < 3)) return;
          dirt.push(lum(bedCol[i]));
        });
        // Coarse since it lies wholly under the sheet (the budget went to the fall).
        expect(dirt.length, vein).toBeGreaterThan(30);
        expect(mean(dirt), vein).toBeLessThan(v[vein] * 0.75);
      }
    },
  );

  it.skipIf(!haveKit)(
    'keeps the spine low on the walk, on the core line, its horn past the lip',
    () => {
      let onWalk = 0;
      let crest = 0;
      const spine = [
        ...points(HEART_RIDGE_HALVES.a, 'KitStone', true),
        ...points(HEART_RIDGE_HALVES.b, 'KitStone', true),
        ...points(HEART_RIDGE_HALVES.a, 'KitGlow', true),
        ...points(HEART_RIDGE_HALVES.b, 'KitGlow', true),
      ];
      for (const [x, y, z] of spine) {
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
      expect(points(HEART_RIDGE_HALVES.a, 'KitGlow').length).toBeGreaterThan(50);
      expect(points(HEART_RIDGE_HALVES.b, 'KitGlow').length).toBeGreaterThan(50);
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
    'raises the central circle as a dark rim round its well, walkable, its light lit by the ring',
    () => {
      const { wellR, rimOut } = HEART_RING_LOOK;
      let crest = 0;
      for (const [x, y, z] of points('Kit_HeartDais')) {
        const r = Math.hypot(x, z);
        // Between the well's edge and the ring (its spurs a step past it,
        // its crystals leaning in over the well's lip).
        expect(r).toBeGreaterThanOrEqual(wellR - 0.6);
        expect(r).toBeLessThanOrEqual(rimOut + 1.5);
        // Walkable: no collider, a rim a body steps over.
        expect(y).toBeLessThanOrEqual(0.7);
        crest = Math.max(crest, y);
      }
      expect(crest).toBeGreaterThan(0.45);
      expect(points('Kit_HeartDais', 'KitGlow').length).toBeGreaterThan(100);
      // The well's floor flat on the walk inside the rim, its glow faces the
      // mist tag (the runtime draws the sunken well under it).
      const well = points('Kit_HeartWell', 'KitGlow');
      const wc = colourOf('Kit_HeartWell', 'KitGlow');
      expect(well.length).toBeGreaterThan(500);
      for (const [x, y, z] of well) {
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(wellR + 0.35);
        expect(Math.abs(y)).toBeLessThan(0.02);
      }
      for (const col of wc) {
        expect(col[0] - col[1]).toBeGreaterThan(0.2);
        expect(col[2] - col[1]).toBeGreaterThan(0.2);
      }
      expect(points('Kit_HeartWell', 'KitStone').length).toBe(0);
    },
  );

  it.skipIf(!haveKit)(
    "stands each wall landmark past the rim at its quarter's middle, great, never over the walk",
    () => {
      for (const vein of SMITH_HEART_VEINS) {
        const piece = HEART_LANDMARK_PIECES[vein];
        const pts = points(piece);
        let top = 0;
        let sx = 0;
        let sz = 0;
        let n = 0;
        for (const [x, y, z] of pts) {
          const r = Math.hypot(x, z);
          // Never over the walk: at walk height it stands past the rim.
          if (y > -0.5) expect(r, `${piece} at y ${y.toFixed(2)}`).toBeGreaterThan(rimR + 0.2);
          top = Math.max(top, y);
          if (y > 0) {
            sx += x;
            sz += z;
            n++;
          }
        }
        // Great: well over a body, reading over the balustrade; since
        // phase 2N a cliff over twenty yards high at its crown.
        expect(top, piece).toBeGreaterThan(20);
        // Its quarter's outer wall (phase 2N): its mass in its own quarter,
        // running along the rim over most of the quarter's arc, from just
        // past the seam's horn behind it nearly to the next.
        const want = HEART_LANDMARK_FRAME.bearing[vein];
        const [d0, d1] = HEART_LANDMARK_SPAN[vein];
        const mid = at(sx / n, sz / n);
        expect(heartQuarterAt(mid.x, mid.z)).toBe(vein);
        const offs = pts
          .filter(([, y]) => y > 2)
          .map(([x, , z]) => (((Math.atan2(x, z) * 180) / Math.PI - want + 540) % 360) - 180);
        expect(Math.min(...offs), piece).toBeLessThan(d0 + 6);
        expect(Math.max(...offs), piece).toBeGreaterThan(d1 - 6);
        expect(d1 - d0, piece).toBeGreaterThan(50);
        // Never across a seam's horn (at -25 and +65 round from the altar).
        expect(Math.min(...offs), piece).toBeGreaterThan(-25);
        expect(Math.max(...offs), piece).toBeLessThan(65);
        expect(points(piece, 'KitGlow').length, piece).toBeGreaterThan(100);
      }
      // The Quench's is ice (the kit's ice slot).
      expect(points(HEART_LANDMARK_PIECES.quench, 'KitIce').length).toBeGreaterThan(100);
    },
  );

  it('adds no collider for the ridges or the dais (bodies walk over them)', () => {
    for (const p of SMITH_HEART_FIELD.props)
      expect(p.kind, p.kind).not.toMatch(/ridge|dais|quarter/i);
  });
});
