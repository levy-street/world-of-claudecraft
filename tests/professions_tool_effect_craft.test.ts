// The acquisition craft's content contracts: the tool-effect charms
// (content/items.ts gatherers_cache / artisans_eye) and their enchanting
// recipes (content/recipes.ts TOOL_EFFECT_RECIPES).
//
// The free-grant incident is the reason half these arms exist: the slot
// command was once its own acquisition path (no item, no copper, no recipe),
// so the craftable set is DERIVED from the R9 slot policy here rather than
// trusted, and every economic edge (signing provenance, the never-vendored
// rule, the trainer route) gets its own pin. The mint-exceeds-recharge
// inequality lives beside the recharge suite's pricing pins in
// tests/professions_tool_effect_recharge.test.ts.

import { describe, expect, it } from 'vitest';
import { DELVE_SHOPS } from '../src/sim/content/delves';
import { HEROIC_VENDOR_STOCK } from '../src/sim/content/heroic_vendor';
import {
  GATHERING_PROFESSION_IDS,
  TOOL_EFFECT_IDS,
  TOOL_EFFECTS,
} from '../src/sim/content/professions';
import { ALL_RECIPES, recipeById, TOOL_EFFECT_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, NPCS, STATIONS } from '../src/sim/data';
import { resolveCraft } from '../src/sim/professions/crafting';
import { stationsOfType } from '../src/sim/professions/stations';
import { slotToolEffectRefused } from '../src/sim/professions/tools';
import { resolveTrain, trainingStationTypeFor } from '../src/sim/professions/training';
import { Sim } from '../src/sim/sim';
import type { ItemDef } from '../src/sim/types';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim, pid: number) {
  return (sim as unknown as { players: Map<number, ReturnType<never>> }).players.get(
    pid,
  ) as unknown as {
    name: string;
    copper: number;
    craftSkills: Record<string, number>;
    knownRecipes: Set<string>;
    inventory: { itemId: string; count: number; instance?: { signer?: string } }[];
  };
}

function placeAtStationFor(sim: Sim, pid: number, recipeId: string) {
  const recipe = recipeById(recipeId);
  if (!recipe) throw new Error(`unknown recipe ${recipeId}`);
  const stationType = trainingStationTypeFor(recipe);
  if (!stationType) throw new Error(`${recipeId} has no station home`);
  const station = stationsOfType(STATIONS, stationType)[0];
  const entity = (
    sim as unknown as {
      entities: Map<number, { pos: { x: number; z: number }; prevPos?: unknown }>;
    }
  ).entities.get(pid);
  if (!entity) throw new Error(`no entity ${pid}`);
  entity.pos.x = station.pos.x;
  entity.pos.z = station.pos.z;
  entity.prevPos = { ...entity.pos };
}

// Every effect item def, derived from ITEMS by the use variant, never from a
// hand list: the derivation is the point (an item added for a policy-refused
// effect must fail these arms without anyone remembering to list it).
const effectItems = Object.values(ITEMS).filter(
  (def): def is ItemDef & { use: { type: 'toolEffect'; effectId: string } } =>
    def.use?.type === 'toolEffect',
);

describe('the craftable set derives from the R9 slot policy (no path mints what another refuses)', () => {
  it('an effect has an item exactly when SOME profession accepts the slot', () => {
    for (const effectId of TOOL_EFFECT_IDS) {
      const mintableSomewhere = GATHERING_PROFESSION_IDS.some(
        (professionId) => !slotToolEffectRefused(professionId, effectId),
      );
      const items = effectItems.filter((def) => def.use.effectId === effectId);
      expect(
        items.length,
        `${effectId}: policy-mintable effects carry exactly one item, refused ones none`,
      ).toBe(mintableSomewhere ? 1 : 0);
    }
  });

  it('the two live effects are craftable and Springback is not (the policy today)', () => {
    // The derived arm above would stay green if the POLICY itself drifted;
    // this literal arm pins today's policy outcome so a policy widening is a
    // deliberate edit here, not a silent content unlock.
    expect(effectItems.map((def) => def.id).sort()).toEqual(['artisans_eye', 'gatherers_cache']);
    expect(
      effectItems.some((def) => def.use.effectId === 'quickening_charm'),
      'no Springback item may exist while the policy refuses respawnSpeed everywhere',
    ).toBe(false);
    expect(
      ALL_RECIPES.some((recipe) => recipe.resultItemId === 'quickening_charm'),
      'no recipe may mint a Springback charm',
    ).toBe(false);
  });

  it('every effect item is minted by exactly one recipe, and item id equals effect id', () => {
    for (const def of effectItems) {
      expect(def.id, 'item id and effect id are one identity').toBe(def.use.effectId);
      const minting = ALL_RECIPES.filter((recipe) => recipe.resultItemId === def.id);
      expect(minting.length, `${def.id} needs exactly one production recipe`).toBe(1);
      expect(TOOL_EFFECT_RECIPES.some((recipe) => recipe.resultItemId === def.id)).toBe(true);
    }
    expect(effectItems.length, 'the recipe table and the item set stay in lockstep').toBe(
      TOOL_EFFECT_RECIPES.length,
    );
  });

  it('every effect item def carries the shape the provenance chain depends on', () => {
    for (const def of effectItems) {
      // Rare quality is LOAD-BEARING: the craft signing rule (#1149) only
      // mints a signed { signer } instance for rare-or-better outputs, and the
      // signer is what the slot copies into craftedBy for the
      // original-crafter recharge discount. Dropping the quality silently
      // strips provenance from every future charm.
      expect(def.quality, `${def.id} must stay rare-or-better for the signing rule`).toBe('rare');
      expect(def.kind).toBe('tool');
      expect(def.buyValue, `${def.id} must never carry a copper price`).toBeUndefined();
      const effect = TOOL_EFFECTS[def.use.effectId as keyof typeof TOOL_EFFECTS];
      expect(effect, `${def.id} names a live catalog effect`).toBeDefined();
    }
  });

  it('no vendor, heroic, or delve counter stocks an effect charm', () => {
    const charmIds = new Set(effectItems.map((def) => def.id));
    for (const npc of Object.values(NPCS)) {
      for (const stocked of npc.vendorItems ?? []) {
        expect(charmIds.has(stocked), `${stocked} charm on ${npc.id}'s counter`).toBe(false);
      }
    }
    for (const row of HEROIC_VENDOR_STOCK) {
      expect(charmIds.has(row.itemId), `${row.itemId} charm on the heroic counter`).toBe(false);
    }
    for (const shop of Object.values(DELVE_SHOPS)) {
      for (const entry of shop) {
        expect(charmIds.has(entry.itemId), `${entry.itemId} charm on a delve counter`).toBe(false);
      }
    }
    // Non-vacuity: the sweep really walked stocked counters.
    expect(Object.values(NPCS).some((npc) => (npc.vendorItems ?? []).length > 0)).toBe(true);
    expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
    expect(Object.keys(DELVE_SHOPS).length).toBeGreaterThan(0);
  });
});

describe('the trainer route (enchanting home, toolworks binding)', () => {
  it('resolveTrain teaches the charm recipes at the toolworks, tier-gated on enchanting', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    meta.copper = 50000;
    const recipe = TOOL_EFFECT_RECIPES[0];

    // Away from every station: out of range, even with skill and fee.
    meta.craftSkills.enchanting = 25;
    const away = resolveTrain(STATIONS, meta as never, { x: 0, z: 150 }, recipe.id);
    expect(away.ok).toBe(false);
    expect(away.reason).toBe('train_out_of_range');

    // At the toolworks without the enchanting tier: tier unmet (the tier gate
    // reads the recipe's OWN craft, enchanting, never engineering).
    const station = stationsOfType(STATIONS, 'toolworks')[0];
    meta.craftSkills.enchanting = 0;
    meta.craftSkills.engineering = 120;
    const unmet = resolveTrain(STATIONS, meta as never, station.pos, recipe.id);
    expect(unmet.ok).toBe(false);
    expect(unmet.reason).toBe('train_tier_unmet');

    // At the toolworks with enchanting 25: teachable for the tier-1 fee.
    meta.craftSkills.enchanting = 25;
    const ok = resolveTrain(STATIONS, meta as never, station.pos, recipe.id);
    expect(ok.ok).toBe(true);
    expect(ok.fee).toBe(2500);
  });

  it('Sim.trainRecipe learns the charm recipe end to end and charges the fee once', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    const recipe = TOOL_EFFECT_RECIPES[1];
    meta.copper = 3000;
    meta.craftSkills.enchanting = 25;
    placeAtStationFor(sim, pid, recipe.id);
    sim.trainRecipe(recipe.id, pid);
    expect(meta.knownRecipes.has(recipe.id)).toBe(true);
    expect(meta.copper).toBe(500);
    // A duplicate command re-resolves train_already_known before any charge.
    sim.trainRecipe(recipe.id, pid);
    expect(meta.copper).toBe(500);
  });
});

describe('the production craft writes the crafter provenance', () => {
  it('a crafted charm is a signed instance carrying the crafter name', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    const recipe = TOOL_EFFECT_RECIPES[0];
    meta.knownRecipes.add(recipe.id);
    placeAtStationFor(sim, pid, recipe.id);
    for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count, pid);

    const result = resolveCraft((sim as unknown as { ctx: never }).ctx, pid, recipe.id);

    expect(result.ok).toBe(true);
    const slot = meta.inventory.find((entry) => entry.itemId === recipe.resultItemId);
    expect(slot, 'the charm landed in bags').toBeDefined();
    // The #1149 signing rule fires off the rare def quality: every copy is a
    // signed instance, and the signer IS the craftedBy the slot will record.
    expect(slot?.instance?.signer).toBe(meta.name);
    // All-or-nothing reagent consumption really consumed the ladder.
    for (const reagent of recipe.reagents) {
      expect(sim.countItem(reagent.itemId, pid)).toBe(0);
    }
  });

  it('a craft without the reagents refuses and mints nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    const recipe = TOOL_EFFECT_RECIPES[0];
    meta.knownRecipes.add(recipe.id);
    placeAtStationFor(sim, pid, recipe.id);
    sim.addItem('arcane_shard', 1, pid);

    const result = resolveCraft((sim as unknown as { ctx: never }).ctx, pid, recipe.id);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('insufficient_materials');
    expect(sim.countItem(recipe.resultItemId, pid)).toBe(0);
    expect(sim.countItem('arcane_shard', pid)).toBe(1);
  });
});
