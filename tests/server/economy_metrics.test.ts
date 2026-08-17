// Exporter pins for the gold-integrity metrics (server/http/economy_metrics.ts).
// Registers on a private prom-client registry and reads the rendered text, so
// what is asserted is what Prometheus would actually scrape rather than what the
// code meant to publish.
//
// Two properties carry most of the weight here, and neither is obvious from the
// registration code:
//
//   - A counter that has never been incremented emits NO SERIES. On a healthy
//     realm that is every safety counter, so a dashboard querying "how many
//     ledger writes did we drop" would answer "no data", which is also exactly
//     what a broken scrape answers. Every closed label space is therefore
//     pre-initialised to zero.
//   - The supply gauges must be ABSENT, not zero, before the first pass. A realm
//     that has not reconciled has an unknown coin supply, and publishing 0 would
//     read as every coin in the world having vanished. Absence is only available
//     to a LABELLED gauge, though: prom-client renders a labelless one whatever
//     its collect() does, so the reconciler-age gauge cannot use the same trick
//     and ages from boot instead.

import { Registry } from 'prom-client';
import { describe, expect, it } from 'vitest';
import type { SupplySnapshot } from '../../server/economy_reconcile';
import {
  type EconomyMetricsSource,
  type EconomyPassSnapshot,
  registerEconomyMetrics,
  WOC_ECONOMY_RECONCILE_AGE_SECONDS,
  WOC_ECONOMY_SUPPLY_COPPER,
  WOC_GOLD_BURNED_COPPER,
  WOC_GOLD_LEDGER_WRITES_DROPPED,
  WOC_GOLD_MINTED_COPPER,
  WOC_GOLD_MOVEMENTS,
  WOC_GOLD_TRANSFERRED_COPPER,
} from '../../server/http/economy_metrics';
import { ECONOMY_EVENT_KINDS } from '../../src/sim/economy_event_kinds';

const NOW = 1_700_000_000_000;

function supply(over: Partial<SupplySnapshot> = {}): SupplySnapshot {
  return {
    purses: 0,
    bankVaults: 0,
    guildTreasuries: 0,
    unclaimedMailCoin: 0,
    marketEscrow: 0,
    ...over,
  };
}

function harness(over: Partial<{ queueDepth: number; lastPass: EconomyPassSnapshot | null }> = {}) {
  const registry = new Registry();
  const source: EconomyMetricsSource = {
    ledgerQueueDepth: () => over.queueDepth ?? 0,
    lastPass: () => over.lastPass ?? null,
    nowMs: () => NOW,
  };
  return { registry, counters: registerEconomyMetrics(registry, source) };
}

// One rendered sample line, or undefined when the series is absent.
function sample(text: string, name: string, labels = ''): string | undefined {
  const needle = labels === '' ? `${name} ` : `${name}{${labels}} `;
  return text.split('\n').find((l) => l.startsWith(needle));
}

describe('safety counters exist before anything goes wrong', () => {
  it('publishes a zero for every dropped-write series on a healthy realm', async () => {
    const { registry } = harness();
    const text = await registry.metrics();
    // Without the pre-initialisation this line is absent, and "absent" is what a
    // broken scrape looks like too: the one series an operator most needs to
    // trust would be indistinguishable from a dead exporter.
    expect(sample(text, WOC_GOLD_LEDGER_WRITES_DROPPED)).toBe(
      `${WOC_GOLD_LEDGER_WRITES_DROPPED} 0`,
    );
  });

  it('publishes a zero for every event kind, so a dead faucet is visible as 0', async () => {
    const { registry } = harness();
    const text = await registry.metrics();
    for (const kind of ECONOMY_EVENT_KINDS) {
      expect(sample(text, WOC_GOLD_MOVEMENTS, `kind="${kind}"`)).toBe(
        `${WOC_GOLD_MOVEMENTS}{kind="${kind}"} 0`,
      );
    }
  });
});

describe('flows are classified by the sim tables, not by the call site', () => {
  it('books a faucet as minted and a sink as burned, both by magnitude', async () => {
    const { registry, counters } = harness();
    counters.goldMovement('mob_loot', 500);
    counters.goldMovement('vendor_buy', -200);
    const text = await registry.metrics();
    expect(sample(text, WOC_GOLD_MINTED_COPPER, 'kind="mob_loot"')).toBe(
      `${WOC_GOLD_MINTED_COPPER}{kind="mob_loot"} 500`,
    );
    // A sink's amount is negative on the row; a counter cannot go backwards, so
    // it is booked as the magnitude destroyed.
    expect(sample(text, WOC_GOLD_BURNED_COPPER, 'kind="vendor_buy"')).toBe(
      `${WOC_GOLD_BURNED_COPPER}{kind="vendor_buy"} 200`,
    );
  });

  it('counts one side of a transfer, not both', async () => {
    const { registry, counters } = harness();
    // The two rows one trade writes. Counting both halves would report 1000
    // copper of trade volume for a 500 copper trade.
    counters.goldMovement('trade', 500);
    counters.goldMovement('trade', -500);
    const text = await registry.metrics();
    expect(sample(text, WOC_GOLD_TRANSFERRED_COPPER, 'kind="trade"')).toBe(
      `${WOC_GOLD_TRANSFERRED_COPPER}{kind="trade"} 500`,
    );
    // Both rows still count as movements: that is the row-count series.
    expect(sample(text, WOC_GOLD_MOVEMENTS, 'kind="trade"')).toBe(
      `${WOC_GOLD_MOVEMENTS}{kind="trade"} 2`,
    );
  });
});

describe('the supply gauges refuse to guess', () => {
  it('publishes no supply series at all before the first pass', async () => {
    const { registry } = harness({ lastPass: null });
    const text = await registry.metrics();
    // Absent, not zero. A realm that has never reconciled has an UNKNOWN supply.
    expect(text).not.toContain(`${WOC_ECONOMY_SUPPLY_COPPER}{`);
  });

  it('ages from boot when no pass has ever completed, instead of reporting 0', async () => {
    // A gauge with no labels always renders, so the age series cannot simply be
    // absent. Leaving it at 0 would say "reconciled 0 seconds ago" on a realm
    // that has never reconciled, silencing the one alert that separates a
    // healthy economy from a dead watchdog.
    const registry = new Registry();
    let now = NOW;
    registerEconomyMetrics(registry, {
      ledgerQueueDepth: () => 0,
      lastPass: () => null,
      nowMs: () => now,
    });
    now = NOW + 3_600_000;
    const text = await registry.metrics();
    expect(sample(text, WOC_ECONOMY_RECONCILE_AGE_SECONDS)).toBe(
      `${WOC_ECONOMY_RECONCILE_AGE_SECONDS} 3600`,
    );
  });

  it('breaks the supply out by pool once a pass has measured it', async () => {
    const { registry } = harness({
      lastPass: {
        atMs: NOW - 90_000,
        supply: supply({ purses: 4000, guildTreasuries: 700, marketEscrow: 950 }),
        unsettledCopper: 25,
        backlogRows: 0,
      },
    });
    const text = await registry.metrics();
    expect(sample(text, WOC_ECONOMY_SUPPLY_COPPER, 'pool="purses"')).toBe(
      `${WOC_ECONOMY_SUPPLY_COPPER}{pool="purses"} 4000`,
    );
    expect(sample(text, WOC_ECONOMY_SUPPLY_COPPER, 'pool="market_escrow"')).toBe(
      `${WOC_ECONOMY_SUPPLY_COPPER}{pool="market_escrow"} 950`,
    );
    // The watchdog-liveness series: this is what separates "found nothing" from
    // "nothing has looked in six hours", and it climbs with no cooperation from
    // the pass.
    expect(sample(text, WOC_ECONOMY_RECONCILE_AGE_SECONDS)).toBe(
      `${WOC_ECONOMY_RECONCILE_AGE_SECONDS} 90`,
    );
  });
});
