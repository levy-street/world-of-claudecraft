import { describe, expect, it } from 'vitest';
import { ITEMS, MOBS } from '../src/sim/data';
import { canDualWield, canEquipItem, canEquipItemInSlot } from '../src/sim/equipment_rules';
import { expectedStatBudget, itemLevel } from '../src/sim/item_level';
import { Sim } from '../src/sim/sim';
import { ALL_CLASSES, type ItemDef, type PlayerClass } from '../src/sim/types';

// The hunter quiver ladder (issue: hunters were the one class with a
// permanently empty offhand). Held offhands equip by their literal
// requiredClass alone, which is the whole reason a hunter-only offhand needs no
// engine change: see src/sim/equipment_rules.ts canEquipItem.
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
      // rung's budget is only 2 points, which splits 1/1 and cannot be led.
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
    expect(sim.player.stats.agi).toBe(before + 9);
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
