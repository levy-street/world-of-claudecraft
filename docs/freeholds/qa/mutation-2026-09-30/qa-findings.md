# 07a QA findings and dispositions (2026-10-01)

Every finding of the paired QA of 07a (`docs/freeholds/phase-07a-qa.md`) over the built code
(`0008427d14..11316ac3cd`), and what became of it. The narrative record is the 07a QA
section of [../persistence-2026-09-08/findings.md](../persistence-2026-09-08/findings.md);
the design of record is [../../mutation-touch-set-manifest.md](../../mutation-touch-set-manifest.md)
(revision 6, sections 12 and 16).

Dispositions: FIXED (with the commit), COVERED (an existing pin already proves it, named),
RULED (kept as it is, with the reason), RESIDUAL (a named residual in the manifest's section
12), OWED (carried for a later change or a maintainer decision, named) and FLAGGED (a
decision that is the maintainer's).

The commits, in order: round one's fixes `c77fd01be4` (the boundary's code), `4d679ebf89`
(the ratchet), `76d9300096` (unit pins), `0e95cf2b3f` (real-PostgreSQL arms), `1fe5727d00`
(exports), `02d78aae8c` (leaf lists), `69a383e9b5` (metric help and the login comment),
`a2a969d13b` (evidence and docs); round two's fixes `fddc60bf6c` (the lost-claim re-read),
`7ba009dbdd` (trip, renewer stop, busy count), `c0ba5b5dcd` (owned operations, exports,
probe), `5060ad0491` (pins), `2bd8e76cf9` (instruction files), `9c15aa3ea1` (boot deadlock
and operator docs), and the commit that adds this file.

## Round one: twelve readers over the built code

STEP 1 coverage matrix:

| Id | Disposition |
|---|---|
| E1 | FIXED `0e95cf2b3f`: the client destroyed after COMMIT is sent, landed and not landed |
| E2 | RULED: P11 has no HTTP surface; the typed refusal is driven in real PG (`0e95cf2b3f`) |
| E3 | FIXED `76d9300096`: the advisory class census |
| E4 | FIXED `a2a969d13b`: a full pool is `read_threw` under the one login budget (manifest P4) |
| E5 | FIXED `c77fd01be4`: the bounds assigned from their source constants |
| E6 | FIXED `c77fd01be4`: `mintFreeholdOperationId` removed, the message constant interpolated |
| E7 | FIXED `76d9300096` (the composed wanted predicate) and `0e95cf2b3f` (the realm's 90 s TTL) |
| E8 | FIXED `0e95cf2b3f`: the storage start's refusal arm |
| E9 | FIXED `0e95cf2b3f`, `5060ad0491`: every statement plan-pinned |
| E10 | FIXED `a2a969d13b`, `9c15aa3ea1`: contention, P9 and boot measured |
| E11 | FIXED `76d9300096`: the metric names as literals |
| E12 | COVERED: `tests/freehold_key_persistence.test.ts` proves the account clock never enters a character or plot snapshot, so no rollback of either can carry it |

Privacy and security: S1 FIXED `c77fd01be4` (and the pg arm `0e95cf2b3f`). S2 RULED: R-6 is
accepted; its cure was tried and reverted. S3 FIXED `c77fd01be4`. S4 FIXED `c77fd01be4`
(the deliberate omissions written in the trip host). S5 FIXED `76d9300096`, `c0ba5b5dcd`.
S6 COVERED: the manifest's section 9 has stated the copy-ref contract (an opaque item-copy
identity, never an account or character id) since its first revision, and the intents
export's columns are pinned (`76d9300096`).

Server hot path: HP1 FIXED `c77fd01be4` (rule stated in `2bd8e76cf9`; widening `saves` is
FLAGGED, see L4). HP2 FIXED `c77fd01be4`, `7ba009dbdd`. HP3 FIXED `a2a969d13b`. HP4 RULED: each
of the three reads per scrape is O(1), recorded in manifest section 16. HP5 OWED: the receipts
gauge's rate budget is 08's and 15's, per the manifest.

Database performance: DB1 FIXED `0e95cf2b3f`, `5060ad0491`. DB2 FIXED `a2a969d13b`,
`9c15aa3ea1`. DB3 FIXED `c77fd01be4`. DB4 FIXED `a2a969d13b`, `9c15aa3ea1`. DB5 FIXED
`c77fd01be4`, `7ba009dbdd`. DB6 FIXED `c77fd01be4` (stated at the wiring), `9c15aa3ea1`
(cited), `5060ad0491` (literals). DB7 FIXED `c77fd01be4`. DB8 FIXED `c77fd01be4`,
`c0ba5b5dcd`. DB9 FIXED `a2a969d13b`. DB10 FIXED `0e95cf2b3f`. DB11 FIXED `c77fd01be4`.

Migration safety: M1 FIXED `a2a969d13b`. M2 FIXED `a2a969d13b`, widened in `9c15aa3ea1`
(RESIDUAL R-11). M3 FIXED `a2a969d13b`, `9c15aa3ea1`. M4 FIXED `c77fd01be4`, proved in
`0e95cf2b3f`. M5 FIXED `c77fd01be4`, proved in `0e95cf2b3f`. M6 FIXED `c77fd01be4`. M7 FIXED
`0e95cf2b3f`, `5060ad0491`.

Cross-platform: X1 RULED (R-6). X2 FIXED `c77fd01be4`. X3 FIXED `c77fd01be4`. X4 RULED: a
pending use gives no feedback by contract. X5 RULED: a second character hears `busy` by
design.

Test-coverage auditor: TA1, TA3, TA4, TA5, TA8, TA9 FIXED `76d9300096`. TA2 FIXED
`76d9300096`, `0e95cf2b3f`. TA6 FIXED `0e95cf2b3f`. TA7 FIXED `0e95cf2b3f`, `5060ad0491`.

Architecture: A1, A2, A3, A6, A7, A8, A9 FIXED `c77fd01be4`. A4 OWED: a golden for the pending
and deny arms (a unit pin proves zero draws). A5 FIXED `a2a969d13b`.

QA checklist: Q1 FIXED `a2a969d13b` (AS BUILT notes). Q2, Q3, Q4, Q8, Q9, Q10, Q12, Q13, Q15
FIXED `c77fd01be4`. Q5 FIXED `a2a969d13b` (the deviation recorded). Q6 RESIDUAL R-10. Q7 FIXED
`c77fd01be4`, `a2a969d13b`. Q11 FIXED `76d9300096` (the measured cost). Q14 FIXED `a2a969d13b`.
Q16 FIXED in this file's commit: the "no production kind" scope is the packet's, not a Step
0 ruling. The docs librarian was dispatched in round two.

Test coverage reader: T1 FIXED `76d9300096`, `5060ad0491`. T2 FIXED `76d9300096`,
`c0ba5b5dcd`. T3, T5, T6, T7, T10, T11, T12, T13, T15, T19, T21 FIXED `0e95cf2b3f` (T6 and T11
tightened in `5060ad0491`). T4 FIXED `a2a969d13b`. T8, T9, T16, T17, T18 FIXED `76d9300096`. T14
RULED: informational. T20 FIXED `0e95cf2b3f`: the probe's limit stated at the case.

Correctness: C1 to C7 and C9 to C13, C15 and C16 FIXED `c77fd01be4`. C8 FIXED `c77fd01be4`
(the comment) and `9c15aa3ea1` (the operator query). C14 FIXED in this file's commit: the
grace counts from the acquire, and a later join is the R-3 class.

Hygiene: H1 FIXED `02d78aae8c`. H2, H3, H4, H7, H8, H9, H10 FIXED `c77fd01be4`. H5, H6, H11,
H14, H16 FIXED `a2a969d13b`. H12 FIXED `76d9300096`. H13 FIXED `1fe5727d00`. H15 RULED: none
required.

Docs librarian: L1, L2, L5 to L12 FIXED `02d78aae8c`. L3 FIXED `c77fd01be4`. L4 FIXED
`02d78aae8c`, `2bd8e76cf9`, and FLAGGED: widening the `saves` bucket to the two Freeholds
flush launches is the maintainer's ruling to confirm. L13 FLAGGED: whether THE LIGHTING
RULING still lists remote-key authority as unsigned. L14 FIXED `2bd8e76cf9` (the row points
at the directory's own roster). L15 FIXED in part `c0ba5b5dcd` (the operator help strings
and the listed comments); the remaining delivery labels in comments are FLAGGED for the next
librarian sweep.

## Round two: eight fresh readers over the fix round (`dca9711ab6..a2a969d13b`)

| Reader | Verdict | Findings |
|---|---|---|
| database performance | PASS | DBR1 to DBR8 |
| migration safety | PASS | MSR1 to MSR9 |
| server hot path | PASS | HPR1 to HPR7 |
| test coverage | FAIL (one blocking pin) | TCR1 to TCR17 |
| privacy and security | PASS | SR1 to SR8 |
| docs librarian | PASS | LR1 to LR13 |
| correctness | PASS | CR1 to CR9 |
| qa-checklist | PASS | QR1 to QR14 |

- DBR1 FIXED `9c15aa3ea1` (the G1 boot bench, R-11). DBR2 FIXED `9c15aa3ea1`, `5060ad0491`.
  DBR3 FIXED `9c15aa3ea1`. DBR4 RULED: one lock-or-statement counter by design, stated in the
  metric's help and pinned by the timeout classifier's positive and negative codes. DBR5,
  DBR6 FIXED `5060ad0491`. DBR7 FIXED `9c15aa3ea1`. DBR8 RESIDUAL R-12 (`9c15aa3ea1`).
- MSR1, MSR2 FIXED `9c15aa3ea1` (R-11; the boot's lock order is OWED to the maintainer).
  MSR3 FIXED `c0ba5b5dcd` (the divergence named) and OWED: the storage fragment still names
  `pg_catalog` second. MSR4, MSR7 FIXED `5060ad0491`. MSR5, MSR8 FIXED `c0ba5b5dcd`. MSR6,
  MSR9 FIXED `9c15aa3ea1`.
- HPR1, HPR6 FIXED `2bd8e76cf9`. HPR2, HPR7 FIXED `9c15aa3ea1`. HPR3, HPR5 FIXED
  `7ba009dbdd`. HPR4 RULED (see HP4).
- TCR1 (the blocking one) FIXED `c0ba5b5dcd` (a behavioral case) and `5060ad0491` (the pin);
  a mutant that drops the `finally` fails both. TCR2 FIXED `fddc60bf6c`. TCR3, TCR6 FIXED
  `7ba009dbdd`. TCR4, TCR5, TCR7, TCR10 to TCR14 FIXED `5060ad0491`. TCR8, TCR9, TCR16,
  TCR17 FIXED `c0ba5b5dcd`. TCR15 RULED: the stated cost is a one-worker measurement that
  includes the suite's database setup, re-measured on the final tip.
- SR1 FIXED `9c15aa3ea1` (the query is the detector, and when a repair takes effect) and
  `c0ba5b5dcd` (the docblock); a login-time clamp is OWED to the maintainer, because the
  realm's clock against a value the database wrote needs a skew margin no constant names
  today. SR2 FIXED `9c15aa3ea1`. SR3 FIXED `c0ba5b5dcd`, `9c15aa3ea1`. SR4, SR8 FIXED
  `c0ba5b5dcd`. SR5, SR6 FIXED `7ba009dbdd`. SR7 RULED: the storage refusal's message is
  pinned unchanged on purpose (`tests/federated_auth_db.test.ts`), so its id-free typed
  class is OWED to the storage path, outside 07a.
- LR1 FIXED by this file and the ledger section (written in `ffbe38eb94`, see L3R1). LR2, LR3, LR4 FIXED `9c15aa3ea1`. LR5, LR6,
  LR8, LR10, LR12, LR13 FIXED `2bd8e76cf9`. LR7 and LR11 FLAGGED (L13; the decision labels).
  LR9 FIXED in part `c0ba5b5dcd`, the rest FLAGGED (L15).
- QR1 FIXED by this file. QR2 FIXED `2bd8e76cf9` (L4 FLAGGED). QR3 FIXED `fddc60bf6c`. QR4
  FIXED: the one commit body that used the banned word was reworded before any push. QR5,
  QR14 FIXED `9c15aa3ea1`. QR6 COVERED (see E12). QR7 FIXED `0e95cf2b3f` (T19, T21). QR8
  FIXED `fddc60bf6c`. QR9 FIXED `c0ba5b5dcd`. QR10, QR11, QR12 FIXED `7ba009dbdd`. QR13 RULED
  (see HP4).
- CR1, CR3, CR4 FIXED `fddc60bf6c`. CR2 RULED, no change: the corrupt test already reads
  `clock_timestamp()` after the row-lock wait, pinned by "judges corrupt on the clock AFTER
  the lock wait" in `tests/server/freehold_hearth_db.pg.test.ts`. CR5 to CR9 FIXED
  `7ba009dbdd`.

## Round three: eight fresh readers over round two (`a2a969d13b..54ac963ce0`)

Round three's commits: `85d6b83d76` (the in-flight re-read), `5652fe5b6f` (trip identity, the
live binding, the stop's checkout cut), `4ca51f5114` (the token probe warning), `95eadbea2f`
(pins), `46d12cca49` (the `saves` rule), `ffbe38eb94` (boot deadlock docs and the ledger),
`87169095d0` (the pins on that DEPLOY text), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | FAIL (one blocking) | C3R1 to C3R5 |
| qa-checklist | PASS | Q3R1 to Q3R7 |
| server hot path | PASS | H3R1 to H3R6 |
| privacy and security | PASS | S3R1 to S3R6 |
| database performance | FAIL (doc readings) | D3R1 to D3R6 |
| test coverage | FAIL (one blocking pin) | T3R1 to T3R10 |
| docs librarian | FAIL (one blocking pointer) | L3R1 to L3R13 |
| migration safety | PASS | M3R1 to M3R8 |

- C3R1 (blocking) FIXED `85d6b83d76`: a second preload during a lost-claim re-read joins it; a
  mutant restoring the round-two predicate fails the new case. C3R2 FIXED `85d6b83d76`. C3R3,
  C3R4 FIXED `5652fe5b6f`. C3R5 FIXED `5652fe5b6f` (the wording; the stop's accounting was
  already right: a stopped chunk counts as abandoned).
- Q3R1, Q3R2, Q3R3, Q3R4, Q3R5 FIXED `5652fe5b6f`. Q3R6 FIXED `95eadbea2f` (the contract
  suite restated; `tests/server/freehold_mutation.test.ts` measured within its stated 0.8 s).
  Q3R7 COVERED: `tests/server/freehold_hearth_db.test.ts` "the operator's corrupt-row repair"
  pins the literal to `HEARTH_KEY_COOLDOWN_MS` since `c0ba5b5dcd`.
- H3R1 RESIDUAL R-13 (`ffbe38eb94`; the stop docblock in `5652fe5b6f`). H3R2 FIXED
  `ffbe38eb94` (the whole serial chain, 42 s of bounded drains). H3R3, H3R4 FIXED `5652fe5b6f`.
  H3R5 FIXED `46d12cca49`. H3R6 FIXED `ffbe38eb94` (the cold first launch measured, 4.5 to
  4.7 ms).
- S3R1 FIXED `4ca51f5114` (the close comment) and `ffbe38eb94` (the rule at P7). S3R2 FIXED
  `ffbe38eb94`. S3R3 FIXED `5652fe5b6f` (see Q3R2). S3R4 FIXED `5652fe5b6f`. S3R5 FIXED
  `4ca51f5114`. S3R6 FIXED `4ca51f5114`.
- D3R1 FIXED `ffbe38eb94`: the rollout G1 run relabeled as ten consecutive first-rollout
  attempts, and true steady-state boots measured (schema committed and checked first) under
  plain, G2 and G1 saves. D3R2 FIXED `ffbe38eb94`: the G2 run (no `accounts` lock) aborted 2 of
  6 boots, one at once, so the docs name both paths and both halves of the owed fix. D3R3 FIXED
  `ffbe38eb94` (R-12 restated). D3R4 FIXED `95eadbea2f`. D3R5 FIXED `4ca51f5114` (the
  whitespace is the hoist's; the statement is the same). D3R6 FIXED (see S3R1).
- T3R1 (blocking) FIXED `5652fe5b6f`: the loud arm counts its applies; a mutant dropping the
  inner guard runs the apply twice and fails it. T3R2 FIXED `5652fe5b6f`. T3R3 FIXED
  `85d6b83d76` (a failed ROLLBACK is shown to keep both counts; the transaction wrapper's
  rollback never replaces the error). T3R4 FIXED `85d6b83d76`. T3R5 FIXED `85d6b83d76`. T3R6,
  T3R9 FIXED `95eadbea2f`. T3R7 FIXED `5652fe5b6f`. T3R8 FIXED `95eadbea2f`. T3R10 FIXED
  `85d6b83d76`.
- L3R1 (blocking) FIXED `ffbe38eb94`: the ledger's 07a QA section now exists. L3R2 to L3R4,
  L3R6 to L3R11 FIXED `ffbe38eb94`. L3R5, L3R12, L3R13 FIXED `46d12cca49`.
- M3R1, M3R2 FIXED `ffbe38eb94`, pinned in `87169095d0` (a read-only detector first and no
  repair during a clock step; both sides of the deadlock and its save-side cost). M3R3 FIXED
  `ffbe38eb94`. M3R4 FIXED `4ca51f5114` (the comment claims only the repair branch). M3R5
  FIXED `ffbe38eb94`. M3R6 FIXED `95eadbea2f`. M3R7 FIXED `4ca51f5114`. M3R8 FIXED
  `ffbe38eb94`.

## Round four: eight fresh readers over round three (`54ac963ce0..a299a3bc58`)

Round four's commits: `226841c7cc` (the in-flight join without the claim), `a655364f13` (the
token CHECK warning on any other definition), `b197b681b0` (one release cut per pass, the
launch warning once), `5b2d557380` (the stop and trip pins), `ce11607af0` (the boot, shutdown
and residual records), and the commit that adds this section. Q4R1 was fixed by rewriting
the unpushed range before them (below), so every round-three hash from `4ca51f5114` on is
the rewrite's.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C4R1 to C4R4 |
| qa-checklist | PASS | Q4R1 to Q4R4 |
| server hot path | PASS | H4R1, H4R2 |
| privacy and security | PASS | S4R1 to S4R5 |
| database performance | FAIL (doc readings) | D4R1 to D4R4 |
| test coverage | PASS | T4R1 to T4R10 |
| docs librarian | FAIL (one blocking) | L4R1 to L4R5 |
| migration safety | PASS | M4R1 to M4R8 |

42 findings: one blocking (L4R1, the same defect as H4R1), 12 should-fix, 29 nice-to-have.

- C4R1 FIXED `226841c7cc`: a read in flight is its own fact and joins without asking the
  claim; a mutant dropping it fails the clause table and the join case, whose claim now
  reads held while the read is parked. C4R2 FIXED `b197b681b0`. C4R3 FIXED `a655364f13` (with
  S4R4 and M4R4: the probe compares the whole deparsed definition, so a CHECK with another
  body warns too). C4R4 FIXED `b197b681b0` (with H4R2 and Q4R3: once per registry).
- H4R1 FIXED `ce11607af0` (with L4R1): the shutdown budget adds the concurrent Steam and Epic
  mirror stop, 47 s of bounded drains, and names in `persistence-rollout-contract.md` the
  drains that take no deadline at their call sites; this corrects H3R2's 42 s, which stands
  above as round three wrote it.
- Q4R1 FIXED by rewriting the unpushed range: the two DEPLOY pins left the token-probe commit
  for their own commit, `87169095d0`, right after the DEPLOY text they read (`ffbe38eb94`), so
  no commit is red on that case; the tree at the tip was unchanged. Q4R2 FIXED in this record
  (the ledger lists every tip's pg total). Q4R4 FIXED `ce11607af0` (the counts dropped from
  the `saves` rule).
- S4R1 FIXED `ce11607af0` (a repair reaches a relog only once the realm dropped the entry).
  S4R2 FIXED `ce11607af0` (with M4R3: the clock check named, a step either way, the free trip
  after a backward step past one cooldown). S4R3 FIXED `ce11607af0` (P7 and the close comment
  state the duty for an id a client sends back). S4R5 FIXED `a655364f13` (the `search_path`,
  and the quiet-window reboot with M4R7).
- D4R1 FIXED `ce11607af0` (with L4R2): the account cycle takes `accounts` first in every
  shape, so G2 no longer counts as isolating the upgrade path; only the abort at once is
  attributed to it. D4R2 FIXED `ce11607af0`. D4R3 FIXED `ce11607af0` (R-12 counts gate
  permits: seven of the default ten). D4R4 FIXED `ce11607af0` (R-13 and the contract name the
  chunk's own wall and a COMMIT already sent).
- T4R1 FIXED `a655364f13`: the whole warning arm pinned, and healthy boots proved silent; a
  mutant dropping the arm's name filter fails them. T4R2 FIXED `b197b681b0`. T4R3 FIXED
  `5b2d557380`: dropping the cleanup and hoisting the class read out of the `try` each fail.
  T4R4, T4R5, T4R7 FIXED `226841c7cc`. T4R6 FIXED `5b2d557380`: a mutant dropping the stop's
  abort fails by assertion, not timeout. T4R8 FIXED `226841c7cc`: a mutant freezing the clock
  in the hold branch fails. T4R9 COVERED: the clause table drives each fact alone on the pure
  function, and the store's mapping is exercised by the leave-capture, quiesce, join and hold
  cases. T4R10 FIXED `5b2d557380`.
- L4R3, L4R4 FIXED `ce11607af0`. L4R5 FIXED `ce11607af0`: the launch bench re-ran three times
  on this tip with its output kept beside the boot outputs (cold first 4.7 to 4.9 ms, warm p99
  3.7 to 4.2 ms), and the figures follow it.
- M4R1, M4R2, M4R5 FIXED `ce11607af0`. M4R6 FIXED `a655364f13`: the pg case passes the real
  notice through the boot log's filter, a unit case covers the WARNING shape, and DEPLOY quotes
  the line, pinned to the RAISE text. M4R7 FIXED `a655364f13`. M4R8 RULED: only hand-built DDL
  reaches it (a same-named constraint with the column missing), probing the name first would
  make every fresh install's CHECK `NOT VALID`, and the comment's claim is scoped to the
  repair branch.

## Round five: eight fresh readers over round four (`a299a3bc58..b915d30173`)

Round five's commits: `cd03d3045f` (the in-flight join keyed on the preload's account),
`e872a45953` (the token probe's brief lock stated and pinned, with DEPLOY's token and
first-rollout bullets), `44ce2571bb` (the trip warn's character set), `e714944344` (the
shutdown budget's bounded waits and the other records), and the commit that adds this
section. The first qa-checklist reader stalled with no tool running and was replaced by a
fresh one with the same brief.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C5R1, C5R2 |
| qa-checklist | PASS | Q5R1 to Q5R4 |
| server hot path | PASS | H5R1 to H5R5 |
| privacy and security | PASS | S5R1 to S5R3 |
| database performance | PASS | D5R1 to D5R4 |
| test coverage | PASS | T5R1 to T5R5 |
| docs librarian | PASS | L5R1 to L5R5 |
| migration safety | PASS | M5R1 to M5R5 |

33 findings: none blocking, 7 should-fix (S5R1, C5R1, H5R1, L5R1, T5R1, D5R1, D5R2), 26
nice-to-have.

- C5R1 FIXED `e872a45953` (the fragment comment, DEPLOY, the pg case) and `e714944344` (P12,
  the contract): deparsing the CHECK opens the Hearth table under ACCESS SHARE (a
  probe on PostgreSQL 16.14 answered 55P03 behind an ACCESS EXCLUSIVE holder for a CHECK and
  at once for a UNIQUE; the database and migration readers had said it takes no lock). The
  fragment comment, DEPLOY, P12 and the contract now say a steady boot's one table lock is
  that brief ACCESS SHARE, held to no COMMIT, and a pg case proves both halves; a mutant
  restoring the type-only compare makes the boot stop waiting and fails it. C5R2 FIXED
  `cd03d3045f` (the read records the claim once its COMMIT is proved).
- Q5R1 FIXED `e872a45953` (with D5R1 and M5R4: DEPLOY quotes the whole CHECK the boot
  compares, pinned to the probe's literal, and says a correct CHECK a deparse change trips
  is not dropped but reported). Q5R2 FIXED `e714944344`. Q5R3 FIXED `e714944344`. Q5R4 FIXED
  in this record (the H4R1 disposition above names the contract).
- H5R1 FIXED `e714944344` (with L5R1): the enumeration of drains with no deadline drew one
  more missing step each round, so the budget now names the awaits that take a deadline and
  states that EVERY other await in the closure takes none, `pool.end()` included. H5R2
  RULED: the launch observer is shared with the market and rift writers' billing, so an
  observer that keeps throwing breaks theirs the same way and a Freeholds-only counter
  would not show the fault; the one warning says later throws are not logged. H5R3, H5R5
  FIXED `e714944344`. H5R4 FIXED `cd03d3045f` (one helper).
- S5R1 FIXED `e714944344` (the close comment states P7's sent-back and collapse duties).
  S5R2 FIXED `e872a45953` (the DROP runs under a lock timeout, retried on 55P03). S5R3 FIXED
  `cd03d3045f` as a defensive change, not a reachable defect: a loaded entry always carries
  its asker's account (round six, C6R1).
- D5R1 FIXED `e872a45953` (see Q5R1). D5R2 FIXED `e714944344` (with L5R4: the abort at once
  rests on its timing, a 10 ms `DELETE FROM accounts` sample in its round included). D5R3
  FIXED `e714944344` (R-13 and the contract name the socket close and the cancel, which runs
  on the canceller's own pool). D5R4 FIXED `e714944344` (the gate's floor of one).
- T5R1 FIXED `44ce2571bb`: a narrowed and a widened character set each fail their own arm.
  T5R2 FIXED `e872a45953` (the main schema stays silent beside the impostor). T5R3 FIXED
  `cd03d3045f`. T5R4, T5R5 FIXED `e872a45953`.
- L5R1 FIXED (see H5R1). L5R2 FIXED `e714944344` (with M5R3). L5R3 FIXED `e714944344` (the
  renewer stop comment in `server/main.ts`). L5R4 FIXED (see D5R2). L5R5 FIXED `e714944344`.
- M5R1, M5R2 FIXED `e872a45953` (the statements name `public.account_freehold_hearth`; a
  foreign-key impostor's DROP locks the referenced table too). M5R3 FIXED (see L5R2). M5R4
  FIXED (see Q5R1). M5R5 FIXED `e714944344` (only a lock SHARE does not wait for, then a
  write, closes the upgrade path).
- Outside this round, noted for the librarian sweep: the Part 5 record in
  `docs/freeholds/qa/persistence-2026-09-08/findings.md` cites two hashes that are not
  objects in this repository.

## Round six: eight fresh readers over round five (`b915d30173..f14d77d5a0`)

Round six's commits: `b8c7a3e8ca` (the probe's lock proved by mode, place and queue),
`d4b292e105` (the token runbook decides by what a constraint tests and renames an impostor),
`a8470bd1fe` (a whole pin on the shutdown closure's awaits), `f0490968e4` (P12, R-13 and the
comments), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C6R1 to C6R5 |
| qa-checklist | PASS | Q6R1 to Q6R4 |
| server hot path | PASS | H6R1 to H6R5 |
| privacy and security | PASS | S6R1 to S6R3 |
| database performance | PASS | D6R1 to D6R3 |
| test coverage | PASS | T6R1 to T6R7 |
| docs librarian | PASS | L6R1 to L6R5 |
| migration safety | PASS | M6R1 to M6R6 |

38 findings: none blocking, 9 should-fix (H6R1, Q6R1, S6R1, D6R1, T6R1, T6R2, M6R1, L6R1,
L6R2; S6R1, M6R1 and L6R2 are one defect, as are H6R1 and L6R1), 29 nice-to-have.

- C6R1 RULED (with S6R3 and T6R3): a loaded entry always carries its asker's account
  (`ensureEntry` sets it before the read loads the entry, and the one production `retain`
  passes the account), so the preload's key and the entry's agree on every reachable path and
  re-keying by owner key buys nothing; the decision's comment now says the key is defensive
  (`f0490968e4`). C6R2 FIXED `b8c7a3e8ca` (nested client release). C6R3 FIXED `b8c7a3e8ca`
  (the waiting mode read from `pg_locks`). C6R4 FIXED `f0490968e4` (R-13 and the stop comment
  add a chunk cut mid-statement whose rows the release passes by). C6R5 FIXED `f0490968e4`.
- Q6R1 FIXED `f0490968e4` (see C6R1). Q6R2 FIXED in this record (the C5R1 disposition names
  both commits). Q6R3 NOTED: the two order lines `e872a45953` removed are subsumed by the
  whole-arm pin, the single RAISE and the single END IF. Q6R4 FIXED `d4b292e105`.
- H6R1 FIXED `a8470bd1fe` (with L6R1 and L6R5): the prose drew a new gap three rounds running,
  so a whole pin in `tests/server/freehold_mutation.test.ts` now lists every await of the
  shutdown closure and checks that the contract names each bounded one with its value read
  from the code, the sum and the 75 s grace; the contract splits call-site and callee bounds.
  H6R2 FIXED `a8470bd1fe` (what `pool.end()` waits for). H6R3 FIXED `f0490968e4`. H6R4
  COVERED: the round-four and round-five hot-path readers each measured, on Node 26.10.0
  (the Dockerfile's `node:26-slim`), zero dependants left on the long-lived stop signal after
  GC. H6R5 FIXED `f0490968e4` (with L6R4).
- S6R1 FIXED `d4b292e105` (with M6R1 and L6R2): the runbook decides by what the constraint
  tests, so a CHECK a deparse change trips is kept. S6R2 FIXED `f0490968e4`. S6R3 RULED (see
  C6R1).
- D6R1 FIXED `d4b292e105` (with M6R3): an impostor is renamed, not dropped; a probe on
  PostgreSQL 16.14 showed a foreign key's RENAME locks only its own table while its DROP also
  locks the referenced one, so the lock timeout bounds the one wait. D6R2 FIXED `d4b292e105`
  and `f0490968e4` (the boot's stall behind Hearth DDL, and no DDL while a realm boots or
  restarts). D6R3 FIXED `b8c7a3e8ca` (a queued-request case and the steady precondition) and
  `f0490968e4` (what P12 says the case proves).
- T6R1 FIXED `b8c7a3e8ca` (the same read sees a lock that is held). T6R2 FIXED `a8470bd1fe` (a
  mutant dropping the underscore fails the kept-punctuation arm). T6R3 RULED (see C6R1).
  T6R4 FIXED `b8c7a3e8ca` (the 55P03's context names the deparse in the DO block). T6R5 FIXED
  (see C6R2). T6R6 FIXED `b8c7a3e8ca`. T6R7 FIXED `d4b292e105`.
- M6R1 FIXED (see S6R1). M6R2 FIXED `d4b292e105`, `a8470bd1fe` and `f0490968e4`: the housing
  claims are scoped to the housing fragments and the storage fragment's own locks on
  `storage_purchases` are named; probing them is OWED (outside 07a). M6R3 FIXED (see D6R1).
  M6R4 FIXED `d4b292e105` (a rename keeps a key's index). M6R5 FIXED `d4b292e105` and
  `f0490968e4` (every repair boot named). M6R6 FIXED `d4b292e105`.
- L6R1, L6R2 FIXED (see H6R1, S6R1). L6R3 FIXED `a8470bd1fe`. L6R4 FIXED (see H6R5). L6R5
  FIXED (see H6R1).

## Round seven: eight fresh readers over round six (`f14d77d5a0..94c0a55853`)

Round seven's commits: `b3f184beb6` (the token runbook's SQL as two fenced blocks the pg suite
executes, DEPLOY's first-rollout bullet, and the lock case's holder-first cleanup),
`71c4d79cfa` (the shutdown pin derives its bounds from the closure), `17c95d6a45` (P12, R-13
and the contract, structural), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C7R1 to C7R6 |
| qa-checklist | PASS | Q7R1 to Q7R6 |
| server hot path | PASS | H7R1 to H7R6 |
| privacy and security | PASS | S7R1 to S7R4 |
| database performance | PASS | D7R1 to D7R7 |
| test coverage | PASS | T7R1 to T7R8 |
| docs librarian | PASS | L7R1 to L7R6 |
| migration safety | PASS | M7R1 to M7R8 |

51 findings: none blocking, 16 should-fix (C7R1, C7R2, H7R1, H7R2, H7R3, L7R1, L7R2, L7R3,
D7R1, D7R2, Q7R1, Q7R2, T7R1, T7R2, M7R1, M7R2; several are one defect), 35 nice-to-have.
Nearly every should-fix was an enumeration drawing one more member (repair boots, storage
tables, `pool.end()` holders, the runbook's branches, the pin's hand-kept bounds), so this
round replaced each with a structural statement or a whole pin rather than a longer list.

- C7R1 FIXED `b3f184beb6` (with T7R3 and D7R5): every client is taken up front and cleanup
  rolls the holder back first, each waiter carries its own lock timeout, the queued request
  has its rejection handler and the polls a 5 s window; a forced wrong-mode assertion now
  reports in about 7 s and leaves the file's other cases green. C7R2 FIXED `71c4d79cfa` (with
  H7R1 and T7R1: the sum must fit the grace parsed from the game service). C7R3 FIXED
  `71c4d79cfa` (the mirror value comes from the captured awaits). C7R4 RULED: the pin matches
  over comment-stripped source, and a `;` in a string or a nested callback breaks an entry
  and fails red against the whole list, never green. C7R5, C7R6 FIXED `b3f184beb6`.
- H7R2 FIXED `71c4d79cfa` (with T7R2): every `_MS` constant and numeric literal an await
  passes is derived from the captured list, so a newly bounded call site changes the set the
  contract must name. H7R3 FIXED `71c4d79cfa` and `17c95d6a45` (each callee is checked to arm
  its bound; the contract no longer claims what the callees of the other awaits do). H7R4
  FIXED `71c4d79cfa` (the call-site and callee groups are checked apart). H7R5 FIXED
  `17c95d6a45` (with Q7R3 and D7R6). H7R6 FIXED `71c4d79cfa` (main.ts read once).
- L7R1 FIXED `b3f184beb6` and `17c95d6a45` (with M7R1 and M7R7): a repair boot is now defined
  as any boot that rebuilds something a probe guards, with its lock on that object's table,
  its index build under both parents and a unique rebuild's failure on duplicates. L7R2 FIXED
  `b3f184beb6` (the log judges the text only, and the cases tell an equivalent CHECK apart).
  L7R3 FIXED `17c95d6a45`. L7R4 FIXED `17c95d6a45` (with T7R8). L7R5 FIXED `17c95d6a45`. L7R6
  FIXED `b3f184beb6` (the same two tests in another order or print).
- S7R1 FIXED `b3f184beb6`: the impostor is renamed and the boot's own CHECK added NOT VALID in
  one short transaction, so no repair boot is needed; the pg suite runs that exact block and
  shows the next boot silent, then nulls and validates. S7R2 FIXED `b3f184beb6` (no cast but
  to `text`). S7R3 FIXED `b3f184beb6` (a fresh suffix on 42710 or 42P07). S7R4 FIXED
  `b3f184beb6` (a displaced constraint naming `advance_token` is dropped once the CHECK is
  validated).
- D7R1 FIXED `b3f184beb6` (the stall lasts the DDL's wait and hold; the block is sent whole,
  ROLLBACK before a retry). D7R2 FIXED `b3f184beb6` (with Q7R1: a later drop is as guarded and
  names the foreign key's second lock). D7R3, D7R4 FIXED `b3f184beb6`. D7R5 FIXED (see C7R1).
  D7R6 FIXED `17c95d6a45`. D7R7 FIXED `17c95d6a45`.
- Q7R1 FIXED (see D7R2). Q7R2 FIXED `17c95d6a45`. Q7R3 FIXED (see H7R5). Q7R4 NOTED: the
  round-six `server/CLAUDE.md` rewrap answered H6R5 and L6R4. Q7R5 FIXED `b3f184beb6` (with
  T7R5: both bullets refuse an unqualified statement, with a positive count). Q7R6 FIXED (see
  S7R3).
- T7R1, T7R2 FIXED (see C7R2, H7R2). T7R3 FIXED (see C7R1). T7R4 FIXED `b3f184beb6` (the block
  is pinned whole, in order). T7R5 FIXED (see Q7R5). T7R6 FIXED in the out-of-tree evidence
  summary, which is not tracked: the underscore mutant was applied through a quoted heredoc,
  but its summary line was written through an unquoted one that expanded the shell's `$-`; the
  line is corrected. T7R7 FIXED `71c4d79cfa`. T7R8 FIXED (see L7R4).
- M7R1, M7R7 FIXED (see L7R1). M7R2 FIXED `b3f184beb6` and `17c95d6a45` (the storage fragment
  holds its locks on its own tables, unenumerated). M7R3, M7R4, M7R5, M7R6 FIXED
  `b3f184beb6`. M7R8 FIXED `17c95d6a45`.

## Round eight: eight fresh readers over round seven (`94c0a55853..2d0c81144b`)

Round eight's commits: `8568019ac5` (every shutdown await classified), `8a12a46be9` (the lock
case's waiters outlast their polls), `bad933db50` (the token runbook as five named SQL blocks
the pg suite runs), `52bd1cc535` (repair boots, storage, the budget's opening and R-13), and
the commit that adds this section. The round-seven record commit the readers saw,
`0fa9abd430`, was amended before them (Q8R2), with the same tree, into `2d0c81144b`.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C8R1 to C8R6 |
| qa-checklist | PASS | Q8R1 to Q8R8 |
| server hot path | PASS | H8R1 to H8R8 |
| privacy and security | PASS | S8R1 to S8R5 |
| database performance | PASS | D8R1 to D8R6 |
| test coverage | PASS | T8R1 to T8R9 |
| docs librarian | PASS | L8R1 to L8R7 |
| migration safety | PASS | M8R1 to M8R8 |

57 findings: none blocking, 19 should-fix (S8R1, S8R2, H8R1, H8R2, H8R3, Q8R1, Q8R2, T8R1,
T8R2, C8R1, C8R2, D8R1, L8R1, L8R2, L8R3, L8R4, L8R5, M8R1, M8R2; most are three shapes seen
by several readers), 38 nice-to-have. The two shapes that kept drawing one more form, the
runbook's judgment calls and the pin's spelling-based derivation, are now mechanical: the
runbook's five named blocks are SQL the pg suite executes, and every shutdown await is
classified.

- C8R1 FIXED `bad933db50` (with M8R1): a correct CHECK the probe misreads is reported whatever
  `convalidated` says. C8R2 FIXED `8568019ac5` (with H8R1, Q8R1, T8R1): every await carries an
  explicit bound kind and an unbounded one may pass only listed argument shapes; binding
  `deedRecordsIdle(3000)` while leaving it unbounded fails the pin. C8R3 FIXED `52bd1cc535`
  (with L8R2: the storage fragment holds its own tables, some DDL unprobed, its probed repairs
  repair boots). C8R4 RULED: it needs a hand-dropped column and a hand-made constraint under
  the probed name together, the case M4R8 already ruled. C8R5 FIXED `bad933db50` (DROP is its
  own block naming only the displaced constraint, and the live name may never be dropped).
  C8R6 FIXED `8568019ac5` (with H8R6, Q8R7, T8R4).
- Q8R2 FIXED by amending the round-seven record commit (now `2d0c81144b`) and by the T7R6
  disposition naming the out-of-tree evidence summary. Q8R3 FIXED in this record (with L8R5).
  Q8R4 FIXED from this round on: commits split by type, with partial staging where one file
  carried both, save `bad933db50`, round nine's `50374c36fc`, round ten's `5122865156` and
  round eleven's `8d56b42d43`, which keep the runbook with the tests that execute its blocks
  from `DEPLOY.md` (either half alone fails at its own commit). Q8R5, Q8R6 FIXED `bad933db50`
  (setup inside the case, a `finally` that restores the CHECK, and the next boot's CHECK oid
  unchanged). Q8R8 FIXED (see S8R2).
- H8R2 FIXED `8568019ac5` (the concurrent pair is one classified entry, summed once; sequential
  stops would be two). H8R3 FIXED `8568019ac5` (each callee sliced to its own closing brace,
  its bound both armed and waited on). H8R4, H8R5 FIXED `8568019ac5` (the contract names
  exactly the classified bounds). H8R7 FIXED `8568019ac5` (`main.ts` declares none of them).
  H8R8 OWED: a measured reserve for the unbounded shutdown chain on a grown realm, so the
  sum's margin under the grace is evidence rather than an inequality.
- S8R1 FIXED `bad933db50` (with M8R2): PRINT shows how this server prints the real CHECK, so
  "the same tests" is an exact text match, not a judgment. S8R2 FIXED `bad933db50` (with
  L8R3, Q8R8, M8R3: a missing CHECK is put back by RESTORE, with no repair boot). S8R3 FIXED
  `bad933db50` (the read comes first). S8R4 FIXED `bad933db50` (with D8R2, M8R5: on any
  error ROLLBACK first, and a fresh suffix within 63 bytes). S8R5 FIXED `52bd1cc535` (with
  D8R1).
- D8R1 FIXED `52bd1cc535`: a unique rebuild over duplicates fails, restarts into the same
  stall, and is cleared by counting with an aggregate and resolving as the defect, never by
  deleting evidence blind. D8R3 FIXED `bad933db50` (with M8R6: a foreign key's referenced
  table is locked first, as a trip takes it). D8R4 FIXED `52bd1cc535`. D8R5 FIXED
  `bad933db50`. D8R6 FIXED `52bd1cc535`.
- T8R2 FIXED `bad933db50` (the `regclass` read is pinned qualified). T8R3 FIXED `bad933db50`
  (the null step's pattern is the fragment's). T8R5 FIXED `bad933db50` (the listener sees the
  impostor's warning before it sees silence). T8R6 FIXED `8a12a46be9`. T8R7 RULED: the
  file's legacy-table cases share the upgrade case's setup by design, as its other legacy
  cases do. T8R8 FIXED (see H8R3). T8R9 NOTED: the clamp warning is an earlier case's
  deliberate `AbortSignal.timeout(2 ** 31)`, which asserts the event.
- L8R1, L8R4 FIXED `52bd1cc535`. L8R5 FIXED in this record. L8R6 FIXED (see S8R3). L8R7 FIXED
  in this record.
- M8R4 FIXED (see S8R3). M8R7 FIXED `bad933db50` (a displaced constraint that blocks the null
  step is dropped first). M8R8 FIXED `bad933db50` (re-read after DISPLACE).

## Round nine: eight fresh readers over round eight (`2d0c81144b..41e0465720`)

Round nine's commits: `a40e7d3dee` (the shutdown classification's checks made exact),
`50374c36fc` (each runbook error routed by its block, every block with no realm booting, a
taken displaced name settled first, timed transactions, the collision path run), `4d2a51e2b6`
(every repair boot stops the other realms; duplicate recovery; the storage note; the contract's
term; section 16), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C9R1 to C9R7 |
| qa-checklist | PASS (no should-fix) | Q9R1 to Q9R4 |
| server hot path | PASS | H9R1 to H9R5 |
| privacy and security | PASS | S9R1 to S9R6 |
| database performance | PASS | D9R1 to D9R6 |
| test coverage | PASS | T9R1 to T9R8 |
| docs librarian | PASS | L9R1 to L9R11 |
| migration safety | PASS | M9R1 to M9R7 |

54 findings: none blocking, 18 should-fix (T9R1, D9R1, D9R2, M9R1 to M9R4, H9R1 to H9R3, C9R1,
L9R1 to L9R5, S9R1, S9R2), 36 nice-to-have. The runbook's error paths and the pin's edge forms
were the last two surfaces still drawing a new form; the error ladder is now routed per block
and run on its collision path, and the pin states its boundary (drift, not misclassification).

- C9R1 FIXED (see D9R4). C9R2 FIXED (see M9R5). C9R3 FIXED (see M9R4: an integrity error by
  SQLSTATE class routes to the drop rule, which drops only a constraint naming `advance_token`).
  C9R4 FIXED (see H9R3). C9R5 FIXED (see H9R2). C9R6 FIXED (see D9R3). C9R7 FIXED `4d2a51e2b6`.
- Q9R1 FIXED in this record (with L9R4). Q9R2 FIXED in this record (with L9R1). Q9R3 FIXED in
  this record (with L9R6: the round-seven lines rewrapped, their words unchanged). Q9R4 NOTED:
  the round-eight record commit's body omits its manifest lines; later commits followed it.
- H9R1 FIXED `a40e7d3dee`: each member of a concurrent group must be one call with one
  literal, groups are summed per entry, and the contract states each group once. H9R2 FIXED
  `a40e7d3dee` (with C9R5 and T9R2): the callee waits on the very variable its timeout fills
  and awaits nothing else; an extra await ahead of the renewer stop's deadline fails the pin.
  H9R3 FIXED `a40e7d3dee` (with C9R4: the constant is the call's whole argument, and `main.ts`
  imports it from its defining module or a named re-export, naming it nowhere else). H9R4,
  H9R5 FIXED `a40e7d3dee`.
- S9R1 FIXED (see M9R3). S9R2 FIXED `4d2a51e2b6`: duplicate rows are copied to an
  access-restricted side table before anything changes and are never deleted to pass the build.
  S9R3 FIXED `50374c36fc` (PRINT's read and drop name `pg_temp`). S9R4 FIXED (see D9R1). S9R5
  FIXED (see D9R5). S9R6 FIXED (see D9R3).
- D9R1 FIXED `50374c36fc` (with M9R2 and S9R4): every block is sent with no realm booting, and a
  42710 from RESTORE re-reads. D9R2 FIXED `4d2a51e2b6` (with M9R7): a repair boot always stops
  the other realms. D9R3 FIXED `50374c36fc` (with C9R6, L9R7 and S9R6: the foreign-key lock is
  for DROP, its stall per attempt, and every transaction block sets an idle-in-transaction
  timeout). D9R4 FIXED `50374c36fc` (with M9R1, C9R1 and L9R3: each error code routed by the
  block that raised it). D9R5 FIXED `50374c36fc` (with L9R11 and S9R5: NULL AND VALIDATE is a
  timed transaction that reports its count). D9R6 FIXED `4d2a51e2b6`.
- T9R1 FIXED `50374c36fc`: both suites read each block with its label, and every name the prose
  sends an operator to is pinned. T9R2 FIXED (see H9R2). T9R3 RULED: the contract counts only
  what a call site passes and what the two named callees fix, and says an unbounded await is
  not counted whatever its callee does inside; that cost belongs to the owed reserve (H8R8).
  T9R4 FIXED `a40e7d3dee`. T9R5, T9R6, T9R7 FIXED `50374c36fc`. T9R8 NOTED: 758 ms against the
  0.8 s header.
- L9R1, L9R4, L9R5, L9R6 FIXED in this record. L9R2 FIXED `4d2a51e2b6`. L9R3 FIXED (see D9R4).
  L9R7 FIXED (see D9R3). L9R8 FIXED (see M9R5). L9R9 FIXED `4d2a51e2b6`. L9R10 FIXED
  `4d2a51e2b6`. L9R11 FIXED (see D9R5).
- M9R1, M9R2 FIXED (see D9R4, D9R1). M9R3 FIXED `50374c36fc` (with S9R1): a taken displaced
  name is settled (read, DROP if it names `advance_token`, else rename) before DISPLACE again,
  so DROP always names `_displaced`; the pg suite runs that path (42710, ROLLBACK, DROP,
  DISPLACE). M9R4 FIXED `50374c36fc` (with C9R3). M9R5 FIXED `50374c36fc` (with C9R2 and L9R8:
  the re-read expects PRINT's text). M9R6 FIXED `50374c36fc` (a 42703 from RESTORE). M9R7
  FIXED (see D9R2).

## Round ten: eight fresh readers over round nine (`41e0465720..09d329c2cb`)

Round ten's commits: `a2dd8eb879` (both shutdown callees pinned whole), `5122865156` (the drop
rule drops only a token-only displacement, every error code routed and pinned as a closed set,
both collision arms run; kept whole with its tests for bisect), `6479a603bf` (a failed unique
rebuild changes no rows; P12's re-added column; one term for a steady-state boot), and the
commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C10R1 to C10R6 |
| qa-checklist | PASS | Q10R1 to Q10R4 |
| server hot path | PASS | H10R1 to H10R5 |
| privacy and security | PASS | S10R1 to S10R5 |
| database performance | PASS | D10R1 to D10R6 |
| test coverage | PASS | T10R1 to T10R8 |
| docs librarian | PASS | L10R1 to L10R7 |
| migration safety | PASS | M10R1 to M10R6 |

47 findings: none blocking, 17 should-fix (S10R1, S10R2, H10R1, L10R1, L10R2, Q10R1, D10R1,
D10R2, M10R1, M10R2, C10R1, C10R2, T10R1 to T10R5), 30 nice-to-have. Most were options the
last two rounds added (a side copy of duplicate rows, a rename with no block, a foreign-key
variant of DROP); each option was removed rather than specified further.

- C10R1 FIXED (see S10R1). C10R2 FIXED (see S10R2). C10R3 FIXED (see D10R2). C10R4 FIXED (see
  D10R4). C10R5 FIXED (see H10R2). C10R6 FIXED (see H10R1).
- Q10R1, Q10R2 FIXED in this record (with L10R1: the Q8R4 line names both commits kept whole,
  rewrapped). Q10R3 FIXED (see S10R3). Q10R4 FIXED (see S10R2).
- H10R1 FIXED `a2dd8eb879` (with T10R1 and C10R6): both callees that fix their own bound are
  pinned whole, whitespace aside; the reviewer's trailing `return settled;` fails the pin.
  H10R2 FIXED `a2dd8eb879` (with C10R5). H10R3, H10R4, H10R5 FIXED `a2dd8eb879`.
- S10R1 FIXED `6479a603bf` (with D10R1, M10R1, C10R1 and L10R6): a failed unique rebuild
  stops the realms, changes no rows and escalates with the index name; the boot's own
  statement names its columns, since a rolled-back rebuild leaves `pg_indexes` empty. S10R2
  FIXED `5122865156` (with M10R2, C10R2, L10R4 and Q10R4): the unblocked rename is gone. S10R3
  FIXED `5122865156` (with Q10R3 and M10R4: the collision route's early DROP is the stated
  exception, then NULL AND VALIDATE again). S10R4 FIXED `5122865156` (an integrity error is
  read by its first line, never its DETAIL). S10R5 FIXED `5122865156` (the read reports the
  constraint's columns, and DROP needs exactly the token, not a foreign key).
- D10R2 FIXED `5122865156` (with C10R3: a displaced foreign key is no runbook DROP; the rule
  stops on it). D10R3 FIXED `5122865156` (40P01 is retried as 55P03 is). D10R4 FIXED
  `5122865156` (with M10R3 and C10R4: a read that finds no row means a bare relation holds the
  name, so stop and report it). D10R5 FIXED `5122865156`. D10R6 OWED: a read-only preflight
  before a deploy, or a boot line naming the repair it performs, so a repair boot is known
  before it starts.
- T10R2 FIXED `5122865156` (the error routes are a closed pinned set). T10R3 FIXED
  `5122865156` (the 42P07 arm runs, a key's index colliding first). T10R4 FIXED `5122865156`.
  T10R5 FIXED `5122865156` (the names sent to equal the labels plus ROLLBACK). T10R6, T10R7
  FIXED `a2dd8eb879` (the screen is tested on its own spellings, and a re-export resolves from
  its own directory). T10R8 FIXED `5122865156` (the drop rule's own read, taken from the
  bullet, runs before each DROP).
- L10R2, L10R3 FIXED `6479a603bf`. L10R5 FIXED `5122865156`. L10R7 FIXED in this record.
- M10R5 FIXED `5122865156` (25P03 or a lost connection re-reads). M10R6 FIXED `5122865156`
  (every Hearth trip fails until the missing column's repair boot, so it runs in the next
  quiet window).

## Round eleven: eight fresh readers over round ten (`09d329c2cb..952be30c6b`)

Round eleven's commits: `5d5912617f` (the allowlist screen matches identifier words, each
callee is traced to where `server/main.ts` imports it, its body pinned with layout aside),
`8d56b42d43` (the read and every block are sent as one non-interactive psql session that
bounds itself (the name it set never took, corrected in round thirteen) and prints a code,
never a DETAIL; the drop rule needs one key; the routes follow the rule they name; the pg case
sends each block so and runs every stop shape and the integrity route; kept whole with its
tests for bisect), `4373df398d` (one steady-state term, a quiet window outside the nightly
`pg_dump`, the duplicate recovery scoped to housing, the column repair's 42710 stated), and
the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C11R1 to C11R5 |
| qa-checklist | PASS | Q11R1 to Q11R7 |
| server hot path | PASS | H11R1 to H11R5 |
| privacy and security | PASS | S11R1 to S11R6 |
| database performance | PASS | D11R1 to D11R6 |
| test coverage | PASS | T11R1 to T11R8 |
| docs librarian | PASS | L11R1 to L11R9 |
| migration safety | PASS | M11R1 to M11R5, and one note outside the diff |

51 findings: none blocking, 16 should-fix (H11R1, H11R2, T11R1 to T11R3, C11R1, Q11R1 to
Q11R3, M11R1, M11R2, D11R1, L11R1 to L11R4), 35 nice-to-have, and one note outside the diff.
Four readers found the same regression: round ten's screen fix had narrowed the screen. The
runbook's one unstated step, how a block is sent, became one command rather than another
route. Round twelve found that the session's name, set in PGOPTIONS, lost to psql's own
(C12R1); it is set through PGAPPNAME since.

- C11R1 FIXED (see H11R1). C11R2 FIXED `8d56b42d43` (with M11R4 and S11R2: after DROP, the
  drop rule's read shows whether it landed). C11R3 FIXED `8d56b42d43` (with Q11R4, S11R3,
  D11R5 and L11R5: an integrity error from NULL AND VALIDATE is the third time DROP may be
  sent, after the drop rule's own read). C11R4 FIXED `8d56b42d43` (with S11R1 and M11R3: the
  read reports `keys`, the length of `conkey`, and DROP needs 1; on PostgreSQL 16 a whole-row
  CHECK reads `keys` 2 beside `columns` `{advance_token}`, run in the pg suite). C11R5 FIXED
  `8d56b42d43` (psql now stops at the first error, so no 25P02 line follows it).
- Q11R1 FIXED (see H11R1). Q11R2 FIXED `4373df398d` (with L11R1: DEPLOY, the Hearth fragment's
  comment and the manifest say steady-state boot; the pg case title follows in `8d56b42d43`).
  Q11R3 FIXED `8d56b42d43` (with T11R2 and S11R6: every five-character code in the bullet is
  pinned as one ordered list, so a route in any wording joins it). Q11R4 FIXED (see C11R3).
  Q11R5 FIXED `5d5912617f` (with T11R8: the empty set is gone). Q11R6 NOTED: `a2dd8eb879`'s
  body omits the own-directory re-export and the blank-line grace parse, and `952be30c6b`'s
  body credits the manifest with the tip's pg total and the preflight, which went to the
  ledger; this section and round ten's say what each commit did, and rewording them would
  change every hash these records cite. Q11R7 FIXED (see T11R3).
- H11R1 FIXED `5d5912617f` (with T11R1, C11R1 and Q11R1): the screen splits each identifier at
  its humps and underscores and matches whole words in any case, so SCREAMING_SNAKE bounds
  count again and `heldClaims` stays clear; its self-test covers each word in each spelling
  and one near miss. H11R2 FIXED `5d5912617f`: each callee is read where `server/main.ts`
  imports it from, directly or through one named re-export; a mutant importing the renewer's
  stop from another module fails the pin. H11R3 FIXED `5d5912617f` (with T11R5: posix paths).
  H11R4 FIXED `5d5912617f` (bodies are compared with layout dropped; a mutant doubling the
  renewer's bound still fails). H11R5 FIXED `5d5912617f` (comment lines, a quoted value and a
  trailing comment parse; a compound duration still fails loudly).
- S11R1 FIXED (see C11R4). S11R2 FIXED (see C11R2). S11R3 FIXED (see C11R3). S11R4 FIXED
  `4373df398d` (the bullet says the boot's fatal log line prints the DETAIL too; trimming that
  log is OWED). S11R5 FIXED (see D11R1). S11R6 FIXED (see Q11R3).
- D11R1 FIXED `8d56b42d43` (with S11R5 and C11R5): one non-interactive psql command, whose
  PGOPTIONS bound every lock wait and pause (the name they set never took, corrected in round
  thirteen), with ON_ERROR_STOP and VERBOSITY sqlstate (terse would hide the code every route
  keys on); pasting into an interactive session is ruled out, and the pg case sends each block
  under the command's own options, so an error ends the session with no ROLLBACK sent. D11R2
  FIXED `8d56b42d43` (a lost connection waits until no other `advance_token_runbook` session
  remains). D11R3 FIXED `8d56b42d43` (NULL AND VALIDATE's row locks last for VALIDATE's scan,
  which grows with the table; no statement timeout was added, since a cut VALIDATE only sends
  the operator to stop). D11R4 FIXED `8d56b42d43` (the read's brief ACCESS SHARE is stated,
  and the command's lock timeout bounds it). D11R5 FIXED (see C11R3). D11R6 FIXED `4373df398d`
  (the quiet window is defined once, outside the nightly `pg_dump`).
- T11R1 FIXED (see H11R1). T11R2 FIXED (see Q11R3). T11R3 FIXED `8d56b42d43` (with Q11R7: four
  stop shapes, each through the bullet's own read and each failing the rule: another column,
  the whole row beside the token, a foreign key, and a key over the account and the token).
  T11R4 FIXED `8d56b42d43` (the read's `conname` clause is pinned). T11R5 FIXED (see H11R3).
  T11R6 FIXED `5d5912617f` (by fixture, a nested re-export resolves in its own directory).
  T11R7 FIXED `5d5912617f` (by fixture, a wrapped group splits into its members). T11R8 FIXED
  (see Q11R5).
- L11R1 FIXED (see Q11R2). L11R2 FIXED `8d56b42d43` (the 42703 route stops the other realms).
  L11R3 FIXED in this record (the Q8R4 line names round ten's and round eleven's commits).
  L11R4 FIXED `4373df398d` (with M11R1): the duplicate recovery is housing's; the storage
  guard's own failure, its message and its HINT are outside the bullet, and a runbook for them
  is OWED. L11R5 FIXED (see C11R3). L11R6 FIXED `8d56b42d43` (with M11R2: case four ends at
  the drop rule). L11R7 FIXED in this record's manifest line. L11R8 FIXED in the ledger. L11R9
  FIXED `8d56b42d43` (the routes are the last sub-bullet, after the read and the drop rule
  they name).
- M11R1 FIXED (see L11R4). M11R2 FIXED (see L11R6). M11R3 FIXED (see C11R4). M11R4 FIXED (see
  C11R2). M11R5 FIXED `4373df398d` (the columns come only from the boot's own statement;
  housing's index is built only when absent, so a rolled-back build leaves no row). The note
  outside the diff FIXED `4373df398d`: the fragment's comment and P12 say the column's repair
  names its CHECK unprobed, so a hand-made constraint of that name on other columns fails that
  boot with 42710 (confirmed on PostgreSQL 16).

## Round twelve: eight fresh readers over round eleven (`952be30c6b..43efccfbdd`)

Round twelve's commits: `ce340075f5` (the spelling screen removed for the stated boundary, the
grace parse linear with fixtures for every arm, each callee named only at its import and
call), `6e268de9cc` (the runbook session named through PGAPPNAME, the command one line in a
shell fence, the pg case connecting as psql does; the boot's 42710 loop, the dump as a lock
holder, a lost connection's next step and the database log's DETAIL routed; kept whole with
its tests for bisect), `2b19063caa` (the dump stall spelled out, the contract's quiet window
pointed at DEPLOY's, the column repair's name on other columns or none), and the commit that
adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C12R1 to C12R6 |
| qa-checklist | PASS | Q12R1 to Q12R5 |
| server hot path | FAIL | H12R1 to H12R6 |
| privacy and security | PASS | S12R1 to S12R3 |
| database performance | FAIL | D12R1 to D12R5 |
| test coverage | PASS | T12R1 to T12R9 |
| docs librarian | PASS | L12R1 to L12R6 |
| migration safety | PASS | M12R1 to M12R6 |

46 findings: two blocking (D12R1, H12R1), eleven should-fix (C12R1, Q12R1, S12R1, L12R1, M12R1,
M12R2, T12R1 to T12R4, H12R2), 33 nice-to-have. Six readers found one defect (its count and
cause corrected in round thirteen): psql always sends a startup application name (`psql` by
default), which the server applies after the options string, so the runbook's `-c
application_name` in PGOPTIONS never named its session. The spelling screen drew a new missed
spelling for the third round running, so it was removed for the stated boundary rather than
extended.

- C12R1 FIXED `6e268de9cc` (with D12R1, L12R1, Q12R1, S12R1 and M12R1): the session is named
  through PGAPPNAME. A probe on PostgreSQL 16 showed a startup `application_name` beats a `-c
  application_name` in the options; the pg case now connects as psql does (PGAPPNAME as the
  name, `psql` as the fallback), a control reads `psql` for a name given in PGOPTIONS, and a
  mutant restoring the old form fails both suites. C12R2 FIXED `6e268de9cc` (with M12R3 and
  D12R4: a lost connection takes its route whatever code psql printed first, and its wait is
  bounded at about a minute). C12R3 FIXED `6e268de9cc` (with D12R2: the runbook runs outside
  the nightly `pg_dump`, and a dump holding the lock is waited out, never ended). C12R4 FIXED
  `2b19063caa` (with L12R2 and D12R3). C12R5 FIXED `ce340075f5` (with H12R2, H12R3, T12R2,
  T12R4 and Q12R2): the screen is removed; each allowlist entry is an exact call text whose
  review is the boundary the case states, since no word list closes the spellings of a bound.
  C12R6 FIXED `ce340075f5` (the helper says a meaning-bearing break passes the compare and the
  check-only format check fails it; corrected in `27261249b0`, Q13R1).
- Q12R1 FIXED (see C12R1). Q12R2 FIXED (see C12R5). Q12R3 FIXED `6e268de9cc` (each send
  connects inside its `try`, with an error listener). Q12R4 FIXED `2b19063caa` (with L12R4:
  P12's paragraph reflowed). Q12R5 NOTED: `4373df398d`'s "its runbook" is the storage runbook
  the ledger lists as OWED, and `5d5912617f`'s body leaves out the grace parse and the empty
  set's removal, which round eleven's section names; the bodies stay, as for Q11R6.
- H12R1 FIXED `ce340075f5` (with T12R1): each line inside the game block takes one shape,
  indented four or more or a comment indented less, so a failed match stays linear. Fixtures
  cover a shallow comment, a blank line, both quotes, a trailing comment, mismatched quotes, a
  compound duration, a sibling's grace and a deeper key; a timed case over 22 deep comments
  returns at once, where the overlapping form took 812 ms against its 100 ms bound. H12R2,
  H12R3 FIXED (see C12R5). H12R4 FIXED `ce340075f5` (each callee is named only at its import
  and its call; a mutant adding a second mention fails). H12R5 FIXED `ce340075f5` (a
  member-access break is layout, with fixtures for it and a spread). H12R6 FIXED `ce340075f5`
  (an import path must name a file, so a directory barrel fails with its path).
- S12R1 FIXED (see C12R1). S12R2 FIXED `6e268de9cc` (the database's own log keeps the DETAIL,
  so it is never attached to a report). S12R3 FIXED `6e268de9cc` (the command is one line in
  the bullet's one shell fence, pinned whole and parsed by the pg case).
- D12R1 FIXED (see C12R1). D12R2 FIXED (see C12R3). D12R3 FIXED `2b19063caa` (saves and logins
  wait behind the boot's queued lock, and a boot in the dump's opening locks can deadlock it).
  D12R4 FIXED (see C12R2). D12R5 FIXED (see M12R2).
- T12R1 FIXED (see H12R1). T12R2 FIXED (see C12R5). T12R3 FIXED `6e268de9cc` (every
  SQLSTATE-shaped token, letter-led or not, and every class routed are pinned as ordered
  lists). T12R4 FIXED (see C12R5). T12R5 FIXED `6e268de9cc` (a real leftover fails PRINT with
  42P07 in its own session and is gone in the next). T12R6 FIXED `ce340075f5` (a longer
  re-exported name holding the one sought is no match). T12R7 FIXED `6e268de9cc` (23514
  exactly). T12R8 FIXED `ce340075f5` (each file is stripped once). T12R9 FIXED in the evidence
  summary (each mutant with its failing test and counts).
- L12R1 FIXED (see C12R1). L12R2 FIXED (see C12R4). L12R3 FIXED `2b19063caa` (the contract's
  quiet window points at DEPLOY's, the dump included). L12R4 FIXED (see Q12R4). L12R5 FIXED
  (see M12R2). L12R6 FIXED in this record's manifest line.
- M12R1 FIXED (see C12R1). M12R2 FIXED `6e268de9cc` (with L12R5 and D12R5): the bullet says a
  boot that finds the column missing and its name held fails with 42710 at every restart, so
  the realms stop and stay stopped, and 42703 from DISPLACE routes to the same stop. M12R3
  FIXED (see C12R2). M12R4 FIXED `6e268de9cc` (a landed block goes on from the next step, and
  a DISPLACE re-read that shows anything else stops). M12R5 FIXED `2b19063caa` (the columns
  come from the index's `CREATE UNIQUE INDEX`, found by searching `server/` for the name).
  M12R6 FIXED `2b19063caa` (on other columns or none).

## Round thirteen: eight fresh readers over round twelve (`43efccfbdd..57408b6542`)

Round thirteen's commits: `27261249b0` (the grace read inside the services block and timed
over blank and comment lines, a reflowed optional chain as layout, two comments corrected),
`09e8a44f19` (a HOLDER read for the holder and lost connection checks, a lost send resent
once, a dump waited out before any retry, the report's fields, the code pin's control, every
fence pinned, and the pg case running HOLDER and the missing column; kept whole with its tests
for bisect), `fae6b76048` (the bench's boot times in DEPLOY, the contract and P12, the dump's
cost to every pool), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C13R1 to C13R4 |
| qa-checklist | PASS | Q13R1 to Q13R5 |
| server hot path | PASS | H13R1 to H13R4 |
| privacy and security | PASS | S13R1 to S13R4 |
| database performance | PASS | D13R1 to D13R3 |
| test coverage | FAIL | T13R1 to T13R8 |
| docs librarian | PASS | L13R1 to L13R7 |
| migration safety | PASS | M13R1 to M13R3 |

38 findings: one blocking (T13R1), six should-fix (C13R1, S13R1, D13R1, L13R1, T13R2, T13R3),
31 nice-to-have. Naming the session made an unscripted check find itself, which four readers
caught; the checks became one read that excludes its sender. Earlier records are corrected in
place, with the round that corrected them named.

- C13R1 FIXED `09e8a44f19` (with S13R1, D13R2 and M13R1): HOLDER, a sixth labelled block,
  names every other session that holds or waits for a Hearth lock and every other runbook
  session by pid, name, state and lock mode, never a query text or a client address and never
  itself; the 55P03 and lost connection routes send it. The pg case shows a holder named
  `pg_dump` and an empty HOLDER after it, and a mutant without the self-exclusion fails. C13R2
  FIXED `09e8a44f19` (with M13R2: the read and PRINT are sent again, and a NULL AND VALIDATE
  that landed reports its count as unknown). C13R3 FLAGGED: a rename-only block that frees the
  name for the column repair boot is a ruling; the runbook stops in the safe state, and the
  ruling is OWED in the ledger. C13R4 FIXED `fae6b76048` (with L13R4).
- Q13R1 FIXED `27261249b0` (the comment says the check-only format check fails such a break;
  the C12R6 line is corrected in this record). Q13R2 FIXED `09e8a44f19` (with T13R2: a route
  keyed by a code or a `code starting NN` class joins the lists, and one keyed by no code is
  pinned by its own text). Q13R3 FIXED `27261249b0` (with T13R7: 25 lines, the fastest of
  three runs against 1,000 ms; the blank-line overlap mutant took 8,995 ms). Q13R4 FIXED in
  this record and the ledger (a startup application name is applied after the options string,
  whatever the packet order). Q13R5 FIXED `09e8a44f19` (with T13R6: the control runs with
  PGAPPNAME stubbed empty, and the URL may carry no application name or options).
- H13R1 FIXED `27261249b0` (blank lines are timed too, and a mutant letting a whitespace-only
  line match two shapes fails). H13R2 FIXED `27261249b0`. H13R3 FIXED `27261249b0` (with
  T13R4: the unreachable lookahead and its fixture are gone). H13R4 FIXED `27261249b0` (the
  grace is read inside the services block; a mutant reading the whole file returns an `x-`
  block's 300).
- S13R1 FIXED (see C13R1). S13R2 FIXED `09e8a44f19` (a report gives the read's fields and
  whether the definition matched, never the definition). S13R3 FIXED `09e8a44f19` (`docker
  logs eastbrook-db` named). S13R4 FIXED `09e8a44f19` (HOLDER runs at the first 55P03, and a
  dump is waited out before any retry).
- D13R1 FIXED `09e8a44f19` (a lost send is resent once; a second loss stops). D13R2 FIXED (see
  C13R1). D13R3 FIXED `fae6b76048` (a boot behind the dump waits on `auth_tokens`, not the
  parents, corrected in round eighteen, D18R1) (both dump mentions give 03:15 UTC; its
  stuck-save bound was wrong, a save failing at its 2 s lock timeout, and was corrected in
  round fourteen, C14R1).
- T13R1 FIXED `09e8a44f19`: the code pattern is one constant with a control that must yield
  P0001, XX000 and 42P07 and neither CHECK nor PRINT; a digit-led mutant fails it. T13R2 FIXED
  (see Q13R2). T13R3 FIXED `09e8a44f19`: the pg case drops the column; with the name free
  RESTORE fails 42703; with the name held by a UNIQUE on another column or a CHECK on none,
  DISPLACE fails 42703 and changes nothing and the boot fails 42710; with the name freed the
  boot re-adds the column with its CHECK, validated. T13R4 FIXED (see H13R3). T13R5 FIXED
  `27261249b0` (an optional-chain fixture; its mutant fails). T13R6 FIXED (see Q13R5). T13R7
  FIXED (see Q13R3). T13R8 FIXED `09e8a44f19` (every fence in the bullet, opening and closing,
  is one pinned list).
- L13R1 FIXED in this record and the ledger (six readers). L13R2 FIXED `fae6b76048`. L13R3
  FIXED `09e8a44f19`. L13R4 FIXED (see C13R4). L13R5 NO CHANGE: `raw` is the bullet's own
  slice, and the fence pin now lists every fence in it (T13R8). L13R6 FIXED in both records: a
  wrong claim is rewritten in place, with the round that corrected it named. L13R7 FIXED
  `fae6b76048` (55 to 66 ms and 56 to 59 ms from the bench, in DEPLOY, the contract and P12).
- M13R1 FIXED (see C13R1). M13R2 FIXED (see C13R2). M13R3 FIXED `09e8a44f19` (after a dump,
  attempts are counted afresh).

## Round fourteen: eight fresh readers over round thirteen (`57408b6542..53694e42cf`)

Round fourteen's commits: `6a7e3cd49d` (the compose grace read line by line, the timed case
gone, fixtures for every edge; its comment strip could still backtrack, corrected in round
fifteen), `02bbf3d438` (HOLDER sendable at any point, scoped to this database and naming each
session's kind, the dump polled through it, every send on the lost connection route capped,
PRINT's output allowed in a literal report, every fence pinned at any indent, and the pg case
running HOLDER against a holder, a waiter and an idle runbook session; kept whole with its
tests for bisect), `8c5fa7fc28` (the stuck save's real bound, in DEPLOY, and the bench's
deadlocked boots, in DEPLOY, the contract and P12; where the bound landed corrected in round
fifteen, and the stall, which waits on `auth_tokens`, in round nineteen, L19R4), `fe0f331dfd` (the test URL checked without printing it), and the commit that adds
this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C14R1 to C14R4 |
| qa-checklist | PASS | Q14R1 to Q14R4 |
| server hot path | PASS | H14R1, H14R2 |
| privacy and security | PASS | S14R1 to S14R4 |
| database performance | FAIL | D14R1 to D14R5 |
| test coverage | PASS | T14R1 to T14R8 |
| docs librarian | PASS | L14R1 to L14R8 |
| migration safety | PASS | M14R1 to M14R4 |

39 findings: one blocking (D14R1), twelve should-fix (C14R1, D14R2, L14R1 to L14R3, H14R1,
M14R1 to M14R3, T14R1 to T14R3), 26 nice-to-have. The blocking finding was round thirteen's
own: a pool-fill sentence that a save's 2 s lock timeout contradicts (behind the dump token
statements fill the pool and no save waits on a lock, D18R1, corrected in round nineteen,
L19R4). The grace parse's timed
guard drew a new slow pattern for the third round, so the parse became line by line.

- C14R1 FIXED `8c5fa7fc28` (with D14R1 and L14R1) (a boot behind the dump waits on
  `auth_tokens`, not the parents, corrected in round eighteen, D18R1): a stuck save fails at
  its 2 s lock timeout with 55P03 and is written again as an aborted save; only a read with no
  tighter bound holds its client to the 15 s statement timeout, so a realm's pool can fill (a
  write other than a save too, each at its own bound, corrected in rounds fifteen and sixteen,
  C15R1 and C16R2). The D13R3 line is corrected in this record. C14R2 FIXED `02bbf3d438` (with
  D14R4 and S14R2: the dump is polled through HOLDER about once a minute, one still there well
  past its usual length stops, and a runbook session seen beside it goes to the lost
  connection route). C14R3 FIXED `02bbf3d438` (with S14R4: a report asking for the literal
  also gives PRINT's output and the server version). C14R4 FIXED `02bbf3d438` (with S14R3,
  M14R4 and Q14R4: HOLDER reads only this database's locks and sessions).
- Q14R1 FIXED `02bbf3d438` (with T14R6: the environment stub is undone in a `finally`). Q14R2
  NO CHANGE: the case's `finally` already restores a missing column, dropping a held name and
  booting the fragment, which re-adds it. Q14R3 FIXED `8c5fa7fc28` (each bound is named by its
  setting or file beside its number). Q14R4 FIXED (see C14R4; the nightly dump's command sets
  no application name, so it shows as `pg_dump`).
- H14R1 FIXED `6a7e3cd49d`: the timed guard drew a new slow pattern for the third round, so
  the grace is read line by line (its comment strip could still backtrack, corrected in round
  fifteen); mutants that read a deeper key or leave the services block open fail. H14R2 FIXED
  `6a7e3cd49d` (whitespace-only lines, a trailing space, CRLF and a commented services line
  parse, and the null check names what it reads).
- S14R1 FIXED `fe0f331dfd` (the URL check is a boolean with a message). S14R2 FIXED (see
  C14R2). S14R3 FIXED (see C14R4). S14R4 FIXED (see C14R3).
- D14R1 FIXED (see C14R1). D14R2 FIXED `8c5fa7fc28` (with L14R4 and M14R3: the ranges say no
  deadlock formed, and give the deadlocked boots, one of six steady at 1,056 ms and three of
  16 rollout at about 1 s). D14R3 FIXED `02bbf3d438` (HOLDER shows each session's kind, so an
  autovacuum worker is named). D14R4 FIXED (see C14R2). D14R5 FIXED `02bbf3d438` (HOLDER's
  label says it takes no table lock and answers behind a queued lock).
- T14R1 FIXED `02bbf3d438` (every fence line at any indent, with its indent, is one pinned
  list). T14R2 FIXED `6a7e3cd49d` (fixtures for a block after services and a key after it).
  T14R3 FIXED `02bbf3d438` (HOLDER runs with a holder, a waiter queued behind it and an idle
  runbook session, each by its own pid; three runs in a row passed). T14R4, T14R7 and T14R8
  FIXED `02bbf3d438`. T14R5 FIXED `6a7e3cd49d` (shape checked against a literal). T14R6 FIXED
  (see Q14R1).
- L14R1 FIXED (see C14R1). L14R2 FIXED `02bbf3d438` (with M14R1: every block but PRINT and
  HOLDER locks the table, and HOLDER is sent at any point). L14R3 FIXED in this record and the
  ledger (each site rewritten in round thirteen names it). L14R4 FIXED (see D14R2). L14R5
  FIXED in this record and the ledger. L14R6 and L14R7 FIXED `02bbf3d438`. L14R8 NOTED: the
  report sentence stays before the read so the cases keep their lead-in.
- M14R1 FIXED (see L14R2). M14R2 FIXED `02bbf3d438` (the lost file is resent once whatever it
  was, any send on the route that loses its connection stops, and a resend counts toward the
  five). M14R3 FIXED (see D14R2). M14R4 FIXED (see C14R4 and D14R3).

## Round fifteen: eight fresh readers over round fourteen (`53694e42cf..e47d1c29cd`)

Round fifteen's commits: `6c91150321` (the bench's deadlock victim, an account create, named
and placed on the order path in DEPLOY, the contract and P12, and every read's statement bound
named), `25b04a58a8` (SIGTERM and SIGINT pinned to the closure, the compose stop signal
checked, a comment found by a search that cannot backtrack, DEPLOY's bounds read from the
code, fixtures for each branch of the parse), `412ed5c9a1` (the dump's usual length read from
the newest backup, a waiting dump row as a stop, HOLDER locking no user table, the lost
connection route's file and count named, and the pg case keeping another database's runbook
session out of HOLDER; kept whole with its tests for bisect), `9224b3c02e` (a write other than
a save among the stuck clients; the stuck clients are token statements, corrected in round
nineteen, L19R4), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C15R1 to C15R3 |
| qa-checklist | PASS | Q15R1 to Q15R6 |
| server hot path | PASS | H15R1 to H15R4 |
| privacy and security | PASS | S15R1 to S15R3 |
| database performance | FAIL | D15R1 to D15R6 |
| test coverage | PASS | T15R1 to T15R11 |
| docs librarian | PASS | L15R1 to L15R5 |
| migration safety | PASS | M15R1 to M15R7 |

45 findings: none blocking, eight should-fix (M15R1, H15R1, H15R2, D15R1, D15R2, Q15R1, T15R1,
T15R2), 37 nice-to-have. The database reader fails a round on any open should-fix, which is
the only FAIL. The parse that round fourteen called unable to backtrack still could, through
its comment strip; that claim is corrected in place, and where round fourteen's save bound
landed is too, in round sixteen's record.

- C15R1 FIXED `6c91150321` and `9224b3c02e` (with D15R2 and M15R6) (a boot behind the dump
  waits on `auth_tokens`, not the parents, corrected in round eighteen, D18R1): a stuck read,
  or a write other than a save, holds its client to its statement timeout, 15 s for an
  ordinary one and 60 s for the heavy reads `runWithStatementTimeout` raises. C15R2 FIXED
  `412ed5c9a1` (with L15R3 and M15R5: the route resends "the file that brought you here").
  C15R3 FIXED `25b04a58a8` (a column-zero comment fixture).
- Q15R1 FIXED `25b04a58a8` (with H15R3 and T15R7): the comment's start is found by a
  two-character search, so every pattern in the parse is anchored or a two-character search,
  linear in its line (worded so in round sixteen, Q16R1); the round fourteen lines that
  claimed it before are corrected here and in the ledger. Q15R2 NOTED: the record states the
  cap as DEPLOY does, and the body stays, as for Q11R6. Q15R3 FIXED (see T15R2). Q15R4 FIXED
  `412ed5c9a1` (with T15R9: the waiter's promise is settled where it is made). Q15R5 FIXED
  `25b04a58a8` (DEPLOY's 2, 15 and 60 s are read from the code; a mutant changing 15 to 16
  fails). Q15R6 FIXED `412ed5c9a1` (only client sessions are pinned whole, so an autovacuum
  row cannot fail the case).
- H15R1 FIXED `25b04a58a8`: the closure's SIGINT and SIGTERM registrations are each pinned
  once, and a game service whose `stop_signal` is not SIGTERM reads as no grace; both mutants
  fail. H15R2 FIXED `25b04a58a8` (with T15R1). H15R3 FIXED (see Q15R1). H15R4 NOTED: a grace
  in minutes fails loudly with a named message, and the contract states the grace in seconds.
- S15R1 FIXED (see M15R1). S15R2 FIXED `412ed5c9a1` (with M15R4: the major version, sent as
  its own file through the same command). S15R3 FIXED `412ed5c9a1` (with M15R3 and D15R5: no
  lock on any user table, only brief ones on system catalogs).
- D15R1 FIXED `6c91150321` (with L15R2 and M15R7): each deadlocked bench boot lived while an
  account-then-character transaction was aborted, and an account create takes the order path
  only while community test accounts are on, and is not retried (corrected in round sixteen,
  M16R1; the contract's half landed then, L16R1). D15R2 FIXED (see C15R1). D15R3 FIXED
  `412ed5c9a1` (with M15R1: the dump's usual length is measured from yesterday's backup, since
  the newest is the one the dump is writing, corrected in round sixteen, S16R2, and a dump row
  waiting for a lock stops at once). D15R4 FIXED `6c91150321` (every save attempt fails for
  the dump's run, and a leave save whose retries end first is lost but for its guild books).
  D15R5 FIXED (see S15R3). D15R6 NOTED: as D11R3, no statement timeout is added, since a cut
  VALIDATE only sends the operator to stop.
- T15R1 FIXED `25b04a58a8` (a game service left open at a later top-level key; its mutant
  fails). T15R2 FIXED `412ed5c9a1` (a runbook session in another database on the server stays
  out of HOLDER; a mutant without the database filter fails at runtime). T15R3 to T15R6 and
  T15R11 FIXED `25b04a58a8`. T15R7 FIXED (see Q15R1). T15R8 FIXED `412ed5c9a1` (the poll ends
  only once the waiter is active). T15R9 FIXED (see Q15R4). T15R10 FIXED `412ed5c9a1` (the URL
  pattern has a positive control).
- L15R1 FIXED (see M15R1). L15R2 FIXED (see D15R1). L15R3 FIXED (see C15R2). L15R4 FIXED in
  this record. L15R5 FIXED in the ledger.
- M15R1 FIXED `412ed5c9a1` (with S15R1, L15R1 and D15R3). M15R2 FIXED `412ed5c9a1` (a dump
  seen on the lost connection route is waited out first). M15R3 FIXED (see S15R3). M15R4 FIXED
  (see S15R2). M15R5 FIXED (see C15R2; after a dump wait the five start afresh on either
  branch). M15R6 FIXED (see C15R1). M15R7 FIXED (see D15R1).

## Round sixteen: eight fresh readers over round fifteen (`e47d1c29cd..25796f7162`)

Round sixteen's commits: `8661efb1c3` (an account create on the order path only while
community test accounts are on, a character create always, the bench's victim named by its
shape, in DEPLOY, the contract and P12, and every stuck client failing at its own bound, in
DEPLOY; where that bound landed, the character create's paths and the victim's name corrected
in round seventeen, and the stall itself, which waits on `auth_tokens`, in round nineteen,
L19R3), `b107b08e95` (the signal registrations pinned whole with no other mention
of either signal, no STOPSIGNAL in the Dockerfile, the compose grace and signal read apart
with odd keys unread, the fixture that decided nothing removed), `b1d103a36c` (the dump wait
measured from yesterday's backup with a fixed stop, HOLDER listing every dump, the lost
connection route's order and files, the version read's send rule, and the pg case's URL and
database checks; kept whole with its tests for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C16R1 to C16R5 |
| qa-checklist | PASS | Q16R1 to Q16R5 |
| server hot path | PASS | H16R1 to H16R6 |
| privacy and security | PASS | S16R1 to S16R4 |
| database performance | FAIL | D16R1 to D16R4 |
| test coverage | PASS | T16R1 to T16R8 |
| docs librarian | FAIL | L16R1 to L16R9 |
| migration safety | FAIL | M16R1 to M16R7 |

48 findings: none blocking, 16 should-fix (S16R1, S16R2, M16R1, M16R2, C16R1, H16R1, H16R2,
D16R1, D16R2, L16R1 to L16R4, T16R1, T16R2, Q16R1), 32 nice-to-have. Five readers found that
the dump measure read tonight's file, the one the dump writes. Round fifteen had read
`createAccount` without its community test branch; the account create's statements are
corrected in place.

- C16R1 FIXED (see S16R2). C16R2 FIXED `8661efb1c3` (a boot behind the dump waits on
  `auth_tokens`, not the parents, corrected in round eighteen, D18R1) (with D16R3 and L16R3:
  each stuck client fails at its own bound, its lock timeout where it sets one, 55P03, and
  otherwise its statement timeout, 57014, 15 s or 60 s). C16R3 FIXED (see H16R1). C16R4 FIXED
  (see H16R2). C16R5 FIXED (see M16R3).
- Q16R1 FIXED `b107b08e95` (with L16R6: the parse's comment says each pattern is anchored or a
  two-character search, linear in its line; the Q15R1 line is corrected in this record). Q16R2
  FIXED (see S16R3). Q16R3 FIXED (see H16R4). Q16R4 FIXED (see H16R1). Q16R5 NOTED:
  `412ed5c9a1`'s body leaves out four pg fixes the round-fifteen section names; the bodies
  stay, as for Q11R6.
- H16R1 FIXED `b107b08e95` (with C16R3 and Q16R4: the Dockerfile sets no STOPSIGNAL, a mutant
  adding one fails, and node as PID 1 stays pinned by `tests/deploy_game_ops.test.ts`). H16R2
  FIXED `b107b08e95` (with C16R4: the two registrations are one pinned block after the closure
  and no other line of `server/main.ts` names either signal; mutants adding a listener or
  wrapping one fail). H16R3 FIXED `b107b08e95` (a game-service key that is not a plain word
  leaves the service unread; its mutant fails). H16R4 FIXED `b107b08e95` (with Q16R3: the
  signal is read apart from the grace and checked under its own message, SIGTERM or SIGINT).
  H16R5 FIXED (see H16R2). H16R6 FIXED `b107b08e95` (with T16R7: the bullet's end is checked).
- S16R1 FIXED `b1d103a36c` (the URL is checked with `URL.canParse` before it is parsed). S16R2
  FIXED `b1d103a36c` (with M16R2, C16R1, D16R1 and L16R2): the wait is measured from
  yesterday's file, since tonight's is the one the running dump writes, and stops at twice
  that length or when there is no such file (replaced by a fixed window in round seventeen,
  C17R3); the D15R3 line is corrected in this record. S16R3 FIXED `b1d103a36c` (with Q16R2 and
  T16R5: the other session's database is checked to differ). S16R4 OWED: the backup script's
  umask leaves dumps readable by any local account; it belongs to the deploy path.
- D16R1 FIXED (see S16R2). D16R2 FIXED (see M16R1). D16R3 FIXED (see C16R2). D16R4 FIXED
  `b1d103a36c` (a `pg_dump` row with `granted` false is a dump waiting for the Hearth table).
- T16R1 FIXED `b107b08e95` (the fixture that decided no branch is gone; linearity is held by
  the anchored patterns, as the comment says). T16R2 and T16R3 FIXED `b107b08e95` (a signal
  after the grace, a quoted one and another service's). T16R4 FIXED `b1d103a36c` (the
  empty-HOLDER check keeps client sessions only; noted in round seventeen). T16R5 FIXED (see
  S16R3). T16R6 FIXED `b1d103a36c` (an options URL as a second control). T16R7 FIXED (see
  H16R6). T16R8 FIXED `b1d103a36c` (the directory is read from the backup script).
- L16R1 FIXED `8661efb1c3` (the contract lists the creates on the order path; the D15R1 line
  is corrected in this record). L16R2 FIXED (see S16R2). L16R3 FIXED (see C16R2). L16R4 FIXED
  (see M16R3). L16R5 FIXED in this record. L16R6 FIXED (see Q16R1). L16R7 FIXED `8661efb1c3`
  ("fails that way until the dump ends"). L16R8 FIXED `b1d103a36c` (the count names both
  routes; these two noted in round seventeen). L16R9 FIXED `8661efb1c3` (P12 reflowed).
- M16R1 FIXED `8661efb1c3` (with D16R2): `createAccount` touches `characters` only while
  community test accounts are on, so only then does an account create take the order path; the
  bench's victim was a transaction of that shape; a character create, which locks the account
  row and then counts and inserts characters, always does (on both paths, corrected in round
  seventeen, L17R1, and the character delete with it in round eighteen, L18R1); in DEPLOY, the
  contract and P12. M16R2 FIXED (see S16R2). M16R3 FIXED `b1d103a36c` (with C16R5 and L16R4:
  the lost connection route waits a dump out first, by the waits and stops above and never
  their resend, then polls). M16R4 FIXED `b1d103a36c` (the version read may be sent at any
  point and is resent as a file that changes nothing). M16R5 FIXED `b1d103a36c` (from the
  55P03 route, the file that failed, never HOLDER). M16R6 FIXED `b1d103a36c` (HOLDER lists
  every `pg_dump` session, with a Hearth lock or not). M16R7 FIXED `8661efb1c3` and
  `b1d103a36c`.

## Round seventeen: eight fresh readers over round sixteen (`25796f7162..f20c8439a4`)

Round seventeen's commits: `f8276ca1e9` (a character create on both deadlock paths, the
bench's victim called by the evidence's own label, the evidence saying its shape, and the
lowered statement bounds beside the raised one), `95612ad273` (the compose game service's keys
pinned whole, the Dockerfile check case-free, no server file but `main.ts` naming either
signal, the registration block matched across any whitespace), `c991771d8c` (the dump wait
bounded by a fixed window pinned to the backup cron, the lost connection route's entry codes
and resendable files, and the pg case's lockless dump; kept whole with its tests for bisect),
and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C17R1 to C17R3 |
| qa-checklist | PASS | Q17R1 to Q17R5 |
| server hot path | PASS | H17R1 to H17R6 |
| privacy and security | PASS | S17R1 |
| database performance | PASS | D17R1 to D17R3 |
| test coverage | PASS | T17R1 to T17R6 |
| docs librarian | FAIL | L17R1 to L17R9 |
| migration safety | PASS | M17R1 to M17R6 |

39 findings: none blocking, five should-fix (T17R1, H17R1 to H17R3, L17R1), 34 nice-to-have.
The measured dump length drew a new edge case for the third round, so it became a fixed
window; the signal pin's new forms became whole pins on the game service's keys and on every
server file.

- C17R1 FIXED (see T17R1). C17R2 FIXED (see H17R2). C17R3 FIXED `c991771d8c` (with M17R1,
  M17R2, D17R1, L17R5 and S17R1): the wait is a fixed window, a dump seen before 03:15 UTC or
  after 04:15 UTC stopping it, pinned to the backup job's cron line, so no backup file is read
  and no date, rewrite or minimum can mislead it.
- Q17R1 FIXED (see T17R1). Q17R2 FIXED (see H17R2). Q17R3 FIXED `c991771d8c` (the client-only
  filter's reason is a comment). Q17R4 FIXED (see H17R6). Q17R5 FIXED in this record (T16R4,
  L16R7 and L16R8 name their changes; the file-name pin it asked for went with the file read).
- H17R1 FIXED `95612ad273` (with T17R4: no file under `server/` but `main.ts` names either
  signal, read through the shared walker; a mutant adding a listener in `server/db.ts` fails).
  H17R2 FIXED `95612ad273` (with C17R2 and Q17R2: the game service's keys are pinned whole, so
  an `extends` fails until read; its mutant fails). H17R3 FIXED (see T17R1). H17R4 NOTED: the
  game service's `build` names no `dockerfile:`, so it builds the root Dockerfile the pin
  reads, and a base image's STOPSIGNAL is beyond what repo text can pin. H17R5 FIXED
  `95612ad273` (the block is matched across any whitespace, with a named message). H17R6 FIXED
  `95612ad273` and `c991771d8c` (with Q17R4: that match spans `\r\n`, and the `BACKUP_DIR`
  read it named is gone; the second commit named in round eighteen, Q18R4).
- S17R1 FIXED (see C17R3).
- D17R1 FIXED (see C17R3). D17R2 FIXED `c991771d8c` (the backup script's `pg_dump` line is
  pinned and the script names no session). D17R3 FIXED `f8276ca1e9` (the evidence says its
  victim's shape).
- T17R1 FIXED `95612ad273` (with H17R3, C17R1 and Q17R1: the Dockerfile pattern ignores case,
  with a lowercase control; a mutant adding `stopsignal SIGQUIT` fails). T17R2 FIXED
  `c991771d8c` (the cron and `pg_dump` lines are pinned). T17R3 FIXED `c991771d8c` (HOLDER
  lists a `pg_dump` session that holds no lock). T17R4 FIXED (see H17R1). T17R5 and T17R6
  FIXED `95612ad273` (no heading inside the bullet's slice; a flow-map game reads as no
  grace).
- L17R1 FIXED `f8276ca1e9`: a character create counts `characters` before it inserts, so it
  takes the upgrade path as well as the order path (and so does the character delete,
  corrected in round eighteen, L18R1), in DEPLOY, the contract, P12 and the manifest's change
  log. L17R2 to L17R4 FIXED in this record. L17R5 FIXED (see C17R3). L17R6 FIXED `c991771d8c`
  (the version read is named where the send rule first uses it). L17R7 FIXED `f8276ca1e9` (the
  victim is called by the evidence's label). L17R8 FIXED `f8276ca1e9`. L17R9 FIXED
  `c991771d8c` (HOLDER's long line wrapped).
- M17R1 and M17R2 FIXED (see C17R3). M17R3 FIXED `c991771d8c` (the 55P03 or 40P01 route, in
  both places). M17R4 and M17R5 FIXED `c991771d8c` (the files that change nothing are the
  read, the drop rule's read, PRINT and the version read). M17R6 FIXED `f8276ca1e9` (the
  lowered bounds, 2 s or 10 s, beside the raised one; that list was dropped in round eighteen,
  Q18R1, when the stall was found to be on `auth_tokens`).

## Round eighteen: eight fresh readers over round seventeen (`f20c8439a4..897cdc04e7`)

Round eighteen's commits: `57c5db022b` (the boot's lock order, `auth_tokens` before the
parents, with what a boot behind the dump stalls, both deadlock paths stated as shapes, the
evidence's probe, and the test reading the order and the bounds from the code, the compose
file set and every server module; kept whole with its test for bisect, since the old bounds
case read the text it replaces), `4dfbb51a07` (the HOLDER read that decides, the bare-relation
stop before any DROP, a spent count on the lost connection route, and the backup script's
checks as booleans), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C18R1 to C18R3 |
| qa-checklist | PASS | Q18R1 to Q18R6 |
| server hot path | PASS | H18R1 to H18R3 |
| privacy and security | PASS | S18R1 |
| database performance | FAIL | D18R1 to D18R3 |
| test coverage | PASS | T18R1 to T18R5 |
| docs librarian | FAIL | L18R1 to L18R6 |
| migration safety | PASS | M18R1 to M18R5 |

32 findings: one blocking (D18R1), six should-fix (C18R1, D18R2, H18R1, M18R1, Q18R1, L18R1),
25 nice-to-have. The blocking finding was round thirteen's own: a boot behind the dump waits
on `auth_tokens`, the core schema's first table, not on `characters`, which a lock probe
confirmed. The deadlock lists had drawn a new member or path every round since round fifteen
(corrected in round nineteen, L19R12), so both paths are now stated as shapes.

- C18R1 FIXED `57c5db022b` (with M18R1 and L18R1): the character delete takes both paths, and
  both paths are stated as shapes, the shapes deciding and the transactions named only as
  examples, in DEPLOY, the contract and P12. C18R2 FIXED (see Q18R1). C18R3 FIXED `57c5db022b`
  (with T18R1, Q18R3 and H18R2: the comment states the pin's reach, every file under
  `server/`, and a bare `removeAllListeners()` there fails too; a mutant in a nested module
  fails).
- Q18R1 FIXED `57c5db022b` (with C18R2, D18R3 and L18R2): the stall names only the bounds that
  apply, `DB_STATEMENT_TIMEOUT_MS` and `DB_POOL_CONNECT_TIMEOUT_MS`, both read from the code,
  and the list of lowered bounds is gone. Q18R2 FIXED `57c5db022b` (the scan goes through
  `modulesUnder`, and the comments say every `server/` scan). Q18R3 FIXED (see C18R3). Q18R4
  FIXED in this record (H17R6 names both commits). Q18R5 and Q18R6 FIXED (see T18R5).
- H18R1 FIXED `57c5db022b` (the repo tracks exactly one compose file; a mutant adding an
  override fails). H18R2 FIXED (see C18R3). H18R3 FIXED `57c5db022b` (with T18R3: every line
  of the bullet's slice after its first is indented or blank, with a control).
- S18R1 FIXED `4dfbb51a07` (each backup-script check is a boolean with a message).
- D18R1 FIXED `57c5db022b`: the core schema alters `auth_tokens` before `characters` and
  `accounts`, and a lock probe, the REAL `ensureSchema()` against a session holding ACCESS
  SHARE on all 125 tables, found the boot waiting for ACCESS EXCLUSIVE on `auth_tokens` with
  SHARE there and nothing on the parents. DEPLOY now says token statements queue to the 15 s
  statement timeout and, once a pool fills, other queries fail at the 5 s acquire timeout; the
  test reads the schema's first altered tables and both bounds from the code; the evidence
  records the probe; the record lines of rounds thirteen to seventeen that described the stall
  are corrected in this record (not in `57c5db022b`, and the rest in round nineteen: Q19R1,
  L19R3, L19R4). D18R2 FIXED `57c5db022b` (the order path is any transaction holding
  a later table and asking for an earlier one, a password reset's `accounts` then
  `auth_tokens` named; the evidence says that path is stated from the code). D18R3 FIXED (see
  Q18R1).
- T18R1 FIXED (see C18R3). T18R2 FIXED `57c5db022b` (one memoized read of every server module
  serves the file's three `server/` scans, with a nested-module control; the file runs at 745
  to 750 ms against its 0.8 s header). T18R3 FIXED (see H18R3). T18R4 FIXED `4dfbb51a07` (the
  token bullet's slice has an end guard and the same continuation check). T18R5 FIXED
  `4dfbb51a07` (with Q18R5 and Q18R6: the cron and dump lines anchored and CRLF-tolerant, no
  time zone set in the script, and no session named in the compose file).
- L18R1 FIXED (see C18R1; the L17R1 and M16R1 lines are corrected in this record). L18R2 FIXED
  (see Q18R1). L18R3 FIXED in this record (see Q18R4). L18R4 FIXED `57c5db022b` (the evidence
  paragraph reflowed). L18R5 FIXED in this record and the manifest's change log. L18R6 FIXED
  `57c5db022b` ("(1 s each)" kept on one line).
- M18R1 FIXED (see C18R1). M18R2 FIXED `4dfbb51a07` (the last HOLDER read decides). M18R3
  FIXED `4dfbb51a07` (a spent count stops the lost connection route). M18R4 FIXED `4dfbb51a07`
  (the bare-relation stop applies before any DROP). M18R5 FIXED in the manifest's change log.

## Round nineteen: eight fresh readers over round eighteen (`897cdc04e7..c6ae5cfb2b`)

Round nineteen's commits: `80ee2487aa` (the boot's locks on the parents observed on the real boot
behind a held lock on each parent in turn, with every statement each boot sends read for a
lock timeout), `7c7ddd961c` (DEPLOY's boot bullet split by concern: the boot queues behind any open
transaction holding a lock it needs, only `auth_tokens` and `characters` take SHARE first, a
row lock counts, a role or database lock timeout would still apply, a boot already behind the
dump is stopped, and an account write whose token revoke failed is redone; the contract, P12,
R-11 and the evidence with it; the test pinning the doc's order and bounds to the code and to
section L, and the shutdown scans widened; kept whole with its test for bisect, since the old
bounds case read the text it replaces), `2323737f77` (the token route's second HOLDER clause read
plainly, the bare-relation stop pinned, and the backup script's zone screen over any zone
word), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C19R1 to C19R5 |
| qa-checklist | PASS | Q19R1 to Q19R6 |
| server hot path | PASS | H19R1 to H19R7 |
| privacy and security | PASS | S19R1 to S19R2 |
| database performance | PASS | D19R1 to D19R2 |
| test coverage | PASS | T19R1 to T19R7 |
| docs librarian | FAIL | L19R1 to L19R12 |
| migration safety | PASS | M19R1 to M19R6 |

47 findings: none blocking, 13 should-fix (S19R1, C19R1, C19R2, T19R1 to T19R3, L19R1 to
L19R4, H19R1, H19R2, M19R1), 34 nice-to-have. Five readers drew a new statement kind for the
text derivation of the boot's lock order (an index create, a DROP, a DO block, a row write),
so the order is now observed on the real boot instead; the backup script's zone screen drew
new spellings from three readers and now refuses any zone word.

- C19R1 FIXED `7c7ddd961c` (a boot already waiting behind the dump: stop that realm, which has
  served nothing yet and whose schema transaction rolls back, boot it again after the dump,
  never end the dump, and boot no other realm until it ends). C19R2 FIXED `80ee2487aa` and `7c7ddd961c`
  (with Q19R2, T19R2, L19R8 and H19R1: section L of the mutation pg suite holds ACCESS SHARE
  on each parent in turn and reads the real boot's locks once it queues, SHARE on
  `auth_tokens` alone behind the first and every earlier parent behind each later one; the
  text derivation is gone; a mutant adding an index create on `accounts` ahead of
  `auth_tokens` fails). C19R3 FIXED (see M19R1). C19R4 FIXED (see M19R2). C19R5 FIXED (see
  T19R7).
- Q19R1 FIXED in this record (D18R1's record corrections are named as this record's, not
  `57c5db022b`'s). Q19R2 FIXED (see C19R2). Q19R3 FIXED (see T19R1). Q19R4 FIXED `2323737f77` (the
  bare-relation stop is pinned whole and reads "finds no row, a bare relation holds the name:
  stop"). Q19R5 FIXED (see T19R6). Q19R6 FIXED `80ee2487aa` (the boot runs on its own client and
  lifts the statement timeout first; section L reads both from each boot's statements).
- H19R1 FIXED (see C19R2). H19R2 FIXED (see T19R3). H19R3 FIXED `7c7ddd961c` (the pool's options
  are pinned to both constants). H19R4 FIXED `7c7ddd961c` (both server scans carry a message, and
  any mention of `removeAllListeners` fails). H19R5 FIXED `7c7ddd961c` (the nested-walk control
  asks for any module in a subdirectory). H19R6 FIXED `7c7ddd961c` (the schema slice went with the
  derivation). H19R7 FIXED (see T19R1).
- S19R1 FIXED `7c7ddd961c`: a password change, a staff password reset, a ban or a suspension writes
  the account and then revokes its tokens in a second statement, so during the dump the write
  lands and the revoke fails, leaving the old tokens valid and the live session connected;
  DEPLOY says no action but the listed saves is retried and to redo each one after the dump.
  S19R2 FIXED (see T19R7).
- D19R1 FIXED (see M19R1). D19R2 FIXED `7c7ddd961c` (a query fails once it waits 5 s without a free
  client, until the dump ends and the boot COMMITs).
- T19R1 FIXED `2323737f77` (with Q19R3 and H19R7: the script names no zone word, `tz`, `zone` or
  `localtime`, in any spelling, with a control for each reader's spelling, and both session
  screens have controls). T19R2 FIXED (see C19R2). T19R3 FIXED `80ee2487aa` and `7c7ddd961c` (with H19R2
  and M19R5: section L reads every statement each boot sends and finds no lock timeout, with
  a control; a mutant adding one to `ensureSchema` fails; DEPLOY says a lock timeout on the
  role, the database or `DATABASE_URL` would still apply). T19R4 FIXED (see H19R4). T19R5
  FIXED (see H19R6). T19R6 FIXED `7c7ddd961c` and `2323737f77` (with Q19R5: one bullet-exit pattern per
  file keeps a blank line, CRLF and the end of the text inside the bullet, with controls).
  T19R7 FIXED `7c7ddd961c` (with S19R2 and C19R5: compose picks one primary file by name plus its
  override, and a `-f` or `COMPOSE_FILE` on the host is beyond repo text).
- L19R1 FIXED `7c7ddd961c` (R-11 names the `auth_tokens` upgrade and the whole order, and the owed
  fix covers both core indexes; the fix's scope stays the maintainer's). L19R2 FIXED `7c7ddd961c`
  (the evidence's two boot bullets and its owed fix, each correction named). L19R3 and L19R4
  FIXED in this record. L19R5 FIXED in the ledger. L19R6 FIXED `7c7ddd961c` ("(15 s)" on one line).
  L19R7 FIXED (see M19R2). L19R8 FIXED (see C19R2). L19R9 FIXED (see M19R1). L19R10 FIXED
  `7c7ddd961c` (the contract paragraph and P12's tail reflowed). L19R11 FIXED `2323737f77` (the clause
  reads "if it shows no `pg_dump` session but another `advance_token_runbook` session", and
  the pin with it). L19R12 FIXED in this record.
- M19R1 FIXED `7c7ddd961c` (with C19R3, D19R1 and L19R9: the boot queues behind every open
  transaction, running or idle in transaction, that holds a lock on a table it locks, in
  DEPLOY, the contract and P12, and the quiet check counts `idle in transaction`). M19R2
  FIXED `7c7ddd961c` (with C19R4 and L19R7: only `auth_tokens` and `characters` take SHARE first,
  and `accounts` is ACCESS EXCLUSIVE from its first statement, as section L observes). M19R3
  FIXED `7c7ddd961c` (the order example is marked as one). M19R4 FIXED `7c7ddd961c` (every boot writes
  rows, so a row lock counts on both paths). M19R5 FIXED (see T19R3). M19R6 FIXED `7c7ddd961c` (any
  statement that reads or writes `auth_tokens`, an account delete's cascade among the
  examples, and pg-pool's `timeout exceeded when trying to connect`, with no SQLSTATE, named
  as the failure).
