# Phase 12 QA: Verify The shared feast

Audits the Phase 12 PR: the placeable feast entity, its charges and per-player ledger,
the interaction arm, the wire carriage, and the render and audio surface. The special
hazards here are client-trusted outcomes (a charge or ledger decision leaking to the
client), ledger state that quietly serializes, and a once-per-player rule that forgets a
player who left and rejoined.

### QA Starter Prompt

```
This is Phase 12 QA of the Farming feature: Verify The shared feast.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 12 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- [AMENDED per D22, the Phase 1 QA precedent: no PR exists. The phase lands
  as local commits merged --no-ff into feature/farming-plan (progress.md
  records the merge hash and commit map); audit that merge's phase-side
  parent chain, EXCLUDING any release-sync absorb commits, which carry their
  own audit. QA fix commits land on a fix/farming-phase-12-qa branch off
  feature/farming-plan, merged back --no-ff. Read this file's PR wording
  below through that lens.]
- Same worktree rules: work ONLY in ~/Documents/woc-farming-plan, use
  git -C ~/Documents/woc-farming-plan everywhere, git status clean or stop.
- git fetch origin --prune, then check out the Phase 12 PR branch
  (fix/farming-phase-12-shared-feast).
- Identify the phase diff: the PR's commits against its base. Use
  git diff --name-only origin/<base-release-branch>...HEAD (three dots: merge-base
  semantics). The release tip may have moved concurrently, so the diff is the PR's
  commits, never everything since phase start. If the diff cannot be identified cleanly,
  stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  frozen-clock-rig-hangs-vitest, mutation-checks-commit-first,
  joint-coverage-masks-deleted-sites, early-exit-pins-need-work-remaining,
  one-probe-outranks-agreeing-agents.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to summarize: docs/farming/state.md, the docs/farming/progress.md
Phase 12 notes (including the recorded anti-abuse rule and the proposed charge count and
expiry), the promises in docs/farming/phase-12-shared-feast.md (acceptance list,
invariants, any recorded deviation), and git diff --name-only over the phase diff. The
summary must return the acceptance checklist verbatim, the anti-abuse rule as recorded,
every recorded deviation, the diff file list grouped by surface, and the state.md
validation matrix rows the diff demands.

STEP 2 - QA AUDIT
Spawn three parallel audit agents, each with a hard 30-tool-call budget and the coverage
instruction ("report every issue including low-severity and uncertain ones; ranking
happens later"); resume any truncated agent with: "Stop reading more files. Output the
full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Correctness agent: every deliverable and acceptance criterion actually met; the
  offline Sim and the online ClientWorld paths behave identically; edge cases (consume
  on the last charge, consume exactly at expiry, place under the anti-abuse rule's
  boundary). Where sim behavior changed, run live headless-Sim probes via a throwaway
  vitest file driving real ticks with an injected ADVANCEABLE clock (the clock must
  advance now() or waits hang), then delete the file and verify the tree is clean.
  Verify the despawn and expiry check rides INSIDE the already-anchored
  updateFarming driver (the state.md tick anchor), not a second appended sweep.
  Verify the Live-surface note: LIVE: a player can cook the feast, place it in the
  world, and every nearby player can eat from it once for the tier-4 well-fed buff
  the moment this merges, nothing dormant.
  Phase 12 emphases, all three mandatory: run a three-session probe (the placer places
  and eats; a guest eats once and is denied a second helping; a latecomer arriving
  after charges empty is denied); verify the once-per-player ledger survives the guest
  leaving and rejoining within the feast's life (the rejoined guest is still denied);
  confirm nothing serializes (no feast field in any CharacterState write, save blob, or
  database path; grep the serialize and normalize paths, then prove it with a
  save-then-load probe that shows the feast absent after reload).
- Test-coverage agent: decisive assertions that fail on regression; no
  constant-self-comparison pins; both arms of every either/all claim (every deny arm
  has a matching allow case, and each deny fires at its own site, not just where a
  second equivalent effect also fires); orphaned tests removed; mutation checks only
  AFTER committing the work first.
- Dead-code-and-cleanup agent: unused imports and types; the sim import invariant
  (src/sim/ imports nothing from render, ui, game, or net, and has no DOM or Three
  imports); no unresolved TODOs; naming consistency (FeastState fields, the deny event
  ids, the cue key, the prop name).
Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that the phase diff matches (privacy-security-review is expected here: the diff touches
the server interaction surface), plus qa-checklist (the phase-completion gate), under
the same budget and format rules.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first (a failing test that exercises
the real path, then the smallest green change). Run the docs/farming/state.md validation
matrix rows the diff demands. Separate fix commits with explicit paths, never
git add -A, no session links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 12 QA row plus Notes) and
docs/farming/state.md (drift, ledger corrections). Any deviation gets swept into
docs/farming/phase-12-shared-feast.md AND this QA twin in the same pass.

STEP 5
No teardown step in this phase; packet teardown belongs to Phase 13 QA only.

STEP 6 - FINAL RESPONSE FORMAT
Verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed per
severity; deferrals with reasons; one line handing off to Phase 13.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.
```
