// The castles' map plans are DERIVED from the authored sim layouts, never
// re-typed, so this pins the derivation rather than the coordinates: every
// wall run must lie on a real wall centreline, stop dead at its gate spans,
// and every tower must match its layout entry. A castle whose walls move in
// the sim then moves on the map in the same change, and if it does not,
// these fail.
import { describe, expect, it } from 'vitest';
import { CASTLE, CASTLE_GATES, CASTLE_TOWERS } from '../src/sim/castle_layout';
import { DAWNHOLD, DAWNHOLD_GATES, DAWNHOLD_TOWERS } from '../src/sim/dawnhold_layout';
import {
  buildCastlePlanMarkers,
  CASTLE_MAP_PLANS,
  type CastlePlan,
} from '../src/ui/castle_plan_core';

const plan = (id: string): CastlePlan => {
  const p = CASTLE_MAP_PLANS.find((q) => q.id === id);
  if (!p) throw new Error(`no plan ${id}`);
  return p;
};

describe('the castles map plan', () => {
  it('covers both castles and nothing else', () => {
    expect(CASTLE_MAP_PLANS.map((p) => p.id).sort()).toEqual(['dawnhold_castle', 'the_last_keep']);
  });

  it('carries walls, towers and a court for each castle', () => {
    for (const p of CASTLE_MAP_PLANS) {
      const kinds = new Set(p.parts.map((q) => q.part));
      expect([...kinds].sort(), `${p.id} parts`).toEqual(['court', 'tower', 'wall']);
      expect(p.parts.filter((q) => q.part === 'wall').length).toBeGreaterThan(3);
    }
  });

  it('places every tower on its authored layout entry', () => {
    for (const [id, towers] of [
      ['the_last_keep', CASTLE_TOWERS],
      ['dawnhold_castle', DAWNHOLD_TOWERS],
    ] as const) {
      const drawn = plan(id).parts.filter((q) => q.part === 'tower');
      expect(drawn.length, `${id} tower count`).toBe(towers.length);
      for (const t of towers) {
        const hit = drawn.find((q) => q.rect.cx === t.x && q.rect.cz === t.z);
        expect(hit, `${id} tower at (${t.x},${t.z})`).toBeDefined();
        expect(hit?.rect.hw).toBe(t.hw);
      }
    }
  });

  it('opens a real gap at every gate: no wall run crosses a gate span', () => {
    // the Last Keep's main gate is a span on the west curtain (x = wx0)
    const keep = plan('the_last_keep');
    const westRuns = keep.parts.filter(
      (q) => q.part === 'wall' && Math.abs(q.rect.cx - CASTLE.wx0) < 0.01,
    );
    expect(westRuns.length, 'the main gate parts the west curtain').toBeGreaterThan(1);
    for (const r of westRuns) {
      const z0 = r.rect.cz - r.rect.hd;
      const z1 = r.rect.cz + r.rect.hd;
      const g = CASTLE_GATES.main;
      expect(z1 <= g.a0 + 0.01 || z0 >= g.a1 - 0.01, `run ${z0}..${z1} crosses the main gate`).toBe(
        true,
      );
    }
    // Dawnhold's main gate parts its east curtain the same way
    const dawn = plan('dawnhold_castle');
    const eastRuns = dawn.parts.filter(
      (q) => q.part === 'wall' && Math.abs(q.rect.cx - DAWNHOLD.wx1) < 0.01,
    );
    expect(eastRuns.length, 'the main gate parts the east curtain').toBeGreaterThan(1);
    for (const r of eastRuns) {
      const z0 = r.rect.cz - r.rect.hd;
      const z1 = r.rect.cz + r.rect.hd;
      const g = DAWNHOLD_GATES.main;
      expect(z1 <= g.a0 + 0.01 || z0 >= g.a1 - 0.01, `run ${z0}..${z1} crosses the main gate`).toBe(
        true,
      );
    }
  });

  it('reports bounds that contain every part', () => {
    for (const p of CASTLE_MAP_PLANS) {
      for (const { rect } of p.parts) {
        expect(rect.cx - rect.hw).toBeGreaterThanOrEqual(p.minX - 1e-6);
        expect(rect.cx + rect.hw).toBeLessThanOrEqual(p.maxX + 1e-6);
        expect(rect.cz - rect.hd).toBeGreaterThanOrEqual(p.minZ - 1e-6);
        expect(rect.cz + rect.hd).toBeLessThanOrEqual(p.maxZ + 1e-6);
      }
      expect(p.cx).toBeGreaterThan(p.minX);
      expect(p.cx).toBeLessThan(p.maxX);
    }
  });

  it('projects only the castles the view can see, and is deterministic', () => {
    const toMap = (x: number, z: number) => ({ mx: (x - 180) * 1.5, my: (z - 1820) * 1.5 });
    const drakelands = { minX: 180, maxX: 540, minZ: 1820, maxZ: 2420 };
    const evergarden = { minX: 180, maxX: 540, minZ: 700, maxZ: 1260 };
    const keepOnly = buildCastlePlanMarkers(drakelands, toMap);
    const dawnOnly = buildCastlePlanMarkers(evergarden, toMap);
    expect(keepOnly.length).toBe(plan('the_last_keep').parts.length);
    expect(dawnOnly.length).toBe(plan('dawnhold_castle').parts.length);
    // a zone holding neither castle draws none
    expect(buildCastlePlanMarkers({ minX: -400, maxX: -100, minZ: 0, maxZ: 400 }, toMap)).toEqual(
      [],
    );
    // same input, same output
    expect(buildCastlePlanMarkers(drakelands, toMap)).toEqual(keepOnly);
    // and every projected rect has positive extent whatever the axis signs
    const flipped = buildCastlePlanMarkers(drakelands, (x, z) => ({ mx: -x, my: -z }));
    for (const m of flipped) {
      expect(m.w).toBeGreaterThanOrEqual(0);
      expect(m.h).toBeGreaterThanOrEqual(0);
    }
  });
});
