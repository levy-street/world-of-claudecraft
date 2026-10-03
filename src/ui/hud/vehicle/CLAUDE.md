# Vehicle HUD

Reusable personal-vehicle chrome, composed by Hud through IWorld and shared writers.
The aim and view cores own no DOM or authoritative outcomes. The controller uses
the existing ActionBarPainter family and never changes saved normal action bars.
Exit and session loss clear local aim. No independent frame loop or storage.
The shadow, forge and Morthen (Graveyard Shift) bars are sub-controllers the vehicle
controller composes: each owns its root, and the static blocksPlayerActions routes the
slot keys to the one that is active. Morthen keys on the identity aura alone.

## Known limits of the Morthen bar (prototype)
- **Keyboard and mouse only.** The kit is reachable through the slot keys and button
  clicks; gamepad (cross hotbar) and touch (the mobile action ring and radials) players
  cannot cast it while Morthen, because the hide rule removes those surfaces and nothing
  routes them to this bar. Owner decision for the dev-gated prototype; it must be fixed
  before the mode ships.
- **The character sheet paperdoll and the unit-frame portraits show the player's own
  body** during a run (both read the authored look): only the world rig swaps to Morthen
  (`src/render/characters/identity_body_core.ts`).
