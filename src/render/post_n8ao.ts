import { N8AOPass } from 'n8ao';
import type { Camera, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';

interface N8AOFullScreenTriangle {
  material: ShaderMaterial;
  render(renderer: WebGLRenderer): void;
}

interface N8AOStaticFrameInternals {
  writeTargetInternal: WebGLRenderTarget;
  accumulationRenderTarget: WebGLRenderTarget;
  accumulationQuad: N8AOFullScreenTriangle;
  effectShaderQuad?: N8AOFullScreenTriangle;
  poissonBlurQuad?: N8AOFullScreenTriangle;
  effectCompositerQuad: N8AOFullScreenTriangle;
  depthDownsampleTarget?: WebGLRenderTarget | null;
  depthDownsampleQuad?: N8AOFullScreenTriangle | null;
}

interface N8AOStaticConfiguration {
  accumulate: boolean;
  biasMultiplier: number;
  biasOffset: number;
  screenSpaceRadius: boolean;
}

const noClearQuads = new WeakSet<N8AOFullScreenTriangle>();

const ACCUMULATION_QUANTIZE_SHADER = /* glsl */ `
    vec4 quantizeAccumulatedAo(vec4 value) {
      vec2 rg = unpackHalf2x16(packHalf2x16(value.rg));
      vec2 ba = unpackHalf2x16(packHalf2x16(vec2(value.b, 1.0)));
      return vec4(rg, ba);
    }

    vec4 sampleAccumulatedAo(vec2 uv) {
      return quantizeAccumulatedAo(texture2D(tDiffuse, uv));
    }

    vec4 fetchAccumulatedAo(ivec2 pixel) {
      return quantizeAccumulatedAo(texelFetch(tDiffuse, pixel, 0));
    }
`;

function replacePinned(source: string, from: string, to: string, expected: number): string {
  const count = source.split(from).length - 1;
  if (count !== expected) {
    throw new Error(
      `Pinned n8ao 1.10.3 shader changed at "${from}" (${count}, expected ${expected})`,
    );
  }
  return source.split(from).join(to);
}

function preserveAccumulationQuantization(material: ShaderMaterial): void {
  let shader = material.fragmentShader;
  shader = replacePinned(
    shader,
    'vec4 texel = texture2D(tDiffuse, vUv);',
    'vec4 texel = sampleAccumulatedAo(vUv);',
    3,
  );
  shader = replacePinned(
    shader,
    'texel = texture2D(tDiffuse, vUv);',
    'texel = sampleAccumulatedAo(vUv);',
    1,
  );
  shader = replacePinned(shader, 'texelFetch(tDiffuse, p, 0)', 'fetchAccumulatedAo(p)', 1);
  shader = replacePinned(
    shader,
    '    void main() {',
    `${ACCUMULATION_QUANTIZE_SHADER}\n    void main() {`,
    1,
  );
  material.fragmentShader = shader;
  material.needsUpdate = true;
}

function assertStaticShaderConfiguration(configuration: N8AOStaticConfiguration): void {
  if (
    configuration.accumulate ||
    configuration.biasMultiplier !== 0 ||
    configuration.biasOffset !== 0 ||
    configuration.screenSpaceRadius
  ) {
    throw new Error(
      'Static N8AO shaders require accumulation, bias adjustment, and screen-space radius off',
    );
  }
}

/**
 * The static path fixes frame and bias adjustment at zero and uses world-space
 * radius on every preset. At full resolution, sceneDepth is nearest-filtered,
 * so the center texture2D sample is the same texel computeNormal fetched again.
 * Passing that depth and its reconstructed position removes one depth fetch and
 * one identical reconstruction without changing any later operation.
 */
function specializeStaticEvaluation(material: ShaderMaterial): void {
  let shader = material.fragmentShader;
  shader = replacePinned(shader, '      vec4 diffuse = texture2D(sceneDiffuse, vUv);\n', '', 1);
  shader = replacePinned(
    shader,
    '  vec3 computeNormal(vec3 worldPos, vec2 vUv) {',
    '  vec3 computeNormal(vec3 worldPos, float c0, vec2 vUv) {',
    1,
  );
  shader = replacePinned(shader, '    float c0 = 1.0 - texelFetch(sceneDepth, p, 0).x;\n', '', 1);
  shader = replacePinned(shader, '    float c0 = texelFetch(sceneDepth, p, 0).x;\n', '', 1);
  shader = replacePinned(
    shader,
    '    vec3 ce = getWorldPos(c0, vUv).xyz;',
    '    vec3 ce = worldPos;',
    1,
  );
  shader = replacePinned(
    shader,
    '        vec3 normal = computeNormal(worldPos, vUv);',
    '        vec3 normal = computeNormal(worldPos, depth, vUv);',
    1,
  );
  shader = replacePinned(
    shader,
    `      vec2 harmoniousNumbers = vec2(
        1.618033988749895,
        1.324717957244746
      );
      noise.rg += harmoniousNumbers * frame;
`,
    '',
    1,
  );
  shader = replacePinned(
    shader,
    `      float radiusToUse = screenSpaceRadius ? distance(
        worldPos,
        getWorldPos(depth, vUv +
          vec2(radius, 0.0) / resolution)
      ) : radius;
      float distanceFalloffToUse =screenSpaceRadius ?
          radiusToUse * distanceFalloff
      : radiusToUse * distanceFalloff * 0.2;
`,
    `      float radiusToUse = radius;
      float distanceFalloffToUse = radius * distanceFalloff * 0.2;
`,
    1,
  );
  shader = replacePinned(
    shader,
    `      float bias = (min(
        0.1,
        distanceFalloffToUse * 0.1
      ) / near) * fwidth(distance(worldPos, cameraPos)) / radiusToUse;
      bias = biasAdjustment.x + biasAdjustment.y * bias;
`,
    '      float bias = 0.0;\n',
    1,
  );
  material.fragmentShader = shader;
  material.needsUpdate = true;
}

/**
 * World-space radius removes the unused screen-space alternative. count starts
 * at 1 and only receives nonnegative bilateral weights, so its divide guard is
 * always taken for every finite shipped input.
 */
function specializeStaticDenoise(material: ShaderMaterial): void {
  let shader = material.fragmentShader;
  shader = replacePinned(
    shader,
    `        float radiusToUse = screenSpaceRadius ? distance(
          worldPos,
          getWorldPos(d, vUv +
            vec2(worldRadius, 0.0) / resolution)
        ) : worldRadius;
        float distanceFalloffToUse =screenSpaceRadius ?
        radiusToUse * distanceFalloff
    : radiusToUse * distanceFalloff * 0.2;
`,
    `        float radiusToUse = worldRadius;
        float distanceFalloffToUse = worldRadius * distanceFalloff * 0.2;
`,
    1,
  );
  shader = replacePinned(
    shader,
    `        if (count > 0.0) {
          occlusion /= count;
        }
`,
    '        occlusion /= count;\n',
    1,
  );
  material.fragmentShader = shader;
  material.needsUpdate = true;
}

function suppressFullCoverageClear(quad: N8AOFullScreenTriangle | null | undefined): void {
  if (!quad || noClearQuads.has(quad)) return;
  const render = quad.render.bind(quad);
  quad.render = (renderer): void => {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      render(renderer);
    } finally {
      renderer.autoClear = oldAutoClear;
    }
  };
  noClearQuads.add(quad);
}

/**
 * The shipped static-frame path never enables N8AO temporal accumulation.
 * Its frame-zero accumulation draw is only an RGBA8 to RGBA16F copy with
 * alpha 1. The composite samples the final denoise target directly and
 * performs the same binary16 conversion in shader instead.
 */
export class StaticOpaqueN8AOPass extends N8AOPass {
  constructor(scene: Scene, camera: Camera, width: number, height: number) {
    super(scene, camera, width, height);
    assertStaticShaderConfiguration(this.configuration as unknown as N8AOStaticConfiguration);
    if (this.configuration.denoiseIterations !== 2) {
      throw new Error('Static N8AO path requires exactly two denoise passes');
    }

    const state = this as unknown as N8AOStaticFrameInternals;
    state.accumulationRenderTarget.dispose();
    state.accumulationRenderTarget = state.writeTargetInternal;
    state.accumulationQuad.material.dispose();
    state.accumulationQuad.render = () => {};
  }

  override detectTransparency(): void {
    // The shipped mode is transparencyAware=false. Overriding the virtual
    // constructor hook avoids two beauty targets and a depth-copy pass.
  }

  override configureAOPass(depthBufferType?: number, ortho?: boolean): void {
    assertStaticShaderConfiguration(this.configuration as unknown as N8AOStaticConfiguration);
    super.configureAOPass(depthBufferType, ortho);
    const state = this as unknown as N8AOStaticFrameInternals;
    if (state.effectShaderQuad) specializeStaticEvaluation(state.effectShaderQuad.material);
    suppressFullCoverageClear(state.effectShaderQuad);
  }

  override configureDenoisePass(depthBufferType?: number, ortho?: boolean): void {
    assertStaticShaderConfiguration(this.configuration as unknown as N8AOStaticConfiguration);
    super.configureDenoisePass(depthBufferType, ortho);
    const state = this as unknown as N8AOStaticFrameInternals;
    if (state.poissonBlurQuad) specializeStaticDenoise(state.poissonBlurQuad.material);
    suppressFullCoverageClear(state.poissonBlurQuad);
  }

  override configureEffectCompositer(depthBufferType?: number, ortho?: boolean): void {
    super.configureEffectCompositer(depthBufferType, ortho);
    const state = this as unknown as N8AOStaticFrameInternals;
    preserveAccumulationQuantization(state.effectCompositerQuad.material);
    suppressFullCoverageClear(state.effectCompositerQuad);
  }

  override configureHalfResTargets(): void {
    super.configureHalfResTargets();
    const state = this as unknown as N8AOStaticFrameInternals;
    if (state.depthDownsampleTarget) state.depthDownsampleTarget.depthBuffer = false;
    suppressFullCoverageClear(state.depthDownsampleQuad);
  }
}
