// Mythic's hidden phase: a quarter of the Anvil really falls (design doc section 7.5).
// The kit's platform cut along the sim's exact quarters (docs/design/raid/kit/
// quarter_split.py) and the pure half of the fall (heart_collapse_core.ts): the tags and
// their runs, the cells' and masses' poses, what every tier keeps.

import { existsSync, readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET,
  SMITH_HEART_HEART_KIT_PIECES,
} from '../scripts/assets/smith_heart_heart_kit/build.mjs';
import { planFieldCliffs } from '../src/render/authored_field/field_mesh_core';
import {
  clearHeartCollapseMemoryForTest,
  HEART_COLLAPSE_LOOK,
  HEART_FALL_DEPTH,
  HEART_FALL_LOOK,
  heartCellPose,
  heartCollapseHeartLevel,
  heartFallChunk,
  heartFallClass,
  heartFallDone,
  heartFallEdgeLight,
  heartFallRanges,
  heartHornT,
  heartKeelPose,
  noteHeartCollapse,
} from '../src/render/smith_heart/heart_collapse_core';
import { HEART_RIDGE_HALVES, heartFallPieces } from '../src/render/smith_heart/heart_collapse_rig';
import { HEART_KIT_NO_SKIRT } from '../src/render/smith_heart/heart_room_kit_plan_core';
import {
  HEART_ROOM,
  SMITH_HEART_FIELD,
  SMITH_HEART_VEINS,
} from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterAt,
  heartRidgeDistance,
} from '../src/sim/content/smith_heart_quarters';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASES,
  hiddenFallenAt,
  quarterBit,
} from '../src/sim/encounters/smith_heart/final_phase_ids';

const haveKit = existsSync(ASSET.target);
interface Corner {
  x: number;
  y: number;
  z: number;
  tag: number;
}
interface Tri {
  a: Corner;
  b: Corner;
  c: Corner;
}
const tris = new Map<string, Map<string, Tri[]>>();

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
    const m = node.getWorldMatrix();
    const by = new Map<string, Tri[]>();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const pos = prim.getAttribute('POSITION');
      const col = prim.getAttribute('COLOR_0');
      const idx = prim.getIndices();
      if (!pos || !col || !idx) continue;
      const corner = (i: number): Corner => {
        const e = pos.getElement(i, []);
        const c = col.getElement(i, []);
        return {
          x: m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12],
          y: m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13],
          z: m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14],
          tag: Math.round(c[3] * 255),
        };
      };
      const list: Tri[] = [];
      for (let t = 0; t < idx.getCount(); t += 3)
        list.push({
          a: corner(idx.getScalar(t)),
          b: corner(idx.getScalar(t + 1)),
          c: corner(idx.getScalar(t + 2)),
        });
      by.set(prim.getMaterial()?.getName() ?? '', list);
    }
    tris.set(name, by);
  }
});

const all = (piece: string): Tri[] => [...(tris.get(piece)?.values() ?? [])].flat();
const mid = (t: Tri) => ({
  x: (t.a.x + t.b.x + t.c.x) / 3,
  y: (t.a.y + t.b.y + t.c.y) / 3,
  z: (t.a.z + t.b.z + t.c.z) / 3,
});
const local = (x: number, z: number) => ({ x: HEART_ROOM.x + x, z: HEART_ROOM.z + z });
const { ringR, rimR } = HEART_QUARTERS;
const lip = ringR + FINAL_PHASES.ringLip;
/** How far past the sim's line a surface may lie where the plan's line is cut straight
 *  through one triangle (the sagitta of a curve over a triangle's width). */
const SLACK = 0.12;

describe('the kit cut along the sim', () => {
  it('lists each quarter its own pieces and what stays', () => {
    const list = SMITH_HEART_HEART_KIT_PIECES as readonly string[];
    for (const vein of SMITH_HEART_VEINS)
      for (const p of heartFallPieces(vein)) expect(list, p).toContain(p.replace('Kit_', ''));
    for (const p of ['AnvilFloor', 'AnvilKeel', 'HeartDais', 'HeartRidgeA', 'HeartRidgeB'])
      expect(list).toContain(p);
    expect(list).not.toContain('HeartRidge');
  });

  it.skipIf(!haveKit)('keeps every whole surface of a quarter on its side of the line', () => {
    for (const vein of SMITH_HEART_VEINS) {
      for (const piece of heartFallPieces(vein)) {
        const bad = all(piece).filter((t) => {
          if (heartFallClass(t.a.tag) !== 0 || heartFallChunk(t.a.tag) === 0) return false;
          const c = mid(t);
          const r = Math.hypot(c.x, c.z);
          // The coarse dirt bed under the sheet: nobody sees or stands on it.
          if (Math.abs(c.y + 0.06) < 0.01) return false;
          // Past the rim a block of the fascia stays whole (no walk there).
          if (r >= rimR || r < lip - SLACK) return false;
          const at = local(c.x, c.z);
          if (heartQuarterAt(at.x, at.z) === vein) return false;
          // The ring's foot's long underside triangles lean a little over the line.
          const near = [0, 1, 2, 3].some((k) => heartRidgeDistance(k, at.x, at.z) < SLACK + 0.5);
          return !near;
        });
        expect(bad.length, piece).toBe(0);
      }
    }
  });

  it.skipIf(!haveKit)('leaves nothing past the ring lip on what stays', () => {
    const bad = all('Kit_HeartDais').filter((t) => {
      const c = mid(t);
      return Math.hypot(c.x, c.z) > lip + SLACK;
    });
    expect(bad.length).toBe(0);
    for (const t of all('Kit_AnvilFloor')) {
      const c = mid(t);
      expect(Math.hypot(c.x, c.z)).toBeLessThan(lip + 0.7);
    }
    // The column under the ring: its keel only, below the walk's rock.
    for (const t of all('Kit_AnvilKeel')) {
      const c = mid(t);
      expect(Math.hypot(c.x, c.z)).toBeLessThan(lip + 1.5);
    }
  });

  it.skipIf(!haveKit)('cuts a ridge down its line, each half on its own quarter', () => {
    const [q0, q1] = [HEART_QUARTER_ORDER[0], HEART_QUARTER_ORDER[1]];
    for (const [piece, vein] of [
      [HEART_RIDGE_HALVES.a, q0],
      [HEART_RIDGE_HALVES.b, q1],
    ] as const) {
      for (const t of all(piece)) {
        if (heartFallClass(t.a.tag) !== 0 || heartFallChunk(t.a.tag) === 0) continue;
        const c = mid(t);
        const at = local(c.x, c.z);
        if (Math.hypot(c.x, c.z) >= rimR) continue;
        if (heartRidgeDistance(0, at.x, at.z) < SLACK) continue;
        expect(heartQuarterAt(at.x, at.z), piece).toBe(vein);
      }
    }
  });

  it.skipIf(!haveKit)('tags broken rock thick under a break, never a paper floor', () => {
    for (const vein of SMITH_HEART_VEINS) {
      const piece = heartFallPieces(vein)[0];
      const rock = all(piece).filter((t) => heartFallClass(t.a.tag) === 1);
      expect(rock.length, piece).toBeGreaterThan(200);
      // The walls of a cell run from the sheet down to the keel's top, at the least.
      expect(Math.min(...rock.map((t) => Math.min(t.a.y, t.b.y, t.c.y)))).toBeLessThan(-3);
      const keel = all(heartFallPieces(vein)[3]);
      // Each neighbour's fall leaves a wall of its rock: the whole section, deep.
      for (const klass of [2, 3]) {
        const wall = keel.filter((t) => heartFallClass(t.a.tag) === klass);
        expect(wall.length, `${vein} ${klass}`).toBeGreaterThan(50);
        expect(Math.min(...wall.map((t) => mid(t).y))).toBeLessThan(-18);
      }
      // What stands round the ring: its column's face, chunk 0 of this quarter's keel.
      const face = keel.filter((t) => heartFallChunk(t.a.tag) === 0);
      expect(face.length).toBeGreaterThan(40);
      expect(Math.min(...face.map((t) => mid(t).y))).toBeLessThan(-25);
    }
  });

  it.skipIf(!haveKit)(
    'draws no broken rock in the surface runs (a whole floor is as it was)',
    () => {
      for (const vein of SMITH_HEART_VEINS) {
        const floor = tris.get(heartFallPieces(vein)[0])?.get('KitStone') ?? [];
        const surface = floor.filter((t) => heartFallClass(t.a.tag) === 0);
        // The sheet's own plane and pits; a wall reaches far under them.
        expect(Math.min(...surface.map((t) => Math.min(t.a.y, t.b.y, t.c.y)))).toBeGreaterThan(-1);
      }
    },
  );
});

describe('the fall, pure', () => {
  it('sorts a piece by tag: the surface run first, then each class and chunk', () => {
    // Tags per vertex: class 0 chunk 1, class 1 chunk 1, class 0 chunk 2, class 2 chunk 1.
    const tags = [1, 1, 1, 65, 65, 65, 2, 2, 2, 129, 129, 129];
    const index = [3, 4, 5, 9, 10, 11, 0, 1, 2, 6, 7, 8];
    const r = heartFallRanges(index, tags);
    expect(Array.from(r.index)).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5, 9, 10, 11]);
    expect(r.surface).toEqual({ start: 0, count: 6 });
    expect(r.byTag.get(1)).toEqual({ start: 0, count: 3 });
    expect(r.byTag.get(2)).toEqual({ start: 3, count: 3 });
    expect(r.byTag.get(65)).toEqual({ start: 6, count: 3 });
    expect(r.byTag.get(129)).toEqual({ start: 9, count: 3 });
    expect(heartFallClass(129)).toBe(2);
    expect(heartFallChunk(129)).toBe(1);
  });

  it('gives first, then drops: slow to start, the wall before the ring', () => {
    const p = { drop: 0, turn: 0, gone: false };
    heartCellPose(rimR, 0, 0, p);
    expect(p.drop).toBe(0);
    expect(p.turn).toBe(0);
    // The wall's cell has gone further than the ring's at any moment of the fall.
    for (const t of [0.8, 1.2, 1.6, 2.2]) {
      const out = { drop: 0, turn: 0, gone: false };
      const inn = { drop: 0, turn: 0, gone: false };
      heartCellPose(rimR, 0.5, t, out);
      heartCellPose(ringR + 1, 0.5, t, inn);
      expect(out.drop, `t ${t}`).toBeGreaterThan(inn.drop);
    }
    // The give is small: a heavy thing settling, before anything falls.
    const L = HEART_FALL_LOOK;
    heartCellPose(rimR, 0, L.give + L.first, p);
    expect(p.drop).toBeCloseTo(L.giveDrop, 5);
    // Monotone.
    let last = -1;
    for (let t = 0; t < 6; t += 0.1) {
      heartCellPose(40, 0.3, t, p);
      expect(p.drop).toBeGreaterThanOrEqual(last);
      last = p.drop;
    }
  });

  it('takes the keel from under the floor first', () => {
    const L = HEART_FALL_LOOK;
    const keel = { drop: 0, turn: 0, gone: false };
    const floor = { drop: 0, turn: 0, gone: false };
    for (const t of [0.5, 0.9, 1.4, 2]) {
      heartKeelPose(1, 0, t, keel);
      heartCellPose(rimR, 0, t, floor);
      expect(keel.drop, `t ${t}`).toBeGreaterThanOrEqual(floor.drop);
      heartKeelPose(3, 0, t, keel);
      heartCellPose(ringR + 1, 0, t, floor);
      expect(keel.drop, `inner t ${t}`).toBeGreaterThanOrEqual(floor.drop);
    }
    expect(L.keelOuter).toBeLessThan(L.keelInner);
  });

  it('has everything gone before the fall ends, and rises from the same poses', () => {
    expect(heartFallDone()).toBeLessThan(HEART_COLLAPSE_LOOK.fallSeconds);
    const p = { drop: 0, turn: 0, gone: false };
    heartCellPose(ringR + 1, 1, HEART_COLLAPSE_LOOK.fallSeconds, p);
    expect(p.gone).toBe(true);
    heartKeelPose(3, 1, HEART_COLLAPSE_LOOK.fallSeconds, p);
    expect(p.gone).toBe(true);
    // Whole again at the fall's first instant: the swap from whole to cells never pops.
    heartCellPose(rimR, 0.2, 0.0001, p);
    expect(p.drop).toBeLessThan(0.001);
    expect(p.turn).toBeLessThan(0.001);
  });

  it('keeps the warning lit over the floor until the last of it has left', () => {
    const L = HEART_FALL_LOOK;
    expect(heartFallEdgeLight(-1)).toBe(0);
    expect(heartFallEdgeLight(0)).toBe(1);
    // The sim kills from the first instant: lit while the last cell still stands.
    const last = L.first + L.spread + L.scatter;
    expect(heartFallEdgeLight(last)).toBeGreaterThan(0);
    expect(heartFallEdgeLight(HEART_COLLAPSE_LOOK.fallSeconds)).toBe(0);
  });

  it('takes a horn with the first of its two quarters', () => {
    expect(heartHornT(-1, -1)).toBe(-1);
    expect(heartHornT(2, -1)).toBe(2);
    expect(heartHornT(-1, 3)).toBe(3);
    expect(heartHornT(2, 5)).toBe(5);
  });

  it('wakes the heart once a quarter has fallen, dim as the room before', () => {
    clearHeartCollapseMemoryForTest();
    expect(heartCollapseHeartLevel('a', 0.4)).toBeCloseTo(0.6);
    noteHeartCollapse('a', [
      { id: FINAL_PHASE_AURAS.phase, value: 8 },
      { id: FINAL_PHASE_AURAS.hidden, value: 0, value2: 1, value3: 10 },
    ]);
    expect(heartCollapseHeartLevel('a', 0.4)).toBeCloseTo(0.6);
    clearHeartCollapseMemoryForTest();
  });

  it('holds the layers of light under the walk, deeper ones stronger', () => {
    for (const l of HEART_FALL_DEPTH) expect(l.y).toBeLessThan(-3.3);
    const ys = HEART_FALL_DEPTH.map((l) => l.y);
    expect([...ys].sort((a, b) => b - a)).toEqual(ys);
    const ks = HEART_FALL_DEPTH.map((l) => l.k);
    expect([...ks].sort((a, b) => a - b)).toEqual(ks);
  });

  it('keeps the sim shape the painter means: nothing fallen, no kill', () => {
    const at = local(0, 40);
    expect(hiddenFallenAt(0, at.x, at.z)).toBe(false);
    const v = heartQuarterAt(at.x, at.z);
    if (v !== 'ring') expect(hiddenFallenAt(quarterBit(v), at.x, at.z)).toBe(true);
  });
});

describe('every tier and the field', () => {
  it('draws the same real pieces, ember line and depth on every tier; only rubble and dust thin', () => {
    const rig = readFileSync('src/render/smith_heart/heart_collapse_rig.ts', 'utf8');
    // The low tier only sheds shadows on the rig: never a piece.
    for (const m of rig.matchAll(/lowGfx/g)) {
      const line = rig.slice(rig.lastIndexOf('\n', m.index) + 1, rig.indexOf('\n', m.index));
      expect(line).toMatch(/casts: !lowGfx|lowGfx: boolean/);
    }
    const src = readFileSync('src/render/smith_heart/heart_collapse.ts', 'utf8');
    expect(src).toMatch(/lowGfx \? SLABS\.low : SLABS\.high/);
    expect(src).toMatch(/lowGfx \? DUST\.low : DUST\.high/);
    expect((src.match(/lowGfx \?/g) ?? []).length).toBe(2);
  });

  it('lets no field rock stand in a fallen quarter: the Anvil grows no skirt', () => {
    expect(HEART_KIT_NO_SKIRT).toContain('heart_anvil');
    const opts = {
      voidFloor: SMITH_HEART_FIELD.voidHeight - 25,
      columnStep: 3,
      rowStep: 6,
      flare: 0.22,
    };
    const ring = (m: { positions: ArrayLike<number> }) => {
      let n = 0;
      for (let i = 0; i < m.positions.length; i += 3) {
        const r = Math.hypot(m.positions[i] - HEART_ROOM.x, m.positions[i + 2] - HEART_ROOM.z);
        if (r < HEART_ROOM.r + 0.5) n++;
      }
      return n;
    };
    const withSkirt = planFieldCliffs(SMITH_HEART_FIELD, opts);
    const without = planFieldCliffs(SMITH_HEART_FIELD, {
      ...opts,
      noSkirt: new Set(HEART_KIT_NO_SKIRT),
    });
    expect(ring(withSkirt)).toBeGreaterThan(20);
    expect(ring(without)).toBeLessThan(ring(withSkirt) / 4);
  });
});
