# Farming: progress

## Status

| Phase | Status | Started | Completed |
|---|---|---|---|
| Packet authored | done | 2026-08-07 | 2026-08-07 |
| Packet PR merged | superseded by D22 (local-only; no farming PRs) | | |
| Phase 1 (foundation) | done | 2026-08-07 | 2026-08-08 |
| Phase 1 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-08 | 2026-08-08 |
| Phase 2 (patches and plots) | done | 2026-08-08 | 2026-08-08 |
| Phase 2 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-08 | 2026-08-08 |
| Phase 3 (growth engine) | done | 2026-08-08 | 2026-08-08 |
| Phase 3 QA | done | 2026-08-08 | 2026-08-08 |
| Phase 4 (knobs) | done | 2026-08-08 | 2026-08-08 |
| Phase 4 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-08 | 2026-08-08 |
| Phase 5 (crops and tools) | done | 2026-08-09 | 2026-08-09 |
| Phase 5 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-09 | 2026-08-09 |
| Phase 6 (economy hooks) | done | 2026-08-09 | 2026-08-09 |
| Phase 6b (release sync, v0.38.0 at authoring) | done | 2026-08-13 | 2026-08-13 |
| Phase 6 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-13 | 2026-08-13 |
| Phase 7 (render and juice) | DONE 2026-08-14 | fix/farming-phase-07-render-and-juice (merge hash in the Phase 7 notes tail) | 0 BLOCKING across three domain reviews plus qa-checklist and the gate-integrity cone pass; 5 SHOULD-FIX fixed in-phase plus 2 adopted notes (the QA round reconciled this row with the Notes: the old "7 SHOULD-FIX" counted both) |
| Phase 7 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-14 | 2026-08-14 |
| Phase 8 (Harvest Journal) | DONE 2026-08-14 | fix/farming-phase-08-harvest-journal (merge hash in the Phase 8 notes tail) | 2 BLOCKING (language fan-out registry, focus-across-rebuild) found by the frontend review and fixed in-phase; 0 BLOCKING elsewhere across parity, architecture, hot-path, and qa-checklist; the parity gap (no golden farmReady) closed with a deliberate re-mint |
| Phase 8 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-17 | 2026-08-17; branch fix/farming-phase-08-qa, merged --no-ff as 327fa964bd; 0 BLOCKING across eight lanes plus a verification round; one behavior fix (deviation (be), the simplified-mode journal entry), the (bd) ledger corrected, the guide controls row landed, the coverage gaps pinned, 24/24 mutants killed |
| Phase 9 (world presence, go-live) | DONE 2026-08-17 | fix/farming-phase-09-world-presence (seventeenth absorb 89030e4e0f first; merge hash in the Phase 9 notes tail) | 0 BLOCKING across architecture, cross-platform, frontend, content-obligations, test-coverage, privacy-security, and qa-checklist; every SHOULD-FIX taken in-phase or ledgered as (bg) to (bm); 14/14 mutants killed; farming is LIVE |
| Phase 9 QA | done (FAIL on the go-live acceptance, scope stop; PASS on the phase's own diff) | 2026-08-17 | 2026-08-17; branch fix/farming-phase-09-qa (eighteenth absorb f4ca0f7000 first), merged --no-ff as 59584a800a; 1 BLOCKING scope finding (no player verb plants or harvests, state.md (bn)) plus the tier 3/4 seed bootstrap hole ((bo)); 0 BLOCKING on the diff across nine lanes; the live-client journey walked 39 checkpoints green at all four hubs; 16 of 16 new mutants killed; the QA fixes are the husk-trade focus restore, the stale-comment sweep, and the coverage pins |
| Nineteenth absorb (v0.39.0 round-2 sync mid-phase) | DONE 2026-08-18 | fix/farming-sync-v0.39.0-r2, merge b9a025b2ee of tip 7b45fdb9a9 (285 commits, 833 files, 168-file intersection: the D22 triple-digit rule) | Heals: sim.ts and main.ts extraction (mech_chroma_ownership, turnstile_gate), renderer merge-rule re-pin 13774, classified golden re-record (+4 farmers vs the release recordings, +3 practice dummies in farming_session, zero unexplained leaves), terrain fixture re-record (29 pad-local points), Eastbrook and portrait re-mints per (al), lock-rig rebuild for the whole-slot rework; 4-lane release-merge audit + cross-platform APPROVE + architecture clean move + qa-checklist; details in the notes block |
| Phase 9b (the bed verbs) | DONE 2026-08-19 | fix/farming-phase-09b-bed-verbs off 6981105f27 (the nineteenth-absorb merge); merge hash in the notes tail | The go-live is PLAYER-COMPLETE: the interact-key bed arm harvests and the plant sheet plants on desktop, touch, and gamepad; q_farm_intro completes through the client (journey 17/17 on the final tree, desktop and 844x390 landscape touch); (bn) CLOSED, (bp) offer-gate refinement; reviews: cross-platform APPROVE, frontend pass with all seven fixes taken, coverage B1-B3 closed and S1-S7 landed, gate-integrity PASS, qa-checklist in the notes; mutations 10/10 killed named |
| Phase 10 (celebrations) | DONE 2026-08-19 | fix/farming-phase-10-celebrations off 0afde346ab (release tip ea9377db8e already absorbed, no new absorb); merge hash in the notes tail | golden_harvest as the fourth gatherRareEvent flavor (1/90 shared constant, five-fold signed yield, one announce path, single HUD case); seven D13 deeds + the Harvestmaster title (280/3190/43); the ui_farm_golden sting end to end; hud.ts ceiling LOWERED 19352 to 19230 via the ability-tooltip extraction; farming_session re-recorded once isolated (16 draws, md5 83c34781); deviations (br)-(bv): the bed-tier premise probed false (all four chronicles earnable), prog_farming_100 dormant under a recorded waiver, the title-shelf committed-crest rule; reviews 0 BLOCKING with the content lane resolved via the waiver, qa-checklist READY; mutations 13/13 killed named |
| Phase 9b QA (the bed verbs audit) | DONE 2026-08-19 (PASS-WITH-FOLLOWUPS) | fix/farming-phase-09b-qa off c9075785ef (twentieth absorb ea9377db8e first: one release commit, i18n fills, pending.ts regen-resolved); merge hash in the notes tail | The fresh pass re-proved the go-live independently: journey 17/17 desktop AND mobile through the real controls, 18 desktop manual probes (focus trap, keydown guard with a jump positive control, Esc focus restore, the locked-seed deny with the sim's own toast, the ja_JP locale switch, the relocalize arm) plus the mobile sizing (all knobs 44px) and the contrast eyeball (8.95:1); negative space proven by RUNNING the pins (zero golden movement, every baseline held); one real behavior fix (the ctx.error dead/busy denies stranded the Plant control: the error-toast re-arm, deviation (bq)) plus the report_window rename under the cold-painter sweep with its first suite, safe-area caps, and eleven hardened pins; mutations 11/11 killed named (two shipped survivors diagnosed as real gaps, fixed, re-proven); reviews: 4 Workflow lanes + cross-platform APPROVE + test-coverage approve-with-followups + qa-checklist in the notes |
| Phase 10 QA (verify celebrations) | DONE 2026-08-19 (PASS-WITH-FOLLOWUPS) | fix/farming-phase-10-qa off 8a466e898f (release tip ea9377db8e still newest, no absorb); merge hash in the notes tail | All five mandatory emphases verified first-hand (totals re-pin exact 273+7/3155+35/42+1; zero golden movement outside farming_session with the golden dir byte-identical merge-to-HEAD; the instance exclusion proven with a LIVE multi-observer Sim probe; a real golden win replayed through the LIVE client HUD, epic line + finder-only cues behaviorally observed; the (bs)/(bt) stories coherent); two BLOCKING coverage gaps closed (the golden signed-grant bag paths, the finder-only sting pins rebuilt as the gather_rare_event_feedback pure core + behavioral suite); hud.ts SHRANK again (ceiling 19230 to 19220); fresh mutations 14/14 killed named; browser suite 133 green standalone and perf:tour exit 0 (the two VERIFY items); (bw) parity-win coverage deferred to Phase 11 by the (z) precedent |
| Phase 11 (well-fed food) | DONE 2026-08-19 | fix/farming-phase-11-well-fed-food off f0d329db02 (the twenty-first absorb, release/v0.40.0 e56707a675, opened the phase); merged --no-ff as 9fc11d5452, phase tip e6746bfe79 | ItemDef.wellfed beside elixir; the completion-time mint (src/sim/wellfed.ts at the updateRegen slot-null site, deviation (bx)); one shared aura 'Well Fed' / wellfed_buff_sta, last-eaten-wins namespace-wide (by); four buff dishes in FARM_RECIPES rows 9 to 13 with the (bz) vale_wheat binder; magnitudes 3/600s 6/900s 9/900s 12/900s proposed and flagged; (bw) discharged (the golden-WIN and paying-band beats, one isolated classified re-record, draws 16 to 110, md5 25bd6b87); reviews 0 BLOCKING; mutations 9/9 killed named; gate all 12 green on e6746bfe79 |
| Phase 11 QA | DONE 2026-08-19 (PASS-WITH-FOLLOWUPS) | fix/farming-phase-11-qa off 35536d8ca8 (v0.40.0 e56707a675 still newest, no absorb); merge hash in the notes tail | All four mandatory emphases proven live first-hand (coexistence and last-eaten-wins through real ticks; the eat verb PLAYED as a player through the real bag UI on the LOW live client with the buff bar, remaining time, and single-Use:-prefix tooltip observed; the tier-4-then-tier-1 downgrade over the REAL wire through a stable-timer GameServer + ClientWorld rig, value 12 shipped, held through elision, re-encoded to 3); 7 lanes/reviewers 0 BLOCKING; 4 SHOULD-FIX closed test-first (18s boundary bracket, concurrent-meal refusal, death forfeit, zero-rng rig guards) plus the stat-map parity pin, the stripComments glue-pin hardening, and ten frozen non-Latin fill literals; mutations 7/7 killed named (M3 and M5b re-proven, five fresh over the new pins); rest ledgered with owners in the state.md Phase 11 QA block |
| Phase 12 (shared feast) | DONE 2026-08-19 | fix/farming-phase-12-shared-feast off deffe3a5d4 (release/v0.40.0 e56707a675 still newest, no absorb); merged --no-ff as 71010cf82a, phase tip 1b33789ba4 | harvest_feast (kind junk, ItemDef.feast {charges 10, 3600 ticks, dishItemId evergarden_braised_greens}) + recipe_harvest_feast (FARM_RECIPES 14, reagent-dormant under (ca)); placeFeast/consumeFeast on IWorldFarming (331 = 88 + 243); the farm_feast entity on the normal snapshot; one-active-per-placer; the bite is a consume slot at the capstone dish (the one updateRegen mint site); the lootable re-arm trap found BY PLAYING and fixed; beat P appended (draws 110 unchanged, md5 9dfd1c6e); five-review round + qa-checklist 0 standing BLOCKING; gate run 2 all 12 green |
| Phase 12 QA | DONE 2026-08-19 (PASS-WITH-FOLLOWUPS) | fix/farming-phase-12-qa off 2445de46ab (e56707a675 still newest, no absorb); merge hash in the notes tail | All four emphases proven first-hand over the real wire (three-session lifecycle incl. placer-eats-own and latecomer denies; the ledger survives leave/rejoin on the characterId key; nothing serializes, save blobs + db calls captured clean; the re-arm class online through a real ClientWorld mirror); ONE real defect class found and fixed test-first in BOTH legs (the teardown leak: a feast placed in a dungeon instance or a delve run outlived it); the re-arm dodge amended to the Infinity sentinel (worst-case margin was ONE tick, four lanes converged); flourish rebuild-replay silenced + FEAST_SHADOW_CAP 8 (presence never culled); six decisive arms added (swim-bite, exact-range, keyed placer, orphan window, delve lifecycle, behavioral bags click); mutations 13/13 killed named; 3 audit lanes + 5 reviewers + qa-checklist READY, 0 BLOCKING anywhere |
| Phase 13 (integration polish) | complete 2026-08-19, merged --no-ff as 1f1a74a8ad (phase tip 5c371c2fba) | | |
| Phase 13 QA (final; teardown deferred per the D22 addendum) | complete 2026-08-19 | PASS-WITH-FOLLOWUPS | merged --no-ff 396e946c06 (QA tip 13e2210b0d) |

## Per-phase deliverable checklists

Each phase file's STEP 5 acceptance criteria are the authoritative checklist; this
section holds the running record. On phase completion, copy the acceptance list here
with its check states, then add a Notes block (surprises, deviations from the phase
file, deferrals with reasons, drift discovered). A deviation also gets a line in
state.md's "Locked deviations" ledger, and an amended phase file always gets its QA
twin swept in the same pass.

### Phase 1
Completed 2026-08-08 on fix/farming-phase-01-foundation, merged --no-ff into
feature/farming-plan. Release sync: origin/release/v0.36.0 absorbed at the phase
start (37 commits, textually trivial merge, docs-only branch).

Acceptance (phase file STEP 5):
- [x] 'farming' is the LAST member of GatheringProfessionId, GATHERING_PROFESSIONS
      carries its row with maxSkill 100 (D1; fishing's 200 deliberately not copied),
      and GATHERING_PROFESSION_IDS appends it last with the iteration-order comment
      amended to name it (the comment named fishing explicitly, so verbatim
      preservation was impossible).
- [x] Every silent-miss site on the (extended) blast-radius list has a farming arm
      with a pin that fails on fallthrough: name keys, gatherDeniedLineKey (three
      sub-arms pinned not-corpse), gatherToolNoNodeKey (pinned not-mining), display
      name plus toolTierUnmet/toolRequired/wieldUnmet/noNodeNearby, and the
      Phase-1-discovered sites: gather_tool_tooltip KIND_KEYS (tsc-forced, wield-line
      pin proves the shared name table), the guide count prose (count-free reword,
      anti-count pin), and the Master Gatherer roster prose (see Notes).
- [x] gather_farming procedural icon exists (earth bg, leafGreen pal, sack+leaf,
      no hoe/sprout primitive exists); tests/profession_icons.test.ts green via the
      PENDING_ART_IDS deviation (see Notes).
- [x] tests/professions_contracts.test.ts green, five skills exact order.
- [x] tests/snapshots.test.ts green, farming: 0 in the gprof round-trip literal
      (plus the typed assignment and the second exact-order array).
- [x] npx tsc --noEmit clean; every literal GatheringProficiency fixture compiles
      (three sites beyond the packet's list were found and moved).
- [x] skill caps and blob growth re-pinned green: ceiling re-minted 9728 to 10240 on
      a measured 9497 worst case (farming costs 46 bytes, dual-written), following
      the file's own re-mint doctrine; a new pin holds farming's cap at 100.
- [x] npm run wiki:content ran; the farming wiki page exists; tests/guide.test.ts
      green (generator crash on a tableless trade fixed in build_content.mjs).
- [x] Parity: the predicted pre-regen red NEVER MATERIALIZES and that is proven
      correct, not skipped: canonical() drops inert zero keys from the sample
      (trace.ts omitDefaults true at the sample build) before digests are taken, so
      an all-zero farming key enters nothing. Pre-regen run GREEN (193 passed),
      UPDATE_PARITY=1 regen BYTE-IDENTICAL across all 60 goldens, post-regen green.
      No golden commit exists because there is nothing to commit (deviation from the
      packet's D23 premise, recorded in state.md).
- [x] i18n: English-only catalog rows; every M16-wordy value (all six hud_chrome
      leaves including the bare display name, the two reworded guide bodies, the two
      new gatherIntro/gatherDeeds pages, the three reworded gatherDeeds bodies)
      shipped its five non-Latin fills in the same change; localization_fixes,
      i18n_completeness, and i18n_semantic_regressions all green.
- [x] No way to gain farming skill, verified not assumed: queueGatheringGrant has
      exactly three call sites (NODE_HARVEST_TABLE has no farming node type,
      fishing.ts hardcodes fishing, dev_commands is ALLOW_DEV_COMMANDS-gated). The
      dev cheat /dev gather farming N does work, accepted as dev-only tooling. The
      row renders 0 / 100 in the professions window and character sheet (pinned).
- [x] This report flags: farming now automatically satisfies existing
      any-profession gathering deed arms (accepted consequence). Both count-form
      deeds (prog_first_gather count 1, prog_master_gatherer count 3) remain
      earnable; a new guard in tests/deeds_content.test.ts caps every any-N
      gathering trigger at the gainable profession count (4 until the growth phase).

Notes (surprises, deviations, deferrals):
- DEVIATION, icon art: tests/profession_icons.test.ts E2 pins every recipe id as
  art-backed in production (committed 128px WebP plus a maintainer-held master SHA in
  mapping.json), which procedural-only cannot satisfy and the packet did not
  anticipate. Resolved with an explicit PENDING_ART_IDS allowlist scoped to
  gather_farming, INVERTED assertions (the test reds the day real art lands, forcing
  the allowlist entry's removal), a companion E3 pinning that the procedural fallback
  exists, and an asset-manifest declaration so the commission is on the books for the
  phase 13 batch. Needs maintainer sign-off at feature review.
- DEVIATION, parity: no golden regen commit exists (byte-identical regen, above).
  The growth phase (first nonzero farming proficiency) inherits the full-regen duty;
  state.md records the omit-defaults shield and the event-digest constraint.
- DEVIATION, commit cadence: six commits instead of five (two review rounds
  landed as their own fix commits; the parity commit does not exist).
- DEVIATION, scope pull-in: the Master Gatherer desc and three guide deed bodies
  still enumerated the pre-farming roster while the any-three trigger now counts
  farming. All three reviewers flagged it and the desc's own comment records the
  identical reword when fishing joined, so it was pulled INTO Phase 1 rather than
  deferred to the deeds phase: desc reworded roster-free, 18 stale locale desc fills
  dropped per the deed_i18n release-refill protocol, three guide bodies reworded
  with 15 fresh non-Latin fills, and a pin banning roster enumeration.
- SURPRISES: gather_tool_tooltip.ts KIND_KEYS (exhaustive Record, compile-forced,
  not on the packet's list) plus its Partial UNLOCKS/USE neighbours;
  gather_node_tooltip_controller.ts maps (farming never joins, fishing precedent);
  the guide count prose lived in TWO keys, not one, and whatBody carried a second
  count ("all four gathering professions") the packet never saw; locale staleness
  came in two forms (enumerated roster vs counted roster); the wiki generator
  crashed on a tableless trade; tests/professions_gathering.test.ts had three
  unlisted pin sites; the parity CLAUDE.md fishing-scenario claim is stale (a
  fishing session scenario exists).
- DEFERRALS (all ledgered in state.md with owners): tierRequired/requiresTool
  families and tooltip UNLOCKS/USE rows (hoe phase); node hover tooltip maps (beds
  phase); the generated farming wiki page renders the node-arm layout with empty
  tables (later phase adds a farming arm); Latin-script overlay staleness
  (release-time fill); stale pre-existing comments in src/net/online.ts and
  src/sim/types.ts (inherited debt, outside this diff).
- Validation: tsc clean; 16 targeted suites 513 green plus the review-round suites;
  parity green twice; ci:changed clean (real exit 0, warnings only); gate_select
  full-suite fallback green except tests/profile_mode.test.mjs, an ENVIRONMENTAL red
  (no system Chrome; passes standalone with BROWSER_PATH set, 20/20) in the same
  class as the standing armory exception; final gate re-run with BROWSER_PATH
  exported recorded below.
- Reviews: architecture 0 blocking (rng/tick/seam/purity explicitly clean),
  cross-platform-sync 0 blocking (three hosts and both worlds verified, RL obs
  shape unchanged), frontend-seam 0 blocking (M16 fills verified line by line,
  PENDING_ART amendment confirmed self-clearing). qa-checklist returned NOT
  READY with two SHOULD-FIXes all three domain reviews missed, both fixed in
  the second review round: (1) the farming wiki page rendered "respawns for
  you 0 seconds" (the ?? 0 fallback over an empty nodes array) and the full
  vendor-ladder prose over an empty tools table; both sections length-guard
  now, with a render test driving the REAL page on both sides of the guard
  (data pins are not page pins: that is why three reviews missed it). (2)
  slotToolEffectRefused accepted farming pairs on the admin restore path
  (junk-audit-row class); farming is now statically refused like fishing,
  pinned in the tooltip suite and the admin-restore refused-pairs arm, and
  the hoe phase lifts the refusal. Also from the QA round: a structural
  ungainability pin (no farming node type, no farming gatherTool, anti-vacuous
  both ways), the count guard extended to digit counts, and a verified
  negative recorded: headless/ and python/ carry zero profession surface.

Would-be PR body (D22 keeps this local): "Registers Farming as the fifth gathering
profession: the content row (cap 100), append-last id registration, every UI
silent-miss site swept with anti-fallthrough pins, the procedural gather_farming
icon behind a self-clearing pending-art allowlist, count-free guide and deed prose
with non-Latin fills, and the full literal re-pin sweep. No gameplay: farming skill
is ungainable and every farming denial line is pre-wired but unreachable. Parity
proven unchanged (green gate, byte-identical regen). Screenshots:
docs/screenshots/farming-phase-01/before-professions-gathering-desktop.png vs
after-professions-gathering-desktop.png plus the mobile pair (the gathering section
gains the Farming 0 / 100 row with its procedural icon). Capture tooling learned the
lessons alongside: the professions shot target now fires on content/professions
changes, its staged professionsState stub carries the fifth row, and a
mobile-gathering variant scrolls the section into view."

#### Phase 1 QA (2026-08-08, verdict PASS-WITH-FOLLOWUPS)

Audited the exact phase diff b284c8c6b9..1005e52bb3 on the merged tree.
Pre-audit, the moved release tip (0051daaab7 to 6ed4d7e12c) was absorbed as
merge a9959c3670 (400 files; the only textual conflict was the generated
pending.ts bundle, resolved by regenerating via i18n:gen and wiki:content)
and the release-merge-audit skill ran clean: every both-side overlap file
verified (all farming keys survived; the roster-free Master Gatherer desc won
over the release parent's still-enumerating form), no legacy-arm divergence,
no injected-helper drift. Parity was re-proven on the post-merge HEAD: 193
green plus an UPDATE_PARITY=1 regen byte-identical under tests/parity/golden,
closing the drift window the second absorb had opened over the phase's
original proof.

Audit shape: an 8-agent fan-out (context reload plus correctness, coverage,
and dead-code packet audits, plus the matrix reviewers cross-platform-sync,
architecture-reviewer, frontend-seam-reviewer, and the qa-checklist gate);
8 of 8 delivered, 0 BLOCKING anywhere. Six scripted mutation checks (both
gathering_view denial arms, the tooltip kind-key swap, the icon-id rename,
the refusal-arm delete, the guide length-guard weaken) all KILLED with named
failing tests and nonzero exit codes. The correctness audit re-read the
committed screenshots (farming row at 0 / 100 visible, desktop and mobile),
drove a live 400-tick headless-Sim probe (farming stays 0 while the four old
professions gain; probe deleted, tree clean), and re-confirmed the roster
grep returns nothing.

Fixed this round on fix/farming-phase-01-qa (merged --no-ff, branch deleted):
- SHOULD-FIX: the char sheet farming row painted NO icon (professionImageUrl
  is null for a pending-art id) while the professions window painted the
  procedural composer; the painter now resolves through professionIconUrl
  and the render test pins all five srcs (found independently by the
  frontend-seam review and the coverage audit).
- SHOULD-FIX: the static farming tool-effect refusal had no self-clearing
  tripwire, and the REST validator arm (restoreSlotBodyError) pinned fishing
  and Springback but not farming; both pinned now (architecture review plus
  the qa-checklist adversarial pass).
- SHOULD-FIX: the blob-growth lower bound still tracked the pre-Farming
  9,451 measure while its comment claimed re-measure tracking; re-minted
  9216 to 9280 against the 9,497 re-measure (coverage audit).
- SHOULD-FIX: the resolveSlotToolEffect refusals contract comment enumerated
  only fishing; farming named (correctness audit).
- NICE-TO-HAVE: dropped the constant-true E3 length assertion in the icon
  suite (flagged by three audits independently).

Deferred with owners (pre-ledgered in state.md unless noted):
- Latin-overlay stale count prose (whatBody, gatherHubBody, the three
  gatherDeeds bodies) and the 18 dropped Master Gatherer desc fills:
  release-time i18n reconcile. Dropping the stale guide fills now would red
  i18n_semantic_regressions; deed_i18n has its own sanctioned drop protocol,
  which is why the two surfaces were handled differently.
- The 120 farming pending rows: the release-tier fill workflow (deliberate;
  I18N_RELEASE_TIER=1 hard-fails until the maintainer fill).
- The guide anti-roster pin binds English only; extend it across locales AT
  the release fill (today it would red on the deferred stale fills).
- GAINABLE_GATHERING_PROFESSIONS raise: growth phase (ledgered).
- Node-tooltip Partial maps stay farming-free: beds phase (ledgered).
- Stale dev-facing comments (src/net/online.ts gprof pair, src/sim/types.ts,
  the src/guide/pages/professions.ts header, scripts/load_professions.mjs
  GATHER_PROFS): inherited debt, ledgered in state.md this round.
- No real-browser E2E drives the five-row professions window; unit plus
  jsdom plus the committed screenshots accepted for a dormant surface.

Also harmonized: the state.md and phase-file deviation letterings disagreed
and together enumerate SEVEN distinct deviations; state.md's ledger is now
the canonical superset (a) to (g) and the phase file points at it.

### Phase 2
Completed 2026-08-08 on fix/farming-phase-02-patches-and-plots, merged --no-ff into
feature/farming-plan per D22 (no push, no PR). Release sync: origin/release/v0.36.0
absorbed at the phase start (merge 743a1ee6ad, tip e5c16ca398, the PR 3138 wiki
refresh, 14 commits / 89 files, guide-only; the one conflict was the generated
pending.ts, regen-resolved; release-merge-audit clean, no divergences).

Acceptance (phase file STEP 5):
- [x] FARM_PATCHES covers exactly the four D2 hubs at the locked tiers (eastbrook_vale
      1, mirefen_marsh 2, thornpeak_heights 3, evergarden 4), every bed id stable and
      documented as a persisted save key; positions and bed counts in Notes below.
- [x] tests/farm_patch_placement.test.ts green with every physical-safety arm (dry
      land, sea freeboard, water in reach, slope with reach sweep, collider overlap,
      stand spot, hub reachability, zone containment, bed spacing) plus the Sowfield,
      camp-footprint, road and gather-node-clearance screens, each arm paired with a
      counter-example proving it can fail.
- [x] src/sim/professions/farming_zones.ts follows the fishing_zones template
      (Object.hasOwn reader, explicit row per farming zone, derived knobs); the
      one-ladder arm pins FARM_PATCHES[].tier to the reader, so no other module
      hardcodes a farming zone tier.
- [x] PlayerMeta.farmPlots exists, initialized empty in addPlayer; the empty Map
      canonicalizes to an inert [] in the parity sampler (shield proven again).
- [x] CharacterState.farmPlots is optional with a default: a pre-farming save loads
      cleanly and re-omits the key on save, proven end to end through a real Sim.
- [x] Normalize-on-load drops unknown bed and crop ids, drops non-finite and
      non-positive timestamps, clamps duration to FARM_MAX_GROW_MS BEFORE the future
      re-anchor, guards the zero offline clock, drops a corrupt hidden slot without
      the row; 13 tamper arms plus malformed-container and prototype-key pins.
- [x] The save round trip is green with expectation literals built fresh (no
      reference-aliased self-comparison); clamp and sort pins mutation-checked.
- [x] IWorldFarming exists with reads only (farmPatches, myFarmPlots), implemented in
      BOTH Sim and ClientWorld; tests/world_api_parity.test.ts pins updated (302 to
      304 members, 77 to 79 data, 32 to 33 facets) and green.
- [x] fplot registered in ALL_DELTA_KEYS and TERSE_TO_IWORLD (67 to 68, literal-string
      pins, sorted position between equip and gprof); the snapshots round-trip pin is
      green and the delta fixture plants a real row so the mirror cannot pass on the
      empty default.
- [x] The negative wire-leak pin drives the REAL selfWireJson broadcast and proves the
      payload carries neither survivalRoll nor yieldSeed, with an exhaustive nine-key
      set assertion; mutation-checked (a forced leak and a key rename both red).
- [x] tests/parity green (193 passed) AND the UPDATE_PARITY=1 regen left the goldens
      byte-identical, so there is NO parity commit this phase (the deviation (b)
      precedent holds; the growth phase inherits the first real regen).
- [x] tests/architecture.test.ts green: sim purity, zero new rng call sites.
- [x] Nothing is player-reachable: no command, no item, no render, no UI, no event.

Notes:
- Patch positions and bed counts (all coordinates x, z; a patch is a rectangular
  grid on a 5 yard pitch, the INTERACT_RANGE floor; anchor = grid centroid):
  - patch_eastbrook, tier 1, anchor (18.5, 32.5), 4 beds at (16,30) (21,30) (16,35)
    (21,35): the north lane out of town. The obvious west farmland PASSED every
    physical arm but sits 8.1 yd inside the Sableweb webwood camp footprint, which
    forced both the move and a new camp-clearance arm. Re-seated at the
    release/v0.41.0 merge to anchor (-21.5, -81.5), beds (-24,-84) (-19,-84)
    (-24,-79) (-19,-79), Jessica (-15.5, -81.5): the rebuilt vale's second
    forest_wolf camp ((12, 52) r26) overran the north-lane site.
  - patch_mirefen, tier 2, anchor (-22, 341), 5 beds at (-26,339) (-21,339) (-16,339)
    (-26,344) (-21,344): drained ground south-west of Fenbridge; the no-water-in-reach
    arm forced the move off the skeleton rows.
  - patch_thornpeak, tier 3, anchor (-18, 687.5), 6 beds at (-23,685) (-18,685)
    (-13,685) (-23,690) (-18,690) (-13,690): the shelf below Highwatch; the
    reach-sweep slope arm rejected the first candidate column.
  - patch_evergarden, tier 4, anchor (348.5, 874.5), 8 beds at x 341/346/351/356 by
    z 872/877: the parterre lawn 12 yd west of The Parterre Walk, off its lane;
    reachability floods from the ZONE hub Hedgewick (320, 810).
- Bed counts are tier-scaled 4/5/6/8 (the showcase reads as one garden); bed ids
  bed_<hub>_<n>, patch ids patch_<hub>, both persisted save keys, never renumber.
- Placement constants decided in-phase: BED_CLEARANCE = PLAYER_BODY_RADIUS +
  SWEEP_STEP (beds ship no collider this phase, the herb null-body case);
  BED_SPACING = INTERACT_RANGE inclusive, with the tightest real pair sitting
  exactly on the floor and pinned with toBe. Two arms beyond the brief: road
  clearance (5 yd, the world.ts screen) and bed-vs-gather-node clearance (5 yd).
- The gate's full-suite fallback caught one post-review red the targeted runs
  cannot see: the blob GROWTH suite mirrors PROFESSIONS_BLOB_FIELDS from the
  roundtrip sweep by source scrape, so registering farmPlots there demanded the
  growth fixture plant every bed and the byte bounds re-mint (ceiling 10240 to
  14336, floor 9280 to 13696, measured 13948); edit both suites together from
  now on (ledgered in state.md deviation (m)).
- The review round (cross-platform-sync, architecture-reviewer, migration-safety,
  qa-checklist: 0 BLOCKING everywhere) added: the deep freeze of FARM_PATCHES with
  a frozen pin, farmPlots registration in PROFESSIONS_BLOB_FIELDS, readonly content
  interfaces, stable-id destroy-on-load warnings at both id edit sites, the
  clock-base contract comments on the seam (see state.md, growth-phase handoff),
  the dev-channel drop warn on load, malformed-container and prototype-key pins,
  and the serializeCharacter caller scan pin.
- Would-be PR body (D22, recorded in lieu of a PR):
  Title: feat(professions): farming patches and per-player plot state (phase 2)
  Summary: The world knows where garden beds are and each player can persist plot
  state, with the wire carrying only the public projection. Adds FARM_PATCHES
  (4 hub sites, 23 stable beds) with a cloned physical-safety placement suite,
  farming's own tier ladder leaf, PlayerMeta.farmPlots with an optional
  anti-tampered CharacterState row, the IWorldFarming read facet in both worlds,
  and the fplot self delta whose projection provably never carries the hidden
  pre-rolled outcome slots. No command, item, growth, render, or UI: nothing is
  player-reachable this phase.
  Testing: 4 new/extended suites (59 tests) plus the wire, parity-pin,
  architecture, bandwidth, env-protocol and full parity suites (940+ tests
  across the validation list), UPDATE_PARITY=1 regen byte-identical, gate_select
  PASS. Screenshots: n/a (no visual surface).

Phase 2 QA (2026-08-08), verdict PASS-WITH-FOLLOWUPS, fixes on
fix/farming-phase-02-qa merged --no-ff per D22:
- Pre-audit: absorbed release/v0.36.0 tip 81804a179e (wiki accuracy round 2,
  guide-only) as merge c7fe3a9334; release-merge-audit clean (farming's three
  guide prose edits survived verbatim; the new release-authored
  guide_key_coverage suite passes on the merged tree); world_api_parity plus
  snapshots re-run green at the merged HEAD per the standing post-absorb rule.
- Audit shape: an 8-agent workflow (context loader, correctness with live
  wire-leak/load-tamper/tick probes, test-coverage, dead-code, plus
  cross-platform-sync, architecture-reviewer, migration-safety, qa-checklist)
  followed by the two matrix rows the build never dispatched:
  privacy-security-review (its row matches by text; verdict ship-it, the one
  should-fix is the Phase 3 hidden-slot clamp gate, ledgered in the handoff)
  and database-performance-reviewer (borderline row via stored-data growth;
  verdict PASS, corrected the first fleet estimate's storage-vs-write-volume
  conflation and added two plant-phase gates, all ledgered in the state.md
  handoff). migration-safety and database-performance both needed the known
  agent-redispatch recovery. 0 BLOCKING anywhere.
- Correctness probes (all green, real paths): hidden slots and yield seed
  filled then proven absent over a real GameServer broadcast while status
  stayed clock-derived (a doomed pre-roll on an expired timer reads ready, a
  healthy one on a future timer reads growing); load-tamper blob (bogus bed,
  unknown crop, over-ceiling and exact-ceiling deadlines) loads clean with
  drops and an exact clamp; 20-tick advanceable-clock probes pin growing at
  ready-1ms and ready AT readyAtMs; live-surface holds (zero references from
  ui/render/game/guide/editor/headless).
- Fixed (9 commits): normalize now inserts in sorted bed order (the rng
  iteration-order hazard the growth phase must not inherit);
  projectFarmPlots/farmPlotsFor serve a shared frozen empty projection
  (the toolEffectSlotsFor allocation precedent) and the seam signatures
  tightened to readonly; the scratch-sim character builders (creation, PBE
  boost, community templates) now inject lockoutNowMs and the clock-base scan
  pin demands the token (it previously proved only the weaker
  no-caller-outside-server property); the load warning now counts dropped
  hidden slots (countDroppedHiddenSlots), which the row count cannot see; new
  pins for the status boundary at exactly readyAtMs, the 23-literal bed-id
  roster (a rename is a destroy-on-load decision), per-flag junk arms for
  tonic/notified, the write-side non-finite slot omission, a direct
  projectFarmPlots unit describe, farmPlots sampled-not-inert in the parity
  sampler, a real-ClientWorld farmPatches by-reference pin (withDomStubs),
  and the bareClient sweep (toolEffectSlots, farmPatches, myFarmPlots);
  comment drift corrected (the farm_persist re-roll comment now states the
  derive-deterministically handoff rule; the key-sort rationale no longer
  claims JSONB key order; the allowlist-Set freeze asymmetry is documented;
  docs name FARMING_ZONE_TIERS, the export that exists).
- Mutation pass: 16 mutations, 16 killed with named failing tests (the four
  former expected-survivors from the coverage audit all die on the new pins).
- Validation: tsc clean; the 11-suite matrix batch 646 green; tests/parity
  194 passed 1 skipped (one new harness test; goldens untouched);
  ci:changed rc=0 AFTER refreshing origin/main (a stale main ref sweeps
  release-side scripts into the changed set; fetch main before gating) and
  one genuine format fix in sim.ts.
- Deferred with owners (ledgered in state.md): hidden-slot range clamps land
  WITH their value domains (the privacy gate for Phase 3); the msRemaining
  derived duration field and the offline anchor-semantics family stay the
  Phase 3 handoff; admin character inspection must field-pick like the wire
  projection when a farm section lands; the deploy-order constraint moves to
  DEPLOY.md when planting ships; render-phase FarmBedDef export symmetry.

### Phase 3
Completed 2026-08-08, executed local-only per D22 (no push, no PR; phase branch
fix/farming-phase-03-growth-engine merged --no-ff into feature/farming-plan and
deleted). Base: release/v0.36.0 tip 81804a179e, already absorbed at phase start, so
no release merge was needed. Commits: a8560344a2 (sim engine), 5e0e9ab766 (command
chain, dev cheat, blob signal), 4553b71357 (ui rows and matcher), b03a8ba7fc (tests,
parity session, census pins), plus the docs commit closing the phase.

Acceptance (STEP 5, with states):
- [x] plantCrop gate order, every deny arm tested individually and drawing zero,
      WITH one locked deviation: the hoe-tier and wield gates are DEFERRED to
      Phase 5, verified not assumed (no farming gatherTool exists;
      bestOwnedGatherToolTierOrNone returns NO_TOOL_OWNED so canGatherTier(0, 1)
      would refuse EVERY plant, and the R22 banner forbids the bare-hands-floored
      scan for access decisions). Documented at the gate site and in all three seam
      comments; the ungainability pin stays green.
- [x] Seed consumed; the full growth script pre-rolled in ONE contiguous two-draw
      ctx.rng block (survivalRoll then yieldSeed); ready-at from the crop duration
      via ctx.lockoutNowMs, write-side anchor floored at 1 to match the load rule.
- [x] FARMING_CAST_ID across all four id-discriminating sites: completion routing
      (return-only arm; the plant resolves at command time, the cast is flavor),
      castingReadout ('You are planting.' plus matcher row), castBarState (audited
      no-op: generic filling hardcast, the pre-roll is not in castTotal), hud
      castDisplayName (abilityUi.cast.farming).
- [x] harvestCrop: withered grants 2 withered_husks and no XP; ready resolves the
      harvest-lives yield (floor 3, pick cap 12, skill-scaled keep and fine
      chances) from a local pure expansion of yieldSeed; XP through
      queueGatheringGrant with FARMING_GAIN_SCHEDULE behind a composed tier
      ceiling.
- [x] Draw-count contract stated in farming.ts and pinned per arm: 2 at plant, 0 at
      harvest, 0 on every deny, 0 at expiry, 0 at login, 0 in the tick.
- [x] updateFarming appended in the tick tail (after the delayed-event drain lap,
      before updateDeeds), 1 Hz internal guard, zero draws, lap marker registered
      in SIM_LAP_PHASES.
- [x] Typed deny reasons; four text-free id-carrying SimEvents; catalog rows,
      matcher coverage, and locale item names; localization_fixes and
      localization_coverage green.
- [x] Command chain wired in all four parts plus the facet, schema, and parity pins
      (306/79/227, facet count 33 unchanged).
- [x] /dev farmgrow (alias /devfarmgrow) behind ALLOW_DEV_COMMANDS; writes
      readyAtMs only, draws nothing, leaves settled plots alone.
- [x] tests/professions_farming.test.ts green (55 tests): lifecycle on an
      advanceable injected clock, survival boundaries, draw pins, same-seed
      determinism, mid-growth round trips on BOTH anchor paths, every deny arm,
      anti-chore late-harvest equality.
- [x] farming_session parity scenario and golden green; ZERO pre-existing goldens
      moved. The new golden itself was re-minted twice in-phase, both times for
      cause (the double-loot-line fix moved the event digest; the write-side
      anchor floor corrected a recording of the destroy-on-load defect).
- [x] The Phase 2 negative wire-leak pin passes with the hidden slots genuinely
      filled.
- [x] Tuning constants stated below and flagged for the maintainer.

Notes:
- Draw layout locked: plant success draws exactly 2 (survivalRoll uniform [0,1),
  then yieldSeed uint32), contiguous, after every deny arm and every
  state-breaking side effect (stealth, sit, mount all pinned at 2 draws). Harvest
  draws 0: yield expands from yieldSeed via a module-local mulberry32; per pick,
  one keep-life roll then one fine roll, documented at the resolver.
- Growth stages: 4 visual stages derived purely from elapsed fraction thirds
  (sprout, seedling, maturing, ready); no stored stage state; Phase 7 consumes.
- Survival is evaluated against CURRENT farming skill at read time (D6's
  "out-leveling permanently retires its risk", monotone player-favorable because
  proficiency never decreases); survived = survivalRoll < chance, chance = 0.85
  at the band gate ramping to 1.0 at band top, +0.10 compost +0.10 watch (both
  Phase 4, default off), cap 1.0.
- Tuning constants for the maintainer (all flagged in source): vale_wheat 45 min
  duration (mid tier-1 band), keep chance 0.15 + 0.35 x skill/100, fine chance
  0.02 + 0.08 x skill/100, pick floor 3 and cap 12, husk payout 2, plant cast 2 s,
  FARMING_GAIN_SCHEDULE [25:1, 50:0.5, 75:0.1, 100:0.02], sellValues 1/4/8
  (seed/produce/fine twin, buyValue 32 on the fine twin per the fine-material
  convention). CONSEQUENCE needing a call: tier-1-only content teaches farming
  to proficiency 50 and stops (the composed ceiling mirroring fishing);
  reachable 100 waits for Phase 5 tier 2+.
- fine_vale_wheat ships as an ordinary item with NO MATERIAL_GRADES row (locked
  deviation: the grades table is pinned as exactly the nine node yields and its
  suite derives from live node content; the fine roll lives in farming's own
  harvest resolver). The crop id shipped as vale_wheat, closing Phase 2
  deviation (h) (the 'wheat' placeholder), data-safe because nothing could
  have planted.
- The four items joined the material taxonomy through a new derived source
  (FARM_MATERIAL_ITEM_IDS off the crop catalog, self-registering for Phase 5)
  and sit in a self-clearing CONSUMER_DEFERRED_MATERIALS list in the affinity
  census (husks consume in Phase 4, produce in Phase 6); icons ride
  ITEM_ART_PENDING re-pinned as an exact id set.
- Server-side findings fixed in-phase: fplot moved behind the heavy-self gate
  now that its non-empty arm is live (the Phase 2 "revisit if rows grow"
  trigger; plant_crop and harvest_crop are HEAVY_SELF_CMDS members, with honest
  comments that wireRev already covers the successful paths); farmPlanted joined
  HEAVY_SELF_EVENTS (seed spend rides no loot event); the character blob gained
  the warn-only size signal at the one save chokepoint (CHARACTER_BLOB_WARN_BYTES
  131072, rate-limited, attempt-worded); SIM_LAP_PHASES gained the farming lap.
- Persistence hardening landed with the slots' meaning: clamp to real domains,
  deterministic FNV-1a derivation for absent slots (accidental-loss guarantee
  only, honestly worded), clamp-visibility counting for the operator warn, the
  one-rule max(nowMs, 1) re-anchor pinned on both load paths, non-finite clocks
  skip the re-anchor entirely, and the write side floors its anchor at 1.
- DEPLOY.md now carries the mixed-fleet deploy-order and rollback bullet (this
  is the build that makes plots plantable).
- Deferrals with owners: /dev GUI row for farmgrow (Phase 7); nameplate raw-id
  cast label for non-player farming casts (Phase 7, pre-existing class gap
  shared with craft/enchant/salvage/recharge); Hud arms-wiring jsdom pin (no
  Hud harness exists repo-wide, ledgered at sibling parity); BASE_DICT locale
  fill for error.castingPlanting (release-time i18n fill); p99 blob-size gauge
  in the perf heartbeat (maintainer/Phase 3 QA call); an amount-aware arm for
  the deeds gainability guard (the phase that authors a farming deed).
- Offline-host semantics, stated: the offline browser Sim's lockoutNowMs is the
  session-local sim clock, so offline crops need the tab running and a reload
  re-anchors remaining growth; the check-in thesis holds fully on the
  wall-clock server host (the offline-taster ruling, consistent with Phase 2).

Would-be PR body (D22 record):
  Title: feat(professions): farming phase 3, the growth engine
  Summary: plant, grow, and harvest work deterministically end to end. plantCrop
  gates draw-free in a stated order, consumes the seed, and pre-rolls the whole
  growth script in one contiguous two-draw rng block; growth is a pure timer on
  ctx.lockoutNowMs; harvestCrop grants produce (or withered husks) with ZERO rng
  draws by expanding the pre-rolled yield seed; a late harvest equals an on-time
  one. Ships the plant_crop/harvest_crop command chain across both worlds with
  all parity pins, the /dev farmgrow cheat, a warn-only character-blob size
  signal at the save chokepoint, four items with full i18n and census
  registration, the four farm SimEvents rendered through pure-core selectors,
  and the farming_session parity scenario whose golden pins the draw ledger
  (2/4/4/4). Six domain reviews plus the QA gate ran; every blocking finding
  was fixed in-phase (SIM_LAP_PHASES registration, double loot line, fplot
  hot-path gating, DEPLOY.md deploy-order bullet, count-0 event collapse,
  non-finite clock anchor). Maintainer attention requested on: the tuning
  block above, the proficiency-50 ceiling until Phase 5, and the pending item
  art (exact-set ITEM_ART_PENDING).

Phase 3 QA notes (2026-08-08, verdict PASS-WITH-FOLLOWUPS, executed local-only
per D22 on fix/farming-phase-03-qa):
- Pre-audit: fifth v0.36.0 absorb (merge 5741294b44, tip 4d52f151eb, the PR 3161
  client-perf branch, 53 render/game/scripts files); release-merge-audit CLEAN
  (empty intersection with the whole farming footprint, no new routes or db-mock
  sites, no injected-helper drift); world_api_parity + snapshots re-proven green
  on the merged HEAD (499 tests). Phase diff identified cleanly: merge
  d992d31b7f, exactly the five documented commits, 88 files.
- Audit: ten reviewers round one (three packet audits plus seven matrix rows;
  the four custom-agent rows died report-less at their turn limits and were
  redispatched with hard report-first budgets, all four then delivered), plus
  the live lifecycle probe (2/2: facade plant, real ticks past ready-at,
  produce + next-tick XP; live not_ready deny; forced wither pays exactly 2
  husks, no XP) run serially after the read-only fan-out.
- MUTATION PROBES 3/3 KILLED, each with landing proof, nonzero exit, named
  failing tests, and a verified clean revert: (a) extra ctx.rng draw in the
  plant pre-roll block: 4 named reds (the three draw pins plus coverage_c's
  farming_session ledger); (b) survivalRoll clamp dropped on the load path:
  the state suite's clamp arm red; (c) callerLogs stripped from the produce
  grant: all three predicted suites red (the sim flags pin, the silent-loot
  sweep, coverage_c).
- Findings: 0 BLOCKING anywhere. Round one: 8 SHOULD-FIX / 28 NICE-TO-HAVE;
  round two: 1 SHOULD-FIX / 17 NICE-TO-HAVE. Fixed (six commits): the
  grow-now zero-duration destroy-on-load (loader admits duration 0 now,
  deviation (u), with the farmgrow clock floor and the catalog durationMs
  pin); refusal-preserves-stealth/sit/mount arm; two gate-precedence proofs;
  executed fine-grant flag coverage via the all-fine harvest; the
  retired-crop arm executed; FARM_PLANT_CAST_SEC literal pin; the band-span
  binding pin (two independent 25s); deriveHiddenSlots direct pins; four
  distinct procedural item icons plus the A4 distinctness pin (all four had
  collapsed to one scroll-on-leather glyph); the hud fine-pair guard; online
  event-delivery pins for all four farm events plus the bystander negative;
  two self-contradicting HEAVY_SELF comments corrected; farmGrowthStage
  narrowed to the structural minimum with the clock-base contract stated;
  comment accuracy (band-math overclaim, farmDenied field rule); the blob
  ledger re-measured (13,994 settled, pins stand); the droppedRows
  typeof-object guard; the honest farmgrow already-settled reply.
- Declined with reasons (recorded, not fixed): the SURVIVAL_ROLL_MAX top-ulp
  false tamper count (2^-52 per plant, outcome unaffected); the farmDenied
  raw-string echo and the heavy-self refusal amplification (Phase 9 hardening
  notes in state.md); the retired-crop farmWithered semantic (unreachable,
  player-protective); per-arm it() split for the harvest deny arms
  (diagnostics nicety); frozen clocks in two non-ticking round-trip rigs.
- Rulings recorded: TOAST/WAL measurement deferred to Phase 9 as a HARD gate
  (db reviewer's explicit ruling); duration-0 rollback residual accepted
  dev-only with no DEPLOY.md note (migration reviewer, four verified
  grounds); admin exposure verified clean (both R35 route arms field-pick);
  work orders verified N/A (commission modules carry no gathering roster).
- Golden discipline: zero pre-existing goldens moved at any point;
  farming_session md5 29a11d98bda17f9c38bd8e9016df7fc7 unchanged through the
  whole QA round.

### Phase 4

Executed 2026-08-08, local-only per D22: branch fix/farming-phase-04-knobs off
feature/farming-plan, sixth v0.36.0 absorb first (merge da3d1cec4b of tip
1478f9d2ba, PR 2974 Seeker daily-rewards mobile CSS, empty intersection with
farming; release-merge-audit clean, parity and snapshots re-proven on the
merged HEAD). Eight commits: 122dd3de56 farming_view extraction, 80f6169435
items + convertHusks, 5014a395be knob payload + watch fee + tonic arm,
81d3d2ba00 the test battery, e02e8efebd the docs commit, then three
follow-ups the first write of this sentence predated: a628b65a65 the
review-round fixes, 2db9606ef4 the gate-caught grant-site census re-pin,
and 4b9a36fd63 the review and gate notes.

Acceptance criteria (phase-04-knobs.md STEP 5), each with its state:

- [x] compost and growth_tonic exist as plain items with no ItemDef.use,
      consumed only by command, with the def comment stating the choice;
      compost carries buyValue 8 (maintainer-flagged), growth_tonic none
- [x] plantCrop accepts the knob payload; every requested knob is consumed
      server-side at plant time; an unpayable knob denies the whole plant
      with nothing consumed and zero draws (check-then-pay atomicity pinned)
- [x] compost and watch each add 0.10 survival (the shipped [0,1] scale of
      the phase file's "10 points"), capped at exactly 1, with boundary
      arms at and above the cap
- [x] the watch fee predicate is any farming produce of the crop's tier or
      below (fine twins included, mixed kinds allowed, in the fixed order:
      lowest tier first, base before fine within a crop); per-tier amounts
      2/3/4/6 proposed and maintainer-flagged
- [x] the fee consumption pin proves the exact produce leaves and nothing
      else moves (plus a mixed fixed-order pin)
- [x] tonic consumed at plant arms a yield bonus applied at harvest against
      the stored seed's expansion, with no added draw (one further read of
      the SAME mulberry32 stream; untoniced path bit-identical, pinned)
- [x] the draw contract is restated in the farming.ts banner and re-pinned
      under all eight knob combinations with identical counts
- [x] convertHusks on IWorldFarming, both worlds, parity pins 306 to 307
      members and 227 to 228 methods; N = 2 proposed and maintainer-flagged;
      the permissive gate comment names Phase 9 with no TODO marker
- [x] all four deny arms tested: no_compost, no_fee_produce, no_tonic (the
      atomicity arm), and the already-knobbed bed_taken replant
- [x] every denial rides a stable farmDenied reason (four new leaves with
      five non-Latin fills each); tests/localization_fixes.test.ts green
- [x] same-seed determinism pinned, knobless AND fully knobbed sessions
- [x] the farming_session golden untouched (md5 29a11d98bda17f9c38bd8e9016df7fc7
      before and after; the scenario was deliberately NOT extended)
- [x] STEP 3 validation green; node scripts/gate_select.mjs pass recorded in
      the Phase 4 notes below
- [x] progress.md and state.md ledgers updated

Notes (the would-be PR body per D22):

PROPOSED CONSTANTS AWAITING THE MAINTAINER, all landed provisional and
flagged at their definitions:
- compost: sellValue 2, buyValue 8 (the 4x convention; stocked in Phase 9)
- growth_tonic: sellValue 6, no buyValue (never vendor-stocked, D9)
- FARM_HUSKS_PER_COMPOST = 2: one failed crop (2 husks) converts to exactly
  one compost, value-neutral at the vendor (2x1 copper husks to 1x2 compost)
- FARM_WATCH_FEE_BY_TIER = 2/3/4/6 produce for tiers 1 to 4 (below the
  3-pick harvest floor at tier 1, so the watch is never a net produce loss
  for a fresh farmer)
- FARM_TONIC_BONUS_CHANCE = 0.5, FARM_TONIC_BONUS_PICKS = 2 (base grade):
  expected value one extra pick per tonic, "mildly larger" against the
  floor of 3

DESIGN POINTS WORTH REVIEW: the knob wire fields ride plant_crop only when
literally true (a plain plant's frame stays byte-identical to the pre-knob
protocol; absent and false are the same protocol statement, and the dispatch
refuses present-but-not-boolean per field); every knob gate is a CHECK and
all payments spend together after the last gate, beside the seed, above the
unchanged two-draw pre-roll (the atomicity arm pins compost surviving a
later tonic refusal); the tonic arm reads exactly one further value of the
stored seed's mulberry32 stream whether or not it wins, so stream position
depends only on inputs; convertHusks converts EVERY complete batch per call
and its location gate is deliberately permissive until the Phase 9 farmer
NPCs land the range arm (comment at the action names the phase).

CENSUS RESTRUCTURE (state.md deviation (w)): the affinity census's
CONSUMER_DEFERRED_MATERIALS list is replaced by a structural farming
exemption derived from FARM_MATERIAL_ITEM_IDS, because every farming
material now has a COMMAND consumer by construction (seeds via plant_crop,
produce via the watch fee, husks via convert_husks, supplies via the knobs)
and the old list's self-clearing arm keyed on recipe consumers it could
never see; the anti-abuse growth gate moved to the exact-set pin on
FARM_MATERIAL_ITEM_IDS in tests/material_taxonomy.test.ts.

UI: the farming_view extraction fired (the state.md rule-of-three trigger):
farmDeniedLineKey plus the four farm grant-line selectors moved into the new
src/ui/farming_view.ts pure core (UI_PURE_CORES), moves not re-exports, with
their test blocks relocated to tests/farming_view.test.ts; the
farmHusksConverted line and the four new deny leaves land there.

VALIDATION: tsc clean; all targeted suites green (professions_farming 90,
farm_watch_fee 9, farming_view, farming_command_chain_online, world_api
parity, command_schema/facets, item_icons, material taxonomy x3, snapshots,
env_protocol, bandwidth, localization_fixes, parity with zero golden
movement); ci:changed exit 0 (warnings only, pre-existing debt); five
scripted mutations all KILLED with named reds (third pre-roll draw: 6 reds
incl. the parity golden; spend-at-gate: 2; dropped stored compost flag: 6;
tonic-never-wins: 1; fee order flipped: 5). No screenshots: the phase ships
no visual surface (the dormant Live-surface note holds; wiki:content regen
was a byte-identical no-op).

REVIEW ROUND (Workflow fan-out, 4/4 delivered): architecture-reviewer
PASS-WITH-FOLLOWUPS, cross-platform-sync BLOCK, frontend-seam-reviewer
BLOCK, qa-checklist PASS-WITH-FOLLOWUPS. The two BLOCKs shared one root
cause, fixed in a628b65a65: the two item names shipped without their five
non-Latin fills (tests/i18n_completeness.test.ts red with exactly 10 leaks,
a suite the targeted validation list had not named). The same commit takes
the architecture reviewer's real behavioral find: the loop-relative tonic
read broke player-favorable monotonicity (a skill-up moved the bonus roll
and flipped wins to losses about 5.8k times per million adjacent skill
steps); the bonus roll now expands from its own seed-anchored mulberry32
position, pinned by a 200-seed monotonicity sweep. Also landed: the
husk-trade line splices both items as tokens, the watch-fee dedupe guard
plus uniqueness pin, the NaN-honest watchFeeAmount, comment corrections
(the stale always-false knob banner, the cheapest-first overstatement, the
stream-position claim), the tonic-forfeited-on-wither note at the resolver,
and the knobbed save-load-harvest arm. Deliberate no-action calls, left for
the QA session to re-judge: convert_husks refusal spam costs one heavy
re-serialize per refusal (the plant_crop precedent, unreachable until a
husk faucet exists; the Phase 9 rate-limiter note already covers the
family); a hand-edited OFFLINE save can forge knob flags for free survival
(offline-only, same class as the accepted survivalRoll analysis); deviation
(w)'s structural exemption means future FARM_MATERIAL_ITEM_IDS additions
auto-exempt from the affinity census (the taxonomy exact-set pin is the
gate; flagged for a maintainer read before Phase 5 adds seven crops); the
Materials chip/market filter now classify two dormant items (unreachable:
no faucet mints either).

GATE: node scripts/gate_select.mjs run twice. Run one FAILED at the
full-suite fallback's tests/professions_silent_loot.test.ts grant-site
census (farming.ts 4 to 5: the convertHusks compost grant; the same
fallback-only census class Phase 2 hit), fixed as its own commit. Run two:
"[gate:select] PASS: all 8 steps green (vitest workers: 12)", zero FAIL
lines in the log. The shell exit code of run one was 0 while the log said
FAIL: the log-marker rule is the arbiter, re-confirmed.

Phase 4 QA (2026-08-08), the audit record. VERDICT: PASS-WITH-FOLLOWUPS.

Pre-audit: QA branch fix/farming-phase-04-qa off feature/farming-plan
(audit-start 4c1e92dc69); seventh v0.36.0 absorb merged FIRST (merge
1c81459323 of tip 66c2340242: PR 3162 per-copy item addressing plus PR
3164 loadout gear sets, 65 files). release-merge-audit clean: 38 overlaps
(30 generated i18n, regen byte-identical), farming wiring intact in all
eight real overlap files, no db-mock trap in the six new release suites,
no new routes or commands, tsc clean, parity and snapshots 500/500 on the
merged HEAD (release never touched the parity pins, so 307 is genuine:
the identical-bump trap did not fire).

Audit shape: 19 live probe tests (advanceable injected clock; all EIGHT
knob combinations on two seeds driven plant-grow-harvest with real ticks:
plant exactly 2 draws, expiry tick driver 0, harvest 0; stored flags
mirror the combos; exact consumption; fee-bootstrap deny atomic, 0 draws,
localized leaf, never a soft-lock; sub-batch husk deny clean); an 8-lane
reviewer fan-out (two custom lanes died report-less and were redispatched
on the fixed tree: cross-platform-sync PASS, privacy-security-review
PASS); EIGHT mutation checks: 5 killed on the phase tree as shipped, 3
SURVIVED and forced test repairs, then all 3 re-proven killed:
- M8 (the one BLOCKING, test-coverage lane): the two end-to-end tonic
  arms ran on harness seed 41, a tonic LOSER, so disabling the
  harvest-side flag read left every suite green. Fixed in 62ea9e5cad:
  both arms moved to the probed winner TONIC_WIN_SEED = 2 with
  non-vacuity guards; the mutant now reds both arms by name.
- M5 (SHOULD-FIX): no arm pinned the fee legs surviving a later tonic
  refusal; a spend-at-gate mutant survived 117 tests. Fixed in
  62ea9e5cad: the fee twin of the compost atomicity arm.
- M3 (SHOULD-FIX): the fee-module ordering, exclusion, and dedupe pins
  were constant-true against the one-crop catalog (deleting the Set left
  102 tests green). Fixed in 182d2b2f4f: injectable catalog parameter, a
  synthetic multi-tier ladder with a deliberate base/fine id collision,
  a planner-level double-count arm, and the live seed/produce
  disjointness pin.
Killed on the phase tree as shipped: the loop-relative tonic re-anchor
(the monotonicity sweep), the dropped survival cap clamp (both boundary
arms), the deny-precedence flip (order proofs), the dropped wire guard
(per-field refusal), and single-batch convertHusks (the
every-complete-batch arm).

Also landed (c8acdf1a0d): the fplot knob-flag broadcast pin with the
nine-key exhaustive row set; the CAP-plus-BONUS pick ceiling pin plus
the constant's comment; the deny-prose rename-drift pin and the
x{husks} plural-floor pin in farming_view; the mixed-fee test retitled
off "cheapest-first"; the dead four-symbol fee re-export block dropped.
Docs (d944051422): watch-fee tiers and tonic tuning added to the
state.md proposed-constants ledger; the seed-anchored tonic contract
ledgered where the next session reads first; the commit enumeration
corrected to eight; key planned files refined; the farming_view trigger
marked executed (four selectors); deviation (z) swept into both phase
files. Absorb-side format debt fixed scoped (8f3f1bdc86: three PR-3164
files; the only ci:changed red, now exit 0).

Deviation (z): parity-scenario knob coverage deferred to Phase 5. The
farming_session golden stayed untouched through this QA (md5
29a11d98bda17f9c38bd8e9016df7fc7, its stopping rule); the single-host
pins and live probes hold the knob paths' draw contract until the Phase
5 scenario extension re-records deliberately.

Deliberate no-action calls re-judged, ALL UPHELD: the refusal-spam heavy
re-serialize (bounded by the command lane; the Phase 9 note stands),
offline forged knob flags (offline-only, the survivalRoll-analysis
class), the deviation (w) auto-exemption (the exact-set taxonomy pin is
the gate; the maintainer read before Phase 5 is still owed), and the
Materials chip classifying two dormant faucet-free items. Accepted
as-is: FARM_SUPPLY_ITEM_IDS stays exported for the Phase 9 vendor stock;
the growth_tonic sparkle overlay is noted for the art batch; the pending
Latin rows ride to the release fill; the knob deny lines stay prose with
the rename-drift pin as the tie; the junk-knob silent frame drop is the
deliberate id-guard convention (pinned).

Counts: 1 BLOCKING found and fixed; 6 SHOULD-FIX (3 fixed in code, 2
fixed in docs, 1 deferred as deviation (z)); 20 NICE-TO-HAVE (7 adopted,
13 upheld or ledgered as deliberate). QA commits: 62ea9e5cad,
182d2b2f4f, c8acdf1a0d, d944051422, 8f3f1bdc86, plus this record.

QA GATE: node scripts/gate_select.mjs run once on the QA tip
(BROWSER_PATH exported): the planner fell back to the full suite (broad
change, 179 changed paths against the release base), and the log's final
marker is "[gate:select] PASS: all 8 steps green (vitest workers: 12)"
with zero FAIL lines and zero failed suites; neither known contention
flake fired.

### Phase 5

Acceptance list (from phase-05-crops-and-tools.md STEP 5, states as landed;
the EXECUTION AMENDMENTS block there and state.md letters (aa)-(af) amend
where noted):
- [x] all eight locked crop ids exist with seed, produce, and fine_ twin
      defs; produce kind junk and market-listable; sellValue per the
      materials convention; fine twins per the precedent EXACTLY (sell 2x
      base sell, buyValue 4x the fine's OWN sell; the phase file's
      "four-times buyValue" wording reads against the fine's own sell)
- [x] AMENDED by deviation (o): NO MATERIAL_GRADES rows (the table stays the
      nine node yields); procedural icons and English name rows exist for
      every new item (24 crop items + 4 hoes, pairwise-distinct recipes,
      ITEM_ART_PENDING 31); display names flagged for the maintainer lore
      pass, IP-audited per D17 at authoring time (audit prose in the batch
      spec, summarized in Notes)
- [x] tier 1/2 seeds carry positive buyValue (vale_wheat_seed gained buy 4
      in-phase) and appear on NO vendorItems row; tier 3/4 seeds carry no
      vendor pricing and flow from harvest seed-back (rare event joins at
      Phase 10 per D11)
- [x] brook_carrot produce buyValue 16 (4x sell, D9), the only priced
      produce; pinned both directions in the rollout arms
- [x] the crop duration and tier table lives in farm_crops.ts with a
      maintainer-flag block on every tuning constant
- [x] hoe ladder: four rungs at tiers 1-4, AMENDED by (ad): recipes live in
      the separate HOE_RECIPES list at the toolworks (rod precedent; rungs
      2-4 craft-only), buyValue on rung 1 only (20), top rung unpriced and
      craftable per the R23 arm (verified conscripted and green)
- [x] AMENDED by (ac): slotToolEffectRefused admits farming; the TWO live
      effects slot AND act at harvest draw-free (pinned non-vacuously);
      quickening_charm stays refused by the kind arm everywhere; prompt-mode
      farming mints refused per (af)
- [x] seed-back draws at harvest action time for tier 3/4 on BOTH outcomes
      per (ae) (exactly one contiguous draw; rates 0.08/0.40 and 0.06/0.35
      economy-flagged); the contract restated in the banner and re-pinned
      clause by clause
- [x] the farming_session golden re-record is its own isolated commit
      (564ad5382a; md5 29a11d98bda17f9c38bd8e9016df7fc7 to
      bf00c277b89e142446550f00c1035696) and carries the deviation (z) beats
- [x] FARM_PATCHES bed counts CONFIRMED at 4/5/6/8 (23 beds; counts were
      already final, no provisional marker existed); farm_patch_placement
      green
- [x] farming rollout arms green: the new FARMING_ZONE_TIERS-keyed describe
      (8 arms with paired counter-examples) plus the (aa) narrowing of the
      generic hub arm; the dormant hub-stocking arm pins no-vendor until
      Phase 9
- [x] recipe_economy green (HOE_RECIPES joins the counterfactual set and the
      trainer sums); wiki regenerated, guide freshness green, both stale
      guide keys reworded count-free with five fresh non-Latin fills each
- [x] gate: node scripts/gate_select.mjs PASS all 8 steps (run two; run one's
      full-suite fallback caught the delve-shop conscription and the farmgrow
      hoe grant, healed in 1e63df0dfa; zero FAIL lines, no flakes on run two)
- [x] progress.md and state.md ledgers updated

Notes (the would-be PR body per D22):

Phase 5 lands the whole farming content surface: the eight-crop ladder
(vale_wheat and brook_carrot at tier 1, marsh_rice and bog_beet at 2,
highland_barley and frost_gourd at 3, gilded_sunmelon and evergarden_greens
at 4, all D11-locked ids), the four-rung hoe ladder (garden 20c vendor
entry dormant until Phase 9, bronze, skysilver, osmium; HOE_RECIPES at the
toolworks consuming the fine twin one tier below plus the rung below), the
live step-12 plant gate (wield ladder 0/40/70/85 over the crop thresholds,
deviation (ab)), the two live tool effects acting at harvest (deviation
(ac): quantity to bonus picks, quality to a fine-chance bump, draw-free,
prompt-mode mints refused per (af)), and the tier 3/4 seed-back faucet (one
action-time draw per harvest on both outcomes, deviation (ae)). The
farming_session golden re-recorded once, isolated, with the deviation (z)
beats (knobbed plant, toniced harvest on a probed winner, husk conversion,
tier-3 seed-back), ledger 4 to 9 draws.

Execution: eighth v0.36.0 absorb first (5819c005a7, release-merge-audit
clean, count pins reconciled by suite: commands 196/209, IWorld 308, delta
keys 84). Content authored by a 12-agent Workflow (7 crop authors + hoe
author, 3-lane adversarial verify, reconciler), applied by four sequential
writer lanes, reviewed by architecture + frontend-seam + cross-platform +
qa-checklist with one fix round (notably: the SECOND self-clearing tripwire
in gather_tool_tooltip.test.ts that the writers' suite lists missed, the
sinkless requiresTool.farming key, and the 13 stale Latin howToSlot fills
that no gate tier could ever catch).

MAINTAINER FLAGS (all carry TUNING/PROVISIONAL comments in code):
- Durations: carrot 35m, rice 130m, beet 135m (5-minute sibling gap
  advisory: barely visible on 2h timers, tighten or spread at will), barley
  4h, gourd 4.5h, sunmelon 10h, greens 10.5h.
- Seed-back rates: tier 3 two/one bands 0.08/0.40 (E 0.48 seeds per
  harvest), tier 4 0.06/0.35 (E 0.41). Economy-sensitive: the tier 3/4 seed
  market has no other faucet until Phase 10.
- Hoe prices: 4/20 (rung 1), 10, 25, 60 sell-only above; the effect
  fine-chance bump constant; display names for the lore pass (Skysilver and
  Osmium reuse the shipped pick coinages at compressed tiers 3/4 since the
  hoe ladder is four rungs to the picks' five).
- The deviation (w) structural affinity exemption now covers 27 materials
  (was 6): the maintainer read on that exemption is STILL OWED (standing
  since Phase 4).
- Blob ceiling band WIDENED deliberately: 14336 to 15360 while the settled
  measurement is 14218 (the old bound left 118 bytes, under one bed site of
  growth, the doctrine's forced-mint case); the next re-mint should know the
  upper band is now roughly 1142 bytes.
- Art debt: ITEM_ART_PENDING sits at 31 farming ids for the art phase; the
  four hoe icons share a two-piece geometry that may read alike at 32px
  (frontend reviewer note), eyeball at the art pass.
- Latin-overlay staleness for the two reworded guide keys is the standing
  release-time fill item; the howToSlot reword is ALREADY corrected in all
  18 overlays (in-phase, because a stale fill there stated wrong slotting
  rules and is invisible to both gate tiers).
- Phase 9 go-live checklist gains: stock the vendors AND flip the (aa) hub
  exclusion AND the dormant arm together; give garden_hoe its vendor
  counter (the wiki truthfully shows price-no-vendor today); consider the
  harvest confirm channel for prompt-mode effects (Phase 7/8 UI).

QA-session pointers: the wield-vs-crop ladder layering (ab) means gate 7
'skill' and gate 12 'tool' are BOTH reachable per tier; the effect arms'
vacuity guards ride probed seeds documented in-file; coverage_c pins the
recorded seed-back band literal (1) that moves only with a deliberate
re-record; the online boundary suite owns the seedBackCount and 'tool'
frame claims.

Review verdicts: architecture PASS-WITH-FOLLOWUPS (all followups applied or
ledgered), frontend-seam BLOCKING (fixed in 99e3c39ccd), cross-platform
PASS-WITH-FOLLOWUPS (all applied), qa-checklist: see below.
- QA-checklist verdict: READY on the code, zero BLOCKING (delivered via the
  Agent-tool redispatch after the Workflow lane died report-less, the
  standing recovery). Its two documentation closes (this progress.md entry,
  the (af) line in the phase file's amendments block) are done; its two
  PR-body notes (the deliberately widened blob band, the 13 Latin overlay
  edits with their justification) are recorded above; its VERIFY item (run
  gate_select on the final HEAD) is the gate line below.
- Gate: BROWSER_PATH gate_select run one FAIL at the full-suite fallback
  with two named reds outside every targeted list (tests/delve_shop.test.ts
  conscripting osmium_hoe into the Marks-route walk; tests/dev_commands
  .test.ts farmgrow planting through the live gate hoe-less), both healed
  test-first in 1e63df0dfa; run two "[gate:select] PASS: all 8 steps green",
  zero FAIL lines, no contention flakes. The gate log is the arbiter per
  D22; logs at the session scratchpad gate_phase5*.log.

#### Phase 5 QA (2026-08-09)

Verdict: PASS-WITH-FOLLOWUPS. Zero BLOCKING against the shipped behavior;
the two BLOCKING findings were COVERAGE holes (unpinned surfaces), both
closed test-only. The draw contract, the golden (md5
bf00c277b89e142446550f00c1035696, byte-identical throughout), and every
census held.

Pre-audit: ninth v0.36.0 absorb 18c6bf65f3 (tip 6e1ead1fea, PRs 3217 and
3219, gfx-perf GPU queue and entry prewarm, render-only; release-merge-audit
clean, EMPTY farming intersection, no lockfile change; parity + snapshots
re-proven on the merged HEAD). Audit: 7-lane Workflow fan-out (5 delivered;
the test-coverage lane died on an API stall and qa-checklist finished
report-less, both recovered via Agent-tool redispatch with full reports),
plus orchestrator-side verification (spine suites, 14 census suites, the
coverage_c ledger literals, golden isolation) and a live-probe re-proof of
the draw contract on fresh seeds by the correctness lane. Mutation battery
5 mutants: 4 killed as shipped with named reds, 1 SURVIVED (the R37 hub
exclusion widened to mining stayed green) and is now pinned and re-proven
killed.

Findings and fixes (7 commits on fix/farming-phase-05-qa):
- 2 BLOCKING coverage holes: the R47 ratchet line and the R42 spend
  predicate's false branch were deletable/invertible with every suite
  green; closed with the carried-osmium latch arm and the inverted-probe
  kept-charge arm (572ef8b63c).
- Crossed draw-contract arms (tier-3 x armed cache x stored tonic,
  survived AND withered), a run-twice determinism leg over the seed-back
  path, the fine-chance literal pin, artisans_eye mint-reachability, the
  (ab) traversability guard (wield gate <= previous tier's teaching
  ceiling, plus the ladder literals), the online tool-deny cropId pin, the
  hub exclusion-set pins, the delve-shop no-Marks tripwire (572ef8b63c,
  2fc93b828f with the four hoe quality literals).
- feat: farmHarvested carries effectDepleted, the gatherResult last-charge
  signal (deviation (ag)); the withered seedBackCount spread gained the
  grant's own crop guard (922bab98a2).
- fix: the Ask-each-use toggle suppressed on the farming row through the
  mint's own promptSlotRefused predicate (deviation (ah)); ticking it used
  to erase the whole actions row until reopen (da8f225cbf).
- fix: frost_gourd_seed re-palettes to an ice sack (it was pixel-close to
  marsh_rice_seed at 32px behind two blue radials) with the targeted A4b
  pair pin (6bccc25761).
- docs: comment-truth sweep across items.ts, recipes.ts, farming.ts, the
  facet and online mirrors (both still called the hoe gate deferred), and
  the admin restore route's rotting pair-count numerals (73b8fd7746).
- Screenshots: docs/screenshots/farming-phase-05 bag-grid capture of the
  31 stand-in icons, LOW preset (the program's Phase 2-4 capture drift is
  recorded in state.md; Phase 7 re-anchors the obligation).

Deferrals, each with an owner: ja_JP guide fill names the hoe in English
(release-time locale pass, check zh/ko/ru for the pattern); the hud.ts
seed-back block duplication stays at two copies (rule of three; extract on
a third seed-back surface); the two raw grant-green hex literals ride the
eventual log-color tokenization sweep; the normalize load-side prompt arm
is a RECORDED no-action (state.md addenda); the fine-twin buyValue
doctrine intersection is maintainer-flagged; tier-3/4 gate-precedence arms
declined (the gate order is tier-generic and pinned at tier 2); crop price
literal anchors declined (the relational form IS the stated convention).

Reviewer verdicts: correctness PASS-WITH-FOLLOWUPS (live probes 5/5 on
fresh seeds, IP audit clean, whole-content vendor scan clean), dead-code
PASS-WITH-FOLLOWUPS, architecture PASS-WITH-FOLLOWUPS (seed-back
contiguity re-verified on every path), cross-platform PASS-WITH-FOLLOWUPS
(both widened wire surfaces ride the relay verbatim), frontend-seam
PASS-WITH-FOLLOWUPS (build fixes verified holding), test-coverage
BLOCKING (both closed), qa-checklist READY-WITH-FOLLOWUPS (its at-threshold
wield concern resolved by the (ab) ledger: teaching ceilings clear every
wield gate, now pinned; its ratchet-scan concern resolved against the node
precedent, recorded).

### Phase 6 (economy hooks, 2026-08-09, local-only per D22)

Acceptance checklist (phase file STEP 5):
- [x] one or two plain dishes per crop tier exist, consuming farm produce, foodHp
      only with no buff machinery, recipe rows with laddered skillReq beside the
      cooking ladder budget conventions; values proposed and maintainer-flagged
      (eight dishes, two per tier, rungs 0/0/25/25/50/50/50/50; every
      foodHp/sellValue pair reuses a shipped curve point; the exact key-set pin
      closes the plain-food def shape until Phase 11 re-pins it)
- [x] the alchemy growth_tonic recipe exists with herb inputs per D7 and conforms
      to the alchemy budget conventions (silverleaf x2 + glass_vial x1, skillReq 0,
      output 6 under input 20)
- [x] the consumer rule is closed: every Phase 5 produce and the withered husks
      have at least one recipe or command consumer, verified and pinned; the
      Phase 6 consumer notes in the rollout arms are replaced by the real
      consumers (the closure arm now derives recipe consumers from merged
      ALL_RECIPES; the five-twin deferred literal is deleted and each twin pinned
      to its named dish)
- [x] no new recipe is craftable from vendor goods alone: every one has at least
      one reagent with no vendor faucet, verified and pinned (both directions:
      no-stock and no-buyValue, plus the symmetric no-NPC-stocks-a-dish arm)
- [x] English recipe and item-name i18n rows exist for every new dish and the
      tonic recipe; tests/localization_fixes.test.ts is green (eight item-name
      rows plus materialHint.growthTonic, each with the five non-Latin fills;
      recipes have no name keys by design: a recipe displays its result item's
      name)
- [x] tests/recipe_economy.test.ts and the training/ladder suites are green
- [x] the recipe economy invariant holds: nothing vendors above its cheapest
      achievable inputs
- [x] the wiki regenerated and tests/guide.test.ts freshness is green
- [x] the STEP 3 validation list is green and node scripts/gate_select.mjs passes
      apart from the standing armory browser exception (gate record below)
- [x] docs/prd/masterwrought/farming/progress.md and docs/prd/masterwrought/farming/state.md ledgers are updated

Notes (the would-be PR body, D22):
- Content: FARM_RECIPES, a nine-row trainer-taught sibling list beside
  HOE_RECIPES (the ladder is closed and count-pinned): vale_hearth_loaf 90/6,
  eastbrook_root_pottage 117/12, fenbridge_rice_bowl 243/25, fenbridge_beet_braise
  432/40, highwatch_barley_bannock 552/60, highwatch_gourd_soup 552/75,
  evergarden_sunmelon_tart 980/150, evergarden_harvest_platter 980/150, plus
  recipe_growth_tonic (alchemy). All values maintainer-flagged at their rows.
- MAINTAINER FLAGS gathered here: the eight foodHp/sellValue assignments (each
  reuses a shipped curve point, 980 ceiling respected); dish reagent counts; the
  tonic at skillReq 0 with silverleaf x2 (rationale at the row); deviation (aj)
  trainability before go-live (free at rung 0 per the settled R8 curve); the
  tier-3 dishes being strictly dominated at rung 50 by the tier-4 pair (three
  rungs for four tiers; the QA review asks for an explicit balance ruling);
  whether fine_marsh_rice / fine_highland_barley should also gain dish consumers
  (hoe-reagent-only today; the Phase 5 deferred literal named exactly five
  twins); and the deviation (al) guard extensions (the item-art audit's
  ITEM_ART_PENDING exemption and the portrait manifest's fingerprint-only
  refresh path), which relax two release art-program seals in a bounded,
  both-directions-policed way and deserve their own sign-off.
- Deviations this phase: (ai) tonic craftable from wild herbs pre-go-live (D7
  wins over the phase file's blanket dormancy note), (aj) all nine rows
  trainable pre-go-live, (ak) the crafted-tooltip partition's one pinned
  exception for the junk tonic, (al) the two release art-program collisions
  healed in-branch with an absorb-checklist addition. All swept into state.md,
  the phase file, and the QA twin.
- Reviews: architecture-reviewer 0 BLOCKING 1 SHOULD-FIX (trainability, ruled
  and pinned as (aj)); frontend-seam-reviewer 0 BLOCKING 2 SHOULD-FIX (zh
  fullwidth commas fixed, the A4c pairwise prim-list pin added);
  qa-checklist READY with 1 BLOCKING (the key-set absence pin, landed) and its
  should-fixes landed (craft-through arm, literal count pin, dish-stock arm,
  curve-point live backing). Release-merge-audit on the tenth absorb: 4 lanes
  CLEAN.
- Known repo-wide noise, not this phase: tests/crafting_window_tabs.test.ts
  prints ~100 ECONNREFUSED stacks to stderr WHILE PASSING (happy-dom fetching
  icon urls; none are dish ids since pending-art ids resolve procedurally).
- QA-session pointers: the farming castingReadout arm ('You are planting.') has
  no pin (pre-existing, surfaced by the absorb audit); the ru Eastbrook stem
  split and the five-locale "frost gourd" qualifier on Highwatch Gourd Soup are
  release-time locale-pass notes; A4's structural hole (pending-vs-committed
  icon collisions are unswept) predates this phase; weaponIconUrl now resolves
  ANY ITEM_WEAPON_VARIANTS key ahead of the pending-art guard (release change),
  so a hoe gaining a held model must not join weapon_variants without art.

Gate record: three runs. Run 1 (mid-review tree) FAILED at the full-suite
fallback with the three release art-program collisions (crafted-tooltip
partition, item-art audit missing-art sweep, portrait manifest staleness),
healed as deviations (ak)/(al). Run 2 overlapped the QA-round edits and
FAILED on the mid-edit artifacts plus the two second-order evidence pins
(item_art_consistency verdict digests, placeholder_art_completion manifest
row), healed in c6ce5c4d0b. Run 3 on the frozen tree at c6ce5c4d0b:
"[gate:select] PASS: all 8 steps green (vitest workers: 12)", full-suite
fallback 33892 passed / 0 failed / 2 expected-fail / 107 skipped, browser
step green (no armory exception tripped this run), farming_session golden
md5 bf00c277b89e142446550f00c1035696 unchanged, tree clean. Lesson
re-recorded: never edit the tree while a gate runs; the log markers are the
only verdict (run 2's shell exit was 0 while the log said FAIL).

### Phase 6b (release sync)
DONE 2026-08-13 (docs/prd/masterwrought/farming/phase-06b-release-sync.md; ran BEFORE Phase 6
QA as its own mid-phase). Absorbed origin/release/v0.38.0 at 952c183fc3, the
ELEVENTH absorb and the first big-jump sync: 1453 commits, 2376 files, a
117-file intersection with the 223-file farming footprint. Branch
fix/farming-sync-v0.38.0 off d15921bed6, merged back --no-ff and deleted.
Everything from d15921bed6 forward is this phase's own audited scope and is
EXCLUDED from the Phase 6 QA diff (which audits merge 1a26881d0b).

Notes (the phase report):
- HEADLINE SYSTEMS ABSORBED: the Reliquary (new IWorld facet, 9 members, its
  own RouteDef, reliq delta key, sampled player block), the owned-classes
  overhaul (warlock pet command pair, priest markers, consecrations), the
  Thornhollow Fields battleground (+bg chat channel, aborder/app delta
  keys), the map marker overhaul (PR 3369, seven new map_marker_* cores),
  the player item lock (#3042), civic service anchors, the three.js audit
  batch (three stays 0.165.0, KTX2 sibling loader), and the monolith
  line-count ratchet (tests/monolith_budget.test.ts).
- COLLISIONS HEALED, one commit each: absorb merge 2c26b6db7b (16 conflicts
  resolved by doctrine: both-sides-appended unions for sim.ts imports, the
  IWorld barrel and COMMAND_NAMES; pin files re-recorded from suite runs;
  pending.ts regen-resolved; the portrait manifest and audit verdict
  re-minted through their own CLIs per the (al) checklist, registries
  re-pointed); golden re-mint ddb718b95e (deviation (am): the release's
  sampled reliquary field, rng stream proven byte-identical, machine
  classified 11 blocks + 18 paired state digests); monolith extractions
  7dbb21b605 (deviation (an): src/ui/farm_event_feedback.ts +
  server/farming_commands.ts, ratchet green, snapshots scrape gained the
  second source); item-lock wiring a4c4c33598 (deviation (ao): all farming
  spends lock-aware per the release contract, 7 arms, 2 mutations killed).
- BASELINES BEFORE AND AFTER: commands 196/209 to 201/214; IWorld 308
  (79/229) to 327 (88/239); delta keys 84 to 87; facets 32-era pin to 34
  (the silent-33 trap made visible and corrected); farming-only baselines
  all HELD (FARM_MATERIAL_ITEM_IDS 27, ITEM_ART_PENDING 39, silent-loot
  sites 6, blob pins); golden md5 bf00c277 to f017045f (the (am) re-mint).
  The predicted lockfile seal re-mint was NOT needed: the merge took the
  release's lockfile byte-identical and the release delta carried its own
  coherent seals (all 8 suites verified green).
- AUDIT: 4-lane release-merge-audit Workflow, 4/4 delivered (overlap reads
  hash-verified all 27 both-sides files lossless in both directions; new
  surfaces/injection/db-mocks clean; premise drift and headline-systems
  lanes produced the heals and corrections above). ci:changed rc 0 after
  the origin/main refetch.
- PREMISES CORRECTED (in the phase files themselves): phase-07 (three.js
  audit conventions, re-read src/render/CLAUDE.md before GLB work),
  phase-08 (map-pin recipe re-pointed at the marker overhaul family),
  phase-09 (quest marker tooltips now via map_marker_tooltip_adapter),
  phase-13 (the Reliquary same-change obligation joined the sweep), plus
  the monolith extraction-first warning in state.md deviation (an) for
  every phase touching a ratcheted coordinator.
- REVIEWS (all three delivered full reports, 0 BLOCKING anywhere):
  cross-platform-sync SIGNED OFF (proved the extraction changed no wire
  bytes, the lock heal keeps freshness through three independent paths,
  and all five IWorldFarming members reconcile on the 327-member pin);
  qa-checklist READY (both SHOULD-FIX items folded in: the farm_watch_fee
  COUNT SEMANTICS comment reworded for lock-awareness, the
  ceilings-not-lowered rationale ledgered in (an)); architecture-reviewer
  0 BLOCKING with one SHOULD-FIX adopted as the (ao) completion: the
  farmDenied 'locked' reason (wire-union append, five deny-site splits,
  the catalog leaf with its five M16 fills, both test polarities). The
  remaining reviewer notes (stale game.ts HEAVY_SELF comment chain, the
  fee-leg id-space aliasing comment, the hudSrc rename) were all fixed in
  the same round; the optional-chained quest hook call stays as the
  deliberate crafting.ts-idiom match.

### Phase 6 QA (2026-08-13, PASS-WITH-FOLLOWUPS, local-only per D22)

Audit of merge 1a26881d0b (the Phase 6 economy hooks diff, 61 files,
+3205/-571), run on branch fix/farming-phase-06-qa.

- PRE-FLIGHT, the TWELFTH absorb: release/v0.38.0 had moved to b08d79ef91
  (38 commits, 120 files, 5-file farming intersection, below the D22
  mid-phase bar), absorbed as merge 1a5d6fd5b4. Both conflicts were the
  art evidence pair, resolved per the (al) checklist (fingerprint-only
  portrait re-mint c447fe88, registry re-pointed, item audit verify
  green); no lockfile move, seal runbook silent. The release lowered the
  renderer.ts ceiling to EXACTLY its current size (13708/13708, zero
  headroom; phase-07 premise amended in its file). Release-merge-audit
  lane CLEAN on all five hazard axes; gate_select semantics unchanged.
- AUDIT SHAPE: one Workflow, a context loader then 8 parallel read-only
  lanes (correctness, test-coverage, dead-code, architecture-reviewer,
  frontend-seam-reviewer, content-obligations-reviewer, qa-checklist,
  release-merge-audit), budget + report-first lines baked in; 9/9
  delivered first try, ZERO report-less deaths (first fan-out of the
  program with no recovery round). cross-platform-sync correctly skipped
  (no wire, event, or matcher surface in the diff).
- VERDICT INPUTS: 0 BLOCKING anywhere. Acceptance checklist re-verified
  against the real code by independent walks (vendor-goods-alone held on
  every stock surface; all 25 reagent/output ids resolve; consumer rule
  closed; dishes exactly the six-key plain-food shape; sim side provably
  content-only, parity goldens untouched).
- FIXED (3 commits): test(economy) 22b0ef02cd hardened the pin battery:
  the dormancy arms' stocked universe now unions DELVE_SHOPS and
  HEROIC_VENDOR_STOCK (the Marks-route blind spot three lanes converged
  on), reagent ids must resolve before the priceless filter reads them,
  a raw-sellValue no-mint bound covers all nine rows (the braise's
  exactly-break-even shape is executable now; soup margin 2, bannock 4),
  the tonic brews END TO END through real ticks with a short-reagent
  refusal (the one recipe with a live faucet had no executed craft; the
  cast completes through the casting_lifecycle tick slot, and the
  deterministic alchemy skill grant is pinned), the (aj) fee pin gained
  the rung-25 row (2500), and a stay-in-step arm pins catalog English to
  ItemDef.name for the nine phase ids. fix(scripts) 719d701d66 pinned
  pendingArtCount (39) beside liveItemCount in the item art audit and
  gated the portrait manifest's receipt-free path on the drift
  classifier's bookkeepingOnly verdict (tracked-file edits demand a
  receipt again), with the second-order evidence re-mints riding along
  (details in the state.md (al) QA paragraph). fix(ui) 05aae684f7 rewrote
  the growth tonic hint from the live mechanic (spent at plant time,
  forfeited if the crop withers) with all five non-Latin fills
  re-supplied in the same change (M16), fixing the ja register and ru yo
  nits.
- MUTATION BATTERY (committed-first, all killed with named reds): deleted
  fine-twin reagent (4 reds), silverleaf buyValue (4 reds across 3
  suites), silverleaf on a DELVE counter and a dish on the HEROIC counter
  (the pre-fix silent pair, now 1 named red each), soup sellValue bump
  (curve + raw arms), tonic herb count (3 reds incl. the tick-driven
  craft), a struck pending id (item_icons pair + standalone CLI red), the
  pendingArtCount literal off by one (named CLI assert), the guard
  tightening reverted (its new fixture arm), a catalog name drift (the
  stay-in-step arm).
- DEFERRALS, all ledgered with owners: (1) tonic-as-cheapest-rung-0
  alchemy skill-up faucet, maintainer ruling owed ((ai) QA addendum);
  (2) the 2500/10000 trainer fees on dormant rungs, maintainer ruling
  owed ((aj) QA addendum); (3) tier-3 rung-50 domination, restated,
  ruling still open (Phase 6 flags above); (4) the portrait bundle-hash
  renderer/content split, the sharpened (al) maintainer read; (5) art
  debt owner NAMED (Phase 13 asset handoff + the A4 cross-family
  extension trigger, state.md Phase 6 entry); (6) the five-locale "frost
  gourd" qualifier and ru Eastbrook stem stay release-time locale-pass
  notes; (7) closure arm's merged-ALL_RECIPES derivation stays the
  bounded, ledgered residual (a).
- Also corrected in this round: the status table's Phase 6b row (said
  "not started" against its own DONE block) and the stale
  material_hint_view test title.

Gate record: two runs, both on frozen committed trees. Run 1 (at
d6b4b781e4) FAILED at the full-suite fallback with a SINGLE red:
tests/item_art_audit_builder.test.ts's CLI round-trip arm timed out at
the 20s repo default (21.4s under 12-worker contention, ~7s isolated;
the arm execs the real CLI twice and its inner --verify-only already
budgets 30s), with the other 38078 tests green. Healed as a7e4076839: a
declared 60s allowance, verified by the release's
suite_duration_budget ratchet in the same change (under both caps, no
ledger row needed). Run 2 (at a7e4076839): "[gate:select] PASS: all 8
steps green (vitest workers: 12)", full-suite fallback 38079 passed / 0
failed / 2 expected fail / 112 skipped, browser batch 125/125, malware
scan 0 high after priors, i18n freshness clean, farming_session golden
md5 f017045f unchanged, tree clean. (Both runs fell back to the full
suite: the diff touches src/guide/content.generated.ts and a shared
test helper the planner classifies as broad.)

### Phase 7
Status: DONE 2026-08-14, local-only per D22. Branch
fix/farming-phase-07-render-and-juice off feature/farming-plan; thirteenth
absorb first (merge a0d8ddc127 of release/v0.38.0 tip 6ee7f3fd27: 4 commits,
8 files, one-file intersection at src/sim/sim.ts, release-merge-audit clean
on all axes, no lockfile move, (al) checklist byte-identical). Three-agent
fan-out (assets / render+VFX / SFX) delivered 3/3 first try with zero
report-less deaths; three domain reviews (frontend-seam, architecture,
cross-platform-sync) found 0 BLOCKING and 5 SHOULD-FIX, all five fixed
in-phase plus two adopted notes (the pid guard and two doc/diagnostic
one-liners).

Acceptance criteria, with states:
- [x] The exporter exists and exports deterministically (two optimizer runs
      byte-identical, checked IN the exporter per the noticeboard archetype).
      REFINEMENT: it lives at scripts/assets/farm_props/export_farm_props.mjs
      (the live per-asset subdirectory convention), not the packet's flat
      scripts/assets/build_farm_props.mjs; deviation (as).
- [x] The parsed-GLB contract test with source-fingerprint pins:
      tests/farm_props_asset.test.ts, including the live fingerprint
      recompute, the GLB extras stamp, and the exporter-to-renderer node-name
      cross-pin.
- [x] Bed base 3.0 by 2.0 yards with a low wooden border. The four biome
      tints ship RENDER-SIDE (FARM_BIOME_PALETTES in farm_patches_core.ts,
      one neutral GLB + per-patch instance tint); deviation (au).
- [x] Growth stages as specified: shared stage-one sprout; per-family stage
      two; per-family stages three and four with crop identity via the
      CropAccent tint channel; withered variant per family; compost bin.
      Families are grain / rootleaf / gourd, mapped render-side with an
      exhaustiveness pin over FARM_CROP_IDS; deviation (au).
- [x] Every asset documents footprint and pivot in FARM_PROP_CONTRACTS
      (model.js, deep-frozen, JSON-shaped for the Phase 13 manifest) and
      stamps the contract row into the GLB extras.
- [x] src/render/farm_patches.ts reads IWorldFarming only (plus the two
      sanctioned pure-function/content imports the architecture scan's
      types-only world_api pin forces; deviation (ar)); beds render for
      everyone; MY plots drive stage meshes from farmGrowthStage over the
      projection plus the new farmNowMs clock read (deviation (ap));
      wet-soil tint banded from planted-at recency; withered from the
      authority status; signature-guarded rebuilds keyed on
      bedId/cropId/stageMesh/wetBand/status; zero steady-state allocation
      with a uniform 0.5s read cadence plus event-driven resync; pure logic
      registered in RENDER_PURE_CORES with its own Node suite
      (tests/farm_patches_core.test.ts) plus an adapter suite
      (tests/farm_patches_adapter.test.ts).
- [x] Ground-pad and collider decision: NEITHER (deviation (at)), stated in
      the farm_patches.ts banner, this phase file, and state.md.
- [x] Plant, harvest, and wither VFX fire on the Phase 3 events through the
      shared vfx.ts emitters (scaledCount IS the tier shed); beds and stages
      shed nowhere (pinned in tests/professions_graphics_fairness.test.ts,
      profile-free scans plus a behavioral stage-walk arm).
- [x] farm_plant and farm_harvest wired end to end, PLACEHOLDER-marked;
      sfx:check and tests/game_audio.test.ts pass (catalog pins re-recorded
      16 to 18 and 265 to 267).
- [~] npm run asset:budget: AMENDED, deviation (aq). The repo-wide budget is
      pre-existing RED (the image-to-glb skill says never claim it passed).
      The honest bar held: models/props moved exactly +174,844 bytes (the 15
      farm assets, 4,948 triangles), no other group moved a byte, and no
      group that was under its budget crossed.
- [x] tsc, the contract test, architecture, the named render suites,
      ci:changed (exit 0), and gate_select green; golden md5 f017045f
      unchanged throughout.
- [x] Before/after screenshots, desktop and mobile, LOW preset, committed
      under docs/screenshots/farming-phase-07/ (before-desktop, before-mobile,
      after-desktop, after-mobile) via a new farm-patches entry in
      scripts/pr_shot_targets.mjs. The AFTER shows all four Eastbrook beds
      planted across the stage ladder plus the compost bin; the BEFORE is the
      identical framing on the phase-start commit (plants land sim-side,
      nothing renders).

Notes (surprises, deviations, deferrals with reasons):
- The Explore step's renderer extraction candidate was MIS-MEASURED: the
  method-gap heuristic attributed prewarmInitialScene's ~1700 lines to
  diagnosticsBaselineForPrewarm (really 21 lines). The substituted
  extraction is the delve interior scheduler (62 cohesive lines to
  src/render/delve_interior_scheduler.ts, commit 74d29effe1), ceiling
  lowered 13708 to 13700, renderer.ts finished at 13679. Lesson: gap-based
  span estimates lump in whatever follows; verify with a body read before
  planning an extraction around one.
- farmNowMs (deviation (ap)) is the phase's one facet addition and the
  packet's stopping-rule question answered in the design's own words: the
  facet comment and the farm_projection header both anticipated a
  RaidLockout-template timer read landing with the first timer surface,
  which the stage fractions are. Maintainer read owed.
- The plant cast burned two capture runs: plantCrop casts, so back-to-back
  plants refuse with "You are busy", and Forest Wolves interrupt the cast
  mid-sequence. The shot target seq-plants with per-bed retries and shoves
  nearby hostiles 500 yd first.
- npm run sfx:ui defaults to a PATH ffmpeg that does not exist on this box;
  node scripts/gen_ui_sfx.mjs --ffmpeg node_modules/ffmpeg-static/ffmpeg is
  the working form (the gate resolves the bundled binary itself).
- Deferrals, all with owners: instanced-prop helper extraction (rule-of-three
  is now MET across stations/gather_nodes/farm_patches; Phase 7 QA or 13),
  cloneMaterialWithHooks on the GLB material clones (QA),
  GLB-loaded-branch synthetic coverage in the adapter suite (QA), two-tier
  built fairness arm for the bed half (QA), releaseGltf residency note (QA),
  /dev GUI row for farmgrow (re-deferred to Phase 8: it is a dev-only UI
  surface and Phase 8 is the UI phase), nameplate raw-id cast label
  (pre-existing cross-profession class gap, Phase 13 polish), the stale
  guide gatherIntro/gatherDeeds farming prose (still true until go-live;
  reword in Phase 9 with its M16 fills), harvest confirm channel ((ah)/(af)
  unchanged, Phase 8 decision).
- Parity reviewer observation worth keeping: offline reload visibly regrows
  a crop (the load-path re-anchor preserves duration, so the sprout restart
  is FAITHFUL to authoritative state, first made visible this phase).

Gate record, judged by log markers per the standing rule, four runs on
frozen committed trees: run 1 FAIL at changed-files biome (one late test
edit missed its single-file format pass); run 2 FAIL at the full-suite
fallback with the three renderer-edit evidence families (the sparse
checkout cone coupling, the Eastbrook polish composite, the portrait
stills bundle: the recurring fallback-only class, healed through each
family's sanctioned re-mint, commit 393bde72a3, gate-integrity review
PASS on the cone edit); run 3 FAIL on the one second-order accepted-art
registry row; run 4 "[gate:select] PASS: all 8 steps green", full-suite
fallback 38,238 passed / 0 failed, browser batch 125/125, malware scan 0
high, golden f017045f unchanged, tree clean.

Merge: b4632b8c54 into feature/farming-plan (--no-ff, ten phase commits,
branch fix/farming-phase-07-render-and-juice deleted).

### Phase 7 QA (2026-08-14, PASS-WITH-FOLLOWUPS)

Branch fix/farming-phase-07-qa off feature/farming-plan; merged back
--no-ff as c7fbf839a3 (branch deleted; the absorb merge plus ten QA
commits). FOURTEENTH absorb
FIRST (merge 20e9b6a987 of release/v0.38.0 tip 51aa4eab13: 98 commits, 225
files, roughly 60-file farming intersection, no lockfile move; conflicts
only the generated pending.ts, regen-resolved, and the accepted-art
registry row, re-pointed at the CLI-re-minted portrait manifest, which the
auto-merge had reproduced byte-identically; 4-lane release-merge-audit:
arms/endpoints CLEAN, bindings CLEAN, overlaps and premises FINDINGS, all
healed in-branch; count pins re-run live and unchanged, golden f017045f
unchanged, tsc clean). The release's cheater-mark growth broke the hud.ts
and server/game.ts monolith ceilings on the merged tree with no farming
change at all (the third absorb-driven collision); healed by extraction
a3b5ea431b: both HEAVY_SELF policy sets whole to server/heavy_self.ts and
the castDisplayName mapper with its rift key table to
src/ui/cast_display_name.ts, membership pins in
tests/server/heavy_self.test.ts, ceilings untouched per the (an)
precedent. Premise corrections committed as d7bc896b37 (state.md header
and headroom numbers, the manifest-freshness gate family, phase 8/9/10
notes).

Audit: 7-lane Workflow (three audit lanes with the correctness lane
driving the REAL dev client headless on the LOW preset, plus
frontend-seam, architecture, cross-platform-sync, and qa-checklist),
7/7 delivered first try, zero report-less deaths, 0 BLOCKING anywhere.
Live verification: beds plus one compost bin at all four hubs with
per-hub tints matched programmatically to FARM_BIOME_PALETTES and on
screen; the full stage ladder swapped meshes with crop identity visible;
wet-band darkening (the exact 0.72 inverse) fades with age; the withered
silhouette renders from the derived status; harvest bares the bed in
under half a second; beds walkable, zero pageerrors. Per-viewer held at
core and adapter level (a second live client needs the online rig this
box lacks; said so, not assumed).

FIXES, all test-first and mutation-proven (six commits on the QA branch):
the shared GLB-instanced-prop kernel extraction 049d4e65fe (deferral (a),
rule of three met; stations and farm adopt whole, gather_nodes documented
out); the adapter heal 4d6ff0e21e (the ONLINE event-order race: the
event-forced read now stays armed until it observes a change, bounded at
one interval; cloneMaterialWithHooks on tintOne; socket-offset caching;
the GLB-loaded branch synthetic coverage through a test-only setLoaded
seam; the foreign-pid dirty-flag negative arm); the pin batch 02541502d5
(heavy-self exact-set literals with the orphan guard; type-forced
farmDenied exhaustiveness; the fairness GFX allowance scan; wet-band and
15-model literals; the fallback-palette consumer; dedicated suites for
the delve scheduler and castDisplayName; the farm_projection banner
re-tensed and naming its render consumer); the fplot clock-base wire arm
51a018147d; the residency policy note 3830308827. Mutation battery 6/6
KILLED with named reds (dirty-set drop, throttle-gate drop, rotation.z
clobber, accent-name literal both sides, heavy-self member drop,
unconditional dirty clear). Exporter determinism re-proven end to end:
the driver's candidate/repeat byte-compare passed and the in-place
shipping rewrite left git byte-identical (174,844 bytes, fingerprint
425f34e4 matching the committed pins).

Deferral verdicts and the (ap) re-argument: recorded in the state.md
Phase 7 QA addenda block (KEEP farmNowMs, maintainer read still owed;
(av) prewarm-drive acceptance; the reload-regrow premise re-pointed at
the online path with the live check moved to Phase 9 QA; the two-tier
built fairness arm re-deferred with its structural-impossibility reason;
releaseGltf residency verdict stated at the preload block).

GATE RECORD, judged by log markers on frozen committed trees, three runs:
run 1 FAIL at "biome (changed files)" (one format diff: stations.ts had
missed the extraction commit's scoped format pass; healed 7be0628340);
run 2 FAIL at the full-suite fallback's single red,
tests/inventory_sort.test.ts "keeps 'inv_sort' in HEAVY_SELF_CMDS" (a
game.ts source scrape dangled by the heavy-self extraction: the
full-suite-fallback-only class again, seventh-plus strike; re-pointed as
a direct membership read on the exported set, 2a3b7a154d); run 3
"[gate:select] PASS: all 11 steps green", planner mode=full (the branch
footprint includes a broad-class helper), fallback 38,546 passed / 0
failed (2 expected-fail, 115 skipped), browser batch 125/125, malware
scan 0 high after priors, manifest freshness green (the new family's
first pass over farming's SFX artifacts), i18n freshness green, golden
f017045f5fa0e85f6d740c99ea4eb225 unchanged, tree clean. Note the gate
now runs ELEVEN steps (the fourteenth absorb added the manifest regen
and freshness steps); the phase files' "all 8 steps" wording is
historical per-run truth, not a stable count.

### Phase 8
Status: DONE 2026-08-14, local-only per D22. Branch
fix/farming-phase-08-harvest-journal off feature/farming-plan; fifteenth
absorb first (merge 091e02931b of release/v0.38.0 tip e56010cec1: 108
commits, 979 files, 73-file intersection, below the mid-phase bar; the five
pin-test collisions re-counted from runs at 202/215 wire and 329 = 88 + 241
IWorld; the Eastbrook polish seals re-minted on the merged tree through
remint_polish_provenance.mjs, the portrait manifest receipt-free, the
accepted-art registry re-pointed; release-merge-audit clean on all five
axes with the four farming screenshot cone-row sets intact). Three-agent
fan-out (journal window / map pins / ready notices) delivered 3/3; reviews:
frontend-seam 2 BLOCKING + 4 SHOULD-FIX (both blockers and three
should-fixes fixed in-phase, one ruled), architecture 0 findings (7 notes),
cross-platform-sync 0 BLOCKING (the linkdead ruling below), server-hot-path
0 BLOCKING (the unsharded-sweep ruling below), qa-checklist READY with the
parity-scenario gap closed in-phase.

Acceptance criteria, with states:
- [x] DOM-free view core in UI_PURE_CORES (src/ui/harvest_journal_view.ts);
      its suite covers rows, knobs, empty states, and remaining-time
      derivation (30 tests).
- [x] Honest remaining time: readyAtMs minus IWorldFarming.farmNowMs()
      clamped at zero, status alone renders Ready/withered, a zero countdown
      under a growing status renders the finishing state. The deliberately
      skewed clock scenario is tested (nowMs far past readyAtMs with status
      growing must NOT render Ready). The msRemaining wire field is DECLINED:
      a per-tick-varying field on the diff-gated fplot key would defeat the
      heavy-self design; the (ap) cosmetic-skew acceptance transfers. Wire
      unchanged: 87 delta keys, both worlds untouched.
- [x] All time formatting through t() token templates and formatNumber;
      absolutes through formatDateTime; no hand-built colon strings
      (REFINEMENT: a remainingSeconds final-minute arm replaced the packet's
      minutes-only floor so the 1 Hz driver has digits to move).
- [x] Cold-window contracts: harvest_journal_window.ts lands in the
      auto-derived cold bucket with a COLD_PAINTER_ALLOWANCES entry (fixed
      1000 ms setInterval, data-attribute rebind, whole-write elision);
      DRIVER_HOSTS and the scanned-callback pins re-pinned; self-driven, so
      hud_update_drive needs no row. Focus is carried across
      signature-forced repaints (captureFocusKey/restoreFirstEnabled).
- [x] Open-surface decision: professions-window Farming-row button plus the
      Shift+K keybind; NO side-rail button (the rail has room, but hud.ts
      headroom is the real budget). tests/crafting_launcher.test.ts green.
- [x] Map and minimap pins for the patch sites through the overhauled
      family (crafting-station doctrine: static content positions, never
      entities); procedural two-leaf sprout in the STATION family color on
      both surfaces; painted marker art recorded as asset debt; tooltip and
      screen-reader label arms included.
- [x] Login check in Sim.addPlayer after saved-state restore: one text-free
      counts-only farmReady per player, zero rng (pinned against the real
      draw observer), flag-flip-before-emit, relog silent forever.
- [x] 1 Hz sweep in the Phase 3 updateFarming skeleton: once per plot
      transition under real ticks, re-arm only at replant, twin-seed
      identity pinned. Deliberately unsharded on the crowded 1 Hz residue
      (measured sub-millisecond; sharding forks every golden).
- [x] Hud arms in farm_event_feedback.ts (ambient banner, log lines,
      farm_ready cue); hud.ts gained only the case label plus wiring within
      ceiling (19485 of 19490 at commit time).
- [x] farmReady joined HEAVY_SELF_EVENTS; the exact-set pin and the named
      farming arm re-pinned in tests/server/heavy_self.test.ts.
- [x] SFX: ui_farm_ready PLACEHOLDER row at 0 dB in ui_sfx.mjs, generated
      through the bundled ffmpeg; every manifest-freshness artifact
      committed fresh; count pins moved deliberately (19 cues, 268 keys).
- [x] /dev farmgrow GUI row in dev_command_view.ts behind the dev window's
      ALLOW_DEV_COMMANDS gate, with the token(values, 'bed') field.
- [x] i18n: every player string is an English t() key; all wordy keys carry
      the five non-Latin M16 fills; S3 green (the event is text-free, so no
      matcher row, matching every prior farming phase).
- [x] Golden: farming_session deliberately re-minted (f017045f to 50a2e54c)
      in an ISOLATED commit for the appended ready-notice beat, which
      golden-proves the sweep's emission (one farmReady, zero draws, the
      second 1 Hz boundary silent). No other golden moved.
- [x] tsc, the named suites, ci:changed green in-phase; gate_select run
      recorded in the notes tail.

Gate record (judged by log markers per the standing rule): run one hit the
full-suite fallback (a pre-existing branch edit to tests/helpers/
bare_client.ts is unclassifiable) and FAILED with three REAL reds, all
fifteenth-absorb classes the targeted runs structurally cannot see: the
entry window-id parity pair (the journal root was in index.html only;
play.html healed), the three r165 compileAsync patch pins (patches/ and the
lockfile moved in the absorb while node_modules predated them; healed by
pnpm install), and the farm-props seal family (pnpm-lock.yaml is a
fingerprint input and the branch-only seal could not have been re-minted
release-side; healed by the exporter's in-place rewrite, all fifteen byte
counts preserved, sha pins re-recorded). Run two on the healed frozen tree:
38887 passed, 2 expected-fail, 115 skipped, and exactly ONE red, the
druid_engines 20s TEST TIMEOUT in tests/parity/coverage_c.test.ts under
12-worker contention, the environmental flake the QA review pre-registered
on the pre-extension tree; proven green standalone twice on the same frozen
tree (filtered 1/1 and whole-file 20/20). Verdict: green with the one
recorded environmental flake, the dungeon_finder-class precedent.
- [x] Screenshots, LOW preset, desktop and mobile, committed under
      docs/screenshots/farming-phase-08/ with the five ci.yml cone rows and
      the ci_workflow literal in the same change.

Would-be PR body (D22):
Phase 8 gives the farmer the full "what is growing, where, and when" loop:
the Harvest Journal window (professions-window entry plus Shift+K) lists
every planted bed with crop, location, growth stage, applied care, and an
honest live countdown; the world map and minimap pin the four patch sites
with a procedural sprout in the station family; and a plot finishing emits
one farmReady notice per growth cycle (login check plus 1 Hz sweep sharing
one predicate over the persisted notified flag), surfaced as an ambient
banner, chat lines, and a placeholder chime. Deliberate rulings this phase:
no msRemaining wire field (the fplot key's diff-gating is the design), no
harvest button or confirm channel in the journal (re-deferred; the window
is informational), painted pin art deferred as asset debt, the sweep left
unsharded on the 1 Hz residue, and a notice that ripens during the linkdead
grace loses its transient banner (the journal, pins, and plot state show
the truth on resume; maintainer read owed). Screenshots:
docs/screenshots/farming-phase-08/before-journal-desktop.png to
after-journal-desktop.png and after-journal-mobile.png (the window over the
staged growth ladder), before-map-pins-desktop.png to
after-map-pins-desktop.png and after-map-pins-mobile.png (the zone map),
and before-professions-entry-desktop.png to
after-professions-entry-desktop.png (the entry button).

Notes tail (added by the Phase 8 QA round, 2026-08-17, because the status
row pointed here for it): merged --no-ff into feature/farming-plan as
0f4bd59145 (phase branch fix/farming-phase-08-harvest-journal deleted per
D22); phase-side commit chain ccf875aaf7, 952f23d82b, a8384acf85,
d8b70bbfec, 06ad9e9df1, a66ee43ef2, 8420f0bd8d, 17ef15a51f. Surprises and
deferrals live in the state.md (ay)-(bd) block; the frontend review's one
RULED should-fix was not named by the phase session (its content is not
recoverable from the record; the QA round found no open frontend
should-fix against the shipped code, so nothing is owed). Carry to Phase
9: the ready notices fire only for dev-created crops until seeds are
obtainable (the live-surface note), the (bb) linkdead maintainer read,
the (ap) farmNowMs read, and the painted pin art (Phase 13).

### Phase 8 QA pre-flight: the v0.39.0 release sync (sixteenth absorb)
Ran 2026-08-15 as its own mid-phase per the D22 minor-version rule, BEFORE
Phase 8 QA (user instruction: sync only, QA re-runs in a fresh session).
Branch fix/farming-sync-v0.39.0 off feature/farming-plan; merge eaaf07f658
absorbed origin/release/v0.39.0 tip d2d1a8ad5c (320 commits, 555 files,
74-file farming intersection; release/v0.38.0 is fully contained in v0.39.0).
Headline systems: Three.js 0.165.0 to 0.185.1 (repo compileAsync patch
renamed and carried; farming render files verified lookAt-free and
version-defensive; farm impact bounded to cosmetic warm-timing), the
desktop-client-update program (PR 3406), the market-house redesign (PR 3376),
the gate_select merged-leg rework (PR 3394; FAIL/PASS markers unchanged; the
full-suite fallback still fires for this branch via the tests/helpers/
trigger), the CI shard rebalance to measured-weight LPT (new farming suites
ride the neutral fallback until scripts/ci_shard_weights_harvest.mjs re-runs;
unreachable while D22 keeps farming off CI, deferred to go-public), arena
loss honor, Grix respawn window, and cat-form swing normalization (two new
parity scenarios appended after farming_session; release-side goldens
re-recorded upstream). Nine conflicts resolved by doctrine: renderer.ts
(release encounterPrewarm import kept, delve-kit import dropped to the
branch's delve_interior_scheduler extraction), pr_shot_targets.mjs (both
appended target blocks whole), monolith_budget (renderer ceiling = exact
merged count 13725 between parent pins 13700/13754), the four Eastbrook
polish evidence JSONs plus both pin suites (release side taken, then
re-minted through remint_polish_provenance.mjs on the merged tree). Heals:
1f97379ae6 (farm-props seal: byte-level restamp of both stamp sites in all
15 GLBs, sizes held, sha pins re-recorded, assets manifest regen; Eastbrook
literals re-pinned), ebf3104859 (portrait manifest fingerprint-only re-mint,
registry re-pointed). Validation on the merged tree: tsc green; full parity
216 passed with farming_session golden 50a2e54c UNCHANGED (zero golden
moves); world_api_parity/snapshots/command_schema/monolith green with all
count baselines held (202/215, 329 = 88 + 241, delta keys 87); the farming
battery green; i18n:gen and wiki:content byte-identical; ci:changed exit 0;
all seal suites green; Three contract suites green. Reviews: 4-lane
release-merge-audit ZERO BLOCKING (overlaps CLEAN with line-set proof;
db-mock NOTE is release-authored debt; two premise SHOULD-FIXes corrected in
state.md this sync), cross-platform-sync SIGNED-OFF (patch-id-verbatim on
every parity-critical file; scenarios.ts a true union with no shared mutable
fixture state), qa-checklist READY (0 FAIL; the two SHOULD-FIXes are the
zero-headroom warning, ledgered at (an), and the shard-weight deferral
above). Known contention flakes proven green standalone (whole-file and
filtered): professions_farming "plants, spends the seed" and
language_fanout_registry's relocalize-caller arm. GATE RECORD: run 1
(default 12 workers) hit "[gate:select] FAIL" at the full-suite fallback
with 11 timeouts across 9 files, ALL declared-budget timeouts in the
heavy balance-harness family (druid_balance_probe, hunter_dps_balance,
the six owned_class_balance/raid suites, warlock_five_minute_windows;
the release's balance PRs grew these harnesses and 12 concurrent heavy
sims starved the suite tail on this box); all nine files plus
druid_engines proven green standalone on the SAME frozen tree (36/36 at
4 workers in 209s wall, warlock 2/2), the recorded environmental
contention class. Run 2 on the identical frozen tree with
GATE_MAX_WORKERS=8: "[gate:select] PASS: all 12 steps green (vitest
workers: 8)", 39,695 passed, zero FAIL lines. Lesson for future gates on
this box: prefer GATE_MAX_WORKERS=8 when the full-suite fallback is
expected.

### Phase 8 QA (2026-08-17, PASS-WITH-FOLLOWUPS, local-only per D22)
Branch fix/farming-phase-08-qa off feature/farming-plan at df340ea91f (the
sixteenth-absorb tip; the newest release branch was still origin/release/v0.39.0
at d2d1a8ad5c, already absorbed, zero commits ahead, so no absorb ran this
round). Audit target: the Phase 8 merge 0f4bd59145's phase-side chain
091e02931b..17ef15a51f, the fifteenth absorb excluded. Merged --no-ff into
feature/farming-plan (hash in the notes tail below); the QA branch deleted.

Fan-out: one very-thorough context loader, then eight parallel lanes
(correctness with a throwaway real-tick probe file, coverage/pin quality,
dead code plus i18n plus doc hygiene, a live-client drive of the real dev
client on the LOW preset, frontend-seam-reviewer, cross-platform-sync,
architecture-reviewer, qa-checklist), all delivered first try (Workflow,
0 dead lanes). Verdicts: 0 BLOCKING everywhere; 13 SHOULD-FIX and 34
NICE-TO-HAVE after dedupe. Then a verification round over the fix diff: a
FRESH frontend-seam-reviewer, the privacy-security-review the phase never
recorded (its matrix row had matched: server/heavy_self.ts plus the dev
GUI row), the test-coverage-auditor over the new pins, three adversarial
skeptics (regression, design, and the online arms), and a completeness
critic. Verification results: frontend-seam PASS-WITH-FOLLOWUPS, 3
SHOULD-FIX all taken (the simplified-mode doctrine banner was stale; the
shared row builder also painted the SPENDING tool-effect controls in the
simplified body, now bar plus opener only through an effects flag; that
per-mode difference is pinned); test-coverage-auditor 3 SHOULD-FIX all
taken (the online negative arm asserts its quiet-tick list is non-empty;
the guide keycap-set pin records why a page-wide set suffices, the
keybinds collision guard is what makes it so; a live plant-while-open arm
proves the presence fold repaints an open window once and not on the
second bed); the regression skeptic REFUTED the "every existing pin stays
green" claim with a real gate red (the browser a11y suite's professions
stub had no myFarmPlots and threw on open; fixed, the stub gains the
member); the design skeptic did NOT refute (no written doctrine forbids
worked rows in simplified mode; the original commits define the mode by
trigger, not by hiding gathering; mobile has NO other journal launcher, so
ledger-only was untenable on touch; the one-predicate revert is real for
the visible behavior, a full removal also drops the input and its fixtures);
the online skeptic did NOT refute (tick alignment reasoned and probed:
ripen at tick 22, notice at tick 40 with 17 quiet ticks; the welcome letter
is one-shot on the first residue; the membership drop reds both arms; two
hardenings taken); the critic's one BLOCKING was the same a11y red, its
should-fixes are this record. privacy-security-review (the Workflow lane
died report-less, the recurring class; the Agent-tool redispatch with the
mandatory report-via-SendMessage line delivered first try) PASS: 0
BLOCKING, 0 SHOULD-FIX; verified server authority (the journal sends
nothing, readiness never client-derived), the personal counts-only routing,
the DoS shape of the heavy-self join (three notified writers only: the
sweep flip, the plant re-arm, the load; the only client re-arm is a fully
gated plant plus a growth cycle), dev gating on both arms (ctx.devCommands
from ALLOW_DEV_COMMANDS, the GUI row behind devCommandsAvailable, the
SAFE_TOKEN bed field), escape-clean rendering (every innerHTML
interpolation through esc(); the rebind writes textContent; bed ids are
allowlisted at the sim), no PII/secrets/egress, determinism, and the QA
diff's self-only farmPlotCount read. Three notes ledgered: a login-path
notice whose in-memory flip is never persisted (a drop before the next
character save) replays on the next join, bounded by a full authenticated
login per replay; the client arm trusts ev.ready to be numeric (negative,
NaN, and zero print nothing; a truthy string would render cosmetically);
one unescaped focusKey selector splice in the journal, safe today because
the key is this module's own literal read back from its dataset. Fix
commits from
the round: 17d7d37f2b (the effects flag, the a11y stub, the banner, the
two online hardenings, the live plant arm, the guide pin note) and
4040ca5a2b (the two-farmer arm's honest scope: pids ascend by join, so
insertion and pid order coincide by construction; the arm pins the
observable, two events, one tick, first-joined first). Four more mutants
after those commits (effects flag forced on, simplified passing effects on,
the membership drop against the hardened online arms, the sig fold dropped
against the live arm) plus the skill boundary loosened to >= 0: all
KILLED, 29/29 for the round.

Live-client evidence (the Phase 8 QA live drive, offline dev client on the
LOW preset, 1600x900 and 844x390): the novice empty state opened by the REAL
Shift+K keybind (canvas focused) with the noviceTitle/noviceBody copy; the
skilled empty state after farming skill 5; three beds planted through the
real plantCrop cast (two needed a retry, the interrupt class), the journal
listing crop, bed line, stage, care chips, and a countdown that read "Ready
in 1m 29s" then "Ready in 1m 26s" 2.5 s later, the 2 h row on the
hours/minutes arm; a plot shaped to ripen under the OPEN journal repainted
to "Ready to harvest" with no countdown attribute within one 1 Hz tick and
the ready notice fired on banner, chat log, and the chat live region; each
of the four zone maps carried exactly one farm pin (one per ZONE map, the
station doctrine) with the "Garden Beds" tooltip on hover; the minimap pin
is canvas-only (verified by the builder suite, screenshot at the site);
mobile: no horizontal overflow with all three chips, chip type 10px
(residual (bf)(4)); the professions-row entry was ABSENT for the
pre-attunement farmer, the finding behind (be). Save shape: NO persisted
shape moved (farm_persist.ts, server/db.ts, and the round-trip pins are
absent from both the phase and QA diffs; the QA diff's src/sim changes are
comment-only). UI_PURE_CORES: harvest_journal_view.ts registered
(tests/architecture.test.ts) and professions_view.ts remains registered;
the QA added no new core.

Validation runs on the frozen tree before the gate: tsc clean; biome on
every changed non-generated file 0 errors, format clean; the changed
suites green (farm_ready, harvest_journal_view/window, farm_event_feedback,
game_audio, keybinds, professions_graphics_fairness, professions_view,
professions_window_layout/focus, professions_enchanting_reachable,
farming_command_chain_online, guide, hud_perf_budget, hud_update_drive,
language_fanout_registry, crafting_launcher, window_drag,
hud_map_marker_lifecycle, professions_farming(_state), farm_props_asset,
i18n_semantic_regressions, i18n_completeness, localization_fixes,
architecture, monolith_budget, world_api_parity, snapshots,
command_schema); the browser a11y professions arm green after the stub
fix; npm run i18n:build and npm run wiki:content leave no generated diff.

Findings fixed (every SHOULD-FIX, plus the cheap NICE-TO-HAVEs), as
Conventional Commits with explicit paths:
- 71c17f5719 docs(farming): the six stale comments (farm_event_feedback
  "five arms" to six; the updateFarming docblock claimed "emits nothing"
  after it started emitting farmReady, a stronger reorder license than the
  body earns; the flip-before-emit note (a mid-loop throw SPLITS a notice,
  the already-flipped plots lose theirs, practically unreachable); the
  heavy-self entry now names `status` as the client-visible field the mark
  keeps fresh with `notified` as the byte that makes the row differ, and
  the farming_commands.ts mirror paragraph agrees; the banner comment
  states BOTH directions of the replace-not-queue slot; the journal's
  second-open refresh is documented; the (bb) acceptance sits at the emit).
- 33bd33cfa2 test(farming): the pin gaps: the settled timer arms were
  tested only with status AHEAD of the clock (the authority only ever says
  ready or withered once the deadline is behind it), so a branch order that
  let the zero clamp win over the withered check survived both suites; now
  the past-deadline ready and withered arms exist in the view core and the
  window; the farmReady audio route and its feedback gate; the Shift+K
  default plus a whole-table default-collision guard (the one sanctioned
  pair, KeyA for turnLeft and attackMove, is the exact expected set); the
  fairness row names both pin painters explicitly; a focus no-steal
  negative arm for the whole repaint; the two-farmer insertion-order sweep
  arm ((bc)); the mixed-notice single cue asserted before the cross-check
  drive; a dozen-residue silent tail after the one notice.
- bba9dc4010 feat(ui): THE ONE BEHAVIOR FIX, deviation (be): the live drive
  proved the (az) entry surface missing for a pre-attunement farmer (the
  simplified professions body painted no gathering section, so only
  Shift+K reached the journal); the pure core now derives
  simplifiedGathering (worked rows, skill above 0, plus the Farming row
  while any bed is planted through the new required farmPlotCount input,
  folded into the refresh signature as presence), the window paints it
  beneath the call to action through the one gatheringSectionHtml builder;
  full mode and the fresh-character window unchanged; the opener itself
  (untested in either arm before) is now pinned: presence under the
  Farming row, click routing without repaint, absence without the dep,
  under other rows, and for a fresh character; both simplified triggers.
  Screenshots (LOW preset, desktop and mobile landscape):
  docs/screenshots/farming-phase-08/before-professions-simplified-desktop.png
  to after-professions-simplified-desktop.png and
  before-professions-simplified-mobile.png to
  after-professions-simplified-mobile.png (the existing coned subtree, so
  no ci.yml cone row moved).
- 4ac39a7ca6 + 7159cdeab4 test(server): farmReady's HEAVY_SELF_EVENTS
  membership was pinned only as set membership; two arms now ride the real
  GameServer path (the sweep tick that announces the ripened plot dirties
  the session and no quiet tick before it does; the very next broadcast
  carries status ready with notified true against a pre-notice baseline).
  The mutation pass caught the first cut: the join's welcome letter is
  delivered on the same first 1 Hz residue and mailArrived is itself a
  member, so the arm rode out that boundary before ripening; with the
  membership dropped both arms red (the next-snapshot one too, so the
  staggered backstop was not covering it).
- 0e739d3519 feat(guide): the Shift+K row on the public guide's controls
  page (a same-change obligation Phase 8 missed; the existing pins
  enumerate binds by hand), the guide.controls.harvestJournal key with the
  five non-Latin fills M16 demands (the same strings the window title
  carries), the regenerated resolved bundles, a row pin, and the
  completeness pin the earlier waves lacked (every Interface bind default
  must appear among the page's keycaps, read live through keyLabel).
- Docs (this commit and the gate-record commit): state.md head, (bd)
  amendment, (be), (bf), the i18n ledger row; the phase file and this QA
  file swept (the nonexistent "GATE EXIT marker" phrase retracted in both
  Close lines; STEP 5's skew wording read through (ay)); this section; the
  Phase 8 notes tail above.

Decisiveness: after committing, 24 single-edit mutants (plus five more
after the verification round, 29 in all) planted one at a
time on the committed tree and restored by checkout, every one KILLED with
named failing tests (rc plus names plus the summary line): the notified
flip, the zero guard, the count swap, the addPlayer login call, the % 40
cadence (killed by farm_ready.test.ts because tickCount is pre-incremented;
NOTE the parity beat's 41 consecutive ticks always contain a multiple of
40, so the golden does NOT pin the cadence), the growing-skip inversion,
the farmPlotStatus boundary loosened to <=; the view core's ready-from-
countdown, status-after-countdown, and BOTH settled arms gated behind the
deadline (the two the new arms exist for); the window's countdown elision,
the unconditional focus carry, and the signature's timer.kind; the feedback
plural swap and the banner drop; the heavy-self membership drop (kills the
set pin AND both online arms); the professions opener guard, the
simplified list forced empty, the planted-bed arm dropped, the simplified
body omitting the rows, the signature ignoring plots; the guide row
dropped; the audio cue swapped.

Deferred with reasons (ledgered, not fixed): the ambient banner is a
replace-not-queue slot in both directions (comment states it; the log lines
and the durable surfaces carry the truth); no aria-live announcement when a
row flips to Ready under an open journal (the chat line reaches the log
live region; a status line inside the dialog is a design follow-up); the
.hj-row rgba scrim and the bare 100vh fallback behind --app-vh (family
idioms; verify in the mobile E2E if ever doubted); the raw item-id fallback
on catalog drift (documented degradation); spectators receive the watched
farmer's farmReady and its heavy-self mark (pre-existing generic spectator
semantics for every member); the four em dashes in keybinds.ts (pre-existing,
attributed to e9c54bc7d2, not this diff); the 1 Hz interval has no
teardown outside close() (world() is a live getter, so a world swap is
followed, no HUD-wide dispose hook exists for any self-driven cold window (daily_rewards clears its intervals on close the same way), and Escape plus closeAll route through closeManagedWindow to close(), which disposes the clock; not a gap); map pins are one per ZONE map, so
"the four patch sites" reads as four zone maps (doc precision; the PR body
above is amended by this note); the minimap farm pin has no live state
hook (canvas-only; the builder is unit-pinned); the pre-existing
`describe.skip` in hud_perf_budget's gated tour; and the four residuals
now at state.md (bf) with residual (1) corrected. Not fixed by choice: (bd)
per-surface pin color (oak on the zone map, station orange on the minimap;
docs corrected, unification is the Phase 13 art batch's call).

Verified as ledgered (the rulings, not re-litigated): (ay) status-first
countdown with the decisive skew pin; (az) the two entries and no rail
button; (ba) no command from the journal; (bb) the linkdead loss, with the
one-tick join window confirmed against the server's join path (addPlayer to
clients.set with no await between, the resume arm bypassing addPlayer, the
events drained by the next tick's routing pass); (bc) unsharded on the
crowded residue in player-map order (now pinned across two farmers); (bd)
the static-marker family, never MapMarkerSemantic. Three-host: the login
check is reachable only where a saved state is restored (the server host
and the tests: the offline Sim constructs its player with no state, so the
offline emitter is the sweep alone; the RL host runs the same tick and
inspects no event types). Baselines held with zero movement: command_schema
202/215, IWorld 329 = 88 + 241 (no facet touched), delta keys 87, golden
50a2e54c3e809a1a4aa0ecf99ea43c5f, monolith hud.ts/renderer.ts untouched at
their zero-headroom ceilings, sim.ts untouched (12659/12660).

GATE RECORD (judged by log markers per the standing rule; run on the
frozen committed tree at d9704a3636 with BROWSER_PATH set and
GATE_MAX_WORKERS=8, the sixteenth-absorb lesson): run 1 hit the full-suite
fallback as expected ("mode=full (broad/unclassified change
(tests/helpers/bare_client.ts)"), diff base origin/release/v0.39.0, 351
changed paths, and printed "[gate:select] PASS: all 12 steps green (vitest
workers: 8)": i18n + wiki + sfx artifacts, i18n freshness, sfx and media
manifest regen, manifest trackedness and freshness, malware scan, biome on
the changed files, the full vitest suite (2823 files, 39,721 passed, 2
expected-fail, 115 skipped, ZERO FAIL lines), the browser regressions (19
files, 129 passed, the a11y professions arm included), typecheck plus the
env/server/bot builds, and the client build; about 14 minutes wall on this
box. The pre-registered druid_engines contention timeout did NOT occur
this run (nothing to prove standalone); the armory browser exception was
not needed either. Exit code 0 (informational only; the markers are the
verdict).

Notes tail: merged --no-ff into feature/farming-plan as 327fa964bd (QA
branch fix/farming-phase-08-qa deleted per D22; QA-side commit chain
71c17f5719, 33bd33cfa2, bba9dc4010, 4ac39a7ca6, 7159cdeab4, 0e739d3519,
17d7d37f2b, 4040ca5a2b, d9704a3636, f240ae048d). Handoff to Phase 9: vendor stock,
seeds, the intro quest and go-live, with the ready notices going live the
moment seeds are obtainable; carry the (ap), (bb), and (be) maintainer
reads, the pin-art debt, the shard-weight harvest at go-public, and the
go-live checklist additions recorded in earlier phases.

### Phase 9 pre-flight: the seventeenth absorb (2026-08-17)
Branch fix/farming-phase-09-world-presence off feature/farming-plan at
26f330cea2 (the Phase 8 QA tip). origin/release/v0.39.0 had moved to
f48c7a3a9b (80 commits, 952 files, 74-file farming intersection; same
minor version, two-digit intersection: a regular absorb, not the 06b
shape). Merge 89030e4e0f, then three heals and two shared shapes:
d07b578e5d (farm-props lockfile seal, the third firing: byte-level restamp
of both stamp sites in all fifteen GLBs, sizes held, sha pins
re-recorded, assets manifest regen), 58d4332993 (farming_session golden
re-mint for the castles' one static entity, machine-classified as a pure
entity-id +1 shift: 111 leaves, draws/drawDigest/ticks/coverage
byte-identical, md5 50a2e54c to 8fe57fe3, the (am) shape), 11e0940da0 (the
release's icon-art hotbar-item seal at 72 painted failed on the merged
tree only, farming's twelve hotbar-eligible pending-art items; healed by
the ART-SUBJECT rule with a hard pending literal 12, the release literal
and sealed record byte-identical: a new (al)-class member, see the
state.md (al) paragraph), 2953d6ccb2 (the QuestObjective 'farm' member)
and 2f22f9a5e9 (the NpcDef `farmer` flag), landed alone so the three
build slices compile against one shape. Conflicts (40) by doctrine: the
renderer.ts import block, the renderer ceiling at the exact merged count
13660 (both parents' extractions compose), the items catalog
(dawnhold_posy ahead of the farming block), 25 regenerated i18n bundles,
the char_window test name, the item art audit literals 823/838 with
pendingArtCount 39 kept, the (al) evidence family and the Eastbrook polish
provenance re-minted through their CLIs. Baselines held with zero
movement: commands 202/215, IWorld 329 = 88 + 241, facets 34, delta keys
87; wiki:content and i18n:gen byte-identical; ci:changed rc 0; the
farming battery 29 files 807 green; parity 216 green after the isolated
re-mint. Monolith headroom after the absorb: hud.ts 5, renderer.ts 0,
sim.ts 1, main.ts 1, server/game.ts 104 (Phase 9 touches none of the four).
Release-merge audit as a 4-lane Workflow, 4/4 delivered first try: overlaps
CLEAN, sim arms CLEAN, world content 0 BLOCKING with three should-fixes
taken as ledger notes (the seventeenth-absorb entry itself; the Phase 10
deed totals now 273 / 3155 / 11 exploration titles; the release moved the
hedge_knight camp to (306,872) r 8, 27 yd west of bed_evergarden_1, so the
tier-4 farmer sits east of the beds), i18n and evidence CLEAN with the one
BLOCKING (the hotbar seal) fixed as 11e0940da0. Traps: (1) `git checkout
--theirs` on a conflicted pin suite discards the branch's non-conflicting
arms; restore with `git checkout -m` and resolve hunk by hunk. (2) The
release re-records ITS goldens for a static-entity shift but can never
re-record the branch-only farming_session: expect the (am) re-mint on any
absorb that adds static world content, classify before minting.

### Phase 9 (2026-08-17, world presence, GO-LIVE, local-only per D22)
Branch fix/farming-phase-09-world-presence off feature/farming-plan at
26f330cea2; the seventeenth absorb ran first (the pre-flight section
above). Merged --no-ff into feature/farming-plan (hash in the notes tail);
the phase branch deleted. Farming is LIVE on the merged branch.

Acceptance (the phase file's list, with check states):
- [x] All four farmer NPCs exist at their hubs with the specified roles;
      the three new names are original and IP-safe per D17 and recorded in
      state.md: Farmer Jessica (Allotment Keeper, Eastbrook), Farmer Teasel
      (Fen Paddy Farmer, Fenbridge), Farmer Hollis (Highwatch Terrace Farmer,
      Highwatch), Farmer Verbena (Parterre Gardener, the Evergarden parterre).
      Audit: repo-clean, real plant words (jessamine, teasel, holly, verbena),
      not farmer NPCs in WoW, OSRS, Stardew, Palia, or Harvest Moon (Sedge,
      Sorrel, Osier, Tansy, Cress were rejected as taken or IP-adjacent).
- [x] Every stocked vendor row has a positive buyValue; a purchase probe of
      every row succeeds (tests/farmer_vendor_purchase.test.ts buys every row
      at every farmer through Sim.buyItem: item count up, copper down by the
      price, plus too-far and wrong-counter negatives).
- [x] Tier 3 and 4 seeds are stocked NOWHERE (the go-live arm in
      tests/professions_zone_rollout.test.ts: NEVER_STOCKED = the four
      tier-3/4 seeds, growth_tonic, three crafted hoes, nine dishes, on no
      NPC / heroic / delve counter, per-table non-vacuity).
- [x] q_farm_intro is acceptable at Jessica by a fresh character;
      requiredItems grants the rung-one hoe and one vale wheat seed; the
      objective credits the plant and harvest actions, not inventory; markers
      point at the Eastbrook beds (tests/farm_intro_quest_journey.test.ts,
      tests/farm_quest_objective.test.ts, tests/quest_targets.test.ts).
- [x] The completion text and Jessica's greeting both contain the magic
      sentence (verbatim pins in three suites; mutation M12 killed).
- [x] Husk conversion works in range of a farmer NPC and refuses out of range
      (both arms plus the exact boundary at 7 and one step past); the watch
      fee stays a plant-time bag payment with NO NPC range gate (the D9 arm:
      a knobbed plant far from every farmer succeeds and spends the fee).
- [x] The work-order rows pay floor(0.5 x summed vendor sellValue), carry the
      arithmetic comment, and tests/professions_work_orders.test.ts passes
      (wheat x8 -> 16, rice x5 -> 20; mutation M14 killed).
- [x] The R37 hub-stocking arms are on and tests/professions_zone_rollout
      passes (deviation (bl) for the flip shape).
- [x] The parity regen is verified mechanical and lands as its own commit
      (5676e12b73); tests/parity is green after it. Classification: 4594
      leaves an entity id +4, 1585 digests folding those ids, draws and
      draw digests byte-identical in every frame of every golden, the two
      remaining deltas explained (the culling wolf's private idle lane is
      seeded from its id; the farming_session player y follows the terrain
      under Jessica's calm pad); the full spawn roster is otherwise identical
      across three seeds. The SAME commit re-mints the terrain atlas, the
      Eastbrook chunk digest, and five map plates (deviation (bh)).
- [x] The full new-player journey probe passed on a live headless sim and its
      transcript is below; the throwaway probe file is deleted (tree clean).
- [x] The wiki is regenerated and the freshness gate passes.
- [x] Every new player-visible string is an English t() key or an
      entities.* content string with the five non-Latin fills; S3 passes.
- [x] tsc, the named suites, ci:changed, and gate_select are green (gate
      record in the notes tail).
- [x] Screenshots (desktop and mobile) of Jessica, the quest dialog, the
      gossip menu, and the vendor grid are committed under
      docs/screenshots/farming-phase-09.

Notes (the would-be PR body).
Summary: the go-live merge. Farmer NPCs (four, static, D23), the intro quest
on the q_prof_intro template with the new 'farm' action objective, vendor
stock, the husk-trade range gate and its dialog row, two produce work orders,
the R37 flips, the live guide page, i18n with fills, the deliberate golden and
terrain re-mints, and 4.2 MB of screenshots.
Commits (phase-side, after the absorb): 2953d6ccb2 the QuestObjective 'farm'
member; 2f22f9a5e9 the NpcDef farmer flag; b306ce44cb absorb ledgers; the
three slice merges 744eecc7cd (A: 383e942f13 NPCs + quest row, c22b313880
gate + gossip row, 7b38508688 R37 flips + probes, 63d5b49b07 the item fence),
9c69e7323b (C: 0d35513412 work orders, 6a4b7733d0 guide prose, 2ccf93f599
produce-only pin), 1112dc8218 (B: 134aff9bda credit arm, 53b808c67c marker
arm, aefa36f79a + a978639b7b docs rows, babc83b192 tests); 43330b54e8 the
sim.ts delegate comment (same line count); fd0c3df42b the end-to-end journey
suite; 5676e12b73 the isolated re-mint; acdc9d3dcb the thirteen Latin
work-order fills; 0bfbaa142b the review-round pins; then the docs, shot
targets, and screenshots commit(s) named in the tail.
Orchestration: three implementer agents in THREE SEPARATE git worktrees
(~/Documents/woc-farm-p9-{a,b,c}, branches p9/agent-{a,b,c}), because all
three slices touch zone1.ts and the i18n overlays (the Phase 5 shared-file
lesson): A = NPCs + vendors + the quest CONTENT ROW (tests/progression pins
giver-exists AND giver.questIds-includes, so Jessica and q_farm_intro must
land together) + the husk gate + the gossip row + R37; B = the credit arm and
marker with SYNTHETIC quests (the tests/profession_quest_objectives idiom);
C = work orders + the guide. Both shared shapes were landed by the
orchestrator first so every worktree compiled. Workflow delivered 3/3 first
try (zero deaths); the merges conflicted only on the generated pending.ts
(regen) and the Eastbrook payload digest (re-minted on the merged tree). The
review fan-out: architecture, cross-platform, frontend via Workflow (3/3);
content-obligations and test-coverage died report-less there (the recurring
custom-agentType class) and delivered first try on the Agent tool with the
report-via-SendMessage line; privacy-security likewise on the Agent tool.
Journey probe transcript (a live headless Sim, seed 9, injected advanceable
clock; the probe file was deleted afterwards):
  start: level 1, copper 500, bags empty of farming items
  accept q_farm_intro at Jessica: hoe=1 seed=1
  buy seed+compost+2 brook_carrot (the tier-1 watch fee is two produce): copper 500 -> 456 (expected -44)
  plant denies: []
  plant vale_wheat with compost+watch: farmPlanted=1, quest counts=[1,0], compost left=0, brook_carrot left=0
  advance 45 min: farmReady events=1 {"type":"farmReady","pid":964,"ready":1}
  harvest: farmHarvested=1 farmWithered=0 wheat=4 fine=0 husks=0 quest=ready counts=[1,1]
  turn in: state=done xp +150 copper +50
  convert husks beside Jessica: farmHusksConverted=1 compost=1 denied=[]
  convert husks 30 yd away: denied=["no_farmer"] compost=1
  craft cast started=true
  cook vale_hearth_loaf: loaf=1 known=true cooking=1
Notable facts the probe surfaced: the tier-1 watch fee is TWO produce (the
first knobbed plant refused with no_fee_produce on one brook_carrot; the
day-one shopping list is seed + compost + two carrots = 44 copper (seed 4 +
compost 8 + two brook_carrot at 16; the phase's own transcript said 500 to
456; the "28" this note first carried was an arithmetic slip the Phase 9 QA
corrected), and the intro quest's 50 copper covers it with 6 to spare); a plant credits at the call (the cast is
flavor); tick() hands the event buffer over and clears it, so a probe reads
events before ticking or from the tick return.
Review verdicts: architecture 0 BLOCKING / 5 SHOULD-FIX (all taken or
ledgered: the regen classification evidenced by the roster diff; the
garden_hoe fence ledgered at (bg) with the copper-pick precedent; the seed
faucet comment corrected; the grid-before-first-tick concern is covered by
the never-ticked harness suites; the boundary arm exists) / 4 NICE (the
seam pointer added; patchId pinned; the rest ledgered); cross-platform
APPROVE, 0 BLOCKING (patchId pin added; the no_farmer payload asymmetry
noted); frontend PASS-WITH-FOLLOWUPS, 0 BLOCKING (the range band is (bi),
the Latin work-order fills corrected, the literal pins added; the crafting
glyph reuse and the WCAG label-in-name split are family-wide nits, ledgered);
content-obligations PASS, 0 SHOULD-FIX (deeds and Reliquary correctly not
due; the map_doc flag, NPC_KEYS look, and voice render are residuals);
test-coverage PASS (five should-fixes all taken: seed price literals, the
alias pin replaced by the frozen-row guard, the guide name tie, the patchId
credit arm, positive controls); privacy-security SHIP-ABLE, 0 BLOCKING (the
trade pipe is (bg); refusal spam is rate-capped ahead of the heavy-self
re-diff; no SQL/auth/secrets/dev gating touched); qa-checklist in the tail.
Mutations (after committing, through a runner that refuses a dirty target
file): 14/14 KILLED with named reds: trade range +3, the gate dropped, the
withered-branch credit dropped, the plant credit dropped, the action match
dropped, the patchId marker filter dropped, Jessica's seed row dropped, the
seed fence dropped, Hollis's farmer flag dropped, the gossip row gated off,
the seed price retuned to 400, the magic sentence dropped from the
greeting, the seed dropped from requiredItems, the rice payout off by one.
Deviations decided in-phase: (bg) to (bm) in state.md (the grant fence and
its trade-pipe leak; NPCs are terrain pads; the offered-but-refused band;
the module-import credit arm; patchId marker-only; the R37 flip shape; two
orders per master). Deferrals: farming deeds and golden_harvest (Phase 10 by
plan; the deed totals to re-pin from are 273 / 3155 / 11 exploration
titles); NPC_KEYS look rows and voice line renders (Phase 13 art batch);
the map_doc farmer flag (editor curation call); the Latin farming fills
other than workOrdersNote (release fill); the trade-guard widening (bg).
Screenshots (LOW preset; mobile is landscape 844x390):
docs/screenshots/farming-phase-09/before-jessica-desktop.png and
before-jessica-mobile.png (the empty ground beside the Eastbrook beds at
identical framing), after-jessica-desktop.png / after-jessica-mobile.png
(Farmer Jessica beside the beds with the quest glyph),
after-gossip-menu-desktop.png / -mobile.png (greeting with both sentences,
the First Furrow row, Browse Goods, Trade husks for compost),
after-quest-dialog-desktop.png / -mobile.png (the First Furrow detail),
after-vendor-grid-desktop.png / -mobile.png (five goods with bulk rows:
Vale Wheat Seed 4, Brook Carrot Seed 4, Brook Carrot 16, Compost 8, Garden
Hoe 20). Captured with scripts/pr_screenshots.mjs through the four new
targets in scripts/pr_shot_targets.mjs (farmer-jessica,
farm-intro-quest-dialog, farmer-gossip-menu, farmer-vendor-grid; the
stageFarmerJessica helper); the before shots ran the same targets against
the pre-phase worktree's dev server, where the dialog and vendor targets
fail honestly (no farmer_jessica entity) and the world target falls back to
her authored spot.
Traps this phase: (1) tick() returns AND clears the event buffer (twice bitten:
read events before ticking, or from the tick return). (2) The vendor goods
grid paints a bulk-buy row under every stackable good, so five goods are
nine .vendor-item rows: count :not(.vendor-item-bulk). (3) A shot diff that
touches quest_dialog_controller.ts matches a dozen crafting targets and
times out the runner; narrow DIFF_FILE to the one new module. (4) `git
checkout --theirs` on a conflicted pin suite discards the branch's
non-conflicting arms (restore with `git checkout -m`). (5) Every NPC is a
terrain pad: seating one moves the atlas, the chunk digest, and the map
plates (bh). (6) The release re-records ITS goldens for a static-entity
shift and can never re-record the branch-only farming_session; classify
before minting.
GATE RECORD: run 1 on the frozen tree 35439199fc, `BROWSER_PATH=<playwright
chromium> GATE_MAX_WORKERS=8 node scripts/gate_select.mjs`: mode=full (the
planner's broad/unclassified arm on tests/fixtures/terrain_height_parity
.v1.f64le.gz plus tests/helpers/bare_client.ts), "[gate:select] PASS: all 12
steps green (vitest workers: 8)", 2859 test files / 40,034 tests passed, 2
expected fail, 115 skipped, zero "[gate:select] FAIL at" or "[gate] FAIL"
lines, no druid_engines timeout, full-suite vitest 823 s, browser regression
19 files 129 green, shell rc 0. gate-integrity-reviewer over the cone rows:
PASS (additive checkout only; the full fallback is owned by the terrain
fixture; the goldens, plates, and PNGs are inert nonCode with their consumers
on the always-run floor). qa-checklist: READY, 0 BLOCKING (its should-fixes:
the (bg) and (bh) maintainer reads, and the garden_hoe reagent knock-on now
in (bg)).
MERGE: fix/farming-phase-09-world-presence merged --no-ff into
feature/farming-plan as 695ab09bfb (phase tip dde3b0a59a; the branch deleted);
the agent worktrees woc-farm-p9-{a,b,c} and branches p9/agent-{a,b,c} removed
after the merge.

### Phase 9 QA (2026-08-17, FAIL on the go-live acceptance, scope stop; PASS on the phase's own diff; local-only per D22)
Branch fix/farming-phase-09-qa off feature/farming-plan at 2f0f2547de (the
QA-start commit); merged --no-ff into feature/farming-plan (hash in the
notes tail; the branch deleted). Audit target: the phase-side chain
2953d6ccb2 through dde3b0a59a of merge 695ab09bfb, the seventeenth-absorb
commits excluded (they carry their own audit).

Pre-flight: the EIGHTEENTH absorb opened the QA. origin/release/v0.39.0 had
moved to f42a67f341 (5 commits, 53 files, 43-file farming intersection: all
i18n overlays and resolved bundles plus src/sim/types.ts and
i18n.catalog/merge.ts; the druid feral enablement: Wolfsblood surge,
Redharvest ranks, earlier spenders, Savage Mending percentage, Stalk at 95
percent, the threatFlat replacement-walk fix). Merged as f4ca0f7000 with
ZERO conflicts (both intents present in the two overlap files: the
QuestObjective 'farm' member beside the hot pctOfMax; the farming catalog
rows beside the Stalk reword). No lockfile, patches, golden, or server/
movement, so neither the farm-props seal runbook nor the (am) golden
re-mint fired; i18n:gen and wiki:content byte-identical on the merged tree;
the (al) checklist held: the portrait manifest re-minted fingerprint-only
(the release moved classes.ts and talent_abilities_v2_b.ts inside the
stills bundle graph; 38178b71d7, the accepted-art registry row re-pointed),
item_art_audit --verify-only clean, tsc clean, the release's four suites
green on the merged tree; parity 216 green, farming_session md5 19c49aac
UNCHANGED, world_api_parity / snapshots / command_schema / monolith_budget
green. Release-merge audit run inline (5 commits, no farming semantics): no
legacy arm, no new endpoint, no injected helper, no premise moved; the
Phase 10 deed totals stand at 273 / 3155 / 11.

The live-client journey (the go-live acceptance): a puppeteer drive of the
real dev client (vite on :5188, offline Sim world, playwright chromium under
swiftshader, LOW preset seeded before boot, the camera prompt and gpu notice
suppressed) as a fresh warrior, 39 checkpoints, ALL GREEN on the fifth run
(runs 1 to 4 were probe defects: a shadowed URL global, bag-space and
seed-clearing artifacts of the purchase probe, a turn-in click race). What
it proved through the REAL UI: Jessica's gossip menu carries the quest row,
Browse Goods, and Trade husks for compost, and her greeting carries the
magic sentence and the journal pointer verbatim; the First Furrow detail
paints both objectives ("Vale Wheat planted: 0/1", "Vale Wheat harvested:
0/1") and the 150 xp / 50 copper reward; Accept grants hoe 1 + seed 1, and
a second talk grants nothing; the vendor grid paints five goods rows and
four Buy 20 bulk rows (the hoe excluded), every single row and every bulk
row purchase-tests clean at Jessica (4 / 4 / 16 / 8 / 20 copper), a broke
buyer is refused, and every row purchase-tests clean at Teasel (8 / 8 / 8),
Hollis (8) and Verbena (8) including their bulk rows once the probe cleared
its own bag space; Shift+K opens the Harvest Journal with the planted row
("Ready in 44m 57s", Sprout, Compost, Farmer's Watch) and the professions
window carries the Farming row with the Harvest Journal control; /dev
farmgrow advances the plot and the 1 Hz sweep paints "A crop is ready to
harvest."; the completion detail carries both sentences and Complete Quest
pays +150 xp / +50 copper; the [data-husk-trade] row converts 2 husks into
1 compost beside Jessica; 30 yd out and at 7.01 yd the trade refuses
no_farmer with the toast "You must be near a farmer to trade husks for
compost.", at 7.00 it converts; Cook Marlow trains recipe_vale_hearth_loaf
for free through trainRecipe and the loaf cooks at the Eastbrook kitchens
from the harvested wheat (cooking 0 to 1); Teasel, Hollis and Verbena offer
goods + husk trade and no quest row, and each converts in range and refuses
30 yd out. What it proved by ABSENCE: standing on bed_eastbrook_1 with the
granted hoe and seed, the interact key (F, twice) planted nothing and no
toast fired, the renderer exposes only gather-node and entity picks, and
no DOM control anywhere in the HUD is labelled plant, sow, or harvest; the
plant and the harvest then went through window.__game.sim.plantCrop /
harvestCrop, i.e. the debug surface. The knobbed plant far from Jessica
(8.86 yd, past FARMER_TRADE_RANGE) succeeded with the compost and the TWO
brook_carrot fee spent (D9 holds), and the day-one list cost 44 copper.
The (bh) eyeball: the Highwatch shelf framed from three angles reads as a
natural terrace, no mound, no re-seat (screenshots below).

Findings (nine lanes: correctness, coverage, dead code via Workflow;
architecture, cross-platform (redispatched on the Agent tool after an
empty Workflow return, the recurring class), frontend seam via Workflow;
content-obligations, test-coverage, privacy-security, qa-checklist on the
Agent tool with the SendMessage-first line, all delivered first try):
- BLOCKING (scope, NOT fixed here per the stopping rules): (bn) no
  client-side player verb plants or harvests a bed, so q_farm_intro is
  uncompletable by an ordinary player and the Live-surface note is unmet
  while the quest and its teaching copy are live. Every lane confirmed it
  independently; the qa-checklist verdict is NOT READY. Fix owner: the
  PROPOSED Phase 9b (docs/prd/masterwrought/farming/phase-09b-bed-verbs.md) or a maintainer
  re-dormanting of the quest and copy; details and the design recipe in
  state.md (bn).
- Packet-level design hole (not fixed): (bo) tier 3/4 seeds have no first
  faucet (seed-back returns the same crop's seed from tier 3+ only; the
  rare event is a yield multiplier); the Highwatch and Evergarden beds can
  never be sown; D11 ruling owed (options in the OPEN list).
- SHOULD-FIX taken: the husk-trade row dropped keyboard focus to <body>
  (first bindRoute consumer with no successor window; now closes with the
  trap's restore, pinned release(true)); the stale pre-go-live comments in
  the IWorldFarming facet and the farm recipes suite; the coverage pins
  (compost / husk item ids by literal; the four seats and the spawned stock
  by literal, replacing a def-vs-def round trip; the vendor walk's width;
  the produce orders' 8 for 16 and 5 for 20; the intro seed's fence through
  sellItem and marketList with the bought seeds as the negative; the online
  no_farmer arm over the wire with a positive control; the busy-farmer
  no-farmPlanted arm; the journey suite's layer-honesty header and its
  bags-received arm).
- SHOULD-FIX ledgered, not fixed: the (bg) faucet has no terminator while
  (bn) stands (security lane); the requiredItems grant bypasses bag
  capacity (pre-existing q_prof_intro template, visible as 17/16); the
  map_doc farmer flag; the tier 3/4 gap above.
- NICE-TO-HAVE ledgered: the guide's "Shift+K" without "by default" (a
  translated-key reword, release fill); the WCAG label-in-name aria
  (family-wide); the icons.ts ITEM_ART_PENDING rationale comment (art
  fingerprint family, Phase 13); nearFarmerNpc's no-early-out; the
  hasFarmer static-flag assumption (now pinned by comment); the credit-route
  registry comment (pinned by pointer, (bj)); patchless farm objectives
  would circle every patch (latent, none shipped); questObjectiveAreas is an
  if/else chain (a future type falls through silently).
- Doc corrections: the day-one shopping list is 44 copper, not 28.
Mutations (after committing, through the scratchpad runner that refuses a
dirty target file, applies one exact-string mutant, records rc + failing
test names + the summary line, restores via git checkout): 16 of 16 NEW
mutants KILLED with named reds (the list in state.md (bn) paragraph).
Screenshots (LOW preset, desktop): docs/screenshots/farming-phase-09/
qa-highwatch-shelf-low.png and qa-highwatch-shelf-overview.png (the (bh)
eyeball frames around Farmer Hollis).
Baselines HELD: commands 202/215, IWorld 329 = 88 + 241, facets 34, delta
keys 87, farming_session golden 19c49aac; hud.ts, renderer.ts, main.ts,
sim.ts untouched by the QA; no golden moved.
Handoff: the maintainer decides (bn) and (bo) before Phase 10 proceeds on
the assumption that players can farm; the proposed 9b starter is in
docs/prd/masterwrought/farming/phase-09b-bed-verbs.md.
GATE RECORD: run 1 on the frozen tree dc17a3f747, `BROWSER_PATH=<playwright
chromium> GATE_MAX_WORKERS=8 node scripts/gate_select.mjs`: mode=full (the
planner's broad/unclassified arm on tests/fixtures/terrain_height_parity
.v1.f64le.gz plus tests/helpers/bare_client.ts, as recorded for the phase),
"[gate:select] PASS: all 12 steps green (vitest workers: 8)", 2859 test
files / 40,043 tests passed (the phase's 40,034 plus the QA's nine new
pins), 2 expected fail, 115 skipped, zero "[gate:select] FAIL at" or
"[gate] FAIL" lines, no druid_engines timeout, full-suite vitest 838 s,
browser regression 19 files 129 green, typecheck and the env/server/bot
builds green, shell rc 0.
MERGE: fix/farming-phase-09-qa merged --no-ff into feature/farming-plan as
59584a800a (QA tip 224fdd138c; the branch deleted).

### Nineteenth absorb (2026-08-18, the v0.39.0 round-2 sync mid-phase, local-only per D22)
Branch fix/farming-sync-v0.39.0-r2 off feature/farming-plan at e3dd4a07cf.
origin/release/v0.39.0 had moved f42a67f341 to 7b45fdb9a9 (285 commits, 833
files, 168-file intersection with the farming footprint), firing the D22
triple-digit sync-mid-phase rule, so the absorb ran on the phase-06b template
BEFORE Phase 9b. Headline release systems absorbed: the druid shapeshift
auto-unshift (verified NO interaction with the plant cast: plantCrop sets the
farming cast directly and never enters castAbility; the classifier triggers
only on healing/damaging defs), the three Highwatch practice dummies (39 yd
from the nearest thornpeak bed, inert, no pad), the ogre body replacement, the
battleground unstuck scoping, the v0.39.0 release-tier locale fill (the five
non-Latin farming overlays survived byte-identical; the 660 Latin farming rows
stay pending by design for the release-time fill), the whole-slot item-lock
rework, the mech chroma permanence rework, and the DelveInteriorTracker.
Commits: b9a025b2ee merge (81 conflicts: 67 goldens + terrain fixture +
pending.ts + the (al) evidence pair + 4 Eastbrook JSONs taken release-side for
re-mint; renderer.ts, monolith_budget, pr_shot_targets both-blocks stitch, and
the two Eastbrook pin suites hand-resolved hunk by hunk); 09ff58d75b the
monolith heals (mech chroma pair moved whole to the release's own
src/sim/mech_chroma_ownership.ts, Sim satisfying the structural host,
ItemUseResult moved and re-exported; the Cloudflare Turnstile cluster moved
whole to src/game/turnstile_gate.ts; main.ts ceiling lowered 11490 to 11460);
the renderer import fixup + pending.ts regen; 5c5a08a47c the (al) portrait
re-mint (fingerprint-only, registry re-pointed, --verify-only clean);
bc203c0ae3 the Eastbrook seal re-mint (remint_polish_provenance.mjs, three pin
literals from its printed values); the terrain fixture re-record (the release
grew the corpus +76 points; 29 moved points vs the release recording, ALL
inside the four farmer pad footprints, max 4.31 yd under Hollis, zero
outside); 9a16a50e16 the classified golden re-record (67 release recordings
gain the branch's +4 farmer statics: uniform id shift incl. summonedIds,
attemptParticipantIds, personalFor, crafter, chargeTargetId,
wardChannels.objectId, paired digests, and the culling wolf's known idle-lane
re-seed; farming_session gains the release's +3 dummies with rng lanes and
draw counts byte-identical: the second (am) firing, md5 19c49aac to 9a8fefa5);
the lock-rig rebuild (grant-around-a-lock, assertions unchanged); c60e733e7e
the direct mech_chroma_ownership unit suite (architecture review should-fix).
Reviews: 4-lane release-merge-audit Workflow 4/4 first try (overlaps CLEAN
with byte-level ort-reproduction proof over 21 auto-merged files and a
hand-resolution audit of pr_shot_targets; surfaces CLEAN, zero added
routes/commands, setItemLocked fully re-bound, db-mock premise verified
empty); premises FINDINGS all taken (this docs sweep); headline CLEAN);
cross-platform-sync APPROVE (0 BLOCKING; farming facet untouched, fplot delta
semantics verified both directions, all six farm events handled);
architecture-reviewer clean move (0 BLOCKING; move fidelity
statement-for-statement, purity, draw order, SimContext contract all pass).
Release-hygiene flags recorded, not fixed (release-owned): the server's
unequipAccountMechChroma hand-rolls the extracted rule (equivalent today via
setPlayerSkin lockstep; drift hazard if the rule grows); the new self-wire
field sm is unpinned in the snapshots registry (omit-when-default base field;
absent-means-zero decode is correct only while it stays OFF the maybe() gate);
three release-authored db-mock tests omit lease exports they never reach.
The ONLINE_WORLD_LAYOUT_VERSION farming go-live question joined the state.md
OPEN list. Count baselines HELD: 202/215, IWorld 329 = 88 + 241, facets 34,
delta keys 87. Monolith after heals: hud 19382/19387, renderer 13774/13774,
main 11454/11460, sim 12657/12660, server/game 10791/10900.
QA-checklist verdict READY (0 BLOCKING); its three should-fixes taken: the
renderer ceiling re-pin annotated as a maintainer decision prepared for
feature review (funded by discarding the branch scheduler extraction), the
payment-walk lock arm gained a direct locked-above-unlocked index assertion,
and the two silently auto-merged third-shape files were eyeballed (the
src/net/online.ts hunks are the release's own chroma-permanence rework plus
the sm decode, coherent and cross-platform-approved; tests/architecture.test.ts
gains the release's foliage_decimation_core RENDER_PURE_CORES row). Honest
note from the same review: a green parity run over freshly re-recorded
goldens is circular by construction; the evidence is the machine
classification, not the green run.
GATE RECORD: run 1 on the frozen tree 44619e5ab6 (BROWSER_PATH=<playwright
chromium> GATE_MAX_WORKERS=8 node scripts/gate_select.mjs, mode=full on the
terrain-fixture broad arm) FAILED at the full vitest step with exactly two
reds, both the fallback-only census class: the release's npc-looks roster
(tests/npc_looks.test.ts) demands an authored look for every NpcDef and the
four farmers still leaned on the villager fallback (healed by authoring four
distinct rows in the release's own mechanism; validity, distinctness, and
manifest arms green; portrait manifest byte-identical), and the shard-weight
coverage floor (tests/ci_shard_partition.test.ts) fell to 94.5 percent
against the merged tree (healed by re-harvesting through the sanctioned CLI
from green full-mode upstream run 32190441549, 2851 files). Heal commit
9c17ac093f (also completes the chroma test's cosmetics literal, a tsc-only
catch). Run 2 on the frozen tree 9c17ac093f: "[gate:select] PASS: all 12
steps green (vitest workers: 8)", mode=full, 2881 test files passed / 12
skipped, browser regression 20 files 131 green, zero FAIL lines, shell rc 0,
no druid_engines timeout.

### Phase 9b (2026-08-18/19, the bed verbs, local-only per D22)
Branch fix/farming-phase-09b-bed-verbs off feature/farming-plan at 6981105f27
(the nineteenth-absorb merge; the sync ran first as its own mid-phase, its
record above). ADOPTED via the maintainer-authored starter prompt (2e6fcb42b9).

WHAT SHIPPED (the would-be PR body): an ordinary player now plants a seed into
a garden bed and harvests a ready or withered plot from the game client. The
interact funnel (main.ts interactKey: desktop KeyF, the mobile-interact
button, the gamepad edge action, one call site) gained a garden-bed arm below
gather nodes and above the escort-away last resort: the pure resolver
src/game/farm_bed_interact.ts picks the nearest bed within INTERACT_RANGE
(inclusive, mirroring the sim's exclusive deny) and a bed with MY plot sends
world.harvestCrop (the sim's own farmDenied not_ready answers a growing plot;
the client never reads plot.status), while a free bed opens the plant sheet.
The sheet is the pure core src/ui/farming_plant_sheet_view.ts (UI_PURE_CORES;
sowable seeds by bag/skill/wielded-hoe with per-gate denied.* reasons, knob
affordability from unlocked counts and planWatchFee, no outcome prediction)
plus the cold painter farming_plant_sheet_window.ts (HarvestJournalWindow
recipe: deps bag, focus trap, closeManagedWindow case, panel keydown guard,
relocalize arm) composed by Hud inside headroom freed by moving the report
window body whole to src/ui/report_window_open.ts (renamed to
src/ui/report_window.ts by the 9b QA; ceiling 19387 to 19352,
hud.ts final 19351). One Plant activation sends plantCrop(bedId, cropId,
knobs) exactly once; the sheet stays open; farmPlanted for the bed closes
with focus restore, any farmPlanted clears the send arm, a deny re-arms and
repaints; a same-bed re-press keeps the picks, a fresh bed resets them.
The i18n mint is five plantSheet keys (title, plant, sowAria, empty, close)
with the five non-Latin fills each (M16); knob labels ride itemDisplayName
and the journal's careWatch key; deny lines reuse hudChrome.farming.denied.*.
NO IWorld member, command, wire field, SimEvent, src/sim, or server change;
zero golden movement; baselines held (329 = 88 + 241, 34, 202/215, 87,
farming_session 9a8fefa5).

JOURNEY (the go-live acceptance, scripts/farming_journey_e2e.mjs, committed;
17 checkpoints, PASS on the final merged tree and in lane C's runs on both
viewports): boot LOW offline -> stage beside Jessica -> interact opens her
dialog -> accept First Furrow through the gossip row -> stage onto
bed_eastbrook_1 -> interact opens the plant sheet (title, vale_wheat seed row,
three knobs, Plant) -> Plant through the sheet DOM -> sheet closes on
farmPlanted, tracker 1/1 planted -> /dev farmgrow (the one sanctioned dev
command) -> interact harvests ("You bring in: [Vale Wheat] x3.") -> turn-in
pays +150 xp +50 copper -> quest leaves the tracker. window.__game was used
only for staging positions and reading xp/copper, never for a verb.

REVIEWS: cross-platform-sync APPROVE 0 BLOCKING (facet untouched, fplot
delta semantics verified both directions, the one-snapshot bed-verb staleness
online self-heals through the sim deny and is ledgered here as accepted);
frontend-seam 0 BLOCKING with 7 SHOULD-FIX, ALL taken (7c97ca51d1);
test-coverage 3 BLOCKING all closed (B1 the journey landed and passed on the
final tree, B2 the comment-stripped Hud glue pin, B3 the both-entries root
pin) and S1-S7 all landed; gate-integrity PASS (all five cone blocks plus the
literal verified job-anchored, no-sixth-copy, fails toward more checkout; its
one WARNING, that the plan doc is the only counting reference to the
screenshot subtree, is moot under D22: the branch ships WHOLE, docs included,
and the pin fails loud not silent); qa-checklist verdict in this block's
tail. Mutations 10/10 KILLED with named reds through the dirty-refusing
runner (decide polarity, double-send, knob payload dropped, range off by one,
harvest call gutted, mobile unwired via the pad_reel order pin, Hud glue
gutted, same-bed reset regression, any-bed clear dropped, bed preempting the
node arm).

DEFERRALS AND RESIDUALS: the world-space bed affordance (highlight or ripe
marker) is DEFERRED per the phase file's own clause (renderer.ts at zero
headroom; a src/render sibling can land in a later phase without the seals
churn); the online one-snapshot verb staleness (xplat NICE-TO-HAVE) accepted,
self-heals; the stale online.ts professionsState comment (release-owned,
pre-existing) recorded; the sheet's cold-paint bag staleness while open heals
through the deny round-trip (frontend NICE-TO-HAVE, accepted); the disabled
knob contrast eyeball rides the Phase 9b QA's manual pass.
GATE RECORD: run 1 on the frozen tree 8bcb6e8410 (BROWSER_PATH=<playwright
chromium> GATE_MAX_WORKERS=8 node scripts/gate_select.mjs) FAILED at the
early "biome (changed files)" step: the late farmer-at-the-beds arm insert
carried an overlong literal line (a format diff, error-severity); healed by
the scoped format commit 679b0cfd77, nothing else moved. Run 2 on the frozen
tree 679b0cfd77: mode=full (the terrain-fixture broad arm),
"[gate:select] PASS: all 12 steps green (vitest workers: 8)", 2885 test
files passed / 12 skipped, 40334 tests passed / 2 expected fail / 115
skipped, browser regression 20 files 132 green, zero FAIL lines, shell rc 0,
no druid_engines timeout. The journey (scripts/farming_journey_e2e.mjs) also
passed 17/17 standalone on the final merged tree before the gate.
MERGE: fix/farming-phase-09b-bed-verbs merged --no-ff into
feature/farming-plan as 1f92aaa5c555c3997a0de14af19329f8b9837add (phase tip 632ee5090e; the branch and the
three agent worktrees deleted).

### Phase 9b QA (2026-08-19, the bed verbs audit, local-only per D22)
Branch fix/farming-phase-09b-qa off feature/farming-plan at c9075785ef (the
Phase 9b merge-hash record). The TWENTIETH absorb opened it:
origin/release/v0.39.0 had moved 7b45fdb9a9 to ea9377db8e (ONE commit: the
release fills thirteen Latin bases for guide.classPage.formsAutoUnshift,
regenerates the resolved bundles, and gives the legacy druid and hunter
skill-art suite a 60s budget). Merge 919787518a; the only conflict was the
generated pending.ts, regen-resolved through npm run i18n:gen, and the
regenerated file differs from the branch side by EXACTLY the fifteen
formsAutoUnshift rows the release filled (diffed and counted). No lockfile,
patches, sim, server, golden, art-evidence, or monolith movement; the
release-merge-audit lanes are all empty for a delta this shape;
item_art_audit --verify-only green; the four count suites plus the full
tests/parity re-run green on the merged tree; farming_session md5
9a8fefa5e48c7e456db7ef2695bfb284 HELD.

THE PLAYER JOURNEY, RE-PROVEN INDEPENDENTLY: the committed
scripts/farming_journey_e2e.mjs passed 17/17 on this tree, desktop AND
844x390 landscape touch (the mobile run drove the real #mobile-interact
button; the touch interface was active headless). The manual re-walk over
the dev client covered what the script cannot see, 18 numbered probes all
green: focus lands inside the sheet on open (the close button) and six Tab
presses stay trapped; Space and Enter on a focused seed row neither jump nor
open chat while the sheet stays open (with a POSITIVE control proving the
probe can detect a jump, dy 0.98 with world focus); Escape closes with focus
returned to the world; the bags open beside the sheet (transient-overlay
model) and locking the only seed through the bag context menu leaves the
cold sheet's stale offer up, Plant then draws the sim's own locked deny
toast ("An item that would pay for that is locked."), the sheet STAYS OPEN
and repaints the seed into the locked list (the (bp) offer-gate refinement
observed live end to end); the ja_JP locale switch through the real options
dropdown reopens the sheet titled the ja fill, and dispatching the
woc:languagechange event over an OPEN sheet rebuilds it in place (the
relocalize arm; instrumented dispatch of the same event the language switch
emits, recorded as such since opening the options menu itself closes the
sheet). Mobile: all three knob toggles measure 44px tall (Plant 72x44, seed
row 410x44, close 40x40) and the disabled-knob shortfall line measures
8.95:1 contrast (rgb(255,143,133) on rgb(10,10,15)); the eyeball capture
pair is committed as qa-plant-sheet-disabled-knobs-mobile.png and
qa-plant-sheet-844x390.png beside the phase's six evidence PNGs
(plant-sheet-open/-knobs/harvest-toast, each -desktop and -mobile). Gamepad:
verified-by-pin (tests/pad_reel.test.ts pins interactKey() inside the pad
interact case; no physical pad on the headless box). perf:tour ran clean
(exit 0, zero threshold failures, FCT cap-bounded; the single-digit fps is
swiftshader-environmental). The farmer-shadow geometry was probed live:
standing ON bed_eastbrook_2 (4.3 yd from Jessica) the press opens her
dialog, the pinned NPC-over-bed precedence, and the far side of the same
bed opens the plant sheet, so the bed stays plantable; recorded as a UX
nuance, not a defect.

NEGATIVE SPACE, EACH PROVED BY RUNNING THE PIN: the phase-range diff over
src/sim, server/, src/world_api, src/net, and tests/parity is EMPTY; the
count suites pin 329 = 88 + 241, facets 34, commands 202/215, delta keys 87
(all literals verified in-suite and green); farming_session 9a8fefa5
unchanged and the full parity directory green; the terrain height fixture,
Eastbrook digests, and map plates carry zero bytes of phase movement and
their suites pass; the phase LOWERED the hud.ts ceiling (19387 to 19352)
and touched no other ceiling.

REVIEWS (all fresh, trusting none of the phase's own): a 4-lane Workflow
(correctness, coverage, dead-code, frontend-seam) delivered 4/4 first try;
cross-platform-sync and test-coverage-auditor on the Agent tool with the
SendMessage-first line delivered first try; qa-checklist last. Verdicts:
cross-platform APPROVE (the no-parity-change claim verified empirically;
the accepted one-snapshot staleness reasoning re-proven STRONGER than the
phase claimed: plantCrop's bed_taken gate precedes every payment, so a
stale send can only buy a deny with nothing consumed); frontend-seam 0
BLOCKING; coverage and dead-code lanes 0 BLOCKING; test-coverage
approve-with-followups (no vacuity in the phase's own arms; the hunt list
came back decisive). THE ONE BLOCKING (correctness lane, confirmed by
probe): plantCrop's dead and busy gates answer via ctx.error, never
farmDenied, so a Plant clicked while eating or casting stranded pendingSend
and left the control dead until a close; FIXED as deviation (bq), the
error-toast re-arm (PlantSheetWindow.notifyErrorToast, forwarded from the
Hud's one error case; re-arms without repainting; the re-click stays safe
under the sim's own gates).

QA FIXES (commits 208d2d048d, e97bab4e00): the (bq) re-arm; the
report_window_open.ts to report_window.ts rename so the hud_perf_budget
cold-painter sweep governs it like every sibling window, plus its first
direct suite (tests/report_window.test.ts: hooks-gated open, the LIVE hooks
read at submit, pid-vs-name routing, failure re-enable with the localized
line, both close paths); safe-area-inset subtraction on the mobile sheet's
width/height caps (the centered-card form of the journal's four-edge pin);
the close button's title attribute (the report-window twin's shape); the
journey script's mobile arm now FAILS on an inactive touch interface
instead of silently degrading to KeyF. Pins hardened: the reachability
scan reads through the shared stripComments helper (a trailing comment can
no longer satisfy a verb pin); the Hud glue pins assert containment inside
uniquely-anchored once-counted blocks and grew the close-route,
error-forward, and keydown-guard rows; a journey layer-honesty pin (the
script may never call sim.plantCrop / harvestCrop / convertHusks /
acceptQuest / turnInQuest, with positive arms so a gutted script also
reds); closeOthers called once on fresh open and never on a same-bed
re-press; the markDialogRoot contract; the locked-only body state; the
rowless professionsState default (the ?? 0 skill read); the root div
exactly once per entry; lockedRows length pins; and a real-painter
plant-sheet arm in the target-size browser suite (five controls on the
40px touch floor).

MUTATIONS 11/11 KILLED with named reds through the dirty-refusing runner:
NPC-vs-bed precedence inverted, the dead-player gate dropped from the bed
arm, canOpenPlantSheet inverted, the relocalize arm gutted, the sowAria
key swapped, the fee-plan legs dropped, the scanner filter widened (the
fail-toward-missing proof: four describes red), all killed as shipped;
the keydown-guard row removal and the journey-script __game-verb cheat
SURVIVED as shipped (both diagnosed real coverage gaps, both fixed, both
re-proven killed by the new pins); plus two fresh mutants over the QA's
own fix (the Hud error-forward gutted, the notifyErrorToast body gutted),
both killed.

DEFERRALS AND RESIDUALS, LEDGERED WITH OWNERS: the online pendingSend
stranding on a silently-dropped command (spectate, reconnect) is narrowed
by (bq) but not closed (no event ever answers a dropped send); it
self-heals on close/reopen and is family-consistent with every window
under spectate (maintainer read, optional). A bedId-free deny racing an
in-flight plant send can re-arm early; harmless to state under the sim's
gates, at worst a second deny toast (accepted). The mobile-window-open
body-class gap is FAMILY-WIDE (the harvest journal shares it; opening
never sets the class, close clears it): Phase 13 polish or maintainer.
The seed rows render single-select through the aria-pressed toggle family
(a radiogroup would be bespoke here): a11y polish batch, Phase 13. The
countRawInSlots raw-count loop is now the fifth private copy in src/ui
and the bed-distance mirror re-derives the sim's private distToBed by
comment contract; both extractions need src/sim edits (forbidden this
QA): a later farming phase. The journey script runs at phase closes and
by hand, not in the gate (D22 keeps farming off CI; the layer-honesty pin
plus the component pins stand in): maintainer call at go-public. The
focus-key selector interpolation without CSS.escape is the family idiom
(the journal shares it): note only. The .ps-seed raw rgba and the moved
report window's #ffd100 literal: the Phase 13 style batch.
QA-CHECKLIST VERDICT (the last lane, run over the QA branch's own diff):
READY, zero BLOCKING; its two CSS SHOULD-FIXes were both taken in the
round-two commit (the caps clamp var(--app-vw), never raw 100vw, per the
layout.css .window contract; a CENTERED card clears an asymmetric
landscape notch only by twice the LARGER inset, so both axes subtract
2 * max() of their env() pair) together with its missing-pin finding (a
CSS-text pin anchors the mobile rule once and demands the app-viewport
tokens plus all four inset terms) and its missing-evidence finding as far
as headless allows (a 400px-viewport probe measured the resolved width at
exactly 380px, proving the calc parses and applies; a true notch capture
needs a real device, recorded honestly). Its adversarial pass also named:
hud.ts now at ZERO headroom (19352/19352, flagged to Phase 10:
extraction-first for any new Hud line), the unconditional error forward
(the safety argument verified against the sim's own gate order: dead and
busy precede bed_taken and every deny consumes nothing), and the missing
in-flight aria-busy affordance (pre-existing, the a11y polish batch).
GATE RECORD: run 1 on the frozen tree 557e7df147
(BROWSER_PATH=<playwright chromium> GATE_MAX_WORKERS=8
node scripts/gate_select.mjs): mode=full (the terrain-fixture +
bare_client broad arm), "[gate:select] PASS: all 12 steps green (vitest
workers: 8)", 2886 test files passed / 12 skipped, 40355 tests passed / 2
expected fail / 115 skipped, browser regression 20 files 133 green, ZERO
FAIL markers, no druid_engines timeout.
MERGE: fix/farming-phase-09b-qa merged --no-ff into feature/farming-plan
as 710c03106424b68c49902421ab6c21ff4d37d5d1 (QA tip e456ac368c; the
branch deleted).

### Phase 10 (2026-08-19, celebrations, local-only per D22)

THE WOULD-BE PR BODY. Farming gets its lottery moment and its permanent
records. golden_harvest joins the gatherRareEvent union as the fourth
flavor: rolled unconditionally inside harvestCrop's one contiguous draw
block, AFTER the seed-back roll (every probed band held), via the SHARED
GATHER_RARE_EVENT_CHANCE (1 in 90) and GATHER_RARE_EVENT_YIELD_MULT (5),
never a farming copy. The new draw contract: plant 2 (unchanged), harvest
tier 1/2 EXACTLY 1, tier 3/4 EXACTLY 2 contiguous, every deny 0; the win
applies only on the survived branch (five-fold count AND fine after the
stored-seed expansion, signed instances up to fit with the plain
overflow-tolerant remainder, zone-announced through the one
announceGatherRareEvent path with structural source {zoneId, type:'crop'}).
One belief gates win, announce, and deed mark; the announce names the
all-fine collapsed item id. The payload's nodeType leaf widened to
GatherRareEventSource (GatherNodeType | 'crop') so farm beds never join
GatherNodeType; no new SimEvent, IWorld member, command, or wire field.
Celebration marks: farm:planted at plant success, farm:<zone> on a
survived harvest (onCropHarvestedForDeeds over FARM_CHRONICLE_ZONES, the
ZONE_FISH template; 'farm' registered in VISITED_MARK_NAMESPACES with a
save/load round-trip arm). Seven D13 deeds: prog_first_planting ("Sow It
Begins", 5), chr_vale/marsh/peaks/evergarden_first_harvest (5 each),
col_golden_harvest ("Golden Harvest", 0, visible, the col_pristine_vein
family), prog_farming_100 ("Harvestmaster", 10, gathering farming 100,
title 'Harvestmaster'). Totals re-pinned 280 deeds / 3190 renown / 43
titles + the frozen sha; the amount-aware farming guard arm the repo's own
caveat demanded; the (bo) honesty arm (self-clearing over NPC vendorItems +
HEROIC_VENDOR_STOCK + DELVE_SHOPS). Harvestmaster joined
RELIQUARY_HORIZON_TITLES (shape pins 341/376/horizons_titles 41) and its
crest shipped COMMITTED (the title shelf forbids fallback art, deviation
(bt)); the six untitled deeds ride DEED_ART_PENDING with icon briefs. The
HUD case stays single (all four flavors, epic color, finder-only
achievement plus the layered finder-only ui_farm_golden sting on the
feedback gate; manifest family committed together, sfx:check green). i18n:
gatherEvent.goldenHarvest English + the five M16 non-Latin fills; deed
text stays English-only per the release-refill protocol. hud.ts SHRANK:
the ability-tooltip line builders extracted to
src/ui/ability_tooltip_lines.ts (registered bare-named pure core, direct
suite, a latent NaN spellHaste read fixed), ceiling LOWERED 19352 to
19230, final 19227. farming_session re-recorded ONCE in an isolated commit
(11 to 16 draws, five harvests times one roll, no golden win on seed 1;
md5 9a8fefa5 to 83c3478142deabbffbf23912575873e9); zero other goldens
moved.

MAINTAINER FLAGS: (1) the (bs) dormancy waiver in docs/design/deeds.md
(prog_farming_100 + feat_book_complete parked until D11); (2) the D12
cadence read: 1/90 per HARVEST is far rarer in wall-clock terms than 1/90
per node swing, and withered harvests burn rolls, so the realized
celebration rate is 1/90 times survival; retune is one shared-constant
decision away, deliberately not taken; (3) the second v0.39.0 deed-locale
fill pass: these 7 deeds add 15 manifest rows (7 names, 7 descs, 1 title)
unfilled in 20 locales, and the v0.39.0 fill chore predates them; (4) the
Steam/Epic achievement mapping deferral (no ACH_ row; hard cap 100 names);
(5) the silent signature truncation on full-bag golden wins (the
gatherDowngrade surface union stays 'node' | 'corpse'; follow-up: 'crop').

REVIEWS: architecture 0 BLOCKING (its all-fine announce SHOULD-FIX taken
with a probed-seed arm, yieldSeed 404006; its aliasing comment and
exhaustive-switch notes taken); cross-platform PASS (0 BLOCKING; the
single-belief gate taken; the release-tier i18n caveat ledgered as flags 3
above); frontend-seam 0 BLOCKING (the pure-core registration, the
tsc-exhaustive flavor table, and the cue occurrence-count pins taken; the
ja_JP fill reworded to the idiomatic harvest noun); content-obligations
REQUEST CHANGES on ONE point, resolved via the recorded waiver its own
report proposed as option (c) (D13, a locked state.md decision, mandates
the deed this phase; deferral would contradict the packet); qa-checklist
READY, 0 BLOCKING (its feat_book_complete waiver sentence and the two
cross-reference comments taken; its client-exhaustiveness SHOULD-FIX was
already delivered as the satisfies-table in tests/gather_event_i18n.test.ts,
which reds tsc on a fifth flavor).

MUTATIONS 13/13 KILLED with named reds through the dirty-refusing
scratchpad runner, after committing: tier-gated roll (M1), forked
always-wins local chance (M2), multiplier dropped (M3), signature dropped
(M4), rng in the deed hook (M5, 19 reds), FARM_CHRONICLE_ZONES widened
(M6, both bijection arms), cue key unwired (M7), HUD golden key collapsed
(M8), sting guard definder-ed (M9), announce unguarded (M10, later re-run
as M10b against the single-belief text, 12 reds), luck deed gaining renown
(M11), roll removed (M12, 27 reds). PROCESS LESSON: the mutation battery
ran while a reviewer was reading the same worktree and the reviewer caught
mutants in flight; future batteries run only while no reviewer reads the
tree (or in a clone).

VALIDATION: npx tsc --noEmit clean; the STEP 3 battery + count suites (18
files, 1294 tests) green; full tests/parity green after the isolated
re-record (216); guide/sfx/portrait freshness + the v039 icon-art seal
green; ci:changed rc 0. Baselines held: IWorld 329 = 88 + 241, facets 34,
commands 202/215, delta keys 87; renderer.ts untouched.

GATE RECORD: run 1 on the frozen dcb6e2d88e-era tree FAILED at the
full-suite vitest step on exactly ONE test, the recorded
fallback-only-census class again (tests/profile_page.test.ts pins the
profile page's interpolated Reliquary character-completion total at the
live-catalog literal; the Harvestmaster shelf cell moved it 311 to 312);
the shell exit was 0 while the log said FAIL, the log-marker rule
re-confirmed. Healed and folded into the deeds commit. Run 2 on the frozen
tip dd9d3bd7d4 (BROWSER_PATH=<playwright chromium> GATE_MAX_WORKERS=8
node scripts/gate_select.mjs): mode=full (the terrain-fixture +
bare_client broad arm), "[gate:select] PASS: all 12 steps green (vitest
workers: 8)", 2886 test files passed / 12 skipped, 40393 tests passed / 2
expected fail / 115 skipped, browser regression 20 files 133 green, ZERO
FAIL markers, no druid_engines timeout.

MERGE: fix/farming-phase-10-celebrations merged --no-ff into
feature/farming-plan as 40988c8b3b0306b857a7ef87f750ddf761b6b4e7 (phase
tip dd9d3bd7d4; the branch and the three agent worktrees deleted).

No screenshots: the visible change is a chat-log line (existing epic-color
family) and an audio cue; no window, layout, or style surface moved.

### Phase 10 QA (2026-08-19, verify celebrations, local-only per D22)

VERDICT: PASS-WITH-FOLLOWUPS. The phase's claims all held under independent
re-verification; every finding was a coverage or hygiene gap, none a live
defect. Branch fix/farming-phase-10-qa off 8a466e898f; no absorb needed
(origin/release/v0.39.0 still ea9377db8e). The stale not-started Phase 10
placeholder row above was removed as table drift in the same pass.

INDEPENDENT VERIFICATION (the five mandatory emphases plus the two VERIFY
items, each proven by running, never by prose):
- Totals re-pin EXACT: old suite pins 273/3155/42 (git show 0afde346ab),
  new rows sum to +7 deeds / +35 renown / +1 title from
  src/sim/content/deeds.ts itself; new pins 280/3190/43 match.
- No forked draw order: the phase diff moved ONLY
  tests/parity/golden/farming_session.json; the golden directory is
  byte-identical between merge 40988c8b3b and HEAD; full tests/parity green
  (216) before and after the QA fixes; farming_session md5 83c34781 held
  throughout.
- Instance exclusion proven LIVE: a throwaway multi-observer Sim probe
  (real plant + harvest on the probed winner stream, seed 280) fanned the
  golden announce to the finder and a same-zone bystander ONLY; an
  out-of-zone player and an instanced player (x past DUNGEON_X_THRESHOLD)
  received nothing; marks and all three deed grants landed on the tick.
- PLAYED AS A PLAYER: the captured winner payloads replayed through the
  LIVE client (dev server, puppeteer, the module-singleton audio facade
  wrapped in-page): the epic line rendered in rgb(163,53,238) for finder
  AND bystander, achievement + sting fired for the finder only, a
  pristine_vein control fired achievement without the sting.
- (bs)/(bt) coherence: docs/design/deeds.md waiver, the deed row comment,
  and the honesty arm tell one story (TWO dormant deeds incl.
  feat_book_complete transitively); crest committed at 128x128 WebP,
  DEED_ART_PENDING exactly 8, DEED_IMAGE_IDS 272, all art suites green.
- The VERIFY items: npm run test:browser standalone 20 files / 133 green;
  perf:tour exit 0, zero threshold failures, FCT cap-bounded (the
  single-digit fps is the recorded swiftshader environment, the 9b shape).

REVIEWS: 8 lanes delivered (3 Workflow audit lanes + architecture,
cross-platform, content-obligations, frontend-seam, test-coverage on the
Agent tool, ALL first try; the Explore context loader idled and was
stopped, its ground covered first-hand). 0 BLOCKING on correctness
anywhere; the test-coverage auditor raised TWO BLOCKING coverage gaps,
both closed test-first this QA:
- The golden signed-grant bag paths were exercised only on empty bags
  (countFit's signer, the fit cap, the plain overflow remainder, and the
  deliberate second-read were all invisible). Closed with the full-bags
  and last-free-slot winner arms.
- The finder-only sting rested on raw index-order source pins
  (comment-blind, polarity-blind, containment-blind). Closed by extracting
  the decision into src/ui/gather_rare_event_feedback.ts (pure core,
  behavioral suite over every flavor x recipient quadrant, the
  satisfies-Record fifth-flavor tsc tripwire now in the SHIPPING module)
  with comment-stripped count-anchored glue pins left over hud.ts; the
  hud.ts ceiling LOWERED 19230 to 19220 (file 19217).
SHOULD-FIXES taken: the draw-contract comments now name all three
resolving arms (the retired-crop arm spends the golden draw too); the
golden belief reads != null (the exhaustive switch returns undefined off
the union and strict !== null would have read that as a WIN); the
announce-after-grants event order pinned; the five-fold pinned against
the ARMED expansion (tool-effect crossing); a winner at bed_thornpeak_1
pins the announce zone following the bed; the farm:planted deny SWEEP
(range, bad_bed, no_seed, knob-payment); the harvest-range halo arm (no
bed within INTERACT_RANGE of a zone boundary) plus the farmBedZoneId
authorship sweep; the (bo) honesty-arm seed list DERIVED from the crop
catalog; the crop fanout arm gained its own instanced player; the
ability-tooltip module keeps the LEAF ability_requirement_keys import
(round two: the barrel briefly adopted on the frontend lane's advice was
reverted on the qa-checklist's catch that the barrel re-exports the two
action bar PAINTERS and the purity guard matches specifiers only, so a
pure core must stay leaf-scoped; the leaf path is also the convention at
every other consumer), its header names the one behavior delta, and its
deletable-green branches (Wrack cost, channel with the hasted divisor,
eight requirement rows, the exact enemy-target array) are pinned; the
icon-brief preamble counts six of seven pending. Round two also added
the off-union flavor belt in the feedback core (the extraction had
silently changed an unknown wire flavor from render-the-golden-line to
throw-in-dev; the ?? fallback restores the old line, proven red-then-
green, and the raw-flavor sting check keeps the fallback sting-free).

MUTATIONS: 14/14 fresh mutants KILLED with rc nonzero AND named failing
tests, through the dirty-refusing scratchpad runner on the committed
tree, no reviewer reading: countfit-signer-drop, instance-qty-not-fit,
remainder-zeroed, snapshot-hoist, early-announce, deny-arm-mark,
zone-hardcode, cue-polarity, sting-widened, sting-hoist, sting-commented
(the last two are exactly the classes the old pins passed),
vendor-faucet (certifying the honesty arm reds toward honesty),
channel-haste-drop, ruin-block-drop.

DEFERRALS AND DECLINED, with reasons:
- (bw) ledgered in state.md: the golden-WIN path has no parity-golden
  coverage and the re-record left the tier-3 seed-back beat in the zero
  band; both fixes move or add a golden, which this QA's stopping rule
  forbids; deferred to Phase 11 by the deviation (z) precedent.
- DECLINED: the ragged gatherRareEvent comment reflow in src/sim/types.ts
  (cosmetic; a sim-content comment edit stales the portrait-manifest
  evidence family for zero behavioral value).
- Recorded, no action: grantGolden is copy two of the node signed-grant
  shape (rule of three); the signed-windfall slot-pressure UX note; the
  deed locale rows ride the recorded release-refill protocol (maintainer
  flag 3 of the phase); the future golden field-note cell must land WITH
  its server RELIQUARY_MARK_ENGLISH row (appended to the (bv) ledger).

MERGE: fix/farming-phase-10-qa merged --no-ff into feature/farming-plan
as b296da117a71fbf5a72b2ee2d1b30dc4f4e7d51c (QA tip 29aab13445, nine
commits; the branch deleted).

GATE RECORD: one run on the frozen QA tip 0848acbc00
(BROWSER_PATH=<playwright chromium> GATE_MAX_WORKERS=8
node scripts/gate_select.mjs): mode=full (the terrain-fixture +
bare_client broad arm), "[gate:select] PASS: all 12 steps green (vitest
workers: 8)", 2888 test files passed / 12 skipped, 40416 tests passed /
2 expected fail / 115 skipped, browser regression 20 files 133 green,
ZERO FAIL markers, shell exit 0, no druid_engines timeout. An earlier
gate run was deliberately stopped mid-flight when the qa-checklist's
round-two findings landed (never gate a tree about to change); no
verdict was taken from it.

### Twenty-first absorb (2026-08-19, the v0.40.0 sync mid-phase, local-only per D22)

A NEW release branch existed at Phase 11 pre-flight (release/v0.40.0, tip
e56707a675; the moved release/v0.39.0 tip 45d4148c21 is fully contained in
it), so the D22 minor-version rule fired the phase-06b shape: branch
fix/farming-sync-v0.40.0 off feature/farming-plan at 7e5bdcf000, merge
origin/release/v0.40.0 (zero textual conflicts), merged --no-ff back (hash
below). The delta over the twentieth absorb point ea9377db8e is 7 commits /
86 files: the v0.39 spell-icon revert (58 class ability icons under
public/ui/skills/ restored byte for byte, the three legacy_* suites
deleted, the new tests/spell_icon_freeze.test.ts byte-freeze + fixture, PR
3509), the CI browser-deps stall fix (ci.yml + nightly.yml install-deps
bounding with the image fallback, tests/helpers/playwright_install_block.ts,
PRs 3512), and docs. NO src/, server/, lockfile, patches/, golden, or i18n
movement. Three-file intersection with the farming footprint, ALL
auto-merged lossless and verified by hunk-level diff comparison plus suite
runs: .github/workflows/ci.yml (the six farming screenshot cone rows held),
tests/ci_workflow.test.ts (the cone-row literals held beside the new
PLAYWRIGHT_INSTALL_BLOCK pins), tests/missing_painted_icons_wave.test.ts
(the farming DEED_ORDER 280 arm held; the release edits sat in the
spell-icon region). Validation on the merged tree: npx tsc clean; the
checklist suites (world_api_parity, snapshots, command_schema,
monolith_budget) plus every touched icon/CI suite plus
professions_farming, deeds_content, and full tests/parity: 27 files, 1101
tests green; farming_session golden md5 83c3478142deabbffbf23912575873e9
UNCHANGED (zero golden movement, the expected no-sim-content shape);
scripts/item_art_audit.mjs --verify-only machineChecksPassed; the (al)
portrait manifest + art-audit builder pins green with NO re-mint needed
(the delta reaches none of the evidence inputs). Release-merge-audit lane:
CLEAN, 0 BLOCKING, 0 SHOULD-FIX (all 83 non-overlap release files landed
byte-identical; the branch never touched the three deleted legacy suites;
the spell-icon freeze scopes to public/ui/skills/<class>/ only and cannot
collide with farming item art or the Phase 11 dish ids). One planning note
carried forward: any future farming file under public/ui/skills/ must
join the freeze lists + sha fixture in the same change (none planned).
No separate sync gate run, deliberately: the delta is icons + CI plumbing
with zero behavioral surface, every touched suite ran green standalone,
and the Phase 11 close gate runs on a tree containing this absorb; the
06b intent (no shared diff with feature work) is honored by the separate
merge commit.

### Phase 11 (2026-08-19, well-fed food, local-only per D22)

Acceptance checklist (phase file STEP 5):
- [x] ItemDef.wellfed exists beside elixir (aura, kind, value, duration),
      applied via ctx.applyAura with wellfed_<kind> ids, never
      effect_dispatch (the completion end of the food path, deviation (bx):
      consume starts in items.ts, the mint fires at the updateRegen
      completion site through src/sim/wellfed.ts)
- [x] the application-timing decision made, stated, and documented
      (completion of the sit-restore; hook and rationale in (bx))
- [x] the namespace-isolation pin green: wellfed_buff_sta and
      elixir_buff_sta coexist in BOTH orders, neither overwrites the other
- [x] last-eaten-wins stated and pinned; no food buff stacks with itself
      (one shared id, exactly-one-aura arms)
- [x] every new aura name has an AURA_NAME_KEY row ('Well Fed', one row,
      deviation (by))
- [x] tooltip lines render beside the elixir view; the buff bar shows the
      aura with its remaining time through the existing chain
- [x] four buff dishes, one per crop tier, consume produce; magnitudes at
      or below the documented elixir ceiling, maintainer-flagged in the
      Notes below (the D22 stand-in for the PR body)
- [x] tests green: application and timing, isolation, duration ticking,
      the transient-across-save pin, recipe economy, S3 and i18n coverage
- [x] (bw) discharged: the golden-WIN and paying-band beats, one isolated
      classified re-record, nothing else moved
- [x] tier 3/4 dishes reagent-dormant honestly under (bo); the honesty arm
      green
- [x] every STEP 3 validation row green; mutations 9/9 killed named
- [x] gate_select PASS by its log markers (the gate record below; appended
      by the post-merge record commit, the Phase 7 precedent)

One-line answer to the QA sweep's uncertain note: rare-quality cooking
outputs are NOT new in this phase (the Phase 6 rung-50 dishes already ship
quality 'rare'), so no deed newly opens through cooking here.

THE WOULD-BE PR BODY. Farm produce becomes buff food. ItemDef.wellfed lands
beside elixir as the D15 mirror, field for field ({ aura, kind, value,
duration }); the mint lives in src/sim/wellfed.ts and fires at COMPLETION
of the 18s sit-restore, hooked at the one natural completion site in
src/sim/combat/auras.ts updateRegen (the slot-null branch), via
ctx.applyAura with the single aura id wellfed_buff_sta, never
effect_dispatch, zero rng draws, transient across save/load. THE TIMING
DECISION (deviation (bx), refining D15): completion over
immediate-on-consume, the sit-through-the-meal ritual; an interrupted meal
(damage, death, match reset) forfeits the buff; a food-only kind guard
keeps future drink records honest. All four dishes share the aura name
'Well Fed' and the buff_sta kind (deviation (by)): one AURA_NAME_KEY row,
last-eaten-wins across the whole food namespace, and no dish ever clobbers
an elixir_<kind> buff or the reverse (aura replacement keys on id +
sourceId).

CONTENT: four buff dishes, one per crop tier, in FARM_RECIPES (9 to 13
rows; LADDER_RECIPES untouched): eastbrook_glazed_carrots (rung 0, common,
foodHp 90 / sell 6, wellfed +3 sta 600s), fenbridge_rice_pudding (25,
uncommon, 243/25, +6 sta 900s), highwatch_barley_porridge (50, rare,
552/60, +9 sta 900s), evergarden_braised_greens (50, rare, 980/150, +12
sta 900s). Reagents: tier produce x4 plus cooking_salt; the tier-1 row
carries the pottage-precedent vale_wheat binder (deviation (bz)) because
brook_carrot is the priced D9 vegetable, keeping every farm row
uncraftable from counter stock and opening no rung-0 cooking skill-up
faucet (a build-lane exemption variant was reverted at integration). The
tier 3/4 pair ships REAGENT-DORMANT under (bo), stated at the rows; the
honesty arm stays green and derives from the crop catalog. foodHp and
sellValue reuse shipped curve points; art rides ITEM_ART_PENDING (39 to
43) with four distinct procedural icon recipes on the shared food radial
(A3/A4c re-pinned, the v039 hotbar literal 12 to 16, the audit CLI
pendingArtCount re-pinned); wiki content regenerated (guide freshness
green); the four names carry catalog rows byte-identical to the defs plus
five non-Latin M16 fills each.

MAINTAINER FLAGS gathered here: (1) the well-fed ladder 3/600s, 6/900s,
9/900s, 12/900s sits at or below the documented elixir ceiling, but the
capstone EQUALS the strongest crafted elixir (12/900) and the distinct
namespace makes food STACK with a same-stat elixir for a combined 24
stamina no doc budgets; cheap lever: capstone to 9 or 10. (2) Reagent
counts (produce x4) and both top dishes at rung 50 (restating the Phase 6
three-rungs-for-four-tiers domination flag). (3) Tier 4 ships quality
'rare' like tier 3. (4) The aura.wellFed row carries the five non-Latin
fills only (the sim_i18n in-file pattern); the Latin fills join the
release-tier pass.

UI: src/ui/wellfed_tooltip_view.ts beside the elixir view (registered pure
core, leaf imports), composed in Hud.itemTooltip at 19219/19220 (ONE line
of headroom left, flagged); no 'Use:' prefix (the foodHp line owns that
slot) and BOTH branches interpolate the buff name through the sim_i18n
matcher chain the buff bar reads, so the term cannot fork per locale. The
buff bar needs no new module: name via AURA_NAME_KEY, remaining time via
compactAuraDuration, icon via the aura_buff_sta fallback (a bespoke
wellfed icon is a Phase 13 art-batch candidate). Party frames correctly
ignore the buff (sim-side classifier, not a tier knob); the old synthetic
well_fed fixtures now pin the live id.

(bw) DISCHARGED (the Phase 10 QA ledger): the farming_session scenario
gained a position-searched golden-WIN beat and a paying-band tier-3
seed-back beat, appended after every earlier beat. Probe facts (recorded
in the drive comment): post-drive stream index 86 is the first golden
winner (0.003351 < 1/90) and index 92 the first one-seed band value
(0.155753); 29 padding cycles of real plant-plus-withered-harvest walk
the stream there (3 draws each; withering NEEDS the written skill-0
window, because the keep chance saturates at 1 by 75 and a 0.99 roll
SURVIVES at the pre-write skill: crops cannot wither at cap, discovered
live by the first probe run). The WIN beat overwrites its yieldSeed with
the probed both-grades winner (FARM_GOLDEN_WIN_YIELD_SEED = 7 at skill
75: count 3, fine 1), so the five-fold signed grants land at BOTH grades
(15 + 5), the crop-source announce fans out, and the
gather_event:golden_harvest mark reaches the digest; the paying beat's
seed-back pays exactly one highland_barley_seed. ONE deliberate isolated
classified UPDATE_PARITY=1 re-record: frames 0-25 byte-identical, the old
final frame replaced by the continuing cadence frame, five frames
appended; draws 16 to 110, ticks 290 to 1577, md5
83c3478142deabbffbf23912575873e9 to 25bd6b8774f913279c96dddb25f93403;
zero other goldens moved (full tests/parity 216 green). The coverage_c
farming arm extends to the new labels (drawsAt 102/103/108/110), the
five-fold both-grades equality with in-arm non-vacuity, the announce
fanout, the mark, and the two-beat bag consistency.

REVIEWS: architecture 0 BLOCKING (its food-kind-guard SHOULD-FIX taken
with a synthetic-drink arm plus the catalog sweep; its maxHp-mid-tick
ordering note DECLINED with reason: hp heals ride only the eating slot,
which is the completing slot itself, and player stat auras fold through
the deferred statsDirty recalc, so no cross-slot read exists);
cross-platform APPROVE (0 BLOCKING; its wellfed parity-beat SHOULD-FIX
deferred to Phase 12 with the feast scenario, ledgered below; its
party-frame fixture value note taken at the predicate level, the painter
fixture stays the projected wire shape which carries no value field);
content-obligations 0 BLOCKING (its docs-ledger SHOULD-FIX is this
section plus the state.md entries; its capstone flag is maintainer flag 1
above); frontend-seam 0 BLOCKING (both SHOULD-FIXes taken: the doubled
Use: prefix reworded with the five fills re-supplied in the same change,
and the buff name unified onto the one matcher row; its bespoke-icon and
32px carrot-vs-pottage eyeball notes ledgered for the Phase 11 QA);
qa-checklist LAST, verdict recorded below.

DEFERRALS ledgered with owners: a wellfed parity-scenario beat rides the
Phase 12 feast scenario (the mint is host-agnostic shared sim code with
the zero-draw pin; unit coverage carries it meanwhile); the bespoke
wellfed_buff_sta AURA_RECIPES icon and the glazed-carrots-vs-pottage 32px
eyeball go to the Phase 13 art batch; the third stat-buff tooltip line
extracts a shared core on the rule of three; hud.ts headroom is ONE line.

VALIDATION: npx tsc --noEmit clean; the STEP 3 battery (27 files, 750
tests incl. the aura suites) green; tests/parity 216 green after the
isolated re-record; npm run ci:changed rc 0 with zero errors (the real
rc captured unpiped).

MUTATIONS 9/9 KILLED with rc nonzero AND named failing tests AND run
summaries, through the dirty-refusing scratchpad runner on the committed
tree, no reviewer reading: M1 namespace escape (wellfed id minted as
elixir_<kind>: six named reds incl. both isolation orders), M2
last-eaten-wins inverted (per-item ids: the exactly-one-aura arm), M3
aura replacement keyed on kind instead of id (both isolation orders red:
the elixir-clobbered-by-food reverse direction), M4 capstone magnitude
over the ceiling (the exact-tuning arm), M5a completion hook deleted
(six reds), M5b mint-on-consume inserted (killed by exactly the
never-mid-meal and interruption-forfeits arms: the timing decision is
pinned in both directions), M6 a tier-3 seed gaining a vendor faucet
(the (bo) honesty arm reds toward honesty), M7 the golden win never
applying (the (bw) beat asserts something: coverage_c AND the parity_g
digest both red, the vacuity probe), M8 the five-fold dropped (the
armed-expansion probe: coverage_c, parity_g, and four
professions_farming arms), M9 the food-kind guard removed (the
synthetic-drink arm). M5b's first anchor missed (the items.ts emit line
sits elsewhere); re-anchored on the slot-assignment block and landed
with count proof.

GATE RECORD: one run on the frozen phase tip e6746bfe79
(BROWSER_PATH=<playwright chromium> GATE_MAX_WORKERS=8
node scripts/gate_select.mjs): mode=full (the terrain-fixture +
bare_client broad arm, as expected), "[gate:select] PASS: all 12 steps
green (vitest workers: 8)", 2888 test files passed / 12 skipped, 40442
tests passed / 2 expected fail / 115 skipped, browser regression 20
files 133 green, ZERO FAIL markers, shell exit 0, no druid_engines
timeout, about 15 minutes of vitest.

MERGE: fix/farming-phase-11-well-fed-food merged --no-ff into
feature/farming-plan as 9fc11d5452537834d0eb70f1ed14dbf23ecba0cc (phase
tip e6746bfe79; the branch and the three agent worktrees
~/Documents/woc-farm-p11-{a,b,c} deleted). The twenty-first absorb
(release/v0.40.0, merge f0d329db02) opened the phase as its own sync
mid-phase; its record sits above.

No screenshots: the tooltip line and the buff bar ride existing visual
families; the Phase 11 QA captures them on the LOW preset if it wants
eyes on them (the phase doc hands that over explicitly).

#### Phase 11 QA (2026-08-19, PASS-WITH-FOLLOWUPS)

Branch fix/farming-phase-11-qa off 35536d8ca8; release/v0.40.0 e56707a675
still the newest tip, no absorb needed. Baselines verified by RUNNING
before any audit: golden md5 25bd6b87 exact, monolith counts exact
(hud.ts 19219/19220, renderer.ts 13774/13774), the five pin suites green
(417 tests), diff f0d329db02..e6746bfe79 resolved cleanly (64 files).

THE FOUR EMPHASES, all proven first-hand:
1. Coexistence LIVE: elixir_buff_sta and wellfed_buff_sta side by side
   through real ticks with sane decaying remaining times (correctness
   lane probe, plus the shipped both-orders arms re-run green).
2. Last-eaten-wins LIVE: carrots then pudding leaves exactly one wellfed
   aura at value 6, the elixir untouched and NOT refreshed.
3. PLAYED AS A PLAYER on the live client (LOW preset, dev server, real
   browser): grants staged via window.__game, the EAT VERB a real
   desktop left-click on the real bag row (right-click opens the item
   menu; left-click is the classic action). Meal started, 18s sit rode
   out on the wall clock, the buff bar showed the slot with '10m'
   remaining, the buff hover tooltip read 'Well Fed, Increases Stamina
   by 3, 600 seconds remaining', and the dish tooltip carried exactly
   one Use: prefix plus 'Well Fed: +3 Stamina for 10 min, granted when
   you finish eating.' Probe screenshots were transient verification
   evidence in the session scratchpad, deliberately not committed: the
   two frozen-literal suites and this log pin the same content, and two
   whole-HUD shots do not justify minting a new docs/screenshots cone
   subtree; the standing capture offer passes to the Phase 13 art batch.
4. THE SAME-NAME SILENT DOWNGRADE ONLINE, over the real wire: a
   stable-timer-wire session (timerWireVersion 3) on a real GameServer
   with the eat verb sent as a REAL ClientWorld use frame (the
   farming_command_chain_online payload-skew rule). Tier-4 completion
   shipped value 12 to the client mirror; an idle broadcast elided the
   unchanged aura array and the client held 12; the tier-1 completion
   re-encoded (auraMatches includes value, snapshot_timer_wire) and the
   client surface reflected 3/600 with exactly one wellfed aura. The
   declined pin's mechanism is additionally covered by the existing
   field-matrix arm in tests/snapshot_timer_wire.test.ts (value 8 bust),
   so the decline stands, now with an empirical end-to-end replay.

FAN-OUT: one Workflow (3 free-text lanes: correctness, test-coverage,
dead-code) 3/3 first try, plus architecture-reviewer, cross-platform-sync
(APPROVE), frontend-seam-reviewer, and content-obligations-reviewer on
the Agent tool, all delivered first try with the SendMessage-first
preamble. 0 BLOCKING anywhere. qa-checklist ran LAST over the QA diff.

FIXES (test-first, three commits, then the docs): the 18s boundary
bracket (no mint at 17s, minted by 19s: pins the CONSUME_DURATION scale
the 5s/22s arms could not see), the death-mid-meal forfeit, the
second-dish-mid-meal refusal (slot keeps the first dish on its own
clock, the second stays unspent), the zero-rng twin's rig guards
(draws-nonempty floor + same-foodHp premise), the Hud glue pin routed
through the shared order-safe stripComments (a block-commented
composition line no longer passes), the wellfed/elixir stat-map parity
pin (identical key sets, every key driven through both views' mapped
branch), and ten frozen non-Latin renders of useWellfed/useWellfedAura
through the real sink (locale chunk awaited first; a stale resolved fill
reds an exact literal). The scenarios.ts padding comment now states the
husk payout instead of claiming 'no produce' (comment-only, golden and
draw positions untouched, md5 re-verified 25bd6b87).

MUTATIONS 7/7 KILLED named through the dirty-refusing runner on the
committed tree, no reviewer reading, landing proof by occurrence counts,
restores verified clean: M3 re-proven (replacement keyed on kind: both
isolation orders red), M5b re-proven (mint-on-consume insertion: 3 reds
including the NEW boundary arm), plus five fresh, each dying to exactly
its new pin (early completion, guard fall-through, one-sided map
widening, a clobbered ja_JP resolved row, a block-commented glue line).

FINDINGS RESOLVED WITHOUT CODE (verified, recorded): the loot surfaces
DO route through Hud.itemTooltip (both loot controllers take it as a
dep), so the well-fed line reaches loot tooltips; the localized-sentence
English render seen in a first probe was a probe artifact (the app
awaits ensureLocaleLoaded before setLanguage; with the chunk resident
all ten fills render translated); the aura-value wire path ships value
whenever nonzero and the client assigns rather than skips, both
branches. Ledgered residuals with owners: the state.md Phase 11 QA
block. Verdict PASS-WITH-FOLLOWUPS.

QA-CHECKLIST VERDICT (ran LAST over the QA diff): READY, 0 BLOCKING. Its
one SHOULD-FIX was the joint-coverage rule striking again: the death arm
proved the OR of the two consuming-clear sites (the shared interrupt
clear fires before the death-reset block's own clear; a diagnostic
mutant deleting the death-block clear SURVIVED the suite). Resolved per
its own recommendation: the arm's claim now states the joint outcome it
actually proves (the killing blow clears the meal, nothing mints through
30s of dead-state ticks) with the diagnostic recorded in the comment.
Its hygiene notes taken in the same commit: the locale describe restores
English, the locale ids are compile-checked, the ragged wrap mended.
The remaining state.md validation matrix rows the diff demands were run
green (professions_work_orders, snapshots, env_protocol, bandwidth: the
wire negative proof, 280 tests).

GATE RECORD: one run on the frozen QA tip a9b4c3f818
(BROWSER_PATH=<playwright chromium> GATE_MAX_WORKERS=8
node scripts/gate_select.mjs): "[gate:select] PASS: all 12 steps green
(vitest workers: 8)", zero FAIL markers, shell exit 0, no druid_engines
timeout. Golden md5 25bd6b8774f913279c96dddb25f93403 held through the
whole QA; hud.ts 19219/19220 and renderer.ts 13774/13774 untouched.

MERGE: fix/farming-phase-11-qa merged --no-ff into feature/farming-plan
as 0bb8468cd6 (QA tip 37f773d6d2; seven commits; the branch deleted; no
agent worktrees were created this round). NEXT: Phase 12 (shared feast,
docs/prd/masterwrought/farming/phase-12-shared-feast.md); the wellfed parity beat rides
its feast scenario by the recorded, tick-phase-enriched deferral.

### Phase 12
Status: DONE (2026-08-19, local-only per D22; merged --no-ff into
feature/farming-plan as 71010cf82a, phase tip 1b33789ba4; the phase branch
and the four agent worktrees deleted).

ACCEPTANCE (the phase file's STEP 5 list, with check states):
- [x] The (bo)/Live-surface reconciliation decided, documented as deviation
      (ca), and swept into the phase file and phase-12-qa.md.
- [x] The feast item exists: an expensive produce-heavy tier-4 cooking recipe
      honoring the (bz) whole-list invariant; recipe economy green; no
      buyValue; the tooltip states placement, the buff, and the
      once-per-player limit.
- [x] placeFeast on IWorldFarming, implemented in BOTH Sim and ClientWorld,
      parity pin updated in the same change (plus consumeFeast, the
      delveInteract-precedent second member; 331 = 88 + 243).
- [x] The feast is a REAL entity riding the normal entity snapshot; no new
      wire mechanism anywhere in the diff.
- [x] src/sim/professions/feast.ts owns FeastState (owner key, charges,
      tick-domain expiry, the eatenBy ledger); zero rng stated and pinned.
- [x] Consuming grants the tier-4 wellfed buff through the one Phase 11
      completion site (the consume-slot decision recorded); a charge spends
      at bite START, once per player; despawn rides inside updateFarming's
      1 Hz sweep, never a second sim.ts sweep.
- [x] Feast state transient, never serialized; rationale in the module.
- [x] The anti-abuse rule decided and documented: one active feast per placer.
- [x] BOTH verbs player-reachable through the real client and PROVEN BY
      PLAYING (the live-client probe: KeyB + a genuine bag left-click places,
      a genuine KeyF eats; the probe also caught and fixed the respawn-sweep
      re-arm bug).
- [x] The prop in the exporter (swap-ready, 16-GLB set), the render surface
      inside farm_patches.ts (renderer.ts untouched at 13774), placement VFX
      fire once per appearance, the ui_farm_feast cue chain complete.
- [x] The feast title is the "{name}'s Harvest Feast" t() key; every wordy
      new value carries its five non-Latin fills.
- [x] Tests green: place, consume, once-per-player, charges, expiry, every
      deny arm both directions, the multi-session routing test, the
      determinism pin, and the wellfed-vs-elixir isolation.
- [x] Parity: beat P landed as ONE isolated classified golden commit
      (frames 0-93 byte-identical, draws 110 with an identical drawDigest,
      md5 25bd6b87 to 9dfd1c6e); nothing else moved.
- [x] Screenshots (desktop + landscape mobile, LOW preset) committed under
      docs/screenshots/farming-phase-12 with the cone rows, referenced above.
- [x] Every STEP 3 validation row green; mutations killed or
      diagnosed-and-fixed; gate_select PASS by its log markers.

GATE RECORD: run 1 (frozen tree at 32ec9bc442+docs) FAILED at the full-suite
fallback with exactly five reds, all the recorded fallback-only census class
plus one contention timeout (the All-only chip set, the crafted-junk
provenance exception family, the allowed-oddments list, the farm-patch
preload count, and the 180s expiry arm at the 20s default under 8 workers);
each healed as a deliberate re-pin or a declared budget, each green
standalone before and after. Run 2 on the healed frozen tree:
"[gate:select] PASS: all 12 steps green (vitest workers: 8)", zero FAIL
markers, no druid_engines timeout.

The shared feast (D16): a placeable feast other players eat from, the communal
payoff at the top of the farming ladder, plus the beat-P discharge of the
deferred wellfed parity beat.

DECISIONS RECORDED (maintainer-flagged where noted):
- Deviation (ca), the (bo)/Live-surface reconciliation (state.md): the recipe
  ships REAGENT-DORMANT-HONEST like the tier 3/4 dishes; the Live-surface note
  is amended in-file and phase-12-qa.md audits the amended surface.
- ANTI-ABUSE RULE: one active feast per placer (farmDenied 'feast_active').
  Chosen over a placement cooldown: no per-player timestamp outliving the
  feast, entity count bounded at one per player, no clock involvement.
- PROPOSED TUNING, maintainer-flagged at the ItemDef.feast row: charges 10,
  durationTicks 3600 (180 s), recipe reagents evergarden_greens x4 +
  gilded_sunmelon x4 + cooking_salt x2 (input 336 vs output 250,
  gold-negative), sellValue 250, trainer fee 10000 at rung 50.
- THE BITE IS A CONSUME SLOT, not an instant mint: eating from the feast sets
  the standard 18 s Consuming slot pointed at the CAPSTONE DISH
  (ItemDef.feast.dishItemId = evergarden_braised_greens), so the Well Fed
  mint stays the one Phase 11 completion site (wellfed.ts via updateRegen),
  interruption-forfeit rules apply verbatim, and re-tuning the dish re-tunes
  the feast. The charge spends at bite START (the dish precedent: the spend
  lands at use; interruption forfeits the buff, never refunds the serving).
- TRANSIENT BY DESIGN: FeastState lives only in SimContext.feasts, dies with
  the Sim, and never serializes (the module header owns the rationale); the
  despawn check (zero charges or expiry) rides INSIDE updateFarming's 1 Hz
  sweep, never a second appended sim.ts sweep.
- The consume verb rides a dedicated seam member consumeFeast(feastId) (the
  delveInteract precedent), NOT the bare interact command: the client funnel
  and the sim would otherwise need matching priority ladders. Both verbs are
  player-reachable: place via the bags LEFT-click classification (the mount
  precedent), consume via the interact funnel's feast arm below the bed arm.

SCREENSHOTS (LOW preset, the standing rule; desktop and 844x390 landscape
mobile; captured via the farm-feast target added to scripts/pr_shot_targets.mjs,
the BEFORE from a scratch worktree at the phase base with the same framing):
- docs/screenshots/farming-phase-12/before-feast-desktop.png
- docs/screenshots/farming-phase-12/after-feast-desktop.png
- docs/screenshots/farming-phase-12/before-feast-mobile.png
- docs/screenshots/farming-phase-12/after-feast-mobile.png
The after shots show the placed feast prop among the Eastbrook beds, the
composed "{name}'s Harvest Feast" title, and the placer mid-bite (the EATING
bar and the sit); the before shots are the identical framing without any of it.

NOTES (residuals and findings, ledgered):
- The renderer-owned loot sparkle: RESOLVED, not owed. It keyed on the wrongly
  re-armed lootable flag, so the re-arm fix removed it as a side effect (see
  PLAYED PROOF below); this bullet originally deferred it to the Phase 13 art
  batch and is amended by the Phase 12 QA doc pass.
- A farm_feast entity would have drawn the generic supply-crate body through
  renderer.ts's object arm; buildGroundQuestObject's empty-itemId arm now
  returns an invisible pick proxy at the feast contract bounds, keeping the
  feast clickable under the farm_patches prop with zero renderer.ts edits.
- place_feast sits in HEAVY_SELF_CMDS belt-and-braces; dropping it stays green
  because the bag spend independently bumps wireRev (the pin's comment states
  the real mechanism; the deliberate mutation survivor is recorded).
- Beat P's coverage sweep caught the tier-3 flavor cast still running at beat
  start (the dish useItem silently refused busy); fixed with the drive's own
  cast-wait idiom before recording.
- hud.ts funded by extracting entityDisplayName to src/ui/entity_display_name.ts
  (ceiling lowered 19220 to 19214, file at 19214); sim.ts funded inside its
  12660 ceiling by compressing farming delegate comments toward the facet docs.

REVIEWS (all delivered; every BLOCKING and actionable SHOULD-FIX fixed in
committed rounds): architecture 0 BLOCKING (2 SHOULD-FIX taken: the useItem
silent no-op converged into the one action body, the sweep's entities.has
inverse cleanup), cross-platform PASS (the assertNever farm-event guard
taken; the place-gate asymmetry kept deliberately, header-stated),
privacy-security ship-it (the header honesty line taken; the deny-reason
liveness oracle, the falsy-characterId idiom, presence-after-logout, and the
jail-list consistency recorded as considered-and-accepted),
frontend-seam 0 BLOCKING (bag hint arm, three FARM_FEAST_TEMPLATE_ID
imports, entity_display_name registration, twin title-literal suites, the
narrowed feast field all taken), content-obligations REQUEST CHANGES
resolved (the servings fixture red fixed; the tooltip one-serving limit
folded into useFeast with all five fills), qa-checklist READY (the water
place-gate and the art-debt ledger row taken).

PLAYED PROOF (the (bn) rule, beyond the reachability pins): a live-client
probe drove BOTH verbs through the REAL gestures on the LOW preset: KeyB
plus a genuine bag-row left-click placed the feast (item spent, entity up,
composed title on), and a genuine KeyF bite started the 18s meal. THE PROBE
CAUGHT A REAL BUG the whole test pyramid missed: sim.ts's object-respawn
sweep re-armed the feast as a lootable pickup one second after placement,
so the funnel's generic object arm swallowed the press silently; fixed with
a lifetime-derived spawn respawnTimer plus a lootable-stays-false life pin
(commit 32ec9bc442). Side effect: the renderer's generic loot sparkle no
longer decorates the feast (it keyed on the wrongly re-armed lootable), so
the ledgered sparkle residual above is RESOLVED, not just accepted.

MAINTAINER READS OWED FROM THIS PHASE: (1) the qa-checklist flags the
sim.ts headroom funding (comment compression toward the owning module and
facet docs, the Phase 8 in-place precedent) as ratchet-spirit inversion;
the feast delegates are IWorld interface members that cannot leave the Sim
class, so the options are blessing the compression or budgeting the next
sim.ts extraction round (Phase 13 needs one regardless: the file sits at
12660/12660 exact). (2) The tuning constants listed above. (3) The (ca)
dormancy row joining the D11/(bo) ruling's scope.

### Phase 12 QA (2026-08-19, verify the shared feast, local-only per D22)

Status: DONE (PASS-WITH-FOLLOWUPS), branch fix/farming-phase-12-qa off
2445de46ab (release/v0.40.0 e56707a675 still the newest tip, no absorb owed).
Merge hash in the notes tail below.

THE FOUR MANDATORY EMPHASES, each proven first-hand over the REAL wire (the
feast_online harness: real ClientWorld frames into the real GameServer
dispatch, a throwaway probe suite run green then deleted):
- (a) Three sessions: the placer placed AND ate the own feast (charges 10 to
  9, Well Fed value 12 minted on the placer's own snapshot at the 18s
  completion); a guest ate once (9 to 8) and was denied the second helping
  (feast_eaten, state untouched); a third session ate the LAST charge (staged
  1 to 0, the last-charge edge); a latecomer joining AFTER the charges
  emptied was denied feast_finished before the sweep and feast_expired after
  the despawn; the sweep collected the emptied feast on its boundary.
- (b) The once-per-player ledger survived a REAL leave (server.leave) and a
  rejoin under the SAME characterId with a NEW session entity id: the
  rejoined guest was denied feast_eaten over the wire, charges and ledger
  unchanged, and the rejoin resurrected no feast state.
- (c) Nothing serializes: the real leave-save's blobs (saveCharacterState
  plus saveCharacterAndMarketState, captured at the mocked db seam with a
  positive control) carried no feast content, no pool.query call did either,
  and the static sweep of every server persistence path found zero feast
  mentions outside the dispatch and heavy-self files.
- (d) The lootable re-arm class ONLINE: a real ClientWorld mirror fed the
  actual broadcast frames held lootable false on server AND mirror through
  4 seconds of real ticks; the feast never joined the generic object arm's
  candidate set (which requires entity.lootable) while
  nearestInteractableFeast resolved it.

FIXES (six commits on the QA branch, each test-first):
1. THE INSTANCE-TEARDOWN LEAK (the architecture reviewer's find, REPRODUCED
   with a failing arm before the fix): a feast placed inside a dungeon
   instance was never registered in inst.objectIds, so freeInstance left the
   entity standing at the slot origin for the next claiming party, still
   edible and holding the placer's one-active slot. Fixed by registering the
   entity in the CLAIMED instance's teardown roster at placement; the sweep's
   entities.has inverse-cleanup leg reclaims the state and the slot.
   Placement inside instances stays LEGAL (the raid-table flavor).
   THE DELVE TWIN (the qa-checklist adversarial find, its own commit): delve
   runs are a separate spatial system with their own roster, so the same
   leak stood there; the feast now joins the placer's run.objectIds
   (delveRunForPlayer), torn down by freeDelveRun AND the module advance,
   reproduced failing-first the same way.
2. The re-arm dodge replaced with the INFINITY SENTINEL: the finite spawn
   timer (durationTicks + 20 ticks) was silently coupled to the 1 Hz sweep
   period across two files with a probe-measured worst-case margin of
   exactly ONE tick. respawnTimer = Infinity is the precedented never-re-arm
   sentinel, never rides the wire, moved no golden; the 181s expiry arm now
   rides the whole life at the worst-case sweep phase asserting lootable
   false on every tick.
3. Four decisive sim arms: the swim-bite refusal (the gate was deletable
   with the whole battery green), the exact-INTERACT_RANGE allow (the client
   twin's inclusive-boundary premise, now pinned sim-side), the keyed-placer
   feast_active deny, and the orphan-window press (the !entity leg guards a
   dist2d-on-undefined crash).
4. The bags placeFeast dispatch pinned BEHAVIORALLY: a real click on the
   feast cell in the use-routing DOM rig reaches world.placeFeast once and
   never useItem (the old pin was source-text only).
5. Render: the placement flourish no longer replays on a graphics-settings
   rebuild or login (the first applyFeasts pass registers standing tables
   silently; the scope-re-entry ambiguity is accepted and documented);
   shadow casting budgeted at FEAST_SHADOW_CAP = 8 tables, presence never
   culled (actionable). Both pinned by new adapter arms.

MUTATIONS 13/13 KILLED named through the dirty-refusing runner (each with a
nonzero exit code, named failing tests, the summary line, and a landing-proof
grep): the swim-gate deletion, the finite no-margin respawn, one-active-by
-entity-id, range >=, the !entity leg drop, ledger-by-entity-id, expiry
strict >, state-never-deleted (8 named reds), the instance-registration drop,
the delve-registration drop, flourish-always, shadow-budget-unbounded, and
place-case-to-useItem (both the source pin and the behavioral arm red). The build round's deliberate
HEAVY_SELF place_feast survivor stays recorded, not re-run. DOC NOTE: the
build round's own kill list was never itemized in this file (the 9/9 list in
the Phase 11 block is Phase 11's); the omission is recorded here, the kills
stand in the phase branch history.

REVIEWS (this round, on the MERGED result, hunting what the build round could
have structurally missed): three audit lanes (correctness PASS, every
acceptance criterion re-verified as amended by (ca), all edge probes green
including consume-at-expiry, the one-active boundary at the despawn tick, and
the bite racing the sweep; coverage PASS-WITH-FOLLOWUPS, all taken; dead-code
PASS, zero unused surface beyond two accepted nits) plus architecture (0
BLOCKING; the instance leak and the Infinity amendment were its SHOULD-FIXes,
both taken), cross-platform (PASS, zero drift; the consume_feast heavy-self
exclusion chased to the encoders and safe: eat and sit ride light per-tick
channels), privacy-security (ship-as-merged: authority, input validation,
rate limiting, and privacy all held; the +20 coupling SHOULD-FIX taken via
Infinity), content-obligations (APPROVE; deeds and Reliquary affirmatively
NOT owed, rulings now recorded in the state.md Phase 12 QA block), and
qa-checklist LAST (verdict in the notes tail). The browser suite ran 133
green standalone (the bags world-read widening verified benign: buildInput
gained no world read; the placeFeast call is click-handler only).

DEFERRALS: ledgered with owners in the state.md Phase 12 QA block (the
deny-order asymmetry, the existence oracle, the O(live feasts) scan and
heavy-on-receipt sibling behavior, the useItem slotIndex thread, the
dish-from-constant coupling, the bags hint copy, the title-composition
rule-of-three watch, the nameplate hysteresis pad, the wiki effect-prose
generator gap, the malformed-id host asymmetry).

NOTES TAIL (records):
- qa-checklist (dispatched LAST over the QA branch's own diff): READY, zero
  BLOCKING; its one SHOULD-FIX (the delve teardown symmetry) was fixed
  test-first as the sixth commit and its mutant killed named; its remaining
  notes are accepted and folded into the state.md ledger (the own-placement
  first-pass flourish clause, the expiry arm's upper-bound-only despawn
  assertion, the rebuild arm's shared-scene note, the bounded
  inst.objectIds growth).
- GATE (run 1, on the frozen QA tip b92918f47b): "[gate:select] PASS: all
  12 steps green (vitest workers: 8)", mode=full fallback (562 changed
  paths vs the release base), 2894 test files passed / 12 skipped, 40568
  tests passed (2 expected-fail, 115 skipped), browser suite 20 files /
  133 tests green, zero FAIL markers, no druid_engines timeout.
- MERGED --no-ff into feature/farming-plan as caf0fdee9f (QA tip
  b92918f47b, eight commits; branch deleted). The farming_session golden
  md5 9dfd1c6ea073f853655e38675460e81f held through the whole round.

### Phase 13
Completed 2026-08-19 on fix/farming-phase-13-integration-polish, local-only per
D22 (no push, no PR; merged --no-ff into feature/farming-plan, merge hash in the
gate record below). Opened with the MANDATED sim.ts extraction: M5, the boss
support kit (updateBossMechanics + spawnBossAdds, ~430 lines) moved whole to
src/sim/mob/boss_mechanics.ts behind SimContext, thin facade delegates kept for
the seven suites that reach the methods by cast, the S3 scan list gained the
module path, the monolith ceiling LOWERED 12660 to 12249, the farming_session
golden byte-identical (md5 9dfd1c6ea073f853655e38675460e81f) and the parity
suite green throughout. Architecture review: 0 BLOCKING; both SHOULD-FIXes
taken (tests/mob_boss_mechanics.test.ts direct unit test; the src/sim/CLAUDE.md
map row) plus the ownership annotations and the once-per-pull comment fold.
Extraction mutation checks through the dirty-refusing runner, 4/4 KILLED with
named failing tests: M1 drop-mend-applyHeal (the hp-bounds arm), M2
pulse-ignores-telegraph (the never-pulses arm), M3 adds-not-flagged-summoned
(the summonedAdd arm), M4 unknown-template-guard-dropped (the silent arm).

Acceptance (phase file STEP 5, as amended by the D22 sweep):
- [x] The sim.ts extraction landed with a LOWERED ceiling (12660 to 12249) and a
      byte-identical golden.
- [x] The wiki farming page regenerated via npm run wiki:content (byte-identical
      regen), tests/guide.test.ts green, prose spoiler-safe: lane A added the
      "From the beds to the table" section (new keys only, no rewords) and
      replaced the false no-deeds-yet claim via the new gatherDeeds.farmingSown
      key with its five M16 fills.
- [x] docs/design/farming-asset-manifest.json exists: 16 rows generated from
      FARM_PROP_CONTRACTS, cross-checked BOTH directions (every exporter output
      has a row, every adapter consumer parameter has an entry), authored and
      draw heights as separate labeled fields, replacement contract verified
      against the exporter, render identity + adapter parameters recorded.
- [x] The manifest references no docs/prd/masterwrought/farming/ path (grep-verified; it survives
      teardown).
- [x] The full-journey screenshot set is committed under
      docs/screenshots/farming-phase-13 (this reference is load-bearing for the
      ci_workflow referenced-corpus pin): 01-planting, 02-stage-ladder,
      03-harvest, 04-harvest-journal, 05-harvest-feast, each -desktop (1600x900)
      and -mobile (844x390 landscape touch), LOW preset seeded pre-boot,
      recaptured toast-free with a per-shot GPU-notice assertion; the cone row
      joined all five ci.yml sparse-checkout blocks AND the ci_workflow test
      literal in the same commit.
- [x] Every progress.md Notes deferral and state.md residual swept into the
      state.md handoff table (105 rows + the integration additions), the
      MAINTAINER GATES block at the top, none lost; closures recorded, never
      silently dropped.
- [x] docs/prd/masterwrought/farming/qa-checklist.md executed in full with per-row evidence (the
      matrix below), anti-chore audit as its own subsection; the one
      BLOCKED-ON-RULING row is the known (ca)/D11 gate this phase ledgers by
      design; the five DEFERRED-TO-INTEGRATION rows are completed in the
      integration record below.
- [x] The final IP-safe audit (D17) covered every player-visible farming string
      (per-module counts in the integration record; zero violations; one
      shared-key staleness follow-up and one awareness note ledgered).
- [x] No em dashes, en dashes, or emojis in the new prose (hook-enforced plus
      a diff scan).
- [x] Gate green by log markers and ci:changed rc 0 (the gate record below).

Integration record (the orchestrator, 2026-08-19):
- Lane commits cherry-picked in order: 2e14d0bbc8 (guide), e877a9de08
  (manifest), cbd04d03ea (screenshots + cone rows), 72b7923dbf (sweep +
  checklist), then 09b86e63d0 (integration reconcile), 6b074f9168 (manifest
  biome format), 2f890caa84 (toast-free recapture).
- The checklist rows lane C deferred to integration, completed here: the
  manifest EXISTS and is cross-checked (see the acceptance box above); the
  screenshots are committed and referenced from THIS block; ci:changed rc 0
  after the manifest format fix; wiki accuracy re-verified on the integrated
  tree (guide battery 587 passed); the packet-close gate is the record below.
- D17 audit per-module counts (lane A): hud_chrome 78 checked / 0 flagged;
  items 49 / 0; guide 7 shipped + 3 added / 0; hud 1 / 0 (other hits
  incidental); abilities 28 hits all excluded as non-farming; world_entity +
  NpcDefs 12 / 0; sim_i18n 3 / 0 with the Well Fed awareness note;
  talent_i18n all hits excluded. Zero D17 violations.
- Reviews: architecture (the extraction) 0 BLOCKING, fixes taken;
  gate-integrity (the cone rows) APPROVE 0 BLOCKING, its durability
  SHOULD-FIX satisfied by this block's screenshot reference plus the
  manifest's regenerationNote, and its teardown finding ledgered as the
  Phase 13 QA teardown precondition (seven earlier subtrees are referenced
  only from docs/prd/masterwrought/farming/); frontend-seam 2 BLOCKING + 3 SHOULD-FIX, ALL
  fixed in the lane A fix round (commit 7d64d20d12, cherry-picked): the
  retired gatherDeeds.farming key joined RETIRED_KEYS (the
  harvestBodyChoice precedent) healing the red guide_key_coverage gate,
  the Harvestmaster and top-dishes prose moved to the later-patch
  disclosure idiom with all five fills re-supplied per key in the same
  commit, the (bo) dormancy sweep comment gained the guide prose as a
  fourth site, and the prof-farm-table + deeds-ternary accuracy pins
  landed with four ISOLATED red-then-green mutation cycles (the first two
  broad proofs were discarded as shadowed by the beds pins, an honesty
  call worth keeping); qa-checklist verdict recorded below when delivered.
- Validation on the integrated tree: tsc rc 0; wiki:content rc 0 and
  byte-identical; guide/ci_workflow/i18n_completeness/localization_fixes/
  monolith/architecture/world_api_parity 587 passed; tests/parity 216 passed
  with the golden md5 exact; ci:changed rc 0.
- qa-checklist (the phase-completion gate, dispatched LAST): READY, 0
  BLOCKING, 0 SHOULD-FIX; it independently re-verified the golden md5, the
  16-row both-directions manifest cross-check, the M16 fills key by key, the
  regen-only i18n artifacts (re-ran i18n:gen, tree stayed clean), the
  dormancy arithmetic of the new prose, and the farm_patches_core comment
  claims; its two informational notes (the unconsumed trim field, already a
  handoff row; the honest [dev] farmgrow line visible in the feast capture's
  chat log) need no action. [CORRECTED by Phase 13 QA: the [dev] farmgrow
  chat line is visible in THREE desktop captures (03-harvest,
  04-harvest-journal, 05-harvest-feast), not the feast capture alone; the
  shots themselves are honest staging evidence and stay as shipped.]
- GATE RECORD (the close gate, run on the frozen tip 5787094ee8):
  BROWSER_PATH + GATE_MAX_WORKERS=8 node scripts/gate_select.mjs, mode=full
  (the planner fell back on the broad change set as expected),
  "[gate:select] PASS: all 12 steps green (vitest workers: 8)", vitest
  40572 passed / 2 expected fail / 115 skipped, browser suite 133 passed,
  zero FAIL markers in the log, no druid_engines timeout, exit 0.
- MERGE RECORD: merged --no-ff into feature/farming-plan as 1f1a74a8ad
  (phase tip 5c371c2fba; the phase branch and the three lane worktrees
  woc-farm-p13-{a,b,c} with their lane branches deleted). Commit map on the
  phase side: 8caa0c669c M5 extraction, 14ede759cb D22 amendment sweep,
  f68928ddf7 extraction unit test + review fixes, 2e14d0bbc8 guide prose,
  e877a9de08 manifest, cbd04d03ea screenshots + cone rows, 72b7923dbf lane C
  sweep + checklist, 09b86e63d0 integration reconcile, 6b074f9168 manifest
  format, 2f890caa84 toast-free recapture, 59566a2837 Phase 13 record +
  teardown precondition, 8e7ba5a9cb lane A fix round, 5787094ee8 frontend
  record + palette comment, 5c371c2fba qa verdict + gate record.

Notes (Lane C, the deferral sweep and the checklist execution, 2026-08-19):
- TASK 1 delivered in state.md: the head block healed (Phase 12 merged
  71010cf82a, Phase 12 QA merged caf0fdee9f, Phase 13 in flight) and the
  new "Phase 13 handoff" section (the MAINTAINER GATES block plus the
  one-table deferral ledger, 105 rows) inserted above the locked design
  decisions.
- SWEEP FINDING (new, player-visible): guide.profPages.gatherDeeds.farming
  (src/ui/i18n.catalog/guide.ts:2920) still tells players farming "keeps no
  deeds of its own yet ... arrive in a later patch", which Phase 10 made
  false (seven deeds shipped). The Phase 7 deferral scheduled the reword
  for Phase 9; only gatherIntro was reworded there. Recorded as an open
  handoff row (reword needs M16 fills and the i18n-semantic-regressions
  care); Lane C is docs-only and changed no code.
- SWEEP FINDING (execution not placeable): the disposable-PG TOAST/WAL
  measurement (the P3 QA hard gate re-pointed at Phase 9) and the online
  resumed mid-growth live render check (P7 QA re-pointed at Phase 9 QA)
  have no recorded execution in any Phase 9 / 9b / QA block; both are open
  handoff rows.
- Environmental note for fresh worktrees: tests/localization_fixes.test.ts
  reds until `npm run i18n:gen` mints src/ui/i18n.status.json (the pretest
  artifact); after the regen the suite is green and the tree stays clean.

#### Phase 13 qa-checklist execution (docs/prd/masterwrought/farming/qa-checklist.md, every row)

Executed by Lane C on the p13/lane-c worktree (branch p13/lane-c, base
fix/farming-phase-13-integration-polish), 2026-08-19. Suite runs on this
tree: FAST BATCH `npx vitest run tests/architecture.test.ts
tests/localization_fixes.test.ts tests/monolith_budget.test.ts
tests/hud_perf_budget.test.ts` (3 files green first run, 173 passed / 4
skipped; localization_fixes green after the i18n:gen note above, 43
passed / 3 skipped). PARITY BATCH `npx vitest run tests/parity
tests/world_api_parity.test.ts tests/snapshots.test.ts`: 13 files passed,
1 skipped; 772 tests passed, 1 skipped; `md5sum
tests/parity/golden/farming_session.json` =
9dfd1c6ea073f853655e38675460e81f (the pinned value, exact). FARMING
BATTERY (17 suites: professions_farming, professions_farming_state,
farm_watch_fee, farm_recipes, recipe_economy, professions_zone_rollout,
professions_silent_loot, professions_work_orders, deeds_content,
farm_patch_placement, farm_verb_reachability, professions_feast,
farm_ready, farming_view, farm_event_feedback,
farming_command_chain_online, professions_graphics_fairness): 17 files,
567 tests, ALL green.

THE ANTI-CHORE AUDIT (the five design-promise rows, each with code-path
evidence, called out as its own subsection per the lane brief):
- A1 Two visits per cycle, no mid-growth interaction: PASS. The whole
  farming command surface is five verbs on IWorldFarming (plantCrop
  src/world_api/farming.ts:81, harvestCrop :89, convertHusks :100,
  placeFeast :110, consumeFeast :119; the server cases at
  server/farming_commands.ts:16/64/72/80/89); every knob rides plantCrop's
  payload, never a command of its own (facet comment
  src/world_api/farming.ts:20, D8); no verb reads or advances a growing
  plot; the draw-contract and gate-order pins ran green in the battery.
- A2 Nothing rots: PASS. normalizeFarmPlots admits a duration of exactly
  zero as a permanently-ready row and drops only a negative duration
  (src/sim/professions/farm_persist.ts:162-167 and :235, deviation (u));
  status derives from readyAtMs against the clock, withered is the
  pre-rolled survival outcome and never a lateness penalty; the late
  -harvest-equality arm (Phase 3 acceptance) ran green in
  tests/professions_farming.test.ts.
- A3 Absence never punished: PASS. Wall clock enters only through
  ctx.lockoutNowMs (src/sim/professions/farming.ts:630 write side, :743
  read side; the D3 seam); growth continues logged out; the login notice
  rides the shared persisted-notified predicate with flip-before-emit
  (src/sim/professions/farm_ready.ts:20-24, :59-67); tests/farm_ready
  .test.ts green in the battery.
- A4 Risk is opt-in: PASS. Survival ramps only inside the 25-point band
  (FARM_SURVIVAL_AT_GATE / BAND_SPAN / COMPOST_BONUS / WATCH_BONUS,
  imported at src/sim/professions/farming.ts:114-117); one band above the
  gate is always 100 percent, evaluated at CURRENT skill (deviation (r),
  monotone player-favorable); failure pays FARM_WITHERED_HUSK_COUNT = 2
  husks (farming.ts:179) with the convertHusks consumer; the boundary and
  cap arms ran green in the battery.
- A5 The timer UI exists and is honest: PASS. The Harvest Journal renders
  status-first with the decisive skew pin (deviation (ay); the
  harvest_journal suites), map and minimap pins mark the patch sites (P8),
  ready states surface as banners online plus the login notice, and
  farmNowMs supplies each host's own clock base
  (src/world_api/farming.ts:57); the cold-window contracts ran green in
  tests/hud_perf_budget.test.ts.

THREE-HOST PARITY:
- Both worlds implement the facet, parity pins current, farming_session
  green: PASS. The parity batch above (772 passed) plus the exact golden
  md5 9dfd1c6ea073f853655e38675460e81f.
- Offline growth degrades to session-local without error: PASS. The D3
  documented taster; the offline emitter is the sweep alone ((bf)(1));
  the offline clock floor at farming.ts:625-630; (ap) gives each world its
  own farmNowMs base.

DETERMINISM:
- Draw-count contract stated and pinned: PASS. The farming.ts banner plus
  per-arm pins (plant 2; harvest tier 1/2 exactly 1, tier 3/4 exactly 2;
  denies, expiry, login, tick all 0, the Phase 10 restatement); battery
  green; the parity draw digests green.
- No Math.random / Date.now / performance.now in src/sim/: PASS.
  tests/architecture.test.ts green (fast batch).
- Goldens moved only in deliberate isolated commits: PASS. The recorded
  chain (P3 twice-for-cause, P5 564ad5382a, the two (am) absorb re-mints,
  P8 ready-notice beat, P9 5676e12b73, P10 rare-event, P11 (bw)
  discharge, P12 beat P), md5 chain ending at the verified live value; no
  hand edit anywhere in the record.

I18N COMPLETENESS:
- PASS. tests/localization_fixes.test.ts green (43 passed / 3 skipped);
  every phase's ledger records English catalog rows plus M16 non-Latin
  fills, no overlay edits outside M16; AURA_NAME_KEY carries the one
  'Well Fed' row ((by)); sim/server farming emits are text-free
  id-carrying SimEvents (the standing pattern) plus the one
  error.castingPlanting matcher row. KNOWN accuracy gap recorded above
  (gatherDeeds.farming stale prose), an open handoff row, not an S3 red.

ECONOMY AND FIDELITY:
- No invented balance numbers presented as classic; tuning flagged: PASS.
  Every farming constant is maintainer-flagged at its definition and
  collected in the state.md MAINTAINER GATES block.
- recipe_economy invariant, work-order arithmetic, every-material-has-a
  -consumer, stocked rows carry positive buyValue, crafted outputs none:
  PASS. recipe_economy, professions_work_orders,
  professions_zone_rollout, farm_recipes, farmer stock pins all green in
  the battery; the consumer rule closed in Phase 6 with the
  merged-ALL_RECIPES closure arm.
- Produce market-listable under the material filter: PASS (kind junk,
  materials taxonomy, the P3/P5 pins in the battery).
- Tier 3/4 seeds reach the market via seed-back and rare events:
  BLOCKED-ON-RULING (the honest verdict; the row FAILS AS WRITTEN). The
  seed-back roll returns the SAME crop's seed and only from tier 3+
  crops, and golden_harvest is a yield multiplier, so NO first faucet
  exists (deviation (bo)); the checklist row's premise is exactly the
  recorded D11 hole, MAINTAINER GATE 1. The dormancy itself is honest and
  pinned (NEVER_STOCKED plus the self-clearing honesty arm, green in the
  battery).

SERVER AUTHORITY AND SAFETY: PASS. All five verbs resolve in the shared
sim server-side (server/farming_commands.ts:16-89); no farming command
ingests an ItemInstancePayload (the packet constraint, re-verified by the
per-phase privacy reviews); the one new server state family (FeastState)
is transient with a despawn sweep plus the instance and delve teardown
rosters (the P12 QA retention story); dev cheats sit behind
ALLOW_DEV_COMMANDS (src/sim/dev_commands.ts:345 farmgrow).

PERSISTENCE: PASS. CharacterState.farmPlots optional with defaults;
normalize clamps, sorts, and derives (the anti-tamper set at
src/sim/professions/farm_persist.ts:93, the 13 tamper arms);
save-then-load round-trip pins green (tests/professions_farming_state
.test.ts in the battery); NO DDL landed anywhere in the packet (the
feast is transient by design; every ledger records zero schema
movement), so the migration-safety dispatch condition never arose.

PERFORMANCE AND BUDGETS: PASS. updateFarming draws nothing and allocates
nothing per tick (architecture green; the P8 server-hot-path review and
the (bc) sub-millisecond measurement); fplot fires behind the heavy-self
diff gate (P3 ledger); the journal painter passes the cold-window
contracts (tests/hud_perf_budget.test.ts green); asset budget per the
(aq) honest bar (models/props moved exactly +174,844 bytes, no other
group moved); graphics tiers shed only cosmetics
(tests/professions_graphics_fairness.test.ts green; timers and ready
notices are actionable and never shed).

COPY AND CONTENT:
- No em dashes, en dashes, emojis in farming-authored text: PASS (the
  qa-stop hook and the pre-push floor enforce it; the four keybinds.ts em
  dashes are pre-existing release-side, recorded at P8 QA).
- IP-safe names (D17): PASS (the P5 batch-spec audit; the P9 farmer-name
  audit including the rejected candidates).
- Deeds pins re-pinned deliberately: PASS (280 / 3190 / 43 plus the
  frozen sha; tests/deeds_content.test.ts green in the battery).
- Wiki farming page regenerated and accurate; guide freshness green:
  DEFERRED-TO-INTEGRATION (owner: lane-a-wiki plus the orchestrator).
  Freshness was green at the Phase 12 QA gate (the caf0fdee9f record);
  Lane A owns the Phase 13 regen and accuracy pass; the
  gatherDeeds.farming stale prose above is the known accuracy gap to
  clear.

BUILD GATE AND DELIVERY:
- gate_select green per phase: PASS by the recorded per-phase gate logs
  (every phase block above carries its "[gate:select] PASS" marker line
  with counts; the log-marker rule is the arbiter).
- npm run gate green at packet close: DEFERRED-TO-INTEGRATION (owner: the
  orchestrator; the armory browser red stays the standing environmental
  exception).
- Screenshots committed and referenced: PASS.
  docs/screenshots/farming-phase-{01,05,07,08,09,09b,12} exist on this
  tree (ls evidence this sweep); phases 2 to 4, 6, 10, and 11 record
  no-visual-surface or deliberate-no-capture rationales in their blocks.
- The asset handoff manifest exists at
  docs/design/farming-asset-manifest.json: DEFERRED-TO-INTEGRATION
  (owner: lane-b-handoff). MISSING on this tree at sweep time (ls check);
  FARM_PROP_CONTRACTS in scripts/assets/farm_props/model.js is the
  JSON-shaped source; the manifest is lane B's Phase 13 deliverable.
- ci:changed rc: DEFERRED-TO-INTEGRATION (owner: the orchestrator; this
  lane's diff is docs-only).

### Phase 13 QA (final; teardown deferred per the D22 addendum)

Completed 2026-08-19 on fix/farming-phase-13-qa off feature/farming-plan at
6e03459500, local-only per D22 as amended. VERDICT: PASS-WITH-FOLLOWUPS
(0 BLOCKING anywhere; every SHOULD-FIX fixed in-round; the follow-ups are the
proposed Phase 14 packet plus the standing maintainer gates). Three real user
amendments arrived with the starter prompt and are ledgered as the D22
addendum in state.md: (A) teardown deferred (STEP 5 ran as a precondition
verification only; the packet stays), (B) no PR ever (the end-state delivery
is pushing feature/farming-plan to origin on the user's go, nothing more),
(C) the perfection sweep (verdict below).

- PRE-FLIGHT: tree clean at the Phase 13 merge-hash record; newest release
  branch re-resolved (origin/release/v0.40.0 e56707a675, already absorbed as
  the twenty-first; nothing newer, no absorb needed); the 14-commit phase
  chain bf02b405cb..5c371c2fba identified cleanly. EVERY baseline verified by
  RUNNING: farming_session md5 9dfd1c6ea073f853655e38675460e81f at 110 draws
  / 2439 ticks / 144 frames, IWorld 331 = 88 + 243, commands 204/217, delta
  keys 87, NEVER_STOCKED 21, ITEM_ART_PENDING 44, deeds suite green,
  FEAST_SHADOW_CAP 8, monoliths exact (sim 12246/12249, hud 19214/19214,
  renderer 13774/13774, main 11454/11460, online 5920/5950, game
  10793/10900). Golden and every parity pin held the whole round: ZERO golden
  movement.
- AUDIT FAN-OUT: three read-only lanes via one Workflow (correctness,
  test-coverage, dead-code), 3/3 first try; architecture-reviewer and
  frontend-seam-reviewer fresh on the Agent tool, both delivered first try;
  qa-checklist LAST: READY, 0 BLOCKING, 0 SHOULD-FIX, five NICE-TO-HAVE doc
  clarifications, all taken. The STEP 1 Explore context loader died
  report-less even after its nudge (the standing failure mode) and was
  recovered as a two-lane Workflow, 2/2. All five reviews PASS; the M5
  boss-mechanics extraction re-proven move-not-rewrite independently by two
  lanes (statement-level diff, rng draw order intact, parity green, tsc
  clean, the S3 scan-list entry verified).
- THE TWO HANDED CHECKS: EXECUTED first-hand, both PASS; the full numbers
  and evidence live on their state.md handoff rows (closed-by-Phase-13-QA):
  (a) the disposable-PG TOAST/WAL measurement (all 23 beds + all knobs
  planted over the real wire and persisted through the real 30 s autosave;
  blob 1,499 B compressed empty to 3,261 B fully planted; WAL delta about
  +1.5 to 3 KB per autosave cycle per planted character), and (b) the online
  resumed mid-growth live render check (planted as a PLAYER through the real
  plant sheet; the live socket closed in place; the client's own reconnect
  resumed; readyAtMs byte-identical, countdown drift 0 s, stage SPROUT
  correct; farmgrow round-trip flipped the row to ready post-resume).
- FIXES (all committed on the QA branch): fbcc3736d4 the D22 addendum ledger
  + QA-twin sweep; afc60cd554 the farm_patches_core palette mechanism comment
  (the sharpened comment had traded one inaccuracy for another: the tint is a
  per-instance whole-mesh setColorAt, no material-name selection);
  2547b4aa51 the later-patch dormancy disclosure pins (count-two pin over the
  farming page, mining negative arm, NEVER_STOCKED cross-pointer so a
  non-purchase D11 faucet still routes to the guide prose); c28370e4dd the
  redundant TranslationKey cast dropped from the literal deeds-key arm;
  767dd78eac the manifest honesty fix (generatedFrom/regenerationNote now
  state the real hand-derived contract) plus the NEW
  tests/farming_asset_manifest.test.ts binding the manifest's derivable
  halves to model.js, the farm_patches_core tables, and the importable
  adapter constants; 025d9dd89f the teardown-hygiene ledger addendum + the
  dev-line disclosure correction (three shots, not one); 5a13c1a851 the
  perfection-sweep verdict + the PROPOSED phase-14 packet; 9d9de6c3cb the
  five qa-checklist clarifications.
- MUTATION KILL TABLE (dirty-refusing scratchpad runner, targets committed
  first, rc nonzero AND named failing test AND summary line per kill):
  M1b resolved-tableBody dormancy reword KILLED ("both farming sections must
  carry the later-patch dormancy disclosure: expected 1 to be 2");
  M1c farmingSown-arm reword KILLED (same pin, other arm);
  M2 manifest footprint drift KILLED (farming_asset_manifest);
  M4 biome palette hex drift KILLED; M5 journeyEvidence reference dropped
  KILLED. M1 (catalog-side reword) SURVIVED AS A RIG ARTIFACT, not a pin
  gap: runtime English resolves from the generated en.ts bundle, so the
  catalog side is the i18n freshness gate's kill; the pin correctly binds
  the resolved artifact (recorded so nobody re-diagnoses it).
- THE PERFECTION SWEEP (D22 addendum (C)): buckets RESOLVED 22 /
  ACTIONABLE-IN-REPO 13 / MAINTAINER-GATED 51 / ACCEPTED-BY-DESIGN 44,
  nothing in no bucket (the full decomposition lives beside the D22 addendum
  in state.md). ACTIONABLE-IN-REPO is non-empty, so
  docs/prd/masterwrought/farming/phase-14-final-polish.md is authored (PROPOSED, plan-table
  row + README line marked): thirteen polish items, no mechanics, no tuning,
  no maintainer input.
- STEP 5 (teardown): PRECONDITION VERIFICATION ONLY per amendment (A). The
  dead-code lane re-derived the reference map from the tree: exactly seven
  screenshot subtrees (01/05/07/08/09/09b/12) are referenced only from
  docs/prd/masterwrought/farming/ while farming/ and farming-phase-13 survive via the manifest
  and the exporter; the ledger row MATCHES reality and is marked verified.
  Four out-of-packet state.md comment citations ledgered as a
  teardown-hygiene addendum row. The packet stays in place.
- Screenshots: none committed this round (the two executed checks produced
  probe evidence only, the Phase 11 QA precedent; the frozen journal
  literals and the state.md rows pin the content).
- GATE RECORD: one run on the frozen QA tip 8816205d5e, BROWSER_PATH +
  GATE_MAX_WORKERS=8 node scripts/gate_select.mjs, "[gate:select] PASS:
  all 12 steps green (vitest workers: 8)", exit code 0, ZERO FAIL markers,
  no druid_engines timeout. The two commits after the run (this gate record
  and the merge-hash record) are records only.

## Phase 14: Final polish (the perfection-sweep actionables), 2026-08-20

Branch fix/farming-phase-14-final-polish off feature/farming-plan at 4793879e09.
No absorb needed: origin/release/v0.40.0 tip e56707a675 unchanged at pre-flight
(zero commits past the twenty-first absorb). Baselines verified by RUNNING the
suites before any change: farming_session md5 9dfd1c6ea073f853655e38675460e81f
at 110 draws / 2439 ticks / 144 frames; IWorld 331 = 88 + 243 (34 facets);
commands 204/217; delta keys 87; NEVER_STOCKED 21; ITEM_ART_PENDING 44;
FEAST_SHADOW_CAP 8; monoliths hud.ts 19214/19214 EXACT, renderer.ts
13774/13774 (untouched the whole phase), sim.ts 12246/12249, main.ts 11454,
online.ts 5920, server/game.ts 10793.

ACCEPTANCE MATRIX (item, landing commit, discharge; every touched handoff row
in state.md moved to closed-by-Phase-14 in the SAME commit as its item):
- A1 body-class family fix: c205462f16 (evidence 4329bd3102; the missed
  UI_DOM_MODULES registration landed in 2d6cb12531, caught by the
  architecture suite). Both windows gained the family onVisibilityChange dep;
  funded extraction-first at the EXACT-ZERO hud ceiling by moving the whole
  body-class scan verbatim to src/ui/window_open_state.ts, ceiling LOWERED
  19214 to 19186 (file 19183); the three source-pin suites re-pointed
  (woc_store_window_contract, client_shell, market_window). Live mobile probe
  proved set AND clear with both windows; mobile 844x390 LOW shots committed
  under docs/screenshots/farming-phase-13/phase14-*.png (existing coned
  subtree, no cone churn).
- A2 style tokens: 51e6382b19. .ps-seed rides var(--color-bg-input), the
  token its sibling .ps-knob already used; deliberately NO new scrim token
  (the #1788 no-piecemeal-re-land rule). The report submitted line logs in
  'var(--gold)', suite pin re-pointed. Before/after pair captured on LOW:
  visually indistinguishable (scratchpad probe evidence, the Phase 11 QA
  precedent).
- A3 feast hint: 090a2b3002. itemUi.tooltip.clickSetOut plus five M16
  non-Latin fills; the bags_view feast branch returns it, pinned by literal
  on the fixture AND the real harvest_feast def.
- A4 a11y batch: 3d024dc658. Seed rows are a radiogroup named by the dialog
  title (role=radio, aria-checked, presentational li wrappers; locked rows in
  their own plain list); pendingSend mirrors onto root aria-busy through one
  setter; the journal gained a persistent in-dialog role=status ready
  announcement (readyAnnounce plus five fills); huskTradeAria reworded for
  WCAG 2.5.3 label-in-name containment in English AND all five non-Latin
  fills, containment pinned per locale through the real sink. Axe green over
  the live radiogroup, busy, and announcing trees; target-size suite green;
  keydown-guard pins untouched.
- A5 pending generators: 482fa2c386. RETIRED_KEYS moved whole to
  scripts/i18n_retired_keys.mjs (one shared source; .d.mts for the TS test);
  the registry scan marks a retired key's unprovided rows blocked-with-reason
  (the sanctioned documented-exception state; the main-scope over-allow pin
  re-pointed to say exactly that), runtime pending.ts lockstep; the
  gatherDeeds.farming outlier's fifteen pending Latin rows became blocked,
  its five non-Latin fills stay translated.
- B6 feast slotIndex: 69c83d4982. Test-first (both arms red as shipped); the
  arm consumes the CLICKED slot via consumeSelectedInventorySlot, a NAMED
  locked copy denies as locked, the dedicated place_feast command keeps the
  byte-identical id-only lock-aware walk. REACHABILITY recorded honestly
  (reviews): no shipped UI gesture passes a slot for the feast today, so the
  named-copy semantics are protocol hardening on the use-frame path,
  identical in both hosts; the bags-click divergence is a new open ledger row.
- B7 shared walks: 8a7fd2a349. countRawInSlots exported from
  src/sim/item_lock.ts beside its unlocked twin (structural param so the
  action bar's slice fits); Sim.countItem delegates (ceiling 12235 to 12232);
  the five src/ui copies collapsed (plant sheet, enchant rows, action bar
  direct; tradeOfferCeiling and totalHeldCount stay as thin domain aliases so
  their callers and source pins hold). distToBed exported from farming.ts and
  consumed by the farm_bed_interact reach mirror, import pinned
  (comment-stripped, count-exact).
- B8 delegate retirement: 570fd2c026. mobMeleeRange plus the private
  mobCombatProfile retired from sim.ts (last production caller left with M5);
  tests/threat.test.ts re-points at the module import; ceiling 12249 to 12235.
- B9 gatherDowngrade 'crop': d4a54536a5. Union member, the farming emit at
  the golden grant site (once per harvest command across both grades, always
  lost 'mark' under nothing-rots), the existing surface-independent
  downgradeMark toast is the client line. ZERO golden movement: the whole
  tests/parity directory re-run green, no golden file in the diff.
- C10 dish effect prose: 2d6cb12531. GuideProfRecipe gains an effect field
  (VALUES from the live def, never baked prose); the craft page composes the
  new guide.profPages.effect* templates (fifteen M16 fills); the stat label
  rides WELLFED_STAT_KEYS extracted to the pure leaf src/ui/wellfed_stat_keys.ts
  so the guide bundle cannot reach the deeds catalog (the spoiler pin
  re-proved the containment); accuracy mirrored BOTH ways against ITEMS with
  non-vacuity counts (foodRows >= 12, wellfedRows == 4) plus the
  every-shipped-kind-is-mapped precondition; the later-patch dormancy pins
  untouched; wiki regen committed fresh.
- C11 nameplate pair: c1af9a648e. targetCastDisplayLabel in
  cast_display_name.ts (farming localized on the target bar; every other id
  deliberately raw, pinned as the scope boundary incl. a real ability id);
  the feast plate comment states the real INTERACT_RANGE + 1 hysteresis pad,
  the exact boundary pinned both sides.
- C12 boss-mechanics depth: 2052d7e419. Direct-import summon-threshold cases
  (once per pull, both-thresholds-one-call, the REAL resetEvadingMob
  re-arming with the wave-really-despawns proof), the no-hand-set-timer
  countdown bracket, the de-fragilized stays-silent arms with their positive
  controls.
- C13: this block, the per-row landing hashes above, and the state.md sweep.

REVIEWS (all FRESH, 30-call budgets, report-first; 4/4 delivered, zero
report-less deaths): cross-platform 0 BLOCKING / 0 SHOULD-FIX (every
gatherDowngrade consumer enumerated: server routing is type-generic, no pin
enumerates the surface union outside types.ts; the B6 use-frame path carries
slot on both hosts); architecture 0 BLOCKING / 3 SHOULD-FIX (all resolved:
the feast consume tri-state branch + the direct stale-selection arm landed;
the bags copy-ref divergence LEDGERED as a new open row, a wire widening
beyond polish); frontend seam 0 BLOCKING / 4 SHOULD-FIX (all resolved: the
journal live region made genuinely persistent, see below; wellfed_stat_keys
registered in UI_PURE_CORES + both BARE_NAMED lists; dead imports swept; the
guide fallback DISPOSITIONED as the page's own baked-proper-noun policy with
a comment + a direct fallback-render test); test coverage 0 BLOCKING / 8
SHOULD-FIX (all taken: slice-anchor guards + comment stripping, the
both-grades dedupe proof, the real-ability-id boundary arm, the
RETIRED_REASON literal pin, runtime-pending non-vacuity via the pending
successor, the farmPlanted busy arms, the spellfx positive control, the
afterEach locale restore). Review round landed as 49a35b9e97 + 806f8f068e +
da89a1d72d.

THE REVIEW ROUND'S HEADLINE FIX: the journal's ready status line is now a
genuinely PERSISTENT live region. The first cut re-appended the same cached
node after each whole-root innerHTML write, which still detaches and
re-inserts it (AT drops or repeats announcements across a region that leaves
the tree). The repaint now targets an inner .hj-content wrapper
(display: contents, so the title and body still lay out as the root's flex
children), the status node is appended ONCE per open beside it, each
announcement lands as a FRESH child span (a repeat of the same crop is
byte-identical text; the new element is what makes it a real mutation), the
new relocalize() arm clears the region on a language switch (fanout registry
rows re-pointed, BOTH halves), and the wrapper's identity is the pinned
never-detached proof (the same-cached-node trap would pass an identity pin
alone).

MUTATION KILL TABLE (21/21 KILLED through the dirty-refusing scratchpad
runner, always AFTER committing; verdict = rc nonzero AND named failing tests
AND the summary line; two structural first drafts rebuilt as semantic
mutants, the P9b file-level-FAIL rule):
- M1 B6 slotIndex thread dropped -> 2 named reds (two-stack, locked-named)
- M2 B6 named-locked deny disabled -> 1 named red
- M3 B7 raw walk gains a lock filter -> 6 named reds
- M4 B7 distToBed zeroed -> 4 named reds
- M5 B9 truncation flag never set -> 1 named red (crop/mark arm)
- M6 C11 target label to identity -> 1 named red
- M7 C12 countdown deletion -> 1 named red (bracket arm)
- M8 C12 single-wave loop (rebuilt: while->if is a parse error via the
  loop's continue) -> 1 named red (both-thresholds arm)
- M9 C12 evade re-arm dropped -> 1 named red
- M10 A1 sync blind-false -> 3 named reds
- M11 A3 hint reverted to clickUse -> 1 named red
- M12 A4 announce suppressed -> 2 named reds
- M13 A4 radio role dropped -> 1 named red
- M14 A5 scan retired arm dropped (regen inside the run, regen after
  restore) -> 1 named red (the non-vacuous no-retired-pending arm)
- M15 C10 wellfed effect line dropped (rebuilt: the inverted guard crashed
  the sweep) -> 1 named red (coverage sweep)
- M16 C10 artifact amount 980 -> 981, anchor-scoped at braised greens with
  landing proof -> 1 named red (the accuracy mirror)
- M17 A2 token reverted to hex -> 1 named red
- MR1 feast null-selection branch gutted -> 1 named red (the direct arm)
- MR2 journal wrapper recreated per paint -> 1 named red (wrapper identity)
- MR3 relocalize clear dropped -> 1 named red (stale-locale arm)
- MR4 fresh-span mechanism replaced by textContent -> SURVIVED first as a
  near-equivalent (the DOM's string-replace-all also lands a fresh Text
  node), then the nodeName mechanism pin landed (da89a1d72d) and the same
  mutant re-run -> 1 named red

EVIDENCE: the committed journey rig PASSED all 17 checkpoints on the final
tree (mobile 844x390 LOW, the rig's seed-row read updated to aria-checked);
the phase probe proved live: body class set/clear with both windows in both
directions, radiogroup + aria-checked live, aria-busy false at rest; the A2
pair indistinguishable; probe trap re-confirmed: beds[1] sits in the Jessica
farmer-shadow band, beds[2] is clear. Browser suites standalone: a11y 35
green (including the busy tree and the announcing tree under axe),
target-size 19 green.

QA-CHECKLIST ROUND (2026-08-20, dispatched LAST per the packet): verdict
READY, 0 BLOCKING, 3 SHOULD-FIX, all resolved:
- Retired-keys inverse assertion TAKEN: the render sweep's own `seen` set now
  proves no retired key is actually rendered (the static liveReferences scan
  cannot see the computed families; the Phase 14 exclusion made a
  retired-but-rendered key ship silent English, so the sweep gained the one
  line that reds it).
- The huskTradeAria 16-stale-locales claim DISSOLVED BY PROBE (the
  one-probe-outranks-agreeing-agents rule): only the five non-Latin overlays
  fill the pair; the other fifteen locales are PENDING, English-fill BOTH
  keys with the NEW English, and stay on the release-fill worklist. The
  containment property was still widened to EVERY supported locale through
  the real sink (a future one-sided fill reds).
- The crop downgrade toast's node vocabulary TAKEN: the crop surface now
  carries its own mark line (hudChrome.gathering.downgradeMarkCrop, five M16
  fills); gatherDowngradeLineKey resolves off lost PLUS surface (still the
  ONE client dispatch), the hud case and its source pin follow, and the find
  arm stays surface-blind (a crop can only lose the mark). This also closes
  the reviewers' surface-never-read note: the field now has a client reader.
Its two LOW notes were already ledgered (roving tabindex) or are now closed
(the surface reader). Its N/A verdicts (content obligations, persistence,
tier fairness) were verified against the file list, not assumed.

NOTES FOR THE MAINTAINER (recorded, not decided): src/ui/CLAUDE.md's
catalog-domain gotcha list omits merge.ts as an en-only domain (A3 landed
there cleanly); the C12 stays-silent arms could return to the strong
zero-events form now that they drain pre-act noise; the radiogroup borrows
the dialog title as its group name (a dedicated label key would be nicer);
farm_bed_interact.ts now pulls farming.ts's dependency cone into its chunk
(deliberate, the shared-math win); INTERACT_RANGE itself remains unpinned to
a literal anywhere (the pad arms track it relatively, as intended);
tests/wellfed_tooltip_view.test.ts still regex-parses the stat map it could
now import from the pure leaf.
GATE RECORD: one run on the frozen tip 354cff6e77 (BROWSER_PATH=<playwright
chromium> GATE_MAX_WORKERS=8 node scripts/gate_select.mjs): mode=full (the
planner fell back, the standing broad-arm behavior), "[gate:select] PASS:
all 12 steps green (vitest workers: 8)", exit code 0, ZERO FAIL markers in
the whole log, 2897 test files / 40606 tests passed (2 expected fail, 115
skipped), browser regression 20 files 134 green, no druid_engines timeout.
The commits after the run (this gate record and the merge-hash record) are
records only.
MERGE-HASH RECORD: Phase 14 merged --no-ff into feature/farming-plan as
673036bb95 (phase tip 06575d2d02, nineteen commits; the phase branch
fix/farming-phase-14-final-polish deleted; no agent worktrees existed this
phase). Smoke on the merged tip: tsc clean, world_api_parity +
monolith_budget + parity coverage_c + architecture all green (422 tests),
farming_session md5 9dfd1c6ea073f853655e38675460e81f held.
