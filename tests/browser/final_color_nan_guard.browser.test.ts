// Real-WebGL regression for the final-color NaN guard's inserted GLSL. The
// pure suites (final_color_nan_guard_core, final_color_nan_guard) only pin
// the STRING transform; nothing in the vitest-run suite ever compiles the
// patched chunks against a real driver, and production disables
// checkShaderErrors unless ?shaderdebug is present (renderer.ts), so a
// syntax or semantic error in the inserted statements would ship as an
// all-black frame with no error anywhere: the exact symptom this guard is
// meant to prevent.
//
// Two things are proven here, deliberately kept separate:
// 1. The patched GLSL compiles, links, and draws a real (non-black) frame,
//    with checkShaderErrors forced on and any compile/link failure wired to
//    fail the test (not just logged).
// 2. The guard actually SCRUBS a NaN: each NaN-injection test renders the
//    same shader twice, once with a runtime-computed NaN spliced into the
//    exact value the guard protects and once with the equivalent finite
//    value (0.0), and asserts the two frames are pixel-identical. A missing
//    or broken guard would let the NaN reach gl_FragColor and diverge from
//    the finite baseline (typically to black); compiling-but-wrong GLSL is
//    exactly what "compiles and draws a non-black frame" alone cannot catch.
//
// This suite imports NOTHING from gfx.ts other than the two materials it
// renders: the guard install itself is asserted from THREE.ShaderChunk
// directly, before initGfxTier (or anything else) is ever touched, so this
// is real-browser evidence for the module-scope install in
// final_color_nan_guard.ts, not for gfx.ts's (redundant) explicit call.
//
// It lives under tests/browser/** and ends in .browser.test.ts, so a bare
// `vitest run` skips it; `npm run test:browser` (chromium) runs it.

import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isSoftwareRendererName } from '../../src/render/software_renderer';
// Side-effect import only: proves the module-scope install works without
// ever calling initGfxTier (see the header comment above).
import '../../src/render/final_color_nan_guard';

let renderer: THREE.WebGLRenderer;
let shaderError: string | null = null;
const FOG_NEAR = 4;
const FOG_FAR = 40;
const FOGGED_CAMERA_Z = 7;
const CUBE_FRONT_Z = 2;

beforeAll(() => {
  // The module-scope install already ran as an import side effect (above),
  // before this file did anything else, and before any renderer exists.
  expect(THREE.ShaderChunk.opaque_fragment).toContain('WOC_OPAQUE_NAN_GUARD');
  expect(THREE.ShaderChunk.fog_fragment).toContain('WOC_FOG_NAN_GUARD');

  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program) => {
    shaderError = gl.getProgramInfoLog(program) || 'shader compile/link failed';
  };

  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const unmasked = String(
    dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  // Not asserted: CI and this sandbox both run headless, commonly on a
  // software rasterizer, and failing on that would fail the suite
  // everywhere it runs. Surfaced so a real-driver run (or its absence) is
  // visible in the test output rather than silently assumed either way.
  console.log(
    `[final_color_nan_guard.browser] adapter: ${unmasked} (software: ${isSoftwareRendererName(unmasked)})`,
  );
});

afterEach(() => {
  shaderError = null;
});

afterAll(() => {
  // Matches context_recycle.browser.test.ts: release the real context, not
  // just Three's GL objects, so this suite doesn't hold one of the browser
  // process's ~16 live contexts until GC.
  renderer.dispose();
  renderer.forceContextLoss();
});

// Both helpers OVERWRITE the guarded value (never add to it): the baseline
// and the NaN case must start from the identical state and differ ONLY in
// whether the injected value is exactly 0.0 or NaN, since that is the
// guard's actual contract (NaN becomes exactly 0.0). Adding to the original
// (lit, non-zero) value instead would make the two branches diverge for a
// reason that has nothing to do with the guard: NaN propagates through `+`
// and wipes out the whole component regardless of what it started as, while
// a `+0.0` baseline keeps it, so the two would never match even with a
// correctly-working guard.

// Three's WebGLProgram cache is renderer-wide and keyed off each material's
// DECLARED parameters (isMeshStandardMaterial, fog, opaque, ...), not off
// what onBeforeCompile actually mutates: two materials with the same
// declared shape but different onBeforeCompile injections can silently
// share one compiled GL program, in which case the second material's
// injected GLSL is never compiled at all (only its uniform VALUES bind,
// into a program that does not declare or use them the way it expects). A
// unique material.customProgramCacheKey() per (kind, injectNan) pair is
// what three provides for exactly this: it forces each variant tested here
// into its own program.

/** A material whose fragment shader overwrites `outgoingLight` right before opaque_fragment. */
function materialWithForcedOutgoingLight(injectNan: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0x336633 });
  material.customProgramCacheKey = () => `nan-guard-test:outgoing-light:${injectNan}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNanSeed = { value: injectNan ? 0 : 1 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNanSeed;')
      .replace(
        '#include <opaque_fragment>',
        // 0.0 / 0.0 is NaN at runtime (a uniform, so not compile-time folded);
        // 1.0 / 1.0 - 1.0 is exactly 0.0.
        'outgoingLight = vec3(uNanSeed / uNanSeed - 1.0);\n#include <opaque_fragment>',
      );
  };
  material.needsUpdate = true;
  return material;
}

/**
 * A transparent material whose fragment shader overwrites diffuseColor.a
 * right before opaque_fragment. Blending is explicitly off: with it on
 * (three's default for a transparent material), NormalBlending's alpha
 * factors combine src.a with the render target's clear alpha (1.0 by
 * default) as src.a + dst.a*(1 - src.a), which washes a scrubbed src.a=0
 * back out to 1 regardless of what the fragment shader wrote. Disabling
 * blending makes the readback the raw fragment output, unblended.
 */
function materialWithForcedAlpha(injectNan: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0x336633,
    transparent: true,
    blending: THREE.NoBlending,
  });
  material.customProgramCacheKey = () => `nan-guard-test:alpha:${injectNan}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNanSeed = { value: injectNan ? 0 : 1 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNanSeed;')
      .replace(
        '#include <opaque_fragment>',
        'diffuseColor.a = uNanSeed / uNanSeed - 1.0;\n#include <opaque_fragment>',
      );
  };
  material.needsUpdate = true;
  return material;
}

/** Render `material` on a large lit cube and read the frame back through a real render target. */
function renderAndRead(material: THREE.Material, withFog: boolean): Uint8Array {
  const scene = new THREE.Scene();
  if (withFog) scene.fog = new THREE.Fog(0x223344, FOG_NEAR, FOG_FAR);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 4, 5);
  scene.add(sun);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), material));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, withFog ? FOGGED_CAMERA_Z : 6);
  camera.lookAt(0, 0, 0);

  const size = 32;
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, camera);
  const out = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, out);
  renderer.setRenderTarget(prev);
  rt.dispose();
  return out;
}

function centerPixelIsLit(pixels: Uint8Array, size: number): boolean {
  const i = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
  return pixels[i] > 0 || pixels[i + 1] > 0 || pixels[i + 2] > 0;
}

/**
 * Same render, but into a FloatType target read back as raw float bytes
 * instead of through the UNSIGNED_BYTE backbuffer path. This is deliberate:
 * an UNSIGNED_BYTE framebuffer write on THIS sandbox's software driver
 * already converts NaN to 0 on its own (empirically confirmed: the byte
 * readback tests below still passed with the guard's scrub statements
 * replaced by a no-op comment). That is fine evidence for the compile tests
 * above, but it makes a byte-readback comparison a vacuous test of the GUARD
 * specifically: it would pass whether or not the guard's own scrub code ran.
 * A float target preserves whatever value the shader actually wrote, so
 * NaN-in equals NaN-out unless the inserted GLSL scrub runs.
 */
function renderAndReadFloat(material: THREE.Material, withFog: boolean): Float32Array {
  const scene = new THREE.Scene();
  if (withFog) scene.fog = new THREE.Fog(0x223344, FOG_NEAR, FOG_FAR);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(3, 4, 5);
  scene.add(sun);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), material));

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, withFog ? FOGGED_CAMERA_Z : 6);
  camera.lookAt(0, 0, 0);

  const size = 4;
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, type: THREE.FloatType });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, camera);
  const out = new Float32Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, out);
  renderer.setRenderTarget(prev);
  rt.dispose();
  return out;
}

function centerTexel(pixels: Float32Array, size: number): [number, number, number, number] {
  const i = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

describe('final color NaN guard compiles and renders in real WebGL', () => {
  it('compiles and renders a fogged MeshLambertMaterial with no shader error', () => {
    const material = new THREE.MeshLambertMaterial({ color: 0x4a7f4a, fog: true });
    const pixels = renderAndRead(material, true);
    expect(shaderError).toBeNull();
    expect(renderer.getContext().getError()).toBe(0);
    expect(centerPixelIsLit(pixels, 32)).toBe(true);
  });

  it('compiles and renders an unfogged MeshStandardMaterial with no shader error', () => {
    const material = new THREE.MeshStandardMaterial({ color: 0x4a7f4a });
    const pixels = renderAndRead(material, false);
    expect(shaderError).toBeNull();
    expect(renderer.getContext().getError()).toBe(0);
    expect(centerPixelIsLit(pixels, 32)).toBe(true);
  });
});

describe('final color NaN guard actually scrubs a NaN (not just compiles)', () => {
  it('an unfogged NaN in outgoingLight comes out as a finite 0, not NaN (opaque_fragment guard)', () => {
    const pixels = renderAndReadFloat(materialWithForcedOutgoingLight(true), false);
    expect(shaderError).toBeNull();
    const [r, g, b] = centerTexel(pixels, 4);
    expect(Number.isNaN(r)).toBe(false);
    expect(Number.isNaN(g)).toBe(false);
    expect(Number.isNaN(b)).toBe(false);
    expect([r, g, b]).toEqual([0, 0, 0]);
  });

  it('a fogged NaN in outgoingLight mixes like finite 0 after the opaque_fragment guard', () => {
    const pixels = renderAndReadFloat(materialWithForcedOutgoingLight(true), true);
    expect(shaderError).toBeNull();
    const [r, g, b] = centerTexel(pixels, 4);
    expect(Number.isNaN(r)).toBe(false);
    expect(Number.isNaN(g)).toBe(false);
    expect(Number.isNaN(b)).toBe(false);
    // The sampled center fragment is past fogNear, so this readback reds the
    // old path: mix(NaN, fogColor, f) reached the fog scrub and collapsed to
    // black instead of the same fogged finite 0 baseline.
    expect(smoothstep(FOG_NEAR, FOG_FAR, FOGGED_CAMERA_Z - CUBE_FRONT_Z)).toBeGreaterThan(0);
    const fogged = renderAndReadFloat(materialWithForcedOutgoingLight(false), true);
    const baseline = centerTexel(fogged, 4).slice(0, 3);
    expect(baseline.some((component) => component > 0)).toBe(true);
    expect([r, g, b]).toEqual(baseline);
  });

  it('a NaN in diffuseColor.a on a transparent material comes out as a finite 0, not NaN', () => {
    const pixels = renderAndReadFloat(materialWithForcedAlpha(true), false);
    expect(shaderError).toBeNull();
    const [, , , a] = centerTexel(pixels, 4);
    expect(Number.isNaN(a)).toBe(false);
    expect(a).toBe(0);
  });
});
