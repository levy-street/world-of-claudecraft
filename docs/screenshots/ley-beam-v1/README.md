# Ley Beam Alignment design preview

Generated celestial frame and crystal heart art, a navy instrument tray, immediate readable beam connectors, decorative crystal rotations and finite pulse/spark effects. Victory retains the observed final circuit after authoritative completion strips its live rotations. The longer blue/gold victory lasts 5.25 seconds; the restrained loss treatment lasts 1.6 seconds.

The existing unlimited-rotation game has no loss rule. `QuestEventPresentation.failWorldQuestPuzzle` is a presentation-only hook for future team integration. Only the development preview invokes it today. Simulation, economy, wire protocol and dependencies are unchanged.

Playable local preview: `http://127.0.0.1:5186/tmp/puzzle-preview/index.html?board=ley`.

## Verification

- `npm run i18n:gen`: passed. English plus required non-Latin fills generated.
- `node_modules/.bin/tsc --noEmit`: passed.
- `node_modules/.bin/vitest run tests/world_quest_ley_view.test.ts tests/world_quest_ley_window.test.ts tests/world_quest_ley_fx_controller.test.ts tests/quest_event_view.test.ts tests/world_quest_puzzle_window.test.ts tests/world_quest_puzzle_view.test.ts tests/world_quest_confection_window.test.ts tests/world_quest_confection_fx_controller.test.ts tests/architecture.test.ts tests/hud_perf_budget.test.ts tests/css_layer_containment.test.ts tests/css_value_validity.test.ts tests/css_token_resolution.test.ts tests/localization_fixes.test.ts`: 14 files passed, 411 tests passed and 7 skipped.
- After the final positioning refinement: Ley FX controller and three CSS guard suites passed, 30 tests.
- Explicit-file Biome check: formatter correction applied to the final FX keyframes. Existing non-null assertion warnings remain.
- `npm run security:gate`: passed, no high findings after repository priors.
- `node tmp/puzzle-preview/build-ley.mjs`: production Vite compilation passed; copied and served bytes for the two Ley assets and two Confection v7 hardware assets matched. Bulk public-directory copy was omitted.
- `PATH="$PWD/tmp/puzzle-preview/bin:$PATH" npm run gate`: generation and SFX checks passed; stopped at i18n Git freshness, exit 128. The parent repository metadata was moved to Trash externally. No attempt was made to bypass filesystem protections or repair Git.
- Browser captures: desktop, phone, enlarged phone UI, victory, defeat and completion without a cached board passed; no horizontal overflow, clipped titles or browser errors. See `browser-checks.json`.
- Final mobile width refinement: two CSS suites passed, 17 tests; TypeScript passed again.
- Fresh read-only `woc_frontend` review: corrected tile-label re-localization, decorative-only rotation, centered keyframes, explicit result-frame width, mobile title wrapping and safe-area handling.

The local preview is ready for design iteration. The full merge gate is not verified while Git metadata is unavailable. Nothing was staged, committed or pushed.

## Team videos

Two silent H.264 MP4 clips at 1280x960 and 30 fps are in `../world-quest-team-videos` beside this worktree. Confection demonstrates 3/5/cascade effect samples, defeat and victory. Ley demonstrates its labelled defeat design, actual tile rotations and a completed circuit. Both are below 8 MB and were fully decoded to validate the exports. Exact sizes and durations are in that folder's `video-manifest.json`.

## Artwork

See [art-provenance.md](art-provenance.md) and [asset-manifest.json](asset-manifest.json). Before and after desktop/phone screenshots live alongside this document.
