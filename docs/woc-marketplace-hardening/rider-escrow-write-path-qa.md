# Rider QA: escrow write-path hardening

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.40.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Dedicated QA session for the escrow write-path rider. Canonical QA workflow in
`implementation-plan.md`. Repo: game, worktree
`/Users/fernando/Documents/wocc-marketplace`. This session pushes on PASS per
R4 (the implement session pushed nothing).

## What was promised (audit every item)

The nine deliverables in `rider-escrow-write-path.md`, in its binding order
(occupancy bound before the commitGrant FIFO), against the cluster text it
carries verbatim; the rider registry section in progress.md (JUDGED and
DEFERRED lists, values registry, commit roster); the rider mutation section in
`phase-20-mutation-log.md` at the 20 protocol; the F1 low-water cursor
explicitly NOT built unless its trigger was observed.

## Rider-specific probes (where to spend the time)

- The narrowing pass is the money surface: for EVERY site moved to
  `FOR NO KEY UPDATE`, confirm with the file open that no statement under the
  lock writes a key column, that guard-vs-guard exclusion is proven by a
  two-connection real-SQL test (not asserted by comment), and that the freed
  FK-child insert has a plain-FOR UPDATE negative control. Re-run the logged
  mutants yourself for at least five sampled rows with YOUR OWN strip
  designs (the 20 QA independent-spot-check protocol). Check the cap
  serialization proof seeds same-account concurrency, not just same-realm
  (the symmetric-fixture trap runs both ways).
- The commitGrant FIFO close is the custody surface: prove the claims-ledger
  park subset intact (lease_lost park arm, durable claim plus grant intent,
  throw-never-mails) on the REAL code path, prove the in-job serialize is
  fresher than a pre-grant autosave (the stale-autosave buyer-loss window the
  close exists for), and prove the park-on-deadline arm cannot loud-error or
  block the locked sweep segment unbounded. Confirm the flat-zero source pin
  now counts exactly the sanctioned sites and the carve-out comments plus
  server/CLAUDE.md rows were trued, not left stale.
- The escrow gate: starve it deliberately (cap saturated) and confirm the
  refusal is the typed 'contended' with its counter kind, that release rides
  WORK settlement (not waiter return), that sweep and monitor never acquire
  it, and that the cap relation pin derives from the constant (green
  constant-bump control present).
- The bounded plain-write seam: confirm the withTx completeness pin moved 12
  to 13 with per-slice checks intact, that the writer partition in the
  registry covers all 47 with no silent leftovers, that buyNow's four
  compensation sites keep their decided 409 under injected contention, and
  that the 57014 ruling survived (no widening of isLockContention).
- The occupancy honesty: the guild-flush term is SCRAPED, not re-typed; the
  honest ceiling is derived in the pin; the decision item (tighten vs
  re-affirm) was actually decided and recorded.
- Observability: the terminal kind is in the ordered vocabulary pin and
  emitted at the settle point; pendingKeys reads live state in all three
  GameStateSource implementations; the four contention classes and the gate
  stats ride the stuck readout with their toContain pins; the label-name
  trap (cause/phase/stat/direction) was avoided.
- Drain: with draining wired true, createListing refuses BEFORE custody work
  (nothing extracted, no FIFO slot consumed); with the dep absent, byte-for-
  byte prior behavior. Confirm the judgment on the undrained mutations is
  recorded, not skipped.
- Ledger bounds: stamp maps must never silently drop an exactly-once intent
  (the cap arm warns and counts instead); park caps refuse-new and the row
  provably retries; the excludeIds SQL cost bound follows.
- Mutation log integrity: every new pin's mutant occurrence-asserted,
  run-proven, reverted byte-identical; lanes partitioned by suite (the
  fixed-db-name collision class); BIT verdicts re-run after any later edit
  to the pinning test (the stale-verdict trap).
- Registry and docs: progress.md rider section complete (JUDGED and DEFERRED
  binding lists), state.md Where-we-are updated, no CLAUDE.md left stale, the
  directed_sql floor count references in the packet docs updated if the suite
  grew, and the open woc_market_db.ts ratchet question still recorded with
  net growth kept minimal.

## Reviewers

`privacy-security-review`, `database-performance-reviewer`,
`server-hot-path-reviewer`, `test-coverage-auditor`; `qa-checklist` LAST.
Fix rounds re-reviewed FRESH; judge refutations yourself with the file open.

## Validation matrix (re-run fresh at the tip)

`npx tsc --noEmit`; the SEVEN-suite pg battery zero skips with
TEST_DATABASE_URL on the command line only, one lane per suite; the DB-free
marketplace suites plus tunables, monitor, hot_reads, game_metrics;
`npm run ci:changed`; `node scripts/gate_select.mjs` on the committed tree
(no tail pipe).

## Exit

Verdict, counts found and fixed, what was pushed (on PASS: git push origin
feature/woc-marketplace, packet docs included), deferrals with owners.
Update progress.md and state.md. Next file:
`docs/woc-marketplace-hardening/rider-auth-guard-reads.md` if minted, else
name the auth-guard rider implement session against the 17 SESSION START
DECISION constraints (state.md), then `phase-21-devnet-dry-run.md`.
