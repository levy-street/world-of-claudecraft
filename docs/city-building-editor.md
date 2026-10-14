# Building a castle in the local editor

Open **Assets > Build mode**. The asset browser stays open while you build and
while you select, rotate, or resize an existing piece.

1. Choose **Rooms** and **Bare wall**, then drag a rectangle on the grid. This
   creates walls and a walkable floor together. Adjacent bare rooms with matching
   grid segments share their common wall.
2. Choose **Walls** to drag a wall run. Enable **Diagonal walls** below the mode
   buttons to drag between any two grid points, including diagonals. Turn it off
   to constrain walls to horizontal or vertical grid lines. Choose **Chosen asset** and pick
   a Tidehold wall to repeat that piece along the line. Set the floor height in
   **Grid and foundation** before starting a building.
3. Click **Add floor**, then **Floor 1**, **Floor 2**, and so on. Draw rooms or
   floor rectangles on that level. **Hide higher floors** lets you see inside.
   These buttons control buildings created with this tool; they do not split
   an existing single-piece castle model into separate floors.
4. Choose **Objects** to place doors, stairs, towers, furniture, or other assets
   on the selected floor. **Rotate left/right** turns a piece in 45 degree steps;
   enable **Fine rotation** for 15 degrees. **Smaller/Larger** changes its size
   by ten percent. The keyboard shortcuts are comma/period and left/right bracket.
   **Select an existing piece** uses the same controls on placed objects.
5. Choose **Wall finishes**, choose a texture and paint side, then click a wall.
   **Apply to connected walls** paints the wall or room run created by one drag.
   **Import texture** accepts your own PNG, JPEG, or WebP image. You can create
   textures in your preferred drawing or image editor and import them here.
   Seamless images work best when repeated. The editor does not contain an image
   painting application.
6. **Undo** removes one complete room, wall run, or painting action. **Redo**
   restores it. **Save** stores the map in this browser; **More > Export** makes
   a portable map bundle that includes imported textures.

Use Alt/Option-drag or middle-drag to move the camera without editing the map.
Escape cancels an unfinished wall or room drag. Foundation settings become fixed
after a building starts; create a new building for a different foundation height.
Automatic foundations sit slightly above the sampled terrain. Uneven ground and
grass may still need the existing terrain and Remove Grass tools.

Large castles can be built in multiple gestures. A gesture is limited to 256
pieces, a building to 16 levels, and the map to its existing 16,000 placements.
Door openings, stairs, roofs, and irregular room outlines still use individual
assets or additional wall/floor edits. Only matching bare-wall segments are
merged automatically; overlapping kit pieces retain their individual geometry.

## Validation recorded on 22 September 2026

Base: the requested `feature/deepglass-studio-2026-09-22` city branch at
`797cb898ca800461ca5614ba383336f9228107e4`. The update was installed in the normal
local city project on 23 September 2026, after approval to reload the active page.
Changes remain uncommitted on the city branch. A compressed backup of the update
is saved beside the project as `city-building-editor-update-2026-09-23.tar.gz`.

- Feature regression run: `node_modules/.bin/vitest run` over the 14 building,
  transform, texture, batch, streaming, and clipboard suites, with
  `--maxWorkers=1`: 201 tests passed.
- Follow-up regression run over `building`, `editor_building_workspace`, both
  `editor_building_viewport` suites, `editor_wall_texture_import`, and
  `render_wall_finishes`: 100 tests passed. Final hide/show selection cases in
  `editor_building_workspace.test.ts`: 29 tests passed.
- `node_modules/.bin/vite build --outDir /tmp/city-building-dist`: passed.
  A final build through Vite's `build()` API with `copyPublicDir: false` also
  passed after the last fixes.
  The temporary build output was removed afterward to recover disk space.
- `npm run security:gate`: passed (9,427 files, zero high findings after priors).
- Explicit changed-source/test/style `biome check`: passed with existing warnings.
  `npm run ci:changed` could not resolve this partial clone's default base;
  `GATE_SELECT_BASE=HEAD npm run ci:changed` reported zero files, so it is not
  counted as lint evidence. The explicit file-list check covers the actual diff.
- `GOMEMLIMIT=2GiB GOGC=50 npm run check:ts`: 134 diagnostics. An independent
  check of the untouched original checkout produced the identical 134 diagnostics;
  there were no new diagnostic messages in the edited checkout.
  The final check, including the new viewport integration tests, matched too.
- `npm run gate`, using the installed pnpm 10.34.5 on PATH, passed artifact
  generation and stopped at its i18n freshness check because generated files
  are uncommitted. No files were staged to bypass that requirement.
- Architecture, localization, export, and persistence guard run: 175 passed,
  3 skipped, 4 failed. Three architecture failures concern unchanged branch
  files/registries. The fourth is the existing built-in-prop assertion at
  `tests/editor_persist.test.ts:75`, reproduced in the untouched original checkout.
- Manual browser checks in a separate localhost preview: room creation and
  single-action undo/redo, adding/switching floors, hiding upper floors, built-in
  brick and imported JPEG rendering, save/reload with both levels and the custom
  texture, rotation/scale before and after placement with the asset browser open,
  and keyboard focus plus authoritative selection clearing on a floor switch.
  No wall shader errors appeared. Full graphics-tier/mobile matrix testing was
  not performed.

Database/storage and security reviews found no remaining scoped issues.
Frontend and coverage findings were addressed with implementation changes and
regression tests. The local features are verified; a clean repository-wide merge
gate is still blocked by the conditions above.

## Local installation verified on 23 September 2026

All 63 implementation files were backed up and byte-checked during installation.
The temporary development worktree was removed after checking the installed code
against it. The city editor now runs from the normal project on port 5173.

- `node_modules/.bin/vitest run tests/editor_building_workspace.test.ts tests/editor_building_persistence.test.ts tests/editor_build_transform_controls.test.ts --maxWorkers=1`:
  all 3 suites and 41 tests passed in the normal project.
- `git diff --check`: passed.
- The existing local editor page was reloaded and visually checked with the city
  loaded, Build mode open, and wall/room/floor/finish and transform controls visible.

## Diagonal walls update, 23 September 2026

The **Diagonal walls** checkbox in Walls mode enables drawing between any two grid
points. It works with bare walls and chosen kit pieces. The existing geometry planner
supplies both the preview and committed pieces; changing the checkbox cancels an
unfinished drag. Rooms remain rectangular. One complete wall run is one Undo action.

- `node_modules/.bin/vitest run tests/editor_building_core.test.ts tests/editor_building_workspace.test.ts tests/editor_building_panel.test.ts tests/editor_building_viewport.test.ts tests/editor_building_persistence.test.ts --maxWorkers=1`:
  all 5 suites and 119 tests passed, including diagonal compact-save round trips.
- The combined feature/localization run passed 168 tests, skipped 3, and timed out
  in one unrelated trade-race localization test. Running
  `node_modules/.bin/vitest run tests/localization_fixes.test.ts -t 'the real trade-accept-race deny text' --maxWorkers=1`
  in isolation passed that test without changing its timeout.
- `node --input-type=module -e "import { build } from 'vite'; await build({build:{outDir:'/tmp/city-diagonal-dist',copyPublicDir:false}});"`:
  passed. The temporary output was removed afterward.
- `npm run i18n:gen`: passed. The two new strings include the five non-Latin
  translations required by the M16 exception.
- `npm run security:gate`: passed (9,431 files, zero high findings after priors).
- `npm run check:ts`: incomplete for this update. The native compiler emitted no
  diagnostics before being stopped after a roughly 12-minute attempt with
  `GOMEMLIMIT=2GiB GOGC=50` and a roughly 5-minute retry with
  `GOMEMLIMIT=4GiB GOGC=100`. The laptop was using about 9.9 GB of swap at the end.
  The 134 baseline diagnostics documented above are from the previous completed
  check; this update has not been compared against that baseline by a completed
  full-project type check. No compiler process was left running.
- Scoped `biome check --files-max-size=4000000` across the 12 changed TypeScript
  source, locale and test files: passed. `git diff --check`: passed.
  `npm run ci:changed` still cannot resolve a default base in this partial clone.
- `npm run gate`: artifact generation passed; the same uncommitted-generated-file
  freshness condition documented above stops the full gate.
- Browser checks: a diagonal bare wall added 11 pieces in one action; Undo removed
  all 11 and Redo restored them. A CastleWall 01 diagonal run added 5 kit pieces
  in one action and Undo removed all 5. Both rendered correctly. Space toggled the
  checkbox and retained its focus after repaint. No browser errors were logged.
  The normal port-5173 city page was checked with the option visible and enabled.

Focused frontend and test-coverage review findings were addressed. No persistence
schema, dependencies, camera controls, or rendering code changed in this update.
