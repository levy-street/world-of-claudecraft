# Vehicle HUD

Reusable personal-vehicle chrome, composed by Hud through IWorld and shared writers.
The aim and view cores own no DOM or authoritative outcomes. The controller uses
the existing ActionBarPainter family and never changes saved normal action bars.
Exit and session loss clear local aim. No independent frame loop or storage.
The shadow and forge bars are sub-controllers the vehicle controller composes: each
owns its root, and the static blocksPlayerActions routes the slot keys to the one that
is active.

The Graveyard Shift owns NO bar: Morthen's kit rides the normal action bar, touch ring
and cross hotbar as a possess-bar override (`src/game/morthen_controls.ts`, read by
`ActionBarController` and `CrossHotbarBindings`, both of which freeze their writers
while it is on). `morthen_shift_controller.ts`, composed here only because this
controller already runs every frame, keys on the identity aura: it stamps the
`morthen-shift` body class (the extra rows, stances, pets and consumables stand down),
asks the pad bar to re-show its resting row on each flip, and shows each kit hint line
(`morthen_hint_view.ts`, once per shift) through the HUD banner.

## Known limits of the Graveyard Shift HUD (prototype)
- **The character sheet paperdoll and the unit-frame portraits show the player's own
  body** during a run (both read the authored look): only the world rig swaps to Morthen
  (`src/render/characters/identity_body_core.ts`).
