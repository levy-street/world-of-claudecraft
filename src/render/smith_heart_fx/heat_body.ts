// The Guardian of the Heat's fire (plan: heat_body_core.ts), hosted by
// ../rift_death_zone.ts beside the raid's other fx. The body itself is its own
// rigged model (characters/smith_heart_boss_looks.ts): this module is the half
// of the boss that is fire, read from IWorld (the guardian's drawn position,
// facing, cast bar, swings, auras, death and the fight's cues) and from the
// sockets hung on the model's bones (heat_body_sockets.ts), so offline and
// online look the same:
//  - the stance: the gestures that plunge the rig under the wellspring, hold
//    it there, burst it back out and throw its fire (Hearth Flare, the seeds,
//    the Wakefire), sent through the renderer's gesture seam and re-sent so a
//    rebuilt view holds the right stance;
//  - the burning body: flames roaring off its shoulders, back, fists, horns
//    and crown, embers, dark smoke and a heat haze rising off it, its eyes and
//    the ring in its chest alight, a living vortex of fire where its body
//    meets the lava, the lava churning round it, molten rocks circling it;
//  - every blow: a fist slammed on the shore throws a lava splash, a burst of
//    flame, a shockwave and smoke; Basalt Fist's fist gathers fire through its
//    bar and lands on the bar's end; the cast gathers fire between its hands
//    and throws it; the plunge and the breach erupt; the death flares, slumps
//    and cools to smoke.
// Presentation only: the fight's telegraphs are heat_fx.ts's and
// heat_fight_fx.ts's, on every tier. The low tier and reduced motion thin the
// flames, the smoke, the rocks and the shakes; nothing here is a warning a
// player reacts to.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the shaders each have a hidden
// carrier); no light; fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { HEAT_CASTS, HEAT_CUES, HEAT_STAGES } from '../../sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { wrapAngle } from '../facing_smooth';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { inSmithHeartClaim } from './council_fx_core';
import {
  HEAT_BODY_CLIP,
  HEAT_BODY_GESTURES,
  HEAT_BODY_POOLS,
  HEAT_CAST_GAP,
  HEAT_GUARDIAN,
  HEAT_MODEL_COLORS,
  HEAT_MODEL_LAVA,
  HEAT_ROCKS_LOW,
  HEAT_SOCKETS,
  HEAT_YD_PER_UNIT,
  type HeatSocketId,
  heatBodyHash,
  heatBodyState,
  heatCastLook,
  heatDeathLook,
  heatFlameFor,
  heatFlameRate,
  heatRockOrbit,
  heatSocketIndex,
  heatStanceGesture,
} from './heat_body_core';
import { clearHeatBodySockets, heatBodySockets, retryHeatBodySockets } from './heat_body_sockets';
import { heatParticleSteps } from './heat_floor_ladder_core';

const SCAN_SEC = 0.1;
const C = HEAT_MODEL_COLORS;
const S_FIST_L = heatSocketIndex('fistL');
const S_FIST_R = heatSocketIndex('fistR');
const S_EYE_L = heatSocketIndex('eyeL');
const S_EYE_R = heatSocketIndex('eyeR');
const S_HEART = heatSocketIndex('heart');
const S_BACK = heatSocketIndex('back');
const S_SHOULDER_L = heatSocketIndex('shoulderL');
const S_SHOULDER_R = heatSocketIndex('shoulderR');
const SMOKE_SOCKETS = [S_SHOULDER_L, S_SHOULDER_R, S_BACK, heatSocketIndex('crown')] as const;

// ---- the vortex of fire round its lower body (one shader, two layers) -------------------------

const VORTEX_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uTwist;
  varying vec2 vUv;
  varying float vFacing;
  void main() {
    vUv = uv;
    vec3 p = position;
    float h = uv.y;
    float a = uTwist * h + uTime * 0.6;
    float c = cos(a), s = sin(a);
    p.xz = mat2(c, -s, s, c) * p.xz;
    p.xz *= 1.0 + 0.08 * sin(uTime * 3.1 + h * 9.0 + uv.x * 18.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;

const VORTEX_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uSpin;
  uniform float uAlpha;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  varying vec2 vUv;
  varying float vFacing;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float h = vUv.y;
    vec2 q = vec2(vUv.x * 7.0 + h * 3.0 + uTime * uSpin, h * 3.4 - uTime * 1.9);
    float n = noise(q) * 0.62 + noise(q * 2.3 + 4.1) * 0.38;
    float tongue = smoothstep(0.32 + 0.45 * h, 0.9, n);
    float fade = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.45, 1.0, h));
    float k = tongue * fade * (0.45 + 0.55 * vFacing);
    vec3 col = mix(uLow, uHigh, smoothstep(0.55, 0.95, n) * (1.0 - h * 0.6));
    gl_FragColor = vec4(col * (1.0 + 2.2 * k), min(1.0, k * uAlpha * 1.35));
  }
`;

function vortexMaterial(name: string, spin: number, twist: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms: {
      uTime: { value: 0 },
      uSpin: { value: spin },
      uTwist: { value: twist },
      uAlpha: { value: 0 },
      uLow: { value: new THREE.Color(0xff4a08) },
      uHigh: { value: new THREE.Color(0xffd27a) },
    },
    vertexShader: VORTEX_VERT,
    fragmentShader: VORTEX_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
}

// ---- scratch (no allocation a frame) -------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _state = { phase: 0, stage: 0, fill: 0 };
const _orbit = { x: 0, y: 0, z: 0, size: 1, spin: 0 };
const _dir: [number, number, number] = [0, 1, 0];

/** The per-frame puffs' options, written in place. */
const FLAME = {
  speed: 0.8,
  up: 5,
  life: 0.55,
  size: [3, 0.6] as [number, number],
  color: C.flameHeat as readonly [number, number, number],
  alpha: 1,
  pool: 'pyre' as const,
  radius: 0.5,
};
const EMBER = {
  speed: 1.6,
  up: 4,
  life: 1.4,
  size: [0.32, 0.06] as [number, number],
  color: C.ember as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 1.2,
  drag: 0.6,
};
const SMOKE = {
  speed: 0.8,
  up: 3.2,
  life: 3.2,
  size: [3.5, 9] as [number, number],
  color: C.smoke as readonly [number, number, number],
  alpha: 0.32,
  drag: 0.7,
  radius: 1,
};
const HAZE = {
  speed: 0.4,
  up: 2.6,
  life: 1.8,
  size: [4, 9] as [number, number],
  color: C.haze as readonly [number, number, number],
  alpha: 0.05,
  drag: 0.8,
  radius: 2,
};
const CHURN = {
  speed: 2.4,
  up: 4,
  life: 0.8,
  size: [0.9, 0.25] as [number, number],
  color: C.lava as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  gravity: 12,
  radius: 0.4,
};
const DRAW_IN = {
  speed: 6,
  life: 0.5,
  size: [0.5, 0.12] as [number, number],
  color: C.spark as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  dir: _dir,
  spread: 0.08,
  drag: 0,
};

interface Flash {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  born: number;
  life: number;
  size: number;
}

export class HeatBody {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  /** Live socket places this frame (world), in HEAT_SOCKETS order. */
  private readonly sock: THREE.Vector3[] = HEAT_SOCKETS.map(() => new THREE.Vector3());
  private readonly vortexOuter: THREE.Mesh;
  private readonly vortexInner: THREE.Mesh;
  private readonly vortexOuterMat: THREE.ShaderMaterial;
  private readonly vortexInnerMat: THREE.ShaderMaterial;
  private readonly eyes: THREE.Sprite[] = [];
  private readonly eyeMat: THREE.SpriteMaterial;
  private readonly heart: THREE.Sprite;
  private readonly heartMat: THREE.SpriteMaterial;
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly fistOrb: THREE.Sprite;
  private readonly fistOrbMat: THREE.SpriteMaterial;
  private readonly gather: THREE.Sprite;
  private readonly gatherMat: THREE.SpriteMaterial;
  private readonly flashes: Flash[] = [];
  private readonly rocks: THREE.InstancedMesh;
  private readonly rockCount: number;
  private readonly glowTex: THREE.Texture | null;
  private entityId = -1;
  private rosterSeen = Number.NaN;
  private yaw = 0;
  private lavaY = 0;
  private stageSeen = -1;
  private phase = 1;
  private under = false;
  /** Seconds the body has spent climbing back out (rocks and fire return). */
  private outFor = 99;
  private castAt = -99;
  private lastCastGesture = -99;
  private castReleased = true;
  private readonly swings: number[] = [];
  private breachAt = -1;
  private slumpAt = -1;
  private deadAt = -1;
  private seenAlive = false;
  private gestureTimer = 0;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x5e7a;
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
    this.root.name = 'smith-heart-heat-body';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.35;
    this.rockCount = detail ? HEAT_BODY_POOLS.rocks : HEAT_ROCKS_LOW;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
      // Its own rungs of the Heat's floor ladder (never a tie with the
      // fight's floor marks under it).
      heatParticleSteps('heat_body'),
    );
    // The vortex of fire where the body meets the lava: two twisting sheaths,
    // counter-spun, flaring at the wellspring and wrapping the vortex to the belt.
    const outerGeo = new THREE.CylinderGeometry(2.9, 3.3, 6.5, 32, 6, true).translate(0, 3.25, 0);
    const innerGeo = new THREE.CylinderGeometry(2.3, 2.1, 4.8, 28, 5, true).translate(0, 2.4, 0);
    this.geometries.push(outerGeo, innerGeo);
    this.vortexOuterMat = vortexMaterial('smithHeartHeatVortexOuter', 0.9, 2.2);
    this.vortexInnerMat = vortexMaterial('smithHeartHeatVortexInner', -1.4, -2.8);
    this.vortexOuter = new THREE.Mesh(outerGeo, this.vortexOuterMat);
    this.vortexInner = new THREE.Mesh(innerGeo, this.vortexInnerMat);
    for (const m of [this.vortexOuter, this.vortexInner]) {
      m.name = 'smithHeartHeatVortex';
      m.frustumCulled = false;
      m.visible = false;
      this.root.add(m);
    }
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
    this.eyeMat = sprite(C.eye, 0, 'smithHeartHeatEye');
    this.heartMat = sprite(C.core, 0, 'smithHeartHeatHeart');
    this.haloMat = sprite(C.glow, 0, 'smithHeartHeatHalo');
    this.fistOrbMat = sprite(C.core, 0, 'smithHeartHeatFistOrb');
    this.gatherMat = sprite(C.core, 0, 'smithHeartHeatGather');
    this.materials.push(
      this.vortexOuterMat,
      this.vortexInnerMat,
      this.eyeMat,
      this.heartMat,
      this.haloMat,
      this.fistOrbMat,
      this.gatherMat,
    );
    const mk = (mat: THREE.SpriteMaterial, name: string) => {
      const s = new THREE.Sprite(mat);
      s.name = name;
      s.visible = false;
      this.root.add(s);
      return s;
    };
    for (let i = 0; i < 2; i++) this.eyes.push(mk(this.eyeMat, 'smithHeartHeatEye'));
    this.heart = mk(this.heartMat, 'smithHeartHeatHeart');
    this.halo = mk(this.haloMat, 'smithHeartHeatHalo');
    this.fistOrb = mk(this.fistOrbMat, 'smithHeartHeatFistOrb');
    this.gather = mk(this.gatherMat, 'smithHeartHeatGather');
    for (let i = 0; i < HEAT_BODY_POOLS.flashes; i++) {
      const mat = sprite(0xffe2a0, 0, 'smithHeartHeatFlash');
      this.materials.push(mat);
      this.flashes.push({
        sprite: mk(mat, 'smithHeartHeatFlash'),
        mat,
        born: -99,
        life: 0,
        size: 1,
      });
    }
    // The molten rocks circling it: rough chunks of dark basalt, unlit (the
    // Hearth's warm light and haze never wash them out), trailing embers.
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rp = rockGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const k = 0.75 + 0.5 * heatBodyHash(i, 29);
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.85, rp.getZ(i) * k);
    }
    this.geometries.push(rockGeo);
    const rockMat = new THREE.MeshBasicMaterial({
      color: C.rock,
      fog: false,
      name: 'smithHeartHeatRock',
    });
    this.materials.push(rockMat);
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, HEAT_BODY_POOLS.rocks);
    this.rocks.name = 'smithHeartHeatRocks';
    this.rocks.frustumCulled = false;
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < HEAT_BODY_POOLS.rocks; i++)
      this.rocks.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.rocks.visible = false;
    this.root.add(this.rocks);
    // Hidden carriers so the gate links every shader before the first frame
    // that draws it (the sprites and the rocks are their own carriers).
    const carrierGeo = new THREE.BufferGeometry();
    carrierGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrierGeo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    carrierGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    this.geometries.push(carrierGeo);
    for (const m of [this.vortexOuterMat, this.vortexInnerMat]) {
      const carrier = new THREE.Mesh(carrierGeo, m);
      carrier.visible = false;
      carrier.frustumCulled = false;
      carrier.name = 'smithHeartHeatCarrier';
      this.root.add(carrier);
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 60): void {
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
      // A plain swing: its fist meets the shore on the clip's contact beat.
      if (this.swings.length < 4) this.swings.push(this.clock + HEAT_BODY_CLIP.attack);
    } else if (ev.type === 'spellfxAt' && ev.ability === HEAT_CUES.fist) {
      // Basalt Fist lands on its bar's end: the body's fist comes down with it.
      this.slamImpact();
    } else if (
      (ev.type === 'spellfx' &&
        ev.sourceId === this.entityId &&
        (ev.ability === HEAT_CUES.flare || ev.ability === HEAT_CUES.ignite)) ||
      (ev.type === 'spellfxAt' && ev.ability === HEAT_CUES.seed)
    ) {
      this.castGesture();
    }
    return false;
  }

  private castGesture(): void {
    if (this.under || this.deadAt >= 0) return;
    if (this.clock - this.lastCastGesture < HEAT_CAST_GAP) return;
    this.lastCastGesture = this.clock;
    this.castAt = this.clock;
    this.castReleased = false;
    this.send(HEAT_BODY_GESTURES.cast);
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
      retryHeatBodySockets();
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
      this.yaw = e.facing;
      this.deadAt = -1;
      this.slumpAt = -1;
      this.seenAlive = false;
      this.swings.length = 0;
      this.stageSeen = -1;
      this.castAt = -99;
      this.castReleased = true;
      this.breachAt = -1;
      this.root.visible = true;
      break;
    }
  }

  private release(): void {
    this.entityId = -1;
    this.rosterSeen = Number.NaN;
    this.root.visible = false;
    this.hideBody();
  }

  private hideBody(): void {
    this.vortexOuter.visible = false;
    this.vortexInner.visible = false;
    this.rocks.visible = false;
    for (const s of this.eyes) s.visible = false;
    this.heart.visible = false;
    this.halo.visible = false;
    this.fistOrb.visible = false;
    this.gather.visible = false;
  }

  // ---- the sockets -------------------------------------------------------------------------

  /** Where each socket is this frame: the model's own bones when its view is
   *  up, else its rest place round the guardian (a view still loading). */
  private readSockets(e: Entity): void {
    const set = heatBodySockets();
    const eAt = fxAnchor(e);
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    for (let i = 0; i < HEAT_SOCKETS.length; i++) {
      const p = set?.points[i];
      if (p) {
        p.getWorldPosition(this.sock[i]);
        continue;
      }
      const at = HEAT_SOCKETS[i].at;
      const x = at[0] * HEAT_YD_PER_UNIT;
      const z = at[2] * HEAT_YD_PER_UNIT;
      this.sock[i].set(
        eAt.x + x * cosY + z * sinY,
        eAt.y + (at[1] - HEAT_MODEL_LAVA) * HEAT_YD_PER_UNIT,
        eAt.z - x * sinY + z * cosY,
      );
    }
  }

  // ---- the pose ------------------------------------------------------------------------------

  private pose(e: Entity, dt: number): void {
    const eAt = fxAnchor(e);
    this.lavaY = eAt.y;
    this.yaw += wrapAngle(e.facing - this.yaw) * Math.min(1, dt * 5);
    this.readSockets(e);
    if (e.dead) {
      this.poseDead(e, dt);
      return;
    }
    if (this.deadAt >= 0) {
      // Revived (a reset): the fire comes back.
      this.deadAt = -1;
      this.slumpAt = -1;
    }
    this.seenAlive = true;
    const st = heatBodyState(e.auras, _state);
    this.phase = Math.max(1, st.phase);
    if (st.stage !== this.stageSeen) {
      const prev = this.stageSeen;
      this.send(heatStanceGesture(st.stage, prev));
      if (prev >= 0 && st.stage === HEAT_STAGES.sinking) this.erupt(eAt.x, eAt.z, 1.2, false);
      if (prev >= 0 && st.stage === HEAT_STAGES.rising) {
        this.erupt(eAt.x, eAt.z, 0.8, false);
        this.breachAt = this.clock + HEAT_BODY_CLIP.riseBreach;
      }
      if (st.stage === HEAT_STAGES.fight) this.outFor = prev < 0 ? 99 : 0;
      this.stageSeen = st.stage;
      this.gestureTimer = 1;
    }
    // Re-sent for a view rebuilt mid-stage (idempotent: the stance held).
    this.gestureTimer -= dt;
    if (this.gestureTimer <= 0) {
      this.gestureTimer = 1;
      this.send(heatStanceGesture(st.stage, st.stage));
    }
    this.under = st.stage === HEAT_STAGES.under || st.stage === HEAT_STAGES.sinking;
    if (st.stage === HEAT_STAGES.rising) this.outFor = st.fill * 3;
    else if (st.stage === HEAT_STAGES.fight) this.outFor += dt;
    if (this.breachAt > 0 && this.clock >= this.breachAt) {
      this.breachAt = -1;
      this.erupt(eAt.x, eAt.z, 1.5, true);
    }
    // The plain swings' fists land.
    for (let i = this.swings.length - 1; i >= 0; i--) {
      if (this.clock < this.swings[i]) continue;
      this.swings.splice(i, 1);
      const fi = this.sock[S_FIST_L].y < this.sock[S_FIST_R].y ? S_FIST_L : S_FIST_R;
      const f = this.sock[fi];
      this.impact(f.x, Math.max(f.y, this.lavaY), f.z, 1);
    }
    const casting = e.castingAbility === HEAT_CASTS.fist;
    const fill = e.castTotal > 0 ? Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal)) : 0;
    this.burn(st.stage, dt, 1);
    this.vortex(eAt, dt, this.under ? 0.55 : 1);
    this.lights(1, casting ? fill : -1);
    this.castFx(dt);
    if (casting) this.chargeFist(fill, dt);
    this.orbitRocks(eAt, 1);
  }

  /** The flames, embers, smoke and haze off the body, the lava churning at
   *  its foot (cosmetic, thinned on the low tier). `k` the fire's strength. */
  private burn(stage: number, dt: number, k: number): void {
    const d = this.density;
    const lava = this.lavaY + 0.4;
    const out = Math.min(1, this.outFor / 1.5);
    const rate = heatFlameRate(this.phase, this.under) * d * k * (0.35 + 0.65 * out);
    let n = rate * dt;
    while (n > 0) {
      if (n < 1 && this.rand() > n) break;
      n -= 1;
      const f = heatFlameFor(this.rand());
      const p = this.sock[heatSocketIndex(f.socket)];
      if (p.y < lava) continue;
      FLAME.size[0] = f.size * (1.1 + 0.5 * this.rand());
      FLAME.size[1] = f.size * 0.2;
      FLAME.up = f.up;
      FLAME.color = this.rand() < 0.2 + 0.12 * this.phase ? C.flameHot : C.flameHeat;
      this.particles.puff(p.x, p.y, p.z, 1, FLAME);
    }
    if (stage !== HEAT_STAGES.under && this.rand() < dt * 26 * d * k) {
      const p = this.sock[Math.floor(this.rand() * this.sock.length)];
      if (p.y > lava) this.particles.puff(p.x, p.y, p.z, 1, EMBER);
    }
    if (!this.under && this.rand() < dt * 5 * d * k) {
      const p = this.sock[SMOKE_SOCKETS[Math.floor(this.rand() * SMOKE_SOCKETS.length)]];
      this.particles.puff(p.x, p.y + 2, p.z, 1, SMOKE);
    }
    if (d >= 1 && !this.under && this.rand() < dt * 4 * k) {
      const p = this.sock[S_BACK];
      this.particles.puff(p.x, p.y + 4, p.z, 1, HAZE);
    }
    // The lava churning where it stands: bubbles thrown up round its foot.
    if (this.rand() < dt * (this.under ? 30 : 14) * d) {
      const a = this.rand() * Math.PI * 2;
      const r = 1.5 + this.rand() * 3.5;
      const v = this.sock[heatSocketIndex('vortexMid')];
      this.particles.puff(v.x + Math.cos(a) * r, this.lavaY + 0.2, v.z + Math.sin(a) * r, 1, CHURN);
    }
  }

  /** The vortex of fire round its lower body, flaring at the lava. */
  private vortex(eAt: { x: number; y: number; z: number }, dt: number, alpha: number): void {
    const v = this.sock[heatSocketIndex('vortexMid')];
    const x = this.under ? eAt.x : v.x;
    const z = this.under ? eAt.z : v.z;
    const a = alpha * (0.85 + 0.15 * Math.sin(this.clock * 2.3));
    this.vortexLayer(this.vortexOuter, this.vortexOuterMat, x, z, dt * 0.5, a);
    this.vortexLayer(this.vortexInner, this.vortexInnerMat, x, z, dt * -0.8, a);
    // Under the lava the sheath squats into a boiling ring.
    const sq = this.under ? 0.45 : 1;
    this.vortexOuter.scale.set(1, sq, 1);
    this.vortexInner.scale.set(1, sq, 1);
  }

  private vortexLayer(
    mesh: THREE.Mesh,
    mat: THREE.ShaderMaterial,
    x: number,
    z: number,
    spin: number,
    alpha: number,
  ): void {
    mesh.position.set(x, this.lavaY - 0.4, z);
    mesh.rotation.y += spin;
    mat.uniforms.uTime.value = this.clock;
    mat.uniforms.uAlpha.value = alpha;
    mesh.visible = alpha > 0.01;
  }

  /** The eyes, the heart's ring, the heat glow round it and Basalt Fist's
   *  gathering fist (`charge` its bar, -1 none). */
  private lights(k: number, charge: number): void {
    const shown = !this.under && k > 0.02;
    const flick = 0.9 + 0.1 * Math.sin(this.clock * 13.7) * Math.sin(this.clock * 5.3);
    for (let i = 0; i < 2; i++) {
      const p = this.sock[i === 0 ? S_EYE_L : S_EYE_R];
      this.eyes[i].position.copy(p);
      this.eyes[i].scale.set(1.6, 1.6, 1);
      this.eyes[i].visible = shown;
    }
    this.eyeMat.opacity = k * flick;
    const h = this.sock[S_HEART];
    this.heart.position.copy(h);
    const hs = (3.2 + 0.5 * Math.sin(this.clock * 2.2)) * (0.6 + 0.4 * k);
    this.heart.scale.set(hs, hs, 1);
    this.heartMat.opacity = 0.85 * k;
    this.heart.visible = shown;
    // The heat round it: a broad soft glow behind the chest.
    const b = this.sock[S_BACK];
    this.halo.position.set(b.x, b.y - 1, b.z);
    this.halo.scale.set(18, 20, 1);
    this.haloMat.opacity = 0.08 * k;
    this.halo.visible = shown && this.density >= 1;
    if (charge >= 0 && shown) {
      const f = this.sock[S_FIST_R];
      this.fistOrb.position.copy(f);
      const s = 2.2 + 3 * charge;
      this.fistOrb.scale.set(s, s, 1);
      this.fistOrbMat.opacity = 0.3 + 0.5 * charge;
      this.fistOrb.visible = true;
    } else {
      this.fistOrbMat.opacity = 0;
      this.fistOrb.visible = false;
    }
  }

  /** Basalt Fist's bar: fire drawn into its right fist, its flames roaring. */
  private chargeFist(fill: number, dt: number): void {
    const f = this.sock[S_FIST_R];
    this.drawInto(f, 4 + 3 * fill, dt * (20 + 50 * fill) * this.density);
    if (this.rand() < dt * 40 * fill * this.density) {
      FLAME.size[0] = 3 + 3 * fill;
      FLAME.size[1] = 0.6;
      FLAME.up = 6;
      FLAME.color = C.flameHot;
      this.particles.puff(f.x, f.y, f.z, 1, FLAME);
    }
  }

  /** Sparks streaming into `p` from a ring `r` yards out. */
  private drawInto(p: THREE.Vector3, r: number, rate: number): void {
    let n = rate;
    while (n > 0) {
      if (n < 1 && this.rand() > n) break;
      n -= 1;
      _a.set(this.rand() - 0.5, this.rand() - 0.5, this.rand() - 0.5)
        .normalize()
        .multiplyScalar(r);
      _dir[0] = -_a.x / r;
      _dir[1] = -_a.y / r;
      _dir[2] = -_a.z / r;
      DRAW_IN.speed = r / DRAW_IN.life;
      this.particles.puff(p.x + _a.x, p.y + _a.y, p.z + _a.z, 1, DRAW_IN);
    }
  }

  /** The cast: fire gathered between the hands, then thrown out before it. */
  private castFx(dt: number): void {
    const age = this.clock - this.castAt;
    const look = heatCastLook(age);
    if (look.done || age < 0 || this.under) {
      this.gather.visible = false;
      this.gatherMat.opacity = 0;
      return;
    }
    const l = this.sock[S_FIST_L];
    const r = this.sock[S_FIST_R];
    _b.addVectors(l, r).multiplyScalar(0.5);
    if (look.gather > 0) {
      this.gather.position.copy(_b);
      const s = 1.5 + 6 * look.gather;
      this.gather.scale.set(s, s, 1);
      this.gatherMat.opacity = 0.3 + 0.65 * look.gather;
      this.gather.visible = true;
      this.drawInto(_b, 5, dt * 60 * look.gather * this.density);
    } else {
      this.gather.visible = false;
      this.gatherMat.opacity = 0;
    }
    if (!this.castReleased && look.release > 0) {
      this.castReleased = true;
      this.flash(_b.x, _b.y, _b.z, 14, 0.4);
      _dir[0] = Math.sin(this.yaw);
      _dir[1] = 0.12;
      _dir[2] = Math.cos(this.yaw);
      this.particles.puff(_b.x, _b.y, _b.z, 36, {
        speed: 16,
        life: 0.6,
        size: [3.2, 0.8],
        color: C.flameHot,
        alpha: 1,
        pool: 'pyre',
        dir: _dir,
        spread: 0.3,
      });
      this.particles.puff(_b.x, _b.y, _b.z, 30, {
        speed: 14,
        life: 0.9,
        size: [0.45, 0.08],
        color: C.spark,
        alpha: 1,
        pool: 'glow',
        dir: _dir,
        spread: 0.5,
        gravity: 4,
      });
    }
  }

  /** The molten rocks circling it (sunk away while it is under; `k` 1 shown). */
  private orbitRocks(eAt: { x: number; y: number; z: number }, k: number): void {
    const out = this.under ? 0 : Math.min(1, this.outFor / 2);
    const show = out * k;
    this.rocks.visible = show > 0.01;
    if (!this.rocks.visible) return;
    for (let i = 0; i < HEAT_BODY_POOLS.rocks; i++) {
      if (i >= this.rockCount) {
        this.rocks.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      const o = heatRockOrbit(i, this.clock, _orbit);
      const y = this.lavaY + o.y * show - (1 - show) * 2;
      _a.set(eAt.x + o.x, y, eAt.z + o.z);
      _q.setFromEuler(_e.set(o.spin, o.spin * 0.7, o.spin * 0.3));
      _s.setScalar(o.size * show);
      this.rocks.setMatrixAt(i, _m.compose(_a, _q, _s));
      if (this.rand() < 0.06 * this.density) this.particles.puff(_a.x, _a.y, _a.z, 1, EMBER);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
  }

  // ---- the bursts ------------------------------------------------------------------------------

  private flash(x: number, y: number, z: number, size: number, life: number): void {
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
      const s = f.size * (0.6 + 0.6 * t);
      f.sprite.scale.set(s, s, 1);
      f.mat.opacity = (1 - t) ** 1.5;
    }
  }

  /** A fist slammed on the shore: the lava thrown up, flame, a shockwave, smoke. */
  private impact(x: number, y: number, z: number, big: number): void {
    const gy = Math.max(y, this.groundY(x, z));
    this.particles.puff(x, gy + 0.3, z, Math.round(40 * big), {
      speed: 9 * big,
      up: 9,
      life: 1.1,
      size: [1.2, 0.3],
      color: C.lava,
      alpha: 1,
      pool: 'glow',
      gravity: 18,
      radius: 1.5 * big,
    });
    this.particles.puff(x, gy + 0.5, z, Math.round(18 * big), {
      speed: 3.5 * big,
      up: 6,
      life: 0.7,
      size: [4 * big, 1],
      color: C.flameHot,
      alpha: 1,
      pool: 'pyre',
      radius: 1.8 * big,
    });
    this.particles.puff(x, gy + 0.6, z, Math.round(12 * big), {
      speed: 2.5 * big,
      up: 2.2,
      life: 2.4,
      size: [3.5 * big, 8 * big],
      color: C.smoke,
      alpha: 0.38,
      drag: 1,
      radius: 2 * big,
    });
    this.particles.puff(x, gy + 0.4, z, Math.round(26 * big), {
      speed: 13 * big,
      up: 5,
      life: 0.8,
      size: [0.4, 0.07],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
      gravity: 12,
    });
    this.particles.shockRing(x, z, C.glow, 11 * big, 0.75);
    this.particles.shockRing(x, z, C.core, 6 * big, 0.4);
    this.flash(x, gy + 1.2, z, 9 * big, 0.32);
    this.shakeNear(x, z, 0.45 * big);
  }

  /** Basalt Fist lands: its right fist comes down on the bar's end. */
  private slamImpact(): void {
    if (this.entityId < 0 || this.under) return;
    const f = this.sock[S_FIST_R];
    this.impact(f.x, Math.max(f.y, this.lavaY), f.z, 1.6);
  }

  /** It plunges under or breaches the wellspring: lava erupting round it. */
  private erupt(x: number, z: number, big: number, breach: boolean): void {
    const y = this.lavaY + 0.3;
    this.particles.puff(x, y, z, Math.round(70 * big), {
      speed: 8 * big,
      up: breach ? 18 : 13,
      life: 1.4,
      size: [1.5, 0.4],
      color: C.lava,
      alpha: 1,
      pool: 'glow',
      gravity: 15,
      radius: 3.5,
    });
    this.particles.puff(x, y + 1, z, Math.round(40 * big), {
      speed: 4,
      up: breach ? 12 : 8,
      life: 0.9,
      size: [6, 1.5],
      color: C.flameHot,
      alpha: 1,
      pool: 'pyre',
      radius: 4,
    });
    this.particles.puff(x, y + 2, z, Math.round(24 * big), {
      speed: 2,
      up: 4,
      life: 3.6,
      size: [5, 13],
      color: C.smoke,
      alpha: 0.42,
      drag: 0.7,
      radius: 4,
    });
    this.particles.shockRing(x, z, C.glow, 22 * big, 1.1);
    this.particles.shockRing(x, z, C.core, 12 * big, 0.6);
    this.flash(x, y + 5, z, 18 * big, 0.45);
    this.shakeNear(x, z, 0.7 * big, 70);
  }

  // ---- the death -----------------------------------------------------------------------------

  private poseDead(e: Entity, dt: number): void {
    const eAt = fxAnchor(e);
    if (this.deadAt < 0) {
      this.deadAt = this.seenAlive ? this.clock : this.clock - 10;
      this.slumpAt = this.seenAlive ? this.clock + HEAT_BODY_CLIP.deathSlump : -1;
      this.swings.length = 0;
      this.castAt = -99;
      if (this.seenAlive) {
        const h = this.sock[S_HEART];
        this.flash(h.x, h.y, h.z, 20, 0.6);
        this.particles.puff(h.x, h.y, h.z, 60, {
          speed: 9,
          up: 4,
          life: 1.6,
          size: [0.5, 0.08],
          color: C.spark,
          alpha: 1,
          pool: 'glow',
          gravity: 5,
          radius: 2,
        });
        this.particles.shockRing(eAt.x, eAt.z, C.glow, 18, 1);
        this.shakeNear(eAt.x, eAt.z, 0.6);
      }
    }
    const t = this.clock - this.deadAt;
    if (this.slumpAt > 0 && this.clock >= this.slumpAt) {
      // It crashes down on the wellspring.
      this.slumpAt = -1;
      const h = this.sock[S_HEART];
      this.impact(h.x, this.lavaY, h.z, 1.4);
    }
    const look = heatDeathLook(t);
    this.under = false;
    this.burn(HEAT_STAGES.fight, dt, look.flame);
    // The flame sinking out of it in smoke.
    if (look.smoke > 0 && this.rand() < dt * 20 * look.smoke * this.density) {
      const p = this.sock[Math.floor(this.rand() * this.sock.length)];
      this.particles.puff(p.x, p.y + 1, p.z, 1, SMOKE);
    }
    this.vortex(eAt, dt, look.glow * 0.8);
    this.lights(look.glow, -1);
    this.gather.visible = false;
    this.orbitRocks(eAt, look.glow);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.rocks.dispose();
    this.glowTex?.dispose();
    clearHeatBodySockets();
  }
}
