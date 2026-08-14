// Every craftable recipe output must state what it does in its item tooltip.
// The report behind the elixir fix asked for exactly this property (the four
// elixirs were the only silent outputs of the 79 craftables when audited);
// this sweep keeps it true. Each source below names one branch of
// Hud.itemTooltip that renders effect or purpose text, or the pure sibling
// builder that branch composes, mirroring the branch's own guard so a
// conditional branch cannot green-light an item it would not render for. A
// new craftable item whose only effect rides a NEW def field must extend
// itemTooltip AND this list in the same change, or this test reds instead of
// the item shipping a tooltip that says nothing, which is the bug class this
// file exists to block.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOUNTS } from '../src/sim/content/mounts';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import type { ItemDef } from '../src/sim/types';
import { cookingCatchHintKey } from '../src/ui/cooking_catch_hint_view';
import { elixirTooltipLines, wellFedTooltipLines } from '../src/ui/elixir_tooltip_view';
import { gatherToolTooltipLines } from '../src/ui/gather_tool_tooltip';
import { materialHintLine } from '../src/ui/material_hint_view';
import { materialProfessionHintText } from '../src/ui/material_profession_hint_view';
import { mobileStationTooltipLines } from '../src/ui/mobile_station_tooltip';
import { recipePatternTooltipLines } from '../src/ui/recipe_pattern_tooltip_view';
import { toolEffectTooltipLines } from '../src/ui/tool_effect_tooltip';

const EFFECT_SOURCES: Array<[string, (def: ItemDef) => boolean]> = [
  ['weapon damage', (def) => def.weapon !== undefined],
  ['stat lines', (def) => Object.values(def.stats ?? {}).some((v) => v !== undefined)],
  [
    'combat ratings',
    (def) =>
      (def.hitRating ?? 0) > 0 ||
      (def.critRating ?? 0) > 0 ||
      (def.hasteRating ?? 0) > 0 ||
      Math.min(def.pvpOffenseRating ?? 0, def.pvpDefenseRating ?? 0) > 0,
  ],
  ['food use line', (def) => (def.foodHp ?? 0) > 0],
  // The Well Fed buff a role food leaves behind, AFTER the food-restore row on
  // purpose. The order is the claim: every shipped role food restores health
  // too, so it matches the row above first and is reported as an ordinary
  // dish, which is what it is. This row exists for the case that row cannot
  // cover, a buff food with no sit-down restore at all, whose only tooltip
  // text is the Well Fed line. Putting it first would relabel the three
  // shipped foods and say nothing new.
  ['well fed line', (def) => wellFedTooltipLines(def) !== ''],
  ['drink use line', (def) => (def.drinkMana ?? 0) > 0],
  ['potion use line', (def) => (def.potionHp ?? 0) > 0 || (def.potionMana ?? 0) > 0],
  ['elixir use line', (def) => elixirTooltipLines(def) !== ''],
  ['gathering tool lines', (def) => gatherToolTooltipLines(def) !== ''],
  ['tool effect charm lines', (def) => toolEffectTooltipLines(def) !== ''],
  // The station-name resolver is irrelevant to the has-a-card predicate.
  ['mobile station lines', (def) => mobileStationTooltipLines(def, () => 'station') !== ''],
  ['enchanting material hint', (def) => materialHintLine(def.id) !== ''],
  ['raw cooking catch hint', (def) => cookingCatchHintKey(def.id) !== undefined],
  ['used-by profession hint', (def) => materialProfessionHintText(def.id) !== ''],
  ['weapon proc lines', (def) => def.kind === 'weapon' && (def.weaponProcs?.length ?? 0) > 0],
  ['item set block', (def) => def.set !== undefined],
  ['bag slot count', (def) => def.kind === 'bag' && (def.bagSlots ?? 0) > 0],
  // Mirrors the hud branch's own MOUNTS lookup: an unresolvable mount key
  // renders nothing, so it must not count as covered here either.
  ['mount description', (def) => def.kind === 'mount' && MOUNTS[def.mount] !== undefined],
  // questItemTooltipModel returns a story block for EVERY quest-kind item
  // (rules plus the orphaned line at minimum), so the kind alone is the
  // faithful mirror of the hud branch's questModel gate.
  ['quest story block', (def) => def.kind === 'quest'],
  // Recipe patterns (kind 'recipe'). Driven through the pure builder rather
  // than the bare kind, mirroring the elixir and gathering-tool rows: the
  // builder answers '' for a pattern whose taught recipe does not resolve or
  // is not drop-acquirable, and a kind-alone predicate would green-light
  // exactly those, which are the patterns whose click is a silent no-op. The
  // viewer (synced, nothing known, no skill) is the widest one for the two
  // lines this sweep is about: the teaches line renders whenever the result
  // item resolves, and the requirement line renders at its most permissive.
  // It is not universal, and the ONE case it misses is worth naming rather
  // than rounding off: a viewer who already KNOWS the recipe also gets the
  // already-known line, so a pattern whose result item has no ItemDef AND
  // whose recipe prints no requirement line (skillReq 0, or a craft with no
  // name key) would render that single line for them while this predicate
  // reads ''. Such a def is a tooltip that says nothing to everyone else, so
  // failing this sweep is the right answer for it, not a false negative.
  [
    'recipe pattern lines',
    (def) =>
      recipePatternTooltipLines(def, { synced: true, knownRecipes: [], craftSkills: {} }) !== '',
  ],
];

describe('crafted item tooltip coverage', () => {
  it('covers the whole recipe catalog (floor, grows with content)', () => {
    expect(ALL_RECIPES.length).toBeGreaterThanOrEqual(79);
  });

  it('every recipe output resolves to an ItemDef and renders effect or purpose text', () => {
    for (const recipe of ALL_RECIPES) {
      const def = ITEMS[recipe.resultItemId];
      expect(def, `${recipe.id}: output ${recipe.resultItemId} has no ItemDef`).toBeDefined();
      const source = EFFECT_SOURCES.find(([, fires]) => fires(def));
      expect(
        source,
        `${recipe.resultItemId} (crafted by ${recipe.id}) renders no effect or purpose ` +
          'text in its tooltip: give the def an effect field itemTooltip reads, or wire ' +
          'the new effect into Hud.itemTooltip and add it to EFFECT_SOURCES here',
      ).toBeDefined();
    }
  });

  it('fails a genuinely silent def (negative control for the predicate list)', () => {
    // A widened always-true predicate would green-light the whole catalog
    // forever with no signal; this synthetic def carries no effect field and
    // no hint-table id, so the list must find nothing for it.
    const silent: ItemDef = {
      id: 'qa_silent_probe',
      name: 'QA Silent Probe',
      kind: 'junk',
      quality: 'poor',
      sellValue: 1,
    };
    expect(EFFECT_SOURCES.find(([, fires]) => fires(silent))).toBeUndefined();
  });

  it('Hud.itemTooltip composes every pure builder the sweep trusts (source pin)', () => {
    // The def-field predicates above mirror branches that live INSIDE
    // itemTooltip itself, but the pure builders below could be unwired from
    // the coordinator without changing any def, and the sweep would still
    // pass. Pin each composition call inside the method body, whole-line //
    // comments stripped first (the comment-gameable trap; block comments are
    // left alone: a /* strip would misfire on string and regex literals).
    const hudSrc = readFileSync(path.join(__dirname, '../src/ui/hud.ts'), 'utf8').replace(
      /^\s*\/\/.*$/gm,
      '',
    );
    const start = hudSrc.indexOf('private itemTooltip(');
    const end = hudSrc.indexOf('private itemProcBlock(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = hudSrc.slice(start, end);
    for (const call of [
      'gatherToolTooltipLines(item)',
      'toolEffectTooltipLines(item)',
      'mobileStationTooltipLines(item, stationNameText)',
      'materialHintLine(item.id)',
      'cookingCatchHintKey(item.id)',
      'materialProfessionHintText(item.id)',
      'elixirTooltipLines(item)',
      'wellFedTooltipLines(item)',
      'recipePatternTooltipLines(item, this.sim.craftingIdentity)',
      'stackSizeTooltipLine(item, instance)',
    ]) {
      expect(body, `itemTooltip must compose ${call}`).toContain(call);
    }
  });
});
