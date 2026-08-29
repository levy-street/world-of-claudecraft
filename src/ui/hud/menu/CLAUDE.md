<!-- src/ui/hud/menu/: Quick Actions (one seat + a ten-item strip).
     Presentation and input only. Don't repeat root / src/ui / src/ui/hud
     CLAUDE.md, reference them. -->

# src/ui/hud/menu/: Quick Actions, the touch menu control

One gesture control replacing the old five-button touch row (Chat, Social,
Quests, Settings, More). It runs NO action of its own: a tap opens the ten-item
strip (Mount, Chat, Map, Bags, Social, Quests, Character, Spells, Settings,
More), a hold or a swipe along the row opens it and picks in one gesture, and the
next press on the control closes it again.

## Load-bearing rules

- **The row's direction follows the MIRROR, and nothing else.** It grows right,
  and flips left only under `body.mobile-left-handed`, which reseats the whole
  control against the opposite screen edge; the gesture reads that class live and
  `resolveMenuStripDirection` is the one place that answers. Deliberately NOT the
  consumables row's room comparison (`resolveConsumableStripDirection`): that seat
  sits hard against the edge, while this control sits 152px in, where the side
  with more room flips on a narrow portrait phone the mirror never touched. A
  hard-coded direction is the other failure: it clamped the row back over its own
  anchor under the mirror while the travel, the dim and the caption still counted
  the other way.
- **The roster order IS the design.** It is sorted by how often a player reaches
  for it, because swipe distance is the cost. Mount leads it (issue #2739). Do
  not reorder `MENU_STRIP_ITEMS` for tidiness.
- **Nothing here implements an action, the control least of all.** Every strip
  item is a real `<button>` the touch HUD already binds (`mobile_controls.ts`),
  so a pick activates that button and the existing handler runs. Adding an action
  means adding its button and its binding, never a callback that duplicates the
  handler. The anchor takes no default-action callback at all.
- **A pick reaches its item through a synthesized `click`.** That is why Chat is
  seated by its own `#mobile-menu-chat` rather than the More tray's
  `#mobile-chat`: the tray button carries the press-and-hold chat-log peek on
  pointer handlers a click never reaches. Both buttons run the same `tapChat()`.
- **The caption reuses the tooltip chrome.** `.panel` for the box and `.tt-title`
  for the text, which is why those `.tt-title` metrics are lifted out of the
  `#tooltip` id scope in `hud.css`. Never ship a second copy of them.
- **One caption, never ten labels.** Ten 8px captions at this pitch collide and
  clip, and they name nine things the player is not choosing.
- **The anchor's tap rule is `tap_menu_core.ts`'s, not this directory's.** The
  control declares `anchorRole: 'toggle'` and the shared table answers what an
  anchor press means in either mode; a bare tap resolves at RELEASE, which is
  what leaves the swipe intact with `touchTapMenus` off.

## Shape

| File | What it is |
|---|---|
| `menu_strip_core.ts` | PURE. Roster, release rules, reveal rule, caption clamp. Registered in `UI_PURE_CORES`. |
| `menu_strip_gesture_controller.ts` | A thin instantiation of the SHARED `../strip_gesture_controller.ts` (pointer capture, the reveal timer, ONE anchor measure per gesture, the window release backstop, `aria-expanded`, the Escape closer, and the sticky path). It supplies only this menu's four parameters: the direction resolved per gesture by `resolveMenuStripDirection`, the ten-item roster, the pitch, and the `anchorRole: 'toggle'` that turns a bare tap into an open. |
| `menu_strip_painter.ts` | Thin painter: item seating, live highlight, caption text and position. Takes no layout read. |
| `menu_control_controller.ts` | Builds it from the static markup and routes picks to the real buttons. |

Geometry is reused from `../action_bar/radial_action_core.ts`
(`placeConsumableStrip`, `resolveStripIndex`, plus the shared `STRIP_PITCH_PX`,
`stripCancelIsLive` and `shouldRevealStrip`, which this core re-exports under its
own names): the menu strip and the consumables row are the same shape mirrored, so
there is one tested implementation. The gesture LAYER is shared the same way; see
the parent `../CLAUDE.md`.

## Seating

Static seating is CSS (`src/styles/hud.mobile.css`, per tier): the anchor sits on
the action ring's Jump line so the bottom of the HUD reads as one row. The rest of
that row hangs off `--mobile-button-row-lift`, the per-tier distance from the
viewport bottom to the row's TOP line: the bottom-centre `#player-frame` puts its
top ON it, and the cast bar, swing bar, pet frame and stance bar stack above it.
Only the strip's own item positions are measured, because they depend on where the
anchor actually is and are edge-clamped against the shared app-viewport box
(`--app-vw`), never `window.innerWidth`.

The open row also RAISES `#mobile-controls` over `#ui`. The row crosses the whole
bottom band including `#player-frame`, and a child z-index cannot escape its parent
stacking context, so the raise has to happen on the context itself.

## The local dim

Both this row and the consumables row dim a BAND along the row, never a circle at
the anchor: `stripDimSpan` (`../action_bar/radial_action_core.ts`) measures from the
open items and the painter writes `--strip-dim-x` / `--strip-extent-px`, so the
extent scales with the item count and the mirror comes from the placement rather
than from a body class. A circle wide enough to reach the last item washes the
half of the screen the row never touches, which is what it did before.
