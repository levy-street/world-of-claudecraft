// The marketplace-scoped cache over the two per-request auth-guard reads
// (token probe + moderation status), the second settled perf rider. It is
// consumed ONLY through the woc_market_routes guard bundle (main.ts injects
// it via configureWocMarketRuntime); the admin surface, every other domain's
// guard bundle, ws_auth, and the legacy resolvers stay on the direct db.ts
// reads, and a wiring pin holds that boundary.
//
// SECURITY CONTRACT (this cache deliberately does NOT reuse the generic
// cached_read.ts factories, whose stale-serve-on-error would unbound the
// staleness during a DB brownout):
//  - RAW ROWS ONLY. The verdicts (token expiry + scope, the moderation
//    ban/suspension ladder) are computed per read by auth_guard_core, so a
//    cached suspension unlocks on time, a cached token refuses at its own
//    expires_at, and no verdict is ever frozen.
//  - NO negative caching. A null probe (unknown, expired, or revoked row)
//    installs nothing: an attacker spraying INVALID bearers pays the same DB
//    probe it pays today and can never become an LRU eviction lever over
//    real entries. (VALID tokens are a perf-only lever: an account minting
//    and using more than the token cap of real sessions evicts others'
//    entries, costing them a re-fetch, never a wrong answer; login is
//    turnstile-gated and rate-limited, and the caps are realm-sized.)
//  - NO stale-serve. A failed refresh propagates exactly like the direct
//    read's failure; nothing installs, and a warm-but-TTL-expired entry is
//    dropped, not served.
//  - Busts are immediate and keyed. Every writer that changes what these
//    reads return calls the matching free bust function below (the
//    discovery pin in tests/server/auth_guard_bust_coverage.test.ts holds
//    the site list complete); account-keyed busts drop the moderation row
//    AND every indexed token of the account, which is what makes
//    revokeCompanionToken's prefix-keyed delete safe without knowing the
//    full token value (over-busting only costs one re-fetch). An
//    account-keyed bust cannot cancel a token flight the index has never
//    seen, so that race is closed TWICE by content against the recent-bust
//    ledger: the install veto (nothing fetched before the bust installs)
//    and the join re-check (every JOINER of such a flight refetches; only
//    the flight creator can receive the one pre-bust answer).
//  - The ONE accepted staleness is cross-process: a revocation or ban
//    committed by ANOTHER realm process (process-per-realm shares one
//    database; accounts and auth_tokens are not realm-scoped) is invisible
//    here until the TTL lapses. WOC_AUTH_GUARD_CACHE_TTL_MS is that bound
//    and is sized short because of it.
//
// Recorded bounds and acceptances: raw bearer values live as map keys for up
// to the LRU lifetime (an idle entry is dropped on its next read or by
// eviction, not swept, so both arms hold their high-water mark, roughly
// 10 MB worst case, for the process lifetime: an accepted trade against
// sweep machinery), a heap-level exposure comparable to the auth_tokens
// table's own plaintext rows and the accepted trade for keyed busts. The
// flights map has no cap of its own: it holds one small entry per
// CONCURRENT in-flight probe (each self-clears at settle), so its size is
// the request concurrency the pool's own pending queue already absorbs,
// proportional overhead on an existing unbounded queue rather than a new
// failure mode. This module deliberately FORKS
// the generic cached_read.ts shapes rather than extending them with options:
// no-stale-serve, no-negative-caching, the content-keyed install veto, and
// the account index are security-load-bearing behavior, not configuration,
// and burying them in a shared factory's option matrix is how one gets
// quietly flipped; revisit only if a second consumer needs this exact
// contract.

import type {
  AccountModerationRow,
  AccountModerationStatus,
  AuthTokenRow,
  TokenScope,
} from './auth_guard_core';
import { computeModerationStatus, tokenInfoFromRow } from './auth_guard_core';

/**
 * The one staleness bound: an in-process refresh cadence AND the ceiling on
 * how long a revoked token or a fresh ban committed by ANOTHER process can
 * keep answering from this cache (same-process writes bust immediately).
 * 5 seconds. Measured against the real client cadences (the trade window
 * polls offers at 2s; the Exchange polls two GETs in parallel at 15s idle
 * and 3s awaiting-chain), the guard-read reduction is 3x for the trade
 * window, 2x for the idle Exchange (its 15s cadence exceeds the TTL, so
 * only the two parallel GETs collapse), and 4x for the awaiting chain;
 * raising the TTL to beat the idle cadence is exactly what the staleness
 * contract refuses.
 */
export const WOC_AUTH_GUARD_CACHE_TTL_MS = 5_000;
/** LRU bound on cached token rows, sized against the realm admission cap
 *  (MAX_PLAYERS_PER_REALM defaults to 5,000, the character_rank_cache sizing
 *  precedent) TIMES a small per-account token multiple (web + desktop +
 *  companion sessions), because LRU degrades as a CLIFF, not a slope: a
 *  working set past the cap evicts every entry before its own next poll and
 *  the guard load reverts to the uncached floor at exactly peak hours. Rows
 *  are three small fields, so the headroom costs single-digit MB. Eviction
 *  costs one re-fetch, never correctness; the stats on the stuck readout and
 *  the prometheus series make thrash visible. */
export const WOC_AUTH_GUARD_TOKEN_CACHE_MAX = 10_240;
/** LRU bound on cached moderation rows, keyed by account id: the realm
 *  admission cap with headroom (one row per account). */
export const WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX = 5_120;
/** The account-to-token index sweeps its eviction residue when it exceeds
 *  this multiple of the token cap (see the index note on the class). */
export const WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR = 4;
/** The recent-account-bust veto ledger's SOFT bound: past this size the
 *  prune drops entries older than the retention, then keeps dropping
 *  oldest-first down to the cap, but NEVER an entry younger than the
 *  min-age floor. The floor covers the WORST live-flight lifetime, the
 *  driver-side query backstop plus a pool checkout wait
 *  (DB_QUERY_TIMEOUT_MS 65s + DB_POOL_CONNECT_TIMEOUT_MS 5s, the
 *  black-holed-server case, not merely the 15s statement deadline), so
 *  only an entry older than the floor is provably vetoing no live flight;
 *  the relation is pinned in the unit suite against the exported db
 *  constants so a deadline raise reds instead of silently invalidating
 *  the floor. Under a bust burst across more distinct accounts than the
 *  cap inside the floor window the map can exceed the cap for up to the
 *  floor duration; entries are two numbers, so the excursion is bytes,
 *  and correctness is one-directional (a retained entry can only
 *  over-decline an install). */
export const WOC_AUTH_GUARD_RECENT_BUSTS_MAX = 512;
export const WOC_AUTH_GUARD_RECENT_BUST_RETENTION_MS = 90_000;
// 65s + 5s (the derived flight bound) plus event-loop headroom: the veto is
// consulted a scheduling delay after the query settles, so the floor carries
// an explicit margin rather than equality with the driver deadlines (10s
// chosen; the unit pin enforces at least 5s, so the enforced floor is 75s).
export const WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS = 80_000;

/** The two raw-row readers (server/db.ts authTokenRowForToken and
 *  moderationRowForAccount in production; fakes in tests). Contract: each
 *  call returns a FRESHLY-OWNED row (never a shared/pooled object), because
 *  the cache freezes installed rows in place. */
export interface WocAuthGuardReaders {
  fetchTokenRow(token: string): Promise<AuthTokenRow | null>;
  fetchModerationRow(accountId: number): Promise<AccountModerationRow | null>;
}

export interface WocAuthGuardCacheOptions {
  /** Injected clock for tests; production callers omit it (Date.now). */
  now?: () => number;
  /** Test-only bound overrides; production callers omit them. */
  ttlMs?: number;
  tokenMaxEntries?: number;
  accountMaxEntries?: number;
}

/** Per-arm counters, the WocMarketReadCache stats shape, for the stuck
 *  readout: eviction thrash or a bust storm is a DB-load incident forming. */
export interface WocAuthGuardArmStats {
  reads: number;
  refreshes: number;
  evictions: number;
  busts: number;
  entries: number;
}

export interface WocAuthGuardCacheStats {
  tokens: WocAuthGuardArmStats;
  accounts: WocAuthGuardArmStats;
  /** Live size of the account-to-token index, eviction residue included: the
   *  soft bound (token cap times the sweep factor) is a claim, and this is
   *  the number that makes it observable in production, not only in tests. */
  index: number;
  /** Live size of the recent-bust veto ledger: soft-bounded BY DESIGN (the
   *  cap can be exceeded for up to the min-age floor under a bust burst), so
   *  an excursion must be a number an operator can see. */
  recentBusts: number;
  /** How many joiner reads the join re-check sent back for a fresh fetch:
   *  separates veto-driven refetches from ordinary misses in the
   *  reads/refreshes pair during a bust storm. */
  joinVetoRefetches: number;
}

// A refresh in flight for one key. `cancelled` is the lost-bust guard: a bust
// landing mid-refresh flips it, so the flight declines its install and a
// post-bust reader refuses to join it (starting a fresh flight) rather than
// receive pre-bust data. An ACCOUNT-keyed bust cannot flip `cancelled` on a
// flight for a not-yet-indexed token, so that arm is closed twice over by
// content: the install veto (installGuard) and the join re-check (joinGuard),
// both keyed by the fetched row's account against the recent-bust ledger.
interface Flight<V> {
  promise: Promise<V | null>;
  cancelled: boolean;
  /** When the fetch began; the content-keyed guards compare bust times
   *  against it, and installs anchor the entry TTL here so the documented
   *  staleness ceiling is exact (TTL from fetch START, not settle). */
  startedAtMs: number;
}

// One arm: a bounded LRU of raw rows with TTL, per-key single-flight, no
// negative caching, no stale-serve. Private to this module on purpose (the
// generic cache seam is cached_read.ts; this shape exists for the auth
// contract above and gets extracted only if a second consumer appears).
class RowArm<K, V> {
  private readonly entries = new Map<K, { at: number; row: V }>();
  private readonly flights = new Map<K, Flight<V>>();
  private readCount = 0;
  private refreshCount = 0;
  private evictionCount = 0;
  private bustCount = 0;

  constructor(
    private readonly fetch: (key: K) => Promise<V | null>,
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number,
    /** Called when a fresh row installs (the token arm indexes by account). */
    private readonly onInstall?: (key: K, row: V) => void,
    /** Veto an install from the row's CONTENT and the flight's start time:
     *  the token arm declines a row whose account was bust AFTER the fetch
     *  began (an account-keyed bust cannot cancel a flight the index has
     *  never seen, so the veto closes the install half of the lost-bust
     *  race). */
    private readonly installGuard?: (row: V, startedAtMs: number) => boolean,
    /** The JOIN half of the same account-keyed race: a JOINER must not
     *  accept a row when ANY bust of its group landed at or after the
     *  flight's start (returning false makes it refetch). Deliberately the
     *  same condition as the install veto, and deliberately NOT compared
     *  against the joiner's own arrival time: the ledger keeps only the
     *  LAST bust per account, so a second bust arriving after the joiner
     *  would overwrite and HIDE the one that vetoed it (found live by the
     *  fix-round review). Only the flight CREATOR keeps the recorded
     *  once-per-flight stale answer. */
    private readonly joinGuard?: (row: V, flightStartedAtMs: number) => boolean,
  ) {}

  read(key: K): Promise<V | null> {
    this.readCount += 1;
    const entry = this.entries.get(key);
    if (entry !== undefined) {
      if (this.now() - entry.at < this.ttlMs) {
        // LRU touch: a Map iterates in insertion order, so re-inserting on
        // every sighting keeps the first key the coldest.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return Promise.resolve(entry.row);
      }
      // Past TTL: the entry may never serve again (no stale-serve), so it is
      // dead weight either way; drop it before refreshing.
      this.entries.delete(key);
    }
    const standing = this.flights.get(key);
    if (standing !== undefined && !standing.cancelled) {
      return standing.promise.then((row) =>
        row !== null && this.joinGuard?.(row, standing.startedAtMs) === false
          ? // The row's group was bust since the flight began: re-read (the
            // flight has settled and cleared, so this starts a fresh fetch,
            // whose own start postdates the bust, or joins one another
            // vetoed joiner already started; the re-read counts as a fresh
            // read in the stats by design).
            this.read(key)
          : row,
      );
    }
    const startedAtMs = this.now();
    const flight: Flight<V> = { cancelled: false, promise: Promise.resolve(null), startedAtMs };
    flight.promise = this.fetch(key)
      .then((row) => {
        // Install only positive rows (no negative caching), only when no
        // bust landed mid-flight (the lost-bust epoch rule), and only when
        // the row's content passes the veto (the account-keyed half of the
        // same rule; see installGuard on the constructor).
        if (row !== null && !flight.cancelled && this.installGuard?.(row, startedAtMs) !== false) {
          this.install(key, row, startedAtMs);
        }
        return row;
      })
      .finally(() => {
        // Settled (fulfilled or rejected): clear only our own registration; a
        // post-bust flight may already have replaced this one.
        if (this.flights.get(key) === flight) this.flights.delete(key);
      });
    this.refreshCount += 1;
    this.flights.set(key, flight);
    return flight.promise;
  }

  private install(key: K, row: V, startedAtMs: number): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const coldest = this.entries.keys().next();
      if (!coldest.done) {
        this.entries.delete(coldest.value);
        this.evictionCount += 1;
      }
    }
    this.entries.delete(key);
    // The TTL anchors at the fetch START, not the install: the row's data is
    // as-of a snapshot no later than the start, so anchoring here keeps the
    // documented staleness ceiling exact instead of ceiling-plus-fetch-RTT.
    // (One recorded regime: a fetch slower than the TTL installs an
    // already-expired entry, so cross-time reuse stops during a DB brownout;
    // single-flight still collapses concurrent readers.) Rows are frozen one
    // level deep (the freezeShared precedent) so no consumer can decorate a
    // shared row or a nested object in place and poison every other reader
    // of the key; a frozen Date's setTime remains callable (internal slot,
    // not a property), the precedent's same recorded limit.
    for (const value of Object.values(row as object)) {
      if (typeof value === 'object' && value !== null) Object.freeze(value);
    }
    Object.freeze(row);
    this.entries.set(key, { at: startedAtMs, row });
    this.onInstall?.(key, row);
  }

  bust(key: K): void {
    if (this.entries.delete(key)) this.bustCount += 1;
    const flight = this.flights.get(key);
    if (flight !== undefined) flight.cancelled = true;
  }

  bustAll(): void {
    this.bustCount += this.entries.size;
    this.entries.clear();
    for (const flight of this.flights.values()) flight.cancelled = true;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  stats(): WocAuthGuardArmStats {
    return {
      reads: this.readCount,
      refreshes: this.refreshCount,
      evictions: this.evictionCount,
      busts: this.bustCount,
      entries: this.entries.size,
    };
  }
}

/**
 * The cached guard bundle. Structurally a BearerActiveGuardDb, so
 * createReadGuard/createActiveGuard consume it unchanged through the routes'
 * lazy thunk; the test-override seam (setWocMarketGuardDbForTests) keeps
 * absolute precedence over it.
 */
export class WocAuthGuardCache {
  private readonly tokenArm: RowArm<string, AuthTokenRow>;
  private readonly accountArm: RowArm<number, AccountModerationRow>;
  // Which cached tokens belong to which account, so account-keyed busts
  // (revocation sweeps, prefix deletes, moderation writes have no need) can
  // drop every token entry of the account. Entries evicted by the LRU leave
  // residue here (over-busting is safe); the sweep below bounds it.
  private readonly tokensByAccount = new Map<number, Set<string>>();
  private indexSize = 0;
  // When each account was last account-keyed-bust, for the install veto and
  // the join re-check: a token fetch IN FLIGHT at bust time is invisible to
  // the index (nothing is indexed until install), so a revocation sweep
  // could otherwise be outrun by an install of the pre-delete row, and a
  // reader arriving after the bust could join the stale flight. Entries
  // prune amortized; no flight outlives the fetch deadline, so an aged
  // entry can veto nothing real.
  private readonly recentAccountBusts = new Map<number, number>();
  // The prune runs at most once per window while wedged over the cap: a
  // failed pass records the earliest instant any surviving entry can cross
  // the min-age floor, and busts before that instant skip the walk (else a
  // realm-wide bust fan-out pays a full-map walk PER BUST, a measured ~70ms
  // synchronous stall at the 5,000-account realm cap).
  private nextPruneAtMs = 0;
  private prunePasses = 0;
  private joinVetoRefetchCount = 0;
  private readonly now: () => number;
  private readonly tokenMax: number;

  constructor(
    private readonly readers: WocAuthGuardReaders,
    opts: WocAuthGuardCacheOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    const ttl = opts.ttlMs ?? WOC_AUTH_GUARD_CACHE_TTL_MS;
    this.tokenMax = opts.tokenMaxEntries ?? WOC_AUTH_GUARD_TOKEN_CACHE_MAX;
    this.tokenArm = new RowArm(
      (token) => this.readers.fetchTokenRow(token),
      ttl,
      this.tokenMax,
      this.now,
      (token, row) => this.indexToken(token, row.accountId),
      (row, startedAtMs) => (this.recentAccountBusts.get(row.accountId) ?? -1) < startedAtMs,
      (row, flightStartedAtMs) => {
        // Any bust of the row's account at or after the flight's start makes
        // every JOINER refetch (the join half of the index-blind race). The
        // same condition as the install veto, on purpose, and NOT narrowed
        // by the joiner's arrival time: the ledger keeps only the LAST bust
        // per account, so a later same-account bust would overwrite and
        // hide the one that vetoed the joiner. Stricter than the recorded
        // once-per-flight acceptance (which now covers the flight CREATOR
        // only); the cost is one extra fetch per joiner under a bust,
        // counted below so a bust storm's refetches are separable from
        // ordinary misses in the readout.
        const fresh = (this.recentAccountBusts.get(row.accountId) ?? -1) < flightStartedAtMs;
        if (!fresh) this.joinVetoRefetchCount += 1;
        return fresh;
      },
    );
    this.accountArm = new RowArm(
      (accountId) => this.readers.fetchModerationRow(accountId),
      ttl,
      opts.accountMaxEntries ?? WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX,
      this.now,
    );
  }

  async accountAndScopeForToken(
    token: string,
  ): Promise<{ accountId: number; scope: TokenScope } | null> {
    const row = await this.tokenArm.read(token);
    const info = tokenInfoFromRow(row, this.now());
    // A cached row the clock has carried past its expires_at is dead: drop it
    // so the entry cannot linger as a hit source for the rest of its TTL.
    // (Rides bust(), so natural expiry counts into the busts stat: that
    // series is "entries invalidated", not "writer busts" alone.)
    if (row !== null && info === null) this.tokenArm.bust(token);
    return info;
  }

  async moderationStatusForAccount(accountId: number): Promise<AccountModerationStatus> {
    const row = await this.accountArm.read(accountId);
    return computeModerationStatus(row, this.now());
  }

  /** Drop one token's cached row (a token-keyed revocation). */
  bustToken(token: string): void {
    this.tokenArm.bust(token);
  }

  /** Drop the account's moderation row AND every indexed token of the
   *  account (account-keyed revocations and every moderation write). */
  bustAccount(accountId: number): void {
    // Recorded BEFORE the keyed drops so a token fetch racing this bust is
    // vetoed at install whatever interleaving the event loop deals.
    this.recentAccountBusts.set(accountId, this.now());
    if (this.recentAccountBusts.size > WOC_AUTH_GUARD_RECENT_BUSTS_MAX) {
      const nowMs = this.now();
      // Amortization gate: while wedged over the cap inside the floor window
      // (a realm-wide bust fan-out), a walk that can drop nothing is skipped
      // until the earliest instant the last failed pass proved an entry can
      // cross the floor. Skipping only DELAYS pruning of an already-soft
      // bound; every actual drop below stays floor-checked.
      if (nowMs >= this.nextPruneAtMs) {
        this.prunePasses += 1;
        const staleCutoff = nowMs - WOC_AUTH_GUARD_RECENT_BUST_RETENTION_MS;
        let oldestAtMs = Number.POSITIVE_INFINITY;
        for (const [account, atMs] of this.recentAccountBusts) {
          if (atMs < staleCutoff) this.recentAccountBusts.delete(account);
          else if (atMs < oldestAtMs) oldestAtMs = atMs;
        }
        // Still above the cap after the retention pass (a bust burst): drop
        // oldest-first down to the cap, but never an entry younger than the
        // min-age floor, which no live flight can predate (see the constant).
        const floorCutoff = nowMs - WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS;
        for (const [account, atMs] of this.recentAccountBusts) {
          if (this.recentAccountBusts.size <= WOC_AUTH_GUARD_RECENT_BUSTS_MAX) break;
          if (atMs < floorCutoff) this.recentAccountBusts.delete(account);
        }
        this.nextPruneAtMs =
          this.recentAccountBusts.size > WOC_AUTH_GUARD_RECENT_BUSTS_MAX
            ? oldestAtMs + WOC_AUTH_GUARD_RECENT_BUST_MIN_AGE_MS
            : 0;
      }
    }
    this.accountArm.bust(accountId);
    const tokens = this.tokensByAccount.get(accountId);
    if (tokens !== undefined) {
      for (const token of tokens) this.tokenArm.bust(token);
      this.indexSize -= tokens.size;
      this.tokensByAccount.delete(accountId);
    }
  }

  bustAll(): void {
    this.tokenArm.bustAll();
    this.accountArm.bustAll();
    this.tokensByAccount.clear();
    this.recentAccountBusts.clear();
    this.indexSize = 0;
    this.nextPruneAtMs = 0;
  }

  stats(): WocAuthGuardCacheStats {
    return {
      tokens: this.tokenArm.stats(),
      accounts: this.accountArm.stats(),
      index: this.indexSize,
      recentBusts: this.recentAccountBusts.size,
      joinVetoRefetches: this.joinVetoRefetchCount,
    };
  }

  /** How many times the ledger prune actually walked the map (test-only: the
   *  amortization gate's one observable; a realm-wide bust fan-out must pay
   *  ONE walk, not one per bust). */
  prunePassesForTests(): number {
    return this.prunePasses;
  }

  private indexToken(token: string, accountId: number): void {
    let set = this.tokensByAccount.get(accountId);
    if (set === undefined) {
      set = new Set();
      this.tokensByAccount.set(accountId, set);
    }
    if (!set.has(token)) {
      set.add(token);
      this.indexSize += 1;
    }
    // Amortized residue sweep: entries the LRU evicted stay indexed until the
    // index outgrows its bound, then every no-longer-cached token drops. The
    // index can only grow via installs, so the sweep runs rarely.
    if (this.indexSize > this.tokenMax * WOC_AUTH_GUARD_INDEX_SWEEP_FACTOR) {
      for (const [account, tokens] of this.tokensByAccount) {
        for (const t of tokens) {
          if (!this.tokenArm.has(t)) {
            tokens.delete(t);
            this.indexSize -= 1;
          }
        }
        if (tokens.size === 0) this.tokensByAccount.delete(account);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The process singleton and its free bust functions. The writer chokepoints
// (server/db.ts token writers, the moderation writers) import and call the
// busts directly, the discord_status_cache shape; they are no-ops until
// main.ts configures the singleton at boot and again after it is cleared at
// shutdown, so no rig or test pays for wiring it never asked for.
// ---------------------------------------------------------------------------

let active: WocAuthGuardCache | null = null;

/** Build (or replace) the process singleton over the real row readers.
 *  Called once at boot by main.ts; pass null-ish via reset on shutdown. */
export function configureWocAuthGuardCache(
  readers: WocAuthGuardReaders,
  opts: WocAuthGuardCacheOptions = {},
): WocAuthGuardCache {
  active = new WocAuthGuardCache(readers, opts);
  return active;
}

/** The live singleton, or null before boot wiring (callers fall back to the
 *  direct db reads). */
export function wocAuthGuardDb(): WocAuthGuardCache | null {
  return active;
}

/** Clear the singleton (shutdown or test teardown) so busts never pin a dead
 *  instance, mirroring registerWocMarketReadCacheForBusts(null). */
export function resetWocAuthGuardCache(): void {
  active = null;
}

/** Token-keyed bust: the writer knows the exact token value. */
export function bustWocAuthGuardToken(token: string): void {
  active?.bustToken(token);
}

/** Account-keyed bust: revocation sweeps, the prefix-keyed companion delete,
 *  and EVERY write that changes the account's moderation projection. */
export function bustWocAuthGuardAccount(accountId: number): void {
  active?.bustAccount(accountId);
}

/** Flush everything; the singleton stays armed so writers keep busting.
 *  No production site calls this yet (main.ts flushes through the instance
 *  it holds at shutdown): it exists as the operator/test lever the spec
 *  named, exercised by the unit suite so it cannot rot unrun. */
export function bustWocAuthGuardAll(): void {
  active?.bustAll();
}

/** Stats for the stuck readout; null before boot wiring. */
export function wocAuthGuardCacheStats(): WocAuthGuardCacheStats | null {
  return active?.stats() ?? null;
}
