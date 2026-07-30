// Pure decision for when the gamepad should leave movement mode and expose its
// software cursor. Standalone actionable HUD controls count alongside windows
// and prompts so controller-only players can activate them.

export function shouldUseGamepadPointerMode(
  windowOpen: boolean,
  cameraPromptOpen: boolean,
  raceControlVisible: boolean,
): boolean {
  return windowOpen || cameraPromptOpen || raceControlVisible;
}
