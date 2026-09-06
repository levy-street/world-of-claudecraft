// The Materials Vault's SOURCE-AWARE half (PR2): deposits, withdrawals,
// save/load and the automatic craft draw, with per-unit attribution preserved
// whole.
//
// What this suite is here to prove, stated up front because the vault now has
// TWO stores and it is easy to over-credit a case:
//
// - `stock` stays the compact legacy representation for unattributed material.
//   A stack that carries real provenance cannot live there (a count map has
//   nowhere to put a gatherer), so it lands in `special` beside the existing
//   identity-bearing rows. That routing decision is the whole feature.
// - Nothing about the automatic craft draw's ELIGIBILITY moves. Before this
//   change no `special` row was ever auto-drawable, and the reason was that
//   every one of them was premium, rolled, bound, locked or recipe-marked.
//   Plainly gathered material is none of those, so it stays eligible after the
//   representation change; a premium bucket stays ineligible, including inside
//   a MIXED row, where the row exposes its eligible count rather than refusing
//   whole.
// - Every refusal is a no-op in BOTH stores, and every projection is a fresh
//   boundary value that cannot mint or double-draw.
import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  canonicalMaterialComposition,
  type MaterialComposition,
  type MaterialGatherer,
  type MaterialSource,
  materialSourceKey,
  totalMaterialCount,
} from '../src/sim/material_sources';
import {
  consumeVaultStock,
  craftVaultStockFor,
  sanitizeVaultState,
  savedVaultState,
  type VaultSpecialRef,
  vaultStoredCount,
} from '../src/sim/materials_vault';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, WorldContent } from '../src/sim/types';
import { vaultDrawBlocked, vaultDrawStock } from '../src/sim/vault_craft_gate';
import { placeInDungeon, placeInOpenWorld } from './helpers/instanced_contexts';
import { EMPTY_TEST_WORLD } from './sim_shared';

// --- fixtures ---------------------------------------------------------------

const ANA: MaterialGatherer = { kind: 'character', id: 11, name: 'Ana' };
const BRU: MaterialGatherer = { kind: 'character', id: 12, name: 'Bru' };

const anaSource: MaterialSource = { gatherer: ANA };
const bruSource: MaterialSource = { gatherer: BRU };
const unknownSource: MaterialSource = {};
const premiumSource: MaterialSource = { signer: 'Cyn' };
const emptySignerSource: MaterialSource = { signer: '' };

/** The canonical composition builder, so a fixture can never assert against a
 *  hand-ordered list the algebra would have re-ordered. */
function composition(rows: readonly { source: MaterialSource; count: number }[]) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const built = canonicalMaterialComposition(rows, total);
  if (!built.ok) throw new Error(`bad fixture composition: ${built.error}`);
  return built.value;
}

/** Buckets as a descriptor-keyed count map: order-independent, and it fails
 *  loudly on a duplicate key rather than silently overwriting one. */
function buckets(sources: MaterialComposition | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of sources ?? []) {
    const key = materialSourceKey(entry.source);
    if (Object.hasOwn(out, key)) throw new Error(`uncoalesced bucket ${key}`);
    out[key] = entry.count;
  }
  return out;
}

const ANA_KEY = materialSourceKey(anaSource);
const BRU_KEY = materialSourceKey(bruSource);
const UNKNOWN_KEY = materialSourceKey(unknownSource);
const PREMIUM_KEY = materialSourceKey(premiumSource);
const EMPTY_SIGNER_KEY = materialSourceKey(emptySignerSource);

/** Every physical unit the vault holds under one id, both stores summed. The
 *  conservation yardstick: no operation may change it except by exactly what
 *  it moved. */
function storedUnits(sim: Sim, itemId: string, pid = sim.playerId): number {
  return vaultStoredCount(metaOf(sim, pid).vault, itemId);
}

function carriedUnits(sim: Sim, itemId: string, pid = sim.playerId): number {
  let total = 0;
  for (const slot of metaOf(sim, pid).inventory) if (slot.itemId === itemId) total += slot.count;
  return total;
}

// --- harnesses --------------------------------------------------------------

const BANKER_ID = 'bursar_fernando';
const BANKER_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [BANKER_ID]: BUILTIN_WORLD.npcs[BANKER_ID] },
  groundObjects: [],
};

function metaOf(sim: Sim, pid = sim.playerId) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing player ${pid}`);
  return meta;
}

/** A player standing at a bursar with an unlocked vault and empty bags: the
 *  deposit/withdraw commands' one legal position. */
function bankerSim(): Sim {
  const sim = new Sim({ seed: 73, playerClass: 'warrior', autoEquip: false, world: BANKER_WORLD });
  const banker = [...sim.entities.values()].find(
    (e): e is Entity => e.kind === 'npc' && e.templateId === BANKER_ID,
  );
  if (!banker) throw new Error('banker did not spawn');
  sim.player.pos = { ...banker.pos };
  sim.player.prevPos = { ...banker.pos };
  sim.rebucket(sim.player);
  const meta = metaOf(sim);
  meta.inventory = [];
  meta.vault.upgrades = 1; // the 40-per-material rung
  return sim;
}

/** A player in the open world, where the craft draw is allowed. Terrain only:
 *  the draw path reads position and membership, never an NPC. */
function openWorldSim(): Sim {
  const sim = new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
  });
  placeInOpenWorld(sim, sim.playerId);
  metaOf(sim).vault.upgrades = 1;
  return sim;
}

function ref(index: number, slot: InvSlot): VaultSpecialRef {
  return {
    index,
    ...(slot.instance === undefined ? {} : { instance: structuredClone(slot.instance) }),
    ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
  };
}

// ---------------------------------------------------------------------------
// Storage: where an attributed stack lands, and how its buckets coalesce
// ---------------------------------------------------------------------------

describe('source-bearing deposits land in the identity collection, coalesced', () => {
  it('stores 3 Ana + 5 Bru + 2 unrecorded as ONE row of ten with three buckets', () => {
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 10,
      materialSources: composition([
        { source: anaSource, count: 3 },
        { source: bruSource, count: 5 },
        { source: unknownSource, count: 2 },
      ]),
    });

    sim.vaultDeposit(0);

    expect(meta.inventory).toEqual([]);
    // The compact map cannot express a gatherer, so nothing lands there.
    expect(meta.vault.stock).toEqual({});
    expect(meta.vault.special).toHaveLength(1);
    const row = meta.vault.special[0];
    expect(row.count).toBe(10);
    expect(buckets(row.materialSources)).toEqual({
      [ANA_KEY]: 3,
      [BRU_KEY]: 5,
      [UNKNOWN_KEY]: 2,
    });
    expect(totalMaterialCount(row.materialSources ?? [])).toBe(row.count);
    expect(storedUnits(sim, 'copper_ore')).toBe(10);
  });

  it('coalesces a second deposit from the SAME gatherer into the existing bucket', () => {
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 3,
      materialSources: composition([{ source: anaSource, count: 3 }]),
    });
    sim.vaultDeposit(0);
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 2,
      materialSources: composition([{ source: anaSource, count: 2 }]),
    });
    sim.vaultDeposit(0);

    expect(meta.vault.special).toHaveLength(1);
    expect(meta.vault.special[0].count).toBe(5);
    expect(buckets(meta.vault.special[0].materialSources)).toEqual({ [ANA_KEY]: 5 });
  });

  it('keeps a plain unattributed material in the compact stock map (no new rows)', () => {
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.inventory.push({ itemId: 'copper_ore', count: 6 });

    sim.vaultDeposit(0);

    expect(meta.vault.stock).toEqual({ copper_ore: 6 });
    expect(meta.vault.special).toEqual([]);
  });

  it('a source-bearing deposit ABSORBS the compatible legacy stock instead of doubling it', () => {
    // The migrate-on-touch rule: the same material must never be visible as a
    // compact chip AND an identity row at once. The legacy units join the block
    // as unrecorded stock, which is exactly what they are.
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.vault.stock.copper_ore = 7;
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 3,
      materialSources: composition([{ source: anaSource, count: 3 }]),
    });

    sim.vaultDeposit(0);

    expect(Object.hasOwn(meta.vault.stock, 'copper_ore')).toBe(false);
    expect(meta.vault.special).toHaveLength(1);
    expect(meta.vault.special[0].count).toBe(10);
    expect(buckets(meta.vault.special[0].materialSources)).toEqual({
      [UNKNOWN_KEY]: 7,
      [ANA_KEY]: 3,
    });
    expect(storedUnits(sim, 'copper_ore')).toBe(10); // conserved exactly
  });

  it('leaves the legacy stock alone when the incoming block cannot share with it', () => {
    // A payload-bearing block is a different identity: folding plain units into
    // it would hand them a rolled quality nobody rolled.
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.vault.stock.copper_ore = 7;
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 3,
      instance: { rolled: { quality: 'rare', stats: { sta: 2 } } },
      materialSources: composition([{ source: anaSource, count: 3 }]),
    });

    sim.vaultDeposit(0);

    expect(meta.vault.stock).toEqual({ copper_ore: 7 });
    expect(meta.vault.special).toHaveLength(1);
    expect(meta.vault.special[0].count).toBe(3);
    expect(storedUnits(sim, 'copper_ore')).toBe(10);
  });

  it('an exact PARTIAL deposit takes the default spend order and conserves both halves', () => {
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 10,
      materialSources: composition([
        { source: anaSource, count: 3 },
        { source: bruSource, count: 5 },
        { source: unknownSource, count: 2 },
      ]),
    });

    sim.vaultDeposit(0, 4); // unrecorded first, then plain by canonical key

    expect(buckets(meta.vault.special[0].materialSources)).toEqual({
      [UNKNOWN_KEY]: 2,
      [ANA_KEY]: 2,
    });
    expect(buckets(meta.inventory[0].materialSources)).toEqual({ [ANA_KEY]: 1, [BRU_KEY]: 5 });
    expect(meta.inventory[0].count).toBe(6);
    expect(storedUnits(sim, 'copper_ore') + carriedUnits(sim, 'copper_ore')).toBe(10);
  });

  it('strips the bank/bags owner grouping flag on transfer into the vault', () => {
    // Manual separation is an owner flag on the BANK and the bags. This store
    // has no separation feature, its wire key list does not carry the field
    // (src/net/vault_snapshot_wire.ts SPECIAL_KEY_LIST), and a deposit strips it
    // with the rest of the owner's container metadata. Persisting one here
    // would produce rows the browser boundary drops.
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 4,
      materialSeparated: true,
      materialSources: composition([{ source: anaSource, count: 4 }]),
    });

    sim.vaultDeposit(0);

    expect(meta.vault.special[0]).toEqual({
      itemId: 'copper_ore',
      count: 4,
      materialSources: [{ source: anaSource, count: 4 }],
    });
    expect(Object.hasOwn(meta.vault.special[0], 'materialSeparated')).toBe(false);
  });

  it('the batched sweep routes an attributed slot exactly like the targeted deposit', () => {
    const targeted = bankerSim();
    const swept = bankerSim();
    const slot = (): InvSlot => ({
      itemId: 'copper_ore',
      count: 5,
      materialSources: composition([
        { source: anaSource, count: 2 },
        { source: unknownSource, count: 3 },
      ]),
    });
    metaOf(targeted).inventory.push(slot());
    metaOf(swept).inventory.push(slot());

    targeted.vaultDeposit(0);
    swept.vaultDepositAll();

    expect(metaOf(swept).vault.special).toEqual(metaOf(targeted).vault.special);
    expect(metaOf(swept).vault.stock).toEqual(metaOf(targeted).vault.stock);
  });
});

// ---------------------------------------------------------------------------
// Withdrawal: exact takes, conserved counts, capacity decided before mutation
// ---------------------------------------------------------------------------

describe('withdrawing from a mixed block', () => {
  function stocked(): { sim: Sim; row: InvSlot } {
    const sim = bankerSim();
    const meta = metaOf(sim);
    meta.vault.special.push({
      itemId: 'copper_ore',
      count: 10,
      materialSources: composition([
        { source: anaSource, count: 3 },
        { source: bruSource, count: 5 },
        { source: unknownSource, count: 2 },
      ]),
    });
    return { sim, row: meta.vault.special[0] };
  }

  it('a partial withdraw takes the default spend order and conserves every unit', () => {
    const { sim, row } = stocked();
    const meta = metaOf(sim);

    sim.vaultWithdraw('copper_ore', 4, ref(0, row));

    expect(buckets(meta.vault.special[0].materialSources)).toEqual({ [ANA_KEY]: 1, [BRU_KEY]: 5 });
    expect(meta.vault.special[0].count).toBe(6);
    const carried = meta.inventory.find((s) => s.itemId === 'copper_ore');
    expect(carried?.count).toBe(4);
    expect(buckets(carried?.materialSources)).toEqual({ [UNKNOWN_KEY]: 2, [ANA_KEY]: 2 });
    expect(storedUnits(sim, 'copper_ore') + carriedUnits(sim, 'copper_ore')).toBe(10);
  });

  it('CLAMPS an over-count to the held amount rather than refusing it', () => {
    const { sim, row } = stocked();
    const meta = metaOf(sim);

    sim.vaultWithdraw('copper_ore', 99, ref(0, row));

    expect(meta.vault.special).toEqual([]);
    expect(carriedUnits(sim, 'copper_ore')).toBe(10);
  });

  it('refuses into FULL bags without touching either store', () => {
    const { sim, row } = stocked();
    const meta = metaOf(sim);
    // Sixteen occupied slots with no copper_ore stack to top up: no fit at all.
    for (let i = 0; i < 16; i++) meta.inventory.push({ itemId: 'iron_ore', count: 1 });
    const before = structuredClone(meta.vault);

    sim.vaultWithdraw('copper_ore', 4, ref(0, row));

    expect(meta.vault).toEqual(before);
    expect(carriedUnits(sim, 'copper_ore')).toBe(0);
    expect(storedUnits(sim, 'copper_ore')).toBe(10);
  });

  it('the withdrawn stack owns its buckets: mutating it never reaches the vault', () => {
    const { sim, row } = stocked();
    const meta = metaOf(sim);

    sim.vaultWithdraw('copper_ore', 2, ref(0, row));

    const carried = meta.inventory.find((s) => s.itemId === 'copper_ore');
    expect(carried?.materialSources).not.toBe(meta.vault.special[0].materialSources);
    expect(carried?.materialSources?.[0]).not.toBe(meta.vault.special[0].materialSources?.[0]);
  });
});

// ---------------------------------------------------------------------------
// The automatic craft draw: eligibility is EXACTLY what it was
// ---------------------------------------------------------------------------

describe('automatic craft eligibility survives the representation change', () => {
  function withRows(rows: readonly InvSlot[], stock: Record<string, number> = {}): Sim {
    const sim = openWorldSim();
    const meta = metaOf(sim);
    meta.vault.special.push(...rows.map((row) => structuredClone(row)));
    Object.assign(meta.vault.stock, stock);
    return sim;
  }

  /** A payload-bearing row whose buckets are all plain: the case that proves
   *  eligibility is decided by the PAYLOAD and not by the provenance. */
  function payloadRow(instance: InvSlot['instance']): InvSlot {
    return {
      itemId: 'copper_ore',
      count: 4,
      instance,
      materialSources: composition([{ source: anaSource, count: 4 }]),
    };
  }

  const mixedRow: InvSlot = {
    itemId: 'copper_ore',
    count: 10,
    materialSources: composition([
      { source: unknownSource, count: 2 },
      { source: anaSource, count: 3 },
      { source: premiumSource, count: 5 },
    ]),
  };

  it('a MIXED row exposes its eligible count, never a whole-row refusal', () => {
    const sim = withRows([mixedRow]);
    const pid = sim.playerId;

    // 2 unrecorded + 3 gatherer-only; the 5 premium units stay invisible.
    expect(craftVaultStockFor(sim.ctx, pid)).toEqual({ copper_ore: 5 });
  });

  it('spends exactly the non-premium buckets and leaves the premium ones whole', () => {
    const sim = withRows([mixedRow]);
    const meta = metaOf(sim);

    expect(consumeVaultStock(meta.vault, 'copper_ore', 5)).toBe(true);

    expect(meta.vault.special).toHaveLength(1);
    expect(meta.vault.special[0].count).toBe(5);
    expect(buckets(meta.vault.special[0].materialSources)).toEqual({ [PREMIUM_KEY]: 5 });
    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({});
  });

  it('refuses a draw that would have to reach a premium bucket, mutating nothing', () => {
    const sim = withRows([mixedRow]);
    const meta = metaOf(sim);
    const before = structuredClone(meta.vault);

    expect(consumeVaultStock(meta.vault, 'copper_ore', 6)).toBe(false);

    expect(meta.vault).toEqual(before);
  });

  it('a legacy SIGNED row stays entirely undrawable, exactly as before', () => {
    const sim = withRows([{ itemId: 'copper_ore', count: 4, instance: { signer: 'Cyn' } }]);

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({});
    expect(consumeVaultStock(metaOf(sim).vault, 'copper_ore', 1)).toBe(false);
  });

  it('a row carrying a ROLLED quality stays undrawable even with plain buckets', () => {
    const sim = withRows([payloadRow({ rolled: { quality: 'rare', stats: { sta: 2 } } })]);

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({});
    expect(consumeVaultStock(metaOf(sim).vault, 'copper_ore', 1)).toBe(false);
  });

  it('a BOUND row stays undrawable even with plain buckets', () => {
    const sim = withRows([payloadRow({ boundTo: 11 })]);

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({});
    expect(consumeVaultStock(metaOf(sim).vault, 'copper_ore', 1)).toBe(false);
  });

  it('a LOCKED row stays undrawable even with plain buckets', () => {
    const sim = withRows([payloadRow({ locked: true })]);

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({});
    expect(consumeVaultStock(metaOf(sim).vault, 'copper_ore', 1)).toBe(false);
  });

  it('a recipe-marked row stays undrawable even with plain buckets', () => {
    const sim = withRows([
      {
        itemId: 'copper_ore',
        count: 4,
        craftedRecipeId: 'recipe_copper_bar',
        materialSources: composition([{ source: anaSource, count: 4 }]),
      },
    ]);

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({});
  });

  it('an EMPTY-string signer is legacy stock, not a premium signature', () => {
    // The old truthiness rule, restated: an empty signer conveys nothing, so
    // its units stay ordinary spendable material AND keep their own bucket.
    const sim = withRows([
      {
        itemId: 'copper_ore',
        count: 6,
        materialSources: composition([
          { source: emptySignerSource, count: 2 },
          { source: unknownSource, count: 1 },
          { source: premiumSource, count: 3 },
        ]),
      },
    ]);
    const meta = metaOf(sim);

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({ copper_ore: 3 });
    expect(consumeVaultStock(meta.vault, 'copper_ore', 3)).toBe(true);
    expect(buckets(meta.vault.special[0].materialSources)).toEqual({ [PREMIUM_KEY]: 3 });
    // Never coalesced into the unrecorded bucket while it was there.
    expect(EMPTY_SIGNER_KEY).not.toBe(UNKNOWN_KEY);
  });

  it('sums the compact store and the eligible identity rows into one answer', () => {
    const sim = withRows([mixedRow], { copper_ore: 4 });
    const meta = metaOf(sim);

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({ copper_ore: 9 });

    // The compact store pays first (it IS unrecorded stock), then the buckets.
    expect(consumeVaultStock(meta.vault, 'copper_ore', 6)).toBe(true);
    expect(Object.hasOwn(meta.vault.stock, 'copper_ore')).toBe(false);
    expect(meta.vault.special[0].count).toBe(8);
    expect(storedUnits(sim, 'copper_ore')).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// The projection is a boundary value, not a licence to mint
// ---------------------------------------------------------------------------

describe('the drawable projection cannot mint or double-draw', () => {
  function mixedSim(): Sim {
    const sim = openWorldSim();
    metaOf(sim).vault.special.push({
      itemId: 'copper_ore',
      count: 8,
      materialSources: composition([
        { source: unknownSource, count: 3 },
        { source: anaSource, count: 2 },
        { source: premiumSource, count: 3 },
      ]),
    });
    metaOf(sim).vault.stock.copper_ore = 2;
    return sim;
  }

  it('spends down to exactly the projected total and then refuses', () => {
    const sim = mixedSim();
    const meta = metaOf(sim);
    const projected = craftVaultStockFor(sim.ctx, sim.playerId)?.copper_ore;
    expect(projected).toBe(7); // 2 compact + 3 unrecorded + 2 gatherer-only

    expect(consumeVaultStock(meta.vault, 'copper_ore', 4)).toBe(true);
    expect(consumeVaultStock(meta.vault, 'copper_ore', 3)).toBe(true);
    expect(consumeVaultStock(meta.vault, 'copper_ore', 1)).toBe(false);

    expect(storedUnits(sim, 'copper_ore')).toBe(3); // the premium units, untouched
    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({});
  });

  it('a BORROWED projection is a fresh record: writing to it moves no stock', () => {
    const sim = mixedSim();
    const meta = metaOf(sim);
    const first = craftVaultStockFor(sim.ctx, sim.playerId);
    const second = craftVaultStockFor(sim.ctx, sim.playerId);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).not.toBe(meta.vault.stock);
    if (first) first.copper_ore = 999;

    expect(storedUnits(sim, 'copper_ore')).toBe(10);
    expect(consumeVaultStock(meta.vault, 'copper_ore', 8)).toBe(false);
  });

  it('vaultDrawStock answers the SAME projection, and null exactly when blocked', () => {
    const sim = mixedSim();
    const pid = sim.playerId;

    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(false);
    expect(vaultDrawStock(sim.ctx, pid)).toEqual(craftVaultStockFor(sim.ctx, pid));
    // Not the live record: a consumer that wrote to it would otherwise mint.
    expect(vaultDrawStock(sim.ctx, pid)).not.toBe(metaOf(sim).vault.stock);

    placeInDungeon(sim, pid);

    // The place gate itself is untouched by any of this.
    expect(vaultDrawBlocked(sim.ctx, pid)).toBe(true);
    expect(vaultDrawStock(sim.ctx, pid)).toBeNull();
    expect(craftVaultStockFor(sim.ctx, pid)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Malformed provenance: refused whole, never dropped and never flattened
// ---------------------------------------------------------------------------

describe('an unreadable source row refuses the whole operation', () => {
  // Buckets that sum to three inside a stack of four: a real total the save
  // never stated, which is the one thing the loader must not paper over.
  const malformed: InvSlot = {
    itemId: 'copper_ore',
    count: 4,
    materialSources: [{ source: {}, count: 3 }],
  };

  function withMalformed(): Sim {
    const sim = bankerSim();
    metaOf(sim).vault.special.push(structuredClone(malformed));
    return sim;
  }

  it('refuses a deposit of the same material, moving nothing', () => {
    const sim = withMalformed();
    const meta = metaOf(sim);
    meta.inventory.push({
      itemId: 'copper_ore',
      count: 3,
      materialSources: composition([{ source: anaSource, count: 3 }]),
    });
    const before = structuredClone(meta.vault);

    sim.vaultDeposit(0);

    expect(meta.vault).toEqual(before);
    expect(meta.inventory[0].count).toBe(3);
  });

  it('refuses a withdraw of the unreadable row, moving nothing', () => {
    const sim = withMalformed();
    const meta = metaOf(sim);
    const before = structuredClone(meta.vault);

    sim.vaultWithdraw('copper_ore', 2, { index: 0 });

    expect(meta.vault).toEqual(before);
    expect(carriedUnits(sim, 'copper_ore')).toBe(0);
  });

  it('hides the unreadable row from the draw while the compact store still pays', () => {
    const sim = openWorldSim();
    const meta = metaOf(sim);
    meta.vault.special.push(structuredClone(malformed));
    meta.vault.stock.copper_ore = 3;

    expect(craftVaultStockFor(sim.ctx, sim.playerId)).toEqual({ copper_ore: 3 });
    expect(consumeVaultStock(meta.vault, 'copper_ore', 4)).toBe(false);
    expect(consumeVaultStock(meta.vault, 'copper_ore', 3)).toBe(true);
    expect(meta.vault.special[0].count).toBe(4); // dormant, never spent, never deleted
  });

  it('the LOAD REFUSES THE WHOLE SAVE rather than keeping a row it cannot read', () => {
    // The shared material_slot_load.ts pre-validate, the SAME policy the carried
    // bags, the personal bank and the guild book apply to this corruption. It
    // runs before anything is registered and before a count clamp could erase
    // what the buckets said. There is deliberately no vault-local tolerant arm:
    // a store that quietly kept a row the character save would have refused is
    // how unreadable attribution outlives the save that carried it.
    expect(() =>
      sanitizeVaultState({ stock: {}, special: [structuredClone(malformed)], upgrades: 1 }),
    ).toThrow();
  });

  it('refuses a slot-level signer BESIDE a composition (which reading is the truth?)', () => {
    expect(() =>
      sanitizeVaultState({
        stock: {},
        upgrades: 1,
        special: [
          {
            itemId: 'copper_ore',
            count: 2,
            instance: { signer: 'Cyn' },
            materialSources: [{ source: { gatherer: { ...ANA } }, count: 2 }],
          },
        ],
      }),
    ).toThrow();
  });

  it('refuses an explicit MULTI-UNIT charged composition', () => {
    // A counted stack shares ONE payload object, so buckets claiming several
    // charge-bearing units are claiming copies that cannot exist.
    expect(() =>
      sanitizeVaultState({
        stock: {},
        upgrades: 1,
        special: [
          {
            itemId: 'copper_ore',
            count: 2,
            instance: { charges: 3 },
            materialSources: [{ source: {}, count: 2 }],
          },
        ],
      }),
    ).toThrow();
  });

  it('refuses a KNOWN NON-material id that acquired a source marker', () => {
    // guardian_core is a real item and deliberately outside the material set,
    // so a marker on it would be a way past its own load rules.
    expect(() =>
      sanitizeVaultState({
        stock: {},
        upgrades: 1,
        special: [
          { itemId: 'guardian_core', count: 1, materialSources: [{ source: {}, count: 1 }] },
        ],
      }),
    ).toThrow();
  });

  it('a LEGACY charged row with no composition still clamps to one, as it always did', () => {
    const state = sanitizeVaultState({
      stock: {},
      upgrades: 1,
      special: [{ itemId: 'copper_ore', count: 5, instance: { charges: 3 } }],
    });

    expect(state.special[0].count).toBe(1);
  });

  it('keeps a LEGAL legacy over-cap material holding whole', () => {
    // The shared material exemption sits in front of the instanced tamper
    // ceiling: capacity blocks new deposits, it never truncates what is there.
    const state = sanitizeVaultState({
      stock: {},
      upgrades: 1,
      special: [
        { itemId: 'copper_ore', count: 60, instance: { rolled: { quality: 'rare' } } },
        {
          itemId: 'iron_ore',
          count: 55,
          materialSources: [{ source: { gatherer: { ...ANA } }, count: 55 }],
        },
      ],
    });

    expect(state.special[0].count).toBe(60);
    expect(state.special[1].count).toBe(55);
  });

  it('preserves a dormant UNKNOWN item id carrying VALID sources', () => {
    // A removed material stays recoverable: the shared reader validates its
    // buckets against the id itself rather than refusing it for being unknown.
    const state = sanitizeVaultState({
      stock: {},
      upgrades: 1,
      special: [
        {
          itemId: 'future_material',
          count: 2,
          materialSources: [{ source: { gatherer: { ...ANA } }, count: 2 }],
        },
      ],
    });

    expect(state.special).toEqual([
      {
        itemId: 'future_material',
        count: 2,
        materialSources: [{ source: anaSource, count: 2 }],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Persistence: the buckets round-trip, and nothing aliases across the boundary
// ---------------------------------------------------------------------------

describe('save and load preserve attribution without aliasing', () => {
  function populated() {
    const state = sanitizeVaultState({ stock: { rough_hide: 4 }, upgrades: 2 });
    state.special.push(
      {
        itemId: 'copper_ore',
        count: 10,
        materialSources: composition([
          { source: anaSource, count: 3 },
          { source: bruSource, count: 5 },
          { source: unknownSource, count: 2 },
        ]),
      },
      {
        itemId: 'iron_ore',
        count: 3,
        materialSources: composition([{ source: premiumSource, count: 3 }]),
      },
    );
    return state;
  }

  it('round-trips deep-equal through save -> JSON -> load -> save', () => {
    const live = populated();
    const saved = savedVaultState(live);
    const reloaded = sanitizeVaultState(JSON.parse(JSON.stringify(saved)));

    expect(reloaded.stock).toEqual(live.stock);
    expect(reloaded.special).toEqual(live.special);
    expect(reloaded.upgrades).toBe(live.upgrades);
    expect(savedVaultState(reloaded)).toEqual(saved);
  });

  it('never persists the bank/bags grouping flag, whatever a blob claims', () => {
    // This store has no separation feature and its wire key list does not carry
    // the field, so a row that arrives with one loads WITHOUT it rather than
    // producing rows the browser boundary would drop.
    const reloaded = sanitizeVaultState({
      stock: {},
      upgrades: 1,
      special: [
        {
          itemId: 'copper_ore',
          count: 2,
          materialSeparated: true,
          materialSources: [{ source: {}, count: 2 }],
        },
      ],
    });

    expect(reloaded.special).toEqual([
      { itemId: 'copper_ore', count: 2, materialSources: [{ source: {}, count: 2 }] },
    ]);
    expect(Object.hasOwn(reloaded.special[0], 'materialSeparated')).toBe(false);
  });

  it('the saved blob owns its buckets: writing to it never reaches the live vault', () => {
    const live = populated();
    const saved = savedVaultState(live);

    expect(saved.special?.[0].materialSources).not.toBe(live.special[0].materialSources);
    (saved.special?.[0] as { materialSources?: unknown }).materialSources = [];

    expect(buckets(live.special[0].materialSources)).toEqual({
      [ANA_KEY]: 3,
      [BRU_KEY]: 5,
      [UNKNOWN_KEY]: 2,
    });
  });

  it('a pre-feature row projects its legacy signer into a descriptor on load', () => {
    // Lossless and one-way: the payload the signer emptied is gone, the same
    // signature rides a bucket, and the row is byte-identical to what a fresh
    // deposit of that stack would store, so load and deposit cannot disagree.
    const reloaded = sanitizeVaultState({
      stock: { copper_ore: 5 },
      special: [{ itemId: 'copper_ore', count: 2, instance: { signer: 'Cyn' } }],
      upgrades: 1,
    });

    expect(reloaded.stock).toEqual({ copper_ore: 5 });
    expect(reloaded.special).toEqual([
      { itemId: 'copper_ore', count: 2, materialSources: [{ source: premiumSource, count: 2 }] },
    ]);
  });

  it('is a fixed point: loading its own output changes nothing', () => {
    const once = sanitizeVaultState(JSON.parse(JSON.stringify(savedVaultState(populated()))));
    const twice = sanitizeVaultState(JSON.parse(JSON.stringify(savedVaultState(once))));

    expect(twice).toEqual(once);
  });
});

// ---------------------------------------------------------------------------
// Read and spend agree, on every arm
// ---------------------------------------------------------------------------

describe('the projected total is exactly what the spend will pay', () => {
  const cases: { label: string; stock: Record<string, number>; special: InvSlot[] }[] = [
    { label: 'compact only', stock: { copper_ore: 6 }, special: [] },
    {
      label: 'identity only',
      stock: {},
      special: [
        {
          itemId: 'copper_ore',
          count: 6,
          materialSources: composition([
            { source: unknownSource, count: 4 },
            { source: premiumSource, count: 2 },
          ]),
        },
      ],
    },
    {
      label: 'both stores',
      stock: { copper_ore: 2 },
      special: [
        {
          itemId: 'copper_ore',
          count: 5,
          materialSources: composition([
            { source: anaSource, count: 3 },
            { source: premiumSource, count: 2 },
          ]),
        },
      ],
    },
    {
      label: 'two identity rows, one ineligible',
      stock: { copper_ore: 1 },
      special: [
        {
          itemId: 'copper_ore',
          count: 3,
          materialSources: composition([{ source: bruSource, count: 3 }]),
        },
        {
          itemId: 'copper_ore',
          count: 2,
          instance: { rolled: { quality: 'rare' } },
          materialSources: composition([{ source: anaSource, count: 2 }]),
        },
      ],
    },
    {
      label: 'an unreadable row beside a compact one',
      stock: { copper_ore: 3 },
      special: [{ itemId: 'copper_ore', count: 4, materialSources: [{ source: {}, count: 3 }] }],
    },
    { label: 'nothing at all', stock: {}, special: [] },
  ];

  for (const shape of cases) {
    it(`pays exactly the projected units and refuses one more: ${shape.label}`, () => {
      const sim = openWorldSim();
      const meta = metaOf(sim);
      Object.assign(meta.vault.stock, shape.stock);
      meta.vault.special.push(...shape.special.map((row) => structuredClone(row)));
      const held = storedUnits(sim, 'copper_ore');

      const projected = craftVaultStockFor(sim.ctx, sim.playerId)?.copper_ore ?? 0;
      // One more than the read promises must refuse, and one at a time up to it
      // must all succeed: neither arm may be the more permissive one.
      expect(consumeVaultStock(meta.vault, 'copper_ore', projected + 1)).toBe(false);
      for (let i = 0; i < projected; i++) {
        expect(consumeVaultStock(meta.vault, 'copper_ore', 1)).toBe(true);
      }
      expect(consumeVaultStock(meta.vault, 'copper_ore', 1)).toBe(false);

      // Exactly the projected units left, and not one unit more or fewer.
      expect(storedUnits(sim, 'copper_ore')).toBe(held - projected);
      expect(craftVaultStockFor(sim.ctx, sim.playerId)?.copper_ore ?? 0).toBe(0);
    });
  }
});
