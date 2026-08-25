# Rider: per-request auth-guard read cache

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.40.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the rider spec. It is a packet phase in all but
number: implement session then its dedicated QA session
(`rider-auth-guard-reads-qa.md`), LOCAL per R4 until the QA pushes on PASS.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch
  `feature/woc-marketplace`.
- Closes: the per-request auth-guard-read cluster (the 16 QA deferral, decided
  into this dedicated rider at the 17 session start). Owed AFTER the escrow
  write-path rider (done, QA PASS) and BEFORE
  `phase-21-devnet-dry-run.md`, so 21's devnet contention run measures the
  shipped shapes.
- Standards bar: round 20. Every money or security predicate this rider adds or
  moves gets a real-SQL pin whose mutant is strip-proven and logged (append a
  rider section to `phase-20-mutation-log.md`, same protocol header rules:
  occurrence-asserted strips, diff-proven, run-proven with the Tests summary
  line, checkout-reverted byte-identical, lanes partitioned by suite). Every
  WHERE clause gets a violating fixture per qual dimension (the symmetric
  fixture trap). Tunable-boundary fixtures derive from the constant, proven
  with a green constant-bump control. Re-run a pin's mutant after any later
  edit to the pinning test. This is SECURITY-SENSITIVE CACHING: a
  correctness-for-efficiency trade is never acceptable here; the ONLY accepted
  staleness is the recorded cross-process TTL bound below.

## The cluster, verbatim from the registries

The 16 QA deferral (progress.md, "DEFERRED with owners"):

> the per-request auth-guard reads (requireAccount's two uncached queries per
> request now dominate every metered marketplace GET's cost; the
> highest-leverage remaining server win) join the escrow WRITE-path cluster in
> the rider decision at the 17 session start

The 17 SESSION START DECISION (state.md, the binding scope and design
constraints):

> (2) The per-request auth-guard-read cluster ALSO goes to a dedicated rider
> before 22, SEPARATE from the escrow rider: it is security-sensitive caching,
> not retention/index work (a token cache extends a revoked token's life by up
> to its TTL, including the ADMIN bearer, since require_admin resolves through
> the same db.accountAndScopeForToken; a moderation cache delays cross-process
> bans by the TTL; moderationStatusForAccount computes locked/suspendedUntil
> with Date.now at read time, so the ROW, not the computed result, must be
> cached), with roughly 20 bust sites across 6+ files and its own reviewer set
> (privacy-security + server-hot-path). It is NOT an enable blocker: both
> guard reads are indexed point reads (auth_tokens token probe, accounts id PK
> + one LEFT JOIN) already behind the 240/min read limiter; the win is
> efficiency, not safety, so deferring past 17 costs nothing at enable time.
> [...] Design constraints recorded for the auth rider: consider scoping the
> cache to the marketplace guardDbBundle seam (woc_market_routes.ts) so the
> admin surface stays uncached; cache raw rows and re-check expires_at at read
> time (the SQL bakes expires_at > now() into the probe, so a result cache
> extends token life); the account-keyed bust design must handle
> revokeCompanionToken's prefix-keyed delete; recon detail in the 17 implement
> entry of progress.md.

## Findings context (recon 2026-08-20 against the tree at f844a72eaa)

Corrections and confirmations against the registry phrasing, so this spec does
not inherit stale premises (three read-path lanes, a bust-surface lane, a
cache-idiom lane, plus main-thread probes):

- CORRECTION, the limiter premise is backwards: the guard reads are NOT
  "behind the 240/min read limiter". Every marketplace route mounts
  `middleware: [readAccount|activeAccount, rateLimit(...)]` with the guard
  FIRST, because the limiter keys on the resolved account
  (woc_market_routes.ts route table). The two guard queries therefore run per
  REQUEST, before any 429, and are the unmetered per-request floor. This
  strengthens the efficiency case and changes nothing about safety.
- CONFIRMED: `accountAndScopeForToken` (server/db.ts) bakes
  `expires_at > now()` into the probe and does NOT select `expires_at`; the
  cached arm needs the row's expiry, so the shared fetch adds `expires_at` to
  the SELECT (the DB-side qual stays as belt; the cache re-checks at read
  time). No `UPDATE auth_tokens` exists anywhere in server/ (no sliding
  expiry, no last-used stamp), and NO caller anywhere distinguishes an expired
  token from a deleted one: every consumer branches on null only. A cache
  that answers null for an expired-at-read-time row is therefore semantically
  exact.
- CONFIRMED: `moderationStatusForAccount` (server/db.ts) computes locked,
  suspendedUntil, chatMutedUntil, and the suspension `message` prose from the
  row against `Date.now()` at read time; the ROW is the only cacheable value.
  The compute is roughly 80 lines of pure logic inline in db.ts today.
- CORRECTION, the admin premise is already structurally satisfied at the
  marketplace seam: the marketplace admin routes resolve through
  `createRequireAdmin((): AdminAuthDb => adminDb())` (woc_market_routes.ts),
  a SEPARATE bundle from guardDbBundle, and `AdminAuthDb` carries NO
  moderation read at all (staff is trusted operator authority,
  require_admin.ts header). Scoping the cache to guardDbBundle leaves every
  admin path uncached by construction; the rider's job is to PIN that, not to
  build it.
- The guardDbBundle seam is not marketplace-unique: maps_routes.ts and
  user_assets_routes.ts hold their own copies of the same
  REAL_GUARD_DB/setXForTests pattern, and roughly a dozen other domains carry
  per-domain guard bundles or hand-rolled copies (wallet, characters, account,
  reports, daily_rewards, github, discord, claudium, desktop_login,
  seeker_entitlement) plus the legacy main.ts resolvers (dead under the
  default API_DISPATCH=new), ws_auth (one read pair per WebSocket handshake,
  never per message), and the problem+json requireAccount consumers (deeds,
  steam, epic, leaderboard). Every one of those surfaces is RARE-flow or
  once-per-connection; the ONE hot non-market read is GET /api/discord (45s
  client poll). This rider caches ONLY the marketplace bundle; everything
  else stays direct and is out of scope.
- The route table puts one HOT metered GET on the ACTIVE guard:
  GET /api/woc-market/offers rides `activeAccount` with the shared read
  policy (full scope required by design). Scoping the cache to the READ guard
  only would carve that hot surface out of the win, so the cache covers the
  BUNDLE (both guards), exactly as the 17 constraint records. The mutation
  guards' staleness is the same accepted TTL bound; same-process moderation
  and revocation writes bust immediately.
- The bust surface, counted by discovery: SIX auth_tokens writer functions,
  ALL in server/db.ts (saveToken INSERT; revokeTokensExcept; revokeToken;
  revokeReadToken; revokeCompanionToken, prefix-keyed but the call site knows
  accountId; consumePasswordResetRequest's in-transaction account-wide
  DELETE). Moderation-projection writers: moderateAccount's four statement
  arms in ONE transactional chokepoint plus muteAccountChat, clearChatMute,
  reactivateAccount, and the strike clear in server/moderation_db.ts;
  applyChatStrike and the strike reset in server/chat_filter_db.ts;
  setAccountDeactivated in server/db.ts; the rate-limit policy DELETE and
  INSERT..ON CONFLICT in server/general_chat_quota_db.ts. Roughly 18
  statements in 16 functions across FIVE files (the registry's "roughly 20
  across 6+ files" was close; the correction is recorded here).
- The general-chat quota CONSUME writes (the stored procedure DDL in
  general_chat_quota_schema.ts: window_started_at and message_count churn per
  admitted chat message) touch NO column the guard read projects (it reads
  only the messages and window_minutes policy columns), so they are
  structurally exempt; a COLUMN-precise discovery scan classifies them out
  without a hand exemption. The one hard `DELETE FROM accounts`
  (federated_auth_db.ts, the provision-race loser) deletes only fresh unused
  accounts that cannot hold live tokens or moderation state: the one
  reasoned, exact-count exemption.
- Post-commit discipline exists and must be followed: moderation_db.ts fires
  its hooks (setOnAccountModerated, setOnModerationQueueChanged) AFTER COMMIT,
  outside every transaction path, error-swallowed, precisely so a bust
  failure never fails a moderation action and a pre-commit bust cannot be
  repopulated with pre-commit state by a concurrent read.
  consumePasswordResetRequest's bustDiscordStatus does the same. The rider's
  bust calls follow the identical placement. The existing hooks take no
  accountId, so the rider wires DIRECT keyed bust calls at the writers (the
  codebase's dominant pattern: discord_status_cache, admin_guilds_read,
  guild_bank_log), not the argless hooks.
- The dependency shape that avoids every cycle exists as an idiom twice
  already (character_rank_cache.ts, discord_status_cache.ts): db.ts injects
  the raw readers into the cache module at module load
  (configure<X>(readers)), the cache module imports nothing from db.ts, and
  writer modules import the cache's free bust functions directly. The
  configure call also resets the lazy instance so no clock binds before a
  test can inject one (the captured-clock trap).
- The existing generic caches CANNOT be reused as-is: createCachedRead and
  KeyedCachedRead (server/cached_read.ts) STALE-SERVE on refresh failure by
  design. On an auth read that would serve a token or an unlocked status past
  the accepted TTL bound for the whole length of a DB brownout, unbounded.
  The auth cache must propagate refresh failure exactly like the direct read
  does (the guard 500s; nothing is installed). It also must NOT cache
  negative token probes (an attacker spraying random bearers must cost the DB
  probe it costs today, never become an LRU eviction lever over real
  entries: the browse deep-pages lesson), and it needs an account-to-tokens
  index for the account-keyed busts. New module, own tests; the lost-bust
  epoch discipline is carried over from cached_read.ts by construction.
- Multi-process is REAL, not hypothetical: process-per-realm against one
  DATABASE_URL is the documented production scaling mode (DEPLOY.md "Realms
  (horizontal scaling)"; scripts/dev-realms.mjs), and accounts/auth_tokens
  are account-wide, not realm-scoped. A ban or revocation committed by
  another realm process is invisible to this process's cache until the TTL
  lapses: that is the ONE accepted staleness, recorded at 17, and the TTL is
  sized short because of it. The repo already uses LISTEN/NOTIFY for
  cross-process invalidation once (general_chat_quota_db.ts); a NOTIFY bust
  channel is the recorded option if 22's pre-enable audit wants the bound
  closed, not this rider's scope.
- Existing per-request call-count pins are OUT of the marketplace scope:
  tests/server/claudium.test.ts pins exactly-one-guard-read-per-request
  through the CLAUDIUM bundle (uncached), and the woc_market routes suites
  call handlers directly, bypassing middleware; the one full-chain
  marketplace-guard consumer (tests/server/http/ownership_coverage.test.ts)
  installs fakes via setWocMarketGuardDbForTests, which keeps absolute
  precedence over the cache. No existing pin breaks.
- Monolith posture: server/woc_market.ts sits at EXACTLY 4036 with zero
  headroom and server/game.ts at exactly 10813: do not touch either.
  server/db.ts is ratcheted at 4980 (currently 4876) and this rider moves it
  DOWN (the compute extraction outweighs the fetch splits and one-line bust
  calls). server/woc_market_db.ts (4783) still has NO ratchet row (the open
  maintainer question, carried); this rider does not touch it.
  woc_market_routes.ts (1365) and main.ts wiring growth is small and
  unratcheted; new logic lands in the new sibling modules.

## Deliverables

Ordering: 1 and 2 land first (the pure core and the fetch split are what
everything else consumes); 3 to 5 may interleave; 6 and 7 land with their
subjects in the same commit series.

1. **The pure auth-guard core.** A NEW sibling module `server/auth_guard_core.ts`
   owning the pure halves of both guard reads, extracted from db.ts
   (move-not-rewrite):
   - The row types: `AuthTokenRow` (accountId, scope, expiresAtMs) and
     `AccountModerationRow` (banned_at, suspended_until, moderation_reason,
     chat_muted_until, chat_strikes, deactivated_at, messages,
     window_minutes, nullable exactly as the SQL returns them), plus the
     moved `AccountModerationStatus` and `GeneralChatRateLimit` declarations,
     re-exported from db.ts so the twenty-plus importers compile unchanged.
   - `tokenInfoFromRow(row, nowMs)`: the fail-closed scope allowlist (full,
     read, everything else null: the exact db.ts branch) plus the
     read-time `expiresAtMs > nowMs` check.
   - `computeModerationStatus(row, nowMs)`: the exact db.ts precedence ladder
     (banned outranks suspension outranks deactivation; chatMutedUntil
     compared at read time; the suspension `message` prose built from the
     row), byte-identical output strings.
   db.ts keeps the SQL as two exported row fetchers (`authTokenRowForToken`,
   selecting account_id, scope, expires_at with the `expires_at > now()`
   qual kept as belt; `moderationRowForAccount`, the existing SELECT plus
   LEFT JOIN) and re-implements the two public functions as fetch + pure
   compute. A parity sweep pins the direct path byte-equal to the old
   behavior across the full matrix (live full, live read, unknown scope,
   missing row, banned, suspended future, suspended past, deactivated,
   muted, policy row present and absent). The S3 guard and the moderation
   message strings stay byte-identical.

2. **The cache module.** A NEW sibling module `server/woc_auth_guard_cache.ts`
   (the marketplace-scoped consumer of the core), the discord_status_cache
   configure-reader shape:
   - `configureWocAuthGuardReaders({ fetchTokenRow, fetchModerationRow })`,
     called by db.ts at module load; the call resets the lazy instance so no
     clock or reader binds before a test overrides it.
   - `wocAuthGuardDb(): BearerActiveGuardDb`: the cached bundle. Token arm:
     keyed by the 64-hex token value, caches ONLY positive rows (a null
     probe is returned uncached), re-checks `expiresAtMs` on every hit
     through `tokenInfoFromRow`, and maintains the account-to-tokens index.
     Moderation arm: keyed by accountId, caches the RAW ROW only (absent
     rows uncached), computes the status per read through
     `computeModerationStatus(row, Date.now())` so a lapsing suspension
     unlocks ON TIME from a cached row. Both arms: TTL, LRU cap with counted
     eviction, per-key single-flight, the lost-bust epoch discipline (a bust
     landing mid-refresh declines the install and post-bust readers refuse
     the stale flight), and NO stale-serve (a failed refresh propagates;
     nothing installs).
   - Busts: `bustWocAuthGuardToken(token)` (drops the one token entry),
     `bustWocAuthGuardAccount(accountId)` (drops the moderation row AND every
     indexed token of the account: over-busting is the safe direction and is
     what makes revokeCompanionToken's prefix-keyed delete correct without
     knowing the full token), `bustWocAuthGuardAll()` (ops/test). All
     non-throwing.
   - Constants, code not env: `WOC_AUTH_GUARD_CACHE_TTL_MS = 5_000` (the
     docblock states the two bounds it IS: the cross-process revocation and
     ban delay ceiling, and the in-process refresh cadence; scrape-pinned so
     the prose cannot drift from the constant),
     `WOC_AUTH_GUARD_TOKEN_CACHE_MAX = 1_024`,
     `WOC_AUTH_GUARD_ACCOUNT_CACHE_MAX = 1_024` (LRU bounds far above a
     realm's concurrent accounts; eviction costs one re-fetch, never
     correctness). At-cap fixtures derive from the constants with a green
     constant-bump control.
   - `wocAuthGuardCacheStats()`: reads, hits, misses, refreshes, evictions,
     busts, entries per arm, for the stuck readout.

3. **The bust wiring at every discovered writer.** Direct keyed calls to the
   two bust functions from every writer whose statement touches the cached
   projection, placed AFTER COMMIT for the transactional writers
   (moderateAccount, muteAccountChat and siblings, consumePasswordResetRequest,
   the quota policy setter) and immediately after the await for the
   auto-commit ones. Token writers call the token- or account-keyed bust with
   the key the site holds (saveToken included: a fresh random token can have
   no cached entry, but the INSERT site notifies anyway so the discovery pin
   carries ZERO auth_tokens exemptions). Moderation-projection writers call
   `bustWocAuthGuardAccount`. The federated provision-race `DELETE FROM
   accounts` is the one pinned, reasoned exemption (exact count 1).

4. **The marketplace wiring, and only the marketplace.** woc_market_routes.ts
   consumes the cached bundle for BOTH guards through the existing lazy
   thunk: precedence is the test override (setWocMarketGuardDbForTests,
   unchanged contract) over the cached bundle over REAL_GUARD_DB. The admin
   gate keeps resolving through adminDb(); maps_routes, user_assets_routes,
   and every other guard consumer keep their direct bundles untouched.
   main.ts adds the `authGuard: wocAuthGuardCacheStats()` field to the stuck
   readout merge literal (toContain-pinned in the hot-reads suite beside its
   siblings).

5. **The pins (where the QA will spend its time; build them as the work
   lands, not after):**
   - Revocation end to end on EVERY cached arm: a warm token entry refuses on
     the next read after each writer-driven bust (token-keyed, account-keyed,
     prefix over-bust, the password-reset account-wide delete), with the
     fetch-call evidence that the refusal came from a re-probe, not the
     entry.
   - Read-time expiry: a cached row whose expires_at passes refuses at
     expiry, not at TTL lapse.
   - Row-not-result, both directions: a cached suspension row flips locked to
     unlocked as the fake clock crosses suspended_until with NO refetch; a
     cached ban row stays locked at any clock.
   - The admin surface UNCACHED by pin, both halves: a wiring pin (the cache
     module is imported by woc_market_routes.ts, db.ts, main.ts, and the
     writer modules ONLY; require_admin/admin.ts never touch it) and a
     behavioral contrast through the real middleware chain (flip the
     underlying token answer to revoked with a warm cache: the admin gate
     refuses on the very next request while the player GET still answers
     until bust or TTL).
   - Bust-site completeness by DISCOVERY, never a hand list: a
     comment-stripped scan over server/ (reuse the escrow routing pin's
     machinery and its hoisted-SQL lesson) finds every statement writing
     auth_tokens, every `UPDATE accounts` naming a projection column, every
     account_general_chat_rate_limits policy write, and every
     `DELETE FROM accounts`; asserts the enclosing function calls the
     matching bust; classifies the quota-consume stored procedure OUT by
     column; pins the exact site count with a non-vacuity floor and the one
     DELETE exemption at exact count 1.
   - Cache mechanics: no negative caching (a null probe installs nothing and
     costs a fresh fetch each time), no stale-serve (a failing refresh with a
     warm-but-expired entry rejects), single-flight (two concurrent reads,
     one fetch), the lost-bust epoch race, LRU eviction at the derived cap,
     the account index surviving eviction residue (over-bust safe).
   - The parity sweep from deliverable 1, plus the guard middlewares over the
     cached bundle answering byte-identical bodies (401/403/moderation
     codes) to the direct bundle for every matrix row.
   - Real SQL, a NEW eighth pg suite
     `tests/woc_market_authguard_pg_integration.test.ts` (fixed database
     `wocc_woc_market_authguard_verify`, the stepup suite's boot pattern):
     the token probe qual against real rows (live, expired, deleted), the
     cached bundle refusing after each REAL db.ts revocation writer runs
     (the notifier fired by the real function, not a test double), the
     moderation row round-trip through real timestamptz values (ban,
     suspend, mute, policy row), and the post-COMMIT bust placement proven
     against the committed row. Run it one lane at a time with
     TEST_DATABASE_URL on the command line only; confirm with the gate
     dry-selection probe that the suite self-selects into the always-run
     floor like its seven siblings.
   - Mutation log: a rider section in phase-20-mutation-log.md at the 20
     protocol for every pin above whose predicate is money or security
     (the expiry re-check, the scope allowlist, the bust completeness scan,
     the admin wiring pin, the row-not-result computes, the pg quals).

6. **Docs.** server/CLAUDE.md gains the cache module, the bust rule ("any
   write that changes what the two guard reads return MUST call the matching
   bust; the discovery pin enforces it"), and the TTL staleness bound with
   its cross-process meaning. No new env names (the env-docs guard stays
   untouched); no player-visible strings change (byte-identical moderation
   prose).

7. **Registry.** progress.md gains the rider implement section (deliverables,
   commits, JUDGED and DEFERRED lists, the values registry: TTL 5_000, caps
   1_024/1_024, the discovered site count, the exemption); state.md
   Where-we-are updated, including the validation matrix moving from the
   SEVEN-suite to the EIGHT-suite pg battery.

## Out of scope

Caching any other guard surface: the maps/user_assets bundles, the per-domain
guard copies, the legacy main.ts resolvers (dead under API_DISPATCH=new),
ws_auth's once-per-handshake pair, the requireAccount problem+json consumers
(deeds, steam, epic, leaderboard), the GET /api/discord 45s poll (its payload
already rides discord_status_cache; its guard reads stay direct), and the
admin surface (adminRolesForAccount stays re-read per request BY DESIGN: a
dashboard revocation applies on the next call). Cross-process NOTIFY-based
busting (recorded option for 22's pre-enable audit). An expired-token
retention prune for auth_tokens (none exists today; a 22 hygiene candidate,
not this rider). The rate_limits UPSERT cost of the limiter itself (16 sized
it deliberately). Anything the escrow rider's and the 20 rounds' JUDGED lists
settled: do not re-raise.

## Validation

`npx tsc --noEmit`; the full marketplace pg battery, now EIGHT suites, zero
skips, against `npm run db:up` with `TEST_DATABASE_URL` passed on the command
line only (bond, delivery, directed, plan_pins, stepup, realm_scope,
settlement, plus the new authguard suite; never source .env around a run, and
never run the same pg suite in two processes at once); the DB-free
marketplace suites (directed_sql, service, fake fidelity, routes, wire_pins,
escrow_queue, escrow_gate, delivery, local_ledgers, tunables, monitor,
hot_reads, game_metrics, custody, plus the new auth_guard_core,
woc_auth_guard_cache, and discovery-scan suites) and the guard-adjacent
core suites the extraction touches (token_scope_db, require_account,
moderation_error_body, ws_auth, ownership_coverage); the rider mutation
section run per the 20 protocol in a THROWAWAY worktree; `npm run
ci:changed`; then commit and `node scripts/gate_select.mjs` on the COMMITTED
tree (no tail pipe; investigate any red before rerunning; a first-failure
stop is by design).

## Reviewers

`privacy-security-review` AND `server-hot-path-reviewer` (the named set from
the 17 decision: this is security-sensitive caching on the request hot path),
plus `database-performance-reviewer` on the SQL and suite changes;
`test-coverage-auditor` on the tests; `qa-checklist` LAST. Fix rounds are
re-reviewed FRESH; when a verifier refutes a finding, judge the refutation
yourself with the file open. Budget for zero lane reports (the recorded
delivery pattern): run every dimension on the main thread and treat lanes as
corroboration.

## Acceptance criteria

- [ ] The pure core module owns both computes; db.ts is fetch + compute,
      byte-equal by parity sweep, and NETS DOWN in lines
- [ ] The cache caches raw rows only: read-time expiry re-check and
      per-read moderation compute pinned in both directions
- [ ] No negative caching, no stale-serve, single-flight, lost-bust epoch,
      and derived-cap eviction each pinned
- [ ] Every discovered writer busts (post-COMMIT where transactional): the
      discovery scan pins the exact site count with a non-vacuity floor,
      column-classifies the quota consume OUT, and carries exactly one
      reasoned DELETE exemption
- [ ] revokeCompanionToken's prefix delete provably drops every cached token
      of the account (the over-bust arm)
- [ ] The admin surface is uncached by WIRING PIN and by BEHAVIORAL CONTRAST,
      not by comment; every non-market guard consumer is untouched
- [ ] The marketplace test-override seam keeps absolute precedence; every
      existing routes and ownership test passes unmodified
- [ ] The TTL constant is scrape-pinned to its docblock bounds; the
      cross-process staleness bound is stated where an operator will read it
- [ ] The eighth pg suite proves the quals and the real writer-to-bust chain,
      zero skips, and self-selects into the gate's always-run floor
      (dry-selection probe)
- [ ] Cache stats ride the stuck readout with toContain pins
- [ ] Rider mutation section appended to phase-20-mutation-log.md, every new
      money/security predicate logged BIT (or judged with a bitten double
      strip)
- [ ] server/db.ts ends the rider at or below its starting line count; no
      ratcheted file grows
- [ ] Gate PASS on the committed tree

## Wrap-up

Update progress.md with the rider's registry section (JUDGED and DEFERRED
lists for the rider QA to consume, the values registry, the commit roster)
and state.md's Where-we-are (including the eight-suite battery language and
re-surfacing the three open maintainer rulings: the woc_market.ts ceiling
raises, the woc_market_db.ts no-ratchet-row question, and the escrow gate
hold-ceiling sizing). Nothing is pushed (R4). Next file:
`docs/woc-marketplace-hardening/rider-auth-guard-reads-qa.md`.
