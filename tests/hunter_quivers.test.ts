import { describe, expect, it } from 'vitest';
import { ITEMS, MOBS } from '../src/sim/data';
import {
  canDualWield,
  canEquipItem,
  canEquipItemInSlot,
  displacedSlotForEquip,
  occupiesHand,
} from '../src/sim/equipment_rules';
import {
  expectedStatBudget,
  itemLevel,
  primaryStatBudget,
  SLOT_STAT_MULT,
  TWOHAND_STAT_MULT,
  WORN_OFFHAND_STAT_MULT,
} from '../src/sim/item_level';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type ItemDef, type PlayerClass } from '../src/sim/types';

// The hunter quiver ladder (issue: hunters were the one class with a
// permanently empty offhand). Held offhands equip by their literal
// requiredClass alone, which is what lets a hunter-only offhand work without
// touching canEquipItem: see src/sim/equipment_rules.ts. The DISPLACEMENT rule
// is a separate question that the original change missed; see the two-hander
// block at the bottom of this file.
const QUIVERS = [
  'moggers_hide_quiver',
  'cragmaw_huntquiver',
  'gravewyrm_bone_quiver',
  'direfang_quiver',
] as const;

const primaryStatSum = (item: ItemDef): number => {
  const s = item.stats ?? {};
  return (s.str ?? 0) + (s.agi ?? 0) + (s.sta ?? 0) + (s.int ?? 0) + (s.spi ?? 0);
};

describe('hunter quivers', () => {
  it('declares every quiver as a hunter-locked held offhand', () => {
    for (const id of QUIVERS) {
      const item = ITEMS[id];
      expect(item, id).toBeDefined();
      expect(item.kind, id).toBe('held_offhand');
      expect(item.slot, id).toBe('offhand');
      expect(item.requiredClass, id).toEqual(['hunter']);
      // A held offhand carries no armor weight: setting one would put it under
      // the armor-class filter rules it is deliberately outside of.
      expect((item as { armorType?: unknown }).armorType, id).toBeUndefined();
      expect((item as { weapon?: unknown }).weapon, id).toBeUndefined();
    }
  });

  it('lets a hunter equip every quiver in the offhand and no other class equip any', () => {
    for (const id of QUIVERS) {
      const item = ITEMS[id];
      expect(canEquipItem('hunter', item), `hunter ${id}`).toBe(true);
      expect(canEquipItemInSlot('hunter', item, 'offhand'), `hunter offhand ${id}`).toBe(true);
      for (const cls of ALL_CLASSES.filter((c) => c !== 'hunter')) {
        expect(canEquipItem(cls, item), `${cls} ${id}`).toBe(false);
        expect(canEquipItemInSlot(cls, item, 'offhand'), `${cls} offhand ${id}`).toBe(false);
      }
    }
  });

  it('refuses a quiver in every slot other than the offhand, hunter included', () => {
    const item = ITEMS.direfang_quiver;
    for (const slot of ['mainhand', 'helmet', 'chest', 'ring1', 'neck'] as const) {
      expect(canEquipItemInSlot('hunter', item, slot), slot).toBe(false);
    }
  });

  it('does not give the hunter a dual-wield path as a side effect', () => {
    // The quiver fills the slot through the held_offhand branch only. If this
    // ever flips, a hunter could put a WEAPON in the offhand, which is a
    // different (and unintended) buff.
    expect(canDualWield('hunter')).toBe(false);
    expect(canDualWield('hunter', 'marksmanship')).toBe(false);
    expect(canEquipItemInSlot('hunter', ITEMS.keen_dirk, 'offhand')).toBe(false);
  });

  it('puts every quiver exactly on its tier stat budget', () => {
    for (const id of QUIVERS) {
      const item = ITEMS[id];
      const agi = item.stats?.agi ?? 0;
      const sta = item.stats?.sta ?? 0;
      expect(primaryStatSum(item), `${id} budget`).toBe(expectedStatBudget(item));
      // Hunter identity: agility-led, stamina second, nothing else. The opening
      // rung's worn budget is a single point, so it is agility alone.
      expect(agi, `${id} agi`).toBeGreaterThanOrEqual(sta);
      if (primaryStatSum(item) > 2) expect(agi, `${id} agi lead`).toBeGreaterThan(sta);
      expect(item.stats?.int ?? 0, `${id} int`).toBe(0);
      expect(item.stats?.str ?? 0, `${id} str`).toBe(0);
    }
  });

  it('ladders the four quivers up by item level and quality', () => {
    const levels = QUIVERS.map((id) => itemLevel(ITEMS[id]));
    expect(levels).toEqual([7, 17, 23, 29]);
    // Two rare rungs on purpose: each quiver matches the tier of the table it
    // drops from, and Cragmaw's own gear line is rare.
    expect(QUIVERS.map((id) => ITEMS[id].quality)).toEqual(['uncommon', 'rare', 'rare', 'epic']);
    // Strictly increasing, so no rung is a sidegrade of the one below it.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!, QUIVERS[i]).toBeGreaterThan(levels[i - 1]!);
    }
  });

  it('carries the physical-DPS rating only on the raid epic', () => {
    // Matches the nighttalon leather set: Hit is the physical throughput
    // rating, and the sub-epic rungs seed no rating at all.
    expect(ITEMS.direfang_quiver.hitRating).toBe(20);
    expect(ITEMS.moggers_hide_quiver.hitRating ?? 0).toBe(0);
    expect(ITEMS.cragmaw_huntquiver.hitRating ?? 0).toBe(0);
    expect(ITEMS.gravewyrm_bone_quiver.hitRating ?? 0).toBe(0);
  });

  it('sources each quiver from a distinct live loot table', () => {
    const sources: Record<string, string> = {
      moggers_hide_quiver: 'mogger',
      cragmaw_huntquiver: 'old_cragmaw',
      gravewyrm_bone_quiver: 'korzul_the_gravewyrm',
      direfang_quiver: 'nythraxis_scourge_of_thornpeak',
    };
    for (const [itemId, mobId] of Object.entries(sources)) {
      const loot = MOBS[mobId]?.loot ?? [];
      expect(
        loot.some((entry) => entry.itemId === itemId),
        `${mobId} drops ${itemId}`,
      ).toBe(true);
    }
    expect(new Set(Object.values(sources)).size).toBe(4);
  });

  it('keeps the caster offhand line untouched at the shared Mogger source', () => {
    // The quiver rides its own independent roll beside the lantern, so adding it
    // must not have changed the caster's odds.
    const loot = MOBS.mogger.loot ?? [];
    const lantern = loot.find((e) => e.itemId === 'valefire_lantern');
    const quiver = loot.find((e) => e.itemId === 'moggers_hide_quiver');
    expect(lantern?.chance).toBe(0.2);
    expect(quiver?.chance).toBe(0.2);
    expect(lantern?.rollGroup).toBeUndefined();
    expect(quiver?.rollGroup).toBeUndefined();
  });

  it('equips through the real sim path and lands the stats on the player', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: false });
    const pid = sim.player.id;
    // The epic rung derives a required level from its quality; wear it at cap so
    // the level gate is not what is under test here.
    sim.setPlayerLevel(20);
    const before = sim.player.stats.agi;

    sim.addItem('direfang_quiver', 1, pid);
    sim.equipItem('direfang_quiver', pid);

    expect(sim.equipment.offhand).toBe('direfang_quiver');
    // recalcPlayerStats is the one place gear reaches the entity; the offhand
    // slot was previously dead weight for this class.
    expect(sim.player.stats.agi).toBe(before + 5);
    // A quiver is not a weapon: it must never light up the dual-wield path.
    expect(sim.player.dualWielding).toBe(false);
    expect(sim.player.offhandWeapon).toBeNull();
    // It is still an offhand the renderer is told about.
    expect(sim.player.offhandItemId).toBe('direfang_quiver');
  });

  it('refuses the quiver on a non-hunter through the real sim path', () => {
    const sim = new Sim({ seed: 7, playerClass: 'rogue', autoEquip: false });
    const pid = sim.player.id;
    sim.setPlayerLevel(20);
    sim.addItem('direfang_quiver', 1, pid);
    sim.equipItem('direfang_quiver', pid);
    expect(sim.equipment.offhand).not.toBe('direfang_quiver');
  });

  it('survives a save/load round trip in the offhand slot', () => {
    const sim = new Sim({ seed: 11, playerClass: 'hunter', autoEquip: false });
    const pid = sim.player.id;
    sim.setPlayerLevel(20);
    sim.addItem('gravewyrm_bone_quiver', 1, pid);
    sim.equipItem('gravewyrm_bone_quiver', pid);

    const state = sim.serializeCharacter(pid)!;
    expect(state.equipment.offhand).toBe('gravewyrm_bone_quiver');

    const reloaded = new Sim({ seed: 11, playerClass: 'hunter', noPlayer: true });
    const newPid = reloaded.addPlayer('hunter', 'Fletcher', { state });
    expect(reloaded.serializeCharacter(newPid)!.equipment.offhand).toBe('gravewyrm_bone_quiver');
    // And the reloaded character actually wears it (stats re-derived on load).
    expect(reloaded.entities.get(newPid)!.offhandItemId).toBe('gravewyrm_bone_quiver');
  });
});

describe('hunter offhand parity', () => {
  it('leaves no class without a reachable offhand item', () => {
    // The premise of the change: before the quivers, hunter was the only class
    // for which this set was empty, so its offhand stat budget was uncollectable.
    const offhandItems = Object.values(ITEMS).filter(
      (item) => item.slot === 'offhand' && !item.heroicOf,
    );
    const classesWithAnOffhand = new Set<PlayerClass>();
    for (const item of offhandItems) {
      for (const cls of ALL_CLASSES) {
        if (canEquipItemInSlot(cls, item, 'offhand')) classesWithAnOffhand.add(cls);
      }
    }
    // Dual wielders reach the slot with weapons rather than an offhand-slot
    // item, so credit them the same way the equip rules do.
    for (const cls of ALL_CLASSES) {
      if (canDualWield(cls, 'fury') || canDualWield(cls)) classesWithAnOffhand.add(cls);
    }
    expect([...ALL_CLASSES].filter((c) => !classesWithAnOffhand.has(c))).toEqual([]);
    expect(classesWithAnOffhand.has('hunter')).toBe(true);
  });
});

// The case PR #2930 never wrote, and the bug that shipped because of it: every
// equip test above starts from an EMPTY mainhand, so nothing exercised the
// two-hand/offhand exclusion. A hunter can equip 14 different two-handers, so
// wearing one and then equipping a quiver silently benched the weapon.
describe('a worn quiver coexists with a two-hander', () => {
  const lookup = (id: string) => ITEMS[id];

  it('displaces nothing when a quiver goes on over a two-handed mainhand', () => {
    for (const id of QUIVERS) {
      expect(
        displacedSlotForEquip(
          ITEMS[id],
          'offhand',
          { mainhand: 'direfang_greatblade' },
          lookup,
          'hunter',
          'marksmanship',
        ),
        id,
      ).toBeNull();
    }
  });

  it('displaces nothing when a two-hander goes on over a worn quiver', () => {
    // The mirror of the case above. Same rule, opposite direction: easy to fix
    // one arm and leave the other, which would just move the bug.
    for (const id of QUIVERS) {
      expect(
        displacedSlotForEquip(
          ITEMS.direfang_greatblade,
          'mainhand',
          { offhand: id },
          lookup,
          'hunter',
          'marksmanship',
        ),
        id,
      ).toBeNull();
    }
  });

  it('keeps the exclusion for every offhand that is actually HELD', () => {
    // The fix is "does this take a hand", not "is this a hunter". A caster orb,
    // a lantern and a shield are all held, so they still bench a two-hander and
    // are still benched by one.
    for (const [id, cls] of [
      ['wraithfire_orb', 'mage'],
      ['valefire_lantern', 'mage'],
      ['bonewrought_bulwark', 'warrior'],
    ] as const) {
      expect(occupiesHand(ITEMS[id]), id).toBe(true);
      expect(
        displacedSlotForEquip(
          ITEMS[id],
          'offhand',
          { mainhand: 'bonewrought_greatsword' },
          lookup,
          cls,
          null,
        ),
        `${id} over 2H`,
      ).toBe('mainhand');
      expect(
        displacedSlotForEquip(
          ITEMS.bonewrought_greatsword,
          'mainhand',
          { offhand: id },
          lookup,
          cls,
          null,
        ),
        `2H over ${id}`,
      ).toBe('offhand');
    }
  });

  it('marks the quivers worn and every other offhand held', () => {
    for (const id of QUIVERS) expect(occupiesHand(ITEMS[id]), id).toBe(false);
    const heldOffhands = Object.values(ITEMS).filter(
      (item) => item.slot === 'offhand' && !occupiesHand(item),
    );
    // Quivers (and their heroic clones) are the ONLY worn offhands today. A new
    // one landing here without a deliberate budget decision is the regression
    // this pins against.
    expect(heldOffhands.map((item) => item.id).sort()).toEqual([
      'cragmaw_huntquiver',
      'direfang_quiver',
      'gravewyrm_bone_quiver',
      'heroic_direfang_quiver',
      'heroic_gravewyrm_bone_quiver',
      'moggers_hide_quiver',
    ]);
  });

  it('wears a two-hander and a quiver together through the real sim path', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: false });
    const pid = sim.player.id;
    sim.setPlayerLevel(20);
    const baseAgi = sim.player.stats.agi;

    sim.addItem('direfang_greatblade', 1, pid);
    sim.addItem('direfang_quiver', 1, pid);
    sim.equipItem('direfang_greatblade', pid);
    sim.equipItem('direfang_quiver', pid);

    // Both worn at once: the reported bug was the mainhand going empty here.
    expect(sim.equipment.mainhand).toBe('direfang_greatblade');
    expect(sim.equipment.offhand).toBe('direfang_quiver');
    // And both sets of stats actually reach the entity (14 + 5 agility).
    expect(sim.player.stats.agi).toBe(baseAgi + 19);
    // Still not a dual wield: the quiver is worn, not a second weapon.
    expect(sim.player.dualWielding).toBe(false);
    expect(sim.player.offhandWeapon).toBeNull();
  });

  it('wears them together in the opposite equip order too', () => {
    const sim = new Sim({ seed: 7, playerClass: 'hunter', autoEquip: false });
    const pid = sim.player.id;
    sim.setPlayerLevel(20);

    sim.addItem('direfang_quiver', 1, pid);
    sim.addItem('direfang_greatblade', 1, pid);
    sim.equipItem('direfang_quiver', pid);
    sim.equipItem('direfang_greatblade', pid);

    expect(sim.equipment.mainhand).toBe('direfang_greatblade');
    expect(sim.equipment.offhand).toBe('direfang_quiver');
  });

  it('still benches a hunter two-hander for a HELD offhand through the sim', () => {
    // The negative arm through the real path: hunters have no held offhand of
    // their own, so borrow the rule directly. A shield-wearing warrior loses the
    // greatsword exactly as before this change.
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const pid = sim.player.id;
    sim.setPlayerLevel(20);
    sim.addItem('bonewrought_greatsword', 1, pid);
    sim.addItem('bonewrought_bulwark', 1, pid);
    sim.equipItem('bonewrought_greatsword', pid);
    sim.equipItem('bonewrought_bulwark', pid);

    expect(sim.equipment.offhand).toBe('bonewrought_bulwark');
    expect(sim.equipment.mainhand).toBeUndefined();
  });
});

describe('worn offhand budget', () => {
  it('keeps a two-hander plus a worn offhand inside the slot-weight ceiling', () => {
    // THE invariant this change had to respect. item_budget.ts guarantees that a
    // two-hander never out-stats a mainhand + offhand pairing of the same item
    // level. A worn offhand is the first item that stacks WITH a two-hander, so
    // the two weights together are what must stay inside the ceiling, not the
    // two-hander alone. Priced at the held offhand's 0.75 this would read 2.05.
    expect(TWOHAND_STAT_MULT + WORN_OFFHAND_STAT_MULT).toBeLessThanOrEqual(
      SLOT_STAT_MULT.mainhand + SLOT_STAT_MULT.offhand,
    );
    // And a worn offhand is strictly cheaper than the held one it shares a slot
    // with, which is the whole reason it is allowed to coexist.
    expect(WORN_OFFHAND_STAT_MULT).toBeLessThan(SLOT_STAT_MULT.offhand);
  });

  it('prices each quiver on the worn line, below the held offhand of its tier', () => {
    // Same slot, same item level, same quality as the caster orb, lower budget:
    // the orb costs you the two-hander and the quiver does not.
    expect(itemLevel(ITEMS.direfang_quiver)).toBe(itemLevel(ITEMS.wraithfire_orb));
    expect(ITEMS.direfang_quiver.quality).toBe(ITEMS.wraithfire_orb.quality);
    expect(primaryStatSum(ITEMS.direfang_quiver)).toBe(9);
    expect(primaryStatSum(ITEMS.wraithfire_orb)).toBe(15);
    expect(QUIVERS.map((id) => primaryStatSum(ITEMS[id]))).toEqual([1, 4, 6, 9]);
  });

  it('carries the worn line into the generated heroic clones', () => {
    // heroic_variants.ts re-derives stats from the budget, so a clone that
    // skipped slotStatMultForItem would quietly re-inflate to the held line.
    for (const id of ['heroic_gravewyrm_bone_quiver', 'heroic_direfang_quiver']) {
      const item = ITEMS[id];
      expect(item, id).toBeDefined();
      expect(occupiesHand(item), id).toBe(false);
      expect(primaryStatSum(item), id).toBe(expectedStatBudget(item));
      expect(primaryStatSum(item), `${id} below held line`).toBeLessThan(
        primaryStatBudget(itemLevel(item)!, item.quality, 'offhand'),
      );
    }
  });
});
