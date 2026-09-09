# Harvest button background refresh

The online corpse popup polls harvest status every 500 ms. Its background
request temporarily marks the existing button aria-disabled. The old CSS applied
grayscale and reduced brightness on every poll, causing repeated flashing.
The fix preserves the last admitted appearance during these background reads.
Actual denials and pending harvest commands still use native disabled styling.
Existing controller and button activation guards remain in place.

## Browser evidence

These are Chromium component captures using the real LootWindowController,
FocusManager and game styles, with fixture world replies. They show a pending
background query with keyboard focus and pointer hover. They are not screenshots
of the live dev realm. The scene behind the popup is intentionally absent.

| Layout | Before | After |
| --- | --- | --- |
| Desktop | [Before](before-desktop.png) | [After](refresh-desktop.png) |
| Mobile portrait | [Before](before-portrait.png) | [After](refresh-portrait.png) |
| Mobile landscape | [Before](before-landscape.png) | [After](refresh-landscape.png) |

## Validation

- Red: the three new real-browser cases failed on changed filter/cursor while
  the original CSS was present.
- `pnpm exec vitest run --config vitest.browser.config.ts tests/browser/harvest_preference.browser.test.ts`: 20 passed.
- `pnpm exec vitest run tests/loot_window_controller.test.ts tests/corpse_harvest_window.test.ts tests/corpse_harvest_popup_boundaries.test.ts tests/css_corpus.test.ts tests/css_value_validity.test.ts --maxWorkers=2`: 117 passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec biome check tests/browser/harvest_preference.browser.test.ts`: passed
  after formatting, with four existing informational suggestions.
- `npm run ci:changed`: exited 0 but selected zero files because these changes
  are uncommitted; the explicit file check above supplies lint evidence.
- `git diff --check`: passed.
- Independent frontend/test review: no actionable findings.

Full Gate/build validation is deferred under the scoped delivery preference;
local disk headroom was approximately 4.8 GB. No live-server or physical-device
playtest is claimed. Clicks while the status request is pending remain blocked
by the existing guards. No deployment or live-realm verification is claimed.

Publication check: `npm audit --json` cannot run without an npm lockfile in
this pnpm repository. `pnpm audit --json` reports existing advisories in Vitest
and @vitest/mocker (GHSA-82fw-gwwq-j7x9), sharp (GHSA-rgj7-g3m4-5g8c), and
js-yaml (GHSA-2883-xcg3-v3hh). This patch does not change dependencies or the
lockfile; broader dependency remediation remains release work.
