// Real WebGL proof for the FXAA arm fused into OutputGradePass. A unit test can
// pin the shader source and the defines, but only a real driver says whether the
// GLSL links, whether it actually softens a diagonal edge, and whether its taps
// stay inside the rendered sub-rect when dynamic resolution shrinks the region.
// That last one is the defect the fusion exists to avoid: a full-frame AA pass
// does not inherit the composer's scissor and reads the stale pixels around it.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dynamicResolutionRect } from '../../src/render/dynamic_resolution_core';

const gfxSettings = vi.hoisted(() => ({
  ao: false,
  aoFullRes: false,
  bloom: false,
  composer: false,
  msaaSamples: 0,
  smaa: false,
  fxaa: true,
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

const WIDTH = 128;
const HEIGHT = 96;
// A pixel is "on the edge" when the grade wrote neither the lifted black floor
// (a few counts) nor the near-clipped white (219 even under the corner
// vignette). Both floors sit far outside this band, so grain cannot reach it.
const EDGE_MIN = 60;
const EDGE_MAX = 195;

let dispose: (() => void) | null = null;

beforeEach(() => {
  gfxSettings.fxaa = true;
});

afterEach(() => {
  dispose?.();
  dispose = null;
});

function makeRenderer(): { canvas: HTMLCanvasElement; webgl: THREE.WebGLRenderer } {
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
  return { canvas, webgl };
}

function readCanvas(webgl: THREE.WebGLRenderer): Uint8Array {
  const gl = webgl.getContext();
  const rgba = new Uint8Array(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  return rgba;
}

function redAt(rgba: Uint8Array, x: number, y: number): number {
  return rgba[(y * WIDTH + x) * 4];
}

describe('grade-fused FXAA on a real driver', () => {
  it('softens a diagonal edge and leaves every flat fragment byte-identical', async () => {
    const { canvas, webgl } = makeRenderer();
    dispose = () => {
      webgl.dispose();
      canvas.remove();
    };

    // A white half-plane tilted off both axes: the stair-stepped contour FXAA
    // exists for. An axis-aligned edge would be a single clean step and would
    // not tell the two builds apart.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 4),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    edge.position.set(0, -1.9, 0);
    edge.rotation.z = 0.42;
    scene.add(edge);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();

    const { buildComposer } = await import('../../src/render/post');
    const render = (fxaa: boolean): Uint8Array => {
      gfxSettings.fxaa = fxaa;
      const post = buildComposer(webgl, scene, camera, WIDTH, HEIGHT, { gradeOnly: true });
      expect(post.grade.fxaa).toBe(fxaa);
      post.render();
      const pixels = readCanvas(webgl);
      post.dispose();
      return pixels;
    };

    const plain = render(false);
    const antialiased = render(true);

    const countEdgePixels = (rgba: Uint8Array): number => {
      let count = 0;
      for (let i = 0; i < WIDTH * HEIGHT; i++) {
        const red = rgba[i * 4];
        if (red >= EDGE_MIN && red <= EDGE_MAX) count++;
      }
      return count;
    };
    // Without the arm the contour is a hard step: every fragment is either the
    // lifted black or the near-white and nothing lands in between (measured 0).
    // With it the whole diagonal span picks up intermediate values (measured
    // 169, against a contour a bit over 150 fragments long).
    expect(countEdgePixels(plain)).toBeLessThan(WIDTH / 4);
    expect(countEdgePixels(antialiased)).toBeGreaterThan(countEdgePixels(plain) + 100);

    // The early-out is what keeps the arm affordable AND keeps the rest of the
    // frame the exact image the grade produced before it: a fragment whose four
    // neighbours match it returns untouched, byte for byte.
    let changed = 0;
    for (let i = 0; i < WIDTH * HEIGHT * 4; i++) if (plain[i] !== antialiased[i]) changed++;
    expect(changed).toBeGreaterThan(200);
    expect(changed).toBeLessThan(WIDTH * HEIGHT * 4 * 0.05); // measured 750 of 49152
    for (const [x, y] of [
      [4, HEIGHT - 4],
      [WIDTH - 4, HEIGHT - 4],
      [4, 4],
      [WIDTH - 4, 4],
    ]) {
      const at = (y * WIDTH + x) * 4;
      expect([plain[at], plain[at + 1], plain[at + 2]]).toEqual([
        antialiased[at],
        antialiased[at + 1],
        antialiased[at + 2],
      ]);
    }
  });

  it('clamps its taps to the rendered region instead of dragging in the stale frame', async () => {
    const { canvas, webgl } = makeRenderer();
    dispose = () => {
      webgl.dispose();
      canvas.remove();
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xff0000);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();

    const { buildComposer } = await import('../../src/render/post');
    const post = buildComposer(webgl, scene, camera, WIDTH, HEIGHT, { gradeOnly: true });
    dispose = () => {
      post.dispose();
      webgl.dispose();
      canvas.remove();
    };
    expect(post.grade.fxaa).toBe(true);
    expect(post.supportsDynamicResolution).toBe(true);

    // Fill the whole target red, then shrink the region and draw green into it.
    // Everything outside the region still holds the red frame, and the far edge
    // of the canvas maps to the last rendered texel: a tap one texel past it
    // would pull that red straight into the visible image.
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
    post.render();

    // Worst red anywhere on the canvas border. Clamped it measures 0 (green's
    // red channel bottoms out through the grade's saturation step); drop the
    // clamp from fxaaTap and the corner fragments, whose diagonal arm averages
    // four neighbours, blend the stale red up to 51.
    const rgba = readCanvas(webgl);
    let worstBorderRed = 0;
    for (let x = 0; x < WIDTH; x++) {
      for (const y of [0, HEIGHT - 1]) worstBorderRed = Math.max(worstBorderRed, redAt(rgba, x, y));
    }
    for (let y = 0; y < HEIGHT; y++) {
      for (const x of [0, WIDTH - 1]) worstBorderRed = Math.max(worstBorderRed, redAt(rgba, x, y));
    }
    expect(worstBorderRed).toBeLessThan(12);
    // ...and the frame really is the reduced-region green, not a stale one.
    expect(rgba[(((HEIGHT / 2) | 0) * WIDTH + WIDTH / 2) * 4 + 1]).toBeGreaterThan(180);
  });
});
