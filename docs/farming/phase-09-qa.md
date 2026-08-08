# Phase 9 QA: Verify World presence: go-live

Independent verification of the go-live merge in a fresh session. This is the
highest-stakes QA in the packet: ordinary players can now reach the loop, so the audit
plays the ENTIRE new-player journey on the live client (the go-live acceptance),
purchase-tests every vendor row (the dead-row trap leaves no compile error and no test
red, only a player-facing refusal), confirms the work-order payout arithmetic against
its guard, and proves the atomicity claim: everything this phase opened is reachable,
and everything later phases own is still not.

### QA Starter Prompt

```
This is Phase 9 QA of the Farming feature: Verify World presence: go-live.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 9 for correctness, missing tests, dead code, determinism,
three-host parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; git status must
  be clean. Check out the phase branch fix/farming-phase-09-world-presence (QA fix
  commits land on the phase PR).
- Identify the phase diff: the PR's commits against its base (git merge-base the PR
  branch with the release branch it was opened against, then diff that range). The
  release tip may have moved concurrently, so the diff is the PR's commits, never
  everything-since-phase-start. Stop if the diff cannot be identified cleanly.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry,
  pr-screenshot-browser-path (browser path, swiftshader flags, overlay traps),
  frozen-clock-rig-hangs-vitest, mutation-checks-commit-first,
  big-diff-reviewer-turn-budgets.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md; the
docs/farming/progress.md Phase 9 notes (including the NPC names, the work-order
crops chosen, and any recorded deviation); the promises in
docs/farming/phase-09-world-presence.md (Live-surface note, deliverables,
acceptance criteria); and git diff --name-only over the phase diff. The summary
must return the acceptance list verbatim, the file list, the four NPC ids and their
vendor rows, the quest id and objective shape, the work-order rows, and whether the
parity regen commit is isolated.

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Each gets a hard 30-tool-call budget and the
coverage instruction: "report every issue including low-severity and uncertain
ones; ranking happens later." If truncated, resume with: "Stop reading more files.
Output the full report now based on what you have already seen. No more tool calls.
Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

Agent 1, correctness:
- Verify every deliverable and every acceptance criterion in the phase file is
  actually met, not just claimed.
- Play the ENTIRE new-player journey on the live client (the go-live acceptance):
  start the dev server, drive the real dev client headless (the browser path and
  swiftshader flags from the pr-screenshot-browser-path memory entry), dismissing
  any first-run prompt overlays before clicking. As a fresh character: walk to
  farmer_jessica at Eastbrook, accept q_farm_intro (verify the granted hoe and
  seed), buy a tier 1 seed, plant with a knob applied, dev-advance growth
  (ALLOW_DEV_COMMANDS=1, dev only), see the ready banner, harvest, complete the
  quest (verify the magic sentence appears in the greeting and completion text),
  pay a watch fee, convert a husk, and cook a Phase 6 dish. Any break in this
  chain is BLOCKING: atomicity was the phase's one hard rule.
- Verify EVERY stocked vendor row purchase-tests clean across all four farmers: a
  live purchase probe per row with sufficient copper must succeed (no dead rows;
  a row with a missing or non-positive buyValue renders then refuses and no
  compiler catches it), the brook_carrot (the starter fee vegetable) and compost
  rows explicitly among the probes. Also verify tier 3 and 4 seeds are stocked
  nowhere.
- Verify the offline Sim and online ClientWorld paths behave identically for the
  new flows (purchase, quest credit, fees, conversion): where sim behavior
  changed, run live headless-Sim probes via a throwaway vitest file driving real
  ticks with an injected ADVANCEABLE clock (the clock must advance now(); a
  frozen clock hangs), then delete the file and verify the tree is clean.
- Verify the negative space of the Live-surface note: farming deeds, the
  golden_harvest event, well-fed dishes, and the feast remain unreachable.
- Verify the parity regen commit is isolated and mechanical: its diff touches
  goldens only, and the pre-regen red trace showed nothing beyond the entity-id
  counter shift.
- Edge cases: quest acceptance with a full inventory, out-of-range husk-conversion
  attempts refuse while paying a watch fee far from any farmer WORKS (a plant-time
  bag payment with no NPC range gate, D9), a second quest acceptance does not
  double-grant.

Agent 2, test coverage:
- Every claimed behavior has a decisive assertion that fails on regression; no
  constant-self-comparison pins (the payout guard must recompute
  floor(WORK_ORDER_PAYOUT_FRACTION times summed vendor sellValue) from the item
  rows and compare against the literal copperReward, never derive both sides from
  the same expression; recompute one row by hand to confirm).
- Both arms of every either/all claim: in-range and out-of-range gates, action
  credit and inventory non-credit on the quest objective, stocked and unstocked
  seed tiers, positive-buyValue presence on every row (an each-row assertion, not
  a some-row assertion).
- The R37 hub-stocking arms actually assert the flipped-on state (not a vacuous
  pass that would also pass dormant).
- Orphaned or superseded tests removed (especially any Phase 5 dormancy pins that
  asserted seeds were unstocked: they must be updated or deleted, not skipped).
- Mutation checks are allowed only after committing the work first.

Agent 3, dead code and cleanup:
- Unused imports, types, and exports across the diff; no unresolved TODOs; naming
  consistency (npc ids, quest id, item ids match the D11 and D20 locked ids).
- The sim import invariant: src/sim/ imports nothing from render, ui, game, or
  net; no Math.random, Date.now, or performance.now anywhere in the sim diff.
- No English player text in sim or server paths (id-carrying events and t() keys
  only); no leftover dormancy scaffolding (dead flags or commented-out gates from
  Phases 4, 5, and 8); no hand-edited goldens or generated files; the throwaway
  journey probe file is gone.

Then dispatch the Review Dispatch Matrix rows in
docs/farming/implementation-plan.md that match the phase diff (expected:
architecture-reviewer, cross-platform-sync, frontend-seam-reviewer;
privacy-security-review only if any server/ file moved), plus qa-checklist (the
phase-completion gate). Same 30-call budget, coverage instruction, and resume line
for each.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first: reproduce with a failing
test, then the smallest change that turns it green. Run the docs/farming/state.md
validation matrix rows the diff demands (content rows, quest suites, S3, wiki
freshness, parity). Land fixes as separate Conventional Commits with explicit
paths, never git add -A, no session links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 9 QA row and a Notes block) and
docs/farming/state.md (any drift found: ledger corrections, decision records).
If a fix amended the phase file, sweep this QA twin in the same pass.

STEP 5 - FINAL RESPONSE FORMAT
Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL. Counts: findings found and findings
fixed, by severity. Deferrals with reasons. A one-line handoff for the Phase 10
session.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope (in
  particular: if the journey breaks in a way only a Phase 10 to 12 surface could
  fix, that is a scope problem, not a fix).
- Stop if the phase diff cannot be identified cleanly.

Close: re-run node scripts/gate_select.mjs after fixes (the armory browser red is
the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker; PR CI is the
arbiter) and push the fix commits to the phase PR.
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
