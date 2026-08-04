// Real Chromium coverage for the topology used by live graphics changes.
// Unit fixtures pin event ordering and failures; this proves Three r165 can
// dispose, lose, restore, and rebuild around the exact same canvas/context.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { recycleWebGL2Context } from '../../src/render/context_recycle';

describe('same-context Three renderer recycle in a real browser', () => {
  it('renders successfully after loss and restoration without replacing the canvas or context', async () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    let current: THREE.WebGLRenderer | null = null;

    try {
      const first = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        preserveDrawingBuffer: true,
      });
      current = first;
      first.setPixelRatio(1);
      first.setSize(32, 32, false);
      const context = first.getContext() as WebGL2RenderingContext;
      expect(first.capabilities.isWebGL2).toBe(true);

      first.dispose();
      current = null;
      const restored = await recycleWebGL2Context({ canvas, context }, { timeoutMs: 5_000 });

      expect(restored.canvas).toBe(canvas);
      expect(restored.context).toBe(context);
      expect(canvas.getContext('webgl2')).toBe(context);
      expect(context.isContextLost()).toBe(false);

      const second = new THREE.WebGLRenderer({
        canvas: restored.canvas,
        context: restored.context,
        antialias: false,
      });
      current = second;
      second.setPixelRatio(1);
      second.setSize(32, 32, false);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x18c964);
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
      camera.position.z = 1;
      second.render(scene, camera);

      const pixel = new Uint8Array(4);
      context.readPixels(16, 16, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      expect(context.getError()).toBe(context.NO_ERROR);
      expect(pixel[1]).toBeGreaterThan(pixel[0] + 80);
      expect(pixel[1]).toBeGreaterThan(pixel[2] + 40);
      expect(pixel[3]).toBe(255);
    } finally {
      current?.forceContextLoss();
      current?.dispose();
      canvas.remove();
    }
  });
});
