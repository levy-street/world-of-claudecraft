// The Mere Hydra's Tsunami, drawn (plan: temple_tsunami_core.ts; composed by
// temple_hydra_fx.ts). A breaking wave: its wall stands up on the rim while
// the heads' bar runs, its crest feathering; on the roll it rears, the lip
// throws forward and curls over, spindrift blowing back off the crest,
// droplets flung off the lip and white water churning at its toe; it crashes
// on the middle line in a plume of spray and leaves a thin lace of foam over
// the half it swept that thins away over a few seconds. The floor half-disc
// the wave will sweep is temple_fx.ts's telegraph.
//
// Layers, bottom to top on the floor ladder's GROUND band (every one of them
// under the encounter-band telegraph, which therefore always paints over the
// wave, its spray and its foam):
//  - the lingering foam: flat lace patches on the Crypt particle kit's
//    launch attributes, normal-blended, at most TSUNAMI_FOAM_PEAK_ALPHA;
//  - the wave: one mesh of two strips (the front face, lip and curl from the
//    core's profile table; the convex back slope), depth and fresnel shaded,
//    normal-blended, every channel capped at TSUNAMI_LOOK.maxChannel (well
//    under the bloom threshold);
//  - the spray: misty puffs (spindrift, churn, the crash plume) and droplets,
//    normal-blended, never additive.
//
// Every mesh, geometry and material is built once in the constructor under the
// temple root that attaches through the compile gate; the wave is present from
// the start (collapsed) and the pools start hidden, so nothing links after
// boot. Nothing allocates per frame. A low tier sheds spray and foam density
// and mesh detail only; the wave's position and timing read the same state on
// every tier. Cosmetic: driven by the wave object and the heads' bar off
// IWorld, so offline and online look the same.

import * as THREE from 'three';
import { HYDRA_TUNING } from '../../sim/encounters/drowned_temple/ids';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';
import {
  makeTsunamiFoamPatch,
  makeTsunamiProfileSummary,
  makeTsunamiShape,
  TSUNAMI_BACK_DEPTH,
  TSUNAMI_CRASH_SECONDS,
  TSUNAMI_FOAM_DRIFT,
  TSUNAMI_FOAM_FADE_GLSL,
  TSUNAMI_FOAM_LIFE_MAX,
  TSUNAMI_FOAM_LIFE_MIN,
  TSUNAMI_FOAM_MAX_ALONG,
  TSUNAMI_FOAM_SIZE_MIN,
  TSUNAMI_LOOK,
  TSUNAMI_POOL_WATER_DROP,
  TSUNAMI_PROFILE_POINTS,
  TSUNAMI_SHOULDER_CURL,
  TSUNAMI_SHOULDER_GLSL,
  TSUNAMI_TIERS,
  TSUNAMI_WARN_SECONDS,
  TSUNAMI_WIDTH,
  type TsunamiShoulder,
  type TsunamiSprayRates,
  type TsunamiTier,
  tsunamiFoamPatchInto,
  tsunamiProfileInto,
  tsunamiShapeInto,
  tsunamiShoulder,
  tsunamiSprayRatesInto,
  tsunamiTier,
} from './temple_tsunami_core';

// ---- the Tsunami's breaking wave -------------------------------------------------------

const PN = TSUNAMI_PROFILE_POINTS;
const glf = (n: number) => n.toFixed(4);

// One mesh, two strips: the FRONT face (toe, concave face, crest, the lip that
// throws and curls) read from the core's profile table, and the convex BACK
// slope from its foot up to the crest, so a side view has body and depth.
const WAVE_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aProf; // v (0 foot, 1 top of the strip), side (0 face, 1 back), u across
uniform vec3 uProf[${PN}];
uniform vec3 uSoft[${PN}];
uniform vec2 uCrestM;
uniform vec2 uCrestS;
uniform float uWidth;
uniform float uTime;
uniform float uCollapse;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vProf; // v, side, u, height over the crest
${TSUNAMI_SHOULDER_GLSL}
vec3 profM(float v) {
  float f = clamp(v, 0.0, 1.0) * ${PN - 1}.0;
  int i = int(min(floor(f), ${PN - 2}.0));
  return mix(uProf[i], uProf[i + 1], f - float(i));
}
vec3 profS(float v) {
  float f = clamp(v, 0.0, 1.0) * ${PN - 1}.0;
  int i = int(min(floor(f), ${PN - 2}.0));
  return mix(uSoft[i], uSoft[i + 1], f - float(i));
}
void main() {
  float v = aProf.x;
  float side = aProf.y;
  float u = aProf.z;
  float e = abs(u - 0.5) * 2.0;
  float sb = tsunamiShoulderSoft(e);
  float x = (u - 0.5) * uWidth;
  float s = tsunamiShoulderHeight(e)
          * (1.0 + 0.07 * sin(x * 0.21 + uTime * 0.7) + 0.04 * sin(x * 0.57 - uTime * 1.3));
  vec2 crest = mix(uCrestM, uCrestS, sb);
  vec2 zy;
  vec2 nzy;
  if (side < 0.5) {
    vec3 p = mix(profM(v), profS(v), sb);
    zy = p.xy;
    nzy = vec2(sin(p.z), -cos(p.z));
  } else {
    float D = ${glf(TSUNAMI_BACK_DEPTH)} * crest.y;
    vec2 p0 = vec2(crest.x - D, 0.0);
    vec2 p1 = vec2(crest.x - D * 0.35, crest.y);
    float it = 1.0 - v;
    zy = it * it * p0 + 2.0 * it * v * p1 + v * v * crest;
    vec2 d = 2.0 * it * (p1 - p0) + 2.0 * v * (crest - p1);
    nzy = normalize(vec2(-d.y, d.x) + 1e-5);
  }
  float h01 = zy.y / max(crest.y, 1e-3);
  zy *= s;
  zy.x -= tsunamiShoulderLag(e);
  // The lip's edge ripples as it throws.
  zy.x += sin(x * 0.45 + uTime * 3.0) * 0.25 * smoothstep(0.6, 1.0, v) * (1.0 - side);
  // Broken: the upper water throws forward and slumps into the floor.
  zy.x += uCollapse * 3.0 * h01;
  zy.y *= pow(max(1.0 - uCollapse, 0.0), 1.5);
  vec4 w = modelMatrix * vec4(x, zy.y, zy.x, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * vec3(0.0, nzy.y, nzy.x));
  vProf = vec4(v, side, u, h01);
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;

const WAVE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uWidth;
uniform float uFoam;
uniform float uFoamStart;
uniform float uChurn;
uniform vec3 uDeep;
uniform vec3 uBody;
uniform vec3 uCrest;
uniform vec3 uSky;
uniform vec3 uFoamCol;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vProf;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float v = vProf.x;
  float back = vProf.y;
  float front = 1.0 - back;
  float u = vProf.z;
  float up = clamp(vProf.w, 0.0, 1.0);
  float e = abs(u - 0.5) * 2.0;
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = abs(dot(normalize(vN), V));
  float fres = pow(max(1.0 - ndv, 0.0), 3.0);
  // Thick and dark at the foot, thinning toward the lip, where light passes
  // through the water (strongest face-on, the way a backlit lip glows).
  float thin = front * smoothstep(0.5, 0.92, v);
  vec3 col = mix(uDeep, uBody, smoothstep(0.0, 0.85, up));
  col = mix(col, uCrest, thin * (0.45 + 0.55 * ndv));
  // Streaks and caustics flowing UP the face into the lip.
  vec2 q = vec2(u * uWidth * 0.22, v * 3.2 - uTime * 0.9);
  float warp = vnoise(q * 1.3 + vec2(0.0, uTime * 0.3));
  float streak = vnoise(vec2(u * uWidth * 0.55 + warp * 1.5, v * 1.6 - uTime * 1.25));
  float caustic = pow(max(1.0 - abs(vnoise(q * 2.1 + warp * 2.0) * 2.0 - 1.0), 0.0), 6.0);
  col += uCrest * (caustic * 0.35 + smoothstep(0.55, 0.85, streak) * 0.18)
       * (0.3 + 0.7 * up) * (0.6 + 0.4 * thin);
  // The sky's sheen at grazing angles.
  col = mix(col, uSky, fres * 0.45);
  // Whitewater: the white lip, the crest line over the back, lace trailing
  // down the face, churn at the toe.
  float fn = vnoise(vec2(u * uWidth * 0.8, v * 7.0 - uTime * 1.6)) * 0.6
           + vnoise(vec2(u * uWidth * 1.9, v * 15.0 + uTime * 0.7)) * 0.4;
  float lip = front * smoothstep(uFoamStart, uFoamStart + 0.1, v + (fn - 0.5) * 0.22);
  float crestLine = back * smoothstep(0.86, 0.99, v + (fn - 0.5) * 0.15);
  float lace = front * smoothstep(0.66, 0.82, fn) * smoothstep(0.25, 0.7, v) * (1.0 - lip) * 0.55;
  float churn = front * smoothstep(0.14, 0.0, v) * smoothstep(0.35, 0.6, fn) * uChurn;
  float foam = clamp((lip + crestLine + lace) * uFoam + churn, 0.0, 1.0);
  col = mix(col, uFoamCol * (0.82 + 0.18 * fn), foam);
  col = min(col, vec3(${glf(TSUNAMI_LOOK.maxChannel)}));
  float a = mix(0.9, 0.72, thin);
  a = mix(a, 0.95, foam);
  // Melt into the floor at the feet, and away at the shoulders' ends.
  a *= max(smoothstep(0.0, 0.06, v), churn * front);
  a *= 1.0 - smoothstep(0.8, 1.0, e);
  gl_FragColor = vec4(col, a * uAlpha);
  #include <colorspace_fragment>
}
`;

// The lingering foam: flat lace patches lying on the floor and the pool's
// water, on the Crypt kit's launch attributes (ParticlePool), drifting a hand
// along the heading and opening into holes as they thin away.
const FOAM_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
uniform float uTime;
attribute vec3 aPos0;
attribute vec3 aVel;
attribute vec3 aAcc;
attribute vec4 aLife;   // birth, life, drag, floor
attribute vec4 aShape;  // size0, size1, yaw, seed
attribute vec4 aColor;
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float age = uTime - aLife.x;
  float t = age / max(aLife.y, 1e-3);
  vT = t;
  vSeed = aShape.w;
  vColor = aColor;
  vUv = position.xy + 0.5;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float drag = max(aLife.z, 1e-3);
  vec3 p = aPos0 + aVel * (1.0 - exp(-drag * age)) / drag;
  float size = mix(aShape.x, aShape.y, t);
  float c = cos(aShape.z), s = sin(aShape.z);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * size;
  gl_Position = projectionMatrix * wocCamRelView(vec3(p.x + q.x, p.y, p.z + q.y));
}
`;

const FOAM_FRAG = /* glsl */ `
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
${TSUNAMI_FOAM_FADE_GLSL}
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float n = vnoise(vUv * 5.0 + vSeed * 31.0) * 0.55
          + vnoise(vUv * 11.0 - vSeed * 17.0) * 0.3
          + vnoise(vUv * 23.0 + vSeed * 7.0) * 0.15;
  // An irregular blotch, never a ring, and never past the patch's own radius.
  float blob = (1.0 - smoothstep(0.3, 0.85, d + (n - 0.5) * 0.5)) * (1.0 - smoothstep(0.9, 1.0, d));
  // The bubbles open into holes as the lace thins.
  float lace = smoothstep(0.3 + 0.35 * vT, 0.55 + 0.35 * vT, n);
  gl_FragColor = vec4(vColor.rgb * (0.8 + 0.2 * n), blob * lace * tsunamiFoamAlpha(vT) * vColor.a);
  #include <colorspace_fragment>
}
`;

/** The wave's two strips as one geometry: `aProf` carries (v, side, u); the
 *  vertex shader places every vertex from the uniforms. */
function buildWaveGeometry(cols: number, faceRows: number, backRows: number): THREE.BufferGeometry {
  const strips: [number, number][] = [
    [0, faceRows],
    [1, backRows],
  ];
  const prof: number[] = [];
  const index: number[] = [];
  for (const [side, rows] of strips) {
    const base = prof.length / 3;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) prof.push(r / rows, side, c / cols);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * (cols + 1) + c;
        const b = a + cols + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  const count = prof.length / 3;
  // A placeholder position (three wants one); the shader never reads it.
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aProf', new THREE.BufferAttribute(new Float32Array(prof), 3));
  geo.setIndex(index);
  return geo;
}

const vec3Of = (c: readonly number[]) => new THREE.Vector3(c[0], c[1], c[2]);

/** The Tsunami's wave object as the painter reads it: its rim spot, heading
 *  and state, and how far the heads' bar has built it (null when no bar is
 *  readable). */
export interface TsunamiWaveInput {
  x: number;
  y: number;
  z: number;
  facing: number;
  rolling: boolean;
  build: number | null;
}

export class TempleTsunamiFx {
  private readonly materials: THREE.Material[] = [];
  private readonly tier: TsunamiTier;
  private readonly spray: ParticlePool;
  private readonly drops: ParticlePool;
  private readonly foam: ParticlePool;
  private readonly wave: THREE.Mesh;
  private readonly waveUniforms: {
    uTime: { value: number };
    uAlpha: { value: number };
    uWidth: { value: number };
    uFoam: { value: number };
    uFoamStart: { value: number };
    uChurn: { value: number };
    uCollapse: { value: number };
    uProf: { value: Float32Array };
    uSoft: { value: Float32Array };
    uCrestM: { value: THREE.Vector2 };
    uCrestS: { value: THREE.Vector2 };
    uDeep: { value: THREE.Vector3 };
    uBody: { value: THREE.Vector3 };
    uCrest: { value: THREE.Vector3 };
    uSky: { value: THREE.Vector3 };
    uFoamCol: { value: THREE.Vector3 };
  };
  private readonly shape = makeTsunamiShape();
  private readonly lip = makeTsunamiProfileSummary();
  private readonly softLip = makeTsunamiProfileSummary();
  private readonly rates: TsunamiSprayRates = { spindrift: 0, lip: 0, churn: 0 };
  private readonly patch = makeTsunamiFoamPatch();
  private readonly shoulder: TsunamiShoulder = { height: 1, soft: 0, lag: 0 };
  private readonly spec: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  /** The wave's life on screen: seconds since first drawn (0 = none), how far
   *  it had built and rolled, and seconds since it landed (negative while it
   *  stands). */
  private waveSeen = 0;
  private waveBuild = 0;
  private waveRoll = 0;
  private waveCrash = -1;
  /** Its rim spot on the floor, its toe now, its heading. */
  private readonly waveStart = new THREE.Vector3();
  private readonly waveAt = new THREE.Vector3();
  private fx = 0;
  private fz = 1;
  private readonly sprayDebt = [0, 0, 0];
  private foamDebt = 0;
  private lastTravel = 0;
  private seed = 7;

  /** `uTime` is the Hydra visuals' shared clock uniform (the particles' GPU
   *  advection reads it); `groundY` finds the rim floor under the wave. */
  constructor(
    root: THREE.Group,
    detail: boolean,
    uTime: { value: number },
    private readonly groundY?: (x: number, z: number) => number,
  ) {
    this.tier = tsunamiTier(detail);
    const plan = TSUNAMI_TIERS[this.tier];
    const particles = (frag: string, name: string) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      this.materials.push(m);
      return m;
    };
    const sprayOrder = floorVfxRenderOrder('ground', 7);
    this.spray = new ParticlePool(
      plan.sprayCapacity,
      particles(DUST_FRAG, 'drownedTempleTsunamiSpray'),
      sprayOrder,
    );
    this.drops = new ParticlePool(
      plan.dropCapacity,
      particles(GLOW_FRAG, 'drownedTempleTsunamiDrops'),
      sprayOrder,
    );
    const foamMat = new THREE.ShaderMaterial({
      name: 'drownedTempleTsunamiFoam',
      uniforms: { uTime },
      vertexShader: FOAM_VERT,
      fragmentShader: FOAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.materials.push(foamMat);
    this.foam = new ParticlePool(plan.foamCapacity, foamMat, floorVfxRenderOrder('ground', 4));
    this.waveUniforms = {
      uTime,
      uAlpha: { value: 0 },
      uWidth: { value: TSUNAMI_WIDTH },
      uFoam: { value: 0 },
      uFoamStart: { value: 1 },
      uChurn: { value: 0 },
      uCollapse: { value: 0 },
      uProf: { value: new Float32Array(TSUNAMI_PROFILE_POINTS * 3) },
      uSoft: { value: new Float32Array(TSUNAMI_PROFILE_POINTS * 3) },
      uCrestM: { value: new THREE.Vector2() },
      uCrestS: { value: new THREE.Vector2() },
      uDeep: { value: vec3Of(TSUNAMI_LOOK.deep) },
      uBody: { value: vec3Of(TSUNAMI_LOOK.body) },
      uCrest: { value: vec3Of(TSUNAMI_LOOK.crest) },
      uSky: { value: vec3Of(TSUNAMI_LOOK.sky) },
      uFoamCol: { value: vec3Of(TSUNAMI_LOOK.foam) },
    };
    const waveMat = new THREE.ShaderMaterial({
      name: 'drownedTempleTsunami',
      uniforms: this.waveUniforms,
      vertexShader: WAVE_VERT,
      fragmentShader: WAVE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(waveMat);
    this.wave = new THREE.Mesh(buildWaveGeometry(plan.cols, plan.faceRows, plan.backRows), waveMat);
    this.wave.name = 'drownedTempleTsunami';
    this.wave.frustumCulled = false;
    this.wave.renderOrder = floorVfxRenderOrder('ground', 6);
    // Present from the start (collapsed): its program links with the temple.
    this.wave.scale.setScalar(1e-4);
    root.add(this.foam.mesh, this.wave, this.spray.mesh, this.drops.mesh);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  update(dt: number, clock: number, w: TsunamiWaveInput | null): void {
    this.updateWave(dt, clock, w);
    this.spray.update(clock);
    this.drops.update(clock);
    this.foam.update(clock);
  }

  /** A new wave stands up on its rim spot. */
  private startWave(w: TsunamiWaveInput): void {
    this.fx = Math.sin(w.facing);
    this.fz = Math.cos(w.facing);
    // The rim floor just inside the wave's spot (the object sits on the rim's
    // very edge, where the ground may already fall to the lagoon).
    const inX = w.x + this.fx * 1.5;
    const inZ = w.z + this.fz * 1.5;
    const floor = this.groundY ? this.groundY(inX, inZ) : w.y;
    this.waveStart.set(w.x, Number.isFinite(floor) ? floor : w.y, w.z);
    this.wave.rotation.set(0, w.facing, 0);
    this.waveSeen = 0;
    this.waveBuild = 0;
    this.waveRoll = 0;
    this.waveCrash = -1;
    this.lastTravel = 0;
    this.foamDebt = 0;
    this.sprayDebt.fill(0);
  }

  private updateWave(dt: number, clock: number, w: TsunamiWaveInput | null): void {
    const live = this.waveSeen > 0;
    if (this.waveCrash >= 0) {
      // A broken wave plays its crash out, even when the heroic backwash has
      // already raised the next one (that one stands up right after).
      this.waveCrash += dt;
      if (this.waveCrash >= TSUNAMI_CRASH_SECONDS) {
        this.waveSeen = 0;
        this.waveCrash = -1;
      }
    } else if (w) {
      if (!live) this.startWave(w);
      this.waveSeen += dt;
      this.waveBuild = w.build ?? Math.min(1, this.waveSeen / TSUNAMI_WARN_SECONDS);
      if (w.rolling) this.waveRoll = Math.min(1, this.waveRoll + dt / HYDRA_TUNING.tsunamiRoll);
    } else if (live) {
      // The object is gone: the wave broke on the middle line.
      this.waveCrash = 0;
      this.crashBurst(clock);
    }
    if (this.waveSeen <= 0) {
      this.wave.scale.setScalar(1e-4);
      this.waveUniforms.uAlpha.value = 0;
      return;
    }
    const s = this.shape;
    tsunamiShapeInto(s, this.waveBuild, this.waveRoll, this.waveCrash, this.waveSeen);
    const u = this.waveUniforms;
    tsunamiProfileInto(u.uProf.value, s.height, s.curl, this.lip);
    tsunamiProfileInto(u.uSoft.value, s.height, s.curl * TSUNAMI_SHOULDER_CURL, this.softLip);
    u.uCrestM.value.set(this.lip.crestZ, this.lip.crestY);
    u.uCrestS.value.set(this.softLip.crestZ, this.softLip.crestY);
    u.uAlpha.value = s.alpha;
    u.uFoam.value = s.foam;
    u.uFoamStart.value = s.foamStart;
    u.uChurn.value = s.churn;
    u.uCollapse.value = s.collapse;
    this.waveAt.set(
      this.waveStart.x + this.fx * s.travel,
      this.waveStart.y,
      this.waveStart.z + this.fz * s.travel,
    );
    this.wave.position.copy(this.waveAt);
    this.wave.scale.setScalar(1);
    if (this.waveCrash >= 0) return;
    this.emitWaveSpray(dt, clock);
    this.layFoamTrail(clock, s.travel);
  }

  /** A point on the wave (heading-local: x across, y up, z forward of the toe)
   *  in world space, into the scratch particle spec. */
  private placeOnWave(x: number, y: number, z: number): void {
    this.spec.x = this.waveAt.x + this.fz * x + this.fx * z;
    this.spec.y = this.waveAt.y + y;
    this.spec.z = this.waveAt.z - this.fx * x + this.fz * z;
  }

  /** A random point across the wave's middle: sets the shoulder and returns x. */
  private acrossWave(spanShare: number): number {
    const u = 0.5 + (this.rand() - 0.5) * spanShare;
    tsunamiShoulder(Math.abs(u - 0.5) * 2, this.shoulder);
    return (u - 0.5) * TSUNAMI_WIDTH;
  }

  /** Set the scratch spec's velocity from heading-local components. */
  private velocity(side: number, up: number, fwd: number): void {
    this.spec.vx = this.fz * side + this.fx * fwd;
    this.spec.vy = up;
    this.spec.vz = -this.fx * side + this.fz * fwd;
  }

  private tint(c: readonly number[], a: number): void {
    this.spec.r = c[0];
    this.spec.g = c[1];
    this.spec.b = c[2];
    this.spec.a = a;
  }

  private emitWaveSpray(dt: number, clock: number): void {
    const rates = tsunamiSprayRatesInto(this.rates, this.tier, this.waveBuild, this.waveRoll);
    const sp = this.spec;
    const sh = this.shoulder;
    this.sprayDebt[0] += rates.spindrift * dt;
    while (this.sprayDebt[0] >= 1) {
      this.sprayDebt[0] -= 1;
      // Spindrift: blown back off the feathering crest.
      const x = this.acrossWave(0.8);
      this.placeOnWave(x, this.lip.crestY * sh.height, this.lip.crestZ * sh.height - sh.lag);
      this.velocity((this.rand() - 0.5) * 2, 2.5 + this.rand() * 2.5, -(2 + this.rand() * 3));
      sp.ax = 0;
      sp.ay = -3;
      sp.az = 0;
      sp.drag = 1.1;
      sp.floor = -1e6;
      sp.life = 1.1 + this.rand() * 0.7;
      // fine, thin spindrift: many soft wisps, never cotton puffs
      sp.size0 = 0.5;
      sp.size1 = 1.8;
      sp.spin = (this.rand() - 0.5) * 2;
      sp.seed = this.rand();
      this.tint(TSUNAMI_LOOK.spray, 0.14 + this.rand() * 0.08);
      this.spray.emit(clock, sp);
    }
    this.sprayDebt[1] += rates.lip * dt;
    while (this.sprayDebt[1] >= 1) {
      this.sprayDebt[1] -= 1;
      // Droplets flung off the throwing lip.
      const x = this.acrossWave(0.7);
      this.placeOnWave(x, this.lip.tipY * sh.height, this.lip.tipZ * sh.height - sh.lag);
      this.velocity((this.rand() - 0.5) * 2.5, 1 + this.rand() * 2.5, 5 + this.rand() * 4);
      sp.ax = 0;
      sp.ay = -11;
      sp.az = 0;
      sp.drag = 0.4;
      sp.floor = this.waveAt.y - TSUNAMI_POOL_WATER_DROP;
      sp.life = 0.8 + this.rand() * 0.6;
      sp.size0 = 0.34;
      sp.size1 = 0.16;
      sp.spin = 0;
      sp.seed = this.rand();
      this.tint(TSUNAMI_LOOK.drop, 0.9);
      this.drops.emit(clock, sp);
    }
    this.sprayDebt[2] += rates.churn * dt;
    while (this.sprayDebt[2] >= 1) {
      this.sprayDebt[2] -= 1;
      // White water churning at the toe.
      const x = this.acrossWave(0.85);
      this.placeOnWave(x, 0.4, 0.3 - sh.lag);
      this.velocity((this.rand() - 0.5) * 2, 1 + this.rand() * 2, 3 + this.rand() * 3);
      sp.ax = 0;
      sp.ay = -4;
      sp.az = 0;
      sp.drag = 1.4;
      sp.floor = this.waveAt.y - TSUNAMI_POOL_WATER_DROP;
      sp.life = 1 + this.rand() * 0.6;
      sp.size0 = 0.9;
      sp.size1 = 2.8;
      sp.spin = (this.rand() - 0.5) * 1.5;
      sp.seed = this.rand();
      this.tint(TSUNAMI_LOOK.spray, 0.18);
      this.spray.emit(clock, sp);
    }
  }

  /** Lay one lingering foam patch in [alongMin, alongMax] yards from the rim. */
  private layFoam(clock: number, alongMin: number, alongMax: number): void {
    const p = tsunamiFoamPatchInto(
      this.patch,
      this.rand(),
      this.rand(),
      this.rand(),
      alongMin,
      alongMax,
    );
    const sp = this.spec;
    const lift = p.onWater ? 0.04 - TSUNAMI_POOL_WATER_DROP : 0.05;
    sp.x = this.waveStart.x + this.fx * p.along + this.fz * p.across;
    sp.y = this.waveStart.y + lift;
    sp.z = this.waveStart.z + this.fz * p.along - this.fx * p.across;
    // Drag 1: the whole drift is the launch speed, at most TSUNAMI_FOAM_DRIFT.
    const drift = TSUNAMI_FOAM_DRIFT * this.rand();
    sp.vx = this.fx * drift;
    sp.vy = 0;
    sp.vz = this.fz * drift;
    sp.ax = 0;
    sp.ay = 0;
    sp.az = 0;
    sp.drag = 1;
    sp.floor = -1e6;
    sp.life = TSUNAMI_FOAM_LIFE_MIN + (TSUNAMI_FOAM_LIFE_MAX - TSUNAMI_FOAM_LIFE_MIN) * this.rand();
    sp.size0 = Math.min(p.size, TSUNAMI_FOAM_SIZE_MIN) * 0.85;
    sp.size1 = p.size;
    sp.spin = this.rand() * Math.PI * 2;
    sp.seed = this.rand();
    this.tint(TSUNAMI_LOOK.floorFoam, 1);
    this.foam.emit(clock, sp);
  }

  /** The swept floor behind the rolling toe takes foam as the wave passes. */
  private layFoamTrail(clock: number, travel: number): void {
    const moved = travel - this.lastTravel;
    this.lastTravel = travel;
    if (moved <= 0) return;
    const plan = TSUNAMI_TIERS[this.tier];
    this.foamDebt += (moved * plan.foamRoll) / TSUNAMI_FOAM_MAX_ALONG;
    while (this.foamDebt >= 1) {
      this.foamDebt -= 1;
      this.layFoam(clock, travel - 5, travel - 0.5);
    }
  }

  /** The wave lands: a plume of spray and flung droplets along the line where
   *  the lip strikes, and a last band of foam. */
  private crashBurst(clock: number): void {
    const plan = TSUNAMI_TIERS[this.tier];
    const sp = this.spec;
    const sh = this.shoulder;
    const strike = this.lip.reach;
    const water = this.waveAt.y - TSUNAMI_POOL_WATER_DROP;
    for (let i = 0; i < plan.crashSpray; i++) {
      const x = this.acrossWave(0.9);
      this.placeOnWave(x, 0.5 + this.rand() * 1.5 * sh.height, strike * sh.height - sh.lag);
      this.velocity(
        (this.rand() - 0.5) * 3,
        (5 + this.rand() * 6) * sh.height,
        2 + this.rand() * 4,
      );
      sp.ax = 0;
      sp.ay = -9;
      sp.az = 0;
      sp.drag = 0.6;
      sp.floor = water;
      sp.life = 1.2 + this.rand() * 0.8;
      sp.size0 = 1.4;
      sp.size1 = 4.2;
      sp.spin = (this.rand() - 0.5) * 1.5;
      sp.seed = this.rand();
      this.tint(TSUNAMI_LOOK.spray, 0.24);
      this.spray.emit(clock, sp);
    }
    for (let i = 0; i < plan.crashDrops; i++) {
      const x = this.acrossWave(0.85);
      this.placeOnWave(x, 0.6 + this.rand() * sh.height, strike * sh.height - sh.lag);
      this.velocity((this.rand() - 0.5) * 6, 4 + this.rand() * 6, 3 + this.rand() * 6);
      sp.ax = 0;
      sp.ay = -14;
      sp.az = 0;
      sp.drag = 0.3;
      sp.floor = water;
      sp.life = 0.9 + this.rand() * 0.5;
      sp.size0 = 0.4;
      sp.size1 = 0.2;
      sp.spin = 0;
      sp.seed = this.rand();
      this.tint(TSUNAMI_LOOK.drop, 0.9);
      this.drops.emit(clock, sp);
    }
    // Foam only where a wave actually rolled (a fight that ends mid-bar drops
    // the standing wall where it stood, and it sweeps nothing).
    if (this.waveRoll < 0.5) return;
    for (let i = 0; i < plan.foamCrash; i++) {
      this.layFoam(clock, this.lastTravel - 3, TSUNAMI_FOAM_MAX_ALONG);
    }
  }

  dispose(): void {
    this.spray.dispose();
    this.drops.dispose();
    this.foam.dispose();
    this.wave.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
