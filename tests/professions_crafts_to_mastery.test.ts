// Ruling R13 (docs/design/professions-tuning-packet-review.md, item 8b.7):
// the design record's time-to-master target is PROSE only.
// `docs/design/professions.md` states "craft mastery in 10 to 20 focused
// hours" and `docs/design/professions-tuning-packet.md` records "Full
// armorcrafting mastery is 150 crafts" against that target, and until now
// nothing recomputed either figure from the shipped tables. A reagent-bill
// edit, a gain-curve retune, a node-count or respawn change, or a
// specialization-discount tune could all move the real number while every
// existing pin stayed green.
//
// This file derives the number instead of restating it. It walks the LIVE
// gain curve from skill 0 to the armorcrafting content cap, choosing at each
// step the recipe a real player would craft, accumulates the reagent bill the
// live consumption math would actually charge, and converts the gathered half
// of that bill into hours against the live per-zone harvest ceiling. Every
// input is read from source; no intermediate number is hardcoded.
//
// THE MODEL
// 1. Cap: craftMaxSkillFor('armorcrafting') off CRAFT_RING.
// 2. Fixture: a real attuned pair, taken from Sim.acceptArchetypeQuest, so
//    armorcrafting is a MAJOR and the empowerment ceiling never zeroes the
//    gains (a dormant craft would stall at the common tier and never reach
//    the cap at all).
// 3. Availability, from the live predicates rather than a re-guess: a recipe
//    counts as craftable when it is grandfathered (isRecipeKnown with no
//    acquisition list) or the trainer would teach it at the current skill
//    (teachTierMet), AND its comboRequirement is met (meetsComboRequirement)
//    against the simulated skills. The armorcrafting combo recipe therefore
//    drops out on its own: this model only ever raises armorcrafting, so the
//    weaponcrafting half of its pair stays at 0.
// 4. Choice: highest craftSkillGainMultiplier, ties broken by the fewest
//    GATHERED units, then the fewest total units, then recipe id. Gathered
//    units first because gathered units are what costs TIME here; vendor and
//    mob-drop units cost gold and kills, which this model prices at zero.
//    The tie-break is what makes the walk a thrifty player rather than an
//    arbitrary one: every rung offers several recipes at identical gain.
// 5. Bill: requiredReagentCountFor, the same function the sim's consumption
//    and the crafting window's requirement display both call, so the #1134
//    specialization discount enters the bill exactly where it enters the
//    game (armorcrafting specializes at skill 75, and the last 50 skill of
//    the climb is charged the discounted counts).
// 6. Hours: a gathered material's units become harvest casts at the COMMON
//    row of its NODE_MATERIAL_TABLE qtyByRarity (see the simplification note
//    below), and casts become hours at that zone-and-type's harvest ceiling,
//    nodes * 3600 / NODE_HARVEST_TABLE respawnSeconds, the same shape
//    tests/gather_node_placement.test.ts pins as "every zone lands on one
//    harvest ceiling". The respawn timer is per player
//    (gathering.ts writes meta.nodeHarvestReadyAt), so this ceiling is a
//    personal rate, not a shared-server one.
//
// DELIBERATE SIMPLIFICATIONS, each named with its bias DIRECTION (they do
// not all point the same way; the per-bullet direction is what a tuner needs)
// - Common-rarity yields only: biases the hours UP. Every material row grants
//   1 unit on a common roll and 2 to 4 on a rarer one, so a real climb needs
//   fewer casts than this. Assuming the common row is the honest pessimistic
//   arm and keeps the derivation draw-free (no Rng, no seed hunting).
// - The rare-event yield multiplier is unmodeled: biases the hours UP. The
//   harvest grant multiplies yield by GATHER_RARE_EVENT_YIELD_MULT at
//   GATHER_RARE_EVENT_CHANCE, a flat ~1.04x on expected units per cast that
//   applies at any proficiency.
// - The proficiency YIELD growth is unmodeled: biases the hours UP by a
//   lot. gatherNodeGainMultiplier fires on every harvest, and the climb to
//   the later yield rungs completes well inside the casts the bill demands,
//   so a real player's per-cast yield rises through the very grind this
//   model prices at the floor rate. (Distinct from the access-climb bullet
//   below, which is about a separate design target, not yields.)
// - No self-signed reduction: biases the bill (and hours) UP. Every
//   requiredReagentCountFor call passes hasSelfSigned false, so the #1145
//   reduction a real crafter holding their own signed work would enjoy is
//   never applied.
// - stationType is ignored entirely: direction DOWN, of a piece with the
//   no-travel bullet below. Stations sit in hubs; reaching one costs walk
//   time this model does not price.
// - Zero hours for vendor and mob-drop reagents: biases DOWN. Those are a
//   gold cost and a kill count, not a harvest rate. They are still summed and
//   asserted non-empty, because a bill that became all-gathered or all-vendor
//   would be a different game and should redden here.
// - No travel, no node contention, no cast time: biases DOWN, though barely.
//   The measured six-node circuits run well under the respawn timer, so the
//   respawn ceiling is genuinely the binding term (450 thorium casts over
//   six nodes is five hours of respawn against roughly nineteen minutes of
//   casting at GATHER_CAST_BASE_SEC): folding circuit time in moves the
//   total by nothing, and modeling it would only hide the lever that
//   matters.
// - The gathering-proficiency climb needed to work the later zones is not
//   priced. The design record tracks that separately (gathering 100 in 8 to
//   12 hours), and double-counting it here would conflate two targets.
// - The craft throttle (CRAFT_THROTTLE_MAX_PER_WINDOW per window) is a rate
//   cap on crafting, not a material cost: with materials in hand it adds
//   about fifteen minutes to 150 crafts. Excluded so the total stays the
//   gather figure the target is about.
//
// MEASURED, at the time of writing: 150 crafts to the 125 cap (the design
// record's own figure, now derived rather than asserted), over four recipes
// spanning all four skillReq rungs, for a bill of 450 thorium_ore,
// 375 smithing_flux, 100 iron_ore, 100 rough_hide, 75 copper_ore,
// 50 bone_fragments and 25 arcanite_bar. That is 6.94 gather hours:
// 5.00 thorium, 1.11 iron, 0.83 copper, with the other 550 units free.
//
// The window asserted below is 5 to 10 hours. Wide enough that a legitimate
// small tune does not redden it, and the bite arms measure both ends: tripling
// the gathered half of every reagent list reaches 21.7 hours, trimming it to a
// third reaches 1.7, and halving node density reaches 13.9.
//
// READ THE 6.94 HONESTLY: it bounds the TUNED-CIRCUIT MODEL, not the
// player, and the UP biases dominate (measured in the QA round: the
// unmodeled rare-event multiplier alone brings it to ~6.66, the real
// proficiency climb to ~3.6, and the self-signed reduction to ~2.8; the
// post-#2387 Battlefield Experience credit lowers the craft count further
// and is deliberately unmodeled, another UP bias). The content pass then
// re-derived supply over EVERY granting zone (the all-zones arm below): the
// v0.32.0 starter zones grant thorium from ten zones and iron from one, so
// the same conservative bill lands at ~2.8 gather hours before any of the
// yield biases, and a real focused all-levers climb sits nearer 1 to 3
// hours against the design record's former 10-to-20 prose target. The
// target MOVED to the measured band by the content pass's veto-able ruling
// (the review worklist's ledger; the pre-approved material-quantities
// lever stays named for the maintainer): the shipped content is FASTER
// than the old prose promised, and a
// tuner reaching for a lever should start from that reading.

import { describe, expect, it } from 'vitest';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { craftMaxSkillFor } from '../src/sim/content/professions';
import { ALL_RECIPES } from '../src/sim/data';
import { craftSkillGainMultiplier } from '../src/sim/professions/archetype';
import {
  isRecipeKnown,
  meetsComboRequirement,
  requiredReagentCountFor,
  resolveCraftForRecipe,
} from '../src/sim/professions/crafting';
import { NODE_HARVEST_TABLE, NODE_MATERIAL_TABLE } from '../src/sim/professions/gathering';
import { teachTierMet } from '../src/sim/professions/training';
import type { ProfessionRecipeRecord } from '../src/sim/professions/types';
import { type CraftSkills, emptyCraftSkills, gainCraftSkill } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';
import type { GatherNodeType } from '../src/sim/types';

const CRAFT = 'armorcrafting';

// The per-craft base skill amount. crafting.ts keeps CRAFT_SKILL_GAIN
// private, so this mirrors it, and the calibration arm below pins the mirror
// against a REAL craft through resolveCraftForRecipe rather than trusting it.
const BASE_GAIN_PER_CRAFT = 1;

interface Attunement {
  activeArchetype: string;
  pairedMajor: string | null;
  hobbyCraft: string | null;
}

interface CraftMeta {
  archetype: Attunement;
  craftSkills: CraftSkills;
}

function metaOf(sim: Sim, pid: number): CraftMeta {
  return (sim as unknown as { players: Map<number, CraftMeta> }).players.get(pid)!;
}

function ctxOf(sim: Sim) {
  return (sim as unknown as { ctx: Parameters<typeof resolveCraftForRecipe>[0] }).ctx;
}

/** The attuned-pair fixture, read off a real Sim rather than assembled by
 *  hand: acceptArchetypeQuest is what a character actually goes through, and
 *  it is what decides the paired major and the persisted hobby. Taking it
 *  from the live call means a change to the default-pair rule flows into this
 *  derivation instead of being papered over by a hand-written literal. */
function attunedArmorcrafter(): Attunement {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
  sim.acceptArchetypeQuest(CRAFT);
  return metaOf(sim, sim.playerId).archetype;
}

interface GatheredSource {
  type: GatherNodeType;
  zoneId: string;
  unitsPerCast: number;
}

/** Every material a node can grant, with the zone and node type that grants
 *  it and the units one COMMON-rarity harvest yields. Inverted from the live
 *  NODE_MATERIAL_TABLE, so a material that stops being node-granted (or a
 *  new one that starts) changes what this file prices as time.
 *
 *  Scoped to the TUNED zones (the R37 'complete' set): the v0.32.0 expansion
 *  zones re-grant the same materials from their starter nodes, so the
 *  one-zone-per-material premise now holds only inside the tuned circuits
 *  this derivation prices. That keeps every hour figure the figure the
 *  packet's mastery pass authored against; the expansion's extra supply is
 *  the phase 13 economy integration's problem and would only LOWER real
 *  hours, so the floors below stay the conservative reading. Inside the
 *  tuned set the ambiguity refusal keeps its old teeth. */
const MASTERY_TUNED_ZONE_IDS = new Set(['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights']);

/** The ALL-ZONES harvest ceiling for one gathered material: the sum of every
 *  granting zone's own per-hour ceiling (nodes x 3600 / respawn), tuned and
 *  starter zones alike. The un-blinded supply read the phase 13 content pass
 *  added: the tuned-circuit inversion above deliberately prices three zones,
 *  and this prices the world, so the floor below can SEE the expansion's
 *  extra faucets instead of assuming them away. Two stated biases, one per
 *  direction: cross-zone travel is unmodeled (bias DOWN on real supply,
 *  which keeps this a ceiling like its single-zone sibling), and units per
 *  cast are hard-assumed at the 1-unit common yield (bias UP on hours,
 *  matching the tuned model's own common-only assumption; the rarity
 *  ladder and rare events only shorten the real climb, which the floor's
 *  purpose tolerates). */
function allZonesHarvestsPerHour(itemId: string): number {
  let perHour = 0;
  for (const [type, byZone] of Object.entries(NODE_MATERIAL_TABLE)) {
    for (const [zoneId, row] of Object.entries(byZone)) {
      if (row.itemId !== itemId) continue;
      const nodes = GATHER_NODES.filter(
        (node) => node.zoneId === zoneId && node.type === type,
      ).length;
      if (nodes === 0) continue;
      perHour += (nodes * 3600) / NODE_HARVEST_TABLE[type as GatherNodeType].respawnSeconds;
    }
  }
  return perHour;
}
function gatheredSources(): Map<string, GatheredSource> {
  const sources = new Map<string, GatheredSource>();
  for (const [type, byZone] of Object.entries(NODE_MATERIAL_TABLE)) {
    for (const [zoneId, row] of Object.entries(byZone)) {
      if (!MASTERY_TUNED_ZONE_IDS.has(zoneId)) continue;
      // Keying by itemId assumes one granting zone per material. Refuse the
      // day that stops being true instead of silently keeping whichever zone
      // the iteration visits last (the cheapest zone might be the dropped
      // one, quietly inflating every hour figure).
      if (sources.has(row.itemId)) {
        throw new Error(`${row.itemId} is granted by more than one zone; the inversion must pick`);
      }
      sources.set(row.itemId, {
        type: type as GatherNodeType,
        zoneId,
        unitsPerCast: row.qtyByRarity.common,
      });
    }
  }
  return sources;
}

/** The harvest ceiling for one node type in one zone: how many casts of that
 *  type the zone can hand a single player in an hour, nodes * 3600 /
 *  respawnSeconds. Both levers are live reads, so moving either one moves
 *  every hour figure in this file. */
function harvestsPerHour(source: GatheredSource): number {
  const nodes = GATHER_NODES.filter(
    (node) => node.zoneId === source.zoneId && node.type === source.type,
  ).length;
  return (nodes * 3600) / NODE_HARVEST_TABLE[source.type].respawnSeconds;
}

interface MasteryDerivation {
  cap: number;
  crafts: number;
  finalSkill: number;
  /** Units of each reagent id the whole climb consumes. */
  bill: Map<string, number>;
  /** How many crafts each recipe id contributed. */
  recipeUse: Map<string, number>;
  /** Hours attributable to each gathered material id. */
  gatherHoursByMaterial: Map<string, number>;
  gatherHours: number;
  /** Units of vendor and mob-drop reagents, priced at zero hours. */
  nonGatheredUnits: number;
}

/** Walk one craft from skill 0 to its content cap, recipe by recipe, and
 *  return the crafts, the bill, and the gather hours the bill implies.
 *
 *  `pool` is a parameter rather than a closed-over constant so the bite arm
 *  at the bottom of this file can re-run the identical derivation over a
 *  deliberately inflated or trimmed recipe table and show the asserted
 *  window actually excludes it. */
function deriveMastery(pool: ProfessionRecipeRecord[], attunement: Attunement): MasteryDerivation {
  const { activeArchetype, pairedMajor, hobbyCraft } = attunement;
  const sources = gatheredSources();
  const cap = craftMaxSkillFor(CRAFT);
  const skills: CraftSkills = emptyCraftSkills();
  const bill = new Map<string, number>();
  const recipeUse = new Map<string, number>();
  let crafts = 0;

  const unitsOf = (recipe: ProfessionRecipeRecord, gatheredOnly: boolean): number =>
    recipe.reagents.reduce(
      (total, reagent) =>
        gatheredOnly && !sources.has(reagent.itemId)
          ? total
          : total + requiredReagentCountFor(false, reagent, skills, CRAFT).count,
      0,
    );

  // A hard iteration bound so a gain curve that stops advancing (or a future
  // edit that makes one craft grant an ever-shrinking sliver) fails the
  // reached-the-cap assertion instead of hanging the suite.
  const maxCrafts = 100000;
  while ((skills[CRAFT] ?? 0) < cap && crafts < maxCrafts) {
    let best: ProfessionRecipeRecord | null = null;
    let bestGain = 0;
    let bestGathered = Number.POSITIVE_INFINITY;
    let bestTotal = Number.POSITIVE_INFINITY;
    for (const recipe of pool) {
      // Availability mirrors production's acquisition model, not just its
      // tier check: a non-grandfathered recipe is learnable only through a
      // trainer (teachTierMet gates the tier; the acquisition list gates the
      // ROUTE). Without the route check, flipping a climb recipe to
      // drop-acquired would leave this model walking a recipe no player can
      // learn while reporting its hours as authoritative.
      const known =
        isRecipeKnown(undefined, recipe) ||
        (teachTierMet(recipe, skills) && (recipe.acquisition?.includes('trainer') ?? false));
      if (!known) continue;
      if (!meetsComboRequirement(skills, recipe, activeArchetype, pairedMajor, hobbyCraft))
        continue;
      const gain = craftSkillGainMultiplier(
        skills,
        activeArchetype,
        pairedMajor,
        CRAFT,
        hobbyCraft,
        recipe.skillReq,
      );
      if (gain <= 0) continue;
      const gathered = unitsOf(recipe, true);
      const total = unitsOf(recipe, false);
      const better =
        best === null ||
        gain > bestGain ||
        (gain === bestGain &&
          (gathered < bestGathered ||
            (gathered === bestGathered &&
              (total < bestTotal || (total === bestTotal && recipe.id < best.id)))));
      if (better) {
        best = recipe;
        bestGain = gain;
        bestGathered = gathered;
        bestTotal = total;
      }
    }
    // No recipe teaches anything any more: the climb has stalled below the
    // cap, and the finalSkill assertion is what reports it.
    if (!best) break;
    for (const reagent of best.reagents) {
      const count = requiredReagentCountFor(false, reagent, skills, CRAFT).count;
      bill.set(reagent.itemId, (bill.get(reagent.itemId) ?? 0) + count);
    }
    recipeUse.set(best.id, (recipeUse.get(best.id) ?? 0) + 1);
    gainCraftSkill(skills, CRAFT, BASE_GAIN_PER_CRAFT * bestGain);
    crafts++;
  }

  const gatherHoursByMaterial = new Map<string, number>();
  let nonGatheredUnits = 0;
  for (const [itemId, units] of bill) {
    const source = sources.get(itemId);
    if (!source) {
      nonGatheredUnits += units;
      continue;
    }
    const casts = Math.ceil(units / source.unitsPerCast);
    gatherHoursByMaterial.set(itemId, casts / harvestsPerHour(source));
  }
  const gatherHours = [...gatherHoursByMaterial.values()].reduce((a, b) => a + b, 0);

  return {
    cap,
    crafts,
    finalSkill: skills[CRAFT] ?? 0,
    bill,
    recipeUse,
    gatherHoursByMaterial,
    gatherHours,
    nonGatheredUnits,
  };
}

const ARMORCRAFTING_RECIPES = ALL_RECIPES.filter((recipe) => recipe.professionId === CRAFT);
const ATTUNEMENT = attunedArmorcrafter();
const RUN = deriveMastery(ARMORCRAFTING_RECIPES, ATTUNEMENT);

// The asserted window, in hours. Sits either side of the measured 6.94 with
// room for a modest tune in both directions; the bite arms below show each
// bound is reachable by a real edit rather than sitting at slack.
const MIN_GATHER_HOURS = 5;
const MAX_GATHER_HOURS = 10;

describe('armorcrafting mastery derives from the live tables (R13)', () => {
  it('the fixture is a real attuned pair, so armorcrafting is uncapped by the empowerment ceiling', () => {
    // The premise every number below rests on, asserted rather than assumed:
    // a dormant craft is ceilinged at the common tier and its gain would zero
    // out long before the cap, which would silently turn every hour figure
    // here into a measurement of a stalled climb.
    expect(ATTUNEMENT.activeArchetype).toBe(CRAFT);
    expect(ATTUNEMENT.pairedMajor).not.toBe(CRAFT);
    expect(ATTUNEMENT.pairedMajor).not.toBeNull();
    // Uncapped means the top recipe tier in the pool still teaches at the top
    // of the climb, which is what lets the walk reach the cap at all.
    const topSkillReq = Math.max(...ARMORCRAFTING_RECIPES.map((recipe) => recipe.skillReq));
    expect(
      craftSkillGainMultiplier(
        { [CRAFT]: RUN.cap - 1 },
        ATTUNEMENT.activeArchetype,
        ATTUNEMENT.pairedMajor,
        CRAFT,
        ATTUNEMENT.hobbyCraft,
        topSkillReq,
      ),
    ).toBeGreaterThan(0);
  });

  it('the base gain the model applies is the one a real craft grants', () => {
    // Anti-rot: BASE_GAIN_PER_CRAFT mirrors crafting.ts's private
    // CRAFT_SKILL_GAIN, and a mirror nobody checks is a literal waiting to
    // drift. Run one genuine craft at full multiplier through the real
    // resolver and read the applied delta back off the player's skills.
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    sim.acceptArchetypeQuest(CRAFT);
    const meta = metaOf(sim, pid);
    // A grandfathered, station-free armorcrafting recipe so the craft is
    // admitted on materials alone; skill 0 against a tier-0 recipe is the
    // full-multiplier arm of the curve.
    const recipe = ARMORCRAFTING_RECIPES.find(
      (candidate) =>
        candidate.skillReq === 0 &&
        candidate.stationType === undefined &&
        !candidate.comboRequirement &&
        (candidate.acquisition ?? []).length === 0,
    );
    expect(recipe, 'no grandfathered station-free armorcrafting recipe').toBeDefined();
    for (const reagent of recipe!.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
    expect(meta.craftSkills[CRAFT]).toBe(0);
    expect(
      craftSkillGainMultiplier(
        meta.craftSkills,
        ATTUNEMENT.activeArchetype,
        ATTUNEMENT.pairedMajor,
        CRAFT,
        ATTUNEMENT.hobbyCraft,
        recipe!.skillReq,
      ),
    ).toBe(1);
    const result = resolveCraftForRecipe(ctxOf(sim), pid, recipe!);
    expect(result.ok, `calibration craft denied: ${JSON.stringify(result)}`).toBe(true);
    expect(meta.craftSkills[CRAFT]).toBe(BASE_GAIN_PER_CRAFT);

    // Second calibration point, OFF the full-multiplier peak: the pin above
    // only meets the real gain site where the multiplier is exactly 1, so a
    // formula-shape change that coincides there but diverges below it (a
    // floor, a rounding, a different gray-out curve) would slip past. Find
    // the first skill where this recipe's multiplier is genuinely partial
    // and pin the real craft's delta against the same product the model
    // applies.
    let partialSkill = -1;
    let partial = 0;
    for (let s = 1; s < craftMaxSkillFor(CRAFT); s++) {
      const m = craftSkillGainMultiplier(
        { ...meta.craftSkills, [CRAFT]: s },
        ATTUNEMENT.activeArchetype,
        ATTUNEMENT.pairedMajor,
        CRAFT,
        ATTUNEMENT.hobbyCraft,
        recipe!.skillReq,
      );
      if (m > 0 && m < 1) {
        partialSkill = s;
        partial = m;
        break;
      }
    }
    expect(partialSkill, 'a partial-multiplier rung exists for the recipe').toBeGreaterThan(0);
    meta.craftSkills[CRAFT] = partialSkill;
    for (const reagent of recipe!.reagents) sim.addItem(reagent.itemId, reagent.count, pid);
    const second = resolveCraftForRecipe(ctxOf(sim), pid, recipe!);
    expect(second.ok, `partial-point craft denied: ${JSON.stringify(second)}`).toBe(true);
    expect(meta.craftSkills[CRAFT]).toBeCloseTo(partialSkill + BASE_GAIN_PER_CRAFT * partial, 10);
  });

  it('the walk reaches the cap in a finite, non-trivial number of crafts', () => {
    // Non-vacuity for everything after this: a climb that stalled short of
    // the cap, or one that finished in a handful of crafts, would make the
    // bill and the hour window meaningless rather than merely wrong.
    expect(RUN.finalSkill).toBe(RUN.cap);
    expect(Number.isFinite(RUN.crafts)).toBe(true);
    // The bare non-vacuity floor, kept separate from the band below because a
    // band is a tuning knob and this is not: however the numbers are retuned,
    // a craft ladder that caps out in under twenty crafts is not a ladder.
    expect(RUN.crafts).toBeGreaterThan(20);
    // The design record's own figure ("Full armorcrafting mastery is 150
    // crafts", docs/design/professions-tuning-packet.md), now derived. The
    // band rather than the literal, so a one-recipe reshuffle does not
    // redden it but a gain-curve retune does.
    expect(RUN.crafts).toBeGreaterThanOrEqual(120);
    expect(RUN.crafts).toBeLessThanOrEqual(200);
  });

  it('the climb spans several rungs, not one recipe repeated to the cap', () => {
    // Without this, a bill edit to any recipe the optimizer stopped choosing
    // would move nothing here and the file would silently stop covering the
    // ladder it claims to walk.
    expect(RUN.recipeUse.size).toBeGreaterThanOrEqual(3);
    const rungs = new Set(
      [...RUN.recipeUse.keys()].map(
        (id) => ARMORCRAFTING_RECIPES.find((recipe) => recipe.id === id)!.skillReq,
      ),
    );
    expect(rungs.size).toBeGreaterThanOrEqual(3);
    // And the top rung is genuinely reached: the climb does not plateau on
    // mid-tier recipes and coast to the cap.
    expect(Math.max(...rungs)).toBe(Math.max(...ARMORCRAFTING_RECIPES.map((r) => r.skillReq)));
  });

  it('the bill draws on several distinct gathered materials and on non-gathered ones too', () => {
    const gathered = [...RUN.gatherHoursByMaterial.keys()];
    expect(gathered.length).toBeGreaterThanOrEqual(2);
    // Every gathered line carries real time; a zero-hour entry would mean a
    // material was counted as gathered but priced at nothing.
    for (const itemId of gathered) {
      expect(RUN.gatherHoursByMaterial.get(itemId), itemId).toBeGreaterThan(0);
    }
    // The vendor and mob-drop half is real and is deliberately free in this
    // model. Asserted non-zero so the "gathered materials dominate" premise
    // stays a measured fact: if the bill ever became all-gathered, the hour
    // figure would jump and this arm names why.
    expect(RUN.nonGatheredUnits).toBeGreaterThan(0);
    // Every gathered line in the bill reached the hour total and nothing else
    // did. Scope stated honestly: both sides of this equality derive from the
    // model's own loop, so it checks deriveMastery's INTERNAL consistency (a
    // material dropped from or double-counted in the hour map while the bill
    // lists it), never production. The production-facing teeth are the
    // mechanism literals in the pin arm below.
    const sources = gatheredSources();
    const billed = [...RUN.bill.keys()].filter((itemId) => sources.has(itemId));
    expect(new Set(gathered)).toEqual(new Set(billed));
    const recomputed = billed.reduce((hours, itemId) => {
      const source = sources.get(itemId)!;
      return (
        hours + Math.ceil(RUN.bill.get(itemId)! / source.unitsPerCast) / harvestsPerHour(source)
      );
    }, 0);
    expect(RUN.gatherHours).toBeCloseTo(recomputed, 10);
    // And the split is real on both sides: the non-gathered ids are exactly
    // the bill's remainder, so a reagent cannot be priced twice or not at all.
    expect(billed.length).toBeLessThan(RUN.bill.size);
  });

  it('mastery lands inside the derived gather-hour window', () => {
    // The headline. A reagent-bill edit, a gain-curve retune, a node-count
    // or respawn change, or a specialization-discount tune all move this
    // number, and the bite arm below shows the bounds are reachable.
    expect(
      RUN.gatherHours,
      `derived ${RUN.gatherHours.toFixed(2)} gather hours from ${RUN.crafts} crafts; bill ${[
        ...RUN.bill.entries(),
      ]
        .map(([id, n]) => `${id} x${n}`)
        .join(', ')}`,
    ).toBeGreaterThanOrEqual(MIN_GATHER_HOURS);
    expect(RUN.gatherHours).toBeLessThanOrEqual(MAX_GATHER_HOURS);
  });

  it('the ALL-ZONES supply floor sees the expansion faucets (the un-blinded arm)', () => {
    // This arm replaced the KNOWINGLY BLIND note the phase 11 QA left: the
    // tuned-circuit floor above cannot see the grind turning trivially
    // short, because ten starter zones re-grant thorium_ore and one
    // re-grants iron_ore. Price the SAME bill against the whole world's
    // ceilings and hold a floor there instead. Measured 2.82 hours at the
    // time of writing; the floor at 2 is the trivially-short alarm with
    // headroom for a starter-node nudge, and the upper relation is derived,
    // not a literal: world supply can only lower hours, never raise them.
    const billed = [...RUN.bill.entries()].filter(([id]) => allZonesHarvestsPerHour(id) > 0);
    const allZonesGatherHours = billed.reduce(
      (hours, [id, units]) => hours + units / allZonesHarvestsPerHour(id),
      0,
    );
    expect(allZonesGatherHours).toBeGreaterThanOrEqual(2);
    expect(allZonesGatherHours).toBeLessThanOrEqual(RUN.gatherHours);
    // Non-vacuity, both ways: the arm really sees supply the tuned circuit
    // does not (thorium alone is granted well beyond Thornpeak), and the
    // billed set matches the tuned model's gathered set exactly.
    expect(allZonesHarvestsPerHour('thorium_ore')).toBeGreaterThan(
      allZonesHarvestsPerHour('copper_ore'),
    );
    expect(allZonesHarvestsPerHour('thorium_ore')).toBeGreaterThanOrEqual(
      (6 * 3600) / NODE_HARVEST_TABLE.ore.respawnSeconds + 1,
    );
    expect(billed.map(([id]) => id).sort()).toEqual([...RUN.gatherHoursByMaterial.keys()].sort());
  });

  it('the window bites: inflating or trimming the reagent bill leaves it', () => {
    // The assertion above is only worth having if it can fail. Re-run the
    // identical derivation over a scaled copy of the real recipe table and
    // show both bounds are reachable. Scaling only the GATHERED reagents,
    // because those are the ones the hour figure is a function of.
    const sources = gatheredSources();
    const scaled = (factor: number): ProfessionRecipeRecord[] =>
      ARMORCRAFTING_RECIPES.map((recipe) => ({
        ...recipe,
        reagents: recipe.reagents.map((reagent) =>
          sources.has(reagent.itemId)
            ? { ...reagent, count: Math.max(1, Math.round(reagent.count * factor)) }
            : reagent,
        ),
      }));

    const inflated = deriveMastery(scaled(3), ATTUNEMENT);
    expect(inflated.crafts).toBe(RUN.crafts); // the gain curve is untouched
    expect(inflated.gatherHours).toBeGreaterThan(MAX_GATHER_HOURS);

    const trimmed = deriveMastery(scaled(0.34), ATTUNEMENT);
    expect(trimmed.crafts).toBe(RUN.crafts);
    expect(trimmed.gatherHours).toBeLessThan(MIN_GATHER_HOURS);
  });

  it('the window bites on the supply side too: halving node density leaves it', () => {
    // The other lever the hour figure rides on, and the one this file shares
    // with tests/gather_node_placement.test.ts. Recomputing the total against
    // a halved harvest ceiling says something real about the SHIPPED bill:
    // the headroom between the measured total and the upper bound is less
    // than a factor of two, so a node-count or respawn change of that size
    // reddens the window rather than sliding under it. If the bill ever
    // shrank far enough for that to stop holding, this arm reports it.
    const sources = gatheredSources();
    let halvedDensityHours = 0;
    for (const [itemId, units] of RUN.bill) {
      const source = sources.get(itemId);
      if (!source) continue;
      const casts = Math.ceil(units / source.unitsPerCast);
      halvedDensityHours += casts / (harvestsPerHour(source) / 2);
    }
    expect(halvedDensityHours).toBeGreaterThan(MAX_GATHER_HOURS);
  });

  it('pins the mechanisms the window is too wide to feel', () => {
    // The [5, 10] window is a balance ALARM, not a mechanism guard: removing
    // the specialization material discount lands the model at 8.61 hours and
    // deleting the tier gain curve lands it at 5.56, both comfortably inside
    // the window (hand-run mutations, QA round). These literals are the
    // mechanism teeth. A deliberate retune updates them consciously; a
    // silently deleted mechanic reddens them.
    //
    // Discount ON: the specialized rungs charge the discounted thorium bill,
    // and the lower rungs' bills are pinned too, so the bottom half of the
    // ladder (which consumes no thorium at all) cannot reshape silently
    // under the window either.
    expect(RUN.bill.get('thorium_ore')).toBe(450);
    expect(RUN.bill.get('iron_ore')).toBe(100);
    expect(RUN.bill.get('copper_ore')).toBe(75);
    // Gain curve ON: the whole per-rung craft vector, not just the top rung.
    const craftsPerRung = new Map<number, number>();
    for (const [id, uses] of RUN.recipeUse) {
      const rung = ARMORCRAFTING_RECIPES.find((r) => r.id === id)?.skillReq ?? -1;
      craftsPerRung.set(rung, (craftsPerRung.get(rung) ?? 0) + uses);
    }
    expect([...craftsPerRung.entries()].sort(([a], [b]) => a - b)).toEqual([
      [0, 25],
      [25, 25],
      [50, 25],
      [75, 75],
    ]);
    // And the dominant gathered line reaches the hour total through a real
    // per-material figure (the split assertion above only checks the model's
    // own internal consistency; this is the production-facing number).
    expect(RUN.gatherHoursByMaterial.get('thorium_ore')).toBeCloseTo(5.0, 2);
  });

  it('the self-signed reduction the model deliberately skips is itself alive', () => {
    // The walk prices hasSelfSigned false everywhere (a stated UP bias), so
    // nothing in the derivation would notice the #1145 reduction being
    // deleted. Pin the reduction directly: a self-signed crafter pays one
    // unit less on a multi-unit reagent, never below one.
    const recipe = ARMORCRAFTING_RECIPES.find((r) =>
      r.reagents.some((reagent) => reagent.count > 1),
    );
    expect(recipe, 'a multi-unit reagent recipe exists').toBeDefined();
    const reagent = recipe!.reagents.find((r) => r.count > 1)!;
    const skills = emptyCraftSkills();
    const withSigned = requiredReagentCountFor(true, reagent, skills, CRAFT).count;
    const without = requiredReagentCountFor(false, reagent, skills, CRAFT).count;
    expect(withSigned).toBe(without - 1);
    // And the floor: a single-unit reagent never discounts below one.
    const single = requiredReagentCountFor(
      true,
      { itemId: reagent.itemId, count: 1 },
      skills,
      CRAFT,
    );
    expect(single.count).toBe(1);
  });
});
