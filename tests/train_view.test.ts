// Pure view core for the Phase 9 recipe-training window: master-to-station
// resolution, the tri-state row predicate (known / teachable / locked,
// mirroring isRecipeKnown + teachTierMet exactly), the always-present locked
// ladder with its named requirement, the stable sort, fees and
// affordability, and the unknown-master arm. Driven with both a Sim-shaped
// and a ClientWorld-mirror-shaped deps bag (the identity mirror carries the
// same plain fields either way; sim-only junk must be ignored).
import { describe, expect, it } from 'vitest';
import { STATIONS } from '../src/sim/content/professions';
import { COMBO_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import {
  buildTrainView,
  isRecipeKnownForViewer,
  isStationMasterNpc,
  type TrainViewDeps,
} from '../src/ui/hud/vendor/train_view';

// Base deps: nothing learned, no skill, comfortable purse.
function deps(over: Partial<TrainViewDeps> & Record<string, unknown> = {}): TrainViewDeps {
  return {
    knownRecipes: [],
    craftSkills: {},
    copper: 100000,
    items: ITEMS,
    ...over,
  } as TrainViewDeps;
}

// The ClientWorld-mirror shape is the same plain bag; the Sim-shaped variant
// carries extra junk fields the core must ignore.
const SHAPES: Array<['sim' | 'client', Record<string, unknown>]> = [
  ['sim', { hp: 100, castingAbility: null, entities: new Map() }],
  ['client', {}],
];

describe('isStationMasterNpc', () => {
  it('is true for every STATIONS master and false for anyone else', () => {
    // ALL six masters, parametrized over the registry itself: dropping any
    // master from recognition (a non-combo master included) must fail here,
    // not just the two combo-teaching ones.
    for (const station of STATIONS) {
      expect(isStationMasterNpc(station.masterNpcId), station.masterNpcId).toBe(true);
    }
    expect(STATIONS).toHaveLength(6);
    expect(isStationMasterNpc('marshal_redbrook')).toBe(false);
    expect(isStationMasterNpc('smith_haldren')).toBe(false); // the stall smith is NOT the forge master
    expect(isStationMasterNpc('')).toBe(false);
  });
});

describe('isRecipeKnownForViewer (the one shared viewer predicate)', () => {
  it('grandfathered (no/empty acquisition) always known; trainer recipes only via the set', () => {
    const grandfathered = COMBO_RECIPES[0] && { ...COMBO_RECIPES[0], acquisition: undefined };
    const trainer = COMBO_RECIPES[0];
    expect(isRecipeKnownForViewer(grandfathered, new Set())).toBe(true);
    expect(isRecipeKnownForViewer({ ...trainer, acquisition: [] }, new Set())).toBe(true);
    expect(isRecipeKnownForViewer(trainer, new Set())).toBe(false);
    expect(isRecipeKnownForViewer(trainer, new Set([trainer.id]))).toBe(true);
  });
});

describe('buildTrainView', () => {
  it('an unknown master yields stationType null and zero rows', () => {
    const view = buildTrainView('trader_wilkes', deps());
    expect(view.stationType).toBeNull();
    expect(view.rows).toEqual([]);
  });

  it('the forge master lists BOTH forge crafts (weaponcrafting + armorcrafting), sorted', () => {
    for (const [shape, junk] of SHAPES) {
      const view = buildTrainView('forgemistress_darva', deps(junk));
      expect(view.stationType, shape).toBe('forge');
      const crafts = new Set(view.rows.map((row) => row.professionId));
      expect([...crafts].sort(), shape).toEqual(['armorcrafting', 'weaponcrafting']);
      // Sort: craft, then skillReq, then id.
      const keys = view.rows.map((row) => [row.professionId, row.skillReq, row.recipeId] as const);
      const sorted = [...keys].sort((a, b) => {
        if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
        if (a[1] !== b[1]) return a[1] - b[1];
        return a[2] < b[2] ? -1 : 1;
      });
      expect(keys, shape).toEqual(sorted);
    }
  });

  it('tri-state: grandfathered rows read known, trainer rows split teachable vs locked at the exact tier', () => {
    // armorcrafting 25 meets the ironbound tier; weaponcrafting 24 leaves
    // forgeguard one point short: same window, all three states at once.
    const view = buildTrainView(
      'forgemistress_darva',
      deps({ craftSkills: { armorcrafting: 25, weaponcrafting: 24 } }),
    );
    const byId = new Map(view.rows.map((row) => [row.recipeId, row]));
    expect(byId.get('recipe_eastbrook_arming_sword')?.state).toBe('known'); // no acquisition
    expect(byId.get('recipe_ironbound_warplate_helm')?.state).toBe('teachable');
    expect(byId.get('recipe_forgeguard_bulwark_gauntlets')?.state).toBe('locked');
  });

  it('the SAME row flips locked to teachable across the 24/25 boundary', () => {
    // The tri-state test above splits the boundary across two different rows;
    // this pins the unlock moment the visible ladder points at: one row, one
    // skill point, locked becomes teachable.
    const at = (skill: number) =>
      buildTrainView(
        'forgemistress_darva',
        deps({ craftSkills: { armorcrafting: skill } }),
      ).rows.find((row) => row.recipeId === 'recipe_ironbound_warplate_helm');
    expect(at(24)?.state).toBe('locked');
    expect(at(24)?.requirement).toEqual({ craft: 'armorcrafting', skill: 25 });
    expect(at(25)?.state).toBe('teachable');
    expect(at(25)?.requirement).toBeUndefined();
  });

  it('a learned trainer recipe reads known (the mirrored knownRecipes arm)', () => {
    const view = buildTrainView(
      'forgemistress_darva',
      deps({ knownRecipes: ['recipe_ironbound_warplate_helm'] }),
    );
    const row = view.rows.find((entry) => entry.recipeId === 'recipe_ironbound_warplate_helm');
    expect(row?.state).toBe('known');
  });

  it('locked rows are ALWAYS present and carry the named tier requirement', () => {
    // Skill 0 everywhere: every trainer recipe above the free floor locks (the
    // skillReq-0 Phase 10 ladder rungs stay teachable at tier 0), and each
    // locked row names its craft and the flat threshold tier * TIER_SKILL_STEP.
    // forgemistress_darva serves both forge crafts, so her locked ladder is the
    // two combo recipes plus the tier-1 (skillReq 25) and tier-2 (skillReq 50)
    // weaponcrafting/armorcrafting rungs.
    const view = buildTrainView('forgemistress_darva', deps());
    const locked = view.rows.filter((row) => row.state === 'locked');
    expect(locked.map((row) => row.recipeId).sort()).toEqual([
      'recipe_arcanite_war_axe',
      'recipe_elderwood_battle_staff',
      'recipe_forgeguard_bulwark_gauntlets',
      'recipe_ironbound_warplate_helm',
      'recipe_ironedge_longsword',
      'recipe_ironlink_hauberk',
      'recipe_ironlink_legguards',
      'recipe_ironlink_spaulders',
      'recipe_ironshod_maul',
      'recipe_thorium_warblade',
      'recipe_thoriumscale_cuirass',
      'recipe_thoriumscale_greathelm',
      'recipe_thoriumscale_leggings',
      'recipe_whetted_iron_dirk',
    ]);
    // LITERAL requirement values per rung (never the production formula: an
    // expectation composed of tierForSkill * TIER_SKILL_STEP moves in
    // lockstep with the code and can never red on a wrong requirement).
    const REQUIRED_SKILL_BY_RUNG: Record<number, number> = { 25: 25, 50: 50 };
    for (const row of locked) {
      const skill = REQUIRED_SKILL_BY_RUNG[row.skillReq];
      expect(skill, `${row.recipeId} rung ${row.skillReq}`).toBeDefined();
      expect(row.requirement).toEqual({ craft: row.professionId, skill });
    }
    // Known rows never carry a requirement.
    for (const row of view.rows.filter((entry) => entry.state === 'known')) {
      expect(row.requirement, row.recipeId).toBeUndefined();
    }
  });

  it('fees come from trainingFeeFor and affordability compares the viewer copper', () => {
    const rich = buildTrainView(
      'forgemistress_darva',
      deps({ craftSkills: { armorcrafting: 25 }, copper: 2500 }),
    );
    const teachable = rich.rows.find((row) => row.recipeId === 'recipe_ironbound_warplate_helm');
    expect(teachable?.feeCopper).toBe(2500);
    expect(teachable?.affordable).toBe(true); // exact balance affords

    const poor = buildTrainView(
      'forgemistress_darva',
      deps({ craftSkills: { armorcrafting: 25 }, copper: 2499 }),
    );
    const short = poor.rows.find((row) => row.recipeId === 'recipe_ironbound_warplate_helm');
    expect(short?.affordable).toBe(false);
    // Grandfathered (known) rows are free.
    const known = poor.rows.find((row) => row.recipeId === 'recipe_eastbrook_arming_sword');
    expect(known?.feeCopper).toBe(0);
  });

  it('the apothecary master lists the alchemy ladder with its combo teachable at tier 1', () => {
    const view = buildTrainView('alchemist_verane', deps({ craftSkills: { alchemy: 25 } }));
    expect(view.stationType).toBe('apothecary');
    const combo = view.rows.find((row) => row.recipeId === 'recipe_volatile_flux_elixir');
    expect(combo?.state).toBe('teachable');
    // Every row belongs to the station's craft.
    for (const row of view.rows) expect(row.professionId, row.recipeId).toBe('alchemy');
  });

  it('rows resolve their result item defs for the painter', () => {
    const view = buildTrainView('forgemistress_darva', deps());
    for (const row of view.rows) {
      expect(row.item, `${row.recipeId} result ${row.resultItemId}`).toBeDefined();
    }
  });

  it('every combo recipe is reachable from exactly one master window', () => {
    // The three trainer-taught combos each surface at their craft's station
    // and nowhere else (recipe coverage across the six masters).
    const masters = [
      'forgemistress_darva',
      'cook_marlow',
      'weaver_ottilie',
      'tinker_gizzel',
      'tanner_hesk',
      'alchemist_verane',
    ];
    for (const combo of COMBO_RECIPES) {
      const listing = masters.filter((master) =>
        buildTrainView(master, deps()).rows.some((row) => row.recipeId === combo.id),
      );
      expect(listing, combo.id).toHaveLength(1);
    }
  });
});
