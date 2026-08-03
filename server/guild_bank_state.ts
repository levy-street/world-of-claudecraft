// Guild bank boot-load and save-collection glue (Guild Bank Phase 3): the two
// host-side halves of the sim's pure load/serialize seam
// (src/sim/guild_bank.ts loadGuildBank / serializeGuildBank). Kept as its own
// module (not a method bank on GameServer) so both are unit-tested against a
// real Sim without a server. The SQL lives in server/db.ts
// (loadGuildBankRows, saveCharacterAndGuildBankState); this module never
// touches the pool.

import type { GuildBankRow, GuildBankSave } from './db';

// The slice of the Sim facade this module needs (structural, so tests can
// hand the real Sim and the types never drag the whole class in).
export interface GuildBankSimPort {
  loadGuildBank(guildId: number, raw: unknown): void;
  guildBanks: ReadonlyMap<number, unknown>;
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

// Collect the escrow-save half for the books a session dirtied. A guild whose
// serialize returns null has NO loaded book, and its write is SKIPPED: an
// empty book must never be persisted over a real row (the load-once /
// serialize-null contract in src/sim/guild_bank.ts).
export function collectGuildBankSaves(
  serialize: (guildId: number) => unknown,
  guildIds: Iterable<number>,
): GuildBankSave[] {
  const saves: GuildBankSave[] = [];
  // Ascending guild-id order so every escrow transaction locks guild_banks
  // rows in one global order: two transactions carrying overlapping book
  // sets can then never deadlock on reversed row-lock order.
  for (const guildId of [...guildIds].sort((a, b) => a - b)) {
    const data = serialize(guildId);
    if (data === null || data === undefined) continue;
    saves.push({ guildId, data });
  }
  return saves;
}
