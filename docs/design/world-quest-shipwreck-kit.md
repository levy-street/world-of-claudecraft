# World Quests shipwreck placement kit

The approved Placer export is now the live Farshore salvage site. Its wreck and hull are permanent scenery,
and eleven collectible props replace the old ship, dock, ropes and rotating debris
layouts. Only the eleven smaller props carry salvage markers. Players recover any eight distinct pieces. Every position, height, yaw and
scale matches the submitted export, including the deliberately submerged parts.

## Visit or edit locally

With the local client running at `http://127.0.0.1:5173/`, enter an offline world:

```text
/dev salvage
/dev tp 320 103
/placer quests
```

`/dev salvage` offers the quest for testing; the teleport lands on the dry beach
near the wreck. The quest footprint is centered at `(347.6, 126.45)` with radius 54.
The wreck map label is at `(306, 123.05)` and the ambush opens at `(340, 100)`.

Placer's **load current quest assets** imports the live wreck, decorative hull and all eleven
pickups. Select a row to move it, or enable **replace selected** and choose another
asset. The originals stay hidden while their imported preview is open and return
when Placer closes. Editor changes remain previews until another export is baked
into the runtime layout.

The saved set is `woc_ignivar_placer:world_quests_shipwreck`. Reopening the exact
submitted draft reconnects its rows to all thirteen new source IDs, preventing
double rendering and duplicate imports. Later edits and nonmatching drafts are
preserved. Deleted-source IDs remain in the import ledger until the layout changes.

## Runtime contract

- `src/sim/content/farshore_shipwreck_layout.ts` is the shared transform table.
  Ship and hull coordinates are static scenery; the eleven debris rows spawn authoritative
  ground objects with stable IDs `2147100101` through `2147100111`. The retired hull
  ID `2147100100` remains a Placer source alias so existing drafts still mask it.
  Its original terrain calm pad is retained to preserve the shoreline.
- Ground-object definitions optionally carry explicit Y, facing and scale. Shared
  bootstrap preserves these in position, previous position, spawn position and
  previous facing. Existing definitions retain terrain-derived defaults.
- `src/render/world_quest_placer_assets.ts` owns the common model cache and ground
  pivot. Boot registers deferred preparation; the existing Farshore feature and
  object-pool prewarm paths compile the live models. Shared immutable geometry and
  materials survive individual view teardown.
- `src/render/farshore_salvage_assets.ts` maps each ID to its actual asset, selects
  representative IDs for the five pickup prewarm pools, and disables extra random body yaw
  on both fresh and reused pickups. The entity wrapper applies scale and facing.
- Existing progress counts and old position-credit keys survive a saved-game
  restore, including credit already earned from the hull. Completed quests stay completed.
  Online world auth advances to epoch 44 because epoch-43 clients and servers
  disagree about whether the hull is scenery or a collectible entity.

## Assets

The seven supplied GLBs live under `public/models/world_quests/shipwreck/`. They
include shipwreck, broken planks, waterlogged barrel, damaged crate, fallen anchor,
hull fragment and capsized rowboat. The optimized kit is about 2.8 MB, with meshopt
geometry and embedded KTX2 textures. Original inputs remain in the ignored
`tmp/asset_src/shipwreck_quest/` directory; no second project folder was created.

To rebuild updated input files:

```sh
node scripts/assets/build_assets.mjs scripts/assets/specs/world_quest_shipwreck.json
node scripts/assets/compress_glb_textures.mjs --dir public/models/world_quests/shipwreck
node scripts/build_media_manifest.mjs generate
```

## Verification, 21 September 2026

Verification was performed on `feature/world-quests-pr4111`, based on PR 4111 at
`6204f9b524369fee89f58bc17a0b8a5cbc9ca0b3`.

The browser was restarted after the local processes stopped. The restored local
start screen loaded successfully. A separate, temporary browser harness rendered
the real seven compressed GLBs through the production model factories and shared
ground-object spawner, using production terrain-height samples. It confirmed all
thirteen transforms, twelve textured pickup meshes and absence of the old dock and
ropes. `docs/screenshots/shipwreck-approved-layout.png` records that focused check;
it is not a full-game traversal or a GPU timing capture. The temporary tab closed.

Frontend review found no remaining task-scope issue. Cross-platform review found
and verified the epoch fence fix. Test review prompted stronger per-model identity,
edited-draft preservation, deferred boot preparation and immediate prior-epoch
admission regressions. No dependency reinstall was performed during implementation.

Validation commands and outcomes:

- `node_modules/.bin/vitest run tests/farshore_shipwreck.test.ts tests/world_quest_salvage_assets.test.ts tests/world_quest_placer.test.ts tests/world_quest_placer_adoption.test.ts tests/quest_objects.test.ts tests/delve_render.test.ts tests/entity_view_policy_core.test.ts tests/quest_object_gate_core.test.ts tests/world_quest_snapshot_wire.test.ts tests/zone_prewarm_groups.test.ts tests/ground_object_pool.test.ts --maxWorkers=2`: 103 passed.
- `node_modules/.bin/vitest run tests/bank_wire_epoch.test.ts tests/security.test.ts tests/material_inventory_wire.test.ts tests/world_auth_scripts.test.ts tests/architecture.test.ts tests/farshore.test.ts tests/nearby_interaction.test.ts tests/nearby_interaction_core.test.ts tests/world_quest_placer_sources.test.ts tests/world_quest_placer_assets.test.ts tests/dev_chat_hooks.test.ts tests/monolith_budget.test.ts --maxWorkers=2`: 340 passed; one obsolete rotating-layout assertion failed and was updated for the approved single layout.
- `node_modules/.bin/vitest run tests/nearby_interaction.test.ts tests/shipwreck_preload.test.ts --maxWorkers=2`: 67 passed, including the corrected interaction assertion and actual deferred boot preload.
- `node_modules/.bin/vitest run tests/server/ws_auth.test.ts tests/world_quest_salvage_assets.test.ts tests/world_quest_placer_adoption.test.ts --maxWorkers=2`: 88 passed after the review additions.
- `npx vitest run tests/ground_object_spawns.test.ts tests/world_quest_salvage.test.ts tests/world_quests.test.ts tests/world_quest_ambush.test.ts tests/map_doc_sanitizer.test.ts tests/dev_commands.test.ts --maxWorkers=2`: 119/124 initially passed; fixed two stale event assertions and one old variant pin. Corrected suites and timed-out cases were rerun without raising time limits. All 124 cases passed across the focused runs. The final two-case rerun used `npx vitest run tests/world_quests.test.ts --maxWorkers=1 -t 'pays the bundle on every quest|keeps completion claims across a v0.41-style rollback save'`.
- `npm run i18n:gen` and `node scripts/wiki/build_content.mjs`: passed; generated files stayed current.
- `npm run security:gate`: passed, 9,650 files scanned, zero high findings after priors.
- `GATE_SELECT_BASE=6204f9b524369fee89f58bc17a0b8a5cbc9ca0b3 npm run ci:changed`: exit 0, zero committed files selected. Explicit `node_modules/.bin/biome ci` on all 47 changed/untracked source, test and JSON files passed with warnings; subsequent test-only type annotation also passed scoped Biome.
- `node --input-type=module -e 'import { build } from "vite"; await build({build:{copyPublicDir:false,outDir:"tmp/shipwreck-runtime-build"}});'`: passed. Avoided duplicating the large public tree and removed the temporary build afterward.
- `git diff --check`: passed. Local Vite returned HTTP 200 after restart.
- `npm run gate`: blocked at the initial Turbo artifact step by `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. The local pnpm wrapper attempted to replace dependencies; no reinstall or bypass was performed. The full repository gate is not green.

Logs are under ignored `tmp/shipwreck-runtime-*.log` and `tmp/shipwreck-sim-*.log`.

Final `node_modules/.bin/tsc --noEmit`: passed after correcting a test fixture's
literal-union type annotation. All task regressions pass across the scoped runs.
Verdict: **READY WITH NOTES for local testing**. The full pre-merge gate remains
blocked by the pnpm environment error above; no full-game traversal or GPU timing
capture is claimed.

## Anchor shoreline correction (21 September 2026)

The anchor's approved pose is unchanged: `(320.6, -4.25, 130.05)`, yaw 345°,
scale 2. Comparing the original PR content tables and the baked layout found the
same center ground height, `-2.517366319896134`, which buries the 1.09-yard-tall
model. This is a local shoreline regrade, not a recovered historical heightfield.

`farshore_shipwreck_shore.ts` lowers the finished terrain to the waterline within
a 3-yard core and blends into the original beach across a 7-yard skirt. Existing
lower seabed is preserved. The shared `applyTerrainPads` seam keeps rendering,
movement and sea queries consistent. Forced-calm sizing probes skip the regrade
so the correction cannot resize surrounding terrain skirts.

Validation for this correction:

- Red regression: `node_modules/.bin/vitest run tests/farshore_shipwreck_shore.test.ts --maxWorkers=1`
  failed on the original buried footprint before the implementation.
- `node_modules/.bin/vitest run tests/farshore_shipwreck_shore.test.ts tests/world_quest_salvage.test.ts tests/monolith_budget.test.ts tests/terrain_region_index.test.ts --maxWorkers=2`:
  38 tests passed at the initial fix.
- `node_modules/.bin/vitest run tests/farshore_shipwreck_shore.test.ts tests/terrain_chunk_geometry.test.ts tests/terrain_vertex_pipeline.test.ts tests/water_terrain_awareness.test.ts --maxWorkers=2`:
  16 tests passed, including actual mesh raycasts at 1.2- and 3-yard detail.
- Final `node_modules/.bin/vitest run tests/farshore_shipwreck_shore.test.ts --maxWorkers=1`:
  all 6 tests passed after adding the calm-probe guard and exterior regression pins.
- A 7,171-point shoreline comparison found 56 changed samples, all within 10 yards
  of the anchor. The independent slope scan measured a maximum 1.295 (walk limit 1.5).
- The browser preview, corrected to use `WORLD_SEED`, visibly shows the anchor
  above the terrain with the approved transforms.
- Simulation architecture and server hot-path reviews: PASS, no outstanding findings.
- `GATE_SELECT_BASE=HEAD npm run ci:changed`: passed, but selected zero files because
  work is uncommitted; explicit Biome check covers the three correction files.
- `npm run gate`: blocked at `i18n + wiki + sfx artifacts` by the existing fallback
  pnpm dependency reinstall failure (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`).
  No dependency reinstall was forced.
- `node_modules/.bin/tsc --noEmit`: PASS.
- `node_modules/.bin/biome check src/sim/farshore_shipwreck_shore.ts src/sim/world.ts tests/farshore_shipwreck_shore.test.ts`:
  PASS with one pre-existing unused `reachDeckSurface` import warning in `world.ts`.
- `git diff --check`: PASS. Local Vite endpoint returns HTTP 200.
- `node --input-type=module -e 'import { build } from "vite"; await build({build:{copyPublicDir:false,outDir:"tmp/shipwreck-shore-build"}});'`:
  PASS (13.82 seconds). Temporary output removed afterward to save disk space.

Verdict for the anchor correction: **READY WITH NOTES** for local use; the full
repository QA gate remains blocked by the dependency setup issue above. The local
game tab was reloaded after verification. No asset transforms or quest progress
were changed by this correction.


## Decorative hull follow-up, 21 September 2026

Against `3977aa1fe2f4b9e0d790369226c662f466121ba8`, the hull is permanent scenery
alongside the main wreck. It has no pickup entity or salvage marker. The eleven
smaller pieces remain collectible and marked; eight recoveries still complete
the quest. The hull's historical Placer source alias and earned save credit survive.

A scoped browser scene ran the actual `Renderer.buildView` for every spawned
salvage entity, using the shared GLBs and production terrain. It confirmed eleven
pickup sprites, zero sprites on the two scenery models, and all approved transforms.
`docs/screenshots/shipwreck-decorative-hull.png` captures that scene. Its host skips
the full-game scheduler and animation loop; it is not a complete gameplay traversal.
The full-game verification session reached the quest but stalled behind its loading
screen. The local client was then reloaded and the temporary verification tab closed.

Validation:

- `npx vitest run tests/farshore_shipwreck.test.ts tests/world_quest_salvage.test.ts tests/world_quest_salvage_assets.test.ts tests/world_quest_placer_sources.test.ts tests/world_quest_placer_adoption.test.ts tests/world_quest_placer.test.ts tests/farshore_shipwreck_shore.test.ts tests/shipwreck_preload.test.ts tests/nearby_interaction.test.ts tests/quest_object_gate_core.test.ts --maxWorkers=2`: 119/120 passed; the first real-Sim case timed out during cold terrain setup under local load. Stale fixtures found in the earlier iteration were corrected. No timeout was raised.
- `node_modules/.bin/vitest run tests/world_quest_salvage.test.ts --maxWorkers=1 -t 'keeps the hull decorative'`: passed after typechecking finished, with the test taking 3.25 seconds. An earlier isolated retry while the machine was busy also timed out. Together the final focused checks cover all 120 cases.
- `node_modules/.bin/vitest run tests/farshore_shipwreck_readiness.test.ts tests/bank_wire_epoch.test.ts tests/material_inventory_wire.test.ts tests/world_auth_scripts.test.ts tests/security.test.ts tests/server/ws_auth.test.ts tests/architecture.test.ts tests/monolith_budget.test.ts --maxWorkers=1`: 327 passed.
- `npx tsx tmp/shipwreck-terrain-probe.ts`: all 7,171 production terrain samples matched the committed shoreline baseline exactly. The single retained hull pad and its order also have a committed regression test.
- `npx tsc --noEmit`, then `node_modules/.bin/tsc --noEmit` after the readiness tests were added: passed.
- `GATE_SELECT_BASE=3977aa1fe2f4b9e0d790369226c662f466121ba8 npm run ci:changed`: passed but selected zero committed files; explicit `node_modules/.bin/biome ci` on all 27 changed/new source and test files passed with warnings only.
- `node --input-type=module -e 'import { build } from "vite"; await build({build:{copyPublicDir:false,outDir:"tmp/shipwreck-hull-build"}});'`: production bundle passed in 12.11 seconds. The temporary build directory was removed to save disk space.
- `npm run i18n:gen`: passed with generated source artifacts unchanged.
- `npm run security:gate`: passed; 9,654 files scanned, zero high findings after priors.
- `npm run gate`: remains blocked at the artifact step by `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No dependency reinstall or gate bypass was used.

Cross-platform, render and test-coverage reviewers found no remaining blocking
issue after the terrain-pad guard was restricted to the reserved World Quest row.
Verdict: READY WITH NOTES for the local gate environment and scoped visual evidence.
