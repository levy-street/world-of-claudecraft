import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GATHER_NODE_TYPES, GATHER_NODES } from '../src/sim/content/gather_nodes';
import { ALL_RECIPES, TOOL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, QUESTS } from '../src/sim/data';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import {
  baseMaterialFor,
  countAcrossGrades,
  fineGradeReachable,
  fineMaterialFor,
  gatherMaterialTier,
  harvestGradeItemId,
  MATERIAL_GRADES,
  materialGradeIds,
  planGradeRemoval,
  yieldsFineGrade,
} from '../src/sim/professions/material_grades';
import { isGatherToolUse } from '../src/sim/professions/tools';

// The fine-material axis (D8): a harvest whose tool outclasses the material
// grants a fine grade of it instead of the plain one, and the crafted tool
// recipes consume that grade, so the tool one rung down is the CRAFT route
// up (the delve counters' Marks route is the deliberate alternative).
// This file owns the pure module; the live harvest path is pinned in
// tests/gather_node_harvest.test.ts and the consumption substitution in
// tests/material_grade_substitution.test.ts.

const ZONES = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;

const highestTierIn = (zoneId: string, type: string) =>
  Math.max(
    ...GATHER_NODES.filter((n) => n.zoneId === zoneId && n.type === type).map((n) => n.tier),
  );

describe('MATERIAL_GRADES table', () => {
  it('fineGradeReachable pins the node-at-or-above-rung boundary directly', () => {
    // Load-bearing for the use-time charge gate (gathering.ts): reachable
    // exactly when the node matches the material's own rung, and never for
    // an ungraded id.
    expect(fineGradeReachable('thorium_ore', 3)).toBe(true);
    expect(fineGradeReachable('thorium_ore', 2)).toBe(false);
    expect(fineGradeReachable('copper_ore', 1)).toBe(true);
    expect(fineGradeReachable('not_a_material', 9)).toBe(false);
  });

  it('covers exactly the nine node yields, one grade pair each', () => {
    const liveYields = new Set<string>();
    for (const byZone of Object.values(NODE_MATERIAL_TABLE)) {
      for (const row of Object.values(byZone)) liveYields.add(row.itemId);
    }
    // Derived from the live table, not a second literal: a tenth node yield
    // would fail here rather than silently ship with no fine grade.
    expect(Object.keys(MATERIAL_GRADES).sort()).toEqual([...liveYields].sort());
    expect(Object.keys(MATERIAL_GRADES)).toHaveLength(9);
  });

  it('every fine id is a real, distinct, common-quality ItemDef', () => {
    const fineIds = Object.values(MATERIAL_GRADES).map((row) => row.fineItemId);
    expect(new Set(fineIds).size, 'two materials must never share a fine grade').toBe(9);
    for (const [baseItemId, row] of Object.entries(MATERIAL_GRADES)) {
      const def = ITEMS[row.fineItemId];
      expect(def, `${row.fineItemId} must be a shipped item`).toBeDefined();
      expect(def.id).toBe(row.fineItemId);
      expect(def.kind).toBe('junk');
      // Never 'poor', or sellAllJunk would vendor a crafting reagent.
      expect(def.quality, `${row.fineItemId} quality`).toBe('common');
      // The grade is worth more than what it replaces, or the axis pays nothing.
      expect(def.sellValue, `${row.fineItemId} sellValue`).toBeGreaterThan(
        ITEMS[baseItemId].sellValue,
      );
      // buyValue is the economy basis reagentUnitValue reads
      // (tests/recipe_economy.test.ts), on the delisted-material 4x convention.
      expect(def.buyValue, `${row.fineItemId} buyValue`).toBe(def.sellValue * 4);
    }
  });

  it('no counter ANYWHERE stocks a fine grade (the ruling is about the stock row, not the price)', async () => {
    const { NPCS } = await import('../src/sim/data');
    const { HEROIC_VENDOR_STOCK } = await import('../src/sim/content/heroic_vendor');
    const { DELVE_SHOPS } = await import('../src/sim/content/delves/shop');
    // All THREE stock tables, not just NPCS: the heroic quartermaster keeps
    // its real stock in HEROIC_VENDOR_STOCK (its vendorItems is undefined)
    // and the delve counters keep theirs in DELVE_SHOPS, so an NPCS-only read
    // was blind to both. Every fine grade carries a live 4x buyValue, so a
    // single stock row on any table sells it, whatever the currency.
    const stocked = new Set<string>();
    for (const npc of Object.values(NPCS)) for (const id of npc.vendorItems ?? []) stocked.add(id);
    for (const offer of HEROIC_VENDOR_STOCK) stocked.add(offer.itemId);
    for (const entries of Object.values(DELVE_SHOPS)) {
      for (const entry of entries) stocked.add(entry.itemId);
    }
    // Per-table FOLD teeth, not just length: each table is non-empty AND the
    // union provably contains a member of it, so a renamed field or a broken
    // loop fails here instead of leaving the sweep vacuous for that table
    // (the arcanite_bar line below is the NPCS fold tooth).
    expect(Object.values(NPCS).flatMap((n) => n.vendorItems ?? []).length).toBeGreaterThan(0);
    expect(HEROIC_VENDOR_STOCK.length).toBeGreaterThan(0);
    expect(Object.values(DELVE_SHOPS).flat().length).toBeGreaterThan(0);
    // Literal ids, not table[0] reads: a renamed itemId field would poison
    // the set with undefined and a table[0] tooth would then assert
    // has(undefined) against itself. Each literal is a stable shipped row.
    expect(stocked.has('seal_of_the_nine_oaths'), 'heroic fold tooth').toBe(true);
    expect(stocked.has('reliquary_legs'), 'delve fold tooth').toBe(true);
    expect(stocked.has('arcanite_bar'), 'the refined reagent IS stocked (NPCS fold tooth)').toBe(
      true,
    );
    for (const row of Object.values(MATERIAL_GRADES)) {
      expect(stocked.has(row.fineItemId), `${row.fineItemId} must not be on any counter`).toBe(
        false,
      );
    }
  });

  it('gatherTier IS the highest node tier its zone carries (content cannot drift off the gate)', () => {
    // The whole point of keying the gate on the MATERIAL rather than the node.
    // Derived from GATHER_NODES, so re-tiering a vein without revisiting the
    // grade table fails here instead of quietly moving who can farm a grade.
    // Scoped to the tuned zones: the v0.32.0 expansion zones re-grant rung 2
    // and 3 materials from tier-1 starter nodes on purpose, and THEIR truth
    // is the inverse relation the starter-zone arm below pins.
    let checked = 0;
    for (const type of GATHER_NODE_TYPES) {
      for (const zoneId of ZONES) {
        const itemId = NODE_MATERIAL_TABLE[type][zoneId].itemId;
        expect(gatherMaterialTier(itemId), `${type}/${zoneId}`).toBe(highestTierIn(zoneId, type));
        checked += 1;
      }
    }
    expect(checked).toBe(9);
    // And the ladder really is a ladder: the three zones sit at three tiers,
    // so the loop above is not nine copies of one number.
    expect(gatherMaterialTier('copper_ore')).toBe(1);
    expect(gatherMaterialTier('iron_ore')).toBe(2);
    expect(gatherMaterialTier('thorium_ore')).toBe(3);
  });

  it('every starter-zone row sits BELOW its material rung, so no fine grade leaks there', () => {
    // The v0.32.0 expansion zones grant rung 2 and 3 materials from tier-1
    // hub-outskirt nodes. That is safe exactly as long as every such zone's
    // highest node tier stays UNDER the granted material's gatherTier, since
    // yieldsFineGrade demands nodeTier >= gatherTier: the moment an expansion
    // zone gains a node at or above its material rung without a deliberate
    // grade-table decision, fine thorium becomes farmable outside the tuned
    // ladder and this arm reds first. Swept over every zone with a material
    // row that is NOT one of the tuned three, derived, with non-vacuity.
    let checkedStarter = 0;
    for (const type of GATHER_NODE_TYPES) {
      for (const [zoneId, row] of Object.entries(NODE_MATERIAL_TABLE[type])) {
        if ((ZONES as readonly string[]).includes(zoneId)) continue;
        const highest = highestTierIn(zoneId, type);
        // Non-vacuity per arm: Math.max over an empty node list is
        // -Infinity, which would pass the below-rung check AND count toward
        // the 33, hiding a zone that shipped its material row before any
        // node of the type.
        expect(Number.isFinite(highest), `${type}/${zoneId} has no nodes`).toBe(true);
        const rung = gatherMaterialTier(row.itemId);
        expect(rung, `${type}/${zoneId} grants ungraded ${row.itemId}`).toBeDefined();
        if (rung === undefined) continue;
        expect(
          highest,
          `${type}/${zoneId} node tier ${highest} reaches material rung ${rung}`,
        ).toBeLessThan(rung);
        checkedStarter += 1;
      }
    }
    expect(checkedStarter).toBe(33);
  });

  it('resolves both directions, and refuses ids that have no grade', () => {
    expect(fineMaterialFor('thorium_ore')).toBe('fine_thorium_ore');
    expect(baseMaterialFor('fine_thorium_ore')).toBe('thorium_ore');
    for (const [baseItemId, row] of Object.entries(MATERIAL_GRADES)) {
      expect(baseMaterialFor(row.fineItemId)).toBe(baseItemId);
    }
    // Grades do not stack, and non-materials have none.
    expect(fineMaterialFor('fine_thorium_ore')).toBeUndefined();
    expect(baseMaterialFor('thorium_ore')).toBeUndefined();
    expect(fineMaterialFor('arcanite_bar')).toBeUndefined();
    expect(fineMaterialFor('mithril_mining_pick')).toBeUndefined();
    expect(gatherMaterialTier('no_such_item')).toBeUndefined();
  });
});

describe('yieldsFineGrade: both arms carry weight', () => {
  it('the tool must be STRICTLY above the material, not merely able to work it', () => {
    // gatherTier 2 (mirefen), a full-grade tier-2 vein.
    expect(yieldsFineGrade(2, 2, 1)).toBe(false); // below: cannot even gather it
    expect(yieldsFineGrade(2, 2, 2)).toBe(false); // exactly at: unlocks, never upgrades
    expect(yieldsFineGrade(2, 2, 3)).toBe(true); // above: the upgrade
    expect(yieldsFineGrade(2, 2, 5)).toBe(true);
  });

  it('the vein must carry the material grade, so lower-tier veins keep yielding plain', () => {
    // A tier-3 pick in mirefen: fine at the tier-2 veins, plain at the tier-1
    // ones the zone deliberately keeps for travelling starter tools. This arm
    // is what keeps the base material gatherable by its own owner.
    expect(yieldsFineGrade(2, 1, 3)).toBe(false);
    expect(yieldsFineGrade(2, 2, 3)).toBe(true);
    // Thornpeak with a tier-4 pick: plain at tier 1 and 2, fine only at tier 3.
    expect(yieldsFineGrade(3, 1, 4)).toBe(false);
    expect(yieldsFineGrade(3, 2, 4)).toBe(false);
    expect(yieldsFineGrade(3, 3, 4)).toBe(true);
  });

  it('eastbrook is the one zone with no plain fallback, and that is why substitution exists', () => {
    // Every eastbrook node is tier 1 and the material is tier 1, so any tier-2
    // tool turns the WHOLE zone fine. Pinned as the premise the downward
    // substitution rests on: if a future content edit gave eastbrook a
    // sub-material-tier vein, this expectation is where that shows up.
    const eastbrookOreTiers = GATHER_NODES.filter(
      (n) => n.zoneId === 'eastbrook_vale' && n.type === 'ore',
    ).map((n) => n.tier);
    expect(eastbrookOreTiers.length).toBeGreaterThan(0);
    expect([...new Set(eastbrookOreTiers)]).toEqual([1]);
    for (const tier of eastbrookOreTiers) expect(yieldsFineGrade(1, tier, 2)).toBe(true);
  });
});

describe('harvestGradeItemId', () => {
  it('swaps the id only when both arms pass, and never invents one', () => {
    expect(harvestGradeItemId('copper_ore', 1, 1)).toBe('copper_ore');
    expect(harvestGradeItemId('copper_ore', 1, 2)).toBe('fine_copper_ore');
    expect(harvestGradeItemId('thorium_ore', 1, 4)).toBe('thorium_ore');
    expect(harvestGradeItemId('thorium_ore', 3, 4)).toBe('fine_thorium_ore');
    // No tool at all (NO_TOOL_OWNED is 0) never upgrades anything.
    expect(harvestGradeItemId('copper_ore', 1, 0)).toBe('copper_ore');
    // An id with no grade degrades to itself rather than throwing, so a future
    // zone whose material row lands before its grade row still harvests.
    expect(harvestGradeItemId('arcanite_bar', 3, 5)).toBe('arcanite_bar');
    expect(harvestGradeItemId('no_such_item', 3, 5)).toBe('no_such_item');
  });
});

describe('downward substitution', () => {
  it('a fine grade satisfies its base, and the base never satisfies the fine', () => {
    expect(materialGradeIds('copper_ore')).toEqual(['copper_ore', 'fine_copper_ore']);
    // The one-directional half: this is what makes the fine grade a real gate
    // on the tool recipes rather than a cosmetic relabel.
    expect(materialGradeIds('fine_copper_ore')).toEqual(['fine_copper_ore']);
    expect(materialGradeIds('smithing_flux')).toEqual(['smithing_flux']);
  });

  it('counts across grades, and the count never promises what the plan cannot take', () => {
    const bags: Record<string, number> = { copper_ore: 3, fine_copper_ore: 4 };
    const have = (id: string) => bags[id] ?? 0;
    expect(countAcrossGrades('copper_ore', have)).toBe(7);
    // Asked for the fine grade specifically, only the fine grade counts.
    expect(countAcrossGrades('fine_copper_ore', have)).toBe(4);
    // The read and the plan agree at, below and above the holding.
    for (const want of [1, 3, 4, 7]) {
      const planned = planGradeRemoval('copper_ore', want, have).reduce((n, t) => n + t.count, 0);
      expect(planned, `want ${want}`).toBe(Math.min(want, countAcrossGrades('copper_ore', have)));
    }
  });

  it('spends the base grade first so the premium copies survive', () => {
    const have = (id: string) => (id === 'copper_ore' ? 3 : id === 'fine_copper_ore' ? 4 : 0);
    expect(planGradeRemoval('copper_ore', 2, have)).toEqual([{ itemId: 'copper_ore', count: 2 }]);
    expect(planGradeRemoval('copper_ore', 3, have)).toEqual([{ itemId: 'copper_ore', count: 3 }]);
    // Spills into the fine grade only once the base is exhausted.
    expect(planGradeRemoval('copper_ore', 5, have)).toEqual([
      { itemId: 'copper_ore', count: 3 },
      { itemId: 'fine_copper_ore', count: 2 },
    ]);
  });

  it('emits no zero-count lines, and short holdings plan what is there', () => {
    const fineOnly = (id: string) => (id === 'fine_copper_ore' ? 2 : 0);
    // The base line is skipped entirely rather than emitted as count 0, so a
    // caller applying the plan never calls removeItem for a slot it lacks.
    expect(planGradeRemoval('copper_ore', 2, fineOnly)).toEqual([
      { itemId: 'fine_copper_ore', count: 2 },
    ]);
    expect(planGradeRemoval('copper_ore', 5, fineOnly)).toEqual([
      { itemId: 'fine_copper_ore', count: 2 },
    ]);
    expect(planGradeRemoval('copper_ore', 0, fineOnly)).toEqual([]);
    expect(planGradeRemoval('copper_ore', 3, () => 0)).toEqual([]);
    // A negative available (a caller bug) yields no line. Note this arm passes
    // with or without the Math.max clamp in planGradeRemoval, because the
    // `take <= 0` guard already covers it: the clamp there is a defensive
    // default, not a behavior this can pin. The clamp in countAcrossGrades IS
    // behavioral, and is pinned right below.
    expect(planGradeRemoval('copper_ore', 3, () => -5)).toEqual([]);
    // Removing that clamp returns -10 here instead of 0.
    expect(countAcrossGrades('copper_ore', () => -5)).toBe(0);
  });
});

describe('the tool ladder the grades exist to build', () => {
  it('every crafted tool recipe consumes a fine grade and the tool one rung down', () => {
    expect(TOOL_RECIPES).toHaveLength(6);
    for (const recipe of TOOL_RECIPES) {
      const reagentIds = recipe.reagents.map((r) => r.itemId);
      const fineReagents = reagentIds.filter((id) => baseMaterialFor(id) !== undefined);
      expect(fineReagents.length, `${recipe.id} must consume a fine grade`).toBeGreaterThan(0);
      // And a plain node material never sneaks back in beside it.
      const plainReagents = reagentIds.filter((id) => fineMaterialFor(id) !== undefined);
      expect(plainReagents, `${recipe.id} still consumes a plain node yield`).toEqual([]);
      // The rung below: every tool recipe consumes a gathering tool.
      const toolReagents = reagentIds.filter((id) => isGatherToolUse(ITEMS[id]?.use));
      expect(toolReagents, `${recipe.id} must consume the tool one rung down`).toHaveLength(1);
    }
  });

  it('no tool recipe is a closed circuit: its fine reagent needs a LOWER tier tool', () => {
    // The fork the pick line forced. A recipe whose fine reagent needs a tool
    // at or above the recipe's own output is unreachable from a cold start.
    let gradedReagentsChecked = 0;
    for (const recipe of TOOL_RECIPES) {
      const outputUse = ITEMS[recipe.resultItemId].use;
      const outputTier = isGatherToolUse(outputUse) ? outputUse.tier : undefined;
      expect(outputTier, `${recipe.id} output tier`).toBeDefined();
      for (const reagent of recipe.reagents) {
        const baseItemId = baseMaterialFor(reagent.itemId);
        if (baseItemId === undefined) continue;
        gradedReagentsChecked += 1;
        // Gathering the fine grade needs a tool strictly above its material.
        const toolNeeded = (gatherMaterialTier(baseItemId) as number) + 1;
        expect(
          toolNeeded,
          `${recipe.id} needs a tier-${toolNeeded} tool to gather ${reagent.itemId}, ` +
            `but only produces tier ${outputTier}`,
        ).toBeLessThan(outputTier as number);
      }
    }
    // Self-standing non-vacuity: the loop skips non-graded reagents, so without
    // this it would pass on a TOOL_RECIPES that had dropped its fine reagents
    // entirely rather than on one whose circuits are open.
    expect(gradedReagentsChecked).toBe(6);
  });

  it('no recipe declares a base AND its fine grade (the pools must stay disjoint)', () => {
    // hasRecipeMaterials checks each reagent independently against the WHOLE
    // bag, with no reservation across reagents. Before grades that was safe
    // because reagent ids were disjoint; now materialGradeIds('iron_ore') and
    // materialGradeIds('fine_iron_ore') overlap on fine_iron_ore, so a recipe
    // declaring both would pass the gate on a bag that cannot pay both lines
    // and planGradeRemoval would drain the shared pool on the first one. The
    // same disjointness is what lets the craft capacity scratch walk recompute
    // required counts against a pristine inventory while the real loop
    // recomputes against a shrinking one.
    let checked = 0;
    for (const recipe of ALL_RECIPES) {
      const pools = recipe.reagents.map((r) => new Set(materialGradeIds(r.itemId)));
      for (let i = 0; i < pools.length; i++) {
        for (let j = i + 1; j < pools.length; j++) {
          const shared = [...pools[i]].filter((id) => pools[j].has(id));
          expect(
            shared,
            `${recipe.id} declares reagents sharing a grade pool: ` +
              `${recipe.reagents[i].itemId} and ${recipe.reagents[j].itemId}`,
          ).toEqual([]);
          checked += 1;
        }
      }
    }
    // Non-vacuity: multi-reagent recipes exist, so the pair loop really ran.
    expect(checked).toBeGreaterThan(50);
  });

  it('no QUEST declares collect objectives sharing a grade pool either (the sibling guard)', () => {
    // The same independent-per-line machinery runs quest collect credit
    // (countAcrossGrades per objective) and turn-in consumption
    // (planGradeRemoval per objective, no cross-line reservation), so the
    // recipe disjointness rule above is load-bearing for quests too: a
    // future quest declaring copper_ore AND fine_copper_ore as separate
    // collect lines would credit both from one shared pool and complete
    // while consuming only the first. No shipped quest does; this guard
    // makes the constraint a red test instead of tribal knowledge (the
    // whole-branch review found only the recipe half pinned).
    let pairsChecked = 0;
    for (const quest of Object.values(QUESTS)) {
      const collects = quest.objectives.filter(
        (o): o is Extract<(typeof quest.objectives)[number], { type: 'collect' }> =>
          o.type === 'collect',
      );
      const pools = collects.map((o) => new Set(materialGradeIds(o.itemId)));
      for (let i = 0; i < pools.length; i++) {
        for (let j = i + 1; j < pools.length; j++) {
          const shared = [...pools[i]].filter((id) => pools[j].has(id));
          expect(
            shared,
            `${quest.id} declares collect objectives sharing a grade pool: ` +
              `${collects[i].itemId} and ${collects[j].itemId}`,
          ).toEqual([]);
          pairsChecked += 1;
        }
      }
    }
    // Non-vacuity: multi-collect quests exist, so the pair loop really ran.
    expect(pairsChecked).toBeGreaterThan(0);
  });

  it('the tier-4 pick was re-pointed off the circuit it used to sit in', () => {
    // Pinned as a literal, because the general rule above would also pass on a
    // recipe that simply dropped its gathered reagent.
    const pick = TOOL_RECIPES.find((r) => r.id === 'recipe_thorium_mining_pick');
    expect(pick?.reagents.map((r) => r.itemId).sort()).toEqual([
      'fine_iron_ore',
      'mithril_mining_pick',
    ]);
    // fine_thorium_ore would have needed the tier-4 pick this recipe makes.
    expect(gatherMaterialTier('thorium_ore')).toBe(3);
    const pickUse = ITEMS.thorium_mining_pick.use;
    expect(isGatherToolUse(pickUse) && pickUse.tier).toBe(4);
    // The tier-5 pick keeps the refined bar AND gained the thornpeak grade.
    const arcanite = TOOL_RECIPES.find((r) => r.id === 'recipe_arcanite_mining_pick');
    expect(arcanite?.reagents.map((r) => r.itemId).sort()).toEqual([
      'arcanite_bar',
      'fine_thorium_ore',
      'thorium_mining_pick',
    ]);
  });

  it('a fine grade is only ever a tool-recipe reagent (nothing else was re-specced)', () => {
    const fineIds = new Set(Object.values(MATERIAL_GRADES).map((row) => row.fineItemId));
    const toolRecipeIds = new Set(TOOL_RECIPES.map((r) => r.id));
    for (const recipe of ALL_RECIPES) {
      if (toolRecipeIds.has(recipe.id)) continue;
      for (const reagent of recipe.reagents) {
        expect(
          fineIds.has(reagent.itemId),
          `${recipe.id} consumes the fine grade ${reagent.itemId}; only TOOL_RECIPES should`,
        ).toBe(false);
      }
    }
  });
});

describe('the pure-leaf contract material_tier.ts depends on', () => {
  it('material_grades.ts imports nothing at all', () => {
    // material_tier.ts builds MATERIAL_TIER_BY_ITEM at MODULE EVALUATION time by
    // calling fineMaterialFor. That is safe only because this module has no
    // imports and therefore cannot participate in a cycle. Give it one that
    // transitively reaches material_tier.ts and MATERIAL_GRADES is in its
    // temporal dead zone during that top-level build, so the module throws on
    // import. The file header asserts the property; this makes it enforceable.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      path.join(here, '..', 'src/sim/professions/material_grades.ts'),
      'utf8',
    );
    // Strip block and line comments first: the header discusses imports in
    // prose, and a raw scan would match that instead of real code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code.match(/^\s*import\b/m), 'material_grades.ts must stay import-free').toBeNull();
    // Teeth check: the stripped source is still real code, not an empty string.
    expect(code).toContain('export function harvestGradeItemId');
  });
});
