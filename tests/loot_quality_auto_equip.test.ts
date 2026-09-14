import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { lootQualityBonuses } from '../src/sim/loot_quality';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';

const quality = (tier: 1 | 2 | 3 | 4): ItemInstancePayload => ({
  lootQuality: { version: 1, tier, weights: [500, 200, 300, 400, 100] },
});

describe('quality loot auto equip', () => {
  it('compares resolved armor and retains the higher tier when another ordinary copy arrives', () => {
    const item = Object.values(ITEMS).find(
      (i) =>
        i.kind === 'armor' &&
        i.armorType === 'leather' &&
        i.slot === 'chest' &&
        i.quality === 'rare' &&
        !i.requiredClass &&
        lootQualityBonuses(i, quality(4)).armor > 0,
    )!;
    const sim = new Sim({ seed: 76, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.addItem(item.id, 1);
    expect(sim.equipment.chest).toBe(item.id);
    sim.addItemInstance(item.id, quality(4));
    expect(sim.player.equippedInstances.chest?.lootQuality?.tier).toBe(4);
    sim.addItem(item.id, 1);
    sim.addItemInstance(item.id, quality(1));
    expect(sim.player.equippedInstances.chest?.lootQuality?.tier).toBe(4);
  });
  it('equips an enhanced weapon into an empty slot', () => {
    const sim = new Sim({ seed: 73, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.unequipItem('mainhand');
    sim.addItemInstance('duskwhisper', quality(2));
    expect(sim.equipment.mainhand).toBe('duskwhisper');
    expect(sim.player.equippedInstances.mainhand?.lootQuality?.tier).toBe(2);
  });

  it('selects the newly granted exact tier among copies and keeps the better worn copy', () => {
    const sim = new Sim({ seed: 74, playerClass: 'rogue', autoEquip: false });
    sim.setPlayerLevel(20);
    sim.addItemInstance('duskwhisper', quality(1));
    sim.equipItem('duskwhisper', undefined, 'mainhand');
    sim.addItemInstance('duskwhisper', quality(4));
    sim.addItemInstance('duskwhisper', quality(2));
    sim.players.get(sim.playerId)!.autoEquip = true;
    // Identical descriptor coalesces with an EARLIER tier-IV row, while the
    // newest row is tier II. Id-only equip would consume the wrong copy.
    sim.addItemInstance('duskwhisper', quality(4));
    expect(sim.player.equippedInstances.mainhand?.lootQuality?.tier).toBe(4);
    expect(
      sim.inventory.filter(
        (s) => s.itemId === 'duskwhisper' && s.instance?.lootQuality?.tier === 2,
      ),
    ).toHaveLength(1);
    sim.addItemInstance('duskwhisper', quality(1));
    sim.addItem('duskwhisper', 1);
    expect(sim.player.equippedInstances.mainhand?.lootQuality?.tier).toBe(4);
  });

  it('keeps ordinary auto equip and non-quality crafted grant behavior', () => {
    const sim = new Sim({ seed: 75, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.unequipItem('mainhand');
    sim.addItem('duskwhisper', 1);
    expect(sim.equipment.mainhand).toBe('duskwhisper');
    sim.addItemInstance('heroic_duskwhisper', {
      signer: 'Artisan',
      rolled: { masterwork: true, stats: { str: 1 } },
    });
    expect(sim.equipment.mainhand).toBe('duskwhisper');
  });
});
