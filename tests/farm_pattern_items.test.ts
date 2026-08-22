// Farming recipe patterns (masterwrought Phase 11f): the six kind:'recipe'
// drops in src/sim/content/farm_patterns.ts that teach the FARM_RECIPES rows at
// or above FARM_DROP_RUNG_FLOOR, plus the referential and reachability
// invariants the channel flip has to keep true.
//
// The sibling of tests/apex_pattern_items.test.ts, and separate for the same
// reason the content tables are: that file pins a recorded contract about the
// 28 apex patterns, and folding a second set into it would blur both. The
// GENERIC kind:'recipe' behavior sweeps (learn, consume, tier gate, market,
// stacking) live in tests/recipe_pattern_items.test.ts, which grew its own
// farming arms driving the real dispatch; this file pins the CONTENT.
//
// What this file exists to catch, and nothing else does: an orphan in either
// direction. A pattern teaching a recipe nobody can reach, or a flipped recipe
// with no pattern, are both silent failures in play. The second is the worse
// one: the row simply disappears from the game, learnable by nobody, and every
// suite stays green because nothing else asks the question.
import { describe, expect, it } from 'vitest';
import { FARM_PATTERN_ITEMS } from '../src/sim/content/farm_patterns';
import { STATIONS } from '../src/sim/content/professions';
import { ALL_RECIPES, FARM_DROP_RUNG_FLOOR, FARM_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { stationsOfType } from '../src/sim/professions/stations';
import { resolveTrain } from '../src/sim/professions/training';
import type { PlayerMeta } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';

// The two sides of the referential pin, DERIVED INDEPENDENTLY: the left from
// the recipe table's channel field, the right from the shipped pattern table.
// Deriving both from one place is what would make the pin prove nothing.
const FLIPPED_RECIPES = FARM_RECIPES.filter((r) => r.acquisition?.includes('drop'));
const PATTERN_IDS = Object.keys(FARM_PATTERN_ITEMS);

// The shipped per-craft display prefix. Both farm crafts (cooking and, if a
// later phase flips an alchemy row, alchemy) take "Recipe:"; spelled as a
// literal so a drifted def name reds here rather than being re-derived from
// the thing under test.
const PREFIX_BY_PROFESSION: Record<string, string> = { cooking: 'Recipe', alchemy: 'Recipe' };

describe('farm pattern defs', () => {
  it('is one pattern per flipped recipe and one flipped recipe per pattern, no orphans', () => {
    // Predicted then observed at the Phase 11f rung climb: six rows flip (two
    // at rung 75, four at rung 100) and six patterns ship.
    expect(FLIPPED_RECIPES).toHaveLength(6);
    expect(PATTERN_IDS).toHaveLength(6);
    // Forward: every flipped recipe has its pattern, named by the shipped id
    // contract, and it is REACHABLE through the merged ITEMS table rather than
    // merely authored in the content module.
    for (const recipe of FLIPPED_RECIPES) {
      const id = `pattern_${recipe.resultItemId}`;
      expect(FARM_PATTERN_ITEMS[id], `${recipe.id} has no pattern def`).toBeDefined();
      const merged = ITEMS[id];
      expect(merged, `${id} is authored but not merged into ITEMS`).toBeDefined();
      if (merged.kind !== 'recipe') throw new Error(`${id} merged as kind ${merged.kind}`);
      expect(merged.teachesRecipeId, id).toBe(recipe.id);
    }
    // Backward: no pattern teaches a row that is not flipped (which would be a
    // pattern for a recipe the trainer also sells), and none teaches a recipe
    // that has left the table.
    for (const [id, def] of Object.entries(FARM_PATTERN_ITEMS)) {
      const taught = ALL_RECIPES.find((r) => r.id === def.teachesRecipeId);
      expect(
        taught,
        `${id} teaches ${def.teachesRecipeId}, which resolves to no recipe`,
      ).toBeDefined();
      expect(
        FLIPPED_RECIPES.map((r) => r.id),
        `${id} teaches an unflipped row`,
      ).toContain(def.teachesRecipeId);
      expect(id, 'the pattern_<output> id contract').toBe(`pattern_${taught?.resultItemId}`);
    }
  });

  it('derives QUALITY from the taught row output, and holds sellValue at the shipped point', () => {
    // The ruling (11f-PAT): quality is computed per pattern from what it
    // teaches, because recipe rarity is pinned monotone to the power of the
    // thing taught; price is NOT, because sellValue on a kind 'recipe' item is
    // a vendor floor and the shipped catalog carries exactly one point for the
    // whole class. So the arms diverge deliberately: quality is derived, price
    // is a literal.
    for (const [id, def] of Object.entries(FARM_PATTERN_ITEMS)) {
      const taught = ALL_RECIPES.find((r) => r.id === def.teachesRecipeId);
      const output = ITEMS[taught?.resultItemId ?? ''];
      expect(output, `${id}: taught output missing`).toBeDefined();
      expect(def.quality, `${id} quality must equal its taught output's`).toBe(output.quality);
      expect(def.sellValue, `${id} sellValue`).toBe(100);
    }
    // The derivation is only worth having while it can DISAGREE with a
    // constant. Recorded here rather than asserted as a rule: on this set it
    // lands uniformly on 'rare', so the arm above would also pass against a
    // hardcoded 'rare' today. What stops that from being the same thing is
    // that the whole farm ladder is NOT uniform, which this arm proves, so the
    // first future flipped row at another quality moves the derivation and a
    // literal would have silently mis-stated it.
    const patternQualities = new Set(Object.values(FARM_PATTERN_ITEMS).map((d) => d.quality));
    expect([...patternQualities]).toEqual(['rare']);
    const ladderQualities = new Set(
      FARM_RECIPES.map((r) => ITEMS[r.resultItemId]?.quality).filter(Boolean),
    );
    expect(
      ladderQualities.size,
      'the farm ladder must span more than one output quality, or the derivation is moot',
    ).toBeGreaterThan(1);
  });

  it('copies the shipped def shape exactly: kind, tradability, no extra fields', () => {
    for (const [id, def] of Object.entries(FARM_PATTERN_ITEMS)) {
      expect(def.id, 'the def id must match its table key').toBe(id);
      expect(def.kind, id).toBe('recipe');
      // Tradable, bound only by being consumed at learn time.
      expect(def.soulbound ?? false, `${id}: soulbound contradicts bind-by-consumption`).toBe(
        false,
      );
      expect(def.noMarketList ?? false, `${id}: patterns are deliberately listable`).toBe(false);
      expect(
        def.use,
        `${id}: the recipe kind is dispatched by KIND, never by a use arm`,
      ).toBeUndefined();
      expect(def.stackSize, `${id}: the unstacked default is the contract`).toBeUndefined();
      // Exhaustive key set, so a field added here has to be a deliberate edit.
      expect(Object.keys(def).sort()).toEqual(
        ['id', 'kind', 'name', 'quality', 'sellValue', 'teachesRecipeId'].sort(),
      );
    }
  });

  it('mints no new proper noun: every name is the craft prefix plus a shipped dish name', () => {
    // The recorded naming verdict, asserted rather than trusted. Because each
    // name is built from an ALREADY SHIPPED output name behind a registered
    // prefix, R15 and D17 are satisfied by construction and there is nothing
    // for a collision audit to check.
    for (const [id, def] of Object.entries(FARM_PATTERN_ITEMS)) {
      const taught = ALL_RECIPES.find((r) => r.id === def.teachesRecipeId);
      const prefix = PREFIX_BY_PROFESSION[taught?.professionId ?? ''];
      expect(prefix, `${id}: no prefix recorded for ${taught?.professionId}`).toBeDefined();
      const output = ITEMS[taught?.resultItemId ?? ''];
      expect(def.name, id).toBe(`${prefix}: ${output.name}`);
    }
  });
});

describe('the channel flip leaves no recipe unobtainable', () => {
  it('every UNFLIPPED farm row is still on a real trainer teach list', () => {
    // The on-ramp half. Driven through resolveTrain, the same resolution the
    // sim and the trainer window use, at a skill high enough that any refusal
    // is provably about the CHANNEL and not the tier gate.
    const sim = new Sim({ seed: 11, playerClass: 'warrior' });
    const meta = (sim as unknown as { players: Map<number, PlayerMeta> }).players.get(
      sim.playerId,
    ) as PlayerMeta;
    meta.copper = 1_000_000;
    meta.craftSkills.cooking = 100;
    meta.craftSkills.alchemy = 100;
    const onRamp = FARM_RECIPES.filter((r) => !r.acquisition?.includes('drop'));
    expect(onRamp, 'the on-ramp sweep must run over a non-empty set').toHaveLength(8);
    for (const row of onRamp) {
      const stations = stationsOfType(STATIONS, row.stationType as 'kitchens');
      expect(stations.length, `${row.id}: no station of type ${row.stationType}`).toBeGreaterThan(
        0,
      );
      expect(
        resolveTrain(STATIONS, meta, stations[0].pos, row.id).ok,
        `${row.id} must stay learnable at its trainer`,
      ).toBe(true);
    }
  });

  it('the two halves partition the ladder exactly, by the rung rule', () => {
    // The arm that stops a row from falling between the two: a row with
    // NEITHER channel would pass both sweeps above by simply not being in
    // either set, and would be unobtainable by anyone.
    for (const row of FARM_RECIPES) {
      const isDrop = row.acquisition?.includes('drop') ?? false;
      const isTrainer = row.acquisition?.includes('trainer') ?? false;
      expect(isDrop || isTrainer, `${row.id} has no acquisition channel at all`).toBe(true);
      expect(isDrop && isTrainer, `${row.id} carries BOTH channels`).toBe(false);
      expect(isDrop, `${row.id} at rung ${row.skillReq} is on the wrong side of the floor`).toBe(
        row.skillReq >= FARM_DROP_RUNG_FLOOR,
      );
    }
    expect(FLIPPED_RECIPES.length + 8, 'the two halves must account for every row').toBe(
      FARM_RECIPES.length,
    );
  });
});
