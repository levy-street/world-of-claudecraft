import { describe, expect, it } from 'vitest';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { createRiftGearInstance, riftSalvageYield } from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';

describe('Rift gear progression', () => {
  it('upgrades, enchants, sockets, equips, and persists one non-fungible drop', () => {
    const sim = new Sim({ seed: 731, playerClass: 'warrior', autoEquip: false });
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('rift-test', 'S', 'warrior', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.addItem(RIFT_ESSENCE_ITEM_ID, 20);
    sim.addItem(RIFT_GEM_IDS[0], 1);

    expect(sim.upgradeRiftItem(gear.itemId)).toEqual(
      expect.objectContaining({ ok: true, action: 'upgrade', upgradeLevel: 1 }),
    );
    expect(sim.enchantRiftItem(gear.itemId, 'critRating')).toEqual(
      expect.objectContaining({ ok: true, action: 'enchant' }),
    );
    expect(sim.socketRiftGem(gear.itemId, RIFT_GEM_IDS[0])).toEqual(
      expect.objectContaining({ ok: true, action: 'socket' }),
    );
    const inventoryGear = sim.inventory.find((slot) => slot.itemId === gear.itemId);
    if (!inventoryGear) throw new Error('Rift gear disappeared from the inventory');
    expect(inventoryGear.instance?.rift).toEqual(
      expect.objectContaining({ upgradeLevel: 1, gems: [RIFT_GEM_IDS[0]] }),
    );
    const rolledStrength = inventoryGear.instance?.rolled?.stats?.str ?? 0;
    const strengthBefore = sim.player.stats.str;

    sim.equipItem(gear.itemId);
    expect(sim.equipment.ring1).toBe(gear.itemId);
    expect(sim.equipmentInstances.ring1?.rift?.sourceEventId).toBe('rift-test');
    expect(sim.player.stats.str).toBeGreaterThanOrEqual(strengthBefore + rolledStrength);

    const state = sim.serializeCharacter(sim.player.id);
    if (!state) throw new Error('Failed to serialize the Rift character');
    const restored = new Sim({ seed: 731, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Restored', { state });
    expect(restored.players.get(pid)?.equipmentInstance?.ring1?.rift).toEqual(
      sim.equipmentInstances.ring1?.rift,
    );

    // Legacy pre-merge saves persisted the same map under the plural key
    // (equipmentInstances); loading one must not drop the equipped payload.
    const legacyState = {
      ...state,
      equipmentInstance: undefined,
      equipmentInstances: state.equipmentInstance,
    };
    const legacyRestored = new Sim({ seed: 731, playerClass: 'warrior', noPlayer: true });
    const legacyPid = legacyRestored.addPlayer('warrior', 'Legado', { state: legacyState });
    expect(legacyRestored.players.get(legacyPid)?.equipmentInstance?.ring1?.rift).toEqual(
      sim.equipmentInstances.ring1?.rift,
    );
  });

  it('salvages Rift gear back into tier-and-upgrade-scaled Rift Essence', () => {
    const sim = new Sim({ seed: 732, playerClass: 'mage', autoEquip: false });
    const gear = createRiftGearInstance('rift-test', 'A', 'mage', sim.player.id);
    if (!gear.instance.rift) throw new Error('Factory returned non-Rift gear');
    gear.instance.rift.upgradeLevel = 2;
    const expected = riftSalvageYield(gear.instance);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.salvageItem(gear.itemId);
    expect(sim.lastSalvageResult).toEqual(
      expect.objectContaining({
        ok: true,
        materialItemId: RIFT_ESSENCE_ITEM_ID,
        count: expected,
      }),
    );
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(expected);
    expect(sim.inventory.some((slot) => slot.itemId === gear.itemId)).toBe(false);
  });

  it('salvages the exact same-id copy that inventory removal consumes', () => {
    const sim = new Sim({ seed: 734, playerClass: 'warrior', autoEquip: false });
    const gear = createRiftGearInstance('rift-exact-copy', 'S', 'warrior', sim.player.id);
    if (!gear.instance.rift) throw new Error('Factory returned non-Rift gear');
    gear.instance.rift.upgradeLevel = 5;
    sim.addItemInstance(gear.itemId, gear.instance);
    // Most-recent copy is a harmless plain shell. Salvaging by item id must not
    // inspect the older upgraded payload and then consume this different copy.
    sim.addItem(gear.itemId, 1);

    sim.salvageItem(gear.itemId);

    expect(sim.lastSalvageResult?.materialItemId).not.toBe(RIFT_ESSENCE_ITEM_ID);
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(0);
    expect(
      sim.inventory.some(
        (slot) => slot.itemId === gear.itemId && slot.instance?.rift?.upgradeLevel === 5,
      ),
    ).toBe(true);
  });

  it('rebuilds persisted Rift stats instead of trusting a tampered item payload', () => {
    const sim = new Sim({ seed: 733, playerClass: 'warrior', autoEquip: false });
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('rift-safe-load', 'S', 'warrior', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.equipItem(gear.itemId);

    const state = sim.serializeCharacter(sim.player.id);
    if (!state) throw new Error('Failed to serialize the Rift character');
    const payload = state.equipmentInstance?.ring1;
    if (!payload?.rift) throw new Error('Serialized Rift gear payload is missing');
    payload.boundTo = 999_999;
    payload.rolled = { quality: 'epic', stats: { str: 999_999, sta: 999_999 } };
    payload.rift.power = 999_999;
    payload.rift.maxUpgradeLevel = 999_999;
    payload.rift.baseStats = { str: 999_999, sta: 999_999 };

    const restored = new Sim({ seed: 733, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Safe', { state });
    const clean = restored.players.get(pid)?.equipmentInstance?.ring1;
    expect(clean).toEqual(
      expect.objectContaining({
        boundTo: pid,
        rolled: expect.objectContaining({ stats: { str: 4, sta: 2 } }),
        rift: expect.objectContaining({
          power: 4,
          maxUpgradeLevel: 5,
          baseStats: { str: 4, sta: 2 },
        }),
      }),
    );
    expect(restored.entities.get(pid)?.stats.str).toBeLessThan(100);
  });
});
