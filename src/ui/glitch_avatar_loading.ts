export interface GlitchAvatarLoadingState {
  glitchActive: boolean;
  previewReady: boolean;
}

/** Keep the pre-game avatar wait visible only for an active Glitch launch. */
export function syncGlitchAvatarLoading(
  container: HTMLElement,
  state: GlitchAvatarLoadingState,
): void {
  const loading = state.glitchActive && !state.previewReady;
  container.classList.toggle('glitch-avatar-loading-active', loading);
  const indicator = container.querySelector<HTMLElement>('[data-glitch-avatar-loading]');
  if (indicator) indicator.hidden = !loading;
}
