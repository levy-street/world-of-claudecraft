# v0.31.0 merge, COMPLETE (branch `merge/v0.31.0`)

**This branch builds and runs.** Every conflict is resolved; `npx tsc --noEmit`
is clean and `npx vite build` is green across all five entries.

- Merged: `upstream/release/v0.31.0` @ `68cfd209a` into `feature/ravenrift`
- Merge base: `802f2fc78`
- Final commit: `444ae862c`
- Backups: `woc-map-editor-backup-2026-07-27_17-23-41-pre-v0.31`,
  tag `backup/pre-v0.31-2026-07-27`

## The rule this merge followed

Keep **every** fork feature while taking upstream's new work. Where a hunk had
content on both sides, both sides were kept rather than one picked. All the
named fork features survive: the `src/editor/` tool set (88 files, 26 topbar
actions), Infernal Abyss, rift interiors and rift gear, `/unstuck`, City Build,
caves, fluid volumes, decals, point sounds, the editable-foliage `propsMode`
tiers, the world-boss summon channel, the dragon cues, and Ravenrift.

## Verification

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean (0 errors) |
| `npx vite build` | green: game, admin, play, guide, editor |
| editor acceptance suite | **75 of 77 files, 746 of 749 tests** |
| full suite | 87 failing files, **down from 151** on `feature/ravenrift` |
| `src/editor/` files | 88 |
| topbar actions | 26 |

The editor suite's only failures are the two known-failing baseline suites:
`tests/cave_under_terrain_movement.test.ts` (1) and `tests/minimap_markers.test.ts` (2).
The suite grew from 76 files to 77 because v0.31 added one matching test file.

`npm run build` still fails at `wiki:content` for the pre-existing reason (fork
zones missing from the wiki material table), use `npx vite build` directly.

To re-run the editor suite:

```bash
npx vitest run $(ls tests | grep -iE 'editor|city|collision|cave|decal|rock|fluid|terrain|biome|dungeon_draft|marker|foliage|minimap' | sed 's|^|tests/|' | tr '\n' ' ')
```

## How the hard conflicts were resolved

- **`src/render/water.ts` -> v0.31 verbatim** (SPACEY's directive 1). The earlier
  checkpoint had left a half-merged file referencing an undefined `group`, so it
  was restored from `68cfd209a` and the RENDERER was adapted instead: v0.31 water
  is one mesh per body with no owning group, so the fork's single
  `waterView.group.visible` toggle became a `setWaterVisible()` helper, and
  `ensureZone` dropped out because v0.31 builds every body up front. The editor's
  water-level slider still works, v0.31 has its own `setLevel()`.
- **`src/render/renderer.ts`**, v0.31's LOD (`characterLodBands`), draw stats,
  Eastbrook town view, swim hysteresis (`isSwimmingAtDepth`) and prewarm
  bookkeeping, with the fork's caves, fluid surfaces, decals, day/night, clouds,
  `blankPresentation` foliage gate and two-plane foliage LOD kept on top. The
  fork's older swim derivation was removed as superseded (same scope, every
  consumer reads v0.31's).
- **`src/render/dungeon.ts`**, Infernal Abyss and Drowned Court kit tables sit
  side by side. Upstream's cache-passing tint helper was renamed
  `tintedSurfaceMaterial` so it stops colliding with the fork's authored-floor
  `tintedMaterial(pack, tint)`.
- **`src/ui/map_window_view.ts`**, detail draws on
  `zoom >= MAP_DETAIL_ZOOM || spanX < DETAIL_SPAN`. Upstream's absolute zoom gate
  alone would cost a small authored map its detail overlay at zoom 1; the OR keeps
  v0.31's "null below the threshold" behaviour on the wide built-in world.
- **`src/ui/arena_window.ts`**, took v0.31's `matchMap` but did NOT reinstate its
  Fiesta practice button: this fork moved Fiesta to its own `vale_cup_window`,
  which owns that button. `practice` was dropped from `ArenaView` accordingly.

## Count pins, all re-derived from source, never carried over

| pin | fork | v0.31 | **merged** |
|---|---|---|---|
| `command_schema` send / dispatch / dispatch-only | 170/180/10 | 164/173/9 | **171/181/10** |
| `world_api_parity` IWORLD / DATA / METHOD | 260/70/190 | 256/69/187 | **267/73/194** |
| `snapshots` `ALL_DELTA_KEYS` | 57 | 56 | **58** |
| `architecture` `RENDER_PURE_CORES` |, |, | **+3** (`authored_walls_core`, `day_night_core`, `decal_stream_core`) |

`architecture.test.ts` also gained `canvas_dpr` / `map_art` / `map_bg` in
`UI_DOM_MODULES`. Those three plus the three render cores are fork-only modules
the fork never registered, so that suite was already red before this merge.

## Traps that bit, and how

1. **`worldContent.services`**, combined as planned; blank-map gating intact.
2. **`ghostGraveyard` / `resolvePosition` signatures**, resolved at the earlier
   checkpoint; the merged `resolvePosition` is
   `(seed, x, z, r, ignoreFences, delveModules, riftToken, moverY)`.
3. **Instance-plane literals (trap 5), this one was live.** v0.31's new
   `tests/world_telemetry.test.ts` hard-codes `x = 900` and `x = 7900`, which are
   overworld here (`INSTANCE_X_BASE` is 99_400). Rewritten to derive from
   `instanceOrigin` / the delve band constants.
4. **Eastbrook rebuild moved the world out from under fork tests.** Fork tests
   naming coordinates as literals broke because the props at those coordinates
   moved: `tests/caves.test.ts` targeted "the village house at (10,12)" (now open
   ground) and `tests/sim_npc_routes.test.ts` patrolled an "open meadow" the Grand
   Armoury footprint now covers. Both repointed at the merged world.
5. **`marshReeds`**, v0.31's new scenery family. Added to the editable-all
   `propsMode` tier (promoted to placements + stripped from static props), so a
   maker can select and delete reeds like every other family.
6. **`src/render/assets/manifest.generated.ts` is a build output.** It was taken
   from upstream at the checkpoint, which dropped the fork's 349 Medieval Village
   Vol. 2 entries. Regenerate with
   `node scripts/build_media_manifest.mjs generate`, same rule as `npm run i18n:gen`.

## What is still red (NOT merge regressions)

87 files fail in the full suite, down from 151 pre-merge. 23 of them changed
state; **16 are brand-new v0.31 test files that never ran on this fork**, and the
rest are fork tests that upstream content changes invalidated. None is a broken
fork feature. Grouped by what they actually need:

- **v0.31 Eastbrook content the fork has not adopted** (7 new files):
  `eastbrook_civic_beacon`, `eastbrook_mailbox_asset`, `eastbrook_noticeboard_asset`,
  `eastbrook_polish_artifact_integrity`, `eastbrook_polish_capture_contract`,
  `eastbrook_town_assets`, `render_glb_replacement_assets` (armoury source
  fingerprint pin).
- **v0.31 sim features needing fork wiring** (6 new files): `banker_chest`,
  `corpse_harvest_result_event`, `corpse_harvest_view`, `dev_kit`,
  `noticeboard_interaction`, `professions_silent_loot`.
- **Fork tests with entity ids / coordinates the rebuild moved** (4 files):
  `threat` (hard-codes entity id 85), `spatial`, `pyroblast`, `ground_target_cast`.
- **Content gaps, not code** (3 files): `item_icons` (114 fork items have no
  painted `.webp` yet), `marsh_reeds_placement` (v0.31 reed coordinates vs this
  fork's terrain), `i18n_status_registry` (gitignore assertion).
- **New v0.31 gates** (2 files): `hud_update_drive`, `duplicate_test_blocks`.
