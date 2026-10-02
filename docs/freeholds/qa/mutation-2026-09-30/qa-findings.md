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
- LR1 FIXED by this file and the ledger section. LR2, LR3, LR4 FIXED `9c15aa3ea1`. LR5, LR6,
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
