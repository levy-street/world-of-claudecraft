// Profession affinity: every honest material maps to the crafts that consume
// it, fine grades inherit base consumers, and presentation order follows the
// craft ring. A pure sim leaf; no DOM.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { FARM_CROPS, FARM_MATERIAL_ITEM_IDS } from '../src/sim/content/farm_crops';
import { CRAFT_RING } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ALL_RECIPES as ALL_RECIPES_VIA_DATA } from '../src/sim/data';
import { craftIdsForMaterialItem } from '../src/sim/material_profession_affinity';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { baseMaterialFor, MATERIAL_GRADES } from '../src/sim/professions/material_grades';

// The ONE sanctioned exception to the no-orphan-reagents census below:
// farming's materials, exempt STRUCTURALLY rather than by an enumerated
// deferral list, because every one of them is consumed by a sim COMMAND,
// which craftIdsForMaterialItem (a recipes-and-enchants scan) cannot see.
// Seeds are spent by plant_crop; produce and its fine twin pay the farmer's
// watch fee (the plant_crop knob payload); husks feed convert_husks; and the
// two supplies (compost, growth tonic) are the plant-time knobs themselves.
// That holds by construction for every crop the ladder phase will add (its
// seed plants, its produce is fee-eligible), and the consumption carries
// EXECUTED coverage in tests/professions_farming.test.ts rather than resting
// on this comment.
//
// HISTORY, so the shape is not relearned: through the growth-engine phase
// this was an enumerated CONSUMER_DEFERRED_MATERIALS list whose self-clearing
// arm demanded an entry leave when its recipe consumer landed. The knobs
// phase REPLACED it (state.md deviation (w)): the consumers that actually
// closed the loop are commands, which that arm could never see, and compost
// and the tonic will never have a recipe consumer at all, so keeping them
// "deferred" would have been a permanent lie. The anti-abuse gate the old
// exact pin provided did not go away, it moved to the content layer: this
// exemption derives from FARM_MATERIAL_ITEM_IDS, so smuggling an orphan in
// requires editing content/farm_crops.ts, and the exact-set pin on that list
// in tests/material_taxonomy.test.ts reds on any growth. A recipe consumer
// arriving later (the dishes phase cooks produce) needs no edit here: the id
// starts passing the census on its own terms and the exemption stays true
// (the watch fee still consumes produce).
const COMMAND_CONSUMED_FARM_MATERIALS: ReadonlySet<string> = new Set(FARM_MATERIAL_ITEM_IDS);

describe('craftIdsForMaterialItem', () => {
  it('names the crafts that consume Rough Hide (the player-facing exemplar)', () => {
    // Leatherworking is the home craft; armorcrafting and weaponcrafting also
    // list hide on shipped recipes. Order is CRAFT_RING, not first-seen.
    // CRAFT_RING order: leatherworking sits before weaponcrafting/armorcrafting.
    expect(craftIdsForMaterialItem('rough_hide')).toEqual([
      'leatherworking',
      'weaponcrafting',
      'armorcrafting',
    ]);
  });

  it('maps single-craft reagents to one craft', () => {
    expect(craftIdsForMaterialItem('game_meat')).toEqual(['cooking']);
    expect(craftIdsForMaterialItem('venom_gland')).toEqual(['alchemy']);
    // The dust left this class with the Masterwrought phase 05 jewelcrafting
    // catalog (rung-0 recipes consume it beside enchanting), and inscription
    // joined at phase 06 (INSCRIPTION_RECIPES). Ring order puts inscription
    // first, before enchanting. arcane_shard stays single-craft.
    expect(craftIdsForMaterialItem('arcane_dust')).toEqual([
      'inscription',
      'enchanting',
      'jewelcrafting',
    ]);
    expect(craftIdsForMaterialItem('arcane_shard')).toEqual(['enchanting']);
  });

  it('the nine junk trophies map to their one adopted craft (Masterwrought phase 11l)', () => {
    // The trophy economy gave each of these mob drops exactly ONE consuming
    // craft, so each pin doubles as a no-second-consumer tripwire: a later
    // recipe borrowing a trophy into another craft changes the tooltip and
    // must change the literal here deliberately. The chipped tusk is pinned
    // EMPTY: the sixth fix round output-excluded it, so no craft consumes it.
    expect(craftIdsForMaterialItem('bandit_bandana')).toEqual(['tailoring']);
    expect(craftIdsForMaterialItem('bogiron_nugget')).toEqual(['armorcrafting']);
    expect(craftIdsForMaterialItem('cracked_fetish')).toEqual(['inscription']);
    expect(craftIdsForMaterialItem('cracked_ogre_tusk')).toEqual(['weaponcrafting']);
    expect(craftIdsForMaterialItem('cracked_wyrm_scale')).toEqual(['leatherworking']);
    expect(craftIdsForMaterialItem('mudfin_scale')).toEqual(['leatherworking']);
    expect(craftIdsForMaterialItem('tallow_candle')).toEqual(['alchemy']);
    // The two already-common rare-elite leather trophies the phase's second
    // review round adopted (recipe_cragprowl_belt, recipe_wildgrove_cinch).
    expect(craftIdsForMaterialItem('emberwing_cinderscale')).toEqual(['leatherworking']);
    expect(craftIdsForMaterialItem('old_cragmaws_pelt')).toEqual(['leatherworking']);
    // Poor trash again: craftIdsForMaterialItem derives purely from recipe
    // and enchant reagents, and neither a recipe nor an enchant consumes the
    // tusk, so no craft.
    expect(craftIdsForMaterialItem('chipped_tusk')).toEqual([]);
  });

  it('five crops name ALCHEMY as a consumer (Masterwrought phases 11g and 11h)', () => {
    // THE PLAYER-VISIBLE HALF OF THE PROVISIONING SUPPLY LINE, pinned here
    // because nothing else in the tree can see it. Farm materials are
    // structurally EXEMPT from the orphan census above
    // (COMMAND_CONSUMED_FARM_MATERIALS), so this whole suite stayed green and
    // unmodified while three crops changed what their tooltip says.
    //
    // Before phase 11g every produce id was cooking-only: farming's own dishes
    // were the sole consumers and NO alchemy recipe consumed farm output at all
    // (pinned at zero in tests/farm_seed_channels.test.ts until that phase gave
    // it a floor). The elixir line changed it, so materialProfessionHintText
    // now renders "Used by Alchemy and Cooking." on these three item tooltips
    // where it used to read "Used by Cooking.".
    //
    // PHASE 11h ADDED TWO MORE, and they arrive from the APEX tier rather than
    // the elixir ladder: highland_barley is the grain in all three apex flasks
    // (11h-GATE-C) and gilded_sunmelon is the alchemy capstone's showcase crop
    // in recipe_grand_cauldron (11h-GATE-D). Both tooltips move from
    // "Used by Cooking." to "Used by Alchemy and Cooking." the same way the
    // three below did.
    //
    // Order is CRAFT_RING, not first-seen, which is why alchemy leads.
    expect(craftIdsForMaterialItem('vale_wheat')).toEqual(['alchemy', 'cooking']);
    expect(craftIdsForMaterialItem('bog_beet')).toEqual(['alchemy', 'cooking']);
    expect(craftIdsForMaterialItem('frost_gourd')).toEqual(['alchemy', 'cooking']);
    expect(craftIdsForMaterialItem('highland_barley')).toEqual(['alchemy', 'cooking']);
    expect(craftIdsForMaterialItem('gilded_sunmelon')).toEqual(['alchemy', 'cooking']);
    // The negative half, and it is what makes the five above a real claim
    // rather than a restatement of "produce is a reagent": the crops neither
    // phase took stay cooking-only. Without these a change that handed alchemy
    // every crop would pass the arm above unchanged.
    expect(craftIdsForMaterialItem('brook_carrot')).toEqual(['cooking']);
    expect(craftIdsForMaterialItem('marsh_rice')).toEqual(['cooking']);
    expect(craftIdsForMaterialItem('thornpeak_cabbage')).toEqual(['cooking']);
    expect(craftIdsForMaterialItem('evergarden_greens')).toEqual(['cooking']);
    // SWEPT, NOT LISTED (qr-11G-AFFINITY, Phase 11g QA). The ids above are a
    // subset of the crops that must stay cooking-only, so a change handing
    // alchemy one of the rest passed this arm. The sweep closes it over
    // whatever roster ships and needs no edit when Phase 11e's twelve becomes
    // thirteen.
    const GAINED_ALCHEMY = new Set([
      'vale_wheat',
      'bog_beet',
      'frost_gourd',
      'highland_barley',
      'gilded_sunmelon',
    ]);
    const alchemyCrops = Object.values(FARM_CROPS)
      .map((crop) => crop.produceItemId)
      .filter((id) => craftIdsForMaterialItem(id).includes('alchemy'));
    expect(alchemyCrops.sort(), 'exactly these base crops feed alchemy').toEqual(
      [...GAINED_ALCHEMY].sort(),
    );
    // THE FINE TWINS ARE SWEPT TOO (masterwrought Phase 11h), and the gap was
    // real rather than theoretical: the sweep above maps produceItemId only, so
    // until this phase nothing anywhere could see a fine twin gaining a craft.
    // 11h is the first phase to put one in an alchemy bill
    // (fine_gilded_sunmelon in recipe_grand_cauldron), which is exactly when
    // the blind spot would have shipped unnoticed. Same shape, its own literal,
    // so the base and twin sets cannot drift into each other.
    const TWINS_NAMING_ALCHEMY = new Set(['fine_gilded_sunmelon']);
    const alchemyTwins = Object.values(FARM_CROPS)
      .map((crop) => crop.fineProduceItemId)
      .filter((id) => craftIdsForMaterialItem(id).includes('alchemy'));
    expect(alchemyTwins.sort(), 'exactly these fine twins feed alchemy').toEqual(
      [...TWINS_NAMING_ALCHEMY].sort(),
    );
    // Vacuity floor: the sweep must run over the whole roster, so a catalog
    // rename that emptied it cannot make the toEqual above pass over nothing.
    expect(Object.keys(FARM_CROPS).length, 'the crop roster').toBeGreaterThanOrEqual(12);
    // And both sweeps must actually SEE a consumer set, or a resolver returning
    // [] for everything would satisfy both literals by emptying them. Measured
    // over the same rosters the two sweeps walk.
    expect(
      Object.values(FARM_CROPS).filter(
        (crop) => craftIdsForMaterialItem(crop.produceItemId).length > 0,
      ).length,
      'every base crop must resolve at least one consuming craft',
    ).toBe(Object.keys(FARM_CROPS).length);
    // AND THE SAME FLOOR OVER THE TWIN ROSTER, because the sweep above walks
    // produceItemId only and the twin sweep has its own roster. Without this a
    // resolver returning [] for every fine twin but one would satisfy the twin
    // literal by emptying the negative half rather than by being right about it.
    expect(
      Object.values(FARM_CROPS).filter(
        (crop) => craftIdsForMaterialItem(crop.fineProduceItemId).length > 0,
      ).length,
      'every fine twin must resolve at least one consuming craft',
    ).toBe(Object.keys(FARM_CROPS).length);
  });

  it('herbs and the vial gained inscription as a consumer (Masterwrought phase 06)', () => {
    // The inscription catalog (INSCRIPTION_RECIPES) consumes the whole herb
    // ladder, the glass_vial staple, and the dust/essence ink lines. On the
    // ink lines ring order puts inscription FIRST (the arcane_dust pin above
    // and the essence pin below hold that head position); on the herbs it
    // lands LAST, and the ring sort is what the herb pins discriminate, since
    // first-seen recipe order would read tailoring or cooking before alchemy.
    // The vial arm pins membership only; both orders agree there.
    for (const herb of ['silverleaf_herb', 'goldleaf_herb', 'sunpetal_herb']) {
      expect(craftIdsForMaterialItem(herb), herb).toEqual([
        'alchemy',
        'cooking',
        'tailoring',
        'inscription',
      ]);
    }
    expect(craftIdsForMaterialItem('arcane_essence')).toEqual([
      'inscription',
      'enchanting',
      'jewelcrafting',
    ]);
    expect(craftIdsForMaterialItem('glass_vial')).toEqual(['alchemy', 'inscription']);
  });

  it('the Quickening Catalyst names all ten consuming crafts (phase 07, then alchemy at phase 10)', () => {
    // The nine INTERMEDIATE_RECIPES consumers (recipe_duskforged_billet,
    // recipe_forgefold_plating, recipe_wyrmhide_cording, recipe_sunspun_bolt,
    // recipe_prismglass_setting, recipe_precision_chassis,
    // recipe_seasoned_stock, recipe_lucent_reagent, recipe_sablewax_vellum),
    // plus ALCHEMY since phase 10: alchemy's own 75 rung still MINTS the
    // catalyst, but its apex rows (the three flasks and the Grand Cauldron in
    // APEX_CONSUMABLE_RECIPES) now consume it too, so the craft that mints it
    // is also on its consumer ring and the list covers every craft. Ring
    // order, never first-seen recipe order (first-seen would read
    // weaponcrafting first, the authored row order in recipes.ts).
    expect(craftIdsForMaterialItem('quickening_catalyst')).toEqual([
      'engineering',
      'alchemy',
      'cooking',
      'leatherworking',
      'tailoring',
      'inscription',
      'enchanting',
      'jewelcrafting',
      'weaponcrafting',
      'armorcrafting',
    ]);
  });

  it('a fine grade inherits its base consumers and keeps fine-only crafts', () => {
    // fine_iron_ore is a tool-recipe reagent (engineering) and stands in for
    // iron_ore (jewelcrafting + weaponcrafting + armorcrafting since the
    // Masterwrought phase 05 catalog's rung-25 recipes).
    const fine = craftIdsForMaterialItem('fine_iron_ore');
    const base = craftIdsForMaterialItem('iron_ore');
    expect(base).toEqual(['jewelcrafting', 'weaponcrafting', 'armorcrafting']);
    expect(fine).toEqual(['engineering', 'jewelcrafting', 'weaponcrafting', 'armorcrafting']);
    for (const craftId of base) {
      expect(fine, `fine inherits ${craftId}`).toContain(craftId);
    }
  });

  it('every fine grade resolves through baseMaterialFor without inventing crafts', () => {
    for (const [baseItemId, row] of Object.entries(MATERIAL_GRADES)) {
      expect(baseMaterialFor(row.fineItemId)).toBe(baseItemId);
      const fineCrafts = craftIdsForMaterialItem(row.fineItemId);
      const baseCrafts = craftIdsForMaterialItem(baseItemId);
      for (const craftId of baseCrafts) {
        expect(fineCrafts, `${row.fineItemId} inherits ${craftId}`).toContain(craftId);
      }
    }
  });

  it('orders multi-craft lines by CRAFT_RING, never first-seen recipe order', () => {
    const ring = CRAFT_RING.map((c) => c.id);
    for (const itemId of MATERIAL_ITEM_IDS) {
      const crafts = craftIdsForMaterialItem(itemId);
      const positions = crafts.map((id) => ring.indexOf(id));
      expect(
        positions.every((p) => p >= 0),
        `${itemId} only names ring crafts`,
      ).toBe(true);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i], `${itemId} ring order`).toBeGreaterThan(positions[i - 1]);
      }
    }
  });

  it('every honest material has at least one craft consumer (no orphan reagents)', () => {
    // The material taxonomy only admits junk-kind members of the source-or-
    // reagent union; if a material has zero craft consumers the Used-by line
    // cannot fire and the bag stack is unexplained. Pin completeness here.
    // Farming's family is command-consumed (see the exemption banner above),
    // so its stacks are explained by a different mechanism, not unexplained.
    let exempted = 0;
    for (const itemId of MATERIAL_ITEM_IDS) {
      if (COMMAND_CONSUMED_FARM_MATERIALS.has(itemId)) {
        exempted++;
        continue;
      }
      expect(
        craftIdsForMaterialItem(itemId).length,
        `${itemId} must have a craft consumer`,
      ).toBeGreaterThan(0);
    }
    // Anti-vacuous in both directions: the exemption really fired (farming's
    // family is in the material set), and it did not swallow the census (the
    // non-exempt majority was genuinely walked).
    expect(exempted).toBe(COMMAND_CONSUMED_FARM_MATERIALS.size);
    expect(MATERIAL_ITEM_IDS.size - exempted).toBeGreaterThan(40);
  });

  it('the farming exemption names only real materials, all from the one content source', () => {
    // The honesty arm the old deferral list carried, kept in the direction
    // that still applies: an id that fell out of the taxonomy has no business
    // holding an exemption from a census it is no longer subject to. The
    // growth gate lives with the SOURCE: this set derives from
    // FARM_MATERIAL_ITEM_IDS, whose exact-set pin in
    // tests/material_taxonomy.test.ts reds on any addition, so an orphan
    // cannot be smuggled in through this file at all.
    expect(COMMAND_CONSUMED_FARM_MATERIALS.size).toBeGreaterThan(0);
    for (const itemId of COMMAND_CONSUMED_FARM_MATERIALS) {
      expect(MATERIAL_ITEM_IDS.has(itemId), `${itemId} is no longer a material`).toBe(true);
    }
  });

  it('every recipe professionId is a craft the affinity can name', () => {
    const ring = new Set(CRAFT_RING.map((c) => c.id));
    for (const recipe of ALL_RECIPES) {
      expect(ring.has(recipe.professionId), recipe.professionId).toBe(true);
    }
  });

  it('non-materials and unknown ids return empty', () => {
    expect(craftIdsForMaterialItem('rusty_sword')).toEqual([]);
    expect(craftIdsForMaterialItem('not_a_real_item')).toEqual([]);
    expect(craftIdsForMaterialItem('simple_fishing_pole')).toEqual([]);
  });

  it('data.ts ALL_RECIPES stays a verbatim copy of the content export', () => {
    // The module (and the oracle below) read content/recipes directly, so a
    // future data.ts that merges an extra recipe family would diverge from
    // both invisibly: the tooltip would under-report and the oracle would
    // agree with it. Pin the two exports element-for-element so that
    // divergence fails here first.
    expect(ALL_RECIPES_VIA_DATA).toEqual(ALL_RECIPES);
  });

  it('matches an independently re-derived consumer set for every material', () => {
    // Double-entry oracle: rebuild the expected set here from the same content
    // tables (recipes, enchants, downward grade substitution) and require
    // exact-set equality per material. The property arms above cannot catch a
    // partial silent drop (an item consumed by three crafts returning two,
    // still ring-ordered) or the ring filter quietly losing an off-ring
    // consumer; this arm fails loudly on both.
    const direct = new Map<string, Set<string>>();
    const add = (itemId: string, craftId: string): void => {
      let set = direct.get(itemId);
      if (!set) {
        set = new Set();
        direct.set(itemId, set);
      }
      set.add(craftId);
    };
    for (const recipe of ALL_RECIPES) {
      for (const reagent of recipe.reagents) add(reagent.itemId, recipe.professionId);
    }
    for (const enchant of Object.values(ENCHANTS)) {
      for (const reagent of enchant.reagents) add(reagent.itemId, 'enchanting');
    }
    for (const itemId of MATERIAL_ITEM_IDS) {
      const expected = new Set(direct.get(itemId) ?? []);
      const baseItemId = baseMaterialFor(itemId);
      if (baseItemId !== undefined) {
        for (const craftId of direct.get(baseItemId) ?? []) expected.add(craftId);
      }
      expect(new Set(craftIdsForMaterialItem(itemId)), itemId).toEqual(expected);
    }
  });

  it('no enchant reagent is a graded base material (substitution asymmetry tripwire)', () => {
    // The craft path consumes through downward grade substitution
    // (planGradeRemoval), but the enchant path removes by exact item id with
    // no substitution. The fine-grade inheritance in craftIdsForMaterialItem
    // is therefore only honest while no enchant lists a graded BASE material:
    // the day one does, the fine grade would claim "Used by Enchanting" while
    // applyEnchant refuses it. Trip here so that day is a deliberate call.
    for (const enchant of Object.values(ENCHANTS)) {
      for (const reagent of enchant.reagents) {
        expect(
          MATERIAL_GRADES[reagent.itemId],
          `${reagent.itemId} is a graded base consumed by an enchant`,
        ).toBeUndefined();
      }
    }
  });
});
