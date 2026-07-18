# Phase 14 QA: Verify attunement quests and nudges

Audit the Phase 14 diff for correctness, missing tests, dead code, determinism, three-host
parity, and i18n completeness before the phase is marked complete.

## QA Starter Prompt

```
This is Phase 14 QA of the Professions 2.0 feature: verify attunement quests and nudges.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 14 diff for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness for THIS phase, then fix what the audit finds.

STEP 0 - PRE-FLIGHT:
- Run git status; the checkout must be clean (a concurrent session may share it).
- Scan Claude Code memory (MEMORY.md index) for phase-relevant entries: the node25 gate rule
  (run npm run gate under Node 24), the PR 2039 state (attunement machinery and its review
  gaps), and the design-language program (DESIGN.md guardrails for the celebration and
  preview UI).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-14-attunement-quests.md (deliverables, invariants, acceptance
  criteria, validation commands)
- the git diff against the Phase 14 start commit recorded in progress.md Notes
  (git diff <phase-start>..HEAD, plus --name-only for the file list)
The summary must return: every deliverable and acceptance criterion, the full list of files
touched, the STEP 3 validation command set from the phase file, and any deferrals the
implementation session recorded.

STEP 2 - QA AUDIT:
Fan out three parallel audit agents; give each ONLY the Explore summary. Prompt every agent
for COVERAGE, not filtering: report every gap with confidence and severity (BLOCKING /
SHOULD-FIX / NICE-TO-HAVE); filtering happens in the main session afterward. If any agent's
report comes back truncated, re-invoke it to resume and emit the remainder before acting;
never act on a truncated report.

Agent Correctness deliverables:
- Verify every deliverable and acceptance criterion from the phase file against the real
  code, not the progress notes.
- Run the phase's validation commands (tsc, the content and sim matrix rows,
  tests/profession_attunement_quests.test.ts, tests/prof_intro_quest.test.ts,
  tests/quest_commands.test.ts, tests/quest_credit.test.ts,
  tests/localization_fixes.test.ts, tests/i18n_completeness.test.ts,
  tests/architecture.test.ts) and record each result.
- Exercise the real behavior, not just the suites: in the offline sim, walk a fresh
  character through nudge, master, lore quest, attunement, one cheap switch, and an
  escalating amends repeat; confirm selection validation rejects a pair outside the
  whitelist and that outcomes resolve server-side online.
- Probe the phase-specific emphasis list:
  - Quest availability matrix: at each of the four masters, verify offer/deny in every
    identity state (unattuned, attuned to the matching pair, attuned to a wrong pair,
    mid-quest, repeat make-amends), in both hosts.
  - Preview copy completeness against the legibility rule: majors, hobby, dormancy, and the
    make-amends return cost are all visible BEFORE commit; no path lets a player commit
    without the full picture.
  - Broadcast matcher coverage: the celebration zone broadcast, the chat nudge, and the
    letter-voice follow-up all re-localize through the matchers; the S3 guard passes with
    quest_commands.ts in scope.

Agent Test coverage deliverables:
- Find untested paths: availability matrix states, the escalation formula boundaries (first
  switch cheap, 5 + 3 * switchCount thereafter), the cadence cap edge (the tick at the cap),
  the once-only tutorial panel, the preview return cost line, matcher rules for every new
  sim-origin string.
- Add missing tests, including a determinism test if sim logic changed (nudge cadence and
  switch cost resolution under a fixed seed; this phase changed sim logic, so expect one).
- Remove orphaned tests: anything still pinning q_archetype_acceptance or
  q_prof_make_amends, and any stale re-pin the implementation session missed.

Agent Dead code and cleanup deliverables:
- Unused imports, types, and helpers left behind by the placeholder quest retirement;
  dangling questIds or i18n keys; locale fills for retired keys.
- Sim purity: no DOM/Three imports in src/sim/, all randomness through Rng, no Date.now or
  performance.now in cadence logic.
- Leftover TODOs, debug logging, or commented-out code in the phase diff.

Then check git diff --name-only and spawn ONLY matching rows of the Review Dispatch Matrix
in docs/professions-2/implementation-plan.md, and spawn the qa-checklist agent over the
whole phase diff. Prompt them for COVERAGE, not filtering, same as above.

STEP 3 - FIX:
Apply every BLOCKING and SHOULD-FIX finding (record NICE-TO-HAVE as deferrals with issue
links). Rerun the validation commands the fixes touch until green. Commit with explicit
paths, never git add -A, Conventional Commits with a body, for example
fix(professions): phase 14 QA follow-ups or test(sim): cover attunement quest availability
matrix.

STEP 4 - UPDATE DOCS + MEMORY:
Update docs/professions-2/progress.md (Phase 14 QA status row, mirror the checklist state,
append notes and deferrals). Update docs/professions-2/state.md if a fix changed a surface
recorded there. Record surprises to Claude Code memory.

STEP 5 - FINAL RESPONSE FORMAT:
Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL. Counts: findings by severity, findings fixed,
tests added, tests removed. Deferrals with issue links. Validation results (each command,
pass or fail). One line handoff for Phase 15 (deed hook location and any tuning notes).

STOPPING RULES:
- Stop if the audit finds that 2039's selection whitelist cannot express a quest's target
  pair: report the gap and the proposed whitelist change; do not widen the whitelist ad hoc
  without recording the decision in state.md.
```

## Phase-specific QA emphasis

- Quest availability matrix: every identity state (unattuned, attuned to the matching pair,
  attuned to a wrong pair, mid-quest, repeat make-amends) at each of the four masters, both
  hosts; the deny reasons must be legible, never a silent missing quest.
- Preview copy completeness against the doc's legibility rule: majors, hobby, dormancy, and the
  make-amends return cost all visible before commit, with no commit path that skips the preview.
- Broadcast matcher coverage: the celebration zone broadcast and both nudge voices re-localize
  via the matchers; the S3 guard is green with `src/sim/quests/quest_commands.ts` in scope.
- Work orders (the 2026-07-17 amendment): each master offers its repeatable work order; a
  loop of immediate re-turn-ins is BOUNDED by the cadence cap and never gold-positive
  against the input vendor value; the turn-in consumes the materials (a recurring sink,
  not a faucet); probe the loop with a real repeated turn-in, not a formula read.
- Tier-crossing mail (the 2026-07-17 amendment): exactly one letter per tier per major
  craft, from the archetype's anchor master; re-crossings, hobby and dormant crossings,
  unattuned characters, and repeated loads deliver none.
