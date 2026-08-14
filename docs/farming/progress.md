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
| Phase 7 (render and juice) | DONE 2026-08-14 | fix/farming-phase-07-render-and-juice (merged, deleted) | 0 BLOCKING across three domain reviews; 5 SHOULD-FIX fixed in-phase |
| Phase 7 QA | not started | | |
| Phase 8 (Harvest Journal) | not started | | |
| Phase 8 QA | not started | | |
| Phase 9 (world presence, go-live) | not started | | |
| Phase 9 QA | not started | | |
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

Gate record: run 1 on the frozen committed tree, judged by log markers per
the standing rule. See the Notes above for validation detail; suites
1,078/1,080 green in the targeted battery (2 pre-existing skips), ci:changed
exit 0 with warnings only.

### Phase 8
(not started)

### Phase 9
(not started)

### Phase 10
(not started)

### Phase 11
(not started)

### Phase 12
(not started)

### Phase 13
(not started)
