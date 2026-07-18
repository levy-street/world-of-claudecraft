# Phase 09 QA: Verify Station presence and recipe training

Independent audit of Phase 9: stations visible in both hosts, training live and
server-authoritative, and no existing character lost a recipe.

## Phase-specific QA emphasis

- Train command replay/idempotency: a duplicated or replayed wire command must never
  double-charge the fee or double-grant a recipe; prove it with a test, not by reading the code.
- Grandfather normalize on a legacy save fixture: load a real pre-phase state blob and prove
  every previously craftable recipe id reads as known after normalize, and that a second
  normalize pass changes nothing.
- GLB budget unchanged if no new GLB landed; if one did land, verify the media manifest regen,
  `registerPreload`, and `npm run asset:budget` all hold.
- The teach-tier gate and the visible ladder (the 2026-07-17 amendment): a below-tier train
  attempt denies with the localized tier reason; the Train view SHOWS the locked row with
  its named requirement (never hidden); crossing the threshold flips it to teachable; the
  hobby craft uses the same thresholds; common recipes never lock; and a KNOWN recipe is
  never use-gated regardless of skill (drive a real craft to prove the no-admission-gate
  rule survived the new predicate).

## QA Starter Prompt

```
This is Phase 09 QA of the Professions 2.0 feature: verify Station presence and recipe
training.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 9 diff for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness for THIS phase; fix what the audit finds; return a
verdict.

STEP 0 - PRE-FLIGHT:
- Run git status. The tree must be clean (a concurrent session may share this checkout);
  stop and report if it is not.
- Scan Claude Code memory (the MEMORY.md index) for: node25-breaks-jsdom-gate (run the gate
  under Node 24), the PR 2039 state (the professions foundation surfaces), and the
  design-language program (today's tokens only; no DESIGN.md phase vocabulary).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-09-station-training.md (deliverables, acceptance criteria,
  validation commands, invariants, and the phase-specific QA emphasis bullets)
- The Phase 9 diff: git diff against the phase-start commit recorded in progress.md's Phase 9
  entry (if absent, the commit before the first Phase 9 commit); the stat plus the full diff
  of every touched file.
The summary must return: every deliverable and acceptance criterion, the exact validation
commands, the touched files grouped by domain (render, ui, sim, world_api, net, server,
tests), and the emphasis bullets.

STEP 2 - QA AUDIT:
Spawn three parallel agents, each given ONLY the Explore summary. Prompt every agent for
COVERAGE, not filtering: report every correctness or requirement gap with confidence and
severity; filtering happens in a later pass.
- Correctness agent: verify every deliverable and acceptance criterion against the real code;
  run the phase's validation commands (the ui/render and net/wire matrix rows plus
  npx vitest run tests/minimap_markers.test.ts tests/snapshots.test.ts
  tests/world_api_parity.test.ts and the new train and grandfather tests); exercise the real
  behavior, not just the tests (walk to a station, confirm the minimap marker, open the Train
  view, learn a recipe in BOTH the offline Sim and the online ClientWorld; drive the denial
  paths: out of range, insufficient gold, not teachable here, already known). Probe the
  emphasis items explicitly: train replay/idempotency (no double-charge, no double-grant),
  the grandfather normalize on a legacy save fixture, and the GLB budget unchanged if no new
  GLB landed.
- Test coverage agent: find untested paths (every denial branch, the exactly-affordable fee
  edge, the marker variant against both host shapes, normalize idempotency on a second load);
  ADD the missing tests, including a determinism test if sim logic changed in this phase;
  remove orphaned tests the phase left behind.
- Dead code and cleanup agent: unused imports and types, sim purity (no DOM/Three or
  render/ui/game/net imports in src/sim/; all randomness through Rng; no Math.random,
  Date.now, or performance.now), leftover TODOs and debug logging, stray placeholder props
  not driven by the STATIONS registry, and hex literals outside tokens.css/theme.ts.
- Also spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY
  matching rows. Run the qa-checklist agent over the complete phase diff.
- If any agent response comes back truncated, re-spawn that agent to resume from its last
  completed item; never treat partial output as a full report.

STEP 3 - FIX:
- Apply every BLOCKING and SHOULD-FIX finding, test-first where a bug reproduces (reproduce
  with a failing test, then the smallest change that turns it green).
- Rerun the validation commands from STEP 2 until green.
- Commit with explicit paths (never git add -A), Conventional Commits with a scope and a body
  (fix(professions), fix(ui), test(professions) as they fit).

STEP 4 - UPDATE DOCS + MEMORY:
- Update docs/professions-2/progress.md (the Phase 9 QA result and findings summary) and
  docs/professions-2/state.md if any surface changed during fixes.
- Record durable surprises (fixture traps, wire quirks, flaky suites) to Claude Code memory.

STEP 5 - FINAL RESPONSE FORMAT:
- Verdict: PASS, PASS-WITH-FOLLOWUPS, or FAIL.
- Counts: findings by severity, fixed versus deferred, tests added and removed.
- Deferrals with reasons and owners.
- A one-line handoff for Phase 10: recipe ladders may rely on live training and the
  trained-not-known default.

STOPPING RULES:
- Stop and report FAIL if grandfathering cannot be proven on the legacy fixture; that was the
  phase's gate, do not paper over it.
- Stop if a fix would require violating a locked decision in state.md; defer it with a written
  reason instead.
```
