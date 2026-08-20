import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  ColorManagement,
  GLSL3,
  LinearToneMapping,
  NeutralToneMapping,
  RawShaderMaterial,
  ReinhardToneMapping,
  SRGBTransfer,
  type Texture,
  type ToneMapping,
  Vector2,
  Vector4,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';

interface TimeUniform {
  value: number;
}

export const OUTPUT_GRADE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float uTime;
  uniform vec4 uInputUvRect;
  uniform vec2 uInputTexelSize;

  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>

  in vec2 vUv;
  out vec4 pc_fragColor;

  const vec3 LIFT = vec3(0.010, 0.008, 0.010);
  const vec3 GAIN = vec3(1.10, 1.035, 0.90);
  const vec3 GAMMA = vec3(0.975);

  // Keep the exact RGBA16F boundaries removed by the bloom-add fusion and by
  // the earlier OutputPass plus GradePass fusion.
  vec3 quantizeHalf(vec3 value) {
    vec2 rg = unpackHalf2x16(packHalf2x16(value.rg));
    float b = unpackHalf2x16(packHalf2x16(vec2(value.b, 0.0))).x;
    return vec3(rg, b);
  }

  // A stray NaN fragment in the HalfFloat beauty target poisons the whole frame:
  // the bloom high-pass reads the beauty and its Gaussian blur smears the NaN
  // across every mip, so OutputGradePass adds a frame-wide NaN and the tonemap
  // maps it to black. NaN survives only in the float composer targets (the
  // direct-to-canvas UNSIGNED_BYTE tiers clamp it away), which is why low/medium
  // are fine while the composer tiers go black. The IBL / PBR shader path emits
  // those NaNs on some drivers (observed on ANGLE's OpenGL backend with NVIDIA on
  // Linux). Every NaN comparison is false, so the (x < 0.0 || x >= 0.0) test
  // keeps finite and infinite values and rewrites only NaN to zero. This must
  // stay on the beauty AND the bloom read, since the blur already spread the NaN.
  vec3 sanitizeFinite(vec3 v) {
    return vec3(
      (v.x < 0.0 || v.x >= 0.0) ? v.x : 0.0,
      (v.y < 0.0 || v.y >= 0.0) ? v.y : 0.0,
      (v.z < 0.0 || v.z >= 0.0) ? v.z : 0.0
    );
  }

  // The display-referred image this pass grades: one scene sample with bloom
  // added, tone mapped, then transfer encoded. Lifted out of main() so the
  // FXAA arm below can reuse it tap for tap and detect edges on the signal the
  // player actually sees. On the linear HDR buffer a sunlit sky swamps every
  // darker contour, so an FXAA fed from there anti-aliases the wrong edges.
  vec4 displayColor(vec2 inputUv) {
    vec4 outputColor = texture(tDiffuse, inputUv);
    outputColor.rgb = sanitizeFinite(outputColor.rgb);

    #ifdef BLOOM_PREPARED
      vec4 bloom = texture(tBloom, inputUv);
      outputColor.rgb = quantizeHalf(outputColor.rgb + sanitizeFinite(bloom.rgb * bloom.a));
    #endif

    #ifdef LINEAR_TONE_MAPPING
      outputColor.rgb = LinearToneMapping(outputColor.rgb);
    #elif defined(REINHARD_TONE_MAPPING)
      outputColor.rgb = ReinhardToneMapping(outputColor.rgb);
    #elif defined(CINEON_TONE_MAPPING)
      outputColor.rgb = CineonToneMapping(outputColor.rgb);
    #elif defined(ACES_FILMIC_TONE_MAPPING)
      outputColor.rgb = ACESFilmicToneMapping(outputColor.rgb);
    #elif defined(AGX_TONE_MAPPING)
      outputColor.rgb = AgXToneMapping(outputColor.rgb);
    #elif defined(NEUTRAL_TONE_MAPPING)
      outputColor.rgb = NeutralToneMapping(outputColor.rgb);
    #endif

    #ifdef SRGB_TRANSFER
      outputColor = sRGBTransferOETF(outputColor);
    #endif

    return outputColor;
  }

  #ifdef FXAA_GRADE
    // Edge AA for the grade-only chain: NVIDIA FXAA 3.11 (Timothy Lottes)
    // lineage, following the structure of the FXAAShader three shipped through
    // r171 (WebGL port by supereggbert, edge-span rework by Daniel Sturk) and
    // NOT the shader the pinned three 0.185 ships today, which is the Jasper
    // Flick / Dave Hoskins implementation. That is a deliberate choice, not
    // drift: the r185 shader samples nine luma neighbours unconditionally
    // before it can decide anything, while the structure below early-outs after
    // four, and an always-on nine-tap gather is exactly the cost the tier that
    // receives this cannot afford. No pass wrapper from either is used; both
    // sample tDiffuse at a plain vUv, which is what makes them full-frame and
    // what would cost this chain its dynamic resolution.
    //
    // Two deliberate departures from that structure:
    //  - contrast is measured on display-referred LUMA rather than max-channel
    //    RGBA distance. The four axis neighbours are needed as colours anyway
    //    (the span blend and the diagonal blur consume them), so luma costs one
    //    dot each and is the signal FXAA was derived against.
    //  - the span search is 5 steps at 1/3/6/10/15 texels.
    //
    // The steady-state budget: an interior (non-edge) fragment pays four extra
    // fxaaTap calls, and a tap is a fetch PLUS a full displayColor evaluation
    // (the tone-map arm and the transfer encode), which is the real cost here,
    // not the fetch. The two diagonal probes and the span walk only run on a
    // fragment that already failed the edge test. Measured on the live composer
    // with GPU timer queries at 1600x900 on an RTX 3090: the whole pass goes
    // from about 0.02 ms to about 0.05 ms, or 1 to 3 percent of the medium
    // frame's GPU time. ?fxaa=off re-prices it on any device.
    //
    // The edge threshold is absolute, with no relative arm (the r185 shader
    // uses max(0.0312, 0.063 * highest)). It is deliberately conservative: it
    // IS the cost lever, since every fragment it admits pays the two diagonal
    // probes and the span walk. A relative arm would pull dim contours in, and
    // widen the expensive path on precisely the weakest hardware this ships to.
    const float FXAA_EDGE_THRESHOLD = 0.2;
    const float FXAA_INV_EDGE_THRESHOLD = 1.0 / FXAA_EDGE_THRESHOLD;
    // Below this the vertical and horizontal contrasts are too close to call,
    // and the source probes two diagonal neighbours before committing.
    const float FXAA_SPAN_AMBIGUITY = 0.3;
    const int FXAA_SPAN_STEPS = 5;

    float fxaaLuma(vec3 display) {
      return dot(display, vec3(0.299, 0.587, 0.114));
    }

    // Every tap stays inside the rendered sub-rect. uInputUvRect.zw is the
    // CENTRE of the last rendered texel, so a bilinear tap clamped to it can
    // never reach the stale pixels the reduced region leaves in the rest of the
    // target, and the low edge clamps to texel 0 the same way.
    vec3 fxaaTap(vec2 inputUv, vec2 texelOffset) {
      vec2 uv = clamp(inputUv + texelOffset * uInputTexelSize, vec2(0.0), uInputUvRect.zw);
      return displayColor(uv).rgb;
    }

    vec3 fxaaFilter(vec2 inputUv, vec3 displayM) {
      vec3 displayS = fxaaTap(inputUv, vec2(0.0, 1.0));
      vec3 displayE = fxaaTap(inputUv, vec2(1.0, 0.0));
      vec3 displayN = fxaaTap(inputUv, vec2(0.0, -1.0));
      vec3 displayW = fxaaTap(inputUv, vec2(-1.0, 0.0));

      float lumaM = fxaaLuma(displayM);
      float contrastN = abs(lumaM - fxaaLuma(displayN));
      float contrastS = abs(lumaM - fxaaLuma(displayS));
      float contrastE = abs(lumaM - fxaaLuma(displayE));
      float contrastW = abs(lumaM - fxaaLuma(displayW));

      if (max(max(contrastN, contrastS), max(contrastE, contrastW)) < FXAA_EDGE_THRESHOLD) {
        return displayM;
      }

      float verticalBias =
        ((contrastN + contrastS) - (contrastE + contrastW)) * FXAA_INV_EDGE_THRESHOLD;
      bool horzSpan = verticalBias > 0.0;

      if (abs(verticalBias) < FXAA_SPAN_AMBIGUITY) {
        vec2 dirToEdge =
          vec2(contrastE > contrastW ? 1.0 : -1.0, contrastS > contrastN ? 1.0 : -1.0);
        float matchAlongH =
          abs(lumaM - fxaaLuma(fxaaTap(inputUv, vec2(dirToEdge.x, -dirToEdge.y))));
        float matchAlongV =
          abs(lumaM - fxaaLuma(fxaaTap(inputUv, vec2(-dirToEdge.x, dirToEdge.y))));
        verticalBias = (matchAlongV - matchAlongH) * FXAA_INV_EDGE_THRESHOLD;
        if (abs(verticalBias) < FXAA_SPAN_AMBIGUITY) {
          // A true 45 degree edge has no span to walk; the source blurs it.
          return mix(displayM, (displayN + displayS + displayE + displayW) * 0.25, 0.4);
        }
        horzSpan = verticalBias > 0.0;
      }

      // ACROSS the edge the two candidates are N/S for a horizontal span and
      // W/E for a vertical one, and the higher-contrast side is the one to
      // blend toward. The span itself is then walked ALONG the edge, in both
      // directions, until one end of it is found.
      vec3 displayLow = horzSpan ? displayN : displayW;
      vec3 displayHigh = horzSpan ? displayS : displayE;
      float contrastLow = horzSpan ? contrastN : contrastW;
      float contrastHigh = horzSpan ? contrastS : contrastE;
      vec3 displayPair = contrastLow > contrastHigh ? displayLow : displayHigh;
      float lumaPair = fxaaLuma(displayPair);
      vec2 spanStep = horzSpan ? vec2(1.0, 0.0) : vec2(0.0, 1.0);

      bool doneForward = false;
      bool doneBack = false;
      float distForward = 0.0;
      float distBack = 0.0;
      int stepsForward = 0;
      int stepsBack = 0;
      for (int i = 0; i < FXAA_SPAN_STEPS; i++) {
        float increment = float(i + 1);
        if (!doneForward) {
          distForward += increment;
          float lumaEnd = fxaaLuma(fxaaTap(inputUv, spanStep * distForward));
          doneForward = abs(lumaEnd - lumaM) > abs(lumaEnd - lumaPair);
          stepsForward = i;
        }
        if (!doneBack) {
          distBack += increment;
          float lumaEnd = fxaaLuma(fxaaTap(inputUv, -spanStep * distBack));
          doneBack = abs(lumaEnd - lumaM) > abs(lumaEnd - lumaPair);
          stepsBack = i;
        }
        if (doneForward || doneBack) break;
      }

      if (!doneForward && !doneBack) return displayM; // no end of edge in reach

      float span = min(
        doneForward ? float(stepsForward) / float(FXAA_SPAN_STEPS - 1) : 1.0,
        doneBack ? float(stepsBack) / float(FXAA_SPAN_STEPS - 1) : 1.0
      );
      // The source's sqrt: it trades AA quality on mostly diagonal edges for
      // much less blurring of them.
      return mix(displayM, displayPair, (1.0 - sqrt(span)) * 0.5);
    }
  #endif

  void main() {
    vec2 inputUv = min(vUv * uInputUvRect.xy, uInputUvRect.zw);
    vec4 outputColor = displayColor(inputUv);

    #ifdef FXAA_GRADE
      outputColor.rgb = fxaaFilter(inputUv, outputColor.rgb);
    #endif

    // quantizeHalf emulates a boundary the removed intermediate target used to
    // store. The FXAA arm resolves a NEW value rather than re-reading a stored
    // one, so on that path this is the grade's own entry quantize and nothing
    // more; the taps it blended are deliberately not quantized individually.
    vec3 c = quantizeHalf(outputColor.rgb);
    c = pow(max(vec3(0.0), c * GAIN + LIFT), GAMMA);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.23);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.07);
    vec2 d = vUv - 0.5;
    c *= 1.0 - 0.20 * smoothstep(0.60, 0.95, dot(d, d) * 2.2);
    c += (fract(sin(dot(vUv * 731.7 + uTime, vec2(12.9898, 78.233))) * 43758.5) - 0.5) * 0.012;
    pc_fragColor = vec4(c, 1.0);
  }
`;

const OUTPUT_GRADE_VERTEX_SHADER = /* glsl */ `
  precision highp float;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;

  in vec3 position;
  in vec2 uv;
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export interface OutputGradeOptions {
  /**
   * Fold the FXAA arm into the fragment shader. Region-safe by construction:
   * it reuses the pass's own `uInputUvRect` remap and clamps every tap to the
   * rendered sub-rect, so the chain keeps `supportsDynamicResolution`. Never
   * combined with the SMAA tail, which already anti-aliases the same image.
   */
  readonly fxaa?: boolean;
}

export class OutputGradePass extends Pass {
  readonly uniforms: {
    tDiffuse: { value: Texture | null };
    tBloom: { value: Texture | null };
    toneMappingExposure: { value: number };
    uTime: TimeUniform;
    uInputUvRect: { value: Vector4 };
    uInputTexelSize: { value: Vector2 };
  };
  readonly material: RawShaderMaterial;
  readonly fsQuad: FullScreenQuad;
  readonly fxaa: boolean;
  private outputColorSpace: string | null = null;
  private toneMapping: ToneMapping | null = null;
  private readonly hasPreparedBloom: boolean;

  constructor(
    timeUniform: TimeUniform,
    bloomTexture: Texture | null = null,
    options: OutputGradeOptions = {},
  ) {
    super();
    this.hasPreparedBloom = bloomTexture !== null;
    this.fxaa = options.fxaa === true;
    this.uniforms = {
      tDiffuse: { value: null },
      tBloom: { value: bloomTexture },
      toneMappingExposure: { value: 1 },
      uTime: timeUniform,
      uInputUvRect: { value: new Vector4(1, 1, 1, 1) },
      uInputTexelSize: { value: new Vector2(0, 0) },
    };
    this.material = new RawShaderMaterial({
      name: 'OutputGradeShader',
      glslVersion: GLSL3,
      uniforms: this.uniforms,
      vertexShader: OUTPUT_GRADE_VERTEX_SHADER,
      fragmentShader: OUTPUT_GRADE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setInputUvRect(scaleX: number, scaleY: number, maxX: number, maxY: number): void {
    this.uniforms.uInputUvRect.value.set(scaleX, scaleY, maxX, maxY);
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
  ): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    if (this.fxaa) {
      // The rendered sub-rect is made of the read target's own texels, so one
      // texel step there IS one texel step in the full target. Reading the size
      // off the buffer keeps the taps correct through every resize without a
      // second size path to keep in sync with the composer.
      this.uniforms.uInputTexelSize.value.set(
        1 / Math.max(1, readBuffer.width),
        1 / Math.max(1, readBuffer.height),
      );
    }

    if (
      this.outputColorSpace !== renderer.outputColorSpace ||
      this.toneMapping !== renderer.toneMapping
    ) {
      this.outputColorSpace = renderer.outputColorSpace;
      this.toneMapping = renderer.toneMapping;
      this.material.defines = this.hasPreparedBloom ? { BLOOM_PREPARED: '' } : {};

      if (this.fxaa) {
        this.material.defines.FXAA_GRADE = '';
      }
      if (ColorManagement.getTransfer(renderer.outputColorSpace) === SRGBTransfer) {
        this.material.defines.SRGB_TRANSFER = '';
      }
      if (renderer.toneMapping === LinearToneMapping) {
        this.material.defines.LINEAR_TONE_MAPPING = '';
      } else if (renderer.toneMapping === ReinhardToneMapping) {
        this.material.defines.REINHARD_TONE_MAPPING = '';
      } else if (renderer.toneMapping === CineonToneMapping) {
        this.material.defines.CINEON_TONE_MAPPING = '';
      } else if (renderer.toneMapping === ACESFilmicToneMapping) {
        this.material.defines.ACES_FILMIC_TONE_MAPPING = '';
      } else if (renderer.toneMapping === AgXToneMapping) {
        this.material.defines.AGX_TONE_MAPPING = '';
      } else if (renderer.toneMapping === NeutralToneMapping) {
        this.material.defines.NEUTRAL_TONE_MAPPING = '';
      }
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
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      this.fsQuad.render(renderer);
    } finally {
      renderer.autoClear = oldAutoClear;
    }
  }

  override dispose(): void {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
