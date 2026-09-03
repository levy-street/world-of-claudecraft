// The live viewport measurement for the renderer's canvas: the one DOM reader
// over viewport_measure_core.ts (which holds the pure resolution and its pins).
import { resolveViewportSize, type ViewportSize } from './viewport_measure_core';

export function measureCanvasViewport(canvas: HTMLCanvasElement): ViewportSize {
  const rect = canvas.getBoundingClientRect();
  return resolveViewportSize({
    canvasWidth: rect.width,
    canvasHeight: rect.height,
    stableMobileGameViewport:
      document.body.classList.contains('game-active') &&
      document.body.classList.contains('mobile-touch'),
    visualViewport: window.visualViewport ?? null,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  });
}
