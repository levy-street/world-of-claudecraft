import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { canEquipItem } from '../src/sim/equipment_rules';
import { ALL_CLASSES, type ItemDef } from '../src/sim/types';
import { requiredClassesForTooltip } from '../src/ui/item_class_restriction';

// Bug #1893: a druid was blocked from equipping "Fang of Korzul" (a rogue/hunter
// dagger) and a player was blocked from "Deathlord Warplate" (warrior/paladin/
// shaman mail) with no in-game explanation. Both items resolve to a recognized
// weapon-proficiency archetype / armor-weight group (equipment_rules.ts), and the
// tooltip used to hide the explicit "Requires: <classes>" line whenever that
// happened, on the mistaken assumption that the armor-weight badge or the archetype
// grouping alone made the restriction obvious. Neither actually names the eligible
// classes (and weapons have no equivalent badge at all), so the line must always
// render when the item carries a class restriction.
describe('requiredClassesForTooltip', () => {
  it('names the classes for a rogue/hunter-only weapon (Fang of Korzul)', () => {
    const item = ITEMS.fang_of_korzul;
    expect(item).toBeDefined();
    expect(canEquipItem('druid', item)).toBe(false);
    expect(requiredClassesForTooltip(item)).toEqual(['rogue', 'hunter']);
  });

  it('does not advertise Rogue for a future two-handed weapon', () => {
    const item = {
      id: 'future_greatblade',
      name: 'Future Greatblade',
      kind: 'weapon' as const,
      slot: 'mainhand' as const,
      hand: 'twohand' as const,
      weapon: { min: 20, max: 30, speed: 3.2 },
      requiredClass: ['warrior', 'rogue', 'hunter', 'shaman', 'paladin'],
      sellValue: 1,
    } satisfies ItemDef;

    expect(canEquipItem('rogue', item)).toBe(false);
    expect(requiredClassesForTooltip(item)).toEqual(['warrior', 'hunter', 'shaman', 'paladin']);
  });

  it('shows the literal enforced class list for a shield', () => {
    const item = {
      id: 'future_warrior_shield',
      name: 'Future Warrior Shield',
      kind: 'armor' as const,
      slot: 'offhand' as const,
      armorType: 'mail' as const,
      shield: true,
      requiredClass: ['warrior'],
      sellValue: 1,
    } satisfies ItemDef;

    expect(canEquipItem('paladin', item)).toBe(false);
    expect(requiredClassesForTooltip(item)).toEqual(['warrior']);
  });

  it('derives the enforced classes for unrestricted two-handed vendor weapons', () => {
    const expected = ALL_CLASSES.filter((cls) => cls !== 'rogue');
    for (const id of ['eastbrook_greatsword', 'highwatch_greatsword'] as const) {
      const item = ITEMS[id];
      expect(item.requiredClass).toBeUndefined();
      expect(canEquipItem('rogue', item)).toBe(false);
      expect(requiredClassesForTooltip(item)).toEqual(expected);
    }
  });

  it('names the classes for a warrior/paladin/shaman mail chest (Deathlord Warplate)', () => {
    const item = ITEMS.deathlord_warplate;
    expect(item).toBeDefined();
    expect(canEquipItem('mage', item)).toBe(false);
    expect(requiredClassesForTooltip(item)).toEqual(['warrior', 'paladin', 'shaman']);
  });

  it('does not claim a restriction armor does not enforce (Shadowstitch Jerkin)', () => {
    // canEquipItem short-circuits leather armor on weight: every leather AND mail
    // class can wear it, so a druid (a leather class) can equip it even though
    // requiredClass only names rogue/hunter. requiredClass here is loot-targeting
    // metadata, not an enforced restriction, so the tooltip must stay silent.
    const item = ITEMS.shadow_jerkin;
    expect(item).toBeDefined();
    expect(canEquipItem('druid', item)).toBe(true);
    expect(requiredClassesForTooltip(item)).toBeNull();
  });

  it('returns null when the item carries no class restriction', () => {
    expect(
      requiredClassesForTooltip({
        id: 'test',
        name: 'Test',
        kind: 'weapon',
        slot: 'mainhand',
        weapon: { min: 1, max: 2, speed: 2 },
        sellValue: 1,
      }),
    ).toBeNull();
  });
});

// hud.ts renders the tooltip; assert the source no longer suppresses the classes
// line for items that match a known armor-weight/weapon-archetype grouping (the
// regression), and that it renders through the new pure resolver.
describe('hud.ts item tooltip class-restriction line', () => {
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it('renders the classes line for every class-restricted item, not just narrow ones', () => {
    expect(hud).toContain('requiredClassesForTooltip(item)');
    expect(hud).not.toContain(
      'if (item.requiredClass && !armorTypeForItem(item) && !weaponArchetypeForItem(item)) {',
    );
  });
});
