// Gear durability and vendor repair (src/sim/durability_rules.ts +
// src/sim/durability.ts): the pure pool/cost rules, the death penalty, the
// Spirit Healer surcharge, Repair All at a merchant, the broken-gear stat gate,
// and the save round-trip of a damaged copy. Driven against a real Sim so
// handleDeath / reviveAt / recalcPlayerStats / serializeCharacter are the real
// code paths.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, ITEMS } from '../src/sim/data';
import {
  applyDeathDurabilityLoss,
  applySpiritRezDurabilityLoss,
  durabilityLossExempt,
} from '../src/sim/durability';
import {
  currentDurability,
  DEATH_DURABILITY_LOSS,
  DURABILITY_LOSS_MIN_LEVEL,
  damageWornGear,
  hasDurability,
  isBrokenGear,
  maxDurability,
  REPAIR_COPPER_PER_ILVL_POINT,
  repairAllCost,
  repairCostFor,
  repairItemLevel,
  restoreWornGear,
  SPIRIT_REZ_DURABILITY_LOSS,
} from '../src/sim/durability_rules';
import { recalcPlayerStats } from '../src/sim/entity';
import { itemLevel } from '../src/sim/item_level';
import { createRiftGearInstance } from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';
import {
  ALL_EQUIP_SLOTS,
  type Entity,
  type EquipSlot,
  type ItemDef,
  type ItemInstancePayload,
  type SimEvent,
  type WorldContent,
} from '../src/sim/types';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

// Spirit Healers and merchants are what these cases need; ambient camps and
// quest objects can go (the subsystem-world pattern, tests/spirit.test.ts).
const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], groundObjects: [] };

const makeSim = (seed = 42): AnySim =>
  new Sim({ seed, playerClass: 'warrior', autoEquip: true, world: WORLD }) as AnySim;

function killPlayer(sim: AnySim): SimEvent[] {
  sim.dealDamage(null, sim.player, sim.player.maxHp + 100, false, 'physical', null, 'hit', true);
  return sim.tick();
}

function vendorNpc(sim: AnySim): AnyEntity {
  for (const e of sim.entities.values() as IterableIterator<AnyEntity>) {
    if (e.kind === 'npc' && e.vendorItems.length > 0) return e;
  }
  throw new Error('no vendor npc in the world');
}

/** Worn slots whose def carries a pool (rings/neck excluded by construction). */
function wornPoolSlots(sim: AnySim): EquipSlot[] {
  return ALL_EQUIP_SLOTS.filter((slot) => {
    const id = sim.equipment[slot];
    return id !== undefined && hasDurability(ITEMS[id]);
  });
}

function fakeDef(over: Partial<ItemDef> & { kind: ItemDef['kind'] }): ItemDef {
  return { id: 'fake', name: 'Fake', quality: 'common', sellValue: 0, ...over } as ItemDef;
}

describe('durability_rules: which gear carries a pool, and how large', () => {
  it('jewelry and non-equippables carry no pool; armor, shields, weapons, held offhands do', () => {
    expect(maxDurability(fakeDef({ kind: 'armor', slot: 'neck' }))).toBe(0);
    expect(maxDurability(fakeDef({ kind: 'armor', slot: 'ring' }))).toBe(0);
    expect(maxDurability(fakeDef({ kind: 'junk' }))).toBe(0);
    expect(maxDurability(fakeDef({ kind: 'potion' }))).toBe(0);
    expect(maxDurability(undefined)).toBe(0);
    expect(maxDurability(fakeDef({ kind: 'weapon', slot: 'mainhand' }))).toBeGreaterThan(0);
    expect(maxDurability(fakeDef({ kind: 'held_offhand', slot: 'offhand' }))).toBeGreaterThan(0);
    expect(
      maxDurability(fakeDef({ kind: 'armor', slot: 'offhand', armorType: 'mail', shield: true })),
    ).toBeGreaterThan(0);
    expect(hasDurability(fakeDef({ kind: 'armor', slot: 'chest', armorType: 'cloth' }))).toBe(true);
  });

  it('heavier armor classes carry more per slot, and a two-hander more than a one-hander', () => {
    const cloth = maxDurability(fakeDef({ kind: 'armor', slot: 'chest', armorType: 'cloth' }));
    const leather = maxDurability(fakeDef({ kind: 'armor', slot: 'chest', armorType: 'leather' }));
    const mail = maxDurability(fakeDef({ kind: 'armor', slot: 'chest', armorType: 'mail' }));
    expect(cloth).toBeLessThan(leather);
    expect(leather).toBeLessThan(mail);
    expect(leather).toBe(100);
    const one = maxDurability(fakeDef({ kind: 'weapon', slot: 'mainhand', hand: 'onehand' }));
    const two = maxDurability(fakeDef({ kind: 'weapon', slot: 'mainhand', hand: 'twohand' }));
    expect(two).toBeGreaterThan(one);
  });

  it('every shipped equippable with an armor class or weapon kind resolves a positive pool', () => {
    for (const def of Object.values(ITEMS)) {
      if (hasDurability(def)) expect(maxDurability(def), def.id).toBeGreaterThan(0);
    }
  });

  it('current durability is the full pool when absent, clamped and rounded otherwise', () => {
    const chest = fakeDef({ kind: 'armor', slot: 'chest', armorType: 'leather' });
    expect(currentDurability(chest, undefined)).toBe(100);
    expect(currentDurability(chest, {})).toBe(100);
    expect(currentDurability(chest, { durability: 37 })).toBe(37);
    expect(currentDurability(chest, { durability: -5 })).toBe(0);
    expect(currentDurability(chest, { durability: 999 })).toBe(100);
    expect(currentDurability(chest, { durability: Number.NaN })).toBe(100);
    expect(currentDurability(chest, { durability: 12.6 })).toBe(13);
    expect(isBrokenGear(chest, { durability: 0 })).toBe(true);
    expect(isBrokenGear(chest, { durability: 1 })).toBe(false);
    expect(isBrokenGear(fakeDef({ kind: 'armor', slot: 'neck' }), { durability: 0 })).toBe(false);
  });
});

describe('durability_rules: the repair bill', () => {
  it('charges 5c per item level per missing point (the spec formula)', () => {
    // A def with no derivable source prices on its required level (which the
    // level cap clamps, so pin a level inside it), so the formula can be
    // pinned on plain numbers: a mail chest pools 120.
    const def = fakeDef({ kind: 'armor', slot: 'chest', armorType: 'mail', requiredLevel: 10 });
    expect(REPAIR_COPPER_PER_ILVL_POINT).toBe(5);
    const max = maxDurability(def);
    expect(max).toBe(120);
    expect(repairItemLevel(def)).toBe(10);
    expect(repairCostFor(def, { durability: 0 })).toBe(5 * 10 * 120);
    expect(repairCostFor(def, { durability: 80 })).toBe(5 * 10 * 40);
    expect(repairCostFor(def, undefined)).toBe(0);
    expect(repairCostFor(def, { durability: max })).toBe(0);
    expect(repairCostFor(undefined, { durability: 0 })).toBe(0);
  });

  it('prices a sourced piece on its tooltip item level, so a raid piece bills more than a starter', () => {
    const sourced = Object.values(ITEMS).filter(
      (d) => hasDurability(d) && itemLevel(d) !== undefined && (itemLevel(d) as number) > 1,
    );
    expect(sourced.length).toBeGreaterThan(0);
    for (const def of sourced) expect(repairItemLevel(def), def.id).toBe(itemLevel(def));
    const top = sourced.reduce((a, b) => (itemLevel(a)! >= itemLevel(b)! ? a : b));
    expect(repairCostFor(top, { durability: 0 })).toBe(5 * itemLevel(top)! * maxDurability(top));
  });

  it('sums every worn slot and ignores slots that carry no pool', () => {
    const chest = fakeDef({
      id: 'c',
      kind: 'armor',
      slot: 'chest',
      armorType: 'leather',
      requiredLevel: 10,
    });
    const ring = fakeDef({ id: 'r', kind: 'armor', slot: 'ring', requiredLevel: 10 });
    const items = { c: chest, r: ring };
    const equipment: Partial<Record<EquipSlot, string>> = { chest: 'c', ring1: 'r' };
    const instances: Partial<Record<EquipSlot, ItemInstancePayload>> = {
      chest: { durability: 60 },
      ring1: { durability: 0 },
    };
    expect(repairAllCost(equipment, instances, items)).toBe(5 * 10 * 40);
    expect(repairAllCost(equipment, undefined, items)).toBe(0);
  });

  it('damageWornGear takes a fraction of MAX (at least one point), floors at zero, and restoreWornGear strips the field', () => {
    const chest = fakeDef({ id: 'c', kind: 'armor', slot: 'chest', armorType: 'leather' });
    const belt = fakeDef({ id: 'b', kind: 'armor', slot: 'waist', armorType: 'cloth' });
    const ring = fakeDef({ id: 'r', kind: 'armor', slot: 'ring' });
    const items = { c: chest, b: belt, r: ring };
    const equipment: Partial<Record<EquipSlot, string>> = { chest: 'c', waist: 'b', ring1: 'r' };
    const instances: Partial<Record<EquipSlot, ItemInstancePayload>> = { ring1: { signer: 'Aki' } };
    expect(damageWornGear(equipment, instances, 0.1, items)).toBe(true);
    expect(instances.chest).toEqual({ durability: 90 });
    expect(instances.waist?.durability).toBe(
      maxDurability(belt) - Math.round(maxDurability(belt) * 0.1),
    );
    // The ring's payload is untouched: no pool, no field.
    expect(instances.ring1).toEqual({ signer: 'Aki' });
    // Ten more deaths run the chest dry and stay at zero (a dead pool is skipped).
    for (let i = 0; i < 12; i++) damageWornGear(equipment, instances, 0.1, items);
    expect(instances.chest?.durability).toBe(0);
    expect(damageWornGear({ chest: 'c' }, { chest: { durability: 0 } }, 0.1, items)).toBe(false);
    // A tiny fraction still costs a whole point.
    const tiny: Partial<Record<EquipSlot, ItemInstancePayload>> = {};
    damageWornGear({ chest: 'c' }, tiny, 0.001, items);
    expect(tiny.chest?.durability).toBe(99);
    // Restore strips the field and drops a payload that held nothing else.
    expect(restoreWornGear(instances)).toBe(true);
    expect(instances.chest).toBeUndefined();
    expect(instances.waist).toBeUndefined();
    expect(instances.ring1).toEqual({ signer: 'Aki' });
    expect(restoreWornGear(instances)).toBe(false);
  });
});

describe('durability: the death penalty', () => {
  it('a death above level 5 takes 10% of max off every worn pooled piece, never bags or jewelry', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const slots = wornPoolSlots(sim);
    expect(slots.length).toBeGreaterThan(0);
    expect(DEATH_DURABILITY_LOSS).toBe(0.1);
    sim.addItem('wolf_fang', 3);
    const bagsBefore = JSON.stringify(sim.inventory);
    const events = killPlayer(sim);
    expect(sim.player.dead).toBe(true);
    for (const slot of slots) {
      const def = ITEMS[sim.equipment[slot] as string];
      const max = maxDurability(def);
      expect(sim.equipmentInstances[slot]?.durability, slot).toBe(max - Math.round(max * 0.1));
    }
    for (const slot of ['ring1', 'ring2', 'neck'] as const) {
      expect(sim.equipmentInstances[slot]?.durability).toBeUndefined();
    }
    expect(JSON.stringify(sim.inventory)).toBe(bagsBefore);
    // No sim-side notice: the death recap stays the one client-rendered line.
    expect(events.filter((ev) => ev.type === 'log' && ev.pid === sim.player.id)).toHaveLength(0);
  });

  it('a death at or below level 5 costs nothing', () => {
    const sim = makeSim();
    sim.setPlayerLevel(DURABILITY_LOSS_MIN_LEVEL - 1);
    expect(wornPoolSlots(sim).length).toBeGreaterThan(0);
    const events = killPlayer(sim);
    expect(sim.player.dead).toBe(true);
    for (const slot of ALL_EQUIP_SLOTS) {
      expect(sim.equipmentInstances[slot]?.durability).toBeUndefined();
    }
    expect(events.filter((ev) => ev.type === 'log' && ev.pid === sim.player.id)).toHaveLength(0);
  });

  it('an arena death is exempt, a Thornhollow Fields death is not, and the level floor holds', () => {
    // The exemption predicate both loss arms share, driven on the live
    // SimContext (the arena death routing itself needs a real match, so the
    // predicate is pinned directly rather than through a stubbed match).
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const ctx = sim.ctx;
    const p = sim.player;
    expect(durabilityLossExempt(ctx, p)).toBe(false);
    sim.arenaMatches.set(p.id, {} as never);
    expect(durabilityLossExempt(ctx, p)).toBe(true);
    sim.bgMatches.set(p.id, {} as never);
    expect(durabilityLossExempt(ctx, p)).toBe(false);
    sim.arenaMatches.delete(p.id);
    sim.bgMatches.delete(p.id);
    sim.setPlayerLevel(DURABILITY_LOSS_MIN_LEVEL - 1);
    expect(durabilityLossExempt(ctx, p)).toBe(true);
    // Both arms consult it: a Spirit Healer surcharge inside an arena writes nothing.
    sim.setPlayerLevel(10);
    sim.arenaMatches.set(p.id, {} as never);
    const meta = sim.meta(p.id)!;
    expect(applySpiritRezDurabilityLoss(ctx, meta, p)).toBe(false);
    expect(applyDeathDurabilityLoss(ctx, meta, p)).toBe(false);
    for (const slot of ALL_EQUIP_SLOTS) {
      expect(sim.equipmentInstances[slot]?.durability, slot).toBeUndefined();
    }
  });

  it('is deterministic: the same seed and deaths damage the same gear identically', () => {
    const run = () => {
      const sim = makeSim(7);
      sim.setPlayerLevel(12);
      killPlayer(sim);
      return JSON.stringify(sim.equipmentInstances);
    };
    expect(run()).toEqual(run());
  });

  it('a Spirit Healer resurrection costs a further 15% on top of the death loss', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const slots = wornPoolSlots(sim);
    killPlayer(sim);
    sim.releaseSpirit();
    expect(sim.resurrectAtSpiritHealer()).toBe(true);
    expect(SPIRIT_REZ_DURABILITY_LOSS).toBe(0.15);
    for (const slot of slots) {
      const def = ITEMS[sim.equipment[slot] as string];
      const max = maxDurability(def);
      const expected = max - Math.round(max * 0.1) - Math.round(max * 0.15);
      expect(sim.equipmentInstances[slot]?.durability, slot).toBe(Math.max(0, expected));
    }
  });

  it('the corpse run costs nothing beyond the death loss', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const slots = wornPoolSlots(sim);
    killPlayer(sim);
    const afterDeath = slots.map((s) => sim.equipmentInstances[s]?.durability);
    sim.releaseSpirit();
    const p = sim.player as AnyEntity;
    // Walk the ghost back onto its corpse and resurrect there.
    const corpse = p.corpsePos as { x: number; y: number; z: number };
    p.pos = { x: corpse.x, y: corpse.y, z: corpse.z };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    sim.resurrectAtCorpse();
    expect(p.dead).toBe(false);
    expect(slots.map((s) => sim.equipmentInstances[s]?.durability)).toEqual(afterDeath);
  });
});

describe('durability: broken gear grants nothing until repaired', () => {
  it('a worn piece at zero durability drops out of the stat derivation, and returns on repair', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const slots = wornPoolSlots(sim);
    const armored = slots.find((s) => (ITEMS[sim.equipment[s] as string].stats?.armor ?? 0) > 0);
    expect(armored, 'a worn piece with armor').toBeDefined();
    const before = sim.player.stats.armor;
    const meta = sim.meta(sim.player.id)!;
    meta.equipmentInstance[armored as EquipSlot] = { durability: 0 };
    // Re-derive through the ONE stat derivation every equip/revive runs.
    recalcPlayerStats(
      sim.player,
      meta.cls,
      meta.equipment,
      meta.talentMods,
      meta.equipmentInstance,
    );
    const broken = sim.player.stats.armor;
    expect(broken).toBeLessThan(before);
    const npc = vendorNpc(sim);
    meta.copper = 10_000_000;
    expect(sim.repairAllGear(npc.id)).toBe(true);
    expect(sim.player.stats.armor).toBe(before);
  });
});

describe('durability: a broken weapon and shield are inert too', () => {
  it('a broken mainhand swings unarmed, a broken shield blocks nothing, and repair restores both', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const meta = sim.meta(sim.player.id)!;
    const mainhandId = sim.equipment.mainhand as string;
    expect(ITEMS[mainhandId]?.weapon).toBeDefined();
    const armedMax = sim.player.weapon.max;
    expect(armedMax).toBeGreaterThan(2);
    meta.equipmentInstance.mainhand = { durability: 0 };
    recalcPlayerStats(
      sim.player,
      meta.cls,
      meta.equipment,
      meta.talentMods,
      meta.equipmentInstance,
    );
    expect(sim.player.weapon).toEqual({ min: 1, max: 2, speed: 2 });
    if (sim.equipment.offhand && ITEMS[sim.equipment.offhand]?.kind === 'armor') {
      const blockBefore = sim.player.blockChance;
      meta.equipmentInstance.offhand = { durability: 0 };
      recalcPlayerStats(
        sim.player,
        meta.cls,
        meta.equipment,
        meta.talentMods,
        meta.equipmentInstance,
      );
      expect(sim.player.blockChance).toBe(0);
      expect(blockBefore).toBeGreaterThan(0);
    }
    meta.copper = 10_000_000;
    expect(sim.repairAllGear(vendorNpc(sim).id)).toBe(true);
    expect(sim.player.weapon.max).toBe(armedMax);
  });
});

describe('durability: Repair All at a merchant', () => {
  it('charges exactly the quoted bill, strips every durability field, and logs the receipt', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    killPlayer(sim);
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    const npc = vendorNpc(sim);
    const meta = sim.meta(sim.player.id)!;
    const bill = repairAllCost(sim.equipment, sim.equipmentInstances, ITEMS);
    expect(bill).toBeGreaterThan(0);
    meta.copper = bill + 17;
    sim.tick();
    expect(sim.repairAllGear(npc.id)).toBe(true);
    const events = sim.tick();
    expect(meta.copper).toBe(17);
    for (const slot of ALL_EQUIP_SLOTS) {
      expect(sim.equipmentInstances[slot]?.durability, slot).toBeUndefined();
    }
    expect(repairAllCost(sim.equipment, sim.equipmentInstances, ITEMS)).toBe(0);
    expect(
      events.some(
        (ev) =>
          ev.type === 'log' &&
          /^Repaired all items for .+\.$/.test(ev.text) &&
          ev.pid === sim.player.id,
      ),
    ).toBe(true);
  });

  it('refuses whole when the purse is short, when nothing is damaged, and away from a merchant', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const npc = vendorNpc(sim);
    const meta = sim.meta(sim.player.id)!;
    meta.copper = 1_000_000;
    sim.tick();
    // Nothing damaged yet.
    expect(sim.repairAllGear(npc.id)).toBe(false);
    let events = sim.tick();
    expect(
      events.some(
        (ev) => ev.type === 'error' && ev.text === 'Your equipment does not need repairing.',
      ),
    ).toBe(true);
    killPlayer(sim);
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    const bill = repairAllCost(sim.equipment, sim.equipmentInstances, ITEMS);
    const before = JSON.stringify(sim.equipmentInstances);
    meta.copper = bill - 1;
    sim.tick();
    expect(sim.repairAllGear(npc.id)).toBe(false);
    events = sim.tick();
    expect(events.some((ev) => ev.type === 'error' && ev.text === 'Not enough money.')).toBe(true);
    expect(meta.copper).toBe(bill - 1);
    expect(JSON.stringify(sim.equipmentInstances)).toBe(before);
    // Not a merchant at all.
    expect(sim.repairAllGear(sim.player.id)).toBe(false);
    events = sim.tick();
    expect(
      events.some((ev) => ev.type === 'error' && ev.text === 'That merchant is not available.'),
    ).toBe(true);
  });
});

describe('durability: Repair All covers damaged copies in the bags', () => {
  it('quotes and restores an unequipped damaged piece too, and leaves its bag slot plain', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    killPlayer(sim);
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    const slot = wornPoolSlots(sim)[0];
    const itemId = sim.equipment[slot] as string;
    expect(sim.unequipItem(slot)).toBe(true);
    const meta = sim.meta(sim.player.id)!;
    const bagged = meta.inventory.find((s) => s.itemId === itemId);
    expect(bagged?.instance?.durability).toBeDefined();
    const wornOnly = repairAllCost(sim.equipment, sim.equipmentInstances, ITEMS);
    const withBags = repairAllCost(sim.equipment, sim.equipmentInstances, ITEMS, meta.inventory);
    expect(withBags).toBeGreaterThan(wornOnly);
    meta.copper = withBags;
    sim.tick();
    expect(sim.repairAllGear(vendorNpc(sim).id)).toBe(true);
    expect(meta.copper).toBe(0);
    expect(meta.inventory.find((s) => s.itemId === itemId)?.instance).toBeUndefined();
    expect(repairAllCost(sim.equipment, sim.equipmentInstances, ITEMS, meta.inventory)).toBe(0);
  });
});

describe('durability: the damaged copy travels with the piece', () => {
  it('unequipping a damaged piece carries its durability into the bags, and re-equipping brings it back', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    killPlayer(sim);
    sim.releaseSpirit();
    sim.resurrectAtSpiritHealer();
    const slot = wornPoolSlots(sim)[0];
    const itemId = sim.equipment[slot] as string;
    const worn = sim.equipmentInstances[slot]?.durability;
    expect(worn).toBeDefined();
    expect(sim.unequipItem(slot)).toBe(true);
    const bagged = sim.inventory.find(
      (s) => s.itemId === itemId && s.instance?.durability !== undefined,
    );
    expect(bagged?.instance?.durability).toBe(worn);
    sim.equipItem(itemId);
    expect(sim.equipment[slot]).toBe(itemId);
    expect(sim.equipmentInstances[slot]?.durability).toBe(worn);
  });

  it('a damaged Rift-forged worn copy survives its load-time rebuild', () => {
    // Rift gear is REBUILT on load (rift/progression.ts sanitizeRiftGearInstance);
    // a rebuild that dropped the field would hand every relog a free repair.
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const pid = sim.player.id;
    const gear = createRiftGearInstance('durability-test', 'S', 'warrior', pid);
    const meta = sim.meta(pid)!;
    // Worn directly (the load path is what this pins, not the equip verb): a
    // band carries no pool of its own, so the value is stamped on the copy to
    // prove the rebuild carries whatever the copy holds.
    const slot: EquipSlot = 'ring1';
    meta.equipment[slot] = gear.itemId;
    meta.equipmentInstance[slot] = { ...gear.instance, durability: 7 };
    const saved = sim.serializeCharacter(pid)!;
    const sim2 = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: WORLD,
    }) as AnySim;
    const pid2 = sim2.addPlayer('warrior', 'Loader', {
      state: JSON.parse(JSON.stringify(saved)),
      characterId: 1,
    });
    expect(sim2.meta(pid2)!.equipmentInstance[slot as EquipSlot]?.durability).toBe(7);
    expect(sim2.meta(pid2)!.equipmentInstance[slot as EquipSlot]?.rift).toBeDefined();
  });

  it('a damaged worn copy survives the character save round-trip', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    killPlayer(sim);
    const saved = sim.serializeCharacter(sim.player.id)!;
    const worn = Object.entries(saved.equipmentInstance ?? {}).filter(
      ([, inst]) => inst?.durability !== undefined,
    );
    expect(worn.length).toBeGreaterThan(0);
    const sim2 = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: WORLD,
    }) as AnySim;
    const pid = sim2.addPlayer('warrior', 'Loader', { state: JSON.parse(JSON.stringify(saved)) });
    const meta2 = sim2.meta(pid)!;
    for (const [slot, inst] of worn) {
      expect(meta2.equipmentInstance[slot as EquipSlot]?.durability).toBe(inst?.durability);
    }
  });
});
