import { describe, expect, it } from 'vitest';
import { corpseInteractionAvailability } from '../src/sim/corpse_interaction';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';

function ctx(): SimContext {
  return {
    partyOf: () => null,
  } as unknown as SimContext;
}

function corpse(overrides: Partial<Entity>): Entity {
  return {
    id: 2,
    kind: 'mob',
    templateId: 'forest_wolf',
    ownerId: null,
    dead: true,
    corpseTimer: 60,
    harvestClaimedBy: null,
    tappedById: null,
    lootFfaTimer: Infinity,
    lootable: false,
    loot: null,
    ...overrides,
  } as Entity;
}

describe('corpseInteractionAvailability', () => {
  it('keeps wild zero-loot tagged corpses harvestable before decay', () => {
    const result = corpseInteractionAvailability(ctx(), corpse({}), 1, true);

    expect(result).toEqual({
      harvestable: true,
      hasLootRights: false,
      hasLoot: false,
      canInteract: true,
    });
  });

  it('distinguishes shared rights from ordinary contents remaining for this viewer', () => {
    const mob = corpse({
      lootable: true,
      loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [9] }] },
    });
    expect(corpseInteractionAvailability(ctx(), mob, 1, true)).toMatchObject({
      hasLootRights: true,
      hasLoot: false,
      harvestable: true,
    });
    expect(corpseInteractionAvailability(ctx(), mob, 9, true).hasLoot).toBe(true);
    mob.loot!.items[0].count = 0;
    expect(corpseInteractionAvailability(ctx(), mob, 9, true).hasLoot).toBe(false);
  });

  it('refuses owned tagged corpses even when the wild template is harvestable', () => {
    const result = corpseInteractionAvailability(ctx(), corpse({ ownerId: 1 }), 1, true);

    expect(result).toEqual({
      harvestable: false,
      hasLootRights: false,
      hasLoot: false,
      canInteract: false,
    });
  });
});
