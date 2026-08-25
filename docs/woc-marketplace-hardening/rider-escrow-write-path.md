# Rider: escrow write-path hardening

SESSION START (do this first in every fresh session): cd into the worktree
`/Users/fernando/Documents/wocc-marketplace`; verify `pwd` and
`git branch --show-current` (must print `feature/woc-marketplace`). Then
`git fetch origin` and merge the newest `origin/release/**` branch (currently
`origin/release/v0.40.0`) so this session starts current; if the merge is
non-trivial, run the `release-merge-audit` skill on it before continuing.

Follow the shared workflow in `implementation-plan.md` first; `state.md` has the
validation matrix. This file is the rider spec. It is a packet phase in all but
number: implement session then its dedicated QA session
(`rider-escrow-write-path-qa.md`), LOCAL per R4 until the QA pushes on PASS.

- Repo: game. Worktree `/Users/fernando/Documents/wocc-marketplace`, branch
  `feature/woc-marketplace`.
- Closes: the escrow WRITE-path cluster (the 05 QA db-perf P2s, the 05/06
  escrow-queue observability set, the 16 QA re-deferral, the 17 QA
  plain-statement writer addition), decided into this dedicated rider at the 17
  session start. Owed BEFORE `phase-21-devnet-dry-run.md`, ahead of the
  per-request auth-guard rider, so 21's devnet contention run measures the
  shipped shapes.
- Standards bar: round 20. Every money or security predicate this rider adds or
  moves gets a real-SQL pin whose mutant is strip-proven and logged (append a
  rider section to `phase-20-mutation-log.md`, same protocol header rules:
  occurrence-asserted strips, diff-proven, run-proven with the Tests summary
  line, checkout-reverted byte-identical, lanes partitioned by suite). Every
  WHERE clause gets a violating fixture per qual dimension (the symmetric
  fixture trap). Tunable-boundary fixtures derive from the constant, proven
  with a green constant-bump control. Re-run a pin's mutant after any later
  edit to the pinning test.

## The cluster, verbatim from the registries

The 16 re-deferral (progress.md, "Re-deferred with owners and reasons"):

> the escrow WRITE-path cluster (05 QA db-perf P2s: realm-global escrow
> semaphore, contention-class label, draining refusal on createListing, FOR NO
> KEY UPDATE narrowing; the 05/06 escrow-queue observability: pendingKeys
> gauge, wocEscrowQueue terminal kind, TxNeverStarted-to-contended widening
> incl. commitGrant's park arm, per-listing serialize cost, the saveAll-wave
> suppression measurement; the honest occupancy tail with the guild-flush 60s
> term; the commitGrant FIFO, still sequenced AFTER the occupancy bound; the
> local-ledger eviction and excludeIds growth bounds) goes to a dedicated
> rider before 22, decided at the 17 session start

The 17 QA addition (progress.md, "DEFERRED with owners"):

> Escrow WRITE-path rider (per the 17 SESSION START DECISION): the
> plain-statement row-locking writers outside withTx (clearBuyNowLock after a
> contended refusal is the sharpest; also markBidStatus, setBondState,
> lapseBid, transitionSettlement and siblings) wait under the 15s ceiling with
> no typed refusal and no counting; bound or classify them there. Also the F1
> low-water cursor if blocked-prefix growth is ever observed.

Internal ordering is BINDING (05 QA ruling, upheld at 16 and 17): the honest
occupancy bound lands BEFORE the commitGrant FIFO, and the FIFO close is gated
on the claims-ledger park subset staying intact.

## Findings context (recon 2026-08-20 against the tree at the v0.40.0 sync)

Corrections to the registry phrasing, so this spec does not inherit stale
premises:

- The narrowing pass is 16 blocking `FOR UPDATE` sites in
  `server/woc_market_db.ts` (10 lock `woc_market_listings` rows, 5 lock
  `woc_market_bids` rows, 1 locks the seller's `accounts` row at
  `escrowInsertListing`), plus 5 `SKIP LOCKED` sweep claims that never wait.
  Not one site uses `FOR NO KEY UPDATE` today. The wide blast radius is the
  LISTINGS locks (every guard holding a listing row blocks concurrent
  FK-child inserts, bids and settlements, at the FK KEY SHARE level), not the
  single accounts lock the 05 phrasing led with. The safety argument is
  already in the code at `insertSettlement` (woc_market_db.ts, "the FK's KEY
  SHARE lock only DELAYS a concurrent closer's commit, never refuses it"):
  no guard depends on the FK-share half for correctness, and
  `FOR NO KEY UPDATE` still conflicts with itself and with `FOR UPDATE`, so
  guard-vs-guard exclusion survives.
- The pinned occupancy relation is `ESCROW_STATEMENT_TIMEOUT_MS * 5 +
  ESCROW_LOCK_TIMEOUT_MS + DB_POOL_CONNECT_TIMEOUT_MS < AUTOSAVE_SECONDS *
  1000` (27s under 30s, tests/server/tunables.test.ts). The "4 x statement"
  phrasing in the older registry rows is stale: the multiplier went to 5 when
  the directed rail added its CAS, and the allowance dropped 5000 to 4000 in
  the same change. The test's exclusion comment names BEGIN and the SET LOCALs
  (15s session default), and COMMIT (65s driver backstop), but NOT the
  guild-flush 60s term, which is the dominant real term: the pre-job
  `flushDirtyGuildBooks` is an ordinary `saveCharacter` riding
  `DB_HEAVY_STATEMENT_TIMEOUT_MS` (60s) on the SAME per-character FIFO.
- There is NO saveAll-wave suppression mechanism. Escrow protection is FIFO
  ordering only; `escrowQuarantined` is post-hoc and terminal. The
  "suppression measurement" deliverable is a measurement to take and record
  (dbperf proof 3), not a mechanism to verify.
- Nothing refuses during shutdown drain. `markDraining()` feeds only
  /livez and /readyz; the HTTP listener is never closed; `pool.end()` can
  fire under a running escrow write. The 75s grace exists only as
  `stop_grace_period: 75s` in docker-compose.yml, with no in-code constant.
- commitGrant's FIFO carve-out is deliberate and negatively source-pinned
  (tests/server/woc_market_escrow_queue.test.ts, the flat-zero pin over
  `.runSerialized(` and `enqueueCharacterWrite` in woc_market.ts, sweep, and
  monitor). Closing it must land in that pin in the same change.
- The existing lock-order pins assert on the substring `FOR UPDATE`, which
  `FOR NO KEY UPDATE` does NOT contain, so the narrowing WILL red several
  pins in tests/server/woc_market_directed_sql.test.ts; update them in the
  same change, and leave a completeness pin that a plain `FOR UPDATE` cannot
  quietly return.
- There are no atMost/atLeast env parser helpers in this repo; the bounded
  env-knob idiom is the `WOC_MARKET_CONFIRMING_REVIEW_HOURS` clamp-and-warn
  form in woc_market_routes.ts, and every new market env name owes
  .env.example a column-0 row (tests/server/woc_market_env_docs.test.ts, both
  directions). Prefer code constants unless an operator genuinely needs the
  knob.

Monolith posture: `server/woc_market.ts` (4484) and
`src/ui/woc_market_window.ts` (2614) sit at ZERO headroom; one added line
reds the gate, and the ratchet row names the delivery arms as the next
extraction candidate. `server/woc_market_db.ts` has NO ratchet row; whether
it gets one is an OPEN maintainer question (progress.md, 17 QA deferrals).
Keep its net growth minimal regardless: new logic lands in sibling modules,
and db.ts takes only the SQL-adjacent edits that belong there.

## Deliverables

Ordering: 1 and 2 are the occupancy bound and land before 9 (binding). 3 to 8
may interleave as convenient; each lands with its tests in the same commit
series.

1. **The honest occupancy tail.** Make the FIFO-occupancy arithmetic honest
   about the guild-flush 60s term: the exclusion comment and the pinned
   relation in tests/server/tunables.test.ts gain the flush term (scraped
   from the exported `DB_HEAVY_STATEMENT_TIMEOUT_MS`, never a re-typed 60000),
   and the honest worst-case request ceiling (flush + BEGIN and SET LOCALs
   under the session default + five workload statements + lock wait + pool
   checkout + COMMIT backstop) is a DERIVED, pinned number the docblocks at
   `ESCROW_STATEMENT_TIMEOUT_MS` and `ESCROW_QUEUE_WAIT_MS` state, not prose
   arithmetic that drifts. Decision item, judged in-session with the file
   open: if an EXISTING seam on the saveCharacter options path allows the
   escrow-path flush to select the standard statement allowance instead of
   the 60s heavy one WITHOUT threading a new allowance through saveCharacter
   (the invasive shape 06 QA rejected), take it and shrink the term; if not,
   re-affirm the rejection in one comment and keep the honest arithmetic.
   What bounds the player-facing impact stays the wait deadline plus the
   depth cap plus deliverable 2; say so at the constants.

2. **The realm-global escrow gate (semaphore).** A NEW sibling module
   `server/woc_market_escrow_gate.ts` (the seeker_rpc_executor idiom: a
   bounded in-flight count, a typed refusal, a `stats()` readout, injectable
   and clock-free), consumed by `createWocMarketCustody` as an injected
   option. `runSerialized` acquires a slot at entry (the whole queued plus
   running window, released when the WORK settles, the depth-cap slot's own
   lifecycle) and refuses saturation as the existing typed `'contended'`
   with a NEW counter kind. The cap is a CODE constant sized strictly below
   the `DB_POOL_MAX_CLIENTS` default (10), relation-pinned; no env knob
   unless a reviewer demands one. The per-character cap does not bound
   realm-wide load; after this, the gate does, and the 10-client pool stops
   being the only backstop. Do NOT acquire the gate from the sweep or the
   monitor (the flat-zero source pin, and the enqueueMarketWrite latency
   chain the recon mapped); the sweep-driven delivery work is bounded by its
   own batch sizes and, after deliverable 9, by the FIFO wait deadline.

3. **The escrow-queue observability set.**
   - `pendingKeys` gauge: expose the number of keys with queued or running
     work on the character-save serial writer
     (`createKeyedSerialWriter` gains a size accessor), and surface it as a
     scrape-time gauge beside `woc_players_online` in
     server/http/game_metrics.ts (GameStateSource member, all THREE
     implementations, a fresh label-free single-value gauge; avoid the
     label names cause/phase/stat/direction, the registry-wide pin trap).
   - `wocEscrowQueue` terminal kind: add a settled/terminal sibling to
     `WOC_ESCROW_QUEUE_OUTCOMES` emitted when the escrow WORK settles, so
     started-minus-terminal is the wedged-job signal. Update the ordered
     literal pin in tests/server/http/game_metrics.test.ts and the
     emission-order pins in the escrow-queue suite.
   - Contention-class label: `deadlocks` (40P01) and `txNeverStarted` join
     the existing `idleTxKills` (25P03) and `lockWaitTimeouts` (55P03)
     process-lifetime counters in woc_market_db.ts, all four riding the
     GET /internal/woc-market/stuck readout (the main.ts merge literal plus
     its toContain pins in tests/server/woc_market_hot_reads.test.ts), so
     idle, lock, deadlock, and never-started stop collapsing into one
     untyped 'contended' invisibly. The wire refusal stays 'contended';
     the label is observability, not a new client-facing member. The
     per-site split stays 22-owned (judged at 17 QA: coarse is the design).
   - The escrow gate's `stats()` joins the same readout.
   - Per-listing serialize cost: bracket the in-job character serialize and
     keep process-lifetime {count, totalMs, maxMs} on the readout, so the
     event-loop cost the SAVE_IDLE bound exists for is a number.
   - The saveAll-wave suppression measurement: a DB-free test in the
     escrow-queue suite that holds one character's FIFO under an escrow job
     and proves the saveAll wave still drains every OTHER character while
     the wave's completion honestly waits out the held slot (the
     SAVE_CONCURRENCY worker structure); record the measured shape in the
     registry. This is the owed dbperf proof 3, taken as a pinned fact.

4. **TxNeverStarted-to-contended widening.** Every withTx guard tail whose
   catch classifies `isLockContention` also classifies `TxNeverStarted` to
   the SAME typed answer (nothing ran, so the typed retry refusal is
   strictly correct), instead of only the escrow write mapping it. The
   delivered-save tail (commitGrant's backing) includes it in its
   classify-to-count-then-rethrow so a never-started failure lands in
   commitGrant's TRANSIENT abort arm (retry next pass off the durable
   claim), never the loud park. Each widened tail gets its pin; the
   never-started counter (deliverable 3) counts every one.

5. **The FOR NO KEY UPDATE narrowing pass.** Narrow all 16 blocking
   `FOR UPDATE` sites in server/woc_market_db.ts to `FOR NO KEY UPDATE`,
   after a per-site check that no statement under the lock writes a key
   column (none does today; verify, do not assume). Judge the 5
   `SKIP LOCKED` claim sites in the same pass (they never wait, but they
   hold the FK-share-conflicting mode while claimed); narrow them too unless
   a site-specific reason emerges, and record each judgment. Update every
   substring pin the rename reds. New pins, real-SQL and mutation-logged:
   - guard-vs-guard exclusion SURVIVES the narrowing (the existing
     two-connection contention tests stay green and at least one gains a
     narrowed-mode assertion);
   - the freed behavior is REAL: an FK-child insert (a bid on a listing row
     held by a guard; the abandons insert against the escrow-held accounts
     row) no longer waits, with the blocking behavior of plain `FOR UPDATE`
     as the negative control on a raw client;
   - cap serialization at `escrowInsertListing` is PRESERVED: two concurrent
     escrow inserts for the same account still serialize through the
     accounts row lock and the cap admits exactly the cap.
   - a completeness pin: zero plain `FOR UPDATE` clauses remain in
     woc_market_db.ts (regex-safe against the NO KEY spelling), locked to
     the narrowed count.

6. **Bound and classify the plain-statement writers.** One shared bounded
   plain-write seam in woc_market_db.ts routes the direct-pool row-locking
   writers through ONE new withTx site carrying the lock bound
   (`ESCROW_LOCK_TIMEOUT_MS`) and an idle bound (AMENDED in the review fix
   round: the SAVE tier `SAVE_IDLE_TX_TIMEOUT_MS`, both bounds in one
   merged query, because the seam's round-trip gaps are pure protocol idle
   and a 2s kill there destroys a pooled client across the whole write
   surface),
   so a contended row refuses at 2s as a classified, counted 55P03 instead
   of camping a pooled client for the 15s session default and dying as an
   unclassified 57014. The withTx completeness pin in
   tests/server/woc_market_directed_sql.test.ts moves 12 to 13 sites with
   the per-slice checks intact. Partition the 47 direct-pool writers
   deliberately and record the class of every one in the registry:
   - Row-locking writers on contendable rows (the five named:
     `clearBuyNowLock`, `markBidStatus`, `setBondState`, `lapseBid`,
     `transitionSettlement`, plus the siblings in their class: the CAS
     writers, rotation stamps, custody-claim markers, directed-offer
     writers): route through the bounded seam. Callers keep their
     semantics: a classified contention rethrow still reaches arm() or the
     existing catch, but bounded and counted.
   - The sharpest caller, buyNow's four UNCAUGHT `clearBuyNowLock`
     compensation calls after an already-decided typed refusal: catch the
     classified contention at the call sites, count it, and let the decided
     409 stand (the buy-now lock self-expires); a 500 that overwrites a
     decided refusal is the defect. Judge the other high-consequence
     callers (the two signature recorders, the eager confirm transition)
     per-site with the file open and record each decision.
   - The retention prunes and any writer judged un-contendable or
     correctly-unbounded: record the judgment instead of moving it.
   The 57014 ruling STANDS (05 QA, upheld): a blown statement allowance
   stays an incident-shaped 500; do not widen `isLockContention` with
   57014. Under the bounded seam, contention surfaces as 55P03, so the
   ruling and the classification never collide.

7. **The draining refusal on createListing.** `WocMarketDeps` gains an
   optional `draining?: () => boolean` (absent = never draining, so no rig
   changes); main.ts wires it to the health module's drain flag (export a
   read accessor beside `markDraining`). `createListing` refuses early with
   the existing `'market_paused'` refusal (503, copy already localized)
   when draining, BEFORE custody work, so a listing accepted at T+70s can
   no longer enter a 60s-tail escrow write under `pool.end()`. The other
   mutations stay undrained by judgment (their guard transactions are
   2s-bounded and the drain window is seconds); record the judgment. Pin:
   the refusal fires with draining true, everything else untouched with it
   absent or false.

8. **Local-ledger eviction and excludeIds growth bounds.** The four park
   maps and two stamp maps on WocMarketService prune on the shared TTL
   already; give them explicit size bounds: park maps refuse a NEW park at
   the cap (the row simply retries next pass, costing a batch slot, never
   memory), stamp maps (pendingGrants, pendingMail, the exactly-once
   intents whose entries must never silently vanish) warn loudly through a
   counted high-water instead of dropping. The `excludeIds` arrays passed
   to the batch reads inherit the park cap, bounding the `<> ALL($n)` SQL
   cost. Caps are code constants derived from the batch sizes
   (relation-pinned, constant-bump control), landed in
   woc_market_local_ledgers.ts (the arithmetic home) with the maps staying
   on the service.

9. **The commitGrant FIFO (LAST, after 1 and 2).** Close the recorded
   carve-out: the delivered save rides the buyer's per-character FIFO with
   the grant blob serialized INSIDE the queued job (fresher than every
   previously committed autosave, the same guarantee the escrow write has),
   under a bounded wait: a FIFO busy past the deadline PARKS the delivery
   through the existing rotation (retry next pass), never blocks the
   locked sweep segment unbounded and never converts to a loud error. The
   claims-ledger park subset stays INTACT: the lease_lost park arm, the
   durable claim plus grant intent attribution, and the throw-never-mails
   rule are unchanged (this is the gate condition the 05 ruling set).
   Design constraints from the recon: the sweep's locked delivery segment
   awaiting a FIFO whose head awaits the market serial writer is a latency
   CHAIN, not a cycle (the market writer never waits on the FIFO); the
   deadline bounds it. Use a custody-owned bounded-enqueue sibling rather
   than overloading `runSerialized` (the listing flush and books logic do
   not apply to a buyer delivery; keep the listing throughput counter
   baseline clean, giving the grant its own counter kinds only if an
   operator needs them). Update in the same change: the flat-zero source
   pin in the escrow-queue suite (count the new sanctioned site exactly),
   the carve-out comments at commitGrant and in server/CLAUDE.md (both the
   H5 row and the FIFO rule's recorded-exceptions line). PAY THE RATCHET:
   woc_market.ts is at zero headroom, and the ratchet row names the
   delivery arms as the standing candidate; extract the delivery arms to a
   `server/woc_market_delivery.ts` sibling behind the WocMarketDeps idiom
   (move-not-rewrite, direct tests), and LOWER the ceiling to the new
   exact count.

Conditional, explicitly NOT owed unless triggered: the F1 low-water cursor
lands only if blocked-prefix growth is actually observed; no observation
source exists today, so record the condition and move on.

## Out of scope

The per-request auth-guard reads (the second rider; its design constraints
are in the 17 SESSION START DECISION bullet in state.md). The at-scale
advisory-cooldown proof, p99.9 gap, and expiry-batch ceiling (21). The
pg-suites-in-CI posture, per-site contention splits, pgPool high-water, and
the sweep drain semantics (22). Anything the 20 QA JUDGED lists settled: do
not re-raise them.

## Validation

`npx tsc --noEmit`; the full marketplace pg battery, SEVEN suites, zero
skips, against `npm run db:up` with `TEST_DATABASE_URL` passed on the
command line only (bond, delivery, directed, plan_pins, stepup, realm_scope,
settlement; never source .env around a run, and never run the same pg suite
in two processes at once); the DB-free marketplace suites (directed_sql,
service, fake fidelity, routes, escrow_queue, plus tunables, monitor,
hot_reads, game_metrics for the surfaces this rider touches); the rider
mutation section run per the 20 protocol; `npm run ci:changed`; then commit
and `node scripts/gate_select.mjs` on the COMMITTED tree (no tail pipe;
investigate any red before rerunning; a first-failure stop is by design).

## Reviewers

`privacy-security-review` AND `database-performance-reviewer` AND
`server-hot-path-reviewer` (this is write-path locking work; all three per
the 17 charter), `test-coverage-auditor` on the tests; `qa-checklist` LAST.
Fix rounds are re-reviewed FRESH; when a verifier refutes a finding, judge
the refutation yourself with the file open.

## Acceptance criteria

- [ ] The occupancy relation and its docblocks carry the guild-flush term
      scraped from the exported constant; the honest ceiling is derived and
      pinned, not prose
- [ ] The escrow gate refuses realm-wide saturation as typed 'contended'
      with its own counter kind, cap relation-pinned below the pool default,
      never acquired by sweep or monitor
- [ ] pendingKeys gauge live in all three GameStateSource implementations;
      terminal escrow-queue kind in the ordered vocabulary pin; all four
      contention classes counted and on the stuck readout
- [ ] Every withTx guard tail classifies TxNeverStarted like contention,
      pinned per tail
- [ ] Zero plain FOR UPDATE remains in woc_market_db.ts (completeness pin);
      guard-vs-guard exclusion, freed FK-child inserts, and cap
      serialization each proven real-SQL with logged mutants
- [ ] Plain writers route through the bounded seam (withTx completeness pin
      at 13) or carry a recorded judgment; buyNow's compensation contention
      no longer converts a decided 409 into a 500
- [ ] createListing refuses while draining; absent wiring changes nothing
- [ ] Ledger and excludeIds caps pinned by relation with a green
      constant-bump control; stamp maps never silently drop an intent
- [ ] commitGrant rides the FIFO with in-job serialize and a park-on-deadline
      bound; the claims-ledger park subset intact; the flat-zero pin,
      carve-out comments, and server/CLAUDE.md updated; delivery arms
      extracted and the woc_market.ts ceiling LOWERED
- [ ] Rider mutation section appended to phase-20-mutation-log.md, every new
      money/security predicate logged BIT (or judged with a bitten double
      strip)
- [ ] Gate PASS on the committed tree

## Wrap-up

Update progress.md with the rider's registry section (JUDGED and DEFERRED
lists for the rider QA to consume, the values registry, the commit roster)
and state.md's Where-we-are. Nothing is pushed (R4). Next file:
`docs/woc-marketplace-hardening/rider-escrow-write-path-qa.md`.
