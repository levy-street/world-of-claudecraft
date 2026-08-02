# Phase 3 QA: verify persistence

### QA starter prompt
```
This is Phase 3 QA of the Guild Bank feature.

Model: newest available Claude coding model, xhigh effort. Harness: Claude Code.
Worktree: /Users/seanghods/repos/world-of-claudecraft-guild-bank.
ULTRACODE: recommended here; adversarially verify every dupe-safety claim (each finding
independently confirmed by a skeptic agent before it counts).

Goal: audit Phase 3 with emphasis on transaction atomicity, crash shapes, and ledger
reconciliation.

STEP 0: git status clean; memory scan; npm run db:up for Postgres-backed suites.
STEP 1: Explore agent summarizes state.md ledger, progress.md Phase 3 checklist,
phase-03-persistence.md, and the Phase 3 diff.
STEP 2: parallel review agents (COVERAGE not filtering; standard truncation resume):
- Atomicity: walk every persisted mutation path and prove character state and book commit
  or roll back together; hunt any write outside the fenced transaction; check the fee and
  ledger writes against the crash-ordering decision in state.md.
- Data safety: back-compat loads (pre-feature guild, empty row, hostile JSONB), unknown
  item ids dormant, no truncation anywhere.
- DB performance: boot-load query shape, save write amplification (only the touched book),
  index fit for guild_banks and the guild-filtered bank_ledger reads, transaction hold
  time under the game loop.
- Test coverage: decisive round-trip and rollback assertions, no
  constant-self-comparison pins, ledger rows pinned to literal op names.
- Per the dispatch matrix: migration-safety, database-performance-reviewer,
  privacy-security-review, architecture-reviewer, qa-checklist.
STEP 3: fix all BLOCKING and SHOULD-FIX; rerun the Phase 3 validation rows including
npm run build:server; commit fixes separately, explicit paths.
STEP 4: update progress.md and state.md; memory notes.
STEP 5: (not final; no teardown.)
STEP 6: end with QA verdict, counts, deferred items, one-line handoff to Phase 4.
```
