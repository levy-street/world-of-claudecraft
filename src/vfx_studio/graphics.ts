import * as THREE from 'three';
import { captureGfxCapabilities, initGfxTier } from '../render/gfx';

/** Prepare the one canvas context before any profile-dependent scene objects
 * exist. The short-lived Three wrapper owns no scene or animation loop. Its
 * disposal releases wrapper resources, not the context handed to Renderer. */
export function createStudioGraphicsContext(
  canvas: HTMLCanvasElement,
  context?: WebGL2RenderingContext,
) {
  const probe = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: false,
    powerPreference: 'high-performance',
  });
  try {
    if (!probe.capabilities.isWebGL2) throw new Error('VFX Studio requires WebGL2');
    initGfxTier(probe); // Includes the shared point-light shader bootstrap.
    return {
      context: probe.getContext() as WebGL2RenderingContext,
      capabilities: captureGfxCapabilities(probe),
    };
  } finally {
    probe.dispose();
  }
}
