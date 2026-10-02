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

Round fourteen's commits: `6a7e3cd49d` (the compose grace read line by line, the timed case gone,
fixtures for every edge; its comment strip could still backtrack, corrected in round fifteen),
`02bbf3d438` (HOLDER sendable at any point, scoped to this database and naming each session's
kind, the dump polled through it, every send on the lost connection route capped, PRINT's output
allowed in a literal report, every fence pinned at any indent, and the pg case running HOLDER
against a holder, a waiter and an idle runbook session; kept whole with its tests for bisect),
`8c5fa7fc28` (the stuck save's real bound, in DEPLOY, and the bench's deadlocked boots, in
DEPLOY, the contract and P12; where the bound landed corrected in round fifteen, and the stall,
which waits on `auth_tokens`, in round nineteen, L19R4), `fe0f331dfd` (the test URL checked
without printing it), and the commit that adds this section.

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

39 findings: one blocking (D14R1), twelve should-fix (C14R1, D14R2, L14R1 to L14R3, H14R1, M14R1
to M14R3, T14R1 to T14R3), 26 nice-to-have. The blocking finding was round thirteen's own: a
pool-fill sentence that a save's 2 s lock timeout contradicts (behind the dump, token statements
fill the pool and no save waits on a lock, D18R1, corrected in round nineteen, L19R4). The grace
parse's timed guard drew a new slow pattern for the third round, so the parse became line by
line.

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
| database performance | FAIL (should-fix only) | D15R1 to D15R6 |
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
| database performance | FAIL (should-fix only) | D16R1 to D16R4 |
| test coverage | PASS | T16R1 to T16R8 |
| docs librarian | FAIL (should-fix only) | L16R1 to L16R9 |
| migration safety | FAIL (should-fix only) | M16R1 to M16R7 |

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
| docs librarian | FAIL (should-fix only) | L17R1 to L17R9 |
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
| docs librarian | FAIL (should-fix only) | L18R1 to L18R6 |
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
behind a held lock on each parent in turn, with every statement each boot sends read for a lock
timeout), `7c7ddd961c` (DEPLOY's boot bullet split by concern: the boot queues behind any open
transaction holding a lock it needs, only `auth_tokens` and `characters` take SHARE first, a row
lock counts, a role or database lock timeout would still apply, a boot already behind the dump is
stopped (its backend ended too, corrected in round twenty, C20R1), and an account write whose
token revoke failed is redone (one sign-out of every account, corrected in round twenty, S20R3);
the contract, P12, R-11 and the evidence with it; the test pinning the doc's order and bounds to
the code and to section L (the order only by literals section L mirrored, corrected in round
twenty, Q20R3), and the shutdown scans widened; kept whole with its test for bisect, since the
old bounds case read the text it replaces), `2323737f77` (the token route's second HOLDER clause
read plainly, the bare-relation stop pinned, and the backup script's zone screen over any zone
word), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C19R1 to C19R5 |
| qa-checklist | PASS | Q19R1 to Q19R6 |
| server hot path | PASS | H19R1 to H19R7 |
| privacy and security | PASS | S19R1 to S19R2 |
| database performance | PASS | D19R1 to D19R2 |
| test coverage | PASS | T19R1 to T19R7 |
| docs librarian | FAIL (should-fix only) | L19R1 to L19R12 |
| migration safety | PASS | M19R1 to M19R6 |

47 findings: none blocking, 13 should-fix (S19R1, C19R1, C19R2, T19R1 to T19R3, L19R1 to
L19R4, H19R1, H19R2, M19R1), 34 nice-to-have. Five readers drew a new statement kind for the
text derivation of the boot's lock order (an index create, a DROP, a DO block, a row write),
so the order is now observed on the real boot instead; the backup script's zone screen drew
new spellings from three readers and now refuses any zone word.

- C19R1 FIXED `7c7ddd961c` (a boot already waiting behind the dump: stop that realm, which has
  served nothing yet and whose schema transaction rolls back, boot it again after the dump, never
  end the dump, and boot no other realm until it ends; stopping the realm alone leaves its
  backend in the queue, so the backend is ended too, corrected in round twenty, C20R1). C19R2
  FIXED `80ee2487aa` and `7c7ddd961c` (with Q19R2, T19R2, L19R8 and H19R1: section L of the
  mutation pg suite holds ACCESS SHARE on each parent in turn and reads the real boot's locks
  once it queues, SHARE on `auth_tokens` alone behind the first and every earlier parent behind
  each later one; the text derivation is gone; a mutant adding an index create on `accounts`
  ahead of `auth_tokens` fails). C19R3 FIXED (see M19R1). C19R4 FIXED (see M19R2). C19R5 FIXED
  (see T19R7).
- Q19R1 FIXED in this record (D18R1's record corrections are named as this record's, not
  `57c5db022b`'s). Q19R2 FIXED (see C19R2). Q19R3 FIXED (see T19R1). Q19R4 FIXED `2323737f77`
  (the bare-relation stop is pinned whole and reads "finds no row, a bare relation holds the
  name: stop"). Q19R5 FIXED (see T19R6). Q19R6 FIXED `80ee2487aa` (the boot runs on its own
  client and lifts the statement timeout first; section L reads both from each boot's
  statements).
- H19R1 FIXED (see C19R2). H19R2 FIXED (see T19R3). H19R3 FIXED `7c7ddd961c` (the pool's options
  are pinned to both constants). H19R4 FIXED `7c7ddd961c` (both server scans carry a message, and
  any mention of `removeAllListeners` fails). H19R5 FIXED `7c7ddd961c` (the nested-walk control
  asks for any module in a subdirectory). H19R6 FIXED `7c7ddd961c` (the schema slice went with
  the derivation). H19R7 FIXED (see T19R1).
- S19R1 FIXED `7c7ddd961c`: a password change, a staff password reset, a ban or a suspension
  writes the account and then revokes its tokens in a second statement, so during the dump the
  write lands and the revoke fails, leaving the old tokens valid and the live session connected;
  DEPLOY says no action but the listed saves is retried and to redo each one after the dump (the
  redo became one sign-out of every account, corrected in round twenty, S20R3). S19R2 FIXED (see
  T19R7).
- D19R1 FIXED (see M19R1). D19R2 FIXED `7c7ddd961c` (a query fails once it waits 5 s without a
  free client, until the dump ends and the boot COMMITs).
- T19R1 FIXED `2323737f77` (with Q19R3 and H19R7: the script names no zone word, `tz`, `zone` or
  `localtime`, in any spelling, with a control for each reader's spelling, and both session
  screens have controls). T19R2 FIXED (see C19R2). T19R3 FIXED `80ee2487aa` and `7c7ddd961c`
  (with H19R2 and M19R5: section L reads every statement each boot sends and finds no lock
  timeout, with a control; a mutant adding one to `ensureSchema` fails; DEPLOY says a lock
  timeout on the role, the database or `DATABASE_URL` would still apply). T19R4 FIXED (see
  H19R4). T19R5 FIXED (see H19R6). T19R6 FIXED `7c7ddd961c` and `2323737f77` (with Q19R5: one
  bullet-exit pattern per file keeps a blank line, CRLF and the end of the text inside the
  bullet, with controls). T19R7 FIXED `7c7ddd961c` (with S19R2 and C19R5: compose picks one
  primary file by name plus its override, and a `-f` or `COMPOSE_FILE` on the host is beyond repo
  text).
- L19R1 FIXED `7c7ddd961c` (R-11 names the `auth_tokens` upgrade and the whole order, and the
  owed fix covers both core indexes; the fix's scope stays the maintainer's). L19R2 FIXED
  `7c7ddd961c` (the evidence's two boot bullets and its owed fix, each correction named). L19R3
  and L19R4 FIXED in this record. L19R5 FIXED in the ledger. L19R6 FIXED `7c7ddd961c` ("(15 s)"
  on one line). L19R7 FIXED (see M19R2). L19R8 FIXED (see C19R2). L19R9 FIXED (see M19R1). L19R10
  FIXED `7c7ddd961c` (the contract paragraph and P12's tail reflowed). L19R11 FIXED `2323737f77`
  (the clause reads "if it shows no `pg_dump` session but another `advance_token_runbook`
  session", and the pin with it). L19R12 FIXED in this record.
- M19R1 FIXED `7c7ddd961c` (with C19R3, D19R1 and L19R9: the boot queues behind every open
  transaction, running or idle in transaction, that holds a lock on a table it locks, in DEPLOY,
  the contract and P12, and the quiet check counts `idle in transaction`; a lock conflicting with
  one it takes, corrected in round twenty, H20R6). M19R2 FIXED `7c7ddd961c` (with C19R4 and
  L19R7: only `auth_tokens` and `characters` take SHARE first, and `accounts` is ACCESS EXCLUSIVE
  from its first statement, as section L observes). M19R3 FIXED `7c7ddd961c` (the order example
  is marked as one). M19R4 FIXED `7c7ddd961c` (every boot writes rows, so a row lock counts on
  both paths; a row lock counts by the table lock it carries, and most boots write no row,
  corrected in round twenty, Q20R1). M19R5 FIXED (see T19R3). M19R6 FIXED `7c7ddd961c` (any
  statement that reads or writes `auth_tokens`, an account delete's cascade among the examples,
  and pg-pool's `timeout exceeded when trying to connect`, with no SQLSTATE, named as the
  failure).

## Round twenty: eight fresh readers over round nineteen (`c6ae5cfb2b..30588ebb50`)

Round twenty's commits: `7c8509713b` (a boot already behind the dump is ended at its backend once
its realm stops (and every boot that takes its place, corrected in round twenty-one, D21R1), by a
statement section L runs from DEPLOY against a stopped boot; a dump-shaped hold observed, with
every lock the boot holds on any table of the schema; the lock timeout checked on each boot's
startup parameters too; a row lock's real reason (its row-write clause dropped in round
twenty-one, T21R8), the conflict wording, a runnable quiet check, and the stall's remedy as one
sign-out; the contract, P12, the evidence and DEPLOY's long token line with it; kept whole for
bisect, since section L and the unit test read the bullet), and the commit that adds this
section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | FAIL | C20R1 to C20R5 |
| qa-checklist | PASS | Q20R1 to Q20R10 |
| server hot path | PASS | H20R1 to H20R6 |
| privacy and security | PASS | S20R1 to S20R5 |
| database performance | FAIL | D20R1 to D20R5 |
| test coverage | PASS | T20R1 to T20R4 |
| docs librarian | FAIL (should-fix only) | L20R1 to L20R9 |
| migration safety | FAIL | M20R1 to M20R2 |

46 findings: three blocking (C20R1, D20R1, M20R1, one defect), 20 should-fix (C20R2 to C20R4,
Q20R1 to Q20R4, H20R1, S20R1 to S20R3, D20R2, D20R3, T20R1 to T20R3, L20R1 to L20R4), 23
nice-to-have. The blocking defect was round nineteen's own: stopping a realm whose boot waits
behind the dump does not end the boot's backend, which never reads its socket while it waits for
a lock, so the queue holds until the dump ends; a probe and section L confirm it, and DEPLOY now
ends the backend (and every boot that takes its place, corrected in round twenty-one, D21R1). The
stall's redo list drew new members from three readers and became one whole remedy.

- C20R1 FIXED `7c8509713b` (with D20R1, M20R1, S20R1 and L20R2: the realm is stopped first, so
  the restart policy cannot boot it again, and then DEPLOY's `pg_terminate_backend` statement, on
  the ungranted ACCESS EXCLUSIVE request on `auth_tokens`, ends the boot's backend; section L
  closes a boot's socket behind a dump-shaped hold, sees its backend keep its place and a token
  read fail with 57014, runs DEPLOY's statement and sees the queue clear; a mutant that names the
  granted lock instead fails; C19R1's disposition is corrected in this record; every realm still
  booting is stopped and the statement run until no row is left, corrected in round twenty-one,
  D21R1). C20R2 and C20R3 FIXED (see S20R2). C20R4 FIXED (see Q20R1). C20R5 FIXED (see L20R1).
- Q20R1 FIXED `7c8509713b` (with C20R4, M20R2, D20R5, L20R3 and T20R3: a row lock counts because
  taking one also takes a lock on its table, and a row the boot writes can wait on another
  transaction's uncommitted write of it (that clause dropped in round twenty-one, T21R8); the
  row-write claim is gone from DEPLOY, the contract and P12, and M19R4's disposition is corrected
  in this record). Q20R2 FIXED (see L20R1). Q20R3 FIXED `7c8509713b` (section L reads DEPLOY's
  order sentence, built from its own PARENTS list; the round-nineteen commits paragraph is
  corrected in this record). Q20R4 FIXED in the ledger (with L20R4: the three lines name round
  nineteen, when they changed). Q20R5 FIXED (see T20R1). Q20R6 and Q20R7 FIXED in this record:
  `80ee2487aa`'s body says the text derivation is replaced, which the next commit did, and
  `2323737f77`'s calls the bare-relation stop a sentence where it is a clause; both commits stay
  as they are. Q20R8 FIXED `7c8509713b` and in this record (DEPLOY's long token line and this
  record's long lines reflowed). Q20R9 FIXED in this record (round nineteen's table names the
  librarian's FAIL as should-fix only). Q20R10 NO CHANGE: only comments sit between the
  `auth_tokens` index create and its ALTER, so "the next statement" holds.
- H20R1 FIXED (see T20R1). H20R2 FIXED (see T20R2). H20R3 FIXED (see L20R1). H20R4 FIXED (see
  S20R2). H20R5 FIXED `7c8509713b` (the poll runs to a 5 s deadline). H20R6 FIXED `7c8509713b`
  (the boot queues behind a lock that conflicts with one it takes, any lock at all on the three
  parents, in DEPLOY, the contract and P12).
- S20R1 FIXED (see C20R1). S20R2 and S20R3 FIXED `7c8509713b` (with C20R2, C20R3, H20R4, S20R4
  and S20R5: an "After a stall" sub-bullet states the rule, that no request failed while a boot
  blocked `auth_tokens` is retried and one that wrote first keeps those writes and skips the
  rest, and gives one whole remedy, since the realm log names no account: sign every account out
  once, restart the realms one at a time in the quiet window (every realm stopped for it and
  started together, corrected in round twenty-two, C22R1), and re-run the deactivation housing
  receipt erase; S19R1's disposition is corrected in this record). S20R4 and S20R5 FIXED (see
  S20R2).
- D20R1 FIXED (see C20R1). D20R2 FIXED (see T20R1). D20R3 FIXED `7c8509713b` (the quiet check is
  a `pg_stat_activity` statement, read as several snapshots, that section L runs from DEPLOY and
  that shows the dump-shaped holder idle in transaction and the waiting boot). D20R4 FIXED (see
  L20R1). D20R5 FIXED (see Q20R1).
- T20R1 FIXED `7c8509713b` (with H20R1, D20R2 and Q20R5: each boot client's startup parameters
  carry no lock timeout, neither the config key nor `-c` in its options, with a control; a mutant
  that passes `lock_timeout` to the boot client fails). T20R2 FIXED `7c8509713b` (with H20R2: a
  fourth observation holds ACCESS SHARE on every table, as the dump does, and reads every lock
  the boot holds on any table of the schema, SHARE on `auth_tokens` alone; a mutant that locks a
  new table at the schema's head fails). T20R3 FIXED (see Q20R1; the claim it asked to pin is
  gone). T20R4 FIXED `7c8509713b` (the pool pins read the pool's own options).
- L20R1 FIXED `7c8509713b` (with Q20R2, C20R5, H20R3 and D20R4: "holding nothing on `characters`
  or `accounts` yet", and section L's comment reworded). L20R2 FIXED (see C20R1). L20R3 FIXED
  (see Q20R1). L20R4 FIXED (see Q20R4). L20R5 FIXED `7c8509713b` (DEPLOY's long token-runbook
  line reflowed; described in round twenty-one, L21R7). L20R6 FIXED in this record. L20R7 FIXED
  `7c8509713b` (the dangling "so" is gone). L20R8 FIXED `7c8509713b` (the evidence names the `ADD
  COLUMN` on all three tables, the correction named). L20R9 FIXED `7c8509713b` (the stall has its
  own sub-bullet).
- M20R1 FIXED (see C20R1). M20R2 FIXED (see Q20R1).

## Round twenty-one: eight fresh readers over round twenty (`30588ebb50..91462b8464`)

Round twenty-one's commits: `41abd4f842` (every boot that queues behind the dump stopped and
ended, by a statement section L runs until no row is left, a running boot taking the place and a
stopped one exiting; the quiet window as no players online, its check pinned on both sides and by
session kind and name; the stall's remedy with its timing (replaced in round twenty-two, C22R1),
the pending OAuth codes, failed actions sent again, the lost notice emails and a runnable receipt
erase, the sign-out run in section L; the row-write clause dropped; the contract, P12 and the
change log with it; kept whole for bisect, since section L reads the bullet), and the commit that
adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C21R1 to C21R6 |
| qa-checklist | PASS | Q21R1 to Q21R6 |
| server hot path | PASS | H21R1 to H21R8 |
| privacy and security | PASS | S21R1 to S21R4 |
| database performance | FAIL | D21R1 to D21R6 |
| test coverage | PASS | T21R1 to T21R8 |
| docs librarian | FAIL (should-fix only) | L21R1 to L21R7 |
| migration safety | PASS | M21R1 to M21R2 |

47 findings: one blocking (D21R1), 22 should-fix (C21R1, Q21R1 to Q21R4, H21R1 to H21R5, S21R1,
D21R2, D21R3, T21R1 to T21R4, L21R1 to L21R4, M21R1), 24 nice-to-have. The blocking finding was
round twenty's own route: ending one stalled boot hands the schema lock to the next realm still
booting, which queues in the same place; five readers found it, and the route now stops every
realm still booting and runs the statement until no row is left.

- C21R1 FIXED `41abd4f842` (with Q21R1 and H21R1: the step names DEPLOY's bullet that begins "A
  failed deactivation receipt erase", which gives the statements, and says a deactivation stopped
  at its revoke logged no warning). C21R2 FIXED (see D21R3). C21R3 FIXED (see M21R2). C21R4 FIXED
  (see S21R2). C21R5 FIXED (see D21R1). C21R6 FIXED (see T21R3).
- Q21R1 FIXED (see C21R1). Q21R2 FIXED `41abd4f842` (without a step beside it the boot is awaited
  unguarded, so a late failure fails the case). Q21R3 FIXED in this record (with L21R1: round
  nineteen's commits paragraph names round twenty's two corrections). Q21R4 FIXED in the ledger
  (with L21R3). Q21R5 FIXED (see T21R2). Q21R6 FIXED `41abd4f842` (the contract's two paths
  follow their own sentence).
- H21R1 FIXED (see C21R1). H21R2 FIXED (see D21R1). H21R3 FIXED `41abd4f842` (the poll reads this
  database's waits only). H21R4 NO CHANGE: `deleteUnusedFederatedProvision` runs only on the
  account a federated login provisioned in the same request and lost the link race for, so a
  sign-out makes no other account its candidate. H21R5 FIXED `41abd4f842` (the sign-out runs in
  the next quiet window, right before the first restart, and each restart brings a wave of
  logins; every realm is stopped for it and started together instead, corrected in round
  twenty-two, C22R1). H21R6 FIXED `41abd4f842` (the sign-out also deletes the pending OAuth and
  device codes). H21R7 FIXED (see M21R2). H21R8 FIXED (see T21R3).
- S21R1 FIXED `41abd4f842` (a request that failed before writing stays undone until it is sent
  again, and the sign-out applies no action: whoever saw an error checks whether the action
  landed and sends it again, a staff password reset that can leave its record without the new
  password among them; staff send a ban, suspension or staff password reset again even when it
  shows landed, corrected in round twenty-two, S22R1). S21R2 FIXED `41abd4f842` (with C21R4:
  nothing sends a skipped notice email again). S21R3 FIXED (see M21R2). S21R4 FIXED (see D21R1).
- D21R1 FIXED `41abd4f842` (with M21R1, C21R5, S21R4 and H21R2: stop every realm whose boot has
  not finished, then run the statement until it returns no row; section L queues a running boot
  and a stopped boot on the advisory lock behind the waiting one, ends it, sees the running one
  take its place and the stopped one exit, and ends the running one; C20R1's disposition is
  corrected in this record; that wording corrected in round twenty-two, L22R6). D21R2 FIXED
  `41abd4f842` (a realm with players online is quiet only with none online, or stopped, whatever
  a reading shows). D21R3 FIXED `41abd4f842` (with C21R2: a later table the core schema alters
  counts, `play_sessions` and `character_leases` among them). D21R4 FIXED `41abd4f842` (the
  sign-out deletes live tokens only and runs again on 40P01). D21R5 FIXED `41abd4f842` (the
  statement names `public.auth_tokens` and says it also ends any other session waiting for that
  lock). D21R6 FIXED `41abd4f842` (an `autovacuum worker` row counts too).
- T21R1 FIXED `41abd4f842` (the dump-shaped holder is still idle in its transaction after every
  terminate, and the last run returns no row). T21R2 FIXED `41abd4f842` (with Q21R5: section L
  mints a full and a companion token and runs DEPLOY's sign-out; a mutant that matches no live
  token fails). T21R3 FIXED `41abd4f842` (with C21R6 and H21R8: the check runs beside an idle
  session and under the dump's own name, reads session kind, name and state, and shows no row
  once the hold ends; a mutant without the open-transaction filter fails). T21R4 FIXED
  `41abd4f842` (the observations run over PARENTS: behind each, every earlier parent is held and
  no later one). T21R5 FIXED `41abd4f842` (the options read has a positive control). T21R6 FIXED
  `41abd4f842` (both token reads have the same 200 ms budget). T21R7 NO CHANGE: the bounds case
  reads `server/db.ts` with its comments stripped, so a comment cannot satisfy the pool pins.
  T21R8 FIXED `41abd4f842` (the clause about the boot's own row writes is dropped; the order
  shape covers a row the boot waits on; Q20R1's disposition is corrected in this record).
- L21R1 FIXED (see Q21R3). L21R2 FIXED in this record (M19R1 names H20R6's correction). L21R3
  FIXED (see Q21R4). L21R4 FIXED `41abd4f842` (the change log's nineteenth entry names round
  twenty's correction). L21R5 FIXED in this record (rounds sixteen to eighteen label the
  librarian's FAIL as should-fix only). L21R6 FIXED (see M21R2). L21R7 FIXED in this record
  (L20R5 names the reflowed token line).
- M21R1 FIXED (see D21R1). M21R2 FIXED `41abd4f842` (with C21R3, S21R3, H21R7 and L21R6: the
  remedy follows a stall that is over, its boot committed or its backend ended and its realm
  booted again after the dump (the remedy starts the stopped realms itself, corrected in round
  twenty-two, M22R1), and the dump route points to it; the C20R1 correction is D21R1's, corrected
  in round twenty-two, Q22R2).

## Round twenty-two: eight fresh readers over round twenty-one (`91462b8464..73967af7c6`)

Round twenty-two's commits: `9704a64ebf` (the stall's remedy: security actions sent again at once
whether or not they show landed, then every realm stopped, every account signed out and every
realm started together, so the in-memory desktop login codes go too and each boot is quiet (the
start replaced in round twenty-three, C23R3); the stopped realms wait for the dump's end and then
a quiet window or that remedy; the terminate names what it ends; the sign-out's OAuth deletes
pinned on seeded codes; the quiet statement pinned whole; the race after a terminate closed;
boots behind the later tables observed, the queueing clause narrowed (cut in round twenty-three,
D23R1) and the receipt-erase pointer read (named in round twenty-three, Q23R11); P12 and the
change log with it; kept whole for bisect, since section L reads the bullet), and the commit that
adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C22R1 to C22R4 |
| qa-checklist | PASS | Q22R1 to Q22R8 |
| server hot path | PASS | H22R1 to H22R7 |
| privacy and security | PASS | S22R1 to S22R3 |
| database performance | PASS | D22R1 to D22R4 |
| test coverage | FAIL | T22R1 to T22R6 |
| docs librarian | FAIL (should-fix only) | L22R1 to L22R7 |
| migration safety | PASS | M22R1 to M22R4 |

43 findings: one blocking (T22R2), 15 should-fix (C22R1, Q22R1, Q22R2, H22R1 to H22R3, S22R1,
S22R2, D22R1, T22R1, T22R3, T22R4, L22R1, M22R1, M22R2), 27 nice-to-have. The blocking finding
was round twenty-one's own pin: the sign-out case ran DEPLOY's OAuth deletes on empty tables, so
a sign-out without them passed; it now seeds a code of each kind. Five readers found the route's
own boots outside the quiet window round twenty-one tightened, so the remedy now stops every
realm and starts them together (the start replaced in round twenty-three, C23R3).

- C22R1 FIXED `9704a64ebf` (with H22R1, D22R1, S22R2, Q22R6 and L22R3: the remedy stops every
  realm and lets each finish shutting down, signs every account out, and starts every realm
  together; their boots line up on the schema advisory lock and finish before a signed-out client
  is back, so each boots quiet; replaced in round twenty-three, C23R3). C22R2 FIXED (see M22R1).
  C22R3 FIXED `9704a64ebf` (with D22R2: a later statement queues when its lock conflicts with one
  the boot holds or waits for, unless its transaction already holds a lock on that table; cut in
  round twenty-three, D23R1). C22R4 FIXED (see T22R2).
- Q22R1 FIXED in this record (round twenty's commits paragraph and summary name round
  twenty-one's corrections). Q22R2 FIXED in this record (D21R1 claims C20R1's correction, and
  M21R2 no longer does). Q22R3 FIXED in this record: `73967af7c6`'s body says each finding was
  disposed with its commit, where two are NO CHANGE and several were fixed in the record or
  ledger, and that superseded lines name round twenty-one, where it also adds round twenty's
  corrections; the commit stays as it is. Q22R4 FIXED in this record (round fifteen's and
  sixteen's database performance rows and round sixteen's migration safety row label their FAIL
  as should-fix only). Q22R5 FIXED (see T22R2). Q22R6 FIXED (see C22R1; the phrase is gone).
  Q22R7 FIXED (see M22R1). Q22R8 FIXED in the ledger (the dump route's defects are listed among
  what the QA found).
- H22R1 FIXED (see C22R1). H22R2 FIXED (see S22R1). H22R3 FIXED (see T22R1). H22R4 FIXED (see
  T22R2). H22R5 NO CHANGE: the remedy no longer takes a quiet reading before its boots, and a
  plain autovacuum that blocks a boot cancels itself after `deadlock_timeout`. H22R6 NO CHANGE:
  the sign-out now runs with every realm stopped, so its one pass over the table blocks no one.
  H22R7 FIXED `9704a64ebf` (the second and third boots are settled in the case's own `finally`).
- S22R1 FIXED `9704a64ebf` (with H22R2: right after the stall, staff send each ban, suspension or
  staff password reset that returned an error again, even when it shows landed, and a player
  changes a failed password change again; any other action is sent again only if it did not
  land). S22R2 FIXED (see C22R1; stopping every realm drops the desktop login codes the sign-out
  cannot reach). S22R3 FIXED `9704a64ebf` (with M22R4: the terminate returns each ended backend's
  pid and address, and a row means stop the realm at that address; section L pins the pid of
  each).
- D22R1 FIXED (see C22R1). D22R2 FIXED (see C22R3). D22R3 FIXED `9704a64ebf` (once the running
  boot takes the place, the stopped one still waits behind it; the advisory read matches the
  bigint key only). D22R4 FIXED `9704a64ebf` (neither the restart policy nor the watchdog can
  boot a stopped realm).
- T22R1 FIXED `9704a64ebf` (with M22R2 and H22R3: after each terminate the case waits until the
  ended backend holds no lock at all before it reads the next waiter). T22R2 FIXED `9704a64ebf`
  (with C22R4, Q22R5 and H22R4: the case seeds an authorization code and a device code, sees each
  table hold one, and after the sign-out sees both empty and the code unredeemable; a mutant
  without the OAuth deletes fails). T22R3 FIXED `9704a64ebf` (the quiet statement is pinned
  whole). T22R4 FIXED `9704a64ebf` (case 1 boots behind `play_sessions` and `character_leases`
  and sees the boot wait on each). T22R5 FIXED `9704a64ebf` (the case reads the receipt-erase
  pointer and finds that bullet). T22R6 FIXED `9704a64ebf` (three boot clients, and the next
  waiter is the running one's backend by its pid).
- L22R1 FIXED (see M22R1). L22R2 FIXED `9704a64ebf` ("releases the queue for now"). L22R3 FIXED
  (see C22R1). L22R4 FIXED `9704a64ebf` (the quiet window reads "a realm opens a transaction at
  any moment while players are online"). L22R5 FIXED `9704a64ebf` (P12 ends "once that backend is
  ended"; both described in round twenty-three, Q23R10). L22R6 FIXED in this record. L22R7 FIXED
  in the ledger.
- M22R1 FIXED `9704a64ebf` (with C22R2, Q22R7 and L22R1: the stopped realms stay stopped until
  the dump ends, then boot in a quiet window or by the stall remedy, which starts every realm).
  M22R2 FIXED (see T22R1). M22R3 FIXED `9704a64ebf` (a boot has not finished while its container
  status is anything but `healthy`). M22R4 FIXED (see S22R3).

## Round twenty-three: eight fresh readers over round twenty-two (`73967af7c6..393ac1a7b2`)

Round twenty-three's commits: `d7f5c83f66` (the stall remedy without timing claims: the stall is
over when its boot COMMITs or its backend is ended, staff resend every ban, suspension or staff
reset made during it, players redo what failed, and the restart waits for the dump's end and says
what a boot that is not quiet risks; the queueing clause cut to "can queue"; the terminate shows
an address without claiming it names a realm; an index-build caveat, with a progress check, for a
deadlock a probe confirmed; section L pins the terminate whole, every credential-shaped table,
the desktop codes' place, the receipt-erase pointer's place and the index-build deadlock; the
unit bounds case pins boot before listen; the admin suite pins a repeat ban, suspension and staff
reset; the change log with it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C23R1 to C23R5 |
| qa-checklist | PASS | Q23R1 to Q23R11 |
| server hot path | PASS | H23R1 to H23R6 |
| privacy and security | PASS | S23R1 to S23R2 |
| database performance | PASS | D23R1 to D23R4 |
| test coverage | PASS | T23R1 to T23R9 |
| docs librarian | FAIL (should-fix only) | L23R1 to L23R9 |
| migration safety | PASS | M23R1 to M23R3 |

49 findings: none blocking, 18 should-fix (C23R1, Q23R1, Q23R2, M23R1, M23R2, H23R1, H23R2,
D23R1, D23R2, T23R1 to T23R5, L23R1 to L23R4), 31 nice-to-have. The stall remedy's prose had
drawn a new precision fix every round since round nineteen, so its timing claims and its
conflict-rule exception are gone rather than refined again, and what remains is pinned or stated
as a boundary. A probe confirmed one pre-existing defect the round surfaced: a boot waiting on
the schema advisory lock deadlocks with a concurrent index build under it.

- C23R1 FIXED `d7f5c83f66` (with S23R1, Q23R7, L23R1 and T23R8: players redo what returned an
  error; the password detail is gone). C23R2 FIXED `d7f5c83f66` (a repeat runs its revoke and
  disconnect again, and a staff password reset repeats with the same password). C23R3 FIXED
  `d7f5c83f66` (with M23R1, M23R2, H23R1, H23R4, D23R2, Q23R9 and L23R5: the restart waits for
  the dump's end and no longer claims to be quiet; each boot after the first can meet the realms
  started before it, and a boot that loses exits and is restarted). C23R4 NO CHANGE: stopping a
  realm that has just finished its boot errs on the safe side for the queue, and its shutdown
  saves are the After an abort bullet's. C23R5 FIXED `d7f5c83f66` (staff resend every ban,
  suspension or staff password reset made during the stall, whether or not it returned an error,
  so an in-game one is covered).
- S23R1 FIXED (see C23R1). S23R2 FIXED `d7f5c83f66` (a sign-out undoes nothing a leftover token
  did before it, a login link it added among them).
- Q23R1 FIXED in the ledger (round twenty-one's line names round twenty-two). Q23R2 FIXED in this
  record (C22R1 lists Q22R6 and L22R3). Q23R3 FIXED in this record: a relabelled verdict row is
  named in the correcting round's disposition (Q22R4), as earlier rounds did. Q23R4 FIXED in this
  record: `393ac1a7b2`'s body names only the lines of rounds twenty and twenty-one it superseded;
  it also adds round twenty's notes of round twenty-one, moves the C20R1 claim, relabels rounds
  fifteen and sixteen's rows and corrects the ledger's round twenty-one line; the commit stays as
  it is. Q23R5 FIXED `d7f5c83f66` (with L23R6: the twenty-second change-log entry names the
  running boot). Q23R6 FIXED `d7f5c83f66` (with M23R2 and L23R9: the stall is over when its boot
  COMMITs or its backend is ended). Q23R7 FIXED (see C23R1). Q23R8 FIXED `d7f5c83f66` (with
  L23R2: a desktop app could still trade a code for a fresh token). Q23R9 FIXED (see C23R3).
  Q23R10 FIXED in this record (with L23R7). Q23R11 FIXED in this record.
- H23R1 FIXED (see C23R3). H23R2 FIXED `d7f5c83f66` in part (with D23R4): a probe on a scratch
  database and section L confirm that a concurrent index build under the schema advisory lock and
  a boot waiting on that lock deadlock, one of them aborted with 40P01; DEPLOY says so and gives
  a progress check before the next realm starts on a release that adds such an index; the code
  fix, a waiter that holds no snapshot, is owed to the maintainer (the ledger's OWED list). H23R3
  FIXED `d7f5c83f66` (the realms are stopped one after another, each stop finishing before the
  next). H23R4 FIXED (see C23R3). H23R5 NO CHANGE: the remedy no longer starts every realm at one
  moment. H23R6 NO CHANGE: each pg file runs on its own database, so the OAuth counts see only
  this file's rows.
- D23R1 FIXED `d7f5c83f66` (with T23R1: the clause is gone; later statements "can queue" behind
  the boot, which states no rule to misapply). D23R2 FIXED (see C23R3). D23R3 FIXED `d7f5c83f66`
  (with M23R3 and T23R5: the terminate shows its address without claiming it names a realm, and a
  row means stop every realm whose container is still not `healthy`). D23R4 FIXED in part (see
  H23R2; named in round twenty-four, L24R7).
- T23R1 FIXED (see D23R1). T23R2 FIXED `d7f5c83f66` (the terminate is pinned whole). T23R3 FIXED
  `d7f5c83f66` (every credential-shaped table is classified whole, and the desktop login codes
  are pinned to the process, with a control). T23R4 FIXED `d7f5c83f66` (tests/admin.test.ts
  repeats a ban, a suspension and a staff reset and sees each run its revoke and disconnect
  again). T23R5 FIXED (see D23R3). T23R6 NO CHANGE: tests/server/freehold_hearth_db.test.ts
  already pins that deploy/user-data.sh names no session. T23R7 FIXED `d7f5c83f66` (the pointer's
  bullet exists once, below the boot bullet). T23R8 FIXED (see C23R1). T23R9 FIXED `d7f5c83f66`
  (the unit bounds case pins that server/main.ts awaits ensureSchema before it listens, and
  DEPLOY's sentence saying so).
- L23R1 FIXED (see C23R1). L23R2 FIXED (see Q23R8). L23R3 FIXED in this record (S21R1 names
  S22R1). L23R4 FIXED in this record (M21R2 names M22R1). L23R5 FIXED (see C23R3). L23R6 FIXED
  (see Q23R5). L23R7 FIXED (see Q23R10). L23R8 FIXED in this record and the ledger (round
  twenty-one's timing lines name round twenty-two). L23R9 FIXED (see Q23R6).
- M23R1 FIXED (see C23R3; the deliberate hold it proposed is not added, since the remedy no
  longer claims the boots line up). M23R2 FIXED (see C23R3 and Q23R6: the start waits for the
  dump's end). M23R3 FIXED (see D23R3).

## Round twenty-four: eight fresh readers over round twenty-three (`393ac1a7b2..c30e830de4`)

Round twenty-four's commits: `9458280c1f` (every realm's start gated on the schema advisory lock,
read once the realm before it is healthy, and pinned in section L on both sides; the index-build
bullet states the runner's order, which waiter deadlocks, which side loses and what an aborted
build leaves, and the owed fix as a waiter with no transaction open; the stall's restart goes by
that gate, and its end, resend order, side effects and sign-in links are stated; the sign-out
clears Discord link states; the credential pin reads secret-shaped columns; the desktop module's
imports pinned whole; the index-build deadlock in two forced orders, the runner's lock pinned by
text and value; the runner pinned after listen; a real-module repeat ban and suspension; the
Realms bullet and two notes that a booting realm holds nothing corrected; the change log with it;
kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C24R1 to C24R6 |
| qa-checklist | PASS | Q24R1 to Q24R8 |
| server hot path | PASS | H24R1 to H24R5 |
| privacy and security | PASS | S24R1 to S24R3 |
| database performance | FAIL | D24R1 to D24R5 |
| test coverage | FAIL | T24R1 to T24R10 |
| docs librarian | FAIL (should-fix only) | L24R1 to L24R10 |
| migration safety | PASS | M24R1 to M24R3 |

50 findings: two blocking (T24R1, D24R1), 21 should-fix (C24R1, C24R2, S24R1, Q24R1 to Q24R3,
H24R1 to H24R3, M24R1, L24R1 to L24R4, T24R2 to T24R7, D24R2), 27 nice-to-have. Both blocking
findings were round twenty-three's own gate: the build-progress view reads 0 before a build,
between builds and during a drop, and section L read it only at 0; the gate is now the schema
advisory lock, read at 2 while a runner holds it and a waiter queues and at 0 after. The
credential pin by table name had let four tables escape, a Discord link state among them, so it
now reads secret-shaped columns.

- C24R1 FIXED `9458280c1f` (with Q24R1, H24R2, L24R3, M24R2 and D24R1: the gate is the schema
  advisory lock, read once the realm before is healthy, on two readings; section L reads it at 2
  while a runner holds the lock and a waiter queues, and at 0 before and after; a mutant naming
  another lock reads 0 and fails). C24R2 FIXED `9458280c1f` (staff remove any sign-in link its
  owner did not add from each account a password change or staff reset named during the stall;
  replaced by a stated boundary and an owed recovery in round twenty-five, S25R1). C24R3 FIXED
  (see D24R3). C24R4 FIXED (see T24R1). C24R5 FIXED `9458280c1f` (the stall is over once its boot
  COMMITs or the dump route's terminate, run again, returns no row; replaced by the stall-over
  reading in round twenty-five, C25R1, noted in round twenty-six, Q26R3). C24R6 FIXED `9458280c1f`
  (with S24R3: resends go in the order made, skipping one a later reversal undid; a repeat sends
  its notice email again and writes a second audit row; a suspension is resent with its original
  end time).
- S24R1 FIXED `9458280c1f` (with T24R6: the sign-out deletes `discord_oauth_states`, section L
  seeds a link row and sees it gone, and the credential pin reads secret-shaped columns, so that
  table and three more are classified). S24R2 FIXED `9458280c1f` (the wallet challenge is spent
  only with a live bearer, and a wallet link signs nobody in). S24R3 FIXED (see C24R6).
- Q24R1 FIXED (see C24R1). Q24R2 FIXED (see T24R1). Q24R3 FIXED in this record (H23R2 names
  D23R4, and C23R3 names M23R2). Q24R4 FIXED `9458280c1f` (the restart waits for the dump only
  when the stall was behind one). Q24R5 FIXED `9458280c1f` and in the ledger (with T24R3, L24R9
  and L24R10: section L's second order uses a runner-shaped waiter, a session lock outside a
  transaction; the OWED item says the runner's comment that a waiting boot holds nothing is what
  the probe refutes). Q24R6 FIXED in this record: `c30e830de4`'s body names only superseded
  lines, though it also adds C22R1's cross-references, L22R4 and L22R5's descriptions and the
  commits paragraph's additions; the commit stays as it is. Q24R7 FIXED `9458280c1f` (players
  redo what returned an error and did not land). Q24R8 NO CHANGE: "FIXED ... in part" stays, its
  owed half named in the ledger's OWED list.
- H24R1 FIXED `9458280c1f` (with M24R1, D24R2 and L24R8: the gate applies to every start of a
  realm on a database, not only a release that adds an index, and the stall's restart goes by it;
  an index build a stopped realm began runs on). H24R2 FIXED (see C24R1). H24R3 FIXED (see
  T24R1). H24R4 FIXED `9458280c1f` (with T24R4: each order's cleanup unlocks the runner before it
  rolls the waiter back). H24R5 FIXED (see D24R3).
- M24R1 FIXED (see H24R1). M24R2 FIXED (see C24R1). M24R3 FIXED (see T24R2).
- L24R1 FIXED `9458280c1f` (the Realms bullet says the advisory lock does not make starting
  several at once safe, and points to the boot bullet). L24R2 FIXED `9458280c1f` (the rollback
  note says a booting realm holds no table lock but a snapshot an index build waits on). L24R3
  FIXED (see C24R1). L24R4 FIXED in this record and the ledger (round twenty-two's lines that
  round twenty-three replaced name it). L24R5 FIXED `9458280c1f` ("both deadlock paths (Deadlocks
  above)"). L24R6 FIXED `9458280c1f` ("holding no table lock"). L24R7 FIXED in this record. L24R8
  FIXED (see H24R1). L24R9 FIXED (see Q24R5). L24R10 FIXED (see Q24R5).
- T24R1 FIXED `9458280c1f` (with C24R4, Q24R2 and H24R3: the gate is read at 2 while a runner
  holds the lock and a waiter queues, and at 0 before and after; a mutant gate reads 0 and
  fails). T24R2 FIXED `9458280c1f` (with M24R3 and D24R4: two orders, a boot already waiting
  losing to a quick build, and a runner that waited past its own check outlasting the build,
  whose index is then INVALID until the runner rebuilds it). T24R3 FIXED (see Q24R5). T24R4 FIXED
  (see H24R4). T24R5 FIXED `9458280c1f` (the runner's blocking session lock on
  `SCHEMA_ADVISORY_LOCK_KEY`, 0x574f4301, is pinned by its text and value). T24R6 FIXED (see
  S24R1). T24R7 FIXED `9458280c1f` (tests/moderation_db.test.ts runs a ban twice and a suspension
  twice through the real module and sees each write its UPDATE, with no already-applied guard,
  and its audit row). T24R8 FIXED `9458280c1f` (the desktop module's imports are pinned whole).
  T24R9 FIXED `9458280c1f` (the unit bounds case pins that the runner starts after listen).
  T24R10 FIXED `9458280c1f` (the Cost header re-measured at 7.9 s with both orders).
- D24R1 FIXED (see C24R1). D24R2 FIXED (see H24R1). D24R3 FIXED `9458280c1f` (with C24R3 and
  H24R5: the bullet says the runner builds one after another, that only a waiter that began
  before the build's last wait deadlocks, which side loses by `deadlock_timeout`, and what an
  aborted build leaves). D24R4 FIXED (see T24R2). D24R5 FIXED `9458280c1f` and in the ledger (the
  owed fix waits with no transaction open, polling a session-level try-lock).

## Round twenty-five: eight fresh readers over round twenty-four (`c30e830de4..83cfd9c546`)

Round twenty-five's commits: `7171f7717a` (every realm start the file gives, the first included,
goes by the schema advisory lock gate, and the release, rollback, ledger-ceiling and dump steps
point to it; the quiet window points to it too; the gate bullet gives the runner's whole hold, a
stopped build running on, a start after the first meeting serving realms, a diagnosis when a
reading stays above 0, and the owed fix's shape; the stall is over when no session holds or waits
for ACCESS EXCLUSIVE on `auth_tokens`; the stall bullet's account recovery stated as a boundary,
owed; section L crosses both waiter kinds with both timings, retries a quick order once, shows a
stopped build holding the lock to its end, reads the stall-over check, the gate, its diagnosis
and the progress view, pins the runner's lock order with comments stripped, and rebuilds its
index in a finally; the unit case pins the runner's catch and the cross-references; the repeat
moderation case pins each whole UPDATE; two server comments that a waiting boot holds nothing
corrected; the change log with it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C25R1 to C25R8 |
| qa-checklist | PASS | Q25R1 to Q25R7 |
| server hot path | PASS | H25R1 to H25R5 |
| privacy and security | PASS | S25R1 to S25R4 |
| database performance | PASS | D25R1 to D25R3 |
| test coverage | PASS | T25R1 to T25R9 |
| docs librarian | FAIL (should-fix only) | L25R1 to L25R6 |
| migration safety | PASS | M25R1 to M25R3 |

45 findings: none blocking, 15 should-fix (S25R1, Q25R1, Q25R2, M25R1, L25R1, L25R2, H25R1, C25R1
to C25R3, D25R1, T25R1 to T25R4), 30 nice-to-have. The stall bullet's account aftermath had drawn
a new item from a reader in each of the last four rounds (a sign-in link, its order, a recovery
email, how to find the accounts), so it is now a stated boundary with its recovery owed, rather
than another list. The gate had been applied site by site, so it is now one rule for every start
the file gives, the first included.

- S25R1 FIXED `7171f7717a` (with S25R2, C25R2 and C25R3, S25R2 added in round twenty-six, Q26R2:
  the stall bullet states that a sign-out undoes nothing a leftover token did before it, a sign-in
  link it added or a recovery email it set among them, that the bullet does not recover such an
  account, and that this recovery is owed; the ledger's OWED list carries it). S25R2 FIXED (see
  S25R1). S25R3 FIXED `7171f7717a` (the accounts reason names its unsubscribe token). S25R4 FIXED
  `7171f7717a` (with C25R7 and M25R3: a suspension whose end time has passed is skipped).
- Q25R1 FIXED in this record (H24R1 names L24R8). Q25R2 FIXED `7171f7717a` (with L25R1: the quiet
  window and the dump route's quiet branch start each realm by Index builds; the quiet window
  reworded in round twenty-six, L26R3, and only the dump route's first boot in a quiet window,
  L26R2). Q25R3 FIXED `7171f7717a` ("the runner's later indexes and VALIDATE"). Q25R4 FIXED
  `7171f7717a` (with H25R4: each quick order gets one retry). Q25R5 FIXED `7171f7717a` (with T25R5
  and C25R8: no dynamic import or require, with a control; a store behind ./auth is stated as
  beyond the pin). Q25R6 FIXED (see T25R2). Q25R7 FIXED in this record: `83cfd9c546`'s body says
  each finding was disposed with its commit, where Q24R8 is NO CHANGE and four were fixed in the
  record; the commit stays as it is.
- M25R1 FIXED `7171f7717a` (with C25R5, D25R1 and L25R5: every start of a realm the file gives,
  the first included, goes by the gate; release step 6 and the rollback say so). M25R2 FIXED
  `7171f7717a` (the case rebuilds its index in a finally). M25R3 FIXED (see S25R4).
- L25R1 FIXED (see Q25R2). L25R2 FIXED `7171f7717a` (the ledger ceiling's start goes one at a time
  by Index builds). L25R3 FIXED `7171f7717a` (with C25R4, D25R2 and T25R6: a realm's stop or crash
  does not end a build already running, and an early end is this deadlock, a cancelled or
  terminated backend or a database restart; section L closes a waiting build's client and sees the
  build hold the lock to its end, valid; four server comments still said a stop or crash ends a
  build until round twenty-six, L26R1). L25R4 FIXED `7171f7717a` and in the ledger (with T25R9:
  the runner's and the receipts helper's comments say a waiting boot holds a snapshot; the growth
  budget's note sits inside a SQL fragment's function body, where a comment change would change
  the boot's DDL, so it stays, named in the OWED item). L25R5 FIXED (see M25R1). L25R6 FIXED
  `7171f7717a` (a start after the first runs beside the realms already serving, outside the quiet
  window, and the Realms bullet points to it).
- H25R1 FIXED `7171f7717a` (a diagnosis statement lists the holder and the waiter and what they
  wait on: never end the holder; a build waiting for old snapshots waits for the oldest open
  transaction; section L reads it at a holder and a waiter; the advice replaced in round
  twenty-six by a decision on the holder's wait, C26R2). H25R2 FIXED `7171f7717a` (the runner
  holds the lock through its drops, builds and the VALIDATE, with their bounds). H25R3 NO CHANGE:
  setting `deadlock_timeout` per session needs a superuser, which the CI role need not be. H25R4
  FIXED (see Q25R4). H25R5 FIXED `7171f7717a` (the waiter's client is taken inside the try).
- C25R1 FIXED `7171f7717a` (the stall is over once no session holds or waits for ACCESS EXCLUSIVE
  on `auth_tokens`; section L reads that statement at 1 behind a held `characters` lock and behind
  a held `auth_tokens` lock, and at 0 with no boot; widened in round twenty-six to every mode that
  blocks a token write, C26R1). C25R2 FIXED (see S25R1). C25R3 FIXED (see S25R1). C25R4 FIXED (see
  L25R3). C25R5 FIXED (see M25R1). C25R6 FIXED `7171f7717a` ("can deadlock"; a waiter that began
  before the build's last wait does, a clause removed in round twenty-six, C26R3). C25R7 FIXED
  (see S25R4). C25R8 FIXED (see Q25R5).
- D25R1 FIXED (see M25R1). D25R2 FIXED (see L25R3). D25R3 FIXED `7171f7717a` and in the ledger
  (the owed fix polls in short statements of its own, idle between them, and the gate would then
  see a waiter only once it holds the lock).
- T25R1 FIXED `7171f7717a` (the unit bounds case pins the runner's start with the catch that logs
  and keeps serving; section L's quick runner-shaped order shows a runner losing). T25R2 FIXED
  `7171f7717a` (with Q25R6: the repeat case pins each whole UPDATE and its title says what it
  pins; tests/admin.test.ts already pins that a repeat runs its revoke and disconnect). T25R3
  FIXED `7171f7717a` (the orders cross both waiter kinds with both timings). T25R4 FIXED
  `7171f7717a` (the runner's source is read with comments stripped, and its acquire, loop,
  VALIDATE and unlock are pinned in order). T25R5 FIXED (see Q25R5). T25R6 FIXED (see L25R3).
  T25R7 FIXED `7171f7717a` (the progress view reads 0 while the gate reads 2). T25R8 FIXED
  `7171f7717a` (the bounds case pins the quiet window line, the Index builds line and the Realms
  pointer). T25R9 FIXED (see L25R4).

## Round twenty-six: eight fresh readers over round twenty-five (`83cfd9c546..da3685142b`)

Round twenty-six's commits: `5df3f2f243` (the stall is over once no session holds or waits for a
lock on `auth_tokens` that blocks a token write, every mode that conflicts with a write's ROW
EXCLUSIVE, on two readings; the sign-out also clears GitHub link states; the boundary's items are
examples; the gate's diagnosis adds each holder's phase, the sessions it waits for and their
address, and the holder's wait decides what to do; a build, a stopped realm's included, may be
cancelled, and after a rollback a carcass no runner names is dropped by hand; the runner's bounds
name their waits and its retire step; the stop-or-crash claim names
`client_connection_check_interval`; the gate covers every operator start, the last reading just
before it; release step 6 builds before its readings; every realm start the file gives points to
the gate, and the dump route's first boot is the quiet one; four server comments, two test
comments and two desktop docs corrected, two comments rewrapped; section L reads the stall
reading's modes off the server and reads it behind a writer, reads the diagnosis on a stalled boot
and on a build at its wait, cancels a stopped build and drops the carcass, rebuilds a lost build's
index through the runner, times a run with nothing to build and counts retries; the unit case
lists every start site whole; the change log with it; kept whole for bisect), and the commit that
adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C26R1 to C26R6 |
| qa-checklist | PASS | Q26R1 to Q26R5 |
| server hot path | PASS | H26R1 to H26R6 |
| privacy and security | PASS | S26R1 to S26R3 |
| database performance | PASS | D26R1 to D26R5 |
| test coverage | PASS | T26R1 to T26R9 |
| docs librarian | FAIL (should-fix only) | L26R1 to L26R7 |
| migration safety | PASS | M26R1 to M26R3 |

44 findings: none blocking, 15 should-fix (C26R1, C26R2, Q26R1, Q26R2, L26R1, L26R2, H26R1, H26R2,
M26R1, M26R2, T26R1 to T26R3, D26R1, D26R2), 29 nice-to-have. The stall-over reading had missed a
lock mode, so its modes are now read off PostgreSQL's own conflicts with a token write and pinned
whole; the restart sites had drawn one more each round, so the unit case now lists every start
site the file gives in the phrasings it scans (narrowed in round twenty-seven, L27R6), whole, and
fails a new one until it points to the gate. Every runtime claim the readers asked to see was
observed on PostgreSQL 16 first: a boot queued for SHARE behind an open write, a revoke failing
57014 behind it, the widened reading at 1 where the old one read 0, the diagnosis on that boot and
on a build at its wait for old snapshots (blocked by a REPEATABLE READ session and never by an
idle READ COMMITTED writer, which holds no snapshot), and a stopped realm's build cancelled, the
lock freed and the index INVALID.

- C26R1 FIXED `5df3f2f243` (with Q26R1, H26R2, D26R1, L26R6 and S26R3: the stall is over once no
  session holds or waits for a lock on `auth_tokens` that blocks a token write, the modes that
  conflict with ROW EXCLUSIVE, on two readings a few seconds apart (taken with every realm
  `healthy` or stopped from round twenty-seven, C27R3); section L holds each mode in turn and
  tries a write's lock to read those modes off the server, pins the statement's list to them,
  reads 2 behind each parent and 1 behind an open write, where counting ACCESS EXCLUSIVE alone
  reads 0, and sees a token write fail 57014 there). C26R2 FIXED `5df3f2f243` (with H26R1, M26R1,
  M26R2 and D26R2: the diagnosis adds `phase`, `blocked_by` and `client_addr` (`client_addr`
  dropped in round twenty-seven, C27R2), and the holder's wait decides: on `relation` a boot
  behind the dump goes by The nightly dump, else its `blocked_by` sessions end; on `virtualxid` a
  build or a drop waits for its `blocked_by` sessions, each a writer or locker of its table or an
  older snapshot, which an idle READ COMMITTED transaction does not hold (corrected in round
  twenty-seven, L27R5); only an `idle in transaction` session from no realm's address is ended (an
  operator's `psql` session alone from round twenty-seven, C27R2); a build may be cancelled, a
  stopped realm's included, changing no rows and leaving its index INVALID; after a rollback
  DEPLOY's drop removes a carcass no runner names; section L reads the diagnosis on a stalled boot
  and on a build at its wait, cancels a stopped build with DEPLOY's statement, and runs the drop).
  C26R3 FIXED `5df3f2f243` (with D26R4: the clause on which waiter deadlocks is gone, and the
  losing build is named by its last wait). C26R4 FIXED `5df3f2f243` (the runner drops any index it
  replaces). C26R5 FIXED (see T26R2). C26R6 FIXED `5df3f2f243` (release step 6 builds, every
  service from round twenty-seven, Q27R1, then takes the readings just before `up -d`, and the
  gate's last reading comes just before every start).
- Q26R1 FIXED (see C26R1; C25R1's disposition notes the widening). Q26R2 FIXED in this record
  (S25R1's list names S25R2). Q26R3 FIXED in this record (C24R5 notes its replacement in round
  twenty-five, C25R1). Q26R4 FIXED `5df3f2f243` (the unit case pins the quiet window's new
  clause). Q26R5 FIXED (see L26R7).
- L26R1 FIXED `5df3f2f243` (the runner's, the registry's, the metrics and the admin index
  comments, and two test comments, name the early ends DEPLOY names and say a realm's own stop or
  crash leaves its build running; L25R3's disposition notes it). L26R2 FIXED `5df3f2f243` (the
  dump route boots the first stopped realm in a quiet window). L26R3 FIXED `5df3f2f243` (the quiet
  window is quiet realms outside the dump, one shutdown before the next boot, and a start in it
  still goes by Index builds). L26R4 FIXED (see T26R3). L26R5 FIXED `5df3f2f243` (the gate covers
  every start an operator makes by the file; a restart by the restart policy or the watchdog
  cannot wait for it and can meet the deadlock). L26R6 FIXED (see C26R1). L26R7 FIXED `5df3f2f243`
  (with Q26R5: both comments rewrapped).
- H26R1 FIXED (see C26R2). H26R2 FIXED (see C26R1). H26R3 FIXED `5df3f2f243` (with D26R3: the
  bounds name each create's wait behind a VACUUM, an ANALYZE or DDL, a build's waits for writers
  and older snapshots, the dump among them, and a drop's wait for every locker). H26R4 FIXED
  `5df3f2f243` (a start after the first is still outside the nightly dump). H26R5 FIXED
  `5df3f2f243` (the stall-over readings ride the parents loop, two boots fewer, and bootBehind
  keeps its must-finish check unless its caller lets the boot fail). H26R6 FIXED `5df3f2f243` (the
  snapshot client is taken inside the try, and the cleanup runner runs only once the gate reads 0,
  so a lock still held fails the reads after it instead of hanging).
- M26R1 FIXED (see C26R2). M26R2 FIXED (see C26R2). M26R3 FIXED (see T26R3).
- T26R1 FIXED `5df3f2f243` (after the four orders the index a lost build left reads INVALID, the
  gate 0, and the runner drops it and builds it again). T26R2 FIXED `5df3f2f243` (with C26R5: the
  diagnosis on a build at its wait reads `Lock`, `virtualxid`, the phase and the snapshot's pid).
  T26R3 FIXED `5df3f2f243` (with L26R4 and M26R3: every `docker compose` start of the game service
  and every operator restart in DEPLOY's phrasings is listed whole, and its paragraph, bullet or
  code block points to Index builds (the bot's own `up` exempt only with `--no-deps` from round
  twenty-seven, C27R1); the SES, community test, API dispatch, Freeholds flag, storage price and
  bot start sites gained the pointer). T26R4 FIXED `5df3f2f243` (both quick orders needing their
  retry fails). T26R5 FIXED `5df3f2f243` (with D26R5: the stopped-build order reads
  `client_connection_check_interval` as 0, and DEPLOY names it). T26R6 FIXED `5df3f2f243` (a
  runner run with nothing to build takes under 5 s; under 1 s with every registry index keeping
  its oid from round twenty-seven, C27R6). T26R7 FIXED `5df3f2f243` (the unsubscribe handler and
  the two statements it runs are pinned whole). T26R8 FIXED `5df3f2f243` (the late orders wait
  `deadlock_timeout` plus 500 ms). T26R9 FIXED `5df3f2f243` (the screen sees `createRequire`, with
  a control).
- D26R1 FIXED (see C26R1). D26R2 FIXED (see C26R2). D26R3 FIXED (see H26R3). D26R4 FIXED (see
  C26R3). D26R5 FIXED (see T26R5).
- S26R1 FIXED `5df3f2f243` (the boundary's items are examples, what the live session did in game
  among them). S26R2 FIXED `5df3f2f243` (the sign-out clears `github_oauth_states`; section L
  seeds a row and sees it cleared, and the classification says so). S26R3 FIXED (see C26R1).

## Round twenty-seven: eight fresh readers over round twenty-six (`da3685142b..ee273d2411`)

Round twenty-seven's commits: `9a729218d5` (a held build's sessions are named by DEPLOY's own
reading, and only an operator's `psql` session left `idle in transaction` is ended, with
`pg_terminate_backend`; the diagnosis drops `client_addr`; a cancel for a start that cannot wait
is barred while the nightly dump runs; nothing else is ended but the dump route's boot and a
build; the stall readings are taken with every realm `healthy` or stopped; an INVALID index is
listed for the rollback drop, outside the dump, no realm started until the drop returns; an early
end leaves an index INVALID or none, written only once its build got past `building index`;
release step 6 builds every service; the bot's own `up` runs `--no-deps`; the community profile
and the storage prices recreate the game container; two server comments and a test comment on
write upkeep corrected; touched paragraphs reflowed; section L terminates an open psql session a
held build waits for, lists and drops a carcass, cancels a serving realm's runner, reads a
runner's drop at `virtualxid`, shows an idle READ COMMITTED transaction is not waited for, keeps
every registry oid on a run with nothing to build, and runs its cleanup only after a failed order;
the unit suite pins the bot's dependency and every reader of the unsubscribe token; the change log
with it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C27R1 to C27R6 |
| qa-checklist | PASS | Q27R1 to Q27R5 |
| server hot path | PASS | H27R1 to H27R5 |
| privacy and security | PASS | S27R1 to S27R3 |
| database performance | PASS | D27R1 to D27R5 |
| test coverage | FAIL | T27R1 to T27R7 |
| docs librarian | PASS | L27R1 to L27R9 |
| migration safety | PASS | M27R1 to M27R4 |

44 findings: one blocking (T27R1), 14 should-fix (C27R1 to C27R3, Q27R1, H27R1 to H27R3, D27R1,
T27R2, T27R3, M27R1, M27R2, L27R1, L27R2), 29 nice-to-have. The blocking finding is the start-site
scan's bot exemption: the bot depends on the game service, so its own `up` started a stopped
realm, which the scan let through. Six readers (corrected in round twenty-eight, L28R5) found that
the diagnosis said which session to end but gave no reading that names one and only a cancel,
which does nothing to an idle session; the rule is now a positive one (an operator's `psql`
session alone), read and ended by DEPLOY's own statements in section L. Five found the stall
readings could fall in a restart's gap. A run with nothing to build was measured at 9 to 11 ms.

- C27R1 FIXED `9a729218d5` (with M27R2 and T27R1: both bot `up` sites run `--no-deps`, and the
  unit scan exempts only a bot `restart` or a bot `up --no-deps`, pinning the bot's `depends_on:
  game` with controls; T26R3's disposition notes it). C27R2 FIXED `9a729218d5` (with H27R1, D27R1,
  L27R1, S27R3 and T27R2: DEPLOY's reading names each session the holder waits for by pid,
  `application_name` and state; only an operator's `psql` session left `idle in transaction` is
  ended, with `pg_terminate_backend`, a cancel doing nothing to an idle session; the diagnosis
  drops `client_addr`; section L reads the open psql session a held build waits for and terminates
  it, and the build ends valid; C26R2's disposition notes it; on two readings, by the named
  session's pid, from round twenty-eight, S28R1). C27R3 FIXED `9a729218d5` (with H27R3, D27R5,
  L27R2 and S27R2: the stall readings are taken while every realm container reads `healthy` or is
  stopped; C26R1's disposition notes it; read in `sudo docker compose ps --all` from round
  twenty-eight, L28R1). C27R4 FIXED `9a729218d5` (with Q27R2: DEPLOY lists INVALID indexes for the
  rollback drop, outside the dump, and no realm starts until the drop returns; section L runs the
  listing; a hand drop that does not return is named by its pid from round twenty-eight, T28R4).
  C27R5 FIXED `9a729218d5` (with M27R4, D27R3 and L27R3: an index ended early is INVALID or absent
  (absent if still queued for its table lock, from round twenty-eight, T28R2; worded so in round
  twenty-nine, D29R4), kept up by writes only once its build got past `building index`; two server
  comments and a test comment say so). C27R6 FIXED `9a729218d5` (with Q27R3, H27R5 and T27R3: a
  run with nothing to build keeps every registry index's oid and takes under 1 s; T26R6's
  disposition notes it).
- Q27R1 FIXED `9a729218d5` (with M27R1: release step 6 builds every service with a build section,
  the wiki's among them; C26R6's disposition notes it). Q27R2 FIXED (see C27R4). Q27R3 FIXED (see
  C27R6). Q27R4 FIXED in this record (S25R1 and C24R5 name the round twenty-six findings that
  edited them). Q27R5 FIXED (see L27R4).
- H27R1 FIXED (see C27R2). H27R2 FIXED `9a729218d5` (a build is cancelled for a start that cannot
  wait only while the nightly dump is not running). H27R3 FIXED (see C27R3). H27R4 FIXED
  `9a729218d5` (with T27R4: the cleanup runner runs only after a failed order, and the rebuild
  after the rollback drop is read at once). H27R5 FIXED (see C27R6).
- S27R1 FIXED `9a729218d5` (the unit suite lists every mention of the token's column and lookup in
  server/, per file, whole). S27R2 FIXED (see C27R3). S27R3 FIXED (see C27R2).
- D27R1 FIXED (see C27R2). D27R2 FIXED `9a729218d5` (a build waits for each session until its
  transaction ends, an idle READ COMMITTED one whose statement was running when the wait began
  included; that one can be waited for, from round twenty-eight, T28R3). D27R3 FIXED (see C27R5).
  D27R4 FIXED `9a729218d5` (with L27R9: the receipts VALIDATE also waits on `relation`, giving up
  at its own lock timeout). D27R5 FIXED (see C27R3).
- T27R1 FIXED (see C27R1). T27R2 FIXED (see C27R2). T27R3 FIXED (see C27R6). T27R4 FIXED (see
  H27R4). T27R5 NO CHANGE: `bootBehind`'s finally already awaits the boot after the holder's
  release, so a failing `during` waits for the boot to end before its error leaves, and no case
  holds a boot's lock elsewhere. T27R6 FIXED `9a729218d5` (a serving realm's runner whose build
  DEPLOY's cancel ends rejects with 57014, and the gate reads 0 with the old snapshot still open).
  T27R7 FIXED `9a729218d5` (an idle READ COMMITTED transaction beside a held build is not in its
  `blocked_by`, and a runner's drop reads `virtualxid` with a null `phase` (worded so in round
  twenty-eight, Q28R6), waiting for a reader of its table).
- M27R1 FIXED (see Q27R1). M27R2 FIXED (see C27R1). M27R3 FIXED `9a729218d5` (with L27R7: the
  community profile, its rollback and the storage price override recreate the game container with
  `up -d game`, a restart keeping the old `.env` value; with `--no-deps` from round twenty-eight,
  M28R2). M27R4 FIXED (see C27R5).
- L27R1 FIXED (see C27R2). L27R2 FIXED (see C27R3). L27R3 FIXED (see C27R5). L27R4 FIXED
  `9a729218d5` (with Q27R5: nothing else is ended, the dump route's boot and a build being the
  named exceptions). L27R5 FIXED in this record (C26R2 says an idle READ COMMITTED transaction
  holds no snapshot). L27R6 FIXED in this record and in the ledger (the scan lists the start sites
  in the phrasings it scans; round twenty-six's summary and the ledger's round twenty-six entry
  note it). L27R7 FIXED (see M27R3). L27R8 FIXED `9a729218d5` (the touched paragraphs reflowed).
  L27R9 FIXED (see D27R4).

## Round twenty-eight: eight fresh readers over round twenty-seven (`ee273d2411..a430d838ad`)

Round twenty-eight's commits: `5c37d09029` (DEPLOY: the four Discord keys the game reads too have
the game recreated first, by the gate, then the bot; every recreate after an `.env` edit (worded
so in round twenty-nine, L29R9) runs `up -d --no-deps game`, stated once in Index builds, never
while an image built for a coming release waits; the naming statement adds `idle_for` and names
the sessions waited for now, one at a time on `virtualxid`; an operator's `psql` session is ended
by the pid named for it, on two readings with `idle_for` growing, an operator's own named by
`pg_backend_pid()` and its work run again; a hand drop that does not return is named by its pid,
the gate read again before each; a build ended still queued for its table lock leaves no index; a
running statement's session can be waited for to its transaction's end; the stall readings read
`sudo docker compose ps --all`; step 6 gives a fallback when a build other than the game's fails;
the bot's release caveat recreates it; the community rollback names its one flag; section L names
two open sessions one at a time, shows a cancel leaves an idle session as it was, holds a READ
COMMITTED statement running at the wait, drops by hand past a gate at 0, cancels builds before
`building index` and in their table lock queue, reads realm sessions' empty `application_name`,
and pins the diagnosis whole; the unit suite pins step 6's build services, the health probe, the
gate's own recreate site and the bot exemption both ways, and counts the token's readers in code
only; Cost 12.9 s; the change log with it; kept whole for bisect), and the commit that adds this
section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C28R1 to C28R6 |
| qa-checklist | PASS | Q28R1 to Q28R9 |
| server hot path | PASS | H28R1 to H28R5 |
| privacy and security | PASS | S28R1 to S28R2 |
| database performance | PASS | D28R1 to D28R4 |
| test coverage | PASS | T28R1 to T28R12 |
| docs librarian | PASS | L28R1 to L28R6 |
| migration safety | PASS | M28R1 to M28R4 |

48 findings: none blocking, 7 should-fix (C28R1, S28R1, T28R1 to T28R5), 41 nice-to-have. Five
readers (corrected in round twenty-nine, L29R3) came back with no should-fix and every reader
passed. The test-coverage reader's five gaps are each now a real-PostgreSQL order in section L or
a unit pin; a session in `idle in transaction (aborted)` was observed to hold no lock at all, so
the terminate rule needs no case for it.

- C28R1 FIXED `5c37d09029` (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` and
  `DISCORD_BOT_SECRET` reach the game too, so after changing one the game is recreated first, by
  the gate, then the bot; the unit scan lists that start site; its reason stated in round
  twenty-nine, C29R4). C28R2 FIXED (see S28R1). C28R3 FIXED (see T28R2). C28R4 FIXED (see T28R3).
  C28R5 FIXED (see L28R1). C28R6 FIXED (see M28R1).
- Q28R1 FIXED `5c37d09029` (with T28R7: the stale comment is gone). Q28R2 FIXED in the ledger (its
  round twenty-six entry names round twenty-seven's narrowing). Q28R3 FIXED (see T28R3). Q28R4
  FIXED (see D28R1). Q28R5 FIXED `5c37d09029` (the comment rewrapped). Q28R6 FIXED `5c37d09029`
  and in this record (the null `phase` is named as the column in the test and in T27R7). Q28R7
  FIXED `5c37d09029` (with H28R4, M28R3 and T28R8: the runner-shaped drop is awaited in the
  finally with its rejection caught). Q28R8 FIXED (see L28R1). Q28R9 FIXED (see M28R1).
- H28R1 FIXED (see L28R1). H28R2 FIXED (see D28R1). H28R3 FIXED (see S28R1). H28R4 FIXED (see
  Q28R7). H28R5 FIXED `5c37d09029` (if a build other than the game's fails, step 6 builds the
  game, starts it by the gate and builds the rest afterwards; running the rebuilt service on its
  new image from round twenty-nine, H29R2).
- S28R1 FIXED `5c37d09029` (with C28R2 and H28R3: a session is ended by the pid the naming
  statement returns for it, never the holder's, only if it reads `psql` and `idle in transaction`
  on two readings a few seconds apart, the new `idle_for` growing; `SELECT pg_backend_pid();`
  names each of your own sessions, which you COMMIT or ROLLBACK instead; whoever left one open
  runs its work again, a sign-out included; C27R2's disposition notes it (round twenty-nine,
  L29R2); `idle_for` grown by the whole time between the readings from round twenty-nine, T29R1,
  and the sign-out committed before any realm starts and rerun from the stop if undone, S29R1).
  S28R2 NO CHANGE: a session in `idle in transaction (aborted)` has already released its locks
  (observed on PostgreSQL 16: no row in `pg_locks`, and another session took ACCESS EXCLUSIVE on
  the table at once), so it never blocks a build, a drop or a boot.
- D28R1 FIXED `5c37d09029` (with H28R2 and Q28R4: the naming statement names the sessions waited
  for now, one at a time on `virtualxid`, read again once one ends; section L names two open psql
  sessions one after the other). D28R2 FIXED (see T28R3). D28R3 FIXED (see T28R2). D28R4 FIXED
  (see T28R4).
- T28R1 FIXED `5c37d09029` (the serving runner's session and the realm pool's read an empty
  `application_name`, so no realm session reads `psql`). T28R2 FIXED `5c37d09029` (with C28R3 and
  D28R3: an early end leaves none if still queued for its table lock (worded so in round
  twenty-nine, D29R4); section L cancels a build at `waiting for writers before build`, INVALID
  and not ready, and one queued on `relation`, no index, and reads a cancel at its wait for old
  snapshots as ready; C27R5's disposition notes it (round twenty-nine, L29R2)). T28R3 FIXED
  `5c37d09029` (with C28R4, D28R2 and Q28R3: "can be waited for"; section L holds a READ COMMITTED
  psql session's statement running when the wait begins, lets it end, and the build still waits on
  the session, named `idle in transaction`, until DEPLOY's terminate; D27R2's disposition notes it
  (round twenty-nine, L29R2)). T28R4 FIXED `5c37d09029` (with D28R4 and M28R4, M28R4 added in
  round twenty-nine, Q29R3: a hand drop waits on `virtualxid` with the gate at 0, the naming
  statement with its pid names an open psql reader, DEPLOY's terminate ends it and the drop
  returns; DEPLOY says so and reads the gate again before each drop; C27R4's disposition notes it
  (round twenty-nine, L29R2); the drop's pid found by DEPLOY's own lookup from round twenty-nine,
  H29R1). T28R5 FIXED `5c37d09029` (the unit case pins DEPLOY's `healthy` sentence and the game
  health probe's `/livez`, beside the pin of `ensureSchema` before `listen`; the probe read inside
  the game's healthcheck from round twenty-nine, T29R3). T28R6 FIXED `5c37d09029` (a cancel leaves
  the open session as it was and the gate at 1). T28R7 FIXED (see Q28R1). T28R8 FIXED (see Q28R7).
  T28R9 FIXED `5c37d09029` (the token's readers are counted in code with comments stripped, and
  the handler's slice is bounded). T28R10 FIXED `5c37d09029` (the bot exemption has a negative and
  a positive control). T28R11 FIXED `5c37d09029` (the diagnosis statement is pinned whole). T28R12
  FIXED `5c37d09029` (step 6's `sudo docker compose build` and compose's build services, the game
  and the wiki, are pinned).
- M28R1 FIXED `5c37d09029` (with C28R6 and Q28R9: the community rollback sets
  `PROVISION_TEST_ACCOUNTS=0` and names no Rift refill, nor portals from round twenty-nine,
  M29R5). M28R2 FIXED `5c37d09029` (every recreate after an `.env` edit (worded so in round
  twenty-nine, L29R9) runs `up -d --no-deps game`, and Index builds states once that `--no-deps`
  keeps `up` from recreating the database, never while an image built for a coming release waits;
  M27R3's disposition notes it (round twenty-nine, L29R2)). M28R3 FIXED (see Q28R7). M28R4 FIXED
  (see T28R4).
- L28R1 FIXED `5c37d09029` (with C28R5, Q28R8 and H28R1: the stall readings read `healthy` or
  `Exited` in `sudo docker compose ps --all`; C27R3's disposition notes it (round twenty-nine,
  L29R2); the stall-over reading also `Created` for one never started from round thirty-four,
  C34R1, noted in round thirty-five, Q35R3). L28R2 FIXED `5c37d09029` (step 6 gives its reason:
  `up -d` runs each service on its new image). L28R3 FIXED `5c37d09029` (the bot's release caveat
  recreates it with `--no-deps`; a restart keeps its old image; by the bot's guarded line once the
  realm is verified, a lever-stopped bot left stopped, from round thirty-three, S33R2, noted in
  round thirty-four, Q34R2). L28R4 FIXED in this record (round twenty-seven's dispositions name
  the earlier text each edited: C27R1, C27R2, C27R3, C27R6, Q27R1 and L27R6, the ledger's note by
  Q28R2; listed in round twenty-nine, Q29R5). L28R5 FIXED in this record (six readers; round
  twenty-seven's summary notes it (round twenty-nine, L29R2)). L28R6 FIXED `5c37d09029` (the dump
  route's statement ends any other waiter for that lock with it).

## Round twenty-nine: eight fresh readers over round twenty-eight (`a430d838ad..84ea7d4b8d`)

Round twenty-nine's commits: `e8582aacc9` (DEPLOY: the sign-out runs in psql's default autocommit
so it has committed before any realm starts, and one a terminate or a ROLLBACK undid runs again
from the stop of every realm; a hand drop's pid comes from DEPLOY's own lookup from another
session; `idle_for` must grow by the whole time between the two readings; the bot's first start
recreates the game first, by the gate, then starts the bot alone; step 6 recreates the bot on the
new image, and the bot's own recreate, which runs the game's image, is barred while an image built
for a coming release waits (worded so in round thirty, L30R7; moved after the verification in
round thirty, H30R1, noted in round thirty-one, Q31R6); the key order gives its reason; the step 6
fallback runs a rebuilt service on its new image; a recreate may stop the game before its
readings, and its rule covers an `.env` edit outside a release; the community bullet drops the
retired flag's history and the portal clause; section L reads `idle_for` grow and start over,
finds the hand drop's pid by DEPLOY's lookup, takes every session inside its try and catches the
running statement; the unit suite reads each compose service's own block for the shared Discord
keys, the shared image, the wiki's one dependency and the game's `/livez` probe, and exempts a
`--no-deps` start of any service but the game; the change log with it; kept whole for bisect), and
the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C29R1 to C29R7 |
| qa-checklist | PASS | Q29R1 to Q29R8 |
| server hot path | PASS | H29R1 to H29R7 |
| privacy and security | PASS | S29R1 to S29R2 |
| database performance | PASS | D29R1 to D29R4 |
| test coverage | FAIL | T29R1 to T29R5 |
| docs librarian | PASS | L29R1 to L29R9 |
| migration safety | PASS | M29R1 to M29R6 |

48 findings: one blocking (T29R2), 15 should-fix (C29R1, C29R2, S29R1, L29R1 to L29R5, Q29R1,
Q29R2, H29R1, H29R2, D29R1, M29R1, T29R1), 32 nice-to-have. Seven readers (corrected in round
thirty, L30R3) found the hand drop's pid had no source, and the lookup one of them gave is now
DEPLOY's and section L's. The blocking finding was a compose claim a test could reach and none
did: the keys the bot and the game share are now read from each service's own environment block.

- C29R1 FIXED (see H29R1). C29R2 FIXED (see H29R2). C29R3 FIXED (see M29R4). C29R4 FIXED
  `e8582aacc9` (the key order gives its reason: while only one of the two runs with a new
  `DISCORD_BOT_SECRET`, every call the bot makes is rejected, and the game goes first because its
  start waits on the gate and the bot's does not; C28R1's disposition notes it (round thirty,
  L30R1)). C29R5 FIXED (see M29R5). C29R6 FIXED (see T29R1). C29R7 FIXED `e8582aacc9` (step 6 then
  runs the bot on the new image on a host that runs it; the unit list has that site; moved after
  the verification and guarded in round thirty, H30R1).
- Q29R1 FIXED (see L29R3). Q29R2 FIXED (see H29R1). Q29R3 FIXED in this record (T28R4 names
  M28R4). Q29R4 FIXED (see L29R9). Q29R5 FIXED in this record (L28R4 lists the dispositions it
  edited). Q29R6 FIXED `e8582aacc9` (with H29R4, H29R5, M29R6 and T29R4: `psqlSession` ends its
  client on a failed setup, the second session and the hand drop's reader are taken inside their
  `try`, and the running statement's outcome is caught in the `finally` and read as `locked` by
  `finish`). Q29R7 FIXED (see T29R3). Q29R8 FIXED (see H29R2).
- H29R1 FIXED `e8582aacc9` (with C29R1, Q29R2, D29R1, L29R5, S29R2 and M29R2: `SELECT pid FROM
  pg_stat_activity WHERE state = 'active' AND query LIKE 'DROP INDEX CONCURRENTLY%';` from another
  psql session gives a hand drop's pid; section L pins it whole and finds the drop's pid by it;
  T28R4's disposition notes it (round thirty, L30R1); scoped to this database's `psql` sessions
  from round thirty, S30R2). H29R2 FIXED `e8582aacc9` (with C29R2, M29R3, L29R7 and Q29R8: the
  step 6 fallback runs a rebuilt service on its new image, the wiki with `up -d --no-deps
  mediawiki`, which starts no realm; the unit scan exempts a `--no-deps` start of any service but
  the game, with controls, and pins the wiki's one dependency; the recreate rule covers an `.env`
  edit outside a release; H28R5's disposition notes it (round thirty, L30R1); the exemption
  narrowed to the bot and the wiki in round thirty, T30R3). H29R3 FIXED `e8582aacc9` (the
  running-statement order no longer repeats the stop's gate reading). H29R4 FIXED (see Q29R6).
  H29R5 FIXED (see Q29R6). H29R6 FIXED `e8582aacc9` (a recreate may stop the game first, then take
  the readings, then run its `up`). H29R7 FIXED (see M29R4).
- S29R1 FIXED `e8582aacc9` (the sign-out runs in psql's default autocommit with no BEGIN, so it
  has committed before any realm starts, and one a terminate or a ROLLBACK undid runs again from
  that bullet's stop of every realm, since the realm whose boot waited on it starts serving first;
  S28R1's disposition notes it (round thirty, L30R1); checked from a new session from round
  thirty, S30R1). S29R2 FIXED (see H29R1).
- D29R1 FIXED (see H29R1). D29R2 FIXED (see T29R1). D29R3 FIXED `e8582aacc9` (the test comment
  says the session can be waited for, here because its snapshot is the only old one). D29R4 FIXED
  in this record (C27R5 and T28R2 read "absent if" and "leaves none if").
- T29R1 FIXED `e8582aacc9` (with C29R6 and D29R2: DEPLOY asks that `idle_for` grow by the whole
  time between the two readings; section L reads it grow by at least 0.25 s across a 300 ms sleep
  between two readings (worded so in round thirty, C30R5), then start over once the session runs a
  statement; S28R1's disposition notes it (round thirty, L30R1); measured against its `open_for`
  from round thirty, D30R1). T29R2 FIXED `e8582aacc9` (blocking: the unit case reads each compose
  service's environment block, with game-only and bot-only controls, and pins that the keys the
  bot and the game both read are exactly the four DEPLOY names, and DEPLOY's sentence; the `.env`
  variables both read pinned from round thirty, T30R1). T29R3 FIXED `e8582aacc9` (with Q29R7: the
  `/livez` probe is read inside the game service's healthcheck; T28R5's disposition notes it
  (round thirty, L30R1)). T29R4 FIXED (see Q29R6). T29R5 FIXED `e8582aacc9` (the bot's image line
  equals the game's, pinned).
- M29R1 FIXED (see L29R1). M29R2 FIXED (see H29R1). M29R3 FIXED (see H29R2). M29R4 FIXED
  `e8582aacc9` (with C29R3, H29R7 and L29R6: the bot runs the game's image, so its `up` starts
  whatever image the tag names now: not while an image built for a coming release waits). M29R5
  FIXED `e8582aacc9` (with C29R5 and L29R4: the community rollback no longer names portals;
  M28R1's disposition notes it (round thirty, L30R1)). M29R6 FIXED (see Q29R6).
- L29R1 FIXED `e8582aacc9` (with M29R1: the bot's first start recreates the game first, by the
  gate, then starts the bot alone with `--no-deps`; the unit list has both sites). L29R2 FIXED in
  this record (round twenty-eight's dispositions name the round twenty-seven text they edited).
  L29R3 FIXED in this record (with Q29R1: five readers; round twenty-eight's summary notes it
  (round thirty, L30R1)). L29R4 FIXED (see M29R5). L29R5 FIXED (see H29R1). L29R6 FIXED (see
  M29R4). L29R7 FIXED (see H29R2). L29R8 FIXED `e8582aacc9` (the Rift sentence states the rule,
  not the retired flag). L29R9 FIXED in this record and in the ledger (with Q29R4: every recreate
  after an `.env` edit; M28R2's disposition and round twenty-eight's commit summary note it (round
  thirty, L30R1)).

## Round thirty: eight fresh readers over round twenty-nine (`84ea7d4b8d..af61694c86`)

Round thirty's commits: `74d696701d` (DEPLOY: from a new psql session, one count over every table
the sign-out clears must read 0 before any realm starts, else the sign-out is committed or run
again; a left-open session is ended only when its `idle_for` grew by exactly as much as its
`open_for` across two readings in psql's default autocommit; the drop lookup reads only this
database's `psql` sessions; the bot's recreate leaves step 6 for after the verification, guarded
to run only where the bot runs, and the rollback says what that leaves; the escalation levers
carry the image bar; the recreate rule's parenthetical names the bot; section L pins the sign-out
check whole, reads the exact gap between `open_for` and `idle_for` hold and then move, and names
the hand drop `psql`; the unit suite pins the `.env` variables the bot and the game share, the
bot's command, the wiki block's end, and an exemption for the bot and the wiki alone; the
community pin refuses the retired flag's name and reads the Rift sentence; the change log with it;
kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C30R1 to C30R6 |
| qa-checklist | PASS | Q30R1 to Q30R8 |
| server hot path | PASS | H30R1 to H30R7 |
| privacy and security | PASS | S30R1 to S30R2 |
| database performance | PASS | D30R1 to D30R3 |
| test coverage | PASS | T30R1 to T30R6 |
| docs librarian | PASS | L30R1 to L30R7 |
| migration safety | PASS | M30R1 to M30R5 |

44 findings: none blocking, 9 should-fix (S30R1, L30R1 to L30R3, D30R1, H30R1, H30R2, T30R1,
T30R2), 35 nice-to-have. Every reader passed, and three (correctness, qa-checklist and migration
safety) came back with no should-fix.

- C30R1 FIXED (see D30R1). C30R2 FIXED (see S30R2). C30R3 FIXED (see L30R2). C30R4 FIXED (see
  Q30R1). C30R5 FIXED in this record (T29R1 reads "at least 0.25 s across a 300 ms sleep"). C30R6
  FIXED (see L30R7).
- Q30R1 FIXED in the ledger (with C30R4 and L30R6: the round twenty-nine entry says the bot's
  first start recreates the game first, by its gate, and every bot recreate keeps to the game's
  image). Q30R2 FIXED (see L30R3). Q30R3 FIXED in this record: `af61694c86`'s body leaves out
  C27R5's rewording with T28R2; the commit stays as it is. Q30R4 FIXED in this record (the
  back-pointers round twenty-nine added to round twenty-eight's dispositions name the round).
  Q30R5 FIXED (see T30R1). Q30R6 FIXED (see T30R3). Q30R7 FIXED (see S30R2). Q30R8 FIXED (see
  L30R2).
- H30R1 FIXED `74d696701d` (with H30R2, H30R7, M30R1, M30R4 and L30R4: the bot's recreate leaves
  step 6 for after the verification, guarded by the bot container's running state, so it never
  starts a bot where none runs; the rollback says a rollback before it leaves the bot on the older
  image, and with `COMPOSE_PROFILES=discord` runs that line again after it; C29R7's disposition
  notes it (round thirty-one, L31R2), and round twenty-nine's commits paragraph (round thirty-two,
  L32R4); the line runs after any rollback, and a profile host stops a lever-stopped bot again,
  from round thirty-one, H31R2 and M31R1). H30R2 FIXED (see H30R1). H30R3 FIXED (see S30R2). H30R4
  FIXED (see D30R1). H30R5 FIXED `74d696701d` (with L30R5: the escalation levers carry the image
  bar; the third, a stop, open even then from round thirty-one, H31R3). H30R6 FIXED (see T30R3).
  H30R7 FIXED (see H30R1).
- S30R1 FIXED `74d696701d` (DEPLOY reads, from a new psql session, one count over every table the
  sign-out clears and requires 0 before any realm starts, else the sign-out is committed or run
  again; section L pins the statement whole, reading above 0 before the sign-out and 0 after;
  S29R1's disposition notes it (round thirty-one, L31R2); read against a sign-out still open in
  its own session from round thirty-one, T31R2; a count above 0 also read as a realm still
  running, stopped, then the count read again, from round thirty-one, S31R2, noted in round
  thirty-two, Q32R5). S30R2 FIXED `74d696701d` (with C30R2, D30R2, H30R3, M30R3 and Q30R7: the
  drop lookup reads only this database's `psql` sessions; section L names its hand drop `psql` and
  takes the drop's pid from the polled lookup; H29R1's disposition notes it (round thirty-one,
  L31R2); run on the realm database, D31R3, and shown to leave a runner's drop out, C31R5, in
  round thirty-one).
- D30R1 FIXED `74d696701d` (with C30R1, H30R4 and T30R4: a session is ended only when, on two
  readings taken in psql's default autocommit, its `idle_for` grew by exactly as much as its
  `open_for`; section L reads the exact gap between them unchanged across two readings and moved
  once the session runs a statement, its `idle_for` then above 0 and below the first reading;
  T29R1's disposition notes it (round thirty-one, L31R2); worded as `open_for` less `idle_for` the
  same on both readings in round thirty-one, D31R2). D30R2 FIXED (see S30R2). D30R3 FIXED
  `74d696701d` (the test comment says a virtualxid wait lasts until the transaction ends).
- T30R1 FIXED `74d696701d` (with Q30R5: the `.env` variables both compose blocks read are pinned,
  the image tag and the same four, with a bot-only control; T29R2's disposition notes it (round
  thirty-one, L31R2); unbraced variables read and no `env_file` pinned from round thirty-one,
  T31R6, noted in round thirty-two, Q32R6). T30R2 FIXED `74d696701d` (the community pin refuses
  the retired flag's name in any form and reads the Rift sentence whole). T30R3 FIXED `74d696701d`
  (with Q30R6, H30R6 and M30R2: the exemption names only the bot and the wiki, with a negative
  control for postgres; H29R2's disposition notes it (round thirty-one, L31R2)). T30R4 FIXED (see
  D30R1). T30R5 FIXED `74d696701d` (the bot block runs `node dist-bot/bot.cjs`, pinned). T30R6
  FIXED `74d696701d` (the wiki's block is read to stop before the top-level `volumes:`).
- M30R1 FIXED (see H30R1). M30R2 FIXED (see T30R3). M30R3 FIXED (see S30R2). M30R4 FIXED (see
  H30R1). M30R5 FIXED (see L30R2).
- L30R1 FIXED in this record (round twenty-nine's dispositions name the round twenty-eight text
  they edited). L30R2 FIXED `74d696701d` (with C30R3, M30R5 and Q30R8: a release's step 6 starts
  every service outside a profile with `up -d`, and the bot once the realm is verified (the
  profile host named in round thirty-one, L31R3); the recreate's stop-first form is no longer a
  second parenthetical). L30R3 FIXED in this record (with Q30R2: seven readers). L30R4 FIXED (see
  H30R1). L30R5 FIXED (see H30R5). L30R6 FIXED (see Q30R1). L30R7 FIXED in this record (with
  C30R6: the round twenty-nine paragraph says step 6 recreates the bot on the new image and only
  the bot's own recreate is barred).

## Round thirty-one: eight fresh readers over round thirty (`af61694c86..77e279a5da`)

Round thirty-one's commits: `ffc36d2487` (DEPLOY: after any rollback the bot's guarded line runs,
moving a running bot to the image the game now runs; the bot paragraph says it runs the older
image beside the new game until the verification, and that on a host whose `.env` sets
`COMPOSE_PROFILES=discord` step 6's `up -d` has already started it, a lever-stopped one included,
to stop again by that lever; the first two escalation levers carry the image bar and the third, a
stop, is open even then; the recreate rule's parenthetical names the profile host; a sign-out
check above 0 also means a realm still runs, and the count is read again; the yardstick reads
`open_for` less `idle_for` the same on both; the lookup runs on the realm database; section L
holds a sign-out open in its own session against a new session, pins the check's and the
yardstick's wording, and shows the scoped lookup leaves a runner's drop out; the unit suite pins
the bot line's place after the verification, its guard, its container, the new sentences and the
absence of an `env_file`, and reads unbraced variables too; the change log with it; kept whole for
bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C31R1 to C31R6 |
| qa-checklist | PASS | Q31R1 to Q31R7 |
| server hot path | PASS | H31R1 to H31R5 |
| privacy and security | PASS | S31R1 to S31R2 |
| database performance | PASS | D31R1 to D31R3 |
| test coverage | PASS | T31R1 to T31R6 |
| docs librarian | PASS | L31R1 to L31R6 |
| migration safety | PASS | M31R1 to M31R3 |

38 findings: none blocking, 13 should-fix (C31R1, Q31R1, H31R1 to H31R3, S31R1, D31R1, L31R1,
L31R2, M31R1, T31R1 to T31R3), 25 nice-to-have, every reader passing. Five readers found the
profile host's step 6 starting a lever-stopped bot; DEPLOY now says so where the bot is moved. One
reader noted, outside 07a, that no server code prunes expired `auth_tokens` rows, which belongs to
that table's owner.

- C31R1 FIXED (see M31R1). C31R2 FIXED (see L31R3). C31R3 FIXED (see S31R2). C31R4 FIXED (see
  T31R2). C31R5 FIXED `ffc36d2487` (with T31R5: the scoped lookup returns no row while a runner's
  drop waits, which the same lookup without its `psql` scope finds; S30R2's disposition notes it
  (round thirty-two, L32R3)). C31R6 FIXED (see D31R2).
- Q31R1 FIXED (see T31R1). Q31R2 FIXED `ffc36d2487` and in the ledger (the manifest's and the
  ledger's round thirty entries say step 6's `up -d` moves the bot first where `.env` sets
  `COMPOSE_PROFILES=discord`). Q31R3 FIXED (see M31R1). Q31R4 FIXED (see H31R2). Q31R5 FIXED (see
  T31R2 and T31R3). Q31R6 FIXED in this record (the round twenty-nine paragraph notes the move
  after the verification). Q31R7 FIXED in this record: `77e279a5da`'s body leaves out its Q30R1,
  L30R3, L30R7 and C30R5 edits; the commit stays as it is.
- H31R1 FIXED (see M31R1). H31R2 FIXED `ffc36d2487` (with Q31R4: after any rollback the bot's
  guarded line runs, moving a running bot to the image the game now runs and skipping one that
  does not run; H30R1's disposition notes it (round thirty-two, L32R3)). H31R3 FIXED `ffc36d2487`
  (with L31R4: the first two levers carry the image bar, and the third, a stop, starts no image
  and is open even then; H30R5's disposition notes it (round thirty-two, L32R3); lifted only as
  the first two levers run it from round thirty-two, H32R2). H31R4 FIXED (see S31R2). H31R5 FIXED
  `ffc36d2487` (the bot paragraph says the bot runs the older image beside the new game until the
  realm is verified; only on a host without the profile from round thirty-two, C32R4).
- S31R1 NO CHANGE: starting an email change re-checks the account's current password
  (`handleAccountEmailChange` in `server/account.ts`), which a leftover token's holder after a
  password change or a staff reset does not have, so a leftover token alone starts no such
  request; the credential pin already classifies `email_change_requests` so. S31R2 FIXED
  `ffc36d2487` (with C31R3 and H31R4: a check above 0 means the sign-out has not committed or a
  realm on the database still runs; that realm is stopped, the sign-out committed in its own
  session if it is still open or else run again, and the count read again; S30R1's disposition
  notes it (round thirty-two, Q32R5); a transaction still open committed first, the sign-out run
  again in autocommit either way, the count read from a new session while every realm is `Exited`,
  and a waiting rerun's holder named, from round thirty-two, S32R1 and D32R2).
- D31R1 FIXED (see T31R2). D31R2 FIXED `ffc36d2487` (with C31R6 and L31R6: the rule reads
  `open_for` grown by those seconds and `open_for` less `idle_for` the same on both readings, the
  form section L reads, with no dangling "a few seconds"; D30R1's disposition notes it (round
  thirty-two, L32R3)). D31R3 FIXED `ffc36d2487` (the lookup runs from a psql session on the realm
  database; S30R2's disposition notes it (round thirty-two, L32R3)).
- T31R1 FIXED `ffc36d2487` (with Q31R1 and T31R4: the unit case pins that step 6's block names no
  bot, that the guarded line sits after the verify block, the bot's container name, the rollback,
  profile-host, lever and parenthetical sentences whole, and the Environment keys heading above
  the levers; the guarded line placed after the verify block's last command and the rollback from
  round thirty-two, T32R1). T31R2 FIXED `ffc36d2487` (with D31R1, C31R4, M31R2 and Q31R5: section
  L holds the sign-out open in its own session, which reads 0, while a new session reads the full
  count and then 0 once it commits, and pins the check's wording; round thirty-one's evidence said
  the old read came from another session, which the pool did not guarantee; S30R1's disposition
  notes it (round thirty-two, L32R3)). T31R3 FIXED `ffc36d2487` (with Q31R5: section L pins the
  yardstick sentence). T31R4 FIXED (see T31R1). T31R5 FIXED (see C31R5). T31R6 FIXED `ffc36d2487`
  (neither block has an `env_file`, and the variable reader also sees an unbraced `$VAR`, with a
  control; T30R1's disposition notes it (round thirty-two, Q32R6); one reader for the control and
  both blocks, comments stripped first, from round thirty-two, T32R2).
- M31R1 FIXED `ffc36d2487` (with C31R1, H31R1, L31R1 and Q31R3: the bot paragraph says that on a
  host whose `.env` sets `COMPOSE_PROFILES=discord` step 6's `up -d` has already started the bot
  on the new image, a lever-stopped one included, and to stop it again by that lever right after
  step 6 while the lever holds; H30R1's disposition notes it (round thirty-two, L32R3); after
  every `up -d` that names no service, a rollback's included, before the guarded line, from round
  thirty-two, C32R1). M31R2 FIXED (see T31R2). M31R3 FIXED (see L31R3).
- L31R1 FIXED (see M31R1). L31R2 FIXED in this record (round thirty's dispositions name the round
  twenty-nine text they edited). L31R3 FIXED `ffc36d2487` (with C31R2 and M31R3: the recreate
  rule's parenthetical names the profile host; L30R2's disposition notes it (round thirty-two,
  L32R3); the guarded line credited with the bot elsewhere from round thirty-two, C32R3). L31R4
  FIXED (see H31R3). L31R5 FIXED in this record (the blank line before the round twenty-nine
  heading is back). L31R6 FIXED (see D31R2).

## Round thirty-two: eight fresh readers over round thirty-one (`77e279a5da..849bdabe79`)

Round thirty-two's commits: `9dea958302` (DEPLOY: a sign-out check above 0 commits a transaction
still open in the sign-out's own session, stops every realm still running and runs the sign-out
again in autocommit either way, reading again from a new session while every realm container is
`Exited`, and the session a waiting rerun waits on is named by the naming statement (worded so in
round thirty-three, Q33R3); on a host whose `.env` sets `COMPOSE_PROFILES=discord` every `up -d`
that names no service starts the bot, so a lever-stopped one is stopped again after each, before
the guarded line; the third lever is lifted only as the first two run it, never by `start` or
`restart`; the Enabling sentence names both forms of the profile; the recreate rule's
parenthetical credits the guarded line; section L ends by the rerun a token signed in after the
commit, names a rerun's holder from its pid, runs the lookup from another database, and rolls back
only a transaction it opened; the `Cost:` header is re-measured (by a reading that left out the
file's hooks; 13.3 s from round thirty-three, T33R1); the unit suite places the bot line after the
rollback, pins the third lever as the stop and the new sentences, refuses an `env_file`, an
`extends` or a merge key in either block (worded so in round thirty-three, Q33R6), and reads
compose variables through one comment-free reader; the change log with it; kept whole for bisect),
and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C32R1 to C32R4 |
| qa-checklist | PASS | Q32R1 to Q32R8 |
| server hot path | PASS | H32R1 to H32R4 |
| privacy and security | PASS | S32R1 to S32R2 |
| database performance | PASS | D32R1 to D32R2 |
| test coverage | PASS | T32R1 to T32R8 |
| docs librarian | PASS | L32R1 to L32R7 |
| migration safety | PASS | M32R1 to M32R4 |

39 findings: none blocking, 15 should-fix (C32R1, Q32R1, Q32R2, H32R1, H32R2, S32R1, D32R1, L32R1
to L32R3, M32R1, M32R2, T32R1 to T32R3), 24 nice-to-have, every reader passing. Six readers found
a rollback started with `up -d` restarting a lever-stopped bot on a profile host, and five the
sign-out check's else looping on a COMMIT with no transaction open: DEPLOY now states one rule for
every start that names no service, and runs the sign-out again either way. From this round a
forward note goes only on the latest disposition whose description a later change makes stale, and
the disposition of that change names it back; earlier dispositions reach it through that chain,
and an in-place note or back-pointer names the round and finding that added it.

- C32R1 FIXED `9dea958302` (with Q32R1, H32R1, M32R2, L32R2 and S32R2: on a host whose `.env` sets
  `COMPOSE_PROFILES=discord` every `up -d` that names no service starts the bot, a lever-stopped
  one included, step 6's and a rollback's started that way, so while that lever holds the bot is
  stopped again right after each such start, before the guarded line; M31R1's disposition notes
  it; the profile read as `discord` in `COMPOSE_PROFILES` from round thirty-three, C33R2 (named so
  in round thirty-four, Q34R4); the lever read as it held before the start from round thirty-four,
  Q34R1). C32R2 FIXED (see H32R2). C32R3 FIXED `9dea958302` (with H32R4 and L32R7: the recreate
  rule's parenthetical says the guarded line moves a running bot elsewhere once the realm is
  verified, not step 6; L31R3's disposition notes it; to the game's image after the verification
  and any rollback from round thirty-three, L33R2). C32R4 FIXED `9dea958302` (the bot runs the
  older image beside the new game until the verification only on a host without the profile in
  `.env`; H31R5's disposition notes it).
- Q32R1 FIXED (see C32R1). Q32R2 FIXED (see S32R1). Q32R3 FIXED in this record: `ffc36d2487`'s
  body leaves out its S31R2, D31R2, D31R3 and L31R3 edits, section L's yardstick and scoped-lookup
  pins, and the unit suite; the commit stays as it is. Q32R4 FIXED in this record: `849bdabe79`'s
  body leaves out its Q31R6 edit to round twenty-nine's paragraph; the commit stays as it is.
  Q32R5 FIXED in this record (S30R1 notes S31R2's change, and S31R2 names it back). Q32R6 FIXED in
  this record (T30R1 notes T31R6's change, and T31R6 names it back). Q32R7 FIXED (see L32R4).
  Q32R8 FIXED `9dea958302` (with L32R5: the change log's round thirty entry names round thirty-one
  for its in-place wording).
- H32R1 FIXED (see C32R1). H32R2 FIXED `9dea958302` (with C32R2 and M32R3: the third lever is
  lifted only as the first two levers run it, with the bot's `--no-deps` up and not while an image
  built for a coming release waits, never by `start` or `restart`, which revive the stopped
  container on the image it was created from; H31R3's disposition notes it; every start of the bot
  named as lifting the lever from round thirty-three, S33R1). H32R3 FIXED (see S32R1). H32R4 FIXED
  (see C32R3).
- S32R1 FIXED `9dea958302` (with D32R1, Q32R2, M32R1, L32R1, H32R3 and T32R8: a check above 0
  first commits a transaction still open in the sign-out's own session, told by its psql prompt,
  then stops every realm still running, runs the sign-out again in psql's default autocommit
  either way and reads again, the count from a new psql session, and the check holds only while
  every realm container on the database reads `Exited` (or `Created`, from round thirty-three,
  C33R3); section L signs a player in after the commit, reads above 0, shows a COMMIT with no
  transaction open changing nothing and the rerun reading 0; S31R2's disposition notes it). S32R2
  FIXED (see C32R1).
- D32R1 FIXED (see S32R1). D32R2 FIXED `9dea958302` (a rerun that does not return waits on an
  earlier sign-out still open in another session, which the naming statement given the rerun's pid
  names and the rule under Index builds ends; section L holds one open in a `psql`-named session,
  names it from the waiting rerun's pid, ends it with DEPLOY's terminate, and the rerun then
  deletes its rows; S31R2's disposition notes it; the rerun's pid read with the rerun, and the
  open sign-out reached through a stopped realm's queued statement, from round thirty-three,
  M33R1).
- T32R1 FIXED `9dea958302` (the guarded line sits after the verify block's last command and after
  the rollback that points below to it; T31R1's disposition notes it). T32R2 FIXED `9dea958302`
  (with T32R3 and T32R7: one reader serves the control and both compose blocks, strips comments
  before reading and reads any name Compose interpolates, with a commented, a lowercase and an
  underscore-led control; T31R6's disposition notes it; quoted text kept whole and `$$$VAR` read
  from round thirty-three, H33R2). T32R3 FIXED (see T32R2). T32R4 FIXED `9dea958302` (section L
  pins "on the realm database" and runs the lookup from another database of the server, which
  finds no drop while the realm database's own lookup finds it). T32R5 FIXED `9dea958302` (the
  third lever is pinned as the stop, its command whole, with the guard sentence). T32R6 FIXED
  `9dea958302` (an `env_file`, an `extends` or a merge key in either block fails one pattern, with
  two positive controls; nested merge keys and aliases refused from round thirty-three, C33R1).
  T32R7 FIXED (see T32R2). T32R8 FIXED (see S32R1).
- M32R1 FIXED (see S32R1; the COMMIT now comes before the stop, so a sign-out left open holds no
  row a draining realm's logout waits on). M32R2 FIXED (see C32R1). M32R3 FIXED (see H32R2). M32R4
  FIXED `9dea958302` (section L's sign-out case rolls back only a transaction it opened, so a
  failed connect fails at once rather than at the timeout).
- L32R1 FIXED (see S32R1). L32R2 FIXED (see C32R1). L32R3 FIXED in this record (round thirty-one's
  dispositions name the round thirty text they edited). L32R4 FIXED in this record (with Q32R7:
  round twenty-nine's paragraph names round thirty-one for its note, and H30R1 names that
  paragraph back). L32R5 FIXED (see Q32R8). L32R6 FIXED `9dea958302` (the Enabling sentence says
  the bot never starts without the profile in either form, and that with
  `COMPOSE_PROFILES=discord` every `up -d` that names no service starts it, a release's step 6
  included; a command naming the bot named too, from round thirty-three, C33R2). L32R7 FIXED (see
  C32R3).

## Round thirty-three: eight fresh readers over round thirty-two (`849bdabe79..625ffa943c`)

Round thirty-three's commits: `d987076ce9` (DEPLOY: a sign-out rerun reads its own pid first, and
one that waits behind a stopped realm's queued statement is followed by the naming statement, one
`active` session at a time, to the open sign-out; the check accepts a realm container left
`Created`; the third escalation lever names every start of the bot as lifting it; a bot key edit
leaves a lever-stopped bot stopped; the release caveat moves the bot by the guarded line; the
health restart is for a running bot; the fatal-close fix recreates the game and then the bot
rather than restarting; the recreate rule's parenthetical says the guarded line moves a running
bot to the game's image; the profile reads as `discord` in `COMPOSE_PROFILES`, a command naming
the bot included, and `.env.example` says so; section L adds a failed sign-out's rolled-back
COMMIT, the queued realm chain with two readings of the holder, every pid of the sign-out case
read by `pg_backend_pid` (worded so in round thirty-four, D34R2), and a positive control for the
other-database lookup, and its `Cost:` header is the Duration line's tests time; the unit suite
refuses a merge key or alias at any depth, keeps a quoted value's text whole, reads `$$$VAR`, pins
lever 3's rule inside its own section, and drops the caveat's old start site; the change log with
it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C33R1 to C33R4 |
| qa-checklist | PASS | Q33R1 to Q33R9 |
| server hot path | PASS | H33R1 to H33R3 |
| privacy and security | PASS | S33R1 to S33R2 |
| database performance | PASS | D33R1 |
| test coverage | PASS | T33R1 to T33R8 |
| docs librarian | PASS | L33R1 to L33R4 |
| migration safety | PASS | M33R1 to M33R2 |

33 findings: none blocking, 7 should-fix (C33R1, Q33R1, S33R1, L33R1, M33R1, T33R1, T33R2), 26
nice-to-have, every reader passing, and two (server hot path and database performance) with no
should-fix. Three readers found the compose refusal blind to a nested merge key or alias. In place
of a caveat at each site that starts the bot, the third escalation lever now names every start of
the bot as lifting it, and the unit scan lists every start site whole.

- C33R1 FIXED `d987076ce9` (with Q33R1, T33R2 and T33R3: one pattern refuses an `env_file` or
  `extends` at the service level and a merge key or alias at any depth, on comment-stripped text,
  with six positive controls, `extends` among them; T32R6's disposition notes it; the alias forms
  replaced by a ban on any YAML anchor in the file from round thirty-four, T34R3). C33R2 FIXED
  `d987076ce9` (with H33R3: the Enabling sentence names a command that names the bot as enabling
  its profile, and the bot paragraph, the Enabling sentence and the recreate rule's parenthetical
  read the profile as `discord` in `COMPOSE_PROFILES`; L32R6's and C32R1's dispositions note it).
  C33R3 FIXED `d987076ce9` (the check accepts a realm container left `Created`, one never started;
  S32R1's disposition notes it). C33R4 FIXED (see M33R1).
- Q33R1 FIXED (see C33R1). Q33R2 FIXED (see S33R1). Q33R3 FIXED in this record and in the ledger
  (round thirty-two's commits paragraph and ledger entry say the naming statement names the
  session a waiting rerun waits on): `9dea958302`'s body says the rerun is named; the commit stays
  as it is. Q33R4 FIXED `d987076ce9` (the change log's round thirty-two entry names the profile
  host, worded so in round thirty-three). Q33R5 FIXED (see H33R2). Q33R6 FIXED in this record
  (round thirty-two's commits paragraph names the refusal): `9dea958302`'s body leaves out that
  refusal and section L's "on the realm database" pin; the commit stays as it is. Q33R7 NO CHANGE:
  a round that changes the runbook carries the pins that read it in the same commit for bisect,
  and every round has typed that commit by the runbook, `docs(freeholds)`. Q33R8 FIXED
  `d987076ce9` (section L's sign-out case reads every pid by `pg_backend_pid`, as DEPLOY tells the
  operator to, worded so in round thirty-four, D34R2; the hand drop's pid too from round
  thirty-four, M34R2). Q33R9 FIXED: nine mutants on rounds thirty-two and thirty-three's guards
  were each killed and their source restored: an `env_file`, a merge key under `environment:` and
  a bot-only key in the game block; the guarded line above the rollback; the stop renumbered;
  lever 3's rule moved above the first lever; the reader without `$$` pairs; a comment stripper
  that cuts quoted text; and a sign-out that spares a token minted just before it.
- H33R1 FIXED (see M33R1). H33R2 FIXED `d987076ce9` (with Q33R5 and T33R4: the comment stripper
  keeps any line with a quote whole and the reader reads `$$$VAR`, with a quoted and a `$$$`
  control; T32R2's disposition notes it). H33R3 FIXED (see C33R2).
- S33R1 FIXED `d987076ce9` (with Q33R2: the third escalation lever names every start of the bot as
  lifting it, any `up` of the bot, a `start` or `restart`, and a profile host's `up -d` that names
  no service, so while it holds the bot starts only to lift it; Environment keys makes either key
  edit without the bot's `up` while the lever holds; the reason given against `start` and
  `restart` reads "need not be"; H32R2's disposition notes it). S33R2 FIXED `d987076ce9` (the
  release caveat moves the bot by the guarded line once the realm is verified, a lever-stopped bot
  left stopped, and the unit scan drops its old start site; L28R3's disposition notes it (round
  thirty-four, Q34R2)).
- D33R1 FIXED (see M33R1).
- T33R1 FIXED `d987076ce9` and in this record (the `Cost:` header is the Duration line's tests
  time at one worker, 13.3 s; round thirty-two's 11.0 s left out the file's hooks, and
  `9dea958302`'s body gives it; the commit stays as it is). T33R2 FIXED (see C33R1). T33R3 FIXED
  (see C33R1). T33R4 FIXED (see H33R2). T33R5 FIXED `d987076ce9` (the other-database session finds
  the hand drop without the `datname` scope, so its empty scoped result is decisive). T33R6 FIXED
  `d987076ce9` (a sign-out after a failed statement commits as a ROLLBACK, the count still reads
  its token, and the rerun ends it). T33R7 FIXED `d987076ce9` (the open sign-out the chain reaches
  reads left open on two readings before it is ended). T33R8 FIXED `d987076ce9` (lever 3's rule is
  pinned inside lever 3's own section; bounded to lever 3's own list item from round thirty-four,
  T34R5).
- L33R1 FIXED `d987076ce9` (the fatal-close fix enables the intents or corrects the token in
  `.env` and recreates the game and then the bot by Environment keys, since a `restart` keeps the
  old token). L33R2 FIXED `d987076ce9` (the recreate rule's parenthetical says the guarded line
  moves a running bot to the game's image after the verification and any rollback; C32R3's
  disposition notes it). L33R3 FIXED `d987076ce9` (the red-probe restart is for a running bot, a
  lever-stopped one starting again only as the lever says). L33R4 FIXED `d987076ce9`
  (`.env.example` says every `up -d` that names no service then starts the bot, a stopped one
  included).
- M33R1 FIXED `d987076ce9` (with C33R4, D33R1 and H33R1: the rerun's pid is read in its session
  just before it, and a rerun that waits, directly or behind a stopped realm's statement queued on
  the same rows or table, is followed from another psql session on the realm database by the
  naming statement, given in turn each `active` session it names, to the open sign-out, which the
  rule under Index builds ends; section L queues a realm-shaped delete on the held row first,
  reads the rerun waiting on `tuple`, names the realm's `active` statement and then the open
  sign-out, and ends it; D32R2's disposition notes it; followed until it names none, the last
  session named deciding, an open sign-out or the nightly dump, with the realm truly stopped and a
  table arm, from round thirty-four, D34R1). M33R2 NO CHANGE, a stated boundary: the stall needs a
  sign-out typed after a BEGIN, which the bullet forbids, left open in a session the operator
  cannot reach, and a missed realm whose logouts and revokes on the rows it deleted fill that
  realm's pool (`DB_POOL_MAX_CLIENTS`); that realm's shutdown save (`game.saveAll`) then waits
  until its 75 s grace ends, losing what it did since its last autosave, and the rerun's naming
  then reaches and ends the forgotten session. The order before this round had the same gap.

## Round thirty-four: eight fresh readers over round thirty-three (`625ffa943c..96484d6336`)

Round thirty-four's commits: `8d7ad08a07` (DEPLOY: a sign-out rerun that waits is followed by the
naming statement, pid after pid, until it names none, and that last session decides: an open
sign-out is ended by the rule under Index builds, the nightly dump never is, and a stopped realm's
boot behind it is ended by The nightly dump; the stall-over reading accepts a realm container left
`Created` too; the release steps re-stop a bot the third lever held before a start; lever 3 says
queued outbox items wait in the game process; section L follows the chain on the rows and on the
table with each realm truly stopped, and behind the dump to a boot and `pg_dump`, ends any backend
a failed order leaves waiting, and reads the hand drop's pid by `pg_backend_pid`; the unit suite
bans any YAML anchor in the compose file and any block scalar in either block, bounds lever 3's
slice to its own list item, and pins the `.env.example` sentence and the heading it names; the
change log with it; kept whole for bisect), and the commit that adds this section. The commit
round thirty-three's readers read as `8954431c50` had its body reworded before anything followed
it, and is `96484d6336`.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C34R1 to C34R4 |
| qa-checklist | PASS | Q34R1 to Q34R6 |
| server hot path | PASS | H34R1 to H34R4 |
| privacy and security | PASS | S34R1 to S34R2 |
| database performance | PASS | D34R1 to D34R3 |
| test coverage | PASS | T34R1 to T34R5 |
| docs librarian | PASS | L34R1 to L34R3 |
| migration safety | PASS | M34R1 to M34R2 |

29 findings: none blocking, 10 should-fix (C34R1, Q34R1, Q34R2, H34R1, D34R1, D34R2, T34R1 to
T34R3, L34R1), 19 nice-to-have, every reader passing, and two (privacy and security, and migration
safety) with no should-fix. Two patterns kept drawing one more form, and each now has a whole
rule: the rerun's chain is followed to the session that waits on nothing, which decides, in place
of a list of what it may wait behind (rows, a table, a boot behind the dump); and the compose file
defines no YAML anchor, so no alias or merge key in any form reaches a block, in place of a list
of alias forms. Round thirty-three edited eight of round thirty-two's dispositions in place, not
seven as its evidence said.

- C34R1 FIXED `8d7ad08a07` (with L34R1 and S34R1: the stall-over reading accepts a realm container
  left `Created`, one never started, as the sign-out check does; L28R1's disposition notes it
  (round thirty-five, Q35R3); its wording pinned from round thirty-five, T35R3). C34R2 FIXED (see
  D34R1). C34R3 FIXED (see D34R1). C34R4 FIXED (see T34R3).
- Q34R1 FIXED `8d7ad08a07` (the release steps re-stop the bot if the third lever held before such
  a start, which lifts it; C32R1's disposition notes it). Q34R2 FIXED in this record (L28R3 notes
  S33R2's change, and S33R2 names it back). Q34R3 FIXED by rewording that commit's body before
  anything followed it (`8954431c50` is `96484d6336`): its ledger entry names only the first of
  the three. Q34R4 FIXED in this record (with L34R2: C32R1's note names C33R2, the finding that
  names it back). Q34R5 FIXED (see T34R3). Q34R6 FIXED in this record (round thirty-three edited
  eight of round thirty-two's dispositions in place).
- H34R1 FIXED (see D34R1). H34R2 FIXED `8d7ad08a07` (the other-database control asks only that the
  unscoped lookup contain the hand drop's pid, so another database's drop on a shared server
  cannot fail it). H34R3 FIXED `8d7ad08a07` (a failed order in the sign-out case terminates every
  backend it left waiting before its clients end, so no queued statement commits after the test;
  only this database's live sessions from round thirty-five, M35R2). H34R4 FIXED (see T34R3).
- S34R1 FIXED (see C34R1). S34R2 FIXED (see T34R3).
- D34R1 FIXED `8d7ad08a07` (with H34R1, C34R2, T34R1, C34R3 and D34R3: a rerun that waits is
  followed by the naming statement, pid after pid, until it names none, and the last session named
  decides: an earlier sign-out left open is ended by the rule under Index builds, the nightly dump
  never is, and a stopped realm's boot waiting behind it is ended by The nightly dump; section L
  reads the whole chain on the rows (`tuple`) and on the table (`relation`), each realm's socket
  destroyed first so its backend keeps its place, the open sign-out naming none, and in the dump
  case a rerun behind the stopped boot names the boot, then `pg_dump`, which names none, and
  returns once The nightly dump's statement ends the boot; M33R1's disposition notes it; every pid
  named walked, each session reached that names none deciding, from round thirty-five, T35R2).
  D34R2 FIXED `8d7ad08a07` and in this record (with M34R2: round thirty-three's claims say only
  the sign-out case read every pid by `pg_backend_pid`, and the hand drop's pid is now read so
  too; `d987076ce9`'s body says every pid; the commit stays as it is; Q33R8's disposition notes
  it). D34R3 FIXED (see D34R1).
- T34R1 FIXED (see D34R1). T34R2 FIXED `8d7ad08a07` (the unit suite pins the `.env.example`
  sentence, comment markers stripped, and the DEPLOY heading it names). T34R3 FIXED `8d7ad08a07`
  (with Q34R5, S34R2, C34R4 and H34R4: the compose file defines no YAML anchor, so no alias or
  merge key in any form can reach a block, with anchor and literal-ampersand controls; `env_file`
  and `extends` stay refused per block; C33R1's disposition notes it; an anchor of any name from
  round thirty-five, Q35R6). T34R4 FIXED `8d7ad08a07` (neither block holds a block scalar, whose
  comment-shaped lines Compose reads, with a control; in any position, a list item's or a tagged
  one too, from round thirty-five, C35R2). T34R5 FIXED `8d7ad08a07` (lever 3's slice ends at the
  first paragraph not indented under its list item; T33R8's disposition notes it).
- L34R1 FIXED (see C34R1). L34R2 FIXED (see Q34R4). L34R3 FIXED in the ledger (round
  thirty-three's entry says a key edit no longer starts a lever-stopped bot, worded so in round
  thirty-four).
- M34R1 FIXED `8d7ad08a07` (lever 3 says queued outbox items wait in the game process, the winner
  days excepted, so a recreate of the game while the lever holds drops the relay, activity,
  link-change and queue-pop items queued since the stop; `server/internal.ts` drains those feeds
  from memory; each feed's cap, a queue pop's lapse and any end of the game process stated from
  round thirty-five, S35R1). M34R2 FIXED (see D34R2).
- Mutants on this round's new guards, each killed and its source restored: a YAML anchor at the
  top of the compose file; a block scalar in the game block; `.env.example` without "a stopped one
  included"; lever 3's rule moved out of its list item below the levers; the Enabling heading
  renamed.

## Round thirty-five: eight fresh readers over round thirty-four (`96484d6336..b23acc2b44`)

Round thirty-five's commits: `72daa3ee3a` (DEPLOY: lever 3 states the bot outbox's bounds as the
code sets them, each in-memory feed keeping only its newest items once full under the cap DEPLOY
names, a queue pop lapsing with its offer, and any end of the game process dropping what is
queued; the bot restart note says redelivery is within each cap; a waiting rerun's walk visits
every pid named, and each session it reaches that names none decides, or, with none named for the
rerun, the rerun is working; section L walks a step that names two stopped realms to the one open
sign-out, pins the first stall-over reading, scopes its failure-path terminate to this database's
live sessions, and ends the dump case's rerun before the holder is released on a failed order; the
unit suite ties the outbox to `server/internal.ts`'s drains and each feed's cap, bans a block
scalar in any position and an anchor of any name; the change log with it; kept whole for bisect;
this paragraph's feed clause, like the commit's body, holds for three feeds and not the
link-change feed, and the body has five sentences, one past the commit rule, both noted in round
thirty-six, C36R1 and Q36R2), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C35R1 to C35R4 |
| qa-checklist | PASS | Q35R1 to Q35R7 |
| server hot path | PASS | H35R1 |
| privacy and security | PASS | S35R1 |
| database performance | PASS | D35R1 to D35R3 |
| test coverage | PASS | T35R1 to T35R6 |
| docs librarian | PASS | L35R1 to L35R4 |
| migration safety | PASS | M35R1 to M35R2 |

28 findings: none blocking, 11 should-fix (C35R1, C35R2, Q35R1 to Q35R3, H35R1, S35R1, D35R1,
L35R1, T35R1, T35R2), 17 nice-to-have, every reader passing, and one (migration safety) with no
should-fix. Six readers (C35R1, Q35R1, H35R1, S35R1, D35R1 and L35R1) found lever 3's outbox
sentence promising more than the capped, expiring, in-memory feeds give, and two more (M35R1 and
T35R4) asked in nice-to-haves for parts of its fix, any end of the game process and the tie to the
code (named so in round thirty-six, Q36R3); it now states their bounds, with the feeds and their
caps tied to the code (the link-change feed's drop rule corrected in round thirty-six, C36R1).
Round thirty-four edited five of round thirty-three's dispositions in place (four forward notes
and S33R2's back-pointer), not four as its evidence said.

- C35R1 FIXED (see S35R1). C35R2 FIXED `72daa3ee3a` (with T35R1: a block scalar is refused
  wherever its indicator ends a line, after a key, a list dash or a tag, with three positive and
  three literal controls; T34R4's disposition notes it). C35R3 FIXED (see D35R2). C35R4 FIXED (see
  T35R2).
- Q35R1 FIXED (see S35R1). Q35R2 FIXED in this record (with L35R2: S33R2's back-pointer names
  round thirty-four, Q34R2). Q35R3 FIXED in this record (L28R1 notes C34R1's `Created`, and C34R1
  names it back). Q35R4 FIXED (see T35R2). Q35R5 FIXED (see T35R2). Q35R6 FIXED `72daa3ee3a` (the
  anchor ban reads an anchor of any name, `&$shared` among its controls, and still passes `&&`,
  `2>&1` and `&>`; T34R3's disposition notes it; a name that starts with `&` too, `&&shared` among
  the controls, from round thirty-six, T36R4). Q35R7 FIXED in this record (with L35R4: round
  thirty-four edited five of round thirty-three's dispositions in place).
- H35R1 FIXED (see S35R1).
- S35R1 FIXED `72daa3ee3a` (with C35R1, Q35R1, H35R1, D35R1, L35R1, M35R1 and T35R4: lever 3 says
  the queued outbox items wait in the game process, the winner days excepted, and only within
  bounds: each feed keeps only its newest items once full (`RELAY_MAX_QUEUE`,
  `ACTIVITY_MAX_QUEUE`, `LINK_CHANGE_MAX_QUEUE`, `QUEUE_POP_MAX_QUEUE`), a queue pop lapses with
  its offer, and any end of the game process while the lever holds drops everything queued; the
  bot restart note says redelivery is within each feed's cap; the unit suite holds
  `server/internal.ts`'s drains to exactly the four feeds, each file's cap to its exported
  constant, and the queue pops' lapse to its filter; M34R1's disposition notes it; lever 3's cost
  stated whole, each feed's own drop rule (the link-change feed spends its link and unlink items
  last) and the polled process alone, from round thirty-six, C36R1 and H36R3, each feed's queue
  code read whole from that round's mutants; the restart note's taken batch, from round
  thirty-six, C36R2; the drains read with comments stripped, from round thirty-six, T36R2).
- D35R1 FIXED (see S35R1). D35R2 FIXED `72daa3ee3a` (with C35R3 and T35R6: the dump case's rerun
  is ended, on a failed order, before the dump-shaped holder is released, so it commits no
  sign-out after the test). D35R3 FIXED (see T35R2).
- T35R1 FIXED (see C35R2). T35R2 FIXED `72daa3ee3a` (with Q35R4, Q35R5, D35R3 and C35R4: the
  rerun's walk gives the naming statement each pid named, in turn, until each names none, and
  every session reached that names none decides, the open sign-out "is ended by the rule there",
  and with no session named for the rerun at all it is working; section L queues two stopped
  realms on the table, so the first step names both, and the walk over every pid named reaches
  exactly one session that names none, the open sign-out; D34R1's disposition notes it; the second
  realm's own step pinned, a walk to two leaves, an open sign-out and a dump, each decided by its
  own rule, and a working session naming none, from round thirty-six, D36R2, T36R3 and T36R5).
  T35R3 FIXED `72daa3ee3a` (section L pins the first stall-over reading with `Created`; C34R1's
  disposition notes it). T35R4 FIXED (see S35R1). T35R5 FIXED `72daa3ee3a` (an anchor followed by
  a comment, read through the comment stripper, is among the anchor controls). T35R6 FIXED (see
  D35R2).
- L35R1 FIXED (see S35R1). L35R2 FIXED (see Q35R2). L35R3 FIXED in the ledger (round
  thirty-three's entry names L34R3 beside its round). L35R4 FIXED (see Q35R7).
- M35R1 FIXED (see S35R1). M35R2 FIXED `72daa3ee3a` (the failure-path terminate reads only this
  database's live sessions, so a reused pid on a shared server is never ended; H34R3's disposition
  notes it).
- Mutants on this round's new guards, each killed and its source restored: a list-item block
  scalar in the game block; a fifth outbox drain in `server/internal.ts`; the relay cap renamed;
  an anchor named with a sigil; the stall-over reading without `Created`.

## Round thirty-six: eight fresh readers over round thirty-five (`b23acc2b44..597d697861`)

Round thirty-six's commits: `d300324c33` (DEPLOY: lever 3 states a stop's cost whole, what waits
for the bot and what the outbox drops for good, each feed's own drop rule once full (the relay,
activity and queue-pop feeds their oldest items, the link-change feed its link and unlink items
last), and that the outbox lives in the process the bot polls, the one `GAME_SERVER_URL` names;
the bot restart note says the restarted bot gets what is still queued, a queue pop only while its
offer stands, and that a batch a poll already took is lost if the bot stops before posting it;
section L pins the second realm's own step, walks a rerun to two leaves, an open sign-out and a
dump-shaped ACCESS SHARE, each decided by its own rule, and pins that a working session names
none; the unit suite reads the drains and the feeds with comments stripped, ties each feed's drop
rule and the queue pops' lapse to the code and the bot's `GAME_SERVER_URL` to the compose file,
and reads an anchor whose name starts with `&`; the pg file's Cost 13.8 s; the change log with it;
kept whole for bisect), `eb59d4a243` (the unit suite reads each feed's queue code whole, after
this round's mutants found a one-site trim change passing the ties), and the commit that adds this
section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C36R1 to C36R2 |
| qa-checklist | PASS | Q36R1 to Q36R4 |
| server hot path | PASS | H36R1 to H36R3 |
| privacy and security | PASS | S36R1 to S36R2 |
| database performance | PASS | D36R1 to D36R2 |
| test coverage | PASS | T36R1 to T36R5 |
| docs librarian | PASS | L36R1 to L36R4 |
| migration safety | PASS | M36R1 |

23 findings: none blocking, 9 should-fix (C36R1, Q36R1, H36R1, S36R1, D36R1, T36R1, L36R1, L36R2,
M36R1), 14 nice-to-have, every reader passing and every one with a should-fix. All eight readers
found that lever 3's drop clause holds for three feeds and not the link-change feed, which spends
its link and unlink items last; lever 3 now states a stop's cost whole, each feed's own drop rule
tied to the code. This round's mutants found those ties passing a one-site trim change; the unit
suite now reads each feed's queue code whole (`eb59d4a243`).

- C36R1 FIXED `d300324c33` (with Q36R1, H36R1, S36R1, D36R1, T36R1, L36R1, L36R2 and M36R1: lever
  3 states a stop's cost whole: the bot's role, nickname, presence, relay, activity, link-change
  and queue-pop delivery waits until it is started again, and what the outbox drops meanwhile
  never comes; each feed holds at most its cap and, once full, drops by its own rule, the relay,
  activity and queue-pop feeds their oldest items, the link-change feed its link and unlink items
  last, which the bot's periodic re-read of the linked set heals; the unit suite ties each rule to
  its code, the relay and activity trims, the queue pops' `shift` and the link-change feed's
  `EVICTION_LADDER` whole, read whole at every site from `eb59d4a243` (the mutants below), and,
  from `eb59d4a243`, names all four feeds' own suites as the rules' behavior pins (corrected in
  round thirty-seven, Q37R3); S35R1's disposition, round thirty-five's intro and summary, and the
  ledger's round thirty-five entry note it; a stop stopping everything the bot does, the
  daily-active points, the outbox's own items and the hourly full resync, and each feed's queue
  code read through the parser with every declaration it names, from round thirty-seven, C37R1 and
  C37R2). C36R2 FIXED `d300324c33` (with L36R3 and H36R2: the bot restart note says the outbox
  hands the restarted bot what is still queued, within the bounds lever 3 gives, a queue pop only
  while its offer stands, and that a batch a poll already took, whose 200 is the outbox's only
  acknowledgement, is lost if the bot stops before posting it; S35R1's disposition notes it; its
  winner days served again until the bot marks them, from round thirty-seven, S37R1).
- Q36R1 FIXED (see C36R1). Q36R2 FIXED in this record (`72daa3ee3a`'s body has five sentences, one
  past the commit rule, and repeats the drop clause C36R1 corrects; the commit stays, since
  rewording it would change the hashes this record names after it, and round thirty-five's intro
  notes it). Q36R3 FIXED in this record (with L36R4: round thirty-five's summary names the six
  readers whose should-fix was the outbox sentence, C35R1, Q35R1, H35R1, S35R1, D35R1 and L35R1,
  and the two whose nice-to-haves asked for parts of its fix, M35R1 and T35R4). Q36R4 FIXED (see
  T36R2).
- H36R1 FIXED (see C36R1). H36R2 FIXED (see C36R2). H36R3 FIXED `d300324c33` (lever 3 says the
  outbox holds the items in the memory of the game process the bot polls, the one
  `GAME_SERVER_URL` names, and the unit suite pins the bot's `GAME_SERVER_URL` in the compose
  file; S35R1's disposition notes it).
- S36R1 FIXED (see C36R1). S36R2 FIXED `d300324c33` (any end of the game process while lever 3
  holds drops everything still queued, not only what was queued since the stop).
- D36R1 FIXED (see C36R1). D36R2 FIXED `d300324c33` (section L pins the second realm's own step:
  it names the first realm and the open sign-out; T35R2's disposition notes it).
- T36R1 FIXED (see C36R1). T36R2 FIXED `d300324c33` (with Q36R4: the drain scan and the feeds are
  read with comments stripped, the lapse filter inside `drainQueuePops`, now within its feed's
  whole pin from `eb59d4a243`, and the comment says a feed drained by a `drain<Name>(` call fails
  until DEPLOY names it; S35R1's disposition notes it; read through the TypeScript parser, each
  drain and requeue call whole, from round thirty-seven, Q37R1). T36R3 FIXED `d300324c33` (section
  L queues a stopped realm behind an open sign-out and a dump-shaped ACCESS SHARE, so the walk
  from the rerun reaches two sessions that name none; the sign-out is ended by the rule, the dump
  never is, and the realm's statement behind it is ended by The nightly dump's statement; T35R2's
  disposition notes it; the next walk, once the sign-out is gone, ending at the dump alone, from
  round thirty-seven, D37R1). T36R4 FIXED `d300324c33` (the anchor ban reads a name that starts
  with `&`, `&&shared` among its controls, and still passes `a && b`, `2>&1` and `&>`; Q35R6's
  disposition notes it; replaced by a ban on any `&` in the file, from round thirty-seven, Q37R4).
  T36R5 FIXED `d300324c33` (section L pins that a working session, one in `pg_sleep`, names none;
  T35R2's disposition notes it; read while it still works and then cancelled, from round
  thirty-seven, D37R2).
- L36R1 FIXED (see C36R1). L36R2 FIXED (see C36R1). L36R3 FIXED (see C36R2). L36R4 FIXED (see
  Q36R3).
- M36R1 FIXED (see C36R1).
- Mutants on this round's new guards, each killed and its source restored: in the unit suite, a
  one-site change to the relay's enqueue trim and to the queue pops' requeue trim, a link-change
  ladder that spends flex noise before playtime noise, a `drainQueuePops` that keeps lapsed pops
  with its filter left in a comment, a relay drain left only in a comment, the bot polling another
  URL, and an anchor whose name starts with `&`; in section L, a naming statement that hides a
  `pg_dump` session (failing at the two-leaf walk) and one that names a working session (failing
  at its arm). The two one-site trims first passed the unit suite, whose ties read only that each
  rule's line was present, and failed only in the feeds' own suites; `eb59d4a243` reads each
  feed's queue code whole, and both now fail in the unit suite, as do five more aimed at it: a
  pops trim that stops early, a link-change requeue without its trim, a playtime rung that takes a
  link item, a new function that hands the relay queue out, and a trim that walks the queue newest
  first.

## Round thirty-seven: eight fresh readers over round thirty-six (`597d697861..b8109600b0`)

Round thirty-seven's commits: `2afa2c6f0a` (DEPLOY: lever 3 says the game keeps running and a stop
stops everything the bot does until it is started again, that what it does only in answer to a
Discord event is never done for one during the stop (a linked member whose only post or voice join
of a day fell in it gets no daily-active points that day), that the outbox holds its relay,
activity, link-change and queue-pop items while the winner days stay in the database, and that the
hourly full resync heals the link-change feed; the restart note says a taken batch's winner days
are served again until the bot marks them; the compose file's bot comment points to that note;
section L waits for the ended sign-out to be gone and walks again to the dump alone, and reads a
working session while it still works before cancelling it; the unit suite reads the outbox's code
through the TypeScript parser, each drain and requeue call whole and each feed's queue code with
every declaration it names, ties the resync's interval, and bans any `&` in the compose file; Cost
13.4 s and 0.9 s; the change log with it; kept whole for bisect), and the commit that adds this
section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C37R1 to C37R4 |
| qa-checklist | PASS | Q37R1 to Q37R4 |
| server hot path | PASS | H37R1 to H37R2 |
| privacy and security | PASS | S37R1 to S37R2 |
| database performance | PASS | D37R1 to D37R3 |
| test coverage | PASS | T37R1 to T37R7 |
| docs librarian | PASS | L37R1 to L37R4 |
| migration safety | PASS | M37R1 to M37R2 |

28 findings: none blocking, 7 should-fix (C37R1, C37R2, Q37R1, D37R1, T37R1, T37R2, L37R1), 21
nice-to-have, every reader passing, and three (server hot path, privacy and security, migration
safety) with no should-fix. Lever 3 had called the bot a pure consumer whose stop costs
Discord-side work alone, which the daily-active points it grants contradict, and had the outbox
hold role, nickname and presence items it never holds; it now says a stop stops everything the bot
does and names the outbox's own items. The comment stripper the outbox ties read through hid real
code behind a `/*` in a line comment; the outbox's code is now read through the TypeScript parser,
and each feed's queue code reaches every declaration it names, `forgetPending` and
`claimDedupeKey` among them.

- C37R1 FIXED `2afa2c6f0a` (with L37R1, H37R2, S37R2 and T37R6: lever 3 says the game keeps
  running and a stop stops everything the bot does until it is started again: the role, nickname,
  presence, relay, activity, winner, link-change and queue-pop delivery waits, what the outbox
  drops never comes, and what the bot does only in answer to a Discord event is never done for one
  during the stop, a linked member whose only post or voice join of a day fell in it getting no
  daily-active points that day; the outbox holds its relay, activity, link-change and queue-pop
  items in the polled process and the winner days stay in the database; the link-change feed's
  heal is the bot's hourly full resync, its `FULL_RESYNC_INTERVAL_MS` pinned; C36R1's disposition
  notes it; the overview's pure-consumer claim dropped and the example counting every voice state
  change, from round thirty-eight, L38R1 and H38R1; the daily-active grant's cases and the
  resync's calls and defaults tied, from round thirty-eight, T38R3 and T38R5). C37R2 FIXED
  `2afa2c6f0a` (with T37R1, C37R4 and Q37R2: each feed's queue code is read through the TypeScript
  parser as every top-level statement that names its queue or a cap and every declaration of the
  module such a statement names, until none is left, so `claimDedupeKey`, `forgetPending`, the
  ladder and its rungs, the pending indexes and a bare `MAX_QUEUE` alias are read by the rule
  rather than by a list; the names another module supplies are pinned (only the queue pops' test
  reset), and every statement outside the read set that names a state it declares is pinned by
  name (the activity feed's `releaseDedupeKey` and six watch and batch functions of the queue
  pops); C36R1's disposition notes it; every statement naming any read declaration listed,
  functions included, from round thirty-eight, Q38R1). C37R3 FIXED (see D37R1). C37R4 FIXED (see
  C37R2).
- Q37R1 FIXED `2afa2c6f0a` (with T37R4 and T37R5: server/internal.ts is read through the
  TypeScript parser, every `drain<Name>` it names, called or not, each drain call pinned whole
  (`drainQueuePops(Date.now())`, so a pop lapses against the clock), and the four requeues the
  only ones, all in the one catch whose try holds every drain; a line comment holding `/*` inside
  a feed function leaves the pin unchanged, a control; T36R2's disposition notes it; every comment
  dropped, read at every token's start and end, and no other file draining or requeueing a feed,
  from round thirty-eight, T38R4 and T38R6). Q37R2 FIXED (see C37R2). Q37R3 FIXED in this record
  (C36R1's disposition says the four feeds' suites are named from `eb59d4a243`, noted there).
  Q37R4 FIXED `2afa2c6f0a` (with T37R7: the compose file may hold no `&` at all, so it defines no
  anchor of any name or form, a later `&&` in a command included; T36R4's disposition notes it).
- H37R1 FIXED (see D37R2). H37R2 FIXED (see C37R1).
- S37R1 FIXED `2afa2c6f0a` (with L37R2: the restart note says the queued items of a batch a poll
  already took are lost if the bot stops before posting them, while its winner days are served
  again until the bot marks them posted; C36R2's disposition notes it; a batch whose answer never
  reaches the bot, the resync's heal of a lost link change and a winner day posted twice, and the
  winner read and its marks tied, from round thirty-eight, L38R2 and T38R2). S37R2 FIXED (see
  C37R1).
- D37R1 FIXED `2afa2c6f0a` (with C37R3, M37R2 and T37R2: section L waits for the ended sign-out's
  backend to be gone, reads the rerun still waiting, and walks again to exactly one leaf, the
  dump; T36R3's disposition notes it). D37R2 FIXED `2afa2c6f0a` (with D37R3, H37R1, T37R3 and
  M37R1: the working session sleeps 30 s behind a rejection handler, names none while a second
  read shows it still active, and is then cancelled, its query answering 57014, its backend in the
  failure path's terminate list; T36R5's disposition notes it; that list's comment naming a
  working backend, from round thirty-eight, D38R1). D37R3 FIXED (see D37R2).
- T37R1 FIXED (see C37R2). T37R2 FIXED (see D37R1). T37R3 FIXED (see D37R2). T37R4 FIXED (see
  Q37R1). T37R5 FIXED (see Q37R1). T37R6 FIXED (see C37R1). T37R7 FIXED (see Q37R4).
- L37R1 FIXED (see C37R1). L37R2 FIXED (see S37R1). L37R3 FIXED in the ledger (round thirty-six's
  entry says round thirty-five's lever 3, not its entry, had every feed keep its newest). L37R4
  FLAGGED (the compose file runs the bot as `node` in exec form with no `init`, and the bot
  installs no SIGTERM handler; whether node then ends at once, as the comment beside
  `stop_grace_period` says, or as PID 1 ignores SIGTERM until the 15 s SIGKILL and so may post or
  take a batch meanwhile, this host could not run; a maintainer decision, under OWED in the
  ledger; that comment's redelivery clause now points to DEPLOY's restart note, named by its
  section and pinned from round thirty-eight, L38R4).
- M37R1 FIXED (see D37R2). M37R2 FIXED (see D37R1).
- Mutants on this round's new guards, each killed and its source restored: in the unit suite, a
  drain call after a line comment holding `/*`, the queue pops drained against a fixed clock, a
  requeue outside the catch, `forgetPending` a no-op, `claimDedupeKey` refusing every key, a
  function naming only the relay's `MAX_QUEUE` alias, the bot's full resync made two-hourly, an
  `&&` in a compose comment, and a new writer of the link-change pending index; in section L, a
  naming statement that names a working session (failing at that arm) and one that hides a
  `pg_dump` session (failing at the two-leaf walk); no mutant reaches the walk to the dump alone
  once the sign-out is gone, P3 failing first at the two-leaf walk (noted in round thirty-eight,
  Q38R5). A control, a line comment holding `/*` inside a feed function, leaves the unit suite
  green.

## Round thirty-eight: eight fresh readers over round thirty-seven (`b8109600b0..b7e5193cf3`)

Round thirty-eight's commits: `41db868baa` (DEPLOY: the Discord bot overview no longer calls the
bot a pure consumer whose stop never affects the realm and points to lever 3 for what a stop
costs; the restart note says a taken batch is lost too when its answer never reaches the bot, a
lost link-change item heals at the hourly full resync, and a winner day posted but not yet marked
is posted again; lever 3's daily-active example counts every post and voice state change; the
compose file's bot comment names the stop_grace_period paragraph under Verifying health and the
third escalation lever; the unit suite's `linesOf` reads leading and trailing comments at every
token's start and end, with a sample control, its boundary list names every statement reaching a
read declaration, functions included, and new ties pin the winner read and its marks, the
daily-active grant's cases, the resync's defaults and calls, the files that drain or requeue a
feed and the compose comment; section L's failure-path list comment; the unit file's Cost 1.1 s;
the change log with it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C38R1 to C38R4 |
| qa-checklist | PASS | Q38R1 to Q38R5 |
| server hot path | PASS | H38R1 to H38R3 |
| privacy and security | PASS | S38R1 |
| database performance | PASS | D38R1 |
| test coverage | PASS | T38R1 to T38R7 |
| docs librarian | PASS | L38R1 to L38R4 |
| migration safety | PASS | M38R1 to M38R2 |

27 findings: none blocking, 5 should-fix (Q38R1, T38R1, T38R2, T38R3, L38R1), 22 nice-to-have,
every reader passing, and five (correctness, server hot path, privacy and security, database
performance, migration safety) with no should-fix. The Discord bot overview still called the bot a
pure consumer whose stop never affects the realm; it now points to lever 3. Two readers found the
queue-code boundary list blind to a statement that only calls a read function; it now lists every
statement that names a read declaration, and DEPLOY's new winner and daily-active claims are tied
to the code.

- C38R1 FIXED (see H38R1). C38R2 FIXED (see L38R4). C38R3 FIXED (see T38R4). C38R4 FIXED (see
  T38R2; its daily-active half with T38R3).
- Q38R1 FIXED `41db868baa` (with T38R1: the boundary list names every statement outside the read
  set that names any declaration the read set holds, a state or a function, so the queue pops'
  list gains `enqueueCandidate`, and a declaration's names include an enum's, a namespace's and a
  destructured binding's; C37R2's disposition notes it; each form run on a sample, from round
  thirty-nine, T39R5). Q38R2 FIXED (see T38R4). Q38R3 FIXED (see T38R5). Q38R4 FIXED (see L38R4).
  Q38R5 FIXED in this record (round thirty-seven's mutants bullet says no mutant reaches the walk
  to the dump alone once the sign-out is gone, P3 failing first at the two-leaf walk).
- H38R1 FIXED `41db868baa` (with C38R1 and L38R3: lever 3's example is a linked member whose every
  post and voice state change of a day, a join, a move, a mute, fell in the stop; C37R1's
  disposition notes it; replaced by the rule it illustrated, from round thirty-nine, T39R3). H38R2
  FIXED (see L38R2). H38R3 RULED (the TypeScript API stays a top-level import: it loads once per
  run of the file, the whole file is what the gate runs and the Cost header measures, 1.1 s (1.0 s
  from round thirty-nine, the resync ties gone with C39R1, noted in round forty, Q40R5), and a
  `-t` filtered local run is no cost a guard counts).
- S38R1 FIXED (see L38R2).
- D38R1 FIXED `41db868baa` (the comment over section L's failure-path list says it holds backends
  a failed order could leave waiting on a lock, or working; D37R2's disposition notes it).
- T38R1 FIXED (see Q38R1). T38R2 FIXED `41db868baa` (with C38R4: `outboxHandler`'s first statement
  is the winners read, pinned whole, and neither `markDiscordWinnersAnnounced` call lies in it; no
  test runs the read's own filter, a day not yet marked, against a real database, the
  daily-rewards owner's gap, under OWED in the ledger; S37R1's disposition notes it; every
  identifier of the mark call read and the tie failing closed, from round thirty-nine, D39R1).
  T38R3 FIXED `41db868baa` (with C38R4's daily-active half, named so in round thirty-nine, Q39R1:
  `grantDailyActive` is named only by its declaration and its calls in the `VOICE_STATE_UPDATE`
  and `MESSAGE_CREATE` cases of bot/main.ts; C37R1's disposition notes it; no other bot module
  naming a grant, from round thirty-nine, Q39R4; an empty case falling into either read too, from
  round forty-one, T41R4). T38R4 FIXED `41db868baa` (with C38R3 and Q38R2: `linesOf` reads leading
  and trailing comment ranges at every token's start and end, JSDoc aside, with a sample control
  holding a trailing comment, an inline block comment, a regex and a string; the space beside a
  comment dropped from inside a line stays, so such a comment trips a pin, which its comment says;
  Q37R1's disposition notes it; own-line and multi-line comments in the sample, from round
  thirty-nine, T39R4). T38R5 FIXED `41db868baa` (with M38R2 and Q38R3: the `everyMs` defaults of
  `dueForFullResync` and `fullResyncIfDue`, and every call to either in bot/, none passing an
  interval of its own; C37R1's disposition notes it; removed with the hourly claim they tied, from
  round thirty-nine, C39R1). T38R6 FIXED `41db868baa` (the tracked code outside tests/ that names
  a feed's drain or requeue is exactly the four feed modules and server/internal.ts; Q37R1's
  disposition notes it; a git failure never read as no match, from round thirty-nine, H39R4).
  T38R7 FIXED (see L38R4).
- L38R1 FIXED `41db868baa` (DEPLOY's Discord bot overview says the bot holds nothing durable and
  reads and writes the game only through the internal API, so a stop leaves the game running, and
  points to the third escalation lever for what a stop costs; C37R1's disposition notes it; pinned
  inside its section, pointing to both places that say what a stop costs, its "only" dropped and
  the bot's internal API tied, from round thirty-nine, T39R1 and T39R2). L38R2 FIXED `41db868baa`
  (with M38R1, S38R1 and H38R2: the restart note says a taken batch's queued items are lost if the
  bot stops before posting them or the answer never reaches it, a lost link-change item heals at
  the hourly full resync, and a winner day posted but not yet marked when the bot stopped is
  posted again; S37R1's disposition notes it; the bot's resyncs heal, with no cadence promised,
  from round thirty-nine, C39R1). L38R3 FIXED (see H38R1). L38R4 FIXED `41db868baa` (with C38R2,
  Q38R4 and T38R7: the compose comment names the stop_grace_period paragraph under DEPLOY.md's
  Verifying health for what of the outbox a stop loses and the third escalation lever for the
  rest, pinned; L37R4's disposition notes it; the lever named under its Incident runbook and the
  paragraph's share named as a taken batch's, from round thirty-nine, L39R4).
- M38R1 FIXED (see L38R2). M38R2 FIXED (see T38R5).
- Outside the findings, the readers named two feed-owner comments stale, outside 07a:
  `server/internal.ts`'s outbox doc comment says three in-memory feeds and three requeues, where
  there are four, and `server/discord_link_changes.ts`'s `isEvictableFlexNoise` comment says the
  bot can never re-learn a link transition's id from a resync; under OWED in the ledger (added in
  round thirty-nine, L39R2).
- Mutants on this round's new guards, each killed and its source restored: a new function that
  drains the relay through a read function; the poll marking the winner days it serves; the
  winners read wrapped in `Promise.resolve` (worded so in round thirty-nine, Q39R7); a catch-up
  daily-active grant on the guild seed; the full resync called with a six-hour interval; the
  resync's default doubled; another server module draining the relay; the compose comment's
  pointer reworded. Two controls: a trailing comment after a pinned relay line leaves the unit
  suite green, and an inline block comment inside one trips its pin, as `linesOf`'s comment says.

## Round thirty-nine: eight fresh readers over round thirty-eight (`b7e5193cf3..08f80500f1`)

Round thirty-nine's commits: `a5b04edb93` (DEPLOY: the Discord bot overview points to the
stop_grace_period paragraph and the third escalation lever for what a stop costs and drops round
thirty-eight's "only"; the restart note and lever 3 say the bot's resyncs heal a lost link change,
with no cadence; lever 3 states the daily-active rule without a list of the events that grant; the
compose comment names the lever under its Incident runbook and the paragraph's share as a taken
batch's; bot/CLAUDE.md and two bot/main.ts comments say a voice state carrying a channel grants,
at most once a day; the unit suite pins the overview inside its section, the sections its pointers
name and the bot's internal API, reads every identifier of the winner mark call and fails closed,
pins that no other bot module names a grant, checks git grep's exit status, runs every declaration
form on a sample and adds own-line and multi-line comments to the `linesOf` sample, and drops the
resync ties with the hourly claim; the unit file's Cost 1.0 s; the change log with it; kept whole
for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C39R1 to C39R4 |
| qa-checklist | PASS | Q39R1 to Q39R8 |
| server hot path | PASS | H39R1 to H39R4 |
| privacy and security | PASS | S39R1 to S39R2 |
| database performance | PASS | D39R1 |
| test coverage | PASS | T39R1 to T39R7 |
| docs librarian | PASS | L39R1 to L39R6 |
| migration safety | PASS | M39R1 |

33 findings: none blocking, 5 should-fix (Q39R1, T39R1, T39R2, T39R3, L39R1), 28 nice-to-have,
every reader passing, and five (correctness, server hot path, privacy and security, database
performance, migration safety) with no should-fix. Each precision added to DEPLOY in rounds
thirty-seven and thirty-eight drew a new tie or a new exception, so this round states rules in
their place: the bot's resyncs heal, with no cadence, and the daily-active points follow the
only-in-answer-to-an-event rule, with no list of events; what DEPLOY still claims is pinned.

- C39R1 FIXED `a5b04edb93` (with S39R1, C39R2, Q39R3 and L39R5: the restart note and lever 3 say
  the bot's resyncs heal what the link-change feed loses, with no cadence, so neither the
  role-sync interval nor a link item's own path can make them false; the resync ties, and the
  forms of call they missed, go with the hourly claim, and the bot's own suites pin the resyncs
  (`tests/discord_bot_linked_sweep.test.ts`, `tests/discord_bot_member_writes.test.ts`,
  `tests/discord_bot_sweep_cycle.test.ts`); L38R2's and T38R5's dispositions and H38R3's ruling
  note it, the ruling from round forty, Q40R5, named so in round forty-one, Q41R3). C39R2 FIXED
  (see C39R1). C39R3 FIXED (see D39R1). C39R4 FIXED (see L39R4).
- Q39R1 FIXED in this record (T38R3's disposition names C38R4's daily-active half). Q39R2 FIXED in
  the ledger (round thirty-eight's entry says the restart note names what of the outbox a stop
  loses; `41db868baa`'s body says every loss and stays as written, later hashes resting on it;
  worded as a taken batch's, lever 3 the rest, from round forty, L40R2). Q39R3 FIXED (see C39R1).
  Q39R4 FIXED `a5b04edb93` (no bot module but bot/main.ts names a `.grant`, pinned; T38R3's
  disposition notes it; every place bot code names `grant` read, from round forty, T40R1). Q39R5
  FIXED (see T39R1). Q39R6 FIXED (see T39R5). Q39R7 FIXED in this record (round thirty-eight's
  mutants bullet says the winners read was wrapped in `Promise.resolve`, what ran, where the
  evidence's label said moved; the default was doubled, as it says). Q39R8 FIXED (see L39R4).
- H39R1 FIXED (see T39R3). H39R2 FIXED (see L39R4). H39R3 FIXED (see T39R1). H39R4 FIXED
  `a5b04edb93` (the git grep helper expects exit status 0 or 1, so a git failure is never read as
  no match; T38R6's disposition notes it).
- S39R1 FIXED (see C39R1). S39R2 FIXED (see T39R3).
- D39R1 FIXED `a5b04edb93` (with C39R3 and T39R7: the winner tie's comment says the poll never
  marks a day through the service's mark call, which the tie reads by every identifier of that
  name, and the tie fails closed when `outboxHandler` is not found; T38R2's disposition notes it;
  a string key read too, from round forty, T40R7).
- T39R1 FIXED `a5b04edb93` (with H39R3, L39R3 and Q39R5: the Discord bot overview, pinned inside
  its section, points to the stop_grace_period paragraph and the third escalation lever for what a
  stop costs, and says the bot reads and writes the game through the secret-gated API, round
  thirty-eight's "only" dropped; every path bot/server_client.ts's `call()` sends is under
  `/internal/discord/`, and `call()` is its one fetch; L38R1's disposition notes it; the fetch
  count dropped with the claim DEPLOY never made, from round forty, T40R3). T39R2 FIXED
  `a5b04edb93` (the stop_grace_period paragraph lies inside Verifying health and the third lever
  inside the Incident runbook, each before the next heading; L38R1's disposition notes it; the
  paragraph pinned whole there and the runbook below the overview, from round forty, T40R4 and
  T40R5). T39R3 FIXED `a5b04edb93` (with S39R2 and H39R1: lever 3 states the rule, that what the
  bot does only in answer to an event, the daily-active points among it, is never done for one
  during the stop, with no list of the events that grant; H38R1's disposition notes it; worded
  without pronouns to untangle, from round forty, L40R3). T39R4 FIXED `a5b04edb93` (the `linesOf`
  sample holds an own-line and a multi-line comment too; T38R4's disposition notes it). T39R5
  FIXED `a5b04edb93` (with Q39R6 and L39R6: `feedCodeOf` runs on a sample whose queue reaches an
  enum, a namespace and a destructured binding, and lists the outside statement naming each; the
  boundary comment names every declaration form; Q38R1's disposition notes it; every arm of the
  reader on the sample, with a control, from round forty, T40R2). T39R6 FIXED in this record
  (round thirty-eight's still-pinned mutants rerun on this tree, below). T39R7 FIXED (see D39R1).
- L39R1 FIXED `a5b04edb93` (bot/CLAUDE.md and two bot/main.ts comments say a guild message or a
  voice state carrying a channel grants the daily-active points, at most once a UTC day, since a
  failed grant call is not retried, which answers the reader's aside too; `claimDailyActive`'s
  comment as well, from round forty, L40R1; the bullet and the daily grant's bot/main.ts comment
  claiming only what the dedupe keys on, from round forty-one, D41R1, worded so in round
  forty-two, L42R3). L39R2 FIXED in this record (round thirty-eight's section names the two stale
  feed-owner comments outside its findings, and the ledger's OWED item points to it). L39R3 FIXED
  (see T39R1). L39R4 FIXED `a5b04edb93` (with H39R2, M39R1, C39R4 and Q39R8: the compose comment
  says the stop_grace_period paragraph names what a taken batch loses and the third escalation
  lever under its Incident runbook the rest, pinned; L38R4's disposition notes it). L39R5 FIXED
  (see C39R1). L39R6 FIXED (see T39R5).
- M39R1 FIXED (see L39R4).
- Mutants on this round's new guards, each killed and its source restored: the overview saying a
  stop never affects the realm; the Verifying health heading renamed; the stop_grace_period
  paragraph moved under a new heading; a bot call outside the internal API; a second fetch in the
  server client; a grant call in another bot module; the poll taking the mark call by
  destructuring; a destructured relay state read by a new function; the outbox handler renamed.
  Round thirty-eight's still-pinned mutants, rerun on this tree (they first ran before `linesOf`'s
  comment gained a line, on the space a dropped inline comment leaves, which moved every pin below
  it by one; named so in round forty, L40R4): the relay drained through a new function, the poll
  marking what it serves, the winners read wrapped, a catch-up grant on the guild seed, another
  server module draining the relay and the compose pointer reworded, each killed, and its two
  controls as before; its two resync mutants are no longer pinned, the claim they tied having gone
  (C39R1).

## Round forty: eight fresh readers over round thirty-nine (`08f80500f1..9344adc9c4`)

Round forty's commits: `1fe98e4a80` (DEPLOY: lever 3's daily-active rule reads without pronouns to
untangle; bot/logic.ts's `claimDailyActive` comment says at most once, as bot/CLAUDE.md does; the
unit suite pins the stop_grace_period paragraph whole inside Verifying health and the Incident
runbook below the overview, reads every place the bot's code names `grant` and a mark call by
string key too, runs every arm of the declaration reader on a sample with a control, and drops the
fetch count, DEPLOY claiming no single fetch; the change log with it; kept whole for bisect), and
the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C40R1 to C40R4 |
| qa-checklist | PASS | Q40R1 to Q40R6 |
| server hot path | PASS | H40R1 to H40R3 |
| privacy and security | PASS | none |
| database performance | PASS | D40R1 |
| test coverage | PASS | T40R1 to T40R8 |
| docs librarian | PASS | L40R1 to L40R4 |
| migration safety | PASS | M40R1 to M40R2 |

28 findings: none blocking, 7 should-fix (Q40R1, Q40R2, T40R1 to T40R4, L40R1), 21 nice-to-have,
every reader passing, and five (correctness, server hot path, privacy and security, database
performance, migration safety) with no should-fix, privacy and security with no finding at all.
Six readers (counted so in round forty-one, Q41R2) found the server client's fetch count narrower
than its comment; DEPLOY claims no single fetch, so the count went. The other ties that drew a
further form now read their subject whole: the stop_grace_period paragraph, every place the bot's
code names `grant`, and every arm of the declaration reader on a sample.

- C40R1 FIXED (see T40R2). C40R2 FIXED (see T40R1). C40R3 FIXED (see T40R3). C40R4 FIXED (see
  L40R3).
- Q40R1 FIXED (see T40R4). Q40R2 FIXED (see T40R2). Q40R3 FIXED (see T40R7). Q40R4 FIXED (see
  T40R3). Q40R5 FIXED in this record (H38R3's ruling notes the 1.0 s header from round
  thirty-nine, and C39R1 names it back). Q40R6 FIXED (see L40R3).
- H40R1 FIXED (see T40R3). H40R2 FIXED (see T40R7). H40R3 FIXED (see L40R3).
- D40R1 FIXED (see T40R3).
- T40R1 FIXED `1fe98e4a80` (with C40R2: every place the bot's code names `grant`, by identifier or
  string, is the server client's method or inside `grantDailyActive`, so a direct grant anywhere
  else, bot/main.ts included, fails; Q39R4's disposition notes it; the grant route's one sender
  pinned by the client's whole surface, from round forty-one, T41R1). T40R2 FIXED `1fe98e4a80`
  (with C40R1, Q40R2 and T40R6: the sample reaches a function, a class, an enum, a namespace, an
  object binding and an array binding with a hole, lists the outside statement naming each, and
  holds one naming none; deleting any arm of `declared` or `bound`, or the boundary's filter,
  fails it, five guard mutants; T39R5's disposition notes it; a nested binding too, from round
  forty-one, T41R3). T40R3 FIXED `1fe98e4a80` (with D40R1, H40R1, M40R2, C40R3 and Q40R4: DEPLOY
  claims no single fetch, so the tie's count and its comment's "one fetch" go, and the tie says
  only that every path `call()` sends is under `/internal/discord/`; T39R1's disposition notes it;
  the client read whole, every request and every name of its fetch, from round forty-one, T41R2).
  T40R4 FIXED `1fe98e4a80` (with Q40R1: the stop_grace_period paragraph is pinned whole where the
  pointers say it is, inside Verifying health, so moving its batch-loss sentence fails; T39R2's
  disposition notes it). T40R5 FIXED `1fe98e4a80` (the Incident runbook lies below the overview's
  Enabling block, as the overview says; T39R2's disposition notes it). T40R6 FIXED (see T40R2).
  T40R7 FIXED `1fe98e4a80` (with H40R2, M40R1 and Q40R3: the winner tie reads the mark call's name
  as an identifier or a string; D39R1's disposition notes it). T40R8 FIXED in this record (the pg
  file, unchanged this round, measured 13.44 s and 13.38 s at one worker on an idle host, so its
  13.4 s header stands; two runs at 18.3 s and 18.2 s overlapped a large build on the host and are
  not counted).
- L40R1 FIXED `1fe98e4a80` (`claimDailyActive`'s comment in bot/logic.ts says the dedupe key keeps
  the reward to at most once a day and a claimed key is never released, so a failed grant call is
  not retried; L39R1's disposition notes it; worded as what the dedupe keys on, no more, from
  round forty-one, L41R1). L40R2 FIXED in the ledger (round thirty-eight's entry says the restart
  note names what a taken batch loses and lever 3 the rest; Q39R2's disposition notes it). L40R3
  FIXED `1fe98e4a80` (with H40R3, C40R4 and Q40R6: lever 3 says nothing the bot does only in
  answer to an event, the daily-active points it grants a linked member included, is done for an
  event that fell in the stop; T39R3's disposition notes it). L40R4 FIXED in this record (round
  thirty-nine's mutants bullet names the line they first ran before).
- M40R1 FIXED (see T40R7). M40R2 FIXED (see T40R3).
- Mutants on this round's new guards, each killed and its source restored: the batch-loss sentence
  split out of the grace paragraph; an Incident runbook heading above the overview; a string-keyed
  mark call in the poll; a direct grant on the guild seed. Guard mutants on the declaration
  reader, each failing at the sample: the class, enum and namespace arms of `declared` deleted in
  turn, `bound` reading no binding pattern, and the boundary list without its filter.

## Round forty-one: eight fresh readers over round forty (`9344adc9c4..c6d8366c12`)

Round forty-one's commits: `799052ee16` (the unit suite reads the bot's game client whole, every
request it makes and every name of its fetch with the member each sits in, so a second sender of
the grant route or a request outside `call()` fails; the grant rule's comment names its scope and
its git grep runs a plain prefilter; the daily-active case reads an empty clause falling into it;
the declaration reader's sample nests a binding; section L reads each rerun with a 5 s deadline,
so a hang fails the case in time for its cleanup; bot/CLAUDE.md, bot/main.ts and bot/logic.ts say
what the daily grant's dedupe keys on and no more; the pg file's Cost 13.3 s; the change log with
it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C41R1 to C41R4 |
| qa-checklist | PASS | Q41R1 to Q41R5 |
| server hot path | PASS | H41R1 |
| privacy and security | PASS | S41R1 |
| database performance | PASS | D41R1 |
| test coverage | PASS | T41R1 to T41R4 |
| docs librarian | PASS | L41R1 to L41R3 |
| migration safety | PASS | M41R1 to M41R2 |

21 findings: none blocking, 6 should-fix (C41R1, Q41R1, Q41R2, T41R1, T41R2, L41R1), 15
nice-to-have, every reader passing, and four (server hot path, privacy and security, database
performance, migration safety) with no should-fix. Five readers found the grant rule blind to a
second sender of the grant route, and one the client's requests outside `call()` unpinned once the
fetch count went; the client is now read whole. The bot's grant comments had swapped one overclaim
for another; they now say what the dedupe keys on and nothing about its count.

- C41R1 FIXED (see T41R1). C41R2 FIXED (see T41R1). C41R3 FIXED (see L41R1). C41R4 FIXED (see
  Q41R2).
- Q41R1 FIXED (see T41R1). Q41R2 FIXED in this record (with L41R2 and C41R4: round forty's summary
  counts six readers, T40R3's own and the five beside it). Q41R3 FIXED in this record (with L41R3,
  named so in round forty-two, Q42R1: C39R1's back-pointer now names its round and finding, so the
  nine notes `c6d8366c12`'s body counts are there). Q41R4 FIXED `799052ee16` (the grant rule's git
  grep runs the plain prefilter `grant`, the parser deciding, so no regex extension git builds
  differ on is needed). Q41R5 FIXED in the ledger (round thirty-eight's entry says this entry was
  worded so in rounds thirty-nine and forty).
- H41R1 FIXED (see T41R1).
- S41R1 FIXED (see T41R1).
- D41R1 FIXED `799052ee16` (with L41R1's bot/CLAUDE.md and bot/main.ts halves: they say the dedupe
  key carries the reason, the Discord id and the day (worded so in round forty-two, Q42R4), and
  claim no count; L39R1's disposition notes it).
- T41R1 FIXED `799052ee16` (with C41R1, C41R2, Q41R1, H41R1 and S41R1: bot/server_client.ts is
  read whole, every `this.call` with its member, method and path, and every name of `fetch` or
  `fetchImpl` with its member, so the grant route's one sender is the `grant` method, which the
  grant rule gives one caller; the rule's comment says the member reward `setMember` earns is the
  server's own grant, outside it; T40R1's disposition notes it; every route literal in the bot's
  code pinned to the client member that sends it, from round forty-two, C42R1). T41R2 FIXED
  `799052ee16` (the same whole read shows `fetchImpl` called in `call()` alone, its default the
  constructor's one bare `fetch`, so a request outside `call()` fails; T40R3's disposition notes
  it). T41R3 FIXED `799052ee16` (the sample's array binding nests an object binding, so `bound`
  reading one level only fails it, a guard mutant; T40R2's disposition notes it). T41R4 FIXED
  `799052ee16` (each `grantDailyActive` call's case reads every empty clause falling into it, so a
  new empty label above either fails (worded so in round forty-two, C42R3); T38R3's disposition
  notes it; a clause with statements falling through left to Biome's noFallthroughSwitchClause,
  from round forty-two, T42R2).
- L41R1 FIXED `799052ee16` (with C41R3 and M41R2: `claimDailyActive`'s comment says it only
  decides whether the request is worth sending and that the server's key, the reason, the Discord
  id and the day, stops a repeat for that key; its bot/CLAUDE.md and bot/main.ts halves landed
  with D41R1 (named so in round forty-two, Q42R3); L40R1's disposition notes it; the ledger unique
  on the linked account and the key, from round forty-two, L42R1). L41R2 FIXED (see Q41R2). L41R3
  FIXED (see Q41R3).
- M41R1 FIXED `799052ee16` (section L reads each rerun it expects to have returned, `rerun`,
  `tableRerun` and `leafRerun`, through a 5 s deadline, so a rerun that never returns fails the
  case with time left for its cleanup, and later cases are not held behind it; the dump case's
  second and third boots and the cancelled sleep too, from round forty-two, T42R3, worded so in
  round forty-three, C43R1). M41R2 FIXED (see L41R1).
- Mutants on this round's new guards, each killed and its source restored: a second client method
  sending the grant route; a request made outside `call()`; an empty case falling into the
  voice-state case; `bound` reading one level of pattern only, a guard mutant; and, in section L,
  DEPLOY's nightly statement naming the waiting realm but ending nothing, which fails case 3 at
  its deadline with "still waiting" and the dump case at its text pin, the first and the last
  cases passing (worded so in round forty-two, L42R2).

## Round forty-two: eight fresh readers over round forty-one (`c6d8366c12..6a9dc9cdb1`)

Round forty-two's commits: `08e04fb5dc` (the unit suite pins every literal in the bot's code that
writes a game API route to the client member that sends it, so a route requested from another file
or by an aliased sender fails, and reads `grantDailyActive` whole, its dedupe key's template
included; the client's comment says what its read covers, and the fall-through case read names
Biome's rule as its boundary; section L installs the dump case's spy where its finally restores it
and reads the dump case's second and third boots and the cancelled sleep through its deadline
(worded so in round forty-three, C43R1); bot/logic.ts says the server's ledger is unique on the
linked account and the grant dedupe key, and bot/CLAUDE.md and bot/main.ts name the key's three
parts; the change log with it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C42R1 to C42R3 |
| qa-checklist | PASS | Q42R1 to Q42R6 |
| server hot path | PASS | H42R1 |
| privacy and security | PASS | S42R1 |
| database performance | PASS | D42R1 |
| test coverage | PASS | T42R1 to T42R4 |
| docs librarian | PASS | L42R1 to L42R4 |
| migration safety | PASS | M42R1 |

21 findings: none blocking, 7 should-fix (C42R1, Q42R1 to Q42R3, T42R1, L42R1, L42R2), 14
nice-to-have, every reader passing, and four (server hot path, privacy and security, database
performance, migration safety) with no should-fix. Two readers found the grant route's one sender
pinned only inside the client; every route literal in the bot's code is now pinned to the member
that sends it. Four found the `claimDailyActive` comment's dedupe claim narrower than the ledger's
account and key; it now names them. Five record slips were fixed in place (counted so in round
forty-three, C43R2).

- C42R1 FIXED `08e04fb5dc` (with T42R1, S42R1 and Q42R5: every string or template part in the
  bot's code that writes `/internal/discord/` is listed with its file and member, and is exactly
  the nine client members, so a route requested from another file, through another transport or by
  an aliased sender in the client fails, a route assembled from parts left unread as the comment
  says; the client's comment says its read covers every `this.call` and every name of `fetch` or
  `fetchImpl`; T41R1's disposition notes it; filtered on `internal/discord/`, its slash dropped,
  from round forty-three, H43R2, noted so in round forty-four, L44R4). C42R2 FIXED (see L42R1).
  C42R3 FIXED in this record (T41R4 says a new empty label, what the read reads; T41R4's
  disposition notes it).
- Q42R1 FIXED in this record (Q41R3 names L41R3). Q42R2 FIXED (see L42R2). Q42R3 FIXED in this
  record (L41R1 names D41R1, which landed its bot/CLAUDE.md and bot/main.ts halves). Q42R4 FIXED
  `08e04fb5dc` (with M42R1: bot/CLAUDE.md, bot/main.ts and the manifest's round forty-one entry
  name the key's three parts, the reason, the Discord id and the day, as bot/logic.ts does, and
  D41R1's disposition says so). Q42R5 FIXED (see C42R1). Q42R6 FIXED (see T42R2).
- H42R1 FIXED (see L42R1).
- S42R1 FIXED (see C42R1).
- D42R1 FIXED (see L42R1). Beside its findings, the report noted that the dump case installed its
  query spy before the statement pins that precede the try whose finally restores it, so a pin's
  failure left the spy for later cases; it is installed at the try now (`08e04fb5dc`).
- T42R1 FIXED (see C42R1). T42R2 FIXED `08e04fb5dc` (with Q42R6, named so in round forty-three,
  Q43R1: the fall-through read's comment says a clause with statements that falls through is
  refused by Biome's noFallthroughSwitchClause, an error under the recommended preset; T41R4's
  disposition notes it). T42R3 FIXED `08e04fb5dc` (the dump case's second and third boots and the
  working session's cancelled sleep are read through the deadline too, so a cancel that never
  lands fails the case in time; M41R1's disposition notes it; the first boot and the boot behind a
  hold too, from round forty-three, C43R1, and the cleanup's wait, S43R1, split so in round
  forty-four, L44R3). T42R4 FIXED `08e04fb5dc` (`grantDailyActive` is read whole: the claim before
  the call, the server call and the dedupe key's template).
- L42R1 FIXED `08e04fb5dc` (with H42R1, D42R1 and C42R2: `claimDailyActive`'s comment says the
  server dedupes too, its reward ledger unique on the linked account and the grant dedupe key, and
  claims no outcome past that; L41R1's disposition notes it). L42R2 FIXED in this record (with
  Q42R2: round forty-one's mutants bullet says the first and the last cases passed). L42R3 FIXED
  in this record (L39R1's note credits D41R1 with the bullet and the daily grant's bot/main.ts
  comment). L42R4 FLAGGED (server/internal.ts's grant route comment names booster grants, which no
  bot code sends through that route; the server owner's, under OWED in the ledger).
- M42R1 FIXED (see Q42R4).
- Mutants on this round's new guards, each killed and its source restored: a game route requested
  from another bot file; an aliased sender in the client; the dedupe key without its day; the
  claim made after the call; and, in section L, the cancel never sent to the working session,
  which fails case 3 at its deadline, the other three cases passing (worded so in round
  forty-three, L43R4).

## Round forty-three: eight fresh readers over round forty-two (`6a9dc9cdb1..1df2e74943`)

Round forty-three's commits: `47c18284f6` (section L reads the dump case's first boot through its
deadline and checks at each stopped boot's read that it ended with an error; the boot behind a
hold is read through a ten second deadline and fails if it never settles, and the dump case's
cleanup wait is bounded; the bot route pin filters on the slashless text its grep finds, a sample
proving it catches every literal shape a route can sit in; the client's comment drops a claim past
its stated boundary; the manifest's forty-first entry is rewrapped and names round forty-two, and
a forty-third entry records it (named so in round forty-four, Q44R8); kept whole for bisect), and
the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C43R1 to C43R3 |
| qa-checklist | PASS | Q43R1 to Q43R4 |
| server hot path | PASS | H43R1, H43R2 |
| privacy and security | PASS | S43R1 |
| database performance | PASS | none |
| test coverage | PASS | T43R1 to T43R5 |
| docs librarian | PASS | L43R1 to L43R4 |
| migration safety | PASS | M43R1, M43R2 |

21 findings: none blocking, 8 should-fix (C43R1, C43R2, Q43R1, Q43R2, H43R1, T43R1, L43R1, M43R1),
13 nice-to-have, every reader passing, and two (privacy and security, database performance) with
no should-fix, database performance with no finding at all. Four readers found the dump case's
first boot read with no deadline while the record and the ledger said the deadline covered the
dump case's boots; every boot section L stops or holds behind now has one (worded so in round
forty-four, C44R1). Four found the bot route pin filtering on a leading slash its grep does not
need; the fix then filtered on the grep's text (worded so in round forty-five, Q45R3), a sample
proving every literal shape. The rest were the cleanup's unbounded wait, a stopped boot checked
only at a later count, a comment claim past its boundary, and four record slips: a count, a
one-way cross-reference, a mutants bullet's case count and a change log entry edited in place
without a note (counted so in round forty-four, Q44R2).

- C43R1 FIXED `47c18284f6` (with H43R1, T43R1 and M43R1: the dump case reads every boot it stops
  through the five second deadline and checks at the read that it ended with an error, the boot
  behind a hold is read through a ten second deadline and fails if it never settles, and round
  forty-two's intro, T42R3, M41R1's note and the ledger's ROUND FORTY-TWO (named so in round
  forty-four, Q44R7) say which boots round forty-two bounded; T42R3's disposition notes it; the
  reboot after the dump too, from round forty-four, C44R1). C43R2 FIXED in this record (with Q43R2
  and L43R2: round forty-two's summary counts five record slips). C43R3 FIXED (see H43R2).
- Q43R1 FIXED in this record (T42R2 names Q42R6). Q43R2 FIXED (see C43R2). Q43R3 FIXED (see
  L43R1). Q43R4 FIXED `47c18284f6` (the client's comment drops "by any means", so its claim stops
  at its stated boundary).
- H43R1 FIXED (see C43R1). H43R2 FIXED `47c18284f6` (with C43R3, T43R3, L43R3 and T43R4: the route
  pin filters on `internal/discord/`, the text its grep finds, so a route written without its
  leading slash is listed; a sample proves the filter catches a string, a plain template and a
  template's head, middle and tail; C42R1's disposition notes it, named so in round forty-four,
  L44R4; every bot code file parsed, from round forty-four, T44R1).
- S43R1 FIXED `47c18284f6` (with T43R2 and M43R2: the dump case's cleanup reads its boots through
  the deadline, so one hung boot cannot hold the cleanup past the case's timeout (worded so in
  round forty-four, C44R2); the wide deadline T43R2 asked for on the boot behind a hold is
  C43R1's; T42R3's disposition notes it, named so in round forty-four, L44R3; two hung boots no
  longer stack past it, from round forty-four, C44R2).
- T43R1 FIXED (see C43R1). T43R2 FIXED (see S43R1). T43R3 FIXED (see H43R2). T43R4 FIXED (see
  H43R2). T43R5 FIXED `47c18284f6` (a stopped boot's outcome is checked where it is read, so a
  deadline that fires fails at that read, not at a later count).
- L43R1 FIXED `47c18284f6` (with Q43R3: the manifest's forty-first entry is rewrapped to
  98 columns and names round forty-two, Q42R4, as the round that reworded it, worded so in round
  forty-four, Q44R3). L43R2 FIXED (see C43R2). L43R3 FIXED (see H43R2). L43R4 FIXED in this record
  (round forty-two's mutants bullet says the other three cases passed).
- M43R1 FIXED (see C43R1). M43R2 FIXED (see S43R1).
- Mutants on this round's new guards, each killed and its source restored: a game route written
  without its leading slash in another bot file; a game route in a template's middle part in
  another bot file; the route filter without its template middle arm; the route filter back on the
  leading slash; and, in section L, the dump case's first boot never settling, which fails at its
  read after the five second deadline; that boot finishing instead of ending with an error, which
  fails at its read; and the boot behind a hold never settling, which fails both cases that hold
  one after the ten second deadline.

## Round forty-four: eight fresh readers over round forty-three (`1df2e74943..43b0bfc152`)

Round forty-four's commits: `5aa9f3730d` (section L starts every boot in one place and reads each
through one helper, `settled`: a boot still waiting at its deadline has every session on the
schema advisory lock cancelled, so a boot left waiting on a lock rolls back and closes its own
client (worded so in round forty-five, H45R1), and `bootBehind` reads its boot again after a
failure for one second, and a second more after its cancel (worded so in round forty-six, Q46R7),
so no failure path stacks past the case's timeout (worded so in round forty-five, T45R3: six slow
boots in the lock order case (named so in round forty-six, L46R6) could still sum past it, failing
as a timeout); the reboot after the dump is read that way; the bot route pin parses every tracked
bot code file rather than the files a raw-text grep finds, its sample adds an escaped route, and
the client's comment names a route URL parsing rewrites as outside its read; the placeholder-split
comments name Biome's rule; `bootBehind`'s and the stopped boots' comments say what they check;
the manifest's forty-first and forty-third entries reworded and a forty-fourth added; kept whole
for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C44R1 to C44R4 |
| qa-checklist | PASS | Q44R1 to Q44R8 |
| server hot path | PASS | H44R1, H44R2 |
| privacy and security | PASS | S44R1 |
| database performance | PASS | D44R1, D44R2 |
| test coverage | PASS | T44R1 to T44R6 |
| docs librarian | PASS | L44R1 to L44R9 |
| migration safety | PASS | M44R1 to M44R3 |

35 findings: none blocking, 14 should-fix (C44R1, C44R2, Q44R1 to Q44R3, H44R1, T44R1, T44R3,
T44R4, L44R1 to L44R4, M44R1), 21 nice-to-have, every reader passing, and two (privacy and
security, database performance) with no should-fix. Five readers found the reboot after the dump
read with no deadline while the record, the ledger and round forty-three's commit title said every
boot had one; four found the first boot's two reads and the cleanup able to stack past the case's
timeout; three found a boot still waiting at its deadline left holding its locks into later cases.
All three fixes offered for the last ended the boot's backend, which a probe showed drops the
connection under a client with no error listener, an uncaught error; the boots are cancelled
instead, and every boot section L waits on is now read through the one helper that does it. Two
found the route pin's grep reading raw text where its filter reads a literal's value; every bot
code file is now parsed. The rest were record and comment slips.

- C44R1 FIXED `5aa9f3730d` (with Q44R1, T44R3, L44R1 and M44R1: the reboot after the dump is read
  through `settled` with the ten second deadline and must finish; round forty-three's summary,
  written of `47c18284f6`, now says every boot section L stops or holds behind, and the ledger's
  ROUND FORTY-THREE likewise; `47c18284f6`'s title stays as it is, since rewording it would change
  every later hash the record names; C43R1's disposition notes it). C44R2 FIXED `5aa9f3730d` (with
  H44R2, D44R2 and T44R5: `bootBehind` reads its boot again after a failure for one second, so
  with every stopped boot hung the dump case fails at its first stopped boot's read in about
  fourteen seconds, under the twenty second timeout; S43R1's disposition notes it). C44R3 FIXED
  (see Q44R3). C44R4 FIXED `5aa9f3730d` (with Q44R5, L44R7 and M44R3: `bootBehind`'s comment says
  the boot must settle within ten seconds of the hold's release, a second after a failure, and
  finish unless `mayFail`; read for a second after a failure to end it, from round forty-five,
  T45R4, noted so in round forty-six, Q46R4).
- Q44R1 FIXED (see C44R1). Q44R2 FIXED in this record (with T44R4 and L44R2: round forty-three's
  summary names the route pin's group, the cleanup's wait, the check at the read, the client
  comment and four record slips, and the ledger's ROUND FORTY-THREE names the comment trim and the
  cleanup's wait). Q44R3 FIXED `5aa9f3730d` (with C44R3 and L44R9: the manifest's forty-first
  entry says `bot/logic.ts` named the key's three parts in that round and the other two gained the
  reason in round forty-two, its forty-third entry says the forty-first names the round that
  reworded it (worded so in round forty-five, Q45R1), and L43R1's disposition says round forty-two
  reworded it; `47c18284f6`'s body, which says the entry names the round that gave the key its
  three parts, stays as it is). Q44R4 FIXED in this record (`43b0bfc152`'s body names the first
  boot's read and four record slips and leaves out the route pin's filter, the cleanup's wait, the
  check at the read and the client comment, which round forty-three's summary now names; the
  commit stays as it is). Q44R5 FIXED (see C44R4). Q44R6 FIXED `5aa9f3730d` (with L44R6 and T44R6:
  the stopped boots' comment says such a boot ends with an error, checked where it is read, so a
  boot that never ends fails at that read). Q44R7 FIXED in this record (with L44R5: C43R1 names
  the ledger's ROUND FORTY-TWO among the places it reworded). Q44R8 FIXED in this record (round
  forty-three's intro names the forty-third change log entry).
- H44R1 FIXED `5aa9f3730d` (with D44R1 and M44R2: a boot still waiting at its deadline has every
  session on the schema advisory lock cancelled, so a boot left waiting on a lock holds none into
  a later case (worded so in round forty-six, L46R7). The terminate each reader proposed was not
  used: a probe of a boot-shaped client with no error listener, against PostgreSQL 16, showed a
  terminate raising "Connection terminated unexpectedly" as an uncaught exception, while a cancel
  ended its statement with 57014, its own catch rolled back, and the lock and the backend were
  gone; sent again for up to a second, and a boot idle in its transaction past that named as
  outside it, from round forty-five, H45R1). H44R2 FIXED (see C44R2).
- S44R1 FIXED (see T44R1).
- D44R1 FIXED (see H44R1). D44R2 FIXED (see C44R2).
- T44R1 FIXED `5aa9f3730d` (with T44R2 and S44R1: the route pin parses every tracked bot code
  file, listed by `git ls-files` over the same pathspecs with a floor of three named files, so the
  filter alone decides and reads each literal's value, an escape in its text included; the sample
  adds an escaped route; the client's comment names a route spelled so URL parsing rewrites it as
  outside its read, beside one assembled from parts; H43R2's disposition notes it). T44R2 FIXED
  (see T44R1). T44R3 FIXED (see C44R1). T44R4 FIXED (see Q44R2). T44R5 FIXED (see C44R2). T44R6
  FIXED (see Q44R6).
- L44R1 FIXED (see C44R1). L44R2 FIXED (see Q44R2). L44R3 FIXED in this record (T42R3's forward
  note credits the first boot and the boot behind a hold to C43R1 and the cleanup's wait to S43R1,
  and S43R1 names it back). L44R4 FIXED in this record (C42R1 carries a forward note to H43R2's
  slashless filter, and H43R2 names it back). L44R5 FIXED (see Q44R7). L44R6 FIXED (see Q44R6).
  L44R7 FIXED (see C44R4). L44R8 FIXED `5aa9f3730d` (the five placeholder-split comments in the
  unit suite say each split is for Biome's noTemplateCurlyInString, the warning the split clears).
  L44R9 FIXED (see Q44R3).
- M44R1 FIXED (see C44R1). M44R2 FIXED (see H44R1). M44R3 FIXED (see C44R4).
- Mutants on this round's new guards, each killed and its source restored: a route with an escaped
  slash in another bot file; the route filter on raw source text; the bot file list on a pathspec
  that lists nothing; and, in section L, the boot after the dump never settling, which fails at
  its read after eleven seconds; and no boot's promise ever settling, which fails the lock order
  case (named so in round forty-seven, L47R2) at the boot behind its hold after eleven seconds and
  the dump case at its first stopped boot's read after fourteen, under the timeout. A mutant that
  drops the cancel passes by construction, since no boot hangs on a green run; H44R1's probe shows
  what the cancel does.

## Round forty-five: eight fresh readers over round forty-four (`43b0bfc152..8d54e1f9b3`)

Round forty-five's commits: `bbd3b6e4cf` (a section L case pins that `settled` returns what its
deadline saw, never what a cancel made of the boot; the cancel is sent again for up to a second,
and `settled`'s comment says what it ends; both reads of the section's lock key go through one
constant, pinned to the server's (worded so in round forty-six, C46R1); the unit suite pins
section L's one `ensureSchema` call inside `startBoot`, and checks the bot file list against a
second listing of the whole directory, keeping only files still on disk; `bootBehind`'s comment
says the read after a failure is there to end the boot; both Cost headers remeasured, 13.6 s and
1.1 s; the manifest's forty-fourth entry names the forty-third entry's rewording, and a
forty-fifth entry records it; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C45R1, C45R2 |
| qa-checklist | PASS | Q45R1 to Q45R4 |
| server hot path | PASS | H45R1 |
| privacy and security | PASS | none |
| database performance | PASS | D45R1 |
| test coverage | PASS | T45R1 to T45R6 |
| docs librarian | PASS | L45R1, L45R2 |
| migration safety | PASS | M45R1 |

17 findings: none blocking, 1 should-fix (T45R1), 16 nice-to-have, every reader passing, and seven
(all but test coverage) with no should-fix, privacy and security with no finding at all. The test
coverage auditor found nothing pinning that `settled` reports what its deadline saw, so a mutant
returning what a cancel made of the boot passed; a case now pins it. Four readers found
`settled`'s comment claiming more than one cancel ends, since PostgreSQL drops a cancel that
reaches a session between statements; the cancel repeats for a second, and the comment names a
boot idle past that as outside it. The rest were two prose-only claims made whole pins, a key
written twice, a local papercut, a comment and record slips.

- C45R1 FIXED `bbd3b6e4cf` (with Q45R2: the manifest's forty-fourth entry names the forty-third
  entry's rewording, worded so in round forty-five, and a forty-fifth entry records it). C45R2
  FIXED in the ledger (its ROUND FORTY-FOUR says every tracked bot code file; worded so in round
  forty-six, L46R5).
- Q45R1 FIXED in this record (Q44R3's disposition says the forty-third entry says the forty-first
  names the round that reworded it; worded so in round forty-six, Q46R8). Q45R2 FIXED (see C45R1).
  Q45R3 FIXED in this record (with L45R2: round forty-three's summary says the fix then filtered
  on the grep's text). Q45R4 FIXED `bbd3b6e4cf` (the bot file list keeps only tracked files still
  on disk, so a file deleted but not yet staged is skipped rather than failing the parse).
- H45R1 FIXED `bbd3b6e4cf` (with M45R1, D45R1 and L45R1: the cancel is sent again, each time
  followed by a tenth of a second's read, until the work settles or a second has passed;
  `settled`'s comment says a boot left waiting on a lock holds none into a later case, and that a
  boot idle in its transaction past the second, as during its pool probe, reads as still waiting
  and ends at the pool's own deadlines; H44R1's disposition and round forty-four's intro note it,
  the intro named so in round forty-six, Q46R2).
- D45R1 FIXED (see H45R1).
- T45R1 FIXED `bbd3b6e4cf` (a section L case pins `settled`: work already settled reads as itself,
  and work that settles 200 ms in, past a 50 ms deadline, reads as still waiting, its own error
  notwithstanding). T45R2 FIXED `bbd3b6e4cf` (one constant, `SCHEMA_LOCK_KEY`, feeds both reads of
  the advisory lock, and the index build case pins the server's key to it; every session in
  section L takes the key through it, from round forty-six, C46R1). T45R3 FIXED in this record
  (round forty-four's intro says no failure path stacks past the case's timeout, and that six slow
  boots in the lock order case (named so in round forty-six, L46R6) could still sum past it,
  failing as a timeout; `5aa9f3730d`'s body stays as it is; the ledger's ROUND FORTY-FOUR says no
  failure path stacks past it too (worded so in round forty-seven, L47R3, and round forty-eight,
  C48R5), from round forty-six, Q46R3). T45R4 FIXED `bbd3b6e4cf` (`bootBehind`'s comment says the
  boot must settle within ten seconds of the hold's release and finish unless `mayFail`, and is
  read for a second after a failure, to end it; C44R4's disposition notes it, named so in round
  forty-six, Q46R4; a second of cancels after that read, from round forty-six, Q46R7). T45R5 FIXED
  `bbd3b6e4cf` (the unit suite reads the pg suite with the TypeScript parser and pins section L's
  calls of `ensureSchema` to exactly one, inside `startBoot`; a call by another name is outside
  the read). T45R6 FIXED `bbd3b6e4cf` (the bot file list must equal a second listing of the whole
  `bot` directory filtered to the code extensions, beside the three named files).
- L45R1 FIXED (see H45R1). L45R2 FIXED (see Q45R3).
- M45R1 FIXED (see H45R1).
- Mutants on this round's new guards, each killed and its source restored: a boot started outside
  `startBoot` in section L; the bot file pathspec narrowed to `bot/[lms]*.ts`, eight files with
  the three named ones among them (worded so in round forty-six, Q46R1); `settled` returning what
  the cancel made of the boot, which fails the new case; and the section's lock key off the
  server's, which fails the index build case's pin and the dump case's advisory reads. A mutant
  sending the cancel once passes by construction, as one dropping it does.

## Round forty-six: eight fresh readers over round forty-five (`8d54e1f9b3..159a75da39`)

Round forty-six's commits: `0aa155dbc3` (the bot file listings are NUL-separated, so a name git
would quote is parsed rather than dropped from both; the unit suite pins what takes each
`startBoot` result and every `settled` call in section L with its arguments as written; every
session in section L takes the lock key through `SCHEMA_LOCK_KEY`; `settled` takes the cancel's
grace as a parameter, and the first case pins that work which never settles is let go once it is
spent; the `startBoot` pin's comment says `settled` cancels, and names element access and .call or
.apply as outside its read; `bootBehind`'s comments count the second of cancels after a failure's
read; the pg Cost header remeasured, 13.8 s; the manifest's forty-sixth entry; kept whole for
bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C46R1, C46R2 |
| qa-checklist | PASS | Q46R1 to Q46R8 |
| server hot path | PASS | H46R1 |
| privacy and security | PASS | S46R1 |
| database performance | PASS | none |
| test coverage | PASS | T46R1 to T46R6 |
| docs librarian | PASS | L46R1 to L46R9 |
| migration safety | PASS | M46R1, M46R2 |

29 findings: none blocking, 1 should-fix (S46R1), 28 nice-to-have, every reader passing, and seven
(all but privacy and security) with no should-fix, database performance with no finding at all.
Three readers found that round forty-five's skip of a file not on disk let a bot file whose name
git quotes drop silently from both listings, failing open where the parse had failed loudly; the
listings are now NUL-separated, so git quotes no name. Three found section L's sessions still
taking the lock key as a literal beside the constant, two found nothing pinning that a boot's
result reaches `settled`, and one that nothing bounded the cancel loop's grace; the literals are
now the constant, no pin reading for one, and the other two are now pinned (worded so in round
forty-seven, Q47R2). The rest were comments and record notes that said less or more than the code,
each reworded.

- C46R1 FIXED `0aa155dbc3` (with Q46R6 and M46R1: the six literals in section L's runner, waiter,
  realm and dropper sessions are `SCHEMA_LOCK_KEY`, the decimal in DEPLOY's quoted diagnosis left
  as DEPLOY writes it; round forty-five's intro and the ledger's ROUND FORTY-FIVE say both reads
  go through the one constant; T45R2's disposition notes it). C46R2 FIXED `0aa155dbc3` (with S46R1
  and T46R1: both listings run `git ls-files -z` and split on NUL, so git quotes no name, and the
  comment says why; with a tracked bot file named `bot/naïve_feed.ts` holding a route, the route
  pin lists it; only what git reports deleted skipped, from round forty-seven, H47R2).
- Q46R1 FIXED in this record (with T46R4 and L46R2: round forty-five's mutants bullet names the
  narrowed pathspec, `bot/[lms]*.ts`, eight files with the three named ones among them). Q46R2
  FIXED in this record (with L46R4: H45R1 names round forty-four's intro). Q46R3 FIXED in the
  ledger (with L46R3: its ROUND FORTY-FOUR says no failure path stacks past the case's timeout;
  T45R3's disposition notes it). Q46R4 FIXED in this record (C44R4 carries a forward note to
  T45R4, and T45R4 names it back). Q46R5 FIXED `0aa155dbc3` (with L46R1: the `startBoot` pin's
  comment says `settled` cancels a boot still waiting). Q46R6 FIXED (see C46R1). Q46R7 FIXED
  `0aa155dbc3` (with H46R1 and T46R6: `bootBehind`'s comment and the comment at its read say a
  failure's second of reading is followed by up to a second of cancels, and round forty-four's
  intro says so; T45R4's disposition notes it). Q46R8 FIXED in this record (with L46R9: Q45R1's
  disposition quotes Q44R3 as it reads; `159a75da39`'s body, which leaves out T45R4's comment and
  counts H45R1 among the rest, stays as it is).
- H46R1 FIXED (see Q46R7).
- S46R1 FIXED (see C46R2).
- T46R1 FIXED (see C46R2). T46R2 FIXED `0aa155dbc3` (`settled` takes the cancel's grace as a
  parameter, a second by default, and the first case pins that work which never settles is let go
  after its cancels (worded so in round forty-seven, C47R2), so a loop without its time bound
  hangs the case; the grace bounded by a count of its cancels and its default pinned as written by
  the unit suite (worded so in round forty-eight, T48R1), from round forty-seven, C47R2). T46R3
  FIXED `0aa155dbc3` (with M46R2: the unit suite pins what takes each `startBoot` result, three
  assignments and one `settled` call, and every `settled` call in section L with its arguments as
  written, so a boot whose `startBoot` or `settled` call changes fails until reviewed (worded so
  in round forty-seven, Q47R1); every read of a boot's name pinned whole, from round forty-seven,
  Q47R1). T46R4 FIXED (see Q46R1). T46R5 FIXED `0aa155dbc3` (with L46R8: the pin's comment names a
  call through element access, .call or .apply as outside its read; every other mention of
  `startBoot` pinned to its declaration, so the boundary now names only `ensureSchema`, from round
  forty-seven, C47R1; stated as which calls are read, from round forty-eight, C48R4). T46R6 FIXED
  (see Q46R7).
- L46R1 FIXED (see Q46R5). L46R2 FIXED (see Q46R1). L46R3 FIXED (see Q46R3). L46R4 FIXED (see
  Q46R2). L46R5 FIXED in this record (C45R2 says its fix is in the ledger). L46R6 FIXED in this
  record (round forty-four's intro and T45R3 name the lock order case, the section's first case
  now starting no boot). L46R7 FIXED in this record (H44R1 opens with what the cancel ends: a boot
  left waiting on a lock holds none into a later case). L46R8 FIXED (see T46R5). L46R9 FIXED (see
  Q46R8).
- M46R1 FIXED (see C46R1). M46R2 FIXED (see T46R3).
- Mutants on this round's new guards, each killed and its source restored: a `startBoot` result
  read outside `settled` (the reboot after the dump read bare), at the pin of what takes each
  result; the cancel loop without its time bound, and with it joined by or, each hanging the first
  case past its timeout; and a tracked bot file named `bot/naïve_feed.ts` holding a route, added
  with intent-to-add and removed after, which the route pin lists. With the listings' `-z` dropped
  as well, the case still failed, but only because another pin's `git grep` handed the quoted path
  to the parser; the route pin's own read had dropped the file.

## Round forty-seven: eight fresh readers over round forty-six (`159a75da39..f198465d44`)

Round forty-seven's commits: `0cf1e2f6f9` (the unit suite pins every read of a section L boot's
name by the expression it sits in, `settled`'s parameters as written, that every other mention of
`startBoot` is its declaration, and that only an assignment counts as one in the readers pin; the
dump case's later boots are named `secondBoot` and `thirdBoot`, so no other case's names collide;
the first case counts the cancels a 300 ms grace sends; the bot listings skip only what git
reports deleted, so a name that does not decode fails at the parse; `bootBehind`'s comment says
each cancel is followed by a read of at most 100 ms; the pg Cost header remeasured, 14.0 s; the
manifest's forty-seventh entry; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C47R1 to C47R3 |
| qa-checklist | PASS | Q47R1 to Q47R6 |
| server hot path | PASS | H47R1, H47R2 |
| privacy and security | PASS | S47R1 |
| database performance | PASS | D47R1 |
| test coverage | PASS | T47R1 to T47R4 |
| docs librarian | PASS | L47R1 to L47R5 |
| migration safety | PASS | M47R1 |

23 findings: none blocking, 3 should-fix (Q47R1, T47R1, L47R1), 20 nice-to-have, every reader
passing, and five (correctness, server hot path, privacy and security, database performance,
migration safety) with no should-fix. Two readers found the new pins reading only where each
`startBoot` result goes and each `settled` call's text, so a bare read of a boot beside them
passed; every read of a boot's name is now pinned by the expression it sits in. Three found the
cancel's grace unpinned beyond the loop ending; the first case now counts the cancels a 300 ms
grace sends, and the unit suite pins the default. Three found a bot file whose name does not
decode dropping from both listings; only what git reports deleted is skipped now, so such a name
fails closed. The rest were a comment on the read after the cancels, an operator the readers pin
did not check, record wording and two commit bodies, and two readings ruled, Q47R6 and L47R5
(named so in round forty-eight, Q48R4).

- C47R1 FIXED `0cf1e2f6f9` (with Q47R4 and T47R2: the readers pin counts a binary expression as an
  assignment only when its operator is `=`, and every mention of `startBoot` in section L other
  than a call is pinned to be its declaration, so a boot started through another reference fails;
  T46R5's disposition notes it). C47R2 FIXED `0cf1e2f6f9` (with Q47R5 and T47R1: the first case
  counts the cancels a 300 ms grace sends, two or three, each followed by a 100 ms read, so a
  grace ignored for a second or taken from the deadline fails (worded so in round forty-eight,
  T48R1); the unit suite pins `settled`'s parameters as written, its one-second default among
  them; the ledger's ROUND FORTY-SIX says the loop's time bound is what round forty-six pinned;
  T46R2's disposition says the first case lets go of such work after its cancels, and notes it
  (named so in round forty-eight, L48R5); `settled` read whole, so the grace's use and the read
  after each cancel are pinned as written, from round forty-eight, T48R1, and a 250 ms grace,
  H48R1). C47R3 FIXED `0cf1e2f6f9` (with D47R1, H47R1, L47R4 and M47R1: `bootBehind`'s comment
  says a boot still waiting after a failure's read has its cancel sent for up to a second more,
  each cancel followed by a read of at most 100 ms).
- Q47R1 FIXED `0cf1e2f6f9` (with L47R1: the dump case's later boots are named `secondBoot` and
  `thirdBoot`, and the unit suite pins every read of `boot`, `secondBoot`, `thirdBoot` and `work`
  in section L by the expression it sits in, so a boot read beside or instead of `settled` fails
  until reviewed; the pin's comment says so (a binding that shadows `settled` passed that pin; the
  pin of each mention of `settled` and section L's digest make it fail, from round forty-nine,
  T49R1, named so in round fifty, L50R1); T46R3's disposition says a boot whose `startBoot` or
  `settled` call changes fails until reviewed, and notes it (named so in round forty-eight,
  L48R5); every `during` callback's parameters pinned, so a callback that takes the boot it is
  handed names it `boot` (worded so in round forty-nine, C49R2), from round forty-eight, C48R1).
  Q47R2 FIXED in this record (round forty-six's summary says the literals became the constant with
  no pin reading for one; `f198465d44`'s body, which says now pinned, stays as it is). Q47R3 FIXED
  in this record (`0aa155dbc3`'s subject says every boot read is pinned and its body that the
  cancel lets go of a boot that never settles, where the case's work is no boot and `settled`'s
  bound lets it go; both stay as they are). Q47R4 FIXED (see C47R1). Q47R5 FIXED (see C47R2).
  Q47R6 RULED, no change: round forty-four's intro describes `5aa9f3730d`, whose `settled` sent
  one cancel and then read for a second; the repeated cancels came in `bbd3b6e4cf`, which round
  forty-five's record describes.
- H47R1 FIXED (see C47R3). H47R2 FIXED `0cf1e2f6f9` (with S47R1 and T47R3: each bot listing skips
  only what `git ls-files -z --deleted` reports, so a tracked name that does not decode is kept
  and fails at the parse, as a tracked `bot/` file whose name is not UTF-8 did, rather than
  dropping from both; C46R2's disposition notes it; read as raw bytes, from round forty-eight,
  S48R1, and each skipped name checked missing from disk, T48R2).
- S47R1 FIXED (see H47R2).
- D47R1 FIXED (see C47R3).
- T47R1 FIXED (see C47R2). T47R2 FIXED (see C47R1). T47R3 FIXED (see H47R2). T47R4 FIXED in this
  record (this round's two listing mutants hold a route that no other grep in the case reads, so
  each kill is the route pin's own or the parse's).
- L47R1 FIXED (see Q47R1). L47R2 FIXED in this record (round forty-four's mutants bullet names the
  lock order case). L47R3 FIXED in this record (T45R3 says the ledger's ROUND FORTY-FOUR says so
  too). L47R4 FIXED (see C47R3). L47R5 RULED, no change: the cancel's filter reads only this
  file's own database, which no other pg file uses, as four readers checked; a session of another
  file is never on it.
- M47R1 FIXED (see C47R3).
- Mutants on this round's new guards, each killed and its source restored: a bare read of a boot
  beside `settled`, at the reads pin; `startBoot` passed by reference, and a result joined by ??
  rather than assigned, at the readers pin; the default grace raised, at the parameters pin; the
  grace ignored for a second, and taken from the deadline, at the first case's count of cancels;
  and, with intent-to-add files removed after, a tracked bot file named `bot/naïve_feed.ts`
  holding a route no other grep reads, which the route pin lists, and one whose name is not UTF-8,
  which fails at the parse.

## Round forty-eight: eight fresh readers over round forty-seven (`f198465d44..a9114ed955`)

Round forty-eight's commits: `75daea653c` (the unit suite reads section L's lock key, lock filter,
`startBoot` and `settled` whole, comments dropped, and pins every mention of `during` by where it
sits and each callback passed as one by its parameters; the boundary comment states which calls of
`ensureSchema` are read; the first case checks that each counted call is the cancel and uses a
250 ms grace; the bot listings are read as raw bytes, check that each skipped name is missing from
disk, and take `.tsx` and `.jsx` files; the pg Cost header remeasured, 13.9 s; the manifest's
forty-eighth entry; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C48R1 to C48R5 |
| qa-checklist | PASS | Q48R1 to Q48R4 |
| server hot path | PASS | H48R1 |
| privacy and security | PASS | S48R1, S48R2 |
| database performance | PASS | D48R1 |
| test coverage | PASS | T48R1 to T48R3 |
| docs librarian | PASS | L48R1 to L48R6 |
| migration safety | PASS | M48R1 |

23 findings: none blocking, 5 should-fix (C48R1, Q48R1, T48R1, L48R1, L48R2), 18 nice-to-have,
every reader passing, and four (server hot path, privacy and security, database performance,
migration safety) with no should-fix. Five readers found that a `during` callback could take the
boot under a name the reads pin does not list; every `during` callback's parameters are now
pinned. One found `settled`'s use of the grace and its read after each cancel held only to a band
by the count, and one its cancel statement unpinned; the section's lock key, lock filter,
`startBoot` and `settled` are now read whole. Two found the boundary comment no longer naming
every call of `ensureSchema` it misses; it now states which calls are read. The rest were the
listings' decoding, deleted-file and JSX edges, a grace on a timer's edge, record wording, two
dropped blank lines and two commit bodies.

- C48R1 FIXED `75daea653c` (with Q48R1, T48R3, L48R1 and M48R1: the unit suite pins every mention
  of `during` in section L by where it sits, and each callback passed as one by its parameters as
  written, so a boot handed to a callback under a name other than `boot` fails until reviewed; the
  pin block's comment says so; `0cf1e2f6f9`'s body, which says a boot read beside or instead of
  `settled` fails until reviewed, stays as it is; Q47R1's disposition notes it; only arrows taken
  as callbacks, from round forty-nine, Q49R4). C48R2 FIXED in this record (with Q48R2 and L48R4:
  the blank line before round forty-five's heading is back, and before round twenty-nine's, which
  the same rewrap fault had dropped). C48R3 FIXED in the ledger (with Q48R3 and L48R3: its ROUND
  FORTY-SEVEN names the operator the readers pin did not check; `a9114ed955`'s body, which leaves
  it out, stays as it is). C48R4 FIXED `75daea653c` (with L48R2: the pin block's comment says only
  a call written `ensureSchema(...)` or `x.ensureSchema(...)` is read; T46R5's disposition notes
  it; optional chains named among the calls read, from round forty-nine, L49R4). C48R5 FIXED in
  this record (with L48R6: T45R3 says the ledger's ROUND FORTY-FOUR says no failure path stacks
  past the timeout).
- Q48R1 FIXED (see C48R1). Q48R2 FIXED (see C48R2). Q48R3 FIXED (see C48R3). Q48R4 FIXED in this
  record (round forty-seven's summary names its two rulings).
- H48R1 FIXED `75daea653c` (the first case's grace is 250 ms, so its third read always ends past
  it and a fourth cancel cannot start, whatever a timer's millisecond edge; the count stays two or
  three; C47R2's disposition notes it).
- S48R1 FIXED `75daea653c` (each bot listing is read as raw bytes and compared before decoding, so
  two names that decode alike stay apart; H47R2's disposition notes it). S48R2 FIXED `75daea653c`
  (the route pin's bot pathspecs (named so in round forty-nine, L49R1) and the second listing's
  filter take `.tsx` and `.jsx` files, which the bot's bundler resolves; a tracked `bot/feed.tsx`
  holding a route is listed by the route pin, and one holding JSX fails at the no-JSX pin, from
  round forty-nine, S49R1, named so in round fifty, L50R3; the grant pin's too, from round
  forty-nine, L49R1).
- D48R1 FIXED `75daea653c` (the first case checks that each counted call is the cancel of the
  schema lock's sessions, statement and key as `settled` sends them).
- T48R1 FIXED `75daea653c` (the unit suite reads the section's lock key, lock filter, `startBoot`
  and `settled` whole, comments dropped, so the grace's use, the read after each cancel and the
  cancel statement are pinned as written; C47R2's and T46R2's dispositions say what the count
  bounds; C47R2's disposition notes it). T48R2 FIXED `75daea653c` (every name a listing skips is
  checked missing from disk, a name that decodes (worded so in round forty-nine, C49R1), so a
  listing that skips anything else fails; H47R2's disposition notes it; each listed name probed by
  its raw bytes both ways, from round forty-nine, C49R1). T48R3 FIXED (see C48R1).
- L48R1 FIXED (see C48R1). L48R2 FIXED (see C48R4). L48R3 FIXED (see C48R3). L48R4 FIXED (see
  C48R2). L48R5 FIXED in this record (C47R2 and Q47R1 say how they reworded T46R2 and T46R3).
  L48R6 FIXED (see C48R5).
- M48R1 FIXED (see C48R1).
- Mutants on this round's new guards, each killed and its source restored: a `during` callback
  taking the boot under another name, at the `during` pin; the grace halved, the read after each
  cancel lengthened, and the cancel made a terminate, each at the whole read of `settled`, the
  last also at the first case's check of each counted call; `--modified` listed for `--deleted`
  with a bot file edited, at the check that each skipped name is missing from disk; and a tracked
  `bot/feed.tsx` holding a route, added with intent-to-add and removed after, which the route pin
  lists.

## Round forty-nine: eight fresh readers over round forty-eight (`a9114ed955..6b38b121f2`)

Round forty-nine's commits: `b9789aa5ad` (the unit suite reads section L's code whole by digest,
comments dropped; pins every mention of `settled` and of `within` in the section as a call, bar
`settled`'s declaration, and `within` itself whole; takes only arrows as `during` callbacks; the
bot listings probe each listed name's raw bytes both ways against git's deleted list; bot code may
hold no JSX, and the grant pin takes `.tsx` and `.jsx` files; the pin block's comment, rewrapped,
names optional chains among the calls read, says a `during` callback that takes the boot names it
`boot`, and says the digest backs the named pins; the unit Cost header remeasured, 1.2 s; the
manifest's forty-ninth entry; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C49R1 to C49R3 |
| qa-checklist | PASS | Q49R1 to Q49R5 |
| server hot path | PASS | H49R1, H49R2 |
| privacy and security | PASS | S49R1, S49R2 |
| database performance | PASS | D49R1 |
| test coverage | PASS | T49R1 to T49R5 |
| docs librarian | PASS | L49R1 to L49R4 |
| migration safety | PASS | M49R1 |

23 findings: none blocking, 2 should-fix (C49R1, T49R1), 21 nice-to-have, every reader passing,
and six (all but correctness and test coverage) with no should-fix. Five readers found the
skipped-name check probing a decoded name, so for a name that does not decode it checked nothing;
it now probes each listed name's raw bytes both ways. One found a binding that shadows `settled`
passing every named pin; since these pins kept drawing one more form, section L is now also read
whole by digest, so any change to its code fails until reviewed, and the mentions of `settled` and
`within`, and `within` itself, are pinned. Five found a `during` callback written as a function
expression able to read its boot through `arguments`; only arrows pass now. The rest were `within`
read by no pin, JSX in bot code, the grant pin's extensions, comment and ledger wording and a
commit body (counted so in round fifty, Q50R1).

- C49R1 FIXED `b9789aa5ad` (with Q49R3, S49R2, T49R3 and L49R3: each listing's names are probed by
  their raw bytes, and a listed name must be on disk exactly when git does not report it deleted,
  so a skip of a present file fails whatever its name, the kept files the positive arm and the
  mutant below whose bot file name is not UTF-8, `--modified` listed for `--deleted`, the other
  (named so in round fifty-one, C51R4), which a clean tree never reaches (named so in round fifty,
  T50R2); T48R2's disposition notes it). C49R2 FIXED `b9789aa5ad` (with H49R2, Q49R5, T49R5 and
  L49R2: the pin block's comment is rewrapped and says a `during` callback that takes the boot it
  is handed names it `boot`, and Q47R1's note says the same). C49R3 FIXED in the ledger (with
  Q49R1: its ROUND FORTY-EIGHT names the 250 ms grace and the boundary comment).
- Q49R1 FIXED (see C49R3). Q49R2 FIXED in this record (`6b38b121f2`'s body leaves out D48R1's
  per-call check, which round forty-eight's summary names; the commit stays as it is). Q49R3 FIXED
  (see C49R1). Q49R4 FIXED `b9789aa5ad` (with H49R1, D49R1, M49R1 and T49R4: the `during` pin
  reads only an arrow's parameters, so a function expression, which could read the boot through
  `arguments`, maps to its PropertyAssignment and fails, and a callback moved under a computed key
  drops out of the pin's list, which fails one entry short, while one added under a computed key
  fails at the digest (worded so in round fifty, C50R2); C48R1's disposition notes it). Q49R5
  FIXED (see C49R2).
- H49R1 FIXED (see Q49R4). H49R2 FIXED (see C49R2).
- S49R1 FIXED `b9789aa5ad` (bot code may hold no JSX, so a route in JSX text or in an attribute
  spelled with an HTML entity cannot sit where the route read does not take it; S48R2's
  disposition notes it, named so in round fifty, L50R3). S49R2 FIXED (see C49R1).
- D49R1 FIXED (see Q49R4).
- T49R1 FIXED `b9789aa5ad` (every mention of `settled` in section L but its declaration is a call
  by name, so a binding that shadows it fails; and since the named pins kept drawing one more
  form, the section's code is read whole by digest, comments dropped, so any change to it fails
  until reviewed against them; Q47R1's disposition notes it, named so in round fifty, L50R1).
  T49R2 FIXED `b9789aa5ad` (`within` is read whole and every mention of it in the section is a
  call, with a count above zero as the control; every name section L reads from around it pinned
  with how often it is declared there, once each, from round fifty, C50R1). T49R3 FIXED (see
  C49R1). T49R4 FIXED (see Q49R4). T49R5 FIXED (see C49R2).
- L49R1 FIXED `b9789aa5ad` (the grant pin's bot pathspecs take `.tsx` and `.jsx` files, and S48R2
  names the route pin's; S48R2's disposition notes it; the feed-verb grep's extensions, outside
  this pin, are its owner's). L49R2 FIXED (see C49R2). L49R3 FIXED (see C49R1). L49R4 FIXED
  `b9789aa5ad` (the comment names optional chains among the calls of `ensureSchema` read; C48R4's
  disposition notes it).
- M49R1 FIXED (see Q49R4).
- Mutants on this round's new guards, each killed and its source restored: a binding that shadows
  `settled`, at the pin of its mentions; `within` reading twice its deadline, at its whole read; a
  `during` callback as a function expression, and one under a computed key, at the `during` pin; a
  line no other pin reads changed in section L, at the digest; and, with intent-to-add files
  removed after, a tracked `bot/feed.tsx` holding JSX, at the no-JSX pin, a tracked bot file whose
  name is not UTF-8 with `--modified` listed for `--deleted`, at the raw-byte check, and a grant
  call in a tracked `bot/daily.tsx`, at the grant pin.

## Round fifty: eight fresh readers over round forty-nine (`6b38b121f2..376b3c0122`)

Round fifty's commits: `e448b6d828` (the unit suite pins every name section L reads from the
scopes around it, the suite's callback and the module, with how many times those scopes declare
it, once each; the bot's directory holds no module but code and `bot/CLAUDE.md`; the bot's imports
from outside its directory are pinned and those modules read for routes; kept bot names are
distinct; each bot code file is parsed once for the JSX check, the outside-import read and the
route read (worded so in round fifty-one, C51R5); the JSX check is proven on a sample of each JSX
root; the grant pin reads `botCode`; the pin block's comment names the module-level `within` and
says code around the section is read only where a pin names it, and the digest's comment says how
`linesOf` reads; the manifest's fiftieth entry; kept whole for bisect), and the commit that adds
this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C50R1 to C50R3 |
| qa-checklist | PASS | Q50R1 to Q50R5 |
| server hot path | PASS | H50R1 |
| privacy and security | PASS | S50R1 to S50R3 |
| database performance | PASS | D50R1, D50R2 |
| test coverage | PASS | T50R1 to T50R5 |
| docs librarian | PASS | L50R1 to L50R3 |
| migration safety | PASS | M50R1 |

23 findings: none blocking, 4 should-fix (C50R1, D50R1, T50R1, M50R1), 19 nice-to-have, every
reader passing, and four (qa-checklist, server hot path, privacy and security, docs librarian)
with no should-fix. Three readers found that a `within` bound in the suite's callback, outside
section L, would shadow the one read whole, past every pin and the digest; every name the section
reads from around it is now pinned with how often those scopes declare it. Two found the no-JSX
check proven on one root only; it is proven on a sample of each now. The rest were modules the
bot's bundler loads beside its code, two kept bot names that decode alike, the grant pin's copy of
the pathspecs, a second parse of each bot file, comment and record wording, and a commit body
(counted so in round fifty-one, Q51R4).

- C50R1 FIXED `e448b6d828` (with D50R1 and M50R1: every name section L reads that the suite's
  callback or the module declares is pinned with how many times those scopes declare it, once
  each, so a second variable, function, class or import binding of `within`, or of any other such
  name, fails (worded so in round fifty-three, L53R5); T49R2's disposition notes it; the scopes'
  parameters and a hoisted `var` pinned out and types counted, from round fifty-one, C51R2, and
  `e448b6d828`'s body, which says a second binding that would shadow one fails, stays as it is).
  C50R2 FIXED in this record (Q49R4 says a callback moved under a computed key fails at the
  `during` pin and one added under one fails at the digest). C50R3 FIXED in the ledger (with Q50R2
  and L50R2: its ROUND FORTY-EIGHT note follows the clauses round forty-nine reworded).
- Q50R1 FIXED in this record and the ledger (round forty-nine's summary and the ledger's ROUND
  FORTY-NINE name `within` read by no pin; `376b3c0122`'s body, which leaves it out, stays as it
  is). Q50R2 FIXED (see C50R3). Q50R3 FIXED `e448b6d828` (with T50R3: the grant pin greps
  `botCode`, so the two reads take the same pathspecs). Q50R4 FIXED `e448b6d828` (the digest's
  comment says `linesOf` drops comments, trims lines and leaves blank lines out). Q50R5 FIXED
  `e448b6d828` (with T50R1: the JSX check's predicate is proven on a sample holding an element, a
  self-closing element and a fragment, each found, before it reads the bot's files).
- H50R1 FIXED `e448b6d828` (with T50R5: each bot code file is parsed once and its nodes shared by
  the JSX check, the outside-import read and the route read; the grant pin still parses the files
  its grep finds, and `e448b6d828`'s body, which says each file is parsed once, stays as it is,
  noted so in round fifty-one, C51R5).
- S50R1 FIXED `e448b6d828` (every tracked file in the bot's directory that is not code is named,
  `bot/CLAUDE.md` alone, so a module the bundler loads beside code fails until a read takes it).
  S50R2 FIXED `e448b6d828` (every string in bot code that starts `../` is pinned with its file,
  the three imports of `src/sim/discord_roles` and `src/sim/discord_tier`, and those two modules
  are read for routes, none found; in their place the bot's bundle read as esbuild builds it, from
  round fifty-one, C51R3). S50R3 FIXED `e448b6d828` (the kept bot names are checked distinct, so
  two names that decode alike fail).
- D50R1 FIXED (see C50R1). D50R2 FIXED `e448b6d828` (the pin block's comment says the digest
  covers forms inside the section, every name read from around it is declared once there, and code
  around it is read only where a pin names it).
- T50R1 FIXED (see Q50R5). T50R2 FIXED in this record (C49R1 names round forty-nine's mutant whose
  bot file name is not UTF-8, `--modified` listed for `--deleted`, worded so in round fifty-one,
  C51R4, as the proof of the direction a clean tree never reaches). T50R3 FIXED (see Q50R3). T50R4
  FIXED `e448b6d828` (the comment names the `within` it pins as the module-level one). T50R5 FIXED
  (see H50R1).
- L50R1 FIXED in this record (Q47R1 says a binding that shadows `settled` passed its pin and names
  T49R1, which names it back). L50R2 FIXED (see C50R3). L50R3 FIXED in this record (S48R2 names
  the no-JSX pin from S49R1, which names it back).
- M50R1 FIXED (see C50R1).
- Mutants on this round's new guards, each killed and its source restored: a `within` bound again
  in the suite's callback, at the pin of the names read from around section L; the JSX predicate
  without its element arm, at the sample; a route moved into `src/sim/discord_tier.ts`, at the
  read of the bot's outside modules; a new import from outside the bot's directory, at the import
  pin; and, added with intent-to-add and removed after, a tracked `bot/routes.json` holding a
  route, at the list of the bot's non-code files.

## Round fifty-one: eight fresh readers over round fifty (`376b3c0122..c6e7f080f9`)

Round fifty-one's commits: `33eff5391f` (the bot route read takes its modules from esbuild's own
list of the bot's bundle, built with the build script's options, which are pinned whole, and names
the bundle's one package; the relative-import pin and the fixed read of the two sim modules give
way to it; `botCode` is one eight-entry list, and the bot's directory is listed once; a module
lookup outside the bundle throws; the scopes around section L must take no parameters, the pg
suite may hold no `var`, proven on a sample, and type declarations count among the names declared
there; the pin block's comment says so; the unit Cost header remeasured, 1.3 s; the manifest's
fifty-first entry; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C51R1 to C51R6 |
| qa-checklist | PASS | Q51R1 to Q51R4 |
| server hot path | PASS | H51R1 to H51R3 |
| privacy and security | PASS | S51R1 to S51R3 |
| database performance | PASS | D51R1 |
| test coverage | PASS | T51R1 to T51R4 |
| docs librarian | PASS | L51R1 to L51R3 |
| migration safety | PASS | M51R1 |

25 findings: none blocking, 7 should-fix (C51R1, Q51R1, S51R1, T51R1, T51R2, L51R1, L51R2), 18
nice-to-have, every reader passing, and three (server hot path, database performance, migration
safety) with no should-fix. Seven readers found the names-around pin blind to a parameter of the
scopes around section L, a `var` hoisted into them from a nested block, or a type declared there;
those scopes must now take no parameters, the suite may hold no `var`, and types are counted.
Three found the bot reaching modules outside its directory by the tsconfig alias or a `./..` path
the import pin did not read; the route read now takes its modules from esbuild's own list of the
bot's bundle, the build script's options pinned whole. Three found the record naming a mutant by
an id only the evidence holds. One should-fix rested on a misread: `botCode` held the JSX
pathspecs by a `push` on the next line, now one list. The rest were the parse-once wording, round
fifty's summaries, a second listing, a lookup that failed open, and a reading of round
forty-nine's `.tsx` mutant that its log rules out (counted so in round fifty-two, C52R2).

- C51R1 RULED, no change to the record: `botCode` gained `bot/*.tsx` and `bot/*.jsx` by a `push`
  on the line after its declaration, so the grant pin greps all eight pathspecs and L49R1 stands;
  `botCode` is now one eight-entry list (`33eff5391f`) so it reads at once. C51R2 FIXED
  `33eff5391f` (with Q51R1, H51R3, D51R1, T51R1, L51R2 and M51R1: the scopes around section L must
  take no parameters; the pg suite may hold no `var`, which could hoist into them from a nested
  block, a `for` head or a label, the count proven on a sample; and type aliases, interfaces,
  enums, namespaces and import-equals count among the names declared there; the pin block's
  comment says so, and the ledger's ROUND FIFTY says what round fifty's pin held; C50R1's
  disposition notes it; type parameters and a function expression's name pinned out too, from
  round fifty-two, D52R1, and the ledger's ROUND FIFTY reworded to the bindings round fifty's pin
  counted, from round fifty-two, C52R1). C51R3 FIXED `33eff5391f` (with S51R1, T51R2, S51R2 and
  T51R3: the route read takes its modules from esbuild's own list of the bot's bundle, built with
  the options of `scripts/build_bot.mjs`, which are read whole; the bundle's modules from this
  repository must be the bot's code files and the two shared sim modules, and its packages `ws`
  alone, so the tsconfig alias, a `./..` path, a `.tsx` esbuild prefers or a `.json` import fails
  until a read takes it; S50R2's disposition notes it; a package taken only from the root
  `node_modules`, from round fifty-two, S52R1). C51R4 FIXED in this record (with Q51R2 and L51R1:
  C49R1 and T50R2 describe the mutant they name rather than an id only the evidence holds). C51R5
  FIXED in this record (with H51R1 and Q51R3: round fifty's intro and H50R1 say which reads share
  the one parse, the grant pin parsing its own). C51R6 RULED, no change: round forty-nine's mutant
  of a tracked `bot/feed.tsx` ran with `botCode` holding `.tsx`, and its log shows the no-JSX pin
  failing, the listing check passing.
- Q51R1 FIXED (see C51R2). Q51R2 FIXED (see C51R4). Q51R3 FIXED (see C51R5). Q51R4 FIXED in this
  record and the ledger (with L51R3: round fifty's summary and the ledger's ROUND FIFTY name the
  check that kept bot names are distinct; `c6e7f080f9`'s body, which leaves it out, stays as it
  is).
- H51R1 FIXED (see C51R5). H51R2 FIXED `33eff5391f` (the bot's directory is listed once and the
  list shared by both of its checks). H51R3 FIXED (see C51R2).
- S51R1 FIXED (see C51R3). S51R2 FIXED (see C51R3). S51R3 FIXED `33eff5391f` (with T51R4: a module
  lookup outside the bundle throws, so no read can pass on an empty list).
- D51R1 FIXED (see C51R2).
- T51R1 FIXED (see C51R2). T51R2 FIXED (see C51R3). T51R3 FIXED (see C51R3). T51R4 FIXED (see
  S51R3).
- L51R1 FIXED (see C51R4). L51R2 FIXED (see C51R2). L51R3 FIXED (see Q51R4).
- M51R1 FIXED (see C51R2).
- Mutants on this round's new guards, each killed and its source restored: a `var within` hoisted
  from a nested block of the suite's callback, at the `var` count; a `within` parameter on the
  suite's callback, at the parameters pin; a type alias shadowing a type section L reads, at the
  names-around pin; the bot reaching a module through the tsconfig alias, and a new module through
  `./..`, at the bundle's module list; a build option added to the bot's build script, at its
  whole read; and, added with intent-to-add and removed after, a tracked `bot/routes.json`
  imported by `bot/main.ts`, at the list of the bot's non-code files.

## Round fifty-two: eight fresh readers over round fifty-one (`c6e7f080f9..17478cc191`)

Round fifty-two's commits: `e4cf5bb85e` (the bundle read takes a package only from the root
`node_modules`, proven on a sample, sorts its packages, ties its build options to the script's
pinned lines and proves its lookup throws outside the bundle; the read of the declarations around
section L and the read of the names the functions around it bind are each proven on a sample
(worded so in round fifty-four, L54R1; `e4cf5bb85e`'s title and body, which say every read of the
scopes is proven on a sample (worded so in round fifty-five, Q55R3), stay as they are), and the
functions around the section may bind no name of their own, type parameters and a function
expression's name included; the parse map's comment says which reads take it; the manifest's
fifty-second entry; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C52R1, C52R2 |
| qa-checklist | PASS | Q52R1, Q52R2 |
| server hot path | PASS | none |
| privacy and security | PASS | S52R1 |
| database performance | PASS | D52R1 |
| test coverage | PASS | T52R1 to T52R6 |
| docs librarian | PASS | L52R1, L52R2 |
| migration safety | PASS | M52R1, M52R2 |

16 findings: none blocking, 4 should-fix (C52R1, S52R1, T52R1, T52R2), 12 nice-to-have, every
reader passing, and five (qa-checklist, server hot path, database performance, docs librarian,
migration safety) with no should-fix, server hot path with no finding at all. One reader found the
bundle read taking any path with `node_modules/` in it for a package, so a module of this
repository under such a directory went unread; only the root `node_modules` counts now, proven on
a sample. One found two reads the last round added never exercised on the tree, the declarations
around section L and the parameters of the functions around it; each is now proven on a sample,
and the functions may bind no name of their own, type parameters and a function expression's name
included, which two readers named (`a23c145fa5`'s body, which leaves this last out, stays as it
is, noted in round fifty-three, Q53R3). One found the ledger crediting round fifty's pin with
declarations it did not count. The rest were the parse map's comment, round fifty-one's summaries,
a lookup's throw, the build options' copy and the package order.

- C52R1 FIXED in the ledger (its ROUND FIFTY says round fifty's pin counted variable, function,
  class and import bindings, the other declarations from round fifty-one; C51R2's disposition
  notes it, named so in round fifty-three, Q53R1). C52R2 FIXED in this record and the ledger (with
  Q52R2 and L52R2: round fifty-one's summary and the ledger's ROUND FIFTY-ONE name C51R6's ruling;
  `17478cc191`'s body, which leaves it out, stays as it is).
- Q52R1 FIXED `e4cf5bb85e` (with T52R5 and L52R1: the parse map's comment says the reads below
  take it, not that no other read parses a file). Q52R2 FIXED (see C52R2).
- S52R1 FIXED `e4cf5bb85e` (a module is a package only under the root `node_modules`, which
  `.npmrc` keeps hoisted, proven on a sample that a deeper `node_modules` or a
  `vendor_node_modules` directory is this repository's; C51R3's disposition notes it; a package
  named by the directory after its last `node_modules`, from round fifty-three, T53R1).
- D52R1 FIXED `e4cf5bb85e` (with M52R1 and M52R2: the functions around section L may bind no name
  of their own, type parameters and a function expression's name counted beside their parameters
  (worded so in round fifty-three, L53R3), and the pin block's comment says so; C51R2's
  disposition notes it).
- T52R1 FIXED `e4cf5bb85e` (the declarations read is one function, proven on a sample of each
  statement form it counts, type alias, interface, enum, import-equals and namespace among them).
  T52R2 FIXED `e4cf5bb85e` (the read of the scopes around a node is one function, proven on a
  sample whose arrow and named function expression each bind names; its statements read proven on
  a sample from round fifty-three, T53R2, noted so in round fifty-four, Q54R1). T52R3 FIXED
  `e4cf5bb85e` (a lookup of a file outside the bundle is shown to throw). T52R4 FIXED `e4cf5bb85e`
  (the test's build options are written as the script writes them and compared with the script's
  pinned lines, its outfile aside). T52R5 FIXED (see Q52R1). T52R6 FIXED `e4cf5bb85e` (the
  bundle's packages are sorted before they are compared; the package list replaced by the rule
  that every package module lies under `node_modules/ws/`, from round fifty-four, S54R1).
- L52R1 FIXED (see Q52R1). L52R2 FIXED (see C52R2).
- M52R1 FIXED (see D52R1). M52R2 FIXED (see D52R1).
- Mutants on this round's new guards, each killed and its source restored: a module of this
  repository under a `vendor_node_modules` directory, added with intent-to-add and imported by
  `bot/main.ts`, removed after, at the bundle's module list; the scopes read narrowed to function
  declarations, and the interface arm dropped from the declarations read, each at its sample; a
  type parameter on the suite's callback, and the callback as a function expression named
  `within`, at the pin of names the functions around bind; the test's build options drifting from
  the script, at their tie; and the bundle lookup failing open again, at its throw.

## Round fifty-three: eight fresh readers over round fifty-two (`17478cc191..a23c145fa5`)

Round fifty-three's commits: `071897e08f` (section L's ancestors are pinned by kind, so a loop,
`catch`, `case`, class or namespace wrapped around it fails; the statements read of the scopes
around a node is proven on a sample; a bundled package is named by the directory after its last
`node_modules`, its scope kept, proven on a sample of a nested and a scoped package; the package
rule's sample holds a sibling `node_modules_x` directory; git must track nothing under the root
`node_modules`; the package rule's comment, the pin block's comment and the names-around pin's
comment (worded so in round fifty-four, C54R1); the manifest's fifty-third entry; kept whole for
bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C53R1 to C53R3 |
| qa-checklist | PASS | Q53R1 to Q53R3 |
| server hot path | PASS | none |
| privacy and security | PASS | S53R1 |
| database performance | PASS | none |
| test coverage | PASS | T53R1 to T53R3 |
| docs librarian | PASS | L53R1 to L53R5 |
| migration safety | PASS | M53R1 |

16 findings: none blocking, 6 should-fix (Q53R1, Q53R2, T53R1, T53R2, L53R1, M53R1), 10
nice-to-have, every reader passing, and four (correctness, server hot path, privacy and security,
database performance) with no should-fix, server hot path and database performance with no finding
at all. One reader found that section L wrapped in a `for` head, a `catch`, a `case` clause or a
class would bind names that neither the scopes read nor the declarations read takes; the section's
ancestors are now pinned by kind. One found last round's package naming take the directory after
the root `node_modules`, so a package nested in another was named as its parent, and the
statements read of the scopes around a node never proven on a sample; a package is now named by
the directory after its last `node_modules`, and that read is proven on a sample. Two found
C52R1's correction missing from C51R2's disposition, and one found the ledger's ROUND FIFTY still
crediting round fifty's pin with the scopes' parameters and a hoisted `var`. The rest were two
comments, the files git tracks under `node_modules`, a sibling sample, a commit body, and record
and ledger wording.

- C53R1 FIXED `071897e08f` (the package rule's comment says a path with `node_modules` deeper in
  it or above the working directory is read as this repository's and fails until a read takes it).
  C53R2 FIXED (see S53R1). C53R3 FIXED `071897e08f` (the comment says the reads of the scopes, the
  `var` forms and the declarations are each proven on a sample first, and the section's own place
  is pinned by its ancestors' kinds).
- Q53R1 FIXED in this record (with L53R1: C51R2's disposition notes C52R1's rewording of the
  ledger's ROUND FIFTY, and C52R1 names it back). Q53R2 FIXED in the ledger (its ROUND FIFTY says
  the scopes' parameters and a hoisted `var` were pinned out from round fifty-one, and type
  parameters and a function expression's name from round fifty-two). Q53R3 FIXED in this record
  (round fifty-two's summary says `a23c145fa5`'s body leaves out the functions' own names and
  stays as it is).
- S53R1 FIXED `071897e08f` (with C53R2: git must track nothing under the root `node_modules`, the
  premise the package rule's comment now states; read from the index itself, so a tracked file
  deleted on disk fails too, from round fifty-four, C54R3).
- T53R1 FIXED `071897e08f` (a bundled package is named by the directory after its last
  `node_modules`, its scope kept, proven on a sample of a nested and a scoped package; S52R1's
  disposition notes it; the naming replaced by the rule that every package module lies under
  `node_modules/ws/`, from round fifty-four, S54R1). T53R2 FIXED `071897e08f` (the statements read
  of the scopes around a node is proven on a sample whose section sits in a block under an `if`,
  three statement lists deep; T52R2's disposition notes it, named so in round fifty-four, Q54R1).
  T53R3 FIXED `071897e08f` (the package rule's sample holds a sibling `node_modules_x` directory,
  so a prefix without its slash fails).
- L53R1 FIXED (see Q53R1). L53R2 FIXED in the ledger (its ROUND FIFTY-ONE says one of the
  should-fix was ruled on a misread). L53R3 FIXED in this record (D52R1 says their parameters).
  L53R4 FIXED in the ledger (its ROUND FIFTY-TWO writes `node_modules` in backticks). L53R5 FIXED
  in this record (C50R1 says a second variable, function, class or import binding fails, the
  bindings round fifty's pin counted).
- M53R1 FIXED `071897e08f` (section L's ancestors are pinned by kind, from its expression
  statement through the suite's block, arrow and call to the source file, so a `for` head, a
  `catch`, a `case` clause, a class or a namespace around it fails, and the pin block's comment
  says so, noted in round fifty-four, L54R3).
- Mutants on this round's new guards, each killed and its source restored: section L wrapped in a
  `for` loop over realms, at its ancestors' pin; a package named by its root directory again, at
  the package name sample; the statements read narrowed to the nearest block, at its sample; the
  package prefix without its slash, at the package rule's sample; and a file under
  `node_modules/ws` force-added to git, removed after, at the tracked-files check.

## Round fifty-four: eight fresh readers over round fifty-three (`a23c145fa5..3bc65ff291`)

Round fifty-four's commits: `f667650406` (the bundle read names no package: every module from a
package must lie under `node_modules/ws/` and hold no `node_modules` further along its path,
proven on a sample of a sibling prefix, a scoped package, one nested in ws, ws nested in another
package (worded so in round fifty-five, T55R3) and a directory whose name holds `node_modules` on
each side of ws, and at least one bundled module must come from a package; the check that git
tracks nothing under the root `node_modules` reads the index itself; the package rule's comment;
the manifest's fifty-fourth entry; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C54R1 to C54R3 |
| qa-checklist | PASS | Q54R1 to Q54R4 |
| server hot path | PASS | none |
| privacy and security | PASS | S54R1 |
| database performance | PASS | none |
| test coverage | PASS | T54R1, T54R2 |
| docs librarian | PASS | L54R1 to L54R4 |
| migration safety | PASS | none |

14 findings: none blocking, 5 should-fix (C54R1, Q54R1, S54R1, T54R1, L54R1), 9 nice-to-have,
every reader passing, and three (server hot path, database performance, migration safety) with no
finding at all. Two readers found last round's package naming taking any `node_modules/` text for
that directory, so a second package whose modules sit under a directory such as
`x_node_modules/ws/` was named ws, and three more named it as a nice-to-have. The naming had drawn
one more form in each of three rounds, so the read now names no package: every module from a
package must lie under `node_modules/ws/` with no `node_modules` further along its path. Two found
round fifty-two's intro, T52R2 and the ledger's ROUND FIFTY-TWO crediting round fifty-two with the
statements read of the scopes, which round fifty-three first proved on a sample. One found round
fifty-three's intro placing a sample in the wrong read and leaving out a reworded comment, which
two more named in three nice-to-haves (worded so in round fifty-five, L55R3). The rest were the
tracked-files check skipping a file deleted on disk, M53R1's comment and an evidence line.

- C54R1 FIXED in this record (with Q54R2, Q54R4 and L54R2: round fifty-three's intro says the
  package naming is proven on a sample of a nested and a scoped package, puts the sibling
  `node_modules_x` directory in the package rule's sample, and names the pin block's comment and
  the names-around pin's comment). C54R2 FIXED (see S54R1). C54R3 FIXED `f667650406` (the check
  that git tracks nothing under the root `node_modules` reads the index itself, so a tracked file
  deleted on disk fails; S53R1's disposition notes it).
- Q54R1 FIXED in this record and the ledger (with L54R1: round fifty-two's intro and the ledger's
  ROUND FIFTY-TWO credit round fifty-two with the declarations read and the read of the names the
  functions around section L bind, the scopes' statements read coming from round fifty-three;
  T52R2's disposition notes T53R2, which names it back; `e4cf5bb85e`'s title and body stay as they
  are). Q54R2 FIXED (see C54R1). Q54R3 FIXED (see S54R1). Q54R4 FIXED (see C54R1).
- S54R1 FIXED `f667650406` (with C54R2, Q54R3, T54R1 and L54R4: the bundle read names no package;
  every module from a package must lie under `node_modules/ws/` and hold no `node_modules` further
  along its path, proven on a sample, and at least one bundled module must come from a package;
  the package rule's comment says so; T52R6's and T53R1's dispositions note it; the bundle read's
  opening comment reworded to match, from round fifty-five, C55R1).
- T54R1 FIXED (see S54R1). T54R2 FIXED in the evidence (U119's line says the loop ran without
  braces, as its log's kinds show).
- L54R1 FIXED (see Q54R1). L54R2 FIXED (see C54R1). L54R3 FIXED in this record (M53R1 says the pin
  block's comment says so). L54R4 FIXED (see S54R1).
- Mutants on this round's new guards, each killed and its source restored: the ws rule without its
  nested-path check, and with its prefix missing its slash, each at its sample; a second package
  imported by `bot/logic.ts`, at the rule over the bundle; the bundle read finding no package
  module, at the check that one does; and a file under `node_modules/ws` tracked and deleted on
  disk, removed from the index after, at the index check.

## Round fifty-five: eight fresh readers over round fifty-four (`3bc65ff291..3848d46123`)

Round fifty-five's commits: `37affe1ec3` (the bundle read's opening comment says its packages are
held to ws by path; the package rule's comment names any other directory whose name holds
`node_modules`, says that `node_modules/ws/` holding ws's own published code rests on the root
`package.json` pin (worded so in round fifty-six, L56R2; `37affe1ec3`'s body, which says the ws
rule does, stays as it is), and says where the lockfile fetches ws from is not read; the ws rule's
sample holds a ws file whose own name holds `node_modules`; the manifest's fifty-fifth entry; kept
whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C55R1, C55R2 |
| qa-checklist | PASS | Q55R1 to Q55R3 |
| server hot path | PASS | none |
| privacy and security | PASS | S55R1 |
| database performance | PASS | none |
| test coverage | PASS | T55R1 to T55R3 |
| docs librarian | PASS | L55R1 to L55R3 |
| migration safety | PASS | none |

12 findings: none blocking, 4 should-fix (C55R1, Q55R1, T55R1, L55R1), 8 nice-to-have, one ruled,
every reader passing, and four (server hot path, privacy and security, database performance,
migration safety) with no should-fix, three of them with no finding at all. The four should-fix
are one finding: the bundle read's opening comment still said it named its packages, which the
last round removed. The rest were the package rule's comment (its tie to the root `package.json`
pin and a literal reading of its last clause), a sample with no ws file whose own name holds
`node_modules`, three wording slips in round fifty-two's and round fifty-four's sections, and the
finding a note names.

- C55R1 FIXED `37affe1ec3` (with Q55R1, T55R1 and L55R1: the bundle read's opening comment says
  its packages are held to ws by path; S54R1's disposition notes it). C55R2 FIXED `37affe1ec3`
  (the package rule's comment says any other directory whose name holds `node_modules`).
- Q55R1 FIXED (see C55R1). Q55R2 RULED, no change: round fifty-two's intro names L54R1 because
  L54R1 alone flagged that paragraph, while Q54R1 named T52R2 and the ledger. Q55R3 FIXED in this
  record (round fifty-two's intro says what `e4cf5bb85e`'s title and body claim, that every read
  of the scopes is proven on a sample).
- S55R1 FIXED `37affe1ec3` (the package rule's comment says that `node_modules/ws/` holding ws's
  own published code rests on the root `package.json` pin, no patch of ws and no ws spec or
  override but a version range, so a change there for ws needs the bundle read reviewed too, and
  that where the lockfile fetches that range from is not read; the premise stated as one the read
  takes and does not check, with what holds part of it and what is not read, from round fifty-six,
  C56R1, and the pin's comment naming the bundle read back, from round fifty-six, L56R1).
- T55R1 FIXED (see C55R1). T55R2 FIXED `37affe1ec3` (the ws rule's sample holds
  `node_modules/ws/lib/x_node_modules.js`, so a check that reads `node_modules` only as a
  directory fails). T55R3 FIXED in this record (with L55R2: round fifty-four's intro says its
  sample holds ws nested in another package).
- L55R1 FIXED (see C55R1). L55R2 FIXED (see T55R3). L55R3 FIXED in this record (round fifty-four's
  summary says two more readers named it in three nice-to-haves).
- A mutant on this round's new sample entry, killed and its source restored (worded so in round
  fifty-six, L56R3): the ws rule reading `node_modules` only as a directory, with its slash, at
  the ws rule's sample.

## Round fifty-six: eight fresh readers over round fifty-five (`3848d46123..5c98f5a6f8`)

Round fifty-six's commits: `d2873d8e4a` (the root `package.json` pin takes a spec as a range only
in its plain form, an exact version or one led by `^` or `~`, and lists any other, proven on
samples of a prerelease, a tarball path led by a digit and one led by an exact version, a tilde
path, a wider range and a tag; the pin's comment names the bot's bundle read; the bundle read's
package rule states that `node_modules/ws/` holding ws's own published code is a premise it does
not check, names the pin and the two checks after it as holding part of it, and lists what else is
not read; the ws rule's sample holds a directory whose name begins with `node_modules`; the
manifest's fifty-sixth entry; kept whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C56R1 |
| qa-checklist | PASS | Q56R1 |
| server hot path | PASS | H56R1 |
| privacy and security | PASS | S56R1 |
| database performance | PASS | none |
| test coverage | PASS | T56R1 to T56R3 |
| docs librarian | PASS | L56R1 to L56R3 |
| migration safety | PASS | none |

10 findings: none blocking, 2 should-fix (T56R1, L56R1), 8 nice-to-have, every reader passing, and
six (correctness, qa-checklist, server hot path, privacy and security, database performance,
migration safety) with no should-fix, two of them with no finding at all. One reader found the
`package.json` pin, which the last round named as holding part of the ws rule's premise (worded so
in round fifty-seven, L57R4), reading a spec as a version range by its first character, so a
tarball or path spec led by a digit or a tilde, which pnpm installs from a local path rather than
the registry (worded so in round fifty-seven, L57R2), passed as one; a range is now only its plain
form. One found the tie to that pin stated only at the read that stays green, which one more named
as a nice-to-have; the pin's comment now names the bundle read. Four found the premise's sentence
leaving out what else holds or could change it (the checks on a pnpm workspace file and a
pnpmfile, an install script); it is now stated as a premise the read does not check. The rest were
a sample entry and two record wordings.

- C56R1 FIXED `d2873d8e4a` (with Q56R1, S56R1 and T56R3: the package rule's comment states that
  `node_modules/ws/` holding ws's own published code is the read's premise, not one it checks,
  that the root `package.json` pin and the two checks after it, on a pnpm workspace file and a
  pnpmfile, hold part of it, and that an install script, a build step and where the lockfile
  fetches the range from are not read; S55R1's disposition notes it).
- Q56R1 FIXED (see C56R1).
- H56R1 FIXED (see L56R1).
- S56R1 FIXED (see C56R1).
- T56R1 FIXED `d2873d8e4a` (the `package.json` pin takes a spec as a range only when it is an
  exact version or one led by `^` or `~`, a prerelease allowed, and lists any other, proven on
  samples of a prerelease, a tarball path led by a digit and one led by an exact version, a tilde
  path, a wider range and a tag; a comment says so; a prerelease and a number semver rejects
  listed too, from round fifty-seven, C57R1). T56R2 FIXED `d2873d8e4a` (the ws rule's sample holds
  `node_modules/ws/lib/node_modules_x/y/i.js`, so a check that reads `node_modules` only before a
  slash or a dot fails). T56R3 FIXED (see C56R1).
- L56R1 FIXED `d2873d8e4a` (with H56R1: the `package.json` pin's comment names the bot's bundle
  read, which takes `node_modules/ws/` as ws's own published code partly on that pin, so a change
  there for ws needs that read reviewed too; S55R1's disposition notes it). L56R2 FIXED in this
  record (round fifty-five's intro says that `node_modules/ws/` holding ws's own published code
  rests on the pin). L56R3 FIXED in this record (round fifty-five's mutant line names one mutant
  on a sample entry).
- Mutants on this round's range grammar and the ws rule's new sample entry, each killed and its
  source restored (worded so in round fifty-seven, L57R3): the range read by its first character
  again, and the range grammar without its end anchor and without its tilde, each at the
  classifier's samples; the grammar without its start anchor, at the pin over the real specs; and
  the ws rule reading `node_modules` only before a slash or a dot, at the ws rule's sample.

## Round fifty-seven: eight fresh readers over round fifty-six (`5c98f5a6f8..d9225b5fb6`)

Round fifty-seven's commits: `138e7bd758` (the `package.json` pin's plain range is three numbers
of at most nine digits with no leading zero, led by nothing, `^` or `~`, so a prerelease, an
overlong number and a wider range are listed, proven on samples of each, of a prerelease ending in
a tarball name and of one holding a path; the renewer guard's summary names override specs and
plain ranges; the bundle read's package rule comment says two tracked-file checks after the pin;
the ws rule's sample holds a file named `node_modules`; the manifest's fifty-seventh entry; kept
whole for bisect), and the commit that adds this section.

| Reader | Verdict | Findings |
|---|---|---|
| correctness | PASS | C57R1, C57R2 |
| qa-checklist | PASS | Q57R1 to Q57R4 |
| server hot path | PASS | none |
| privacy and security | PASS | S57R1, S57R2 |
| database performance | PASS | none |
| test coverage | PASS | T57R1 to T57R5 |
| docs librarian | PASS | L57R1 to L57R4 |
| migration safety | PASS | none |

17 findings: none blocking, 3 should-fix (C57R1, T57R1, L57R1), 14 nice-to-have, every reader
passing, and five (qa-checklist, server hot path, privacy and security, database performance,
migration safety) with no should-fix, three of them with no finding at all. Two readers found the
last round's plain range still taking a spec semver rejects, a prerelease with an empty identifier
or an overlong number ending in a tarball name, or a prerelease holding a path, which pnpm then
installs from a local path; three more named the prerelease or the wider ranges in four
nice-to-haves. A plain range now takes no prerelease and bounds each number. One found the renewer
guard's summary still naming the old range rule. The rest were the record's account of where a
tilde path installs from, two record wordings, the comment's pointer to the checks after the pin,
and a sample entry.

- C57R1 FIXED `138e7bd758` (with T57R1, S57R1, S57R2, Q57R2 and T57R2: a plain range is three
  numbers of at most nine digits with no leading zero, led by nothing, `^` or `~`, so a
  prerelease, an overlong number and a wider range are listed, proven on samples of a prerelease
  with an empty identifier, one ending in a tarball name, one holding a path, an overlong number,
  a leading zero, a `>` range, a missing patch number and an `x` patch, and the comment says so;
  T56R1's disposition notes it). C57R2 FIXED (see L57R2).
- Q57R1 FIXED (see L57R2). Q57R2 FIXED (see C57R1). Q57R3 FIXED (see L57R3). Q57R4 FIXED
  `138e7bd758` (with T57R5: the package rule's comment says two tracked-file checks after the pin,
  which its parenthesis names).
- S57R1 FIXED (see C57R1). S57R2 FIXED (see C57R1).
- T57R1 FIXED (see C57R1). T57R2 FIXED (see C57R1). T57R3 FIXED `138e7bd758` (the ws rule's sample
  holds `node_modules/ws/lib/node_modules`, so a check that needs a character after `node_modules`
  fails). T57R4 FIXED (see L57R2). T57R5 FIXED (see Q57R4).
- L57R1 FIXED `138e7bd758` (the renewer guard's summary says it pins the root `package.json`'s
  dependency and override specs but plain ranges). L57R2 FIXED in this record and the ledger (with
  Q57R1, C57R2 and T57R4: round fifty-six's summary and the ledger's item under WHAT IT FOUND THAT
  WAS NOT A COMMENT say pnpm installs such a spec from a local path rather than the registry,
  since a tilde path resolves against the home directory). L57R3 FIXED in this record (with Q57R3:
  round fifty-six's mutant line names its range grammar and the ws rule's new sample entry). L57R4
  FIXED in this record (round fifty-six's summary says the last round named the pin as holding
  part of the ws rule's premise).
- Mutants on this round's range grammar and the ws rule's new sample entry, each killed and its
  source restored: the grammar taking a prerelease again, with unbounded numbers, allowing a
  leading zero, with its prefix widened to `>` and `<`, and with its patch number optional, each
  at the classifier's samples; and the ws rule reading `node_modules` only before a non-letter, at
  the ws rule's sample.
