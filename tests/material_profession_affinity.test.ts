// Profession affinity: every honest material maps to the crafts that consume
// it, fine grades inherit base consumers, and presentation order follows the
// craft ring. A pure sim leaf; no DOM.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { CRAFT_RING } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ALL_RECIPES as ALL_RECIPES_VIA_DATA } from '../src/sim/data';
import { craftIdsForMaterialItem } from '../src/sim/material_profession_affinity';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { baseMaterialFor, MATERIAL_GRADES } from '../src/sim/professions/material_grades';

// The ONE sanctioned exception to the no-orphan-reagents census below:
// farming's four items are honest materials whose craft consumers are
// DELIBERATELY deferred, under the packet's same-phase-consumer ruling (D11).
// The growth-engine phase ships a minimal crop slice so the engine can be
// driven end to end; the husks are consumed by the knobs phase's convert
// command, and the produce by the dishes phase, which closes this list. Until
// then the items are still market-listable and vendor-sellable, so no stack is
// truly unexplained, only uncrafted.
//
// Enumerated rather than silenced, the ITEM_ART_PENDING discipline: the two
// arms after the census hold the line from both sides (a stale entry reds once
// its consumer lands, and the set is pinned exactly so it cannot grow quietly
// to absorb a genuinely orphaned material). Do NOT add an id here to make a
// red go away; author its consumer, or argue the classification.
const CONSUMER_DEFERRED_MATERIALS: readonly string[] = [
  'fine_vale_wheat',
  'vale_wheat',
  'vale_wheat_seed',
  'withered_husks',
];

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
    expect(craftIdsForMaterialItem('arcane_dust')).toEqual(['enchanting']);
  });

  it('a fine grade inherits its base consumers and keeps fine-only crafts', () => {
    // fine_iron_ore is a tool-recipe reagent (engineering) and stands in for
    // iron_ore (weaponcrafting + armorcrafting).
    const fine = craftIdsForMaterialItem('fine_iron_ore');
    const base = craftIdsForMaterialItem('iron_ore');
    expect(base).toEqual(['weaponcrafting', 'armorcrafting']);
    expect(fine).toEqual(['engineering', 'weaponcrafting', 'armorcrafting']);
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
    for (const itemId of MATERIAL_ITEM_IDS) {
      if (CONSUMER_DEFERRED_MATERIALS.includes(itemId)) continue;
      expect(
        craftIdsForMaterialItem(itemId).length,
        `${itemId} must have a craft consumer`,
      ).toBeGreaterThan(0);
    }
  });

  // The two arms that keep the exception list above honest, in BOTH
  // directions. Without them an id could be parked here forever, or a
  // genuinely orphaned material could be added to silence a real failure.
  it('every consumer-deferred id is a real material that genuinely has none yet', () => {
    for (const itemId of CONSUMER_DEFERRED_MATERIALS) {
      // Still a material: an id that fell out of the taxonomy has no business
      // holding an exemption from a census it is no longer subject to.
      expect(MATERIAL_ITEM_IDS.has(itemId), `${itemId} is no longer a material`).toBe(true);
      // Still consumerless: the moment its owning phase lands a recipe, this
      // reds and the id must leave the list rather than keep a free pass.
      expect(
        craftIdsForMaterialItem(itemId),
        `${itemId} HAS a consumer now: drop it from CONSUMER_DEFERRED_MATERIALS`,
      ).toEqual([]);
    }
  });

  it('pins the deferred set exactly, so it can never grow quietly', () => {
    // An exact-set pin rather than a size floor: absorbing a future orphan
    // into this list must be a deliberate, reviewed edit naming its phase.
    expect([...CONSUMER_DEFERRED_MATERIALS].sort()).toEqual([
      'fine_vale_wheat',
      'vale_wheat',
      'vale_wheat_seed',
      'withered_husks',
    ]);
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
