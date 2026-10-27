// The Anvil of the World's quarters awake (phase 2K, design doc section 5.21):
// the pure state (src/render/smith_heart/heart_quarters_core.ts) and its
// painter (heart_quarters.ts) over the boss memory the final boss's effects
// write.
//   - the memory: what the effects saw, cleared when the heart sleeps;
//   - the modes: a quarter, the ring resting before the pull, the final
//     look in the ring with a fight on, asleep;
//   - a quarter floods out of the ring to the rim; a crossing drains the
//     old one into the ring, holds the new one a breath, then floods it,
//     and shocks the ridge between them from where the boss stands; the
//     final look wakes all four and blazes the ring; deterministic;
//   - the air's seeds lie inside their quarter clear of its ridges, the
//     sparks on their ridge; the low tier keeps a share;
//   - the painter: the awake quarter's seams, wash and air wake, the others
//     stay dark; the washes ride the ground rung; every tier draws the same
//     lights (which quarter is awake is never shed).

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { buildHeartQuarters } from '../src/render/smith_heart/heart_quarters';
import {
  clearHeartQuarterMemoryForTest,
  HEART_QUARTER_AIR,
  HEART_QUARTER_LOW_SHARE,
  HEART_QUARTERS_LOOK,
  heartQuarterBoss,
  heartQuarterCount,
  heartQuarterLit,
  heartQuarterSeeds,
  heartQuartersModeOf,
  heartRidgeSparkSeeds,
  newHeartQuartersState,
  noteHeartQuarterBoss,
  stepHeartQuarters,
} from '../src/render/smith_heart/heart_quarters_core';
import { HEART_ROOM, SMITH_HEART_VEINS } from '../src/sim/content/smith_heart_layout';
import {
  HEART_QUARTER_ORDER,
  HEART_QUARTERS,
  heartQuarterAt,
  heartQuarterRidges,
  heartQuarterSpot,
  heartRidgeDistance,
} from '../src/sim/content/smith_heart_quarters';

const spot = (zone: Parameters<typeof heartQuarterSpot>[0], engaged = false) => ({
  ...heartQuarterSpot(zone),
  engaged,
});

/** Run the state `seconds` at 60 frames a second from `t0`. */
function run(
  s: ReturnType<typeof newHeartQuartersState>,
  boss: ReturnType<typeof spot> | null,
  t0: number,
  seconds: number,
): number {
  let t = t0;
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t += dt;
    stepHeartQuarters(s, boss, t, dt);
  }
  return t;
}

afterEach(() => clearHeartQuarterMemoryForTest());

describe('the boss memory', () => {
  it('keeps what the effects saw, and forgets it when the heart sleeps', () => {
    expect(heartQuarterBoss('k')).toBeNull();
    noteHeartQuarterBoss('k', 1, 2, true, true);
    expect(heartQuarterBoss('k')).toEqual({ x: 1, z: 2, engaged: true });
    noteHeartQuarterBoss('k', 3, 4, false, true);
    expect(heartQuarterBoss('k')).toEqual({ x: 3, z: 4, engaged: false });
    expect(heartQuarterBoss('other')).toBeNull();
    noteHeartQuarterBoss('k', 3, 4, false, false);
    expect(heartQuarterBoss('k')).toBeNull();
  });
});

describe('the modes', () => {
  it('reads a quarter, the ring at rest, the final look and sleep', () => {
    expect(heartQuartersModeOf(null)).toEqual({ mode: 'asleep', zone: null });
    for (const v of HEART_QUARTER_ORDER) {
      expect(heartQuartersModeOf(spot(v))).toEqual({ mode: 'quarter', zone: v });
      expect(heartQuartersModeOf(spot(v, true))).toEqual({ mode: 'quarter', zone: v });
    }
    expect(heartQuartersModeOf(spot('ring'))).toEqual({ mode: 'rest', zone: 'ring' });
    expect(heartQuartersModeOf(spot('ring', true))).toEqual({ mode: 'final', zone: 'ring' });
  });
});

describe('the light stepped', () => {
  const { ringR, rimR } = HEART_QUARTERS;

  it('floods the boss quarter out of the ring to the rim, the others dark but faint', () => {
    const s = newHeartQuartersState();
    run(s, spot('hammer'), 0, 0.5);
    const h = s.quarters.hammer;
    expect(h.awake).toBe(1);
    expect(h.front).toBeGreaterThan(ringR + 5);
    expect(h.front).toBeLessThan(rimR);
    run(s, spot('hammer'), 0.5, 2);
    expect(h.front).toBeGreaterThanOrEqual(rimR);
    expect(heartQuarterLit(h)).toBe(1);
    for (const v of SMITH_HEART_VEINS) {
      if (v === 'hammer') continue;
      expect(s.quarters[v].awake, v).toBe(0);
      expect(s.quarters[v].base, v).toBeCloseTo(HEART_QUARTERS_LOOK.dormant, 6);
      expect(heartQuarterLit(s.quarters[v])).toBeLessThan(0.1);
    }
    expect(s.ring).toBeCloseTo(HEART_QUARTERS_LOOK.ringQuarter, 6);
    expect(s.blaze).toBe(0);
  });

  it('drains the old quarter into the ring, holds the new one a breath, shocks their ridge', () => {
    const s = newHeartQuartersState();
    let t = run(s, spot('hammer'), 0, 3);
    const boss = spot('heat');
    t = run(s, boss, t, 1 / 60);
    // The ridge between the Hammer and the Heat (2) shocks from where the
    // boss stands, the ring pulses.
    expect(s.ridges[2].age).toBeGreaterThanOrEqual(0);
    expect(s.ridges[2].r).toBeCloseTo(Math.hypot(boss.x - HEART_ROOM.x, boss.z - HEART_ROOM.z), 6);
    for (const k of [0, 1, 3]) expect(s.ridges[k].age).toBe(-1);
    expect(s.ringPulse).toBeGreaterThan(0.9);
    // The Heat holds at the ring while the Hammer starts to drain.
    expect(s.quarters.heat.awake).toBe(1);
    expect(s.quarters.heat.front).toBe(ringR);
    expect(s.quarters.hammer.front).toBeLessThan(rimR + 1.5);
    t = run(s, boss, t, HEART_QUARTERS_LOOK.floodDelay - 0.05);
    expect(s.quarters.heat.front).toBe(ringR);
    t = run(s, boss, t, 0.3);
    expect(s.quarters.heat.front).toBeGreaterThan(ringR);
    // Drained dark, the new one at the rim; the shock spent.
    run(s, boss, t, 2);
    expect(s.quarters.hammer.awake).toBe(0);
    expect(s.quarters.hammer.front).toBe(ringR);
    expect(s.quarters.heat.front).toBeGreaterThanOrEqual(rimR);
    expect(s.ridges[2].age).toBe(-1);
  });

  it('sends no ridge shock between opposite quarters', () => {
    const s = newHeartQuartersState();
    const t = run(s, spot('breath'), 0, 2);
    run(s, spot('hammer'), t, 1 / 60);
    expect(s.ridges.every((r) => r.age === -1)).toBe(true);
    expect(s.ringPulse).toBeGreaterThan(0.9);
  });

  it('wakes all four and blazes the ring for the final look; rests before the pull', () => {
    const s = newHeartQuartersState();
    let t = run(s, spot('ring'), 0, 3);
    expect(s.mode).toBe('rest');
    for (const v of SMITH_HEART_VEINS) {
      expect(s.quarters[v].awake).toBe(0);
      expect(s.quarters[v].base).toBeCloseTo(HEART_QUARTERS_LOOK.rest, 6);
    }
    expect(s.ring).toBeCloseTo(HEART_QUARTERS_LOOK.ringRest, 6);
    t = run(s, spot('ring', true), t, 3);
    expect(s.mode).toBe('final');
    for (const v of SMITH_HEART_VEINS) {
      expect(s.quarters[v].awake, v).toBe(1);
      expect(s.quarters[v].front, v).toBeGreaterThanOrEqual(HEART_QUARTERS.rimR);
    }
    expect(s.ring).toBe(1);
    expect(s.blaze).toBe(1);
    // Out of the ring into a quarter: the other three drain away.
    run(s, spot('quench', true), t, 3);
    expect(s.quarters.quench.awake).toBe(1);
    for (const v of ['breath', 'hammer', 'heat'] as const) expect(s.quarters[v].awake, v).toBe(0);
    expect(s.blaze).toBeLessThan(0.1);
  });

  it('goes to sleep with the heart: every quarter and the ring dark', () => {
    const s = newHeartQuartersState();
    const t = run(s, spot('heat', true), 0, 3);
    run(s, null, t, 6);
    expect(s.mode).toBe('asleep');
    for (const v of SMITH_HEART_VEINS) {
      expect(s.quarters[v].awake).toBe(0);
      expect(s.quarters[v].base).toBe(0);
    }
    expect(s.ring).toBe(0);
  });

  it('is deterministic: the same frames, the same light', () => {
    const play = () => {
      const s = newHeartQuartersState();
      let t = 0;
      for (const z of ['hammer', 'heat', 'breath', 'ring', 'quench'] as const)
        t = run(s, spot(z, true), t, 0.9);
      return s;
    };
    expect(play()).toEqual(play());
  });
});

describe('the plans', () => {
  it("seeds each quarter's air inside it, clear of its ridges, the same every time", () => {
    for (const v of HEART_QUARTER_ORDER) {
      const seeds = heartQuarterSeeds(v, 80, 9);
      expect(seeds.length).toBe(80);
      const [a, b] = heartQuarterRidges(v);
      for (const s of seeds) {
        expect(heartQuarterAt(s.x, s.z)).toBe(v);
        expect(heartRidgeDistance(a, s.x, s.z)).toBeGreaterThanOrEqual(2.4);
        expect(heartRidgeDistance(b, s.x, s.z)).toBeGreaterThanOrEqual(2.4);
        expect(s.r).toBeLessThanOrEqual(HEART_QUARTERS.rimR - 1.5 + 1e-9);
      }
      expect(heartQuarterSeeds(v, 80, 9)).toEqual(seeds);
    }
  });

  it('lays the sparks on their ridge, ring to rim', () => {
    for (let k = 0; k < 4; k++) {
      const seeds = heartRidgeSparkSeeds(k, 40);
      for (const s of seeds) {
        expect(heartRidgeDistance(k, s.x, s.z)).toBeLessThan(1e-6);
        expect(s.r).toBeGreaterThan(HEART_QUARTERS.ringR);
        expect(s.r).toBeLessThan(HEART_QUARTERS.rimR);
      }
    }
  });

  it('keeps a share of the cosmetic air on the low tier', () => {
    expect(heartQuarterCount(HEART_QUARTER_AIR.heat.embers, false)).toBe(
      HEART_QUARTER_AIR.heat.embers,
    );
    expect(heartQuarterCount(HEART_QUARTER_AIR.heat.embers, true)).toBe(
      Math.round(HEART_QUARTER_AIR.heat.embers * HEART_QUARTER_LOW_SHARE),
    );
    expect(heartQuarterCount(1, true)).toBe(1);
  });
});

describe('the painter', () => {
  const materialsOf = (g: THREE.Object3D) => {
    const out = new Map<string, THREE.ShaderMaterial>();
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.ShaderMaterial) out.set(m.name, m);
    });
    return out;
  };

  it('wakes the boss quarter, its wash and its air, the others dark; the washes on the ground rung', () => {
    const q = buildHeartQuarters(false);
    const mats = materialsOf(q.group);
    // The washes: one per quarter, on the ground rung.
    const washes: THREE.Object3D[] = [];
    q.group.traverse((o) => {
      if (o.name.startsWith('heartQuarterWash:')) washes.push(o);
    });
    expect(washes.length).toBe(4);
    for (const w of washes) expect(w.renderOrder).toBe(floorVfxRenderOrder('ground', 4));
    // The shades under them, one rung lower (no ties with the dais's runes on 2).
    q.group.traverse((o) => {
      if (o.name.startsWith('heartQuarterShade:'))
        expect(o.renderOrder).toBe(floorVfxRenderOrder('ground', 3));
    });
    noteHeartQuarterBoss(
      'slot',
      heartQuarterSpot('breath').x,
      heartQuarterSpot('breath').z,
      true,
      true,
    );
    let t = 0;
    const frames = (n: number, dark: number) => {
      for (let i = 0; i < n; i++) {
        t += 1 / 60;
        q.update('slot', t, 1 / 60, dark);
      }
    };
    frames(180, 0);
    const wash = (v: string) => mats.get(`smithHeartQuarterWash:${v}`)?.uniforms;
    expect(wash('breath')?.uAwake.value).toBe(1);
    expect(wash('breath')?.uFront.value).toBeGreaterThanOrEqual(HEART_QUARTERS.rimR);
    for (const v of ['hammer', 'quench', 'heat']) expect(wash(v)?.uAwake.value, v).toBe(0);
    expect(mats.get('smithHeartQuarterDevils')?.uniforms.uLit.value).toBe(1);
    expect(mats.get('smithHeartQuarterEmbers')?.uniforms.uLit.value).toBe(0);
    // The heart gone dark: everything with it.
    frames(400, 1);
    expect(wash('breath')?.uAwake.value).toBe(0);
    expect(mats.get('smithHeartQuarterDevils')?.uniforms.uLit.value).toBe(0);
  });

  it('draws the same lights on every tier, only fewer motes on the low one', () => {
    const hi = buildHeartQuarters(false);
    const lo = buildHeartQuarters(true);
    expect([...materialsOf(lo.group).keys()].sort()).toEqual(
      [...materialsOf(hi.group).keys()].sort(),
    );
    const quadsOf = (g: THREE.Object3D, name: string) => {
      let n = 0;
      g.traverse((o) => {
        if (o.name === name) n = ((o as THREE.Mesh).geometry.index?.count ?? 0) / 6;
      });
      return n;
    };
    expect(quadsOf(lo.group, 'heartQuarterGrit:hammer')).toBeLessThan(
      quadsOf(hi.group, 'heartQuarterGrit:hammer'),
    );
    expect(quadsOf(lo.group, 'heartQuarterGrit:hammer')).toBeGreaterThan(0);
  });

  it('writes every point through modelViewMatrix (camera-relative)', () => {
    for (const m of materialsOf(buildHeartQuarters(false).group).values()) {
      expect(m.vertexShader, m.name).toMatch(/modelViewMatrix/);
      expect(m.vertexShader, m.name).not.toMatch(/viewMatrix\s*\*\s*(modelMatrix|vec4)/);
    }
  });
});
