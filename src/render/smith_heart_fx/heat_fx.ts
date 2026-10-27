// The Heat guardian's effects (plan: heat_fx_core.ts), hosted by
// ../rift_death_zone.ts beside the other guardians'. Presentation only, read
// from IWorld (the guardian's cast bar and facing, its events), so offline
// and online look the same:
//  - the telegraphs, on EVERY graphics tier: Molten Pour's lane at its exact
//    length and width (aimed where the bar locked it) and Searing Knell's
//    ring at its exact radius, both through the shared floor telegraph,
//    filling with the bar;
//  - Molten Pour on its bar: the first flame gathering at the guardian, the
//    floor's seams lighting down the lane toward its end, sparks running
//    along it; when it lands, white-gold fire pours down the lane behind a
//    wave of flame (never past its width), spatter and sparks thrown up, the
//    lane left molten, cooling to a dark crust and smoking a few seconds;
//  - Searing Knell on its bar: the fire drawn into a sphere at the guardian,
//    cracks of fire running out over the floor to the ring's edge, the heat
//    shimmering; when it lands, a flash, a wall of white-gold fire ringing
//    out to the stun's edge (never past it), the cracks flaring, rings of the
//    toll, sparks and ash flung out, a short shake.
// The footprints are actionable and never thin; the fire, the sparks and the
// smoke are cosmetic and thin on the low tier and under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the root before its gated attach (one compile-gated
// attach, the telegraph kit's too); no light; no per-frame allocation (fixed
// pools, puff options written in place); the molten lane, the seams and the
// telegraphs are floor marks on the floor ladder's encounter band.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  HEAT_FX_COLORS,
  HEAT_FX_POOLS,
  HEAT_GUARDIAN,
  heatGuardianKit,
  KNELL_WAVE_SECONDS,
  knellBlastLook,
  knellCrackPaths,
  knellCracks,
  knellGather,
  MOLTEN_POUR,
  POUR_MOLTEN_SECONDS,
  pourFlowLook,
  pourGather,
  pourSeamPaths,
  pourSeams,
  pourSparks,
  SEARING_KNELL,
} from './heat_fx_core';

const SCAN_SEC = 0.1;
const C = HEAT_FX_COLORS;

/** The per-frame puffs' options, written in place (no allocation a frame). */
const GATHER_DIR: [number, number, number] = [0, 0.2, 0];
const GATHER_PUFF = {
  speed: 7,
  life: 0.7,
  size: [0.5, 0.12] as const,
  color: C.fire,
  alpha: 0.9,
  pool: 'glow' as const,
  dir: GATHER_DIR,
  spread: 0.15,
  drag: 0.4,
};
const SPARK_DIR: [number, number, number] = [0, 0.4, 1];
const SPARK_PUFF = {
  speed: 6,
  life: 0.45,
  size: [0.3, 0.06] as const,
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  dir: SPARK_DIR,
  spread: 0.35,
};
const SMOKE_PUFF = {
  speed: 1.2,
  up: 2.4,
  life: 2.2,
  size: [1.2, 3.6] as const,
  color: C.smoke,
  alpha: 0.3,
  drag: 0.6,
};

// ---- the molten lane ------------------------------------------------------------------

const FLAT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The poured fire on the floor: white-gold behind its front, rippling down
 *  the lane, its edges ragged inside the lane's width, cooling to a dark
 *  crust in plates (normal blend: the crust darkens the floor). */
const FLOW_FRAG = /* glsl */ `
uniform float uFront;
uniform float uHeat;
uniform float uCrust;
uniform float uTime;
uniform float uLen;
uniform vec3 uCore;
uniform vec3 uFire;
uniform vec3 uDeep;
uniform vec3 uCrustCol;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float along = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  float y = along * uLen;
  float rag = n(vec2(y * 0.5, vUv.x * 4.0)) * 0.18;
  if (across > 1.0 - rag || along > uFront) discard;
  float rip = n(vec2(y * 0.45 - uTime * 4.0, vUv.x * 5.0)) * 0.6 + n(vec2(y * 1.3 - uTime * 6.5, vUv.x * 11.0)) * 0.4;
  // Molten fire: a deep gold body, gold where it runs fastest, white-gold
  // only in its veins (never one blown-out sheet).
  vec3 hot = mix(uDeep, uFire, smoothstep(0.2, 0.75, rip));
  hot = mix(hot, uCore, smoothstep(0.72, 0.92, rip) * (1.0 - across) * 0.85);
  vec3 col = mix(uDeep * 0.6, hot, smoothstep(0.0, 0.6, uHeat));
  // The crust: dark plates closing over it as it cools, the fire showing in
  // the cracks between them last.
  vec2 q = vec2(y, vUv.x * 6.0) * 0.9;
  float plates = smoothstep(0.3, 0.55, n(q) * 0.7 + n(q * 2.6) * 0.3);
  float crust = clamp(uCrust * 1.2 - (1.0 - plates) * 0.4, 0.0, 1.0);
  col = mix(col, uCrustCol, crust);
  float lead = smoothstep(uFront - 0.06, uFront, along) * step(uFront, 0.999);
  col += uCore * lead * 0.6 * uHeat;
  float glow = (1.0 - crust) * uHeat;
  float a = (1.0 - smoothstep(0.75, 1.0 - rag, across)) * (0.55 + 0.45 * max(glow, crust));
  gl_FragColor = vec4(col * (0.78 + glow * 0.32), a);
  #include <colorspace_fragment>
}
`;
/** The wave of flame riding the pour's front, rising off the floor. */
const WAVE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uFire;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float t = n(vec2(vUv.x * 7.0, vUv.y * 2.0 - uTime * 5.0)) * 0.6 + n(vec2(vUv.x * 15.0, vUv.y * 4.0 - uTime * 8.0)) * 0.4;
  float top = 0.35 + 0.6 * t;
  float body = (1.0 - smoothstep(top - 0.25, top, vUv.y)) * (1.0 - smoothstep(0.8, 1.0, x));
  float a = body * uAlpha;
  if (a <= 0.003) discard;
  vec3 col = mix(uFire, uCore, (1.0 - vUv.y) * 0.8) * a * 1.4;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

// ---- the seams and cracks of fire -------------------------------------------------------

const SEAM_VERT = /* glsl */ `
attribute float aT;
attribute float aEdge;
varying float vT;
varying float vEdge;
void main() {
  vT = aT;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A seam lit up to `uReach` along its length (its leading point hottest). */
const SEAM_FRAG = /* glsl */ `
uniform float uReach;
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uFire;
varying float vT;
varying float vEdge;
void main() {
  if (vT > uReach || uAlpha <= 0.001) discard;
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.0, 0.35, e);
  float glow = 1.0 - smoothstep(0.2, 1.0, e);
  float lead = 1.0 - smoothstep(0.0, 0.12, uReach - vT);
  vec3 col = mix(uFire, uCore, core) * (core * 1.6 + glow * 0.6 + lead * 1.2);
  gl_FragColor = vec4(col * uAlpha, glow * uAlpha);
  #include <colorspace_fragment>
}
`;

/** Flat ribbons along several paths (local x, z; `aT` along each). */
function seamGeometry(
  paths: readonly (readonly { x: number; z: number; t: number }[])[],
  width: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const t: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  for (const pts of paths) {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const w = width * (1 - pts[i].t * 0.55);
      for (const s of [-1, 1]) {
        pos.push(pts[i].x - dz * w * s, 0, pts[i].z + dx * w * s);
        t.push(pts[i].t);
        edge.push(s);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---- the knell -----------------------------------------------------------------------------

const SPHERE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
/** The fire gathered into a sphere: white at its heart, gold at its rim. */
const SPHERE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uFire;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  vec3 col = mix(uCore, uFire, f) * (0.7 + f * 0.8);
  float a = uAlpha * (0.45 + 0.55 * f);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;
const WALL_VERT = FLAT_VERT;
/** The knell's wall of fire ringing out: tongues rising, thinning upward. */
const RING_WALL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uFire;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vec2(vUv.x * 48.0, vUv.y * 3.0 - uTime * 4.0);
  float tongue = n(p) * 0.6 + n(p * 2.3 + 5.0) * 0.4;
  float rise = 1.0 - smoothstep(0.15 + tongue * 0.55, 1.0, vUv.y);
  float a = uAlpha * rise * smoothstep(0.3, 0.7, tongue);
  if (a <= 0.003) discard;
  vec3 col = mix(uFire, uCore, 1.0 - vUv.y) * a * 1.5;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

interface Flow {
  flow: THREE.Mesh;
  flowMat: THREE.ShaderMaterial;
  wave: THREE.Mesh;
  waveMat: THREE.ShaderMaterial;
  born: number;
  live: boolean;
  x: number;
  z: number;
  yaw: number;
}

interface Charge {
  id: number;
  kind: 'pour' | 'knell';
  x: number;
  y: number;
  z: number;
  progress: number;
  fan: TelegraphFan | null;
  lane: TelegraphLane | null;
  slot: number;
}

export class HeatFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly fans: TelegraphFan[] = [];
  private readonly lanes: TelegraphLane[] = [];
  private readonly flows: Flow[] = [];
  private readonly seams: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly cracks: THREE.Mesh;
  private readonly cracksMat: THREE.ShaderMaterial;
  private readonly sphere: THREE.Mesh;
  private readonly sphereMat: THREE.ShaderMaterial;
  private readonly wall: THREE.Mesh;
  private readonly wallMat: THREE.ShaderMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly charges = new Map<number, Charge>();
  private readonly sim = heatGuardianKit();
  private knellBorn = -99;
  private seed = 0x4e71;
  private scanTimer = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-heat-fx';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.4;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    // The telegraphs: the footprint on every tier.
    this.kit = new TelegraphKit(this.root, detail);
    for (let i = 0; i < HEAT_FX_POOLS.telegraphs; i++) {
      this.fans.push(this.kit.fan(10));
      this.lanes.push(this.kit.lane(12));
    }
    const colorU = (c: readonly [number, number, number]) => ({ value: new THREE.Color(...c) });
    const L = this.sim.pourLength;
    const HW = this.sim.pourHalfWidth;
    // The molten lanes and their waves (two slots), and the seams lit down
    // each lane over its bar.
    const flowGeo = new THREE.PlaneGeometry(1, 1, 2, 24).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    // Its uv's v runs along +z (the lane's length): flip so v = 0 at the guardian.
    const uv = flowGeo.attributes.uv;
    const posAttr = flowGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setY(i, posAttr.getZ(i));
    const waveGeo = new THREE.PlaneGeometry(1, 1, 8, 1).translate(0, 0.5, 0);
    this.geometries.push(flowGeo, waveGeo);
    for (let s = 0; s < HEAT_FX_POOLS.flows; s++) {
      const flowMat = new THREE.ShaderMaterial({
        name: 'smithHeartPourFlow',
        uniforms: {
          uFront: { value: 0 },
          uHeat: { value: 0 },
          uCrust: { value: 0 },
          uTime: this.uTime,
          uLen: { value: L },
          uCore: colorU(C.core),
          uFire: colorU(C.fire),
          uDeep: colorU(C.deep),
          uCrustCol: colorU(C.crust),
        },
        vertexShader: FLAT_VERT,
        fragmentShader: FLOW_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const waveMat = new THREE.ShaderMaterial({
        name: 'smithHeartPourWave',
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uCore: colorU(C.core),
          uFire: colorU(C.fire),
        },
        vertexShader: FLAT_VERT,
        fragmentShader: WAVE_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(flowMat, waveMat);
      const flow = new THREE.Mesh(flowGeo, flowMat);
      flow.name = 'smithHeartPourFlow';
      // Over the telegraph's fill, under its fill front.
      flow.renderOrder = floorVfxRenderOrder('encounter', 18);
      flow.scale.set(HW * 2 * 0.94, 1, L);
      const wave = new THREE.Mesh(waveGeo, waveMat);
      wave.name = 'smithHeartPourWave';
      for (const m of [flow, wave]) {
        m.visible = false;
        m.frustumCulled = false;
        this.root.add(m);
      }
      this.flows.push({ flow, flowMat, wave, waveMat, born: -99, live: false, x: 0, z: 0, yaw: 0 });
      const seamGeo = seamGeometry(pourSeamPaths(0x31 + s * 11, L, HW), 0.16);
      this.geometries.push(seamGeo);
      const seamMat = this.seamMaterial('smithHeartPourSeams');
      const seam = new THREE.Mesh(seamGeo, seamMat);
      seam.name = 'smithHeartPourSeams';
      seam.renderOrder = floorVfxRenderOrder('encounter', 17);
      seam.visible = false;
      seam.frustumCulled = false;
      this.root.add(seam);
      this.seams.push({ mesh: seam, mat: seamMat });
    }
    // The knell: its cracks over the floor, the sphere it gathers, its wall.
    const crackGeo = seamGeometry(knellCrackPaths(0x77, this.sim.knellRadius), 0.2);
    this.geometries.push(crackGeo);
    this.cracksMat = this.seamMaterial('smithHeartKnellCracks');
    this.cracks = new THREE.Mesh(crackGeo, this.cracksMat);
    this.cracks.name = 'smithHeartKnellCracks';
    this.cracks.renderOrder = floorVfxRenderOrder('encounter', 17);
    const sphereGeo = new THREE.IcosahedronGeometry(1, 3);
    this.geometries.push(sphereGeo);
    this.sphereMat = new THREE.ShaderMaterial({
      name: 'smithHeartKnellSphere',
      uniforms: { uAlpha: { value: 0 }, uCore: colorU(C.core), uFire: colorU(C.fire) },
      vertexShader: SPHERE_VERT,
      fragmentShader: SPHERE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sphere = new THREE.Mesh(sphereGeo, this.sphereMat);
    this.sphere.name = 'smithHeartKnellSphere';
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0);
    this.geometries.push(wallGeo);
    this.wallMat = new THREE.ShaderMaterial({
      name: 'smithHeartKnellWall',
      uniforms: {
        uAlpha: { value: 0 },
        uTime: this.uTime,
        uCore: colorU(C.core),
        uFire: colorU(C.fire),
      },
      vertexShader: WALL_VERT,
      fragmentShader: RING_WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.wall = new THREE.Mesh(wallGeo, this.wallMat);
    this.wall.name = 'smithHeartKnellWall';
    this.materials.push(this.cracksMat, this.sphereMat, this.wallMat);
    for (const m of [this.cracks, this.sphere, this.wall]) {
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private seamMaterial(name: string): THREE.ShaderMaterial {
    const m = new THREE.ShaderMaterial({
      name,
      uniforms: {
        uReach: { value: 0 },
        uAlpha: { value: 0 },
        uCore: { value: new THREE.Color(...C.core) },
        uFire: { value: new THREE.Color(...C.fire) },
      },
      vertexShader: SEAM_VERT,
      fragmentShader: SEAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(m);
    return m;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 50): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  /** Never claims an event: the renderer's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed || ev.type !== 'spellfx') return false;
    if (ev.ability === SEARING_KNELL && ev.fx === 'nova') {
      const e = this.world.entities.get(ev.sourceId);
      if (e) this.knell(e);
    } else if (ev.ability === MOLTEN_POUR) {
      const e = this.world.entities.get(ev.sourceId);
      if (e) this.pour(e);
    }
    return false;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      for (const e of world.entities.values()) {
        if (e.templateId !== HEAT_GUARDIAN || e.dead || this.charges.has(e.id)) continue;
        if (e.castingAbility === SEARING_KNELL) this.startCharge(e, 'knell');
        else if (e.castingAbility === MOLTEN_POUR) this.startCharge(e, 'pour');
      }
    }
    this.updateCharges(world, dt);
    this.updateFlows();
    this.updateKnell();
    this.particles.update(this.clock);
  }

  // ---- the bars and their telegraphs -------------------------------------------------

  private startCharge(e: Entity, kind: 'pour' | 'knell'): void {
    let fan: TelegraphFan | null = null;
    let lane: TelegraphLane | null = null;
    let slot = -1;
    for (const f of this.fans) {
      if (kind !== 'knell' || fan) break;
      let used = false;
      for (const c of this.charges.values()) if (c.fan === f) used = true;
      if (!used) fan = f;
    }
    for (let i = 0; i < this.lanes.length; i++) {
      if (kind !== 'pour' || lane) break;
      let used = false;
      for (const c of this.charges.values()) if (c.lane === this.lanes[i]) used = true;
      if (!used) {
        lane = this.lanes[i];
        slot = i;
      }
    }
    if (fan) {
      this.kit.layOutFan(fan, 360, { color: TELEGRAPH_THREAT_COLORS.danger, accent: C.accent });
      fan.group.visible = true;
    }
    if (lane) lane.group.visible = true;
    this.charges.set(e.id, {
      id: e.id,
      kind,
      x: e.pos.x,
      y: this.groundY(e.pos.x, e.pos.z),
      z: e.pos.z,
      progress: 0,
      fan,
      lane,
      slot,
    });
  }

  private endCharge(c: Charge): void {
    if (c.fan) c.fan.group.visible = false;
    if (c.lane) c.lane.group.visible = false;
    if (c.slot >= 0) this.seams[c.slot].mesh.visible = false;
    if (c.kind === 'knell') {
      this.sphere.visible = false;
      if (this.clock - this.knellBorn > 1.6) this.cracks.visible = false;
    }
    this.charges.delete(c.id);
  }

  private updateCharges(world: IWorld, dt: number): void {
    for (const c of this.charges.values()) {
      const e = world.entities.get(c.id);
      const id = c.kind === 'knell' ? SEARING_KNELL : MOLTEN_POUR;
      if (!e || e.dead || e.castingAbility !== id) {
        this.endCharge(c);
        continue;
      }
      c.x = e.pos.x;
      c.z = e.pos.z;
      c.y = this.groundY(c.x, c.z);
      const total =
        e.castTotal > 0 ? e.castTotal : c.kind === 'knell' ? this.sim.knellCast : this.sim.pourCast;
      c.progress = Math.max(c.progress, telegraphFillOf(e.castRemaining, total));
      if (c.kind === 'knell') this.chargeKnell(c, dt);
      else this.chargePour(c, e, dt);
    }
  }

  private chargePour(c: Charge, e: Entity, dt: number): void {
    const yaw = e.facing;
    const L = this.sim.pourLength;
    const HW = this.sim.pourHalfWidth;
    if (c.lane) {
      this.kit.drapeLane(c.lane, this.groundY, c.x, c.y, c.z, yaw, L, HW, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: C.accent,
      });
      this.kit.paintLane(c.lane, { fill: c.progress, clock: this.clock, range: L });
    }
    // The floor's seams lighting down the lane toward its end.
    if (c.slot >= 0) {
      const s = this.seams[c.slot];
      s.mesh.visible = true;
      s.mesh.position.set(c.x, c.y + 0.05, c.z);
      s.mesh.rotation.y = yaw;
      s.mat.uniforms.uReach.value = pourSeams(c.progress);
      s.mat.uniforms.uAlpha.value = 0.6 + 0.4 * c.progress;
    }
    // The first flame gathering at the guardian.
    const gather = pourGather(c.progress);
    if (this.rand() < dt * 30 * gather * this.density) {
      const a = this.rand() * Math.PI * 2;
      const r = 3 + this.rand() * 3;
      GATHER_DIR[0] = -Math.sin(a);
      GATHER_DIR[2] = -Math.cos(a);
      this.particles.puff(
        c.x + Math.sin(a) * r,
        c.y + 1 + this.rand() * 3,
        c.z + Math.cos(a) * r,
        2,
        GATHER_PUFF,
      );
    }
    // Sparks running down the lane.
    const sparks = pourSparks(c.progress);
    if (this.rand() < dt * 28 * sparks * this.density) {
      const along = this.rand() * L * pourSeams(c.progress);
      const across = (this.rand() - 0.5) * HW * 1.4;
      const x = c.x + Math.sin(yaw) * along + Math.cos(yaw) * across;
      const z = c.z + Math.cos(yaw) * along - Math.sin(yaw) * across;
      SPARK_DIR[0] = Math.sin(yaw);
      SPARK_DIR[2] = Math.cos(yaw);
      this.particles.puff(x, this.groundY(x, z) + 0.2, z, 2, SPARK_PUFF);
    }
  }

  private chargeKnell(c: Charge, dt: number): void {
    const R = this.sim.knellRadius;
    if (c.fan) {
      this.kit.drapeFan(c.fan, this.groundY, c.x, c.y, c.z, 0, R);
      this.kit.paintFan(c.fan, { fill: c.progress, clock: this.clock, range: R });
    }
    const g = knellGather(c.progress);
    this.sphere.visible = true;
    // Over the guardian's head (its body stands about six yards).
    this.sphere.position.set(c.x, c.y + 7.4, c.z);
    this.sphere.scale.setScalar(0.4 + 2.0 * g);
    this.sphereMat.uniforms.uAlpha.value = 0.35 + 0.6 * g;
    this.cracks.visible = true;
    this.cracks.position.set(c.x, c.y + 0.05, c.z);
    this.cracksMat.uniforms.uReach.value = knellCracks(c.progress);
    this.cracksMat.uniforms.uAlpha.value = 0.55 + 0.35 * c.progress;
    // The fire drawn in to the sphere.
    if (this.rand() < dt * 36 * (0.3 + g) * this.density) {
      const a = this.rand() * Math.PI * 2;
      const r = R * (0.5 + this.rand() * 0.6);
      GATHER_DIR[0] = -Math.sin(a);
      GATHER_DIR[2] = -Math.cos(a);
      this.particles.puff(c.x + Math.sin(a) * r, c.y + 0.6, c.z + Math.cos(a) * r, 1, GATHER_PUFF);
    }
  }

  // ---- Molten Pour lands -------------------------------------------------------------

  private pour(e: Entity): void {
    const c = this.charges.get(e.id);
    if (c) this.endCharge(c);
    const f = this.flows.find((o) => !o.live) ?? this.flows[0];
    f.born = this.clock;
    f.live = true;
    f.x = e.pos.x;
    f.z = e.pos.z;
    f.yaw = e.facing;
    const y = this.groundY(f.x, f.z);
    f.flow.position.set(f.x, y + 0.06, f.z);
    f.flow.rotation.y = f.yaw;
    f.flow.visible = true;
    f.wave.rotation.y = f.yaw;
    f.wave.scale.set(this.sim.pourHalfWidth * 2 * 0.9, 2.2, 1);
    f.wave.visible = true;
    // The flash at the guardian, spatter thrown up along the lane.
    this.particles.puff(f.x, y + 2.5, f.z, 12, {
      speed: 5,
      life: 0.4,
      size: [2.4, 6],
      color: C.fire,
      alpha: 0.6,
      pool: 'glow',
    });
    const L = this.sim.pourLength;
    const n = Math.round(14 * this.density);
    for (let k = 0; k < n; k++) {
      const along = (k / Math.max(1, n - 1)) * L;
      const px = f.x + Math.sin(f.yaw) * along;
      const pz = f.z + Math.cos(f.yaw) * along;
      this.particles.puff(px, this.groundY(px, pz) + 0.3, pz, 3, {
        speed: 5,
        up: 4,
        life: 0.6,
        size: [0.32, 0.06],
        color: C.spark,
        alpha: 1,
        pool: 'glow',
        gravity: 9,
      });
    }
    this.particles.shockRing(f.x, f.z, C.ringGold, 5, 0.4);
    this.shakeNear(f.x, f.z, 0.3, 40);
  }

  private updateFlows(): void {
    const L = this.sim.pourLength;
    for (const f of this.flows) {
      if (!f.live) continue;
      const age = this.clock - f.born;
      const look = pourFlowLook(age);
      if (age > POUR_MOLTEN_SECONDS) {
        f.live = false;
        f.flow.visible = false;
        f.wave.visible = false;
        continue;
      }
      f.flowMat.uniforms.uFront.value = look.front;
      f.flowMat.uniforms.uHeat.value = look.heat;
      f.flowMat.uniforms.uCrust.value = look.crust;
      const along = look.front * L;
      const wx = f.x + Math.sin(f.yaw) * along;
      const wz = f.z + Math.cos(f.yaw) * along;
      f.wave.position.set(wx, this.groundY(wx, wz), wz);
      f.waveMat.uniforms.uAlpha.value = look.wave * 0.9;
      f.wave.visible = look.wave > 0;
      // The cooling lane smoking (cosmetic, thinned).
      if (look.crust > 0.05 && this.rand() < 0.25 * this.density) {
        const t = this.rand();
        const px = f.x + Math.sin(f.yaw) * t * L;
        const pz = f.z + Math.cos(f.yaw) * t * L;
        this.particles.puff(px, this.groundY(px, pz) + 0.3, pz, 1, SMOKE_PUFF);
      }
    }
  }

  // ---- Searing Knell lands -----------------------------------------------------------

  private knell(e: Entity): void {
    const c = this.charges.get(e.id);
    const x = e.pos.x;
    const z = e.pos.z;
    const y = c?.y ?? this.groundY(x, z);
    this.knellBorn = this.clock;
    if (c) this.endCharge(c);
    this.sphere.visible = false;
    this.cracks.visible = true;
    this.cracks.position.set(x, y + 0.05, z);
    this.cracksMat.uniforms.uReach.value = 1;
    this.wall.position.set(x, y - 0.1, z);
    this.wall.visible = true;
    const R = this.sim.knellRadius;
    this.particles.puff(x, y + 4, z, 16, {
      speed: 6,
      life: 0.45,
      size: [3, 8],
      color: C.core,
      alpha: 0.7,
      pool: 'glow',
    });
    // The toll: rings of it, one after another.
    this.particles.shockRing(x, z, C.ring, R, KNELL_WAVE_SECONDS + 0.15);
    this.particles.shockRing(x, z, C.ringGold, R * 0.7, KNELL_WAVE_SECONDS + 0.35);
    this.particles.shockRing(x, z, C.ringGold, R * 0.4, KNELL_WAVE_SECONDS + 0.55);
    // Sparks and ash flung out to the ring's edge (never past it).
    const n = Math.round(36 * this.density * (this.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      this.particles.puff(
        x + Math.sin(a) * 1.5,
        y + 1 + this.rand() * 2,
        z + Math.cos(a) * 1.5,
        1,
        {
          speed: 12 + this.rand() * 8,
          life: 0.6,
          size: [0.32, 0.08],
          color: C.spark,
          alpha: 1,
          pool: 'glow',
          dir: [Math.sin(a), 0.3, Math.cos(a)],
          spread: 0.12,
          gravity: 8,
          drag: 0.9,
        },
      );
    }
    this.particles.puff(x, y + 0.6, z, 14, {
      speed: 7,
      up: 1,
      life: 1.4,
      size: [1.6, 4.4],
      color: C.ash,
      alpha: 0.34,
      drag: 2,
      radius: 2,
    });
    this.shakeNear(x, z, 0.55, R + 30);
  }

  private updateKnell(): void {
    if (!this.wall.visible && !this.cracks.visible) return;
    const age = this.clock - this.knellBorn;
    if (age < 0 || age > 3) {
      // Only the knell's own afterglow (a live bar keeps its cracks).
      this.wall.visible = false;
      return;
    }
    const look = knellBlastLook(age, this.sim.knellRadius);
    if (look.alpha <= 0) this.wall.visible = false;
    else {
      const r = Math.max(0.5, look.front);
      this.wall.scale.set(r, look.height, r);
      this.wallMat.uniforms.uAlpha.value = look.alpha * (this.density > 0.5 ? 0.9 : 0.65);
    }
    let charging = false;
    for (const c of this.charges.values()) if (c.kind === 'knell') charging = true;
    if (!charging) {
      this.cracksMat.uniforms.uAlpha.value = look.glow * 1.2;
      if (look.glow <= 0) this.cracks.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
