// The Quickening Catalyst daily craft gate (Masterwrought phase 07): a
// oncePerDay recipe crafts at most once per character per reset day, keyed on
// ctx.resetDay via the PlayerMeta.craftDaily stamp (the wyrmfallDaily idiom:
// professions/masterwrought_materials.ts refreshWyrmfallDaily). The refusal is
// the typed 'daily_limit' CraftResult reason on the shared admission
// (evaluateCraftAdmission), the stamp lands in resolveCraftForRecipe right
// after successful reagent consumption, and maxCraftCountForRecipe caps the
// batch preview so the UI never promises a batch the resolve refuses. A host
// that never sets resetDay (the headless RL env, replays) sees a one-shot
// gate, the documented degrade. State round-trips through CharacterState with
// the wyrmfallDaily load clamps and zero-default serialize omission.

import { describe, expect, it } from 'vitest';
import { recipeById } from '../src/sim/content/recipes';
import { STATIONS } from '../src/sim/data';
import { evaluateCraftAdmission, maxCraftCountForRecipe } from '../src/sim/professions/crafting';
import { stationsOfType } from '../src/sim/professions/stations';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

const RECIPE_ID = 'recipe_quickening_catalyst';
const DAY_ONE = '2026-08-11';
const DAY_TWO = '2026-08-12';

function catalystRecipe(): ProfessionRecipeRecord {
  const recipe = recipeById(RECIPE_ID);
  if (!recipe) {
    throw new Error(
      `${RECIPE_ID} missing from ALL_RECIPES: the phase 07 INTERMEDIATE_RECIPES rows must land with this gate`,
    );
  }
  return recipe;
}

function makeSim(seed = 42): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true });
}

/** A skill-75 alchemist standing at the recipe's station, knowing the recipe
 *  and holding reagents for `crafts` full crafts (listed counts; the rig never
 *  relies on a discount, so extra copies simply stay in the bags). */
function rigCrafter(sim: Sim, crafts = 1, savedState?: unknown): number {
  const recipe = catalystRecipe();
  const pid = savedState
    ? sim.addPlayer('warrior', 'Brewer', { state: savedState as never })
    : sim.addPlayer('warrior', 'Brewer');
  const meta = sim.players.get(pid) as PlayerMeta;
  meta.craftSkills[recipe.professionId] = 75;
  meta.knownRecipes.add(RECIPE_ID);
  if (!recipe.stationType) throw new Error(`${RECIPE_ID} must be station-bound`);
  const station = stationsOfType(STATIONS, recipe.stationType)[0];
  if (!station) throw new Error(`no ${recipe.stationType} station in STATIONS`);
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = station.pos.x;
  entity.pos.z = station.pos.z;
  entity.prevPos = { ...entity.pos };
  for (const reagent of recipe.reagents) {
    sim.addItem(reagent.itemId, reagent.count * crafts, pid);
  }
  return pid;
}

/** Finish a started craft cast (updateCasting shape: clear cast, complete). */
function completeCraftCastNow(sim: Sim, pid: number): void {
  const p = (sim as any).entities.get(pid);
  const meta = (sim as any).players.get(pid);
  if (!p || !meta) throw new Error('player missing');
  p.castingAbility = null;
  p.castRemaining = 0;
  sim.ctx.completeCraftCast(p, meta);
}

/** Start via the real command wrapper and complete in-harness. */
function craftOnce(sim: Sim, pid: number, count = 1): void {
  sim.craftItem(RECIPE_ID, false, pid, count);
  completeCraftCastNow(sim, pid);
}

function reagentCounts(sim: Sim, pid: number): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const reagent of catalystRecipe().reagents) {
    counts[reagent.itemId] = sim.countItem(reagent.itemId, pid);
  }
  return counts;
}

function craftResultEvents(sim: Sim): { ok: boolean; reason?: string }[] {
  return (sim.drainEvents() as { type: string; ok?: boolean; reason?: string }[])
    .filter((ev) => ev.type === 'craftResult')
    .map((ev) => ({ ok: ev.ok === true, reason: ev.reason }));
}

describe('the shipped catalyst row (the ledger contract, from the gate side)', () => {
  it('is the oncePerDay skill-75 trainer-taught apothecary alchemy rung', () => {
    const recipe = catalystRecipe();
    expect(recipe.oncePerDay).toBe(true);
    expect(recipe.professionId).toBe('alchemy');
    expect(recipe.stationType).toBe('apothecary');
    expect(recipe.skillReq).toBe(75);
    expect(recipe.itemLevelBudget).toBe(20);
    expect(recipe.level).toBe(20);
    expect(recipe.resultCount).toBe(1);
    expect(recipe.acquisition).toEqual(['trainer']);
  });
});

describe('the daily craft gate (resetDay set)', () => {
  it('admission is side-effect-free, then the first craft succeeds, consumes, and stamps', () => {
    const sim = makeSim();
    sim.resetDay = DAY_ONE;
    const recipe = catalystRecipe();
    const pid = rigCrafter(sim);
    const meta = sim.players.get(pid) as PlayerMeta;

    // READ-ONLY admission: an admitted check writes nothing (the stamp is the
    // resolve's job), so probing the gate can never spend the day.
    expect(evaluateCraftAdmission(sim.ctx, pid, recipe)).toBeNull();
    expect(meta.craftDaily).toEqual({ date: '', crafted: new Set() });

    const before = reagentCounts(sim, pid);
    craftOnce(sim, pid);
    expect(craftResultEvents(sim)).toEqual([{ ok: true, reason: undefined }]);
    expect(sim.countItem(recipe.resultItemId, pid)).toBe(recipe.resultCount);
    for (const reagent of recipe.reagents) {
      expect(sim.countItem(reagent.itemId, pid)).toBeLessThan(before[reagent.itemId]);
    }
    expect(meta.craftDaily).toEqual({ date: DAY_ONE, crafted: new Set([RECIPE_ID]) });
  });

  it('a second craft the same day refuses with daily_limit and consumes nothing', () => {
    const sim = makeSim();
    sim.resetDay = DAY_ONE;
    const recipe = catalystRecipe();
    const pid = rigCrafter(sim, 2);
    const meta = sim.players.get(pid) as PlayerMeta;
    craftOnce(sim, pid);
    sim.drainEvents();

    const before = reagentCounts(sim, pid);
    const produced = sim.countItem(recipe.resultItemId, pid);
    sim.craftItem(RECIPE_ID, false, pid, 1);
    expect(craftResultEvents(sim)).toEqual([{ ok: false, reason: 'daily_limit' }]);
    expect(meta.lastCraftResult?.reason).toBe('daily_limit');
    // No cast started, nothing consumed, nothing granted.
    expect((sim as any).entities.get(pid).castingAbility).toBeNull();
    expect(reagentCounts(sim, pid)).toEqual(before);
    expect(sim.countItem(recipe.resultItemId, pid)).toBe(produced);
  });

  it('survives the logout round trip: a fresh Sim loading the save still refuses today', () => {
    const sim = makeSim();
    sim.resetDay = DAY_ONE;
    const recipe = catalystRecipe();
    const pid = rigCrafter(sim);
    craftOnce(sim, pid);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    // The persisted twin: date plus the stamped recipe id array.
    expect(state.craftDaily).toEqual({ date: DAY_ONE, crafted: [RECIPE_ID] });

    const sim2 = makeSim();
    sim2.resetDay = DAY_ONE;
    const pid2 = rigCrafter(sim2, 1, state);
    const meta2 = sim2.players.get(pid2) as PlayerMeta;
    expect(meta2.craftDaily).toEqual({ date: DAY_ONE, crafted: new Set([RECIPE_ID]) });
    const before = reagentCounts(sim2, pid2);
    sim2.craftItem(RECIPE_ID, false, pid2, 1);
    expect(craftResultEvents(sim2)).toEqual([{ ok: false, reason: 'daily_limit' }]);
    expect(reagentCounts(sim2, pid2)).toEqual(before);

    // The next reset day opens the gate again and re-stamps the new window.
    sim2.resetDay = DAY_TWO;
    craftOnce(sim2, pid2);
    const events = craftResultEvents(sim2);
    expect(events).toEqual([{ ok: true, reason: undefined }]);
    expect(meta2.craftDaily).toEqual({ date: DAY_TWO, crafted: new Set([RECIPE_ID]) });
  });

  it('a stale saved window from yesterday does not block today', () => {
    const sim = makeSim();
    sim.resetDay = DAY_ONE;
    const pid = rigCrafter(sim);
    craftOnce(sim, pid);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));

    // Load on the NEXT day: the stale stamp is read-only ignored at admission
    // (no mutation until the next successful craft rolls the window).
    const sim2 = makeSim();
    sim2.resetDay = DAY_TWO;
    const pid2 = rigCrafter(sim2, 1, state);
    const meta2 = sim2.players.get(pid2) as PlayerMeta;
    expect(evaluateCraftAdmission(sim2.ctx, pid2, catalystRecipe())).toBeNull();
    expect(meta2.craftDaily).toEqual({ date: DAY_ONE, crafted: new Set([RECIPE_ID]) });
    craftOnce(sim2, pid2);
    expect(craftResultEvents(sim2)).toEqual([{ ok: true, reason: undefined }]);
    expect(meta2.craftDaily).toEqual({ date: DAY_TWO, crafted: new Set([RECIPE_ID]) });
  });
});

describe('the one-shot degrade (resetDay empty: headless and replay hosts)', () => {
  it('crafts once, then refuses forever, across the save round trip too', () => {
    const sim = makeSim();
    // Deliberately never set resetDay: the birth default '' means no calendar.
    expect(sim.resetDay).toBe('');
    const pid = rigCrafter(sim, 2);
    const meta = sim.players.get(pid) as PlayerMeta;
    craftOnce(sim, pid);
    sim.drainEvents();
    // The stamp records no date (there is no window to record).
    expect(meta.craftDaily).toEqual({ date: '', crafted: new Set([RECIPE_ID]) });

    sim.craftItem(RECIPE_ID, false, pid, 1);
    expect(craftResultEvents(sim)).toEqual([{ ok: false, reason: 'daily_limit' }]);

    // Zero-default omission still writes the stamp (crafted is non-empty),
    // and a calendar-less reload keeps refusing: one shot per save.
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    expect(state.craftDaily).toEqual({ date: '', crafted: [RECIPE_ID] });
    const sim2 = makeSim();
    const pid2 = rigCrafter(sim2, 1, state);
    sim2.craftItem(RECIPE_ID, false, pid2, 1);
    expect(craftResultEvents(sim2)).toEqual([{ ok: false, reason: 'daily_limit' }]);
  });
});

describe('persistence hardening (the wyrmfallDaily load-clamp arm)', () => {
  it('an untouched character serializes with no craftDaily field at all', () => {
    const sim = makeSim();
    const pid = rigCrafter(sim);
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    expect(state.craftDaily).toBeUndefined();
  });

  it('a pre-phase save (no craftDaily) loads at the fresh default', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Old');
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    delete state.craftDaily;
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Old', { state });
    const meta2 = sim2.players.get(pid2) as PlayerMeta;
    expect(meta2.craftDaily).toEqual({ date: '', crafted: new Set() });
  });

  it('a corrupt row loads clamped without throwing', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Bad');
    const state = JSON.parse(JSON.stringify(sim.serializeCharacter(pid)));
    // Overlong date, non-string tokens, an overlong token, and an oversize
    // array (40 entries) in one blob: the clamps type-check, cap tokens at 64
    // chars, and cap the set at 32 entries, exactly the wyrmfallDaily arm.
    const junk = Array.from({ length: 40 }, (_, i) => `recipe_junk_${i}`);
    state.craftDaily = {
      date: 'x'.repeat(65),
      crafted: [7, null, 'y'.repeat(65), ...junk],
    };
    const sim2 = makeSim();
    const pid2 = sim2.addPlayer('warrior', 'Bad', { state });
    const meta2 = sim2.players.get(pid2) as PlayerMeta;
    expect(meta2.craftDaily.date).toBe('');
    expect(meta2.craftDaily.crafted).toEqual(new Set(junk.slice(0, 32)));

    // A non-array crafted and a non-string date degrade to the defaults.
    state.craftDaily = { date: 7, crafted: 'recipe_quickening_catalyst' };
    const sim3 = makeSim();
    const pid3 = sim3.addPlayer('warrior', 'Bad', { state });
    const meta3 = sim3.players.get(pid3) as PlayerMeta;
    expect(meta3.craftDaily).toEqual({ date: '', crafted: new Set() });
  });
});

describe('determinism', () => {
  it('the craft-refuse-next-day sequence replays byte-identically', () => {
    const run = () => {
      const sim = makeSim(7);
      sim.resetDay = DAY_ONE;
      const recipe = catalystRecipe();
      const pid = rigCrafter(sim, 2);
      const meta = sim.players.get(pid) as PlayerMeta;
      const log: unknown[] = [];
      craftOnce(sim, pid);
      log.push(craftResultEvents(sim));
      sim.craftItem(RECIPE_ID, false, pid, 1);
      log.push(craftResultEvents(sim));
      sim.resetDay = DAY_TWO;
      craftOnce(sim, pid);
      log.push(craftResultEvents(sim));
      log.push(sim.countItem(recipe.resultItemId, pid));
      log.push(reagentCounts(sim, pid));
      log.push({ date: meta.craftDaily.date, crafted: [...meta.craftDaily.crafted].sort() });
      return log;
    };
    expect(run()).toEqual(run());
  });
});

describe('batch (shift-craft) never overpromises', () => {
  it('maxCraftCountForRecipe previews at most 1, and 0 once stamped', () => {
    const sim = makeSim(11);
    sim.resetDay = DAY_ONE;
    const recipe = catalystRecipe();
    const pid = rigCrafter(sim, 2);
    // Materials would pay for two crafts; the daily cap holds the preview at 1.
    expect(maxCraftCountForRecipe(sim.ctx, recipe, pid)).toBe(1);
    craftOnce(sim, pid);
    expect(maxCraftCountForRecipe(sim.ctx, recipe, pid)).toBe(0);
  });

  it('a count-2 shift-craft clamps to one craft and starts no second cast', () => {
    const sim = makeSim(11);
    sim.resetDay = DAY_ONE;
    const recipe = catalystRecipe();
    const pid = rigCrafter(sim, 2);
    craftOnce(sim, pid, 2);
    // Exactly one output, exactly one ok event (the clamp already kept the
    // batch honest, so no refusal was even needed on this path).
    expect(craftResultEvents(sim)).toEqual([{ ok: true, reason: undefined }]);
    expect(sim.countItem(recipe.resultItemId, pid)).toBe(recipe.resultCount);
    expect((sim as any).entities.get(pid).castingAbility).toBeNull();
  });

  it('a raced 2-batch stops itself at the auto-continue with the daily_limit refusal', () => {
    // The live start path clamps a oncePerDay batch to 1 (above), so arm the
    // in-flight session fields directly: this pins the auto-continue's own
    // stop rule, the reason the gate lives in the SHARED admission (cast
    // start, complete resolve, and batch continue all deny from one check).
    const sim = makeSim(12);
    sim.resetDay = DAY_ONE;
    const recipe = catalystRecipe();
    const pid = rigCrafter(sim, 2);
    const p = (sim as any).entities.get(pid);
    const meta = sim.players.get(pid) as PlayerMeta;
    p.craftCastRecipeId = RECIPE_ID;
    p.craftCastCommission = false;
    p.craftCastBatchRemaining = 2;
    p.craftCastBatchTotal = 2;
    sim.ctx.completeCraftCast(p, meta);
    // First complete crafts and stamps; the batch's next start refuses.
    expect(craftResultEvents(sim)).toEqual([
      { ok: true, reason: undefined },
      { ok: false, reason: 'daily_limit' },
    ]);
    expect(sim.countItem(recipe.resultItemId, pid)).toBe(recipe.resultCount);
    expect(p.castingAbility).toBeNull();
    expect(meta.craftDaily).toEqual({ date: DAY_ONE, crafted: new Set([RECIPE_ID]) });
  });
});
