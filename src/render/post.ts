import { N8AOPass } from 'n8ao';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GFX, sharedUniforms } from './gfx';
import { OutputGradePass } from './output_grade_pass';

// Post chain: RenderPass -> N8AO (high: half-res Low, ultra: full-res Medium)
// -> UnrealBloom -> OutputGradePass (ACES tonemap + sRGB followed by the
// display-space lift/gamma/gain, saturation, vignette, and animated grain).
//
// N8AO replaced three's GTAOPass: better denoise at lower sample counts, and
// cheap enough (half-res) to run on the high tier where GTAO was ultra-only.
// It sits mid-chain so its autosetGamma leaves the buffer linear for bloom.
//
// AA: when N8AO is active it renders the scene into its own non-MSAA beauty
// target, so geometry AA comes from bloom/grade softening + pixel ratio (the
// composer target therefore skips MSAA storage — pure waste otherwise). The
// no-AO fallback path keeps MSAA on the composer target.

const BLOOM_STRENGTH = 0.32; // subtle — fires/portals glow, sky must not blow out
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 0.85;

export interface PostPipeline {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao: N8AOPass | null;
  outputGrade: OutputGradePass;
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
    depthBuffer: !GFX.ao,
    stencilBuffer: false,
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
  const outputGrade = new OutputGradePass(sharedUniforms.uTime);
  composer.addPass(outputGrade);

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
    outputGrade,
    setSize(width: number, height: number): void {
      composer.setSize(width, height); // also resizes every pass (N8AO, bloom)
    },
    render(): void {
      composer.render();
    },
  };
}
