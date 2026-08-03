// Guild bank boot-load and save-collection glue (Guild Bank Phase 3): the two
// host-side halves of the sim's pure load/serialize seam
// (src/sim/guild_bank.ts loadGuildBank / serializeGuildBank), plus the ESCROW
// MERGE the save path writes through (the escrow root fix,
// docs/guild-bank/escrow-fix-plan.md). Kept as its own module (not a method
// bank on GameServer) so all three are unit-tested against a real Sim without a
// server. The SQL lives in server/db.ts (loadGuildBankRows,
// saveCharacterAndGuildBankState); this module never touches the pool.

import {
  applyGuildBankDeltasTo,
  type GuildBankDeltaDeficit,
  type GuildBankOpDelta,
  type GuildBankState,
  sanitizeGuildBankState,
} from '../src/sim/guild_bank';
import type { GuildBankRow } from './db';
import { netGuildBankOpLogForReplay } from './guild_bank_op_log';

// The slice of the Sim facade this module needs (structural, so tests can
// hand the real Sim and the types never drag the whole class in).
export interface GuildBankSimPort {
  loadGuildBank(guildId: number, raw: unknown): void;
  guildBanks: ReadonlyMap<number, unknown>;
}

// One guild's half of an escrow save. The payload is the session's OWN
// unflushed deltas, never the whole shared live book: a session that persisted
// the live book would carry every OTHER officer's not-yet-durable ops into the
// row, which is the dupe this design exists to prevent. The row itself is
// rebuilt inside the transaction by mergeGuildBankRow below.
export interface GuildBankSave {
  guildId: number;
  deltas: readonly GuildBankOpDelta[];
}

// What one guild's book write actually did, reported back out of the
// transaction so the session can release (or keep) its dirty mark honestly.
export interface GuildBankWriteResult {
  guildId: number;
  // false when nothing was written at all: either the FIRST of this session's
  // deltas could not be replayed onto durable truth (deficit, below) or the
  // stored row is oversized/malformed and must be preserved for a human.
  written: boolean;
  // How many of the session's carried deltas landed IN FULL, a prefix. The
  // session consumes exactly this many from the front of its log; the rest
  // stay for a later save (their character half is already durable, so the
  // reconcile must never replay them backward).
  applied: number;
  // The leftover of a PARTLY applied delta (durable truth covered some of the
  // copper or copies it moved). The session replaces that entry with this one
  // and retries it later.
  residual: GuildBankOpDelta | null;
  // Non-null when the replay stopped short: another officer consumed value
  // that is not durable yet, or the durable ladder is behind (the D5 residue
  // class). The session keeps the remaining log and retries.
  deficit: GuildBankDeltaDeficit | null;
  // true when the row was skipped because it is oversized or structurally not
  // a book: a preservation skip, NOT a deficit (nothing to retry).
  rowUnusable: boolean;
}

export interface GuildBankBootResult {
  // Guilds whose book was injected (their sim.guildBanks.has() verified true).
  loaded: number[];
  // Guilds whose row exceeded the size bound: SKIPPED entirely (no book, ops
  // stay silently inert, the row is preserved on disk). Never loaded empty:
  // an empty book would be persisted over the real row by the next save.
  oversized: number[];
  // Guilds whose row is structurally not a book (see isMalformedGuildBankRow):
  // SKIPPED exactly like the oversized case, preserving the row for a human.
  malformed: number[];
  // Guilds the has() verification failed for after a load attempt (a wiring
  // defect: loadGuildBank refuses non-positive ids, nothing else).
  missing: number[];
}

// A row under the size bound can still be structurally NOT a book (a corrupt
// or foreign write): sanitizeGuildBankState would dutifully salvage it into a
// near-empty book, which the next escrow save would then persist OVER the
// real row, destroying whatever the blob still encoded. Loads never destroy,
// so a top-level shape mismatch is treated exactly like the oversized case:
// skip-and-preserve (that guild's ops stay inert; the row survives on disk).
// Null/undefined is NOT malformed: no row means an empty book by design.
// Deliberately shallow: per-slot salvage inside a well-shaped book remains
// sanitizeGuildBankState's job (the mail precedent).
export function isMalformedGuildBankRow(data: unknown): boolean {
  if (data === null || data === undefined) return false;
  if (typeof data !== 'object' || Array.isArray(data)) return true;
  const d = data as { inventory?: unknown };
  return d.inventory !== undefined && !Array.isArray(d.inventory);
}

// Inject every realm guild's book into the LIVE sim through the ONE load path.
// A guild with no row (data null, not oversized) loads an EMPTY book: a realm
// created before the guild bank shipped boots exactly like one created after,
// and ops for every non-oversized guild are live the moment players join.
// Verifies sim.guildBanks.has(guildId) for every guild it loaded (the Phase 3
// acceptance line); the caller logs oversized and missing loudly.
export function loadGuildBanksIntoSim(
  sim: GuildBankSimPort,
  rows: readonly GuildBankRow[],
): GuildBankBootResult {
  const result: GuildBankBootResult = { loaded: [], oversized: [], malformed: [], missing: [] };
  for (const row of rows) {
    if (row.oversized) {
      result.oversized.push(row.guildId);
      continue;
    }
    if (isMalformedGuildBankRow(row.data)) {
      result.malformed.push(row.guildId);
      continue;
    }
    // Parsed JSONB in, empty book on null: sanitizeGuildBankState owns the
    // shape (items are never destroyed; tampered rows sanitize).
    sim.loadGuildBank(row.guildId, row.data);
    if (sim.guildBanks.has(row.guildId)) result.loaded.push(row.guildId);
    else result.missing.push(row.guildId);
  }
  return result;
}

// THE ESCROW MERGE. Rebuild a guild's row as "durable truth plus THIS
// session's own deltas": sanitize the locked row through the ONE load path,
// then replay the session's unflushed log forward onto it.
//
// A guild with no row yields the empty book, which is the correct base (a
// pre-feature guild's deltas apply onto empty and the upsert creates the row).
// An oversized or structurally malformed row is PRESERVED, exactly like the
// boot load: the caller must skip the write rather than overwrite it.
//
// A deficit means the replay stopped short: this session consumed value
// another officer has not made durable yet (or its ladder step needs a rung
// that officer has not committed). The applied PREFIX is still written, and
// the caller keeps the remainder to retry on a later save, by which time the
// other officer's commit has landed. The shortfall is never silently clamped
// away: clamping mints it, because this session's character half durably
// gained what the book never durably lost.
export function mergeGuildBankRow(
  durableRaw: unknown,
  deltas: readonly GuildBankOpDelta[],
  opts: { oversized?: boolean } = {},
): { data: GuildBankState | null; result: Omit<GuildBankWriteResult, 'guildId'> } {
  if (opts.oversized || isMalformedGuildBankRow(durableRaw)) {
    return {
      data: null,
      result: { written: false, applied: 0, residual: null, deficit: null, rowUnusable: true },
    };
  }
  const base = sanitizeGuildBankState(durableRaw);
  const { applied, residual, deficit } = applyGuildBankDeltasTo(base, deltas);
  if (deficit) {
    // The ordered replay can stall on an artifact of CROSS-SESSION ordering
    // rather than a real shortfall: this session's own withdraw ran while the
    // live book still held another officer's copper, and the durable replay
    // put that officer's whole log first. Retry from the same base with the
    // log NETTED (same final book, every intermediate dip removed; see
    // netGuildBankOpLogForReplay). Only a FULL netted replay is taken;
    // otherwise the ordered prefix stands.
    const netted = sanitizeGuildBankState(durableRaw);
    const compacted = applyGuildBankDeltasTo(netted, netGuildBankOpLogForReplay(deltas));
    if (!compacted.deficit) {
      return {
        data: netted,
        result: {
          written: true,
          applied: deltas.length,
          residual: null,
          deficit: null,
          rowUnusable: false,
        },
      };
    }
  }
  if (applied === 0 && residual === null) {
    return {
      data: null,
      result: { written: false, applied: 0, residual: null, deficit, rowUnusable: false },
    };
  }
  return { data: base, result: { written: true, applied, residual, deficit, rowUnusable: false } };
}

// Collect the escrow-save half for the books a session dirtied: one entry per
// guild carrying that session's OWN unflushed deltas. A guild whose serialize
// returns null has NO loaded book, and its write is SKIPPED: an unloaded book
// means the row is not this process's to touch (the load-once / serialize-null
// contract in src/sim/guild_bank.ts, which also covers the oversized and
// malformed boot skips).
export function collectGuildBankDeltas(
  serialize: (guildId: number) => unknown,
  deltasFor: (guildId: number) => readonly GuildBankOpDelta[],
  guildIds: Iterable<number>,
): GuildBankSave[] {
  const saves: GuildBankSave[] = [];
  // Ascending guild-id order so every escrow transaction locks guild_banks
  // rows in one global order: two transactions carrying overlapping book
  // sets can then never deadlock on reversed row-lock order.
  for (const guildId of [...guildIds].sort((a, b) => a - b)) {
    if (serialize(guildId) == null) continue;
    // COPY the log, never alias it: the write is awaited, and an op dispatched
    // during that await appends to the live log. A payload that aliased it
    // would carry an entry the post-commit prefix splice does not account for
    // (the captured count is taken here, at the same instant), so the mid-save
    // op would be persisted AND left in the log to persist again.
    saves.push({ guildId, deltas: [...deltasFor(guildId)] });
  }
  return saves;
}
