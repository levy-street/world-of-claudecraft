# Phase 11 QA: Verify Well-fed food

Audits the Phase 11 PR: the wellfed ItemDef arm, the four tier dishes, aura naming, and
the tooltip and buff bar surface. The special hazards here are namespace leakage (a food
buff clobbering an elixir or the reverse), a stacking rule that holds in only one
direction, and a timing decision that was made but never pinned.

PHASE EXECUTED 2026-08-19 (read before auditing; state.md owns the letters): the timing
decision is (bx), completion of the sit-restore minted by src/sim/wellfed.ts at the
updateRegen slot-null site with a food-only kind guard; (by) one shared aura name 'Well
Fed', one kind buff_sta, one id wellfed_buff_sta (last-eaten-wins namespace-wide); (bz)
the tier-1 dish carries the pottage-precedent vale_wheat binder. Magnitudes proposed
3/600s 6/900s 9/900s 12/900s (capstone at the elixir ceiling; the 24-stamina stacking
read is a flagged OPEN item, not an oversight). (bw) was discharged IN the phase: the
golden-WIN and paying-band beats plus ONE isolated classified re-record (md5 83c34781
to 25bd6b87, draws 16 to 110); this QA moves NO golden. Review-round items already
taken: the single-Use:-prefix tooltip reword, the one-matcher buff name, the food
guard's synthetic-drink arm, the predicate-level party-frame fixture value. Deferrals
with owners: the wellfed parity beat rides Phase 12; the bespoke aura icon and the
glazed-carrots-vs-pottage 32px icon eyeball ride the Phase 13 art batch; hud.ts
headroom is ONE line (extraction-first for any new Hud line).

### QA Starter Prompt (the session form; refreshed by the Phase 11 close, 2026-08-19)

```
This is Phase 11 QA of the Farming feature: Verify Well-fed food. Model:
Opus 4.8 or newer, xhigh effort (1m context variant where the file load
demands it). Harness: Claude Code. DELIVERY per D22 (standing): LOCAL-ONLY.
No pushes, no PRs. QA fixes land as commits on fix/farming-phase-11-qa cut
off LOCAL feature/farming-plan, merge back --no-ff, and the branch is
deleted. The gate log is the arbiter. This QA moves NO golden (the (z)/(bw)
precedent): if a finding demands one, ledger it for Phase 12 instead.

Goal: audit Phase 11 for correctness, missing tests, dead code,
determinism, three-host parity, i18n completeness, and the phase's own
acceptance criteria, with FRESH EYES: the phase's own reviews were 0
BLOCKING and its mutations 9/9 killed, so your value is independent
re-verification plus the adversarial what-is-missing pass, never
re-derivation.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Prefix
  EVERY shell command with cd ~/Documents/woc-farming-plan && export
  PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH (the Bash cwd resets
  between calls; the inherited shell has Node 24 and no pnpm).
- git status must be clean, on feature/farming-plan at or after 6777f1a8a4
  (the Phase 11 merge-hash record; the phase merged --no-ff as 9fc11d5452
  on 2026-08-19, phase tip e6746bfe79). Stop if it is not.
- [AMENDED per D22, the Phase 1 QA precedent: no PR exists and the phase
  branch is DELETED. Audit the merge 9fc11d5452's phase-side parent chain:
  the diff is git diff f0d329db02..e6746bfe79 (f0d329db02 is the
  twenty-first-absorb merge, which carries its own CLEAN audit and is
  EXCLUDED). Commit map: 51eee11203 shared shape (the wellfed member, four
  dish defs, ITEM_ART_PENDING + icon recipes + art re-pins), 5119d8a306
  sim mint, 73eb63c4bd recipes + content pins, a8c5b2bfc2 ui/i18n + regen,
  5ff5bc5d41 guide regen, 2d91b69d16 the isolated (bw) re-record,
  2abab8484a review fixes, 719a1be861 + e6746bfe79 docs. Read this file's
  PR wording through that lens.]
- Branch fix/farming-phase-11-qa off LOCAL feature/farming-plan.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V, take the last row.
  The branch has absorbed release/v0.40.0 through e56707a675 (the
  twenty-first absorb, 2026-08-19). If a newer tip exists, absorb per D22
  FIRST (release-merge-audit plus the state.md deviation (al) checklist; a
  minor-version jump or triple-digit intersection runs the 06b shape as
  its OWN mid-phase; classify any farming_session movement before
  re-minting, expecting the (am) shape on static world content).
- BASELINES as of the Phase 11 merge (VERIFY by RUNNING the suites, never
  trust this prompt over them): farming_session golden md5
  25bd6b8774f913279c96dddb25f93403 at 110 draws / 1577 ticks (this QA
  moves it ZERO times); deeds 280 / 3190 renown / 43 titles; IWorld 329 =
  88 + 241, facets 34, commands 202/215, delta keys 87; FARM_RECIPES 13,
  NEVER_STOCKED 20; ITEM_ART_PENDING 43 (the audit CLI's pendingArtCount
  literal) with the v039 pending-hotbar literal 16; harvest draws tier 1/2
  EXACTLY 1 and tier 3/4 EXACTLY 2, plant 2, denies 0 (untouched this
  phase). MONOLITH: hud.ts 19219/19220 (ONE line of headroom: any new Hud
  line is extraction-first, and pin-check candidates FIRST: the S3
  localize* matchers, reliquary_window.test.ts's regex slice, the
  farm_verb_reachability containment rows, the gather_event_i18n glue
  pins); renderer.ts 13774/13774 EXACT ZERO (touch NOT AT ALL: the three
  evidence-seal re-mints); sim.ts and main.ts near-zero.
- READ the PHASE EXECUTED block at the head of this file; then
  docs/farming/state.md deviations (bx)/(by)/(bz) and the amended (bw)
  entry, plus the OPEN tuning row (the capstone-at-ceiling and 24-stamina
  stacking read is FLAGGED for the maintainer, not an oversight: verify
  the flags exist, never re-tune); then docs/farming/progress.md's Phase
  11 section whole (the acceptance checklist with states, maintainer
  flags, the mutation and gate records, deferrals with owners).
- Scan Claude Code memory: MEMORY.md; farming-skill-program (the PHASE 11
  paragraph is the freshest record: the crops-cannot-wither-at-75
  discovery, the (bw) probe and padding shape, the reverted vendor-fed
  exemption); golden-files-store-digests +
  parity-omit-defaults-zero-fields (goldens by hash and field-diff only);
  vite-dev-module-singletons-probe (the live-client probe recipe);
  sim-api-green-hides-missing-player-verb (eating rides the EXISTING bag
  use verb: play as a PLAYER, no window.__game for the verb itself);
  mutation-checks-commit-first + mutation-verdicts-need-exit-code-plus-
  names + mutation-edits-need-landing-proof (the dirty-refusing runner; rc
  AND names AND summary; landing proof by counts);
  one-probe-outranks-agreeing-agents; frozen-clock-rig-hangs-vitest (an
  injected clock must advance now() or waits hang); vacuous-bound-pin-trap
  + joint-coverage-masks-deleted-sites; heavy-self-dirty-test-vacuity +
  heavy-self-arm-first-boundary-mail (if you add any online heavy-self
  arm); fanout-agent-delivery-traps + big-diff-reviewer-turn-budgets
  (report-via-SendMessage-to-main line FIRST, hard budgets, budget one
  nudge round); worktree-cwd-drift-misroutes-git;
  pkill-pattern-matches-own-shell (kill dev servers by port);
  lockfile-moves-asset-seals; screenshots-on-low-graphics.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thorough; hard 45-tool-call budget; report-first)
to summarize: docs/farming/state.md (the (bx)/(by)/(bz)/(bw) entries and
the OPEN list), the docs/farming/progress.md Phase 11 section, the
promises in docs/farming/phase-11-well-fed-food.md (STEP 5 acceptance,
invariants, the executed sweep), and git diff --name-only
f0d329db02..e6746bfe79 grouped by surface. The summary must return the
acceptance checklist verbatim with its recorded states, the timing
decision as recorded, every recorded deviation, the deferral list with
owners, and the state.md validation matrix rows the diff demands.

STEP 2 - QA AUDIT
Spawn three parallel audit agents (plain free-text audit lanes may ride a
Workflow), each with a hard 30-tool-call budget, the coverage instruction
("report every issue including low-severity and uncertain ones; ranking
happens later"), and the resume line ("Stop reading more files. Output the
full report now based on what you have already seen. No more tool calls.
Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT").
- Correctness agent: every deliverable and acceptance criterion actually
  met; the offline Sim and online ClientWorld paths behave identically;
  edge cases (eating a second dish of the same kind, eating during an
  active elixir, interrupting the sit-restore under completion timing,
  eating at full HP, dying between consume and completion). Where sim
  behavior changed, run live headless-Sim probes via a throwaway vitest
  file driving real ticks, then delete it and verify the tree is clean.
  Verify the Live-surface note (LIVE, additive; every existing elixir
  behavior untouched). Phase 11 emphases, ALL mandatory:
  (1) the coexistence probe LIVE: one player with elixir_buff_sta and
  wellfed_buff_sta active simultaneously through real ticks, both visible
  through the auras-view chain with correct remaining times;
  (2) last-eaten-wins LIVE: eat dish A then dish B; exactly B's aura
  stands in the wellfed namespace, the elixir untouched;
  (3) PLAYED AS A PLAYER: on the live client (the
  vite-dev-module-singletons-probe recipe, LOW preset), obtain a dish, EAT
  IT through the real bag UI, sit through the 18s, and see 'Well Fed' on
  the buff bar with remaining time plus the single-Use:-prefix tooltip on
  hover (window.__game is fine for staging position or grants, never for
  the eat verb);
  (4) the same-name silent downgrade ONLINE: complete a tier-4 dish then a
  tier-1 dish and confirm the buff surface reflects the new value (the
  aura value ships conditionally on the wire; the phase DECLINED a pin
  here with a stated reason in its review record, so re-verify it live).
- Test-coverage agent: decisive assertions that fail on regression; no
  constant-self-comparison pins; both arms of every either/all claim
  (isolation proven in BOTH directions; stacking denied AND replacement
  allowed; the (bw) beats: re-run the coverage_c arms and audit their
  in-arm non-vacuity guards); orphaned tests removed; spot-check the nine
  recorded mutant claims by RE-RUNNING two of them through the
  dirty-refusing runner (committed tree, no reviewer reading); fresh
  mutants only for NEW gaps you find.
- Dead-code-and-cleanup agent: unused imports and types; the sim import
  invariant (src/sim/ imports nothing from render, ui, game, or net, no
  DOM or Three); no unresolved TODOs; naming consistency (wellfed_<kind>
  ids, dish item ids, aura name keys); no residue of the reverted
  vendor-fed exemption (no VENDOR_FED_FARM_ROWS or FULLY_PRICED_DISHES
  anywhere).
Then dispatch the Review Dispatch Matrix rows in
docs/farming/implementation-plan.md that the phase diff matches, plus
qa-checklist LAST (the phase-completion gate). Custom-agentType reviewers
ride the Agent tool with the report-via-SendMessage-to-main line FIRST
and the same budget, coverage, and resume rules; budget one nudge round
for idle-without-report.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX test-first (a failing test on the real
path, then the smallest green change), or ledger it with a reason and an
owner. Run the state.md validation matrix rows the diff demands. Separate
fix commits with explicit paths, never git add -A, no session links or
Claude attribution. Mutation batteries only AFTER committing, through a
scratchpad runner that refuses a dirty target, only while no reviewer
reads the tree; every verdict needs rc nonzero AND named failing tests
AND the summary line; a survivor is a rig defect, dead code, or a real
gap: diagnose before adding a test.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 11 QA record) and
docs/farming/state.md (drift, ledger corrections). Any deviation gets
swept into docs/farming/phase-11-well-fed-food.md AND this QA twin in the
same pass. Screenshots: the buff bar and tooltip are visual surfaces; if
you capture them, ride the pr-screenshots skill on the LOW preset
(standing rule), committed under docs/screenshots (a NEW subtree must
join ci.yml's sparse-checkout cone rows AND the ci_workflow test literal,
and the PNGs must be git add -f TRACKED before the referenced-set scan
counts them).

STEP 5
No teardown step in this phase; packet teardown belongs to Phase 13 QA
only.

STEP 6 - FINAL RESPONSE FORMAT
Verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and
fixed per severity; deferrals with reasons; one line handing off to Phase
12 (docs/farming/phase-12-shared-feast.md; the wellfed parity-scenario
beat rides its feast scenario by the recorded deferral).

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase
  scope.
- Stop if the phase diff cannot be identified cleanly.
- This QA moves NO golden and raises NO monolith ceiling; if tests/parity
  reds, classify and surface, never regen.
- Stop while any review BLOCKING stands.

Close: gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
chrome-linux64/chrome GATE_MAX_WORKERS=8 node scripts/gate_select.mjs on
the frozen committed tree (NEVER edit while a gate runs); judge ONLY the
log markers ("[gate:select] FAIL at" / "[gate] FAIL" / "[gate:select]
PASS: all N steps green"; the exit code has lied). EXPECT the full-suite
fallback (about 15 minutes of vitest at 8 workers) and budget the
druid_engines 20 s contention timeout as the recorded environmental flake
(prove it standalone if it fires, do not chase it). Per D22: no push, no
PR; merge --no-ff into LOCAL feature/farming-plan, delete the branch and
any agent worktrees, record the merge hash in progress.md and the
farming-skill-program memory topic, and hand off to Phase 12.
```
