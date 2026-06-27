import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { equippableClasses, PLAYER_CLASSES } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';

function equip(cls: Parameters<Sim['addPlayer']>[0], itemId: string) {
  const sim = new Sim({ seed: 42, playerClass: cls, noPlayer: true, autoEquip: false });
  const pid = sim.addPlayer(cls, `${cls}-${itemId}`);
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
    expect(equip('rogue', 'kingsbane_last_oath').equipment.mainhand).toBe('kingsbane_last_oath');
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

describe('equippableClasses (tooltip "who can use this" source)', () => {
  it('resolves a warrior-archetype weapon to all five physical classes (not just its requiredClass)', () => {
    // Kingsbane lists only warrior/paladin, but the warrior weapon archetype
    // also covers rogue/hunter/shaman - the tooltip must show the real set.
    expect(equippableClasses(ITEMS.kingsbane_last_oath).sort()).toEqual(
      ['hunter', 'paladin', 'rogue', 'shaman', 'warrior'].sort(),
    );
  });

  it('resolves mail armor to the mail classes only', () => {
    expect(equippableClasses(ITEMS.crownforged_dreadhelm).sort()).toEqual(
      ['paladin', 'shaman', 'warrior'].sort(),
    );
  });

  it('treats cloth armor as unrestricted (every class can wear cloth)', () => {
    expect(equippableClasses(ITEMS.soulflame_cowl)).toHaveLength(PLAYER_CLASSES.length);
  });

  it('leaves non-equippable items unrestricted', () => {
    // Food has no slot and no requiredClass: every class "can equip" it.
    expect(equippableClasses(ITEMS.trail_hardtack)).toHaveLength(PLAYER_CLASSES.length);
  });
});

describe('Kingsbane carries Agility for its rogue/hunter wielders', () => {
  it('has +24 Agility alongside its Strength and Stamina', () => {
    expect(ITEMS.kingsbane_last_oath.stats).toMatchObject({ str: 24, sta: 20, agi: 24 });
  });

  it('a hunter can still equip it (warrior weapon archetype)', () => {
    expect(equip('hunter', 'kingsbane_last_oath').equipment.mainhand).toBe('kingsbane_last_oath');
  });
});
