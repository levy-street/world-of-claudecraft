// Riftbound band progression (src/sim/rift/progression.ts) on the item-level
// ladder (src/sim/rift/band_ladder.ts): the forge pair (essence upgrade, gem
// socket), what a band grants when worn, the load-time rebuild that migrates
// every persisted band, and salvage.
import { describe, expect, it } from 'vitest';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../src/sim/content/rift/items';
import { ITEMS } from '../src/sim/data';
import { primaryStatSum } from '../src/sim/item_level';
import {
  RIFT_BAND_MAX_UPGRADE,
  RIFT_GEM_RATING,
  RIFT_GEM_RATING_STAT,
  riftBandItemLevel,
  riftBandPrimaryStats,
} from '../src/sim/rift/band_ladder';
import {
  createRiftGearInstance,
  riftSalvageYield,
  sanitizeRiftGearInstance,
} from '../src/sim/rift/progression';
import { Sim } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';
import { runSalvage } from './helpers/enchant_family_cast';
import { moveToRiftForge } from './helpers/rift_forge';

const MIGHT = { primary: 'str', secondary: 'sta' } as const;
const CRIMSON = RIFT_GEM_IDS[0]; // crit
const AZURE = RIFT_GEM_IDS[1]; // haste
const VERDANT = RIFT_GEM_IDS[2]; // hit

function bandSlot(sim: Sim, itemId: string) {
  const slot = sim.inventory.find((s) => s.itemId === itemId && s.instance?.rift);
  if (!slot?.instance?.rift) throw new Error('Rift band disappeared from the inventory');
  return slot;
}

describe('Rift band progression: the forge pair', () => {
  it('a fresh band is priced at its rank base item level and the shell carries nothing', () => {
    const gear = createRiftGearInstance('rift-fresh', 'A', 'warrior', 7);
    expect(ITEMS[gear.itemId].stats ?? {}).toEqual({});
    expect(gear.instance.rolled?.stats).toEqual(
      riftBandPrimaryStats(MIGHT, riftBandItemLevel('A', 0)),
    );
    expect(gear.instance.rift).toEqual(
      expect.objectContaining({ tier: 'A', upgradeLevel: 0, gemSlots: 1, gems: [] }),
    );
    // No legacy fields are ever minted.
    expect(gear.instance.rift).not.toHaveProperty('baseStats');
    expect(gear.instance.rift).not.toHaveProperty('enchant');
  });

  it('each essence upgrade raises the item level by one and re-prices the whole line', () => {
    const sim = new Sim({ seed: 731, playerClass: 'warrior', autoEquip: false });
    moveToRiftForge(sim);
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('rift-test', 'S', 'warrior', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.addItem(RIFT_ESSENCE_ITEM_ID, 40);
    const costs: number[] = [];
    for (let level = 1; level <= RIFT_BAND_MAX_UPGRADE; level++) {
      const result = sim.upgradeRiftItem(gear.itemId);
      expect(result).toEqual(
        expect.objectContaining({ ok: true, action: 'upgrade', upgradeLevel: level }),
      );
      costs.push(result.essenceSpent ?? 0);
      const rift = bandSlot(sim, gear.itemId).instance?.rift;
      expect(rift?.upgradeLevel).toBe(level);
      expect(bandSlot(sim, gear.itemId).instance?.rolled?.stats).toEqual(
        riftBandPrimaryStats(MIGHT, riftBandItemLevel('S', level)),
      );
    }
    // The essence ladder: 2, 4, 6, 8, 10 (30 for a full band).
    expect(costs).toEqual([2, 4, 6, 8, 10]);
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(10);
    expect(sim.upgradeRiftItem(gear.itemId)).toEqual(
      expect.objectContaining({ ok: false, reason: 'max_upgrade' }),
    );
    // A maxed S band stops one under the raid ring line.
    expect(
      primaryStatSum({
        ...ITEMS[gear.itemId],
        stats: bandSlot(sim, gear.itemId).instance?.rolled?.stats,
      }),
    ).toBeLessThan(primaryStatSum(ITEMS.seal_of_the_forgewall));
  });

  it('a gem adds its colour rating, never a primary stat or an item level', () => {
    const sim = new Sim({ seed: 735, playerClass: 'mage', autoEquip: false });
    moveToRiftForge(sim);
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('rift-gem', 'B', 'mage', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.addItem(AZURE, 1);
    const before = { ...bandSlot(sim, gear.itemId).instance?.rolled?.stats };
    expect(sim.socketRiftGem(gear.itemId, AZURE)).toEqual(
      expect.objectContaining({ ok: true, action: 'socket' }),
    );
    const after = bandSlot(sim, gear.itemId).instance;
    expect(after?.rolled?.stats).toEqual({ ...before, hasteRating: RIFT_GEM_RATING });
    expect(after?.rift?.upgradeLevel).toBe(0);
    expect(sim.countItem(AZURE)).toBe(0);
  });

  it('a full band takes a new gem in place of its oldest one, and the old gem is destroyed', () => {
    const sim = new Sim({ seed: 736, playerClass: 'warrior', autoEquip: false });
    moveToRiftForge(sim);
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('rift-replace', 'S', 'warrior', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.addItem(VERDANT, 2);
    sim.addItem(CRIMSON, 1);
    expect(sim.socketRiftGem(gear.itemId, VERDANT).ok).toBe(true);
    expect(sim.socketRiftGem(gear.itemId, VERDANT).ok).toBe(true);
    expect(bandSlot(sim, gear.itemId).instance?.rolled?.stats?.hitRating).toBe(2 * RIFT_GEM_RATING);
    sim.drainEvents();
    const replaced = sim.socketRiftGem(gear.itemId, CRIMSON);
    expect(replaced).toEqual(
      expect.objectContaining({ ok: true, action: 'socket', replacedGem: VERDANT }),
    );
    // The destruction is told to the player, naming the gem that went.
    const logs = sim
      .drainEvents()
      .filter((ev): ev is Extract<typeof ev, { type: 'log' }> => ev.type === 'log')
      .map((ev) => ev.text);
    expect(logs).toContain(
      `Rift gem replaced for ${ITEMS[gear.itemId].name}: ${ITEMS[VERDANT].name} destroyed.`,
    );
    const rift = bandSlot(sim, gear.itemId).instance?.rift;
    expect(rift?.gems).toEqual([VERDANT, CRIMSON]);
    expect(bandSlot(sim, gear.itemId).instance?.rolled?.stats).toEqual(
      expect.objectContaining({ hitRating: RIFT_GEM_RATING, critRating: RIFT_GEM_RATING }),
    );
    // The replaced gem is gone, not refunded.
    expect(sim.countItem(VERDANT)).toBe(0);
    expect(sim.countItem(CRIMSON)).toBe(0);
  });

  it('refuses a gem the player does not hold and an id that is not a gem', () => {
    const sim = new Sim({ seed: 737, playerClass: 'rogue', autoEquip: false });
    moveToRiftForge(sim);
    const gear = createRiftGearInstance('rift-refuse', 'C', 'rogue', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    expect(sim.socketRiftGem(gear.itemId, CRIMSON)).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_gem' }),
    );
    sim.addItem(RIFT_ESSENCE_ITEM_ID, 1);
    expect(sim.socketRiftGem(gear.itemId, RIFT_ESSENCE_ITEM_ID)).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid_gem' }),
    );
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(1);
  });
});

describe('Rift band progression: worn', () => {
  it('a worn band grants its rolled line and every gem rating, and survives save/load', () => {
    const sim = new Sim({ seed: 738, playerClass: 'warrior', autoEquip: false });
    moveToRiftForge(sim);
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('rift-worn', 'S', 'warrior', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.addItem(RIFT_ESSENCE_ITEM_ID, 2);
    sim.addItem(VERDANT, 1);
    sim.addItem(CRIMSON, 1);
    expect(sim.upgradeRiftItem(gear.itemId).ok).toBe(true);
    expect(sim.socketRiftGem(gear.itemId, VERDANT).ok).toBe(true);
    expect(sim.socketRiftGem(gear.itemId, CRIMSON).ok).toBe(true);
    const rolled = { ...bandSlot(sim, gear.itemId).instance?.rolled?.stats };
    const strengthBefore = sim.player.stats.str;
    const hitBefore = sim.player.hitRating;
    const critBefore = sim.player.critRating;

    sim.equipItem(gear.itemId);
    expect(sim.equipment.ring1).toBe(gear.itemId);
    expect(sim.player.stats.str).toBe(strengthBefore + (rolled.str ?? 0));
    expect(sim.player.hitRating).toBe(hitBefore + RIFT_GEM_RATING);
    expect(sim.player.critRating).toBe(critBefore + RIFT_GEM_RATING);

    const state = sim.serializeCharacter(sim.player.id);
    if (!state) throw new Error('Failed to serialize the Rift character');
    const restored = new Sim({ seed: 738, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Restored', { state });
    const worn = restored.players.get(pid)?.equipmentInstance?.ring1;
    expect(worn?.rift).toEqual(sim.equipmentInstances.ring1?.rift);
    expect(worn?.rolled?.stats).toEqual(rolled);
    expect(restored.entities.get(pid)?.hitRating).toBe(hitBefore + RIFT_GEM_RATING);

    // Legacy pre-merge saves persisted the same map under the plural key
    // (equipmentInstances); loading one must not drop the equipped payload.
    const legacyState = {
      ...state,
      equipmentInstance: undefined,
      equipmentInstances: state.equipmentInstance,
    };
    const legacyRestored = new Sim({ seed: 738, playerClass: 'warrior', noPlayer: true });
    const legacyPid = legacyRestored.addPlayer('warrior', 'Legado', { state: legacyState });
    expect(legacyRestored.players.get(legacyPid)?.equipmentInstance?.ring1?.rift).toEqual(
      sim.equipmentInstances.ring1?.rift,
    );
  });
});

describe('Rift band progression: the load-time rebuild', () => {
  /** The exact payload shape every band on the live realms carried before the
   *  ladder (an additive base line, the retired forge enchant field, the rank
   *  power): 502 of them, all at +0. Every one must load as a priced band. */
  function legacyProdPayload(overrides: Partial<NonNullable<ItemInstancePayload['rift']>> = {}) {
    return {
      boundTo: 4242,
      rolled: { quality: 'epic', stats: { str: 4, sta: 2 } },
      rift: {
        sourceEventId: 'rift-1756700000000-3',
        tier: 'S' as const,
        power: 4,
        upgradeLevel: 0,
        maxUpgradeLevel: 5,
        baseStats: { str: 4, sta: 2 },
        gemSlots: 2,
        gems: [] as string[],
        ...overrides,
      },
    } satisfies ItemInstancePayload;
  }

  it('re-prices a pre-ladder band at load and drops its legacy fields, never nulls it', () => {
    for (const tier of ['C', 'B', 'A', 'S'] as const) {
      const clean = sanitizeRiftGearInstance(
        'riftbound_band_of_might',
        legacyProdPayload({ tier, power: 1, gemSlots: 1 }),
        99,
      );
      expect(clean, `${tier} band must load`).not.toBeNull();
      expect(clean?.boundTo).toBe(99);
      expect(clean?.rolled?.stats).toEqual(riftBandPrimaryStats(MIGHT, riftBandItemLevel(tier, 0)));
      expect(clean?.rift).toEqual({
        sourceEventId: 'rift-1756700000000-3',
        tier,
        power: { C: 1, B: 2, A: 3, S: 4 }[tier],
        upgradeLevel: 0,
        maxUpgradeLevel: RIFT_BAND_MAX_UPGRADE,
        gemSlots: tier === 'S' ? 2 : 1,
        gems: [],
      });
    }
  });

  it('a pre-ladder band that carried the retired enchant loads without it', () => {
    const clean = sanitizeRiftGearInstance(
      'riftbound_band_of_might',
      legacyProdPayload({ upgradeLevel: 3, enchant: { stat: 'critRating', value: 2 } }),
      5,
    );
    expect(clean?.rift).not.toHaveProperty('enchant');
    expect(clean?.rift).not.toHaveProperty('baseStats');
    expect(clean?.rift?.upgradeLevel).toBe(3);
    expect(clean?.rolled?.stats).toEqual(riftBandPrimaryStats(MIGHT, riftBandItemLevel('S', 3)));
  });

  it('keeps socketed gems and truncates an over-socketed list to the newest rank sockets', () => {
    // Newest wins, the eviction order socketRiftGem applies on a full band.
    const clean = sanitizeRiftGearInstance(
      'riftbound_band_of_guile',
      legacyProdPayload({ tier: 'C', gemSlots: 1, gems: [CRIMSON, 'not_a_gem', AZURE] }),
      5,
    );
    expect(clean?.rift?.gems).toEqual([AZURE]);
    expect(clean?.rolled?.stats?.[RIFT_GEM_RATING_STAT[AZURE]]).toBe(RIFT_GEM_RATING);
    expect(clean?.rolled?.stats).not.toHaveProperty(RIFT_GEM_RATING_STAT[CRIMSON]);
  });

  it('carries the player item lock through the rebuild and nothing else', () => {
    const locked = sanitizeRiftGearInstance(
      'riftbound_band_of_might',
      { ...legacyProdPayload(), locked: true, signer: 'nobody', charges: { x: 1 } },
      5,
    );
    expect(locked?.locked).toBe(true);
    expect(locked).not.toHaveProperty('signer');
    expect(locked).not.toHaveProperty('charges');
    expect(
      sanitizeRiftGearInstance('riftbound_band_of_might', legacyProdPayload(), 5),
    ).not.toHaveProperty('locked');
  });

  it('the forge refuses a rift record riding a non-band id, spending nothing', () => {
    const sim = new Sim({ seed: 739, playerClass: 'warrior', autoEquip: false });
    moveToRiftForge(sim);
    const band = createRiftGearInstance('rift-odd', 'S', 'warrior', sim.player.id);
    sim.addItemInstance('rimefang', band.instance);
    sim.addItem(RIFT_ESSENCE_ITEM_ID, 10);
    expect(sim.upgradeRiftItem('rimefang')).toEqual(
      expect.objectContaining({ ok: false, reason: 'not_rift_gear' }),
    );
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(10);
  });

  it('a copy that is not a band at all still nulls to the harmless shell', () => {
    expect(sanitizeRiftGearInstance('rimefang', legacyProdPayload(), 5)).toBeNull();
    expect(
      sanitizeRiftGearInstance(
        'riftbound_band_of_might',
        legacyProdPayload({ upgradeLevel: 9 }),
        5,
      ),
    ).toBeNull();
    expect(
      sanitizeRiftGearInstance(
        'riftbound_band_of_might',
        legacyProdPayload({ tier: 'X' as unknown as 'S' }),
        5,
      ),
    ).toBeNull();
    expect(
      sanitizeRiftGearInstance('riftbound_band_of_might', { boundTo: 1, rolled: { stats: {} } }, 5),
    ).toBeNull();
  });

  it('rebuilds persisted Rift stats instead of trusting a tampered item payload', () => {
    const sim = new Sim({ seed: 733, playerClass: 'warrior', autoEquip: false });
    moveToRiftForge(sim);
    sim.setPlayerLevel(20);
    const gear = createRiftGearInstance('rift-safe-load', 'S', 'warrior', sim.player.id);
    sim.addItemInstance(gear.itemId, gear.instance);
    sim.equipItem(gear.itemId);

    const state = sim.serializeCharacter(sim.player.id);
    if (!state) throw new Error('Failed to serialize the Rift character');
    const payload = state.equipmentInstance?.ring1;
    if (!payload?.rift) throw new Error('Serialized Rift gear payload is missing');
    payload.boundTo = 999_999;
    payload.rolled = { quality: 'epic', stats: { str: 999_999, sta: 999_999, hitRating: 999 } };
    payload.rift.power = 999_999;
    payload.rift.maxUpgradeLevel = 999_999;
    payload.rift.gemSlots = 999;

    const restored = new Sim({ seed: 733, playerClass: 'warrior', noPlayer: true });
    const pid = restored.addPlayer('warrior', 'Safe', { state });
    const clean = restored.players.get(pid)?.equipmentInstance?.ring1;
    expect(clean).toEqual(
      expect.objectContaining({
        boundTo: pid,
        rolled: expect.objectContaining({
          stats: riftBandPrimaryStats(MIGHT, riftBandItemLevel('S', 0)),
        }),
        rift: expect.objectContaining({ power: 4, maxUpgradeLevel: 5, gemSlots: 2 }),
      }),
    );
    expect(restored.entities.get(pid)?.stats.str).toBeLessThan(100);
    expect(restored.entities.get(pid)?.hitRating).toBe(0);
  });
});

describe('Rift band progression: salvage', () => {
  it('salvages Rift gear back into tier-and-upgrade-scaled Rift Essence', () => {
    const sim = new Sim({ seed: 732, playerClass: 'mage', autoEquip: false });
    moveToRiftForge(sim);
    const gear = createRiftGearInstance('rift-test', 'A', 'mage', sim.player.id, 2);
    expect(gear.instance.rift?.upgradeLevel).toBe(2);
    const expected = riftSalvageYield(gear.instance);
    sim.addItemInstance(gear.itemId, gear.instance);
    runSalvage(sim, gear.itemId);
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
    moveToRiftForge(sim);
    const gear = createRiftGearInstance('rift-exact-copy', 'S', 'warrior', sim.player.id, 5);
    sim.addItemInstance(gear.itemId, gear.instance);
    // Most-recent copy is a harmless plain shell. Salvaging by item id must not
    // inspect the older upgraded payload and then consume this different copy.
    sim.addItem(gear.itemId, 1);

    runSalvage(sim, gear.itemId);

    expect(sim.lastSalvageResult?.materialItemId).not.toBe(RIFT_ESSENCE_ITEM_ID);
    expect(sim.countItem(RIFT_ESSENCE_ITEM_ID)).toBe(0);
    expect(
      sim.inventory.some(
        (slot) => slot.itemId === gear.itemId && slot.instance?.rift?.upgradeLevel === 5,
      ),
    ).toBe(true);
  });
});
