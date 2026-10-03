// Fire and Fly placed kegs (src/sim/minigames/turret_rally_kegs.ts): a hunt wave lays its
// kegs at its own rallies, in front, beside, or on the advance axis at a set distance from
// the tower, by the barrels' own clear-spot rules and under the keg cap.
import { describe, expect, it } from 'vitest';
import { TURRET_MISSION_PACK } from '../src/sim/content/fire_and_fly_missions';
import { TURRET_EXPLOSIVE_BARREL, TURRET_RALLY } from '../src/sim/content/turret_defense';
import type { ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { openTurretRallies } from '../src/sim/minigames/turret_rally';
import { placeTurretRallyKegs, turretRallyKegSpot } from '../src/sim/minigames/turret_rally_kegs';

const flat: ThrowProbe = { ground: () => 0, water: () => null };

/** A spot in the rally's frame: along the axis toward the tower, and across it. */
function frame(rally: { x: number; z: number }, spot: { x: number; z: number }) {
  const d = Math.hypot(rally.x, rally.z);
  const ux = -rally.x / d;
  const uz = -rally.z / d;
  const dx = spot.x - rally.x;
  const dz = spot.z - rally.z;
  return { along: dx * ux + dz * uz, across: dx * -uz + dz * ux };
}

describe('a rally keg spot', () => {
  const rally = { x: 0, z: 30 };

  it('puts a front keg on the advance axis, tower-side of the rally, just off the axis', () => {
    for (const depth of [0, 0.5, 0.999]) {
      for (const side of [0.2, 0.8]) {
        const spot = turretRallyKegSpot({ placement: 'rally-front' }, rally, 0, 0, side, depth);
        const f = frame(rally, spot);
        expect(f.along).toBeGreaterThanOrEqual(TURRET_RALLY.frontMin - 1e-9);
        expect(f.along).toBeLessThanOrEqual(TURRET_RALLY.frontMax + 1e-9);
        expect(Math.abs(f.across)).toBeCloseTo(TURRET_RALLY.axisOffset, 9);
        expect(Math.sign(f.across)).toBe(side < 0.5 ? -1 : 1);
        expect(Math.hypot(spot.x, spot.z)).toBeLessThan(30);
      }
    }
    expect([TURRET_RALLY.frontMin, TURRET_RALLY.frontMax, TURRET_RALLY.axisOffset]).toEqual([
      5, 7, 1.5,
    ]);
  });

  it('puts a side keg beside the rally, and an axis keg at its distance from the tower', () => {
    const side = frame(
      rally,
      turretRallyKegSpot({ placement: 'rally-side' }, rally, 0, 0, 0.9, 0.3),
    );
    expect(side.along).toBeCloseTo(0, 9);
    expect(Math.abs(side.across)).toBeCloseTo(TURRET_RALLY.sideOffset, 9);
    const axis = turretRallyKegSpot({ placement: 'axis', fromTower: 14 }, rally, 0, 0, 0.1, 0.7);
    const f = frame(rally, axis);
    expect(f.along).toBeCloseTo(30 - 14, 9);
    expect(Math.abs(f.across)).toBeCloseTo(TURRET_RALLY.axisOffset, 9);
  });
});

describe("a hunt wave's kegs", () => {
  const plan = resolveTurretPlan(TURRET_MISSION_PACK);

  it('lays each pack its kegs at its own rally as the wave starts, none on the ring', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, 0);
      const events: TurretEvent[] = [];
      for (let t = 1; t <= 61; t++) events.push(...tickTurretDefense(state, t, flat));
      const placed = events.flatMap((e) => (e.type === 'barrelsPlaced' ? e.barrels : []));
      expect(placed).toHaveLength(1);
      const rally = state.rallies![0];
      const f = frame(rally, placed[0]);
      expect(f.along).toBeGreaterThanOrEqual(TURRET_RALLY.frontMin - 1e-9);
      expect(f.along).toBeLessThanOrEqual(TURRET_RALLY.frontMax + 1e-9);
      expect(Math.abs(f.across)).toBeCloseTo(TURRET_RALLY.axisOffset, 9);
    }
  });

  it('lays wave 5 a front keg per pack and an axis keg 14 yd out on the first, spaced and clear', () => {
    const wave = plan.waves[4];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, 0);
      state.wave = 4;
      const rallies = openTurretRallies(state, wave);
      const placed = placeTurretRallyKegs(state, wave, rallies, 0, flat);
      expect(placed).toHaveLength(3);
      const [front0, axis0, front1] = placed;
      expect(Math.hypot(axis0.x, axis0.z)).toBeCloseTo(Math.hypot(14, TURRET_RALLY.axisOffset), 9);
      expect(frame(rallies[0], front0).along).toBeGreaterThanOrEqual(TURRET_RALLY.frontMin - 1e-9);
      expect(frame(rallies[1], front1).along).toBeGreaterThanOrEqual(TURRET_RALLY.frontMin - 1e-9);
      for (const [i, a] of placed.entries())
        for (const b of placed.slice(i + 1))
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(
            TURRET_EXPLOSIVE_BARREL.minSpacing,
          );
      expect(state.barrels).toEqual(placed);
    }
  });

  it('stops at the keg cap, standing kegs included, and replays its spots from the seed', () => {
    const wave = plan.waves[4];
    const full = createTurretDefense(plan, { x: 0, z: 0 }, 3, 0);
    full.wave = 4;
    for (let i = 0; i < TURRET_EXPLOSIVE_BARREL.cap; i++)
      full.barrels.push({ id: 100 + i, x: 200 + 10 * i, y: 0, z: 200, litTick: -1, blowTick: -1 });
    expect(placeTurretRallyKegs(full, wave, openTurretRallies(full, wave), 0, flat)).toEqual([]);
    const a = createTurretDefense(plan, { x: 0, z: 0 }, 3, 0);
    const b = createTurretDefense(plan, { x: 0, z: 0 }, 3, 0);
    a.wave = b.wave = 4;
    expect(placeTurretRallyKegs(a, wave, openTurretRallies(a, wave), 0, flat)).toEqual(
      placeTurretRallyKegs(b, wave, openTurretRallies(b, wave), 0, flat),
    );
  });
});
