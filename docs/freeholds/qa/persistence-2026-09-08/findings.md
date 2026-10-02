# 07 findings ledger (every finding, every reviewer, applied or ruled)

Status key: FIXED (with the commit that did it) / RULED (reviewed, no change warranted,
with the reason).

THE ROUND IS NOT CLOSED, AND THE VERDICT IS FAIL. SIXTEEN fix rounds have now run and
FOURTEEN of the sixteen introduced a defect worse than one they closed, each caught by a
fresh reviewer, by the gate, or by a mutant, and NEVER by the round's own green tests.
ROUND FIFTEEN is the round that executed the four settled rulings, and the fresh read
that opened it found 36 findings including one BLOCKING, in code fourteen rounds and a
green gate had already been over. ROUND SIXTEEN is six fresh lanes over round fifteen
itself: 30 findings, three BLOCKING, and TWO of those three were defects round fifteen
had introduced, one of them a money-conservation regression on the leave path and one of
them the eighth path re-opened from the other side. Both sections are at the end of this
file, and the second is why the first is not the last word.
Round fourteen is the sharpest instance: round thirteen shipped a fix whose CLAIM WAS
WIDER THAN ITS EVIDENCE, citing two measured SQLSTATEs that both leave the connection
usable as proof about every clock fault, so its own probe could not see the case it was
cited for. An earlier version of this line declared the round closed after the third; that
was wrong three times over. A later version said six rounds with the sixth unreviewed, and
a later one said nine; each was true when written and went stale within two commits. All
are corrected here rather than quietly amended.

THE COUNT THAT MATTERS IS NOT THE ROUND COUNT. It is that no round has yet been read by a
fresh pair of eyes and found clean, so the correct prior for the next reader is that this
one is wrong too.

READ THE ROUNDS SEVEN, EIGHT AND NINE SECTION BEFORE ANY OTHER PART OF THIS FILE. Rounds
seven and eight reverted a mechanism that Y1, Z6 and W4 below still describe as the live
fix, and round nine replaced the seal those three argue about. Those three entries are
HISTORY, and each now carries a pointer saying so.

Nine reviewers were dispatched and nine reported: migration-safety, database-performance,
privacy-security, server-hot-path, architecture, cross-platform-sync, test-coverage,
frontend-seam and qa-checklist. EIGHT of them left a report file in this directory; the
qa-checklist gate reported inline across two chunks and has no file. Three further FRESH
lanes then read the fix rounds themselves, one per round from eleven on.
A SECOND, FRESH review lane then read the fix round itself, because a fix round is
unreviewed code; its findings are folded in below rather than kept apart.

## BLOCKING

- B1 the byte ceiling was enforced against two DIFFERENT measurements, and the save path
  checked neither. Re-measured against PostgreSQL 16 rather than trusted: the maximal legal
  record is 101,139 bytes of canonical JSON, and its two content columns measure 100,866
  canonical against 106,032 as jsonb text, because jsonb re-renders every object with a space
  after each colon and comma and stores every number as `numeric` in full positional form.
  FIXED in 4dbddca2dc: a codec rule refusing any number whose JSON text carries an exponent
  (which is what keeps the two renderings a fixed ratio apart rather than an unbounded
  multiple), `FREEHOLD_MAX_STORED_BYTES` as a separately measured bound for the SQL read,
  `freeholdWriteRefusal` applying all three load ceilings before every write, and a
  real-PostgreSQL round trip of the maximal record as the proof that writable implies
  readable.
- B2 the one wire carrying the durable record from ws_auth into game.join had NO test; a
  mutant deleting `freehold,` from the join meta left 168 tests green.  FIXED in 19fefbbeea:
  the five-case pair modelled on the bank-bonus pair, including the arm that proves a thrown
  durable read joins with nothing installed instead of refusing the login, and the contrast
  arm proving a thrown bank-bonus read still does refuse it.
- P1-1 (database-performance) one real edit produced two byte-identical durable writes
  whenever an arm landed while a write was in flight, which shutdown made routine.
  FIXED in 19fefbbeea: a write records the generation and the revision it sampled, and only a
  genuinely later edit re-arms.

## SHOULD-FIX

- S1  `schema_version` was never written, so the forward-version arm was inert.  FIXED in
      bd22f1aa78, on both the insert and the compare-and-swap save, proved against real
      PostgreSQL with a version that is not the current one.
- S2  the leave flush used a weaker dirty test than the sweep.  FIXED in bd22f1aa78.
- S3  contract section 7's "two-layer" enforcement claim was false in both halves.  FIXED in
      4dbddca2dc: the section now states which layer bounds which text and why they differ.
- S4  contract section 4's "refuses before deep allocation" was false for the sim layer.
      FIXED: the row counts bound the build and are checked first; the byte check follows it,
      and the contract says so rather than claiming the two layers refuse alike.
- S5  contract section 4 attributed `unadmitted` to a forward `schema_version`.  FIXED: the
      two causes are separated, because only the stranded `plot_index` is something the SQL
      reader itself admits.
- S6  the plot_id charset CHECK is a policy frozen where CREATE TABLE IF NOT EXISTS can never
      revisit it.  FIXED in bd22f1aa78 as a documented decision: the charset is the wire's own
      permanent contract, so widening it is a wire change first, and the DDL now names the
      explicit ALTER a widening release owes.
- S7  `installLoadedFreehold` discarded the durable Hearth clock whenever the plot was held or
      absent, handing a free travel to accounts already in recovery.  FIXED in e23d2a906e.
- S8  preload's replay arm tested `hold === null` instead of `blocked()`, so a quiesced entry
      replayed a stale house as current.  FIXED in bd22f1aa78.
- S9  load_report.ts had no production caller and the server hand-built its own details,
      routing around the only bound on what may reach a log.  FIXED in e23d2a906e: the
      reporter gained its production caller and its second, uncalled log helper was deleted
      rather than left as a way past the bound.
      THE CLOSURE OVERSTATED ITSELF, corrected here rather than quietly amended. "Every
      detail comes from the reporter" was true of the two normalize arms of `classify` and
      of nothing else: the oversize byte prose, the SQL reader's unadmitted detail, the
      `wire_rev_shape` literal, the three `refuse()` details, the hearth read's detail, the
      upsert result's detail and `freeholdWriteRefusal`'s refusal detail all reached the
      warn and error ports built OUTSIDE the reporter and untested against its shape bound.
      Nothing leaked, because every one of those producers is a compile-time literal, a
      module constant or a number this process computed, but the entry in KNOWN_DETAILS
      written for the save path had no traffic at all. CLOSED PROPERLY at the persistence
      QA: the bound is exported as `boundedFreeholdDetail` and applied at the two sites
      whose producer lives outside the store, the SQL reader's stranded-slot shape is named
      in the vocabulary, and a case proves an unrecognized detail is replaced rather than
      printed.
- S10 `FREEHOLD_VISIT_POLICIES` duplicated the union with no compile-time link.  FIXED in
      e23d2a906e: both are derived from one list.
- S11 a server module was a second writer of `ctx.freeholdKeyReadyAtMs`.  FIXED in e23d2a906e:
      `mergeFreeholdKeyReadyAt` owns the forward-only rule, the map has exactly two writers,
      and a source scan over server/, net/, game/, ui/ and render/ holds that.
- S12 a preload whose handshake then failed leaked its store entry for the process lifetime.
      FIXED in 19fefbbeea: a mark-and-sweep pass on the periodic hook, two passes apart so the
      ordinary preload-then-retain window is untouched.
- S13 the `hasLive` short circuit could produce a permanently write-blocked entry, discarding a
      whole session of edits.  FIXED in bd22f1aa78: the read still happens; only the installed
      state is withheld.
- S14 the development tier grant becomes DURABLE for the first time and nothing said so.
      FIXED: its own subsection in the rollout contract, naming the blast-radius change and
      why `ALLOW_DEV_COMMANDS=1` in production is worse than it was.
- S16 the account-export pin read RAW source, so a commented-out loader kept it green.  FIXED
      in 553ab59851, and the same mutation now fails it.
- S17 the `WOC_FREEHOLD_PERSIST` gauge family had no test.  FIXED in 553ab59851 with a distinct
      value per measure, so a swapped pair fails.
- S18 the documented backwards-revision arm of `noteRevisionMoved` was untested.  FIXED in
      553ab59851; the `<=` mutant now fails two cases.
- S19 the INSERT column list was unpinned in the always-on tier.  FIXED in bd22f1aa78.
- P2-2 through P2-14 (database-performance) all applied: the entry leak (S12), the detoast
      pre-gate, per-kind load failures, `held` split from `quiesced`, the tick profiler sample
      on the housing sweep, a shorter login-path permit wait, a local write admission cap, a
      bounded leave flush, counters rather than gauges for cumulative totals, statement
      duration totals, byte total plus high-water mark, and the revision-coupling pin. P2-14
      (non-HOT updates rewriting both btrees) is RULED: recorded, no action, negligible at the
      current write rate and now halved by the P1-1 fix.

## NITS

- N1  a non-numeric version slipped past the forward-version arm.  FIXED in e23d2a906e: a
      version present but not a positive integer is malformed, so the row is preserved
      read-only rather than normalized up to a shape no release wrote.
- N2  `rev: Number(row.wireRev)` narrowed a bigint one layer above the boundary that forbids
      it.  FIXED in bd22f1aa78: it refuses instead of rounding into a fence that never existed.
- N3  `ABSENT_HEARTH_REVISION` was used for a plot hold's `durableRev`.  FIXED in 9377ed1d42.
- N4  a fractional condition clamped without rounding, so the loader and the writer disagreed.
      FIXED in 4dbddca2dc.
- N5  `placementId` and `plinth` had no magnitude bound.  FIXED by B1's codec rule, which
      admits only positional safe integers.
- N6  a plot_id unique violation was not diagnosed by `upsertFreehold`.  FIXED in bd22f1aa78,
      with a contrast arm proving no other database error is swallowed.
- N7  the deliberate empty-id admission had no fixture.  FIXED in 553ab59851, with its
      one-character-over contrast so the admission is not a missing check.
- N8  the unserializable arm of `persistedFreeholdBytes` was untested.  FIXED in 553ab59851.
- N9  the `drainWaiters` Set's stated concurrency reason was untested.  FIXED in 553ab59851.
- N10 the synchronous enqueue-throw catch arm was untested.  FIXED in 553ab59851.
- N11 `oldestDirtyAgeMs`'s "oldest" semantics was unpinned.  FIXED in 553ab59851 with two dirty
      entries six seconds apart.
- N12 `requireUpsertInput` did not bound the two lengths the DDL CHECKs.  FIXED in bd22f1aa78.
- N13 a thrown database error did not quiesce, so the sweep could retry it forever.  FIXED in
      bd22f1aa78 after a bounded run of thrown writes, with the run reset on any commit so a
      blip never accumulates.
- N14 an internal account id reached a hearth console line.  FIXED in bd22f1aa78: every hearth
      detail classifies, never identifies.
- N15 the barrel gained 15 names with one barrel consumer.  FIXED in e23d2a906e: the durable
      persistence vocabulary is server-facing and imported by path.
- N16 `plotId` is presentation-only and must never gate sim behavior.  FIXED: stated on the
      type itself.
- N17 the join-path retain was not inside a try/finally.  FIXED in e23d2a906e.
- N18 `advanceFreeholdHearthOnClient` has no production caller.  FIXED: the contract now
      carries the marker, and says why the pair is still the capability it names.
- N19 `meta.freehold` was read off a spread bag with no structural guard.  FIXED in e23d2a906e.
- N20 a write-blocked hold is invisible to the player.  RECORDED as a deliberate gap in the
      rollout contract, owed by the release that lights housing up: there is nowhere to put a
      message while the housing UI is dark, and an operator watching the `held` measure is the
      only observer this release has.
- Nit-15 (database-performance) a hearth constant stood in for a plot revision. Same as N3.

## FIX-ROUND FINDINGS (the fresh lane, which read the fix round as unreviewed code)

Five reviewers read `b2aeb46da2..f5dd9a3a44` and found three ways a real house could
still be lost. All three are closed in 23ffc92983 and e4b029d65d, and the terminal
state they share is now a counter rather than something only reading finds.

- X1 BLOCKING (security). The hasLive-but-not-loaded read widened a window in which a
  freshly seeded default could be compare-and-swapped over a real row. A leave drops
  the store entry while the sim record is still live, so a rejoin landing between them
  reads the row, learns a durable revision, and is handed a default once the old
  session's removePlayer evicts. Because the CAS never touches plot_id, the loss left
  the identity intact and was invisible in the key. FIXED: a write refuses a live
  record still carrying the unassigned plot id when the entry has a durable revision,
  or one whose identity is not the one the entry loaded.
- X2 BLOCKING (security, database-performance). A write deferred by the local cap, or
  one whose leave deadline expired, ran after eviction, serialized to null and wrote
  nothing: the leaving session's last edits were silently gone, with no counter.
  Reproduced by the database reviewer at both arms. FIXED: the document is captured
  before the wait.
- X3 BLOCKING (database-performance). The first fix for X2 cleared that capture at the
  top of `settle`, so a RE-ARMED write inherited nothing and lost the last edit anyway.
  FIXED: the clear moved to the non-rearm branch, and its own lifetime is pinned by a
  test proved decisive by removing it.
- X4 BLOCKING (architecture, tests). `freeholdWriteRefusal` enforced only the three
  ceilings while the loader had gained the positional-number codec rule, so eight
  document classes were writable and unreadable. FIXED: the save path runs the same row
  predicates and the same identity sets, through a new `identitySets()` port so the two
  cannot be declared twice and drift. A property test over eleven document classes
  replaced the three named cases.
- X5 BLOCKING (architecture, tests). The two removal paths disagreed about what counts
  as owing work; either disagreement drops a save. FIXED: one `owesWork` predicate, and
  a blocked entry is collected rather than kept forever.
- X6 BLOCKING (tests). `revFromBigintText` had no coverage AND its comment was wrong:
  normalizeFreehold REPAIRS an out-of-range revision to zero, so a row whose wire_rev
  outgrew a JS number loaded writable at zero and the next save wrote that zero over
  the larger stored value. FIXED: such a row is HELD.
- X7 BLOCKING (database-performance). `FREEHOLD_STORED_DETOAST_GATE_BYTES` was
  calibrated from `pg_column_size` on an UNSTORED expression, which reports the
  uncompressed datum, not what the gate reads. Every number in its comment was wrong
  and the gate did not catch the case the comment cited. FIXED: re-measured against a
  stored column (2199 for the maximal record, 32827 incompressible, 97932 uncompressed
  ceiling), lowered to 131072, and pinned by an on-disk calibration arm that the
  existing incompressible-fixture test could never have caught.
- X8 BLOCKING (tests). The constants pin omitted the three constants this work added,
  and every other use of them was a self-comparison. FIXED: literals for all ten.
- X9 BLOCKING (tests). Nothing pinned WHICH permit budget the login path spends; the
  refusal message names the number either way. FIXED: the test reads the deadline off
  the AbortSignal the store handed the gate.
- X10 SHOULD-FIX (database-performance). The measure expression was rendered about 2.6
  times per row because the planner inlines the LATERAL into three output expressions.
  FIXED: an `OFFSET 0` optimization barrier, measured 35.4 ms to 13.7 ms at 4.88 MB.
- X11 SHOULD-FIX (database-performance). The orphan sweep could collect an entry a live
  handshake still needed, leaving `retain` to yield a permanently write-blocked entry
  with no hold, no counter and no log. FIXED: `retain` re-reads when it finds an entry
  that is not loaded.
- X12 SHOULD-FIX (security). A thrown write counted toward the quiesce run forever, so
  three blips hours apart quiesced a healthy owner. FIXED: a five-minute window.
- X13 SHOULD-FIX (security). `ports.error(msg, err)` printed the whole pg error, and a
  23514 puts `Failing row contains (...)` in `detail`. FIXED: code, constraint and
  message only.
- X14 SHOULD-FIX (architecture, tests). The hearth-clock source scan omitted `src/sim`
  and `headless`, so a third writer added inside the sim would have passed both arms of
  a describe titled "exactly two writers, both in the sim". FIXED.
- X15 SHOULD-FIX (architecture). `server/game.ts` sat 63 lines under its ceiling after
  the extraction. FIXED: both ceilings lowered to the measured counts (9920, 4605).
- X16 SHOULD-FIX (architecture, tests). `installLoadedFreehold`'s two structural guards
  were coupled, so a malformed clock also skipped the plot. FIXED: independent, and the
  skip is now safe because X1's identity seal refuses the write it used to enable.
- X17 NITS, all applied: the misleading `finiteNumber` alias, the over-permissive
  version detail shape, the wire-cadence module's widened export surface, the missing
  barrel note for the hearth clock's second writer, the general (not fixture-specific)
  stored-ceiling margin now pinned as arithmetic, the unfiltered `pg_tables` assertion
  that flaked under a concurrent tenant, the metrics negative pin with no positive
  control, the `schema_version` validator disagreeing with its INT column, the
  re-entrant deferred pump, and the two constants the implementation never read.
- X18 RULED, no change warranted: two clauses cannot be isolated by any behaviour test
  because they sit behind a same-state filter (`drainCheck`'s deferred check, and the
  deferred clause in `owesWork`). Both are kept with a comment saying they are equal to
  their neighbours only by today's arithmetic. The non-HOT update cost of a plot save
  is recorded and negligible, and `freeholdsForExport`'s missing bound is pre-existing
  and out of this scope.

## SECOND FIX-ROUND FINDINGS (the fresh lane read its own predecessor)

The first fix round was itself reviewed, and one of its fixes had introduced a defect
worse than the one it closed. That is the reason the rule exists.

- Y1 BLOCKING (correctness, independently reproduced). The identity seal added for X1
  quiesced EVERY BRAND-NEW ACCOUNT on its second write. An absent-row account's first
  write is insert-only and correct; afterwards the entry held a durable revision while
  the live record still carried the unassigned plot id, so the seal fired on the very
  next save and every later edit of that first session was dropped with a misleading
  "the live record is not the record this entry loaded". Found by the implementer and
  confirmed independently by a reviewer reproducing it against the same commit.
  FIXED AT THE TIME across 23ffc92983 (the identity seal) and 2f298c24a1 (the sim-side
  stamp and its tests) by the correction both arrived at: the entry records the document as
  ACTUALLY WRITTEN, and a new sanctioned sim writer `stampFreeholdPlotId` teaches the
  live record the same identity, so the row, the entry and the record agree from the
  first insert.
  HISTORY, NOT CURRENT. `stampFreeholdPlotId` was deleted in round seven (4733572c0a),
  because W4 showed the stamp lands on whatever record exists at COMMIT time. Y1's own
  failure then came back on a different path and is closed differently in round nine; see
  V2 below.
- Y2 SHOULD-FIX (hot path). The shutdown drain's deadline had never been derived against
  the write cap: at four concurrent writes and a ten millisecond statement it covers
  about four thousand owners, and five thousand dirty owners left 1,584 unwritten.
  FIXED: the drain runs at its own cap, since it is the one moment nothing else contends
  for the shared gate, and the two constants are documented as the pair they are.
  Re-measured by the reviewer at 6,944 ms for five thousand.
- Y3 SHOULD-FIX (hot path). The leave flush returned in milliseconds under a mass
  disconnect, spending none of its budget, because a deferred entry has no chain and a
  null chain read as "nothing to wait for". A reserve alone did not fix it (it raised
  writes issued from 8 to 10 out of 1000). FIXED: the wait observes the deferred set.
- Y4 SHOULD-FIX (hot path). `utf8ByteLength` was a hand-rolled per-character loop whose
  comment justified counting over encoding to avoid allocating a second copy. Measured,
  that was backwards: twelve times slower than TextEncoder for a byte-identical answer,
  and 36 percent of every write's codec cost. FIXED, and its pin, which compared an
  encode against an encode, now carries a literal too.
- Y5 SHOULD-FIX (hot path). The eager leave capture retains about 66 MiB per thousand
  furnished leavers. The retention is required for correctness, so it is BOUNDED AND
  PUBLISHED rather than removed: the worst case is stated where the field is declared
  and `leave_captures` is a series.
- Y6 SHOULD-FIX (qa-checklist). The occupancy gauge called `entries` "loaded entries",
  and it is not: a join creates a reference-only entry before any read, so on a realm
  with housing disabled that number tracks online accounts and nothing else. FIXED:
  `loaded` is its own measure, zero on a dark realm however many entries exist.
- Y7 NITS, all applied: the metrics scrape read the store once per family rather than
  once per scrape; the orphan sweep copied the entry map every pass; `pumpLoop`'s skip
  arm left a dropped entry for the sweep instead of removing it; two comment anchors
  still named the cadence table's vacated home; the held and quiesced measures are
  counted independently and must not be summed; and the entry map's time-based eviction
  has no size bound, which is recorded with the seam that would provide one.
- Y8 SELF-FOUND while acting on Y6's neighbour: the lost-entry reload added in the first
  round would have issued a durable read per join ON A DARK REALM, where the join path's
  own preload is gated. FIXED in 97011ac1c7 before any reviewer reached it.

## THIRD FIX-ROUND FINDINGS (the second round was read the same way, and had the same result)

Two rounds in a row had introduced a defect worse than one they closed, so the second
was reviewed on that assumption. It had.

- Z1 SHOULD-FIX, blocking-adjacent (correctness). The leave capture was cleared on ANY
  non-rearm settle, and the null-permit arm of a write returns false WITHOUT quiescing,
  so an entry could settle uncommitted, unblocked and still dirty with its capture
  dropped. The next sweep then re-armed a write whose record removePlayer had already
  evicted, and the leaving session's edits were gone for good. Gate saturation is the
  single condition that produces both that timeout and the deferral the capture was
  built for, so the two arms are adjacent rather than exotic. FIXED: the capture
  survives while the entry still owes the write.
- Z2 SHOULD-FIX (correctness, claim scope). "A live record always wins" was not the
  right rule: a rejoin inside the deferral window reinstalls the entry's last COMMITTED
  state, which is the pre-leave revision, so the leaving session's edits were silently
  rolled back to it. FIXED AT THE TIME by a revision comparison, which W1 below then showed
  to be wrong and replaced; the rule now is that the live record wins whenever there is one
  and the leaver's edits are preserved by handing the capture to the rejoin. Historical:
  the newer document wins, with the live record winning ties,
  which keeps the original guarantee that a capture cannot shadow a later edit. The
  first test written for this was NOT decisive (the write sampled before the rejoin);
  it was rebuilt around a held permit and then killed the mutant.
- Z3 SHOULD-FIX (correctness). The write seal's plot-identity check tested the live
  record's id while the row received `entry.plotId`, so the one shape check underwriting
  writable-implies-readable for the identity column was validating a different value
  from the one that lands. FIXED: `runWrite` builds the document AS SENT once and every
  consumer, refusal included, reads that.
- Z4 SHOULD-FIX (correctness). `owesWork` claimed to be the one shared predicate while
  `sweepOrphans` still carried an in-flight-load guard `maybeRemove` did not, so an
  entry with a durable read in flight could still be removed and resurrected at zero
  references. That is the same "entry went missing under a live session" class that
  retain's reload repairs, seen from the other end. FIXED: the guard moved into the
  shared predicate.
- Z5 SHOULD-FIX (security). `boundedDatabaseError` was applied to throws out of this
  module's own code, discarding the stack that would name the line. FIXED: it applies
  only at the three sites where a pg error can arrive, and the docstring stops claiming
  `message` is a pure classification field.
- Z6 SHOULD-FIX (cross-platform-sync). The plot identity charset has four copies and
  only three had a pin, so widening it later would red three tests, the author would
  update three literals, and the loader would then mark every newly minted id malformed
  and write-block the account. FIXED, with refusal cases so the pin is not vacuous.
  The same reviewer's other finding, the minted id never reaching the live record, was
  closed AT THE TIME by stampFreeholdPlotId.
  HISTORY, NOT CURRENT: that stamp was deleted in round seven, so a fresh account's live
  record carries the stand-in for its whole first session again. Round nine makes that
  legal rather than reversing it, and the residual (the live plot identity differs between
  two sessions of one account for timing reasons alone) is carried as V6 below.
- Z7 NITS, all applied: a byte-ceiling comment called a measurement on one fixture a
  theoretical ceiling; an assertion that could never fail (a newline sought in
  whitespace-collapsed text) became an occurrence count; the pre-gate expression was
  spelled out twice; the reporter's vocabulary did not cover the details the writer now
  emits; a re-entrancy comment described a hazard its own latch already closed; and the
  hearth clock's documented growth was one entry per account that has USED a key, not
  one per login.
- Z8 RULED, no change: `wire_rev_shape` holding rather than repairing was flagged as a
  load-bearing CLEAN by the reviewer, since it is what stops a client-facing counter
  going backwards permanently, and it would be easy for a later reader to "simplify"
  into the loader's repair. Recorded so nobody does.

## FOURTH, FIFTH AND SIXTH FIX ROUNDS

The pattern did not stop at three. Each of these was found by a reviewer reading the round
before it, with an executed proof rather than an argument.

- W1 BLOCKING (correctness), round four. "The newer document wins" compared two revisions
  that are not on one timeline: a rejoin replay RESTARTS the record's revision from the last
  committed value, which this packet's own test establishes. Preferring the capture therefore
  discarded the REJOINING session's edits, the mirror of the bug it was written to fix.
  Reproduced: ten furnishings placed after a rejoin, then a sweep writing the pre-leave
  document over them. FIXED in 6e8e681a2b, above the contest rather than inside it: an
  outstanding capture outranks the entry's committed state AT THE JOIN, so a returning player
  is handed the house they logged out of, and the write path returns to the one rule that is
  decidable, the live record wins whenever there is one.
- W2 BLOCKING (correctness), round five. Releasing the capture at the READ was itself a
  lost-save path. The handshake reads before it takes the character lease, and five exits sit
  between them; none creates a live record, so a capture released at the read vanished with
  nothing holding the edits. The sharpest is a lease already held, because a reconnect after a
  dropped socket is the very event that produced the capture. Proved: a handshake that never
  joins, four sweeps, zero writes, four counted against the measure this module documents as
  the terminal state of every lost-save path. FIXED in 17b216b252: the handover is two-phase,
  the read offers and mutates nothing, and `retain` confirms.
- W3 BLOCKING (correctness), round five's own fix. `hasLive` confirms A record, not THIS one.
  `installLoadedFreehold` has four early returns and `loadFreehold` is load-once on top of
  them, while `retain` runs on every join and knows none of it; the reachable case is the
  same-account character swap, where the record `retain` sees belongs to the previous session
  and removePlayer is allowed to evict it afterwards. FIXED in 91d93d1f95 by comparing the
  live revision to the captured one, which fails closed.
- W4 BLOCKING (correctness), round six, the sixth distinct path to a lost house. The plot-id
  stamp lands on whatever record exists at COMMIT time, not the record the write came from. A
  write serving from its capture runs after eviction, and a join landing inside its round trip
  seeds a default; stamping there gives the empty default the row's durable identity, which is
  the only discriminator the write seal has. The seal then stops firing and the next sweep
  writes an empty tier-0 Inn Room over a real house, with the plot identity unchanged and
  every counter reading healthy. FIXED AT THE TIME in 45f7d41508 by stamping only a document
  that came from the live record. The reviewer's alternative guard was rejected on their own
  advice: it closes this path but would quiesce a healthy brand-new account.
  HISTORY, NOT CURRENT: rounds seven and eight removed the stamp altogether and replaced it
  with a pristine-record test, and round nine replaced that in turn. See V1 and V2.
- W5 SHOULD-FIX, round four. `leave_captures` never returned to zero, because a second leave
  over a surviving capture held one document and counted two. It is the only stated bound on a
  measured 66 MiB retention, and a bound that cannot read zero is not one. FIXED.
- W6 SHOULD-FIX, round four. The capture was cleared on any non-rearm settle, and the
  null-permit arm returns false WITHOUT quiescing, so an entry could settle uncommitted,
  unblocked and still dirty with its capture gone. FIXED: it survives while the entry owes the
  write.
- W7 SHOULD-FIX, rounds four and five: the write seal validated the live record's identity
  while the row received a different one; the in-flight-load guard was on one removal path
  only; the bounded error wrapper was applied to this module's own programming errors,
  discarding their stacks; and the plot-identity charset's fourth copy had no pin. All FIXED.
- W8 PROCESS, recorded because it is the finding that matters most. Two of the tests written
  for these fixes were NOT decisive until a mutation pass showed they passed against the
  mutant, and the harness itself modelled an impossible state (its two liveness ports could
  disagree, where the server reads one map). A green suite proved nothing here on five
  separate occasions. Every guard in this subsystem is now mutation-checked in both
  directions, and the ones no behaviour test can isolate say so instead of pretending.

## ROUNDS SEVEN, EIGHT AND NINE

Rounds seven (`4733572c0a`) and eight (`7269da3a5d`) landed after the section above was
written and were not folded into it, which is why three entries there described a deleted
function as the live fix. Round nine is a VERIFICATION session's own fix round: it was
dispatched to find a defect rather than to confirm the work, and it found two.

- V0 PROCESS, recorded first because it is what the rest of this section rests on.
  Round seven deleted `stampFreeholdPlotId` and the `stampPlotId` port; round eight added
  the pristine-record test. Neither round updated this ledger, so Y1, Z6 and W4 asserted a
  reverted mechanism for two commits, and the header still said six rounds with the sixth
  unreviewed while the tip carried eight. For a packet whose control mechanism IS a record
  that is corrected rather than quietly amended, that is the failure the record exists to
  prevent. Independently reported by the architecture reviewer in round nine.

- V1 BLOCKING (correctness), round nine, the SEVENTH distinct path to an empty default
  landing on a real house. Round eight's pristine test closes the blind window only while
  the reseeded record is UNTOUCHED. A seed stops being pristine the instant the returning
  player does anything: one tier grant today, one furnishing once that writer lands. The
  record is then a stand-in identity at revision one standing against an entry that
  committed revision seven, both of the seal's tests pass, and the empty default is
  compare-and-swapped over the real house with `plot_id` untouched and no counter moving.
  REPRODUCED against the real store before the fix: three writes where two were correct,
  the third carrying `layoutJson` `[]` at `wireRev` 1 against `expectedDurableRev` 2, over
  a row holding a cottage with a furnishing, a trophy, condition 91 and policy friends at
  revision 7. No error line, no counter.
  FIXED in 9468d374d9 by a third test: under the stand-in identity, a live revision
  strictly BELOW the entry's last committed one is a different record. That is decidable
  where "newer" is not, because every sanctioned writer only increments and every install
  the store offers a rejoin carries at least the committed revision.
  Reachability today is dev-grant-only, because `setFreeholdTier` is the one live-record
  mutator this release ships. It becomes ordinary the moment the furnishing writer lands,
  and the code comment claimed the window was closed.

- V2 BLOCKING (correctness), round nine, the MIRROR of V1 and a live defect of its own.
  Since round seven deleted the stamp, nothing teaches a live record its minted name, so a
  first-session record carries the stand-in for as long as it lives. If that account's
  store entry is dropped and RE-READ from the row it just inserted (`retain`'s lost-entry
  reload after an orphan sweep or a same-account leave, or a second character joining on
  `preload`'s already-live-but-unloaded arm), `entry.state` comes back holding the ROW's
  minted name while the same live record still holds the stand-in. The names differ, the
  seal fires, and the account is write-blocked for the rest of its session with a
  misleading "the live record is not the record this entry loaded". This is Y1's own
  failure, moved from the commit path to the row-read path by round seven.
  Found by the test-coverage reviewer and REPRODUCED independently against the real store
  (`quiesced: 1`, one error line, every later edit discarded).
  FIXED in 9468d374d9: a stand-in is the ABSENCE of a name, not a different one, so the
  name comparison is skipped for it and continuity decides instead. A record carrying any
  other name is still refused outright.

- V3 SHOULD-FIX (correctness), round nine's own change, caught by its own control. Hoisting
  the identity comparison out of `seededOverReal`'s `&&` chain into a named constant took
  it out from behind `entry.state !== null`, so an entry with no cached state would have
  dereferenced null on every account's first write. It did not fire only because such a
  record always carries the stand-in and the other conjunct short-circuits first, which is
  a coincidence of another rule rather than a guard. Found by a no-op mutation control
  whose 36 unexplained failures did not match the mutant applied. FIXED in the same commit.
  Recorded because the control is the only reason it was seen.

- V4 SHOULD-FIX (correctness), round nine. The shutdown drain armed on `isDirty` alone,
  while the periodic sweep and the leave flush both probe the live revision first, and the
  revision probe is the ONLY dirty detector with a production caller in this release. The
  drain therefore could not see an edit at all. It was correct only by the shutdown
  ORDERING in `server/main.ts`, which is a property of another file. Found independently by
  the database-performance reviewer (P2-6). FIXED in 9468d374d9, one expression, pinned.

- V5 SHOULD-FIX (simplification with a correctness edge), round nine. Once V2's exemption
  landed, `applyWriteResult`'s second cached identity became unobservable: caching the live
  record's name instead of the row's no longer changes any outcome, and a mutation pass
  confirms it (the mutant that swaps them survives the whole suite). The dual-identity
  model is what rounds six, seven and eight fought over, and an axis no test can
  distinguish is one a later reader reasons from wrongly. REMOVED in 9468d374d9: the entry
  caches one identity, the document as sent.

- V6 SHOULD-FIX, carried NOT fixed, and named rather than deferred anonymously. A fresh
  account's live plot identity is the stand-in for its whole first session and the row's
  minted id afterwards, so the same account's live record answers to two different names
  across two sessions for timing reasons alone. The wire is dark, `freeholdDescriptorFor`
  has no production caller, and `account_freeholds` declares a UNIQUE `plot_id` precisely
  because a client echoes it back, so 08a inherits this. Owed by the release that publishes
  the descriptor.

- V7 SHOULD-FIX, applied. The revision-coupling source scan that BOTH the sweep and now the
  seal depend on read only `state.ts`, while the eight bodies reserved for the furnishing
  writers sit in `commands.ts`. A mutator landing where the next one is going to land bumped
  no revision and was invisible to the only detector this release ships. Widened to the
  directory in e70164a57c and proved by planting one.

- V8 SHOULD-FIX, applied. Neither byte ceiling's DEFAULT was pinned: every assertion in the
  case that names them used a document under both ceilings, so swapping the writer's or the
  loader's default to the wider stored bound left the suite green. The loader's default is
  the only thing between an over-canonical row and a record this realm could write and never
  read back. Pinned in 8ad29098f4 against a record that sits between the two ceilings, which
  is constructible only because an identifier is bounded by LENGTH and not by bytes.

- V9 NITS, applied: the by-kind metric keyed its series on the producer's own map rather
  than a declared vocabulary (so an identity-keyed tally reached the scrape) and its scrape
  memo was keyed on nothing; the hearth module skipped the account-id guard its sibling
  runs on every entry point; the exponent docblock in `persisted.ts` carried a measurement
  that contradicted the same file's other docblock, and the wrong one was the one the
  re-measure commit missed; the visit-policy vocabulary was on the directory barrel with no
  barrel consumer; the by-path imports of `state.ts` carried no reason; DEPLOY.md and
  `.env.example` said the account cascade was the only removal path without saying that the
  player-facing account removal is a soft delete that fires no cascade, and neither warned
  that a dev tier grant is now durable.

- V10 TEST QUALITY, applied. Three cases were inert for their own claims and a mutation
  pass proved it: the fresh-account capture case asserted only on a store that had attempted
  nothing (both mutants it was written against left it green), the queued-then-held case
  named `runWrite`'s post-queue re-check while actually pinning `settle`'s re-arm gate, and
  the two ceiling-default cases are V8. The first two are repaired or retitled to what they
  actually prove.

- V11 RULED, no change, each verified by mutation rather than asserted. Three clauses of
  `owesWork` (`running`, `pending`, the deferred set) are redundant under today's arming
  rules, not one as the comment claimed. `runWrite`'s post-queue `blocked()` re-check is
  the middle of three layers of one gate and nothing outside a write result can block an
  entry, so no behaviour test isolates it; removing ALL THREE layers does fail the suite,
  and each of the outer two is now pinned on its own. The mint-once guard on the absent
  arm cannot be reached twice for one entry. The layout, trophies, tier, condition and
  visit-policy dimensions of the seal's second test need a record carrying content at
  revision zero, which no sanctioned writer produces; they are kept for totality over the
  persisted shape and are the net under the one coupling the third test cannot check for
  itself. Every one of these now says so in the source instead of reading as a live guard.

- V12 CARRIED, NOT FIXED, and each named with its reviewer and its measurement. These are
  behaviour or policy changes to a bounded store, in a file where eight of nine rounds
  introduced a defect, and they are recorded in the rollout contract as named release gates
  rather than attempted at the end of a verification session:
  * an admission-class load refusal (the local cap full, or no permit inside the login
    bound) is recorded as a TERMINAL hold, so a capacity blip becomes a session-long
    housing outage for that account and `retain`'s repair arm cannot reach it, because
    `holdResult` has already set `loaded`. Measured by the database reviewer: with the
    shared gate saturated, 8 of 8 logins at 1 join/s were refused, and a lone re-join for a
    refused account still replayed the hold.
  * the load cap (4) and the write cap (4) are independent and sum past the shared gate's
    capacity of 7; the store was measured holding 7 of 7 permits with other named producers
    queued behind it.
  * a dirty entry with no live record and no capture re-arms every sweep forever and is
    never collected (12 sweeps, 12 permits, `writesWithoutRecord` 1 to 13). No production
    sequence reaching that state was named by anyone.
  * under a sustained permit refusal the entry map's stated TIME bound does not apply at
    all, because `owesWork` is what suspends it; measured at 96 MiB per 5,000 owners at the
    shipped ceiling and 660 MiB at the approved one.
  * the leave reserve is two slots in total rather than two per leaver: with 296 background
    writes deferred, 98 of 100 simultaneous leave flushes hit the full 2,000 ms deadline
    with the write unlanded.
  * the login read path inherits the 15,000 ms pool statement timeout, three times the
    deliberately short permit bound, on a handshake with no deadline of its own.
  * the subject-access export read carries no LIMIT and no byte gate, while the account
    read's `LIMIT 2` is justified against exactly that hazard.
  * four distinct load-failure causes all report `unadmitted`, which is the discrimination
    the metric's own help text promises.
  * the write path serializes each document twice (the refusal's byte measure, then the two
    columns), measured at 0.225 ms per save at the 420-row ceiling, and none of that codec
    cost reaches a counter.
  * `entry.state` is a SECOND full copy of every online owner's house and a leaving owner
    briefly holds a third, measured at 10,051 bytes per copy at the shipped ceiling and
    69,452 at the approved one. Only the capture is documented today.

## ROUND TEN: THE VERIFICATION SESSION'S OWN FIX ROUND WAS REVIEWED, AND IT HAD DONE IT AGAIN

Round nine was dispatched to two FRESH reviewers on the standing assumption that a fix
round is unreviewed code. Both found real defects in it, and one of them was the same
class the round existed to close. Eight of nine became nine of ten.

- U1 BLOCKING (correctness), found by the fresh architecture review with an executed A/B
  against the baseline. Round nine's stand-in EXEMPTION was a data-loss hole of its own.
  Skipping the name comparison for a record carrying the stand-in identity left only the
  continuity tests, and those catch a seed whose revision is BELOW the entry's. A
  returning player needs only `entry.state.rev + 1` edits inside one sweep interval to
  carry it above, at which point nothing refuses: measured, a row at wire revision 2
  holding a chair and a trophy, against a fresh default at revision 3, was written as
  `layoutJson '[]'` at `wireRev` 3 with `quiesced: 0` and no error. THE SAME SCENARIO AT
  THE BASELINE REFUSED IT, so this was a regression round nine introduced, not a hole it
  inherited. Round nine's own new case models one edit on the seed, which is the regressed
  side; it never models the seed catching up.
  REVERTED rather than patched a fourth time. The name comparison is total again, and the
  case the reviewer executed is now pinned, along with the revert itself in both
  directions: re-applying the exemption fails two cases, and re-applying the identity
  simplification below fails nine.
- U2 SHOULD-FIX (correctness), same review. Round nine's removal of the entry's second
  cached identity was NOT unobservable: `entry.state` is also what `offerCapture` hands a
  rejoin, and `installLoadedFreehold` sets the live record's identity from that document,
  so caching the row's name there teaches the sim a different name on every replay.
  Measured A/B on one fresh account: the replay handed the sim `plot:minted1` at HEAD and
  `plot:unassigned` at the baseline. That is a cross-host behaviour change wearing a
  simplification's clothes, and two comments landed asserting it was not observable.
  REVERTED, with the reason recorded where the field is assigned.
- U3 THE TRADE, recorded because it is a decision and not an oversight. Reverting the
  exemption REOPENS V2, the fresh account whose entry re-reads its own row and is
  write-blocked for the session. That is the honest trade: refusing a write costs one
  session's edits, admitting a seed costs the house, and the row survives either way.
  V2 is now PINNED AS IT BEHAVES, in a case named KNOWN DEFECT, so a future fix flips a
  red test rather than discovering the behaviour. It is carried as a named gate, and its
  actual fix is to teach the live record its minted identity AT INSTALL. That is a design
  decision for the maintainer: it is what `stampFreeholdPlotId` did, W4 showed stamping at
  COMMIT time is wrong, and stamping at install is a different change with a different
  argument. It is not a fourth heuristic in one boolean expression, which is what the last
  four rounds have each tried.
- U4 SHOULD-FIX, applied. Round nine ruled the pristine arm and its non-revision
  dimensions unpinnable on the premise that no sanctioned writer produces content at
  revision zero. The premise was wrong twice over: `entry.state` on that path comes from a
  durable ROW, which is untrusted external input, and tier, condition and visit policy are
  not content at all, so a default change makes a rev-zero difference ordinary. The
  correct statement, which is what the source now carries, is that they are dead while the
  name comparison is TOTAL and become load-bearing the moment it is narrowed, which is
  exactly what round nine did.
- U5 SHOULD-FIX, applied, found by the fresh test audit. A case added in round nine
  modelled an impossible state: its row reader answered `absent` unconditionally, so after
  a confirmed insert the store re-read the same account, found no row, fenced insert-only a
  SECOND time and minted two identities for one account. With `entry.durableRev` null the
  seal is structurally disarmed, so the case could never reach the arm it was named for.
  The reader now returns the inserted row, and the case is retitled to the capture claim
  its first half actually proves.
- U6 SHOULD-FIX, applied. The leave-capture case pinned the GAUGE and not the retained
  DOCUMENT, and the two are separable: a second leave that kept the stale capture reads
  one on the gauge at every assertion while discarding the second session's edits. A
  sibling case now asserts the write carries the SECOND session's revision.
- U7 SHOULD-FIX, applied. Two guards this session added had no test at all: the hearth
  account-id refusal at both entry points (removing both left 208 tests green) and the
  scrape memo's source key. Both are pinned now, the memo with the two-registry case the
  reviewer wrote.
- U8 NITS, applied. A "positive control" added this session controlled nothing (it
  appended a literal containing the token it then searched for, so it was true for any
  input) and is replaced by an assertion on the emitted line count; the widened directory
  scan's size floor was 20 against an actual 43, loose enough to survive losing half the
  directory; the hearth guard was inserted between another function's docblock and its
  function; and the directory CLAUDE.md's barrel rule did not mention the by-path
  exception this session widened.
- U9 RULINGS VERIFIED, by the reviewers rather than by their author. Every "no behaviour
  test can isolate this" claim round nine added was independently re-tested and holds:
  `owesWork`'s three redundant clauses (clause by clause), the mint-once guard (including
  an adversarial concurrent-preload case), and `runWrite`'s post-queue re-check (including
  a written attempt that failed to reach it). The orphan-sweep reset ruling was reached the
  same way, by two failed attempts to build the case.

## ROUND ELEVEN: THE PAIRED QA, WHICH FOUND THE EIGHTH PATH

Eleven reviewers reported (three independent readers plus migration-safety,
database-performance, privacy-security, server-hot-path, architecture, cross-platform-sync,
frontend-seam and test-coverage; the qa-checklist gate did not return). Two mutation passes
ran over the store, 40 mutants and then 13, each with a no-op control that proved the tests
executed. The eighth path was found by the correctness reader, confirmed by an adversarial
verifier that reproduced it independently, and reproduced a THIRD time by this session's own
probe written from scratch against `createFreeholdPersistStore`.

- Q1 BLOCKING, NOT FIXED, RULING OWED. THE EIGHTH PATH. For an entry that MINTED its own
  row, the seal's name comparison is inert BY VALUE EQUALITY: `applyWriteResult` caches the
  identity the LIVE RECORD carried, nothing teaches a live record its minted name, so that
  entry's cached name IS the stand-in and a reseeded default carries the same literal. The
  two continuity arms are then the whole seal and both are revision-shaped, so a reseed
  whose revision has CAUGHT UP satisfies neither. Measured: a row holding tier cottage, one
  furnishing, one trophy, condition 91 and policy friends at wire revision 7 was
  compare-and-swapped to an empty Inn Room at wire revision 8 and again at 9, `quiesced` 0,
  `write_failures` 0, no error line, `plot_id` untouched; controls at revision 0 and 5 both
  refused. U1's revert was reasoned entirely about entries that loaded a ROW and never
  considered the entry U3 deliberately created. PINNED AS IT BEHAVES in two KNOWN DEFECT
  cases plus a contrast arm proving a row-loaded entry still refuses the identical reseed.
  The interim guard the reader proposed (judging the stand-in case by content instead of by
  revision) was REFUTED here: it write-blocks the one live-record mutator this release ships,
  because a `/dev` tier grant on a fresh empty account is a stand-in record with an empty
  layout whose tier differs from the entry's, which is the Y1 failure class again. The fix
  is the design decision C1 already owes, in the SAFE form the parity reader specified.
- Q2 SHOULD-FIX, applied. `drainCheck` was a THIRD "owes durable work" predicate and omitted
  the dirty clause, so the drain answered DRAINED with an entry left dirty and unblocked by
  the null-permit arm. Split into two questions rather than unified into one: what is still
  MOVING decides when to stop waiting, what is still UNWRITTEN decides the answer. It now
  resolves at once and answers false.
- Q3 SHOULD-FIX, applied. `pumpLoop` admitted a deferred entry at the NON-leaving cap in
  insertion order, so the leave reserve bought nothing past the first two leavers and a
  deferred leaver queued behind every background write. It now prefers a deferred entry
  holding a capture and admits it at the leaving cap. (C6's mechanism, found by the hot-path
  reader.)
- Q4 SHOULD-FIX, applied. `server/game.ts`'s leave ran its three release lines outside any
  guard while all three callers fire it with no catch, so a rejection anywhere in the
  settlement skipped the store release, the lease release and `removePlayer` permanently.
  The join's guard covered `addPlayer` alone while a dozen throwable calls sat between the
  seed and `clients.set`. Both are guarded now, PAID FOR BY EXTRACTION: the leave save and
  its retry policy and the contests a leaver forfeits moved to
  `server/leave_character_save.ts`, the join binding to
  `server/freehold_session_binding.ts`, and the coordinator's ceiling was LOWERED to 9916.
- Q5 SHOULD-FIX, applied. The revision-coupling scan the write seal rests on missed every
  mutator shape the next writer will use: an in-place row edit, an indexed write, a compound
  assignment, unshift, sort, reverse, fill, a length truncation and `Object.assign`. Its bump
  matcher accepted `const rev = state.rev` and `state.rev = 0`. Its walk saw `export function`
  only and sliced bodies from the first export, so a module head was in no body. `plotId`,
  the field the named next change writes, was not in its field list. All widened, the
  CONSTRUCTORS exemption is now pinned rather than asserted, and `bodyOf` is keyed by
  `file:name`. Proved by planting the natural `moveFurnishing` body: the scan goes red.
- Q6 SHOULD-FIX, applied. `boundedDetail` was not the bound on log content: seven of nine
  producers reached the ports without it, and the ledger recorded S9 as closed. See the
  corrected S9 entry above.
- Q7 SHOULD-FIX, applied. Three server predicates keyed the Hearth Key by a re-typed
  `'hearth_key'` literal while the sim dispatches on `use.type === 'freeholdEnter'`, so a
  second item carrying that use type would pass the dark-realm gate and the jail gate. All
  three now use `HEARTH_KEY_ITEM_ID`.
- Q8 SHOULD-FIX, applied. The account read measured and shipped the unadmitted second row in
  full; the export read had neither a LIMIT nor a byte gate. Both bounded, the export widened
  rather than copied, and proved against real PostgreSQL.
- Q9 SHOULD-FIX, applied. Four inert or gameable pins: the dark-realm wiring pin passed with
  the two ternary arms SWAPPED (executed against the real text); the drain cap was referenced
  by no test at all; the four millisecond totals were asserted only as `>= 0`, which every
  accumulation already guarantees; and the general stored-margin pin computed its wrapper
  from the MAXIMAL record, proving a 231-byte margin where the real worst case is 55.
- Q10 SHOULD-FIX, applied. The load-failure kinds, the login statement bound, the two gauge
  docblocks, `writes_without_record`'s own description, the `scheduleDeadline` "ONE timer"
  claim, preload's handover comment (which contradicted `offerCapture`'s), the stand-in
  docblock in `state.ts`, the drain-cap block that argued from the figures it contradicts,
  the metrics memo's 0.3 ms figure (about five times high), the `sim_context.ts` note telling
  a persistence loader to register a retention prune the pins FORBID, and the schema
  idempotence denylist that could not see an unguarded CREATE TABLE. All corrected.
- Q11 NITS, applied: `preload` is async so its synchronous throw is catchable; `ensureEntry`
  refuses an owner key and an account id that name different accounts; `installLoadedFreehold`
  refuses an answer that names another account; every preload arm resets the orphan grace;
  both removal paths release a retained capture and its accounting; the `persisted === null`
  arm stops owing the write; the shadowed `live` local is renamed; the two absent revisions go
  through their named constants; `mergeFreeholdKeyReadyAt` honors the dark-realm flag; the two
  bare-named housing cores are registered; the by-path import exceptions are recorded in both
  directory CLAUDE.md files; and the one en dash this branch added is gone.
- Q12 RULINGS RE-TESTED BY MUTATION, all six still hold: `owesWork`'s three redundant clauses,
  `runWrite`'s post-queue re-check, the mint-once guard, the orphan-sweep reset, and the
  seal's pristine arm and its non-revision dimensions. ONE RULING BROKE: "dead while the name
  comparison is TOTAL" rests on a premise that is false for a minted-row entry, which is Q1.
  A seventh clause was ruled rather than pinned: `entry.durableRev !== null` is equal to
  `entry.state !== null` by today's arithmetic, because all three writers set both together.

## ROUND TWELVE: THE FIX ROUND WAS READ TWICE AND HAD DONE IT AGAIN, TWICE

Two fresh reviewers read the fix round as unreviewed code, and four of the nine
audit lanes delivered late. Between them they found one regression the round
introduced and had already been caught by the gate, one it introduced and had
not, and a set of pin defects the round's own widening had not reached.

- W1 BLOCKING, caught by the GATE rather than by a reviewer. The round deleted the
  private leave-save method and four live call sites reach it through an any-cast
  accessor, which `tsc` cannot see: ten tests went red across two suites,
  including the whole money-conservation property sweep. Restored as a thin
  delegate, and the extracted module now carries the behaviour test it never had:
  the retry ladder, its backoff cap and the exhausted-retry reconciliation had no
  test that imported them at all.
- W2 SHOULD-FIX, a regression the round introduced and nothing caught. `leave()`
  guards on `session.left || !clients.has(pid)`, and BOTH of those were set inside
  the settlement, below three throwable calls, while the new `finally` runs on any
  throw out of it. A throw there tore the session's resources down while the
  session was still re-enterable, so a later leave passed the guard and ran the
  whole teardown a second time, double-releasing one retain and collecting the
  entry out from under a live sibling session. Before the round a throw there left
  everything intact. Both statements now close the guard before the window opens.
- W3 SHOULD-FIX. The export's new byte gate was the COMPRESSED pre-gate with
  nothing behind it, which that constant's own docblock twenty lines above says is
  not a bound: at the file's measured 48x ratio a row under it renders about
  6.3 MB into a request path holding one pool client. The authoritative rendered
  measure now sits behind the pre-gate exactly as the account read's does, and a
  truncated export appends a marker row instead of trailing off.
- W4 SHOULD-FIX. The join's new guard repaired two of the three resources it
  covers and left the bot tracking context held for the process lifetime; the
  leave's flush was the one unguarded statement inside the guard that exists so a
  throw cannot skip the other two; and the extraction had speculated a helper
  nothing imports. All three closed.
- W5 SHOULD-FIX, from the store lanes. A leave that found no live record DESTROYED
  the capture it was standing in for, which is the exact window the capture exists
  for. A synchronously throwing enqueue woke no settle waiter, so a parked leaver
  spent its whole deadline on a write that had already finished failing. Closing
  intake retired the ORPHAN SWEEP with it, because the sweep runs inside the
  arming pass, so any store that outlives a drain loses the entries map's only
  time bound.
- W6 SHOULD-FIX. The join path read a LIVE `process.env` housing flag while the
  store's own port, both record inserters and the repair reload all read the boot
  snapshot. An in-process flip disagreed with itself in both directions: raised,
  two unbudgeted durable reads per login on a realm that seeds no record and can
  never write; lowered, every joining account silently write-blocked into
  `quiesced`, which DEPLOY.md tells an operator to read as a second realm writing
  the same rows. One source now.
- W7 SHOULD-FIX, the pin defects the round's own widening did not reach. A body
  slice ran to the NEXT export, so an exempted constructor exempted every private
  helper after it, including `cloneFreeholdState`, which runs on every load and
  every serialize; proved by planting a durable write there and watching the scan
  go red. The walk did not recurse, so a module under a subdirectory was invisible.
  The exported-body floor tolerated losing three single-export files. The record
  map had no sole-writer scan despite its header claiming one. The i18n drift guard
  enumerated nine of fifteen modules by hand, including neither refusal-decision
  module. The catch pin was satisfied by a release moved OUT of the catch, which
  would release on every SUCCESSFUL join. The hearth advance pinned its SET list
  from one side only. Two negative key scans had no control that the walker walks.
  One case's title named an assertion its body never made.
- W8 RECORDED, not taken. Deriving the harness's `hasLive` from `serialize` is the
  right shape and reds four cases that model a COLD join with the default
  document, which would have to be rewritten to keep saying what they say. That is
  a suite-wide change rather than a fix, and the gap is now BOUNDED in the harness
  instead: exactly one production decision reads `hasLive`, five cases model the
  combination the server cannot produce, and no conclusion is falsified by it.

## ROUND THIRTEEN: THE LATE REVIEWER'S TAIL, AND A MEASUREMENT THAT REFUTED ITS OWN DOCBLOCK

The fresh reviewer of round twelve's fix delivered its findings in pieces. Three
landed after that round had closed, and all three were real.

- X1 SHOULD-FIX. Round twelve bounded the two login reads by wrapping EACH in
  `runWithStatementTimeout`, which is a transaction helper, not a timeout
  decorator: `pool.connect`, `BEGIN`, `SET LOCAL`, the statement, `COMMIT`. The
  right bound was bought at four times the network cost, on the one path where a
  player is waiting: eight round trips on two checked-out clients, each held
  across four statements. Closed with an optional combined `readDurables` port
  bound to ONE wrapper over both statements, five round trips on one client. The
  two-port `readRow` / `readHearth` pair stays as the fallback for a host with no
  transaction seam. IT IS ALSO THE ARM EVERY UNIT TEST DRIVES, so the production
  arm is covered only by the real-PostgreSQL evidence in X3; that asymmetry is
  named here rather than left for a later reader to discover.
- X2 NIT AS FILED, PAID AS A DEFECT. The reviewer noticed the coordinator's
  monolith ceiling had gone 9920 to 9916 and back to 9920 inside this packet,
  with the last commit calling 9920 "its unchanged ceiling". Traced across all
  thirteen commits, that is exactly what happened: the extraction round lowered
  the row to 9916, and the review round that followed spent those four lines
  again restoring the private leave-save delegate W1 required, then put the row
  back and recorded the raise as a non-event. Against the floor this packet had
  already set, it was a raise, and the rule forbids one whatever the inherited
  number was. Paid rather than re-recorded, in two behaviour-identical moves: the
  leave flush's swallowed rejection moved into the binding module that owns the
  retain-release pairing, and the three copies of the guild-book reconcile guard
  now route through the one private method that already existed for it, whose own
  empty check duplicated the loop it calls. The row lands at 9914, six under what
  the packet inherited and two under its own floor, and the ledger comment now
  records the whole walk including the middle.
- X3 SHOULD-FIX, found while verifying X1 rather than reported by anyone. Sharing
  one transaction across the two reads creates a failure mode neither read had
  alone: a hearth fault would abort the transaction and take the plot row with it,
  turning a clock fault into a plot HOLD and inverting the deliberate asymmetry
  (the plot fails closed, the clock fails open). The port therefore carries a
  thrown hearth read as a VALUE, not a rejection. Proved against the dev database
  rather than assumed: with the second statement failing under a caught handler,
  the first statement's already-returned rows survive, and the trailing `COMMIT`
  answers a ROLLBACK tag WITHOUT throwing, for a relation error (SQLSTATE 42P01)
  and for a statement timeout (57014) alike.
- X4 SHOULD-FIX, the same probe refuting the docblock that motivated X1. The
  constant's own comment and section 8a of the contract both asserted the
  pre-fix arithmetic and both still ASKED FOR the port-shape change that had just
  landed. Worse, `SET LOCAL statement_timeout` bounds each statement SEPARATELY at
  READ COMMITTED: two 300 ms sleeps under a 400 ms bound both completed, 612 ms
  elapsed. So the pair's bound is 2 x 2,000, not 2,000. The corrected worst case
  is 5,000 (one pool checkout) + 2 x 2,000 = 9,000 ms against a 10,000 ms
  [CORRECTED IN ROUND FIFTEEN: every figure in this entry and the next is wrong, and
  so is the premise. The handshake has no deadline of its own, because
  AUTH_TIMEOUT_MS is cleared before the database work begins; and COMMIT answers to
  neither server-side bound, measured, so the floor is 104,000 ms. See ROUND FIFTEEN.]
  handshake, down from 19,000. Nine against ten is a MARGIN, NOT A BOUND: the cap
  on the whole preload against the handshake's remaining budget still does not
  exist, so section 8a's gate is narrowed to its budget half and STAYS OPEN for
  the release.

- X5 SHOULD-FIX, found by this session while verifying X1 rather than reported.
  `readLoginPair` was written as two returns, and the combined arm normalized the
  clock payload OUTSIDE the `try` the fallback arm had. A payload that throws
  inside `normalizeHearth` therefore answered a cold clock on a host binding the
  two-port pair and HELD THE WHOLE LOGIN on a host binding the combined port,
  which write-blocks that account for the session. Which port a host binds must
  not decide that. Both shapes now run one path: the row read outside the guard,
  where its rejection still becomes a hold, and everything clock-shaped inside it.
  Pinned by driving one malformed payload through BOTH arms and comparing, and
  the pin is decisive: restoring the two-return shape reds it.
- X6 SHOULD-FIX, A SURVIVING MUTANT. The combined port had no test of any kind,
  because every case in the suite drives the fallback pair, and the composition
  root has none either because nothing imports it (it binds the real pool at
  module scope). Removing the wiring's clock swallow, which is the ONE property
  that makes a shared transaction safe, left all 180 cases green, and `tsc` stays
  silent because dropping that arm only NARROWS the value against the port's
  declared union. Closed with four behaviour cases over the combined port and
  three source pins over the binding. FOUR MUTANTS over the wiring, each against
  a proved control of `Tests 183 passed (183)`: the swallow removed (KILLED, 1
  failed), the row read swallowed too (KILLED, 1 failed), the clock read moved
  off the transaction onto the pool (KILLED, 2 failed), and one wrapper per read,
  which is the original X1 defect (KILLED, 3 failed). A first attempt at the
  third mutant did not apply, its unmutated run is NOT counted as a result, and
  it was re-run correctly.

The extraction that paid for X1: the composition root moved WHOLE to
`server/freehold_persist_wiring.ts`, taking every SQL import with it. The store
file now names its ports and nothing supplies them, which is the property that
lets a Vitest drive the whole lifecycle with no database and no GameServer. Its
row drops 2343 to 2319, twenty-four under its opening count despite seventy lines
of new logic.

## ROUND FOURTEEN: THE REVIEWS ARRIVED LATE, AND ROUND THIRTEEN HAD DONE IT AGAIN

All four fresh lanes delivered after round thirteen had been written up as
unreviewed. Every one of their findings was real, and TWO OF THEM WERE DEFECTS
ROUND THIRTEEN INTRODUCED. The pattern holds at fourteen for fourteen.

- Y1 SHOULD-FIX, the round's own regression, and the sharpest kind: THE FIX'S
  CLAIM WAS WIDER THAN ITS EVIDENCE. Round thirteen's `.catch` covered only
  `loadFreeholdHearth`'s promise, not the `COMMIT` that `runWithStatementTimeout`
  issues afterwards. The two SQLSTATEs measured (42P01, 57014) both leave the
  connection USABLE, which is exactly why COMMIT answered a ROLLBACK tag in the
  probe; the probe therefore could not see the case it was cited for. A clock
  fault that KILLS the connection (backend crash, restart, dropped socket) makes
  COMMIT reject, the helper rethrow and the port reject, so `loadOnce` answers a
  hold and the account is write-blocked FOR A FAULT IN THE CLOCK, on the one path
  the two-port pair answers with a cold clock and a normal login. Not a breach of
  the one invariant, since a hold preserves the row, but the opposite of what the
  commit and the contract said. Closed by guarding the WHOLE transaction: the row
  is captured as it is read, a later rejection with a row in hand is a thrown
  clock, a rejection with no row is rethrown so the plot still fails closed.
- Y2 SHOULD-FIX, also round thirteen's. Extracting the composition root SILENTLY
  DROPPED the statement bound off both two-port fallback ports, leaving them on
  the pool's 15,000 ms session default (the "against a 10,000 ms handshake" half of
  this sentence is CORRECTED IN ROUND FIFTEEN: there is no such handshake bound),
  while the
  new file header claimed the move changed nothing. Dead on this host, and the
  declared fallback surface every unit test drives. Both wrappers restored and
  the header corrected.
- Y3 SHOULD-FIX. `readLoginPair` branched on the hearth VALUE
  (`both.hearth ?? await ports.readHearth(...)`) rather than on which port the
  host bound, which is precisely the coupling the merge existed to remove and, on
  the real host, a second read outside the transaction. Branches on the port now.
- Y4 SHOULD-FIX, the arithmetic. 9,000 ms was never the worst case: `BEGIN` and
  `SET LOCAL` both execute BEFORE the lowered bound is in force, so they and the
  trailing `COMMIT` answer to the pool session default. The floor is 5,000 +
  2 x 15,000 + 3 x 2,000 = 41,000 ms; two transactions were about 78,000. The
  change halves it and stands, but "nine against ten is a margin" was the sentence
  used to narrow section 8a's gate, and against 41,000 there is no margin. The
  19,000 it replaced carried the same omission, so this is an older habit than the
  rewrite. Section 8a's gate is restored undiminished.
- Y5 SHOULD-FIX, three pin defects in round thirteen's own new pins. The clock
  swallow pin's window ended at `}),` which does not match `})),`, so it ran 740
  characters past the hearth read through seven later ports and an identical catch
  on any of them would have satisfied it. The fallback pin's title claimed a bound
  it never asserted, and its comment called the pair "deliberately UNBOUNDED",
  enshrining Y2 as intentional. And `flushFreeholdBinding`'s never-rejects
  property, moved into that module by round thirteen, had no pin at all: if a
  later edit drops it the rejection escapes the leave's `finally` above the lease
  release and `removePlayer`, which is invariant 1 territory. All three closed,
  and FOUR mutants over the new guards are KILLED against a proved control of
  `Tests 184 passed (184)`: the rethrow removed, the outer catch removed, the
  fallback unbound again, and the flush swallow dropped.
- Y6 SHOULD-FIX. The export row bound was pinned only as a constant and as SQL
  text, so nothing had ever inserted a twenty-first row and the truncation marker
  shipped with no executed coverage. One PostgreSQL case now inserts past the
  limit and asserts the count, the marker's shape, that it carries no plot
  identity an exporter could read as a plot, and a contrast arm one row short
  that returns no marker.
- Y7 NITS. A leftover private alias for a name that had become exported; a
  re-measurement spliced mid-sentence into a comment without rewrapping; and a
  docblock still saying "two leave-path callers" after round thirteen routed five
  sites through it.

- Y8 NITS, from the reviewer's truncated tail, which arrived after the rest was
  already applied. The clock-swallow needle carried the trailing comma of biome's
  MULTI-LINE object form, so a reformat that fitted the literal on one line would
  have turned the pin red with no behaviour change; it matches in pieces now, and
  two further mutants confirm it still dies when the catch is removed and when it
  is moved onto the row read instead. The thrown-clock case is decisive ONLY
  through its log assertion, because the normalizer falls through to the same zero
  and the same revision, so the two value assertions cannot tell a deleted
  cold-clock path from a working one; that is now written beside the line rather
  than left for a trimmer to discover. A fixture carried a stray discriminant that
  is not part of the port's shape. A comment claimed the two arms were compared
  with each other when the loop asserts fixed literals on each, which is stronger,
  and comparing them would pass if both regressed the same way. And the rollout
  contract still gave the store file's line count as a number that was already
  stale when written; it cites the ratchet row now, which is the anchor rule the
  rest of that document follows.

WHAT THE ROUND CONFIRMED rather than found. The guild-book routing HOLDS: the
callee puts `guildBookHolders.resync` and the `reconcile` counter inside the loop
over the ids it is handed, so an empty set is zero iterations and no side effect
became reachable or unreachable. The flush swallow HOLDS, because
`flushAndRelease` is declared async so no synchronous throw bypasses the attached
catch. The merged reader's fallback arm HOLDS. The four new behaviour cases are
not vacuous. Both ceilings HOLD at their lowered values.

## WHAT ROUND THIRTEEN DID NOT GET AT THE TIME, AND WHAT ARRIVED AFTERWARDS

SUPERSEDED IN PART, kept because the sequence is the point. When round thirteen
was written up, four fresh lanes had been dispatched over it and all four had
gone idle without their reports reaching this session, so it was recorded as
unreviewed and nothing was claimed. THE REPORTS THEN ARRIVED, late and in one
batch, and round fourteen above is what they found: seven findings, two of them
defects round thirteen had introduced. Two reports were still truncated mid-list
and their tails were requested; an unknown number of findings remains outstanding.

The reason for recording it this way rather than quietly folding it in: a round
that declares itself unreviewed and then turns out to have been wrong is the
ordinary case on this branch, not the exception.

WHY THAT IS NOT A FORMALITY HERE. Eleven of the thirteen rounds introduced a
defect worse than one they closed, and not one of those was caught by the round's
own green tests. Round thirteen's own X5 and X6 were found by this session
attacking its own change and by a mutant, not by the suite, which was green
throughout. The gate is green at this tip and that is where a reader should
start, not stop.

WHAT THIS ROUND SELF-CHECKED INSTEAD, stated so a later reader knows the
substitution was made and what it is worth. The guild-book routing is the highest
risk change in the round, because it touches money-conservation paths: five call
sites now share one private method whose own empty guard was deleted, and the
equivalence rests on `revertOwnGuildBookOps` iterating the ids it is handed, so an
empty set performs no revert, no `guildBookHolders.resync` and no `reconcile`
counter, exactly as the deleted guard ensured. That is a code reading plus a green
money-conservation property sweep inside the full suite. It is NOT a fresh
reviewer, and it is NOT a mutation over that path.

THE NEXT SESSION'S FIRST TASK is a fresh read of `dd4c869a2b..HEAD` by someone who
did not write it, with the guild-book routing and the combined login port first.

## THE VALIDATION THIS VERDICT RESTS ON

At tip `29b1f85307`, with `TEST_DATABASE_URL` armed from the main checkout.

- `node scripts/gate_select.mjs` exit 0, PASS, all 12 steps green. The planner FELL
  BACK to the full suite on a 1,733-path diff, so this is the deeper check rather
  than the selective one.
- Full suite: 4,218 test files passed and 1 skipped of 4,219; 63,685 tests passed,
  2 expected-fail, 28 skipped; 750.58 s.
- Real-browser suite: 51 files, 429 tests, all passed. It rewrote four PNGs under
  `docs/screenshots/`, restored with `git checkout --` and NOT committed.
- `npx tsc --noEmit` exit 0. `npm run ci:changed` exit 0 over 640 files, warnings
  only, which is the documented pre-existing debt and not this branch's.
- The two `.pg` suites, run BOTH WAYS to prove the arming rather than assert it:
  33 passed with the variable set, the same 33 skipped with it unset.
- Four mutants over `server/freehold_persist_wiring.ts`, each against a proved
  control of `Tests 183 passed (183)`, all KILLED. One earlier attempt at the third
  did not apply; its unmutated run is NOT counted as a result and it was re-run.
- Transaction semantics measured against the dev database rather than reasoned
  about: a second statement failing under a caught handler leaves the first
  statement's already-returned rows intact and the trailing COMMIT answers a
  ROLLBACK tag without throwing, for SQLSTATE 42P01 and 57014 alike; and SET LOCAL
  bounds each statement separately, two 300 ms sleeps under a 400 ms bound both
  completing in 612 ms.

A GREEN GATE IS WHERE THIS ROUND STARTED, not where it finished. The gate was green
at round twelve's tip too, and round thirteen still found six things.

## THE FOUR RULINGS: THE WORD IS GIVEN, 2026-09-10

ALL FOUR ARE DECIDED, and every one landed on the recommendation. Six further scope
decisions were settled in the same sitting and are recorded below the four. Nothing here
is implemented yet: the behaviour each ruling describes is still pinned as it currently
behaves, and the next session executes them. The evidence and the reasoning are kept
verbatim under each ruling, because a decision without its evidence is unreviewable.

### RULING 1, C1 plus C22 plus the EIGHTH PATH: teach the live record its minted identity

DECIDED: TAKE IT, in the SAFE form, AS ONE CHANGE. Steps 1 to 5 below are the executable
specification. This closes the packet's blocking finding.
1. In `installLoadedFreehold`, on the ABSENT arm ONLY (`hold === null && state === null &&
   durableRev === null`, with a `plotId` that matches the wire charset), install a default
   record carrying `loaded.plotId` through the existing `loadFreehold`. It is load-once and
   already honors the dark-realm flag, so `addPlayer`'s `ensureFreeholdRecord` then returns
   it untouched. No new sim writer, no stamp function, no post-hoc mutation, and neither
   `src/main.ts` nor `server/game.ts` is touched.
2. Do NOT stamp onto a record that is already live. That form rewrites a freshly seeded
   default's identity to the minted name, which kills the name comparison and, through
   `standInSeed`, both continuity arms at once. It is a new path to the same loss, traced by
   the parity reader.
3. In the SAME change, un-gate `revisionRegressed` from `standInSeed`: after the fix no
   online record carries the stand-in, so the revision discriminator would otherwise be dead
   for the same-account character swap. This half needs its OWN executed proof, because `rev`
   restarts from the last committed value on a rejoin replay, which is what made W1's
   revision comparison wrong.
4. Two existing pins flip with it and must be planned rather than discovered:
   `tests/server/freehold_persist.test.ts` "installs nothing for an absent load", and the
   KNOWN DEFECT cases.
5. Offline and headless are untouched, which WIDENS the host divergence from session two
   onward to session one onward: every offline world keeps the one literal stand-in while
   online identities are unique. If 08a intends `plotId` to be a key, those hosts need a
   minter of their own.
What it closes: C1, C22, V6 and the eighth path, and it makes the name comparison TOTAL for
every entry class rather than for row-loaded entries only.
Why this QA did not take it: its safe and unsafe forms differ by one line and one of them is
a new data-loss path, and its companion un-gating needs an executed proof of its own. The
alternative interim is a fourth heuristic in the same boolean expression, which is what the
last four rounds each tried, and the specific one proposed this round was refuted here
because it write-blocks the development tier grant.

### RULING 2, C2: an admission-class refusal is a TERMINAL hold

DECIDED: TAKE the reviewer's smaller correction, with the caveat this QA measured. Do not set
`loaded` for the three admission kinds (`cap_full`, `no_permit`, `read_threw`), so `retain`'s
lost-entry repair arm can re-read them; leave `unadmitted`, `unsupported`, `malformed` and
`oversize` terminal, because those are DATA causes and a repeat cannot change them. The
caveat: `entry.loaded` is also what `preload`'s replay arms and `blocked()` read, so the
change must keep the entry write-blocked while it is unrepaired. The current behaviour is
now pinned (a mutation pass showed removing the flag left 507 tests green), so the fix flips
a test rather than passing silently.

### RULING 3, C3: the entries map has no size bound

DECIDED: RECORD THE DERIVED CEILING. No cache, and therefore no eviction policy, because
an eviction policy here is a decision about whose unwritten edits may be dropped and
nothing has asked for one. The measured facts:
one ordinary sweep at five thousand dirty owners leaves 4,996 deferred and uncollectable
until their writes land, and that clears in about 14.5 seconds at the measured 345 writes per
second, inside the interval. The cliff is about ten thousand three hundred concurrently dirty
owners per sweep, which is the write cap divided by the statement latency times the autosave
period. Below it the map is self-limiting; above it nothing collects. If a hard cap is wanted
anyway, the seam the file already names is the keyed bounded cache with LRU eviction in
`server/discord_status_cache.ts`, and the decision it forces is which owner's unwritten edits
an eviction is allowed to drop.

### RULING 4, the policy half of C5: the two admission caps sum past the shared gate

DECIDED: STATE THE OVERCOMMIT AS ACCEPTED, with the arithmetic, rather than sharing one
budget. The load cap of four and the write cap of four are independent against a gate of
seven, and the store was measured holding all seven. Sharing one budget couples a login's
read to a sweep's writes, which is the coupling the two constants were split to avoid; the
honest alternative is to say in the contract that housing may hold up to seven of seven
permits in steady state and eight during a drain, and to alert on `permit_wait_ms` for the
other producers behind it. The peak-concurrency pin the database reviewer asked for should be
written against whichever answer is taken, not before.

## THE SIX SCOPE DECISIONS SETTLED WITH THE RULINGS, 2026-09-10

Decided in the same sitting, and binding on the next session in the same way.

- **C23, the player-facing surface for a write-blocked hold: SCOPED NEXT, BUILT SEPARATELY.**
  The next session designs it and writes the `t()` keys and the contract entry; a later
  session builds and captures it. The reason for the split is diff shape rather than
  priority: the identity fix touches the sim's load path and the surface touches the HUD,
  and merging them makes one reviewable change into two unreviewable halves. The next
  session's scoping output must name the exact keys, the render sink each one goes to, and
  which of the seven load-failure kinds the player is told apart, because a surface that
  says "something went wrong" for all seven is not worth a string.
- **The section 8a login budget gate: CLOSE IT.** Cap the WHOLE preload against the
  handshake's remaining budget, so an overrunning login is refused rather than joining
  behind a closed socket with a character lease taken. Lowering the statement bound instead
  was considered and rejected: it does not bound BEGIN, SET LOCAL or COMMIT, which are three
  of the five statements and answer to the pool session default, so it narrows the number
  without closing the gate.
- **Offline and headless plot identity: ACCEPT AND DOCUMENT THE DIVERGENCE.** Online mints
  unique ids; offline and headless keep the single literal stand-in. Record it in this
  contract and in `src/sim/freehold/CLAUDE.md` so the phase that makes `plotId` load-bearing
  as a key knows it must supply a minter for those hosts FIRST. No sim change now, and no
  minter improvised: anything minting ids inside `src/sim/` must draw from `Rng`, never a
  clock and never `Math.random`.
- **Review: A FRESH READ OF THE WHOLE PACKET FIRST**, `dd4c869a2b..HEAD` end to end, before
  any new code is written, with the guild-book routing and the combined login port first.
  Twelve of the fourteen rounds introduced a defect worse than one they closed and not one
  was caught by the round's own green tests, so the correct prior is that this packet is
  still wrong. The fix round that follows gets its own separate fresh review.
- **Scope: THE FOUR RULINGS PLUS THE LOGIN BUDGET GATE, THEN STOP.** C23 is scoped, not
  built. Nothing else in C1 to C23 is open: the rest is either closed in this packet or was
  a maintainer decision, and all of those are now settled.
- **Delivery: STAY LOCAL.** Commit on `feature/freeholds`, run the gate, report. No push, no
  pull request, no merge, whatever the result.

## ROUND FIFTEEN: THE WORD WAS EXECUTED, AND THE FRESH READ FOUND A BLOCKER FIRST

The four rulings and the six scope calls were executed on 2026-09-10. Before any
of that was written, the whole packet was read fresh by lanes that had not
written it, `dd4c869a2b..HEAD` end to end, with the guild-book routing and the
combined login port first, exactly as the scope call required. THAT READ FOUND
36 FINDINGS, one of them BLOCKING, and it found them in code that fourteen rounds
and a green gate had already been over. Every finding was adversarially verified
by three independent lenses (does it reproduce, is it already ruled, is the claim
wider than the evidence); 35 of 36 survived, and the one that did not is recorded
below rather than dropped.

The pattern therefore holds at fifteen for fifteen. It is worth saying plainly
what that now means: the count is not evidence that the reviewers are thorough,
it is evidence that this subsystem is not yet in a state where a round can be
trusted on its own.

### The BLOCKING one, and it was not in the store at all

- R1 BLOCKING (teardown). `settleLeavingSession` still ended with FOUR session
  REGISTRATIONS, below a final save that retries five times and a guild-book
  revert that can fault. A rejection anywhere above them ran the three releases
  in leave()'s `finally` and skipped all four, so the character was gone from
  `clients` and from the sim while `sessionsByCharacterId` STILL MAPPED IT:
  `planJoin` then answered 'character already in world' for every later login for
  the life of the process, `takeOverCharacter` found the corpse, reported
  'taken-over' and changed nothing, and every whisper, mail and party lookup kept
  resolving to the dead session and sending into a closed socket. Round eleven
  moved the three RELEASES into that `finally` for exactly this reason and left
  these behind, and the round-twelve regression that followed was the same shape
  seen from the other end. FIXED: the four move into the `finally`, ahead of the
  three awaits, identity-guarded so a same-account swap cannot evict the live
  session's own registration. PAID FOR BY EXTRACTION, `revertOwnGuildBookOps` to
  `server/guild_book_holders.ts`, and the coordinator's ceiling LOWERED to 9907.

### What else the fresh read found, all applied

- R2 SHOULD-FIX. `saveLeavingCharacter`'s "never throws" was stated in its header
  and proved with a stub that could not throw. Its one callback runs INSIDE the
  catch on the exhausted-retry arm, so a fault in the backward book replay
  rejected out of the leaving session's settlement, which is the single most
  expensive place on the leave path for a rejection to land. Guarded, and the
  extracted revert never throws either: a guild whose replay faults is logged and
  the guilds behind it are still undone.
- R3 SHOULD-FIX. `retain` cleared a returning owner's leave capture with two
  inline lines rather than through `releaseCapture`, so the entry kept its place
  in `deferredLeavers` with no capture. `nextDeferred` then answered with it on
  every admission and `pumpLoop` priced it at the NON-leaving cap, so the two
  reserved slots never reached the genuine leavers queued behind it. That is
  exactly the starvation 23d2e6741a was written to end, and it falsified
  `undefer`'s own stated invariant. A case drives it and dies when the inline
  clear comes back.
- R4 SHOULD-FIX. The MINT IS PER ENTRY, NOT PER OWNER, and ruling 1 as written
  does not fix that: an entry the orphan sweep collects between a preload and its
  retain is recreated empty, and its repair reload mints a SECOND identity while
  the record installed from the first keeps answering to the first. After ruling
  1 that is not cosmetic, it is a quiesced session. The absent arm adopts the live
  record's identity when there is one.
- R5 SHOULD-FIX. `readDurables`' outer guard captured the ROW as it was read and
  rebuilt the CLOCK from the outer error, so a COMMIT that rejected after both
  statements had answered threw away a clock it had already read and reported the
  cold one, which reads as READY. The store then remembers that zero on the entry
  and replays it to every later character of the account for the whole session
  without reading again. Both halves are captured now, and the policy moved out of
  the composition root into `readLoginDurables`, where five behaviour cases drive
  it: the root binds the real pool at module scope, so nothing imported it and
  nothing executed its closures.
- R6 SHOULD-FIX. `flushAndRelease` gave the reference back after the flush rather
  than in a `finally`, so a throw from the injected deadline scheduler, the
  serialize port or the enqueue port held it for the life of the process, with
  its one production caller swallowing the rejection that would have shown it.
- R7 SHOULD-FIX (attribution). The guild-book routing and the leave-flush swallow
  removal are in 0c48e8a3c4, NOT fbcd3298dc as the ledger and that commit's
  message both said, and 0c48e8a3c4 deleted the swallow ONE COMMIT BEFORE the
  module gained it: at exactly that commit a `flushAndRelease` rejection escapes
  leave()'s own `finally` above the lease release and `removePlayer`. HEAD was
  always correct; the defect is one commit deep and survives any bisect or
  per-commit audit. Corrected here rather than amended, because a record that
  misattributes a fix is how the next reader looks in the wrong commit.
- R8 SHOULD-FIX (docs). The published login floor of 41,000 ms contradicted the
  statement composition in its own sentence, which argued 54,000. MEASURED rather
  than argued: see the corrections section below. Both were wrong.
- R9 SHOULD-FIX (docs). DEPLOY.md told an operator to read the load-failure split
  as FOUR diagnoses and named four of the seven kinds the series emits, omitting
  the three data incidents the recovery contract exists for. All eight are named
  now, in the two groups an operator can act on.
- R10 SHOULD-FIX (docs). `state.md` named a gate run no other document records,
  22 commits behind the tip, and no recorded gate covered the last three code
  commits. Corrected with this round's own run.
- R11 SHOULD-FIX (tests). The sole-writer scan for the live record map listed
  seven roots and could not see `src/world_api`, `src/editor`, `src/admin`,
  `src/guide` or `src/main.ts`, while the claim it enforces is "the ONLY file".
  Widened to `src`, `server`, `headless` and `bot` whole.
- R12 SHOULD-FIX (tests). That scan's anti-vacuity control asserted two LITERALS
  while the scan used a REGEX, so a regex that stopped matching passed the
  offender list empty and the control still went green: it controlled the file's
  contents, not the detector. It runs the scan's own predicate now.
- R13 SHOULD-FIX (tests). The join-teardown pin read the CATCH release as inside
  its block and left the identical hole open on the FINALLY release one line
  below, under a comment naming that exact failure mode.
- R14 SHOULD-FIX (tests). The high-water-mark case drove a second write of the
  SAME size, which a last-sample gauge satisfies just as well. It drives a
  smaller write and then a larger one.
- R15 SHOULD-FIX (db). The export's on-disk pre-gate is STRICTER than its own
  authoritative rendered bound for incompressible content, so the widening is
  inert there and the row comes back with its size instead of its content on the
  owner's only readback. Recorded as a named residual with its reasoning rather
  than closed by widening the pre-gate, which would defeat what the pre-gate is
  for.
- R16 SHOULD-FIX (critic). `boundedFreeholdDetail` was added to cover the log
  routes that bypass the reporter and was wired at ONE of FOUR, while its own
  docblock recorded the whole channel as closed. That is the S9 overstatement
  again. Applied at all four, every shape they emit named in the vocabulary, and
  the omission the round-trip arm structurally cannot see is pinned separately.
- R17 SHOULD-FIX (critic). `normalizeHearthLoad` answers the COLD clock, which is
  READY, for an `unsupported` row, while `loadFreeholdHearth`'s docblock said that
  kind is what stops a damaged row granting a trip. Both files say what is true
  now: the kind buys a WARN, and refusing the trip is 07a's job.
- R18 NITS, all applied: the two upkeep JSONB columns are selected raw past both
  export bounds (safe only because the DDL holds them NULL in this build, and the
  release that writes them owes them the same treatment); `requireUpsertInput`
  did not make the refusals its own header promises for two narrow integer
  columns and two JSONB ones; `freeholdsForExport` skipped the account-id refusal
  every sibling runs; a docblock had drifted two declarations from the constant
  it describes, leaving one invariant undocumented and its neighbour wearing the
  wrong text; the export docblock stated a truncation rule the function does not
  implement and the boundary had no case; DEPLOY.md counted its alert-worthy
  series with a bare literal; a duplicated comment fragment in the capture
  handover; the by-path exception list in `src/sim/freehold/CLAUDE.md` was stale
  against two importers the same range added; `FREEHOLD_MAX_VISIT_POLICY_LENGTH`
  duplicated the column ceiling with nothing pinning them equal;
  `requireHearthAccountId`'s docblock claimed a hold the combined port can no
  longer produce; the clock-swallow pin's piecewise match dropped the one thing
  the old literal proved, that the catch RETURNS the payload carrying the error;
  the recursive module walk was contradicted by a flat directory listing beside
  it; the join's `joined = true` comment claimed a leave would run for a tail that
  is outside the guard.
- R19 REFUTED by two of three verifiers, and JUDGED HERE rather than dropped:
  "nothing executes any port closure in the wiring file". The claim is FACTUALLY
  TRUE and the verifiers refuted it as already recorded, which it is (round
  thirteen's X6 says so in as many words). It is answered in this round anyway,
  by moving the login read's POLICY out of that file into a module five behaviour
  cases drive, and by the mutation pass over the binding that remains.
- R20 REVIEWED, NO CHANGE. The join tail after the `finally` closes is outside
  the retain guard, so a synchronous throw there rejects the handshake with no
  message handler attached and nothing schedules the leave that owns the release.
  Every statement in that tail is a map write or a voided, caught promise today,
  and moving the guard would re-indent a hundred and twenty lines for a case
  nothing can currently reach. The over-claiming comment is corrected to state
  the residual instead.

### THE CLAIMS THIS ROUND REFUTED WITH A MEASUREMENT

- THE HANDSHAKE HAS NO DEADLINE OF ITS OWN, and section 8a said it does.
  `AUTH_TIMEOUT_MS` is cleared SYNCHRONOUSLY by the first-frame handler before
  `authenticateWebSocket` runs; `server/ws_auth.ts`'s own docblock states that it
  bounds upgrade-to-first-frame only, never the handshake's database work. The
  database reviewer's ORIGINAL finding (C7) said exactly this and the contract
  overwrote it with a correction that was itself wrong. The login budget gate is
  therefore closed with a STATED CEILING rather than a share of a budget that
  does not exist, and the contract says so.
- COMMIT ANSWERS TO NEITHER SERVER-SIDE BOUND. Measured on PostgreSQL 16 with a
  DEFERRABLE INITIALLY DEFERRED constraint trigger putting two seconds of work
  inside the commit itself: under `SET LOCAL statement_timeout = 300` the COMMIT
  ran 2,008 ms and COMMITTED, against a control at the session default that took
  the same 2,008 ms. A second probe on a pool built with `query_timeout: 500`
  REJECTED the same COMMIT after 501 ms with a client-side read timeout carrying
  no SQLSTATE. So COMMIT's only ceiling is `DB_QUERY_TIMEOUT_MS`, and the floor
  on the combined login read is 5,000 + 2 x 15,000 + 2 x 2,000 + 65,000 =
  104,000 ms. The published 41,000 priced COMMIT at the lowered bound and the
  prose beside it argued 54,000; the 19,000 and the 9,000 before them omitted
  five statements between them. FOUR published figures, all wrong, all in the
  same direction.
- THE DELIBERATE BACKWARDS WRITE IS RETIRED. `phase-07-qa.md` closed with "a
  record carrying a REAL plot name still goes backwards onto the row,
  deliberately", and `noteRevisionMoved`'s docblock said the same. Un-gating
  `revisionRegressed` reverses it, and it should be reversed: a live revision
  below the entry's last committed one means the live record is not the record
  that commit came from, since every install a rejoin is offered carries at least
  the committed revision and every sanctioned mutator only increments, and
  writing it walks the client-facing wire counter backwards permanently, which is
  the exact harm the loader's own `wire_rev_shape` hold refuses on the read side.
  Two pins encoded the old rule and both flip.

### WHAT THE RULINGS COST THAT THEY DID NOT SAY THEY WOULD

Ruling 1 step 4 named TWO pins that would flip. FOUR did: the two above, plus the
absent-load install case and one that modelled an established account emptying
its house at revision ZERO, which no sanctioned writer produces (every mutator
increments, so emptying a record at five leaves it at six). That fixture proved
its claim through a state the sim cannot reach; it is repaired rather than
deleted, because the claim itself is right and worth keeping.

Ruling 2's caveat held exactly as written: `entry.loaded` is also read by
`preload`'s replay arms and by `blocked()`, and an entry with a hold and no
`loaded` is blocked by both halves, so nothing writes for it while it is
unrepaired.

### THE MUTATION PASS

Every guard added or changed was mutated on disk, its owning suite run, the RED
confirmed, and the file restored by plain file write with the green re-confirmed.
Each pass ran against a no-op control first, and the control's full `Tests N
passed (N)` line is quoted in the verdict rather than summarized.

- Ruling 1, four mutants, control `Tests 196 passed (196)`, ALL KILLED: re-gating
  `revisionRegressed` behind `standInSeed` (3 failed), dropping the absent-arm
  install (1), minting unconditionally instead of adopting the live identity (1),
  and installing the stand-in instead of the minted identity (1).
- Ruling 2, two mutants, control `Tests 197 passed (197)`, BOTH KILLED: every
  hold terminal again (1 failed), and every hold retryable (1 failed). Both
  directions, because a one-way pin here is satisfied by a constant.
- The login budget, four mutants, control `Tests 201 passed (201)`, ALL KILLED:
  the cap dropped entirely (2 failed), the expiry touching the entry instead of
  leaving it alone (1), the deadline never cancelled (4), and a scheduler fault
  refusing the login instead of running uncapped (1).
- The capture bookkeeping, one mutant, control `Tests 190 passed (190)`, KILLED:
  restoring `retain`'s inline capture clear (1 failed).

## ROUND SIXTEEN: THE RULINGS ROUND WAS READ FRESH, AND IT HAD DONE IT AGAIN

Round fifteen executed the four settled rulings and was then handed to six fresh
lanes on the standing assumption that a fix round is unreviewed code. They found
30 findings, THREE of them BLOCKING, and TWO of the three were defects round
fifteen had introduced. Sixteen for sixteen.

Every finding was verified by three lenses (does it reproduce, was it
pre-existing or round-introduced, is the claim wider than the evidence). 27 of 30
survived; the three that did not are judged below rather than dropped.

### The two the round introduced

- S1 BLOCKING (teardown). Moving the four registrations into leave()'s `finally`
  meant that on a SETTLEMENT THROW a session was dropped from both guild-book
  indexes without its unflushed ops ever being reverted, because
  `reconcileOwnGuildBooks` was the settlement's last statement and a throw skips
  it. That leaves uncommitted money deltas on the LIVE book with nothing left to
  converge them: no mark for the disband guard to fail closed on, no session for
  the settle gate to count, and no session for the quarantine paths to find. The
  next officer's op on that guild then serializes the live book and commits
  deltas whose character half never landed, so one deposit becomes two, which is
  the Phase 3 QA dupe shape verbatim. Before the round nothing was dropped on a
  throw, so this is strictly a regression it created. FIXED: the revert runs in
  the `finally`, FIRST, above both drops. It is idempotent (the first pass
  deletes every id it was handed, so a second call is handed an empty list and
  does nothing) and it cannot throw (the extraction gave it a per-guild catch).
- S2 BLOCKING (identity). RULING 1 CLOSED THE EIGHTH PATH FROM ONE SIDE ONLY, and
  round fifteen's own two other fixes re-opened it from the other.
  `installLoadedFreehold` returns early on ANY hold, so a record seeded while its
  own load was refused never learns a name. Before this round that cost nothing,
  because an admission hold set `entry.loaded` and the entry stayed blocked all
  session. Ruling 2 made it re-readable, and the login cap deliberately left its
  entry for the in-flight read to fill, so for the first time an entry could be
  held at login and WRITABLE afterwards with no install ever having run. The
  store then minted a name for the row, `applyWriteResult` cached the LIVE
  record's stand-in, and the seal's name comparison was inert BY VALUE EQUALITY
  for the life of that entry, which is the eighth path arrived at from the other
  side. Reported independently by three of the six lanes.
  FIXED where the store can decide it: `classify`'s absent arm REFUSES to name a
  row for a record it did not install. A live record carrying the stand-in gets
  an `unnamed_record` hold, terminal for that entry, and no row is created at
  all. Nothing is lost, because there was no row; the next login builds a fresh
  entry whose install runs before the seed. NOT closed by stamping the identity
  onto the live record, which is the form ruling 1 forbids and refuted.
- S3 SHOULD-FIX (teardown). `storageRecovery.offline` is CHARACTER-keyed and was
  moved into the `finally` without the identity guard its neighbour got, so on a
  same-account swap it marked a LIVE character offline: that character's
  gold-rail ordering hold and its recovery-drive hold are released and it becomes
  a capacity-eviction candidate. The other two registrations are keyed by session
  identity and cannot reach a sibling, which is why only these two are guarded.

### What else the read found, all applied

- S4 SHOULD-FIX. `no_budget` was added to the kind list and forgotten in the
  repairable set, under a docblock claiming the set was "derived from the list
  below rather than re-typed, so a kind cannot be added to one and forgotten in
  the other". It was three hand-typed literals, and the very commit that wrote
  that sentence falsified it. DERIVED BY SUBTRACTION now: everything that is not
  a data cause and not the ordering cause is a capacity cause, so a kind added
  later lands in exactly one group by construction.
- S5 SHOULD-FIX. Only one of the three repairable kinds was pinned: deleting
  `cap_full` and `read_threw` from the set left the suite green. All of them are
  driven now, each through the port fault that produces it, and the set's exact
  membership is pinned.
- S6 SHOULD-FIX. The three flipped seal cases assert the fix BY FIXTURE: each
  hardcodes the live identity to its post-fix value, so reverting ruling 1's
  install left all three green and the eighth path's whole regression protection
  was one unit case in another describe. A case now couples the two through the
  REAL sim: it installs, reads the identity back off `ctx.freeholds`, evicts,
  reseeds through `ensureFreeholdRecord`, and asserts the seal refuses. Reverting
  the install reds it on its first assertion.
- S7 SHOULD-FIX. The harness's `livePlotId` contradicted its own `hasLive`:
  production reads both off ONE map, so no record means no identity, and the
  harness answered an identity for an owner it also said was not live. The ONE
  case covering the identity-adoption fix depended on that impossible state.
  Bound strictly to the liveness predicate now, and adoption is re-pinned on the
  state it actually exists for, a second character joining over a live record.
- S8 SHOULD-FIX. Raising the emptied-house fixture from revision zero to six,
  which the un-gating forced, took with it the ONLY pin on the `standInSeed &&`
  conjunct of `pristineSeed`: deleting that conjunct left the whole suite green.
- S9 SHOULD-FIX. THE SEAL HAD NO SUITE OF ITS OWN, and a comment written in the
  same round promised one. `tests/server/freehold_write_seal.test.ts` now drives
  every arm with literals, including the totality of `entryKnowsMore` dimension
  by dimension, and each of the four arms dies to its own mutant.
- S10 SHOULD-FIX. The budget-cap case detected only `entry.hold`, so a refusal
  that stamped `entry.loaded` was green, and a stamped `loaded` is exactly what
  stops the repair arm ever reaching that entry again.
- S11 SHOULD-FIX. DEPLOY.md kept "held counts entries under ANY recovery hold"
  while the same paragraph added a kind that books no hold at all: the whole-load
  cap leaves the entry untouched by design, so `no_budget` can climb with `held`
  flat. Both caveats are now stated, together with the fact that this series
  counts REFUSALS and not logins, so one login can book more than one.
- S12 SHOULD-FIX. The clock and timer source scan read only the store file, so
  the four modules that came off it could each have gained a `Date.now` or a
  second timer unseen. It walks all six now, with a floor proving the file list
  is not stale.
- S13 NITS, all applied: the extracted revert's call-site census named a caller
  that does not exist and undercounted by one, and the coordinator's own copy of
  it was stale the same way; the C23 scope document named the DOM-free view core
  as a paint sink and counted table rows as sinks; two source comments and one
  test comment asserted a totality that did not hold until S2 landed; the losing
  promise of the budget race now keeps a no-op handler, because being wrong about
  whether it can reject costs the realm process.
- S14 REFUTED by two of three lenses, JUDGED HERE. (a) "the budget race leaves an
  unhandled rejection": the premise is right that nothing handled it and the
  lenses are right that `preloadWithin` does not reject, so the handler is added
  as cheap insurance rather than as a defect. (b) "COMMIT ANSWERS TO NEITHER
  SERVER-SIDE BOUND is wider than its evidence": the lenses refuted it, and THE
  REVIEWER WAS RIGHT ANYWAY. Both probes had LOWERED the bound, so neither tested
  a session-level `statement_timeout` binding the commit work, and this packet's
  signature failure is exactly a claim shipped wider than its probe. A THIRD
  PROBE settled it rather than an argument: session-level `statement_timeout` at
  300 ms, no SET LOCAL at all, COMMIT ran 2,007 ms and committed. The claim
  stands and is now measured both ways. (c) "budgetRefusal answers a READY clock":
  correctly refuted, the merge is forward-only so a zero is inert, and every
  other hold answers the same cold clock.

### The mutation pass over this round's own fixes

Six mutants, against a proved control of `Tests 217 passed (217)`, ALL KILLED:
the unnamed-record refusal removed (1 failed), the same refusal inverted so it
admits the stand-in and refuses a real name (4), the repairable set widened to
every kind (3), the terminal set losing the ordering kind (2), the leave revert
dropped from the finally (1), and the storage hook losing its identity guard (1).
Four more over the seal's own new suite, each arm in turn, all killed:
`standInSeed &&` deleted (1), `revisionRegressed` dropped (2), `pristineSeed`
dropped (1), `foreignIdentity` dropped (2). And two survivors from the earlier
composition-root pass were closed and re-killed: a live-identity binding replaced
by a constant, and the clock read's inner catch removed.

## THE VALIDATION ROUNDS FIFTEEN AND SIXTEEN REST ON

At tip `0be2f181e2`, ten commits on `07521507d6`, with `TEST_DATABASE_URL` armed
from the main checkout's `DATABASE_URL`. THIS BRANCH IS LOCAL: nothing was
pushed, no pull request was opened and nothing was merged.

- `node scripts/gate_select.mjs` exit 0, PASS, ALL 12 STEPS GREEN. The planner
  FELL BACK to the full suite on a 1,742-path diff, so this is the deeper check
  rather than the selective one.
- Full suite: 4,219 test files passed and 1 skipped of 4,220; 63,729 tests
  passed, 2 expected-fail, 28 skipped.
- Real-browser suite: 51 files, 429 tests, all passed. It rewrote three PNGs
  under `docs/screenshots/`, restored with `git checkout --` and NOT committed.
- `npx tsc --noEmit` exit 0 throughout.
- The two `.pg` suites, run BOTH WAYS at this tip to prove the arming rather than
  assert it: 34 passed with the variable set, the same 34 skipped with it unset.
- Mutation: eighteen mutants across five passes, each against a proved control
  whose full `Tests N passed (N)` line is quoted in its round's section. Sixteen
  died on the first pass; TWO SURVIVED, both over the composition root and the
  login policy, and both were closed and re-killed. Every guard these two rounds
  added or changed was mutated in both directions where a one-way pin would be
  satisfied by a constant.
- The three PostgreSQL 16 transaction probes are described where they are used
  (the login bound in section 8a of the contract): SET LOCAL does not bound
  COMMIT, a session-level `statement_timeout` does not bound COMMIT either, and
  the driver's `query_timeout` does.

TWO THINGS THIS VALIDATION DOES NOT COVER, stated rather than implied.

THE DIFF BASE HAS MOVED AGAIN. The gate reports `origin/release/v0.43.0` as the
integration base; the last recorded sync on this branch was `release/v0.42.0`.
NO SYNC WAS PERFORMED in these rounds, because the tip was pinned. The next
session owes the merge-forward that `state.md` requires at every phase start, and
every count in this section is against the unsynced tree.
CORRECTED AT ROUND SEVENTEEN: the sync was performed after this paragraph was
written, in merge `d5e7f423c7`, and it was never gated. See below.

AND THE VERDICT IS STILL FAIL, on the record rather than on an open defect. Every
finding either round produced is applied, both blocking sets are closed, and the
gate is green. What is not established is that round sixteen's own fix round is
clean: it has not been read by anyone who did not write it. Sixteen rounds have
run and fourteen introduced a defect worse than one they closed, so the honest
prior for the next reader is that this one is wrong too. A green gate is where
that reading starts.

## THE VALIDATION ROUND SEVENTEEN RESTS ON

At tip `046008c59d`, fifteen commits on the release-sync merge `d5e7f423c7`, with
`TEST_DATABASE_URL` armed from the main checkout's `DATABASE_URL`. THIS BRANCH IS
LOCAL: nothing was pushed, no pull request was opened and nothing was merged.

- `npx tsc --noEmit` exit 0 throughout.
- `npm run ci:changed` exit 0 (824 warnings, 17 infos, ZERO errors; warnings are
  not the bar and the whole-repo red is pre-existing debt).
- `node scripts/gate_select.mjs`, THREE RUNS, and the first two each caught a real
  defect the ungated sync had left behind rather than anything this round wrote.
  Run 1 FAILED at `biome (changed files)` on ONE error: a format diff in
  `scripts/pr_shot_targets.mjs`, the release's own new capture target, which the
  merge took unformatted and which makes `ci:changed` refuse the entire changed
  set. Run 2 was abandoned mid-suite when the read of the fix round landed. Run 3
  reached the end.
- RUN 3, the full one. The planner FELL BACK to the full suite on a 1,744-path
  diff, so this is the deeper check rather than the selective one. Diff base
  resolved as `origin/release/v0.43.0`, which is the integration base the gate
  sorts to. Every step green through the malware scan and biome. FULL SUITE
  PASSED: 4,225 test files passed and 1 skipped of 4,226; 63,821 tests passed, 2
  expected-fail, 28 skipped.
- RUN 4, ON A QUIET MACHINE, and this is the one that settles it: `GATE_EXIT=0`,
  `PASS: all 12 steps green (vitest workers: 8)`. Same tip, same armed database.
  Full suite 4,225 files passed and 1 skipped of 4,226; 63,821 tests passed, 2
  expected-fail, 28 skipped. BROWSER REGRESSIONS 52 files and 443 tests, ALL
  PASSED, which is the step run 3 failed. Malware scan PASS (9,082 files, 457
  flags, 0 high after priors). Typecheck, the env, server and bot builds and the
  client bundle all green. The browser step rewrote six PNGs under
  `docs/screenshots/`, restored with `git checkout --` and NOT committed.
- RUN 3 HAD FAILED AT `browser regressions`, exit 1, on ONE test of 443:
  `tests/browser/post_grade_fxaa.browser.test.ts`, "softens a diagonal edge and
  leaves every flat fragment byte-identical", `Error: Test timed out in 15000ms`.
  DIAGNOSED RATHER THAN ASSERTED, because a browser failure on a persistence
  round is exactly the shape that deserves suspicion. The test ran 19,231 ms
  against a 15,000 ms bound, a 28 percent overrun, on a machine whose load
  average was 117 at the time (a second session was saturating it). This round
  touches NO render code at all: `git diff --name-only` over the whole range
  matches nothing under `src/render/`, `src/game/`, or any shader, FXAA or grade
  path. Re-run ALONE on the same tree it passes, 2 tests, 449 ms of test time
  against the same 15,000 ms bound, a 34x margin. It is a contention timeout, not
  a regression.
- The two `.pg` suites, run BOTH WAYS at this tip to prove the arming rather than
  assert it: 34 passed with the variable set, the same 34 skipped with it unset.
- The browser step rewrote seven PNGs under `docs/screenshots/`, restored with
  `git checkout --` and NOT committed. The tree is clean.
- All 21 monolith rows measure EXACTLY at their ceilings with zero slack and none
  raised. `server/game.ts` 9907, `server/db.ts` 4605,
  `server/freehold_persist.ts` 2193, LOWERED four times across the round
  (2243 to 2228 to 2215 to 2210 to 2193) against eight extractions.
- No em dash, en dash or emoji on any line the round added, checked by a
  byte-level scan over the whole diff.

THE QUIET RUN WAS OWED AND HAS SINCE BEEN MADE. Run 4 above is it, and the gate
PASSES: the contention diagnosis is confirmed by the step passing rather than by
the argument for it. Nothing about the gate is outstanding.

AND THE VERDICT IS FAIL ON ITS OWN MERITS, independent of the gate. The store's
test harness still lets `serialize` and `liveRev` contradict `hasLive`. Part of
it is closed here and the general repair is a deliberate harness rewrite measured
at forty-plus cases. That is the next session's first work, and the honest prior
for whoever does it is the one this round earned: it found TWO new paths to the
one invariant, and its own repair for the first opened the second.

## ROUND SEVENTEEN: THE UNREVIEWED TAIL WAS READ, AND IT HAD DONE IT AGAIN

Six fresh lanes read `c8bb3d3f31..HEAD` with `5c7e3566ff` first, plus a
release-merge audit of the sync that had landed in between. The pattern holds at
SEVENTEEN for SEVENTEEN, and it held twice inside this round: the fresh read
found a NINTH path to the packet's one invariant, and the read of the fix for it
found that the fix write-blocked an account it should not have.

### THE SYNC HAD ALREADY HAPPENED, AND IT WAS NEVER GATED

The paragraph above says no sync was performed and that the next session owes it.
It had been performed: `d5e7f423c7`, merging `origin/release/v0.43.0` at
`b276778485`, made after that paragraph was written and recorded in no
`docs/freeholds/` file. `origin/release/v0.43.0` is still the version-newest
release branch (`git for-each-ref --sort=-v:refname`, which is exactly what
`resolveSelectBase` sorts by), so the base is correct; `v0.42.1` and `v0.42.2`
are later patch branches and not the integration base by the gate's own rule.

IT LEFT THE TREE RED. `tests/freehold_capture_contract.test.ts` hashes the 42
`sourceInputs` of `docs/screenshots/freehold-interiors-2026-09-08/acceptance.json`,
the merge changed three of those files, and `acceptance.json` is not in the merge
delta at all, so all three pins still equalled the branch parent's value:
`src/styles/components.css`, `src/styles/hud.mobile.css` and
`scripts/pr_shot_targets.mjs`. Re-minted at all FOUR occurrences, because the
script's digest appears twice (`sourceInputs` and the `producerInputs` filter) and
replacing one left the suite red.

THE CAPTURES WERE NOT RE-SHOT, and that judgement is recorded with its evidence
rather than asserted: every selector the two stylesheets changed is scoped to
`.corpse-harvest-btn`, `#harvest-preference-window`, `.harvest-preference-*` or
`.soc-*`, none of which appears in a freehold gate prompt or interior view, and
the script change is one ADDITIVE capture target (`guild-roster-expand`) that
alters no existing route. A release touching a selector these captures can reach
owes a re-shoot, not a re-hash.

WHAT ELSE THE MERGE AUDIT FOUND, and it is short. The committed i18n bundles are
FRESH against the merged catalogs, verified by regenerating both builds into a
scratch directory through their own `I18N_OUT_DIR` override and diffing (22 UI
locales plus the pseudo, the admin set, and the flat key union: no differing
files), so the merge reconciled them by regeneration rather than by taking a
side. All 21 monolith rows re-measure exactly on the merged tree with zero slack.
No shard or timing table is in the delta. One new `vi.mock('../server/db')` site
arrived with the release and passes on the merged tree. No legacy-arm divergence
and no un-re-bound injected helper; `npx tsc --noEmit` exits 0. THE MERGE TOUCHED
NO FREEHOLD PERSISTENCE CODE AT ALL: zero paths matching `freehold` or `housing`,
and exactly one `server/` file (`server/corpse_harvest_inspection.ts`), so the
code under review is exactly as round sixteen left it. One adjacent non-finding,
recorded so it is not re-investigated: five wiki titles present in the release
parent are absent from the merged seed, and that is NOT a merge drop, the merged
seed is byte-equal to a fresh generator run and those five dungeons carry
`guideVisible: false` in the release's own content.

### THE NINTH PATH, and the refusal that closed the eighth was not total either

- Q1 BLOCKING (identity). `classify`'s `unnamed_record` refusal reads the LIVE
  RECORD, so it can only fire once something has been SEEDED, and that made it
  depend on WHEN the load landed. The whole-preload budget refusal deliberately
  leaves its read in flight to fill the entry, and the handshake still has
  `acquireCharacterLease` and `getCharacter` to run below it, two database round
  trips on the same saturated pool that produced the overrun. The read lands in
  THAT window, before `bindFreeholdOnJoin` and so before `addPlayer` seeds
  anything: `livePlotId` answers null rather than the stand-in, the refusal
  cannot fire, the absent arm mints, and `installLoadedFreehold` then returns
  early on the budget hold while `ensureFreeholdRecord` seeds the stand-in a
  moment later. REPRODUCED against the real store, and reproduced independently
  by a second reader before it was told: entry `loaded` and unheld holding
  `plot:minted1`, a row INSERTED under that name, `write_failures` 0 and
  `quiesced` 0, while `applyWriteResult` caches the RECORD's stand-in, so
  `foreignIdentity` is `PENDING !== PENDING` and the seal's name comparison is
  inert BY VALUE EQUALITY for the life of that entry. The second reader carried
  it to the loss itself: a reseeded default at revision six written over the row
  with `layoutJson '[]'` and `trophiesJson '[]'`. That is the eighth path arrived
  at from a THIRD side, and both `server/freehold_write_seal.ts` and section 8a
  claimed `classify` had closed it totally.
  FIXED: the store now knows which loads its caller abandoned, so the two cases
  are one rule, mint only for a record this store can name.

- Q2 BLOCKING, and it is the fix for Q1 read fresh. Abandonment was recorded
  against the ACCOUNT, and `beginLoad` is single-flight per account: two
  characters of one account joining together ride ONE read, so if the first
  login overran, the second one's load was refused too and the account took a
  TERMINAL `unnamed_record` hold for its whole session with a live installer
  standing right there. Fail-safe rather than a lost row, and still a housing
  outage manufactured by the guard against one. FIXED: a waiter COUNT in
  `server/freehold_load_waiters.ts`, and classify refuses only when the LAST
  login has gone. Exact rather than conservative, because classify runs inside
  the load promise, before any surviving waiter's own race has resolved.

### THE TENTH PATH, AND THE FIX FOR THE NINTH IS WHAT OPENED IT

- Q20 BLOCKING (identity), found by the read of the fix round and REPRODUCED
  against the store. The sibling exemption Q2 added is the precondition. Two
  characters of one account ride ONE single-flight read, and `no_budget` is the
  ONLY kind that leaves a sibling with a clean answer, because every other hold
  goes through `holdResult` onto the shared entry and both installs then return
  early. So the sibling keeps the mint alive at classify; the REFUSED login
  reaches `addPlayer` FIRST, because it stopped waiting earlier and is therefore
  always ahead in the pipeline, and seeds the stand-in; and the sibling's own
  install, which would have named the record, is silently discarded by
  `loadFreehold`'s load-once guard (`if (ctx.freeholds.has(ownerKey)) return`).
  The entry is left `loaded`, unheld, `durableRev` null and holding `plot:minted1`
  while the live record carries the stand-in. Measured: a row INSERTED under
  `plot:minted1`, `write_failures` 0, `quiesced` 0, after which
  `applyWriteResult` caches the record's stand-in and `foreignIdentity` is
  `PENDING !== PENDING` for the life of that entry. The eighth path's terminal
  state, reached through the ninth path's own repair.

WHY THE LOAD-SIDE TEST CANNOT CLOSE IT, and the reason is general rather than
incidental: the fact it samples (is anyone still waiting) is not the fact that
matters (will an install actually reach the record). A waiter's install is
discarded whenever the abandoned login's own `addPlayer` seeds first, and the
abandoned login is ahead by construction. Any ordering test has this shape.

### THE WRITE-SIDE GUARD: NOW TAKEN, AND WHY IT WAS NOT SOONER

THE FIX IS `insertWouldMintAnUnnamedRow`: the FIRST row for an entry may only be
created for a record that already carries the identity that row will be created
under. Judged at the instant the row would be created, so no ordering can matter.
It is strictly additive to `seedWouldLandOnRealRow`, whose whole body sits behind
`entry.durableRev !== null`, so the two can never disagree about a document.

AND THE WAITER MACHINERY IS RETIRED RATHER THAN REPAIRED A THIRD TIME. Both of
its forms carried a defect (an account flag write-blocked a healthy sibling; a
waiter count opened Q20) and neither was ever sufficient. The load-side ordering
test keeps only its stand-in arm, which is cheaper and diagnoses better, and its
own comment now states plainly that it is NOT total and where totality lives.
`server/freehold_load_waiters.ts` and its suite are deleted; the store's ceiling
falls to 2193.

WHAT IT COST, and this is the reason the earlier round escalated it rather than
taking it. The guard refuses the first insert for any entry whose live record
carries the stand-in, and FIVE store-level seal cases built exactly that state to
reach `pristineSeed` and its content dimensions. That state is what the install
fix removed, and a separate reader found the same five modelling it
independently, so the cases are repaired rather than the guard weakened: each
carries the INSTALLED identity until its own reseed, as production does. The
consequence is honest and worth stating, because it is a real reduction in
defence in depth: `pristineSeed` and its layout, trophies, tier, condition and
visit-policy dimensions are now unreachable through the store for EVERY entry
class, not only for row-loaded ones. They remain driven decisively, with literals
and their own mutants, in `tests/server/freehold_write_seal.test.ts`, which needs
no store at all.

ONE MORE HARNESS DEFECT CAME OUT WITH IT. The default live identity was GLOBAL,
answering the last id minted by anyone, so a case driving two accounts handed the
first owner's record the second owner's identity, which no realm can produce and
which the new refusal correctly rejects. It is per owner now, attributed through
the account whose row read is in flight, which is exact because `classify` mints
between its own read and its own assignment.

### THE WRITE-SIDE GUARD AS IT WAS ESCALATED (superseded, kept for the record)

The order-independent statement of the same invariant is a WRITE-side refusal:
`entry.durableRev === null && persisted.plotId !== entry.plotId` means the first
row for this entry would be created under a name the record being written does
not carry, so refuse and quiesce. It was built, it closes Q1 regardless of
ordering, and a fresh reader attacked it for false positives and found none: on
every healthy path the install has already put `entry.plotId` INTO the record or
adopted the live record's identity, so the two are equal by construction, and the
next login heals it because `preload` replays that same minted `plotId` with
`state` and `durableRev` both null, which is `installLoadedFreehold`'s absent arm.

IT WAS NOT TAKEN AT FIRST, and the reason is a decision about what the seal is
FOR rather than a doubt about the guard. Q20 settled it: the cost below is real
and it is smaller than a tenth path. It refuses the FIRST insert for any entry whose
live record carries the stand-in, and that is the exact state five store-level
seal cases build, so it makes `pristineSeed` and its content dimensions
unreachable for every entry class rather than only for row-loaded ones. The
seal's own docblock says those arms exist precisely because the name comparison
is inert for a minted entry. Removing the last state in which they can fire is a
maintainer decision, and it is recorded here with the predicate, the evidence and
the cost so it can be taken deliberately rather than discovered.

### THE HARNESS MODELS A STATE THE SERVER CANNOT PRODUCE, AND IT IS OPEN

(CLOSED 2026-09-25 by the harness-fidelity rewrite; see THE HARNESS-FIDELITY REWRITE,
AND THE TWO PATHS IT FOUND, at the end of this file. Kept as written for the record.)

- Q3 BLOCKING, NOT FIXED, and it is why this round's verdict is what it is.
  Round sixteen's S7 bound `livePlotId` strictly to `hasLive` and recorded that
  "no case depends on a liveness state the server cannot produce". That is FALSE.
  Production derives all four liveness reads from ONE map and they are mutually
  equivalent (`hasLive`, `serialize() !== null`, `liveRev() !== null`,
  `livePlotId() !== null`), and the harness leaves `serialize` and `liveRev`
  unbound: with `hasLive` defaulting FALSE the loader is told no record is live
  while the writer is handed a document carrying that record's identity. FIVE
  seal cases declare a stand-in live identity over an absent row and then assert
  a first write lands, and `server/freehold_install.ts` is exactly what removes
  that state. The strict binding of round sixteen survives only because
  `livePlotId` is read at CLASSIFY time while `serialize` and `liveRev` are read
  at WRITE time, which is a property of which port is read when, not of the
  harness modelling one map.
  WHY IT IS NOT FIXED HERE, stated rather than waived. The faithful repair is a
  harness that models the two moments a login has, no record at preload and a
  record afterwards, and every shape of it was measured: binding `hasLive` to
  `serialize` sends every case down `preloadWithin`'s already-live arm and reds
  most of the suite, and binding `liveRev` strictly alone reds forty-plus cases,
  which is the blast radius the reader measured independently. That is a
  deliberate harness rewrite touching the cases that guard this packet's one
  invariant, and doing it at the end of a long round is precisely how fifteen of
  seventeen rounds have gone wrong. The compensation is real but partial: every
  arm of the seal is now driven decisively by literals in
  `tests/server/freehold_write_seal.test.ts`, which needs no harness at all.

### WHAT ELSE THE SIX LANES FOUND, all applied

- Q4 SHOULD-FIX (teardown). `revertOwnGuildBookOps` promised it never throws and
  that a faulting guild leaves the rest undone, and its try wrapped ONE of four
  statements. `index.resync` and the process-wide incident counter sink sit
  outside it, and the revert is now the FIRST statement of leave()'s `finally`,
  so a throw from either aborted the loop AND skipped both index drops, the
  outbox discard, the lease release and `removePlayer`: the round-fifteen
  character lockout reached through the round-sixteen fix for it. The guard
  covers the whole per-guild body now, with the three marks cleared above it so
  a guild is never revisited. Two cases drive it, one per statement, each
  asserting the guild AFTER the faulted one is still undone.
- Q5 SHOULD-FIX (tests). The teardown order pin asserted the revert above ONE of
  the two index drops while its own sentence claimed both, leaving the character
  map free to move above it.
- Q6 SHOULD-FIX (seal coverage). Four sub-expressions of the seal survived
  mutation in a suite whose comment claims each dimension is asserted on its own.
  THREE are real gaps and are closed with pairs that differ in exactly the
  conjunct under test: a stand-in record that has MOVED (a fresh account's tier
  grant at revision one) kills `persisted.rev === 0`, and a stand-in record
  carrying layout or trophies at revision zero kills the other two, which is the
  state the content arm exists for. The FOURTH is unkillable and is documented
  instead: under `pristineSeed` the document is at revision zero, so
  `entry.state.rev > 0` is exactly `revisionRegressed`, a separate disjunct of
  the same expression, and the dimension table's `rev` row passed through THAT
  disjunct, which is a case passing for the wrong reason under a comment
  promising the opposite.
- Q7 SHOULD-FIX (docs). DEPLOY.md stated the gauge caveat backwards. A TERMINAL
  hold is the one where `loaded` and `held` double-count an entry, because a data
  refusal leaves it loaded; a CAPACITY hold is the one that still sums. The doc
  named the summing case as the exception, so an operator read double-counted
  terminal holds as normal.
- Q8 SHOULD-FIX (docs). The C23 scope document claimed its two player groups line
  up exactly with the repairable and terminal split, which its own table eleven
  lines above falsifies: `unnamed_record` is terminal and reads as RETRY. An
  implementer deriving the player group from the runtime set would tell the one
  player a relog reliably helps that their home will not clear on its own.
- Q9 SHOULD-FIX (channel). The new refusal's detail literal was not in
  `KNOWN_DETAILS` while its sibling on the same arm was, so a later reader
  wrapping that arm for consistency would silently lose the diagnostic to
  `unclassified`. The totality pin enumerated only the shapes that are WRAPPED
  today, which is what let the asymmetry sit there; it covers every shape a
  server module emits now, wrapped or not.
- Q10 SHOULD-FIX (docs and source). Both said the `unnamed_record` refusal costs
  nothing. No durable ROW is lost, which is not the same thing: for an account
  with no row a capacity hold at login converts to a terminal one, so those
  owners furnish for a session and lose it at logout with a counter as the only
  observer. That is the population C23 exists for.
- Q11 SHOULD-FIX (activation gate). Every refusal answers a COLD hearth clock
  whose ready time is zero and the merge is forward-only, so a login slow enough
  to overrun its budget is handed a READY Hearth every time, which is the outcome
  `server/freehold_install.ts` argues its unconditional merge prevents. Recorded
  in section 8a as a sharper statement of the existing fail-open gate and
  corrected in the source comment. Pre-existing, not introduced this round.
- Q12 SHOULD-FIX (types). `FREEHOLD_TERMINAL_HOLD_KINDS` was `ReadonlySet<string>`,
  so the subtraction's guarantee rested on one assertion in the suite: a typo
  compiled clean and silently moved a DATA cause into the repairable group, which
  is re-reading an unreadable row on every login forever. Typed to the kind list
  now, and a typo fails compilation (measured).
- Q13 SHOULD-FIX (scan). THE EXTRACTIONS RE-OPENED THE STALE-LIST GAP the last
  round closed. The clock and timer scan hand-typed its file list, so a new
  sibling was unscanned while every listed file still existed and the
  anti-staleness floor read clean. Derived from the store's own imports now, with
  the derivation itself pinned. The by-path importer list in
  `src/sim/freehold/CLAUDE.md` was stale against THREE importers that three
  separate extractions added, and is pinned by a derived test.
- Q14 NITS, all applied: the wrapper's guild-book caller census named the
  fence-out, which calls the module directly with the ids it carried, and omitted
  the growth-limit quarantine; the takeover comment described a lifetime lockout
  for what is a transient; an em dash on the same line; the load-failure
  counter's help text, which is the string an operator reads in Prometheus, still
  enumerated four responses for nine kinds; the contract carried a count of eight
  against its own nine; the interiors evidence record claimed 31 source inputs
  against a record carrying 42; the seal's pristine fixture spelled the sim's
  default tier, condition, visit policy and revision as literals instead of
  deriving them, so its totality claim would stop tracking the shape it is total
  over.

### THE SIXTH RUNTIME PROOF, SETTLED

`phase-07-qa.md` records C4's pin as STILL OWED. IT LANDED at `4648c4b1e6`,
before the rulings round, as "stops owing a write that has no record and no
capture, instead of re-arming forever": it drives the ports directly, asserts the
write reaches its permit and issues no statement, asserts the entry STOPS being
dirty so no later sweep re-arms it, and asserts the entry is collected. The row
is corrected rather than amended.

WHAT WAS ACTUALLY OWED is the other half of C4, whether any production sequence
reaches that arm, and the answer is NO in this release. The argument, enumerated
so it can be attacked rather than trusted:
1. Dirtiness has exactly TWO producers. `markDirty` has no production caller (a
   whole-tree grep over `server/`, `src/`, `headless/` and `bot/` finds only the
   unrelated mail index and editor methods of the same name), and
   `noteRevisionMoved` returns false when `liveRev` is null, so it cannot dirty
   an entry with no record.
2. An entry can therefore only become dirty while a live record exists.
3. The record is dropped only by `releaseFreeholdOnLeave`, reached only from
   `sim.removePlayer`, which has exactly TWO call sites, and both are preceded on
   the same path by a `flushAndRelease` for the same owner key: the leave path
   awaits `flushFreeholdBinding`, which cannot reject, and the join-failure path
   fires `releaseFreeholdBinding`, whose `flushAndRelease` runs synchronously
   past its capture before the first await.
4. `flushAndRelease` captures `ports.serialize(ownerKey)` while the record is
   still live for any entry that is unblocked and owes a write.
5. A capture is released only through `releaseCapture`, at three sites, each
   gated on `!owesWork(entry)`, and `owesWork` includes `isDirty && !blocked`, so
   a dirty unblocked entry never loses its capture.
6. A dirty BLOCKED entry cannot reach the arm at all: `runWrite` re-checks
   `blocked(entry)` after the queue wait and returns before sampling.
The arm is a bound on a state the furnishing writer will make reachable, exactly
as its own comment says, and the pin is the right shape for that.

### AND THIS ROUND'S OWN FIX ROUND WAS READ, WHICH IS WHERE THREE MORE CAME FROM

A seventh lane read `d5e7f423c7..HEAD` on the standing assumption that a fix
round is unreviewed code. It found four defects and THREE OF THEM WERE IN THE
FIXES FOR THE OTHER LANES' FINDINGS, which is the pattern one level down: not
"the round introduced a defect" but "the round's repairs each narrowed what they
replaced".

- Q15 SHOULD-FIX. The clock and timer scan was re-derived FROM THE STORE'S
  IMPORTS, and that is the stale-list trap one level down: it silently dropped
  `server/freehold_install.ts`, which performs the hearth-clock merge and is
  precisely where a `Date.now` is a behaviour bug, and which THIS ROUND EDITED,
  plus `server/freehold_persist_registry.ts`. Both were on the hand-typed list it
  replaced. An import-derived list also cannot see a module extracted from a
  SIBLING rather than from the store, which is reachable the moment the
  load-outcome module splits again. Derived from the DIRECTORY now, with the
  composition root excluded as a named decision (binding `Date.now` to the
  store's `nowMs` port is its whole job) and both dropped files pinned by name.
- Q16 SHOULD-FIX, and it is TWO defects in one pin. The by-path importer pin
  checked file NAMES and never the leaf lists beside them, so the same commit
  that added it credited the store with a `types.ts` import it does not have (the
  claim was true when written and the round's own orphaned-import cleanup
  falsified it). Worse, the first repair for that was ITSELF VACUOUS: it searched
  the WHOLE guide, found each file's earliest mention, which is ordinary prose
  hundreds of characters from any list, and skipped every importer as list-less,
  so it passed over exactly the claim it was written for. Scoped to the exception
  paragraph now, with a count of how many lists it actually compared, and killed
  by mutants in BOTH directions: a leaf credited but not imported, and a leaf
  imported but omitted.
- Q17 SHOULD-FIX. The guild-book incident counter sat ABOVE the revert inside the
  widened try, with the ops log already deleted above the guard, so the faulting
  sink the round's OWN new case installs discarded that guild's money revert
  permanently. Only one of the two can be lost there and the money is not it: the
  revert runs first, and the two cases assert each site's real outcome rather
  than one shared answer.
- Q18 NIT. The waiter registry's header claimed `abandoned` false means an
  install is left. What it knows is that NOBODY IS WAITING, which is narrower:
  `retain`'s lost-entry repair waits there too and discards its own result.
  Counting it is still correct, because that repair runs on a join whose next
  replay installs the entry's identity, and the narrower claim is what is
  written now.
- Q19 REFUTED, and judged here rather than dropped. "The round's two new modules
  ship with no tests in the commit", read off `git status` as untracked. They are
  tracked, at `2f71cdf9ee`; the lane started before that commit and read the
  pre-commit tree. Recorded because a refuted finding from a reader this useful
  is worth the line.

WHAT THAT LANE COULD NOT BREAK, listed so nobody pays for it twice: the waiter
count across every exit of `preload` (the uncapped fallback, a throwing
scheduler, two accounts, the drain, a throwing owner key), which floors and
deletes at zero so the map cannot grow; the five extracted functions as
field-for-field moves with no dropped counter and no changed default; the three
new seal cases, each reaching the conjunct its comment names and no other; and
the typed terminal set, which is a real compile error because the kind list is
`as const`.

### AND THE TENTH PATH'S FIX WAS READ TOO, WHICH IS WHERE THE LAST FOUR CAME FROM

(SUPERSEDED 2026-09-25: the harness-fidelity rewrite's first fresh read found an
eleventh path the old harness could not produce, and the read of its fix a twelfth; see
the section at the end of this file. Kept as written for the record.)

An eighth lane read `0077f6018f` and what followed it. IT FOUND NO ELEVENTH PATH
and no healthy account write-blocked by the new refusal, which is the first time
in this ledger a reader has come back from the store's identity logic with
neither. What it did find is four claims the round made that the code does not
support, three of them about the round's own repairs.

- Q21 SHOULD-FIX. THREE of the five repaired seal cases refuse through the
  IDENTITY arm now, not the arms their comments name. Once the record carries its
  installed name, `applyWriteResult` caches that name, so a reseeded default
  differs by name and `foreignIdentity` short-circuits everything after it.
  Measured against the real predicate with BOTH continuity arms neutralised. The
  two anti-vacuity cases were worse than mislabelled: one claimed a record
  identical to a pristine seed while its own fixture makes `standInSeed` false,
  and the other was titled for a stand-in record it no longer carries. All five
  are renamed and re-commented to the outcome they still prove, each pointing at
  the seal's own suite for the dimension it used to claim.
- Q22 SHOULD-FIX. The seal's own justification for keeping the pristine arm was
  false in the same way, and it contradicted this ledger: it said the arm is dead
  for a ROW-LOADED entry but the only thing standing for an entry that MINTED its
  own row, where the name comparison cannot fire at all. Both halves are the same
  half now. The file says so, and the dangling "see the OPEN GATE below" goes
  with it.
- Q23 NIT. The per-owner mint attribution is exact for SEQUENTIAL loads only. One
  variable set when a read starts and read when the mint happens would
  misattribute across two overlapping accounts, which is the defect it replaced
  one level up. Unreachable by any case today, and stated rather than closed.
- Q24 SHOULD-FIX, and it is a correction to this round's own new pin. The insert
  refusal costs one LOGOUT, not one session. The poisoned record is evicted by
  `removePlayer` only when the LAST session sharing the owner key leaves, so
  while a sibling character is still online the record outlives the entry and
  each new login's classify sees the stand-in and takes the terminal hold again.
  Bounded either way, never unbounded, and the weaker claim is the true one. The
  case also drove its leave in the reverse of production order, which was
  harmless here and is corrected.

### THE MUTATION PASS

Every guard added or changed was mutated on disk, its owning suite run, the RED
confirmed, and the file restored by plain file write with the green
re-confirmed. Each pass ran against a no-op control first and the control's full
`Tests N passed (N)` line is quoted.

- The ordering refusal, first form (an account flag), four mutants, control
  `Tests 209 passed (209)`, ALL KILLED: the abandoned arm dropped (1 failed), the
  stand-in arm dropped (1), the mark never set (1), the mark never cleared (1). A
  fifth, `abandoned` forced true, killed 46.
- The ordering refusal, SECOND form (the waiter count), six mutants, control
  `Tests 210 passed (210)`, ALL KILLED: the abandoned arm dropped (1), the
  stand-in arm dropped (1), `abandoned` forced true (47), the waiter never
  registered (47), the waiter never released (1), and the count's own predicate
  forced false (1). Both directions, because a one-way pin here is satisfied by a
  constant.
- The guild-book revert, one mutant, control `Tests 48 passed (48)`, KILLED:
  narrowing the try back to the sim call alone (1).
- The by-path importer pin, one mutant, control `Tests 48 passed (48)`, KILLED:
  one importer name removed from the guide (1).
- The seal, four mutants over its own suite plus the store's, control
  `Tests 220 passed (220)`, THREE KILLED AND ONE SURVIVING BY CONSTRUCTION:
  `persisted.rev === 0` dropped (survived before the new cases, 1 failed after),
  the layout conjunct dropped (survived, then 1), the trophies conjunct dropped
  (survived, then 1), and `entry.state.rev > 0` dropped (SURVIVES, and is the
  absorbed dimension recorded above rather than a gap left open).
- A type mutant rather than a test mutant, for Q12: a one-character typo in the
  terminal set now fails `npx tsc --noEmit`, measured both ways.
- The directory-derived clock scan, one mutant, KILLED: narrowing the filter back
  to the store file alone reds on the named `server/freehold_install.ts`.
- The by-path leaf pin, two mutants, BOTH KILLED: crediting the store with a
  `types.ts` it does not import (1 failed), and omitting a `state.ts` it does
  (1 failed). Both directions, because a one-way pin here is satisfied by an
  empty list, which is how its first cut passed.
- The INSERT refusal, three mutants against a proved control of
  `Tests 224 passed (224)`: the guard disabled (2 failed, the ninth and tenth
  path pins), the predicate inverted so it admits a mismatch and refuses a match
  (37 failed), and the `durableRev === null` gate dropped, which SURVIVES. That
  survivor is absorbed rather than a gap and is recorded in the source: once a
  row exists the seal reaches the same verdict by a different field, and the only
  way the two could disagree is the state this arm stops from ever getting a row.
- The load-side stand-in arm, one mutant, KILLED (1 failed), so retiring the
  waiter machinery did not leave it unpinned.

## THE RELEASE/V0.44.0 SYNC, 2026-09-22, AND WHAT IT LEFT OWED

Merge `ffa7ac5ffb` takes `origin/release/v0.44.0` at `56525e0343` (877 commits; 221
files changed on both sides, 80 conflicted). Every conflict was resolved by hand against
both parents; i18n, wiki and MediaWiki artifacts were regenerated; the terrain corpus was
re-minted with the release body kept byte for byte and this packet's 811-record tail
byte-identical; the Eastbrook polish provenance was re-minted by its own script. Two
double extractions collapsed onto the release's module (client perf rows, `anchorFields`).

THE AUDIT: five fresh read-only lanes (sim/render/net; UI/scripts/docs; server with its
endpoints, bindings and plan premises; auto-merged test pins; a re-read of every hand
resolution). Applied in the merge: the furnishing guards ported onto the release's
`auto_equip.ts` and `nearby_interaction_core.ts`, and mirrored onto its new paths (the
Sales History quality frame on both hosts, the sell-confirm threshold, the chat link and
Exchange loot-quality badges, the vendor role classifier, `perfectedLineBudgets`, the
party-trade def gate on the furnishing card); the Who tab keeps `freehold` (with a
compile-time exhaustiveness check) and serves the RELAY zone realm-wide; the join tail's
relic key walk now runs inside its own guard (`reconcileJoinedAccountRelics`); the gate
prompt tabs moved onto the library `.ui-tab` primitive; every stale pin re-measured on the
merged tree, each against the release commit that moved it.

REVIEWED, NO CHANGE, WITH THE REASON: the Sales History quality FILTER matches the stored
column (unreachable, every furnishing listing is stamped at creation and none has
shipped); the map Dungeons filter does not hide the gate (it is a navigation marker like
the release's delve and rift entrances); the loot window, loot roll, vault and rift forge
badge reads (a furnishing never drops as loot and cannot enter the vault or forge); the
release GameServer db mocks lack `runWithStatementTimeout` (no test reaches it today).

OWED, IN ORDER, FOR THE NEXT SESSION:
1. MOVE THE GATE (ruled 2026-09-22). The release moved Apothecary Lin 4.24 yd from the gate
   at (-14,-92), and the interact ladder ranks objects above NPCs, so on a lit host the gate
   steals Lin's press. Chosen site (-28,-82): 12.4 yd from the nearest NPC (clear of the
   gate's 5 yd reach plus the 6 yd NPC reach), about 12 yd from the Eastbrook Inn, flat, dry,
   off roads, with the drop (-28,-86) unblocked and zero depenetration on seeds 1, 7, 42,
   99, 1032, 1337. The single source is `EASTBROOK_LAYOUT.services.freeholdGate`; the literal
   (-14,-92)/(-14,-96) sites are `tests/freehold_dungeon_defs.test.ts` (94, 110, 270),
   `tests/freehold_instance.test.ts:622`, `tests/freehold_instance_online.test.ts:76`,
   `tests/server/freehold_wire.test.ts` (705, 1055) and `tests/parity/scenarios.ts`
   (3229, 3241). Add a clearance pin (every NPC over 11 yd from the gate). Re-mint the
   `freehold_claim` golden, the terrain tail (prove the prefix and 811 again, then validate
   on Linux in Docker), and the Eastbrook polish provenance (`eastbrook_layout.ts` is an input).
2. RE-HASH THE CAPTURE FINGERPRINTS (ruled 2026-09-22) in
   `docs/screenshots/freehold-interiors-2026-09-08/acceptance.json`, after the gate move,
   and record in `docs/freeholds/interiors-implementation-evidence.md` that the captures
   predate the v0.44.0 restyle, the gate tabs change and the gate move, so a RE-SHOOT IS
   OWED before this evidence is relied on.
3. Re-run `node scripts/ci_shard_weights_harvest.mjs --carry-local-missing --runs 3` on a
   quiet machine (coverage 0.897 against the 0.918 floor; it refuses while any suite is
   red, which is why it stopped at the capture contract) and commit the table alone.
4. The armed gate, then `npm run ci:changed` after the LAST commit.
5. Rulings or plans still open: `Sim.addPlayer` is not atomic and the release widened it
   (`seedAccountLedgerSelf` runs after `addEntity` and the freehold seed, and the join's
   catch only releases the binding); the release's account ledger is cross-realm, so a
   character on a dark realm (D85) can show Hearth relics and earn cosmetic Reliquary deeds
   from lit-realm finds; phase 17 needs its re-plan onto the ledger (recorded there and in
   D48).

## THE OWED LIST WORKED THROUGH, 2026-09-22 TO 23: THE GATE MOVE, THE RE-SHOOT, THE GATE

Everything the previous section left owed is either DONE below or named in the open list at
the end of this section. Commits `190329610f..HEAD`, all local.

### A SECOND SYNC FIRST

`release/v0.44.0` moved on by five commits (the craft-roll audit, PR #4165) after
`ffa7ac5ffb`, so merge `190329610f` takes it at `fc86d90234`. Two conflicts, both unions:
the account export keeps both the housing loaders and the new craft-roll read, and the
monolith rows take the exact merged counts, `server/game.ts` at 9776 and `server/db.ts`
at 4530. The db.ts row RISES from this branch's 4513 by the release's own +17 (its
craft-roll export read), and stays under the release's own 4641 pin; it is recorded here
because a ceiling that moves up is a maintainer's call to see.

### THE GATE MOVED FOUR TIMES, AND WHY THE RULED SITE WAS NOT THE LAST

The ruled site `(-28,-82)` cleared every NPC by 12.37 yd, but stood 4.47 and 5.00 yd
from two garden beds, and the press ladder ranks objects above beds, so it took their
press (`742523fbc4`). `(-37,-103.5)` then passed every press but dropped a leaving
player 1.17 yd from a house corner and cleared the road and a streetlamp by a hair.
`(-39,-104)` added real margins and landed a leaving player 0.25 yd OUTSIDE the
Eastbrook town circle, where Town Focus refuses. The gate now stands at
`(-38.65,-103.75)`, facing 0, with its drop 4 yd south at `(-38.65,-107.75)` through
`DUNGEON_DOOR_RETURN_INSET`, both in town. `docs/freeholds/content-numbers-workbook.md`
separates the rules into RULED (the NPC press), ENFORCED (every press rung, dry flat
ground on all eight seeds, the town circle) and CHOSEN (three margins picked for this
site: drop to building 2 yd, drop to road 5.5 yd, 3.5 yd of collider-free ground). Without
the chosen margins `(-37,-103.5)` would stand nearer the ruled point; FERNANDO, that is
the one place this move went past the ruling's letter, and it is his to confirm.
`tests/freehold_gate_clearance.test.ts` pins every rule through the real ladder, the real
colliders (measured two ways, because `isBlocked` reads one cell and is complete only to
0.8 yd, and squares an OBB's corners) and the real leave and rejoin points.

Each move re-minted the `freehold_claim` golden (only position-derived fields, the POI
visit marks and, after the copy change, the events digest moved; ticks, draws and the draw
digest are byte-identical), the terrain corpus tail (the 152,181-record body
byte-identical, the tail still 811 records, only its 50 door-stencil records changed,
validated on Linux aarch64 AND, at the end, on Linux x86_64 glibc 2.36 in
`node:26-bookworm`: 2 of 2) and the Eastbrook polish provenance by its own script.

### THE GATE DID NOT DRAW ON A LIT HOST, AND FOUR RENDER RULES WERE WHY

Found only because the re-shoot looked at the frames: the arch spawns
`lootable:false`, and the per-frame object visibility gate hid every non-lootable object
outside the delve, rift and battleground families (`7e49b9fec1`); a direct pick dropped
the whole hit list on it, and dropped it again when an ordinary prop stood behind it
(`02661857ed`, `9f65cfad2a`); the view pool ranked it last, behind every town NPC within
45 yd, though every leave lands 4 yd from it (`02661857ed`, then `c9b15ef50d`: the
mailbox and noticeboard landmark path); and town grass tufts grew through its plinths
(`7afac8b0c1`), with the clearing then limited to hosts that light freeholds
(`1c17e99834`). Each rule has an exact-template arm pinned against the entity the real
bootstrap spawns, and an online case drives the server's wire through the client mirror.

### THE PROMPT'S TABS WEAR THE LIBRARY LOOK

A later-layer gate rule in `src/styles/components.css` still painted the selected tab gold
with an underline over the `.ui-tab` primitive the sync moved the tabs onto. It is removed
and `tests/freehold_gate_prompt.test.ts` holds the tabs on the primitive with no local
selected rule and the 40 px floor.

### THE LEAVE LINES SAID QUAY

Both rooms' leave lines still said the player steps back onto the quay. The English and its
five non-Latin fills now say town, the resolved tables are regenerated, and the golden's
events digest follows.

### THE RE-SHOOT, AND WHAT IT CAUGHT IN ITS OWN HARNESS

All 18 images, both producer manifests and the performance record were re-shot on
2026-09-23, TWICE: first at `ba8460e32f` (`aadff20b9f`), then, because the review rounds
below changed sealed inputs, again at `1c536218af` (`8618300332`), which is the record
now. The receipt seals 67 source inputs, 17 of them harness files (the harness's whole
local import closure, derived and pinned). Every image was read by eye, both times. The
trees, stances, cameras, diagnostics and counters are in
`docs/freeholds/interiors-implementation-evidence.md`, last section. The harness grew a
receipt that refuses a frame on every conjunct it checks (each with its own refusal row
and near miss), a raycast probe that meets the arch's own mesh at three points with
nothing in front, a DOM census (controls on top, focus, transient HUD and arrival
overlays), and one shared greeting-decline selector with a scan over `scripts/` (the old
entry pass clicked a greeting's first button, which ACCEPTED the ferry guidance note).

Harness defects the capture exposed, each fixed test-first: dismissals after the prompt
opened took its focus; the chase camera could open a frame swung round in front of the
player (a walk-out retry failed at a software frame rate because `camera_follow.ts` caps
automatic yaw per frame, a W+S hold hit the sim's zero-vector path, and the settle now
holds Turn Left + Turn Right in one page task and refuses under Mouse Camera, mouselook or
attack-move); a leave carried the player past the gate's reach before the reopening press;
and the Cottage switch raced its own keystrokes under load (the perf tour failed that way
twice before the fix).

### THE COVERAGE REVIEW, AND TWO FIX ROUNDS READ FRESH

Four fresh COVERAGE reviewers read `190329610f..551e6493be`: qa-checklist,
test-coverage-auditor, frontend-seam-reviewer and a fresh general reviewer. None
found a blocking defect. Their should-fix findings: the capture seal missed
inputs that change the frames (six harness scripts the capture loads, the grass
ring's own file, the gate's spawn and press path, the offline host flag and the
chase camera); the gate prompt's selected tab lost its only non-color cue under
forced colors; the receipt's second baseline check and its placement check were
reached by no test; a gate frame off the stance along z alone was accepted
(stance z-term mutant survived); and the evidence doc and this packet's rows
carried claims the committed records contradict. ONE finding was refuted: the
frontend lane said nothing drives the online mirror through the gate's draw and
pick cores, but `tests/server/freehold_wire.test.ts` does, from the server's own
wire.

Applied in `9a7c42a8aa..7b6e10ba35`, each mutation-checked: every bloom now keeps
out of the town grass exclusions (a new behavioural suite found two meadow
flowers inside the gate's circle on a lit host, which the old tuft-only check
could not see); a forced-colors underline for the library's selected tab; the
probe must meet the arch's own mesh at each point; the seal derives and covers
the harness import closure and holds every baseline frame to the stance (the
dead overworld conjunct went with it); the camera settle checks the key
bindings; the perf tour checks the stretch from the gate's reveal to the inn
entry and fails the leave window closed; the census refuses an arrival overlay
landing after the last settle pass; the capture target follows the files that
decide the grass and the press; and the clearance, turn-pair, hello-flag and
importer pins. The two recorded sealed-comment nits were carried in the same
round, and two pre-existing em dashes in `src/game/interactions.ts` (now sealed)
were removed.

A fresh reader of THAT round found no blocking defect and nine findings, all
applied in `004049c1ce..e6df007602`: the settle read only the first held action
on a key, so a layout that also bound A to a strafe passed (it now requires each
key to drive exactly one held action, over a list pinned to the bind table); the
receipt comment claimed a check its notice equality cannot make (reworded: the
gate frame's focus check is what refuses a dismissal after the press); the
running-realm NPC case asserted movement that does not happen (it now pins the
measured closest spawn exactly); the Evergarden bed pass was the one bloom pass
left unchecked; every bloom read all 124 exclusions (each chunk now tests its
own exact short list); the forced-colors cue is now proved from the computed
style in Chromium; a stale comment, the `when` list's stated purpose, and an
optimistic hello-test comment.

A third fresh reader, of THAT round, found the one real defect in it: the chunk short
list reached 3 yd, but a four-rep bloom strays up to 2.65 yd on each axis, 3.75 on the
diagonal, so a corner bloom could miss an exclusion the list had dropped (latent: zero
disagreements measured over the built-in world), and nothing pinned the reach. Fixed in
`77afa71a35` by removing the dependency rather than tuning the number: a point beyond the
reach reads the whole list, so the test is exact everywhere and the reach sets only
speed. The same reader corrected four comments that claimed more than their checks
(`1c536218af`). A fourth, final reader proved the exactness (the containment bound for a
turned box, both boundary comparisons, one million randomized points with zero
mismatches) and found only comment nits and one uncovered boundary, all applied in
`01518e8eaf`; its should-fix, a test comment citing this ledger for the reconnect grass
limit before this ledger recorded it, is closed by the RECORDED section below.

Every fix in the three rounds was mutation-checked; the survivors each earned a case
(the stance z-term, an in-reach reopen, the anchored-bloom padding band, the importer
comment strip, a turned box's padded corner, the always-whole-list fast path and the
point-side threshold), and each then died.

### THE MEASUREMENTS

- The capture: 18 frames and the performance record, final set `8618300332`, every
  number in `docs/freeholds/interiors-implementation-evidence.md` (last section).
- The terrain corpus tail: 2 of 2 on Linux x86_64 glibc 2.36 (`node:26-bookworm` under
  `--platform linux/amd64`), beside the aarch64 run each re-mint recorded.
- The shard weights: 474 unmeasured test files carried at the median of three local runs armed against Postgres (`7cf74b411d`; table coverage 1.0, 4,538 of 4,538, against the 0.918 floor).
- The gate: the gate AS WRITTEN cannot pass on this host. Its first step's `sfx:check`
  spawns ffprobe-static's darwin/arm64 binary, which is an x86_64 Mach-O, and this
  macOS 27 machine has no Rosetta (spawn error -86; `arch -x86_64` refuses too); the
  conformance paths refuse operator overrides by design. This branch changes nothing
  `sfx:check` reads (no path under `public/audio/sfx` or the conformance code among the
  1,801 changed). So every other step of the gate's own list was run from its own step
  builder, armed with `TEST_DATABASE_URL` alone: the dependency-sync preflight, the
  generators, i18n and manifest freshness, the malware scan, biome on the changed files,
  browser regressions (53 files, 452 tests), typecheck and the env, server, bot and
  client builds, all green. The full suite (the planner fell back on the 1,801-path
  diff) at `3646254bb9`: 4,548 files and 68,154 tests passed, 2 expected failures, 28
  skips, and 22 tests in six audio files failed, every one on that same spawn error -86
  (`raid_boss_voice_assets`, `sfx_conform`, `sfx_export_core`, `sfx_ffmpeg_paths`,
  `sfx_studio`, `sfx_studio_server_security`). It also caught one real red, fixed in
  `3646254bb9`: the screenshot-reference corpus floor pinned at the sync merge (10,853)
  was never that merge's own count (10,709 by `git ls-tree`), so `ci_workflow` had been
  red on every tree since the merge; it now sits at the 10,729 this tree measures, where
  one file fewer reds it. The browser step rewrote 21 PNGs under `docs/screenshots/`
  (none in the re-captured set); they were restored, not committed. `tsc --noEmit` exit
  0; `npm run ci:changed` after the last commit is the final entry of this session.

### RECORDED, NOT APPLIED, EACH WITH ITS REASON

Kept out of the capture seal, by the rule the `when` list now states (the seal is
the curated inputs that decide what the committed frames show): `src/game/input.ts`,
`src/game/keybinds.ts` and `src/sim/player_motion.ts` decide only whether the camera
settle can run, and the settle refuses unless its preconditions hold while every
frame's record proves its outcome (stance, facing, camera); `src/sim/data.ts` merges
the gate site, which is sealed at its source (`src/sim/eastbrook_layout.ts`) and
whose merge `tests/freehold_layouts.test.ts` pins. Sealing those large, churning
files would mark the evidence stale at nearly every release for no frame change.

Measured, not enforced: the reveal soft-deadline and submit-stop counters did not
move in either first-draw window, but the perf check enforces only live-program,
attach-watchdog, gate-timeout, reveal-watchdog and touch-unproven; adding the two
would harden a software-renderer tour without a ruling. touch-unproven already
stands at 1 before the window on both profiles, so the check proves no NEW one.

Known limits, stated where they live: the procedural arch fallback's passage
triangulates filled (the browser draws the GLB; the probe and the grass circle
are measured against it), and on that fallback a click through the arch now picks
the gate, since the gate became pickable; the blade-grass carpet above the medium
tier is not cleared; the grass ring is built once per renderer, so a reconnect
whose hello flips the freeholds flag does not rebuild it (the next renderer
reads it right); the no-parallel-compile residual and the landmark entry cost on
constrained devices are unmeasured; the SwiftShader capture is visibility
evidence, not GPU cost; the polish seal does not include the visibility or
foliage cores; `door_portal`'s material name is untested; the golden lost its
POI visit marks because the drop lies outside both visit radii; the gate's tabs
sit on the library look without a `.ui-panel` under them, so their open bottom
edge floats (cosmetic, visible in the frames); `delve_interactable_visibility_core`
now decides visibility for every object view, not only delve ones (a rename is a
follow-up across its importers); the Evergarden bed pass's exclusion check is
latent (no shipped exclusion overlaps a garden bed, so no test can fail on its
revert; a source pin holds it); an older client shows the new leave line in
English until it updates (deploy timing).

Pre-existing or out of scope: `saved_pos_exit`'s `leaveOffset` bug in other
dungeons; the literal `'freehold_gate'` in UI modules this packet did not touch.

History, not fixable in place: some commits in the range are red between (the
committed-evidence pin is red from each sealed-input change until the next
receipt; bisect across them with care). Commit bodies that overclaimed or
mislabelled are corrected here rather than rewritten: `ca325559eb`, `5cc9d3986b`,
`742523fbc4` (counted two garden beds where four stood within the 10 yd sum),
`2e31fbb91b` (type), `d69ce0fd43`, `a11c1446ad`, `1ef85c2d3c`, `ba8460e32f`,
`004049c1ce` ("answers exactly" held only within 3 yd until `77afa71a35`), and
`c162e730be` (the shared-key layout it says walked cannot be held by the shipped
bind table; the check is hardening against a foreign store).

### STILL OPEN, IN ORDER

1. THE 07 HARNESS-FIDELITY REWRITE, which is why 07's QA verdict is still FAIL: the store's
   test harness lets `serialize` and `liveRev` contradict `hasLive`, so cases can model a
   liveness state the server cannot produce (ROUND SEVENTEEN).
2. `Sim.addPlayer` is not atomic, and the release widened it: `seedAccountLedgerSelf`
   runs after `addEntity` and the freehold seed, and the join's catch only releases the
   binding.
3. The release's account ledger is cross-realm, so a character on a dark realm (D85) can
   show Hearth relics and earn cosmetic Reliquary deeds from lit-realm finds: a ruling.
4. Phase 17 needs its re-plan onto the account ledger (recorded in `phase-17-trophies.md`
   and D48).
5. A new release sync, if `release/**` moves again.
6. FERNANDO: confirm the chosen margins that placed the gate at `(-38.65,-103.75)` rather
   than the nearer `(-37,-103.5)`.
7. The gate as written needs Rosetta on this macOS 27 host (the bundled "arm64" ffprobe
   is x86_64): `softwareupdate --install-rosetta --agree-to-license`, then re-run
   `node scripts/gate_select.mjs` armed to close the `sfx:check` step and the 22 audio
   tests, which every branch on this machine now fails the same way.

## THE RE-SYNC OF RELEASE/V0.44.0 AT ED69F62EF7, 2026-09-25

Everything in this section is local; nothing was pushed. Commits `484cb61a46..HEAD`.

### THE TWO RULINGS THIS SYNC CARRIES (Fernando, 2026-09-25)

1. The chosen gate-site margins stand ("do what's best for the feature and project"), so
   the gate stays at `(-38.65,-103.75)`. Open item 6 of the list above is CLOSED.
2. Rosetta is installed: `/usr/bin/arch -x86_64 /usr/bin/true` exits 0 on this host (checked
   at the start of this sync). Open item 7 closes with the armed gate below.

### THE MERGE

`release/v0.44.0` had moved 120 commits past `fc86d90234` and is still the version-newest
`origin/release/**` (the `resolveSelectBase` rule), at `ed69f62ef7`: the World PvP flag,
King of the Hill, Warfare Season 2, frame presets and HUD layout editing, the Viridian
Valestrider, the Thundercall rework and Nythraxis fixes. Merge `484cb61a46` takes it. No
patch, lockfile or `package.json` moved, so no reinstall was owed.

Sixty-four paths conflicted; every one was resolved by hand against both parents:

- Sources were unions, each read against both parents: the World PvP facet beside the
  housing facet in `src/world_api.ts`; the boot config's two new fields; `pvp_flag` and the
  hill dev arm beside `/dev freehold <tier>` in the help line; the furnishing refusal ahead
  of the release's class-lock in `canEquipItem`; the spectator guard ahead of the furnishing
  predicate on all three action bar paths; the housing and frame-preset catalog blocks
  (the release's hunk shared the housing block's closing brace, restored by hand).
- Two double extractions collapsed onto the release's module: the per-entity wire cache
  (`server/entity_wire_variant.ts` retired onto `server/entity_wire_cache.ts`, its suite
  moved to `tests/server/entity_wire_cache.test.ts` with a pin that the twin stays retired),
  and the release's `WPVP_WIRE_INTERVAL_TICKS` moved into this branch's
  `server/wire_cadence.ts`. `sim.ts` keeps this branch's quartermaster extraction
  (`reserved_surface_npc_bootstrap.ts`) and takes the release's new pvp imports; `hud.ts`
  drops the mouseover import the release moved to the focus-target controller.
- Reliquary page order: the release's `conquerors_vanguard_gallery` comes BEFORE this
  branch's unreleased Hearth pages, which stay at the true tail.
- The release's `ru_RU.ts` ships a broken `hudChrome.noticeboard.officerEntry` (an
  unrelated frame-help paragraph appended to `{name} ({rank})`, from `bca0c1eb07`). The
  merge keeps this branch's correct value; the release still ships the broken one, owed
  upstream.
- Generated artifacts were regenerated (`i18n:gen`, `wiki:content`), the Eastbrook polish
  provenance was re-minted by its own script (the release moved `renderer.ts`), and the
  shard table took the release side, to be re-carried.
- Every re-pinned count was measured on the merged tree. THREE were same-delta traps, lines
  both parents moved by the same amount so git merged them silently: the art-subject hotbar
  inventory (both at 102, merged 103), the tick profiler's base lap names (both at 35,
  merged 37) and the IWorld facet count (both at 34, merged 35). The full armed suite on
  the merged tree also caught two composition reds, folded into the merge: the
  reconnect-hook fixture lacked the release's `focusTargets` member, and the lap-name pin.
- Monolith rows re-pinned to the exact merged counts, none raised past either parent:
  `hud.ts` 18097, `sim.ts` 11598, `main.ts` 11144, `server/game.ts` 9762 (later lowered to
  9758), `online.ts` 5490.
- Item art: 1310 catalogued owners and 1328 live definitions, re-measured by
  `node scripts/item_art_audit.mjs --verify-only`; the blob chain moved by the release's
  13,518 bytes (22 for the Valestrider's reins id, 13,496 for the Warfare Season 2 stock).

### WHAT DID NOT NEED A RE-MINT

- The terrain corpus (`tests/terrain_height_parity.test.ts`) and every parity golden,
  `freehold_claim` included, are byte-identical on the merged tree: the release touched
  no input they read, so neither was re-minted.

### THE AUDIT (release-merge-audit, four fresh lanes)

Four read-only lanes read `484cb61a46`: sim and server overlaps, client overlaps, test pins,
and planning-doc premises. Applied, each with a test where the change is code:

- `080881ef1c`: World PvP made every freehold room fightable ground (the instance plane
  reads as contested), so two flagged characters in one room could kill each other. A home
  is now a sanctuary in `worldPvpZonePolicyAt`, the one lookup the sim hostility arm and
  the client verdict share.
- `964c6fa2e9`: the release's Vitality rule switched honor gear's health bonus off across
  the instance plane, so walking through the gate flipped max health. Owner rooms keep it.
- `194040139f`: `FurnishingItemDef` bars `classLocked` and `requiredClass` (type-level pin).
- `0590197d8d`: the jail table's header, left in `game.ts` when the table moved to
  `server/freehold_wire.ts`, moved beside it; `game.ts` lowered 9762 to 9758.
- `3e2125763a`: five pin comments corrected; `20f699cd85`: the premise lane's doc
  corrections (homes as sanctuaries in the visit, guild and ward phases; the Fenbridge
  gate on contested ground; the phase 17 ledger re-plan; the release's `rift_regions.ts`
  extraction; stale anchors; the dead PR #3872 sync arm).

Recorded, not applied: `/pvp on` works while jailed and the `social` self-wire bucket label
omits `wpvp` and `hill` (both the release's own code, not the merge's); the King of the
Hill ring has no prewarm entry (release-side); an unused `targetPortraitKey` import and the
focus frames' missing /pvp arm (release-side).

### THE CAPTURE EVIDENCE: A RE-SHOOT, AND WHY A RE-HASH WAS WRONG

The merge moved eight of the 67 sealed inputs. A per-input reading found none that could
move a frame at the harness defaults, and a re-hash was committed on that basis. A probe of
the after leg REFUTED it before anything cited it: the release's frame presets work
(`bca0c1eb07`, in the UNSEALED `src/ui/movable_frame.ts`) removed the unit frame's corner
move toggle, visible in every sealed after frame. The re-hash commit was withdrawn and the
whole set re-shot at `1910fd578c` (`d6f4a78277`), after the audit's fixes had landed so no
sealed input would move under it. All 18 frames were read by eye; the numbers are in
`docs/freeholds/interiors-implementation-evidence.md`, last section. LESSON: the seal is a
curated list and misses the generic HUD, so a re-hash judgement needs a probe compared
against the sealed frames, never the per-input argument alone.

### THE SHARD WEIGHTS

The merge took the release's table, which dropped this branch's carried rows and lacks the
release's unharvested suites (coverage 0.8949 against the 0.918 floor). 482 rows were
carried at the median of three local runs armed against Postgres (`2626e851b0`), plus one
suite added after the carry (`c7c2494b8e`): 4571 rows.

### THE FRESH READS

A fresh reviewer read the merge resolution and every fix up to `20f699cd85`: nothing
blocking, every hand resolution keeps both parents' intent, the two sim fixes cover every
consumer of the lookups they change, and each pin fails on its mutant. Its findings, all
applied in `1e8616202d..1910fd578c`: the three inlined owner-room checks became one helper,
`isOwnerClaimRoomAt` beside `dungeonAt` (the rule of three); the sanctuary suite now pins
the self readout, the arrival notice and the aid rule too; the pvp module guide and the
Warfare design doc record both exceptions; the jail header was scoped; and doc precision
(set membership derives from the ledger only for sets whose members are all catalogued
relics; the Vanguard page's items, not the page, are class-locked; the literal room pins;
the kill switch; the dependency-block step; a lighting gate; the blob gotcha).

A second fresh reader read that round: nothing blocking; three should-fix (the jail
header's Dungeon Finder premise was false, finder formation never teleports; phase 18 said
the zone pass stops on a disabled realm, when it runs and only skips its notices; the
refactor moved the sealed `dungeons.ts`, which the re-shoot at `1910fd578c` already
covered) and nits (six STEP 0 lines had lost their verb, long lines, the helper test's
band centres, the notice channel, `RUNTIME_MOUNTED_FRAME_IDS`, blob units, one suite
missing from the weights table). All applied in `e6f79ea3e7..afdcbff1c1`, the band-edge
and notice pins mutation-checked.

A third fresh reader read THAT round: nothing blocking; two should-fix, both applied in
`91eb7de70f..b2b85e9b1b`. The Cottage's east band edge rounds into an empty band, so it
could not kill the `<= 300` mutant its comment named; the shared Inn/Cottage edge now
does, proven with the Inn probe removed. The jail header pointed at a ledger entry not yet
written; it now names this file, and this section is the entry. Its nits (a Warfare
paragraph half-quoted and unwrapped, two long lines, ragged wraps, the blob gotcha's
sources) were applied too, and the reflow was verified token for token.

### THE GATE

The first armed run, at `afdcbff1c1`, failed at its dependency-sync preflight: an audit
lane had left a self-referential `node_modules/node_modules` symlink, so `npm ls` read
every package as missing. The link was removed and the gate re-run on a quiet machine:
`GATE_EXIT=0`, ALL 12 STEPS GREEN, `sfx:check` included (Rosetta runs the bundled x86_64
ffprobe), the planner falling back to the full suite on a 1,807-path diff: 4,587 files
passed and 1 skipped, 68,686 tests passed with 2 expected failures and 28 skips, the 22
audio tests among the passes; browser regressions 56 files and 483 tests; the malware gate
9,977 files and 0 high. OPEN ITEM 7 IS CLOSED. The browser step rewrote 21 PNGs under
`docs/screenshots/` (none in the re-shot set); they were restored, not committed. The
final code tip `b2b85e9b1b` was gated again: `GATE_EXIT=0`, all 12 steps green, with the
same full-suite and browser counts. `npx tsc --noEmit` exit 0; `npm run ci:changed` after
the last commit is the final entry of this session.

### RECORDED FOR THE RELEASE OWNER OR A LATER PHASE, EACH WITH ITS REASON

- The Dungeon Finder queue (`df_queue`) is not in the jail table on either parent. Finder
  formation only builds a party and never teleports, and the jail sweep re-cages a
  prisoner, so the most it allows is holding a group seat, as an accepted party invite
  does. For the release owner.
- The broken `ru_RU` `hudChrome.noticeboard.officerEntry` above, for the release owner.
- The two compositions (a home is a sanctuary; Vitality stays on in a home) change modules
  the Warfare and World PvP owner holds. Both follow the owner's own wording ("never in
  dungeons or raids; it works in other contexts"; the open-world policy "must never leak"
  into an instance) and both are one line to reverse, but that owner should confirm them.
- The World PvP copy (`hudChrome.worldPvp.groundSanctuary` and the guide) names only two
  sanctuaries; homes join it when housing lights (a tracked gate in `state.md`), because
  the live copy must not advertise an unlit feature.
- Duels are still allowed in a room (pre-existing; phase 18 owns the decision). The
  Fenbridge gate stands on contested ground (a ruling owed before 25a builds). Whether the
  class-locked Warfare Season 2 sets and the personal pages are trophy sources is a ruling
  owed at the phase 17 re-plan.
- The maximal character blob has 2,277 bytes of headroom left under its warn threshold; the
  next content wave forces a threshold decision (a `state.md` gotcha).
- One stray self-referential symlink (`node_modules/node_modules`), left by an audit lane's
  export, made the gate's dependency preflight read every package as missing on the first
  gate run. It was removed and the gate re-run. LESSON: an audit lane that symlinks
  `node_modules` into an export must not write through it; check for stray links before a
  gate.

### STILL OPEN, IN ORDER

1. THE 07 HARNESS-FIDELITY REWRITE, which is why 07's QA verdict is still FAIL (ROUND
   SEVENTEEN).
2. `Sim.addPlayer` is not atomic, and the release widened it again: beside
   `seedAccountLedgerSelf`, the restore path now also runs `loadHonorState` and
   `loadWorldPvpState`, the latter writing the shared `ctx.worldPvpBooks.nextDisarmAt`.
3. D85: the release's account ledger is cross-realm against dark realms (a ruling).
4. The phase 17 re-plan onto the account ledger, now also owing the trophy-source ruling
   above.
5. A new release sync, if `release/**` moves again.

## THE HARNESS-FIDELITY REWRITE, AND THE TWO PATHS IT FOUND, 2026-09-25

Everything in this section is local; nothing was pushed. The work is
`37e6ae6624..3686434478` (the commits from `a8301e8798` on), plus the records commit
that follows it. The base did not move: `git fetch --prune origin` found
`origin/release/v0.44.0` still at `ed69f62ef7`, the version-newest release branch and
already merged, so no sync was owed.

### THE DEFECT, AND THE REWRITE

ROUND SEVENTEEN's Q3 is CLOSED. The store's harness bound its four liveness reads
separately and let `serialize` and `liveRev` contradict `hasLive`, so cases modelled a
liveness state no realm can produce. Production reads all four off one map. So now does
the harness:

- `a8301e8798` moves the four reads out of the composition root into
  `server/freehold_liveness.ts` (`freeholdLivenessPorts`), bound by the root over
  `deps.sim.ctx` and by the harness over its own `ctx.freeholds`. A record is live for all
  four or for none. The module has its own suite, `tests/server/freehold_liveness.test.ts`.
- `ddeefdcb19` rebuilds the harness on that one map, with the two moments a login has. At
  PRELOAD nothing is live for a fresh login. At the JOIN the production functions run in
  production order (`bindFreeholdOnJoin`, then `seedFreeholdOnJoin`). A record leaves only
  through `removePlayer` at the last session out, and only after that session's leave
  flush (the harness throws otherwise). Its content moves only through `edit`, a
  sanctioned mutator: it needs a live record, never touches the identity, and never moves
  the revision backwards. A bare `retain` throws, because production only retains inside
  a join. `record()` answers a copy. No harness option can answer a liveness read:
  `expectTypeOf` proves it and `tsc` enforces it.
- A per-read AUDIT asks all four ports at every liveness read the store makes and records
  any disagreement; `afterEach` drains, reads, clears and fails the case that reached one.
  The gate is pinned WHOLE by its source text and as the file's only `afterEach`, the
  audit reader is proven to read every harness (the violation is planted in the middle
  of three), and each of the four sabotage directions is pinned to its exact first
  violation string.
- A row lives in a database (`rowRemembered`): it exists once inserted, the durable
  revision counts up as the column does, the compare-and-swap refuses what
  `upsertFreehold` refuses, an update keeps the name, and it serves one account. A
  double's refusal of a case bug is recorded where `afterEach` fails it, because inside
  the store the throw would read as a hold or a thrown write. The default reader answers
  each account its own row, as the unique `plot_id` index requires.

WHAT WENT RED, measured before any case was touched: with the old options ignored at run
time, 75 of 211 cases failed, the wiring source pin among them. Removing the options
surfaced 67 compile sites. Converting every bare retain into a join (a retained session
with no record is a state the second moment rules out) reached further. In all, 125
cases changed or were added. No case was rewritten to go green by asserting less; where a
claim could only be reached through a state no realm produces, the case now reaches it
through a producible order, or says plainly what it can no longer show.

### THE CASES, AND WHY EACH ONE CHANGED

Grouped by the producible path each now takes.

- PRELOAD ADMISSION. Concurrent preloads collapse on an entry dropped by two sweeps (a
  handshake that never joined), not by a bare retain and flush. ADOPTS the live identity:
  preload mints, two sweeps collect the unretained entry, the join installs the answer
  and its retain re-reads, and the row is created under the first mint. REFUSES to name a
  row for a record it did not install: the handshake is refused a permit, the join
  installs nothing, retain re-reads, and the seed lands first. The already-live arm is
  reached in the leave window (the first session's flush collected its clean entry, its
  removePlayer has not run) and by a second character while the first is in the world;
  both now assert the join mark. The replay arms are reached by a handshake that died
  before its join.
- CLASSIFICATION, THE SWEEP, THE FIFO. The eight hold cases join on the hold, seed the
  stand-in, and try every write door, the whole leave included. The not-yet-loaded write
  block is a join whose retain recreated the collected entry and re-reads, with the read
  held open. "No live record" is a handshake that read and never joined, now asserting
  `writesWithoutRecord`. "Live record" cases use the joined record and edits. The
  BACKWARDS probe is built with `rejoinBeforeRemoval` (another realm advances the row;
  this realm's entry re-reads it through the already-live arm while the record stays).
  The seeded-default write asserts its name and wire revision.
- COALESCING, REFCOUNTS, ERROR RUNS. Held and refusing stores are driven by edits.
  Reference cases use whole leaves and a second character joining. The same-account swap
  reads the new character's handshake while the old one is in the world, then leaves and
  joins on one tick. "Never replays a quiesced entry": the reachable rejoin is a second
  character (the already-live arm); the replay arm's blocked guard is pinned on source
  beside it, because one realm never holds a quiesced entry with no record.
- THE SEAL. The seeded-default refusal uses `rejoinOverEviction`. The foreign-identity
  case uses the only foreign identity a record can carry, the stand-in, furnished back to
  the entry's content at a revision ahead, so only the name differs. The write-allowed
  cases (the loaded record, the first insert, no durable row) use the installed default
  and assert both fences, identity and content.
- THE LEAVE RESERVE AND THE CAPTURE. Leavers and captures come from logins, edits and
  whole leaves; the second-leave cases use two characters whose leaves both stop at their
  deadlines, so the record is evicted before the second write. "Drops the capture once
  its write settled" keeps a second character resident so only settle can release; its
  old second half (evicting while a sibling is in the world) was not producible and is
  dropped with the reason in place. The capture-versus-record cases were rebuilt in
  production order (the returning handshake reads while the leaver is in the world; the
  leave; the captured write; the join seeds; retain re-reads). The five reseed cases use
  `rowRemembered`, `rejoinOverEviction` and edits. "Releases the capture only when the
  live record CARRIES it" builds three worlds, one per moment. "Writes the LIVE record,
  never a capture" was retitled from "once a record exists again", because a second
  character keeping the record is the only reachable meeting of the two at a write.
  "Never lets a captured document shadow a later live edit" refuses the leave write so
  the capture is still outstanding when the later write samples.
- THE REST. The re-arm-after-eviction case lets the leave stop at its deadline and evicts
  BEFORE the running write commits (the old form let it commit first, so the re-arm read
  the live record). The dark realm answers what `main.ts` answers. The many-owner cases
  log in each owner with its own row. The abandoned-read cases join in the order the
  pipeline runs them. The codec case measures through the `onSerialize` observer and
  three edits. "Stops owing a write" is a handshake that never joined, collected by settle
  itself. The wiring pin was rewritten for the extraction.

### THE ELEVENTH PATH, FOUND BY THE FIRST FRESH READ

- R1 BLOCKING (identity), and the one invariant. Preload's already-live arm answers with
  no state, because the record beside it is the truth. For a FRESH account whose first
  insert has not landed, that answer is also durable-revision-null and hold-null, which is
  how an absent row reads to the install's absent arm. The handshake awaits the lease and
  the character read between its preload and its join, so the previous session can
  finish leaving and `removePlayer` can evict in between; the join then installed an
  EMPTY default under the account's real minted name.
- MEASURED against the real store before the fix, in two orders. With the leave write
  still pending: an empty row INSERTED under the minted name at wire revision 0, the
  leaver's furnished capture discarded, `quiesced` 0, `write_failures` 0, no error line.
  With the leave write committed: the house inserted at wire revision 3, then an EMPTY
  document compare-and-swapped over it at wire revision 4, with no quiesce and no error
  line.
- The rewrite is what found it: the old port bag could not produce the order.
- FIXED in `05e89583c2` and made fail-closed in `607049fe3c`. The already-live arm marks
  both of its answers (`besideLiveRecord`, now a REQUIRED field every constructor
  states), and `installLoadedFreehold` puts a record in only on a positive `false`, after
  the clock merge. The seed then puts the stand-in down, and the seal or the insert
  refusal refuses it, the outcome a row account already had in the same order.

WHAT THE FIX COSTS, stated rather than hidden and pinned as it behaves: the joining
session plays on the empty stand-in, write-blocked for the session; and a leaver's
capture still waiting when the join lands is released unwritten, so the leaver's last
edits reach no row. For a fresh account that capture is the whole first house, and there
is no row to fall back to. It is reached by a quick relog onto another character while
the old leave is slow, or by a linkdead session's grace expiring while a new handshake is
in flight. Recovering the capture needs the join to ask the store again after the
eviction: a RULING IS OWED (below). DEPLOY.md and `held-plot-surface-scope.md` now state
it.

### THE TWELFTH PATH, FOUND BY THE READ OF THAT FIX, AND ESCALATED

- F1 BLOCKING (identity), OPEN. The mark keys on whether a record was live when preload
  read, but the hazard is whether the answer went STALE before the join. An answer read
  with NOTHING live goes stale the same way when another session of the same account (a
  second character, which `planJoin` does not count until it joins, or a GM) joins,
  edits and is evicted inside the handshake's lease and character-read window. It also
  breaks the premise the seal's `revisionRegressed` and the probe rest on, that every
  install a rejoin is offered carries at least the committed revision; the seal, the
  probe, the contract and the phase 07 QA plan now state the hole beside the premise.
- TWO ORDERS, both MEASURED and pinned as KNOWN DEFECT cases that a fix flips.
  - THE UNWRITTEN ORDER (found by the fourth fresh read, widened by the next three): the
    other session's capture is still UNWRITTEN when the join lands, so the store still
    holds it. Its leave write may be waiting on a permit (the leave deadline is shorter
    than the permit wait, so `removePlayer` evicts first), refused a permit or thrown
    once (either keeps the entry dirty, so the join can land a whole sweep interval
    later, and longer if the failures repeat), or deferred behind the active-write cap
    (launched the moment a slot frees). The join installs the stale answer, `retain`
    keeps the capture (the record does not carry it), and when the store's next write
    samples, the live record outranks the capture. When the store's entry knows NO
    commit above the stale revision (neither the leaver nor an earlier session saved
    past it), NO EDIT IS NEEDED AND THERE IS NO WINDOW: a fresh account gets an EMPTY
    row inserted under its minted name at wire revision 0; a row account gets its OLDER
    house written back (the other session's revision-8 table never reaches the row). No
    quiesce, no failure, no error line; the capture is released. When the entry DOES
    know one (the leaver's own mid-session save, or an earlier session's that the
    leaver's fresh read learned; what decides it is the commit, not who made it), the
    stale record sits below it: the seal refuses the write and the leaver's later edits
    are lost, LOUDLY, unless the joiner reaches that commit's revision before the write
    samples, and then the stale house is written over the committed one too, silently.
    Pinned: the waiting write for both account shapes; the refused permit, the single
    throw and the deferred write for a fresh account; the known commit, loud and silent,
    from both sources and for both shapes; and a further arm: a joiner who LEAVES before
    the write samples, whose own leave flush replaces the capture with its stale record.
    That arm matters to the fix: a mutant that makes the write prefer the capture flips
    every other unwritten-order pin and leaves this one standing. UNPINNED, each on a
    mechanism a pinned case already drives: the row-account shape of the refused,
    thrown, deferred and joiner-leaves-first forms; the known-commit arm in its
    non-waiting forms; and the held cost below for `cap_full`, `no_budget` and
    non-waiting captures.
  - A KNOWN COST in the same order, loud rather than silent: a login HELD while nothing
    was live (on capacity, `no_permit`, `cap_full` or `no_budget`, or on a thrown read,
    `read_threw`, the likeliest hold in the very stall that slows a handshake) that joins
    after the other session's eviction installs nothing, the stand-in is seeded, and the
    store's next write is refused on it: by the seal (`write refused (identity)`) over a
    row, by the insert refusal (`write refused (unnamed)`) before one exists; quiesced
    either way. The leaver's unwritten capture is released, however its write failed.
    Pinned for `no_permit` and `read_threw` on both account shapes.
  - THE COMMITTED ORDER: the other session's write has committed. A stale absent answer
    installs an empty default under the minted name, and a joiner who edits past the
    committed revision gets an EMPTY document compare-and-swapped over the house (expected
    durable revision '1', wire revision 4, the row read back empty); a stale row answer
    overwrites the newer house the same way (wire revision 9). Silent.
- WHAT REFUSES THE COMMITTED ORDER, and why it is not a bound. The sweep's probe arms on
  ANY difference from the committed revision except equality, and the seal refuses a
  record STRICTLY below it and quiesces the entry for the session (two cases pin it, and
  the row then keeps the house). So the overwrite needs the joiner to REACH the committed
  revision before the first write that holds a permit samples the record: retain's reload
  plus one `AUTOSAVE_SECONDS` interval when the pool is not saturated. It is not a time
  bound, and every widening is pinned for both account shapes: a write refused a permit
  books a failure without quiescing, so the next sweep re-arms and the window grows (a
  write deferred past the active-write cap grows it the same way, unpinned); a write
  ARMED while the record sat below that samples it once the joiner has reached the
  committed revision passes the strict seal and writes the older house with the wire
  counter unmoved; and with NO write armed, a record at exactly the committed revision is
  never seen by the probe, after which any later edit overwrites.
- WHY IT IS NOT FIXED HERE: every fix is a design choice with a cost the task did not
  authorize (below). The task's rule is to stop and ask for a genuine design ruling.

### THE FRESH READS, AND WHAT EACH ROUND FOUND

- THE FIRST READ covered `37e6ae6624..ddeefdcb19`: a producibility reviewer, a
  pin-decisiveness auditor, and six slice auditors tracing every changed case through
  production. It found the eleventh path (above); the audit gate itself unpinned; a
  harness whose rows no database could produce (a fixed row that could not remember an
  insert, and a normalizer answer detached from the row it came from); an unguarded
  `removePlayer`; `record()` handing out the live record; producibility claims overstated
  in several comments; several cases vacuous, mis-titled, or on a different arm than
  named; and nits. All applied in `05e89583c2` and `67a9dfc37c`. The first mutation pass
  over those fixes then found every account handed the one fixture row, pinned in
  `e94732535e`.
- THE SECOND READ was two readers. A coverage audit of `ddeefdcb19..e94732535e` found
  nothing blocking: six should-fix (a swap comment the body did not build, a one-line gate
  pin, a one-harness audit case, the row double's update renaming the row and serving any
  account, the refusal's cost half-stated, a vocabulary check compared with itself) and
  nits. A read of the eleventh path's fix `05e89583c2` found the twelfth path's committed
  order, the mark failing open (an optional field), the unloaded-entry mark unpinned, and
  stale docs. Applied in `607049fe3c` and `08c09640e0`; the twelfth path escalated.
- THE THIRD READ covered `e94732535e..08c09640e0`: no production bug. Five should-fix:
  this section did not exist yet (every new pointer dangled); the vocabulary pin was still
  vacuous (a literal list tested only against the one kind observed); the twelfth-path
  statements left out what refuses it; DEPLOY.md and the scope doc understated the relog
  cost; two premises still stated without the hole. Nine nits: the audit planted where a
  last-harness reader survives; the unloaded-entry mark unpinned; the row double's account
  guard undriven, its advance type widened back, and a double's throw swallowed by the
  store; the twelfth-path pins not exact; three test doubles missing the required mark
  behind casts; the stand-in case list incomplete; the linkdead order missing; long
  lines; the gate pin blind to an early return or a guard. All applied in `926e280977`,
  `21641d9af8` and `9102e3d50d`. Outside the diff: the file's `AbortSignal.timeout` patch
  claimed an `afterEach` restore that never ran (now restored in `afterAll`), and
  `tests/server/http/game_metrics.test.ts` says "the four fixed kinds" where the
  vocabulary has nine, which is RECORDED, not applied: that suite is not this task's.
- THE FOURTH READ covered `08c09640e0..9102e3d50d`: ONE BLOCKING, the twelfth path's
  unwritten order in its waiting form (above), which the round had described as bounded
  to one sweep with an edit needed. Five should-fix: the window off by one (reaching the
  committed revision is enough, not passing it); one autosave interval is not a bound (a
  refused permit and the active-write cap extend it); this section called a killed
  mutant equivalent; state.md and progress.md claimed a gate and reads the tip had not
  had; the no-hold write-blocked group missed the players who see an OLDER house (the
  refused twelfth-path install and a superseded capture). Ten nits: a round-two
  attribution, a commit range that dropped its first commit and named a moving `HEAD`,
  a pinned `AUTOSAVE_SECONDS` value, a wrong test path, the phase 07 QA plan still
  stating the old premise, count wording, a stale "two KNOWN DEFECT cases above"
  comment, overlong ledger lines, a second after-hook the gate pin could not see, and
  older open lists in state.md not marked done. All applied in `fce2a91990`,
  `40a34720ef` and this section: both waiting orders, the exact-revision boundary and
  the refused permit are pinned as KNOWN DEFECT, every statement of the window is
  rewritten to what actually refuses it, and the ruling's options below are re-stated
  against the waiting order.
- THE FIFTH READ covered `9102e3d50d..8cf04d3cd9`: nothing blocking, the four new pins
  decisive and producible. Six should-fix: the waiting order was described too narrowly
  (a refused permit, a single throw, a deferral and the joiner leaving first all keep the
  capture unwritten, and none was pinned; a fix scoped to the leave write would have left
  them open); "a record at exactly the committed revision is neither written nor refused"
  was false with a write already armed (it writes the older house); option (a) does not
  keep the leaver's edits even when it counts the capture, it only makes the loss loud;
  option (b) needs the re-ask and the install to be one synchronous step; a stale
  capacity HOLD loses the waiting capture too; the probe's comment misstated what it
  misses. Seven nits: DEPLOY.md's "older house" is the empty default for a fresh account;
  "only after-hook" should say `afterEach`; the mutation record missed a first-pass
  survivor; the older state.md open lists still read open and ran long, as did lines in
  the phase 07 QA plan and one test comment; this read's own summary dropped the pinned
  `AUTOSAVE_SECONDS` value; the refusal window's base is retain's reload plus an
  interval; and the boundary pins covered only row accounts. All applied in `0d5c2a726b`
  (whose title, "pin every unwritten-capture order", overstated it: the deferred and
  mid-session arms were pinned only after the sixth read),
  `3bdf1aa229` and this section; each widened order and the held cost was reproduced
  before it was pinned. PROCESS NOTE: the reader briefly copied files from the tip into a
  directory in the session scratchpad and deleted it, against its read-only brief; the
  repository was untouched, and the tree was confirmed clean.
- THE SIXTH READ covered `8cf04d3cd9..6df31d838a`: nothing blocking, all five new pins
  decisive and producible, the 218 and 68,729 counts and every range confirmed. Four
  should-fix: a leaver that COMMITTED mid-session reaches the same loss, loudly or (if
  the joiner reaches that commit first) silently, and was neither named nor pinned; option
  (b)'s "one synchronous step" cannot hold in the committed order, where the re-ask is a
  durable read a sibling session can outrun, so the answer has to be validated against
  the entry at install time; the deferred form was pinned in neither order although
  state.md, progress.md, a commit title and two comments said or implied every order
  was; the held-login cost left out `read_threw`, the fresh account's `unnamed` refusal,
  and the non-waiting captures, and read as pinned for every kind. Seven nits: the second
  leave mutant also kills the re-capture case; a mutant was named for the unmutated
  behaviour; two checks in the joiner-leaves-first case could not fail; an older state.md
  line still read "open ... below ... see above"; three inline table literals beside the
  new `TABLE`; a fourth-read nit list that parsed wrongly; and the deferred form's timing.
  All applied in `6f2269c552`, `190b9b0b0f`, `a0e9fff2bc` and this section, each new arm
  reproduced before it was pinned (though `6f2269c552`'s title, "every held cost",
  overclaims as `0d5c2a726b`'s did: `cap_full`, `no_budget` and the non-waiting captures
  stay unpinned).
- THE SEVENTH READ covered `6df31d838a..a7f5470015`: nothing blocking, every new pin
  decisive and producible, the counts and ranges confirmed. Three should-fix: the loud
  or silent split is decided by a commit the entry KNOWS above the stale revision, not
  by the leaver having saved mid-session, so an earlier session's save that the leaver's
  fresh read learned reaches the same outcomes, unnamed and unpinned; progress.md and
  state.md still claimed every arm pinned; the scope doc never got the known-commit arm
  the commit body said it did. Seven nits: the seal mutant's kill on the deferred pin is
  incidental; the fourth read's nit count; option (b)'s constraint still loose (no
  synchronous replay exists, and a committed-revision check passes the unwritten
  order); `6f2269c552`'s title; the contract never stating the silent sub-arm; an
  overlong DEPLOY.md line; and two wording slips. All applied in `bc84cee7bb`,
  `3686434478` and this section; the earlier-session arm was reproduced first. Reads
  five, six and seven each found nothing blocking, which is the task's stop condition;
  this last round's fixes were mutation-checked and gated but not read again.

### THE MUTATION PASS

Every changed pin was run against a mutant of what it claims, on committed trees, by a
runner that applies one mutant, runs the store and liveness suites with JSON output,
restores through `git checkout` with retries, and asserts a clean tree.

- The rewrite itself: 75 mutants against a control of 224 passing.
- The first read's fixes: 114 mutants against a control of 235; every one of the 125
  touched cases is killed by its claim's mutant. Two SURVIVED that pass: a harness handing
  every account the one fixture row, which `e94732535e`'s one-row-per-account pin was
  written for and kills since; and deleting the unloaded already-live arm's mark, killed
  since by `926e280977` (below).
- The second read's fixes: 10 mutants over the fail-closed mark, the install's arms, the
  gate and the row double, plus four earlier ones re-run on the new tree. Two row-double
  mutants (an update that renames the row, a row serving any account) SURVIVED first,
  which is what `08c09640e0`'s row-database pin was written for; both are killed since.
- The third read's fixes: 13 mutants plus one type-level mutant, all killed, each on its
  claimed case: a grown fail-kind vocabulary, both already-live arms unmarked, a
  first-only and a last-only audit reader, an early return and a guarded matcher in the
  gate, the bug gate removed, an unrecorded or unguarded double, a row that keeps its
  layout, the seal's regressed arm off, and a forward-only probe. `tsc` kills a widened
  `advance`.
- The fourth read's fixes: 5 mutants, all killed on their claimed case: the capture
  outranking the live record at the write (flips both waiting-order pins), a probe that
  calls an equal revision moved (flips the boundary pin), a refused permit that quiesces
  (flips the refused-permit pin), a second after-hook that clears the bug list (the gate
  pin), and a seal that refuses an equal revision. The first pass's survivor that deleted
  the unloaded arm's mark is now KILLED by `926e280977`'s pin (deleting the override leaves
  the load's own `false`, so it was never equivalent).
- The fifth read's fixes: one new mutant (a second leave keeping the first capture,
  which flips the joiner-leaves-first pin and the re-capture case in the capture block)
  and five re-run against the new pins, each new pin killed by at least one: the capture
  outranking the record, settle never releasing a capture, a refused permit that
  quiesces, a probe that calls an equal revision moved, and a seal that refuses an equal
  revision.
- The sixth read's fixes: four re-run against the new pins, each killed by at least one:
  the capture outranking the record (the deferred pin, both mid-session arms, all four
  held costs), a seal that refuses an equal revision (the silent mid-session arm; its
  kill on the deferred pin is INCIDENTAL, through the cap-filling owners it refuses, since
  the pin's own write is a first insert the seal never judges), the seal's regressed arm
  off (the loud mid-session arm), and settle never releasing a capture (the loud
  mid-session arm and the held costs).
- The seventh read's fixes: the same four re-run against the earlier-session pins, each
  killed on its claim: the capture outranking the record (all four), a seal that refuses
  an equal revision (the silent arms), the seal's regressed arm off and settle never
  releasing a capture (the loud arms). The runner and its logs are session scratch, not
  committed, so these attributions are recorded here rather than reproducible from the
  tree.
- One mutant is killed without an assertion: the re-arm-on-failure mutant loops forever
  and crashes the vitest worker, so the suite goes red.

### THE GATE

The armed gate ran with `TEST_DATABASE_URL` taken from the main checkout's
`DATABASE_URL` alone, the arm proven first with one pg suite each time. `GATE_EXIT=0`,
all 12 steps green, the planner falling back to the full suite, at `e94732535e`, at
`08c09640e0` (4,588 files passed and 1 skipped; 68,715 tests passed with 2 expected
failures and 28 skips; browser regressions 56 files and 483 tests) and at `9102e3d50d`
(68,717 tests, the rest the same). And at `40a34720ef`, the last code commit: 68,721
tests, the rest the same. And at `3bdf1aa229`, the last code commit of the fifth read's
fixes: 68,729 tests, the rest the same. And at `a0e9fff2bc`, the last code commit of the
sixth read's fixes: 68,737 tests, the rest the same. And at `3686434478`, the last code
commit of the seventh read's fixes: 68,741 tests, the rest the same. The browser step
rewrote 21 PNGs under `docs/screenshots/` each time; they were restored, not committed.

### STILL OPEN, IN ORDER

1. THE TWELFTH PATH (a ruling), and with it every capture a join after the eviction
   loses (the eleventh path's cost, the stale capacity hold). Two shapes. (a) A
   fail-closed staleness check at the join: the install refuses any answer the store has
   since superseded, counting an OUTSTANDING CAPTURE as well as a commit. It turns every
   silent loss LOUD but keeps none of the leaver's edits: the stand-in is seeded, the
   waiting write is refused on it and settle releases the capture, so a row account ends
   with the same row as today's defect and a fresh account still loses its first house;
   it also write-blocks the healthy slow-handshake path. (b) The join re-asks the store
   for its answer after the lease and character read. It keeps the edits: the entry is
   loaded and holds the capture, so the replay arm offers it (recovering the eleventh
   path's cost and the held login's too). Its constraint: the answer the join installs
   has to be VALIDATED AGAINST THE ENTRY AT INSTALL TIME, not merely re-asked. That
   needs a new SYNCHRONOUS store call at the install, because `preload` is async even on
   its replay arms and a sibling's `removePlayer` can run in that gap; and the check has
   to count the outstanding capture or the dirty generation, as (a) does, because a
   committed-revision check alone passes the unwritten order. An answer from the
   already-live arm followed by the eviction reopens the eleventh path's cost, and in
   the committed order the entry is collected, so the re-ask is a durable read during
   which a sibling session can join, commit and be evicted again, which a liveness
   re-check cannot see; that read can also be refused on capacity (a write-blocked
   session, not a loss). It changes the join contract. RECOMMENDED: (b). RULED
   2026-09-25 (Fernando): (b), "we want this to be perfect". 07's verdict stays FAIL
   until (b) is built, reviewed and gated.
2. `Sim.addPlayer` atomicity (unchanged from the last section).
3. D85, the cross-realm account ledger against dark realms (a ruling).
4. The phase 17 re-plan onto the account ledger, with the trophy-source ruling.
5. A new release sync if `release/**` moves. The Fenbridge ruling is owed before 25a
   builds.

## RULING (B) FOR THE TWELFTH PATH, 2026-09-26

Everything in this section is local; nothing was pushed. The ruling is Fernando's, of
2026-09-25: option (b), "we want this to be perfect". This section was written in two
parts: THE SYNC and THE DESIGN before any code of the fix, the rest after.

### THE SYNC FIRST

`git fetch --prune origin` found `origin/release/v0.44.0`, still the version-newest
release branch, moved past `ed69f62ef7` to `9dbc47938a`: ten render-only commits, the
floor VFX ladder (PR 4113). Merge `b627c4ad32` takes it. No patch, lockfile or
`package.json` moved.

- Six paths conflicted, all Eastbrook polish provenance: the four evidence seals and the
  three pinned literals in the two polish suites. `renderer.ts` auto-merged, so the
  provenance was re-minted by its own script over the merged bytes, with both parents'
  comment history kept.
- The other three overlaps (`renderer.ts`, `scripts/pr_shot_targets.mjs`,
  `tests/architecture.test.ts`) carry exactly the release's delta: the merge's diff over
  the branch parent hashes the same as the release's own diff over `ed69f62ef7`.
  `renderer.ts` stays at 12782 lines, its exact ceiling.
- The release moved two of the 67 sealed capture inputs (`renderer.ts` and
  `pr_shot_targets.mjs`). A probe of the after leg from a frozen worktree at the merge
  (the protocol the 2026-09-25 re-sync set) found the room frames at the
  unchanged-tree level and every HUD element in place, so the two digests were
  re-hashed (`75bc308552`) rather than the set re-shot;
  `docs/freeholds/interiors-implementation-evidence.md` has the numbers.
- The release-merge audit: no route, WS command or injected helper in the delta; the
  ladder's own source scan (`tests/floor_vfx_layer.test.ts`) passes over the branch's
  render files, which set no floor renderOrder; no `server/db` mock arrived; no catalog
  or content moved. ONE PREMISE corrected (`5eb2aa01d1`): Phase 09's placement ghost is a
  floor mesh and now takes its order from the ladder, whose reticle band holds the
  ground-aim reticle the plan copies.
- Owed to the final gate: the release's new `tests/floor_vfx_layer.test.ts` has no row in
  the shard weights table, so it rides the one carry this change runs for its own new
  suites.

### THE DESIGN (written before any code)

THE HAZARD, restated in one line: the answer a join installs was read before an await
the handshake cannot close, and another session of the account can edit, leave and be
evicted inside it. Every KNOWN DEFECT and KNOWN COST in the harness-fidelity section is
that one hazard met in a different order.

THE TRUTH AT INSTALL TIME IS THE STORE'S ENTRY, when one is loaded, and the argument is
three facts about this store rather than a new mechanism:
1. every commit this process makes to the account lands in `entry.state`
   (`applyWriteResult`);
2. every leave whose write has not committed is held as `entry.leaveDocument` (the
   capture), taken while the record was still live, and it outranks the committed state
   (`offerCapture`);
3. an entry is collected only when it owes no work (`owesWork`: nothing running,
   pending, deferred, in flight, or dirty and unblocked), and nothing writes without a
   loaded entry. So once the entry is gone, the durable row holds every edit this
   process made, and a capture never outlives its entry.
A loaded entry at the moment of the install has therefore seen every edit this process
made to the account; with no loaded entry, the durable row has.

THE BUILD, three parts:
1. THE RE-ASK. The handshake's fresh arm keeps its first ask where it is (before the
   lease, so the durable read stays out of the lease-held window in the common case) and
   asks again AFTER the lease and the character read, as the last await before
   `game.join`, through the same `freeholdForAccount` port. The re-ask is `preload`:
   with the entry loaded it is a replay (no I/O); with the entry collected it is a
   durable read under the same bounds as any login (the admission cap, the 5,000 ms
   permit wait, the 10,000 ms whole-preload budget). A thrown re-ask falls back to the
   first answer; the resume arm reads nothing, as before.
2. THE VALIDATION, a NEW SYNCHRONOUS STORE CALL at the install:
   `answerForInstall(ownerKey, accountId, asked)`, called by `bindFreeholdOnJoin` before
   `installLoadedFreehold` and `retain`, all one synchronous run inside `GameServer.join`.
   Its decision is a pure function in a new module, `server/freehold_join_answer.ts`
   (the store is at its monolith ceiling, and the decision is the heart of the fix):
   - no answer (`undefined`: a caller with no handshake, or both asks threw): install
     nothing, as today;
   - an answer that is not an object or names another account: handed back unchanged,
     so the install's own guards refuse it, as today;
   - a LOADED ENTRY: the entry's answer NOW, whatever was asked: its identity, durable
     revision, hold and clock, and as its document the capture if one is held, else the
     last committed state, and none while the entry is blocked. This is what counts the
     outstanding capture rather than a committed revision, and it is preload's replay
     arm, taken at install time instead of before an await;
   - no loaded entry and a HOLD asked: the hold, which installs nothing, as today;
   - no loaded entry and a non-hold answer: WITHHELD. The entry that produced the
     answer has gone, so nothing in the store can vouch for it: no record is put in (the
     clock still merges), the sim seeds the stand-in, and the seal or the insert refusal
     write-blocks the session, loudly. No capture can be lost here (fact 3).
   A LIVE RECORD NEEDS NO ARM of its own: the install is load-once, so nothing installs
   beside a live record whatever the answer says, and deriving from the entry while a
   record is live is a no-op.
3. THE MARK. `besideLiveRecord` stays, RENAMED `recordWithheld` because its meaning
   widens: it is now what the WITHHELD verdict uses to put no record in while the
   clock still merges, so the install's positive-false check becomes load-bearing
   rather than defense in depth. Preload's already-live arm keeps setting it on its
   own answers, as defense in depth for a raw preload answer handed to the install;
   no production join installs one any more, which the mutation pass is to show.

WHAT HAPPENS TO THE CAPTURE after the install: the installed record carries it, so
`retain`'s confirmation releases it (the live revision equals the capture's), and the
write that was owed (waiting, deferred, refused a permit, thrown once, or the next
sweep's) samples the live record, which carries the leaver's edits plus any the joiner
made since. A joiner who leaves first captures that same record.

EVERY ORDER IT MUST HANDLE, with the outcome expected:
- HEALTHY PATHS, unchanged in outcome: a first login (absent: the default under the
  minted name); a clean rejoin (the row); a second character while the first is in the
  world (load-once, the record is shared); a dark realm (no read at either ask, no
  record); a terminal data hold (installs nothing); the Hearth clock (merged forward from
  the answer installed). A CAPACITY hold at the first ask now gets a second chance at
  the re-ask, under the same caps.
- THE UNWRITTEN ORDER, both account shapes, in every form the ledger lists (the leave
  write waiting on a permit, refused one, thrown once, deferred behind the write cap, and
  the joiner leaving before it samples): the re-ask replays the entry, the capture is
  installed, and the leaver's house reaches the row; the joiner can write on top of it.
- THE KNOWN-COMMIT SPLIT (a mid-session or an earlier-session commit above the stale
  revision), loud and silent, waiting and not: the capture sits above that commit, so
  the seal has nothing to refuse and the leaver's later edits land.
- THE COMMITTED ORDER, both shapes, with the exact-revision, armed-write,
  refused-permit and deferred escapes: the leaver's commit collected the entry, so the
  re-ask is a durable read and the committed house is installed at the committed
  revision; a joiner edit past it is the joiner's edit on that house, and nothing stale
  reaches the row.
- THE HELD LOGINS (`no_permit`, `read_threw`, `cap_full`, `no_budget`) meeting a waiting
  capture: the leaver's own login loaded the entry, so the re-ask replays it, as the
  unwritten order.
- THE ELEVENTH PATH (the already-live arm, then the eviction), both of its forms: the
  committed form re-reads and installs the house; the waiting form installs the
  capture. The joiner can write; the cost the eleventh-path fix recorded is recovered.
- THE NEW CALL'S OWN FAILURE MODES:
  - A CAPACITY REFUSAL OF THE DURABLE RE-ASK: no loaded entry means no capture anywhere
    (fact 3), so the hold installs nothing, the stand-in is seeded, the repair reload
    loads the entry, and the first write is refused (identity over a row, unnamed before
    one), quiesced and loud; the committed house stays on the row.
  - THE SIBLING OUTRUNNING THE DURABLE RE-ASK: a re-ask that started beside a live
    record (the already-live arm with no loaded entry) whose record is evicted during the
    read answers marked, and the install derives the loaded entry instead, so the joiner
    gets the house. A sibling that joins during the read collapses onto the same
    single-flight read, so it cannot commit before this join installs.
  - A CONCURRENT EVICTION BETWEEN THE RE-ASK AND THE INSTALL (in production one
    microtask hop, which the store does not rely on): a leaver that still owes its write
    keeps the entry loaded, so the capture is installed; a leaver whose write committed
    and whose entry was collected meets the WITHHELD verdict, and the session is
    write-blocked, loudly, with the committed house kept.
- CROSS-REALM WRITES are unchanged: the compare-and-swap fence quiesces them.

WHAT IT COSTS: a durable read inside the lease-held window when the entry was collected
between the two asks (the committed order, or the orphan sweep on a slow handshake) or
when the first ask was held on capacity; worst case, a handshake's housing time is two
whole-preload budgets instead of one. The healthy path pays one replay and no I/O.

THE HARNESS FOLLOWS PRODUCTION: `login()` asks, re-asks and joins; a new
`joinAfterReask` is the fresh arm's tail; `rejoinOverEviction`, whose order (a join on an
answer read before the eviction, with no re-ask) no longer exists, becomes the one order
that still seats a stand-in beside an entry that knows the row: a re-ask refused a
permit after the eviction, then the repair reload. Every KNOWN DEFECT and KNOWN COST pin
flips to the fixed behaviour; every arm the harness-fidelity section left unpinned is
pinned; the new call's failure modes are pinned; each against its mutant.

### THE BUILD (`b77421251a`), AND WHAT IT CHANGED THAT THE DESIGN DID NOT NAME

Built as designed, test-first where a test could come first (the pure module's suite was
red before it existed; every KNOWN pin went red against the new code before it was
rewritten to the fixed behaviour):

- `server/freehold_join_answer.ts`: the pure decision (verdicts `none`, `refused`,
  `entry`, `held`, `withheld`), with `tests/server/freehold_join_answer.test.ts`, every
  verdict driven with literals and through the real install.
- `FreeholdPersistStore.answerForInstall`, synchronous, over a shared `replayAnswer`
  (preload's replay arm and the join's validation are one expression); a WITHHELD
  verdict warns `join answer withheld`.
- `bindFreeholdOnJoin` installs `store.answerForInstall(ownerKey, accountId, loaded)`;
  `FreeholdBindingStore` gained the method.
- `server/ws_auth.ts`: the re-ask after the character read, the last await before
  `game.join`, a thrown re-ask keeping the first answer. Pinned: two asks, the order
  `character, freehold, lease, character, freehold, join`, no `await` between the re-ask
  and the join (source pin), the fallback.
- `besideLiveRecord` renamed `recordWithheld` in every constructor and double.
- Paid for by extraction: `server/freehold_bounded_error.ts` and
  `server/freehold_row_document.ts`, each with its own suite; the store's ceiling
  LOWERED 2193 to 2150 (`tests/monolith_budget.test.ts`).

THE HARNESS: `login()` asks, re-asks and joins; `joinAfterReask` is the fresh arm's tail;
`refuseNextPermits(n)` is a saturated gate for exactly the calls a case names;
`rejoinOverEviction` is now a re-ask refused a permit after a clean leave (it throws if
the leave did not collect the entry). Every direct join left in the suite is handed an
answer read immediately before it, or says it is modelling the one await on purpose.

THE KNOWN PINS, rebuilt as one parametric block
(`a join installs the store answer at install time, never one that went stale in its
handshake`, 89 cases): the unwritten order over every form (waiting, refused a permit,
thrown once, deferred) x both shapes x no known commit, a mid-session commit, an
earlier-session commit; the joiner editing before the owed write samples (the old silent
arms); the joiner leaving first, every form and shape; the held first ask (`no_permit`,
`read_threw`, `cap_full`, `no_budget`) x every form x both shapes; the committed order
(the edit past it, a refused-permit re-arm, an armed write, a DEFERRED write) x both
shapes; both forms of the eleventh path; and the new call's failure modes (a durable
re-ask refused on each capacity kind, the sibling outrunning the durable re-ask, a
sibling sharing its one read, and an eviction between the re-ask and the install with
the write owed and with it committed). Every arm the harness-fidelity section listed as
unpinned is in it.

WHAT BUILDING IT FOUND, each recorded where the case lives:
- THE RE-ASK AND THE VALIDATION SPLIT THE WORK. The re-ask alone fixes every order whose
  window closes before it (the replay carries the capture; a collected entry is re-read);
  the install-time validation is what covers the one await the re-ask is (the eviction
  between the re-ask and the install, the sibling outrunning a durable re-ask). The
  mutation pass below attributes each pin to its half.
- A `cap_full` refusal of the durable re-ask is write-blocked SILENTLY-BUT-COUNTED: the
  join's retain reload meets the same full cap, so the entry stays unloaded and held
  (`cap_full` counted twice) and no seal line is printed. Never a loss; loud only by kind.
- ORDERS RULING (B) RETIRED, each case rebased rather than deleted:
  the eighth-path MINTED reseed cases (the minting entry can no longer face a reseed, the
  join installs from any loaded entry: they now pin the name arm against the RE-READ
  entry, two to three loads); the ninth and tenth paths (a budget-refused login whose
  read lands before its re-ask, alone or with a sibling on the same read, now installs
  the named default and writes under it: FLIPPED; the unnamed refusal is pinned on the
  order that still seats the stand-in, both asks over budget and the read landing after
  the seed); `ADOPTS the live record identity` (rebased onto a quiesced entry collected
  inside its session's leave window); `blocks writes for an entry whose load has not
  landed yet` (rebased onto the refused re-ask; its contrast is now the door opening onto
  the seal, since no producible order lets that stand-in write); retain's repair reload
  (reached only after a join that installed nothing, so its job is now a LOUD block, not
  a writable one); `releases the capture only when the live record CARRIES it` (its
  no-record moment is unproducible with a capture outstanding; the mutant it killed is
  killed by the sibling world); the captured-write rejoin pair (landed: the seal on the
  refused re-ask; waiting: the capture installed, FLIPPED).
- `insertWouldMintAnUnnamedRow` is now DEFENSE IN DEPTH: no producible order seeds a
  stand-in beside a loaded, unheld, minted entry. Its literals stay pinned in
  `tests/server/freehold_write_seal.test.ts`.

### THE MUTATION PASS (first round, at `b77421251a`)

One mutant at a time, on the committed tree, over the store, join-answer, handshake,
bounded-error and row-document suites with JSON output, restored through `git checkout`
and the tree asserted clean after each. CONTROL: 419 tests ran, 0 failed. Every mutant
KILLED (tests failed out of 419):

- the validation off (no loaded entry is ever used) 192; the capture ignored at install
  (committed state instead) 75; preload's replay arm ignoring the capture 76; the binding
  installing the asked answer 4 (the two between-the-re-ask-and-the-install pins, the
  sibling outrunning the durable re-ask, and the wiring source pin); a withheld verdict
  installing the asked answer 3; the handshake not re-asking 5; an `await` between the
  re-ask and the join 1; a thrown re-ask dropping the first answer 1; the entry's
  account check dropped 1; the hold arm dropped 1; the install ignoring `recordWithheld`
  3; no retain reload 21; no withheld warning 1; the bounded error dropping the
  constraint, the row document's revision, the revision narrowing: each killed by its
  suite.
- THE TWO HALVES, attributed: reverting the handshake's re-ask in the harness that
  models it kills 13 of the block's 89 pins (the committed order and the failure modes
  that need a durable re-ask); reverting it AND the binding's validation (the whole fix)
  kills 86 of 89. The unwritten order survives either half alone and dies with both:
  each half by itself installs the capture.
- THE MARK (evidence for keeping `recordWithheld` on preload's answers): unmarking both
  already-live arms kills 6, three pre-existing preload-admission pins and three new
  pins, all on assertions about the answer itself; no join outcome changes, because the
  join re-decides from the entry. It stays as defense in depth for a raw consumer of a
  preload answer; the install's check is load-bearing for the WITHHELD verdict (3 kills).
- OWED, three pins killed only by the validation-off mutant, each needing a targeted
  mutant next session: the `no_budget` refusal of the durable re-ask (the seal's name arm
  off), the sibling sharing one durable read (single-flight off in `beginLoad`), and the
  healthy two-character contrast (a stopped writer).

### STATUS AT THIS HANDOFF (2026-09-26), AND WHAT IS OWED, IN ORDER

(ALL DONE later on 2026-09-26, the four docs at `fb1de750cb`: see RULING (B) FINISHED, AND
07 RE-JUDGED below.)

The fix is built and committed (`b77421251a`); nothing was pushed. The armed Postgres
suite ran 16 of 16 at the fix. NOT YET DONE, for the next session:

1. The three targeted mutants above.
2. The docs that still state the twelfth path open: DEPLOY.md (the `quiesced` and
   `held` paragraph), `docs/freeholds/held-plot-surface-scope.md` (the "older house" and
   empty-house groups), `docs/freeholds/persistence-rollout-contract.md` (the retired-rule
   paragraph) and `docs/freeholds/phase-07-qa.md` (the premise line): the twelfth path is
   closed; what remains write-blocked is the refused durable re-ask (loud; `cap_full`
   silent but counted) and the withheld race (loud).
3. The repo's reviewers on `22d883d3c2..HEAD`: qa-checklist, test-coverage-auditor,
   server-hot-path-reviewer (the join path), database-performance-reviewer (a durable
   read inside the lease window), privacy-security-review (the handshake now calls the
   housing read twice; no wire or deps shape changed).
4. The shard carry, armed, on a quiet machine: the release's `tests/floor_vfx_layer.test.ts`
   and the three new suites.
5. `npx tsc --noEmit`, the ARMED `node scripts/gate_select.mjs` (check uptime and for a
   stray `node_modules/node_modules` first; restore any PNGs under `docs/screenshots` the
   browser step rewrites), `npm run ci:changed` after the last commit.
6. Fresh reads of the whole change and every fix round until nothing blocking.
7. Re-judge 07 on the record, then the progress row, state.md and the memory handoff.

## RULING (B) FINISHED, AND 07 RE-JUDGED, 2026-09-26

The owed list of STATUS AT THIS HANDOFF above, worked through on `2af5f917c0..b3a0848781`,
LOCAL: nothing pushed, no PR. The worktree has no `.env`; Postgres was armed by passing
`TEST_DATABASE_URL` alone (the main checkout's `DATABASE_URL` line, never sourced), and
`tests/server/freehold_db.pg.test.ts` ran 16 of 16, none skipped, before every long run.

### THE SYNC FIRST

- `origin/release/v0.44.0` had moved past `9dbc47938a` to `09639d4ae9` (548 commits: the
  Eastbrook ferry, the Wanted board's buy orders, custom guild ranks, partial buys, the
  market History tab). Merge `8a330b3489`, a real merge, 43 conflicts by hand against both
  parents. The `effective_stats` double extraction collapses onto the release's
  `src/sim/effective_stats.ts`. The branch's furnishing guards follow the stat model into
  `src/ui/char_stat_model_core.ts` (the release removed `hud.statModel`) and the feast
  resolver into `feastItemIdAtSlot`, where the release's new resolver would otherwise
  have made a furnishing slot's feast refusal silent.
- Re-measured on the merged tree: the deeds parent-preservation digests against both
  parents; the Eastbrook polish seal re-minted (the renderer leaf and its four literals);
  the terrain corpus with the release body as its byte prefix, validated on linux/amd64
  in Docker; every monolith row at its exact merged count, none raised past either
  parent; the shard table as the union of the release rows and the branch's carried
  rows; `pnpm install --frozen-lockfile`; i18n, the guide and the manifests regenerated.
- THE AUDIT (release-merge-audit, four fresh lanes, commits only): 1 blocking, 10
  should-fix, 14 nits.
  - Premises (1 blocking, 8 should-fix, 7 nits). The blocking one: the release's custom
    guild ranks make the Officer title a stamped bank tier, so guildhall authority keyed
    on it is a false premise. Recorded as G1, A RULING OWED BEFORE 28, with G2 to G7, in
    state.md "Premises the 2026-09-26 sync moved" (`351ab7aadd`), with a pointer from
    every plan that states one (`d18e0443b7`, after the fresh read of the sync found the
    first pass incomplete). S5 is CLOSED BY THE RELEASE: the ru_RU
    `hudChrome.noticeboard.officerEntry` row this ledger held for the release owner reads
    `{name} ({rank})` at `09639d4ae9`.
  - Sim (1 should-fix, 3 nits): the Wanted board's buy orders and the partial buy had no
    furnishing pin, and the order paths tested the quest kind by hand. Fixed in
    `1b2cb05fde`: orders refuse through `isStorableItemKind`, with pins for the definition
    locks, plain-only fills, one copy per slot and the release's exit facing on a freehold
    leave.
  - UI and render (1 should-fix, 3 nits): the character-select Exchange panel forwarded a
    raw item copy, and two merged combinations were unpinned. Fixed in `5bbab44e72`.
  - Server (1 nit, pre-existing): a jail comment named a constant the branch had moved;
    it now points at `refusedJailedTravelCommand`.
- THE SEALED CAPTURE INPUTS. The merge moved twelve (CSS among them). A probe of the
  after leg from a frozen detached worktree on a spare Vite port found the room frames at
  the unchanged-tree level and every HUD element in place on the gate frames, so the
  digests were RE-HASHED (`284adcb7be`) rather than the set re-shot; the numbers are in
  `docs/freeholds/interiors-implementation-evidence.md`, "The second 2026-09-26
  re-hash". The probe worktree was removed. `199d80e64d` moved one more sealed input (the
  release's two new capture scripts cleared the spawn greeting with its skip control,
  which the branch's greeting guard refuses; both now decline through
  `GREETING_DECLINE`), re-hashed with it since no freehold leg runs the changed line.

### THE OWED LIST, IN ORDER

1. THE THREE TARGETED MUTANTS, through a scratch runner that applies one mutant, runs the
   suites with JSON output, restores through `git checkout`, asserts a clean tree, and
   proves a control run first (433 tests, 0 failed). Each killed: the seal's name arm off
   (the `no_budget` refusal of the durable re-ask) by 14 tests; single flight off in
   `beginLoad` (the sibling sharing one durable read) by 5; a stopped writer (the healthy
   two-character contrast) by 15.
2. THE FOUR DOCS (`fb1de750cb`): DEPLOY.md, `held-plot-surface-scope.md`,
   `persistence-rollout-contract.md` and `phase-07-qa.md` state the twelfth path closed
   and what stays write-blocked: a durable re-ask refused on capacity (loud at the seal;
   `cap_full` quiet there but counted by kind) and the WITHHELD race (loud), neither a
   loss. A fifth, `src/sim/freehold/CLAUDE.md`, followed in `d1e50ea339`.
3. THE FIVE REVIEWERS on `22d883d3c2..fb1de750cb`, commits only, in parallel: 1 blocking,
   11 should-fix, 14 nits.
   - server-hot-path-reviewer (1 blocking, 2 should-fix, 2 nits). BLOCKING: each ask
     armed the whole 10,000 ms budget and its own permit wait, so a degraded login could
     spend 20 s on housing, the second half inside the character-lease window and past
     the client's 10 s entry watchdog: the linkdead-ghost outcome the whole-preload cap
     had closed. Its should-fix pair: three capacity lines per refused login in a storm,
     and no signal for the re-ask or the verdicts.
   - database-performance-reviewer (2 should-fix, 1 nit): the same doubled budget, the
     same missing signal, and DEPLOY's refusal-counting paragraph.
   - qa-checklist (4 should-fix, 4 nits): the contract and DEPLOY on the re-ask's cost,
     the fifth doc, and the handoff records still listing the four docs as owed.
   - test-coverage-auditor (3 should-fix, 5 nits): the only store-level WITHHELD pin
     handed the join a MARKED answer, so it could not tell WITHHELD from installing the
     stale answer; nothing pinned that only WITHHELD warns.
   - privacy-security-review (2 nits, 2 info): two comments understated when the re-ask
     reads and how many console sites the housing path has.
   ALL APPLIED in `59a9bfd1b5` and `d1e50ea339`: ONE HOUSING BUDGET PER HANDSHAKE (the
   re-ask gets what the first ask left, `freeholdReaskBudgetMs` in the new
   `server/freehold_login_bounds.ts`); `reasks`, `reask_reads`, `reask_ms` and one
   `join_<verdict>` measure per verdict on `woc_freehold_persist_total`; capacity-kind
   hold lines limited to one per kind per 10 s with a held-back count
   (`server/freehold_capacity_warn.ts`); a join with no answer installs a loaded entry;
   the ABSENT withheld case through the store; a negative warning assertion on every
   held join. Three extractions paid for it (`server/freehold_login_bounds.ts`,
   `server/freehold_persist_stats.ts`, `server/freehold_capacity_warn.ts`), and the
   store's ceiling went 2150 to 2058. NOT TAKEN, with the reason: the hot-path lane's
   second half, a re-ask that never waits for a permit. Its wait now sits inside what the
   first ask left, so the pair never passes one budget, and a capacity-held first ask is
   where ruling (b)'s second chance pays.
4. THE SHARD CARRY (`4e56f16a32`, its own chore commit, armed, on a quiet machine): 84
   walked suites had no weight row after the sync, the release's new suites
   (`floor_vfx_layer` among them) and this branch's join answer, bounded error, row
   document, liveness, login bounds and capacity warn suites. Each weight is the median
   of three armed runs.
5. THE GATE, ARMED (`TEST_DATABASE_URL` alone, the arm proved 16 of 16 before each run;
   uptime checked and no stray `node_modules/node_modules`; the planner fell back to the
   full suite every time, on a 1,826-path diff against the release).
   - Run 1 at `b21ad2cdb4` FAILED at the changed-files biome step: the branch's ru_RU
     housing rows, double-quoted and unwrapped, visible once the sync made the file
     changed against the release. Formatting only, every value byte-identical
     (`b5b2c580ac`).
   - Run 2 at `d18e0443b7` was green up to vitest, which FAILED on one file, 4 of 70,841
     tests: the branch-only `tests/renderer_zone_dependency_lifecycle.test.ts` rig had no
     stub for the three roots the release's new cast first-reads boot entry gathers when
     `prewarmInitialScene` builds its manifest (`this.abilityVfxFx.ccBandDrawable is not
     a function`). A merge-integration red that neither parent carries and only the full
     suite could see; the three roots are stubbed as null, which links nothing
     (`31ef80a911`).
   - Run 3 at `ec2d4be98d`: PASS, all 12 steps green. 4,737 files and 70,846 tests passed
     (2 expected-fail, 28 skipped), the browser suite 62 files and 533 tests.
   - Run 4 at `a1fb50db45`, after two more fresh-read rounds: PASS, all 12 steps green,
     the same counts (those rounds changed assertions, comments and docs and added no
     case).
   The PNGs the browser step rewrites under `docs/screenshots` were restored after every
   run.
6. THE FRESH READS, each by a reader that read commits only, executed nothing and wrote
   no file; every truncated report was asked for verbatim.
   - fresh-rb, the ruling and its review round (`22d883d3c2..d1e50ea339`): 0 blocking, 3
     should-fix, 9 nits. `join_entry` counted every healthy join, so it could not show
     the fix firing; nothing at store level pinned that DATA-kind lines skip the
     limiter; the harness's budget-refused re-asks did not re-ask like production. The
     nits: the rowless refusal shape (held as `unnamed_record`), the `refused` arm
     ignoring a loaded entry, the unlimited `read_threw` error line, two vacuous verdict
     pins, the budget's wall-clock and scheduler caveats, the withheld line beside a live
     record, the verdict counters initialised through a cast, and the stand-in producer
     list. ALL APPLIED in `f17d8982bc` and `e22cbb371e`: a `superseded` verdict now marks
     the loaded entry installed in place of a stale ask (so `join_superseded`, not
     `join_entry`, is the fix changing an install); a loaded entry answers a broken or
     foreign ask too; the first ask is timed on `performance.now`; `reask_reads` skips a
     cap refusal; a live record skips the withheld line; the counters are derived from
     the verdict vocabulary; the harness re-asks like production. It also named, as
     pre-existing and not introduced, the capture loss judged below.
   - fresh-sync, the sync and its fix commits (`8a330b3489..284adcb7be`): 1 blocking, 2
     should-fix, 6 nits. BLOCKING: the parity golden `freehold_claim.json` was never
     re-minted for the release's exit facing (`leaveDungeon` now sets the door's facing,
     so the two claim players carry facing pi after they leave). Re-minted in
     `2fdd37a76b`: only the six facing values and the seven state digests they move. The
     rest applied in `10ce32c693` (the release's `wieldsDagger` read a forged
     furnishing's dagger flag, lighting Backstab on the bar while the cast gate refused
     it; the character-select strip gained its pin) and `d18e0443b7` (G1 and G2 pointers
     and wording).
   - fresh-fixes, every fix-round commit from `4e56f16a32` to `d18e0443b7`: 0 blocking,
     1 should-fix, 7 nits, and one earlier problem outside the rounds. Its report was cut
     at the fourth nit and its resend was stopped by a safety classifier, so the rest
     never arrived. What did arrive was applied in `ec2d4be98d`: `join_superseded`
     counted a second character beside a live record and every login of a DATA-held
     account, neither of which changes an install (the verdict now takes the live record
     and compares hold kinds); a re-ask read is booked when it settles, now documented,
     and the already-live arm's cap exclusion is pinned; the WITHHELD docs overclaimed
     (a join beside a live record shares it and warns nothing); the match's account
     clause was unpinned; two harness re-asks did not run on production's budget.
   - fresh-fixes2, a second reader over the same commits plus the three after gate 2
     (`31ef80a911`, `e43478015c`, `ec2d4be98d`), for the part the first never
     delivered: 0 blocking, 2 should-fix, 6 nits. Its resend of the tail was stopped
     the same way, so the rest of N3 to N6 and its clean list never arrived. Applied in
     `ee183a3bfd`: the stale pin's comment cited the `quiesced` gauge, which reads zero
     once the entry is collected; the pins' title read as the whole list of capture
     releases (every arm that quiesces an entry while a capture is owed releases it: the
     seal's identity and unnamed refusals, the write ceilings, a `missing` row, a
     `conflict`, and the shutdown drain's deadline, now named beside the pins); one row
     assertion could not fail and is replaced by proving the loss through the next login;
     three withheld claims were still unqualified; the `live` parameter's doc.
   - fresh-fixes3, a third reader for the part the second never delivered, under a
     short-report limit: 0 blocking, 2 should-fix, 5 nits, all delivered (only its clean
     list was cut). Applied in `a1fb50db45` and `e5a4f705b3`: DEPLOY, the join-answer
     header and the surface scope still said a collected entry leaves every edit on the
     row, which the KNOWN COST orders contradict; "every join beside a live record counts
     entry" holds only over a loaded entry; the header's "no install changes anything"
     (the Hearth clock still merges); the live verdict was pinned only with a marked ask;
     `join_held` was undescribed; a 113-column DEPLOY line; and the harness turn ran
     BEFORE the Svelte testing library's unmount, because Vitest runs the afterEach hooks
     before the beforeEach cleanups (confirmed in the runner source), so the turn now
     runs from the case's `onTestFinished`, after both. Retained heap is unchanged on the
     three measured suites (359, 418 and 454 MB at file end) and on three admin Svelte
     suites (136, 91 and 69 MB, which never leaked).
   - fresh-final, over `ee183a3bfd`, `e5a4f705b3` and `a1fb50db45`: 0 blocking, 1
     should-fix, 5 nits, so the loop ends here. Applied in `b3a0848781`: the new
     row-completeness parentheticals left out the shutdown drain's deadline, and "those two
     orders" read as the two seating orders; DEPLOY and the surface scope cited the
     re-judgement before its record existed, so they now point at the pinned describe;
     `join_held` also counts a DATA hold whose entry was collected in the withheld race's
     window; the two `quiesced` assertions after `entries` 0 could not fail on their own
     and are dropped (and `ee183a3bfd`'s body overclaims: only the thrown-write pin proves
     the loss through the next login, the stale pin proves it through the row); the live
     loop asserts the answer as well as the verdict; two antecedents named. That round
     changes docs, comments and test assertions only, verified by its suites, the twenty
     suites that read these docs, `npx tsc --noEmit` and `npm run ci:changed` after the
     last commit.
7. THE MUTATION PASS. Every new or changed pin went through the same runner, one mutant
   at a time, each batch behind its own control run (433, 528, 451, 201, 351 and 475
   tests, 0 failed; the merge audit's pins ran on their own suites; the last round's
   control was 369): 44 mutants, the three targeted ones included, 43 killed. The one
   survivor is recorded: `fill_counts_instanced` (an order fill counting instanced
   copies) is defense in depth behind the fill's plain-copy gate, whose own mutant
   (`fill_gates_off`) the same suite kills by 4.

### THE TEST-SUITE AUDIT, READ-ONLY, BESIDE IT

One general-purpose agent measured `tests/` (per-file wall time, peak RSS, config, leaks)
from a detached worktree at `2af5f917c0`, never during an armed gate, editing nothing.
Its ranked findings went to Fernando for a decision; no test was deleted or rewritten on
its say-so. The one exception the brief allows landed as its own commit: a harness leak
in `tests/jsdom_local_storage_setup.ts` (DOM-environment files kept every case's DOM tree
reachable until the file ended, because cases ran back to back with no event-loop turn),
fixed in `b21ad2cdb4` by one `afterEach` that yields a real macrotask in DOM-env files.
Retained heap after a forced GC at each file's end, before and after:
`loot_explorer_window_focus` 1,862 to 353 MB, `reliquary_window_behavior` 1,243 to 418
MB, `daily_rewards_store_behavior` 946 to 454 MB; peak RSS 2,267 to 2,084, 1,613 to 1,531
and 1,559 to 1,547 MB. A later fresh read moved the turn to the case's `onTestFinished`
(`e5a4f705b3`), so it also follows the Svelte testing library's unmount; re-measured
there at 359, 418 and 454 MB, and three admin Svelte suites unchanged at 136, 91 and 69
MB (they never leaked). The leak A patch (`@vitest/spy`), the global Svelte setup and
worker sizing are harness decisions left with Fernando, not leaks this session fixes.

### THE 07 RE-JUDGEMENT

VERDICT: FAIL, ON THREE NAMED ORDERS, NONE OF THEM THE TWELFTH PATH, AND NONE INTRODUCED
BY RULING (B). The twelfth path is CLOSED: every KNOWN DEFECT and KNOWN COST pin
it carried asserts the fixed behaviour, every mutant over the fix and its rounds is killed
but the one recorded survivor, five reviewers and six fresh reads found nothing blocking
once their rounds were applied, and the armed gate is green (item 5 above). Judged against
the criterion as the brief states it:

- ONLY A GENUINELY ABSENT ROW RESOLVES TO THE FREE TIER-0 INN ROOM: HOLDS, read as this
  packet has always read it (state.md, PRESERVATION IS THE INVARIANT): no order writes a
  default over a row, or inserts one under an account's minted name while the row exists.
  The orders that still SEAT the stand-in for a session keep the row intact on disk and are
  write-blocked, loudly or counted by kind: a durable re-ask refused on capacity, the
  WITHHELD race with nothing live, and the rest of the stand-in producers
  `src/sim/freehold/CLAUDE.md` lists. What they owe is the player-facing surface C23
  scopes, not a fix to the store.
- NO COMMITTED EDIT IS LOST: HOLDS. The committed order's stale overwrite is gone (the join
  installs the loaded entry, or nothing), and every refusal left keeps the row as it
  stands.
- NO CAPTURED EDIT IS LOST: FAILS, in exactly three orders, all loud, all keeping the row.
  The first two are the ones a realm reaches while it runs, pinned as KNOWN COST at
  `e43478015c` (scoped in `ee183a3bfd`), each pin killed by the mutant that would keep the
  capture (control 351, 0 failed; 2, 3 and 5 failures):
  1. THE THROWN-WRITE RUN, one realm. A leaver's capture whose write throws
     `FREEHOLD_PERSIST_MAX_WRITE_ERRORS` times inside `FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS`
     (three in five minutes: the leave flush and the next two 30 s sweeps, so a database
     fault that lasts about a minute) quiesces the entry. A quiesced entry owes no work, so
     settle releases the capture and the entry is collected with it; the leaver's last
     edits reach no row. Loud: a `write failed` error line per throw and one `quiesced
     after 3 thrown writes`. Present since N13 bounded the retry (`bd22f1aa78`), windowed
     by X12.
  2. THE CROSS-REALM FENCE, the contract's activation gate ("ONE ACCOUNT ONLINE ON TWO
     REALMS HAS ONE OF THEM WRITE-BLOCKED, SILENTLY"). When another realm commits the
     account's row first, this realm's leave write meets the compare-and-swap fence, is
     diagnosed stale and quiesces, and the capture goes the same way. The other realm's
     house stands, which is the fence doing its job; this realm's last edits are gone,
     with one warn line and `stale_writes`. The contract places the cure at 07a's mutation
     boundary.
  3. THE SHUTDOWN DRAIN'S DEADLINE. An orderly shutdown waits
     `FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS` (10 s) for the writes owed; a capture still owed
     then ends with the process, with one error line from `server/main.ts` ("freehold
     persistence drain did not complete ... edits may be unwritten"). The same database
     fault as (1), met at exit; the drain's own case ("answers false at its deadline
     without throwing") pins the bound.

Every other arm that quiesces an entry while a capture is owed releases it the same way,
and none of them loses an edit the criterion protects: the seal's identity and unnamed
refusals fire only for a session already write-blocked (its capture is a stand-in's), a
legal record fits the write ceilings (the maximal one is measured), a `missing` row is
the account's row deleted, and a `conflict` is a minted plot id colliding. A process that
dies without draining (a crash, a kill) loses the captures it holds in memory, as any
write-behind buffer does; that is outside the criterion.

WHAT CLOSES 07 IS A RULING (Fernando), not more work of this session's kind. For the
thrown-write run: (i) keep a capture past a THROWN-run quiesce, with the entry kept,
write-blocked for new edits, retrying the capture once per error window (one statement
per owner per five minutes) and releasing it only on a commit or on an answer no repeat
can change, a rejoin installing it meanwhile; its cost is a retained document that
outlives its sessions while the database is down, counted under `leave_captures`; or
(ii) accept the run as the bounded-retry cost and restate the criterion as "no captured
edit is lost while the database answers". For the fence: carry it as the activation gate
07a closes, as the contract already plans, or pull a cross-realm claim forward. For the
drain's deadline: accept it as the orderly exit's bound (a process that exits cannot
keep a document in memory), or give captures a durable spool, a new mechanism.
RECOMMENDED: (i); the fence carried to 07a; the drain's deadline accepted. 07 would then
re-judge PASS once (i) is built, with the fence and the deadline recorded as named
gates.

### RECORDED, NOT FIXED HERE, EACH WITH ITS REASON

- The renderer's catch-arm prewarm generation check (the UI audit's N1): the merge
  asserts only after `runStartedPrewarmEntry`, so a shutdown that makes a prewarm entry
  throw logs one warning and calls fail-soft progress hooks on a retired generation.
  ACCEPTED as the release's shape; a change belongs in the release's own module.
- `answerForInstall` trusts its caller's owner key and account pairing (the security
  review's info note). Its one caller derives the key from the account id; an optional
  derivation inside the store is a hardening for a second caller, not a fix.
- The dated `furnishing-item-kind` late-after market-collect evidence (the UI audit's
  S1): after the merge the sale rows render on the History tab, where the code guard
  moved and its test is repointed, so the behaviour is held and the dated frames are
  stale. Their capture rig no longer exists, and Q20 in that review still says
  "Collect". Owed to the next furnishing evidence pass (a re-shoot on
  `data-tab="history"`), not to this ruling.
- Older dated evidence shows pre-release HUD chrome (the unit-frame plaque padding, the
  five stat groups, the mobile debuff strip). Dated records, not seals; only the sealed
  set is re-proved at a sync.
- The three capture-loss orders named in the re-judgement above, and the three rulings
  G1, G2 and G3.

### STILL OPEN, IN ORDER

1. THE 07 RULING above: the thrown-write run, the cross-realm fence and the drain's
   deadline. 07's verdict stays FAIL until it is given and, for (i), built, reviewed and
   gated.
2. The test-suite audit's ranked findings, with Fernando for a decision (no pin is
   removed on an audit's say-so), and its three harness questions: leak A
   (`@vitest/spy` keeps every spied object in its registry; a pnpm patch or test
   rewrites), the global Svelte setup's cost, and worker sizing.
3. `Sim.addPlayer` atomicity, now also over the restore path's `loadGatheringSettings`
   (`src/sim/professions/gathering_settings_persist.ts`, the release's pending Town Focus
   re-spec) beside `seedAccountLedgerSelf`, `loadHonorState` and `loadWorldPvpState`.
4. D85, the cross-realm account ledger against dark realms (a ruling).
5. The phase 17 re-plan onto the account ledger, with the trophy-source ruling (G3).
6. G1 before 28 builds (guildhall authority as a rank permission); G2 when housing lights
   online (the ferry and the Hearth Key).
7. A new release sync if `release/**` moves. The Fenbridge ruling is owed before 25a
   builds.


## FERNANDO'S RULINGS OF 2026-09-26, AND THE SYNC OF RELEASE/V0.44.0 AT AAFF789813, 2026-09-26

LOCAL: nothing pushed, no PR. The worktree has no `.env`; Postgres is armed by passing
`TEST_DATABASE_URL` alone (the main checkout's `DATABASE_URL` line, never sourced).

### THE RULINGS (Fernando, 2026-09-26), RECORDED VERBATIM

Fernando's words: "Let's go with all your recommendations." and "Let's keep it all on this
branch." What they rule, as the brief states them:

- R1, 07's thrown-write run: option (i). Keep a leaver's capture past a THROWN-run quiesce:
  the entry is kept, write-blocked for new edits; the capture is retried once per error
  window (one statement per owner per five minutes); it is released only on a commit or on
  an answer no repeat can change; a rejoin installs it meanwhile; it is counted under
  `leave_captures`.
- R2: the cross-realm fence is carried to 07a as a named activation gate (recorded here, not
  built).
- R3: the shutdown drain's 10 s deadline is accepted as the orderly exit's bound.
- R4, G3: developer-badge `dev:` titles are excluded from trophy sources (state.md G3 and
  the phase 17 plan carry it).
- R5: act on every recommendation of the 2026-09-26 test-suite audit, the `@vitest/spy`
  patch included, on this branch. The deletions it listed are APPROVED, each only after
  proving its coverage is preserved (a mutant the deleted case kills, killed by the
  covering case too). Any removal beyond that list still needs Fernando's word.
- G1 (guildhall authority as a rank permission) and G2 (the Hearth Key on a moving ferry)
  had no recommendation and stay owed: a recommendation comes when their phases approach.
- A NEW STANDING RULE: watch every test for wall time and memory. A suite that drifts slow
  or memory-hungry must fail a guard, not wait for someone to notice (the repo-wide test
  work, Part 2 of the brief, builds that guard).

So 07 re-judges PASS once R1 is built, reviewed and gated, with the R2 fence and the R3
deadline as the two named gates.

### THE MERGE (`dd7f954501`)

`origin/release/v0.44.0` had moved past `09639d4ae9` to `aaff789813` (267 commits: world
quests round 2, the faction reputation ladder and quartermasters, the trinket equipment
slot, the Weekly Vault and weekly emissary, Clue Scrolls, vehicles and the glider). A real
merge, 63 conflicts by hand against both parents; `patches/`, the lockfile and
`package.json` did not move, so no reinstall.

- THE WORLD-OBJECT BOOTSTRAP DOUBLE EXTRACTION collapses onto the release's
  `src/sim/ground_object_spawns.ts` (which also brought stable authored entity ids, heights,
  facings and scales). The branch's `src/sim/world_object_bootstrap.ts` shrinks to
  `bootstrapFreeholdGate`, run from a new optional `beforeDungeonDoors` hook, so a lit world
  still mints the gate between the mailboxes and the doors and a dark world's ids hold
  (pinned both ways in `tests/world_object_bootstrap.test.ts`).
- The release's forge and salvage changes to the generic object arm were ported into the
  branch's extracted `src/render/ground_object.ts` (the `groundQuestObjectYaw` reuse yaw, no
  sparkle over `forge_` workbenches). `leaveVehicle` opens `settleLeavingSession`, inside
  the leave's `finally` guard. The trinket helper returns `JewelryItemDef`, since spreading
  the whole `ItemDef` union met the furnishing arm's `pvpOffenseRating?: never`.
- Re-measured on the merged tree, never argued: every count pin by per-axis arithmetic
  (deeds 320, IWORLD 434/126/308 with 37 facets, commands 257/271, catalog 1,367/1,385 with
  27 groups and 33 sheet pages, sha and bytes from `--verify-only`); the deeds catalog digest
  plus a fourth parent proof (strip the release's seventeen new deeds, reproduce the branch
  tip's `fb106a9c...`); the Eastbrook polish seal re-minted; the terrain corpus with the
  release body (152,912 points) as a byte prefix and the same 811-point room tail; every
  monolith row at its exact merged count (sim.ts 11,589 sits between the parents, 11,548 and
  11,642, because both sides removed the same bootstrap block; bank_window 1,810 is the
  release's); the professions blob measured on the release, its base and the merge (18,830,
  18,975, 19,299: exactly additive); the wiki, i18n and MediaWiki seed regenerated.

### THE INTEGRATION REDS, EACH FIXED IN ITS OWN COMMIT

- `51d9e2b124`: the merged maximal character blob measures 230,068 bytes, 692 PAST the
  229,376 warning (the release alone 227,869, this branch alone 227,253, over a shared
  225,054). By the threshold's own documented rule (the smallest 32-KiB step above the
  fixture) `CHARACTER_BLOB_WARN_BYTES` moves to 262,144, which now meets the guild-bank scale.
  A threshold move a database review approved before: flagged for Fernando's confirmation and
  for the database-performance reviewer of the Part 1 round. A mutant restoring 229,376 reds
  five pins.
- `e2a4845e4a`: the release's new NPCs, pads and entities moved the furnisher-site terrain,
  the dark-world fingerprint, the nearest neighbour (now the weekly emissary, 18.4 yd) and the
  dark owner of the lit furnisher's id (the Rift Watch quartermaster); every value was
  measured on the release tip's own tree first and the merged dark world matches it exactly.
  The Hud dispatch rig gained the world the release's vehicle bar gate reads.
- `f899ccb24f`: the `freehold_claim` parity golden re-minted for the release's three new save
  fields (`worldQuestReplacements`, `gliderRecords`, `factions`); every other golden held.
- `554b9631cb` and `76b85c2b3a`: the audit's fixes (below).

### THE AUDIT (release-merge-audit, four fresh lanes, commits only)

- Server lane: 0 blocking, 2 nits. `leaveVehicle`'s new seat is safe (sim-only, no await, no
  reader between it and the leave marks). Applied: the shutdown comment that said "Same" now
  names its real neighbour. OWED to the next session: a test that the leave path releases a
  manned cannon before the leave save (a release-side gap; `removePlayer` backstops it).
- Sim lane: 0 blocking, 1 should-fix, 3 nits. Applied in `76b85c2b3a`: the entry context
  answers `busy` under the release's four action locks (a manned cannon, a live wisp maze
  trial, a shadow cloak, a glider run), so the gate refuses them loudly and the Hearth Key no
  longer rests on `useItem`'s check order alone; pinned per lock on the context, the key and
  the gate beside a control (all four arms off kills 8; the key cases pass on either layer,
  defense in depth). A merged deeds comment now reads plainly. RECORDED FOR THE RELEASE
  OWNER: `isRaidGear` in `src/sim/emissary_cache.ts` filters `kind !== 'tool'` only, and the
  cache pool measures 64 ids of kinds weapon, armor, held_offhand AND recipe, against its own
  "wearable" contract; changing it changes the release's reward odds, so it is not this
  branch's edit.
- UI and render lane: 5 blocking (three source pins the merge moved, the capture seal, the
  caravan route), 1 nit. The pins and the unused import are fixed in the audit-round commit
  (the Eastbrook polish seal re-minted again); each repinned case was mutation-checked (three
  mutants, three kills).
- Premises lane: 0 blocking, 8 should-fix, 7 nits; G1 to G7 hold. Recorded in state.md as
  premises G8 to G14 and the gotcha updates (the caravan route, the silent-then-busy action
  locks, the Fenbridge investigation post, a second week rule, a calendar-free headless, the
  guild-clear hook no longer last, the 07a census's new callers and tables, and the nits).
- THE CARAVAN ROUTE (G8, A RULING OWED BEFORE HOUSING LIGHTS): the release's Eastbrook freight
  caravan walks 4.8 yd from the gate at its nearest and its third ambush (five level-5
  bandits in an 8 yd ring) can land about a yard from the arch. `tests/freehold_gate_clearance`
  keeps the full 12 yd for every other route and holds this one behind a named, live floor.

### THE CAPTURE SET: A PROBE, THEN A RE-SHOOT (`a9060dbf0e`)

The merge moved 17 of the 67 sealed inputs (the audit round two more). A probe of the after
leg at `dd7f954501`, beside a pre-merge control at `20209e4c21` shot the same night, found
the room frames at the control's level but every gate frame changed through UNSEALED
content: the release's weekly emissary (Cham Pete, `src/sim/content/weekly_quests.ts`)
stands at the stance and the minimap carries new star markers. So the set was RE-SHOT, not
re-hashed: all 18 frames, sidecars, both producer manifests and the performance record,
from a frozen worktree at `e89b62487c`, re-sealed with the repo's receipt tool;
`tests/freehold_capture_contract.test.ts` 102 of 102. Detail in
`docs/freeholds/interiors-implementation-evidence.md`, "The 2026-09-26 re-shoot". Two
observations recorded there and here: the before leg's baseline worktree has linked the
branch's `node_modules` since 2026-09-08 (as every earlier set), and the performance
record's reveal soft-deadline counter read 9 (desktop) and 8 (mobile) BEFORE the measured
island window, where the 2026-09-25 record read 0; it did not move inside the window and the
receipt does not enforce it. The receipt's `sourceIdentity.current.root` now names the
frozen scratchpad worktree the receipt ran in.

### THE VERIFICATION

- The terrain corpus re-mint passes on linux/amd64 in Docker (`node:26-bookworm`, a fresh
  `pnpm install --frozen-lockfile`): 2 of 2.
- The full suite, ARMED (`TEST_DATABASE_URL` alone; `freehold_db.pg` 16 of 16 first), at
  `a9060dbf0e`: 72,963 tests, 72,935 passed, 0 failed, 28 skipped. Uptime was checked and
  there was no stray `node_modules/node_modules`.
- THE SHARD CARRY (`dbae472b24`, its own chore commit, armed, quiet machine): 131 walked
  suites had no weight row; each is the median of three armed runs (4,948 rows).

### STILL OPEN, IN ORDER (the next session starts here)

1. Part 1 of the 2026-09-26 brief from STEP 2: write the R1 design into this ledger (the
   questions the brief lists), then build it test-first (the thrown-write KNOWN COST pin
   flips, the stale-fence KNOWN COST pin holds, the new pins, extraction to pay for the
   lines under the 2058 ceiling, every pin mutation-checked).
2. Owed from this sync's audit: a test that the leave path releases a manned cannon before
   the leave save (the server lane's nit; `removePlayer` backstops it today).
3. STEP 3 (the `freehold_persist` trims with a coverage proof per deletion), STEP 4 (five
   capped reviewers, which also review `51d9e2b124`'s threshold re-mint), STEP 5 (the armed
   gate), STEP 6 (re-judge 07).
4. Part 2, the repo-wide test cost work, in the brief's order, ending with the durable
   guard.
5. Rulings owed: G8 (the caravan route beside the gate) before housing lights; G1 before 28;
   G2 when housing lights online; Fernando's confirmation of the 262,144 blob warning.
6. The older list: `Sim.addPlayer` atomicity (now also the release's world-quest restore),
   D85, the phase 17 re-plan on the G3 ruling, the Fenbridge ruling before 25a (with G10's
   investigation post measured), and a new release sync if `release/**` moves.


## FERNANDO'S RULING OF 2026-09-27, AND THE SYNC OF RELEASE/V0.44.0 AT 3BDB537657, 2026-09-27

LOCAL: nothing pushed, no PR. The worktree has no `.env`; Postgres is armed by passing
`TEST_DATABASE_URL` alone (the main checkout's `DATABASE_URL` line, never sourced).

### THE RULING (Fernando, 2026-09-27), RECORDED VERBATIM

Fernando's words, on the open decisions the aaff789813 sync left: "let's do what's best for
the project and feature for all of those." What it rules, as the brief states it:

- The character blob warning stays at 262,144 bytes (`51d9e2b124`, moved from 229,376 by the
  threshold's own documented rule after the merged maximal blob measured 230,068). The
  confirmation this ledger owed is given; the database-performance reviewer of the Part 1
  round still reads the re-mint.
- G8, the caravan route beside the gate: resolved by the option best for the feature, on
  evidence gathered first (the third ambush's spawn ring, the gate arch, the leave drop, the
  gate's combat refusal, how often the event runs). The recommendation the brief carries:
  keep the gate where it is (four moves, pinned margins, sealed captures) and the friendly
  caravan walking by, but guarantee no hostile ambush spawn lands inside the gate's 12 yd ring
  or near the leave drop, with the smallest change, and replace the named floor in
  `tests/freehold_gate_clearance.test.ts` with a real clearance pin over ambush rings.
- The emissary cache pool: `isRaidGear` in `src/sim/emissary_cache.ts` keeps any non-tool
  epic, so the pool holds an epic recipe against its own "wearable" contract. Restrict it to
  weapon, armor and held_offhand (the Weekly Vault's rule), pin the pool's kinds, and record
  the reward-odds change for the release owner.
- The manned-cannon leave-order test: the leave path releases a manned cannon before the leave
  save, pinned at GameServer level through `settleLeavingSession`.

### THE SYNC (`60cd9f859a`)

`origin/release/v0.44.0` had moved one commit past `aaff789813`, to `3bdb537657`: the release
tier's locale fill (every locale's overlays, the deed and sim overlays, the resolved bundles
and the map-marker digests in `tests/i18n_completeness.test.ts`). A real merge with one
conflict, the generated pending set, resolved by `npm run i18n:gen`; the wiki content and the
MediaWiki seed regenerate byte-identical. The release-merge audit, run by hand on a
one-commit, data-only delta:

- OVERLAPS: the five non-Latin overlays and deed overlays, `src/ui/sim_i18n.ts` and the
  completeness test. Every line each side added over `aaff789813` is present in the merged
  file (0 lost on either side, per file), and `npx tsc --noEmit` is clean, so no key is
  duplicated.
- REWORD STALENESS: the branch changed three English values (two Reliquary guide paragraphs
  and the armorcrafting ladder paragraph); the release filled none of those keys.
- NO LEGACY ARM, ROUTE, INJECTED HELPER OR PREMISE moved: the delta is locale data and one
  digest block. No sealed capture input moved (the capture set is English-only), `patches/`,
  the lockfile and `package.json` did not move (no reinstall), no monolith row and no test
  file moved (no shard carry).
- Targeted runs on the merged tree: the core i18n trio (76 passed, 3 skipped), the freehold
  and seal suites (194 passed, 2 skipped) and the locale-reading suites that name housing
  (516 passed, 1 skipped).

### THE THREE RULED ITEMS, TEST-FIRST, EACH MUTATION-CHECKED

Every mutant ran through the scratch runner (apply, run the named suites with JSON output,
restore through `git checkout`, assert a clean tree) behind its own control run, on a
committed tree.

1. G8, THE CARAVAN ROUTE (`07f7250fb4`). THE EVIDENCE, measured by driving the run on the
   lit world (seeds 20061, 1 and 42, identical): the third wave's ring fires where the run
   counts waypoint 8, `(-26,-101)`, reached (`escort.ts` `fireAmbushes`, the escortee at
   `(-28.42,-100.44)`), which puts two bandits 6.35 and 6.37 yd from the arch and one 5.59 yd
   from the leave drop. (The audit's "about a yard" figure computed the ring round waypoint
   7; the measured one is the worse-placed truth for the drop.) The run is a public event
   one day in seven (Eastbrook's pool rotates seven quests), replayable all that day on a
   30 s respawn; the ambushers are level-5 vale bandits with an 11 yd aggro radius; the gate
   refuses a player in combat (`entry_context.ts`, `combat`), so a fight beside the arch
   also shuts the door. THE DECISION: keep the gate (four moves, pinned margins, sealed
   captures) and the friendly caravan's route (4.8 yd at its nearest; the escortee is never
   hostile, answers the press only at its post, and now fires no wave near the gate), and
   fire the third wave at waypoint 6, `(-56,-88)`, a one-token change to the release's
   content. Its worst case, over every point the run can count the waypoint reached (the
   2.5 yd arrival disc, or anywhere on the leg into it when the stuck arm fires), is 12.93
   yd from the arch and 15.8 yd from the drop; the measured spawns sit 17.99 and 20.77 yd
   off. The story holds its order (the waypoint 6 line waits out the wave, as every line
   does). THE PIN: `tests/freehold_gate_clearance.test.ts` replaces the named 4.79 yd route
   floor with (a) every route keeping 12 yd but the caravan, which as ruled friendly traffic
   keeps only the arch's collider-free 3.5 yd ring, the exemption asserted live and the
   walker asserted aggro-free, and (b) every ambush ring of every escort keeping 12 yd and
   its ambusher's own aggro radius from both the arch and the drop at its worst case, with
   a positive control naming the nearest ring and its 12.933 yd. The release's own
   `tests/world_quest_caravan.test.ts` pins the new waypoint. Mutants (control 17 tests, 0
   failed): the fix reverted (wave back at 8), the ring widened to 9 yd, and waypoint 7
   moved through the arch, each KILLED by the clearance pin (and the release's shape pin).
   No sealed capture input moved (`world_quests.ts` is not sealed, and the idle caravan
   stands 89 yd off at its quay). RECORDED FOR THE RELEASE OWNER: the caravan's third
   ambush now fires at waypoint 6, not 8.
2. THE EMISSARY CACHE POOL (`52ef856a28`). `isRaidGear` kept any non-tool epic, so the
   pool held the Crucible's ten epic recipe patterns (open to every class) beside 54 pieces
   of gear, against its own "wearable" contract and its tooltip ("Opens into one Normal raid
   piece for your class"). It now takes the Weekly Vault's kinds (weapon, armor,
   held_offhand), and the pin holds the pool's kind counts exactly (15, 35 and 4) plus every
   class pool's kinds. Mutants (control 10, 0 failed): the fix reverted and held_offhand
   dropped, both KILLED. RECORDED FOR THE RELEASE OWNER, THE REWARD-ODDS CHANGE: each
   class's pool shrinks by the ten patterns, so a class piece's chance per cache rises from
   1/N to 1/(N-10) and a pattern's falls to zero. Per class, pool size before to after
   (the pattern share before): warrior 32 to 22 (31%), paladin 44 to 34 (23%), hunter 30 to
   20 (33%), rogue 26 to 16 (38%), priest 30 to 20 (33%), shaman 46 to 36 (22%), mage 30 to
   20 (33%), warlock 27 to 17 (37%), druid 35 to 25 (29%). The marks and the one draw on
   `ctx.rng` are unchanged.
3. THE MANNED-CANNON LEAVE ORDER (`7157aae3a2`). `tests/leave_vehicle_release_game.test.ts`
   seats a joined player at the North Watch cannon through the ordinary rig, then reads the
   vehicle from inside the leave save: it must already be released, since the save awaits
   Postgres while the world loop keeps ticking the leaving player until `removePlayer`, and
   a manned cannon there would run its encounter (credit, the score row, the retry lockout)
   past the saved snapshot. Measured cost: 3.8 s wall, 437 MB peak for the file. Mutants
   (control 1, 0 failed): the release dropped, and the release moved after the save (the
   `removePlayer` backstop alone), both KILLED.


## R1, THE THROWN-RUN RETRY POSTURE, 2026-09-27

Fernando's R1 (2026-09-26): keep a leaver's capture past a THROWN-run quiesce, the entry kept
and write-blocked for new edits, the capture retried once per error window, released only on
a commit or on an answer no repeat can change, installed by a rejoin meanwhile, counted under
`leave_captures`. Read with the 2026-09-27 ruling ("what's best for the project and feature"),
which this design applies where the letter of R1 leaves a choice.

### THE DESIGN (written before any code)

1. THE STATE. A thrown run no longer sets `quiesced`. `quiesced` keeps its one meaning, an
   answer no repeat of the same payload can change (stale, missing, conflict, the seal's
   identity and unnamed refusals, the write ceilings), and a throw is not an answer: the
   database said nothing. The run instead puts the entry on a per-owner RETRY CLOCK, a new
   entry field `retryAtMs` (0 when off): the entry stays `loaded`, unheld and unquiesced, so
   `blocked()` is false and its knowledge is trusted, but no write is ARMED for it until the
   clock is due. That is "write-blocked for new edits" as the store can honour it without
   losing them: an edit never starts a statement, it rides the next retry. The posture is
   sticky: every throw inside it re-arms the clock, and only a commit (or a quiesce) ends it.
   It generalizes R1 to the case R1's text did not name and the criterion covers: a run of
   throws while the session is still ONLINE used to quiesce the entry, so its leave captured
   nothing (a blocked entry flushes nothing) and the session's edits were lost at logout. The
   same posture now keeps them.
2. `owesWork`, `settle`, `maybeRemove` AND THE ORPHAN SWEEP. Unchanged predicates, new facts.
   A thrown write commits nothing, so the entry stays dirty and unblocked, and `owesWork`'s
   `isDirty && !blocked` clause holds it: `settle` does not release the capture (it releases
   only when nothing is owed), `maybeRemove` keeps the entry at zero references, and the
   orphan sweep resets its count every pass. `settle` never re-arms a posture entry off the
   clock: a `pending` edit that arrived during the thrown statement waits for the retry. The
   `arm` gate is one new clause, `retryDue(entry)`, beside `blocked(entry)`.
3. THE REJOIN. The replay arm and `answerForInstall` both answer `replayAnswer(entry)`, which
   offers the capture (or the committed state) for any unblocked entry, so a rejoin installs
   the leaver's unwritten house exactly as it does today while a leave write is slow. `retain`
   then releases the capture once the live record carries it (the existing revision match),
   because the live record now holds those edits and the retry writes the LIVE record
   whenever one stands (runWrite's rule, unchanged: the live record descends from the capture
   it was installed from, so it is a superset). A REJOINED SESSION MAY EDIT FREELY, and its
   edits ride the next retry; its own leave refreshes the capture from the live record (the
   flush captures any unblocked dirty entry, as now) and arms nothing off the clock, so the
   logout does not wait. Nothing a rejoined session does during the fault is lost, and it
   costs no extra statement.
4. UN-QUIESCE. A retry that COMMITS (inserted or updated) clears the clock and the run
   (`retryAtMs` 0, `writeErrors` 0) in `applyWriteResult`, beside the existing reset; `settle`
   then releases the capture when nothing more is owed, or re-arms at once for an edit the
   retry did not carry, on the ordinary cadence again. One warn line records the recovery.
5. THE CLOCK AND ITS BOUND. On `ports.nowMs` (bound to `Date.now` in
   `server/freehold_persist_wiring.ts`). Entering the posture and every throw inside it set
   `retryAtMs = failedAtMs + FREEHOLD_PERSIST_WRITE_ERROR_WINDOW_MS`. The periodic sweep (every
   `AUTOSAVE_SECONDS`) arms a due entry, so the spacing between two statements for one owner
   is at least one window (five minutes) and at most one window plus one sweep interval. The
   leave flush respects the clock (a mass disconnect during an outage must not add a
   statement per leaver). ONE exception, the shutdown drain, which ignores the clock and gives
   every posture entry one last attempt inside its deadline (item 7). A wall clock that steps
   BACKWARD past a window would otherwise stall the retries for the size of the step, so a
   clock reading more than one window before the failure that set it (`retryAtMs` less two
   windows) counts as due; a smaller step delays one retry by at most one more window.
   (Corrected at the build: the first wording, "more than one window before `retryAtMs`",
   made any backward step count as due.)
6. THE MEMORY BOUND. A posture entry holds its committed `state` (every loaded entry does) plus
   at most ONE capture, counted in `leave_captures`. So the added retention is
   `leave_captures` times the record size, and the posture set is bounded by the accounts
   that had an unwritten edit when the database stopped answering plus those that edit during
   the fault (at most the realm's online accounts over the fault's length), each counted
   once. Measured shape from the 07 records: 66.2 MiB per thousand captures at the approved
   420-row ceiling, 0.29 MiB with empty layouts. There is deliberately no count cap: a cap
   would choose whose edits to drop, which R1 rules out. The published gauge `retrying` (new)
   names how many owners hold it; the process restart bounds it in time (item 7).
7. SHUTDOWN, R3's BOUND. `idle()` runs with `draining` set, which makes every posture entry due:
   the drain arms it once, at the drain's cap, inside `FREEHOLD_PERSIST_SHUTDOWN_DRAIN_MS`. A
   database that answers commits it; one still throwing leaves the entry dirty and unblocked,
   so `drainCheck` answers false as soon as nothing is moving (not at the deadline) and
   `server/main.ts` prints its "freehold persistence drain did not complete" line: the capture
   ends with the process, which is R3's accepted bound.
8. A THROW ABOUT THE DOCUMENT IS AN ANSWER, added at the build: the writer's own structural
   refusal (a `TypeError` out of `requireUpsertInput`, which refuses before a byte is sent)
   and a payload SQLSTATE (class 22, data exception; class 23, integrity constraint) answer
   the same way every time, so a run of them still quiesces as before (the run-completing
   one before the clock, the first one on it), never holding the edits forever at one
   statement a window. Every other throw, including a permission or schema fault an operator
   fixes, is a fault and takes the clock (`freeholdThrownWriteIsAnswer`).
9. WHAT STAYS REFUSED, each still a quiesce that releases the capture: the stale fence (R2, the
   named activation gate 07a closes; its KNOWN COST pin holds unchanged), `missing`,
   `conflict`, the seal's identity and unnamed refusals, and the write ceilings. One case
   belongs to the fence and is named here: a thrown write can have COMMITTED (the connection
   dropped after the server's commit), and the next write then meets its own revision as
   stale. The row holds that attempt's document, so nothing up to it is lost; an edit made
   after it is released with the fence's warn line, because the compare-and-swap cannot tell
   this realm's own ambiguous commit from another realm's. Telling them apart needs a per-write
   token in the row, 07a's receipts. Pre-existing, not introduced by R1.
10. METRICS AND LINES. Gauge `woc_freehold_persist{measure="retrying"}` (entries on the retry
   clock, each holding unwritten edits; `quiesced` no longer counts a thrown run). Counter
   `woc_freehold_persist_total{measure="write_retries"}` (statements launched from the
   posture, so its rate against `retrying` shows the one-per-window cadence). Lines: the
   entry into the posture replaces "quiesced after N thrown writes" with one error line naming
   the window and that the edits are kept; every throw keeps its existing `write failed` error
   line (inside the posture at most one per owner per window); a recovering commit prints one
   warn line.
11. DEPLOY AND THE ROLLOUT CONTRACT. DEPLOY: `quiesced` loses the thrown run from its producer
    list; `retrying` and `write_retries` are described, with the reading "a database fault
    that outlasts three throws holds the affected owners' edits in memory and retries each
    once per five minutes; a sustained `retrying` is an outage, not a data incident, and a
    restart during it ends the held edits at the drain's deadline". The KNOWN COST paragraph
    names ONE runtime order (the fence) plus the drain deadline. The rollout contract gains
    the posture beside the drain: its memory cost, its cadence, and that a restart during a
    database fault ends the held edits after one last attempt (R3). The held-plot surface
    scope, `phase-07-qa.md`, `src/sim/freehold/CLAUDE.md`, the stats doc and the join-answer
    header follow.

THE PINS, test-first: the thrown-run KNOWN COST pin flips to "a run of thrown writes keeps
the capture and retries it once per window"; the stale-fence KNOWN COST pin stays; new pins
for the cadence (no statement before the window, one at it, a throw re-arms it), the release
on commit (capture released, clock and run cleared, row at the leaver's revision, entry
collected), the rejoin install (the capture installed, the rejoined session's edits riding the
retry, its leave refreshing the capture), a retry that stays thrown (capture and entry kept
across windows, one statement per window), the online run (a session's edits kept past its
own leave), the backward clock step, and a shutdown with a kept capture (one attempt, the drain
answers false before its deadline). The existing "still quiesces on a run INSIDE the window"
pin flips to the posture. Extraction pays for the lines under the 2058 ceiling, and the ceiling
is lowered after.

### THE BUILD, TEST-FIRST (`d0e96f8514` and its pins)

The design above, as built. `server/freehold_write_retry.ts` is the new leaf: the two run
constants (moved, re-exported from the store), `noteThrownWrite` (the run fold, the sticky
clock, the payload answer), `freeholdThrownWriteIsAnswer` and `freeholdRetryDue` (the due
test, the drain's exception and the backward clock step), with its own suite. The store
gains one entry field (`retryAtMs`), one gate in `arm` and one in `settle`, the clock's
clear on a commit with its recovery line, the entry line in the throw arm, the
`write_retries` count at the statement and the `retrying` count in the fold. The counters
and the scrape's fold moved whole to `server/freehold_persist_stats.ts`, and the registry's
zero stats derive from the same factory, so a counter added later cannot be missing from the
empty-store scrape. The metrics exporter publishes the two new measures. The store measures
2,026 lines and its ratchet ceiling is LOWERED 2,058 to 2,026 (exact, zero slack).

THE PINS: the 2026-09-26 KNOWN COST pin flipped ("keeps the capture past the run and writes
it when the database answers again", the row at the leaver's revision 8); the stale-fence
KNOWN COST pin kept unchanged under a describe that now names one runtime order; and new
cases for the cadence (no statement before the window, exactly one at it, three windows, the
`write_retries` delta, one posture line, every throw its own line), the rejoin (the kept
house installed, the rejoined session's edit riding the retry, its leave refreshing the
capture without waiting), an ONLINE session's run kept past its own leave, the backward
clock step (half a window back waits, a window and a millisecond back is due), an edit that
lands while a retry is out (it waits for the next window), a stale retry ending the posture
(quiesced, released), the clock cleared on a commit with the entry retained (a later single
throw is a blip on the ordinary cadence), the gauge dropping a quiesced posture entry, a run
of PAYLOAD refusals still quiescing and releasing, and the shutdown drain (one last attempt
answering false before its deadline with the capture still held, and a drain that writes it
when the database answers). Two older pins flipped from "quiesces" to the posture.

THE MUTATION PASS: 15 mutants, each behind a control (428 tests at the first batch, 430 at
the second, 0 failed), all KILLED. The first batch left two survivors, both masked because
the entry was COLLECTED when the posture ended: a commit that kept the clock, and a gauge
that counted a quiesced posture entry. The online-session pins that keep the entry alive
(`96953e25f9`) kill both. The fifteen: the fix reverted (every run answered, so
quiesced: 11 failures), the `arm` gate off, the `settle` gate off, the clock kept on commit,
`write_retries` uncounted, the gauge counting a quiesced entry, the drain respecting the
clock, no backward-step clause, a one-window backward step, the clock not re-armed on a
retry's throw, payload answers retried, the SQLSTATE classes ignored, a TypeError taken for a
fault, the recovery line removed, and the posture line removed.

### STEP 3, THE PERSISTENCE SUITE TRIM (`700f2eb685`)

The audit's approved list, re-located by title from its `2af5f917c0` line numbers (every one
still present). The proof ran twice through a scratch runner (apply one source mutant, run
`freehold_persist`, `freehold_revision_probe` and `freehold_write_seal` with JSON output,
restore through `git checkout`, assert a clean tree): BEFORE the edit (control 385 tests
across the three suites, 0 failed), where each mutant had to fail the case being deleted AND
a surviving case, and AFTER it (control 372, the persistence suite at 351, 0 failed), where
the same mutant had to fail the surviving or merged case. Every pair held. Mutants are one-line semantic changes on the path the deleted case
drives; the specs are kept in the session record, not the repo.

| Deleted case | Mutant it killed | Also killed by (surviving) |
|---|---|---|
| does read the row when nothing is live | `counters.loads++` to `+= 0` | is a live recorder; collapses concurrent preloads |
| reads the row when the permit is granted | loadOnce `if (!permit)` inverted | is a live recorder; refuses rather than falls through |
| writes for a load that was NOT held | `arm` refuses every unheld entry | writes when the record IS live; one running plus one pending |
| still names a row for a login that WAITED | an absent load answered `no_budget` | gives an absent row a minted plot id; still names a row when a SIBLING waits |
| installs nothing on a dark host | `loadFreehold` ignores the dark flag | installs no hearth clock on a dark host either; the absent arm of a DARK host |
| installs no plot from a bag that lost its shape | the install's shape guard off | installs the CLOCK even from a bag whose plot state lost its shape |
| leaves the immediate removal path alone | `maybeRemove` never removes (`refs >= 0`) | installs nothing when the record is already live; does NOT refuse a rejoin replay; blocks writes for an entry whose load has not landed |
| releases a retained capture on the ordinary flush | `releaseCapture` keeps the count | counts an outstanding capture; drops the capture once the write settled |
| collects a preloaded entry no session retained | the orphan grace one pass longer | collapses concurrent preloads |
| treats a revision that went BACKWARDS as movement | the probe calls a backwards revision clean | ARMS a write when the live revision moved BACKWARDS; refuses a REGRESSED revision for a ROW-LOADED entry |
| REFUSES the same reseed for a ROW-LOADED entry | the seal's name arm off | the it.each's CAUGHT UP row; COUPLES the install to the seal |

THE MERGES. The three MINTED-account reseed cases (TOUCHED, CAUGHT UP, EQUALS) share one body
and are one `it.each` now, each row asserting everything its case did (the touched case
gained the minted-name and empty-layout checks the other two made). Their mutants: the whole
seal off (killed by the TOUCHED row and the BACKWARDS and REGRESSED cases), the name arm off
(the CAUGHT UP row), and an equal revision let through the name arm (the EQUALS row only: no
other case in the suite sits at equal revisions, so that row is load-bearing). "keeps the
capture when a write FAILED without quiescing" folded into "keeps the capture when the
handshake that read it never joins" (its `writeCount` 0, `writeFailures` 1 and `dirty` 1
checks moved; the unconditional settle-release mutant and the uncounted null-permit mutant
are both killed by the merged case). "skips the write entirely when the owner holds no live
record" folded into "stops owing a write that has no record and no capture" (the
`serialize` and `running` checks moved; the uncounted-skip and skipped-serialize mutants are
both killed by the merged case).

THE WEAK PINS, each with a mutant the old form passed and the new form kills:
- The largest representable revision now pins `state.rev` to `Number.MAX_SAFE_INTEGER` (the
  mutant loads that revision as 0).
- "flushes what is dirty before it waits" now drives a ROW-LOADED entry at its committed
  revision, so only the dirty generation can arm the drain's write (the mutant drops
  `isDirty` from `idle`'s loop; on the old absent-row entry the revision probe armed it
  anyway).
- The four `>= 0` stats checks are exact values from a harness clock stepped inside each
  bracket (permit 7 twice, read 11, queue 19, statement 13; the mutant stops counting the
  queue wait).
- The pool-size source pin strips comments first (the mutant comments the old line out and
  sets 12).

"releases a retained capture on the ordinary flush" was on both of the brief's lists (a
high-confidence redundancy, and a weak pin wanting a positive control). It is deleted: its
covering case, "counts an outstanding capture", IS that case with the positive control (the
gauge at 1 while the write is held, then 0), and the control's own mutant (no capture ever
taken) is killed there.

### STEP 4, THE REVIEWERS ON THE PART 1 DIFF, AND THEIR ROUND

Five reviewers on `60cd9f859a..16cd1d3c36` (commits only, capped reports), plus the two the
qa-checklist named for the sim edits. Four hit their turn limits and were resumed with a
report-now instruction; every report arrived whole. Findings: 0 blocking, 3 should-fix, 17
nits, all applied (`9173c0c536`, `b2f2cc2e49`, `fb835f322c` and this record).

- privacy-security-review (0 blocking, 2 nits): any `TypeError` or `RangeError` counted as
  an answer, including a read-back after the statement and a store bug; `message` still
  rides the bounded error. APPLIED: the writer's refusals are the branded
  `FreeholdUpsertRefused` (`server/freehold_upsert_refused.ts`, a TypeError subclass so every
  caller that tested for one still passes), the only thrown class the clock reads as an
  answer; the message caveat stays where the bounded-error module states it.
- server-hot-path-reviewer (2 should-fix, 3 nits). SHOULD-FIX: the drain's clock exception
  outlived the drain (`draining` is never reset, and the pump launched deferred entries
  unchecked), so a hanging fault kept retries launching past the 10 s deadline into the
  lease release. APPLIED: the exception lasts while an `idle()` is open (`openDrains`) and
  the pump re-checks the clock (`stillWants`); pinned with four owners and a hanging writer.
  SHOULD-FIX: the memory bound under-counted an OFFLINE owner, which holds its committed
  state AND its capture, two records a quiesce used to free, and a write-only fault grows
  the set with login churn. APPLIED: MEASURED with a session probe of the real store, 180.3
  MiB per thousand offline owners on the clock at the approved 420-row ceiling (359.9 at
  two thousand, linear; the design's 66.2 MiB was the capture alone); a `retrying_offline`
  gauge; DEPLOY and the contract state both and the write-only growth case with an alert on
  a sustained `retrying`. NITS, all applied: the clock read short-circuits off the clock;
  retries hold at most `FREEHOLD_PERSIST_RETRY_WRITE_CAP` (two) write slots in their own
  deferred set pumped after ordinary writes, pinned (and the pump's re-admission on a
  settle); throws on the clock print one summary line per sweep instead of one per owner.
- database-performance-reviewer (1 should-fix, 4 nits; the 262,144 blob warning PASSES: the
  smallest 32 KiB step above the 230,068-byte fixture, and nothing else keyed on 229,376).
  SHOULD-FIX: DEPLOY called a single-realm stale write impossible, but the realm fences
  itself when the 65 s driver timeout fires across a slow COMMIT (which `statement_timeout`
  does not bound). APPLIED in DEPLOY and the contract, with the reading "stale after
  write_failures on one realm is a self-fence" and the adopt-if-identical option named for
  07a under R2. NITS applied: Node `ERR_*` TypeErrors no longer count (the brand), the quiesce
  line on the clock says so ("quiesced on the retry clock"), the pump checks the clock, and
  the cadence reads "at most one per owner per window".
- qa-checklist (0 blocking, 2 nits, both the classification, applied by the brand) and
  test-coverage-auditor (0 blocking, 5 nits): the rejoin and drain "did not wait" checks
  could not fail on their own (now each races the call against a few microtasks), the
  retain release on the clock was unasserted (now `leaveCaptures` 0 after the rejoin), the
  store's cadence sweeps stopped 30 s short of due (now one at `WINDOW - 1`), the ring model
  missed a double stuck pin (now the nearest of the leg into the waypoint and the leg before
  it), and the positive control is a hand-picked literal (kept on purpose and said so). Its
  tracing request: both "deleted" assertions survive (the revision one strengthened to the
  exact value, the capture count moved within its merged case).
- content-obligations-reviewer and architecture-reviewer (0 blocking, 2 and 4 nits): the ten
  removed patterns are Nythraxis's apex gear patterns (its `nythraxis_patterns` tail), not
  the Crucible's, which the test comment and this ledger now say (the earlier commit body
  and the section above keep the wrong raid name; this line corrects them). The old pool
  test's `kind !== 'tool'` is now the wearable kinds. PACING, INTENDED: the third wave now
  fires at waypoint 6, where Tobin's third line sits, so "Inside? Wooden horses and patched
  dolls" plays after the last fight rather than before it; the story still finishes before
  the market, and waves two and three now come one short leg apart. No draw count moves
  (`rng.pick` draws once whatever the pool size; the ambush ring is rng-free), and no parity
  scenario drives the caravan or opens a cache.

THE ROUND'S MUTATION PASS: 12 mutants behind their controls (450 tests across the four
store, retry, database and metrics suites; 12 for the clearance suite), all KILLED: the drain
never closing, the pump ignoring the clock, the arm's and the pump's sub-cap each removed,
the per-sweep summary off, per-owner lines on the clock, the clock wording forced off, the
offline gauge counting everyone, a plain TypeError taken for an answer, the SQLSTATE shape
check dropped, the writer's tier refusal unbranded, and (for the two-leg ring model, which a
source mutant can only reach through data) waypoint 3 moved beside the gate, which only the
leg-before arm catches. The store measures 2,011 lines and its ceiling is LOWERED 2,026 to
2,011, the round paid for by moving the write-side and lifecycle bounds whole
(`server/freehold_persist_bounds.ts`, re-exported) and four dead imports.

### THE FRESH READS OF THAT ROUND (`736fc144d7..`), AND THEIRS

Two fresh readers over `16cd1d3c36..736fc144d7`, commits only, capped: 0 blocking, 4
should-fix, 11 nits, all applied (`75f45bccae`, `dcffac111b`, and two test commits).

- Logic (a fresh server-hot-path-reviewer): SHOULD-FIX, `deferred_writes` had folded the
  retries in, so an outage fired the store's own saturation signal; the retries' backlog is
  now its own `deferred_retries` measure. SHOULD-FIX, the retry sub-cap throttled the
  shutdown drain to two lanes against the drain's eight, cutting each held owner's last
  attempt inside the deadline; while a drain is open the retries get the drain's whole cap
  (ordinary writes are still pumped first). NITS: a retry re-arming from its own settle went
  around the sub-cap (it now re-arms through `arm`, and a retry slot freed by a committing
  retry is offered to a waiting retry on that settle); a drain whose arm loop threw left the
  clock's exception open for the life of the store and threw out of a drain that never
  throws (it now closes the exception and answers false); throws after the last drain had
  no sweep left to report them (they log their own lines); the leave flush never waits on a
  leaver on the clock, launched or deferred (stated where the loop is); and a deterministic
  throw inside the store's own code (a `JSON.stringify` of a malformed document) is now a
  fault retried each window, which matches the ruling's reading that a store bug is not an
  answer about the document and shows only in `retrying_offline` (recorded, not changed).
  The login-pair read moved whole to `server/freehold_hearth_load.ts` to pay for the lines;
  the store's ceiling is LOWERED 2,011 to 1,988.
- Pins (a fresh test-coverage-auditor): SHOULD-FIX, the per-sweep summary was tested with
  one owner only (now two throws in one sweep give one line reading 2); SHOULD-FIX, nothing
  pinned that retries are pumped AFTER ordinary writes (now a freed slot goes to the waiting
  ordinary write while two retries stay deferred). NITS: the shutdown case's deadline check
  could not fail and picked by length (now it takes the drain's own job from what `idle()`
  scheduled, cancelled and never fired); the hanging drain now proves it was still waiting
  before its deadline; the read-back refusal is pinned UNBRANDED (a malformed returned
  revision after the statement is a fault, never an answer); the sub-cap case closes its
  gates; the rejoin asserts `retrying_offline` back to 0; the ring model's leg-before arm is
  pinned on a synthetic line (through an extracted `ringWorstClearance`).
- ITS MUTATION PASS: six mutants behind a control of 455, and the re-arm mutant again behind
  a control of 360 after its pin: the drain keeping the sub-cap, the settle re-arm bypassing
  the sub-cap (it survived the first pass, being observable only when ordinary leavers have
  borrowed past a drain's cap; the pin builds exactly that state), no pump on a freed retry
  slot, summaries never falling back to per-owner lines, the two deferred measures folded,
  and the drain's arm guard removed. All KILLED.
- THE READ OF THAT ROUND (a fresh general reader over `736fc144d7..b39877d85d`): 0 blocking,
  1 should-fix, 4 nits, all applied. SHOULD-FIX: a retry re-arming from its own settle went
  through `arm` BEFORE the pump, so it could take back its freed slot ahead of a waiting
  ordinary write (a gap the round left, not one it made); it now re-queues at the back of the
  clock's own set and the fall-through pump orders it, pinned by a drain whose cap retries
  fill with a healthy owner waiting. NITS: the leave-flush comment (a RUNNING retry is waited
  on to the flush deadline; only a deferred one is not), the drain's arm-failure path now
  reports pending throws (pinned), a comment's premise about sweeps corrected, and the settle
  re-arm case fires only the deadlines it scheduled. Its mutants: re-arming through `arm`
  again and launching directly, and the catch's report removed; all KILLED (control 361).
  The store stays at 1,988 lines. That read found nothing blocking, so the fresh-read loop
  ends here.

### STEP 5, THE ARMED GATE

Uptime checked and no stray `node_modules/node_modules` before each run; `npx tsc --noEmit`
clean; Postgres armed by `TEST_DATABASE_URL` alone, `tests/server/freehold_db.pg.test.ts` 16
of 16 before each run; `node scripts/gate_select.mjs` (the planner fell back to the full
suite on the branch's diff against the release).

- Run 1 at `b39877d85d` FAILED at the full vitest step, 1 of 72,987 tests:
  `tests/freehold_module.test.ts` "names every server file that reaches these leaves BY PATH,
  in CLAUDE.md". The round that moved the login-pair read into
  `server/freehold_hearth_load.ts` gave that module a by-path import of `persisted.ts`, and
  dropped the store's dead `hearth_key.ts` import, and `src/sim/freehold/CLAUDE.md`'s
  exhaustive list said neither. The derived pin did its job; the guide is corrected
  (`3167e0cbbc`, with a stale "these three" comment in the store).
- Run 2 at `3167e0cbbc`: PASS, ALL 12 STEPS GREEN: 4,966 files and 72,957 tests passed (2 expected-fail, 28 skipped, 1 file skipped), the browser suite 65 files and 541 tests. The PNGs the browser step rewrites under `docs/screenshots` were restored.

### STEP 6, 07 RE-JUDGED

VERDICT: PASS, WITH THE TWO NAMED GATES (R2, the cross-realm fence; R3, the shutdown drain's
deadline). Judged against the criterion as the brief states it:

- ONLY A GENUINELY ABSENT ROW RESOLVES TO THE FREE TIER-0 INN ROOM: HOLDS, as ruling (b) left
  it. R1 touches no load arm, and it removes one way a session met a stand-in beside a real
  row: an entry a thrown run used to quiesce stays loaded now and replays its kept document
  to a rejoin, where a quiesced entry replayed nothing.
- NO COMMITTED EDIT IS LOST: HOLDS (the join installs the loaded entry or nothing, and every
  refusal left keeps the row as it stands).
- NO CAPTURED EDIT IS LOST BEYOND THE TWO NAMED GATES: HOLDS. The thrown-write run, the order
  the 2026-09-26 re-judgement failed on, loses nothing now: a fault keeps the leaver's
  capture (and an online session's edits, which its own leave then captures) on the retry
  clock, retried at most once per owner per window, until a commit or an answer no repeat
  can change; a rejoin installs it meanwhile. What still releases a capture: the fence's
  stale answer, which is R2 (including the self-fence after an ambiguous commit, which the
  contract now names and 07a closes); the shutdown drain's deadline, which is R3 (each held
  owner gets one last attempt at the drain's full cap); and quiesces the criterion does not
  protect, as before: the seal's refusals (only a stand-in's capture), the write ceilings
  and a thrown refusal of the document (a legal record passes both, by the
  writable-implies-readable refusal that runs first), a `missing` row (the account's row
  deleted), a `conflict` (a minted id colliding). A store bug that throws deterministically
  is a fault now, so its edits wait on the clock until a restart, which is R3 again. A
  process that dies without draining loses what it holds, outside the criterion.

THE PRICE, named rather than discovered: an owner on the clock with no session holds up to
two records until the fault ends (measured 180 MiB per thousand at the approved ceiling),
uncapped by ruling, published as `retrying_offline`, with an alert on a sustained
`retrying` in DEPLOY.

THE EVIDENCE: the design written first; the build test-first; seven reviewers on the Part 1
diff and three fresh reads of their fix rounds (0 blocking anywhere, 6 should-fix and 32
nits, all applied); 36 mutants over R1 and its rounds, every one KILLED (four only after the
pin a survivor asked for); the STEP 3 trim proven pair by pair; and the armed gate green on
all 12 steps at `3167e0cbbc`. 07 is CLOSED as PASS; the fence (R2) is 07a's activation
gate, and the drain's deadline (R3) is the accepted bound of an orderly exit.

## PART 2, THE REPO-WIDE TEST COST, 2026-09-27

On this branch by the 2026-09-26 branch ruling, after Part 1 closed (`4f3529fb25`), in the
brief's order, each change measured with the forced-GC probe (retained heap: `heapUsed` after
two full collections at the end of every case) and a plain run under `/usr/bin/time`, one file
at a time on one worker. LOCAL: nothing pushed, no CI run exists for any of it.

### THE WORK, ITEM BY ITEM

1. LEAK A. `patches/@vitest__spy@4.1.11.patch`: restoring a spy (either path) drops it from
   @vitest/spy's module-level `REGISTERED_MOCKS`, which otherwise held every restored spy and,
   through its restore closure, the object it spied on, for the life of the worker. The first
   form tracked owners in a `Map`; the first full run went red on exactly that
   (`tests/text_sprite_cache.test.ts` spies `Map.prototype.set` and counted the library's two
   bookkeeping sets), so the patch was rewritten collection-free (`7d262fff1b`) and a pin keeps
   it off `Map`. Test side, independent of the patch: `releasedSpyOn`
   (`tests/helpers/released_spy.ts`) for spies on per-test world objects, and the wire suite
   clears its mocks (an admission stub called as a `cfg` method recorded the config as its
   `this`). A trap found and pinned on the way: a call-through closure written inline shares
   V8's function context with the release closure and kept the Sim alive anyway. The upstream
   issue is DRAFTED, not filed (the session record holds it; filing is Fernando's call). Each
   lockfile move re-minted the fingerprinted GLB families in place (`7072ec58e8`,
   `f75e511289`: 48 GLBs, sizes kept, digests swept, manifest regenerated, polish re-sealed).
2. THE SVELTE SETUP. `@testing-library/svelte/vitest` left the global `setupFiles` for
   `tests/admin/_setup.ts`, the only suite that mounts Svelte (`76c47cd342`, `18ddf3152c`).
3. WORKER SIZING. `GATE_BYTES_PER_WORKER` raised to the heavy files' measured floor, every
   fork's heap capped by `test.execArgv`, a bare `npm test` bounded by the gates' host sizing
   (one module now serves gate, gate_select, gate_fast, gate_shadow and the config), and
   gate_select's vitest legs under the full-suite lock (`f8cf433ad2`, `55d950872b`).
4. THE LANE. The three warlock anchor files and the five-minute windows joined
   `CI_LONG_SUITES`, `chronomancy_balance_targets` left, and the anchors take the
   balance-harness seed diet with per-configuration bands (`3c9e7481e0`). The lane job bound
   stays at its value; its re-derivation from the first full-mode lane walls is OWED.
5. THE DRUID MATRIX. Kept at ONE seed on PR (it already ran one: the audit read
   `DRUID_PROBE_SEEDS[0]` as eight, so the brief's "two on PR" would have raised the cost),
   and the eight-seed matrix the case defines now runs nightly under the flag, with its own
   bands (`e0be556a9e`; the eight-seed arm measured green, 908 s under load).
6. LOCAL LANE OPT-IN. A bare local run leaves the lane files out unless named or opted in;
   every gate leg opts in, and nothing is dropped under `CI` (`1b0a5b8868` and the review
   rounds below).
7. PARITY. One case per scenario records twice and compares the first recording to the
   golden (three recordings became two), and `SHARD_BOUNDS` is re-derived from measured
   per-scenario cost (`560b6166ff`).
8. THE SFX SUITES. The Studio security suite runs over a fixture root carrying the real
   catalog's file names over two real clips (`c167984565`). The export-core suite was NOT
   restructured: its first full build costs about 34 s and a second about 0.2 s (per-blob
   conformance cache), so a fixture-root determinism check would save 0.2 s.
9. ANIM PIPELINE. 26 files, one suite, one `it.each` table over every donor GLB
   (`3178d7b2af`; the same 125 cases and 1,175 runtime assertions).
10. `snapshots` split by describe into eight files with its source pins comment-stripped
    (`26084410b1`); the conservation sweep's readouts print only on request (`bebd32ae63`);
    Varkhul and Ignivar split at thematic midpoints over shared harness modules
    (`a04b1f6fc0`); `equip_drop_core` probed: its whole cost was one case's `Hud` import,
    now its own suite (`992b80c130`).
11. THE APPROVED DELETIONS (`841b93e48a`, `d45acba583`): 25 source mutants run BEFORE and
    AFTER; every removed or trimmed case's behavior still fails a surviving or merged case.

    | Target | Verdict | Proof |
    |---|---|---|
    | professions_crafting self-signed describe | deleted (a verbatim twin; its third case covered elsewhere) | ps_nodisc, ps_anysigner, ps_always |
    | action_bar_view three cases | deleted (byte-identical twins) | ab_scope, ab_unscoped, ab_cost, ab_instant |
    | gossip_menu line-9 case | deleted (the Marshal case, same input) | gm_never |
    | tests/quest_rewards.test.ts | deleted, after a direct override-precedence case | qr_nofallback, qr_nooverride |
    | quest_reward line 19 | trimmed (a formula restating line 18) | qr_nofallback |
    | ws_buffer 73-82 | trimmed (runs no repo code; no mutant possible) | by inspection |
    | social_status_dots tombstone | trimmed, its survivor strengthened (a mutant showed the old substring check passed on a CSS comment) | sd_rename, sd_nobg, sd_gone |
    | homepage_foundation 39-85 | trimmed | hf_english, hf_lang |
    | pvp_safety reset tails | trimmed, after a direct 60 s window case in stun_dr | dr_polynever, dr_fearnever, dr_polyshort, dr_fearshort |
    | farm_patch_placement 434 | MERGED (the dry-land arm's only false case) | fp_nolake |
    | stealth_render 12 and 17 | merged | st_localonly, st_otheronly |
    | fixes' two 1,220-tick runs | merged into one run | fx_eventtext, fx_noexpire, fx_noreturn |
    | fixes 995 and 1088 | KEPT: not copies (a rigged greed-over-need order; the only lootable-after-all-pass assertion) | n/a |

12. THE DURABLE GUARD. Measured time: `tests/suite_lane_threshold.test.ts` (a
    `CI_GUARD_SUITES` member) fails any file outside the lane over `LANE_THRESHOLD_MS` in the
    shard weights, with a positive control; the carry tool gained `--supersede` for a row
    whose file changed shape after the harvest (`26662a48c0`), and the table was pruned,
    superseded and carried (`5aaf414cc3`). Memory: `npm run test:memory` over
    `scripts/test_memory_budgets.json`, run nightly as its own step (`2cc313a8ca`,
    `70c6691f83`, `c1c6e9f9e3`). The rules are in root and tests `CLAUDE.md`,
    `docs/qa-gate.md`, and a test-cost item in `qa-checklist` and `test-coverage-auditor`
    (`c899e01cc9`). Tombstones: the policy is written, and one retired this pass.

FOUND ON THE WAY AND FIXED, each pinned: the duration ratchet's parser read the empty tail
after a trailing comma as the last argument, so every timeout in biome's multi-line call shape
was invisible, and an expression in the timeout slot passed silently (`40e10ea0d9`; three
suites it hid gained ledger rows).

### THE REVIEWERS, AND THEIR ROUNDS

gate-integrity-reviewer, test-coverage-auditor and qa-checklist on `4f3529fb25..558809d6ae`
(capped; each resumed once to report). 0 blocking. Should-fix, all applied: gate_select's
full-suite fallback and related side dropped lane files locally (every leg now opts in); a
named file could still be excluded (vitest's own filter rule now); the deletions commit had no
scope (reworded); the Map-free pin lacked a positive control; the budget validator lacked two
negative cases. Every nit applied: opt-in values, a null guard, a double-stub refusal, an exact
tier-cap case, a finish-order pin, the docs citing symbols instead of values, and the warlock
diet comments recording the same-day four-seed means (the auditor withdrew its band finding
once it measured them). Four fresh reads of the fix rounds: the first found the `gate_shadow`
validator still running without the opt-in and with its own sizing copy, plus five smaller
items, all applied (`ed4f649ca4`); the second found a filter naming the repo root (an absolute
root, `tests/..`) excluding every lane file, a root pin that could not fail, a tier assertion
sampling free memory twice, and the release-tier leg's opt-in unpinned, all applied
(`544d6614f4`); the third, four nits (the message's wording, reworded before anything built on
it; `vm_stat` still sampled, now mocked beside a memory-bound arm; `.` and the empty filter
unpinned; a later command word read as a non-filter), all applied (`836aeb83f3`); the fourth,
one should-fix (the comment and message said vitest reads a lone `-` as a filter; it drops it,
and keeping it only keeps more) and two nits, all applied in the same unpushed commit.

MUTANTS: 128, every one KILLED, each behind a control run: 59 on the items (Leak A and its
Map-free rewrite 18, the worker sizing 10, the memory tool 7, the local opt-in 5, the lane 4,
the ratchet parser 3, parity 3, the anim merge 3, the durable guard 3, the splits 2, the SFX
seam 1), the 25 deletion proofs above (each run before and after), 16 on the first review round
and its fresh read, 8 on the second and third fresh reads, and 12 on the gate catch and its two
fresh reads.

### THE BEFORE AND AFTER

Every row is one file alone on one worker with Postgres armed, BEFORE at the Part 1 tip
(`3167e0cbbc`, morning of 2026-09-27) and AFTER at `ed4f649ca4` (afternoon, same host,
same probe). Wall and peak RSS come from a plain run under `/usr/bin/time -l`; retained is
`heapUsed` after two forced collections at the end of every case, peak over the file. The
before side probed retained heap only for the four files the leak and memory work targeted
("n/p": not probed then). The unchanged rows at the bottom are the noise band between the
two sessions: read single-digit differences as noise.

| File | Change | Wall s | Peak RSS MB | Retained MB | Tests |
|---|---|---|---|---|---|
| `server/freehold_wire` | Leak A | 7.12 to 6.24 and 6.88 (a quiet-host re-run; 10.44 in the loaded batch) | 2424 to 1700 (1860 loaded) | 1757 to 561 | 117 to 117 |
| `guild_bank_persistence` | Leak A | 13.96 to 14.47 | 1346 to 1135 | 494 to 240 | 118 to 118 |
| `equip_drop_core` | its `Hud` case left | 11.18 to 7.48 | 1443 to 673 | 696 to 168 | 70 to 67 |
| `hud_touch_drop_routing` (new) | that `Hud` case | n/a to 11.56 | n/a to 1852 | n/a to 659 | 0 to 3 |
| `snapshots` (one file to eight) | split | 12.77 to 9.54 max (41.57 summed) | 1711 to 1079 max | 445 to 244 max | 270 to 270 |
| `varkhul_forge_encounter` (to two) | split | 46.88 to 24.36 and 24.08 | 1116 to 862 and 611 | n/p to 260 and 212 | 63 to 44 + 19 |
| `ignivar_encounter` (to two) | split | 38.20 to 18.68 and 23.15 | 1196 to 761 and 809 | n/p to 211 and 235 | 103 to 45 + 58 |
| `parity/parity_a` to `_g` | record twice, re-bound | 132.08 summed, 75.41 max (g) to 111.07 summed, 19.34 max (f) | 1209 to 875 max | n/p to 202 max | 168 to 84 |
| `sfx_studio_server_security` | fixture root | 39.78 to 6.11 | 349 to 286 | n/p to 23 | 16 to 17 |
| `anim_pipeline` (26 files to one) | merged | 6.07 to 2.21 | 386 to 473 (one process) | n/p to 135 | 125 to 125 |
| `warlock_anchor_destruction` | lane + seed diet | 80.93 to 41.65 | 496 to 399 | n/p to 152 | 2 to 2 |
| `warlock_anchor_demonology` | lane + seed diet | 74.94 to 39.74 | 536 to 424 | n/p to 153 | 2 to 2 |
| `warlock_anchor_affliction` | lane + seed diet | 72.28 to 38.92 | 531 to 421 | n/p to 152 | 2 to 2 |
| `audit_conservation_property` | readouts on request | 30.61 to 21.02 | 631 to 575 | n/p to 185 | 74 to 74 |
| `warlock_five_minute_windows` | laned only (unchanged) | 68.60 to 79.25 | 413 to 692 | n/p to 151 | 3 to 3 |
| `druid_balance_probe` | one seed both sides (unchanged on PR) | 120.97 to 143.13 | 797 to 759 | n/p to 161 | 7 to 7 |
| `sfx_export_core` | not restructured | 50.75 to 43.41 | 441 to 383 | n/p to 17 | 5 to 5 |
| `chronomancy_balance_targets` | left the lane (unchanged) | 8.29 to 9.18 | 401 to 383 | n/p to 151 | 9 to 9 |
| `parity/coverage_a` / `_b` / `_c` | unchanged | 13.47 / 14.53 / 36.80 to 13.89 / 14.66 / 34.41 | 596 / 576 / 950 to 531 / 772 / 753 | n/p | 77 to 77 |

The Svelte setup, measured over whole runs: 403.91 s of aggregate setup to 18.15 s.

The full run (the gate's full-suite fallback, 8 workers, Postgres armed): 946.50 s at
`3167e0cbbc` to 856.75 s at `c2e49691be`, both at 8 workers with the lane files in (aggregate
setup 403.91 to 16.93 s, test time 4,920.79 to 4,576.07 s, import 1,879.52 to 1,869.09 s; 4,967
files to 4,959, 72,957 tests to 72,947).

### THE ARMED GATE

The first final run (`node scripts/gate_select.mjs`, Postgres armed, proven first on
`tests/server/freehold_db.pg.test.ts`, 16 of 16; the full-suite fallback at 8 workers) went RED
on one file: `tests/vite_dev_watch.test.ts` reads `test.exclude` in `vite.config.ts` as string
literals and threw at load on the lane-scope spread item 6 added (`1b0a5b8868`). No full run
had happened since that commit, and no reviewer or fresh read named the guard; the gate is what
caught it. Every other file passed (4,957 files, 72,904 tests, 874.96 s). The fix
(`6c994c01c2`) admits exactly that spread by its source text and proves it can only add lane
test files, so any other computed element still throws; three mutants killed (a different
spread, no spread, a directory in the lane list), and its fresh reads: the first found the
admission matched by text alone (its import's module unpinned), the path check unpinned, a
formatter's trailing commas able to fail it spuriously, and module-level state, all applied
(`236deb8094`, four mutants); the second found the reader taking the first `defineConfig` call
anywhere and the first of two duplicate keys (older than this work: a decoy call or a second
`exclude` could have carried an agent directory past it), an array hole normalizing to an empty
array, and the lane function's output unpinned, all applied (`e0ac0a24f5`, five mutants); the
third: `defineConfig` unpinned to vite (a file-local function of that name could rewrite the
object after the guard reads it) and refusal cases matching any config error, plus two nits
(the lane output pinned whole; no root `vitest.config.*`, which vitest would prefer), all
applied (`49ef59b7d7`, four mutants); the fourth: a root `vite.config.js` or `.mjs`, which vite
loads before the `.ts`, unrefused, and a refusal pattern that also matched the outer member,
both applied (`338745d4e4`, two mutants); a last read-only check of that commit: one nit (the
refused names hand-typed from vite's unexported list), applied as a root listing that admits
only `vite.config.ts` (`c2e49691be`, two mutants; the pattern the reader suggested, `vitest?`,
matched neither file name, and the exact-list pin caught it on the first run). The re-run at
the tip: green on all 12 steps at `e0ac0a24f5` (856.50 s) and at `338745d4e4` (858.78 s), and
at the code tip `c2e49691be`: every step green with Postgres armed (16 of 16 first) at 8
workers, 4,958 files and 72,917 tests passed (2 expected fails, 28 skipped) in 856.75 s, the
browser suite 541 of 541, typecheck and every build.

### OWED, AND NOT CLOSABLE LOCALLY

- One fully green CI run under the heap cap (all shards, both lanes) and one nightly with the
  eight-seed druid arm, before this is pushed.
- The lane job bound re-derived from the first full-mode lane walls.
- The next full-mode harvest replaces the carried and superseded weight rows.
- The Ignivar herald GLB hashes the lockfile but is outside the re-mint tool and unpinned
  (pre-existing; its stamp is stale after the two lockfile moves).
- Filing the @vitest/spy issue upstream (drafted; Fernando's call).

## PART 3, UNUSED ASSETS AND TEST NECESSITY, 2026-09-27

### THE RULINGS (Fernando, 2026-09-27), RECORDED VERBATIM

After Part 2's report: "keep going this is fantastic. also, make sure all fhe screenshot ones we
take are actually necessary and helping the project. same with the ones that check the glb's
and all that. those seem kind of ridiculous. im not even sure if the glbs we test for are being
used."

Then: "if you find anything that isnt used at all, llease delete it."

Read together: the HUD-import extraction offered at Part 2's close proceeds; every screenshot
and GLB test is judged on whether it catches a real regression; and anything with no use at
all (no runtime, tool, test or live-data reference) is deleted, each deletion with its evidence.
A GLB still offered in the editor palette is NOT provably unused from the repo alone: editor
maps are stored on the live server (`maps.doc->'placements'[].assetId`), so a player's map may
place one. Those wait on a production read.

### THE AUDIT (four read-only investigators, 2026-09-27)

- GLBs: 1,416 under `public/`; 805 load at runtime, 114 are named only by build tooling, 497
  have no reference but the two generated directory listings (the media manifest and the
  editor palette). Seven of the 497 are outside the palette (a stale generated catalogue), so
  no map can place them.
- GLB tests: the lockfile and `package.json` fingerprint inputs attest nothing (the re-mint tool
  swaps the hash without rebuilding), the Eastbrook polish seals re-seal frozen screenshots over
  whatever changed, and exact byte pins repeat CI's manifest freshness check.
- Screenshots: no test compares a committed screenshot with a fresh render; about 1.47 GB of
  the corpus is referenced by nothing; six browser suites rewrite 21 tracked PNGs on every run;
  this branch's own `tests/freehold_capture_contract.test.ts` hashes 67 live source files.
- HUD imports: 49 runtime importers can drop `src/ui/hud` (about 658 MiB retained each) through
  nine extraction batches.

### WHAT WAS DELETED OR CHANGED, BY SURFACE

Screenshots (the corpus 2.5 GB to about 1.27 GB tracked; 4,410 files to 2,233):
- Browser capture is opt-in: six suites rewrote 21 tracked PNGs on every run; they now capture
  through `tests/browser/_evidence.ts` only under `VITE_EVIDENCE_CAPTURE=1`, guarded by
  `tests/browser_evidence_capture.test.ts` (`31db9e8c6e`, hardened `9da81cd426`).
- Evidence byte-seals removed: two whole files, five cases, a four-case describe (the freehold
  interiors block that hashed 67 live files) and the skill icons evidence loop, each beside the
  shipped-asset pins that stay (`080134f22c`); the capture receipt refusal matrix runs
  in-process (6.3 s to 3.7 s, `20b45d5974`).
- 411 directories and 67 loose files nothing referenced deleted, each checked by name
  (`f6fdfdd4ed`; its message says 412: `nythraxis-playtest-tuning` came back in `9da81cd426`
  because a `pr_shot_targets.mjs` comment points at it).

GLBs and assets (1,416 GLBs to 1,409; 25 shipped files deleted):
- The Eastbrook polish seal over the live tree, its diagnostics and the re-mint scripts retired;
  the capture rig's derivation keeps a synthetic, literal-pinned test (`52f7a72714`).
- `pnpm-lock.yaml` and `package.json` out of every GLB source fingerprint, 48 GLBs re-stamped
  once, the re-mint tool and its registry test deleted, guard
  `tests/asset_fingerprint_inputs.test.ts` (`e1ab71b5d1`). The Ignivar herald owed item closes:
  its shipping GLB carries no stamp.
- The retired Rallycart mount: model, 17 SFX clips, store art, seven wheeled-vehicle modules and
  their nine tests, the scripts; the reins item, icon and locale rows stay (`9ceb5ee7e3`).
- Six wreckage GLBs (replaced by the shipwreck set, never in the editor palette) and the
  unimported grand forge adapter (`6f960f50e0`); two dead renderer imports (`7495a08bc6`).
- Test cost: Fenbridge's per-float expects (6.9 to 1.4 s) and the loader's real retry sleeps
  (9.4 to 0.7 s) (`2fdf76984f`, `7bdde01716`).

The HUD import (`src/ui/hud.ts` 18,045 to 14,885 lines; runtime importers under tests/ 49 to 3):
nine batches (`63e4681bcd` B0/B1, `349d8038cd` B3/B2, `53a70db7eb` B6, `c73bc70767` B4,
`5f3f17410a` B5, `d01f6c8749` B8, `8a7dec2554` B7 plus the consolidation), each with its review
round (`fd897ab3f6`, `0320aedd6a`, `e037b45abd` typed hosts, `c4a113d518` visibility,
`748c79f557` the pet bar's feed mode and shared writer). The two
coordinator suites that still import Hud pay it once each; freed files retain 10 to 490 MiB,
from about 560 to 670.

Player-facing fixes found on the way, each failing-first:
- The emote wheel's Edit button and seat gap were author pixels compared with screen distances,
  so they drifted under a UI scale other than 1 (`0320aedd6a`).
- The masterwork and tier-up craft plate rode the ambient banner and a later ambient line could
  replace it behind a live level-up; it is a queued `deed` celebration now (`79a0ce3e0e`).

### THE REVIEWS

No reviewer or read found a blocking issue. In order:
- The deletions, four fresh lanes (test coverage, gate integrity, render performance, frontend
  seams) plus a coverage follow-up: one should-fix (the capture guard passed a helper that
  screenshots unconditionally after its gate, since a missing `return;` read as index -1) and
  nits, all applied (`9da81cd426`, `7bdde01716`, which also proves the loader's retry mock
  applies).
- A frontend seam review after every HUD batch, each round applied: B0 to B3 (ten items,
  `fd897ab3f6`: the tooltip parity over Sim and a bare client, the delegator pins, the lazy
  banner slot, one quest progress text home); B6 (the overstated emote claim, and the real
  UI-scale drift it surfaced, `0320aedd6a`); B4 with the plate fix (the host welds checked
  member names only while the routers cast Hud, answered by typed hosts that tsc checks,
  `e037b45abd`); B5, the typed hosts and B8 (members public without `readonly`,
  `c4a113d518`); B7 with the consolidation (the pet bar's per-frame raw display write and
  re-query, a concatenated aria label, a feed flag any importer could write, two overclaiming
  titles, `748c79f557`; the fifth, a moved `beforeEach` not clearing two map spies, was judged
  moot: those spies exist only in `tests/hud_map_marker_lifecycle.test.ts`, whose own
  `beforeEach` clears them). A fresh read of that round: one should-fix (a stale Hud comment
  still calling the feed mode Hud's) and four nits (a bags dep made redundant, a comment
  promising bare rigs could render, no pin on the aria key, a bags comment naming a `'block'`
  display nothing writes), all applied (`4acf8cc00a`); its mutation pass found the bags
  window's feed pick unpinned, now pinned (`cec4ebceed`). Two narrower reads
  followed: the first (on `4acf8cc00a` and `cec4ebceed`) found three nits (the invalidate
  weld bound to one call form, the fed copy unasserted, a latch clear redundant with the
  signature) and an older wording gap in the fan-out row, all applied (`ba44157555`); the
  second (on `ba44157555`) found five notes: the weld's claim wider than its check, the same
  double mechanism on the stance menu, the leave-and-return path unpinned and two omissions in
  the fan-out row, all applied (`206720229b`, mutation-checked, not read again), and one
  older behavior recorded below as a follow-up.
- The QA checklist over Part 3: ready once three should-fix items landed: weight rows for the
  new suites (`9b240ed70f`), notes still pointing at deleted work, and a size figure that would
  rot (`e8250212dc`).

MUTANTS: 39 in Part 3 killed, plus one tsc mutant proving the typed hosts catch a signature
drift; 167 across the session. One more survived first and was the finding: dropping the bags
window's feed-pick end left every suite green, so the pick got its pin (`cec4ebceed`) and the
same mutant was then killed.

### CORRECTIONS TO COMMIT MESSAGES (the commits stay as written; the record is here)

- `53a70db7eb` says a filtered emote wheel "could send a non-emote". Both writers of the slot
  list already sanitize it, so the one-list change is defensive, not a live bug; the module
  header says so since `0320aedd6a`.
- `f6fdfdd4ed` says 412 directories; 411 stayed deleted (`nythraxis-playtest-tuning` came
  back in `9da81cd426`).
- `52f7a72714` says "the three re-mint scripts"; it deleted two re-mint scripts
  (`remint_polish_provenance.mjs`, `rerecord_polish_provenance.mjs`) and the diagnostics
  script with its declaration file.
- `e037b45abd`'s subject names only the typed hosts; its body also carries two review items
  for `79a0ce3e0e` (the craft plate's tier-up case and the banner queue's limit note).

### FOLLOW-UPS, NOT DONE (none is a defect today)

- Five extracted modules sit flat in `src/ui/` (`confirm_dialog_controller.ts`,
  `resurrection_prompt.ts`, `keeper_revive_dialog.ts`, `tool_effect_confirm.ts`,
  `town_focus_controller.ts`) while the heroic purchase confirm went to `hud/vendor/`; the
  Crucible purchase confirm still lives on Hud beside where the heroic one was.
- `ActionPressController.pressSlot` calls the controller's own `castSlot`, not
  `Hud.castSlot`, so a future wrapper or spy on `hud.castSlot` would be bypassed; none exists.
- The capture receipt CLI's success path (print, exit 0) is reached by no test: the synthetic
  set always stops at the baseline check. It was so before `20b45d5974`.
- A pet dying or despawning hides the pet bar but does not end the food-selection mode, so the
  bags window stays in feed mode (a pick is then refused by the sim). Older than this work;
  changing it is a behavior decision.

### THE ARMED GATE

`node scripts/gate_select.mjs` with Postgres armed (`tests/server/freehold_db.pg.test.ts` 16 of
16 first, each time), the full-suite fallback at 8 workers: green on all 12 steps at
`e8250212dc` (72,937 tests, 866.77 s), and after the last review rounds at the code tip
`206720229b`: 4,964 files and 72,939 tests passed (2 expected fails, 28 skipped) in 845.93 s.
Part 2 closed at 856.75 s; the two runs here differ by 21 s with no suite change between them
worth that, so the wall clock is not evidence either way. The browser suite 541 of 541 with no
tracked screenshot rewritten, the malware scan, typecheck and every build.

### OWED, FOR FERNANDO

- 490 GLBs (19.61 MB) are referenced by nothing in the repo but the generated editor palette.
  Player maps live on the server and place models by `assetId`, so they need a production read
  before deletion:
  `SELECT p->>'assetId' AS asset_id, count(*) AS placements, count(DISTINCT m.id) AS maps FROM
  maps m, jsonb_array_elements(m.doc->'placements') p GROUP BY 1 ORDER BY 3 DESC;`
  Any listed id with no row is unused and can go; the list is `palette-orphan-glbs.txt` beside
  this ledger.
- Recommendation, not done: exact GLB sha pins repeat what the media manifest and a binary diff
  already show; the image-to-glb skill mandates them, so dropping them is your call.
- Recommendation, not done: the sparse CI cone still pulls 49 directories (about 895 MB) of
  referenced evidence into each sparse job; scoping it to what tests read is a CI decision.
- The next full-mode harvest replaces the 25 local-median rows the new suites carry
  (`9b240ed70f`). The 42 weighted suites that dropped their Hud import keep their rows on purpose: measured
  against six unchanged suites (CI over local 1.6 to 3.9, median about 2.5) they sit inside the
  same band (0.9 to 3.7), because the Hud import they shed was collect time, which these
  weights never counted.

## PART 4, THE RELEASE/V0.45.0 SYNC, THE OWED ITEMS AND THE FIRST CI RUNS, 2026-09-28

### THE RULINGS (Fernando, 2026-09-28), RECORDED VERBATIM

Asked at the session's start, with recommendations, all four answered as recommended:
- "(a) Push go: may I push feature/freeholds to origin (a NEW branch there, no PR) so the Part 2
  CI items can close (green run under the 2 GiB cap, nightly druid 8-seed, lane bound, weight
  harvest)?" answered "Yes, push (Recommended)".
- "(b) Exact GLB sha256 pins in tests (the image-to-glb skill mandates them): drop or keep?"
  answered "Drop, update skill (Recommended)".
- "(c) The sparse CI checkout cone pulls about 895 MB of referenced evidence into every sparse
  job. Re-scope it?" answered "Re-scope, with a guard (Recommended)".
- "(d) When the pet dies or despawns while the bags are in feed mode, should the feed mode
  end?" answered "Yes, end it (Recommended)".

Asked again before the first push, because the branch was not yet on origin and carries
counsel-bound drafts (`docs/prd/woc/freehold-counsel-memo.md`,
`docs/freeholds/phase-44b-final-legal-handoff.md`, the Terms amendment and the
territory and authority schedule), which a standing rule keeps out of the public repo. The
recommendation was a one-commit CI snapshot without those two files; Fernando answered "Push
the branch as is". On the production read (below) he answered "Record it as owed
(Recommended)".

### THE SYNC

Merge `555d16f445` takes `release/v0.45.0` at `ac9ed4db24` (179 commits, the Buried Hoards
release; 1,350 files changed; 96 conflicts by hand). The release's `src/ui/hud.ts` edits were
ported into the modules the branch had already extracted them to (the World Quest plate into
`src/ui/banner_slot.ts`, the faction goods lines into `src/ui/item_tooltip_view.ts`, the shock
bomb's bar press, bag-click aim and cooldown into
`src/ui/hud/action_bar/action_press_controller.ts`). The hoard guest payout read in
`server/ws_auth.ts` now runs before the freehold re-ask, so the re-ask stays the last await
before the join, and `server/game.ts` applies the guest usage inside the branch's guarded join
window. The deeds and Reliquary walks compose the release's `relicOf` tier rule with the
branch's furnishing stop. Retired seals and re-mint tooling stayed retired. The terrain corpus
is the release's body plus the branch's owner-room tail, byte for byte: 254 of 305,824 heights
changed in the release (value-aligned after the 20-byte header; merge lane 1's figure of 298
was an unaligned eight-byte window count and is not the number).

Four audit lanes (server and sim, UI and render ports, new surfaces, CI and doc premises) read
the merge from git objects: 0 blocking, 0 should-fix caused by the merge. Their notes, each
handled below: the hoard save projection had copied the discovery walk without the furnishing
stop; the minimap fallback had no arm for the Freehold Gate (older than the merge); a doc
figure for the cone (49 directories, about 895 MB) had gone stale; the release's 101 new test
files carry no shard weight rows yet. Neither `patches/` nor the lockfile moved (the release
changed only the `package.json` version), so no reinstall was owed.

The full armed suite on the merge then found what no conflict marker shows, fixed in
`052c2c7357`, `a126c5e8e5`, `c9d0350ab5` and `58e23ed574`: release pins reading `hud.ts`
source for paint the banner slot now owns, three ported Hud edits no test reached, the
release's ten Buried Hoard GLB families hashing `pnpm-lock.yaml` (seven listed it inline in a
build script the per-list guard never read, so the guard now reads every source under
`scripts/assets`; fifteen GLBs rebuilt by their own builders, only stamp bytes moved, four
portraits re-rendered under a receipt), and four branch pins the release moved without a
conflict (the bags use-case scan, the deed tail, the dark world fingerprint re-measured on the
release tip's own tree at 1,058 entities, and the freehold claim golden gaining only the
release's two new player fields).

### STEP 2: BLOCKED, RECORDED AS OWED

The production host (10.2.0.150, through the production proxy) refused this machine's key
("Permission denied (publickey)"); its host key still matched, so the key was most likely
removed in a rotation. Nothing was read and nothing deleted: the 490 palette-only GLBs stay,
and the query and the list stand as PART 3 records them.

### STEP 3 AND THE RULINGS, BUILT

- (a) The five flat HUD modules moved behind `index.ts` barrels (`c6412e4280`): the confirm
  dialog to `src/ui/hud/dialog/`, the resurrection offer and the Pale Keeper revive with its
  core to `src/ui/hud/revive/`, the tool-effect confirm to `src/ui/hud/professions/`, and Town
  Focus with its view and painter to `src/ui/hud/town_focus/`, each partner moving with the
  one module that alone imports it.
- (b) The Crucible purchase confirm left Hud for `src/ui/hud/vendor/crucible_purchase_confirm.ts`
  as `requestCruciblePurchase` over a typed host, beside the heroic one, with its own behavior
  suite (`87ce5902a6`). `src/ui/hud.ts` ceiling lowered to 14,866.
- (c) The capture receipt's success path is reached (`312b2f9670`): its two git reads go
  through an injectable reader and the CLI body is `runReceiptCli`, so one case seals a
  synthetic set end to end.
- (d) The pet feed mode ends the frame the primary pet dies, despawns or is dismissed, and
  open bags repaint out of it (`d521d17b62`), built test-first.
- Ruling (b): the exact sha256 pins on shipped GLBs dropped, structure, size, fingerprint and
  rebuild equality kept, the image-to-glb skill and docs updated (`d2094c9b34`); then every
  manifest URL and both foliage scripts' enforced sha tables tied to the bytes on disk
  (`755177e9d5`).
- Ruling (c): the sparse cone is derived from the unit-test-reachable closure
  (`tests/helpers/sparse_cone_corpus.ts`, with its own fixture suite), still coupled to
  `.github/workflows/ci.yml` by set equality in `tests/ci_workflow.test.ts`: 52 subtrees
  (about 1 GB) to 32 (about 596 MB) (`59310287cd`, widened by `5a6f707928`). A traced full unit
  run (lane files on, Postgres armed, not the release i18n tier) read nothing outside it.
- From the merge audit: one credit step for every found-item walk
  (`src/sim/item_credit_chain.ts`, `508d788524`, then one guarded def lookup `ec289473cc`),
  and the Freehold Gate's minimap fallback with an exhaustive switch (`efc1e623a5`).

### THE REVIEWS

Five fresh reviewers over the session diff, then a fresh read of every fix round and the QA
checklist. No reviewer or read found a blocking issue in the branch's own code except one: the
first fresh read caught a fix round that would have turned CI red (`tests/unbind_window_hud.test.ts`
still pinned the router's old raw bags check), fixed in `3d87dd0e5c`.
- Architecture: 0 blocking, 0 should-fix, 2 nits (the Reliquary tally's bare `ITEMS[id]`,
  applied in `ec289473cc`; a synthetic `ITEMS` row in `tests/item_credit_chain.test.ts` against
  caches, judged moot: the Reliquary memos key on the page table and the state, and no cache on
  that path derives from `ITEMS`).
- Content obligations: nothing owed by the branch; the findings are release-owned (below).
- Frontend seams: 1 should-fix (release-owned, below), 3 nits and 2 notes: the bags repaint
  helper's raw display read and its four domain copies (all through `bagsWindowShown`,
  `f205bf24fe`, `3d87dd0e5c`), the fan-out row's empty gate (the helper's own body is pinned),
  the half-arch door relying on its caller's stroke (it sets its own). The two notes are
  follow-ups below.
- Gate integrity: 2 should-fix and a nit (reach forms the corpus could not see, unseeded
  alternations, the trace environment unrecorded), all applied in `5a6f707928`.
- Test coverage: 7 should-fix and 3 nits (unenforced foliage sha tables, five manifest checks
  left on a bare regex, a missing corpus JSON failing too late, unseeded corpus arms, no literal
  pin on the receipt baseline, a Crucible dismissal that never dismissed, one of nine faction
  goods asserted, the aim-slot constant, uncommented source pins, the heroic precedence), all
  applied (`755177e9d5`, `5a6f707928`, `c93325ff23`, `ec289473cc`).
- Fresh reads of the session's fix rounds: of the review round (1 blocking above, 6 nits, all
  applied in `3d87dd0e5c`); of that round (3 nits, `0bdc0b7721`, and the half-applied one
  finished in `49d14616d5`).
- QA checklist over the session: ready with notes, 2 doc nits, applied (`dd812ff990`).
- After the first CI runs, every change (the two CI fixes, the bound and weight work, the splits
  and their pins) went through fresh reads round by round: a test-coverage reader on every test
  commit and a gate-integrity reader on every CI or gate commit, each round's findings applied
  in full and the fixes read again, until a round came back clean (the last, on `e0d973363b` and
  `8c8454cb19`: no blocking or should-fix finding, its two comment nits applied in `d4ba1a019c`,
  comment only). The readers found, and this ledger records as fixed: the close-path bags pins
  passing a commented-out copy, an arm left dead, a decoy copy of a method inside a literal, a
  constant `closeMobileBags`, and a drifted declaration; the escort pins passing a skip hook
  through an options object, a `beforeEach`, a wrapper, a shadowed callback, a comment marker
  split across strings, a line terminator inside a header, a re-export the shard files called
  but the pin never read, and a `continue` that skipped every round's assertion; the weight
  guard judging local rows in CI units, depending on the table carrying rows, failing open on an
  unknown method, and leaving its boundary unpinned; the lane rebalance modelled in the wrong
  order; and pr-gate's bound. Every such finding was proven with a mutant before it was fixed
  and killed after.

MUTANTS: 226 run this session, each behind a control run, restored by `git checkout` with the
file verified equal to HEAD before the next: 224 killed, 2 equivalent. The first equivalent
was a finding: the release's direct cooldown read for the shock bomb and the action bar's read
agree on every input, so the two were unified (`ac91cd18f2`) and the uniform read stays pinned
by the bomb-on-cooldown case. The second is the selective gate's own gap: a side-effect-only
import of an fs-touching helper does not floor a suite (FOLLOW-UPS, below), so the
portrait-inert pin, which asks the gate's discovery, rightly agreed with it; the same mutant as
a named import was killed. Not counted: two must-pass controls (they passed, as designed), one
invalid mutant (a decoy placed in a comment, which the pin strips; re-run as a real decoy and
killed), and one batch discarded whole because a transient git lock failed a restore mid-run
(re-run clean). A later lock failed one more restore after its mutant's result was read; the
file was restored by hand and verified before the next mutant. This paragraph read 149 and
148 at the Part 4 commit, a mid-session count it did not update; state.md and progress.md
carried the right 169 and 168 then.

### THE FIRST CI RUNS (the branch had never run CI)

CI runs only on pull requests, merge groups, pushes to `main`, `dev-*` and `release/**`, and
dispatch, so a push of this branch runs nothing: each run below was dispatched.
- The push itself met the pre-push floor's copy scan, which diffs against `@{upstream}`, then
  `origin/feature/masterwrought`: it reached 41 archived QA logs carrying tool glyphs and one
  em dash. The glyphs were normalized by a recorded mapping with every file's before and after
  hash (`copy-glyph-normalization.json` beside this ledger, `5997d7cc9f`), the dash removed
  (`16131786f9`).
- Run 36444276927 at `16131786f9`: three real reds and one cancel. Shard 5,
  `tests/unbind_window_hud.test.ts` (already fixed locally in `3d87dd0e5c`). Shard 2,
  `tests/focus_restore.test.ts` still naming `town_focus_window.ts` by its old flat path
  (`7df6aad13f`). Shard 6, `tests/freehold_npc_spawn.test.ts`: the dark world's position digest
  differs on x64. Measured with a bundled probe on the same Node 26.10.0: exactly one entity of
  1,058 differs, `warlord_drogmar` (id 332), whose spawn height is 3.7256669298810356 on arm64
  and 3.725666929881035 on x64, one ulp. Positions and facings now round to a micro-yard before
  hashing; both digests measured identical on arm64 macOS, arm64 Linux and x64 Linux
  (`13710714d1`). Lint was CANCELLED at its 15-minute limit: its depth-1 checkout fetch took 14
  minutes while PR checks finished its whole job in 3, a transient stall (the next run's
  checkout took 73 s).
- Run 36448553184 at `13710714d1`: fully green, full mode: all eight shards, both lanes,
  browser, checks and lint.
- The final full-mode run at the pushed tip: THE FINAL RUNS, at the end of this part.

### THE PART 2 CI ITEMS, CLOSED FROM THOSE RUNS, AND WHAT THEY TURNED UP

Both dispatched runs were full mode (the classifier logs `test_mode=full` for any non-PR
event). Every vitest leg ran under the 2 GiB worker cap `vite.config.ts` sets.

- The lane bound (`9a2a038a41`). Lane JOB walls: run 1, lane A 12.95 minutes, lane B 23.40 of
  which 10.88 was a stalled checkout (excluded, as release-gate excludes its stall walls; lane
  B's test step took 12.07); run 2, lane A 13.43, lane B 16.22. The workflow's formula, worst
  healthy wall x 1.60 x 1.37: 16.22 x 1.60 x 1.37 = 35.6, so both halves 28 to 36.
- The shard weights (`f2fd057f59`). A full harvest from run 36448553184 measured all 5,050 unit
  test files: the 1,049 carried rows (Part 2's 25 among them) are CI-measured, the release's
  101 new files are weighed for the first time, nothing was dropped (the tables diffed; the
  tool's provenance warning was checked, not trusted).
- What the harvest found (`c3d93d162a`, then hardened). Two files outside the lane weighed over
  the 90-second rule: `tests/parity/coverage_c.test.ts` at 108.7 s (84.2 s at the 2026-09-08
  harvest) and `tests/world_population_invariant.test.ts` at 167.9 s (43.3 s), the risk merge
  lane 4 named. Locally 33 and 54 s, the usual CI to local band, so the cost is real. Laning
  them would have pushed the lanes past pr-gate's bound, so both split along their cost
  clusters: `coverage_c` into contiguous c and d halves (every case body byte for byte, 504
  assertions before and after), and the escort sweep into four round-robin shard files
  `tests/world_population_invariant_a` to `_d` beside the rule's own file, over
  `tests/helpers/world_population.ts` and the Sim-free deal in
  `tests/helpers/escort_shards.ts`, pinned by `tests/world_population_shards.test.ts` (the
  shard files one exact template, the deal and one escort's rounds pinned whole, the sweep
  files kept import-graph selected) and by a live control in the rule's file that each term
  of the population budget fails one mob over. The reshaped files carry local medians until
  the next harvest.
- The pr-gate bound (`1253afcd00`, `d7b4d7a849`), found by the gate-integrity read of the
  above: its 37 was sized from a 2026-08-14 selective base while full mode, which the merge
  queue always runs, now out-walks it. Worst healthy full-mode shard wall 22.12 minutes (run
  36444276927 shard 7; two stalled walls excluded): 22.12 x 1.60 x 1.37 = 48.5, so 49, and the
  queue's critical path is 8 + 49 = 57 against its 90-minute ceiling. It is PREDICTED SHORT
  for selective PRs (the old 1.44 selective to full ratio puts a selective shard near 32
  minutes and its bound near 70), but no selective wall exists on this tree and a bound sized
  from an extrapolation is what the lanes' history forbids, so 49 stands until one is measured.
- The lane halves (`3366d49a99`, `289ff1c1cd`): `owned_class_balance_healer_contract` moved
  from b to a; modelled the way the lane runs (one uncached vitest leg per half at two
  workers, largest file by bytes first) the busier half goes from about 841 s to about 773 s.
- The lane rule in CI time (`38db43a873`, `714894ef6d`, `b82d10a2b7`, `577d07920f`): a
  carried row is a local measurement standing in for the harvest's, so the rule now judges it
  scaled by `CARRIED_LOCAL_TO_CI_RATIO` (4, above the split families' 3.13 and 2.91 and about
  the heavy files' 90th to 95th percentile) through `laneThresholdOver`, pinned over a
  synthetic table including rows exactly at the line. The shard packer deliberately still
  packs carried rows as recorded.

The first run's lint was a transient stall; the second run's lint passed. That pass is no
evidence, and neither is any recent one: see THE CI LINT JOB CHECKS NOTHING below.

### THE CI LINT JOB CHECKS NOTHING (found here, for the CI owner; not changed on this branch)

The "Lint (changed files)" job printed `Checked 0 files` and passed on this branch's
dispatched run, and, checked against the repository's recent history, on a pull request run
(35825423349, PR #4167, 72 changed .ts files) and a merge-queue run (36390343586, PR #4243).
The probable mechanism (the gate-integrity reader's reading of Biome, not yet reproduced): the
job checks out at depth 1 and fetches the base at depth 1, so `biome ci --changed
--since=<base>` diffs `<base>...HEAD` with no merge base, git fails, Biome keeps only the empty
stdout, and `--no-errors-on-unmatched` turns zero files into a pass. The workflow comment's
premise that the job "only needs the base commit object" is the false one. Until it is fixed,
the only changed-files Biome check that runs is the local pre-push floor (`npm run
ci:changed`), which `--no-verify` bypasses. The reader's proposed fix: fetch the merge
commit's first parent (depth 2), pass Biome an explicit two-dot file list, and fail closed
when the list is non-empty but Biome checks nothing. Opening an issue for it is an outward
act, offered to Fernando rather than done.

### THE NIGHTLY

The first nightly of this branch (run 36444280897, dispatched at `16131786f9`, 3 h 27 min)
failed 7 files of 5,067:
- Three already fixed by then (`tests/focus_restore.test.ts`, the spawn digest,
  `tests/unbind_window_hud.test.ts`).
- The eight-seed druid arm, the Part 2 item this nightly was owed for, TIMED OUT: the
  release nightly runs the matrix at one seed (the whole file 373 s), Part 2 made the nightly
  run all eight, and that one case overran its 2,400 s bound under the nightly's contention.
  The figures were in band (a local eight-seed run: best Moongrove single-target 149.3, best
  Wildfang 191.9). Fixed in `ffcd04292b`: the matrix is built from per-seed runs combined by
  the same zero-drop average (two seeds measured bit-identical to the old code), and the test
  runs one seed per case, each bounded at 900 s in the full sweep, then asserts the unchanged
  bands over the combined runs.
- `tests/owned_class_balance_druid_bands.test.ts` (194.32 against a 191 cap, full sweep only)
  fails identically on the scheduled `release/v0.45.0` and `main` nightlies (run 36414582084):
  release-owned, listed below.
- `tests/sfx_studio_server_security.test.ts`: one production export answered 400. It passes in
  the PR shards and locally alone, in sequence and concurrently with its sibling suite; the
  assertion now prints the server's error (`545aacb91f`) so a repeat says why.
- `tests/corpse_harvest_sim.test.ts`: the #2514 family sweep (7.2 s locally, a release-owned
  case this branch does not change) overran its 20 s default under the nightly's contention,
  which this branch's longer druid arm raised. It then failed PR shard 1 of CI run
  36487204792 at 20.65 s, and the release's own CI runs it at 19.0 and 20.0 s (runs
  36387797087 and 36392492012), so it is a release case at the edge of its default, not
  contention alone. `7667b93502` gives it the 60 s its sibling sweep (the same fresh Sim per
  harvest) already declares; the file stays inside its declared allowance. A timeout has no
  pin to mutate: the evidence is the CI walls above.

The final nightly at the pushed tip: THE FINAL RUNS, at the end of this part.

### AFTER THE PART 4 COMMIT: THE PORTRAIT-INERT SUITES

CI run 36480347471 at `0313c4272d`, the tip the Part 4 commit pushed, failed shard 8 on four
unhandled `ProgressEvent` rejections from `tests/char_window_drag_render_defer.test.ts`, the
same four the release nightly logs; its browser job's checkout stalled at the step's limit (the
known transient); every other job passed. The cause: the real portrait chip
(`src/ui/portrait_chip.ts`) starts GLB fetches (16 in that suite, measured; about 470 each in
`tests/char_window.test.ts` and `tests/quest_dialog_controller.test.ts`, the same latent flake)
that outlive happy-dom's teardown.
- The fix (`d576e273cf`, `b5dff2a233`, `41a96bc6c2`): the three suites stub the chip inline in
  `vi.hoisted`, install a fetch recorder there before any import runs, and restore fetch in an
  `afterAll` that asserts no fetch started. No dynamic import, so the two import-graph
  selected suites stay selected (`tests/char_window.test.ts` was already partial: it reads
  source).
- The pin (`748bdc1e19`, `94e498c448`, `95927b4831`, `162def31a9`, `f25fb17657`,
  `5ca5aad003`, `384913b740`, `ed2b36f07e`, `9c33bc285b`, `e2870cc06b`, `b5c31f53fb`,
  `2923d3f8b9`):
  `tests/portrait_inert_suites.test.ts` holds each suite's shape: the recorder inside its
  `vi.hoisted` callback and returned by that callback's first return, the chip stub, the
  `afterAll`, no `vi.stubGlobal` of fetch, and `globalThis.fetch`, `realFetch` and `fetched`
  named only where those blocks name them, so the real fetch cannot be put back or called
  around the recorder, nor the list emptied. It reads the source through the repo's
  tokenizing scanner (`maskCommentsAndStrings` in `tests/helpers/declared_timeouts.ts`),
  not the regex comment stripper, which reads a `//` inside a string as a comment and so
  could both hide code and keep a commented-out block: each block must be live code (the
  file's masking over its span equals its own, and the match ends back in code), and the
  counts read code only. Every check has a positive control that edits a real suite and runs
  it through the same function. A fetch captured or built under another spelling, and a
  slash the scanner misreads (it guesses regex against division), are beyond a text pin, as
  the file says. The pin also asks the gate's own discovery (`collectSuiteVisibility`) which
  of the three are always run, so a helper import or a stray comment that floored a selected
  suite fails here.
- The scanner itself, found by the same reads. `maskCommentsAndStrings` closed a block
  comment at `/*/`, reading the opener's star as the closer's, so `/*/ x */ it('x', fn,
  90_000)` hid a 90-second allowance from the declared-timeout ratchet
  (`tests/suite_duration_budget.test.ts`) (`743fbf4f7b`; no file's allowance moved). And it
  ended a `${...}` interpolation at its first `}`, so an object literal inside one flipped the
  rest of the line into template text (`b0fbc05104`): that one had hidden a real 120-second
  case in `tests/woc_market_delivery_pg_integration.test.ts` (its interpolation holds
  `JSON.stringify({ ... })`), whose exact ledger row rises from 330,000 to 450,000, the
  allowance it always had; only that line's mask changed (old and new parses diffed). And its
  regex-or-division guess ignored a closed string and a `${` (`7ce630b590`; no test file's
  parse or mask moved across all 5,141). Each fixed test-first, the fixtures seen red, then
  green; `27d04d7952` rewraps the new row comment inside the line width (comment only).
- Fifteen fresh test-coverage reads, one per round (two of them also covering `7667b93502`
  and the scanner commits), each round's findings (should-fix and nits) applied and mutated
  before the next read. The fifteenth, of `7ce630b590`, found no blocking or should-fix issue;
  its one nit is `27d04d7952`. Each intermediate tip's CI run was cancelled by the next
  dispatch, as the workflow's per-ref concurrency group does.

### THE ARMED GATE

`node scripts/gate_select.mjs` with Postgres armed (`tests/server/freehold_db.pg.test.ts` 16 of
16 first, each time). Green on all 12 steps at `6821930bf9` (73,981 tests), at `0ac0a048a3`
(73,984), and at the last code commit `8c8454cb19`: 5,072 files and 73,984 tests passed (2
expected fails, 28 skipped), the browser suite 554 of 554, 1,040 s. The tip after it,
`d4ba1a019c`, changes two comment lines only. Two earlier runs were stopped mid-way because
a fix round was still landing in the tree, and none of their results is counted. After the
portrait-inert, scanner and harvest rounds, green again on all 12 steps at `e57856af25` (the
interim ledger commit over code tip `27d04d7952`), the planner falling back to the full
suite: 5,073 files and 73,987 tests passed (2 expected fails, 28 skipped), 930.5 s, and the
browser suite 554 of 554.

### CORRECTIONS TO COMMIT MESSAGES (the commits stay as written; the record is here)

- `d521d17b62` says the bags repaint check "has one home, Hud.renderBagsIfOpen". Four domain
  copies and four `hud.ts` sites still read the raw display until `f205bf24fe` and
  `3d87dd0e5c`.
- `59310287cd` says 20 subtrees and about 467 MB; `5a6f707928` widened the cone to 32 subtrees
  and about 596 MB before anything was pushed.
- `d2094c9b34` says manifest entries are "checked against a hash of the bytes"; five harbor and
  ferry tests kept a bare hex regex until `755177e9d5`.
- `13710714d1`'s comment said a micro-yard "still catches any moved spawn"; the guarantee is a
  change of more than a micro-yard in any one coordinate (stated so since `abfd3d55ea`).
- `3de2bbf1c4` says the pin "requires each to run exactly the shard its suffix names", and
  `85e0a8c2bd` that each file "must register its shard as a live it.each with no modifier";
  both counted text an options object, hook or wrapper could defeat, until the exact
  template (`c57e17484f`) and the raw comparison (`f4001572a9`, `85855ac381`).
- `3366d49a99` gives the rebalance as 884 to 738 s, an LPT model; the lane runs files largest
  by bytes first, where it is 841 to 773 s (`289ff1c1cd`).
- `38db43a873` says the ratio of 4 sits above the 95th percentile of all 1,049 replaced rows;
  the population that matters is the heavy files near the line (`714894ef6d`).
- `c57e17484f` also rewords a `tests/parity/coverage_d.test.ts` comment its body does not name.
- `ad99b558e7` says "control every term of the population budget"; it controlled four of five
  (the hub practice yard and an active run's walker had none) until `204289ccba`.
- `8b14d71f20` says the SFX failure message "is sliced as text so a long error keeps its
  tail"; a head slice keeps the head (corrected in `767f0fc41f`), and the commit also mixes
  that SFX change into a `test(parity)` scope.
- `204289ccba` says "all seven sweeps"; they are seven escort cases in four sweep files.
- `e0d973363b` says seeds "collapsing onto one run past the first pair" passed the old check;
  it passed whenever any one pair differed.
- `b5dff2a233` says the inline stubs let "each" suite keep its gate classification;
  `tests/char_window.test.ts` was already partial, as `41a96bc6c2` states.
- `748bdc1e19` says the pin "holds their classes"; it asked `classifyTestSource` alone, blind to
  an fs-helper import the gate's discovery floors, until `94e498c448`. Neither message names the
  carried weight row both add to `scripts/ci_shard_weights.generated.json`.
- `94e498c448` says the recorder, the chip stub and the zero-fetch assertion are checked "as whole
  lines"; a block-commented copy still matched until `95927b4831` read stripped source.
- `95927b4831` says the discovery walk "skips" a scratch file deleted mid-walk; a vanished file
  reads as empty and a vanished directory lists nothing (worded so in `f25fb17657`).
- `162def31a9` says the recorder is "matched as a whole block"; the block left out its
  `vi.hoisted` wrapper, so a top-level recorder installed after the imports passed, until
  `f25fb17657`.
- `f25fb17657`'s comment says that with two fetch assignments and no `vi.stubGlobal` "no window
  of a suite can run unrecorded"; `window.fetch = realFetch`, a direct `realFetch` call or a
  cleared list still passed, and its positive control tested the stripping helper rather than
  the scan, until `5ca5aad003`.
- `5ca5aad003`'s comment says no line between the recorder and its return reaches column 0 "so
  the callback cannot close early", and that the real fetch cannot be put back "however it is
  spelled"; a decoy return, an indented close and a second capture were outside both claims,
  and three of its checks had no control, until `384913b740`.
- `384913b740` says the recorder must return "at its callback's first return"; a one-line
  `if` return or a return in a nested block still passed, and its comment gave the wrong cause
  for an early close failing, until `ed2b36f07e`.
- `ed2b36f07e` says no line before the recorder's return "may now hold a return in any form";
  a return behind a `//` inside a string passed, since the check read only stripped text,
  until `9c33bc285b`.
- `9c33bc285b` holds every check over the raw and the stripped text; a `'//'` string before a
  real `/*` still kept a commented-out block in both, until `e2870cc06b` read the source
  through the tokenizing scanner.
- `e2870cc06b` says each block "must be live code"; a comment or template opened inside the
  recorder's free lines and closed after the match still passed, and the scanner's `/*/`
  hole kept a commented-out block live, until `b5c31f53fb` and `743fbf4f7b`.
- `b5c31f53fb` says each block must "end in live code"; a block in a template nested inside an
  interpolation after an object literal still read as live, through the scanner's brace gap,
  until `b0fbc05104` and `2923d3f8b9`.

### RELEASE-OWNED FINDINGS, FOR THE RELEASE OWNER (the same on `release/v0.45.0`; not changed here)

- The Allied Hearthstone works from inside instances: `useAlliedHearthstone` checks only dead,
  combat, cooldown and busy, then `displacePlayer` (an overworld teleport) moves the player out
  of a dungeon, rift, hoard vault, arena, battleground or freehold room without `leaveDungeon`.
  The freehold claim frees on the next position sweep; battleground and arena effects were not
  checked. The release's own target dummy refuses instances; the hearthstone likely should too.
- The jail table (`server/freehold_wire.ts` here, `server/game.ts` on the release) blocks
  `unstuck` and the Hearth Key but not the Allied Hearthstone.
- `ClientWorld.useItem` drops the `aim` argument `Sim.useItem` honors, and the server `use`
  dispatch parses none.
- The Allied Hearthstone attunement is `Sim`-only and read through a cast in
  `src/ui/item_tooltip_view.ts`, so every online player sees "not attuned"; it belongs on a
  `src/world_api/` facet in both worlds with a parity pin.
- `t(hubKey as any)` in `src/ui/hud/faction_reward_tooltip_view.ts` hides the key from the typed
  check.
- CREDITS gaps: no row for `public/models/props/wisp_maze_kit.glb`, the 15 hoard mob portraits or
  `rift_marrow_golem.webp`; three currency icons covered only by an older batch's glob; six hoard
  clips marked `custom: true` but credited by the ElevenLabs and FFmpeg catch-all row.
- `cmb_coinsack_caught` was inserted mid-table in `src/sim/content/deeds.ts` (both ids are
  unshipped, so no shipped order moved).
- `tests/owned_class_balance_druid_bands.test.ts` fails the nightly full sweep (194.32 against
  a 191 cap on the fixed low-SP probe) on `release/v0.45.0` and `main` alike (scheduled
  nightly run 36414582084), so the nightly verdict is red on every ref until it is re-banded
  or the balance moves.
- `tests/corpse_harvest_sim.test.ts`'s #2514 family sweep ran within 25 ms of its 20 s default
  on the release's own CI, and `tests/owned_class_balance_groveheart.test.ts`'s heal-over-time
  case within a second of it on the release and main nightlies; each given 60 s here
  (`7667b93502`, `0462c0a7b8`, the latter with its ratchet row), which the release takes with
  this branch or on its own.
- `maskCommentsAndStrings` (`tests/helpers/declared_timeouts.ts`), the declared-timeout
  ratchet's scanner, closed a comment at `/*/` and ended an interpolation at its first `}`;
  the second hid a 120-second case in `tests/woc_market_delivery_pg_integration.test.ts` and
  understated its exact row by 120,000. Fixed here with fixtures (`743fbf4f7b`, `b0fbc05104`,
  the row now 450,000, and `7ce630b590` for its slash guess), which the release takes with this
  branch or on its own.
- The SFX Studio server trims a refusal's error from the front (`.slice(0, 1200)` in
  `scripts/sfx_studio/server.mjs`), while `scripts/sfx_studio/audio_io.mjs` keeps the END of
  ffmpeg's stderr, so a long failure can lose the line that says why.

### FOLLOW-UPS, NOT DONE (none is a defect today)

- A Necromancer whose primary pet dies while a secondary lives leaves feed mode with the bar
  still up (as ruled); online, a pet missing from the synced world for one frame (a teleport)
  would also end it. Neither has a test.
- A text pin cannot see a call in the middle of `closeVendor` that throws before the bags arm
  (a known limit of source pins; only a DOM behavior test could).
- Nothing at the PR tier proves `runDruidBalanceSeed` forwards its seed into the probe (the
  one-seed diet cannot); the nightly's one-run-per-seed check is where a seed-plumbing break
  would show.
- The selective gate's discovery floors a suite that imports an fs-touching helper with a
  `from` clause, but not one that imports it for its side effects only (`import
  './helpers/x';`): `buildHelperImportPattern` in `scripts/lib/test_visibility.mjs` matches
  `from` forms alone. Measured here by mutant (the side-effect form stayed import-graph
  selected; the named form was floored). No suite imports a helper that way today; a fix would
  add the bare-import form to the pattern, pinned beside its existing cases in
  `tests/gate_select_plan.test.ts`. For the gate owner; the file is the release's.
- Every `check:types` run prints a config-load error for
  `docs/screenshots/freehold-crafted-content-2026-09-07/runtime/vite.config.mjs` (its
  `../vite.config.ts` import does not resolve from the docs tree; svelte-check's config
  loader finds it and still reports 0 errors). The file is a hash-sealed reproduction
  config in that capture's runtime manifest, so it stays as recorded; it has printed the
  line since 2026-09-07.
- The shard packer packs carried rows as recorded rather than in CI time
  (`CARRIED_LOCAL_TO_CI_RATIO` is applied only by the lane rule); one shared helper would give
  the table one reading, at the cost of re-pinning the partition digest.

### OWED, FOR FERNANDO

- Step 2, the palette orphan read: the production host refuses this machine's key. The SQL
  and the 490-id list stand as PART 3 records them; nothing was deleted.
- The CI lint job checks nothing on pull requests and queue runs (THE CI LINT JOB CHECKS
  NOTHING, above): a fix in its own PR with the CI owner, and an issue if you want one opened.
- pr-gate's 49 is predicted short for selective PRs; re-derive from the first selective PR
  runs on the harvested table, and from the next full-mode walls. The first such wall (run
  36493201427) needs a ruling: shard 4's job took 24.0 minutes with a 5.5-minute checkout
  (the others took about 1.5), which the formula turns into 53 if that checkout counts as
  healthy; without it the worst healthy wall is shard 5's 19.8 minutes, 43, inside 49.
  Shard 3's 29.8 minutes held a 12.4-minute stalled checkout and is excluded, as before.
- release-gate's 36 (from a 16.43 minute wall) was not re-measured: release pushes run full
  mode with the lane files inside the shards, and full-mode shards here reached 22.12 minutes
  without them. Re-derive from the first release push after this branch lands.
- The next full-mode harvest replaces the nine carried rows (the split files and the two pin
  files), measured locally.
- The release-owned list above, for the release owner.
- The upstream `@vitest/spy` issue from Part 2 remains your call (drafted, not filed).

### THE FINAL RUNS

- CI run 36487204792 at `162def31a9`: every job green except shard 1, the release's #2514
  harvest sweep at 20.65 s against its 20 s default (fixed in `7667b93502`, above); shard 8,
  which failed on the portrait chip's fetches at `0313c4272d`, passed.
- CI run 36493201427 at `e57856af25`: FULLY GREEN in full mode, all eight shards, both lanes,
  browser, checks and lint (the lint job's pass is no evidence; see above). Test steps took
  10.3 to 17.8 minutes; shard 3's checkout stalled 12.4 minutes and shard 4's took 5.5 (see
  OWED on pr-gate's bound).
- Nightly 36480351546 at `0313c4272d` (3 h 28 min): red on 2 files of 5,073, checks and
  browser green. The eight-seed druid arm, the item this nightly was owed for, PASSED: all
  eight per-seed cases ran, 347 to 407 s each against their 900 s bound (3,054 s for the
  file). The corpse-harvest suite and the SFX export suite passed. The two reds:
  `tests/owned_class_balance_druid_bands.test.ts` at 194.32 against its 191 cap, release-owned
  as recorded above; and `tests/owned_class_balance_groveheart.test.ts`'s one-probe
  heal-over-time case at 20.94 s against its 20 s default. That case is byte-identical to the
  release, runs 19.2 s on the release and main nightlies (run 36414582084) and 15.4 s in the
  PR lane: the same edge as the harvest sweep, tipped over by this branch's heavier druid arm.
  `0462c0a7b8` gives it 60 s like the harvest sweep, and the file's exact ratchet row records
  the new 360 s sum (the sibling's 300 s plus 60); dropping either fails the ratchet
  (mutated), and a fresh read of it came back with no finding. So the nightly's only
  remaining red is the release-owned druid band.
- `0462c0a7b8` (a declared timeout and its ratchet row) landed after the armed gate at
  `e57856af25`; the ratchet ran on it directly, and this docs commit's own full-mode CI run,
  which covers it, is reported to Fernando with the part's close.

## PART 5, TEST COST AND TEST VALUE, 2026-09-29

### THE GOAL AND THE RULINGS (Fernando, 2026-09-29), RECORDED VERBATIM

The goal: "these tests are taking way too long. we need to continue driving this and cleaning
tests up. unit, e2e, screenshots, etc. our CI times must go down and we must make sure that all
new tests added and existing ones are actually worth it and not just taking up space and time."

Standing rulings carried in: do not open GitHub issues (the vacuous CI lint job and the
@vitest/spy upstream issue stay recorded only); the push go stands for this branch; never push to
a fork; never open or merge a PR unless told.

Asked at the session's start, with recommendations, all three answered as recommended:
- "(a) Part 5 targets, measured against CI 36493201427/36501749917 and nightly 36480351546: cut
  the slowest PR shard JOB wall (24.0 min) by at least 30%, the summed shard TEST time by at
  least 25%, and the nightly (3 h 28 min) to under 2.5 h. Accept these?" answered "Accept as
  proposed (Recommended)".
- "(b) pr-gate timeout-minutes: shard 4's job took 24.0 min with a 5.5-min checkout (others
  about 1.5 min). Counting that checkout as healthy gives 24.0 x 1.60 x 1.37 = 53; excluding it,
  the worst healthy wall is shard 5's 19.8 min, which gives 43 and fits under 49. Part 5
  re-derives the bound after its cuts either way." answered "49 stays (Recommended)".
- "(c) Evidence screenshots under docs/screenshots (2,417 tracked files, 1.3 GB) that no test,
  doc, script or provenance record references: may they leave the repo? Hash-sealed and
  test-pinned files (for example freehold-crafted-content-2026-09-07/runtime) always stay. Git
  history keeps every deleted file recoverable." answered "Delete unreferenced (Recommended)".

### STATUS AT THE PAUSE (2026-09-29, paused at Fernando's request, pushed; closed below)

Phases 1 and 2 are done with their QA docs; phase 3's import cuts have landed but its QA is
not run; phases 4 to 6 and the close are not started. The measured record is
`docs/freeholds/qa/test-cost-2026-09-29/` (README, `phase-01-measure-qa.md`,
`phase-02-judge-qa.md`, the per-file series under `data/`, and one record per phase 2 cluster
under `phase-02/`).

- Phase 1 (measure), `a059c8b457`: the per-file CI series of both green full-mode runs and
  the nightly, the local per-file and per-test series, module import cost, job walls, the Sim
  cost probes, and a file-level screenshot reference scan.
- Phase 2 (judge), `a2bd94a83e` to `3117492ffa`: the nightly-only depth flag, nine cluster
  agents over every heavy or suspect suite (173 shard files of 10 s or more in CI, the 17
  lane files, four collect-time suites), seven fresh reviewers, the cluster fix rounds, and
  six fresh reads of the fix rounds until one came back with nits only. Local full run 949.19
  s to 777.06 s wall, test bodies 4,985.75 s to 3,653.82 s (26.7 percent), import unchanged
  (2,143.79 s to 2,098.23 s). CI time is not re-measured yet (the harvest is phase 5).
- Phase 3 (imports), `dda91d4db5`/`fd7b3a2fe4`/`65b0d17d2c` as landed after `3117492ffa`:
  `src/ui/i18n.ts` no longer re-exports the 21 non-English locale slices (the five suites and
  `scripts/i18n_resolved_hash.mjs` that read them import the barrel; the resolved hash is
  unchanged; a TypeScript-parser pin in `tests/i18n_lazy_loader.test.ts` holds it, 3 of 3
  mutants killed), and the daily world quest catalogs build on first use. On three sample
  suites the locale modules loaded fell 26 to 4 and their import self time 3.43 s to 0.19 s.
  The full measurement run after these cuts was stopped at the pause.

OWED, in order, for the next session:
1. Phase 3: the full armed measurement run; the phase 3 QA (architecture-reviewer on
   `src/sim/world_quest_daily_generation.ts`, a coverage read of the i18n change and its pin),
   and any further import cut the measurement justifies (levers recorded: `en_XA` eager in dev,
   `wireEntity` inside `server/game.ts` pulled by six wire suites, the per-seed collider build in
   `src/sim/colliders.ts` that every fresh-seed suite pays).
2. Phase 4: the screenshot corpus under ruling (c) (477 files, 236 MB named nowhere in
   `data/screenshot_refs.tsv`; keep `eastbrook-vale-rebuild/`, `eastbrook-grand-armoury/`,
   README heroes, anything a test or provenance record reads), and a value audit of the
   browser suite and the capture scripts.
3. Phase 5: CI run on this tip, the weight harvest (it replaces every changed file's row and
   the nine carried rows), shard and lane rebalance, the bounds by the formula, the nightly
   sharded to get under 2.5 h (the unsharded test step was 201 min), checkout options.
4. Phase 6: the total-CI-time ratchet and the new-test admission rule.
5. The close: armed gate, `ci:changed`, the sweep, push, CI to green, one nightly, the final
   PART 5 record, state.md, the progress row, memory, the report.
- Rulings for Fernando: production idle culling in the balance harnesses (the lane record);
  the Scouring Mercy sanity bounds; the three `paladin_devotion_balance` rotation pins; the
  druid matrix's nightly-only cells (class owner).
- Watch the first nightly: the skill icon history clone (`git clone --revision`).
- Cleanup: the phase 2 agent worktrees under the main checkout's `.claude/worktrees/agent-*`
  and their `test-cost/*` branches are fully integrated and can go.

CORRECTIONS TO COMMIT MESSAGES (the commits stay as written; the record is here): 35 commits
of this part carry a body line over 90 columns where the rule asks for about 72 (rewriting them
would invalidate the landed SHAs the cluster records cite): 4f21570cb9 5758901696 bd438a62ce
9f7a0ba7ba 608ee86d7f 44f0d795df 53492ebffd 2bf773504f b8a151c217 d3d0e96ccf e0725870b1
fbd78cfb14 67db6d5790 1a0b2bf703 c3cc060fe2 9bcc0431f4 38f53752ee a60deef7dc 31d393def4
0f6594ffbc a881e6344b b037100a40 1f6774ce30 3a4ae5fba5 9c4f3cfaae 044b719747 26f7986a80
162689d483 0f1da76468 49a853ac69 533960327a b9844277cf 627e34245d 829bdc9811 c079279b56.

### THE CLOSE (2026-09-29): WHAT CHANGED, MEASURED

Resumed on a second machine from the pause. The record is
`docs/freeholds/qa/test-cost-2026-09-29/`: the rulings (`rulings-2026-09-29.md`, now six, the two
later ones recorded verbatim), one QA record per step (`phase-03-imports-qa.md` to
`phase-06-ratchet-qa.md`), and the per-file verdicts of the second and third slimming rounds
(`round-two/`, `round-three/`). Every step's changes were read by fresh reviewers round by round
until a round came back without a should-fix; every change to a test's guard carried a mutant
through the restore-verifying runner with a passing control first.

Against the ruled targets (baseline: CI 36493201427/36501749917, nightly 36480351546):

| Measure | Baseline | Target | At the pause (36583005398) | Final |
|---|---|---|---|---|
| Summed PR shard test steps | 115.73 min | at most 86.8 | 95.90 | 78.03 (run 36648684156), 73.05 (run 36654475632) |
| Slowest PR shard job wall | 24.0 min | at most 16.8 | 15.95 | 13.85 (run 36648684156), 13.40 (run 36654475632) |
| Nightly end to end | 3 h 28 min | under 2.5 h | not run | 60 min (36607799389), 50.5 min (36654497639) |
| Long-sims lane test steps | A 9.17, B 9.73 | | A 9.17, B 9.73 | A 1.77, B 2.10 (run 36654475632) |
| Shard pool (harvested CI weight) | 9,745,423 ms | | 9,745,423 | 4,937,172 ms (49 percent less) |
| Lane pool | 2,905,969 ms | | 2,905,969 | 307,115 to 418,492 ms (runner-bound) |

What changed, in order:
- Imports (step 3): the locale slices out of `src/ui/i18n.ts`'s barrel and lazy daily world quest
  catalogs; locale modules 773.7 s to 96.8 s of local import self time, daily generation 92.2 s to
  1.9 s, the local full run's import 3,439.84 s to 2,650.80 s (22.9 percent), CI shard import down
  16.6 percent. The sim memo is a documented single exception in `src/sim/CLAUDE.md`.
- Screenshots and scripts (step 4): 465 evidence files (231.3 MB, 67 whole directories) nothing
  named, and 85 capture scripts nothing ran, deleted under ruling (c); the browser suite audited
  (no whole-file delete; the keyboard-nav file slimmed to the cases Node cannot pin).
- The lane: the balance probes run under the shipped idle-mob cull (ruling 1, every band re-derived
  from culled actuals); the lane pool fell 88.6 percent and each lane job from about 12 minutes to
  about 4; the lane bound is 29 minutes by the stall-floor ruling (6).
- The nightly: sharded two ways per ref and checked out at one resolved commit; 3 h 28 min to
  about an hour.
- The worker trial (ruling 5): three workers per shard summed about 11 percent less shard test
  step but inflated per-file time 28 to 49 percent and timed out a subprocess; reverted.
- Three slimming rounds: the first (step 2) over every file over 10 s; the second over 285 files of
  the 5 to 20 s tier (238 changed, about 877 s of local test time saved); the third over 515 files
  of the 2 to 5 s tier that still built a full-world Sim (473 changed, 818 s saved). Remedies: a
  scoped world, one seed per file, the idle cull, forced rolls instead of hunted seeds, and costly
  sweeps kept whole only at nightly depth behind a PR representative.
- Test value: the rounds' mutants and reviews found cases that claimed a guard they did not hold;
  about 50 were fixed until each killed its mutant (a lockpick sweep that counted a burnt try as
  opened, a hub gate never checked for the queued tier, a tamed-wolf respawn case satisfied by any
  wild wolf, a heroic swap the chosen seed never ran, a charge case aimed at a stall the town no
  longer has, a restore two yards underground that passed, and more), and vacuous cases were
  deleted with proof another case keeps the guard.
- Three harvests of the shard weights, each lowering the stale shard ceiling in the same commit.
- The total-CI-time ratchet and the admission rule (step 6): the shard pool and the lane held under
  pinned ceilings on every PR; a new test file states what it uniquely guards and its measured
  cost in a strict `Cost:` field, counted into the ratchet until a harvest measures it.
- Fixed on the way (release-owned too): the druid bands' nightly red (gone at the culled config),
  an SFX Studio draft leak between files one worker shares, the greeting-decline floors after the
  script prune, and the gate's discovery of browser-named test files.

### WHAT DID NOT PAY OFF

- Three workers per shard (reverted, above).
- Import levers measured and left: `en_XA` lazy (about 37 s of local import), extracting
  `wireEntity` (about 7 s), a skirt memo in the collider build (14.6 percent duplicate probes).
- No checkout option was shown better by measured evidence; stalls of 3.8 to 16.45 minutes stay the
  runner's.
- Merging the two lane jobs (they now spend more on checkout than on tests) would change required
  check names: a maintainer decision.
- Several slims measured as noise and were reverted to KEEP (recorded per file).
- The admission rule's first parser read free text; each of four review rounds found a phrasing
  that read low, so it became a strict field, reviewed until a round came back clean.

### THE REVIEWS AND THE GATE

- Each step's reviews are in its QA record; the ratchet and admission rule took seventeen
  fresh reads; the slimming rounds each had coverage audits, and their findings were all applied.
- A final QA checklist over the 611 commits since the pause: PASS (INFO notes applied). An accuracy
  read of the records against the repo and CI: nine small corrections, applied.
- The armed gate (`node scripts/gate_select.mjs`, Postgres armed and proven 16 of 16): green on all
  12 steps at `f401981a04` (74,020 tests; the browser suite 67 files and 550 tests; the full vitest
  step 1,133 s at ten workers). A first run under heavy host load failed only in the browser harness
  (a module fetch and an iframe connection, in two files Part 5 did not touch) and passed on the
  rerun.

### OWED, FOR FERNANDO

- Confirm the lane ratchet band (`LANE_RATCHET_HEADROOM` 0.5, `LANE_RATCHET_SLACK` 0.8, the lane
  ceiling 366,000 to 461,000): a calibration fix to this branch's own ratchet from three harvests
  of an unchanged lane (307,115 to 418,492 ms), which also loosens it (a lane growing up to about 50
  percent on a fast-runner harvest passes). The alternative is lane rows harvested as a median of
  several runs, sharing the shard band. Settled 2026-09-30 by runner calibration instead: the lane
  shares the shard band again (`docs/freeholds/qa/test-cost-2026-09-29/`, the ratchet record's
  "The calibrated re-base").
- The collider grid build (about 1.1 to 1.8 s per seed, keyed by the active built-in world, not
  the Sim's `world:`) is now the floor of hundreds of suites; a lazy or cached build in
  `src/sim/colliders.ts` is the next test-time lever, a product change. GameServer has no world
  option either.
- Product questions surfaced by the tests: Swiftmend with no HoT spends mana and goes on cooldown;
  a save keeps only the feet's (x, z), so a roof save reloads beside the building; the overpower
  readout's player text carries a dash character the copy rule forbids; `src/sim/combat/
  stealth_focus.ts` has no importer; the self-centred AoE channel branch is unreachable (its
  comment names Bladestorm); the `/dev attune` header comment contradicts its body.
- The balance items from the rulings record: Groveheart's capstone insensitivity, the tight
  re-derived bands, the demonology end-pool rule never measured for demonology.
- The release-gate bound re-derivation on the first `release/**` push after this lands.
- `mail_instance` pays a real 47 s flight per case; only a product clock seam would shorten it.

### THE FINAL RUNS

- CI 36654475632 at `f401981a04` (the tip before this record): fully green in full mode. The
  summed shard test step 73.05 min (36.9 percent under the 115.73 baseline), the slowest shard job
  13.40 min (44.2 percent under 24.0), the whole run about 13.6 minutes, the lane test steps 1.77
  and 2.10 min. The shards spread 6.75 to 11.30 min: the weights count test time, not import time,
  which now carries a large share of a shard, so counting import in the weights is the next
  balance lever.
- Nightly 36654497639 at the same tip (the drill identity): green, 50.5 minutes end to end (the two
  halves 48.4 and 50.1 minutes of wall), against 3 h 28 min at the baseline.

### THE OWED DECISIONS, DELEGATED AND SETTLED (2026-09-30)

Fernando, verbatim: "For the decisions needed: do whats best for the project and feature." Each
decision, its evidence and its outcome is in `docs/freeholds/qa/test-cost-2026-09-29/
decisions-2026-09-30.md`. In short:
- The ratchet: runner-speed calibration adopted after five calibrated CI runs (shard pool spread
  1.249 raw to 1.069 calibrated, lane 1.384 to 1.064); the reference anchored at 178 ms; the lane
  shares the shard band again, so the lane raise is gone; ceilings re-based in calibrated time.
- Shard packing: a per-file import overhead (800 ms) in the packing cost; it gains nothing today
  (the sequencer already evens file counts), and the spread's real cause is runner speed.
- The collider grid lever: NO-GO after measuring (the grid is about 130 ms warm; most of a cold
  build is terrain calm sizing; laziness caps near 37 percent with collision-order risk).
- Found instead and fixed: the RL env's per-seed caches grew about 3 MB per episode seed without
  bound; released precisely by the env on reset and close (heap flat over 50 new seeds).
- Swiftmend (Fleetmend) refuses before any cost with nothing to consume; the dead stealth module
  deleted (superseded by the v0.40 merge's design); two contradicting comments corrected.
- Groveheart's capstones: a test gap, not a bug, now pinned by mechanic; Quickening gained unit
  pins; the group floor kept (it measures a harness artifact). The demonology end-pool rule
  measured and kept as a design constant.
- Found on the way and fixed: the browser jobs' font fallback raced a leftover package install.
- Kept as they are, with reasons: roof save heights, the two lane jobs, the release-gate bound,
  and the sim readouts' dash characters (a separate copy pass).
- The final runs: the armed gate green on all 12 steps at `450c7a95c2`; CI 36752774485 green in
  full mode there (summed shard test step 85.07 min on a slow runner draw, the calibrated pool
  beside the harvest's; one checkout stalled 9.47 minutes); nightly 36752778164 green, 52.9 min.

## 07a, TRANSACTIONAL MUTATIONS AND GLOBAL CLAIM FENCING, BUILT 2026-09-30 TO 10-01

### THE STEP 0 RULINGS (Fernando, 2026-09-30), RECORDED VERBATIM

Asked at the session's start, with recommendations, both answered as recommended:
- "Should 07a light the remote Hearth Key on a lit realm through the new transaction boundary,
  or keep its admission fail-closed until 08a lands the private cooldown mirror?" answered
  "Light it (Recommended)".
- "Does the push go still stand for this work?" answered "Push after the gate
  (Recommended)": push to origin only once the armed gate is green on the exact tip; no PR.

### THE SYNC

Merge `0008427d14` takes `origin/release/v0.45.0` at `55de7ffe92` (still the version-newest
release branch; three commits past the Part 4 sync at `ac9ed4db24`): the host-diag manifest's
`-text` attribute in `.gitattributes` and its pin in `tests/host_diag_bundle.test.ts`. No
conflict, and no branch-owned file, patch or lockfile touched; the release-merge audit found no
overlap, divergence, new route, re-bound helper or moved premise.

### THE DESIGN, BEFORE CODE

`docs/freeholds/mutation-touch-set-manifest.md` is the producing artifact the packet requires
before code: the queue order (Q1 character FIFO, Q3 store owner FIFO, Q2 market writer, Q4
background permit, Q5 pool client), the global lock order (G1 accounts KEY SHARE through G9 the
growth budget at COMMIT), the Hearth trip contract, every path statement by statement, the
pairwise deadlock review, the schema, the D88 per-row-class deletion policy, growth, export and
privacy, the plan inventory and the named residuals (R-1 to R-9). Revisions 1, 2 and 3 each
drew ACCEPT-WITH-CHANGES from all three acceptance readers (database performance, migration
safety, privacy and security), every finding mapped in its section 11; revision 4 recorded what
the implementation refined, revision 5 (section 15) what the domain review of the built code
refined. G14 (the `aaff789813` sync's census: the Weekly Vault opening's durability barrier as a
new Q1 caller, `world_quest_scores` and `glider_course_bests` as new reverse foreign keys) is
folded into sections 3 and 8.

### THE BUILD

`295395ba5f` (a behaviour-preserving extraction: the tick profiler name tables, the concurrent
index runner and the store's type surface moved whole, paying the monolith ratchet), the
manifest `f18188610b`, the feature `3387ccf3e8`, and the parity golden `1343b080bd`:
- THE GLOBAL PLOT CLAIM (`freehold_plot_claims`): a lease plus a monotonic fencing generation
  per plot id, checked in the statement; expiry governs only takeover; a release renames the
  holder `<holder>#released`, so it is final; rows are kept, so generations survive.
- THE FENCED WRITE: an existing row is one autocommit statement (fence, CAS, stamp), so a dirty
  plot pays what 07's write paid; a first insert is a short transaction beside its generation-1
  claim; an ambiguous earlier write adopts its own landed revision only on an equal token.
- THE CLAIMED LOGIN READ: the claim is taken before the character lease, and the row is read in
  the same bounded transaction under one budget; a foreign live claim answers the repairable
  `claim_busy` hold.
- THE RENEWER on the autosave cadence: sorted chunks of 256, one statement per transaction,
  single-flight with a pass deadline (a pass ends by the deadline plus one transaction wall,
  25 s, under the 30 s cadence), rotation, identity-checked drops, a FOR SHARE re-read of a
  release that threw, and the same-holder re-login race closed by an in-flight mark with the
  residual window detected (R-9).
- THE MUTATION HOOK on the three hooked character saves, after every legacy effect and before
  the tag-checked COMMIT; an ambiguous COMMIT is verified inside the permit on one checkout (a
  FOR SHARE wait, then per-kind evidence).
- THE HEARTH TRIP: the sim's admission seam is three-valued; a lit realm answers `pending`,
  advances the durable account cooldown through the hook, then re-dispatches the use under a
  one-shot server ticket, replaying the frame path's prechecks.
- OPERATIONS: open intents (capped at 8 per account) and terminal receipts (keep-forever,
  watched by a growth gauge); no production kind is registered (08 registers the first).
- D88: an open intent refuses a character delete (409 `character.freehold_operation_open`) and
  an account delete (55006 on the guard constraint); the soft delete erases its receipts.

### THE DOMAIN REVIEW AND THE FIX ROUNDS

Seven domain reviewers read the built diff: database performance, migration safety, server hot
path, architecture, test coverage, cross-platform sync, privacy and security; then the
qa-checklist. Their one code blocker (a renewer whose passes could stack in a brownout), one stale
test assertion and the qa-checklist's blocker (SQL in two logic modules) were fixed with every
other finding in `d4ebae4e33` and `663d507845`. The parity golden was minted on the commit before
07a and passes byte-identical (`qa/mutation-2026-09-30/parity-golden-provenance.md`).

Then fresh readers read every fix round, product code and tests separately, until one came back
without a should-fix. Each round found what the previous one introduced or left, and the findings
narrowed from defects to wording, then to the reach of one guard:
- Rounds 1 and 2 (`d4ebae4e33`, `663d507845`): the verify's one-checkout shim disabled its own
  wall; a committed advance dropped by a realm precheck spent the cooldown silently; the
  release path lost every time bound; the lock-free re-read could not see a still-committing
  release; drops did not check identity.
- Rounds 3 to 5 (`5e470b7973`, `5c76efb37a`, `0d5cdf8a8b`): the same-holder re-login race; the
  checkout bound folded into one transaction-runner option; the renewer's remaining branches
  pinned.
- Rounds 6 to 11 (`c35cb4b628` to `5ae0b7177b`): the renewer's voice and its clock made robust
  to odd hosts (a throwing, non-finite, backward or overflowing clock; a deadline Node's timer
  would clamp), each change pinned by the mutant it kills.
- Rounds 12 to 16 (`ded6b5c1ff` to `2da6e55292`): text the code did not match, tests that could
  not tell two mutants apart, the monolith rows re-pinned to their exact sizes (`df8a30a984`),
  and the guards that keep the renewer's call sites and rejection lists reviewed.
- Rounds 17 to 39 (`6e867c25e2` to `573db94f1b`), tests only, all in one case: the guard that
  pins every mention of the renewer by name, grown to close the alias escape where an alias would
  be declared. Rounds 17 to 20 enumerated alias forms, and each fresh read found another that
  slipped past (a build option, an imported fragment, a retargeted stub path, a new vitest config,
  a destructured build call). Round 21 changed the shape instead, the Part 5 lesson that a strict
  field with a stated boundary converges where a parser under adversarial review does not: the
  server bundle's build script is pinned whole, every other toolchain file is a program pinned by
  its declarations (imports with bindings, resolver hooks, alias lines and targets, writes,
  inventories, package keys, specs and flags), and a LIMITS paragraph names what is not read.
  Rounds 22 to 38 closed what each read found in that boundary's own edges, and the same lesson
  came back three more times, each time settled by a whole pin rather than a better reader:
  - the count read only `.ts` files under server/; it now walks every module there with the
    shared source walker, and one read of the tracked tree, as text, lists any other file naming
    the registry, the renewer or the bundle;
  - pattern readers of the Dockerfile kept missing shapes Docker accepts (an install spelling, a
    comment inside a continued step, a heredoc, a parser directive, a byte order mark); both
    Dockerfiles are now pinned exactly, line for line, behind a fail-closed inventory;
  - prose that argued why an unread file was safe kept proving incomplete; LIMITS is now a bare
    list of what is not read, each item a checked fact;
  - pin quality: every reader arm has a control matched by it alone, the tree read has a complete
    readability control and a binary-module control through the one grep it uses, the whole
    tracked listing is counted against a raw read of git's, and the listing sat at 87 percent of
    Node's default spawn buffer with no failure check (now a 64 MiB buffer that refuses a
    cut-off run).
  The case sits in the selective gate's always-run floor (it reads files off disk), so a change to
  any file it pins runs it.
- The fresh reads of rounds 25, 29 and 38 came back without a should-fix. The standing rule
  applied their suggestions too; the first two applications each drew a new should-fix (the
  reason the loop ran on), so the third was applied in the reader's own wording and read once
  more, narrowly. That read (round 39) came back without a should-fix; its two optional
  tightenings of an accurate comment are recorded under OWED rather than applied.
- The armed full suite on `573db94f1b` then found two failures that every affected-suite run had
  missed, because each sits in a file no changed module imports: the dark-arm record in
  `tests/freehold_npc_spawn.test.ts` said the parity goldens hold ONE lit build, but the Hearth Key
  golden this work added (`1343b080bd`) boots lit too; and a pinned vite import string in the
  renewer guard read as a Svelte testing import to `tests/vitest_setup_scope.test.ts`. Round 40
  (`3c35dbada0`) names both lit builds and splits the string; its fresh read came back without a
  should-fix, and its two optional hardenings are recorded under OWED.
- The armed gate on `3c35dbada0` then stopped at its malware scan: the round-20 read of
  `.npmrc`'s settings matched the scan's credential-file rule. Round 41 (`d38be09a9a`) drops that
  read, keeps the inventory of tracked `.npmrc` files, and names the settings in LIMITS. The
  next two fresh reads each caught that LIMITS item overstating the scan (it looks for no planted
  registry or token; only a file-read call naming the file trips it), and rounds 42 and 43
  (`d58dd6c0f2`, `4fddff13f0`) narrowed the wording to what the scan does; the settings stay
  unread rather than read in a way that steps around the rule. The fresh read of round 43 came
  back without a should-fix; its two optional tightenings are recorded under OWED.

### THE MUTATION PASS

`qa/mutation-2026-09-30/mutation-pass.md` and `mutants.json`. 212 mutants over the new guards,
run in a separate worktree on a second scratch database so the main tree was never mutated while
a reader read it, by the standing rule's harness (must-pass controls, file equal to HEAD before
each mutant, `git checkout` restore verified, a HUNG verdict, a clean tree after). The first
run's seven survivors (six weak tests, one equivalent) each gained the case that kills them; from
then the whole list re-ran on each commit the record's table names, and every round of the
toolchain guard re-ran every toolchain mutant on its own commit. Rounds 20 to 38 added those
mutants (each a route its round closed; those of a reader a later round deleted retired with it),
all killed, plus six probes the harness cannot express (an intent-to-add vitest config, workspace
file, Containerfile, `Dockerfile-realm` and private implementation, and an untracked `.mjs` call
site under server/), each refused; round 40 added three for its two fixes, all killed. On the
final code (`3c35dbada0`): 212 killed, and one survivor, the equivalent
`trip-pending-unconditional-delete`. That pass ran in two parts: the host's disk filled during the
first (another process on the machine), the harness stopped at a restore it could not verify (the
file was equal to HEAD), and the rest ran on the same commit behind a new low-disk stop; the
record says so. Round 41 then dropped one read and the one mutant that guarded it; every
toolchain mutant (99) re-ran on the final commit, `4fddff13f0`, all killed, and the rest of the list targets code that
commit did not touch.

### THE GATE

The armed gate (`node scripts/gate_select.mjs`, PostgreSQL armed through the session's scratch
server) is green on all 12 steps at `4fddff13f0`, its planner in full mode on this branch's diff:
74,463 tests passed (2 expected fail, 30 skipped) in 5,080 files, the browser suite 550 in 67,
the malware scan 0 high, every build and the typecheck green. On the way there, the armed full
suite on `573db94f1b` found the two failures round 40 fixed, the armed full suite on
`3c35dbada0` passed (74,463 tests), and the armed gate on `3c35dbada0` stopped at the malware
scan, which rounds 41 to 43 settled.

### OWED, NOT CLAIMED

- The paired QA, `phase-07a-qa.md`: run 2026-10-01, the 07a QA section below.
- The round-39 read's two optional comment tightenings, recorded rather than applied (the
  comment is accurate as written): say "an exclusion that drops any path" above the whole-listing
  count, and say that an exclusion inside the shared `git` wrapper moves both counts and is left
  to the floor.
- The round-40 read's two optional hardenings of the dark-arm record, recorded rather than
  applied: count every `freeholdsEnabled` token inside each lit scenario's slice (not only the
  `: true` form), and check that both lit scenarios are registered in `SCENARIOS`.
- The round-43 read's two optional wording tightenings, recorded rather than applied: say the
  scan's trigger is a file-read call naming `.npmrc` on one line, and say beside the inventory
  that the tree read's three-name search does read the file's bytes.
- `.npmrc`'s settings are pinned by no test since round 41 (a `node-options` or registry line
  passes both the renewer guard and the malware scan); closing that is a maintainer decision: a
  content rule in the malware scan, pinned in `tests/malware_scan.test.ts`, or a reviewed
  exemption for a test that reads the file.
- R-1 to R-9 (manifest section 12) are accepted residuals, each with its bound.
- What lands with the first registered operation kind (pinned as a tripwire): an automatic
  idempotent erase retry for deactivated accounts holding receipts, a receipts retention story,
  a deactivation story for open intents, and a plan that refuses a missing copy.
- The first production rollout of the housing tables in a quiet window (DEPLOY.md).
- A local gotcha, not a defect: the pg suites `freehold_mutation.pg` and the bank-ledger growth
  monitor use a fixed verify-database name, so two runs against ONE server collide (CI runs each
  once per service); run them against separate servers.
- Production stays disabled behind `FREEHOLDS_ENABLED`; every release gate stays unsigned.

## 07a QA, 2026-10-01

### THE RUN

The paired QA (`docs/freeholds/phase-07a-qa.md`) ran in this checkout on `feature/freeholds`,
scoped to the 07a implementation `0008427d14..11316ac3cd` (52 commits, 130 files); the
AI-architecture commits `941f926251..dca9711ab6` were out of scope. Fernando's host adaptations
governed. There is no Docker on the host, so PostgreSQL 16.14 ran in userspace on 55432 and
55433 (database `wocc_ci`), proved by `tests/server/freehold_db.pg.test.ts` at 16 of 16 before
any other suite. `freehold_mutation.pg` and the bank-ledger growth monitor ran against separate
servers (they share one fixed verify-database name). A skipped pg suite was never counted: every
run recorded its executed totals. Every finding of every round, with its disposition and
commit, is in [../mutation-2026-09-30/qa-findings.md](../mutation-2026-09-30/qa-findings.md).

### THE ROUNDS

- ROUND ONE, twelve readers over the built code (privacy and security, server hot path, database
  performance, migration safety, cross-platform, the test-coverage auditor, architecture, the
  qa-checklist, a test-coverage reader, correctness, hygiene and the docs librarian): 136
  findings (8 blocking, 38 should-fix, 90 nice-to-have, several the same defect seen twice) plus
  12 gaps from the STEP 1 coverage matrix. The fixes landed in `c77fd01be4` through
  `a2a969d13b`: among them a throw after a proved COMMIT now reports committed, a prepare answers
  only its own account, the renewer bills its launch and stops before the shutdown release,
  every new statement is plan-pinned in real PostgreSQL, and the contention, P9, renewer and
  first-rollout benches ran.
- ROUND TWO, eight fresh readers over that fix round: 85 findings, one blocking (the export's
  release-in-finally pin passed with no `finally`). Fixed in `fddc60bf6c` through `54ac963ce0`.
  The boot bench found that EVERY boot already holds `characters` and then `accounts` under
  ACCESS EXCLUSIVE (a no-op `ADD COLUMN IF NOT EXISTS` takes it), so the first rollout adds no
  boot lock.
- ROUND THREE, eight fresh readers over round two: 61 findings, three blocking. The rejoin
  predicate round two added replayed a stale entry while its lost-claim re-read was still in
  flight (it now joins that read, and the predicate is a pure function tested clause by
  clause); a throwing-report case could not see a double live apply; and the ledger pointers
  named this section before it existed. The deadlock re-measured on TRUE steady-state boots has
  two paths: the boot's SHARE-to-ACCESS-EXCLUSIVE upgrade on `characters` (no `accounts` lock
  needed), and its `characters`-then-`accounts` order. With saves of the G1 shape in flight every
  bench boot was eventually aborted (R-11).

### WHAT IT FOUND THAT WAS NOT A COMMENT

- A cross-realm lost update the round-two fix introduced and round three caught (above), with a
  mutant that reproduces it.
- The boot deadlock class (R-11), predating housing, with both halves of its fix owed to the
  maintainer.
- A renew chunk cut at COMMIT by the stop's wall can still land after the release-all (R-13, the
  crash bound); a chunk parked at its checkout is now cut there.
- At shutdown the housing drain can fill the whole pool, so the claim and lease releases can
  fall back to expiry (R-12).
- The operator's corrupt-Hearth repair could shorten a healthy cooldown if run during a database
  clock step; DEPLOY.md now has a read-only detector first and forbids the repair during a step.

### EVIDENCE

- `npx tsc --noEmit` exit 0 at every round's tip.
- Every `*.pg*` file armed against PostgreSQL 16.14 on each round's tip: 626, then 640, then 641
  passed, never a skip.
- Mutants on each round's new guards, each killed and its source restored.
- Benches, recorded with their scripts in
  [../mutation-2026-09-30/workload-evidence.md](../mutation-2026-09-30/workload-evidence.md):
  - Two realms racing for 1,000 plots: no 55P03 and no 57014 on any path.
  - The renewer at 5,000 claims beside a full autosave burst: 165 to 203 ms, no row skipped.
  - The claimed login read on a 198,500-row claims table: p99 2.4 ms.
  - The renewer's synchronous launch: about 4.5 ms cold, p99 near 4 ms warm.
  - The boot deadlock under plain, G2 and G1 saves.

### OWED, NOT CLAIMED

- Both halves of the boot's deadlock fix (R-11), a maintainer decision.
- A login-time clamp for a corrupt Hearth row; it needs a clock-skew margin no constant names.
- The storage fragment still names `pg_catalog` second in its DDL path (the decoy exposure M4
  fixed for the operation fragment).
- The storage refusal's message in the federated cleanup carries an account id; its typed
  id-free class belongs to the storage path.
- A golden for the Hearth admission's pending and deny arms.
- The receipts gauge's rate budget (08, 15).
- The maintainer's rulings on three items:
  - L4: widening the `saves` profiler bucket to the two Freeholds flush jobs.
  - L13: whether THE LIGHTING RULING still lists remote-key authority as unsigned.
  - The remaining delivery labels in code comments.
- The `.npmrc` pin is a maintainer decision. Recommendation: a content rule in the malware scan,
  pinned in `tests/malware_scan.test.ts`, refusing any `node-options`, `registry` or script hook
  line in `.npmrc`. That is cheaper and narrower than exempting a test that reads the file.
