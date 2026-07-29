import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  ColorManagement,
  type IUniform,
  LinearToneMapping,
  NeutralToneMapping,
  RawShaderMaterial,
  ReinhardToneMapping,
  SRGBTransfer,
  type Texture,
  UniformsUtils,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

export const OutputGradeShader = {
  name: 'OutputGradeShader',
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    toneMappingExposure: { value: 1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    precision highp float;

    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;

    attribute vec3 position;
    attribute vec2 uv;

    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform float uTime;

    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>

    varying vec2 vUv;
    const vec3 LIFT = vec3(0.012, 0.010, 0.018);
    const vec3 GAIN = vec3(1.05, 1.02, 0.98);
    const vec3 GAMMA = vec3(0.96);

    void main() {
      gl_FragColor = texture2D(tDiffuse, vUv);

      #ifdef LINEAR_TONE_MAPPING
        gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
      #elif defined(REINHARD_TONE_MAPPING)
        gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
      #elif defined(CINEON_TONE_MAPPING)
        gl_FragColor.rgb = OptimizedCineonToneMapping(gl_FragColor.rgb);
      #elif defined(ACES_FILMIC_TONE_MAPPING)
        gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
      #elif defined(AGX_TONE_MAPPING)
        gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
      #elif defined(NEUTRAL_TONE_MAPPING)
        gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
      #endif

      #ifdef SRGB_TRANSFER
        gl_FragColor = sRGBTransferOETF(gl_FragColor);
      #endif

      vec3 c = gl_FragColor.rgb;
      c = pow(max(vec3(0.0), c * GAIN + LIFT), GAMMA);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);
      vec2 d = vUv - 0.5;
      c *= 1.0 - 0.20 * smoothstep(0.60, 0.95, dot(d, d) * 2.2);
      c +=
        (fract(sin(dot(vUv * 731.7 + uTime, vec2(12.9898, 78.233))) * 43758.5) - 0.5) *
        0.012;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

interface OutputGradeUniforms {
  [uniform: string]: IUniform;
  tDiffuse: { value: Texture | null };
  toneMappingExposure: { value: number };
  uTime: { value: number };
}

/** Three r165 OutputPass followed immediately by the existing display-space grade. */
export class OutputGradePass extends Pass {
  readonly uniforms: OutputGradeUniforms;
  readonly material: RawShaderMaterial;
  private readonly fsQuad: FullScreenQuad;
  private outputColorSpace: string | null = null;
  private toneMapping: number | null = null;

  constructor(timeUniform: { value: number }) {
    super();
    this.uniforms = UniformsUtils.clone(OutputGradeShader.uniforms) as OutputGradeUniforms;
    this.uniforms.uTime = timeUniform;
    this.material = new RawShaderMaterial({
      name: OutputGradeShader.name,
      uniforms: this.uniforms,
      vertexShader: OutputGradeShader.vertexShader,
      fragmentShader: OutputGradeShader.fragmentShader,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;

    if (
      this.outputColorSpace !== renderer.outputColorSpace ||
      this.toneMapping !== renderer.toneMapping
    ) {
      this.outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      const defines: Record<string, string> = {};
      if (ColorManagement.getTransfer(renderer.outputColorSpace) === SRGBTransfer) {
        defines.SRGB_TRANSFER = '';
      }
      if (renderer.toneMapping === LinearToneMapping) defines.LINEAR_TONE_MAPPING = '';
      else if (renderer.toneMapping === ReinhardToneMapping) defines.REINHARD_TONE_MAPPING = '';
      else if (renderer.toneMapping === CineonToneMapping) defines.CINEON_TONE_MAPPING = '';
      else if (renderer.toneMapping === ACESFilmicToneMapping) {
        defines.ACES_FILMIC_TONE_MAPPING = '';
      } else if (renderer.toneMapping === AgXToneMapping) defines.AGX_TONE_MAPPING = '';
      else if (renderer.toneMapping === NeutralToneMapping) defines.NEUTRAL_TONE_MAPPING = '';
      this.material.defines = defines;
      this.material.needsUpdate = true;
    }

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) {
        renderer.clear(renderer.autoClearColor, renderer.autoClearDepth, renderer.autoClearStencil);
      }
    }
    this.fsQuad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
