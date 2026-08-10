# Phase 6 QA: Verify Economy hooks

A fresh-session audit of the Phase 6 PR: the cooking dishes, the alchemy tonic
recipe, and the two claims that define the phase. First, the dormancy negative from
the binding Live-surface note: no new recipe is craftable from vendor goods alone.
Second, chain integrity: every new recipe's reagent chain terminates in Phase 5
content or existing materials, and the consumer rule over every Phase 5 material is
now closed with real consumers, not notes.

### QA Starter Prompt

```
This is Phase 6 QA of the Farming feature: Verify Economy hooks.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 6 for correctness, missing tests, dead code, determinism,
three-host parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; prefix every git
  command with git -C ~/Documents/woc-farming-plan; git status must be clean.
- [AMENDED per D22, the Phase 1 QA precedent: no PR exists. The phase landed as
  local commits merged --no-ff into feature/farming-plan; audit the merge commit
  (progress.md records it) and its phase-side parent chain. The phase diff is
  the commits AFTER the tenth release absorb 6b04c188ff (which was
  release-merge-audited separately): feat(cooking) ae814834f3, feat(alchemy)
  f570a39002, test(economy) f76fb4e41e, fix(ui) 544a291f98, fix(review)
  0a692e8896, fix(test) 5215f712d7 (the three release art-program collision
  heals, deviations (ak)/(al)), test(economy) 22ee3a3857 (the QA-round pins),
  plus the docs commits.]
- If the diff cannot be identified cleanly, stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  mutation-checks-commit-first, i18n-semantic-regressions-gate-trap,
  big-diff-reviewer-turn-budgets.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md, the Phase 6
notes in docs/farming/progress.md, the promises in
docs/farming/phase-06-economy-hooks.md (deliverables, acceptance checklist, any
swept deviations), and git diff --name-only over the phase diff. The summary MUST
return: the acceptance checklist verbatim; every new recipe id with its full reagent
list; the list of Phase 5 materials whose consumer notes were closed and by what
consumer; the budget conventions the dishes and tonic claim to conform to; the diff
file list grouped by surface (content, tests, ui i18n, wiki artifacts, docs).

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Each gets a hard 30-tool-call budget and the
coverage instruction: "report every issue including low-severity and uncertain ones;
ranking happens later." If one truncates, resume it with: "Stop reading more files.
Output the full report now based on what you have already seen. No more tool calls.
Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

Correctness agent:
- Every deliverable and acceptance criterion in phase-06-economy-hooks.md actually
  met; each dish is foodHp only with no buff machinery of any kind.
- PHASE EMPHASIS, the vendor-goods-alone negative: for EVERY new recipe, walk the
  reagent chain against the vendor tables; at least one reagent must have no vendor
  faucet (no vendorItems row anywhere sells it, directly or via a craftable chain of
  vendor-only inputs). A recipe craftable from vendor goods alone violates the
  binding Live-surface note and is BLOCKING.
  [AMENDED by deviation (ai), state.md wins: craftable-from-WILD-HERBS is NOT a
  violation for the tonic (D7 locks herbs as its inputs; silverleaf_herb has no
  vendor faucet, which is exactly what the pin asserts). The BLOCKING bar is
  vendor-goods-alone, not obtainable-inputs-alone; the dishes additionally keep a
  farm-produce reagent nobody can grow before go-live.]
- PHASE EMPHASIS, chain termination: every new recipe's reagent chain terminates in
  Phase 5 farming content or existing materials; no reagent id dangles or references
  unshipped content.
- The consumer rule is fully closed: every Phase 5 produce and the withered husks
  now have a real recipe or command consumer, and no Phase 6 consumer note remains
  in the rollout arms.
- The offline Sim and online ClientWorld paths behave identically wherever behavior
  moved; if any sim behavior changed (beyond content rows), run live headless-Sim
  probes via a throwaway vitest file driving real ticks with an injected ADVANCEABLE
  clock, then delete it and verify the tree is clean (git status).
- Edge cases: empty, boundary, deny arms (crafting each new recipe without its farm
  reagent is denied by the normal recipe machinery).
- Verify the purity guard ran: tests/architecture.test.ts is green over the phase
  diff, per the phase's STEP 3 run list.

Test-coverage agent:
- Every claimed behavior has a decisive assertion that fails on regression: the
  consumer-rule pin must fail if a consumer row is deleted, and the
  vendor-goods-alone pin must fail if a reagent gains a vendor faucet.
- No constant-self-comparison pins: the pins must read the real recipe and vendor
  tables, never re-derive expectations from the object under test.
- Both arms of every either/all claim: conforms and violates arms for the budget
  checks where the suite supports it.
- A determinism pin is present if any draw path changed (none is expected this
  phase; flag it if one appears).
- Orphaned tests removed: no test still asserts a Phase 6 consumer note that this
  phase replaced.
- Mutation checks only AFTER committing the work first.

Dead-code-and-cleanup agent:
- Unused imports and types across the diff.
- The sim import invariant: src/sim/ imports nothing from render, ui, game, or net,
  and has no DOM or Three imports.
- No unresolved TODOs anywhere in the diff.
- Naming consistency: dish and recipe ids and i18n keys follow the existing cooking
  and alchemy schemes.

Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that match the phase diff (expect architecture-reviewer and frontend-seam-reviewer;
cross-platform-sync only if an event or wire surface moved), plus qa-checklist as
the phase-completion gate, with the same budget, coverage, and resume instructions.

STEP 3 - FIX
Apply ALL BLOCKING and SHOULD-FIX findings test-first: reproduce with a failing test
that exercises the real code path, then the smallest change that turns it green. Run
the docs/farming/state.md validation matrix rows the fix diff demands (content
changes demand the rollout, recipe-economy, and wiki-freshness rows, plus
tests/architecture.test.ts, the purity guard the phase's STEP 3 runs). Land fixes as
separate Conventional Commits with explicit paths, never git add -A, no session
links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 6 QA row plus Notes: findings, fixes,
deferrals) and docs/farming/state.md (any drift discovered, ledger corrections).

STEP 5 - FINAL RESPONSE FORMAT
Report: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed
per severity; deferrals with reasons; and a one-line handoff.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope (a
  budget ceiling that needs a maintainer call, a reagent chain that cannot close
  without new content).
- Stop if the phase diff cannot be identified cleanly.

When the audit and fixes are done: gate via node scripts/gate_select.mjs (the armory
browser red is the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker;
PR CI is the arbiter) and push the fix commits to the phase PR branch.
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
