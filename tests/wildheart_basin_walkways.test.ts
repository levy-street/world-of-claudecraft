// The Wildheart Basin's walkways stay open (playtest 03/10): every ramp and
// stair of the layout (src/sim/content/wildheart_basin_layout.ts) runs clear
// from end to end, with no generated cliff, prop collider or kit wall across
// its corridor; and the Beast Pits' bone fences stand as a clean ring along
// the rim, never crossing each other, the rim rails or the stair.
//
// The Fern Steps once came down onto the south bank still several yards up:
// the bank's floor (listed later, so it wins) cut the ramp off along its
// south edge and the generated cliff stood a wall across the way down. The
// bank now leaves the ramp's band out (a notch), so the ramp keeps one
// straight slope (a bend on a slope would draw a seam) and only its side
// drops to the bank. The
// fences were turned radial, poking through the rim's bone rails.

import { describe, expect, it } from 'vitest';
import {
  planBasinEdges,
  planBasinKitPlacements,
} from '../src/render/wildheart_basin/basin_kit_plan_core';
import { isBlocked } from '../src/sim/colliders';
import {
  BEAST_PITS,
  WILDHEART_BASIN_FIELD,
  WILDHEART_HEIGHTS,
} from '../src/sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  authoredFieldCliffRuns,
  authoredFieldHeight,
  type FieldProp,
  type FieldSurface,
} from '../src/sim/instances/authored_field';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';

const FIELD = WILDHEART_BASIN_FIELD;
const CLIFFS = authoredFieldCliffRuns(FIELD);
type PathSurface = Extract<FieldSurface, { kind: 'path' }>;
/** Walkways that end on purpose: the way into the stone jaguar's maw stops
 *  at the exit portal against the head's throat (sealed at the back) and
 *  starts on the open shrine terrace beside the altar. Its own suite
 *  (tests/wildheart_basin_maw_portal.test.ts) walks a player through it. */
const DEAD_ENDS = new Set(['jaguar_maw']);
const PATHS = FIELD.surfaces.filter(
  (s): s is PathSurface => s.kind === 'path' && !DEAD_ENDS.has(s.id),
);

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Points along a path's centerline every `step` yards, with the unit side normal. */
function centerline(
  s: PathSurface,
  step = 0.5,
): { x: number; z: number; nx: number; nz: number }[] {
  const out: { x: number; z: number; nx: number; nz: number }[] = [];
  for (let i = 0; i < s.points.length - 1; i++) {
    const [ax, az] = s.points[i];
    const [bx, bz] = s.points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      out.push({
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        nx: -(bz - az) / len,
        nz: (bx - ax) / len,
      });
    }
  }
  return out;
}

function pathById(id: string): PathSurface {
  const s = PATHS.find((p) => p.id === id);
  if (!s) throw new Error(`no path ${id}`);
  return s;
}

/** Inside a prop's collider footprint (the sim's circle or oriented box)? */
function inProp(p: FieldProp, x: number, z: number): boolean {
  const dx = x - p.x;
  const dz = z - p.z;
  if (p.r !== undefined && p.r > 0) return Math.hypot(dx, dz) <= p.r;
  if (p.hw === undefined || p.hd === undefined) return false;
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return Math.abs(dx * c - dz * s) <= p.hw && Math.abs(dx * s + dz * c) <= p.hd;
}

describe('Wildheart Basin walkways: every ramp and stair is open end to end', () => {
  it('no generated cliff stands within the inner half of any ramp or stair', () => {
    const failures: string[] = [];
    for (const s of PATHS) {
      for (const p of centerline(s)) {
        for (const r of CLIFFS) {
          const d = segDist(p.x, p.z, r.ax, r.az, r.bx, r.bz);
          if (d < s.halfWidth * 0.5) {
            failures.push(
              `${s.id}: cliff of ${r.surface} (${r.high.toFixed(1)} to ${r.low.toFixed(1)}) ${d.toFixed(2)} yd from the centerline at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
            );
            break;
          }
        }
        if (failures.length > 0 && failures[failures.length - 1].startsWith(s.id)) break;
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('every ramp and stair descends without a step taller than the cliff step', () => {
    for (const s of PATHS) {
      let prev: number | null = null;
      for (const p of centerline(s, 0.25)) {
        const h = authoredFieldHeight(FIELD, p.x, p.z);
        if (prev !== null)
          expect(
            Math.abs(h - prev),
            `${s.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`,
          ).toBeLessThan(FIELD.cliffStep);
        prev = h;
      }
    }
  });

  it('the Fern Steps land flush on the south bank, their whole corridor walkable', () => {
    const lower = pathById('fern_steps_lower');
    const end = lower.points[lower.points.length - 1];
    expect(end[2]).toBe(WILDHEART_HEIGHTS.bank);
    clearDungeonGateStateForTest();
    const o = instanceOrigin(DUNGEONS.wildheart_basin.index, 5);
    const blocked: string[] = [];
    for (const p of centerline(lower)) {
      for (const off of [-lower.halfWidth * 0.5, 0, lower.halfWidth * 0.5]) {
        const x = p.x + p.nx * off;
        const z = p.z + p.nz * off;
        if (isBlocked(7, o.x + x, o.z + z, 0.5)) blocked.push(`(${x.toFixed(1)}, ${z.toFixed(1)})`);
      }
    }
    expect(blocked, blocked.slice(0, 12).join(' ')).toEqual([]);
  });

  it('no prop collider and no kit wall stands inside a ramp or stair corridor', () => {
    const WALLS = /Edge|Cliff|Wall|Columns|Fence|Cage|Pylon/;
    const kit = planBasinKitPlacements().filter((k) => WALLS.test(k.piece));
    const failures: string[] = [];
    for (const s of PATHS) {
      const inner = s.halfWidth - 1;
      for (const p of centerline(s)) {
        for (const prop of FIELD.props)
          if (prop.r !== undefined || prop.hw !== undefined)
            if (inProp(prop, p.x, p.z)) failures.push(`${s.id}: ${prop.kind} on its centerline`);
        for (const k of kit)
          if (Math.hypot(k.x - p.x, k.z - p.z) < inner)
            failures.push(`${s.id}: ${k.piece} at (${k.x.toFixed(1)}, ${k.z.toFixed(1)})`);
      }
    }
    expect([...new Set(failures)], [...new Set(failures)].join('\n')).toEqual([]);
  });
});

// ---- the Beast Pits' bone fences ---------------------------------------------------------

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** A fence prop's footprint centerline: its long axis, as the collider lays it. */
function fenceSeg(p: FieldProp): Seg {
  const hw = p.hw ?? 0;
  const ux = Math.cos(p.rot);
  const uz = -Math.sin(p.rot);
  return { ax: p.x - ux * hw, az: p.z - uz * hw, bx: p.x + ux * hw, bz: p.z + uz * hw };
}

/** Proper crossing of two segments (touching at a shared joint does not count). */
function crosses(a: Seg, b: Seg): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(a.ax, a.az, a.bx, a.bz, b.ax, b.az);
  const d2 = o(a.ax, a.az, a.bx, a.bz, b.bx, b.bz);
  const d3 = o(b.ax, b.az, b.bx, b.bz, a.ax, a.az);
  const d4 = o(b.ax, b.az, b.bx, b.bz, a.bx, a.bz);
  const eps = 1e-6;
  return d1 * d2 < -eps && d3 * d4 < -eps;
}

/** Closest approach of two segments (0 when they cross). */
function segGap(a: Seg, b: Seg): number {
  if (crosses(a, b)) return 0;
  return Math.min(
    segDist(a.ax, a.az, b.ax, b.az, b.bx, b.bz),
    segDist(a.bx, a.bz, b.ax, b.az, b.bx, b.bz),
    segDist(b.ax, b.az, a.ax, a.az, a.bx, a.bz),
    segDist(b.bx, b.bz, a.ax, a.az, a.bx, a.bz),
  );
}

describe('Wildheart Basin: the Beast Pits bone fences', () => {
  const fences = FIELD.props.filter((p) => p.kind === 'wb_bone_fence');
  const segs = fences.map(fenceSeg);

  it('stand along the rim (tangent), inside it, never poking through', () => {
    expect(fences.length).toBeGreaterThan(3);
    for (const [i, s] of segs.entries()) {
      // Both ends and the middle stay inside the rim, a stride in from its rail.
      for (const [x, z] of [
        [s.ax, s.az],
        [s.bx, s.bz],
        [fences[i].x, fences[i].z],
      ]) {
        const r = Math.hypot(x - BEAST_PITS.x, z - BEAST_PITS.z);
        expect(r, `fence ${i}`).toBeLessThan(BEAST_PITS.r - 1.5);
        expect(r, `fence ${i}`).toBeGreaterThan(BEAST_PITS.r - 4);
      }
    }
  });

  it('no two fence segments cross or overlap', () => {
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++)
        expect(segGap(segs[i], segs[j]), `fences ${i} and ${j}`).toBeGreaterThan(0.5);
  });

  it('no fence crosses the rim bone rails or the pits stair', () => {
    const rails = planBasinEdges()
      .filter((e) => e.piece === 'Kit_BoneEdge')
      .map((e): Seg => {
        const half = 2 * (e.stretch ?? 1);
        const ux = Math.cos(e.rot);
        const uz = -Math.sin(e.rot);
        return {
          ax: e.x - ux * half,
          az: e.z - uz * half,
          bx: e.x + ux * half,
          bz: e.z + uz * half,
        };
      })
      .filter((r) => Math.hypot(r.ax - BEAST_PITS.x, r.az - BEAST_PITS.z) < BEAST_PITS.r + 8);
    expect(rails.length).toBeGreaterThan(10);
    for (const [i, f] of segs.entries())
      for (const r of rails) expect(segGap(f, r), `fence ${i}`).toBeGreaterThan(0.6);
    const stair = pathById('pits_stair');
    for (const [i, f] of segs.entries())
      for (let k = 0; k < stair.points.length - 1; k++) {
        const [ax, az] = stair.points[k];
        const [bx, bz] = stair.points[k + 1];
        expect(segGap(f, { ax, az, bx, bz }), `fence ${i} on the stair`).toBeGreaterThan(
          stair.halfWidth + 0.5,
        );
      }
  });
});
