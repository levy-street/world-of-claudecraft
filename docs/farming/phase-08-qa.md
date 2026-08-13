# Phase 8 QA: Verify The Harvest Journal and ready notices

Independent verification of Phase 8 in a fresh session. The emphasis is honesty and
restraint: the countdown must be correct under a skewed client clock, the login notice
must fire exactly once for a ready crop on a fresh session, the online sweep must emit
exactly once per plot transition with zero banner spam, and no graphics tier knob may
shed the journal or the notices (they are actionable information, the fairness doctrine's
hard case).

### QA Starter Prompt

```
This is Phase 8 QA of the Farming feature: Verify The Harvest Journal and ready
notices.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 8 for correctness, missing tests, dead code, determinism,
three-host parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- [AMENDED per D22, the Phase 1 QA precedent: no PR exists. The phase lands
  as local commits merged --no-ff into feature/farming-plan (progress.md
  records the merge hash and commit map); audit that merge's phase-side
  parent chain, EXCLUDING any release-sync absorb commits, which carry their
  own audit. QA fix commits land on a fix/farming-phase-08-qa branch off
  feature/farming-plan, merged back --no-ff. Read this file's PR wording
  below through that lens.]
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; git status must
  be clean. Check out the phase branch fix/farming-phase-08-harvest-journal (QA fix
  commits land on the phase PR).
- Identify the phase diff: the PR's commits against its base (git merge-base the PR
  branch with the release branch it was opened against, then diff that range). The
  release tip may have moved concurrently, so the diff is the PR's commits, never
  everything-since-phase-start. Stop if the diff cannot be identified cleanly.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry,
  pr-screenshot-browser-path (browser path, swiftshader flags, overlay traps),
  pr2177-side-rail-split-review, frozen-clock-rig-hangs-vitest,
  mutation-checks-commit-first, big-diff-reviewer-turn-budgets.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md; the
docs/farming/progress.md Phase 8 notes (including any recorded deviation and the
open-surface decision); the promises in docs/farming/phase-08-harvest-journal.md
(Live-surface note, deliverables, acceptance criteria); and git diff --name-only
over the phase diff. The summary must return the acceptance list verbatim, the file
list, the farmReady SimEvent name and payload shape, whether the fplot projection
was widened, and any deviation the phase recorded.

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Each gets a hard 30-tool-call budget and the
coverage instruction: "report every issue including low-severity and uncertain ones;
ranking happens later." If truncated, resume with: "Stop reading more files. Output
the full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

Agent 1, correctness:
- Verify every deliverable and every acceptance criterion in the phase file is
  actually met, not just claimed.
- Verify the offline Sim and online ClientWorld paths behave identically: the
  journal reads the same members from both worlds, and the countdown derivation
  works from both the local Sim and the mirrored fplot projection.
- The skewed-clock check: skew the client clock deliberately (mock Date.now in the
  client harness or apply a fixed offset) and verify the rendered remaining time
  stays correct (server-anchored), never shifted by the skew.
- The login notice: rig a saved state with a ready, unnotified plot, run
  Sim.addPlayer on a fresh session, and assert exactly one farmReady with the right
  counts; assert zero on a second login (the persisted notified flag holds).
- The save-shape check: the per-plot notified flag was landed by Phase 2, so this
  phase should move no persisted shape; verify the save shape did not move. If it
  did (a widened fplot projection or any persisted-shape move), verify
  migration-safety was dispatched per its matrix row and the round-trip pins were
  extended in the same change.
- The once-per-transition guarantee: run live headless-Sim probes via a throwaway
  vitest file driving real ticks with an injected ADVANCEABLE clock (the clock must
  advance now(); a frozen clock hangs) across a ready boundary; assert one emit per
  plot transition and no banner spam across subsequent ticks; then delete the file
  and verify the tree is clean.
- The fairness check: audit every consumer of the graphics tier and preset knobs
  touched by or adjacent to this diff and confirm no tier knob sheds, hides,
  delays, or coarsens the journal, its countdowns, the pins, the banner, or the
  chat line.
- Drive the real dev client headless (the browser path and swiftshader flags from
  the pr-screenshot-browser-path memory entry), dismissing any first-run prompt
  overlays before clicking: open the journal via its shipped entry point, verify
  the empty states, verify a dev-created crop shows a live ticking countdown, and
  verify the pins on map and minimap.
- Edge cases: zero plots, all plots ready at once (counts aggregate), a plot
  becoming ready while the journal is open (the rebind updates), relog mid-growth.

Agent 2, test coverage:
- Every claimed behavior has a decisive assertion that fails on regression; no
  constant-self-comparison pins (a remaining-time test must pin expected literals,
  not recompute through the same helper it tests; wire pins compare against
  committed literals).
- Both arms of every either/all claim: notified and unnotified, ready and growing,
  empty and populated journal, skewed and unskewed clock, rail button present or
  professions entry (whichever was chosen, its guard has both a pass and a fail
  arm).
- The once-per-transition test actually crosses the boundary during the test (not
  a vacuous pin that never reaches ready).
- Orphaned or superseded tests removed; the UI_PURE_CORES registration is real.
- Mutation checks are allowed only after committing the work first.

Agent 3, dead code and cleanup:
- Unused imports, types, and exports across the diff; no unresolved TODOs; naming
  consistency with the farming modules landed earlier.
- The sim import invariant: src/sim/ imports nothing from render, ui, game, or
  net; no Date.now, Math.random, or performance.now anywhere in src/sim/ additions
  (Date.now is permitted in client UI code only).
- No hand-built colon time strings; every player-visible string in the diff is a
  t() key; no leftover throwaway probe files or scratch scripts.

Then dispatch the Review Dispatch Matrix rows in
docs/farming/implementation-plan.md that match the phase diff (expected:
frontend-seam-reviewer, cross-platform-sync, architecture-reviewer; migration-safety
if the persisted shape moved), plus qa-checklist (the phase-completion gate). Same
30-call budget, coverage instruction, and resume line for each.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first: reproduce with a failing
test, then the smallest change that turns it green. Run the docs/farming/state.md
validation matrix rows the diff demands (including the snapshots suites if the wire
widened). Land fixes as separate Conventional Commits with explicit paths, never
git add -A, no session links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 8 QA row and a Notes block) and
docs/farming/state.md (any drift found: ledger corrections, decision records).
If a fix amended the phase file, sweep this QA twin in the same pass.

STEP 5 - FINAL RESPONSE FORMAT
Verdict: PASS / PASS-WITH-FOLLOWUPS / FAIL. Counts: findings found and findings
fixed, by severity. Deferrals with reasons. A one-line handoff for the Phase 9
session.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.

Close: re-run node scripts/gate_select.mjs after fixes (the armory browser red is
the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker; PR CI is the
arbiter) and push the fix commits to the phase PR.
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
