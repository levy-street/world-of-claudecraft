// Economy Watch, phase 1: the HOST GLUE between the world loop and the
// LedgerWriter. Owns the writer instance, the sim-entity-to-durable-character
// resolution, and the shutdown drain, so `server/game.ts` carries two lines of
// wiring and none of the logic.
//
// The writer is a PROCESS-GLOBAL singleton, the same discipline
// `server/bank_ledger.ts` already uses for its FIFO tail, and for the same
// reason: one process serves exactly one realm (server/CLAUDE.md, "One process
// = one realm"), so a per-realm writer and a per-process writer are the same
// object. Holding it here rather than as a `GameServer` field is what keeps the
// monolith ratchet green: `tests/monolith_budget.test.ts` pins game.ts at a
// line ceiling with effectively no headroom, and the policy for new behavior is
// extraction into a sibling, never growth.
//
// Lazily constructed on first use so importing this module costs nothing at
// boot and a host that never ticks (a unit test importing game.ts for a source
// scan) never builds a writer or touches the pool.

import type { SimEvent } from '../src/sim/types';
import { LedgerWriter } from './gold_ledger';
import { insertGoldLedgerBatch, loadChainHeads } from './gold_ledger_db';
import { REALM } from './realm';

/**
 * The slice of a live session the ledger needs. Declared structurally so this
 * module never imports `ClientSession` from `game.ts` (which would be a cycle),
 * and so a test drives it with a two-field object.
 */
export interface LedgerSession {
  characterId: number;
  accountId: number;
  /** The `play_sessions` row id, or null until that insert lands. */
  dbSessionId: number | null;
}

/** The live-session lookup the host passes in: `GameServer.clients`, keyed by pid. */
export type LedgerSessionSource = ReadonlyMap<number, LedgerSession>;

let writer: LedgerWriter | null = null;
// The session map for the CURRENT tick, read by the resolver below. Rebound on
// every observe call rather than captured once, so the writer never holds a
// reference to a torn-down host and a test can swap hosts between calls.
let sessions: LedgerSessionSource | null = null;

function ledgerWriter(): LedgerWriter {
  if (writer) return writer;
  writer = new LedgerWriter({
    realm: REALM,
    deps: { insertBatch: insertGoldLedgerBatch, loadChainHeads },
    resolveActor: (pid) => {
      const s = sessions?.get(pid);
      // No live session behind this pid: an offline or headless host, or a
      // character already torn down. The writer's contract is to SKIP rather
      // than invent a character_id for a keep-forever table.
      if (!s || !s.characterId) return null;
      return {
        characterId: s.characterId,
        accountId: s.accountId,
        sessionId: s.dbSessionId === null ? null : String(s.dbSessionId),
      };
    },
  });
  return writer;
}

/**
 * Record this tick's economy events. Called from the world loop right after the
 * sim drains, BEFORE routeEvents, for the same reason the parse recorder is:
 * routeEvents early-outs when no clients are connected, and a coin movement
 * must be written down whether or not anybody is online to see it.
 *
 * Never awaits and never throws into the loop (see `LedgerWriter.observe`).
 */
export function recordEconomyEvents(
  events: readonly SimEvent[],
  tick: number,
  clients: LedgerSessionSource,
): void {
  sessions = clients;
  ledgerWriter().observe(events, tick);
}

/** Writer counters for the /metrics exporter and the reconciliation job. */
export function goldLedgerStats() {
  return ledgerWriter().stats();
}

/**
 * Flush everything and settle. Called on graceful shutdown so a deploy does not
 * discard the tail of the audit trail, and by tests that need the queue drained
 * deterministically before asserting.
 */
export async function drainGoldLedger(): Promise<void> {
  if (!writer) return;
  await writer.drain();
}

/** Drop the singleton, for tests that need a fresh writer per case. */
export function resetGoldLedgerForTests(): void {
  writer = null;
  sessions = null;
}
