# Phase 12 QA: Verify The shared feast

Audits the Phase 12 merge: the placeable feast entity, its charges and per-player ledger,
the interaction arm, the wire carriage, and the render and audio surface. The special
hazards here are client-trusted outcomes (a charge or ledger decision leaking to the
client), ledger state that quietly serializes, and a once-per-player rule that forgets a
player who left and rejoined.

[EXECUTED-RULINGS BLOCK, Phase 12 close, 2026-08-19: the phase merged --no-ff into
feature/farming-plan as 71010cf82a (phase tip 1b33789ba4, merge-hash record 9e39810e93),
gate run 2 PASS all 12 steps by the log markers. The starter prompt below is REFRESHED
to the session form with the executed facts; the original prompt's assumptions are
superseded where they conflict.]

### QA Starter Prompt (the session form; refreshed at the Phase 12 close, 2026-08-19)

```
This is Phase 12 QA of the Farming feature: Verify The shared feast.
Model: Opus 4.8 or newer, xhigh effort (1m context variant where the
file load demands it). Harness: Claude Code. DELIVERY per D22
(standing): LOCAL-ONLY. No pushes, no PRs. QA fixes land as commits on
fix/farming-phase-12-qa cut off LOCAL feature/farming-plan, merge back
--no-ff, and the branch is deleted. The gate log is the arbiter.

Goal: audit Phase 12 for correctness, missing tests, dead code,
determinism, three-host parity, i18n completeness, and the phase's own
acceptance criteria AS AMENDED by deviation (ca).

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan.
  Prefix EVERY shell command with cd ~/Documents/woc-farming-plan &&
  export PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH (the Bash cwd
  resets between calls; the inherited shell has Node 24 and no pnpm).
- git status must be clean, on feature/farming-plan at or after
  9e39810e93 (the Phase 12 merge-hash record; the phase merged --no-ff
  as 71010cf82a on 2026-08-19). Stop if it is not.
- NO PR EXISTS (D22, the Phase 1 QA precedent): audit merge
  71010cf82a's phase-side parent chain. The commit map: shared shape
  0252b97200; (ca) docs 0277f82a8a; lanes 965a01ffed (sim core +
  suite), 8ebfe9c9d4 + 2e819acc5b + d6312696c9 (client paths + online
  routing + heavy-self honesty), a11820b4dd + 186f3f22c3 (tooltip and
  words + recipe and pins), 075656bc55 + cec6634035 + 30c94ff010 +
  a1e7e14b70 (prop + render/labels + hud extraction + cue chain);
  9f929b0966 (UI_PURE_CORES registration); 28dee4b8f7 (beat P, the ONE
  classified golden move); f05fa76348 (screenshots + cone rows + docs);
  e1ad98852f (the five-review fix round); a5f04c75d7 (the qa-checklist
  round: the swim place-gate + the art-debt ledger row); 32ec9bc442
  (the lootable re-arm fix, see the trap below); e0b4759323 +
  1b33789ba4 + 9e39810e93 (records); 679fc4622d (the five
  fallback-only census heals from gate run 1). No release-sync absorb
  ran this phase.
- Branch fix/farming-phase-12-qa off LOCAL feature/farming-plan.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune,
  then git branch -r --list 'origin/release/*' | sort -V, take the last
  row. The branch has absorbed release/v0.40.0 through e56707a675 (the
  twenty-first absorb; the Phase 12 round found none newer). If a newer
  tip exists, absorb per D22 FIRST (release-merge-audit plus the
  state.md (al) checklist; a minor-version jump or triple-digit
  intersection runs the 06b shape as its OWN mid-phase; classify any
  farming_session movement before re-minting, expecting the (am) shape
  on static world content).
- BASELINES as of the Phase 12 merge (VERIFY by RUNNING the suites,
  never trust this prompt over them): farming_session golden md5
  9dfd1c6ea073f853655e38675460e81f at 110 draws / 2439 ticks / 144
  frames (beat P appended; frames 0-93 byte-identical to the Phase 11
  golden, drawDigest unchanged); IWorld 331 = 88 + 243, facets 34,
  commands 204/217, delta keys 87; FARM_RECIPES 14, NEVER_STOCKED 21,
  ITEM_ART_PENDING 44 (audit-CLI pendingArtCount 44), v039
  pending-hotbar literal 16 (unchanged: kind junk is not
  hotbar-eligible); deeds 280/3190/43 (unchanged). MONOLITHS AT
  EXACT-ZERO HEADROOM: hud.ts 19214/19214 (the entityDisplayName
  extraction lowered the ceiling), sim.ts 12660/12660, renderer.ts
  13774/13774 (any renderer.ts edit stales the three evidence-seal
  families); main.ts 11454/11460, online.ts 5920/5950, server/game.ts
  10793/10900. ANY QA fix needing a line in an exact-zero file is
  extraction-first from the outset, pin-checking candidates FIRST.
- THE EXECUTED RULINGS AND DECISIONS this QA verifies against (state.md
  (ca) + the progress.md Phase 12 block are the authority):
  (1) Deviation (ca): the recipe ships REAGENT-DORMANT-HONEST; the
  amended Live-surface wording in this file's correctness lane binds. A
  loop that needs window.__game for any VERB is a defect; a recipe
  uncookable from live faucets is NOT (it is the recorded (ca) state,
  the third row owed to the D11/(bo) ruling).
  (2) The anti-abuse rule: ONE ACTIVE FEAST PER PLACER (farmDenied
  'feast_active').
  (3) The bite is a CONSUME SLOT pointed at the CAPSTONE DISH
  (ItemDef.feast.dishItemId = evergarden_braised_greens): the Well Fed
  mint stays the one Phase 11 updateRegen completion site; the charge
  spends at bite START; interruption forfeits the buff, never refunds
  the serving.
  (4) THE LOOTABLE RE-ARM TRAP (fix 32ec9bc442, found by the phase's
  played-proof probe): sim.ts's entity loop treats EVERY lootable-false
  kind-object entity as a cooling pickup (respawnTimer -= DT, re-arm at
  zero); the feast spawns with a respawnTimer longer than its own life
  so the sweep can never re-arm it and hand the interact press to the
  generic object arm. tests/professions_feast.test.ts pins
  lootable-false for life. Verify the class ONLINE too (the mirrored
  entity's funnel behavior over a real wire).
  QA AMENDMENT (2026-08-19, this round): the finite spawn timer
  (durationTicks + 20 ticks) was silently coupled to the 1 Hz sweep
  period across two files, with a probe-measured worst-case margin of
  exactly ONE tick (expiry phased one tick past a boundary: despawn at
  expiry + 19, re-arm one tick later). Replaced with respawnTimer =
  Infinity, the precedented never-re-arm sentinel (run-scoped mobs,
  dismissed pets); the 181s expiry arm now rides the whole life at the
  worst-case phase asserting lootable false on every tick. The QA also
  found and fixed the INSTANCE-TEARDOWN LEAK in BOTH legs: a feast
  placed inside a dungeon instance now joins the claimed instance's
  objectIds (freeInstance drops it), and a feast placed inside a delve
  run joins the placer's run.objectIds (freeDelveRun and the module
  advance drop it); the sweep's inverse-cleanup leg reclaims the state
  and the one-active slot either way; placement inside instances and
  delves stays LEGAL (the raid-table flavor). All in the state.md
  Phase 12 QA block.
  (5) The swim PLACE gate exists (a water placement would burn the item
  on a feast nobody can ever eat); COMBAT placement is deliberately
  LEGAL (combat ends; water does not), stated in the module header.
  (6) place_feast is HEAVY_SELF belt-and-braces over wireRev: dropping
  the membership stays green by design; the pin claims the observable
  contract (the one deliberate documented mutation survivor).
  (7) The sweep's entities.has leg is the inverse cleanup (an
  externally dropped entity can never strand the state or the
  one-active slot); executed by a synthetic-drop arm in the suite.
  (8) Gate run 1's five fallback-only census reds were healed as
  deliberate re-pins in 679fc4622d (bag_filter All-only 27,
  CRAFTED_JUNK_EXCEPTIONS gained harvest_feast with its own
  never-signable proof resting on the masterwork arm alone since rare
  sits ABOVE the signing floor, material_taxonomy oddments 7,
  farm-patch preload 16, and a declared 60s budget on the 180s expiry
  arm). Audit them as re-pins, not regressions.
  (9) dead/busy answer via ctx.error family sentences per (bq);
  feast_range has its own leaf ('range' names a crop bed); 'locked'
  reused for the lock-caused shortfall.
- Scan Claude Code memory: MEMORY.md; farming-skill-program (the PHASE
  12 paragraph is the freshest: the lootable re-arm trap, the probe
  traps below, the lane i18n same-key collision, the census heals);
  one-probe-outranks-agreeing-agents; sim-api-green-hides-missing-
  player-verb; mutation-checks-commit-first +
  mutation-verdicts-need-exit-code-plus-names +
  mutation-edits-need-landing-proof (the dirty-refusing runner);
  heavy-self-dirty-test-vacuity + heavy-self-arm-first-boundary-mail;
  event-forced-read-races-the-state-frame; frozen-clock-rig-hangs-
  vitest; joint-coverage-masks-deleted-sites;
  early-exit-pins-need-work-remaining; golden-files-store-digests +
  parity-omit-defaults-zero-fields (lootable/respawnTimer are NOT
  sampled leaves: the re-arm fix moved no golden);
  fanout-agent-delivery-traps + big-diff-reviewer-turn-budgets;
  screenshots-on-low-graphics; pkill-pattern-matches-own-shell (kill
  dev servers by port); worktree-cwd-drift-misroutes-git;
  no-claude-session-links.
- LIVE-PROBE TRAPS from the phase's own played proof (reuse them, do
  not rediscover): a stray Escape with NO window open opens the game
  menu and silently kills every later game key (diagnose with an early
  control press that must toast nothing-to-interact); mailboxes steal
  the funnel press past INTERACT_RANGE (objectInteractionRange
  overrides) and NPCs outrank the feast arm, so probes need an
  interactable-free stand point (scan entities AND remember gather
  nodes and beds are CONTENT, not entities); the desktop verbs are KeyB
  plus a genuine bag-row LEFT-click to place and a genuine KeyF to eat;
  seed the LOW preset and the two overlay keys pre-boot and dismiss
  overlays plus blur before every press (the journey-script idiom in
  scripts/farming_journey_e2e.mjs); grants and read-only verification
  through window.__game are sanctioned staging, the VERBS are not.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (thorough; hard 45-tool-call budget;
report-first; budget one nudge round) to summarize: docs/farming/
state.md (the (ca) entry and the Phase 12 ledgers), the progress.md
Phase 12 block (decisions, tuning flags, residuals, review verdicts,
the played proof, the gate record), docs/farming/phase-12-shared-feast
.md (the amended Live-surface note and STEP 5 acceptance list), and
git diff --name-only 71010cf82a^1...71010cf82a (three dots: merge-base
semantics, the phase-side chain off phase start 36750eec66).
The summary must return the acceptance checklist verbatim with its
recorded check states, every deviation and decision above, the diff
file list grouped by surface, the suite inventory (professions_feast 28
arms, feast_online, feast_interact, feast_tooltip_view,
entity_labels_feast, entity_display_name, the reachability describes,
the census re-pin sites), and the state.md validation matrix rows the
diff demands.

STEP 2 - QA AUDIT
Spawn three parallel audit agents, each with a hard 30-tool-call budget
and the coverage instruction ("report every issue including
low-severity and uncertain ones; ranking happens later"); resume any
truncated agent with: "Stop reading more files. Output the full report
now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Correctness agent: every deliverable and acceptance criterion met AS
  AMENDED by (ca); offline Sim and online ClientWorld identical for
  both verbs; edge cases (the last charge, consume exactly at expiry,
  the anti-abuse boundary, the bite racing the 1 Hz sweep). Where sim
  behavior changed, run live headless-Sim probes via a throwaway vitest
  file driving real ticks (delete it after; the 180s arm needs a
  declared budget, the 20s default kills it under contention). Verify
  the despawn check rides INSIDE updateFarming (the tick anchor), never
  a second sweep. Phase 12 emphases, all four mandatory: (a) a
  THREE-SESSION online probe: the placer places and eats; a guest eats
  once and is denied a second helping; a latecomer arriving after
  charges empty is denied; (b) the once-per-player ledger SURVIVES the
  guest leaving and rejoining within the feast's life (the characterId
  key is the claim; the rejoined guest is still denied over the real
  wire); (c) nothing serializes (no feast field in any CharacterState
  write, save blob, or database path; grep the serialize and normalize
  paths, then prove it with a save-then-load probe showing the feast
  absent after reload); (d) the LOOTABLE RE-ARM class online: the
  mirrored feast entity must never become the generic object arm's
  target on either host (ride 2+ seconds of real ticks, then the real
  funnel resolution).
- Test-coverage agent: decisive assertions that fail on regression; no
  constant-self-comparison pins; both arms of every either/all claim
  (every deny arm has a matching allow case, each deny fires at its own
  site); the census re-pins in 679fc4622d are honest re-pins with
  updated comments, not blind healings; the beat-P golden's
  classification claims hold (re-derive: frames 0-93 byte-identical to
  the prior golden, draws 110, drawDigest unchanged); orphaned tests
  removed; mutation checks only AFTER committing, through a scratchpad
  runner that refuses a dirty target, only while no reviewer reads the
  tree; every verdict needs rc nonzero AND named failing tests AND the
  summary line.
- Dead-code-and-cleanup agent: unused imports and types; the sim import
  invariant; no unresolved TODOs; naming consistency (FeastState
  fields, the deny reason ids, the cue key, the prop and templateId
  constants: the three presentation sites import
  FARM_FEAST_TEMPLATE_ID, never the literal).
Then dispatch the Review Dispatch Matrix rows in
docs/farming/implementation-plan.md that the phase diff matches
(privacy-security-review is expected: the diff touches the server
interaction surface), plus qa-checklist LAST, under the same budget,
report-via-SendMessage-to-main-first, and format rules. The Phase 12
build round already ran architecture, cross-platform, privacy-security,
frontend-seam, content-obligations, and qa-checklist to zero standing
BLOCKING; this round audits the MERGED result and the fixes those
reviews forced, so reviewers get the verdict summary from progress.md
as context and hunt what the build round could have structurally
missed.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first (a failing test
that exercises the real path, then the smallest green change). Run the
docs/farming/state.md validation matrix rows the diff demands. Separate
fix commits with explicit paths, never git add -A, no session links or
Claude attribution. No commit while a review BLOCKING stands.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 12 QA row plus Notes) and
docs/farming/state.md (drift, ledger corrections, residuals with
owners). Any deviation decided in-QA gets swept into
docs/farming/phase-12-shared-feast.md AND this file in the same pass.
Record genuine surprises in the farming-skill-program memory topic.
MAINTAINER READS CARRIED (verify they are still ledgered, do not
re-decide them): the sim.ts comment-compression funding (Phase 13 must
open with a sim.ts extraction), the tuning constants (charges 10 /
180s / fee 10000 / sellValue 250 / reagent counts), and the (ca) third
dormant row joining the D11/(bo) ruling.

STEP 5
No teardown step in this phase; packet teardown belongs to Phase 13 QA
only.

STEP 6 - FINAL RESPONSE FORMAT
Verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and
fixed per severity; the four emphases each with its proof; deferrals
with reasons; one line handing off to Phase 13
(docs/farming/phase-13-integration-polish.md).

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase
  scope.
- Stop if the phase diff cannot be identified cleanly.
- Stop if git status is dirty at STEP 0 or the newest release branch
  cannot be resolved.

Close: gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
chrome-linux64/chrome GATE_MAX_WORKERS=8 node scripts/gate_select.mjs
on the frozen committed tree (NEVER edit while a gate runs); judge ONLY
the log markers ("[gate:select] FAIL at" / "[gate] FAIL" /
"[gate:select] PASS: all N steps green"; the exit code has lied).
EXPECT the full-suite fallback (about 15 minutes of vitest at 8
workers) and budget the druid_engines 20 s contention timeout as the
recorded environmental flake (prove it standalone if it fires, do not
chase it). Per D22: no push, no PR; merge --no-ff into LOCAL
feature/farming-plan, delete the branch and any agent worktrees, record
the merge hash in progress.md and the farming-skill-program memory
topic, and hand off to Phase 13
(docs/farming/phase-13-integration-polish.md).
```
