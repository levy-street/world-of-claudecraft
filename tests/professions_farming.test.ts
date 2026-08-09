// The farming growth engine: the plant and harvest command bodies, the
// survival ramp, the harvest-lives yield, the gain schedule, and above all
// THE DRAW CONTRACT stated in src/sim/professions/farming.ts.
//
// The draw contract is the reason most of this file exists. Farming's whole
// determinism story is that a plant costs exactly two rng draws, a tier 3/4
// harvest costs exactly one (the seed-back roll, both outcomes), and literally
// nothing else costs any, so growth can be wall-clock and offline-friendly
// without the three hosts ever diverging. Every clause of that contract gets
// its own counted arm below.
//
// THE CLOCK IS ADVANCEABLE, ALWAYS. `lockoutNowMs` is injected as a `let` the
// tests move forward; a frozen injected clock is how a self-re-arming wait
// starves a test runner into a hang rather than a failure, so nothing here
// asserts against a clock that never moves.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  FARM_CROPS,
  type FarmCropDef,
  farmCropSkillThreshold,
  farmCropTier,
} from '../src/sim/content/farm_crops';
import { FARM_BED_IDS, farmBedById } from '../src/sim/content/farm_patches';
import { DEFAULT_MOUNT } from '../src/sim/content/mounts';
import { TOOL_EFFECTS } from '../src/sim/content/professions';
import { ITEMS } from '../src/sim/data';
import { FARM_MAX_GROW_MS } from '../src/sim/professions/farm_persist';
import type { PlotState } from '../src/sim/professions/farm_projection';
import {
  canPlantCrop,
  convertHusks,
  FARM_COMPOST_ITEM_ID,
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
import { resolveSlotToolEffect, slotEffect } from '../src/sim/professions/tools';
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import { FARMING_CAST_ID, isNonSpellCast, type SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

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

  it('ships the full eight-crop ladder, two per tier, with vale_wheat inside its locked band', () => {
    // The crop-ladder phase's catalog width pin: the packet-locked eight-crop
    // ladder (D11 ids), authored in tier order. Retiring or renaming any of
    // these destroys player plots at load (the save-key banner), so the list
    // moves only deliberately.
    expect(Object.keys(FARM_CROPS)).toEqual([
      'vale_wheat',
      'brook_carrot',
      'marsh_rice',
      'bog_beet',
      'highland_barley',
      'frost_gourd',
      'gilded_sunmelon',
      'evergarden_greens',
    ]);
    expect(Object.values(FARM_CROPS).map((c) => c.tier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
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
    // The tuning surface of the whole ladder, pinned once: the two crops of a
    // tier must never share a duration (the flag comments in farm_crops.ts
    // state each choice), and the pin keeps a re-tune deliberate.
    expect(Object.values(FARM_CROPS).map((c) => [c.id, c.durationMs])).toEqual([
      ['vale_wheat', 2_700_000],
      ['brook_carrot', 2_100_000],
      ['marsh_rice', 7_800_000],
      ['bog_beet', 8_100_000],
      ['highland_barley', 14_400_000],
      ['frost_gourd', 16_200_000],
      ['gilded_sunmelon', 36_000_000],
      ['evergarden_greens', 37_800_000],
    ]);
    const durations = Object.values(FARM_CROPS).map((c) => c.durationMs);
    expect(new Set(durations).size).toBe(durations.length);
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
  it('pins the schedule rows to their literals', () => {
    expect(FARMING_GAIN_SCHEDULE.map((r) => [r.belowProficiency, r.gain])).toEqual([
      [25, 1],
      [50, 0.5],
      [75, 0.1],
      [100, 0.02],
    ]);
  });

  it('takes the first row the proficiency sits below, and zero past the last', () => {
    expect(farmingHarvestGain(0)).toBe(1);
    expect(farmingHarvestGain(24.9)).toBe(1);
    expect(farmingHarvestGain(25)).toBe(0.5);
    expect(farmingHarvestGain(49)).toBe(0.5);
    expect(farmingHarvestGain(50)).toBe(0.1);
    expect(farmingHarvestGain(75)).toBe(0.02);
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
    expect(farmingHarvestGainAt(0, 1)).toBe(1);
    expect(farmingHarvestGainAt(25, 1)).toBe(0.5);
    expect(farmingHarvestGainAt(49.9, 1)).toBe(0.5);
    expect(farmingHarvestGainAt(50, 1)).toBe(0);
    // A tier-2 crop keeps teaching where the tier-1 crop gave up.
    expect(farmingHarvestGainAt(50, 2)).toBe(0.1);
    expect(farmingHarvestGainAt(75, 2)).toBe(0);
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
    expect(countDraws(fresh, () => harvestCrop(fresh.ctx, farmer, meta, BED))).toBe(0);
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

  it('harvests a toniced plot with ZERO ctx.rng draws and pays the expanded yield', () => {
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
    expect(countDraws(h.sim, () => harvestCrop(h.sim.ctx, h.sim.player, h.meta, BED))).toBe(0);
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
  // collapsed to the unarmed harvest. And every arm counts ZERO ctx.rng
  // draws at harvest: the effect halves are seed expansions, never draws
  // (tier-1 plots here; the one draw a tier 3/4 harvest spends is the
  // seed-back roll, owned by its own describe below).
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
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(armed.count);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(armed.fine);
    // Exactly one charge: the R42 settle spends only when the bonus changed
    // the granted outcome, which the non-vacuity guard proved it did.
    expect(slot.durability).toBe(before - 1);
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
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBe(armed.count);
    expect(h.sim.countItem(FINE_ID, h.pid)).toBe(armed.fine);
    expect(slot.durability).toBe(before - 1);
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
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
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

describe('harvestCrop: draw-free on every TIER 1/2 path', () => {
  // Every arm here plants the tier-1 vale_wheat, so the zero-draw pins are
  // tier-scoped claims: since the crop ladder, a TIER 3/4 harvest draws
  // exactly one (the seed-back roll), pinned band by band in its own
  // describe below. Tier is an input, not an outcome, so the tier-1 arms
  // here and the tier 3/4 arms there can never fork one stream.
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
    expect(draws).toBe(0);
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
    // a command-time grant lands NEXT tick.
    expect(h.meta.pendingGatherGrants).toEqual([{ professionId: 'farming', amount: 1 }]);
    expect(h.meta.gatheringProficiency.farming).toBe(0);
    h.sim.tick();
    expect(h.meta.gatheringProficiency.farming).toBe(1);
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
    const from = h.sim.events.length;
    const draws = countDraws(h.sim, () => harvest(h));
    expect(draws).toBe(0);
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
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
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

describe('the seed-back roll (tier 3/4): ONE draw at harvest, banded payouts', () => {
  // The one deliberate exception to "harvest draws nothing": a tier 3/4
  // harvest spends EXACTLY one ctx.rng draw at a FIXED position (after the
  // outcome-resolution gates, before the survived/withered branch and every
  // loop), on BOTH outcomes. It is a REAL draw at player-action time, NOT a
  // seed expansion: the tonic is seed-anchored because its outcome is fixed
  // at plant time; seed-back is decided by the harvest itself, which is
  // D4-legal because a harvest is a player action.
  //
  // PROBED SEEDS, the vacuity rule: the roll is the THIRD post-construction
  // draw on these harnesses (two plant draws, then the harvest's one), so
  // each band arm names the harness seed whose third draw was probed into
  // its band, and asserts the captured value IN-ARM against the shipped
  // thresholds. Probed against the real modules (third draw after
  // new Sim({ seed, playerClass: 'warrior', autoEquip: false })):
  //   seed 4  -> 0.026266 (tier-3 two-seed band, under 0.08)
  //   seed 3  -> 0.180549 (tier-3 one-seed band, in [0.08, 0.40))
  //   seed 5  -> 0.712293 (tier-3 zero band, at or above 0.40)
  //   seed 41 -> 0.067811 (tier-4 ONE-seed band, in [0.06, 0.35); the same
  //              roll sits under tier 3's 0.08, which is what makes it the
  //              per-tier-thresholds proof)
  //   seed 8  -> 0.202110 (a withered-arm WINNER: pays 1 seed)
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

  it('a survived tier-3 harvest draws EXACTLY one, and the two-seed band pays 2 (probed seed 4)', () => {
    const h = makeHarness(4);
    const plot = plantTier(h, T3_CROP, T3_HOE, 75);
    plot.survivalRoll = 0; // survival forced: this arm is about the roll
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(0); // the plant spent it
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 75);
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    // The in-arm band claim (the probe, re-proven where it counts): a draw
    // block shift that re-seats the stream reds HERE, loudly.
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_TWO_CHANCE[3] as number);
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
    expect(values).toHaveLength(1);
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_ONE_CHANCE[3] as number);
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(1);
    expect(eventsOf(h.sim, from, 'farmHarvested')[0].seedBackCount).toBe(1);
    assertAllLootFlagged(h, from);
  });

  it('the zero band still draws its one, pays nothing, and OMITS the field (probed seed 5)', () => {
    // The omit-zero pin: a zero roll leaves the event byte-identical to the
    // pre-field wire (the only-when-true doctrine), and the bag agrees. The
    // draw still happens, which is the whole fixed-position contract: the
    // stream moves by exactly one per tier 3/4 harvest, win or lose.
    const h = makeHarness(5);
    const plot = plantTier(h, T3_CROP, T3_HOE, 75);
    plot.survivalRoll = 0;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_ONE_CHANCE[3] as number);
    expect(h.sim.countItem(T3_SEED, h.pid)).toBe(0);
    const ev = eventsOf(h.sim, from, 'farmHarvested')[0];
    expect('seedBackCount' in ev).toBe(false);
  });

  it('a tier-4 harvest draws its one and pays by ITS OWN thresholds (probed seed 41)', () => {
    // The per-tier proof: this roll (0.067811) sits UNDER tier 3's two-seed
    // threshold but inside tier 4's one-seed band, so a flat-rate regression
    // that ignored the crop tier would pay 2 here and red on the bag.
    const h = makeHarness(41);
    const plot = plantTier(h, T4_CROP, T4_HOE, 85);
    plot.survivalRoll = 0;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_TWO_CHANCE[4] as number);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_ONE_CHANCE[4] as number);
    expect(h.sim.countItem(T4_SEED, h.pid)).toBe(1);
    expect(eventsOf(h.sim, from, 'farmHarvested')[0].seedBackCount).toBe(1);
    assertAllLootFlagged(h, from);
  });

  it('a WITHERED tier-3 harvest draws its one and can pay seed-back beside the husks (probed seed 8)', () => {
    // The withered consolation roll is deliberate (both outcomes share the
    // one pre-branch draw), so a failed high-tier crop can hand a seed back
    // WITH its husks. Proficiency 70: the skysilver hoe wields exactly at
    // its R22 requirement, and the tier-3 survival ramp reads 0.97 there, so
    // the 0.99 roll below genuinely withers without any skill fiddling.
    const h = makeHarness(8);
    const plot = plantTier(h, T3_CROP, T3_HOE, 70);
    plot.survivalRoll = 0.99;
    const from = h.sim.events.length;
    const values = recordDraws(h.sim, () => harvest(h));
    expect(values).toHaveLength(1);
    // The probed winner claim, in-arm: this roll pays exactly one seed.
    expect(values[0]).toBeGreaterThanOrEqual(FARM_SEED_BACK_TWO_CHANCE[3] as number);
    expect(values[0]).toBeLessThan(FARM_SEED_BACK_ONE_CHANCE[3] as number);
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
    // harvest then spends exactly its one draw.
    (h.meta.farmPlots.get(BED) as PlotState).survivalRoll = 0;
    expect(countDraws(h.sim, () => harvest(h))).toBe(1);
  });

  it('a tier-2 harvest draws ZERO: the negative arm of the tier condition', () => {
    // Same harness shape as the banded arms above, one tier down, so the
    // zero here is about the TIER and nothing else (the non-vacuous negative
    // arm the tier-1 describe cannot supply on its own).
    const h = makeHarness(4);
    const plot = plantTier(h, 'marsh_rice', 'bronze_hoe', 40);
    plot.survivalRoll = 0;
    const expected = resolveFarmHarvest(plot.yieldSeed as number, 40);
    const from = h.sim.events.length;
    expect(countDraws(h.sim, () => harvest(h))).toBe(0);
    expect(h.sim.countItem('marsh_rice_seed', h.pid)).toBe(0);
    const ev = eventsOf(h.sim, from, 'farmHarvested')[0];
    expect('seedBackCount' in ev).toBe(false);
    // The harvest itself still paid normally.
    expect(h.sim.countItem('marsh_rice', h.pid)).toBe(expected.count);
    expect(h.sim.countItem('fine_marsh_rice', h.pid)).toBe(expected.fine);
  });
});

describe('convertHusks: the husk trade, draw-free on every path', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
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

  it('needs no bed, no range and no cast: the location gate is the documented Phase 9 deferral', () => {
    // The permissive gate, exercised rather than assumed: standing nowhere
    // near a farm, mid-cast, the trade still lands. The go-live phase adds
    // the farmer-NPC range arm and flips this arm with it.
    h.sim.player.pos.x += 500;
    h.sim.player.pos.z += 500;
    giveSeeds(h);
    h.sim.addItem(FARM_WITHERED_HUSK_ITEM_ID, FARM_HUSKS_PER_COMPOST, h.pid);
    h.sim.player.castingAbility = FARMING_CAST_ID;
    h.sim.player.castRemaining = 1;
    convert();
    expect(h.sim.countItem(FARM_COMPOST_ITEM_ID, h.pid)).toBe(1);
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

  it('draws EXACTLY one at a tier 3/4 harvest and ZERO at tier 1/2: the seed-back clause', () => {
    // The contract's newest clause, proven in one session so the two counts
    // share a stream: the same farmer harvests a tier-3 plot (one draw, the
    // seed-back roll) and a tier-1 plot (zero), back to back. The banded
    // payout arms live in the seed-back describe; this is the clause count.
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
    expect(countDraws(h.sim, () => harvest(h, BED))).toBe(1);
    expect(countDraws(h.sim, () => harvest(h, BED2))).toBe(0);
    // Both really paid, so neither count came from a refused command.
    expect(h.sim.countItem('highland_barley', h.pid)).toBeGreaterThan(0);
    expect(h.sim.countItem(PRODUCE_ID, h.pid)).toBeGreaterThan(0);
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
