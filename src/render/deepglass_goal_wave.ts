// The Deepglass goal celebration: the frame drains to grey and the scoring
// team's colour bursts out of the net in ripples that wash the whole building.
//
// WHY THIS IS NOT IN deepglass.ts. Everything that module builds lives in the
// main scene, which means the grade/tone chain runs over it — and this effect
// desaturates that chain's own output. A colour wave drawn inside the scene
// would be drained by the very pass that drains everything else, and come out
// grey. So the celebration is drawn LAST, straight onto the canvas after
// `post.render()` (or the direct `webgl.render`) has finished:
//
//   1. copy the finished frame into a texture;
//   2. redraw it through a fullscreen pass that pulls the chroma out, buckles
//      it around the goal and blooms the team's colour in from the edges;
//   3. draw the wave shells over THAT, in world space with the real camera,
//      where nothing can desaturate them.
//
// Step 3 is what makes the colour arrive as a wave rather than a screen tint:
// the shells are real spheres centred on the net that conceded, so they grow
// through the bell, over the pylons and out past the parapet with correct
// perspective, and the frame floods with team colour at the moment a front
// actually reaches the camera. They draw with depthTest off — after post the
// canvas depth buffer no longer describes the scene (on composer tiers it
// holds a fullscreen quad, not the world), and a wave that washes the whole
// arena wants to pass over the architecture anyway.
//
// Cost when no one has scored: one early-out. Cost during a goal: one
// framebuffer copy, one fullscreen pass and three spheres, for 3.4 seconds.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ringCentreFor } from '../sim/deepglass/layout';
import { deepglassMatch } from '../sim/deepglass/match';
import { DG_TINT_A, DG_TINT_B } from './deepglass';
import {
  createDgGoalWaveFrame,
  DG_GOAL_SHELLS,
  DG_GOAL_WAVE_SECS,
  type DgGoalWaveFrame,
  deepglassGoalWaveFrame,
} from './deepglass_goal_wave_core';

/** Camera trauma the whistle adds (renderer.addShake), for callers that want
 *  the kick to match the burst. */
export const DG_GOAL_SHAKE = 0.55;

// ---------------------------------------------------------------------------

/** The drain pass. Samples the finished frame and rewrites it: chroma out,
 *  a travelling buckle around the goal, the team's colour blooming in from
 *  the corners, and the whistle's white pop. */
function drainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: null as THREE.Texture | null },
      uEpi: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uDesat: { value: 0 },
      uDim: { value: 0 },
      uWarp: { value: 0 },
      uFlash: { value: 0 },
      uRim: { value: 0 },
      uT: { value: 0 },
      uTint: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tScene;
      uniform vec2 uEpi;
      uniform float uAspect;
      uniform float uDesat;
      uniform float uDim;
      uniform float uWarp;
      uniform float uFlash;
      uniform float uRim;
      uniform float uT;
      uniform vec3 uTint;
      varying vec2 vUv;

      void main() {
        // Aspect-corrected screen space, so the buckle stays circular on a
        // widescreen canvas instead of stretching into an ellipse.
        vec2 suv = vec2(vUv.x * uAspect, vUv.y);
        vec2 c = vec2(uEpi.x * uAspect, uEpi.y);
        float d = distance(suv, c);

        // Two fronts, timed off the same delays the world shells use, so the
        // screen buckles where the wave physically is rather than on its own
        // schedule.
        float w = sin((d - uT * 1.05) * 30.0) * exp(-uT * 2.2);
        float t2 = uT - 0.24;
        w += sin((d - t2 * 0.86) * 24.0) * exp(-max(t2, 0.0) * 2.0) * 0.7 * step(0.0, t2);
        vec2 dir = d > 0.0001 ? (suv - c) / d : vec2(0.0);
        vec2 uv = clamp(vUv + dir * w * uWarp, vec2(0.0), vec2(1.0));

        vec3 col = texture2D(tScene, uv).rgb;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(l), uDesat);
        // Desaturation keeps luminance, so the lights have to come down too or
        // a bright graded frame stays near-white and the wave washes out over
        // it (see DIM_PEAK in the core).
        col *= 1.0 - uDim;

        // The shells are spheres, so they always leave the screen's corners
        // last; this bloom fills them in from the outside on the same beat.
        float edge = smoothstep(0.30, 1.05, length(vUv - 0.5) * 1.9);
        col += uTint * edge * uRim;
        col = mix(col, vec3(1.0), uFlash);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** One wave shell. Rings are measured from the axis running through the net
 *  that conceded, so they spread OUT of the goal across the sphere instead of
 *  banding round the sky. */
function shellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(0xffffff) },
      uFade: { value: 0 },
      uAge: { value: 0 },
      uAxis: { value: 1 },
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        // The mesh only ever carries a position and a uniform scale, so the
        // unit-sphere position doubles as the world-space normal.
        vN = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vV = cameraPosition - wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uTint;
      uniform float uFade;
      uniform float uAge;
      uniform float uAxis;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        float ang = acos(clamp(n.x * uAxis, -1.0, 1.0));
        // Bands travelling away from the goal pole. They slow as uAge runs
        // out, which reads as the ripple losing energy.
        float band = sin(ang * 22.0 - uAge * 30.0) * 0.5 + 0.5;
        // Sharp. The alpha between bands is what the drained world shows
        // through, and a soft band leaves no gaps: three overlapping shells
        // at a broad falloff summed to an even wash and the ripples
        // disappeared into it.
        //
        // Both pow() bases below are clamped, and both clamps are load-bearing
        // rather than defensive: pow(x, y) is UNDEFINED for x < 0 and lowers to
        // exp2(y * log2(x)), so an ulp of negative base returns NaN, and an
        // additive NaN survives the bloom blur as a hard black rectangle
        // (tests/shader_pow_domain.test.ts carries the whole incident).
        band = pow(clamp(band, 0.0, 1.0), 3.5);
        // Grazing angles brighten, so the front has a hot rim wherever the
        // sphere turns away — the same trick the bell's glass uses. This is
        // precisely the base that bites: two in-shader normalized vectors can
        // dot to 1.0 + 1ulp head-on, which lands 1.0 - abs(dot) at about -1e-7.
        float fres = pow(1.0 - clamp(abs(dot(n, normalize(vV))), 0.0, 1.0), 2.0);
        // ADDITIVE, over a frame the drain has already pulled down. Alpha
        // blending could not do this job: to read as colour over a bright
        // graded frame it needed an alpha high enough to be a flat wash, and
        // the moment the floor came down far enough to leave ripples the
        // whole wave went pastel (it read on the low tier only because that
        // tier's frame is darker). Adding light to a dimmed frame instead
        // gives both at once — blazing colour on the bands, the drained grey
        // untouched between them — and it is the truer idea anyway: the
        // building is being LIT in the scoring side's colour.
        float a = uFade * clamp(0.10 + 0.85 * band + 0.35 * fres, 0.0, 1.0);
        vec3 c = uTint * (0.90 + 0.70 * band + 0.50 * fres);
        gl_FragColor = vec4(c, a);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // BackSide only: outside the shell you get its silhouette, inside it you
    // get the surface all around you. DoubleSide would draw both hemispheres
    // and double the contribution through the middle of the frame.
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------------------

const TMP_SIZE = new THREE.Vector2();

export class DeepglassGoalWave {
  private readonly fxScene = new THREE.Scene();
  private readonly shellGeo = new THREE.SphereGeometry(1, 48, 32);
  private readonly shells: THREE.Mesh[] = [];
  private readonly drainMat = drainMaterial();
  private readonly quad = new FullScreenQuad(this.drainMat);
  private readonly frame: DgGoalWaveFrame = createDgGoalWaveFrame();
  private readonly origin = new THREE.Vector3();
  private readonly proj = new THREE.Vector3();

  private sceneTex: THREE.FramebufferTexture | null = null;
  private warmRT: THREE.WebGLRenderTarget | null = null;
  private readonly warmTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private warmed = false;

  private t = Number.POSITIVE_INFINITY;
  private lastPhase = '';
  private reduced = false;
  private disposed = false;

  constructor() {
    this.fxScene.name = 'deepglass-goal-wave';
    this.warmTex.needsUpdate = true;
    for (let i = 0; i < DG_GOAL_SHELLS.length; i++) {
      const mesh = new THREE.Mesh(this.shellGeo, shellMaterial());
      // A 200-yard sphere wrapped round the camera has no meaningful bounding
      // test, and the cull would only ever be wrong.
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = i;
      this.fxScene.add(mesh);
      this.shells.push(mesh);
    }
  }

  /**
   * Advance the celebration. Edge-triggers off the match's own phase, exactly
   * as the in-bell burst does, so nothing has to tell the render a goal
   * happened. Returns true on the single frame the whistle blows, which is the
   * caller's cue to kick the camera.
   */
  update(dt: number, reducedMotion: boolean): boolean {
    const match = deepglassMatch();
    const phase = match?.phase ?? '';
    let fired = false;
    if (phase === 'goal' && this.lastPhase !== 'goal' && match?.lastGoalBy) {
      const scorer = match.lastGoalBy;
      // 'A' scores in the EAST ring, which team B defends; ringCentreFor takes
      // the side that DEFENDS the ring, so the wave leaves the net that
      // conceded — where everyone in the building is already looking.
      const conceded = ringCentreFor(scorer === 'A' ? 'B' : 'A');
      this.origin.set(conceded.x, conceded.y, conceded.z);
      const axis = Math.sign(conceded.x) || 1;
      const tint = scorer === 'A' ? DG_TINT_A : DG_TINT_B;
      for (const mesh of this.shells) {
        const u = (mesh.material as THREE.ShaderMaterial).uniforms;
        (u.uTint.value as THREE.Color).setHex(tint);
        u.uAxis.value = axis;
        mesh.position.copy(this.origin);
      }
      (this.drainMat.uniforms.uTint.value as THREE.Color).setHex(tint);
      this.t = 0;
      this.reduced = reducedMotion;
      fired = true;
    }
    this.lastPhase = phase;
    // The bout ending mid-celebration (the score cap lands on the last goal)
    // must not leave the frame grey.
    if (!match) this.t = Number.POSITIVE_INFINITY;
    else if (this.t < DG_GOAL_WAVE_SECS) this.t += dt;
    return fired;
  }

  /**
   * Draw over the finished frame. Call AFTER the composer (or the direct
   * render) has written the canvas, with the same camera the frame was drawn
   * with — the shells are world-space and re-project every frame.
   */
  draw(webgl: THREE.WebGLRenderer, camera: THREE.Camera): void {
    if (this.disposed) return;
    if (!this.warmed) {
      // Link both programs on a frame nobody is watching. Left to the first
      // goal, the compile lands on the exact frame the celebration starts.
      this.warm(webgl, camera);
      this.warmed = true;
      return;
    }
    const f = deepglassGoalWaveFrame(this.t, this.reduced, this.frame);
    if (!f.active) return;

    const size = webgl.getDrawingBufferSize(TMP_SIZE);
    if (size.x < 1 || size.y < 1) return;
    this.ensureSceneTex(size.x, size.y);
    const sceneTex = this.sceneTex;
    if (!sceneTex) return;

    const prevTarget = webgl.getRenderTarget();
    const prevAutoClear = webgl.autoClear;
    // three resets info at the top of every render() call, and this pass runs
    // two of them AFTER the frame is otherwise done. Left on, the celebration
    // would zero the frame's own draw-call stats on the non-composer path,
    // where renderer.ts reads info.render live (see its note beside the draw
    // accounting). Off, this pass's handful of draws just add to the tally.
    const prevAutoReset = webgl.info.autoReset;
    webgl.info.autoReset = false;
    webgl.setRenderTarget(null);
    webgl.copyFramebufferToTexture(sceneTex);

    const u = this.drainMat.uniforms;
    u.tScene.value = sceneTex;
    u.uDesat.value = f.desat;
    u.uDim.value = f.dim;
    u.uFlash.value = f.flash;
    u.uRim.value = f.rim;
    u.uT.value = f.t;
    u.uAspect.value = size.x / size.y;
    // Behind the camera the projection flips and the buckle would centre on
    // the wrong side of the screen; drop it rather than lie about where the
    // goal is. The shells still carry the celebration.
    this.proj.copy(this.origin).project(camera);
    const inFront = this.proj.z < 1;
    (u.uEpi.value as THREE.Vector2).set((this.proj.x + 1) * 0.5, (this.proj.y + 1) * 0.5);
    u.uWarp.value = inFront ? f.warp : 0;

    webgl.autoClear = false;
    this.quad.render(webgl);

    for (let i = 0; i < this.shells.length; i++) {
      const mesh = this.shells[i];
      const s = f.shells[i];
      mesh.visible = s.fade > 0.002;
      if (!mesh.visible) continue;
      mesh.scale.setScalar(s.radius);
      const su = (mesh.material as THREE.ShaderMaterial).uniforms;
      su.uFade.value = s.fade;
      su.uAge.value = s.age01;
    }
    webgl.render(this.fxScene, camera);

    webgl.setRenderTarget(prevTarget);
    webgl.autoClear = prevAutoClear;
    webgl.info.autoReset = prevAutoReset;
  }

  private warm(webgl: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.warmRT ??= new THREE.WebGLRenderTarget(8, 8);
    const prevTarget = webgl.getRenderTarget();
    const prevAutoClear = webgl.autoClear;
    const prevAutoReset = webgl.info.autoReset;
    webgl.info.autoReset = false;
    // Allocate the full-resolution scene copy now too, against the canvas it
    // will copy from: left to the first goal, the glTexImage2D for a whole
    // drawing buffer (plus the first framebuffer copy into it) lands on the
    // exact frame the celebration starts.
    const size = webgl.getDrawingBufferSize(TMP_SIZE);
    if (size.x >= 1 && size.y >= 1) {
      this.ensureSceneTex(size.x, size.y);
      const sceneTex = this.sceneTex;
      if (sceneTex) {
        webgl.setRenderTarget(null);
        webgl.copyFramebufferToTexture(sceneTex);
      }
    }
    webgl.setRenderTarget(this.warmRT);
    webgl.autoClear = false;
    this.drainMat.uniforms.tScene.value = this.warmTex;
    this.quad.render(webgl);
    for (const mesh of this.shells) {
      mesh.visible = true;
      mesh.scale.setScalar(1);
      (mesh.material as THREE.ShaderMaterial).uniforms.uFade.value = 0.002;
    }
    webgl.render(this.fxScene, camera);
    for (const mesh of this.shells) mesh.visible = false;
    webgl.setRenderTarget(prevTarget);
    webgl.autoClear = prevAutoClear;
    webgl.info.autoReset = prevAutoReset;
  }

  private ensureSceneTex(width: number, height: number): void {
    if (
      this.sceneTex &&
      this.sceneTex.image.width === width &&
      this.sceneTex.image.height === height
    )
      return;
    this.sceneTex?.dispose();
    const tex = new THREE.FramebufferTexture(width, height);
    // FramebufferTexture defaults to NearestFilter; the buckle samples off the
    // texel grid, and nearest turns that into stair-stepped edges.
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.sceneTex = tex;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.shellGeo.dispose();
    for (const mesh of this.shells) (mesh.material as THREE.ShaderMaterial).dispose();
    this.quad.dispose();
    this.drainMat.dispose();
    this.sceneTex?.dispose();
    this.warmRT?.dispose();
    this.warmTex.dispose();
  }
}
