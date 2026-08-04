// Real WebGL pixel regression for the medium post chain. A unit plan can prove
// that SMAA and ScreenFx are absent, but only the browser runner exercises the
// r165 framebuffer behavior that caused the visible defect: composer scissor
// applies only to composer targets, while SMAA's internal full-size targets do
// not inherit it. The old chain therefore left the top and right of the canvas
// showing pixels from the previous full-size frame after a resolution step.

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dynamicResolutionRect } from '../../src/render/dynamic_resolution_core';

const gfxSettings = vi.hoisted(() => ({
  ao: false,
  aoFullRes: false,
  bloom: false,
  composer: false,
  msaaSamples: 0,
  smaa: true,
}));

vi.mock('../../src/render/gfx', () => ({
  GFX: gfxSettings,
  sharedUniforms: {
    uTime: { value: 0 },
  },
}));

vi.mock('../../src/render/render_dev_flags', () => ({
  renderLayerDisabled: () => false,
}));

const WIDTH = 96;
const HEIGHT = 64;
const SAMPLE_INSET = 4;

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

function pixel(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  x: number,
  y: number,
): [number, number, number, number] {
  const rgba = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  return [rgba[0], rgba[1], rgba[2], rgba[3]];
}

describe('medium dynamic-resolution post pixels', () => {
  it('fills the canvas from the reduced region instead of retaining the previous frame', async () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    webgl.setPixelRatio(1);
    webgl.setSize(WIDTH, HEIGHT, false);
    webgl.outputColorSpace = THREE.SRGBColorSpace;
    webgl.toneMapping = THREE.NoToneMapping;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xff0000);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();

    const { buildComposer } = await import('../../src/render/post');
    const post = buildComposer(webgl, scene, camera, WIDTH, HEIGHT, { gradeOnly: true });
    dispose = () => {
      post.composer.dispose();
      webgl.dispose();
      canvas.remove();
    };

    post.updateScreenFx(0);
    post.render();

    scene.background = new THREE.Color(0x00ff00);
    post.setRenderRegion(
      dynamicResolutionRect({
        logicalWidth: WIDTH,
        logicalHeight: HEIGHT,
        pixelRatio: 1,
        renderScale: 0.68,
        maxRenderScale: 1,
        minRenderScale: 0.68,
      }),
    );
    post.updateScreenFx(0);
    post.render();

    const gl = webgl.getContext();
    expect(gl.getError()).toBe(gl.NO_ERROR);
    const samples = [
      pixel(gl, SAMPLE_INSET, SAMPLE_INSET),
      pixel(gl, WIDTH - SAMPLE_INSET, SAMPLE_INSET),
      pixel(gl, SAMPLE_INSET, HEIGHT - SAMPLE_INSET),
      pixel(gl, WIDTH - SAMPLE_INSET, HEIGHT - SAMPLE_INSET),
    ];
    for (const rgba of samples) {
      expect(rgba[1]).toBeGreaterThan(rgba[0] + 40);
      expect(rgba[3]).toBe(255);
    }
  });
});
