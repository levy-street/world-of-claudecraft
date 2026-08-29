// Host admission for crafting and enchanting from the Materials Vault.
//
// The server must be able to bound its durable audit outbox before the sim
// spends copper, a reagent, or an enchant victim. These tests drive the real
// resolvers through SimConfig's host seam and pin every mutable surface around
// that boundary. They also prove the callback receives a frozen canonical
// plan and that offline/headless omission remains an inert success.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { resolveCraftForRecipe } from '../src/sim/professions/crafting';
import { resolveApplyEnchant } from '../src/sim/professions/enchanting';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type {
  VaultConsumptionAdmission,
  VaultConsumptionReservation,
  VaultConsumptionTake,
} from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SWORD = 'eastbrook_arming_sword';
const MIGHT = 'enchant_weapon_might';
const AGILITY = 'enchant_weapon_agility';

// Reagent order is deliberately reverse-lexical. The host must see copper_ore
// before smithing_flux even though the recipe plans smithing_flux first.
const REVERSE_REAGENT_RECIPE: ProfessionRecipeRecord = {
  id: 'test_vault_admission_reverse_reagents',
  professionId: 'cooking',
  resultItemId: 'tough_jerky',
  resultCount: 1,
  reagents: [
    { itemId: 'smithing_flux', count: 2 },
    { itemId: 'copper_ore', count: 3 },
  ],
  skillReq: 0,
  itemLevelBudget: 5,
  level: 1,
};

interface AdmissionCall {
  pid: number;
  takes: readonly VaultConsumptionTake[];
  upgrades: number;
}

function makeSim(admission?: VaultConsumptionAdmission): Sim {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
    vaultConsumptionAdmission: admission,
  });
}

function metaOf(sim: Sim): PlayerMeta {
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('missing player meta');
  return meta;
}

function snapshotInventory(meta: PlayerMeta): PlayerMeta['inventory'] {
  return structuredClone(meta.inventory);
}

function denyingAdmission(calls: AdmissionCall[]): VaultConsumptionAdmission {
  return (pid, takes, upgrades) => {
    calls.push({ pid, takes, upgrades });
    return null;
  };
}

function seedReverseRecipeAttempt(meta: PlayerMeta, sim: Sim): void {
  sim.addItem('smithing_flux', 1, sim.playerId);
  meta.vault.stock = { smithing_flux: 1, copper_ore: 3 };
  meta.vault.upgrades = 4;
  meta.copper = 777;
}

function expectFrozenCanonicalCall(call: AdmissionCall, pid: number): void {
  expect(call).toMatchObject({
    pid,
    upgrades: 4,
    takes: [
      { itemId: 'copper_ore', count: 3 },
      { itemId: 'smithing_flux', count: 1 },
    ],
  });
  expect(Object.isFrozen(call.takes)).toBe(true);
  expect(call.takes.every(Object.isFrozen)).toBe(true);
}

describe('craft vault-consumption admission', () => {
  it('refuses before copper, bags, vault, output, rng, or wire revision changes', () => {
    const calls: AdmissionCall[] = [];
    const sim = makeSim(denyingAdmission(calls));
    const meta = metaOf(sim);
    seedReverseRecipeAttempt(meta, sim);
    const beforeInventory = snapshotInventory(meta);
    const beforeVault = structuredClone(meta.vault);
    const beforeCopper = meta.copper;
    const beforeOutput = sim.countItem(REVERSE_REAGENT_RECIPE.resultItemId, sim.playerId);
    let draws = 0;
    sim.ctx.rng.setObserver(() => {
      draws += 1;
    });

    const result = resolveCraftForRecipe(sim.ctx, sim.playerId, REVERSE_REAGENT_RECIPE);
    sim.ctx.rng.setObserver(null);

    expect(result).toEqual({
      ok: false,
      recipeId: REVERSE_REAGENT_RECIPE.id,
      reason: 'busy',
    });
    expect(draws).toBe(0);
    expect(meta.inventory).toEqual(beforeInventory);
    expect(meta.vault).toEqual(beforeVault);
    expect(meta.copper).toBe(beforeCopper);
    expect(sim.countItem(REVERSE_REAGENT_RECIPE.resultItemId, sim.playerId)).toBe(beforeOutput);
    expect(calls).toHaveLength(1);
    expectFrozenCanonicalCall(calls[0], sim.playerId);
  });

  it('commits once, only after the exact planned vault draw lands', () => {
    const calls: AdmissionCall[] = [];
    const commit = vi.fn();
    const cancel = vi.fn();
    let sim!: Sim;
    const admission: VaultConsumptionAdmission = (pid, takes, upgrades) => {
      calls.push({ pid, takes, upgrades });
      const reservation: VaultConsumptionReservation = {
        commit: () => {
          expect(metaOf(sim).vault.stock).toEqual({});
          commit();
        },
        cancel,
      };
      return reservation;
    };
    sim = makeSim(admission);
    const meta = metaOf(sim);
    seedReverseRecipeAttempt(meta, sim);

    const result = resolveCraftForRecipe(sim.ctx, sim.playerId, REVERSE_REAGENT_RECIPE);

    expect(result.ok).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expectFrozenCanonicalCall(calls[0], sim.playerId);
    expect(sim.countItem(REVERSE_REAGENT_RECIPE.resultItemId, sim.playerId)).toBe(1);
  });

  it('cancels (never commits) when the landed vault draw falls short of the plan', () => {
    // HOSTILE admission handle: the reserve callback itself drains the vault
    // stock between the plan and the apply loop, so consumePlayerVaultStock
    // refuses every planned take and the landed draw falls short. Unreachable
    // from an honest host (nothing runs between plan and apply), but the
    // reservation is the DURABLE AUDIT RECORD for the planned takes: a full
    // commit here would book units that never moved, so the resolver must
    // settle the mismatch as cancel, never commit (recording only what
    // committed; under-claiming is the safe direction).
    const commit = vi.fn();
    const cancel = vi.fn();
    let sim!: Sim;
    const admission: VaultConsumptionAdmission = () => {
      metaOf(sim).vault.stock = {};
      return { commit, cancel };
    };
    sim = makeSim(admission);
    const meta = metaOf(sim);
    seedReverseRecipeAttempt(meta, sim);

    const result = resolveCraftForRecipe(sim.ctx, sim.playerId, REVERSE_REAGENT_RECIPE);

    // The unreachable arm never denies the craft; only the audit record is
    // settled in the safe direction.
    expect(result.ok).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not call the host for a bags-only plan', () => {
    const admission = vi.fn<VaultConsumptionAdmission>(() => {
      throw new Error('bags-only craft must not reserve');
    });
    const sim = makeSim(admission);
    sim.addItem('spider_leg', 1, sim.playerId);
    const recipe: ProfessionRecipeRecord = {
      id: 'test_bags_only_admission',
      professionId: 'cooking',
      resultItemId: 'tough_jerky',
      resultCount: 1,
      reagents: [{ itemId: 'spider_leg', count: 1 }],
      skillReq: 0,
      itemLevelBudget: 1,
      level: 1,
    };

    expect(resolveCraftForRecipe(sim.ctx, sim.playerId, recipe).ok).toBe(true);
    expect(admission).not.toHaveBeenCalled();
  });

  it('keeps the offline default behavior when the config callback is omitted', () => {
    const sim = makeSim();
    const meta = metaOf(sim);
    meta.vault.stock = { spider_leg: 1 };
    meta.vault.upgrades = 1;
    const recipe: ProfessionRecipeRecord = {
      id: 'test_offline_vault_admission',
      professionId: 'cooking',
      resultItemId: 'tough_jerky',
      resultCount: 1,
      reagents: [{ itemId: 'spider_leg', count: 1 }],
      skillReq: 0,
      itemLevelBudget: 1,
      level: 1,
    };

    const result = resolveCraftForRecipe(sim.ctx, sim.playerId, recipe);

    expect(result.ok).toBe(true);
    expect(result.vaultDraws).toEqual([{ itemId: 'spider_leg', count: 1 }]);
    expect(meta.vault.stock).toEqual({});
    expect(sim.countItem('tough_jerky', sim.playerId)).toBe(1);
  });
});

describe('enchant vault-consumption admission', () => {
  it('refuses a plain bagged target without touching victim, bags, or vault', () => {
    const calls: AdmissionCall[] = [];
    const sim = makeSim(denyingAdmission(calls));
    const meta = metaOf(sim);
    sim.addItem(SWORD, 1, sim.playerId);
    sim.addItem('arcane_dust', 2, sim.playerId);
    meta.vault.stock = { arcane_dust: 3 };
    meta.vault.upgrades = 4;
    const beforeInventory = snapshotInventory(meta);
    const beforeVault = structuredClone(meta.vault);

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, MIGHT);

    expect(result).toEqual({ ok: false, itemId: SWORD, enchantId: MIGHT, reason: 'busy' });
    expect(meta.inventory).toEqual(beforeInventory);
    expect(meta.vault).toEqual(beforeVault);
    expect(sim.ctx.countFungibleItem(SWORD, sim.playerId)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pid: sim.playerId,
      upgrades: 4,
      takes: [{ itemId: 'arcane_dust', count: 3 }],
    });
  });

  it('refuses a worn target without touching gear, bags, stats, or vault', () => {
    const calls: AdmissionCall[] = [];
    const sim = makeSim(denyingAdmission(calls));
    const meta = metaOf(sim);
    sim.addItem(SWORD, 1, sim.playerId);
    sim.equipItemToSlot(SWORD, 'mainhand', sim.playerId);
    meta.vault.stock = { arcane_dust: 5 };
    meta.vault.upgrades = 2;
    const beforeInventory = snapshotInventory(meta);
    const beforeEquipment = structuredClone(meta.equipment);
    const beforeInstances = structuredClone(meta.equipmentInstance);
    const beforeStats = structuredClone(sim.player.stats);
    const beforeVault = structuredClone(meta.vault);

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, MIGHT, 'mainhand');

    expect(result).toEqual({ ok: false, itemId: SWORD, enchantId: MIGHT, reason: 'busy' });
    expect(meta.inventory).toEqual(beforeInventory);
    expect(meta.equipment).toEqual(beforeEquipment);
    expect(meta.equipmentInstance).toEqual(beforeInstances);
    expect(sim.player.stats).toEqual(beforeStats);
    expect(meta.vault).toEqual(beforeVault);
    expect(calls).toEqual([
      {
        pid: sim.playerId,
        upgrades: 2,
        takes: [{ itemId: 'arcane_dust', count: 5 }],
      },
    ]);
  });

  it('refuses a confirmed replacement before consuming the enchanted victim', () => {
    const calls: AdmissionCall[] = [];
    const sim = makeSim(denyingAdmission(calls));
    const meta = metaOf(sim);
    sim.addItem(SWORD, 1, sim.playerId);
    sim.addItem('arcane_dust', 5, sim.playerId);
    expect(resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, MIGHT).ok).toBe(true);
    expect(calls).toEqual([]);
    meta.vault.stock = { arcane_dust: 5 };
    meta.vault.upgrades = 3;
    const beforeInventory = snapshotInventory(meta);
    const beforeVault = structuredClone(meta.vault);

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, AGILITY, undefined, true);

    expect(result).toEqual({ ok: false, itemId: SWORD, enchantId: AGILITY, reason: 'busy' });
    expect(meta.inventory).toEqual(beforeInventory);
    expect(meta.vault).toEqual(beforeVault);
    expect(meta.inventory.find((slot) => slot.itemId === SWORD)?.instance?.enchant).toBe(MIGHT);
    expect(calls).toEqual([
      {
        pid: sim.playerId,
        upgrades: 3,
        takes: [{ itemId: 'arcane_dust', count: 5 }],
      },
    ]);
  });

  it('commits after a worn vault draw lands and before returning success', () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    let sim!: Sim;
    sim = makeSim(() => ({
      commit: () => {
        expect(metaOf(sim).vault.stock).toEqual({});
        commit();
      },
      cancel,
    }));
    const meta = metaOf(sim);
    sim.addItem(SWORD, 1, sim.playerId);
    sim.equipItemToSlot(SWORD, 'mainhand', sim.playerId);
    meta.vault.stock = { arcane_dust: 5 };
    meta.vault.upgrades = 1;

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, MIGHT, 'mainhand');

    expect(result.ok).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(meta.equipmentInstance.mainhand?.enchant).toBe(MIGHT);
  });

  it('cancels (never commits) a worn apply whose vault draw lands short', () => {
    // The enchant sibling of the craft mismatch arm above: the hostile
    // admission drains the stock during reserve, applyEnchantReagentDraw
    // moves nothing, and the settle must cancel rather than book the full
    // planned draw. The enchant itself still applies (the arm is unreachable
    // by construction and never denies).
    const commit = vi.fn();
    const cancel = vi.fn();
    let sim!: Sim;
    sim = makeSim(() => {
      metaOf(sim).vault.stock = {};
      return { commit, cancel };
    });
    const meta = metaOf(sim);
    sim.addItem(SWORD, 1, sim.playerId);
    sim.equipItemToSlot(SWORD, 'mainhand', sim.playerId);
    meta.vault.stock = { arcane_dust: 5 };
    meta.vault.upgrades = 1;

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, MIGHT, 'mainhand');

    expect(result.ok).toBe(true);
    expect(result.ok && result.vaultDraws).toBeFalsy();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(meta.equipmentInstance?.mainhand?.enchant).toBe(MIGHT);
  });

  it('cancels (never commits) a bagged REPLACE whose vault draw lands short', () => {
    // The #2415 bagged replace arm's sibling of the worn mismatch case above:
    // the hostile admission drains the stock during reserve, the pinned
    // enchanted victim is still consumed and re-minted with the new enchant,
    // and the settle must cancel rather than book the full planned draw.
    const commit = vi.fn();
    const cancel = vi.fn();
    let sim!: Sim;
    sim = makeSim(() => {
      metaOf(sim).vault.stock = {};
      return { commit, cancel };
    });
    const meta = metaOf(sim);
    sim.addItem(SWORD, 1, sim.playerId);
    sim.addItem('arcane_dust', 5, sim.playerId);
    // Bags-only first apply: no vault takes, so the hostile host is not called.
    expect(resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, MIGHT).ok).toBe(true);
    meta.vault.stock = { arcane_dust: 5 };
    meta.vault.upgrades = 1;

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, AGILITY, undefined, true);

    expect(result.ok).toBe(true);
    expect(result.ok && result.vaultDraws).toBeFalsy();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(meta.inventory.find((slot) => slot.itemId === SWORD)?.instance?.enchant).toBe(AGILITY);
  });

  it('cancels an accepted reservation when a post-reservation victim read no-ops', () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    const sim = makeSim(() => ({ commit, cancel }));
    const meta = metaOf(sim);
    sim.addItem(SWORD, 1, sim.playerId);
    meta.vault.stock = { arcane_dust: 5 };
    meta.vault.upgrades = 1;
    const beforeInventory = snapshotInventory(meta);
    const beforeVault = structuredClone(meta.vault);
    (sim.ctx as unknown as { removeEnchantableItem: () => [] }).removeEnchantableItem = () => [];

    const result = resolveApplyEnchant(sim.ctx, sim.playerId, SWORD, MIGHT);

    expect(result).toEqual({ ok: false, itemId: SWORD, enchantId: MIGHT, reason: 'not_held' });
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(meta.inventory).toEqual(beforeInventory);
    expect(meta.vault).toEqual(beforeVault);
  });
});

describe('craft quest-recompute gate over the vault pool', () => {
  it('fires the quest recompute for a vault draw, not only a carried one (source pin)', () => {
    // LATENT behavior, pinned by source and stated as such: no shipped quest
    // names a material (quests/quest_item_presence.ts documents this), and on
    // the craft path the output grant fires its own recompute immediately
    // after the gate, so no cheap black-box observation distinguishes the
    // widened gate from the old carried-only one. The vault still counts
    // toward playerHoldsQuestItem, so a vault-only draw reduces a store quest
    // presence reads and the gate must cover both pools. Comments are
    // stripped first so prose mentioning the tokens cannot satisfy the pin,
    // and the pin is anchored inside resolveCraftForRecipe's consumption
    // block by the neighboring onInventoryChangedForQuests call.
    const source = readFileSync(
      fileURLToPath(new URL('../src/sim/professions/crafting.ts', import.meta.url)),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const gate =
      /if \(meta && plans\.some\(\(plan\) => plan\.carried\.length > 0 \|\| plan\.vault\.length > 0\)\) \{\s*ctx\.onInventoryChangedForQuests\?\.\(meta\);/;
    expect(gate.test(source)).toBe(true);
  });
});

describe('enchant quest-recompute over the vault pool', () => {
  it('fires the quest recompute when an enchant draw takes from the vault (source pin)', async () => {
    // Same latent standard as the craft pin above: the carried half recomputes
    // via ctx.removeItem itself; the vault half must fire the hook at the one
    // shared emission site so a vault-only enchant draw cannot silently shrink
    // a store quest presence reads (quest_item_presence.ts).
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('./helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../src/sim/professions/enchanting.ts', import.meta.url), 'utf8'),
    );
    const emit = 'emitVaultCraftConsume(ctx, meta, drawn);';
    const site = src.indexOf(emit);
    expect(site).toBeGreaterThan(-1);
    // Anchored to the NEXT STATEMENT after the emit (not a fixed character
    // window, which could silently stop covering the call as the block grows):
    // in the comment-stripped source the recompute must be what immediately
    // follows the emission.
    const nextStatement = src.slice(site + emit.length).trimStart();
    expect(nextStatement.startsWith('ctx.onInventoryChangedForQuests(meta);')).toBe(true);
  });
});

describe('every settle site routes through settleVaultConsumptionReservation', () => {
  it('all four resolver arms call the shared settle helper (source pin)', async () => {
    // The four sites are the whole set of vault-consuming resolver arms:
    // crafting.ts resolveCraftForRecipe, plus enchanting.ts's worn apply,
    // bagged replace, and bagged apply. The worn, replace, and craft arms
    // have behavioural hostile-admission coverage above; the bagged apply arm
    // does not (its rig is the same shape but the arm is unreachable-by-bug
    // only), so this pin is what keeps any arm from silently losing the
    // settle rule in a refactor. Comments are stripped first so prose naming
    // the helper cannot stand in for the call, and the import specifier does
    // not match (no trailing paren).
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('./helpers/strip_comments');
    const count = (file: string): number => {
      const stripped = stripComments(
        readFileSync(new URL(`../src/sim/professions/${file}`, import.meta.url), 'utf8'),
      );
      return stripped.split('settleVaultConsumptionReservation(').length - 1;
    };
    expect(count('crafting.ts')).toBe(1);
    expect(count('enchanting.ts')).toBe(3);
  });
});
