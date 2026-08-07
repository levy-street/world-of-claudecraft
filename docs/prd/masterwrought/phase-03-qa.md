# Phase 03 QA: verify the IP naming sweep

### QA Starter Prompt
```
This is Phase 03 QA of the Masterwrought feature.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought.

Goal: audit the Phase 03 naming sweep for completeness and safety before the content
phases author new names against the confirmed registry. Audit emphasis (the phase's QA
focus): no id changed anywhere; tests/shipped_item_ids.test.ts untouched-green; the S3
guard green; wiki regenerated.

STEP 0 - PRE-FLIGHT: git status clean (Phase 03 committed); SYNC RELEASE per the
canonical workflow (fetch, merge newest origin/release/**, release-merge-audit). Memory
scan: test-pin trap index (READ before judging any pin), i18n traps (reword staleness,
M16), adversarial-verify over-refutation.

STEP 1 - LOAD CONTEXT (Explore agent): state.md (R15 + the naming registry),
progress.md Phase 03 checklist, phase-03-naming-sweep.md (what was promised),
naming-audit.md (the verdicts), git diff against the phase-start commit, every file the
diff touched.

STEP 2 - QA AUDIT (parallel agents, COVERAGE not filtering):
Id-safety agent: diff-wide proof that NO id changed anywhere (grep the diff for id fields
and golden edits); tests/shipped_item_ids.test.ts is byte-untouched AND green; no
generated file was hand-edited.
Coverage agent: the audit inventory really covers every shipped player-visible proper
noun surface the Explore pass found (spot-check names absent from naming-audit.md);
every COLLISION verdict has evidence; sample-verify a few CLEAR/GENERIC verdicts against
the wikis yourself (over-refutation check).
Rename-completeness agent: every confirmed collision was renamed in ALL surfaces (content
name, catalog row, matcher DICT, wiki output); no stale old name renders anywhere; M16
fills present for wordy renames; no locale overlay edited outside M16; S3 guard green.
Cleanup agent: no mechanical change rode along; the diff is display-text and docs only
plus regenerated wiki output.
Dispatch per the Review Dispatch Matrix: cross-platform-sync (matcher DICTs), plus
qa-checklist (phase-completion gate).

STEP 3 - FIX: apply ALL findings (blocking, should-fix, nits); rerun the Phase 03
validation set (shipped_item_ids, localization_fixes, guide, wiki regen, ci:changed);
separate fix commits with explicit paths. The fix round is itself unreviewed code: have a
fresh reviewer pass over the fix diff.

STEP 4 - DOCS: progress.md (Phase 03 QA row), state.md drift (registry final), memory
notes.

STEP 5 - REPORT: PASS / PASS-WITH-FOLLOWUPS / FAIL, counts found and fixed, handoff to
Phase 04. Follow-ups are CUT-or-fix decisions, never future-PR items.
```
