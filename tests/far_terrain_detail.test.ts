// The vista mesh's surface detail: the reason a distant mountain can read as
// rock instead of as a smooth shell.
//
// The near terrain is a photo splat with a macro normal. The vista tiles carried
// one flat baked colour per vertex and nothing else, so the two never looked like
// the same material, and a mountain straddling the detail horizon came out half
// textured rock and half smooth skin, with the seam reading as something laid
// over the real shape. No horizon distance fixes that; it only moves the seam.
//
// This suite exists because the fix is an onBeforeCompile patch, and a broken one
// fails SILENTLY: three compiles shaders in parallel and a GLSL error on this
// path surfaces as a black or untouched surface, never as a thrown error. So the
// three things that would break it are pinned against the REAL pinned three
// release: the chunk order the patch depends on, the uniforms it reads being
// declared where it reads them, and the sample being taken once before the
// shading normal is resolved rather than twice.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FAR_DETAIL_GRAIN,
  FAR_DETAIL_NORMAL,
  FAR_DETAIL_YARDS,
} from '../src/render/far_terrain_core';

const SRC = readFileSync(new URL('../src/render/far_terrain.ts', import.meta.url), 'utf8');
const FRAG = THREE.ShaderLib.physical.fragmentShader;

describe('the pinned three release still supports the patch', () => {
  it('resolves albedo BEFORE the shading normal, which the shared sample relies on', () => {
    // The detail texture is fetched once in the <color_fragment> patch and reused
    // by the <normal_fragment_begin> patch. If three ever reorders those chunks,
    // the normal patch references an undeclared identifier and the whole material
    // silently stops drawing.
    const colour = FRAG.indexOf('#include <color_fragment>');
    const normal = FRAG.indexOf('#include <normal_fragment_begin>');
    expect(colour).toBeGreaterThan(-1);
    expect(normal).toBeGreaterThan(-1);
    expect(colour).toBeLessThan(normal);
  });

  it('declares viewMatrix in the FRAGMENT stage, which the world-space tilt needs', () => {
    // The perturbation is authored in world space and rotated into view space.
    // three puts viewMatrix in the fragment prefix rather than the shader body,
    // so assert it against the prefix builder the renderer actually uses.
    const prefix = readFileSync(
      new URL('../node_modules/three/src/renderers/webgl/WebGLProgram.js', import.meta.url),
      'utf8',
    );
    const fragmentPrefix = prefix.slice(prefix.indexOf('prefixFragment'));
    expect(fragmentPrefix).toContain('uniform mat4 viewMatrix;');
  });
});

describe('the spliced detail', () => {
  it('samples at WORLD scale from the tiles own varying, needing no uv attribute', () => {
    // The tiles carry position, normal, colour and a grass weight. There is no uv
    // attribute and there must not need to be one.
    expect(SRC).toContain('texture2D(uFarDetail, vFarXZ *');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal shader template source.
    expect(SRC).toContain('${(1 / FAR_DETAIL_YARDS).toFixed(6)}');
    expect(SRC).not.toContain('uFarDetail, vUv');
  });

  it('fetches the texture ONCE and reuses it for the normal', () => {
    expect(SRC.split('texture2D(uFarDetail').length - 1).toBe(1);
    const declare = SRC.indexOf('vec3 wocFarRN = texture2D(uFarDetail');
    const reuse = SRC.indexOf('vec4(wocFarRN.x, 0.0, wocFarRN.y, 0.0)');
    expect(declare).toBeGreaterThan(0);
    expect(reuse).toBeGreaterThan(declare);
  });

  it('tilts the shading normal, not only the colour', () => {
    // Albedo variation alone leaves coarse flat-shaded triangles each taking one
    // light value, which is what reads as plastic at range.
    expect(SRC).toContain('normal = normalize(normal + (viewMatrix');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal shader template source.
    expect(SRC).toContain('${FAR_DETAIL_NORMAL.toFixed(4)} * uFarDetailAmt');
  });

  it('interpolates the shipped constants rather than hand-typed numbers', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal shader template source.
    expect(SRC).toContain('${(1 - FAR_DETAIL_GRAIN).toFixed(4)}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this pins literal shader template source.
    expect(SRC).toContain('${(1 + FAR_DETAIL_GRAIN).toFixed(4)}');
  });

  it('skips the meadow ground tap where the vertex grass weight is zero', () => {
    // Same <color_fragment> patch, and the one place on this layer where a
    // texture fetch can be skipped with a PIXEL-IDENTICAL result: at vGrassW 0
    // the mix collapses to vec3(1.0). The vista's zero-weight ground (rock
    // past the slope threshold, full shore band) is a large share of the
    // layer's pixels, so the gate has to be a real branch rather than the
    // multiply-by-zero it replaced.
    const gate = SRC.indexOf('if (vGrassW > 0.0) {');
    expect(gate).toBeGreaterThan(0);
    expect(SRC.indexOf('texture2D(uGrassBake')).toBeGreaterThan(gate);
  });

  it('keeps the grain gentle enough that the zone colour recipe still reads', () => {
    // The vista's whole job is showing which realm the distant land belongs to.
    expect(FAR_DETAIL_GRAIN).toBeGreaterThan(0);
    expect(FAR_DETAIL_GRAIN).toBeLessThanOrEqual(0.25);
    // and the tilt has to be strong enough to actually break the shading up
    expect(FAR_DETAIL_NORMAL).toBeGreaterThan(0.25);
    expect(FAR_DETAIL_NORMAL).toBeLessThan(1);
    // bedding-scale, not noise-scale
    expect(FAR_DETAIL_YARDS).toBeGreaterThanOrEqual(6);
    expect(FAR_DETAIL_YARDS).toBeLessThanOrEqual(24);
  });
});

describe('the deferred-preload guard', () => {
  it('gates on an amount, so a null sampler can never read as a constant tilt', () => {
    // The rock normal lands on a deferred preload and can be null when this
    // material compiles. three binds a WHITE placeholder for a null sampler,
    // which decodes to (1,1,1) and would tilt every fragment in the world the
    // same way. The amount stays 0 until the texture is adopted.
    expect(SRC).toContain('const farDetailAmt = { value: 0 };');
    expect(SRC).toContain('farDetailAmt.value = 1;');
    const adopt = SRC.indexOf('const tex = stoneDetailNormal();');
    expect(adopt).toBeGreaterThan(0);
    expect(SRC.slice(adopt, adopt + 240)).toContain('farDetail.value = tex;');
    // both shader consumers scale by it, so amount 0 is byte-identical output
    expect(SRC.split('uFarDetailAmt').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('decides the ARM at compile time, so a tier without the texture is unchanged', () => {
    // detail_normals only registers the preload on the standard-material tiers,
    // so on any other tier the texture never arrives; the arm must be excluded
    // from the program entirely rather than sampling a placeholder forever.
    expect(SRC).toContain(
      "const detailArm = GFX.standardMaterials && !renderLayerDisabled('fardetail')",
    );
    expect(SRC).toContain('if (detailArm) {');
  });

  it('adopts the texture once rather than re-reading it every frame', () => {
    expect(SRC).toContain('if (detailArm && farDetail.value === null) {');
  });

  it('is documented as a dev A/B switch alongside the other layer flags', () => {
    const flags = readFileSync(
      new URL('../src/render/render_dev_flags.ts', import.meta.url),
      'utf8',
    );
    expect(flags).toContain('fardetail');
  });
});
