import { Vector2 } from 'three';
import type { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { describe, expect, it } from 'vitest';
import { PreparedBloomPass } from '../src/render/post_bloom';
import { restoreClassicBloomComposite } from '../src/render/post_bloom_shader_core';

const NUM_MIPS = 5;
// The real composite shader from the installed three, not a hand-written stand
// in. _getCompositeMaterial (r185's underscore-private spelling) does not read
// `this` and builds no GL resources, so a Node test can read the pinned source
// directly.
const INSTALLED_COMPOSITE: string = (
  UnrealBloomPass.prototype as unknown as {
    _getCompositeMaterial(nMips: number): { fragmentShader: string };
  }
)._getCompositeMaterial(NUM_MIPS).fragmentShader;

// Every mip factor multiplies its own FULL vec4 blurred sample (no .rgb
// truncation), whitespace aside: the r165-equivalent accumulation whose alpha
// OutputGradePass multiplies back in as bloom.rgb * bloom.a.
const FACTOR_TIMES_SAMPLE =
  /lerpBloomFactor\s*\(\s*bloomFactors\s*\[\s*\d\s*\]\s*\)\s*\*\s*texture2D\s*\(\s*blurTexture[1-5]\s*,\s*vUv\s*\)\s*(?!\.)/g;

// The composite body three shipped BEFORE r182, pinned verbatim from r165:
// full vec4 samples with identity tint multipliers and no 3.0 scale. The
// restore must fail closed on it (a downgrade or a fork would otherwise get
// the classic body spliced over a shape it does not have).
const R165_COMPOSITE = `
  uniform float bloomFactors[NUM_MIPS];
  uniform vec3 bloomTintColors[NUM_MIPS];

  float lerpBloomFactor(const in float factor) {
    float mirrorFactor = 1.2 - factor;
    return mix(factor, mirrorFactor, bloomRadius);
  }

  void main() {
    gl_FragColor = bloomStrength * ( lerpBloomFactor(bloomFactors[0]) * vec4(bloomTintColors[0], 1.0) * texture2D(blurTexture1, vUv) +
      lerpBloomFactor(bloomFactors[1]) * vec4(bloomTintColors[1], 1.0) * texture2D(blurTexture2, vUv) +
      lerpBloomFactor(bloomFactors[2]) * vec4(bloomTintColors[2], 1.0) * texture2D(blurTexture3, vUv) +
      lerpBloomFactor(bloomFactors[3]) * vec4(bloomTintColors[3], 1.0) * texture2D(blurTexture4, vUv) +
      lerpBloomFactor(bloomFactors[4]) * vec4(bloomTintColors[4], 1.0) * texture2D(blurTexture5, vUv) );
  }
`;

describe('restoreClassicBloomComposite', () => {
  it('rebuilds the classic tint-free accumulation from the installed three composite', () => {
    const patched = restoreClassicBloomComposite(INSTALLED_COMPOSITE, NUM_MIPS);

    // The installed r185 shape carries every piece the restore must remove.
    expect(INSTALLED_COMPOSITE).toContain('bloomTintColors');
    expect(INSTALLED_COMPOSITE).toContain('3.0 * bloomStrength');
    expect(INSTALLED_COMPOSITE).toContain('bloomAlpha');

    expect(patched).not.toContain('bloomTintColors');
    expect(patched).not.toContain('3.0 * bloomStrength');
    expect(patched).not.toContain('bloomAlpha');
    expect(patched.match(FACTOR_TIMES_SAMPLE)).toHaveLength(NUM_MIPS);
    expect(patched).toContain('gl_FragColor = bloomStrength * (');
    // The helper the rebuilt body calls must survive the splice.
    expect(patched).toContain('float lerpBloomFactor');
  });

  it('tolerates whitespace inside the pinned shipped terms', () => {
    const respaced = INSTALLED_COMPOSITE.replace(
      /bloomTintColors\[ (\d) \]/g,
      'bloomTintColors[$1]',
    ).replace(/texture2D\( (blurTexture\d), vUv \)/g, 'texture2D($1 , vUv )');
    expect(respaced).not.toEqual(INSTALLED_COMPOSITE);

    const patched = restoreClassicBloomComposite(respaced, NUM_MIPS);

    expect(patched).not.toContain('bloomTintColors');
    expect(patched.match(FACTOR_TIMES_SAMPLE)).toHaveLength(NUM_MIPS);
  });

  it('fails closed on the pre-r182 composite instead of splicing over it', () => {
    expect(() => restoreClassicBloomComposite(R165_COMPOSITE, NUM_MIPS)).toThrow(
      'Pinned UnrealBloom composite shader shape changed (composite main body)',
    );
  });

  it('fails closed when the tint uniform declaration is absent', () => {
    const withoutUniform = INSTALLED_COMPOSITE.replace(
      'uniform vec3 bloomTintColors[NUM_MIPS];',
      '',
    );

    expect(() => restoreClassicBloomComposite(withoutUniform, NUM_MIPS)).toThrow(
      'Pinned UnrealBloom composite shader shape changed (tint uniform declaration)',
    );
  });

  it('fails closed when a shipped mip term is missing', () => {
    const truncated = INSTALLED_COMPOSITE.replace(
      /lerpBloomFactor\( bloomFactors\[ 3 \] \) \* bloomTintColors\[ 3 \] \* texture2D\( blurTexture4, vUv \)\.rgb \+\s*/,
      '',
    );
    expect(truncated).not.toEqual(INSTALLED_COMPOSITE);

    expect(() => restoreClassicBloomComposite(truncated, NUM_MIPS)).toThrow(
      'Pinned UnrealBloom composite shader shape changed (composite main body)',
    );
  });

  it('fails closed when the alpha derivation changes', () => {
    const changedAlpha = INSTALLED_COMPOSITE.replace(
      'float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );',
      'float bloomAlpha = 1.0;',
    );
    expect(changedAlpha).not.toEqual(INSTALLED_COMPOSITE);

    expect(() => restoreClassicBloomComposite(changedAlpha, NUM_MIPS)).toThrow(
      'Pinned UnrealBloom composite shader shape changed (composite main body)',
    );
  });

  it('pins the installed lerpBloomFactor helper body to the r165 literal', () => {
    // The rebuilt main() calls the INSTALLED helper verbatim (the restore
    // splices main() only), so the fail-closed story needs the helper body
    // pinned too: a future three changing the 1.2 mirror constant or the mix
    // would silently re-grade every bloom mip while the composite pin stayed
    // green.
    const stripWs = (s: string): string => s.replace(/\s+/g, '');
    const restored = restoreClassicBloomComposite(INSTALLED_COMPOSITE, NUM_MIPS);
    const helperStart = restored.indexOf('float lerpBloomFactor');
    expect(helperStart).toBeGreaterThan(-1);
    const helperEnd = restored.indexOf('}', helperStart);
    const helper = restored.slice(helperStart, helperEnd + 1);
    expect(stripWs(helper)).toBe(
      stripWs(`float lerpBloomFactor(const in float factor) {
        float mirrorFactor = 1.2 - factor;
        return mix(factor, mirrorFactor, bloomRadius);
      }`),
    );
  });

  it('rebuilds main() equal to the r165 shape with its tint terms stripped', () => {
    // The migration claim is an IDENTICAL COMPOSITE STAGE across the 0.165 to
    // 0.185 train (the blur mips and bright-pass weights feeding it moved
    // upstream, an accepted r181-bucket visual delta): the pre-upgrade
    // renderer shipped r165's composite with the identity tint multipliers
    // removed, so the restored body must equal exactly that, whitespace aside.
    const stripWs = (s: string): string => s.replace(/\s+/g, '');
    const mainOf = (s: string): string => {
      const start = s.indexOf('void main()');
      expect(start).toBeGreaterThan(-1);
      return s.slice(start, s.lastIndexOf('}') + 1);
    };
    const preUpgradeShipped = R165_COMPOSITE.replace(
      /\s*\*\s*vec4\(bloomTintColors\[\d\], 1\.0\)/g,
      '',
    );
    expect(preUpgradeShipped).not.toEqual(R165_COMPOSITE);

    const restored = restoreClassicBloomComposite(INSTALLED_COMPOSITE, NUM_MIPS);
    expect(stripWs(mainOf(restored))).toBe(stripWs(mainOf(preUpgradeShipped)));
  });
});

describe('PreparedBloomPass internals against the installed three', () => {
  it('resolves the r185 _fsQuad handle and builds the tint-free composite', () => {
    // The render() override drives every quad draw through the pass's
    // underscore-private _fsQuad; a future rename would otherwise surface
    // only as a TypeError on the first bloom frame of high and above.
    const pass = new PreparedBloomPass(new Vector2(64, 64), 0.4, 0.6, 1.32);
    const quad = (pass as unknown as { _fsQuad: FullScreenQuad })._fsQuad;
    expect(quad).toBeDefined();
    expect(typeof quad.render).toBe('function');
    expect('material' in quad).toBe(true);

    expect(pass.bloomTexture).toBe(pass.renderTargetsHorizontal[0].texture);
    expect(pass.compositeMaterial.fragmentShader).not.toContain('bloomTintColors');
    expect(pass.compositeMaterial.uniforms.bloomTintColors).toBeUndefined();
    pass.dispose();
  });

  it('constructs with the r165 bloomFactors mip weights', () => {
    // The composite pin fixes the shader TEXT; the mip weights live in a JS
    // uniform default upstream owns. A future three re-weighting them would
    // re-grade bloom under a green text pin, so pin the values themselves.
    const pass = new PreparedBloomPass(new Vector2(64, 64), 0.4, 0.6, 1.32);
    expect(pass.compositeMaterial.uniforms.bloomFactors.value).toEqual([1.0, 0.8, 0.6, 0.4, 0.2]);
    pass.dispose();
  });

  it('drives every quad draw through the production _fsQuad read, ending on the composite', () => {
    // Executed smoke for the render() override's own `_fsQuad` access: the
    // suite's other arm reads the handle from the outside, which stays green
    // if a coherent three rename changes both the base pass field and this
    // pass's read expectations. Driving render() through a stubbed renderer
    // executes the real cast-based read and the real draw sequence.
    const pass = new PreparedBloomPass(new Vector2(64, 64), 0.4, 0.6, 1.32);
    const quad = (pass as unknown as { _fsQuad: FullScreenQuad })._fsQuad;
    const draws: { target: unknown; material: unknown }[] = [];
    let currentTarget: unknown = null;
    const stub = {
      autoClear: true,
      state: { buffers: { stencil: { setTest: () => {} } } },
      setRenderTarget(target: unknown) {
        currentTarget = target;
      },
      render() {
        draws.push({ target: currentTarget, material: quad.material });
      },
    };
    const readBuffer = { texture: { isTexture: true } };
    pass.render(stub as never, undefined as never, readBuffer as never);
    // 1 high-pass + 2 blur draws per mip + 1 composite.
    expect(draws).toHaveLength(2 + 2 * pass.nMips);
    expect(draws[0]?.material).toBe(pass.materialHighPassFilter);
    const last = draws[draws.length - 1];
    expect(last?.material).toBe(pass.compositeMaterial);
    expect(last?.target).toBe(pass.renderTargetsHorizontal[0]);
    // render() restores the renderer's autoClear after the pass.
    expect(stub.autoClear).toBe(true);
    pass.dispose();
  });
});
