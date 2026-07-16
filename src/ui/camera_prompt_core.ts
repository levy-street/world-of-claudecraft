// Pure, host-agnostic decision core for the first-run camera-mode prompt (issue
// #1727). No DOM and no imports: it takes primitive inputs and returns the policy,
// so a Vitest can pin when to show it and what each choice applies directly. The
// DOM modal in camera_prompt.ts is the thin consumer.

export type CameraModeChoice = 'classic' | 'mouse';

// Classic Camera is the neutral first/default choice. The prompt explains both
// modes without recommending either one; confirming without changing the radio
// therefore preserves the game's classic right-click camera behavior.
export const DEFAULT_CAMERA_CHOICE: CameraModeChoice = 'classic';

export interface CameraPromptContext {
  // The on-screen touch/joystick interface is active (a phone, or a device forced
  // to touch): the mouse-camera choice is irrelevant there, so the prompt is
  // suppressed.
  touchControlsActive: boolean;
  // The prompt has already been answered or dismissed in this browser (localStorage
  // flag), so it must never appear again.
  alreadyShown: boolean;
}

/** Whether the first-run camera prompt should be shown for this player. */
export function shouldShowCameraPrompt(ctx: CameraPromptContext): boolean {
  return !ctx.touchControlsActive && !ctx.alreadyShown;
}

/**
 * The mouseCamera setting value a given choice applies: Mouse Camera turns it on,
 * Classic Camera turns it off. Mirrors the Esc, Key Bindings toggle exactly.
 */
export function cameraChoiceEnablesMouseCamera(choice: CameraModeChoice): boolean {
  return choice === 'mouse';
}
