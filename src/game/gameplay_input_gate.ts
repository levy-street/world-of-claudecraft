// The one predicate deciding whether gameplay key handling is suppressed, shared by
// Input.canUseGameKeys (keyboard) and the gamepad action dispatcher so the two cannot
// drift. Pure and DOM-free: main.ts samples the surfaces and passes them in.

export interface GameplayInputSurfaces {
  /** The renderer is being recycled, so every client-frame owner is paused. */
  graphicsRebuildPaused: boolean;
  /** A HUD window is up that owns the screen (Hud.isModalOpen). */
  modalOpen: boolean;
  /** A HUD prompt is awaiting an answer (Hud.promptModalOpen). */
  promptModalOpen: boolean;
  /** The camera prompt is up. It lives outside Hud, so it reports separately. */
  cameraPromptOpen: boolean;
  /**
   * The chat composer is on screen. Not consulted by the gate; it is passed so the
   * distinction from the focus flag below is explicit at every call site.
   */
  chatComposerVisible: boolean;
  /**
   * The chat composer holds keyboard focus, and is therefore what receives
   * keystrokes. Focus is what suppresses gameplay keys, not visibility: an unfocused
   * composer receives nothing, so blocking on its presence would leave a keypress
   * reaching neither the game nor the composer.
   */
  chatComposerFocused: boolean;
}

/** True when a blocking surface owns the keyboard, so gameplay keys must be ignored. */
export function isGameplayInputBlocked(surfaces: GameplayInputSurfaces): boolean {
  return (
    surfaces.graphicsRebuildPaused ||
    surfaces.modalOpen ||
    surfaces.promptModalOpen ||
    surfaces.cameraPromptOpen ||
    surfaces.chatComposerFocused
  );
}
