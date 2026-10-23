# Mobile combat meter verification

Branch: `fix/mobile-meter-compact`.
Base: `origin/ossbrain-release/v0.45.0`, commit `069ae3efaee5bb509663ecd263d811b776d25227`.

The mobile meter uses a stable footprint independent of desktop meter zoom and HUD scale. Its height follows content, its player list scrolls, and the header keeps 40px touch controls. Secondary actions use the existing shared context menu. Desktop settings and appearance are preserved.

## Visual evidence

- [Before, landscape fixture](before-landscape.png) and [after](after-landscape.png).
- [Before, portrait fixture](before-portrait.png) and [after](after-portrait.png).
- [Before, left-handed fixture](before-left-handed.png) and [after](after-left-handed.png).
- [Full game](after-game-landscape.png), [left-handed](after-game-left-handed.png), and [shared menu](after-game-menu.png).
- Desktop before/after captures have identical SHA256: `827e9776d1c3436f912c449ede32c9131b48c37a1afc852a08614093e6344fef`.

The fixture captures use the real shipped HTML, panel, event data, and style barrel. The full-game captures use the real offline client at `http://127.0.0.1:5181` with test damage submitted to its meter. No production account or stored player data was modified.

## Completed checks

- `pnpm install --frozen-lockfile`: passed.
- `pnpm exec vitest run --config vitest.browser.config.ts tests/browser/meters_mobile_layout.browser.test.ts`: 9 passed. Six viewport/scale/handedness profiles, group scrolling, drilldown/back/close, and desktop settings. The pre-change run failed all six mobile geometry cases.
- `pnpm exec vitest run --maxWorkers=1 tests/meters_mobile_tools.test.ts tests/meters_panel.test.ts tests/meters_settings.test.ts tests/simple_context_menu.test.ts tests/architecture.test.ts tests/professions_farming.test.ts`: 314 passed in 5 matching files. `tests/meters_settings.test.ts` does not exist on this base; customization coverage is included separately in the scoped run below.
- Final scoped regression: 22 files, 326 tests passed with `pnpm exec vitest run --maxWorkers=1` over the non-browser `*meters*test.ts`, `css*test.ts`, `mobile_window*test.ts`, and `ctx_menu_mobile_stacking.test.ts` files.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec turbo run check:types build:bundle build:env build:server build:bot --ui=stream`: all 7 tasks passed, including production client, server, environment, bot, and app/admin/bot type checks.
- `pnpm run ci:changed`: passed, but this command reports 0 files for this uncommitted branch. Explicit `pnpm exec biome ci src/ui/meters.ts src/ui/meters_mobile_tools.ts tests/meters_mobile_tools.test.ts tests/browser/meters_mobile_layout.browser.test.ts` passed with non-null-assertion warnings in test fixtures.
- Real offline game interaction smoke: More, metric submenu, fight submenu, Settings, and Escape work. No page errors. The shared menu uses the existing mobile popup placement and keyboard handling.
- Frontend and test-coverage specialist reviews: no confirmed findings.

## Broader QA

`GATE_MAX_WORKERS=3 pnpm run gate` passed artifact generation and malware scanning, then encountered timeouts in `professions_farming.test.ts` and two architecture cases. The full test process was stopped after those failures. Both suites pass in the isolated 314-test run above; the full gate is not green.

`GATE_SELECT_BASE=origin/ossbrain-release/v0.45.0 GATE_MAX_WORKERS=1 node scripts/gate_select.mjs` passed artifacts and malware scanning. Its test floor was interrupted after independently reproducing the existing browser blocker below; the selective gate is not green.

`pnpm exec vitest run --config vitest.browser.config.ts tests/browser/weekly_vault_scale_layout.browser.test.ts tests/browser/mobile_menu_control.browser.test.ts`: 42 passed, 1 failed. The failure is the previously observed Weekly Vault desktop layout check at 1366x768, UI scale 1.5: button bottom 293.046875 versus allowed 292.546875. This change touches no Weekly Vault styles or code. The mobile menu regression suite passes.

The final scoped meter/CSS regression passed (326 tests). Dedicated WebKit and forced-colors runs were not performed. The implementation has passed its scoped verification; broader QA does not pass and the branch is not merge-ready. Publication was requested after these checks. Retain draft PR status until the complete merge gate is green.
