// The honest material taxonomy (src/sim/material_taxonomy.ts): census-style
// membership pins for the derived source-or-reagent junk set behind the bank
// "Deposit materials" sweep and the bags/bank Materials chip. The set is pinned
// by EXACT-set equality against a literal id list (staples from the 2026-08-01
// settlement plus raw fishing catches as junk cooking reagents, plus the claw
// and tusk corpse-harvest materials), swept for class exclusions by KIND
// against the live catalog (never by use type: simple_fishing_pole is
// use-type 'fishing' and several tools carry no use at all), and closed by a
// completeness tripwire that enumerates the ONLY non-poor junk allowed to
// stay unclassified, so a future junk item must be classified here explicitly
// instead of drifting in or out silently.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { FARM_MATERIAL_ITEM_IDS } from '../src/sim/content/farm_crops';
import {
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
// ALL_RECIPES from data (the merged view the module itself reads), not from
// content/recipes: if data.ts ever merges a second recipe source, the
// inclusion arm must ride the same table or it silently tests a subset.
import { ALL_RECIPES, ITEMS } from '../src/sim/data';
import {
  deriveMaterialItemIds,
  isMaterialItem,
  MATERIAL_ITEM_IDS,
  type MaterialSourceTables,
} from '../src/sim/material_taxonomy';
import {
  ARMOR_SECONDARY_BY_TYPE,
  DISENCHANT_MATERIAL_BY_QUALITY,
} from '../src/sim/professions/disenchant_reagents';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import { SALVAGE_MATERIAL_BY_QUALITY } from '../src/sim/professions/salvage';

// The ruled material set, exactly (staples in; grey trash and the allowlisted
// oddments out; raw fishing catches IN as junk cooking reagents). A diff here is a
// deliberate taxonomy change: re-pin it AND re-check the settlement rulings.
const HONEST_MATERIALS = [
  'arcane_dust',
  'arcane_essence',
  'arcane_shard',
  'arcanite_bar',
  'ashwood_log',
  // Masterwrought phase 11l: the five promoted trophy drops (this one and
  // the four at their sorted positions below) derive IN as the reagents the
  // trophy recipes (TROPHY_RECIPES) consume. The chipped tusk, the bogiron
  // nugget and the cracked fetish are NOT among them: the sixth fix round
  // output-excluded the tusk and the 11l QA the other two under the same
  // standard (poor trash again, see SURVIVING_POOR_JUNK below).
  'bandit_bandana',
  'bog_beet',
  'bog_beet_seed',
  'bone_fragments',
  'brook_carrot',
  'brook_carrot_seed',
  'compost',
  'cooking_salt',
  'copper_ore',
  'cracked_ogre_tusk',
  'cracked_wyrm_scale',
  'curved_tusk',
  // Masterwrought phase 09: derives IN as the reagent the apex weapon rows
  // consume (APEX_GEAR_RECIPES), per the phase 07 allowlist obligation.
  'duskforged_billet',
  'elderwood_log',
  // Masterwrought phase 11l's second review round: already common (never
  // poor), derives IN as the trophy recipe_cragprowl_belt consumes
  // (TROPHY_RECIPES); the pelt below is its twin.
  'emberwing_cinderscale',
  'evergarden_greens',
  'evergarden_greens_seed',
  'evergarden_pumpkin',
  'evergarden_pumpkin_seed',
  'fine_ashwood_log',
  'fine_bog_beet',
  'fine_brook_carrot',
  'fine_copper_ore',
  'fine_elderwood_log',
  'fine_evergarden_greens',
  'fine_evergarden_pumpkin',
  'fine_frost_gourd',
  'fine_frost_lentils',
  'fine_gilded_sunmelon',
  'fine_gilded_yam',
  'fine_goldleaf_herb',
  'fine_highland_barley',
  'fine_iron_ore',
  'fine_ironbark_log',
  'fine_marsh_rice',
  'fine_silverleaf_herb',
  'fine_sunpetal_herb',
  'fine_thorium_ore',
  'fine_thornpeak_cabbage',
  'fine_vale_wheat',
  // Masterwrought phase 08: derives IN as the reagent the apex armor rows
  // consume (APEX_ARMOR_RECIPES), per the phase 07 allowlist obligation.
  'forgefold_plating',
  'frost_gourd',
  'frost_gourd_seed',
  'frost_lentils',
  'frost_lentils_seed',
  'game_meat',
  'gilded_sunmelon',
  'gilded_sunmelon_seed',
  'gilded_yam',
  'gilded_yam_seed',
  'glass_vial',
  'glimmerfin_koi',
  'goldleaf_herb',
  'growth_tonic',
  'highland_barley',
  'highland_barley_seed',
  'homespun_cloth',
  'iron_ore',
  'ironbark_log',
  'linen_scrap',
  // Masterwrought phase 10: derives IN as the reagent all five Lucent
  // (apex) ENCHANTS consume (the weapon int twin joined at the head of
  // phase 11), through the enchant half of the reagent union rather than
  // the recipe half, per the phase 07 allowlist obligation.
  'lucent_reagent',
  'marsh_rice',
  'marsh_rice_seed',
  'mudfin_scale',
  // Masterwrought phase 11l's second review round: already common (never
  // poor), derives IN as the trophy recipe_wildgrove_cinch consumes
  // (TROPHY_RECIPES); the cinderscale above is its twin.
  'old_cragmaws_pelt',
  // Masterwrought phase 09: derives IN as the reagent the apex engineering
  // rows consume (APEX_GEAR_RECIPES), per the phase 07 allowlist obligation.
  'precision_chassis',
  'prime_cut',
  // Masterwrought phase 09: derives IN as the reagent the apex jewelcrafting
  // rows consume (APEX_GEAR_RECIPES), per the phase 07 allowlist obligation.
  'prismglass_setting',
  'pristine_claw',
  'pristine_hide',
  'pristine_silk',
  'pristine_venom_gland',
  // Masterwrought phase 07: derives IN as the junk-kind reagent all nine
  // intermediate recipes consume (INTERMEDIATE_RECIPES).
  'quickening_catalyst',
  'raw_bog_eel',
  // The three high-band catches (masterwrought Phase 11i): recipe reagents and
  // node-free junk, so they derive IN exactly the way the six above do.
  'raw_deepbarb_catfish',
  'raw_frostgill_trout',
  'raw_hollowgill_sturgeon',
  'raw_marsh_pike',
  'raw_mirror_trout',
  'raw_river_perch',
  'raw_stillmere_salmon',
  'raw_stonescale_carp',
  'resonant_hide',
  'resonant_links',
  'resonant_steel',
  'resonant_thread',
  'resonant_timber',
  'rough_hide',
  // Masterwrought phase 09: derives IN as the reagent the apex inscription
  // row consumes (APEX_GEAR_RECIPES), per the phase 07 allowlist obligation.
  'sablewax_vellum',
  // Masterwrought phase 10: derives IN as the reagent the apex cooking rows
  // consume (the three role foods plus The Laden Hearth in
  // APEX_CONSUMABLE_RECIPES), per the phase 07 allowlist obligation.
  'seasoned_stock',
  'sharp_claw',
  'silverleaf_herb',
  'smithing_flux',
  'spider_leg',
  'spider_silk',
  'spool_of_thread',
  'sunpetal_herb',
  // Masterwrought phase 08: derives IN via the tailoring apex rows.
  'sunspun_bolt',
  'tallow_candle',
  'tanning_agent',
  'thorium_ore',
  'thornpeak_cabbage',
  'thornpeak_cabbage_seed',
  // The farming yields (content/farm_crops.ts): produce, its fine twin, the
  // seed a plant consumes, and the husks a failed crop pays. IN as materials
  // for the same reason node yields are, and the seed because it is the
  // tradeable input side of the same gathering loop. The crop-ladder phase's
  // seven crop families (21 more ids) sit at their sorted positions above.
  'vale_wheat',
  'vale_wheat_seed',
  'venom_gland',
  'withered_husks',
  'wolf_fang',
  // Masterwrought phase 08: both derive IN via the apex armor rows
  // (wyrmfall_core is a reagent on all ten, cording on the leather three).
  'wyrmfall_core',
  'wyrmhide_cording',
] as const;

// The ONLY non-poor junk allowed outside the material set, all eight of them:
// two rare-mob signature trophies (dawnhold_posy, gleamstag_charm), the
// guardian_core and last_keep_signet oddments (the Quickening Catalyst is
// deliberately NOT here, it derives IN via its nine in-phase consumers), the
// Phase 12 harvest_feast (a crafted PLACEABLE, not a material: nothing crafts
// FROM it, and its one consumer is the place_feast command), and the three
// Masterwrought phase 11k apex role feasts on the same footing
// (sageleaf_feast, stonepot_feast, warspice_feast). A new junk item landing in
// this assertion's diff must be classified: either author it into a source
// table (a node yield, grade, component, specimen, salvage return, or
// junk-kind reagent) so it derives IN, or add it here as a deliberate
// non-material with the maintainer's sign-off.
const ALLOWED_UNCLASSIFIED_JUNK = [
  'dawnhold_posy',
  // Masterwrought phase 11l's second review round removed
  // emberwing_cinderscale and old_cragmaws_pelt: the two leather trophy
  // recipes (recipe_cragprowl_belt, recipe_wildgrove_cinch) are their
  // consumers, so both derive IN through the reagent source table
  // (HONEST_MATERIALS above); the completeness tripwire below forces the
  // move.
  'gleamstag_charm',
  'guardian_core',
  'harvest_feast',
  'last_keep_signet',
  // masterwrought Phase 11k's three apex role feasts: kind 'junk' by the same
  // tonic precedent harvest_feast set, and nothing crafts FROM any of them, so
  // all three are deliberate non-materials on the harvest_feast footing above.
  // Unlike Phase 11i's retired capstone (which sat here while being
  // unplaceable), each of these IS reachable: professions/feast.ts takes the
  // item id it is placing since 11k, so a use really does set the table out.
  'sageleaf_feast',
  'stonepot_feast',
  'warspice_feast',
  // Phase 08 removed forgefold_plating, wyrmhide_cording, sunspun_bolt, and
  // wyrmfall_core: the apex armor rows are their consumers, so all four now
  // derive IN through the reagent source table (HONEST_MATERIALS above).
  // Phase 09 removed duskforged_billet, precision_chassis,
  // prismglass_setting, and sablewax_vellum the same way: the apex gear rows
  // (APEX_GEAR_RECIPES) are their consumers.
  // Phase 10 removed lucent_reagent: the five Lucent enchants are its
  // consumers (four at phase 10, the weapon int twin at the head of phase
  // 11), and enchant reagents feed the same union recipe reagents do.
  // Phase 10 also removed seasoned_stock: the three role foods and The Laden
  // Hearth (APEX_CONSUMABLE_RECIPES) are its consumers, the same derivation
  // the phase 08/09 intermediates took.
] as const;

// The six vendor-buyable crafting staples, ruled IN by name (Q6).
const VENDOR_STAPLES = [
  'arcanite_bar',
  'cooking_salt',
  'glass_vial',
  'smithing_flux',
  'spool_of_thread',
  'tanning_agent',
] as const;

describe('MATERIAL_ITEM_IDS: the honest material set, exactly', () => {
  it('equals the ruled material set by exact-set equality', () => {
    expect([...MATERIAL_ITEM_IDS].sort()).toEqual([...HONEST_MATERIALS]);
  });

  it('contains every vendor staple by name (Q6: staples are IN)', () => {
    for (const id of VENDOR_STAPLES) {
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
  });

  it('every member is a real, non-poor, junk-kind catalog item', () => {
    for (const id of MATERIAL_ITEM_IDS) {
      const def = ITEMS[id];
      expect(def, `${id} has no ITEMS def`).toBeTruthy();
      expect(def?.kind, `${id} is kind ${def?.kind}`).toBe('junk');
      expect(def?.quality, `${id} is quality poor`).not.toBe('poor');
    }
  });
});

describe('MATERIAL_ITEM_IDS: class exclusions, keyed on KIND against the live catalog', () => {
  it('excludes every non-junk item: tools, equipment, quest, mount, bag, food, and the rest', () => {
    // Kind-keyed on purpose: a use-type sweep would miss simple_fishing_pole
    // (use-type 'fishing') and the tools that carry no use at all. The census
    // below keeps the title honest: the sweep is only as strong as the kinds
    // the catalog actually carries.
    const kinds = new Set(Object.values(ITEMS).map((d) => d.kind));
    const censused = [
      'tool',
      'weapon',
      'armor',
      'held_offhand',
      'quest',
      'mount',
      'bag',
      'food',
      'drink',
      'potion',
      'elixir',
      'scroll',
      'flask',
      // Masterwrought phase 11: the apex pattern items (kind 'recipe') are
      // the first shipped rows of their kind, so the census claims them and
      // the non-junk sweep proves no pattern ever classifies as a material.
      'recipe',
    ] as const;
    for (const kind of censused) {
      expect(kinds.has(kind), `catalog carries no kind-${kind} item`).toBe(true);
    }
    for (const def of Object.values(ITEMS)) {
      if (def.kind === 'junk') continue;
      expect(MATERIAL_ITEM_IDS.has(def.id), `${def.id} (kind ${def.kind})`).toBe(false);
    }
  });

  it('excludes every quality-poor item (grey trash deposits only by hand)', () => {
    let poor = 0;
    for (const def of Object.values(ITEMS)) {
      if (def.quality !== 'poor') continue;
      poor++;
      expect(MATERIAL_ITEM_IDS.has(def.id), def.id).toBe(false);
    }
    // Non-vacuity: a rename of the 'poor' quality token must not leave this
    // sweep iterating nothing (16 poor items at the 11l QA; the build's
    // comment said 13 against a live 14, an off-by-one the QA measured, and
    // its floor of 9 sat 37 percent under the count, so the floor now sits
    // near it, the round's own standard; re-derive it DOWNWARD with the next
    // promotion, never delete it). The exact live set is pinned below in
    // SURVIVING_POOR_JUNK; this is the belt to that suspenders.
    expect(poor).toBeGreaterThan(12);
  });

  it('excludes the named settlement cases: implements, charms, cosmetics, oddments', () => {
    // Belt to the kind sweeps' suspenders: the exact ids the settlement argued
    // over, pinned by name so a kind re-authoring cannot silently re-admit one.
    // Raw fishing catches are deliberately IN once kind is junk (cooking
    // reagents); see the membership arm below.
    const ruledOut = [
      'simple_fishing_pole', // kind tool, use-type fishing
      'gatherers_cache', // charm (kind tool by deliberate authoring)
      'artisans_eye', // charm
      'makers_charm', // charm (the phase 09 apex quantity rung)
      'heroic_mark', // kind tool token
      'riding_training', // kind tool token
      ...ALLOWED_UNCLASSIFIED_JUNK, // the allowlisted oddments + pre-consumer intermediates
    ];
    for (const id of ruledOut) {
      expect(ITEMS[id], `${id} has no ITEMS def`).toBeTruthy();
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(false);
    }
  });

  it('includes every raw fishing catch that recipes consume (junk cooking reagents)', () => {
    const catches = [
      'raw_mirror_trout',
      'raw_river_perch',
      'raw_marsh_pike',
      'raw_bog_eel',
      'raw_frostgill_trout',
      'raw_stonescale_carp',
      'glimmerfin_koi',
      'raw_deepbarb_catfish',
      'raw_hollowgill_sturgeon',
      'raw_stillmere_salmon',
    ] as const;
    for (const id of catches) {
      expect(ITEMS[id], `${id} has no ITEMS def`).toBeTruthy();
      expect(ITEMS[id]?.kind, id).toBe('junk');
      expect(ITEMS[id]?.foodHp, id).toBeUndefined();
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
  });
});

describe('MATERIAL_ITEM_IDS: every source table is fully represented', () => {
  it('contains every node yield', () => {
    let rows = 0;
    for (const byZone of Object.values(NODE_MATERIAL_TABLE)) {
      for (const row of Object.values(byZone)) {
        rows++;
        expect(MATERIAL_ITEM_IDS.has(row.itemId), row.itemId).toBe(true);
      }
    }
    expect(rows).toBeGreaterThan(0); // non-vacuity: the table really enumerated
  });

  it('contains every fine grade', () => {
    let rows = 0;
    for (const row of Object.values(MATERIAL_GRADES)) {
      rows++;
      expect(MATERIAL_ITEM_IDS.has(row.fineItemId), row.fineItemId).toBe(true);
    }
    expect(rows).toBeGreaterThan(0);
  });

  it('contains every harvest component and every pristine specimen', () => {
    let rows = 0;
    for (const id of Object.values(HARVEST_COMPONENT_ITEMS)) {
      rows++;
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
    expect(rows).toBeGreaterThan(0);
    rows = 0;
    for (const id of Object.values(HARVEST_COMPONENT_SPECIMENS)) {
      rows++;
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
    expect(rows).toBeGreaterThan(0);
  });

  it('contains every farming yield and supply: produce, fine twin, seed, husks, knobs', () => {
    // Farming is fishing-shaped, not node-shaped: nothing it yields is in
    // NODE_MATERIAL_TABLE and its fine grade is deliberately not a
    // MATERIAL_GRADES row, so without its own source loop every crop the
    // ladder phase adds would land unclassified. The two knob supplies
    // (compost and the growth tonic, the knobs phase) join through the same
    // source: they are the tradeable input side of the same loop, exactly
    // like the seeds.
    for (const id of FARM_MATERIAL_ITEM_IDS) {
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
    // Anti-vacuous: the derived list is not empty and really does span all
    // the families, so a crop table that stopped exporting would red here
    // instead of passing over nothing.
    expect([...FARM_MATERIAL_ITEM_IDS].sort()).toEqual([
      'bog_beet',
      'bog_beet_seed',
      'brook_carrot',
      'brook_carrot_seed',
      'compost',
      'evergarden_greens',
      'evergarden_greens_seed',
      'evergarden_pumpkin',
      'evergarden_pumpkin_seed',
      'fine_bog_beet',
      'fine_brook_carrot',
      'fine_evergarden_greens',
      'fine_evergarden_pumpkin',
      'fine_frost_gourd',
      'fine_frost_lentils',
      'fine_gilded_sunmelon',
      'fine_gilded_yam',
      'fine_highland_barley',
      'fine_marsh_rice',
      'fine_thornpeak_cabbage',
      'fine_vale_wheat',
      'frost_gourd',
      'frost_gourd_seed',
      'frost_lentils',
      'frost_lentils_seed',
      'gilded_sunmelon',
      'gilded_sunmelon_seed',
      'gilded_yam',
      'gilded_yam_seed',
      'growth_tonic',
      'highland_barley',
      'highland_barley_seed',
      'marsh_rice',
      'marsh_rice_seed',
      'thornpeak_cabbage',
      'thornpeak_cabbage_seed',
      'vale_wheat',
      'vale_wheat_seed',
      'withered_husks',
    ]);
  });

  it('contains every salvage return', () => {
    let rows = 0;
    for (const id of Object.values(SALVAGE_MATERIAL_BY_QUALITY)) {
      rows++;
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
    expect(rows).toBeGreaterThan(0);
  });

  it('contains every junk-kind recipe and enchant reagent', () => {
    // The same enumeration recipe as tests/crafting_materials_quality.test.ts
    // (which proves these reagents resolve and are never poor); this arm rides
    // it to prove the junk-kind slice all classifies as materials.
    const reagentIds = new Set<string>();
    for (const r of ALL_RECIPES) for (const rg of r.reagents) reagentIds.add(rg.itemId);
    for (const e of Object.values(ENCHANTS)) for (const rg of e.reagents) reagentIds.add(rg.itemId);
    let junkReagents = 0;
    for (const id of reagentIds) {
      if (ITEMS[id]?.kind !== 'junk') continue;
      junkReagents++;
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
    // Non-vacuity: the junk slice of the reagent union is most of the set.
    expect(junkReagents).toBeGreaterThan(30);
  });

  it('contains every disenchant output (the one source reached only via the reagent union)', () => {
    // The derive deliberately does not union the disenchant tables: the
    // no-dead-end rule in disenchant_reagents.ts says every output is consumed
    // by some enchant, so they all arrive as reagents. This arm keeps that
    // chain honest with failure locality: if an enchant rework orphans an
    // output, the red names the id instead of an opaque exact-set diff.
    const outputs = new Set<string>([
      ...Object.values(DISENCHANT_MATERIAL_BY_QUALITY),
      ...Object.values(ARMOR_SECONDARY_BY_TYPE),
      'resonant_timber', // the two weapon secondaries typedSecondaryFor yields
      'resonant_steel', // as literals, outside the two tables above
    ]);
    let rows = 0;
    for (const id of outputs) {
      rows++;
      expect(MATERIAL_ITEM_IDS.has(id), id).toBe(true);
    }
    expect(rows).toBeGreaterThan(5);
  });
});

describe('deriveMaterialItemIds: every source table is actually consulted (injection pins)', () => {
  // Several sources fully overlap the reagent union on today's content (every
  // node yield, harvest component, specimen, and salvage return is also some
  // recipe or enchant reagent), so deleting one of those derive loops changes
  // nothing observable on the live tables and no black-box census can catch
  // it. These arms pin each loop the only way that can: inject a synthetic
  // junk-kind id into exactly ONE source table and prove it derives IN.
  const PROBE = 'zzz_taxonomy_probe';
  const BASE: MaterialSourceTables = {
    nodeMaterialTable: NODE_MATERIAL_TABLE,
    materialGrades: MATERIAL_GRADES,
    harvestComponentItems: HARVEST_COMPONENT_ITEMS,
    harvestComponentSpecimens: HARVEST_COMPONENT_SPECIMENS,
    salvageMaterialByQuality: SALVAGE_MATERIAL_BY_QUALITY,
    farmMaterialItemIds: FARM_MATERIAL_ITEM_IDS,
    recipes: ALL_RECIPES,
    enchants: ENCHANTS,
    items: ITEMS,
  };
  // The probe def rides the real catalog so the junk-kind filter sees it.
  const itemsWithProbe: typeof ITEMS = {
    ...ITEMS,
    [PROBE]: { ...ITEMS.iron_ore, id: PROBE, name: 'Taxonomy Probe' },
  };

  it('baseline sanity: the probe id is in no source and derives OUT', () => {
    expect(deriveMaterialItemIds({ ...BASE, items: itemsWithProbe }).has(PROBE)).toBe(false);
  });

  const anyOreRow = Object.values(NODE_MATERIAL_TABLE.ore)[0];
  const anyGradeRow = Object.values(MATERIAL_GRADES)[0];
  const anyEnchant = Object.values(ENCHANTS)[0];
  const CASES: ReadonlyArray<[string, Partial<MaterialSourceTables>]> = [
    [
      'node yield',
      {
        nodeMaterialTable: {
          ...NODE_MATERIAL_TABLE,
          ore: { ...NODE_MATERIAL_TABLE.ore, zzz_probe_zone: { ...anyOreRow, itemId: PROBE } },
        },
      },
    ],
    [
      'fine grade',
      { materialGrades: { ...MATERIAL_GRADES, [PROBE]: { ...anyGradeRow, fineItemId: PROBE } } },
    ],
    [
      'harvest component',
      { harvestComponentItems: { ...HARVEST_COMPONENT_ITEMS, zzz_probe_part: PROBE } },
    ],
    [
      'pristine specimen',
      { harvestComponentSpecimens: { ...HARVEST_COMPONENT_SPECIMENS, zzz_probe_part: PROBE } },
    ],
    [
      'salvage return',
      { salvageMaterialByQuality: { ...SALVAGE_MATERIAL_BY_QUALITY, zzz_probe_quality: PROBE } },
    ],
    ['farming yield', { farmMaterialItemIds: [...FARM_MATERIAL_ITEM_IDS, PROBE] }],
    [
      'recipe reagent',
      { recipes: [...ALL_RECIPES, { ...ALL_RECIPES[0], reagents: [{ itemId: PROBE, count: 1 }] }] },
    ],
    [
      'enchant reagent',
      {
        enchants: {
          ...ENCHANTS,
          zzz_probe_enchant: { ...anyEnchant, reagents: [{ itemId: PROBE, count: 1 }] },
        },
      },
    ],
  ];
  for (const [source, override] of CASES) {
    it(`a junk-kind id authored only as a ${source} row derives IN`, () => {
      const derived = deriveMaterialItemIds({ ...BASE, ...override, items: itemsWithProbe });
      // Exact both ways with failure locality: the probe joined, nothing else
      // moved, and a red names the id instead of a bare boolean.
      expect([...derived].sort()).toEqual([...HONEST_MATERIALS, PROBE].sort());
    });
  }

  it('the kind filter applies to every source: a non-junk probe derives OUT everywhere', () => {
    const toolProbe: typeof ITEMS = {
      ...ITEMS,
      [PROBE]: { ...ITEMS.simple_fishing_pole, id: PROBE, name: 'Taxonomy Probe' },
    };
    for (const [source, override] of CASES) {
      expect(
        deriveMaterialItemIds({ ...BASE, ...override, items: toolProbe }).has(PROBE),
        source,
      ).toBe(false);
    }
  });
});

describe('completeness tripwire: unclassified non-poor junk', () => {
  it('is exactly the pinned allowlist, no more and no fewer', () => {
    const unclassified = Object.values(ITEMS)
      .filter((d) => d.kind === 'junk' && d.quality !== 'poor' && !MATERIAL_ITEM_IDS.has(d.id))
      .map((d) => d.id)
      .sort();
    expect(unclassified).toEqual([...ALLOWED_UNCLASSIFIED_JUNK]);
  });
});

describe('phase 11l trophy promotion: the promoted set, exactly', () => {
  // The 21 quality-poor junk ids at the phase 11l boundary, frozen. The 5
  // promoted trophies became common TROPHY_RECIPES reagents (and so derive
  // IN); the 16 survivors stay poor grey trash outside the material set (the
  // chipped tusk rejoined them at the sixth fix round, which output-excluded
  // it: every uncrafted weapon in its band is dominated by the trainer's own
  // recipe_whetted_iron_dirk; the bogiron nugget and the cracked fetish
  // rejoined at the 11l QA under the same standard, their outputs dominated
  // by the trainer's own rung-0 sabatons and rung-25 folio). A diff on
  // either side means a shipped poor item was promoted (or a promoted one
  // demoted) by accident.
  const PRE_11L_POOR_JUNK = [
    'amber_hide',
    'bandit_bandana',
    'bogiron_nugget',
    'briny_idol',
    'chipped_tusk',
    'cracked_fetish',
    'cracked_ogre_tusk',
    'cracked_wyrm_scale',
    'deepfen_pearl',
    'frayed_prayer_beads',
    'inert_storm_shard',
    'moonpale_scale',
    'mudfin_scale',
    'ogre_toe_ring',
    'pale_pearl',
    'soft_down',
    'soggy_boot',
    'soggy_moccasin',
    'stag_antler',
    'tallow_candle',
    'tangled_weed',
  ] as const;
  const PROMOTED_TROPHIES = new Set<string>([
    'bandit_bandana',
    'cracked_ogre_tusk',
    'cracked_wyrm_scale',
    'mudfin_scale',
    'tallow_candle',
  ]);
  // The promoted trophies keep their FROZEN vendor price: the promotion changed
  // quality and recipe membership only, never sellValue, so a trophy a player
  // already held sells for exactly what it did before. Literal values, so
  // "sellValue unchanged" is measured here rather than claimed.
  const PROMOTED_SELL_VALUE: Record<string, number> = {
    bandit_bandana: 6,
    cracked_ogre_tusk: 42,
    cracked_wyrm_scale: 35,
    mudfin_scale: 5,
    tallow_candle: 5,
  };
  // The three output-excluded trophies (the tusk at the sixth fix round, the
  // nugget and the fetish at the 11l QA) went BACK to poor with their
  // sellValue frozen too, and that half of the claim left the promoted map
  // when they did; pinned here so the revert is measured on both axes.
  const RESTORED_POOR_SELL_VALUE: Record<string, number> = {
    chipped_tusk: 15,
    bogiron_nugget: 12,
    cracked_fetish: 14,
  };
  // The 16 survivors as the LIVE poor set must read, sorted.
  const SURVIVING_POOR_JUNK = [
    'amber_hide',
    'bogiron_nugget',
    'briny_idol',
    'chipped_tusk',
    'cracked_fetish',
    'deepfen_pearl',
    'frayed_prayer_beads',
    'inert_storm_shard',
    'moonpale_scale',
    'ogre_toe_ring',
    'pale_pearl',
    'soft_down',
    'soggy_boot',
    'soggy_moccasin',
    'stag_antler',
    'tangled_weed',
  ];

  it('promotes exactly the 5 trophies to common materials and leaves the 16 survivors poor', () => {
    // Length guards first: an emptied literal or set would let the loop below
    // pass vacuously.
    expect(PRE_11L_POOR_JUNK).toHaveLength(21);
    expect(PROMOTED_TROPHIES.size).toBe(5);
    expect(SURVIVING_POOR_JUNK).toHaveLength(16);
    expect(Object.keys(PROMOTED_SELL_VALUE).sort()).toEqual([...PROMOTED_TROPHIES].sort());
    expect(SURVIVING_POOR_JUNK).toEqual(
      PRE_11L_POOR_JUNK.filter((id) => !PROMOTED_TROPHIES.has(id)),
    );
    for (const id of PRE_11L_POOR_JUNK) {
      const def = ITEMS[id];
      expect(def, `${id} has no ITEMS def`).toBeTruthy();
      if (PROMOTED_TROPHIES.has(id)) {
        expect(def?.quality, `${id} should be common`).toBe('common');
        expect(MATERIAL_ITEM_IDS.has(id), `${id} should be a material`).toBe(true);
        expect(def?.sellValue, `${id} sellValue must stay frozen`).toBe(PROMOTED_SELL_VALUE[id]);
      } else {
        expect(def?.quality, `${id} should stay poor`).toBe('poor');
        expect(MATERIAL_ITEM_IDS.has(id), `${id} should stay out of the material set`).toBe(false);
      }
    }
    expect(Object.keys(RESTORED_POOR_SELL_VALUE)).toHaveLength(3);
    for (const [id, sellValue] of Object.entries(RESTORED_POOR_SELL_VALUE)) {
      // Read off the live def, not the sibling literal (a literal-to-literal
      // membership check reads no production state). The frozen-21 loop
      // above already asserts poor for these ids and fires first, so this
      // line is documentation of the revert's quality axis beside its
      // sellValue axis, not the load-bearing arm.
      expect(ITEMS[id]?.quality, `${id} is poor again`).toBe('poor');
      expect(ITEMS[id]?.sellValue, `${id} sellValue must stay frozen`).toBe(sellValue);
    }
  });

  it('the LIVE poor set is exactly the 16 survivors (a new poor id cannot land unseen)', () => {
    // The frozen-21 loop above only visits ids it already knows, so a poor
    // item authored AFTER the phase 11l boundary would never enter it: this
    // exact-set pin over the whole catalog closes that direction. The
    // toBeGreaterThan(12) floor in the quality sweep stays as the settled
    // non-vacuity guard; this is the membership pin beside it, not a
    // replacement for it.
    expect(
      Object.values(ITEMS)
        .filter((d) => d.quality === 'poor')
        .map((d) => d.id)
        .sort(),
    ).toEqual(SURVIVING_POOR_JUNK);
  });

  // The two already-common rare-elite leather trophies the phase's second
  // review round adopted (recipe_cragprowl_belt, recipe_wildgrove_cinch).
  // Neither was ever poor, so the frozen-21 loop above never visits them:
  // this is their own pin, the same three-way shape (quality, frozen
  // sellValue, material membership), with literal values for the same reason.
  // The quality === 'common' assertion is the "never poor" evidence; a
  // not-in-PRE_11L_POOR_JUNK check would be vacuous beside it (that list is
  // frozen text, so it can never start containing them).
  const ADOPTED_NON_POOR: Record<string, number> = {
    emberwing_cinderscale: 320,
    old_cragmaws_pelt: 300,
  };

  it('adopts the two already-common leather trophies as materials at their frozen sellValue', () => {
    expect(Object.keys(ADOPTED_NON_POOR)).toHaveLength(2);
    for (const [id, sellValue] of Object.entries(ADOPTED_NON_POOR)) {
      const def = ITEMS[id];
      expect(def, `${id} has no ITEMS def`).toBeTruthy();
      expect(def?.quality, `${id} is common`).toBe('common');
      expect(def?.sellValue, `${id} sellValue must stay frozen`).toBe(sellValue);
      expect(MATERIAL_ITEM_IDS.has(id), `${id} should be a material`).toBe(true);
    }
  });
});

describe('isMaterialItem', () => {
  it('answers by set membership on the live defs', () => {
    expect(isMaterialItem(ITEMS.iron_ore)).toBe(true);
    expect(isMaterialItem(ITEMS.arcanite_bar)).toBe(true);
    expect(isMaterialItem(ITEMS.simple_fishing_pole)).toBe(false);
    expect(isMaterialItem(ITEMS.guardian_core)).toBe(false);
  });
});

describe('no src/sim importer (the module-evaluation hard rule)', () => {
  // Two sim leaves carry the identical UI-only contract: material_taxonomy
  // (this file's module) and material_profession_affinity (same hazard class,
  // its header defers enforcement here). One walk guards both.
  // liveImporter is the known consumer outside src/sim that keeps the regex
  // honest as a positive control.
  const GUARDED_MODULES = [
    { name: 'material_taxonomy', liveImporter: '../src/ui/bag_filter.ts' },
    {
      name: 'material_profession_affinity',
      liveImporter: '../src/ui/material_profession_hint_view.ts',
    },
  ] as const;

  // Matches import SPECIFIERS in every realistic form: from clauses (single or
  // multi-line), bare side-effect imports, dynamic import(), export-from
  // re-exports, and an optional .js/.ts suffix. The scan reads raw file text,
  // so a comment QUOTING a full import form would also match; that is accepted
  // over-matching for a fatal-class rule (prose mentions without a quoted
  // specifier, like this sentence or the module headers', do not match).
  const importerReFor = (moduleName: string): RegExp =>
    new RegExp(`(?:from|import)\\s*\\(?\\s*['"][^'"]*${moduleName}(?:\\.[jt]s)?['"]`);

  it('the scan regex has teeth: it matches every importer form and skips prose', () => {
    // Positive control for the sweep below, so a future typo in the regex
    // cannot leave it permanently, invisibly green: it must match the LIVE
    // importer outside src/sim and every forbidden form, and stay quiet on
    // prose mentions.
    for (const { name, liveImporter } of GUARDED_MODULES) {
      const re = importerReFor(name);
      const liveSource = readFileSync(
        fileURLToPath(new URL(liveImporter, import.meta.url)),
        'utf8',
      );
      expect(re.test(liveSource), `${name} live importer ${liveImporter}`).toBe(true);
      const forbidden = [
        `import { something } from '../sim/${name}';`,
        `import { SOME_TABLE } from "./${name}";`,
        `import '../${name}';`,
        `const lazy = await import('./${name}');`,
        `export * from './${name}';`,
        `export { something } from './${name}.js';`,
        `import probe from\n  './${name}.ts';`,
      ];
      for (const form of forbidden) expect(re.test(form), `${name}: ${form}`).toBe(true);
      const prose = [
        `// ${name}.ts is a pure sim leaf`,
        `// see tests/${name}.test.ts for the census pins`,
        `const label = '${name}';`,
      ];
      for (const text of prose) expect(re.test(text), `${name}: ${text}`).toBe(false);
    }
  });

  it('no src/sim file other than each module itself imports it', () => {
    // Both modules derive at module evaluation by reading content tables; a
    // content-side importer would pull that derive inside the tables' own
    // evaluation cycle, where load order decides between a crash and a clean
    // run (each module header states the rule), so only a static scan catches
    // it reliably.
    const simRoot = fileURLToPath(new URL('../src/sim', import.meta.url));
    const guards = GUARDED_MODULES.map(({ name }) => ({
      re: importerReFor(name),
      moduleSelf: join(simRoot, `${name}.ts`),
      offenders: [] as string[],
    }));
    const scanned: string[] = [];
    const symlinked: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        // A symlinked subtree would silently escape isDirectory(); none exists
        // under src/sim today, and this trips if one ever lands so the walk is
        // extended deliberately instead of skipping it.
        if (entry.isSymbolicLink()) symlinked.push(full);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts')) {
          scanned.push(full);
          const source = readFileSync(full, 'utf8');
          for (const guard of guards) {
            if (full === guard.moduleSelf) continue;
            if (guard.re.test(source)) {
              guard.offenders.push(full);
            }
          }
        }
      }
    };
    walk(simRoot);
    // Non-vacuity BOTH ways: the population floor sits ABOVE the flat root
    // count (117 files at the src/sim root, 359 in the whole tree, so a walk
    // that lost recursion cannot clear 300), AND the sweep must have reached
    // the two biggest nested directories by name.
    expect(scanned.length).toBeGreaterThan(300);
    expect(scanned.some((f) => f.includes(`${join(simRoot, 'professions')}/`))).toBe(true);
    expect(scanned.some((f) => f.includes(`${join(simRoot, 'content')}/`))).toBe(true);
    expect(symlinked).toEqual([]);
    for (const guard of guards) {
      expect(scanned, guard.moduleSelf).toContain(guard.moduleSelf);
      expect(guard.offenders, guard.moduleSelf).toEqual([]);
    }
  });
});
