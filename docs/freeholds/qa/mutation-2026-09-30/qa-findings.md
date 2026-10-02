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
  carried both, save `bad933db50`, which keeps the runbook with the tests that execute its
  blocks from `DEPLOY.md` (either half alone fails at its own commit). Q8R5, Q8R6 FIXED `bad933db50` (setup inside the case, a `finally` that
  restores the CHECK, and the next boot's CHECK oid unchanged). Q8R8 FIXED (see S8R2).
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
- H9R1 FIXED `a40e7d3dee`: each member of a concurrent group must be one call with one literal,
  groups are summed per entry, and the contract states each group once. H9R2 FIXED
  `a40e7d3dee`: the callee waits on the very variable its timeout fills and awaits nothing else;
  an extra await ahead of the renewer stop's deadline fails the pin. H9R3 FIXED `a40e7d3dee`
  (with C9R4: the constant is the call's whole argument, and `main.ts` imports it from its
  defining module or a named re-export, naming it nowhere else). H9R4, H9R5 FIXED `a40e7d3dee`.
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
- M9R1, M9R2 FIXED (see D9R4, D9R1). M9R3 FIXED `50374c36fc` (with S9R1): a taken displaced name
  is settled (read, DROP if it names `advance_token`, else rename) before DISPLACE again, so
  DROP always names `_displaced`; the pg suite runs that path (42710, ROLLBACK, DROP, DISPLACE).
  M9R4 FIXED `50374c36fc`. M9R5 FIXED `50374c36fc` (with C9R2 and L9R8: the re-read expects
  PRINT's text). M9R6 FIXED `50374c36fc` (a 42703 from RESTORE). M9R7 FIXED (see D9R2).
