import { describe, expect, it } from 'vitest';
import { HEROIC_BOSS_LOOT } from '../src/sim/content/heroic_loot';
import {
  LIMITED_DROPS,
  LIMITED_FALLBACK,
  LIMITED_ITEM_SOURCE,
  LIMITED_ITEMS,
} from '../src/sim/content/limited_drops';
import { ITEMS, MOBS } from '../src/sim/data';
import { expectedStatBudget, primaryStatSum } from '../src/sim/item_level';

// The exact supply caps this feature ships with, pinned so a silent edit to a
// relic's scarcity is a test change, not a quiet balance shift.
const EXPECTED_SUPPLY: Record<string, number> = {
  emberfall_edge: 25,
  crown_of_the_thornpeak_scourge: 100,
  thunzharrs_stormheart: 150,
  sealed_vault_signet_crypt: 200,
  sealed_vault_signet_bastion: 200,
  sealed_vault_signet_temple: 200,
  sealed_vault_signet_sanctum: 200,
};

const LIMITED_IDS = Object.keys(LIMITED_ITEMS);

describe('limited relics: catalog integrity', () => {
  it('every limited item is in ITEMS with a positive supply and the pinned cap', () => {
    for (const id of LIMITED_IDS) {
      expect(ITEMS[id], `${id} merged into ITEMS`).toBeTruthy();
      const supply = ITEMS[id].limitedSupply;
      expect(supply, `${id} has limitedSupply`).toBeDefined();
      expect(supply, `${id} supply >= 1`).toBeGreaterThanOrEqual(1);
      expect(supply, `${id} supply matches spec`).toBe(EXPECTED_SUPPLY[id]);
    }
    // The seven shipped relics, no more no less: a new one must update the pin.
    expect(new Set(LIMITED_IDS)).toEqual(new Set(Object.keys(EXPECTED_SUPPLY)));
  });

  it('no pre-existing item carries a supply cap (the cap applies only to relics)', () => {
    for (const [id, def] of Object.entries(ITEMS)) {
      if (LIMITED_ITEMS[id]) continue;
      expect(def.limitedSupply, `${id} is uncapped`).toBeUndefined();
    }
  });

  it('every relic stat sum equals its exact item-level budget', () => {
    // The relics ride the same budget pipeline as every other drop: a relic that
    // is over- or under-budget is a content bug, caught here.
    for (const id of LIMITED_IDS) {
      const budget = expectedStatBudget(ITEMS[id]);
      expect(budget, `${id} has a derivable budget`).toBeDefined();
      expect(primaryStatSum(ITEMS[id]), `${id} stat sum == budget`).toBe(budget);
    }
  });

  it('every relic registers a source level and (raid) flag', () => {
    for (const id of LIMITED_IDS) {
      expect(LIMITED_ITEM_SOURCE[id], `${id} has a source registration`).toBeDefined();
      expect(LIMITED_ITEM_SOURCE[id].level, `${id} source level > 0`).toBeGreaterThan(0);
    }
  });
});

describe('limited relics: fallbacks', () => {
  it('every relic maps to a real, non-limited, plain fallback item', () => {
    for (const id of LIMITED_IDS) {
      const fallbackId = LIMITED_FALLBACK[id];
      expect(fallbackId, `${id} has a fallback`).toBeTruthy();
      const fallback = ITEMS[fallbackId];
      expect(fallback, `${id} fallback ${fallbackId} exists`).toBeTruthy();
      expect(fallback.limitedSupply, `${id} fallback is not itself limited`).toBeUndefined();
      expect(fallback.id, `${id} fallback is a real ItemDef`).toBe(fallbackId);
    }
  });
});

describe('limited relics: drop-table wiring', () => {
  const dropItemIds = new Set(
    Object.values(LIMITED_DROPS).flatMap((entries) => entries.map((e) => e.itemId)),
  );

  it('every limited item drops from exactly one boss entry, and every entry is a real relic', () => {
    // Each relic appears in LIMITED_DROPS exactly once.
    const counts = new Map<string, number>();
    for (const entries of Object.values(LIMITED_DROPS))
      for (const e of entries) counts.set(e.itemId, (counts.get(e.itemId) ?? 0) + 1);
    for (const id of LIMITED_IDS) expect(counts.get(id), `${id} appears once`).toBe(1);
    // And no LIMITED_DROPS entry references a non-relic id.
    for (const id of dropItemIds) expect(LIMITED_ITEMS[id], `${id} is a relic`).toBeTruthy();
  });

  it('every LIMITED_DROPS key is a real boss mob template', () => {
    for (const bossId of Object.keys(LIMITED_DROPS))
      expect(MOBS[bossId], `${bossId} is a real mob`).toBeTruthy();
  });

  it('relic chances are in (0, 1]', () => {
    for (const entries of Object.values(LIMITED_DROPS))
      for (const e of entries) {
        expect(e.chance).toBeGreaterThan(0);
        expect(e.chance).toBeLessThanOrEqual(1);
      }
  });

  it('no relic id is listed in any mob loot array or in HEROIC_BOSS_LOOT', () => {
    // The relics roll through the separate append-only phase; putting one in a
    // main loot array or the heroic table would double-roll it and (for the
    // heroic table) break the item-level heroic sweep.
    for (const mob of Object.values(MOBS))
      for (const entry of mob.loot ?? [])
        expect(entry.itemId === undefined || !LIMITED_ITEMS[entry.itemId], entry.itemId ?? '').toBe(
          true,
        );
    for (const entries of Object.values(HEROIC_BOSS_LOOT))
      for (const entry of entries)
        expect(entry.itemId === undefined || !LIMITED_ITEMS[entry.itemId], entry.itemId ?? '').toBe(
          true,
        );
  });

  it('no relic is a questId-gated (multi-recipient personal) loot slot anywhere', () => {
    for (const mob of Object.values(MOBS))
      for (const entry of mob.loot ?? [])
        if (entry.itemId && LIMITED_ITEMS[entry.itemId])
          expect(entry.questId, `${entry.itemId} is not quest-gated`).toBeUndefined();
  });
});
