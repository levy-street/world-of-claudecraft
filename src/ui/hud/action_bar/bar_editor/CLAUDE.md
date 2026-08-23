<!-- src/ui/hud/action_bar/bar_editor/: the touch bar editor overlay. Presentation
     and input only. Don't repeat root / src/ui / src/ui/hud CLAUDE.md, reference them. -->

# src/ui/hud/action_bar/bar_editor/: the touch bar editor

One ring page, exploded into a 4-button by 5-direction grid of real buttons,
with page tabs. Tap-to-place, tap-to-swap, and a Clear toggle that empties the
next slot tapped. It is the ONLY way to bind an action bar slot on touch, and
the only way to EMPTY one there (the desktop clear is shift plus right-click).

## Load-bearing rules

- **Setup never happens on the live combat surface.** The mobile long-press
  rearrange it replaces reached only the four visible centre buttons (the 16
  directional slots per page could not be bound at all) and armed underneath the
  radial gestures, so a hold long enough to open the petals could pick a slot up
  and swap it on release. Do not reintroduce a binding gesture on the ring.
- **Zero gestures, by construction.** Every control here is a focusable
  `<button>` driven by `click`. That is what makes it work under the
  `touchTapMenus` setting without a second code path, and what makes it
  keyboard-reachable.
- **Clear is a MODE, not a per-cell control.** The grid's cells are already the
  tap surface, and a second control inside each one would halve every target at
  the tier that needs them largest. Arming survives a tap on an empty cell (a
  mis-tap must not take the mode away mid-cleanup) and ends on the tap it
  consumes or on the toggle itself.
- **Mutations leave through the deps, never through a local write path.** All
  three callbacks land on the SAME `placeAbilityOnSlot` / `swapHotbarSlots` /
  `clearHotbarSlot` plus `saveSlotMap` route the desktop drop and shift-clear
  use, so offline and online behave identically and no `IWorld` member was added.
  The tooltip hide that follows a mutation lives HERE, once, rather than in each
  Hud callback.
- **A pending pick survives a page switch.** Moving a binding between pages is
  exactly the move the old drag could never make; clearing the selection on a tab
  press would take it away again.
- **Not the ActionBarPainter family.** The live ring derives cooldown sweeps,
  range dimming and proc glows from the world every frame. This surface paints on
  open / page switch / locale switch / its own mutation, so that state would
  freeze one stale frame on screen. It reuses the family's icon-key contract and
  nothing else. Never put this window on `Hud.update()`'s band.

## Shape

| File | What it is |
|---|---|
| `bar_editor_core.ts` | PURE. Grid model (cells from `radialSourceSlot` via `mobile_action_page_view`), the tap state machine, page clamp, cell aria and caption text. Registered in `UI_PURE_CORES`. |
| `bar_editor_window.ts` | The window: builds the DOM once per render, paints cells in place, routes taps. Cold painter, no driver, no layout read. |

Entry points: the More tray's Edit control (`#mobile-bar-editor`, touch-only) and
the spellbook's per-row assign control, which opens the editor with that spell
armed. Both land on `Hud.openBarEditor`.
