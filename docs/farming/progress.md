# Farming: progress

## Status

| Phase | Status | Started | Completed |
|---|---|---|---|
| Packet authored | done | 2026-08-07 | 2026-08-07 |
| Packet PR merged | superseded by D22 (local-only; no farming PRs) | | |
| Phase 1 (foundation) | done | 2026-08-07 | 2026-08-08 |
| Phase 1 QA | done (PASS-WITH-FOLLOWUPS) | 2026-08-08 | 2026-08-08 |
| Phase 2 (patches and plots) | done | 2026-08-08 | 2026-08-08 |
| Phase 2 QA | not started | | |
| Phase 3 (growth engine) | not started | | |
| Phase 3 QA | not started | | |
| Phase 4 (knobs) | not started | | |
| Phase 4 QA | not started | | |
| Phase 5 (crops and tools) | not started | | |
| Phase 5 QA | not started | | |
| Phase 6 (economy hooks) | not started | | |
| Phase 6 QA | not started | | |
| Phase 7 (render and juice) | not started | | |
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

### Phase 3
(not started)

### Phase 4
(not started)

### Phase 5
(not started)

### Phase 6
(not started)

### Phase 7
(not started)

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
