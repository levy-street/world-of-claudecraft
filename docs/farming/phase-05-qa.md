# Phase 5 QA: Verify Crops and tools

A fresh-session audit of the Phase 5 PR, the big content sweep. The rollout and
placement suites are the spine of this audit: run them first and treat every farming
arm as a promise to re-verify by hand. The two sharpest checks: every new material
satisfies the consumer rule (a real consumer or an explicit Phase 6 consumer note),
and NO vendorItems row anywhere in the content set gained a farming item, which is
the binding Live-surface note of phase-05-crops-and-tools.md.

### QA Starter Prompt

```
This is Phase 5 QA of the Farming feature: Verify Crops and tools.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 5 for correctness, missing tests, dead code, determinism,
three-host parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; prefix every git
  command with git -C ~/Documents/woc-farming-plan; git status must be clean.
- Check out the Phase 5 PR branch (fix/farming-phase-05-crops-and-tools unless
  progress.md records another name).
- Identify the phase diff: the PR's commits against its base (gh pr view for the
  base, then git merge-base with it). The release tip may have moved concurrently,
  so the diff is the PR's commits, never everything-since-phase-start. If the diff
  cannot be identified cleanly, stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  mutation-checks-commit-first, i18n-semantic-regressions-gate-trap,
  big-diff-reviewer-turn-budgets, vacuous-bound-pin-trap.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md, the Phase 5
notes in docs/farming/progress.md, the promises in
docs/farming/phase-05-crops-and-tools.md (deliverables, acceptance checklist, any
swept deviations, the fine-twin pricing convention as actually implemented), and
git diff --name-only over the phase diff. The summary MUST return: the acceptance
checklist verbatim; the eight crop ids with their item ids (seed, produce, fine
twin); the hoe rung ids and pricing; the seed-back rates as proposed; the re-pinned
draw-count contract values; whether the farming_session golden re-record commit is
isolated; the diff file list grouped by surface (content, sim, tests, ui i18n, wiki
artifacts, docs).

STEP 2 - QA AUDIT
First run the spine yourself: npx vitest run tests/professions_zone_rollout.test.ts
tests/farm_patch_placement.test.ts. Both must be green before the audit fans out; a
red here is an immediate BLOCKING.
Then spawn three parallel audit agents. Each gets a hard 30-tool-call budget and the
coverage instruction: "report every issue including low-severity and uncertain ones;
ranking happens later." If one truncates, resume it with: "Stop reading more files.
Output the full report now based on what you have already seen. No more tool calls.
Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

Correctness agent:
- Every deliverable and acceptance criterion in phase-05-crops-and-tools.md actually
  met: walk all eight crops row by row (seed, produce, fine twin, grade row, icon,
  English name) and all four hoe rungs (tier, recipe, pricing, top rung unpriced).
- The offline Sim and online ClientWorld paths behave identically wherever behavior
  moved (the seed-back roll at harvest is the sim change to probe).
- Edge cases: empty, boundary, deny arms; a tier 4 harvest rolls seed-back, a tier 1
  harvest does not (both arms).
- Sim behavior changed (seed-back draws), so run live headless-Sim probes: a
  throwaway vitest file driving real ticks with an injected ADVANCEABLE clock,
  planting and harvesting a tier 3 or 4 crop, counting real rng draws against the
  re-pinned contract. Then delete the throwaway file and verify the tree is clean
  (git status).
- PHASE EMPHASIS, the consumer rule: audit EVERY new material (all produce, all fine
  twins, and every other new item) for a real consumer or an explicit Phase 6
  consumer note in the rollout arm; an unnoted orphan material is BLOCKING.
- PHASE EMPHASIS, the Live-surface note: check that NO NpcDef.vendorItems row
  anywhere gained a farming item (seeds, produce, fine twins, hoes, compost, growth
  tonic, husks). Search the whole content set, not just changed files. Also verify
  tier 1 and 2 seeds carry a positive buyValue with no row (the Phase 9
  precondition), brook_carrot carries its buyValue at the four-times-sell
  convention (the starter fee vegetable, D9) while no OTHER produce carries one,
  and the top hoe rung is unpriced.
- IP-safety spot audit of every proposed display name per D17.

Test-coverage agent:
- Every claimed behavior has a decisive assertion that fails on regression; the
  rollout arms must fail when a row is removed (probe one mentally, or by mutation
  AFTER the work is committed).
- No constant-self-comparison pins: integrity arms must read the real content
  tables, not re-derive expectations from the same object they check.
- Both arms of every either/all claim: the seed-back roll has a rolls arm (tier 3
  and 4) and a does-not-roll arm (tier 1 and 2); the tool-effect pin covers all
  three effects.
- A determinism pin is present for the changed draw path.
- Orphaned tests removed; no pin still asserts the pre-Phase-5 draw contract.

Dead-code-and-cleanup agent:
- Unused imports and types across the diff; no leftover scaffolding from the
  Workflow sweep.
- The sim import invariant: src/sim/ imports nothing from render, ui, game, or net,
  and has no DOM or Three imports.
- No unresolved TODOs anywhere in the diff (the Phase 6 consumer notes and the
  Phase 9 stocking note are named-phase comments, not TODO markers).
- Naming consistency: item ids, i18n keys, and icon keys follow one scheme across
  all eight crops.

Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that match the phase diff (expect architecture-reviewer and frontend-seam-reviewer;
cross-platform-sync only if an event or wire surface moved), plus qa-checklist as
the phase-completion gate, with the same budget, coverage, and resume instructions.

STEP 3 - FIX
Apply ALL BLOCKING and SHOULD-FIX findings test-first: reproduce with a failing test
that exercises the real code path, then the smallest change that turns it green. Run
the docs/farming/state.md validation matrix rows the fix diff demands (content
changes demand the rollout, recipe-economy, and wiki-freshness rows). Land fixes as
separate Conventional Commits with explicit paths, never git add -A, no session
links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 5 QA row plus Notes: findings, fixes,
deferrals) and docs/farming/state.md (any drift discovered, ledger corrections, the
verified fine-twin pricing convention if it diverged from the phase file's wording).

STEP 5 - FINAL RESPONSE FORMAT
Report: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed
per severity; deferrals with reasons; and a one-line handoff.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope (a
  locked crop id, a draw-contract change beyond the seed-back extension).
- Stop if the phase diff cannot be identified cleanly.

When the audit and fixes are done: gate via node scripts/gate_select.mjs (the armory
browser red is the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker;
PR CI is the arbiter) and push the fix commits to the phase PR branch.
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
