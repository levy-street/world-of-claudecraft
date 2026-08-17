// The economy counter seam: the process-wide slot the gold ledger and the
// reconciliation pass push their counters through, so neither has to thread a
// prom-client registry down from main.ts. Installed once at boot
// (registerEconomyMetrics(...), so every counter shares the exporter's one
// registry), exactly like setGameMetricsCounters and setAttackSignalSink; before
// that, and in any test that never wires one, the slot holds the no-op and every
// emission is dropped.
//
// The gauges (queue depth, coin supply, reconciler age) need no slot: they are
// read live at scrape time from an injected source. See economy_metrics.ts.
//
// CARDINALITY IS BOUNDED BY DESIGN, the same contract as the sibling exporters.
// The only label values here come from CLOSED allowlists that live in the sim
// and the reconciler rather than being invented at the call site:
// ECONOMY_EVENT_KINDS, ECONOMY_ALERT_KINDS, the three alert severities, and the
// five pass outcomes below. Nothing per-player, per-character, per-account or
// per-guild is ever a label, which matters more here than almost anywhere else
// in the exporter: these series describe money, and a `character_id` label on a
// gold flow would turn the metrics endpoint into a per-player wealth feed.

import type { EconomyEventKind } from '../../src/sim/economy_event_kinds';
import type { EconomyAlertKind, EconomyAlertSeverity } from '../economy_reconcile';

/**
 * How one reconciliation pass ended. Closed because it is a Prometheus label,
 * and each value is a DIFFERENT operator question:
 *
 * - `baseline`: the first pass on a realm, which establishes the opening supply
 *   and deliberately reports nothing. More than one of these means the cursor
 *   keeps disappearing, which silently resets the whole check.
 * - `complete`: the window was fully read and the supply figure carried forward.
 * - `capped`: the window hit its row cap, so a backlog is still draining. A
 *   sustained rate here means the pass cannot keep up with the ledger.
 * - `peer_locked`: another process held the realm's lock. Normal in a multi
 *   process deployment; on a single-process realm it means a stale lock.
 * - `failed`: the pass threw. The cursor is untouched, so the window is retried,
 *   but a sustained rate means conservation is not actually being checked.
 */
export const ECONOMY_PASS_OUTCOMES = [
  'baseline',
  'complete',
  'capped',
  'peer_locked',
  'failed',
] as const;
export type EconomyPassOutcome = (typeof ECONOMY_PASS_OUTCOMES)[number];

export interface EconomyMetricsCounters {
  /** `count` ledger rows landed in one statement. */
  ledgerRowsWritten(count: number): void;
  /**
   * `count` rows the writer will never write, from a full queue or a rejected
   * batch. The most important counter in this file: while it is non-zero the
   * reconciler downgrades its own findings, so a silent rise here is the check
   * going blind rather than the economy being healthy.
   */
  ledgerWritesDropped(count: number): void;
  /** One batch insert rejected by the database. */
  ledgerFlushFailed(): void;
  /**
   * One coin movement, as written. The implementation classifies `kind` through
   * the sim's own faucet/sink/transfer tables rather than the call site deciding,
   * so the metric and the supply identity can never disagree about which kinds
   * mint and which burn.
   */
  goldMovement(kind: EconomyEventKind, amount: number): void;
  /** One reconciliation pass ended, under a fixed five-value label. */
  reconcilePass(outcome: EconomyPassOutcome): void;
  /**
   * One conservation finding, by kind and severity. Emitted for what the pass
   * FOUND, not for what it filed: the alert table dedupes against the open queue
   * (one incident, one row), and a rate panel wants to see a violation still
   * recurring every pass rather than flatlining after its first sighting.
   */
  finding(kind: EconomyAlertKind, severity: EconomyAlertSeverity): void;
}

const NOOP: EconomyMetricsCounters = {
  ledgerRowsWritten: () => {},
  ledgerWritesDropped: () => {},
  ledgerFlushFailed: () => {},
  goldMovement: () => {},
  reconcilePass: () => {},
  finding: () => {},
};

let installed: EconomyMetricsCounters = NOOP;

/** Install the real sink, once, at boot. */
export function setEconomyMetricsCounters(counters: EconomyMetricsCounters): void {
  installed = counters;
}

/** Drop back to the no-op, for tests that wired a sink. */
export function resetEconomyMetricsCountersForTests(): void {
  installed = NOOP;
}

/** The current sink. Callers fetch it per emission rather than caching it, so a
 *  test that installs a sink mid-run is observed by call sites already loaded. */
export function economyMetricsCounters(): EconomyMetricsCounters {
  return installed;
}
