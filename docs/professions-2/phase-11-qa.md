# Phase 11 QA: Verify Fishing joins the framework

Audit the Phase 11 diff (fishing proficiency, catch rarity ladder, the fishing module extraction,
wire and UI rows) and fix what the audit finds.

## QA Starter Prompt

```
This is Phase 11 QA of the Professions 2.0 feature: verify Fishing joins the framework.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit the Phase 11 diff for correctness, missing tests, dead code, determinism, three-host
parity (browser Sim, server, headless RL), and i18n completeness for this phase; then fix what
the audit finds.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean (a concurrent session may share the checkout); stop and report if
  it is not.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries, at minimum:
  node25-breaks-jsdom-gate (run the gate under Node 24), combo-recipes-broken-online (the 2033
  stub trap: gprof liveness, not member shape), and the design language program (no DESIGN.md
  phase vocabulary in the UI rows).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-11-fishing.md (the phase contract: deliverables, invariants,
  acceptance criteria, validation commands)
- git diff <phase-start commit>..HEAD (name-only first, then the full diff of
  src/sim/professions/fishing.ts, the sim.ts fishing removal, and the wire and UI changes); the
  phase-start commit hash is in the Phase 11 entry of progress.md
The summary must return: every deliverable and where it landed, the acceptance criteria
checklist, the validation commands the phase ran, and any TODO or deferral the phase recorded.

STEP 2 - QA AUDIT:
Fan out three parallel audit agents; each gets ONLY the Explore summary. Prompt each for
COVERAGE, not filtering: report every gap with confidence (high/medium/low) and severity
(BLOCKING / SHOULD-FIX / NIT); filtering happens afterward in the main session.
- Correctness agent: verify every deliverable and acceptance criterion against the real code,
  not the phase's claims. Rerun the phase's validation commands (the fishing tests,
  tests/deeds.test.ts, tests/snapshots.test.ts, tests/env_protocol.test.ts,
  tests/bandwidth.test.ts, tests/world_api_parity.test.ts, tests/architecture.test.ts,
  npx tsc --noEmit, and the i18n pair: npm run i18n:gen then
  tests/i18n_completeness.test.ts + tests/localization_fixes.test.ts). Exercise the real
  behavior: a scripted Sim run that casts, catches, gains proficiency, and crosses a rarity
  band; then the same read through ClientWorld snapshots for the gprof path.
- Test coverage agent: find untested paths (band thresholds and boundaries, the rare catch
  coexisting with the ladder, proficiency accrual, the wire round trip, the character window
  and wheel window rows). Add missing tests, including a determinism test if any is missing for
  the extracted sim logic (fixed seed, identical cast and catch sequence across runs). Remove
  orphaned tests left behind by the extraction.
- Dead code and cleanup agent: unused imports, types, or private fields left in src/sim/sim.ts
  after the extraction; sim purity in src/sim/professions/fishing.ts (no DOM/Three or
  render/ui/game/net imports, all randomness through Rng); leftover TODOs and debug output;
  confirm the sim.ts net line count did not grow.

PHASE-SPECIFIC QA EMPHASIS (probe these explicitly):
- Move-not-rewrite verification on the extraction: compare src/sim/professions/fishing.ts
  against the pre-phase sim.ts fishing block; the logic must be relocated, not rewritten.
  Dispatch architecture-reviewer on exactly this question.
- Draw-order stability for existing seeds: with a fixed seed, the cast timer and table draws
  must consume Rng in the same order as before the phase, and band 0 must reproduce the shipped
  FISHING_TABLES results.
- gprof round trip: fishing proficiency emitted by server/game.ts, absorbed by the
  src/net/online.ts self-wire, and readable through the IWorld member the UI rows consume;
  verify LIVENESS with a real value change, not member shape (the 2033 stub trap).
- The glimmerfin rare catch and its deed complete unchanged in both hosts (tests/deeds.test.ts
  plus a real-path exercise).

Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows; also spawn the qa-checklist agent (the phase deliverable set is complete). Prompt all of
them for COVERAGE, not filtering. If any subagent output is truncated, re-spawn it to resume
from the truncation point instead of restarting the whole pass.

STEP 3 - FIX:
Apply every BLOCKING and SHOULD-FIX finding (NITs at your judgment, deferred with a written
reason). Rerun the affected validation commands until green. Commit fixes with explicit paths
(never git add -A), Conventional Commits with a body.

STEP 4 - UPDATE DOCS + MEMORY:
Update docs/professions-2/progress.md (QA verdict, fixes applied, deferrals) and
docs/professions-2/state.md if QA changed any surface the phase recorded. Record durable
surprises to memory.

STEP 5 - FINAL RESPONSE FORMAT:
Report: verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL); finding counts by severity (found, fixed,
deferred); deferrals with reasons; one line handing off to the next phase.

STOPPING RULES:
No phase-specific stopping rules. Packet defaults apply: stop and report rather than force a
fix if a finding implies the extraction changed draw order or observable behavior; that is a
phase defect to send back, not a QA patch.
```
