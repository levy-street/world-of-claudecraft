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
  mirror stop, 47 s of bounded drains, and names the drains with no deadline at their call
  sites; this corrects H3R2's 42 s, which stands above as round three wrote it.
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
