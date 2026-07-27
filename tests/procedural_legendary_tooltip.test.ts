import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { ItemInstancePayload, PlayerClass } from '../src/sim/types';
import { ItemPresentationController } from '../src/ui/item_presentation_controller';

function tooltip(baseId: string, playerClass: PlayerClass, instance: ItemInstancePayload): string {
  const item = ITEMS[baseId];
  if (!item) throw new Error(`missing test item ${baseId}`);
  const controller = new ItemPresentationController({
    items: ITEMS,
    playerClass: () => playerClass,
    playerLevel: () => 20,
    showItemLevel: () => false,
    equippedItemId: () => undefined,
    equippedInstance: () => undefined,
    equippedItemIds: () => [],
  });
  return controller.tooltip(item, false, instance);
}

function legendary(
  baseId: string,
  itemLevel: number,
  powerId: string,
  rolls: Record<string, number>,
): ItemInstancePayload {
  return {
    procedural: {
      version: 1,
      uid: `realm:tooltip:${powerId}`,
      baseId,
      itemLevel,
      rarity: 'legendary',
      affixes: [],
      legendaryPowerId: powerId,
      powerRevision: 1,
      legendaryRolls: rolls,
      generatedName: { baseId },
      seed: 17,
    },
  };
}

describe('item-level-scaled Legendary tooltip', () => {
  it('renders a fractional percent value and its exact accessible range', () => {
    const html = tooltip(
      'iron_broadsword',
      'warrior',
      legendary('iron_broadsword', 10, 'greyjaws_edge', { potencyPct: 39 }),
    );

    expect(html).toContain('Power roll: 19.5%');
    expect(html).toContain('aria-label="Possible roll from 19 to 20"');
    expect(html).toContain('> [19-20%]</span>');
    expect(html).not.toContain('Power roll: 20%');
  });

  it('renders fractional flat resource without rounding it into a stronger item', () => {
    const html = tooltip(
      'gravecaller_pendant',
      'druid',
      legendary('gravecaller_pendant', 6, 'feral_moonclasp', { resource: 5 }),
    );

    expect(html).toContain('Power roll: 1.5 resource');
    expect(html).toContain('aria-label="Possible roll from 1.2 to 2.1"');
    expect(html).toContain('> [1.2-2.1]</span>');
    expect(html).not.toContain('Power roll: 2 resource');
  });
});
