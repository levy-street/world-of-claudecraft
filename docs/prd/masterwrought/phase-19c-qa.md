# Phase 19C QA (server, persistence and stability: the third execution wave of the rulings gate)

VERDICT: _recorded at the close of this document, after the pg-armed gate._

Scope: the seven units of `phase-19c-server.md` (D023 D064 D122 D136 D145 D147
D162), their fresh domain reviews, the reviewer fix round, and the fresh read of
that round. Commit span `a01b8df78b..HEAD`.

## Why this wave was different, and how it went

19A and 19B were comment-and-ledger waves. 19C was not: it carried the heaviest
production changes in the packet. Two write-ordering fixes on the hottest save
path (D136's nonce expiry term, D145's row lock, D145 depending on D136), and one
cluster (D147) that turns on a new database write per market sale. The one method
rule the phase turned on held: a fence test against a mocked db cannot see
statement-level evaluation order, so every write-ordering claim owes a REAL
Postgres proof that reds without the fix and passes with it. Each is listed by
unit below.

## What the wave delivered

Seven units, ONE commit each, ZERO escalations. Three are docs-only (D023, D064,
D162); four land executable code (D122, D136, D145, D147). Every ruling was
written where its open record actually stands (the farming handoff table, the
state.md deviation blocks, the code comment that carries the policy) rather than
in the decision table, following the qr-19 pattern. Full unit-by-unit detail is
in state.md "Phase 19C ledger"; this document is the QA record.

## The wave's own instructions were wrong in eleven places

The phase document was verified against the tree before any byte moved, and every
correction is amended IN PLACE and dated in phase-19c-server.md. **11 corrections**,
the same defect families 19A (16) and 19B (51) hit, measured not recalled:

- **Three handoff/gate-row anchors were transcribed with their markdown pipes
  flattened to spaces**, so `grep -cF` returned 0: D023's `(bb)` row, D147's gate
  row, D162's epoch row. This is 19A's and 19B's exact defect arriving a THIRD
  time in the next wave's document.
- **Three stale line addresses**: D023's handoff row (475 -> 536), D023's
  reads-owed enum (412 -> 413), D136's anchor (20780 -> 21410).
- **A line-wrapped enum quote** (D023's reads-owed clause greps 0; the file
  hard-wraps it).
- **An arithmetically wrong derivation**: D122's example "163,840 ... the next
  power-of-two step above the measured band" is not a power of two (2^17 =
  131,072, 2^18 = 262,144, nothing between). Adopted as 160 KiB, the 32-KiB step
  above the measured worst case, under a corrected stated derivation.
- **A stale measured band**: D122 cited "measured 151,525, band 151,145..151,526";
  the live QA-frozen figure is 151,584, band 151,204..151,584.
- **A falsified monolith premise**: D147 said "none of these files carries a
  [monolith] row". server/db.ts (5123) and server/game.ts (10350) are BOTH on the
  ratchet at zero slack, so the wiring had to be paid by extraction.
- **An incomplete D145 file list**: it named `save_offline_character_state.test.ts`
  but omitted `tests/character_lease.test.ts`, `tests/guild_bank_db.test.ts`, and
  `tests/server/bank_ledger_save_effects_db.test.ts`, the save-path statement
  tests the added row lock breaks. See the self-inflicted section: this is the one
  the per-unit affected suites did NOT catch.

## The write-ordering proofs, unit by unit (the one method rule)

A mocked db cannot observe Postgres's statement-level evaluation order, so each
claim was proven against the real dev Postgres, red without the fix:

- **D136 (nonce expiry term).** `tests/character_save_statement_pg_integration.test.ts`
  gains an expired-own-lease arm: grant a lease already lapsed (secondsFromNow
  negative), and the save is refused (false, marker unchanged). REDS without the
  `AND expires_at > now()` term (the save lands over the strip). The unit test's
  existing `toContain` were a trap that stay green over an appended term, so a
  POSITIVE assertion was added.
- **D145 (row lock).** The same pg suite gains a displacement-race arm: a
  contender holds the characters row `FOR NO KEY UPDATE`, session A's fenced save
  parks, a takeover rotates the nonce mid-wait, the contender releases, and A's
  write must NOT land. REDS without the row lock (A's write lands over the new
  session). A no-takeover control still lands. A unit lock-order pin over the
  mocked statement list covers all FOUR live save paths (lockIdx < updateIdx), and
  a no-nonce save is pinned to SKIP the lock. All red-proven; the displacement arm
  was re-proven under the shipped FOR NO KEY UPDATE form.
- **D147 (the new per-sale write).** The sold-volume pg suite gains an
  observer-end-to-end arm (buyWithSoldVolume through a bounded real-Postgres
  writer, the row read back) and an ensureSchema-boot arm (the real boot ladder
  creates the table and accepts a row). A real-Sim arm drives Sim.marketBuy
  through buyWithSoldVolume so the length-drop coupling to src/sim/market.ts is
  guarded behaviorally.

## Reviews

Six distinct domain reviewers were dispatched FRESH, never the implementer:
privacy-security-review, migration-safety, database-performance-reviewer,
server-hot-path-reviewer, cross-platform-sync, and test-coverage-auditor. NO
blocking findings. Every should-fix and nit was applied. Four of them
independently raised the same finding, which is the wave's real story.

## The self-inflicted defects, recorded because the guards were green through them

This is the honest account, and the phase prompt is right that it is the finding,
not an embarrassment.

1. **D145's row lock shipped UNCONDITIONAL and FOR UPDATE, and the per-unit
   affected suites were green through both.**
   - (a) An UNCONDITIONAL lock added a round trip to every save, which broke the
     "four database round trips" budget for an ordinary (unfenced) save, the
     guild-bank lock-order assertion, and the character-lease "no separate SELECT"
     assertion, in three test files the phase document's D145 file list never
     named. The per-unit suites D145 did run were green; a broad post-commit sweep
     across every save-path test caught the three reds. The lock was scoped to
     FENCED saves (a `none` fence has no race), and that behavior is now pinned.
   - (b) FOR UPDATE was too strong. It conflicts with the FOR KEY SHARE every
     FK-child insert of the character takes (chat_logs, character_deeds,
     play_sessions), opening a contention and deadlock edge on the
     ~33-saves-a-second path, and it bought nothing for the case D145 exists for:
     a same-account takeover rotates the nonce through an `ON CONFLICT DO UPDATE`
     that re-checks no FK and takes no parent lock, so FOR UPDATE never excluded
     it. Four reviewers converged on this. The live lock is now FOR NO KEY UPDATE:
     the fix is the statement ORDERING (the offline arm's own note recorded the
     repro green under FOR NO KEY UPDATE), the weaker mode drops the FK-child
     contention, and it restores the character-delete verify probe's FOR KEY SHARE
     premise. The offline writer keeps FOR UPDATE by its own rationale.
2. **Turning D147 on exposed observability and shutdown gaps in the
   Phase-18-built store.** The sold-volume write FIFO's drop counter had no
   /metrics caller and no shutdown drain: a live per-sale write path was
   unobservable, and a deploy dropped queued entries. Both were wired in the
   review round; the shutdown drain was then BOUNDED at the fresh read's finding
   so a wedged database cannot hold it past the lease sweep.

Every one of the above passed a green per-unit guard, a fresh reviewer, or both.
The lesson 19B stated sharply held again: a comment-and-ledger wave is not the
only place prose and pins go wrong, and a fix round is unreviewed code. The
mechanical lesson unique to 19C: a phase document's file list is itself an
unverified claim, and executing only the files it names left three tests red that
a broad sweep, not the per-unit suites, had to find.

## The fresh read (criterion 3), and what it found

A FRESH reader over the fix round (commits 0e7ffa296d and e9bfce79ee) found NO
blocking issues, six should-fix and five nits, all applied in fa9499ec88:

- (E) three planning docs still said FOR UPDATE (state.md, merge-deletion-list.md,
  phase-19c-server.md); corrected, with the deliberate divergence from the offline
  arm stated.
- (D) the none-fence-skips-the-lock behavior (0e7ffa296d) was UNPINNED; pinned and
  mutation-proved against a lock-always mutant.
- (D) the sold-volume shutdown drain was UNBOUNDED ahead of the lease sweep;
  bounded at MARKET_SOLD_VOLUME_SHUTDOWN_DRAIN_MS.
- (C) the B1 comment said the heartbeat "commits first" by sequencing; the flush
  launches saves first, and the single-statement heartbeat wins by round-trip
  count. Reworded.
- (C/D) runFencedCharacterUpdate's JSDoc offered the unleased shape under the
  weaker mode; scoped to nonce-only (the offline unleased writer keeps FOR UPDATE
  and must not route through it).
- four stale comments refreshed (the "all-four-absent" test header, a stale
  FOR-UPDATE test comment, the tail "never rejects" comment, an outer-catch
  no-op cleanup claim); the ~33/s note gained its "at 1,000 online" qualifier.

Its C/D/E verification confirmed the FOR NO KEY UPDATE reasoning TRUE against the
Postgres row-lock matrix and the live pg arm, the metric help strings matching
`collect()`, and the lock-order arms decisive over all four paths.

## Validation

_Filled at the close, below the verdict._

## CARRIED for the maintainer, not taken unilaterally

- **B1: qualifying `heartbeatCharacterLeases`.** With the D136 term added,
  unqualified (the shipped state) a recovered process re-arms a lapsed lease and
  the term only narrows the window; qualified, one stall past the 90 s TTL makes
  every session that process holds permanently unsaveable and kicks them all. A
  larger blast than the hole closed, so the heartbeat stays unqualified pending
  the maintainer's call.
- **D122's warn value.** 163,840 is a STATED DERIVATION (the 32-KiB step above
  the measured worst case), not a maintainer-named number; the shipped code and
  the whole-character arm both say the value is the maintainer's, so the digits
  may be retuned. The direction (above the worst case) is what the ruling fixes.

## JUDGED, and not re-raised

- The seven units, their rulings, and every reviewer and fresh-read finding are
  SETTLED. This document records them; it does not reopen them.
- The FOUR items 19B carried for the maintainer are UI-domain and out of 19C's
  scope; they remain the maintainer's and were not taken here.
