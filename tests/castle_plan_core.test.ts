// The castle map plan is DERIVED from the authored sim layout, never
// re-typed, so this pins the derivation rather than the coordinates: every
// wall run must lie on a real wall centreline, stop dead at its gate spans,
// and every tower must match its layout entry. A castle whose walls move in
// the sim then moves on the map in the same change, and if it does not,
// these fail. (The Last Keep's plan retired with its castle in the
// drakelands-improvements site swap; Dawnhold is the one standing castle.)
import { describe, expect, it } from 'vitest';
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
  it('covers every standing castle and nothing else', () => {
    expect(CASTLE_MAP_PLANS.map((p) => p.id).sort()).toEqual(['dawnhold_castle']);
  });

  it('carries walls, towers and a court for each castle', () => {
    for (const p of CASTLE_MAP_PLANS) {
      const kinds = new Set(p.parts.map((q) => q.part));
      expect([...kinds].sort(), `${p.id} parts`).toEqual(['court', 'tower', 'wall']);
      expect(p.parts.filter((q) => q.part === 'wall').length).toBeGreaterThan(3);
    }
  });

  it('places every tower on its authored layout entry', () => {
    const drawn = plan('dawnhold_castle').parts.filter((q) => q.part === 'tower');
    expect(drawn.length, 'dawnhold_castle tower count').toBe(DAWNHOLD_TOWERS.length);
    for (const t of DAWNHOLD_TOWERS) {
      const hit = drawn.find((q) => q.rect.cx === t.x && q.rect.cz === t.z);
      expect(hit, `dawnhold_castle tower at (${t.x},${t.z})`).toBeDefined();
      expect(hit?.rect.hw).toBe(t.hw);
    }
  });

  it('opens a real gap at every gate: no wall run crosses a gate span', () => {
    // Dawnhold's main gate parts its east curtain
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
    // the Drakelands holds no standing castle since the keep retired
    const drakelands = { minX: 180, maxX: 540, minZ: 1820, maxZ: 2420 };
    const evergarden = { minX: 180, maxX: 540, minZ: 700, maxZ: 1260 };
    expect(buildCastlePlanMarkers(drakelands, toMap)).toEqual([]);
    const dawnOnly = buildCastlePlanMarkers(evergarden, toMap);
    expect(dawnOnly.length).toBe(plan('dawnhold_castle').parts.length);
    // same input, same output
    expect(buildCastlePlanMarkers(evergarden, toMap)).toEqual(dawnOnly);
    // and every projected rect has positive extent whatever the axis signs
    const flipped = buildCastlePlanMarkers(evergarden, (x, z) => ({ mx: -x, my: -z }));
    for (const m of flipped) {
      expect(m.w).toBeGreaterThanOrEqual(0);
      expect(m.h).toBeGreaterThanOrEqual(0);
    }
  });
});
