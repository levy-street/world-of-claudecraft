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
    expect(meta.vault.special).toEqual([
      {
        itemId: 'copper_ore',
        count: 1,
        instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 2 } } },
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
    expect(meta.inventory).toEqual([{ itemId: 'copper_ore', count: 2 }]);
  });

  it('moves instance stacks whole but permits partial recipe-only moves', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.vault.stock.copper_ore = 39;
    const instance: InvSlot = {
      itemId: 'copper_ore',
      count: 2,
      instance: { signer: 'Ada' },
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
    expect(meta.inventory).toEqual([
      { itemId: 'copper_ore', count: 2, craftedRecipeId: 'smelt_copper' },
    ]);
    expect(meta.vault.special).toEqual([
      { itemId: 'copper_ore', count: 1, craftedRecipeId: 'smelt_copper' },
    ]);
  });

  it('uses index plus fingerprint, scans on a stale index, and never falls back by item id', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    const ada: InvSlot = { itemId: 'copper_ore', count: 1, instance: { signer: 'Ada' } };
    const ben: InvSlot = { itemId: 'copper_ore', count: 1, instance: { signer: 'Ben' } };
    meta.vault.special.push(ada, ben);

    const staleBenRef = ref(0, ben);
    sim.vaultWithdraw('copper_ore', undefined, staleBenRef);
    expect(meta.vault.special).toEqual([ada]);
    expect(meta.inventory).toEqual([ben]);

    const wrongRef: VaultSpecialRef = { index: 0, instance: { signer: 'Mallory' } };
    sim.vaultWithdraw('copper_ore', undefined, wrongRef);
    expect(meta.vault.special).toEqual([ada]);
    expect(meta.inventory).toEqual([ben]);

    sim.vaultWithdraw('copper_ore');
    expect(meta.vault.special).toEqual([ada]);
    expect(meta.inventory).toEqual([ben]);
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
      {
        itemId: 'future_material',
        count: 2,
        instance: { signer: 'Ada', rolled: { quality: 'rare', stats: { sta: 3 } } },
      },
      { itemId: 'copper_ore', count: 1 },
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
