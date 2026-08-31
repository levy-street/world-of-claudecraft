// The game-state half of the /metrics exporter: the live game signals that are
// already measured in-memory by GameServer (players/accounts/ws connections online,
// sim entity count, achieved sim Hz, per-phase loop timing) plus the
// throughput counters (ws frames handled, inbound frames dropped by cause,
// flood kicks, input frames proven missed, chat messages, characters
// created, guild-bank incidents by kind, vault-ledger incidents by kind), all
// registered on the SAME prom-client
// registry the RED exporter builds
// (server/http/metrics.ts). Prometheus attaches env / service=game / server_name at
// scrape time, so nothing here emits those.
//
// GAUGES ARE READ AT SCRAPE TIME, NO DRIFT. Each gauge carries a collect() that
// pulls the current value from the injected GameStateSource the moment
// registry.metrics() runs, so a scrape always reflects live state and the game loop
// never has to push a sample. COUNTERS are pushed from their emission sites through
// the process-wide slot in server/http/game_signals.ts (installed by main.ts at
// boot with the sink this function returns), exactly like the attack-signal counters.
// Three lifetime totals whose truth already lives in their emitting modules (the
// bank-ledger FIFO's dropped rows, the two backend-cancel counts) are instead
// SYNCED from the GameStateSource at scrape time; see their registration below.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as server/http/metrics.ts: the
// only label values are the fixed tick-phase names, the two per-phase stats
// (p95, max), the two ws directions (in, out), the fixed inbound drop
// causes (WS_DROP_CAUSES), the fixed guild-bank incident kinds
// (GUILD_BANK_INCIDENTS), the fixed vault-ledger incident kinds
// (VAULT_LEDGER_INCIDENTS), and the content-derived economy and fishing
// vocabularies (COPPER_FLOW_SOURCES, HARVEST_BANDS, NODE_TIERS, FISHING_BANDS,
// ROD_FEE_RECIPE_IDS). Nothing per-player and nothing per-guild (account id,
// character id, guild id, name, ip) is ever a label. The tick-phase series count is fixed at
// WOC_TICK_PHASES.length * 2, independent of the profiler's internal phase set.
// Operator note: woc_gather_harvests_total carries the tier label from its
// first shipped release (the metric itself is new in this release, so no live
// panel predates the label); sum() panels aggregate across tiers as usual.
//
// THE `band` LABEL MEANS TWO DIFFERENT THINGS, and deliberately so: on
// woc_gather_harvests_total it is the node's ZONE (the R3 re-key), while on
// the woc_fishing_* family the zone rides its own `zone` label and `band` is
// the EFFECTIVE fishing rung 0/1/2 (proficiency capped by the rod,
// effectiveFishingBand in src/sim/professions/fishing.ts). Both vocabularies
// ship together in this metric family's first release, so nothing live
// depends on either yet; they still must not be renamed apart later, and the
// label reads against its metric, never across families.

import { Counter, Gauge, Histogram, type Registry } from 'prom-client';
import { bankLedgerGrowthBudgetReadout } from '../bank_ledger_growth_budget';
import { bankLedgerGrowthWarningActive } from '../bank_ledger_growth_monitor';
import {
  BG_COMPOSITIONS,
  BG_END_CAUSES,
  BG_SCORE_SIDES,
  type BgCompositionLabel,
  type BgEndCauseLabel,
  bgScoreSides,
  isBgEndCause,
} from '../battleground_telemetry';
import {
  COPPER_FLOW_SOURCES,
  type CopperFlowSource,
  HARVEST_BANDS,
  type HarvestBand,
  type HarvestTier,
  NODE_TIERS,
} from '../economy_telemetry';
import {
  FISHING_BANDS,
  type FishingBandLabel,
  isRodFeeRecipe,
  ROD_FEE_RECIPE_IDS,
  rodFeeForRecipe,
} from '../fishing_telemetry';
import { wocAuthGuardCacheStats } from '../woc_auth_guard_cache';
import {
  type GameMetricsCounters,
  GENERAL_CHAT_QUOTA_DB_OUTCOMES,
  GENERAL_CHAT_QUOTA_OUTCOMES,
  type GeneralChatQuotaDbOutcome,
  type GeneralChatQuotaOutcome,
  GUILD_BANK_INCIDENTS,
  type GuildBankIncident,
  VAULT_LEDGER_INCIDENTS,
  type VaultLedgerIncident,
  WOC_ESCROW_QUEUE_OUTCOMES,
  type WocEscrowQueueOutcome,
  WS_DROP_CAUSES,
  type WsDropCause,
  type WsMessageDirection,
} from './game_signals';

/** Live characters online (joined sessions). */
export const WOC_PLAYERS_ONLINE = 'woc_players_online';

/** Distinct accounts online (a single account may hold several sessions). */
export const WOC_ACCOUNTS_ONLINE = 'woc_accounts_online';

/** Open WebSocket connections, including sockets connected but not yet joined. */
export const WOC_WS_CONNECTIONS = 'woc_ws_connections';

/** Active entities in the authoritative sim (players, mobs, projectiles, ...). */
export const WOC_SIM_ENTITIES = 'woc_sim_entities';

/** Achieved sim ticks per wall-clock second (target is 20 Hz). */
export const WOC_SIM_TICK_HZ = 'woc_sim_tick_hz';

/** pg pool clients by state (total/idle/waiting): the saturation signal for
 *  every db-backed path, and the counter-signal for any fire-and-forget read
 *  family (a regression in its rate shows up here first in production). */
export const WOC_DB_POOL_CLIENTS = 'woc_db_pool_clients';

/** Total deadline-expiry backend cancels REQUESTED through the dedicated side
 *  pool. A rising rate means transactions are hitting their wall deadlines
 *  (the saturation precursor). A Counter, so rate()/increase() read correctly
 *  across realm restarts. */
export const WOC_DB_BACKEND_CANCEL_REQUESTS_TOTAL = 'woc_db_backend_cancel_requests_total';

/** The subset of requested cancels that FAILED: even the sub-second cancel
 *  path could not reach PostgreSQL. Its own counter beside the requests, not
 *  a measure label on one family (the koi/catches rule below: a subset series
 *  under a shared name would make the family's sum double-count). */
export const WOC_DB_BACKEND_CANCEL_FAILURES_TOTAL = 'woc_db_backend_cancel_failures_total';

/** Character-save FIFO keys with a queued or running write (the per-character
 *  serial writer's live map size). The escrow write-path rider's gauge. The
 *  alert threshold is SUSTAINED values above the autosave wave's own
 *  SAVE_CONCURRENCY (4): the wave bounds how many wave-driven saves run at
 *  once, so a persistently higher reading means out-of-band writers are
 *  queueing, the precursor the wocEscrowQueue refusal counters alert on. */
export const WOC_SAVE_PENDING_KEYS = 'woc_character_save_pending_keys';

/** The realm escrow gate's live occupancy (the write-path rider's
 *  realm-global bound): the instantaneous truth the wocEscrowQueue counter
 *  kinds approximate, exported to Prometheus so an alert rule can watch
 *  sustained inFlight at the cap instead of scraping the secret-gated ops
 *  readout. */
export const WOC_ESCROW_GATE_IN_FLIGHT = 'woc_escrow_gate_in_flight';

/** Realm-wide cap across the named dominant background DB producers. */
export const WOC_BACKGROUND_DB_GATE = 'woc_background_db_gate';

/** The character-delete sub-gate (the delete-local concurrency bound UNDER
 *  the realm background gate) by the same fixed measures. Its own family
 *  beside woc_background_db_gate: the sub-cap parks a delete stampede BEFORE
 *  the realm gate, so the realm family's waiting gauge structurally cannot
 *  see it (a stampede would read there as waiting at most the sub-cap while
 *  players get 503s), and a leaked sub slot shows as in_flight pinned high. */
export const WOC_CHARACTER_DELETE_GATE = 'woc_character_delete_gate';

/** Total character-delete saturation refusals (the delete_busy 503s): the
 *  bounded permit wait elapsed with no slot. Client-gone abandonments never
 *  count. A Counter, so rate()/increase() read correctly across restarts. */
export const WOC_CHARACTER_DELETE_BUSY_TOTAL = 'woc_character_delete_busy_total';

/** Total commit-ambiguity verify outcomes on the character-delete path, by
 *  result (landed / not_landed / failed). The orphan bug this resolver fixes
 *  (a landed delete reported unlanded, its world purge skipped) was
 *  production-invisible because nothing counted here; any nonzero movement
 *  deserves a look, and `failed` climbing means ambiguity is being
 *  propagated unresolved. A Counter for honest increase() across restarts. */
export const WOC_CHARACTER_DELETE_VERIFY_TOTAL = 'woc_character_delete_verify_total';

/** Bounded storage-recovery scheduler occupancy, age, and lifetime events. */
export const WOC_STORAGE_RECOVERY = 'woc_storage_recovery';

/** Per-phase authoritative-loop timing in SECONDS, labeled by phase and stat (p95/max). */
export const WOC_SIM_TICK_PHASE_SECONDS = 'woc_sim_tick_phase_seconds';

/** Total ws frames handled, labeled by direction (in/out). */
export const WOC_WS_MESSAGES_TOTAL = 'woc_ws_messages_total';

/** Total inbound ws frames dropped by the gate, a lane, or the list-read guard, by cause. */
export const WOC_WS_MESSAGES_DROPPED_TOTAL = 'woc_ws_messages_dropped_total';

/** Total sessions kicked by the inbound-flood abuse window. */
export const WOC_WS_RATE_KICKS_TOTAL = 'woc_ws_rate_kicks_total';

/** Total input frames proven missed by a parsed seq gap on the ordered socket. */
export const WOC_INPUT_FRAMES_MISSED_TOTAL = 'woc_input_frames_missed_total';

/** Total player chat messages routed to other players (any channel). */
export const WOC_CHAT_MESSAGES_TOTAL = 'woc_chat_messages_total';

/** Configured General quota decisions, labeled by bounded outcome. */
export const WOC_GENERAL_CHAT_QUOTA_TOTAL = 'woc_general_chat_quota_total';

/** Current General quota database calls in flight in this realm process. */
export const WOC_GENERAL_CHAT_QUOTA_IN_FLIGHT = 'woc_general_chat_quota_in_flight';
export const WOC_GENERAL_CHAT_QUOTA_DB_CALLS_TOTAL = 'woc_general_chat_quota_db_calls_total';
export const WOC_GENERAL_CHAT_QUOTA_DB_DURATION_SECONDS =
  'woc_general_chat_quota_db_duration_seconds';
export const WOC_GENERAL_CHAT_QUOTA_DB_POOL = 'woc_general_chat_quota_db_pool';
export const WOC_GENERAL_CHAT_QUOTA_LISTENER = 'woc_general_chat_quota_listener';
export const WOC_GENERAL_CHAT_QUOTA_CACHE_ACCOUNTS = 'woc_general_chat_quota_cache_accounts';

/** Total characters successfully created. */
export const WOC_CHARACTERS_CREATED_TOTAL = 'woc_characters_created_total';

/** Last database-observed global bank-ledger budget, by fixed measure. */
export const WOC_BANK_LEDGER_GROWTH_BUDGET = 'woc_bank_ledger_growth_budget';

/** Database-wide bank-ledger hard-ceiling refusals in this process. */
export const WOC_BANK_LEDGER_GROWTH_LIMIT_REFUSALS_TOTAL =
  'woc_bank_ledger_growth_limit_refusals_total';

/** Total guild-bank incidents on the dupe-sensitive paths, by kind. */
export const WOC_GUILD_BANK_INCIDENTS_TOTAL = 'woc_guild_bank_incidents_total';

/** Rift forge wire commands refused while the gate is closed (server/rift_forge_gate.ts). */
export const WOC_RIFT_FORGE_REFUSED_TOTAL = 'woc_rift_forge_refused_total';

/** Total Materials Vault ledger incidents, by kind. Its own metric rather than
 *  a kind on the guild series: the vault is a personal per-character store, so
 *  a guild-bank alert rule must never fire on it. */
export const WOC_VAULT_LEDGER_INCIDENTS_TOTAL = 'woc_vault_ledger_incidents_total';
export const WOC_BANK_VAULT_REALM_ROW_BREACHES_TOTAL = 'woc_bank_vault_realm_row_breaches_total';

/** The per-process bank-ledger insert FIFO's INSTANTANEOUS occupancy, by
 *  measure: depth is queued insert ops against BANK_LEDGER_TAIL_MAX_DEPTH,
 *  rows is the ledger rows those ops carry against BANK_LEDGER_TAIL_MAX_ROWS
 *  (a batched op is one depth unit but up to 112 rows, so each cap needs its
 *  own arm). Instantaneous only; the lifetime drop total is the counter
 *  below, never an arm here. */
export const WOC_BANK_LEDGER_TAIL = 'woc_bank_ledger_tail';

/** Total audit rows dropped at either bank-ledger FIFO cap (each dropped row
 *  is a counted audit hole, the same hole a rejected insert leaves). Alert on
 *  any increase. A Counter, so rate()/increase() read correctly across realm
 *  restarts, which the old dropped_rows gauge arm did not. */
export const WOC_BANK_LEDGER_TAIL_DROPPED_ROWS_TOTAL = 'woc_bank_ledger_tail_dropped_rows_total';

/** Marketplace escrow-queue outcomes (the listing entry on the per-character
 *  save FIFO), by kind. */
export const WOC_ESCROW_QUEUE_TOTAL = 'woc_escrow_queue_total';

/** Guild bank activity log cache readout, labeled by counter name. ONE metric
 *  with a `kind` label rather than six names: the vocabulary is closed and
 *  fixed, and an operator reads them together or not at all. */
export const WOC_GUILD_BANK_LOG_CACHE = 'woc_guild_bank_log_cache';

/** Marketplace auth-guard read cache readout (token and moderation arms),
 *  labeled by arm and counter name. This is the one cache whose degradation
 *  is a CLIFF (an over-cap working set evicts every entry before its next
 *  poll), so the alertable series exists precisely to see the cliff form:
 *  watch refreshes approaching reads, and evictions climbing. */
export const WOC_AUTH_GUARD_CACHE = 'woc_auth_guard_cache';

/** Total copper credited to acting players, labeled by economic surface. */
export const WOC_COPPER_CREDITED_TOTAL = 'woc_copper_credited_total';

/** Total copper debited from acting players, labeled by economic surface. */
export const WOC_COPPER_SPENT_TOTAL = 'woc_copper_spent_total';

/** Total granted node harvests, labeled by the node's zone (R3) and tool tier (R31). */
export const WOC_GATHER_HARVESTS_TOTAL = 'woc_gather_harvests_total';

/** Total fishing casts started, labeled by water zone and effective band. */
export const WOC_FISHING_CASTS_TOTAL = 'woc_fishing_casts_total';

/** Total landed catches (the koi included), labeled by water zone and effective band. */
export const WOC_FISHING_CATCHES_TOTAL = 'woc_fishing_catches_total';

/** Total landed rare koi, a strict subset of the catches counter, same labels. */
export const WOC_FISHING_KOI_TOTAL = 'woc_fishing_koi_total';

/** Total fishing got-aways (missed reel, timed-out session, or no bag room), same labels. */
export const WOC_FISHING_GOT_AWAYS_TOTAL = 'woc_fishing_got_aways_total';

/** Total sessions ended by a pre-bite re-press (the anti-spam early reel), same labels. */
export const WOC_FISHING_EARLY_REELS_TOTAL = 'woc_fishing_early_reels_total';

/** Total casts whose table draw resolved the empty row (nothing biting), same labels. */
export const WOC_FISHING_EMPTY_HOOKS_TOTAL = 'woc_fishing_empty_hooks_total';

/** Total rod recipes successfully trained, labeled by recipe id (one fee paid each). */
export const WOC_ROD_FEE_PAYMENTS_TOTAL = 'woc_rod_fee_payments_total';

/** The STATIC training fee in copper for each rod recipe, published so no
 *  dashboard hardcodes a gold amount. Content-derived and constant for the
 *  process's life, which is why it carries no collect(). Every realm process
 *  publishes the SAME value, so across realm targets the copper the rod fees
 *  took is sum(sum by (recipe) (woc_rod_fee_payments_total) * max by
 *  (recipe) (woc_rod_fee_copper)): summing the gauge itself overstates by
 *  the realm count, and dropping the by (recipe) grouping multiplies every
 *  training by the single HIGHEST fee (the two rod fees differ 4x). */
export const WOC_ROD_FEE_COPPER = 'woc_rod_fee_copper';

/** Resolved RATED Thornhollow Fields matches, by ending cause and composition.
 *  The denominator for the two sums below, and on its own the cap-tuning read:
 *  the share of matches the CLOCK ended rather than the winning capture is
 *  `sum(rate(...{cause="timer"})) / sum(rate(...))`. */
export const WOC_BATTLEGROUND_MATCHES_TOTAL = 'woc_battleground_matches_total';
/** Summed ACTIVE seconds of those matches, same labels. Mean match length is
 *  this over the count above; it is a SUM, so never graph it alone. */
export const WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL = 'woc_battleground_duration_seconds_total';
/** Summed final scores of those matches, split into the high and low side of
 *  each result (a draw contributes the same value to both). Mean captures per
 *  match per side is this over the match count. */
export const WOC_BATTLEGROUND_CAPTURES_TOTAL = 'woc_battleground_captures_total';

/**
 * The FIXED set of loop phases surfaced on woc_sim_tick_phase_seconds. These are
 * GameServer's steady-state outer phases (see the TickProfiler construction in
 * server/game.ts); the detailed sim.* sub-phases are captured only during an
 * on-demand admin capture and are deliberately excluded to keep the exported
 * series set small and bounded. A phase the source does not report is simply
 * skipped, so the label set can never grow past this list.
 */
export const WOC_TICK_PHASES = [
  'total',
  'stale',
  'tick',
  'events',
  'antibot',
  'broadcast',
  'bcastGrid',
  'bcastSelf',
  'social',
  // Main-thread cost of the shared-blob persistence writes: the whole market book,
  // the whole mail book, and the rift blob, each measured INSIDE its queued write
  // thunk (server/serial_writer.ts) rather than where it is enqueued. That
  // distinction is the whole value of the series: the writers defer the thunk to a
  // microtask, so a timer at the enqueue site reads the bookkeeping and nothing
  // else (0.02 ms measured around an enqueue whose write then blocked 250 ms).
  //
  // SCOPE, so a flat reading is not over-read: per-character blobs ride their own
  // queue and are NOT counted here, and neither is any DB round trip. A stall this
  // series does not explain still shows in `lateness`.
  'saves',
  // How late each callback fired, in seconds. Not a body phase: it is the gap
  // BETWEEN callbacks, and it is the only series that can see the loop blocked by
  // something the profiler never entered (a deferred write thunk, an off-loop
  // timer, a GC pause, the host descheduling the process).
  //
  // Read `max`, not `p95`. The ring holds 1200 samples (about 60 s of callbacks),
  // so a stall on a 30 s cadence is two samples per window and sits far below the
  // 95th percentile: p95 stays flat through exactly the incident this exists for.
  'lateness',
] as const;

/** The two per-phase stats exposed for each phase. */
const TICK_PHASE_STATS = ['p95', 'max'] as const;

/** Milliseconds per second, for the profiler's millisecond stats -> seconds conversion. */
const MS_PER_SECOND = 1000;

/** One phase's p95 and max, in MILLISECONDS (the unit GameServer's TickProfiler keeps). */
export interface TickPhaseMillis {
  p95: number;
  max: number;
}

/**
 * The live read surface the gauges pull from at scrape time. main.ts implements
 * this over the boot GameServer and WebSocketServer; a test implements it with
 * fixed values. Every method is a cheap live read: it must not block or throw.
 */
export interface GameStateSource {
  /** Live characters online. */
  playersOnline(): number;
  /** Distinct accounts online. */
  accountsOnline(): number;
  /** Open WebSocket connections (joined or not). */
  wsConnections(): number;
  /** Active sim entity count. */
  simEntities(): number;
  /** Achieved sim Hz, or null while the rate meter is still warming up. */
  simTickHz(): number | null;
  /** Character-save FIFO keys with a queued or running write. */
  savePendingKeys(): number;
  /** The realm escrow gate's live in-flight count. */
  escrowGateInFlight(): number;
  backgroundDbGate(): {
    inFlight: number;
    waiting: number;
    max: number;
    configuredHeadroom: number;
    acquired: number;
    refused: number;
    cancelled: number;
  };
  /** The character-delete sub-gate readout plus its lifetime saturation
   *  refusals (server/character_delete_db.ts characterDeleteGateStats). */
  characterDeleteGate(): {
    inFlight: number;
    waiting: number;
    max: number;
    configuredHeadroom: number;
    acquired: number;
    refused: number;
    cancelled: number;
    busyRefusals: number;
    verifyLanded: number;
    verifyNotLanded: number;
    verifyFailed: number;
  };
  storageRecovery(): {
    tracked: number;
    scanActive: number;
    scanQueued: number;
    driveActive: number;
    driveQueued: number;
    retryTimers: number;
    oldestTrackedAgeMs: number;
    oldestQueuedAgeMs: number;
    oldestActiveAgeMs: number;
    activePastSlotTarget: number;
    horizonBreached: boolean;
    capacityRefusals: number;
    retriesScheduled: number;
    horizonBreaches: number;
  };
  /** Per-phase p95/max in MILLISECONDS, keyed by phase name; missing phases are skipped. */
  tickPhaseMillis(): Record<string, TickPhaseMillis>;
  /** pg pool saturation snapshot (pg Pool totalCount/idleCount/waitingCount). */
  dbPool(): { total: number; idle: number; waiting: number };
  /** Lifetime detached-backend cancel attempts/failures (the side-pool hook). */
  dbBackendCancels(): { requested: number; failed: number };
  /** Bank-ledger insert FIFO: live queued ops (depth), the ledger rows those
   *  ops carry, and lifetime rows dropped at either cap. */
  bankLedgerTail(): { depth: number; rows: number; droppedRows: number };
  generalChatQuotaDbPool(): { total: number; idle: number; waiting: number };
  generalChatQuotaInFlight(): number;
  generalChatQuotaCachedAccounts(): number;
  generalChatQuotaListener(): { connected: number; reconnects: number; pendingRefreshes: number };
  /**
   * Wall clock (epoch millis) of the last COMPLETED tick pass, null during warmup.
   * This one is NOT a Prometheus gauge (loop rate is already covered by
   * woc_sim_tick_hz): it exists so main.ts can hand this same source object to the
   * /livez staleness read in server/http/health.ts.
   */
  lastTickAt(): number | null;
  /**
   * Wall clock (epoch millis) when the game loop was last started, null before it.
   * Also NOT a Prometheus gauge: it is the /livez staleness backstop for a loop that
   * has started but not yet completed a pass, so a boot-time wedge (every tick throws)
   * still reads as stale rather than as warmup forever.
   */
  loopStartedAt(): number | null;
  /**
   * The guild bank activity log's per-guild read cache
   * (server/guild_bank_log.ts). The number the whole design rests on is the
   * REFRESH rate: the cache exists because one answer serves every officer of a
   * guild, and its coalescing floor exists because a naive bust made a busy
   * guild's log uncached exactly when officers read it. None of that is
   * observable without this readout.
   */
  guildBankLogCache(): {
    reads: number;
    refreshes: number;
    evictions: number;
    busts: number;
    entries: number;
    dirtyGuilds: number;
  };
}

/**
 * Register the game-state gauges and throughput counters on `registry` and return
 * the counter sink for main.ts to install process-wide via setGameMetricsCounters.
 *
 * The gauges are wired to `source` through per-metric collect() callbacks, so they
 * read live at scrape time (no background sampling, no drift). The returned sink's
 * methods never throw: a metric write must never break the path it measures, so
 * each increment is guarded exactly like the attack-signal sink.
 */
export function registerGameStateMetrics(
  registry: Registry,
  source: GameStateSource,
): GameMetricsCounters {
  // Each gauge carries a collect() read at scrape time (registry.metrics()), so it
  // reflects live state with no background sampling. `this` is the gauge instance
  // (prom-client's CollectFunction<Gauge>), so collect() sets its own value.
  new Gauge({
    name: WOC_PLAYERS_ONLINE,
    help: 'Live characters online (joined sessions).',
    registers: [registry],
    collect() {
      this.set(source.playersOnline());
    },
  });

  new Gauge({
    name: WOC_ACCOUNTS_ONLINE,
    help: 'Distinct accounts online.',
    registers: [registry],
    collect() {
      this.set(source.accountsOnline());
    },
  });

  new Gauge({
    name: WOC_WS_CONNECTIONS,
    help: 'Open WebSocket connections, including sockets connected but not yet joined.',
    registers: [registry],
    collect() {
      this.set(source.wsConnections());
    },
  });

  new Gauge({
    name: WOC_SAVE_PENDING_KEYS,
    help: 'Character-save FIFO keys with a queued or running write.',
    registers: [registry],
    collect() {
      this.set(source.savePendingKeys());
    },
  });

  new Gauge({
    name: WOC_ESCROW_GATE_IN_FLIGHT,
    help: 'Realm escrow gate occupancy (listing sequences holding a slot).',
    registers: [registry],
    collect() {
      this.set(source.escrowGateInFlight());
    },
  });

  new Gauge({
    name: WOC_BACKGROUND_DB_GATE,
    help: 'Named major-background-producer gate by fixed measure. Configured headroom is not a reserved pool partition because other background jobs may bypass this gate.',
    labelNames: ['measure'],
    registers: [registry],
    collect() {
      const state = source.backgroundDbGate();
      this.set({ measure: 'in_flight' }, state.inFlight);
      this.set({ measure: 'waiting' }, state.waiting);
      this.set({ measure: 'max' }, state.max);
      this.set({ measure: 'configured_headroom' }, state.configuredHeadroom);
      this.set({ measure: 'acquired' }, state.acquired);
      this.set({ measure: 'refused' }, state.refused);
      this.set({ measure: 'cancelled' }, state.cancelled);
    },
  });

  new Gauge({
    name: WOC_CHARACTER_DELETE_GATE,
    help: 'Character-delete sub-gate by fixed measure (the delete-local bound under the realm background gate). A stampede parks here BEFORE the realm gate, so woc_background_db_gate waiting cannot see it.',
    labelNames: ['measure'],
    registers: [registry],
    collect() {
      const state = source.characterDeleteGate();
      this.set({ measure: 'in_flight' }, state.inFlight);
      this.set({ measure: 'waiting' }, state.waiting);
      this.set({ measure: 'max' }, state.max);
      this.set({ measure: 'configured_headroom' }, state.configuredHeadroom);
      this.set({ measure: 'acquired' }, state.acquired);
      this.set({ measure: 'refused' }, state.refused);
      this.set({ measure: 'cancelled' }, state.cancelled);
    },
  });

  // Same scrape-time sync shape as the backend-cancel counters below: the
  // truth lives in character_delete_db.ts and is monotonic per process.
  new Counter({
    name: WOC_CHARACTER_DELETE_BUSY_TOTAL,
    help: 'Total character-delete saturation refusals (the delete_busy 503s). Client-gone abandonments never count. Alert on sustained increase(): players cannot delete characters.',
    registers: [registry],
    collect() {
      this.reset();
      this.inc(source.characterDeleteGate().busyRefusals);
    },
  });

  new Counter({
    name: WOC_CHARACTER_DELETE_VERIFY_TOTAL,
    help: 'Commit-ambiguity verify outcomes on character deletes by result: landed (the delete committed and its world purge ran), not_landed (the row survived, refusal stood), failed (the verify itself failed, ambiguity propagated unresolved). Any movement deserves a look; failed dominating points first at the 2s idle-in-transaction bound under an event-loop stall, not the lock mode.',
    labelNames: ['result'],
    registers: [registry],
    collect() {
      this.reset();
      const state = source.characterDeleteGate();
      this.inc({ result: 'landed' }, state.verifyLanded);
      this.inc({ result: 'not_landed' }, state.verifyNotLanded);
      this.inc({ result: 'failed' }, state.verifyFailed);
    },
  });

  new Gauge({
    name: WOC_STORAGE_RECOVERY,
    help: 'Bounded storage-purchase recovery state by fixed measure; ages are seconds and horizon_breached is 0/1.',
    labelNames: ['measure'],
    registers: [registry],
    collect() {
      const state = source.storageRecovery();
      this.set({ measure: 'tracked' }, state.tracked);
      this.set({ measure: 'scan_active' }, state.scanActive);
      this.set({ measure: 'scan_queued' }, state.scanQueued);
      this.set({ measure: 'drive_active' }, state.driveActive);
      this.set({ measure: 'drive_queued' }, state.driveQueued);
      this.set({ measure: 'retry_timers' }, state.retryTimers);
      this.set({ measure: 'oldest_tracked_seconds' }, state.oldestTrackedAgeMs / 1000);
      this.set({ measure: 'oldest_queued_seconds' }, state.oldestQueuedAgeMs / 1000);
      this.set({ measure: 'oldest_active_seconds' }, state.oldestActiveAgeMs / 1000);
      this.set({ measure: 'active_past_slot_target' }, state.activePastSlotTarget);
      this.set({ measure: 'horizon_breached' }, state.horizonBreached ? 1 : 0);
      this.set({ measure: 'capacity_refusals' }, state.capacityRefusals);
      this.set({ measure: 'retries_scheduled' }, state.retriesScheduled);
      this.set({ measure: 'horizon_breaches' }, state.horizonBreaches);
    },
  });

  new Gauge({
    name: WOC_SIM_ENTITIES,
    help: 'Active entities in the authoritative sim.',
    registers: [registry],
    collect() {
      this.set(source.simEntities());
    },
  });

  new Gauge({
    name: WOC_SIM_TICK_HZ,
    help: 'Achieved sim ticks per wall-clock second (target 20). 0 while the rate meter warms up.',
    registers: [registry],
    collect() {
      // The rate meter reports null for the first second of uptime; a scrape is a
      // steady-state read, so map that brief warmup window to 0 rather than omit.
      this.set(source.simTickHz() ?? 0);
    },
  });

  new Gauge({
    name: WOC_DB_POOL_CLIENTS,
    help: 'pg pool clients by state (total open, idle, callers waiting for a client). Sustained waiting > 0 means the pool is saturated. Saturation is PER POOL: read waiting per realm target (a cross-realm sum hides which realm is stuck); the shared-Postgres connection budget is sum(total) across targets.',
    labelNames: ['state'],
    registers: [registry],
    collect() {
      const p = source.dbPool();
      this.set({ state: 'total' }, p.total);
      this.set({ state: 'idle' }, p.idle);
      this.set({ state: 'waiting' }, p.waiting);
    },
  });

  new Gauge({
    name: WOC_BANK_LEDGER_TAIL,
    help: 'Per-process bank-ledger insert FIFO occupancy by measure: depth is queued insert ops against the depth cap, rows is the ledger rows those ops carry against the rows cap (a batched op is one depth unit but many rows). Instantaneous only; alert on drops via woc_bank_ledger_tail_dropped_rows_total.',
    labelNames: ['measure'],
    registers: [registry],
    collect() {
      const tail = source.bankLedgerTail();
      this.set({ measure: 'depth' }, tail.depth);
      this.set({ measure: 'rows' }, tail.rows);
    },
  });

  // The three lifetime totals below are COUNTERS, not gauge arms: operators
  // alert on rate()/increase(), which treat a counter's restart reset
  // correctly but misread a restarting gauge as a negative spike. Their truth
  // lives in the emitting modules (the FIFO's drop count, the cancel side
  // pool's counts) and reaches the exporter through the same scrape-time
  // source read as the gauges; a prom Counter has no set(), so collect()
  // replays the absolute total via reset() + inc(). Each source value is
  // monotonic for the process's life, so the rendered series is monotonic
  // between restarts, exactly what the counter type promises.
  new Counter({
    name: WOC_BANK_LEDGER_TAIL_DROPPED_ROWS_TOTAL,
    help: 'Total audit rows dropped at the bank-ledger insert FIFO caps (alert on any increase; each dropped row is an audit hole, the same hole a rejected insert leaves).',
    registers: [registry],
    collect() {
      this.reset();
      this.inc(source.bankLedgerTail().droppedRows);
    },
  });

  new Counter({
    name: WOC_DB_BACKEND_CANCEL_REQUESTS_TOTAL,
    help: 'Total deadline-expiry backend cancels requested through the dedicated side pool. A rising rate means transactions are hitting their wall deadlines (the saturation precursor).',
    registers: [registry],
    collect() {
      this.reset();
      this.inc(source.dbBackendCancels().requested);
    },
  });

  new Counter({
    name: WOC_DB_BACKEND_CANCEL_FAILURES_TOTAL,
    help: 'Total requested backend cancels that failed: even the sub-second cancel path could not reach PostgreSQL. A subset of woc_db_backend_cancel_requests_total.',
    registers: [registry],
    collect() {
      this.reset();
      this.inc(source.dbBackendCancels().failed);
    },
  });

  new Gauge({
    name: WOC_SIM_TICK_PHASE_SECONDS,
    help: 'Per-phase authoritative-loop timing in seconds, by phase and stat (p95/max).',
    labelNames: ['phase', 'stat'],
    registers: [registry],
    collect() {
      const phases = source.tickPhaseMillis();
      for (const phase of WOC_TICK_PHASES) {
        const stats = phases[phase];
        if (!stats) continue;
        for (const stat of TICK_PHASE_STATS) {
          this.set({ phase, stat }, stats[stat] / MS_PER_SECOND);
        }
      }
    },
  });

  const wsMessages = new Counter({
    name: WOC_WS_MESSAGES_TOTAL,
    help: 'Total ws frames handled, labeled by direction (in, out).',
    labelNames: ['direction'],
    registers: [registry],
  });

  const wsMessagesDropped = new Counter({
    name: WOC_WS_MESSAGES_DROPPED_TOTAL,
    help: 'Total inbound ws frames dropped by the gate, a lane, or the list-read guard, by cause.',
    labelNames: ['cause'],
    registers: [registry],
  });
  // Prom counters cannot backfill a scrape: pre-register every cause series at
  // zero so dashboards see each series from boot, not from its first drop.
  for (const cause of WS_DROP_CAUSES) wsMessagesDropped.inc({ cause }, 0);

  const wsRateKicks = new Counter({
    name: WOC_WS_RATE_KICKS_TOTAL,
    help: 'Total sessions kicked by the inbound-flood abuse window.',
    registers: [registry],
  });

  const inputFramesMissed = new Counter({
    name: WOC_INPUT_FRAMES_MISSED_TOTAL,
    help: 'Total input frames proven missed by a parsed seq gap on the ordered socket.',
    registers: [registry],
  });

  const riftForgeRefusals = new Counter({
    name: WOC_RIFT_FORGE_REFUSED_TOTAL,
    help: 'Total rift forge wire commands refused while the gate is closed; the stock client sends none, so a non-zero rate means a modified client is probing.',
    registers: [registry],
  });

  const chatMessages = new Counter({
    name: WOC_CHAT_MESSAGES_TOTAL,
    help: 'Total player chat messages routed to other players (any channel).',
    registers: [registry],
  });

  const generalChatQuota = new Counter({
    name: WOC_GENERAL_CHAT_QUOTA_TOTAL,
    help: 'Configured General chat quota decisions by bounded outcome.',
    labelNames: ['outcome'],
    registers: [registry],
  });
  for (const outcome of GENERAL_CHAT_QUOTA_OUTCOMES) generalChatQuota.inc({ outcome }, 0);

  const generalChatQuotaDbCalls = new Counter({
    name: WOC_GENERAL_CHAT_QUOTA_DB_CALLS_TOTAL,
    help: 'Dedicated General quota database calls by bounded outcome.',
    labelNames: ['outcome'],
    registers: [registry],
  });
  const generalChatQuotaDbDuration = new Histogram({
    name: WOC_GENERAL_CHAT_QUOTA_DB_DURATION_SECONDS,
    help: 'End-to-end dedicated General quota database call duration.',
    labelNames: ['outcome'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5],
    registers: [registry],
  });
  for (const outcome of GENERAL_CHAT_QUOTA_DB_OUTCOMES) {
    generalChatQuotaDbCalls.inc({ outcome }, 0);
    // Pre-seed the histogram series too, so the first post-boot scrape has it.
    generalChatQuotaDbDuration.zero({ outcome });
  }

  new Gauge({
    name: WOC_GENERAL_CHAT_QUOTA_IN_FLIGHT,
    help: 'Current General chat quota database calls in flight in this realm process.',
    registers: [registry],
    collect() {
      this.set(source.generalChatQuotaInFlight());
    },
  });
  new Gauge({
    name: WOC_GENERAL_CHAT_QUOTA_DB_POOL,
    help: 'Dedicated General quota pool clients by fixed state.',
    labelNames: ['state'],
    registers: [registry],
    collect() {
      const state = source.generalChatQuotaDbPool();
      this.set({ state: 'total' }, state.total);
      this.set({ state: 'idle' }, state.idle);
      this.set({ state: 'waiting' }, state.waiting);
    },
  });
  new Gauge({
    name: WOC_GENERAL_CHAT_QUOTA_LISTENER,
    help: 'General quota policy listener state by fixed measure.',
    labelNames: ['measure'],
    registers: [registry],
    collect() {
      const state = source.generalChatQuotaListener();
      this.set({ measure: 'connected' }, state.connected);
      this.set({ measure: 'reconnects' }, state.reconnects);
      this.set({ measure: 'pending_refreshes' }, state.pendingRefreshes);
    },
  });
  new Gauge({
    name: WOC_GENERAL_CHAT_QUOTA_CACHE_ACCOUNTS,
    help: 'Accounts retained in the bounded local General quota refusal/notice cache.',
    registers: [registry],
    collect() {
      this.set(source.generalChatQuotaCachedAccounts());
    },
  });

  const charactersCreated = new Counter({
    name: WOC_CHARACTERS_CREATED_TOTAL,
    help: 'Total characters successfully created.',
    registers: [registry],
  });

  new Gauge({
    name: WOC_BANK_LEDGER_GROWTH_BUDGET,
    help: 'Database-wide bank-ledger budget by fixed measure. lifetime_inserted_rows counts every insert the durable singleton ever accounted and is NEVER credited when ledger rows disappear via the characters/accounts ON DELETE CASCADE, so it can exceed a live count(*); it is refreshed at boot, once per minute, and on a hard-limit refusal. observation_age_seconds exposes a stalled refresh; limit_warning flips to 1 when the observation crosses the warn fraction of the hard limit.',
    labelNames: ['measure'],
    registers: [registry],
    collect() {
      const readout = bankLedgerGrowthBudgetReadout();
      this.set({ measure: 'hard_limit_rows' }, readout.hardLimitRows);
      this.set({ measure: 'initialized' }, readout.committedRows === null ? 0 : 1);
      this.set({ measure: 'lifetime_inserted_rows' }, readout.committedRows ?? 0);
      this.set(
        { measure: 'limit_warning' },
        bankLedgerGrowthWarningActive(readout.committedRows, readout.hardLimitRows) ? 1 : 0,
      );
      this.set(
        { measure: 'observation_age_seconds' },
        readout.observedAtMs === null ? 0 : Math.max(0, (Date.now() - readout.observedAtMs) / 1000),
      );
    },
  });

  const bankLedgerGrowthLimitRefusals = new Counter({
    name: WOC_BANK_LEDGER_GROWTH_LIMIT_REFUSALS_TOTAL,
    help: 'Total database-wide bank-ledger hard-ceiling refusals observed by this process.',
    registers: [registry],
  });

  const guildBankIncidents = new Counter({
    name: WOC_GUILD_BANK_INCIDENTS_TOTAL,
    help: 'Total guild-bank incidents on the dupe-sensitive paths (escrow save, fence-out, escrow quarantine, reconcile, unloaded book, ledger write), by kind.',
    labelNames: ['kind'],
    registers: [registry],
  });
  // Same zero-backfill as the drop causes: these series are the ones an
  // operator alerts on, and an alert rule cannot fire on a series that does
  // not exist until its first incident.
  for (const kind of GUILD_BANK_INCIDENTS) guildBankIncidents.inc({ kind }, 0);

  const vaultLedgerIncidents = new Counter({
    name: WOC_VAULT_LEDGER_INCIDENTS_TOTAL,
    help: 'Total Materials Vault ledger incidents (a rejected bank_ledger insert leaves a hole the audit replay cannot see), by kind.',
    labelNames: ['kind'],
    registers: [registry],
  });
  // Same zero-backfill reasoning as the guild kinds above.
  for (const kind of VAULT_LEDGER_INCIDENTS) vaultLedgerIncidents.inc({ kind }, 0);

  // The realm row bucket is telemetry-only (bank_vault_ledger_guard.ts): a
  // breach is an admission the old refusing guard would have dropped. Monotone
  // per process; alert on rate, never on the absolute value.
  const bankVaultRealmRowBreaches = new Counter({
    name: WOC_BANK_VAULT_REALM_ROW_BREACHES_TOTAL,
    help: 'Total bank/vault realm row-bucket breaches (admissions past the telemetry bucket).',
    registers: [registry],
  });
  bankVaultRealmRowBreaches.inc(0);

  const wocEscrowQueue = new Counter({
    name: WOC_ESCROW_QUEUE_TOTAL,
    help: 'Marketplace escrow-queue outcomes on the per-character save FIFO custody entries (started, deadline_refused, depth_refused, books_dirty_refused, flush_failed, realm_refused, settled, grant_busy, permit_refused), by kind.',
    labelNames: ['kind'],
    registers: [registry],
  });
  for (const kind of WOC_ESCROW_QUEUE_OUTCOMES) wocEscrowQueue.inc({ kind }, 0);
  new Gauge({
    name: WOC_GUILD_BANK_LOG_CACHE,
    help: 'Guild bank activity log read cache: reads, refreshes (the query rate), evictions, busts, live entries, and guilds inside the coalescing floor.',
    labelNames: ['kind'],
    registers: [registry],
    collect() {
      const stats = source.guildBankLogCache();
      this.set({ kind: 'reads' }, stats.reads);
      this.set({ kind: 'refreshes' }, stats.refreshes);
      this.set({ kind: 'evictions' }, stats.evictions);
      this.set({ kind: 'busts' }, stats.busts);
      this.set({ kind: 'entries' }, stats.entries);
      this.set({ kind: 'dirty_guilds' }, stats.dirtyGuilds);
    },
  });
  new Gauge({
    name: WOC_AUTH_GUARD_CACHE,
    help: 'Marketplace auth-guard read cache: reads, refreshes (the residual query rate), evictions, busts, and live entries, per arm (tokens, accounts), plus the two soft-bounded internal collections (arm=index and arm=recent_busts, kind=entries): their bounds are soft BY DESIGN, so an excursion must be a series, not a claim. Zero until the boot wiring arms the cache.',
    labelNames: ['arm', 'kind'],
    registers: [registry],
    collect() {
      // The process singleton's stats accessor, null before the boot wiring
      // arms the cache: the zero fallback keeps every series alive so an
      // alert rule can fire on its first real sample (the zero-backfill rule
      // the counters above follow).
      const stats = wocAuthGuardCacheStats();
      for (const arm of ['tokens', 'accounts'] as const) {
        const armStats = stats?.[arm] ?? null;
        this.set({ arm, kind: 'reads' }, armStats?.reads ?? 0);
        this.set({ arm, kind: 'refreshes' }, armStats?.refreshes ?? 0);
        this.set({ arm, kind: 'evictions' }, armStats?.evictions ?? 0);
        this.set({ arm, kind: 'busts' }, armStats?.busts ?? 0);
        this.set({ arm, kind: 'entries' }, armStats?.entries ?? 0);
      }
      this.set({ arm: 'index', kind: 'entries' }, stats?.index ?? 0);
      this.set({ arm: 'recent_busts', kind: 'entries' }, stats?.recentBusts ?? 0);
      this.set({ arm: 'join_veto', kind: 'refetches' }, stats?.joinVetoRefetches ?? 0);
    },
  });
  const copperCredited = new Counter({
    name: WOC_COPPER_CREDITED_TOTAL,
    help: 'Total copper credited to acting players during their own command, by economic surface.',
    labelNames: ['source'],
    registers: [registry],
  });
  const copperSpent = new Counter({
    name: WOC_COPPER_SPENT_TOTAL,
    help: 'Total copper debited from acting players during their own command, by economic surface.',
    labelNames: ['source'],
    registers: [registry],
  });
  // Prom counters cannot backfill a scrape: pre-register every source series at
  // zero so a dashboard shows each surface from boot, not from its first coin.
  for (const source of COPPER_FLOW_SOURCES) {
    copperCredited.inc({ source }, 0);
    copperSpent.inc({ source }, 0);
  }

  const harvests = new Counter({
    name: WOC_GATHER_HARVESTS_TOTAL,
    help: 'Total granted node harvests, by the node zone and the node tool tier.',
    labelNames: ['band', 'tier'],
    registers: [registry],
  });
  // The full zone x tier cross product, not just the combos live content fills:
  // Eastbrook has no tier-3 ground, and that permanent zero is the honest
  // answer to "is anyone working thornpeak-grade nodes in the starter zone".
  for (const band of HARVEST_BANDS) {
    for (const tier of NODE_TIERS) harvests.inc({ band, tier }, 0);
  }

  // The fishing family: one counter per outcome, all sharing the zone x band
  // label pair so a rate is a division of two series with identical labels
  // (koi per catch, empty hooks per cast) rather than a join across shapes.
  const fishingCounter = (name: string, help: string): Counter<'zone' | 'band'> => {
    const counter = new Counter({
      name,
      help,
      labelNames: ['zone', 'band'] as const,
      registers: [registry],
    });
    // Prom counters cannot backfill a scrape: every zone x band series is
    // visible from boot, so an empty band reads as a real zero rather than as
    // a gap a dashboard has to guess at.
    for (const zone of HARVEST_BANDS) {
      for (const band of FISHING_BANDS) counter.inc({ zone, band }, 0);
    }
    return counter;
  };

  const fishingCasts = fishingCounter(
    WOC_FISHING_CASTS_TOTAL,
    'Total fishing casts started, by water zone and effective band.',
  );
  const fishingCatches = fishingCounter(
    WOC_FISHING_CATCHES_TOTAL,
    'Total landed catches (the rare koi included), by water zone and effective band.',
  );
  const fishingKoi = fishingCounter(
    WOC_FISHING_KOI_TOTAL,
    'Total landed rare koi, a subset of the catches counter, by water zone and effective band.',
  );
  const fishingGotAways = fishingCounter(
    WOC_FISHING_GOT_AWAYS_TOTAL,
    'Total fishing got-aways (missed reel, timed-out session, or no bag room), by zone and band.',
  );
  const fishingEarlyReels = fishingCounter(
    WOC_FISHING_EARLY_REELS_TOTAL,
    'Total fishing sessions ended by a pre-bite re-press (the anti-spam early reel), by zone and band.',
  );
  const fishingEmptyHooks = fishingCounter(
    WOC_FISHING_EMPTY_HOOKS_TOTAL,
    'Total fishing casts whose table draw resolved the empty row, by water zone and effective band.',
  );

  const rodFeePayments = new Counter({
    name: WOC_ROD_FEE_PAYMENTS_TOTAL,
    help: 'Total rod recipes successfully trained, by recipe id (one training fee paid each).',
    labelNames: ['recipe'],
    registers: [registry],
  });
  const rodFeeCopper = new Gauge({
    name: WOC_ROD_FEE_COPPER,
    help: 'The static training fee in copper for each rod recipe. Aggregate across realms with max() by (recipe), never sum(): total copper is sum(sum by (recipe) (payments) * max by (recipe) (this gauge)).',
    labelNames: ['recipe'],
    registers: [registry],
  });
  for (const recipe of ROD_FEE_RECIPE_IDS) {
    rodFeePayments.inc({ recipe }, 0);
    // Static content, set once at registration: the fee is a pure tier lookup
    // over a frozen recipe record, so there is nothing to re-read at scrape.
    rodFeeCopper.set({ recipe }, rodFeeForRecipe(recipe));
  }

  const bgMatches = new Counter({
    name: WOC_BATTLEGROUND_MATCHES_TOTAL,
    help: 'Total resolved RATED Thornhollow Fields matches, by ending (caps, timer, forfeit) and composition (premade, pug). The ending split is the BG_CAPS_TO_WIN tuning read.',
    labelNames: ['ending', 'composition'],
    registers: [registry],
  });
  const bgDurationSeconds = new Counter({
    name: WOC_BATTLEGROUND_DURATION_SECONDS_TOTAL,
    help: 'Summed ACTIVE seconds of resolved rated Thornhollow Fields matches, same labels. A SUM: mean length is this divided by woc_battleground_matches_total.',
    labelNames: ['ending', 'composition'],
    registers: [registry],
  });
  const bgCaptures = new Counter({
    name: WOC_BATTLEGROUND_CAPTURES_TOTAL,
    help: 'Summed final scores of resolved rated Thornhollow Fields matches, by ending and by the high or low side of the result. A SUM: mean captures per side is this divided by woc_battleground_matches_total.',
    labelNames: ['ending', 'side'],
    registers: [registry],
  });
  // Same zero-backfill as the drop causes: an operator comparing the timer share
  // against the caps share needs both series to exist from boot, not from the
  // first match that happens to end that way.
  // The label is named `ending`, deliberately NOT `cause`: the ws-drop family
  // already owns a `cause` label whose vocabulary is pinned by a registry-wide
  // label scan, and a second family sharing the name would widen that pin
  // rather than merely sit beside it.
  for (const ending of BG_END_CAUSES) {
    for (const composition of BG_COMPOSITIONS) {
      bgMatches.inc({ ending, composition }, 0);
      bgDurationSeconds.inc({ ending, composition }, 0);
    }
    for (const side of BG_SCORE_SIDES) bgCaptures.inc({ ending, side }, 0);
  }

  return {
    wsMessage(direction: WsMessageDirection): void {
      try {
        wsMessages.inc({ direction });
      } catch {
        // Drop the sample rather than propagate into the message path.
      }
    },
    wsMessageDropped(cause: WsDropCause): void {
      try {
        wsMessagesDropped.inc({ cause });
      } catch {
        // Drop the sample rather than propagate into the message path.
      }
    },
    wsRateKick(): void {
      try {
        wsRateKicks.inc();
      } catch {
        // Drop the sample rather than propagate into the kick path.
      }
    },
    wsInputSeqGap(missed: number): void {
      try {
        inputFramesMissed.inc(missed);
      } catch {
        // Drop the sample rather than propagate into the input path.
      }
    },
    riftForgeRefused(): void {
      try {
        riftForgeRefusals.inc();
      } catch {
        // Drop the sample rather than propagate into the dispatch path.
      }
    },
    chatMessage(): void {
      try {
        chatMessages.inc();
      } catch {
        // Drop the sample rather than propagate into the chat path.
      }
    },
    generalChatQuota(outcome: GeneralChatQuotaOutcome): void {
      try {
        if (!GENERAL_CHAT_QUOTA_OUTCOMES.includes(outcome)) return;
        generalChatQuota.inc({ outcome });
      } catch {
        // Drop the sample rather than propagate into the chat path.
      }
    },
    generalChatQuotaDbCall(outcome: GeneralChatQuotaDbOutcome, durationSeconds: number): void {
      try {
        if (!GENERAL_CHAT_QUOTA_DB_OUTCOMES.includes(outcome)) return;
        generalChatQuotaDbCalls.inc({ outcome });
        if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
          generalChatQuotaDbDuration.observe({ outcome }, durationSeconds);
        }
      } catch {
        // Drop the sample rather than propagate into the chat path.
      }
    },
    characterCreated(): void {
      try {
        charactersCreated.inc();
      } catch {
        // Drop the sample rather than propagate into the create path.
      }
    },
    bankLedgerGrowthLimitRefused(): void {
      try {
        bankLedgerGrowthLimitRefusals.inc();
      } catch {
        // Observability must never fail the save-refusal path.
      }
    },
    wocEscrowQueue(outcome: WocEscrowQueueOutcome): void {
      try {
        wocEscrowQueue.inc({ kind: outcome });
      } catch {
        // Observability must never fail a listing request.
      }
    },
    guildBankIncident(kind: GuildBankIncident): void {
      try {
        guildBankIncidents.inc({ kind });
      } catch {
        // Drop the sample rather than propagate into the save / reconcile /
        // ledger path this measures (the whole point of measuring it).
      }
    },
    vaultLedgerIncident(kind: VaultLedgerIncident): void {
      try {
        vaultLedgerIncidents.inc({ kind });
      } catch {
        // Drop the sample rather than propagate into the vault dispatch path
        // this measures.
      }
    },
    bankVaultRealmRowBreach(): void {
      try {
        bankVaultRealmRowBreaches.inc();
      } catch {
        // Drop the sample rather than propagate into the reservation path.
      }
    },
    copperCredited(source: CopperFlowSource, amount: number): void {
      try {
        // A counter can only go up: a non-positive or non-finite sample is a
        // caller bug, and dropping it is better than throwing inside dispatch.
        if (Number.isFinite(amount) && amount > 0) copperCredited.inc({ source }, amount);
      } catch {
        // Drop the sample rather than propagate into the command path.
      }
    },
    copperSpent(source: CopperFlowSource, amount: number): void {
      try {
        if (Number.isFinite(amount) && amount > 0) copperSpent.inc({ source }, amount);
      } catch {
        // Drop the sample rather than propagate into the command path.
      }
    },
    harvest(band: HarvestBand, tier: HarvestTier): void {
      try {
        // HarvestBand is plain string (ZoneDef.id is not literal-typed), so
        // this membership check is the cardinality bound: a caller handing us
        // anything off the vocabulary drops the sample instead of minting an
        // unbounded series. The tier is checked the same way even though its
        // type IS literal, because the value crosses the same untyped seam.
        if (!HARVEST_BANDS.includes(band)) return;
        if (!(NODE_TIERS as readonly string[]).includes(tier)) return;
        harvests.inc({ band, tier });
      } catch {
        // Drop the sample rather than propagate into the event-routing path.
      }
    },
    fishingCast(zone: HarvestBand, band: FishingBandLabel): void {
      try {
        if (!fishingLabelsInVocabulary(zone, band)) return;
        fishingCasts.inc({ zone, band });
      } catch {
        // Drop the sample rather than propagate into the event-routing path.
      }
    },
    fishingCatch(zone: HarvestBand, band: FishingBandLabel, koi: boolean): void {
      try {
        if (!fishingLabelsInVocabulary(zone, band)) return;
        fishingCatches.inc({ zone, band });
        // The koi counter is a SUBSET of catches, never an alternative to it:
        // a koi increments both, so koi/catches is the R4 odds read directly.
        if (koi) fishingKoi.inc({ zone, band });
      } catch {
        // Drop the sample rather than propagate into the event-routing path.
      }
    },
    fishingGotAway(zone: HarvestBand, band: FishingBandLabel): void {
      try {
        if (!fishingLabelsInVocabulary(zone, band)) return;
        fishingGotAways.inc({ zone, band });
      } catch {
        // Drop the sample rather than propagate into the event-routing path.
      }
    },
    fishingEarlyReel(zone: HarvestBand, band: FishingBandLabel): void {
      try {
        if (!fishingLabelsInVocabulary(zone, band)) return;
        fishingEarlyReels.inc({ zone, band });
      } catch {
        // Drop the sample rather than propagate into the event-routing path.
      }
    },
    fishingEmptyHook(zone: HarvestBand, band: FishingBandLabel): void {
      try {
        if (!fishingLabelsInVocabulary(zone, band)) return;
        fishingEmptyHooks.inc({ zone, band });
      } catch {
        // Drop the sample rather than propagate into the event-routing path.
      }
    },
    rodFeePaid(recipeId: string): void {
      try {
        // The recipe id reaches here from a client-driven train command, so the
        // membership check is doing real work: only the two content-derived rod
        // recipes may ever become a series.
        if (!isRodFeeRecipe(recipeId)) return;
        rodFeePayments.inc({ recipe: recipeId });
      } catch {
        // Drop the sample rather than propagate into the event-routing path.
      }
    },
    battlegroundResolved(
      cause: BgEndCauseLabel,
      composition: BgCompositionLabel,
      durationSec: number,
      scoreCrimson: number,
      scoreAzure: number,
    ): void {
      try {
        // The cause crosses an untyped seam (it is a string on the drained sim
        // record), so the membership check is this family's cardinality bound.
        // The composition is a boolean at its source and cannot be off-vocabulary.
        if (!isBgEndCause(cause)) return;
        // A non-finite or negative duration would corrupt the very mean the sum
        // exists for; drop the whole sample rather than book a partial one.
        if (!Number.isFinite(durationSec) || durationSec < 0) return;
        if (!Number.isFinite(scoreCrimson) || !Number.isFinite(scoreAzure)) return;
        if (scoreCrimson < 0 || scoreAzure < 0) return;
        const { high, low } = bgScoreSides(scoreCrimson, scoreAzure);
        bgMatches.inc({ ending: cause, composition });
        bgDurationSeconds.inc({ ending: cause, composition }, durationSec);
        bgCaptures.inc({ ending: cause, side: 'high' }, high);
        bgCaptures.inc({ ending: cause, side: 'low' }, low);
      } catch {
        // Drop the sample rather than propagate into the tick path.
      }
    },
  };
}

/** Both fishing labels are plain strings at this seam (the zone comes from a
 *  ZoneDef id), so this membership pair IS the fishing family's cardinality
 *  bound: an off-vocabulary zone or band drops the whole sample rather than
 *  minting a series, and a malformed band is never re-banded into a real one
 *  (that would corrupt the very distribution the counters exist to measure). */
function fishingLabelsInVocabulary(zone: string, band: string): boolean {
  return HARVEST_BANDS.includes(zone) && (FISHING_BANDS as readonly string[]).includes(band);
}
