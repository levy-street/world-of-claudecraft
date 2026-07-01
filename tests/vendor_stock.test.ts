import { describe, expect, it } from 'vitest';
import { ITEMS, NPCS } from '../src/sim/data';
import { createNpc } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { DT, type NpcDef } from '../src/sim/types';
import {
  refreshVendorStock,
  scheduleVendorStockRefresh,
  VENDOR_STOCK_REFRESH_MAX,
  VENDOR_STOCK_REFRESH_MIN,
} from '../src/sim/vendor_stock';

function testVendorDef(overrides: Partial<NpcDef> = {}): NpcDef {
  return {
    id: 'test_vendor',
    name: 'Test Vendor',
    title: 'Provisioner',
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0xffffff,
    questIds: [],
    vendorItems: ['baked_bread'],
    vendorRotatingItems: ['spring_water', 'roasted_boar', 'tough_jerky'],
    greeting: 'Hello.',
    ...overrides,
  };
}

describe('rotating vendor stock', () => {
  it('schedules surplus refreshes on a 15-45 minute sim-clock cadence', () => {
    const npc = createNpc(99, testVendorDef({ vendorStockSlots: 2 }), { x: 0, y: 0, z: 0 });

    expect(scheduleVendorStockRefresh(npc, 0, 1234)).toBe(true);
    expect(npc.vendorStockRefreshAt).toBeGreaterThanOrEqual(VENDOR_STOCK_REFRESH_MIN);
    expect(npc.vendorStockRefreshAt).toBeLessThanOrEqual(VENDOR_STOCK_REFRESH_MAX);
    expect(npc.vendorItems).toEqual(['baked_bread']);

    expect(refreshVendorStock(npc, npc.vendorStockRefreshAt - 0.01, 1234)).toBe(false);
    expect(npc.vendorStockGeneration).toBe(0);

    const dueAt = npc.vendorStockRefreshAt;
    expect(refreshVendorStock(npc, dueAt, 1234)).toBe(true);
    expect(npc.vendorStockGeneration).toBe(1);
    expect(npc.vendorItems[0]).toBe('baked_bread');
    expect(npc.vendorItems).toHaveLength(3);
    expect(new Set(npc.vendorItems).size).toBe(npc.vendorItems.length);
    for (const itemId of npc.vendorItems.slice(1)) {
      expect(npc.vendorRotatingItems).toContain(itemId);
    }
    expect(npc.vendorStockRefreshAt).toBeGreaterThanOrEqual(dueAt + VENDOR_STOCK_REFRESH_MIN);
    expect(npc.vendorStockRefreshAt).toBeLessThanOrEqual(dueAt + VENDOR_STOCK_REFRESH_MAX);
  });

  it('keeps starting vendor stock stable until the timed refresh is due', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const wilkes = [...sim.entities.values()].find((e) => e.templateId === 'trader_wilkes');

    expect(wilkes?.kind).toBe('npc');
    if (wilkes?.kind !== 'npc') throw new Error('trader_wilkes not spawned');

    expect(wilkes.vendorBaseItems).toEqual(NPCS.trader_wilkes.vendorItems);
    expect(wilkes.vendorItems).toEqual(wilkes.vendorBaseItems);
    expect(wilkes.vendorStockRefreshAt).toBeGreaterThanOrEqual(VENDOR_STOCK_REFRESH_MIN);
    expect(wilkes.vendorStockRefreshAt).toBeLessThanOrEqual(VENDOR_STOCK_REFRESH_MAX);

    wilkes.vendorStockRefreshAt = sim.time + DT;
    const events = sim.tick();
    const surplus = wilkes.vendorItems.filter((itemId) => !wilkes.vendorBaseItems.includes(itemId));
    expect(events).toContainEqual({ type: 'vendor', action: 'refresh' });
    expect(surplus).toHaveLength(1);
    expect(wilkes.vendorRotatingItems).toContain(surplus[0]);
    expect(ITEMS[surplus[0]]?.buyValue).toBeGreaterThan(0);
  });

  it('only rotates items that have vendor buy prices', () => {
    for (const npc of Object.values(NPCS)) {
      for (const itemId of npc.vendorRotatingItems ?? []) {
        expect(ITEMS[itemId]?.buyValue, `${npc.id} rotates unsellable ${itemId}`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});
