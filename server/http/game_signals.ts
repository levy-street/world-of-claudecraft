// The game-state counter seam: the throughput counters that live on the /metrics
// exporter (woc_ws_messages_total, woc_chat_messages_total,
// woc_characters_created_total) reach the exporter through this one process-wide
// slot instead of each emission site (game.ts message dispatch, chat routing,
// characters.ts create path) threading a sink through its constructors. main.ts
// installs the real implementation (registerGameStateMetrics(...), so all three
// counters share the exporter's one registry) once at boot, exactly like
// setAttackSignalSink; before that, and in any test that never wires one, the slot
// holds the no-op and every emission is dropped.
//
// This is the counter half of the game-state metrics. The gauges (players online,
// tick rate, ...) are read live at scrape time and need no slot: they pull from a
// GameStateSource the exporter registration captures. See server/http/game_metrics.ts.
//
// CARDINALITY IS BOUNDED BY DESIGN, same contract as server/http/metrics.ts: the
// only label value here is the ws-message direction, one of a fixed two. Nothing
// per-player (account id, character id, name, ip) is ever passed as a label.

/** The two directions a ws frame is counted under: client-to-server or server-to-client. */
export type WsMessageDirection = 'in' | 'out';

/**
 * The three game-state throughput emission hooks. Implementations must never
 * throw: an observability write can never be allowed to break the message,
 * chat, or character-create path it measures.
 */
export interface GameMetricsCounters {
  /** One ws frame handled, in the given direction. */
  wsMessage(direction: WsMessageDirection): void;
  /** One player chat message routed to other players (any channel). */
  chatMessage(): void;
  /** One character successfully created. */
  characterCreated(): void;
}

/** A sink that drops every signal; the slot default until boot wires the real one. */
export const noopGameMetricsCounters: GameMetricsCounters = {
  wsMessage() {},
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
