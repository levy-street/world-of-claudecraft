// The Tidesow: the deepball itself.
//
// A machined metal sphere with a caught lantern-wisp behind glass at each pole,
// wrapped in an aura that reads its SPEED. At rest there is no aura at all; as
// it is struck the shell blooms orange, cools through blue, and burns violet at
// the cap. That ramp is the point — across a 76-yard bell you often cannot
// judge how hard a shot was struck from motion alone, and a keeper needs to
// know at a glance whether what is coming is a lob or a rocket.
//
// Replaces the Vale Cup's stitched-leather boarball inside the arena only; the

import * as THREE from 'three';
import { DEEPGLASS_BALL_MOB } from '../sim/deepglass/abilities';
import { DG_BALL_MAX_SPEED, DG_BALL_RADIUS } from '../sim/deepglass/ball';

/**
 * BASE (unscaled) draw radius, derived from the SIM's physics radius and the
 * entity scale the ball's mob template carries, exactly as the Vale Cup ball
 * derives its own. The renderer scales the whole
 * group by `e.scale`, so handing it the raw physics radius drew a Tidesow
 * 1.54x too big.
 *
 * There is no vertical lift here either, and that is the other half of the
 * same bug: the Vale Cup's sim `y` is a GROUND-RESTING coordinate, so its view
 * lifts the sphere by a radius to sit it on the pitch. The Deepglass ball
 * floats, and its sim `y` IS the centre (see reflectOffBell / escapedThroughHole),
 * so every part of this view sits at y = 0 in group space.
 *
 * Getting these wrong drew a ball whose lower hemisphere was empty water and
 * whose upper cap could never be hit at any horizontal offset: the "I flew
 * straight through it" report.
 */
const DRAW_R = DG_BALL_RADIUS / DEEPGLASS_BALL_MOB.scale;

const POLE_GLOW = 0xbfe9ff;
/** The tracking reticle's green. Deliberately neither team's colour. */
const RETICLE_GREEN = 0x39ff6e;
/** The singularity's accretion tint as the ball collapses on a goal. */
const COLLAPSE_TINT = 0xb388ff;

/** Aura stops, in order. Alpha is 0 at rest and only opens past IDLE_CUT, so a
 *  parked ball is plain metal. */
const AURA_IDLE_CUT = 0.06;

function metalMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9fb0bd,
    metalness: 0.95,
    roughness: 0.24,
    emissive: 0x0a1a26,
    emissiveIntensity: 1,
  });
  // Banded plating: latitude seams darkened into the metal, plus a faint
  // brushed grain, so the sphere reads as machined rather than as a chrome
  // bauble — and so its SPIN is legible (an unmarked metal ball looks static
  // however fast it rolls).
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vDgLocal;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float lat = normalize(vDgLocal).y;
          float band = smoothstep(0.02, 0.0, abs(fract(lat * 6.0) - 0.5) - 0.44);
          float grain = 0.04 * sin(vDgLocal.x * 90.0) * sin(vDgLocal.z * 90.0);
          diffuseColor.rgb *= (1.0 - band * 0.55) + grain;
        }`,
      );
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vDgLocal;`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n        vDgLocal = position;`);
  };
  return mat;
}

/** The speed aura: a hollow shell whose colour walks orange -> blue -> violet. */
function auraMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSpeed: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uSpeed;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float s = clamp(uSpeed, 0.0, 1.0);
        // Orange -> blue over the first half, blue -> violet over the second.
        vec3 warm = vec3(1.00, 0.44, 0.10);
        vec3 cool = vec3(0.20, 0.62, 1.00);
        vec3 hot  = vec3(0.66, 0.24, 1.00);
        vec3 c = s < 0.5 ? mix(warm, cool, s / 0.5) : mix(cool, hot, (s - 0.5) / 0.5);
        // Hollow: bright at the silhouette so the ball stays readable through it.
        float rim = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0), 2.2);
        // A fast shimmer that only shows up once the ball is really moving.
        float shimmer = 1.0 + 0.25 * s * sin(uTime * 22.0 + vN.y * 9.0);
        float a = rim * s * shimmer * 0.85;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(c * (0.7 + rim), a);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });
}

export interface TidesowBuild {
  group: THREE.Group;
  /** Rolls with the ball; the renderer premultiplies roll onto it. */
  spinner: THREE.Mesh;
  height: number;
  /**
   * Feed the live ball speed (yd/s) each frame.
   *
   * `camQuat` billboards the tracking reticle at the camera; `collapse` (0..1)
   * drives the goal singularity — the ball implodes to a point under an
   * accretion swirl; `reticleOn` shows/hides the green tracking reticle.
   */
  update(
    speed: number,
    dt: number,
    camQuat?: THREE.Quaternion,
    collapse?: number,
    reticleOn?: boolean,
  ): void;
  dispose(): void;
}

/** A dashed, spinning reticle ring: vUv.x runs around the torus, carved into
 *  travelling segments. Always drawn on top (depthTest off) — the reticle is
 *  HUD-in-world, and losing it behind a body defeats its purpose. */
function reticleMaterial(spin: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(RETICLE_GREEN) },
      uSpin: { value: spin },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uSpin;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float travel = vUv.x * 8.0 + uTime * uSpin;
        float seg = smoothstep(0.18, 0.3, abs(fract(travel) - 0.5));
        float pulse = 0.8 + 0.2 * sin(uTime * 3.4);
        gl_FragColor = vec4(uColor * (0.9 + 0.8 * seg) * pulse, (0.25 + 0.75 * seg) * pulse);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** The accretion swirl: a ring of sparks spiralling into the collapsing ball.
 *  Driven entirely by uT (the collapse phase) so it needs no per-frame CPU. */
function swirlMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uT: { value: 0 },
      uColor: { value: new THREE.Color(COLLAPSE_TINT) },
    },
    vertexShader: `
      uniform float uT;
      attribute float aAng;
      attribute float aRad;
      attribute float aPh;
      varying float vFade;
      void main() {
        // Spiral in: radius closes as the collapse advances, angle winds up.
        float r = aRad * (1.0 - uT * 0.92);
        float a = aAng + uT * (7.0 + aPh * 2.0);
        float tilt = sin(aPh * 6.28) * 0.6;
        vec3 p = vec3(cos(a) * r, sin(a) * r * (0.4 + 0.6 * abs(tilt)), sin(a + aPh) * r * 0.7);
        vFade = smoothstep(0.0, 0.15, uT) * (1.0 - uT * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp((2.2 + aPh) * (34.0 / -mv.z), 1.0, 7.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vFade;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(uColor, vFade);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function buildTidesow(): TidesowBuild {
  const group = new THREE.Group();

  const spinner = new THREE.Mesh(new THREE.SphereGeometry(DRAW_R, 32, 24), metalMaterial());
  spinner.castShadow = true;
  group.add(spinner);

  // The wisp lenses: a glass cap at each pole with a light inside. Parented to
  // the spinner so they travel with the roll — they are part of the ball, and
  // watching them tumble is most of how you read its spin.
  const lensGeo = new THREE.SphereGeometry(DRAW_R * 0.3, 16, 12);
  const lensMat = new THREE.MeshBasicMaterial({
    color: POLE_GLOW,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const lenses: THREE.Mesh[] = [];
  for (const sign of [1, -1]) {
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.y = sign * DRAW_R * 0.88;
    lens.renderOrder = 3;
    spinner.add(lens);
    lenses.push(lens);
  }
  const poleLight = new THREE.PointLight(POLE_GLOW, 2.2, 16, 2);
  group.add(poleLight);

  const aura = new THREE.Mesh(new THREE.SphereGeometry(DRAW_R * 1.5, 28, 20), auraMaterial());
  aura.renderOrder = 6;
  group.add(aura);

  // ---- the tracking reticle -------------------------------------------------
  // Two counter-rotating dashed rings billboarded at the camera, drawn INSIDE
  // the ball's silhouette: a target painted on the Tidesow rather than a hoop
  // floating around it, so the rings say "hit HERE" as well as "the ball is
  // there". Sitting on the ball also means the dark metal is their backing,
  // which is what keeps them readable against a bright sky. Drawn through
  // everything (depthTest off) so a body in front never hides the ball.
  const reticle = new THREE.Group();
  const reticleMats: THREE.ShaderMaterial[] = [];
  for (const [radius, spin] of [
    [DRAW_R * 0.72, 0.9],
    [DRAW_R * 0.44, -1.3],
  ] as const) {
    const mat = reticleMaterial(spin);
    reticleMats.push(mat);
    const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 6, 48), mat);
    ringMesh.renderOrder = 18;
    ringMesh.frustumCulled = false;
    reticle.add(ringMesh);
  }
  group.add(reticle);

  // ---- the goal singularity -------------------------------------------------
  // An accretion swirl spiralling into the ball as it implodes, and a bright
  // core that peaks as it vanishes. Driven by the collapse phase from the
  // renderer (match phase 'goal'), reset by the next kickoff.
  const SWIRL_N = 72;
  const swirlGeo = new THREE.BufferGeometry();
  {
    const ang = new Float32Array(SWIRL_N);
    const rad = new Float32Array(SWIRL_N);
    const ph = new Float32Array(SWIRL_N);
    let h = 4242;
    const rnd = (): number => {
      h = (h * 1103515245 + 12345) & 0x7fffffff;
      return h / 0x7fffffff;
    };
    for (let i = 0; i < SWIRL_N; i++) {
      ang[i] = rnd() * Math.PI * 2;
      rad[i] = 2.6 + rnd() * 2.4;
      ph[i] = rnd();
    }
    swirlGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SWIRL_N * 3), 3));
    swirlGeo.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
    swirlGeo.setAttribute('aRad', new THREE.BufferAttribute(rad, 1));
    swirlGeo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  }
  const swirlMat = swirlMaterial();
  const swirl = new THREE.Points(swirlGeo, swirlMat);
  swirl.renderOrder = 17;
  swirl.frustumCulled = false;
  swirl.visible = false;
  group.add(swirl);

  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(DRAW_R * 0.5, 16, 12), flashMat);
  flash.renderOrder = 17;
  flash.visible = false;
  group.add(flash);

  const auraMat = aura.material as THREE.ShaderMaterial;
  let time = 0;
  let shown = 0;

  // The Tidesow floats: its sim `y` is the ball's centre, so nothing in this
  // view is lifted (see DRAW_R). Published for the shared ball update path,
  // which otherwise assumes the boarball's ground-resting lift.
  group.userData.ballCentreLift = 0;

  return {
    group,
    spinner,
    height: DRAW_R * 2,
    update(speed, dt, camQuat, collapse = 0, reticleOn = true) {
      time += dt;
      auraMat.uniforms.uTime.value = time;
      const target = Math.max(0, Math.min(1, speed / DG_BALL_MAX_SPEED));
      // Ease so a trap does not snap the aura off mid-flight.
      shown += (target - shown) * (1 - Math.exp(-dt * 9));
      // A collapsing ball burns at full aura whatever its speed: the
      // singularity should read hot even though the ball is parked in the net.
      shown = Math.max(shown, collapse);
      const lit = shown < AURA_IDLE_CUT ? 0 : (shown - AURA_IDLE_CUT) / (1 - AURA_IDLE_CUT);
      auraMat.uniforms.uSpeed.value = lit;
      aura.visible = lit > 0.001 && collapse < 0.85;
      // The pole wisps brighten with pace too, so even a still ball is a lamp
      // and a struck one is a flare.
      lensMat.opacity = 0.75 + 0.25 * lit;
      poleLight.intensity = 2.2 + 6 * lit;

      // ---- reticle ---------------------------------------------------------
      const showReticle = reticleOn && collapse < 0.05;
      reticle.visible = showReticle;
      if (showReticle) {
        if (camQuat) reticle.quaternion.copy(camQuat);
        const pulse = 1 + 0.06 * Math.sin(time * 3.4);
        reticle.scale.setScalar(pulse);
        for (const m of reticleMats) m.uniforms.uTime.value = time;
      }

      // ---- singularity -----------------------------------------------------
      if (collapse > 0.001) {
        // Accelerating implosion: linger, then snap shut.
        const t = Math.min(1, collapse);
        const shrink = Math.max(0.02, 1 - t * t * 1.05);
        spinner.scale.setScalar(Math.max(0.02, shrink));
        swirl.visible = true;
        swirlMat.uniforms.uT.value = t;
        flash.visible = true;
        flashMat.opacity = t ** 3 * 0.95;
        flash.scale.setScalar(0.6 + 2.6 * t ** 2);
        poleLight.intensity = 2.2 + 14 * t;
      } else {
        if (spinner.scale.x !== 1) spinner.scale.setScalar(1);
        if (swirl.visible) swirl.visible = false;
        if (flash.visible) {
          flash.visible = false;
          flashMat.opacity = 0;
        }
      }
    },
    dispose() {
      spinner.geometry.dispose();
      (spinner.material as THREE.Material).dispose();
      lensGeo.dispose();
      lensMat.dispose();
      aura.geometry.dispose();
      auraMat.dispose();
      for (const m of reticleMats) m.dispose();
      for (const r of reticle.children) (r as THREE.Mesh).geometry?.dispose();
      swirlGeo.dispose();
      swirlMat.dispose();
      flash.geometry.dispose();
      flashMat.dispose();
      for (const l of lenses) l.removeFromParent();
    },
  };
}
