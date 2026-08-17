import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildHitchFixtureRows, soakCosmeticInputs } from '../scripts/lib/perf_hitch_scenarios.mjs';
import * as soakModule from '../scripts/lib/perf_hitch_soak.mjs';
import {
  buildSoakChurnPlan,
  estimateHeapFloorGrowthMb,
  executeSoakChurnPlan,
  HITCH_SOAK_COHORTS,
  HITCH_SOAK_INSIDE_RADIUS,
  HITCH_SOAK_INTERVAL_MS,
  HITCH_SOAK_OUTSIDE_RADIUS,
  HITCH_SOAK_SEED,
  resolveSoakAppearance,
} from '../scripts/lib/perf_hitch_soak.mjs';

const BOT_COUNT = 36;
const MEASURE_MS = 600_000;
// The real fixture-derived cosmetic dimensions: ragged WEAPON_SKINS lists
// (bow 3 server-valid skins, every other type 4), 5 mounts, 8 body skins.
const COSMETICS = soakCosmeticInputs(buildHitchFixtureRows());
const makePlan = (overrides = {}) =>
  buildSoakChurnPlan({ botCount: BOT_COUNT, measureMs: MEASURE_MS, ...COSMETICS, ...overrides });

describe('deterministic hitch soak churn', () => {
  it('fits retained growth across every GC-floor valley', () => {
    const valleys = Array.from({ length: 141 }, (_, index) => ({
      atMs: (index * MEASURE_MS) / 140,
      floorMb: 100 + (index * 40) / 140,
    }));

    expect(estimateHeapFloorGrowthMb(valleys)).toBe(40);
  });

  it('resists the boundary outlier shape that inflated growth to 130.18 MB', () => {
    const valleys = Array.from({ length: 141 }, (_, index) => ({
      atMs: (index * MEASURE_MS) / 140,
      floorMb: 100 + (index * 40) / 140,
    }));
    valleys[0].floorMb = 9.82;

    expect(valleys.at(-1).floorMb - valleys[0].floorMb).toBe(130.18);
    expect(estimateHeapFloorGrowthMb(valleys)).toBe(43.78);
  });

  it('fails closed on incomplete or malformed GC-floor evidence', () => {
    expect(estimateHeapFloorGrowthMb([])).toBeNull();
    expect(estimateHeapFloorGrowthMb([{ atMs: 0, floorMb: 100 }])).toBeNull();
    expect(
      estimateHeapFloorGrowthMb([
        { atMs: 0, floorMb: 100 },
        { atMs: 0, floorMb: 101 },
      ]),
    ).toBeNull();
    expect(
      estimateHeapFloorGrowthMb([
        { atMs: 0, floorMb: 100 },
        { atMs: 1000, floorMb: Number.NaN },
      ]),
    ).toBeNull();
  });

  it('pins the frozen workload literals', () => {
    expect(HITCH_SOAK_SEED).toBe(0x5eed0b);
    expect(HITCH_SOAK_COHORTS).toBe(3);
    expect(HITCH_SOAK_INTERVAL_MS).toBe(10_000);
    expect(HITCH_SOAK_INSIDE_RADIUS).toBe(10);
    expect(HITCH_SOAK_OUTSIDE_RADIUS).toBe(240);
  });

  it('builds the same fixed-seed ten-minute schedule every time', () => {
    const first = makePlan();
    const second = makePlan();

    expect(first).toEqual(second);
    expect(first.seed).toBe(HITCH_SOAK_SEED);
    expect(first.steps).toHaveLength(60);
    expect(first.steps.map((step) => step.atMs)).toEqual(
      Array.from({ length: 60 }, (_, index) => index * HITCH_SOAK_INTERVAL_MS),
    );
    expect(makePlan({ seed: 1 })).not.toEqual(first);
  });

  it('fails closed when the fixture weapon wiring is missing or incomplete', () => {
    expect(() => buildSoakChurnPlan({ botCount: BOT_COUNT, measureMs: MEASURE_MS })).toThrow(
      /botWeaponTypes/,
    );
    expect(() => makePlan({ botWeaponTypes: ['staff'] })).toThrow(/botWeaponTypes/);
    expect(() =>
      buildSoakChurnPlan({
        botCount: 3,
        measureMs: 30_000,
        botWeaponTypes: ['bow', 'sword', 'bow'],
        weaponVariantCounts: { bow: 3 },
      }),
    ).toThrow(/weaponVariantCounts\.sword/);
    expect(() =>
      buildSoakChurnPlan({
        botCount: 3,
        measureMs: 30_000,
        botWeaponTypes: ['bow', undefined, 'bow'],
        weaponVariantCounts: { bow: 3 },
      }),
    ).toThrow(/bot 1 is missing a weapon type/);
  });

  it('rotates all three cohorts through the fixed 24-player interest crowd', () => {
    const plan = makePlan();
    const cohortSize = BOT_COUNT / HITCH_SOAK_COHORTS;
    const visible = new Set(plan.initialVisibleBotIndexes);
    const incomingCounts = Array(BOT_COUNT).fill(0);
    const outgoingCounts = Array(BOT_COUNT).fill(0);

    expect(visible.size).toBe(BOT_COUNT - cohortSize);
    for (const step of plan.steps) {
      expect(step.incoming).toHaveLength(cohortSize);
      expect(step.outgoingBotIndexes).toHaveLength(cohortSize);
      expect(new Set(step.incoming.map((entry) => entry.botIndex)).size).toBe(cohortSize);
      expect(step.incoming.some((entry) => step.outgoingBotIndexes.includes(entry.botIndex))).toBe(
        false,
      );
      for (const botIndex of step.outgoingBotIndexes) {
        visible.delete(botIndex);
        outgoingCounts[botIndex] += 1;
      }
      for (const entry of step.incoming) {
        visible.add(entry.botIndex);
        incomingCounts[entry.botIndex] += 1;
      }
      expect([...visible].sort((a, b) => a - b)).toEqual(step.visibleBotIndexes);
      expect(visible.size).toBe(BOT_COUNT - cohortSize);
    }

    expect(new Set(incomingCounts)).toEqual(new Set([20]));
    expect(new Set(outgoingCounts)).toEqual(new Set([20]));
  });

  it('visits all 460 reachable ragged-space cosmetic combinations with no per-bot repeats', () => {
    // Coverage re-derived from the REAL fixture lists and the 36-bot roster
    // (crowd bots 0..23 cycle the 9 classes, churn bots 24..35 are all druid).
    // Per weapon type: unique = min(bots * 20 appearance rounds, 8 skins *
    // variants * 5 mounts):
    //   sword   3 bots * 20 =  60 of 8*4*5 = 160 ->  60
    //   mace    6 bots * 20 = 120 of 160         -> 120
    //   bow     3 bots * 20 =  60 of 8*3*5 = 120 ->  60 (ragged 3-skin list)
    //   dagger  3 bots * 20 =  60 of 160         ->  60
    //   staff  21 bots * 20 = 420 of 160         -> 160 (full space)
    //   total                                       460
    const plan = makePlan();
    const key = (entry) =>
      `${entry.weaponType}:${entry.skin}:${entry.weaponVariant}:${entry.mountVariant}`;
    const allAppearances = plan.steps.flatMap((step) => step.incoming);
    const botsPerType = new Map();
    for (const weaponType of COSMETICS.botWeaponTypes) {
      botsPerType.set(weaponType, (botsPerType.get(weaponType) ?? 0) + 1);
    }
    const expectedUnique = [...botsPerType.entries()].reduce(
      (sum, [weaponType, bots]) =>
        sum +
        Math.min(
          bots * plan.appearanceRoundCount,
          8 * COSMETICS.weaponVariantCounts[weaponType] * COSMETICS.mountVariantCount,
        ),
      0,
    );

    expect(botsPerType).toEqual(
      new Map([
        ['sword', 3],
        ['mace', 6],
        ['bow', 3],
        ['dagger', 3],
        ['staff', 21],
      ]),
    );
    expect(expectedUnique).toBe(460);
    expect(allAppearances).toHaveLength(720);
    expect(new Set(allAppearances.map(key)).size).toBe(460);
    expect(plan.uniqueCombinationCount).toBe(460);

    const perType = new Map();
    for (const entry of allAppearances) {
      expect(entry.weaponType).toBe(COSMETICS.botWeaponTypes[entry.botIndex]);
      expect(entry.weaponVariant).toBeLessThan(COSMETICS.weaponVariantCounts[entry.weaponType]);
      let record = perType.get(entry.weaponType);
      if (!record) {
        record = { combos: new Set(), skins: new Set(), variants: new Set(), mounts: new Set() };
        perType.set(entry.weaponType, record);
      }
      record.combos.add(key(entry));
      record.skins.add(entry.skin);
      record.variants.add(entry.weaponVariant);
      record.mounts.add(entry.mountVariant);
    }
    for (const [weaponType, record] of perType) {
      expect(record.skins).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
      expect(record.mounts).toEqual(new Set([0, 1, 2, 3, 4]));
      expect(record.variants).toEqual(
        new Set(
          Array.from({ length: COSMETICS.weaponVariantCounts[weaponType] }, (_, index) => index),
        ),
      );
    }
    expect(perType.get('bow').variants).toEqual(new Set([0, 1, 2]));
    expect(perType.get('staff').combos.size).toBe(160);
    expect(perType.get('mace').combos.size).toBe(120);
    expect(perType.get('sword').combos.size).toBe(60);
    expect(perType.get('bow').combos.size).toBe(60);
    expect(perType.get('dagger').combos.size).toBe(60);

    for (let botIndex = 0; botIndex < BOT_COUNT; botIndex += 1) {
      const appearances = allAppearances.filter((entry) => entry.botIndex === botIndex);
      expect(appearances).toHaveLength(20);
      expect(new Set(appearances.map(key)).size).toBe(20);
    }
  });

  it('keeps the full schedule active through the final three cohort entries', () => {
    const plan = makePlan();
    expect(plan.appearanceRoundCount).toBe(20);
    expect(plan.steps.slice(-3).map((step) => step.atMs)).toEqual([570_000, 580_000, 590_000]);
    expect(plan.steps.slice(-3).every((step) => step.incoming.length === 12)).toBe(true);
  });

  it('executes every timed exit before its matching cosmetic re-entry', async () => {
    const plan = buildSoakChurnPlan({
      botCount: 6,
      measureMs: 30_000,
      botWeaponTypes: ['sword', 'bow', 'staff', 'bow', 'staff', 'sword'],
      weaponVariantCounts: { sword: 4, bow: 3, staff: 4 },
    });
    let clock = 50;
    const events = [];

    await executeSoakChurnPlan(plan, {
      now: () => clock,
      wait: async (delayMs) => {
        events.push(['wait', delayMs]);
        clock += delayMs;
      },
      moveOutside: (botIndex) => events.push(['out', botIndex]),
      applyIncoming: (entry) => events.push(['in', entry.botIndex, entry.skin]),
    });

    const expected = [];
    for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex += 1) {
      const step = plan.steps[stepIndex];
      if (stepIndex > 0) expected.push(['wait', 10_000]);
      for (const botIndex of step.outgoingBotIndexes) expected.push(['out', botIndex]);
      for (const entry of step.incoming) expected.push(['in', entry.botIndex, entry.skin]);
    }
    expect(events).toEqual(expected);
  });

  it('maps a scheduled appearance to concrete weapon and mount cosmetics', () => {
    expect(
      resolveSoakAppearance(
        { botIndex: 4, weaponType: 'staff', skin: 7, weaponVariant: 1, mountVariant: 2 },
        'staff',
        { staff: ['staff-a', 'staff-b'] },
        ['mount-a', 'mount-b', 'mount-c'],
      ),
    ).toEqual({ skin: 7, weaponSkin: 'staff-b', mountItem: 'mount-c' });
    expect(() =>
      resolveSoakAppearance(
        { botIndex: 4, weaponType: 'staff', skin: 7, weaponVariant: 9, mountVariant: 2 },
        'staff',
        { staff: ['staff-a'] },
        ['mount-a', 'mount-b', 'mount-c'],
      ),
    ).toThrow(/cosmetic rotation.*bot 4/i);
    expect(() =>
      resolveSoakAppearance(
        { botIndex: 2, weaponType: 'bow', skin: 1, weaponVariant: 0, mountVariant: 0 },
        'staff',
        { staff: ['staff-a'], bow: ['bow-a'] },
        ['mount-a'],
      ),
    ).toThrow(/planned bow cosmetics for bot 2 holding staff/);
  });

  it('declares every runtime export in the hand-written .d.mts', () => {
    // The tests/market_filler_listings.test.ts pattern: anchored at line start
    // so a commented-out declaration cannot match, compared as a sorted set so
    // the sweep runs both ways and a stale declaration fails too.
    const dts = readFileSync(
      new URL('../scripts/lib/perf_hitch_soak.d.mts', import.meta.url),
      'utf8',
    );
    const declared = [...dts.matchAll(/^export (?:declare )?(?:function|const) (\w+)/gm)]
      .map((match) => match[1])
      .sort();
    expect(declared).toEqual(Object.keys(soakModule).sort());
  });
});
