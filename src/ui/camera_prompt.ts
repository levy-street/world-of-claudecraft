// The first-run camera-mode prompt, REMOVED (owner call, 2026-08-22).
//
// A brand new player used to be stopped on their first world entry to answer
// a question about camera modes they had not used yet. Classic IS the
// default, and Mouse Camera is one toggle away under Esc, Key Bindings for
// anyone who prefers it, so the question was asked at the worst possible
// moment and taught nothing.
//
// What survives is the gate the rest of the client asks: main.ts feeds
// cameraPromptOpen() into the gameplay input gate
// (game/gameplay_input_gate.ts) and the gamepad pointer-mode decision
// (game/gamepad_pointer_mode.ts), both of which take it as a named input.
// Rather than thread a `false` literal through those contracts and their
// tests, the accessor stays and answers honestly: no such modal exists, so
// it is never open.
//
// If the prompt is ever wanted back, it is a modal builder plus a call from
// main.ts's post-entry block; the copy still lives in the hud_chrome catalog
// under `cameraPrompt`.

/** Shared gameplay/gamepad gate. Always false: there is no camera modal. */
export function cameraPromptOpen(): boolean {
  return false;
}

/** External modal dispatchers (the gamepad Escape action) ask this first.
 *  Always false, so Escape falls straight through to the HUD windows. */
export function dismissCameraPrompt(): boolean {
  return false;
}
