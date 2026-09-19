import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD } from '../src/sim/data';
import { seedItemDiscovery } from '../src/sim/deeds';
import {
  sanitizeVaultState,
  type VaultSpecialRef,
  vaultStoredCount,
} from '../src/sim/materials_vault';
import { Sim } from '../src/sim/sim';
import type { Entity, InvSlot, WorldContent } from '../src/sim/types';

const BANKER_ID = 'bursar_fernando';
const WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: { [BANKER_ID]: BUILTIN_WORLD.npcs[BANKER_ID] },
  groundObjects: [],
};

function makeSim(): Sim {
  const sim = new Sim({ seed: 73, playerClass: 'warrior', autoEquip: false, world: WORLD });
  const banker = [...sim.entities.values()].find(
    (e): e is Entity => e.kind === 'npc' && e.templateId === BANKER_ID,
  );
  if (!banker) throw new Error('banker did not spawn');
  sim.player.pos = { ...banker.pos };
  sim.player.prevPos = { ...banker.pos };
  sim.rebucket(sim.player);
  const meta = metaOf(sim);
  meta.inventory = [];
  meta.vault.upgrades = 1;
  return sim;
}

function metaOf(sim: Sim, pid = sim.playerId) {
  const meta = sim.meta(pid);
  if (!meta) throw new Error(`missing player ${pid}`);
  return meta;
}

function statsOf(slot: InvSlot): Record<string, number> {
  const stats = slot.instance?.rolled?.stats;
  if (!stats) throw new Error('expected rolled stats');
  return stats;
}

function ref(index: number, slot: InvSlot): VaultSpecialRef {
  return {
    index,
    ...(slot.instance === undefined ? {} : { instance: structuredClone(slot.instance) }),
    ...(slot.craftedRecipeId === undefined ? {} : { craftedRecipeId: slot.craftedRecipeId }),
  };
}

describe('identity-preserving Materials Vault stacks', () => {
  it('round-trips a deep-cloned instance and omits the empty saved collection', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const carried: InvSlot = {
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
      slot: 9,
    };
    meta.inventory.push(carried);

    sim.vaultDeposit(0);
    expect(meta.inventory).toEqual([]);
    expect(meta.vault.stock).toEqual({});
    // The legacy signer rides a SOURCE BUCKET now, not the payload. That is the
    // shared material model's projection (material_stack.ts
    // normalizeMaterialStack), applied by the packing core every material grant
    // goes through, and it is lossless in both directions: the same signature,
    // the same premium eligibility, one representation instead of two.
    expect(meta.vault.special).toEqual([
      {
        itemId: 'copper_ore',
        count: 1,
        instance: { rolled: { quality: 'rare', stats: { sta: 2 } } },
        materialSources: [{ source: { signer: 'Ada' }, count: 1 }],
      },
    ]);
    expect(meta.vault.special[0]).not.toBe(carried);
    expect(meta.vault.special[0].instance).not.toBe(carried.instance);
    statsOf(carried).sta = 99;
    expect(statsOf(meta.vault.special[0]).sta).toBe(2);

    const saved = sim.serializeCharacter(sim.playerId);
    if (!saved?.vault?.special) throw new Error('expected saved special vault row');
    expect(saved.vault?.special).toEqual(meta.vault.special);
    expect(saved.vault?.special).not.toBe(meta.vault.special);
    const reloadState = structuredClone(saved);
    statsOf(saved.vault.special[0]).sta = 7;
    expect(statsOf(meta.vault.special[0]).sta).toBe(2);

    const restored = new Sim({
      seed: 74,
      playerClass: 'warrior',
      autoEquip: false,
      noPlayer: true,
      world: WORLD,
    });
    const restoredPid = restored.addPlayer('warrior', 'Ada', { state: reloadState });
    const restoredSpecial = metaOf(restored, restoredPid).vault.special;
    expect(restoredSpecial).toEqual(meta.vault.special);
    expect(restoredSpecial).not.toBe(meta.vault.special);
    expect(restoredSpecial[0].instance).not.toBe(meta.vault.special[0].instance);

    const emptySim = makeSim();
    const empty = emptySim.serializeCharacter(emptySim.playerId);
    expect(empty?.vault).not.toHaveProperty('special');
  });

  it('returns a deep-cloned snapshot that cannot mutate live special identity', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.vault.special.push({
      itemId: 'copper_ore',
      count: 1,
      instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
      slot: 8,
    });

    const info = sim.vaultInfoFor(sim.playerId);
    if (!info) throw new Error('expected banker vault snapshot');
    expect(info.special[0]).not.toHaveProperty('slot');
    statsOf(info.special[0]).sta = 99;
    expect(statsOf(meta.vault.special[0]).sta).toBe(2);
  });

  it('shares one per-item cap across pooled stock and special stacks', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.vault.stock.copper_ore = 38;
    meta.vault.special.push({
      itemId: 'copper_ore',
      count: 1,
      craftedRecipeId: 'smelt_copper',
    });
    meta.inventory.push({ itemId: 'copper_ore', count: 3 });

    sim.vaultDeposit(0);

    expect(vaultStoredCount(meta.vault, 'copper_ore')).toBe(40);
    expect(meta.vault.stock.copper_ore).toBe(39);
    // The remainder carries its EXACT per-unit quantities, never a bare count:
    // two units nobody recorded a gatherer for are two units in the unrecorded
    // bucket. (The crafted row already in `special` cannot share with plain
    // stock, so this deposit still pools rather than folding.)
    expect(meta.inventory).toEqual([
      { itemId: 'copper_ore', count: 2, materialSources: [{ source: {}, count: 2 }] },
    ]);
  });

  it('moves whole-move payload stacks whole but permits partial recipe-only moves', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.vault.stock.copper_ore = 39;
    // A LOCKED payload is one identity per unit (vault_slot_ops.ts
    // vaultRowMovesWhole), so it deposits whole or not at all; a signer or
    // bind-on-trade payload splits like a plain stack now
    // (tests/materials_vault_row_packing.test.ts pins that arm).
    const instance: InvSlot = {
      itemId: 'copper_ore',
      count: 2,
      instance: { locked: true },
    };
    meta.inventory.push(instance);

    sim.vaultDeposit(0, 1);
    expect(meta.inventory).toEqual([instance]);
    expect(meta.vault.special).toEqual([]);

    sim.vaultDeposit(0);
    expect(meta.inventory).toEqual([instance]);
    expect(meta.vault.special).toEqual([]);
    expect(meta.vault.stock.copper_ore).toBe(39);

    meta.inventory.splice(0, 1, {
      itemId: 'copper_ore',
      count: 3,
      craftedRecipeId: 'smelt_copper',
    });
    sim.vaultDeposit(0);
    // Both halves carry their exact per-unit quantities.
    expect(meta.inventory).toEqual([
      {
        itemId: 'copper_ore',
        count: 2,
        craftedRecipeId: 'smelt_copper',
        materialSources: [{ source: {}, count: 2 }],
      },
    ]);
    expect(meta.vault.special).toEqual([
      {
        itemId: 'copper_ore',
        count: 1,
        craftedRecipeId: 'smelt_copper',
        materialSources: [{ source: {}, count: 1 }],
      },
    ]);
  });

  it('uses index plus fingerprint, scans on a stale index, and never falls back by item id', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const ada: InvSlot = { itemId: 'copper_ore', count: 1, instance: { signer: 'Ada' } };
    const ben: InvSlot = { itemId: 'copper_ore', count: 1, instance: { signer: 'Ben' } };
    meta.vault.special.push(ada, ben);

    // Ben's units come back with the signature in a SOURCE BUCKET (the shared
    // model's projection), not in the payload it was persisted under.
    const withdrawnBen = {
      itemId: 'copper_ore',
      count: 1,
      materialSources: [{ source: { signer: 'Ben' }, count: 1 }],
    };
    const staleBenRef = ref(0, ben);
    sim.vaultWithdraw('copper_ore', undefined, staleBenRef);
    expect(meta.vault.special).toEqual([ada]);
    expect(meta.inventory).toEqual([withdrawnBen]);

    const wrongRef: VaultSpecialRef = { index: 0, instance: { signer: 'Mallory' } };
    sim.vaultWithdraw('copper_ore', undefined, wrongRef);
    expect(meta.vault.special).toEqual([ada]);
    expect(meta.inventory).toEqual([withdrawnBen]);

    sim.vaultWithdraw('copper_ore');
    expect(meta.vault.special).toEqual([ada]);
    expect(meta.inventory).toEqual([withdrawnBen]);
  });

  it('sanitizes full payloads without aliasing, retains unknown rows, and keeps demoted rows special', () => {
    const raw = {
      stock: {},
      upgrades: 1,
      special: [
        {
          itemId: 'future_material',
          count: 2,
          craftedRecipeId: 'x'.repeat(100_000),
          instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 3 } } },
          slot: 27,
        },
        { itemId: 'copper_ore', count: 1, instance: {} },
      ],
    };
    const dropped: string[] = [];
    const clean = sanitizeVaultState(raw, 'Ada', dropped, 1);

    expect(clean.special).toEqual([
      // An UNKNOWN id with no source marker stays dormant exactly as stored:
      // the shared reader has no material model to apply to it, so it neither
      // normalizes nor refuses (its buckets are the thing that would be judged).
      {
        itemId: 'future_material',
        count: 2,
        instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 3 } } },
      },
      // A KNOWN material does normalize, so its one unit gets the unrecorded
      // bucket it always implied.
      { itemId: 'copper_ore', count: 1, materialSources: [{ source: {}, count: 1 }] },
    ]);
    expect(clean.special[0]).not.toBe(raw.special[0]);
    expect(clean.special[0].instance).not.toBe(raw.special[0].instance);
    expect(dropped).toContain('vault.future_material.craftedRecipeId');
    expect(dropped).toContain('vault.copper_ore.payload');
  });

  it('excludes special stacks from automatic crafting and seeds their rolled discovery quality', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.vault.special.push({
      itemId: 'copper_ore',
      count: 20,
      instance: { rolled: { quality: 'rare' } },
    });

    expect(sim.craftVaultStock).toEqual({});
    seedItemDiscovery((sim as unknown as { ctx: never }).ctx, meta);
    expect(meta.deedStats.itemsDiscovered.has('copper_ore')).toBe(true);
    expect(meta.deedStats.visited.has('quality:rare')).toBe(true);
  });
});

// Locking a stack of material is one flag over the WHOLE counted stack
// (item_lock.ts setItemLocked), never a per-unit identity like a charge-bearing
// payload; a deposit into the vault's identity collection must land it as ONE
// row carrying the full count, exactly like an unlocked stack would, rather
// than splitting it into a row per unit (the material_stack_packing.ts
// perFreshSlot regression a player hit locking a stack of 20 and depositing).
describe('a LOCKED material stack deposits as one whole vault row, never one row per unit', () => {
  it('vaultDeposit: lands the whole locked stack in a single special row', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    meta.inventory.push({ itemId: 'bone_fragments', count: 20 });

    sim.setItemLocked('bone_fragments', true, pid, 0);
    expect(meta.inventory).toHaveLength(1);
    expect(meta.inventory[0].instance).toEqual({ locked: true });

    sim.vaultDeposit(0);

    expect(meta.inventory).toEqual([]);
    expect(meta.vault.stock).toEqual({});
    const rows = meta.vault.special.filter((s) => s.itemId === 'bone_fragments');
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(20);
    expect(rows[0].instance).toEqual({ locked: true });
    expect(vaultStoredCount(meta.vault, 'bone_fragments')).toBe(20);
  });

  it('vaultDepositAll ("add all materials"): the same whole-stack result as the targeted deposit', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.inventory.push({ itemId: 'bone_fragments', count: 20 });

    sim.setItemLocked('bone_fragments', true, sim.playerId, 0);
    sim.vaultDepositAll();

    expect(meta.inventory).toEqual([]);
    const rows = meta.vault.special.filter((s) => s.itemId === 'bone_fragments');
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(20);
    expect(rows[0].instance).toEqual({ locked: true });
  });

  it('vaultWithdraw: the deposited locked row returns as ONE carried stack, not 20 withdrawals', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim);
    meta.inventory.push({ itemId: 'bone_fragments', count: 20 });
    sim.setItemLocked('bone_fragments', true, pid, 0);
    sim.vaultDeposit(0);
    const deposited = meta.vault.special.find((s) => s.itemId === 'bone_fragments');
    if (!deposited) throw new Error('expected the deposited locked row');

    sim.vaultWithdraw('bone_fragments', undefined, ref(0, deposited));

    expect(meta.vault.special.some((s) => s.itemId === 'bone_fragments')).toBe(false);
    const carried = meta.inventory.filter((s) => s.itemId === 'bone_fragments');
    expect(carried).toHaveLength(1);
    expect(carried[0].count).toBe(20);
    expect(carried[0].instance).toEqual({ locked: true });
  });

  it('deposits a tolerated OVER-CAP locked stack as two capped rows, not 25 one-unit rows', () => {
    // A single carried slot never legitimately exceeds the item's own stack
    // cap (item_lock.ts / bags.ts instancedCountCap holds a locked stack to
    // stackSizeOf), so the only way a locked stack of 25 carries a stack cap
    // of 20 is a tolerated legacy/hand-edited holding; the vault's own
    // per-material ceiling (40 at rung 1) still has room for all 25. The
    // deposit must split it into TWO capped rows [20, 5], not 25 rows of 1.
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.inventory.push({ itemId: 'bone_fragments', count: 25, instance: { locked: true } });

    sim.vaultDeposit(0);

    expect(meta.inventory).toEqual([]);
    const rows = meta.vault.special
      .filter((s) => s.itemId === 'bone_fragments')
      .sort((a, b) => b.count - a.count);
    expect(rows.map((s) => s.count)).toEqual([20, 5]);
    for (const row of rows) expect(row.instance).toEqual({ locked: true });
    expect(vaultStoredCount(meta.vault, 'bone_fragments')).toBe(25);
  });
});
