import type { N8AOPass } from 'n8ao';
import * as THREE from 'three';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
// -> ScreenFx -> SMAA (high and above). Medium uses the region-safe
// RenderPass -> OutputGradePass chain only.
//
// N8AO replaced three's GTAOPass: better denoise at lower sample counts, and
// cheap enough (half-res) to run on the high tier where GTAO was ultra-only.
// It sits mid-chain so its autosetGamma leaves the buffer linear for bloom.
//
// Actual AA graph on the pinned packages: N8AO renders into its own
// single-sample beauty target, so MSAA cannot protect the composer tiers.
// High, ultra, and insane use tail SMAA at a 1.75 DPR cap. Medium keeps its
// adaptive-resolution region by omitting SMAA and the full-UV ScreenFx tail.
// Full-screen targets never inherit MSAA.
//
// OutputGradePass explicitly quantizes both removed RGBA16F boundaries: bloom's
// additive scene write before tone mapping, then OutputPass color before the
// unchanged grade. PreparedBloomPass keeps a dedicated bright target and leaves
// every bright/blur/composite sample intact while removing that full-resolution
// add draw and its redundant clears. ScreenFx is itself a swapping tail, so the
// Advanced chain keeps distinct composer targets even when SMAA is disabled.
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

// Ability-VFX screen feedback (ported from the gallery DistortShader, ripple
// and flash arms only): up to 4 world-anchored radial distortion ripples,
// re-projected every frame so camera motion never smears them, plus a brief
// additive white flash (crit pops). All slots and uniform vectors are
// preallocated; the pass disables itself whenever idle, so the steady-state
// frame pays nothing beyond the boot-time shader compile.
const SCREEN_RIPPLE_SLOTS = 4;
const SCREEN_RIPPLE_LIFE = 0.9; // gallery ripple lifetime; the shader fades on exp(-age*4.5)
const ScreenFxShader = {
  name: 'ScreenFxShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRipples: {
      value: [
        new THREE.Vector4(0, 0, 9, 0),
        new THREE.Vector4(0, 0, 9, 0),
        new THREE.Vector4(0, 0, 9, 0),
        new THREE.Vector4(0, 0, 9, 0),
      ],
    },
    uAspect: { value: 1 },
    uFlash: { value: 0 },
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
    uniform vec4 uRipples[4]; // xy screen uv, z age, w strength (0 = off)
    uniform float uAspect;
    uniform float uFlash;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 suv = vec2(vUv.x * uAspect, vUv.y);
      for (int i = 0; i < 4; i++) {
        vec4 r = uRipples[i];
        if (r.w <= 0.0) continue;
        vec2 c = vec2(r.x * uAspect, r.y);
        float d = distance(suv, c);
        // the gallery wavefront: an expanding sine band, fading with distance and age
        float wave = sin((d - r.z * 1.4) * 42.0) * exp(-d * 5.0) * exp(-r.z * 4.5) * r.w;
        uv += (d > 0.0001 ? (suv - c) / d : vec2(0.0)) * wave * 0.016;
      }
      vec3 c = texture2D(tDiffuse, uv).rgb;
      c = mix(c, vec3(1.0), uFlash);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export interface PostPipeline {
  composer: PostEffectComposer;
  bloom: UnrealBloomPass | null; // null on the grade-only path
  ao: N8AOPass | null;
  grade: OutputGradePass;
  supportsDynamicResolution: boolean;
  setSize(width: number, height: number, pixelRatio?: number): void;
  setRenderRegion(region: DynamicResolutionRect): void;
  render(): void;
  dispose(): void;
  /** Queue a world-anchored screen distortion ripple (finisher/big-nova
   *  impacts). Capped at 4 concurrent; a saturated pool steals the oldest. */
  screenRipple(x: number, y: number, z: number, strength: number): void;
  /** Brief additive white flash (local-player crit pop); clamped, max-merged. */
  screenFlash(strength: number): void;
  /** Advance ripple ages / flash decay and re-project onto the camera; call
   *  once per frame before render(). Toggles the pass off when idle. */
  updateScreenFx(dt: number): void;
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
  // one region-remapped fullscreen grade pass over the direct path. No AO,
  // bloom, ScreenFx, or SMAA, but the display-space grade is what
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

  // Screen-fx pass (display space, straight after the grade and BEFORE the
  // tail SMAA, whose last-pass position is a pinned contract: SMAA then
  // anti-aliases the rippled image rather than the other way round). Enabled
  // through the boot prewarm frames so its shader compiles alongside
  // everything else, then self-disables whenever no ripple/flash is live;
  // EffectComposer simply skips a disabled pass, so toggling is free.
  const screenFx = plan.composerPasses.includes('screen-fx')
    ? new ShaderPass(ScreenFxShader)
    : null;
  if (screenFx) composer.addPass(screenFx);
  const rippleSlots = Array.from({ length: SCREEN_RIPPLE_SLOTS }, () => ({
    x: 0,
    y: 0,
    z: 0,
    age: 0,
    strength: 0,
  }));
  const rippleProj = new THREE.Vector3();
  let flash = 0;
  let aspect = width / Math.max(1, height);
  let screenFxWarm = screenFx ? 2 : 0; // main-loop frames to keep the pass compiled at boot
  let disposed = false;

  // Edge AA, after the grade so it works on the display-space image (SMAA's
  // edge detector expects the gamma-encoded color OutputGradePass produces).
  // It stays the LAST pass; the screen-fx pass above feeds into it.
  // Construction size is provisional; addPass and the setSize() member resize
  // every pass to the live drawing-buffer extent.
  // The AA policy uses SMAA on the full composer tiers. Ultra and insane run
  // the same 1.75 cap as high: when both caps bind, 1.75 squared is 49 percent of
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
    supportsDynamicResolution: plan.supportsDynamicResolution,
    setSize(width: number, height: number, pixelRatio = webgl.getPixelRatio()): void {
      composer.setSizeAndPixelRatio(width, height, pixelRatio);
      // The ripple projection maps world points to clip space, so it needs the
      // logical aspect, not the drawing-buffer extent.
      aspect = width / Math.max(1, height);
      if (plan.supportsDynamicResolution) {
        composer.setRenderRegion(composer.renderTarget1.width, composer.renderTarget1.height);
        grade.setInputUvRect(1, 1, 1, 1);
      }
    },
    setRenderRegion(region: DynamicResolutionRect): void {
      if (!plan.supportsDynamicResolution) return;
      composer.setRenderRegion(region.renderWidth, region.renderHeight);
      grade.setInputUvRect(region.uvScaleX, region.uvScaleY, region.uvMaxX, region.uvMaxY);
    },
    render(): void {
      composer.render();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
    screenRipple(x: number, y: number, z: number, strength: number): void {
      if (!screenFx) return;
      let slot = null;
      for (const s of rippleSlots) {
        if (s.strength <= 0) {
          slot = s;
          break;
        }
      }
      if (!slot) {
        // saturated: steal the oldest (the gallery's 4-cap shift)
        for (const s of rippleSlots) if (!slot || s.age > slot.age) slot = s;
      }
      if (!slot) return;
      slot.x = x;
      slot.y = y;
      slot.z = z;
      slot.age = 0;
      slot.strength = 0.55 * Math.min(1.4, Math.max(0, strength)); // gallery spawnRipple scale
    },
    screenFlash(strength: number): void {
      if (!screenFx) return;
      flash = Math.min(0.4, Math.max(flash, strength));
    },
    updateScreenFx(dt: number): void {
      if (!screenFx) return;
      let active = false;
      const u = screenFx.uniforms;
      const ripples = u.uRipples.value as THREE.Vector4[];
      for (let i = 0; i < SCREEN_RIPPLE_SLOTS; i++) {
        const s = rippleSlots[i];
        const v = ripples[i];
        if (s.strength <= 0) {
          v.w = 0;
          continue;
        }
        s.age += dt;
        if (s.age > SCREEN_RIPPLE_LIFE) {
          s.strength = 0;
          v.w = 0;
          continue;
        }
        // world-anchored: re-project every frame (the gallery updateDistortion)
        rippleProj.set(s.x, s.y, s.z).project(camera);
        if (rippleProj.z > 1 || rippleProj.z < -1) {
          v.w = 0; // behind/beyond the camera this frame; the slot stays live
          continue;
        }
        v.set((rippleProj.x + 1) / 2, (rippleProj.y + 1) / 2, s.age, s.strength);
        active = true;
      }
      flash = Math.max(0, flash - dt * 5); // ~3 frames at 60fps: a pop, not a strobe
      u.uFlash.value = flash;
      u.uAspect.value = aspect;
      if (flash > 0.003) active = true;
      screenFx.enabled = active || screenFxWarm > 0;
      if (screenFxWarm > 0) screenFxWarm--;
    },
  };
}
