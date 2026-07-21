import { describe, expect, it } from 'vitest';
import { CLASSES, ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';

const ALL_CLASSES = Object.keys(CLASSES) as PlayerClass[];

function equip(cls: Parameters<Sim['addPlayer']>[0], itemId: string) {
  const sim = new Sim({ seed: 42, playerClass: cls, noPlayer: true, autoEquip: false });
  const pid = sim.addPlayer(cls, `${cls}-${itemId}`);
  // Max level so the per-quality level gate (item_level_req.ts) never fires:
  // these cases test CLASS/armor proficiency in isolation, not the level gate.
  sim.setPlayerLevel(20, pid);
  sim.addItem(itemId, 1, pid);
  sim.equipItem(itemId, pid);
  return sim.meta(pid)!;
}

describe('armor proficiencies', () => {
  it('allows mail classes to equip mail, leather, and cloth armor', () => {
    expect(equip('shaman', 'stormcallers_crown').equipment.helmet).toBe('stormcallers_crown');
    expect(equip('shaman', 'nighttalon_crown').equipment.helmet).toBe('nighttalon_crown');
    expect(equip('shaman', 'soulflame_cowl').equipment.helmet).toBe('soulflame_cowl');
  });

  it('allows leather classes to equip leather and cloth armor but not mail armor', () => {
    expect(equip('druid', 'nighttalon_crown').equipment.helmet).toBe('nighttalon_crown');
    expect(equip('druid', 'soulflame_cowl').equipment.helmet).toBe('soulflame_cowl');
    expect(equip('druid', 'crownforged_dreadhelm').equipment.helmet).toBeUndefined();
  });

  it('keeps cloth classes restricted to cloth armor', () => {
    expect(equip('priest', 'soulflame_cowl').equipment.helmet).toBe('soulflame_cowl');
    expect(equip('priest', 'nighttalon_crown').equipment.helmet).toBeUndefined();
    expect(equip('priest', 'crownforged_dreadhelm').equipment.helmet).toBeUndefined();
  });

  it('allows warrior-style weapons for warriors, rogues, hunters, shamans, and paladins', () => {
    expect(equip('warrior', 'kingsbane_last_oath').equipment.mainhand).toBe('kingsbane_last_oath');
    const rogue = equip('rogue', 'kingsbane_last_oath').equipment;
    expect(rogue.mainhand).toBe('rusty_dagger');
    expect(rogue.offhand).toBe('kingsbane_last_oath');
    expect(equip('hunter', 'kingsbane_last_oath').equipment.mainhand).toBe('kingsbane_last_oath');
    expect(equip('shaman', 'kingsbane_last_oath').equipment.mainhand).toBe('kingsbane_last_oath');
    expect(equip('paladin', 'kingsbane_last_oath').equipment.mainhand).toBe('kingsbane_last_oath');
    expect(equip('mage', 'kingsbane_last_oath').equipment.mainhand).not.toBe('kingsbane_last_oath');
  });

  it('allows caster weapons for caster and hybrid classes', () => {
    expect(equip('mage', 'staff_of_the_gravewyrm').equipment.mainhand).toBe(
      'staff_of_the_gravewyrm',
    );
    expect(equip('priest', 'staff_of_the_gravewyrm').equipment.mainhand).toBe(
      'staff_of_the_gravewyrm',
    );
    expect(equip('warlock', 'staff_of_the_gravewyrm').equipment.mainhand).toBe(
      'staff_of_the_gravewyrm',
    );
    expect(equip('shaman', 'staff_of_the_gravewyrm').equipment.mainhand).toBe(
      'staff_of_the_gravewyrm',
    );
    expect(equip('paladin', 'staff_of_the_gravewyrm').equipment.mainhand).toBe(
      'staff_of_the_gravewyrm',
    );
    expect(equip('druid', 'staff_of_the_gravewyrm').equipment.mainhand).toBe(
      'staff_of_the_gravewyrm',
    );
    expect(equip('warrior', 'staff_of_the_gravewyrm').equipment.mainhand).not.toBe(
      'staff_of_the_gravewyrm',
    );
  });
});

describe('weapon requiredClass is representative of who can equip', () => {
  // The whole point of the field: a weapon's requiredClass must list exactly the
  // classes that can actually equip it, not an archetype-signature subset. Guards
  // every weapon at once, so a future archetype weapon authored with the short
  // form (e.g. ['warrior','paladin']) fails here until it lists the full group.
  it('lists exactly the classes canEquipItem allows, for every weapon with a class list', () => {
    for (const item of Object.values(ITEMS)) {
      if (item.kind !== 'weapon' || !item.requiredClass) continue;
      const equippable = ALL_CLASSES.filter((c) => canEquipItem(c, item)).sort();
      const listed = [...item.requiredClass].sort();
      expect(listed, `${item.id}: requiredClass must match its equippable classes`).toEqual(
        equippable,
      );
    }
  });
});
