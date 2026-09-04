// Farming command logic, behind the SimContext seam (the growth engine).
// plantCrop puts a crop in a bed and harvestCrop takes it out; there is
// nothing in between, by design. Farming is a full gathering proficiency
// (GATHERING_PROFESSIONS.farming): a harvest queues a proficiency grant on
// the tick path like any other gathering harvest.
//
// THE ANTI-CHORE INVARIANT, stated once because every formula below answers
// to it: NOTHING ROTS. A plot that has passed its ready time stays exactly as
// valuable forever. Lateness is not an input to survival, to yield, or to
// proficiency gain, and no timer fires at the deadline. Two visits per crop
// cycle, ever. A change that makes a late harvest pay less than an on-time one
// is violating the design, not tuning it (pinned by the anti-chore arm in
// tests/professions_farming.test.ts).
//
// DRAW CONTRACT (the D4 determinism contract, stated here and pinned in
// tests/professions_farming.test.ts). RESTATED WHOLE at masterwrought Phase
// 11f, which added the golden BONUS draw; the discipline is that this header is
// re-stated in full rather than amended one line at a time, so it can never be
// edited into incoherence:
//   plant, success ............ EXACTLY 2 ctx.rng draws, one contiguous block,
//                               IDENTICAL UNDER EVERY KNOB COMBINATION
//   plant, every deny arm ..... 0 (the knob-payment denies included)
//   harvest, tier 1/2 crop .... EXACTLY 2 contiguous draws, the golden-harvest
//                               roll then the golden BONUS roll, on EVERY
//                               resolving arm (survived, withered, AND the
//                               defensive retired-crop arm; toniced included)
//   harvest, tier 3/4 crop .... EXACTLY 3 contiguous draws, the seed-back roll,
//                               then the golden-harvest roll, then the golden
//                               BONUS roll, on EVERY resolving arm (a retired
//                               id reads tier 1, so that arm spends the last
//                               two alone)
//   harvest, every deny arm ... 0
//   convert_husks ............. 0 (both outcomes)
//   the farm objective credit . 0 (quests/quest_credit.ts, pure state and
//                               events, called after plant and harvest)
//   growth deadline passing ... 0 (nothing runs at expiry: there is no timer)
//   login / save+load ......... 0
//   the tick sweep ............ 0 (updateFarming below draws nothing)
// The two plant draws are the WHOLE growth script: a survival roll and a
// yield seed, both stored in the plot's hidden slots (farm_projection.ts) and
// consumed at harvest. Harvest yield expands DETERMINISTICALLY from the
// pre-rolled yieldSeed through a local pure generator (mulberry32 below),
// NEVER through ctx.rng and never through Math.random: seed expansion of an
// already-drawn value is not a new draw, which is what keeps the yield itself
// draw-free no matter when, or on which host, the harvest happens. The draws
// a harvest DOES spend are its action-time rolls (harvestCrop below): the
// seed-back roll (tier 3/4 only), then the golden-harvest rare-event roll
// (EVERY tier, the shared gather_events roll), then the golden bonus roll
// (EVERY tier). All are REAL ctx.rng draws at harvest ACTION time,
// deliberately NOT expansions of the stored script, and D4-legal for the same
// reason the plant pre-roll is, because a harvest is a player action. The crop
// tier deciding whether the seed-back draw happens is an INPUT read from
// content, never an outcome, so conditioning on it can never fork the stream;
// the golden roll and the bonus roll are BOTH unconditional, and a WITHERED
// harvest spends them too and ignores the results (constant draw count per
// action: husks, never a celebration).
//
// WHY THE BONUS IS A REAL DRAW and not a further read into the mulberry32
// expansion of yieldSeed, which would have been cheaper and would have left
// this header and the farming_session golden untouched: that seed is already
// carrying four dependent reads (growth, yield, the fine-pick grade, the tonic
// arm), and stacking a fifth independent structure on one 32-bit value asks it
// to carry more than it was sized for. Rejected deliberately at decision C, and
// recorded so it is not re-proposed as an economy. The bonus draw is
// UNCONDITIONAL and READ ONLY WHEN THE GOLDEN ROLL WON, which is the shipped
// idiom for keeping stream position stable whichever arm resolves: spending a
// draw and ignoring it is exactly what the withered golden roll already does.
//
// THE KNOBS RULE, the phase's one hard law: KNOB EFFECTS NEVER CHANGE THE
// NUMBER OF RNG DRAWS. THEY CHANGE THRESHOLDS APPLIED TO ALREADY-DRAWN VALUES
// (compost and the watch raise the survival chance the stored roll is
// compared against; the tonic reads FURTHER into the mulberry32 expansion of
// the stored yield seed), SO THE CONTRACT ABOVE SURVIVES EVERY KNOB
// COMBINATION, and the UNTONICED expansion stays bit-identical per seed.
//
// VISUAL GROWTH STAGES are DERIVED, never stored, and are named here so the
// render phase has one definition to read rather than inventing a second. A
// plot's stage is a pure function of the elapsed fraction
// (nowMs - plantedAtMs) / (readyAtMs - plantedAtMs), cut into thirds:
//   [0, 1/3) sprout, [1/3, 2/3) seedling, [2/3, 1) maturing, >= 1 ready.
// No stored state, no persistence, no wire field: the projection already
// carries plantedAtMs and readyAtMs, which is everything a client needs to
// compute the stage itself.

import { bagPools, countFit } from '../bags';
import {
  FARM_COMPOST_ITEM_ID,
  FARM_GROWTH_TONIC_ITEM_ID,
  FARM_WITHERED_HUSK_ITEM_ID,
  type FarmCropDef,
  farmCropById,
  farmCropSkillThreshold,
  farmCropTier,
} from '../content/farm_crops';
import { FARM_BED_IDS, farmBedById, farmBedZoneId } from '../content/farm_patches';
import { ITEMS } from '../data';
import { onCropHarvestedForDeeds } from '../deeds';
import { countUnlockedInSlots, removeUnlockedFromSlots } from '../item_lock';
import { forceDismount } from '../mounts';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, FARMING_CAST_ID, INTERACT_RANGE, isConsuming } from '../types';
import { resolveFarmGoldenBonus } from './farm_golden_bonus';
import { type FarmPlantKnobs, farmPlotSurvived, type PlotState } from './farm_projection';
import { notifyFarmReady } from './farm_ready';
import { planWatchFee, type WatchFeeLeg } from './farm_watch_fee';
import { nearFarmerNpc } from './farmer_npcs';
import { updateFarmFeasts } from './feast';
import {
  announceGatherRareEvent,
  GATHER_RARE_EVENT_YIELD_MULT,
  rollGatherRareEvent,
} from './gather_events';
import { queueGatheringGrant } from './gathering';
import {
  applyToolEffectUse,
  bestOwnedGatherToolFor,
  canGatherTier,
  depleteEffect,
  NO_TOOL_OWNED,
  ratchetCeilingForUse,
} from './tools';
import { bestWieldableGatherToolTierOrNone } from './wield_gate';

// The golden BONUS table lives in its own pure leaf for the same reason the
// survival ramp does: it is a partition over one already-drawn value, with no
// SimContext and no rng of its own, so a Vitest can drive the whole [0, 1)
// interval directly instead of hunting seeds through a Sim. Re-exported here on
// the same precedent, because farming's engine surface is what callers and
// tests reach for.
export {
  FARM_GOLDEN_BONUS_PATTERN_CHANCE,
  FARM_GOLDEN_BONUS_PATTERN_IDS,
  FARM_TOP_CROP_TIER,
  farmGoldenBonusSeedTier,
  farmSeedIdsOfTier,
  resolveFarmGoldenBonus,
} from './farm_golden_bonus';
// The survival ramp lives with the STATUS it decides (farm_projection.ts, the
// pure leaf the wire projection is built from), so the projection can read it
// without importing this module and its SimContext seam. Re-exported here
// because farming's engine surface is what callers and tests reach for.
export {
  FARM_SURVIVAL_AT_GATE,
  FARM_SURVIVAL_BAND_SPAN,
  FARM_SURVIVAL_COMPOST_BONUS,
  FARM_SURVIVAL_WATCH_BONUS,
  farmPlotSurvived,
  farmSurvivalChance,
} from './farm_projection';

// How long the planting animation runs. Pure flavor: the plant has ALREADY
// resolved by the time this cast starts (see plantCrop), so castTotal carries
// no hidden information and the completion arm in combat/casting_lifecycle.ts
// dispatches nothing. TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER.
export const FARM_PLANT_CAST_SEC = 2;

// Harvest-lives yield (the D7 model). A plot starts with a floor of lives;
// each pick rolls a skill-scaled chance NOT to consume one, and the loop stops
// when the lives run out or the pick cap is reached.
//
// TUNING, ALL FOUR PROVISIONAL, FLAGGED FOR THE MAINTAINER. At skill 0 the
// keep chance is 0.15, so a plot pays about 3.5 picks; at the farming cap of
// 100 it is 0.50, so about 6. The pick cap is a hard bound on the loop rather
// than a balance number: it can only bind at a keep chance no shipped skill
// reaches, and it exists so a future tuning pass cannot turn this into an
// unbounded loop. NOTE for any reader treating it as the yield ceiling: the
// tonic bonus lands OUTSIDE the loop, so a capped toniced harvest returns up
// to FARM_HARVEST_PICK_CAP + FARM_TONIC_BONUS_PICKS picks (pinned); this
// constant bounds the LOOP, never the returned yield.
export const FARM_HARVEST_LIFE_FLOOR = 3;
export const FARM_HARVEST_PICK_CAP = 12;
export const FARM_KEEP_CHANCE_BASE = 0.15;
export const FARM_KEEP_CHANCE_SKILL_SCALE = 0.35;
// The chance one pick comes up as the crop's fine twin instead of its base
// grade. A fine pick UPGRADES a pick rather than adding one, so this shifts
// yield value without touching yield count.
export const FARM_FINE_CHANCE_BASE = 0.02;
export const FARM_FINE_CHANCE_SKILL_SCALE = 0.08;
// The slotted QUALITY tool effect's farming arm (the hoe phase, C3): a
// charged Artisan's Eye on the farming slot adds this flat fine-chance bump
// per bonus point instead of a grade-tier bump, because farming has no node
// grade path (the fine twin IS its fine grade, minted by the harvest roll).
// Applied to the threshold already-expanded rolls are compared against, so it
// is draw-free and position-independent by construction. TUNING, PROVISIONAL,
// FLAGGED FOR THE MAINTAINER: 0.10 per point doubles the cap-skill fine rate
// (0.10 to 0.20) and quintuples the skill-0 rate (0.02 to 0.12), sized so the
// charm reads as the same "better yield off the same picks" promise the node
// quality effect keeps, and priced by the same charge spend (one charge per
// harvest the bump actually upgraded, the R42 predicate in harvestCrop).
export const FARM_FINE_CHANCE_EFFECT_BONUS = 0.1;
// The growth tonic's yield arm (D7: one knob one job, tonic is yield). A
// tonic armed at plant time gives the harvest ONE further roll against this
// chance; a win adds the flat bonus picks below, granted at BASE grade. Both
// TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: a coin flip for two extra
// picks is "a chance of a mildly larger harvest" against the guaranteed
// floor of 3, an expected value of one pick per tonic.
export const FARM_TONIC_BONUS_CHANCE = 0.5;
export const FARM_TONIC_BONUS_PICKS = 2;
// The cap FARMING puts on a slotted quantity tool effect, and it lives HERE
// rather than in the catalog on purpose (masterwrought DECISION C).
//
// WHY A CAP AT ALL. The Maker's Charm is a quantity effect with a catalog bonus
// of 2, which is exactly FARM_TONIC_BONUS_PICKS, and the two STACK. Uncapped
// that is +4 picks on a guaranteed floor of 3, more than doubling yield per
// harvest against a fixed demand, and it also leaves the alchemy growth tonic
// with no reason to exist. This is a SUPPLY control, not a power nerf.
//
// WHY HERE AND NOT IN TOOL_EFFECTS. Lowering makers_charm.bonus would silently
// re-tune mining, logging and herbalism, where the charm is correctly worth its
// full 2, and it would break the pin tying the "+2" prose back to the catalog.
// Capping in farming's own mapping is what keeps the other three untouched.
//
// THE HONEST CONSEQUENCE, recorded rather than buried: on a hoe the Maker's
// Charm and the Gatherer's Cache now pay the SAME bonus, because the cache's
// catalog bonus is already 1. The charm keeps its full 2 everywhere else.
export const FARM_EFFECT_BONUS_PICK_CAP = 1;
// The skill the scales above are expressed against: the farming proficiency
// cap (GATHERING_PROFESSIONS.farming maxSkill), so "at the cap" reads
// literally in the formulas.
const FARM_SKILL_SCALE_DENOM = 100;

// What a failed crop pays out instead of produce. TUNING, PROVISIONAL,
// FLAGGED FOR THE MAINTAINER: a failure is a smaller reward, never a
// punishment (the anti-chore thesis), and the knobs phase turns husks into
// the next attempt's insurance.
export const FARM_WITHERED_HUSK_COUNT = 2;
export type { FarmPlantKnobs } from './farm_projection';
// The item id itself lives in the content layer (content/farm_crops.ts) so the
// material taxonomy can read it as data without importing this engine module;
// re-exported here because this is where callers and tests reach for it.
// The knob-supply ids, same content-layer home and re-export rationale; the
// knob payload type above rides along for the same reason. The fee planner is
// NOT re-exported: its callers and its suite import farm_watch_fee.ts
// directly, and a convenience surface nobody reaches through is dead code.
export { FARM_COMPOST_ITEM_ID, FARM_GROWTH_TONIC_ITEM_ID, FARM_WITHERED_HUSK_ITEM_ID };

// How many husks one compost costs at the farmer's trade (convertHusks
// below). TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: a failed crop pays
// FARM_WITHERED_HUSK_COUNT (2) husks, so at 2 husks per compost ONE failure
// converts into exactly ONE compost, which is D6's "failure composts into the
// next attempt's insurance" read literally; it is also value-neutral at the
// vendor (2 husks at sellValue 1 make 1 compost at sellValue 2).
export const FARM_HUSKS_PER_COMPOST = 2;

// Seed-back at harvest for the HIGH-TIER crops (the crop-ladder phase's
// economy arm). A harvest of a tier FARM_SEED_BACK_MIN_TIER or higher crop
// rolls ONCE against its tier's pair of thresholds below (one draw, two
// thresholds: under the two-chance it pays 2 of the crop's own seeds, else
// under the one-chance it pays 1, else 0), on BOTH outcomes, survived and
// withered. Tier 1 and 2 crops draw NOTHING at harvest: their seeds are
// vendor-PRICED and stocked at the farmer NPCs (the go-live counters), so
// the market pressure this exists for does not apply to them.
//
// TUNING, ECONOMY-SENSITIVE, and RE-STATED at the Phase 11e QA because GATE 1
// falsified the reason this block used to give. It read "tier 3/4 seeds are
// market goods with NO vendor faucet", which was true when the rates were
// authored and is not true now: Phase 11e stocked all eight upper-tier seeds
// at Hollis and Verbena. The RATES are unchanged and still defensible, on a
// reason that survives the faucet: the seed-back is what keeps a farmer who
// is already farming from paying the counter on every single replant, and the
// counter's price is deliberately the bootstrap premium (sell x 4 x 2, the
// masterwrought DECISION D rung), so the return is a discount on a route that
// exists rather than the only route there is. At these rates a tier-3 harvest
// expects 0.48 seeds back (2 x 0.08 + 1 x 0.32) and a tier-4 harvest 0.41
// (2 x 0.06 + 1 x 0.29), so roughly every second high-tier harvest replants
// itself and every other plant buys its seed, now from the counter or the
// market rather than the market alone.
//
// RULED (qr-19-seed-back-rates, 2026-09-01, under qr-19-best-for-project):
// the four rates and FARM_SEED_BACK_MIN_TIER 3 are RATIFIED as shipped, no
// retune. The re-argument above IS the answer: the faucet falsified the
// premise these numbers were authored on, they were re-checked against the
// faucet and still found defensible, and no phase or QA sweep since has
// filed a finding against the 0.48 and 0.41 per-harvest expectation. No
// replant-cost model or market price series supports a retune.
export const FARM_SEED_BACK_MIN_TIER = 3;
export const FARM_SEED_BACK_TWO_CHANCE: Readonly<Record<number, number>> = { 3: 0.08, 4: 0.06 };
export const FARM_SEED_BACK_ONE_CHANCE: Readonly<Record<number, number>> = { 3: 0.4, 4: 0.35 };

// Per-harvest proficiency gain schedule, the fishing FISHING_GAIN_SCHEDULE
// shape scaled to farming's cap of 100: the breakpoints are the band
// boundaries and the gain halves at each one.
//
// TUNING, DERIVED, NOT FELT. masterwrought R19 forbids tuning a gathering
// curve from feel, so these four literals are the OUTPUT of a measured
// calendar model, not an input to one. The model lives in
// tests/helpers/farming_calendar_model.ts, its inputs are read from shipped
// content (FARM_PATCHES bed counts, farmCropSkillThreshold gates,
// farmingTeachingCeilingFor ceilings, farmSurvivalChance), and
// tests/professions_farming.test.ts re-derives this table from it. The full
// derivation is restated below so the code and its pin cannot drift.
//
// HOW THESE FOUR NUMBERS ARE FORCED, in three steps a reader can redo:
//  1. EXACTNESS. Grants accumulate by plain float addition in
//     applyGrantClamped with no rounding anywhere, so a gain that is not a
//     dyadic rational drifts and a band boundary is missed. The shipped
//     0.1 and 0.02 were both inexact and the ladder proved it: 0.1 x250 from
//     50 lands on 74.99999999999957 and cost a 251st harvest, 0.02 x1250 from
//     75 cost a 1251st, and the full ladder ended at 99.9999999999946 rather
//     than 100. Every gain here is a negative power of two, so every band
//     lands on its boundary exactly.
//  2. SHAPE. A strict halving ladder spends a scale-INDEPENDENT 34 percent of
//     the calendar on the first fifty points, whatever the head gain is. The
//     shipped curve halved once and then took fifths, which is why its front
//     fifty points were 9.7 percent of a 65 day climb: the defect was the
//     FRONT, never the total.
//  3. SCALE. With the shape fixed, halving the head doubles the calendar, so
//     the family is 18.5, 37.0, 74.0, 148.0 days for the reference farmer.
//     Exactly ONE member lands inside masterwrought DECISION A's settled
//     window of about ten weeks (70 to 75 days), and it is this one: 74.00
//     days, 1500 harvests, 25.2 days to skill 50.
//
// NOT UNIFORMLY A SLOWDOWN, which is easy to assume from "the ladder got
// longer" and is wrong at the top. Per band the gain moves x0.25, x0.25,
// x0.625 and x1.5625: the last band is FASTER than before (0.02 to 0.03125),
// because straightening the curve means taking time out of the tail as well as
// putting it into the front. A live farmer parked in the 75-to-100 band
// therefore progresses faster after this deploy, not slower. No migration is
// needed (stored proficiency is untouched), but it is a release-note line
// rather than a silent change.
//
// THE boundary column is NOT tuning and never moves: farmingTeachingCeilingFor
// reads it to decide which crop tier grays out at which skill, so a moved
// boundary silently re-maps tier to ceiling for every farmer alive. Only the
// gain column is tunable here.
export const FARMING_GAIN_SCHEDULE = [
  { belowProficiency: 25, gain: 0.25 },
  { belowProficiency: 50, gain: 0.125 },
  { belowProficiency: 75, gain: 0.0625 },
  { belowProficiency: 100, gain: 0.03125 },
] as const;

// The schedule half of the gain model, with no crop ceiling. Deterministic
// fractional amounts, NEVER a skill-up roll and never an rng draw: the first
// schedule row the proficiency sits below wins, and at or past the last row
// the gain is 0 (the maxSkill clamp in applyGrantClamped is the real stop).
//
// GRANT SITES DO NOT BELONG HERE, the fishingCatchGain banner's farming twin:
// this is the schedule half only, kept exported for the derivation tests. Any
// code granting farming proficiency must call farmingHarvestGainAt below, or
// the grant site silently reintroduces uncapped tier-1 farming gain.
export function farmingHarvestGain(proficiency: number): number {
  for (const row of FARMING_GAIN_SCHEDULE) {
    if (proficiency < row.belowProficiency) return row.gain;
  }
  return 0;
}

/** The teaching ceiling one crop tier can carry a farmer to, DERIVED from the
 *  schedule's own row boundaries rather than a second constant set, so the two
 *  halves of the model cannot drift (the fishingTeachingCeilingFor template).
 *  Tier 1 teaches through the first two rows and grays at 50, tier 2 to 75,
 *  tier 3 and up to the cap of 100. The crop-ladder phase shipped all eight
 *  crops (two per tier, farm_crops.ts), so every ceiling is reachable in
 *  live content: a farmer climbs off tier-1 crops at 50 and off tier-2 at
 *  75, exactly as an angler climbs the water tiers. */
export function farmingTeachingCeilingFor(cropTier: number): number {
  const row = Math.max(1, Math.min(cropTier, FARMING_GAIN_SCHEDULE.length - 1));
  return FARMING_GAIN_SCHEDULE[row].belowProficiency;
}

/** The full gain model: the schedule amount, zeroed at or past the crop's
 *  teaching ceiling. Pure and draw-free like both halves; a graying crop
 *  returns 0, which queueGatheringGrant drops. */
export function farmingHarvestGainAt(proficiency: number, cropTier: number): number {
  if (proficiency >= farmingTeachingCeilingFor(cropTier)) return 0;
  return farmingHarvestGain(proficiency);
}

/** mulberry32: a tiny deterministic uint32 generator. This is SEED EXPANSION
 *  of a value ctx.rng already drew at plant time, NOT a new source of
 *  randomness, which is the whole reason a harvest can draw zero. It never
 *  touches ctx.rng, Math.random, or any clock, so the same yieldSeed produces
 *  the same harvest on every host, at every time, forever.
 *
 *  NOT a drop-in for src/sim/rng.ts's Rng, and the difference is silent: Rng's
 *  constructor remaps seed 0 to 0x9e3779b9, while this keeps 0 as 0. Consolidating
 *  the two generators would therefore change the harvest of any plot whose stored
 *  yieldSeed is exactly 0, with no test naming the seed and nothing else to say
 *  so. If they are ever unified, the seed-0 case has to move deliberately or be
 *  preserved. (Recorded by the Phase 11d QA architecture audit; the tree's other
 *  private sub-stream, src/sim/mob/idle_rng.ts, uses Rng and inherits the remap.) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

export interface FarmHarvestYield {
  /** Base-grade units granted (tonic bonus picks included: they land at base
   *  grade, see resolveFarmHarvest). */
  count: number;
  /** Fine-grade units granted; picks that upgraded, so count + fine = picks. */
  fine: number;
  /** Total picks resolved: the lives loop plus any tonic bonus. */
  picks: number;
}

/** Expand a plot's pre-rolled yieldSeed into its harvest, at the farmer's
 *  CURRENT proficiency.
 *
 *  Pure and draw-free (see mulberry32 above). `skill` is deliberately NOT
 *  clamped here: production always passes a real proficiency, which the
 *  profession's own maxSkill already bounds at 100, and leaving it open is
 *  what lets a test drive the keep chance to 1 and prove the pick cap is a
 *  reachable bound rather than a decoration. The keep chance itself caps at 1,
 *  where no pick ever consumes a life and the loop stops at the cap exactly.
 *
 *  Reading the CURRENT skill rather than a plant-time snapshot is the same
 *  player-favorable rule the survival ramp uses: proficiency only ever rises,
 *  so a plot left in the ground while its owner improves pays better, never
 *  worse. Lateness itself is not an input (the anti-chore invariant).
 *
 *  THE TONIC ARM IS SEED EXPANSION, NOT A DRAW (the knobs phase, and the caps
 *  rule the whole phase answers to): an armed tonic reads ONE value from an
 *  INDEPENDENT mulberry32 expansion of the same stored seed (the seed xor a
 *  fixed constant), and a win adds the flat bonus at base grade. The
 *  untoniced path is untouched, so its expansion is bit-identical to the
 *  pre-knob code for every seed (the same-seed determinism pin and the
 *  anti-chore late-harvest equality both guard this). The bonus roll's
 *  position is DELIBERATELY not "one read past the lives loop": the loop's
 *  length grows with skill, so a loop-relative read would move when the
 *  farmer skills up between planting and harvesting and could flip a tonic
 *  win into a loss, breaking the player-favorable monotonicity stated above
 *  (the review round measured thousands of such regressions per million
 *  adjacent skill steps). Anchored to the seed alone, the tonic outcome is
 *  fixed at plant time and a skill-up can only ever add picks (pinned by the
 *  monotonicity sweep in tests/professions_farming.test.ts). */
export function resolveFarmHarvest(
  yieldSeed: number,
  skill: number,
  tonic = false,
  // The slotted-tool-effect arm (the hoe phase, C3), both halves DRAW-FREE
  // and position-independent like the tonic: `bonusPicks` (the quantity kind)
  // lands OUTSIDE the lives loop at base grade exactly the way the tonic
  // bonus does, and `fineChanceBonus` (the quality kind) only raises the
  // threshold the already-expanded fine rolls are compared against, so
  // neither can move a read's position in either stream. The default (no
  // effect) leaves every expansion bit-identical to the three-arg call.
  effect: { bonusPicks?: number; fineChanceBonus?: number } = {},
): FarmHarvestYield {
  const next = mulberry32(yieldSeed);
  const keepChance = Math.min(
    1,
    FARM_KEEP_CHANCE_BASE + (FARM_KEEP_CHANCE_SKILL_SCALE * skill) / FARM_SKILL_SCALE_DENOM,
  );
  const fineChance =
    FARM_FINE_CHANCE_BASE +
    (FARM_FINE_CHANCE_SKILL_SCALE * skill) / FARM_SKILL_SCALE_DENOM +
    (effect.fineChanceBonus ?? 0);
  let lives = FARM_HARVEST_LIFE_FLOOR;
  let picks = 0;
  let fine = 0;
  while (lives > 0 && picks < FARM_HARVEST_PICK_CAP) {
    picks++;
    // Both rolls happen for every pick, in this order, unconditionally: a
    // conditional draw would make the generator's position depend on the
    // outcome, which is the stream-forking trap the ctx.rng contract exists
    // to avoid, and it costs nothing to be regular here.
    const keepRoll = next();
    const fineRoll = next();
    if (keepRoll >= keepChance) lives--;
    if (fineRoll < fineChance) fine++;
  }
  let bonus = 0;
  if (tonic) {
    // The one tonic read, from its OWN expansion of the stored seed (see the
    // banner above: a loop-relative position would move with skill). The xor
    // constant is arbitrary and load-bearing only in that it differs from 0,
    // so the bonus stream never aliases the lives stream's first value.
    const bonusRoll = mulberry32((yieldSeed ^ 0x9e3779b9) >>> 0)();
    if (bonusRoll < FARM_TONIC_BONUS_CHANCE) bonus = FARM_TONIC_BONUS_PICKS;
  }
  // Bonus picks land at BASE grade: the tonic's job is a mildly larger
  // harvest (D7, one knob one job), not a second fine roll, and `count + fine
  // = picks` stays the one shape every consumer may rely on. A WITHERED plot
  // never reaches this resolver at all, so a tonic paid on a crop that loses
  // its survival roll is forfeited with the crop: the knob is a bet on the
  // harvest, by design, and the maintainer tuning pass should read it that
  // way (compost and the watch are the knobs that bend the wither odds).
  // Effect bonus picks (the quantity kind) land the same way: outside the
  // loop, at base grade, so the pick cap keeps bounding the LOOP and never
  // the returned yield, exactly as it does for the tonic.
  const effectPicks = effect.bonusPicks ?? 0;
  return {
    count: picks - fine + bonus + effectPicks,
    fine,
    picks: picks + bonus + effectPicks,
  };
}

export type { FarmGrowthStage } from './farm_projection';
export { farmGrowthStage } from './farm_projection';

/** Whether this farmer may plant this crop right now, as PURE state: the
 *  skill gate alone, taking the crop RECORD rather than an id.
 *
 *  Split out as the gate's pure-state seam: tests pin the threshold math
 *  directly (including synthetic records for shapes the catalog does not
 *  carry) and the command body below calls the same function, so the two
 *  can never disagree. The original reachability rationale (one shipped
 *  tier-1 crop made the command-level skill arm untestable) retired when
 *  the crop-ladder phase shipped all four tiers; the seam stays because a
 *  pure predicate beats an inline comparison either way. */
export function canPlantCrop(crop: FarmCropDef, farmingSkill: number): boolean {
  return farmingSkill >= farmCropSkillThreshold(crop.tier);
}

/** Flat-ground distance to a bed. Beds carry no y (FarmBedDef), so this is a
 *  plain 2D distance, the distToNode precedent in gathering.ts. EXPORTED for
 *  the client-side reach mirror (src/game/farm_bed_interact.ts), which used to
 *  re-derive this walk by comment contract; sharing the one function is what
 *  keeps the client's inclusive `<=` offer boundary the exact complement of
 *  the `>` deny below. */
export function distToBed(pos: { x: number; z: number }, bed: { x: number; z: number }): number {
  const dx = pos.x - bed.x;
  const dz = pos.z - bed.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function farmingSkillOf(meta: PlayerMeta): number {
  return meta.gatheringProficiency.farming ?? 0;
}

// ---------------------------------------------------------------------------
// plantCrop
// ---------------------------------------------------------------------------

/** Put a crop in a bed, with every plant-time choice riding the same call.
 *
 *  THE PLANT RESOLVES AT COMMAND TIME. Everything that decides an outcome (the
 *  seed and knob consumption, the two-draw pre-roll, the plot write, the
 *  event) happens here, before the cast even starts; the cast is pure flavor.
 *  That is a DELIBERATE deviation from every other non-spell cast in the
 *  codebase, where the completion does the work, and its consequence is the
 *  point: damage cancelling the cast leaves the plant standing, because the
 *  crop is already in the ground. A player who is interrupted mid-animation
 *  has still planted, and has not lost the seed for nothing.
 *
 *  Gate order is STATED and checked top to bottom. Every deny arm returns
 *  early, draws ZERO rng and consumes NOTHING, so a refused plant can never
 *  move the shared rng stream a harvest or a mob roll walks, and never costs
 *  an item: the knob gates below are affordability CHECKS, and every payment
 *  is spent together after the last gate has passed.
 *
 *  THE KNOBS BEND THRESHOLDS, NEVER THE DRAW COUNT (the phase's one hard
 *  rule): a knobbed plant draws the same two values a plain plant draws, and
 *  the flags stored on the plot change only what those already-drawn values
 *  are later compared against (survival) or how the stored seed expands
 *  (tonic). The draw pin covers every knob combination. */
export function plantCrop(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  bedId: string,
  cropId: string,
  knobs: FarmPlantKnobs = {},
): void {
  // 1. Dead. The family's shared error line (already matcher-covered), never
  //    a farmDenied reason: no new wire enum arm for a state every command
  //    family refuses the same way.
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  // 2. Busy. Same literal fishing uses, for the same reason: one busy state,
  //    one sentence.
  if (p.castingAbility || isConsuming(p)) {
    ctx.error(meta.entityId, 'You are busy.');
    return;
  }
  // 3. Bad bed. A HARD GATE at the command, not merely at the load: the
  //    load-side allowlist can only clean up after a bad row already exists,
  //    so validating here is what stops a live writer bug (or a forged
  //    command) minting a plot on a bed that is not a bed. Sits above the
  //    range check because the range check needs the bed's position.
  const bed = farmBedById(bedId);
  if (!bed || !FARM_BED_IDS.has(bedId)) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'bad_bed', bedId, cropId });
    return;
  }
  // 4. Range: the same INTERACT_RANGE every gather node and NPC interaction
  //    answers to, so a bed is reached exactly like everything else in the
  //    world. Beds are laid out on a 5 yard pitch precisely so this reach
  //    never covers two of them at once.
  if (distToBed(p.pos, bed) > INTERACT_RANGE) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'range', bedId, cropId });
    return;
  }
  // 5. Bed taken. PER-PLAYER: `meta.farmPlots` is this farmer's own map, so
  //    another player's crop in the same bed never blocks (the shared-bed,
  //    private-plot model).
  if (meta.farmPlots.has(bedId)) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'bed_taken', bedId, cropId });
    return;
  }
  // 6. Bad crop: an id the catalog does not carry.
  const crop = farmCropById(cropId);
  if (!crop) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'bad_crop', bedId, cropId });
    return;
  }
  // 7. Skill: farming proficiency at or above the crop tier's band gate.
  const skill = farmingSkillOf(meta);
  if (!canPlantCrop(crop, skill)) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'skill', bedId, cropId });
    return;
  }
  // 8. Seed in bags. LOCK-AWARE (issue 3042, the v0.38.0 sync heal): a copy
  //    the owner locked is invisible to every farming sufficiency gate and
  //    spend below, the same disposal-boundary rule the lock module's header
  //    names for craft reagent consumption (crafting.ts is the idiom). On
  //    every deny below, ctx.countItem (RAW on purpose, the one legitimate
  //    raw read left in this file) splits the lock-only refusal from the
  //    genuine shortfall (the insufficientMaterialsIsLockOnly twin): when
  //    the raw count would have passed, the toast says 'locked' rather than
  //    claiming the player holds nothing they can see in their bags.
  if (countUnlockedInSlots(meta.inventory, crop.seedItemId) < 1) {
    const reason = ctx.countItem(crop.seedItemId, meta.entityId) >= 1 ? 'locked' : 'no_seed';
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason, bedId, cropId });
    return;
  }
  // 9 to 11: the knob gates (the knobs phase), in the payload's own order:
  // compost, then the watch fee, then the tonic. AFFORDABILITY CHECKS ONLY. A
  // requested knob that cannot be paid denies the WHOLE plant with nothing
  // consumed and zero draws; every payment is spent together below, after the
  // deliberate-action trio, beside the seed. An unrequested knob is never
  // checked: a plain plant must not start failing because a supply item ran
  // out.
  const wantCompost = knobs.compost === true;
  const wantWatch = knobs.watch === true;
  const wantTonic = knobs.tonic === true;
  // 9. Compost in bags (one per plant).
  if (wantCompost && countUnlockedInSlots(meta.inventory, FARM_COMPOST_ITEM_ID) < 1) {
    const reason =
      ctx.countItem(FARM_COMPOST_ITEM_ID, meta.entityId) >= 1 ? 'locked' : 'no_compost';
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason, bedId, cropId });
    return;
  }
  // 10. The watch fee: tier-scaled produce in kind, planned here and spent
  //     below. The predicate and the deterministic consumption order live in
  //     farm_watch_fee.ts (any farming produce of the crop's tier or below,
  //     mixed kinds allowed, lowest tier first, base before fine).
  let feePlan: readonly WatchFeeLeg[] | null = null;
  if (wantWatch) {
    feePlan = planWatchFee(crop.tier, (itemId) => countUnlockedInSlots(meta.inventory, itemId));
    if (!feePlan) {
      // The raw-count re-plan runs on the deny path only (draw-free): a plan
      // that exists with locks ignored means locks alone denied the fee.
      const rawPlan = planWatchFee(crop.tier, (itemId) => ctx.countItem(itemId, meta.entityId));
      const reason = rawPlan ? 'locked' : 'no_fee_produce';
      ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason, bedId, cropId });
      return;
    }
  }
  // 11. Tonic in bags (one per plant).
  if (wantTonic && countUnlockedInSlots(meta.inventory, FARM_GROWTH_TONIC_ITEM_ID) < 1) {
    const reason =
      ctx.countItem(FARM_GROWTH_TONIC_ITEM_ID, meta.entityId) >= 1 ? 'locked' : 'no_tonic';
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason, bedId, cropId });
    return;
  }
  // 12. The hoe gate (the crop-ladder phase's tool half, the #2343 rule's
  //     farming arm): planting a tier-N crop needs a WIELDABLE farming hoe of
  //     at least tier N anywhere in bags. The wield-filtered scan
  //     (professions/wield_gate.ts) is the ONE legal access scan per the R22
  //     banner in professions/tools.ts: the raw ownership scan would let a
  //     traded hoe skip its proficiency requirement, and the
  //     bare-hands-floored sibling would pass with no hoe at all. Sits AFTER
  //     every deny arm above and BEFORE the deliberate-action trio and the
  //     pre-roll block below: the deny draws ZERO rng, consumes nothing, and
  //     preserves stealth like every arm above it.
  const hoeTier = bestWieldableGatherToolTierOrNone(meta.inventory, 'farming', skill, ITEMS);
  if (hoeTier === NO_TOOL_OWNED || !canGatherTier(hoeTier, crop.tier)) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'tool', bedId, cropId });
    return;
  }

  // Deliberate action: breaks stealth, stands you up, dismounts. AFTER every
  // deny arm above, so a refused plant never reveals or unseats the player.
  ctx.breakStealth(p);
  if (p.sitting) ctx.standUp(p);
  // Auto-dismount family (the castStart arm in combat/casting_lifecycle.ts),
  // the same three lines fishing and gathering run at cast start: planting is
  // a deliberate cast, so a mounted farmer dismounts and an in-flight summon
  // channel is dropped, exactly as any ability cast does. Draw-free
  // (forceDismount is field writes plus a stat recalc), and ABOVE the pre-roll
  // block, so the two-draw contract is untouched no matter what state the
  // player planted from.
  if (p.mountKey !== '') forceDismount(ctx, p);
  if (p.mountCastKey !== '') {
    p.mountCastRemaining = 0;
    p.mountCastKey = '';
  }

  // The seed and every requested knob are spent together BEFORE the pre-roll,
  // so the draw block below is the last thing that happens and every path
  // reaching it is committed. Payments are pure slot field work (draw-free),
  // and each was proven affordable by its LOCK-AWARE gate above, in this
  // same synchronous body, so none can come up short here. The removal walk
  // is the lock module's (highest bag index first, locked slots never
  // victims), mirroring the crafting.ts reagent consumption; like there,
  // removeUnlockedFromSlots mutates the array only, so the quest hook fires
  // once for the whole payment below (plant_crop stays a HEAVY_SELF_CMDS
  // member, which is what keeps the self snapshot fresh).
  // The four legs can never alias one another: fee legs are produce and
  // fine-produce ids only, disjoint from every seed, compost, and tonic id
  // (pinned against the live catalog in tests/farm_watch_fee.test.ts), so
  // no leg can spend units another leg's gate already promised.
  removeUnlockedFromSlots(meta.inventory, crop.seedItemId, 1);
  if (wantCompost) removeUnlockedFromSlots(meta.inventory, FARM_COMPOST_ITEM_ID, 1);
  if (feePlan) {
    for (const leg of feePlan) removeUnlockedFromSlots(meta.inventory, leg.itemId, leg.count);
  }
  if (wantTonic) removeUnlockedFromSlots(meta.inventory, FARM_GROWTH_TONIC_ITEM_ID, 1);
  ctx.onInventoryChangedForQuests?.(meta);

  // ---- THE ONE PRE-ROLL BLOCK: EXACTLY TWO DRAWS, CONTIGUOUS, IN ORDER ----
  // Nothing may be inserted between, before, or after these two lines that
  // draws, and no arm above may be moved below them: the whole determinism
  // contract is that a plant is 2 draws and everything else is 0. The full
  // growth script is rolled HERE, at the player-action moment, so the growth
  // deadline passing later draws nothing on any host.
  const survivalRoll = ctx.rng.next();
  const yieldSeed = Math.floor(ctx.rng.next() * 0x100000000);
  // ------------------------- END OF THE DRAW BLOCK -------------------------

  // Absolute wall-clock deadline in the host's own lockoutNowMs base (the
  // raidLockouts idiom): crops keep growing while their owner is logged out,
  // which is what makes farming the check-in skill.
  //
  // FLOORED AT 1 to agree with the load side, which drops any row with
  // plantedAtMs <= 0 and floors its own re-anchor at the same 1. A fresh
  // offline Sim reports lockoutNowMs 0 before it has ticked, so an unfloored
  // write would store plantedAtMs: 0 and the very next load would SILENTLY
  // DESTROY that plot as a tampered row. The two floors are one rule stated at
  // both ends of the round trip; a plant on a ticked host is unaffected,
  // because every real clock is far above 1.
  const now = Math.max(ctx.lockoutNowMs(), 1);
  const plot: PlotState = {
    cropId: crop.id,
    plantedAtMs: now,
    readyAtMs: now + crop.durationMs,
    survivalRoll,
    yieldSeed,
    // The three knobs are set HERE, at plant time, and never again
    // (front-loaded choice: there is no mid-growth interaction of any kind).
    // Each flag is true exactly when its payment was consumed above.
    compost: wantCompost,
    watch: wantWatch,
    tonic: wantTonic,
    notified: false,
  };
  insertPlotSorted(meta.farmPlots, bedId, plot);

  // The flavor cast, started AFTER the plant has fully resolved. castTotal is
  // a constant that carries no hidden information (there is nothing left to
  // hide: the outcome is already written), and the completion arm dispatches
  // nothing.
  p.castingAbility = FARMING_CAST_ID;
  p.castTotal = FARM_PLANT_CAST_SEC;
  p.castRemaining = FARM_PLANT_CAST_SEC;
  p.castTargetId = null;
  p.channeling = false;
  // Drop any GCD-held queued spell press, the startFishing precedent: this
  // cast's end path never calls fireQueuedCast, so a slot that survived into
  // it would fire unprompted one tick after it ends.
  p.queuedCastAbility = null;
  p.queuedCastAim = null;
  ctx.emit({
    type: 'castStart',
    entityId: p.id,
    ability: FARMING_CAST_ID,
    time: FARM_PLANT_CAST_SEC,
  });
  // Text-free on purpose (the gatherResult idiom): the client logs its own
  // localized line.
  ctx.emit({ type: 'farmPlanted', pid: meta.entityId, bedId, cropId: crop.id });
  // The first-planting proof (the celebrations phase): one idempotent visited
  // mark at plant SUCCESS, the inline zone-mark idiom gathering.ts uses at
  // its grant site. Never reached from a deny arm; zero rng, so the two-draw
  // contract above is untouched.
  ctx.markVisited(meta, 'farm:planted');
  // The farm ACTION objective credit, LAST: after the plot write and the
  // farmPlanted event, so a credited plant is always a committed one, and
  // after ctx.onInventoryChangedForQuests above (the seed spend), so the
  // collect re-count lands before the action credit. Never reached from a
  // deny arm. Draw-free, so the two-draw contract above is untouched.
  // Through the SimContext seam like its sibling crediters (the Phase 18
  // fold; bound in buildSimContext beside onNodeGatheredForQuests).
  ctx.onCropFarmedForQuests('plant', crop.id, meta);
}

/** Insert a plot PRESERVING sorted bed order.
 *
 *  Load-bearing for rng-stream stability, not cosmetics: normalizeFarmPlots
 *  rebuilds this map in sorted key order on every load, so a live map built in
 *  plant order would iterate differently before and after a relog. Anything
 *  that ever walks the plot map and draws would then fork the stream on a
 *  round trip. Rebuilding the map is O(n) in a player's own plots (at most the
 *  23 authored beds) and happens once per plant, which is not a hot path.
 *  A bulk insert that skipped this would be the regression. */
function insertPlotSorted(plots: Map<string, PlotState>, bedId: string, plot: PlotState): void {
  plots.set(bedId, plot);
  const sorted = [...plots.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rows = sorted.map((id) => [id, plots.get(id) as PlotState] as const);
  plots.clear();
  for (const [id, row] of rows) plots.set(id, row);
}

// ---------------------------------------------------------------------------
// harvestCrop
// ---------------------------------------------------------------------------

/** Take a finished plot out of a bed. Draws ZERO rng on every deny path: the
 *  outcome was rolled at plant time and the yield expands deterministically
 *  from the stored seed. A resolving harvest spends its action-time rolls in
 *  the one draw block below, on EVERY resolving arm (survived, withered, and
 *  the defensive retired-crop arm): a tier 1/2 harvest draws EXACTLY TWO
 *  contiguous (the golden-harvest roll, then the golden BONUS roll), a tier
 *  3/4 harvest EXACTLY THREE contiguous (the seed-back roll, then those same
 *  two; a retired id reads tier 1, so that arm spends the last two alone).
 *  These counts are the file header's DRAW CONTRACT; when it moves, this
 *  restates with it rather than being left at the previous phase's numbers.
 *
 *  NO BUSY GATE, unlike plantCrop. Harvesting is instant (there is no cast to
 *  conflict with) and it is the SECOND of the two visits a crop cycle ever
 *  gets, so refusing it because a cast happens to be running would be a third
 *  required trip in disguise. It stays dead-gated and range-gated, which is
 *  what server authority actually needs. */
export function harvestCrop(ctx: SimContext, p: Entity, meta: PlayerMeta, bedId: string): void {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  const bed = farmBedById(bedId);
  if (!bed || !FARM_BED_IDS.has(bedId)) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'bad_bed', bedId });
    return;
  }
  if (distToBed(p.pos, bed) > INTERACT_RANGE) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'range', bedId });
    return;
  }
  const plot = meta.farmPlots.get(bedId);
  if (!plot) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'no_plot', bedId });
    return;
  }
  // Not ready. NOTE what is absent: there is no upper bound here and never
  // will be. A plot is harvestable from readyAtMs until the end of time.
  if (ctx.lockoutNowMs() < plot.readyAtMs) {
    ctx.emit({
      type: 'farmDenied',
      pid: meta.entityId,
      reason: 'not_ready',
      bedId,
      cropId: plot.cropId,
    });
    return;
  }
  const skill = farmingSkillOf(meta);
  const cropTier = farmCropTier(plot.cropId);
  const crop = farmCropById(plot.cropId);
  // The bed frees up on EVERY outcome below, withered included: one visit
  // takes the plot out, whatever it turned into.
  meta.farmPlots.delete(bedId);

  // ---- THE ONE HARVEST DRAW BLOCK: the seed-back roll (tier 3/4 only), ----
  // ---- then the golden-harvest roll, then the golden BONUS roll        ----
  // ---- (both of those on EVERY tier)                                   ----
  // REAL ctx.rng draws at harvest ACTION time, deliberately NOT seed
  // expansions: the tonic is seed-anchored because its outcome must be fixed
  // at plant time, while seed-back and the golden event are fresh rewards
  // decided by the harvest itself, D4-legal because a harvest is a player
  // action (the same legality the plant pre-roll rides). Never conflate the
  // two, and never anchor an expansion read to a skill-varying loop position
  // (the tonic lesson). One CONTIGUOUS block at this FIXED position:
  // immediately after the plot-outcome resolution gates above, BEFORE the
  // survived/withered branch and before every loop, so no draw's stream
  // position can ever depend on the outcome, the yield expansion's length, or
  // any knob. ALL THREE rolls happen on BOTH outcomes: the withered seed-back
  // consolation is DELIBERATE (a failed high-tier crop can still hand a seed
  // back beside its husks, the same failure-is-a-smaller-reward thesis),
  // while the withered path IGNORES its golden result below (husks, never a
  // celebration; the roll still spends its draw for the constant per-action
  // count) and never reads the bonus roll at all, since the bonus is read
  // only inside the golden arm. An outcome-scoped draw would fork the stream
  // by outcome besides. The seed-back roll is multi-threshold single draw: under the
  // two-chance it pays 2 seeds, else under the one-chance 1, else 0. Tier
  // 1/2 crops reach the seed-back arm and draw NOTHING there: the tier is an
  // INPUT read from content, never an outcome, so conditioning on it cannot
  // fork the stream, and a retired crop id reads tier 1 (farmCropTier's
  // fallback), so neither withered arm below can ever strand an ungrantable
  // seed-back.
  let seedBackCount = 0;
  if (cropTier >= FARM_SEED_BACK_MIN_TIER) {
    const seedBackRoll = ctx.rng.next();
    const twoChance = FARM_SEED_BACK_TWO_CHANCE[cropTier] ?? 0;
    const oneChance = FARM_SEED_BACK_ONE_CHANCE[cropTier] ?? 0;
    seedBackCount = seedBackRoll < twoChance ? 2 : seedBackRoll < oneChance ? 1 : 0;
  }
  // The golden-harvest roll (the celebrations phase): ONE draw on EVERY
  // harvest of EVERY tier through the SHARED gather-events roll (D12: the
  // same GATHER_RARE_EVENT_CHANCE cadence as the node flavors, never a
  // farming copy of the constant). It sits AFTER the seed-back roll so every
  // probed seed-back band keeps its stream position, and inside this block
  // for every reason stated above.
  const goldenFlavor = rollGatherRareEvent(ctx.rng, 'crop');
  // The golden BONUS roll (Phase 11f, decisions C and D): ONE draw on EVERY
  // harvest of EVERY tier, spent here and READ only if the golden roll above
  // won and the win survives the gates below. Unconditional for the same
  // reason the golden roll itself is: a draw whose EXISTENCE depended on an
  // outcome would fork the stream by outcome. Sits immediately after the
  // golden roll so both existing probed bands keep their stream positions, and
  // inside this block for every reason stated above. What the value BUYS is
  // resolved by a pure partition (professions/farm_golden_bonus.ts), so this
  // single value decides both which arm pays and which item it pays; a second
  // draw for "which one" would have broken the contract in the header.
  const goldenBonusRoll = ctx.rng.next();
  // ------------------------- END OF THE DRAW BLOCK -------------------------

  // The seed-back grant, ONE call site shared by both outcomes (the branch
  // below only decides which event carries the count). silent + callerLogs:
  // the farmHarvested or farmWithered event owns both halves of the feedback
  // for the whole visit (the #2430 one-line-per-farm-grant rule), and it
  // carries seedBackCount for the client's own seed-back line. `crop` is
  // always defined when the count is positive (an id the catalog dropped
  // reads tier 1 above and never rolls); the guard narrows the type rather
  // than expressing doubt.
  if (seedBackCount > 0 && crop) {
    ctx.addItem(crop.seedItemId, seedBackCount, meta.entityId, {
      silent: true,
      callerLogs: true,
    });
  }

  if (!farmPlotSurvived(plot, skill, cropTier)) {
    // The failure payout. Granted, not merely announced: a failed crop is a
    // smaller reward, never a punishment. No proficiency: the schedule pays
    // for a harvest, and there was nothing to harvest.
    //
    // silent + callerLogs: the farmWithered event below owns BOTH halves of
    // the player feedback (the gatherResult/fishingResult idiom, #2430). The
    // generic loot ding would stack on the event's own cue, and the hub's
    // "You receive:" line would be a second line for the one grant. Here that
    // second line is worse than duplication: it would announce a crop FAILURE
    // in the words of a reward.
    ctx.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_WITHERED_HUSK_COUNT, meta.entityId, {
      silent: true,
      callerLogs: true,
    });
    ctx.emit({
      type: 'farmWithered',
      pid: meta.entityId,
      bedId,
      cropId: plot.cropId,
      count: FARM_WITHERED_HUSK_COUNT,
      // Present ONLY when the seed-back roll above paid (the knobs
      // only-when-true wire precedent): a zero roll leaves the frame
      // byte-identical to the pre-field wire. The `crop` conjunct matches
      // the grant's own guard above, so this event can never advertise a
      // seed the grant skipped, no matter what farmCropTier's retired-id
      // fallback becomes (today the fallback reads tier 1 and the roll
      // never fires for a cropless plot, so the terms always agree).
      ...(seedBackCount > 0 && crop ? { seedBackCount } : {}),
    });
    // The farm ACTION objective credit fires on EVERY harvest outcome, the
    // withered one included (the visit is the deed; quests/quest_credit.ts),
    // after the husk grant and its event. Draw-free (the harvest contract
    // above holds); through the seam, see the plantCrop call site's comment.
    ctx.onCropFarmedForQuests('harvest', plot.cropId, meta);
    return;
  }
  // A crop whose catalog row retired between planting and harvesting: the
  // survival read above still works off the tier fallback, but there is no
  // item to grant. Pay husks rather than nothing, so a content change can
  // never silently eat a player's crop. Unreachable today (the load-side
  // allowlist drops a row naming a retired crop before it can get here).
  if (!crop) {
    // silent + callerLogs: see the withered arm's matching comment above,
    // same reasons and the same farmWithered event owning the feedback.
    ctx.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_WITHERED_HUSK_COUNT, meta.entityId, {
      silent: true,
      callerLogs: true,
    });
    ctx.emit({
      type: 'farmWithered',
      pid: meta.entityId,
      bedId,
      cropId: plot.cropId,
      count: FARM_WITHERED_HUSK_COUNT,
      // No seedBackCount arm here, and none can ever be owed: a retired crop
      // id reads tier 1 (farmCropTier's fallback), so the seed-back block
      // above never rolled for this plot.
    });
    // Every outcome credits, this defensive one included: the visit still
    // happened, whatever the catalog did to the crop id in between.
    ctx.onCropFarmedForQuests('harvest', plot.cropId, meta);
    return;
  }
  // An absent yieldSeed reads as 0 rather than refusing: the load side derives
  // a replacement for a lost slot, so this is unreachable for any real plot,
  // and where it is reachable at all a deterministic harvest beats a refusal.
  const yieldSeed = Number.isFinite(plot.yieldSeed) ? (plot.yieldSeed as number) : 0;
  // The slotted farming tool effect (the hoe phase, C3), applied through
  // applyToolEffectUse, the ONE confirm-gate owner (R40), exactly as the node
  // path does (gathering.ts resolveHarvest). harvest_crop carries NO confirm
  // channel on the wire, so `confirmed` is hard false here: an 'always' slot
  // ignores it and fires, while a 'prompt' slot skips WHOLE (no bonus, no
  // charge), the stale-client fail-safe direction. The kinds map
  // farming-natively, both halves draw-free and position-independent (the
  // tonic lesson: nothing anchors to a skill-varying loop position):
  //   quantity (Gatherer's Cache, Maker's Charm): flat bonus picks at base
  //     grade, added outside the lives loop exactly the way
  //     FARM_TONIC_BONUS_PICKS is, and CAPPED at
  //     FARM_EFFECT_BONUS_PICK_CAP by farming alone (see the
  //     constant's banner: the charm's catalog 2 stacks with the tonic's 2 for
  //     +4 on a floor of 3, which is a supply problem, and the cap belongs in
  //     farming's mapping so mining, logging and herbalism keep the full 2);
  //   quality (Artisan's Eye): a flat fine-chance bump
  //     (FARM_FINE_CHANCE_EFFECT_BONUS per bonus point), which only raises
  //     the threshold already-expanded rolls are compared against.
  // The unarmed expansion is kept beside the armed one as the same-seed
  // counterfactual the R42 charge settle below compares against.
  const slot = meta.toolEffectSlots?.farming;
  const effectUse = applyToolEffectUse(slot, { quantity: 0, gradeToolTier: 0 }, false);
  // The tonic flag stored at plant time arms the bonus arm of the expansion
  // (one further read of the same stream, never a ctx.rng draw; see the
  // resolveFarmHarvest banner).
  const base = resolveFarmHarvest(yieldSeed, skill, plot.tonic === true);
  const armed = effectUse.applied
    ? resolveFarmHarvest(yieldSeed, skill, plot.tonic === true, {
        bonusPicks: Math.min(effectUse.outcome.quantity, FARM_EFFECT_BONUS_PICK_CAP),
        fineChanceBonus: effectUse.outcome.gradeToolTier * FARM_FINE_CHANCE_EFFECT_BONUS,
      })
    : base;
  // The golden-harvest win (the celebrations phase), applied ONLY on this
  // survived branch: the roll spent its draw in the block above on every
  // outcome, and a withered plot pays husks, never a celebration. A win
  // five-folds BOTH grades AFTER the stored-seed expansion resolved them: a
  // pure multiply on already-expanded values positions no new read relative
  // to the skill-varying lives loop (the tonic lesson), and the R42 settle
  // below still compares the UN-multiplied expansions, which a shared factor
  // could not reorder anyway.
  // The bed's zone is the AUTHORED patch zone (farmBedZoneId, never
  // geometry), always defined for a bed that passed the bad_bed gate above.
  // Folded into `golden` so ONE belief gates the whole win: the windfall,
  // the zone announce, and the deed mark travel together, and a bed outside
  // an authored patch (impossible today) could never pay a silent windfall
  // (the single-guard rule from the phase review). The finder receives their
  // own zone line because the fanout filters recipients by zoneAt(player)
  // while this id is authored: the two agree for every shipped bed AND for
  // every spot a harvester can stand, pinned by the zone-containment arm and
  // the harvest-range halo arm (every point within INTERACT_RANGE of a bed
  // still resolves the bed's authored zone) in
  // tests/farm_patch_placement.test.ts.
  const zoneId = farmBedZoneId(bedId);
  // `!= null` on purpose (not `!== null`): gatherRareEventFlavor reads a
  // null-prototype record typed over the source union, so an out-of-union
  // runtime value (a prototype key included) comes back undefined, and a
  // strict null check would read that as a WIN. Unreachable with the shipped
  // literals; belt for the type lie.
  const golden = goldenFlavor != null && zoneId !== undefined;
  const count = golden ? armed.count * GATHER_RARE_EVENT_YIELD_MULT : armed.count;
  const fine = golden ? armed.fine * GATHER_RARE_EVENT_YIELD_MULT : armed.fine;
  // Whether every pick upgraded (THE ALL-FINE COLLAPSE, documented above the
  // farmHarvested emit below): computed here because the golden zone
  // announce must name the same collapsed item id the event names.
  const allFine = count === 0 && fine > 0;
  // The golden bonus item, assigned only inside the golden arm below and read
  // by the farmHarvested emit at the bottom. Declared here because the emit
  // sits outside that arm; an ordinary harvest leaves it undefined and the
  // field is omitted from the wire entirely (the only-when-set rule).
  let goldenBonusItemId: string | undefined;
  // Deliberately NOT capacity-gated. A crop the player already grew must not
  // be destroyed by full bags (nothing rots, and a refusal here would BE a
  // rot), so the grant force-adds over capacity exactly like the quest-catch
  // arm in completeFishing.
  //
  // silent + callerLogs on EVERY grant leg: the farmHarvested event below
  // owns both halves of the feedback for the whole harvest (the gatherResult
  // idiom, #2430), and it carries the base and fine counts together. Without
  // these flags a two-grade harvest would print THREE lines for one action,
  // two hub "You receive:" lines plus the event's own, and stack two loot
  // dings on the event's cue.
  if (golden) {
    // A golden windfall lands SIGNED, the node rare-event idiom (gathering.ts
    // resolveHarvest's signed arm): signed { signer } instances up to what
    // the bags genuinely fit (countFit models same-signer merge room plus
    // free slots, identical-payload stacking), then the plain
    // overflow-tolerant grant for the remainder. Farming's nothing-rots rule
    // outranks the signature: the TOTAL granted quantity is always the full
    // five-fold yield, and only the SIGNATURE truncates on full bags. The
    // truncation NAMES itself: one gatherDowngrade
    // { surface: 'crop', lost: 'mark' } per harvest command (the dedupe
    // idiom, even when both grades truncate), always 'mark' and never
    // 'find' because the units themselves always land here.
    // `capacity` is hoisted (slot capacity cannot change from a grant), but
    // grantGolden runs TWICE and the second countFit deliberately reads the
    // meta.inventory the first grant already mutated: the fine grade must
    // see the slots the base grade consumed. Do not "clean this up" by
    // snapshotting the inventory.
    const capacity = bagPools(meta.bags);
    let signatureTruncated = false;
    const grantGolden = (itemId: string, qty: number): void => {
      if (qty <= 0) return;
      const fit = countFit(meta.inventory, capacity, itemId, qty, { signer: meta.name });
      if (fit > 0) {
        ctx.addItemInstance(itemId, { signer: meta.name }, meta.entityId, fit, {
          silent: true,
          callerLogs: true,
        });
      }
      if (fit < qty) {
        signatureTruncated = true;
        ctx.addItem(itemId, qty - fit, meta.entityId, { silent: true, callerLogs: true });
      }
    };
    grantGolden(crop.produceItemId, count);
    grantGolden(crop.fineProduceItemId, fine);
    if (signatureTruncated) {
      ctx.emit({ type: 'gatherDowngrade', pid: meta.entityId, surface: 'crop', lost: 'mark' });
    }
    // THE GOLDEN BONUS (Phase 11f, decision D): exactly ONE extra item, off
    // the draw the block above already spent. This is the ONLY place that
    // roll is read, which is what makes it a constant-count draw rather than
    // a conditional one. PLAIN, not signed, and deliberately: the signature
    // marks the WINDFALL of the crop the farmer grew, while the bonus is a
    // seed or a recipe that came out of the moment, not out of the bed.
    //
    // Force-added over capacity like every grant above, for the same reason:
    // farming's nothing-rots rule. silent + callerLogs so the farmHarvested
    // event below still owns the whole visit's feedback in one line, and NO
    // second celebration beat is minted here: the golden windfall's existing
    // zone announce and its gather_event:golden_harvest visit mark are the
    // shared celebration family and Phase 13 has to live beside them.
    const bonusItemId = resolveFarmGoldenBonus(goldenBonusRoll, cropTier);
    ctx.addItem(bonusItemId, 1, meta.entityId, { silent: true, callerLogs: true });
    goldenBonusItemId = bonusItemId;
  } else {
    if (count > 0)
      ctx.addItem(crop.produceItemId, count, meta.entityId, { silent: true, callerLogs: true });
    if (fine > 0)
      ctx.addItem(crop.fineProduceItemId, fine, meta.entityId, { silent: true, callerLogs: true });
  }
  // The R42 charge settle plus the R47 use-time ratchet, the
  // completeGatherCast pattern. The ratchet's rarity read is the UNFILTERED
  // ownership scan on purpose, matching the node settle in gathering.ts and
  // the R30 recharge read ("the best tool the owner HOLDS"): the latch only
  // ever prices the slot UP, so an unwieldable carried hoe is the
  // anti-gaming case the rule exists for, not a scan bug (Phase 5 QA,
  // confirmed against the precedent). The ratchet latches on every APPLIED use
  // (taking the bonus alongside a better owned hoe is what re-prices the
  // slot), and the charge is spent only when the bonus actually changed what
  // the player received. Farming force-adds over capacity (nothing rots), so
  // the granted outcome IS the armed expansion and the same-seed
  // counterfactual compare is exact. Every arm here is pure field work: zero
  // ctx.rng draws, so the harvest's draw contract holds. No cast-start
  // capture arm: harvesting is instant (no cast window a trade could
  // exploit), so the one completion-time read covers both R47 ends.
  let effectDepleted = false;
  if (effectUse.applied && slot) {
    ratchetCeilingForUse(slot, bestOwnedGatherToolFor(meta.inventory, 'farming', ITEMS).rarity);
    if (armed.count !== base.count || armed.fine !== base.fine) {
      // The last-charge signal (the gatherResult settle's farming twin):
      // `spent` guards the durability read, because the read alone would
      // announce a depletion the settle never performed.
      const spent = depleteEffect(slot);
      effectDepleted = spent && slot.durability <= 0;
    }
  }
  // The zone celebration on a golden win, AFTER the grants (the gathering
  // order: announce once the windfall is really in the bags). The announce
  // writes the gather_event:golden_harvest visit mark for the finder
  // (announceGatherRareEvent; its reliquary field note fires for this flavor
  // too since masterwrought Phase 18 retired the deferral). Draw-free: the fanout and the
  // marks touch no rng, so the draw block's contract holds. The line names
  // the collapsed item id: on an all-fine harvest the primary grant IS the
  // fine item (the same rule the farmHarvested emit applies below, and the
  // node announce passes its actually-granted itemId the same way).
  if (golden) {
    announceGatherRareEvent(
      ctx,
      meta,
      { zoneId, type: 'crop' },
      goldenFlavor,
      allFine ? crop.fineProduceItemId : crop.produceItemId,
    );
  }
  // THE ALL-FINE COLLAPSE. The base fields describe the harvest's PRIMARY
  // grant, and when every pick upgrades there is no base-grade grant at all,
  // so the primary grant IS the fine item. Emitting the natural
  // `itemId: produce, count: 0` there would advertise a grant that never
  // happened (the grants above are correctly guarded by `> 0`; only the event
  // was not), and any client rendering a line off the base fields would print
  // "Vale Wheat x0". Rare but genuinely reachable: three picks all upgrading
  // is roughly one harvest in eight thousand at cap skill, which is a bug a
  // player eventually sees rather than a theoretical one.
  //
  // Collapsing SIM-SIDE is deliberate: the alternative is teaching every
  // client to special-case a zero count, and the client should never have to
  // know that this event has an impossible shape. Consumers get one rule
  // instead, and it holds on every path: `count` is always positive and
  // `itemId` is always something the player actually received.
  ctx.emit({
    type: 'farmHarvested',
    pid: meta.entityId,
    bedId,
    cropId: crop.id,
    itemId: allFine ? crop.fineProduceItemId : crop.produceItemId,
    count: allFine ? fine : count,
    // Absent when nothing upgraded AND when everything did: in the first case
    // there is no fine grade to name, in the second it has already been named
    // by the base fields. A present pair therefore always means a genuinely
    // MIXED harvest. Keeping them absent on the common path also leaves it
    // byte-identical to the pre-field wire (the stale-client doctrine).
    ...(fine > 0 && !allFine ? { fineItemId: crop.fineProduceItemId, fineCount: fine } : {}),
    // The seed-back count, present ONLY when the roll above paid (the knobs
    // only-when-true wire precedent): every tier 1/2 harvest and every
    // zero-band tier 3/4 harvest keeps the pre-field frame byte-identical.
    ...(seedBackCount > 0 ? { seedBackCount } : {}),
    // The golden bonus item, same only-when-set rule: present exactly on a
    // golden win, so every ordinary harvest's frame is byte-identical to the
    // pre-field wire. This is the ONLY feedback surface for the bonus grant,
    // which is force-added silently like every other leg of this harvest.
    ...(goldenBonusItemId !== undefined ? { goldenBonusItemId } : {}),
    // The last-charge signal, same only-when-true rule (the gatherResult
    // precedent): present exactly when the settle above emptied the slot.
    ...(effectDepleted ? { effectDepleted: true as const } : {}),
  });
  // The first-harvest chronicle mark (the celebrations phase), the SURVIVED
  // branch only: a withered plot never chronicles (the fish rule that weeds
  // and boots do not count), and no deny reaches here. The hook filters to
  // FARM_CHRONICLE_ZONES itself and writes the farm:<zone> mark. Marks only,
  // zero rng, draw-order neutral. The call is UNCONDITIONAL: the per-crop
  // farm_crop mark needs no zone, so a zone-resolution failure (impossible
  // today, pinned by tests/farm_crop_mark_zone_guard.test.ts's every-bed
  // arm) may drop only the ZONE half, never the collection credit. The ''
  // sentinel sits outside every chronicle zone, so the hook's own membership
  // filter is what skips the zone mark, exactly as any non-chronicle zone
  // already does.
  onCropHarvestedForDeeds(ctx, meta, zoneId ?? '', plot.cropId);
  // Proficiency through the shared gathering-grant queue, draining on the tick
  // path exactly like a node harvest. The gain is PURE STATE computed after
  // everything above (zero draws, zero draw reordering), and a 0 gain queues
  // nothing (queueGatheringGrant drops non-positive amounts).
  //
  // TIMING, EXPECTED AND DOCUMENTED: drainGatheringGrants runs in the
  // per-player loop EARLIER in the tick than any command dispatch, so a grant
  // queued from a command body lands on the NEXT tick, the same cadence every
  // other gathering grant has.
  queueGatheringGrant(meta, 'farming', farmingHarvestGainAt(skill, cropTier));
  // The farm ACTION objective credit, the survived arm: after the produce
  // grants, the farmHarvested event, and the proficiency queue, so a credited
  // harvest is always a committed one. Draw-free; through the seam (see the
  // plantCrop call site's comment). Never reached from a deny arm.
  ctx.onCropFarmedForQuests('harvest', plot.cropId, meta);
}

// ---------------------------------------------------------------------------
// convertHusks
// ---------------------------------------------------------------------------

/** Trade withered husks for compost at the fixed ratio above: failure turned
 *  into the next attempt's insurance (D6). ONE call converts EVERY complete
 *  batch in the sender's bags, so a farmer with a season's husks is one
 *  command away from their compost rather than one command per batch;
 *  a remainder below one batch stays in the bags untouched.
 *
 *  Draws ZERO rng on every path: the ratio is a constant and the batch count
 *  is arithmetic over the sender's own bag count.
 *
 *  THE LOCATION GATE IS A FARMER NPC IN REACH (the farming go-live). The
 *  design fiction is the farmer working the husks into compost, so the trade
 *  is refused, text-free with reason 'no_farmer' and nothing spent, unless
 *  the sender stands within FARMER_TRADE_RANGE of an NpcDef carrying the
 *  farmer flag (professions/farmer_npcs.ts nearFarmerNpc: the buyItem and
 *  nearBanker reach, INTERACT_RANGE + 2, so a player who can buy from the
 *  farmer can trade from the same spot). It gates THIS command only: plant,
 *  harvest and the watch fee are bed-side actions paid at the bed (D8/D9)
 *  and never look for a farmer. The gate sits right after the dead check
 *  and BEFORE the batch arithmetic, so a far-away sender learns the real
 *  reason rather than a phantom shortage, and the lock-only split below
 *  still speaks only to a sender who is actually at the counter.
 *
 *  NO BUSY GATE, the harvestCrop rationale: the trade is instant, conflicts
 *  with no cast, and refusing it during one would be a queue in disguise. The
 *  dead gate stays, the same shared error line every command family answers
 *  with. */
export function convertHusks(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return;
  }
  if (!nearFarmerNpc(ctx, p)) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'no_farmer' });
    return;
  }
  // LOCK-AWARE (issue 3042, the v0.38.0 sync heal): a locked husk stack is
  // neither counted toward a batch nor a removal victim, the same
  // disposal-boundary rule as the plant-time spends (crafting.ts idiom); the
  // quest hook fires once after the removal since the lock walk mutates the
  // array only.
  const husks = countUnlockedInSlots(meta.inventory, FARM_WITHERED_HUSK_ITEM_ID);
  const batches = Math.floor(husks / FARM_HUSKS_PER_COMPOST);
  if (batches < 1) {
    // The lock-only split, the plant gates' twin: a raw count that affords a
    // batch means locks alone denied the trade.
    const rawBatches = Math.floor(
      ctx.countItem(FARM_WITHERED_HUSK_ITEM_ID, meta.entityId) / FARM_HUSKS_PER_COMPOST,
    );
    const reason = rawBatches >= 1 ? 'locked' : 'no_husks';
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason });
    return;
  }
  const spent = batches * FARM_HUSKS_PER_COMPOST;
  removeUnlockedFromSlots(meta.inventory, FARM_WITHERED_HUSK_ITEM_ID, spent);
  ctx.onInventoryChangedForQuests?.(meta);
  // silent + callerLogs: the farmHusksConverted event below owns both halves
  // of the player feedback (the farmHarvested precedent, #2430). The generic
  // "You receive:" hub line would be a second line for the one trade, and
  // naming only the compost would hide what it cost.
  ctx.addItem(FARM_COMPOST_ITEM_ID, batches, meta.entityId, {
    silent: true,
    callerLogs: true,
  });
  ctx.emit({ type: 'farmHusksConverted', pid: meta.entityId, husks: spent, compost: batches });
}

// ---------------------------------------------------------------------------
// the tick sweep
// ---------------------------------------------------------------------------

/** The farming per-tick sweep. Draws ZERO rng and emits only the personal,
 *  text-free ready notice, so its position in the tick tail cannot fork the
 *  draw order (the updateProfNudges and updateDeeds precedent in the same
 *  tail); a reorder would still move farmReady's place in the drained event
 *  buffer, which is why it stays APPENDED where the growth phase put it.
 *
 *  Its ONE job is the ready notice (the ready-notice phase filled the body the
 *  growth phase reserved): announcing the plots that finished since the last
 *  look, through the shared once-only predicate in farm_ready.ts. Nothing else
 *  belongs here, because nothing else in farming is time-driven: growth is a
 *  pure comparison against an absolute deadline the projection makes for
 *  itself, so there is no timer to fire and no expiry work to do. In
 *  particular NOTHING ROTS on this path (the anti-chore invariant): the sweep
 *  reads state and flips one already-persisted flag, and can never change what
 *  a plot pays.
 *
 *  The 1 Hz guard is INTERNAL (the guild_letter idiom) rather than a caller's
 *  concern, and it sits first so the 19 ticks in 20 that do nothing cost one
 *  modulo and allocate nothing.
 *
 *  DELIBERATELY UNSHARDED: this shares the crowded % 20 === 0 residue with
 *  the other per-second sweeps, and a synchronized planting burst lands its
 *  notices on that same tick. The entity-id shard idiom (natures_fury.ts)
 *  would spread both, but it moves WHICH tick each notice emits on and so
 *  forks every parity golden; at the measured cost (sub-millisecond against
 *  the 50 ms budget at realm scale, visible under the 'farming' perf lap)
 *  the fork is not worth buying. Revisit only with tick-cost evidence. */
export function updateFarming(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 0) return;
  for (const meta of ctx.players.values()) notifyFarmReady(ctx, meta);
  // The shared-feast despawn check (zero charges or expiry) rides INSIDE this
  // driver behind the same 1 Hz guard, never a second appended sim.ts sweep;
  // it decides from stored state alone and draws zero rng (feast.ts header).
  updateFarmFeasts(ctx);
}
