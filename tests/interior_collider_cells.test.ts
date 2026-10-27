// The interior collider cell index (src/sim/interior_collider_cells.ts) is an
// EXACT acceleration of the interior arms of colliders.ts: resolvePosition,
// supportHeightAt and the line-of-sight sampler must return byte-identical
// results with the index on and off, on every authored dungeon interior,
// including points deep inside colliders, points on cell borders, bodies
// wider than the registration margin (the ring read) and bodies so wide the
// index steps aside. The bounded resolve's fallback (a push that carries the
// point out of its cell) must actually fire somewhere in the sample, or the
// test would not be covering the arm that makes the subset exact. Every
// interior a dungeon record names is swept (the six reworked authored fields
// densely), plus a slot with half its gates open (its own filtered list and
// index) and the degenerate radii the index must step aside for.

import { afterEach, describe, expect, it } from 'vitest';
import { colliderBounds } from '../src/sim/collider_cells';
import { resolveAgainst } from '../src/sim/collider_pushout';
import {
  type Collider,
  lineOfSightClear,
  resolvePosition,
  supportHeightAt,
} from '../src/sim/colliders';
import { DUNGEON_FLOOR_Y, DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  clearCombatWallStateForTest,
  setCombatWalls,
} from '../src/sim/instances/combat_wall_state';
import {
  clearDungeonGateStateForTest,
  setOpenDungeonGates,
} from '../src/sim/instances/dungeon_gate_state';
import {
  INTERIOR_CELL,
  INTERIOR_CELL_MARGIN,
  interiorCellCandidates,
  interiorReach,
  setInteriorCellIndexEnabled,
} from '../src/sim/interior_collider_cells';
import { derivedInteriorColliders, interiorCollidersFor } from '../src/sim/interior_collider_sets';

const SEED = 93;
const REWORKED = [
  'gravewyrm_sanctum',
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'wildheart_basin',
];
/** Every dungeon that names an interior (one per interior set). */
const ALL_INTERIORS = Object.keys(DUNGEONS).filter((id) => DUNGEONS[id].interior);
// 0.5 is BODY_RADIUS; 1.6 reads ring 1 and 20 ring 2 (bodies wider than the margin).
const RADII = [0.5, 0.8, 1.6, 20];

afterEach(() => {
  setInteriorCellIndexEnabled(true);
  clearDungeonGateStateForTest();
});

function interiorList(dungeonId: string): Collider[] {
  return derivedInteriorColliders(dungeonId, DUNGEONS[dungeonId].interior as string, {});
}

/** Local sample points: a coarse lattice over the field, every collider's
 *  centre (deep inside: the long pushes), its edges, and the cell borders. */
function samplePoints(list: Collider[], step = 7.3): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let x = -118; x <= 118; x += step)
    for (let z = -248; z <= 248; z += step) pts.push({ x, z });
  for (const c of list) {
    const b = colliderBounds(c);
    pts.push(
      { x: c.x, z: c.z },
      { x: b.minX - 0.2, z: c.z },
      { x: b.maxX + 0.2, z: c.z },
      { x: c.x, z: b.minZ + 0.1 },
      { x: c.x, z: b.maxZ - 0.1 },
    );
  }
  for (let gx = -8; gx <= 8; gx++)
    for (let z = -240; z <= 240; z += 11) pts.push({ x: gx * INTERIOR_CELL - 1e-9, z });
  return pts;
}

function both<T>(fn: () => T): [T, T] {
  setInteriorCellIndexEnabled(false);
  const full = fn();
  setInteriorCellIndexEnabled(true);
  return [full, fn()];
}

describe('interior collider cell index', () => {
  it('reads far fewer colliders than the full list (the point of it)', () => {
    for (const id of REWORKED) {
      const list = interiorList(id);
      let total = 0;
      let n = 0;
      for (const p of samplePoints(list)) {
        total += (interiorCellCandidates(list, p.x, p.z, interiorReach(0.5)) ?? list).length;
        n++;
      }
      expect(total / n, id).toBeLessThan(list.length / 10);
    }
  });

  it('never files a collider twice in one interior list (the ring read dedupes)', () => {
    for (const id of ALL_INTERIORS) {
      const list = interiorList(id);
      expect(new Set(list).size, id).toBe(list.length);
    }
  });

  it('steps aside past the widest ring, for a NaN or negative reach, and when disabled', () => {
    const list = interiorList('gravewyrm_sanctum');
    expect(interiorCellCandidates(list, 0, 0, INTERIOR_CELL_MARGIN + 3 * INTERIOR_CELL)).toBeNull();
    expect(interiorCellCandidates(list, Number.NaN, 0, 1)).toBeNull();
    expect(interiorCellCandidates(list, 0, 0, Number.NaN)).toBeNull();
    expect(interiorCellCandidates(list, 0, 0, -1)).toBeNull();
    // ...so a degenerate radius resolves exactly like the full scan.
    const o = instanceOrigin(DUNGEONS.gravewyrm_sanctum.index, 0);
    for (const r of [Number.NaN, -0.5, -40]) {
      for (const p of samplePoints(list, 23)) {
        const [a, b] = both(() => resolvePosition(SEED, o.x + p.x, o.z + p.z, r));
        expect(Object.is(a.x, b.x) && Object.is(a.z, b.z), `r ${r} (${p.x}, ${p.z})`).toBe(true);
      }
    }
    setInteriorCellIndexEnabled(false);
    expect(interiorCellCandidates(list, 0, 0, 1)).toBeNull();
  });

  it('resolvePosition is byte-identical with the index on and off', () => {
    let fallbacks = 0;
    let pushed = 0;
    const mismatches: string[] = [];
    for (const id of ALL_INTERIORS) {
      const def = DUNGEONS[id];
      const o = instanceOrigin(def.index, 0);
      const list = interiorList(id);
      const mover = { y: DUNGEON_FLOOR_Y + 0.4, lift: 0.9 };
      for (const p of samplePoints(list, REWORKED.includes(id) ? 7.3 : 13)) {
        for (const r of RADII) {
          const wx = o.x + p.x;
          const wz = o.z + p.z;
          const [a, b] = both(() => resolvePosition(SEED, wx, wz, r));
          if (a.x !== b.x || a.z !== b.z) mismatches.push(`${id} (${p.x}, ${p.z}) r ${r}`);
          if (a.x !== wx || a.z !== wz) pushed++;
          if (r === 0.5) {
            const [c, d] = both(() => resolvePosition(SEED, wx, wz, r, true, undefined, mover));
            if (c.x !== d.x || c.z !== d.z) mismatches.push(`${id} mover (${p.x}, ${p.z})`);
          }
          // Count the bounded resolve giving up (the full-list re-run arm).
          const cand = interiorCellCandidates(list, p.x, p.z, interiorReach(r));
          if (cand) {
            const gx = Math.floor(p.x / INTERIOR_CELL);
            const gz = Math.floor(p.z / INTERIOR_CELL);
            const box = {
              minX: gx * INTERIOR_CELL,
              maxX: (gx + 1) * INTERIOR_CELL,
              minZ: gz * INTERIOR_CELL,
              maxZ: (gz + 1) * INTERIOR_CELL,
            };
            if (resolveAgainst(cand, p.x, p.z, r, false, undefined, box) === null) fallbacks++;
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(pushed).toBeGreaterThan(1000);
    expect(fallbacks).toBeGreaterThan(0);
  });

  it('a slot with gates open resolves identically through its own filtered list', () => {
    const mismatches: string[] = [];
    let gated = 0;
    for (const id of ALL_INTERIORS) {
      const gates = DUNGEONS[id].gates ?? [];
      if (gates.length === 0) continue;
      gated++;
      const o = instanceOrigin(DUNGEONS[id].index, 1);
      setOpenDungeonGates(
        o.x,
        o.z,
        gates.filter((_, i) => i % 2 === 0).map((g) => g.id),
      );
      const list = interiorList(id);
      for (const p of samplePoints(list, 11)) {
        for (const r of [0.5, 1.6]) {
          const [a, b] = both(() => resolvePosition(SEED, o.x + p.x, o.z + p.z, r));
          if (a.x !== b.x || a.z !== b.z) mismatches.push(`${id} gated (${p.x}, ${p.z}) r ${r}`);
        }
      }
    }
    // The five gated open-air reworks (the Stormbrass Foundry, the sixth, is
    // parked).
    expect(gated).toBeGreaterThanOrEqual(5);
    expect(mismatches).toEqual([]);
  });

  it('supportHeightAt and line of sight are identical with the index on and off', () => {
    const mismatches: string[] = [];
    let blocked = 0;
    for (const id of ALL_INTERIORS) {
      const def = DUNGEONS[id];
      const o = instanceOrigin(def.index, 0);
      const list = interiorList(id);
      const pts = samplePoints(list, REWORKED.includes(id) ? 7.3 : 13);
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const wx = o.x + p.x;
        const wz = o.z + p.z;
        const [a, b] = both(() => supportHeightAt(SEED, wx, wz, 0.5, DUNGEON_FLOOR_Y + 40));
        if (a !== b) mismatches.push(`${id} support (${p.x}, ${p.z})`);
        if (i % 5 === 0) {
          // A short sight line (up to ~40 yd, the casting range) across the point.
          const ang = i * 2.399;
          const len = 8 + (i % 32);
          const from = { x: wx, z: wz };
          const to = { x: wx + Math.sin(ang) * len, z: wz + Math.cos(ang) * len };
          const [s, t] = both(() => lineOfSightClear(SEED, from, to));
          if (s !== t) mismatches.push(`${id} sight (${p.x}, ${p.z}) dir ${ang}`);
          if (!s) blocked++;
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(blocked).toBeGreaterThan(100);
  });

  it('a slot whose walls move re-files only the walls, exactly as a full rebuild would', () => {
    // The Smith's Heart's Quarry with the mythic Walking Slab dragging past
    // two standing pillars: the walled list is the base plus its walls
    // (instances/combat_wall_state.ts), indexed as the base's cells with the
    // walls filed over them, never a rebuild of the field.
    const id = 'smith_heart';
    const def = DUNGEONS[id];
    const o = instanceOrigin(def.index, 2);
    const interior = def.interior as string;
    const base = interiorCollidersFor(id, interior, o.x, o.z);
    const wall = (wid: number, templateId: string, x: number, z: number) => ({
      id: wid,
      templateId,
      x,
      z,
      y: DUNGEON_FLOOR_Y,
      rot: 0,
      scale: 1,
    });
    const mismatches: string[] = [];
    try {
      for (let step = 0; step < 3; step++) {
        const sx = 8 + step * 0.5;
        setCombatWalls(o.x, o.z, [
          wall(1, 'sh_council_pillar_3', 14, -182),
          wall(2, 'sh_council_risen_1', 0, -166),
          wall(3, 'sh_council_soul_slabwright_c_3', sx, -172),
          wall(4, 'sanctum_ice_slab', -2, -190),
        ]);
        const walled = interiorCollidersFor(id, interior, o.x, o.z);
        expect(walled.length).toBe(base.length + 4);
        // A cell the walls never touch is the base's own (shared, not rebuilt).
        const far = base.find((c) => Math.hypot(c.x - 8, c.z + 170) > 60) as Collider;
        const farCell = interiorCellCandidates(base, far.x, far.z, interiorReach(0.5));
        expect(farCell?.length).toBeGreaterThan(0);
        expect(interiorCellCandidates(walled, far.x, far.z, interiorReach(0.5))).toBe(farCell);
        let k = 0;
        for (let x = -18; x <= 30; x += 1.7)
          for (let z = -196; z <= -150; z += 1.7)
            for (const r of [0.5, 1.6]) {
              k++;
              const [a, b] = both(() => resolvePosition(SEED, o.x + x, o.z + z, r));
              if (a.x !== b.x || a.z !== b.z) mismatches.push(`step ${step} (${x}, ${z}) r ${r}`);
              if (k % 6 !== 0) continue;
              const [c, d] = both(() =>
                lineOfSightClear(SEED, { x: o.x + x, z: o.z + z }, { x: o.x + sx, z: o.z - 150 }),
              );
              if (c !== d) mismatches.push(`sight step ${step} (${x}, ${z})`);
            }
      }
    } finally {
      clearCombatWallStateForTest();
    }
    expect(mismatches).toEqual([]);
  }, 120_000);
});
