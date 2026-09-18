// The Materials Vault's identity rows are ONE row per material identity,
// however many units it holds: the vault has no bag cells, so a row is bounded
// by the per-material ceiling (materials_vault.ts), never by the carried bag
// stack size (vault_slot_ops.ts VAULT_ROW_STACK_SIZE). Eighty sourced herbs are
// one row of eighty, not four rows of twenty.
//
// - A deposit tops up the compatible row instead of opening a capped sibling.
// - A save written while rows WERE capped at the bag stack size folds back into
//   one row per identity on load (coalesceVaultRows), total unchanged, with a
//   row the fold may not touch left exactly as loaded.
// - Which payloads split is the ONE rule vaultRowMovesWhole states: a
//   charge-bearing or locked payload moves whole; a signer or bind-on-trade
//   payload (the disenchant secondaries) splits on deposit and withdraw the
//   way the bags already split it.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { materialItemIds } from '../src/sim/material_ids';
import type { MaterialComposition } from '../src/sim/material_sources';
import {
  sanitizeVaultState,
  VAULT_BASE_CAP,
  VAULT_UPGRADE_PRICES,
  VAULT_UPGRADE_STEP,
} from '../src/sim/materials_vault';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, WorldContent } from '../src/sim/types';
import {
  coalesceVaultRows,
  VAULT_ROW_STACK_SIZE,
  vaultRowMovesWhole,
} from '../src/sim/vault_slot_ops';

const ORE = 'copper_ore';
const BANKER_ID = 'bursar_fernando';

const STORAGE_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [BANKER_ID]: BUILTIN_WORLD.npcs[BANKER_ID] },
  groundObjects: [],
};

const ana = (count: number) => ({
  source: { gatherer: { kind: 'character' as const, id: 11, name: 'Ana' } },
  count,
});
const bru = (count: number) => ({
  source: { gatherer: { kind: 'character' as const, id: 22, name: 'Bru' } },
  count,
});

function metaOf(sim: Sim) {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  return meta;
}

/** A warrior standing at the banker with empty bags and a rung-2 vault (an
 *  80-unit per-material ceiling, so four bag stacks of one material fit). */
function atBanker(): Sim {
  const sim = new Sim({ seed: 73, playerClass: 'warrior', autoEquip: false, world: STORAGE_WORLD });
  const banker = [...sim.entities.values()].find(
    (entity): entity is Entity => entity.kind === 'npc' && entity.templateId === BANKER_ID,
  );
  if (!banker) throw new Error('banker did not spawn');
  sim.player.pos = { ...banker.pos };
  sim.player.prevPos = { ...banker.pos };
  sim.rebucket(sim.player);
  const meta = metaOf(sim);
  meta.inventory = [];
  meta.vault.upgrades = 2;
  return sim;
}

function bucket(composition: MaterialComposition | undefined, name: string): number {
  return (composition ?? [])
    .filter((entry) => entry.source.gatherer?.name === name)
    .reduce((sum, entry) => sum + entry.count, 0);
}

describe('vault identity rows pack at the vault row size', () => {
  it('is bounded by the per-material ceiling, never the bag stack', () => {
    // The highest ceiling the upgrade ladder can reach: a cap raise cannot
    // outgrow the row size without moving this pin.
    const topCap = VAULT_BASE_CAP + VAULT_UPGRADE_STEP * VAULT_UPGRADE_PRICES.length;
    expect(VAULT_ROW_STACK_SIZE).toBeGreaterThanOrEqual(topCap);
  });

  it('tops up the one compatible row across four bag-stack deposits', () => {
    const sim = atBanker();
    const meta = metaOf(sim);
    meta.inventory = [
      { itemId: ORE, count: 20, materialSources: [ana(20)] },
      { itemId: ORE, count: 20, materialSources: [bru(20)] },
      { itemId: ORE, count: 20, materialSources: [ana(10), bru(10)] },
      { itemId: ORE, count: 20, materialSources: [ana(20)] },
    ];
    for (let i = 0; i < 4; i++) sim.vaultDeposit(0);
    expect(meta.inventory).toEqual([]);
    expect(meta.vault.special).toHaveLength(1);
    const [row] = meta.vault.special;
    expect(row.count).toBe(80);
    expect(bucket(row.materialSources, 'Ana')).toBe(50);
    expect(bucket(row.materialSources, 'Bru')).toBe(30);
    // The wire snapshot shows the same single row.
    expect(sim.vaultInfo?.special.map((slot) => slot.count)).toEqual([80]);
  });

  it('withdraws a bag stack at a time back out of the one row', () => {
    const sim = atBanker();
    const meta = metaOf(sim);
    meta.vault.special = [{ itemId: ORE, count: 80, materialSources: [ana(50), bru(30)] }];
    sim.vaultWithdraw(ORE, 20, { index: 0 });
    expect(meta.vault.special.map((slot) => slot.count)).toEqual([60]);
    expect(meta.inventory.map((slot) => slot.count)).toEqual([20]);
    // The packed row is what the default spend order now reads, so pin the
    // buckets on both sides: the first bucket (Ana) is spent first, whole.
    expect(bucket(meta.inventory[0].materialSources, 'Ana')).toBe(20);
    expect(bucket(meta.inventory[0].materialSources, 'Bru')).toBe(0);
    expect(bucket(meta.vault.special[0].materialSources, 'Ana')).toBe(30);
    expect(bucket(meta.vault.special[0].materialSources, 'Bru')).toBe(30);
    sim.vaultWithdraw(ORE, 60, { index: 0 });
    expect(meta.vault.special).toEqual([]);
    // The bags stack at THEIR size: four carried stacks of twenty.
    expect(meta.inventory.map((slot) => slot.count)).toEqual([20, 20, 20, 20]);
  });
});

describe('a save with bag-stack-capped rows folds on load', () => {
  it('reads four rows of twenty as one row of eighty', () => {
    const state = sanitizeVaultState({
      stock: {},
      upgrades: 2,
      special: [
        { itemId: ORE, count: 20, materialSources: [ana(20)] },
        { itemId: ORE, count: 20, materialSources: [bru(20)] },
        { itemId: ORE, count: 20, materialSources: [ana(20)] },
        { itemId: ORE, count: 20, materialSources: [bru(20)] },
      ],
    });
    expect(state.special).toHaveLength(1);
    expect(state.special[0]).toMatchObject({ itemId: ORE, count: 80 });
    expect(bucket(state.special[0].materialSources, 'Ana')).toBe(40);
    expect(bucket(state.special[0].materialSources, 'Bru')).toBe(40);
  });

  it('keeps distinct identities apart and leaves an untouched row by reference', () => {
    const plain: InvSlot = { itemId: ORE, count: 5, materialSources: [ana(5)] };
    const recipe: InvSlot = { itemId: ORE, count: 3, craftedRecipeId: 'smelt_copper' };
    const other: InvSlot = { itemId: 'iron_ore', count: 4, materialSources: [bru(4)] };
    const plainAgain: InvSlot = { itemId: ORE, count: 7, materialSources: [bru(7)] };
    const folded = coalesceVaultRows([plain, recipe, other, plainAgain], materialItemIds());
    expect(folded).not.toBeNull();
    expect(folded?.map((row) => [row.itemId, row.count, row.craftedRecipeId])).toEqual([
      [ORE, 12, undefined],
      [ORE, 3, 'smelt_copper'],
      ['iron_ore', 4, undefined],
    ]);
    // Rows nothing folded into are the loaded objects themselves.
    expect(folded?.[1]).toBe(recipe);
    expect(folded?.[2]).toBe(other);
  });

  it('folds two legacy signer-payload rows into one bucketed row with no payload', () => {
    // The fold rebuilds through the shared normalize, which is the shape the
    // deposit path already stores: the signer moves from the payload into a
    // source bucket. A silent migration, pinned so it stays deliberate.
    const state = sanitizeVaultState({
      stock: {},
      upgrades: 2,
      special: [
        { itemId: ORE, count: 20, instance: { signer: 'Ada' } },
        { itemId: ORE, count: 20, instance: { signer: 'Ada' } },
      ],
    });
    expect(state.special).toHaveLength(1);
    expect(state.special[0].count).toBe(40);
    expect(state.special[0].instance).toBeUndefined();
    const signed = (state.special[0].materialSources ?? []).filter(
      (entry) => entry.source.signer === 'Ada',
    );
    expect(signed.reduce((sum, entry) => sum + entry.count, 0)).toBe(40);
  });

  it('reports nothing to fold, and never splits a whole-move payload row', () => {
    const locked: InvSlot = { itemId: ORE, count: 3, instance: { locked: true } };
    const lockedAgain: InvSlot = { itemId: ORE, count: 2, instance: { locked: true } };
    const dormant: InvSlot = { itemId: 'not_a_material', count: 20 };
    expect(coalesceVaultRows([locked, lockedAgain, dormant], materialItemIds())).toBeNull();
  });
});

describe('which payloads split (vaultRowMovesWhole)', () => {
  it('pins charge-bearing and locked payloads to whole moves and nothing else', () => {
    expect(vaultRowMovesWhole(undefined)).toBe(false);
    expect(vaultRowMovesWhole({ signer: 'Ada' })).toBe(false);
    expect(vaultRowMovesWhole({ bindOnTrade: true })).toBe(false);
    expect(vaultRowMovesWhole({ locked: true })).toBe(true);
    expect(vaultRowMovesWhole({ charges: { use: 3 } })).toBe(true);
  });

  it('withdraws part of a bind-on-trade row, the payload riding both halves', () => {
    const sim = atBanker();
    const meta = metaOf(sim);
    meta.vault.special = [
      { itemId: ORE, count: 5, instance: { bindOnTrade: true }, materialSources: [ana(5)] },
    ];
    sim.vaultWithdraw(ORE, 2, { index: 0, instance: { bindOnTrade: true } });
    expect(meta.vault.special).toHaveLength(1);
    expect(meta.vault.special[0]).toMatchObject({ count: 3, instance: { bindOnTrade: true } });
    expect(meta.inventory).toHaveLength(1);
    expect(meta.inventory[0]).toMatchObject({
      itemId: ORE,
      count: 2,
      instance: { bindOnTrade: true },
    });
    expect(bucket(meta.inventory[0].materialSources, 'Ana')).toBe(2);
  });

  it('deposits part of a bind-on-trade stack', () => {
    const sim = atBanker();
    const meta = metaOf(sim);
    meta.inventory = [
      { itemId: ORE, count: 5, instance: { bindOnTrade: true }, materialSources: [ana(5)] },
    ];
    sim.vaultDeposit(0, 2);
    expect(meta.inventory).toHaveLength(1);
    expect(meta.inventory[0]).toMatchObject({ count: 3, instance: { bindOnTrade: true } });
    expect(meta.vault.special).toHaveLength(1);
    expect(meta.vault.special[0]).toMatchObject({ count: 2, instance: { bindOnTrade: true } });
  });

  it('refuses to deposit part of a locked stack, or the whole of one that does not fit', () => {
    const sim = atBanker();
    const meta = metaOf(sim);
    const locked = (): InvSlot => ({ itemId: ORE, count: 3, instance: { locked: true } });
    meta.inventory = [locked()];
    sim.vaultDeposit(0, 1);
    expect(meta.inventory).toEqual([locked()]);
    expect(meta.vault.special).toEqual([]);
    // Headroom 2 of the 80 cap: a locked stack of 3 moves whole or not at all.
    meta.vault.stock = { [ORE]: 78 };
    sim.vaultDeposit(0);
    expect(meta.inventory).toEqual([locked()]);
    expect(meta.vault.special).toEqual([]);
    expect(meta.vault.stock).toEqual({ [ORE]: 78 });
  });

  it('still refuses to split a locked row', () => {
    const sim = atBanker();
    const meta = metaOf(sim);
    meta.vault.special = [{ itemId: ORE, count: 3, instance: { locked: true } }];
    sim.vaultWithdraw(ORE, 1, { index: 0, instance: { locked: true } });
    expect(meta.vault.special.map((slot) => slot.count)).toEqual([3]);
    expect(meta.inventory).toEqual([]);
  });
});
