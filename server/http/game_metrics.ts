// The game-state half of the /metrics exporter: the live game signals that are
// already measured in-memory by GameServer (players/accounts/ws connections online,
// sim entity count, achieved sim Hz, per-phase loop timing) plus the
// throughput counters (ws frames handled, inbound frames dropped by cause,
// flood kicks, input frames proven missed, chat messages, characters
// created), all registered on the SAME prom-client registry the RED exporter builds
// (server/http/metrics.ts). Prometheus attaches env / service=game / server_name at
// scrape time, so nothing here emits those.
//
// GAUGES ARE READ AT SCRAPE TIME, NO DRIFT. Each gauge carries a collect() that
// pulls the current value from the injected GameStateSource the moment
// registry.metrics() runs, so a scrape always reflects live state and the game loop
// never has to push a sample. COUNTERS are pushed from their emission sites through
// the process-wide slot in server/http/game_signals.ts (installed by main.ts at
// boot with the sink this function returns), exactly like the attack-signal counters.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as server/http/metrics.ts: the
// only label values are the fixed tick-phase names, the two per-phase stats
// (p95, max), the two ws directions (in, out), the fixed six inbound drop
// causes (WS_DROP_CAUSES), and the content-derived economy and fishing
// vocabularies (COPPER_FLOW_SOURCES, HARVEST_BANDS, NODE_TIERS, FISHING_BANDS,
// ROD_FEE_RECIPE_IDS). Nothing per-player (account id,
// character id, name, ip) is ever a label. The tick-phase series count is fixed at
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

import { Counter, Gauge, type Registry } from 'prom-client';
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
import {
  type GameMetricsCounters,
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

/** Total characters successfully created. */
export const WOC_CHARACTERS_CREATED_TOTAL = 'woc_characters_created_total';

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
  /** Per-phase p95/max in MILLISECONDS, keyed by phase name; missing phases are skipped. */
  tickPhaseMillis(): Record<string, TickPhaseMillis>;
  /** pg pool saturation snapshot (pg Pool totalCount/idleCount/waitingCount). */
  dbPool(): { total: number; idle: number; waiting: number };
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

  const chatMessages = new Counter({
    name: WOC_CHAT_MESSAGES_TOTAL,
    help: 'Total player chat messages routed to other players (any channel).',
    registers: [registry],
  });

  const charactersCreated = new Counter({
    name: WOC_CHARACTERS_CREATED_TOTAL,
    help: 'Total characters successfully created.',
    registers: [registry],
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
    chatMessage(): void {
      try {
        chatMessages.inc();
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
