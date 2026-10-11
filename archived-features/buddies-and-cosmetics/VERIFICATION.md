# Verification: buddy cosmetics and retired-content archive

Scope: `codex/buddies-four-roster` in the existing v0.44 task worktree, based on
`f181fb79f78d07b3c0fa3057a0d77cb33c60a9a1`. Earlier roster pruning remains in the
uncommitted diff. This request removes Sapling and buddy alternate looks, leaving
Horse, Crystal Lich and Forgemaw. No commit, staging or remote mutation was done.

Local preview verified. Full merge-gate verdict: NOT READY, due to the blockers
below. They do not prevent testing the completed removal on localhost.

## Passed

- `npx vitest run tests/buddies.test.ts tests/buddy_retirement.test.ts tests/buddy_sources_content.test.ts tests/buddy_deed_rewards.test.ts tests/buddy_drops.test.ts tests/buddy_event_lines.test.ts tests/buddy_render_catalog.test.ts tests/collections_view.test.ts tests/collections_sources.test.ts tests/collections_window.test.ts tests/collections_window_scroll.test.ts tests/deeds_buddy_picker.test.ts tests/deeds_view.test.ts tests/deeds_window.test.ts tests/deeds_window_jump.test.ts tests/deeds_window_focus.test.ts tests/deeds_border_picker.test.ts tests/dev_commands.test.ts --maxWorkers=1`: 18 suites, 330 tests passed.
- `npx vitest run tests/buddy_wire.test.ts tests/command_schema.test.ts tests/command_facets.test.ts tests/world_api_parity.test.ts --maxWorkers=1`: initial run 458 passed, one facet metadata pin failed. Corrected by removing the retired command from active facet metadata while keeping its append-only protocol token and inert dispatch.
- `npx vitest run tests/command_facets.test.ts tests/command_schema.test.ts --maxWorkers=1`: 48 passed after that correction.
- `npx vitest run tests/command_facets.test.ts tests/snapshots.test.ts --maxWorkers=1 -t 'command facet tags|delta-key contract pins'`: 45 passed, 257 intentionally skipped. Snapshot keys reduced consistently.
- `npx vitest run tests/professions_blob_growth.test.ts -t 'settles to a fixed point with every container at its legal ceiling' --maxWorkers=1`: 1 passed, 10 skipped. Buddy field measured at 78 bytes; maximal fixture 212166 bytes, original band width preserved.
- `npx vitest run tests/authored_surfaces.test.ts tests/corpse_harvest_sim.test.ts tests/gathering.test.ts --maxWorkers=1 -t 'authored surfaces|covers every template that mixes|answers for every shipped'`: 7 passed, 142 skipped. The authored-surface pins were corrected for Sapling retirement and the retained rigs' existing material policy.
- `.\node_modules\.bin\tsc.cmd --noEmit --pretty false`: passed after correcting retired facet metadata.
- `npm run i18n:gen`, `npm run wiki:content`, `node scripts/build_media_manifest.mjs generate`: passed. Maintained locale overlays were not edited.
- `npm run build:bundle`: passed, client/admin entries built and 1756 media assets emitted. No archived-features directory in dist.
- `npm run build:server` and `npm run build:env`: passed.
- `npm run security:gate`: passed, 9262 files, zero high findings after priors.
- Scoped Biome over this request's 57 existing code/style files: passed. Follow-up `biome check --diagnostic-level=error tests/authored_surfaces.test.ts src/render/characters/manifest.ts src/render/characters/assets.ts src/sim/items.ts`: passed.
- `git diff --check`: passed.
- `git apply --check archived-features/buddies-and-cosmetics/restore-before-this-removal.patch`: passed. This was validation only; the restoration patch was not applied.
- Every archived asset and source snapshot matched its recorded SHA-256. The archive contains 62 assets/copies, including 23 moved dedicated models; 31 retired buddy IDs; 140 source snapshots. Moved assets no longer exist under public.

## Broader guards and blockers

`npx vitest run tests/architecture.test.ts tests/localization_fixes.test.ts tests/collections_exchange_price.test.ts tests/styles_extraction.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/focus_visible_guard.test.ts tests/character_visual_fail_soft.test.ts tests/character_material_cache.test.ts tests/render_asset_preload.test.ts tests/authored_surfaces.test.ts tests/monolith_budget.test.ts --maxWorkers=1`

Result: 278 passed, 3 skipped, 3 failures in 13 discovered suites. Two authored
surface failures were corrected and the entire authored-surfaces suite passed
in the follow-up above. The optional character_material_cache filename did not
match a suite. The remaining failure is the existing components.css raw-color
ratchet: 486 against ceiling 471. Running the same counting function on the
archived pre-change stylesheet measured 488; this removal reduced it by two.
No ceiling was raised and unrelated styles were not changed.

`npm run ci:changed`: blocked by formatting in four inherited locale overlays
(ja_JP, ko_KR, zh_CN, zh_TW), across the branch's 184 changed files against
origin/release/v0.44.0. The task-specific lint check passed. These maintained
locale files were left unchanged.

`npm run gate`: stopped at manifest freshness because regenerated guide/media
manifests differ from unstaged/committed copies. Nothing was staged merely to
satisfy this gate. Later full-suite/browser steps were not reached. No complete
browser regression suite was rerun for this request.

## Live preview and review

Restarted the task's localhost:5173 preview. In an offline test character, Hunting
showed Crystal Lich, Forgemaw and Horse with no Looks controls. `/dev buddies`
reported three collected buddies, and all three appeared collected. Crystal Lich's
model preview rendered correctly. Screenshot evidence is in the task's temporary
verification folder as archive-hunting.png. Horse's missing inventory icon is
pre-existing art debt and was not changed.

Read-only frontend, simulation architecture, server hot-path and persistence
reviewers found no remaining implementation blockers. Persistence review confirmed
the documented forward-only data transition: old retired unlocks and queued grants
are not backed up by this source/assets archive. See README.md before restoration.
