// Fire and Fly path kegs on a pack's route (src/sim/minigames/turret_rally_kegs.ts, laid by
// turret_keg_lots.ts): a pack's kegs stand at its own rally, on the advance path or at its
// rim, or on the advance axis at a set distance from the tower, by the barrels' own
// clear-spot rules and under the keg cap. No keg blast reaches a member standing at its
// rally, and none stands nearer the tower than the keg ring's inner edge.
import { describe, expect, it } from 'vitest';
import { TURRET_MISSION_PACK } from '../src/sim/content/fire_and_fly_missions';
import {
  TURRET_BARREL_RING,
  TURRET_EXPLOSIVE_BARREL,
  TURRET_RALLY,
} from '../src/sim/content/turret_defense';
import type { ThrowProbe } from '../src/sim/minigames/thrown_body';
import {
  createTurretDefense,
  type TurretEvent,
  tickTurretDefense,
} from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { placeTurretPathKegs } from '../src/sim/minigames/turret_keg_lots';
import {
  openTurretRallies,
  turretPackSize,
  turretRallyPack,
  turretRallyReach,
  turretRallySlot,
} from '../src/sim/minigames/turret_rally';
import { turretRallyKegBand, turretRallyKegSpot } from '../src/sim/minigames/turret_rally_kegs';

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

/** The nearest a keg at `spot` stands to any place of a gathering disc of `size` at `rally`. */
function nearestStanding(
  rally: { x: number; z: number },
  size: number,
  spot: { x: number; z: number },
) {
  let least = Number.POSITIVE_INFINITY;
  for (let slot = 0; slot < size; slot++) {
    const p = turretRallySlot(rally, 0, 0, slot);
    least = Math.min(least, Math.hypot(p.x - spot.x, p.z - spot.z));
  }
  return least;
}

describe('a rally keg spot', () => {
  const rally = { x: 0, z: 34 };
  const reach = turretRallyReach(12);

  it('puts a front keg on the advance path, a dozen yards and more tower-side, 2.5 to 3 yd off the axis', () => {
    expect([TURRET_RALLY.frontMin, TURRET_RALLY.frontMax]).toEqual([12, 16]);
    expect([TURRET_RALLY.axisOffsetMin, TURRET_RALLY.axisOffsetMax]).toEqual([2.5, 3]);
    for (const depth of [0, 0.5, 0.999]) {
      for (const side of [0.01, 0.3, 0.49, 0.5, 0.8, 0.99]) {
        const spot = turretRallyKegSpot({ placement: 'front' }, rally, 0, 0, side, depth, reach);
        const f = frame(rally, spot);
        expect(f.along).toBeGreaterThanOrEqual(TURRET_RALLY.frontMin - 1e-9);
        expect(f.along).toBeLessThanOrEqual(TURRET_RALLY.frontMax + 1e-9);
        expect(Math.abs(f.across)).toBeGreaterThanOrEqual(TURRET_RALLY.axisOffsetMin - 1e-9);
        expect(Math.abs(f.across)).toBeLessThanOrEqual(TURRET_RALLY.axisOffsetMax + 1e-9);
        expect(Math.sign(f.across)).toBe(side < 0.5 ? -1 : 1);
        expect(Math.hypot(spot.x, spot.z)).toBeGreaterThanOrEqual(
          TURRET_BARREL_RING.minRadius - 1e-9,
        );
      }
    }
  });

  it('puts a side keg on the same stretch of path, at the column rim', () => {
    for (const side of [0.1, 0.9]) {
      const f = frame(
        rally,
        turretRallyKegSpot({ placement: 'side' }, rally, 0, 0, side, 0.3, reach),
      );
      expect(f.along).toBeGreaterThanOrEqual(TURRET_RALLY.frontMin - 1e-9);
      expect(Math.abs(f.across)).toBeGreaterThanOrEqual(TURRET_RALLY.sideOffsetMin - 1e-9);
      expect(Math.abs(f.across)).toBeLessThanOrEqual(TURRET_RALLY.sideOffsetMax + 1e-9);
    }
    const axis = turretRallyKegSpot(
      { placement: 'axis', fromTower: 16 },
      rally,
      0,
      0,
      0.1,
      0.7,
      reach,
    );
    const f = frame(rally, axis);
    expect(f.along).toBeCloseTo(34 - 16, 9);
    expect(Math.abs(f.across)).toBeGreaterThanOrEqual(TURRET_RALLY.axisOffsetMin - 1e-9);
  });

  it('gives way so that a keg blast never reaches a member standing at the rally', () => {
    for (const size of [1, 8, 12, 18, 24]) {
      const r = turretRallyReach(size);
      for (const placement of ['front', 'side'] as const) {
        for (const side of [0.01, 0.25, 0.75, 0.99]) {
          const spot = turretRallyKegSpot({ placement }, rally, 0, 0, side, 0, r);
          expect(nearestStanding(rally, size, spot)).toBeGreaterThanOrEqual(
            TURRET_EXPLOSIVE_BARREL.blastRadius - 1e-9,
          );
        }
      }
    }
    // A big pack pushes the band out past its usual start; the tower rule never pulls it back in.
    const band = turretRallyKegBand(turretRallyReach(24), 2.5, 34);
    expect(band.min).toBeGreaterThan(TURRET_RALLY.frontMin);
    expect(band.max).toBeGreaterThanOrEqual(band.min);
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
      expect(Math.abs(f.across)).toBeGreaterThanOrEqual(TURRET_RALLY.axisOffsetMin - 1e-9);
      expect(Math.abs(f.across)).toBeLessThanOrEqual(TURRET_RALLY.axisOffsetMax + 1e-9);
    }
  });

  it('keeps every keg of every Pack wave out of reach of every standing member, and off the tower foot', () => {
    for (const [w, wave] of plan.waves.entries()) {
      for (let seed = 1; seed <= 16; seed++) {
        const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, 0);
        state.wave = w;
        const rallies = openTurretRallies(state, wave);
        const placed = placeTurretPathKegs(state, wave, 0, flat);
        const kegs = wave.kegs.length;
        expect(placed.length, `wave ${w + 1} seed ${seed}`).toBe(kegs);
        for (const keg of placed) {
          expect(Math.hypot(keg.x, keg.z)).toBeGreaterThanOrEqual(
            TURRET_BARREL_RING.minRadius - 1e-9,
          );
          for (const rally of rallies) {
            const size = turretPackSize(wave, turretRallyPack(rally.id));
            expect(
              nearestStanding(rally, size, keg),
              `wave ${w + 1} seed ${seed}`,
            ).toBeGreaterThanOrEqual(TURRET_EXPLOSIVE_BARREL.blastRadius);
          }
        }
      }
    }
  });

  it('opens a rally clear of a keg left standing from an earlier wave whenever a draw allows', () => {
    const wave = plan.waves[1];
    let clear = 0;
    let runs = 0;
    for (let seed = 1; seed <= 32; seed++) {
      const state = createTurretDefense(plan, { x: 0, z: 0 }, seed, 0);
      state.wave = 1;
      // A leftover keg on the pack's own bearing, as wave 1's front keg would stand.
      const probe = createTurretDefense(plan, { x: 0, z: 0 }, seed, 0);
      probe.wave = 1;
      const [ahead] = openTurretRallies(probe, wave);
      const d = Math.hypot(ahead.x, ahead.z);
      state.barrels.push({
        id: 900,
        x: (ahead.x / d) * 19,
        y: 0,
        z: (ahead.z / d) * 19,
        litTick: -1,
        blowTick: -1,
      });
      const [rally] = openTurretRallies(state, wave);
      runs++;
      const size = turretPackSize(wave, 0);
      if (nearestStanding(rally, size, state.barrels[0]) >= TURRET_EXPLOSIVE_BARREL.blastRadius)
        clear++;
    }
    expect(clear).toBe(runs);
  });

  it('stops at the keg cap, standing kegs included, and replays its spots from the seed', () => {
    const wave = plan.waves[4];
    const full = createTurretDefense(plan, { x: 0, z: 0 }, 3, 0);
    full.wave = 4;
    for (let i = 0; i < TURRET_EXPLOSIVE_BARREL.cap; i++)
      full.barrels.push({ id: 100 + i, x: 200 + 10 * i, y: 0, z: 200, litTick: -1, blowTick: -1 });
    openTurretRallies(full, wave);
    expect(placeTurretPathKegs(full, wave, 0, flat)).toEqual([]);
    const a = createTurretDefense(plan, { x: 0, z: 0 }, 3, 0);
    const b = createTurretDefense(plan, { x: 0, z: 0 }, 3, 0);
    a.wave = b.wave = 4;
    openTurretRallies(a, wave);
    openTurretRallies(b, wave);
    expect(placeTurretPathKegs(a, wave, 0, flat)).toEqual(placeTurretPathKegs(b, wave, 0, flat));
  });
});
