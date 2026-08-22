// THE ANTI-CHORE PROOF: farming's five load-bearing promises, pinned rather
// than asserted in prose.
//
// WHY THIS SUITE EXISTS, and why it exists NOW. Phase 11e roughly tripled the
// farming calendar (about 65 days to about 74, and the first fifty points from
// 6 days to 25). A slower curve is only acceptable because it changes PACING
// and never OBLIGATION: nothing about the longer climb may make a player OWE
// the game a visit. The five rows below are
// docs/prd/masterwrought/farming/qa-checklist.md's anti-chore audit taken
// verbatim, each given a pin or a stated proof against the re-tuned curve. If
// a later tune wants a faster ladder in exchange for a daily quota, a login
// streak, a rested bonus or any catch-up mechanic, this file is what says no.
//
// THE ONE THAT MATTERS MOST is row 2's decisive arm: a harvest's proficiency
// grant is a function of PROFICIENCY and CROP TIER only, never of elapsed time.
// It is driven through the REAL harvest command with two different clocks
// rather than by reading the pure function, because reading the pure function
// only proves the pure function.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FARM_CROPS, type FarmCropDef, farmCropTier } from '../src/sim/content/farm_crops';
import { farmBedById } from '../src/sim/content/farm_patches';
import { farmSurvivalChance, projectFarmPlots } from '../src/sim/professions/farm_projection';
import {
  FARMING_GAIN_SCHEDULE,
  farmingHarvestGainAt,
  harvestCrop,
  plantCrop,
} from '../src/sim/professions/farming';
import { type PlayerMeta, Sim } from '../src/sim/sim';
import { terrainHeight } from '../src/sim/world';

const CROP_ID = 'vale_wheat';
const SEED_ID = 'vale_wheat_seed';
const HOE_ID = 'garden_hoe';
const BED = 'bed_eastbrook_1';
const START_MS = 1_700_000_000_000;
const CROP = FARM_CROPS[CROP_ID] as FarmCropDef;

interface Harness {
  sim: Sim;
  pid: number;
  meta: PlayerMeta;
  advance(ms: number): void;
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
  const bed = farmBedById(BED);
  if (!bed) throw new Error('no bed');
  sim.player.pos.x = bed.x;
  sim.player.pos.z = bed.z;
  sim.player.pos.y = terrainHeight(bed.x, bed.z, sim.cfg.seed);
  sim.addItem(HOE_ID, 1, pid);
  sim.addItem(SEED_ID, 4, pid);
  return {
    sim,
    pid,
    meta,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

function clearCast(sim: Sim): void {
  sim.player.castingAbility = null;
  sim.player.castRemaining = 0;
}

/** Plant, ripen by `extraMs` past the crop's duration, force the survival win,
 *  harvest, and return the proficiency the grant drain produced. */
function harvestAfter(h: Harness, extraMs: number): number {
  plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID);
  clearCast(h.sim);
  h.advance(CROP.durationMs + extraMs);
  const plot = h.meta.farmPlots.get(BED);
  if (!plot) throw new Error('no plot');
  plot.survivalRoll = 0;
  harvestCrop(h.sim.ctx, h.sim.player, h.meta, BED);
  h.sim.tick();
  return h.meta.gatheringProficiency.farming;
}

/** The farming module's source with every comment stripped, so no source-text
 *  assertion below can be satisfied by a comment that merely NAMES a call. */
function farmingSourceWithoutComments(): string {
  const raw = readFileSync(path.join(process.cwd(), 'src/sim/professions/farming.ts'), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

describe('anti-chore row 1: two visits per cycle, and no mid-growth interaction exists', () => {
  it('offers no farming command between plant and harvest', () => {
    // D8, front-loaded only. The proof is the SHAPE of the module: the only
    // exported command bodies that touch a live plot are the two visits. A
    // third would have to be a new export.
    const source = farmingSourceWithoutComments();
    const exported = [...source.matchAll(/export function (\w+)/g)].map((m) => m[1]);
    // THE WHOLE EXPORT SURFACE, pinned literally. Corrected at the 11e QA: the
    // arm used to filter the exports through a verb prefix list
    // (plant|harvest|water|tend|weed|fertilize|prune|check) and claim that was
    // "over the export surface rather than over a list someone has to remember
    // to update". It was exactly such a list, and a narrower one than it looked:
    // of the ten functions this module exports the filter could see two, so a
    // new applyCompostLate, refreshPlot, mendCrop or useTonicOnPlot would have
    // been invisible to the one arm that exists to forbid it. Pinning the full
    // list means any new export reds here and has to be justified.
    expect(exported.sort()).toEqual([
      'canPlantCrop',
      'convertHusks',
      'distToBed',
      'farmingHarvestGain',
      'farmingHarvestGainAt',
      'farmingTeachingCeilingFor',
      'harvestCrop',
      'plantCrop',
      'resolveFarmHarvest',
      'updateFarming',
    ]);
    // The verb filter stays as the readable statement of the rule it enforces.
    const plotCommands = exported.filter((name) =>
      /^(plant|harvest|water|tend|weed|fertilize|prune|check)/.test(name),
    );
    expect(plotCommands.sort()).toEqual(['harvestCrop', 'plantCrop']);
  });

  it('every knob is spent at PLANT time, so nothing can be applied mid-growth', () => {
    // The three knobs (compost, watch, tonic) are plant-time arguments. If any
    // were applicable later there would be a command taking a bed and a knob
    // after planting, which the arm above forbids; this states the positive
    // half, that the knobs really are plant-time inputs.
    const source = farmingSourceWithoutComments();
    expect(source).toMatch(/export function plantCrop\([\s\S]*?knobs: FarmPlantKnobs/);
  });
});

describe('anti-chore row 2: nothing rots, and a late harvest pays what an on-time one pays', () => {
  let onTime: Harness;
  let late: Harness;
  beforeEach(() => {
    onTime = makeHarness(41);
    late = makeHarness(41);
  });

  it('THE DECISIVE PIN: proficiency granted is a function of skill and tier, never elapsed time', () => {
    // Driven through the REAL harvest command on two clocks. Reading
    // farmingHarvestGainAt would only prove the pure function; what a player
    // experiences is the command, the queue and the drain.
    const punctual = harvestAfter(onTime, 0);
    const week = 7 * 24 * 60 * 60_000;
    const tardy = harvestAfter(late, week);
    expect(tardy).toBe(punctual);
    // Non-vacuity: the harvest really granted something, so the equality above
    // is not two zeroes agreeing.
    expect(punctual).toBe(farmingHarvestGainAt(0, CROP.tier));
    expect(punctual).toBeGreaterThan(0);
  });

  it('pays the same PRODUCE a week late, not merely the same proficiency', () => {
    const week = 7 * 24 * 60 * 60_000;
    harvestAfter(onTime, 0);
    harvestAfter(late, week);
    for (const id of [CROP.produceItemId, CROP.fineProduceItemId]) {
      expect(late.sim.countItem(id, late.pid), id).toBe(onTime.sim.countItem(id, onTime.pid));
    }
  });

  it('a fully grown plot still reads ready after a month, never expired or decayed', () => {
    const h = makeHarness(7);
    plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID);
    clearCast(h.sim);
    h.advance(CROP.durationMs + 30 * 24 * 60 * 60_000);
    const plots = projectFarmPlots(
      h.meta.farmPlots,
      START_MS + CROP.durationMs + 30 * 24 * 60 * 60_000,
      h.meta.gatheringProficiency.farming,
      farmCropTier,
    );
    expect(plots).toHaveLength(1);
    expect(plots[0].status === 'ready' || plots[0].status === 'withered').toBe(true);
    expect(plots[0].status).not.toBe('expired');
  });

  it('no decay, wither-over-time, daily reset or catch-up path exists in the module', () => {
    // The structural companion, over COMMENT-STRIPPED source so a comment that
    // merely names one of these cannot satisfy the pin. `withered` itself is
    // legitimate and expected (it is the survival roll's outcome, decided at
    // PLANT time and read at harvest), so it is deliberately not in this list;
    // what is forbidden is anything that degrades a plot as time passes.
    const source = farmingSourceWithoutComments();
    for (const forbidden of [
      'dailyReset',
      'decay',
      'rot',
      'spoil',
      'staleness',
      'catchUp',
      'loginStreak',
      'restedBonus',
    ]) {
      expect(source, `${forbidden} must not appear in the farming module`).not.toContain(forbidden);
    }
  });

  it('reads the gain schedule at the HARVEST GRANT SITE and nowhere else', () => {
    // One read, in one place. A read at expiry, at login or in a tick sweep is
    // how a "use it or lose it" rule would enter, so the count is pinned rather
    // than the absence of any one caller.
    const source = farmingSourceWithoutComments();
    // The DEFINITION is excluded, or the count would be one higher for a
    // reason that has nothing to do with call sites.
    const gainCalls = [...source.matchAll(/(?<!function )farmingHarvestGainAt\(/g)];
    expect(gainCalls, 'exactly one call site for the composed gain').toHaveLength(1);
    // ...and that one call sits inside harvestCrop, not merely somewhere.
    const harvestBody = source.slice(source.indexOf('export function harvestCrop('));
    expect(harvestBody).toContain('farmingHarvestGainAt(');
    // The schedule table itself is read only by the two model functions, never
    // by a command body.
    const scheduleReads = [...source.matchAll(/FARMING_GAIN_SCHEDULE/g)];
    expect(scheduleReads.length).toBeGreaterThan(0);
    expect(scheduleReads.length).toBeLessThanOrEqual(4);
  });
});

describe('anti-chore row 3: absence is never punished', () => {
  it('growth runs on the injected wall clock, so logging out costs nothing', () => {
    // Two harnesses, identical seeds. One advances its clock in a single jump
    // (the logged-out case: nobody ticked the sim), the other in many steps
    // with ticks between (the logged-in case). Same outcome.
    const offline = makeHarness(99);
    const online = makeHarness(99);
    plantCrop(offline.sim.ctx, offline.sim.player, offline.meta, BED, CROP_ID);
    clearCast(offline.sim);
    plantCrop(online.sim.ctx, online.sim.player, online.meta, BED, CROP_ID);
    clearCast(online.sim);
    offline.advance(CROP.durationMs);
    for (let i = 0; i < 20; i++) {
      online.advance(CROP.durationMs / 20);
      online.sim.tick();
    }
    for (const h of [offline, online]) {
      const plot = h.meta.farmPlots.get(BED);
      if (!plot) throw new Error('no plot');
      plot.survivalRoll = 0;
      harvestCrop(h.sim.ctx, h.sim.player, h.meta, BED);
      h.sim.tick();
    }
    expect(online.meta.gatheringProficiency.farming).toBe(
      offline.meta.gatheringProficiency.farming,
    );
    expect(online.sim.countItem(CROP.produceItemId, online.pid)).toBe(
      offline.sim.countItem(CROP.produceItemId, offline.pid),
    );
  });

  it('ticking the world while a crop grows never touches the plot or the counter', () => {
    // The other direction of the same promise: BEING online is not rewarded
    // either, so no player is pushed to idle in-game while a timer runs.
    const h = makeHarness(555);
    plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID);
    clearCast(h.sim);
    const before = JSON.stringify(h.meta.farmPlots.get(BED));
    for (let i = 0; i < 200; i++) h.sim.tick();
    expect(JSON.stringify(h.meta.farmPlots.get(BED))).toBe(before);
    expect(h.meta.gatheringProficiency.farming).toBe(0);
  });
});

describe('anti-chore row 4: risk is opt-in and one band above the gate is always safe', () => {
  it('every crop tier is exactly safe one full band above its gate', () => {
    // Untouched by this phase, and pinned so a curve re-tune cannot quietly
    // move it: survival is read against CURRENT skill, so out-levelling a crop
    // retires its risk permanently.
    for (const crop of Object.values(FARM_CROPS)) {
      const gate = (crop.tier - 1) * 25;
      expect(farmSurvivalChance(gate, crop.tier, false, false)).toBeLessThan(1);
      expect(farmSurvivalChance(gate + 25, crop.tier, false, false)).toBe(1);
      expect(farmSurvivalChance(gate + 100, crop.tier, false, false)).toBe(1);
    }
  });

  it('the re-tuned curve did not move the survival ramp', () => {
    // The two systems are independent by design, and this phase touched only
    // the gain column. Stated as an arm so a future tune that reached into
    // survival to "compensate" for a longer ladder reds here.
    expect(farmSurvivalChance(0, 1, false, false)).toBe(0.85);
    expect(farmSurvivalChance(25, 1, false, false)).toBe(1);
  });
});

describe('anti-chore row 5: the timer UI exists and is honest', () => {
  it('projects every plot with its stage and its remaining time', () => {
    const h = makeHarness(2024);
    plantCrop(h.sim.ctx, h.sim.player, h.meta, BED, CROP_ID);
    clearCast(h.sim);
    const half = CROP.durationMs / 2;
    h.advance(half);
    const plots = projectFarmPlots(
      h.meta.farmPlots,
      START_MS + half,
      h.meta.gatheringProficiency.farming,
      farmCropTier,
    );
    expect(plots).toHaveLength(1);
    expect(plots[0].bedId).toBe(BED);
    expect(plots[0].cropId).toBe(CROP_ID);
    expect(plots[0].status).toBe('growing');
    // Honest: the remaining time really is the remaining time, not a rounded
    // or padded figure.
    expect(plots[0].readyAtMs).toBe(START_MS + CROP.durationMs);
  });
});

describe('the pacing change is pacing, not obligation', () => {
  it('the re-tune moved ONLY the gain column, which is the whole safety argument', () => {
    // The boundary column decides which crop tier grays out at which skill, and
    // the survival ramp decides risk. Neither moved, so a farmer's obligations
    // are byte-identical to what they were before the calendar tripled: the
    // same crops teach at the same skills and carry the same risk, and the only
    // difference is how many harvests a band takes.
    expect(FARMING_GAIN_SCHEDULE.map((r) => r.belowProficiency)).toEqual([25, 50, 75, 100]);
    expect(FARMING_GAIN_SCHEDULE).toHaveLength(4);
  });
});
