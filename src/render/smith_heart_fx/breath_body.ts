// The Guardian of the Breath's provisional body (plan: breath_body_core.ts),
// hosted by ../rift_death_zone.ts beside the raid's other fx. The guardian is
// a bodyless target (characters/manifest.ts smith_heart_breath_guardian): its
// click capsule, nameplate and bars come from the ordinary entity view, and
// this module draws the body over it, read from IWorld (its position, facing,
// cast bar, swings, auras and death, and the wind object's phase and bearing),
// so offline and online look the same:
//  - the body: a living bellows of the Breath kit's storm granite and the
//    Heart kit's rock and crystal, stitched by threads of the vein's teal
//    light: a barrel chest between two bellows plates, a wind-horn mouth,
//    fluted wind-blade wings, crystal spines, heavy arms ending in
//    wind-carved claws, and below the waist a whirl of loose stones turning
//    in its own wind;
//  - the motion: its slow breath (the bellows swelling and falling in), a
//    swipe at the tank on each melee hit; as a blow gathers it turns its
//    mouth to the wind's bearing and draws breath, then exhales the whole
//    blow through the horn (the bellows emptying, wind pouring off its
//    lips); the indrawn breath swells it past full, head flung back, its
//    heart blazing; the exhale's bar hunches it and throws it wide; a cast
//    raises one arm to the storm and thrusts the other at its mark;
//  - the storm breaking (its 4 s bar): it draws the wind in, freezes and
//    trembles with light tearing through every seam, and tears open: every
//    stone flies out into rings of shards turning round a core of living
//    lightning (a storm figure, two lightning wings, a white crystal heart,
//    arcs leaping from the core to the shards) for the rest of the fight;
//  - the death: the threads (or the core) flare and go out, every piece
//    falls and tumbles to the floor round where it stood.
// Presentation only: the fight's telegraphs are breath_fight_fx.ts's and
// breath_fx.ts's, on every tier; the motes, sparks, dust and shakes here thin
// on the low tier and under reduced motion; the body, its poses and its
// storm form never do (which form it wears is actionable: phase 2).
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the kits' pieces, which land
// later, draw with the kits' own shared slot materials linked by their
// program warmers, and this module's glows each have a hidden carrier); no
// light; fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  BREATH_CUES,
  BREATH_OBJECTS,
  type BreathWindPhase,
  breathWindOf,
} from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { wrapAngle } from '../facing_smooth';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitMeshes,
  heartKitProgramWarmers,
  heartKitSlotMaterial,
} from '../smith_heart/heart_kit';
import { heartVeinGlowMaterial } from '../smith_heart/heart_room_kit';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  BREATH_BODY_COLORS,
  BREATH_BODY_KITS,
  BREATH_BODY_PIECES,
  BREATH_BODY_POOLS,
  BREATH_EMBER_JOINTS,
  BREATH_FALL,
  BREATH_GUARDIAN,
  BREATH_RIG_JOINTS,
  BREATH_SLOTS,
  BREATH_SWING_SECONDS,
  BREATH_THREAD_PAIRS,
  type BreathArmJoints,
  type BreathBodyAction,
  type BreathBodyActionState,
  type BreathBodyInput,
  type BreathBodyLook,
  type BreathBodyPiece,
  breathArm,
  breathBodyAction,
  breathBodyHash,
  breathBodyLook,
  breathFacesWind,
  breathFallProgress,
  breathFallRest,
  breathWristTarget,
  STORM_CORE,
  stormFormOn,
  stormShardSlot,
  stormTearProgress,
  type V3,
  whirlSlot,
} from './breath_body_core';
import { inSmithHeartClaim } from './council_fx_core';

const SCAN_SEC = 0.1;
const ARC_POINTS = 9;
/** The joints that lift with the head (the head, the mouth). */
const HEAD_JOINTS = [3, 10] as const;
/** A thread colour change smaller than this is not re-uploaded. */
const THREAD_COLOR_EPS = 1 / 512;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _slot: V3 = { x: 0, y: 0, z: 0 };
const _wrist: V3 = { x: 0, y: 0, z: 0 };
const _arm: BreathArmJoints = { elbow: { x: 0, y: 0, z: 0 }, wrist: { x: 0, y: 0, z: 0 } };
const _act: BreathBodyActionState = { action: 'idle', k: 0 };
const _actIn: BreathBodyInput = {
  castId: null,
  castFill: 0,
  windPhase: null,
  windFill: 0,
  stormForm: false,
};
const _fall = { k: 0, landed: false };
const _look: BreathBodyLook = {
  swell: 0,
  lift: 0,
  lean: 0,
  spread: 0,
  mouth: 0,
  glow: 0,
  jitter: 0,
  tear: 0,
};

/** The storm core's skin: living lightning, bands racing up it, an edge of
 *  teal light (additive). */
const CORE_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vP = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uEdge;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
float h(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h(i), h(i + vec3(1, 0, 0)), f.x), mix(h(i + vec3(0, 1, 0)), h(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h(i + vec3(0, 0, 1)), h(i + vec3(1, 0, 1)), f.x), mix(h(i + vec3(0, 1, 1)), h(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  vec3 q = vP * 2.6 + vec3(0.0, -uTime * 3.4, 0.0);
  float vein = 1.0 - abs(n(q) * 2.0 - 1.0);
  vein = pow(vein, 7.0);
  float flick = 0.75 + 0.25 * sin(uTime * 31.0 + vP.y * 3.0);
  vec3 col = mix(uEdge, uCore, clamp(vein * 1.4 + fres * 0.3, 0.0, 1.0));
  float a = uAlpha * clamp(0.18 + fres * 0.9 + vein * 1.1, 0.0, 1.0) * flick;
  gl_FragColor = vec4(col * (1.0 + vein * 1.5), a);
  #include <colorspace_fragment>
}
`;
/** A lightning wing: forked veins of light across a membrane of storm. */
const WING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const WING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uEdge;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  // vUv.x 0 at the root, 1 at the tip; vUv.y 0 at the bottom edge.
  float span = vUv.x;
  float shape = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.55 + 0.45 * (1.0 - span), 1.0, vUv.y));
  shape *= 1.0 - smoothstep(0.82, 1.0, span);
  vec2 p = vec2(span * 6.0, vUv.y * 4.0 + span * 1.5);
  float t = uTime * 1.7;
  float r1 = 1.0 - abs(n(p + vec2(-t, t * 0.3)) * 2.0 - 1.0);
  float r2 = 1.0 - abs(n(p * 2.3 + vec2(t * 0.7, -t)) * 2.0 - 1.0);
  float vein = pow(r1, 9.0) + pow(r2, 12.0) * 0.6;
  float flick = 0.7 + 0.3 * sin(uTime * 23.0 + span * 9.0);
  float membrane = 0.12 * (1.0 - span) + 0.06;
  float a = uAlpha * shape * clamp(membrane + vein * 1.6, 0.0, 1.0) * flick;
  gl_FragColor = vec4(mix(uEdge, uCore, clamp(vein, 0.0, 1.0)) * (1.0 + vein), a);
  #include <colorspace_fragment>
}
`;
/** An arc: a crossed ribbon, bright core, soft edge. */
const ARC_VERT = /* glsl */ `
attribute float aEdge;
varying float vEdge;
void main() {
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const ARC_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uEdge;
varying float vEdge;
void main() {
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.0, 0.35, e);
  float glow = 1.0 - smoothstep(0.2, 1.0, e);
  gl_FragColor = vec4(mix(uEdge, uCore, core) * (0.8 + core * 1.6) * uAlpha, glow * uAlpha);
  #include <colorspace_fragment>
}
`;

interface PieceView {
  def: BreathBodyPiece;
  index: number;
  /** A whirl stone's slot (read once from its id). */
  orbit: number;
  holder: THREE.Group;
  /** The plain stone it wears until (or, a kit that never lands, instead of)
   *  its kit piece. */
  standIn: THREE.Mesh | null;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  diedPos: THREE.Vector3;
  diedQuat: THREE.Quaternion;
  rest: { at: V3; tilt: THREE.Quaternion; delay: number } | null;
  landed: boolean;
}

export class BreathBody {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly group = new THREE.Group();
  private readonly core = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly pieces: PieceView[] = [];
  private readonly threads: THREE.InstancedMesh;
  private readonly seamMat: THREE.ShaderMaterial;
  private readonly crystalMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly emberMat: THREE.SpriteMaterial;
  private readonly embers: THREE.Sprite[] = [];
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly wingMat: THREE.ShaderMaterial;
  private readonly arcMat: THREE.ShaderMaterial;
  private readonly arcGeo: THREE.BufferGeometry;
  private readonly heartGlow: THREE.Sprite;
  private readonly heartGlowMat: THREE.SpriteMaterial;
  private readonly joints: THREE.Vector3[] = [];
  private readonly glowColor = new THREE.Color();
  private readonly stormColor = new THREE.Color(BREATH_BODY_COLORS.core);
  private readonly threadColor = new THREE.Color();
  /** The thread colour last uploaded (NaN: never). */
  private readonly threadShown = new THREE.Color(Number.NaN, Number.NaN, Number.NaN);
  /** The wind as last read (rewritten in place each frame). */
  private readonly windNow: { phase: BreathWindPhase | null; bearing: number; fill: number } = {
    phase: null,
    bearing: 0,
    fill: 0,
  };
  private readonly standInGeo: THREE.BufferGeometry;
  private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  private readonly glowTex: THREE.Texture | null;
  private kitBuilt = false;
  /** The roster version the last discovery walk saw (NaN: walk next scan). */
  private rosterSeen = Number.NaN;
  private entityId = -1;
  private windId = -1;
  private windTemplate = '';
  private windSince = 0;
  private yaw = 0;
  private swingAt = -99;
  private swingSide: -1 | 1 = 1;
  private stormSince = -1;
  private stormFrom = 0.25;
  private sawBreak = false;
  private deadAt = -1;
  private seenAlive = false;
  private arcTimer = 0;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x3b1d;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.compileGate = compileGate;
    this.root.name = 'smith-heart-breath-body';
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
    // One hidden carrier triangle every glow material is drawn on, so the
    // compile gate links their programs before any kit piece lands.
    const carrierGeo = new THREE.BufferGeometry();
    carrierGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrierGeo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    carrierGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    carrierGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    carrierGeo.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(3), 1));
    this.geometries.push(carrierGeo);
    // The stand-in stone every piece wears until its kit lands (or, a kit
    // that never lands, for good): a unit rock in the body's storm slate.
    const standIn = new THREE.IcosahedronGeometry(0.5, 1);
    const g = BREATH_BODY_COLORS.granite;
    const n = standIn.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const shade = 0.8 + 0.4 * breathBodyHash(i, 7);
      col[i * 3] = g[0] * shade;
      col[i * 3 + 1] = g[1] * shade;
      col[i * 3 + 2] = g[2] * shade;
    }
    standIn.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.standInGeo = standIn;
    this.geometries.push(standIn);
    this.seamMat = heartVeinGlowMaterial(BREATH_BODY_COLORS.thread, 'smithHeartBreathSeams');
    this.crystalMat = heartVeinGlowMaterial(BREATH_BODY_COLORS.glow, 'smithHeartBreathCrystal');
    const glowTex = hasDom ? radialGlowTexture() : null;
    this.glowTex = glowTex;
    const sprite = (color: number, opacity: number, name: string) =>
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name,
      });
    this.haloMat = sprite(BREATH_BODY_COLORS.glow, 0.45, 'smithHeartBreathHalo');
    this.emberMat = sprite(BREATH_BODY_COLORS.thread, 0.6, 'smithHeartBreathEmber');
    this.heartGlowMat = sprite(BREATH_BODY_COLORS.core, 0, 'smithHeartBreathHeart');
    const threadMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartBreathThreads',
    });
    this.coreMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathStormCore',
      uniforms: {
        uTime: this.uTime,
        uAlpha: { value: 0 },
        uCore: { value: new THREE.Color(BREATH_BODY_COLORS.core) },
        uEdge: { value: new THREE.Color(BREATH_BODY_COLORS.coreEdge) },
      },
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.wingMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathStormWing',
      uniforms: {
        uTime: this.uTime,
        uAlpha: { value: 0 },
        uCore: { value: new THREE.Color(BREATH_BODY_COLORS.core) },
        uEdge: { value: new THREE.Color(BREATH_BODY_COLORS.coreEdge) },
      },
      vertexShader: WING_VERT,
      fragmentShader: WING_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.arcMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathStormArc',
      uniforms: {
        uAlpha: { value: 0 },
        uCore: { value: new THREE.Color(BREATH_BODY_COLORS.core) },
        uEdge: { value: new THREE.Color(BREATH_BODY_COLORS.coreEdge) },
      },
      vertexShader: ARC_VERT,
      fragmentShader: ARC_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(
      this.seamMat,
      this.crystalMat,
      this.haloMat,
      this.emberMat,
      this.heartGlowMat,
      threadMat,
      this.coreMat,
      this.wingMat,
      this.arcMat,
    );
    for (const m of [this.seamMat, this.crystalMat, this.coreMat, this.wingMat, this.arcMat]) {
      const carrier = new THREE.Mesh(carrierGeo, m);
      carrier.visible = false;
      carrier.frustumCulled = false;
      carrier.name = 'smithHeartBreathCarrier';
      this.root.add(carrier);
    }
    for (const m of [this.haloMat, this.heartGlowMat]) {
      const c = new THREE.Sprite(m);
      c.visible = false;
      c.name = 'smithHeartBreathCarrier';
      this.root.add(c);
    }
    this.group.name = 'smithHeartBreathBody';
    this.group.visible = false;
    this.root.add(this.group);
    // The threads of the vein's light between the joints.
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.geometries.push(threadGeo);
    this.threads = new THREE.InstancedMesh(threadGeo, threadMat, BREATH_BODY_POOLS.threads);
    this.threads.name = 'smithHeartBreathThreads';
    this.threads.frustumCulled = false;
    this.threads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < BREATH_BODY_POOLS.threads; k++) {
      this.threads.setMatrixAt(k, _m.makeScale(0, 0, 0));
      this.threads.setColorAt(k, this.threadColor.setHex(BREATH_BODY_COLORS.thread));
    }
    this.group.add(this.threads);
    for (let k = 0; k < BREATH_RIG_JOINTS; k++) this.joints.push(new THREE.Vector3());
    const emberSize = 0.95;
    for (let k = 0; k < BREATH_EMBER_JOINTS.length; k++) {
      const s = new THREE.Sprite(this.emberMat);
      s.scale.set(emberSize, emberSize, 1);
      s.name = 'smithHeartBreathEmber';
      this.embers.push(s);
      this.group.add(s);
    }
    // The storm core (phase 2): the figure, its wings, its heart, its arcs.
    this.core.name = 'smithHeartBreathStormCore';
    this.core.visible = false;
    this.group.add(this.core);
    const torsoGeo = new THREE.IcosahedronGeometry(1, 3);
    const headGeo = new THREE.IcosahedronGeometry(1, 2);
    this.geometries.push(torsoGeo, headGeo);
    const C = STORM_CORE;
    const torso = new THREE.Mesh(torsoGeo, this.coreMat);
    torso.position.set(0, C.torso.y, 0);
    torso.scale.set(C.torso.rx, C.torso.ry, C.torso.rz);
    const head = new THREE.Mesh(headGeo, this.coreMat);
    head.position.set(0, C.head.y, 0.25);
    head.scale.setScalar(C.head.r);
    // A tapering tail of storm under it (where the whirl was).
    const tailGeo = new THREE.ConeGeometry(0.9, 2.6, 18, 4, true);
    tailGeo.rotateX(Math.PI);
    this.geometries.push(tailGeo);
    const tail = new THREE.Mesh(tailGeo, this.coreMat);
    tail.position.set(0, 1.4, 0);
    for (const m of [torso, head, tail]) {
      m.frustumCulled = false;
      m.name = 'smithHeartBreathStormFigure';
      this.core.add(m);
    }
    for (const side of [1, -1]) {
      const wingGeo = new THREE.PlaneGeometry(C.wingSpan / 2, C.wingHeight, 1, 1);
      // Root at local x 0, the span out along +x (mirrored for the right).
      wingGeo.translate(C.wingSpan / 4, 0, 0);
      this.geometries.push(wingGeo);
      const wing = new THREE.Mesh(wingGeo, this.wingMat);
      wing.position.set(side * 0.6, C.wingY, -0.7);
      wing.scale.x = side;
      wing.rotation.set(0, side * 0.45, side * 0.18);
      wing.frustumCulled = false;
      wing.name = 'smithHeartBreathStormWing';
      this.core.add(wing);
    }
    this.heartGlow = new THREE.Sprite(this.heartGlowMat);
    this.heartGlow.position.set(0, C.heart.y, 0.5);
    this.heartGlow.scale.set(3.2, 3.2, 1);
    this.core.add(this.heartGlow);
    // The arcs: crossed ribbons of ARC_POINTS each, rewritten in place.
    const arcs = C.arcs;
    const verts = arcs * 2 * ARC_POINTS * 2;
    this.arcGeo = new THREE.BufferGeometry();
    this.arcGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage),
    );
    const edge = new Float32Array(verts);
    for (let i = 0; i < verts; i++) edge[i] = i % 2 === 0 ? -1 : 1;
    this.arcGeo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
    const idx: number[] = [];
    for (let a = 0; a < arcs * 2; a++) {
      const base = a * ARC_POINTS * 2;
      for (let i = 0; i < ARC_POINTS - 1; i++) {
        const k = base + i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    this.arcGeo.setIndex(idx);
    this.geometries.push(this.arcGeo);
    const arcMesh = new THREE.Mesh(this.arcGeo, this.arcMat);
    arcMesh.frustumCulled = false;
    arcMesh.name = 'smithHeartBreathStormArcs';
    this.core.add(arcMesh);
    this.root.add(heartKitProgramWarmers());
    // Every piece is built here, under the root's own gate: its kit piece
    // when the kits are in, else its stand-in stone (swapped for the kit
    // through one gated unit when it lands: upgradeKit).
    const kitsIn = this.kitsLoaded();
    this.buildPieces(kitsIn);
    this.kitBuilt = kitsIn;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (!kitsIn && hasDom)
      void Promise.all([
        ensureHeartKit(BREATH_BODY_KITS.breath),
        ensureHeartKit(BREATH_BODY_KITS.heart),
      ])
        .then(() => {
          if (!this.disposed && this.kitsLoaded()) this.upgradeKit();
        })
        .catch(() => {});
  }

  private kitsLoaded(): boolean {
    return heartKitLoaded(BREATH_BODY_KITS.breath) && heartKitLoaded(BREATH_BODY_KITS.heart);
  }

  /** Every piece's holder, wearing its kit piece (`withKit`) or its
   *  stand-in stone. */
  private buildPieces(withKit: boolean): void {
    BREATH_BODY_PIECES.forEach((def, index) => {
      const holder = new THREE.Group();
      holder.name = `breathBody:${def.id}`;
      const kit = withKit ? this.fitKit(def) : null;
      let standIn: THREE.Mesh | null = null;
      if (kit) holder.add(kit);
      else {
        standIn = new THREE.Mesh(
          this.standInGeo,
          def.light === 'crystal' ? this.crystalMat : heartKitSlotMaterial('stone'),
        );
        standIn.name = 'smithHeartBreathStandIn';
        standIn.scale.set(def.size.x, def.size.y, def.size.z);
        standIn.rotation.set(def.tilt.x, def.tilt.y, def.tilt.z);
        standIn.castShadow = def.light !== 'crystal' && def.joint !== 'whirl';
        standIn.receiveShadow = def.light !== 'crystal';
        holder.add(standIn);
      }
      this.group.add(holder);
      this.pieces.push({
        def,
        index,
        orbit: Number(def.id.replace(/\D+/g, '')) || 0,
        holder,
        standIn,
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        diedPos: new THREE.Vector3(),
        diedQuat: new THREE.Quaternion(),
        rest: null,
        landed: false,
      });
    });
  }

  /** One piece's kit shape fitted to its box (centred on its holder), with
   *  its crystal halo; null when the kit has no such node. */
  private fitKit(def: BreathBodyPiece): THREE.Group | null {
    const kit = heartKitMeshes(BREATH_BODY_KITS[def.kit], def.node);
    if (!kit) return null;
    for (const m of kit.children) {
      if (!(m instanceof THREE.Mesh)) continue;
      if (def.light === 'crystal') {
        // Light, not rock: it neither casts nor takes a shadow.
        m.material = this.crystalMat;
        m.castShadow = false;
        m.receiveShadow = false;
      } else if (m.name.endsWith(':glow')) m.material = this.seamMat;
      else if (m.name.endsWith(':stone')) m.geometry = this.stormStone(m.geometry);
      if (def.joint === 'whirl') m.castShadow = false;
    }
    _box.setFromObject(kit);
    _box.getSize(_size);
    _box.getCenter(_centre);
    const sx = def.size.x / Math.max(1e-3, _size.x);
    const sy = def.size.y / Math.max(1e-3, _size.y);
    const sz = def.size.z / Math.max(1e-3, _size.z);
    kit.scale.set(sx, sy, sz);
    kit.position.set(-_centre.x * sx, -_centre.y * sy, -_centre.z * sz);
    const content = new THREE.Group();
    content.name = 'smithHeartBreathKitPiece';
    const tilt = new THREE.Group();
    tilt.rotation.set(def.tilt.x, def.tilt.y, def.tilt.z);
    tilt.add(kit);
    if (def.side < 0) tilt.scale.x = -1;
    content.add(tilt);
    if (def.light === 'crystal' && def.joint !== 'whirl') {
      const halo = new THREE.Sprite(this.haloMat);
      const s = Math.max(def.size.x, def.size.y, def.size.z) * 1.6;
      halo.scale.set(s, s, 1);
      halo.name = 'smithHeartBreathCrystalHalo';
      content.add(halo);
    }
    return content;
  }

  /** The kits landed after the body was built: fit every piece's kit shape
   *  into one hidden staging group, link it through the compile gate (one
   *  budgeted unit on the GPU queue, never a live frame), then swap each
   *  stand-in for its kit piece. */
  private upgradeKit(): void {
    if (this.kitBuilt || this.disposed) return;
    this.kitBuilt = true;
    const staging = new THREE.Group();
    staging.name = 'smithHeartBreathKitStaging';
    staging.visible = false;
    const fitted: (THREE.Group | null)[] = [];
    for (const p of this.pieces) {
      const kit = this.fitKit(p.def);
      fitted.push(kit);
      if (kit) staging.add(kit);
    }
    this.root.add(staging);
    const linked = this.compileGate ? this.compileGate(staging).catch(() => {}) : Promise.resolve();
    void linked.then(() => {
      staging.removeFromParent();
      if (this.disposed) return;
      for (let i = 0; i < this.pieces.length; i++) {
        const p = this.pieces[i];
        const kit = fitted[i];
        if (!kit) continue;
        if (p.standIn) {
          p.holder.remove(p.standIn);
          p.standIn = null;
        }
        p.holder.add(kit);
      }
    });
  }

  /** The kit's pale granite repainted the body's darker storm slate (it
   *  must read against the scoured Cornice it fights on), a third of its own
   *  value variation kept. */
  private stormStone(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = src.clone();
    const col = g.getAttribute('color');
    if (col) {
      const c = BREATH_BODY_COLORS.granite;
      for (let i = 0; i < col.count; i++) {
        const shade = 0.5 + 0.6 * Math.min(1, col.getX(i) * 1.4);
        col.setXYZ(i, c[0] * shade, c[1] * shade, c[2] * shade);
      }
      col.needsUpdate = true;
    }
    this.geometries.push(g);
    return g;
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
    if (!this.world || this.disposed || this.entityId < 0) return false;
    if (ev.type === 'damage' && ev.ability === null && ev.sourceId === this.entityId) {
      this.swingAt = this.clock;
      this.swingSide = this.swingSide === 1 ? -1 : 1;
    } else if (ev.type === 'spellfx' && ev.ability === BREATH_CUES.tear) {
      const e = this.world.entities.get(this.entityId);
      if (e) this.tearBurst(e);
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
      this.scan(world);
    }
    if (this.entityId >= 0) {
      const e = world.entities.get(this.entityId);
      if (!e) this.release();
      else this.pose(e, dt);
    }
    this.particles.update(this.clock);
  }

  // ---- the scan ----------------------------------------------------------------------------

  private scan(world: IWorld): void {
    if (this.entityId >= 0 && !world.entities.has(this.entityId)) this.release();
    if (this.windId >= 0 && !world.entities.has(this.windId)) this.windId = -1;
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.entityId >= 0) this.release();
      this.rosterSeen = Number.NaN;
      return;
    }
    if (this.entityId >= 0 && this.windId >= 0) return;
    // The discovery walk runs on a roster change only (an entity added or
    // dropped), never on the scan's clock.
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (this.entityId < 0 && e.kind === 'mob' && e.templateId === BREATH_GUARDIAN) {
        this.entityId = e.id;
        this.yaw = e.facing;
        this.deadAt = -1;
        this.seenAlive = false;
        this.swingAt = -99;
        this.stormSince = -1;
        this.sawBreak = false;
        this.group.visible = true;
      } else if (
        this.windId < 0 &&
        e.kind === 'object' &&
        e.templateId.startsWith(BREATH_OBJECTS.windPrefix)
      ) {
        this.windId = e.id;
      }
    }
  }

  private release(): void {
    this.entityId = -1;
    this.rosterSeen = Number.NaN;
    this.group.visible = false;
    this.core.visible = false;
  }

  /** The wind object's phase, bearing and fill (its template is watched for
   *  changes: a new phase restarts the fill). */
  private wind(): { phase: BreathWindPhase | null; bearing: number; fill: number } {
    const out = this.windNow;
    out.phase = null;
    out.bearing = 0;
    out.fill = 0;
    const w = this.windId >= 0 ? this.world?.entities.get(this.windId) : undefined;
    if (!w) return out;
    if (w.templateId !== this.windTemplate) {
      this.windTemplate = w.templateId;
      this.windSince = this.clock;
    }
    const of = breathWindOf(w.templateId);
    if (!of) return out;
    out.phase = of.phase;
    out.bearing = (of.bearingDeg * Math.PI) / 180;
    out.fill = of.seconds > 0 ? Math.min(1, (this.clock - this.windSince) / of.seconds) : 0;
    return out;
  }

  // ---- the pose ------------------------------------------------------------------------------

  private pose(e: Entity, dt: number): void {
    this.group.position.set(e.pos.x, e.pos.y, e.pos.z);
    if (e.dead) {
      this.poseDead(e);
      return;
    }
    if (this.deadAt >= 0) {
      // Stood up again (a wipe): whole at once.
      this.deadAt = -1;
      this.stormSince = -1;
      for (const p of this.pieces) {
        p.rest = null;
        p.landed = false;
      }
    }
    this.seenAlive = true;
    const storm = stormFormOn(e.auras);
    if (storm && this.stormSince < 0) {
      this.stormSince = this.clock;
      // Seen tearing open: on from where the bar left it; first seen already
      // in the storm (arriving late, a reconnect): torn whole at once.
      this.stormFrom = this.sawBreak ? Math.max(0.25, this.stormFrom) : 1;
    } else if (!storm) {
      this.stormSince = -1;
      this.stormFrom = 0.25;
    }
    const wind = this.wind();
    const fill = e.castTotal > 0 ? Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal)) : 1;
    _actIn.castId = e.castingAbility;
    _actIn.castFill = fill;
    _actIn.windPhase = wind.phase;
    _actIn.windFill = wind.fill;
    _actIn.stormForm = storm;
    breathBodyAction(_actIn, _act);
    let action = _act.action;
    let k = _act.k;
    if (
      (action === 'idle' || action === 'storm' || action === 'calm') &&
      this.clock - this.swingAt < BREATH_SWING_SECONDS
    ) {
      action = storm ? 'storm' : 'swing';
      k = (this.clock - this.swingAt) / BREATH_SWING_SECONDS;
    }
    const t = this.clock;
    const look = breathBodyLook(action, k, t, _look);
    if (storm) {
      look.tear = stormTearProgress(this.clock - this.stormSince, this.stormFrom);
      if (action === 'cast' || action === 'blow' || action === 'gather') look.glow += 0.6;
    } else if (action === 'break') {
      this.sawBreak = true;
      this.stormFrom = Math.max(0.05, look.tear);
    }
    // The yaw: the mouth turned to the wind while it gathers and blows, else
    // the entity's own facing (its tank).
    const want = breathFacesWind(action) && wind.phase !== null ? wind.bearing : e.facing;
    this.yaw += wrapAngle(want - this.yaw) * Math.min(1, dt * (breathFacesWind(action) ? 2.2 : 5));
    this.group.rotation.y = this.yaw;
    this.poseJoints(action, k, look);
    for (const p of this.pieces) this.posePiece(p, look, t);
    this.poseThreads(look.tear < 0.5 ? 1 - look.tear * 2 : 0, look);
    for (let i = 0; i < BREATH_EMBER_JOINTS.length; i++) {
      this.embers[i].visible = look.tear < 0.6;
      this.embers[i].position.copy(this.joints[BREATH_EMBER_JOINTS[i]]);
    }
    this.poseCore(look, dt);
    this.glow(look, storm);
    this.cosmetics(e, action, k, look, dt);
  }

  /** The joints (body frame) for this frame's look. */
  private poseJoints(action: BreathBodyAction, k: number, look: BreathBodyLook): void {
    const J = this.joints;
    const S = BREATH_SLOTS;
    const bob = 0.12 * Math.sin(this.clock * 1.2);
    J[0].set(S.whirl.x, S.whirl.y + bob * 0.5, S.whirl.z);
    J[1].set(S.waist.x, S.waist.y + bob, S.waist.z);
    J[2].set(S.chest.x, S.chest.y + bob + 0.1 * (look.swell - 0.5), S.chest.z);
    J[3].set(S.head.x, S.head.y + bob, S.head.z);
    J[4].set(S.shoulder.x + 0.15 * (look.swell - 0.5), S.shoulder.y + bob, S.shoulder.z);
    J[5].set(-J[4].x, J[4].y, J[4].z);
    J[10].set(S.mouth.x, S.mouth.y + bob, S.mouth.z);
    J[11].set(S.spine.x, S.spine.y + bob, S.spine.z);
    for (let i = 0; i < 2; i++) {
      const side: -1 | 1 = i === 0 ? 1 : -1;
      const target = breathWristTarget(action, side, k, this.swingSide, _wrist);
      const arm = breathArm(side, target, _arm);
      J[6 + i].set(arm.elbow.x, arm.elbow.y + bob, arm.elbow.z);
      J[8 + i].set(arm.wrist.x, arm.wrist.y + bob, arm.wrist.z);
    }
    // The head lifts about the neck; the upper body leans about the waist.
    const neckY = J[2].y + 1.1;
    _q.setFromAxisAngle(_x, -look.lift);
    for (let h = 0; h < HEAD_JOINTS.length; h++) {
      const i = HEAD_JOINTS[h];
      _a.set(J[i].x, J[i].y - neckY, J[i].z).applyQuaternion(_q);
      J[i].set(_a.x, _a.y + neckY, _a.z);
    }
    const hipY = J[1].y;
    const cl = Math.cos(look.lean);
    const sl = Math.sin(look.lean);
    for (let i = 2; i < BREATH_RIG_JOINTS; i++) {
      const y = J[i].y - hipY;
      const z = J[i].z;
      J[i].y = hipY + y * cl - z * sl;
      J[i].z = y * sl + z * cl;
    }
  }

  /** One piece on its joint, or (torn) out on its orbit round the core. */
  private posePiece(p: PieceView, look: BreathBodyLook, t: number): void {
    const def = p.def;
    const J = this.joints;
    const side = def.side;
    const mx = side < 0 ? -1 : 1;
    const jit = look.jitter * 0.09;
    _q2.setFromAxisAngle(_x, look.lean);
    switch (def.joint) {
      case 'upper':
      case 'fore':
      case 'hand': {
        const i = side < 0 ? 1 : 0;
        const root = J[4 + i];
        const elbow = J[6 + i];
        const wrist = J[8 + i];
        if (def.joint === 'hand') {
          _a.subVectors(wrist, elbow).normalize();
          p.pos.copy(wrist).addScaledVector(_a, def.size.y * 0.42);
          p.quat.setFromUnitVectors(_up, _a);
        } else {
          const from = def.joint === 'upper' ? root : elbow;
          const to = def.joint === 'upper' ? elbow : wrist;
          _a.subVectors(to, from);
          const len = _a.length() || 1;
          _a.divideScalar(len);
          p.pos.copy(from).addScaledVector(_a, len * 0.5);
          p.quat.setFromUnitVectors(_up, _a);
        }
        break;
      }
      case 'whirl': {
        whirlSlot(p.orbit, t, _slot);
        p.pos.set(_slot.x, _slot.y, _slot.z);
        p.quat.setFromEuler(_e.set(t * 1.7 + p.orbit, t * 1.1 + p.orbit * 2, 0.4));
        break;
      }
      default: {
        const j =
          def.joint === 'waist'
            ? J[1]
            : def.joint === 'chest' || def.joint === 'heart'
              ? J[2]
              : def.joint === 'head' || def.joint === 'horn'
                ? J[3]
                : def.joint === 'mouth'
                  ? J[10]
                  : def.joint === 'spine'
                    ? J[11]
                    : def.joint === 'shoulder'
                      ? side < 0
                        ? J[5]
                        : J[4]
                      : J[2];
        const slot = BREATH_SLOTS[def.joint as keyof typeof BREATH_SLOTS];
        // A piece's offset off its joint (side joints are its slot's own x).
        let ox = def.at.x * mx;
        let oy = def.at.y;
        let oz = def.at.z;
        if (def.joint === 'lung') {
          // The bellows swell out and fall in with the breath.
          ox = mx * (slot.x + 0.45 * (look.swell - 0.5));
          oz = slot.z;
        } else if (def.joint === 'heart') {
          oy = slot.y - BREATH_SLOTS.chest.y;
          oz = slot.z + 0.15 * (look.swell - 0.5);
        } else if (def.joint === 'horn') {
          ox = mx * slot.x;
          oy = slot.y - BREATH_SLOTS.head.y;
          oz = slot.z - BREATH_SLOTS.head.z;
        } else if (def.joint === 'wing') {
          ox = mx * (slot.x + def.at.x);
          oy = slot.y - BREATH_SLOTS.chest.y + def.at.y;
          oz = slot.z + def.at.z;
        } else if (def.joint === 'shoulder') {
          ox = 0;
        }
        _a.set(ox, oy, oz);
        if (def.joint === 'head' || def.joint === 'horn' || def.joint === 'mouth') {
          _q.setFromAxisAngle(_x, -look.lift);
          _a.applyQuaternion(_q);
          p.quat.copy(_q2).multiply(_q);
        } else if (def.joint === 'waist') {
          p.quat.identity();
        } else {
          _a.applyQuaternion(_q2);
          p.quat.copy(_q2);
        }
        p.pos.copy(j).add(_a);
        if (def.joint === 'lung') {
          // The plate tips out with the swell.
          _q.setFromEuler(_e.set(0, 0, mx * -0.22 * (look.swell - 0.5)));
          p.quat.multiply(_q);
        } else if (def.joint === 'wing') {
          // The wings fan out with the spread, sweep back as they fold.
          _q.setFromEuler(_e.set(0.25 * (look.spread - 0.5), 0, mx * -0.55 * (look.spread - 0.5)));
          p.quat.multiply(_q);
        }
      }
    }
    if (jit > 0) {
      p.pos.x += (breathBodyHash(p.index, Math.floor(t * 40)) - 0.5) * jit;
      p.pos.y += (breathBodyHash(p.index + 50, Math.floor(t * 40)) - 0.5) * jit;
      p.pos.z += (breathBodyHash(p.index + 90, Math.floor(t * 40)) - 0.5) * jit;
    }
    // Torn: out toward the piece's orbit round the storm core.
    if (look.tear > 0) {
      stormShardSlot(p.index, t, _slot);
      const k = look.tear;
      p.pos.set(
        p.pos.x + (_slot.x - p.pos.x) * k,
        p.pos.y + (_slot.y - p.pos.y) * k,
        p.pos.z + (_slot.z - p.pos.z) * k,
      );
      _q.setFromEuler(_e.set(t * 0.7 + p.index, t * 0.5 + p.index * 1.7, t * 0.3));
      p.quat.slerp(_q, k);
    }
    p.holder.position.copy(p.pos);
    p.holder.quaternion.copy(p.quat);
    // A torn shard shrinks a little (the core is what reads now).
    const s = 1 - 0.25 * look.tear;
    p.holder.scale.setScalar(def.joint === 'chest' ? s * (1 + 0.06 * (look.swell - 0.5)) : s);
  }

  /** The threads between the joints at `alpha` of their light. */
  private poseThreads(alpha: number, look: BreathBodyLook): void {
    const J = this.joints;
    const w = 0.13 * (1 + look.mouth * 0.4) * Math.max(0, alpha);
    let n = 0;
    for (let t = 0; t < BREATH_THREAD_PAIRS.length; t++) {
      const i = BREATH_THREAD_PAIRS[t][0];
      const j = BREATH_THREAD_PAIRS[t][1];
      _a.copy(J[i]);
      _b.subVectors(J[j], J[i]);
      const len = _b.length();
      if (len < 1e-4 || w <= 0) {
        this.threads.setMatrixAt(n++, _m.makeScale(0, 0, 0));
        continue;
      }
      _q.setFromUnitVectors(_up, _b.divideScalar(len));
      _s.set(w, len, w);
      this.threads.setMatrixAt(n++, _m.compose(_a, _q, _s));
    }
    for (; n < BREATH_BODY_POOLS.threads; n++) this.threads.setMatrixAt(n, _m.makeScale(0, 0, 0));
    this.threads.instanceMatrix.needsUpdate = true;
  }

  /** The storm core: its figure fading in as the shell tears, the arcs. */
  private poseCore(look: BreathBodyLook, dt: number): void {
    const a = Math.max(0, Math.min(1, (look.tear - 0.15) / 0.6));
    this.core.visible = a > 0.01;
    if (!this.core.visible) return;
    this.coreMat.uniforms.uAlpha.value = a * (0.85 + 0.15 * Math.min(1, look.glow / 2));
    this.wingMat.uniforms.uAlpha.value = a * 0.95;
    this.heartGlowMat.opacity = a * (0.75 + 0.25 * Math.sin(this.clock * 9));
    const pulse = 1 + 0.06 * Math.sin(this.clock * 5.3);
    this.core.scale.set(1, pulse, 1);
    this.arcTimer -= dt;
    if (this.arcTimer <= 0) {
      this.arcTimer = 1 / STORM_CORE.arcRate;
      this.relayArcs(look);
    }
    this.arcMat.uniforms.uAlpha.value = a * (0.6 + 0.4 * this.rand());
  }

  /** Each arc leaps anew: from a point on the core to a torn shard. */
  private relayArcs(look: BreathBodyLook): void {
    const pos = this.arcGeo.getAttribute('position') as THREE.BufferAttribute;
    const C = STORM_CORE;
    const n = this.pieces.length;
    for (let a = 0; a < C.arcs; a++) {
      const target = n > 0 ? this.pieces[Math.floor(this.rand() * n)].pos : null;
      _a.set(
        (this.rand() - 0.5) * C.torso.rx * 1.4,
        C.torso.y + (this.rand() - 0.5) * C.torso.ry * 1.4,
        (this.rand() - 0.5) * C.torso.rz,
      );
      if (target && look.tear > 0.5) _b.copy(target);
      else
        _b.set(
          (this.rand() - 0.5) * 6,
          C.torso.y + (this.rand() - 0.3) * 5,
          (this.rand() - 0.5) * 6,
        );
      const width = 0.08 + this.rand() * 0.06;
      for (let pass = 0; pass < 2; pass++) {
        const base = (a * 2 + pass) * ARC_POINTS * 2;
        for (let i = 0; i < ARC_POINTS; i++) {
          const t = i / (ARC_POINTS - 1);
          const j = i === 0 || i === ARC_POINTS - 1 ? 0 : 0.55;
          _c.set(
            _a.x + (_b.x - _a.x) * t + (this.rand() - 0.5) * j,
            _a.y + (_b.y - _a.y) * t + (this.rand() - 0.5) * j,
            _a.z + (_b.z - _a.z) * t + (this.rand() - 0.5) * j,
          );
          const ox = pass === 0 ? width : 0;
          const oy = pass === 0 ? 0 : width;
          pos.setXYZ(base + i * 2, _c.x - ox, _c.y - oy, _c.z);
          pos.setXYZ(base + i * 2 + 1, _c.x + ox, _c.y + oy, _c.z);
        }
      }
    }
    pos.needsUpdate = true;
  }

  /** The seams', crystals' and threads' light. */
  private glow(look: BreathBodyLook, storm: boolean): void {
    const white = storm ? 0.7 : Math.min(1, Math.max(0, (look.glow - 2.2) / 2.2));
    this.glowColor
      .setHex(BREATH_BODY_COLORS.thread)
      .lerp(this.stormColor, white)
      .multiplyScalar(Math.min(2.4, look.glow));
    (this.seamMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.glowColor
      .setHex(BREATH_BODY_COLORS.glow)
      .lerp(this.stormColor, white)
      .multiplyScalar(Math.min(3, look.glow * 1.5));
    (this.crystalMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.haloMat.opacity = Math.min(0.75, 0.15 + look.glow * 0.16);
    this.emberMat.opacity = Math.min(0.9, 0.3 + look.glow * 0.2);
    this.threadColor
      .setHex(BREATH_BODY_COLORS.thread)
      .lerp(this.stormColor, white)
      .multiplyScalar(1 + look.glow * 0.4);
    // Uploaded only when it changed past the eye's step (it holds through a
    // calm, a phase, the storm).
    const tc = this.threadColor;
    const shown = this.threadShown;
    if (
      !(Math.abs(tc.r - shown.r) < THREAD_COLOR_EPS) ||
      !(Math.abs(tc.g - shown.g) < THREAD_COLOR_EPS) ||
      !(Math.abs(tc.b - shown.b) < THREAD_COLOR_EPS)
    ) {
      shown.copy(tc);
      for (let i = 0; i < BREATH_BODY_POOLS.threads; i++) this.threads.setColorAt(i, tc);
      if (this.threads.instanceColor) this.threads.instanceColor.needsUpdate = true;
    }
  }

  /** The breath pouring off its lips, the wind drawn into it, the storm's
   *  sparks (cosmetic, thinned low). */
  private cosmetics(
    e: Entity,
    action: BreathBodyAction,
    k: number,
    look: BreathBodyLook,
    dt: number,
  ): void {
    const mouth = this.joints[10];
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const mxW = e.pos.x + mouth.x * cosY + mouth.z * sinY;
    const mzW = e.pos.z - mouth.x * sinY + mouth.z * cosY;
    const myW = e.pos.y + mouth.y;
    if (look.mouth > 0 && this.rand() < dt * 22 * look.mouth * this.density) {
      // Breath pouring out of the horn's bell, along its yaw.
      this.particles.puff(mxW + sinY * 1.2, myW, mzW + cosY * 1.2, 2, {
        speed: 14 + look.mouth * 8,
        life: 0.8,
        size: [0.6, 2.4],
        color: BREATH_BODY_COLORS.wind,
        alpha: 0.4,
        dir: [sinY, -0.08, cosY],
        spread: 0.18,
        drag: 0.7,
      });
    }
    if (
      (action === 'inhale' || action === 'gather' || action === 'break') &&
      this.rand() < dt * 30 * (0.3 + k) * this.density
    ) {
      // The air drawn into the horn from all round.
      const a = this.rand() * Math.PI * 2;
      const r = 4 + this.rand() * 5;
      this.particles.puff(
        mxW + Math.sin(a) * r,
        myW + (this.rand() - 0.5) * 3,
        mzW + Math.cos(a) * r,
        1,
        {
          speed: 9,
          life: 0.55,
          size: [0.7, 0.15],
          color: BREATH_BODY_COLORS.wind,
          alpha: 0.35,
          dir: [-Math.sin(a), 0, -Math.cos(a)],
          spread: 0.1,
        },
      );
    }
    if ((look.tear > 0.2 || look.jitter > 0) && this.rand() < dt * 30 * this.density) {
      // Sparks off the core and the trembling seams.
      const y = e.pos.y + 2 + this.rand() * 4;
      this.particles.puff(
        e.pos.x + (this.rand() - 0.5) * 3,
        y,
        e.pos.z + (this.rand() - 0.5) * 3,
        2,
        {
          speed: 5,
          life: 0.3,
          size: [0.32, 0.06],
          color: BREATH_BODY_COLORS.spark,
          alpha: 1,
          pool: 'glow',
        },
      );
    }
  }

  /** The tear: the shell bursts out, a flash of white, a shake. */
  private tearBurst(e: Entity): void {
    const y = e.pos.y + 4;
    this.particles.puff(e.pos.x, y, e.pos.z, 36, {
      speed: 12,
      up: 2,
      life: 0.9,
      size: [0.4, 0.1],
      color: BREATH_BODY_COLORS.spark,
      alpha: 1,
      pool: 'glow',
      radius: 1.5,
    });
    this.particles.puff(e.pos.x, y, e.pos.z, 16, {
      speed: 8,
      up: 1,
      life: 1.6,
      size: [2, 6],
      color: BREATH_BODY_COLORS.dust,
      alpha: 0.45,
      drag: 1.6,
      radius: 2,
    });
    this.particles.shockRing(e.pos.x, e.pos.z, 0xe6faff, 14, 0.7);
    this.particles.shockRing(e.pos.x, e.pos.z, 0x47b8ff, 26, 1.1);
    this.shakeNear(e.pos.x, e.pos.z, 0.8, 70);
    this.stormFrom = Math.max(this.stormFrom, 0.3);
  }

  // ---- the death -----------------------------------------------------------------------------

  private poseDead(e: Entity): void {
    if (this.deadAt < 0) {
      this.deadAt = this.seenAlive ? this.clock : this.clock - BREATH_FALL.end - 1;
      if (!this.seenAlive) {
        // Never posed alive: fall from the rest pose.
        this.poseJoints('idle', 0, breathBodyLook('idle', 0, 0));
        const rest = breathBodyLook('idle', 0, 0);
        for (const p of this.pieces) this.posePiece(p, rest, 0);
      }
      for (const p of this.pieces) {
        p.diedPos.copy(p.pos);
        p.diedQuat.copy(p.quat);
        const r = breathFallRest(p.index, p.pos);
        p.rest = {
          at: r.at,
          tilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tilt.x, r.tilt.y, r.tilt.z)),
          delay: r.delay,
        };
        p.landed = !this.seenAlive;
        p.holder.scale.setScalar(1);
      }
      if (this.seenAlive) {
        this.particles.puff(e.pos.x, e.pos.y + 4, e.pos.z, 20, {
          speed: 6,
          up: 1,
          life: 0.7,
          size: [0.35, 0.08],
          color: BREATH_BODY_COLORS.spark,
          alpha: 1,
          pool: 'glow',
          radius: 1.2,
        });
        this.particles.shockRing(e.pos.x, e.pos.z, BREATH_BODY_COLORS.thread, 9, 0.8);
        this.shakeNear(e.pos.x, e.pos.z, 0.5, 50);
      }
    }
    this.group.rotation.y = this.yaw;
    const t = this.clock - this.deadAt;
    for (const p of this.pieces) {
      const rest = p.rest;
      if (!rest) continue;
      const fall = breathFallProgress(t, rest.delay, _fall);
      const k = fall.k;
      p.pos.set(
        p.diedPos.x + (rest.at.x - p.diedPos.x) * k,
        p.diedPos.y + (rest.at.y - p.diedPos.y) * k + Math.sin(Math.PI * k) * 0.4,
        p.diedPos.z + (rest.at.z - p.diedPos.z) * k,
      );
      p.quat.copy(p.diedQuat).slerp(rest.tilt, Math.min(1, k * 1.2));
      p.holder.position.copy(p.pos);
      p.holder.quaternion.copy(p.quat);
      if (fall.landed && !p.landed) {
        p.landed = true;
        _a.copy(p.pos).applyAxisAngle(_up, this.yaw);
        const x = e.pos.x + _a.x;
        const z = e.pos.z + _a.z;
        const size = Math.max(p.def.size.x, p.def.size.y);
        this.particles.puff(x, this.groundY(x, z) + 0.2, z, Math.round(2 + size * 2), {
          speed: 1.5 + size,
          up: 0.8,
          life: 1.2,
          size: [0.5 + size * 0.3, 1.2 + size * 0.6],
          color: BREATH_BODY_COLORS.dust,
          alpha: 0.4,
          drag: 1.6,
        });
      }
    }
    const snapK = t / BREATH_FALL.snap;
    this.poseThreads(snapK < 1 ? 1.5 * (1 - snapK) : 0, _look);
    const fade = Math.max(0, 1 - snapK);
    this.core.visible = this.stormSince >= 0 && fade > 0;
    this.coreMat.uniforms.uAlpha.value = fade;
    this.wingMat.uniforms.uAlpha.value = fade;
    this.arcMat.uniforms.uAlpha.value = fade * 0.8;
    this.heartGlowMat.opacity = fade;
    const dim = Math.max(0.05, 1 - t / BREATH_FALL.end);
    this.glowColor.setHex(BREATH_BODY_COLORS.thread).multiplyScalar(0.25 * dim);
    (this.seamMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.glowColor.setHex(BREATH_BODY_COLORS.glow).multiplyScalar(0.3 * dim);
    (this.crystalMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.haloMat.opacity = 0.4 * fade;
    for (const s of this.embers) s.visible = t < BREATH_FALL.snap;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.threads.dispose();
    this.glowTex?.dispose();
  }
}
