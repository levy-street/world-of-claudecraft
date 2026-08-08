# Phase 3 QA: Verify The growth engine

This session audits the Phase 3 PR after it is open: the gate order, the contiguous
pre-roll block, the draw-count contract (including a live mutation probe against its
pins), the anti-chore guarantees, the cast-site audit, the command chain, and the
farming_session parity scenario. Fixes ride the same PR branch as separate commits.
The design authority is `docs/farming/state.md`; the promises under audit are
`docs/farming/phase-03-growth-engine.md`.

### QA Starter Prompt

```
This is Phase 3 QA of the Farming feature: Verify "The growth engine".
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 3 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; git status must
  be clean; use git -C with the absolute path on every git command.
- AMENDED per D22: no PR exists and the phase branch is deleted after its merge.
  git fetch origin --prune, check out the LOCAL feature/farming-plan, and audit
  the Phase 3 merge commit (the --no-ff merge of fix/farming-phase-03-growth-engine;
  find it with git log --merges --oneline -5).
- Identify the phase diff from that merge: git diff --name-only <merge>^1 <merge>
  (first parent to merge tip), and the phase commits with
  git log --oneline <merge>^1..<merge>^2. NEVER everything-since-phase-start (the
  release tip may have been absorbed concurrently).
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  frozen-clock-rig-hangs-vitest, mutation-checks-commit-first,
  mutation-verdicts-need-exit-code-plus-names, mutation-edits-need-landing-proof,
  early-exit-pins-need-work-remaining, unkillable-mutant-diagnosis,
  big-diff-reviewer-turn-budgets, node25-breaks-jsdom-gate.

STEP 1 - LOAD CONTEXT
Spawn ONE Explore agent to read and summarize: docs/farming/state.md (locked
decisions, especially D3 through D7 and the tick and hook points), the Phase 3 notes
in docs/farming/progress.md (including the decided draw counts, stage count, and
tuning constants), the promises in docs/farming/phase-03-growth-engine.md
(deliverables, acceptance criteria, live-surface note, the stated gate order and draw
contract), and the git diff --name-only file list over the phase diff. The summary
must return: the acceptance checklist verbatim, the stated draw-count contract (N at
plant, M at harvest), the gate order as implemented, the SimEvent and deny-result id
list, and every promise the diff appears NOT to touch.

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Every agent gets a hard 30-tool-call budget,
report-first instructions, and the coverage instruction "report every issue including
low-severity and uncertain ones; ranking happens later". If one truncates or stalls,
resume it with exactly: "Stop reading more files. Output the full report now based on
what you have already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."

Agent 1, correctness:
- Verify every deliverable and every acceptance criterion in
  docs/farming/phase-03-growth-engine.md is actually met, against the real code.
- Phase 3 emphasis, the live lifecycle probe: sim behavior changed, so run live
  headless-Sim probes via a throwaway vitest file driving real ticks with an injected
  ADVANCEABLE lockoutNowMs clock (a clock that never advances hangs self-re-arming
  waits: always advance it): plant with a dev-granted seed, advance past ready-at,
  harvest, and assert produce granted and XP queued; also probe one deny arm and one
  withered path live. Delete the throwaway file afterward and verify the tree is
  clean.
- Phase 3 emphasis, the anti-chore guarantees: the late-harvest pin exists and is
  decisive (a harvest N hours late yields exactly what an on-time harvest yields),
  AND audit the code for any path that requires a third visit: no decay after ready,
  no wither triggered by lateness, no watering, no mid-growth interaction of any
  kind (D8). Any such path is BLOCKING.
- The offline Sim and online ClientWorld paths behave identically: the command
  members exist on both, deny results and events mirror, and the Phase 2 negative
  wire-leak pin still passes with hidden slots now filled by real plants.
- Edge cases: empty (no plots, harvest on an empty bed), boundary (skill exactly at
  the tier threshold, exactly at band top, harvest exactly at ready-at), and every
  deny arm.
- Phase 3 emphasis, the D11 minimal slice: verify the fine_vale_wheat twin and its
  MATERIAL_GRADES row landed beside vale_wheat, and that
  npx vitest run tests/recipe_economy.test.ts ran green over the new rows.
- Verify the exact /dev farm cheat names were recorded in the state.md "Dev command
  surface" ledger row.
- Verify the live-surface note: no seed is obtainable online (no vendor row, no drop,
  no faucet), so plant is unreachable by players; the /dev cheats are gated behind
  ALLOW_DEV_COMMANDS.

Agent 2, test coverage:
- Every claimed behavior has a DECISIVE assertion that fails on regression; no
  constant-self-comparison pins (draw counts pinned to literal numbers, not to the
  same constant the module exports).
- Both arms of every either/all claim: each gate needs its deny arm AND the pass-
  through arm (early-exit ordering: failing the LAST gate proves nothing about order;
  the suite must show an earlier gate short-circuits a later one); survival needs
  at-gate, band-top, and one-band-above arms; harvest needs ready AND withered arms.
- A same-seed determinism pin is present and decisive.
- The draw-count pins cover every path: plant, harvest, each deny arm, expiry, login,
  and the tick sweep (zero-draw pins must actually traverse the path they claim).
- Orphaned tests removed; the injected clock in every test actually advances.
- Phase 3 emphasis, the draw-contract mutation probe, in this exact order
  (mutation-checks-commit-first): FIRST verify the work state is fully committed
  (git status clean); THEN add one extra ctx.rng draw inside the plant pre-roll
  block; run the named draw-count pins and the parity scenario; require a nonzero
  exit code AND named failing tests (rc alone is not a verdict); grep the mutated
  line to prove the edit landed where intended; revert the mutation and verify the
  tree matches the commit exactly (git status clean, git diff empty). A surviving
  mutant is a BLOCKING coverage gap: diagnose (dead code, unobservable rig, or real
  gap) before adding a test.

Agent 3, dead code and cleanup:
- Unused imports and types across the diff; the sim import invariant (no
  DOM/Three/render/ui/game/net imports in src/sim/); no unresolved TODOs (the
  Phase 8 lap marker in updateFarming is a documented forward reference, not a
  TODO); naming consistency (FARMING_CAST_ID, FARMING_GAIN_SCHEDULE, the event and
  deny ids against the Phase 3 brief); no leftover throwaway probe files; no
  commented-out code.

Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that match the phase diff (expected: architecture-reviewer, cross-platform-sync,
privacy-security-review, frontend-seam-reviewer), plus qa-checklist as the
phase-completion gate. Same budget,
coverage, and truncation-resume rules.

STEP 3 - FIX
- Apply ALL BLOCKING and SHOULD-FIX findings test-first: reproduce with a failing
  test, then the smallest change to green.
- Run the state.md validation matrix rows the diff demands (at minimum: npx tsc
  --noEmit, tests/professions_farming.test.ts, tests/architecture.test.ts,
  tests/recipe_economy.test.ts, the snapshots suites,
  tests/localization_fixes.test.ts, tests/parity with no pre-existing golden moved,
  npm run ci:changed).
- Separate fix commits with explicit paths, Conventional Commits with bodies, never
  git add -A, no session links or Claude attribution.
- After fixes: node scripts/gate_select.mjs (the armory browser red is the standing
  environmental exception; grep the log for "FAIL" (the selective gate prints
  "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker).
  AMENDED per D22: no push, no PR, and the gate log IS the arbiter (there is no PR
  CI). Fix commits land on a local QA branch cut off feature/farming-plan and merge
  back --no-ff when no BLOCKING stands.

STEP 4 - DOC UPDATES
- docs/farming/progress.md: fill the Phase 3 QA row (status, dates) and append QA
  findings, including the mutation-probe outcome, to the Phase 3 Notes block.
- docs/farming/state.md: record any drift discovered (ledger corrections, deviations,
  a draw-count restatement). If the phase file was amended, sweep this QA twin in the
  same pass.

STEP 5 - FINAL RESPONSE FORMAT
Report exactly: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and
issues fixed, by severity; deferrals with reasons; and a one-line handoff (merge
readiness and what Phase 4 should know, especially the knob-slot entry points).

STOPPING RULES
- STOP and surface if a BLOCKING cannot be fixed without changing phase scope (in
  particular, any draw living outside a command body or any required third visit).
- STOP if the phase diff cannot be identified cleanly (no PR, an ambiguous base, or
  foreign commits interleaved).
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
