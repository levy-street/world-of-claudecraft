// Real-WebGL regression for the post chain's bit-exact non-finite guard. The
// pure suites (post_finite_guard_glsl, post_output_grade, post_bloom_shader_core,
// post_n8ao) pin only the STRING splices; production disables checkShaderErrors
// unless ?shaderdebug is present (renderer.ts), so a syntax or semantic error
// in the spliced GLSL would ship as an all-black frame with no error anywhere,
// the exact symptom the guard exists to prevent. Same shape as
// final_color_nan_guard.browser.test.ts: compile with errors wired to fail,
// then prove the scrub on real NaN and Inf texels against a finite baseline.
//
// Read back through FloatType targets on purpose: an UNSIGNED_BYTE write
// already converts NaN to 0 on some drivers, which would make a byte readback a
// vacuous test of the guard itself. A float target keeps whatever the shader
// wrote, so NaN-in equals NaN-out unless the spliced scrub runs.
//
// Lives under tests/browser/** and ends in .browser.test.ts, so a bare
// `vitest run` skips it; `npm run test:browser` (chromium) runs it.

import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PreparedBloomPass } from '../../src/render/post_bloom';
import { StaticOpaqueN8AOPass } from '../../src/render/post_n8ao';
import { OutputGradePass } from '../../src/render/post_output_grade';
import { isSoftwareRendererName } from '../../src/render/software_renderer';

let renderer: THREE.WebGLRenderer;
let shaderError: string | null = null;

// A 2x2 float texture: NaN, +Inf (with finite companions), a plain finite
// texel, and black. The guarded shaders must map the first two exactly where
// a zero texel would go and leave the finite ones untouched.
const TEXELS: [number, number, number, number][] = [
  [Number.NaN, Number.NaN, Number.NaN, 1],
  [Number.POSITIVE_INFINITY, 2, 3, 1],
  [2, 2, 2, 1],
  [0, 0, 0, 1],
];

function floatTexture(texels: [number, number, number, number][]): THREE.DataTexture {
  const data = new Float32Array(texels.flat());
  const texture = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function readFloatTarget(target: THREE.WebGLRenderTarget): Float32Array {
  const out = new Float32Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out);
  return out;
}

function texel(pixels: Float32Array, index: number): number[] {
  return Array.from(pixels.subarray(index * 4, index * 4 + 4));
}

beforeAll(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program) => {
    shaderError = gl.getProgramInfoLog(program) || 'shader compile/link failed';
  };
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const unmasked = String(
    dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  console.log(
    `[post_finite_guard.browser] adapter: ${unmasked} (software: ${isSoftwareRendererName(unmasked)})`,
  );
});

afterEach(() => {
  expect(shaderError).toBeNull();
  shaderError = null;
});

afterAll(() => {
  renderer.dispose();
  renderer.forceContextLoss();
});

describe('bloom high-pass guard on a real driver', () => {
  it('compiles, and scrubs NaN and Inf beauty texels to the zero texel result', () => {
    const pass = new PreparedBloomPass(new THREE.Vector2(2, 2), 0.4, 0.6, 0);
    const material = pass.materialHighPassFilter;
    const input = floatTexture(TEXELS);
    material.uniforms.tDiffuse.value = input;
    material.uniforms.luminosityThreshold.value = 0;
    material.uniforms.smoothWidth.value = 0.01;
    const quad = new FullScreenQuad(material);
    const target = new THREE.WebGLRenderTarget(2, 2, { type: THREE.FloatType, depthBuffer: false });
    renderer.setRenderTarget(target);
    quad.render(renderer);
    renderer.setRenderTarget(null);
    const pixels = readFloatTarget(target);

    // NaN texel: scrubbed to black, luminance 0, so the high-pass emits its
    // default colour (black, opacity 0), exactly what the black input texel gets.
    expect(texel(pixels, 0)).toEqual(texel(pixels, 3));
    expect(texel(pixels, 0).every(Number.isFinite)).toBe(true);
    // Inf channel scrubbed to 0, finite companions kept, above threshold.
    expect(texel(pixels, 1)).toEqual([0, 2, 3, 1]);
    // Finite texel passes through unchanged.
    expect(texel(pixels, 2)).toEqual([2, 2, 2, 1]);

    quad.dispose();
    target.dispose();
    input.dispose();
    pass.dispose();
  });
});

describe('output grade guard on a real driver', () => {
  // The grade is not uniform across the frame (vignette, grain), so a NaN
  // texel cannot be compared with a black texel elsewhere: render the same
  // frame twice, once from the NaN / Inf input and once from the input with
  // those channels already at the scrub's 0.0, and require identical pixels.
  function gradeFrame(texels: [number, number, number, number][]): Float32Array {
    const pass = new OutputGradePass({ value: 0 }, null, { fxaa: false });
    const input = floatTexture(texels);
    const readBuffer = { texture: input } as unknown as THREE.WebGLRenderTarget;
    const writeBuffer = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.FloatType,
      depthBuffer: false,
    });
    pass.render(renderer, writeBuffer, readBuffer);
    renderer.setRenderTarget(null);
    const pixels = readFloatTarget(writeBuffer);
    writeBuffer.dispose();
    input.dispose();
    pass.dispose();
    return pixels;
  }

  it('compiles, and grades a NaN or Inf beauty texel exactly like the scrubbed zero', () => {
    const scrubbed: [number, number, number, number][] = [
      [0, 0, 0, 1],
      [0, 2, 3, 1],
      [2, 2, 2, 1],
      [0, 0, 0, 1],
    ];
    const pixels = gradeFrame(TEXELS);
    const baseline = gradeFrame(scrubbed);

    expect(Array.from(pixels).every(Number.isFinite)).toBe(true);
    expect(Array.from(pixels)).toEqual(Array.from(baseline));
    // Not vacuous: the frame carries a real graded image, the lit texel is
    // brighter than the black one, and the scrubbed Inf texel keeps its
    // finite companions (it is not the black result).
    expect(texel(pixels, 2)[0]).toBeGreaterThan(texel(pixels, 3)[0]);
    expect(texel(pixels, 1)[1]).toBeGreaterThan(texel(pixels, 3)[1]);
  });
});

describe('N8AO guarded shaders on a real driver', () => {
  it('compiles the guarded evaluation, downsample and compositer programs on the half-res path', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const pass = new StaticOpaqueN8AOPass(scene, camera, 8, 8);
    pass.setQualityMode('Low');
    pass.configuration.halfRes = true;
    pass.configuration.depthAwareUpsampling = true;
    const a = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType });
    const b = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType });
    pass.render(renderer, a, b, 0, false);
    renderer.setRenderTarget(null);
    a.dispose();
    b.dispose();
    pass.dispose();
  });
});
