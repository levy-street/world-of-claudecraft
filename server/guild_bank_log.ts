// The guild bank TRANSACTION HISTORY read path: the guild-visible projection of
// one guild's append-only bank_ledger rows (readable by EVERY member since the
// v0.35 member read-only view; the gate is the bank's own membership gate),
// served one PAGE at a time (the newest window, then older pages by cursor)
// and filtered by KIND (all, items, money).
//
// WHY IT EXISTS. Editing the guild bank is officer-only, so any officer can
// quietly drain shared property. Every op already writes a bank_ledger row with
// the actor, the op, the item, the counts and both copper sides; the knowledge
// has always been there and only the operator could see it. Making officer
// actions visible to the whole guild is the social trust mechanism that makes
// officer-only withdrawals defensible in the first place, so this read is a
// FEATURE of the permission model, not a reporting extra, and widening it to
// the members whose pooled goods the officers steward strengthens it. Paging
// completes the promise: a recent window answers "who took the ore?", but a
// history that stops at 50 rows lets anything older than a busy week vanish
// from the one surface built to show it.
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
//     at all (server/guild_bank_log_db.ts). Character ids are resolved to
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
// THE QUERY IS A KIND AND A CURSOR, NEVER AN OP LIST. The client says which
// slice it wants (`all`, `items`, `money`) and the oldest id it already holds;
// this module turns the kind into the op predicate from the seam's own
// classification (GUILD_BANK_LOG_OP_KIND), so no request can name an op the
// allowlist does not contain, and an unknown kind reads as `all`.
//
// CACHING. The answer for one (guild, kind, cursor) is IDENTICAL for every
// member of the guild, so a per-request query would multiply one read by the
// number of members with the window open, on a keep-forever table, for zero
// added information. It rides the repo's cached-read seam
// (server/cached_read.ts): per-key TTL + single-flight (two officers racing a
// cold window share ONE query) + stale-on-error, in a map bounded by maxEntries
// with LRU eviction. Freshness does not rest on the TTL. Normal command rows
// invalidate the guild's NEWEST-WINDOW entries only after their exact outbox
// prefix commits atomically with the character and book. Hidden anomaly
// writers do not invalidate because they cannot change this projection. Older
// pages are never busted at all: they are addressed by a cursor into an
// append-only table, so nothing a later write does can change what lies
// before that cursor, and they simply age out on the TTL. The next eligible
// reader therefore sees durable history, while a staged or fenced command can
// never appear as a phantom action.
//
// A guild lives on exactly one realm process, and every writer of its book
// (player ops, the operator purge, the create fee) runs in that process through
// the character-save acknowledgment seams, so
// the bust is COMPLETE rather than best-effort: there is no peer-process writer
// whose row this cache could miss until TTL.

import {
  GUILD_BANK_LOG_KINDS,
  GUILD_BANK_LOG_OP_KIND,
  type GuildBankLogEntry,
  type GuildBankLogKind,
  type GuildBankLogOp,
  guildBankLogKindOf,
  GUILD_BANK_LOG_LIMIT as SEAM_GUILD_BANK_LOG_LIMIT,
} from '../src/world_api/guild_bank';
import { KeyedCachedRead, type KeyedCachedReadStats } from './cached_read';
import { type GuildBankLogDbRow, loadGuildBankLogPage } from './guild_bank_log_db';

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
 *  banker with the window open (the cap counts PAGES, one per guild, kind and
 *  cursor, not readers, so the member-wide audience does not move it), so the
 *  live set is small; the cap is what keeps a long uptime with churn from
 *  turning the map into an unbounded per-guild residue (the grows-without-bound
 *  defect server/CLAUDE.md forbids). Past the cap the coldest page is evicted
 *  and its next read costs one extra query. Raised from the per-guild 256 when
 *  the key grew a kind and a cursor: a guild reading back through its history
 *  holds one entry per page it opened. */
export const GUILD_BANK_LOG_CACHE_MAX_ENTRIES = 1024;

/** The COALESCING FLOOR: the shortest interval between two refreshes of one
 *  guild's newest window, whatever the write or read rate. Without it a bust
 *  dropped the entry outright, so every ledger write made the next read a
 *  query and the cache did nothing in the exact state it exists for (a guild
 *  actively working its bank while its officers watch). Two seconds caps
 *  refreshes at 0.5/s per guild and is still an order of magnitude below the
 *  interval a human reads a log at, so an op stays effectively immediate. */
export const GUILD_BANK_LOG_MIN_REFRESH_MS = 2_000;

/** One read's shape: the slice and the cursor. `before` null is the newest
 *  window; a positive id asks for the rows strictly older than it. */
export interface GuildBankLogQuery {
  kind: GuildBankLogKind;
  before: number | null;
}

/** The newest window of everything: what a client that sends no query fields
 *  (an older client, or the pane's first paint) is asking for. */
export const GUILD_BANK_LOG_HEAD_QUERY: GuildBankLogQuery = Object.freeze({
  kind: 'all',
  before: null,
});

/** One page as the client receives it. */
export interface GuildBankLogPage {
  entries: readonly GuildBankLogEntry[];
  /** Whether the ledger holds visible rows OLDER than the last entry here. A
   *  server fact (the statement probes one row past the window), never
   *  inferred from a full page. */
  more: boolean;
}

/**
 * Read the two query fields off a raw command message. Every field is
 * re-validated: an unknown kind reads as `all` (the widest slice a member may
 * see anyway, so a tampered kind gains nothing), and `before` must be a
 * positive safe integer or it is treated as absent. The guild is NEVER taken
 * from the message (the delivery host resolves it from the membership stamp).
 */
export function parseGuildBankLogQuery(raw: unknown): GuildBankLogQuery {
  if (typeof raw !== 'object' || raw === null) return GUILD_BANK_LOG_HEAD_QUERY;
  const msg = raw as Record<string, unknown>;
  const before =
    Number.isSafeInteger(msg.before) && (msg.before as number) > 0 ? (msg.before as number) : null;
  return { kind: guildBankLogKindOf(msg.kind), before };
}

/** The op predicate one kind asks for: the visible allowlist, narrowed by the
 *  seam's classification. `all` is the whole allowlist, so the head-of-log read
 *  every older client sends is unchanged. */
export function guildBankLogOpsFor(kind: GuildBankLogKind): readonly GuildBankLogOp[] {
  if (kind === 'all') return GUILD_BANK_LOG_VISIBLE_OPS;
  return GUILD_BANK_LOG_VISIBLE_OPS.filter((op) => GUILD_BANK_LOG_OP_KIND[op] === kind);
}

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
// The process cache. The database reader is INJECTED, swappable only via the
// `reader` override on resetGuildBankLogCacheForTests below, so tests can
// drive the cache mechanics with a counting fake and no Postgres, and so the
// cache builds lazily: no clock and no bound is bound before a test can
// replace it.
// ---------------------------------------------------------------------------

export type GuildBankLogReader = (
  guildId: number,
  query: GuildBankLogQuery,
) => Promise<GuildBankLogPage>;

const defaultReader: GuildBankLogReader = async (guildId, query) => {
  const page = await loadGuildBankLogPage(
    guildId,
    GUILD_BANK_LOG_LIMIT,
    guildBankLogOpsFor(query.kind),
    query.before,
  );
  // Frozen on the way in: this page becomes the SHARED cached value handed to
  // every member of the guild, so a caller that sorted or spliced it in place
  // would rewrite history for everyone else until the next bust.
  return Object.freeze({
    entries: Object.freeze(projectGuildBankLogRows(page.rows)),
    more: page.more,
  });
};

let reader: GuildBankLogReader = defaultReader;
let active: KeyedCachedRead<GuildBankLogPage, string> | null = null;
let testOverrides: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  minRefreshMs?: number;
} | null = null;

// Guilds whose newest window a write has invalidated but whose coalescing
// floor has not yet elapsed, with the wall-clock instant their entries may
// next be refreshed. Bounded by the same maxEntries the cache is (an entry is
// only ever added for a guild that is being read AND written), and pruned as
// it drains.
const dirtyUntil = new Map<number, number>();

/** The cache key: one entry per (guild, kind, cursor). The guild leads so a
 *  key is never confusable across guilds, and the cursor is `0` for the newest
 *  window so the head keys of one guild are enumerable without a scan. */
function pageKey(guildId: number, query: GuildBankLogQuery): string {
  return `${guildId}:${query.kind}:${query.before ?? 0}`;
}

/** The three newest-window keys of one guild: the entries a write can change. */
function headKeys(guildId: number): string[] {
  return GUILD_BANK_LOG_KINDS.map((kind) => pageKey(guildId, { kind, before: null }));
}

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

function activeCache(): KeyedCachedRead<GuildBankLogPage, string> {
  if (active !== null) return active;
  active = new KeyedCachedRead<GuildBankLogPage, string>(
    (key) => {
      // The key is minted by pageKey above, so this is a decode of our own
      // format, never of anything a client sent.
      const [guild, kind, before] = key.split(':');
      const cursor = Number(before);
      return reader(Number(guild), {
        kind: guildBankLogKindOf(kind),
        before: cursor > 0 ? cursor : null,
      });
    },
    {
      ttlMs: testOverrides?.ttlMs ?? GUILD_BANK_LOG_CACHE_TTL_MS,
      maxEntries: testOverrides?.maxEntries ?? GUILD_BANK_LOG_CACHE_MAX_ENTRIES,
      now: testOverrides?.now,
    },
  );
  return active;
}

/** Whether any newest-window entry of this guild is installed or in flight. */
function hasHead(guildId: number): boolean {
  return headKeys(guildId).some((key) => activeCache().has(key));
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
 * The returned page is the SHARED cached instance, deliberately frozen by the
 * reader above so a caller cannot mutate one guild's cached history for every
 * other reader.
 */
export function readGuildBankLog(
  guildId: number,
  query: GuildBankLogQuery = GUILD_BANK_LOG_HEAD_QUERY,
): Promise<GuildBankLogPage> {
  const due = dirtyUntil.get(guildId);
  if (due !== undefined && clock() >= due) {
    // The floor has elapsed and this guild has pending writes: NOW drop its
    // newest-window entries, so this reader refreshes and everyone behind it
    // joins that flight. Older pages stay: a cursor into an append-only table
    // cannot be changed by a later write.
    dirtyUntil.delete(guildId);
    for (const key of headKeys(guildId)) activeCache().bust(key);
  }
  return activeCache().read(pageKey(guildId, query));
}

/**
 * Mark one guild's cached newest window stale. Normal operations call this
 * only after their exact character-save outbox prefix commits and is
 * acknowledged. Callers must never bust for staged evidence because a lease
 * fence may still roll it back.
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
  // cache entries are LRU-evicted before anyone reads it again would keep its
  // mark for the life of the process. Sweeping the marks whose entries are
  // gone is cheap and only runs once the map has actually outgrown the cache
  // it shadows, which cannot happen while every mark still has an entry.
  if (dirtyUntil.size > cacheMaxEntries()) {
    for (const guild of dirtyUntil.keys()) {
      if (!hasHead(guild)) dirtyUntil.delete(guild);
    }
  }
  if (dirtyUntil.has(guildId)) return; // already pending; never extend the window
  // No newest-window entry at all (nothing installed, nothing in flight) means
  // there is nothing to coalesce: the next read is a cold mint that will see
  // this write anyway, so a dirty mark would only force a redundant second
  // refresh behind it. An IN-FLIGHT entry does get a mark, because that flight
  // may have read the table before this row landed.
  if (!hasHead(guildId)) return;
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
