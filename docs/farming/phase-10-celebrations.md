# Phase 10: Celebrations

Farming has been live since Phase 9. This phase adds the lottery moment and the permanent
records: the golden_harvest rare event per D12 and the farming deeds and title per D13.
Everything here is celebration: zero power, one new roll at harvest, append-only records.
docs/farming/state.md is the authority; if this file contradicts it, state.md wins and this
file plus phase-10-qa.md get swept in the same pass.

Live-surface note (binding; AMENDED at the phase close, 2026-08-19): LIVE, additive. The
rare event and the deeds join the already-open farming loop the moment this merges: any
harvesting player can roll golden_harvest, and every farming deed EXCEPT
prog_farming_100 becomes earnable immediately (all four zone chronicles included, per
the (br) probe: plantCrop has no bed-tier gate, so vendor tier 1/2 seeds reach every
hub's beds). prog_farming_100 and its Harvestmaster title ship DORMANT until the D11
seed-faucet ruling (the (bs) recorded waiver in docs/design/deeds.md;
feat_book_complete is transitively parked for the window). No reachability change to
anything that already shipped.

EXECUTED (2026-08-19): the phase closed as five commits on
fix/farming-phase-10-celebrations merged --no-ff into feature/farming-plan (the merge
hash and full notes in progress.md; deviations (br) through (bv) in state.md). What
shipped matches the goal with these deviations from this file's letter: the chronicles
are ALL EARNABLE (the (bo) unearnability premise was probed false, (br)); the
stranded-heal doctrine does NOT fire for prog_farming_100 (globally-not-yet-earnable
is not per-character-stranded; the (bs) waiver + self-clearing honesty arm carry it);
the golden roll sits AFTER the seed-back roll (both outcomes, win applied on the
survived branch only; harvest draws are now 1 for tier 1/2 and 2 for tier 3/4);
prog_farming_100's crest shipped COMMITTED because the Reliquary title shelf forbids
fallback art for title deeds (bt); Harvestmaster joined RELIQUARY_HORIZON_TITLES
(catalog pins 341/376/41). The farming_session golden moved once, isolated
(11 to 16 draws, md5 83c3478142deabbffbf23912575873e9).

V0.39.0 SYNC NOTE (2026-08-17, the seventeenth absorb, recorded during Phase 9): the
release's castles feature re-pinned tests/deeds_content.test.ts to 273 deeds / 3155
total renown / 11 exploration titles (two new walk-in castle visit deeds,
exp_the_last_keep and exp_dawnhold_castle at renown 5 each) and re-baselined its frozen
catalog sha; this phase re-pins FROM those totals, not the ones the phase file was
authored against, and the two castle deeds sit in DEED_ART_PENDING (src/ui/icons.ts),
the release's own procedural-fallback ledger beside ITEM_ART_PENDING.

PHASE 9 QA NOTE (retired 2026-08-19): Phase 9b ran BEFORE this phase and closed
state.md (bn): the client bed verbs shipped and the plant-grow-harvest loop is
walkable by an ordinary player, so this phase's celebrations sit on a
player-reachable loop. STILL OPEN from that QA: (bo), the tier 3/4 seed
faucet (state.md OPEN list); nothing this phase celebrates may assume
Highwatch or Evergarden beds are sowable until D11's bootstrap ruling lands.

### Starter Prompt (the session form; refreshed by the Phase 9b QA close, 2026-08-19)

```
This is Phase 10 of the Farming feature: Celebrations (the golden_harvest rare
event, the farming deeds, and the farming-100 title). Model: Opus 4.8 or newer,
xhigh effort (1m context variant where the file load demands it). Harness:
Claude Code. DELIVERY per D22 (standing): LOCAL-ONLY. No pushes, no PRs. The
phase lands as commits on fix/farming-phase-10-celebrations cut off LOCAL
feature/farming-plan, merges back --no-ff, and deletes its branch. The gate log
is the arbiter.

Goal: farming gets its lottery moment and its permanent records: golden_harvest
rolled at harvest as a fourth flavor on the existing gatherRareEvent union
(1 in 90, five-fold yield, signed produce, zone-announced through the one
announceGatherRareEvent path), the D13 deeds (first planting, a first-harvest
chronicle per farming zone, a golden-harvest deed, prog_farming_100 with the
farming title; append-only, cosmetic, ZERO rng), and the golden sting cue.
Everything is celebration: no power, no new SimEvent type, one new roll.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Other
  sessions share the main checkout; never work there. Prefix EVERY shell command
  with cd ~/Documents/woc-farming-plan && export PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH
  (the Bash cwd resets between calls; the inherited shell has Node 24 and no pnpm).
- git -C ~/Documents/woc-farming-plan status must be clean, on feature/farming-plan
  at or after 881052cab0 (the Phase 9b QA merge-hash record; the QA merged
  --no-ff as 710c031064 on 2026-08-19; verify HEAD descends from it). Stop if
  it is not.
- Branch fix/farming-phase-10-celebrations off LOCAL feature/farming-plan (D22:
  never off a bare release tip, which lacks the packet).
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V, take the last row. The
  branch has absorbed release/v0.39.0 through ea9377db8e (the TWENTIETH absorb,
  2026-08-19, inside the Phase 9b QA). If a newer tip exists, merge it INTO the
  phase branch FIRST: release-merge-audit skill plus the state.md deviation (al)
  absorb checklist (portrait manifest fingerprint-only re-mint via
  scripts/build_mob_portrait_source_manifest.mjs --write plus the accepted-art
  registry row; scripts/item_art_audit.mjs --verify-only; the ART-SUBJECT rule
  for any release seal over a live inventory pending-art items can join), re-run
  tests/world_api_parity.test.ts, tests/snapshots.test.ts,
  tests/command_schema.test.ts, tests/monolith_budget.test.ts, and tests/parity,
  and classify any farming_session golden movement before re-minting (expect the
  (am) shape on any absorb adding static world content). A minor-version jump or
  a triple-digit intersection runs the phase-06b-release-sync shape as its OWN
  mid-phase first. ABSORB TRAPS proven live: a pnpm-lock.yaml move fires the
  farm-props seal family; a patches/ move needs pnpm install; a both-sides
  Eastbrook seal conflict resolves ONLY by remint_polish_provenance.mjs on the
  merged tree; `git checkout --theirs <conflicted pin suite>` DISCARDS
  non-conflicting arms; release monolith ceilings can land BELOW your working
  count (heal by extraction, never a raise); the npc-looks roster demands an
  AUTHORED look for every NpcDef; the shard-weight floor heals by re-harvesting
  from a green FULL-MODE upstream run.
- Baselines as of the Phase 9b QA merge: IWorld 329 members (88 data, 241
  method), facet count 34, command_schema 202/215, delta keys 87,
  farming_session golden md5 9a8fefa5e48c7e456db7ef2695bfb284. This phase moves
  the farming_session golden EXACTLY ONCE, deliberately (the harvest draw-count
  change), in an ISOLATED UPDATE_PARITY=1 commit; every other golden stays
  byte-identical. Deeds totals re-pin FROM the live suite (273 deeds / 3155
  renown as of the seventeenth absorb; VERIFY by running
  tests/deeds_content.test.ts, never trust this file's numbers over the suite).
  MONOLITH: hud.ts 19352/19352 (EXACT, ZERO headroom: the Phase 9b QA's (bq)
  error-forward spent the last line), renderer.ts 13774/13774 (exact, zero),
  main.ts 11454/11460, sim.ts 12657/12660, server/game.ts 10791/10900. Agent
  B's HUD-case work CANNOT add a net line to hud.ts as it stands: an extraction
  lands FIRST as its own commit (move a self-contained block behind the file's
  seam, then LOWER the ceiling; pin-check candidates first: the S3 guard
  source-scans hud.ts for the three localize* matchers,
  reliquary_window.test.ts regex-slices handleReliquaryUnlocks, and
  tests/farm_verb_reachability.test.ts containment-slices openPlantSheet, the
  farmReady/error event cases, the plant-sheet close case, and the panel
  keydown guard list: none of those blocks may move). A ceiling raise is a
  maintainer decision: stop before one. Touch renderer.ts NOT AT ALL (the
  three evidence-seal re-mints).
- Record the phase-start commit (git rev-parse HEAD).
- Scan Claude Code memory: MEMORY.md; farming-skill-program (the PHASE 9B and
  PHASE 9B QA paragraphs are the freshest record: the (bq) re-arm, the hud.ts
  zero-headroom warning, the source-pin slicing idiom, the delivery recipes);
  golden-files-store-digests + parity-omit-defaults-zero-fields (the golden
  re-record discipline); deeds-stranded-heal-pr2077 (join-time heals for
  unearnable deeds: load it before designing the chronicle earnability);
  profession-icon-art-backed-pin (DEED_ART_PENDING is the same self-clearing
  pattern); npcs-are-terrain-calm-pads (touch NO NPC seat);
  i18n-semantic-regressions-gate-trap (new keys English-only + M16 fills for
  wordy values; never reword an existing translated key);
  fanout-agent-delivery-traps (Workflow for plain implementer/audit lanes;
  custom-agentType reviewers on the Agent tool with the
  report-via-SendMessage-to-main line FIRST and a 25-call budget; check the
  journal for LEN 0; a background Explore loader can idle: nudge once, then
  load it yourself); mutation-checks-commit-first (the dirty-refusing runner);
  mutation-verdicts-need-exit-code-plus-names; one-probe-outranks-agreeing-
  agents; worktree-cwd-drift-misroutes-git; pkill-pattern-matches-own-shell
  (kill dev servers by port: fuser -k 5188/tcp); lockfile-moves-asset-seals;
  big-diff-reviewer-turn-budgets.
- READ docs/farming/state.md's head block, D12 / D13 / D17 / D22, deviation
  (bq) (the error-toast re-arm: the Hud's error case now forwards to the plant
  sheet; do not disturb that case), (bo) READ ONLY AND BINDING: tier 3/4 seeds
  have NO faucet until D11 rules, so the Highwatch and Evergarden first-harvest
  chronicle deeds are UNEARNABLE at ship time; the earnability table (the
  ZONE_FISH template) plus the join-time stranded-heal doctrine must carry
  them honestly, and nothing this phase ships may assume those beds are
  sowable; the OPEN list; docs/design/deeds.md;
  docs/farming/phase-10-celebrations.md whole (this file: the sync note above
  re-pins deeds FROM the castle totals); progress.md's Phase 9b and 9b QA
  notes (hud.ts headroom history, the gate recipe).

STEP 1 - LOAD CONTEXT
Spawn ONE very-thorough Explore agent (plain-text return; if it idles, one
nudge, then load it yourself): src/sim/professions/farming.ts (the harvest
action-time draw block, the draw-count contract and its pin), the module
exporting the gatherRareEvent flavor union + announceGatherRareEvent (locate by
symbol; how instance space is excluded), src/sim/content/deeds.ts (the catalog,
the ZONE_FISH earnability template, the visit-mark idiom, the prog_ naming, the
title shape), src/ui/hud.ts's single gatherRareEvent case (the epic color, the
finder-only achievement cue) READ BY THE AGENT ONLY, src/game/audio.ts
(UI_CUES, the facade), scripts/sfx/sfx_prompts.mjs and the manifest chain, the
deeds i18n module under src/ui/i18n.catalog/, src/ui/icons.ts DEED_ART_PENDING,
tests/deeds_content.test.ts (exactly which totals pin),
tests/professions_farming.test.ts, tests/game_audio.test.ts, the
farming_session scenario under tests/parity and the UPDATE_PARITY=1 recipe, and
the CLAUDE.md files (root, src/sim, src/sim/professions if present, src/ui).
The summary must return: the flavor union file and shape, the
announceGatherRareEvent signature and fanout, the draw block and count
contract, the HUD case shape and its hud.ts line placement (to size the
extraction Agent B needs), the full SFX cue recipe (UI_CUES key, facade, hud
case, prompt row, npm run sfx:ui with
--ffmpeg node_modules/ffmpeg-static/ffmpeg on this box, sfx:manifest,
sfx:check, the completeness guard; the gate's manifest-freshness step diffs
the SFX manifest, runtime pack, and gain-ceiling cache against a fresh regen:
commit all three together), the deeds catalog totals and earnability
machinery, the deed i18n coverage arms, and any hud.ts block that could
extract to fund Agent B's lines.

STEP 2 - BUILD
Three implementer agents by vertical slice via Workflow (the shapes that
delivered: Workflow implementer lanes have gone first-try in every recorded
session). If two slices must touch one file, the orchestrator lands the shared
shape first as its own commit (the Phase 9 recipe), or gives each agent its
own git worktree off the phase branch; generated artifacts (i18n regen, SFX
manifest, the golden) are ORCHESTRATOR-only re-mints after the slices merge.
- Agent A, the rare event (sim): golden_harvest as a FOURTH flavor on the
  existing gatherRareEvent union (no new SimEvent type); rolled at harvest
  inside the action-time draw block via the shared rare-event chance constant
  (1 in 90 per D12); five-fold yield; signed produce; zone-announced through
  announceGatherRareEvent so the HUD case stays single. Agent A owns ALL edits
  to src/sim/professions/farming.ts, including the farm:<zone> visit-mark
  producer Agent C's chronicles consume (coordinate mark ids through the
  orchestrator). Restate and re-pin the draw-count contract (harvest gains the
  rare-event draw; plant unchanged at 2; denial still zero; the pre-roll
  expansion stays position-independent of skill-varying loops, the Phase 4
  monotonicity rule). Tests: roll only at harvest, the multiplier, the
  signature, the announcement, the contract, a same-seed determinism pin, and
  an armed-vs-unarmed non-vacuity guard on any new expansion (the Phase 4 QA
  vacuity class: prove the armed expectation DIFFERS before pinning it).
- Agent B, the HUD line and the cue (ui + game): the localized golden_harvest
  line in the epic color inside the ONE gatherRareEvent case; the finder-only
  achievement cue on the existing path; the NEW golden sting cue end to end
  (UI_CUES key, facade method, hud case, prompt row, placeholder clip via
  npm run sfx:ui --ffmpeg node_modules/ffmpeg-static/ffmpeg, then
  sfx:manifest + sfx:check, all committed together); English t() rows in the
  matching src/ui/i18n.catalog/ module (M16 fills for wordy values). hud.ts is
  at ZERO headroom: if the case needs ANY net line, extract first (own commit,
  lower the ceiling, respect the pinned blocks listed in STEP 0). Tests: the
  game_audio completeness arm; a decisive line/color/cue arm.
- Agent C, the deeds (content + i18n): per D13 and docs/design/deeds.md, all
  append-only, cosmetic, zero rng: first planting; a first-harvest chronicle
  per farming zone on farm:<zone> marks with the ZONE_FISH earnability
  template, where the HIGHWATCH and EVERGARDEN chronicles ship
  earnability-honest under (bo) (no faucet reaches their beds until D11; the
  join-time stranded-heal doctrine applies; state the handling in the notes);
  a golden-harvest deed; prog_farming_100 with the farming title (D17
  IP-safe). Re-pin the tests/deeds_content.test.ts totals deliberately in the
  same change (verify the live numbers first). New deed ids join
  DEED_ART_PENDING (the self-clearing procedural-fallback ledger) unless art
  ships. Deed English i18n rows + the coverage arms that count deeds; the
  release-tier fill note goes in the progress notes.
After the slices merge, YOU re-record farming_session: npx vitest run
tests/parity first to see exactly what moved, classify it (the draw-count
change and nothing else), then UPDATE_PARITY=1 in an ISOLATED commit, re-run
green, and confirm no golden outside the farming scenario moved.

INVARIANTS THIS PHASE MUST KEEP
- Every deed draws zero rng; all deeds append-only and cosmetic (never power).
- All sim randomness through ctx.rng; the new roll only inside the harvest
  action-time draw block, never at expiry, login, or tick.
- The golden move is deliberate, classified, isolated, and singular.
- The gatherRareEvent HUD case stays single (all four flavors, one case, one
  announce path).
- No English in any sim or server path: sim emits stay text-free and
  id-carrying (the S3 guard binds); every player string is a t() key.
- Every new cue key has a clip, a manifest row, and a green sfx:check, with
  the manifest family committed together (the gate regen-diffs it).
- (bo) binds: nothing ships that assumes Highwatch or Evergarden beds are
  sowable; the chronicles carry their unearnability honestly.
- No em dashes, en dashes, or emojis anywhere; D17 IP-safe names.

Out of scope: buff food (Phase 11), the shared feast (Phase 12), wiki prose
and the asset manifest (Phase 13), tuning the rare-event constant or yields
beyond D12, any new SimEvent type, any seed faucet or D11 decision, any
power on any deed.

STEP 3 - VALIDATION + REVIEW
Run and record: npx tsc --noEmit; npx vitest run tests/deeds_content.test.ts
tests/professions_farming.test.ts tests/architecture.test.ts
tests/localization_fixes.test.ts tests/game_audio.test.ts
tests/i18n_completeness.test.ts (the Phase 4 lesson: item/deed names red here
on missing non-Latin fills); npx vitest run tests/parity (green after the
isolated re-record, nothing else moved); npm run ci:changed. Reviews:
architecture-reviewer (src/sim moved: mandatory), content-obligations-reviewer
(deeds are content: mandatory), cross-platform-sync, frontend-seam-reviewer,
then qa-checklist LAST. Dispatch custom-agentType reviewers on the Agent tool
with the report-via-SendMessage-to-main line FIRST, a hard 25-tool-call
budget, the coverage instruction ("report every issue including low-severity
and uncertain ones; ranking happens later"), and the resume line ("Stop
reading more files. Output the full report now. Format: BLOCKING / SHOULD-FIX
/ NICE-TO-HAVE / VERDICT"); plain audit lanes may ride a Workflow. Take every
BLOCKING and SHOULD-FIX or ledger it with a reason. Then mutation checks
(after committing, through a scratchpad runner that refuses a dirty target):
at least eight fresh mutants, including the roll moved off the harvest block,
the chance constant unshared, the yield multiplier dropped, the sign dropped,
a deed gaining rng or power, the earnability table widened to the unearnable
chronicles, the cue key unwired, and the HUD case forked. Every verdict needs
rc nonzero AND named failing tests AND the summary line; a survivor is a rig
defect, dead code, or a real gap: diagnose before adding a test.

STEP 4 - COMMITS
2 to 6 Conventional Commits, each with a scope and a BODY, explicit paths
only, never git add -A, no session links or Claude attribution: the sim roll,
the HUD/cue chain (extraction commit first if hud.ts needs a line), the
deeds + i18n, the isolated parity re-record, docs.

STEP 5 - ACCEPTANCE
- [ ] golden_harvest is a fourth flavor on the existing union; no new
      SimEvent; the HUD case remains single.
- [ ] The roll happens at harvest via the shared constant; five-fold yield;
      signed; zone-announced.
- [ ] The draw-count contract restated and re-pinned; the same-seed
      determinism arm and the armed-vs-unarmed non-vacuity guard hold.
- [ ] farming_session re-recorded once, isolated, classified; nothing else
      moved.
- [ ] The D13 deeds landed, totals re-pinned from live numbers, the (bo)
      chronicles earnability-honest, ids in DEED_ART_PENDING, i18n rows +
      coverage arms green.
- [ ] The golden sting cue complete end to end with the manifest family
      committed together.
- [ ] hud.ts and renderer.ts did not grow (extraction first, ceilings
      lowered or held).
- [ ] tsc, the STEP 3 rows, ci:changed, and gate_select green; mutations all
      killed or diagnosed-and-fixed.

STEP 6 - DOCS
progress.md (a Phase 10 row + notes: the would-be PR body, review verdicts,
the mutation record, the gate record, the merge hash), state.md (head block;
new deviation letters continue at (br); ledger the flavor, keys, deeds, cue),
this file's EXECUTED block, and docs/farming/phase-10-qa.md swept in the same
pass. Record genuine surprises in Claude Code memory.

STEP 7 - FINAL RESPONSE
The phase report: what shipped, any extraction commits and new ceilings,
validation results, review verdicts, the mutation record, deviations and
deferrals with reasons, the gate record, the merge hash, and a one-line
handoff to the Phase 10 QA session.

STOPPING RULES: stop and surface before any monolith ceiling raise; before
any new SimEvent type, IWorld member, command, or wire field; if the fourth
flavor cannot land without forking the single HUD case; if tests/parity reds
outside the farming scenario after the re-record (the shared draw order
forked: never regen other goldens to silence it); before anything that
grants power on a deed; on an unresolvable release tip.

Close: gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
chrome-linux64/chrome GATE_MAX_WORKERS=8 node scripts/gate_select.mjs on the
committed tree; judge ONLY the log markers ("[gate:select] FAIL at" /
"[gate] FAIL" / "[gate:select] PASS: all N steps green"; the exit code has
lied). EXPECT the full-suite fallback (the terrain fixture plus
tests/helpers/bare_client.ts keep the planner's broad arm live), about 15
minutes of vitest at 8 workers, and budget the druid_engines 20 s contention
timeout as the recorded environmental flake (prove it standalone if it fires,
do not chase it). Per D22: no push, no PR; merge --no-ff into LOCAL
feature/farming-plan, delete the branch and any agent worktrees, record the
merge hash in progress.md and the farming-skill-program memory topic, and
hand off to the Phase 10 QA (docs/farming/phase-10-qa.md).
```
