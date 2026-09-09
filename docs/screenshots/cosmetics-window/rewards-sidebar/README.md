# Rewards sidebar placement

The WOC Store / daily rewards chest now uses a standard sidebar button slot.
The oversized floating art and extra spacing are removed; the localized label
flyout, focus outline, and gold reward-ready indication remain.

These Chromium captures mount the actual sidebar from each game entry and load
the shipping CSS and icon hydration. The black background is the isolated UI
fixture, not a rendered game scene. Before is release commit 7951dfdd1b.

| Layout | Before | After |
| --- | --- | --- |
| Desktop | [Before](before-index-desktop.png) | [After](after-index-desktop.png) |
| Compact | [Before](before-index-compact.png) | [After](after-index-compact.png) |
| Horizontal | [Before](before-index-horizontal.png) | [After](after-index-horizontal.png) |
| Compact horizontal | [Before](before-index-horizontal-compact.png) | [After](after-index-horizontal-compact.png) |

Matching play-entry captures use the same names with `play` instead of `index`.
The existing mobile pad layout is unchanged; its browser test still checks the
visible controls and mobile hiding of the desktop chest.

Reproduce screenshots with:

```sh
VITE_REWARDS_CAPTURE=after pnpm run test:browser tests/browser/rewards_sidebar.browser.test.ts
```

The browser assertions remain active during capture. Running with `before` on
the release CSS reproduced all eight geometry failures (50px versus 34px).
