# Integration 45 icon backlog: final verification

All 466 audited rows have a disposition: 465 integrated runtime icons and one
documented retired Phoenix token exception. Work remains local on
`feature/v045-painted-icon-backlog`, based on `feature/v045-integration` at
`5167aabadeea7b21f0921e6d3973350072428b19`. The local verification below predates publication. On October 23, Reuben authorized
committing, pushing and opening a PR into integration 45; merge remains separate.

## Asset evidence

- 135 Season 2 armour icons, four skills, one Horse Whistle, five referral rewards,
  96 map-loot icons, 57 Deed crests, 32 faction vendor icons, two Clue Hunt icons,
  18 faction rewards/toys and 115 dungeon icons.
- The inventory links 43 accepted-art manifests. Every runtime file matches its
  accepted hash and byte count. All retained originals and 512px masters match
  their records, including the horse model-render sources: 1,342,024,457 bytes.
  See [preservation results](final-preservation.json).
- Individual paintings have shipping-size, small-size, grayscale and circular-crop
  evidence, plus desktop/mobile inventory, action-bar or Deed-card captures.
  Normal and Heroic armour own separate paintings. Heroic weapons retain the
  established base-art inheritance.
- Current item catalog: 2,181 owned shipping files, 2,210 live entries and one
  pending retired token. Ability and Deed pending lists are empty. All 346 Deeds
  have artwork. Historical records and superseded hashes remain preserved.
- Final reconciliation corrected the Clockwork Shock Bomb skill row, whose
  evidence link had been overwritten by the same-named item row. Both runtime
  assets and accepted records were already correct.

## Checks

Logs remain under `tmp/icon-audit/`.

- `node scripts/item_art_audit.mjs --verify-only`: full catalog passed.
- `npx vitest run --maxWorkers=2 tests/warfare_season2_icon_art.test.ts tests/missing_skills_v045_art.test.ts tests/icon_backlog_v045_art.test.ts tests/deed_backlog_v045_art.test.ts tests/faction_painted_icons_v045.test.ts tests/dungeon_painted_icons_v045.test.ts tests/item_icons.test.ts tests/weapon_icons.test.ts tests/deed_icons.test.ts tests/release_v039_icon_art.test.ts tests/item_art_consistency.test.ts tests/missing_painted_icons_wave.test.ts tests/architecture.test.ts tests/localization_fixes.test.ts`:
  initially 273 passed, five failed and three skipped. The failures were stale
  live-catalog counts/owners and pending-Deed expectations. After updating those
  assertions while preserving historical membership through supersession records,
  `npx vitest run --maxWorkers=2 tests/item_art_consistency.test.ts tests/missing_painted_icons_wave.test.ts`
  and the final `npx vitest run tests/item_art_consistency.test.ts` retries leave
  **278 passed, three skipped across 14 files**. This reconciles results across
  runs; the entire selection was not rerun after assertion-only edits.
- `npm run check:types`: passed. `npx tsc --noEmit` also passed after final test edits.
- `npm run security:gate`: passed; 14,267 files, zero high-severity findings after priors.
- `WOC_FFMPEG_PATH=/opt/homebrew/bin/ffmpeg WOC_FFPROBE_PATH=/opt/homebrew/bin/ffprobe npm run build:bundle`:
  passed, including 3,030 hashed media assets. Existing chunk-size warnings remain.
- Explicit `npx biome check` over all 17 changed source/test/script files: passed.
  `git diff --check`: passed.

Independent visual/provenance reviews found no outstanding findings. Their scope
and earlier focused checks are recorded in the tracker.

## Representative UI surfaces

The local harness is `tmp/icon-audit/final-surfaces.mjs`; screenshots and decoded
URL reports are under `docs/screenshots/icon-backlog-v045-surfaces/`. All eight final
captures passed visibility and decoding assertions and were visually reviewed:
1600x900 desktop and 844x390 mobile landscape. It exercises
equipment, bank, vendor and mail in desktop and mobile landscape layouts. Bank and
mail use stable local view fixtures, and a nearby offline vendor uses actual Rift
Watch stock. These validate rendering, not online transactions. Vendor rows retain
normal rank/currency gating and its dimmed appearance.

An early harness attempt used non-purchasable dungeon drops as vendor stock; the
shop correctly excluded them. Another used the wrong NPC position field, letting
the proximity check close the window. The final harness fixes both and requires the
window to remain visible. The mail fixture now has a stable identity to avoid
replacing the clicked element during capture.

Tooltip attempts are retained with an `unverified-` filename. A desktop tooltip
appeared but disappeared before screenshot completion; no reliable desktop tooltip
capture is claimed. Existing painted icons were verified directly on the other
surfaces. Portrait gameplay remains outside visual acceptance because the game
requires landscape orientation.

## Contribution gate limitation

`GATE_SELECT_BASE=5167aabadeea7b21f0921e6d3973350072428b19 node scripts/gate_select.mjs`
first stopped because the installed static audio executable failed with error `-86`.
Repeating with the system ffmpeg/ffprobe overrides used for the successful build
passed preflight and i18n generation/freshness, regenerated manifests, and stopped
at **manifest freshness**. The generated Guide now references the new Deed crests,
but its changes are uncommitted. The generator-produced file is retained.

The selective gate has not passed; its later selected/full-suite checks have not
run. The artwork and scoped implementation are ready for review, but this is not
a claim of merge readiness. After authorized staging/commit, rerun the gate against
the integration base and address further results before merging.

## Preservation and handoff

Originals, masters, exact prompts and preparation scripts remain in this worktree
under `tmp/imagegen/` and `tmp/icon-audit/`. These are local, ignored working
artifacts; committing shipping files alone will not archive the sources. Preserve
this worktree or copy those folders before removing it.

## PR publication follow-up

Reuben authorized PR publication on October 23. The icon commit merges cleanly
with integration head `d13836dfd53` in a local merge simulation. The gate retry
passed manifest freshness and the security scan, then stopped at formatting in
39 new provenance JSON records. The task JSON files were formatted with Biome;
all parsed values were compared before/after and are identical.
`GATE_SELECT_BASE=5167aabadeea7b21f0921e6d3973350072428b19 npm run ci:changed`
then passed. Later selective-gate steps remain outstanding; use CI before merging.

The publication pre-push guard suites passed 163 tests with three skipped. The
initial hook chose the release comparison base for lint; the final push uses the
explicit integration base and runs the repository hook. No check is bypassed.

## PR CI regression fixes

PR #4605's initial CI run (39781811866) found stale pending-art assertions in
Reliquary, Deed and Clue Hunt tests; an outdated catalog snapshot and historical
ownership reconciliation; a referral popup assertion still naming borrowed art;
four new ability files absent from the freeze manifest; and 45 referenced
screenshot subtrees missing from the five sparse test-job checkouts.

The follow-up updates those expectations against the shipping files and accepted
provenance. Historical hashes remain intact. The spell freeze adds only
`druid/hamstring_bite.webp`, `druid/lunge.webp`,
`warrior/clockwork_shock_bomb.webp` and `warrior/courier.webp`; no existing pin is
changed or removed. Sparse checkout expands from 56 to 101 referenced subtrees
without changing test selection, required jobs or the reference-corpus guard.

Focused verification:

- `npx vitest run --maxWorkers=2 tests/reliquary_cell_art.test.ts tests/release_art_audit_v036_reliquary_deeds.test.ts tests/clue_hunts_content.test.ts tests/item_art_audit_builder.test.ts tests/masterwrought_art_completion.test.ts`: 76 passed.
- `npx vitest run --maxWorkers=2 tests/spell_icon_freeze.test.ts tests/referral_cards_controller.test.ts tests/ci_workflow.test.ts`: 50 passed.
- The full `tests/varkhul_forge_encounter.test.ts` suite passed unchanged alongside
  the local reproducer for the three failures above. CI's Heroic reset case hit
  its 20-second timeout; fresh CI will establish whether it recurs.
- `git diff --check` and scoped Biome checks passed (existing lint warnings only).

The PR checks, browser tests and both long-simulation lanes passed on the initial
CI run. Fresh CI at the follow-up commit remains required before merging.
