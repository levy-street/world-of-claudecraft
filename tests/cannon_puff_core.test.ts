import { describe, expect, it } from 'vitest';
import {
  CANNON_BLAST_FIXED_PUFFS,
  CANNON_DUST_PUFFS,
  CANNON_FIREBALL_PUFFS,
  CANNON_MUZZLE_FIXED_PUFFS,
  CANNON_PUFF_KINDS,
  CANNON_PUFF_LIGHT,
  CANNON_PUFF_SPRITE,
  CANNON_PUFF_SPRITE_RADIUS,
  CANNON_PUFF_STYLES,
  CANNON_SHOCK_PUFFS,
  CANNON_SMOKE_OCCLUSION_MAX,
  CANNON_SMOKE_PUFFS,
  CANNON_TRAIL,
  type CannonPuff,
  cannonBlastPower,
  cannonBlastPuffs,
  cannonMuzzlePuffs,
  cannonPuffAtlasTexels,
  cannonPuffInto,
  cannonPuffLightInto,
  cannonShellGlowInto,
  cannonTierAlpha,
  cannonTrailPuffInto,
  newCannonPuff,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import {
  CANNON_BLAST,
  CANNON_MUZZLE,
  CannonShotTimeline,
  cannonShotCounts,
} from '../src/render/cannon_shell_core';
import {
  occlusionTargets,
  smokeOcclusionPeak,
  TURRET_CAMERA_EYE,
} from './helpers/cannon_smoke_occlusion';

const flat = () => 0;
const pool = (n: number): CannonPuff[] => Array.from({ length: n }, newCannonPuff);
const full = { dust: CANNON_DUST_PUFFS, dirt: 24, sparks: 16, smoke: 0 };
const low = { dust: 4, dirt: 8, sparks: 5, smoke: 0 };

/** A 32-bit FNV-1a of the bytes: pins a texel builder's exact output. */
function fnv(bytes: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return (h >>> 0).toString(16);
}

function kinds(puffs: CannonPuff[], n: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < n; i++) out[puffs[i].kind] = (out[puffs[i].kind] ?? 0) + 1;
  return out;
}

/** The largest a puff grows and the longest it shows, from its launch record. */
function peak(p: CannonPuff): { size: number; until: number } {
  return { size: Math.max(p.size0, p.size1), until: p.delay + p.life };
}

describe('cannon puff styles', () => {
  it('has one style per kind, warm light for fire and dull earth for dust', () => {
    expect(CANNON_PUFF_STYLES).toHaveLength(CANNON_PUFF_KINDS);
    const hot = CANNON_PUFF_STYLES[PUFF.fireball].rgb;
    // A fireball starts hot and bright (light above 1) and red over blue: never a cool cyan.
    expect(hot[0]).toBeGreaterThan(1);
    expect(hot[0]).toBeGreaterThan(hot[2] * 2);
    for (const kind of [PUFF.dust, PUFF.shock, PUFF.smoke, PUFF.trailSmoke, PUFF.dirt]) {
      const rgb = CANNON_PUFF_STYLES[kind].rgb;
      for (let i = 0; i < 9; i++) expect(rgb[i]).toBeLessThanOrEqual(1);
      // Earthy: red at least as strong as blue at every stop.
      for (let s = 0; s < 3; s++) expect(rgb[s * 3]).toBeGreaterThanOrEqual(rgb[s * 3 + 2]);
    }
  });
});

describe('cannon puff flight', () => {
  it('shows only between its delay and the end of its life, and fades out', () => {
    const p = newCannonPuff();
    Object.assign(p, { kind: PUFF.dust, size0: 2, size1: 6, life: 1.5, delay: 0.1 });
    const f = newCannonPuffFrame();
    expect(cannonPuffInto(p, 0.05, f)).toBe(false);
    expect(cannonPuffInto(p, 0.1, f)).toBe(true);
    expect(f.size).toBeCloseTo(2, 9);
    expect(cannonPuffInto(p, 0.4, f)).toBe(true);
    const early = f.a;
    expect(early).toBeGreaterThan(0.8 * CANNON_PUFF_STYLES[PUFF.dust].alpha);
    cannonPuffInto(p, 1.55, f);
    expect(f.a).toBeLessThan(early * 0.2);
    expect(f.size).toBeGreaterThan(5.5);
    expect(cannonPuffInto(p, 1.6, f)).toBe(false);
  });

  it('flies a damped arc in closed form and rests on its floor', () => {
    const p = newCannonPuff();
    Object.assign(p, {
      kind: PUFF.dirt,
      vx: 4,
      vy: 12,
      gravity: 26,
      size0: 0.5,
      size1: 0.4,
      life: 1.4,
      floorY: 0.1,
    });
    const f = newCannonPuffFrame();
    cannonPuffInto(p, 12 / 26, f);
    expect(f.y).toBeCloseTo((12 * 12) / (2 * 26), 6);
    expect(f.x).toBeCloseTo(4 * (12 / 26), 6);
    cannonPuffInto(p, 1.2, f);
    expect(f.y).toBe(0.1);
    const d = newCannonPuff();
    Object.assign(d, { kind: PUFF.smoke, vx: 6, drag: 2, life: 5, size0: 1, size1: 1 });
    cannonPuffInto(d, 4.9, f);
    // Damped: it drifts to a stop near v0 / drag, never past it.
    expect(f.x).toBeLessThan(3);
    expect(f.x).toBeGreaterThan(2.9);
  });

  it('cools a fireball from self-lit additive fire into lit, alpha-blended smoke', () => {
    const p = newCannonPuff();
    Object.assign(p, { kind: PUFF.fireball, size0: 1, size1: 3, life: 1 });
    const f = newCannonPuffFrame();
    cannonPuffInto(p, 0.02, f);
    expect(f.add).toBeGreaterThan(0.2);
    expect(f.glow).toBe(1);
    const hot = f.r;
    cannonPuffInto(p, 0.9, f);
    expect(f.add).toBe(0);
    expect(f.glow).toBe(0);
    expect(f.r).toBeLessThan(hot / 10);
    for (const kind of [PUFF.dust, PUFF.smoke, PUFF.dirt]) {
      Object.assign(p, { kind });
      cannonPuffInto(p, 0.5, f);
      expect(f.add).toBe(0);
      expect(f.glow).toBe(0);
    }
    // The ground ring rolls out lit by the flash, then settles as plain dust.
    Object.assign(p, { kind: PUFF.shock });
    cannonPuffInto(p, 0.05, f);
    expect(f.add).toBeGreaterThan(0.5);
    cannonPuffInto(p, 0.7, f);
    expect(f.add).toBe(0);
    expect(f.glow).toBe(0);
    for (const kind of [PUFF.flash, PUFF.flame, PUFF.spark, PUFF.trailSpark]) {
      Object.assign(p, { kind });
      cannonPuffInto(p, 0.05, f);
      expect(f.add).toBe(1);
      expect(f.glow).toBe(1);
      // Light pops at full on the very frame that consumed its event.
      cannonPuffInto(p, 0, f);
      expect(f.a).toBe(CANNON_PUFF_STYLES[kind].alpha);
    }
  });
});

describe('cannon blast puffs', () => {
  it('launches the flash, fireball and shock ring on every tier and sheds only the rest', () => {
    const high = pool(200);
    const lower = pool(200);
    const n = cannonBlastPuffs(high, 5, 10, 1, 10, 6, 1, full, flat, 0);
    const m = cannonBlastPuffs(lower, 5, 10, 1, 10, 6, 1, low, flat, 0);
    expect(n).toBe(CANNON_BLAST_FIXED_PUFFS + full.dust + full.dirt + full.sparks);
    expect(m).toBe(CANNON_BLAST_FIXED_PUFFS + low.dust + low.dirt + low.sparks);
    expect(kinds(high, n)).toEqual({
      [PUFF.flash]: 1,
      [PUFF.fireball]: CANNON_FIREBALL_PUFFS,
      [PUFF.shock]: CANNON_SHOCK_PUFFS,
      [PUFF.dust]: full.dust,
      [PUFF.dirt]: full.dirt,
      [PUFF.spark]: full.sparks,
    });
    // The every-tier pieces are identical puff for puff.
    expect(lower.slice(0, CANNON_BLAST_FIXED_PUFFS)).toEqual(
      high.slice(0, CANNON_BLAST_FIXED_PUFFS),
    );
  });

  it('is sized to read from the turret: a dust cloud yards across that lingers', () => {
    // The shared Vfx sprites are 0.3 to 0.7 yd and live under a second, which is
    // 5 to 10 px at the 35 to 40 yd a blast sits from the camera: the blast's
    // own puffs must stay big and long enough to be seen at all.
    const puffs = pool(200);
    const n = cannonBlastPuffs(puffs, 9, 0, 0, 0, 6, 1, full, flat, 0);
    const of = (kind: number) => puffs.slice(0, n).filter((p) => p.kind === kind);
    for (const dust of of(PUFF.dust)) {
      expect(peak(dust).size).toBeGreaterThanOrEqual(5);
      expect(peak(dust).until).toBeGreaterThanOrEqual(1.4);
      // Its slot outlives it, so the cloud is never cut off mid-fade.
      expect(peak(dust).until).toBeLessThanOrEqual(CANNON_BLAST.life);
    }
    for (const fire of of(PUFF.fireball)) expect(peak(fire).size).toBeGreaterThanOrEqual(3);
    expect(peak(of(PUFF.flash)[0]).size).toBeGreaterThanOrEqual(4);
    // The dirt is thrown 3 to 5 yd up.
    const apex = of(PUFF.dirt).map((p) => (p.vy * p.vy) / (2 * p.gravity));
    expect(Math.min(...apex)).toBeGreaterThan(1.5);
    expect(Math.max(...apex)).toBeGreaterThan(3.5);
    expect(Math.max(...apex)).toBeLessThan(5.5);
  });

  it('rolls the shock ring out along the ground to the blast radius, all around', () => {
    const puffs = pool(200);
    const ground = (x: number) => 0.1 * x;
    const n = cannonBlastPuffs(puffs, 3, 0, 0, 0, 6, 1, full, ground, 0);
    const ring = puffs.slice(0, n).filter((p) => p.kind === PUFF.shock);
    const f = newCannonPuffFrame();
    const bearings = new Set<number>();
    for (const p of ring) {
      expect(p.y).toBeLessThan(1.5);
      cannonPuffInto(p, p.life * 0.95, f);
      const reach = Math.hypot(f.x, f.z);
      expect(reach).toBeGreaterThan(6 * 0.85);
      expect(reach).toBeLessThan(6 * 1.3);
      bearings.add(Math.floor((Math.atan2(f.x, f.z) + Math.PI) / (Math.PI / 2)));
    }
    expect(bearings.size).toBe(4);
  });

  it('reads bigger for a core hit, and is deterministic', () => {
    expect(cannonBlastPower(undefined)).toBe(1);
    expect(cannonBlastPower([])).toBe(1);
    expect(cannonBlastPower([{ falloff: 0.2 }, { falloff: 1 }])).toBeCloseTo(1.3, 9);
    const a = pool(200);
    const b = pool(200);
    const core = pool(200);
    cannonBlastPuffs(a, 7, 1, 2, 3, 6, 1, full, flat, 0);
    cannonBlastPuffs(b, 7, 1, 2, 3, 6, 1, full, flat, 0);
    cannonBlastPuffs(core, 7, 1, 2, 3, 6, 1.3, full, flat, 0);
    expect(a).toEqual(b);
    expect(core[0].size1).toBeCloseTo(a[0].size1 * 1.3, 9);
  });
});

describe('cannon muzzle and wake puffs', () => {
  it('flashes at the tip, throws its flame and smoke along the barrel, and sheds only smoke', () => {
    const puffs = pool(20);
    const n = cannonMuzzlePuffs(puffs, 4, 0, 2, 0, 1, 0, 0, 6);
    expect(n).toBe(CANNON_MUZZLE_FIXED_PUFFS + 6);
    const few = pool(20);
    expect(cannonMuzzlePuffs(few, 4, 0, 2, 0, 1, 0, 0, 2)).toBe(CANNON_MUZZLE_FIXED_PUFFS + 2);
    expect(few.slice(0, CANNON_MUZZLE_FIXED_PUFFS)).toEqual(
      puffs.slice(0, CANNON_MUZZLE_FIXED_PUFFS),
    );
    expect(kinds(puffs, n)).toEqual({ [PUFF.flash]: 1, [PUFF.flame]: 3, [PUFF.smoke]: 6 });
    const f = newCannonPuffFrame();
    for (let i = 0; i < n; i++) {
      const p = puffs[i];
      expect(p.x).toBeGreaterThan(0);
      if (p.kind === PUFF.flash) expect(p.life).toBeLessThanOrEqual(0.1);
      if (p.kind === PUFF.smoke) {
        // A grey-brown puff that drifts on and fades over about a second.
        expect(p.delay + p.life).toBeGreaterThan(0.9);
        expect(p.delay + p.life).toBeLessThanOrEqual(CANNON_MUZZLE.life);
        expect(cannonPuffInto(p, p.delay + 0.3, f)).toBe(true);
        expect(f.x).toBeGreaterThan(p.x);
        expect(f.y).toBeGreaterThan(p.y);
      }
    }
  });

  it('drops a grey smoke wake and warm sparks, never a cool mote', () => {
    const p = newCannonPuff();
    const f = newCannonPuffFrame();
    cannonTrailPuffInto(p, 3, 4, false, 1, 2, 3);
    expect(p.kind).toBe(PUFF.trailSmoke);
    expect(p.life).toBe(CANNON_TRAIL.smokeLife);
    cannonPuffInto(p, 0.1, f);
    expect(f.add).toBe(0);
    cannonTrailPuffInto(p, 3, 5, true, 1, 2, 3);
    expect(p.kind).toBe(PUFF.trailSpark);
    cannonPuffInto(p, 0.02, f);
    expect(f.r).toBeGreaterThan(f.b * 3);
    cannonShellGlowInto(1, 2, 3, 0.2, f);
    expect([f.x, f.y, f.z]).toEqual([1, 2, 3]);
    expect(f.add).toBe(1);
    expect(f.r).toBeGreaterThan(f.b * 3);
  });
});

describe('cannon puff light', () => {
  const sky = { r: 0.97, g: 0.65, b: 0.41 };
  const soil = { r: 0.11, g: 0.06, b: 0.035 };
  const amber = { r: 0.97, g: 0.25, b: 0.16 };

  it('darkens with the night, keeps a floor, and washes most of an amber tint out', () => {
    const dusk = { r: 0, g: 0, b: 0 };
    const night = { r: 0, g: 0, b: 0 };
    cannonPuffLightInto(sky, soil, 0.2, amber, 2.1, dusk);
    cannonPuffLightInto(sky, soil, 0.11, amber, 0.2, night);
    const lum = (c: { r: number; g: number; b: number }) =>
      0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum(night)).toBeLessThan(lum(dusk));
    expect(lum(night)).toBeGreaterThanOrEqual(CANNON_PUFF_LIGHT.floor - 1e-9);
    // The raw light is four times redder than green; the puff keeps well under that.
    expect(dusk.r / dusk.g).toBeLessThan(2);
    const dark = { r: 0, g: 0, b: 0 };
    cannonPuffLightInto(sky, soil, 0, amber, 0, dark);
    expect(dark).toEqual({
      r: CANNON_PUFF_LIGHT.floor,
      g: CANNON_PUFF_LIGHT.floor,
      b: CANNON_PUFF_LIGHT.floor,
    });
  });
});

describe('cannon puff atlas', () => {
  it('draws four sprites, each inside its own cell and clear at the cell edge', () => {
    const cell = 32;
    const data = cannonPuffAtlasTexels(cell);
    expect(data).toHaveLength(cell * 2 * cell * 2 * 4);
    const alpha = (sprite: number, i: number, j: number) => {
      const cx = sprite % 2;
      const cy = Math.floor(sprite / 2);
      return data[((cy * cell + j) * cell * 2 + cx * cell + i) * 4 + 3];
    };
    for (const sprite of Object.values(CANNON_PUFF_SPRITE)) {
      expect(alpha(sprite, cell / 2, cell / 2)).toBeGreaterThan(150);
      for (let k = 0; k < cell; k++) {
        expect(alpha(sprite, 0, k)).toBe(0);
        expect(alpha(sprite, k, cell - 1)).toBe(0);
      }
    }
    expect(cannonPuffAtlasTexels(cell)).toEqual(data);
  });

  it('keeps every sprite clear past its radius, so the octagon billboards clip nothing', () => {
    const cell = 64;
    const data = cannonPuffAtlasTexels(cell);
    for (const sprite of Object.values(CANNON_PUFF_SPRITE)) {
      const cx = sprite % 2;
      const cy = Math.floor(sprite / 2);
      for (let j = 0; j < cell; j++) {
        for (let i = 0; i < cell; i++) {
          const r = Math.hypot(((i + 0.5) / cell) * 2 - 1, ((j + 0.5) / cell) * 2 - 1);
          if (r < CANNON_PUFF_SPRITE_RADIUS) continue;
          expect(data[((cy * cell + j) * cell * 2 + cx * cell + i) * 4 + 3]).toBe(0);
        }
      }
    }
  });

  it('keeps the exact sprites it drew before its noise was precomputed per octave', () => {
    // The value noise reads every lattice corner from a table hashed once per
    // octave (no hash and no closure per sample) in the same blend order, so
    // the atlas is byte for byte what the per-sample hashing drew. Re-pin only
    // on a deliberate retune of the sprites.
    expect(fnv(cannonPuffAtlasTexels(64))).toBe('aba7c2e0');
  });
});

describe('cannon smoke fairness', () => {
  // A monster and its health bar always read through the smoke (the
  // fairness rule: enemy positions are actionable). The worst the smoke of one
  // source hides from the turret camera is capped on every preset, and the
  // high preset, which draws more puffs, never hides more than the low one.
  const blastWorst = (low: boolean): number => {
    const counts = cannonShotCounts(low);
    const puffs = pool(200);
    let worst = 0;
    for (const seed of [3, 7, 19]) {
      for (const power of [1, 1.3]) {
        for (const d of [10, 35]) {
          const n = cannonBlastPuffs(
            puffs,
            seed,
            0,
            0,
            d,
            6,
            power,
            { ...counts, smoke: 0 },
            flat,
            0,
          );
          const peak = smokeOcclusionPeak(puffs, n, TURRET_CAMERA_EYE, occlusionTargets(0, d), 2.1);
          worst = Math.max(worst, peak);
        }
      }
    }
    return worst;
  };

  it('never lets a blast hide more than the cap of a monster behind it, on high or on low', () => {
    const high = blastWorst(false);
    const lowest = blastWorst(true);
    expect(high).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(lowest).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(high).toBeLessThanOrEqual(lowest);
    // Measured, not vacuous: a blast still reads as a dirty cloud.
    expect(high).toBeGreaterThan(0.25);
  });

  it("caps the muzzle smoke over the monsters at the tank and the shell's wake over its target", () => {
    const front = occlusionTargets(0, 8);
    const muzzle = (smoke: number) => {
      const puffs = pool(20);
      const n = cannonMuzzlePuffs(puffs, 5, 0, 2.2, 2, 0, 0, 1, smoke);
      return smokeOcclusionPeak(puffs, n, TURRET_CAMERA_EYE, front, CANNON_MUZZLE.life);
    };
    const high = muzzle(cannonShotCounts(false).smoke);
    const lowest = muzzle(cannonShotCounts(true).smoke);
    expect(high).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(lowest).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(high).toBeLessThanOrEqual(lowest + 1e-9);
    // The wake, seen nearly end-on down the shot line, frozen at every half tick of its life.
    const timeline = new CannonShotTimeline();
    timeline.fired(
      { shotId: 4, x: 0, y: 0, z: 20, flightTicks: 12, impactTick: 112 },
      { x: 0, y: 2.2, z: 2 },
      { x: 0, y: 0, z: 1 },
      0,
      0,
    );
    const wake = pool(80);
    const ages = new Float32Array(80);
    let worst = 0;
    for (let tick = 100; tick <= 125; tick += 0.5) {
      const n = timeline.trailPuffsInto(0, tick, wake, ages);
      for (let i = 0; i < n; i++) wake[i].delay -= ages[i];
      worst = Math.max(
        worst,
        smokeOcclusionPeak(wake, n, TURRET_CAMERA_EYE, occlusionTargets(0, 20), 0),
      );
    }
    expect(worst).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
  });

  it('makes each puff a low preset keeps denser, so where they overlap they stack like the full set', () => {
    for (const alpha of [0.044, 0.07, 0.3]) {
      const factor = cannonTierAlpha(alpha, 8, 4);
      expect(factor).toBeGreaterThan(1);
      expect(1 - (1 - alpha * factor) ** 4).toBeCloseTo(1 - (1 - alpha) ** 8, 12);
      expect(cannonTierAlpha(alpha, 8, 8)).toBe(1);
    }
    const dust = CANNON_PUFF_STYLES[PUFF.dust].alpha;
    const kept = (counts: typeof full) => {
      const puffs = pool(200);
      const n = cannonBlastPuffs(puffs, 5, 0, 0, 10, 6, 1, counts, flat, 0);
      return puffs.slice(0, n);
    };
    const on = (puffs: CannonPuff[], kind: number) => puffs.filter((p) => p.kind === kind);
    for (const p of on(kept(full), PUFF.dust)) expect(p.alpha).toBe(1);
    for (const p of on(kept(low), PUFF.dust)) {
      expect(p.alpha).toBeCloseTo(cannonTierAlpha(dust, CANNON_DUST_PUFFS, low.dust), 12);
    }
    // The every-tier puffs carry no tier factor at all.
    for (const kind of [PUFF.flash, PUFF.fireball, PUFF.shock]) {
      for (const p of on(kept(low), kind)) expect(p.alpha).toBe(1);
    }
    const smoke = pool(20);
    const n = cannonMuzzlePuffs(smoke, 4, 0, 2, 0, 1, 0, 0, 2);
    const factor = cannonTierAlpha(CANNON_PUFF_STYLES[PUFF.smoke].alpha, CANNON_SMOKE_PUFFS, 2);
    for (const p of smoke.slice(0, n).filter((q) => q.kind === PUFF.smoke)) {
      expect(p.alpha).toBeCloseTo(factor, 12);
    }
  });
});
