# Refined character refresh, 23 September 2026

> Record of an earlier state of this branch (see the note at the top of
> [the parent page](../README.md)): file names, counts and `tmp/` driver paths below
> describe that state, not the shipped tree.

The existing local character draft on `release/v0.44.0` at `56525e0343`
now uses the maintainer's `WOC_Game_Ready_2026-09-23/public` export.
All 18 GLBs match the supplied checksums. The 32 underarmor PNG/KTX2 files
are identical to the previous pack. Accepted delivery and Blender master
hashes are recorded in `scripts/assets/woc_character/export_20260923.json`.

The revised arms have 85% of the previous reach, with corrected female
shoulders and a changed idle pose. Bone names, equipment nodes, handslot
scales and all 24 clip names/durations are preserved. This refresh changes no
runtime or test code; the existing hood, combat linkage and direct jump-to-
movement fixes remain in place.

The nine wiki class stills and the two class-derived NPC portraits were
regenerated through their existing renderers. The NPC source manifest was
refreshed from the successful renderer receipt. Other environment assets and
the original main checkout were preserved. The prior character pack is backed
up under the ignored `tmp/refined-character-refresh-20260923/before/` folder.

## Comparisons

Before shows the previous long-arm pack; after shows the refined pack in the
actual local game, using the same front-camera setup and equipment. Idle
animation phase and scene time are not frozen. These are compatibility
captures, not performance measurements.

| View | Before | After |
| --- | --- | --- |
| Male warrior | [Before](before-desktop-warrior.png) | [After](after-desktop-warrior.png) |
| Female warrior | [Before](before-desktop-female-warrior.png) | [After](after-desktop-female-warrior.png) |

Live combat captures cover [male Hunter shooting](combat/male-hunter-ranged.png),
[female Hunter shooting](combat/female-hunter-ranged.png),
[male Mage casting](combat/male-mage-cast.png) and
[female Mage casting](combat/female-mage-cast.png).
[The live matrix](combat/live-matrix.json) records melee playback for all 18
models, plus ranged/cast playback for both body types.

## Verification

- Delivery `SHA256SUMS.txt`: every listed file passed before installation.
- `node_modules/.bin/vitest run tests/woc_export.test.ts tests/woc_character.test.ts tests/woc_parts.test.ts tests/woc_far_equipment.test.ts tests/character_clipmaps.test.ts tests/visual_manifest.test.ts tests/glb_texture_compression.test.ts tests/skin_atlas_ktx2_compression.test.ts tests/rig_shared_skeleton.test.ts tests/character_anim_state.test.ts --maxWorkers=3`: 10 suites, 180 tests passed.
- `npm run test:browser -- tests/browser/woc_portrait.browser.test.ts tests/browser/woc_hood.browser.test.ts tests/browser/woc_combat_linkage.browser.test.ts --maxWorkers=2`: 3 Chromium suites, 52 tests passed.
- `node_modules/.bin/vitest run tests/mob_portrait_source_manifest.test.ts tests/target_portrait_view.test.ts --maxWorkers=2`: 2 suites, 25 tests passed.
- `node scripts/build_mob_portrait_source_manifest.mjs --check`: passed.
- `node_modules/.bin/turbo run check:types build:bundle --ui=stream`, with pinned pnpm 10.34.5 on PATH: four tasks passed, including client/admin/bot types and the production client bundle.
- `npm run security:gate`: passed. `npm run ci:changed` passed with no committed diff; explicit `node_modules/.bin/biome check scripts/assets/woc_character/export_20260923.json` passed.
- Fresh local-game browser sessions loaded every class and both body types, with no page exceptions or failed model/texture requests. The jump sequence was `Idle`, `Jump`, `Run`, with no landing clip. Live melee, ranged and cast probes passed.
- Independent frontend review found no blocking compatibility or visible idle-pose regressions. Every revised GLB decoded with finite, reachable animation samples. Physical-phone performance and every frame of every in-game action were not revalidated in this integration pass.
- `npm run gate` still stops at the existing draft's generated guide/media manifest freshness comparison against the unstaged index. This is not a green full merge gate. No staging, commit, push or deployment was performed by this refresh.

Local preview: updated and verified. Merge readiness: remains pending the
existing draft's staging and complete merge gate.
