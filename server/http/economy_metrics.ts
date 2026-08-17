// The gold-integrity half of the /metrics exporter: the ledger writer's health,
// the realm's coin supply broken down by where it is sitting, and whether the
// conservation pass is actually still running. Registered on the SAME
// prom-client registry as the RED and game-state exporters
// (server/http/metrics.ts); Prometheus attaches env / service / server_name at
// scrape time, so nothing here emits those.
//
// THE SERIES THAT MATTERS MOST IS `woc_economy_reconcile_age_seconds`. Every
// other metric in this file describes the economy; that one describes the thing
// WATCHING the economy, and it is the only signal that separates "no
// duplication was found" from "nothing has looked in six hours". A dupe check
// that dies quietly reads exactly like a healthy realm, which is the failure
// mode this whole system is built to avoid, so it gets a gauge that climbs on
// its own with no cooperation from the pass.
//
// GAUGES ARE READ AT SCRAPE TIME, NO DRIFT, the game_metrics.ts contract: each
// carries a collect() that pulls from the injected source the moment
// registry.metrics() runs. They read only IN-MEMORY state (the writer's queue,
// the last pass's own record of itself) and never issue a query: a scrape must
// not be able to put load on the database, least of all the aggregate sums the
// pass itself is careful to take only once every fifteen minutes.
//
// COUNTERS are pushed from their emission sites through the process-wide slot in
// economy_signals.ts. Cardinality is bounded there.

import { Counter, Gauge, type Registry } from 'prom-client';
import {
  ECONOMY_EVENT_KINDS,
  type EconomyEventKind,
  isFaucetKind,
  isSinkKind,
  TRANSFER_PARTNER,
} from '../../src/sim/economy_event_kinds';
import {
  ECONOMY_ALERT_KINDS,
  type EconomyAlertKind,
  type EconomyAlertSeverity,
  type SupplySnapshot,
} from '../economy_reconcile';
import {
  ECONOMY_PASS_OUTCOMES,
  type EconomyMetricsCounters,
  type EconomyPassOutcome,
} from './economy_signals';

/** Rows the writer has queued and not yet landed. */
export const WOC_GOLD_LEDGER_QUEUE_DEPTH = 'woc_gold_ledger_queue_depth';
/** Coin the realm is holding, by which pool is holding it. */
export const WOC_ECONOMY_SUPPLY_COPPER = 'woc_economy_supply_copper';
/** Coin unsaved character state could account for at the last pass. */
export const WOC_ECONOMY_UNSETTLED_COPPER = 'woc_economy_unsettled_copper';
/** Seconds since the last completed pass. */
export const WOC_ECONOMY_RECONCILE_AGE_SECONDS = 'woc_economy_reconcile_age_seconds';
/** Ledger rows the last pass left unread behind its cursor. */
export const WOC_ECONOMY_RECONCILE_BACKLOG_ROWS = 'woc_economy_reconcile_backlog_rows';

export const WOC_GOLD_LEDGER_ROWS_WRITTEN = 'woc_gold_ledger_rows_written_total';
export const WOC_GOLD_LEDGER_WRITES_DROPPED = 'woc_gold_ledger_writes_dropped_total';
export const WOC_GOLD_LEDGER_FLUSH_FAILURES = 'woc_gold_ledger_flush_failures_total';
export const WOC_GOLD_MINTED_COPPER = 'woc_gold_minted_copper_total';
export const WOC_GOLD_BURNED_COPPER = 'woc_gold_burned_copper_total';
export const WOC_GOLD_TRANSFERRED_COPPER = 'woc_gold_transferred_copper_total';
export const WOC_GOLD_MOVEMENTS = 'woc_gold_movements_total';
export const WOC_ECONOMY_RECONCILE_PASSES = 'woc_economy_reconcile_passes_total';
export const WOC_ECONOMY_FINDINGS = 'woc_economy_findings_total';

/**
 * The supply terms, as label values. Named here rather than derived from the
 * SupplySnapshot keys so the label vocabulary is a deliberate, greppable list:
 * these strings end up in dashboards and renaming one silently splits a series.
 */
export const ECONOMY_SUPPLY_POOLS = [
  'purses',
  'bank_vaults',
  'guild_treasuries',
  'mail_escrow',
  'market_escrow',
] as const;
export type EconomySupplyPool = (typeof ECONOMY_SUPPLY_POOLS)[number];

function supplyByPool(s: SupplySnapshot): Record<EconomySupplyPool, number> {
  return {
    purses: s.purses,
    bank_vaults: s.bankVaults,
    guild_treasuries: s.guildTreasuries,
    mail_escrow: s.unclaimedMailCoin,
    market_escrow: s.marketEscrow,
  };
}

/** What the last completed pass measured, kept in memory for the gauges. */
export interface EconomyPassSnapshot {
  /** Wall clock the pass finished, in epoch milliseconds. */
  atMs: number;
  supply: SupplySnapshot;
  unsettledCopper: number;
  /** Rows between the cursor and the ledger head when the pass ended. */
  backlogRows: number;
}

export interface EconomyMetricsSource {
  ledgerQueueDepth(): number;
  /** Null until the first pass completes, which is a real state and not zero:
   *  a realm that has never reconciled must not publish a supply of 0. */
  lastPass(): EconomyPassSnapshot | null;
  nowMs(): number;
}

/**
 * Register every economy series on `registry` and return the counter sink.
 *
 * Counters are pre-initialised across their whole label space (prom-client's
 * Counter does not emit a series until it is first incremented). Without that a
 * dashboard querying `woc_gold_ledger_writes_dropped_total` on a healthy realm
 * gets NO DATA rather than 0, and "no data" is exactly what a broken scrape
 * looks like too. The label spaces are all closed and small, so the cost is a
 * fixed handful of zero series.
 */
export function registerEconomyMetrics(
  registry: Registry,
  source: EconomyMetricsSource,
): EconomyMetricsCounters {
  new Gauge({
    name: WOC_GOLD_LEDGER_QUEUE_DEPTH,
    help: 'Gold ledger rows queued in memory and not yet written.',
    registers: [registry],
    collect() {
      this.set(source.ledgerQueueDepth());
    },
  });

  new Gauge({
    name: WOC_ECONOMY_SUPPLY_COPPER,
    help: 'Copper the realm is holding, by pool, as measured by the last conservation pass.',
    labelNames: ['pool'],
    registers: [registry],
    collect() {
      const last = source.lastPass();
      // Nothing measured yet. Leave the series absent rather than publishing
      // zeroes: a realm whose reconciler has not run has an UNKNOWN supply, and
      // a flat 0 would read as every coin in the world having vanished.
      if (last === null) return;
      for (const [pool, copper] of Object.entries(supplyByPool(last.supply))) {
        this.set({ pool }, copper);
      }
    },
  });

  new Gauge({
    name: WOC_ECONOMY_UNSETTLED_COPPER,
    help: 'Copper that unsaved character state could account for at the last pass; the bound below which a supply gap is not called a duplication.',
    registers: [registry],
    collect() {
      const last = source.lastPass();
      if (last === null) return;
      this.set(last.unsettledCopper);
    },
  });

  // Captured at registration, which is boot. It is the age gauge's fallback
  // before any pass has completed, and that fallback is load-bearing: a gauge
  // with no labels ALWAYS renders (prom-client emits an implicit zero sample for
  // one), so "return early and leave it absent" is not available here the way it
  // is for the labelled supply series. Leaving it at 0 would publish "reconciled
  // 0 seconds ago" on a realm that has never reconciled at all, which silences
  // precisely the alert this metric exists for. Time since boot is the honest
  // reading instead: it climbs from the moment the process starts, so a
  // reconciler that never runs a first pass trips the same threshold as one that
  // stopped running later.
  const startedMs = source.nowMs();
  new Gauge({
    name: WOC_ECONOMY_RECONCILE_AGE_SECONDS,
    help: 'Seconds since the last completed conservation pass, or since boot if none has completed. Alert on this: a pass that stops running looks exactly like an economy with nothing wrong.',
    registers: [registry],
    collect() {
      const last = source.lastPass();
      this.set(Math.max(0, (source.nowMs() - (last?.atMs ?? startedMs)) / 1000));
    },
  });

  new Gauge({
    name: WOC_ECONOMY_RECONCILE_BACKLOG_ROWS,
    help: 'Ledger rows behind the conservation cursor when the last pass ended. Sustained growth means the pass cannot keep up with the ledger.',
    registers: [registry],
    collect() {
      const last = source.lastPass();
      if (last === null) return;
      this.set(last.backlogRows);
    },
  });

  const rowsWritten = new Counter({
    name: WOC_GOLD_LEDGER_ROWS_WRITTEN,
    help: 'Gold ledger rows successfully written.',
    registers: [registry],
  });
  const writesDropped = new Counter({
    name: WOC_GOLD_LEDGER_WRITES_DROPPED,
    help: 'Gold ledger rows the writer will never write (queue overflow or a rejected batch). While this is climbing the reconciler downgrades its own findings, so it is a blindness signal, not a throughput one.',
    registers: [registry],
  });
  const flushFailures = new Counter({
    name: WOC_GOLD_LEDGER_FLUSH_FAILURES,
    help: 'Gold ledger batch inserts rejected by the database.',
    registers: [registry],
  });
  rowsWritten.inc(0);
  writesDropped.inc(0);
  flushFailures.inc(0);

  const minted = new Counter({
    name: WOC_GOLD_MINTED_COPPER,
    help: 'Copper created, by event kind.',
    labelNames: ['kind'],
    registers: [registry],
  });
  const burned = new Counter({
    name: WOC_GOLD_BURNED_COPPER,
    help: 'Copper destroyed, by event kind.',
    labelNames: ['kind'],
    registers: [registry],
  });
  const transferred = new Counter({
    name: WOC_GOLD_TRANSFERRED_COPPER,
    help: 'Copper moved between holders, by event kind. Counts the CREDIT half only: a transfer writes two rows and summing both would report double the coin that actually moved.',
    labelNames: ['kind'],
    registers: [registry],
  });
  const movements = new Counter({
    name: WOC_GOLD_MOVEMENTS,
    help: 'Coin movements written, by event kind. The row count behind the copper totals, so a panel can tell one large trade from a thousand small ones.',
    labelNames: ['kind'],
    registers: [registry],
  });
  for (const kind of ECONOMY_EVENT_KINDS) {
    movements.inc({ kind }, 0);
    if (isFaucetKind(kind)) minted.inc({ kind }, 0);
    else if (isSinkKind(kind)) burned.inc({ kind }, 0);
    else transferred.inc({ kind }, 0);
  }

  const passes = new Counter({
    name: WOC_ECONOMY_RECONCILE_PASSES,
    help: 'Conservation passes, by how they ended.',
    labelNames: ['outcome'],
    registers: [registry],
  });
  for (const outcome of ECONOMY_PASS_OUTCOMES) passes.inc({ outcome }, 0);

  const findings = new Counter({
    name: WOC_ECONOMY_FINDINGS,
    help: 'Conservation findings, by kind and severity. Counts what each pass FOUND, not what it filed: the alert table dedupes against the open queue, so a still-recurring violation would otherwise flatline after its first sighting.',
    labelNames: ['kind', 'severity'],
    registers: [registry],
  });
  const severities: EconomyAlertSeverity[] = ['critical', 'warning', 'info'];
  for (const kind of ECONOMY_ALERT_KINDS) {
    for (const severity of severities) findings.inc({ kind, severity }, 0);
  }

  return {
    ledgerRowsWritten(count: number): void {
      if (count > 0) rowsWritten.inc(count);
    },
    ledgerWritesDropped(count: number): void {
      if (count > 0) writesDropped.inc(count);
    },
    ledgerFlushFailed(): void {
      flushFailures.inc();
    },
    goldMovement(kind: EconomyEventKind, amount: number): void {
      movements.inc({ kind });
      if (isFaucetKind(kind)) {
        minted.inc({ kind }, Math.abs(amount));
        return;
      }
      if (isSinkKind(kind)) {
        burned.inc({ kind }, Math.abs(amount));
        return;
      }
      // A transfer's two halves are equal and opposite, so counting both would
      // report twice the coin that moved. The credit half is the arbitrary but
      // consistent choice; a debit-only row (a half whose partner was lost) is
      // therefore invisible HERE and shows up as an orphaned_transfer finding,
      // which is the series that should be alerting on it anyway.
      if (TRANSFER_PARTNER[kind] !== undefined && amount > 0) {
        transferred.inc({ kind }, amount);
      }
    },
    reconcilePass(outcome: EconomyPassOutcome): void {
      passes.inc({ outcome });
    },
    finding(kind: EconomyAlertKind, severity: EconomyAlertSeverity): void {
      findings.inc({ kind, severity });
    },
  };
}
