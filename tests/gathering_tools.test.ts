import { describe, expect, it } from 'vitest';
import { GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import { ITEMS, NPCS } from '../src/sim/data';
import {
  bestGatheringToolTier,
  canGatherMaterialTier,
  gatheringToolDurabilityCost,
} from '../src/sim/professions/tools';
import { Sim } from '../src/sim/sim';
import type { Entity, ItemDef } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const BASE_TOOLS = {
  mining: 'basic_mining_pick',
  logging: 'basic_logging_axe',
  herbalism: 'basic_herbalists_sickle',
} as const;

function teleportTo(sim: Sim, x: number, z: number): void {
  const y = terrainHeight(x, z, sim.cfg.seed);
  sim.player.pos = { x, y, z };
  sim.player.prevPos = { ...sim.player.pos };
}

describe('base gathering tools', () => {
  it('defines one vendor-sold tier 1 base tool per gathering profession', () => {
    for (const profession of GATHERING_PROFESSION_IDS) {
      const itemId = BASE_TOOLS[profession];
      const item = ITEMS[itemId];
      expect(item, itemId).toBeTruthy();
      expect(item.kind).toBe('tool');
      expect(item.buyValue, itemId).toBeGreaterThan(0);
      expect(item.gatheringTool).toEqual({ profession, tier: 1, infiniteDurability: true });
    }

    for (const vendorId of ['trader_wilkes', 'provisioner_hale', 'quartermaster_bree']) {
      expect(NPCS[vendorId].vendorItems, vendorId).toEqual(
        expect.arrayContaining(Object.values(BASE_TOOLS)),
      );
    }
  });

  it('lets the player buy base gathering tools from provisioners', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const wilkes = [...sim.entities.values()].find(
      (e) => (e as Entity).templateId === 'trader_wilkes',
    ) as Entity;

    teleportTo(sim, wilkes.pos.x + 2, wilkes.pos.z);
    sim.copper = 100;
    sim.buyItem(wilkes.id, BASE_TOOLS.mining);

    expect(sim.countItem(BASE_TOOLS.mining)).toBe(1);
    expect(sim.copper).toBe(80);
  });

  it('gates material tiers by the matching tool tier in inventory', () => {
    const miningTool = [{ itemId: BASE_TOOLS.mining, count: 1 }];
    const herbalismTool = [{ itemId: BASE_TOOLS.herbalism, count: 1 }];

    expect(canGatherMaterialTier([], ITEMS, 'mining', 1)).toMatchObject({
      canGather: false,
      reason: 'missing-tool',
      toolTier: 0,
    });
    expect(canGatherMaterialTier(herbalismTool, ITEMS, 'mining', 1)).toMatchObject({
      canGather: false,
      reason: 'missing-tool',
      toolTier: 0,
    });
    expect(canGatherMaterialTier(miningTool, ITEMS, 'mining', 1)).toMatchObject({
      canGather: true,
      toolTier: 1,
    });
    expect(canGatherMaterialTier(miningTool, ITEMS, 'mining', 2)).toMatchObject({
      canGather: false,
      reason: 'insufficient-tier',
      toolTier: 1,
    });
  });

  it('ignores empty slots and picks the highest matching tool tier', () => {
    const items: Record<string, ItemDef> = {
      ...ITEMS,
      test_better_pick: {
        ...ITEMS[BASE_TOOLS.mining],
        id: 'test_better_pick',
        gatheringTool: { profession: 'mining', tier: 3, infiniteDurability: true },
      },
    };

    expect(
      bestGatheringToolTier(
        [
          { itemId: BASE_TOOLS.mining, count: 0 },
          { itemId: BASE_TOOLS.herbalism, count: 1 },
          { itemId: 'test_better_pick', count: 1 },
        ],
        items,
        'mining',
      ),
    ).toBe(3);
  });

  it('keeps base gathering tools from losing durability', () => {
    for (const itemId of Object.values(BASE_TOOLS)) {
      expect(gatheringToolDurabilityCost(ITEMS[itemId]), itemId).toBe(0);
    }
  });
});
