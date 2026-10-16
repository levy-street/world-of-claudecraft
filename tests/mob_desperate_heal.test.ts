import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;

// Sloomtooth the Drowned (content/zone2.ts, Drowning Resurgence) is the seeded
// carrier of the desperateHeal mechanic. The Tidebound Acolyte carried it until
// the Sunken Bastion rework traded its silent heal for the interruptible Brine
// Mend trash kit.
function makeAcolyte(sim: Sim, hpFrac: number) {
  const mob = createMob(990101, MOBS.sloomtooth_the_drowned, 11, { x: 0, y: 0, z: 0 });
  mob.hp = Math.round(mob.maxHp * hpFrac);
  mob.inCombat = true;
  return mob;
}

function fire(sim: Sim, mob: ReturnType<typeof makeAcolyte>) {
  (sim as unknown as { updateBossMechanics(m: typeof mob): void }).updateBossMechanics(mob);
}

describe('mob desperation self-heal', () => {
  it('seeds the mechanic on Sloomtooth the Drowned', () => {
    expect(MOBS.sloomtooth_the_drowned.desperateHeal).toEqual({
      belowHpPct: 0.3,
      healPct: 0.25,
    });
    // The Bastion rework's Acolyte heals through its kickable Brine Mend now.
    expect(MOBS.tidebound_acolyte.desperateHeal).toBeUndefined();
    expect(MOBS.tidebound_acolyte.trashKit?.mend).toBeDefined();
  });

  it('heals once when hp first drops below the threshold', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const mob = makeAcolyte(sim, 0.25);
    const before = mob.hp;
    fire(sim, mob);
    expect(mob.healedThisPull).toBe(true);
    expect(mob.hp).toBe(before + Math.round(mob.maxHp * 0.25));
  });

  it('does not heal again on subsequent ticks in the same pull', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const mob = makeAcolyte(sim, 0.25);
    fire(sim, mob);
    const afterFirst = mob.hp;
    mob.hp = Math.round(mob.maxHp * 0.1); // drop low again
    fire(sim, mob);
    expect(mob.hp).toBe(Math.round(mob.maxHp * 0.1));
    expect(afterFirst).toBeGreaterThan(0);
  });

  it('does not heal while above the threshold', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const mob = makeAcolyte(sim, 0.5);
    const before = mob.hp;
    fire(sim, mob);
    expect(mob.healedThisPull).toBe(false);
    expect(mob.hp).toBe(before);
  });

  it('never overheals past max hp', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const mob = makeAcolyte(sim, 0.29);
    mob.hp = mob.maxHp - 1; // technically below frac but nearly full
    // force the threshold by lowering hp under 30%
    mob.hp = Math.round(mob.maxHp * 0.29);
    fire(sim, mob);
    expect(mob.hp).toBeLessThanOrEqual(mob.maxHp);
  });

  it('re-arms after the mob evades and resets', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const mob = makeAcolyte(sim, 0.25);
    fire(sim, mob);
    expect(mob.healedThisPull).toBe(true);
    (sim as unknown as { resetEvadingMob(m: typeof mob): void }).resetEvadingMob(mob);
    expect(mob.healedThisPull).toBe(false);
    mob.hp = Math.round(mob.maxHp * 0.25);
    mob.inCombat = true;
    fire(sim, mob);
    expect(mob.healedThisPull).toBe(true);
  });

  it('leaves mobs without the mechanic untouched', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior' });
    const wolf = createMob(990102, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    wolf.hp = Math.round(wolf.maxHp * 0.1);
    wolf.inCombat = true;
    const before = wolf.hp;
    fire(sim, wolf);
    expect(wolf.healedThisPull).toBe(false);
    expect(wolf.hp).toBe(before);
  });
});
