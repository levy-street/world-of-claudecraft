// ---------------------------------------------------------------------------
// THE GATHERING SUPPLY COVERAGE INVARIANT (masterwrought R20 and R21)
// ---------------------------------------------------------------------------
//
// The rule, stated once so a contributor can act on a red here:
//
//   EVERY GATHERING FAMILY MUST FEED THE CRAFTS AT EVERY BAND. A gathering
//   profession that supplies nothing at some 25-point skill band is a
//   profession a player levelling through that band has no reason to have
//   taken, and the hole is invisible until someone plays it.
//
// masterwrought R20 (docs/design/professions.md) is the supply half: every
// family appears in at
// least one recipe in every band below the gathering cap, AND in at least one
// endgame recipe at or above it. masterwrought R21 is the demand half: every
// id a family supplies has at least one consumer somewhere in the merged
// reagent corpus.
//
// WHY "masterwrought R20" IS WRITTEN OUT IN FULL EVERYWHERE IN THIS FILE:
// docs/design/professions.md and shipped source already cite a DIFFERENT R
// series, Professions 2.0, which has its own R19, R20 and R22. A bare "R20"
// in a failure message would point a reader at the wrong ruling.
//
// THE FLOOR IS PRESENCE AND NOWHERE ELSE (masterwrought decision E, settled
// 2026-08-20). No COVERAGE arm in this file asserts a count of bills. Zero is a
// structural fact; everything above zero is a balance number nobody measured,
// and a numeric floor would turn a correctness guard into a content quota that
// passes on padding. The per-band and per-material counts remain available as
// a judgment surface instead.
//
// THE CARVE-OUT, written into the ruling rather than left for a reader to trip
// over (masterwrought Phase 11j QA). The anti-vacuity block at the bottom DOES
// carry exact counts: family supply-set sizes, the farming crop total, and
// farming's endgame cell at 12. Those are not floors on content, they are
// SUBJECT-SIZE pins: what they guard is that the coverage arms above ran over
// the population they claim to, and a token `> 0` in their place is the trap
// tests/CLAUDE.md names. Decision E governs what the coverage arms demand of
// the CONTENT; it says nothing about pinning the subject. Do not delete those
// literals to restore the sentence above.
//
// THE SUPPLY ARM COUNTS DIRECT REAGENTS ONLY, and the refusal is deliberate.
// Transitive credit through an intermediate is NOT counted: if a band-75 row
// could satisfy every band above it by feeding an intermediate that feeds the
// rest, one reagent would satisfy the whole ladder and this guard would be
// decorative.
//
// THE DEMAND ARM IS DIFFERENT, and the asymmetry is the point rather than an
// inconsistency. It asks whether a material can be SPENT at all, so it credits
// downward grade substitution, which is a shipped consumption path and not a
// transitive chain (see consumptionIdsFor below). Counting only direct naming
// there would report the eastbrook fine grades as dead content when they are
// spendable on every recipe naming their base.
//
// WHAT THE DEMAND ARM UNIQUELY COVERS, stated honestly because the credit
// narrows it. For the nine fine NODE grades the arm is now structurally
// subsumed: it can only red in a state where tests/recipe_economy.test.ts has
// already redded, since that file asserts every one of the nine BASE yields
// has a consumer and anti-rot pins its list against NODE_MATERIAL_TABLE. The
// same goes for the corpse components and the farm ids, which farm_recipes
// covers. What is left over, and the reason this arm earns its place rather
// than restating a neighbour, is the CATCHES: recipe_economy's RAW_FISH needle
// list has no anti-rot pin against its live table (nor does its
// VENDOR_REAGENTS list; only NODE_YIELDS, HARVEST_MATERIALS and SPECIMENS
// carry one), so the four catches added since it was written (glimmerfin_koi,
// raw_deepbarb_catfish, raw_hollowgill_sturgeon, raw_stillmere_salmon) are
// covered HERE and nowhere else. Pinning RAW_FISH against
// FISHING_TABLES_BY_BAND would be the durable fix and belongs to whoever owns
// that file.
//
// AND THE FAMILY-SCOPED ARM SCANS TWO MECHANISMS, NOT ALL OF THEM. It walks
// ALL_RECIPES and ENCHANTS, which is the shipped reagent union, and QUEST
// turn-ins are a third real consumption channel it does not see:
// q_prof_workorder_forge collects copper_ore, and quest_commands.ts routes
// collection through the same planGradeRemoval the crafts use. Stating that
// here rather than leaving it implied, because a census scoped to one
// mechanism and reported as consumption in general is exactly the defect that
// forced this arm's own substitution fix, one mechanism over.
//
// The omission is SAFE IN THE ONE DIRECTION THAT MATTERS: an unscanned
// consumer can only make the arm report an orphan that is not one, a false
// RED that a human resolves, never a false green that hides a dead material.
// The family-scoped arm keeps that two-mechanism scope and its pins untouched.
// The MATERIAL-WIDE presence arm beside it is the one that took the trade the
// other way: it covers every
// id in MATERIAL_ITEM_IDS, so it walks the WIDE demand index (wideDemandIndex
// below: recipes, enchants, quest collect objectives, the farming verbs, and
// the same substitution credit), because over the whole material set the
// farming inputs (seeds, compost, the growth tonic, withered husks) have NO
// recipe or enchant consumer at all and the narrow index would red every one
// of them as dead content that a farmer spends daily.
//
// THE ONE EXEMPTION THE MATERIAL-WIDE ARM CARRIES, named and dated here
// rather than left silent (added 2026-08-31, at the release/v0.42.0 sync).
// release/v0.42.0 commit c173606bbb classified lastflame_core, the Crucible
// of the Last Spring core reagent, as a material: it derives IN through a
// source this branch had never seen, CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS
// in src/sim/content/crucible_professions.ts, whose whole written contract is
// "materials staged before their consuming recipes ship. Remove an id from
// this list once a live recipe names it". The maintainer's staging call is
// that the reagent drops ahead of its professions fast-follow (PR 3704, which
// spends it 3, 6 and 15 per craft), so the consumers exist, on another branch.
// This arm therefore skips exactly the ids on that LIVE list and not one more,
// and it pays for the skip twice: the number of ids it skipped is pinned at
// its literal, and the arm below it requires every skipped id to have ZERO
// consumers under the wide index. That pairing is what makes the exemption
// SELF-RETIRING rather than a hole. The moment a live recipe names the core,
// the zero-consumer arm reds, the reader takes the id off the pending list as
// that list's own contract instructs, and it lands straight back under the
// presence floor. Growth is fenced from the other side too, since
// tests/material_taxonomy.test.ts pins the exact members of
// MATERIAL_ITEM_IDS, so a second staged material cannot arrive unread.
//
// WHAT THE EXEMPTION DOES NOT DO is relax the floor for anything that was
// ever subject to it. The sync added exactly one id to the material set, 116
// to 117 (recorded at tests/material_taxonomy_bootstrap.test.ts), so every id
// this arm covered before the sync still owes its consumer, and the tree now
// carries MORE assertions about the material set than it did before, not
// fewer. The shape is not invented here either: the release's own consumer
// census, tests/material_profession_affinity.test.ts, already pairs this same
// skip with this same positive arm on this same live list, so the two
// censuses on the merged tree agree about what a staged material is.
// The staged-reagent exception remains limited to the live pending list; once
// a consumer lands, the self-retiring checks below require the id to rejoin the
// ordinary presence floor.
//
// EVERY DERIVATION READS THE LIVE TABLES: the subject list comes from
// GATHERING_PROFESSION_IDS, the supply sets come from the content tables the
// engine itself reads, and the band math comes from wheel.ts tierForSkill.
//
// AND EVERY DERIVATION CARRIES A LITERAL BESIDE IT, which is the opposite of
// what this paragraph said before masterwrought Phase 11j's review round and
// is worth stating plainly because the earlier wording is what let four
// constant-self-comparisons ship here. A derivation alone cannot fail: delete
// a profession, a crop or a node row and both sides of a purely derived
// assertion move together. So the id lists at the subject-list, self-feeding,
// substitution and supply-size arms ARE hand-written, deliberately, and
// TIER_SKILL_STEP is pinned at its literal 25 rather than only referenced.
// A TIER_SKILL_STEP change therefore REDS this file rather than silently
// following the game, which is the behavior wanted: the bucket width is a
// shared contract, and moving it should force a reader through this file.
//
// NOT A SECOND COPY OF tests/recipe_economy.test.ts. That file asserts every
// material has at least one consumer SOMEWHERE. This file is the band-aware
// strengthening, and it lives in its own file so that file's two sorted
// literals stay untouched by it.

import { describe, expect, it } from 'vitest';
import { CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS } from '../src/sim/content/crucible_professions';
import { ENCHANTS } from '../src/sim/content/enchants';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import type { GatheringProfessionId } from '../src/sim/content/professions';
import { GATHERING_PROFESSION_IDS, GATHERING_PROFESSIONS } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS, QUESTS } from '../src/sim/data';
import { MATERIAL_ITEM_IDS } from '../src/sim/material_taxonomy';
import { eligibleWatchFeeItemIds } from '../src/sim/professions/farm_watch_fee';
import {
  FARM_COMPOST_ITEM_ID,
  FARM_GROWTH_TONIC_ITEM_ID,
  FARM_WITHERED_HUSK_ITEM_ID,
} from '../src/sim/professions/farming';
import { NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import {
  CORPSE_HARVEST_FAMILY,
  gatheringSupplyByFamily,
} from '../src/sim/professions/gathering_supply';
import { baseMaterialFor, MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import { gatherToolTier } from '../src/sim/professions/tools';
import { TIER_SKILL_STEP, tierForSkill } from '../src/sim/professions/wheel';

// THE SUPPLY DERIVATION MOVED OUT AT masterwrought Phase 11k, and the move is
// why this file no longer carries it. The provisioning wiki page became a
// SECOND reader of "which line supplies which material", and a page built on a
// second implementation could tell a player one thing while this guard asserted
// another, with both green. So the whole derivation is now the pure leaf
// src/sim/professions/gathering_supply.ts and both sides import it. Nothing
// about the rule changed: the functions there have the bodies they had here,
// and every literal below still pins the ANSWER rather than the code.
//
// The sixth family (masterwrought decision C) travelled with them: corpse
// harvesting is a gathering FAMILY without being a gathering PROFESSION, so it
// has no id in GATHERING_PROFESSION_IDS but is bound here with the other five.

/**
 * The band a recipe sits in. This is the shared 25-point bucket math the whole
 * codebase uses (a player's capability tier and a recipe's tier are directly
 * comparable through it), NOT a local re-derivation.
 */
function bandOf(skillReq: number): number {
  return tierForSkill(skillReq);
}

/**
 * The skill at which a gathering ladder is finished, read off the live
 * profession records rather than typed. Every land gathering profession caps
 * here; fishing's counter runs past it, which is why this is a max over the
 * LAND caps and not over all five (a fishing-driven 200 would declare four
 * empty bands nothing in the game can fill).
 */
const GATHERING_ENDGAME_SKILL = Math.max(
  ...GATHERING_PROFESSION_IDS.filter((id) => id !== 'fishing').map(
    (id) => GATHERING_PROFESSIONS[id].maxSkill,
  ),
);

/** The first band that counts as endgame, derived through the same bucket. */
const ENDGAME_BAND = bandOf(GATHERING_ENDGAME_SKILL);

/** The bands strictly below the endgame, each of which every family must feed. */
const LEVELLING_BANDS = Array.from({ length: ENDGAME_BAND }, (_, i) => i);

const supplyByFamily = gatheringSupplyByFamily;

const SUPPLY = supplyByFamily();
const FAMILY_IDS = [...SUPPLY.keys()];

/**
 * masterwrought decision D, the self-feeding refusal, resolved through the
 * item's OWN use record and never a hand-written exclusion list: an endgame
 * recipe whose result is a gathering tool of the very family being credited
 * does not prove that family feeds the crafts. It proves the family feeds
 * ITSELF. On the pre-11i tree this bit exactly one family, fishing, whose
 * entire endgame contribution was a fishing rod, and that one measured hit is
 * what shows the arm is calibrated rather than decorative.
 *
 * Corpse harvesting has no tool of its own, so the refusal is structurally
 * inert for that family; the anti-vacuity arm below proves the DISCRIMINATOR
 * is still live rather than assuming it.
 */
function isSelfFeedingFor(resultItemId: string, family: string): boolean {
  if (family === CORPSE_HARVEST_FAMILY) return false;
  return gatherToolTier(ITEMS[resultItemId], family as GatheringProfessionId) !== undefined;
}

/** Every direct reagent id of a recipe. */
function reagentIdsOf(recipe: (typeof ALL_RECIPES)[number]): string[] {
  return recipe.reagents.map((r) => r.itemId);
}

/** The item a recipe id produces. The matrix stores recipe ids, and the
 *  levelling-band tripwire needs the RESULT to ask isSelfFeedingFor. */
function resultOf(recipeId: string): string {
  const recipe = ALL_RECIPES.find((r) => r.id === recipeId);
  if (recipe === undefined) throw new Error(`no recipe ${recipeId}`);
  return recipe.resultItemId;
}

/**
 * WHAT THE REFUSAL ACTUALLY DROPPED, recorded by the matrix as it builds
 * rather than re-derived beside it (masterwrought Phase 11j QA). The arm that
 * pins this reads THIS list, so it is a statement about the run that produced
 * the matrix and not a second implementation of the same rule that could agree
 * with a broken one.
 *
 * It exists because the outcome pin below it covered ONE family. Narrowing the
 * refusal to `family === 'farming'` inside the loop below left every arm in
 * this file green while mining, logging, herbalism and fishing were each
 * credited at the endgame band by their own tool, which is the exact thing
 * masterwrought decision D refuses. Proven by mutation: that narrowing now
 * reds here.
 */
const REFUSED_ENDGAME_ROWS: string[] = [];

/** The per-family, per-band count of qualifying recipes: the audit matrix. */
function bandMatrix(): Map<string, Map<number, string[]>> {
  // Reset FIRST, so a second call cannot double the refused list. It is called
  // exactly once today (MATRIX, at module scope) and the pin below would fail
  // loudly rather than silently on a second call, but a guard whose own
  // bookkeeping depends on being invoked once is a trap for whoever extends it.
  REFUSED_ENDGAME_ROWS.length = 0;
  const matrix = new Map<string, Map<number, string[]>>();
  for (const family of FAMILY_IDS) {
    const ids = SUPPLY.get(family) as Set<string>;
    const perBand = new Map<number, string[]>();
    for (const band of [...LEVELLING_BANDS, ENDGAME_BAND]) perBand.set(band, []);
    for (const recipe of ALL_RECIPES) {
      const band = Math.min(bandOf(recipe.skillReq ?? 0), ENDGAME_BAND);
      if (!reagentIdsOf(recipe).some((id) => ids.has(id))) continue;
      if (band === ENDGAME_BAND && isSelfFeedingFor(recipe.resultItemId, family)) {
        REFUSED_ENDGAME_ROWS.push(`${family}:${recipe.id}`);
        continue;
      }
      (perBand.get(band) as string[]).push(recipe.id);
    }
    matrix.set(family, perBand);
  }
  return matrix;
}

/**
 * DOWNWARD SUBSTITUTION IS A CONSUMPTION PATH, and leaving it out is the exact
 * error this arm exists to prevent, one mechanism over from the one the worked
 * example records.
 *
 * `material_grades.ts` states the rule and `planGradeRemoval` implements it: a
 * FINE grade satisfies any requirement for its BASE (the base never satisfies
 * a requirement for the fine grade). So a fine grade no recipe NAMES is still
 * spendable on every recipe that names its base, and calling it a material
 * with no consumer would be false. `craftIdsForMaterialItem`
 * (src/sim/material_profession_affinity.ts) credits the same substitution when
 * it tells a player which crafts use a material, so the two surfaces agree.
 *
 * This matters on the shipped tree rather than hypothetically: the three
 * EASTBROOK fine grades (fine_copper_ore, fine_ironbark_log,
 * fine_silverleaf_herb) are named by no recipe at all, because the crafted
 * land-tool ladder starts at rung 4 and the "tier N takes the fine grade of
 * tier N minus 2" rule never reaches down to them. A direct-naming-only census
 * reports them as dead content. They are not: they substitute downward into
 * every base-consuming recipe and they vendor at twice the base, which is the
 * whole reward the fine axis pays.
 */
function consumptionIdsFor(itemId: string): string[] {
  const base = baseMaterialFor(itemId);
  return base === undefined ? [itemId] : [itemId, base];
}

/** The consumers of each id, over ALL reagent sources on the tree.
 *
 *  CONSUMERS ONLY. This used to accumulate a `units` total beside them and
 *  nothing ever read it. Unit counts are tuning data rather than a correctness
 *  contract. A field the guard computes on every run and
 *  never asserts is dead code that reads like coverage (masterwrought Phase
 *  11j QA). */
function demandIndex(): Map<string, { consumers: string[] }> {
  const demand = new Map<string, { consumers: string[] }>();
  const note = (itemId: string, source: string) => {
    const row = demand.get(itemId) ?? { consumers: [] };
    row.consumers.push(source);
    demand.set(itemId, row);
  };
  for (const recipe of ALL_RECIPES) {
    for (const reagent of recipe.reagents) note(reagent.itemId, recipe.id);
  }
  // src/sim/content/enchants.ts IS a reagent source and it is the one a
  // hand-scoped census misses: the census that once called arcane_shard a
  // dead-end rung scanned content/recipes.ts alone and missed ten more
  // consumer rows here. Scoping a demand scan to one file is the exact error
  // this arm exists to make impossible.
  for (const enchant of Object.values(ENCHANTS)) {
    for (const reagent of enchant.reagents) note(reagent.itemId, enchant.id);
  }
  return demand;
}

/**
 * THE WIDE DEMAND INDEX:
 * every spend mechanism the tree has, for the MATERIAL-WIDE presence arm.
 * Starts from demandIndex() (recipes and enchants, unchanged) and adds:
 *
 *  - QUEST collect objectives (QUESTS, objectives of type 'collect'):
 *    quest_commands.ts removes the collected items at turn-in through the same
 *    planGradeRemoval the crafts use.
 *  - THE FARMING VERBS, each cited at its spend site in
 *    src/sim/professions/farming.ts, with the ids IMPORTED from the module
 *    the engine spends them through, never re-typed:
 *      plantCrop spends the crop's seedItemId (removeUnlockedFromSlots of
 *        crop.seedItemId, one per plant), the compost knob spends
 *        FARM_COMPOST_ITEM_ID, the tonic knob spends FARM_GROWTH_TONIC_ITEM_ID,
 *        and the watch knob spends its FEE in produce, planned by planWatchFee
 *        over eligibleWatchFeeItemIds(crop.tier) (farm_watch_fee.ts) and
 *        removed leg by leg in the same payment block;
 *      convertHusks spends FARM_WITHERED_HUSK_ITEM_ID at FARM_HUSKS_PER_COMPOST
 *        per compost minted.
 *  - DOWNWARD GRADE SUBSTITUTION, credited at lookup time through the same
 *    consumptionIdsFor the family arm uses (a fine grade is spendable on
 *    every consumer of its base).
 *
 * WHICH DIRECTION AN OMISSION FAILS: a mechanism this index does not walk can
 * only leave a real consumer uncounted, so the presence arm reds on a
 * material that is in fact spent (a FALSE RED a human resolves by adding the
 * mechanism here). It can never turn a dead material green. The mechanism
 * list is data (WIDE_DEMAND_MECHANISMS) so the failure message names exactly
 * what was walked.
 */
const WIDE_DEMAND_MECHANISMS = [
  'recipe reagents (ALL_RECIPES)',
  'enchant reagents (ENCHANTS)',
  'quest collect objectives (QUESTS, type collect)',
  'farming verbs (plantCrop: seed, compost knob, tonic knob, watch fee produce; convertHusks: husks)',
  'downward grade substitution (consumptionIdsFor)',
] as const;

function wideDemandIndex(): Map<string, { consumers: string[] }> {
  const demand = demandIndex();
  const note = (itemId: string, source: string) => {
    const row = demand.get(itemId) ?? { consumers: [] };
    row.consumers.push(source);
    demand.set(itemId, row);
  };
  for (const quest of Object.values(QUESTS)) {
    for (const objective of quest.objectives) {
      if (objective.type === 'collect') note(objective.itemId, `quest:${quest.id}`);
    }
  }
  const cropTiers = new Set<number>();
  for (const crop of Object.values(FARM_CROPS)) {
    note(crop.seedItemId, `farming:plantCrop:seed:${crop.id}`);
    cropTiers.add(crop.tier);
  }
  note(FARM_COMPOST_ITEM_ID, 'farming:plantCrop:compost');
  note(FARM_GROWTH_TONIC_ITEM_ID, 'farming:plantCrop:tonic');
  for (const tier of [...cropTiers].sort((a, b) => a - b)) {
    for (const itemId of eligibleWatchFeeItemIds(tier)) {
      note(itemId, `farming:plantCrop:watchFee:tier${tier}`);
    }
  }
  note(FARM_WITHERED_HUSK_ITEM_ID, 'farming:convertHusks');
  return demand;
}

const MATRIX = bandMatrix();
const DEMAND = demandIndex();
const WIDE_DEMAND = wideDemandIndex();

const WHERE_THE_RULE_LIVES = 'masterwrought R20, docs/design/professions.md';

describe('masterwrought R20: every gathering family feeds the crafts at every band', () => {
  it('reports EVERY empty levelling band at once, never just the first', () => {
    // Collected and asserted as one list on purpose. A first-failure-only
    // message turns filling the ladder into a whack-a-mole loop; this way the
    // failure output IS the audit table.
    const holes: string[] = [];
    for (const family of FAMILY_IDS) {
      const perBand = MATRIX.get(family) as Map<number, string[]>;
      for (const band of LEVELLING_BANDS) {
        if ((perBand.get(band) as string[]).length > 0) continue;
        // Off the SHARED bucket width rather than re-derived from the cap and
        // the band count: a message is unreachable while the file is green, so
        // a second derivation here could drift wrong invisibly.
        const low = band * TIER_SKILL_STEP;
        const high = low + TIER_SKILL_STEP - 1;
        holes.push(
          `${family} supplies NO recipe in band ${band} (skillReq ${low} to ${high}). ` +
            `It supplies: ${[...(SUPPLY.get(family) as Set<string>)].sort().join(', ')}. ` +
            `Fix by ADDING a row that consumes one of those ids to a recipe in that band ` +
            `(never by substituting one, masterwrought R18). Rule: ${WHERE_THE_RULE_LIVES}.`,
        );
      }
    }
    expect(holes).toEqual([]);
  });

  it('every family feeds at least one ENDGAME recipe that is not its own tool', () => {
    const holes: string[] = [];
    for (const family of FAMILY_IDS) {
      const rows = (MATRIX.get(family) as Map<number, string[]>).get(ENDGAME_BAND) as string[];
      if (rows.length > 0) continue;
      holes.push(
        `${family} supplies NO recipe at skillReq ${GATHERING_ENDGAME_SKILL} or above, ` +
          `once masterwrought decision D's self-feeding refusal is applied (a recipe whose ` +
          `result is that family's own gathering tool does not count). ` +
          `It supplies: ${[...(SUPPLY.get(family) as Set<string>)].sort().join(', ')}. ` +
          `Rule: ${WHERE_THE_RULE_LIVES}.`,
      );
    }
    expect(holes).toEqual([]);
  });

  it('no LEVELLING band is covered only by the family feeding its own tool', () => {
    // A SELF-CLEARING TRIPWIRE, added at the masterwrought Phase 11j QA, and
    // it is a tripwire rather than a rule because the rule is the maintainer's
    // to set. masterwrought decision D applies the self-feeding refusal at the
    // ENDGAME band alone. Below the cap the same hole is possible and is
    // exactly what this file's opening paragraph calls worthless: a band whose
    // only qualifying row is the family's own tool ladder gives a player
    // levelling through it no reason to have taken the profession.
    //
    // It bites NOTHING today, and it is one row from biting. Logging's band 3
    // holds recipe_ashwood_axe (logging's own axe) and recipe_precision_chassis
    // and nothing else, so deleting the chassis's log leaves logging band 3
    // credited solely by an axe; farming's bands 1, 2 and 3 each carry their
    // own hoe rung beside real bills. Proven by mutation: before this arm
    // existed, stripping recipe_precision_chassis left the whole file GREEN.
    //
    // WHEN THIS REDS, RE-DECIDE DECISION D'S SCOPE, never widen this arm. The
    // measured cost of extending the refusal to every band was taken at the
    // 11j QA and no cell empties: logging b3 2 to 1, mining b3 7 to 6,
    // herbalism b3 6 to 5, fishing b3 2 to 1, farming b1 7 to 6, b2 5 to 4,
    // b3 4 to 3.
    const selfOnly: string[] = [];
    for (const family of FAMILY_IDS) {
      const perBand = MATRIX.get(family) as Map<number, string[]>;
      for (const band of LEVELLING_BANDS) {
        const rows = perBand.get(band) as string[];
        if (rows.length === 0) continue;
        if (!rows.every((id) => isSelfFeedingFor(resultOf(id), family))) continue;
        selfOnly.push(
          `${family} band ${band} is credited ONLY by ${rows.join(', ')}, which produce ` +
            `${family}'s own gathering tools. That is the family feeding itself, which ` +
            `masterwrought decision D refuses at the endgame band and this file's opening ` +
            `paragraph refuses in principle at every band. RE-DECIDE decision D's scope ` +
            `(the measured cost of extending the refusal to every band is in the arm's ` +
            `comment), never widen this arm. Rule: ${WHERE_THE_RULE_LIVES}.`,
        );
      }
    }
    expect(selfOnly).toEqual([]);
    // Non-vacuity: the discriminator this arm runs really does separate the
    // two kinds of row over the levelling bands, so the empty result above is
    // a measurement rather than a predicate that matches nothing. Six tool
    // rungs sit in levelling bands and are credited to their own family today.
    const selfFeedingInLevellingBands = FAMILY_IDS.flatMap((family) =>
      LEVELLING_BANDS.flatMap((band) =>
        ((MATRIX.get(family) as Map<number, string[]>).get(band) as string[])
          .filter((id) => isSelfFeedingFor(resultOf(id), family))
          .map((id) => `${family}:${id}`),
      ),
    );
    expect(selfFeedingInLevellingBands.sort(), 'the levelling-band tool rungs').toEqual([
      'farming:recipe_bronze_hoe',
      'farming:recipe_osmium_hoe',
      'farming:recipe_skysilver_hoe',
      'fishing:recipe_stormreel_fishing_rod',
      'herbalism:recipe_goldleaf_sickle',
      'logging:recipe_ashwood_axe',
      'mining:recipe_thorium_mining_pick',
    ]);
  });
});

describe('masterwrought R21: the world eats what the gathering families supply', () => {
  it('every supplied id has at least ONE consumer (presence only, never a count)', () => {
    // PRESENCE AND NOWHERE ELSE (masterwrought decision E). Asserting a count
    // here would convert this guard into a content quota.
    const orphans: string[] = [];
    for (const family of FAMILY_IDS) {
      for (const id of [...(SUPPLY.get(family) as Set<string>)].sort()) {
        const consumers = consumptionIdsFor(id).reduce(
          (n, spendable) => n + (DEMAND.get(spendable)?.consumers.length ?? 0),
          0,
        );
        if (consumers > 0) continue;
        orphans.push(
          `${id} (${family}) has NO consumer in any recipe or enchant, and no ` +
            `base grade it could be spent on instead. ` +
            `The fix is a consumer at the rung that PRODUCES it, never tuning content ` +
            `so hard around the full kit that arriving without it means you cannot clear ` +
            `(masterwrought R21). Rule: ${WHERE_THE_RULE_LIVES}.`,
        );
      }
    }
    expect(orphans).toEqual([]);
  });

  it('every material id has at least ONE consumer across every spend mechanism (presence only)', () => {
    // THE MATERIAL-WIDE ARM.
    // Subject: every id in MATERIAL_ITEM_IDS (src/sim/material_taxonomy.ts),
    // not only what the six gathering families supply. Index: the WIDE one
    // (wideDemandIndex above): recipe reagents, enchant reagents, quest
    // collect objectives, the farming verbs, and downward grade substitution
    // through consumptionIdsFor. The ONLY assertion is presence, a consumer
    // count at or above 1; consumer and unit counts per material are diagnostic
    // tuning data and are never asserted here. A mechanism this
    // index misses can only produce a FALSE RED (a spent material reported as
    // dead), never a false green, and the failure names the material and the
    // mechanisms walked so the reader knows what to add.
    //
    // The one exemption, read off the LIVE list rather than typed as an id
    // here, and explained in full in the header block above: a material
    // staged ahead of its own recipes has no consumer yet BY CONSTRUCTION,
    // and the arm after this one pins that it really has none.
    const recipePending = new Set<string>(CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS);
    const orphans: string[] = [];
    let exempted = 0;
    for (const id of [...MATERIAL_ITEM_IDS].sort()) {
      if (recipePending.has(id)) {
        exempted++;
        continue;
      }
      const consumers = consumptionIdsFor(id).reduce(
        (n, spendable) => n + (WIDE_DEMAND.get(spendable)?.consumers.length ?? 0),
        0,
      );
      if (consumers > 0) continue;
      orphans.push(
        `${id} has NO consumer under any spend mechanism walked: ` +
          `${WIDE_DEMAND_MECHANISMS.join('; ')}. Either the material is dead content ` +
          `(the fix is a consumer at the rung that PRODUCES it, masterwrought R21) or it is ` +
          `spent by a mechanism wideDemandIndex does not walk yet (add the mechanism there, ` +
          `citing its spend site). Rule: ${WHERE_THE_RULE_LIVES}.`,
      );
    }
    expect(orphans).toEqual([]);
    // The exemption fired, at its exact size: the literal beside the
    // derivation this file's header demands of every arm. It reds if the
    // pending list GROWS, because a second material staged ahead of its
    // recipes is a fact a reader has to see rather than inherit, and it reds
    // when the list EMPTIES, because that is this exemption retiring and the
    // block above it going stale. Either way the fix is to re-read that
    // block, never to widen this number.
    // Core of the Last Flame now has live raid recipes; no staged exemption remains.
    expect(exempted).toBe(0);
    // Subject non-vacuity: the material set is the live derived one, and it
    // is not empty (tests/material_taxonomy.test.ts pins its exact members).
    expect(MATERIAL_ITEM_IDS.size).toBeGreaterThan(0);
  });

  it('the recipe-pending exemption covers only materials with genuinely ZERO consumers', () => {
    // THE OTHER HALF OF THE EXEMPTION, and the whole reason it is not a hole.
    // The arm above skips the staged ids; this one refuses to let a skip
    // survive its reason. Same shape and same live list as the release's own
    // consumer census (tests/material_profession_affinity.test.ts, whose own
    // arm is titled "recipe-pending materials have no consumer yet and remain
    // explicitly classified"), except that the index here is the WIDE one,
    // so the skip is spent against every spend mechanism this file walks
    // rather than against crafts alone.
    expect(CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS).toEqual([]);
    expect(WIDE_DEMAND.get('lastflame_core')?.consumers.length).toBeGreaterThan(0);
    for (const id of CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS) {
      expect(MATERIAL_ITEM_IDS.has(id), `${id} is no longer a material`).toBe(true);
      const consumers = consumptionIdsFor(id).flatMap(
        (spendable) => WIDE_DEMAND.get(spendable)?.consumers ?? [],
      );
      expect(
        consumers,
        `${id} is exempt from the presence floor ONLY while nothing spends it, and ` +
          `something now does. Its exemption is over: remove the id from ` +
          `CRUCIBLE_RECIPE_PENDING_MATERIAL_ITEM_IDS ` +
          `(src/sim/content/crucible_professions.ts), whose own contract retires an id ` +
          `the moment a live recipe names it, and reagent derivation owns the ` +
          `classification from then on. Rule: ${WHERE_THE_RULE_LIVES}.`,
      ).toEqual([]);
    }
  });

  it('the wide index really walks the quest and farming mechanisms', () => {
    // Non-vacuity for the two walks the family arm does not have, proven by
    // asking the index for consumers the header already cites: the
    // work-order quest collects copper_ore, and the farming inputs are
    // credited by the verbs that spend them. Nothing here asserts a count or
    // an exclusivity (a recipe consuming compost tomorrow is allowed). What
    // these lines pin is that the INDEX keeps walking each mechanism (drop
    // the farming walk from wideDemandIndex and they red); whether the
    // ENGINE really spends what the index credits is the other half, pinned
    // behaviorally in tests/professions_farming.test.ts (compost and tonic
    // counts decrement through a live Sim), not here (11m QA).
    const sourcesOf = (id: string) => WIDE_DEMAND.get(id)?.consumers ?? [];
    expect(sourcesOf('copper_ore')).toContain('quest:q_prof_workorder_forge');
    expect(sourcesOf(FARM_COMPOST_ITEM_ID)).toContain('farming:plantCrop:compost');
    expect(sourcesOf(FARM_GROWTH_TONIC_ITEM_ID)).toContain('farming:plantCrop:tonic');
    expect(sourcesOf(FARM_WITHERED_HUSK_ITEM_ID)).toContain('farming:convertHusks');
    for (const crop of Object.values(FARM_CROPS)) {
      expect(sourcesOf(crop.seedItemId), `${crop.id} seed`).toContain(
        `farming:plantCrop:seed:${crop.id}`,
      );
      expect(
        sourcesOf(crop.produceItemId).some((s) => s.startsWith('farming:plantCrop:watchFee:')),
        `${crop.id} produce is watch-fee eligible at its own tier or above`,
      ).toBe(true);
    }
    // And the three farming inputs the family arm's narrow index cannot see
    // at all, which is WHY the material-wide arm needed the wide one.
    for (const id of [
      FARM_COMPOST_ITEM_ID,
      FARM_GROWTH_TONIC_ITEM_ID,
      FARM_WITHERED_HUSK_ITEM_ID,
    ]) {
      expect(MATERIAL_ITEM_IDS.has(id), `${id} is a material`).toBe(true);
      expect(DEMAND.get(id), `${id} under the narrow index`).toBeUndefined();
    }
  });
});

describe('the derivation itself cannot pass by matching nothing', () => {
  it('every family has a non-empty supply set and every id resolves in ITEMS', () => {
    // AT THE REAL SIZES, not at a token floor (masterwrought Phase 11j QA).
    // `> 0` against real populations of 6 to 24 is the floor-far-below-the-set
    // trap tests/CLAUDE.md names: nodeSupplyFor could stop adding the fine
    // twins, halving three families, and every arm in this file would stay
    // green because the bases alone still cover every band. The empty-set
    // message is kept for the case that matters most to a reader.
    const SIZES: Record<string, number> = {
      mining: 6,
      logging: 6,
      herbalism: 6,
      fishing: 10,
      farming: 24,
      // 14 since horn and gills joined the mapping, for two reasons:
      // gills maps to mudfin_scale, an id NEW to the corpse set (+1), while
      // horn maps to curved_tusk, which tusk already supplied, so corpseSupply
      // (src/sim/professions/gathering_supply.ts spreads Object.values into a
      // Set) dedupes it (+0). Ten tags now yield nine distinct component ids,
      // plus the five specimens.
      corpseHarvesting: 14,
    };
    for (const family of FAMILY_IDS) {
      const ids = SUPPLY.get(family) as Set<string>;
      expect(ids.size, `${family} derived an EMPTY supply set`).toBeGreaterThan(0);
      expect(ids.size, `${family} supply-set size`).toBe(SIZES[family]);
      for (const id of ids) {
        expect(ITEMS[id], `${family} supplies ${id}, which resolves in no item def`).toBeDefined();
      }
    }
    // The map itself, so a family losing its SIZES row is a red rather than an
    // undefined compared against nothing.
    expect(Object.keys(SIZES).sort()).toEqual([...FAMILY_IDS].sort());
  });

  it('binds all six families, derived from GATHERING_PROFESSION_IDS', () => {
    // The derived form FIRST, which states the shape: the subject list is the
    // gathering professions in table order plus the corpse family appended.
    expect(FAMILY_IDS).toEqual([...GATHERING_PROFESSION_IDS, CORPSE_HARVEST_FAMILY]);
    // AND THE LITERAL BESIDE IT, because the line above is true by
    // construction: supplyByFamily sets one key per GATHERING_PROFESSION_IDS
    // entry and then appends corpse, so it can only fail on a duplicate id and
    // proves nothing about which professions actually shipped. The literal is
    // what reds when a profession is DELETED from the table, which the
    // derivation would follow silently.
    expect(FAMILY_IDS).toEqual([
      'mining',
      'logging',
      'herbalism',
      'fishing',
      'farming',
      'corpseHarvesting',
    ]);
  });

  it('pins the derived supply sets against the live tables', () => {
    // BE HONEST ABOUT WHAT THIS ONE CATCHES, corrected at the masterwrought
    // Phase 11j QA. It used to claim the MATERIAL DEMAND COVERAGE anti-rot
    // idiom, "a table row added without a supply mapping reds HERE", and that
    // is false for the case it names: both sides below walk the SAME
    // NODE_MATERIAL_TABLE, so a new zone row grows nodeYields and the derived
    // set together and stays green. Its real and only tooth is a node TYPE
    // whose NODE_HARVEST_TABLE.professionId does not name one of the three
    // node professions (a typo, or a fourth node type routed to fishing or
    // farming): that drops its whole column out of the derived side while
    // nodeYields keeps it. Proven by mutation rather than asserted: mistyping
    // wood's professionId reds this arm along with four others.
    // The LITERAL below is what catches a table row: nine node yields, three
    // per profession.
    const nodeYields = new Set<string>();
    for (const byZone of Object.values(NODE_MATERIAL_TABLE)) {
      for (const cell of Object.values(byZone)) nodeYields.add(cell.itemId);
    }
    const derivedNodeIds = new Set(
      GATHERING_PROFESSION_IDS.filter((id) => id !== 'fishing' && id !== 'farming').flatMap((id) =>
        [...(SUPPLY.get(id) as Set<string>)].filter((m) => nodeYields.has(m)),
      ),
    );
    expect([...derivedNodeIds].sort()).toEqual([...nodeYields].sort());
    // AND THE LITERAL, which is the half with teeth against the table itself:
    // nine yields, three per node profession. A tenth row added without a
    // supply mapping reds here, which is what the paragraph above used to
    // claim of the derived line.
    expect([...nodeYields].sort()).toEqual([
      'ashwood_log',
      'copper_ore',
      'elderwood_log',
      'goldleaf_herb',
      'iron_ore',
      'ironbark_log',
      'silverleaf_herb',
      'sunpetal_herb',
      'thorium_ore',
    ]);

    // Every fine twin in the grade table is claimed by exactly one family.
    const derivedFine = new Set(
      FAMILY_IDS.flatMap((f) => [...(SUPPLY.get(f) as Set<string>)]).filter((id) =>
        Object.values(MATERIAL_GRADES).some((row) => row.fineItemId === id),
      ),
    );
    expect([...derivedFine].sort()).toEqual(
      Object.values(MATERIAL_GRADES)
        .map((row) => row.fineItemId)
        .sort(),
    );

    // FARMING, and BE HONEST ABOUT WHICH LINE HAS THE TEETH. The two derived
    // assertions below re-express what farmingSupply() did, so like the loop
    // they replaced they can only fail on a duplicate crop id: they state the
    // shape for a reader, they do not guard it. The LITERAL is the guard, and
    // it is what reds when a crop is deleted, since a derivation follows the
    // table down. Kept all three deliberately rather than trimmed to the
    // literal, because the shape statement is what tells the next reader what
    // 24 is supposed to mean.
    const farming = SUPPLY.get('farming') as Set<string>;
    expect(farming.size, 'two grades for each shipped crop').toBe(
      Object.keys(FARM_CROPS).length * 2,
    );
    expect([...farming].sort()).toEqual(
      Object.values(FARM_CROPS)
        .flatMap((crop) => [crop.produceItemId, crop.fineProduceItemId])
        .sort(),
    );
    // THE ONE WITH TEETH: twelve shipped crops, two grades each.
    expect(farming.size, 'twelve crops at two grades').toBe(24);
  });

  it('the recipe corpus populates every band the loop iterates', () => {
    // Without this, a corpus that happened to carry nothing in a band would
    // make that band's coverage assertion a statement about the corpus rather
    // than about the gathering families.
    expect(ALL_RECIPES.length).toBeGreaterThan(0);
    for (const band of [...LEVELLING_BANDS, ENDGAME_BAND]) {
      const populated = ALL_RECIPES.some(
        (r) => Math.min(bandOf(r.skillReq ?? 0), ENDGAME_BAND) === band,
      );
      expect(populated, `no recipe at all sits in band ${band}`).toBe(true);
    }
  });

  it('the self-feeding refusal discriminates, and it changes an outcome', () => {
    // masterwrought decision D, pinned by CALLING the predicate rather than by
    // observing that the corpus contains both kinds of recipe. The corpus
    // observation is kept below because it is a real precondition, but on its
    // own it proved nothing: BEFORE the assertions in this arm existed,
    // isSelfFeedingFor could have returned false unconditionally and every arm
    // in this file would still have been green, because no family depends on
    // the refusal to keep a non-empty endgame cell. The outcome pin further
    // down is what closed that, and it reds on exactly that mutation now.
    expect(
      isSelfFeedingFor('arcanite_mining_pick', 'mining'),
      'a pick IS mining self-feeding',
    ).toBe(true);
    expect(
      isSelfFeedingFor('arcanite_mining_pick', 'logging'),
      'the same pick is NOT logging self-feeding: it discriminates by profession',
    ).toBe(false);
    expect(
      isSelfFeedingFor('duskforged_warblade', 'mining'),
      'a non-tool result is never self-feeding',
    ).toBe(false);
    // AND THE OUTCOME IT CHANGES, so the refusal is not merely callable: the
    // apex hoe is farming's own tool at the endgame band, and the matrix must
    // NOT credit farming for it.
    const farmingEndgame = (MATRIX.get('farming') as Map<number, string[]>).get(
      ENDGAME_BAND,
    ) as string[];
    expect(farmingEndgame, 'farming must not be credited for its own hoe').not.toContain(
      'recipe_evergarden_hoe',
    );
    // At the real count rather than a token floor, this round's own convention.
    // 12 to 15 at masterwrought Phase 11k: the three apex role feasts each name
    // `evergarden_greens`, the BASE tier-4 crop, so all three credit farming at
    // the endgame band. NOT the fine twins: the bill's own header records why a
    // fine twin is illegal on a fish row under RULE 2's value half, and a
    // reader repairing this pin from a fine-twin premise would look for a
    // reagent that is not there.
    expect(farmingEndgame.length, 'and it still has real endgame rows').toBe(15);
    // AND THE OUTCOME FOR EVERY OTHER FAMILY, which the two lines above do not
    // reach (masterwrought Phase 11j QA). The pin is the set the matrix
    // ACTUALLY refused, so it fails on a family-scoped narrowing of the rule
    // as well as on deleting it: six rows across all five gathering
    // professions, fishing twice because both its crafted rods sit at or above
    // the cap. Corpse harvesting is absent because it has no tool of its own,
    // which is the refusal being structurally inert there rather than off.
    expect([...REFUSED_ENDGAME_ROWS].sort(), 'the rows decision D refused').toEqual([
      'farming:recipe_evergarden_hoe',
      'fishing:recipe_clockreel_fishing_rod',
      'fishing:recipe_tidewrought_fishing_rod',
      'herbalism:recipe_sunpetal_sickle',
      'logging:recipe_elderwood_axe',
      'mining:recipe_arcanite_mining_pick',
    ]);
    // The precondition: both kinds of recipe exist, so neither branch of the
    // discriminator is unreachable over this corpus.
    const isTool = ALL_RECIPES.filter((r) =>
      GATHERING_PROFESSION_IDS.some((p) => gatherToolTier(ITEMS[r.resultItemId], p) !== undefined),
    );
    expect(isTool.length, 'no recipe produces a gathering tool').toBeGreaterThan(0);
    expect(
      ALL_RECIPES.length - isTool.length,
      'every recipe produces a gathering tool',
    ).toBeGreaterThan(0);
  });

  it('the substitution credit is load-bearing, not dead code', () => {
    // The demand arm credits a fine grade through its BASE. That branch is
    // only honest if something actually needs it: without this arm, a later
    // phase giving every fine grade a direct consumer would leave the credit
    // as dead code with nothing saying so, and a reader would not know whether
    // it had ever mattered.
    //
    // Today exactly the three EASTBROOK grades pass only through their base,
    // which is the shape the fine ladder having three tiers against a two-rung
    // crafted-tool ladder produces.
    // CALLS consumptionIdsFor rather than re-walking baseMaterialFor beside it,
    // so deleting the credit from the shipped helper reds HERE, in the arm
    // whose subject it is, and not only over in the orphan arm.
    const substitutionOnly: string[] = [];
    for (const family of FAMILY_IDS) {
      for (const id of SUPPLY.get(family) as Set<string>) {
        if ((DEMAND.get(id)?.consumers.length ?? 0) > 0) continue;
        const viaSubstitution = consumptionIdsFor(id).some(
          (spendable) => spendable !== id && (DEMAND.get(spendable)?.consumers.length ?? 0) > 0,
        );
        if (viaSubstitution) substitutionOnly.push(id);
      }
    }
    expect(substitutionOnly.sort()).toEqual([
      'fine_copper_ore',
      'fine_ironbark_log',
      'fine_silverleaf_herb',
    ]);
  });

  it('the band math is the shared bucket, not a local copy', () => {
    // THE LITERALS FIRST, because the derived assertions below are true by
    // construction and cannot fail: ENDGAME_BAND is DEFINED as
    // bandOf(GATHERING_ENDGAME_SKILL), and LEVELLING_BANDS is built from its
    // length. Without these, silently lowering every land cap to 50 would stop
    // checking two whole bands with every arm in this file still green.
    expect(TIER_SKILL_STEP, 'the shared bucket width').toBe(25);
    expect(GATHERING_ENDGAME_SKILL, 'the land gathering cap').toBe(100);
    expect(LEVELLING_BANDS).toEqual([0, 1, 2, 3]);
    expect(ENDGAME_BAND).toBe(4);
    // The two below are SHAPE STATEMENTS, not guards, and saying so here stops
    // the next reader trusting them: bandOf IS tierForSkill and ENDGAME_BAND is
    // defined as bandOf(GATHERING_ENDGAME_SKILL), so both are x === x.
    expect(ENDGAME_BAND).toBe(tierForSkill(GATHERING_ENDGAME_SKILL));
    expect(LEVELLING_BANDS.length).toBe(ENDGAME_BAND);
    // THIS one is real: it asks the shared bucket a question whose answer is
    // not its own definition, so a TIER_SKILL_STEP change moves this file and
    // the game together rather than reding only the literals above.
    expect(bandOf(GATHERING_ENDGAME_SKILL - 1)).toBe(ENDGAME_BAND - 1);
  });
});
