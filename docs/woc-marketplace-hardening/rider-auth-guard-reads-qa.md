# Rider QA: per-request auth-guard read cache

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.40.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for the auth-guard read cache rider. Canonical QA
workflow in `implementation-plan.md`. Repo: game, worktree
`/Users/fernando/Documents/wocc-marketplace`. This session pushes on PASS per
R4 (the implement session pushed nothing).

## What was promised (audit every item)

The seven deliverables in `rider-auth-guard-reads.md`, against the cluster
text it carries verbatim (the 16 QA deferral and the 17 SESSION START
DECISION constraints) and its findings-context corrections; the rider
registry section in progress.md (JUDGED and DEFERRED lists, values registry,
commit roster); the rider mutation section in `phase-20-mutation-log.md` at
the 20 protocol.

## Rider-specific probes (where to spend the time)

- The REVOCATION path is the money surface: for EVERY auth_tokens writer,
  prove end to end (real SQL, the real db.ts function, the notifier fired by
  the function itself) that a warm cached token refuses on the next read.
  Exercise the prefix-keyed revokeCompanionToken arm specifically: the
  account-keyed over-bust must drop EVERY cached token of the account, and
  the proof must seed TWO cached tokens (the symmetric-fixture trap: one
  matching the prefix, one not, both dropped). Probe the post-COMMIT
  placement: a bust fired before COMMIT can be repopulated with pre-commit
  state by a concurrent read; confirm the placement and, where a test can
  interleave, prove it.
- The ROW-not-result rule, both directions with a fake clock: a cached
  suspension unlocks exactly when suspended_until passes with NO refetch; a
  cached ban never unlocks; a cached token refuses at expires_at even when
  the cache TTL has not lapsed. Then the negative controls: drop the
  read-time re-check or freeze the compute and the pins must go red (re-run
  the logged mutants yourself for at least five sampled rows with YOUR OWN
  strip designs, the 20 independent-spot-check protocol).
- The ADMIN surface: prove uncached by behavior, not comment. With a warm
  cache and the underlying token flipped to revoked, the admin gate refuses
  the very next request while the player GET still serves until bust or TTL.
  Check the wiring pin cannot be satisfied by a comment or an unused import,
  and that adminRolesForAccount is still re-read per request.
- The DISCOVERY pin is the rot-proofing: try to game it. Plant (in a scratch
  copy, never the tree) a hoisted-SQL writer, a writer in a new file, an
  UPDATE touching a projection column among others, and a second
  DELETE FROM accounts; the scan must red on each. Confirm the
  quota-consume stored procedure is classified OUT by COLUMN, not by file or
  hand list, and that the exemption count is exactly 1 with its reason. The
  escrow round's routing pin was blind to a hoisted-SQL writer: check this
  scan against that exact class.
- Cache mechanics under adversarial reads: no negative caching (spray
  unknown tokens; entries must not move and each probe must hit the fetch),
  no stale-serve (warm entry past TTL plus a throwing fetch must reject),
  single-flight, the lost-bust epoch race (bust mid-refresh: the flight must
  not install and a post-bust reader must refetch), LRU eviction at the
  derived cap with the green constant-bump control, and the account index
  after eviction residue (bustAccount over stale index entries stays safe).
- The PARITY sweep: the cached bundle and the direct functions byte-equal
  across the full matrix, including the fail-closed unknown-scope row and
  the missing-row defaults, and the guard middlewares emit byte-identical
  bodies over both. Every existing routes/ownership/claudium call-count test
  must pass UNMODIFIED (the claudium per-request pins are the canary that
  the cache leaked past the marketplace scope).
- Scope containment: maps_routes, user_assets_routes, wallet, characters,
  account, reports, daily_rewards, github, discord, claudium, desktop_login,
  seeker_entitlement, ws_auth, require_account consumers, and the legacy
  main.ts resolvers are byte-untouched or provably behavior-identical.
- The db.ts extraction: move-not-rewrite (compare the compute against the
  merge base), db.ts net line count DOWN, the moderation message strings
  byte-identical (S3 guard green), AccountModerationStatus importers compile
  through the re-export.
- Values registry: TTL 5_000 scrape-pinned to its docblock bounds and the
  cross-process staleness bound stated for operators; caps 1_024 derived in
  fixtures; stats on the stuck readout with toContain pins.
- The eighth pg suite: fixed database name collides with nothing, zero
  skips, one lane at a time, and the gate dry-selection probe shows it in
  the always-run floor (no coverage theater).
- Mutation log integrity: every new pin's mutant occurrence-asserted,
  run-proven, reverted byte-identical; lanes partitioned by suite (the
  fixed-db-name collision class); BIT verdicts re-run after any later edit
  to the pinning test (the stale-verdict trap).
- Registry and docs: progress.md rider section complete (JUDGED and DEFERRED
  binding lists), state.md Where-we-are updated including the EIGHT-suite
  battery language, server/CLAUDE.md rows true, no CLAUDE.md left stale, and
  the three open maintainer rulings re-surfaced, not re-decided.

## Reviewers

`privacy-security-review`, `server-hot-path-reviewer`,
`database-performance-reviewer`, `test-coverage-auditor`; `qa-checklist`
LAST. Fix rounds re-reviewed FRESH; judge refutations yourself with the file
open. Budget for zero lane reports: run every dimension on the main thread.

## Validation matrix (re-run fresh at the tip)

`npx tsc --noEmit`; the EIGHT-suite pg battery zero skips with
TEST_DATABASE_URL on the command line only, one lane per suite; the DB-free
marketplace suites plus the new core/cache/discovery suites and the
guard-adjacent core suites (token_scope_db, require_account,
moderation_error_body, ws_auth, ownership_coverage); `npm run ci:changed`;
`node scripts/gate_select.mjs` on the committed tree (no tail pipe).

## Exit

Verdict, counts found and fixed, what was pushed (on PASS: git push origin
feature/woc-marketplace, packet docs included), deferrals with owners.
Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/phase-21-devnet-dry-run.md`.
