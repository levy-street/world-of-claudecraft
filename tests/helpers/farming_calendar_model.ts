// The farming calendar model: how many real-world days a farmer spends on each
// 25-point band of the farming ladder, DERIVED from shipped content rather than
// felt.
//
// WHY THIS EXISTS. masterwrought R19 forbids tuning a gathering curve from feel
// and requires a measured calendar model instead. FARMING_GAIN_SCHEDULE's four
// gain literals are the OUTPUT of this model, so the model is the deliverable
// and the literals are its result. tests/professions_farming.test.ts imports
// this and asserts the shipped schedule is what the model produces, which is
// what stops the doc and the code drifting.
//
// EVERY INPUT IS READ FROM THE TREE. Nothing here restates a number that lives
// somewhere else: bed counts come from FARM_PATCHES, gates from
// farmCropSkillThreshold, ceilings from farmingTeachingCeilingFor (which reads
// the schedule's own boundary column), and survival from farmSurvivalChance.
// A change to any of those moves the model, which is the point.
//
// THE ONE ASSUMPTION is the REFERENCE FARMER (masterwrought DECISION A, settled
// 2026-08-20), and it is a parameter rather than a constant so the maximum
// dedication floor is the same function with different arguments. See
// REFERENCE_FARMER below.
//
// This is a test-tree helper on purpose: it is a derivation and a guard, never
// runtime game logic, so it must not ship in the client bundle.

import { FARM_CROPS, farmCropSkillThreshold } from '../../src/sim/content/farm_crops';
import { FARM_PATCHES } from '../../src/sim/content/farm_patches';
import { farmSurvivalChance } from '../../src/sim/professions/farm_projection';
import {
  FARMING_GAIN_SCHEDULE,
  farmingTeachingCeilingFor,
} from '../../src/sim/professions/farming';

/** A farmer's habits: the only free inputs the model has. */
export interface FarmerProfile {
  /** Check-ins per real-world day. Each check-in harvests every ready bed and
   *  replants it, so a bed yields this many attempts a day PROVIDED the gap
   *  between check-ins clears the crop's growth time. That proviso IS asserted,
   *  in tests/professions_farming.test.ts ("holds the reference farmer's
   *  premise: a visit gap clears the longest crop"), against the real
   *  durationMs literals. It was NOT until the Phase 11e QA: this comment
   *  claimed the pin for months while none existed, and in the interval Phase
   *  11e shipped evergarden_pumpkin at 10.75 hours against a doc that recorded
   *  the longest crop as 10.5, with nothing to notice. */
  readonly visitsPerDay: number;
  /** Whether the farmer works every bed in the world, or only the beds at the
   *  hubs whose crop tier still TEACHES at their current skill. The reference
   *  farmer does the latter; maximum dedication does the former. */
  readonly worksEveryBed: boolean;
}

/** masterwrought DECISION A's subject, settled 2026-08-20: a morning-and-evening
 *  rhythm, working the hubs whose crops still teach. This is what the shipped
 *  gain curve is tuned against. */
export const REFERENCE_FARMER: FarmerProfile = Object.freeze({
  visitsPerDay: 2,
  worksEveryBed: false,
});

/** The other end of DECISION A's envelope: every bed in the world, same rhythm.
 *  A FLOOR to record, never a target to design against. */
export const MAXIMUM_DEDICATION: FarmerProfile = Object.freeze({
  visitsPerDay: 2,
  worksEveryBed: true,
});

export interface BandRow {
  /** Inclusive lower bound of the 25-point band. */
  readonly from: number;
  /** Exclusive upper bound. */
  readonly to: number;
  /** The crop tiers that still grant proficiency anywhere in this band: gated
   *  at or below the band floor, and teaching past it. */
  readonly teachingTiers: readonly number[];
  /** Beds the farmer works in this band, by patch id. */
  readonly bedsByPatch: ReadonlyMap<string, number>;
  /** Total beds worked. */
  readonly beds: number;
  /** Plant-and-harvest attempts per day: beds times visits. */
  readonly attemptsPerDay: number;
  /** Attempts that survive to pay proficiency. A withered harvest grants none
   *  (harvestCrop's failure arm), so survival multiplies the grant rate. */
  readonly grantsPerDay: number;
  /** Mean survival across the beds worked, bed-weighted. */
  readonly meanSurvival: number;
  /** The schedule gain that applies inside this band. */
  readonly gain: number;
  /** Successful harvests needed to cross the band: width / gain. */
  readonly harvests: number;
  /** Real-world days the band takes: harvests / grantsPerDay. */
  readonly days: number;
}

export interface CalendarModel {
  readonly bands: readonly BandRow[];
  readonly totalHarvests: number;
  readonly totalDays: number;
  /** Days to reach skill 50, the front half of the ladder. The shipped curve's
   *  defect was that this was about a tenth of the calendar. */
  readonly daysToFifty: number;
}

/** The band boundaries, read off the schedule's own belowProficiency column so
 *  the model cannot disagree with the table it is tuning. */
export function scheduleBands(
  schedule: typeof FARMING_GAIN_SCHEDULE = FARMING_GAIN_SCHEDULE,
): ReadonlyArray<{ from: number; to: number; gain: number }> {
  const out: Array<{ from: number; to: number; gain: number }> = [];
  let from = 0;
  for (const row of schedule) {
    out.push({ from, to: row.belowProficiency, gain: row.gain });
    from = row.belowProficiency;
  }
  return out;
}

/** Which crop tiers teach anywhere inside [from, to): planted at the band floor
 *  (gate at or below it) and not yet grayed out there (ceiling above it). */
export function teachingTiersAt(from: number): readonly number[] {
  const tiers = [...new Set(Object.values(FARM_CROPS).map((c) => c.tier))].sort((a, b) => a - b);
  return tiers.filter(
    (tier) => farmCropSkillThreshold(tier) <= from && farmingTeachingCeilingFor(tier) > from,
  );
}

/** Survival for a crop of this tier at one skill point, with no compost and no
 *  watch: the plain reference farmer buys neither, so the model never credits
 *  itself a bonus a farmer would have to pay for. */
export function survivalAt(tier: number, skill: number): number {
  return farmSurvivalChance(skill, tier, false, false);
}

/** Beds per patch tier, measured off FARM_PATCHES. */
export function bedsByTier(): ReadonlyMap<number, { patchId: string; beds: number }> {
  const out = new Map<number, { patchId: string; beds: number }>();
  for (const patch of FARM_PATCHES)
    out.set(patch.tier, { patchId: patch.id, beds: patch.beds.length });
  return out;
}

/**
 * Run the model for one farmer profile.
 *
 * THE ARITHMETIC, stated so a reader can redo it by hand. At skill s the farmer
 * gets G(s) = visitsPerDay * SUM over worked beds of survival(tier of that bed,
 * s) successful harvests a day, because a withered harvest grants nothing.
 * One grant advances skill by `gain`, so the time to take one step is 1/G(s)
 * days and the band costs SUM over its steps of 1/G(s_i), with
 * s_i = from + i*gain. That is the exact expectation (linearity over the
 * independent per-attempt waits), not a mean-survival approximation: averaging
 * survival first and dividing once understates the cost, because 1/E[p] is
 * below E[1/p].
 *
 * A STATED ASSUMPTION, because plantCrop gate 12 enforces it: the farmer's HOE
 * keeps pace with the crop tier they plant. The hoe ladder is engineering-gated
 * (farming D10), so a farmer whose hoe lags plants a lower tier and the band
 * runs longer. The model takes the hoe as kept up; it is not free, and it is
 * the one input here that is a habit rather than a table.
 */
export function farmingCalendar(
  farmer: FarmerProfile = REFERENCE_FARMER,
  schedule: typeof FARMING_GAIN_SCHEDULE = FARMING_GAIN_SCHEDULE,
): CalendarModel {
  const patches = bedsByTier();
  const bands: BandRow[] = [];
  for (const band of scheduleBands(schedule)) {
    const teachingTiers = teachingTiersAt(band.from);
    // Which beds are worked, and what grows in each. The reference farmer walks
    // the hubs whose own tier still teaches and grows that hub's tier. The
    // maximum-dedication farmer works every bed in the world and grows the
    // teaching tier that survives best at the current skill, since there is no
    // bed-tier gate and survival is what limits the grant rate.
    const workedTiers = farmer.worksEveryBed
      ? [...patches.keys()].sort((a, b) => a - b)
      : teachingTiers;
    const bedsByPatch = new Map<string, number>();
    const worked: Array<{ beds: number; tierAt: (skill: number) => number }> = [];
    let beds = 0;
    for (const tier of workedTiers) {
      const patch = patches.get(tier);
      if (!patch) continue;
      bedsByPatch.set(patch.patchId, patch.beds);
      beds += patch.beds;
      const tierAt = farmer.worksEveryBed
        ? (skill: number) =>
            teachingTiers.reduce((best, t) =>
              survivalAt(t, skill) > survivalAt(best, skill) ? t : best,
            )
        : () => tier;
      worked.push({ beds: patch.beds, tierAt });
    }
    const grantsPerDayAt = (skill: number) =>
      farmer.visitsPerDay *
      worked.reduce((sum, w) => sum + w.beds * survivalAt(w.tierAt(skill), skill), 0);

    const harvests = (band.to - band.from) / band.gain;
    let days = 0;
    let survivalSum = 0;
    for (let i = 0; i < harvests; i++) {
      const skill = band.from + i * band.gain;
      days += 1 / grantsPerDayAt(skill);
      survivalSum +=
        worked.reduce((sum, w) => sum + w.beds * survivalAt(w.tierAt(skill), skill), 0) / beds;
    }
    const meanSurvival = survivalSum / harvests;
    const attemptsPerDay = beds * farmer.visitsPerDay;
    bands.push({
      from: band.from,
      to: band.to,
      teachingTiers,
      bedsByPatch,
      beds,
      attemptsPerDay,
      grantsPerDay: attemptsPerDay * meanSurvival,
      meanSurvival,
      gain: band.gain,
      harvests,
      days,
    });
  }
  const totalHarvests = bands.reduce((s, b) => s + b.harvests, 0);
  const totalDays = bands.reduce((s, b) => s + b.days, 0);
  const daysToFifty = bands.filter((b) => b.to <= 50).reduce((s, b) => s + b.days, 0);
  return { bands, totalHarvests, totalDays, daysToFifty };
}

/** The largest power of two the dyadic test will scale by. This bound is the
 *  whole point of the test and not an implementation detail: EVERY finite
 *  double is already a dyadic rational, so an unbounded search returns true for
 *  0.1 as readily as for 0.25 and pins nothing. A gain worth writing as a
 *  decimal literal is a SHORT dyadic, a handful of binary places, and 20 is far
 *  above the five places the shipped ladder needs while still far below the 52
 *  where representation error makes everything look exact. */
const DYADIC_PLACES = 20;

/** Whether `value` is exactly the short dyadic rational it appears to be, so
 *  repeated addition of it cannot drift.
 *
 *  Grants accumulate by plain float addition in applyGrantClamped with no
 *  rounding anywhere, so a gain that is not a short dyadic misses its band
 *  boundary: the shipped 0.1 landed on 74.99999999999957 after its nominal 250
 *  harvests and charged a 251st. The derivation test proves both directions
 *  live rather than trusting this predicate. */
export function isDyadic(value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  for (let places = 0; places <= DYADIC_PLACES; places++) {
    const scaled = value * 2 ** places;
    if (Number.isInteger(scaled) && scaled / 2 ** places === value) return true;
  }
  return false;
}

/** Accumulate `gain` onto `start` exactly `times` times the way
 *  applyGrantClamped does: plain float addition, no rounding. Returns the
 *  landing value so a test can assert strict equality with the boundary. */
export function accumulateGain(start: number, gain: number, times: number): number {
  let value = start;
  for (let i = 0; i < times; i++) value += gain;
  return value;
}

/** How many harvests it actually takes to CROSS a boundary, which is one more
 *  than the nominal count whenever the gain is not dyadic. */
export function harvestsToCross(start: number, gain: number, target: number): number {
  let value = start;
  let n = 0;
  while (value < target && n < 1_000_000) {
    value += gain;
    n++;
  }
  return n;
}
