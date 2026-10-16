# Phase 12c QA: Verify The Mastery Curve

Audits the Phase 12c diff: the four-state curve with the free floor gone, the enforced
per-profession caps at all four clamp arms, the one-time reset with its keep ledger, the
shared action throttle, the enchanting soft ceiling, and the pin-cost appendix discipline.

## QA Starter Prompt

```
This is Phase 12c QA of the Professions 2.0 feature: verify The Mastery Curve.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 12c diff for correctness, missing tests, determinism, three-host
parity, i18n completeness, and the reset's perfection guarantee.

STEP 0 - PRE-FLIGHT: run git status; the tree must be clean; stop if dirty with work you
did not create. Memory scan (MEMORY.md index): node25-breaks-jsdom-gate (gate under
Node 24), combo-recipes-broken-online (the #2033 stub trap), the professions packet
entries, big-diff-reviewer-turn-budgets (hard tool budgets + report-first for every
spawned reviewer).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly): spawn one Explore agent to
read and summarize: docs/professions-2/state.md (the mastery amendments block and the
as-landed Phase 12c surfaces entry), docs/professions-2/progress.md,
docs/professions-2/phase-12c-mastery-curve.md including its Pin-cost appendix, and the
output of git diff <phase-start>..HEAD (the phase-start commit is in progress.md). The
summary must return: the deliverable groups and acceptance criteria; the actual constant
names, flag name, and letter id that landed; every file the diff touched; the appendix
list verbatim; and the validation rows for the change type.

STEP 2 - QA AUDIT: spawn parallel agents, each given ONLY the Explore summary, each with
a hard 30-tool-call budget and report-first framing:
- Correctness agent: verify every acceptance criterion against real code; run the phase's
  validation commands; exercise REAL behavior: level a craft through all four curve
  states, hit a cap and keep crafting (masterwork still procs), load an over-cap save
  (clamps), load a pre-reset save twice (reset fires once).
- Reset-perfection agent: the keep/reset ledger row by row against the code; the one-shot
  flag across relog, reconnect, restart, and a second normalize pass; the re-crossing
  suite (deeds at proficiency 100 and craft 75, celebrations, letters: no double grant);
  the blob-diff rehearsal evidence in progress.md (recorded, complete, zero unexplained
  deltas); the legacy gatheringProficiency fallback shape resets correctly.
- Curve and pacing agent: the four-state boundaries at every edge (24/25, 49/50, the
  three-below zero), the archetype interplay (dormant plateaus on commons, hobby green
  crawl, majors full), the gathering node-tier decay and fishing fractional gains against
  the recorded constants, the shared throttle across all four action types (spam one,
  starve the others), the enchanting soft ceiling min() arms (epic above pre-archetype
  ceiling grants the ceiling rate, never zero, never less than a rare).
- Pin-quality agent (test-coverage-auditor emphasis): every re-pin matches the appendix;
  nothing outside the appendix was weakened; mutation-test the decisive new pins (flip a
  clamp arm off, the suite must red; restore the free floor, the suite must red); the two
  regenerated goldens are exactly the appendix's two.
Also spawn review agents per the Review Dispatch Matrix (architecture-reviewer,
migration-safety for the reset flag, test-coverage-auditor, qa-checklist). COVERAGE, not
filtering; resume truncated agents.

PHASE-SPECIFIC QA EMPHASIS (probe directly, not just by reading):
- Determinism: assert ZERO new Rng draws (the draw-count pins and the untouched goldens
  are the tooth); any golden regen beyond professions_craft and professions_gather is a
  BLOCKING finding.
- The offline host runs the same curve (no persistence there, so no reset arm; verify the
  flag logic is inert for fresh characters and costs nothing).
- i18n: the reset letter, the mastered-state copy, and the four difficulty labels are
  English-only keys; any new sim module joined the S3 scan list; run the i18n rows.
- The one-deploy rule: curve, caps, and reset are in this one diff; if any half was
  deferred, stop and surface it (shipping them apart is a design violation, not a
  scheduling choice).
- Battlefield trickle share note recorded in the phase notes for Phase 15.

STEP 3 - FIX: apply every BLOCKING and SHOULD-FIX finding test-first; rerun failed rows
until green; commit with explicit paths, Conventional Commits with a body.

STEP 4 - UPDATE DOCS + MEMORY: update progress.md with the QA row and verdict; correct
state.md if the recorded Phase 12c surfaces drifted; append the QA post-inventory block
to the phase file's appendix (the 12b precedent); record surprises to memory.

STEP 5 - FINAL RESPONSE FORMAT: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; findings by
severity, fixed versus deferred; the deferral list with reasons; a one-line handoff to
Phase 12d.

STOPPING RULES: stop if a BLOCKING finding cannot be fixed without changing a locked
decision or a resolved cap number in state.md; stop if the blob-diff rehearsal evidence
is missing or shows unexplained deltas (the reset does not ship on vibes).
```

## As landed (2026-07-20, PR #2242): read this before auditing

The build session's as-landed block in phase-12c-mastery-curve.md is
authoritative over the older wording here. QA-relevant deltas: the reset
flag is CharacterState-ONLY (no PlayerMeta field; the sampler pin asserts
zero new keys) with the transient pendingMasteryResetNotice mail-phase
letter; the appendix ADDENDUM rows (crafting_view, archetype_ceiling,
professions_crafting, deeds_sites, deeds, deeds_reconcile, the letter M16
fills) are recorded there and are NOT defects; the blob-diff rehearsal ran
in synthetic-corpus mode (tests/mastery_reset_rehearsal.test.ts) and the
production-copy run is the maintainer's pre-deploy step via
RESET_REHEARSAL_INPUT; display readouts floor/ceil under fractional gains
(pinned in professions_view + profession_identity_view); the rollback
strip-refire caveat is pinned as a conscious acceptance and is DESTRUCTIVE
of rollback-window progress (release-notes item).
