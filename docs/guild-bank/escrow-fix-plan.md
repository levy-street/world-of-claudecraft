# Guild bank escrow: defect analysis, direction decision, and implementation plan

Status: decision document. Read-only feasibility pass over `feature/guild-bank`; no production
code was changed to produce it. Companion to `docs/guild-bank/state.md` (whose "Accepted risks"
section this document partly invalidates, see "Doc debt" below).

The audit that preceded this document left five test files in the tree
(`tests/audit_*.test.ts`). Four fail by design and are the repros this plan is measured against;
`tests/audit_conservation_property.test.ts` is a green randomized property harness whose
characterization pins a fix must flip. All five are inputs to this plan and must be preserved.

---

## 1. The mechanism, verified

### 1.1 The root cause

`GameServer.saveCharacter` (`server/game.ts`) builds its book payload with `collectBooks`
(around 3661 to 3675):

```ts
const collectBooks = () => {
  ...
  return collectGuildBankSaves(
    (guildId) => this.sim.serializeGuildBank(guildId),
    carriedGuildBankSeqs.map(([guildId]) => guildId),
  );
};
```

`serializeGuildBank` returns the WHOLE shared live book. Guild bank books are one live object per
guild in `Sim.guildBanks`, mutated in place by every officer's op. So the payload any one session
commits is not that session's work: it is the sum of every officer's work, including ops whose
own character halves are not durable yet.

The character half is correctly fenced (`characterUpdateStatement` in `server/db.ts`, the
`EXISTS (SELECT 1 FROM character_leases ...)` predicate) and correctly atomic with the book half
(`saveCharacterAndGuildBankState`, `saveCharacterAndMarketState`, one transaction, rollback on a
fence miss). None of that is in question. The defect is that the book half being written is the
wrong value: shared state rather than own state.

The three reported findings are three consequences of that one fact. All three are confirmed.

### 1.2 Finding 1, the CRITICAL dupe: CONFIRMED

`reconcileUnflushableGuildBooks` (`server/game.ts` around 4002) runs when a save reports
`saved === false` (lease fence-out) or a leave flush exhausts its retries. It branches:

```ts
if (anotherSessionDirty && !revertLost) {
  this.sim.revertGuildBankDeltas(guildId, deadOps);
  continue;
}
this.sim.evictGuildBank(guildId);
// ... loadGuildBankRow(guildId), loadGuildBank(...)
```

The evict-and-reload arm assumes durable truth LAGS the fenced session, so returning the live book
to the row is a rollback. That assumption fails whenever another officer's escrow save has already
carried the fenced session's op into the row: the reload then RESTORES the op while the fenced
session's character half has rolled back. The value exists twice, both halves durable, no crash
required.

Confirmed by running the repros:

- `tests/audit_conc_guild_bank.test.ts:192` "MINTS copper: the evict-and-reload arm restores the
  dead session op from a TAINTED row": `expected 1002000 to be 1000000`, 2,000 copper minted.
- `tests/audit_conc_guild_bank.test.ts:247`, the item-shaped twin: `expected [true, true] to not
  deeply equal [true, true]` (the stack is in the durable book AND the depositor's durable bags).
- `tests/audit_cur_conservation.test.ts:194`: `expected 200000 to be +0`.
- Property witness, `tests/audit_conservation_property.test.ts:1194`, suite P4-GAP,
  `deposit_gold(B) | buy(A) | autosave(A) | fence(B)`, pinned as a characterization with
  `expect(r.ok).toBe(false)` and the durable evidence
  `DURABLE copper=400000` plus `DURABLE treasury=25000`.

The paired negative control at `tests/audit_conservation_property.test.ts:1225` localizes it: the
same shape with the surgical-revert arm instead of evict-and-reload conserves exactly.

### 1.3 Finding 2, the 500-op cap: CONFIRMED

`runGuildBankOp` (`server/game.ts` around 4107):

```ts
if (log.length > GameServer.GUILD_BANK_UNFLUSHED_OP_CAP) {
  log.length = 0;
  session.revertLostGuildBanks.add(guildId);
}
```

Dropping the log makes the surgical revert impossible, so the reconcile's `!revertLost` clause
sends the session down evict-and-reload EVEN THOUGH another session is dirty, which is exactly the
case the surgical arm exists to protect. The reload then overwrites the other session's unflushed
work in the live book, in whichever direction hurts:

- `tests/audit_conc_guild_bank.test.ts:348`, dupe on withdraw: the reload restores a stack officer
  B already withdrew and still holds. `expected [true, true] to not deeply equal [true, true]`.
- `tests/audit_conc_guild_bank.test.ts:403`, vaporize on deposit: `expected 550000 to be 600000`,
  B's un-flushed 50,000 destroyed.
- `tests/audit_cur_conservation.test.ts:469`, item form: `expected 8 to be 4`.

The cap is a legitimate memory bound. The defect is the DISPOSAL: dropping the log silently
downgrades correctness instead of bounding memory some other way.

### 1.4 Finding 3, the shadowed revert: CONFIRMED, and stronger than reported

The audit listed this as UNPROVEN at the fence-out call site: the surgical revert mutates the live
book but bumps no seq and schedules no write, so a save that captured the pre-revert snapshot may
still commit it. I ran the experiment the audit named (instrument the serial writer, drive a
two-session fence-out under artificial DB latency).

The structural reason it is reachable: `createSerialWriter` (`server/serial_writer.ts`) chains
`tail.then(write, write)`, so capture and commit are atomic with respect to other QUEUED WRITES.
But `reconcileUnflushableGuildBooks` does not run inside the writer. It runs in the fenced
session's continuation, after `await this.enqueueMarketWrite(...)` returns. So the ordering is:

1. B's thunk captures the shared book, its DB call returns false (fence miss), the writer releases.
2. The writer starts A's thunk, which captures the SAME shared book (still containing B's op,
   because B's reconcile has not run yet) and issues its DB write.
3. B's continuation resumes and runs the surgical revert synchronously against the live book.
4. A's write commits the PRE-revert snapshot.

Observed timeline, two officers, B fenced out, A's write gated between capture and commit:

```
capture char=2 bookTreasury=101500
char=2 FENCED OUT (returns false, nothing persists)
capture char=1 bookTreasury=101500
after ticks: live book treasury=100500      <- B's revert landed
commit char=1 bookTreasury=101500           <- A commits the pre-revert value
final live book treasury=100500
final durable book treasury=101500
durable copper char1=499500 char2=500000
durable copper delta = +1000                <- minted
```

The reported claim was "may still commit it". The experiment shows it is stronger than that. A
second run replaced the artificial gate with an ordinary 5 ms DB round trip and produced the
identical result:

```
capture char=2 bookTreasury=101500
char=2 FENCED OUT
capture char=1 bookTreasury=101500
commit char=1 bookTreasury=101500 (live is now 100500)
durable delta = 1000
```

No artificial latency is required. B's fence-out continuation is a microtask that resumes as soon
as B's thunk settles, which is strictly before A's I/O completes, so the revert lands inside A's
write window essentially every time a second officer's save is queued behind a fenced-out save.
This is the deterministic ordering, not a narrow race.

Two aggravating details:

- After this sequence the live book is BEHIND the durable book, and no session holds a dirty mark
  for the guild (A's cleared on its successful commit, B's was deleted by the reconcile). Nothing
  will converge them.
- Because the live book is behind, a realm restart RE-READS the orphan op out of the row and makes
  it live again. A restart promotes the skew into a permanent dupe.

`tests/audit_conc_guild_bank.test.ts:286` is the in-repo repro of the same shape
(`expected 1002000 to be 1000000`).

The experiment file was scratch and has been deleted; step P1.7 below turns it into a permanent
regression test.

### 1.5 What else the repros indict (scope warning)

The four failing files contain 21 failing cases indicting FOUR distinct defects, only one of which
is the escrow concurrency defect this document was asked to fix. This matters because the stated
acceptance criterion is "the four failing repros must pass".

| Class | Defect | Repro cases | Fixed by the escrow fix? |
|---|---|---|---|
| D1 | Shared-book escrow concurrency (findings 1, 2, 3) | conc 192, 247, 286, 348, 403; cur 194, 469; property P4-GAP | Yes, at the root |
| D2 | Disband / gquit TOCTOU: `guildBankHoldings` guard read once, not held across the awaits, then `onGuildDisbanded` wipes marks and logs | conc 449, 498 | No |
| D3 | `revertGuildBankDeltas` arithmetic: `buy_slots` refunds the treasury unconditionally even when the slot undo is skipped; `open_bank` undo is order-asymmetric | cur 542; probe 157 (G1) | No |
| D4 | `craftedRecipeId` stripped by the INSTANCED arm of `moveBetweenContainers` (`src/sim/bank.ts:105-112` omits it where the plain arm at 121-124 threads it) | probe 63, 78, 93, 108, 348; provenance 88, 103, 132 | No |
| D5 | Consume-then-fence residue (another officer consumed value that was never durable) and the auditor's blindness to it | cur 245, 286; property pins P4-RESIDUE and P5 | No, by any proposed direction |

D2, D3 and D4 are cheap and independent. D4 in particular is two missing arguments:

```ts
// src/sim/bank.ts, the instanced arm
if (countFit(dest, destCapacity, slot.itemId, slot.count, slot.instance) < slot.count) { ... }
addStacked(dest, slot.itemId, slot.count, slot.instance);
// vs the plain arm immediately below, which threads slot.craftedRecipeId into both
```

It launders a self-crafted item into an indistinguishable found item on one bank round trip, which
`tests/audit_cap_provenance.test.ts:103` drives end to end into an enchanting-skill grant the
disenchant gate should deny. It affects the PERSONAL bank identically, so it is not guild-bank
specific.

D5 is the one class NO proposed direction closes; see section 5.

---

## 2. Direction A: patch the reconcile

Proposal: take the surgical revert on both arms whenever the log survives, use evict-and-reload
only when the log is lost, and add a corrective write.

### 2.1 What it fixes

Almost nothing, and it makes one thing worse.

- Finding 1: partially and only in the live book. Taking the surgical arm when durable truth is
  already tainted stops the reconcile from RESTORING the orphan into the live book. But the
  durable row still contains it (another officer's save put it there) while the fenced character's
  half rolled back. The dupe stays durable. This is precisely why the proposal needs a corrective
  write, and the corrective write is where it fails.
- Finding 2: NOT fixed. "Evict-and-reload only when the log is lost" is today's behavior verbatim.
  conc 348, conc 403 and cur 469 keep failing.
- Finding 3: NOT fixed, and made MORE likely. Direction A's whole content is to take the surgical
  arm more often. Section 1.4 proves the surgical arm is defeated by any in-flight save. Direction
  A generalizes the broken arm.

### 2.2 The corrective-write objection is real, and worse than stated

The stated objection is that a corrective write persists a book half with no character half,
violating the escrow invariant. Assessed honestly, that framing is the weaker half of the problem.

The weaker half: an unfenced book write is the shape Phase 3 explicitly banned (`server/db.ts`:
"There is deliberately NO standalone saveGuildBankState: a book write outside the fence is the
dupe shape this phase exists to prevent"). But the invariant's PURPOSE is to stop value appearing
in the book without leaving someone's bags. A corrective write is a rollback, and it can be made
to ride the market serial writer, so ordering and clobbering are mitigable. Taken alone this
objection is manageable.

The fatal half: the corrective write would write the LIVE book, and the live book is shared state
containing other sessions' unflushed ops. So the corrective write itself launders those ops into
the row without their character halves. It reintroduces the exact root cause, on a new and
UNFENCED code path. To make the corrective write safe you would have to write "durable truth plus
only this correction", which is Direction B's mechanism, arrived at through a second write path
that has no lease to fence on.

Verdict: the objection holds. Direction A either does not fix the dupe or converges on Direction B
while adding an unfenced writer.

### 2.3 New risk introduced

A second, unfenced book-write path, racing the fenced one; broader use of an arm proven defeated
by ordinary save latency; and no change to the cap defect. Direction A is not recommended.

---

## 3. Direction B: persist durable truth plus this session's own deltas

Proposal: the escrow save writes "the durable book with THIS session's own deltas applied", not the
live shared book. A session can then only ever persist its own work.

The machinery this needs is already almost entirely present. `session.unflushedGuildBankOps` is
already a per-session, per-guild, ordered log of that session's book deltas
(`GuildBankOpDelta` in `src/sim/guild_bank.ts`), already recorded by `runGuildBankOp`, already
consumed prefix-wise on commit via `carriedGuildBankOpCounts`, and already replayable backwards by
`revertGuildBankDeltas`. Direction B promotes that log from rollback bookkeeping to the write
payload, which gives one symmetric invariant:

> A session's unflushed log is its uncommitted work. Committing applies it FORWARD onto durable
> truth. Aborting applies it BACKWARD onto the live book.

### 3.1 What has to change

1. `src/sim/guild_bank.ts`: add the forward twin of `revertGuildBankDeltas`. Refactor both into
   ctx-free functions over a plain `GuildBankState` (`applyGuildBankDeltasTo`,
   `revertGuildBankDeltasTo`), with the existing `revertGuildBankDeltas(ctx, ...)` as a thin
   delegate. Keeping forward and inverse adjacent in one file is how drift between them stays
   visible, and ctx-free makes both directly unit-testable.
2. `server/guild_bank_state.ts` (already the host-side seam, 96 lines): add
   `mergeGuildBankRow(durableRaw, deltas)` = `sanitizeGuildBankState(durableRaw)` then apply. The
   existing null-serialize skip rule (`collectGuildBankSaves`) is preserved unchanged: a guild
   whose live book is absent is still skipped entirely, so an oversized or malformed row is still
   never overwritten.
3. `server/db.ts`: `GuildBankSave` changes from `{ guildId, data }` to `{ guildId, deltas }`.
   `writeGuildBankRow` becomes a read-modify-write inside the existing transaction.
4. `server/game.ts`: `collectBooks` becomes `collectDeltas`; `reconcileUnflushableGuildBooks`
   collapses; the cap's disposal changes from drop to compact.

### 3.2 Must the durable book be read inside the transaction?

Yes, and this is not negotiable. A read outside the transaction is a lost-update window: two saves
could both read the same base and the later write would discard the earlier's deltas. The read must
be `SELECT data FROM guild_banks WHERE guild_id = $1 FOR UPDATE` issued on the same client, after
the fenced character UPDATE has already passed, so a fence miss still rolls back before any book
row is touched or locked.

`FOR UPDATE` is required for cross-process safety rather than in-process safety: in-process, the
market serial writer already means no two book transactions overlap. But the lease system exists
precisely because more than one process can contend for the same character, and a realm's book rows
are reachable from any process holding a lease. `FOR UPDATE` on a primary key is sub-millisecond
and costs nothing in the uncontended case.

A guild with no row yields no locked row and the base is the empty book, which is the correct
semantic (a pre-feature guild's deltas apply onto empty). The upsert then creates it.

### 3.3 Lock and ordering implications

- Statement order in the transaction is unchanged and must stay: characters (fenced) first, then
  `world_state` (market, mail) on the leave path, then `guild_banks`.
- Iterate the carried guilds in ASCENDING guild id so two transactions touching two books cannot
  deadlock on opposite orders. Today's `for (const gb of guildBanks)` inherits
  `session.dirtyGuildBanks` insertion order, which can differ between sessions. In practice a
  session belongs to one guild so the list is length 1 and the exposure is theoretical, but the
  sort is free.

### 3.4 Cost per save

One additional primary-key `SELECT ... FOR UPDATE` per dirty guild per save, inside a transaction
that already exists. Book payloads shrink: the write carries a merged book of the same size, but
the Node-side serialization of the whole live book on every save is replaced by a delta list that
is normally one or two entries. Net: one extra indexed round trip on the escrow path only, which
is the 30 s autosave for officers who touched the bank plus the leave flush. This is well inside
the heavy statement allowance the path already runs under.

### 3.5 Interaction with the lease fence

Unchanged and strictly improved. The fenced character UPDATE still gates the transaction and a
miss still rolls everything back. What changes is the failure mode: today a fenced-out session's
ops can still reach the row through ANOTHER session's save. Under Direction B they cannot, because
no other session's payload contains them. The fence finally means what its comments say it means.

### 3.6 Interaction with the serial writer

The market serial writer exists because whole-blob snapshot writes can commit out of capture order
and roll a shared blob back over a newer one. Direction B makes book writes read-modify-write under
a row lock, which is commutative and order-independent: a later commit can no longer discard an
earlier one. Books therefore no longer NEED the serial writer.

That is a real opportunity, because `server/game.ts` already records the cost of putting them
there ("collapses their effective save concurrency to 1 and can queue a leave flush behind an
autosave batch", with the escalation path named as a per-guild serializer). After Direction B the
autosave arm (`saveCharacterAndGuildBankState`, no market half) could come off the shared writer
entirely and retire that accepted risk. The leave flush must stay on it, because it writes market,
mail and books in one transaction.

Recommendation: do NOT bundle this. It is a separate, independently testable change and the escrow
fix should not carry a concurrency change too. Record it as the follow-up it is.

### 3.7 Can the revert machinery be simplified or removed?

Substantially simplified, and one whole concept deleted.

- `revertGuildBankDeltas` STAYS. The live book still needs rolling back when a session's work can
  never commit, because the live book is what players see and what subsequent ops act on. But it
  becomes UNCONDITIONAL: no `anotherSessionDirty` scan, no branch.
- `reconcileUnflushableGuildBooks` loses its evict-and-reload arm, its cross-session scan, its
  three-attempt retry loop, its oversized/malformed handling and its `async`. It becomes a small
  synchronous "revert my own ops from the live book" function. This is the single largest
  simplification in the change.
- `revertLostGuildBanks` is DELETED outright. Its only purpose was to signal "the surgical revert
  is impossible, fall back to reload", and there is no reload arm left to fall back to.
- `GUILD_BANK_UNFLUSHED_OP_CAP` is REPURPOSED, from a drop trigger to a compaction trigger. Under
  Direction B the log is the write payload, so dropping it would silently discard committed-intent
  work; that is no longer an option. Compaction is available instead and is semantics-preserving:
  gold deltas collapse to one net `copperDelta`; item deltas collapse per
  (`itemId`, canonical `instance`, `craftedRecipeId`) identity key, which is the same
  three-dimensional key the revert already matches on and the same key `guildSlotKey`
  (`server/bank_ledger.ts`) already uses. A 500-entry log compacts to roughly the number of
  distinct item identities plus one, so the cap becomes effectively unreachable rather than
  destructive.
- `loadGuildBankRow` (the single-row read) loses its only caller in `game.ts` and moves inside the
  transaction. Check for other callers before deleting the export.

### 3.8 The one genuinely new piece of logic, and its risk

The forward applier is new, and it is where Direction B's risk concentrates: the deltas are derived
from a before/after DIFF (`diffGuildBankOp`, `server/bank_ledger.ts`), not from the op's own
semantics, so replaying them forward onto a DIFFERENT base (durable truth, which may lack other
sessions' ops) must be well defined.

- Gold: a pure additive `copperDelta`, clamped by `clampTreasury`. Trivially well defined and
  commutative.
- Items: add or remove `count` copies of a three-dimensional identity, through the same canonical
  `addStacked` path the revert already uses. Well defined. Capacity must NOT be re-checked on
  replay: the book contract already tolerates over-capacity (capacity only blocks new deposits),
  and the live op already passed the live check. This mirrors the revert's existing
  clamp-do-not-throw contract.
- Slot ops: NOT a pure delta. `buy_slots` as "+6" would conflict if two sessions both bought.
  Record and replay slot ops as an ABSOLUTE "raise to at least N" instead, which is idempotent and
  commutative because the ladder only ever goes up. This is the one place the delta record's shape
  must change, and it also happens to remove the order-asymmetry that
  `tests/audit_cap_probe.test.ts:157` (G1) reports.

Mitigation for drift between forward and inverse: a property test that `apply` then `revert` is the
identity on an arbitrary book and delta list, and that `apply` is order-independent for
non-slot deltas. Cheap, and it is the test that keeps the twins honest.

### 3.9 What Direction B fixes, leaves, and risks

Fixes at the root:

- Finding 1. A's save never carries B's op, so when B fences out the reload arm has nothing to
  restore, and the reload arm no longer exists anyway. Property pin P4-GAP flips; conc 192, conc
  247, cur 194 pass.
- Finding 2. There is no log-loss state and no evict-and-reload arm, so the overflow can no longer
  downgrade correctness. conc 348, conc 403, cur 469 pass.
- Finding 3. There is no shared snapshot to capture, so there is nothing for a revert to shadow.
  A's write applies only A's deltas under a row lock. conc 286 passes.

Leaves:

- D2 (disband TOCTOU), D3 (revert arithmetic), D4 (`craftedRecipeId` strip). Independent defects,
  planned separately below because the acceptance criteria require them.
- D5, the consume-then-fence residue. Worked through explicitly: A deposits 400,000 live-only, B
  withdraws 250 of it, A fences out. Under Direction B, B's committed delta of -250 applies to a
  durable treasury of 0 and clamps, while B's purse durably gains 250. Still 250 minted. Direction
  B narrows the residue (it no longer requires laundering through another officer's save) but does
  not close it. Property pins P4-RESIDUE and P5 stay pinned. Section 5 says what would close it.

New risks:

- Forward/inverse drift (mitigated by the identity property test above).
- Live and durable books now legitimately diverge for longer, by design. Any code assuming
  "live equals durable after a save" breaks. The disband guard already fails closed while any
  session is dirty, which is the one place that mattered; the audit of other assumptions is a
  review item.
- One extra indexed SELECT and one row lock per dirty guild per save.
- No schema change and no persisted-shape change: `guild_banks.data` keeps exactly today's shape,
  and `GuildBankSave` is an internal interface. Rollback to the previous build is safe, which is a
  notable advantage over any option that changes the row.

---

## 4. Recommendation

**Direction B.**

Reasoning, in order of weight:

1. Direction A does not fix any of the three findings completely, and its central mechanism (the
   corrective write) reintroduces the root cause on an unfenced path. Its one substantive change,
   preferring the surgical arm, generalizes the arm that section 1.4 proves is defeated by ordinary
   DB latency.
2. Direction B fixes all three findings by removing the thing that causes them, rather than by
   adding a compensator that has to be correct under interleaving. Compensators for concurrency
   defects need to be right in every ordering; this change means there is no ordering to get wrong,
   because a session's payload no longer depends on any other session.
3. It is a net DELETION of machinery: the evict-and-reload arm, the cross-session dirty scan, the
   retry loop, and the `revertLostGuildBanks` concept all go. The reconcile becomes synchronous.
   Less code on the dupe-critical path is the outcome to want.
4. It requires no schema change, no persisted-shape change, and no migration, so it is safely
   revertible.
5. It retires, rather than documents, the "cross-officer escrow skew" accepted risk in
   `state.md`, and it opens the door to retiring the serial-writer concurrency collapse too.

The honest cost: one new pure function that must be the exact inverse of an existing one, one extra
indexed read per save, and a delta record whose slot ops change shape.

---

## 5. What no direction here closes

D5, the consume-then-fence residue, survives both directions, and the deliberate
clamp-do-not-throw contract in `revertGuildBankDeltas` names it already ("A missing copy no-ops:
another officer already withdrew it, the accepted residue"). It is a full cross-account item
duplication in the worst case (`tests/audit_cur_conservation.test.ts:286`: eight fangs where four
existed), and `scripts/bank_audit.mjs` is blind to it.

Two options, neither in this plan's scope, recorded so they are not rediscovered:

- **Strong Direction B (deferred, risky).** Make the forward apply REFUSE rather than clamp: if a
  session's committed deltas cannot be applied to durable truth, the escrow save fails and that
  session is reconciled. This closes D5 exactly. It is not proposed here because a save failing
  through no fault of its own cascades into a second reconcile, and the failure handling is a
  larger design than the fix it rides on.
- **Make it auditable (cheap, recommended as a follow-up).** Direction B creates the first place in
  the system that can SEE a residue happen, because the forward applier is the only code that knows
  both the durable base and the intended delta. Emitting a `bank_ledger` anomaly row whenever the
  forward apply clamps would make D5 visible to `scripts/bank_audit.mjs` for the first time. This
  is worth doing because it plausibly turns `tests/audit_cur_conservation.test.ts:286`
  (`expect(findings).not.toEqual([])`) green without closing the underlying residue, which is the
  right trade: an audited known residue beats a silent one.

---

## 6. Verdict on the `tests/guild_bank_persistence.test.ts:697` pin

The pin:

```ts
it('pins the cap and falls back to evict-and-reload once the surgical revert is lost', async () => {
  ...
  // A fences out while B is dirty: with the revert lost, the reconcile must
  // NOT skip (that resurrects the dupe) and must NOT trust a partial log;
  // it falls back to evict-and-reload from durable truth.
  ...
  expect(server.sim.guildBanks.get(GUILD_ID)).toEqual(durable);
```

**Verdict: it is asserting today's behavior, chosen under a constraint the recommended fix
removes. It is not evidence against the change. One sentence inside it must be carried forward.**

Reading it carefully:

- What it genuinely establishes is a pair of NEGATIVES: the reconcile must not SKIP (skipping
  resurrects the dupe), and it must not TRUST A PARTIAL LOG. Both are sound and both survive.
- What it does NOT establish is that evict-and-reload is correct. It establishes only that, among
  the three options considered at the time (skip, replay a truncated log, reload), reload was the
  least bad. The rationale comment is written as an elimination argument, and reads that way.
- The fixture proves the cost of the option it pins. Its own setup has officer B deposit 1,000
  copper before A fences out, and its `durable` row is `{ treasury: 100_000, ... }`. The pinned
  assertion therefore asserts that B's live 1,000 is DESTROYED by the reload. The test pins a
  vaporization, and `tests/audit_conc_guild_bank.test.ts:403` is that same vaporization written as
  a failure instead of an expectation.
- Its premise is "the surgical revert is lost". Under Direction B the log is never lost, because
  overflow compacts instead of dropping. `revertLostGuildBanks` ceases to exist and there is no
  evict-and-reload arm to fall back to. The pin's precondition becomes unconstructible.

Disposition: RETIRE, not invert. Replace it with two tests that keep its real content:

1. The cap still bounds memory, but by COMPACTION: drive past the cap and assert the log length is
   bounded AND that applying the compacted log is semantically identical to applying the original
   (this is the "must not trust a partial log" rule, carried forward and strengthened from a
   prohibition into a positive obligation).
2. The reconcile is always a surgical revert of the dead session's own ops and never touches
   another session's unflushed work, asserted with the exact fixture the old pin used (B dirty with
   an un-flushed 1,000) and the opposite expectation: B's 1,000 SURVIVES.

The `GUILD_BANK_UNFLUSHED_OP_CAP === 500` literal pin should be kept in place.

---

## 7. Implementation plan

Base off the latest release branch and its tracking issue, in a fresh worktree, per the repo's
default task workflow. The five `tests/audit_*.test.ts` files come along as the acceptance
harness.

### Phase 1: the escrow root fix (D1)

**P1.1 Forward/inverse delta pair.** `src/sim/guild_bank.ts`.
Extract ctx-free `applyGuildBankDeltasTo(book, deltas)` and `revertGuildBankDeltasTo(book, deltas)`
over a plain `GuildBankState`; make `revertGuildBankDeltas(ctx, guildId, deltas)` a delegate.
Change the slot-op delta record from relative to absolute ("raise to at least N"). Preserve the
clamp-do-not-throw contract and the three-dimensional item identity match verbatim.
Tests: extend `tests/guild_bank.test.ts` with the apply-then-revert identity property, the
non-slot commutativity property, and the raise-to-N idempotence case.

**P1.2 Host-side merge seam.** `server/guild_bank_state.ts`.
Add `mergeGuildBankRow(durableRaw, deltas)` = `sanitizeGuildBankState` then `applyGuildBankDeltasTo`.
Add `collectGuildBankDeltas(...)` beside `collectGuildBankSaves`, keeping the null-serialize skip
rule identical (a guild whose live book is absent is skipped, so an oversized or malformed row is
still never overwritten).
Tests: unit tests in the file that already covers `collectGuildBankSaves`
(`tests/guild_bank_persistence.test.ts:741`), including the absent-row base case and the skip rule.

**P1.3 Transactional read-modify-write.** `server/db.ts`.
`GuildBankSave` becomes `{ guildId, deltas }`. `writeGuildBankRow` becomes
`SELECT data FROM guild_banks WHERE guild_id = $1 FOR UPDATE`, then `mergeGuildBankRow`, then the
existing upsert. Sort the carried guilds by ascending id in both
`saveCharacterAndGuildBankState` and `saveCharacterAndMarketState`. No schema change.
Tests: `tests/server/` coverage that the SELECT is issued on the same client, after the fenced
character UPDATE, and that a fence miss rolls back without locking a book row.

**P1.4 Save path.** `server/game.ts`, `saveCharacter`.
`collectBooks` becomes `collectDeltas`: for each dirty guild take the current log and record its
length in the existing `carriedGuildBankOpCounts`. The post-commit release loop (dirty-mark clear
on unchanged seq, prefix splice of the committed count) is already correct for this and does not
change. Delete the now-stale "Scope of the guarantee" comment block and replace it with the new
invariant.

**P1.5 Reconcile collapse.** `server/game.ts`.
`reconcileUnflushableGuildBooks` becomes a synchronous `revertOwnGuildBookOps(dead, guildIds)`:
unconditional surgical revert, no cross-session scan, no evict, no reload, no retries. Update both
call sites (the `saved === false` fence branch around 3745, and the exhausted-leave-flush branch
around 3557). Delete `ClientSession.revertLostGuildBanks` and every reference
(declaration around 843, clears at 2140 and 4018, the set at 4112).

**P1.6 Cap disposal.** `server/game.ts`, `runGuildBankOp`.
Replace the drop-and-flag with `compactGuildBankOpLog(log)`: net gold into one delta, item deltas
merged per three-dimensional identity key, slot ops kept as raise-to-N. Keep
`GUILD_BANK_UNFLUSHED_OP_CAP = 500` as the trigger. Put the compactor in its own module
(`server/guild_bank_op_log.ts`) so it is Node-testable without the server.

**P1.7 The capture/commit-skew regression test.** New case in
`tests/guild_bank_persistence.test.ts`.
Port the section 1.4 experiment: two officers, B's save fenced out, A's save gated between capture
and commit, B's reconcile driven inside A's window. Assert the durable book equals the live book
afterwards and that total durable copper is unchanged. This is the test that would have caught
finding 3, and it must fail on the pre-fix code.

**P1.8 Retire the 697 pin.** `tests/guild_bank_persistence.test.ts:697`, per section 6: keep the
`=== 500` literal, replace the reload assertion with the compaction-equivalence test and the
B-survives test.

### Phase 2: the adjacent defects the acceptance criteria require

Each is independently shippable and each should be its own commit; D2 may warrant its own PR.

**P2.1 (D4) `craftedRecipeId` in the instanced arm.** `src/sim/bank.ts`, `moveBetweenContainers`:
thread `slot.craftedRecipeId` into `countFit` and `addStacked` on the instanced arm exactly as the
plain arm does. Fixes `tests/audit_cap_probe.test.ts` 63, 78, 93, 108, 348 and
`tests/audit_cap_provenance.test.ts` 88, 103, 132. Affects the personal bank too, so it needs a
personal-bank regression test as well as the guild one.

**P2.2 (D3) Revert arithmetic.** `src/sim/guild_bank.ts`: make the `buy_slots` treasury refund
conditional on the slot undo actually applying (fixes `tests/audit_cur_conservation.test.ts:542`).
The `open_bank` order asymmetry (`tests/audit_cap_probe.test.ts:157`) is largely dissolved by the
raise-to-N record from P1.1; verify and finish it there.

**P2.3 (D2) Disband / gquit TOCTOU.** `server/game.ts`, the `socialTransport()` pair: re-read the
`guildBankHoldings` guard AFTER the awaited DB steps and immediately before the DELETE, and make
`onGuildDisbanded` flush the escrowed value back rather than wipe marks and logs. Fixes
`tests/audit_conc_guild_bank.test.ts` 449 and 498. This is the least-scoped item here and should be
sized separately.

### Phase 3: auditability (partial D5), follow-up

**P3.1** Emit a `bank_ledger` anomaly row when the forward apply clamps, and teach
`scripts/bank_audit.mjs` to report it. Re-point `tests/audit_cur_conservation.test.ts` 245 and 286
(245's premise is removed by P1 and its assertion becomes vacuous; 286's residue persists and
should become a finding the auditor reports).

### Deferred, recorded only

- Take the autosave arm off the market serial writer (section 3.6), retiring the documented
  concurrency-collapse risk.
- Strong Direction B: refuse rather than clamp on forward apply (section 5).

### Doc debt

`docs/guild-bank/state.md` "Accepted risks and operational assumptions" (around line 489) claims
the cross-officer escrow skew's reliably-attacker-timable arms are CLOSED by
`reconcileUnflushableGuildBooks` and that only a crash-windowed residue remains. Section 1.2 and
section 1.4 disprove that. Update it in the same change: the skew is removed at the root, the
crash-windowed arm is removed with it, and the consume-then-fence residue (D5) is the ONE thing
that stays accepted, restated to cover both its flavours (the doc's current residue sentence covers
only the consumed-value flavour, not the rung-0 ladder flavour that
`tests/audit_conservation_property.test.ts:1159` pins).

---

## 8. Acceptance criteria

1. The property harness `tests/audit_conservation_property.test.ts` is GREEN with its
   characterization pins flipped:
   - P4-GAP (line 1194, `deposit_gold(B) | buy(A) | autosave(A) | fence(B)`, and its item-shaped
     repeat) flips from `expect(r.ok).toBe(false)` to `expect(r.ok).toBe(true)` with the
     `toContain('COPPER MINTED')` and durable-evidence lines deleted. Its negative control at line
     1225 becomes redundant and folds into it.
   - The structural generator restrictions that exist ONLY to steer the sweeps away from the
     shared-book window are LIFTED, which is the strongest statement of the fix: `eventActor`
     (declared 241, used 1078, 1090, 1105, 1258) and `opActors: [0]` (used 1077, 1089, 1257) are
     removed, so the random sweeps run both officers acting AND both officers saving.
   - Pins that must STAY, because they encode residues outside this fix's scope: P4-RESIDUE
     (1136, 1159), P5 (1263), the ledger-caveat pin (1117) with its
     `durable-after-quiesce-no-ledger` check variant, and `opKindsByActor` (1107). Their continued
     presence is part of the acceptance criteria, not a shortfall: they mark D5, which section 5
     says is deliberately not closed here.
   - The coverage floor (1320 to 1345) must still pass, with the `fence:evict-and-reload` and
     `exhausted-leave:evict-and-reload` counters REMOVED rather than satisfied, since those arms no
     longer exist.
2. `tests/audit_conc_guild_bank.test.ts` passes: 192, 247, 286, 348, 403 from Phase 1; 449 and 498
   from P2.3.
3. `tests/audit_cur_conservation.test.ts` passes: 194 and 469 from Phase 1; 542 from P2.2; 245 and
   286 from P3.1 (or are formally re-pinned as D5 characterizations if Phase 3 is split out, which
   must then be stated in the PR, not left silent).
4. `tests/audit_cap_probe.test.ts` and `tests/audit_cap_provenance.test.ts` pass, from P2.1 and
   P2.2.
5. `tests/guild_bank_persistence.test.ts` passes with the 697 pin retired per section 6 and the new
   capture/commit-skew regression (P1.7) added, verified to FAIL on the pre-fix code.
6. `npm run gate` green.

Note on criterion 2 to 4: as section 1.5 sets out, "the four failing repros pass" spans four
distinct defects. Phase 1 alone satisfies roughly half the failing cases. If the escrow fix is to
ship on its own, criteria 2 to 4 must be renegotiated down to the D1 cases and the rest tracked as
their own issues, rather than the PR quietly claiming the whole set.
