// The Hearth's three looks polished after the floor-ladder pass:
//  - the wellspring (heat_well_core.ts, heat_well_fx.ts): a bounded flow map,
//    so the pool never tears into the rays it used to grow with the clock;
//    crust thick at the lip and thin over the upwelling, broken by heat and
//    overflow; bubbles that swell and pop with a spark; a glow breathing with
//    the fight; the lip's stumps in the Hearth's basalt; the shimmer cosmetic;
//  - the Hearthseeds' ONE field (heat_seed_field_core.ts, heat_seed_field.ts):
//    one outer edge round a cluster (inner edges inside another reach not
//    drawn), the hot cores' union, the summed burst exactly the sim's
//    falloff, the reaches and timing as the sim resolves them;
//  - the Heat vein's route (heat_route_seam.ts): the same ribbon, rung and
//    width, painted as a seam of fire whose pulses run toward the guardian.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer_core';
import { buildHeartRivers } from '../src/render/smith_heart/heart_rivers';
import { HEAT_ROUTE_SEAM, heatSeamPulse } from '../src/render/smith_heart/heat_route_seam';
import { HeatFightFx } from '../src/render/smith_heart_fx';
import { HEAT_BODY_COLORS } from '../src/render/smith_heart_fx/heat_body_core';
import { SEED_CORE_R, wellLook } from '../src/render/smith_heart_fx/heat_fight_fx_core';
import {
  SEED_FIELD,
  type SeedMark,
  seedFieldAt,
  seedFieldBounds,
  seedFieldHeatWeight,
} from '../src/render/smith_heart_fx/heat_seed_field_core';
import {
  stepWellBubbles,
  WELL_BUBBLE,
  WELL_BUBBLES,
  WELL_FLOW,
  wellBubbleLook,
  wellBubbleSlots,
  wellCrust,
  wellFlowAt,
  wellFlowMaxDrift,
  wellFlowPhases,
  wellOutflow,
} from '../src/render/smith_heart_fx/heat_well_core';
import { HEARTH_WELL } from '../src/sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  HEAT_GUARDIAN,
  HEAT_OBJECTS,
  heatTimed,
  seedFalloff,
  HEAT_TUNING as T,
  wellTemplate,
} from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity } from '../src/sim/types';
import type { IWorld } from '../src/world_api';

/** A deterministic rng for the cosmetic draws. */
function lcg(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

describe('heat_well_core: the wellspring moves without tearing', () => {
  /** How far apart, per yard of arc, the pool samples its field between two
   *  neighbouring points on a circle `r` yards out, at clock `t`: the
   *  stretch a pixel's footprint suffers (1 is no stretch). */
  const stretch = (t: number, r: number, sample: (x: number, z: number, t: number) => number[]) => {
    let worst = 0;
    const da = 1e-3;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const p = sample(Math.sin(a) * r, Math.cos(a) * r, t);
      const q = sample(Math.sin(a + da) * r, Math.cos(a + da) * r, t);
      worst = Math.max(worst, Math.hypot(q[0] - p[0], q[1] - p[1]) / (r * da));
    }
    return worst;
  };
  const R = HEARTH_WELL.r + 0.3;
  /** The new pool: each phase drags the field for its own age only. */
  const now = (x: number, z: number, t: number) => {
    const ph = wellFlowPhases(t);
    const f = wellFlowAt(x, z, R);
    const age = (ph.wa >= 0.5 ? ph.a : ph.b) * WELL_FLOW.period;
    return [x - f.x * age, z - f.z * age];
  };
  /** The old pool (the sunburst): the angle's own flow times the clock. */
  const old = (x: number, z: number, t: number) => {
    const px = x / R;
    const pz = z / R;
    const a = Math.atan2(pz, px);
    const fx = Math.cos(a + 1.3) * 0.6 + px * 0.5;
    const fz = Math.sin(a + 1.3) * 0.6 + pz * 0.5;
    return [x * 0.35 - fx * t * 0.35, z * 0.35 - fz * t * 0.35].map((v) => v / 0.35);
  };

  it('was the cause of the sunburst: the old swirl stretched the field with the clock', () => {
    expect(stretch(2, 4, old)).toBeLessThan(2);
    expect(stretch(600, 4, old)).toBeGreaterThan(50);
    expect(stretch(3600, 4, old)).toBeGreaterThan(stretch(600, 4, old) * 5);
  });

  it('keeps the warp bounded at any clock: the same pool at second 5 and at hour 30', () => {
    const bound = 1 + 2 * WELL_FLOW.period;
    for (const t of [0.5, 5, 61, 600, 3600, 36000, 108000])
      for (const r of [1, 3, 5, 7.5])
        expect(stretch(t, r, now), `t ${t} r ${r}`).toBeLessThan(bound);
    expect(wellFlowMaxDrift()).toBeCloseTo(
      Math.hypot(WELL_FLOW.speed, WELL_FLOW.swirl) * WELL_FLOW.period,
      9,
    );
    for (let t = 0; t < 40; t += 0.37) {
      const ph = wellFlowPhases(t);
      expect(ph.a).toBeGreaterThanOrEqual(0);
      expect(ph.a).toBeLessThan(1);
      expect(ph.wa).toBeGreaterThanOrEqual(0);
      expect(ph.wa).toBeLessThanOrEqual(1);
      // A phase restarts only while it weighs nothing.
      if (ph.a < 1e-6) expect(ph.wa).toBeCloseTo(0, 6);
    }
  });

  it('wells up under the guardian and spreads to the lip, slowing there', () => {
    expect(wellOutflow(0)).toBe(0);
    expect(wellOutflow(0.5)).toBeCloseTo(WELL_FLOW.speed, 9);
    expect(wellOutflow(1)).toBeLessThan(wellOutflow(0.5) * 0.5);
    const f = wellFlowAt(4, 0, R);
    expect(f.x).toBeGreaterThan(0);
    expect(Math.abs(f.z)).toBeGreaterThan(0);
  });

  it('lays the crust thick at the lip and thin over the upwelling; heat and overflow break it', () => {
    expect(wellCrust(0.95, 1, 0)).toBeGreaterThan(wellCrust(0.1, 1, 0) * 1.8);
    expect(wellCrust(0.6, 1.45, 0)).toBeLessThan(wellCrust(0.6, 0.85, 0));
    expect(wellCrust(0.6, 1, 1)).toBeLessThan(wellCrust(0.6, 1, 0) * 0.5);
    expect(wellCrust(0.6, 1.45, 1)).toBeGreaterThan(0);
  });

  it('swells its bubbles through the crust, then pops each once with a spark, on the open pool', () => {
    const slots = wellBubbleSlots();
    expect(slots).toHaveLength(WELL_BUBBLES);
    const rand = lcg(11);
    const pops: number[][] = [];
    const live = new Map<number, { x: number; z: number }>();
    let lastRadius = 0;
    for (let i = 0; i < 400; i++) {
      stepWellBubbles(slots, 0.05, 6, HEARTH_WELL.r, rand, (x, z, size) => pops.push([x, z, size]));
      for (const b of slots) {
        if (b.age < 0) continue;
        expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(HEARTH_WELL.r * 0.82 + 1e-9);
        live.set(slots.indexOf(b), { x: b.x, z: b.z });
      }
      const b0 = slots[0];
      if (b0.age >= 0) {
        const look = wellBubbleLook(b0);
        if (look.pop === 0 && b0.age > 0.06)
          expect(look.radius).toBeGreaterThanOrEqual(lastRadius - 1e-9);
        lastRadius = look.pop === 0 ? look.radius : 0;
        expect(look.radius).toBeLessThanOrEqual(b0.size + 1e-9);
      } else lastRadius = 0;
    }
    expect(pops.length).toBeGreaterThan(20);
    for (const [, , size] of pops) {
      expect(size).toBeGreaterThanOrEqual(WELL_BUBBLE.size[0]);
      expect(size).toBeLessThanOrEqual(WELL_BUBBLE.size[1]);
    }
    // The pop runs over the bubble's last stretch only.
    const b = { x: 0, z: 0, age: 1, life: 2, size: 1 };
    expect(wellBubbleLook(b).pop).toBe(0);
    b.age = 2 * (1 - WELL_BUBBLE.pop / 2);
    expect(wellBubbleLook(b).pop).toBeCloseTo(0.5, 6);
    // No boil, no new bubbles.
    const calm = wellBubbleSlots();
    stepWellBubbles(calm, 0.05, 0, HEARTH_WELL.r, lcg(3), () => {});
    expect(calm.every((s) => s.age < 0)).toBe(true);
  });

  it('breathes its glow with the fight and throbs while the Hearth overflows', () => {
    const peak = (state: 'calm' | 'over', phase: number) => {
      let m = 0;
      for (let t = 0; t < 12; t += 0.05) m = Math.max(m, wellLook(state, phase, t).pulse);
      return m;
    };
    expect(peak('calm', 3)).toBeGreaterThan(peak('calm', 1));
    expect(peak('calm', 1)).toBeLessThanOrEqual(1);
    for (let t = 0; t < 4; t += 0.1)
      expect(wellLook('over', 2, t).pulse).toBeGreaterThanOrEqual(0.55);
  });
});

describe('heat_seed_field_core: a cluster of seeds reads as one shape', () => {
  const R = T.seedReach;
  const seeds: SeedMark[] = [
    { x: 0, z: 0, reach: R, fill: 0.5 },
    { x: 6, z: 0, reach: R, fill: 0.5 },
    { x: 3, z: 5, reach: R, fill: 0.5 },
  ];

  it('draws only the outer edge: a reach edge inside another reach is no edge', () => {
    // Seed 0's own edge toward seed 1 lies inside seed 1's reach.
    const inner = seedFieldAt(R, 0, seeds, 3, SEED_CORE_R);
    expect(inner.reachEdge).toBeLessThan(-4);
    // The cluster's far side is the union's edge.
    const outer = seedFieldAt(-R, 0, seeds, 3, SEED_CORE_R);
    expect(outer.reachEdge).toBeCloseTo(0, 9);
    // Outside every reach: outside the field.
    expect(seedFieldAt(-R - 1, 0, seeds, 3, SEED_CORE_R).reachEdge).toBeCloseTo(1, 9);
    // The same for the cores: seed 0's core edge toward seed 1 sits in seed 1's core.
    expect(seedFieldAt(SEED_CORE_R, 0, seeds, 3, SEED_CORE_R).coreEdge).toBeLessThan(-0.5);
    expect(seedFieldAt(-SEED_CORE_R, 0, seeds, 3, SEED_CORE_R).coreEdge).toBeCloseTo(0, 9);
  });

  it("sums the bursts exactly as the sim strikes: every seed's falloff, hotter where they stack", () => {
    for (const [x, z] of [
      [0, 0],
      [3, 2],
      [-10, 4],
      [15, -9],
    ]) {
      let struck = 0;
      for (const s of seeds) struck += seedFalloff(Math.hypot(x - s.x, z - s.z));
      expect(seedFieldAt(x, z, seeds, 3, SEED_CORE_R).heat).toBeCloseTo(struck / T.seedMax, 9);
    }
    // A lone seed: 1 at its middle, 0 at its reach.
    expect(seedFieldAt(0, 0, seeds, 1, SEED_CORE_R).heat).toBeCloseTo(1, 9);
    expect(seedFieldAt(R, 0, seeds, 1, SEED_CORE_R).heat).toBe(0);
    // Hotter between two seeds than as far from one alone.
    expect(seedFieldAt(3, 0, seeds, 2, SEED_CORE_R).heat).toBeGreaterThan(
      seedFieldAt(3, 0, seeds, 1, SEED_CORE_R).heat,
    );
    expect(seedFieldHeatWeight(0)).toBe(0.25);
    expect(seedFieldHeatWeight(1)).toBe(1);
    expect(seedFieldHeatWeight(2)).toBeCloseTo(1.3, 9);
  });

  it("sweeps each seed's core to the burst and its reach to half way, one front", () => {
    const s = [{ x: 0, z: 0, reach: R, fill: 1 }];
    expect(seedFieldAt(SEED_CORE_R - 0.01, 0, s, 1, SEED_CORE_R).coreFront).toBeLessThan(0);
    expect(seedFieldAt(R / 2 - 0.01, 0, s, 1, SEED_CORE_R).reachFront).toBeLessThan(0);
    expect(seedFieldAt(R / 2 + 0.5, 0, s, 1, SEED_CORE_R).reachFront).toBeGreaterThan(0);
    s[0].fill = 0;
    expect(seedFieldAt(0.5, 0, s, 1, SEED_CORE_R).coreFront).toBeGreaterThan(0);
  });

  it('lays its grid over every reach', () => {
    const b = seedFieldBounds(seeds, 3, SEED_FIELD.pad);
    for (const s of seeds) {
      expect(Math.abs(s.x - b.x) + s.reach).toBeLessThanOrEqual(b.half);
      expect(Math.abs(s.z - b.z) + s.reach).toBeLessThanOrEqual(b.half);
    }
    expect(seedFieldBounds(seeds, 0, 1).half).toBe(0);
  });
});

describe('HeatFightFx over a fake world: the wellspring and the seed field', () => {
  const o = instanceOrigin(DUNGEONS.smith_heart.index, 0);
  let nextId = 1;
  const entity = (kind: string, templateId: string, x: number, z: number, scale = 1) =>
    ({
      id: nextId++,
      kind,
      templateId,
      name: templateId,
      pos: { x: o.x + x, y: 0, z: o.z + z },
      prevPos: { x: o.x + x, y: 0, z: o.z + z },
      facing: 0,
      scale,
      hp: 100,
      maxHp: 100,
      dead: false,
      auras: [] as Entity['auras'],
      castingAbility: null as string | null,
      castTargetId: null,
      castRemaining: 0,
      castTotal: 0,
    }) as unknown as Entity;

  it('boils, pops its bubbles, keeps its lip in basalt and its shimmer; the seeds draw one field', () => {
    const entities = new Map<number, Entity>();
    const add = (e: Entity) => {
      entities.set(e.id, e);
      return e;
    };
    const me = add(entity('player', 'warrior', -206, 2));
    add(entity('mob', HEAT_GUARDIAN, HEARTH_WELL.x, HEARTH_WELL.z));
    add(entity('object', wellTemplate('calm'), HEARTH_WELL.x, HEARTH_WELL.z));
    const world = {
      entities,
      player: me,
      playerId: me.id,
      entityRosterVersion: 1,
    } as unknown as IWorld;
    const bump = () => {
      (world as unknown as { entityRosterVersion: number }).entityRosterVersion++;
    };
    const scene = new THREE.Scene();
    const fx = new HeatFightFx(
      scene,
      () => 0,
      world,
      undefined,
      () => false,
      () => {},
    );
    const run = (n: number) => {
      for (let i = 0; i < n; i++) fx.update(1 / 20);
    };
    const byName = (name: string) => scene.getObjectByName(name) as THREE.Mesh;
    run(4);
    const pool = byName('smithHeartHeatWellPool');
    const mat = pool.material as THREE.ShaderMaterial;
    // The pool's field: phases of one period on yards off its middle, never
    // the clock times a per-pixel flow, never world coordinates.
    expect(mat.fragmentShader).toContain('fract(ta)');
    expect(mat.fragmentShader).not.toMatch(/flow\s*\*\s*uTime|uTime\s*\*\s*flow/);
    expect(mat.fragmentShader).not.toContain('vW');
    // Bubbles swell in over a few seconds of boil.
    run(80);
    const bub = mat.uniforms.uBub.value as THREE.Vector4[];
    expect(bub).toHaveLength(WELL_BUBBLES);
    expect(bub.some((v) => v.z > 0)).toBe(true);
    for (const v of bub)
      if (v.z > 0) expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(HEARTH_WELL.r);
    // The lip in the Hearth's sooted basalt, never the kit's pale stone.
    const lip = byName('smithHeartHeatWellLip');
    const col = lip.geometry.getAttribute('color') as THREE.BufferAttribute;
    let brightest = 0;
    for (let i = 0; i < col.count; i++) brightest = Math.max(brightest, col.getX(i));
    expect(brightest).toBeLessThanOrEqual(HEAT_BODY_COLORS.basalt[0] + 1e-6);
    // The shimmer stands over the lip (cosmetic: this test runs a detailed tier).
    const shimmer = byName('smithHeartHeatWellShimmer');
    expect(shimmer.visible).toBe(true);
    expect((shimmer.material as THREE.Material).blending).toBe(THREE.AdditiveBlending);

    // Ten seeds under a stacked raid: one field, every seed laid.
    const field = byName('smithHeartHeatSeedField');
    expect(field.visible).toBe(false);
    const seedIds: number[] = [];
    for (let i = 0; i < T.seedCap; i++) {
      const e = add(
        entity(
          'object',
          heatTimed(HEAT_OBJECTS.seedPrefix, T.seedLife),
          -204 + (i % 5) * 3,
          -4 + Math.floor(i / 5) * 6,
          T.seedReach,
        ),
      );
      seedIds.push(e.id);
    }
    bump();
    run(8);
    expect(field.visible).toBe(true);
    const fu = (field.material as THREE.ShaderMaterial).uniforms;
    expect(fu.uCount.value).toBe(T.seedCap);
    const marks = fu.uSeeds.value as THREE.Vector4[];
    for (let i = 0; i < T.seedCap; i++) expect(marks[i].z).toBe(T.seedReach);
    // Each seed sits at its own spot off the grid's middle.
    const mid = field.position;
    const first = entities.get(seedIds[0]) as Entity;
    expect(marks[0].x + mid.x).toBeCloseTo(first.pos.x, 3);
    expect(marks[0].y + mid.z).toBeCloseTo(first.pos.z, 3);
    expect(fu.uCoreR.value).toBe(SEED_CORE_R);
    // Their fills run on the sim's clock.
    const f0 = marks[0].w;
    run(20);
    expect(marks[0].w).toBeGreaterThan(f0);
    // A seed bursts: the field is re-laid round the rest; all gone, it hides.
    entities.delete(seedIds[0]);
    bump();
    run(8);
    expect(fu.uCount.value).toBe(T.seedCap - 1);
    for (const id of seedIds) entities.delete(id);
    bump();
    run(8);
    expect(field.visible).toBe(false);
    fx.dispose();
  });
});

describe("heat_route_seam: the Heat vein's route as a seam of fire", () => {
  it('keeps the ribbon, its rung and its width; paints it as the seam on the Heat vein only', () => {
    const rivers = buildHeartRivers();
    const dim = rivers.group.getObjectByName('river:heat:dim') as THREE.Mesh;
    const mat = dim.material as THREE.ShaderMaterial;
    expect(mat.name).toBe('smithHeartRiver:heat:seam');
    expect(dim.renderOrder).toBe(floorVfxRenderOrder('ground', 3));
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(dim.geometry.getAttribute('aArc')).toBeDefined();
    expect(dim.geometry.getAttribute('aSide').count).toBe(
      dim.geometry.getAttribute('position').count,
    );
    expect(mat.vertexShader).toContain('projectionMatrix * modelViewMatrix');
    // The other veins keep their own light.
    const hammer = rivers.group.getObjectByName('river:hammer:dim') as THREE.Mesh;
    expect((hammer.material as THREE.Material).name).toBe('smithHeartRiver:hammer:dim');
    // The bright twin still rides over it.
    const lit = rivers.group.getObjectByName('river:heat:lit') as THREE.Mesh;
    expect(lit.renderOrder).toBeGreaterThan(dim.renderOrder);
  });

  it('runs its pulses toward the guardian (the ribbon starts at the arena)', () => {
    // Follow one crest: a beat later it sits closer to arc 0.
    const crestNear = (t: number, from: number) => {
      let best = from;
      let bv = -1;
      for (
        let a = from - HEAT_ROUTE_SEAM.wavelength / 2;
        a <= from + HEAT_ROUTE_SEAM.wavelength / 2;
        a += 0.01
      ) {
        const v = heatSeamPulse(a, t);
        if (v > bv) {
          bv = v;
          best = a;
        }
      }
      return best;
    };
    const c0 = crestNear(0, 60);
    const c1 = crestNear(0.5, c0);
    expect(c1).toBeLessThan(c0);
    expect(c0 - c1).toBeCloseTo(HEAT_ROUTE_SEAM.speed * 0.5, 1);
    for (let a = 0; a < 40; a += 0.7) {
      expect(heatSeamPulse(a, 3)).toBeGreaterThanOrEqual(0);
      expect(heatSeamPulse(a, 3)).toBeLessThanOrEqual(1);
    }
  });
});
