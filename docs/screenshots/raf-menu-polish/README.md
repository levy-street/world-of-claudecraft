# Recruit a Friend menu polish

The referral cards now use the existing leaderboard violet palette, gold trim,
illustrated milestone tiles, inset bevels, and distinct pending, ready and redeemed
states. Layout responds to available window width and UI scale. Touch targets,
keyboard focus, reward tooltips and reduced motion remain supported.

This is presentation only: snapshot ownership, eligibility, consent, transfers,
summon cooldowns, explicit redemption, pagination, and celebrations are unchanged.
No player-visible strings were added. Visual reference: Groups UI PR #4486.

## Base and scope

Branch: `feature/raf-menu-polish`, based on `91e9c7753f` from
`origin/feature/v045-integration`. That branch includes the active release and the
existing RAF implementation; the release branch alone does not contain RAF yet.
The PR targets this integration branch to keep its diff limited to the UI change.

## Screenshots

| View | Before | After |
| --- | --- | --- |
| Desktop | [Before](before/desktop.png) | [After](finished/desktop.png) |
| Portrait | [Before](before/mobile-portrait.png) | [After](finished/mobile-portrait.png) |
| Landscape | [Before](before/mobile-landscape.png) | [After](finished/mobile-landscape.png) |

[Desktop at 125%](finished/desktop-scaled.png) and
[landscape safe areas at 125%](finished/mobile-safe-area-scaled.png).
These captures use the real HUD controller with test snapshots. They do not
prove a live-account invitation or delivery transaction. An optional final
in-game capture attempt failed to boot the local offline game; final visual
evidence comes from the controller fixture and browser component suites.

## Validation

- `pnpm exec vitest run tests/referral_cards_controller.test.ts tests/referral_cards_view.test.ts tests/referral_reward_core.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts tests/css_raw_color_ratchet.test.ts tests/css_token_resolution.test.ts tests/leaderboard_ranking_tokens.test.ts tests/ui_library.test.ts tests/focus_visible_guard.test.ts --maxWorkers=2`: 137 tests passed in 10 files.
- `pnpm exec vitest run --config vitest.browser.config.ts tests/browser/friendship_referral_screen.browser.test.ts tests/browser/referral_armour.browser.test.ts`: 6 tests passed in 2 files.
- `pnpm run test:browser`: 608 tests passed in 77 suites; one suite failed to import during a cold Vite dependency-optimization reload. `pnpm exec vitest run --config vitest.browser.config.ts tests/browser/tap_menu_mode.browser.test.ts` then passed its 15 tests. Combined coverage: 623 passing tests across all 78 suites, before the final card-only polish.
- `$env:GAME_URL='http://127.0.0.1:5210'; node scripts/referral_cards_screenshots.mjs --output=docs/screenshots/raf-menu-polish/finished`: passed viewport, scale, safe-area, tooltip, touch-target, explicit redemption, confirmed celebration, reduced-motion, Escape/replay and focus-return checks. Hover is first proved active, then proved stationary under reduced motion. No browser errors.
- `pnpm run check:ts`: passed.
- `pnpm exec turbo run check:types build:env build:server build:bot build:bundle`: 7 tasks successful on the initial implementation.
- `pnpm run build:bundle`: passed again after the final polish, including backdrop survival and hashed media generation.
- Changed-file Biome and `git diff --check`: passed, with existing non-null assertion warnings.
- Read-only frontend and test-coverage reviews found no remaining scoped defects. The reduced-motion hover specificity finding was corrected and verified by the browser fixture.

## Global gate limitation

The full repository gate is NOT approved. `npm run gate` passed generation,
artifact freshness, malware scanning and changed-file Biome. Its unsharded test
run recorded failures in 39 suites outside this UI diff, including simulation
timeouts, shell tooling, asset audits and deployment tooling. It was stopped
after more than one hour. Those failures were neither repaired nor waived here.
The PR remains draft pending repository-wide QA and CI.

Local logs are retained in Windows TEMP as `woc-raf-gate.log`,
`woc-raf-finish-tests.log`, `woc-raf-finish-ui-browser.log`,
`woc-raf-finish-browser.log`, `woc-raf-finish-types.log`,
`woc-raf-finish-build.log`, and `woc-raf-pr-select.log`.