import * as THREE from 'three';
import { transparentGameplaySort } from './transparent_draw_order';

/** One WebGL2 wrapper, including graphics-setting rebuilds that reuse a context. */
export function createWorldRenderer(
  canvas: HTMLCanvasElement,
  context?: WebGL2RenderingContext,
): THREE.WebGLRenderer {
  // Default-framebuffer MSAA remains off. Composer targets own premium AA;
  // software GL must not pay for MSAA before adapter detection can run.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: false,
    powerPreference: 'high-performance',
  });
  try {
    if (!renderer.capabilities.isWebGL2) throw new Error('Renderer requires WebGL2');
    if (context && renderer.getContext() !== context)
      throw new Error('Three replaced the supplied WebGL2 context');
    renderer.setTransparentSort(transparentGameplaySort);
    return renderer;
  } catch (error) {
    // Failure precedes assignment to the owner, so release this wrapper here.
    // A caller-supplied context still belongs to its graphics-rebuild owner.
    try {
      renderer.dispose();
    } catch {
      /* Preserve the original failure. */
    }
    if (!context)
      try {
        renderer.forceContextLoss();
      } catch {
        /* Best effort. */
      }
    throw error;
  }
}
