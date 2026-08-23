// Pure pins for the fishing telemetry vocabulary (server/fishing_telemetry.ts):
// the band label set, the rod-fee recipe set and its static fees, and the koi
// classifier. All of it feeds Prometheus label values, so the properties that
// matter are that each set is CLOSED and that each is DERIVED from the same
// content the game runs on, never restated by hand where it could drift.
import { describe, expect, it } from 'vitest';
import { HARVEST_BANDS } from '../server/economy_telemetry';
import {
  FISHING_BANDS,
  fishingBandLabel,
  isKoi,
  isRodFeeRecipe,
  ROD_FEE_RECIPE_IDS,
  rodFeeForRecipe,
} from '../server/fishing_telemetry';
import { FISHING_RARE_ID, FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { ROD_RECIPES } from '../src/sim/content/recipes';
import { trainingFeeFor } from '../src/sim/professions/training';

describe('fishing band labels', () => {
  it('is a closed SIX-value set, one per shipped catch table', () => {
    // Literal pin: the label values external dashboards group by. A SEVENTH
    // band is a design change, and it must redden this rather than silently
    // widen every fishing series. It read three until masterwrought Phase 11i
    // grew the ladder, and this pin did exactly its job then: the widening was
    // a deliberate edit here rather than a set of series that appeared on their
    // own.
    expect([...FISHING_BANDS]).toEqual(['0', '1', '2', '3', '4', '5']);
    // Non-vacuity, and the reason there are exactly three: one per band of
    // catch tables the sim actually rolls.
    expect(FISHING_TABLES_BY_BAND).toHaveLength(FISHING_BANDS.length);
  });

  it('maps every sim band to its own label, with no collisions', () => {
    const bands = [0, 1, 2, 3, 4, 5] as const;
    expect(bands.map((band) => fishingBandLabel(band))).toEqual(['0', '1', '2', '3', '4', '5']);
    // Distinctness is the property the counters need: two bands sharing a
    // label would silently merge two rungs into one series.
    expect(new Set(bands.map((band) => fishingBandLabel(band))).size).toBe(6);
    for (const band of bands) {
      expect(FISHING_BANDS, String(band)).toContain(fishingBandLabel(band));
    }
  });

  it('is disjoint from the zone vocabulary it shares a metric with', () => {
    // The fishing counters carry BOTH a zone and a band label. If a band value
    // could also be a zone id, a mis-ordered emission site would still produce
    // a plausible-looking series instead of being dropped by the guard.
    for (const band of FISHING_BANDS) {
      expect(HARVEST_BANDS, band).not.toContain(band);
    }
    for (const zone of HARVEST_BANDS) {
      expect(FISHING_BANDS as readonly string[], zone).not.toContain(zone);
    }
  });
});

describe('rod fee vocabulary', () => {
  it('IS the TRAINER-taught rod recipe list, derived not restated', () => {
    // Both directions: every trainer-taught rod recipe has a label, and every
    // label is a rod recipe. A one-directional pin would let a stale extra id
    // survive.
    //
    // THE FILTER IS THE POINT, and masterwrought Phase 11i is why it exists.
    // This counter is a PAYMENT count, and the emission site in server/game.ts
    // fires on `trainResult ok` for any id in this list. A pattern-item learn
    // also emits `trainResult ok`, having charged nothing, so the moment a rod
    // recipe became drop-taught an unfiltered vocabulary would have counted
    // every pattern learn as a fee paid. 11i's apex rung is that recipe.
    const trainerTaught = ROD_RECIPES.filter((r) => !(r.acquisition ?? []).includes('drop'));
    const dropTaught = ROD_RECIPES.filter((r) => (r.acquisition ?? []).includes('drop'));
    expect([...ROD_FEE_RECIPE_IDS]).toEqual(trainerTaught.map((recipe) => recipe.id));
    for (const recipe of trainerTaught) {
      expect(isRodFeeRecipe(recipe.id), recipe.id).toBe(true);
    }
    // And the drop-taught rung is REFUSED, which is the half that actually
    // protects the metric. Non-vacuous: the ladder really does carry one.
    expect(dropTaught.map((r) => r.id)).toEqual(['recipe_clockreel_fishing_rod']);
    for (const recipe of dropTaught) {
      expect(isRodFeeRecipe(recipe.id), `${recipe.id} charges no fee`).toBe(false);
    }
    for (const id of ROD_FEE_RECIPE_IDS) {
      expect(
        ROD_RECIPES.some((recipe) => recipe.id === id),
        id,
      ).toBe(true);
    }
    // Non-vacuity plus the concrete members a dashboard filters on. Still TWO
    // after 11i added a third rung, because that rung charges no fee.
    expect([...ROD_FEE_RECIPE_IDS]).toEqual([
      'recipe_stormreel_fishing_rod',
      'recipe_tidewrought_fishing_rod',
    ]);
    expect(ROD_RECIPES).toHaveLength(3);
  });

  it('closes the set: a non-rod recipe and a prototype key are both refused', () => {
    // The recipe id reaches the emission site from a client-driven train
    // command, so a plain-object lookup would resolve 'toString' to an
    // inherited function and hand prom-client a live label. The Map behind
    // these two refuses it.
    for (const id of [
      'recipe_copper_mining_pick',
      'recipe_iron_skinning_knife',
      '',
      'toString',
      'constructor',
      'valueOf',
      '__proto__',
    ]) {
      expect(isRodFeeRecipe(id), id).toBe(false);
      expect(rodFeeForRecipe(id), id).toBe(0);
    }
  });

  it('publishes each rod fee as the trainer actually charges it', () => {
    // Derived from the SAME trainingFeeFor the sim charges with, so the
    // published gauge cannot drift from the copper a player really paid.
    // Scoped to the rows a trainer teaches, for the reason the vocabulary is:
    // trainingFeeFor is a pure tier lookup that answers for ANY recipe, so
    // asking it about the drop-taught rung would publish a fee no trainer ever
    // quotes. The rung reads 0 here, which is rodFeeForRecipe's not-a-rod-fee
    // answer rather than a free lesson.
    for (const recipe of ROD_RECIPES) {
      if ((recipe.acquisition ?? []).includes('drop')) {
        expect(rodFeeForRecipe(recipe.id), `${recipe.id} publishes no fee`).toBe(0);
        continue;
      }
      expect(rodFeeForRecipe(recipe.id), recipe.id).toBe(trainingFeeFor(recipe));
      expect(rodFeeForRecipe(recipe.id), recipe.id).toBeGreaterThan(0);
    }
    // The two rods charge DIFFERENT fees, which is why the exporter publishes
    // the fee per recipe instead of one constant: R8's 4g and 16g rungs.
    expect(rodFeeForRecipe('recipe_stormreel_fishing_rod')).toBe(4 * 100 * 100);
    expect(rodFeeForRecipe('recipe_tidewrought_fishing_rod')).toBe(16 * 100 * 100);
  });
});

describe('koi classification', () => {
  it('recognizes exactly the rare koi, by the content id the sim rolls', () => {
    expect(isKoi(FISHING_RARE_ID)).toBe(true);
    // Literal pin beside the derived one: a re-id of the koi item has to be a
    // deliberate edit here, because the koi counter is the R4 odds numerator.
    expect(FISHING_RARE_ID).toBe('glimmerfin_koi');
    expect(isKoi('glimmerfin_koi')).toBe(true);
  });

  it('refuses every other catch, including junk, an empty id, and prototype keys', () => {
    for (const itemId of [
      'raw_stonescale_carp',
      'soggy_boot',
      'tangled_weeds',
      '',
      'toString',
      'constructor',
      '__proto__',
    ]) {
      expect(isKoi(itemId), itemId).toBe(false);
    }
  });

  it('is true for the koi wherever it appears in a band table and false for its neighbours', () => {
    // Drive the classifier over REAL table contents rather than invented ids:
    // a koi that stopped matching would leave the koi counter at a permanent
    // zero with every literal pin above still green.
    const rolled = new Set<string>();
    for (const byZone of FISHING_TABLES_BY_BAND) {
      for (const table of Object.values(byZone)) {
        for (const row of table) {
          if (row.itemId !== null) rolled.add(row.itemId);
        }
      }
    }
    expect(rolled.size).toBeGreaterThan(1);
    expect(rolled.has(FISHING_RARE_ID)).toBe(true);
    expect([...rolled].filter((itemId) => isKoi(itemId))).toEqual([FISHING_RARE_ID]);
  });
});

describe('the fishing zone label reuses the harvest zone vocabulary', () => {
  it('every zone the catch tables are keyed by is a member of HARVEST_BANDS', () => {
    // The exporter pre-seeds the fishing counters over HARVEST_BANDS rather
    // than a second fishing-specific zone list. If a band table ever names a
    // zone that list does not carry, the sink's guard would silently drop
    // every catch in that water instead of counting it.
    const keyed = new Set<string>();
    for (const byZone of FISHING_TABLES_BY_BAND) {
      for (const zoneId of Object.keys(byZone)) keyed.add(zoneId);
    }
    expect(keyed.size).toBeGreaterThan(0);
    for (const zoneId of keyed) {
      expect(HARVEST_BANDS, zoneId).toContain(zoneId);
    }
  });
});
