// ---------------------------------------------------------------------------
// THE GATHERING SUPPLY COVERAGE INVARIANT (masterwrought R20 and R21)
// ---------------------------------------------------------------------------
//
// The rule, stated once so a contributor who has never read the Masterwrought
// packet can act on a red here:
//
//   EVERY GATHERING FAMILY MUST FEED THE CRAFTS AT EVERY BAND. A gathering
//   profession that supplies nothing at some 25-point skill band is a
//   profession a player levelling through that band has no reason to have
//   taken, and the hole is invisible until someone plays it.
//
// masterwrought R20 (docs/prd/masterwrought/state.md, restated in
// docs/design/professions.md) is the supply half: every family appears in at
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
// 2026-08-20). No arm in this file asserts a COUNT of bills. Zero is a
// structural fact; everything above zero is a balance number nobody measured,
// and a numeric floor would turn a correctness guard into a content quota that
// passes on padding. The per-band and per-material counts ARE collected, and
// they are recorded in the phase ledger as a judgment surface instead.
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
// list is the one list in that file with no anti-rot pin against its live
// table, so the four catches added since it was written (glimmerfin_koi,
// raw_deepbarb_catfish, raw_hollowgill_sturgeon, raw_stillmere_salmon) are
// covered HERE and nowhere else. Pinning RAW_FISH against
// FISHING_TABLES_BY_BAND would be the durable fix and belongs to whoever owns
// that file.
//
// EVERYTHING IS DERIVED FROM LIVE TABLES. There is no hand-written id list and
// no literal 25 in this file: the subject list comes from
// GATHERING_PROFESSION_IDS, the supply sets come from the content tables the
// engine itself reads, and the band math comes from wheel.ts tierForSkill, so
// a TIER_SKILL_STEP change moves this test and the game together.
//
// NOT A SECOND COPY OF tests/recipe_economy.test.ts. That file asserts every
// material has at least one consumer SOMEWHERE. This file is the band-aware
// strengthening, and it lives in its own file so that file's two sorted
// literals stay untouched by it.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { FARM_CROPS } from '../src/sim/content/farm_crops';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import type { GatheringProfessionId } from '../src/sim/content/professions';
import {
  GATHERING_PROFESSION_IDS,
  GATHERING_PROFESSIONS,
  HARVEST_COMPONENT_ITEMS,
  HARVEST_COMPONENT_SPECIMENS,
} from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/content/recipes';
import { ITEMS } from '../src/sim/data';
import { NODE_HARVEST_TABLE, NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { baseMaterialFor, MATERIAL_GRADES } from '../src/sim/professions/material_grades';
import { gatherToolTier } from '../src/sim/professions/tools';
import { TIER_SKILL_STEP, tierForSkill } from '../src/sim/professions/wheel';
import type { GatherNodeType } from '../src/sim/types';

// The sixth family. Corpse harvesting is a gathering FAMILY without being a
// gathering PROFESSION: it has no id in GATHERING_PROFESSION_IDS, no counter
// and no tool of its own, but it is a faucet the crafts eat from, so
// masterwrought decision C binds it here with the other five rather than
// reporting it and leaving it unguarded.
const CORPSE_HARVEST_FAMILY = 'corpseHarvesting';

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

/**
 * mining / logging / herbalism: the NODE_MATERIAL_TABLE yields for whichever
 * node type NODE_HARVEST_TABLE says this profession harvests, plus each
 * yield's fine twin. Resolved through the tables rather than by hard-coding
 * ore/wood/herb, so a fourth node type joins its profession automatically.
 */
function nodeSupplyFor(professionId: GatheringProfessionId): Set<string> {
  const ids = new Set<string>();
  for (const nodeType of Object.keys(NODE_HARVEST_TABLE) as GatherNodeType[]) {
    if (NODE_HARVEST_TABLE[nodeType].professionId !== professionId) continue;
    for (const cell of Object.values(NODE_MATERIAL_TABLE[nodeType])) {
      ids.add(cell.itemId);
      const fine = MATERIAL_GRADES[cell.itemId]?.fineItemId;
      if (fine !== undefined) ids.add(fine);
    }
  }
  return ids;
}

/**
 * fishing: every catchable id in the band tables, minus grey junk BY ITS DEF
 * (quality 'poor') rather than by an id list. Grey junk is a coin drop dressed
 * as a catch, never supply: sellAllJunk vendors it. The null rows are the
 * empty-hook weight and carry no id at all.
 */
function fishingSupply(): Set<string> {
  const ids = new Set<string>();
  for (const band of FISHING_TABLES_BY_BAND) {
    for (const table of Object.values(band)) {
      for (const entry of table) {
        if (entry.itemId === null) continue;
        if (ITEMS[entry.itemId]?.quality === 'poor') continue;
        ids.add(entry.itemId);
      }
    }
  }
  return ids;
}

/** farming: both grades of every crop, off the crop records themselves. */
function farmingSupply(): Set<string> {
  const ids = new Set<string>();
  for (const crop of Object.values(FARM_CROPS)) {
    ids.add(crop.produceItemId);
    ids.add(crop.fineProduceItemId);
  }
  return ids;
}

/** corpse harvesting: the ordinary components plus the premium specimens. */
function corpseSupply(): Set<string> {
  return new Set([
    ...Object.values(HARVEST_COMPONENT_ITEMS),
    ...Object.values(HARVEST_COMPONENT_SPECIMENS),
  ]);
}

/**
 * The supply map: one id set per family. THE SUBJECT LIST IS DERIVED from
 * GATHERING_PROFESSION_IDS (masterwrought decision C) so a sixth gathering
 * profession joins this guard the day it is authored, with corpse harvesting
 * appended as the one family that has no profession id.
 */
function supplyByFamily(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const professionId of GATHERING_PROFESSION_IDS) {
    if (professionId === 'fishing') out.set(professionId, fishingSupply());
    else if (professionId === 'farming') out.set(professionId, farmingSupply());
    else out.set(professionId, nodeSupplyFor(professionId));
  }
  out.set(CORPSE_HARVEST_FAMILY, corpseSupply());
  return out;
}

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

/** The per-family, per-band count of qualifying recipes: the audit matrix. */
function bandMatrix(): Map<string, Map<number, string[]>> {
  const matrix = new Map<string, Map<number, string[]>>();
  for (const family of FAMILY_IDS) {
    const ids = SUPPLY.get(family) as Set<string>;
    const perBand = new Map<number, string[]>();
    for (const band of [...LEVELLING_BANDS, ENDGAME_BAND]) perBand.set(band, []);
    for (const recipe of ALL_RECIPES) {
      const band = Math.min(bandOf(recipe.skillReq ?? 0), ENDGAME_BAND);
      if (!reagentIdsOf(recipe).some((id) => ids.has(id))) continue;
      if (band === ENDGAME_BAND && isSelfFeedingFor(recipe.resultItemId, family)) continue;
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

/** Consumers and unit demand per id, over ALL reagent sources on the tree. */
function demandIndex(): Map<string, { consumers: string[]; units: number }> {
  const demand = new Map<string, { consumers: string[]; units: number }>();
  const note = (itemId: string, source: string, count: number) => {
    const row = demand.get(itemId) ?? { consumers: [], units: 0 };
    row.consumers.push(source);
    row.units += count;
    demand.set(itemId, row);
  };
  for (const recipe of ALL_RECIPES) {
    for (const reagent of recipe.reagents) note(reagent.itemId, recipe.id, reagent.count);
  }
  // src/sim/content/enchants.ts IS a reagent source and it is the one a
  // hand-scoped census misses: the census that once called arcane_shard a
  // dead-end rung scanned content/recipes.ts alone and missed ten more
  // consumer rows here. Scoping a demand scan to one file is the exact error
  // this arm exists to make impossible.
  for (const enchant of Object.values(ENCHANTS)) {
    for (const reagent of enchant.reagents) note(reagent.itemId, enchant.id, reagent.count);
  }
  return demand;
}

const MATRIX = bandMatrix();
const DEMAND = demandIndex();

const WHERE_THE_RULE_LIVES =
  'masterwrought R20, docs/prd/masterwrought/state.md, restated in docs/design/professions.md';

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
        const low = band * (GATHERING_ENDGAME_SKILL / ENDGAME_BAND);
        const high = low + GATHERING_ENDGAME_SKILL / ENDGAME_BAND - 1;
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
});

describe('masterwrought R21: the world eats what the gathering families supply', () => {
  it('every supplied id has at least ONE consumer (presence only, never a count)', () => {
    // PRESENCE AND NOWHERE ELSE (masterwrought decision E). The counts are
    // collected above and recorded in the ledger's ratio table; asserting one
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
});

describe('the derivation itself cannot pass by matching nothing', () => {
  it('every family has a non-empty supply set and every id resolves in ITEMS', () => {
    for (const family of FAMILY_IDS) {
      const ids = SUPPLY.get(family) as Set<string>;
      expect(ids.size, `${family} derived an EMPTY supply set`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(ITEMS[id], `${family} supplies ${id}, which resolves in no item def`).toBeDefined();
      }
    }
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
    // The MATERIAL DEMAND COVERAGE anti-rot idiom: a table row added without a
    // supply mapping reds HERE rather than silently shrinking the guard.
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

    // FARMING, pinned by SIZE and by literal rather than by a loop over the
    // same table the set is built from. The loop this replaces asked whether
    // farmingSupply() contains what farmingSupply() put there, which held for
    // every crop by construction and gave the arm no teeth at all: it is the
    // farming half of the very anti-rot claim this test's title makes.
    const farming = SUPPLY.get('farming') as Set<string>;
    expect(farming.size, 'two grades for each shipped crop').toBe(
      Object.keys(FARM_CROPS).length * 2,
    );
    expect([...farming].sort()).toEqual(
      Object.values(FARM_CROPS)
        .flatMap((crop) => [crop.produceItemId, crop.fineProduceItemId])
        .sort(),
    );
    // The literal count beside the derivation, same reason as everywhere else
    // in this file: without it, deleting a crop shrinks both sides together.
    expect(farming.size).toBe(24);
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
    // own it proved nothing: isSelfFeedingFor could return false
    // unconditionally and every arm in this file would stay green, because no
    // family depends on the refusal to be non-empty.
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
    expect(farmingEndgame.length, 'and it still has real endgame rows').toBeGreaterThan(0);
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
    const substitutionOnly: string[] = [];
    for (const family of FAMILY_IDS) {
      for (const id of SUPPLY.get(family) as Set<string>) {
        const direct = DEMAND.get(id)?.consumers.length ?? 0;
        if (direct > 0) continue;
        const base = baseMaterialFor(id);
        if (base === undefined) continue;
        if ((DEMAND.get(base)?.consumers.length ?? 0) > 0) substitutionOnly.push(id);
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
    // And the derivation really does route through the shared helper, so a
    // TIER_SKILL_STEP change moves this file and the game together rather than
    // reding only the literals above.
    expect(ENDGAME_BAND).toBe(tierForSkill(GATHERING_ENDGAME_SKILL));
    expect(LEVELLING_BANDS.length).toBe(ENDGAME_BAND);
    expect(bandOf(GATHERING_ENDGAME_SKILL - 1)).toBe(ENDGAME_BAND - 1);
  });
});
