// Unit tests for the game-state half of the /metrics exporter
// (server/http/game_metrics.ts): the woc_* gauges read live from an injected
// GameStateSource at scrape time, and the three throughput counters pushed through
// the returned sink. These pin the exposed metric NAMES as literals (a rename fails
// the test, not just a constant swap), prove the gauges reflect the source at scrape
// time, that the per-phase timing converts milliseconds to seconds and is bounded to
// the fixed WOC_TICK_PHASES x {p95,max} label set (an unknown phase never becomes a
// series), that the ws direction label is bounded to in/out, and that NO per-player
// label (account/session/character/player/ip) ever appears.

import { Registry } from 'prom-client';
import { describe, expect, it, vi } from 'vitest';
import { observeBankLedgerGrowthBudget } from '../../../server/bank_ledger_growth_budget';
import { COPPER_FLOW_SOURCES, HARVEST_BANDS, NODE_TIERS } from '../../../server/economy_telemetry';
import {
  FISHING_BANDS,
  ROD_FEE_RECIPE_IDS,
  rodFeeForRecipe,
} from '../../../server/fishing_telemetry';
import {
  type GameStateSource,
  registerGameStateMetrics,
  type TickPhaseMillis,
  WOC_ACCOUNTS_ONLINE,
  WOC_AUTH_GUARD_CACHE,
  WOC_BACKGROUND_DB_GATE,
  WOC_BANK_LEDGER_GROWTH_BUDGET,
  WOC_BANK_LEDGER_GROWTH_LIMIT_REFUSALS_TOTAL,
  WOC_BANK_LEDGER_TAIL,
  WOC_BANK_LEDGER_TAIL_DROPPED_ROWS_TOTAL,
  WOC_BATTLEGROUND_CAPTURES_TOTAL,
  WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL,
  WOC_BATTLEGROUND_MATCHES_TOTAL,
  WOC_CHARACTER_DELETE_BUSY_TOTAL,
  WOC_CHARACTER_DELETE_GATE,
  WOC_CHARACTER_DELETE_VERIFY_TOTAL,
  WOC_CHARACTERS_CREATED_TOTAL,
  WOC_CHAT_MESSAGES_TOTAL,
  WOC_COPPER_CREDITED_TOTAL,
  WOC_COPPER_SPENT_TOTAL,
  WOC_DB_BACKEND_CANCEL_FAILURES_TOTAL,
  WOC_DB_BACKEND_CANCEL_REQUESTS_TOTAL,
  WOC_DB_POOL_CLIENTS,
  WOC_ESCROW_GATE_IN_FLIGHT,
  WOC_ESCROW_QUEUE_TOTAL,
  WOC_FISHING_CASTS_TOTAL,
  WOC_FISHING_CATCHES_TOTAL,
  WOC_FISHING_EARLY_REELS_TOTAL,
  WOC_FISHING_EMPTY_HOOKS_TOTAL,
  WOC_FISHING_GOT_AWAYS_TOTAL,
  WOC_FISHING_KOI_TOTAL,
  WOC_GATHER_HARVESTS_TOTAL,
  WOC_GENERAL_CHAT_QUOTA_CACHE_ACCOUNTS,
  WOC_GENERAL_CHAT_QUOTA_DB_CALLS_TOTAL,
  WOC_GENERAL_CHAT_QUOTA_DB_DURATION_SECONDS,
  WOC_GENERAL_CHAT_QUOTA_DB_POOL,
  WOC_GENERAL_CHAT_QUOTA_LISTENER,
  WOC_GENERAL_CHAT_QUOTA_TOTAL,
  WOC_GUILD_BANK_INCIDENTS_TOTAL,
  WOC_GUILD_BANK_LOG_CACHE,
  WOC_INPUT_FRAMES_MISSED_TOTAL,
  WOC_PLAYERS_ONLINE,
  WOC_ROD_FEE_COPPER,
  WOC_ROD_FEE_PAYMENTS_TOTAL,
  WOC_SAVE_PENDING_KEYS,
  WOC_SIM_ENTITIES,
  WOC_SIM_TICK_HZ,
  WOC_SIM_TICK_PHASE_SECONDS,
  WOC_STORAGE_RECOVERY,
  WOC_TICK_PHASES,
  WOC_VAULT_LEDGER_INCIDENTS_TOTAL,
  WOC_WS_CONNECTIONS,
  WOC_WS_MESSAGES_DROPPED_TOTAL,
  WOC_WS_MESSAGES_TOTAL,
  WOC_WS_RATE_KICKS_TOTAL,
} from '../../../server/http/game_metrics';
import {
  GENERAL_CHAT_QUOTA_DB_OUTCOMES,
  GUILD_BANK_INCIDENTS,
  VAULT_LEDGER_INCIDENTS,
  WOC_ESCROW_QUEUE_OUTCOMES,
  WS_DROP_CAUSES,
} from '../../../server/http/game_signals';
import {
  configureWocAuthGuardCache,
  resetWocAuthGuardCache,
} from '../../../server/woc_auth_guard_cache';

/** A GameStateSource returning fixed values; override any field per test. */
function stubSource(overrides: Partial<GameStateSource> = {}): GameStateSource {
  return {
    playersOnline: () => 3,
    accountsOnline: () => 2,
    wsConnections: () => 5,
    simEntities: () => 42,
    simTickHz: () => 20,
    savePendingKeys: () => 6,
    escrowGateInFlight: () => 2,
    backgroundDbGate: () => ({
      inFlight: 0,
      waiting: 0,
      max: 8,
      configuredHeadroom: 2,
      acquired: 0,
      refused: 0,
      cancelled: 0,
    }),
    characterDeleteGate: () => ({
      inFlight: 1,
      waiting: 0,
      max: 2,
      configuredHeadroom: 0,
      acquired: 4,
      refused: 0,
      cancelled: 0,
      busyRefusals: 3,
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
    dbPool: () => ({ total: 7, idle: 4, waiting: 1 }),
    dbBackendCancels: () => ({ requested: 3, failed: 1 }),
    bankLedgerTail: () => ({ depth: 12, rows: 240, droppedRows: 5 }),
    generalChatQuotaDbPool: () => ({ total: 2, idle: 1, waiting: 0 }),
    generalChatQuotaInFlight: () => 0,
    generalChatQuotaCachedAccounts: () => 0,
    generalChatQuotaListener: () => ({ connected: 1, reconnects: 0, pendingRefreshes: 0 }),
    guildBankLogCache: () => ({
      reads: 11,
      refreshes: 3,
      evictions: 1,
      busts: 4,
      entries: 2,
      dirtyGuilds: 1,
    }),
    lastTickAt: () => 1_700_000_000_000,
    loopStartedAt: () => 1_700_000_000_000,
    ...overrides,
  };
}

/** Capture the numeric value on the first line matching `re` (one capture group). */
function sampleValue(text: string, re: RegExp): string | undefined {
  return text.match(re)?.[1];
}

/** Every woc_sim_tick_phase_seconds sample line (one per label combo). */
function tickPhaseSeries(text: string): string[] {
  return text.match(/^woc_sim_tick_phase_seconds\{[^}]*\} \d+(?:\.\d+)?$/gm) ?? [];
}

/** Every woc_gather_harvests_total sample line (one per zone x tier combo). */
function harvestSeries(text: string): string[] {
  return text.match(/^woc_gather_harvests_total\{[^}]*\} \d+$/gm) ?? [];
}

/** The set of distinct values of a given label across the whole exposition text. */
function labelValues(text: string, label: string, metric?: string): Set<string> {
  const values = new Set<string>();
  // Scoped to ONE metric when asked: several metrics now carry a `kind` label,
  // and a whole-text sweep would silently mix their vocabularies together and
  // stop being a closed-set pin for either of them.
  const lines = metric
    ? text.split('\n').filter((line) => line.startsWith(`${metric}{`))
    : text.split('\n');
  const re = new RegExp(`${label}="([^"]*)"`, 'g');
  for (const m of lines.join('\n').matchAll(re)) values.add(m[1]);
  return values;
}

/** Every fixed `measure` label and its numeric sample for one gauge family. */
function measureValues(text: string, metric: string): Record<string, string> {
  return Object.fromEntries(
    [...text.matchAll(new RegExp(`^${metric}\\{measure="([^"]+)"\\} (\\S+)$`, 'gm'))].map(
      ([, measure, value]) => [measure, value],
    ),
  );
}

describe('registerGameStateMetrics: gauges read the source at scrape time', () => {
  it('exports an explicit cold bank-ledger observation without inventing freshness', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    expect(measureValues(text, WOC_BANK_LEDGER_GROWTH_BUDGET)).toEqual({
      hard_limit_rows: '10000000',
      initialized: '0',
      limit_warning: '0',
      observation_age_seconds: '0',
      lifetime_inserted_rows: '0',
    });
  });

  it('exposes every gauge under its exact exported name and value', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    // Literal name pins: a rename of any gauge must fail this test.
    expect(WOC_PLAYERS_ONLINE).toBe('woc_players_online');
    expect(WOC_ACCOUNTS_ONLINE).toBe('woc_accounts_online');
    expect(WOC_WS_CONNECTIONS).toBe('woc_ws_connections');
    expect(WOC_SIM_ENTITIES).toBe('woc_sim_entities');
    expect(WOC_SIM_TICK_HZ).toBe('woc_sim_tick_hz');
    expect(WOC_SAVE_PENDING_KEYS).toBe('woc_character_save_pending_keys');
    expect(WOC_ESCROW_GATE_IN_FLIGHT).toBe('woc_escrow_gate_in_flight');
    expect(WOC_BACKGROUND_DB_GATE).toBe('woc_background_db_gate');
    expect(WOC_STORAGE_RECOVERY).toBe('woc_storage_recovery');
    expect(WOC_BANK_LEDGER_GROWTH_BUDGET).toBe('woc_bank_ledger_growth_budget');

    for (const name of [
      WOC_PLAYERS_ONLINE,
      WOC_ACCOUNTS_ONLINE,
      WOC_WS_CONNECTIONS,
      WOC_SIM_ENTITIES,
      WOC_SIM_TICK_HZ,
      WOC_SAVE_PENDING_KEYS,
      WOC_ESCROW_GATE_IN_FLIGHT,
      WOC_BACKGROUND_DB_GATE,
      WOC_STORAGE_RECOVERY,
      WOC_BANK_LEDGER_GROWTH_BUDGET,
    ]) {
      expect(text).toContain(`# TYPE ${name} gauge`);
    }

    expect(sampleValue(text, /^woc_players_online (\d+)$/m)).toBe('3');
    expect(sampleValue(text, /^woc_accounts_online (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^woc_ws_connections (\d+)$/m)).toBe('5');
    expect(sampleValue(text, /^woc_sim_entities (\d+)$/m)).toBe('42');
    expect(sampleValue(text, /^woc_sim_tick_hz (\d+)$/m)).toBe('20');
    // The character-save FIFO gauge (the escrow write-path rider): the stub
    // returns 6, and a live read at scrape time is what the no-drift test
    // below proves for the family.
    expect(sampleValue(text, /^woc_character_save_pending_keys (\d+)$/m)).toBe('6');
    // The realm escrow gate's occupancy (the fix round: an alert rule needs
    // it in /metrics, not only behind the dashboard secret).
    expect(sampleValue(text, /^woc_escrow_gate_in_flight (\d+)$/m)).toBe('2');
  });

  it('exports the fixed durable ledger limit and last database observation', async () => {
    observeBankLedgerGrowthBudget(123, 10_000_000, Date.now() - 2_000);
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    expect(labelValues(text, 'measure', WOC_BANK_LEDGER_GROWTH_BUDGET)).toEqual(
      new Set([
        'hard_limit_rows',
        'initialized',
        'limit_warning',
        'observation_age_seconds',
        'lifetime_inserted_rows',
      ]),
    );
    expect(
      sampleValue(
        text,
        /^woc_bank_ledger_growth_budget\{measure="lifetime_inserted_rows"\} (\d+)$/m,
      ),
    ).toBe('123');
    // 123 of 10,000,000 is far under the warn fraction.
    expect(
      sampleValue(text, /^woc_bank_ledger_growth_budget\{measure="limit_warning"\} (\d+)$/m),
    ).toBe('0');
    expect(
      sampleValue(text, /^woc_bank_ledger_growth_budget\{measure="hard_limit_rows"\} (\d+)$/m),
    ).toBe('10000000');
    expect(
      sampleValue(text, /^woc_bank_ledger_growth_budget\{measure="initialized"\} (\d+)$/m),
    ).toBe('1');
    const ageSeconds = Number(
      sampleValue(
        text,
        /^woc_bank_ledger_growth_budget\{measure="observation_age_seconds"\} ([\d.]+)$/m,
      ),
    );
    expect(ageSeconds).toBeGreaterThanOrEqual(2);
    expect(ageSeconds).toBeLessThan(3);
  });

  it('clamps a future bank-ledger observation timestamp to zero age', async () => {
    expect(observeBankLedgerGrowthBudget(124, 10_000_000, Date.now() + 60_000)).toBe(true);
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    expect(
      sampleValue(
        text,
        /^woc_bank_ledger_growth_budget\{measure="observation_age_seconds"\} (\S+)$/m,
      ),
    ).toBe('0');
  });

  it('recomputes bank-ledger observation age on every later scrape', async () => {
    expect(observeBankLedgerGrowthBudget(125, 10_000_000, 1_000)).toBe(true);
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000);

    try {
      const first = await registry.metrics();
      expect(
        sampleValue(
          first,
          /^woc_bank_ledger_growth_budget\{measure="observation_age_seconds"\} (\S+)$/m,
        ),
      ).toBe('1');

      now.mockReturnValue(3_500);
      const second = await registry.metrics();
      expect(
        sampleValue(
          second,
          /^woc_bank_ledger_growth_budget\{measure="observation_age_seconds"\} (\S+)$/m,
        ),
      ).toBe('2.5');
    } finally {
      now.mockRestore();
    }
  });

  it('exports the named-producer gate and bounded recovery scheduler', async () => {
    const registry = new Registry();
    registerGameStateMetrics(
      registry,
      stubSource({
        backgroundDbGate: () => ({
          inFlight: 7,
          waiting: 3,
          max: 8,
          configuredHeadroom: 2,
          acquired: 19,
          refused: 4,
          cancelled: 5,
        }),
        storageRecovery: () => ({
          tracked: 101,
          scanActive: 102,
          scanQueued: 103,
          driveActive: 104,
          driveQueued: 105,
          retryTimers: 106,
          oldestTrackedAgeMs: 107_500,
          oldestQueuedAgeMs: 108_500,
          oldestActiveAgeMs: 109_500,
          activePastSlotTarget: 110,
          horizonBreached: true,
          capacityRefusals: 111,
          retriesScheduled: 112,
          horizonBreaches: 113,
        }),
      }),
    );
    const text = await registry.metrics();

    expect(measureValues(text, WOC_BACKGROUND_DB_GATE)).toEqual({
      acquired: '19',
      cancelled: '5',
      configured_headroom: '2',
      in_flight: '7',
      max: '8',
      refused: '4',
      waiting: '3',
    });
    expect(measureValues(text, WOC_STORAGE_RECOVERY)).toEqual({
      active_past_slot_target: '110',
      capacity_refusals: '111',
      drive_active: '104',
      drive_queued: '105',
      horizon_breached: '1',
      horizon_breaches: '113',
      oldest_active_seconds: '109.5',
      oldest_queued_seconds: '108.5',
      oldest_tracked_seconds: '107.5',
      retries_scheduled: '112',
      retry_timers: '106',
      scan_active: '102',
      scan_queued: '103',
      tracked: '101',
    });
  });

  it('exports the character-delete sub-gate as its own family beside the realm gate', async () => {
    const registry = new Registry();
    let gate = {
      inFlight: 2,
      waiting: 5,
      max: 2,
      configuredHeadroom: 0,
      acquired: 9,
      refused: 0,
      cancelled: 1,
      busyRefusals: 3,
      verifyLanded: 2,
      verifyNotLanded: 1,
      verifyFailed: 4,
    };
    registerGameStateMetrics(registry, stubSource({ characterDeleteGate: () => gate }));
    const first = await registry.metrics();

    expect(WOC_CHARACTER_DELETE_GATE).toBe('woc_character_delete_gate');
    expect(WOC_CHARACTER_DELETE_BUSY_TOTAL).toBe('woc_character_delete_busy_total');
    expect(first).toContain(`# TYPE ${WOC_CHARACTER_DELETE_GATE} gauge`);
    expect(first).toContain(`# TYPE ${WOC_CHARACTER_DELETE_BUSY_TOTAL} counter`);
    // The whole sub-gate readout: a delete stampede parks BEFORE the realm
    // gate, so this waiting arm is the only place it is visible at all
    // (woc_background_db_gate reads waiting at most the sub-cap during one).
    expect(measureValues(first, WOC_CHARACTER_DELETE_GATE)).toEqual({
      acquired: '9',
      cancelled: '1',
      configured_headroom: '0',
      in_flight: '2',
      max: '2',
      refused: '0',
      waiting: '5',
    });
    // The busy total is a COUNTER under its own name, never a measure arm:
    // operators alert on increase(), which misreads a gauge restart.
    expect(labelValues(first, 'measure', WOC_CHARACTER_DELETE_GATE)).toEqual(
      new Set([
        'in_flight',
        'waiting',
        'max',
        'configured_headroom',
        'acquired',
        'refused',
        'cancelled',
      ]),
    );
    expect(sampleValue(first, /^woc_character_delete_busy_total (\d+)$/m)).toBe('3');
    // The commit-ambiguity verify outcomes, a labeled counter of their own:
    // the orphan bug the resolver fixes was invisible because nothing
    // counted; each result arm must read its own source field.
    expect(WOC_CHARACTER_DELETE_VERIFY_TOTAL).toBe('woc_character_delete_verify_total');
    expect(first).toContain(`# TYPE ${WOC_CHARACTER_DELETE_VERIFY_TOTAL} counter`);
    expect(
      sampleValue(first, /^woc_character_delete_verify_total\{result="landed"\} (\d+)$/m),
    ).toBe('2');
    expect(
      sampleValue(first, /^woc_character_delete_verify_total\{result="not_landed"\} (\d+)$/m),
    ).toBe('1');
    expect(
      sampleValue(first, /^woc_character_delete_verify_total\{result="failed"\} (\d+)$/m),
    ).toBe('4');

    // Live at scrape time (the family rule): a second scrape tracks movement.
    gate = { ...gate, inFlight: 1, waiting: 0, busyRefusals: 7, verifyLanded: 6 };
    const second = await registry.metrics();
    expect(measureValues(second, WOC_CHARACTER_DELETE_GATE)).toMatchObject({
      in_flight: '1',
      waiting: '0',
    });
    expect(sampleValue(second, /^woc_character_delete_busy_total (\d+)$/m)).toBe('7');
    expect(
      sampleValue(second, /^woc_character_delete_verify_total\{result="landed"\} (\d+)$/m),
    ).toBe('6');
  });

  it('exports pg pool saturation by state from the source snapshot', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();
    expect(WOC_DB_POOL_CLIENTS).toBe('woc_db_pool_clients');
    expect(text).toContain(`# TYPE ${WOC_DB_POOL_CLIENTS} gauge`);
    // The stub returns total 7, idle 4, waiting 1: each state must surface as
    // its own labeled sample (waiting is the saturation alarm line).
    expect(sampleValue(text, /^woc_db_pool_clients\{state="total"\} (\d+)$/m)).toBe('7');
    expect(sampleValue(text, /^woc_db_pool_clients\{state="idle"\} (\d+)$/m)).toBe('4');
    expect(sampleValue(text, /^woc_db_pool_clients\{state="waiting"\} (\d+)$/m)).toBe('1');
  });

  it('splits the bank-ledger FIFO into an instantaneous gauge and a drop counter', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();
    expect(WOC_BANK_LEDGER_TAIL).toBe('woc_bank_ledger_tail');
    expect(WOC_BANK_LEDGER_TAIL_DROPPED_ROWS_TOTAL).toBe('woc_bank_ledger_tail_dropped_rows_total');
    expect(text).toContain(`# TYPE ${WOC_BANK_LEDGER_TAIL} gauge`);
    expect(text).toContain(`# TYPE ${WOC_BANK_LEDGER_TAIL_DROPPED_ROWS_TOTAL} counter`);
    // The stub returns depth 12 (queued ops) and rows 240 (the ledger rows
    // those ops carry): one instantaneous occupancy arm per FIFO cap.
    expect(sampleValue(text, /^woc_bank_ledger_tail\{measure="depth"\} (\d+)$/m)).toBe('12');
    expect(sampleValue(text, /^woc_bank_ledger_tail\{measure="rows"\} (\d+)$/m)).toBe('240');
    // The lifetime drop total is its OWN counter, never a measure on the
    // gauge: rate()/increase() must read correctly across a realm restart,
    // and a monotonic arm inside an instantaneous family breaks both reads.
    expect(labelValues(text, 'measure', WOC_BANK_LEDGER_TAIL)).toEqual(new Set(['depth', 'rows']));
    expect(sampleValue(text, /^woc_bank_ledger_tail_dropped_rows_total (\d+)$/m)).toBe('5');
    // The retired mixed shape stays retired.
    expect(text).not.toMatch(/^woc_bank_ledger_tail\{measure="dropped_rows"\}/m);
  });

  it('exports the dedicated-side-pool backend cancels as two counters', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();
    expect(WOC_DB_BACKEND_CANCEL_REQUESTS_TOTAL).toBe('woc_db_backend_cancel_requests_total');
    expect(WOC_DB_BACKEND_CANCEL_FAILURES_TOTAL).toBe('woc_db_backend_cancel_failures_total');
    expect(text).toContain(`# TYPE ${WOC_DB_BACKEND_CANCEL_REQUESTS_TOTAL} counter`);
    expect(text).toContain(`# TYPE ${WOC_DB_BACKEND_CANCEL_FAILURES_TOTAL} counter`);
    // The stub returns requested 3, failed 1: a rising requested rate is the
    // wall-deadline saturation precursor, failed (a SUBSET of requested) means
    // even the sub-second cancel path could not reach PostgreSQL. Distinct
    // counters, per dimension: a swap would misdirect an operator mid-incident.
    expect(sampleValue(text, /^woc_db_backend_cancel_requests_total (\d+)$/m)).toBe('3');
    expect(sampleValue(text, /^woc_db_backend_cancel_failures_total (\d+)$/m)).toBe('1');
    // The old mixed gauge family is gone whole: an alert rule reading the
    // retired name must find no series at all rather than a stale one.
    expect(text).not.toContain('woc_db_backend_cancels');
    // Positive control for that absence pin: the LIVE family name is present
    // in the same scrape text, so the retired-name check cannot pass
    // vacuously against an empty or renamed exposition.
    expect(text).toContain('woc_db_backend_cancel_requests_total');
  });

  it('re-syncs the scrape-time lifetime counters from the source on every scrape', async () => {
    const registry = new Registry();
    let cancels = { requested: 3, failed: 1 };
    let tail = { depth: 12, rows: 240, droppedRows: 5 };
    registerGameStateMetrics(
      registry,
      stubSource({
        dbBackendCancels: () => cancels,
        bankLedgerTail: () => tail,
      }),
    );
    const first = await registry.metrics();
    expect(sampleValue(first, /^woc_db_backend_cancel_requests_total (\d+)$/m)).toBe('3');
    expect(sampleValue(first, /^woc_bank_ledger_tail_dropped_rows_total (\d+)$/m)).toBe('5');
    // The source totals grow while the tail drains: the counters must track
    // the source (synced at scrape time, not sampled once at registration),
    // and the occupancy gauge must fall with the drain.
    cancels = { requested: 7, failed: 2 };
    tail = { depth: 0, rows: 0, droppedRows: 9 };
    const second = await registry.metrics();
    expect(sampleValue(second, /^woc_db_backend_cancel_requests_total (\d+)$/m)).toBe('7');
    expect(sampleValue(second, /^woc_db_backend_cancel_failures_total (\d+)$/m)).toBe('2');
    expect(sampleValue(second, /^woc_bank_ledger_tail_dropped_rows_total (\d+)$/m)).toBe('9');
    expect(sampleValue(second, /^woc_bank_ledger_tail\{measure="depth"\} (\d+)$/m)).toBe('0');
    expect(sampleValue(second, /^woc_bank_ledger_tail\{measure="rows"\} (\d+)$/m)).toBe('0');
  });

  it('exports bounded quota pool, listener, cache, call, and duration observability', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(
      registry,
      stubSource({
        generalChatQuotaDbPool: () => ({ total: 2, idle: 1, waiting: 0 }),
        generalChatQuotaCachedAccounts: () => 9,
        generalChatQuotaListener: () => ({
          connected: 1,
          reconnects: 3,
          pendingRefreshes: 4,
        }),
      }),
    );
    counters.generalChatQuotaDbCall('query_timeout', 0.25);
    const text = await registry.metrics();

    expect(labelValues(text, 'outcome', WOC_GENERAL_CHAT_QUOTA_DB_CALLS_TOTAL)).toEqual(
      new Set(GENERAL_CHAT_QUOTA_DB_OUTCOMES),
    );
    expect(sampleValue(text, /^woc_general_chat_quota_db_pool\{state="total"\} (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^woc_general_chat_quota_db_pool\{state="idle"\} (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^woc_general_chat_quota_db_pool\{state="waiting"\} (\d+)$/m)).toBe(
      '0',
    );
    expect(labelValues(text, 'state', WOC_GENERAL_CHAT_QUOTA_DB_POOL)).toEqual(
      new Set(['total', 'idle', 'waiting']),
    );
    expect(labelValues(text, 'measure', WOC_GENERAL_CHAT_QUOTA_LISTENER)).toEqual(
      new Set(['connected', 'reconnects', 'pending_refreshes']),
    );
    expect(
      sampleValue(text, /^woc_general_chat_quota_listener\{measure="reconnects"\} (\d+)$/m),
    ).toBe('3');
    expect(sampleValue(text, /^woc_general_chat_quota_cache_accounts (\d+)$/m)).toBe('9');
    expect(
      sampleValue(
        text,
        /^woc_general_chat_quota_db_calls_total\{outcome="query_timeout"\} (\d+)$/m,
      ),
    ).toBe('1');
    expect(
      sampleValue(
        text,
        /^woc_general_chat_quota_db_duration_seconds_sum\{outcome="query_timeout"\} (\S+)$/m,
      ),
    ).toBe('0.25');
    expect(WOC_GENERAL_CHAT_QUOTA_DB_DURATION_SECONDS).toBe(
      'woc_general_chat_quota_db_duration_seconds',
    );
    expect(WOC_GENERAL_CHAT_QUOTA_CACHE_ACCOUNTS).toBe('woc_general_chat_quota_cache_accounts');
  });

  it('reflects a fresh source read on every scrape (no drift)', async () => {
    const registry = new Registry();
    let players = 1;
    // The two write-path rider gauges ride this pin too: both are documented
    // as LIVE reads at scrape time, and a stub-value assertion alone would
    // stay green if either were hoisted out of collect() and sampled once.
    let pendingKeys = 2;
    let gateInFlight = 1;
    let backgroundDbGate = {
      inFlight: 1,
      waiting: 2,
      max: 8,
      configuredHeadroom: 2,
      acquired: 3,
      refused: 4,
      cancelled: 5,
    };
    let storageRecovery = {
      tracked: 1,
      scanActive: 2,
      scanQueued: 3,
      driveActive: 4,
      driveQueued: 5,
      retryTimers: 6,
      oldestTrackedAgeMs: 7_000,
      oldestQueuedAgeMs: 8_000,
      oldestActiveAgeMs: 9_000,
      activePastSlotTarget: 10,
      horizonBreached: false,
      capacityRefusals: 11,
      retriesScheduled: 12,
      horizonBreaches: 13,
    };
    expect(observeBankLedgerGrowthBudget(130, 10_000_000, Date.now())).toBe(true);
    registerGameStateMetrics(
      registry,
      stubSource({
        playersOnline: () => players,
        savePendingKeys: () => pendingKeys,
        escrowGateInFlight: () => gateInFlight,
        backgroundDbGate: () => backgroundDbGate,
        storageRecovery: () => storageRecovery,
      }),
    );

    const first = await registry.metrics();
    expect(sampleValue(first, /^woc_players_online (\d+)$/m)).toBe('1');
    expect(sampleValue(first, /^woc_character_save_pending_keys (\d+)$/m)).toBe('2');
    expect(sampleValue(first, /^woc_escrow_gate_in_flight (\d+)$/m)).toBe('1');
    expect(measureValues(first, WOC_BACKGROUND_DB_GATE)).toMatchObject({
      in_flight: '1',
      waiting: '2',
    });
    expect(measureValues(first, WOC_STORAGE_RECOVERY)).toMatchObject({
      horizon_breached: '0',
      oldest_tracked_seconds: '7',
      tracked: '1',
    });
    expect(measureValues(first, WOC_BANK_LEDGER_GROWTH_BUDGET)).toMatchObject({
      lifetime_inserted_rows: '130',
    });
    players = 9;
    pendingKeys = 7;
    gateInFlight = 4;
    backgroundDbGate = {
      inFlight: 6,
      waiting: 7,
      max: 9,
      configuredHeadroom: 3,
      acquired: 8,
      refused: 9,
      cancelled: 10,
    };
    storageRecovery = {
      tracked: 14,
      scanActive: 15,
      scanQueued: 16,
      driveActive: 17,
      driveQueued: 18,
      retryTimers: 19,
      oldestTrackedAgeMs: 20_000,
      oldestQueuedAgeMs: 21_000,
      oldestActiveAgeMs: 22_000,
      activePastSlotTarget: 23,
      horizonBreached: true,
      capacityRefusals: 24,
      retriesScheduled: 25,
      horizonBreaches: 26,
    };
    expect(observeBankLedgerGrowthBudget(131, 10_000_000, Date.now())).toBe(true);
    const second = await registry.metrics();
    expect(sampleValue(second, /^woc_players_online (\d+)$/m)).toBe('9');
    expect(sampleValue(second, /^woc_character_save_pending_keys (\d+)$/m)).toBe('7');
    expect(sampleValue(second, /^woc_escrow_gate_in_flight (\d+)$/m)).toBe('4');
    expect(measureValues(second, WOC_BACKGROUND_DB_GATE)).toMatchObject({
      in_flight: '6',
      waiting: '7',
    });
    expect(measureValues(second, WOC_STORAGE_RECOVERY)).toMatchObject({
      horizon_breached: '1',
      oldest_tracked_seconds: '20',
      tracked: '14',
    });
    expect(measureValues(second, WOC_BANK_LEDGER_GROWTH_BUDGET)).toMatchObject({
      lifetime_inserted_rows: '131',
    });
  });

  it('maps a null tick Hz (rate-meter warmup) to 0 rather than omitting the series', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource({ simTickHz: () => null }));
    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_sim_tick_hz (\d+)$/m)).toBe('0');
  });

  // LAST in this describe on purpose: the budget readout is module-global and
  // monotonic, so observing 9,000,000 here would pin every earlier
  // lifetime_inserted_rows assertion at this value if it ran first.
  it('flips limit_warning to 1 when the observation crosses the warn fraction', async () => {
    expect(observeBankLedgerGrowthBudget(9_000_000, 10_000_000, Date.now())).toBe(true);
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    expect(
      sampleValue(
        text,
        /^woc_bank_ledger_growth_budget\{measure="lifetime_inserted_rows"\} (\d+)$/m,
      ),
    ).toBe('9000000');
    // 9,000,000 of 10,000,000 is past the 0.8 warn fraction: the alertable
    // 0/1 signal an operator pages on before the ceiling refuses saves.
    expect(
      sampleValue(text, /^woc_bank_ledger_growth_budget\{measure="limit_warning"\} (\d+)$/m),
    ).toBe('1');
  });
});

describe('registerGameStateMetrics: woc_sim_tick_phase_seconds', () => {
  const phases: Record<string, TickPhaseMillis> = {
    total: { p95: 3, max: 8 },
    tick: { p95: 1.5, max: 4 },
    // An unknown / detailed sub-phase the profiler may report: must be skipped so
    // the exported label set can never grow past WOC_TICK_PHASES.
    'sim.market': { p95: 99, max: 200 },
  };

  it('converts milliseconds to seconds and labels by phase and stat', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource({ tickPhaseMillis: () => phases }));
    const text = await registry.metrics();

    expect(WOC_SIM_TICK_PHASE_SECONDS).toBe('woc_sim_tick_phase_seconds');
    expect(text).toContain(`# TYPE ${WOC_SIM_TICK_PHASE_SECONDS} gauge`);

    // 3 ms p95 -> 0.003 s, 8 ms max -> 0.008 s for the `total` phase.
    expect(
      sampleValue(text, /^woc_sim_tick_phase_seconds\{phase="total",stat="p95"\} (\S+)$/m),
    ).toBe('0.003');
    expect(
      sampleValue(text, /^woc_sim_tick_phase_seconds\{phase="total",stat="max"\} (\S+)$/m),
    ).toBe('0.008');
    expect(
      sampleValue(text, /^woc_sim_tick_phase_seconds\{phase="tick",stat="p95"\} (\S+)$/m),
    ).toBe('0.0015');
  });

  it('keeps the label set bounded: only WOC_TICK_PHASES x {p95,max}, unknown phases skipped', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource({ tickPhaseMillis: () => phases }));
    const text = await registry.metrics();

    // Two known phases reported (total, tick) x two stats = four series; the unknown
    // sim.market phase is dropped.
    expect(tickPhaseSeries(text)).toHaveLength(4);
    expect(labelValues(text, 'phase')).toEqual(new Set(['total', 'tick']));
    expect(labelValues(text, 'stat')).toEqual(new Set(['p95', 'max']));

    // Every exposed phase label is a member of the fixed set (bounded by construction).
    for (const phase of labelValues(text, 'phase')) {
      expect(WOC_TICK_PHASES).toContain(phase);
    }
  });
});

describe('registerGameStateMetrics: throughput counters via the returned sink', () => {
  it('exposes each counter under its exact exported name and increments through the sink', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    expect(WOC_WS_MESSAGES_TOTAL).toBe('woc_ws_messages_total');
    expect(WOC_CHAT_MESSAGES_TOTAL).toBe('woc_chat_messages_total');
    expect(WOC_CHARACTERS_CREATED_TOTAL).toBe('woc_characters_created_total');
    expect(WOC_BANK_LEDGER_GROWTH_LIMIT_REFUSALS_TOTAL).toBe(
      'woc_bank_ledger_growth_limit_refusals_total',
    );

    counters.wsMessage('in');
    counters.wsMessage('in');
    counters.wsMessage('out');
    counters.chatMessage();
    counters.characterCreated();
    counters.bankLedgerGrowthLimitRefused();
    counters.characterCreated();
    counters.characterCreated();

    const text = await registry.metrics();
    for (const name of [
      WOC_WS_MESSAGES_TOTAL,
      WOC_CHAT_MESSAGES_TOTAL,
      WOC_GENERAL_CHAT_QUOTA_TOTAL,
      WOC_GENERAL_CHAT_QUOTA_DB_CALLS_TOTAL,
      WOC_CHARACTERS_CREATED_TOTAL,
      WOC_BANK_LEDGER_GROWTH_LIMIT_REFUSALS_TOTAL,
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }

    expect(sampleValue(text, /^woc_ws_messages_total\{direction="in"\} (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^woc_ws_messages_total\{direction="out"\} (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^woc_chat_messages_total (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^woc_characters_created_total (\d+)$/m)).toBe('3');
    expect(sampleValue(text, /^woc_bank_ledger_growth_limit_refusals_total (\d+)$/m)).toBe('1');
  });

  it('pre-registers every drop cause series and the kick and missed counters at zero', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    // Scrape BEFORE any sink call: prom counters cannot backfill a scrape, so a
    // dashboard must see every series from boot. Every WS_DROP_CAUSES series
    // and the two unlabeled counters all expose an explicit 0.
    const text = await registry.metrics();

    expect(WOC_WS_MESSAGES_DROPPED_TOTAL).toBe('woc_ws_messages_dropped_total');
    expect(WOC_WS_RATE_KICKS_TOTAL).toBe('woc_ws_rate_kicks_total');
    expect(WOC_INPUT_FRAMES_MISSED_TOTAL).toBe('woc_input_frames_missed_total');
    for (const name of [
      WOC_WS_MESSAGES_DROPPED_TOTAL,
      WOC_WS_RATE_KICKS_TOTAL,
      WOC_INPUT_FRAMES_MISSED_TOTAL,
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }

    expect(WS_DROP_CAUSES).toEqual([
      'rate',
      'bytes',
      'lane_movement',
      'lane_command',
      'lane_chat',
      'list_read',
      'bank_vault',
      'guild_bank',
      'cosmetic',
    ]);
    for (const cause of WS_DROP_CAUSES) {
      expect(
        sampleValue(
          text,
          new RegExp(`^woc_ws_messages_dropped_total\\{cause="${cause}"\\} (\\d+)$`, 'm'),
        ),
      ).toBe('0');
    }
    expect(sampleValue(text, /^woc_ws_rate_kicks_total (\d+)$/m)).toBe('0');
    expect(sampleValue(text, /^woc_input_frames_missed_total (\d+)$/m)).toBe('0');
  });

  it('increments the drop, kick, and seq-gap counters through the sink', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.wsMessageDropped('rate');
    counters.wsMessageDropped('rate');
    counters.wsMessageDropped('bytes');
    counters.wsMessageDropped('lane_movement');
    counters.wsMessageDropped('lane_chat');
    counters.wsMessageDropped('list_read');
    counters.wsMessageDropped('bank_vault');
    counters.wsRateKick();
    // The seq-gap sink adds the whole observed gap, not one per call.
    counters.wsInputSeqGap(7);
    counters.wsInputSeqGap(2);

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="rate"\} (\d+)$/m)).toBe('2');
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="bytes"\} (\d+)$/m)).toBe('1');
    expect(
      sampleValue(text, /^woc_ws_messages_dropped_total\{cause="lane_movement"\} (\d+)$/m),
    ).toBe('1');
    expect(
      sampleValue(text, /^woc_ws_messages_dropped_total\{cause="lane_command"\} (\d+)$/m),
    ).toBe('0');
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="lane_chat"\} (\d+)$/m)).toBe(
      '1',
    );
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="list_read"\} (\d+)$/m)).toBe(
      '1',
    );
    expect(sampleValue(text, /^woc_ws_messages_dropped_total\{cause="bank_vault"\} (\d+)$/m)).toBe(
      '1',
    );
    expect(sampleValue(text, /^woc_ws_rate_kicks_total (\d+)$/m)).toBe('1');
    expect(sampleValue(text, /^woc_input_frames_missed_total (\d+)$/m)).toBe('9');
  });

  it('keeps the cause label bounded to the fixed nine values', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.wsMessageDropped('rate');
    counters.wsMessageDropped('lane_command');
    const text = await registry.metrics();
    expect(labelValues(text, 'cause')).toEqual(new Set(WS_DROP_CAUSES));
  });

  it('pre-registers every guild bank incident kind at zero and increments by kind', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    expect(WOC_GUILD_BANK_INCIDENTS_TOTAL).toBe('woc_guild_bank_incidents_total');
    // The whole vocabulary, pinned as literals: these are the series operators
    // alert on, so a rename must fail here rather than silently retire a rule.
    expect(GUILD_BANK_INCIDENTS).toEqual([
      'escrow_save_failed',
      // A refusal that will RETRY is ordinary concurrency, not a failure, and
      // it has its own kind so an operator alerting on escrow_save_failed > 0
      // is not drowned in it.
      'escrow_refused_retry',
      'save_fenced_out',
      'escrow_quarantined',
      'reconcile',
      'book_unloaded',
      'ledger_write_failed',
      // A guild bank op that moved a purse while the book stood still: the
      // dupe signature the bank_ledger counterparty columns exist to surface.
      'counterparty_orphan',
      // A guild row written with no counterparty side at all, whose NULL would
      // otherwise be indistinguishable from a pre-feature row forever.
      'counterparty_unstamped',
      // The officer-visible activity log's read failed. Its own kind because
      // the refusal frame a player receives is byte-identical for "you are not
      // an officer" and "the query failed", so without this a total read outage
      // looks exactly like ordinary refusals at the wire.
      'log_read_failed',
      // Legacy cardinality: the current atomic path cannot create an unpaid
      // guild, so any new sample is a mixed-release/invariant defect.
      'create_fee_unpaid',
    ]);

    // Scrape BEFORE any increment: an alert rule cannot fire on a series that
    // does not exist yet, so every kind must expose an explicit 0 from boot.
    const zeroed = await registry.metrics();
    expect(zeroed).toContain(`# TYPE ${WOC_GUILD_BANK_INCIDENTS_TOTAL} counter`);
    for (const kind of GUILD_BANK_INCIDENTS) {
      expect(
        sampleValue(
          zeroed,
          new RegExp(`^woc_guild_bank_incidents_total\\{kind="${kind}"\\} (\\d+)$`, 'm'),
        ),
        kind,
      ).toBe('0');
    }

    counters.guildBankIncident('reconcile');
    counters.guildBankIncident('reconcile');
    counters.guildBankIncident('ledger_write_failed');

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_guild_bank_incidents_total\{kind="reconcile"\} (\d+)$/m)).toBe(
      '2',
    );
    expect(
      sampleValue(text, /^woc_guild_bank_incidents_total\{kind="ledger_write_failed"\} (\d+)$/m),
    ).toBe('1');
    // Untouched kinds stay at their pre-registered zero, never absent.
    expect(
      sampleValue(text, /^woc_guild_bank_incidents_total\{kind="escrow_save_failed"\} (\d+)$/m),
    ).toBe('0');
    // The kind label's vocabulary is exactly the closed set: no guild id, no
    // character id, nothing per-player ever reaches a label.
    expect(labelValues(text, 'kind', WOC_GUILD_BANK_INCIDENTS_TOTAL)).toEqual(
      new Set(GUILD_BANK_INCIDENTS),
    );
  });

  it('pre-registers every vault ledger incident kind at zero and increments by kind', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    expect(WOC_VAULT_LEDGER_INCIDENTS_TOTAL).toBe('woc_vault_ledger_incidents_total');
    // Its own metric, never a kind on the guild series: the vault is a personal
    // per-character store, so a guild-bank alert rule must not fire on it.
    expect(WOC_VAULT_LEDGER_INCIDENTS_TOTAL).not.toBe(WOC_GUILD_BANK_INCIDENTS_TOTAL);
    // The whole vocabulary, pinned as literals, for the guild set's reason: a
    // rename must fail here rather than silently retire an alert rule.
    expect(VAULT_LEDGER_INCIDENTS).toEqual(['ledger_write_failed']);

    // Scrape BEFORE any increment: an alert rule cannot fire on a series that
    // does not exist yet, so every kind must expose an explicit 0 from boot.
    const zeroed = await registry.metrics();
    expect(zeroed).toContain(`# TYPE ${WOC_VAULT_LEDGER_INCIDENTS_TOTAL} counter`);
    for (const kind of VAULT_LEDGER_INCIDENTS) {
      expect(
        sampleValue(
          zeroed,
          new RegExp(`^woc_vault_ledger_incidents_total\\{kind="${kind}"\\} (\\d+)$`, 'm'),
        ),
        kind,
      ).toBe('0');
    }

    counters.vaultLedgerIncident('ledger_write_failed');
    counters.vaultLedgerIncident('ledger_write_failed');

    const text = await registry.metrics();
    expect(
      sampleValue(text, /^woc_vault_ledger_incidents_total\{kind="ledger_write_failed"\} (\d+)$/m),
    ).toBe('2');
    // The kind label's vocabulary is exactly the closed set: no character id,
    // nothing per-player ever reaches a label.
    expect(labelValues(text, 'kind', WOC_VAULT_LEDGER_INCIDENTS_TOTAL)).toEqual(
      new Set(VAULT_LEDGER_INCIDENTS),
    );
    // The vault sink never touches the guild series (and vice versa): the two
    // containers are alerted on independently.
    expect(
      sampleValue(text, /^woc_guild_bank_incidents_total\{kind="ledger_write_failed"\} (\d+)$/m),
    ).toBe('0');
  });

  it('pre-registers every escrow-queue outcome at zero and increments by kind', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    expect(WOC_ESCROW_QUEUE_TOTAL).toBe('woc_escrow_queue_total');
    // The whole vocabulary as literals: the refusal kinds are the production
    // readout for the listing FIFO coupling (a refused or slow queue is
    // otherwise visible only as a throttled warn line), so a rename must fail
    // here rather than silently retire an operator's alert rule.
    expect(WOC_ESCROW_QUEUE_OUTCOMES).toEqual([
      // The throughput baseline the failure kinds are read against: a
      // refusal rate means nothing without the jobs that started.
      'started',
      // Waited past the queue deadline. Nothing was extracted (the job is
      // cancelled before it runs), so this is contention, not loss.
      'deadline_refused',
      // The one-job-per-character depth cap refused a second listing.
      'depth_refused',
      // Dirty guild books could not be flushed first, so the job never ran:
      // flushing from inside the job would self-deadlock the FIFO.
      'books_dirty_refused',
      // The pre-job guild-book flush itself failed.
      'flush_failed',
      // The realm-global escrow gate was at cap (the write-path rider's
      // bound): realm-wide saturation the per-character kinds cannot see.
      'realm_refused',
      // The terminal sibling: a held listing sequence released its slot,
      // whatever its outcome (the vocabulary doc owns the honest in-flight
      // arithmetic; the gate stats are the instantaneous truth).
      'settled',
      // The delivered-save twin's head-of-line park: the bounded grant
      // entry found the buyer's FIFO wedged past its deadline (the one
      // failure mode the FIFO close introduced, counted so never silent).
      'grant_busy',
      // The background-gate starvation arm inside the FIFO job: the bounded
      // majorBackgroundDbGate wait returned no permit, so the settled
      // caller's background chain terminated without running. Counted
      // because a saturated gate was otherwise invisible here.
      'permit_refused',
    ]);

    // Scrape BEFORE any increment: prom counters cannot backfill, so a rate
    // rule over these series has to see them from boot, not from the first
    // refusal (which is exactly the moment nobody wants a gap).
    const zeroed = await registry.metrics();
    expect(zeroed).toContain(`# TYPE ${WOC_ESCROW_QUEUE_TOTAL} counter`);
    // The operator-facing HELP line enumerates the kinds by hand, so it is
    // tied to the vocabulary here: without this a ninth kind leaves the help
    // stale while the exact-vocabulary pin above stays green, and the help is
    // the only place an operator reads what the labels mean.
    const helpLine = zeroed
      .split('\n')
      .find((l) => l.startsWith(`# HELP ${WOC_ESCROW_QUEUE_TOTAL}`));
    expect(helpLine, 'the escrow-queue counter carries a HELP line').toBeDefined();
    for (const kind of WOC_ESCROW_QUEUE_OUTCOMES) {
      expect(helpLine, `HELP names the ${kind} kind`).toContain(kind);
    }
    for (const kind of WOC_ESCROW_QUEUE_OUTCOMES) {
      expect(
        sampleValue(zeroed, new RegExp(`^woc_escrow_queue_total\\{kind="${kind}"\\} (\\d+)$`, 'm')),
        kind,
      ).toBe('0');
    }

    counters.wocEscrowQueue('started');
    counters.wocEscrowQueue('started');
    counters.wocEscrowQueue('started');
    counters.wocEscrowQueue('depth_refused');

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_escrow_queue_total\{kind="started"\} (\d+)$/m)).toBe('3');
    expect(sampleValue(text, /^woc_escrow_queue_total\{kind="depth_refused"\} (\d+)$/m)).toBe('1');
    // Each outcome lands on its OWN series: a depth refusal is not a deadline
    // refusal, and the untouched kinds stay at their pre-registered zero.
    expect(sampleValue(text, /^woc_escrow_queue_total\{kind="deadline_refused"\} (\d+)$/m)).toBe(
      '0',
    );
    expect(sampleValue(text, /^woc_escrow_queue_total\{kind="books_dirty_refused"\} (\d+)$/m)).toBe(
      '0',
    );
    expect(sampleValue(text, /^woc_escrow_queue_total\{kind="flush_failed"\} (\d+)$/m)).toBe('0');
    // The other direction: the exposed vocabulary is exactly the closed set, so
    // no character id, listing id, or account ever reaches a label.
    expect(labelValues(text, 'kind', WOC_ESCROW_QUEUE_TOTAL)).toEqual(
      new Set(WOC_ESCROW_QUEUE_OUTCOMES),
    );
  });

  it('swallows a throwing counter in every sink method and never propagates', () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    // The seam's stated contract: an observability write must never break the
    // path it measures. Force each underlying prom counter's inc to throw and
    // prove every sink method swallows it.
    for (const name of [
      WOC_WS_MESSAGES_TOTAL,
      WOC_WS_MESSAGES_DROPPED_TOTAL,
      WOC_WS_RATE_KICKS_TOTAL,
      WOC_INPUT_FRAMES_MISSED_TOTAL,
      WOC_CHAT_MESSAGES_TOTAL,
      WOC_CHARACTERS_CREATED_TOTAL,
      WOC_BANK_LEDGER_GROWTH_LIMIT_REFUSALS_TOTAL,
      WOC_COPPER_CREDITED_TOTAL,
      WOC_COPPER_SPENT_TOTAL,
      WOC_GATHER_HARVESTS_TOTAL,
      WOC_FISHING_CASTS_TOTAL,
      WOC_FISHING_CATCHES_TOTAL,
      WOC_FISHING_KOI_TOTAL,
      WOC_FISHING_GOT_AWAYS_TOTAL,
      WOC_FISHING_EARLY_REELS_TOTAL,
      WOC_FISHING_EMPTY_HOOKS_TOTAL,
      WOC_ROD_FEE_PAYMENTS_TOTAL,
      WOC_GUILD_BANK_INCIDENTS_TOTAL,
      WOC_VAULT_LEDGER_INCIDENTS_TOTAL,
      WOC_ESCROW_QUEUE_TOTAL,
      WOC_BATTLEGROUND_MATCHES_TOTAL,
      WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL,
      WOC_BATTLEGROUND_CAPTURES_TOTAL,
    ]) {
      const metric = registry.getSingleMetric(name) as unknown as { inc: () => never };
      metric.inc = () => {
        throw new Error('prom exploded');
      };
    }
    const quotaDuration = registry.getSingleMetric(
      WOC_GENERAL_CHAT_QUOTA_DB_DURATION_SECONDS,
    ) as unknown as { observe: () => never };
    quotaDuration.observe = () => {
      throw new Error('prom exploded');
    };

    expect(() => counters.wsMessage('in')).not.toThrow();
    expect(() => counters.wsMessageDropped('rate')).not.toThrow();
    expect(() => counters.wsRateKick()).not.toThrow();
    expect(() => counters.wsInputSeqGap(3)).not.toThrow();
    expect(() => counters.chatMessage()).not.toThrow();
    expect(() => counters.generalChatQuota('allowed')).not.toThrow();
    expect(() => counters.generalChatQuotaDbCall('allowed', 0.1)).not.toThrow();
    expect(() => counters.characterCreated()).not.toThrow();
    expect(() => counters.bankLedgerGrowthLimitRefused()).not.toThrow();
    expect(() => counters.copperCredited('quest', 50)).not.toThrow();
    expect(() => counters.copperSpent('vendor', 20)).not.toThrow();
    expect(() => counters.harvest('mirefen_marsh', '2')).not.toThrow();
    expect(() => counters.fishingCast('mirefen_marsh', '1')).not.toThrow();
    // Both arms of the koi split reach the sink without propagating. (The
    // implementation guards both increments under ONE shared try, so a throw
    // from the first counter would skip the second by design: dropping the
    // whole sample is the module's swallow contract, and this assertion can
    // only observe that nothing escapes.)
    expect(() => counters.fishingCatch('mirefen_marsh', '1', false)).not.toThrow();
    expect(() => counters.fishingCatch('mirefen_marsh', '1', true)).not.toThrow();
    expect(() => counters.fishingGotAway('mirefen_marsh', '1')).not.toThrow();
    expect(() => counters.fishingEarlyReel('mirefen_marsh', '1')).not.toThrow();
    expect(() => counters.fishingEmptyHook('mirefen_marsh', '1')).not.toThrow();
    expect(() => counters.rodFeePaid(ROD_FEE_RECIPE_IDS[0])).not.toThrow();
    expect(() => counters.guildBankIncident('reconcile')).not.toThrow();
    expect(() => counters.vaultLedgerIncident('ledger_write_failed')).not.toThrow();
    // The escrow-queue counter sits on the listing request path: a prom failure
    // there must never turn an observable refusal into a thrown 500.
    expect(() => counters.wocEscrowQueue('started')).not.toThrow();
    expect(() => counters.wocEscrowQueue('deadline_refused')).not.toThrow();
  });

  it('bounds the ws direction label to in/out and emits no per-player label anywhere', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(
      registry,
      stubSource({ tickPhaseMillis: () => ({ total: { p95: 1, max: 2 } }) }),
    );
    counters.wsMessage('in');
    counters.wsMessage('out');
    const text = await registry.metrics();

    expect(labelValues(text, 'direction')).toEqual(new Set(['in', 'out']));
    // Cardinality rule: nothing request- or player-derived is ever a label.
    for (const forbidden of [
      'account',
      'account_id',
      'player',
      'player_id',
      'session',
      'session_id',
      'character',
      'character_id',
      'ip',
      'name',
    ]) {
      expect(labelValues(text, forbidden).size).toBe(0);
    }
  });
});

describe('registerGameStateMetrics: economy telemetry counters', () => {
  it('pre-registers every copper source and harvest band series at zero', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    // Scrape BEFORE any sink call: prom counters cannot backfill, so every
    // economic surface and every band must be visible from boot rather than
    // appearing the first time a player earns a coin or swings a pick.
    const text = await registry.metrics();

    expect(WOC_COPPER_CREDITED_TOTAL).toBe('woc_copper_credited_total');
    expect(WOC_COPPER_SPENT_TOTAL).toBe('woc_copper_spent_total');
    expect(WOC_GATHER_HARVESTS_TOTAL).toBe('woc_gather_harvests_total');
    for (const name of [
      WOC_COPPER_CREDITED_TOTAL,
      WOC_COPPER_SPENT_TOTAL,
      WOC_GATHER_HARVESTS_TOTAL,
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }
    for (const source of COPPER_FLOW_SOURCES) {
      for (const name of [WOC_COPPER_CREDITED_TOTAL, WOC_COPPER_SPENT_TOTAL]) {
        expect(
          sampleValue(text, new RegExp(`^${name}\\{source="${source}"\\} (\\d+)$`, 'm')),
          `${name} ${source}`,
        ).toBe('0');
      }
    }
    // The WHOLE zone x tier cross product (R31), not just the combos live
    // content fills: Eastbrook ships no tier-3 ground, and that series has to
    // read as an explicit zero rather than be missing.
    expect([...NODE_TIERS]).toEqual(['1', '2', '3']);
    let seeded = 0;
    for (const band of HARVEST_BANDS) {
      for (const tier of NODE_TIERS) {
        expect(
          sampleValue(
            text,
            new RegExp(
              `^woc_gather_harvests_total\\{band="${band}",tier="${tier}"\\} (\\d+)$`,
              'm',
            ),
          ),
          `${band} tier ${tier}`,
        ).toBe('0');
        seeded++;
      }
    }
    expect(seeded).toBe(HARVEST_BANDS.length * NODE_TIERS.length);
    // And nothing BEYOND the cross product: a bare {band=} series would mean
    // an un-labeled emission site slipped past the tier thread-through.
    expect(harvestSeries(text)).toHaveLength(seeded);
  });

  it('increments copper by amount and harvests by one, each under its own label', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.copperCredited('quest', 150);
    counters.copperCredited('quest', 50);
    counters.copperCredited('loot', 7);
    counters.copperSpent('vendor', 20);
    counters.harvest('mirefen_marsh', '2');
    counters.harvest('mirefen_marsh', '2');
    counters.harvest('thornpeak_heights', '3');
    // Same zone, different tier: the two must land on different series, which
    // is the whole point of the tier label (R31's traveler-versus-capped read).
    counters.harvest('thornpeak_heights', '1');

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_copper_credited_total\{source="quest"\} (\d+)$/m)).toBe('200');
    expect(sampleValue(text, /^woc_copper_credited_total\{source="loot"\} (\d+)$/m)).toBe('7');
    // Untouched surfaces stay at their pre-registered zero rather than drifting.
    expect(sampleValue(text, /^woc_copper_credited_total\{source="vendor"\} (\d+)$/m)).toBe('0');
    expect(sampleValue(text, /^woc_copper_spent_total\{source="vendor"\} (\d+)$/m)).toBe('20');
    expect(sampleValue(text, /^woc_copper_spent_total\{source="quest"\} (\d+)$/m)).toBe('0');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="mirefen_marsh",tier="2"\} (\d+)$/m),
    ).toBe('2');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="thornpeak_heights",tier="3"\} (\d+)$/m),
    ).toBe('1');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="thornpeak_heights",tier="1"\} (\d+)$/m),
    ).toBe('1');
    // The zone's OTHER tiers stay at zero: the tier label splits the zone
    // total rather than being ignored and folded back into one series.
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="mirefen_marsh",tier="1"\} (\d+)$/m),
    ).toBe('0');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="thornpeak_heights",tier="2"\} (\d+)$/m),
    ).toBe('0');
    expect(
      sampleValue(text, /^woc_gather_harvests_total\{band="eastbrook_vale",tier="1"\} (\d+)$/m),
    ).toBe('0');
  });

  it('drops a non-positive or non-finite copper amount instead of corrupting the series', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    // A counter can only go up. These are caller bugs, and the sink's job is to
    // keep them out of the exposition rather than throw inside a command path.
    counters.copperCredited('quest', 0);
    counters.copperCredited('quest', -5);
    counters.copperCredited('quest', Number.NaN);
    counters.copperSpent('vendor', Number.POSITIVE_INFINITY);
    counters.copperCredited('quest', 10);

    const text = await registry.metrics();
    expect(sampleValue(text, /^woc_copper_credited_total\{source="quest"\} (\d+)$/m)).toBe('10');
    expect(sampleValue(text, /^woc_copper_spent_total\{source="vendor"\} (\d+)$/m)).toBe('0');
  });

  it('emits no label beyond the fixed economy vocabularies', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.copperCredited('quest', 1);
    counters.harvest('eastbrook_vale', '1');

    const text = await registry.metrics();
    const sources = new Set(
      [...text.matchAll(/^woc_copper_(?:credited|spent)_total\{source="([^"]+)"\}/gm)].map(
        (m) => m[1],
      ),
    );
    expect([...sources].sort()).toEqual([...COPPER_FLOW_SOURCES].sort());
    const bands = new Set(
      [...text.matchAll(/^woc_gather_harvests_total\{band="([^"]+)",tier="[^"]+"\}/gm)].map(
        (m) => m[1],
      ),
    );
    expect([...bands].sort()).toEqual([...HARVEST_BANDS].sort());
    const tiers = new Set(
      [...text.matchAll(/^woc_gather_harvests_total\{band="[^"]+",tier="([^"]+)"\}/gm)].map(
        (m) => m[1],
      ),
    );
    expect([...tiers].sort()).toEqual([...NODE_TIERS].sort());
    // No per-player dimension anywhere on these families.
    expect(text).not.toMatch(/woc_(copper|gather)[^\n]*\b(account|character|player|name|ip)=/);
  });

  it('drops an off-vocabulary harvest band or tier instead of minting a series', async () => {
    // HarvestBand is plain string (ZoneDef.id is not literal-typed), so the
    // emitter's membership guard is the only cardinality bound. A retired
    // material band and a player-shaped string must both vanish without a
    // series and without moving any real zone's count.
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.harvest('starter', '1');
    counters.harvest('account:12345', '1');
    // The tier is checked on its own axis: a real zone with a made-up tier is
    // dropped whole rather than counted under the zone's tier-1 series, or the
    // guard would be testable only through the band and could rot on the tier.
    counters.harvest('eastbrook_vale', '9' as never);
    counters.harvest('eastbrook_vale', 'account:12345' as never);

    const text = await registry.metrics();
    expect(text).not.toMatch(/band="starter"/);
    expect(text).not.toMatch(/band="account:12345"/);
    expect(text).not.toMatch(/tier="9"/);
    expect(text).not.toMatch(/tier="account:12345"/);
    for (const band of HARVEST_BANDS) {
      for (const tier of NODE_TIERS) {
        expect(
          sampleValue(
            text,
            new RegExp(
              `^woc_gather_harvests_total\\{band="${band}",tier="${tier}"\\} (\\d+)$`,
              'm',
            ),
          ),
          `${band} tier ${tier}`,
        ).toBe('0');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The fishing family: five outcome counters over the same zone x band label
// pair, plus the rod-fee payment counter and the static fee gauge beside it.
// ---------------------------------------------------------------------------

/** Every woc_fishing_* sample line of one metric (one per zone x band combo). */
function fishingSeries(text: string, name: string): string[] {
  return text.match(new RegExp(`^${name}\\{[^}]*\\} \\d+$`, 'gm')) ?? [];
}

/** One fishing counter's sample value for a zone/band pair, as a string. */
function fishingValue(text: string, name: string, zone: string, band: string): string | undefined {
  return sampleValue(text, new RegExp(`^${name}\\{zone="${zone}",band="${band}"\\} (\\d+)$`, 'm'));
}

/** Every fishing counter's exported metric name, so a sweep covers the family. */
const FISHING_COUNTER_NAMES = [
  WOC_FISHING_CASTS_TOTAL,
  WOC_FISHING_CATCHES_TOTAL,
  WOC_FISHING_KOI_TOTAL,
  WOC_FISHING_GOT_AWAYS_TOTAL,
  WOC_FISHING_EARLY_REELS_TOTAL,
  WOC_FISHING_EMPTY_HOOKS_TOTAL,
];

describe('registerGameStateMetrics: fishing telemetry counters', () => {
  it('exposes each fishing counter under its exact exported name', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    // Literal name pins: a rename must fail here, not merely swap a constant.
    expect(WOC_FISHING_CASTS_TOTAL).toBe('woc_fishing_casts_total');
    expect(WOC_FISHING_CATCHES_TOTAL).toBe('woc_fishing_catches_total');
    expect(WOC_FISHING_KOI_TOTAL).toBe('woc_fishing_koi_total');
    expect(WOC_FISHING_GOT_AWAYS_TOTAL).toBe('woc_fishing_got_aways_total');
    expect(WOC_FISHING_EARLY_REELS_TOTAL).toBe('woc_fishing_early_reels_total');
    expect(WOC_FISHING_EMPTY_HOOKS_TOTAL).toBe('woc_fishing_empty_hooks_total');
    expect(WOC_ROD_FEE_PAYMENTS_TOTAL).toBe('woc_rod_fee_payments_total');
    expect(WOC_ROD_FEE_COPPER).toBe('woc_rod_fee_copper');

    for (const name of [...FISHING_COUNTER_NAMES, WOC_ROD_FEE_PAYMENTS_TOTAL]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }
    expect(text).toContain(`# TYPE ${WOC_ROD_FEE_COPPER} gauge`);
    // The published usage recipe must keep the recipe grouping: the two rod
    // fees differ 4x, so an ungrouped sum() * max() multiplies every training
    // by the single highest fee. The help line is the operator-facing copy of
    // that recipe, so its by (recipe) form is pinned here.
    const helpLine = text.split('\n').find((l) => l.startsWith(`# HELP ${WOC_ROD_FEE_COPPER}`));
    expect(helpLine).toContain('max by (recipe)');
    expect(helpLine).toContain('sum by (recipe)');
  });

  it('pre-registers the whole zone x band cross product of every fishing counter at zero', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    // Scrape BEFORE any sink call: prom counters cannot backfill, so an angler
    // who never appears in a band must read as a real zero, not as a gap.
    const text = await registry.metrics();

    expect([...FISHING_BANDS]).toEqual(['0', '1', '2']);
    const combos = HARVEST_BANDS.length * FISHING_BANDS.length;
    // 15 zones x 3 bands since the Proving Shore tutorial island (was 14 x 3
    // since the v0.32.0 expansion, 3 x 3 before that).
    expect(combos).toBe(45);
    for (const name of FISHING_COUNTER_NAMES) {
      for (const zone of HARVEST_BANDS) {
        for (const band of FISHING_BANDS) {
          expect(fishingValue(text, name, zone, band), `${name} ${zone} ${band}`).toBe('0');
        }
      }
      // Exactly the cross product and nothing else: an un-pre-seeded emission
      // site would add a tenth series the first time it fires.
      expect(fishingSeries(text, name), name).toHaveLength(combos);
    }
  });

  it('pre-registers a payment series and publishes the static fee for every rod recipe', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    // Non-vacuity: the vocabulary is the two shipped rod recipes, and the
    // fee is real copper, so a dashboard multiplying the two gets an amount.
    expect([...ROD_FEE_RECIPE_IDS]).toEqual([
      'recipe_stormreel_fishing_rod',
      'recipe_tidewrought_fishing_rod',
    ]);
    for (const recipe of ROD_FEE_RECIPE_IDS) {
      expect(
        sampleValue(
          text,
          new RegExp(`^woc_rod_fee_payments_total\\{recipe="${recipe}"\\} (\\d+)$`, 'm'),
        ),
        recipe,
      ).toBe('0');
      const fee = rodFeeForRecipe(recipe);
      expect(fee, recipe).toBeGreaterThan(0);
      expect(
        sampleValue(text, new RegExp(`^woc_rod_fee_copper\\{recipe="${recipe}"\\} (\\d+)$`, 'm')),
        recipe,
      ).toBe(String(fee));
    }
    // The two rods do NOT charge the same fee, so the gauge is load-bearing:
    // a single hardcoded constant in a dashboard would be wrong for one of them.
    expect(rodFeeForRecipe('recipe_stormreel_fishing_rod')).not.toBe(
      rodFeeForRecipe('recipe_tidewrought_fishing_rod'),
    );
  });

  it('counts each fishing outcome under its own zone and band', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.fishingCast('eastbrook_vale', '0');
    counters.fishingCast('eastbrook_vale', '0');
    counters.fishingCast('thornpeak_heights', '2');
    counters.fishingCatch('eastbrook_vale', '0', false);
    counters.fishingGotAway('eastbrook_vale', '0');
    counters.fishingEarlyReel('eastbrook_vale', '0');
    counters.fishingEarlyReel('eastbrook_vale', '0');
    counters.fishingEmptyHook('mirefen_marsh', '1');
    counters.fishingEmptyHook('mirefen_marsh', '1');

    const text = await registry.metrics();
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'eastbrook_vale', '0')).toBe('2');
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'thornpeak_heights', '2')).toBe('1');
    // The same zone in a different band is a different series, and vice versa:
    // neither label may be silently folded away.
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'eastbrook_vale', '2')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_CASTS_TOTAL, 'thornpeak_heights', '0')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_CATCHES_TOTAL, 'eastbrook_vale', '0')).toBe('1');
    expect(fishingValue(text, WOC_FISHING_GOT_AWAYS_TOTAL, 'eastbrook_vale', '0')).toBe('1');
    // The early reel moves ONLY its own series: a self-inflicted end folded
    // into the got-aways would bury whether the anti-spam change costs
    // legitimate anglers.
    expect(fishingValue(text, WOC_FISHING_EARLY_REELS_TOTAL, 'eastbrook_vale', '0')).toBe('2');
    expect(fishingValue(text, WOC_FISHING_EMPTY_HOOKS_TOTAL, 'mirefen_marsh', '1')).toBe('2');
    // Each outcome lands on its OWN counter: a cast is not a catch.
    expect(fishingValue(text, WOC_FISHING_CATCHES_TOTAL, 'thornpeak_heights', '2')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_EMPTY_HOOKS_TOTAL, 'eastbrook_vale', '0')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_GOT_AWAYS_TOTAL, 'mirefen_marsh', '1')).toBe('0');
  });

  it('counts a koi in BOTH the catches and the koi counter, never only one', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    // The R4 odds question is koi/catches with identical labels, so the koi
    // counter must be a strict SUBSET of catches: a koi that skipped the
    // catches counter would read as odds above one.
    counters.fishingCatch('mirefen_marsh', '1', true);
    counters.fishingCatch('mirefen_marsh', '1', false);
    counters.fishingCatch('mirefen_marsh', '1', false);
    counters.fishingCatch('mirefen_marsh', '1', false);

    const text = await registry.metrics();
    expect(fishingValue(text, WOC_FISHING_CATCHES_TOTAL, 'mirefen_marsh', '1')).toBe('4');
    expect(fishingValue(text, WOC_FISHING_KOI_TOTAL, 'mirefen_marsh', '1')).toBe('1');
    // A plain catch must NOT touch the koi counter in some other band either.
    expect(fishingValue(text, WOC_FISHING_KOI_TOTAL, 'mirefen_marsh', '0')).toBe('0');
    expect(fishingValue(text, WOC_FISHING_KOI_TOTAL, 'mirefen_marsh', '2')).toBe('0');
  });

  it('counts one rod fee payment per successful training, by recipe', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.rodFeePaid('recipe_stormreel_fishing_rod');
    counters.rodFeePaid('recipe_stormreel_fishing_rod');
    counters.rodFeePaid('recipe_tidewrought_fishing_rod');

    const text = await registry.metrics();
    expect(
      sampleValue(
        text,
        /^woc_rod_fee_payments_total\{recipe="recipe_stormreel_fishing_rod"\} (\d+)$/m,
      ),
    ).toBe('2');
    expect(
      sampleValue(
        text,
        /^woc_rod_fee_payments_total\{recipe="recipe_tidewrought_fishing_rod"\} (\d+)$/m,
      ),
    ).toBe('1');
  });

  it('drops an off-vocabulary zone, band, or recipe instead of minting a series', async () => {
    // Both fishing labels are plain strings at the sink (the zone is a ZoneDef
    // id and the band arrives as a label value), so these membership guards are
    // the family's only cardinality bound.
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());

    counters.fishingCast('account:12345' as never, '0');
    counters.fishingCatch('eastbrook_vale', '7' as never, false);
    counters.fishingCatch('eastbrook_vale', '7' as never, true);
    counters.fishingGotAway('starter' as never, '0');
    counters.fishingEarlyReel('starter' as never, '0');
    counters.fishingEmptyHook('eastbrook_vale', 'toString' as never);
    counters.rodFeePaid('recipe_copper_mining_pick');
    counters.rodFeePaid('toString');
    counters.rodFeePaid('account:12345');

    const text = await registry.metrics();
    expect(text).not.toMatch(/zone="account:12345"/);
    expect(text).not.toMatch(/zone="starter"/);
    expect(text).not.toMatch(/band="7"/);
    expect(text).not.toMatch(/band="toString"/);
    expect(text).not.toMatch(/recipe="recipe_copper_mining_pick"/);
    expect(text).not.toMatch(/recipe="toString"/);
    expect(text).not.toMatch(/recipe="account:12345"/);
    // A dropped sample must not have moved a real series on the way out: an
    // off-vocabulary BAND with a real zone is the arm most likely to leak.
    for (const name of FISHING_COUNTER_NAMES) {
      expect(fishingSeries(text, name), name).toHaveLength(45);
      for (const zone of HARVEST_BANDS) {
        for (const band of FISHING_BANDS) {
          expect(fishingValue(text, name, zone, band), `${name} ${zone} ${band}`).toBe('0');
        }
      }
    }
    for (const recipe of ROD_FEE_RECIPE_IDS) {
      expect(
        sampleValue(
          text,
          new RegExp(`^woc_rod_fee_payments_total\\{recipe="${recipe}"\\} (\\d+)$`, 'm'),
        ),
        recipe,
      ).toBe('0');
    }
  });

  it('emits no per-player label anywhere on the fishing or rod-fee families', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.fishingCast('eastbrook_vale', '0');
    counters.fishingCatch('eastbrook_vale', '0', true);
    counters.rodFeePaid('recipe_stormreel_fishing_rod');

    const text = await registry.metrics();
    // The zone label is bounded to the SAME zone vocabulary the harvest counter
    // uses (one zone list, not two), and the band to the three fishing rungs.
    const zones = new Set(
      [...text.matchAll(/^woc_fishing_\w+\{zone="([^"]+)",band="[^"]+"\}/gm)].map((m) => m[1]),
    );
    expect([...zones].sort()).toEqual([...HARVEST_BANDS].sort());
    const bands = new Set(
      [...text.matchAll(/^woc_fishing_\w+\{zone="[^"]+",band="([^"]+)"\}/gm)].map((m) => m[1]),
    );
    expect([...bands].sort()).toEqual([...FISHING_BANDS].sort());
    const recipes = new Set(
      [...text.matchAll(/^woc_rod_fee_\w*\{?recipe="([^"]+)"\}/gm)].map((m) => m[1]),
    );
    expect([...recipes].sort()).toEqual([...ROD_FEE_RECIPE_IDS].sort());

    // Cardinality rule: nothing player-derived is ever a label on these.
    for (const forbidden of [
      'account',
      'account_id',
      'player',
      'player_id',
      'session',
      'session_id',
      'character',
      'character_id',
      'ip',
      'name',
      // And no realm dimension either: Prometheus attaches realm identity at
      // scrape time, so a per-realm process must expose an identical series set.
      'realm',
      'realm_name',
      'server_name',
    ]) {
      expect(labelValues(text, forbidden).size, forbidden).toBe(0);
    }
    expect(text).not.toMatch(/woc_(fishing|rod)[^\n]*\b(account|character|player|name|ip)=/);
  });
});

describe('guild bank activity log cache readout', () => {
  it('exposes the cache counters as one labeled gauge, read at scrape time', async () => {
    // The REFRESH count is the number the whole design rests on: the cache
    // exists so one answer serves every officer of a guild, and its coalescing
    // floor exists because a naive bust made a busy guild's log uncached
    // exactly when officers read it. None of that is alertable without this.
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const scrape = await registry.metrics();
    expect(scrape).toContain(`# TYPE ${WOC_GUILD_BANK_LOG_CACHE} gauge`);
    expect(scrape).toContain(`${WOC_GUILD_BANK_LOG_CACHE}{kind="refreshes"} 3`);
    expect(scrape).toContain(`${WOC_GUILD_BANK_LOG_CACHE}{kind="reads"} 11`);
    expect(scrape).toContain(`${WOC_GUILD_BANK_LOG_CACHE}{kind="busts"} 4`);
    expect(scrape).toContain(`${WOC_GUILD_BANK_LOG_CACHE}{kind="evictions"} 1`);
    expect(scrape).toContain(`${WOC_GUILD_BANK_LOG_CACHE}{kind="entries"} 2`);
    expect(scrape).toContain(`${WOC_GUILD_BANK_LOG_CACHE}{kind="dirty_guilds"} 1`);
  });

  it('re-reads the source on every scrape (no background sampling, no drift)', async () => {
    let refreshes = 0;
    const registry = new Registry();
    registerGameStateMetrics(
      registry,
      stubSource({
        guildBankLogCache: () => ({
          reads: 0,
          refreshes: refreshes++,
          evictions: 0,
          busts: 0,
          entries: 0,
          dirtyGuilds: 0,
        }),
      }),
    );
    await registry.metrics();
    const second = await registry.metrics();
    expect(second).toContain(`${WOC_GUILD_BANK_LOG_CACHE}{kind="refreshes"} 1`);
  });

  it('exposes the auth-guard cache arms, zero-backfilled before boot and live after', async () => {
    // Literal name pin: a rename must fail here, not merely swap a constant.
    expect(WOC_AUTH_GUARD_CACHE).toBe('woc_auth_guard_cache');
    resetWocAuthGuardCache();
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    // Exact-line matcher (a substring pin on `} 1` also matches 10 or 1.5).
    const line = (metrics: string, arm: string, kind: string): string | undefined =>
      metrics
        .split('\n')
        .find((l) => l.startsWith(`${WOC_AUTH_GUARD_CACHE}{arm="${arm}",kind="${kind}"}`));
    const cold = await registry.metrics();
    // Unarmed (pre-boot): every series exists at zero so an alert rule can
    // fire on its first real sample, the two soft-bound series included.
    for (const arm of ['tokens', 'accounts']) {
      for (const kind of ['reads', 'refreshes', 'evictions', 'busts', 'entries']) {
        expect(line(cold, arm, kind)).toBe(
          `${WOC_AUTH_GUARD_CACHE}{arm="${arm}",kind="${kind}"} 0`,
        );
      }
    }
    expect(line(cold, 'index', 'entries')).toBe(
      `${WOC_AUTH_GUARD_CACHE}{arm="index",kind="entries"} 0`,
    );
    expect(line(cold, 'recent_busts', 'entries')).toBe(
      `${WOC_AUTH_GUARD_CACHE}{arm="recent_busts",kind="entries"} 0`,
    );
    expect(line(cold, 'join_veto', 'refetches')).toBe(
      `${WOC_AUTH_GUARD_CACHE}{arm="join_veto",kind="refetches"} 0`,
    );
    // Armed: the gauge reads the LIVE singleton on every scrape, on BOTH
    // arms and on the soft-bound series.
    try {
      const cache = configureWocAuthGuardCache({
        fetchTokenRow: async () => ({
          accountId: 7,
          scope: 'full',
          expiresAtMs: Date.now() + 3600_000,
        }),
        fetchModerationRow: async () => null,
      });
      await cache.accountAndScopeForToken('a'.repeat(64));
      await cache.moderationStatusForAccount(7);
      cache.bustAccount(8);
      const warm = await registry.metrics();
      expect(line(warm, 'tokens', 'reads')).toBe(
        `${WOC_AUTH_GUARD_CACHE}{arm="tokens",kind="reads"} 1`,
      );
      expect(line(warm, 'tokens', 'entries')).toBe(
        `${WOC_AUTH_GUARD_CACHE}{arm="tokens",kind="entries"} 1`,
      );
      expect(line(warm, 'accounts', 'reads')).toBe(
        `${WOC_AUTH_GUARD_CACHE}{arm="accounts",kind="reads"} 1`,
      );
      expect(line(warm, 'index', 'entries')).toBe(
        `${WOC_AUTH_GUARD_CACHE}{arm="index",kind="entries"} 1`,
      );
      expect(line(warm, 'recent_busts', 'entries')).toBe(
        `${WOC_AUTH_GUARD_CACHE}{arm="recent_busts",kind="entries"} 1`,
      );
    } finally {
      resetWocAuthGuardCache();
    }
  });
});

// ---------------------------------------------------------------------------

/** One battleground counter's sample value for an exact label pair, as a string. */
function bgValue(text: string, name: string, labels: string): string | undefined {
  return sampleValue(text, new RegExp(`^${name}\\{${labels}\\} (\\d+)$`, 'm'));
}

describe('registerGameStateMetrics: Thornhollow Fields match outcomes', () => {
  it('exposes each counter under its exact exported name, pre-seeded at zero', async () => {
    const registry = new Registry();
    registerGameStateMetrics(registry, stubSource());
    const text = await registry.metrics();

    // Literal name pins: a rename must fail here, not merely swap a constant.
    expect(WOC_BATTLEGROUND_MATCHES_TOTAL).toBe('woc_battleground_matches_total');
    expect(WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL).toBe('woc_battleground_duration_seconds_total');
    expect(WOC_BATTLEGROUND_CAPTURES_TOTAL).toBe('woc_battleground_captures_total');
    for (const name of [
      WOC_BATTLEGROUND_MATCHES_TOTAL,
      WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL,
      WOC_BATTLEGROUND_CAPTURES_TOTAL,
    ]) {
      expect(text).toContain(`# TYPE ${name} counter`);
    }
    // The cap-tuning read is a RATIO between two series, so BOTH have to exist
    // from boot: a dashboard comparing timer against caps on a quiet realm must
    // not divide by an absent series.
    expect(bgValue(text, WOC_BATTLEGROUND_MATCHES_TOTAL, 'ending="timer",composition="solo"')).toBe(
      '0',
    );
    expect(
      bgValue(text, WOC_BATTLEGROUND_MATCHES_TOTAL, 'ending="caps",composition="grouped"'),
    ).toBe('0');
    expect(bgValue(text, WOC_BATTLEGROUND_CAPTURES_TOTAL, 'ending="caps",side="high"')).toBe('0');
  });

  it('books one match, its duration, and both ends of the final score', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    counters.battlegroundResolved('timer', 'solo', 720, 2, 1);
    counters.battlegroundResolved('timer', 'solo', 700, 0, 2);
    counters.battlegroundResolved('caps', 'grouped', 415, 3, 1);
    const text = await registry.metrics();

    expect(bgValue(text, WOC_BATTLEGROUND_MATCHES_TOTAL, 'ending="timer",composition="solo"')).toBe(
      '2',
    );
    expect(
      bgValue(text, WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL, 'ending="timer",composition="solo"'),
    ).toBe('1420');
    expect(
      bgValue(text, WOC_BATTLEGROUND_MATCHES_TOTAL, 'ending="caps",composition="grouped"'),
    ).toBe('1');
    // high/low, never crimson/azure: the second timer match had the higher score
    // on the OTHER team, and the sides must not depend on which team that was.
    expect(bgValue(text, WOC_BATTLEGROUND_CAPTURES_TOTAL, 'ending="timer",side="high"')).toBe('4');
    expect(bgValue(text, WOC_BATTLEGROUND_CAPTURES_TOTAL, 'ending="timer",side="low"')).toBe('1');
    expect(bgValue(text, WOC_BATTLEGROUND_CAPTURES_TOTAL, 'ending="caps",side="high"')).toBe('3');
  });

  it('drops an off-vocabulary or malformed sample instead of minting a series', async () => {
    const registry = new Registry();
    const counters = registerGameStateMetrics(registry, stubSource());
    // An ending cause a newer sim could invent: the label crosses an untyped
    // seam, so the membership guard is this family's cardinality bound.
    counters.battlegroundResolved('surrendered' as 'caps', 'solo', 300, 1, 0);
    counters.battlegroundResolved('caps', 'solo', Number.NaN, 3, 1);
    counters.battlegroundResolved('caps', 'solo', -5, 3, 1);
    counters.battlegroundResolved('caps', 'solo', 300, -1, 1);
    const text = await registry.metrics();

    expect(text).not.toContain('surrendered');
    // Every malformed sample was dropped WHOLE: no partial booking of the count
    // without its duration, which would silently corrupt the mean.
    expect(bgValue(text, WOC_BATTLEGROUND_MATCHES_TOTAL, 'ending="caps",composition="solo"')).toBe(
      '0',
    );
    expect(
      bgValue(text, WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL, 'ending="caps",composition="solo"'),
    ).toBe('0');
  });
});
