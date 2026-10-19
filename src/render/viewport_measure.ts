// The game canvas's CSS viewport size, moved verbatim out of
// Renderer.measureViewport (the monolith ratchet). On an active mobile-touch game
// the canvas's own rect is the stable answer (the visual viewport shrinks and
// grows with the on-screen keyboard and browser chrome); everywhere else the
// visual viewport wins when the browser reports one. Never below 1x1.
export function measureCanvasViewport(canvas: HTMLElement): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect();
  const stableMobileGameViewport =
    document.body.classList.contains('game-active') &&
    document.body.classList.contains('mobile-touch');
  const vv = stableMobileGameViewport ? null : window.visualViewport;
  const width = Math.round(
    stableMobileGameViewport
      ? rect.width || window.innerWidth
      : (vv?.width ?? (rect.width || window.innerWidth)),
  );
  const height = Math.round(
    stableMobileGameViewport
      ? rect.height || window.innerHeight
      : (vv?.height ?? (rect.height || window.innerHeight)),
  );
  return { width: Math.max(1, width), height: Math.max(1, height) };
}
