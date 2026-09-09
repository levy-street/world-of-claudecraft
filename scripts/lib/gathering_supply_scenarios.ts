// Intentional Gathering PR5: the pure (no Sim import) half of the supply
// measurement harness. Owns the scenario catalog, the measurement shape, and
// the aggregation/formatting functions the CLI (scripts/gathering_supply_report.mjs)
// and the Sim-touching runner (gathering_supply_runner.ts) both consume.
//
// PURE in the sense that matters here: no SimContext, no rng, no clock, no
// repo-specific import. Every function is a plain data transform, which is
// what lets tests/gathering_supply_measurement.test.ts exercise aggregation,
// no-double-counting, and formatting directly with synthetic fixtures rather
// than through a live Sim.
//
// A fixed seed is a REPRODUCIBILITY contract, not a balance statement: this
// harness never asserts that a particular seed's yield is "the" yield, only
// that the same seed against the same code produces the same measurement.

/** One granted item stack, as it actually landed (never a planned/rolled
 *  quantity that was later denied or downgraded). */
export interface HarvestUnitRecord {
  readonly itemId: string;
  readonly qty: number;
  readonly kind: 'plain' | 'signed' | 'specimen' | 'node' | 'farm' | 'fish';
}

/** One scenario's raw measurement. `notes` records anything the reader needs
 *  to interpret the numbers honestly: fixture labels, denial reasons, a
 *  caught exception from an API surface the target repo does not have. */
export interface ScenarioMeasurement {
  readonly scenarioId: string;
  readonly family: string;
  readonly repoLabel: 'baseline' | 'final';
  readonly seed: number;
  readonly attempts: number;
  readonly successfulHarvests: number;
  readonly deniedAttempts: number;
  readonly harvestedUnits: readonly HarvestUnitRecord[];
  readonly distinctUnwantedItemIds: readonly string[];
  readonly slotsBefore: number;
  readonly slotsAfter: number;
  readonly elapsedSimSeconds: number;
  readonly travelSimSeconds: number;
  readonly castSimSeconds: number;
  readonly notes: readonly string[];
  readonly error?: string;
}

export interface RepoProvenance {
  readonly label: 'baseline' | 'final';
  readonly path: string;
  readonly commit: string;
  readonly dirty: boolean;
}

export interface ScenarioReport {
  readonly harnessVersion: string;
  readonly generatedAt: string;
  readonly seed: number;
  readonly repos: readonly RepoProvenance[];
  readonly measurements: readonly ScenarioMeasurement[];
}

/** The one fixed seed this harness runs every seeded scenario at, so a rerun
 *  against unchanged code reproduces the exact same measurement. Bulk
 *  sampling scenarios derive their per-sample seeds from this by simple
 *  offset (SEED + i), never a fresh Math.random-style seed. */
export const HARNESS_SEED = 20260907;

/** How many fresh Sims a bulk yield-sampling scenario mints. Small on
 *  purpose: this is a feature-validation harness, not a balance study. */
export const BULK_SAMPLE_COUNT = 8;

export const HARNESS_VERSION = '1.2.0';

/** Fold same-(itemId,kind) records into one summed entry, in first-seen
 *  order. This is the ONE place "did we double count a grant" is answered:
 *  a caller that records the same landed grant twice (a retry bug, an event
 *  observed on two ticks) is masked by nothing here, because folding SUMS
 *  duplicates rather than deduping them to a single unit; a test asserting a
 *  known total after two identical records catches that directly. */
export function foldHarvestUnits(
  records: readonly HarvestUnitRecord[],
): readonly HarvestUnitRecord[] {
  const order: string[] = [];
  const byKey = new Map<string, HarvestUnitRecord>();
  for (const record of records) {
    const key = `${record.itemId}\u0000${record.kind}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...existing, qty: existing.qty + record.qty });
    } else {
      order.push(key);
      byKey.set(key, { ...record });
    }
  }
  return order.map((key) => byKey.get(key) as HarvestUnitRecord);
}

/** Total granted units across every record, after folding. */
export function totalHarvestedUnits(records: readonly HarvestUnitRecord[]): number {
  return foldHarvestUnits(records).reduce((sum, r) => sum + r.qty, 0);
}

/** Distinct item ids across every record, sorted for stable output. */
export function distinctHarvestedItemIds(records: readonly HarvestUnitRecord[]): string[] {
  return [...new Set(records.map((r) => r.itemId))].sort();
}

/** A refused attempt contributes NOTHING to the harvested-unit ledger: this
 *  is the shape check tests/gathering_supply_measurement.test.ts pins for
 *  "refused harvest exclusion". Callers build ScenarioMeasurement directly,
 *  so this helper only documents the contract for the measurement layer:
 *  successfulHarvests + deniedAttempts must equal attempts, and a denial
 *  never appears in harvestedUnits.
 */
export function measurementIsInternallyConsistent(m: ScenarioMeasurement): boolean {
  if (m.successfulHarvests + m.deniedAttempts !== m.attempts) return false;
  if (m.slotsAfter < 0 || m.slotsBefore < 0) return false;
  return true;
}

const NODE_FARM_FISH_FAMILIES: readonly string[] = [
  'mining',
  'logging',
  'herbalism',
  'farming',
  'fishing',
];

/** One EXPECTATION about a real-world outcome, checked against the finished
 *  measurement set. This is a SECOND, independent thing from `error`: a
 *  scenario can run to completion with no harness exception (no `error`)
 *  and still measure the WRONG real outcome (final ordinary interact
 *  granting materials it must never grant, a full-bag attempt that actually
 *  changed slots, a shared corpse paying two party members). `error` alone
 *  cannot catch that, which is why a green exit code used to mean nothing
 *  more than "no exception was thrown." `appliesTo` scopes which
 *  measurement(s) a check is even about (by scenario id and, where the two
 *  trees are expected to differ, by repoLabel too); `holds` is the real
 *  predicate, given the whole measurement set for the checks that compare
 *  across two rows.
 */
export interface ScenarioExpectation {
  readonly description: string;
  readonly appliesTo: (m: ScenarioMeasurement) => boolean;
  readonly holds: (m: ScenarioMeasurement, all: readonly ScenarioMeasurement[]) => boolean;
}

/** The fixed set of real-outcome expectations this harness checks. Extend
 *  this list, never re-derive it ad hoc in the CLI: `annotateUnmetExpectations`
 *  is the ONLY place a wrong outcome becomes an `error`. */
export const SCENARIO_EXPECTATIONS: readonly ScenarioExpectation[] = [
  {
    description:
      'baseline ordinary interact must harvest materials (the pre-Field-Kit "unified F" behavior)',
    appliesTo: (m) => m.scenarioId === 'corpse_ordinary_interact' && m.repoLabel === 'baseline',
    holds: (m) => totalHarvestedUnits(m.harvestedUnits) > 0,
  },
  {
    description: 'final ordinary interact must grant zero harvested units',
    appliesTo: (m) => m.scenarioId === 'corpse_ordinary_interact' && m.repoLabel === 'final',
    holds: (m) => totalHarvestedUnits(m.harvestedUnits) === 0,
  },
  {
    description:
      'ordinary interact must record at least one real ordinary-loot success, on both repos: `successfulHarvests` on this scenario is the ordinary-loot ledger, separate from the (expectedly zero on final) gather ledger above, so a run with zero ordinary-loot successes is a harness/fixture defect, never a valid measurement',
    appliesTo: (m) => m.scenarioId === 'corpse_ordinary_interact',
    holds: (m) => m.successfulHarvests > 0,
  },
  {
    description:
      'a deliberate corpse harvest (All materials, focused, or the live travel-and-cast example) must actually succeed',
    appliesTo: (m) =>
      m.scenarioId === 'corpse_intentional_all' ||
      m.scenarioId === 'corpse_intentional_focused' ||
      m.scenarioId === 'corpse_live_travel_and_cast',
    holds: (m) => m.successfulHarvests > 0,
  },
  {
    description: 'a focused corpse harvest must never grant a material outside the focused family',
    appliesTo: (m) => m.scenarioId === 'corpse_intentional_focused',
    holds: (m) => m.distinctUnwantedItemIds.length === 0,
  },
  {
    description:
      'full-bag pressure must deny the harvest for the real bag-capacity ceiling: no grant, no slot change',
    appliesTo: (m) => m.scenarioId === 'corpse_full_bag_pressure',
    holds: (m) =>
      m.successfulHarvests === 0 && m.slotsBefore === m.slotsAfter && m.harvestedUnits.length === 0,
  },
  {
    description:
      'a shared corpse must pay at most one party member and at least the first claimant (exactly one success out of two attempts)',
    appliesTo: (m) => m.scenarioId === 'corpse_party_shared_supply',
    holds: (m) => m.successfulHarvests === 1,
  },
  {
    description: 'every node, farm, and fish scenario must record at least one successful action',
    appliesTo: (m) => NODE_FARM_FISH_FAMILIES.includes(m.family),
    holds: (m) => m.successfulHarvests > 0,
  },
  {
    description:
      'recipe_required_vs_gathered must record at least one real farm-kind granted unit (the LATE, fine_evergarden_greens reagent): the EARLY wolf_fang corpse-harvest half succeeding alone is not sufficient, since it exercises none of the late farming acquisition path',
    appliesTo: (m) => m.scenarioId === 'recipe_required_vs_gathered',
    holds: (m) => m.harvestedUnits.some((u) => u.kind === 'farm' && u.qty > 0),
  },
];

/** Every `SCENARIO_EXPECTATIONS` description that applies to `measurement`
 *  and does not hold, in declaration order. Empty means every expectation
 *  that applies to this one measurement held. */
export function unmetExpectationsFor(
  measurement: ScenarioMeasurement,
  all: readonly ScenarioMeasurement[],
): string[] {
  const failed: string[] = [];
  for (const expectation of SCENARIO_EXPECTATIONS) {
    if (!expectation.appliesTo(measurement)) continue;
    if (!expectation.holds(measurement, all)) failed.push(expectation.description);
  }
  return failed;
}

/** Returns a NEW report (never mutates `report` or any measurement in it)
 *  where every measurement that fails at least one applicable expectation
 *  gains an `error` naming which one(s), appended to an existing `error`
 *  rather than overwriting it (a harness exception and a wrong-outcome
 *  finding can coexist and both matter). A measurement that already holds
 *  every applicable expectation is returned unchanged (same reference), so a
 *  fully-passing report is byte-identical to its input. This is the ONE
 *  place a wrong real outcome becomes the same kind of `error` field the CLI
 *  already exits nonzero on: the report itself is still returned whole
 *  (never suppressed, never replaced with a fabricated success), only
 *  annotated. */
export function annotateUnmetExpectations(report: ScenarioReport): ScenarioReport {
  return {
    ...report,
    measurements: report.measurements.map((m) => {
      const failed = unmetExpectationsFor(m, report.measurements);
      if (failed.length === 0) return m;
      const failureText = `unmet scenario expectation(s): ${failed.join('; ')}`;
      return { ...m, error: m.error ? `${m.error}; ${failureText}` : failureText };
    }),
  };
}

/** Escapes the two characters that break a GitHub-flavored Markdown table
 *  cell: a literal `|` (which a naive `join(' | ')` reads as a new column
 *  boundary) and a newline (which breaks the row onto a new Markdown line
 *  entirely, corrupting every row after it: an esbuild multi-line error
 *  message is the exact shape that trips this). Escaped in place rather than
 *  truncated: a long error message stays fully readable, just on one
 *  logical table line. */
function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, '<br>');
}

function markdownTable(headers: readonly string[], rows: readonly (string | number)[][]): string {
  const escapedRows = rows.map((row) =>
    row.map((cell) => (typeof cell === 'string' ? escapeMarkdownCell(cell) : cell)),
  );
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = escapedRows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

function unitsSummary(m: ScenarioMeasurement): string {
  const units = foldHarvestUnits(m.harvestedUnits);
  if (units.length === 0) return '(none)';
  return units.map((u) => `${u.qty}x ${u.itemId} (${u.kind})`).join(', ');
}

/** Render the whole report as Markdown: one row per scenario measurement per
 *  repo, plus the provenance block. Static/labelled facts (bulk sampling vs a
 *  live-tick example) are carried in `notes`, printed verbatim rather than
 *  reinterpreted here. */
export function renderMarkdownReport(report: ScenarioReport): string {
  const lines: string[] = [];
  lines.push('# Intentional gathering supply measurement');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Harness version: ${report.harnessVersion}`);
  lines.push(`Fixed seed: ${report.seed}`);
  lines.push('');
  lines.push('## Repos measured');
  lines.push('');
  lines.push(
    markdownTable(
      ['label', 'path', 'commit', 'dirty'],
      report.repos.map((r) => [
        r.label,
        r.path,
        r.commit,
        r.dirty ? 'YES (uncommitted changes)' : 'no',
      ]),
    ),
  );
  lines.push('');
  lines.push('## Scenario measurements');
  lines.push('');
  lines.push(
    markdownTable(
      [
        'scenario',
        'family',
        'repo',
        'attempts',
        'success',
        'denied',
        'units granted',
        'unwanted item types',
        'slots before to after',
        'travel s',
        'cast s',
        'notes',
      ],
      report.measurements.map((m) => [
        m.scenarioId,
        m.family,
        m.repoLabel,
        m.attempts,
        m.successfulHarvests,
        m.deniedAttempts,
        m.error ? 'ERROR' : unitsSummary(m),
        m.distinctUnwantedItemIds.length,
        `${m.slotsBefore} to ${m.slotsAfter}`,
        m.travelSimSeconds.toFixed(1),
        m.castSimSeconds.toFixed(1),
        (m.error ? [m.error, ...m.notes] : m.notes).join('; ') || '(none)',
      ]),
    ),
  );
  return lines.join('\n');
}

export function renderJsonReport(report: ScenarioReport): string {
  return JSON.stringify(report, null, 2);
}
