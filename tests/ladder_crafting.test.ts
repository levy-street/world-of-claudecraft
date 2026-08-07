// The 54 LADDER_RECIPES execute end to end through the real
// craft path (station gate satisfied, reagents consumed, output produced),
// the four specimen consumers consume their always-signed instance reagent,
// Sim.trainRecipe charges the real ladder rungs (free rung 0, exactly 10000
// at rung 50), the three crafted elixir defs are pinned literally and apply
// through the live use path, and the silkspun_satchel bag contributes its
// authored capacity. The static ladder SHAPE pins live in
// tests/recipe_economy.test.ts; this file is the execution arm.
import { describe, expect, it } from 'vitest';
import { bagCapacity, stackSizeOf } from '../src/sim/bags';
import { HARVEST_COMPONENT_SPECIMENS } from '../src/sim/content/professions';
import { LADDER_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, STATIONS } from '../src/sim/data';
import { stationsOfType } from '../src/sim/professions/stations';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';
import { expectDefined } from './helpers/defined';
import { runCraft } from './helpers/enchant_family_cast';

const SPECIMEN_IDS = new Set(Object.values(HARVEST_COMPONENT_SPECIMENS));

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}
function metaOf(sim: Sim, pid: number): PlayerMeta {
  return expectDefined(sim.players.get(pid));
}
function primaryOf(sim: Sim): number {
  return sim.primaryId;
}
function placeAt(sim: Sim, pid: number, pos: { x: number; z: number }) {
  const entity = expectDefined(sim.entities.get(pid));
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { ...entity.pos };
}

describe('ladder recipe execution sweep (all 54)', () => {
  it('every ladder recipe crafts at its station: reagents consumed, output produced', () => {
    const sim = makeSim(7);
    const pid = primaryOf(sim);
    const meta = metaOf(sim, pid);
    meta.copper = 10_000_000;
    expect(LADDER_RECIPES.length).toBe(54);
    for (const recipe of LADDER_RECIPES) {
      // Clean slate per recipe so the count asserts below are exact.
      meta.inventory.length = 0;
      meta.craftThrottle.count = 0;
      meta.craftSkills[recipe.professionId] = recipe.skillReq;
      meta.knownRecipes.add(recipe.id);
      for (const reagent of recipe.reagents) {
        if (SPECIMEN_IDS.has(reagent.itemId)) {
          // Specimens arrive from harvests ONLY as signed single-count
          // instances (src/sim/interaction.ts); grant them the same way so
          // the craft consumes real instance slots.
          for (let i = 0; i < reagent.count; i++) {
            sim.addItemInstance(reagent.itemId, { signer: meta.name }, pid);
          }
        } else {
          sim.addItem(reagent.itemId, reagent.count, pid);
        }
      }
      placeAt(sim, pid, stationsOfType(STATIONS, expectDefined(recipe.stationType))[0].pos);
      runCraft(sim, recipe.id, false, pid);
      expect(meta.lastCraftResult?.ok, `${recipe.id}: ${meta.lastCraftResult?.reason}`).toBe(true);
      expect(sim.countItem(recipe.resultItemId, pid), `${recipe.id} output`).toBe(
        recipe.resultCount,
      );
      for (const reagent of recipe.reagents) {
        expect(sim.countItem(reagent.itemId, pid), `${recipe.id} leftover ${reagent.itemId}`).toBe(
          0,
        );
      }
    }
  });

  it('the five specimen consumers consume the signed instance slot itself', () => {
    // One recipe per specimen family (pinned literally in
    // tests/recipe_economy.test.ts's demand block; pristine_claw joined via
    // mirewarden_treads when #2905's claw family got its consumers); the
    // assert above already proves count 0, this pins that no UNSIGNED grant
    // would have satisfied the sweep: the granted reagent was a signed
    // instance slot.
    const consumers = LADDER_RECIPES.filter((r) =>
      r.reagents.some((reagent) => SPECIMEN_IDS.has(reagent.itemId)),
    );
    expect(consumers.map((r) => r.id).sort()).toEqual([
      'recipe_elixir_of_the_serpent',
      'recipe_marlows_grand_roast',
      'recipe_mirewarden_jerkin',
      'recipe_mirewarden_treads',
      'recipe_silkbinders_raiment',
    ]);
    for (const recipe of consumers) {
      const specimenReagents = recipe.reagents.filter((r) => SPECIMEN_IDS.has(r.itemId));
      expect(specimenReagents.length).toBeGreaterThan(0);
      for (const reagent of specimenReagents) {
        // Always-signed single-count instances: exactly count 1 per recipe
        // (a multi-specimen cost would demand multiple jackpot slots).
        expect(reagent.count, `${recipe.id} ${reagent.itemId}`).toBe(1);
      }
    }
  });
});

describe('Sim.trainRecipe on real ladder rungs', () => {
  it('trains a rung-0 ladder recipe free of charge at its master', () => {
    const sim = makeSim(11);
    const pid = primaryOf(sim);
    const meta = metaOf(sim, pid);
    const rung0 = expectDefined(
      LADDER_RECIPES.find((r) => r.professionId === 'weaponcrafting' && r.skillReq === 0),
    );
    placeAt(sim, pid, stationsOfType(STATIONS, expectDefined(rung0.stationType))[0].pos);
    const copperBefore = meta.copper;
    sim.trainRecipe(rung0.id, pid);
    expect(meta.lastTrainResult?.ok).toBe(true);
    expect(meta.lastTrainResult?.fee).toBe(0);
    expect(meta.copper).toBe(copperBefore);
    expect(meta.knownRecipes.has(rung0.id)).toBe(true);
  });

  it('trains a rung-50 ladder recipe for exactly 10000 copper', () => {
    const sim = makeSim(11);
    const pid = primaryOf(sim);
    const meta = metaOf(sim, pid);
    const rung50 = expectDefined(
      LADDER_RECIPES.find((r) => r.professionId === 'weaponcrafting' && r.skillReq === 50),
    );
    meta.craftSkills.weaponcrafting = 50;
    meta.copper = 10_005;
    placeAt(sim, pid, stationsOfType(STATIONS, expectDefined(rung50.stationType))[0].pos);
    sim.trainRecipe(rung50.id, pid);
    expect(meta.lastTrainResult?.ok).toBe(true);
    expect(meta.lastTrainResult?.fee).toBe(10_000);
    expect(meta.copper).toBe(5);
    expect(meta.knownRecipes.has(rung50.id)).toBe(true);
  });
});

describe('crafted elixir defs and the live use path', () => {
  // Literal def pins: a typo'd value, duration, aura name, or kind in any of
  // the three crafted elixirs would otherwise ship silently (the elixir
  // MECHANISM is pinned via elixir_of_the_bear in tests/elixir.test.ts).
  const EXPECTED: Record<string, { aura: string; value: number; duration: number }> = {
    elixir_of_the_boar: { aura: 'Might of the Boar', value: 6, duration: 600 },
    venomfire_elixir: { aura: 'Vipersear Vigor', value: 9, duration: 900 },
    elixir_of_the_serpent: { aura: 'Might of the Serpent', value: 12, duration: 900 },
  };

  it('pins the three elixir blocks literally (at or below the bear precedent)', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.kind, id).toBe('elixir');
      expect(def.elixir, id).toEqual({ ...expected, kind: 'buff_sta' });
      // The per-item power ceiling is the pre-existing bear elixir (12).
      expect(expectDefined(def.elixir).value).toBeLessThanOrEqual(
        expectDefined(ITEMS.elixir_of_the_bear.elixir).value,
      );
    }
  });

  it('each new elixir applies its stamina aura through the live use path', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const sim = makeSim(3);
      const pid = primaryOf(sim);
      sim.addItem(id, 1, pid);
      sim.useItem(id, pid);
      const p = expectDefined(sim.entities.get(pid));
      const aura = expectDefined(
        p.auras.find((a: { id: string }) => a.id === 'elixir_buff_sta'),
        `${id} aura applied`,
      );
      expect(aura.kind).toBe('buff_sta');
      expect(aura.value).toBe(expected.value);
      expect(aura.name).toBe(expected.aura);
      expect(sim.countItem(id, pid)).toBe(0);
    }
  });
});

// Potions are stackable, and crafted copies actually merge: the sweep above
// proves one craft's output arrives, these pin the follow-up a player asked
// about ("Potions should be stackable, right?"), which one craft alone cannot
// show. Kind 'potion'/'elixir' rides the 20-per-slot consumable default
// (bags.ts stackSizeOf), a second craft of the same recipe tops up the FIRST
// craft's slot instead of opening a new one (common outputs are plain
// fungible adds with no craftedRecipeId marker, rare outputs carry the same
// byte-equal {signer} payload every time), and a plain-granted copy from any
// other source shares the crafted common stack.
describe('crafted potions and elixirs stack', () => {
  const consumableOutputs = LADDER_RECIPES.map((r) => ITEMS[r.resultItemId]).filter(
    (def) => def.kind === 'potion' || def.kind === 'elixir',
  );

  function craftTwice(recipeId: string) {
    const sim = makeSim(11);
    const pid = primaryOf(sim);
    const meta = metaOf(sim, pid);
    meta.copper = 10_000_000;
    const recipe = LADDER_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) throw new Error(`expected ${recipeId} on the ladder`);
    meta.craftSkills[recipe.professionId] = recipe.skillReq;
    meta.knownRecipes.add(recipe.id);
    placeAt(sim, pid, stationsOfType(STATIONS, recipe.stationType!)[0].pos);
    for (let craft = 0; craft < 2; craft++) {
      meta.craftThrottle.count = 0;
      for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
      runCraft(sim, recipe.id, false, pid);
      expect(
        meta.lastCraftResult?.ok,
        `${recipeId} craft ${craft + 1}: ${meta.lastCraftResult?.reason}`,
      ).toBe(true);
    }
    return { sim, pid, meta, recipe };
  }

  it('every ladder potion and elixir stacks 20 per slot', () => {
    // 6 draughts + 3 elixirs (the alchemy ladder block in
    // content/profession_items.ts). Exact on purpose, matching this file's
    // own stance (the sweep above pins the ladder at exactly 54): the ladder
    // is a closed authored set, so a new rung SHOULD announce itself here
    // and get its stacking looked at.
    expect(consumableOutputs.length).toBe(9);
    for (const def of consumableOutputs) {
      expect(stackSizeOf(def), `${def.id} must stack to the consumable default`).toBe(20);
    }
  });

  it('crafting the same common potion twice merges into ONE plain stack', () => {
    const { sim, pid, meta, recipe } = craftTwice('recipe_silverleaf_healing_draught');
    expect(sim.countItem(recipe.resultItemId, pid)).toBe(2 * recipe.resultCount);
    const slots = meta.inventory.filter((s: InvSlot) => s.itemId === recipe.resultItemId);
    // ONE slot is the decisive pin: a regression that marks common potion
    // outputs (an instance payload, a craftedRecipeId stamp) fragments the
    // second craft into its own slot and fails here.
    expect(slots.length).toBe(1);
    expect(slots[0].count).toBe(2 * recipe.resultCount);
    expect(slots[0].instance).toBeUndefined();
    expect(slots[0].craftedRecipeId).toBeUndefined();
    // A copy from any OTHER source (loot, trade, mail) is the same plain add
    // and must share the crafted stack.
    sim.addItem(recipe.resultItemId, 1, pid);
    const after = meta.inventory.filter((s: InvSlot) => s.itemId === recipe.resultItemId);
    expect(after.length).toBe(1);
    expect(after[0].count).toBe(2 * recipe.resultCount + 1);
  });

  it('a looted copy FIRST still shares the slot the next craft tops up', () => {
    // The order a player actually hits most: hold a potion from loot or
    // trade, then craft more. The craft path's own add must find the plain
    // slot rather than opening a second one.
    const sim = makeSim(11);
    const pid = primaryOf(sim);
    const meta = metaOf(sim, pid);
    meta.copper = 10_000_000;
    const recipe = LADDER_RECIPES.find((r) => r.id === 'recipe_silverleaf_healing_draught');
    if (!recipe) throw new Error('expected recipe_silverleaf_healing_draught on the ladder');
    meta.craftSkills[recipe.professionId] = recipe.skillReq;
    meta.knownRecipes.add(recipe.id);
    placeAt(sim, pid, stationsOfType(STATIONS, recipe.stationType!)[0].pos);
    sim.addItem(recipe.resultItemId, 1, pid);
    meta.craftThrottle.count = 0;
    for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
    runCraft(sim, recipe.id, false, pid);
    expect(meta.lastCraftResult?.ok, meta.lastCraftResult?.reason).toBe(true);
    const slots = meta.inventory.filter((s: InvSlot) => s.itemId === recipe.resultItemId);
    expect(slots.length).toBe(1);
    expect(slots[0].count).toBe(1 + recipe.resultCount);
  });

  it('crafting the same rare draught twice merges into ONE signed stack', () => {
    const { sim, pid, meta, recipe } = craftTwice('recipe_sunpetal_healing_draught');
    expect(ITEMS[recipe.resultItemId].quality).toBe('rare');
    expect(sim.countItem(recipe.resultItemId, pid)).toBe(2 * recipe.resultCount);
    const slots = meta.inventory.filter((s: InvSlot) => s.itemId === recipe.resultItemId);
    // Both crafts mint the same {signer} payload, so the second one must top
    // up the first craft's instanced slot, never sit beside it. The literal
    // name pin keeps the signer compare from being production-vs-production.
    expect(meta.name).toBe('Adventurer');
    expect(slots.length).toBe(1);
    expect(slots[0].count).toBe(2 * recipe.resultCount);
    expect(slots[0].instance?.signer).toBe(meta.name);
  });
});

describe('silkspun_satchel bag contract', () => {
  it('equips as a bag and contributes exactly its authored 10 slots', () => {
    expect(ITEMS.silkspun_satchel.kind).toBe('bag');
    expect(ITEMS.silkspun_satchel.bagSlots).toBe(10);
    const sim = makeSim(9);
    const pid = primaryOf(sim);
    const meta = metaOf(sim, pid);
    sim.addItem('silkspun_satchel', 1, pid);
    const capBefore = bagCapacity(meta.bags);
    sim.equipBag('silkspun_satchel', 0, pid);
    expect(bagCapacity(meta.bags)).toBe(capBefore + 10);
    expect(sim.countItem('silkspun_satchel', pid)).toBe(0);
  });
});
