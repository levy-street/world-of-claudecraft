// Haste from item-set bonuses: the aggregated `haste` stat in aggregateSetBonuses,
// its derivation in recalcPlayerStats (one stat drives meleeHaste/rangedHaste/
// spellHaste), and the three application sites (spell cast time, channel duration,
// melee swing, ranged auto-shot). Haste enters the game ONLY through set bonuses:
// the tier-2 3-piece bonuses and the three leveling haste kits.
import { describe, expect, it } from 'vitest';
import { updatePlayerAutoAttack } from '../src/sim/combat/auto_attack';
import {
  aggregateSetBonuses,
  ITEM_SETS,
  SET_BOUNDSTONE_VANGUARD,
  SET_DEATHLORD,
  SET_GREYJAW_STALKER,
  SET_HASTE_3PC,
  SET_HASTE_3PC_RATING,
  SET_NIGHTTALON,
  SET_VALE_ARCANIST,
} from '../src/sim/content/item_sets';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob, type PlayerEquipment, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemDef, PlayerClass } from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

const HASTE_KITS = [SET_VALE_ARCANIST, SET_BOUNDSTONE_VANGUARD, SET_GREYJAW_STALKER];

function setMembers(setId: string): ItemDef[] {
  // one member per equip slot, so slicing N members yields N equipped pieces
  const bySlot = new Map<string, ItemDef>();
  for (const i of Object.values(ITEMS)) {
    if (i.set === setId && i.slot && !bySlot.has(i.slot)) bySlot.set(i.slot, i);
  }
  return [...bySlot.values()];
}

function equipmentOf(items: ItemDef[]): PlayerEquipment {
  return Object.fromEntries(items.map((i) => [i.slot, i.id])) as PlayerEquipment;
}

function player(cls: PlayerClass, level = 20): { sim: AnySim; p: AnyEntity; pid: number } {
  const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true }) as AnySim;
  const pid = sim.addPlayer(cls, 'Tester');
  sim.setPlayerLevel(level, pid);
  sim.tick();
  return { sim, p: sim.entities.get(pid) as AnyEntity, pid };
}

function spawnDummy(sim: AnySim, p: AnyEntity, dz = 2): AnyEntity {
  const mob = createMob(sim.nextId++, MOBS['forest_wolf'], 20, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + dz,
  }) as AnyEntity;
  mob.maxHp = 500000;
  mob.hp = 500000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
  sim.targetEntity(mob.id, p.id);
  return mob;
}

describe('haste kit definitions (leveling sets in the ITEM_SETS framework)', () => {
  it('each kit has exactly 3 tagged member items and a single 3-piece haste tier', () => {
    for (const setId of HASTE_KITS) {
      const members = setMembers(setId);
      expect(members.length, `${setId} member count`).toBe(3);
      const set = ITEM_SETS[setId];
      expect(set.bonuses.length).toBe(1);
      expect(set.bonuses[0].pieces).toBe(3);
      expect(set.bonuses[0].effect.hasteRating).toBe(SET_HASTE_3PC_RATING);
    }
  });

  it('kit members share the family armor type (cloth / mail / leather)', () => {
    const armorOf = (setId: string) => setMembers(setId).map((i) => i.armorType);
    expect(armorOf(SET_VALE_ARCANIST)).toEqual(['cloth', 'cloth', 'cloth']);
    expect(armorOf(SET_BOUNDSTONE_VANGUARD)).toEqual(['mail', 'mail', 'mail']);
    expect(armorOf(SET_GREYJAW_STALKER)).toEqual(['leather', 'leather', 'leather']);
  });

  it('kit members cover 3 distinct equip slots (the set is completable)', () => {
    for (const setId of HASTE_KITS) {
      const slots = setMembers(setId).map((i) => i.slot);
      expect(new Set(slots).size, `${setId} slots ${slots}`).toBe(3);
    }
  });
});

describe('aggregated haste (pure resolver)', () => {
  it('a haste kit grants haste only at the full 3 pieces', () => {
    const two = aggregateSetBonuses(new Map([[SET_VALE_ARCANIST, 2]]));
    expect(two.hasteRating).toBe(0);
    const three = aggregateSetBonuses(new Map([[SET_VALE_ARCANIST, 3]]));
    expect(three.hasteRating).toBe(SET_HASTE_3PC_RATING);
  });

  it('every tier-2 3-piece bonus includes haste; tier-1 bonuses do not', () => {
    const t2 = ['crownforged', 'nighttalon', 'soulflame', 'stormcallers'];
    for (const setId of t2) {
      expect(aggregateSetBonuses(new Map([[setId, 3]])).hasteRating, `${setId} 3pc haste`).toBe(
        SET_HASTE_3PC_RATING,
      );
      expect(aggregateSetBonuses(new Map([[setId, 2]])).hasteRating, `${setId} 2pc haste`).toBe(0);
    }
    for (const setId of ['deathlord', 'wyrmshadow', 'necromancers']) {
      expect(aggregateSetBonuses(new Map([[setId, 3]])).hasteRating, `${setId} 3pc haste`).toBe(0);
    }
  });
});

describe('set-bonus haste derivation (recalcPlayerStats)', () => {
  it('3 caster kit pieces set all three haste channels from the one stat', () => {
    const { p } = player('mage');
    const [a, b, c] = setMembers(SET_VALE_ARCANIST);
    recalcPlayerStats(p, 'mage', equipmentOf([a, b]), undefined, {});
    expect(p.spellHaste).toBe(0);
    expect(p.meleeHaste).toBe(0);
    recalcPlayerStats(p, 'mage', equipmentOf([a, b, c]), undefined, {});
    expect(p.spellHaste).toBe(SET_HASTE_3PC);
    expect(p.meleeHaste).toBe(SET_HASTE_3PC);
    expect(p.rangedHaste).toBe(SET_HASTE_3PC);
  });

  it('the tier-2 Nighttalon 3-piece adds haste on top of its agi/crit bonus', () => {
    const { p } = player('rogue');
    recalcPlayerStats(
      p,
      'rogue',
      equipmentOf(setMembers(SET_NIGHTTALON).slice(0, 3)),
      undefined,
      {},
    );
    expect(p.meleeHaste).toBe(SET_HASTE_3PC);
    expect(p.spellHaste).toBe(SET_HASTE_3PC);
    // the pre-existing 3pc payload still applies alongside the haste
    expect(p.critChance).toBeCloseTo(0.05 + p.stats.agi * 0.0005 + 0.02);
  });

  it('the tier-1 Deathlord 3-piece grants no haste', () => {
    const { p } = player('warrior');
    recalcPlayerStats(
      p,
      'warrior',
      equipmentOf(setMembers(SET_DEATHLORD).slice(0, 3)),
      undefined,
      {},
    );
    expect(p.meleeHaste).toBe(0);
    expect(p.spellHaste).toBe(0);
  });
});

describe('spell haste shortens casts and channels', () => {
  it('a timed cast is (1 + spellHaste) times shorter', () => {
    const { sim, p, pid } = player('mage');
    spawnDummy(sim, p);
    p.resource = p.maxResource;

    p.spellHaste = 0;
    sim.castAbility('frostbolt', pid);
    const base = p.castTotal;
    expect(base).toBeGreaterThan(0);

    p.castingAbility = null;
    p.castRemaining = 0;
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    p.spellHaste = SET_HASTE_3PC;
    sim.castAbility('frostbolt', pid);
    expect(p.castTotal).toBeCloseTo(base / (1 + SET_HASTE_3PC), 6);
  });

  it('a channel is shortened and its tick interval scales with it', () => {
    const { sim, p, pid } = player('mage');
    spawnDummy(sim, p);
    p.resource = p.maxResource;

    p.spellHaste = 0;
    sim.castAbility('arcane_missiles', pid);
    const baseTotal = p.castTotal;
    const baseTick = p.channelTickEvery;
    expect(baseTotal).toBeGreaterThan(0);

    p.castingAbility = null;
    p.channeling = false;
    p.castRemaining = 0;
    p.gcdRemaining = 0;
    p.resource = p.maxResource;
    p.spellHaste = SET_HASTE_3PC;
    sim.castAbility('arcane_missiles', pid);
    expect(p.castTotal).toBeCloseTo(baseTotal / (1 + SET_HASTE_3PC), 6);
    expect(p.channelTickEvery).toBeCloseTo(baseTick / (1 + SET_HASTE_3PC), 6);
  });
});

describe('melee / ranged haste shorten the swing interval', () => {
  it('melee haste shortens the next melee swing timer', () => {
    const { sim, p } = player('warrior');
    const meta = sim.players.get(p.id)!;
    spawnDummy(sim, p);
    p.autoAttack = true;
    p.meleeHaste = SET_HASTE_3PC;
    p.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(
      (p.weapon.speed * sim.swingIntervalMult(p)) / (1 + SET_HASTE_3PC),
      6,
    );
  });

  it('ranged haste shortens the next auto-shot timer (hunter)', () => {
    const { sim, p } = player('hunter');
    const meta = sim.players.get(p.id)!;
    spawnDummy(sim, p, 12); // inside ranged max, outside the dead zone
    p.autoAttack = true;
    p.rangedHaste = SET_HASTE_3PC;
    p.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeGreaterThan(0);
    // the timer equals ranged.speed * mult / (1 + rangedHaste); cross-check the lift
    const unhasted = p.swingTimer * (1 + SET_HASTE_3PC);
    p.rangedHaste = 0;
    p.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(unhasted, 6);
  });
});
