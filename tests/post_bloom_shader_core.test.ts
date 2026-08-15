import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { describe, expect, it } from 'vitest';
import { removeUnrealBloomTintMultipliers } from '../src/render/post_bloom_shader_core';

const NUM_MIPS = 5;
// The real composite shader from the installed three, not a hand-written stand
// in. getCompositeMaterial does not read `this` and builds no GL resources, so
// a Node test can read the pinned source directly.
const INSTALLED_COMPOSITE: string = (
  UnrealBloomPass.prototype as unknown as {
    getCompositeMaterial(nMips: number): { fragmentShader: string };
  }
).getCompositeMaterial(NUM_MIPS).fragmentShader;

// Every mip factor still multiplies its own blurred sample, whitespace aside.
const FACTOR_TIMES_SAMPLE =
  /lerpBloomFactor\s*\(\s*bloomFactors\s*\[\s*\d\s*\]\s*\)\s*\*\s*texture2D\s*\(\s*blurTexture[1-5]\s*,/g;

// The composite body three ships from r182 onward, pinned verbatim. It scales
// the mip sum by 3.0 and derives alpha from max(bloom.rgb), so it is not a
// drop-in for a consumer that adds bloom.rgb * bloom.a.
const R182_COMPOSITE = `
  uniform float bloomFactors[NUM_MIPS];
  uniform vec3 bloomTintColors[NUM_MIPS];

  void main() {

    // 3.0 for backwards compatibility with previous alpha-based intensity
    vec3 bloom = 3.0 * bloomStrength * (
      lerpBloomFactor( bloomFactors[ 0 ] ) * bloomTintColors[ 0 ] * texture2D( blurTexture1, vUv ).rgb +
      lerpBloomFactor( bloomFactors[ 1 ] ) * bloomTintColors[ 1 ] * texture2D( blurTexture2, vUv ).rgb +
      lerpBloomFactor( bloomFactors[ 2 ] ) * bloomTintColors[ 2 ] * texture2D( blurTexture3, vUv ).rgb +
      lerpBloomFactor( bloomFactors[ 3 ] ) * bloomTintColors[ 3 ] * texture2D( blurTexture4, vUv ).rgb +
      lerpBloomFactor( bloomFactors[ 4 ] ) * bloomTintColors[ 4 ] * texture2D( blurTexture5, vUv ).rgb
    );

    float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );
    gl_FragColor = vec4( bloom, bloomAlpha );

  }
`;

describe('removeUnrealBloomTintMultipliers', () => {
  it('strips every identity tint term from the installed three composite shader', () => {
    const patched = removeUnrealBloomTintMultipliers(INSTALLED_COMPOSITE, NUM_MIPS);

    expect(INSTALLED_COMPOSITE).toContain('bloomTintColors');
    expect(patched).not.toContain('bloomTintColors');
    expect(patched.match(FACTOR_TIMES_SAMPLE)).toHaveLength(NUM_MIPS);
    expect(patched).toContain('bloomStrength * (');
  });

  it('tolerates whitespace inside the pinned tint term', () => {
    const respaced = INSTALLED_COMPOSITE.replace(
      /vec4\(bloomTintColors\[(\d)\], 1\.0\)/g,
      'vec4( bloomTintColors[ $1 ] , 1.0 )',
    );
    expect(respaced).not.toEqual(INSTALLED_COMPOSITE);

    const patched = removeUnrealBloomTintMultipliers(respaced, NUM_MIPS);

    expect(patched).not.toContain('bloomTintColors');
    expect(patched.match(FACTOR_TIMES_SAMPLE)).toHaveLength(NUM_MIPS);
  });

  it('fails closed on the r182 composite rewrite instead of stripping its tint terms', () => {
    expect(() => removeUnrealBloomTintMultipliers(R182_COMPOSITE, NUM_MIPS)).toThrow(
      /UnrealBloom composite rewritten \(three r182 and later\)/,
    );
    expect(() => removeUnrealBloomTintMultipliers(R182_COMPOSITE, NUM_MIPS)).toThrow(
      /bloom\.rgb \* bloom\.a/,
    );
  });

  it('fails closed when the tint uniform declaration is absent', () => {
    const withoutUniform = INSTALLED_COMPOSITE.replace(
      'uniform vec3 bloomTintColors[NUM_MIPS];',
      '',
    );

    expect(() => removeUnrealBloomTintMultipliers(withoutUniform, NUM_MIPS)).toThrow(
      'Pinned UnrealBloom composite tint shader shape changed (tint uniform declaration)',
    );
  });

  it('fails closed when an expected tint term is absent', () => {
    expect(() =>
      removeUnrealBloomTintMultipliers('uniform vec3 bloomTintColors[NUM_MIPS];', 1),
    ).toThrow('Pinned UnrealBloom composite tint shader shape changed (mip 0)');
  });
});
