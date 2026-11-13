// Clarity (src/render/clarity_core.ts, post_clarity_glsl.ts): an unsharp mask the output
// grade compiles in. These pin the session settings, the shader arm's shape, and that the
// grade pass only pays for it where it is asked for.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CLARITY_DEFAULTS, clarityForGrade, clarityFromQuery } from '../src/render/clarity_core';
import {
  CLARITY_GLSL,
  CLARITY_INNER_RING,
  CLARITY_OUTER_RING,
  CLARITY_WEIGHTS,
} from '../src/render/post_clarity_glsl';
import { OUTPUT_GRADE_FRAGMENT_SHADER, OutputGradePass } from '../src/render/post_output_grade';

describe('clarity settings from the query', () => {
  it('is on by default at the tuned look', () => {
    expect(CLARITY_DEFAULTS).toEqual({ amount: 1.4, radius: 5 / 720, limit: 0.16 });
    expect(clarityFromQuery('')).toEqual(CLARITY_DEFAULTS);
    expect(clarityFromQuery('?gfx=ultra&governor=0')).toEqual(CLARITY_DEFAULTS);
  });

  it('turns off with clarity=off, clarity=0, or a zero strength', () => {
    expect(clarityFromQuery('?clarity=off')).toBeNull();
    expect(clarityFromQuery('?clarity=0')).toBeNull();
    expect(clarityFromQuery('?clarity=0.0')).toBeNull();
  });

  it('reads strength, radius (pixels of a 720-high picture) and limit, each clamped', () => {
    // (every value off the default, so a parser that fell back would show)
    expect(clarityFromQuery('?clarity=1.7&clarityr=7&claritylimit=0.3')).toEqual({
      amount: 1.7,
      radius: 7 / 720,
      limit: 0.3,
    });
    expect(clarityFromQuery('?clarity=99')?.amount).toBe(3);
    expect(clarityFromQuery('?clarityr=0.1')?.radius).toBeCloseTo(0.5 / 720, 12);
    expect(clarityFromQuery('?clarityr=400')?.radius).toBeCloseTo(16 / 720, 12);
    expect(clarityFromQuery('?claritylimit=7')?.limit).toBe(1);
    // garbage falls back to the default rather than switching the look off
    expect(clarityFromQuery('?clarity=abc')).toEqual(CLARITY_DEFAULTS);
  });
});

describe('which grade carries clarity', () => {
  it('rides only a standard-material tier whose edge AA is the tail pass', () => {
    const on = { standardMaterials: true, gradeFxaa: false };
    expect(clarityForGrade(CLARITY_DEFAULTS, on)).toBe(CLARITY_DEFAULTS);
    // a grade that fuses its own FXAA: the taps would read the picture from before that AA
    expect(
      clarityForGrade(CLARITY_DEFAULTS, { standardMaterials: true, gradeFxaa: true }),
    ).toBeNull();
    // Low keeps its lean grade
    expect(
      clarityForGrade(CLARITY_DEFAULTS, { standardMaterials: false, gradeFxaa: false }),
    ).toBeNull();
    // and a session that turned it off has none anywhere
    expect(clarityForGrade(null, on)).toBeNull();
  });

  it('is built into the main grade and never into the shed twin', () => {
    const post = readFileSync(new URL('../src/render/post.ts', import.meta.url), 'utf8');
    expect(post).toContain(
      '{ fxaa: plan.gradeFxaa, celInk, clarity, paletteGrade: paletteLabEnabled() }',
    );
    // shedding SMAA for the twin sheds clarity with it: the render budget's lever
    expect(post).toContain('{ fxaa: true, celInk, paletteGrade: paletteLabEnabled() }');
    expect(post).toContain('gradeFxaa: plan.gradeFxaa,');
  });
});

describe('clarity arm of the output grade', () => {
  it('weights two rings and the centre as one mean', () => {
    const total = CLARITY_WEIGHTS.centre + 4 * CLARITY_WEIGHTS.inner + 4 * CLARITY_WEIGHTS.outer;
    expect(total).toBeCloseTo(1, 10);
    expect(CLARITY_INNER_RING).toBeLessThan(1);
    expect(CLARITY_OUTER_RING).toBeGreaterThan(1);
    expect(CLARITY_GLSL.match(/clarityTap\(uv, /g)).toHaveLength(8);
  });

  it('pushes the pixel from the mean, clamped, and never below black', () => {
    expect(CLARITY_GLSL).toContain(
      'vec3 detail = clamp(displayM - mean, vec3(-uClarity.y), vec3(uClarity.y));',
    );
    expect(CLARITY_GLSL).toContain('return max(displayM + uClarity.x * detail, vec3(0.0));');
  });

  it('clamps every tap into the rendered sub-rect and sizes the radius by the rendered height', () => {
    expect(CLARITY_GLSL).toContain('displayColor(clamp(uv + o, vec2(0.0), uvMax)).rgb');
    expect(CLARITY_GLSL).toContain(
      'vec2 r = uClarity.z * uInputUvRect.y * vec2(uInputTexelSize.x / uInputTexelSize.y, 1.0);',
    );
  });

  it('compiles only under CLARITY_GRADE, after the edge AA and before the grade', () => {
    const shader = OUTPUT_GRADE_FRAGMENT_SHADER;
    expect(shader).toContain(`#ifdef CLARITY_GRADE\n  ${CLARITY_GLSL}\n  #endif`);
    const fxaaAt = shader.indexOf('outputColor.rgb = fxaaFilter(inputUv, outputColor.rgb);');
    const clarityAt = shader.indexOf(
      'outputColor.rgb = clarityApply(outputColor.rgb, inputUv, uInputUvRect.zw);',
    );
    const gradeAt = shader.indexOf('vec3 c = quantizeHalf(outputColor.rgb);');
    expect(fxaaAt).toBeGreaterThan(0);
    expect(clarityAt).toBeGreaterThan(fxaaAt);
    expect(gradeAt).toBeGreaterThan(clarityAt);
    expect(shader.lastIndexOf('#ifdef CLARITY_GRADE', clarityAt)).toBeGreaterThan(fxaaAt);
    // the arm is defined after displayColor, which every tap calls
    expect(shader.indexOf('uniform vec3 uClarity;')).toBeGreaterThan(
      shader.indexOf('return outputColor;'),
    );
  });

  it('defines CLARITY_GRADE and feeds its knobs and texel size only when asked', () => {
    const renderer = {
      outputColorSpace: THREE.SRGBColorSpace,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1,
      setRenderTarget: vi.fn(),
      getPixelRatio: () => 1,
    } as unknown as THREE.WebGLRenderer;
    const read = new THREE.WebGLRenderTarget(1280, 720);
    const write = new THREE.WebGLRenderTarget(1280, 720);

    const stock = new OutputGradePass({ value: 0 });
    stock.fsQuad.render = vi.fn();
    stock.render(renderer, write, read);
    expect(stock.material.defines.CLARITY_GRADE).toBeUndefined();
    expect(stock.uniforms.uClarity.value.toArray()).toEqual([0, 0, 0]);
    expect(stock.uniforms.uInputTexelSize.value.toArray()).toEqual([0, 0]);

    const clear = new OutputGradePass({ value: 0 }, null, {
      clarity: { amount: 0.8, radius: 4 / 720, limit: 0.22 },
    });
    clear.fsQuad.render = vi.fn();
    clear.render(renderer, write, read);
    expect(clear.material.defines.CLARITY_GRADE).toBe('');
    expect(clear.material.defines.FXAA_GRADE).toBeUndefined();
    expect(clear.uniforms.uClarity.value.x).toBeCloseTo(0.8, 6);
    expect(clear.uniforms.uClarity.value.y).toBeCloseTo(0.22, 6);
    expect(clear.uniforms.uClarity.value.z).toBeCloseTo(4 / 720, 9);
    // the radius is squared up by the texel aspect: the size must be fed without FXAA
    expect(clear.uniforms.uInputTexelSize.value.x).toBeCloseTo(1 / 1280, 9);
    expect(clear.uniforms.uInputTexelSize.value.y).toBeCloseTo(1 / 720, 9);
  });
});
