// An evading mob is damage-immune (combat/damage.ts) and untargetable for the
// whole walk home, so its support kit must be silent too: startEvadeHome drops
// aggro and threat but deliberately leaves inCombat set (other systems key on
// it), and the boss-mechanic driver keyed on inCombat alone. A leashed
// Gravecaller Mender therefore kept knitting its camp back to full while
// nothing could touch it, for as long as the walk lasted (unbounded under the
// instance-exit hold).
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { type Entity, LEASH_DISTANCE } from '../src/sim/types';

const SEED = 41099;
const MEND = MOBS.gravecaller_mender.mendAlly!;
const WOUNDED_FRAC = 0.4;

const addEntity = (sim: Sim, e: Entity) =>
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(e);
const updateMob = (sim: Sim, mob: Entity) =>
  (sim as unknown as { updateMob(m: Entity): void }).updateMob(mob);

function place(sim: Sim, e: Entity, x: number, z: number) {
  e.pos = sim.groundPos(x, z);
  e.prevPos = { ...e.pos };
  sim.grid.update(e);
}

// Open a real pull: a hit is what seeds threat, and the hate table is what
// keeps the mob engaged instead of retargeting straight back into evade.
function pull(sim: Sim, mob: Entity) {
  sim.ctx.dealDamage(sim.player, mob, 1, false, 'physical', null, 'hit');
  updateMob(sim, mob);
  expect(mob.aggroTargetId).toBe(sim.playerId);
  expect(mob.inCombat).toBe(true);
}

// A mender pulled off its camp, then dragged past its leash so the next tick
// sends it home, with a wounded pack-mate at its side (social aggro brings the
// camp along, so a leashing mender leashes with company in Grave Mending range).
function leashedMender(sim: Sim) {
  sim.player.maxHp = 5000;
  sim.player.hp = 5000; // outlive the mender melee: the kit is what is under test
  const home = { ...sim.player.pos };
  const mender = createMob(950001, MOBS.gravecaller_mender, MOBS.gravecaller_mender.maxLevel, home);
  addEntity(sim, mender);
  const ally = createMob(950002, MOBS.gravecaller_cultist, MOBS.gravecaller_cultist.maxLevel, home);
  ally.hp = Math.round(ally.maxHp * WOUNDED_FRAC);
  addEntity(sim, ally);

  place(sim, sim.player, home.x + 2, home.z);
  pull(sim, mender);

  const dragX = home.x + LEASH_DISTANCE + 10;
  place(sim, mender, dragX, home.z);
  place(sim, ally, dragX, home.z);
  place(sim, sim.player, dragX + 2, home.z);
  mender.leashAnchor = null; // measured from spawn: dragged well past the leash

  updateMob(sim, mender);
  expect(mender.aiState).toBe('evade');
  return { mender, ally, home };
}

function walkHome(sim: Sim, mender: Entity, onTick?: () => void) {
  let ticks = 0;
  while (mender.aiState === 'evade' && ticks < 20 * 60) {
    updateMob(sim, mender);
    onTick?.();
    ticks++;
  }
  expect(ticks).toBeGreaterThan(1); // the walk really happened
  expect(mender.aiState).toBe('idle'); // arrived home and reset
  return ticks;
}

describe('evading mob support kit', () => {
  it('casts nothing for the whole walk home, with inCombat still set', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const { mender, ally } = leashedMender(sim);
    const wounded = ally.hp;
    mender.mendTimer = 0.001; // due the instant the walk starts

    walkHome(sim, mender, () => {
      expect(ally.hp).toBe(wounded);
      // The premise: the evade state is what gates the kit, not inCombat, which
      // stays set right up to the reset on arrival.
      if (mender.aiState === 'evade') expect(mender.inCombat).toBe(true);
    });
    expect(ally.hp).toBe(wounded);
  });

  it('mends again once it has reset and been re-engaged', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    const { mender, ally, home } = leashedMender(sim);
    walkHome(sim, mender);
    expect(mender.mendTimer).toBe(MEND.every);

    // The camp is whole again: the wounded pack-mate and the next player are
    // both back at the spawn, so a fresh pull runs the kit as authored.
    place(sim, ally, home.x, home.z);
    ally.hp = Math.round(ally.maxHp * WOUNDED_FRAC);
    place(sim, sim.player, home.x + 2, home.z);
    pull(sim, mender);
    const wounded = ally.hp;

    for (let i = 0; i < 20 * MEND.every + 1; i++) updateMob(sim, mender);
    expect(mender.aiState).not.toBe('evade');
    expect(ally.hp).toBeGreaterThan(wounded);
  });
});
