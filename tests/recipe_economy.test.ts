// Recipe economy + ladder-shape gate (Professions 2.0): LADDER_RECIPES (54
// trainer recipes across six crafts at skillReq 0/25/50) plus the
// materials/specimens/vendor reagents in content/profession_items.ts.
// The locked economy decision: no recipe vendors above its input value. Several
// PRE-LADDER recipes were grossly gold-positive, so the invariant carries a
// FROZEN legacy exception list (never an escape hatch for new content). The
// economy rework turned the reagent lists of 10 of the 14
// members gold-negative; the last 4 (jerkin, vestments, druids hide, warded
// leggings) closed through the maintainer-approved paired arm (input rework
// plus an output sellValue re-price), so the frozen list below is EMPTY.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRAFT_GOLD_SINK_COPPER_PER_BUDGET,
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
  STATION_TYPE_BY_CRAFT,
} from '../src/sim/content/professions';
import {
  ALL_RECIPES,
  COMBO_RECIPES,
  ENGINEERING_ONRAMP_RECIPES,
  FARM_DROP_RUNG_FLOOR,
  FARM_RECIPES,
  HOE_RECIPES,
  INSCRIPTION_RECIPES,
  INTERMEDIATE_RECIPES,
  JEWELCRAFTING_RECIPES,
  LADDER_RECIPES,
  ROD_RECIPES,
  recipeById,
  recipeForResultItem,
  TOOL_EFFECT_RECIPES,
  TROPHY_RECIPES,
} from '../src/sim/content/recipes';
import { ITEMS, NPCS, STATIONS } from '../src/sim/data';

// The top rod tier a TRAINER teaches. The apex rung above it is drop-taught by
// ruling (masterwrought Phase 11i, R8: an apex rung reaches players through the
// pillars), so this is the line the channel split falls on.
const TRAINER_TAUGHT_ROD_MAX_TIER = 5;

import { requiredReagentCountFor } from '../src/sim/professions/crafting';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { stationsOfType, stationTypeForCraft } from '../src/sim/professions/stations';
import { PRE_TRAINING_RECIPE_IDS, trainingStationTypeFor } from '../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { stripComments } from './helpers/strip_comments';
import { tsFilesUnder } from './helpers/ts_files_under';

// --- economy math (the locked reagent-value rule) --------------------------
// inputValue: sum over reagents of count x the reagent's unit value, where the
// unit value is buyValue when the def carries a finite buyValue > 0 (a vendor
// staple the player pays for), else sellValue (a harvested/dropped material the
// player realizes at the vendor floor). outputValue: the result def sellValue
// times the recipe's resultCount.
function reagentUnitValue(itemId: string): number {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`recipe reagent ${itemId} has no ItemDef`);
  return typeof def.buyValue === 'number' && def.buyValue > 0 ? def.buyValue : def.sellValue;
}
function inputValue(recipe: ProfessionRecipeRecord): number {
  let total = 0;
  for (const reagent of recipe.reagents) total += reagent.count * reagentUnitValue(reagent.itemId);
  return total;
}
function outputValue(recipe: ProfessionRecipeRecord): number {
  const def = ITEMS[recipe.resultItemId];
  if (!def) throw new Error(`recipe result ${recipe.resultItemId} has no ItemDef`);
  return def.sellValue * recipe.resultCount;
}

function requireRecipe(id: string): ProfessionRecipeRecord {
  const recipe = recipeById(id);
  if (!recipe) throw new Error(`recipe ${id} missing`);
  return recipe;
}

// The counterfactual floor: specialized in the recipe's own craft (cap skill
// clears any threshold) AND holding a self-signed copy of every reagent,
// through requiredReagentCountFor, the same function the sim charges. Two
// caveats the src/sim/content/recipes.ts trophy header names, and they cut in
// OPPOSITE directions. FIRST, the Jack of All Trades 0.9 multiplier is
// EXCLUDED (the default false arm), and that is the PERMISSIVE direction, not
// the safe one: the multiplier shaves counts, so a Jack's real bill is at or
// under the figure computed here, and the vendor-loop bound below checks a
// number LARGER than a Jack would pay (recipe_sootscale_mantle: 300 here,
// exactly 280 under the Jack arm, equal to its output, where the strict
// less-than fails). The bound is honest only while no character can become a
// Jack, which the attuneJackOfAllTrades caller scan in THE ECONOMY INVARIANT
// pins. SECOND, self-signing a reagent needs a copy the crafter gathered or
// harvested at a rare-plus material rarity roll (gathering.ts
// isSignableMaterialRarity; the corpse-harvest arms in interaction.ts mint
// the signed component or its family's specimen) or a rare-plus masterwork
// craft. A node yield, a pristine specimen, or a corpse component whose
// family carries NO specimen (thorium_ore, goldleaf_herb, elderwood_log and
// pristine_hide on the trophy bills) CAN therefore be self-signed, while a
// component whose family has a specimen (rough_hide, spider_silk: the
// harvest grants the component PLAIN and signs the specimen instead), a
// mob-dropped trophy and a bought vendor staple never can, so the floor is
// exactly reachable for
// some rows (the cinch and the belt, by one self-signed pristine hide) and a
// counterfactual for others (the trophy header prints the reachable figure
// per row where it differs). Assuming every reagent signed is the STRICT
// direction for this caveat (a bill at or under what any crafter pays), the
// safe one for the bound. Module scope so the vendor-loop bound (THE ECONOMY
// INVARIANT) and the trophy floor map (REFERENTIAL INTEGRITY) compute one
// number from one body.
function minAchievableInputValue(recipe: ProfessionRecipeRecord): number {
  const specialized = { [recipe.professionId]: 125 };
  let total = 0;
  for (const reagent of recipe.reagents) {
    const { count } = requiredReagentCountFor(true, reagent, specialized, recipe.professionId);
    total += count * reagentUnitValue(reagent.itemId);
  }
  return total;
}

// The legacy gold-positive exception list is EMPTY as of the economy rework
// (maintainer-approved 2026-07-22): 10 of the original 14
// members were reworked gold-negative through INPUT-only reagent reworks, and
// the last 4 (jerkin, vestments, druids hide, warded leggings) through the
// approved paired arm: a zone-1-legal thematic input rework PLUS an output
// sellValue re-priced below the new input (vendor buyValue untouched). The
// invariant below now enforces EVERY recipe. The mechanism stays so any
// future exception must carry the same three-way proof (a, b, c below):
// membership in PRE_TRAINING_RECIPE_IDS, a currently-violating margin
// (self-pruning), and the exact sorted literal pin.
const LEGACY_GOLD_POSITIVE_RECIPE_IDS: ReadonlySet<string> = new Set([]);

// The exact sorted membership, spelled out as literals (property c below). Kept
// separate from the authoring-grouped Set above so a stray addition/removal reds
// the toEqual rather than silently passing.
const EXPECTED_LEGACY_SORTED: string[] = [];

describe('THE ECONOMY INVARIANT', () => {
  // Operator: strict less-than. Measured against the shipped tables, the
  // tightest passing non-legacy margin is 2 copper and no recipe sits exactly
  // equal, so outputValue < inputValue holds for every non-legacy recipe.
  it('every non-legacy recipe vendors strictly below its input value', () => {
    let checked = 0;
    for (const recipe of ALL_RECIPES) {
      if (LEGACY_GOLD_POSITIVE_RECIPE_IDS.has(recipe.id)) continue;
      checked += 1;
      expect(
        outputValue(recipe),
        `${recipe.id}: output ${outputValue(recipe)} must be below input ${inputValue(recipe)}`,
      ).toBeLessThan(inputValue(recipe));
    }
    // Guard the enumeration is real (not an empty sweep): all recipes minus the
    // frozen legacy ids (zero members since the economy rework completed).
    expect(checked).toBe(ALL_RECIPES.length - LEGACY_GOLD_POSITIVE_RECIPE_IDS.size);
    expect(checked).toBeGreaterThan(0);
  });

  // --- the discount-aware vendor-loop arm --------------------------------
  // The listed-count arm above prices the NAIVE craft. A specialized crafter
  // (skill at the craft's perk threshold, automatic for anyone deep in a
  // craft) consumes DISCOUNTED counts, and a held self-signed instance
  // shaves one more before the discount (requiredReagentCountFor, the same
  // function the sim charges). For a recipe whose every reagent is
  // NPC-vendor-stocked the whole loop is pure gold with infinite supply, so
  // the output must vendor strictly below the CHEAPEST achievable input or
  // the loop is gold-positive (the Kilnscale Mantle sat exactly
  // here: listed 520 vs output 470, but specialized consumption is 5 ore +
  // 4 flux = 380, and with a self-signed ore 4 + 3 = 300). Self-signed is
  // assumed held for EVERY reagent: stricter than reality for unsignable
  // vendor staples, which is the safe direction for an invariant.
  function vendorStockedIds(): ReadonlySet<string> {
    const stocked = new Set<string>();
    for (const npc of Object.values(NPCS)) {
      for (const id of npc.vendorItems ?? []) stocked.add(id);
    }
    return stocked;
  }
  // The set this bound runs over is keyed on the PRICE BASIS, not on live
  // vendor stock. It used to be derived from vendorItems, which made it
  // fragile in the worst way: the gathered-material delist emptied the live
  // stocked set, and a set-derived loop that empties stops asserting without
  // ever going red. The counterfactual is the durable question anyway. A recipe
  // whose every reagent carries a copper buyValue is ONE vendor row away from
  // being a pure-gold infinite-supply loop, so it must clear the bound today,
  // whether or not a counter stocks it today.
  function counterfactuallyVendorFedRecipes(): ProfessionRecipeRecord[] {
    // A copper buyValue is the whole test (the FURY honor vendor's priceHonor
    // stock has no copper basis and must never classify a recipe into this arm).
    return ALL_RECIPES.filter((recipe) =>
      recipe.reagents.every((reagent) => {
        const def = ITEMS[reagent.itemId];
        return !!def && typeof def.buyValue === 'number' && def.buyValue > 0;
      }),
    );
  }

  it('every recipe a vendor COULD fully feed vendors strictly below its cheapest input', () => {
    const vendorFed = counterfactuallyVendorFedRecipes();
    // Membership pin: exactly these seven loops. A new recipe (or a new
    // buyValue on a reagent) that makes another recipe counterfactually
    // vendor-fed must be added HERE deliberately, and it then rides the bound
    // below. recipe_bronze_hoe joined with the hoe phase: both its reagents
    // carry a copper basis (fine_vale_wheat is the farming economy-basis
    // convention, garden_hoe is the vendor-priced tier-1 rung). The Phase 11
    // tier-1 buff dish stays OUT of this set deliberately: its vale_wheat
    // binder (the pottage precedent) keeps a priceless reagent on the row.
    expect(vendorFed.map((recipe) => recipe.id).sort()).toEqual([
      'recipe_ashwood_axe',
      'recipe_bronze_hoe',
      'recipe_goldleaf_mana_draught',
      'recipe_goldleaf_sickle',
      'recipe_sootscale_mantle',
      'recipe_sunpetal_mana_draught',
      'recipe_thorium_mining_pick',
    ]);
    // NON-VACUITY FLOOR, the point of the rewrite: the loop below must never be
    // allowed to run over an empty set. The toEqual above would catch a drop to
    // zero today, but the floor states the requirement directly, so a future
    // edit that relaxes the membership pin cannot quietly take the teeth with it.
    expect(vendorFed.length).toBeGreaterThanOrEqual(7);
    for (const recipe of vendorFed) {
      expect(
        outputValue(recipe),
        `${recipe.id}: output ${outputValue(recipe)} must be below the cheapest achievable ` +
          `input ${minAchievableInputValue(recipe)} (specialized + self-signed)`,
      ).toBeLessThan(minAchievableInputValue(recipe));
    }
    // Pin the mantle's tight bound to its literal: the protective threshold
    // depends on the specialization discount actually firing inside
    // requiredReagentCountFor. Self-sign alone would give 6*60 + 4*20 = 440,
    // so without this pin a discount regression would silently widen the
    // bound and let a 300-to-440 re-price slip through green.
    expect(minAchievableInputValue(requireRecipe('recipe_sootscale_mantle'))).toBe(300);
  });

  it('attuneJackOfAllTrades has no production caller and mints the only Jack flag, so excluding the Jack arm above is honest', () => {
    // The vendor-loop bound computes minAchievableInputValue with the Jack
    // multiplier EXCLUDED, and exclusion is the PERMISSIVE direction: the 0.9
    // shaves counts, so a Jack's real bill is at or under the figure the
    // bound checks, and recipe_sootscale_mantle drops from 300 to exactly
    // 280 under the Jack arm, equal to its output, where the strict
    // less-than fails. The bound is honest today only because no character
    // can become a Jack: attuneJackOfAllTrades
    // (src/sim/professions/archetype.ts) is exported for its tests and has
    // no caller in src/, server/ or headless/ (the three hosts that run the
    // one sim) outside its own module. This scan pins that. THE DAY A
    // PRODUCTION CALLER LANDS (a quest turn-in, a dev command, an admin
    // runtime arm) THIS REDS, and the vendor-loop bound must be re-derived
    // with the Jack arm: thread isJackOfAllTrades = true through
    // minAchievableInputValue, at which point the mantle sits ON its output
    // and its bill or price has to move first.
    //
    // Each root carries a file-count floor a little under its real count.
    // These roots are deep, so the floor pins the walk directly (the
    // tests/CLAUDE.md deep-root recipe): a root dropping out of the walk (a
    // renamed directory, a walker regression to a flat read, a typo in this
    // list) reds here instead of leaving an empty caller list that reads as
    // a scan result. Re-measure with tsFilesUnder when a floor trips on an
    // honest shrink.
    const ROOT_FILE_FLOOR: Record<string, number> = { src: 2100, server: 300, headless: 3 };
    // THE FLAG'S WRITE SET, the same closed-circuit argument stated as a scan
    // rather than trusted to the caller list. A caller scan alone leaves one
    // door: the hydrate arm of normalizeArchetypeState (archetype.ts) copies
    // a persisted `isJackOfAllTrades: true` back into the live flag with no
    // call to attuneJackOfAllTrades at all. That door is closed because the
    // persisted blob has ONE writer, serializeArchetypeState, which emits
    // `isJackOfAllTrades: true` only while the live flag is already true,
    // and the live flag has ONE mint, the `state.isJackOfAllTrades = true`
    // inside attuneJackOfAllTrades. Read in a loop: a persisted true needs a
    // live true, a live true needs the mint, the mint needs a caller, and
    // the caller list is empty. So the scan classifies EVERY write to the flag
    // across the three roots (comments stripped) and pins exactly three, each
    // a named link of that loop and each anchored to its site: the mint
    // inside the attuneJackOfAllTrades body; the serializer's re-emit, which
    // must keep its `state.isJackOfAllTrades ?` guard (an unconditional
    // projection would mint a true through the hydrate arm on the next
    // load) and keep it UN-inverted (a `!state.isJackOfAllTrades ?` guard
    // would persist a true for every never-attuned character, a worse door,
    // so the guard regex is anchored against a leading `!`, and
    // tests/professions_jack.test.ts pins the serializer behaviorally); and
    // the hydrate arm itself inside normalizeArchetypeState, whose
    // right-hand side must be EXACTLY
    // `state.activeArchetype === null && saved.isJackOfAllTrades === true;`
    // (a longer disjunction there would be a second door, so the arm is
    // matched whole, never by substring). A write is any assignment to the
    // flag (bare, ||= or ??=, plain or bracket access, whatever the
    // right-hand side) and any object member (plain or quoted computed key,
    // whatever the value); a right-hand side that is the literal false and
    // nothing else (a reset, a default parameter, the empty state) is the one
    // write skipped, and `false || true` is not that. A key built at runtime
    // is one spelling no static scan can see; a wholesale copy
    // (`Object.assign(state, savedBlob)`, a spread of a persisted blob), an
    // API write with a string key (`Reflect.set`, `Object.defineProperty`)
    // and the SHORTHAND member (`{ ...state, isJackOfAllTrades }`, which
    // carries no colon) are the others, which is why the caller scan above
    // stays the primary guard and tests/professions_jack.test.ts carries the
    // behavioral pins on the hydrate arm. The walk is .ts-only through
    // tsFilesUnder (the scan's one structural blind spot beside the runtime
    // key); the Svelte files under src/admin cannot reach ArchetypeState.
    const FLAG_WRITE =
      /\bisJackOfAllTrades(?:["']\])?\s*(?:\|\|=|\?\?=|=(?!=))|\bisJackOfAllTrades(?:["']\])?\s*:/g;
    const GUARDED_RE_EMIT =
      /(?<![!\w$.])state\.isJackOfAllTrades\s*\?\s*\{\s*isJackOfAllTrades:\s*true\s*\}/;
    // The hydrate line verbatim (archetype.ts sits close to the column limit
    // there; a rename that wraps it empties the read right-hand side and reds
    // the pin below as `other`, which is loud rather than silent).
    const HYDRATE_RHS = 'state.activeArchetype === null && saved.isJackOfAllTrades === true;';
    // A skipped write must be the literal false AND a terminator on the same
    // line: a bare `false` alone (the first line of a wrapped `false || true`)
    // is not skipped, so it classifies like any write and reads `other`.
    const FALSE_ONLY = /^false\s*[,;)}][\s,;)}]*$/;
    // The predicate's own controls, so a regex edit cannot quietly widen or
    // narrow what counts as a write: every assignment spelling and every
    // member spelling match, the comparison and the optional `?:` type member
    // do not; any OTHER `isJackOfAllTrades:` (a required type member, an
    // inline object type, a destructuring rename) matches by design and reads
    // loudly as `other`, so a new spelling is classified rather than
    // exempted; the false skip clears a terminated literal false and nothing
    // longer.
    expect('state.isJackOfAllTrades = true;'.match(FLAG_WRITE)).not.toBeNull();
    expect('state.isJackOfAllTrades = ok;'.match(FLAG_WRITE)).not.toBeNull();
    expect('state.isJackOfAllTrades ||= true;'.match(FLAG_WRITE)).not.toBeNull();
    expect('state.isJackOfAllTrades ??= true;'.match(FLAG_WRITE)).not.toBeNull();
    expect("state['isJackOfAllTrades'] = true;".match(FLAG_WRITE)).not.toBeNull();
    expect('{ isJackOfAllTrades: true }'.match(FLAG_WRITE)).not.toBeNull();
    expect('{ isJackOfAllTrades: flag }'.match(FLAG_WRITE)).not.toBeNull();
    expect('{ ["isJackOfAllTrades"]: true }'.match(FLAG_WRITE)).not.toBeNull();
    expect("{ ['isJackOfAllTrades']: true }".match(FLAG_WRITE)).not.toBeNull();
    expect('saved.isJackOfAllTrades === true'.match(FLAG_WRITE)).toBeNull();
    expect('isJackOfAllTrades?: true;'.match(FLAG_WRITE)).toBeNull();
    expect('isJackOfAllTrades?: boolean;'.match(FLAG_WRITE)).toBeNull();
    // The shorthand member is the one member spelling the regex cannot see
    // (no colon); named as a blind spot above rather than exempted silently.
    expect('{ isJackOfAllTrades }'.match(FLAG_WRITE)).toBeNull();
    // The serializer link's guard, both ways: the live shape matches, and the
    // inverted guard (a true persisted for every non-Jack) does NOT, so an
    // inversion reads `other` and reds the three-write pin below.
    expect(
      GUARDED_RE_EMIT.test('...(state.isJackOfAllTrades ? { isJackOfAllTrades: true } : {}),'),
    ).toBe(true);
    expect(
      GUARDED_RE_EMIT.test('...(!state.isJackOfAllTrades ? { isJackOfAllTrades: true } : {}),'),
    ).toBe(false);
    expect(FALSE_ONLY.test('false,')).toBe(true);
    expect(FALSE_ONLY.test('false }')).toBe(true);
    expect(FALSE_ONLY.test('false')).toBe(false);
    expect(FALSE_ONLY.test('false || true;')).toBe(false);
    expect(FALSE_ONLY.test('false ?? flag')).toBe(false);
    // The two anchors. The start anchor: a right-hand side that merely ENDS
    // in a terminated false (`saved.isJackOfAllTrades ?? false;` mints
    // whenever the saved flag is true, and the assignment arm finds no
    // second FLAG_WRITE match on that line, so `^` is the only thing between
    // it and a silent skip) is a write. The end anchor: a `false,`-prefixed
    // line is not exempted wholesale, which matters when the rest of the
    // line is a write the scan cannot see (an Object.assign, a runtime key);
    // a visible continuation is a second FLAG_WRITE match classified on its
    // own.
    expect(FALSE_ONLY.test('saved.isJackOfAllTrades ?? false;')).toBe(false);
    expect(FALSE_ONLY.test('true || false;')).toBe(false);
    expect(FALSE_ONLY.test('false, jack = true;')).toBe(false);
    // The hydrate key has no string control on purpose: a string compared to
    // itself proves nothing, and the key is exercised where it bites, in the
    // classification of the live line below (a widened disjunction, a moved
    // arm, or a dropped guard reads `other` and reds the pin).
    const declaringModule = 'sim/professions/archetype.ts';
    const callers: string[] = [];
    let declared = false;
    const trueWrites: string[] = [];
    for (const [root, floor] of Object.entries(ROOT_FILE_FLOOR)) {
      const files = tsFilesUnder(path.resolve(process.cwd(), root));
      expect(files.length, `${root}/ file count under its floor`).toBeGreaterThanOrEqual(floor);
      for (const { file, full } of files) {
        const code = stripComments(readFileSync(full, 'utf8'));
        const isDeclaring = root === 'src' && file === declaringModule;
        const attuneStart = isDeclaring
          ? code.indexOf('export function attuneJackOfAllTrades(')
          : -1;
        const attuneEnd = attuneStart === -1 ? -1 : code.indexOf('\n}', attuneStart);
        const guard = isDeclaring ? GUARDED_RE_EMIT.exec(code) : null;
        const hydrateStart = isDeclaring
          ? code.indexOf('export function normalizeArchetypeState(')
          : -1;
        const hydrateEnd = hydrateStart === -1 ? -1 : code.indexOf('\n}', hydrateStart);
        for (const write of code.matchAll(FLAG_WRITE)) {
          const at = write.index;
          const after = at + write[0].length;
          // Both arms carry their value after the match: the rest of the line,
          // read to the end of the file when the line is the last one.
          const eol = code.indexOf('\n', after);
          const rhs = code.slice(after, eol === -1 ? undefined : eol).trim();
          // A right-hand side that is the literal false and nothing else (the
          // requiredReagentCountFor default parameter in crafting.ts, the
          // empty archetype state, the two client `: false` literals) can
          // never mint a Jack; anything longer is classified like any write.
          if (FALSE_ONLY.test(rhs)) continue;
          const kind =
            attuneStart !== -1 && at > attuneStart && at < attuneEnd
              ? 'attune'
              : guard !== null && at >= guard.index && at < guard.index + guard[0].length
                ? 'serializer'
                : hydrateStart !== -1 && at > hydrateStart && at < hydrateEnd && rhs === HYDRATE_RHS
                  ? 'hydrate'
                  : 'other';
          trueWrites.push(`${kind}@${root}/${file}`);
        }
        if (!/\battuneJackOfAllTrades\b/.test(code)) continue;
        if (isDeclaring) {
          declared = /export function attuneJackOfAllTrades\(/.test(code) && attuneEnd !== -1;
          continue;
        }
        callers.push(`${root}/${file}`);
      }
    }
    // Positive control: the walk reached the declaring module and read the
    // export (and found the body's close), so an empty caller list is a scan
    // result, not a missed root.
    expect(declared).toBe(true);
    expect(callers).toEqual([]);
    // Three writes, each a named link of the closed circuit and each anchored
    // to its site: the mint in the attune body, the serializer's guarded
    // re-emit, and the hydrate arm inside normalizeArchetypeState, whose
    // right-hand side is exactly HYDRATE_RHS and so can only carry a true the
    // serializer already wrote. A fourth entry, or one of these three reading
    // `other` (a moved arm, a widened disjunction, a dropped guard), is a new
    // door.
    expect(trueWrites.sort()).toEqual([
      'attune@src/sim/professions/archetype.ts',
      'hydrate@src/sim/professions/archetype.ts',
      'serializer@src/sim/professions/archetype.ts',
    ]);
    // The reason the guard exists, pinned as numbers through the same
    // function the bound uses: the Jack arm lands the mantle exactly on its
    // output.
    const mantle = requireRecipe('recipe_sootscale_mantle');
    const specialized = { [mantle.professionId]: 125 };
    let jackBill = 0;
    for (const reagent of mantle.reagents) {
      const { count } = requiredReagentCountFor(
        true,
        reagent,
        specialized,
        mantle.professionId,
        true,
      );
      jackBill += count * reagentUnitValue(reagent.itemId);
    }
    expect(jackBill).toBe(280);
    expect(jackBill).toBe(outputValue(mantle));
  });

  it('the caller scan makes no directory read of its own (the shared walker is its only reader; the roots themselves are pinned by ROOT_FILE_FLOOR above)', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  it('no recipe is fully vendor-fed in live stock, and the bound above does not rest on that', () => {
    const stocked = vendorStockedIds();
    const liveVendorFed = ALL_RECIPES.filter((recipe) =>
      recipe.reagents.every((reagent) => {
        const def = ITEMS[reagent.itemId];
        return (
          stocked.has(reagent.itemId) &&
          !!def &&
          typeof def.buyValue === 'number' &&
          def.buyValue > 0
        );
      }),
    );
    // Since the gathered-material delist, every one of the loops has at
    // least one reagent no NPC sells (Phase 11's tier-1 buff dish keeps the
    // property via its vale_wheat binder). This records that fact; it is NOT
    // what the bound runs over.
    expect(liveVendorFed.map((recipe) => recipe.id)).toEqual([]);
    // The live set is a subset of the counterfactual one by construction, and
    // the counterfactual one is what still carries the assertions. Stating the
    // subset relation as a SET operation, not as a loop over liveVendorFed:
    // that loop runs zero times against the emptiness asserted one line up,
    // which is the same assert-nothing shape this rewrite exists to remove.
    const counterfactual = new Set(counterfactuallyVendorFedRecipes().map((r) => r.id));
    const liveIds = liveVendorFed.map((recipe) => recipe.id);
    expect(liveIds.filter((id) => !counterfactual.has(id))).toEqual([]);
    expect(counterfactual.size).toBeGreaterThan(0);
    // vendorStockedIds itself must be live, or the emptiness above is a lie
    // told by a broken reader rather than a fact about the content.
    expect(stocked.size).toBeGreaterThan(20);
    expect(stocked.has('arcanite_bar')).toBe(true);
  });

  it('(a) every legacy member predates trainer acquisition (in PRE_TRAINING_RECIPE_IDS)', () => {
    const preTraining = new Set(PRE_TRAINING_RECIPE_IDS);
    for (const id of LEGACY_GOLD_POSITIVE_RECIPE_IDS) {
      expect(preTraining.has(id), `${id} must be a pre-training-era recipe`).toBe(true);
    }
  });

  it('(b) every legacy member currently DOES violate the invariant (self-pruning)', () => {
    for (const id of LEGACY_GOLD_POSITIVE_RECIPE_IDS) {
      const recipe = recipeById(id);
      expect(recipe, `${id} must resolve to a real recipe`).toBeDefined();
      // Violation of a strict-less-than invariant means output >= input.
      expect(
        outputValue(recipe as ProfessionRecipeRecord),
        `${id}: output ${outputValue(recipe as ProfessionRecipeRecord)} vs input ${inputValue(recipe as ProfessionRecipeRecord)} no longer violates; remove it from the frozen list`,
      ).toBeGreaterThanOrEqual(inputValue(recipe as ProfessionRecipeRecord));
    }
  });

  it('(c) the frozen list has exactly the pinned sorted contents', () => {
    expect([...LEGACY_GOLD_POSITIVE_RECIPE_IDS].sort()).toEqual(EXPECTED_LEGACY_SORTED);
  });
});

describe('REFERENTIAL INTEGRITY', () => {
  // The real trainer-home rule (professions/training.ts resolveTrain): a train
  // attempt locates the station via trainingStationTypeFor(recipe): the
  // recipe's OWN stationType when it has one, else the station serving its
  // craft. The fallback arm is how the three station-free COMBO_RECIPES (no
  // stationType field) resolve a home (their professionId maps to a station
  // type in STATION_TYPE_BY_CRAFT); the explicit arm is how the
  // enchanting-home TOOL_EFFECT_RECIPES resolve one (enchanting has no
  // station, the charms bind to the toolworks). So the teachable-home check
  // walks the same shared resolution the sim and the trainer window use, and
  // every trainer recipe must resolve an existing station type that has at
  // least one placed station with an existing master NPC.
  const RUNTIME_STATION_TYPES = new Set(Object.values(STATION_TYPE_BY_CRAFT));

  it('every recipe reagent and result resolves to a real ItemDef', () => {
    for (const recipe of ALL_RECIPES) {
      expect(ITEMS[recipe.resultItemId], `result ${recipe.resultItemId}`).toBeDefined();
      for (const reagent of recipe.reagents) {
        expect(ITEMS[reagent.itemId], `reagent ${reagent.itemId} in ${recipe.id}`).toBeDefined();
      }
    }
  });

  it('every trainer recipe has a teachable home (station type, station, master NPC)', () => {
    let trainerRecipes = 0;
    for (const recipe of ALL_RECIPES) {
      if (!recipe.acquisition?.includes('trainer')) continue;
      trainerRecipes += 1;
      const type = trainingStationTypeFor(recipe);
      expect(
        type,
        `${recipe.id}: no teachable home (no stationType, and professionId ` +
          `${recipe.professionId} has no station type)`,
      ).toBeDefined();
      const stations = stationsOfType(STATIONS, type as NonNullable<typeof type>);
      expect(stations.length, `${recipe.id}: no station of type ${type}`).toBeGreaterThan(0);
      for (const station of stations) {
        expect(
          NPCS[station.masterNpcId],
          `${recipe.id}: station ${station.id} master ${station.masterNpcId} has no NpcDef`,
        ).toBeDefined();
      }
    }
    // The 54 ladder recipes plus the 3 grandfathered combos all carry
    // 'trainer', and so do the two TRAINER-taught crafted rods (the apex rung
    // masterwrought Phase 11i added is a drop, see the derived term below), the two tool-effect
    // charms, the nine jewelcrafting catalog recipes, the six inscription
    // catalog recipes, the ten Masterwrought phase 07 intermediates, the
    // four crafted hoes, the seven Masterwrought phase 11l trophy consumers,
    // the two masterwrought Phase 11o engineering on-ramp rows, and the
    // farm-economy set's ON-RAMP: the
    // pre-training id list is frozen, so anything authored after that switch
    // has to be learned.
    //
    // THE FARM TERM IS DERIVED FROM THE RUNG, not from FARM_RECIPES.length and
    // not from the acquisition field (masterwrought Phase 11f): the set is
    // split across two channels now, every row below FARM_DROP_RUNG_FLOOR
    // trainer-taught and every row at or above it a drop. Reading the term off
    // skillReq keeps the arm's teeth, because a farm row that silently lost
    // 'trainer' while staying on its rung would drop the LEFT side alone and
    // red; a term derived from `acquisition` would move both sides together
    // and pass over the regression.
    const farmTrainerRows = FARM_RECIPES.filter((r) => r.skillReq < FARM_DROP_RUNG_FLOOR).length;
    // THE ROD TERM IS DERIVED THE SAME WAY, and for the same reason
    // (masterwrought Phase 11i): the rod ladder is split across two channels
    // now, the two shipped rungs trainer-taught and the apex rung a drop, so
    // ROD_RECIPES.length would over-count the left side by one. The
    // discriminator is the rung's TIER rather than its skillReq, because both
    // the tidewrought and the apex rod sit at engineering 125 and only the tier
    // separates them. Reading it off the tier keeps the arm's teeth exactly as
    // the farm term does: a shipped rod that silently lost 'trainer' while
    // staying at tier 4 or 5 drops the LEFT side alone and reds.
    const rodTrainerRows = ROD_RECIPES.filter((r) => {
      const use = ITEMS[r.resultItemId]?.use;
      return use?.type === 'gatherTool' && use.tier <= TRAINER_TAUGHT_ROD_MAX_TIER;
    }).length;
    expect(trainerRecipes).toBe(
      LADDER_RECIPES.length +
        COMBO_RECIPES.length +
        rodTrainerRows +
        TOOL_EFFECT_RECIPES.length +
        JEWELCRAFTING_RECIPES.length +
        INSCRIPTION_RECIPES.length +
        INTERMEDIATE_RECIPES.length +
        HOE_RECIPES.length +
        TROPHY_RECIPES.length +
        ENGINEERING_ONRAMP_RECIPES.length +
        farmTrainerRows,
    );
    // The sibling literal for the 11o term: two rows, both trainer-taught.
    expect(ENGINEERING_ONRAMP_RECIPES, 'the engineering on-ramp is two rows').toHaveLength(2);
    // The sibling literal for the derived term, same reason every other term
    // has one: without it, a farm row deleted outright would shrink both sides
    // of the equality by one and the arm would pass over a smaller world.
    // Predicted then observed at the Phase 11f rung climb: 8 of the 14 rows
    // sit below the floor (four at rung 0, three at 25, the held bannock at
    // 50), and the other 6 are drops.
    expect(farmTrainerRows, 'the farm on-ramp is eight rows').toBe(8);
    // The rod ladder's own split, beside the farm one: three rungs, of which
    // the two below the apex tier are trainer-taught (masterwrought Phase 11i).
    expect(rodTrainerRows, 'two trainer-taught rod rungs').toBe(2);
    // COMBO and LADDER get the same sibling treatment as the rest (Phase 11d QA):
    // without a literal beside them, losing one combo row drops BOTH sides of the
    // equality by one and the sum stays balanced, so the arm passes over a
    // smaller world. Every other term already had one; 11d itself added the
    // pattern for HOE and FARM.
    expect(COMBO_RECIPES).toHaveLength(3);
    expect(LADDER_RECIPES).toHaveLength(54);
    expect(JEWELCRAFTING_RECIPES).toHaveLength(9);
    expect(INSCRIPTION_RECIPES).toHaveLength(6);
    expect(INTERMEDIATE_RECIPES).toHaveLength(10);
    expect(ROD_RECIPES).toHaveLength(3);
    expect(TOOL_EFFECT_RECIPES).toHaveLength(2);
    // FOUR since masterwrought Phase 11j added the apex rung. All four stay
    // trainer-taught, so unlike the rod and farm sets the hoe term needs no
    // channel split: the whole list still feeds the sum above.
    expect(HOE_RECIPES).toHaveLength(4);
    // The Masterwrought phase 11l trophy economy: one consumer recipe per
    // adopted junk trophy (five promoted from poor, plus the two
    // already-common leather trophies its second review round adopted; the
    // sixth fix round output-excluded the chipped tusk and the 11l QA the
    // cracked fetish and the bogiron nugget, each deleting its row), all
    // seven trainer-taught, so the whole list feeds the sum above (no
    // channel split).
    expect(TROPHY_RECIPES).toHaveLength(7);
    // The economy-hooks phase's eight farm dishes, the four Phase 11 well-fed
    // buff dishes, the growth tonic's alchemy row, and the Phase 12 shared
    // feast (a cooking row with a placeable junk output). Deliberately
    // re-pinned here (9 -> 13 -> 14), beside its siblings, so the trainer sum
    // above can never absorb a silent addition to the farm set. The COUNT did
    // not move at the Phase 11f rung climb, which re-tiered and re-channelled
    // rows and minted no new id; what moved is that only 8 of the 14 feed the
    // trainer term above.
    expect(FARM_RECIPES).toHaveLength(14);
  });

  it('every trophy row still consumes its trophy and vendors above the trophy it consumes', () => {
    // The 11l-OUT interval's lower arm, pinned per row rather than trusted to
    // the row comments: each consumer must still list its adopted trophy on
    // the bill, and the finished item must vendor above the trophies it ate
    // (sellValue times the consumed count, the stacked form), or the recipe
    // is a way to LOSE value against vendoring the trophy raw. The literal
    // map is the pin: a re-picked output or a dropped trophy line reds here.
    // Pinned in the STRICTER stacked form on purpose (output above sellValue
    // times the consumed count), while the 11l-OUT doctrine's letter compares
    // the UNIT sellValue: a future row inside the doctrine's interval but
    // outside the stacked one reds here by design, and widening the arm is a
    // deliberate edit, never a drive-by.
    const TROPHY_BY_RECIPE: Record<string, string> = {
      recipe_oiled_boots: 'mudfin_scale',
      recipe_gravewyrm_bone_quiver: 'cracked_wyrm_scale',
      recipe_fenshadow_maul: 'cracked_ogre_tusk',
      recipe_lesser_healing_potion: 'tallow_candle',
      recipe_linen_pouch: 'bandit_bandana',
      recipe_wildgrove_cinch: 'old_cragmaws_pelt',
      recipe_cragprowl_belt: 'emberwing_cinderscale',
    };
    expect(Object.keys(TROPHY_BY_RECIPE).sort()).toEqual(TROPHY_RECIPES.map((r) => r.id).sort());
    for (const recipe of TROPHY_RECIPES) {
      const trophyId = TROPHY_BY_RECIPE[recipe.id];
      const line = recipe.reagents.find((reagent) => reagent.itemId === trophyId);
      expect(line, `${recipe.id} no longer consumes ${trophyId}`).toBeDefined();
      const trophy = ITEMS[trophyId];
      expect(trophy, `${trophyId} has no ItemDef`).toBeDefined();
      const consumedTrophyValue = trophy.sellValue * (line as { count: number }).count;
      expect(
        outputValue(recipe),
        `${recipe.id}: output ${outputValue(recipe)} must be above the consumed trophy value ` +
          `${consumedTrophyValue} (${trophyId} x${(line as { count: number }).count})`,
      ).toBeGreaterThan(consumedTrophyValue);
    }
  });

  it('every trophy row bills at its three pinned figures, and the sink verdicts hold', () => {
    // The 11l-OUT doctrine above is list-count-only by design (the listed
    // bill, never the discounted one), so the crafter's reward, the
    // specialization and self-signed discounts requiredReagentCountFor
    // composes, can and does take a bill under its output: six of the seven
    // floors below sit under the output (the lesser healing potion is the one
    // that does not), gold-positive at the floor and bounded by trophy supply.
    // THREE bills per row, each through requiredReagentCountFor (the function
    // the sim charges), specialized in the recipe's own craft, Jack excluded:
    // specOnly is specialization alone (no self-signed copy); floor is what
    // minAchievableInputValue describes (a self-signed copy of EVERY
    // reagent); reachable is a self-signed copy of exactly the reagents a
    // crafter's own gathering can sign. That last set is a LITERAL, because
    // only a node yield, a pristine specimen, or a corpse component whose
    // family carries no specimen can carry the crafter's own signature
    // (gathering.ts isSignableMaterialRarity; the corpse-harvest arms in
    // interaction.ts grant a specimen family's component PLAIN and sign the
    // specimen in its place, and sign the component itself only for a family
    // without one), and it is cross-checked below against the live
    // source tables (NODE_MATERIAL_TABLE, HARVEST_COMPONENT_ITEMS,
    // HARVEST_COMPONENT_SPECIMENS), so a trophy reagent that joins or leaves
    // a signable source moves a literal here. Row by row: the cinch (401)
    // and the belt (421) reach their floor exactly by one self-signed
    // pristine hide; the maul and the potion sit on it at specialization
    // alone; the quiver reaches 231 by a signed thorium ore, short of the
    // 196 floor, which also needs a signed trophy; the oiled boots reach
    // their floor of 51 exactly by one self-signed mudfin scale (Masterwrought
    // Phase 11m mapped gills to mudfin_scale with NO specimen row, so a gills
    // harvest signs the scale itself at rare-or-better, which is what turned
    // the scale from "a mob drop that never signs" into a signable source:
    // 56 reachable before 11m, 51 after); the pouch (51 against 36) never
    // reaches its floor, since the lines a signature would move are a
    // trophy, vendor staples, and the plain-granted hide and silk.
    // Each row's comment in src/sim/content/recipes.ts prints the same three
    // figures. This map does NOT assert any bill above the output; it makes
    // every figure VISIBLE as a literal, so a bill edit, a reagent re-price,
    // or a discount regression inside requiredReagentCountFor moves a number
    // someone has to re-derive (the recipe_sootscale_mantle precedent in THE
    // ECONOMY INVARIANT).
    const SIGNABLE_TROPHY_REAGENTS = new Set([
      'thorium_ore',
      'goldleaf_herb',
      'elderwood_log',
      'pristine_hide',
      'mudfin_scale',
    ]);
    const nodeYields = new Set(
      Object.values(NODE_MATERIAL_TABLE).flatMap((byZone) =>
        Object.values(byZone).map((row) => row.itemId),
      ),
    );
    const corpseComponents = new Set(Object.values(HARVEST_COMPONENT_ITEMS));
    const specimens = new Set(Object.values(HARVEST_COMPONENT_SPECIMENS));
    // A component whose family carries a specimen is granted PLAIN by the
    // corpse-harvest arms (src/sim/interaction.ts: the specimen enters the
    // signed grants in its place), so it can never carry the crafter's own
    // signature; the 11l QA corrected the predicate, whose earlier reading
    // (every component signable) called rough_hide and spider_silk signable.
    // This is a MODEL of the interaction.ts grant arms over the data tables,
    // not the arms themselves: the production behavior (a specimen family's
    // plain component stays unsigned, every family) is pinned in
    // tests/corpse_harvest_sim.test.ts, which is what would red if the arms
    // changed under this model.
    const plainGrantedComponents = new Set(
      Object.keys(HARVEST_COMPONENT_SPECIMENS).map((family) => {
        const component = (HARVEST_COMPONENT_ITEMS as Record<string, string | undefined>)[family];
        if (component === undefined) throw new Error(`specimen family ${family} has no component`);
        return component;
      }),
    );
    expect(plainGrantedComponents.has('rough_hide')).toBe(true);
    expect(plainGrantedComponents.has('spider_silk')).toBe(true);
    const inASignableSource = (itemId: string): boolean =>
      nodeYields.has(itemId) ||
      specimens.has(itemId) ||
      (corpseComponents.has(itemId) && !plainGrantedComponents.has(itemId));
    const trophyReagents = new Set(TROPHY_RECIPES.flatMap((r) => r.reagents.map((g) => g.itemId)));
    for (const itemId of SIGNABLE_TROPHY_REAGENTS) {
      expect(trophyReagents.has(itemId), `${itemId} sits on no trophy bill`).toBe(true);
      expect(inASignableSource(itemId), `${itemId} is in none of the signable sources`).toBe(true);
    }
    for (const itemId of trophyReagents) {
      if (SIGNABLE_TROPHY_REAGENTS.has(itemId)) continue;
      expect(inASignableSource(itemId), `${itemId} is signable but not in the literal set`).toBe(
        false,
      );
    }
    const billWith = (recipe: ProfessionRecipeRecord, signed: (itemId: string) => boolean) => {
      const specialized = { [recipe.professionId]: 125 };
      let total = 0;
      for (const reagent of recipe.reagents) {
        const { count } = requiredReagentCountFor(
          signed(reagent.itemId),
          reagent,
          specialized,
          recipe.professionId,
        );
        total += count * reagentUnitValue(reagent.itemId);
      }
      return total;
    };
    // The fourth figure, GATHERED, prices the specialization-only bill with
    // every signable line at its sellValue instead of the buyValue-first unit
    // value the doctrine uses (a crafter who mined the thorium and cut the
    // log never paid the counter price): the accounting under which the
    // trophy header's surplus rows are read, pinned so the maul (+278 after
    // the 40 sink) and the quiver (+164) sit on the maintainer's list as
    // numbers, not prose (the 11l QA).
    const gatheredBill = (recipe: ProfessionRecipeRecord): number => {
      const specialized = { [recipe.professionId]: 125 };
      let total = 0;
      for (const reagent of recipe.reagents) {
        const { count } = requiredReagentCountFor(false, reagent, specialized, recipe.professionId);
        const unit = SIGNABLE_TROPHY_REAGENTS.has(reagent.itemId)
          ? ITEMS[reagent.itemId].sellValue
          : reagentUnitValue(reagent.itemId);
        total += count * unit;
      }
      return total;
    };
    const TROPHY_BILLS: Record<
      string,
      { specOnly: number; floor: number; reachable: number; gathered: number }
    > = {
      // reachable 56 to 51 at Phase 11m: the signed mudfin scale takes the
      // scale line 4 to 3 before the specialization multiplier (3 x 0.75
      // floors to 2, against 3 unsigned), one scale at its 5-copper unit
      // value, which lands the reachable bill ON the floor. gathered stays
      // 56: the scale has no buyValue, so its unit value already IS its
      // sellValue and re-pricing it as gathered moves nothing.
      recipe_oiled_boots: { specOnly: 56, floor: 51, reachable: 51, gathered: 56 },
      recipe_gravewyrm_bone_quiver: { specOnly: 291, floor: 196, reachable: 231, gathered: 156 },
      recipe_fenshadow_maul: { specOnly: 222, floor: 222, reachable: 222, gathered: 102 },
      recipe_lesser_healing_potion: { specOnly: 77, floor: 77, reachable: 77, gathered: 32 },
      recipe_linen_pouch: { specOnly: 51, floor: 36, reachable: 51, gathered: 51 },
      recipe_wildgrove_cinch: { specOnly: 426, floor: 401, reachable: 401, gathered: 381 },
      recipe_cragprowl_belt: { specOnly: 446, floor: 421, reachable: 421, gathered: 401 },
    };
    expect(Object.keys(TROPHY_BILLS).sort()).toEqual(TROPHY_RECIPES.map((r) => r.id).sort());
    for (const [id, bills] of Object.entries(TROPHY_BILLS)) {
      const recipe = requireRecipe(id);
      expect(minAchievableInputValue(recipe), `${id} floor`).toBe(bills.floor);
      expect(
        billWith(recipe, () => false),
        `${id} specOnly`,
      ).toBe(bills.specOnly);
      expect(
        billWith(recipe, (itemId) => SIGNABLE_TROPHY_REAGENTS.has(itemId)),
        `${id} reachable`,
      ).toBe(bills.reachable);
      expect(gatheredBill(recipe), `${id} gathered`).toBe(bills.gathered);
    }
    // The #1301 gold sink, read from the constant crafting.ts
    // resolveCraftForRecipe charges (ceil(itemLevelBudget x
    // CRAFT_GOLD_SINK_COPPER_PER_BUDGET) copper per craft), lands on top of
    // every bill, and the trophy header's verdicts are pinned as literals
    // against it. At the floor plus the sink three rows pay out and three the
    // sink alone turns gold-negative (their floor sits under the output,
    // their floor plus sink at or above it); at the reachable bill plus the
    // sink two pay out. The potion never pays: its most permissive bill,
    // specialization alone with no sink, already sits above its output.
    // sinkFor restates the charge formula to price the verdicts; the charge
    // SITE is driven end to end by tests/professions_acquisition_salvage_sink
    // (the copper resolveCraftForRecipe deducts, pinned against the constant
    // and the budget), so this arm pins the formula's inputs, not the charge.
    const sinkFor = (recipe: ProfessionRecipeRecord): number =>
      Math.ceil(recipe.itemLevelBudget * CRAFT_GOLD_SINK_COPPER_PER_BUDGET);
    const SINK_BY_BUDGET: Record<number, number> = { 10: 20, 16: 32, 20: 40 };
    for (const recipe of TROPHY_RECIPES) {
      expect(sinkFor(recipe), `${recipe.id} sink`).toBe(SINK_BY_BUDGET[recipe.itemLevelBudget]);
    }
    const paysOutAt = (pick: (bills: { floor: number; reachable: number }) => number): string[] =>
      TROPHY_RECIPES.filter((r) => pick(TROPHY_BILLS[r.id]) + sinkFor(r) < outputValue(r))
        .map((r) => r.id)
        .sort();
    expect(paysOutAt((bills) => bills.floor)).toEqual([
      'recipe_fenshadow_maul',
      'recipe_gravewyrm_bone_quiver',
      'recipe_linen_pouch',
    ]);
    const sinkTurned = TROPHY_RECIPES.filter(
      (r) =>
        TROPHY_BILLS[r.id].floor < outputValue(r) &&
        TROPHY_BILLS[r.id].floor + sinkFor(r) >= outputValue(r),
    )
      .map((r) => r.id)
      .sort();
    expect(sinkTurned).toEqual([
      'recipe_cragprowl_belt',
      'recipe_oiled_boots',
      'recipe_wildgrove_cinch',
    ]);
    expect(paysOutAt((bills) => bills.reachable)).toEqual([
      'recipe_fenshadow_maul',
      'recipe_gravewyrm_bone_quiver',
    ]);
    expect(TROPHY_BILLS.recipe_lesser_healing_potion.specOnly).toBeGreaterThan(
      outputValue(requireRecipe('recipe_lesser_healing_potion')),
    );
    // The two surplus rows under gathered cost, less the sink, in order: the
    // maintainer's tuning reads (the trophy header), pinned as the numbers
    // the header prints so a bill or price edit moves them here first.
    const marginAtGathered = (id: string): number => {
      const recipe = requireRecipe(id);
      return outputValue(recipe) - TROPHY_BILLS[id].gathered - sinkFor(recipe);
    };
    const byGatheredMargin = TROPHY_RECIPES.map((r) => r.id).sort(
      (a, b) => marginAtGathered(b) - marginAtGathered(a),
    );
    expect(byGatheredMargin.slice(0, 2)).toEqual([
      'recipe_fenshadow_maul',
      'recipe_gravewyrm_bone_quiver',
    ]);
    expect(marginAtGathered('recipe_fenshadow_maul')).toBe(278);
    expect(marginAtGathered('recipe_gravewyrm_bone_quiver')).toBe(164);
  });

  it('no two recipes share a result item, and every trophy row is the one recipe for its output', () => {
    // recipeForResultItem is first-match-wins over ALL_RECIPES and its own
    // comment says no two recipes share a resultItemId today; the trophy rows
    // lean on that (each 11l-OUT comment claims "no prior recipe crafts" the
    // output), so the claim is pinned globally and then per trophy row. The
    // two non-vacuity guards keep an emptied list from passing the sweep.
    expect(ALL_RECIPES.length).toBeGreaterThan(0);
    expect(TROPHY_RECIPES.length).toBeGreaterThan(0);
    const recipesByResult = new Map<string, string[]>();
    for (const recipe of ALL_RECIPES) {
      recipesByResult.set(recipe.resultItemId, [
        ...(recipesByResult.get(recipe.resultItemId) ?? []),
        recipe.id,
      ]);
    }
    const shared = [...recipesByResult.entries()].filter(([, ids]) => ids.length > 1);
    expect(shared).toEqual([]);
    for (const recipe of TROPHY_RECIPES) {
      expect(recipeForResultItem(recipe.resultItemId)?.id, recipe.resultItemId).toBe(recipe.id);
    }
  });

  it('every intermediate row holds the R13 rung shape, and the nine consume exactly one catalyst', () => {
    // Per-row pins for the Phase 07 ledger contract (review round): the
    // affinity consumer-set pin only proves catalyst PRESENCE, so a row
    // asking for five catalysts, or slipping off the 75 rung, would
    // otherwise stay green.
    for (const recipe of INTERMEDIATE_RECIPES) {
      expect(recipe.skillReq, recipe.id).toBe(75);
      expect(recipe.itemLevelBudget, recipe.id).toBe(20);
      expect(recipe.level, recipe.id).toBe(20);
      expect(recipe.resultCount, recipe.id).toBe(1);
      expect(recipe.acquisition, recipe.id).toEqual(['trainer']);
      const catalyst = recipe.reagents.filter((r) => r.itemId === 'quickening_catalyst');
      if (recipe.id === 'recipe_quickening_catalyst') {
        expect(catalyst, recipe.id).toEqual([]);
        expect(recipe.oncePerDay, recipe.id).toBe(true);
      } else {
        expect(catalyst, recipe.id).toEqual([{ itemId: 'quickening_catalyst', count: 1 }]);
        expect(recipe.oncePerDay, recipe.id).toBeUndefined();
      }
    }
  });

  it('every intermediate row consumes its exact authored reagent bill (the literal table)', () => {
    // The QA decisiveness probe: retuning a GATHERED reagent count (say the
    // billet's thorium 3 -> 2) kept every sim-side suite green and redded
    // only the wiki freshness mirror. The jewelcrafting precedent (phase 05
    // probe f): a full literal table, so any quantity retune is a deliberate
    // edit HERE, never a drive-by.
    const bills: Record<string, { itemId: string; count: number }[]> = {
      recipe_quickening_catalyst: [
        { itemId: 'sunpetal_herb', count: 1 },
        { itemId: 'goldleaf_herb', count: 2 },
        { itemId: 'venom_gland', count: 2 },
        { itemId: 'glass_vial', count: 1 },
      ],
      recipe_duskforged_billet: [
        { itemId: 'thorium_ore', count: 3 },
        { itemId: 'iron_ore', count: 2 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
      recipe_forgefold_plating: [
        { itemId: 'thorium_ore', count: 3 },
        { itemId: 'iron_ore', count: 2 },
        { itemId: 'rough_hide', count: 2 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
      recipe_wyrmhide_cording: [
        { itemId: 'pristine_hide', count: 1 },
        { itemId: 'rough_hide', count: 4 },
        { itemId: 'spider_silk', count: 2 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
      recipe_sunspun_bolt: [
        { itemId: 'sunpetal_herb', count: 1 },
        { itemId: 'spider_silk', count: 4 },
        { itemId: 'pristine_silk', count: 1 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
      recipe_prismglass_setting: [
        { itemId: 'thorium_ore', count: 2 },
        { itemId: 'arcane_essence', count: 2 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
      recipe_precision_chassis: [
        { itemId: 'ashwood_log', count: 2 },
        { itemId: 'thorium_ore', count: 2 },
        { itemId: 'quickening_catalyst', count: 1 },
        // ADDED at masterwrought Phase 11o (qr-11o-ENG, R18
        // add-never-substitute): the skill-0 cogwheel joins the bill, every
        // original row intact.
        { itemId: 'cogwheel_blank', count: 1 },
      ],
      // THE ONE INTERMEDIATE THAT IS NOT A GEAR INTERMEDIATE, and Phase 11g's
      // choke point (masterwrought DECISION C). The two tier-2 vegetables enter
      // at the salt's count of 2, one below the meat count of 3, so the bill
      // reads meat, then vegetables, then salt. Recomputed from the merged
      // ALL_RECIPES rather than patched to match: input 98 to 130 against an
      // output of 30, so the row stays gold-negative and widens.
      recipe_seasoned_stock: [
        { itemId: 'prime_cut', count: 1 },
        { itemId: 'game_meat', count: 3 },
        { itemId: 'marsh_rice', count: 2 },
        { itemId: 'bog_beet', count: 2 },
        { itemId: 'cooking_salt', count: 2 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
      recipe_lucent_reagent: [
        { itemId: 'arcane_essence', count: 3 },
        { itemId: 'arcane_dust', count: 4 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
      recipe_sablewax_vellum: [
        { itemId: 'sunpetal_herb', count: 1 },
        { itemId: 'arcane_essence', count: 2 },
        { itemId: 'glass_vial', count: 1 },
        { itemId: 'quickening_catalyst', count: 1 },
      ],
    };
    expect(INTERMEDIATE_RECIPES.map((r) => r.id).sort()).toEqual(Object.keys(bills).sort());
    for (const recipe of INTERMEDIATE_RECIPES) {
      expect(recipe.reagents, recipe.id).toEqual(bills[recipe.id]);
    }
  });

  it('the three station-free combo recipes resolve a home via professionId, not stationType', () => {
    for (const recipe of COMBO_RECIPES) {
      // Combos deliberately carry NO stationType field (field-craftable, pair-gated).
      expect(recipe.stationType, `${recipe.id} should have no stationType`).toBeUndefined();
      const type = stationTypeForCraft(recipe.professionId);
      expect(type, `${recipe.id}: combo home unresolved`).toBeDefined();
      expect(stationsOfType(STATIONS, type as NonNullable<typeof type>).length).toBeGreaterThan(0);
    }
  });

  it('every recipe stationType is a real runtime StationType with a placed station', () => {
    for (const recipe of ALL_RECIPES) {
      if (!recipe.stationType) continue;
      expect(
        RUNTIME_STATION_TYPES.has(recipe.stationType),
        `${recipe.id}: stationType ${recipe.stationType} is not a runtime StationType`,
      ).toBe(true);
      expect(
        stationsOfType(STATIONS, recipe.stationType).length,
        `${recipe.id}: ${recipe.stationType}`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('MATERIAL DEMAND COVERAGE', () => {
  // Every gathered/harvested/vendor material Phases 4 and 10 introduced must be
  // consumed by at least one recipe, so no supply node produces a dead good.
  // The corpse-harvest families closed later ride the same pin: wolf_fang
  // (Phase 15) and the #2905 claw/tusk trio, so HARVEST_MATERIALS and SPECIMENS
  // now list every HARVEST_COMPONENT_ITEMS / HARVEST_COMPONENT_SPECIMENS value.
  const NODE_YIELDS = [
    'copper_ore',
    'iron_ore',
    'thorium_ore',
    'ironbark_log',
    'ashwood_log',
    'elderwood_log',
    'silverleaf_herb',
    'goldleaf_herb',
    'sunpetal_herb',
  ];
  // Nine DISTINCT ids behind ten families since Masterwrought Phase 11m:
  // horn reuses curved_tusk (the same hard keratin as tusk) and gills feeds
  // mudfin_scale, the trophy 11l promoted out of quality 'poor'; neither row
  // minted an item id, which is why the pin below dedupes the live values.
  const HARVEST_MATERIALS = [
    'rough_hide',
    'wolf_fang',
    'spider_silk',
    'venom_gland',
    'game_meat',
    'homespun_cloth',
    'sharp_claw',
    'curved_tusk',
    'mudfin_scale',
  ];
  const SPECIMENS = [
    'pristine_hide',
    'pristine_silk',
    'pristine_venom_gland',
    'prime_cut',
    'pristine_claw',
  ];
  const VENDOR_REAGENTS = [
    'smithing_flux',
    'spool_of_thread',
    'tanning_agent',
    'cooking_salt',
    'glass_vial',
  ];
  const RAW_FISH = [
    'raw_river_perch',
    'raw_marsh_pike',
    'raw_bog_eel',
    'raw_frostgill_trout',
    'raw_stonescale_carp',
    'raw_mirror_trout',
  ];

  const allReagentIds = new Set<string>();
  for (const recipe of ALL_RECIPES) {
    for (const reagent of recipe.reagents) allReagentIds.add(reagent.itemId);
  }

  it('pins the nine node yields to the live NODE_MATERIAL_TABLE (literal list cannot rot)', () => {
    const liveYields = new Set<string>();
    for (const byZone of Object.values(NODE_MATERIAL_TABLE)) {
      for (const row of Object.values(byZone)) liveYields.add(row.itemId);
    }
    expect([...liveYields].sort()).toEqual([...NODE_YIELDS].sort());
  });

  it('pins the harvest material and specimen literals to the live component tables', () => {
    // Same anti-rot arm as the node yields above: the next harvest family
    // must join these lists (and so the consumed-by-a-recipe sweep below), not
    // drift past them the way #2905's claw/tusk trio originally shipped. The
    // live side is deduped because two families may share one id (horn and
    // tusk both feed curved_tusk since Phase 11m): the sweep is over ITEMS a
    // recipe must consume, and an id is consumed or not however many
    // families grant it. The family count is pinned beside it so the dedupe
    // cannot hide a dropped row.
    expect([...HARVEST_MATERIALS].sort()).toEqual(
      [...new Set(Object.values(HARVEST_COMPONENT_ITEMS))].sort(),
    );
    expect(Object.keys(HARVEST_COMPONENT_ITEMS)).toHaveLength(10);
    expect([...SPECIMENS].sort()).toEqual(Object.values(HARVEST_COMPONENT_SPECIMENS).sort());
  });

  it('every material, specimen, and vendor reagent is consumed by at least one recipe', () => {
    for (const id of [...NODE_YIELDS, ...HARVEST_MATERIALS, ...SPECIMENS, ...VENDOR_REAGENTS]) {
      expect(allReagentIds.has(id), `${id} is never consumed by any recipe`).toBe(true);
    }
  });

  it('every raw fish is consumed by at least one cooking recipe', () => {
    const cookingReagents = new Set<string>();
    for (const recipe of ALL_RECIPES) {
      if (recipe.professionId !== 'cooking') continue;
      for (const reagent of recipe.reagents) cookingReagents.add(reagent.itemId);
    }
    for (const fish of RAW_FISH) {
      expect(cookingReagents.has(fish), `${fish} is never cooked`).toBe(true);
    }
  });
});

describe('LADDER SHAPE PINS', () => {
  const LADDER_CRAFTS = [
    'weaponcrafting',
    'armorcrafting',
    'tailoring',
    'leatherworking',
    'cooking',
    'alchemy',
  ];
  const QUALITY_BY_RUNG: Record<number, string> = { 0: 'common', 25: 'uncommon', 50: 'rare' };

  // Material bands (ladder design): a rung-50 (rare) recipe must not be
  // craftable from ONLY the top rare-band inputs; it must still consume something
  // below that tier so the low/mid gathering economy keeps its demand. The
  // rare-band is the tier-3 gathered materials, the glyphsteel bar, and the rare
  // specimens. NOTE the check is phrased as "not solely rare-band" rather than
  // "contains a low/mid material": recipe_anglers_feast_platter (a shipped rung-50
  // cooking recipe) consumes only mid-tier fish, sunpetal_herb, and cooking_salt,
  // none of which sit in the explicit low/mid lists, yet it is clearly not an
  // all-rare recipe. The low/mid lists are retained as documented lower tiers and
  // pinned disjoint from the rare-band.
  const LOW_BAND = new Set([
    'copper_ore',
    'ironbark_log',
    'silverleaf_herb',
    'rough_hide',
    'wolf_fang',
    'spider_silk',
    'venom_gland',
    'game_meat',
    'homespun_cloth',
    'sharp_claw',
    'curved_tusk',
    'linen_scrap',
    'bone_fragments',
    'spider_leg',
  ]);
  const MID_BAND = new Set(['iron_ore', 'ashwood_log', 'goldleaf_herb']);
  const RARE_BAND = new Set([
    'thorium_ore',
    'elderwood_log',
    'sunpetal_herb',
    'arcanite_bar',
    'pristine_hide',
    'pristine_silk',
    'pristine_venom_gland',
    'prime_cut',
    'pristine_claw',
  ]);

  function isConsumable(itemId: string): boolean {
    const def = ITEMS[itemId];
    return (
      def != null &&
      (def.foodHp != null ||
        def.potionHp != null ||
        def.potionMana != null ||
        def.elixir != null ||
        def.use != null)
    );
  }

  it('every ladder recipe has the fixed shape (trainer, station, rung, quality)', () => {
    for (const recipe of LADDER_RECIPES) {
      expect(recipe.acquisition, `${recipe.id} acquisition`).toEqual(['trainer']);
      expect(recipe.stationType, `${recipe.id} stationType`).toBeDefined();
      expect([0, 25, 50], `${recipe.id} skillReq`).toContain(recipe.skillReq);
      const def = ITEMS[recipe.resultItemId];
      expect(def, `${recipe.id} result`).toBeDefined();
      expect(def.quality, `${recipe.id} result quality for rung ${recipe.skillReq}`).toBe(
        QUALITY_BY_RUNG[recipe.skillReq],
      );
    }
  });

  it('each of the six ladder crafts has exactly 9 recipes, 3 per rung', () => {
    for (const craft of LADDER_CRAFTS) {
      const forCraft = LADDER_RECIPES.filter((r) => r.professionId === craft);
      expect(forCraft.length, `${craft} ladder recipe count`).toBe(9);
      for (const rung of [0, 25, 50]) {
        const atRung = forCraft.filter((r) => r.skillReq === rung);
        expect(atRung.length, `${craft} rung ${rung}`).toBe(3);
      }
    }
    // No stray ladder craft outside the six.
    expect(new Set(LADDER_RECIPES.map((r) => r.professionId))).toEqual(new Set(LADDER_CRAFTS));
    expect(LADDER_RECIPES.length).toBe(54);
  });

  it('the three material bands are pairwise disjoint', () => {
    for (const id of LOW_BAND) expect(MID_BAND.has(id) || RARE_BAND.has(id)).toBe(false);
    for (const id of MID_BAND) expect(RARE_BAND.has(id)).toBe(false);
  });

  it('every rung-50 ladder recipe consumes at least one non-rare-band material', () => {
    for (const recipe of LADDER_RECIPES) {
      if (recipe.skillReq !== 50) continue;
      const hasLower = recipe.reagents.some((r) => !RARE_BAND.has(r.itemId));
      expect(
        hasLower,
        `${recipe.id} (rare) consumes only rare-band inputs: ${recipe.reagents.map((r) => r.itemId).join(', ')}`,
      ).toBe(true);
    }
  });

  it('cooking and alchemy have a consumable output at every rung', () => {
    for (const craft of ['cooking', 'alchemy']) {
      for (const rung of [0, 25, 50]) {
        const consumables = LADDER_RECIPES.filter(
          (r) => r.professionId === craft && r.skillReq === rung && isConsumable(r.resultItemId),
        );
        expect(consumables.length, `${craft} rung ${rung} consumable output`).toBeGreaterThan(0);
      }
    }
  });
});
