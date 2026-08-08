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
// tests/professions_farming.test.ts):
//   plant, success ......... EXACTLY 2 ctx.rng draws, one contiguous block
//   plant, every deny arm .. 0
//   harvest, any outcome ... 0
//   growth deadline passing  0 (nothing runs at expiry: there is no timer)
//   login / save+load ...... 0
//   the tick sweep ......... 0 (updateFarming below draws nothing)
// The two plant draws are the WHOLE growth script: a survival roll and a
// yield seed, both stored in the plot's hidden slots (farm_projection.ts) and
// consumed at harvest. Harvest yield expands DETERMINISTICALLY from the
// pre-rolled yieldSeed through a local pure generator (mulberry32 below),
// NEVER through ctx.rng and never through Math.random: seed expansion of an
// already-drawn value is not a new draw, which is what keeps a harvest
// draw-free no matter when, or on which host, it happens.
//
// VISUAL GROWTH STAGES are DERIVED, never stored, and are named here so the
// render phase has one definition to read rather than inventing a second. A
// plot's stage is a pure function of the elapsed fraction
// (nowMs - plantedAtMs) / (readyAtMs - plantedAtMs), cut into thirds:
//   [0, 1/3) sprout, [1/3, 2/3) seedling, [2/3, 1) maturing, >= 1 ready.
// No stored state, no persistence, no wire field: the projection already
// carries plantedAtMs and readyAtMs, which is everything a client needs to
// compute the stage itself.

import {
  FARM_WITHERED_HUSK_ITEM_ID,
  type FarmCropDef,
  farmCropById,
  farmCropSkillThreshold,
  farmCropTier,
} from '../content/farm_crops';
import { FARM_BED_IDS, farmBedById } from '../content/farm_patches';
import { forceDismount } from '../mounts';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, FARMING_CAST_ID, INTERACT_RANGE, isConsuming } from '../types';
import { farmPlotSurvived, type PlotState } from './farm_projection';
import { queueGatheringGrant } from './gathering';

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
// unbounded loop.
export const FARM_HARVEST_LIFE_FLOOR = 3;
export const FARM_HARVEST_PICK_CAP = 12;
export const FARM_KEEP_CHANCE_BASE = 0.15;
export const FARM_KEEP_CHANCE_SKILL_SCALE = 0.35;
// The chance one pick comes up as the crop's fine twin instead of its base
// grade. A fine pick UPGRADES a pick rather than adding one, so this shifts
// yield value without touching yield count.
export const FARM_FINE_CHANCE_BASE = 0.02;
export const FARM_FINE_CHANCE_SKILL_SCALE = 0.08;
// The skill the scales above are expressed against: the farming proficiency
// cap (GATHERING_PROFESSIONS.farming maxSkill), so "at the cap" reads
// literally in the formulas.
const FARM_SKILL_SCALE_DENOM = 100;

// What a failed crop pays out instead of produce. TUNING, PROVISIONAL,
// FLAGGED FOR THE MAINTAINER: a failure is a smaller reward, never a
// punishment (the anti-chore thesis), and the knobs phase turns husks into
// the next attempt's insurance.
export const FARM_WITHERED_HUSK_COUNT = 2;
// The item id itself lives in the content layer (content/farm_crops.ts) so the
// material taxonomy can read it as data without importing this engine module;
// re-exported here because this is where callers and tests reach for it.
export { FARM_WITHERED_HUSK_ITEM_ID };

// Per-harvest proficiency gain schedule, the fishing FISHING_GAIN_SCHEDULE
// shape scaled to farming's cap of 100: the breakpoints are the band
// boundaries, halving then tapering the gain each step. TUNING, PROVISIONAL,
// FLAGGED FOR THE MAINTAINER.
export const FARMING_GAIN_SCHEDULE = [
  { belowProficiency: 25, gain: 1 },
  { belowProficiency: 50, gain: 0.5 },
  { belowProficiency: 75, gain: 0.1 },
  { belowProficiency: 100, gain: 0.02 },
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
 *  tier 3 and up to the cap. The consequence THIS PHASE, and it is deliberate:
 *  vale_wheat is the only shipped crop, so farming proficiency stops at 50
 *  until the crop-ladder phase authors tier 2, exactly as tier-1 water once
 *  capped an angler. */
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
 *  the same harvest on every host, at every time, forever. */
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
  /** Base-grade units granted. */
  count: number;
  /** Fine-grade units granted; picks that upgraded, so count + fine = picks. */
  fine: number;
  /** Total picks the lives loop resolved. */
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
 *  worse. Lateness itself is not an input (the anti-chore invariant). */
export function resolveFarmHarvest(yieldSeed: number, skill: number): FarmHarvestYield {
  const next = mulberry32(yieldSeed);
  const keepChance = Math.min(
    1,
    FARM_KEEP_CHANCE_BASE + (FARM_KEEP_CHANCE_SKILL_SCALE * skill) / FARM_SKILL_SCALE_DENOM,
  );
  const fineChance =
    FARM_FINE_CHANCE_BASE + (FARM_FINE_CHANCE_SKILL_SCALE * skill) / FARM_SKILL_SCALE_DENOM;
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
  return { count: picks - fine, fine, picks };
}

/** The four derived visual growth stages (see the banner). Pure, stateless,
 *  and exported so the render phase reads THIS definition rather than
 *  re-deriving the thirds. A zero-length window (the grow-now mint) or a
 *  negative one reads as ready.
 *
 *  CLOCK-BASE CONTRACT for the future render/ui consumer: `nowMs` MUST be the
 *  same world's lockoutNowMs-base clock the plot's own timestamps were written
 *  in (epoch ms online, sim-clock ms on the offline and headless hosts).
 *  Feeding Date.now() to an offline plot makes every bed render ready the
 *  instant it is planted; there is no cross-base conversion. The parameter is
 *  a structural minimum (the two timestamps), so both the public FarmPlotView
 *  and the sim-side PlotState fit without ever needing the hidden slots. The
 *  derived msRemaining wire field (the RaidLockout template) stays owed to the
 *  first timer surface, Phase 8. */
export type FarmGrowthStage = 'sprout' | 'seedling' | 'maturing' | 'ready';

export function farmGrowthStage(
  plot: Pick<PlotState, 'plantedAtMs' | 'readyAtMs'>,
  nowMs: number,
): FarmGrowthStage {
  const duration = plot.readyAtMs - plot.plantedAtMs;
  if (duration <= 0) return 'ready';
  const elapsed = (nowMs - plot.plantedAtMs) / duration;
  if (elapsed >= 1) return 'ready';
  if (elapsed >= 2 / 3) return 'maturing';
  if (elapsed >= 1 / 3) return 'seedling';
  return 'sprout';
}

/** Whether this farmer may plant this crop right now, as PURE state: the
 *  skill gate alone, taking the crop RECORD rather than an id.
 *
 *  Split out because the command-level skill arm is otherwise UNREACHABLE in a
 *  test: every shipped crop is tier 1, whose threshold is 0, which no
 *  proficiency can sit below. A test drives this with a synthetic tier-2
 *  record and pins the real arm's behavior; the command body below calls the
 *  same function, so the two can never disagree. */
export function canPlantCrop(crop: FarmCropDef, farmingSkill: number): boolean {
  return farmingSkill >= farmCropSkillThreshold(crop.tier);
}

/** Flat-ground distance to a bed. Beds carry no y (FarmBedDef), so this is a
 *  plain 2D distance, the distToNode precedent in gathering.ts. */
function distToBed(pos: { x: number; z: number }, bed: { x: number; z: number }): number {
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

/** Put a crop in a bed.
 *
 *  THE PLANT RESOLVES AT COMMAND TIME. Everything that decides an outcome (the
 *  seed consumption, the two-draw pre-roll, the plot write, the event) happens
 *  here, before the cast even starts; the cast is pure flavor. That is a
 *  DELIBERATE deviation from every other non-spell cast in the codebase, where
 *  the completion does the work, and its consequence is the point: damage
 *  cancelling the cast leaves the plant standing, because the crop is already
 *  in the ground. A player who is interrupted mid-animation has still planted,
 *  and has not lost the seed for nothing.
 *
 *  Gate order is STATED and checked top to bottom. Every deny arm returns
 *  early and draws ZERO rng, so a refused plant can never move the shared rng
 *  stream a harvest or a mob roll walks. */
export function plantCrop(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  bedId: string,
  cropId: string,
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
  // 8. Seed in bags.
  if (ctx.countItem(crop.seedItemId, meta.entityId) < 1) {
    ctx.emit({ type: 'farmDenied', pid: meta.entityId, reason: 'no_seed', bedId, cropId });
    return;
  }
  // 9. THE HOE GATE IS DEFERRED TO THE CROP-LADDER PHASE, and the omission is
  //    verified rather than assumed. The gate would read
  //    canGatherTier(<owned farming tool tier>, crop.tier), and the honest
  //    ownership scans (bestOwnedGatherToolTierOrNone, and the wield-filtered
  //    sibling in professions/wield_gate.ts that any ACCESS decision must use
  //    per the R22 banner) both report NO_TOOL_OWNED (0) for farming, because
  //    no farming gatherTool item ships: canGatherTier(0, 1) is false, so
  //    wiring the gate today would refuse EVERY plant. The bare-hands-floored
  //    scan would pass trivially instead, but it is the wrong scan for an
  //    access gate by that same banner, and baking in the wrong one now is a
  //    worse handoff than an absent gate. The hoe ladder phase adds the four
  //    hoe items and this arm together. Until then the ungainability pin in
  //    tests/professions_gathering.test.ts still holds: farming has no node
  //    type and no gatherTool.

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

  // The seed is spent BEFORE the pre-roll, so the draw block below is the last
  // thing that happens and every path reaching it is committed.
  ctx.removeItem(crop.seedItemId, 1, meta.entityId);

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
    // The three knobs are declared off; the knobs phase is the only thing
    // that ever sets them, and it sets them HERE, at plant time (front-loaded
    // choice: there is no mid-growth interaction of any kind).
    compost: false,
    watch: false,
    tonic: false,
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

/** Take a finished plot out of a bed. Draws ZERO rng on every path: the
 *  outcome was rolled at plant time and the yield expands deterministically
 *  from the stored seed.
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
    });
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
    });
    return;
  }
  // An absent yieldSeed reads as 0 rather than refusing: the load side derives
  // a replacement for a lost slot, so this is unreachable for any real plot,
  // and where it is reachable at all a deterministic harvest beats a refusal.
  const yieldSeed = Number.isFinite(plot.yieldSeed) ? (plot.yieldSeed as number) : 0;
  const { count, fine } = resolveFarmHarvest(yieldSeed, skill);
  // Deliberately NOT capacity-gated. A crop the player already grew must not
  // be destroyed by full bags (nothing rots, and a refusal here would BE a
  // rot), so the grant force-adds over capacity exactly like the quest-catch
  // arm in completeFishing.
  //
  // silent + callerLogs on BOTH grants: the farmHarvested event below owns
  // both halves of the feedback for the whole harvest (the gatherResult
  // idiom, #2430), and it carries the base and fine counts together. Without
  // these flags a two-grade harvest would print THREE lines for one action,
  // two hub "You receive:" lines plus the event's own, and stack two loot
  // dings on the event's cue.
  if (count > 0)
    ctx.addItem(crop.produceItemId, count, meta.entityId, { silent: true, callerLogs: true });
  if (fine > 0)
    ctx.addItem(crop.fineProduceItemId, fine, meta.entityId, { silent: true, callerLogs: true });
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
  const allFine = count === 0 && fine > 0;
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
  });
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
}

// ---------------------------------------------------------------------------
// the tick sweep
// ---------------------------------------------------------------------------

/** The farming per-tick sweep. Draws ZERO rng and emits nothing, so its
 *  position in the tick tail cannot fork the draw order (the updateProfNudges
 *  and updateDeeds precedent in the same tail).
 *
 *  It is a PLACEHOLDER, on purpose and by plan: the ready-notice phase fills
 *  the body with the 1 Hz sweep that turns a plot's `notified` flag into a
 *  personal, text-free ready event. Nothing else belongs here, because nothing
 *  else in farming is time-driven: growth is a pure comparison against an
 *  absolute deadline the projection makes for itself, so there is no timer to
 *  fire and no expiry work to do.
 *
 *  The 1 Hz guard is INTERNAL (the guild_letter idiom) rather than a caller's
 *  concern, and it sits first so the 19 ticks in 20 that do nothing cost one
 *  modulo and allocate nothing. */
export function updateFarming(ctx: SimContext): void {
  if (ctx.tickCount % 20 !== 0) return;
  // Intentionally empty until the ready-notice phase. Anything added here must
  // stay draw-free and allocation-free per tick.
}
