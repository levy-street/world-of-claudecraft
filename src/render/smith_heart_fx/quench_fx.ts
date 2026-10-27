// The Quench guardian's effects (plan: quench_fx_core.ts), hosted by
// ../rift_death_zone.ts beside the Hammer's and the Breath's. Presentation
// only, read from IWorld (the guardian's cast bar and facing, its events), so
// offline and online look the same:
//  - the telegraph, on EVERY graphics tier: Quenching Breath's cone at its
//    exact angle and range, aimed where the bar locked it, through the
//    shared floor telegraph, filling with the bar;
//  - Quenching Breath on its bar: the cold drawn in to the guardian's maw,
//    frost creeping out over the cone's floor, glints winking in it; when it
//    lands, a freezing gust of mist sweeping out to the cone's end, ice
//    ripping up out of the floor behind its front, glints flung out, the
//    floor left frosted a few seconds, rings, a short shake;
//  - Tempering Strike (a swing cleave, no bar): spikes of ice thrusting up
//    out of the floor in its arc, then shattering, a burst of frost mist and
//    shards, the floor frosted where it struck, a short shake.
// The cone is actionable and never thins; the frost, the mist and the ice
// are cosmetic and thin on the low tier and under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the root before its gated attach (one compile-gated
// attach, the telegraph kit's too); no light; no per-frame allocation (fixed
// pools); the frost and the telegraph are floor marks on the floor ladder's
// encounter band.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { ARC_CLEAVE_ABILITY, fxHash } from './hammer_fx_core';
import {
  BREATH_FROST_SECONDS,
  BREATH_SWEEP_SECONDS,
  breathCreep,
  breathDraw,
  breathFrost,
  breathGlints,
  QUENCH_FX_COLORS,
  QUENCH_FX_POOLS,
  QUENCH_GUARDIAN,
  QUENCHING_BREATH,
  quenchGuardianKit,
  STRIKE_FROST_SECONDS,
  STRIKE_HOLD_SECONDS,
  STRIKE_RISE_SECONDS,
  type StrikeSpike,
  strikeFrost,
  strikeRise,
  strikeSpikes,
} from './quench_fx_core';

const SCAN_SEC = 0.1;
const C = QUENCH_FX_COLORS;

/** The per-frame puffs' options, written in place (no allocation a frame):
 *  the cold drawn in to the maw, and the glints winking in the cone. */
const DRAW_DIR: [number, number, number] = [0, 0.25, 0];
const DRAW_PUFF = {
  speed: 8,
  life: 0.9,
  size: [0.8, 0.25] as const,
  color: C.mist,
  alpha: 0.28,
  dir: DRAW_DIR,
  spread: 0.12,
  drag: 0.5,
};
const GLINT_PUFF = {
  speed: 0.6,
  life: 0.5,
  size: [0.35, 0.05] as const,
  color: C.glint,
  alpha: 0.9,
  pool: 'glow' as const,
};

// ---- the frost left on the floor ---------------------------------------------------

const FROST_VERT = /* glsl */ `
varying vec2 vXY;
void main() {
  vXY = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** Frost on the floor in a fan: feathered crystals in broad cells, thick
 *  near the guardian and thinning out, its edge ragged. */
const FROST_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uReach;
uniform float uHalfArc;
uniform float uRange;
uniform vec3 uFrost;
uniform vec3 uDeep;
varying vec2 vXY;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
// The distance to the nearest edge of a jittered cell grid (unit cells).
float edge(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = o + vec2(h(i + o), h(i + o + 19.7)) * 0.8 + 0.1;
      float d = length(c - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
  }
  return (d2 - d1) * 0.5;
}
void main() {
  float r = length(vXY);
  float a = atan(vXY.x, vXY.y);
  vec2 yd = vXY * uRange;
  float ragged = n(yd * 0.6) * 0.16;
  if (r > uReach * (1.0 - ragged) || abs(a) > uHalfArc * (1.0 - ragged * 0.5)) discard;
  // Frost: a crust in plates (crisp seams of rime between them), feathers
  // of hoar growing across the plates, thick near the guardian.
  float seam = 1.0 - smoothstep(0.0, 0.06, edge(yd / 1.6));
  float feather = smoothstep(0.55, 0.8, n(yd * 2.2) * 0.6 + n(yd * 5.3 + 3.0) * 0.4);
  float crust = 0.45 + 0.55 * n(yd * 0.4 + 7.0);
  float thick = 1.0 - smoothstep(0.55, 1.0, r / max(0.01, uReach));
  float k = clamp(crust * 0.55 + seam * 0.6 + feather * 0.35, 0.0, 1.0) * (0.45 + 0.55 * thick);
  vec3 col = mix(uDeep, uFrost, clamp(0.45 + seam * 0.5 + feather * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col, k * uAlpha);
  #include <colorspace_fragment>
}
`;

/** A flat fan of unit radius round +z (spanning the whole circle: the
 *  shader cuts it to its arc and reach). */
function fanGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 48, 0, Math.PI * 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A spike of ice: a six-sided blade tapering to its tip, deep at the root
 *  and pale at the tip (the kit's ice material reads the vertex colour). */
function spikeGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.32, 1, 6, 2).translate(0, 0.5, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const deep = new THREE.Color().setRGB(...C.iceDeep);
  const pale = new THREE.Color().setRGB(...C.ice);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    // Flatten it to a blade a little, so it reads as a shard, not a cone.
    pos.setZ(i, pos.getZ(i) * 0.55);
    c.copy(deep).lerp(pale, Math.min(1, pos.getY(i) * 1.2));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

interface Charge {
  id: number;
  x: number;
  y: number;
  z: number;
  progress: number;
  fan: TelegraphFan | null;
  /** The frost creeping out under the cone while the bar fills. */
  creep: Frost | null;
}

interface Frost {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  span: number;
  live: boolean;
  kind: 'breath' | 'strike';
  /** Painted by its bar (a breath's creeping frost), not by its age. */
  creeping: boolean;
}

interface SpikeSet {
  mesh: THREE.InstancedMesh;
  spikes: StrikeSpike[];
  x: number;
  y: number;
  z: number;
  yaw: number;
  born: number;
  live: boolean;
  /** Breath: the spikes rise as the gust's front passes them. */
  sweep: boolean;
  shattered: boolean;
}

export class QuenchFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly fans: TelegraphFan[] = [];
  private readonly frosts: Frost[] = [];
  private readonly spikeSets: SpikeSet[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly charges = new Map<number, Charge>();
  private readonly sim = quenchGuardianKit();
  private seed = 0x51c3;
  private scanTimer = 0;
  private clock = 0;
  private disposed = false;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-quench-fx';
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
    // The telegraph: the cone's footprint on every tier (the kit's curtain
    // only where the tier draws detail).
    this.kit = new TelegraphKit(this.root, detail);
    for (let i = 0; i < QUENCH_FX_POOLS.telegraphs; i++) this.fans.push(this.kit.fan(10));
    // The frost left on the floor (one fan geometry, a material each: their
    // uniforms are their own frost's).
    const fanGeo = fanGeometry();
    this.geometries.push(fanGeo);
    for (let i = 0; i < QUENCH_FX_POOLS.frosts; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartQuenchFrost',
        uniforms: {
          uAlpha: { value: 0 },
          uReach: { value: 1 },
          uHalfArc: { value: 1 },
          uRange: { value: 1 },
          uFrost: { value: new THREE.Color(...C.frost) },
          uDeep: { value: new THREE.Color(...C.iceDeep) },
        },
        vertexShader: FROST_VERT,
        fragmentShader: FROST_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(fanGeo, mat);
      mesh.name = 'smithHeartQuenchFrost';
      mesh.visible = false;
      mesh.frustumCulled = false;
      // Over the floor, under the telegraph's fill front.
      mesh.renderOrder = floorVfxRenderOrder('encounter', 6);
      this.root.add(mesh);
      this.frosts.push({
        mesh,
        mat,
        born: -99,
        span: 1,
        live: false,
        kind: 'breath',
        creeping: false,
      });
    }
    // The spikes of ice (the guardian's strikes and breath, and the Smith's
    // blades echoing them: quench_fight_fx.ts asks through echoAt).
    const spike = spikeGeometry();
    this.geometries.push(spike);
    const iceMat = heartKitSlotMaterial('ice');
    for (let i = 0; i < QUENCH_FX_POOLS.spikes + QUENCH_FX_POOLS.breaths; i++) {
      const breath = i >= QUENCH_FX_POOLS.spikes;
      const spikes = breath
        ? this.breathShards(0x77 + (i - QUENCH_FX_POOLS.spikes) * 13)
        : strikeSpikes(0x31 + i * 7, this.sim.strikeArcDeg, this.sim.strikeRange);
      const mesh = new THREE.InstancedMesh(spike, iceMat, spikes.length);
      mesh.name = breath ? 'smithHeartQuenchBreathIce' : 'smithHeartQuenchStrikeIce';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < spikes.length; k++) mesh.setMatrixAt(k, this.m.makeScale(0, 0, 0));
      this.root.add(mesh);
      this.spikeSets.push({
        mesh,
        spikes,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        born: -99,
        live: false,
        sweep: breath,
        shattered: false,
      });
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  /** The breath's ice: low shards strewn through its cone (inside its arc
   *  and its range), rising as the gust's front passes. */
  private breathShards(seed: number): StrikeSpike[] {
    const half = (this.sim.breathArcDeg * Math.PI) / 360;
    const out: StrikeSpike[] = [];
    for (let i = 0; i < 36; i++) {
      const a = (fxHash(seed, i * 3) * 2 - 1) * half * 0.85;
      const r = this.sim.breathRange * (0.15 + 0.8 * Math.sqrt(fxHash(seed, i * 3 + 1)));
      out.push({
        x: Math.sin(a) * r,
        z: Math.cos(a) * r,
        height: 1.0 + 1.5 * fxHash(seed, i * 3 + 2),
        lean: 0.15 + 0.3 * fxHash(seed, i + 70),
        yaw: a,
      });
    }
    return out;
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 45): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  /** Never claims an event: the renderer's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed || ev.type !== 'spellfx') return false;
    if (ev.ability === QUENCHING_BREATH && ev.fx === 'nova') {
      const e = this.world.entities.get(ev.sourceId);
      if (e) {
        const c = this.charges.get(e.id);
        if (c) this.endCharge(c);
        this.breathAt(e.pos.x, e.pos.z, e.facing);
      }
    } else if (ev.fx === 'windup' && ev.ability === ARC_CLEAVE_ABILITY) {
      const e = this.world.entities.get(ev.sourceId);
      if (e && e.templateId === QUENCH_GUARDIAN) this.strikeAt(e.pos.x, e.pos.z, e.facing);
    }
    return false;
  }

  /** One of the Smith's blades echoes the guardian's attack from (x, z),
   *  facing `yaw` (world): the same freezing gust or ice as the guardian's
   *  own (quench_fight_fx.ts calls this when an echo lands). */
  echoAt(kind: 'breath' | 'strike', x: number, z: number, yaw: number): void {
    if (this.disposed) return;
    if (kind === 'breath') this.breathAt(x, z, yaw);
    else this.strikeAt(x, z, yaw);
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
        if (e.templateId !== QUENCH_GUARDIAN || e.dead || this.charges.has(e.id)) continue;
        if (e.castingAbility === QUENCHING_BREATH) this.startCharge(e);
      }
    }
    this.updateCharges(world, dt);
    this.updateFrosts();
    this.updateSpikes();
    this.particles.update(this.clock);
  }

  // ---- Quenching Breath's bar and its telegraph ---------------------------------------

  private startCharge(e: Entity): void {
    let fan: TelegraphFan | null = null;
    for (const f of this.fans) {
      let used = false;
      for (const c of this.charges.values()) if (c.fan === f) used = true;
      if (!used) {
        fan = f;
        break;
      }
    }
    if (fan) {
      this.kit.layOutFan(fan, this.sim.breathArcDeg, {
        color: TELEGRAPH_THREAT_COLORS.danger,
        accent: C.accent,
      });
      fan.group.visible = true;
    }
    // The frost creeping out under the cone (cosmetic, under the fill).
    const creep = this.layFrost(e.pos.x, e.pos.z, e.facing, 'breath', 0, 99);
    creep.creeping = true;
    this.charges.set(e.id, {
      id: e.id,
      x: e.pos.x,
      y: this.groundY(e.pos.x, e.pos.z),
      z: e.pos.z,
      progress: 0,
      fan,
      creep,
    });
  }

  private endCharge(c: Charge): void {
    if (c.fan) c.fan.group.visible = false;
    if (c.creep) {
      c.creep.live = false;
      c.creep.creeping = false;
      c.creep.mesh.visible = false;
    }
    this.charges.delete(c.id);
  }

  private updateCharges(world: IWorld, dt: number): void {
    for (const c of this.charges.values()) {
      const e = world.entities.get(c.id);
      if (!e || e.dead || e.castingAbility !== QUENCHING_BREATH) {
        this.endCharge(c);
        continue;
      }
      c.x = e.pos.x;
      c.z = e.pos.z;
      c.y = this.groundY(c.x, c.z);
      const total = e.castTotal > 0 ? e.castTotal : this.sim.breathCast;
      c.progress = Math.max(c.progress, telegraphFillOf(e.castRemaining, total));
      const R = this.sim.breathRange;
      const yaw = e.facing;
      if (c.fan) {
        this.kit.drapeFan(c.fan, this.groundY, c.x, c.y, c.z, yaw, R);
        this.kit.paintFan(c.fan, { fill: c.progress, clock: this.clock, range: R });
      }
      const creep = breathCreep(c.progress);
      const draw = breathDraw(c.progress);
      const glints = breathGlints(c.progress);
      // The creeping frost follows the cone (its reach grows with the bar).
      if (c.creep) {
        c.creep.mesh.position.set(c.x, c.y + 0.06, c.z);
        c.creep.mesh.rotation.y = yaw;
        c.creep.mat.uniforms.uReach.value = creep;
        c.creep.mat.uniforms.uAlpha.value = 0.35 * creep;
      }
      const half = (this.sim.breathArcDeg * Math.PI) / 360;
      // The cold drawn in to the maw: mist streaming back from the cone.
      for (let k = 0; k < 2; k++) {
        if (this.rand() > dt * 34 * draw * this.density) continue;
        const a = yaw + (this.rand() * 2 - 1) * half;
        const r = 4 + this.rand() * R * 0.6;
        const px = c.x + Math.sin(a) * r;
        const pz = c.z + Math.cos(a) * r;
        DRAW_DIR[0] = -Math.sin(a);
        DRAW_DIR[2] = -Math.cos(a);
        DRAW_PUFF.speed = 8 + draw * 8;
        this.particles.puff(px, c.y + 0.6 + this.rand() * 2.5, pz, 2, DRAW_PUFF);
      }
      // Glints winking in the cone as it fills.
      if (this.rand() < dt * 24 * glints * this.density) {
        const a = yaw + (this.rand() * 2 - 1) * half;
        const r = this.rand() * R;
        const px = c.x + Math.sin(a) * r;
        const pz = c.z + Math.cos(a) * r;
        this.particles.puff(px, this.groundY(px, pz) + 0.3 + this.rand() * 1.2, pz, 1, GLINT_PUFF);
      }
    }
  }

  // ---- Quenching Breath lands -----------------------------------------------------------

  private breathAt(x: number, z: number, yaw: number): void {
    const y = this.groundY(x, z);
    const R = this.sim.breathRange;
    const half = (this.sim.breathArcDeg * Math.PI) / 360;
    // The frost: the whole cone frosted, staying a while.
    this.layFrost(x, z, yaw, 'breath', 1, BREATH_FROST_SECONDS);
    // The freezing gust: mist billowing out along the cone.
    const n = Math.round(30 * this.density * (this.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = yaw + (this.rand() * 2 - 1) * half * 0.9;
      this.particles.puff(
        x + Math.sin(a) * 2.5,
        y + 1.6 + this.rand() * 2,
        z + Math.cos(a) * 2.5,
        1,
        {
          speed: (R / BREATH_SWEEP_SECONDS) * (0.55 + this.rand() * 0.5),
          life: 1.2,
          size: [1.6, 5.5],
          color: C.mist,
          alpha: 0.5,
          dir: [Math.sin(a), -0.05, Math.cos(a)],
          spread: 0.08,
          drag: 1.4,
        },
      );
    }
    // Glints and ice dust flung out.
    for (let i = 0; i < Math.round(16 * this.density); i++) {
      const a = yaw + (this.rand() * 2 - 1) * half;
      this.particles.puff(x + Math.sin(a) * 2, y + 1.4, z + Math.cos(a) * 2, 1, {
        speed: 9 + this.rand() * 9,
        life: 0.8,
        size: [0.26, 0.06],
        color: C.glint,
        alpha: 1,
        pool: 'glow',
        dir: [Math.sin(a), 0.15, Math.cos(a)],
        spread: 0.1,
        gravity: 4,
        drag: 0.8,
      });
    }
    // The ice ripping up behind the front.
    this.liftSpikes(this.freeSet(QUENCH_FX_POOLS.spikes, QUENCH_FX_POOLS.breaths), x, y, z, yaw);
    this.particles.shockRing(x, z, C.ringCold, 7, 0.45);
    this.shakeNear(x, z, 0.35, R + 20);
  }

  // ---- Tempering Strike ---------------------------------------------------------------

  /** The first idle set of `count` from `from` (all live: the first). */
  private freeSet(from: number, count: number): SpikeSet {
    for (let i = from; i < from + count; i++) if (!this.spikeSets[i].live) return this.spikeSets[i];
    return this.spikeSets[from];
  }

  private strikeAt(x: number, z: number, yaw: number): void {
    const y = this.groundY(x, z);
    this.liftSpikes(this.freeSet(0, QUENCH_FX_POOLS.spikes), x, y, z, yaw);
    this.layFrost(x, z, yaw, 'strike', 1, STRIKE_FROST_SECONDS);
    const half = (this.sim.strikeArcDeg * Math.PI) / 360;
    for (let k = 0; k < Math.round(10 * this.density); k++) {
      const a = yaw + (this.rand() * 2 - 1) * half;
      const r = this.sim.strikeRange * (0.3 + this.rand() * 0.6);
      this.particles.puff(x + Math.sin(a) * r, y + 0.5, z + Math.cos(a) * r, 2, {
        speed: 3,
        up: 2,
        life: 1.3,
        size: [1.2, 3.6],
        color: C.mist,
        alpha: 0.42,
        dir: [Math.sin(a), 0.5, Math.cos(a)],
        spread: 0.5,
      });
    }
    this.particles.shockRing(
      x + Math.sin(yaw) * 3,
      z + Math.cos(yaw) * 3,
      C.ring,
      this.sim.strikeRange,
      0.35,
    );
    this.shakeNear(x, z, 0.3, 30);
  }

  private liftSpikes(set: SpikeSet, x: number, y: number, z: number, yaw: number): void {
    set.x = x;
    set.y = y;
    set.z = z;
    set.yaw = yaw;
    set.born = this.clock;
    set.live = true;
    set.shattered = false;
    set.mesh.visible = true;
  }

  private updateSpikes(): void {
    for (const set of this.spikeSets) {
      if (!set.live) continue;
      const age = this.clock - set.born;
      const cy = Math.cos(set.yaw);
      const sy = Math.sin(set.yaw);
      let any = false;
      for (let k = 0; k < set.spikes.length; k++) {
        const sp = set.spikes[k];
        // The breath's ice rises as its front reaches each shard.
        const reach = Math.hypot(sp.x, sp.z) / Math.max(1, this.sim.breathRange);
        const local = set.sweep ? age - reach * BREATH_SWEEP_SECONDS : age;
        const hold = set.sweep ? 0.9 : 0;
        const rise =
          local < 0
            ? 0
            : set.sweep && local < STRIKE_RISE_SECONDS + STRIKE_HOLD_SECONDS + hold
              ? Math.min(1, local / STRIKE_RISE_SECONDS)
              : strikeRise(local);
        if (rise <= 0) {
          set.mesh.setMatrixAt(k, this.m.makeScale(0, 0, 0));
          if (local < STRIKE_RISE_SECONDS) any = true;
          continue;
        }
        any = true;
        const wx = set.x + sp.x * cy + sp.z * sy;
        const wz = set.z - sp.x * sy + sp.z * cy;
        this.v.set(wx, this.groundY(wx, wz) - 0.2, wz);
        // Leaning out from the guardian, along its line.
        this.e.set(sp.lean, set.yaw + sp.yaw, 0, 'YXZ');
        this.q.setFromEuler(this.e);
        const h = sp.height * (0.2 + 0.8 * rise);
        this.s.set(1.2 + sp.height * 0.25, h, 1.2 + sp.height * 0.25);
        set.mesh.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
      }
      set.mesh.instanceMatrix.needsUpdate = true;
      // The shatter: the spikes burst into shards and mist, once.
      const shatterAt =
        STRIKE_RISE_SECONDS + STRIKE_HOLD_SECONDS + (set.sweep ? 0.9 + BREATH_SWEEP_SECONDS : 0);
      if (!set.shattered && age >= shatterAt) {
        set.shattered = true;
        this.shatter(set);
      }
      if (!any || age > shatterAt + 0.05) {
        set.live = false;
        set.mesh.visible = false;
      }
    }
  }

  private shatter(set: SpikeSet): void {
    const cy = Math.cos(set.yaw);
    const sy = Math.sin(set.yaw);
    const every = set.sweep ? 3 : 1;
    for (let k = 0; k < set.spikes.length; k += every) {
      const sp = set.spikes[k];
      const wx = set.x + sp.x * cy + sp.z * sy;
      const wz = set.z - sp.x * sy + sp.z * cy;
      const y = this.groundY(wx, wz);
      this.particles.puff(wx, y + sp.height * 0.5, wz, 3, {
        speed: 5,
        up: 3,
        life: 0.7,
        size: [0.28, 0.12],
        color: C.ice,
        alpha: 0.95,
        pool: 'glow',
        gravity: 14,
        drag: 0.3,
      });
      this.particles.puff(wx, y + 0.6, wz, 1, {
        speed: 1.5,
        up: 1.2,
        life: 1.2,
        size: [1.0, 2.6],
        color: C.mist,
        alpha: 0.35,
      });
    }
  }

  // ---- the frost on the floor ---------------------------------------------------------

  /** Lay a fan of frost on the floor: `reach` its share of the cast's
   *  range (the fan's scale), its arc the cast's. */
  private layFrost(
    x: number,
    z: number,
    yaw: number,
    kind: 'breath' | 'strike',
    reach: number,
    span: number,
  ): Frost {
    const f = this.frosts.find((o) => !o.live) ?? this.frosts[0];
    f.live = true;
    f.creeping = false;
    f.kind = kind;
    f.born = this.clock;
    f.span = span;
    f.mesh.position.set(x, this.groundY(x, z) + 0.06, z);
    f.mesh.rotation.y = yaw;
    const arc = kind === 'breath' ? this.sim.breathArcDeg : this.sim.strikeArcDeg;
    const range = kind === 'breath' ? this.sim.breathRange : this.sim.strikeRange;
    f.mat.uniforms.uHalfArc.value = (arc * Math.PI) / 360;
    f.mat.uniforms.uReach.value = reach;
    f.mesh.scale.set(range, 1, range);
    f.mat.uniforms.uRange.value = range;
    f.mat.uniforms.uAlpha.value = 0;
    f.mesh.visible = true;
    return f;
  }

  private updateFrosts(): void {
    for (const f of this.frosts) {
      if (!f.live || f.creeping) continue;
      const age = this.clock - f.born;
      const k =
        f.kind === 'breath' ? breathFrost(age) : strikeFrost(age) * (age < 0.15 ? age / 0.15 : 1);
      f.mat.uniforms.uAlpha.value = 0.75 * k;
      if (age > f.span) {
        f.live = false;
        f.mesh.visible = false;
      }
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
    for (const s of this.spikeSets) s.mesh.dispose();
  }
}
