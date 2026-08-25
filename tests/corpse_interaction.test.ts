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
      canInteract: true,
    });
  });

  it('refuses owned tagged corpses even when the wild template is harvestable', () => {
    const result = corpseInteractionAvailability(ctx(), corpse({ ownerId: 1 }), 1, true);

    expect(result).toEqual({
      harvestable: false,
      hasLootRights: false,
      canInteract: false,
    });
  });
});
