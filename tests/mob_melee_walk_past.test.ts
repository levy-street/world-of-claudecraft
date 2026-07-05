import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { createMob } from '../src/sim/entity';
import { MOBS } from '../src/sim/data';
import { MELEE_RANGE } from '../src/sim/types';

// Regression for "excessive melee range on monsters": a STATIONARY mob used to gain a
// flat +3 yd reach grace whenever the *player* moved (walking past), so it struck a
// passerby from ~8 yd while seeming out of reach. The grace now applies only to a mob
// that actually moved this tick (pursuing), and is a tick-justified 1 yd. These tests
// drive the real swing gate (Sim.tryMobMeleeSwingInRange) deterministically, with no
// world spawners, so the HP delta reflects only the mob under test.

const SEED = 7788;
let nextId = 9000;

function makeSim() {
  const sim: any = new Sim({ seed: SEED, playerClass: 'warrior' });
  const p = sim.entities.get(sim.playerId)!;
  p.pos = { x: 0, y: 0, z: 0 };
  p.prevPos = { x: -1, y: 0, z: 0 }; // the player moved this tick (the old trigger)
  p.maxHp = 100000;
  p.hp = 100000;
  return { sim, p };
}

// Place a hostile scale-1 mob at distance `dist` along +x. `moved` controls whether
// the mob itself repositioned this tick (prevPos differs from pos).
function placeMob(sim: any, dist: number, moved: boolean) {
  const mob = createMob(nextId++, MOBS['forest_wolf'], 5, { x: dist, y: 0, z: 0 });
  mob.scale = 1; // baseline scale: true melee range is exactly MELEE_RANGE (5 yd)
  mob.weapon = { min: 50, max: 50, speed: 2 }; // deterministic, non-zero swing damage
  mob.swingTimer = 0; // ready to swing the instant it is in range
  mob.prevPos = moved ? { x: dist + 2, y: 0, z: 0 } : { x: dist, y: 0, z: 0 };
  sim.entities.set(mob.id, mob);
  sim.rebucket?.(mob);
  return mob;
}

describe('mob melee reach: walking past a stationary mob', () => {
  it('a stationary mob does NOT swing at a moving player 6.5 yd away', () => {
    const { sim, p } = makeSim();
    const mob = placeMob(sim, 6.5, false);
    const swung = sim.tryMobMeleeSwingInRange(mob, p);
    expect(swung).toBe(false);
    expect(p.hp).toBe(100000); // untouched: 6.5 yd is outside the true 5 yd reach
  });

  it('a stationary mob still swings at a player inside its true 5 yd reach', () => {
    const { sim, p } = makeSim();
    const mob = placeMob(sim, 4.5, false);
    const swung = sim.tryMobMeleeSwingInRange(mob, p);
    expect(swung).toBe(true);
    expect(p.hp).toBeLessThan(100000);
  });

  it('reports the true melee range for a stationary mob and a small grace for a moving one', () => {
    const { sim } = makeSim();
    const still = placeMob(sim, 6.5, false);
    const pursuing = placeMob(sim, 6.5, true);
    expect(sim.mobEffectiveMeleeRange(still)).toBe(MELEE_RANGE); // 5 yd, no grace
    expect(sim.mobEffectiveMeleeRange(pursuing)).toBe(MELEE_RANGE + 1); // 6 yd, tick-justified grace
  });

  it('a pursuing mob gets only the 1 yd grace, not the old 3 yd reach', () => {
    const { sim, p } = makeSim();
    // At 6.5 yd a pursuing mob (reach 6) still cannot connect; the old +3 reach (8 yd) would have.
    expect(sim.tryMobMeleeSwingInRange(placeMob(sim, 6.5, true), p)).toBe(false);
    expect(p.hp).toBe(100000);
    // At 5.5 yd the 1 yd grace does let a pursuing mob connect.
    expect(sim.tryMobMeleeSwingInRange(placeMob(sim, 5.5, true), p)).toBe(true);
    expect(p.hp).toBeLessThan(100000);
  });

  it('is deterministic for the same seed', () => {
    const run = () => {
      const { sim, p } = makeSim();
      sim.tryMobMeleeSwingInRange(placeMob(sim, 4.5, false), p);
      return p.hp;
    };
    expect(run()).toBe(run());
  });
});
