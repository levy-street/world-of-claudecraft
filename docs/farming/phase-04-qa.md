# Phase 4 QA: Verify Knobs and insurance

A fresh-session audit of the Phase 4 PR: the plant-time knobs, the husk conversion,
and above all the survival of the draw-count contract across every knob combination
(compost, watch, and tonic each on or off gives eight combinations; the pin must hold
for all eight). The audit also probes the fee-bootstrap path (a player with zero
produce must be cleanly denied, never soft-locked) and verifies the binding
Live-surface note in phase-04-knobs.md: everything this phase minted is unobtainable.

### QA Starter Prompt

```
This is Phase 4 QA of the Farming feature: Verify Knobs and insurance.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 4 for correctness, missing tests, dead code, determinism,
three-host parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; prefix every git
  command with git -C ~/Documents/woc-farming-plan; git status must be clean.
- Check out the Phase 4 PR branch (fix/farming-phase-04-knobs unless progress.md
  records another name).
- Identify the phase diff: the PR's commits against its base (gh pr view for the base,
  then git merge-base with it). The release tip may have moved concurrently, so the
  diff is the PR's commits, never everything-since-phase-start. If the diff cannot be
  identified cleanly, stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  mutation-checks-commit-first, frozen-clock-rig-hangs-vitest,
  big-diff-reviewer-turn-budgets, vacuous-bound-pin-trap.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md, the Phase 4
notes in docs/farming/progress.md, the promises in docs/farming/phase-04-knobs.md
(deliverables, acceptance checklist, any swept deviations), and git diff --name-only
over the phase diff. The summary MUST return: the acceptance checklist verbatim; the
pinned draw-count contract values and pin location; the knob payload shape and the
fee predicate as implemented; the convertHusks gate comment text; the diff file list
grouped by surface (sim, world_api, net, ui i18n, tests, docs).

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Each gets a hard 30-tool-call budget and the
coverage instruction: "report every issue including low-severity and uncertain ones;
ranking happens later." If one truncates, resume it with: "Stop reading more files.
Output the full report now based on what you have already seen. No more tool calls.
Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

Correctness agent:
- Every deliverable and acceptance criterion in phase-04-knobs.md actually met.
- The offline Sim and online ClientWorld paths behave identically for the knobbed
  plantCrop and for convertHusks.
- Edge cases: empty (no compost, no tonic, no husks), boundary (survival exactly at
  100; fee produce of tier exactly equal to the crop's tier), and every deny arm.
- Sim behavior changed, so run live headless-Sim probes: a throwaway vitest file
  driving real ticks with an injected ADVANCEABLE clock (advance now(), never a
  frozen clock). Drive a plant-grow-harvest session for EVERY one of the eight knob
  combinations and count real rng draws each time: the contract pin must hold for all
  eight. Probe the fee-bootstrap path: a player holding zero farming produce who
  requests farmer's watch is cleanly denied (nothing consumed, zero draws, a
  localized denial line), never soft-locked. Then delete the throwaway file and
  verify the tree is clean (git status).
- Verify the Live-surface note: no vendorItems row, recipe, loot source, or quest
  reward yields compost, growth_tonic, withered husks, or any seed.
- Verify the D9 pricing split: compost carries a positive buyValue on its item def,
  the growth tonic carries none, and no vendorItems row anywhere gained either item
  yet.

Test-coverage agent:
- Every claimed behavior has a decisive assertion that fails on regression.
- No constant-self-comparison pins: the draw-contract pin must count real draws, not
  compare an exported constant to itself.
- Both arms of every either/all claim: each knob has a consume-side test AND a
  deny-side test; the cap has an at-100 and an above-100 case.
- A same-seed determinism pin is present and decisive.
- Orphaned tests removed; no test asserts Phase 3 behavior the knobs replaced.
- Mutation checks only AFTER committing the work first (never plant a mutation over
  an uncommitted tree).

Dead-code-and-cleanup agent:
- Unused imports and types across the diff.
- The sim import invariant: src/sim/ imports nothing from render, ui, game, or net,
  and has no DOM or Three imports.
- No unresolved TODOs anywhere in the diff; the convertHusks Phase 9 gate comment
  must be TODO-free while still naming Phase 9.
- Naming consistency with the farming module's existing vocabulary.

Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that match the phase diff (expect architecture-reviewer and cross-platform-sync),
plus qa-checklist as the phase-completion gate, with the same budget, coverage, and
resume instructions.

STEP 3 - FIX
Apply ALL BLOCKING and SHOULD-FIX findings test-first: reproduce with a failing test
that exercises the real code path, then the smallest change that turns it green. Run
the docs/farming/state.md validation matrix rows the fix diff demands. Land fixes as
separate Conventional Commits with explicit paths, never git add -A, no session links
or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 4 QA row plus Notes: findings, fixes,
deferrals) and docs/farming/state.md (any drift discovered, ledger corrections).

STEP 5 - FINAL RESPONSE FORMAT
Report: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed
per severity; deferrals with reasons; and a one-line handoff.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.

When the audit and fixes are done: gate via node scripts/gate_select.mjs (the armory
browser red is the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker;
PR CI is the arbiter) and push the fix commits to the phase PR branch.
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
