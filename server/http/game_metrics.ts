// The game-state half of the /metrics exporter: the live game signals that are
// already measured in-memory by GameServer (players/accounts/ws connections online,
// sim entity count, achieved sim Hz, per-phase loop timing) plus the three
// throughput counters (ws frames, chat messages, characters created), all
// registered on the SAME prom-client registry the RED exporter builds
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
// (p95, max), and the two ws directions (in, out). Nothing per-player (account id,
// character id, name, ip) is ever a label. The tick-phase series count is fixed at
// WOC_TICK_PHASES.length * 2, independent of the profiler's internal phase set.

import { Counter, Gauge, type Registry } from 'prom-client';
import type { GameMetricsCounters, WsMessageDirection } from './game_signals';

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

/** Per-phase authoritative-loop timing in SECONDS, labeled by phase and stat (p95/max). */
export const WOC_SIM_TICK_PHASE_SECONDS = 'woc_sim_tick_phase_seconds';

/** Total ws frames handled, labeled by direction (in/out). */
export const WOC_WS_MESSAGES_TOTAL = 'woc_ws_messages_total';

/** Total player chat messages routed to other players (any channel). */
export const WOC_CHAT_MESSAGES_TOTAL = 'woc_chat_messages_total';

/** Total characters successfully created. */
export const WOC_CHARACTERS_CREATED_TOTAL = 'woc_characters_created_total';

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

  return {
    wsMessage(direction: WsMessageDirection): void {
      try {
        wsMessages.inc({ direction });
      } catch {
        // Drop the sample rather than propagate into the message path.
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
  };
}
