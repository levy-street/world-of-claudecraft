import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';
import { GFX, sharedUniforms } from './gfx';

// Post chain: RenderPass -> N8AO (high: half-res Low, ultra: full-res Medium)
// -> UnrealBloom -> OutputPass (ACES tonemap + sRGB, reads
// renderer.toneMapping) -> SMAA (edge AA on the AO path) -> GradePass (display
// space lift/gamma/gain, saturation, vignette, faint animated grain).
//
// N8AO replaced three's GTAOPass: better denoise at lower sample counts, and
// cheap enough (half-res) to run on the high tier where GTAO was ultra-only.
// It sits mid-chain so its autosetGamma leaves the buffer linear for bloom.
//
// AA: when N8AO is active it renders the scene into its own non-MSAA beauty
// target, so the composer target carries no MSAA — geometry edges would crawl
// (worst at renderScale<1). A single cheap, temporal-free SMAA pass on the
// tonemapped LDR image (after OutputPass) restores edge AA. It sits BEFORE the
// grade so the grade's film grain is applied AFTER anti-aliasing — grain is
// high-frequency by design and must not be averaged/smeared by the edge filter.
// The no-AO fallback path keeps MSAA on the composer target and skips SMAA.

const BLOOM_STRENGTH = 0.32; // subtle — fires/portals glow, sky must not blow out
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 0.85;

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    const vec3 LIFT = vec3(0.012, 0.010, 0.018);   // lifted cool shadows
    const vec3 GAIN = vec3(1.05, 1.02, 0.98);      // warm highlights
    const vec3 GAMMA = vec3(0.96);
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = pow(max(vec3(0.0), c * GAIN + LIFT), GAMMA);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);                                  // saturation
      vec2 d = vUv - 0.5;
      c *= 1.0 - 0.20 * smoothstep(0.60, 0.95, dot(d, d) * 2.2);  // gentle vignette (0.32 crushed corners)
      c += (fract(sin(dot(vUv * 731.7 + uTime, vec2(12.9898, 78.233))) * 43758.5) - 0.5) * 0.012; // grain
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export interface PostPipeline {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao: N8AOPass | null;
  smaa: SMAAPass | null;
  grade: ShaderPass;
  setSize(width: number, height: number): void;
  render(): void;
}

export function buildComposer(
  webgl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): PostPipeline {
  const size = webgl.getDrawingBufferSize(new THREE.Vector2());
  // HDR target; HalfFloat keeps >1 colors for bloom. MSAA only helps when a
  // RenderPass draws the scene into this target — with N8AO that never
  // happens, so skip the multisample storage + resolve cost there.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: webgl.capabilities.isWebGL2 && !GFX.ao ? GFX.msaaSamples : 0,
    type: THREE.HalfFloatType,
  });
  const composer = new EffectComposer(webgl, target);

  let ao: N8AOPass | null = null;
  if (GFX.ao) {
    // N8AOPass REPLACES RenderPass: it renders the scene into its own
    // HalfFloat beauty+depth target (a separate RenderPass would be a
    // discarded full scene draw). Trade-off: the composer's MSAA target
    // never sees the scene, so AA comes from the bloom/grade softening +
    // pixel ratio. Measured acceptable; revisit if edges crawl.
    ao = new N8AOPass(scene, camera, size.x, size.y);
    // world-space radius tuned for 2.6u-tall characters: grounds props and
    // darkens building/rock crevices without dirtying open fields
    ao.configuration.aoRadius = 1.8;
    ao.configuration.distanceFalloff = 3.6;
    ao.configuration.intensity = 2.4;
    // mid-chain: the buffer must stay linear for bloom/OutputPass (autoset
    // guesses from renderToScreen, but be explicit — a gamma-lifted frame
    // here washes the whole image out)
    ao.configuration.gammaCorrection = false;
    // no transparency-aware compositing: auto-detection re-enables it every
    // frame (water/sprites are transparent), costing 2 extra scene renders +
    // ~5 full-scene traversals per frame. AO multiplying over transparent
    // surfaces showed no visible difference in A/B shots.
    ao.configuration.transparencyAware = false;
    if (GFX.tier === 'ultra') {
      ao.setQualityMode('Medium');
    } else {
      // high tier: half-res + depth-aware upsample keeps it ~1ms-class on
      // real GPUs (and survivable under a forced-high SwiftShader probe)
      ao.setQualityMode('Low');
      ao.configuration.halfRes = true;
      ao.configuration.depthAwareUpsampling = true;
    }
    composer.addPass(ao);
  } else {
    composer.addPass(new RenderPass(scene, camera));
  }

  const bloom = new UnrealBloomPass(size.clone(), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // SMAA only on the AO path: that path carries no MSAA on the composer target
  // (samples are gated off above when GFX.ao), so it is the only path with no
  // true geometry AA. MSAA-when-not-AO and SMAA-when-AO are two halves of ONE
  // decision — keep them gated on the same `GFX.ao` so a future tier can never
  // end up with neither. The MSAA fallback already resolves edges → no SMAA there.
  let smaa: SMAAPass | null = null;
  if (GFX.ao) {
    smaa = new SMAAPass(size.x, size.y); // resized with the chain via composer.setSize
    composer.addPass(smaa);
  }

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uTime = sharedUniforms.uTime; // shared clock drives the grain
  composer.addPass(grade);

  // EffectComposer defaults its logical size to drawing-buffer pixels and
  // then multiplies by pixelRatio again when sizing passes — N8AO/bloom would
  // run at ~3x the intended pixel area until the first window resize. Reset
  // to logical size x real ratio (identical to the resize-handler state).
  composer.setPixelRatio(webgl.getPixelRatio());
  composer.setSize(width, height);

  return {
    composer,
    bloom,
    ao,
    smaa,
    grade,
    setSize(width: number, height: number): void {
      composer.setSize(width, height); // also resizes every pass (N8AO, bloom)
    },
    render(): void {
      composer.render();
    },
  };
}
