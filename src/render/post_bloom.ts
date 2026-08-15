import { type Texture, Vector2, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { restoreClassicBloomComposite } from './post_bloom_shader_core';

const BLUR_X = new Vector2(1, 0);
const BLUR_Y = new Vector2(0, 1);

interface TextureUniform {
  value: Texture | null;
}

interface NumberUniform {
  value: number;
}

interface BloomHighPassUniforms {
  tDiffuse: TextureUniform;
  luminosityThreshold: NumberUniform;
}

interface RendererStencilState {
  state: {
    buffers: {
      stencil: {
        setTest(enabled: boolean): void;
      };
    };
  };
}

// r185 renamed the pass's full-screen quad to the underscore-private _fsQuad
// and @types/three stopped declaring it; the draw sequence below still owns
// every quad render, so reach it through one typed view.
interface BloomPassInternals {
  _fsQuad: FullScreenQuad;
}

/**
 * Builds UnrealBloom's unchanged bright, Gaussian mip, and mip-composite
 * result without adding it back to the scene. OutputGradePass performs that
 * final additive operation together with its existing full-screen read.
 */
export class PreparedBloomPass extends UnrealBloomPass {
  readonly bloomTexture: Texture;

  constructor(resolution: Vector2, strength: number, radius: number, threshold: number) {
    super(resolution, strength, radius, threshold);
    // Keep the high-pass output distinct from v0. Aliasing them adds a write,
    // read, write transition that can force synchronization on ANGLE and Metal.
    this.bloomTexture = this.renderTargetsHorizontal[0].texture;

    for (const target of [
      this.renderTargetBright,
      ...this.renderTargetsHorizontal,
      ...this.renderTargetsVertical,
    ]) {
      target.depthBuffer = false;
    }
    this.materialHighPassFilter.depthTest = false;
    this.materialHighPassFilter.depthWrite = false;
    for (const material of this.separableBlurMaterials) {
      material.depthTest = false;
      material.depthWrite = false;
    }
    this.compositeMaterial.depthTest = false;
    this.compositeMaterial.depthWrite = false;
    // The live bloom is untinted: UnrealBloom initializes all five tints to
    // vec3(1), and no caller changes them. r182 rewrote the composite for its
    // own One-factor blend draw (rgb-only sum scaled 3.0, max-component
    // alpha), a draw this pass skips; rebuild the r165-shaped tint-free
    // accumulation so OutputGradePass's bloom.rgb * bloom.a add keeps the
    // pre-upgrade composite contract. The blur mips feeding it still carry
    // upstream's r182+ kernel rework and Rec.709 bright-pass weights (small,
    // accepted visual deltas in the r181 bucket), so this restore pins the
    // composite stage, not bloom output bytes.
    this.compositeMaterial.fragmentShader = restoreClassicBloomComposite(
      this.compositeMaterial.fragmentShader,
      this.nMips,
    );
    delete this.compositeMaterial.uniforms.bloomTintColors;
  }

  override render(
    renderer: WebGLRenderer,
    _writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    _deltaTime?: number,
    maskActive = false,
  ): void {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    const stencil = (renderer as WebGLRenderer & RendererStencilState).state.buffers.stencil;
    if (maskActive) stencil.setTest(false);

    const fsQuad = (this as unknown as BloomPassInternals)._fsQuad;
    const highPassUniforms = this.highPassUniforms as unknown as BloomHighPassUniforms;
    highPassUniforms.tDiffuse.value = readBuffer.texture;
    highPassUniforms.luminosityThreshold.value = this.threshold;
    fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    fsQuad.render(renderer);

    let inputRenderTarget = this.renderTargetBright;
    for (let mip = 0; mip < this.nMips; mip++) {
      const material = this.separableBlurMaterials[mip];
      fsQuad.material = material;
      material.uniforms.colorTexture.value = inputRenderTarget.texture;
      material.uniforms.direction.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[mip]);
      fsQuad.render(renderer);

      material.uniforms.colorTexture.value = this.renderTargetsHorizontal[mip].texture;
      material.uniforms.direction.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[mip]);
      fsQuad.render(renderer);
      inputRenderTarget = this.renderTargetsVertical[mip];
    }

    fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    fsQuad.render(renderer);

    if (maskActive) stencil.setTest(true);
    renderer.autoClear = oldAutoClear;
  }
}
