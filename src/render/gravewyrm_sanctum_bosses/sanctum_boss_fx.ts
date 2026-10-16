// The Gravewyrm Sanctum's three boss fights, drawn (plan: boss_fx_core.ts,
// art: sanctum_boss_art.ts). Hosted by render/rift_death_zone.ts.
//  - Korgath the Bound: his four seal chains as iron ropes from his harness
//    rings (the live rig's Anchor_* bones) to their shackles, taut and frosted,
//    burning the Smith's blue while he Strains; a break whips the chain loose in
//    a spray of frost (and shows the model's broken arm chain); the shackles
//    glow blue to goad red with their health; Strain's rings at the intact
//    pillars, the Stomp ring, the Maul Arc, the Flail and Charge lanes, the
//    Bellow's shove wave.
//  - Velkhar: the pyre about to flare (a column of soulfire over its pool), the
//    trench lane and then its meltwater strip (black steaming water with a
//    violet-green rim), the Held statues and the Unquenched bubble rings, the
//    heroic warm puddles, the Shadow Volley's wave.
//  - Korzul: the nineteen plates (sound, a glowing fracture web with its frost
//    ring closing as it refreezes, open quench-water with floes; the sinking is
//    render only), the breath cone with the plates it will burn flashing, the
//    tail cone, the Inferno ring flooding pulse by pulse, Doused's steam wall,
//    the Wyrm's Eye over the marked and their plate's warning, the Plunging
//    Fire's whole-plate glow, the landing shadow, steam on swimmers.
// The telegraphs are ACTIONABLE: the shared kit (TelegraphKit), the threat
// palette, drawn on every tier; glows, particles and the chains' runes thin on
// the low tier through `density`. Every mesh and material is built once in the
// constructor under one root attached through the compile gate; no light.
// State comes only from IWorld entities and events (offline and online alike).

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { SEAL_PILLARS } from '../../sim/content/gravewyrm_sanctum_layout';
import {
  KORGATH_BELLOW,
  KORGATH_CHAIN_BREAK,
  KORGATH_CHAIN_FLAIL,
  KORGATH_ENRAGE,
  KORGATH_ID,
  KORGATH_MAUL_ARC,
  KORGATH_REACH,
  KORGATH_RERIVETED,
  KORGATH_STOMP,
  KORGATH_STRAIN,
  KORGATH_THRESHOLD_CHARGE,
  KORGATH_TUNING,
  KORZUL_AIRBORNE,
  KORZUL_BREAK_FREE,
  KORZUL_BROOD,
  KORZUL_CRASHING_DESCENT,
  KORZUL_DOUSED,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_ID,
  KORZUL_PLUNGING_FIRE,
  KORZUL_SHARD_FLARE,
  KORZUL_TOUCHDOWN,
  KORZUL_TUNING,
  KORZUL_WING_GALE,
  KORZUL_WYRMS_EYE,
  SANCTUM_HELD_STATUE,
  SANCTUM_LANDING_SHADOW,
  SANCTUM_MELT_STRIP,
  SANCTUM_PLUNGING_FIRE,
  SANCTUM_PYRE_FLARE,
  SANCTUM_QUENCH_WATER,
  SANCTUM_TRENCH_LANE,
  SANCTUM_UNQUENCHED_RING,
  SANCTUM_WARM_PUDDLE,
  SEAL_SHACKLE_IDS,
  SEAL_TOOLS,
  type SealTool,
  sanctumStoryStepOf,
  sealChainOf,
  VELKHAR_HELD,
  VELKHAR_ID,
  VELKHAR_SHADOW_VOLLEY,
  VELKHAR_SOULFIRE_TRENCH,
  VELKHAR_TITHE,
  VELKHAR_TUNING,
  VELKHAR_UNQUENCHED,
  VELKHAR_WAKING_THAW,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import {
  KORZUL_EMERGE_RISE_AT,
  KORZUL_EMERGE_SECONDS,
} from '../../sim/encounters/gravewyrm_sanctum/korzul_emerge_plan';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  TELEGRAPH_ACCENTS,
  TELEGRAPH_THREAT_COLORS,
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GHOST_RAMP,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import {
  breathPlates,
  chainPoint,
  chainWhipReach,
  emergeCuesBetween,
  emergeShadow,
  infernoLevel,
  type PlateSpot,
  plateLook,
  plateShock,
  plateUnder,
  refreezeShown,
  SANCTUM_CAST_SPECS,
  SANCTUM_COLORS,
  shackleGlow,
  shadowGrowth,
  specColor,
  specYaw,
  TOUCHDOWN_SHOCK_REACH,
  unquenchedLeft,
} from './boss_fx_core';
import {
  heartbeatEvery,
  KORGATH_ANCHOR_REST,
  KORGATH_ANCHORS,
  KORGATH_BROKEN_CHAIN_MESH,
  KORGATH_BROKEN_GESTURE,
  KORGATH_RUNES_GESTURE,
  KORGATH_WHOLE_GESTURE,
  KORZUL_BODY,
  KORZUL_BURST_AT,
  KORZUL_EMERGE_LAND_GESTURE,
  KORZUL_FROZEN_STANCE,
  KORZUL_HEARTBEAT_FLARE_GESTURE,
  KORZUL_HEARTBEAT_GESTURE,
  KORZUL_HIDE_GESTURE,
  KORZUL_MOUTH_REST,
  KORZUL_SHOW_GESTURE,
  KORZUL_TAKEOFF_GESTURE,
  korzulBodyView,
  VELKHAR_FLAME_GESTURE,
  VELKHAR_FLAME_Y,
  VELKHAR_THAW_GESTURE,
} from './boss_model_core';
import {
  CHAIN_SEGMENTS,
  CHAIN_SIDES,
  chainGeometry,
  chainMaterial,
  heldStatueGeometry,
  iceMaterial,
  ironMaterial,
  meltMaterial,
  plateMaterial,
  ringMaterial,
  shackleGeometry,
  shadowMaterial,
  wyrmEyeTexture,
  wyrmFireFrag,
} from './sanctum_boss_art';

const SCAN_SEC = 0.1;
const GESTURE_SEC = 0.5;
const FAN_SLOTS = 6;
const PILLAR_SLOTS = 4;
const LANE_SLOTS = 4;
const OBJ_FAN_SLOTS = 6;
const PLATE_SLOTS = 19;
const STRIP_SLOTS = 6;
const PUDDLE_SLOTS = 8;
const RING_SLOTS = 14;
const BUBBLE_SLOTS = 6;
const STATUE_SLOTS = 12;
const EYE_SLOTS = 4;
/** A shackle cuff's height over the floor (where its chain is pinned). */
const SHACKLE_Y = 1.1;
const CHAIN_RADIUS = 0.16;

interface CastFan extends TelegraphFan {
  casterId: number;
  castId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  fill: number;
}
interface CastLane extends TelegraphLane {
  casterId: number;
  castId: string;
  objectId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  length: number;
  fill: number;
}
interface ObjFan extends TelegraphFan {
  objectId: number;
  templateId: string;
  born: number;
}
interface PlateSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  objectId: number;
  template: string;
  stepAt: number;
  state: number;
  refreeze: number | null;
  brokeAt: number;
  /** The touchdown's crack through it (render only). */
  shockAt: number;
  spot: PlateSpot;
}
interface MeltSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  objectId: number;
  born: number;
  gone: number;
}
interface RingSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  alive: boolean;
  born: number;
  span: number;
  from: number;
  to: number;
  alpha: number;
}
interface BubbleSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  objectId: number;
  born: number;
}
interface StatueSlot {
  mesh: THREE.Mesh;
  frost: THREE.Mesh;
  frostMat: THREE.ShaderMaterial;
  objectId: number;
  born: number;
}
interface ChainSlot {
  tool: SealTool;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  /** The cuff at the pillar's foot, whole or sundered. */
  cuff: THREE.Mesh;
  cuffOpen: THREE.Mesh;
  cuffMat: THREE.ShaderMaterial;
  objectId: number;
  broken: boolean;
  /** Seconds since the break (the whip plays over the first 0.8). */
  whipAt: number;
  flashAt: number;
  anchor: THREE.Object3D | null;
}

const SCRATCH: ParticleSpec = {
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

function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export class SanctumBossFx {
  private readonly root = new THREE.Group();
  private readonly kit: TelegraphKit;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly casts: CastFan[] = [];
  private readonly pillars: TelegraphFan[] = [];
  private readonly lanes: CastLane[] = [];
  private readonly objFans: ObjFan[] = [];
  private readonly plates: PlateSlot[] = [];
  private readonly strips: MeltSlot[] = [];
  private readonly puddles: MeltSlot[] = [];
  private readonly rings: RingSlot[] = [];
  private readonly bubbles: BubbleSlot[] = [];
  private readonly statues: StatueSlot[] = [];
  private readonly chains: ChainSlot[] = [];
  private readonly eyes: THREE.Sprite[] = [];
  private readonly shadow: THREE.Mesh;
  private readonly shadowMat: THREE.ShaderMaterial;
  private readonly fire: ParticlePool;
  private readonly soulfire: ParticlePool;
  private readonly glow: ParticlePool;
  private readonly mist: ParticlePool;
  private clock = 0;
  private scan = 0;
  private gestureClock = 0;
  private seed = 0x5a17c0de;
  private disposed = false;
  private korgathId = -1;
  private velkharId = -1;
  private korzulId = -1;
  private storyStep = 0;
  /** Korzul views we froze (only those are told to break free). */
  private readonly frozenSent = new Set<number>();
  /** Break Free's cinematic on screen: his id, the clock when the pull came
   *  (from the bar's elapsed time), the last clock its cues were played to. */
  private emerge: { id: number; t0: number; last: number } | null = null;
  private readonly airborne = new Set<number>();
  /** The bar each boss carried last frame (a new bar flares its glow). */
  private readonly lastBar = new Map<number, string | null>();
  private heartbeat = 0;
  private readonly flaresSeen = new Set<number>();
  private readonly objectsSeen = new Map<number, number>();
  /** The plates as spots, refreshed each scan (breath and eye reads). */
  private plateSpots: PlateSpot[] = [];
  /** The pillars' world centres (from the chain objects), by tool. */
  private readonly pillarAt = new Map<SealTool, { x: number; z: number }>();
  private readonly v = new THREE.Vector3();
  private readonly p = { x: 0, y: 0, z: 0 };
  readonly readyForEntry: Promise<void>;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shake?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'gravewyrm-sanctum-boss-fx';
    setRenderCategory(this.root, 'ui3d');
    const low =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.density = low ? 0.4 : 1;
    this.kit = new TelegraphKit(this.root, !low);
    for (let i = 0; i < FAN_SLOTS; i++)
      this.casts.push({
        ...this.kit.fan(18),
        casterId: -1,
        castId: '',
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        fill: 0,
      });
    for (let i = 0; i < PILLAR_SLOTS; i++) this.pillars.push(this.kit.fan(18));
    for (let i = 0; i < LANE_SLOTS; i++)
      this.lanes.push({
        ...this.kit.lane(17),
        casterId: -1,
        castId: '',
        objectId: -1,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        length: 0,
        fill: 0,
      });
    for (let i = 0; i < OBJ_FAN_SLOTS; i++)
      this.objFans.push({ ...this.kit.fan(19), objectId: -1, templateId: '', born: 0 });

    // The plates: a disc each (radius 1, scaled to the plate).
    const disc = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    for (let i = 0; i < PLATE_SLOTS; i++) {
      const mat = plateMaterial(this.uTime, i * 3.17 + 0.5, !low);
      this.materials.push(mat);
      const mesh = new THREE.Mesh(disc, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 2);
      this.root.add(mesh);
      this.plates.push({
        mesh,
        mat,
        objectId: -1,
        template: '',
        stepAt: 0,
        state: 0,
        refreeze: null,
        brokeAt: -99,
        shockAt: -99,
        spot: { id: -1, x: 0, z: 0, r: 8, state: 'sound' },
      });
    }
    // Meltwater: the strips (x -0.5..0.5, z 0..1) and the round puddles.
    const strip = new THREE.PlaneGeometry(1, 1, 1, 8).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.geometries.push(strip);
    for (let i = 0; i < STRIP_SLOTS; i++) {
      const mat = meltMaterial(this.uTime, false, SANCTUM_COLORS.soulViolet, i * 1.7);
      this.materials.push(mat);
      const mesh = new THREE.Mesh(strip, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 3);
      this.root.add(mesh);
      this.strips.push({ mesh, mat, objectId: -1, born: 0, gone: -1 });
    }
    for (let i = 0; i < PUDDLE_SLOTS; i++) {
      const mat = meltMaterial(this.uTime, true, SANCTUM_COLORS.soulfire, i * 2.3);
      this.materials.push(mat);
      const mesh = new THREE.Mesh(disc, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 3);
      this.root.add(mesh);
      this.puddles.push({ mesh, mat, objectId: -1, born: 0, gone: -1 });
    }
    for (let i = 0; i < RING_SLOTS; i++) {
      const mat = ringMaterial(true);
      this.materials.push(mat);
      const mesh = new THREE.Mesh(disc, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 5);
      this.root.add(mesh);
      this.rings.push({ mesh, mat, alive: false, born: 0, span: 1, from: 0, to: 1, alpha: 1 });
    }
    for (let i = 0; i < BUBBLE_SLOTS; i++) {
      const mat = ringMaterial(false);
      mat.uniforms.uBubbles.value = 1;
      mat.uniforms.uColor.value.setHex(SANCTUM_COLORS.soulViolet);
      mat.uniforms.uWidth.value = 0.16;
      this.materials.push(mat);
      const mesh = new THREE.Mesh(disc, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 4);
      this.root.add(mesh);
      this.bubbles.push({ mesh, mat, objectId: -1, born: 0 });
    }
    // The Held: rimed statues where the Bonewalkers fell on cold ice.
    const statueGeo = heldStatueGeometry();
    this.geometries.push(statueGeo);
    const ice = iceMaterial(0x9fd6ff);
    this.materials.push(ice);
    for (let i = 0; i < STATUE_SLOTS; i++) {
      const frostMat = ringMaterial(true);
      frostMat.uniforms.uColor.value.setHex(SANCTUM_COLORS.frost);
      frostMat.uniforms.uWidth.value = 0.3;
      this.materials.push(frostMat);
      const frost = new THREE.Mesh(disc, frostMat);
      frost.frustumCulled = false;
      frost.visible = false;
      frost.renderOrder = floorVfxRenderOrder('encounter', 4);
      const mesh = new THREE.Mesh(statueGeo, ice);
      mesh.visible = false;
      this.root.add(mesh, frost);
      this.statues.push({ mesh, frost, frostMat, objectId: -1, born: 0 });
    }
    // Korgath's four chains, and the glow at each shackle.
    const glowTex = typeof document !== 'undefined' ? radialGlowTexture() : null;
    const cuffGeo = shackleGeometry(false);
    const cuffOpenGeo = shackleGeometry(true);
    this.geometries.push(cuffGeo, cuffOpenGeo);
    for (const tool of SEAL_TOOLS) {
      const cuffMat = ironMaterial();
      this.materials.push(cuffMat);
      const cuff = new THREE.Mesh(cuffGeo, cuffMat);
      const cuffOpen = new THREE.Mesh(cuffOpenGeo, cuffMat);
      cuff.visible = false;
      cuffOpen.visible = false;
      this.root.add(cuff, cuffOpen);
      const geo = chainGeometry();
      this.geometries.push(geo);
      const mat = chainMaterial(this.uTime);
      this.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      const glowMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: SANCTUM_COLORS.smithBlue,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        name: 'sanctumShackleGlow',
      });
      this.materials.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.visible = false;
      this.root.add(mesh, glow);
      this.chains.push({
        tool,
        mesh,
        mat,
        glow,
        glowMat,
        cuff,
        cuffOpen,
        cuffMat,
        objectId: -1,
        broken: false,
        whipAt: -99,
        flashAt: -99,
        anchor: null,
      });
    }
    const eyeMat = new THREE.SpriteMaterial({
      map: wyrmEyeTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      name: 'sanctumWyrmsEye',
    });
    this.materials.push(eyeMat);
    for (let i = 0; i < EYE_SLOTS; i++) {
      const s = new THREE.Sprite(eyeMat);
      s.visible = false;
      s.renderOrder = floorVfxRenderOrder('encounter', 28);
      this.root.add(s);
      this.eyes.push(s);
    }
    this.shadowMat = shadowMaterial(this.uTime);
    this.materials.push(this.shadowMat);
    this.shadow = new THREE.Mesh(disc, this.shadowMat);
    this.shadow.frustumCulled = false;
    this.shadow.visible = false;
    this.shadow.renderOrder = floorVfxRenderOrder('encounter', 1);
    this.root.add(this.shadow);

    // Particles: the wyrm's fire, Velkhar's soulfire, glows and steam.
    const flameTex = typeof document !== 'undefined' ? getFlameTex() : null;
    const particleMat = (frag: string, vert: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        name: 'sanctumBossParticles',
        uniforms: { uTime: this.uTime, uTex: { value: flameTex } },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    const n = (base: number) => Math.round(base * this.density) + 80;
    this.fire = new ParticlePool(
      n(1600),
      particleMat(wyrmFireFrag(FIRE_FRAG, GHOST_RAMP), FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.soulfire = new ParticlePool(
      n(900),
      particleMat(FIRE_FRAG, FIRE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 26),
    );
    this.glow = new ParticlePool(
      n(1400),
      particleMat(GLOW_FRAG, PARTICLE_VERT, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 27),
    );
    this.mist = new ParticlePool(
      n(1100),
      particleMat(DUST_FRAG, PARTICLE_VERT, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 24),
    );
    for (const pool of [this.fire, this.soulfire, this.glow, this.mist]) {
      this.geometries.push(pool.mesh.geometry);
      this.root.add(pool.mesh);
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  // ---------------------------------------------------------------- helpers

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private entity(id: number): Entity | null {
    if (id < 0 || !this.world) return null;
    return this.world.entities.get(id) ?? null;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 45): void {
    if (!this.shake || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shake(amount * (1 - d / reach));
  }

  /** Spray `count` particles from a point (scaled by the tier's density). */
  private spray(
    pool: ParticlePool,
    count: number,
    x: number,
    y: number,
    z: number,
    o: {
      speed: number;
      up: number;
      spread?: number;
      life: number;
      size0: number;
      size1: number;
      color: number;
      alpha?: number;
      gravity?: number;
      drag?: number;
      dirX?: number;
      dirZ?: number;
      cone?: number;
    },
  ): void {
    const total = Math.max(1, Math.round(count * this.density * (this.reducedMotion() ? 0.5 : 1)));
    const [r, g, b] = rgb(o.color);
    const s = SCRATCH;
    for (let i = 0; i < total; i++) {
      let a = this.rand() * Math.PI * 2;
      if (o.dirX !== undefined && o.dirZ !== undefined) {
        const base = Math.atan2(o.dirX, o.dirZ);
        a = base + (this.rand() - 0.5) * (o.cone ?? 0.6);
      }
      const sp = o.speed * (0.4 + 0.6 * this.rand());
      const spread = o.spread ?? 0.4;
      s.x = x + (this.rand() - 0.5) * spread;
      s.y = y + this.rand() * 0.3;
      s.z = z + (this.rand() - 0.5) * spread;
      s.vx = Math.sin(a) * sp;
      s.vy = o.up * (0.5 + 0.5 * this.rand());
      s.vz = Math.cos(a) * sp;
      s.ax = 0;
      s.ay = -(o.gravity ?? 0);
      s.az = 0;
      s.life = o.life * (0.7 + 0.5 * this.rand());
      s.drag = o.drag ?? 1.2;
      s.floor = this.groundY(x, z) + 0.05;
      s.size0 = o.size0 * (0.7 + 0.6 * this.rand());
      s.size1 = o.size1 * (0.7 + 0.6 * this.rand());
      s.spin = (this.rand() - 0.5) * 2;
      s.seed = this.rand();
      s.r = r;
      s.g = g;
      s.b = b;
      s.a = o.alpha ?? 1;
      pool.emit(this.clock, s);
    }
  }

  private ring(
    x: number,
    z: number,
    color: number,
    from: number,
    to: number,
    span: number,
    width = 0.12,
    alpha = 1,
  ): void {
    const slot = this.rings.find((r) => !r.alive) ?? this.rings[0];
    slot.alive = true;
    slot.born = this.clock;
    slot.span = span;
    slot.from = from;
    slot.to = to;
    slot.alpha = alpha;
    slot.mat.uniforms.uColor.value.setHex(color);
    slot.mat.uniforms.uWidth.value = width;
    slot.mesh.position.set(x, this.groundY(x, z) + 0.12, z);
    slot.mesh.visible = true;
  }

  // ---------------------------------------------------------------- events

  /** True when the event was a Sanctum boss beat this layer drew (the
   *  renderer then skips it, its clip trigger included, so the body's own
   *  clip for the beat is played from here). */
  handleEvent(ev: SimEvent): boolean {
    const claimed = this.drawEvent(ev);
    if (claimed && ev.type === 'spellfx') {
      if (ev.ability === KORGATH_CHAIN_BREAK || ev.ability === KORGATH_RERIVETED) {
        if (this.korgathId >= 0) this.playGesture?.(this.korgathId, ev.ability);
      } else if (
        ev.ability === KORGATH_ENRAGE ||
        ev.ability === KORZUL_DOUSED ||
        ev.ability === KORZUL_BREAK_FREE
      ) {
        this.playGesture?.(ev.sourceId, ev.ability);
      }
    }
    return claimed;
  }

  private drawEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !this.world || this.disposed) return false;
    const src = this.world.entities.get(ev.sourceId);
    const at = src ?? this.world.entities.get(ev.targetId);
    if (!at) return false;
    const x = at.pos.x;
    const z = at.pos.z;
    const gy = this.groundY(x, z);
    switch (ev.ability) {
      case KORGATH_CHAIN_BREAK: {
        const chain = this.chains.find((c) => c.objectId === ev.sourceId);
        if (chain) chain.whipAt = this.clock;
        this.ring(x, z, SANCTUM_COLORS.smithBlue, 0.5, 9, 0.9, 0.14);
        this.spray(this.glow, 70, x, gy + SHACKLE_Y, z, {
          speed: 9,
          up: 7,
          life: 1.1,
          size0: 0.55,
          size1: 0.1,
          color: SANCTUM_COLORS.smithBlue,
          gravity: 9,
        });
        this.spray(this.mist, 40, x, gy + 0.5, z, {
          speed: 6,
          up: 2,
          spread: 1.5,
          life: 1.8,
          size0: 1.2,
          size1: 3.5,
          color: SANCTUM_COLORS.frost,
          alpha: 0.7,
        });
        this.shakeNear(x, z, 0.45);
        return true;
      }
      case KORGATH_RERIVETED: {
        const chain = this.chains.find((c) => c.objectId === ev.sourceId);
        if (chain) chain.flashAt = this.clock;
        this.ring(x, z, SANCTUM_COLORS.goadRed, 4, 0.5, 0.6, 0.2);
        this.spray(this.glow, 40, x, gy + SHACKLE_Y, z, {
          speed: 4,
          up: 5,
          life: 0.8,
          size0: 0.5,
          size1: 0.1,
          color: SANCTUM_COLORS.goadRed,
          gravity: 6,
        });
        return true;
      }
      case KORGATH_STOMP:
        if (ev.fx !== 'nova') return false;
        this.ring(x, z, SANCTUM_COLORS.frost, 1, KORGATH_REACH.stomp + 1, 0.7, 0.16);
        this.ring(x, z, SANCTUM_COLORS.smithBlue, 0.5, KORGATH_REACH.stomp, 1.1, 0.06);
        this.spray(this.mist, 60, x, gy + 0.3, z, {
          speed: 12,
          up: 1.5,
          spread: 3,
          life: 1.6,
          size0: 1.4,
          size1: 3.6,
          color: SANCTUM_COLORS.frost,
          alpha: 0.75,
        });
        this.spray(this.glow, 50, x, gy + 0.3, z, {
          speed: 10,
          up: 6,
          spread: 3,
          life: 0.9,
          size0: 0.4,
          size1: 0.1,
          color: SANCTUM_COLORS.frost,
          gravity: 12,
        });
        this.shakeNear(x, z, 0.7);
        return true;
      case KORGATH_MAUL_ARC:
      case KORGATH_CHAIN_FLAIL:
      case KORGATH_THRESHOLD_CHARGE:
        if (ev.fx !== 'nova') return false;
        this.landCast(ev.sourceId, ev.ability);
        return true;
      case KORGATH_BELLOW:
        if (ev.fx !== 'nova') return false;
        this.ring(x, z, TELEGRAPH_THREAT_COLORS.control, 2, 18, 0.9, 0.1);
        this.ring(x, z, SANCTUM_COLORS.frost, 1, 12, 0.7, 0.18, 0.7);
        this.spray(this.mist, 50, x, gy + 7.5, z, {
          speed: 9,
          up: 0.5,
          spread: 1,
          life: 1.4,
          size0: 1.2,
          size1: 4,
          color: SANCTUM_COLORS.frost,
          alpha: 0.55,
          dirX: Math.sin(at.facing),
          dirZ: Math.cos(at.facing),
          cone: 1.6,
        });
        this.shakeNear(x, z, 0.5);
        return true;
      case KORGATH_STRAIN:
        if (ev.fx !== 'nova') return false;
        for (const c of this.chains) {
          if (c.broken) continue;
          const p = this.pillarAt.get(c.tool);
          if (!p) continue;
          this.ring(p.x, p.z, SANCTUM_COLORS.smithBlue, 1, KORGATH_TUNING.strainRadius, 0.8, 0.16);
          this.spray(this.glow, 30, p.x, this.groundY(p.x, p.z) + 0.3, p.z, {
            speed: 7,
            up: 8,
            spread: 2,
            life: 0.9,
            size0: 0.45,
            size1: 0.1,
            color: SANCTUM_COLORS.frost,
            gravity: 14,
          });
        }
        this.shakeNear(x, z, 0.5);
        return true;
      case KORGATH_ENRAGE:
        this.ring(x, z, SANCTUM_COLORS.goadRed, 2, 14, 1.2, 0.14);
        this.spray(this.glow, 60, x, gy + 5, z, {
          speed: 5,
          up: 4,
          spread: 4,
          life: 1.4,
          size0: 0.8,
          size1: 0.2,
          color: SANCTUM_COLORS.goadRed,
        });
        return true;
      case VELKHAR_WAKING_THAW: {
        // At the pyre (the boss's beat targets its flare object) or the add.
        const tgt = this.world.entities.get(ev.targetId);
        const pyre = tgt && tgt.kind === 'object' ? tgt : at;
        this.thawBurst(pyre.pos.x, pyre.pos.z);
        return true;
      }
      case VELKHAR_SOULFIRE_TRENCH: {
        if (ev.fx !== 'nova') return false;
        const lane = this.lanes.find((l) => l.objectId === ev.targetId);
        if (lane) this.trenchBurst(lane);
        return true;
      }
      case VELKHAR_TITHE: {
        const v = this.world.entities.get(ev.targetId) ?? at;
        this.titheBurst(at.pos.x, at.pos.z, v.pos.x, v.pos.z);
        return true;
      }
      case VELKHAR_SHADOW_VOLLEY:
        if (ev.fx !== 'nova') return false;
        this.ring(x, z, SANCTUM_COLORS.soulViolet, 1, 26, 1.0, 0.08);
        this.spray(this.glow, 70, x, gy + VELKHAR_FLAME_Y, z, {
          speed: 14,
          up: 1,
          spread: 0.5,
          life: 1.1,
          size0: 0.9,
          size1: 0.2,
          color: SANCTUM_COLORS.soulViolet,
        });
        return true;
      case VELKHAR_HELD:
        this.ring(x, z, SANCTUM_COLORS.frost, 0.3, 4, 0.6, 0.2);
        this.spray(this.glow, 45, x, gy + 1, z, {
          speed: 5,
          up: 5,
          spread: 0.8,
          life: 0.9,
          size0: 0.45,
          size1: 0.08,
          color: SANCTUM_COLORS.frost,
          gravity: 10,
        });
        return true;
      case VELKHAR_UNQUENCHED:
        this.spray(this.mist, 30, x, gy + 0.2, z, {
          speed: 3,
          up: 3,
          spread: 1,
          life: 1.5,
          size0: 0.8,
          size1: 2.2,
          color: SANCTUM_COLORS.steam,
          alpha: 0.6,
        });
        this.ring(x, z, SANCTUM_COLORS.soulViolet, 0.3, 3, 0.7, 0.2);
        return true;
      case KORZUL_GRAVE_INFERNO: {
        if (ev.fx !== 'nova') return false;
        const lvl = Math.max(0.25, infernoLevel(this.castFill(at)) || 0.25);
        const r = KORZUL_TUNING.infernoRadius;
        this.ring(x, z, SANCTUM_COLORS.ember, 2, r, 0.7, 0.12 + 0.08 * lvl);
        this.spray(this.fire, Math.round(120 * lvl + 40), x, gy + 0.2, z, {
          speed: r * 1.1,
          up: 3 + 4 * lvl,
          spread: 3,
          life: 0.9,
          size0: 2.2 + 1.6 * lvl,
          size1: 0.8,
          color: 0xffffff,
          drag: 2,
        });
        this.shakeNear(x, z, 0.3 + 0.4 * lvl);
        return true;
      }
      case KORZUL_DOUSED:
        this.ring(x, z, SANCTUM_COLORS.steam, 2, 20, 1.4, 0.2, 0.8);
        this.spray(this.mist, 180, x, gy + 0.5, z, {
          speed: 8,
          up: 11,
          spread: 9,
          life: 3.2,
          size0: 3,
          size1: 9,
          color: SANCTUM_COLORS.steam,
          alpha: 0.85,
          drag: 1.5,
        });
        this.shakeNear(x, z, 0.8);
        return true;
      case KORZUL_WING_GALE:
        if (ev.fx !== 'nova') return false;
        this.ring(x, z, SANCTUM_COLORS.frost, 4, 30, 1.0, 0.07, 0.8);
        this.spray(this.mist, 90, x, gy + 1, z, {
          speed: 22,
          up: 1.5,
          spread: 10,
          life: 1.4,
          size0: 1.5,
          size1: 4,
          color: SANCTUM_COLORS.frost,
          alpha: 0.6,
          drag: 1.8,
        });
        this.shakeNear(x, z, 0.4);
        return true;
      case KORZUL_PLUNGING_FIRE: {
        if (ev.fx !== 'nova') return false;
        const tgt = this.world.entities.get(ev.targetId) ?? at;
        this.plungeBurst(tgt.pos.x, tgt.pos.z, tgt.scale > 0 ? tgt.scale : 8);
        return true;
      }
      case KORZUL_CRASHING_DESCENT:
        if (ev.fx !== 'nova') return false;
        this.ring(x, z, SANCTUM_COLORS.frost, 2, KORZUL_TUNING.descentRadius + 3, 0.8, 0.18);
        this.ring(x, z, SANCTUM_COLORS.ember, 1, KORZUL_TUNING.descentRadius, 1.1, 0.06);
        this.spray(this.glow, 80, x, gy + 0.4, z, {
          speed: 16,
          up: 9,
          spread: 6,
          life: 1.1,
          size0: 0.6,
          size1: 0.1,
          color: SANCTUM_COLORS.frost,
          gravity: 16,
        });
        this.spray(this.mist, 90, x, gy + 0.4, z, {
          speed: 14,
          up: 2,
          spread: 8,
          life: 2.2,
          size0: 2,
          size1: 6,
          color: SANCTUM_COLORS.frost,
          alpha: 0.7,
        });
        this.shakeNear(x, z, 1.1, 70);
        return true;
      case KORZUL_BROOD:
        this.spray(this.mist, 40, x, gy + 0.3, z, {
          speed: 4,
          up: 6,
          spread: 2,
          life: 1.6,
          size0: 1,
          size1: 3,
          color: SANCTUM_COLORS.steam,
          alpha: 0.7,
          gravity: 4,
        });
        this.ring(x, z, SANCTUM_COLORS.frost, 0.5, 5, 0.8, 0.2);
        return true;
      case KORZUL_BREAK_FREE:
        // The pull: the burst itself plays on the bar's burst beat
        // (stepKorzul), where the face lets him go.
        return true;
      case KORZUL_TOUCHDOWN:
        this.touchdown(x, z, gy);
        if (this.emerge?.id === ev.sourceId) this.emerge = null;
        return true;
      default:
        return false;
    }
  }

  /** The ice bursts round him (Break Free's beat). */
  private burst(x: number, z: number): void {
    const gy = this.groundY(x, z);
    this.ring(x, z, SANCTUM_COLORS.frost, 4, 40, 1.6, 0.08);
    this.spray(this.glow, 140, x, gy + 8, z, {
      speed: 18,
      up: 12,
      spread: 14,
      life: 1.8,
      size0: 0.8,
      size1: 0.15,
      color: SANCTUM_COLORS.frost,
      gravity: 14,
    });
    this.spray(this.mist, 120, x, gy + 2, z, {
      speed: 12,
      up: 4,
      spread: 16,
      life: 3,
      size0: 3,
      size1: 9,
      color: SANCTUM_COLORS.frost,
      alpha: 0.75,
    });
    this.shakeNear(x, z, 1.2, 90);
  }

  /** He lands on the centre (Break Free's end): a frost and snow burst, ice
   *  chips, the plates round him cracking white for a moment, the ground
   *  shaking. No telegraph: it hurts nobody. */
  private touchdown(x: number, z: number, gy: number): void {
    this.ring(x, z, SANCTUM_COLORS.frost, 5, 30, 1.2, 0.1);
    this.ring(x, z, SANCTUM_COLORS.steam, 2, 18, 0.8, 0.16);
    // Low and thin: snow thrown along the ice, never a wall over a camera
    // that stands near the centre.
    this.spray(this.mist, 60, x, gy + 0.4, z, {
      speed: 13,
      up: 1.2,
      spread: 8,
      life: 1.8,
      size0: 1.4,
      size1: 4.5,
      color: SANCTUM_COLORS.steam,
      alpha: 0.4,
      gravity: 1.5,
    });
    this.spray(this.glow, 90, x, gy + 1, z, {
      speed: 11,
      up: 9,
      spread: 8,
      life: 1.4,
      size0: 0.6,
      size1: 0.12,
      color: SANCTUM_COLORS.frost,
      gravity: 16,
    });
    for (const p of this.plates)
      if (p.objectId >= 0 && Math.hypot(p.spot.x - x, p.spot.z - z) <= TOUCHDOWN_SHOCK_REACH)
        p.shockAt = this.clock;
    this.shakeNear(x, z, 1.4, 90);
  }

  private castFill(e: Entity): number {
    return e.castingAbility ? telegraphFillOf(e.castRemaining, e.castTotal) : 1;
  }

  /** A struck cast's landing burst along its latched shape. */
  private landCast(casterId: number, castId: string): void {
    const fan = this.casts.find((c) => c.casterId === casterId && c.castId === castId);
    const lane = this.lanes.find((l) => l.casterId === casterId && l.castId === castId);
    if (castId === KORGATH_MAUL_ARC && fan) {
      for (let i = 0; i < 8; i++) {
        const a = fan.yaw + (i / 7 - 0.5) * Math.PI;
        const d = KORGATH_TUNING.maulRange * 0.75;
        const px = fan.x + Math.sin(a) * d;
        const pz = fan.z + Math.cos(a) * d;
        this.spray(this.glow, 8, px, this.groundY(px, pz) + 0.4, pz, {
          speed: 5,
          up: 5,
          life: 0.7,
          size0: 0.4,
          size1: 0.1,
          color: SANCTUM_COLORS.frost,
          gravity: 12,
        });
      }
      this.shakeNear(fan.x, fan.z, 0.4);
      return;
    }
    if (!lane) return;
    const steps = Math.max(4, Math.round(lane.length / 2.5));
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * lane.length;
      const px = lane.x + Math.sin(lane.yaw) * t;
      const pz = lane.z + Math.cos(lane.yaw) * t;
      const gy = this.groundY(px, pz);
      if (castId === KORGATH_CHAIN_FLAIL)
        this.spray(this.glow, 6, px, gy + 0.3, pz, {
          speed: 4,
          up: 5,
          life: 0.7,
          size0: 0.4,
          size1: 0.1,
          color: SANCTUM_COLORS.smithBlue,
          gravity: 10,
        });
      else
        this.spray(this.mist, 6, px, gy + 0.3, pz, {
          speed: 3,
          up: 2,
          spread: 2,
          life: 1.4,
          size0: 1.2,
          size1: 3,
          color: SANCTUM_COLORS.frost,
          alpha: 0.6,
        });
    }
    this.shakeNear(lane.x, lane.z, 0.5);
  }

  /** A pyre flares: soulfire erupts over its pool and the dead climb out. */
  private thawBurst(x: number, z: number): void {
    const gy = this.groundY(x, z);
    this.spray(this.soulfire, 90, x, gy + 0.2, z, {
      speed: 3,
      up: 9,
      spread: 5,
      life: 1.4,
      size0: 2.2,
      size1: 0.6,
      color: 0xffffff,
    });
    this.ring(x, z, SANCTUM_COLORS.soulfire, 1, 9, 0.9, 0.14);
    this.spray(this.mist, 40, x, gy + 0.3, z, {
      speed: 3,
      up: 4,
      spread: 6,
      life: 2.2,
      size0: 1.5,
      size1: 4.5,
      color: SANCTUM_COLORS.steam,
      alpha: 0.6,
    });
    this.shakeNear(x, z, 0.3);
  }

  /** The trench lands: soulfire runs the lane and melts it to water. */
  private trenchBurst(lane: CastLane): void {
    const steps = Math.max(4, Math.round(lane.length / 2));
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * lane.length;
      const px = lane.x + Math.sin(lane.yaw) * t;
      const pz = lane.z + Math.cos(lane.yaw) * t;
      const gy = this.groundY(px, pz);
      this.spray(this.soulfire, 7, px, gy + 0.1, pz, {
        speed: 1,
        up: 5,
        spread: VELKHAR_TUNING.trenchWidth,
        life: 1.1,
        size0: 2,
        size1: 0.6,
        color: 0xffffff,
      });
      this.spray(this.mist, 3, px, gy + 0.2, pz, {
        speed: 0.6,
        up: 2,
        spread: VELKHAR_TUNING.trenchWidth,
        life: 2.4,
        size0: 1.2,
        size1: 3.6,
        color: SANCTUM_COLORS.steam,
        alpha: 0.55,
      });
    }
    this.shakeNear(lane.x, lane.z, 0.35);
  }

  /** The tithe returned: soulfire runs from the risen dead into Velkhar. */
  private titheBurst(fx: number, fz: number, vx: number, vz: number): void {
    const vy = this.groundY(vx, vz);
    this.spray(this.soulfire, 40, vx, vy + 0.3, vz, {
      speed: 1.5,
      up: 6,
      spread: 2,
      life: 1.2,
      size0: 1.4,
      size1: 0.3,
      color: 0xffffff,
    });
    this.ring(vx, vz, SANCTUM_COLORS.soulfire, 4, 0.5, 0.8, 0.2);
    const d = Math.hypot(vx - fx, vz - fz) || 1;
    this.spray(this.glow, 24, fx, this.groundY(fx, fz) + 1.2, fz, {
      speed: Math.min(20, d * 1.4),
      up: 2,
      life: 0.8,
      size0: 0.6,
      size1: 0.2,
      color: SANCTUM_COLORS.soulfire,
      dirX: vx - fx,
      dirZ: vz - fz,
      cone: 0.25,
      drag: 0.5,
    });
  }

  /** The fire pours on a whole plate. */
  private plungeBurst(x: number, z: number, r: number): void {
    const gy = this.groundY(x, z);
    this.ring(x, z, SANCTUM_COLORS.ember, 1, r + 1, 0.8, 0.14);
    for (let i = 0; i < 7; i++) {
      const a = this.rand() * Math.PI * 2;
      const d = Math.sqrt(this.rand()) * r * 0.85;
      this.spray(this.fire, 22, x + Math.sin(a) * d, gy + 0.2, z + Math.cos(a) * d, {
        speed: 3,
        up: 6,
        spread: 2.5,
        life: 1.1,
        size0: 3,
        size1: 1,
        color: 0xffffff,
      });
    }
    this.shakeNear(x, z, 0.6);
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    this.gestureClock -= dt;
    if (this.gestureClock <= 0) {
      this.gestureClock = GESTURE_SEC;
      this.sendGestures();
    }
    this.stepGlows(dt);
    this.stepCasts();
    this.stepKorgath();
    this.stepVelkhar();
    this.stepKorzul(world, dt);
    for (const r of this.rings) {
      if (!r.alive) continue;
      const k = (this.clock - r.born) / r.span;
      if (k >= 1) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - (1 - k) ** 3;
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * e);
      r.mat.uniforms.uAlpha.value = (1 - k) ** 1.3 * r.alpha;
    }
    this.fire.update(this.clock);
    this.soulfire.update(this.clock);
    this.glow.update(this.clock);
    this.mist.update(this.clock);
  }

  private scanWorld(world: IWorld): void {
    this.korgathId = -1;
    this.velkharId = -1;
    this.korzulId = -1;
    const live = new Set<number>();
    const plates: Entity[] = [];
    const chains: Entity[] = [];
    const strips: Entity[] = [];
    const puddles: Entity[] = [];
    const rings: Entity[] = [];
    const statues: Entity[] = [];
    const objFans: Entity[] = [];
    let step = -1;
    for (const e of world.entities.values()) {
      if (e.kind === 'mob') {
        if (e.dead) continue;
        if (e.templateId === KORGATH_ID) this.korgathId = e.id;
        else if (e.templateId === VELKHAR_ID) this.velkharId = e.id;
        else if (e.templateId === KORZUL_ID) this.korzulId = e.id;
        continue;
      }
      if (e.kind !== 'object') continue;
      const t = e.templateId;
      if (!t.startsWith('sanctum_')) continue;
      const s = sanctumStoryStepOf(t);
      if (s !== null) {
        step = Math.max(step, s);
        continue;
      }
      live.add(e.id);
      if (!this.objectsSeen.has(e.id)) this.objectsSeen.set(e.id, this.clock);
      if (plateLook(t)) plates.push(e);
      else if (sealChainOf(t)) chains.push(e);
      else if (t === SANCTUM_MELT_STRIP) strips.push(e);
      else if (t === SANCTUM_WARM_PUDDLE) puddles.push(e);
      else if (t === SANCTUM_UNQUENCHED_RING) rings.push(e);
      else if (t === SANCTUM_HELD_STATUE) statues.push(e);
      else if (
        t === SANCTUM_PLUNGING_FIRE ||
        t === SANCTUM_LANDING_SHADOW ||
        t === SANCTUM_PYRE_FLARE ||
        t === SANCTUM_TRENCH_LANE
      )
        objFans.push(e);
    }
    if (step >= 0) this.storyStep = step;
    for (const id of this.objectsSeen.keys()) if (!live.has(id)) this.objectsSeen.delete(id);
    this.bindPlates(plates);
    this.bindChains(chains);
    this.bindMelt(this.strips, strips);
    this.bindMelt(this.puddles, puddles);
    this.bindBubbles(rings);
    this.bindStatues(statues);
    this.bindObjFans(objFans);
  }

  // ---- binding pooled slots to live objects ---------------------------------------

  private bindPlates(objs: Entity[]): void {
    const spots: PlateSpot[] = [];
    for (const slot of this.plates)
      if (slot.objectId >= 0 && !objs.some((o) => o.id === slot.objectId)) {
        slot.objectId = -1;
        slot.mesh.visible = false;
      }
    for (const o of objs) {
      let slot = this.plates.find((p) => p.objectId === o.id);
      if (!slot) {
        slot = this.plates.find((p) => p.objectId < 0);
        if (!slot) continue;
        slot.objectId = o.id;
        slot.template = '';
        slot.state = -1;
      }
      const look = plateLook(o.templateId);
      if (!look) continue;
      const r = o.scale > 0 ? o.scale : 8;
      if (slot.template !== o.templateId) {
        const was = slot.state;
        slot.template = o.templateId;
        slot.stepAt = this.clock;
        slot.state = look.state;
        slot.refreeze = look.refreeze;
        if (was >= 0 && look.state > was) this.plateBreakFx(o.pos.x, o.pos.z, r, look.state);
        if (look.state === 2) slot.brokeAt = was >= 0 && was < 2 ? this.clock : -99;
      }
      slot.mesh.position.set(o.pos.x, this.groundY(o.pos.x, o.pos.z) + 0.05, o.pos.z);
      slot.mesh.scale.set(r, 1, r);
      slot.mesh.visible = true;
      slot.mat.uniforms.uState.value = look.state;
      slot.spot.id = o.id;
      slot.spot.x = o.pos.x;
      slot.spot.z = o.pos.z;
      slot.spot.r = r;
      slot.spot.state = look.state === 0 ? 'sound' : look.state === 1 ? 'cracked' : 'broken';
      spots.push(slot.spot);
    }
    this.plateSpots = spots;
  }

  private plateBreakFx(x: number, z: number, r: number, state: number): void {
    const gy = this.groundY(x, z);
    if (state === 1) {
      this.ring(x, z, SANCTUM_COLORS.ember, r * 0.3, r, 0.6, 0.06);
      this.spray(this.glow, 40, x, gy + 0.2, z, {
        speed: 6,
        up: 4,
        spread: r,
        life: 0.9,
        size0: 0.45,
        size1: 0.1,
        color: SANCTUM_COLORS.ember,
        gravity: 8,
      });
      this.shakeNear(x, z, 0.25);
      return;
    }
    this.ring(x, z, SANCTUM_COLORS.steam, r * 0.6, r * 1.2, 1.2, 0.2, 0.8);
    this.spray(this.mist, 70, x, gy + 0.3, z, {
      speed: 4,
      up: 7,
      spread: r * 1.2,
      life: 2.6,
      size0: 2,
      size1: 6,
      color: SANCTUM_COLORS.steam,
      alpha: 0.75,
    });
    this.spray(this.glow, 50, x, gy + 0.3, z, {
      speed: 7,
      up: 6,
      spread: r,
      life: 1,
      size0: 0.5,
      size1: 0.1,
      color: SANCTUM_COLORS.frost,
      gravity: 12,
    });
    this.shakeNear(x, z, 0.5);
  }

  private bindChains(objs: Entity[]): void {
    for (const c of this.chains) {
      const o = objs.find((e) => sealChainOf(e.templateId)?.tool === c.tool);
      if (!o) {
        c.objectId = -1;
        c.mesh.visible = false;
        c.glow.visible = false;
        continue;
      }
      if (c.objectId !== o.id) {
        c.objectId = o.id;
        c.anchor = null;
      }
      const broken = sealChainOf(o.templateId)?.state === 'broken';
      if (c.broken && !broken) c.flashAt = this.clock;
      c.broken = broken;
      // The pillar stands 3.2 yd outward of its shackle, away from the terrace's centre.
      const local = SEAL_PILLARS.find((p) => p.id === c.tool);
      if (local) {
        const ox = o.pos.x - local.shackle.x;
        const oz = o.pos.z - local.shackle.z;
        this.pillarAt.set(c.tool, { x: ox + local.x, z: oz + local.z });
      }
    }
    // Find each anchor bone on Korgath's live rig (absent on the far bake).
    const k = this.entity(this.korgathId);
    if (!k) return;
    for (const c of this.chains) {
      if (c.anchor) continue;
      const view = this.viewOf(k.id);
      if (view) c.anchor = view.getObjectByName(KORGATH_ANCHORS[c.tool]) ?? null;
    }
  }

  private viewOf(id: number): THREE.Object3D | null {
    const scene = this.root.parent;
    if (!scene) return null;
    for (const child of scene.children) if (child.userData.entityId === id) return child;
    return null;
  }

  private bindMelt(pool: MeltSlot[], objs: Entity[]): void {
    for (const s of pool)
      if (s.objectId >= 0 && !objs.some((o) => o.id === s.objectId) && s.gone < 0)
        s.gone = this.clock;
    for (const o of objs) {
      if (pool.some((s) => s.objectId === o.id && s.gone < 0)) continue;
      const slot = pool.find((s) => s.objectId < 0) ?? pool.find((s) => s.gone >= 0);
      if (!slot) continue;
      slot.objectId = o.id;
      slot.born = this.objectsSeen.get(o.id) ?? this.clock;
      slot.gone = -1;
      const gy = this.groundY(o.pos.x, o.pos.z);
      slot.mesh.position.set(o.pos.x, gy + 0.08, o.pos.z);
      if (o.templateId === SANCTUM_MELT_STRIP) {
        const len = Math.max(1, o.scale);
        slot.mesh.rotation.y = o.facing;
        slot.mesh.scale.set(VELKHAR_TUNING.trenchWidth, 1, len);
        slot.mat.uniforms.uLength.value = len;
      } else {
        const r = Math.max(0.5, o.scale);
        slot.mesh.scale.set(r, 1, r);
      }
      slot.mesh.visible = true;
    }
  }

  private bindBubbles(objs: Entity[]): void {
    for (const b of this.bubbles)
      if (b.objectId >= 0 && !objs.some((o) => o.id === b.objectId)) {
        b.objectId = -1;
        b.mesh.visible = false;
      }
    for (const o of objs) {
      if (this.bubbles.some((b) => b.objectId === o.id)) continue;
      const slot = this.bubbles.find((b) => b.objectId < 0);
      if (!slot) continue;
      slot.objectId = o.id;
      slot.born = this.objectsSeen.get(o.id) ?? this.clock;
      slot.mesh.position.set(o.pos.x, this.groundY(o.pos.x, o.pos.z) + 0.1, o.pos.z);
      slot.mesh.visible = true;
    }
  }

  private bindStatues(objs: Entity[]): void {
    for (const s of this.statues)
      if (s.objectId >= 0 && !objs.some((o) => o.id === s.objectId)) {
        s.objectId = -1;
        s.mesh.visible = false;
        s.frost.visible = false;
      }
    for (const o of objs) {
      if (this.statues.some((s) => s.objectId === o.id)) continue;
      const slot = this.statues.find((s) => s.objectId < 0);
      if (!slot) continue;
      slot.objectId = o.id;
      slot.born = this.objectsSeen.get(o.id) ?? this.clock;
      const gy = this.groundY(o.pos.x, o.pos.z);
      slot.mesh.position.set(o.pos.x, gy, o.pos.z);
      slot.mesh.rotation.y = (o.id * 2.39996) % (Math.PI * 2);
      slot.mesh.scale.setScalar(1.15);
      slot.frost.position.set(o.pos.x, gy + 0.06, o.pos.z);
      slot.frost.scale.set(2.2, 1, 2.2);
      slot.mesh.visible = true;
      slot.frost.visible = true;
    }
  }

  private bindObjFans(objs: Entity[]): void {
    for (const f of this.objFans)
      if (f.objectId >= 0 && !objs.some((o) => o.id === f.objectId)) {
        if (f.templateId === SANCTUM_PYRE_FLARE) this.flaresSeen.delete(f.objectId);
        f.objectId = -1;
        f.group.visible = false;
      }
    for (const l of this.lanes)
      if (l.objectId >= 0 && !objs.some((o) => o.id === l.objectId)) {
        l.objectId = -1;
        l.group.visible = false;
      }
    for (const o of objs) {
      if (o.templateId === SANCTUM_TRENCH_LANE) {
        if (this.lanes.some((l) => l.objectId === o.id)) continue;
        const lane = this.lanes.find((l) => l.objectId < 0 && l.casterId < 0);
        if (!lane) continue;
        lane.objectId = o.id;
        lane.castId = VELKHAR_SOULFIRE_TRENCH;
        lane.x = o.pos.x;
        lane.z = o.pos.z;
        lane.y = this.groundY(o.pos.x, o.pos.z);
        lane.yaw = o.facing;
        lane.length = Math.max(1, o.scale);
        this.kit.drapeLane(
          lane,
          this.groundY,
          lane.x,
          lane.y,
          lane.z,
          lane.yaw,
          lane.length,
          VELKHAR_TUNING.trenchWidth / 2,
          { color: TELEGRAPH_THREAT_COLORS.danger, accent: TELEGRAPH_ACCENTS.ghostfire },
        );
        lane.group.visible = true;
        continue;
      }
      if (this.objFans.some((f) => f.objectId === o.id)) continue;
      const slot = this.objFans.find((f) => f.objectId < 0);
      if (!slot) continue;
      slot.objectId = o.id;
      slot.templateId = o.templateId;
      slot.born = this.objectsSeen.get(o.id) ?? this.clock;
      const r = Math.max(1, o.scale);
      const threat =
        o.templateId === SANCTUM_PYRE_FLARE
          ? TELEGRAPH_THREAT_COLORS.control
          : TELEGRAPH_THREAT_COLORS.lethal;
      const accent =
        o.templateId === SANCTUM_PYRE_FLARE ? TELEGRAPH_ACCENTS.ghostfire : SANCTUM_COLORS.wyrmFire;
      this.kit.layOutFan(slot, 360, { color: threat, accent });
      this.kit.drapeFan(slot, this.groundY, o.pos.x, this.groundY(o.pos.x, o.pos.z), o.pos.z, 0, r);
      slot.group.visible = true;
      if (o.templateId === SANCTUM_PYRE_FLARE && !this.flaresSeen.has(o.id)) {
        this.flaresSeen.add(o.id);
        if (this.velkharId >= 0) this.playGesture?.(this.velkharId, VELKHAR_THAW_GESTURE);
      }
    }
  }

  // ---- gestures (idempotent, re-sent so a rebuilt view shows the state) ------------

  private sendGestures(): void {
    const play = this.playGesture;
    if (!play) return;
    const k = this.entity(this.korgathId);
    if (k)
      for (const c of this.chains) {
        if (c.objectId < 0 || !KORGATH_BROKEN_CHAIN_MESH[c.tool]) continue;
        play(k.id, c.broken ? KORGATH_BROKEN_GESTURE[c.tool] : KORGATH_WHOLE_GESTURE[c.tool]);
      }
    const z = this.entity(this.korzulId);
    if (z) this.syncKorzulBody(z, true);
  }

  /** Korzul's own body: hidden in the ice, still hidden through Break Free's
   *  first beat (the face's frozen wyrm is the one seen until the ice
   *  bursts), then shown at the face's foot. `resend` re-sends the held
   *  state (a rebuilt view); otherwise only a change is sent. */
  private syncKorzulBody(z: Entity, resend: boolean): void {
    const play = this.playGesture;
    if (!play) return;
    const elapsed =
      z.castingAbility === KORZUL_BREAK_FREE ? Math.max(0, z.castTotal - z.castRemaining) : null;
    const view = korzulBodyView(
      this.storyStep,
      z.inCombat,
      z.dead,
      this.frozenSent.has(z.id),
      elapsed,
    );
    if (view === 'frozen') {
      if (!resend && this.frozenSent.has(z.id)) return;
      play(z.id, KORZUL_FROZEN_STANCE);
      play(z.id, KORZUL_HIDE_GESTURE);
      this.frozenSent.add(z.id);
    } else if (view === 'bursting') {
      // Pulled: his waking clips (Break Free plays hidden), the body unseen.
      if (resend) {
        play(z.id, KORZUL_BREAK_FREE);
        play(z.id, KORZUL_HIDE_GESTURE);
      }
    } else if (this.frozenSent.has(z.id)) {
      play(z.id, KORZUL_SHOW_GESTURE);
      play(z.id, KORZUL_BREAK_FREE);
      this.frozenSent.delete(z.id);
    }
  }

  /** The bodies' own glow: Korzul's heartbeat, Korgath's runes on a Strain,
   *  Velkhar's flame on every bar. */
  private stepGlows(dt: number): void {
    const play = this.playGesture;
    if (!play) return;
    const z = this.entity(this.korzulId);
    if (z) {
      const flaring = z.auras.some((a) => a.id === KORZUL_SHARD_FLARE);
      this.heartbeat -= dt;
      if (this.heartbeat <= 0) {
        this.heartbeat = heartbeatEvery(flaring);
        play(z.id, flaring ? KORZUL_HEARTBEAT_FLARE_GESTURE : KORZUL_HEARTBEAT_GESTURE);
      }
    }
    for (const id of [this.korgathId, this.velkharId]) {
      const e = this.entity(id);
      if (!e) continue;
      const bar = e.castingAbility;
      if (bar && bar !== this.lastBar.get(id)) {
        if (id === this.korgathId && bar === KORGATH_STRAIN) play(id, KORGATH_RUNES_GESTURE);
        if (id === this.velkharId) play(id, VELKHAR_FLAME_GESTURE);
      }
      this.lastBar.set(id, bar);
    }
  }

  // ---- the casters' floor shapes ----------------------------------------------------

  private stepCasts(): void {
    const casters = [this.korgathId, this.velkharId, this.korzulId];
    for (const id of casters) {
      const e = this.entity(id);
      if (!e || !e.castingAbility) continue;
      const spec = SANCTUM_CAST_SPECS[e.castingAbility];
      if (!spec) continue;
      if (spec.shape === 'fan') {
        if (this.casts.some((c) => c.casterId === id && c.castId === e.castingAbility)) continue;
        const slot = this.casts.find((c) => c.casterId < 0);
        if (!slot) continue;
        slot.casterId = id;
        slot.castId = e.castingAbility;
        slot.x = e.pos.x;
        slot.z = e.pos.z;
        slot.y = this.groundY(e.pos.x, e.pos.z);
        slot.yaw = specYaw(spec, e.facing);
        this.kit.layOutFan(slot, spec.arcDeg, { color: specColor(spec), accent: spec.accent });
        this.kit.drapeFan(slot, this.groundY, slot.x, slot.y, slot.z, slot.yaw, spec.range);
        slot.group.visible = true;
      } else {
        if (this.lanes.some((l) => l.casterId === id && l.castId === e.castingAbility)) continue;
        const lane = this.lanes.find((l) => l.casterId < 0 && l.objectId < 0);
        if (!lane) continue;
        lane.casterId = id;
        lane.castId = e.castingAbility;
        lane.x = e.pos.x;
        lane.z = e.pos.z;
        lane.y = this.groundY(e.pos.x, e.pos.z);
        lane.yaw = e.facing;
        lane.length = spec.range;
        this.kit.drapeLane(
          lane,
          this.groundY,
          lane.x,
          lane.y,
          lane.z,
          lane.yaw,
          spec.range,
          spec.half,
          { color: specColor(spec), accent: spec.accent },
        );
        lane.group.visible = true;
      }
    }
    for (const c of this.casts) {
      if (c.casterId < 0) continue;
      const e = this.entity(c.casterId);
      if (!e || e.castingAbility !== c.castId) {
        // The breath lands: fire down the cone from the jaws.
        if (c.castId === KORZUL_GRAVE_BREATH && c.fill > 0.9) this.breathFire(c);
        c.casterId = -1;
        c.castId = '';
        c.group.visible = false;
        continue;
      }
      c.fill = telegraphFillOf(e.castRemaining, e.castTotal);
      const spec = SANCTUM_CAST_SPECS[c.castId];
      const fill = c.castId === KORZUL_GRAVE_INFERNO ? infernoLevel(c.fill) : c.fill;
      this.kit.paintFan(c, { fill, clock: this.clock, range: spec.range });
      // The Inferno's heat pours off him the whole channel.
      if (c.castId === KORZUL_GRAVE_INFERNO && this.rand() < 0.6 * this.density)
        this.spray(this.fire, 3, e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.3, e.pos.z, {
          speed: 6 + 6 * fill,
          up: 3,
          spread: 6,
          life: 0.8,
          size0: 1.6,
          size1: 0.6,
          color: 0xffffff,
        });
    }
    for (const l of this.lanes) {
      if (l.objectId >= 0) {
        // The trench lane object: filled by Velkhar's bar while it runs.
        const v = this.entity(this.velkharId);
        const born = this.objectsSeen.get(l.objectId) ?? this.clock;
        const fill =
          v && v.castingAbility === VELKHAR_SOULFIRE_TRENCH
            ? telegraphFillOf(v.castRemaining, v.castTotal)
            : Math.min(1, (this.clock - born) / VELKHAR_TUNING.trenchCast);
        this.kit.paintLane(l, { fill, clock: this.clock, range: l.length });
        if (this.rand() < 0.5 * this.density) {
          const t = this.rand() * l.length;
          const px = l.x + Math.sin(l.yaw) * t;
          const pz = l.z + Math.cos(l.yaw) * t;
          this.spray(this.soulfire, 1, px, this.groundY(px, pz) + 0.1, pz, {
            speed: 0.4,
            up: 2.5,
            spread: VELKHAR_TUNING.trenchWidth * 0.8,
            life: 0.9,
            size0: 1.1,
            size1: 0.3,
            color: 0xffffff,
          });
        }
        continue;
      }
      if (l.casterId < 0) continue;
      const e = this.entity(l.casterId);
      if (!e || e.castingAbility !== l.castId) {
        l.casterId = -1;
        l.castId = '';
        l.group.visible = false;
        continue;
      }
      l.fill = telegraphFillOf(e.castRemaining, e.castTotal);
      this.kit.paintLane(l, { fill: l.fill, clock: this.clock, range: l.length });
    }
  }

  /** Grave Breath leaves the jaws: a river of fire down the cone. */
  private breathFire(c: CastFan): void {
    const scale = KORZUL_BODY.drawnScale;
    const mx = c.x + Math.sin(c.yaw) * KORZUL_MOUTH_REST.z * scale * 0.5;
    const mz = c.z + Math.cos(c.yaw) * KORZUL_MOUTH_REST.z * scale * 0.5;
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const d = t * KORZUL_TUNING.breathRange;
      const px = c.x + Math.sin(c.yaw) * d;
      const pz = c.z + Math.cos(c.yaw) * d;
      const halfW = Math.tan((KORZUL_TUNING.breathArcDeg * Math.PI) / 360) * d;
      this.spray(this.fire, 10 + i * 2, px, this.groundY(px, pz) + 0.3, pz, {
        speed: 3,
        up: 3,
        spread: halfW * 1.6,
        life: 1.3,
        size0: 2.6,
        size1: 1.2,
        color: 0xffffff,
      });
    }
    this.spray(this.fire, 30, mx, this.groundY(mx, mz) + 6, mz, {
      speed: 16,
      up: -4,
      life: 0.9,
      size0: 2.2,
      size1: 1,
      color: 0xffffff,
      dirX: Math.sin(c.yaw),
      dirZ: Math.cos(c.yaw),
      cone: 0.9,
    });
    this.shakeNear(c.x, c.z, 0.45, 60);
  }

  // ---- Korgath ------------------------------------------------------------------------

  private stepKorgath(): void {
    const k = this.entity(this.korgathId);
    const straining = !!k && k.castingAbility === KORGATH_STRAIN;
    const strainFill = straining && k ? telegraphFillOf(k.castRemaining, k.castTotal) : 0;
    // Strain's rings at every intact pillar.
    let pi = 0;
    for (const c of this.chains) {
      const pillar = this.pillarAt.get(c.tool);
      if (!straining || c.broken || c.objectId < 0 || !pillar) continue;
      const fan = this.pillars[pi++];
      if (!fan) break;
      if (!fan.group.visible) {
        this.kit.layOutFan(fan, 360, {
          color: TELEGRAPH_THREAT_COLORS.danger,
          accent: TELEGRAPH_ACCENTS.frost,
        });
        this.kit.drapeFan(
          fan,
          this.groundY,
          pillar.x,
          this.groundY(pillar.x, pillar.z),
          pillar.z,
          0,
          KORGATH_TUNING.strainRadius,
        );
        fan.group.visible = true;
      }
      this.kit.paintFan(fan, {
        fill: strainFill,
        clock: this.clock,
        range: KORGATH_TUNING.strainRadius,
      });
    }
    for (; pi < this.pillars.length; pi++) this.pillars[pi].group.visible = false;
    // The chains themselves.
    for (const c of this.chains) {
      const o = this.entity(c.objectId);
      // The cuff stands at the pillar's foot for the claim's life: whole and
      // rune-lit while its chain holds, sundered once broken.
      if (o) {
        const gy0 = this.groundY(o.pos.x, o.pos.z);
        const pillar = this.pillarAt.get(c.tool);
        const face = pillar ? Math.atan2(o.pos.x - pillar.x, o.pos.z - pillar.z) : 0;
        for (const m of [c.cuff, c.cuffOpen]) {
          m.position.set(o.pos.x, gy0, o.pos.z);
          m.rotation.y = face;
        }
        c.cuff.visible = !c.broken;
        c.cuffOpen.visible = c.broken;
        c.cuffMat.uniforms.uBroken.value = c.broken ? 1 : 0;
        c.cuffMat.uniforms.uRuneOn.value = straining ? 0.6 + 0.8 * strainFill : 0.55;
      } else {
        c.cuff.visible = false;
        c.cuffOpen.visible = false;
      }
      if (!o || !k) {
        c.mesh.visible = false;
        c.glow.visible = false;
        continue;
      }
      const sx = o.pos.x;
      const sz = o.pos.z;
      const sy = this.groundY(sx, sz) + SHACKLE_Y;
      // The harness ring: the live rig's bone, else its rest spot in his frame.
      if (c.anchor) {
        c.anchor.getWorldPosition(this.v);
      } else {
        const rest = KORGATH_ANCHOR_REST[c.tool];
        const f = k.facing;
        const sc = (k.scale || 1) / 1.5;
        this.v.set(
          k.pos.x + (rest.x * Math.cos(f) + rest.z * Math.sin(f)) * sc,
          k.pos.y + rest.y * sc,
          k.pos.z + (-rest.x * Math.sin(f) + rest.z * Math.cos(f)) * sc,
        );
      }
      const whip = this.clock - c.whipAt;
      let reach = 1;
      if (c.broken) {
        if (whip > 0.85) {
          c.mesh.visible = false;
        } else {
          reach = chainWhipReach(whip / 0.85);
        }
      }
      const visible = !c.broken || whip <= 0.85;
      c.mesh.visible = visible;
      if (visible) {
        const tension = c.broken ? 0 : straining ? 0.4 + 0.6 * strainFill : 0.55;
        this.writeChain(c, this.v.x, this.v.y, this.v.z, sx, sy, sz, tension, reach, whip);
        c.mat.uniforms.uGlow.value = c.broken
          ? 0
          : straining
            ? 0.35 + 0.65 * strainFill
            : 0.08 * this.density;
        const flash = Math.max(
          0,
          1 - (this.clock - c.flashAt) / 0.6,
          c.broken ? 1 - whip / 0.4 : 0,
        );
        c.mat.uniforms.uFlash.value = flash;
      }
      // The shackle's glow, blue to goad red with its health; dark once broken.
      const shackle = this.shackleOf(c.tool, sx, sz);
      if (c.broken || !shackle) {
        c.glow.visible = false;
      } else {
        const share = shackle.maxHp > 0 ? shackle.hp / shackle.maxHp : 1;
        const gl = shackleGlow(share);
        const flick = 0.75 + 0.25 * Math.sin(this.clock * gl.flicker * 6.28 + c.objectId);
        c.glowMat.color.setRGB(gl.r, gl.g, gl.b);
        c.cuffMat.uniforms.uRune.value.setRGB(gl.r, gl.g, gl.b);
        c.glowMat.opacity = (0.55 + 0.45 * flick) * (straining ? 1.3 : 1);
        const size = 2.6 + (straining ? 1.4 * strainFill : 0);
        c.glow.scale.set(size, size, 1);
        c.glow.position.set(sx, sy, sz);
        c.glow.visible = true;
      }
    }
  }

  private shackleOf(tool: SealTool, x: number, z: number): Entity | null {
    if (!this.world) return null;
    let best: Entity | null = null;
    let bestD = 6;
    for (const e of this.world.entities.values()) {
      if (e.kind !== 'mob' || e.dead || e.templateId !== SEAL_SHACKLE_IDS[tool]) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < bestD) {
        best = e;
        bestD = d;
      }
    }
    return best;
  }

  private writeChain(
    c: ChainSlot,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    tension: number,
    reach: number,
    whip: number,
  ): void {
    const pos = c.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = this.p;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    c.mat.uniforms.uLength.value = len * reach;
    // A frame across the chain: its side and its up.
    const dx = bx - ax;
    const dz = bz - az;
    const h = Math.hypot(dx, dz) || 1;
    const sideX = dz / h;
    const sideZ = -dx / h;
    for (let i = 0; i <= CHAIN_SEGMENTS; i++) {
      const t = (i / CHAIN_SEGMENTS) * reach;
      chainPoint(ax, ay, az, bx, by, bz, t, tension, this.clock, p);
      if (reach < 1) {
        // Whipping loose: an S across the chain and a drop toward the floor.
        const s = Math.sin(t * 9 - whip * 14) * (1 - reach) * 2.2 * t;
        p.x += sideX * s;
        p.z += sideZ * s;
        p.y -= t * t * whip * 6;
      }
      for (let k = 0; k < CHAIN_SIDES; k++) {
        const a = (k / CHAIN_SIDES) * Math.PI * 2;
        const ca = Math.cos(a) * CHAIN_RADIUS;
        const sa = Math.sin(a) * CHAIN_RADIUS;
        pos.setXYZ(i * CHAIN_SIDES + k, p.x + sideX * ca, p.y + sa, p.z + sideZ * ca);
      }
    }
    pos.needsUpdate = true;
    c.mesh.geometry.computeBoundingSphere();
  }

  // ---- Velkhar ------------------------------------------------------------------------

  private stepVelkhar(): void {
    for (const s of [...this.strips, ...this.puddles]) {
      if (s.objectId < 0) continue;
      let alpha = Math.min(1, (this.clock - s.born) / 0.6);
      if (s.gone >= 0) {
        alpha = Math.max(0, 1 - (this.clock - s.gone) / 1.2);
        if (alpha <= 0) {
          s.objectId = -1;
          s.gone = -1;
          s.mesh.visible = false;
          continue;
        }
      }
      s.mat.uniforms.uAlpha.value = alpha;
      // Steam off the meltwater.
      if (s.gone < 0 && this.rand() < 0.25 * this.density) {
        const m = s.mesh;
        const u = this.rand() - 0.5;
        const t = this.rand();
        const len = m.scale.z;
        const isStrip = this.strips.includes(s);
        const px = isStrip
          ? m.position.x + Math.sin(m.rotation.y) * t * len + Math.cos(m.rotation.y) * u * m.scale.x
          : m.position.x + u * m.scale.x * 1.4;
        const pz = isStrip
          ? m.position.z + Math.cos(m.rotation.y) * t * len - Math.sin(m.rotation.y) * u * m.scale.x
          : m.position.z + (this.rand() - 0.5) * m.scale.z * 1.4;
        this.spray(this.mist, 1, px, m.position.y + 0.1, pz, {
          speed: 0.3,
          up: 1.2,
          spread: 0.5,
          life: 2.4,
          size0: 1,
          size1: 3,
          color: SANCTUM_COLORS.steam,
          alpha: 0.35,
        });
      }
    }
    for (const b of this.bubbles) {
      if (b.objectId < 0) continue;
      const left = unquenchedLeft(this.clock - b.born, VELKHAR_TUNING.riseDelay);
      b.mesh.scale.set(1.2 + 1.8 * left, 1, 1.2 + 1.8 * left);
      b.mat.uniforms.uAlpha.value = 0.4 + 0.6 * left;
      b.mat.uniforms.uTime.value = this.clock;
      if (this.rand() < 0.4 * this.density)
        this.spray(this.glow, 1, b.mesh.position.x, b.mesh.position.y, b.mesh.position.z, {
          speed: 0.2,
          up: 1.5,
          spread: 1.6,
          life: 0.8,
          size0: 0.3,
          size1: 0.05,
          color: SANCTUM_COLORS.soulViolet,
        });
    }
    for (const s of this.statues) {
      if (s.objectId < 0) continue;
      const k = Math.min(1, (this.clock - s.born) / 0.5);
      s.mesh.scale.set(1.15, 1.15 * (0.2 + 0.8 * k), 1.15);
      s.frostMat.uniforms.uAlpha.value = 0.35 + 0.2 * Math.sin(this.clock * 1.3 + s.objectId);
    }
    // The pyre about to flare: a column of soulfire climbing over its pool.
    for (const f of this.objFans) {
      if (f.objectId < 0) continue;
      const o = this.entity(f.objectId);
      if (!o) continue;
      const age = this.clock - f.born;
      if (f.templateId === SANCTUM_PYRE_FLARE) {
        const fill = Math.min(1, age / VELKHAR_TUNING.thawWarn);
        this.kit.paintFan(f, { fill, clock: this.clock, range: Math.max(1, o.scale) });
        if (this.rand() < 0.9 * this.density)
          this.spray(this.soulfire, 3, o.pos.x, this.groundY(o.pos.x, o.pos.z) + 0.3, o.pos.z, {
            speed: 0.8,
            up: 4 + 8 * fill,
            spread: 2.2,
            life: 1.2,
            size0: 2 + fill,
            size1: 0.5,
            color: 0xffffff,
          });
      } else if (f.templateId === SANCTUM_PLUNGING_FIRE) {
        const fill = Math.min(1, age / KORZUL_TUNING.plungeWarn);
        this.kit.paintFan(f, { fill, clock: this.clock, range: Math.max(1, o.scale) });
        // Embers rain on the doomed plate, thickening to the pour.
        if (this.rand() < (0.3 + 0.7 * fill) * this.density) {
          const a = this.rand() * Math.PI * 2;
          const d = Math.sqrt(this.rand()) * o.scale;
          const px = o.pos.x + Math.sin(a) * d;
          const pz = o.pos.z + Math.cos(a) * d;
          this.spray(this.fire, 1, px, this.groundY(px, pz) + 6 + 8 * this.rand(), pz, {
            speed: 0.5,
            up: -10,
            spread: 1,
            life: 0.9,
            size0: 1.4,
            size1: 0.6,
            color: 0xffffff,
          });
        }
      } else if (f.templateId === SANCTUM_LANDING_SHADOW) {
        const fill = Math.min(1, age / KORZUL_TUNING.descentWarn);
        this.kit.paintFan(f, { fill, clock: this.clock, range: Math.max(1, o.scale) });
      }
    }
  }

  // ---- Korzul -------------------------------------------------------------------------

  private stepKorzul(world: IWorld, dt: number): void {
    const z = this.entity(this.korzulId);
    if (z) {
      this.syncKorzulBody(z, false);
      this.stepEmerge(z);
    }
    // Takeoff: the airborne aura's first tick plays his TakeOff.
    if (z) {
      const up = z.auras.some((a) => a.id === KORZUL_AIRBORNE);
      if (up && !this.airborne.has(z.id)) {
        this.airborne.add(z.id);
        this.playGesture?.(z.id, KORZUL_TAKEOFF_GESTURE);
      } else if (!up) this.airborne.delete(z.id);
    }
    // The plates the breath will burn, and the plates under a Wyrm's Eye.
    const flash = new Set<number>();
    if (z && z.castingAbility === KORZUL_GRAVE_BREATH) {
      const c = this.casts.find((s) => s.casterId === z.id && s.castId === KORZUL_GRAVE_BREATH);
      if (c) for (const id of breathPlates(c.x, c.z, c.yaw, this.plateSpots)) flash.add(id);
    }
    let eye = 0;
    for (const e of world.entities.values()) {
      if (e.kind !== 'player' || e.dead) continue;
      if (e.auras.some((a) => a.id === KORZUL_WYRMS_EYE)) {
        const s = this.eyes[eye++];
        if (s) {
          const bob = Math.sin(this.clock * 3) * 0.15;
          s.position.set(e.pos.x, e.pos.y + 3.6 + bob, e.pos.z);
          const pulse = 1.6 + 0.25 * Math.sin(this.clock * 8);
          s.scale.set(pulse * 1.4, pulse, 1);
          s.visible = true;
        }
        const under = plateUnder(e.pos.x, e.pos.z, this.plateSpots);
        if (under >= 0) flash.add(under);
      }
      // A swimmer in the quench-water steams and churns it.
      if (e.auras.some((a) => a.id === SANCTUM_QUENCH_WATER) && this.rand() < dt * 6 * this.density)
        this.spray(this.mist, 2, e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.4, e.pos.z, {
          speed: 0.6,
          up: 1.6,
          spread: 1.2,
          life: 1.6,
          size0: 0.8,
          size1: 2.2,
          color: SANCTUM_COLORS.steam,
          alpha: 0.5,
        });
    }
    for (; eye < this.eyes.length; eye++) this.eyes[eye].visible = false;
    for (const p of this.plates) {
      if (p.objectId < 0) continue;
      const u = p.mat.uniforms;
      u.uFlash.value = flash.has(p.objectId) ? 1 : Math.max(0, u.uFlash.value - dt * 3);
      u.uRefreeze.value =
        p.state === 1 && p.refreeze !== null
          ? refreezeShown(p.refreeze, this.clock - p.stepAt)
          : -1;
      u.uSink.value = p.state === 2 ? Math.min(1, (this.clock - p.brokeAt) / 1.6) : 1;
      u.uShock.value = plateShock(this.clock - p.shockAt);
    }
    // The landing shadow.
    const shadowObj = this.objFans.find(
      (f) => f.templateId === SANCTUM_LANDING_SHADOW && f.objectId >= 0,
    );
    const so = shadowObj ? this.entity(shadowObj.objectId) : null;
    if (shadowObj && so) {
      const k = shadowGrowth((this.clock - shadowObj.born) / KORZUL_TUNING.descentWarn);
      const r = Math.max(1, so.scale) * 1.6 * k;
      this.shadow.position.set(so.pos.x, this.groundY(so.pos.x, so.pos.z) + 0.1, so.pos.z);
      this.shadow.scale.set(r, 1, r);
      this.shadow.rotation.y = z ? z.facing : 0;
      this.shadowMat.uniforms.uAlpha.value = 0.35 + 0.5 * k;
      this.shadow.visible = true;
    } else if (
      z &&
      this.emerge?.id === z.id &&
      this.clock - this.emerge.t0 >= KORZUL_EMERGE_RISE_AT
    ) {
      // Break Free's flight: his own shadow under him on the ice.
      const gy = this.groundY(z.pos.x, z.pos.z);
      const look = emergeShadow(Math.max(0, z.pos.y - gy));
      this.shadow.position.set(z.pos.x, gy + 0.1, z.pos.z);
      this.shadow.scale.set(look.r, 1, look.r);
      this.shadow.rotation.y = z.facing;
      this.shadowMat.uniforms.uAlpha.value = look.alpha;
      this.shadow.visible = true;
    } else this.shadow.visible = false;
  }

  /** Break Free's cinematic (sim korzul_emerge.ts): its clock from the bar
   *  (re-anchored while the bar runs, so a late frame or a snapshot's jitter
   *  never drifts it), and its beats played once each: the ice bursting at
   *  the face's foot, the takeoff, the landing clip. */
  private stepEmerge(z: Entity): void {
    if (z.castingAbility === KORZUL_BREAK_FREE && z.castTotal > 0) {
      const t0 = this.clock - Math.max(0, z.castTotal - z.castRemaining);
      if (!this.emerge || this.emerge.id !== z.id)
        this.emerge = { id: z.id, t0, last: this.clock - t0 - 1e-6 };
      else if (Math.abs(this.emerge.t0 - t0) > 0.3) this.emerge.t0 = t0;
    }
    const e = this.emerge;
    if (!e || e.id !== z.id) return;
    const t = this.clock - e.t0;
    for (const cue of emergeCuesBetween(e.last, t, KORZUL_BURST_AT)) {
      if (cue === 'burst') this.burst(z.pos.x, z.pos.z);
      else if (cue === 'takeoff') this.playGesture?.(z.id, KORZUL_TAKEOFF_GESTURE);
      else this.playGesture?.(z.id, KORZUL_EMERGE_LAND_GESTURE);
    }
    e.last = t;
    // Over: landed, or his fight already begun (a dev skip, then a bar). The
    // wake plays OUT of combat (korzul_emerge.ts), so combat never gates it.
    const fighting = z.castingAbility !== null && z.castingAbility !== KORZUL_BREAK_FREE;
    if (t > KORZUL_EMERGE_SECONDS + 1 || z.dead || fighting) this.emerge = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
