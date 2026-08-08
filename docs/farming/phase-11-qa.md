# Phase 11 QA: Verify Well-fed food

Audits the Phase 11 PR: the wellfed ItemDef arm, the four tier dishes, aura naming, and
the tooltip and buff bar surface. The special hazards here are namespace leakage (a food
buff clobbering an elixir or the reverse), a stacking rule that holds in only one
direction, and a timing decision that was made but never pinned.

### QA Starter Prompt

```
This is Phase 11 QA of the Farming feature: Verify Well-fed food.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 11 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Same worktree rules: work ONLY in ~/Documents/woc-farming-plan, use
  git -C ~/Documents/woc-farming-plan everywhere, git status clean or stop.
- git fetch origin --prune, then check out the Phase 11 PR branch
  (fix/farming-phase-11-well-fed-food).
- Identify the phase diff: the PR's commits against its base. Use
  git diff --name-only origin/<base-release-branch>...HEAD (three dots: merge-base
  semantics). The release tip may have moved concurrently, so the diff is the PR's
  commits, never everything since phase start. If the diff cannot be identified cleanly,
  stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  frozen-clock-rig-hangs-vitest, mutation-checks-commit-first, vacuous-bound-pin-trap,
  joint-coverage-masks-deleted-sites, one-probe-outranks-agreeing-agents.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to summarize: docs/farming/state.md, the docs/farming/progress.md
Phase 11 notes (including the recorded timing decision and proposed magnitudes), the
promises in docs/farming/phase-11-well-fed-food.md (acceptance list, invariants, any
recorded deviation), and git diff --name-only over the phase diff. The summary must
return the acceptance checklist verbatim, the timing decision as recorded, every
recorded deviation, the diff file list grouped by surface, and the state.md validation
matrix rows the diff demands.

STEP 2 - QA AUDIT
Spawn three parallel audit agents, each with a hard 30-tool-call budget and the coverage
instruction ("report every issue including low-severity and uncertain ones; ranking
happens later"); resume any truncated agent with: "Stop reading more files. Output the
full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Correctness agent: every deliverable and acceptance criterion actually met; the
  offline Sim and the online ClientWorld paths behave identically; edge cases (eating a
  second dish of the same kind, eating during an active elixir, interrupting the
  sit-restore before completion under the chosen timing). Where sim behavior changed,
  run live headless-Sim probes via a throwaway vitest file driving real ticks with an
  injected ADVANCEABLE clock (the clock must advance now() or waits hang), then delete
  the file and verify the tree is clean. Verify the Live-surface note: LIVE,
  additive: any player with produce can cook the buff dishes, eat them, and carry a
  well-fed buff the moment this merges, with the elixir slots and every existing
  elixir behavior untouched. Phase 11 emphases, both mandatory: run the
  coexistence probe LIVE (one player with an elixir_<kind> buff and a wellfed buff
  active simultaneously; drive real ticks, then confirm both appear in the buff bar
  rows through the auras view chain with correct remaining times); exercise the
  last-eaten-wins pin live (eat dish A, then dish B; B's aura stands alone in the
  wellfed namespace and A's is gone, while the elixir is untouched).
- Test-coverage agent: decisive assertions that fail on regression; no
  constant-self-comparison pins; both arms of every either/all claim (isolation proven
  in BOTH directions: wellfed does not clobber elixir AND elixir does not clobber
  wellfed; stacking denied AND replacement allowed); orphaned tests removed; mutation
  checks only AFTER committing the work first.
- Dead-code-and-cleanup agent: unused imports and types; the sim import invariant
  (src/sim/ imports nothing from render, ui, game, or net, and has no DOM or Three
  imports); no unresolved TODOs; naming consistency (wellfed_<kind> ids, dish item ids,
  aura name keys).
Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that the phase diff matches, plus qa-checklist (the phase-completion gate), under the
same budget and format rules.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first (a failing test that exercises
the real path, then the smallest green change). Run the docs/farming/state.md validation
matrix rows the diff demands. Separate fix commits with explicit paths, never
git add -A, no session links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 11 QA row plus Notes) and
docs/farming/state.md (drift, ledger corrections). Any deviation gets swept into
docs/farming/phase-11-well-fed-food.md AND this QA twin in the same pass.

STEP 5
No teardown step in this phase; packet teardown belongs to Phase 13 QA only.

STEP 6 - FINAL RESPONSE FORMAT
Verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed per
severity; deferrals with reasons; one line handing off to Phase 12.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.
```
