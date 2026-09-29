import { describe, expect, it } from 'vitest';
import {
  CANNON_SMOKE_OCCLUSION_MAX,
  type CannonPuff,
  cannonBlastPower,
  cannonBlastPuffs,
  cannonPuffInto,
  newCannonPuff,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import { cannonShotCounts } from '../src/render/cannon_shell_core';
import {
  newTurretBarrelFuseFrame,
  newTurretShard,
  TURRET_BARREL_FIRE_PUFFS,
  TURRET_BARREL_FIREBALLS,
  TURRET_BARREL_FLAMES,
  TURRET_BARREL_LOOK,
  TURRET_BARREL_SHARDS,
  TURRET_FUSE_FIXED_PUFFS,
  TURRET_FUSE_PUFFS,
  type TurretShardFrame,
  turretBarrelCounts,
  turretBarrelFireInto,
  turretBarrelFirePuffs,
  turretBarrelFuseInto,
  turretBarrelPop,
  turretBarrelRingRadius,
  turretFuseSparksInto,
  turretPuffsEnd,
  turretShardInto,
  turretShardLaunch,
} from '../src/render/turret_barrel_core';
import { TURRET_CONTACT_PUFFS } from '../src/render/turret_contact_dust_core';
import { TURRET_EXPLOSIVE_BARREL } from '../src/sim/content/turret_defense';
import {
  occlusionTargets,
  smokeOcclusionPeak,
  TURRET_CAMERA_EYE,
} from './helpers/cannon_smoke_occlusion';

const pool = (n: number): CannonPuff[] => Array.from({ length: n }, newCannonPuff);
const flat = () => 0;
const FUSE = TURRET_EXPLOSIVE_BARREL.fuseTicks / 20;

describe('a standing barrel', () => {
  it('pops up to its size with a little overshoot, then holds', () => {
    expect(turretBarrelPop(0)).toBe(0);
    expect(turretBarrelPop(-1)).toBe(0);
    const samples = Array.from({ length: 36 }, (_, i) =>
      turretBarrelPop((i + 1) * (TURRET_BARREL_LOOK.popSeconds / 36)),
    );
    expect(Math.max(...samples)).toBeGreaterThan(1.02);
    expect(Math.max(...samples)).toBeLessThan(1.15);
    expect(samples[0]).toBeGreaterThan(0);
    expect(turretBarrelPop(TURRET_BARREL_LOOK.popSeconds)).toBe(1);
    expect(turretBarrelPop(10)).toBe(1);
  });

  it('breathes its warning ring gently while unlit and throbs it wide once lit', () => {
    const { ringRadius, ringPulse, litRingPulse } = TURRET_BARREL_LOOK;
    let lo = Number.POSITIVE_INFINITY;
    let hi = 0;
    let litHi = 0;
    for (let t = 0; t < 3; t += 0.01) {
      const r = turretBarrelRingRadius(t, null, 5);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
      const lit = turretBarrelRingRadius(t, t * 0.1, 5);
      expect(lit).toBeGreaterThanOrEqual(ringRadius - 1e-9);
      litHi = Math.max(litHi, lit);
    }
    expect(lo).toBeGreaterThanOrEqual(ringRadius * (1 - ringPulse) - 1e-9);
    expect(hi).toBeLessThanOrEqual(ringRadius * (1 + ringPulse) + 1e-9);
    expect(litHi).toBeCloseTo(ringRadius * (1 + litRingPulse), 3);
    // Readable at the clearing's far side: never smaller than the drum it sits under.
    expect(lo * TURRET_BARREL_LOOK.ringInner).toBeGreaterThan(TURRET_EXPLOSIVE_BARREL.radius);
  });

  it('rattles harder and swells as its fuse burns down, the same way every time', () => {
    const f = newTurretBarrelFuseFrame();
    const { shakeOffset, shakeTilt, swell } = TURRET_BARREL_LOOK;
    let early = 0;
    let late = 0;
    for (let i = 0; i <= 50; i++) {
      const age = (i / 50) * FUSE;
      turretBarrelFuseInto(f, age, FUSE, 7);
      expect(Math.abs(f.dx)).toBeLessThanOrEqual(shakeOffset + 1e-12);
      expect(Math.abs(f.dz)).toBeLessThanOrEqual(shakeOffset + 1e-12);
      expect(Math.abs(f.tiltX)).toBeLessThanOrEqual(shakeTilt + 1e-12);
      expect(Math.abs(f.tiltZ)).toBeLessThanOrEqual(shakeTilt + 1e-12);
      const size = Math.hypot(f.dx, f.dz);
      if (i < 10) early = Math.max(early, size);
      if (i > 40) late = Math.max(late, size);
    }
    expect(late).toBeGreaterThan(early);
    expect(turretBarrelFuseInto(f, 0, FUSE, 7).swell).toBe(1);
    expect(turretBarrelFuseInto(f, FUSE, FUSE, 7).swell).toBeCloseTo(1 + swell, 12);
    const a = { ...turretBarrelFuseInto(f, 0.1, FUSE, 7) };
    expect(turretBarrelFuseInto(newTurretBarrelFuseFrame(), 0.1, FUSE, 7)).toEqual(a);
    expect(turretBarrelFuseInto(newTurretBarrelFuseFrame(), 0.1, FUSE, 8)).not.toEqual(a);
  });
});

describe('the fuse', () => {
  it('glows over the bung for the whole fuse and sprays its sparks across it, onto the ground', () => {
    const out = pool(TURRET_CONTACT_PUFFS);
    expect(TURRET_FUSE_PUFFS).toBeLessThanOrEqual(TURRET_CONTACT_PUFFS);
    const sparks = turretBarrelCounts(false).fuseSparks;
    const n = turretFuseSparksInto(out, 3, 10, 1.3 + 2, 20, 2, FUSE, sparks);
    expect(n).toBe(TURRET_FUSE_FIXED_PUFFS + sparks);
    expect(out[0]).toMatchObject({ kind: PUFF.glow, x: 10, z: 20 });
    expect(out[0].life).toBeGreaterThanOrEqual(FUSE);
    expect(out.slice(1, 3).every((p) => p.kind === PUFF.flame)).toBe(true);
    const sprayed = out.slice(TURRET_FUSE_FIXED_PUFFS, n);
    expect(sprayed.every((p) => p.kind === PUFF.spark && p.vy > 0 && p.floorY === 2.05)).toBe(true);
    const delays = sprayed.map((p) => p.delay);
    expect(Math.min(...delays)).toBe(0);
    expect(Math.max(...delays)).toBeLessThan(FUSE);
    expect(turretPuffsEnd(out, n)).toBeGreaterThanOrEqual(FUSE);
    // The low preset keeps the glow and the licks and sheds sparks only.
    const lowN = turretFuseSparksInto(
      out,
      3,
      10,
      3.3,
      20,
      2,
      FUSE,
      turretBarrelCounts(true).fuseSparks,
    );
    expect(lowN).toBe(TURRET_FUSE_FIXED_PUFFS + turretBarrelCounts(true).fuseSparks);
    expect(lowN).toBeLessThan(n);
  });
});

describe('the blast', () => {
  const embers = turretBarrelCounts(false).embers;

  function column(seed = 9, per = TURRET_CONTACT_PUFFS): CannonPuff[] {
    const out: CannonPuff[] = [];
    const total = turretBarrelFirePuffs(embers);
    for (let first = 0; first < total; first += per) {
      const burst = pool(per);
      const n = turretBarrelFireInto(burst, first, total - first, seed, 0, 0, 30, 0, embers);
      out.push(...burst.slice(0, n));
    }
    return out;
  }

  it('fills its fire column across bursts as one recipe, whatever the burst size', () => {
    const whole = pool(64);
    const total = turretBarrelFirePuffs(embers);
    expect(total).toBe(TURRET_BARREL_FIRE_PUFFS);
    expect(turretBarrelFireInto(whole, 0, 64, 9, 0, 0, 30, 0, embers)).toBe(total);
    expect(column(9, TURRET_CONTACT_PUFFS)).toEqual(whole.slice(0, total));
    expect(column(9, 7)).toEqual(whole.slice(0, total));
    expect(turretBarrelFireInto(pool(5), total, 5, 9, 0, 0, 30, 0, embers)).toBe(0);
    const count = (kind: number) => whole.slice(0, total).filter((p) => p.kind === kind).length;
    expect(count(PUFF.fireball)).toBe(TURRET_BARREL_FIREBALLS);
    expect(count(PUFF.flame)).toBe(TURRET_BARREL_FLAMES);
    expect(count(PUFF.spark)).toBe(embers);
    expect(turretBarrelFirePuffs(turretBarrelCounts(true).embers)).toBeLessThan(total);
  });

  it('rises in a tall column, well above a shell fireball', () => {
    const puffs = column();
    const f = newCannonPuffFrame();
    let top = 0;
    for (const p of puffs) {
      if (p.kind !== PUFF.fireball) continue;
      for (let t = 0; t < 2; t += 0.05) if (cannonPuffInto(p, t, f)) top = Math.max(top, f.y);
    }
    const shell = pool(80);
    const n = cannonBlastPuffs(
      shell,
      9,
      0,
      0,
      30,
      6,
      1.3,
      { dust: 8, dirt: 24, sparks: 16, smoke: 0 },
      flat,
      0,
    );
    let shellTop = 0;
    for (let i = 0; i < n; i++) {
      if (shell[i].kind !== PUFF.fireball) continue;
      for (let t = 0; t < 2; t += 0.05)
        if (cannonPuffInto(shell[i], t, f)) shellTop = Math.max(shellTop, f.y);
    }
    expect(top).toBeGreaterThan(5);
    expect(top).toBeGreaterThan(shellTop * 1.5);
  });

  it('never lets a barrel blast hide more than the cap of a monster behind it, on high or on low', () => {
    const worst = (low: boolean): number => {
      const counts = cannonShotCounts(low);
      const barrel = turretBarrelCounts(low);
      const puffs = pool(260);
      let peak = 0;
      for (const seed of [3, 7, 19]) {
        for (const hit of [0, 1]) {
          for (const d of [16, 30]) {
            const power = cannonBlastPower([{ falloff: hit }]) * TURRET_BARREL_LOOK.blastScale;
            const n = cannonBlastPuffs(
              puffs,
              -seed,
              0,
              0,
              d,
              TURRET_EXPLOSIVE_BARREL.blastRadius,
              power,
              { ...counts, smoke: 0 },
              flat,
              0,
            );
            const fire = pool(turretBarrelFirePuffs(barrel.embers));
            const k = turretBarrelFireInto(fire, 0, fire.length, seed, 0, 0, d, 0, barrel.embers);
            const all = [...puffs.slice(0, n), ...fire.slice(0, k)];
            const at = occlusionTargets(0, d);
            peak = Math.max(peak, smokeOcclusionPeak(all, all.length, TURRET_CAMERA_EYE, at, 2.2));
          }
        }
      }
      return peak;
    };
    const high = worst(false);
    const lowest = worst(true);
    expect(high).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    expect(lowest).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
  });
});

describe('the shards', () => {
  it('fly out all around and high, the lid highest, then land and lie on the floor', () => {
    const count = TURRET_BARREL_SHARDS.perBlast;
    const shards = Array.from({ length: count }, (_, i) =>
      turretShardLaunch(newTurretShard(), 4, i, count, 5, 1, 7, () => 1),
    );
    const bearings = shards.map((s) => Math.atan2(s.vx, s.vz));
    const sorted = [...bearings].sort((a, b) => a - b);
    expect(sorted[sorted.length - 1] - sorted[0]).toBeGreaterThan(Math.PI);
    expect(shards[0].lift).toBe(Math.max(...shards.map((s) => s.lift)));
    expect(shards[0].shade).toBe(0);
    const f: TurretShardFrame = { x: 0, y: 0, z: 0, angle: 0, scale: 0 };
    for (const s of shards) {
      expect(s.floorY).toBeCloseTo(1 + s.sy * 0.5, 12);
      expect(turretShardInto(s, s.landAt / 2, f)).toBe(true);
      expect(f.y).toBeGreaterThan(s.floorY);
      expect(turretShardInto(s, s.landAt + 0.3, f)).toBe(true);
      expect(f.y).toBe(s.floorY);
      const resting = f.angle;
      turretShardInto(s, s.landAt + 0.6, f);
      expect(f.angle).toBe(resting);
      expect(turretShardInto(s, TURRET_BARREL_SHARDS.life - 1e-3, f)).toBe(true);
      expect(f.scale).toBeLessThan(0.01);
      expect(turretShardInto(s, TURRET_BARREL_SHARDS.life, f)).toBe(false);
      expect(turretShardInto(s, -0.1, f)).toBe(false);
    }
    expect(turretShardLaunch(newTurretShard(), 4, 3, count, 5, 1, 7, () => 1)).toEqual(shards[3]);
  });
});
