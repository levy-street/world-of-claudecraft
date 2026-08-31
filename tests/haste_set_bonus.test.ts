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
import { emptyModifiers, type TalentModifiers } from '../src/sim/content/talents';
import { ITEMS, MOBS } from '../src/sim/data';
import { createMob, type PlayerEquipment, recalcPlayerStats } from '../src/sim/entity';
import { type PlayerMeta, Sim } from '../src/sim/sim';
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

  it('lineage haste lives at the 6-piece capstone, never below it', () => {
    // The retune: the incumbent families climb one 2/4/6 ladder per archetype
    // and the haste payout is the capstone, so four pieces of any single
    // family pay no haste and six pieces across the tiers do.
    for (const setId of [
      'crownforged',
      'nighttalon',
      'soulflame',
      'stormcallers',
      'deathlord',
      'wyrmshadow',
      'necromancers',
    ]) {
      expect(aggregateSetBonuses(new Map([[setId, 4]])).hasteRating, `${setId} 4pc haste`).toBe(0);
    }
    const strengthSix = aggregateSetBonuses(
      new Map([
        ['deathlord', 3],
        ['crownforged', 3],
      ]),
    );
    expect(strengthSix.hasteRating).toBe(SET_HASTE_3PC_RATING);
    const casterSix = aggregateSetBonuses(
      new Map([
        ['necromancers', 2],
        ['soulflame', 4],
      ]),
    );
    expect(casterSix.hasteRating).toBe(SET_HASTE_3PC_RATING);
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

  it('the agility lineage capstone adds haste on top of the 2-piece agi/crit bonus', () => {
    const { p } = player('rogue');
    // Four nighttalon slots plus the two wyrmshadow slots the other family
    // does not occupy: six worn pieces of ONE lineage, no slot collisions.
    const six = [
      ...setMembers(SET_NIGHTTALON),
      ...setMembers('wyrmshadow').filter((i) => i.slot === 'chest' || i.slot === 'feet'),
    ];
    expect(six).toHaveLength(6);
    recalcPlayerStats(p, 'rogue', equipmentOf(six), undefined, {});
    expect(p.meleeHaste).toBe(SET_HASTE_3PC);
    expect(p.spellHaste).toBe(SET_HASTE_3PC);
    // the lineage 2-piece payload (1% crit inside critRating) still applies
    // alongside the capstone haste, on top of the flipped 20-crit piece seeds
    expect(p.critChance).toBeCloseTo(0.05 + p.stats.agi * 0.0005 + p.critRating / 2000);
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
    // Aether Darts moved from the shared mage kit to Chronomancy after this
    // release test was written; select that spec so the channel actually starts.
    expect(sim.setSpec('arcane', pid)).toBe(true);
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
    // v0.27.1: meleeHaste lives in swingIntervalMult's one additive haste
    // bucket, so the interval mult itself carries the set bonus (the timer no
    // longer divides by it a second time in auto_attack).
    const baseMult = sim.swingIntervalMult(p);
    p.meleeHaste = SET_HASTE_3PC;
    expect(sim.swingIntervalMult(p)).toBeCloseTo(baseMult / (1 + SET_HASTE_3PC), 6);
    p.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(p.weapon.speed * sim.swingIntervalMult(p), 6);
  });

  it('ranged haste shortens the next auto-shot timer (hunter)', () => {
    const { sim, p } = player('hunter');
    const meta = sim.players.get(p.id)!;
    spawnDummy(sim, p, 12); // inside ranged max, outside the dead zone
    p.autoAttack = true;
    p.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    const unhasted = p.swingTimer;
    expect(unhasted).toBeGreaterThan(0);
    // recalcPlayerStats drives both channels off the one hasteFrac, so a set
    // bonus lands on meleeHaste and rangedHaste together.
    p.meleeHaste = SET_HASTE_3PC;
    p.rangedHaste = SET_HASTE_3PC;
    p.swingTimer = 0;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(unhasted / (1 + SET_HASTE_3PC), 6);
  });
});

describe('ranged haste applies exactly once', () => {
  // Regression: the auto-shot timer divided by swingIntervalMult (which already
  // folds gear haste in) AND by rangedHaste, so gear haste double-dipped.
  const MASTERY_MELEE_HASTE_PCT = 0.1;

  function applyAura(sim: AnySim, p: AnyEntity, aura: object): void {
    (sim as unknown as { applyAura(t: Entity, a: object): void }).applyAura(p, aura);
  }

  // Equips through meta.equipment so every later recalc (applyAura runs one)
  // reproduces the same hasteFrac on BOTH channels, the way the game does.
  function kitted(
    cls: PlayerClass,
    setId: string,
    dz: number,
    mods?: TalentModifiers,
  ): { sim: AnySim; p: AnyEntity; meta: PlayerMeta } {
    const { sim, p } = player(cls);
    const meta = sim.players.get(p.id) as PlayerMeta;
    meta.equipment = equipmentOf(setMembers(setId));
    recalcPlayerStats(p, cls, meta.equipment, mods, meta.equipmentInstance);
    expect(p.rangedHaste).toBe(SET_HASTE_3PC);
    spawnDummy(sim, p, dz);
    p.autoAttack = true;
    p.swingTimer = 0;
    return { sim, p, meta };
  }

  function hastedHunter(mods?: TalentModifiers): { sim: AnySim; p: AnyEntity; meta: PlayerMeta } {
    // 12 yd: inside the hunter's ranged max, outside the dead zone.
    return kitted('hunter', SET_GREYJAW_STALKER, 12, mods);
  }

  it('divides the auto-shot cadence by gear haste once, not twice', () => {
    const { sim, p, meta } = hastedHunter();
    expect(p.meleeHaste).toBe(SET_HASTE_3PC);
    const speed = p.weapon.speed;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(speed / (1 + SET_HASTE_3PC), 6);
    expect(p.swingTimer).not.toBeCloseTo(speed / (1 + SET_HASTE_3PC) ** 2, 6);
  });

  it('leaves the melee arm on the same single haste bucket', () => {
    const { sim, p, meta } = kitted('warrior', SET_BOUNDSTONE_VANGUARD, 2);
    expect(p.meleeHaste).toBe(SET_HASTE_3PC);
    const speed = p.weapon.speed;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(speed / (1 + SET_HASTE_3PC), 6);
  });

  it('a spec mastery melee haste speeds melee swings but not the auto-shot', () => {
    const mods = emptyModifiers();
    mods.global.meleeHastePct = MASTERY_MELEE_HASTE_PCT;
    const { sim, p, meta } = hastedHunter(mods);
    expect(p.meleeHaste).toBeCloseTo(SET_HASTE_3PC + MASTERY_MELEE_HASTE_PCT, 6);
    const speed = p.weapon.speed;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(speed / (1 + SET_HASTE_3PC), 6);
    expect(sim.swingIntervalMult(p)).toBeCloseTo(
      1 / (1 + SET_HASTE_3PC + MASTERY_MELEE_HASTE_PCT),
      6,
    );
  });

  it('folds a buff_haste aura into the same ranged bucket', () => {
    const { sim, p, meta } = hastedHunter();
    const bloodlust = 0.3;
    applyAura(sim, p, {
      id: 'bloodlust',
      name: 'Bloodlust',
      kind: 'buff_haste',
      value: 1 + bloodlust,
      remaining: 300,
      duration: 300,
      sourceId: p.id,
      school: 'nature',
    });
    const speed = p.weapon.speed;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo(speed / (1 + SET_HASTE_3PC + bloodlust), 6);
  });

  it('keeps an attackspeed slow on its own multiplicative axis for ranged', () => {
    const { sim, p, meta } = hastedHunter();
    const slow = 1.2;
    applyAura(sim, p, {
      id: 'test_slow',
      name: 'Test Slow',
      kind: 'attackspeed',
      value: slow,
      remaining: 10,
      duration: 10,
      sourceId: p.id,
      school: 'physical',
    });
    const speed = p.weapon.speed;
    updatePlayerAutoAttack(sim.ctx, p, meta);
    expect(p.swingTimer).toBeCloseTo((speed * slow) / (1 + SET_HASTE_3PC), 6);
  });
});
