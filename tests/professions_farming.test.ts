// The farming growth engine: the plant and harvest command bodies, the
// survival ramp, the harvest-lives yield, the gain schedule, and above all
// THE DRAW CONTRACT stated in src/sim/professions/farming.ts.
//
// The draw contract is the reason most of this file exists. Farming's whole
// determinism story is that a plant costs exactly two rng draws and literally
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
import type { PlotState } from '../src/sim/professions/farm_projection';
import {
  canPlantCrop,
  FARM_FINE_CHANCE_BASE,
  FARM_HARVEST_LIFE_FLOOR,
  FARM_HARVEST_PICK_CAP,
  FARM_KEEP_CHANCE_BASE,
  FARM_PLANT_CAST_SEC,
  FARM_SURVIVAL_AT_GATE,
  FARM_SURVIVAL_BAND_SPAN,
  FARM_WITHERED_HUSK_COUNT,
  FARM_WITHERED_HUSK_ITEM_ID,
  FARMING_GAIN_SCHEDULE,
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
import { type CharacterState, type PlayerMeta, Sim } from '../src/sim/sim';
import { FARMING_CAST_ID, isNonSpellCast, type SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const PRODUCE_ID = 'vale_wheat';
const FINE_ID = 'fine_vale_wheat';
const BED = 'bed_eastbrook_1';
const BED2 = 'bed_eastbrook_2';
const START_MS = 1_700_000_000_000;

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

  it('ships exactly the tier-1 crop, with its duration inside the locked band', () => {
    expect(Object.keys(FARM_CROPS)).toEqual([CROP_ID]);
    expect(CROP.tier).toBe(1);
    expect(CROP.seedItemId).toBe(SEED_ID);
    expect(CROP.produceItemId).toBe(PRODUCE_ID);
    expect(CROP.fineProduceItemId).toBe(FINE_ID);
    // The locked tier-1 pacing band is 30 to 60 minutes.
    expect(CROP.durationMs).toBeGreaterThanOrEqual(30 * 60_000);
    expect(CROP.durationMs).toBeLessThanOrEqual(60 * 60_000);
    expect(CROP.durationMs).toBe(2_700_000);
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
    // A tier-1 crop teaches through the first two rows and grays at 50, which
    // is exactly what caps farming at 50 until the crop ladder ships tier 2.
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

  it('preserves stealth, sitting and mount on a refusal (the trio runs after every gate)', () => {
    // The mirror of the success-path state-breaking pin below: the deliberate
    // action trio (breakStealth, standUp, forceDismount) sits AFTER every deny
    // arm, so a refused plant never reveals or unseats the player. Armed
    // exactly like the success pin but with an empty seed pouch, so the
    // refusal comes from the LAST gate in the stated order: if the trio ever
    // moves above ANY gate, this arm reds while the success pin stays green.
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
    expect(denyReason(h.sim, from)).toBe('no_seed');
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

describe('harvestCrop: draw-free on every path', () => {
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
    // future third grant (a seed-back roll, a rare-event windfall) is covered
    // the moment it lands instead of quietly slipping through.
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
    h.sim.plantCrop(BED, CROP_ID, h.pid);
    expect(h.meta.farmPlots.has(BED)).toBe(true);
    clearCast(h.sim);
    h.advance(CROP.durationMs);
    h.sim.harvestCrop(BED, h.pid);
    expect(h.meta.farmPlots.has(BED)).toBe(false);
    // An unresolvable pid changes nothing and throws nothing.
    expect(() => h.sim.plantCrop(BED, CROP_ID, 987_654)).not.toThrow();
    expect(() => h.sim.harvestCrop(BED, 987_654)).not.toThrow();
    expect(h.meta.farmPlots.size).toBe(0);
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
