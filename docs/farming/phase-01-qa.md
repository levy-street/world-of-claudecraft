# Phase 1 QA: Verify Foundation: the fifth gathering profession

This session audits the Phase 1 PR after it is open: registration completeness, the
silent-miss sweep (real farming copy, never fallthrough), pin quality, i18n
completeness, the isolated golden regen, and the binding live-surface note (a farming
row at 0 with no way to gain skill). Fixes ride the same PR branch as separate
commits. The design authority is `docs/farming/state.md`; the promises under audit are
`docs/farming/phase-01-foundation.md`.

AMENDED 2026-08-08 (Phase 1 executed under D22, local-only): there is NO PR. Audit
the merge commit of fix/farming-phase-01-foundation into feature/farming-plan
instead: BASE=$(git merge-base origin/release/v0.36.0 feature/farming-plan) with the
phase-start commit recorded in progress.md; ignore this file's gh pr instructions.
Audit against the executed deviations recorded in phase-01-foundation.md's
"EXECUTED WITH DEVIATIONS" block, progress.md Phase 1 Notes, and state.md "Locked
deviations": expect a PENDING_ART_IDS allowlist in tests/profession_icons.test.ts
(verify its inverted assertions and the E3 companion), expect NO parity golden
commit (verify tests/parity is green and the regen is byte-identical rather than
demanding an isolated golden commit), expect six commits not five, and expect the
Master Gatherer roster prose reword (deeds.ts desc, 18 dropped locale desc fills,
three reworded gatherDeeds bodies with 15 non-Latin fills) inside this phase.

QA EXECUTED 2026-08-08, verdict PASS-WITH-FOLLOWUPS: the second release absorb
(merge a9959c3670) landed first with the release-merge-audit clean and parity
re-proven byte-identical; the 8-agent audit found 0 BLOCKING; five findings were
fixed on fix/farming-phase-01-qa (merged --no-ff, branch deleted) and six
mutation checks all killed. Deferrals and the deviation-lettering harmonization
are recorded in progress.md's Phase 1 QA notes and state.md's ledgers.

### QA Starter Prompt

```
This is Phase 1 QA of the Farming feature: Verify "Foundation: the fifth gathering
profession".
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 1 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan; git status must
  be clean; use git -C with the absolute path on every git command.
- git fetch origin --prune, then check out the phase PR branch
  fix/farming-phase-01-foundation.
- Identify the phase diff: the PR's commits against its base, NEVER
  everything-since-phase-start (the release tip may have moved concurrently).
  Preferred: gh pr diff <PR-number> --name-only and gh pr view <PR-number> --json
  baseRefName,commits. Fallback: BASE=$(git merge-base origin/<base-release-branch>
  HEAD); git log --oneline $BASE..HEAD; git diff --name-only $BASE..HEAD.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  mutation-checks-commit-first, one-probe-outranks-agreeing-agents,
  mutation-verdicts-need-exit-code-plus-names, big-diff-reviewer-turn-budgets,
  node25-breaks-jsdom-gate.

STEP 1 - LOAD CONTEXT
Spawn ONE Explore agent to read and summarize: docs/farming/state.md (locked
decisions, the blast-radius reference, the validation matrix), the Phase 1 notes in
docs/farming/progress.md, the promises in docs/farming/phase-01-foundation.md (its
deliverables, acceptance criteria, and live-surface note), and the git diff
--name-only file list over the phase diff. The summary must return: the acceptance
checklist verbatim, the silent-miss site list from state.md, the per-commit file
grouping of the PR, and every promise the diff appears NOT to touch.

STEP 2 - QA AUDIT
Spawn three parallel audit agents. Every agent gets a hard 30-tool-call budget,
report-first instructions, and the coverage instruction "report every issue including
low-severity and uncertain ones; ranking happens later". If one truncates or stalls,
resume it with exactly: "Stop reading more files. Output the full report now based on
what you have already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT."

Agent 1, correctness:
- Verify every deliverable and every acceptance criterion in
  docs/farming/phase-01-foundation.md is actually met, against the real code, not the
  PR description.
- Phase 1 emphasis: every silent-miss arm renders REAL farming copy, not fallthrough.
  For the farming id, gatherDeniedLineKey must return a farming-specific key (not the
  corpse key) and gatherToolNoNodeKey a farming-specific key (not the mining key), and
  src/ui/i18n.catalog/hud_chrome.ts must resolve the display name and all four
  families (toolTierUnmet, toolRequired, wieldUnmet, noNodeNearby). Confirm the pins
  would fail on fallthrough.
- Phase 1 emphasis: the golden regen commit contains ONLY goldens. Run git show
  --name-only on that commit and confirm every path is under tests/parity/golden/.
- Verify the live-surface note: the farming row renders 0 (data-driven sites), the
  wiki page exists, and NO code path grants farming skill (search for any gain
  schedule or grant call keyed to farming; there must be none).
- The offline Sim and online ClientWorld paths behave identically for the new
  proficiency field (the gprof mirror and the snapshots round-trip literal).
- Edge cases: empty, boundary, and deny arms of every touched helper.
- Where sim behavior changed (registration only, expected to be behavior-neutral):
  run live headless-Sim probes via a throwaway vitest file driving real ticks with an
  injected ADVANCEABLE clock, then delete the file and verify the tree is clean.

Agent 2, test coverage:
- Every claimed behavior has a DECISIVE assertion that fails on regression; no
  constant-self-comparison pins (a pin comparing against the same exported constant
  production uses proves nothing; literals only).
- Both arms of every either/all claim (the fallthrough pins need the negative arm:
  farming returns its own key AND the old professions still return theirs).
- A determinism pin is present where behavior could drift (the parity fingerprint
  claim: confirm the phase verified the fingerprint before regen, per the progress.md
  Notes and the commit ordering).
- Orphaned tests removed; every re-pinned literal moved deliberately, not loosened.
- Mutation checks ONLY after committing the current work state first
  (mutation-checks-commit-first); require a nonzero exit code AND named failing tests
  before claiming a kill.

Agent 3, dead code and cleanup:
- Unused imports and types across the diff; the sim import invariant
  (tests/architecture.test.ts scope: no DOM/Three/render/ui/game/net imports in
  src/sim/); no unresolved TODOs; naming consistency (gather_farming, farming, the
  key family naming pattern hud_chrome.ts already uses); no leftover throwaway files.

Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that match the phase diff (expected: cross-platform-sync, architecture-reviewer,
frontend-seam-reviewer), plus qa-checklist as the phase-completion gate. Same budget,
coverage, and truncation-resume rules.

STEP 3 - FIX
- Apply ALL BLOCKING and SHOULD-FIX findings test-first: reproduce with a failing
  test, then the smallest change to green.
- Run the state.md validation matrix rows the diff demands (at minimum: npx tsc
  --noEmit, the Phase 1 suites, tests/localization_fixes.test.ts, tests/parity,
  npm run ci:changed).
- Separate fix commits with explicit paths, Conventional Commits with bodies, never
  git add -A, no session links or Claude attribution.
- After fixes: node scripts/gate_select.mjs (the armory browser red is the standing
  environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker; PR CI is the arbiter), then
  push the fix commits to the phase PR branch.

STEP 4 - DOC UPDATES
- docs/farming/progress.md: fill the Phase 1 QA row (status, dates) and append QA
  findings to the Phase 1 Notes block.
- docs/farming/state.md: record any drift discovered (ledger corrections, deviations).
  If the phase file was amended, sweep this QA twin in the same pass.

STEP 5 - FINAL RESPONSE FORMAT
Report exactly: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and
issues fixed, by severity; deferrals with reasons; and a one-line handoff (merge
readiness and what Phase 2 should know).

STOPPING RULES
- STOP and surface if a BLOCKING cannot be fixed without changing phase scope.
- STOP if the phase diff cannot be identified cleanly (no PR, an ambiguous base, or
  foreign commits interleaved).
Packet teardown never happens in this phase; it belongs to Phase 13 QA only.
```
