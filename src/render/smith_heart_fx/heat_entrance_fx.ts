// The Guardian of the Heat's entrance (plan: heat_entrance_core.ts), hosted by
// ../rift_death_zone.ts beside the raid's other fx and updated before the
// Heat's own painters: it reads the scene's clock off the guardian's aura
// (IWorld only, so offline and online look the same), holds its look for the
// body's fire and the wellspring (heat_entrance_state.ts), and draws the rest:
//  - the cold hearth: grey embers lying in a spiral round the wellspring,
//    thin smoke off them, the giant's own model dark as cold coal (its
//    emissive and its colour, restored the moment it burns);
//  - the wake: the embers igniting in a spiral inward, a run of flame along
//    the spiral's front;
//  - the first sentence: sparks rising off it, a heat haze round it (the
//    crown is the body's own fire, heat_body.ts);
//  - the second: glowing seams cracking out across the floor from the
//    wellspring (one char and one glow pass on the Heat floor ladder), a rain
//    of embers out of the smoke, its Cast gesture;
//  - the shout: its Throw gesture landing on the blast, a column of fire to
//    the sky, a ring of fire racing out across the floor past the raid
//    (cosmetic, no damage), a wave on the floor under it, the camera's thud
//    (the shake sink, under reduced motion none), a brief orange flash.
// No camera is taken, no control: the player plays through it.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated (the
// compile gate links every program before the first frame that draws it);
// fixed pools, no light, no per-frame allocation. The low tier draws fewer
// embers and particles; every beat plays on every tier.

import * as THREE from 'three';
import { HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { inSmithHeartClaim } from './council_fx_core';
import { entranceBudgetNow } from './entrance_budget';
import {
  HEAT_BODY_GESTURES,
  HEAT_FX_GROW,
  HEAT_GUARDIAN,
  HEAT_MODEL_COLORS,
} from './heat_body_core';
import { heatBodySockets } from './heat_body_sockets';
import {
  AWAKE,
  CRACK_VERTICES,
  type CrackPoint,
  crossedBeat,
  ENTRANCE_CRACKS,
  ENTRANCE_EMBERS,
  ENTRANCE_SPIRAL,
  entranceEmberPicks,
  entranceFlash,
  entranceShake,
  HEAT_ENTRANCE,
  HEAT_ENTRANCE_POOLS,
  HEAT_ENTRANCE_THROW_AT,
  type HeatEntranceClock,
  heatEntranceClock,
  heatEntranceLook,
  newHeatEntranceLook,
  SPIRAL_VERTICES,
  stepEntranceTime,
} from './heat_entrance_core';
import { holdHeatEntrance } from './heat_entrance_state';
import { fireRampGlsl } from './heat_flame_core';
import { HEAT_FLOOR, heatParticleSteps } from './heat_floor_ladder_core';
import { HEAT_MOLTEN_GLSL, HEAT_NOISE_GLSL } from './heat_lava_glsl';
import { applyCharBlend, moltenDecal, withCharTail } from './heat_molten_decal';

const SCAN_SEC = 0.25;
const C = HEAT_MODEL_COLORS;
const E = HEAT_ENTRANCE;
const P = HEAT_ENTRANCE_POOLS;

// ---- the embers ------------------------------------------------------------------------------

const EMBER_VERT = /* glsl */ `
  attribute vec3 aEmber;
  varying vec2 vUv;
  varying vec3 vE;
  void main() {
    vUv = uv;
    vE = aEmber;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

/** A coal on the floor: ash grey with a dull heart while cold, lit by the
 *  spiral's front as it passes (a white-gold flare on the front), the ones
 *  off the arms lit by the ring of fire; they cool after the blast. */
const EMBER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSpiral;
  uniform float uAsh;
  uniform float uEmbers;
  uniform float uRingR;
  varying vec2 vUv;
  varying vec3 vE;
  ${HEAT_MOLTEN_GLSL}
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;
    float order = vE.x;
    float seed = vE.y;
    float r = vE.z;
    float shape = pow(max(1.0 - d, 0.0), 1.6);
    float core = pow(max(1.0 - d, 0.0), 5.0);
    float flick = 0.72 + 0.28 * sin(uTime * (3.0 + seed * 5.0) + seed * 40.0);
    float reach = uSpiral * 1.03;
    float onArm = step(order, 1.0);
    float litS = onArm * smoothstep(order - 0.002, order + 0.03, reach);
    float litR = (1.0 - onArm) * smoothstep(r - 3.0, r, uRingR);
    float lit = max(litS, litR) * uEmbers;
    float fq = (reach - order) / 0.035;
    float front = onArm * exp(-fq * fq) * (1.0 - step(0.999, uSpiral));
    // Cold: a dark coal (the char) with a grey ash sheen and a dull heart.
    vec3 ash = vec3(0.26, 0.25, 0.24) * shape * 0.22 + vec3(0.3, 0.06, 0.02) * core * 0.18 * flick;
    vec3 hot = molten(0.52 + 0.36 * flick) * (shape * 0.55 + core * 1.25);
    vec3 e = ash * uAsh * (1.0 - lit) + hot * lit + molten(0.96) * front * shape * 2.2;
    float a = clamp(shape * (0.8 * uAsh * (1.0 - lit) + 0.3 * lit), 0.0, 1.0);
    gl_FragColor = vec4(e / max(a, 0.02), a);
  }
`;

// ---- the seams -------------------------------------------------------------------------------

const CRACK_VERT = /* glsl */ `
  attribute float aReveal;
  attribute float aSide;
  varying float vReveal;
  varying float vSide;
  varying vec2 vLocal;
  void main() {
    vReveal = aReveal;
    vSide = aSide;
    vLocal = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A seam: a white-gold core in a scorched halo, the front at its tip
 *  brightest as it runs out; its glow breathing (noise on the seam's own
 *  yards, never the world's). */
const CRACK_FRAG = /* glsl */ `
  uniform float uGrow;
  uniform float uHeat;
  uniform float uTime;
  varying float vReveal;
  varying float vSide;
  varying vec2 vLocal;
  ${HEAT_NOISE_GLSL}
  ${HEAT_MOLTEN_GLSL}
  void main() {
    float shown = 1.0 - smoothstep(uGrow - 0.035, uGrow, vReveal);
    if (shown <= 0.001) discard;
    float s = abs(vSide);
    float tq = (uGrow - vReveal) / 0.05;
    float tip = exp(-tq * tq) * (1.0 - step(0.995, uGrow));
    float n = vn(vLocal * 0.9 + vec2(uTime * 0.25, -uTime * 0.18));
    float core = 1.0 - smoothstep(0.0, 0.3 + 0.1 * n, s);
    float halo = 1.0 - smoothstep(0.22, 1.0, s);
    float heat = uHeat * (0.7 + 0.5 * n);
    vec3 e = molten(clamp(0.55 + 0.42 * heat * core + tip * 0.5, 0.0, 1.0))
      * (core * heat * 1.7 + halo * 0.22 * heat + tip * 1.8 * core);
    float a = clamp(shown * (halo * 0.6 * min(uHeat, 1.0) + core * 0.4), 0.0, 1.0);
    gl_FragColor = vec4(e * shown / max(a, 0.02), a);
  }
`;

/** The spiral's path: a trail of ash on the floor while it waits, the fire
 *  running along it inward, its front white-gold, the lit trail burning
 *  until it cools after the blast. */
const SPIRAL_FRAG = /* glsl */ `
  uniform float uSpiral;
  uniform float uAsh;
  uniform float uBurn;
  uniform float uTime;
  varying float vReveal;
  varying float vSide;
  varying vec2 vLocal;
  ${HEAT_NOISE_GLSL}
  ${HEAT_MOLTEN_GLSL}
  void main() {
    float s = abs(vSide);
    float n = vn(vLocal * 1.1 + vec2(uTime * 0.4, -uTime * 0.3));
    float core = 1.0 - smoothstep(0.0, 0.34 + 0.12 * n, s);
    float halo = 1.0 - smoothstep(0.28, 1.0, s);
    float reach = uSpiral * 1.03;
    float lit = smoothstep(vReveal - 0.002, vReveal + 0.02, reach);
    float fq = (reach - vReveal) / 0.03;
    float front = exp(-fq * fq) * (1.0 - step(0.999, uSpiral));
    float heat = lit * uBurn * (0.6 + 0.6 * n);
    vec3 e = molten(clamp(0.45 + 0.4 * heat + front * 0.6, 0.0, 1.0))
      * (core * heat * 1.25 + halo * 0.2 * heat + front * (core * 2.4 + halo * 0.7));
    float ash = halo * uAsh * (0.45 + 0.35 * n) * (1.0 - 0.5 * lit);
    float a = clamp(ash + core * 0.35 * lit * uBurn, 0.0, 1.0);
    gl_FragColor = vec4(e / max(a, 0.02), a);
  }
`;

// ---- the column, the ring's wall, the haze: one fire on an open cylinder --------------------

const FIRE_VERT = /* glsl */ `
  uniform float uFlare;
  uniform float uTwist;
  uniform float uTime;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec3 p = position;
    // Wider toward its top (a column blooms as it climbs), twisting.
    p.xz *= 1.0 + uFlare * uv.y * uv.y + 0.06 * sin(uTime * 4.0 + uv.y * 14.0 + uv.x * 25.0);
    float a = uTwist * uv.y + uTime * uTwist * 0.35;
    float c = cos(a);
    float s = sin(a);
    p.xz = mat2(c, -s, s, c) * p.xz;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

/** Tongues of fire climbing an open cylinder (round `uWrap` tongues, `uClimb`
 *  up its height a second), ragged under `uTop`, `uHeat` pushing the ramp to
 *  its yellow cores (orange-red at the frayed licks: the body's own fire). */
const FIRE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uHeat;
  uniform float uTop;
  uniform float uWrap;
  uniform float uRows;
  uniform float uClimb;
  uniform float uSee;
  varying vec2 vUv;
  varying float vFacing;
  ${HEAT_NOISE_GLSL}
  ${fireRampGlsl('fireRamp')}
  void main() {
    float h = vUv.y;
    vec2 q = vec2(vUv.x * uWrap, h * uRows - uTime * uClimb);
    vec2 w = vec2(vn(q * 0.5 + 7.3), vn(q * 0.5 - 2.1)) - 0.5;
    float n = vn(q + w * 1.8) * 0.6 + vn(q * 2.3 + w + 4.1) * 0.4;
    float body = smoothstep(0.4 + 0.3 * h, 0.92, n + (1.0 - h) * 0.24);
    float top = 1.0 - smoothstep(uTop - 0.22, uTop, h + (n - 0.5) * 0.3);
    float foot = smoothstep(0.0, 0.04, h);
    // A column lets the giant show through its root.
    float see = mix(1.0, 0.25 + 0.75 * smoothstep(0.04, 0.4, h), uSee);
    float k = body * top * foot * see * (0.3 + 0.7 * vFacing);
    vec3 col = fireRamp(clamp((0.16 + k * 1.1 - h * 0.2) * uHeat, 0.0, 0.96));
    gl_FragColor = vec4(col, min(1.0, k * uAlpha * 1.25));
  }
`;

/** Heat shimmer: faint warm streaks wavering up the air round the giant (no
 *  refraction: the Hearth's shimmer family, heat_well_fx.ts). */
const HAZE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    float h = vUv.y;
    float a = vUv.x * 6.28318;
    float bend = sin(h * 6.0 - uTime * 1.8 + a * 3.0) * 0.4;
    float wave = 0.5 + 0.5 * sin(a * 29.0 + bend * 6.0 + sin(a * 7.0 + uTime * 0.8));
    float climb = 0.5 + 0.5 * sin(h * 11.0 - uTime * 2.8 + a * 13.0);
    float streak = pow(max(wave, 0.0), 7.0) * (0.3 + 0.7 * climb);
    float fade = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.35, 1.0, h));
    vec3 col = vec3(1.0, 0.72, 0.38) * streak * fade * vFacing;
    gl_FragColor = vec4(col, uAlpha);
  }
`;

// ---- the flash: the whole view, a breath of orange -------------------------------------------

const FLASH_VERT = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const FLASH_FRAG = /* glsl */ `
  uniform float uAlpha;
  void main() {
    gl_FragColor = vec4(vec3(1.0, 0.46, 0.1), uAlpha);
  }
`;

// ---- particles' options (written in place) -----------------------------------------------------

const SMOKE = {
  speed: 0.25,
  up: 1.3,
  life: 5,
  size: [1.4, 4.5] as [number, number],
  color: [0.16, 0.15, 0.15] as [number, number, number],
  alpha: 0.22,
  drag: 0.6,
  radius: 0.6,
};
const FRONT = {
  speed: 0.6,
  up: 3.2,
  life: 0.7,
  size: [1.5, 0.3] as [number, number],
  color: C.flameHeat as readonly [number, number, number],
  alpha: 1,
  pool: 'pyre' as const,
  radius: 0.4,
};
const SPARK = {
  speed: 2.2,
  up: 7,
  life: 2.4,
  size: [0.32, 0.05] as [number, number],
  color: C.ember as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 3,
  drag: 0.35,
};
const RAIN = {
  speed: 1.2,
  life: 3.6,
  size: [1.3, 0.35] as [number, number],
  color: C.ember as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  dir: [0, -1, 0] as [number, number, number],
  spread: 0.25,
  gravity: 5,
  drag: 0.15,
  floor: 0.2,
};
const BLAST = {
  speed: 16,
  up: 10,
  life: 1.4,
  size: [4.5, 1.2] as [number, number],
  color: C.flameHot as readonly [number, number, number],
  alpha: 1,
  pool: 'pyre' as const,
  radius: 4,
  drag: 1.4,
};
const DEBRIS = {
  speed: 22,
  up: 14,
  life: 2.2,
  size: [0.5, 0.1] as [number, number],
  color: C.spark as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 3,
  gravity: 14,
  drag: 0.3,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** A strip pair per point of each line (`aReveal`, `aSide`), its places
 *  laid on the floor at the bind (layStrip). */
function stripGeometry(
  lines: readonly (readonly CrackPoint[])[],
  count: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const reveal = new Float32Array(count);
  const side = new Float32Array(count);
  const index: number[] = [];
  let v = 0;
  for (const line of lines) {
    for (let k = 0; k < line.length; k++) {
      reveal[v] = line[k].reveal;
      reveal[v + 1] = line[k].reveal;
      side[v] = -1;
      side[v + 1] = 1;
      if (k > 0) index.push(v - 2, v - 1, v, v - 1, v + 1, v);
      v += 2;
    }
  }
  geo.setAttribute('aReveal', new THREE.BufferAttribute(reveal, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(index);
  return geo;
}

/** Lay a strip's points on the floor (`floor` the height off the stage at a
 *  local point), `widen` times each point's half width either side. */
function layStrip(
  geo: THREE.BufferGeometry,
  lines: readonly (readonly CrackPoint[])[],
  floor: (x: number, z: number) => number,
  widen: number,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let v = 0;
  for (const line of lines) {
    for (let k = 0; k < line.length; k++) {
      const a = line[Math.max(0, k - 1)];
      const b = line[Math.min(line.length - 1, k + 1)];
      let nx = -(b.z - a.z);
      let nz = b.x - a.x;
      const m = Math.hypot(nx, nz) || 1;
      nx /= m;
      nz /= m;
      const p = line[k];
      const w = p.half * widen;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const x = p.x + nx * w * sgn;
        const z = p.z + nz * w * sgn;
        pos.setXYZ(v++, x, floor(x, z) + 0.07, z);
      }
    }
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}

/** The model's authored look, kept per material while the scene dims it. */
interface CoalMaterial {
  mat: THREE.Material & { emissiveIntensity?: number; color?: THREE.Color };
  emissive: number;
  r: number;
  g: number;
  b: number;
}

export class HeatEntranceFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** Everything drawn sits under this, placed on the wellspring (local
   *  yards: every shader reads its own small coordinates). */
  private readonly stage = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  /** The tier draws the cosmetic doubles (the heat haze round the body):
   *  entrance_budget_core.ts. */
  private readonly secondary: boolean;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly embers: THREE.InstancedMesh;
  private readonly emberMat: THREE.ShaderMaterial;
  private readonly emberCount: number;
  private readonly spiralGeo: THREE.BufferGeometry;
  private readonly spiral: THREE.Mesh;
  private readonly spiralMat: THREE.ShaderMaterial;
  private readonly crackGeo: THREE.BufferGeometry;
  private readonly cracks: THREE.Mesh;
  private readonly crackMat: THREE.ShaderMaterial;
  private readonly column: THREE.Mesh[] = [];
  private readonly columnMats: THREE.ShaderMaterial[] = [];
  private readonly ringWall: THREE.Mesh;
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly haze: THREE.Mesh;
  private readonly hazeMat: THREE.ShaderMaterial;
  private readonly flash: THREE.Mesh;
  private readonly flashMat: THREE.ShaderMaterial;
  private readonly look = newHeatEntranceLook();
  private readonly clockRead: HeatEntranceClock = { stage: 'none', t: 0 };
  /** The ember order index the spiral's front has passed (its licks). */
  private frontIndex = 0;
  private readonly frontOrder: number[];
  private entityId = -1;
  private rosterSeen = Number.NaN;
  /** Where the stage sits (world), the claim it was placed for. */
  private placedX = Number.NaN;
  private placedZ = Number.NaN;
  private stageY = 0;
  private time = AWAKE;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x3e17;
  private coal: CoalMaterial[] = [];
  private coalRoot: THREE.Object3D | null = null;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'smith-heart-heat-entrance';
    setRenderCategory(this.root, 'ui3d');
    this.stage.name = 'smithHeartHeatEntranceStage';
    this.stage.visible = false;
    this.root.add(this.stage);
    const budget = entranceBudgetNow('heat');
    const detail = budget.detail;
    this.secondary = budget.secondary;
    this.density = budget.share;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.stage,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x + this.stage.position.x, z + this.stage.position.z) - this.stageY,
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
      heatParticleSteps('heat_entrance'),
    );

    // ---- the embers: one instanced draw ----
    // The low tier keeps every k-th ember, so its spiral stays whole.
    const picks = entranceEmberPicks(detail);
    this.emberCount = picks.length;
    const emberGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const attr = new Float32Array(picks.length * 3);
    picks.forEach((src, i) => {
      const e = ENTRANCE_EMBERS[src];
      attr[i * 3] = e.order;
      attr[i * 3 + 1] = e.seed;
      attr[i * 3 + 2] = Math.hypot(e.x, e.z);
    });
    this.emberPicks = picks;
    emberGeo.setAttribute('aEmber', new THREE.InstancedBufferAttribute(attr, 3));
    this.geometries.push(emberGeo);
    // A dark coal (char, multiplying the floor) under its glow (added): the
    // two instanced passes share the one geometry and the one set of places.
    const emberUniforms = {
      uTime: this.uTime,
      uSpiral: { value: 0 },
      uAsh: { value: 1 },
      uEmbers: { value: 0 },
      uRingR: { value: 0 },
    };
    const decal = {
      uniforms: emberUniforms,
      vertexShader: EMBER_VERT,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    };
    this.emberMat = new THREE.ShaderMaterial({
      ...decal,
      name: 'smithHeartHeatEntranceEmbersChar',
      fragmentShader: withCharTail(EMBER_FRAG),
      defines: { HEAT_CHAR: '' },
    });
    applyCharBlend(this.emberMat);
    const emberGlowMat = new THREE.ShaderMaterial({
      ...decal,
      name: 'smithHeartHeatEntranceEmbersGlow',
      fragmentShader: EMBER_FRAG,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(this.emberMat, emberGlowMat);
    this.embers = new THREE.InstancedMesh(emberGeo, this.emberMat, this.emberCount);
    this.embers.name = 'smithHeartHeatEntranceEmbers';
    this.embers.frustumCulled = false;
    this.embers.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.entranceChar.step);
    const emberGlow = new THREE.InstancedMesh(emberGeo, emberGlowMat, this.emberCount);
    emberGlow.name = 'smithHeartHeatEntranceEmbersGlow';
    emberGlow.frustumCulled = false;
    emberGlow.instanceMatrix = this.embers.instanceMatrix;
    emberGlow.renderOrder = floorVfxRenderOrder('encounter', HEAT_FLOOR.entranceGlow.step);
    this.embers.add(emberGlow);
    this.stage.add(this.embers);
    this.frontOrder = picks
      .map((src) => ENTRANCE_EMBERS[src].order)
      .map((o, i) => [o, i] as const)
      .filter(([o]) => o <= 1)
      .sort((a, b) => a[0] - b[0])
      .map(([, i]) => i);

    // ---- the spiral's path and the seams: a char and a glow pass each ----
    this.spiralGeo = stripGeometry(ENTRANCE_SPIRAL, SPIRAL_VERTICES);
    this.crackGeo = stripGeometry(ENTRANCE_CRACKS, CRACK_VERTICES);
    this.geometries.push(this.spiralGeo, this.crackGeo);
    const spiral = moltenDecal(
      {
        name: 'smithHeartHeatEntranceSpiral',
        geometry: this.spiralGeo,
        vertexShader: CRACK_VERT,
        fragmentShader: SPIRAL_FRAG,
        uniforms: {
          uSpiral: { value: 0 },
          uAsh: { value: 1 },
          uBurn: { value: 0 },
          uTime: this.uTime,
        },
        charStep: HEAT_FLOOR.entranceChar.step,
        glowStep: HEAT_FLOOR.entranceGlow.step,
      },
      this.materials,
    );
    this.spiral = spiral.mesh;
    this.spiralMat = spiral.mat;
    this.stage.add(this.spiral);
    const crack = moltenDecal(
      {
        name: 'smithHeartHeatEntranceSeams',
        geometry: this.crackGeo,
        vertexShader: CRACK_VERT,
        fragmentShader: CRACK_FRAG,
        uniforms: { uGrow: { value: 0 }, uHeat: { value: 0 }, uTime: this.uTime },
        charStep: HEAT_FLOOR.entranceChar.step,
        glowStep: HEAT_FLOOR.entranceGlow.step,
      },
      this.materials,
    );
    this.cracks = crack.mesh;
    this.crackMat = crack.mat;
    this.stage.add(this.cracks);

    // ---- the column, the ring's wall, the haze ----
    const fire = (name: string, wrap: number, rows: number, climb: number, flare: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uTime: this.uTime,
          uAlpha: { value: 0 },
          uHeat: { value: 1 },
          uTop: { value: 1 },
          uWrap: { value: wrap },
          uRows: { value: rows },
          uClimb: { value: climb },
          uFlare: { value: flare },
          uTwist: { value: 0 },
          uSee: { value: 0 },
        },
        vertexShader: FIRE_VERT,
        fragmentShader: FIRE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      });
      this.materials.push(m);
      return m;
    };
    const tube = new THREE.CylinderGeometry(1, 1, 1, 48, 12, true).translate(0, 0.5, 0);
    const band = new THREE.CylinderGeometry(1, 1, 1, 160, 3, true).translate(0, 0.5, 0);
    this.geometries.push(tube, band);
    const layers: [string, number, number, number, number, number][] = [
      // name, wrap, rows, climb, flare, heat
      ['smithHeartHeatEntranceColumn', 9, 11, 3.4, 1.1, 1],
      ['smithHeartHeatEntranceColumnCore', 6, 8, 4.6, 0.6, 1.08],
    ];
    for (let i = 0; i < P.columnLayers; i++) {
      const [name, wrap, rows, climb, flare, heat] = layers[i];
      const m = fire(name, wrap, rows, climb, flare);
      m.uniforms.uHeat.value = heat;
      m.uniforms.uTwist.value = i === 0 ? 1.4 : -2.1;
      m.uniforms.uSee.value = 1;
      const mesh = new THREE.Mesh(tube, m);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.stage.add(mesh);
      this.column.push(mesh);
      this.columnMats.push(m);
    }
    this.ringMat = fire('smithHeartHeatEntranceRing', 64, 2.2, 3.6, 0);
    this.ringWall = new THREE.Mesh(band, this.ringMat);
    this.ringWall.name = 'smithHeartHeatEntranceRing';
    this.ringWall.frustumCulled = false;
    this.ringWall.visible = false;
    this.stage.add(this.ringWall);
    this.hazeMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatEntranceHaze',
      uniforms: {
        uTime: this.uTime,
        uAlpha: { value: 0 },
        uFlare: { value: 0.3 },
        uTwist: { value: 0 },
      },
      vertexShader: FIRE_VERT,
      fragmentShader: HAZE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(this.hazeMat);
    this.haze = new THREE.Mesh(tube, this.hazeMat);
    this.haze.name = 'smithHeartHeatEntranceHaze';
    this.haze.frustumCulled = false;
    this.haze.visible = false;
    this.stage.add(this.haze);

    // ---- the flash ----
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geometries.push(quad);
    this.flashMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatEntranceFlash',
      uniforms: { uAlpha: { value: 0 } },
      vertexShader: FLASH_VERT,
      fragmentShader: FLASH_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(this.flashMat);
    this.flash = new THREE.Mesh(quad, this.flashMat);
    this.flash.name = 'smithHeartHeatEntranceFlash';
    this.flash.frustumCulled = false;
    this.flash.visible = false;
    this.flash.renderOrder = 10_000;
    this.stage.add(this.flash);

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  /** The ember each instance draws (the low tier's every k-th). */
  private readonly emberPicks: number[];

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** The entrance's look for its guardian (tests read it). */
  get currentLook() {
    return this.look;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    const e = this.entityId >= 0 ? world.entities.get(this.entityId) : undefined;
    if (!e) {
      if (this.entityId >= 0) this.release();
      return;
    }
    const prev = this.time;
    this.time = e.dead
      ? AWAKE
      : stepEntranceTime(prev, dt, heatEntranceClock(e.auras, this.clockRead));
    const look = heatEntranceLook(this.time, this.look);
    holdHeatEntrance(e.id, look);
    this.coalBody(look);
    if (!look.active) {
      if (this.stage.visible) this.hideStage();
      return;
    }
    this.place(e);
    this.stage.visible = true;
    this.paint(e, prev, dt);
    this.particles.update(this.clock);
  }

  // ---- the scan --------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    if (this.entityId >= 0 && !world.entities.has(this.entityId)) this.release();
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.entityId >= 0) this.release();
      this.rosterSeen = Number.NaN;
      return;
    }
    if (this.entityId >= 0) return;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== HEAT_GUARDIAN) continue;
      this.entityId = e.id;
      this.time = AWAKE;
      this.frontIndex = 0;
      break;
    }
  }

  private release(): void {
    if (this.entityId >= 0) holdHeatEntrance(this.entityId, null);
    this.entityId = -1;
    this.rosterSeen = Number.NaN;
    this.time = AWAKE;
    this.restoreCoal();
    this.hideStage();
  }

  private hideStage(): void {
    this.stage.visible = false;
    this.flash.visible = false;
    this.particles.hideRings();
  }

  /** Stand the stage on the claim's wellspring; the embers and the seams laid
   *  on the floor once per claim (their heights off the floor under them). */
  private place(e: Entity): void {
    const def = DUNGEONS.smith_heart;
    if (!def) return;
    const o = instanceOrigin(def.index, instanceSlotForZ(e.pos.z));
    if (o.x === this.placedX && o.z === this.placedZ) return;
    this.placedX = o.x;
    this.placedZ = o.z;
    const wx = o.x + HEARTH_WELL.x;
    const wz = o.z + HEARTH_WELL.z;
    this.stageY = this.groundY(wx, wz);
    this.stage.position.set(wx, this.stageY, wz);
    this.stage.updateMatrixWorld();
    const floor = (x: number, z: number) => this.groundY(wx + x, wz + z) - this.stageY;
    for (let i = 0; i < this.emberCount; i++) {
      const em = ENTRANCE_EMBERS[this.emberPicks[i]];
      _p.set(em.x, floor(em.x, em.z) + 0.1, em.z);
      _q.setFromAxisAngle(_up, em.seed * Math.PI * 2);
      _s.setScalar(em.size);
      _m.compose(_p, _q, _s);
      this.embers.setMatrixAt(i, _m);
    }
    this.embers.instanceMatrix.needsUpdate = true;
    layStrip(this.spiralGeo, ENTRANCE_SPIRAL, floor, 2.6);
    layStrip(this.crackGeo, ENTRANCE_CRACKS, floor, 2.6);
  }

  // ---- the paint -------------------------------------------------------------------------------

  private paint(e: Entity, prev: number, dt: number): void {
    const L = this.look;
    const t = L.t;
    const d = this.density;
    // Crossed this frame (a scene joined mid-way plays no one-shot it missed).
    // The embers.
    const eu = this.emberMat.uniforms;
    eu.uSpiral.value = L.spiral;
    eu.uAsh.value = L.ash;
    eu.uEmbers.value = L.embers;
    eu.uRingR.value = L.sinceBlast >= 0 ? L.ringR : 0;
    this.embers.visible = L.ash > 0.01 || L.embers > 0.01;
    // A lick of flame on each ember the spiral's front passes.
    if (L.cold) this.frontIndex = 0;
    else {
      while (this.frontIndex < this.frontOrder.length) {
        const i = this.frontOrder[this.frontIndex];
        const em = ENTRANCE_EMBERS[this.emberPicks[i]];
        if (em.order > L.spiral * 1.03) break;
        this.frontIndex++;
        if (prev < 0 || this.rand() > 0.55 * d) continue;
        const y = this.groundY(this.stage.position.x + em.x, this.stage.position.z + em.z);
        this.particles.puff(em.x, y - this.stageY + 0.3, em.z, 1, FRONT);
      }
    }
    // The cold hearth's thin smoke.
    if (L.smoke > 0 && this.rand() < dt * L.smoke * d * 3) {
      const em = ENTRANCE_EMBERS[this.emberPicks[Math.floor(this.rand() * this.emberCount)]];
      this.particles.puff(em.x, 0.3, em.z, 1, SMOKE);
    }
    // The spiral's path.
    const su = this.spiralMat.uniforms;
    su.uSpiral.value = L.spiral;
    su.uAsh.value = L.ash;
    su.uBurn.value = L.trail;
    this.spiral.visible = L.ash > 0.01 || L.embers > 0.01;
    // The seams.
    const cu = this.crackMat.uniforms;
    cu.uGrow.value = L.cracks;
    cu.uHeat.value = L.crackHeat;
    this.cracks.visible = L.cracks > 0.001 && L.crackHeat > 0.01;
    // Sparks off the body, the rain out of the smoke.
    const set = heatBodySockets();
    if (L.sparks > 0) {
      let n = dt * P.sparkRate * L.sparks * d;
      while (n > 0) {
        if (n < 1 && this.rand() > n) break;
        n -= 1;
        this.bodyPoint(e, set, _v);
        this.particles.puff(_v.x, _v.y, _v.z, 1, SPARK);
      }
    }
    if (L.rain > 0) {
      let n = dt * P.rainRate * Math.min(1.6, L.rain) * d;
      while (n > 0) {
        if (n < 1 && this.rand() > n) break;
        n -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = 6 + Math.sqrt(this.rand()) * P.rainReach;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        this.particles.puff(x, P.rainHeight * (0.7 + 0.5 * this.rand()), z, 1, RAIN);
      }
    }
    // The haze round it.
    const G = HEAT_FX_GROW;
    this.hazeMat.uniforms.uAlpha.value = 0.3 * L.haze;
    this.haze.visible = this.secondary && L.haze > 0.01;
    this.haze.scale.set(9 * G, 24 * G, 9 * G);
    this.haze.position.set(0, -1, 0);
    // The gestures, on their beats.
    if (crossedBeat(prev, this.time, E.rageAt)) this.playGesture?.(e.id, HEAT_BODY_GESTURES.cast);
    if (crossedBeat(prev, this.time, HEAT_ENTRANCE_THROW_AT))
      this.playGesture?.(e.id, HEAT_BODY_GESTURES.throw);
    // The blast.
    if (crossedBeat(prev, this.time, E.blastAt)) this.blast(e);
    const since = L.sinceBlast;
    for (let i = 0; i < this.column.length; i++) {
      const core = i === 1;
      const mesh = this.column[i];
      const m = this.columnMats[i];
      const show = since >= 0 && L.column > 0.01;
      mesh.visible = show;
      if (!show) continue;
      const r = E.columnRadius * (core ? 0.45 : 1) * L.columnR;
      mesh.scale.set(r, Math.max(0.1, E.columnHeight * L.columnH), r);
      mesh.position.set(0, -0.5, 0);
      m.uniforms.uAlpha.value = L.column * (core ? 0.5 : 0.95);
      m.uniforms.uTop.value = 0.92 + 0.08 * L.columnH;
    }
    const ringOn = since >= 0 && L.ring > 0.01;
    this.ringWall.visible = ringOn;
    if (ringOn) {
      const h = 4.2 * (0.35 + 0.65 * L.ring);
      this.ringWall.scale.set(L.ringR, h, L.ringR);
      this.ringWall.position.set(0, 0.05, 0);
      this.ringMat.uniforms.uAlpha.value = L.ring;
      this.ringMat.uniforms.uTop.value = 0.95;
      // Tongues a yard and a half wide whatever its radius.
      this.ringMat.uniforms.uWrap.value = Math.max(24, Math.round((Math.PI * 2 * L.ringR) / 1.5));
    }
    // Reduced motion: no flash at all (as no thud).
    const flash = entranceFlash(L, this.reducedMotion());
    this.flash.visible = flash > 0.002;
    this.flashMat.uniforms.uAlpha.value = flash;
  }

  /** A point on the giant this frame (a socket, or round its frame while its
   *  model loads), in stage-local yards. */
  private bodyPoint(
    e: Entity,
    set: ReturnType<typeof heatBodySockets>,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    const pts = set?.points;
    const pick = pts ? pts[Math.floor(this.rand() * pts.length)] : null;
    if (pick) pick.getWorldPosition(out);
    else out.set(e.pos.x, e.pos.y + 4 + this.rand() * 14, e.pos.z);
    return out.sub(this.stage.position);
  }

  /** The shout: the column's burst at its root, the ring's wave on the
   *  floor, sparks flung, the camera's thud. */
  private blast(e: Entity): void {
    const p = this.particles;
    p.puff(0, 1, 0, Math.round(26 * this.density) + 6, BLAST);
    p.puff(0, 2, 0, Math.round(60 * this.density) + 10, DEBRIS);
    p.shockRing(0, 0, 0xffb040, E.ringTo, E.ringFor, { wake: 0.05, crest: 0.05, strength: 0.55 });
    const me = this.world?.entities.get(this.world.playerId);
    if (!this.shakeSink || !me) return;
    const amount = entranceShake(
      Math.hypot(me.pos.x - e.pos.x, me.pos.z - e.pos.z),
      this.reducedMotion(),
    );
    if (amount > 0) this.shakeSink(amount);
  }

  // ---- the cold coal on the model ----------------------------------------------------------------

  /** Dim the giant's own model to cold coal while the scene says so (its
   *  emissive and its colour, from the values it was authored with), and
   *  give them back the moment it is awake. */
  private coalBody(look: ReturnType<typeof heatEntranceLook>): void {
    const set = heatBodySockets();
    const root = set?.root ?? null;
    if (!look.active || look.glow >= 0.999) {
      this.restoreCoal();
      return;
    }
    if (root !== this.coalRoot) {
      this.restoreCoal();
      this.coalRoot = root;
      if (root) {
        const seen = new Set<THREE.Material>();
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            const mm = m as CoalMaterial['mat'];
            // Only the guardian's own skin (never a prop or a weapon on the rig).
            if (!/heat_guardian/.test(mm.name)) continue;
            if (seen.has(mm) || mm.emissiveIntensity === undefined || !mm.color) continue;
            seen.add(mm);
            this.coal.push({
              mat: mm,
              emissive: mm.emissiveIntensity,
              r: mm.color.r,
              g: mm.color.g,
              b: mm.color.b,
            });
          }
        });
      }
    }
    for (const c of this.coal) {
      c.mat.emissiveIntensity = c.emissive * look.glow;
      // Cold coal is grey, its painted lava gone dull: a cool tint over the
      // dim (none left once it burns).
      const k = look.coal;
      const cool = 1 - k;
      c.mat.color?.setRGB(
        c.r * k * (1 - 0.45 * cool),
        c.g * k * (1 - 0.3 * cool),
        c.b * k * (1 - 0.1 * cool),
      );
    }
  }

  private restoreCoal(): void {
    for (const c of this.coal) {
      c.mat.emissiveIntensity = c.emissive;
      c.mat.color?.setRGB(c.r, c.g, c.b);
    }
    this.coal = [];
    this.coalRoot = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    // The instance buffer (shared by the char and the glow) is freed here.
    this.embers.dispose();
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
