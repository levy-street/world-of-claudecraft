import { describe, expect, it } from 'vitest';
import {
  CANNON_BLAST_FIXED_PUFFS,
  CANNON_FIREBALL_PUFFS,
  CANNON_MUZZLE_FIXED_PUFFS,
  CANNON_PUFF_KINDS,
  CANNON_PUFF_LIGHT,
  CANNON_PUFF_SPRITE,
  CANNON_PUFF_STYLES,
  CANNON_SHOCK_PUFFS,
  CANNON_TRAIL,
  type CannonPuff,
  cannonBlastPower,
  cannonBlastPuffs,
  cannonMuzzlePuffs,
  cannonPuffAtlasTexels,
  cannonPuffInto,
  cannonPuffLightInto,
  cannonShellGlowInto,
  cannonTrailPuffInto,
  newCannonPuff,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import { CANNON_BLAST, CANNON_MUZZLE } from '../src/render/cannon_shell_core';

const flat = () => 0;
const pool = (n: number): CannonPuff[] => Array.from({ length: n }, newCannonPuff);
const full = { dust: 12, dirt: 24, sparks: 16, smoke: 0 };
const low = { dust: 4, dirt: 8, sparks: 5, smoke: 0 };

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
    expect(early).toBeGreaterThan(0.3);
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
    for (const kind of [PUFF.dust, PUFF.shock, PUFF.smoke, PUFF.dirt]) {
      Object.assign(p, { kind });
      cannonPuffInto(p, 0.5, f);
      expect(f.add).toBe(0);
      expect(f.glow).toBe(0);
    }
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
    const n = cannonBlastPuffs(high, 5, 10, 1, 10, 6, 1, full, flat);
    const m = cannonBlastPuffs(lower, 5, 10, 1, 10, 6, 1, low, flat);
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
    const n = cannonBlastPuffs(puffs, 9, 0, 0, 0, 6, 1, full, flat);
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
    const n = cannonBlastPuffs(puffs, 3, 0, 0, 0, 6, 1, full, ground);
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
    cannonBlastPuffs(a, 7, 1, 2, 3, 6, 1, full, flat);
    cannonBlastPuffs(b, 7, 1, 2, 3, 6, 1, full, flat);
    cannonBlastPuffs(core, 7, 1, 2, 3, 6, 1.3, full, flat);
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
});
