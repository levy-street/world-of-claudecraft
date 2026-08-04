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
  netGuildBankOpLogForReplay,
  sanitizeGuildBankState,
} from '../src/sim/guild_bank';
import type { GuildBankRow } from './db';

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
  // false when the row was NOT written, which always rolls the whole escrow
  // transaction back: the character half must never commit without the book
  // half it is paired with.
  written: boolean;
  // Why the replay was refused: this session took value out of the book that
  // durable truth never held (another officer's deposit is not durable yet).
  deficit: GuildBankDeltaDeficit | null;
  // true when the stored row is oversized or structurally not a book, or the
  // merged blob would cross the size bound. The row is PRESERVED for a human
  // and the write is refused exactly like a deficit.
  rowUnusable: boolean;
}

// Refusing to write a book half must refuse the CHARACTER half with it, so the
// db layer aborts the transaction and throws this rather than returning a
// value the caller could mistake for a fence miss. Lives here, beside the
// merge that raises it, so a test double that mocks server/db can still
// construct and recognise it.
export class GuildBankEscrowRefused extends Error {
  constructor(readonly results: readonly GuildBankWriteResult[]) {
    super('guild bank escrow refused: a book half could not be replayed onto durable truth');
    this.name = 'GuildBankEscrowRefused';
  }
}

// The merged blob a save may write, in BYTES. The READ bound alone is not
// enough: the replay deliberately skips the capacity re-check, so a book that
// grew past the bound would become permanently unreadable and every later save
// would refuse forever. Refusing the WRITE keeps the row inside the bound the
// read enforces. A legitimate book is a few KB (60 slots at most), so this can
// only fire on a tampered one.
//
// The unit is load-bearing and must match both SQL gates, which measure
// `octet_length(data::text)`, i.e. UTF-8 BYTES (server/db.ts writeGuildBankRow
// and loadGuildBankRows, same 262,144 bound). Measuring JS string LENGTH here
// instead would count UTF-16 code units, which is smaller than the byte count
// for every non-ASCII character: a book carrying multi-byte text (a crafter
// name, a signer, a tampered id) could pass this gate at, say, 200k units while
// its UTF-8 encoding is past 262,144 bytes, land durable through a SQL gate
// that only bounds the READ side of the same statement, and then be skipped by
// the boot load as oversized forever. That is exactly the permanent quarantine
// this bound exists to prevent, so the measurement is Buffer.byteLength.
export const GUILD_BANK_MERGED_MAX_BYTES = 262_144;

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
// A deficit means the replay could not be satisfied: this session consumed
// value another officer has not made durable yet (or its ladder step needs a
// rung that officer has not committed). NOTHING is written then, and the whole
// escrow transaction rolls back, character row included: writing what durable
// truth could cover while the paired character half commits mints exactly the
// difference, and recording that is a receipt for a mint rather than a
// mitigation. The caller retries; see server/game.ts
// handleGuildBankEscrowRefusal for what happens when a retry can never win.
export function mergeGuildBankRow(
  durableRaw: unknown,
  deltas: readonly GuildBankOpDelta[],
  opts: { oversized?: boolean } = {},
): { data: GuildBankState | null; result: Omit<GuildBankWriteResult, 'guildId'> } {
  if (opts.oversized || isMalformedGuildBankRow(durableRaw)) {
    return { data: null, result: { written: false, deficit: null, rowUnusable: true } };
  }
  const base = sanitizeGuildBankState(durableRaw);
  const deficit = applyGuildBankDeltasTo(base, deltas);
  if (deficit) {
    // Before refusing, retry from the same base with the log NETTED. The
    // ordered replay can stall on an artifact of CROSS-SESSION ORDERING rather
    // than on real missing value: this session withdrew while the live book
    // still held another officer's copper, and the durable replay put that
    // officer's whole log first, so an intermediate dip appears that the real
    // sequence never had. Netting reaches the SAME final book with the dips
    // removed (see netGuildBankOpLogForReplay), so taking it forgives only the
    // ordering, never a genuine consume: if this session really took more than
    // durable truth holds, the net is still short and the netted replay stalls
    // too. Counted below so the frequency stays visible rather than silent.
    const netted = sanitizeGuildBankState(durableRaw);
    if (applyGuildBankDeltasTo(netted, netGuildBankOpLogForReplay(deltas)) === null) {
      guildBankNettedReplayRescues++;
      return sized(netted);
    }
    return { data: null, result: { written: false, deficit, rowUnusable: false } };
  }
  return sized(base);
}

// The size bound applies to EVERY arm that would write, the netted rescue
// included: a row that crossed it would be skipped by the read bound from then
// on, which quarantines every officer of that guild forever and makes the boot
// load skip the book. A legitimate book is a few KB (60 slots at most), so
// this can only fire on a tampered one.
function sized(data: GuildBankState): {
  data: GuildBankState | null;
  result: Omit<GuildBankWriteResult, 'guildId'>;
} {
  // BYTES, not string length: the SQL gates measure octet_length(data::text).
  // See the constant's note for why the mismatch quarantines a book forever.
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > GUILD_BANK_MERGED_MAX_BYTES) {
    return { data: null, result: { written: false, deficit: null, rowUnusable: true } };
  }
  return { data, result: { written: true, deficit: null, rowUnusable: false } };
}

// How many times the netted retry above rescued a write the ordered replay
// refused. Exported for operators and tests: a rising count is normal traffic
// (officers using one book inside an autosave interval), a count that tracks
// one guild is worth a look.
let guildBankNettedReplayRescues = 0;
export const nettedReplayRescueCount = (): number => guildBankNettedReplayRescues;

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
