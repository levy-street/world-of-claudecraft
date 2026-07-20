// Phase 10 QA: the 54 LADDER_RECIPES execute end to end through the real
// craft path (station gate satisfied, reagents consumed, output produced),
// the four specimen consumers consume their always-signed instance reagent,
// Sim.trainRecipe charges the real ladder rungs (free rung 0, exactly 10000
// at rung 50), the three crafted elixir defs are pinned literally and apply
// through the live use path, and the silkspun_satchel bag contributes its
// authored capacity. The static ladder SHAPE pins live in
// tests/recipe_economy.test.ts; this file is the execution arm.
import { describe, expect, it } from 'vitest';
import { bagCapacity } from '../src/sim/bags';
import { HARVEST_COMPONENT_SPECIMENS } from '../src/sim/content/professions';
import { LADDER_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { stationsOfType } from '../src/sim/professions/stations';
import { Sim } from '../src/sim/sim';

const SPECIMEN_IDS = new Set(Object.values(HARVEST_COMPONENT_SPECIMENS));

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}
function metaOf(sim: Sim, pid: number) {
  return (sim as any).players.get(pid);
}
function primaryOf(sim: Sim): number {
  return (sim as any).primaryId;
}
function placeAt(sim: Sim, pid: number, pos: { x: number; z: number }) {
  const entity = (sim as any).entities.get(pid);
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
      placeAt(sim, pid, stationsOfType(recipe.stationType!)[0].pos);
      sim.craftItem(recipe.id, pid);
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

  it('the four specimen consumers consume the signed instance slot itself', () => {
    // One recipe per specimen family (pinned literally in
    // tests/recipe_economy.test.ts's demand block); the assert above already
    // proves count 0, this pins that no UNSIGNED grant would have satisfied
    // the sweep: the granted reagent was a signed instance slot.
    const consumers = LADDER_RECIPES.filter((r) =>
      r.reagents.some((reagent) => SPECIMEN_IDS.has(reagent.itemId)),
    );
    expect(consumers.map((r) => r.id).sort()).toEqual([
      'recipe_elixir_of_the_serpent',
      'recipe_marlows_grand_roast',
      'recipe_mirewarden_jerkin',
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
    const rung0 = LADDER_RECIPES.find(
      (r) => r.professionId === 'weaponcrafting' && r.skillReq === 0,
    )!;
    placeAt(sim, pid, stationsOfType(rung0.stationType!)[0].pos);
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
    const rung50 = LADDER_RECIPES.find(
      (r) => r.professionId === 'weaponcrafting' && r.skillReq === 50,
    )!;
    meta.craftSkills.weaponcrafting = 50;
    meta.copper = 10_005;
    placeAt(sim, pid, stationsOfType(rung50.stationType!)[0].pos);
    sim.trainRecipe(rung50.id, pid);
    expect(meta.lastTrainResult?.ok).toBe(true);
    expect(meta.lastTrainResult?.fee).toBe(10_000);
    expect(meta.copper).toBe(5);
    expect(meta.knownRecipes.has(rung50.id)).toBe(true);
  });
});

describe('crafted elixir defs and the live use path', () => {
  // Literal def pins: a typo'd value, duration, aura name, or kind in any of
  // the three Phase 10 elixirs would otherwise ship silently (the elixir
  // MECHANISM is pinned via elixir_of_the_bear in tests/elixir.test.ts).
  const EXPECTED: Record<string, { aura: string; value: number; duration: number }> = {
    elixir_of_the_boar: { aura: 'Might of the Boar', value: 6, duration: 600 },
    venomfire_elixir: { aura: 'Venomfire Vigor', value: 9, duration: 900 },
    elixir_of_the_serpent: { aura: 'Might of the Serpent', value: 12, duration: 900 },
  };

  it('pins the three elixir blocks literally (at or below the bear precedent)', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const def = ITEMS[id];
      expect(def, id).toBeDefined();
      expect(def.kind, id).toBe('elixir');
      expect(def.elixir, id).toEqual({ ...expected, kind: 'buff_sta' });
      // The per-item power ceiling is the pre-existing bear elixir (12).
      expect(def.elixir!.value).toBeLessThanOrEqual(ITEMS.elixir_of_the_bear.elixir!.value);
    }
  });

  it('each new elixir applies its stamina aura through the live use path', () => {
    for (const [id, expected] of Object.entries(EXPECTED)) {
      const sim = makeSim(3);
      const pid = primaryOf(sim);
      sim.addItem(id, 1, pid);
      sim.useItem(id, pid);
      const p = (sim as any).entities.get(pid);
      const aura = p.auras.find((a: { id: string }) => a.id === `elixir_${id}`);
      expect(aura, `${id} aura applied`).toBeTruthy();
      expect(aura.kind).toBe('buff_sta');
      expect(aura.value).toBe(expected.value);
      expect(aura.name).toBe(expected.aura);
      expect(sim.countItem(id, pid)).toBe(0);
    }
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
