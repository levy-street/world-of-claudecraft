// PvP tank restraint (src/sim/pvp/tank_restraint.ts): a committed tank who
// deals damage to, or takes damage from, a hostile player deals 30% less
// damage and heals themselves for 30% less, until 5 seconds pass with no
// hostile player-vs-player damage either way. Committed is the shared
// isCommittedTank rule: Protection warrior or paladin, Feral druid IN Bruin
// Form, Enhancement shaman WITH the Stonebound Weapon posture.

import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import {
  inPvpExchange,
  notePvpExchange,
  PVP_EXCHANGE_LINGER_SECONDS,
  TANK_PVP_DAMAGE_PENALTY,
  TANK_PVP_SELF_HEAL_PENALTY,
  tankPvpDamageMult,
  tankPvpSelfHealMult,
} from '../src/sim/pvp';
import { Sim } from '../src/sim/sim';
import { DT, type Entity, type PlayerClass } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

type Build = {
  cls: PlayerClass;
  spec: string | null;
  form?: 'bear_form';
  imbue?: 'rockbiter_weapon' | 'galeheart_weapon';
};

interface Arena {
  sim: Sim;
  tank: Entity;
  foe: Entity;
  ally: Entity;
  mob: Entity;
}

// Tank vs a mage in an active duel (hostile both ways), plus a friendly
// bystander and a wild mob. Every pool is huge so nothing dies, and every
// WARFARE rating is zero so the only scaling in play is the restraint.
function arena(build: Build): Arena {
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const tankPid = sim.addPlayer(build.cls, 'Bulwark');
  const foePid = sim.addPlayer('mage', 'Foe');
  const allyPid = sim.addPlayer('priest', 'Ally');
  sim.setPlayerLevel(20, tankPid);
  if (build.spec) sim.applyTalents({ spec: build.spec, rows: {} }, tankPid);
  const tank = sim.entities.get(tankPid)!;
  if (build.form) {
    sim.castAbility(build.form, tankPid);
    sim.tick();
    expect(tank.auras.some((a) => a.kind === 'form_bear')).toBe(true);
  }
  if (build.imbue) {
    tank.resource = tank.maxResource;
    sim.castAbility(build.imbue, tankPid);
    sim.tick();
    expect(tank.auras.some((a) => a.id === build.imbue)).toBe(true);
  }
  const foe = sim.entities.get(foePid)!;
  const ally = sim.entities.get(allyPid)!;
  for (const e of [tank, foe, ally]) {
    e.stats.pvpOffense = 0;
    e.stats.pvpDefense = 0;
    e.maxHp = 1_000_000;
    e.hp = 1_000;
  }
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...tank.pos });
  mob.maxHp = mob.hp = 1_000_000;
  (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
  const duel = { a: tankPid, b: foePid, state: 'active', timer: 0, controlled: new Map() };
  (sim.duels as Map<number, unknown>).set(tankPid, duel);
  (sim.duels as Map<number, unknown>).set(foePid, duel);
  return { sim, tank, foe, ally, mob };
}

function hit(sim: Sim, source: Entity, target: Entity, amount = 100): number {
  const before = target.hp;
  (sim as any).dealDamage(source, target, amount, false, 'arcane', null, 'hit');
  return before - target.hp;
}

function heal(sim: Sim, source: Entity, target: Entity, amount = 100): number {
  const before = target.hp;
  // canCrit=false: no crit roll, so the amount is exact.
  (sim as any).applyHeal(source, target, amount, 'Test Heal', null, false);
  return target.hp - before;
}

const PROT_WARRIOR: Build = { cls: 'warrior', spec: 'prot' };

describe('PvP tank restraint: pure rules', () => {
  it('is a 30% cut on damage and on self-healing, with a 5 second linger', () => {
    expect(TANK_PVP_DAMAGE_PENALTY).toBe(0.3);
    expect(TANK_PVP_SELF_HEAL_PENALTY).toBe(0.3);
    expect(PVP_EXCHANGE_LINGER_SECONDS).toBe(5);
  });

  it('stamps both sides of an exchange and expires after the linger', () => {
    const a = { pvpExchangeAt: undefined } as unknown as Entity;
    const b = { pvpExchangeAt: undefined } as unknown as Entity;
    expect(inPvpExchange(a, 0)).toBe(false);
    notePvpExchange(a, b, 10);
    expect(inPvpExchange(a, 10)).toBe(true);
    expect(inPvpExchange(b, 14.95)).toBe(true);
    expect(inPvpExchange(b, 15)).toBe(false);
  });

  it('only restrains committed tanks, and only heals they cast on themselves', () => {
    const tank = { id: 1, kind: 'player', auras: [], pvpExchangeAt: 0 } as unknown as Entity;
    const other = { id: 2, kind: 'player', auras: [], pvpExchangeAt: 0 } as unknown as Entity;
    const prot = { cls: 'warrior' as const, talentMods: { spec: 'prot' } };
    const fury = { cls: 'warrior' as const, talentMods: { spec: 'fury' } };
    expect(tankPvpDamageMult(tank, prot, 1)).toBeCloseTo(0.7);
    expect(tankPvpDamageMult(tank, fury, 1)).toBe(1);
    expect(tankPvpDamageMult(tank, prot, 6)).toBe(1);
    expect(tankPvpSelfHealMult(tank, tank, prot, 1)).toBeCloseTo(0.7);
    expect(tankPvpSelfHealMult(other, tank, prot, 1)).toBe(1);
    expect(tankPvpSelfHealMult(tank, tank, fury, 1)).toBe(1);
  });
});

describe('PvP tank restraint: damage', () => {
  it('cuts a Protection warrior from the very first hit on a player', () => {
    const { sim, tank, foe } = arena(PROT_WARRIOR);
    expect(hit(sim, tank, foe)).toBe(70);
    expect(hit(sim, tank, foe)).toBe(70);
    // The foe is not a tank: its damage is untouched.
    expect(hit(sim, foe, tank)).toBe(100);
  });

  it('cuts damage to hostile players and their pets, never to creatures', () => {
    const { sim, tank, foe, mob } = arena(PROT_WARRIOR);
    hit(sim, foe, tank);
    expect(hit(sim, tank, mob)).toBe(100);
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...foe.pos });
    pet.ownerId = foe.id;
    pet.hostile = false;
    pet.maxHp = pet.hp = 1_000_000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(pet);
    expect(hit(sim, tank, pet)).toBe(70);
    expect(hit(sim, tank, foe)).toBe(70);
    // The opening hit on a pet already pays it (the pet's owner is a player).
    const fresh = arena(PROT_WARRIOR);
    const freshPet = createMob(fresh.sim.nextId++, MOBS.forest_wolf, 20, { ...fresh.foe.pos });
    freshPet.ownerId = fresh.foe.id;
    freshPet.hostile = false;
    freshPet.maxHp = freshPet.hp = 1_000_000;
    (fresh.sim as unknown as { addEntity(e: Entity): void }).addEntity(freshPet);
    expect(hit(fresh.sim, fresh.tank, freshPet)).toBe(70);
  });

  it("a tank's pet hitting a hostile player pays the cut too", () => {
    const { sim, tank, foe } = arena(PROT_WARRIOR);
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...tank.pos });
    pet.ownerId = tank.id;
    pet.hostile = false;
    pet.maxHp = pet.hp = 1_000_000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(pet);
    expect(hit(sim, pet, foe)).toBe(100 * (1 - TANK_PVP_DAMAGE_PENALTY));
  });

  it('opens the 5 second exchange window on a hit taken from a player pet', () => {
    const { sim, tank, foe } = arena(PROT_WARRIOR);
    const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, { ...foe.pos });
    pet.ownerId = foe.id;
    pet.hostile = false;
    pet.maxHp = pet.hp = 1_000_000;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(pet);
    hit(sim, pet, tank);
    expect(inPvpExchange(tank, sim.time)).toBe(true);
    expect(heal(sim, tank, tank)).toBe(70);
    sim.time += PVP_EXCHANGE_LINGER_SECONDS;
    expect(inPvpExchange(tank, sim.time)).toBe(false);
  });

  it('never applies in pure PvE or against a friendly player', () => {
    const { sim, tank, ally, mob } = arena(PROT_WARRIOR);
    expect(hit(sim, mob, tank)).toBe(100);
    expect(hit(sim, tank, mob)).toBe(100);
    // Damaging a non-hostile player is not a PvP exchange.
    expect(hit(sim, tank, ally)).toBe(100);
    expect(hit(sim, tank, mob)).toBe(100);
  });

  it.each<[string, Build, number]>([
    ['Protection paladin', { cls: 'paladin', spec: 'protection' }, 70],
    ['Retribution paladin', { cls: 'paladin', spec: 'retribution' }, 100],
    ['Arms warrior', { cls: 'warrior', spec: 'arms' }, 100],
    ['Feral druid in Bruin Form', { cls: 'druid', spec: 'feral', form: 'bear_form' }, 70],
    ['Feral druid out of Bruin Form', { cls: 'druid', spec: 'feral' }, 100],
    [
      'Enhancement shaman with Stonebound Weapon',
      { cls: 'shaman', spec: 'enhancement', imbue: 'rockbiter_weapon' },
      70,
    ],
    [
      'Enhancement shaman with Galeheart Weapon',
      { cls: 'shaman', spec: 'enhancement', imbue: 'galeheart_weapon' },
      100,
    ],
  ])('%s deals %i of a 100 hit', (_label, build, expected) => {
    const { sim, tank, foe } = arena(build);
    expect(hit(sim, tank, foe)).toBe(expected);
  });
});

describe('PvP tank restraint: self-healing', () => {
  it("cuts the tank's heals on themselves only while fighting players", () => {
    const { sim, tank, foe } = arena(PROT_WARRIOR);
    expect(heal(sim, tank, tank)).toBe(100);
    hit(sim, foe, tank);
    expect(heal(sim, tank, tank)).toBe(70);
    sim.time += PVP_EXCHANGE_LINGER_SECONDS;
    expect(heal(sim, tank, tank)).toBe(100);
  });

  it('leaves heals from others, and heals the tank casts on others, untouched', () => {
    const { sim, tank, foe, ally } = arena(PROT_WARRIOR);
    hit(sim, tank, foe);
    expect(heal(sim, ally, tank)).toBe(100);
    expect(heal(sim, tank, ally)).toBe(100);
  });

  it('does not touch a non-tank healing themselves mid-fight', () => {
    const { sim, tank, foe } = arena({ cls: 'paladin', spec: 'retribution' });
    hit(sim, foe, tank);
    expect(heal(sim, tank, tank)).toBe(100);
  });

  it("cuts the tank's own heal-over-time ticks, not one an ally keeps on them", () => {
    const { sim, tank, foe, ally } = arena(PROT_WARRIOR);
    const hotTick = (sourceId: number): number => {
      tank.auras = tank.auras.filter((a) => a.id !== 'test_hot');
      tank.auras.push({
        id: 'test_hot',
        name: 'Test Renewal',
        kind: 'hot',
        remaining: 10,
        duration: 10,
        value: 100,
        tickInterval: 1,
        tickTimer: DT,
        sourceId,
        school: 'holy',
      });
      const before = tank.hp;
      updateAuras((sim as any).ctx, tank);
      return tank.hp - before;
    };
    expect(hotTick(tank.id)).toBe(100);
    hit(sim, tank, foe);
    expect(hotTick(tank.id)).toBe(70);
    expect(hotTick(ally.id)).toBe(100);
  });
});
