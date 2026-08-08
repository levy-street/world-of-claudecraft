# Phase 2 QA: Verify Patches and plot state

This session audits Phase 2 after it lands (AMENDED per D22, 2026-08-08: there is
NO PR; audit the merge commit into feature/farming-plan): the patch content and its
placement guard, the persistence shape and its anti-tamper load path, the read-only
facet, and above all the wire boundary (the public projection must provably never
carry the hidden outcome slots or the yield seed). Fixes ride a local
fix/farming-phase-02-qa branch merged --no-ff, the Phase 1 QA precedent. The design
authority is `docs/farming/state.md` (Phase 2 deviations lettered (h) to (m) there);
the promises under audit are `docs/farming/phase-02-patches-and-plots.md`.

### QA Starter Prompt

```
This is Phase 2 QA of the Farming feature: Verify "Patches and plot state".
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 2 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; git status must
  be clean; use git -C with the absolute path on every git command.
- AMENDED per D22: no PR exists. git fetch origin --prune, then check out the LOCAL
  feature/farming-plan and locate the Phase 2 merge commit (git log --merges
  --grep "phase 2" -i). The phase diff is the merge's second-parent range:
  git diff --name-only <merge>^1..<merge>. The phase-start absorb is 743a1ee6ad
  (release tip e5c16ca398), so phase work is 743a1ee6ad..<merge>^2.
- If a NEWER origin/release/** tip exists than the branch has absorbed, merge it in
  FIRST (regen-resolve the generated i18n bundles) and run the release-merge-audit
  skill; then RE-RUN tests/world_api_parity.test.ts and tests/snapshots.test.ts
  (identical count-pin bumps on both sides auto-merge to a wrong total with no
  textual conflict).
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  round-trip-pins-reference-aliasing, wire-name-constant-pins-need-literals,
  vacuous-bound-pin-trap, mutation-checks-commit-first,
  big-diff-reviewer-turn-budgets, node25-breaks-jsdom-gate.

STEP 1 - LOAD CONTEXT
Spawn ONE Explore agent to read and summarize: docs/farming/state.md (locked
decisions, especially D2, D3, D23, and the seam reference), the Phase 2 notes in
docs/farming/progress.md, the promises in docs/farming/phase-02-patches-and-plots.md
(deliverables, acceptance criteria, live-surface note, the documented position and
bed-count choices), and the git diff --name-only file list over the phase diff. The
summary must return: the acceptance checklist verbatim, the PlotState public
projection versus hidden fields split as implemented, the fplot registration sites,
and every promise the diff appears NOT to touch.

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Every agent gets a hard 30-tool-call budget,
report-first instructions, and the coverage instruction "report every issue including
low-severity and uncertain ones; ranking happens later". If one truncates or stalls,
resume it with exactly: "Stop reading more files. Output the full report now based on
what you have already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."

Agent 1, correctness:
- Verify every deliverable and every acceptance criterion in
  docs/farming/phase-02-patches-and-plots.md is actually met, against the real code.
- Phase 2 emphasis, the negative wire-leak pin check: beyond confirming the pin
  exists, probe the real boundary. Fill the hidden outcome slots and the yield seed
  in a fixture plot, serialize the fplot payload through the real server emit path,
  and assert the payload lacks both while carrying the D3 public fields, the
  notified flag and the derived status among them; confirm status (growing, ready,
  withered) is derived server-side from the plot's times, never the raw pre-roll.
  The pin must fail if a hidden field is ever added to the projection.
- Phase 2 emphasis, the load-tamper probe: construct a save blob with a bogus bed id
  and a deadline past the clamp bound, load it through the real normalize path, and
  assert it loads clean: the bogus bed dropped, the deadline clamped, no throw. Use a
  throwaway vitest file if needed, then delete it and verify the tree is clean.
- The offline Sim and online ClientWorld paths behave identically: farmPatches and
  myFarmPlots return the same shapes from both IWorld implementations.
- Edge cases: the empty default (no plots), the boundary (a deadline exactly at the
  clamp), and the deny arms of the normalize path (unknown crop id, unknown bed id,
  a save with no farming field at all).
- Where sim behavior changed, run live headless-Sim probes via a throwaway vitest
  file driving real ticks with an injected ADVANCEABLE clock, then delete it and
  verify the tree is clean.
- Verify the live-surface note: nothing player-reachable (no command, no item, no
  render, no UI references the new modules).

Agent 2, test coverage:
- Every claimed behavior has a DECISIVE assertion that fails on regression; no
  constant-self-comparison pins: the round-trip test must build its expectation
  literal fresh (round-trip-pins-reference-aliasing), the fplot wire name must be
  pinned as a LITERAL string, not through the shared constant, and the round-trip
  pins must name the notified flag and the derived status among the public fields.
- Both arms of every either/all claim: the placement suite must fail on a bad
  position (probe one arm by temporarily breaking a fixture, not the content), the
  normalize path needs both the accept arm and every drop/clamp arm, the parity
  sampler claim needs the empty-Map-to-empty-array pin.
- A determinism pin is present: zero new rng call sites this phase (confirm nothing
  in the diff calls ctx.rng), and parity either untouched or moved only mechanically.
- Orphaned tests removed; no vacuous bounds (a clamp test that never reaches the
  clamp is constant-true; the tamper arm must actually cross the bound).
- Mutation checks ONLY after committing the current work state first
  (mutation-checks-commit-first); require a nonzero exit code AND named failing tests
  before claiming a kill.

Agent 3, dead code and cleanup:
- Unused imports and types across the diff; the sim import invariant (no
  DOM/Three/render/ui/game/net imports in src/sim/); no unresolved TODOs (the hidden
  outcome slots are declared-for-Phase-3 by design, which is a documented forward
  reference, not a TODO); naming consistency (bed ids, fplot, FarmPatchDef,
  FARMING_ZONE_TIERS); no leftover throwaway files.

Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that match the phase diff (expected: cross-platform-sync, architecture-reviewer,
migration-safety), plus qa-checklist as the phase-completion gate. Same budget,
coverage, and truncation-resume rules.

STEP 3 - FIX
- Apply ALL BLOCKING and SHOULD-FIX findings test-first: reproduce with a failing
  test, then the smallest change to green.
- Run the state.md validation matrix rows the diff demands (at minimum: npx tsc
  --noEmit, the two Phase 2 suites, the snapshots suites, tests/world_api_parity.test.ts,
  tests/architecture.test.ts, tests/parity, npm run ci:changed).
- Separate fix commits with explicit paths, Conventional Commits with bodies, never
  git add -A, no session links or Claude attribution.
- After fixes: node scripts/gate_select.mjs (the armory browser red is the standing
  environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker), then, per D22, merge the
  local QA fix branch --no-ff into feature/farming-plan; never push, never open a PR.

STEP 4 - DOC UPDATES
- docs/farming/progress.md: fill the Phase 2 QA row (status, dates) and append QA
  findings to the Phase 2 Notes block.
- docs/farming/state.md: record any drift discovered (ledger corrections, the actual
  suite names, deviations). If the phase file was amended, sweep this QA twin in the
  same pass.

STEP 5 - FINAL RESPONSE FORMAT
Report exactly: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and
issues fixed, by severity; deferrals with reasons; and a one-line handoff (merge
readiness and what Phase 3 should know, especially the final PlotState shape).

STOPPING RULES
- STOP and surface if a BLOCKING cannot be fixed without changing phase scope (in
  particular, any finding that the projection leaks a hidden field by design).
- STOP if the phase diff cannot be identified cleanly (no PR, an ambiguous base, or
  foreign commits interleaved).
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
