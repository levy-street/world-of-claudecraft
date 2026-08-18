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
| Phase 9 QA | done (FAIL on the go-live acceptance, scope stop; PASS on the phase's own diff) | 2026-08-17 | 2026-08-17; branch fix/farming-phase-09-qa (eighteenth absorb f4ca0f7000 first), merged --no-ff (hash in the Phase 9 QA notes tail); 1 BLOCKING scope finding (no player verb plants or harvests, state.md (bn)) plus the tier 3/4 seed bootstrap hole ((bo)); 0 BLOCKING on the diff across nine lanes; the live-client journey walked 39 checkpoints green at all four hubs; 16 of 16 new mutants killed; the QA fixes are the husk-trade focus restore, the stale-comment sweep, and the coverage pins |
| Phase 10 (celebrations) | not started | | |
| Phase 10 QA | not started | | |
| Phase 11 (well-fed food) | not started | | |
| Phase 11 QA | not started | | |
| Phase 12 (shared feast) | not started | | |
| Phase 12 QA | not started | | |
| Phase 13 (integration polish) | not started | | |
| Phase 13 QA (final; teardown offer) | not started | | |

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
    forced both the move and a new camp-clearance arm.
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
- [x] docs/farming/progress.md and docs/farming/state.md ledgers are updated

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
DONE 2026-08-13 (docs/farming/phase-06b-release-sync.md; ran BEFORE Phase 6
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
  PROPOSED Phase 9b (docs/farming/phase-09b-bed-verbs.md) or a maintainer
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
docs/farming/phase-09b-bed-verbs.md.
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

### Phase 10
(not started)

### Phase 11
(not started)

### Phase 12
(not started)

### Phase 13
(not started)
