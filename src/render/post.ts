import { N8AOPass } from 'n8ao';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GFX, sharedUniforms } from './gfx';

// Post chain: RenderPass -> N8AO (high: half-res Low, ultra: full-res Medium)
// -> UnrealBloom -> OutputPass (ACES tonemap + sRGB, reads
// renderer.toneMapping) -> GradePass (display space lift/gamma/gain,
// saturation, vignette, faint animated grain).
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
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao: N8AOPass | null;
  grade: ShaderPass;
  setSize(width: number, height: number): void;
  render(): void;
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

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uTime = sharedUniforms.uTime; // shared clock drives the grain
  composer.addPass(grade);

  // Screen-fx tail pass (display space, after grade). Enabled through the
  // boot prewarm frames so its shader compiles alongside everything else,
  // then self-disables whenever no ripple/flash is live: EffectComposer
  // re-targets renderToScreen to the last ENABLED pass, so toggling is free.
  const screenFx = new ShaderPass(ScreenFxShader);
  composer.addPass(screenFx);
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
  let screenFxWarm = 2; // main-loop frames to keep the pass compiled at boot

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
    grade,
    setSize(width: number, height: number): void {
      composer.setSize(width, height); // also resizes every pass (N8AO, bloom)
      aspect = width / Math.max(1, height);
    },
    render(): void {
      composer.render();
    },
    screenRipple(x: number, y: number, z: number, strength: number): void {
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
      flash = Math.min(0.4, Math.max(flash, strength));
    },
    updateScreenFx(dt: number): void {
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
