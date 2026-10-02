import { describe, expect, it } from 'vitest';
import {
  CANNON_AIRBURST_PUFFS,
  CANNON_BOMBLET,
  CannonBomblets,
  cannonAirburstCounts,
  cannonAirburstPuffs,
  cannonBombletBlastId,
  cannonBombletKey,
} from '../src/render/cannon_frag_core';
import {
  CANNON_SMOKE_OCCLUSION_MAX,
  type CannonPuff,
  cannonBlastPuffs,
  cannonPuffInto,
  newCannonPuff,
  newCannonPuffFrame,
  PUFF,
} from '../src/render/cannon_puff_core';
import { CANNON_BLAST, cannonShotCounts } from '../src/render/cannon_shell_core';
import { TURRET_FRAGMENTATION } from '../src/sim/content/turret_defense';
import { TURRET_BOMBLETS, turretFragBomblets } from '../src/sim/minigames/turret_fragmentation';
import { DT } from '../src/sim/types';
import {
  occlusionTargets,
  smokeOcclusionPeak,
  TURRET_CAMERA_EYE,
} from './helpers/cannon_smoke_occlusion';

const flat = () => 0;
const pool = (n: number): CannonPuff[] => Array.from({ length: n }, newCannonPuff);

function kinds(puffs: CannonPuff[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of puffs) out[p.kind] = (out[p.kind] ?? 0) + 1;
  return out;
}

describe('fragmentation shell airburst', () => {
  it('flashes on every tier, and sheds only its smoke and sparks on low', () => {
    const high = pool(CANNON_AIRBURST_PUFFS);
    const low = pool(CANNON_AIRBURST_PUFFS);
    const nh = cannonAirburstPuffs(high, 4, 1, 6, 2, cannonAirburstCounts(false));
    const nl = cannonAirburstPuffs(low, 4, 1, 6, 2, cannonAirburstCounts(true));
    expect(nh).toBe(CANNON_AIRBURST_PUFFS);
    expect(kinds(high.slice(0, nh))).toEqual({
      [PUFF.flash]: 1,
      [PUFF.smoke]: cannonAirburstCounts(false).smoke,
      [PUFF.spark]: cannonAirburstCounts(false).sparks,
    });
    expect(kinds(low.slice(0, nl))[PUFF.flash]).toBe(1);
    expect(nl).toBeLessThan(nh);
    // A ring of sparks flung out level from the burst, well over the ground.
    const f = newCannonPuffFrame();
    for (const p of high.slice(0, nh).filter((q) => q.kind === PUFF.spark)) {
      expect(cannonPuffInto(p, 0.1, f)).toBe(true);
      expect(Math.hypot(f.x - 1, f.z - 2)).toBeGreaterThan(0.4);
      expect(f.y).toBeGreaterThan(4);
    }
    expect(cannonAirburstPuffs(pool(30), 4, 1, 6, 2, cannonAirburstCounts(false))).toBe(nh);
  });
});

describe('fragmentation shell bomblets', () => {
  const burst = { x: 10, y: 4, z: 20 };
  const star = turretFragBomblets(10, 20, 0, 1, 100);

  function scattered(hold = 0): CannonBomblets {
    const bomblets = new CannonBomblets(TURRET_BOMBLETS, hold);
    for (const b of star) {
      bomblets.launch(cannonBombletKey(7, b.index), burst, { ...b, y: 0 }, 100, b.landTick);
    }
    return bomblets;
  }

  it('flies each from the burst to its point, landing on the tick the sim blasts it', () => {
    const bomblets = scattered();
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < star.length; i++) {
      expect(bomblets.at(i, 100, p)).toBe(true);
      expect(p).toEqual({ x: 10, y: 4, z: 20 });
      expect(bomblets.at(i, star[i].landTick, p)).toBe(true);
      expect(p.x).toBeCloseTo(star[i].x, 9);
      expect(p.z).toBeCloseTo(star[i].z, 9);
      expect(p.y).toBeCloseTo(0, 9);
      // Falling onto its point on the way, never under the ground.
      let last = Number.POSITIVE_INFINITY;
      for (let t = 100; t <= star[i].landTick; t += 0.25) {
        bomblets.at(i, t, p);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        if (t > (100 + star[i].landTick) / 2) {
          expect(p.y).toBeLessThanOrEqual(last + 1e-9);
          last = p.y;
        }
      }
    }
  });

  it('waits at its point for its blast up to the hold, and is gone once blasted', () => {
    const p = { x: 0, y: 0, z: 0 };
    const held = scattered(3);
    const land = star[2].landTick;
    expect(held.at(2, land + 3, p)).toBe(true);
    expect(held.at(2, land + 3.5, p)).toBe(false);
    const blasted = scattered(3);
    blasted.land(cannonBombletKey(7, star[2].index));
    expect(blasted.at(2, land - 1, p)).toBe(false);
    expect(blasted.at(1, land - 1, p)).toBe(true);
    blasted.clear();
    for (let i = 0; i < star.length; i++) expect(blasted.at(i, 101, p)).toBe(false);
  });

  it('trails a few spark motes where it was, never before it left', () => {
    const bomblets = scattered();
    const out = pool(8);
    const ages = new Float32Array(8);
    expect(bomblets.motesInto(1, 100, out, ages)).toBe(0);
    const n = bomblets.motesInto(1, star[1].landTick, out, ages);
    expect(n).toBe(CANNON_BOMBLET.motes);
    for (let k = 0; k < n; k++) {
      expect(out[k].kind).toBe(PUFF.trailSpark);
      expect(ages[k]).toBeCloseTo((k + 1) * CANNON_BOMBLET.moteSpacing, 6);
    }
  });

  it('keys every bomblet and blast apart from every shell, barrel and other bomblet', () => {
    const keys = new Set<number>();
    const ids = new Set<number>();
    for (let shot = 1; shot <= 50; shot++) {
      for (let i = 0; i < TURRET_BOMBLETS; i++) {
        keys.add(cannonBombletKey(shot, i));
        const id = cannonBombletBlastId(shot, i);
        // Shells fly on positive ids, barrels on minus their small ids, own launches on minus serials.
        expect(id).toBeLessThan(-1_000_000);
        ids.add(id);
      }
    }
    expect(keys.size).toBe(50 * TURRET_BOMBLETS);
    expect(ids.size).toBe(50 * TURRET_BOMBLETS);
    expect(keys.has(0)).toBe(false);
  });

  it('reuses its slots round robin', () => {
    const bomblets = new CannonBomblets(2);
    const at = { x: 0, y: 0, z: 0 };
    for (let k = 1; k <= 3; k++) bomblets.launch(k, at, at, 0, 5);
    expect(bomblets.flights.map((f) => f.key)).toEqual([3, 2]);
  });
});

describe('fragmentation shell smoke fairness', () => {
  // The whole frag burst is one source: the airburst and all six bomblet blasts,
  // each on the landing schedule the sim's star carries. Without a lingering
  // cloud of their own, six small blasts never stack past the cap; with the
  // shell's cloud each, they would.
  const whole = (low: boolean, cloud: boolean, d: number, hit: number): number => {
    const all: CannonPuff[] = [];
    const air = pool(CANNON_AIRBURST_PUFFS);
    const n = cannonAirburstPuffs(
      air,
      7,
      0,
      TURRET_FRAGMENTATION.burstHeight,
      d,
      cannonAirburstCounts(low),
    );
    all.push(...air.slice(0, n));
    const counts = cannonShotCounts(low);
    for (const b of turretFragBomblets(0, d, 0, 1, 0)) {
      const puffs = pool(100);
      const m = cannonBlastPuffs(
        puffs,
        cannonBombletBlastId(7, b.index),
        b.x,
        0,
        b.z,
        TURRET_FRAGMENTATION.blastRadius,
        CANNON_BOMBLET.blastScale * hit,
        { ...counts, dust: cloud ? counts.dust : 0, smoke: 0 },
        flat,
        0,
      );
      for (const p of puffs.slice(0, m)) {
        p.delay += b.landTick * DT;
        all.push(p);
      }
    }
    const life = (TURRET_FRAGMENTATION.outerDelayTicks + TURRET_BOMBLETS) * DT + CANNON_BLAST.life;
    return smokeOcclusionPeak(all, all.length, TURRET_CAMERA_EYE, occlusionTargets(0, d), life);
  };

  it('never lets a whole frag burst hide more than the cap, on high or on low', () => {
    let worst = 0;
    for (const low of [false, true]) {
      for (const d of [10, 35]) {
        for (const hit of [1, 1.3]) worst = Math.max(worst, whole(low, false, d, hit));
      }
    }
    expect(worst).toBeLessThanOrEqual(CANNON_SMOKE_OCCLUSION_MAX);
    // Measured, not vacuous: the bomblets still kick up a dirty ring each.
    expect(worst).toBeGreaterThan(0.2);
    // And the missing cloud is what keeps it there.
    expect(whole(false, true, 35, 1)).toBeGreaterThan(CANNON_SMOKE_OCCLUSION_MAX);
  });
});
