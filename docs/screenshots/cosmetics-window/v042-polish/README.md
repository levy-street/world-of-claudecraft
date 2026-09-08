# v0.42.0 mount rarity and sidebar corrections

The shared mount-skin catalogue now marks all five paid skins epic. The shop
therefore presents one epic Machine Stable section, and Cosmetics uses the same
rarity. Prices remain 2000 Claudium in the companion service.

New release launchers had lengthened the left sidebar column. Cosmetics now sits
below the shop chest in the right column in both entry templates, reducing the
measured column-height difference from 72px to 4px on the normal Discord-enabled
desktop layout. Existing handlers, keybindings and mobile launchers are preserved.

## Evidence

Before images are the user-provided dev screenshots. After images are isolated
browser fixtures using the actual entry templates, icon hydration, catalogue
projection and shipped CSS, with service rows at 2000 Claudium. They do not claim
a live-account purchase or in-world acceptance.

- [Before: store](before-store.png), [before: sidebar](before-sidebar.png)
- [After: index desktop](index.html-desktop.png)
- [After: play desktop](play.html-desktop.png)
- [After: index mobile pad](index.html-mobile-pad.png)
- [After: play mobile pad](play.html-mobile-pad.png)

## Regression checks

- `pnpm exec vitest run tests/mount_skins.test.ts tests/cosmetics_view.test.ts tests/store_mount_card_view.test.ts tests/crafting_launcher.test.ts tests/architecture.test.ts`: 158 tests passed.
- `pnpm exec vitest run tests/daily_rewards_store_behavior.test.ts`: 93 tests passed.
- `pnpm exec vitest run --config vitest.browser.config.ts tests/browser/mount_release_polish.browser.test.ts`: four tests passed across both entries, covering desktop column balance, one epic shop section, compact/horizontal/mobile-pad bounds and touch-only rail hiding.
- Rarity regressions failed before the content change; the rendered desktop regression failed with a 72px column gap before moving the launcher.

The release-to-main conflicts and broader release CI blockers documented in PR3944
are separate from these corrections. These checks do not claim release merge readiness.
