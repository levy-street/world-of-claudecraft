// The farming growth engine: the plant and harvest command bodies, the
// survival ramp, the harvest-lives yield, the gain schedule, and above all
// THE DRAW CONTRACT stated in src/sim/professions/farming.ts.
//
// The draw contract is the reason most of this file exists. Farming's whole
// determinism story is that a plant costs exactly two rng draws, a tier 1/2
// harvest costs exactly one (the golden-harvest roll, both outcomes), a tier
// 3/4 harvest exactly two contiguous (the seed-back roll then the golden
// roll, both outcomes), and literally nothing else costs any, so growth can
// be wall-clock and offline-friendly without the three hosts ever diverging.
// Every clause of that contract gets its own counted arm below.
//
// THE CLOCK IS ADVANCEABLE, ALWAYS. `lockoutNowMs` is injected as a `let` the
// tests move forward; a frozen injected clock is how a self-re-arming wait
// starves a test runner into a hang rather than a failure, so nothing here
// asserts against a clock that never moves.

import { beforeEach, describe, expect, it } from 'vitest';
import { bagCapacity, stackSizeOf } from '../src/sim/bags';
import {
  FARM_CROPS,
  type FarmCropDef,
  farmCropSkillThreshold,
  farmCropTier,
} from '../src/sim/content/farm_crops';
import { FARM_BED_IDS, FARM_PATCHES, farmBedById } from '../src/sim/content/farm_patches';
import { DEFAULT_MOUNT } from '../src/sim/content/mounts';
import { TOOL_EFFECTS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { setItemLocked } from '../src/sim/item_lock';
import { FARM_MAX_GROW_MS } from '../src/sim/professions/farm_persist';
import type { PlotState } from '../src/sim/professions/farm_projection';
import {
  FARMER_TRADE_RANGE,
  isFarmerNpcEntity,
  nearFarmerNpc,
} from '../src/sim/professions/farmer_npcs';
import {
  canPlantCrop,
  convertHusks,
  FARM_COMPOST_ITEM_ID,
  FARM_EFFECT_BONUS_PICK_CAP,
  FARM_FINE_CHANCE_BASE,
  FARM_FINE_CHANCE_EFFECT_BONUS,
  FARM_GROWTH_TONIC_ITEM_ID,
  FARM_HARVEST_LIFE_FLOOR,
  FARM_HARVEST_PICK_CAP,
  FARM_HUSKS_PER_COMPOST,
  FARM_KEEP_CHANCE_BASE,
  FARM_PLANT_CAST_SEC,
  FARM_SEED_BACK_MIN_TIER,
  FARM_SEED_BACK_ONE_CHANCE,
  FARM_SEED_BACK_TWO_CHANCE,
  FARM_SURVIVAL_AT_GATE,
  FARM_SURVIVAL_BAND_SPAN,
  FARM_TONIC_BONUS_CHANCE,
  FARM_TONIC_BONUS_PICKS,
  FARM_WITHERED_HUSK_COUNT,
  FARM_WITHERED_HUSK_ITEM_ID,
  FARMING_GAIN_SCHEDULE,
  type FarmPlantKnobs,
  farmGrowthStage,
  farmingHarvestGain,
  farmingHarvestGainAt,
  farmingTeachingCeilingFor,
  farmSurvivalChance,
  harvestCrop,
  plantCrop,
  resolveFarmHarvest,
  updateFarming,
} from '../src/sim/professions/farming';
import {
  GATHER_RARE_EVENT_CHANCE,
  GATHER_RARE_EVENT_YIELD_MULT,
} from '../src/sim/professions/gather_events';
import {
  resolveSlotToolEffect,
  slotEffect,
  slotToolEffectRefused,
  startingDurabilityFor,
} from '../src/sim/professions/tools';
import { wieldRequirementForTier } from '../src/sim/professions/wield_gate';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import {
  DT,
  dist2d,
  type Entity,
  FARMING_CAST_ID,
  INTERACT_RANGE,
  isNonSpellCast,
  type SimEvent,
} from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import {
  accumulateGain,
  farmingCalendar,
  harvestsToCross,
  isDyadic,
  MAXIMUM_DEDICATION,
  REFERENCE_FARMER,
} from './helpers/farming_calendar_model';

const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const PRODUCE_ID = 'vale_wheat';
const FINE_ID = 'fine_vale_wheat';
// The tier-1 farming hoe, granted by the shared harness: the step-12 hoe gate
// (plantCrop's tool arm) refuses any plant without a wieldable hoe covering
// the crop tier, and every pre-hoe arm in this file plants tier-1 crops.
const HOE_ID = 'garden_hoe';
const BED = 'bed_eastbrook_1';
const BED2 = 'bed_eastbrook_2';
const START_MS = 1_700_000_000_000;
// A harness seed whose plant-time yieldSeed WINS the tonic roll (probed
// against the real modules: resolveFarmHarvest(ys, 0, true).count exceeds
// the untoniced count). The two end-to-end tonic arms MUST run on a winner:
// at a losing seed (41 among them) the toniced and plain expansions are
// identical, so the arms stay green even when the harvest drops the stored
// tonic flag (the QA round's surviving mutant). Each arm also asserts its
// own non-vacuity, so a draw-block shift that changes the minted yieldSeed
// reds loudly instead of going quietly vacuous again.
const TONIC_WIN_SEED = 2;
// A harness seed that WINS the golden-harvest roll at a tier-1 harvest: the
// golden roll is the THIRD post-construction draw there (two plant draws,
// then the harvest's one), and seed 280's third draw is 0.001978, under the
// 1/90 chance (probed against the real modules, the seed-back describe's
// probe shape). Its plant-time yieldSeed is 3704758211 (the second draw,
// 0.862581, times 2^32 floored), whose skill-0 expansion pays
// { count: 3, fine: 1 }: BOTH grades nonzero, so the five-fold arms below
// can pin base and fine multiplication on one seed without any skill
// fiddling. Every other harness seed used in this file (2, 3, 4, 5, 7, 8, 9,
// 41, 99, 555, 777, 778, 1234, 2024, 4242) LOSES the golden roll at both
// the tier-1 position (third draw) and the tier-3/4 position (fourth), so
// no pre-existing payout arm multiplies (probed the same way).
const GOLDEN_WIN_SEED = 280;

// The shipped crop's own numbers, read from the catalog rather than restated,
// so a tuning pass moves the fixture with the content instead of reddening
// every arm below for a number that was allowed to change.
const CROP = FARM_CROPS[CROP_ID] as FarmCropDef;

interface Harness {
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
  /** Move the injected wall clock forward. */
  advance(ms: number): void;
  /** The current injected wall clock. */
  now(): number;
}

function makeHarness(seed = 41): Harness {
  let nowMs = START_MS;
  const sim = new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: false,
    lockoutNowMs: () => nowMs,
  });
  const pid = sim.playerId;
  const meta = sim.players.get(pid) as PlayerMeta;
  standAtBed(sim, BED);
  // The step-12 hoe gate: a harness farmer carries the tier-1 hoe so every
  // arm that is not ABOUT the gate keeps planting. addItem draws no rng, so
  // the grant never moves a counted window or the shared stream position.
  sim.addItem(HOE_ID, 1, pid);
  return {
    sim,
    pid,
    meta,
    advance: (ms: number) => {
      nowMs += ms;
    },
    now: () => nowMs,
  };
}

function standAtBed(sim: Sim, bedId: string): void {
  const bed = farmBedById(bedId);
  if (!bed) throw new Error(`no such bed: ${bedId}`);
  const p = sim.player;
  p.pos.x = bed.x;
  p.pos.z = bed.z;
  p.pos.y = terrainHeight(bed.x, bed.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

/** The spawned entity of an NPC template (a farmer for the husk trade's
 *  range gate, or any other NPC for its negative arm). */
function npcEntity(sim: Sim, templateId: string): Entity {
  const entity = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === templateId,
  );
  if (!entity) throw new Error(`no such npc: ${templateId}`);
  return entity;
}

/** Stand the harness farmer `offset` yd from an NPC (default: one step from
 *  farmer_jessica, the tier-1 farmer, well inside FARMER_TRADE_RANGE). The
 *  husk trade gates on a farmer NPC in reach (the go-live), so every arm about
 *  the trade itself stands here rather than at a bed. */
function standByNpc(sim: Sim, templateId = 'farmer_jessica', offset = 1): void {
  const npc = npcEntity(sim, templateId);
  const p = sim.player;
  p.pos.x = npc.pos.x + offset;
  p.pos.z = npc.pos.z;
  p.pos.y = terrainHeight(p.pos.x, p.pos.z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

/** Every spawned farmer NPC (the flag walk, so a fifth farmer joins the arms
 *  below without an id list here). */
function farmerEntities(sim: Sim): Entity[] {
  return [...sim.entities.values()].filter((e) => isFarmerNpcEntity(e));
}

function giveSeeds(h: Harness, n = 1): void {
  h.sim.addItem(SEED_ID, n, h.pid);
}

/** Run one call with a draw observer installed, returning the draw count.
 *  Installed and cleared around the call itself, so world ticks outside it
 *  never pollute the count. */
function countDraws(sim: Sim, run: () => void): number {
  let draws = 0;
  sim.rng.setObserver(() => {
    draws++;
  });
  try {
    run();
  } finally {
    sim.rng.setObserver(null);
  }
  return draws;
}

/** countDraws' value-recording sibling: the seed-back arms assert the BAND
 *  the one harvest roll landed in, not just its count, so a draw-block shift
 *  that re-seats the stream reds on the in-arm band claim instead of going
 *  quietly vacuous (the probed-seed rule). */
function recordDraws(sim: Sim, run: () => void): number[] {
  const values: number[] = [];
  sim.rng.setObserver((value) => {
    values.push(value);
  });
  try {
    run();
  } finally {
    sim.rng.setObserver(null);
  }
  return values;
}

function eventsOf<T extends SimEvent['type']>(
  sim: Sim,
  from: number,
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return sim.events.slice(from).filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** The single farmDenied reason a call produced, or null. */
function denyReason(sim: Sim, from: number): string | null {
  const denies = eventsOf(sim, from, 'farmDenied');
  return denies.length === 1 ? denies[0].reason : null;
}

/** Clear the plant cast so the busy gate does not eat the NEXT plant. Real
 *  play lets the cast tick out; these arms are about the command body. */
function clearCast(sim: Sim): void {
  sim.player.castingAbility = null;
  sim.player.castRemaining = 0;
}

function plant(h: Harness, bedId = BED, cropId = CROP_ID): void {
  plantCrop(h.sim.ctx, h.sim.player, h.meta, bedId, cropId);
}

function harvest(h: Harness, bedId = BED): void {
  harvestCrop(h.sim.ctx, h.sim.player, h.meta, bedId);
}

// ---------------------------------------------------------------------------

describe('the crop catalog and the cast sentinel', () => {
  it('pins the cast id to its wire token and its isNonSpellCast membership', () => {
    // A literal, not a comparison against the constant itself: renaming the
    // constant must not leave the wire token, the cast-bar label and the
    // readout silently green.
    expect(FARMING_CAST_ID).toBe('farming');
    expect(isNonSpellCast(FARMING_CAST_ID)).toBe(true);
    expect(isNonSpellCast('fireball')).toBe(false);
  });

  it('ships the full twelve-crop ladder, shaped 2 / 2 / 4 / 4, vale_wheat in its locked band', () => {
    // The catalog width pin: the D11 ids, authored in tier order. Retiring or
    // renaming any of these destroys player plots at load (the save-key
    // banner), so the list moves only deliberately. Phase 11e widened the two
    // UPPER tiers to four crops each, which is where a leveled farmer lives.
    expect(Object.keys(FARM_CROPS)).toEqual([
      'vale_wheat',
      'brook_carrot',
      'marsh_rice',
      'bog_beet',
      'highland_barley',
      'frost_gourd',
      'thornpeak_cabbage',
      'frost_lentils',
      'gilded_sunmelon',
      'evergarden_greens',
      'gilded_yam',
      'evergarden_pumpkin',
    ]);
    expect(Object.values(FARM_CROPS).map((c) => c.tier)).toEqual([
      1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4,
    ]);
    expect(CROP.tier).toBe(1);
    expect(CROP.seedItemId).toBe(SEED_ID);
    expect(CROP.produceItemId).toBe(PRODUCE_ID);
    expect(CROP.fineProduceItemId).toBe(FINE_ID);
    // The locked tier-1 pacing band is 30 to 60 minutes.
    expect(CROP.durationMs).toBeGreaterThanOrEqual(30 * 60_000);
    expect(CROP.durationMs).toBeLessThanOrEqual(60 * 60_000);
    expect(CROP.durationMs).toBe(2_700_000);
  });

  it('pins every crop duration to its authored literal, all distinct, none shared within a tier', () => {
    // The tuning surface of the whole ladder, pinned once: no two crops of a
    // tier may share a duration (the flag comments in farm_crops.ts state each
    // choice), and the pin keeps a re-tune deliberate. With four crops in the
    // upper tiers the rule binds across all four, not just a pair.
    expect(Object.values(FARM_CROPS).map((c) => [c.id, c.durationMs])).toEqual([
      ['vale_wheat', 2_700_000],
      ['brook_carrot', 2_100_000],
      ['marsh_rice', 7_800_000],
      ['bog_beet', 8_100_000],
      ['highland_barley', 14_400_000],
      ['frost_gourd', 16_200_000],
      ['thornpeak_cabbage', 15_000_000],
      ['frost_lentils', 15_600_000],
      ['gilded_sunmelon', 36_000_000],
      ['evergarden_greens', 37_800_000],
      ['gilded_yam', 36_900_000],
      ['evergarden_pumpkin', 38_700_000],
    ]);
    const durations = Object.values(FARM_CROPS).map((c) => c.durationMs);
    expect(new Set(durations).size).toBe(durations.length);
  });

  it('holds every tier-3 and tier-4 duration inside its D5 band and above the tier floor', () => {
    // The three constraints Phase 11e had to satisfy to widen the upper tiers,
    // asserted rather than argued, and derived from the merged table so a later
    // crop inherits them. The FLOOR is the load-bearing one: a shorter
    // upper-tier crop would turn a bed over faster and quietly accelerate the
    // gain ladder masterwrought DECISION A tuned.
    const BANDS: Record<number, readonly [number, number]> = {
      // D5, in minutes: tier 3 is about four hours, tier 4 the overnight band.
      3: [4 * 60, 5 * 60],
      4: [8 * 60, 11 * 60],
    };
    // The SHIPPED floor per tier, the value that predates this phase.
    const PRE_11E_MIN: Record<number, number> = { 3: 14_400_000, 4: 36_000_000 };
    for (const tier of [3, 4]) {
      const rows = Object.values(FARM_CROPS).filter((c) => c.tier === tier);
      expect(rows).toHaveLength(4);
      const [lo, hi] = BANDS[tier];
      for (const crop of rows) {
        expect(crop.durationMs).toBeGreaterThanOrEqual(lo * 60_000);
        expect(crop.durationMs).toBeLessThanOrEqual(hi * 60_000);
        expect(crop.durationMs).toBeGreaterThanOrEqual(PRE_11E_MIN[tier]);
      }
      const within = rows.map((c) => c.durationMs);
      expect(new Set(within).size).toBe(4);
    }
  });

  it('gives each tier a roster of DISTINCT plant classes, with a leaf at tier 3', () => {
    // masterwrought DECISION B's composition rule, which a downstream phase
    // READS to assign one tier-3 crop per apex role plate: no tier repeats a
    // plant class, and tier 3 carries a leaf so the cost-equal branch exists.
    // The classification lives here because it is a naming fact about the
    // shipped roster, not a field on the record.
    const CLASS_OF: Record<string, string> = {
      vale_wheat: 'grain',
      brook_carrot: 'root',
      marsh_rice: 'grain',
      bog_beet: 'root',
      highland_barley: 'grain',
      frost_gourd: 'gourd',
      thornpeak_cabbage: 'leaf',
      frost_lentils: 'legume',
      gilded_sunmelon: 'melon',
      evergarden_greens: 'leaf',
      gilded_yam: 'tuber',
      evergarden_pumpkin: 'gourd',
    };
    // Every shipped crop is classified: a new crop cannot slip past this rule
    // by being absent from the table.
    expect(Object.keys(CLASS_OF).sort()).toEqual(Object.keys(FARM_CROPS).sort());
    for (const tier of [1, 2, 3, 4]) {
      const classes = Object.values(FARM_CROPS)
        .filter((c) => c.tier === tier)
        .map((c) => CLASS_OF[c.id]);
      expect(new Set(classes).size, `tier ${tier} repeats a plant class`).toBe(classes.length);
    }
    const tier3 = Object.values(FARM_CROPS)
      .filter((c) => c.tier === 3)
      .map((c) => CLASS_OF[c.id]);
    expect(tier3.filter((k) => k === 'leaf')).toHaveLength(1);
  });

  it('pins the plant cast length to its wire-visible literal', () => {
    // castTotal/castRemaining ride the wire off this constant, and every other
    // assertion reaches it through the import, which is a self-comparison (the
    // wire-name-constant rule). One literal pin, here.
    expect(FARM_PLANT_CAST_SEC).toBe(2);
  });

  it('binds the catalog band math to the survival ramp span (two independent 25s)', () => {
    // farmCropSkillThreshold (content/farm_crops.ts) and farmSurvivalChance
    // (professions/farm_projection.ts) re-derive the 25-point band SEPARATELY:
    // the projection is a content-import-free pure leaf, so it cannot read the
    // catalog helper. This pin is the one thing tying the two constants
    // together; tuning either alone reds here (QA-round finding).
    for (const tier of [1, 2, 3, 4]) {
      expect(farmCropSkillThreshold(tier)).toBe((tier - 1) * FARM_SURVIVAL_BAND_SPAN);
    }
  });

  it('keeps every crop duration a positive integer under the tamper ceiling', () => {
    // The loader admits duration-0 rows since the QA round (the grow-now
    // mint), so no downstream arm catches a mis-authored durationMs any more:
    // a 0 would mint instantly-ready plots, and a negative one is worse (the
    // plant succeeds and spends the seed, then the next load drops the row as
    // malformed). The catalog is the one authoring surface, so the bound is
    // pinned here for every crop the Phase 5 ladder will ever add; the
    // ceiling arm keeps an authored duration out of the load-side clamp.
    for (const crop of Object.values(FARM_CROPS)) {
      expect(Number.isInteger(crop.durationMs), crop.id).toBe(true);
      expect(crop.durationMs, crop.id).toBeGreaterThan(0);
      expect(crop.durationMs, crop.id).toBeLessThanOrEqual(FARM_MAX_GROW_MS);
    }
  });

  it('derives the skill threshold from the shared 25-point band math', () => {
    expect(farmCropSkillThreshold(1)).toBe(0);
    expect(farmCropSkillThreshold(2)).toBe(25);
    expect(farmCropSkillThreshold(3)).toBe(50);
    expect(farmCropSkillThreshold(4)).toBe(75);
    expect(farmCropTier(CROP_ID)).toBe(1);
  });

  it('deep-freezes the catalog, which crosses module boundaries by reference', () => {
    expect(Object.isFrozen(FARM_CROPS)).toBe(true);
    expect(Object.isFrozen(CROP)).toBe(true);
  });
});

describe('FARMING_GAIN_SCHEDULE and the composed ceiling', () => {
  // The GAIN column and the BOUNDARY column are pinned SEPARATELY, on purpose.
  // The boundaries are the teaching-ceiling source (farmingTeachingCeilingFor
  // indexes this very column), so a future re-tune that moved one would
  // silently change which crop tier grays out at which skill. Splitting the
  // pins means a tune can only ever move the half it meant to move.
  it('pins the schedule BOUNDARY column, the teaching-ceiling source', () => {
    expect(FARMING_GAIN_SCHEDULE.map((r) => r.belowProficiency)).toEqual([25, 50, 75, 100]);
    expect(FARMING_GAIN_SCHEDULE).toHaveLength(4);
  });

  it('pins the schedule GAIN column to its literals', () => {
    expect(FARMING_GAIN_SCHEDULE.map((r) => r.gain)).toEqual([0.25, 0.125, 0.0625, 0.03125]);
  });

  it('takes the first row the proficiency sits below, and zero past the last', () => {
    expect(farmingHarvestGain(0)).toBe(0.25);
    expect(farmingHarvestGain(24.9)).toBe(0.25);
    expect(farmingHarvestGain(25)).toBe(0.125);
    expect(farmingHarvestGain(49)).toBe(0.125);
    expect(farmingHarvestGain(50)).toBe(0.0625);
    expect(farmingHarvestGain(75)).toBe(0.03125);
    expect(farmingHarvestGain(100)).toBe(0);
    expect(farmingHarvestGain(1_000)).toBe(0);
  });

  it('derives each tier ceiling from the schedule boundaries, never a second table', () => {
    expect(farmingTeachingCeilingFor(1)).toBe(50);
    expect(farmingTeachingCeilingFor(2)).toBe(75);
    expect(farmingTeachingCeilingFor(3)).toBe(100);
    // Clamped at both ends: tier 4 shares tier 3's ceiling (the last row), and
    // a nonsense tier 0 falls to the first real row rather than off the table.
    expect(farmingTeachingCeilingFor(4)).toBe(100);
    expect(farmingTeachingCeilingFor(0)).toBe(50);
  });

  it('zeroes the gain at or past the crop tier ceiling, the R19 composition', () => {
    // The schedule truth, live now that the crop ladder ships all four tiers:
    // a tier-1 crop teaches to 50, a tier-2 crop to 75, and tier 3 and 4
    // crops to 100 (the composed ceiling above).
    expect(farmingHarvestGainAt(0, 1)).toBe(0.25);
    expect(farmingHarvestGainAt(25, 1)).toBe(0.125);
    expect(farmingHarvestGainAt(49.9, 1)).toBe(0.125);
    expect(farmingHarvestGainAt(50, 1)).toBe(0);
    // A tier-2 crop keeps teaching where the tier-1 crop gave up.
    expect(farmingHarvestGainAt(50, 2)).toBe(0.0625);
    expect(farmingHarvestGainAt(75, 2)).toBe(0);
    // THE TOP BAND, added at the 11e QA. The comment above has always claimed
    // tier 3 and 4 crops teach to 100, and until now nothing asserted it: the
    // only other pin on this composition, the farming_session coverage arm in
    // tests/parity/coverage_c.test.ts, derives its expectation by CALLING
    // farmingHarvestGainAt, so both sides moved together and it could not fail.
    // Proved by mutation at the 11e QA: changing the tail gain 0.03125 ->
    // 0.0625 left tests/parity/coverage_c.test.ts fully green (22 passed), so
    // the composition that makes the upper tiers teach to 100 was pinned only
    // by a regenerable golden. These are LITERALS on purpose.
    expect(farmingHarvestGainAt(75, 3)).toBe(0.03125);
    expect(farmingHarvestGainAt(75, 4)).toBe(0.03125);
    expect(farmingHarvestGainAt(99.9, 4)).toBe(0.03125);
    expect(farmingHarvestGainAt(100, 3)).toBe(0);
    expect(farmingHarvestGainAt(100, 4)).toBe(0);
  });
});

// The masterwrought R19 derivation. FARMING_GAIN_SCHEDULE's gain column is the
// OUTPUT of the calendar model in tests/helpers/farming_calendar_model.ts, so
// these arms re-derive it rather than restating it: if the model's inputs move
// (a bed is added, a gate moves, the survival ramp changes) the shipped curve
// has to move with them or this reds.
describe('the farming gain curve is DERIVED from the calendar model, not felt', () => {
  // masterwrought DECISION A, settled 2026-08-20: about ten weeks for the
  // reference farmer. Stated here as the window the derivation searches, so
  // moving the design target is a one-line edit whose consequence is visible.
  const DECISION_A_MIN_DAYS = 70;
  const DECISION_A_MAX_DAYS = 75;

  /** The candidate family: a strict halving ladder off one head gain. */
  function halvingLadder(head: number): typeof FARMING_GAIN_SCHEDULE {
    return [
      { belowProficiency: 25, gain: head },
      { belowProficiency: 50, gain: head / 2 },
      { belowProficiency: 75, gain: head / 4 },
      { belowProficiency: 100, gain: head / 8 },
    ] as unknown as typeof FARMING_GAIN_SCHEDULE;
  }

  it('reproduces the SHIPPED curve as the unique dyadic halving ladder in DECISION A window', () => {
    // Halving the head doubles the calendar, so the family is monotonic and
    // the window admits at most one member. Search it rather than assert it.
    const inWindow: number[] = [];
    for (let n = 0; n <= 8; n++) {
      const head = 2 ** -n;
      const ladder = halvingLadder(head);
      expect(ladder.every((row) => isDyadic(row.gain))).toBe(true);
      const days = farmingCalendar(REFERENCE_FARMER, ladder).totalDays;
      if (days >= DECISION_A_MIN_DAYS && days <= DECISION_A_MAX_DAYS) inWindow.push(head);
    }
    expect(inWindow).toEqual([0.25]);
    // ...and the tree ships exactly that ladder.
    expect(FARMING_GAIN_SCHEDULE.map((r) => r.gain)).toEqual(
      halvingLadder(inWindow[0]).map((r) => r.gain),
    );
  });

  it('puts the shipped curve inside the settled calendar window for the reference farmer', () => {
    const model = farmingCalendar(REFERENCE_FARMER);
    expect(model.totalHarvests).toBe(1500);
    expect(model.totalDays).toBeGreaterThanOrEqual(DECISION_A_MIN_DAYS);
    expect(model.totalDays).toBeLessThanOrEqual(DECISION_A_MAX_DAYS);
    // The re-tune's actual purpose: the FRONT of the ladder, which the shipped
    // curve spent under a tenth of the calendar on. A derived span materially
    // under a month re-opens DECISION A rather than shipping, so pin the floor.
    expect(model.daysToFifty / model.totalDays).toBeGreaterThan(0.3);
    expect(model.totalDays).toBeGreaterThan(30);
  });

  it('reads its inputs from shipped content, so a content change moves the model', () => {
    const model = farmingCalendar(REFERENCE_FARMER);
    // The per-band bed counts are the union of the hubs whose crop tier still
    // teaches; they come from FARM_PATCHES, never from a literal here.
    expect(model.bands.map((b) => b.teachingTiers)).toEqual([[1], [1, 2], [2, 3], [3, 4]]);
    expect(model.bands.map((b) => b.beds)).toEqual([
      FARM_PATCHES.filter((p) => p.tier === 1).reduce((n, p) => n + p.beds.length, 0),
      FARM_PATCHES.filter((p) => p.tier <= 2).reduce((n, p) => n + p.beds.length, 0),
      FARM_PATCHES.filter((p) => p.tier === 2 || p.tier === 3).reduce(
        (n, p) => n + p.beds.length,
        0,
      ),
      FARM_PATCHES.filter((p) => p.tier >= 3).reduce((n, p) => n + p.beds.length, 0),
    ]);
    // Each band's harvest count is exactly the band width over its own gain.
    for (const band of model.bands) {
      expect(band.harvests).toBe((band.to - band.from) / band.gain);
    }
    // The harvest ladder strictly doubles, which is the SHAPE half of the
    // derivation (the scale half is the window above).
    expect(model.bands.map((b) => b.harvests)).toEqual([100, 200, 400, 800]);
  });

  it('holds the reference farmer\'s premise: a visit gap clears the longest crop', () => {
    // ADDED at the 11e QA. The model helper's header has always claimed this
    // premise is "asserted separately by the derivation test against the real
    // durationMs literals", and no such assertion existed. It matters because
    // the whole per-band attempts figure is visitsPerDay x beds, which is only
    // true while every crop of the band is ready between two check-ins: a crop
    // longer than the gap silently halves the attempts the model credits.
    //
    // The drift is not hypothetical. state.md's reference-farmer paragraph was
    // written at STEP 0 saying "the longest shipped duration is 10.5 hours",
    // and this very phase then added evergarden_pumpkin at 645 minutes (10.75
    // hours), so the phase falsified its own recorded input with nothing to
    // catch it.
    const gapMs = (24 / REFERENCE_FARMER.visitsPerDay) * 60 * 60_000;
    const longest = Math.max(...Object.values(FARM_CROPS).map((c) => c.durationMs));
    expect(longest, 'the longest shipped crop must be ready between two check-ins').toBeLessThan(
      gapMs,
    );
    // The literal, so a new crop that pushes the ceiling is a visible edit
    // rather than a silently narrowing margin.
    expect(longest).toBe(38_700_000);
    expect(gapMs).toBe(43_200_000);
  });

  it('records the maximum-dedication FLOOR, an envelope bound and never a target', () => {
    const floor = farmingCalendar(MAXIMUM_DEDICATION);
    // Same 1500 harvests, every bed in the world, so the calendar compresses
    // but never collapses.
    expect(floor.totalHarvests).toBe(1500);
    expect(floor.totalDays).toBeLessThan(farmingCalendar(REFERENCE_FARMER).totalDays);
    expect(floor.totalDays).toBeGreaterThan(30);
  });

  // The EXACTNESS arm, and the reason the literals are negative powers of two.
  // Grants accumulate by plain float addition in applyGrantClamped with no
  // rounding, so a non-dyadic gain drifts and a band boundary is missed by one
  // harvest. Strict equality throughout: toBeCloseTo would pass on the very
  // drift this exists to forbid.
  describe('every gain is exactly representable, so a band lands on its boundary', () => {
    it('holds each gain to a dyadic rational', () => {
      for (const row of FARMING_GAIN_SCHEDULE) expect(isDyadic(row.gain)).toBe(true);
    });

    it('accumulates each band exactly N times and lands on the boundary EXACTLY', () => {
      let skill = 0;
      for (const row of FARMING_GAIN_SCHEDULE) {
        const harvests = (row.belowProficiency - skill) / row.gain;
        expect(Number.isInteger(harvests)).toBe(true);
        skill = accumulateGain(skill, row.gain, harvests);
        expect(skill).toBe(row.belowProficiency);
      }
      expect(skill).toBe(100);
    });

    it('needs no extra harvest to cross any boundary, which the old curve did', () => {
      let skill = 0;
      for (const row of FARMING_GAIN_SCHEDULE) {
        const nominal = (row.belowProficiency - skill) / row.gain;
        expect(harvestsToCross(skill, row.gain, row.belowProficiency)).toBe(nominal);
        skill = row.belowProficiency;
      }
      // The control, so the arm above cannot pass vacuously: the retired
      // literals really were inexact and really did cost an extra harvest.
      expect(isDyadic(0.1)).toBe(false);
      expect(isDyadic(0.02)).toBe(false);
      expect(harvestsToCross(50, 0.1, 75)).toBe(251);
      expect(harvestsToCross(75, 0.02, 100)).toBe(1251);
      expect(accumulateGain(50, 0.1, 250)).not.toBe(75);
    });
  });
});

describe('farmSurvivalChance (the D6 ramp)', () => {
  it('is exactly the gate value AT the gate and exactly 1 at the band top', () => {
    expect(farmSurvivalChance(0, 1, false, false)).toBe(FARM_SURVIVAL_AT_GATE);
    expect(FARM_SURVIVAL_AT_GATE).toBe(0.85);
    expect(farmSurvivalChance(25, 1, false, false)).toBe(1);
    // Halfway up the band is halfway up the ramp.
    expect(farmSurvivalChance(12.5, 1, false, false)).toBeCloseTo(0.925, 10);
  });

  it('retires the risk permanently one full band above the threshold', () => {
    for (const skill of [25, 40, 99, 100]) {
      expect(farmSurvivalChance(skill, 1, false, false)).toBe(1);
    }
    // And the same shape one tier up, so the ramp reads the tier rather than
    // hardcoding tier 1's gate.
    expect(farmSurvivalChance(25, 2, false, false)).toBe(FARM_SURVIVAL_AT_GATE);
    expect(farmSurvivalChance(50, 2, false, false)).toBe(1);
  });

  it('adds the knob bonuses and caps at 1', () => {
    expect(farmSurvivalChance(0, 1, true, false)).toBeCloseTo(0.95, 10);
    expect(farmSurvivalChance(0, 1, false, true)).toBeCloseTo(0.95, 10);
    expect(farmSurvivalChance(0, 1, true, true)).toBe(1);
    expect(farmSurvivalChance(25, 1, true, true)).toBe(1);
  });

  it('floors below the gate and reads a non-finite skill as zero', () => {
    // Only reachable through a hand-edited save naming a crop above the
    // farmer's skill; a crop must never be WORSE than its own gate.
    expect(farmSurvivalChance(-100, 1, false, false)).toBe(FARM_SURVIVAL_AT_GATE);
    expect(farmSurvivalChance(Number.NaN, 1, false, false)).toBe(FARM_SURVIVAL_AT_GATE);
  });
});

describe('resolveFarmHarvest (the harvest-lives model)', () => {
  it('never pays fewer picks than the guaranteed floor', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { picks, count, fine } = resolveFarmHarvest(seed, 0);
      expect(picks).toBeGreaterThanOrEqual(FARM_HARVEST_LIFE_FLOOR);
      expect(picks).toBeLessThanOrEqual(FARM_HARVEST_PICK_CAP);
      // A fine pick UPGRADES a pick rather than adding one.
      expect(count + fine).toBe(picks);
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  it('REACHES the pick cap exactly when no pick can consume a life', () => {
    // A bound never reached is a constant-true assertion. The keep chance caps
    // at 1, where every roll keeps, so the loop can only stop at the cap; the
    // skill needed is far above the profession cap, which is why the pure
    // helper deliberately does not clamp its skill argument.
    const capSkill = 10_000;
    expect(FARM_KEEP_CHANCE_BASE + (0.35 * capSkill) / 100).toBeGreaterThanOrEqual(1);
    for (const seed of [0, 1, 12_345, 4_294_967_295]) {
      expect(resolveFarmHarvest(seed, capSkill).picks).toBe(FARM_HARVEST_PICK_CAP);
    }
    expect(FARM_HARVEST_PICK_CAP).toBe(12);
  });

  it('is a pure function of the seed and the skill, repeatable forever', () => {
    const a = resolveFarmHarvest(123_456, 20);
    const b = resolveFarmHarvest(123_456, 20);
    expect(a).toEqual(b);
    // Different seeds do genuinely diverge, so the arm above is not comparing
    // one constant against itself.
    const outcomes = new Set(
      Array.from({ length: 60 }, (_, i) => JSON.stringify(resolveFarmHarvest(i, 20))),
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('pays more on average at higher skill, in both picks and fine grade', () => {
    const total = (skill: number) => {
      let picks = 0;
      let fine = 0;
      for (let seed = 0; seed < 400; seed++) {
        const y = resolveFarmHarvest(seed, skill);
        picks += y.picks;
        fine += y.fine;
      }
      return { picks, fine };
    };
    const low = total(0);
    const high = total(100);
    expect(high.picks).toBeGreaterThan(low.picks);
    expect(high.fine).toBeGreaterThan(low.fine);
    // Anti-vacuous: the low arm is not simply zero everywhere.
    expect(low.picks).toBeGreaterThan(0);
    expect(FARM_FINE_CHANCE_BASE).toBeGreaterThan(0);
  });
});

describe('farmGrowthStage (the derived visual stages)', () => {
  const plot: PlotState = {
    cropId: CROP_ID,
    plantedAtMs: 0,
    readyAtMs: 300,
    compost: false,
    watch: false,
    tonic: false,
    notified: false,
  };

  it('lives in the farm_projection leaf; the farming.ts import is a re-export of it', async () => {
    // Deviation (ar): the render core imports the FUNCTION from the leaf
    // directly, so the leaf home and the re-export must stay one value. A
    // re-home that leaves either path pointing at a copy diverges silently
    // without this identity pin.
    const leaf = await import('../src/sim/professions/farm_projection');
    expect(leaf.farmGrowthStage).toBe(farmGrowthStage);
  });

  it('cuts the elapsed fraction into thirds, with no stored state', () => {
    expect(farmGrowthStage(plot, 0)).toBe('sprout');
    expect(farmGrowthStage(plot, 99)).toBe('sprout');
    expect(farmGrowthStage(plot, 100)).toBe('seedling');
    expect(farmGrowthStage(plot, 199)).toBe('seedling');
    expect(farmGrowthStage(plot, 200)).toBe('maturing');
    expect(farmGrowthStage(plot, 299)).toBe('maturing');
    expect(farmGrowthStage(plot, 300)).toBe('ready');
    // Nothing rots: long past the deadline is still exactly ready.
    expect(farmGrowthStage(plot, 30_000_000)).toBe('ready');
  });

  it('reads a zero-length window as ready rather than dividing by zero', () => {
    expect(farmGrowthStage({ ...plot, readyAtMs: 0 }, 0)).toBe('ready');
  });
});

describe('canPlantCrop (the skill gate as pure state)', () => {
  // The command-level skill arm is UNREACHABLE with shipped content: every
  // crop is tier 1 and gates at 0, which no proficiency can sit below. The
  // gate is therefore pure and takes the crop RECORD, so a synthetic tier-2
  // record proves the real predicate the command body calls.
  const TIER_2: FarmCropDef = {
    id: 'synthetic_tier_2',
    tier: 2,
    durationMs: 7_200_000,
    seedItemId: 'synthetic_seed',
    produceItemId: 'synthetic_produce',
    fineProduceItemId: 'fine_synthetic_produce',
  };

  it('admits any skill for a tier-1 crop and gates a tier-2 crop at 25', () => {
    expect(canPlantCrop(CROP, 0)).toBe(true);
    expect(canPlantCrop(TIER_2, 24.9)).toBe(false);
    expect(canPlantCrop(TIER_2, 25)).toBe(true);
    expect(canPlantCrop(TIER_2, 26)).toBe(true);
  });
});

describe('plantCrop: the stated gate order, every arm draw-free', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('plants, spends the seed, writes the plot, and emits farmPlanted', () => {
    giveSeeds(h, 2);
    const from = h.sim.events.length;
    plant(h);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    expect(plot.cropId).toBe(CROP_ID);
    expect(plot.plantedAtMs).toBe(h.now());
    expect(plot.readyAtMs).toBe(h.now() + CROP.durationMs);
    // The knob slots are declared off; the knobs phase is what sets them.
    expect(plot.compost).toBe(false);
    expect(plot.watch).toBe(false);
    expect(plot.tonic).toBe(false);
    expect(plot.notified).toBe(false);
    // Both hidden slots are filled, in their draw domains.
    expect(plot.survivalRoll as number).toBeGreaterThanOrEqual(0);
    expect(plot.survivalRoll as number).toBeLessThan(1);
    expect(Number.isInteger(plot.yieldSeed)).toBe(true);
    expect(plot.yieldSeed as number).toBeLessThan(0x100000000);
    const planted = eventsOf(h.sim, from, 'farmPlanted');
    expect(planted).toEqual([{ type: 'farmPlanted', pid: h.pid, bedId: BED, cropId: CROP_ID }]);
  });

  it('starts the flavor cast, which carries no hidden information', () => {
    giveSeeds(h);
    plant(h);
    expect(h.sim.player.castingAbility).toBe(FARMING_CAST_ID);
    expect(h.sim.player.castTotal).toBe(FARM_PLANT_CAST_SEC);
    expect(h.sim.player.castRemaining).toBe(FARM_PLANT_CAST_SEC);
    // A CONSTANT, not a function of the crop or the hidden roll: the cast
    // fields broadcast, so a per-plot duration would leak growth state.
    const h2 = makeHarness(99);
    giveSeeds(h2);
    plant(h2);
    expect(h2.sim.player.castTotal).toBe(h.sim.player.castTotal);
  });

  it('resolves at COMMAND time, so cancelling the cast leaves the plant standing', () => {
    giveSeeds(h);
    plant(h);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    // Whatever ends the cast (damage, a manual stop, the completion arm) the
    // crop is already in the ground and the seed is already spent.
    h.sim.player.castingAbility = null;
    h.sim.player.castRemaining = 0;
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
  });

  it('refuses a dead farmer', () => {
    giveSeeds(h);
    h.sim.player.dead = true;
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h));
    expect(draws).toBe(0);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(eventsOf(h.sim, from, 'farmPlanted')).toEqual([]);
  });

  it('refuses a busy farmer', () => {
    giveSeeds(h, 2);
    plant(h); // leaves the plant cast running
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h, BED2));
    expect(draws).toBe(0);
    expect(h.meta.farmPlots.has(BED2)).toBe(false);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    // The refusal is silent on the plant channel: no farmPlanted for the
    // second bed (the sibling dead-farmer arm's shape; Phase 9 QA closed the
    // unused `from`).
    expect(eventsOf(h.sim, from, 'farmPlanted')).toEqual([]);
  });

  it('refuses a bed id that is not a bed (the hard gate at the command)', () => {
    // The load-side allowlist can only clean up AFTER a bad row exists, so
    // this arm is what stops one being minted at all.
    giveSeeds(h);
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h, 'bed_not_a_real_bed'));
    expect(draws).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bad_bed');
    expect(h.meta.farmPlots.size).toBe(0);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    // Anti-vacuous: the same id family, with a REAL bed, plants.
    clearCast(h.sim);
    plant(h);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
  });

  it('refuses a bed out of interact range', () => {
    giveSeeds(h);
    h.sim.player.pos.x += 50;
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h));
    expect(draws).toBe(0);
    expect(denyReason(h.sim, from)).toBe('range');
    expect(h.meta.farmPlots.size).toBe(0);
  });

  it('refuses a bed this farmer has already planted, and only this farmer', () => {
    giveSeeds(h, 2);
    plant(h);
    clearCast(h.sim);
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h));
    expect(draws).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bed_taken');
    // The seed was not spent on the refusal.
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    // PER-PLAYER: a second farmer's map is empty, so the same bed is free for
    // them. The shared-bed, private-plot model in one assertion.
    const other = makeHarness(7);
    giveSeeds(other);
    plant(other);
    expect(other.meta.farmPlots.has(BED)).toBe(true);
  });

  it('refuses a crop id the catalog does not carry', () => {
    giveSeeds(h);
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h, BED, 'not_a_crop'));
    expect(draws).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bad_crop');
    expect(h.meta.farmPlots.size).toBe(0);
  });

  it('refuses a prototype key as a crop id, never resolving a function', () => {
    giveSeeds(h);
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h, BED, 'constructor'));
    expect(draws).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bad_crop');
  });

  it('refuses a farmer with no seed in bags', () => {
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => plant(h));
    expect(draws).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_seed');
    expect(h.meta.farmPlots.size).toBe(0);
  });

  it("refuses a REAL tier-2 crop below its band: reason 'skill', zero draws, seed kept", () => {
    // The Phase 3 QA deferral, now reachable with shipped content: the
    // command-level skill arm needed a synthetic record while vale_wheat was
    // the only crop, and the ladder's marsh_rice (tier 2, threshold 25) is
    // the real thing. This is ALSO an order proof: the harness garden_hoe
    // cannot cover tier 2, so gate 12 (tool) would refuse too, and gate 7
    // (skill) must own the reason.
    h.sim.addItem('marsh_rice_seed', 1, h.pid);
    expect(h.meta.gatheringProficiency.farming).toBe(0);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plant(h, BED, 'marsh_rice'))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('skill');
    expect(h.sim.countItem('marsh_rice_seed', h.pid)).toBe(1);
    expect(h.meta.farmPlots.size).toBe(0);
    // Anti-vacuous: past the band with a covering hoe, the SAME command
    // plants (and spends the ordinary two draws).
    h.meta.gatheringProficiency.farming = 40;
    h.sim.addItem('bronze_hoe', 1, h.pid);
    expect(countDraws(h.sim, () => plant(h, BED, 'marsh_rice'))).toBe(2);
    expect(h.meta.farmPlots.get(BED)?.cropId).toBe('marsh_rice');
  });

  it('preserves stealth, sitting and mount on a refusal (the trio runs after every gate)', () => {
    // The mirror of the success-path state-breaking pin below: the deliberate
    // action trio (breakStealth, standUp, forceDismount) sits AFTER every deny
    // arm, so a refused plant never reveals or unseats the player. Armed
    // exactly like the success pin but refused at the TONIC gate, which is
    // the LAST gate in the stated order since the knobs phase (a seed is in
    // the pouch, the tonic is not): if the trio ever moves above ANY gate,
    // knob gates included, this arm reds while the success pin stays green.
    giveSeeds(h);
    const p = h.sim.player;
    p.sitting = true;
    p.mountKey = DEFAULT_MOUNT;
    p.auras.push({
      id: 'stealth',
      name: 'Stealth',
      kind: 'stealth',
      remaining: 600,
      duration: 600,
      value: 0,
      sourceId: p.id,
      school: 'physical',
    });
    p.stealthed = true;
    const from = h.sim.events.length;
    expect(
      countDraws(h.sim, () => plantCrop(h.sim.ctx, p, h.meta, BED, CROP_ID, { tonic: true })),
    ).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_tonic');
    // The knob refusal consumed NOTHING, the seed included.
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(p.sitting).toBe(true);
    expect(p.mountKey).toBe(DEFAULT_MOUNT);
    expect(p.stealthed).toBe(true);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
  });

  it('answers bed_taken before no_seed when both gates would refuse (order proof)', () => {
    // The one inter-gate precedence arm: every other deny test fails exactly
    // one gate, which proves each arm but not their order. Here BOTH the
    // bed-taken gate and the seed gate would refuse, and the earlier one must
    // own the reason: a player replanting a taken bed with an empty pouch is
    // told the bed is taken, not to buy seeds.
    giveSeeds(h);
    plant(h); // takes BED with the only seed
    clearCast(h.sim);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plant(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bed_taken');
  });

  it('inserts plots in SORTED bed order, whatever order they were planted in', () => {
    // Load-bearing, not cosmetic: normalizeFarmPlots rebuilds this map sorted
    // on every load, so a plant-order map would iterate differently after a
    // relog and any future walker that draws would fork the stream.
    giveSeeds(h, 2);
    plant(h, BED2);
    clearCast(h.sim);
    plant(h, BED);
    expect([...h.meta.farmPlots.keys()]).toEqual([BED, BED2]);
  });

  it('survives a plant on a fresh never-ticked Sim, whose clock reads zero', () => {
    // The write side floors plantedAtMs at 1 to agree with the load side,
    // which DROPS any row at or below 0. Without the floor an offline plant
    // before the first tick writes plantedAtMs: 0 and the next load silently
    // destroys the plot as a tampered row: a real crop lost to a field the
    // player cannot see.
    const fresh = new Sim({ seed: 4, playerClass: 'warrior', autoEquip: false });
    const pid = fresh.playerId;
    const meta = fresh.players.get(pid) as PlayerMeta;
    standAtBed(fresh, BED);
    fresh.addItem(SEED_ID, 1, pid);
    fresh.addItem(HOE_ID, 1, pid); // the step-12 hoe gate
    // The precondition the floor exists for, asserted rather than assumed:
    // no injected clock and not a single tick, so the uninjected lockoutNowMs
    // (which counts sim-clock ms from zero) still reads 0.
    expect(fresh.time).toBe(0);
    plantCrop(fresh.ctx, fresh.player, meta, BED, CROP_ID);
    const plot = meta.farmPlots.get(BED) as PlotState;
    expect(plot.plantedAtMs).toBe(1);
    expect(plot.readyAtMs).toBe(1 + CROP.durationMs);

    // The round trip the floor protects: serialize, load into another
    // never-ticked Sim, and the plot is still there with its duration intact.
    const saved = fresh.serializeCharacter(pid) as CharacterState;
    expect(saved.farmPlots?.[BED]?.plantedAtMs).toBe(1);
    const reloaded = new Sim({ seed: 4, playerClass: 'warrior', noPlayer: true });
    reloaded.addPlayer('warrior', 'Farmer', { state: saved });
    const reloadedMeta = [...reloaded.players.values()][0] as PlayerMeta;
    const survivor = reloadedMeta.farmPlots.get(BED);
    expect(survivor).toBeDefined();
    expect(survivor?.plantedAtMs).toBe(1);
    expect((survivor as PlotState).readyAtMs - (survivor as PlotState).plantedAtMs).toBe(
      CROP.durationMs,
    );
  });

  it('draws EXACTLY two on a successful plant, and the plot carries both', () => {
    giveSeeds(h);
    const draws = countDraws(h.sim, () => plant(h));
    expect(draws).toBe(2);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    expect(plot.survivalRoll).toEqual(expect.any(Number));
    expect(plot.yieldSeed).toEqual(expect.any(Number));
  });

  it('still draws exactly two when planting stealthed AND sitting AND mounted', () => {
    // THE STATE-BREAKING DRAW PIN. The three side effects that run just before
    // the pre-roll block (breakStealth, standUp, forceDismount) are all
    // supposed to be pure field writes. If any of them ever starts drawing,
    // a plant becomes three-plus draws ON THAT PATH ONLY, which forks the
    // shared rng stream for every later roll in the world for exactly the
    // players who happened to plant from that state: the hardest class of
    // determinism bug to trace back. Cheap to pin, so it is pinned.
    giveSeeds(h);
    const p = h.sim.player;
    p.sitting = true;
    p.mountKey = DEFAULT_MOUNT;
    p.auras.push({
      id: 'stealth',
      name: 'Stealth',
      kind: 'stealth',
      remaining: 600,
      duration: 600,
      value: 0,
      sourceId: p.id,
      school: 'physical',
    });
    p.stealthed = true;
    // Every one of the three is genuinely armed, or this arm proves nothing.
    expect(p.sitting).toBe(true);
    expect(p.mountKey).not.toBe('');
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);

    expect(countDraws(h.sim, () => plant(h))).toBe(2);

    // And all three side effects actually fired, so the count above is two
    // draws WITH the work done, not two draws because nothing ran.
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    expect(p.sitting).toBe(false);
    expect(p.mountKey).toBe('');
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(false);
  });

  it('draws exactly two per plant across several plants, never drifting', () => {
    giveSeeds(h, 3);
    const beds = [BED, BED2, 'bed_eastbrook_3'];
    for (const bedId of beds) {
      clearCast(h.sim);
      expect(countDraws(h.sim, () => plant(h, bedId))).toBe(2);
    }
    expect(h.meta.farmPlots.size).toBe(3);
  });
});

describe('plantCrop gate 12: the hoe gate (the crop-ladder tool half)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it('the ladder is traversable: each tier hoe wields inside the PREVIOUS tier crops teaching ceiling', () => {
    // Deviation (ab)'s "traversable because teaching ceilings run
    // 50/75/100/100" claim as a GUARD: if a retune ever pushes a wield gate
    // past what the previous tier's crops can teach, farming soft-locks at
    // that rung (the crop is unlocked but its hoe is unwieldable and no
    // lower crop can teach further) and this reds.
    for (const tier of [2, 3, 4] as const) {
      expect(
        wieldRequirementForTier(tier),
        `the tier ${tier} hoe must be wieldable off tier ${tier - 1} crops`,
      ).toBeLessThanOrEqual(farmingTeachingCeilingFor(tier - 1));
    }
    // The shipped ladder literals, so the inequality above is never
    // vacuously loose: wield gates 0/40/70/85 layered over the crop
    // thresholds 0/25/50/75.
    expect([1, 2, 3, 4].map((t) => wieldRequirementForTier(t))).toEqual([0, 40, 70, 85]);
    expect([1, 2, 3, 4].map((t) => farmCropSkillThreshold(t))).toEqual([0, 25, 50, 75]);
  });

  it("refuses a farmer with no hoe: reason 'tool', zero draws, nothing consumed", () => {
    giveSeeds(h);
    h.sim.removeItem(HOE_ID, 1, h.pid);
    expect(h.sim.countItem(HOE_ID, h.pid)).toBe(0);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plant(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('tool');
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(h.meta.farmPlots.size).toBe(0);
    // Anti-vacuous: the hoe back in bags, the same command plants.
    h.sim.addItem(HOE_ID, 1, h.pid);
    plant(h);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
  });

  it('gates the WIELD, not ownership: bronze_hoe at 39 refuses a tier-2 crop, at 40 it plants', () => {
    // marsh_rice is tier 2 (skill threshold 25; the R22 wield requirement for
    // a tier-2 land tool is 40): at proficiency 39 the skill gate passes, the
    // wield filter drops the OWNED bronze_hoe from the scan, the harness
    // garden_hoe (tier 1) cannot cover tier 2, and the plant denies 'tool'.
    // The SAME inventory at 40 plants: both directions, or the filter pin is
    // vacuous.
    h.sim.addItem('marsh_rice_seed', 2, h.pid);
    h.sim.addItem('bronze_hoe', 1, h.pid);
    h.meta.gatheringProficiency.farming = 39;
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plant(h, BED, 'marsh_rice'))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('tool');
    expect(h.meta.farmPlots.size).toBe(0);
    expect(h.sim.countItem('marsh_rice_seed', h.pid)).toBe(2);

    h.meta.gatheringProficiency.farming = 40;
    expect(countDraws(h.sim, () => plant(h, BED, 'marsh_rice'))).toBe(2);
    expect(h.meta.farmPlots.get(BED)?.cropId).toBe('marsh_rice');
    expect(h.sim.countItem('marsh_rice_seed', h.pid)).toBe(1);
  });

  it('preserves stealth, sitting and mount on the tool refusal (the trio stays below gate 12)', () => {
    // The no_tonic mirror arm one describe up, re-armed at the gate BELOW it:
    // gate 12 is the last deny arm before the deliberate-action trio, so a
    // hoe-less plant must refuse without revealing or unseating the farmer.
    giveSeeds(h);
    h.sim.removeItem(HOE_ID, 1, h.pid);
    const p = h.sim.player;
    p.sitting = true;
    p.mountKey = DEFAULT_MOUNT;
    p.auras.push({
      id: 'stealth',
      name: 'Stealth',
      kind: 'stealth',
      remaining: 600,
      duration: 600,
      value: 0,
      sourceId: p.id,
      school: 'physical',
    });
    p.stealthed = true;
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plant(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('tool');
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(p.sitting).toBe(true);
    expect(p.mountKey).toBe(DEFAULT_MOUNT);
    expect(p.stealthed).toBe(true);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
  });

  it('answers no_tonic before tool when both gates would refuse (order proof)', () => {
    // The precedence the code ships, pinned: gate 12 (the hoe) sits AFTER
    // the knob trio, so a hoe-less tonic plant with no tonic in bags is told
    // about the tonic, never the hoe. Both gates would genuinely refuse here.
    giveSeeds(h);
    h.sim.removeItem(HOE_ID, 1, h.pid);
    expect(h.sim.countItem(FARM_GROWTH_TONIC_ITEM_ID, h.pid)).toBe(0);
    const from = h.sim.events.length;
    expect(
      countDraws(h.sim, () =>
        plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID, { tonic: true }),
      ),
    ).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_tonic');
    // With the tonic supplied, the SAME command falls through to 'tool': the
    // second half is what keeps the first from passing vacuously.
    h.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 1, h.pid);
    const from2 = h.sim.events.length;
    expect(
      countDraws(h.sim, () =>
        plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID, { tonic: true }),
      ),
    ).toBe(0);
    expect(denyReason(h.sim, from2)).toBe('tool');
    // The tonic that passed its gate was NOT spent on the tool refusal.
    expect(h.sim.countItem(FARM_GROWTH_TONIC_ITEM_ID, h.pid)).toBe(1);
  });
});

describe('the knob payload (the knobs phase): payments, denies, thresholds', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  function plantK(knobs: FarmPlantKnobs, bedId = BED): void {
    plantCrop(h.sim.ctx, h.sim.player, h.meta, bedId, CROP_ID, knobs);
  }

  /** Grant everything any knob combination could pay with. */
  function giveAllSupplies(): void {
    giveSeeds(h, 2);
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 2, h.pid);
    h.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 2, h.pid);
    h.sim.addItem(PRODUCE_ID, 4, h.pid);
  }

  it('pins the tonic tuning to its literals', () => {
    // The wire-name-constant rule: one literal pin for the pair every other
    // arm reaches through the import.
    expect(FARM_TONIC_BONUS_CHANCE).toBe(0.5);
    expect(FARM_TONIC_BONUS_PICKS).toBe(2);
  });

  it('draws EXACTLY two under EVERY knob combination, and stores what was paid', () => {
    // THE PHASE'S ONE HARD RULE, pinned as the acceptance criterion states
    // it: the draw count is identical with and without each knob, across all
    // eight combinations. Each combination runs on a fresh same-seed harness
    // with every payment affordable, and the stored flags are asserted per
    // combination so the two-draw count is two draws WITH the knobs armed,
    // never two draws because the payload was dropped.
    const combos: FarmPlantKnobs[] = [
      {},
      { compost: true },
      { watch: true },
      { tonic: true },
      { compost: true, watch: true },
      { compost: true, tonic: true },
      { watch: true, tonic: true },
      { compost: true, watch: true, tonic: true },
    ];
    const rolled: [number, number][] = [];
    for (const combo of combos) {
      const hc = makeHarness(41);
      hc.sim.addItem(SEED_ID, 1, hc.pid);
      hc.sim.addItem(FARM_COMPOST_ITEM_ID, 1, hc.pid);
      hc.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 1, hc.pid);
      hc.sim.addItem(PRODUCE_ID, 4, hc.pid);
      const draws = countDraws(hc.sim, () =>
        plantCrop(hc.sim.ctx, hc.sim.player, hc.meta, BED, CROP_ID, combo),
      );
      expect(draws, JSON.stringify(combo)).toBe(2);
      const plot = hc.meta.farmPlots.get(BED) as PlotState;
      expect(plot.compost, JSON.stringify(combo)).toBe(combo.compost === true);
      expect(plot.watch, JSON.stringify(combo)).toBe(combo.watch === true);
      expect(plot.tonic, JSON.stringify(combo)).toBe(combo.tonic === true);
      rolled.push([plot.survivalRoll as number, plot.yieldSeed as number]);
    }
    // The headline claim stated directly rather than by inference: same sim
    // seed, same TWO PRE-ROLLED VALUES, whatever the knobs. Eight identical
    // (survivalRoll, yieldSeed) pairs, not merely eight identical counts.
    for (const pair of rolled) expect(pair).toEqual(rolled[0]);
  });

  it('consumes exactly one compost for the compost knob and nothing else moves', () => {
    giveAllSupplies();
    const from = h.sim.events.length;
    plantK({ compost: true });
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_GROWTH_TONIC_ITEM_ID, h.pid)).toBe(2);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(4);
    expect((h.meta.farmPlots.get(BED) as PlotState).compost).toBe(true);
    expect(eventsOf(h.sim, from, 'farmPlanted')).toHaveLength(1);
  });

  it('consumes the EXACT watch-fee produce and nothing else moves (the fee pin)', () => {
    // The acceptance criterion verbatim: the exact produce item leaves the
    // bag. Tier 1 fee is 2, base grade first, so the base stack pays it all
    // and the fine twin never moves.
    h.sim.addItem(SEED_ID, 1, h.pid);
    h.sim.addItem(PRODUCE_ID, 3, h.pid);
    h.sim.addItem(FINE_ID, 2, h.pid);
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 2, h.pid);
    h.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 2, h.pid);
    plantK({ watch: true });
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(2);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(2);
    expect(h.sim.countItem(FARM_GROWTH_TONIC_ITEM_ID, h.pid)).toBe(2);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(0);
    expect((h.meta.farmPlots.get(BED) as PlotState).watch).toBe(true);
  });

  it('pays a mixed fee in the fixed tier-ascending order when no single stack covers it', () => {
    h.sim.addItem(SEED_ID, 1, h.pid);
    h.sim.addItem(PRODUCE_ID, 1, h.pid);
    h.sim.addItem(FINE_ID, 5, h.pid);
    plantK({ watch: true });
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(0);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(4);
    expect((h.meta.farmPlots.get(BED) as PlotState).watch).toBe(true);
  });

  it('consumes exactly one tonic for the tonic knob', () => {
    giveAllSupplies();
    plantK({ tonic: true });
    expect(h.sim.countItem(FARM_GROWTH_TONIC_ITEM_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(2);
    expect((h.meta.farmPlots.get(BED) as PlotState).tonic).toBe(true);
  });

  it('denies no_compost with zero draws and NOTHING consumed', () => {
    giveSeeds(h);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ compost: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_compost');
    expect(h.meta.farmPlots.size).toBe(0);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
  });

  it('denies no_fee_produce with zero draws and NOTHING consumed', () => {
    giveSeeds(h);
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 1, h.pid);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ watch: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_fee_produce');
    expect(h.meta.farmPlots.size).toBe(0);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
  });

  it('denies no_tonic WITHOUT spending the compost that had already passed its gate', () => {
    // The atomicity proof, stronger than a plain no_tonic arm: compost was
    // requested, present and affordable, and its gate had already passed when
    // the tonic gate refused, yet nothing was consumed, because every gate is
    // a check and every payment happens together after the last gate.
    giveSeeds(h);
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 1, h.pid);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ compost: true, tonic: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_tonic');
    expect(h.meta.farmPlots.size).toBe(0);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
  });

  it('denies no_tonic WITHOUT spending the watch fee whose plan had already passed its gate', () => {
    // The fee twin of the compost atomicity arm above, and the sharper one:
    // the fee is the payment most at risk of being hoisted into its gate,
    // because planWatchFee returns a multi-leg PLAN at gate 10 and the legs
    // must spend only in the shared post-gate payment block. A passed fee
    // gate followed by a tonic refusal leaves every produce stack untouched
    // (this arm kills the QA round's surviving spend-at-gate mutant).
    giveSeeds(h);
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 1, h.pid);
    h.sim.addItem(PRODUCE_ID, 2, h.pid);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ compost: true, watch: true, tonic: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_tonic');
    expect(h.meta.farmPlots.size).toBe(0);
    expect(h.sim.countItem(SEED_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(2);
  });

  it('denies an already-knobbed replant as bed_taken, leaving the plot and bags untouched', () => {
    // The fourth acceptance deny arm: replanting an occupied plot answers
    // bed_taken from the earlier gate no matter what knobs ride the retry,
    // and neither the stored flags nor the retry's would-be payments move.
    giveAllSupplies();
    plantK({ compost: true });
    clearCast(h.sim);
    const compostBefore = h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid);
    const tonicBefore = h.sim.countItem(FARM_GROWTH_TONIC_ITEM_ID, h.pid);
    const produceBefore = h.sim.countItem(PRODUCE_ID, h.pid);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ compost: true, watch: true, tonic: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bed_taken');
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    expect(plot.compost).toBe(true);
    expect(plot.watch).toBe(false);
    expect(plot.tonic).toBe(false);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(compostBefore);
    expect(h.sim.countItem(FARM_GROWTH_TONIC_ITEM_ID, h.pid)).toBe(tonicBefore);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(produceBefore);
  });

  it('answers no_seed before no_compost, no_compost before no_fee_produce, and that before no_tonic (order proofs)', () => {
    // The knob gates joined the STATED order, so the precedence family grows
    // with them (the bed_taken-vs-no_seed precedent): each arm co-arms two
    // gates and the earlier one must own the reason.
    let from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ compost: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_seed');

    giveSeeds(h, 2);
    from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ compost: true, watch: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_compost');

    h.sim.addItem(FARM_COMPOST_ITEM_ID, 1, h.pid);
    from = h.sim.events.length;
    expect(countDraws(h.sim, () => plantK({ compost: true, watch: true, tonic: true }))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_fee_produce');
  });

  it('a compost plot survives a roll that withers the same unknobbed plot', () => {
    // The threshold bend proven at the HARVEST, not just in the pure ramp: at
    // skill 0 the tier-1 chance is 0.85 plain and 0.95 with compost, so a
    // stored roll of 0.90 sits exactly between them and the knob flips the
    // outcome of the same already-drawn value.
    const knobbed = makeHarness(41);
    const plain = makeHarness(41);
    for (const [hx, knobs] of [
      [knobbed, { compost: true } as FarmPlantKnobs],
      [plain, {} as FarmPlantKnobs],
    ] as const) {
      hx.sim.addItem(SEED_ID, 1, hx.pid);
      hx.sim.addItem(FARM_COMPOST_ITEM_ID, 1, hx.pid);
      plantCrop(hx.sim.ctx, hx.sim.player, hx.meta, BED, CROP_ID, knobs);
      clearCast(hx.sim);
      (hx.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.9;
      hx.advance(CROP.durationMs);
    }
    const fromK = knobbed.sim.events.length;
    harvestCrop(knobbed.sim.ctx, knobbed.sim.player, knobbed.meta, BED);
    expect(eventsOf(knobbed.sim, fromK, 'farmHarvested')).toHaveLength(1);
    expect(eventsOf(knobbed.sim, fromK, 'farmWithered')).toEqual([]);
    const fromP = plain.sim.events.length;
    harvestCrop(plain.sim.ctx, plain.sim.player, plain.meta, BED);
    expect(eventsOf(plain.sim, fromP, 'farmWithered')).toHaveLength(1);
    expect(eventsOf(plain.sim, fromP, 'farmHarvested')).toEqual([]);
  });

  it('a watch plot survives the same in-between roll (one knob one job, same bonus)', () => {
    h.sim.addItem(SEED_ID, 1, h.pid);
    h.sim.addItem(PRODUCE_ID, 2, h.pid);
    plantK({ watch: true });
    clearCast(h.sim);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.9;
    h.advance(CROP.durationMs);
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
  });

  it('caps survival at exactly 1: at the cap, and clamped back onto it from above', () => {
    // The acceptance boundary pair, in the shipped [0, 1] units (the phase
    // file's "100 points" scale is this, times 100): the band top lands
    // exactly ON the cap with no knobs, and every knobbed sum past it clamps
    // to exactly 1, never above. With the shipped constants no combination
    // lands on exactly 1.0 through knob addition alone (the base never dips
    // below 0.85), so at-the-cap is the band top and above-the-cap is any
    // knobbed band top; just-below proves the clamp is not flattening the
    // whole ramp.
    expect(farmSurvivalChance(FARM_SURVIVAL_BAND_SPAN, 1, false, false)).toBe(1);
    expect(farmSurvivalChance(FARM_SURVIVAL_BAND_SPAN, 1, true, true)).toBe(1);
    expect(farmSurvivalChance(0, 1, true, true)).toBe(1);
    expect(farmSurvivalChance(0, 1, true, false)).toBeCloseTo(0.95, 10);
    expect(farmSurvivalChance(0, 1, true, false)).toBeLessThan(1);
    // At the capped chance of exactly 1, NO roll in the draw domain [0, 1)
    // can wither: the both-knobs plot survives even a 0.9999 roll at the
    // gate skill.
    h.sim.addItem(SEED_ID, 1, h.pid);
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 1, h.pid);
    h.sim.addItem(PRODUCE_ID, 2, h.pid);
    plantK({ compost: true, watch: true });
    clearCast(h.sim);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.9999;
    h.advance(CROP.durationMs);
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
  });

  it('projects the paid knob flags onto the wire row', () => {
    giveAllSupplies();
    plantK({ compost: true, watch: true, tonic: true });
    const row = h.sim.farmPlotsFor(h.pid)[0];
    expect(row?.compost).toBe(true);
    expect(row?.watch).toBe(true);
    expect(row?.tonic).toBe(true);
    expect(row?.status).toBe('growing');
  });

  it('keeps the paid flags THROUGH a save and load, still bending the threshold', () => {
    // The first phase whose persisted knob flags can be true (Phase 3 always
    // wrote false, so the round-trip pins in professions_farming_state were
    // inert until now): a knobbed plot must reload with its flags intact and
    // the survival bend still live, or a relog would silently strip an
    // insurance the player paid for.
    //
    // On the tonic-winning seed, NOT the default: the closing delta assertion
    // proves the reloaded tonic flag armed the toniced expansion, which only
    // means something when that expansion differs from the plain one (the
    // non-vacuity guard below holds this arm honest).
    h = makeHarness(TONIC_WIN_SEED);
    giveAllSupplies();
    plantK({ compost: true, watch: true, tonic: true });
    clearCast(h.sim);
    // A roll that withers unknobbed at skill 0 (chance 0.85) but survives
    // with both survival knobs (capped at 1), so the post-reload harvest
    // outcome proves the FLAGS, not just the row shape.
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.9;
    const saved = h.sim.serializeCharacter(h.pid) as CharacterState;

    let nowMs = h.now() + CROP.durationMs;
    const fresh = new Sim({
      seed: 41,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => nowMs,
    });
    fresh.addPlayer('warrior', 'Farmer', { state: saved });
    const meta = [...fresh.players.values()][0] as PlayerMeta;
    const plot = meta.farmPlots.get(BED) as PlotState;
    expect(plot.compost).toBe(true);
    expect(plot.watch).toBe(true);
    expect(plot.tonic).toBe(true);
    // Stand the RELOADED entity at the bed directly (the noPlayer Sim's
    // primary getter is not what this arm is about).
    const farmer = fresh.entities.get(meta.entityId);
    if (!farmer) throw new Error('reloaded farmer entity missing');
    const bed = farmBedById(BED);
    if (!bed) throw new Error(`no such bed: ${BED}`);
    farmer.pos.x = bed.x;
    farmer.pos.z = bed.z;
    farmer.prevPos = { ...farmer.pos };
    const from = fresh.events.length;
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 0, true);
    // Non-vacuity guard: the reloaded seed's tonic roll WINS, so the delta
    // assertion at the bottom really pins the flag read, not a coincidence
    // of identical expansions.
    expect(expected.count).toBeGreaterThan(
      resolveFarmHarvest(plot.yieldSeed as number, 0, false).count,
    );
    // Delta, not an absolute: the reloaded bags still carry the produce the
    // watch fee did not consume at plant time.
    const produceBefore = fresh.countItem(PRODUCE_ID, meta.entityId);
    // The one draw is the golden-harvest roll (every harvest spends it); on
    // this reloaded Sim it is the FIRST post-construction draw, probed to
    // LOSE (seed 41 noPlayer: 0.826341), so the payout stays unmultiplied.
    expect(countDraws(fresh, () => harvestCrop(fresh.ctx, farmer, meta, BED))).toBe(1);
    expect(eventsOf(fresh, from, 'farmHarvested')).toHaveLength(1);
    expect(eventsOf(fresh, from, 'farmWithered')).toEqual([]);
    // And the reloaded tonic flag really armed the toniced expansion.
    expect(fresh.countItem(PRODUCE_ID, meta.entityId) - produceBefore).toBe(expected.count);
    nowMs += 1;
  });
});

describe('the tonic yield arm: seed expansion, never a draw', () => {
  it('adds the flat bonus at base grade, or nothing, and never touches the fine count', () => {
    // The pure shape over a seed sweep: a toniced expansion equals the plain
    // one except for a possible flat base-grade bonus, both outcomes really
    // occur, and count + fine = picks holds on every shape.
    let wins = 0;
    let losses = 0;
    for (let seed = 0; seed < 300; seed++) {
      const plain = resolveFarmHarvest(seed, 20);
      const toniced = resolveFarmHarvest(seed, 20, true);
      expect(toniced.fine, `seed ${seed}`).toBe(plain.fine);
      const delta = toniced.count - plain.count;
      expect([0, FARM_TONIC_BONUS_PICKS], `seed ${seed}`).toContain(delta);
      expect(toniced.picks - plain.picks, `seed ${seed}`).toBe(delta);
      expect(toniced.count + toniced.fine, `seed ${seed}`).toBe(toniced.picks);
      if (delta > 0) wins++;
      else losses++;
    }
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
  });

  it('leaves the UNTONICED expansion bit-identical: the default arm is the two-arg call', () => {
    for (const seed of [0, 1, 999, 123_456]) {
      expect(resolveFarmHarvest(seed, 30)).toEqual(resolveFarmHarvest(seed, 30, false));
    }
  });

  it('NEVER pays less for more skill, toniced or plain (the monotonicity sweep)', () => {
    // The player-favorable invariant the banner states, proven rather than
    // asserted: proficiency only rises, so a plot left in the ground while
    // its owner improves must pay better, never worse. The review round
    // caught the original loop-relative tonic read breaking exactly this (a
    // skill-up lengthened the lives loop, moved the bonus roll onto a
    // different stream value, and flipped wins into losses thousands of
    // times per million adjacent steps); the seed-anchored read this sweep
    // pins makes the tonic outcome a plant-time constant.
    for (let seed = 0; seed < 200; seed++) {
      let prevPlain = -1;
      let prevToniced = -1;
      for (let skill = 0; skill <= 100; skill += 5) {
        const plain = resolveFarmHarvest(seed, skill);
        const toniced = resolveFarmHarvest(seed, skill, true);
        expect(plain.picks, `seed ${seed} skill ${skill} plain`).toBeGreaterThanOrEqual(prevPlain);
        expect(toniced.picks, `seed ${seed} skill ${skill} toniced`).toBeGreaterThanOrEqual(
          prevToniced,
        );
        // The tonic outcome itself is skill-independent: the delta is the
        // SAME flat bonus (or the same nothing) at every skill.
        expect(toniced.picks - plain.picks, `seed ${seed} skill ${skill} delta`).toBe(
          resolveFarmHarvest(seed, 0, true).picks - resolveFarmHarvest(seed, 0).picks,
        );
        prevPlain = plain.picks;
        prevToniced = toniced.picks;
      }
    }
  });

  it('harvests a toniced plot with only the golden roll drawn and pays the expanded yield', () => {
    const h = makeHarness(TONIC_WIN_SEED);
    h.sim.addItem(SEED_ID, 1, h.pid);
    h.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 1, h.pid);
    plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID, { tonic: true });
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0; // survival forced, so this arm is about yield only
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 0, true);
    // Non-vacuity guard: this seed's tonic roll WINS, so the expected yield
    // genuinely differs from the untoniced expansion and the assertion below
    // can see the harvest ignoring the stored flag.
    expect(expected.count).toBeGreaterThan(
      resolveFarmHarvest(plot.yieldSeed as number, 0, false).count,
    );
    // The tonic itself stays a seed expansion (zero draws); the one counted
    // draw is the unconditional golden-harvest roll, a probed LOSER on this
    // seed (TONIC_WIN_SEED's third post-construction draw is 0.902205).
    expect(countDraws(h.sim, () => harvestCrop(h.sim.ctx, h.sim.player, h.meta, BED))).toBe(1);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(expected.count);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(expected.fine);
  });

  it('returns CAP plus BONUS picks on a capped toniced win: the cap bounds the loop, not the yield', () => {
    // keepChance saturates at 1 above skill (1 - base) / scale * 100, so
    // every pick keeps its life and the loop runs to the cap exactly (the
    // unclamped-skill seam the resolver banner reserves for tests). On a
    // tonic-winning seed the bonus lands on top: any reader treating
    // FARM_HARVEST_PICK_CAP as the true yield ceiling is wrong by BONUS,
    // which is exactly what this pin exists to say out loud.
    const SKILL_AT_SATURATION = 300;
    let winner = -1;
    for (let seed = 0; seed < 100 && winner < 0; seed++) {
      if (resolveFarmHarvest(seed, 0, true).picks > resolveFarmHarvest(seed, 0).picks) {
        winner = seed;
      }
    }
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(resolveFarmHarvest(winner, SKILL_AT_SATURATION).picks).toBe(FARM_HARVEST_PICK_CAP);
    expect(resolveFarmHarvest(winner, SKILL_AT_SATURATION, true).picks).toBe(
      FARM_HARVEST_PICK_CAP + FARM_TONIC_BONUS_PICKS,
    );
  });

  it('pays a toniced harvest N hours late EXACTLY what an on-time one pays', () => {
    // The anti-chore equality re-proven with the knob armed: lateness is not
    // an input to the tonic roll either.
    const onTime = makeHarness(1234);
    const late = makeHarness(1234);
    for (const hx of [onTime, late]) {
      hx.sim.addItem(SEED_ID, 1, hx.pid);
      hx.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 1, hx.pid);
      plantCrop(hx.sim.ctx, hx.sim.player, hx.meta, BED, CROP_ID, { tonic: true });
      clearCast(hx.sim);
    }
    onTime.advance(CROP.durationMs);
    late.advance(CROP.durationMs + 12 * 60 * 60_000);
    harvestCrop(onTime.sim.ctx, onTime.sim.player, onTime.meta, BED);
    harvestCrop(late.sim.ctx, late.sim.player, late.meta, BED);
    expect(late.sim.countItem(PRODUCE_ID, late.pid)).toBe(
      onTime.sim.countItem(PRODUCE_ID, onTime.pid),
    );
    expect(late.sim.countItem(FINE_ID, late.pid)).toBe(onTime.sim.countItem(FINE_ID, onTime.pid));
    expect(onTime.sim.countItem(PRODUCE_ID, onTime.pid)).toBeGreaterThan(0);
  });
});

describe('the slotted farming tool effect at harvest (the hoe phase C3 wiring)', () => {
  // Every arm here holds to the vacuity rule: the armed expectation is FIRST
  // shown to differ from the unarmed one on the plot's own seed (probed, or
  // swept in-arm), so an equality below can never pass because both sides
  // collapsed to the unarmed harvest. And every arm counts EXACTLY ONE
  // ctx.rng draw at harvest, the unconditional golden-harvest roll (a probed
  // LOSER on the default harness seed, so no payout multiplies): the effect
  // halves themselves are seed expansions, never draws (tier-1 plots here;
  // the second draw a tier 3/4 harvest spends is the seed-back roll, owned
  // by its own describe below).
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
    giveSeeds(h, 2);
  });

  /** Plant, ripen, and force the survival win: these arms are about yield. */
  function ripen(bedId = BED): PlotState {
    plant(h, bedId);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    const plot = h.meta.farmPlots.get(bedId) as PlotState;
    plot.survivalRoll = 0;
    return plot;
  }

  it("auto-mode Gatherer's Cache pays unarmed + bonus and spends exactly one charge, draw-free", () => {
    const plot = ripen();
    const slot = slotEffect('gatherers_cache');
    h.meta.toolEffectSlots = { farming: slot };
    const unarmed = resolveFarmHarvest(plot.yieldSeed as number, 0);
    const armed = resolveFarmHarvest(plot.yieldSeed as number, 0, false, {
      bonusPicks: TOOL_EFFECTS.gatherers_cache.bonus,
    });
    // In-arm non-vacuity: the flat quantity bonus moves the count on THIS
    // seed, so the grant equality below cannot be satisfied by the unarmed
    // expansion.
    expect(armed.count).toBeGreaterThan(unarmed.count);
    expect(armed.picks).toBe(unarmed.picks + TOOL_EFFECTS.gatherers_cache.bonus);
    const before = slot.durability;
    expect(countDraws(h.sim, () => harvest(h))).toBe(1);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(armed.count);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(armed.fine);
    // Exactly one charge: the R42 settle spends only when the bonus changed
    // the granted outcome, which the non-vacuity guard proved it did.
    expect(slot.durability).toBe(before - 1);
  });

  it("the Maker's Charm is admitted on a hoe but CAPPED, and the cap bites", () => {
    // The charm-on-a-hoe path had NO arm before Phase 11e, which is how the
    // overlap survived two packets: the charm slots on farming for real, its
    // catalog bonus is 2, and 2 is exactly FARM_TONIC_BONUS_PICKS, so uncapped
    // the pair paid +4 picks on a guaranteed floor of 3.
    //
    // This arm is owed BECAUSE the cap is invisible to every other arm in this
    // file: they all use the Gatherer's Cache, whose catalog bonus is already
    // 1, so a cap of 1 leaves them green by construction and proves nothing.
    // Here the catalog bonus and the capped bonus DIFFER, which is the only
    // shape that can fail if the cap is removed.
    expect(TOOL_EFFECTS.makers_charm.bonus).toBe(2);
    expect(FARM_EFFECT_BONUS_PICK_CAP).toBe(1);
    expect(TOOL_EFFECTS.makers_charm.bonus).toBeGreaterThan(FARM_EFFECT_BONUS_PICK_CAP);
    // The catalog is UNTOUCHED, which is the other half of the ruling: the cap
    // lives in farming's mapping so the other three professions keep the full 2.
    expect(slotToolEffectRefused('farming', 'makers_charm')).toBe(false);

    const plot = ripen();
    const slot = slotEffect('makers_charm');
    h.meta.toolEffectSlots = { farming: slot };
    const seed = plot.yieldSeed as number;
    const unarmed = resolveFarmHarvest(seed, 0);
    const capped = resolveFarmHarvest(seed, 0, false, {
      bonusPicks: FARM_EFFECT_BONUS_PICK_CAP,
    });
    const uncapped = resolveFarmHarvest(seed, 0, false, {
      bonusPicks: TOOL_EFFECTS.makers_charm.bonus,
    });
    // The two outcomes really differ on this seed, so the grant below
    // discriminates between them rather than passing either way.
    expect(uncapped.picks).toBe(capped.picks + 1);
    expect(capped.picks).toBe(unarmed.picks + FARM_EFFECT_BONUS_PICK_CAP);

    harvest(h);
    const granted = h.sim.countItem(PRODUCE_ID, h.pid) + h.sim.countItem(FINE_ID, h.pid);
    expect(granted, 'the harvest must pay the CAPPED bonus').toBe(capped.picks);
    expect(granted, 'the harvest must NOT pay the catalog bonus').not.toBe(uncapped.picks);
  });

  it("auto-mode Artisan's Eye upgrades the fine outcome on a probed winner seed", () => {
    const plot = ripen();
    // The probe: sweep for a yieldSeed whose expansion gains a fine pick
    // under the eye's fine-chance bump (a magic constant would go quietly
    // vacuous the moment a tuning constant moved; the sweep both finds the
    // case and proves it is real).
    const fineBump = TOOL_EFFECTS.artisans_eye.bonus * FARM_FINE_CHANCE_EFFECT_BONUS;
    let winner = -1;
    for (let seed = 0; seed < 10_000; seed++) {
      if (
        resolveFarmHarvest(seed, 0, false, { fineChanceBonus: fineBump }).fine >
        resolveFarmHarvest(seed, 0).fine
      ) {
        winner = seed;
        break;
      }
    }
    expect(winner).toBeGreaterThanOrEqual(0);
    plot.yieldSeed = winner;
    const slot = slotEffect('artisans_eye');
    h.meta.toolEffectSlots = { farming: slot };
    const unarmed = resolveFarmHarvest(winner, 0);
    const armed = resolveFarmHarvest(winner, 0, false, { fineChanceBonus: fineBump });
    // In-arm non-vacuity guard (the probed winner, restated where it counts).
    expect(armed.fine).toBeGreaterThan(unarmed.fine);
    const before = slot.durability;
    expect(countDraws(h.sim, () => harvest(h))).toBe(1);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(armed.count);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(armed.fine);
    expect(slot.durability).toBe(before - 1);
  });

  it('the last-charge signal: farmHarvested carries effectDepleted exactly on the emptying spend', () => {
    // The gatherResult precedent (the node path's last-charge signal): a
    // farmer's charm must not break silently, so the harvest that spends the
    // final charge says so on its own event, and ONLY that harvest. Three
    // beats: a spend that leaves charges (no flag), the emptying spend (flag
    // true), and a use on the already-empty slot (no flag, unarmed payout).
    const plot = ripen();
    void plot;
    const slot = slotEffect('gatherers_cache');
    slot.durability = 2;
    h.meta.toolEffectSlots = { farming: slot };
    const from1 = h.sim.events.length;
    harvest(h);
    const first = eventsOf(h.sim, from1, 'farmHarvested')[0];
    expect(slot.durability).toBe(1);
    expect('effectDepleted' in first).toBe(false);
    // The emptying spend announces itself.
    ripen();
    const from2 = h.sim.events.length;
    harvest(h);
    const second = eventsOf(h.sim, from2, 'farmHarvested')[0];
    expect(slot.durability).toBe(0);
    expect(second.effectDepleted).toBe(true);
    // The empty slot stays silent and pays unarmed (applied is false).
    giveSeeds(h);
    const plot3 = ripen();
    const unarmed = resolveFarmHarvest(plot3.yieldSeed as number, 0);
    const from3 = h.sim.events.length;
    harvest(h);
    const third = eventsOf(h.sim, from3, 'farmHarvested')[0];
    expect('effectDepleted' in third).toBe(false);
    expect(third.count).toBe(unarmed.count);
  });

  it('pins the fine-chance effect bump to its literal (the wire-name-constant rule)', () => {
    // TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER: the one effect
    // constant every armed arm above reaches through the import, pinned as a
    // literal so a retune is a deliberate edit here too (the seed-back maps'
    // own treatment; without this the winner sweep would follow a magnitude
    // change silently).
    expect(FARM_FINE_CHANCE_EFFECT_BONUS).toBe(0.1);
  });

  it('the R47 ratchet latches at the farming use site: a better CARRIED hoe re-prices an applied use', () => {
    // The ratchet reads the UNFILTERED ownership scan (bestOwnedGatherToolFor),
    // deliberately matching the node path's own settle (gathering.ts) and the
    // R30 recharge read ("the best tool the owner HOLDS at recharge time"):
    // the latch can only price the slot UP, so an unwieldable carried hoe is
    // the anti-gaming case, not a defense the player would want. Minting low
    // with the good hoe stashed must buy nothing past the first
    // bonus-bearing harvest.
    const plot = ripen();
    void plot;
    const slot = slotEffect('gatherers_cache'); // minted at the common ceiling
    h.meta.toolEffectSlots = { farming: slot };
    // Rare, carried, NOT wieldable at the harness's farming skill 0.
    h.sim.addItem('osmium_hoe', 1, h.pid);
    const commonCeil = startingDurabilityFor('gatherers_cache', 'common');
    const rareCeil = startingDurabilityFor('gatherers_cache', 'rare');
    expect(slot.maxDurability).toBe(commonCeil);
    expect(rareCeil).toBeGreaterThan(commonCeil); // the latch is a real raise
    harvest(h);
    expect(slot.maxDurability).toBe(rareCeil);
  });

  it('R42 false branch: an applied use whose bonus changed nothing keeps the charge and still latches', () => {
    const plot = ripen();
    // The inverted probe: a yieldSeed where the eye's bump upgrades NOTHING
    // (the common case; the winner sweep above found the rare opposite). The
    // in-arm no-change guard proves both halves coincide, so a kept charge
    // below can only mean the false branch ran, never that the apply was
    // skipped.
    const fineBump = TOOL_EFFECTS.artisans_eye.bonus * FARM_FINE_CHANCE_EFFECT_BONUS;
    let noChange = -1;
    for (let seed = 0; seed < 10_000; seed++) {
      const armed = resolveFarmHarvest(seed, 0, false, { fineChanceBonus: fineBump });
      const plain = resolveFarmHarvest(seed, 0);
      if (armed.fine === plain.fine && armed.count === plain.count) {
        noChange = seed;
        break;
      }
    }
    expect(noChange).toBeGreaterThanOrEqual(0);
    plot.yieldSeed = noChange;
    const slot = slotEffect('artisans_eye');
    h.meta.toolEffectSlots = { farming: slot };
    h.sim.addItem('osmium_hoe', 1, h.pid);
    const before = slot.durability;
    const rareCeil = startingDurabilityFor('artisans_eye', 'rare');
    expect(slot.maxDurability).toBeLessThan(rareCeil);
    expect(countDraws(h.sim, () => harvest(h))).toBe(1);
    // The charge survives a use that paid nothing extra (the R42 predicate's
    // false branch: spend only when the bonus changed what was received)...
    expect(slot.durability).toBe(before);
    // ...while the ratchet latches on every APPLIED use, spend or no spend.
    expect(slot.maxDurability).toBe(rareCeil);
  });

  it('a prompt-mode slot fires nothing: output byte-equal to unarmed and the charge kept', () => {
    // harvest_crop carries no confirm channel on the wire, so `confirmed` is
    // hard false at this call site: a 'prompt' slot skips WHOLE (no bonus,
    // no spend), the stale-client fail-safe direction.
    const plot = ripen();
    const slot = slotEffect('gatherers_cache', { confirmMode: 'prompt' });
    h.meta.toolEffectSlots = { farming: slot };
    const unarmed = resolveFarmHarvest(plot.yieldSeed as number, 0);
    const armed = resolveFarmHarvest(plot.yieldSeed as number, 0, false, {
      bonusPicks: TOOL_EFFECTS.gatherers_cache.bonus,
    });
    // Non-vacuity: the slot WOULD have changed the outcome had it fired, so
    // the byte-equal assertion below really distinguishes skip from fire.
    expect(armed.count).not.toBe(unarmed.count);
    const before = slot.durability;
    expect(countDraws(h.sim, () => harvest(h))).toBe(1);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(unarmed.count);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(unarmed.fine);
    expect(slot.durability).toBe(before);
  });
});

describe('the mint refuses a prompt-mode FARMING slot (no confirm channel exists)', () => {
  // The arm directly above documents WHY: harvest_crop carries no confirm
  // channel, so `confirmed` is hard false at farming's one apply site and a
  // prompt slot skips whole, forever. A charm consumed into that slot would
  // be a dead purchase, so the ONE MINT AUTHORITY (resolveSlotToolEffect)
  // refuses the pair at the mint with the invalid-request shape it uses for
  // every never-fires pairing. Both directions pinned, plus the non-farming
  // control, so neither a blanket prompt refusal nor a blanket farming
  // refusal can satisfy this block.
  function bagsWith(h: Harness, ...itemIds: string[]) {
    for (const itemId of itemIds) h.sim.addItem(itemId, 1, h.pid);
    return h.meta.inventory;
  }

  it("refuses prompt on farming, mints 'always' on farming, and keeps prompt on mining", () => {
    const h = makeHarness();
    // The harness already granted the garden hoe; the charm and a pick join it.
    const inventory = bagsWith(h, 'gatherers_cache', 'copper_mining_pick');
    const prompt = resolveSlotToolEffect(
      inventory,
      'farming',
      'gatherers_cache',
      'prompt',
      ITEMS,
      h.meta.name,
      undefined,
    );
    expect(prompt).toEqual({ ok: false, reason: 'invalid_request' });
    // 'always' on farming still mints: the refusal is the MODE pairing, not
    // a farming slot policy (the hoe phase lifted that).
    const always = resolveSlotToolEffect(
      inventory,
      'farming',
      'gatherers_cache',
      'always',
      ITEMS,
      h.meta.name,
      undefined,
    );
    expect(always.ok).toBe(true);
    // BOTH live effects mint on farming through the one authority: the act
    // arms above build their slots with slotEffect() directly, so without
    // this line artisans_eye's acted-on state was never proven REACHABLE
    // through resolveSlotToolEffect (a kind arm refusing quality effects on
    // a grade-less profession would have left those arms green).
    const eye = resolveSlotToolEffect(
      bagsWith(h, 'artisans_eye'),
      'farming',
      'artisans_eye',
      'always',
      ITEMS,
      h.meta.name,
      undefined,
    );
    expect(eye.ok).toBe(true);
    // And prompt on a profession WITH a confirm channel still mints: the
    // non-farming control that keeps this from passing as a blanket prompt
    // refusal.
    const mining = resolveSlotToolEffect(
      inventory,
      'mining',
      'gatherers_cache',
      'prompt',
      ITEMS,
      h.meta.name,
      undefined,
    );
    expect(mining.ok).toBe(true);
  });
});

describe('harvestCrop TIER 1/2: one draw (the golden roll) on every outcome, zero on every deny', () => {
  // Every arm here plants the tier-1 vale_wheat, so the one-draw pins are
  // tier-scoped claims: the one draw is the unconditional golden-harvest
  // roll (a probed LOSER on the default harness seed, so no payout here
  // multiplies; the winner arms live in the golden describe below), and a
  // TIER 3/4 harvest draws exactly two (the seed-back roll then the golden
  // roll), pinned band by band in its own describe below. Tier is an input,
  // not an outcome, so the tier-1 arms here and the tier 3/4 arms there can
  // never fork one stream.
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
    giveSeeds(h, 4);
  });

  /** Plant, jump the clock past the deadline, and clear the flavor cast. */
  function plantAndRipen(bedId = BED): void {
    plant(h, bedId);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
  }

  it('grants produce, clears the bed, emits farmHarvested, and queues the gain', () => {
    plantAndRipen();
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 0);
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => harvest(h));
    expect(draws).toBe(1);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(expected.count);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(expected.fine);
    const harvested = eventsOf(h.sim, from, 'farmHarvested');
    expect(harvested).toHaveLength(1);
    expect(harvested[0].bedId).toBe(BED);
    expect(harvested[0].cropId).toBe(CROP_ID);
    expect(harvested[0].itemId).toBe(PRODUCE_ID);
    expect(harvested[0].count).toBe(expected.count);
    // The gain is queued, not applied: the drain runs earlier in the tick, so
    // a command-time grant lands NEXT tick. The amount is the first schedule
    // row's gain at proficiency 0, read from the table rather than restated,
    // so this arm follows a re-tune instead of reddening on one. That is
    // deliberate, but on its own it makes the arm blind to the very value it
    // reads, so the head gain is pinned to its LITERAL right here rather than
    // only 1600 lines up in the GAIN column arm (11e QA: an uncited mitigation
    // is one edit away from not being one).
    expect(FARMING_GAIN_SCHEDULE[0].gain).toBe(0.25);
    expect(h.meta.pendingGatherGrants).toEqual([
      { professionId: 'farming', amount: FARMING_GAIN_SCHEDULE[0].gain },
    ]);
    expect(h.meta.gatheringProficiency.farming).toBe(0);
    h.sim.tick();
    expect(h.meta.gatheringProficiency.farming).toBe(FARMING_GAIN_SCHEDULE[0].gain);
  });

  it('omits the fine fields entirely when no pick upgraded', () => {
    // The stale-client doctrine: an absent optional keeps the common event
    // byte-identical to the pre-field wire.
    plantAndRipen();
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 0);
    const from = h.sim.events.length;
    harvest(h);
    const ev = eventsOf(h.sim, from, 'farmHarvested')[0];
    if (expected.fine === 0) {
      expect('fineItemId' in ev).toBe(false);
      expect('fineCount' in ev).toBe(false);
    } else {
      expect(ev.fineItemId).toBe(FINE_ID);
      expect(ev.fineCount).toBe(expected.fine);
    }
  });

  it('NEVER emits a zero count: an all-fine harvest collapses into the base fields', () => {
    // The event's base fields describe the grant the player actually received.
    // When every pick upgrades there is no base-grade grant, so the natural
    // `itemId: produce, count: 0` would advertise something that never
    // happened and a client rendering off those fields would print "x0".
    //
    // The seed is SWEPT, not hardcoded: a magic constant would silently stop
    // exercising the case the moment a tuning constant moved, and the sweep
    // both finds the case and proves it is real. Skill 100 maximises the fine
    // chance; the case is roughly one harvest in eight thousand there, so a
    // bounded sweep finds it comfortably.
    const SKILL = 100;
    let allFineSeed = -1;
    for (let seed = 0; seed < 100_000; seed++) {
      const y = resolveFarmHarvest(seed, SKILL);
      if (y.count === 0 && y.fine > 0) {
        allFineSeed = seed;
        break;
      }
    }
    // The sweep found a genuine all-fine yield: without this the arm below
    // could pass against an ordinary mixed harvest and prove nothing.
    expect(allFineSeed).toBeGreaterThanOrEqual(0);
    const swept = resolveFarmHarvest(allFineSeed, SKILL);
    expect(swept.count).toBe(0);
    expect(swept.fine).toBeGreaterThan(0);

    plantAndRipen();
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.yieldSeed = allFineSeed;
    h.meta.gatheringProficiency.farming = SKILL;
    const from = h.sim.events.length;
    harvest(h);

    const ev = eventsOf(h.sim, from, 'farmHarvested')[0];
    // The fine grade rides the BASE fields, and the fine fields are absent, so
    // a present fine pair always means a genuinely MIXED harvest.
    expect(ev.itemId).toBe(FINE_ID);
    expect(ev.count).toBe(swept.fine);
    expect('fineItemId' in ev).toBe(false);
    expect('fineCount' in ev).toBe(false);
    // The event agrees with the bags: every unit is fine grade, none is base.
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(swept.fine);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(0);
    // EXECUTED flag coverage for the fine-produce grant site: this harvest's
    // one grant is the fine item, so these assertions exercise exactly the
    // grant the flags pin's skill-0 harvest almost never reaches (its fine
    // chance is 2 percent per pick) and the source-text sweep can only
    // pattern-match (QA-round finding).
    const loots = eventsOf(h.sim, from, 'loot');
    expect(loots.length).toBeGreaterThan(0);
    for (const lev of loots) {
      expect(lev.silent, lev.text).toBe(true);
      expect(lev.callerLogs, lev.text).toBe(true);
    }
  });

  it('keeps count positive and itemId real on EVERY harvest shape', () => {
    // The invariant the collapse buys, swept across many real plots rather
    // than asserted on one: a consumer may always render the base fields.
    const seen = new Set<string>();
    for (let seed = 0; seed < 120; seed++) {
      const y = resolveFarmHarvest(seed, 100);
      seen.add(y.count === 0 ? 'allFine' : y.fine === 0 ? 'allBase' : 'mixed');
      const allFine = y.count === 0 && y.fine > 0;
      const itemId = allFine ? FINE_ID : PRODUCE_ID;
      const count = allFine ? y.fine : y.count;
      expect(count, `seed ${seed}`).toBeGreaterThan(0);
      expect([PRODUCE_ID, FINE_ID]).toContain(itemId);
    }
    // Anti-vacuous: the sweep really did cover more than one harvest shape.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('flags EVERY grant silent + callerLogs, so one action prints one line', () => {
    // The #2430 double-line trap, pinned at the event level because that is
    // where it is actually decided. The hub loot event is still emitted; what
    // the flags do is ride it as fields telling the client to suppress the
    // generic ding and the "You receive:" line, because the farmHarvested /
    // farmWithered event owns both halves of the feedback. A grant that
    // forgets them prints a second line and stacks a second cue.
    //
    // Asserted over the harvest's OWN loot events rather than a count, so a
    // further grant (a rare-event windfall; the tier 3/4 seed-back grant is
    // executed-covered in its own describe below) is covered the moment it
    // lands instead of quietly slipping through.
    const assertAllFlagged = (from: number, label: string) => {
      const loots = eventsOf(h.sim, from, 'loot');
      expect(loots.length, `${label}: expected at least one hub loot event`).toBeGreaterThan(0);
      for (const ev of loots) {
        expect(ev.silent, `${label}: ${ev.text}`).toBe(true);
        expect(ev.callerLogs, `${label}: ${ev.text}`).toBe(true);
      }
    };

    plantAndRipen(BED);
    let from = h.sim.events.length;
    harvest(h, BED);
    assertAllFlagged(from, 'survived harvest');

    // And the withered payout, where an unflagged hub line would be worse than
    // duplication: it announces a crop FAILURE in the words of a reward.
    plant(h, BED2);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED2) as PlotState).survivalRoll = 0.99;
    h.meta.gatheringProficiency.farming = 0;
    from = h.sim.events.length;
    harvest(h, BED2);
    assertAllFlagged(from, 'withered harvest');
  });

  it('pays husks, no produce and NO proficiency for a withered plot', () => {
    plantAndRipen();
    // Force the failure by overwriting the hidden roll: at skill 0 the ramp is
    // 0.85, so a 0.99 roll loses.
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0.99;
    // The withered path spends the golden draw too (constant count) and
    // IGNORES its result: husks, never a celebration.
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => harvest(h));
    expect(draws).toBe(1);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(0);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(0);
    expect(eventsOf(h.sim, from, 'farmWithered')).toEqual([
      {
        type: 'farmWithered',
        pid: h.pid,
        bedId: BED,
        cropId: CROP_ID,
        count: FARM_WITHERED_HUSK_COUNT,
      },
    ]);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toEqual([]);
    // A failure teaches nothing: the schedule pays for a harvest.
    expect(h.meta.pendingGatherGrants).toEqual([]);
  });

  it('pays husks when the crop id retired mid-session, with the same one-line flags', () => {
    // The defensive !crop arm: reachable only for an in-memory plot whose
    // catalog row vanished between plant and harvest (the load-side allowlist
    // drops such rows before they can get here). Forced so the arm's grant,
    // event and flags carry EXECUTED coverage rather than source-scan-only
    // (QA-round finding). The roll is forced to survive first: a failed roll
    // would pay from the ORDINARY withered arm and prove nothing about this
    // one.
    plantAndRipen();
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0;
    plot.cropId = 'retired_crop';
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(1);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(0);
    const withered = eventsOf(h.sim, from, 'farmWithered');
    expect(withered).toHaveLength(1);
    expect(withered[0].cropId).toBe('retired_crop');
    expect(withered[0].count).toBe(FARM_WITHERED_HUSK_COUNT);
    const loots = eventsOf(h.sim, from, 'loot');
    expect(loots.length).toBeGreaterThan(0);
    for (const lev of loots) {
      expect(lev.silent, lev.text).toBe(true);
      expect(lev.callerLogs, lev.text).toBe(true);
    }
    // No proficiency: there was nothing to harvest.
    expect(h.meta.pendingGatherGrants).toEqual([]);
  });

  it('lets a farmer who out-levelled the crop harvest a would-be failure', () => {
    plantAndRipen();
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0.99;
    // A full band above the tier-1 gate: survival is 1, so the same roll wins.
    h.meta.gatheringProficiency.farming = 25;
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
    expect(eventsOf(h.sim, from, 'farmWithered')).toEqual([]);
  });

  it('refuses a dead farmer, an unknown bed, out of range, no plot and not ready', () => {
    // Each arm on its own harness state, each counted individually: a shared
    // arm would let one deny mask another.
    plantAndRipen(BED);

    h.sim.player.dead = true;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    h.sim.player.dead = false;

    let from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h, 'bed_not_a_real_bed'))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bad_bed');

    h.sim.player.pos.x += 50;
    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('range');
    standAtBed(h.sim, BED);

    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h, BED2))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_plot');

    // The plot is still there through all four refusals, and still harvests.
    from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
  });

  it('refuses a plot that has not finished growing, one ms before the deadline', () => {
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs - 1);
    let from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('not_ready');
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    // And lands EXACTLY at the deadline, the boundary the projection promises.
    h.advance(1);
    from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
  });

  it('has no busy gate: a harvest lands mid-cast', () => {
    // Deliberate: harvesting is instant and is the SECOND of the two visits a
    // crop cycle ever gets, so a running cast must not turn it into a third.
    plantAndRipen();
    plant(h, BED2); // starts a fresh plant cast
    expect(h.sim.player.castingAbility).toBe(FARMING_CAST_ID);
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
  });

  it('answers range before no_plot when both gates would refuse (order proof)', () => {
    // Harvest's one precedence arm, the twin of plantCrop's bed_taken-vs-
    // no_seed proof: standing far from an empty bed co-arms the range gate and
    // the plot gate, and the earlier one must own the reason.
    h.sim.player.pos.x += 500;
    h.sim.player.pos.z += 500;
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('range');
    expect(h.meta.farmPlots.has(BED)).toBe(false);
  });

  it('keeps stealth, the seat and the mount: harvesting is deliberately light', () => {
    // Unlike plantCrop, whose deliberate-action trio breaks stealth, stands
    // the farmer up and dismounts (a cast is a deliberate act), the harvest
    // performs NO state-breaking side effects, and the omission is a decision,
    // not an oversight (state.md deviation (v), the QA round): the harvest is
    // the instant second visit of the two a cycle ever gets, and forcing a
    // per-bed dismount or reveal would tax exactly the walk-the-row pattern
    // the anti-chore thesis protects. Personal plots are uncontested, so
    // neither stealth nor the mount buys anything against another player.
    plantAndRipen();
    const p = h.sim.player;
    p.sitting = true;
    p.mountKey = DEFAULT_MOUNT;
    p.auras.push({
      id: 'stealth',
      name: 'Stealth',
      kind: 'stealth',
      remaining: 600,
      duration: 600,
      value: 0,
      sourceId: p.id,
      school: 'physical',
    });
    p.stealthed = true;
    const from = h.sim.events.length;
    harvest(h);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toHaveLength(1);
    expect(p.stealthed).toBe(true);
    expect(p.auras.some((a) => a.kind === 'stealth')).toBe(true);
    expect(p.mountKey).toBe(DEFAULT_MOUNT);
    expect(p.sitting).toBe(true);
  });
});

describe('the seed-back roll (tier 3/4): the FIRST of the two harvest draws, banded payouts', () => {
  // A tier 3/4 harvest spends EXACTLY two contiguous ctx.rng draws at a
  // FIXED position (after the outcome-resolution gates, before the
  // survived/withered branch and every loop), on BOTH outcomes: the
  // seed-back roll, then the golden-harvest roll (whose own describe sits
  // below; here every recorded second draw is a probed LOSER, so the
  // payouts stay unmultiplied). They are REAL draws at player-action time,
  // NOT seed expansions: the tonic is seed-anchored because its outcome is
  // fixed at plant time; seed-back is decided by the harvest itself, which
  // is D4-legal because a harvest is a player action.
  //
  // PROBED SEEDS, the vacuity rule: the seed-back roll is the THIRD
  // post-construction draw on these harnesses (two plant draws, then the
  // harvest's first) and the golden roll the FOURTH, so each band arm names
  // the harness seed whose third draw was probed into its band, and asserts
  // the captured values IN-ARM against the shipped thresholds. Probed
  // against the real modules (third and fourth draws after
  // new Sim({ seed, playerClass: 'warrior', autoEquip: false })):
  //   seed 4  -> 0.026266 (tier-3 two-seed band, under 0.08); d4 0.677277
  //   seed 3  -> 0.180549 (tier-3 one-seed band, in [0.08, 0.40)); d4
  //              0.367070
  //   seed 5  -> 0.712293 (tier-3 zero band, at or above 0.40); d4 0.666813
  //   seed 41 -> 0.067811 (tier-4 ONE-seed band, in [0.06, 0.35); the same
  //              roll sits under tier 3's 0.08, which is what makes it the
  //              per-tier-thresholds proof); d4 0.403966
  //   seed 8  -> 0.202110 (a withered-arm WINNER: pays 1 seed); d4 0.306523
  // Every d4 above sits at or above the 1/90 golden chance: all five arms
  // record a golden LOSS in values[1], asserted in-arm.
  const T3_CROP = 'highland_barley';
  const T3_SEED = 'highland_barley_seed';
  const T3_HOE = 'skysilver_hoe';
  const T4_CROP = 'gilded_sunmelon';
  const T4_SEED = 'gilded_sunmelon_seed';
  const T4_HOE = 'osmium_hoe';

  /** Grant the hoe, the proficiency and one seed, plant, and ripen. */
  function plantTier(
    h: Harness,
    cropId: string,
    hoeId: string,
    proficiency: number,
    bedId = BED,
  ): PlotState {
    const crop = FARM_CROPS[cropId] as FarmCropDef;
    h.meta.gatheringProficiency.farming = proficiency;
    h.sim.addItem(hoeId, 1, h.pid);
    h.sim.addItem(crop.seedItemId, 1, h.pid);
    plantCrop(h.sim.ctx, h.sim.player, h.meta, bedId, cropId);
    clearCast(h.sim);
    h.advance(crop.durationMs);
    return h.meta.farmPlots.get(bedId) as PlotState;
  }

  /** Every hub loot event in the window carries both #2430 flags: executed
   *  coverage for the seed-back grant site beside the produce grants. */
  function assertAllLootFlagged(h: Harness, from: number): void {
    const loots = eventsOf(h.sim, from, 'loot');
    expect(loots.length).toBeGreaterThan(0);
    for (const lev of loots) {
      expect(lev.silent, lev.text).toBe(true);
      expect(lev.callerLogs, lev.text).toBe(true);
    }
  }

  it('EVERY crop in the catalog draws by TIER, so a new crop cannot change the contract', () => {
    // The draw contract is stated per TIER, but every counted arm in this file
    // proves it on ONE crop per tier. That was sufficient while a tier had two
    // crops and both were shipped together; Phase 11e added four more, and a
    // representative sample stops being a proof the moment the catalog can
    // grow. This sweep walks all twelve, so a thirteenth crop authored with a
    // different draw shape reds here rather than passing on a sibling's arm.
    for (const crop of Object.values(FARM_CROPS)) {
      const h = makeHarness(41);
      // The hoe rung matches the crop tier exactly (the step-12 wield gate
      // refuses a hoe below the crop's tier), so the map is per tier rather
      // than a single grant.
      const HOE_BY_TIER: Record<number, string> = {
        1: HOE_ID,
        2: 'bronze_hoe',
        3: T3_HOE,
        4: T4_HOE,
      };
      const hoe = HOE_BY_TIER[crop.tier];
      // Enough proficiency for both the crop's band gate and the hoe's R22
      // wield threshold, whichever is higher.
      const plot = plantTier(h, crop.id, hoe, 100);
      expect(plot, `${crop.id} must plant`).toBeDefined();
      plot.survivalRoll = 0;
      const expected = crop.tier >= FARM_SEED_BACK_MIN_TIER ? 2 : 1;
      expect(
        countDraws(h.sim, () => harvest(h)),
        `${crop.id} (tier ${crop.tier}) must draw exactly ${expected}`,
      ).toBe(expected);
    }
    // Non-vacuity: the sweep really covered both sides of the tier boundary.
    const tiers = new Set(Object.values(FARM_CROPS).map((c) => c.tier));
    expect([...tiers].sort()).toEqual([1, 2, 3, 4]);
  });

  it('pins the seed-back tuning to its literals (the wire-name-constant rule)', () => {
    // TUNING, PROVISIONAL, FLAGGED FOR THE MAINTAINER (economy-sensitive):
    // one literal pin for the maps every arm below reaches through the
    // import, so a retune is a deliberate edit here too.
    expect(FARM_SEED_BACK_MIN_TIER).toBe(3);
    expect(FARM_SEED_BACK_TWO_CHANCE).toEqual({ 3: 0.08, 4: 0.06 });
    expect(FARM_SEED_BACK_ONE_CHANCE).toEqual({ 3: 0.4, 4: 0.35 });
    // The band shape itself: the two-seed slice sits strictly inside the
    // pays-anything slice, per tier.
    for (const tier of [3, 4]) {
      expect(FARM_SEED_BACK_TWO_CHANCE[tier]).toBeGreaterThan(0);
      expect(FARM_SEED_BACK_TWO_CHANCE[tier]).toBeLessThan(FARM_SEED_BACK_ONE_CHANCE[tier]);
      expect(FARM_SEED_BACK_ONE_CHANCE[tier]).toBeLessThan(1);
    }
  });

  it('a survived tier-3 harvest draws EXACTLY two, and the two-seed band pays 2 (probed seed 4)', () => {
    const h = makeHarness(4);
    const plot = plantTier(h, T3_CROP, T3_HOE, 75);
    plot.survivalRoll = 0; // survival forced: this arm is about the roll
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(0); // the plant spent it
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 75);
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(2);
    // The in-arm band claim (the probe, re-proven where it counts): a draw
    // block shift that re-seats the stream reds HERE, loudly.
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    // The golden roll rides second on every tier 3/4 harvest, a probed
    // LOSER here (the describe banner's d4 list), so the payout above is
    // exactly the seed-back band's own.
    expect(values[1]).toBeGreaterThanOrEqual(GATHER_RARE_EVENT_CHANCE);
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(2);
    const ev = eventsOf(h.sim, from, 'farmHarvested')[0];
    expect(ev.seedBackCount).toBe(2);
    // The ordinary payout still rides beside the seed-back, untouched.
    expect(ev.cropId).toBe(T3_CROP);
    expect(h.sim.countItem('highland_barley', h.pid)).toBe(expected.count);
    expect(h.sim.countItem('fine_highland_barley', h.pid)).toBe(expected.fine);
    assertAllLootFlagged(h, from);
  });

  it('the one-seed band pays 1 (probed seed 3)', () => {
    const h = makeHarness(3);
    const plot = plantTier(h, T3_CROP, T3_HOE, 75);
    plot.survivalRoll = 0;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(2);
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_ONE_CHANCE[3] as number);
    // The golden roll rides second on every tier 3/4 harvest, a probed
    // LOSER here (the describe banner's d4 list), so the payout above is
    // exactly the seed-back band's own.
    expect(values[1]).toBeGreaterThanOrEqual(GATHER_RARE_EVENT_CHANCE);
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(1);
    expect(eventsOf(h.sim, from, 'farmHarvested')[0].seedBackCount).toBe(1);
    assertAllLootFlagged(h, from);
  });

  it('the zero band still draws, pays nothing, and OMITS the field (probed seed 5)', () => {
    // The omit-zero pin: a zero roll leaves the event byte-identical to the
    // pre-field wire (the only-when-true doctrine), and the bag agrees. The
    // draw still happens, which is the whole fixed-position contract: the
    // stream moves by exactly two per tier 3/4 harvest, win or lose.
    const h = makeHarness(5);
    const plot = plantTier(h, T3_CROP, T3_HOE, 75);
    plot.survivalRoll = 0;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(2);
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_ONE_CHANCE[3] as number);
    // The golden roll rides second on every tier 3/4 harvest, a probed
    // LOSER here (the describe banner's d4 list), so the payout above is
    // exactly the seed-back band's own.
    expect(values[1]).toBeGreaterThanOrEqual(GATHER_RARE_EVENT_CHANCE);
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(0);
    const ev = eventsOf(h.sim, from, 'farmHarvested')[0];
    expect('seedBackCount' in ev).toBe(false);
  });

  it('a tier-4 harvest draws its two and pays by ITS OWN thresholds (probed seed 41)', () => {
    // The per-tier proof: this roll (0.067811) sits UNDER tier 3's two-seed
    // threshold but inside tier 4's one-seed band, so a flat-rate regression
    // that ignored the crop tier would pay 2 here and red on the bag.
    const h = makeHarness(41);
    const plot = plantTier(h, T4_CROP, T4_HOE, 85);
    plot.survivalRoll = 0;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(2);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_TWO_CHANCE[4] as number);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_ONE_CHANCE[4] as number);
    // The golden roll rides second on every tier 3/4 harvest, a probed
    // LOSER here (the describe banner's d4 list), so the payout above is
    // exactly the seed-back band's own.
    expect(values[1]).toBeGreaterThanOrEqual(GATHER_RARE_EVENT_CHANCE);
    expect(h.sim.countItem(T4_SEED, h.pid)).toBe(1);
    expect(eventsOf(h.sim, from, 'farmHarvested')[0].seedBackCount).toBe(1);
    assertAllLootFlagged(h, from);
  });

  it('a WITHERED tier-3 harvest draws its two and can pay seed-back beside the husks (probed seed 8)', () => {
    // The withered consolation roll is deliberate (both outcomes share the
    // pre-branch draw block), so a failed high-tier crop can hand a seed
    // back WITH its husks; the golden roll rides second and is IGNORED on
    // this branch (husks, never a celebration). Proficiency 70: the skysilver hoe wields exactly at
    // its R22 requirement, and the tier-3 survival ramp reads 0.97 there, so
    // the 0.99 roll below genuinely withers without any skill fiddling.
    const h = makeHarness(8);
    const plot = plantTier(h, T3_CROP, T3_HOE, 70);
    plot.survivalRoll = 0.99;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(2);
    // The probed winner claim, in-arm: this roll pays exactly one seed.
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_ONE_CHANCE[3] as number);
    // The golden roll rides second on every tier 3/4 harvest, a probed
    // LOSER here (the describe banner's d4 list), so the payout above is
    // exactly the seed-back band's own.
    expect(values[1]).toBeGreaterThanOrEqual(GATHER_RARE_EVENT_CHANCE);

    // Husks still paid, produce still absent, and the seed beside them.
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
    expect(h.sim.countItem('highland_barley', h.pid)).toBe(0);
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(1);
    const withered = eventsOf(h.sim, from, 'farmWithered');
    expect(withered).toHaveLength(1);
    expect(withered[0].count).toBe(FARM_WITHERED_HUSK_COUNT);
    expect(withered[0].seedBackCount).toBe(1);
    expect(eventsOf(h.sim, from, 'farmHarvested')).toEqual([]);
    // A failure still teaches nothing: the consolation is seeds, not skill.
    expect(h.meta.pendingGatherGrants).toEqual([]);
    assertAllLootFlagged(h, from);
  });

  it('the crossed contract, survived: cache armed AND tonic stored, the tier-3 harvest still draws EXACTLY two', () => {
    // The banner's crossing claim pinned where the axes meet: the tool-effect
    // arms above run tier 1 only, and the band arms above run effect-free, so
    // until this arm no test ever executed a tier 3/4 harvest with an armed
    // slot or a stored tonic. The likeliest future draw regression is one
    // appearing in the effect or tonic arm, which would land HERE.
    const h = makeHarness(4); // the probed two-seed band seed above
    const plot = plantTier(h, T3_CROP, T3_HOE, 75);
    plot.survivalRoll = 0;
    plot.tonic = true;
    // Both axes proven live on this plot (the vacuity rule): sweep a
    // yieldSeed whose expansion WINS the tonic roll, then the flat cache
    // bonus moves it further.
    let winner = -1;
    for (let seed = 0; seed < 10_000; seed++) {
      if (resolveFarmHarvest(seed, 75, true).count > resolveFarmHarvest(seed, 75).count) {
        winner = seed;
        break;
      }
    }
    expect(winner).toBeGreaterThanOrEqual(0);
    plot.yieldSeed = winner;
    const slot = slotEffect('gatherers_cache');
    h.meta.toolEffectSlots = { farming: slot };
    const unarmed = resolveFarmHarvest(winner, 75);
    const armed = resolveFarmHarvest(winner, 75, true, {
      bonusPicks: TOOL_EFFECTS.gatherers_cache.bonus,
    });
    expect(armed.count).toBeGreaterThan(unarmed.count); // in-arm non-vacuity
    const before = slot.durability;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(2); // the seed-back roll, then the golden roll
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    // The golden roll rides second on every tier 3/4 harvest, a probed
    // LOSER here (the describe banner's d4 list), so the payout above is
    // exactly the seed-back band's own.
    expect(values[1]).toBeGreaterThanOrEqual(GATHER_RARE_EVENT_CHANCE);

    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(2);
    // The armed-and-toniced expansion is what the bags received, and the
    // charge settle still spent its one: the crossing changed the payout,
    // never the draw count.
    expect(h.sim.countItem('highland_barley', h.pid)).toBe(armed.count);
    expect(slot.durability).toBe(before - 1);
  });

  it('the crossed contract, withered: the two draws stand and the charge is KEPT (effects act on survived only)', () => {
    const h = makeHarness(8); // the probed withered one-seed winner above
    const plot = plantTier(h, T3_CROP, T3_HOE, 70);
    plot.survivalRoll = 0.99;
    plot.tonic = true;
    const slot = slotEffect('gatherers_cache');
    h.meta.toolEffectSlots = { farming: slot };
    h.sim.addItem('osmium_hoe', 1, h.pid);
    const before = slot.durability;
    const beforeCeil = slot.maxDurability;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(2);
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
    // The withered return sits ABOVE the effect block, so an armed slot on a
    // failed crop neither spends nor latches: no charge for no bonus.
    expect(slot.durability).toBe(before);
    expect(slot.maxDurability).toBe(beforeCeil);
  });

  it('run-twice determinism: two same-seed worlds agree on the whole tier-3 harvest, seed-back included', () => {
    // The changed draw path's own run-twice equality (the two-Sim arm below
    // in the hosts describe plants tier 1 only): a wall-clock or Math.random
    // leak anywhere in the plant-ripen-harvest-seedback chain forks this.
    const run = () => {
      const h = makeHarness(9);
      const plot = plantTier(h, T3_CROP, T3_HOE, 75);
      plot.survivalRoll = 0;
      const from = h.sim.events.length;
      harvest(h);
      return {
        seeds: h.sim.countItem(T3_SEED, h.pid),
        produce: h.sim.countItem('highland_barley', h.pid),
        fine: h.sim.countItem('fine_highland_barley', h.pid),
        events: JSON.parse(
          JSON.stringify(h.sim.events.slice(from).filter((e) => e.type.startsWith('farm'))),
        ),
      };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // Non-vacuity: the compared payload is real work, not two empty lists.
    expect(a.events.length).toBeGreaterThan(0);
    expect(a.produce).toBeGreaterThan(0);
  });

  it('every harvest deny path still draws ZERO with a tier-3 plot in the ground', () => {
    // The roll sits AFTER the outcome-resolution gates, so a refused harvest
    // of a high-tier plot moves the stream exactly as far as a refused
    // tier-1 one: not at all.
    const h = makeHarness(4);
    const crop = FARM_CROPS[T3_CROP] as FarmCropDef;
    h.meta.gatheringProficiency.farming = 75;
    h.sim.addItem(T3_HOE, 1, h.pid);
    h.sim.addItem(T3_SEED, 1, h.pid);
    plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, T3_CROP);
    clearCast(h.sim);

    // not_ready, one ms short of the deadline.
    h.advance(crop.durationMs - 1);
    let from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('not_ready');
    h.advance(1);

    h.sim.player.dead = true;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    h.sim.player.dead = false;

    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h, 'bed_not_a_real_bed'))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bad_bed');

    h.sim.player.pos.x += 50;
    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('range');
    standAtBed(h.sim, BED);

    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h, BED2))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_plot');

    // Anti-vacuous close: the plot survived all five refusals, and the REAL
    // harvest then spends exactly its two draws.
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    expect(countDraws(h.sim, () => harvest(h))).toBe(2);
  });

  it('a tier-2 harvest draws only the golden roll: the negative arm of the tier condition', () => {
    // Same harness shape as the banded arms above, one tier down, so the
    // single draw here (the unconditional golden roll, no seed-back) is
    // about the TIER and nothing else (the non-vacuous negative arm the
    // tier-1 describe cannot supply on its own).
    const h = makeHarness(4);
    const plot = plantTier(h, 'marsh_rice', 'bronze_hoe', 40);
    plot.survivalRoll = 0;
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 40);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(1);
    expect(h.sim.countItem('marsh_rice_seed', h.pid)).toBe(0);
    const ev = eventsOf(h.sim, from, 'farmHarvested')[0];
    expect('seedBackCount' in ev).toBe(false);
    // The harvest itself still paid normally.
    expect(h.sim.countItem('marsh_rice', h.pid)).toBe(expected.count);
    expect(h.sim.countItem('fine_marsh_rice', h.pid)).toBe(expected.fine);
  });
});

describe('the golden_harvest roll: the shared rare event at the farm bed', () => {
  // Farming's arm of the shared gather rare event (gather_events.ts): the
  // golden roll spends its draw on EVERY resolving harvest (the clause block
  // at the bottom of this file pins the counts) and PAYS only on the
  // survived branch: a five-fold SIGNED yield, the zone fanout event, and
  // the gather_event:golden_harvest visit mark. Probed-seed rule throughout:
  // the GOLDEN_WIN_SEED banner at the top of the file records the probe, and
  // each arm re-asserts its band IN-ARM so a draw-block shift reds loudly.

  it('pins the shared tuning to its literals (the wire-name-constant rule)', () => {
    // The roll reaches BOTH constants through the shared gather_events
    // import, never a farming copy (D12); pinned as literals so a retune is
    // a deliberate edit here too.
    expect(GATHER_RARE_EVENT_CHANCE).toBe(1 / 90);
    expect(GATHER_RARE_EVENT_YIELD_MULT).toBe(5);
  });

  it('a losing roll leaves the harvest as before: unmultiplied, unsigned, no event, no mark', () => {
    // The default harness seed LOSES (third post-construction draw
    // 0.067811, the GOLDEN_WIN_SEED banner), so this arm is the negative
    // control every win arm below is read against.
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0;
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 0);
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    // The in-arm band claim: the recorded roll really lost.
    expect(values[0]).toBeGreaterThanOrEqual(GATHER_RARE_EVENT_CHANCE);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(expected.count);
    expect(eventsOf(h.sim, from, 'gatherRareEvent')).toEqual([]);
    expect(h.meta.deedStats.visited.has('gather_event:golden_harvest')).toBe(false);
    // Unsigned: plain fungible stacks, no instance payload anywhere.
    expect(h.meta.inventory.some((s) => s.itemId === PRODUCE_ID && s.instance)).toBe(false);
  });

  it('the probed winner: five-fold yield in BOTH grades, signed, announced, marked (seed 280)', () => {
    const h = makeHarness(GOLDEN_WIN_SEED);
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0;
    // The unarmed same-seed expectation, computed from the REAL minted
    // yieldSeed (the banner's probed 3704758211: { count: 3, fine: 1 }).
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 0);
    // In-arm non-vacuity (the Phase 4 QA vacuity class): both grades are
    // nonzero, so BOTH multiplications below are real, and the armed payout
    // genuinely DIFFERS from the unarmed one, so a draw-block shift that
    // stops this seed winning reds here instead of re-vacuating.
    expect(expected.count).toBeGreaterThan(0);
    expect(expected.fine).toBeGreaterThan(0);
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE); // the probed win, in-arm
    // Five-fold, EXACTLY, in both grades, and MORE than the unarmed base
    // (the non-vacuity direction stated as the bags see it: a golden payout
    // must differ from the base payout).
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(expected.count * GATHER_RARE_EVENT_YIELD_MULT);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(expected.fine * GATHER_RARE_EVENT_YIELD_MULT);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBeGreaterThan(expected.count);
    // Signed: the windfall lands as { signer } instances in both grades
    // (identical-payload stacking merges them into one signed stack each).
    expect(h.meta.name.length).toBeGreaterThan(0);
    for (const itemId of [PRODUCE_ID, FINE_ID]) {
      const slots = h.meta.inventory.filter((s) => s.itemId === itemId);
      expect(slots.length, itemId).toBeGreaterThan(0);
      for (const slot of slots) expect(slot.instance?.signer, itemId).toBe(h.meta.name);
    }
    // The zone fanout event, whole payload shape: the crop source, the
    // AUTHORED bed zone (bed_eastbrook_1's patch), the base produce id, and
    // the finder identity; the finder is part of their own fanout.
    const rare = eventsOf(h.sim, from, 'gatherRareEvent');
    expect(rare.length).toBeGreaterThan(0);
    for (const ev of rare) {
      expect(ev.flavor).toBe('golden_harvest');
      expect(ev.nodeType).toBe('crop');
      expect(ev.zoneId).toBe('eastbrook_vale');
      expect(ev.itemId).toBe(PRODUCE_ID);
      expect(ev.finderPid).toBe(h.pid);
      expect(ev.finderName).toBe(h.meta.name);
    }
    expect(rare.some((ev) => ev.pid === h.pid)).toBe(true);
    // The farmHarvested event carries the multiplied counts (a mixed
    // harvest: both grades present, so the fine pair rides).
    const harvested = eventsOf(h.sim, from, 'farmHarvested')[0];
    expect(harvested.count).toBe(expected.count * GATHER_RARE_EVENT_YIELD_MULT);
    expect(harvested.fineCount).toBe(expected.fine * GATHER_RARE_EVENT_YIELD_MULT);
    // The visit mark lands; the Reliquary deliberately has NO golden cell
    // (noteReliquaryMark no-ops unknown ids: the ledgered field-note
    // deferral, asserted as the negative so it retires consciously).
    expect(h.meta.deedStats.visited.has('gather_event:golden_harvest')).toBe(true);
    expect(h.meta.reliquary.marks.has('gather_event:golden_harvest')).toBe(false);
    // Every hub grant kept both #2430 flags (the signed grant sites too).
    const loots = eventsOf(h.sim, from, 'loot');
    expect(loots.length).toBeGreaterThan(0);
    for (const lev of loots) {
      expect(lev.silent, lev.text).toBe(true);
      expect(lev.callerLogs, lev.text).toBe(true);
    }
  });

  it('a golden ALL-FINE harvest announces the fine item, the collapse rule (probed seed)', () => {
    // The zone line must name something the finder actually received: on the
    // all-fine collapse the primary grant IS the fine item, the same rule
    // the farmHarvested emit applies. yieldSeed 404006 was PROBED at skill 0
    // (count 0, fine 3, all three picks upgrade); the overwrite below rides
    // the scenario's tonic-winner precedent (a stored seed is state, not a
    // draw). The golden win still comes from the LIVE stream (seed 280's
    // probed third draw), which the yieldSeed overwrite cannot move.
    const ALL_FINE_YIELD_SEED = 404006;
    const probe = resolveFarmHarvest(ALL_FINE_YIELD_SEED, 0);
    expect(probe.count).toBe(0);
    expect(probe.fine).toBeGreaterThan(0);
    const h = makeHarness(GOLDEN_WIN_SEED);
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0;
    plot.yieldSeed = ALL_FINE_YIELD_SEED;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE); // still the probed win
    // The bags saw ONLY fine produce, five-folded.
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(0);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(probe.fine * GATHER_RARE_EVENT_YIELD_MULT);
    // Both events name the fine item: the zone line and the harvest event
    // agree on the one rule (itemId is always something the player received).
    const rare = eventsOf(h.sim, from, 'gatherRareEvent');
    expect(rare.length).toBeGreaterThan(0);
    for (const ev of rare) expect(ev.itemId).toBe(FINE_ID);
    const harvested = eventsOf(h.sim, from, 'farmHarvested')[0];
    expect(harvested.itemId).toBe(FINE_ID);
    expect(harvested.count).toBe(probe.fine * GATHER_RARE_EVENT_YIELD_MULT);
    expect('fineItemId' in harvested).toBe(false);
  });

  it('a WITHERED winner is IGNORED: the draw happens, no announce, no multiplier (seed 280)', () => {
    // The same probed winner seed with the survival roll forced to lose: the
    // golden draw still spends (the constant per-action count) and the win
    // is discarded on the withered branch (husks, never a celebration).
    const h = makeHarness(GOLDEN_WIN_SEED);
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.99;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE); // it really WON
    expect(eventsOf(h.sim, from, 'gatherRareEvent')).toEqual([]);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(0);
    expect(h.meta.deedStats.visited.has('gather_event:golden_harvest')).toBe(false);
  });

  it('every harvest deny path draws ZERO even on a winner stream', () => {
    // The golden roll sits after the outcome-resolution gates, so a refusal
    // can never spend (or leak) the pending win.
    const h = makeHarness(GOLDEN_WIN_SEED);
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs - 1);
    let from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('not_ready');
    h.advance(1);

    h.sim.player.dead = true;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    h.sim.player.dead = false;

    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h, 'bed_not_a_real_bed'))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('bad_bed');

    h.sim.player.pos.x += 50;
    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('range');
    standAtBed(h.sim, BED);

    from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h, BED2))).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_plot');

    // Anti-vacuous close: the refusals spent nothing, so the roll the real
    // harvest now spends is STILL the probed winner.
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE);
    expect(eventsOf(h.sim, from, 'gatherRareEvent').length).toBeGreaterThan(0);
  });

  it('run-twice determinism: two same-seed worlds agree on the whole golden harvest', () => {
    const run = () => {
      const h = makeHarness(GOLDEN_WIN_SEED);
      giveSeeds(h);
      plant(h);
      clearCast(h.sim);
      h.advance(CROP.durationMs);
      (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
      const from = h.sim.events.length;
      harvest(h);
      return {
        produce: h.sim.countItem(PRODUCE_ID, h.pid),
        fine: h.sim.countItem(FINE_ID, h.pid),
        signed: h.meta.inventory
          .filter((s) => s.itemId === PRODUCE_ID || s.itemId === FINE_ID)
          .map((s) => ({ itemId: s.itemId, count: s.count, signer: s.instance?.signer })),
        events: JSON.parse(
          JSON.stringify(
            h.sim.events
              .slice(from)
              .filter((e) => e.type.startsWith('farm') || e.type === 'gatherRareEvent'),
          ),
        ),
      };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    // Non-vacuity: the compared session really was a golden one.
    expect(a.events.some((e: { type: string }) => e.type === 'gatherRareEvent')).toBe(true);
    expect(a.produce).toBeGreaterThan(0);
  });

  /** The shared probed-winner rig for the bag-path arms below: plant on the
   *  winner stream, ripen, force survival, and return the unarmed
   *  expectation, asserting the Phase 4 non-vacuity pair in-rig. */
  function ripenWinner(h: Harness): { count: number; fine: number } {
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0;
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 0);
    expect(expected.count).toBeGreaterThan(0);
    expect(expected.fine).toBeGreaterThan(0);
    return expected;
  }

  function signedCountOf(h: Harness, itemId: string): number {
    return h.meta.inventory
      .filter((s) => s.itemId === itemId && s.instance?.signer === h.meta.name)
      .reduce((sum, s) => sum + s.count, 0);
  }

  it('a golden win with FULL bags: totals conserved, only the SIGNATURE truncates ((bu))', () => {
    // The merge-room-only split, unreachable on empty bags: a same-signer
    // stack two under its cap and ZERO free slots. countFit must see the
    // signer (drop it and the fit reads 0), the fit must cap the SIGNED
    // grant (pass qty instead and the stack overshoots its room), and the
    // remainder must ride the plain overflow-tolerant grant (zero it and
    // grown produce is destroyed, the rot farming forbids).
    const h = makeHarness(GOLDEN_WIN_SEED);
    const expected = ripenWinner(h);
    const stack = stackSizeOf(ITEMS[PRODUCE_ID]);
    h.sim.ctx.addItemInstance(PRODUCE_ID, { signer: h.meta.name }, h.pid, stack - 2, {
      silent: true,
      callerLogs: true,
    });
    const capacity = bagCapacity(h.meta.bags);
    while (h.meta.inventory.length < capacity) h.sim.addItem(HOE_ID, 1, h.pid);
    expect(h.meta.inventory.length).toBe(capacity);
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE); // the probed win, in-arm
    const count5 = expected.count * GATHER_RARE_EVENT_YIELD_MULT;
    const fine5 = expected.fine * GATHER_RARE_EVENT_YIELD_MULT;
    // NOTHING ROTS: the full five-fold totals landed despite the full bags.
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(stack - 2 + count5);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(fine5);
    // Only the SIGNATURE truncated: exactly the merge room (2) signed on top
    // of the pre-seeded stack, the remainder landed PLAIN.
    expect(signedCountOf(h, PRODUCE_ID)).toBe(stack);
    expect(
      h.meta.inventory
        .filter((s) => s.itemId === PRODUCE_ID && !s.instance)
        .reduce((sum, s) => sum + s.count, 0),
    ).toBe(count5 - 2);
    // The fine grade found no signed room at all: fully plain.
    expect(h.meta.inventory.some((s) => s.itemId === FINE_ID && s.instance)).toBe(false);
    // The overflow is VISIBLE (the 17/16 rule), never silently absorbed.
    expect(h.meta.inventory.length).toBeGreaterThan(capacity);
  });

  it('a golden win into the LAST free slot: the fine grade reads the mutated bags ((bu))', () => {
    // The deliberate second-read the grantGolden comment forbids "cleaning
    // up": the base grade consumes the one free slot, so the fine grade's
    // countFit must see the NOW-FULL bags and land fully plain. A hoisted
    // inventory snapshot would sign the fine grade into the phantom slot.
    const h = makeHarness(GOLDEN_WIN_SEED);
    const expected = ripenWinner(h);
    const capacity = bagCapacity(h.meta.bags);
    while (h.meta.inventory.length < capacity - 1) h.sim.addItem(HOE_ID, 1, h.pid);
    expect(h.meta.inventory.length).toBe(capacity - 1);
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE);
    const count5 = expected.count * GATHER_RARE_EVENT_YIELD_MULT;
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(count5);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(expected.fine * GATHER_RARE_EVENT_YIELD_MULT);
    // The base grade took the one free slot, signed in full...
    expect(signedCountOf(h, PRODUCE_ID)).toBe(count5);
    // ...and the fine grade, reading the mutated bags, landed fully plain.
    expect(h.meta.inventory.some((s) => s.itemId === FINE_ID && s.instance)).toBe(false);
  });

  it('a truncating golden win NAMES its surface: one gatherDowngrade crop/mark ((bu) follow-up)', () => {
    // The Phase 14 widening: the signature truncation is no longer silent.
    // The full-bags construction truncates BOTH grades (the base grade signs
    // only its merge room, the fine grade lands fully plain), yet exactly ONE
    // event fires per harvest command (the gatherDenied dedupe idiom). The
    // client needs no new line: hud.ts's gatherDowngrade case resolves the
    // toast off the lost arm alone (downgradeMark), surface-independent.
    const h = makeHarness(GOLDEN_WIN_SEED);
    ripenWinner(h);
    const stack = stackSizeOf(ITEMS[PRODUCE_ID]);
    h.sim.ctx.addItemInstance(PRODUCE_ID, { signer: h.meta.name }, h.pid, stack - 2, {
      silent: true,
      callerLogs: true,
    });
    const capacity = bagCapacity(h.meta.bags);
    while (h.meta.inventory.length < capacity) h.sim.addItem(HOE_ID, 1, h.pid);
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE); // the probed win, in-arm
    const downgrades = h.sim.events.slice(from).filter((e) => e.type === 'gatherDowngrade');
    expect(downgrades).toEqual([
      { type: 'gatherDowngrade', pid: h.pid, surface: 'crop', lost: 'mark' },
    ]);
    // BOTH grades really truncated in this construction, so the single event
    // above proves the DEDUPE, not a one-grade emitter: the fine grade found
    // no signed room at all, and the base grade signed only its merge room.
    expect(h.meta.inventory.some((s) => s.itemId === FINE_ID && s.instance)).toBe(false);
    expect(signedCountOf(h, PRODUCE_ID)).toBe(stack);
  });

  it('a golden win with bag room emits NO downgrade (the signature landed in full)', () => {
    const h = makeHarness(GOLDEN_WIN_SEED);
    ripenWinner(h);
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE);
    // Positive control that the win really landed signed, so the quiet is
    // the full signature landing and not a missed win.
    expect(signedCountOf(h, PRODUCE_ID)).toBeGreaterThan(0);
    expect(h.sim.events.slice(from).filter((e) => e.type === 'gatherDowngrade')).toHaveLength(0);
  });

  it('the announce lands AFTER the grants (celebrate once the windfall is real)', () => {
    // Pins the deliberate order the code comment states: every grant leg's
    // loot event precedes the first gatherRareEvent copy, and the
    // farmHarvested completion event follows the announce (the node idiom).
    const h = makeHarness(GOLDEN_WIN_SEED);
    ripenWinner(h);
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE);
    const types = h.sim.events.slice(from).map((e) => e.type);
    const lastLoot = types.lastIndexOf('loot');
    const firstRare = types.indexOf('gatherRareEvent');
    const firstHarvested = types.indexOf('farmHarvested');
    expect(lastLoot).toBeGreaterThan(-1);
    expect(firstRare).toBeGreaterThan(lastLoot);
    expect(firstHarvested).toBeGreaterThan(firstRare);
  });

  it('the five-fold multiplies the ARMED expansion, tool-effect bonus included (seed 280)', () => {
    // The crossing arm the empty-handed winner cannot provide: with a
    // quantity effect armed, "armed times five" and "plain times five plus
    // the bonus" are different numbers, so a mutant that multiplies the
    // pre-effect base and re-adds the bonus reds here.
    const h = makeHarness(GOLDEN_WIN_SEED);
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    plot.survivalRoll = 0;
    const slot = slotEffect('gatherers_cache');
    h.meta.toolEffectSlots = { farming: slot };
    const plain = resolveFarmHarvest(plot.yieldSeed as number, 0);
    const armed = resolveFarmHarvest(plot.yieldSeed as number, 0, false, {
      bonusPicks: TOOL_EFFECTS.gatherers_cache.bonus,
    });
    // Non-vacuity: the effect really changes the expansion on this seed, and
    // the two mutant-distinguishing totals really differ.
    expect(armed.count).not.toBe(plain.count);
    expect(armed.count * GATHER_RARE_EVENT_YIELD_MULT).not.toBe(
      plain.count * GATHER_RARE_EVENT_YIELD_MULT + (armed.count - plain.count),
    );
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(armed.count * GATHER_RARE_EVENT_YIELD_MULT);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(armed.fine * GATHER_RARE_EVENT_YIELD_MULT);
  });

  it('the announce zone follows the BED: a win at Thornpeak announces thornpeak_heights', () => {
    // Kills the hardcoded-zone mutant: every other golden arm harvests at
    // the eastbrook bed, so an announce call that froze 'eastbrook_vale'
    // would survive them all. The same probed winner stream applies at any
    // bed (draw positions never depend on WHICH bed hosts the plot), and
    // (br) lets a tier-1 seed plant at any hub.
    const h = makeHarness(GOLDEN_WIN_SEED);
    standAtBed(h.sim, 'bed_thornpeak_1');
    giveSeeds(h);
    plant(h, 'bed_thornpeak_1');
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get('bed_thornpeak_1') as PlotState).survivalRoll = 0;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h, 'bed_thornpeak_1'));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(GATHER_RARE_EVENT_CHANCE);
    const rare = eventsOf(h.sim, from, 'gatherRareEvent');
    expect(rare.length).toBeGreaterThan(0);
    for (const ev of rare) expect(ev.zoneId).toBe('thornpeak_heights');
    expect(h.meta.deedStats.visited.has('farm:thornpeak_heights')).toBe(true);
  });
});

describe('the celebration marks: farm:planted and the farm:<zone> chronicle', () => {
  // Zero-rng, draw-order-neutral marks (the celebrations phase): the
  // first-planting proof at plant success and the per-zone first-harvest
  // chronicle on the survived branch (deeds.ts onCropHarvestedForDeeds).

  it('writes farm:planted at plant SUCCESS and never on a deny', () => {
    // The deny SWEEP (the QA hardening: the old arm swept only no_seed, so
    // the mark migrating above the range or knob gates would have gone
    // unseen): one fresh rig per deny family, each proving the deny fired
    // AND no mark landed. The gates run in order, so each rig trips only
    // its own.
    const denies: { name: string; rig: (d: Harness) => void; reason: string }[] = [
      { name: 'no_seed', rig: () => {}, reason: 'no_seed' },
      {
        name: 'range',
        rig: (d) => {
          giveSeeds(d);
          d.sim.player.pos.x += 50;
        },
        reason: 'range',
      },
      {
        name: 'bad_bed',
        rig: (d) => giveSeeds(d),
        reason: 'bad_bed',
      },
      {
        name: 'no_compost (a knob-payment deny)',
        rig: (d) => giveSeeds(d),
        reason: 'no_compost',
      },
    ];
    for (const deny of denies) {
      const d = makeHarness();
      deny.rig(d);
      const dFrom = d.sim.events.length;
      if (deny.reason === 'bad_bed') {
        plantCrop(d.sim.ctx, d.sim.player, d.meta, 'not_a_bed', CROP_ID);
      } else if (deny.reason === 'no_compost') {
        plantCrop(d.sim.ctx, d.sim.player, d.meta, BED, CROP_ID, { compost: true });
      } else {
        plant(d);
      }
      expect(denyReason(d.sim, dFrom), deny.name).toBe(deny.reason);
      expect(d.meta.deedStats.visited.has('farm:planted'), deny.name).toBe(false);
    }
    // The success writes it (the positive control proving the rig CAN mark).
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    expect(h.meta.deedStats.visited.has('farm:planted')).toBe(true);
    // Idempotent: a second successful plant re-marks without issue (visited
    // is a set; no duplicate entry, no error).
    clearCast(h.sim);
    giveSeeds(h);
    plant(h, BED2);
    expect(h.meta.deedStats.visited.has('farm:planted')).toBe(true);
  });

  it('writes farm:<zone> on a survived harvest at each hub (eastbrook and thornpeak)', () => {
    // Two REAL bed ids in two different chronicle zones, so the zone
    // resolution is proven per bed rather than once by coincidence.
    for (const { bedId, zone } of [
      { bedId: BED, zone: 'eastbrook_vale' },
      { bedId: 'bed_thornpeak_1', zone: 'thornpeak_heights' },
    ]) {
      const h = makeHarness();
      standAtBed(h.sim, bedId);
      giveSeeds(h);
      plantCrop(h.sim.ctx, h.sim.player, h.meta, bedId, CROP_ID);
      clearCast(h.sim);
      h.advance(CROP.durationMs);
      (h.meta.farmPlots.get(bedId) as PlotState).survivalRoll = 0;
      harvestCrop(h.sim.ctx, h.sim.player, h.meta, bedId);
      expect(h.meta.deedStats.visited.has(`farm:${zone}`), zone).toBe(true);
    }
  });

  it('WRITES the per-crop farm_crop mark on a survived harvest, per crop', () => {
    // The roster deed's collection is only reachable if this mark is actually
    // written, and nothing else in the suite proves the WRITER runs: the
    // save/load trap in tests/deeds_content.test.ts hand-adds the marks and
    // proves the load half, and the content pin proves the deed's markIds, so
    // deleting the write would leave both green and the deed permanently
    // unearnable. That is the same failure class the namespace trap exists
    // for, one layer up, which is why this arm drives a real harvest.
    for (const cropId of ['vale_wheat', 'brook_carrot']) {
      const crop = FARM_CROPS[cropId] as FarmCropDef;
      const h = makeHarness();
      h.sim.addItem(crop.seedItemId, 1, h.pid);
      plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, cropId);
      clearCast(h.sim);
      h.advance(crop.durationMs);
      (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
      harvestCrop(h.sim.ctx, h.sim.player, h.meta, BED);
      expect(h.meta.deedStats.visited.has(`farm_crop:${cropId}`), cropId).toBe(true);
      // Scoped to the crop actually grown: harvesting one does not mark the
      // whole roster, which is what makes the collection a collection.
      for (const other of Object.keys(FARM_CROPS)) {
        if (other === cropId) continue;
        expect(h.meta.deedStats.visited.has(`farm_crop:${other}`), other).toBe(false);
      }
    }
  });

  it('never writes a farm_crop mark for a WITHERED harvest', () => {
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.99;
    harvest(h);
    expect(h.meta.deedStats.visited.has(`farm_crop:${CROP_ID}`)).toBe(false);
  });

  it('never chronicles a WITHERED harvest (weeds and boots do not count)', () => {
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0.99;
    harvest(h);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
    expect(h.meta.deedStats.visited.has('farm:eastbrook_vale')).toBe(false);
    // The plant itself still marked: farm:planted is about the planting.
    expect(h.meta.deedStats.visited.has('farm:planted')).toBe(true);
  });

  it('both farm marks survive a save and a load (the registered-namespace proof)', () => {
    // restoreDeedStats DROPS visited marks in unregistered namespaces (the
    // gather_event lesson recorded at VISITED_MARK_NAMESPACES), so this
    // round trip is what proves the 'farm' registration actually landed: an
    // unregistered namespace would serialize fine here and come back empty.
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    harvest(h);
    expect(h.meta.deedStats.visited.has('farm:planted')).toBe(true);
    expect(h.meta.deedStats.visited.has('farm:eastbrook_vale')).toBe(true);
    const saved = h.sim.serializeCharacter(h.pid) as CharacterState;
    const fresh = new Sim({ seed: 41, playerClass: 'warrior', noPlayer: true });
    fresh.addPlayer('warrior', 'Farmer', { state: saved });
    const loaded = [...fresh.players.values()][0] as PlayerMeta;
    expect(loaded.deedStats.visited.has('farm:planted')).toBe(true);
    expect(loaded.deedStats.visited.has('farm:eastbrook_vale')).toBe(true);
  });
});

describe('the celebration deeds end to end (the merged catalog over the live producer)', () => {
  // The cross-slice integration proof: the sim slice writes the marks and
  // the catalog slice reads them, and neither branch alone could exercise
  // the chain plant to harvest to tick tail to deedsEarned. Grants land at
  // the tick tail over dirty players (src/sim/deeds.ts), so each assert
  // follows one tick.

  it('grants prog_first_planting and the vale chronicle from one real cycle', () => {
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    h.sim.tick();
    expect(h.meta.deedsEarned.has('prog_first_planting')).toBe(true);
    expect(h.meta.deedsEarned.has('chr_vale_first_harvest')).toBe(false);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    harvest(h);
    h.sim.tick();
    expect(h.meta.deedsEarned.has('chr_vale_first_harvest')).toBe(true);
  });

  it('grants col_golden_harvest on the probed winner stream and not on a loss', () => {
    // The winner stream reproduces the GOLDEN_WIN_SEED probe exactly (plant
    // draws 1 and 2, the golden roll is draw 3; no ticks in between so the
    // stream position holds). The loss arm is the default seed's recorded
    // losing stream, the non-vacuity twin.
    const win = makeHarness(GOLDEN_WIN_SEED);
    giveSeeds(win);
    plant(win);
    clearCast(win.sim);
    win.advance(CROP.durationMs);
    (win.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    harvest(win);
    win.sim.tick();
    expect(win.meta.deedsEarned.has('col_golden_harvest')).toBe(true);

    const loss = makeHarness();
    giveSeeds(loss);
    plant(loss);
    clearCast(loss.sim);
    loss.advance(CROP.durationMs);
    (loss.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    harvest(loss);
    loss.sim.tick();
    expect(loss.meta.deedsEarned.has('col_golden_harvest')).toBe(false);
  });
});

describe('convertHusks: the husk trade, draw-free on every path', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
    // The trade gates on a farmer NPC in reach (the go-live), so the arms
    // about the trade itself stand beside the tier-1 farmer; the range gate
    // has its own describe below.
    standByNpc(h.sim);
  });

  function convert(): void {
    convertHusks(h.sim.ctx, h.sim.player, h.meta);
  }

  it('pins the trade ratio to its literal', () => {
    // The ratio is the trade's whole tuning surface and every arm below
    // reaches it through the import, which is a self-comparison (the
    // wire-name-constant rule). One literal pin, here: 2 husks per compost,
    // so ONE failed crop (FARM_WITHERED_HUSK_COUNT husks) converts into
    // exactly ONE compost.
    expect(FARM_HUSKS_PER_COMPOST).toBe(2);
    expect(FARM_HUSKS_PER_COMPOST).toBe(FARM_WITHERED_HUSK_COUNT);
    // The two item ids the trade moves, pinned to their literals once (the
    // wire-name-constant rule): every count above reads the same constants
    // the trade grants through, so without these two lines a retargeted
    // FARM_COMPOST_ITEM_ID would still "convert" green while the farmer
    // counters keep selling the 'compost' row (Phase 9 QA).
    expect(FARM_COMPOST_ITEM_ID).toBe('compost');
    expect(FARM_WITHERED_HUSK_ITEM_ID).toBe('withered_husks');
  });

  it('converts EVERY complete batch in one call and leaves the remainder', () => {
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, 2 * FARM_HUSKS_PER_COMPOST + 1, h.pid);
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => convert());
    expect(draws).toBe(0);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(2);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(1);
    expect(eventsOf(h.sim, from, 'farmHusksConverted')).toEqual([
      {
        type: 'farmHusksConverted',
        pid: h.pid,
        husks: 2 * FARM_HUSKS_PER_COMPOST,
        compost: 2,
      },
    ]);
    expect(eventsOf(h.sim, from, 'farmDenied')).toEqual([]);
  });

  it('flags the compost grant silent + callerLogs, so one trade prints one line', () => {
    // The #2430 one-line rule, the farmHarvested precedent: the
    // farmHusksConverted event owns both halves of the feedback, so the hub
    // "You receive:" line and the generic ding stand down.
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    const from = h.sim.events.length;
    convert();
    const loots = eventsOf(h.sim, from, 'loot');
    expect(loots.length).toBeGreaterThan(0);
    for (const lev of loots) {
      expect(lev.silent, lev.text).toBe(true);
      expect(lev.callerLogs, lev.text).toBe(true);
    }
  });

  it('refuses below one batch: nothing moves, zero draws, farmDenied no_husks', () => {
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST - 1, h.pid);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => convert())).toBe(0);
    // The refusal names no bed and no crop: the trade has neither.
    expect(eventsOf(h.sim, from, 'farmDenied')).toEqual([
      { type: 'farmDenied', pid: h.pid, reason: 'no_husks' },
    ]);
    expect(eventsOf(h.sim, from, 'farmHusksConverted')).toEqual([]);
    // NOTHING was consumed on the refusal, remainder included.
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_HUSKS_PER_COMPOST - 1);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(0);
  });

  it('refuses a dead farmer without touching the bags', () => {
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    h.sim.player.dead = true;
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => convert())).toBe(0);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_HUSKS_PER_COMPOST);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(0);
    expect(eventsOf(h.sim, from, 'farmHusksConverted')).toEqual([]);
    // Anti-vacuous: alive again, the same bags convert.
    h.sim.player.dead = false;
    convert();
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
  });

  it('needs no bed and no cast: beside the farmer, mid-cast, the trade lands', () => {
    // The go-live kept the no-busy-gate rationale: standing beside the farmer
    // (nowhere near a bed's working reach), mid-cast, the trade still lands.
    // The bed-free half of the old permissive arm; the LOCATION half flipped
    // into the range describe below.
    giveSeeds(h);
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    h.sim.player.castingAbility = FARMING_CAST_ID;
    h.sim.player.castRemaining = 1;
    for (const bedId of FARM_BED_IDS) {
      const bed = farmBedById(bedId);
      if (!bed) throw new Error(bedId);
      expect(Math.hypot(h.sim.player.pos.x - bed.x, h.sim.player.pos.z - bed.z)).toBeGreaterThan(
        INTERACT_RANGE,
      );
    }
    convert();
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
  });
});

describe('convertHusks: the farmer-NPC range gate (the go-live)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
  });

  function convert(): void {
    convertHusks(h.sim.ctx, h.sim.player, h.meta);
  }

  it('pins the trade reach to its literal: 7, the buyItem and banker reach', () => {
    // The wire-name-constant rule: one literal pin, then the relation to the
    // reach it copies (INTERACT_RANGE + 2 is what buyItem and nearBanker use).
    expect(FARMER_TRADE_RANGE).toBe(7);
    expect(FARMER_TRADE_RANGE).toBe(INTERACT_RANGE + 2);
  });

  it('beside farmer_jessica with a batch of husks: compost granted, husks spent, one event', () => {
    standByNpc(h.sim);
    expect(nearFarmerNpc(h.sim.ctx, h.sim.player)).toBe(true);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => convert())).toBe(0);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(0);
    expect(eventsOf(h.sim, from, 'farmHusksConverted')).toEqual([
      { type: 'farmHusksConverted', pid: h.pid, husks: FARM_HUSKS_PER_COMPOST, compost: 1 },
    ]);
    expect(eventsOf(h.sim, from, 'farmDenied')).toEqual([]);
  });

  it('20 yd from every farmer: farmDenied no_farmer, nothing spent, no compost, zero draws', () => {
    // Nowhere near a farmer, at the harness bed (the tier-1 patch is BESIDE
    // the farmer, not on top of her: the bed a player works is not the
    // counter). Then further still, so the claim is about every farmer.
    h.sim.player.pos.x += 500;
    h.sim.player.pos.z += 500;
    const farmers = farmerEntities(h.sim);
    expect(farmers.length).toBe(4);
    for (const farmer of farmers) {
      expect(dist2d(h.sim.player.pos, farmer.pos), farmer.templateId).toBeGreaterThan(20);
    }
    expect(nearFarmerNpc(h.sim.ctx, h.sim.player)).toBe(false);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => convert())).toBe(0);
    expect(eventsOf(h.sim, from, 'farmDenied')).toEqual([
      { type: 'farmDenied', pid: h.pid, reason: 'no_farmer' },
    ]);
    expect(eventsOf(h.sim, from, 'farmHusksConverted')).toEqual([]);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_HUSKS_PER_COMPOST);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(0);
  });

  it('is inclusive at the boundary and refuses one step beyond it', () => {
    // Exactly FARMER_TRADE_RANGE away trades (the <= arm, like nearBanker);
    // a hair past it does not. Both arms on the SAME bags, so the boundary
    // is the only thing that moved.
    const jessica = npcEntity(h.sim, 'farmer_jessica');
    h.sim.player.pos.x = jessica.pos.x + FARMER_TRADE_RANGE + 0.01;
    h.sim.player.pos.z = jessica.pos.z;
    h.sim.player.prevPos = { ...h.sim.player.pos };
    let from = h.sim.events.length;
    convert();
    expect(eventsOf(h.sim, from, 'farmDenied').map((e) => e.reason)).toEqual(['no_farmer']);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(0);
    h.sim.player.pos.x = jessica.pos.x + FARMER_TRADE_RANGE;
    h.sim.player.prevPos = { ...h.sim.player.pos };
    from = h.sim.events.length;
    convert();
    expect(eventsOf(h.sim, from, 'farmDenied')).toEqual([]);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
  });

  it('answers the range gate BEFORE the batch arithmetic: far away with no husks is still no_farmer', () => {
    // The stated gate order: a far-away sender learns the real reason, never
    // a phantom shortage.
    h.sim.removeItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    h.sim.player.pos.x += 500;
    const from = h.sim.events.length;
    convert();
    expect(eventsOf(h.sim, from, 'farmDenied').map((e) => e.reason)).toEqual(['no_farmer']);
    // And beside the farmer the same empty bags answer no_husks: the shortage
    // arm is reachable only at the counter.
    standByNpc(h.sim);
    const from2 = h.sim.events.length;
    convert();
    expect(eventsOf(h.sim, from2, 'farmDenied').map((e) => e.reason)).toEqual(['no_husks']);
  });

  it('trades at EVERY farmer, resolved by the flag: all four hubs, no id list', () => {
    for (const farmer of farmerEntities(h.sim)) {
      const hf = makeHarness();
      hf.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, hf.pid);
      standByNpc(hf.sim, farmer.templateId);
      convertHusks(hf.sim.ctx, hf.sim.player, hf.meta);
      expect(hf.sim.countItem(FARM_COMPOST_ITEM_ID, hf.pid), farmer.templateId).toBe(1);
    }
    // The walk really covered the four go-live farmers.
    expect(
      farmerEntities(h.sim)
        .map((e) => e.templateId)
        .sort(),
    ).toEqual(['farmer_hollis', 'farmer_jessica', 'farmer_teasel', 'farmer_verbena']);
  });

  it('a non-farmer NPC in reach does not count: beside the cook it is no_farmer', () => {
    // The flag, not "any NPC": a vendor without the farmer flag is no counter
    // for husks, and a player at the wrong stall learns so.
    standByNpc(h.sim, 'cook_marlow');
    expect(nearFarmerNpc(h.sim.ctx, h.sim.player)).toBe(false);
    const from = h.sim.events.length;
    convert();
    expect(eventsOf(h.sim, from, 'farmDenied').map((e) => e.reason)).toEqual(['no_farmer']);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_HUSKS_PER_COMPOST);
  });

  it('the DEAD arm still refuses first, near a farmer or far from every one', () => {
    // Dead beside the farmer: the shared dead line, no farmDenied at all.
    standByNpc(h.sim);
    h.sim.player.dead = true;
    let from = h.sim.events.length;
    convert();
    expect(eventsOf(h.sim, from, 'farmDenied')).toEqual([]);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_HUSKS_PER_COMPOST);
    // Dead and far: still the dead line, never no_farmer (the dead check is
    // the first gate).
    h.sim.player.pos.x += 500;
    from = h.sim.events.length;
    convert();
    expect(eventsOf(h.sim, from, 'farmDenied')).toEqual([]);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(0);
    // Anti-vacuous: alive again beside the farmer, the same bags convert.
    h.sim.player.dead = false;
    standByNpc(h.sim);
    convert();
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
  });

  it('D9: the watch fee is a plant-time bag payment, paid at the bed far from every farmer', () => {
    // The gate is the HUSK TRADE's alone. Planting with the watch knob at the
    // harness bed, with no farmer in reach, succeeds and spends the fee.
    const hp = makeHarness();
    expect(nearFarmerNpc(hp.sim.ctx, hp.sim.player)).toBe(false);
    for (const farmer of farmerEntities(hp.sim)) {
      expect(dist2d(hp.sim.player.pos, farmer.pos), farmer.templateId).toBeGreaterThan(
        FARMER_TRADE_RANGE,
      );
    }
    hp.sim.addItem(SEED_ID, 1, hp.pid);
    hp.sim.addItem(PRODUCE_ID, 3, hp.pid);
    const from = hp.sim.events.length;
    plantCrop(hp.sim.ctx, hp.sim.player, hp.meta, BED, CROP_ID, { watch: true });
    expect(eventsOf(hp.sim, from, 'farmDenied')).toEqual([]);
    expect(eventsOf(hp.sim, from, 'farmPlanted')).toHaveLength(1);
    expect((hp.meta.farmPlots.get(BED) as PlotState).watch).toBe(true);
    // Tier-1 fee is 2 produce (farm_watch_fee.ts): 3 in, 1 left.
    expect(hp.sim.countItem(PRODUCE_ID, hp.pid)).toBe(1);
    expect(hp.sim.countItem(SEED_ID, hp.pid)).toBe(0);
  });
});

describe('THE ANTI-CHORE INVARIANT: nothing rots', () => {
  it('pays a harvest N hours late EXACTLY what an on-time harvest pays', () => {
    const onTime = makeHarness(1234);
    const late = makeHarness(1234);
    for (const h of [onTime, late]) {
      giveSeeds(h);
      plant(h);
      clearCast(h.sim);
    }
    // Identical seeds and identical command scripts, so the plots are equal
    // before the clocks diverge. This is what makes the comparison below about
    // LATENESS and nothing else.
    expect(late.meta.farmPlots.get(BED)).toEqual(onTime.meta.farmPlots.get(BED));

    onTime.advance(CROP.durationMs);
    late.advance(CROP.durationMs + 12 * 60 * 60_000);
    harvest(onTime);
    harvest(late);

    expect(late.sim.countItem(PRODUCE_ID, late.pid)).toBe(
      onTime.sim.countItem(PRODUCE_ID, onTime.pid),
    );
    expect(late.sim.countItem(FINE_ID, late.pid)).toBe(onTime.sim.countItem(FINE_ID, onTime.pid));
    expect(late.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, late.pid)).toBe(
      onTime.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, onTime.pid),
    );
    expect(late.meta.pendingGatherGrants).toEqual(onTime.meta.pendingGatherGrants);
    // Anti-vacuous: the on-time harvest actually produced something to match.
    expect(onTime.sim.countItem(PRODUCE_ID, onTime.pid)).toBeGreaterThan(0);
  });

  it('never surfaces a status past `ready`, however long the plot sits', () => {
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    // Force the survival win so this arm is about the CLOCK alone.
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    h.advance(CROP.durationMs);
    expect(h.sim.farmPlotsFor(h.pid)[0]?.status).toBe('ready');
    h.advance(365 * 24 * 60 * 60_000);
    expect(h.sim.farmPlotsFor(h.pid)[0]?.status).toBe('ready');
  });
});

describe('the draw contract, clause by clause', () => {
  it('draws ZERO while a plot grows through real ticks', () => {
    // The world draws on its own every tick, so the honest measurement is a
    // DIFFERENCE: the same seed, the same command script, the same rng stream
    // position, with the only difference being whether a plot is in the
    // ground. The plot is written DIRECTLY rather than planted, because
    // planting spends two draws and would leave the two streams at different
    // positions, where every later mob roll diverges and the comparison
    // measures noise instead of farming.
    const withPlot = makeHarness(2024);
    const without = makeHarness(2024);
    withPlot.meta.farmPlots.set(BED, {
      cropId: CROP_ID,
      plantedAtMs: withPlot.now(),
      readyAtMs: withPlot.now() + CROP.durationMs,
      survivalRoll: 0.5,
      yieldSeed: 12_345,
      compost: false,
      watch: false,
      tonic: false,
      notified: false,
    });

    const tickDraws = (h: Harness) =>
      countDraws(h.sim, () => {
        for (let i = 0; i < 60; i++) {
          h.sim.tick();
          h.advance(1_000);
        }
      });
    const busy = tickDraws(withPlot);
    expect(busy).toBe(tickDraws(without));
    // Anti-vacuous twice over: the window really did draw (so "equal" is not
    // "both zero"), and the plot really was growing across it.
    expect(busy).toBeGreaterThan(0);
    expect(withPlot.meta.farmPlots.get(BED)?.readyAtMs).toBeGreaterThan(withPlot.now());
  });

  it('draws ZERO when the growth deadline passes, on the tick that crosses it', () => {
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    const before = h.sim.farmPlotsFor(h.pid)[0]?.status;
    // Cross the deadline INSIDE the counted window: nothing fires at expiry,
    // because there is no timer, only a comparison the projection makes.
    const crossing = countDraws(h.sim, () => {
      h.advance(CROP.durationMs);
      updateFarming(h.sim.ctx);
    });
    expect(before).toBe('growing');
    expect(h.sim.farmPlotsFor(h.pid)[0]?.status).toBe('ready');
    expect(crossing).toBe(0);
  });

  it('draws ZERO across a save and a load with a plot in the ground', () => {
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    const saved = h.sim.serializeCharacter(h.pid) as CharacterState;
    expect(saved.farmPlots).toBeDefined();

    let nowMs = START_MS + 60_000;
    const fresh = new Sim({
      seed: 41,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => nowMs,
    });
    const loadDraws = countDraws(fresh, () => {
      fresh.addPlayer('warrior', 'Farmer', { state: saved });
    });
    expect(loadDraws).toBe(0);
    const loadedMeta = [...fresh.players.values()][0] as PlayerMeta;
    expect(loadedMeta.farmPlots.get(BED)).toEqual(h.meta.farmPlots.get(BED));
    nowMs += 1;
  });

  it('draws ZERO in updateFarming, on a guard tick and on a sweep tick', () => {
    const h = makeHarness();
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    for (const tickCount of [0, 1, 19, 20, 40]) {
      h.sim.tickCount = tickCount;
      expect(countDraws(h.sim, () => updateFarming(h.sim.ctx))).toBe(0);
    }
  });

  it('draws EXACTLY two at a tier 3/4 harvest and ONE at tier 1/2: the harvest clauses', () => {
    // The seed-back and golden clauses proven in one session so the two
    // counts share a stream: the same farmer harvests a tier-3 plot (two
    // contiguous draws, the seed-back roll then the golden roll) and a
    // tier-1 plot (one draw, the golden roll alone), back to back. The
    // banded payout arms live in the seed-back describe and the golden win
    // arms in the golden describe; this is the clause count.
    const h = makeHarness(4);
    h.meta.gatheringProficiency.farming = 75;
    h.sim.addItem('skysilver_hoe', 1, h.pid);
    h.sim.addItem('highland_barley_seed', 1, h.pid);
    plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, 'highland_barley');
    clearCast(h.sim);
    giveSeeds(h);
    plant(h, BED2); // vale_wheat, tier 1
    clearCast(h.sim);
    h.advance((FARM_CROPS.highland_barley as FarmCropDef).durationMs);
    for (const bedId of [BED, BED2]) {
      (h.meta.farmPlots.get(bedId) as PlotState).survivalRoll = 0;
    }
    expect(countDraws(h.sim, () => harvest(h, BED))).toBe(2);
    expect(countDraws(h.sim, () => harvest(h, BED2))).toBe(1);
    // Both really paid, so neither count came from a refused command.
    expect(h.sim.countItem('highland_barley', h.pid)).toBeGreaterThan(0);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBeGreaterThan(0);
  });

  it('the golden clause: the roll is UNCONDITIONAL, so every harvest of every tier spends it', () => {
    // The clause the golden describe's band arms interpret: the golden roll
    // rides EVERY resolving harvest (both outcomes; the withered count is
    // pinned in the tier-1 describe), so the per-action draw count is a
    // constant of the crop TIER alone, never of the outcome or any knob.
    // Proven as a difference across outcomes on one stream: a survived and
    // a withered tier-1 harvest cost the same one draw.
    const h = makeHarness(2024);
    giveSeeds(h, 2);
    plant(h, BED);
    clearCast(h.sim);
    plant(h, BED2);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    (h.meta.farmPlots.get(BED2) as PlotState).survivalRoll = 0.99;
    expect(countDraws(h.sim, () => harvest(h, BED))).toBe(1);
    expect(countDraws(h.sim, () => harvest(h, BED2))).toBe(1);
    // One outcome each way, so the equal counts really span both branches.
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBeGreaterThan(0);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(FARM_WITHERED_HUSK_COUNT);
  });
});

describe('determinism across hosts', () => {
  it('gives two Sims on the same seed the identical plot and harvest', () => {
    const a = makeHarness(777);
    const b = makeHarness(777);
    for (const h of [a, b]) {
      giveSeeds(h, 2);
      plant(h, BED);
      clearCast(h.sim);
      plant(h, BED2);
      clearCast(h.sim);
      h.advance(CROP.durationMs);
      harvest(h, BED);
      harvest(h, BED2);
    }
    expect([...b.meta.farmPlots.entries()]).toEqual([...a.meta.farmPlots.entries()]);
    expect(b.sim.countItem(PRODUCE_ID, b.pid)).toBe(a.sim.countItem(PRODUCE_ID, a.pid));
    expect(b.sim.countItem(FINE_ID, b.pid)).toBe(a.sim.countItem(FINE_ID, a.pid));
    expect(b.meta.pendingGatherGrants).toEqual(a.meta.pendingGatherGrants);
    // Anti-vacuous: a DIFFERENT seed really does produce a different plot, so
    // the equality above is not comparing two constants.
    const c = makeHarness(778);
    giveSeeds(c);
    plant(c);
    expect(c.meta.farmPlots.get(BED)?.yieldSeed).not.toBe(a.meta.farmPlots.get(BED)?.yieldSeed);
  });

  it('gives two Sims the identical KNOBBED session: plots, bags, grants and events', () => {
    // The acceptance determinism pin re-armed with every knob in play: the
    // same seed and the same knobbed command script produce the same plots,
    // the same payments out of the bags, the same harvest into them, and the
    // same event stream.
    const a = makeHarness(4242);
    const b = makeHarness(4242);
    for (const hx of [a, b]) {
      hx.sim.addItem(SEED_ID, 2, hx.pid);
      hx.sim.addItem(FARM_COMPOST_ITEM_ID, 1, hx.pid);
      hx.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 1, hx.pid);
      hx.sim.addItem(PRODUCE_ID, 2, hx.pid);
      plantCrop(hx.sim.ctx, hx.sim.player, hx.meta, BED, CROP_ID, {
        compost: true,
        watch: true,
        tonic: true,
      });
      clearCast(hx.sim);
      plantCrop(hx.sim.ctx, hx.sim.player, hx.meta, BED2, CROP_ID, {});
      clearCast(hx.sim);
      hx.advance(CROP.durationMs);
      harvestCrop(hx.sim.ctx, hx.sim.player, hx.meta, BED);
      harvestCrop(hx.sim.ctx, hx.sim.player, hx.meta, BED2);
    }
    expect([...b.meta.farmPlots.entries()]).toEqual([...a.meta.farmPlots.entries()]);
    for (const itemId of [
      SEED_ID,
      PRODUCE_ID,
      FINE_ID,
      FARM_COMPOST_ITEM_ID,
      FARM_GROWTH_TONIC_ITEM_ID,
      FARM_WITHERED_HUSK_ITEM_ID,
    ]) {
      expect(b.sim.countItem(itemId, b.pid), itemId).toBe(a.sim.countItem(itemId, a.pid));
    }
    expect(b.meta.pendingGatherGrants).toEqual(a.meta.pendingGatherGrants);
    const farmEventsOf = (hx: Harness) => hx.sim.events.filter((e) => e.type.startsWith('farm'));
    expect(farmEventsOf(b)).toEqual(farmEventsOf(a));
    // Anti-vacuous: the knobbed session really planted with the knobs on.
    expect(farmEventsOf(a).some((e) => e.type === 'farmPlanted')).toBe(true);
  });

  it('survives a mid-growth save and load with its remaining duration intact', () => {
    const h = makeHarness(555);
    giveSeeds(h);
    plant(h);
    clearCast(h.sim);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    h.advance(CROP.durationMs / 3);
    const saved = h.sim.serializeCharacter(h.pid) as CharacterState;

    // The POST-TICK load path: a wall clock well past zero.
    const midMs = h.now();
    const ticked = new Sim({
      seed: 555,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => midMs,
    });
    ticked.addPlayer('warrior', 'Farmer', { state: saved });
    const tickedMeta = [...ticked.players.values()][0] as PlayerMeta;
    const tickedPlot = tickedMeta.farmPlots.get(BED) as PlotState;
    // Absolute deadlines, never remaining-time deltas: the crop kept growing
    // through the logout, so the remaining time SHRANK by exactly the wait.
    expect(tickedPlot.plantedAtMs).toBe(plot.plantedAtMs);
    expect(tickedPlot.readyAtMs).toBe(plot.readyAtMs);
    expect(tickedPlot.readyAtMs - midMs).toBe(CROP.durationMs - CROP.durationMs / 3);
    expect(tickedPlot.survivalRoll).toBe(plot.survivalRoll);
    expect(tickedPlot.yieldSeed).toBe(plot.yieldSeed);

    // The FRESH-SIM load path: lockoutNowMs 0, the offline host before its
    // first tick. Under the resolved anchor semantics an epoch-ms save
    // re-anchors to the floor of 1 rather than reading as long since ready,
    // and the duration is preserved.
    const fresh = new Sim({ seed: 555, playerClass: 'warrior', noPlayer: true });
    fresh.addPlayer('warrior', 'Farmer', { state: saved });
    const freshMeta = [...fresh.players.values()][0] as PlayerMeta;
    const freshPlot = freshMeta.farmPlots.get(BED) as PlotState;
    expect(freshPlot.plantedAtMs).toBe(1);
    expect(freshPlot.readyAtMs - freshPlot.plantedAtMs).toBe(CROP.durationMs);
    // And it is NOT already ready, which is the bug the re-anchor prevents.
    expect(fresh.farmPlotsFor(freshMeta.entityId)[0]?.status).toBe('growing');
  });
});

describe('the Sim delegates', () => {
  it('forwards plantCrop and harvestCrop, and no-ops on an unknown pid', () => {
    const h = makeHarness();
    giveSeeds(h);
    h.sim.plantCrop(BED, CROP_ID, undefined, h.pid);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    h.sim.harvestCrop(BED, h.pid);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    // An unresolvable pid changes nothing and throws nothing.
    expect(() => h.sim.plantCrop(BED, CROP_ID, undefined, 987_654)).not.toThrow();
    expect(() => h.sim.harvestCrop(BED, 987_654)).not.toThrow();
    expect(h.meta.farmPlots.size).toBe(0);
  });

  it('forwards convertHusks, and no-ops on an unknown pid', () => {
    const h = makeHarness();
    standByNpc(h.sim);
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    // The unknown pid FIRST, while the husks are still in the bags: after the
    // real call there is nothing left to convert, so ordering it second would
    // prove nothing.
    expect(() => h.sim.convertHusks(987_654)).not.toThrow();
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(0);
    h.sim.convertHusks(h.pid);
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
    expect(h.sim.countItem(FARM_WITHERED_HUSK_ITEM_ID, h.pid)).toBe(0);
  });
});

describe('content wiring', () => {
  it('keeps every bed the plant gate accepts inside the persisted allowlist', () => {
    // The command gate and the load allowlist must name the same set, or a
    // plot could be minted and then destroyed on the next load.
    for (const bedId of FARM_BED_IDS) {
      expect(farmBedById(bedId)).toBeDefined();
    }
    expect(farmBedById('bed_not_a_real_bed')).toBeUndefined();
  });
});

describe('item lock (issue 3042): locked copies are invisible to every farming spend', () => {
  // The v0.38.0 sync heal: the release's player lock names profession
  // consumption as a refusing boundary, and farming's spends are exactly
  // that. Every sufficiency gate counts UNLOCKED units only and the payment
  // walk never victimizes a locked slot (the crafting.ts reagent idiom).
  // One arm per touched site: the seed gate, the payment walk, the compost
  // gate, the fee planner callback, the tonic gate, and the husk trade's
  // count and spend.

  // Since the v0.39.0 lock rework, setItemLocked toggles the named slot WHOLE
  // (no single-unit peel into a fresh slot), so a locked/unlocked mix is built
  // by granting AROUND a lock: a unit granted while a same-item slot is locked
  // never merges into it (locked payloads are unmergeable) and starts its own
  // unlocked slot instead.
  function setSlotLocked(h: Harness, itemId: string, locked: boolean): void {
    const idx = h.meta.inventory.findIndex(
      (s) => s.itemId === itemId && (s.instance?.locked === true) !== locked,
    );
    expect(idx, `no ${locked ? 'unlocked' : 'locked'} ${itemId} slot`).toBeGreaterThanOrEqual(0);
    expect(setItemLocked(h.sim.ctx, itemId, locked, h.pid, idx).ok).toBe(true);
  }
  function lockOneCopy(h: Harness, itemId: string): void {
    setSlotLocked(h, itemId, true);
  }

  // Hand-rolled reads (never the production lock helpers, which are the very
  // code under test): units by lock state, straight off the slots.
  function lockedUnits(h: Harness, itemId: string): number {
    return h.meta.inventory
      .filter((s) => s.itemId === itemId && s.instance?.locked === true)
      .reduce((n, s) => n + s.count, 0);
  }
  function unlockedUnits(h: Harness, itemId: string): number {
    return h.meta.inventory
      .filter((s) => s.itemId === itemId && s.instance?.locked !== true)
      .reduce((n, s) => n + s.count, 0);
  }

  it('a locked-only seed refuses the plant as locked (not no_seed), draw-free, seed kept', () => {
    const h = makeHarness();
    giveSeeds(h, 1);
    lockOneCopy(h, SEED_ID);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => plant(h))).toBe(0);
    // The lock-only split (issue 3042 acceptance): the raw count would have
    // passed, so the denial names the lock, never a phantom shortage.
    expect(denyReason(h.sim, from)).toBe('locked');
    expect(lockedUnits(h, SEED_ID)).toBe(1);
  });

  it('the payment walk spends the UNLOCKED seed and the locked spare survives', () => {
    const h = makeHarness();
    // Build [unlocked at a low index, locked at the END slot]: the hub removal
    // walk consumes highest bag index FIRST, so the locked copy sits exactly
    // where a lock-blind walk would spend first. Whole-slot locks cannot split
    // a stack, so the mix is built by the grant-around-a-lock dance plus one
    // unlock: seed A granted and locked, seed B granted (fresh end slot, a
    // locked slot never merges), B locked, A unlocked.
    giveSeeds(h, 1);
    lockOneCopy(h, SEED_ID);
    giveSeeds(h, 1);
    lockOneCopy(h, SEED_ID);
    setSlotLocked(h, SEED_ID, false);
    expect(lockedUnits(h, SEED_ID)).toBe(1);
    expect(unlockedUnits(h, SEED_ID)).toBe(1);
    // The arm's power rests on the ORDER: the locked copy must sit at the
    // HIGHER bag index, where the highest-first removal walk spends first.
    // Assert it directly so a future addItem hole-fill or slot reorder turns
    // this arm red instead of silently vacuous.
    const lockedIdx = h.meta.inventory.findIndex(
      (s) => s.itemId === SEED_ID && s.instance?.locked === true,
    );
    const unlockedIdx = h.meta.inventory.findIndex(
      (s) => s.itemId === SEED_ID && s.instance?.locked !== true,
    );
    expect(lockedIdx).toBeGreaterThan(unlockedIdx);
    const from = h.sim.events.length;
    plant(h);
    expect(eventsOf(h.sim, from, 'farmPlanted')).toHaveLength(1);
    expect(lockedUnits(h, SEED_ID)).toBe(1);
    expect(unlockedUnits(h, SEED_ID)).toBe(0);
  });

  it('a locked-only compost refuses a compost plant as locked with nothing consumed', () => {
    const h = makeHarness();
    giveSeeds(h, 1);
    h.sim.addItem(FARM_COMPOST_ITEM_ID, 1, h.pid);
    lockOneCopy(h, FARM_COMPOST_ITEM_ID);
    const from = h.sim.events.length;
    expect(
      countDraws(h.sim, () =>
        plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID, { compost: true }),
      ),
    ).toBe(0);
    expect(denyReason(h.sim, from)).toBe('locked');
    expect(unlockedUnits(h, SEED_ID)).toBe(1);
    expect(lockedUnits(h, FARM_COMPOST_ITEM_ID)).toBe(1);
  });

  it('locked fee produce is invisible to the watch fee planner (locked, plan-vs-raw split)', () => {
    const h = makeHarness();
    giveSeeds(h, 1);
    // Tier 1 fee is 2 produce; hold exactly 2 but lock 1, leaving the
    // planner one short while the RAW count still affords the fee: the
    // deny-path re-plan proves locks alone denied it. Grant around the lock
    // (whole-slot semantics): one locked slot, one fresh unlocked slot.
    h.sim.addItem(PRODUCE_ID, 1, h.pid);
    lockOneCopy(h, PRODUCE_ID);
    h.sim.addItem(PRODUCE_ID, 1, h.pid);
    const from = h.sim.events.length;
    expect(
      countDraws(h.sim, () =>
        plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID, { watch: true }),
      ),
    ).toBe(0);
    expect(denyReason(h.sim, from)).toBe('locked');
    expect(unlockedUnits(h, PRODUCE_ID)).toBe(1);
    expect(lockedUnits(h, PRODUCE_ID)).toBe(1);
  });

  it('a genuine fee shortfall stays no_fee_produce even when the only copy held is locked', () => {
    const h = makeHarness();
    giveSeeds(h, 1);
    // One produce held (locked), fee is 2: the raw count fails too, so the
    // reason must stay the family shortfall, never a lock claim.
    h.sim.addItem(PRODUCE_ID, 1, h.pid);
    lockOneCopy(h, PRODUCE_ID);
    const from = h.sim.events.length;
    expect(
      countDraws(h.sim, () =>
        plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID, { watch: true }),
      ),
    ).toBe(0);
    expect(denyReason(h.sim, from)).toBe('no_fee_produce');
  });

  it('a locked-only tonic refuses a tonic plant as locked', () => {
    const h = makeHarness();
    giveSeeds(h, 1);
    h.sim.addItem(FARM_GROWTH_TONIC_ITEM_ID, 1, h.pid);
    lockOneCopy(h, FARM_GROWTH_TONIC_ITEM_ID);
    const from = h.sim.events.length;
    expect(
      countDraws(h.sim, () =>
        plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID, { tonic: true }),
      ),
    ).toBe(0);
    expect(denyReason(h.sim, from)).toBe('locked');
    expect(lockedUnits(h, FARM_GROWTH_TONIC_ITEM_ID)).toBe(1);
  });

  it('locked husks join neither the batch count nor the spend', () => {
    const h = makeHarness();
    standByNpc(h.sim);
    // One locked batch-sized stack, one unlocked (grant around the lock).
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    lockOneCopy(h, FARM_WITHERED_HUSK_ITEM_ID);
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    const from = h.sim.events.length;
    convertHusks(h.sim.ctx, h.sim.player, h.meta);
    const ev = eventsOf(h.sim, from, 'farmHusksConverted');
    expect(ev).toHaveLength(1);
    expect(ev[0].husks).toBe(FARM_HUSKS_PER_COMPOST);
    expect(ev[0].compost).toBe(1);
    expect(lockedUnits(h, FARM_WITHERED_HUSK_ITEM_ID)).toBe(FARM_HUSKS_PER_COMPOST);
    expect(unlockedUnits(h, FARM_WITHERED_HUSK_ITEM_ID)).toBe(0);
  });

  it('all-locked husks refuse the trade as locked with the husks kept', () => {
    const h = makeHarness();
    standByNpc(h.sim);
    // The whole batch-sized stack locked in place (whole-slot semantics).
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    lockOneCopy(h, FARM_WITHERED_HUSK_ITEM_ID);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => convertHusks(h.sim.ctx, h.sim.player, h.meta))).toBe(0);
    // Raw count affords a batch, unlocked count does not: 'locked', never a
    // phantom "not enough husks".
    expect(denyReason(h.sim, from)).toBe('locked');
    expect(lockedUnits(h, FARM_WITHERED_HUSK_ITEM_ID)).toBe(FARM_HUSKS_PER_COMPOST);
  });
});

// The render phase's clock read. IWorld.farmNowMs exists so a render consumer
// can derive a growth-stage fraction without ever subtracting a clock the
// authority did not write its timestamps in, so what needs pinning is exactly
// that: same base, and it moves with the sim.
describe('farmNowMs is the sim OWN clock base', () => {
  it('is the very base the plot timestamps are written in', () => {
    const h = makeHarness();
    // Injected clock: the facet read and the harness clock are one value.
    expect(h.sim.farmNowMs()).toBe(h.now());

    giveSeeds(h);
    plant(h);
    const plot = h.meta.farmPlots.get(BED) as PlotState;
    expect(plot, 'the plant must have landed for this arm to mean anything').toBeDefined();
    // The plant instant: the stamp on the plot and the facet read agree, which
    // is what makes (farmNowMs - plantedAtMs) a meaningful elapsed time.
    expect(plot.plantedAtMs).toBe(h.sim.farmNowMs());

    // ...and it keeps agreeing as the clock runs, so a stage fraction derived
    // from the pair is bounded by the crop's real window.
    h.advance(CROP.durationMs / 2);
    expect(h.sim.farmNowMs()).toBe(h.now());
    expect(h.sim.farmNowMs() - plot.plantedAtMs).toBe(CROP.durationMs / 2);
    expect(h.sim.farmNowMs()).toBeLessThan(plot.readyAtMs);

    h.advance(CROP.durationMs);
    expect(h.sim.farmNowMs()).toBeGreaterThan(plot.readyAtMs);
  });

  it('advances with the tick on a sim with no injected clock', () => {
    // The offline and headless hosts run the UNINJECTED lockoutNowMs, which
    // counts sim-clock ms from zero. A render consumer on those hosts needs
    // this to move, or every bed would sit at its planting stage forever.
    const fresh = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: false });
    const before = fresh.farmNowMs();
    expect(Number.isFinite(before)).toBe(true);
    const TICKS = 20; // one second at the 20 Hz tick
    for (let i = 0; i < TICKS; i++) fresh.tick();
    expect(fresh.farmNowMs() - before).toBe(Math.round(TICKS * DT * 1000));
  });
});
