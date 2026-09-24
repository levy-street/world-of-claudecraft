# Buried Hoard implementation and verification

Implementation is on `feature/treasure-vaults`, based on `27d31b4d29`.
No push or pull request was made.

## Implementation

- `src/render/hoard_entrance.ts` owns the hatch body, terrain-conforming mound,
  one-second reveal, warm light, rarity metalwork, rim and rising dust. Its pure
  core has deterministic animation and preset tests. The existing entity compile
  gate owns first GPU use; shared resources and per-body disposal are tested.
- `public/models/props/hoard_entrance.glb` contains the wood, iron, earth, stones,
  roots, shovel and ladder. The committed exporter and fingerprint live under
  `scripts/assets/hoard_entrance/`. It is 93,520 bytes and 4,496 triangles.
- Separate hoard ambience and authored earth/wood sounds replace the Rift spawn
  cue. Ordinary Rift ambience is unchanged.
- The compact `vr` entity field transmits rarity. Full, sparse and cleared wire
  state are tested. Map and minimap use a treasure X and a localized accessible
  label, with the requested non-Latin translations.
- `src/sim/treasure_vault_placement.ts` checks the physical footprint for dry,
  reasonably level ground. Normal placement remains five yards forward. Unsafe
  sites search nearby bearings and distances up to 20 yards. A completely unsafe
  site retains the map. Tests cover all authored sites and the Willowfen river.

## Passing checks

- `npx tsc --noEmit` (with `GOMAXPROCS=4`).
- `npx turbo run check:types build:env build:server build:bot build:bundle --concurrency=1 --ui=stream`:
  seven tasks passed. A prior concurrent attempt exhausted native compiler
  resources; this serial retry completed successfully.
- Focused Vitest run: 76 files, 1,623 tests passed. Command:

```text
npx vitest run rift tests/treasure_vault.test.ts tests/treasure_vault_placement.test.ts tests/snapshots.test.ts tests/interest.test.ts tests/hoard_entrance.test.ts tests/hoard_entrance_core.test.ts tests/hoard_entrance_asset.test.ts tests/hoard_ambience.test.ts tests/map_marker_semantics.test.ts tests/map_semantic_accessibility_core.test.ts tests/map_window_view.test.ts tests/map_window_painter.test.ts tests/minimap_markers.test.ts tests/minimap_painter.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts --maxWorkers=2
```

- Additional touched suites passed: five files, 521 tests, two skipped:

```text
npx vitest run tests/map_marker_rift_delve_art.test.ts tests/map_navigation_landmarks.test.ts tests/render_glb_replacement_assets.test.ts tests/sfx_rift_pending_sweep.test.ts tests/world_api_parity.test.ts --maxWorkers=2
```

- `node scripts/assets/hoard_entrance/export_hoard_entrance.mjs --verify-staged`:
  deterministic shipped bytes match. Raw and shipped GLB validation reported zero
  errors and warnings. The texture-free model requires no KTX2 conversion.
- The full gate's generation/freshness, SFX conformance, media, malware and Biome
  stages passed before its test stage.
- `git diff --check` passed. The capture helper passes Biome with three advisory
  environment-variable warnings for its standalone capture filters.
- The full run found two shader-domain guard failures in the new light shader.
  Commit `1ee5ceab3d` clamps its power bases and registers its three shader sites.
  `npx vitest run tests/shader_pow_domain.test.ts tests/hoard_entrance.test.ts tests/hoard_entrance_core.test.ts --maxWorkers=2`
  then passed all 23 tests in three files. This numerical guard does not change
  the intended captured appearance.
- The new marker increases the locale marker inventory from 104 to 105 rows.
  All previous digests were verified to match after excluding only the new key,
  then the literal pins were updated. `tests/i18n_completeness.test.ts` now passes
  13 of 14 tests, including the marker guard; its remaining failure reports
  untranslated item names such as Dense Sharpening Stone, outside this change.
  The baseline run reproduced that same single failure, with 13 tests passing.
- The full run also detected the new fingerprint family missing from the remint
  registry. It is now registered; the scoped remint reports zero replacements and
  unchanged GLB SHA. `npx vitest run tests/remint_registry_completeness.test.ts tests/hoard_entrance_asset.test.ts --maxWorkers=2`
  passes all six tests.
- The disclosure ownership guard now counts the new entrance classifier's call
  to the existing neutral policy. Hoard boundary tests cover 80 and 80.01 yards
  and reject non-object entities. `npx vitest run tests/map_entity_disclosure_core.test.ts tests/map_navigation_landmarks.test.ts --maxWorkers=2`
  passes all 12 tests.
- The SFX catalog guard now pins 321 keys, including both hoard cues, while
  preserving the existing UI, mount and mob counts. `npx vitest run tests/sfx_manifest.test.ts tests/hoard_ambience.test.ts tests/rift_sfx_key_catalog.test.ts --maxWorkers=2`
  passes all 41 tests.

## Limits

The dark pit is an occluding mesh, not a terrain excavation. Placement samples
terrain and water, but does not search for vegetation collisions or guarantee a
navigation path. Existing trees may overlap it, as visible in Willowfen evidence.
Phone captures deliberately use Low: the body and rarity trim remain, while light
shafts, glow and motes are omitted. Online rarity is covered by protocol tests;
the screenshots use the offline game.

`node scripts/asset_budget.mjs --json` reports aggregate repository budget
overages (481.848 MiB total against 95 MiB, including props at 49.263 MiB against
4 MiB). The new GLB is approximately 91 KiB. The aggregate budget is not green.

## Browser checks

`npm run test:browser` initially reported 45 passing files and four failing files
(412 passing tests, six failing tests). Five failures were timeouts and one was a
focus assertion while other checks were running. All four affected files passed
when rerun with a single worker: 53 tests, zero failures.

```text
npm run test:browser -- tests/browser/harvest_preference.browser.test.ts tests/browser/intentional_gathering.browser.test.ts tests/browser/material_sources.browser.test.ts tests/browser/stale_focus_space.browser.test.ts --maxWorkers=1
```

## Full gate

`npm run gate` completed its full test stage in 5,235.55 seconds and exited 1:
119 failed files, 4,305 passed files, 36 skipped files; 400 failed tests, 64,373
passed tests, two expected failures and 563 skipped tests. The gate stopped at
`vitest (full suite)`. Builds and browser checks were run separately as above.

That run includes the pre-fix shader, marker-inventory, fingerprint-registry,
disclosure-inventory and SFX-inventory failures corrected above. Their focused
reruns passed; the entire 87-minute suite was not repeated after those fixes.
The branch is not certified globally green. Remaining failures include content
inventories, bags, localization, simulation balance/timeouts, platform tooling and
golden parity snapshots. Not all have been reproduced on the baseline.

Some platform failures have direct diagnostics: SFX export reaches its POSIX
installer check and fails with `spawnSync sh ENOENT`; the playback profile test
expects POSIX mode 0644 but Windows reports 0666. These do not indicate invalid
hoard audio. The separate SFX conformance stage passed.

The recorded failing file names are in `full-gate-failures.txt`; raw local logs
remain under the ignored `tmp/hoard-*.log` files.

Baseline checks in the detached `27d31b4d29` worktree reproduced seven failing
assertions in `item_art_consistency.test.ts` and `professions_blob_growth.test.ts`,
and eleven in `bags_window.test.ts`, `action_bar_view.test.ts` and
`clue_scrolls.test.ts`. These suites also fail in the full feature-branch run.
After running `npm run i18n:gen` in the baseline worktree,
`npx vitest run tests/localization_fixes.test.ts --maxWorkers=1` reproduced its
one failing `s3_registered` simulation-text registration assertion, with 49
passing and three skipped tests.
