// Titan's Grip penalty (v0.27.1): dual-wielding with a two-hander in either hand
// reduces ALL physical damage done by TITANS_GRIP_DMG_PENALTY (the WoW 3.1.0
// model: a flat physical cut, deliberately not a miss-chance penalty). The stat
// side of the same tradeoff is pinned in tests/twohand_rebudget.test.ts.
import { describe, expect, it } from 'vitest';
import { recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { MAX_LEVEL, TITANS_GRIP_DMG_PENALTY } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;

const TWOHAND_A = 'deathless_greatblade';
const TWOHAND_B = 'bonewrought_greatsword';
const ONEHAND = 'gravewyrm_cleaver';

function furyWarrior(): AnySim {
  const sim = new Sim({ seed: 2711, playerClass: 'warrior' }) as AnySim;
  sim.setPlayerLevel(MAX_LEVEL);
  expect(sim.setSpec('fury')).toBe(true);
  return sim;
}

function equipLoadout(sim: AnySim, mainhand?: string, offhand?: string): void {
  const meta = sim.players.get(sim.player.id);
  if (!meta) throw new Error('no player meta');
  meta.equipment.mainhand = mainhand;
  meta.equipment.offhand = offhand;
  recalcPlayerStats(sim.player, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
}

function dummyMob(sim: AnySim): Entity {
  const mob = [...sim.entities.values()].find(
    (e): e is Entity => (e as Entity).kind === 'mob' && !(e as Entity).dead,
  );
  if (!mob) throw new Error('no mob to hit');
  mob.hp = 1_000_000;
  mob.maxHp = 1_000_000;
  return mob;
}

describe('titans grip physical damage penalty', () => {
  it('derives titansGrip from the equipped loadout, on only when dual-wielding a two-hander', () => {
    const sim = furyWarrior();
    equipLoadout(sim, TWOHAND_A, TWOHAND_B);
    expect(sim.player.titansGrip).toBe(true);

    // A two-hander in the mainhand with any offhand weapon still pays: the
    // penalty keys on the two-hander being dual-wielded, not on the pairing.
    equipLoadout(sim, TWOHAND_A, ONEHAND);
    expect(sim.player.titansGrip).toBe(true);

    // The sanctioned loadouts stay penalty-free.
    equipLoadout(sim, TWOHAND_A, undefined);
    expect(sim.player.titansGrip).toBe(false);
    equipLoadout(sim, ONEHAND, ONEHAND);
    expect(sim.player.titansGrip).toBe(false);
  });

  it('cuts physical damage by exactly the penalty and never touches other schools', () => {
    const sim = furyWarrior();
    const mob = dummyMob(sim);
    equipLoadout(sim, TWOHAND_A, TWOHAND_B);

    let before = mob.hp;
    sim.dealDamage(sim.player, mob, 1000, false, 'physical', null, 'hit');
    expect(before - mob.hp).toBe(Math.round(1000 * (1 - TITANS_GRIP_DMG_PENALTY)));

    before = mob.hp;
    sim.dealDamage(sim.player, mob, 1000, false, 'shadow', null, 'hit');
    expect(before - mob.hp).toBe(1000);
  });

  it('deals full physical damage without the dual-wielded two-hander', () => {
    const sim = furyWarrior();
    const mob = dummyMob(sim);
    equipLoadout(sim, TWOHAND_A, undefined);

    const before = mob.hp;
    sim.dealDamage(sim.player, mob, 1000, false, 'physical', null, 'hit');
    expect(before - mob.hp).toBe(1000);
  });
});
