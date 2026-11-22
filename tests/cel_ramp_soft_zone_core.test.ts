import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CEL_RAMP_SOFT_GLSL,
  CEL_RAMP_SOFT_UNIFORM,
  CEL_RAMP_SOFT_UNIFORM_NAME,
  celRampSoftZone,
  celSoftRampExpression,
  setCelRampSoftZone,
} from '../src/render/cel_ramp_soft_zone_core';
import {
  CEL_SHADING_DEFAULTS,
  patchCelDirectionalLightChunk,
} from '../src/render/cel_shading_core';

describe('cel ramp softness (zone look arm)', () => {
  afterEach(() => setCelRampSoftZone(0));

  it('starts on the shipped hard band and clamps writes to 0..1', () => {
    expect(celRampSoftZone()).toBe(0);
    setCelRampSoftZone(0.8);
    expect(celRampSoftZone()).toBeCloseTo(0.8, 6);
    setCelRampSoftZone(4);
    expect(celRampSoftZone()).toBe(1);
    setCelRampSoftZone(Number.NaN);
    expect(celRampSoftZone()).toBe(0);
  });

  it('backs the uniform with a typed array, so every material clone shares the write', () => {
    expect(CEL_RAMP_SOFT_UNIFORM.value).toBeInstanceOf(Float32Array);
    setCelRampSoftZone(0.5);
    expect(CEL_RAMP_SOFT_UNIFORM.value[0]).toBe(0.5);
  });

  it('reads .r, never .x: the read lands inside the WOC_CEL_BAND( x ) macro', () => {
    // An .x swizzle inside a macro whose parameter is x is rewritten by the
    // preprocessor ("illegal vector field selection"), and every lit program
    // fails to link. Pin the safe swizzle.
    expect(CEL_RAMP_SOFT_GLSL).toBe(`${CEL_RAMP_SOFT_UNIFORM_NAME}.r`);
    expect(CEL_RAMP_SOFT_GLSL.endsWith('.x')).toBe(false);
  });

  it('blends the band toward the soft falloff only when the option is passed', () => {
    const stock = THREE.ShaderChunk.lights_fragment_begin;
    const hard = patchCelDirectionalLightChunk(stock, CEL_SHADING_DEFAULTS);
    const soft = patchCelDirectionalLightChunk(stock, CEL_SHADING_DEFAULTS, {
      uniform: CEL_RAMP_SOFT_GLSL,
      expression: celSoftRampExpression,
    });
    expect(hard).not.toContain(CEL_RAMP_SOFT_UNIFORM_NAME);
    expect(soft).toContain(`, ${CEL_RAMP_SOFT_GLSL} )`);
    expect(soft).toContain('mix(');
    expect(soft).toContain(celSoftRampExpression('x', '0.9'));
  });
});
