import { describe, expect, it } from 'vitest';
import { allEpicGearIds } from '../src/sim/content/ptr_dev_vendor';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

// The dev-only free-epic vendor: /dev vendor spawns it, it sells every epic for
// free, and it is inert on a production realm (devCommands off). Gated tests.

describe('ptr dev vendor', () => {
  it('stocks every equippable epic in the game', () => {
    const ids = allEpicGearIds();
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids) {
      const def = ITEMS[id];
      expect(def?.quality).toBe('epic');
      expect(def?.slot).toBeTruthy();
    }
    // dynamic: an epic added to content shows up without editing the vendor
    const epicCount = Object.values(ITEMS).filter(
      (i) => i.quality === 'epic' && (i.kind === 'armor' || i.kind === 'weapon') && i.slot,
    ).length;
    expect(ids.length).toBe(epicCount);
  });

  it('/dev vendor spawns a free vendor and buying an epic costs nothing (dev realm)', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: false, devCommands: true });
    sim.setPlayerLevel(20);
    const p = sim.player;
    const copperBefore = (sim as unknown as { meta(pid?: number): { copper: number } }).meta?.(
      sim.playerId,
    )?.copper;
    sim.chat('/dev vendor');
    sim.tick();
    const vendor = [...sim.entities.values()].find(
      (e: Entity) => e.kind === 'npc' && (e as { devVendor?: boolean }).devVendor,
    );
    expect(vendor, 'vendor spawned').toBeTruthy();
    expect(vendor!.vendorItems.length).toBeGreaterThan(50);
    const epic = vendor!.vendorItems[0];
    (sim as unknown as { buyItem(npc: number, item: string, pid?: number): void }).buyItem(
      vendor!.id,
      epic,
      sim.playerId,
    );
    // got the item, paid nothing
    expect(sim.countItem(epic)).toBeGreaterThan(0);
    if (copperBefore !== undefined) {
      const after = (sim as unknown as { meta(pid?: number): { copper: number } }).meta?.(
        sim.playerId,
      )?.copper;
      expect(after).toBe(copperBefore);
    }
  });

  it('is inert on a production realm: /dev vendor does nothing without devCommands', () => {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true, devCommands: false });
    sim.setPlayerLevel(20);
    sim.chat('/dev vendor');
    sim.tick();
    const vendor = [...sim.entities.values()].find(
      (e: Entity) => e.kind === 'npc' && (e as { devVendor?: boolean }).devVendor,
    );
    expect(vendor, 'no dev vendor without dev commands').toBeFalsy();
  });
});
