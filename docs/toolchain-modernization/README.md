# Toolchain Modernization packet

Modernize the repo's toolchain in five small PRs: (1) stop committing the two
always-conflicting generated i18n metadata files, (2) replace the recursive
TranslationKey type with a build-generated flat union and delete baseUrl (the TypeScript
7 prerequisite, and an immediate 2x tsc speedup), (3) parallelize the CI checks and
source FFmpeg from npm, (4) shard the test suite to bring the PR gate to at or under 4
minutes, and (5) flip the repo to TypeScript 7 via the official dual-alias install. All decisions
are research-backed and adversarially verified; the full record is in brainstorm.md.

Related: issue #1868 (the TS7 investigation this packet overturns and completes).

## Reading order

1. brainstorm.md: the consolidated research record (findings, evidence, sources).
2. implementation-plan.md: the phase plan, team workflow, and review dispatch matrix.
3. state.md: locked decisions, validation matrix, baselines, pinned tests, OPEN items.
4. progress.md: live status and per-phase deliverable checklists.
5. qa-checklist.md: the whole-packet integration QA matrix (run at Phase 5 QA).

## Phase files (run each in a fresh session, in order)

| Order | File |
|---|---|
| 1 | phase-01-degit-i18n-aggregates.md |
| 2 | phase-01-qa.md |
| 3 | phase-02-flat-translationkey-baseurl.md |
| 4 | phase-02-qa.md |
| 5 | phase-03-ci-parallel-checks-ffmpeg.md |
| 6 | phase-03-qa.md |
| 7 | phase-04-test-sharding.md |
| 8 | phase-04-qa.md |
| 9 | phase-05-typescript-7-flip.md |
| 10 | phase-05-qa.md |

To start a phase: open its file, copy the starter prompt into a fresh Claude Code
session. Each prompt is self-contained. Ordering constraints: Phase 3 needs Phase 1
merged, Phase 4 needs Phase 3 merged, Phase 5 needs Phase 2 merged; run in the listed
order and everything holds. The final QA phase offers packet teardown (deleting this
directory) before the last PR is marked ready for review, on explicit user
confirmation.
