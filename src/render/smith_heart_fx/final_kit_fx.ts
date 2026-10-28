// The Masterless Strength's quarter kits' look (plan: final_kit_fx_core.ts;
// design doc 7.5), hosted by ../rift_death_zone.ts beside FinalFx (its body,
// the Overload Burst) and HeatFx (Basalt Fist's spot, its lanes and its
// Molten Swells, which the final reuses whole). Read from IWorld (the fight's
// objects, the boss's bar and auras, the players' marks, the cues), so
// offline and online look the same:
//   - every footprint at the sim's exact radius through the shared floor
//     telegraph on EVERY tier: a Fire Whirl's (danger), a burning pool's
//     (danger), a Groaning Ice crack (lethal, filling to its break), a Tremor
//     Crack (danger, filling), a Storm Orb (the soak's gold), Weight of the
//     Anvil's mark (the soak's gold, filling with the bar, turning with it on
//     Mythic), the ring round an Ember Mark (the pool it will drop), round
//     Drawn Lightning (its reach), round Leaping Bolt's target (its leap), and
//     the gale's rim band while it gathers and blows;
//   - the reaction and the impact, cosmetic over them: the whirls' columns
//     of fire and their embers, the pools' flames, frost and ice shards at a
//     crack, the gale's streaks and dust racing the way it blows, lightning
//     leaping between bodies, the orbs' crackling spheres, the great anvil
//     hanging over its mark and dropping onto it, the stone shells, the ice
//     round a frozen player, Taking Root's spikes of rock round the boss's
//     feet, Heart Unbound's blaze, the switch's shockwave in the four veins'
//     light.
// The footprints, the rim band, the ice, the shells, the anvil and the root's
// spikes draw on every tier; the particles thin on the low tier and the shakes
// go under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through `attachSceneGroupGated`; fixed
// pools, no light, no per-frame allocation past a new object's first sight;
// every floor piece on its own rung (FINAL_KIT_FLOOR); every shader places
// its points through `modelViewMatrix` (camera-relative).

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { HEART_ROOM, inSmithHeartRoom } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_TUNING as T,
} from '../../sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  type TelegraphFan,
  TelegraphKit,
  type TelegraphStyle,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  anvilDrop,
  FINAL_KIT_COLORS as C,
  FINAL_KIT_FLOOR as F,
  FINAL_FOOTPRINTS,
  type FinalObjectKind,
  finalKitClaims,
  finalObjectKind,
  finalObjectSeconds,
  orbBob,
  FINAL_KIT_POOLS as P,
  FINAL_REACH as R,
  rootRise,
  timedFill,
  whirlSpin,
} from './final_kit_fx_core';
import { fxHash } from './hammer_fx_core';

const SCAN_SEC = 0.25;
/** The switch's shockwave: one ring per vein. */
const VEIN_RINGS: readonly number[] = [C.heat, C.quench, C.breath, C.hammer];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const WHIRL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A column of fire turning on itself: bands of flame climbing and
 *  twisting, a white-hot core low down, ragged at the top. */
const WHIRL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
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
  vec2 q = vec2(vUv.x * 6.0 + vUv.y * 3.0 - uTime * 1.8, vUv.y * 3.0 - uTime * 2.6);
  float f = n(q) * 0.65 + n(q * 2.3 + 4.1) * 0.35;
  float top = 1.0 - smoothstep(0.55, 1.0, vUv.y + (f - 0.5) * 0.35);
  float body = smoothstep(0.25, 0.75, f) * top;
  vec3 col = mix(uFire, uCore, smoothstep(0.55, 0.95, f) * (1.0 - vUv.y));
  gl_FragColor = vec4(col * (0.8 + 0.6 * f), body * uAlpha);
}
`;

const UV_VERT = WHIRL_VERT;
/** A Storm Orb: a globe of violet lightning, its rim bright, forks of white
 *  crawling over it, harder as it nears its burst. */
const ORB_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCrackle;
uniform vec3 uStorm;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 q = vUv * vec2(12.0, 6.0) + vec2(uTime * 0.7, -uTime * 1.3);
  float fork = 1.0 - abs(n(q) * 2.0 - 1.0);
  fork = pow(fork, 10.0) * (0.6 + uCrackle);
  float rim = 0.35 + 0.65 * abs(vUv.y - 0.5) * 2.0;
  vec3 col = uStorm * (0.55 + rim * 0.5) + vec3(1.0) * fork;
  gl_FragColor = vec4(col, 0.55 + fork * 0.45);
}
`;

/** The ice round a frozen player: pale, bright at its edges, glinting. */
const ICE_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFrost;
varying vec2 vUv;
void main() {
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = 1.0 - smoothstep(0.0, 0.12, min(e.x, e.y));
  float glint = smoothstep(0.96, 1.0, sin((vUv.x + vUv.y) * 9.0 - uTime * 2.0));
  gl_FragColor = vec4(uFrost * (0.6 + edge * 0.8 + glint), 0.32 + edge * 0.45);
}
`;

/** The gale's rim band: streams of storm light racing round with the wind,
 *  brighter where the wind drives (its heading), a hard edge at the rim. */
const RIM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uHeading;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  float a = atan(vLocal.x, vLocal.z);
  float facing = 0.35 + 0.65 * max(0.0, cos(a - uHeading));
  float streak = 0.5 + 0.5 * sin(a * 40.0 - uTime * 9.0 + vUv.x * 6.0);
  float edge = smoothstep(0.75, 1.0, vUv.x);
  float a2 = (0.25 + 0.45 * streak + 0.6 * edge) * facing;
  gl_FragColor = vec4(uColor * (0.8 + 0.6 * edge), a2 * uAlpha);
}
`;
const RIM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

interface FootSlot {
  fan: TelegraphFan;
  key: number;
  style: TelegraphStyle | null;
  seen: boolean;
}

interface ObjSeen {
  born: number;
  kind: FinalObjectKind;
}

interface Arc {
  from: number;
  to: number;
  born: number;
  seed: number;
}

export class FinalKitFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly slots: FootSlot[] = [];
  private readonly slotByKey = new Map<number, FootSlot>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly whirls: THREE.Mesh[] = [];
  private readonly whirlMat: THREE.ShaderMaterial;
  private readonly orbs: THREE.Mesh[] = [];
  private readonly orbMat: THREE.ShaderMaterial;
  private readonly ice: THREE.Mesh[] = [];
  private readonly shells: THREE.Mesh[] = [];
  private readonly arcsMesh: THREE.InstancedMesh;
  private readonly arcs: Arc[] = [];
  private readonly spikes: THREE.InstancedMesh;
  private readonly anvil = new THREE.Group();
  private readonly anvilGlow: THREE.MeshBasicMaterial;
  private readonly rim: THREE.Mesh;
  private readonly rimMat: THREE.ShaderMaterial;
  private readonly unboundRing: THREE.Mesh;
  private readonly unboundMat: THREE.MeshBasicMaterial;
  private readonly seen = new Map<number, ObjSeen>();
  private readonly objectIds: number[] = [];
  private readonly playerIds: number[] = [];
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private bossId = -1;
  private clock = 0;
  private seed = 0x3c71;
  private active = false;
  private disposed = false;
  private originX = 0;
  private originZ = 0;
  private windHeading = 0;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-final-kit-fx';
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
      F.particles,
    );
    // Every footprint: one pooled fan each (a full ring), every tier.
    this.kit = new TelegraphKit(this.root, detail);
    for (let i = 0; i < P.footprints; i++)
      this.slots.push({ fan: this.kit.fan(F.footprint), key: 0, style: null, seen: false });
    const col = (c: readonly [number, number, number]) => ({ value: new THREE.Color(...c) });
    // The whirls' columns of fire.
    const whirlGeo = new THREE.CylinderGeometry(0.55, 1.35, 1, 24, 6, true).translate(0, 0.5, 0);
    this.geometries.push(whirlGeo);
    this.whirlMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalWhirl',
      uniforms: {
        uTime: this.uTime,
        uAlpha: { value: 1 },
        uCore: col(C.fireCore),
        uFire: col(C.fire),
      },
      vertexShader: WHIRL_VERT,
      fragmentShader: WHIRL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(this.whirlMat);
    for (let i = 0; i < P.whirls; i++) {
      const m = new THREE.Mesh(whirlGeo, this.whirlMat);
      m.name = 'smithHeartFinalWhirl';
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
      this.whirls.push(m);
    }
    // The Storm Orbs.
    const orbGeo = new THREE.SphereGeometry(1, 24, 16);
    this.geometries.push(orbGeo);
    this.orbMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalOrb',
      uniforms: { uTime: this.uTime, uCrackle: { value: 0.4 }, uStorm: col(C.storm) },
      vertexShader: UV_VERT,
      fragmentShader: ORB_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(this.orbMat);
    for (let i = 0; i < P.orbs; i++) {
      const m = new THREE.Mesh(orbGeo, this.orbMat);
      m.name = 'smithHeartFinalOrb';
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
      this.orbs.push(m);
    }
    // The ice round the frozen, the stone round the shelled.
    const iceGeo = new THREE.BoxGeometry(1.6, 2.6, 1.6).translate(0, 1.3, 0);
    this.geometries.push(iceGeo);
    const iceMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalIce',
      uniforms: { uTime: this.uTime, uFrost: col(C.frost) },
      vertexShader: UV_VERT,
      fragmentShader: ICE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.materials.push(iceMat);
    for (let i = 0; i < P.ice; i++) {
      const m = new THREE.Mesh(iceGeo, iceMat);
      m.name = 'smithHeartFinalIce';
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
      this.ice.push(m);
    }
    const shellGeo = new THREE.IcosahedronGeometry(1.25, 0).translate(0, 1.1, 0);
    this.geometries.push(shellGeo);
    const shellMat = new THREE.MeshLambertMaterial({
      name: 'smithHeartFinalShell',
      color: new THREE.Color(...C.stone),
      transparent: true,
      opacity: 0.55,
      flatShading: true,
      depthWrite: false,
    });
    this.materials.push(shellMat);
    for (let i = 0; i < P.shells; i++) {
      const m = new THREE.Mesh(shellGeo, shellMat);
      m.name = 'smithHeartFinalShell';
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
      this.shells.push(m);
    }
    // The lightning: thin segments between the bodies it leaps through.
    const arcGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    this.geometries.push(arcGeo);
    const arcMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalArcs',
      color: 0xe6dcff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(arcMat);
    this.arcsMesh = new THREE.InstancedMesh(arcGeo, arcMat, P.arcs * P.arcSegments);
    this.arcsMesh.name = 'smithHeartFinalArcs';
    this.arcsMesh.frustumCulled = false;
    this.arcsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.arcs * P.arcSegments; i++)
      this.arcsMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.root.add(this.arcsMesh);
    // Taking Root's spikes of rock.
    const spikeGeo = new THREE.ConeGeometry(0.7, 1, 5).translate(0, 0.5, 0);
    this.geometries.push(spikeGeo);
    const spikeMat = new THREE.MeshLambertMaterial({
      name: 'smithHeartFinalRootSpikes',
      color: new THREE.Color(...C.stone).multiplyScalar(0.8),
      flatShading: true,
    });
    this.materials.push(spikeMat);
    this.spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, P.rootSpikes);
    this.spikes.name = 'smithHeartFinalRootSpikes';
    this.spikes.frustumCulled = false;
    this.spikes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.rootSpikes; i++) this.spikes.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.root.add(this.spikes);
    // The great anvil: dark iron, its face and horn, its underside glowing.
    // Dark forged iron, hot from within (its emissive): it reads as a black
    // weight against the bright room, never a pale box under its light.
    const iron = new THREE.MeshLambertMaterial({
      name: 'smithHeartFinalAnvilIron',
      color: 0x4a423c,
      emissive: 0x1c0802,
      flatShading: true,
    });
    this.anvilGlow = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalAnvilGlow',
      color: C.soak,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(iron, this.anvilGlow);
    const piece = (
      geo: THREE.BufferGeometry,
      x: number,
      y: number,
      z: number,
      mat: THREE.Material,
    ) => {
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.frustumCulled = false;
      this.anvil.add(m);
      return m;
    };
    piece(new THREE.BoxGeometry(7, 1.6, 4.4), 0, 0.8, 0, iron);
    piece(new THREE.BoxGeometry(4, 2.4, 2.6), 0, 2.8, 0, iron);
    piece(new THREE.BoxGeometry(9, 1.8, 3.6), -0.6, 4.9, 0, iron);
    piece(new THREE.ConeGeometry(1.4, 4, 8).rotateZ(Math.PI / 2), 5.8, 4.9, 0, iron);
    piece(new THREE.CircleGeometry(5.2, 32).rotateX(Math.PI / 2), 0, 0.02, 0, this.anvilGlow);
    this.anvil.name = 'smithHeartFinalAnvil';
    this.anvil.visible = false;
    this.root.add(this.anvil);
    // The gale's rim band (every tier): a flat ring from the band's inner edge
    // to the rim, on its own floor rung.
    const rimGeo = new THREE.RingGeometry(R.rimInner, R.rimOuter, 160, 1).rotateX(-Math.PI / 2);
    this.geometries.push(rimGeo);
    this.rimMat = new THREE.ShaderMaterial({
      name: 'smithHeartFinalRimBand',
      uniforms: {
        uTime: this.uTime,
        uAlpha: { value: 0 },
        uHeading: { value: 0 },
        uColor: { value: new THREE.Color(FINAL_FOOTPRINTS.rim.color) },
      },
      vertexShader: RIM_VERT,
      fragmentShader: RIM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(this.rimMat);
    this.rim = new THREE.Mesh(rimGeo, this.rimMat);
    this.rim.name = 'smithHeartFinalRimBand';
    this.rim.renderOrder = floorVfxRenderOrder('encounter', F.rim);
    this.rim.visible = false;
    this.rim.frustumCulled = false;
    this.root.add(this.rim);
    // Heart Unbound's blaze round the boss in the ring.
    const ringGeo = new THREE.RingGeometry(6, 9, 64, 1).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    this.unboundMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalUnbound',
      color: 0xffd890,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.materials.push(this.unboundMat);
    this.unboundRing = new THREE.Mesh(ringGeo, this.unboundMat);
    this.unboundRing.name = 'smithHeartFinalUnbound';
    this.unboundRing.renderOrder = floorVfxRenderOrder('encounter', F.marks);
    this.unboundRing.visible = false;
    this.unboundRing.frustumCulled = false;
    this.root.add(this.unboundRing);
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return this.seed / 0x100000000;
  }

  private shake(x: number, z: number, amount: number, reach = 60): void {
    if (!this.shakeSink || this.reducedMotion() || !this.world) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - d / reach));
  }

  // ---- the cues ---------------------------------------------------------------------

  /** Claims the final's own cues (they are drawn here and in FinalFx). */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    if (!finalKitClaims(ev.ability)) return false;
    if (!this.active) return true;
    if (ev.type === 'spellfx') {
      const target = this.world.entities.get(ev.targetId);
      const source = this.world.entities.get(ev.sourceId);
      if (ev.ability === FINAL_CUES.bolt || ev.ability === FINAL_CUES.arc) {
        this.addArc(ev.sourceId, ev.targetId);
        if (target) this.sparkAt(target.pos.x, target.pos.z, C.storm, 10, 1.6);
        return true;
      }
      if (!target) return true;
      const x = target.pos.x;
      const z = target.pos.z;
      if (ev.ability === FINAL_CUES.whirl) this.sparkAt(x, z, C.fire, 14, 1.4);
      else if (ev.ability === FINAL_CUES.freeze) {
        this.sparkAt(x, z, C.frost, 22, 1.6);
        this.particles.shockRing(x, z, 0xbfe6ff, 4, 0.5);
      } else if (ev.ability === FINAL_CUES.shell) this.dustAt(x, z, 10, 1.4);
      else if (ev.ability === FINAL_CUES.root) {
        this.dustAt(x, z, 26, 5);
        this.particles.shockRing(x, z, 0xe8c070, 7, 0.6);
        this.shake(x, z, 0.25);
      } else if (ev.ability === FINAL_CUES.unbound && source)
        this.sparkAt(x, z, [1, 0.85, 0.55], 8, 6);
      return true;
    }
    const x = ev.x;
    const z = ev.z;
    const y = this.groundY(x, z);
    switch (ev.ability) {
      case FINAL_CUES.shock:
        this.veinShockAt(x, z);
        break;
      case FINAL_CUES.embers:
      case FINAL_CUES.forgeFire:
        this.particles.puff(x, y + 9, z, Math.round(26 * this.density) + 6, {
          speed: 2,
          up: -12,
          life: 0.8,
          size: [0.7, 0.2],
          color: C.fire,
          alpha: 1,
          pool: 'pyre',
          radius: ev.radius ?? 3,
        });
        this.particles.shockRing(x, z, 0xff9a3a, ev.radius ?? 4, 0.5);
        break;
      case FINAL_CUES.iceBreak:
        this.particles.shockRing(x, z, 0xbfe6ff, R.crack * 1.4, 0.6);
        for (let i = 0; i < Math.round(26 * this.density) + 6; i++) {
          const a = this.rand() * Math.PI * 2;
          const r = this.rand() * R.crack;
          this.particles.puff(x + Math.cos(a) * r, y + 0.2, z + Math.sin(a) * r, 1, {
            speed: 3,
            up: 8,
            life: 1.1,
            size: [0.5, 0.2],
            color: C.frost,
            alpha: 1,
            pool: 'glow',
            gravity: 18,
          });
        }
        this.shake(x, z, 0.3);
        break;
      case FINAL_CUES.orbTaken:
        this.sparkAt(x, z, C.storm, 18, 1.2);
        this.particles.shockRing(x, z, 0xc8b8ff, 4, 0.4);
        break;
      case FINAL_CUES.orbBurst:
        this.sparkAt(x, z, C.storm, 50, 3);
        this.particles.shockRing(x, z, 0xc8b8ff, 30, 1.0);
        this.shake(x, z, 0.5, 90);
        break;
      case FINAL_CUES.tremor:
        this.dustAt(x, z, 24, R.tremor);
        this.particles.shockRing(x, z, 0xe8c070, R.tremor * 1.3, 0.5);
        this.shake(x, z, 0.3);
        break;
      case FINAL_CUES.anvil:
        this.anvil.visible = false;
        this.dustAt(x, z, 60, R.anvil);
        this.particles.shockRing(x, z, C.soak, R.anvil * 2.6, 0.9);
        this.particles.shockRing(x, z, 0xffffff, R.anvil * 1.2, 0.35);
        this.sparkAt(x, z, [1, 0.85, 0.5], 40, R.anvil);
        this.shake(x, z, 0.9, 90);
        break;
      default:
    }
    return true;
  }

  private sparkAt(
    x: number,
    z: number,
    color: readonly [number, number, number],
    n: number,
    radius: number,
  ): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 1, z, Math.round(n * this.density) + 2, {
      speed: 7,
      up: 5,
      life: 0.7,
      size: [0.45, 0.08],
      color,
      alpha: 1,
      pool: 'glow',
      radius,
      drag: 1,
    });
  }

  private dustAt(x: number, z: number, n: number, radius: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 0.4, z, Math.round(n * this.density) + 3, {
      speed: 5,
      up: 3,
      life: 1.5,
      size: [1.2, 3.6],
      color: C.dust,
      alpha: 0.45,
      drag: 1.2,
      radius,
    });
  }

  /** The switch's shockwave: rings of the four veins' light racing out over
   *  the whole Anvil from where the boss crossed. */
  private veinShockAt(x: number, z: number): void {
    for (let i = 0; i < VEIN_RINGS.length; i++)
      this.particles.shockRing(x, z, VEIN_RINGS[i], 30 + i * 9, 0.9 + i * 0.15);
    this.sparkAt(x, z, [1, 0.9, 0.7], 40, 6);
    this.dustAt(x, z, 30, 8);
    this.shake(x, z, 0.7, 120);
  }

  private addArc(from: number, to: number): void {
    let slot = this.arcs.find((a) => this.clock - a.born > 0.4);
    if (!slot) {
      if (this.arcs.length >= P.arcs) slot = this.arcs[0];
      else {
        slot = { from, to, born: this.clock, seed: 0 };
        this.arcs.push(slot);
      }
    }
    slot.from = from;
    slot.to = to;
    slot.born = this.clock;
    slot.seed = this.rand() * 1000;
  }

  // ---- the frame ----------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    const me = world.entities.get(world.playerId);
    const def = DUNGEONS.smith_heart;
    let inHeart = false;
    if (me && def) {
      const o = instanceOrigin(def.index, instanceSlotForZ(me.pos.z));
      inHeart =
        Math.abs(me.pos.x - o.x) < 300 &&
        Math.abs(me.pos.z - o.z) < 260 &&
        inSmithHeartRoom(me.pos.x - o.x, me.pos.z - o.z);
      this.originX = o.x;
      this.originZ = o.z;
    }
    if (!inHeart) {
      if (this.active) this.leave();
      this.particles.update(this.clock);
      return;
    }
    this.active = true;
    this.scan(world, dt);
    for (const s of this.slots) s.seen = false;
    this.paintObjects(world);
    this.paintMarks(world);
    this.paintBoss(world);
    for (const s of this.slots)
      if (!s.seen && s.key !== 0) {
        this.slotByKey.delete(s.key);
        s.key = 0;
        s.fan.group.visible = false;
      }
    this.paintArcs(world);
    this.particles.update(this.clock);
  }

  private scan(world: IWorld, dt: number): void {
    this.scanTimer -= dt;
    if (world.entityRosterVersion === this.rosterSeen && this.scanTimer > 0) return;
    this.scanTimer = SCAN_SEC;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    this.objectIds.length = 0;
    this.playerIds.length = 0;
    this.bossId = -1;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') this.playerIds.push(e.id);
      else if (e.kind === 'mob' && e.templateId === FINAL_BOSS) this.bossId = e.id;
      else if (e.kind === 'object') {
        const kind = finalObjectKind(e.templateId);
        if (!kind) continue;
        this.objectIds.push(e.id);
        if (!this.seen.has(e.id)) this.seen.set(e.id, { born: this.clock, kind });
      }
    }
    for (const id of this.seen.keys()) if (!world.entities.has(id)) this.seen.delete(id);
  }

  /** The fan for `key` this frame, styled and draped at (x, z). */
  private foot(
    key: number,
    style: TelegraphStyle,
    x: number,
    z: number,
    radius: number,
    fill: number,
    moving: boolean,
  ): void {
    let s = this.slotByKey.get(key);
    let fresh = false;
    if (!s) {
      s = this.slots.find((q) => q.key === 0);
      if (!s) return;
      s.key = key;
      this.slotByKey.set(key, s);
      fresh = true;
    }
    s.seen = true;
    if (s.style !== style) {
      this.kit.layOutFan(s.fan, 360, style);
      s.style = style;
    }
    if (fresh || moving) {
      const y = this.groundY(x, z);
      this.kit.drapeFan(s.fan, this.groundY, x, y, z, 0, radius);
    }
    this.kit.paintFan(s.fan, { fill, clock: this.clock, range: radius });
    s.fan.group.visible = true;
  }

  private paintObjects(world: IWorld): void {
    let whirl = 0;
    let orb = 0;
    let anvilShown = false;
    let wind: Entity | null = null;
    for (const id of this.objectIds) {
      const e = world.entities.get(id);
      const info = this.seen.get(id);
      if (!e || !info) continue;
      const kind = finalObjectKind(e.templateId) ?? info.kind;
      const age = this.clock - info.born;
      const r = e.scale || 1;
      const x = e.pos.x;
      const z = e.pos.z;
      const y = this.groundY(x, z);
      switch (kind) {
        case 'whirlWarn':
        case 'whirl': {
          const warn = kind === 'whirlWarn' ? timedFill(age, T.whirlWarn) : 1;
          this.foot(id, FINAL_FOOTPRINTS.whirl, x, z, R.whirl, warn, true);
          const m = this.whirls[whirl++];
          if (m) {
            const spin = whirlSpin(this.clock, warn);
            m.position.set(x, y, z);
            m.rotation.y = spin.angle;
            m.scale.set(R.whirl * 0.9, spin.height, R.whirl * 0.9);
            m.visible = true;
          }
          if (kind === 'whirl' && this.rand() < 0.8 * this.density)
            this.particles.puff(x, y + 1, z, 2, {
              speed: 3,
              up: 6,
              life: 0.9,
              size: [0.5, 0.1],
              color: C.fire,
              alpha: 1,
              pool: 'glow',
              radius: R.whirl * 0.6,
            });
          break;
        }
        case 'emberPool':
        case 'forgePool': {
          this.foot(id, FINAL_FOOTPRINTS.pool, x, z, r, 1, false);
          if (this.rand() < (kind === 'emberPool' ? 0.9 : 0.7) * this.density)
            this.particles.puff(x, y + 0.2, z, 2, {
              speed: 0.6,
              up: 2.8,
              life: 1.1,
              size: [1.0, 0.3],
              color: C.fire,
              alpha: 1,
              pool: 'pyre',
              radius: r * 0.85,
            });
          break;
        }
        case 'crack': {
          const fill = timedFill(age, finalObjectSeconds(e.templateId));
          this.foot(id, FINAL_FOOTPRINTS.crack, x, z, r, fill, false);
          if (this.rand() < 0.5 * this.density)
            this.particles.puff(x, y + 0.2, z, 1, {
              speed: 1,
              up: 1.5,
              life: 1.2,
              size: [0.8, 1.6],
              color: C.frost,
              alpha: 0.35,
              radius: r,
            });
          break;
        }
        case 'tremor': {
          const fill = timedFill(age, finalObjectSeconds(e.templateId));
          this.foot(id, FINAL_FOOTPRINTS.tremor, x, z, r, fill, false);
          if (this.rand() < fill * 0.7 * this.density)
            this.particles.puff(x, y + 0.2, z, 1, {
              speed: 1.2,
              up: 2,
              life: 0.8,
              size: [0.3, 0.2],
              color: C.stone,
              alpha: 1,
              radius: r,
              gravity: 9,
            });
          break;
        }
        case 'orb': {
          const life = finalObjectSeconds(e.templateId) || T.orbLife;
          const left = 1 - timedFill(age, life);
          this.foot(id, FINAL_FOOTPRINTS.orb, x, z, r + 0.5, 1 - left, false);
          const m = this.orbs[orb++];
          if (m) {
            const bob = orbBob(this.clock + id, left);
            m.position.set(x, y + bob.y, z);
            m.scale.setScalar(1.5 + 0.2 * Math.sin(this.clock * 9 + id));
            this.orbMat.uniforms.uCrackle.value = bob.crackle;
            m.visible = true;
          }
          break;
        }
        case 'anvil': {
          const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
          const total = finalObjectSeconds(e.templateId) || T.anvilCast;
          const fill =
            boss && boss.castingAbility === FINAL_CASTS.anvil
              ? telegraphFillOf(boss.castRemaining, boss.castTotal > 0 ? boss.castTotal : total)
              : timedFill(age, total);
          this.foot(id, FINAL_FOOTPRINTS.anvil, x, z, r, fill, true);
          const drop = anvilDrop(fill);
          this.anvil.position.set(x, y + drop.height, z);
          this.anvil.rotation.y = this.clock * 0.15;
          this.anvilGlow.opacity = 0.25 + 0.55 * drop.glow;
          this.anvil.visible = true;
          anvilShown = true;
          break;
        }
        case 'windWarn':
        case 'windBlow':
          wind = e;
          break;
        default:
      }
    }
    for (let i = whirl; i < this.whirls.length; i++) this.whirls[i].visible = false;
    for (let i = orb; i < this.orbs.length; i++) this.orbs[i].visible = false;
    if (!anvilShown) this.anvil.visible = false;
    this.paintWind(wind);
  }

  /** The gale: its rim band (every tier) and its streaks racing the way it
   *  blows. */
  private paintWind(wind: Entity | null): void {
    if (!wind) {
      this.rim.visible = false;
      return;
    }
    const blowing = finalObjectKind(wind.templateId) === 'windBlow';
    this.windHeading = wind.facing;
    const cx = this.originX + HEART_ROOM.x;
    const cz = this.originZ + HEART_ROOM.z;
    this.rim.position.set(cx, this.groundY(cx, cz) + 0.08, cz);
    this.rimMat.uniforms.uHeading.value = this.windHeading;
    this.rimMat.uniforms.uAlpha.value = blowing ? 1 : 0.35 + 0.25 * Math.sin(this.clock * 8);
    this.rim.visible = true;
    const n = blowing ? 6 : 1;
    const sx = Math.sin(this.windHeading);
    const sz = Math.cos(this.windHeading);
    for (let i = 0; i < n; i++) {
      if (this.rand() > this.density) continue;
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * HEART_ROOM.r;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.particles.puff(x, this.groundY(x, z) + 0.6 + this.rand() * 3, z, 1, {
        speed: blowing ? 20 : 4,
        life: 0.9,
        size: [0.25, 0.08],
        color: C.storm,
        alpha: 0.8,
        pool: 'glow',
        dir: [sx, 0, sz],
        spread: 0.05,
      });
      if (blowing && this.rand() < 0.5)
        this.particles.puff(x, this.groundY(x, z) + 0.3, z, 1, {
          speed: 9,
          life: 1.4,
          size: [1.2, 3],
          color: C.dust,
          alpha: 0.3,
          dir: [sx, 0.05, sz],
          spread: 0.15,
        });
    }
  }

  /** The players' marks: the ember's ring, the lightning's reach, the ice,
   *  the stone, Crushed. */
  private paintMarks(world: IWorld): void {
    let ice = 0;
    let shell = 0;
    for (const pid of this.playerIds) {
      const p = world.entities.get(pid);
      if (!p || p.dead) continue;
      const x = p.pos.x;
      const z = p.pos.z;
      const y = this.groundY(x, z);
      for (const a of p.auras) {
        if (a.id === FINAL_AURAS.ember) {
          const fill = a.duration > 0 ? 1 - a.remaining / a.duration : 1;
          this.foot(-(pid * 8 + 1), FINAL_FOOTPRINTS.ember, x, z, R.ember, fill, true);
          if (this.rand() < 0.5 * this.density)
            this.particles.puff(x, y + 2.2, z, 1, {
              speed: 1,
              up: 2,
              life: 0.6,
              size: [0.4, 0.1],
              color: C.fire,
              alpha: 1,
              pool: 'glow',
              radius: 0.5,
            });
        } else if (a.id === FINAL_AURAS.drawn) {
          this.foot(-(pid * 8 + 2), FINAL_FOOTPRINTS.drawn, x, z, R.drawn, 0, true);
          if (this.rand() < 0.6 * this.density) this.sparkAt(x, z, C.storm, 1, 0.6);
        } else if (a.id === FINAL_AURAS.frozen || a.id === FINAL_AURAS.underIce) {
          const m = this.ice[ice++];
          if (m) {
            m.position.set(x, y, z);
            m.rotation.y = fxHash(pid, 3) * Math.PI;
            m.visible = true;
          }
        } else if (a.id === FINAL_AURAS.shell) {
          const m = this.shells[shell++];
          if (m) {
            m.position.set(x, y, z);
            m.rotation.y = this.clock * 0.2 + pid;
            m.visible = true;
          }
        }
      }
    }
    for (let i = ice; i < this.ice.length; i++) this.ice[i].visible = false;
    for (let i = shell; i < this.shells.length; i++) this.shells[i].visible = false;
  }

  /** The boss: Leaping Bolt's target ring, Taking Root's spikes, Heart
   *  Unbound's blaze. */
  private paintBoss(world: IWorld): void {
    const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
    if (!boss || boss.dead) {
      this.spikes.visible = false;
      this.unboundRing.visible = false;
      return;
    }
    if (boss.castingAbility === FINAL_CASTS.bolt && boss.castTargetId !== null) {
      const t = world.entities.get(boss.castTargetId);
      if (t) {
        const fill = telegraphFillOf(
          boss.castRemaining,
          boss.castTotal > 0 ? boss.castTotal : T.boltCast,
        );
        this.foot(-(t.id * 8 + 3), FINAL_FOOTPRINTS.bolt, t.pos.x, t.pos.z, R.bolt, fill, true);
        if (this.rand() < 0.7 * this.density) this.sparkAt(t.pos.x, t.pos.z, C.storm, 1, 1);
      }
    }
    let root: Entity['auras'][number] | undefined;
    let unbound: Entity['auras'][number] | undefined;
    for (const a of boss.auras) {
      if (a.id === FINAL_AURAS.root) root = a;
      else if (a.id === FINAL_AURAS.unbound) unbound = a;
    }
    const x = boss.pos.x;
    const z = boss.pos.z;
    const y = this.groundY(x, z);
    const rise = root ? rootRise(root.remaining) : 0;
    this.spikes.visible = rise > 0.01;
    if (this.spikes.visible) {
      for (let i = 0; i < P.rootSpikes; i++) {
        const a = (i / P.rootSpikes) * Math.PI * 2 + fxHash(i, 9) * 0.4;
        const rr = 5.4 + fxHash(i, 4) * 1.2;
        const h = (2.2 + fxHash(i, 2) * 2.2) * rise;
        _v.set(x + Math.cos(a) * rr, y - 0.4, z + Math.sin(a) * rr);
        _v2.set(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize();
        _q.setFromUnitVectors(UP, _v2);
        _m.compose(_v, _q, _s.set(1, Math.max(0.01, h), 1));
        this.spikes.setMatrixAt(i, _m);
      }
      this.spikes.instanceMatrix.needsUpdate = true;
      if (rise > 0.9 && this.rand() < 0.3 * this.density) this.dustAt(x, z, 1, 6);
    }
    const stacks = unbound?.stacks ?? 0;
    this.unboundRing.visible = stacks > 0;
    if (stacks > 0) {
      const k = Math.min(1, stacks / 10);
      this.unboundRing.position.set(x, y + 0.1, z);
      this.unboundRing.scale.setScalar(1 + 0.6 * k + 0.08 * Math.sin(this.clock * 10));
      this.unboundMat.opacity = 0.35 + 0.5 * k;
      if (this.rand() < (0.4 + k) * this.density) this.sparkAt(x, z, [1, 0.8, 0.45], 2, 7);
    }
  }

  private paintArcs(world: IWorld): void {
    let n = 0;
    for (const a of this.arcs) {
      const age = this.clock - a.born;
      if (age > 0.35) continue;
      const s = world.entities.get(a.from);
      const t = world.entities.get(a.to);
      if (!s || !t) continue;
      const sy = this.groundY(s.pos.x, s.pos.z) + (s.templateId === FINAL_BOSS ? 12 : 1.4);
      const ty = this.groundY(t.pos.x, t.pos.z) + 1.4;
      let px = s.pos.x;
      let py = sy;
      let pz = s.pos.z;
      const w = 0.09 * (1 - age / 0.35) + 0.03;
      for (let k = 1; k <= P.arcSegments; k++) {
        const f = k / P.arcSegments;
        const j = k === P.arcSegments ? 0 : 1.2;
        const nx =
          s.pos.x + (t.pos.x - s.pos.x) * f + (fxHash(a.seed + k, this.clock * 30) - 0.5) * j;
        const ny = sy + (ty - sy) * f + (fxHash(a.seed + k, 7) - 0.5) * j;
        const nz =
          s.pos.z + (t.pos.z - s.pos.z) * f + (fxHash(a.seed + k, this.clock * 31) - 0.5) * j;
        _v.set(nx - px, ny - py, nz - pz);
        const len = _v.length();
        _v.normalize();
        _q.setFromUnitVectors(UP, _v);
        _m.compose(_v2.set(px, py, pz), _q, _s.set(w, len, w));
        this.arcsMesh.setMatrixAt(n++, _m);
        px = nx;
        py = ny;
        pz = nz;
      }
    }
    for (let i = n; i < P.arcs * P.arcSegments; i++)
      this.arcsMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.arcsMesh.instanceMatrix.needsUpdate = true;
    this.arcsMesh.visible = n > 0;
  }

  private leave(): void {
    this.active = false;
    this.rosterSeen = Number.NaN;
    for (const s of this.slots) {
      s.key = 0;
      s.fan.group.visible = false;
    }
    this.slotByKey.clear();
    this.seen.clear();
    for (const m of [...this.whirls, ...this.orbs, ...this.ice, ...this.shells]) m.visible = false;
    this.anvil.visible = false;
    this.rim.visible = false;
    this.spikes.visible = false;
    this.unboundRing.visible = false;
    this.arcsMesh.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    this.arcsMesh.dispose();
    this.spikes.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
