import { describe, expect, it } from 'vitest';
import { stackSizeOf } from '../src/sim/bags';
import { attachPendingBuddy, buddyOwned } from '../src/sim/buddies';
import { ITEM_SETS, ITEMS, NPCS } from '../src/sim/data';
import { buyItem } from '../src/sim/items';
import { Sim } from '../src/sim/sim';
import { canBuyBuddyOffer } from '../src/sim/vendor_buddy_purchase';
import { buildWarfareVendorView } from '../src/ui/hud/vendor/warfare_vendor_view';
import { VENDOR_TEST_WORLD } from './sim_shared';

const WHISTLE = 'whistle_horse';
const VENDORS = ['fury', 'warmarshal_draven_kole'];

function shop(npcKey: string, honor: number) {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    world: VENDOR_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Buyer');
  const vendor = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === npcKey,
  )!;
  expect(vendor).toBeDefined();
  sim.entities.get(pid)!.pos = { ...vendor.pos };
  const meta = sim.meta(pid)!;
  meta.inventory.length = 0;
  meta.honor = honor;
  meta.copper = 12345;
  return { sim, pid, vendor, meta };
}

describe.each(VENDORS)('Horse at %s', (npcKey) => {
  it('costs exactly 100,000 honor and immediately reveals Horse without an item', () => {
    const { sim, pid, vendor, meta } = shop(npcKey, 100_000);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid);
    expect(meta.honor).toBe(0);
    expect(meta.copper).toBe(12345);
    expect(sim.countItem(WHISTLE, pid)).toBe(0);
    expect(meta.inventory).toEqual([]);
    expect(sim.events.filter((event) => event.type === 'buddyRevealed')).toEqual([
      { type: 'buddyRevealed', pid, key: 'horse' },
    ]);
    expect(buddyOwned(meta, 'horse')).toBe(true);
    expect(sim.entities.get(pid)!.buddyKey).toBe('horse');
  });

  it('refuses a purchase one honor short without charging either currency', () => {
    const { sim, pid, vendor, meta } = shop(npcKey, 99_999);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid);
    expect(meta.honor).toBe(99_999);
    expect(meta.copper).toBe(12345);
    expect(sim.countItem(WHISTLE, pid)).toBe(0);
    expect(buddyOwned(meta, 'horse')).toBe(false);
  });

  it('does not charge again or reveal twice for a duplicate purchase', () => {
    const { sim, pid, vendor, meta } = shop(npcKey, 200_000);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid);
    expect(meta.honor).toBe(100_000);
    expect(meta.inventory).toEqual([]);
    expect(sim.events.filter((event) => event.type === 'buddyRevealed')).toHaveLength(1);
  });

  it('does not charge for a buddy already waiting to reveal', () => {
    const { sim, pid, vendor, meta } = shop(npcKey, 100_000);
    attachPendingBuddy(sim.ctx, pid, 'horse', 'world', vendor.pos);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid);
    expect(meta.honor).toBe(100_000);
    expect(meta.buddies.pending).toHaveLength(1);
    expect(buddyOwned(meta, 'horse')).toBe(false);
  });

  it('works with full bags and preserves the contents', () => {
    const { sim, pid, vendor, meta } = shop(npcKey, 100_000);
    for (let i = 0; i < 128; i++)
      meta.inventory.push({ itemId: 'whistle_horse', count: stackSizeOf(ITEMS[WHISTLE]) });
    expect(sim.ctx.canAddItem(WHISTLE, 1, pid)).toBe(false);
    const before = structuredClone(meta.inventory);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid);
    expect(meta.honor).toBe(0);
    expect(meta.inventory).toEqual(before);
    expect(buddyOwned(meta, 'horse')).toBe(true);
  });

  it.each(['dead', 'out of range', 'not stocked'])(
    'refuses an invalid purchase when %s without charging or granting',
    (reason) => {
      const { sim, pid, vendor, meta } = shop(npcKey, 100_000);
      const player = sim.entities.get(pid)!;
      if (reason === 'dead') player.dead = true;
      if (reason === 'out of range') player.pos.x += 100;
      if (reason === 'not stocked') vendor.vendorItems = [];
      buyItem(sim.ctx, vendor.id, WHISTLE, pid);
      expect(meta.honor).toBe(100_000);
      expect(meta.inventory).toEqual([]);
      expect(buddyOwned(meta, 'horse')).toBe(false);
    },
  );

  it('persists the unlock across character reload', () => {
    const { sim, pid, vendor } = shop(npcKey, 100_000);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid);
    const state = sim.serializeCharacter(pid)!;
    const loaded = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      world: VENDOR_TEST_WORLD,
    });
    const nextPid = loaded.addPlayer('warrior', 'Buyer', { state });
    expect(buddyOwned(loaded.meta(nextPid)!, 'horse')).toBe(true);
    expect(loaded.meta(nextPid)!.honor).toBe(0);
    expect(loaded.countItem(WHISTLE, nextPid)).toBe(0);
  });

  it('rejects retired buddy offers even if a stale vendor stocks them', () => {
    const { sim, pid, vendor, meta } = shop(npcKey, 100_000);
    vendor.vendorItems = [...vendor.vendorItems, 'whistle_proud_grunt'];
    buyItem(sim.ctx, vendor.id, 'whistle_proud_grunt', pid);
    expect(meta.honor).toBe(100_000);
    expect(meta.inventory).toEqual([]);
    expect(meta.buddies.owned.size).toBe(0);
  });

  it.each([{ count: 100 }, { bulk: true }])('always charges for one companion with %o', (opts) => {
    const { sim, pid, vendor, meta } = shop(npcKey, 200_000);
    buyItem(sim.ctx, vendor.id, WHISTLE, pid, opts);
    expect(meta.honor).toBe(100_000);
    expect(meta.inventory).toEqual([]);
    expect(sim.events.filter((event) => event.type === 'buddyRevealed')).toHaveLength(1);
  });

  it.each([99_999, 100_000])('shows the companion price and affordability at %i honor', (honor) => {
    const view = buildWarfareVendorView(NPCS[npcKey].vendorItems!, ITEMS, ITEM_SETS, {
      honor,
      acquiredBuddyKeys: new Set<string>(),
      ownedItemIds: new Set<string>(),
      equippedItemIds: new Set<string>(),
    });
    const section = view.sections.find((row) => row.key === 'companions');
    expect(section?.offers).toHaveLength(1);
    expect(section?.offers[0]).toMatchObject({
      itemId: WHISTLE,
      honor: 100_000,
      affordable: honor >= 100_000,
    });
  });
});

describe('account purchase admission', () => {
  it('accepts a valid offer without charging or granting', () => {
    const { sim, pid, vendor, meta } = shop('fury', 100_000);
    const before = sim.events.length;
    expect(canBuyBuddyOffer(sim.ctx, pid, vendor.id, WHISTLE)).toBe(true);
    expect(meta.honor).toBe(100_000);
    expect(meta.buddies.owned.size).toBe(0);
    expect(sim.events).toHaveLength(before);
  });
  it.each(['dead', 'range', 'stock', 'honor', 'owned', 'pending', 'count', 'merchant'])(
    'rejects %s before database work',
    (reason) => {
      const { sim, pid, vendor, meta } = shop('fury', 100_000);
      if (reason === 'dead') sim.entities.get(pid)!.dead = true;
      if (reason === 'range') sim.entities.get(pid)!.pos.x += 100;
      if (reason === 'stock') vendor.vendorItems = [];
      if (reason === 'honor') meta.honor--;
      if (reason === 'owned') meta.buddies.owned.add('horse');
      if (reason === 'pending') attachPendingBuddy(sim.ctx, pid, 'horse', 'world', vendor.pos);
      expect(
        canBuyBuddyOffer(
          sim.ctx,
          pid,
          reason === 'merchant' ? -1 : vendor.id,
          WHISTLE,
          reason === 'count' ? { count: -1 } : undefined,
        ),
      ).toBe(false);
    },
  );
});
