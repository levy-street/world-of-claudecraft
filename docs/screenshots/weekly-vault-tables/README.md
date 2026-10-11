# Weekly Vault table selection

Before/after captures use the same local completed-week preview fixture. Before
captures load the vault presentation modules and component styles from integration
base `6204f9b5` with `git show`; after captures use this branch. Shared content and
the fixture are current in both, so this compares presentation, not saved data or
live server behavior. No worktree changes were stashed or discarded.

| Viewport | Before | After |
| --- | --- | --- |
| Desktop, 1280 x 720 | [Before](before-desktop.png) | [After](after-desktop.png) |
| Phone portrait, 390 x 844 | [Before](before-mobile-portrait.png) | [After](after-mobile-portrait.png) |
| Phone landscape, 844 x 390 | [Before](before-mobile-landscape.png) | [After](after-mobile-landscape.png) |

[Desktop selector open](after-selector-desktop.png) shows one selected table and
the remaining choices. Phone captures scroll to the table controls. The checkbox
menu opens upward when needed and scrolls within the available height. The fixture
is a DOM-only UI preview, with no game renderer or graphics preset.
