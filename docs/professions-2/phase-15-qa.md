# Phase 15 QA: Verify Deeds, tuning, and polish

Audit the Phase 15 diff and run the whole-feature integration matrix: this QA session is the
final audit of the entire Professions 2.0 packet, ending with the teardown offer.

## Phase-specific QA emphasis

- This session IS the final integration audit for the whole packet, not just Phase 15: every
  row of `docs/professions-2/qa-checklist.md` needs fresh evidence (test name, command output,
  or screenshot path), even rows earlier phase QAs already checked.
- Prove the deed catalog is append-only: all pre-packet deeds remain earnable and pinned, and
  every new deed unlocks in the scripted playthrough test.
- Verify every tuning constant against the final numbers in `state.md`: named export, pinned
  value, nothing inline at a call site, no placeholder target left behind.
- Spot-check the rewritten wiki professions page against the real sim code: every claim the
  page makes must be true of the shipped system, and the teardown offer must follow the house
  rule exactly.

## QA Starter Prompt

```
This is Phase 15 QA of the Professions 2.0 feature: verify Deeds, tuning, and polish, and run
the final whole-packet integration audit.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: audit the Phase 15 work for correctness, missing tests, dead code, determinism,
three-host parity, and i18n completeness, then evidence the entire whole-feature QA matrix and
close the packet.

STEP 0 - PRE-FLIGHT:
- Run git status; the checkout must be clean. Stop if dirty.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries; at minimum read:
  node25-breaks-jsdom-gate (the gate MUST run under Node 24), design-language-program (no
  DESIGN.md phase vocabulary in guide or HUD copy), and any professions / PR 2039 packet
  entries recorded by earlier phases.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md, docs/professions-2/progress.md, and
  docs/professions-2/phase-15-deeds-polish.md (including its acceptance criteria).
- docs/professions-2/qa-checklist.md and the evidence the implementation session recorded.
- git diff against the phase-start commit recorded in progress.md (git diff --stat and the
  full diff for src/sim/, src/guide/, and test files).
The summary must return: every Phase 15 deliverable and acceptance criterion; the list of new
deed ids and their trigger wiring; each tuning constant's file, symbol, and final value versus
the state.md targets; the guide page's generated-data feeds; the validation commands for this
phase; and any deferral or open item the implementation session left.

STEP 2 - QA AUDIT:
Fan out three parallel audit agents; each gets ONLY the Explore summary. Prompt every agent for
COVERAGE, not filtering: report every gap with confidence and severity; filtering happens in
the fix pass. If any agent's output comes back truncated, re-prompt that agent to resume and
finish its report before acting on it.

Agent correctness deliverables:
- Verify every Phase 15 deliverable and acceptance criterion against the real code, not the
  progress notes.
- Run the phase's validation commands: npx vitest run tests/deeds_content.test.ts
  tests/deeds.test.ts tests/guide.test.ts; npm run wiki:content; npx vitest run
  tests/architecture.test.ts tests/localization_fixes.test.ts; npx tsc --noEmit.
- Exercise the real behavior: run the scripted playthrough test and confirm every new deed
  unlocks; confirm the rare fish deed was verified, not duplicated; diff each tuning constant
  against state.md's final numbers; spot-check the wiki page's claims against src/sim/ source.

Agent test coverage deliverables:
- Find untested paths: any deed trigger without a pinned test, any tuning constant without a
  value pin, any guide data feed without freshness coverage.
- Add missing tests, including a determinism test if Phase 15 touched sim logic (same seed,
  same deed unlock sequence; deed triggers must not perturb existing Rng draw order).
- Remove orphaned tests (pins for placeholder tuning values or pre-rewrite guide content).

Agent dead code and cleanup deliverables:
- Unused imports and types across the Phase 15 diff; leftover TODOs and placeholder targets.
- Sim purity in every touched src/sim/ file: no DOM or Three imports, no Math.random, Date.now,
  or performance.now.
- Stale asset-manifest.json rows and any packet-era scaffolding that should not ship.

Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows, plus the qa-checklist agent (the packet is complete). Prompt them all for COVERAGE, not
filtering, with the same truncation-resume rule.
Finally, in the main session, run docs/professions-2/qa-checklist.md end to end and record
fresh evidence per row: this QA session is the final integration audit for the whole packet.

STEP 3 - FIX:
Apply every BLOCKING and SHOULD-FIX finding (defer only nice-to-haves, listed explicitly).
Rerun the validation commands above plus any qa-checklist rows the fixes invalidated, then
npm run gate under Node 24 (the known armory browser-test failure aborts the gate early; finish
tsc and the builds manually; PR CI is the arbiter). Commit fixes with explicit paths (never
git add -A), Conventional Commits with a scope and a body.

STEP 4 - UPDATE DOCS + MEMORY:
Update docs/professions-2/progress.md (Phase 15 QA verdict, fix commits, packet completion) and
docs/professions-2/state.md (current-phase pointer to packet complete; any constant or surface
the fixes changed). Record surprises to Claude Code memory.

STEP 5 - PACKET TEARDOWN OFFER (this step exists ONLY because this is Phase 15):
Offer packet teardown exactly per the house rule: first surface every deferral and open item
from the whole packet (state.md OPEN items, per-phase deferrals, wave 2 pointers) so nothing is
lost with the docs; then ask the maintainer for EXPLICIT confirmation to delete
docs/professions-2/ before the final PR. Only delete on an explicit yes; commit the deletion
with explicit paths, never git add -A. If the answer is no or deferred, leave the packet in
place and record the decision in progress.md.

STEP 6 - FINAL RESPONSE FORMAT:
Report: verdict (PASS / PASS-WITH-FOLLOWUPS / FAIL); counts of findings by severity (blocking,
should-fix, deferred) and how many were fixed; the qa-checklist evidence summary; deferrals
carried forward; the teardown outcome; and a one-line handoff (the packet's final state and
where the PR stands).

STOPPING RULES:
- Stop if any qa-checklist.md row cannot be evidenced; report the row and the missing evidence
  instead of checking it on vibes.
- Stop if a fix would require weakening a pre-existing deed or economy pin; that is a defect to
  report, not a re-pin.
- No commit while any BLOCKING finding stands.
- Never delete docs/professions-2/ without the explicit maintainer confirmation in STEP 5.
```
