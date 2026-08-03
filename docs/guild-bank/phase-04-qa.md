# Phase 4 QA: verify the UI and close the packet

### QA starter prompt
```
This is Phase 4 QA of the Guild Bank feature (final phase).

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank.

Goal: audit Phase 4, run the whole-feature QA matrix, and close the packet.

STEP 0: git status clean; memory scan.
STEP 1: Explore agent summarizes state.md ledger, progress.md Phase 4 checklist,
phase-04-ui.md, and the Phase 4 diff.
STEP 2: parallel review agents (COVERAGE not filtering; standard truncation resume):
- Correctness: tab visibility matrix (officer/member/leader, at banker/away, online/
  offline), action enablement vs affordability, localized refusals, escaped text.
- Test coverage: view-core decisiveness, per-state negative cases.
- Per the dispatch matrix: frontend-seam-reviewer, cross-platform-sync, and qa-checklist.
STEP 3: fix all BLOCKING and SHOULD-FIX; then run the WHOLE-FEATURE pass:
- docs/guild-bank/qa-checklist.md top to bottom (parity, determinism, authority, dupe
  safety, economy, persistence, i18n, mobile, performance, copy).
- Phase 3 QA carried-forward acceptance (verify these still hold after Phase 4):
  - Every server-side guild book mutation still flows through runGuildBankOp; no Phase 4
    code introduced a bypass (grep for guildBanks / book mutations outside guild_bank.ts
    and the observer). The unflushed-delta log + revert guarantee depends on it.
  - The two-session fence-out dupe regression and the fail-closed disband guard tests
    (tests/guild_bank_persistence.test.ts) still pass unmodified.
  - The reserve-at-gate fee tests (charge at dispatch, refund exactly once on every
    refusal arm, pipelined-spend refusal) still pass unmodified.
  - The v1 limitation (dormant pipe-refused slot blocks disband forever; admin escape
    hatch required) is called out in the PR body, per state.md accepted risks.
- npm run gate (must be green); verify screenshots exist and are referenced.
- Confirm the branch has been rebased over the newest release branch if PR A merged.
STEP 4: update progress.md and state.md; memory notes (record the shipped constants and
any deferred v1.5 items: member gold deposits, bank log window, per-rank rules).
STEP 5 - PACKET TEARDOWN: surface deferred follow-ups first, then ask the user
explicitly: "All phases are complete and green. OK to delete docs/guild-bank/ (the
planning scaffolding) before the PR?" Delete only on explicit confirmation, only that
directory, explicit paths (git rm -r docs/guild-bank/ if committed).
STEP 6: end with QA verdict, counts, teardown status, and the PR next step (PR body per
.github/PULL_REQUEST_TEMPLATE.md with screenshots, base the newest release branch,
"packet complete").
```
