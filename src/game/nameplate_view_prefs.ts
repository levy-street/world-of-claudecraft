// Local, input-driven nameplate view preferences: today just the friendly-plate
// toggle behind the Toggle Friendly Nameplates keybind (Ctrl+V).
//
// It lives here, as module state, rather than as a field on the renderer, for the
// reason the monolith ratchet exists and for the reason nameplate_dot_scale.ts
// gives: renderer.ts would carry it only to hand it straight to the nameplate
// painter, and a pass-through field in a coordinator at its line ceiling is
// exactly the thing that should be a sibling module instead. The painter reads it
// by default and still accepts an injected reader, so a test drives the rule
// without touching this state.
//
// In src/game rather than src/render because the INPUT layer owns it: the key is
// dispatched by input.ts (and intercepted for the pad in gamepad.ts) exactly the
// way autorun is, so the toggle never has to travel through main.ts at all.
// src/render reads it the way it already reads the game-side tier knobs
// (ui_tier_knobs, ui_effects_profile). Pure: no DOM, no sim, no renderer.
//
// Session state, not a stored setting, matching the Toggle Nameplates key it
// mirrors: it resets to "shown" on reload, and it survives a graphics rebuild for
// free because it does not live on the renderer being rebuilt.

let friendlyShown = true;

/** Flip the friendly-nameplate toggle; returns the new state. */
export function toggleFriendlyNameplates(): boolean {
  friendlyShown = !friendlyShown;
  return friendlyShown;
}

/** Whether friendly mob nameplates are currently drawn. */
export function friendlyNameplatesShown(): boolean {
  return friendlyShown;
}

/** Restore the default (shown). For tests, which must not leak state between cases. */
export function resetNameplateViewPrefs(): void {
  friendlyShown = true;
}
