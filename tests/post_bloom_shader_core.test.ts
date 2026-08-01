import { describe, expect, it } from 'vitest';
import { removeUnrealBloomTintMultipliers } from '../src/render/post_bloom_shader_core';

const LEGACY_SHADER = `
uniform vec3 bloomTintColors[NUM_MIPS];
vec3 bloom =
  lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
  lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv);
`;

const CURRENT_SHADER = `
uniform vec3 bloomTintColors[NUM_MIPS];
vec3 bloom =
  lerpBloomFactor( bloomFactors[ 0 ] ) * bloomTintColors[ 0 ] * texture2D( blurTexture1, vUv ).rgb +
  lerpBloomFactor( bloomFactors[ 1 ] ) * bloomTintColors[ 1 ] * texture2D( blurTexture2, vUv ).rgb;
`;

describe('removeUnrealBloomTintMultipliers', () => {
  it('removes the legacy vec4 tint terms', () => {
    const patched = removeUnrealBloomTintMultipliers(LEGACY_SHADER, 2);

    expect(patched).not.toContain('bloomTintColors');
    expect(patched).toContain('lerpBloomFactor(bloomFactors[0]) * texture2D(blurTexture1, vUv)');
    expect(patched).toContain('lerpBloomFactor(bloomFactors[1]) * texture2D(blurTexture2, vUv)');
  });

  it('removes the current vec3 tint terms', () => {
    const patched = removeUnrealBloomTintMultipliers(CURRENT_SHADER, 2);

    expect(patched).not.toContain('bloomTintColors');
    expect(patched).toContain(
      'lerpBloomFactor( bloomFactors[ 0 ] ) * texture2D( blurTexture1, vUv ).rgb',
    );
    expect(patched).toContain(
      'lerpBloomFactor( bloomFactors[ 1 ] ) * texture2D( blurTexture2, vUv ).rgb',
    );
  });

  it('fails closed when an expected tint term is absent', () => {
    expect(() =>
      removeUnrealBloomTintMultipliers('uniform vec3 bloomTintColors[NUM_MIPS];', 1),
    ).toThrow('Pinned UnrealBloom composite tint shader shape changed');
  });
});
