// Recipe training (Professions 2.0 Phase 9): the resolveTrain deny order,
// the tiered fee table, the locked teach-tier predicate, and the Sim-level
// trainRecipe command (fee charged exactly once, grant, trainResult event,
// lastTrainResult probe, single-surface denials). The grandfather/persistence
// arm lives in tests/professions_grandfather.test.ts; the online wire arm in
// tests/professions_training_online.test.ts.
import { describe, expect, it } from 'vitest';
import {
  COMBO_RECIPES,
  COMMON_RECIPES,
  recipeById,
  TOOL_RECIPES,
} from '../src/sim/content/recipes';
import { isRecipeKnown } from '../src/sim/professions/crafting';
import { stationsOfType, stationTypeForCraft } from '../src/sim/professions/stations';
import {
  resolveTrain,
  TRAINING_FEE_BY_TIER,
  teachTierMet,
  trainingFeeFor,
} from '../src/sim/professions/training';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

// alchemy -> apothecary (station_highwatch_apothecary, zone 3); the deny
// arms and the happy path all train this trainer-taught combo recipe.
const ALCH_COMBO_ID = 'recipe_volatile_flux_elixir';

// A field spot far outside every station circle (nearest station z is 16.5)
// and clear of camp pull ranges (the professions_station_online idiom).
const FIELD_POS = { x: 0, z: 150 };

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

function metaOf(sim: Sim, pid: number) {
  return (sim as any).players.get(pid);
}

function placeAt(sim: Sim, pid: number, pos: { x: number; z: number }) {
  const entity = (sim as any).entities.get(pid);
  entity.pos.x = pos.x;
  entity.pos.z = pos.z;
  entity.prevPos = { ...entity.pos };
}

// Walk the player onto the station that TEACHES `recipeId` (the station of
// stationTypeForCraft(professionId), which is not the recipe's own craft
// stationType field: combo recipes are field-craftable yet trainer-bound).
function placeAtTrainerFor(sim: Sim, pid: number, recipeId: string) {
  const recipe = recipeById(recipeId);
  if (!recipe) throw new Error(`unknown recipe ${recipeId}`);
  const type = stationTypeForCraft(recipe.professionId);
  if (!type) throw new Error(`${recipe.professionId} has no station`);
  placeAt(sim, pid, stationsOfType(type)[0].pos);
}

function trainResultsOf(events: SimEvent[]): SimEvent[] {
  return events.filter((ev) => ev.type === 'trainResult');
}

describe('TRAINING_FEE_BY_TIER and trainingFeeFor', () => {
  it('is literally [0, 2500, 10000] copper and frozen', () => {
    // Literal expectation on purpose (never a derived comparison): common is
    // free, uncommon 25 silver, rare 1 gold.
    expect(TRAINING_FEE_BY_TIER).toEqual([0, 2500, 10000]);
    expect(Object.isFrozen(TRAINING_FEE_BY_TIER)).toBe(true);
  });

  it('prices by the recipe tier and clamps tiers past the table to the last entry', () => {
    const base = recipeById('recipe_tough_jerky')!;
    expect(trainingFeeFor({ ...base, skillReq: 0 })).toBe(0); // tier 0
    expect(trainingFeeFor({ ...base, skillReq: 25 })).toBe(2500); // tier 1
    expect(trainingFeeFor({ ...base, skillReq: 50 })).toBe(10000); // tier 2, last entry
    // Tier 3+ recipes (skillReq >= 75) clamp to the last entry until the
    // Phase 10/15 tuning extends the table.
    expect(trainingFeeFor({ ...base, skillReq: 75 })).toBe(10000);
    expect(trainingFeeFor({ ...base, skillReq: 150 })).toBe(10000);
  });

  it('prices every trainer-taught combo recipe at 2500 (tier 1)', () => {
    for (const recipe of COMBO_RECIPES) {
      expect(trainingFeeFor(recipe), recipe.id).toBe(2500);
    }
  });
});

describe('teachTierMet (the locked general predicate)', () => {
  const combo = recipeById(ALCH_COMBO_ID)!; // alchemy, skillReq 25 (tier 1)

  it('is exact at the tier boundary: 24 fails, 25 meets', () => {
    expect(teachTierMet(combo, { alchemy: 24 })).toBe(false);
    expect(teachTierMet(combo, { alchemy: 25 })).toBe(true);
  });

  it('reads a missing craft key as skill 0 and ONLY the recipe own craft', () => {
    expect(teachTierMet(combo, {})).toBe(false);
    // Sky-high skill in another craft never substitutes: the predicate reads
    // craftSkills[recipe.professionId] alone.
    expect(teachTierMet(combo, { engineering: 300 })).toBe(false);
  });

  it('a hobby (non-attuned) craft crossing tier 1 flips the predicate the same way', () => {
    // The predicate carries NO archetype/attunement arm: any craft skill map
    // works, so a hobby cook crossing 25 becomes teachable for a tier-1
    // cooking recipe exactly like an attuned major would.
    const hobbyRecipe = { ...recipeById('recipe_tough_jerky')!, skillReq: 25 };
    expect(teachTierMet(hobbyRecipe, { cooking: 24 })).toBe(false);
    expect(teachTierMet(hobbyRecipe, { cooking: 25 })).toBe(true);
  });
});

describe('resolveTrain deny order (replay safety)', () => {
  it('an unknown recipe id denies silently: ok false, NO reason, fee 0', () => {
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    const result = resolveTrain(meta, { x: 0, z: 0 }, 'recipe_that_never_was');
    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.fee).toBe(0);
  });

  it('already known wins over cannot afford: a known combo at 0 copper denies train_already_known', () => {
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    meta.knownRecipes.add(ALCH_COMBO_ID);
    meta.copper = 0;
    // Away from every station too: known-ness precedes the range arm as well.
    const result = resolveTrain(meta, FIELD_POS, ALCH_COMBO_ID);
    expect(result.reason).toBe('train_already_known');
    expect(result.ok).toBe(false);
  });

  it('a grandfathered recipe (no acquisition list) resolves train_already_known, never not_taught_here', () => {
    // COMMON and TOOL recipes carry no acquisition list, so isRecipeKnown is
    // true for everyone and the already-known arm fires BEFORE the
    // taught-here arm can: with today's content (every acquisition list is
    // exactly ['trainer'] on the three combos) train_not_taught_here is
    // unreachable through real recipe ids. This pins that precedence.
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    meta.copper = 0;
    const common = resolveTrain(meta, FIELD_POS, COMMON_RECIPES[0].id);
    expect(common.reason).toBe('train_already_known');
    const tool = resolveTrain(meta, FIELD_POS, TOOL_RECIPES[0].id);
    expect(tool.reason).toBe('train_already_known');
  });

  it('the not_taught_here arm fires for an unknown recipe whose acquisition lacks trainer', () => {
    // No such recipe exists in content today (guarded by the grandfather
    // suite), so this arm is pinned through resolveTrain's own validator
    // order via a combo id temporarily NOT known: the arm after already_known
    // reads recipe.acquisition, so a trainer recipe passes it and lands on
    // the RANGE arm instead. The decisive assertion: an unknown trainer-less
    // recipe id can only surface once Phase 10 content adds one, and the
    // combo (trainer-taught, unknown, away from the station) falls through
    // to train_out_of_range, proving the taught-here arm sits between.
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    meta.copper = 999999;
    meta.craftSkills.alchemy = 25;
    const result = resolveTrain(meta, FIELD_POS, ALCH_COMBO_ID);
    expect(result.reason).toBe('train_out_of_range');
  });

  it('range precedes tier: unmet tier away from the station still reads train_out_of_range', () => {
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    meta.copper = 999999;
    meta.craftSkills.alchemy = 0; // tier unmet too, but range must win
    const result = resolveTrain(meta, FIELD_POS, ALCH_COMBO_ID);
    expect(result.reason).toBe('train_out_of_range');
  });

  it('full multi-violation state (out of range, tier 0, copper 0) still reads train_out_of_range', () => {
    // The richest deny pile a real player can present: every arm below
    // already_known/not_taught_here violated at once must still resolve in
    // the documented order (range first), with the fee carried unpaid.
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    meta.copper = 0;
    meta.craftSkills.alchemy = 0;
    const result = resolveTrain(meta, FIELD_POS, ALCH_COMBO_ID);
    expect(result).toEqual({
      ok: false,
      recipeId: ALCH_COMBO_ID,
      reason: 'train_out_of_range',
      fee: 2500,
    });
  });

  it('tier precedes fee: skill 24 at the station with 0 copper reads train_tier_unmet', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAtTrainerFor(sim, pid, ALCH_COMBO_ID);
    meta.copper = 0;
    meta.craftSkills.alchemy = 24;
    const entity = (sim as any).entities.get(pid);
    const result = resolveTrain(meta, entity.pos, ALCH_COMBO_ID);
    expect(result.reason).toBe('train_tier_unmet');
  });

  it('carries the fee on deny arms too, so a UI probe can price an unaffordable train', () => {
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    meta.copper = 0;
    const result = resolveTrain(meta, FIELD_POS, ALCH_COMBO_ID);
    expect(result.fee).toBe(2500);
  });
});

describe('Sim.trainRecipe (fee exactly once, grant, event, probe)', () => {
  it('happy path at the apothecary: fee deducted exactly 2500, recipe granted, ok event', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAtTrainerFor(sim, pid, ALCH_COMBO_ID);
    meta.craftSkills.alchemy = 25;
    meta.copper = 10000;
    sim.drainEvents();

    sim.trainRecipe(ALCH_COMBO_ID, pid);

    expect(meta.copper).toBe(7500); // exactly the tier-1 fee, once
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(true);
    expect(meta.lastTrainResult).toMatchObject({ ok: true, recipeId: ALCH_COMBO_ID, fee: 2500 });
    const events = sim.drainEvents();
    expect(trainResultsOf(events)).toEqual([
      { type: 'trainResult', ok: true, recipeId: ALCH_COMBO_ID, reason: undefined, pid },
    ]);
  });

  it('replay safety: the SAME command again denies train_already_known with no re-charge', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAtTrainerFor(sim, pid, ALCH_COMBO_ID);
    meta.craftSkills.alchemy = 25;
    meta.copper = 10000;
    sim.trainRecipe(ALCH_COMBO_ID, pid);
    expect(meta.copper).toBe(7500);
    sim.drainEvents();

    sim.trainRecipe(ALCH_COMBO_ID, pid); // the duplicate (replayed) command

    expect(meta.copper).toBe(7500); // never re-charged
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(true); // set unchanged
    expect(meta.lastTrainResult).toMatchObject({ ok: false, reason: 'train_already_known' });
    const events = sim.drainEvents();
    expect(trainResultsOf(events)).toEqual([
      {
        type: 'trainResult',
        ok: false,
        recipeId: ALCH_COMBO_ID,
        reason: 'train_already_known',
        pid,
      },
    ]);
    // Single-surface doctrine: the deny reaches the player ONLY as the
    // trainResult event (plus the probe), never an error toast on top.
    expect(events.filter((ev) => ev.type === 'error')).toEqual([]);
  });

  it('out of range in the field: denied, nothing granted, nothing charged', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAt(sim, pid, FIELD_POS);
    meta.craftSkills.alchemy = 25;
    meta.copper = 10000;
    sim.drainEvents();

    sim.trainRecipe(ALCH_COMBO_ID, pid);

    expect(meta.copper).toBe(10000);
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(false);
    expect(meta.lastTrainResult).toMatchObject({ ok: false, reason: 'train_out_of_range' });
    const events = sim.drainEvents();
    expect(trainResultsOf(events)).toHaveLength(1);
    expect(events.filter((ev) => ev.type === 'error')).toEqual([]);
  });

  it('an ACTIVE mobile station of the matching craft NEVER satisfies training', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAt(sim, pid, FIELD_POS);
    meta.craftSkills.alchemy = 75; // specialized: mobile placement is gated on it
    meta.copper = 10000;
    sim.placeMobileStation('alchemy', pid);
    expect(meta.mobileStation?.craftId).toBe('alchemy'); // the mobile arm IS live for crafting

    sim.trainRecipe(ALCH_COMBO_ID, pid);

    // Training reads STATIC stations only (stations.ts isAtStation): the
    // active matching mobile station changes nothing about the range deny.
    expect(meta.lastTrainResult).toMatchObject({ ok: false, reason: 'train_out_of_range' });
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(false);
    expect(meta.copper).toBe(10000);
  });

  it('tier boundary is exact through the command: skill 24 denies, 25 then succeeds', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAtTrainerFor(sim, pid, ALCH_COMBO_ID);
    meta.copper = 10000;
    meta.craftSkills.alchemy = 24;

    sim.trainRecipe(ALCH_COMBO_ID, pid);
    expect(meta.lastTrainResult).toMatchObject({ ok: false, reason: 'train_tier_unmet' });
    expect(meta.copper).toBe(10000);
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(false);

    meta.craftSkills.alchemy = 25; // one point later, same spot, same purse
    sim.trainRecipe(ALCH_COMBO_ID, pid);
    expect(meta.lastTrainResult).toMatchObject({ ok: true, fee: 2500 });
    expect(meta.copper).toBe(7500);
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(true);
  });

  it('insufficient copper: 2499 denies train_cannot_afford, granting and charging nothing', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAtTrainerFor(sim, pid, ALCH_COMBO_ID);
    meta.craftSkills.alchemy = 25;
    meta.copper = 2499;

    sim.trainRecipe(ALCH_COMBO_ID, pid);

    expect(meta.lastTrainResult).toMatchObject({ ok: false, reason: 'train_cannot_afford' });
    expect(meta.copper).toBe(2499);
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(false);
  });

  it('exactly-affordable trains ok: copper === fee (2500) succeeds and leaves 0', () => {
    // Pins the strict `<` in resolveTrain's afford arm: an off-by-one to `<=`
    // would deny a player holding the exact fee (the 2499 arm above cannot
    // catch that regression on its own).
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    placeAtTrainerFor(sim, pid, ALCH_COMBO_ID);
    meta.craftSkills.alchemy = 25;
    meta.copper = 2500;

    sim.trainRecipe(ALCH_COMBO_ID, pid);

    expect(meta.lastTrainResult).toMatchObject({ ok: true, fee: 2500 });
    expect(meta.copper).toBe(0);
    expect(meta.knownRecipes.has(ALCH_COMBO_ID)).toBe(true);
  });

  it('records the malformed-id deny on the probe and event with no reason code', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    sim.drainEvents();
    sim.trainRecipe('recipe_that_never_was', pid);
    const meta = metaOf(sim, pid);
    expect(meta.lastTrainResult).toMatchObject({ ok: false, fee: 0 });
    expect(meta.lastTrainResult.reason).toBeUndefined();
    const events = trainResultsOf(sim.drainEvents());
    expect(events).toHaveLength(1);
    expect((events[0] as { reason?: string }).reason).toBeUndefined();
  });
});

describe('knowing vs crafting stay orthogonal (Phase 9 does not use-gate)', () => {
  it('a KNOWN recipe is never use-gated by skill: skill 0 crafts a skillReq-75 tool at the toolworks', () => {
    // The no-admission-gate pin vs the new teach predicate: skillReq still
    // scales outcomes only (crafting.ts), it never denies a KNOWN recipe, so
    // Phase 9 must not have leaked teachTierMet into craft admission.
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = metaOf(sim, pid);
    expect(meta.craftSkills.engineering ?? 0).toBe(0);
    const recipe = recipeById('recipe_thorium_mining_pick')!; // grandfathered known
    placeAt(sim, pid, stationsOfType(recipe.stationType!)[0].pos);
    for (let i = 0; i < 4; i++) sim.addItem('thorium_ore', 1, pid);
    sim.addItem('mithril_mining_pick', 1, pid);

    sim.craftItem(recipe.id, pid);

    expect(sim.countItem('thorium_mining_pick', pid)).toBe(1);
  });

  it('no COMMON recipe can ever read locked at skill 0: all are known with a zero fee', () => {
    const sim = makeSim();
    const meta = metaOf(sim, sim.playerId);
    for (const recipe of COMMON_RECIPES) {
      expect(isRecipeKnown(meta, recipe), recipe.id).toBe(true);
      const result = resolveTrain(meta, FIELD_POS, recipe.id);
      expect(result.reason, recipe.id).toBe('train_already_known');
      expect(trainingFeeFor(recipe), recipe.id).toBe(0);
    }
  });
});
