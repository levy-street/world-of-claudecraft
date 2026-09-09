// Intentional Gathering PR5: the measurement-harness aggregation contract.
// This suite exercises scripts/lib/gathering_supply_scenarios.ts directly
// with synthetic fixtures. It does NOT drive a live Sim (the Sim-touching
// runner in scripts/lib/gathering_supply_runner.ts is exercised by the CLI
// against real repos, per docs/design/intentional-gathering-supply.md); its
// job is to prove the AGGREGATION/REPORTING layer is honest: no double
// counting, no credit for a refused attempt, stable units, and a fixed seed
// producing the same measurement twice.

import { describe, expect, it } from 'vitest';
import {
  annotateUnmetExpectations,
  BULK_SAMPLE_COUNT,
  distinctHarvestedItemIds,
  foldHarvestUnits,
  HARNESS_SEED,
  type HarvestUnitRecord,
  measurementIsInternallyConsistent,
  renderJsonReport,
  renderMarkdownReport,
  type ScenarioMeasurement,
  type ScenarioReport,
  unmetExpectationsFor,
} from '../scripts/lib/gathering_supply_scenarios';

function unit(
  itemId: string,
  qty: number,
  kind: HarvestUnitRecord['kind'] = 'plain',
): HarvestUnitRecord {
  return { itemId, qty, kind };
}

function baseMeasurement(overrides: Partial<ScenarioMeasurement> = {}): ScenarioMeasurement {
  return {
    scenarioId: 'test_scenario',
    family: 'corpseHarvesting',
    repoLabel: 'final',
    seed: HARNESS_SEED,
    attempts: 1,
    successfulHarvests: 1,
    deniedAttempts: 0,
    harvestedUnits: [],
    distinctUnwantedItemIds: [],
    slotsBefore: 0,
    slotsAfter: 0,
    elapsedSimSeconds: 0,
    travelSimSeconds: 0,
    castSimSeconds: 0,
    notes: [],
    ...overrides,
  };
}

describe('foldHarvestUnits: no double counting', () => {
  it('sums duplicate (itemId, kind) records rather than deduping them away', () => {
    // Two identical grants recorded (a retry bug, an event seen twice) MUST
    // sum, not collapse to one: folding is about aggregating a real ledger,
    // never masking a genuine double-record as if it were one grant.
    const folded = foldHarvestUnits([unit('rough_hide', 3), unit('rough_hide', 3)]);
    expect(folded).toEqual([unit('rough_hide', 6)]);
  });

  it('keeps distinct kinds of the same item separate', () => {
    const folded = foldHarvestUnits([
      unit('rough_hide', 3, 'plain'),
      unit('rough_hide', 1, 'signed'),
    ]);
    expect(folded).toEqual(
      expect.arrayContaining([unit('rough_hide', 3, 'plain'), unit('rough_hide', 1, 'signed')]),
    );
    expect(folded).toHaveLength(2);
  });

  it('preserves first-seen order for stable report output', () => {
    const folded = foldHarvestUnits([unit('b', 1), unit('a', 1), unit('b', 2)]);
    expect(folded.map((u) => u.itemId)).toEqual(['b', 'a']);
    expect(folded.find((u) => u.itemId === 'b')?.qty).toBe(3);
  });

  it('an empty ledger folds to an empty ledger', () => {
    expect(foldHarvestUnits([])).toEqual([]);
  });
});

describe('distinctHarvestedItemIds', () => {
  it('dedupes and sorts', () => {
    expect(
      distinctHarvestedItemIds([unit('wolf_fang', 1), unit('rough_hide', 2), unit('wolf_fang', 1)]),
    ).toEqual(['rough_hide', 'wolf_fang']);
  });
});

describe('measurementIsInternallyConsistent: refused-attempt exclusion', () => {
  it('accepts a measurement where success plus denied equals attempts', () => {
    expect(
      measurementIsInternallyConsistent(
        baseMeasurement({ attempts: 3, successfulHarvests: 1, deniedAttempts: 2 }),
      ),
    ).toBe(true);
  });

  it('rejects a measurement that silently drops or double-counts an attempt', () => {
    expect(
      measurementIsInternallyConsistent(
        baseMeasurement({ attempts: 3, successfulHarvests: 1, deniedAttempts: 1 }),
      ),
    ).toBe(false);
  });

  it('rejects negative slot counts, which can never be real inventory occupancy', () => {
    expect(measurementIsInternallyConsistent(baseMeasurement({ slotsBefore: -1 }))).toBe(false);
  });

  it('a refused attempt must never appear as harvested units: the exclusion is a caller obligation the shape check backstops', () => {
    // This test states the contract in the negative: a caller that records a
    // denial (deniedAttempts: 1) alongside a nonempty harvestedUnits list
    // has invented a grant nothing landed. measurementIsInternallyConsistent
    // does not itself inspect harvestedUnits (a denial legitimately carries
    // partial units from an EARLIER successful attempt in a multi-attempt
    // scenario), so this is pinned as a property of every scenario builder
    // in gathering_supply_runner.ts instead: a wholly-denied scenario
    // (successfulHarvests === 0) must carry an empty harvestedUnits ledger.
    const whollyDenied = baseMeasurement({
      attempts: 1,
      successfulHarvests: 0,
      deniedAttempts: 1,
      harvestedUnits: [],
    });
    expect(measurementIsInternallyConsistent(whollyDenied)).toBe(true);
    expect(whollyDenied.harvestedUnits).toEqual([]);
  });
});

describe('fixed-seed reproducibility contract', () => {
  it('HARNESS_SEED and BULK_SAMPLE_COUNT are fixed literals, not derived from wall-clock or Math.random', () => {
    expect(HARNESS_SEED).toBe(20260907);
    expect(Number.isInteger(HARNESS_SEED)).toBe(true);
    expect(BULK_SAMPLE_COUNT).toBeGreaterThan(0);
    expect(Number.isInteger(BULK_SAMPLE_COUNT)).toBe(true);
  });

  it('rendering the same report twice produces byte-identical output', () => {
    const report: ScenarioReport = {
      harnessVersion: '1.0.0',
      generatedAt: '2026-09-07T00:00:00.000Z',
      seed: HARNESS_SEED,
      repos: [{ label: 'final', path: '/repo', commit: 'abc123', dirty: false }],
      measurements: [baseMeasurement({ harvestedUnits: [unit('rough_hide', 2)] })],
    };
    expect(renderJsonReport(report)).toBe(renderJsonReport(report));
    expect(renderMarkdownReport(report)).toBe(renderMarkdownReport(report));
  });
});

describe('report rendering', () => {
  const report: ScenarioReport = {
    harnessVersion: '1.0.0',
    generatedAt: '2026-09-07T00:00:00.000Z',
    seed: HARNESS_SEED,
    repos: [
      { label: 'baseline', path: '/baseline', commit: 'aaa', dirty: false },
      { label: 'final', path: '/final', commit: 'bbb', dirty: true },
    ],
    measurements: [
      baseMeasurement({
        scenarioId: 'corpse_ordinary_interact',
        repoLabel: 'baseline',
        harvestedUnits: [unit('rough_hide', 1)],
        notes: ['ordinary interact harvested materials'],
      }),
      baseMeasurement({
        scenarioId: 'corpse_ordinary_interact',
        repoLabel: 'final',
        successfulHarvests: 0,
        deniedAttempts: 1,
        attempts: 1,
        harvestedUnits: [],
        notes: ['ordinary interact granted zero harvested units'],
      }),
      baseMeasurement({
        scenarioId: 'broken_scenario',
        repoLabel: 'final',
        attempts: 0,
        successfulHarvests: 0,
        error: 'setHarvestPreference is not a function',
      }),
    ],
  };

  it('JSON output round-trips through JSON.parse', () => {
    const parsed = JSON.parse(renderJsonReport(report));
    expect(parsed.measurements).toHaveLength(3);
    expect(parsed.seed).toBe(HARNESS_SEED);
  });

  it('Markdown output surfaces dirty-repo provenance and error rows honestly', () => {
    const md = renderMarkdownReport(report);
    expect(md).toContain('dirty');
    expect(md).toContain('YES (uncommitted changes)');
    expect(md).toContain('ERROR');
    expect(md).toContain('setHarvestPreference is not a function');
    // The baseline-vs-final asymmetry this whole PR is about must be visible
    // as two distinct rows, not folded into one "corpse harvest" line.
    expect(md.match(/corpse_ordinary_interact/g)?.length).toBe(2);
  });

  it('never claims a harvest total the fixture did not report', () => {
    const md = renderMarkdownReport(report);
    expect(md).toContain('1x rough_hide (plain)');
    expect(md).not.toContain('2x rough_hide');
  });
});

describe('unmetExpectationsFor: wrong real outcomes, not just crashes', () => {
  it('holds nothing against a scenario id no expectation applies to', () => {
    const m = baseMeasurement({ scenarioId: 'harness_bundle_or_run', family: 'harness' });
    expect(unmetExpectationsFor(m, [m])).toEqual([]);
  });

  it('flags baseline ordinary interact granting zero units as a wrong outcome', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'baseline',
      harvestedUnits: [],
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('accepts baseline ordinary interact that actually harvested something', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'baseline',
      harvestedUnits: [unit('rough_hide', 1)],
    });
    expect(unmetExpectationsFor(m, [m])).toEqual([]);
  });

  it('flags final ordinary interact granting anything as a wrong outcome', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'final',
      harvestedUnits: [unit('rough_hide', 1)],
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('accepts final ordinary interact that granted zero units', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'final',
      harvestedUnits: [],
    });
    expect(unmetExpectationsFor(m, [m])).toEqual([]);
  });

  it('flags a focused corpse harvest that leaked an unwanted material', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_intentional_focused',
      distinctUnwantedItemIds: ['wolf_fang'],
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('flags full-bag pressure that actually changed slots despite the refusal', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_full_bag_pressure',
      successfulHarvests: 0,
      deniedAttempts: 1,
      slotsBefore: 20,
      slotsAfter: 21,
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('accepts full-bag pressure with an unchanged slot count and no grant', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_full_bag_pressure',
      successfulHarvests: 0,
      deniedAttempts: 1,
      slotsBefore: 20,
      slotsAfter: 20,
      harvestedUnits: [],
    });
    expect(unmetExpectationsFor(m, [m])).toEqual([]);
  });

  it('flags a shared corpse that paid both party members', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_party_shared_supply',
      attempts: 2,
      successfulHarvests: 2,
      deniedAttempts: 0,
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('flags a shared corpse that paid neither party member', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_party_shared_supply',
      attempts: 2,
      successfulHarvests: 0,
      deniedAttempts: 2,
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('accepts a shared corpse that paid exactly the first claimant', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_party_shared_supply',
      attempts: 2,
      successfulHarvests: 1,
      deniedAttempts: 1,
    });
    expect(unmetExpectationsFor(m, [m])).toEqual([]);
  });

  it('flags a node/farm/fish scenario with zero successful actions', () => {
    const m = baseMeasurement({
      scenarioId: 'node_action_smoke_sample_ore',
      family: 'mining',
      attempts: 8,
      successfulHarvests: 0,
      deniedAttempts: 8,
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('flags ordinary interact with zero real ordinary-loot successes on either repo', () => {
    for (const repoLabel of ['baseline', 'final'] as const) {
      const m = baseMeasurement({
        scenarioId: 'corpse_ordinary_interact',
        repoLabel,
        attempts: 3,
        successfulHarvests: 0,
        deniedAttempts: 3,
        harvestedUnits: repoLabel === 'baseline' ? [unit('rough_hide', 1)] : [],
      });
      expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
    }
  });

  it('accepts ordinary interact with at least one real ordinary-loot success', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'final',
      attempts: 3,
      successfulHarvests: 1,
      deniedAttempts: 2,
      harvestedUnits: [],
    });
    expect(unmetExpectationsFor(m, [m])).toEqual([]);
  });

  it('flags the live travel-and-cast corpse scenario if it never actually succeeded', () => {
    const m = baseMeasurement({
      scenarioId: 'corpse_live_travel_and_cast',
      successfulHarvests: 0,
      deniedAttempts: 1,
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('flags recipe_required_vs_gathered when only the EARLY wolf_fang half succeeded', () => {
    // The early corpseHarvesting reagent succeeding alone must not satisfy the
    // scenario: it exercises none of the LATE farming acquisition path this
    // expectation is actually about.
    const m = baseMeasurement({
      scenarioId: 'recipe_required_vs_gathered',
      family: 'recipeEffort',
      attempts: 2,
      successfulHarvests: 1,
      deniedAttempts: 1,
      harvestedUnits: [unit('wolf_fang', 1, 'plain')],
    });
    expect(unmetExpectationsFor(m, [m]).length).toBeGreaterThan(0);
  });

  it('accepts recipe_required_vs_gathered once a real farm-kind unit was granted', () => {
    const m = baseMeasurement({
      scenarioId: 'recipe_required_vs_gathered',
      family: 'recipeEffort',
      attempts: 2,
      successfulHarvests: 2,
      deniedAttempts: 0,
      harvestedUnits: [unit('wolf_fang', 1, 'plain'), unit('evergarden_greens', 9, 'farm')],
    });
    expect(unmetExpectationsFor(m, [m])).toEqual([]);
  });
});

describe('annotateUnmetExpectations: the report stays whole, only wrong outcomes gain an error', () => {
  it('leaves a fully-passing report byte-identical (same measurement references)', () => {
    const passing = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'final',
      harvestedUnits: [],
    });
    const report: ScenarioReport = {
      harnessVersion: '1.1.0',
      generatedAt: '2026-09-07T00:00:00.000Z',
      seed: HARNESS_SEED,
      repos: [{ label: 'final', path: '/repo', commit: 'abc', dirty: false }],
      measurements: [passing],
    };
    const annotated = annotateUnmetExpectations(report);
    expect(annotated.measurements[0]).toBe(passing);
    expect(annotated.measurements[0].error).toBeUndefined();
  });

  it('appends an unmet-expectation error to a measurement that ran clean but measured the wrong outcome', () => {
    const wrong = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'final',
      harvestedUnits: [unit('rough_hide', 1)],
    });
    const report: ScenarioReport = {
      harnessVersion: '1.1.0',
      generatedAt: '2026-09-07T00:00:00.000Z',
      seed: HARNESS_SEED,
      repos: [{ label: 'final', path: '/repo', commit: 'abc', dirty: false }],
      measurements: [wrong],
    };
    const annotated = annotateUnmetExpectations(report);
    expect(annotated.measurements[0].error).toBeDefined();
    expect(annotated.measurements[0].error).toContain('unmet scenario expectation');
    // The report is preserved whole: the real measured units are still there,
    // never replaced or dropped by the annotation.
    expect(annotated.measurements[0].harvestedUnits).toEqual([unit('rough_hide', 1)]);
  });

  it('appends to, rather than overwrites, an existing harness-level error', () => {
    const both = baseMeasurement({
      scenarioId: 'corpse_ordinary_interact',
      repoLabel: 'final',
      harvestedUnits: [unit('rough_hide', 1)],
      error: 'some harness exception',
    });
    const report: ScenarioReport = {
      harnessVersion: '1.1.0',
      generatedAt: '2026-09-07T00:00:00.000Z',
      seed: HARNESS_SEED,
      repos: [{ label: 'final', path: '/repo', commit: 'abc', dirty: false }],
      measurements: [both],
    };
    const annotated = annotateUnmetExpectations(report);
    expect(annotated.measurements[0].error).toContain('some harness exception');
    expect(annotated.measurements[0].error).toContain('unmet scenario expectation');
  });
});
