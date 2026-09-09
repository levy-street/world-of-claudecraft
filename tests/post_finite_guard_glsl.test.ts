import { describe, expect, it } from 'vitest';
import { FINITE_GUARD_GLSL, finiteGuardStatement } from '../src/render/post_finite_guard_glsl';

// The mask the snippet hard-codes, evaluated here in JavaScript over real IEEE
// bit patterns: a wrong constant would otherwise only be caught by the
// exact-string pins, which a careless edit updates in lockstep.
const EXPONENT_MASK = 0x7f800000;

function nonFinite(value: number): boolean {
  const bits = new Uint32Array(new Float32Array([value]).buffer)[0];
  return (bits & EXPONENT_MASK) >>> 0 === EXPONENT_MASK;
}

describe('post_finite_guard_glsl', () => {
  it('flags exactly NaN and the two infinities under the exponent-bits rule', () => {
    expect(nonFinite(Number.NaN)).toBe(true);
    expect(nonFinite(Number.POSITIVE_INFINITY)).toBe(true);
    expect(nonFinite(Number.NEGATIVE_INFINITY)).toBe(true);
    // Every finite float, including the largest, half-float overflow
    // candidates, zeros, and a denormal, keeps at least one exponent bit clear.
    for (const finite of [0, -0, 1, -1, 65504, 65520, 3.4028234663852886e38, 1e-45, -1e-40]) {
      expect(nonFinite(finite), String(finite)).toBe(false);
    }
  });

  it('qualifies every integer highp so a highp-float-only host cannot truncate the mask', () => {
    // GLSL ES 3.00 fragment shaders predeclare mediump int, which may be 16
    // bits wide: 0x7f800000 would truncate to zero and flag every texel.
    expect(FINITE_GUARD_GLSL).toContain('bvec4 wocNonFinite(highp vec4 v)');
    expect(FINITE_GUARD_GLSL).toContain(
      'highp uvec4 exponentBits = floatBitsToUint(v) & uvec4(0x7f800000u);',
    );
    expect(FINITE_GUARD_GLSL).toContain('return equal(exponentBits, uvec4(0x7f800000u));');
    expect(FINITE_GUARD_GLSL).toContain('vec4 wocSanitizeFinite4(highp vec4 v)');
    expect(FINITE_GUARD_GLSL).toContain('vec3 wocSanitizeFinite(highp vec3 v)');
    // No integer declaration without the qualifier.
    expect(FINITE_GUARD_GLSL).not.toMatch(/(?<!highp )\buvec4\s+\w+\s*=/);
  });

  it('selects, never mixes, and never compares a possibly-NaN value', () => {
    expect(FINITE_GUARD_GLSL).toContain('bad.x ? 0.0 : v.x');
    expect(FINITE_GUARD_GLSL).toContain('bad.w ? 0.0 : v.w');
    expect(FINITE_GUARD_GLSL).not.toMatch(/mix\s*\(/);
    expect(FINITE_GUARD_GLSL).not.toMatch(/isnan|isinf|<\s*0\.0\s*\|\||>=\s*0\.0/);
  });

  it('emits the same rule as one statement for chunk splices inside main()', () => {
    expect(finiteGuardStatement('outgoingLight.x')).toBe(
      'outgoingLight.x = ( ( floatBitsToUint( outgoingLight.x ) & 0x7f800000u ) == 0x7f800000u ) ? 0.0 : outgoingLight.x;\n',
    );
  });
});
