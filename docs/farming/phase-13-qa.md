# Phase 13 QA: Verify Integration polish and the handoff

The final audit of the packet. It verifies the Phase 13 PR (wiki page, manifest,
screenshots, deferral sweep, audit evidence), re-runs the whole-feature rows any late
fix touched, and then, uniquely, offers the packet teardown to the user. Note:
docs/design/farming-asset-manifest.json is deliberately outside the packet and stays
after teardown; only docs/farming/ is ever offered for deletion.

### QA Starter Prompt

```
This is Phase 13 QA of the Farming feature: Verify Integration polish and the handoff.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 13 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria; then close the
packet with the teardown offer.

STEP 0 - PRE-FLIGHT
- Same worktree rules: work ONLY in ~/Documents/woc-farming-plan, use
  git -C ~/Documents/woc-farming-plan everywhere, git status clean or stop.
- git fetch origin --prune, then check out the Phase 13 PR branch
  (fix/farming-phase-13-integration-polish).
- Identify the phase diff: the PR's commits against its base. Use
  git diff --name-only origin/<base-release-branch>...HEAD (three dots: merge-base
  semantics). The release tip may have moved concurrently, so the diff is the PR's
  commits, never everything since phase start. If the diff cannot be identified cleanly,
  stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  mutation-checks-commit-first, pr-screenshot-browser-path, node25-breaks-jsdom-gate,
  one-probe-outranks-agreeing-agents, no-claude-session-links.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to summarize: docs/farming/state.md, the docs/farming/progress.md
Phase 13 notes (including the recorded qa-checklist evidence), the promises in
docs/farming/phase-13-integration-polish.md (acceptance list, invariants, any recorded
deviation), docs/farming/qa-checklist.md, and git diff --name-only over the phase diff.
The summary must return the acceptance checklist verbatim, the qa-checklist rows with
their recorded evidence, every deferral recorded anywhere in the packet (every
progress.md Notes block, the state.md ledgers and OPEN items), the diff file list
grouped by surface, and the state.md validation matrix rows the diff demands.

STEP 2 - QA AUDIT
Spawn three parallel audit agents, each with a hard 30-tool-call budget and the coverage
instruction ("report every issue including low-severity and uncertain ones; ranking
happens later"); resume any truncated agent with: "Stop reading more files. Output the
full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Correctness agent: every deliverable and acceptance criterion actually met; the wiki
  prose is accurate against the shipped mechanics and spoiler-safe; the manifest is
  complete (cross-check every exporter output in scripts/assets/build_farm_props.mjs
  and every adapter consumer against the manifest rows; verify footprints, pivots,
  tints, and stage lists match the authored values) and references no docs/farming/
  path; the screenshots exist under docs/screenshots and the PR body references them;
  each qa-checklist evidence row is actually supported by its evidence (re-run a
  sample, the anti-chore rows in particular). Verify the Live-surface note: LIVE,
  complete: no new mechanic shipped; the merge is the wiki page, the screenshots,
  the asset handoff manifest, and the recorded audit evidence only. A sim behavior
  change in this diff is
  itself a finding (Phase 13 ships no mechanics); if one exists anyway, probe it with
  the throwaway-vitest ADVANCEABLE-clock rig (the clock must advance now() or waits
  hang), then delete the rig and verify the tree is clean.
- Test-coverage agent: decisive assertions that fail on regression; no
  constant-self-comparison pins; both arms of every either/all claim; orphaned tests
  removed; the guide freshness gate really binds the new content; mutation checks only
  AFTER committing the work first.
- Dead-code-and-cleanup agent: unused imports and types; the sim import invariant; no
  unresolved TODOs; naming consistency; teardown safety: nothing OUTSIDE docs/farming/
  references a docs/farming/ path (such a reference would break when the packet is
  deleted).
Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that the phase diff matches, plus qa-checklist (the phase-completion gate), under the
same budget and format rules.

STEP 3 - FIX + WHOLE-FEATURE SWEEP
Apply every BLOCKING and SHOULD-FIX finding test-first (a failing test that exercises
the real path, then the smallest green change). Run the docs/farming/state.md
validation matrix rows the diff demands. Then the whole-feature sweep: re-run the
docs/farming/qa-checklist.md rows that any post-Phase-13 fix touched, and re-record
their evidence. Separate fix commits with explicit paths, never git add -A, no session
links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 13 QA row plus Notes) and
docs/farming/state.md (drift, final ledger state). Any deviation gets swept into
docs/farming/phase-13-integration-polish.md AND this QA twin in the same pass.

STEP 5 - PACKET TEARDOWN
Only after every prior step is green:
- FIRST surface every deferred follow-up recorded anywhere in the packet (every
  progress.md Notes block, the state.md ledgers and OPEN items, any phase-file
  deferral) so nothing tracked only in docs/farming/ is lost. Restate them in your
  final response and confirm each one lives in the PR body or a filed issue before any
  deletion.
- Then ask the user explicitly: "All phases are complete and green. OK to delete
  docs/farming/ (the planning scaffolding) before the PR?"
- On explicit confirmation, delete ONLY that directory with explicit paths:
  git rm -r docs/farming/ and a "docs: remove farming planning scaffolding" commit
  (with a body) if the docs were committed.
- If the user declines, leave the packet in place and say so in the final response.
- Never delete anything else, never fold the deletion into an unrelated commit, never
  git add -A.
- docs/design/farming-asset-manifest.json is deliberately outside the packet and
  stays, whatever the user decides.

STEP 6 - FINAL RESPONSE FORMAT
Verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed per
severity; deferrals, each with where it now lives (PR body or issue); whether the
packet was removed (yes on confirmation, no with the user's answer otherwise); and the
closing line: either a one-line handoff for remaining follow-ups or "packet complete".

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.
- Never proceed to STEP 5 while any audit finding stands unfixed or any qa-checklist
  row lacks evidence.
```
