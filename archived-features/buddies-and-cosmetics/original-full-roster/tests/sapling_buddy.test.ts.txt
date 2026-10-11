import { describe, expect, it } from 'vitest';
import { buddyOwned, summonBuddy } from '../src/sim/buddies';
import { ITEMS, MOBS } from '../src/sim/data';
import { useItem } from '../src/sim/items';
import { buddyOf } from '../src/sim/pet/buddy_ai';
import { Sim } from '../src/sim/sim';
import { buddySourceFacts } from '../src/ui/collections/collection_sources';
import { buildCollectionsView } from '../src/ui/collections/collections_view';
import { VENDOR_TEST_WORLD } from './sim_shared';

describe('Sapling buddy integration', () => {
  it('consumes its grant token and summons, dismisses and recalls its own follower', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Owner');
    sim.tick();
    const meta = sim.players.get(pid)!;

    sim.addItem('whistle_sapling', 1, pid);
    expect(buddyOwned(meta, 'sapling')).toBe(false);
    useItem(sim.ctx, 'whistle_sapling', pid);

    expect(buddyOwned(meta, 'sapling')).toBe(true);
    expect(meta.inventory.some((slot) => slot.itemId === 'whistle_sapling')).toBe(false);
    expect(sim.entities.get(pid)!.buddyKey).toBe('sapling');
    const first = buddyOf(sim.ctx, pid)!;
    expect(first.templateId).toBe('buddy_sapling');
    expect(first.ownerId).toBe(pid);
    expect(first.hostile).toBe(false);
    expect(MOBS[first.templateId].family).toBe('elemental');
    expect(MOBS[first.templateId].scale).toBe(MOBS.buddy_horse.scale);

    summonBuddy(sim.ctx, pid, 'sapling');
    expect(buddyOf(sim.ctx, pid)).toBeNull();
    expect(sim.entities.has(first.id)).toBe(false);
    summonBuddy(sim.ctx, pid, 'sapling');
    expect(buddyOf(sim.ctx, pid)?.templateId).toBe('buddy_sapling');
    expect(buddyOwned(meta, 'sapling')).toBe(true);
  });

  it('lists the unsourced companion among elementals without granting ownership', () => {
    const view = buildCollectionsView({
      buddyVisualKeys: { sapling: 'buddy_sapling' },
      ownedBuddyKeys: new Set<string>(),
      ownedMountKeys: new Set<string>(),
      ownedItemIds: new Set<string>(),
      mountVisualKeys: {},
    });
    const group = view.buddyGroups.find((entry) => entry.kind === 'elemental');
    const row = group?.entries.find((entry) => entry.key === 'sapling');
    expect(row).toMatchObject({ name: 'Sapling', owned: false, obtainable: false });
    expect(view.buddies.filter((entry) => entry.key === 'sapling')).toHaveLength(1);

    const source = buddySourceFacts('sapling');
    expect(source).toMatchObject({ bossDrops: [], deedId: null, obtainable: false });
    expect(source.token).toMatchObject({
      itemId: 'whistle_sapling',
      tradeable: false,
      vendors: [],
      drops: [],
      obtainable: false,
    });
    expect(ITEMS.whistle_sapling).toMatchObject({
      kind: 'buddy',
      buddy: 'sapling',
      soulbound: true,
      quality: 'common',
      sellValue: 50_000,
    });
  });
});
