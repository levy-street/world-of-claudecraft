# Material source UI evidence

Captured from the local, uncommitted PR2 worktree on 2026-09-06. These are
implementation captures, including a comparison with the current PR1 predecessor.

## Same legacy stock, before and after

Both versions received the same inventory inputs through `addStacked`: Copper Ore
x3 with Ana's legacy signature, x5 with Bru's legacy signature, and x2 unsigned.
The predecessor keeps three ore stacks; PR2 keeps one ten-unit stack. Including
the unchanged starter bread, occupied bag slots fall from four to two. The live
PR2 state retains exact source counts two unsigned, three Ana, and five Bru.
Legacy signatures do not invent a recorded gatherer in PR2.

| Viewport | PR1 predecessor | PR2 |
|---|---|---|
| Desktop, 1280 x 720 | [Three ore stacks](before-legacy-desktop.png) | [One ore stack](after-legacy-desktop.png) |
| Touch landscape, 844 x 390 | [Three ore stacks](before-legacy-mobile.png) | [One ore stack](after-legacy-mobile.png) |

The mobile comparison uses a fresh Playwright context with mobile layout and touch
enabled before boot. Both captures use the real offline game and production bag
window. Inventory inputs are staged fixtures; this comparison proves packing and
presentation, not a natural gathering-playthrough rate.

## Actual offline game with new attribution

The browser ran the real game at 1280 x 720. A fresh offline character received
Copper Ore through the simulation grant path: three units gathered by Ana, five
by Bru with Bru's premium signature, and two with no recorded gatherer. These
compatible units occupied one ten-unit stack.

| Capture | Observed state |
|---|---|
| [Desktop tooltip](full-game-desktop-tooltip.png) | One stack with contributor quantities and independent premium attribution. |
| [Desktop Sources](full-game-desktop-sources.png) | Full contributor details opened from the real bag context menu. |
| [Mobile Sources](full-game-mobile-sources.png) | The same flow at 844 x 390 using Chromium touch emulation. |

The walkthrough also separated the stack into quantities two, three, and five,
combined it back to ten, then took two Ana units into their own stack. The
remaining stack retained two unrecorded, one Ana, and five Bru units. Screenshots
show the inspection surfaces; these actions were checked through live inventory
state as well as the displayed UI.

## Focused browser fixtures

These fixtures mount the production source dialog and bank window. They exercise
many contributors, narrow geometry, source selection, keyboard focus, associated
window blocking, and the bank's single-cell item layout.

| Viewport | Source picker | Bank |
|---|---|---|
| Desktop, 1280 x 720 | [Picker](source-picker-1280x720.png) | [Bank](bank-1280x720.png) |
| Landscape, 844 x 390 | [Picker](source-picker-844x390.png) | [Bank](bank-844x390.png) |
| Portrait, 390 x 844 | [Picker](source-picker-390x844.png) | [Bank](bank-390x844.png) |

The paired browser suites are `tests/browser/material_sources.browser.test.ts`
and `tests/browser/material_source_storage.browser.test.ts`. The latest focused
run passed thirteen cases, including loaded Japanese, Korean, Russian, Simplified
Chinese, and Traditional Chinese labels. This is not the complete PR2 gate.

## Limits

Portrait is a component fixture only; the game intentionally requests landscape
orientation for full gameplay. No physical mobile device, physical controller,
screen reader, or live online server was used in this walkthrough. Automated
controller navigation uses the production directional-focus handler. Existing
asset preload and unavailable development API errors occurred in the offline
walkthrough; the source interactions still rendered and completed.
