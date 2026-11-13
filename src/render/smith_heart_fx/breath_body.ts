// The Guardian of the Breath's wind (plan: breath_body_core.ts), hosted by
// ../rift_death_zone.ts beside the raid's other fx. The solid pieces are its
// own rigged model (characters/smith_heart_boss_looks.ts): this module is the
// half of the boss that is AIR, read from IWorld (the guardian's drawn
// position, facing, cast bar, swings, auras, death and the fight's cues, the
// wind object's phase) and from the sockets hung on the model's bones
// (breath_body_sockets.ts), so offline and online look the same:
//  - the stance: the calm wind or the storm, sent through the renderer's
//    gesture seam (re-sent so a rebuilt view holds the right one), and the
//    flare of its eyes, crystals and spiral at the big moments;
//  - the living body: currents of pale air wound from piece to piece (the
//    trunk down every tail plate into a curl over the floor, the arms through
//    their empty shoulders and elbows, the shoulders, the neck and the head,
//    two great wisps round it all), an inner glow, its eyes and the spiral in
//    its chest alight, cloud wisps off the tail, mist and crystal dust, stones
//    and crystal shards circling it;
//  - every move: a claw swipe leaves a slash of wind and a gust where it
//    lands; the Indrawn Breath draws the currents in tight and pours air into
//    the mouth; the Summit Roar blasts a cone of wind out of it; the casts
//    gather the storm in the raised hand and loose a bolt from the pointing
//    one; the channels raise a vortex off both hands;
//  - the storm breaking (its 4 s bar): the wind drawn in, frozen with crackling
//    light, torn apart with a flash, a ring and a burst of lightning; through
//    phase 2 the same currents are a dark storm cloud lit by lightning arcing
//    piece to piece, a crackling heart in its chest;
//  - its entrance (breath_entrance_fx.ts, read through
//    breath_entrance_state.ts): while the guardian is still the wind none of
//    its air shows, filling in as it forms inside the funnel; the entrance
//    owns its stance until the scene ends;
//  - the death: the wind thrown off in one last gust and gone, the glow out,
//    the stones and shards dropping.
// Presentation only: the fight's telegraphs are breath_fight_fx.ts's and
// breath_fx.ts's, on every tier. The low tier and reduced motion thin the
// ribbons, the dust, the clouds, the orbiters and the shakes; nothing here is
// a warning a player reacts to (which body it wears, calm or storm, is the
// model's own clip set and stays on every tier).
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the ribbons, the cone and the
// orbiters are their own carriers, hidden until drawn); no light; fixed
// pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_OBJECTS,
  type BreathWindPhase,
  breathWindOf,
} from '../../sim/encounters/smith_heart/breath_ids';
import { BREATH_INTRO } from '../../sim/encounters/smith_heart/breath_intro_plan';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  arcPath,
  BREAK_TEAR_AT,
  BREATH_ARC_PAIRS,
  BREATH_ARCS,
  BREATH_BODY_CLIP,
  BREATH_BODY_COLORS,
  BREATH_BODY_GESTURES,
  BREATH_BODY_POOLS,
  BREATH_BURST,
  BREATH_CURRENTS,
  BREATH_GUARDIAN,
  BREATH_PUFF_COUNT,
  BREATH_PUFF_LOW_SIZE,
  BREATH_RIBBON_COUNT,
  BREATH_RIBBON_SEGMENTS,
  BREATH_SOCKETS,
  BREATH_SYNCED_CASTS,
  BREATH_TAIL_CURL,
  BREATH_YD_PER_UNIT,
  type BreathBodyActionState,
  type BreathBodyInput,
  type BreathCurrent,
  type BreathSocketId,
  breathBodyAction,
  breathBodyHash,
  breathDeathLook,
  breathPuffKept,
  breathRibbonKept,
  breathSocketIndex,
  breathStanceGesture,
  breathWindLook,
  newWindLook,
  profileAt,
  ribbonFade,
  splineAt,
  stormFormOn,
} from './breath_body_core';
import { BreathBodyOrbit } from './breath_body_orbit';
import {
  breathBodySockets,
  clearBreathBodySockets,
  retryBreathBodySockets,
} from './breath_body_sockets';
import type { BreathDeathBodyLook } from './breath_death_core';
import { breathDeathFor } from './breath_death_state';
import { breathEntranceFor } from './breath_entrance_state';
import { BreathRibbonPool, boltUniforms, windUniforms } from './breath_wind_ribbons';
import { BreathWindVolume } from './breath_wind_volume';
import { inSmithHeartClaim } from './council_fx_core';

const SCAN_SEC = 0.1;
const C = BREATH_BODY_COLORS;
const U = BREATH_YD_PER_UNIT;
const SEG = BREATH_RIBBON_SEGMENTS;
const S = (id: BreathSocketId) => breathSocketIndex(id);
const S_MOUTH = S('mouth');
const S_EYE_L = S('eyeL');
const S_EYE_R = S('eyeR');
const S_HEART = S('heart');
const S_CORE = S('core');
const S_HALO = S('halo');
const S_CLAW_L = S('clawL');
const S_CLAW_R = S('clawR');
const S_HAND_L = S('handL');
const S_HAND_R = S('handR');
const S_TIP = S('tip');
const TAIL = [S('waist'), S('tail1'), S('tail2'), S('tail3'), S('tip')] as const;
const GLOW_AT = [S('core'), S('armL'), S('armR'), S('waist'), S('tail2'), S('neck')] as const;
const CRYSTALS = [S('spikeL'), S('spikeR'), S('crown'), S_CLAW_L, S_CLAW_R, S_HALO] as const;
/** Each current's path as socket indices (read once). */
const PATHS = BREATH_CURRENTS.map((c) => c.path.map((id) => breathSocketIndex(id)));
const MAX_PATH = Math.max(...BREATH_CURRENTS.map((c) => c.path.length)) + BREATH_TAIL_CURL.points;
/** The claw trail's length (frames kept) for the swipe's slash. */
const TRAIL = 9;
const ARC_SEG = BREATH_ARCS.segments;
/** The bars whose end looses a bolt from the pointing hand. */
const BOLT_CASTS = new Set(
  Object.keys(BREATH_SYNCED_CASTS).filter(
    (c) => c !== BREATH_CASTS.inhale && c !== BREATH_CASTS.gust && c !== BREATH_CASTS.storm,
  ),
);

// ---- the roar's blast: a cone of wind out of the war-horn mouth -----------------------------

const CONE_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;
const CONE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAge;
uniform float uAlpha;
uniform vec3 uWind;
uniform vec3 uEdge;
varying vec2 vUv;
varying float vFacing;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  // vUv.y 1 at the mouth, 0 at the far rim; streaks racing outward.
  float outward = 1.0 - vUv.y;
  float n = vnoise(vec2(vUv.x * 22.0, outward * 3.0 - uTime * 7.0));
  float n2 = vnoise(vec2(vUv.x * 9.0 + 3.0, outward * 1.6 - uTime * 4.0));
  float streak = smoothstep(0.42, 0.9, n) * 0.8 + n2 * 0.35;
  // The front of the blast rides out with its age; behind it the air thins.
  float front = smoothstep(uAge - 0.25, uAge, outward) * (1.0 - smoothstep(uAge, uAge + 0.06, outward));
  float body = (1.0 - smoothstep(0.0, uAge + 0.02, outward - 0.02)) * 0.55;
  float a = uAlpha * (front * 0.9 + body * streak) * (0.35 + 0.65 * vFacing);
  a *= smoothstep(0.0, 0.08, vUv.y);
  vec3 col = mix(uWind, uEdge, clamp(front + streak * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.75));
}
`;

// ---- scratch (no allocation a frame) -------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _bi = new THREE.Vector3();
const _t = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _side = new THREE.Vector3(1, 0, 0);
const _q = new THREE.Quaternion();
const _sp = new Float32Array(6);
const _pts = new Float32Array(MAX_PATH * 3);
const _ring = new Float32Array((SEG + 1) * 3);
const _arc = new Float32Array((ARC_SEG + 1) * 3);
const _act: BreathBodyActionState = { action: 'idle', k: 0 };
const _actIn: BreathBodyInput = {
  castId: null,
  castFill: 0,
  windPhase: null,
  windFill: 0,
  stormForm: false,
};
const _look = newWindLook();
const _dir: [number, number, number] = [0, 1, 0];

/** The per-frame puffs' options, written in place. */
const CLOUD = {
  speed: 0.7,
  up: 0.4,
  life: 2.2,
  size: [3.5, 7] as [number, number],
  color: C.cloud as readonly [number, number, number],
  alpha: 0.14,
  drag: 0.8,
  radius: 1.2,
  floor: -1e6,
};
const MIST = {
  speed: 0.6,
  up: 0.5,
  life: 2.6,
  size: [7, 12] as [number, number],
  color: C.wind as readonly [number, number, number],
  alpha: 0.1,
  drag: 0.8,
  radius: 2.5,
  floor: -1e6,
};
const DUST = {
  speed: 1.4,
  up: 0.6,
  life: 1.7,
  size: [0.22, 0.05] as [number, number],
  color: C.dust as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 2.5,
  drag: 0.5,
  floor: -1e6,
};
const RISE = {
  speed: 2,
  up: 9,
  life: 0.9,
  size: [1.2, 0.3] as [number, number],
  color: C.windEdge as readonly [number, number, number],
  alpha: 0.4,
  drag: 0.3,
  floor: -1e6,
};
const CRACKLE = {
  speed: 5,
  life: 0.25,
  size: [0.3, 0.05] as [number, number],
  color: C.spark as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  floor: -1e6,
};
const CLAWS = [S_CLAW_L, S_CLAW_R] as const;
const DRAW_IN = {
  speed: 6,
  life: 0.5,
  size: [0.45, 0.1] as [number, number],
  color: C.spark as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as 'glow' | undefined,
  dir: _dir,
  spread: 0.06,
  drag: 0,
  floor: -1e6,
};
const DRAW_MIST = {
  speed: 6,
  life: 0.6,
  size: [1.8, 0.5] as [number, number],
  color: C.windEdge as readonly [number, number, number],
  alpha: 0.35,
  pool: undefined as 'glow' | undefined,
  dir: _dir,
  spread: 0.08,
  drag: 0,
  floor: -1e6,
};

interface Flash {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  born: number;
  life: number;
  size: number;
}

interface Arc {
  born: number;
  life: number;
  a: number;
  b: number;
  seed: number;
  width: number;
}

export class BreathBody {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** Everything drawn, under the gated root: the painter shows and hides
   *  this, never the root (the compile gate owns the root's reveal). */
  private readonly fx = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly low: boolean;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** Live socket places this frame (world), in BREATH_SOCKETS order. */
  private readonly sock: THREE.Vector3[] = BREATH_SOCKETS.map(() => new THREE.Vector3());
  private readonly wind: BreathRibbonPool;
  private readonly windU: ReturnType<typeof windUniforms>;
  private readonly volume: BreathWindVolume;
  private readonly bolts: BreathRibbonPool;
  private readonly slashes: BreathRibbonPool;
  private readonly cone: THREE.Mesh;
  private readonly coneMat: THREE.ShaderMaterial;
  private readonly orbit: BreathBodyOrbit;
  private readonly eyes: THREE.Sprite[] = [];
  private readonly eyeMat: THREE.SpriteMaterial;
  private readonly heart: THREE.Sprite;
  private readonly heartMat: THREE.SpriteMaterial;
  private readonly mouth: THREE.Sprite;
  private readonly mouthMat: THREE.SpriteMaterial;
  private readonly glows: THREE.Sprite[] = [];
  private readonly glowMat: THREE.SpriteMaterial;
  private readonly glints: THREE.Sprite[] = [];
  private readonly glintMat: THREE.SpriteMaterial;
  private readonly hand: THREE.Sprite;
  private readonly handMat: THREE.SpriteMaterial;
  private readonly flashes: Flash[] = [];
  private readonly arcs: Arc[] = [];
  private readonly arcCount: number;
  /** The cast's bolt out of the pointing claws (the pool's spare strip). */
  private readonly castBolt = { live: false, seed: 0, born: 0, x: 0, y: 0, z: 0 };
  /** The two claws' recent places (a ring of TRAIL frames each), their speed. */
  private readonly trail: Float32Array = new Float32Array(2 * TRAIL * 3);
  private trailHead = 0;
  private trailFill = 0;
  private readonly clawSpeed = new Float32Array(2);
  private readonly glowTex: THREE.Texture | null;
  private entityId = -1;
  private windId = -1;
  private windTemplate = '';
  private windSince = 0;
  private readonly windNow = { phase: null as BreathWindPhase | null, fill: 0 };
  private rosterSeen = Number.NaN;
  private stance = '';
  private gestureTimer = 0;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x6b1d;
  /** 0 the calm wind, 1 the storm (eased; the tear drives it up). */
  private storm = 0;
  private flash = 0;
  private lastCast: string | null = null;
  private lastFill = 0;
  private coneAt = -99;
  private tearAt = -99;
  private arcTimer = 0;
  private readonly swings: number[] = [];
  private deadAt = -1;
  /** Its death scene's look was held last frame (its end gives the light back). */
  private dyingHeld = false;
  private seenAlive = false;
  private flaredInhale = false;
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
    this.root.name = 'smith-heart-breath-body';
    setRenderCategory(this.root, 'ui3d');
    this.fx.name = 'smithHeartBreathBodyFx';
    this.fx.visible = false;
    this.root.add(this.fx);
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.low = !detail;
    this.density = detail ? 1 : 0.4;
    this.arcCount = detail ? BREATH_ARCS.pool : BREATH_ARCS.poolLow;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.fx,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    // The living currents (every tier keeps the body; the low tier fewer
    // strands of it), the storm's lightning, the claws' slashes.
    this.windU = windUniforms(this.uTime, C);
    this.wind = new BreathRibbonPool(
      'smithHeartBreathWind',
      BREATH_RIBBON_COUNT,
      SEG,
      'wind',
      this.windU,
      this.materials,
      this.geometries,
    );
    this.bolts = new BreathRibbonPool(
      'smithHeartBreathBolts',
      BREATH_ARCS.pool + 1,
      ARC_SEG,
      'bolt',
      boltUniforms(this.uTime, C.lightning, C.lightningEdge),
      this.materials,
      this.geometries,
    );
    this.slashes = new BreathRibbonPool(
      'smithHeartBreathSlash',
      BREATH_BODY_POOLS.slashes,
      TRAIL - 1,
      'bolt',
      boltUniforms(this.uTime, 0xd8ecff, 0x6aa4d8),
      this.materials,
      this.geometries,
    );
    // The body's volume under the currents (billows of storm air).
    this.volume = new BreathWindVolume(
      BREATH_PUFF_COUNT,
      this.windU,
      this.materials,
      this.geometries,
    );
    this.fx.add(this.volume.mesh);
    for (const p of [this.wind, this.bolts, this.slashes]) {
      this.fx.add(p.mesh);
    }
    // The roar's cone of wind (an open cone, its tip at the mouth, along +z).
    const coneGeo = new THREE.CylinderGeometry(1, 0.08, 1, 32, 1, true)
      .translate(0, -0.5, 0)
      .rotateX(-Math.PI / 2);
    this.geometries.push(coneGeo);
    this.coneMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathRoarCone',
      uniforms: {
        uTime: this.uTime,
        uAge: { value: 0 },
        uAlpha: { value: 0 },
        uWind: { value: new THREE.Color(C.wind[0], C.wind[1], C.wind[2]) },
        uEdge: { value: new THREE.Color(C.windEdge[0], C.windEdge[1], C.windEdge[2]) },
      },
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.materials.push(this.coneMat);
    this.cone = new THREE.Mesh(coneGeo, this.coneMat);
    this.cone.name = 'smithHeartBreathRoarCone';
    this.cone.frustumCulled = false;
    this.cone.visible = false;
    this.fx.add(this.cone);
    // The stones and shards round it.
    this.orbit = new BreathBodyOrbit(
      this.fx,
      this.uTime,
      BREATH_BODY_POOLS.stones,
      BREATH_BODY_POOLS.shards,
      this.low,
      this.materials,
      this.geometries,
    );
    const glowTex = hasDom ? radialGlowTexture() : null;
    this.glowTex = glowTex;
    const sprite = (color: number, name: string) =>
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name,
      });
    this.eyeMat = sprite(C.eye, 'smithHeartBreathEye');
    this.heartMat = sprite(C.heart, 'smithHeartBreathHeart');
    this.mouthMat = sprite(C.eye, 'smithHeartBreathMouth');
    this.glowMat = sprite(C.heart, 'smithHeartBreathInnerGlow');
    this.glintMat = sprite(C.crystal, 'smithHeartBreathGlint');
    this.handMat = sprite(C.lightning, 'smithHeartBreathHandGather');
    this.materials.push(
      this.eyeMat,
      this.heartMat,
      this.mouthMat,
      this.glowMat,
      this.glintMat,
      this.handMat,
    );
    const mk = (mat: THREE.SpriteMaterial, name: string) => {
      const s = new THREE.Sprite(mat);
      s.name = name;
      s.visible = false;
      this.fx.add(s);
      return s;
    };
    for (let i = 0; i < 2; i++) this.eyes.push(mk(this.eyeMat, 'smithHeartBreathEye'));
    this.heart = mk(this.heartMat, 'smithHeartBreathHeart');
    this.mouth = mk(this.mouthMat, 'smithHeartBreathMouth');
    this.hand = mk(this.handMat, 'smithHeartBreathHandGather');
    for (let i = 0; i < GLOW_AT.length; i++)
      this.glows.push(mk(this.glowMat, 'smithHeartBreathInnerGlow'));
    for (let i = 0; i < CRYSTALS.length; i++)
      this.glints.push(mk(this.glintMat, 'smithHeartBreathGlint'));
    for (let i = 0; i < BREATH_BODY_POOLS.flashes; i++) {
      const mat = sprite(C.flash, 'smithHeartBreathFlash');
      this.materials.push(mat);
      this.flashes.push({
        sprite: mk(mat, 'smithHeartBreathFlash'),
        mat,
        born: -99,
        life: 0,
        size: 1,
      });
    }
    for (let i = 0; i < BREATH_ARCS.pool; i++)
      this.arcs.push({ born: -99, life: 0, a: 0, b: 0, seed: 0, width: 1 });
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 55): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  private send(gesture: string): void {
    if (this.entityId >= 0) this.playGesture?.(this.entityId, gesture);
  }

  /** Never claims an event: the renderer's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed || this.entityId < 0) return false;
    if (ev.type === 'damage' && ev.ability === null && ev.sourceId === this.entityId) {
      // A plain swing: its claws cross before it on the clip's beat.
      if (this.swings.length < 4) this.swings.push(this.clock + BREATH_BODY_CLIP.attack);
    } else if (ev.type === 'spellfx' && ev.ability === BREATH_CUES.gust) {
      // The Summit Roar leaves its mouth.
      this.roarBlast();
    } else if (ev.type === 'spellfx' && ev.ability === BREATH_CUES.tear) {
      this.tear();
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
      // A view whose model was still loading gets its sockets on the scan tick.
      retryBreathBodySockets();
    }
    if (this.entityId >= 0) {
      const e = world.entities.get(this.entityId);
      if (!e) this.release();
      else this.pose(e, dt);
    }
    this.updateFlashes();
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
    // The discovery walk runs on a roster change only, never on the clock.
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (this.entityId < 0 && e.kind === 'mob' && e.templateId === BREATH_GUARDIAN) {
        this.entityId = e.id;
        this.deadAt = -1;
        this.seenAlive = false;
        this.swings.length = 0;
        this.stance = '';
        this.storm = 0;
        this.trailFill = 0;
        this.orbit.setGlow(1);
        this.fx.visible = true;
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
    this.fx.visible = false;
    this.hideBody();
  }

  private hideBody(): void {
    this.wind.commit(0);
    this.volume.commit(0);
    this.bolts.commit(0);
    this.slashes.commit(0);
    this.cone.visible = false;
    this.orbit.update(0, 0, 0, 0, 0, 0, 0, 0);
    for (const s of this.eyes) s.visible = false;
    for (const s of this.glows) s.visible = false;
    for (const s of this.glints) s.visible = false;
    this.heart.visible = false;
    this.mouth.visible = false;
    this.hand.visible = false;
  }

  /** The wind object's phase and fill (a new phase restarts the fill). */
  private windPhase(): { phase: BreathWindPhase | null; fill: number } {
    const out = this.windNow;
    out.phase = null;
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
    out.fill = of.seconds > 0 ? Math.min(1, (this.clock - this.windSince) / of.seconds) : 0;
    return out;
  }

  // ---- the sockets -------------------------------------------------------------------------

  /** Where each socket is this frame: the model's own bones when its view is
   *  up, else its rest place round the guardian (a view still loading). */
  private readSockets(e: Entity): void {
    const set = breathBodySockets();
    const eAt = fxAnchor(e);
    const sinY = Math.sin(e.facing);
    const cosY = Math.cos(e.facing);
    for (let i = 0; i < BREATH_SOCKETS.length; i++) {
      const p = set?.points[i];
      if (p) {
        p.getWorldPosition(this.sock[i]);
        continue;
      }
      const at = BREATH_SOCKETS[i].at;
      const x = at[0] * U;
      const z = at[2] * U;
      this.sock[i].set(eAt.x + x * cosY + z * sinY, eAt.y + at[1] * U, eAt.z - x * sinY + z * cosY);
    }
  }

  // ---- the pose ------------------------------------------------------------------------------

  private pose(e: Entity, dt: number): void {
    const eAt = fxAnchor(e);
    this.readSockets(e);
    this.trackClaws(dt);
    // Its death scene (breath_death_fx.ts) holds the look its air rides,
    // a dev replay on the living body too.
    const dying = breathDeathFor(e.id);
    if (e.dead && !dying) {
      this.poseDead(e, dt);
      return;
    }
    if (dying) {
      if (e.dead && this.deadAt < 0) this.deadAt = this.clock;
      this.dyingHeld = true;
      this.poseDying(e, dt, dying);
      return;
    }
    if (this.deadAt >= 0 || this.dyingHeld) {
      // Up again (a wipe, a replay's end): the wind and its light return.
      this.deadAt = -1;
      this.dyingHeld = false;
      this.orbit.setGlow(1);
    }
    this.seenAlive = true;
    const stormOn = stormFormOn(e.auras);
    // Its entrance (breath_entrance_fx.ts): while the scene is on the
    // entrance owns the stance, and the air is only as whole as the body
    // that has formed (none while it is still the wind).
    const ent = breathEntranceFor(e.id);
    const formed = ent ? ent.body : 1;
    // The stance: the calm wind or the storm, re-sent so a rebuilt view holds it.
    const want = breathStanceGesture(stormOn);
    this.gestureTimer -= dt;
    // Past the hand-back (the scene's tail) the body's own stance is back.
    if (ent && ent.t < BREATH_INTRO.seconds) this.stance = '';
    else if (want !== this.stance || this.gestureTimer <= 0) {
      this.stance = want;
      this.gestureTimer = 1;
      this.send(want);
    }
    const wind = this.windPhase();
    const fill = e.castTotal > 0 ? Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal)) : 1;
    _actIn.castId = e.castingAbility;
    _actIn.castFill = fill;
    _actIn.windPhase = wind.phase;
    _actIn.windFill = wind.fill;
    _actIn.stormForm = stormOn;
    breathBodyAction(_actIn, _act);
    const look = breathWindLook(_act.action, _act.k, this.clock, _look);
    // The storm's hold on it: up through the tear, held through phase 2.
    const stormWant = stormOn ? 1 : look.storm;
    this.storm += (stormWant - this.storm) * Math.min(1, dt * (stormWant > this.storm ? 3 : 1.2));
    if (_act.action === 'break' && _act.k >= BREAK_TEAR_AT) this.tear();
    // A bar that just ended on its beat: the cast's bolt leaves the hand.
    this.castEnded(e, fill);
    if (_act.action === 'inhale' && _act.k > 0.94 && !this.flaredInhale) {
      this.flaredInhale = true;
      this.send(BREATH_BODY_GESTURES.flare);
    } else if (_act.action !== 'inhale') this.flaredInhale = false;
    // The swings' claws cross before it.
    for (let i = this.swings.length - 1; i >= 0; i--) {
      if (this.clock < this.swings[i]) continue;
      this.swings.splice(i, 1);
      this.swipeLands();
    }
    this.flash = Math.max(0, this.flash - dt * 4);
    this.windU.uFlash.value = this.flash;
    this.windU.uStorm.value = this.storm;
    this.windU.uFlow.value = look.flow;
    this.currents(look.density * formed, look.radius, look.spin, 1, look.shiver);
    this.lights(look.glow, formed);
    this.cosmetics(dt, look.drawIn, look.shiver, formed);
    this.castFx(e, dt);
    this.stormFx(dt);
    this.slashFx();
    this.coneFx(e);
    this.orbit.update(eAt.x, eAt.y, eAt.z, this.clock, formed, this.storm, 0, eAt.y);
  }

  // ---- the living wind ---------------------------------------------------------------------

  /** Wind every current round its path: `alpha` its density, `radius` a share
   *  of its rest winding, `spin` its speed, `fling` (death) thrown out. */
  private currents(
    alpha: number,
    radius: number,
    spin: number,
    fling: number,
    shiver: number,
  ): void {
    if (alpha <= 0.01) {
      this.wind.commit(0);
      this.volume.commit(0);
      return;
    }
    let r = 0;
    let pi = 0;
    let pu = 0;
    const t = this.clock;
    for (let ci = 0; ci < BREATH_CURRENTS.length; ci++) {
      const cur = BREATH_CURRENTS[ci];
      const path = PATHS[ci];
      // The path's points (and the tail's curl over the floor).
      let n = 0;
      for (const si of path) {
        const p = this.sock[si];
        _pts[n * 3] = p.x;
        _pts[n * 3 + 1] = p.y;
        _pts[n * 3 + 2] = p.z;
        n++;
      }
      if (cur.tailCurl) {
        const tip = this.sock[S_TIP];
        const floor = this.groundY(tip.x, tip.z) + 0.35;
        const a0 = t * 0.9;
        for (let k = 1; k <= BREATH_TAIL_CURL.points; k++) {
          const a = a0 + k * 1.7;
          const rr = BREATH_TAIL_CURL.reach * U * (0.6 + 0.5 * k) * radius * fling;
          _pts[n * 3] = tip.x + Math.cos(a) * rr;
          _pts[n * 3 + 1] = Math.max(floor, tip.y - BREATH_TAIL_CURL.drop * U * k);
          _pts[n * 3 + 2] = tip.z + Math.sin(a) * rr;
          n++;
        }
      }
      for (let k = 0; k < cur.ribbons; k++, r++) {
        // The low tier's dropped strands are skipped, the kept packed in front
        // (only those upload and draw).
        if (!breathRibbonKept(cur, k, this.low)) {
          r--;
          continue;
        }
        this.ribbon(r, cur, k, n, alpha, radius, spin, fling, shiver);
      }
      // The billows of its body along this current (the low tier every other).
      const puffs = cur.puffs ?? 0;
      for (let j = 0; j < puffs; j++, pi++) {
        if (!breathPuffKept(j, this.low)) continue;
        const u = (j + 0.5) / puffs;
        splineAt(_pts, n, u, _sp);
        const seed = breathBodyHash(pi, 13);
        const a = seed * Math.PI * 2 + t * cur.spin * spin * 1.2;
        const out = profileAt(cur.radius, u) * U * radius * fling * 0.3;
        const size =
          profileAt(cur.puffSize ?? cur.radius, u) *
          U *
          (this.low ? BREATH_PUFF_LOW_SIZE : 1) *
          (0.75 + 0.25 * radius) *
          fling *
          (1 + 0.1 * Math.sin(t * (0.6 + seed) + pi));
        this.volume.set(
          pu++,
          _sp[0] + Math.cos(a) * out,
          _sp[1] + Math.sin(a * 0.7) * out * 0.5,
          _sp[2] + Math.sin(a) * out,
          size,
          (0.92 + 0.08 * seed) * alpha,
          seed,
        );
      }
    }
    this.wind.commit(r);
    this.volume.commit(pu);
  }

  private ribbon(
    r: number,
    cur: BreathCurrent,
    k: number,
    n: number,
    alpha: number,
    radius: number,
    spin: number,
    fling: number,
    shiver: number,
  ): void {
    const t = this.clock;
    const seed = breathBodyHash(r, 7);
    const phase0 = (k / cur.ribbons) * Math.PI * 2 + seed * 1.3;
    const turn = cur.turns * Math.PI * 2;
    const sp = cur.spin * spin * Math.PI * 2;
    // Each strand breathes its own width and reach.
    const breathe = 1 + 0.18 * Math.sin(t * (0.7 + seed) + r);
    const shake = Math.floor(t * 30);
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      splineAt(_pts, n, u, _sp);
      _t.set(_sp[3], _sp[4], _sp[5]);
      if (_t.lengthSq() < 1e-8) _t.set(0, -1, 0);
      _t.normalize();
      // A frame round the path (the reference up, or sideways where it runs
      // straight up and down).
      const ref = Math.abs(_t.y) > 0.92 ? _side : _up;
      _n.crossVectors(_t, ref).normalize();
      _bi.crossVectors(_t, _n).normalize();
      const th = phase0 + u * turn + t * sp;
      const jitter = shiver > 0 ? (breathBodyHash(shake + i, r) - 0.5) * 0.18 * shiver : 0;
      const rr = profileAt(cur.radius, u) * U * radius * fling * breathe * (1 + jitter);
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      _ring[i * 3] = _sp[0] + (_n.x * cs + _bi.x * sn) * rr;
      _ring[i * 3 + 1] = _sp[1] + (_n.y * cs + _bi.y * sn) * rr;
      _ring[i * 3 + 2] = _sp[2] + (_n.z * cs + _bi.z * sn) * rr;
    }
    let along = seed * 7;
    for (let i = 0; i <= SEG; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(SEG, i + 1);
      const tx = _ring[i1 * 3] - _ring[i0 * 3];
      const ty = _ring[i1 * 3 + 1] - _ring[i0 * 3 + 1];
      const tz = _ring[i1 * 3 + 2] - _ring[i0 * 3 + 2];
      if (i > 0)
        along += Math.hypot(
          _ring[i * 3] - _ring[i0 * 3],
          _ring[i * 3 + 1] - _ring[i0 * 3 + 1],
          _ring[i * 3 + 2] - _ring[i0 * 3 + 2],
        );
      const u = i / SEG;
      const fade = ribbonFade(u);
      const w = cur.width * U * (0.55 + 0.45 * fade) * breathe;
      this.wind.point(
        r,
        i,
        _ring[i * 3],
        _ring[i * 3 + 1],
        _ring[i * 3 + 2],
        tx,
        ty,
        tz,
        w,
        Math.min(0.95, cur.alpha * 1.25) * fade * alpha,
        along / U,
        cur.soft ? seed + 2 : seed,
      );
    }
  }

  /** The eyes, the spiral, the mouth, the inner glow and the crystals' glints
   *  (`k` 1 alive, falling to 0 in death). */
  private lights(glow: number, k: number): void {
    const shown = k > 0.02;
    const flick = 0.9 + 0.1 * Math.sin(this.clock * 13.7) * Math.sin(this.clock * 5.3);
    const st = this.storm;
    for (let i = 0; i < 2; i++) {
      const p = this.sock[i === 0 ? S_EYE_L : S_EYE_R];
      this.eyes[i].position.copy(p);
      const s = U * (0.55 + 0.12 * glow);
      this.eyes[i].scale.set(s, s, 1);
      this.eyes[i].visible = shown;
    }
    this.eyeMat.opacity = Math.min(1, 0.75 * k * flick * (0.8 + 0.2 * glow));
    // The spiral in its chest: a steady cyan light; through the storm a
    // crackling white heart.
    const h = this.sock[S_HEART];
    this.heart.position.copy(h);
    const crackle = st > 0.5 ? 0.75 + 0.5 * breathBodyHash(Math.floor(this.clock * 24), 3) : 1;
    const hs = U * (1.1 + 0.25 * Math.sin(this.clock * 2.2) + 0.25 * glow) * (1 + 0.35 * st);
    this.heart.scale.set(hs, hs, 1);
    this.heartMat.color.setHex(st > 0.5 ? C.lightning : C.heart);
    this.heartMat.opacity = Math.min(0.85, 0.42 * k * glow * crackle);
    this.heart.visible = shown;
    const m = this.sock[S_MOUTH];
    this.mouth.position.copy(m);
    const ms = U * (0.6 + 0.35 * Math.max(0, glow - 1));
    this.mouth.scale.set(ms, ms, 1);
    this.mouthMat.opacity = Math.min(0.7, 0.18 * k * glow);
    this.mouth.visible = shown;
    // The light inside the wind: soft and wide, never a sun.
    for (let i = 0; i < GLOW_AT.length; i++) {
      const p = this.sock[GLOW_AT[i]];
      const g = this.glows[i];
      g.position.copy(p);
      const s = U * (i === 0 ? 3.4 : 1.8) * (1 + 0.15 * Math.sin(this.clock * 1.3 + i));
      g.scale.set(s, s, 1);
      g.visible = shown && (i === 0 || this.density >= 1);
    }
    this.glowMat.color.setHex(st > 0.5 ? C.lightningEdge : C.heart);
    this.glowMat.opacity = Math.min(0.24, 0.1 * k * glow * (1 + st));
    for (let i = 0; i < CRYSTALS.length; i++) {
      const p = this.sock[CRYSTALS[i]];
      const g = this.glints[i];
      g.position.copy(p);
      const s = U * (0.75 + 0.2 * Math.sin(this.clock * 2.9 + i * 1.7));
      g.scale.set(s, s, 1);
      g.visible = shown;
    }
    this.glintMat.opacity = Math.min(0.6, 0.3 * k * glow);
  }

  /** Clouds off the tail, mist, crystal dust; streams drawn into the mouth
   *  while it draws breath (cosmetic, thinned on the low tier). */
  private cosmetics(dt: number, drawIn: number, shiver: number, k: number): void {
    const d = this.density;
    const st = this.storm;
    // The cloud of its tail: soft billows peeling off the plates.
    if (this.rand() < dt * 5 * d * k) {
      const p = this.sock[TAIL[2 + Math.floor(this.rand() * (TAIL.length - 2))]];
      CLOUD.color = st > 0.5 ? C.stormCloud : C.cloud;
      CLOUD.alpha = st > 0.5 ? 0.3 : 0.14;
      this.particles.puff(p.x, p.y, p.z, 1, CLOUD);
    }
    if (this.rand() < dt * (st > 0.5 ? 5 : 1.5) * d * k) {
      const p = this.sock[S_CORE];
      MIST.color = st > 0.5 ? C.stormCloud : C.wind;
      MIST.alpha = st > 0.5 ? 0.22 : 0.06;
      // The low tier keeps the storm's billows smaller (cosmetic fill).
      const big = d >= 1 && st > 0.5;
      MIST.size[0] = d < 1 ? 5 : big ? 10 : 7;
      MIST.size[1] = d < 1 ? 9 : big ? 16 : 12;
      this.particles.puff(p.x, p.y, p.z, 1, MIST);
    }
    // Glittering crystal dust round the body.
    if (this.rand() < dt * 30 * d * k) {
      const p = this.sock[Math.floor(this.rand() * this.sock.length)];
      DUST.color = st > 0.5 ? C.spark : C.dust;
      this.particles.puff(p.x, p.y, p.z, 1, DUST);
    }
    if (drawIn > 0.02) {
      const m = this.sock[S_MOUTH];
      this.drawInto(m, U * (3.5 + 2.5 * drawIn), dt * 50 * drawIn * d, DRAW_IN);
      this.drawInto(m, U * (4 + 3 * drawIn), dt * 14 * drawIn * d, DRAW_MIST);
    }
    if (shiver > 0.5 && this.rand() < dt * 30 * shiver * d) {
      // The freeze's crackle: sparks off the pieces.
      const p = this.sock[Math.floor(this.rand() * this.sock.length)];
      this.particles.puff(p.x, p.y, p.z, 3, CRACKLE);
    }
  }

  /** Streams of `o` drawn into `p` from a shell `r` yards out. */
  private drawInto(p: THREE.Vector3, r: number, rate: number, o: typeof DRAW_IN): void {
    let n = rate;
    while (n > 0) {
      if (n < 1 && this.rand() > n) break;
      n -= 1;
      _a.set(this.rand() - 0.5, (this.rand() - 0.5) * 0.7, this.rand() - 0.5)
        .normalize()
        .multiplyScalar(r);
      _dir[0] = -_a.x / r;
      _dir[1] = -_a.y / r;
      _dir[2] = -_a.z / r;
      o.speed = r / o.life;
      this.particles.puff(p.x + _a.x, p.y + _a.y, p.z + _a.z, 1, o);
    }
  }

  /** The casts: the storm gathered in the raised hand while the bar fills;
   *  the channels: a vortex rising off both hands. */
  private castFx(e: Entity, dt: number): void {
    const c = e.castingAbility;
    const fill = e.castTotal > 0 ? Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal)) : 0;
    const casting = c !== null && BOLT_CASTS.has(c);
    const l = this.sock[S_CLAW_L];
    if (casting) {
      this.hand.position.copy(l);
      const s = U * (0.8 + 1.4 * fill);
      this.hand.scale.set(s, s, 1);
      this.handMat.opacity = 0.2 + 0.4 * fill;
      this.hand.visible = true;
      this.drawInto(l, U * (1.6 + 1.2 * fill), dt * (20 + 50 * fill) * this.density, DRAW_IN);
      if (this.storm > 0.5 && this.rand() < dt * 18) this.spawnArc(S_CLAW_L, S_HAND_L, 0.6);
    } else {
      this.hand.visible = false;
      this.handMat.opacity = 0;
    }
    if (_act.action === 'channel') {
      RISE.color = this.storm > 0.5 ? C.stormEdge : C.windEdge;
      for (const si of CLAWS) {
        const p = this.sock[si];
        if (this.rand() < dt * 30 * this.density) {
          const a = this.rand() * Math.PI * 2;
          this.particles.puff(p.x + Math.cos(a) * U, p.y, p.z + Math.sin(a) * U, 1, RISE);
        }
      }
      if (this.storm > 0.5 && this.rand() < dt * 10) this.spawnArc(S_CLAW_L, S_CLAW_R, 1);
    }
  }

  /** A bolt bar ended on its beat: the bolt leaves the pointing hand. */
  private castEnded(e: Entity, fill: number): void {
    const c = e.castingAbility;
    const prev = this.lastCast;
    if (prev !== null && prev !== c && this.lastFill > 0.85 && BOLT_CASTS.has(prev)) {
      const p = this.sock[S_CLAW_R];
      this.flashAt(p.x, p.y, p.z, BREATH_BURST.flashSize * 0.8, BREATH_BURST.flashLife);
      this.particles.puff(p.x, p.y, p.z, 26, {
        speed: 14,
        life: 0.45,
        size: [0.4, 0.06],
        color: C.spark,
        alpha: 1,
        pool: 'glow',
        floor: -1e6,
      });
      // A bolt torn out of the pointing claws, forward and down.
      const cb = this.castBolt;
      cb.live = true;
      cb.born = this.clock;
      cb.seed = Math.floor(this.rand() * 1e6);
      cb.x = p.x + Math.sin(e.facing) * 9 * U;
      cb.y = p.y - 3 * U;
      cb.z = p.z + Math.cos(e.facing) * 9 * U;
    }
    this.lastCast = c;
    this.lastFill = c ? fill : 0;
  }

  // ---- the storm --------------------------------------------------------------------------

  /** The storm breaks open: a short flash at the heart, a ring, a burst of
   *  lightning to every piece, the cloud flung out (once per tear). */
  private tear(): void {
    if (this.entityId < 0 || this.clock - this.tearAt < 3) return;
    this.tearAt = this.clock;
    const h = this.sock[S_HEART];
    this.flashAt(h.x, h.y, h.z, BREATH_BURST.flashSize * 1.8, BREATH_BURST.flashLife * 2);
    this.flash = 1;
    for (let i = 0; i < this.arcCount; i++) {
      const pair = BREATH_ARC_PAIRS[(i * 3) % BREATH_ARC_PAIRS.length];
      this.spawnArc(breathSocketIndex(pair[0]), breathSocketIndex(pair[1]), 1.6);
    }
    this.particles.puff(h.x, h.y, h.z, 40, {
      speed: 12,
      life: 1.6,
      size: [3, 8],
      color: C.stormCloud,
      alpha: 0.45,
      drag: 1,
      radius: 2,
      floor: -1e6,
    });
    this.particles.puff(h.x, h.y, h.z, 60, {
      speed: 22,
      life: 0.8,
      size: [0.45, 0.06],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
      floor: -1e6,
    });
    const g = this.groundY(h.x, h.z);
    this.particles.shockRing(h.x, h.z, C.ring, 22, 1.1, BREATH_BURST.ring);
    this.particles.puff(h.x, g + 0.4, h.z, 40, {
      speed: 16,
      life: 1.2,
      size: [2, 5],
      color: C.grit,
      alpha: 0.35,
      drag: 1.4,
      radius: 3,
    });
    this.send(BREATH_BODY_GESTURES.flare);
    this.shakeNear(h.x, h.z, 0.7);
  }

  /** Phase 2: lightning arcing piece to piece, its flash lighting the cloud. */
  private stormFx(dt: number): void {
    if (this.storm > 0.5) {
      this.arcTimer -= dt * BREATH_ARCS.rate * (this.low ? 0.5 : 1) * this.storm;
      while (this.arcTimer <= 0) {
        this.arcTimer += 1;
        const pair = BREATH_ARC_PAIRS[Math.floor(this.rand() * BREATH_ARC_PAIRS.length)];
        this.spawnArc(breathSocketIndex(pair[0]), breathSocketIndex(pair[1]), 1);
        if (this.rand() < 0.25) this.flash = Math.max(this.flash, 0.6);
      }
    }
    this.drawArcs();
  }

  private spawnArc(a: number, b: number, width: number): void {
    let slot = this.arcs[0];
    for (let i = 0; i < this.arcCount; i++) {
      const s = this.arcs[i];
      if (s.born + s.life < slot.born + slot.life) slot = s;
    }
    slot.born = this.clock;
    slot.life = BREATH_ARCS.life * (0.7 + 0.6 * this.rand());
    slot.a = a;
    slot.b = b;
    slot.seed = Math.floor(this.rand() * 1e6);
    slot.width = width;
  }

  private boltStrip(r: number, width: number, alpha: number, seed: number): void {
    for (let i = 0; i <= ARC_SEG; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(ARC_SEG, i + 1);
      const u = i / ARC_SEG;
      const taper = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.1 + u * 0.9));
      this.bolts.point(
        r,
        i,
        _arc[i * 3],
        _arc[i * 3 + 1],
        _arc[i * 3 + 2],
        _arc[i1 * 3] - _arc[i0 * 3],
        _arc[i1 * 3 + 1] - _arc[i0 * 3 + 1],
        _arc[i1 * 3 + 2] - _arc[i0 * 3 + 2],
        width * taper,
        alpha,
        u,
        (seed % 997) / 997,
      );
    }
  }

  private drawArcs(): void {
    let used = 0;
    for (let i = 0; i < BREATH_ARCS.pool; i++) {
      const s = this.arcs[i];
      const age = this.clock - s.born;
      if (i >= this.arcCount || age < 0 || age > s.life) {
        this.bolts.clear(i);
        continue;
      }
      const pa = this.sock[s.a];
      const pb = this.sock[s.b];
      // Re-struck through its life: the bolt flickers to new shapes.
      const seed = s.seed + Math.floor(age * 30);
      arcPath(seed, pa.x, pa.y, pa.z, pb.x, pb.y, pb.z, ARC_SEG, 0.22, _arc);
      const k = 1 - age / s.life;
      this.boltStrip(i, 0.45 * U * s.width, Math.min(1, k * 1.6), seed);
      used = i + 1;
    }
    const cb = this.castBolt;
    const spare = BREATH_ARCS.pool;
    if (cb.live) {
      const age = this.clock - cb.born;
      if (age > 0.35) {
        cb.live = false;
        this.bolts.clear(spare);
      } else {
        const p = this.sock[S_CLAW_R];
        arcPath(
          cb.seed + Math.floor(age * 30),
          p.x,
          p.y,
          p.z,
          cb.x,
          cb.y,
          cb.z,
          ARC_SEG,
          0.14,
          _arc,
        );
        this.boltStrip(spare, 0.3 * U, 1 - age / 0.35, cb.seed);
        used = spare + 1;
      }
    } else this.bolts.clear(spare);
    this.bolts.commit(used);
  }

  // ---- the claws' slashes and the swipe's gust ----------------------------------------------

  private trackClaws(dt: number): void {
    const h = this.trailHead;
    for (let c = 0; c < 2; c++) {
      const p = this.sock[c === 0 ? S_CLAW_L : S_CLAW_R];
      const o = (c * TRAIL + h) * 3;
      if (this.trailFill > 0 && dt > 0) {
        const prev = (c * TRAIL + ((h + TRAIL - 1) % TRAIL)) * 3;
        const v =
          Math.hypot(
            p.x - this.trail[prev],
            p.y - this.trail[prev + 1],
            p.z - this.trail[prev + 2],
          ) / dt;
        this.clawSpeed[c] += (v - this.clawSpeed[c]) * Math.min(1, dt * 12);
      }
      this.trail[o] = p.x;
      this.trail[o + 1] = p.y;
      this.trail[o + 2] = p.z;
    }
    this.trailHead = (h + 1) % TRAIL;
    this.trailFill = Math.min(TRAIL, this.trailFill + 1);
  }

  /** A slash of wind behind each claw that moves fast (a swipe, the roar's
   *  fling, the cast's thrust). */
  private slashFx(): void {
    if (this.trailFill < TRAIL) {
      this.slashes.commit(0);
      return;
    }
    let used = 0;
    for (let c = 0; c < 2; c++) {
      const k = Math.max(0, Math.min(1, (this.clawSpeed[c] / U - 9) / 14));
      if (k <= 0.02) {
        this.slashes.clear(c);
        continue;
      }
      for (let i = 0; i < TRAIL; i++) {
        // Oldest first.
        const j = (this.trailHead + i) % TRAIL;
        const o = (c * TRAIL + j) * 3;
        const on = (c * TRAIL + ((this.trailHead + Math.min(TRAIL - 1, i + 1)) % TRAIL)) * 3;
        const op = (c * TRAIL + ((this.trailHead + Math.max(0, i - 1)) % TRAIL)) * 3;
        const u = i / (TRAIL - 1);
        this.slashes.point(
          c,
          i,
          this.trail[o],
          this.trail[o + 1],
          this.trail[o + 2],
          this.trail[on] - this.trail[op],
          this.trail[on + 1] - this.trail[op + 1],
          this.trail[on + 2] - this.trail[op + 2],
          U * (0.25 + 0.75 * u) * 0.9,
          k * u * 0.55,
          u,
          c * 0.37,
        );
      }
      used = c + 1;
    }
    this.slashes.commit(used);
  }

  /** A swipe's claws cross before it: a gust bursting off the claw that moved,
   *  a ring of dust where it reaches the floor, a light shake. */
  private swipeLands(): void {
    const ci = this.clawSpeed[0] >= this.clawSpeed[1] ? S_CLAW_L : S_CLAW_R;
    const p = this.sock[ci];
    const g = this.groundY(p.x, p.z);
    this.particles.puff(p.x, p.y, p.z, 14, {
      speed: 9,
      life: 0.7,
      size: [1.6, 4.5],
      color: this.storm > 0.5 ? C.stormCloud : C.windEdge,
      alpha: 0.32,
      drag: 1.6,
      radius: U * 0.6,
      floor: -1e6,
    });
    this.particles.puff(p.x, p.y, p.z, 18, {
      speed: 12,
      life: 0.45,
      size: [0.3, 0.05],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
      floor: -1e6,
    });
    this.particles.puff(p.x, g + 0.3, p.z, 16, {
      speed: 8,
      life: 0.9,
      size: [1.2, 3],
      color: C.grit,
      alpha: 0.3,
      drag: 1.6,
      radius: 1.5,
    });
    this.particles.shockRing(p.x, p.z, C.ring, 7, 0.55, BREATH_BURST.ring);
    if (this.storm > 0.5) this.spawnArc(ci, ci === S_CLAW_L ? S_HAND_L : S_HAND_R, 1.2);
    this.shakeNear(p.x, p.z, 0.25);
  }

  // ---- the roar ---------------------------------------------------------------------------

  /** The Summit Roar leaves the mouth: a cone of wind blasting out before it,
   *  a short flash at the mouth only, streaks of air and grit. */
  private roarBlast(): void {
    const e = this.world?.entities.get(this.entityId);
    if (!e || e.dead) return;
    this.coneAt = this.clock;
    const m = this.sock[S_MOUTH];
    this.flashAt(m.x, m.y, m.z, BREATH_BURST.flashSize, BREATH_BURST.flashLife);
    _dir[0] = Math.sin(e.facing);
    _dir[1] = -0.18;
    _dir[2] = Math.cos(e.facing);
    this.particles.puff(m.x, m.y, m.z, 46, {
      speed: 34,
      life: 0.75,
      size: [1.5, 4],
      color: C.windEdge,
      alpha: 0.4,
      dir: _dir,
      spread: 0.32,
      drag: 0.6,
      floor: -1e6,
    });
    this.particles.puff(m.x, m.y, m.z, 40, {
      speed: 40,
      life: 0.5,
      size: [0.5, 0.08],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
      dir: _dir,
      spread: 0.25,
      floor: -1e6,
    });
    this.send(BREATH_BODY_GESTURES.flare);
    this.flash = Math.max(this.flash, 0.5);
    this.shakeNear(m.x, m.z, 0.55);
  }

  private coneFx(e: Entity): void {
    const age = this.clock - this.coneAt;
    const life = 0.9;
    if (age < 0 || age > life) {
      this.cone.visible = false;
      return;
    }
    const m = this.sock[S_MOUTH];
    const k = age / life;
    const len = U * (6 + 16 * (1 - (1 - k) ** 2));
    const rad = len * 0.42;
    this.cone.position.copy(m);
    // Out along the facing, tipped a little down to the Cornice.
    _c.set(Math.sin(e.facing), -0.2, Math.cos(e.facing)).normalize();
    _q.setFromUnitVectors(_z, _c);
    this.cone.quaternion.copy(_q);
    this.cone.scale.set(rad, rad, len);
    this.coneMat.uniforms.uAge.value = Math.min(1, k * 1.4);
    this.coneMat.uniforms.uAlpha.value = (1 - k) ** 1.2;
    this.cone.visible = true;
  }

  // ---- the bursts ------------------------------------------------------------------------------

  private flashAt(x: number, y: number, z: number, size: number, life: number): void {
    let slot = this.flashes[0];
    for (const f of this.flashes) if (f.born + f.life < slot.born + slot.life) slot = f;
    slot.born = this.clock;
    slot.life = life;
    slot.size = size;
    slot.sprite.position.set(x, y, z);
    slot.sprite.visible = true;
  }

  private updateFlashes(): void {
    for (const f of this.flashes) {
      const t = (this.clock - f.born) / Math.max(1e-3, f.life);
      if (t >= 1 || t < 0) {
        if (f.sprite.visible) {
          f.sprite.visible = false;
          f.mat.opacity = 0;
        }
        continue;
      }
      // A hard pop that dies fast: bright on its point, never the frame.
      const s = f.size * (0.7 + 0.5 * t);
      f.sprite.scale.set(s, s, 1);
      f.mat.opacity = BREATH_BURST.flashPeak * (1 - t) ** 2;
    }
  }

  // ---- the death -----------------------------------------------------------------------------

  private poseDead(e: Entity, dt: number): void {
    const eAt = fxAnchor(e);
    if (this.deadAt < 0) {
      this.deadAt = this.seenAlive ? this.clock : this.clock - 10;
      this.swings.length = 0;
      if (this.seenAlive) {
        // The wind thrown off in one last gust.
        const h = this.sock[S_CORE];
        this.particles.puff(h.x, h.y, h.z, 50, {
          speed: 14,
          life: 1.8,
          size: [3, 9],
          color: this.storm > 0.5 ? C.stormCloud : C.cloud,
          alpha: 0.32,
          drag: 1.1,
          radius: U * 1.5,
          floor: -1e6,
        });
        this.particles.puff(h.x, h.y, h.z, 50, {
          speed: 10,
          life: 1.6,
          size: [0.3, 0.05],
          color: C.dust,
          alpha: 1,
          pool: 'glow',
          gravity: 4,
          radius: U,
          floor: -1e6,
        });
        this.particles.shockRing(eAt.x, eAt.z, C.ring, 18, 1, BREATH_BURST.ring);
        this.shakeNear(eAt.x, eAt.z, 0.4);
      }
    }
    const t = this.clock - this.deadAt;
    const look = breathDeathLook(t);
    this.windU.uStorm.value = this.storm;
    this.windU.uFlow.value = 1.6;
    this.flash = 0;
    this.windU.uFlash.value = 0;
    this.currents(look.wind, 1, 1.4, look.fling, 0);
    this.lights(1, look.glow);
    this.cosmetics(dt, 0, 0, look.wind);
    this.hand.visible = false;
    this.cone.visible = false;
    this.slashes.commit(0);
    this.drawArcs();
    this.orbit.setGlow(look.glow);
    this.orbit.update(
      eAt.x,
      eAt.y,
      eAt.z,
      this.clock,
      1,
      this.storm,
      look.drop,
      this.groundY(eAt.x, eAt.z),
    );
  }

  /** Its death scene's look (breath_death_core.ts): its currents drawn in
   *  tight, its arcs wild then sputtering, its body unravelling, its light
   *  out at the clap, its stones dropping. No stance of its own is sent over
   *  it (a replay's fall holds); the next living frame re-sends the calm. */
  private poseDying(e: Entity, dt: number, L: BreathDeathBodyLook): void {
    const eAt = fxAnchor(e);
    this.stance = '';
    this.gestureTimer = 0;
    this.storm = L.storm;
    this.windU.uStorm.value = L.storm;
    this.windU.uFlow.value = 1 + L.spin;
    this.flash = Math.max(0, this.flash - dt * 4);
    if (L.flare > 0.5 && this.rand() < dt * 6) this.flash = Math.max(this.flash, 0.5 * L.flare);
    this.windU.uFlash.value = this.flash;
    this.currents(L.wind, L.radius, L.spin, L.fling, L.shiver);
    this.lights(1 + L.flare, L.glow);
    this.cosmetics(dt, L.drawIn, L.shiver, L.wind);
    this.hand.visible = false;
    this.cone.visible = false;
    this.slashes.commit(0);
    // Its arcs leap piece to piece at the scene's rate (wild, sputtering).
    this.arcTimer -= dt * L.arcs * (this.low ? 0.5 : 1);
    while (this.arcTimer <= 0 && L.arcs > 0) {
      this.arcTimer += 1;
      const pair = BREATH_ARC_PAIRS[Math.floor(this.rand() * BREATH_ARC_PAIRS.length)];
      this.spawnArc(breathSocketIndex(pair[0]), breathSocketIndex(pair[1]), 1);
    }
    if (L.arcs <= 0) this.arcTimer = Math.min(this.arcTimer, 1);
    this.drawArcs();
    this.orbit.setGlow(L.glow);
    this.orbit.update(
      eAt.x,
      eAt.y,
      eAt.z,
      this.clock,
      1,
      L.storm,
      L.drop,
      this.groundY(eAt.x, eAt.z),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.glowTex?.dispose();
    clearBreathBodySockets();
  }
}
