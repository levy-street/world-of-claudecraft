// The guild bank ACTIVITY LOG read path: the guild-visible projection of one
// guild's append-only bank_ledger rows (readable by EVERY member since the
// v0.35 member read-only view; the gate is the bank's own membership gate).
//
// WHY IT EXISTS. Editing the guild bank is officer-only, so any officer can
// quietly drain shared property. Every op already writes a bank_ledger row with
// the actor, the op, the item, the counts and both copper sides; the knowledge
// has always been there and only the operator could see it. Making officer
// actions visible to the whole guild is the social trust mechanism that makes
// officer-only withdrawals defensible in the first place, so this read is a
// FEATURE of the permission model, not a reporting extra, and widening it to
// the members whose pooled goods the officers steward strengthens it.
//
// WHAT IS DELIBERATELY WITHHELD, and why each one:
//   - `escrow_deficit` and `counterparty_orphan` are DIAGNOSTIC anomaly rows,
//     not things a player did. They exist so an operator can find a conservation
//     defect; rendering "Somebody caused an escrow deficit of 250 copper" to a
//     guild would be alarming, unactionable, and frequently wrong about who was
//     involved (the row's character is whoever's session was rolled back). They
//     never leave the server: the op filter is in the SQL, so a suppressed row
//     is not even fetched, and the client re-states the allowlist independently.
//   - Account ids, IPs, realms, and per-instance item payloads are not selected
//     at all (server/db.ts loadGuildBankLogRows). Character ids are resolved to
//     display names in that same statement, so no internal id ships either.
//   - An `admin_purge` IS shown, and shown as an OPERATOR action with NO name.
//     Hiding it would leave an unexplained gap exactly where a guild's property
//     disappeared, which is worse than saying so. Naming its ledger character
//     would be a straight-up lie: that column holds the escrow CARRIER, an
//     online guild member who merely lent their save transaction and neither
//     ordered nor benefited from the removal (see GameServer.adminPurgeGuild-
//     BankSlot). So the entry carries actor null and the client renders
//     "An administrator removed ..." with no guildmate implicated.
//
// CACHING. The answer is IDENTICAL for every member of a guild, so a
// per-request query would multiply one read by the number of members with the
// window open, on a keep-forever table, for zero added information. It rides
// the repo's cached-read seam (server/cached_read.ts): per-guild TTL +
// single-flight (two officers racing a cold window share ONE query) +
// stale-on-error, in a map bounded by maxEntries with LRU eviction. Freshness
// does not rest on the TTL: server/bank_ledger.ts busts the guild's entry on
// every guild row it writes, both when the op happens and again once the
// inserts have actually settled, so the next reader sees the new row rather
// than a snapshot taken microseconds before it landed.
//
// A guild lives on exactly one realm process, and every writer of its book
// (player ops, the operator purge, the create fee) runs in that process through
// server/bank_ledger.ts, so the bust is COMPLETE rather than best-effort: there
// is no peer-process writer whose row this cache could miss until TTL.

import {
  type GuildBankLogEntry,
  type GuildBankLogOp,
  GUILD_BANK_LOG_LIMIT as SEAM_GUILD_BANK_LOG_LIMIT,
} from '../src/world_api/guild_bank';
import { KeyedCachedRead, type KeyedCachedReadStats } from './cached_read';
import { type GuildBankLogDbRow, loadGuildBankLogRows } from './db';

/** The window size, re-exported from the ONE seam constant
 *  (src/world_api/guild_bank.ts) that the client decoder's hard bound and the
 *  pane's scope line also read: the SQL LIMIT, the truncation bound, and the
 *  sentence a player reads are the same fact, and duplicating it per layer is
 *  how the copy ends up lying in six languages. */
export const GUILD_BANK_LOG_LIMIT = SEAM_GUILD_BANK_LOG_LIMIT;

/** The ops a guild may SEE, and the ORDER is not meaningful (the SQL orders by
 *  id). A closed allowlist rather than a denylist on purpose: a new ledger op
 *  added later is INVISIBLE to players until somebody deliberately decides it
 *  should be shown and writes its sentence, which is the safe direction to fail
 *  for a table that also carries diagnostics. */
export const GUILD_BANK_LOG_VISIBLE_OPS: readonly GuildBankLogOp[] = [
  'deposit',
  'withdraw',
  'deposit_gold',
  'withdraw_gold',
  'buy_slots',
  'open_bank',
  'create_fee',
  'admin_purge',
];

/** The guild-container ops deliberately WITHHELD, named so the exhaustiveness
 *  test can prove visible + hidden covers every op bank_ledger can hold: a new
 *  op that lands in neither list reddens that test instead of silently
 *  defaulting into invisibility nobody reviewed. */
export const GUILD_BANK_LOG_HIDDEN_OPS: readonly string[] = [
  'escrow_deficit',
  'counterparty_orphan',
];

const VISIBLE_OPS: ReadonlySet<string> = new Set(GUILD_BANK_LOG_VISIBLE_OPS);

/** Ops whose actor must NEVER be named. `admin_purge`'s ledger character is the
 *  escrow carrier (a bystander), and its account is the operator, who is not a
 *  guild matter; either name would misattribute a destroyed item. */
const ANONYMOUS_OPS: ReadonlySet<string> = new Set<GuildBankLogOp>(['admin_purge']);

/** How long an installed answer is served without re-querying. Short, but not
 *  the freshness mechanism: the per-guild bust is. This is the ceiling on how
 *  stale an idle guild's log can be if a bust were ever missed, and the floor
 *  on how often a guild-full of officers staring at an unchanging log can cost
 *  a query (once per TTL, no matter how many of them are looking). */
export const GUILD_BANK_LOG_CACHE_TTL_MS = 30_000;

/** Entry bound. Guild bank logs are read only by guild members standing at a
 *  banker with the window open (the cap counts GUILDS, not readers, so the
 *  member-wide audience does not move it), so the live set is tiny; the cap is what keeps a long
 *  uptime with churn from turning the map into an unbounded per-guild residue
 *  (the grows-without-bound defect server/CLAUDE.md forbids). Past the cap the
 *  coldest guild is evicted and its next read costs one extra query. */
export const GUILD_BANK_LOG_CACHE_MAX_ENTRIES = 256;

/** The COALESCING FLOOR: the shortest interval between two refreshes of one
 *  guild's log, whatever the write or read rate. Without it a bust dropped the
 *  entry outright, so every ledger write made the next read a query and the
 *  cache did nothing in the exact state it exists for (a guild actively working
 *  its bank while its officers watch). Two seconds caps refreshes at 0.5/s per
 *  guild and is still an order of magnitude below the interval a human reads a
 *  log at, so an op stays effectively immediate. */
export const GUILD_BANK_LOG_MIN_REFRESH_MS = 2_000;

/**
 * Project one ledger row into the player-visible entry, or null when the row
 * must not be shown. Pure, so the projection rules (the op allowlist, the
 * anonymous ops, the magnitude normalization) are unit-testable without a
 * database.
 *
 * Copper and count are normalized to POSITIVE MAGNITUDES because the op name
 * already carries the direction, and because `copper_delta`'s sign is not a
 * single consistent thing across ops in this table: the gold ops record the
 * TREASURY's signed movement, while `buy_slots`, `open_bank` and `create_fee`
 * record a negated PAYMENT (from the treasury, from the opener's purse, and
 * from the founder's purse respectively). Rendering the raw sign would show
 * "-9g" for opening a bank and "+5g" for a deposit as if they were the same
 * axis. The sentence says what happened; the number says how much.
 */
export function projectGuildBankLogRow(row: GuildBankLogDbRow): GuildBankLogEntry | null {
  if (!VISIBLE_OPS.has(row.op)) return null;
  const op = row.op as GuildBankLogOp;
  const anonymous = ANONYMOUS_OPS.has(op);
  const copperMagnitude = Math.abs(Math.trunc(row.copperDelta));
  const countMagnitude = row.count === null ? 0 : Math.abs(Math.trunc(row.count));
  return {
    id: row.id,
    at: row.at,
    // A null name is also what a vanished character row would produce; it
    // renders as an unnamed guild member rather than as an empty sentence.
    actor: anonymous ? null : (row.characterName ?? null),
    op,
    itemId: row.itemId,
    count: countMagnitude > 0 ? countMagnitude : null,
    copper: copperMagnitude > 0 ? copperMagnitude : null,
  };
}

/** Project a whole result set, dropping anything the allowlist refuses. */
export function projectGuildBankLogRows(
  rows: readonly GuildBankLogDbRow[],
): readonly GuildBankLogEntry[] {
  const out: GuildBankLogEntry[] = [];
  for (const row of rows) {
    const entry = projectGuildBankLogRow(row);
    if (entry !== null) out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The process cache. The database reader is INJECTED (the
// configure<Domain>Runtime idiom) so tests can drive the cache mechanics with a
// counting fake and no Postgres, and so the cache builds lazily: no clock and
// no bound is bound before a test can replace it.
// ---------------------------------------------------------------------------

export type GuildBankLogReader = (guildId: number) => Promise<readonly GuildBankLogEntry[]>;

const defaultReader: GuildBankLogReader = async (guildId) =>
  // Frozen on the way in: this array becomes the SHARED cached value handed to
  // every officer of the guild, so a caller that sorted or spliced it in place
  // would rewrite history for everyone else until the next bust.
  Object.freeze(
    projectGuildBankLogRows(
      await loadGuildBankLogRows(guildId, GUILD_BANK_LOG_LIMIT, GUILD_BANK_LOG_VISIBLE_OPS),
    ),
  );

let reader: GuildBankLogReader = defaultReader;
let active: KeyedCachedRead<readonly GuildBankLogEntry[]> | null = null;
let testOverrides: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  minRefreshMs?: number;
} | null = null;

// Guilds whose log a write has invalidated but whose coalescing floor has not
// yet elapsed, with the wall-clock instant their entry may next be refreshed.
// Bounded by the same maxEntries the cache is (an entry is only ever added for
// a guild that is being read AND written), and pruned as it drains.
const dirtyUntil = new Map<number, number>();

function clock(): number {
  return testOverrides?.now?.() ?? Date.now();
}

function minRefreshMs(): number {
  return testOverrides?.minRefreshMs ?? GUILD_BANK_LOG_MIN_REFRESH_MS;
}

/** The cache's own entry ceiling, which is also the bound on the dirty marks
 *  that shadow it (see bustGuildBankLog's sweep). */
function cacheMaxEntries(): number {
  return testOverrides?.maxEntries ?? GUILD_BANK_LOG_CACHE_MAX_ENTRIES;
}

function activeCache(): KeyedCachedRead<readonly GuildBankLogEntry[]> {
  if (active !== null) return active;
  active = new KeyedCachedRead<readonly GuildBankLogEntry[]>((guildId) => reader(guildId), {
    ttlMs: testOverrides?.ttlMs ?? GUILD_BANK_LOG_CACHE_TTL_MS,
    maxEntries: testOverrides?.maxEntries ?? GUILD_BANK_LOG_CACHE_MAX_ENTRIES,
    now: testOverrides?.now,
  });
  return active;
}

/**
 * The one read every caller uses. Two officers of the same guild racing a cold
 * window share ONE query (single-flight), and a warm entry answers with no
 * query at all.
 *
 * THE COALESCING FLOOR is what makes this a cache in the state it was built
 * for. A bust that simply dropped the entry meant that any guild ledger write
 * made the next read a query, and a guild actively working its bank is exactly
 * when its officers open the log: the TTL then protected nothing, and the read
 * degraded to per-request on a keep-forever table. Worse, dropping the entry
 * mid-flight orphaned the in-flight query, so the next reader minted a SECOND
 * identical one and the single-flight property the cache advertises stopped
 * holding under the only write pattern that matters.
 *
 * So a bust marks the guild DIRTY with an instant it may next refresh, and the
 * installed value keeps serving until then. Refreshes per guild are capped at
 * 1/GUILD_BANK_LOG_MIN_REFRESH_MS no matter how hard the guild is banked or how
 * many officers are watching, and an op is still visible within that floor,
 * which is far below the interval any human reads a log at.
 *
 * The returned array is the SHARED cached instance, deliberately frozen by the
 * reader above so a caller cannot mutate one guild's cached history for every
 * other reader.
 */
export function readGuildBankLog(guildId: number): Promise<readonly GuildBankLogEntry[]> {
  const due = dirtyUntil.get(guildId);
  if (due !== undefined && clock() >= due) {
    // The floor has elapsed and this guild has pending writes: NOW drop the
    // entry, so this reader refreshes and everyone behind it joins that flight.
    dirtyUntil.delete(guildId);
    activeCache().bust(guildId);
  }
  return activeCache().read(guildId);
}

/**
 * Mark one guild's cached log stale. Called by server/bank_ledger.ts for every
 * guild row it writes whose op a player can actually SEE: once when the op
 * happens, and once more after that call's own inserts have settled (a read
 * racing the write would otherwise refresh from a table that does not contain
 * the new row yet and then serve that pre-op snapshot).
 *
 * This does NOT drop the entry (see readGuildBankLog for why): it records the
 * earliest instant the entry may be refreshed, and the next read past that
 * instant does the dropping. A second bust inside an open floor is a no-op
 * rather than a reset, so a burst of writes cannot push the refresh out
 * indefinitely.
 */
export function bustGuildBankLog(guildId: number): void {
  // Enforce the bound the comment above dirtyUntil claims, rather than assuming
  // it: a mark is consumed by the next READ of that guild, so a guild whose
  // cache entry is LRU-evicted before anyone reads it again would keep its mark
  // for the life of the process. Sweeping the marks whose entry is gone is
  // cheap and only runs once the map has actually outgrown the cache it
  // shadows, which cannot happen while every mark still has an entry.
  if (dirtyUntil.size > cacheMaxEntries()) {
    for (const guild of dirtyUntil.keys()) {
      if (!activeCache().has(guild)) dirtyUntil.delete(guild);
    }
  }
  if (dirtyUntil.has(guildId)) return; // already pending; never extend the window
  // No entry at all (nothing installed, nothing in flight) means there is
  // nothing to coalesce: the next read is a cold mint that will see this write
  // anyway, so a dirty mark would only force a redundant second refresh behind
  // it. An IN-FLIGHT entry does get a mark, because that flight may have read
  // the table before this row landed.
  if (!activeCache().has(guildId)) return;
  dirtyUntil.set(guildId, clock() + minRefreshMs());
}

/** Cache telemetry (reads, refreshes, evictions, busts, live entries) plus the
 *  guilds currently sitting inside a coalescing floor. The refresh rate here is
 *  bust rate against read rate against that floor, which is exactly the number
 *  the design rests on and exactly the one that is invisible without a counter;
 *  server/http/game_signals.ts exports it.
 *
 *  Never CONSTRUCTS the cache (the discordStatusCacheStats precedent): a
 *  metrics scrape on an idle process must not mint one as a side effect. */
export function guildBankLogCacheStats(): KeyedCachedReadStats & { dirtyGuilds: number } {
  const stats = active?.stats() ?? {
    reads: 0,
    refreshes: 0,
    evictions: 0,
    busts: 0,
    entries: 0,
  };
  return { ...stats, dirtyGuilds: dirtyUntil.size };
}

/** Test seam: swap the database reader and rebuild the cache. */
export function configureGuildBankLogReader(read: GuildBankLogReader): void {
  reader = read;
  active = null;
}

/** Test seam: reset to the production reader (or keep an injected one) and
 *  rebuild the cache with optional bounds/clock overrides. */
export function resetGuildBankLogCacheForTests(overrides?: {
  ttlMs?: number;
  maxEntries?: number;
  minRefreshMs?: number;
  now?: () => number;
  reader?: GuildBankLogReader;
}): void {
  testOverrides = overrides ?? null;
  dirtyUntil.clear();
  reader = overrides?.reader ?? defaultReader;
  active = null;
}
