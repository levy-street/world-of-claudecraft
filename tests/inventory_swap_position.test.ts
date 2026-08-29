import { describe, expect, it, vi } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { layoutBagCells } from '../src/sim/inventory_order';
import { resolveApplyEnchant } from '../src/sim/professions/enchanting';
import { Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const OLD_HELM = 'cryptbone_helm';
const NEW_HELM = 'roadwardens_helm';
const OLD_RING = 'seal_of_the_nine_oaths';
const NEW_RING = 'nielas_coldlight_band';
const ONE_HAND = 'eastbrook_arming_sword';
const TWO_HAND = 'eastbrook_greatsword';
const OFFHAND = 'eastbrook_buckler';
const OLD_BAG = 'linen_pouch';
const NEW_BAG = 'wolfhide_satchel';
const ENCHANTED_SWORD = 'eastbrook_arming_sword';
const OLD_ENCHANT = 'enchant_weapon_might';
const NEW_ENCHANT = 'enchant_weapon_agility';
const NEW_ENCHANT_DUST_COUNT = ENCHANTS[NEW_ENCHANT].reagents.find(
  (reagent) => reagent.itemId === 'arcane_dust',
)!.count;

function makeSim(): Sim {
  const sim = new Sim({ seed: 17, playerClass: 'warrior', autoEquip: false });
  sim.setPlayerLevel(20);
  sim.inventory.length = 0;
  sim.drainEvents();
  return sim;
}

function itemIds(inventory: readonly InvSlot[]): string[] {
  return inventory.map((slot) => slot.itemId);
}

function cellIds(inventory: readonly InvSlot[], capacity = 16): Array<string | null> {
  return layoutBagCells(inventory, capacity).map((slot) => slot?.itemId ?? null);
}

function swappedCells(
  before: readonly (string | null)[],
  outgoing: string,
  replacement: string,
): Array<string | null> {
  return before.map((itemId) => (itemId === outgoing ? replacement : itemId));
}

describe('inventory replacement position stability', () => {
  it('returns equipped gear to the named stack index and hinted cell', () => {
    const sim = makeSim();
    sim.equipment.helmet = OLD_HELM;
    const originalRolled = { stats: { sta: 3 } };
    sim.equipmentInstances.helmet = { signer: 'Original owner', rolled: originalRolled };
    sim.inventory.push(
      { itemId: 'baked_bread', count: 2 },
      { itemId: NEW_HELM, count: 1, slot: 9 },
      { itemId: 'spring_water', count: 2 },
    );
    const beforeOrder = itemIds(sim.inventory);
    const beforeCells = cellIds(sim.inventory);

    sim.equipItem(NEW_HELM, { slotIndex: 1 });

    expect(sim.equipment.helmet).toBe(NEW_HELM);
    expect(itemIds(sim.inventory)).toEqual([beforeOrder[0], OLD_HELM, beforeOrder[2]]);
    expect(sim.inventory[1]?.slot).toBe(9);
    expect(sim.inventory[1]?.instance?.signer).toBe('Original owner');
    expect(sim.inventory[1]?.instance?.rolled).toBe(originalRolled);
    expect(cellIds(sim.inventory)).toEqual(swappedCells(beforeCells, NEW_HELM, OLD_HELM));
  });

  it('returns craftedRecipeId-only gear at the vacated position', () => {
    const sim = makeSim();
    sim.equipment.helmet = OLD_HELM;
    sim.equipmentInstances.helmet = { craftedRecipeId: 'recipe_test_helm' };
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_HELM, count: 1, slot: 4 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.equipItem(NEW_HELM, { slotIndex: 1 });

    expect(sim.inventory[1]).toEqual({
      itemId: OLD_HELM,
      count: 1,
      craftedRecipeId: 'recipe_test_helm',
      slot: 4,
    });
  });

  it('keeps click-to-equip through useItem position-stable', () => {
    const sim = makeSim();
    sim.equipment.helmet = OLD_HELM;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_HELM, count: 1, slot: 6 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.useItem(NEW_HELM, { slotIndex: 1 });

    expect(itemIds(sim.inventory)).toEqual(['baked_bread', OLD_HELM, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(6);
  });

  it('keeps an aimed ring swap through equipItemToSlot position-stable', () => {
    const sim = makeSim();
    sim.equipment.ring2 = OLD_RING;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_RING, count: 1, slot: 11 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.equipItemToSlot(NEW_RING, 'ring2', { slotIndex: 1 });

    expect(sim.equipment.ring2).toBe(NEW_RING);
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', OLD_RING, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(11);
  });

  it('captures the newest-unit fallback position when no slot index is supplied', () => {
    const sim = makeSim();
    sim.equipment.helmet = OLD_HELM;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_HELM, count: 1, slot: 8 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.equipItem(NEW_HELM);

    expect(itemIds(sim.inventory)).toEqual(['baked_bread', OLD_HELM, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(8);
  });

  it('places the old main hand at the vacated index and appends a displaced offhand', () => {
    const sim = makeSim();
    sim.equipment.mainhand = ONE_HAND;
    sim.equipment.offhand = OFFHAND;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: TWO_HAND, count: 1, slot: 7 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.equipItem(TWO_HAND, { slotIndex: 1 });

    expect(sim.equipment.mainhand).toBe(TWO_HAND);
    expect(sim.equipment.offhand).toBeUndefined();
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', ONE_HAND, 'spring_water', OFFHAND]);
    expect(sim.inventory[1]?.slot).toBe(7);
    expect([sim.equipment.mainhand, ...itemIds(sim.inventory)].sort()).toEqual(
      [TWO_HAND, ONE_HAND, OFFHAND, 'baked_bread', 'spring_water'].sort(),
    );
  });

  it.each([
    ['named stack', true],
    ['newest stack', false],
  ] as const)('returns an occupied socket bag to the vacated %s position', (_label, named) => {
    const sim = makeSim();
    sim.bags[0] = OLD_BAG;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_BAG, count: 1, slot: 10 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.equipBag(NEW_BAG, 0, named ? { slotIndex: 1 } : undefined);

    expect(sim.bags[0]).toBe(NEW_BAG);
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', OLD_BAG, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(10);
  });

  it.each([
    ['empty socket', false, false, 2],
    ['occupied id-only socket', true, false, 2],
    ['occupied named-slot socket', true, true, 1],
  ] as const)('notifies quests for the %s arm', (_label, occupied, named, expectedCalls) => {
    const sim = makeSim();
    if (occupied) sim.bags[0] = OLD_BAG;
    sim.inventory.push({ itemId: NEW_BAG, count: 1 });
    const notify = vi.spyOn(sim.ctx, 'onInventoryChangedForQuests');

    sim.equipBag(NEW_BAG, 0, named ? { slotIndex: 0 } : undefined);

    expect(notify).toHaveBeenCalledTimes(expectedCalls);
  });

  it('appends the old bag when the id-only source stack survives consumption', () => {
    const sim = makeSim();
    sim.bags[0] = OLD_BAG;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_BAG, count: 2, slot: 10 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.equipBag(NEW_BAG, 0);

    expect(sim.inventory[1]).toEqual({ itemId: NEW_BAG, count: 1, slot: 10 });
    expect(sim.inventory.at(-1)).toEqual({ itemId: OLD_BAG, count: 1 });
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', NEW_BAG, 'spring_water', OLD_BAG]);
  });

  it('keeps a confirmed bagged enchant remint at the victim index and hint', () => {
    const sim = makeSim();
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      {
        itemId: ENCHANTED_SWORD,
        count: 1,
        slot: 12,
        instance: { enchant: OLD_ENCHANT, rolled: { stats: { str: 2 } } },
      },
      { itemId: 'spring_water', count: 1 },
      { itemId: 'arcane_dust', count: 5 },
    );

    const result = resolveApplyEnchant(
      sim.ctx,
      sim.playerId,
      ENCHANTED_SWORD,
      NEW_ENCHANT,
      undefined,
      true,
    );

    expect(result.ok).toBe(true);
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', ENCHANTED_SWORD, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(12);
    expect(sim.inventory[1]?.instance?.enchant).toBe(NEW_ENCHANT);
  });

  it.each([
    ['unhinted', undefined],
    ['hinted', 12],
  ] as const)(
    'keeps a confirmed %s enchant remint before its anchor after a lower reagent stack is spent',
    (_label, slot) => {
      const sim = makeSim();
      sim.inventory.push(
        { itemId: 'arcane_dust', count: NEW_ENCHANT_DUST_COUNT },
        { itemId: 'baked_bread', count: 1 },
        {
          itemId: ENCHANTED_SWORD,
          count: 1,
          ...(slot === undefined ? {} : { slot }),
          instance: { enchant: OLD_ENCHANT, rolled: { stats: { str: 2 } } },
        },
        { itemId: 'spring_water', count: 1 },
      );

      const result = resolveApplyEnchant(
        sim.ctx,
        sim.playerId,
        ENCHANTED_SWORD,
        NEW_ENCHANT,
        undefined,
        true,
      );

      expect(result.ok).toBe(true);
      expect(itemIds(sim.inventory)).toEqual(['baked_bread', ENCHANTED_SWORD, 'spring_water']);
      expect(sim.inventory[1]?.slot).toBe(slot);
      expect(sim.inventory[1]?.instance?.enchant).toBe(NEW_ENCHANT);
    },
  );

  it('keeps a first-time bagged enchant at the victim index and hint', () => {
    const sim = makeSim();
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: ENCHANTED_SWORD, count: 1, slot: 11 },
      { itemId: 'spring_water', count: 1 },
      { itemId: 'arcane_dust', count: 5 },
    );

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, ENCHANTED_SWORD, NEW_ENCHANT);

    expect(result.ok).toBe(true);
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', ENCHANTED_SWORD, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(11);
    expect(sim.inventory[1]?.instance?.enchant).toBe(NEW_ENCHANT);
  });

  it('keeps a first-time instanced enchant at the victim index and hint', () => {
    const sim = makeSim();
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      {
        itemId: ENCHANTED_SWORD,
        count: 1,
        slot: 11,
        instance: { signer: 'Crafter', rolled: { masterwork: true, stats: { str: 2 } } },
      },
      { itemId: 'spring_water', count: 1 },
      { itemId: 'arcane_dust', count: 5 },
    );

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, ENCHANTED_SWORD, NEW_ENCHANT);

    expect(result.ok).toBe(true);
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', ENCHANTED_SWORD, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(11);
    expect(sim.inventory[1]?.instance).toMatchObject({
      enchant: NEW_ENCHANT,
      signer: 'Crafter',
      rolled: { masterwork: true },
    });
  });

  it.each([
    ['plain', undefined],
    ['instanced', { signer: 'Crafter', rolled: { masterwork: true, stats: { str: 2 } } }],
  ] as const)(
    'keeps a first-time %s enchant before its anchor after a lower reagent stack is spent',
    (_label, instance) => {
      const sim = makeSim();
      sim.inventory.push(
        { itemId: 'arcane_dust', count: NEW_ENCHANT_DUST_COUNT },
        { itemId: 'baked_bread', count: 1 },
        {
          itemId: ENCHANTED_SWORD,
          count: 1,
          slot: 11,
          ...(instance === undefined ? {} : { instance }),
        },
        { itemId: 'spring_water', count: 1 },
      );

      const result = resolveApplyEnchant(sim.ctx, sim.playerId, ENCHANTED_SWORD, NEW_ENCHANT);

      expect(result.ok).toBe(true);
      expect(itemIds(sim.inventory)).toEqual(['baked_bread', ENCHANTED_SWORD, 'spring_water']);
      expect(sim.inventory[1]?.slot).toBe(11);
      expect(sim.inventory[1]?.instance).toMatchObject({
        enchant: NEW_ENCHANT,
        ...(instance === undefined ? {} : { signer: 'Crafter', rolled: { masterwork: true } }),
      });
    },
  );

  it('keeps the existing compaction when equipment has no returned item', () => {
    const sim = makeSim();
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_HELM, count: 1, slot: 9 },
      { itemId: 'spring_water', count: 1 },
    );

    sim.equipItem(NEW_HELM, { slotIndex: 1 });

    expect(itemIds(sim.inventory)).toEqual(['baked_bread', 'spring_water']);
    expect(sim.inventory.every((slot) => slot.slot !== 9)).toBe(true);
  });

  it('keeps every other derived cell fixed in an unhinted mixed bag', () => {
    const sim = makeSim();
    sim.equipment.helmet = OLD_HELM;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1, slot: 5 },
      { itemId: NEW_HELM, count: 1 },
      { itemId: 'spring_water', count: 1 },
      { itemId: 'minor_healing_potion', count: 1, slot: 8 },
    );
    const beforeCells = cellIds(sim.inventory);

    sim.equipItem(NEW_HELM, { slotIndex: 1 });

    expect(cellIds(sim.inventory)).toEqual(swappedCells(beforeCells, NEW_HELM, OLD_HELM));
    expect(sim.inventory[1]?.slot).toBeUndefined();
  });

  it('inherits the same replacement position through a gear loadout swap', () => {
    const sim = makeSim();
    sim.equipment.helmet = NEW_HELM;
    const saved = sim.saveLoadout('Stable bags', [], sim.playerId, undefined, true);
    expect(saved).toBeGreaterThanOrEqual(0);
    sim.equipment.helmet = OLD_HELM;
    sim.inventory.push(
      { itemId: 'baked_bread', count: 1 },
      { itemId: NEW_HELM, count: 1, slot: 13 },
      { itemId: 'spring_water', count: 1 },
    );

    expect(sim.switchLoadout(saved)).toBe(true);

    expect(sim.equipment.helmet).toBe(NEW_HELM);
    expect(itemIds(sim.inventory)).toEqual(['baked_bread', OLD_HELM, 'spring_water']);
    expect(sim.inventory[1]?.slot).toBe(13);
  });
});
