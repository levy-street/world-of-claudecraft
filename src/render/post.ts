import type { N8AOPass } from 'n8ao';
import * as THREE from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { DynamicResolutionRect } from './dynamic_resolution_core';
import { GFX, sharedUniforms } from './gfx';
import { PreparedBloomPass } from './post_bloom';
import { PostEffectComposer } from './post_composer';
import { StaticOpaqueN8AOPass } from './post_n8ao';
import { OutputGradePass } from './post_output_grade';
import { postPipelinePlan } from './post_plan_core';
import { renderLayerDisabled } from './render_dev_flags';

// Post chain: N8AO (high: half-res Low, ultra+insane: full-res Medium)
// -> UnrealBloom -> OutputGradePass (OutputPass ACES tonemap + sRGB followed
// by the display-space lift/gamma/gain, saturation, vignette, and grain)
// -> SMAA (medium and above). Medium uses RenderPass -> OutputGradePass
// -> SMAA.
//
// N8AO replaced three's GTAOPass: better denoise at lower sample counts, and
// cheap enough (half-res) to run on the high tier where GTAO was ultra-only.
// It sits mid-chain so its autosetGamma leaves the buffer linear for bloom.
//
// Actual AA graph on the pinned packages: N8AO renders into its own
// single-sample beauty target, so MSAA cannot protect the composer tiers.
// High, ultra, and insane use tail SMAA at a 1.75 DPR cap. Medium also uses
// tail SMAA through its existing grade path instead of a multisampled geometry
// target. Full-screen targets never inherit MSAA.
//
// OutputGradePass explicitly quantizes both removed RGBA16F boundaries: bloom's
// additive scene write before tone mapping, then OutputPass color before the
// unchanged grade. PreparedBloomPass keeps a dedicated bright target and leaves
// every bright/blur/composite sample intact while removing that full-resolution
// add draw and its redundant clears. With no tail SMAA, the composer also aliases
// its read/write buffer.
//
// N8AO owns one beauty+depth scene draw. Full-res Medium reconstructs normals
// from that shared depth texture; half-res Low downsamples the same depth once.
// StaticOpaqueN8AOPass prevents transparency rerender allocations and replaces
// disabled accumulation's copy with the same binary16 conversion in composite.
// It retains the beauty clear but suppresses clears before full-coverage writes.

// Bloom is a high-pass in linear HDR, so the threshold has to clear the
// brightest lit diffuse or the whole sunlit world glows. Sunlit high-albedo
// plaster/snow peaks near 1.02 luma at the current rig; 1.32 leaves it dark
// and reserves bloom for emissives, which gfx.ts EMISSIVE_* push above it.
const BLOOM_STRENGTH = 0.4; // subtle: fires/lamps/windows glow, sky must not blow out
const BLOOM_RADIUS = 0.6;
const BLOOM_THRESHOLD = 1.32;

export interface PostPipeline {
  composer: PostEffectComposer;
  bloom: UnrealBloomPass | null; // null on the grade-only path
  ao: N8AOPass | null;
  grade: OutputGradePass;
  supportsDynamicResolution: boolean;
  setSize(width: number, height: number, pixelRatio?: number): void;
  setRenderRegion(region: DynamicResolutionRect): void;
  render(): void;
}

export function buildComposer(
  webgl: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  opts?: { gradeOnly?: boolean },
): PostPipeline {
  // Grade-only mini chain for the medium tier: RenderPass -> OutputGradePass,
  // one fullscreen grade pass over the direct path, followed by SMAA. No AO
  // or bloom, but the display-space grade (lift/gain/S-curve/vignette) is what
  // separates "cinematic" from "raw ACES wash", and medium was the only
  // daylight tier shipping without it.
  const gradeOnly = opts?.gradeOnly === true;
  const size = webgl.getDrawingBufferSize(new THREE.Vector2());
  const plan = postPipelinePlan({
    gradeOnly,
    ao: GFX.ao,
    aoFullRes: GFX.aoFullRes,
    bloom: GFX.bloom,
    smaa: GFX.smaa,
    n8aoDisabled: renderLayerDisabled('n8ao'),
    smaaDisabled: renderLayerDisabled('smaa'),
    isWebGL2: webgl.capabilities.isWebGL2,
    msaaSamples: GFX.msaaSamples,
  });
  // HalfFloat keeps >1 colors for bloom. N8AO owns beauty depth, so its
  // composer target is color-only. RenderPass keeps depth only on the one
  // target that rasterizes geometry.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    depthBuffer: plan.scene.pass === 'render',
    resolveDepthBuffer: !gradeOnly,
    samples: plan.composerSamples,
    type: THREE.HalfFloatType,
  });
  const composer = new PostEffectComposer(webgl, target, width, height, plan.singleComposerBuffer);

  let ao: N8AOPass | null = null;
  if (plan.scene.pass === 'n8ao') {
    // N8AOPass replaces RenderPass. A separate scene pass would be discarded.
    ao = new StaticOpaqueN8AOPass(scene, camera, size.x, size.y);
    // world-space radius tuned for 2.6u-tall characters: grounds props and
    // darkens building/rock crevices without dirtying open fields
    ao.configuration.aoRadius = 1.8;
    ao.configuration.distanceFalloff = 3.6;
    // 2.4 crushed every dense alphaTest card cluster (grass tufts, sapling
    // canopies) to a black clump: overlapping cards read as deep cavities at
    // this radius. 1.0 fixed that but also removed the canopy interior depth;
    // 1.45 restores contact grounding and inner-canopy shadowing now that
    // leaf albedo is back at authored levels (the black-clump look was the
    // AO multiplying an already-dark un-lifted atlas, not the AO alone).
    ao.configuration.intensity = 1.45;
    // mid-chain: the buffer must stay linear for bloom/OutputGradePass (autoset
    // guesses from renderToScreen, but be explicit: a gamma-lifted frame
    // here washes the whole image out)
    ao.configuration.gammaCorrection = false;
    // No transparency-aware compositing. Water and sprites make the package's
    // constructor auto-detect that mode before this configuration write; the
    // subclass hook above prevents those transient targets. Enabling the mode
    // costs 2 extra scene renders plus repeated full-scene traversals. AO over
    // transparent surfaces showed no visible difference in A/B shots.
    ao.configuration.transparencyAware = false;
    if (plan.scene.aoQuality === 'Medium') {
      // ultra and insane (and the Advanced Effects dial's top level)
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

  let bloom: UnrealBloomPass | null = null;
  if (plan.composerPasses.includes('bloom')) {
    bloom = new PreparedBloomPass(size.clone(), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    composer.addPass(bloom);
  }
  const grade = new OutputGradePass(
    sharedUniforms.uTime,
    bloom instanceof PreparedBloomPass ? bloom.bloomTexture : null,
  );
  composer.addPass(grade);

  // Edge AA, last so it works on the final display-space image. SMAA's edge
  // detector expects the gamma-encoded color OutputGradePass produces.
  // Construction size is provisional; addPass and the setSize() member resize
  // every pass to the live drawing-buffer extent.
  // The AA policy uses SMAA from medium upward. Ultra and insane now run the
  // same 1.75 cap as high: when both caps bind, 1.75 squared is 49 percent of
  // the fragments at the old 2.5 cap, which leaves room for this fixed-cost
  // edge pass.
  // ?smaa=off is the dev-only perf-attribution kill switch. It keeps the
  // post-AA cost attributable while comparing the revised tier policy.
  if (plan.composerPasses.includes('smaa')) composer.addPass(new SMAAPass(size.x, size.y));

  return {
    composer,
    bloom,
    ao,
    grade,
    supportsDynamicResolution: gradeOnly,
    setSize(width: number, height: number, pixelRatio = webgl.getPixelRatio()): void {
      composer.setSizeAndPixelRatio(width, height, pixelRatio);
      if (gradeOnly) {
        composer.setRenderRegion(composer.renderTarget1.width, composer.renderTarget1.height);
        grade.setInputUvRect(1, 1, 1, 1);
      }
    },
    setRenderRegion(region: DynamicResolutionRect): void {
      if (!gradeOnly) return;
      composer.setRenderRegion(region.renderWidth, region.renderHeight);
      grade.setInputUvRect(region.uvScaleX, region.uvScaleY, region.uvMaxX, region.uvMaxY);
    },
    render(): void {
      composer.render();
    },
  };
}
