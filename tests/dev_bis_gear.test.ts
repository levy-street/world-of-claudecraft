import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { bestEpicGearFor, equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { canEquipItemInSlot } from '../src/sim/equipment_rules';
import { Sim } from '../src/sim/sim';
import type { EquipSlot } from '../src/sim/types';

// /dev bis: the one-shot best-in-slot outfit for level-cap playtesting.

describe('dev bis gear', () => {
  it('picks a legal epic for every coverable slot, deterministically', () => {
    const first = bestEpicGearFor('rogue', 'assassination');
    const second = bestEpicGearFor('rogue', 'assassination');
    expect(second).toEqual(first);
    const entries = Object.entries(first) as [EquipSlot, string][];
    expect(entries.length).toBeGreaterThanOrEqual(8);
    for (const [slot, id] of entries) {
      const item = ITEMS[id];
      expect(item?.quality).toBe('epic');
      expect(canEquipItemInSlot('rogue', item, slot, 'assassination')).toBe(true);
    }
    // No duplicate piece across slots (ring1/ring2 must differ).
    expect(new Set(entries.map(([, id]) => id)).size).toBe(entries.length);
  });

  it('gives dagger specs a dagger mainhand and dual-wields two one-handers', () => {
    // A spec-less rogue must also get a dagger (Craven Thrust and the openers
    // require one; only committed Thuggery trades it away).
    const specless = bestEpicGearFor('rogue', null);
    const speclessMh = ITEMS[specless.mainhand ?? ''];
    expect(speclessMh?.kind === 'weapon' && speclessMh.weapon?.dagger === true).toBe(true);
    const knifework = bestEpicGearFor('rogue', 'assassination');
    const knifeMh = ITEMS[knifework.mainhand ?? ''];
    expect(knifeMh?.kind === 'weapon' && knifeMh.weapon?.dagger === true).toBe(true);
    expect(knifework.offhand).toBeDefined();
    const thuggery = bestEpicGearFor('rogue', 'combat');
    const thugMh = ITEMS[thuggery.mainhand ?? ''];
    expect(thugMh?.kind === 'weapon' && thugMh.hand !== 'twohand').toBe(true);
    expect(thuggery.offhand).toBeDefined();
  });

  it('equips the caller and raises their attack power', () => {
    const sim = new Sim({ seed: 5, playerClass: 'rogue', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec('assassination')).toBe(true);
    const before = sim.player.stats.agi + sim.player.stats.sta;
    const equipped = equipBestInSlotForDev(
      (sim as unknown as { ctx: Parameters<typeof equipBestInSlotForDev>[0] }).ctx,
      sim.player.id,
    );
    expect(equipped).toBeGreaterThanOrEqual(8);
    expect(sim.player.stats.agi + sim.player.stats.sta).toBeGreaterThan(before);
    expect(sim.player.hp).toBe(sim.player.maxHp);
  });
});
