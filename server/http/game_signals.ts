// The game-state counter seam: the throughput counters that live on the /metrics
// exporter (woc_ws_messages_total, woc_ws_messages_dropped_total,
// woc_ws_rate_kicks_total, woc_input_frames_missed_total,
// woc_chat_messages_total, woc_characters_created_total) reach the exporter
// through this one process-wide slot instead of each emission site (game.ts
// message dispatch and inbound gate/lanes, chat routing, characters.ts create
// path) threading a sink through its constructors. main.ts
// installs the real implementation (registerGameStateMetrics(...), so every
// counter shares the exporter's one registry) once at boot, exactly like
// setAttackSignalSink; before that, and in any test that never wires one, the slot
// holds the no-op and every emission is dropped.
//
// This is the counter half of the game-state metrics. The gauges (players online,
// tick rate, ...) are read live at scrape time and need no slot: they pull from a
// GameStateSource the exporter registration captures. See server/http/game_metrics.ts.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as server/http/metrics.ts: the
// only label values here are the ws-message direction (a fixed two) and the
// inbound drop cause (the fixed six-value WS_DROP_CAUSES set). Nothing
// per-player (account id, character id, name, ip) is ever passed as a label.

/** The two directions a ws frame is counted under: client-to-server or server-to-client. */
export type WsMessageDirection = 'in' | 'out';

/**
 * The fixed six causes an inbound ws frame can be dropped for: the two
 * pre-parse gate causes (server/msg_rate_limit.ts), the three post-parse
 * lanes (server/msg_lanes.ts), and the list-read guard on the ignore/block
 * readouts (server/list_read_guard.ts). This closed set IS the cause label's
 * whole vocabulary; it never grows per-player or per-message.
 */
export const WS_DROP_CAUSES = [
  'rate',
  'bytes',
  'lane_movement',
  'lane_command',
  'lane_chat',
  'list_read',
] as const;

/** One of the fixed six inbound drop causes. */
export type WsDropCause = (typeof WS_DROP_CAUSES)[number];

/**
 * The game-state throughput emission hooks. Implementations must never
 * throw: an observability write can never be allowed to break the message,
 * chat, or character-create path it measures.
 */
export interface GameMetricsCounters {
  /** One ws frame handled, in the given direction. */
  wsMessage(direction: WsMessageDirection): void;
  /** One inbound ws frame dropped by the gate, a lane, or the list-read guard. */
  wsMessageDropped(cause: WsDropCause): void;
  /** One session kicked by the inbound-flood abuse window (gate or lane driven). */
  wsRateKick(): void;
  /**
   * A parsed input frame proved `missed` earlier input frames were sent and
   * never processed (the seq gap on the ordered socket, R9): the
   * input-frame-attributed share of the server's own drops. Client-attested:
   * seqs are client-sent, so a hostile client can fabricate gaps (each
   * observation capped by MSG_SEQ_GAP_SANITY); operators correlate the
   * counter with the drop-cause series instead of reading it as proven
   * server-side loss on its own (soak-packet-3.md carries the scrape guidance).
   */
  wsInputSeqGap(missed: number): void;
  /** One player chat message routed to other players (any channel). */
  chatMessage(): void;
  /** One character successfully created. */
  characterCreated(): void;
}

/** A sink that drops every signal; the slot default until boot wires the real one. */
export const noopGameMetricsCounters: GameMetricsCounters = {
  wsMessage() {},
  wsMessageDropped() {},
  wsRateKick() {},
  wsInputSeqGap() {},
  chatMessage() {},
  characterCreated() {},
};

let activeCounters: GameMetricsCounters = noopGameMetricsCounters;

/**
 * Install the process-wide game-state counter sink. Called once at boot with the
 * exporter-backed implementation; tests install a recording fake and restore
 * noopGameMetricsCounters when done.
 */
export function setGameMetricsCounters(sink: GameMetricsCounters): void {
  activeCounters = sink;
}

/** The current game-state counter sink. Read at emission time, never captured at import. */
export function gameMetricsCounters(): GameMetricsCounters {
  return activeCounters;
}
