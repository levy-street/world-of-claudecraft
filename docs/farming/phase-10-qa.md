# Phase 10 QA: Verify Celebrations

Audits the Phase 10 PR: the golden_harvest rare event, the farming deeds and title, the
cue chain, and the deliberately moved pins (draw-count contract, deeds totals, the
farming_session golden). The special hazards here are pin drift dressed up as
deliberateness and a rare-event roll that silently forked another profession's draw
order.

### QA Starter Prompt

```
This is Phase 10 QA of the Farming feature: Verify Celebrations.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 10 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- [AMENDED per D22, the Phase 1 QA precedent: no PR exists. The phase lands
  as local commits merged --no-ff into feature/farming-plan (progress.md
  records the merge hash and commit map); audit that merge's phase-side
  parent chain, EXCLUDING any release-sync absorb commits, which carry their
  own audit. QA fix commits land on a fix/farming-phase-10-qa branch off
  feature/farming-plan, merged back --no-ff. Read this file's PR wording
  below through that lens.]
- Same worktree rules: work ONLY in ~/Documents/woc-farming-plan, use
  git -C ~/Documents/woc-farming-plan everywhere, git status clean or stop.
- git fetch origin --prune, then check out the Phase 10 PR branch
  (fix/farming-phase-10-celebrations).
- Identify the phase diff: the PR's commits against its base. Use
  git diff --name-only origin/<base-release-branch>...HEAD (three dots: merge-base
  semantics). The release tip may have moved concurrently, so the diff is the PR's
  commits, never everything since phase start. If the diff cannot be identified cleanly,
  stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  frozen-clock-rig-hangs-vitest, mutation-checks-commit-first, vacuous-bound-pin-trap,
  early-exit-pins-need-work-remaining, one-probe-outranks-agreeing-agents.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to summarize: docs/farming/state.md, the docs/farming/progress.md
Phase 10 notes, the promises in docs/farming/phase-10-celebrations.md (acceptance list,
invariants, any recorded deviation), and git diff --name-only over the phase diff. The
summary must return the acceptance checklist verbatim, every recorded deviation, the diff
file list grouped by surface, and the state.md validation matrix rows the diff demands.

STEP 2 - QA AUDIT
Spawn three parallel audit agents, each with a hard 30-tool-call budget and the coverage
instruction ("report every issue including low-severity and uncertain ones; ranking
happens later"); resume any truncated agent with: "Stop reading more files. Output the
full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Correctness agent: every deliverable and acceptance criterion actually met; the
  offline Sim and the online ClientWorld paths behave identically; edge cases (denial
  still draws zero, golden on the final pick, a chronicle mark in every FARMING_ZONE_TIERS
  zone). Where sim behavior changed, run live headless-Sim probes via a throwaway vitest
  file driving real ticks with an injected ADVANCEABLE clock (the clock must advance
  now() or waits hang), then delete the file and verify the tree is clean. Verify
  the Live-surface note: LIVE, additive: any harvesting player can roll
  golden_harvest and every farming deed and the farming-100 title are earnable the
  moment this merges, with no reachability change to anything that already shipped.
  Phase 10 emphases, all three mandatory: verify the tests/deeds_content.test.ts
  totals re-pin is EXACT and deliberate (new pinned totals equal the old totals
  plus exactly the new records, cross-checked against src/sim/content/deeds.ts, not
  against the test's own
  arithmetic); verify the golden-harvest roll changes no other profession's draw order
  (the parity fingerprint outside the farming scenarios is untouched); verify the zone
  announcement excludes instance space per the existing announceGatherRareEvent fanout
  rules.
- Test-coverage agent: decisive assertions that fail on regression; no
  constant-self-comparison pins; both arms of every either/all claim (the event fires
  and does not fire, a deed earnable and not yet earned); orphaned tests removed;
  mutation checks only AFTER committing the work first.
- Dead-code-and-cleanup agent: unused imports and types; the sim import invariant
  (src/sim/ imports nothing from render, ui, game, or net, and has no DOM or Three
  imports); no unresolved TODOs; naming consistency (golden_harvest, farm:<zone>,
  prog_farming_100, the cue key).
Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that the phase diff matches, plus qa-checklist (the phase-completion gate), under the
same budget and format rules.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first (a failing test that exercises
the real path, then the smallest green change). Run the docs/farming/state.md validation
matrix rows the diff demands. Separate fix commits with explicit paths, never
git add -A, no session links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 10 QA row plus Notes) and
docs/farming/state.md (drift, ledger corrections). Any deviation gets swept into
docs/farming/phase-10-celebrations.md AND this QA twin in the same pass.

STEP 5
No teardown step in this phase; packet teardown belongs to Phase 13 QA only.

STEP 6 - FINAL RESPONSE FORMAT
Verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed per
severity; deferrals with reasons; one line handing off to Phase 11.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.
```
