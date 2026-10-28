// The Anvil of the World's quarters awake (phases 2K to 2M, design doc section 5.21):
// the pure state (src/render/smith_heart/heart_quarters_core.ts) and its
// painter (heart_quarters.ts) over the boss memory the final boss's effects
// write.
//   - the memory: what the effects saw, cleared when the heart sleeps;
//   - the modes: a quarter, the ring resting (no quarter awake, even with a
//     fight on), the final look in the ring only in the final phase (phase
//     2L), asleep;
//   - a quarter floods out of the ring to the rim; a crossing drains the
//     old one into the ring, holds the new one a breath, then floods it,
//     and shocks the ridge between them from where the boss stands; the
//     final look wakes all four and blazes the ring; deterministic;
//   - the air's seeds lie inside their quarter clear of its ridges, the
//     sparks on their ridge; the low tier keeps a share;
//   - the painter: the awake quarter's seams, wash and air wake, the others
//     stay dark; the washes ride the ground rung; every tier draws the same
//     lights (which quarter is awake is never shed);
//   - phase 2M: every quarter keeps its quiet tint asleep (one floor, never
//     darkened); each quarter's wall landmark erupts as its flood reaches
//     the wall, all four in the final look, dark with the heart; the
//     landmarks' spots stand in their own quarters, the Breath's bolts run
//     from its horns' tips; the circle's well and rim draw with the room.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { floorVfxRenderOrder } from '../src/render/floor_vfx_layer';
import { heartKitSlotMaterial } from '../src/render/smith_heart/heart_kit';
import {
  HEART_LANDMARK_FRAME,
  heartBreathBolts,
  heartBreathHornTips,
  heartLandmarkLit,
  heartLandmarkSpots,
} from '../src/render/smith_heart/heart_landmarks_core';
import { buildHeartQuarters } from '../src/render/smith_heart/heart_quarters';
import {
  clearHeartQuarterMemoryForTest,
  HEART_PLATFORM_ORDER,
  HEART_QUARTER_AIR,
  HEART_QUARTER_LOW_SHARE,
  HEART_QUARTER_PALETTE,
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

const spot = (zone: Parameters<typeof heartQuarterSpot>[0], engaged = false, final = engaged) => ({
  ...heartQuarterSpot(zone),
  engaged,
  final,
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
    noteHeartQuarterBoss('k', 1, 2, true, true, true);
    expect(heartQuarterBoss('k')).toEqual({ x: 1, z: 2, engaged: true, final: true });
    noteHeartQuarterBoss('k', 3, 4, false, true);
    expect(heartQuarterBoss('k')).toEqual({ x: 3, z: 4, engaged: false, final: false });
    expect(heartQuarterBoss('other')).toBeNull();
    noteHeartQuarterBoss('k', 3, 4, false, false);
    expect(heartQuarterBoss('k')).toBeNull();
  });
});

describe('the modes', () => {
  it('reads a quarter, the ring at rest, the final look only in the final phase, and sleep', () => {
    expect(heartQuartersModeOf(null)).toEqual({ mode: 'asleep', zone: null });
    for (const v of HEART_QUARTER_ORDER) {
      expect(heartQuartersModeOf(spot(v))).toEqual({ mode: 'quarter', zone: v });
      expect(heartQuartersModeOf(spot(v, true))).toEqual({ mode: 'quarter', zone: v });
    }
    expect(heartQuartersModeOf(spot('ring'))).toEqual({ mode: 'rest', zone: 'ring' });
    // A pull in the ring above the final phase's share wakes no quarter.
    expect(heartQuartersModeOf(spot('ring', true, false))).toEqual({ mode: 'rest', zone: 'ring' });
    expect(heartQuartersModeOf(spot('ring', true))).toEqual({ mode: 'final', zone: 'ring' });
    // The final phase outside a fight is no final look.
    expect(heartQuartersModeOf(spot('ring', false, true))).toEqual({ mode: 'rest', zone: 'ring' });
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

  it('wakes all four and blazes the ring for the final look; rests before it, pulled or not', () => {
    const s = newHeartQuartersState();
    let t = run(s, spot('ring'), 0, 3);
    expect(s.mode).toBe('rest');
    for (const v of SMITH_HEART_VEINS) {
      expect(s.quarters[v].awake).toBe(0);
      expect(s.quarters[v].base).toBeCloseTo(HEART_QUARTERS_LOOK.rest, 6);
    }
    expect(s.ring).toBeCloseTo(HEART_QUARTERS_LOOK.ringRest, 6);
    // The pull at full health (the boss starts in the ring): still no
    // quarter awake, no blaze, the rest no brighter than a faint breath.
    t = run(s, spot('ring', true, false), t, 3);
    expect(s.mode).toBe('rest');
    for (const v of SMITH_HEART_VEINS) expect(s.quarters[v].awake, v).toBe(0);
    expect(s.blaze).toBe(0);
    expect(HEART_QUARTERS_LOOK.rest).toBeLessThanOrEqual(0.12);
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

describe('the quarters read apart (phase 2L)', () => {
  const hsl = (hex: number) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 });

  it("lights the Heat in the hearth's red-orange, never gold, and the Hammer apart from it", () => {
    const heat = hsl(HEART_QUARTER_PALETTE.heat.color);
    const hammer = hsl(HEART_QUARTER_PALETTE.hammer.color);
    // Hue in turns: red-orange under about 25 degrees, the Hammer's sand-amber
    // well round from it.
    expect(heat.h * 360).toBeLessThan(25);
    expect(hammer.h * 360 - heat.h * 360).toBeGreaterThan(15);
    // The Heat smoulders asleep (it reads as fire even dark); the others
    // barely breathe.
    expect(HEART_QUARTER_PALETTE.heat.idle).toBeGreaterThan(0.2);
    for (const v of ['hammer', 'breath', 'quench'] as const)
      expect(HEART_QUARTER_PALETTE[v].idle, v).toBeLessThan(HEART_QUARTER_PALETTE.heat.idle / 2);
    // The cold quarters apart in hue too (violet against ice blue).
    expect(
      Math.abs(
        hsl(HEART_QUARTER_PALETTE.breath.color).h - hsl(HEART_QUARTER_PALETTE.quench.color).h,
      ) * 360,
    ).toBeGreaterThan(40);
  });

  it('keeps every quarter at its quiet tint asleep (one floor, never darkened)', () => {
    // Phase 2M: the element lives on the edges; a sleeping quarter's floor
    // keeps its stone (the 2L shades dimmed it to a third).
    for (const v of SMITH_HEART_VEINS)
      expect(HEART_QUARTER_PALETTE[v].shade, v).toBeGreaterThanOrEqual(0.85);
  });

  it('draws the floors, then the spines with no depth write, so a telegraph always shows over one', () => {
    expect(HEART_PLATFORM_ORDER.floor).toBeLessThan(HEART_PLATFORM_ORDER.spine);
    expect(HEART_PLATFORM_ORDER.spine).toBeLessThan(HEART_PLATFORM_ORDER.spineGlow);
    // Everything else (bodies, telegraphs on the ladder) draws after them.
    expect(HEART_PLATFORM_ORDER.spineGlow).toBeLessThan(0);
    expect(floorVfxRenderOrder('ground', 0)).toBeGreaterThan(HEART_PLATFORM_ORDER.spineGlow);
    const spine = heartKitSlotMaterial('spine');
    expect(spine.depthWrite).toBe(false);
    expect(heartKitSlotMaterial('stone').depthWrite).toBe(true);
    const src = readFileSync('src/render/smith_heart/heart_quarters.ts', 'utf8');
    expect(src).toMatch(/heartKitSlotMaterial\('spine'\)/);
    expect(src).toMatch(/spineGlow\.depthWrite = false/);
    expect(src).toMatch(/renderOrder = HEART_PLATFORM_ORDER\.spine;/);
    expect(src).toMatch(/renderOrder = HEART_PLATFORM_ORDER\.floor;/);
    const kit = readFileSync('src/render/smith_heart/heart_room_kit.ts', 'utf8');
    expect(kit).toMatch(/Kit_AnvilFloor:[\s\S]*HEART_PLATFORM_ORDER\.floor/);
  });

  it('raises every element in layers, more of it than before, a share on the low tier', () => {
    const A = HEART_QUARTER_AIR;
    expect(A.hammer.grit + A.hammer.chips + A.hammer.dust + A.hammer.stones).toBeGreaterThan(300);
    expect(
      A.breath.devils * A.breath.perDevil + A.breath.streaks + A.breath.sheets,
    ).toBeGreaterThan(500);
    expect(A.quench.mist + A.quench.frost + A.quench.crystals).toBeGreaterThan(350);
    expect(A.heat.embers + A.heat.haze + A.heat.flames).toBeGreaterThan(350);
    const hi = buildHeartQuarters(false).group;
    const lo = buildHeartQuarters(true).group;
    const names = (g: THREE.Object3D) => {
      const out: string[] = [];
      g.traverse((o) => {
        if (o.name.startsWith('heartQuarter') || o.name.startsWith('heartRidge')) out.push(o.name);
      });
      return out.sort();
    };
    expect(names(lo)).toEqual(names(hi));
    for (const layer of [
      'heartQuarterChips:hammer',
      'heartQuarterDust:hammer',
      'heartQuarterSheets:breath',
      'heartQuarterFrost:quench',
      'heartQuarterFlames:heat',
      'heartRidgeDust:0',
    ])
      expect(names(hi), layer).toContain(layer);
  });
});

describe('the edges awake (phase 2M)', () => {
  const materialsOf = (g: THREE.Object3D) => {
    const out = new Map<string, THREE.ShaderMaterial>();
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m instanceof THREE.ShaderMaterial) out.set(m.name, m);
    });
    return out;
  };

  it('erupts a landmark as its flood reaches the wall, never before', () => {
    const s = newHeartQuartersState();
    const q = s.quarters.heat;
    expect(heartLandmarkLit(q)).toBe(0);
    q.awake = 1;
    q.front = HEART_QUARTERS.ringR + 2;
    expect(heartLandmarkLit(q)).toBe(0);
    q.front = HEART_QUARTERS.rimR - 7;
    const mid = heartLandmarkLit(q);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    q.front = HEART_QUARTERS.rimR;
    expect(heartLandmarkLit(q)).toBe(1);
    q.awake = 0;
    expect(heartLandmarkLit(q)).toBe(0);
  });

  it("lights the boss quarter's landmark, the others quiet, all four in the final look, dark with the heart", () => {
    const q = buildHeartQuarters(false);
    const mats = materialsOf(q.group);
    const lm = (v: string) => mats.get(`smithHeartLandmarkGlow:${v}`)?.uniforms;
    for (const v of SMITH_HEART_VEINS) expect(lm(v), v).toBeDefined();
    let t = 0;
    const frames = (n: number, dark: number) => {
      for (let i = 0; i < n; i++) {
        t += 1 / 60;
        q.update('slot', t, 1 / 60, dark);
      }
    };
    const s = heartQuarterSpot('quench');
    noteHeartQuarterBoss('slot', s.x, s.z, true, true);
    frames(240, 0);
    expect(lm('quench')?.uLit.value).toBe(1);
    for (const v of ['hammer', 'breath', 'heat']) {
      expect(lm(v)?.uLit.value, v).toBe(0);
      // Quiet, never dark: the room still reads as four.
      expect(lm(v)?.uQuiet.value, v).toBeGreaterThan(0.1);
    }
    // Its air wakes with it.
    expect(mats.get('smithHeartLandmarkRime')?.uniforms.uLit.value).toBe(1);
    expect(mats.get('smithHeartLandmarkEmbers')?.uniforms.uLit.value).toBe(0);
    // The final look: all four erupt.
    noteHeartQuarterBoss('slot', HEART_ROOM.x, HEART_ROOM.z, true, true, true);
    frames(300, 0);
    for (const v of SMITH_HEART_VEINS) expect(lm(v)?.uLit.value, v).toBe(1);
    expect(mats.get('smithHeartLandmarkBolts')?.uniforms.uLit.value).toBe(1);
    // The heart gone dark: all of it with it.
    frames(400, 1);
    for (const v of SMITH_HEART_VEINS) {
      expect(lm(v)?.uLit.value, v).toBe(0);
      expect(lm(v)?.uQuiet.value, v).toBe(0);
    }
  });

  it('draws the circle: its rim as a spine (no depth write), its well a floor through modelViewMatrix', () => {
    const mats = materialsOf(buildHeartQuarters(false).group);
    const well = mats.get('smithHeartWell');
    expect(well).toBeDefined();
    expect(well?.vertexShader).toMatch(/modelViewMatrix/);
    expect(well?.vertexShader).not.toMatch(/viewMatrix\s*\*\s*(modelMatrix|vec4)/);
    expect(well?.transparent).toBe(false);
    expect(mats.get('smithHeartDaisGlow')?.depthWrite).toBe(false);
    const src = readFileSync('src/render/smith_heart/heart_quarters.ts', 'utf8');
    expect(src).toMatch(/Kit_HeartWell/);
    expect(src).toMatch(/daisGlow\.depthWrite = false/);
  });

  it("stands each landmark's spots in its own quarter, past the rim", () => {
    for (const v of SMITH_HEART_VEINS) {
      const spots = heartLandmarkSpots(v);
      expect(spots.length, v).toBeGreaterThan(2);
      for (const p of spots) {
        expect(heartQuarterAt(HEART_ROOM.x + p.x, HEART_ROOM.z + p.z), v).toBe(v);
        expect(Math.hypot(p.x, p.z), v).toBeGreaterThan(HEART_QUARTERS.rimR);
        expect(p.y, v).toBeGreaterThan(0);
      }
      // At its altar's bearing.
      const b = HEART_LANDMARK_FRAME.bearing[v];
      const c = spots[0];
      const got = ((Math.atan2(c.x, c.z) * 180) / Math.PI + 360) % 360;
      expect(Math.abs(((got - b + 540) % 360) - 180), v).toBeLessThan(8);
    }
  });

  it("runs the Breath's lightning from its horns' tips, the same every time", () => {
    const tips = heartBreathHornTips();
    const bolts = heartBreathBolts();
    expect(bolts.length).toBeGreaterThan(5);
    for (const b of bolts) {
      const first = b.points[0];
      expect(tips.some((t) => Math.hypot(t.x - first.x, t.y - first.y, t.z - first.z) < 1e-9)).toBe(
        true,
      );
      expect(b.points.length).toBeGreaterThan(8);
    }
    expect(heartBreathBolts()).toEqual(bolts);
  });

  it("keeps a share of the landmarks' air on the low tier, the same lights", () => {
    const quads = (g: THREE.Object3D, name: string) => {
      let n = 0;
      g.traverse((o) => {
        if (o.name === name) n = ((o as THREE.Mesh).geometry.index?.count ?? 0) / 6;
      });
      return n;
    };
    const hi = buildHeartQuarters(false).group;
    const lo = buildHeartQuarters(true).group;
    expect(quads(lo, 'heartLandmarkEmbers:heat')).toBeLessThan(
      quads(hi, 'heartLandmarkEmbers:heat'),
    );
    expect(quads(lo, 'heartLandmarkEmbers:heat')).toBeGreaterThan(0);
    // The bolts and the halos (which quarter is awake) are never shed.
    expect(quads(lo, 'heartLandmarkBolts:breath')).toBe(quads(hi, 'heartLandmarkBolts:breath'));
    expect(quads(lo, 'heartLandmarkHalo:heat')).toBe(quads(hi, 'heartLandmarkHalo:heat'));
  });
});
