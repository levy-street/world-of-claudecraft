import { describe, expect, it } from 'vitest';
import { corpseLootAvailability } from '../src/game/corpse_loot_availability';
import type { Entity } from '../src/sim/types';

function corpse(overrides: Partial<Entity>): Entity {
  return {
    id: 2,
    kind: 'mob',
    templateId: 'test',
    loot: null,
    harvestClaimedBy: null,
    ...overrides,
  } as Entity;
}

describe('corpseLootAvailability', () => {
  it('excludes personal loot assigned only to another player', () => {
    const result = corpseLootAvailability(
      corpse({
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [9] }] },
      }),
      1,
    );

    expect(result.visibleItems).toEqual([]);
    expect(result.hasLoot).toBe(false);
    expect(result.canOpen).toBe(false);
  });

  it('includes personal loot assigned to the local player', () => {
    const result = corpseLootAvailability(
      corpse({
        loot: { copper: 0, items: [{ itemId: 'wolf_fang', count: 1, personalFor: [1] }] },
      }),
      1,
    );

    expect(result.visibleItems).toHaveLength(1);
    expect(result.hasLoot).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('keeps a depleted skinnable corpse open for harvesting', () => {
    const result = corpseLootAvailability(
      corpse({ templateId: 'forest_wolf', loot: null, harvestClaimedBy: null }),
      1,
    );

    expect(result.hasLoot).toBe(false);
    expect(result.harvestable).toBe(true);
    expect(result.canOpen).toBe(true);
  });

  it('does not infer harvest availability when the host cannot mirror claim state', () => {
    const result = corpseLootAvailability(
      corpse({ templateId: 'forest_wolf', loot: null, harvestClaimedBy: null }),
      1,
      false,
    );

    expect(result.harvestable).toBe(false);
    expect(result.canOpen).toBe(false);
  });
});
