<!-- src/ui/hud/stance/: the warrior/paladin choice bar in its two shapes.
     Presentation and input only. Don't repeat root / src/ui / src/ui/hud
     CLAUDE.md, reference them. -->

# src/ui/hud/stance/: the stance bar, desktop row and touch radial

One model, two shapes. `stance_bar_view.ts` (a flat `src/ui/` core, shared with
the cross hotbar and the action bar's filter) decides WHICH stances exist and
which is worn; this directory decides how that is drawn and how a press reaches
`castAbility`.

- **Desktop** is the historical row of `.stance-btn` buttons in `#stancebar`,
  rebuilt behind a signature latch. Moved out of `hud.ts` verbatim: same markup,
  classes, tooltips, `aria-pressed` and click path.
- **Touch** is ONE circle on the action ring's bottom row wearing the worn
  stance, with the alternatives on the radial's four directions. A row of three
  circles has nowhere to sit on the button row, and the bottom-centre column
  belongs to the player frame.

## Load-bearing rules

- **Both shapes cast through the SAME call.** `StanceBarControllerDeps.cast` is
  the one `IWorld.castAbility` hop the row's buttons always used; only the input
  differs. A shape that grew its own cast path is the bug this split invites.
- **The touch control is a CONSUMER of the ring's gesture layer, not a new
  gesture.** `RadialGesture` (`../action_bar/radial_gesture_controller.ts`) owns
  pointer capture, the reveal timer, the single anchor measure, the window
  release backstop, sticky/tap mode, `aria-expanded` and the Escape closer. This
  directory supplies four parameters: the anchor, the overlay it measures
  against, what each direction holds, and `anchorRole: 'toggle'`. Adding a fifth
  gesture menu asks the same layer; it does not grow a dialect.
- **`anchorRole: 'toggle'` is the whole reason a bare tap opens.** The control
  runs no action of its own (its face is a readout, not a button that casts what
  it shows), so the rule is Quick Actions': open on a bare tap in EITHER mode,
  close on the next press, dismiss on a press outside. The table lives in
  `../tap_menu_core.ts`, and the release half in
  `../action_bar/radial_gesture_core.ts`; neither is restated here.
- **Capacity is a hard four and failure is LOUD.** Four directions, four
  alternatives. A class that ever knew more would silently lose one, so
  `stance_radial_core.ts` reports the excess in `overflow`, warns on the dev
  channel, and folds it into the rebuild signature.
  `tests/stance_radial_core.test.ts` pins all three. Today a warrior has two
  alternatives and a paladin one, so the guard never fires in play.
- **With nothing worn, every known stance stays a petal.** A paladin whose only
  devotion aura is down would otherwise face a dead circle: the anchor shows the
  aura, and the aura is also the one thing to pick.
- **The row and the anchor are never both up.** The touch arm writes the row's
  inline `display: none` every frame (which outranks whatever a desktop-to-touch
  flip left behind); `hud.mobile.css` carries the same `display: none` as the
  belt, so nothing flashes before the first frame.

## Shape

| File | What it is |
|---|---|
| `stance_radial_core.ts` | PURE. Anchor face, stance-to-direction mapping, the capacity guard, the rebuild signature. Registered in `UI_PURE_CORES`. |
| `stance_radial_painter.ts` | Thin painter: the anchor's face and state, petal seating from `placeRadial`, the live highlight. Key-diffs the icon RESOLVE, takes no layout read. |
| `stance_control_controller.ts` | Builds the touch control from the static markup and instantiates the shared `RadialGesture` with `anchorRole: 'toggle'`. |
| `stance_bar_controller.ts` | The per-frame entry `Hud.renderStanceBar` delegates to: resolves the shared model once, then paints the row or the anchor. |

## Seating

Static seating is CSS (`src/styles/hud.mobile.css`, per tier). The anchor is a
CHILD of `#mobile-action-ring` and its `bottom` is `#mobile-jump`'s own
expression, so its centre lands on the button row's line with Jump and the Quick
Actions control at every tier and settings scale without a second derivation to
keep in sync (pinned in `tests/browser/mobile_stance_control.browser.test.ts`).
Horizontally it sits one clear circle gap past Jump, which is the only span on
that line wide enough for it once the bottom-centre column has claimed the
middle. The radial overlay is a SIBLING of the ring for the same reason the
action radial is: its petals are seated in viewport coordinates and edge-clamped
against the shared `--app-vw` / `--app-vh` box.
