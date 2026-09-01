// The offline-writer lease-fence refusal counters
// (server/offline_fence_refusals.ts, the Phase 18 security review's INFO on the
// persistence unit): a refusal is a LOGGED line today, and a log line is not a
// signal an operator can watch, so each of the three offline character-blob
// writers counts its own refusals beside the line it already writes. This suite
// pins the module's own contract; the per-writer increments are pinned at the
// writers themselves (tests/server/characters.test.ts for the two sweeps,
// tests/server/pbe_boost_save_fence.test.ts for the roster save), because a
// counter that only its own unit test increments proves nothing about the
// production path.
import { Registry } from 'prom-client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameStateSource } from '../../server/http/game_metrics';
import {
  registerGameStateMetrics,
  WOC_OFFLINE_FENCE_REFUSALS_TOTAL,
} from '../../server/http/game_metrics';
import {
  countOfflineFenceRefusal,
  OFFLINE_FENCE_WRITERS,
  offlineFenceRefusals,
  resetOfflineFenceRefusalsForTests,
} from '../../server/offline_fence_refusals';

beforeEach(() => {
  resetOfflineFenceRefusalsForTests();
});

describe('offline fence refusal counters', () => {
  it('starts every writer family at zero and names exactly the three offline writers', () => {
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 0,
      reclaim_sweep: 0,
      pbe_roster: 0,
    });
    // The family list is the metric's label vocabulary; a NEW offline writer
    // joins it here and at the readout, never as an ad-hoc string.
    expect([...OFFLINE_FENCE_WRITERS]).toEqual(['rename_sweep', 'reclaim_sweep', 'pbe_roster']);
    expect(Object.keys(offlineFenceRefusals()).sort()).toEqual([...OFFLINE_FENCE_WRITERS].sort());
  });

  it('counts per family and never leaks a count into a sibling family', () => {
    countOfflineFenceRefusal('rename_sweep');
    countOfflineFenceRefusal('rename_sweep');
    countOfflineFenceRefusal('pbe_roster');

    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 2,
      reclaim_sweep: 0,
      pbe_roster: 1,
    });
  });

  it('hands back a SNAPSHOT: mutating the read never moves the live counters', () => {
    countOfflineFenceRefusal('reclaim_sweep');
    const snapshot = offlineFenceRefusals() as Record<string, number>;
    snapshot.reclaim_sweep = 999;
    snapshot.rename_sweep = 999;
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 0,
      reclaim_sweep: 1,
      pbe_roster: 0,
    });
  });

  it('the test-only reset clears every family at once', () => {
    for (const writer of OFFLINE_FENCE_WRITERS) countOfflineFenceRefusal(writer);
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 1,
      reclaim_sweep: 1,
      pbe_roster: 1,
    });
    resetOfflineFenceRefusalsForTests();
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 0,
      reclaim_sweep: 0,
      pbe_roster: 0,
    });
  });

  it('counts monotonically across many refusals (the counter is a total, never a gauge)', () => {
    for (let i = 0; i < 50; i++) countOfflineFenceRefusal('pbe_roster');
    expect(offlineFenceRefusals().pbe_roster).toBe(50);
  });
});

// The scrape half (the Phase 18 QA fix round). Counting a refusal nothing
// publishes is exactly the unobservable-signal defect this item closed:
// game_metrics.ts carried a TODO whose premise ("once
// server/offline_fence_refusals.ts lands") had already stopped being true.
// These cases drive the REAL registerGameStateMetrics against a real
// prom-client Registry, so a series that is not registered, mislabelled, or
// wired to a stale copy of the counts fails here.

/** A shape-valid GameStateSource. Every gauge's collect() runs on each
 *  registry.metrics(), so the stub must answer every member even though only
 *  the fence-refusal series is asserted on; the values are deliberately
 *  uninteresting, and the canonical stub with the meaningful figures lives in
 *  tests/server/http/game_metrics.test.ts, which owns the rest of the family. */
function inertSource(): GameStateSource {
  const pool = () => ({ total: 0, idle: 0, waiting: 0 });
  const gate = () => ({
    inFlight: 0,
    waiting: 0,
    max: 1,
    configuredHeadroom: 0,
    acquired: 0,
    refused: 0,
    cancelled: 0,
  });
  return {
    usernameBanlistLoaded: () => true,
    characterBlobBytesHighWater: () => 0,
    characterBlobBytesP99: () => 0,
    playersOnline: () => 0,
    accountsOnline: () => 0,
    wsConnections: () => 0,
    simEntities: () => 0,
    simTickHz: () => 0,
    savePendingKeys: () => 0,
    escrowGateInFlight: () => 0,
    backgroundDbGate: gate,
    characterDeleteGate: () => ({
      ...gate(),
      busyRefusals: 0,
      verifyLanded: 0,
      verifyNotLanded: 0,
      verifyFailed: 0,
    }),
    storageRecovery: () => ({
      tracked: 0,
      scanActive: 0,
      scanQueued: 0,
      driveActive: 0,
      driveQueued: 0,
      retryTimers: 0,
      oldestTrackedAgeMs: 0,
      oldestQueuedAgeMs: 0,
      oldestActiveAgeMs: 0,
      activePastSlotTarget: 0,
      horizonBreached: false,
      capacityRefusals: 0,
      retriesScheduled: 0,
      horizonBreaches: 0,
    }),
    tickPhaseMillis: () => ({}),
    dbPool: pool,
    dbBackendCancels: () => ({ requested: 0, failed: 0 }),
    bankLedgerTail: () => ({ depth: 0, rows: 0, droppedRows: 0 }),
    soldVolumeTail: () => ({ depth: 0, coalescedSales: 0, droppedSales: 0 }),
    generalChatQuotaDbPool: pool,
    generalChatQuotaInFlight: () => 0,
    generalChatQuotaCachedAccounts: () => 0,
    generalChatQuotaListener: () => ({ connected: 0, reconnects: 0, pendingRefreshes: 0 }),
    guildBankLogCache: () => ({
      reads: 0,
      refreshes: 0,
      evictions: 0,
      busts: 0,
      entries: 0,
      dirtyGuilds: 0,
    }),
    lastTickAt: () => null,
    loopStartedAt: () => null,
  };
}

/** One rendered series value, or undefined when the series is absent. */
function seriesValue(text: string, writer: string): string | undefined {
  const line = text
    .split('\n')
    .find((l) => l.startsWith(`${WOC_OFFLINE_FENCE_REFUSALS_TOTAL}{writer="${writer}"}`));
  return line?.split(' ').at(-1);
}

describe('woc_offline_fence_refusals_total', () => {
  it('publishes one COUNTER series per writer family, present from the first scrape', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, inertSource());
    const text = await registry.metrics();

    expect(WOC_OFFLINE_FENCE_REFUSALS_TOTAL).toBe('woc_offline_fence_refusals_total');
    // A Counter, not a gauge: operators alert with increase()/rate(), which
    // read a restart reset correctly and misread a restarting gauge.
    expect(text).toContain(`# TYPE ${WOC_OFFLINE_FENCE_REFUSALS_TOTAL} counter`);
    // Present before any refusal, because collect() walks the whole family
    // vocabulary rather than only the families that moved: "no refusals" has
    // to be distinguishable from "the series never existed".
    for (const writer of OFFLINE_FENCE_WRITERS) {
      expect(seriesValue(text, writer)).toBe('0');
    }
  });

  it('moves the counted family, and only that family, on a real refusal', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, inertSource());

    countOfflineFenceRefusal('rename_sweep');
    countOfflineFenceRefusal('rename_sweep');
    countOfflineFenceRefusal('pbe_roster');

    const text = await registry.metrics();
    expect(seriesValue(text, 'rename_sweep')).toBe('2');
    expect(seriesValue(text, 'pbe_roster')).toBe('1');
    expect(seriesValue(text, 'reclaim_sweep')).toBe('0');
    // The exported readout and the scraped series are the same numbers: the
    // exporter keeps no copy that could drift from the writers.
    expect(offlineFenceRefusals()).toEqual({
      rename_sweep: 2,
      reclaim_sweep: 0,
      pbe_roster: 1,
    });
  });

  it('re-reads the live counts on EVERY scrape (a refusal after the first shows up)', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, inertSource());

    expect(seriesValue(await registry.metrics(), 'reclaim_sweep')).toBe('0');
    countOfflineFenceRefusal('reclaim_sweep');
    // No drift: the second scrape reflects the refusal that arrived between
    // them, because collect() replays the module's absolute total rather than
    // caching a sample.
    expect(seriesValue(await registry.metrics(), 'reclaim_sweep')).toBe('1');
    countOfflineFenceRefusal('reclaim_sweep');
    expect(seriesValue(await registry.metrics(), 'reclaim_sweep')).toBe('2');
  });

  it('mints no label beyond the closed family vocabulary', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, inertSource());
    for (const writer of OFFLINE_FENCE_WRITERS) countOfflineFenceRefusal(writer);

    const labels = (await registry.metrics())
      .split('\n')
      .filter((line) => line.startsWith(`${WOC_OFFLINE_FENCE_REFUSALS_TOTAL}{`))
      .map((line) => line.replace(/^.*\{writer="([^"]+)"\}.*$/, '$1'));
    expect(new Set(labels)).toEqual(new Set(OFFLINE_FENCE_WRITERS));
    // Nothing per-character, per-account or per-realm rides this series.
    expect(labels).toHaveLength(OFFLINE_FENCE_WRITERS.length);
  });
});
