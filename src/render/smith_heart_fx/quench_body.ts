// The Guardian of the Quench's cold (plan: quench_body_core.ts), hosted by
// ../rift_death_zone.ts beside the raid's other fx. Her body is her own rigged
// model (characters/smith_heart_boss_looks.ts: the ice queen, her gown and hair
// on their own swaying bone chains): this module is the half of the boss that
// is COLD and LIGHT, read from IWorld (her drawn position, facing, cast bar,
// auras, death and the fight's cues, the blades' and the lines' objects) and
// from the sockets hung on her bones (quench_body_sockets.ts), so offline and
// online look the same:
//  - always: frost mist rolling off her gown's hem across the ice in a wide
//    ring, snow and ice glitter drifting round her, frozen vapour trailing off
//    her hair's tips, the star heart pulsing with light bleeding round the
//    chest wrap, her eyes, crown and bracers alight, a plume of frost on each
//    out-breath, and the lake freezing into rime under her as she walks
//    (quench_rime_steps.ts);
//  - her gestures, sent through the renderer's gesture seam: the taunt as the
//    shore ice rises at the pull, a commanding point when a slash's line
//    shows, the flare of her light as the breath is loosed and the blades are
//    thrown awake;
//  - Quenching Breath: through its bar the heart blazes and the cold is drawn
//    into her mouth; when it lands a blast of freezing wind pours down the
//    cone, thin at her (her face and heart stay seen) and thick down it: streaks
//    of wind (quench_breath_streaks.ts), ice-blue mist, dense snow and shards,
//    in a palette compensated for the Quench grade (quench_breath_core.ts; the
//    cone, its frost and its ice are QuenchFx's);
//  - Tempering Strike: on the fight's wind-up cue a second ahead of the
//    cleaving swing her fists rise high over her crown and hold (StrikeRaise)
//    while a tell reads from every side (quench_strike_windup_fx.ts: a frost
//    ring closing on her, the cleave's arc frosting over, cold light spiralling
//    into her fists); the swing's outcome then picks the gesture: the cleave
//    hammers the fists on the ice (StrikeSlam), where the lake cracks open
//    (quench_strike_cracks.ts), a short flash on the fists only (never a
//    white-out), shards and snow thrown (its spikes are QuenchFx's); an
//    avoided swing (QUENCH_CUES.strikeSpent) brings them down as a plain
//    swing and the gathered cold falls away, no slam on nothing;
//  - the Blades Wake: arms raised, her crown and heart blaze, a beam of cold
//    power climbs round her, a bright cyan core in a deep blue shell with snow
//    and shards spiralling up it and a ring flashing at its foot
//    (quench_wake_fx.ts); thrown down, a frost shockwave and ice spikes race
//    out over the lake and a line races to each blade, crystals sprouting
//    along it, each blade flaring as it arrives (quench_wake_throw.ts);
//  - the death: frost climbs her from the feet up into an ice statue (her own
//    material, quench_statue_glaze.ts), glints climbing with it, her light
//    dying, a burst of crystals as the last of her freezes, mist off the
//    statue (the lake's refreeze is QuenchFightFx's).
// Presentation only: the fight's telegraphs are quench_fx.ts's and
// quench_fight_fx.ts's, on every tier. The low tier thins the mist, the snow,
// the glitter, the vapour, the rime, the streaks and the throw's crystals and
// spikes; reduced motion the particles and the shakes; nothing here is a
// warning a player reacts to. The one event it claims is the cleave's own cue
// when her wind-up already plays its slam.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the sprites, the rime, the column
// and the lines are their own carriers, hidden until drawn); no light; fixed
// pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  bladeStateOf,
  laneOf,
  QUENCH_CASTS,
  QUENCH_CUES,
  QUENCH_OBJECTS,
  QUENCH_TUNING,
} from '../../sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { inSmithHeartClaim } from './council_fx_core';
import { ARC_CLEAVE_ABILITY } from './hammer_fx_core';
import {
  bladesAwakeOn,
  newGlowLook,
  QUENCH_BODY_CLIP,
  QUENCH_BODY_COLORS,
  QUENCH_BODY_GESTURES,
  QUENCH_BODY_POOLS,
  QUENCH_BREATH_CONE,
  QUENCH_BURST,
  QUENCH_GUARDIAN,
  QUENCH_HAIR_TIPS,
  QUENCH_HEM,
  QUENCH_RIME_POOL_LOW,
  QUENCH_RIME_STEP,
  QUENCH_SLASH_GAP,
  QUENCH_SOCKETS,
  QUENCH_YD_PER_UNIT,
  type QuenchBodyActionState,
  type QuenchBodyInput,
  type QuenchSocketId,
  quenchBodyAction,
  quenchDeathLook,
  quenchGlowLook,
  quenchSocketIndex,
  quenchStatueGlaze,
} from './quench_body_core';
import {
  clearQuenchBodySockets,
  quenchBodySockets,
  retryQuenchBodySockets,
} from './quench_body_sockets';
import {
  QUENCH_BREATH_COLORS as BC,
  QUENCH_BREATH_STREAK,
  quenchBreathBlast,
  quenchBreathMistAt,
} from './quench_breath_core';
import { QuenchBreathStreaks } from './quench_breath_streaks';
import { QuenchRimeSteps } from './quench_rime_steps';
import { holdQuenchStatueGlaze } from './quench_statue_glaze';
import {
  QUENCH_STRIKE_COLORS,
  QUENCH_STRIKE_CRACKS,
  QUENCH_STRIKE_WIND_OWNS,
  quenchStrikeWindLook,
} from './quench_strike_core';
import { QuenchStrikeCracks } from './quench_strike_cracks';
import { QuenchStrikeWindup } from './quench_strike_windup_fx';
import { QuenchWakeFx } from './quench_wake_fx';
import { QuenchWakeThrow } from './quench_wake_throw';

const SCAN_SEC = 0.1;
const C = QUENCH_BODY_COLORS;
const U = QUENCH_YD_PER_UNIT;
const S = (id: QuenchSocketId) => quenchSocketIndex(id);
const S_HEART = S('heart');
const S_CORE = S('core');
const S_MOUTH = S('mouth');
const S_EYES = [S('eyeL'), S('eyeR')] as const;
const S_CROWN = [S('crown'), S('crownL'), S('crownR')] as const;
const S_BRACERS = [S('bracerL'), S('bracerR')] as const;
const S_HANDS = [S('handL'), S('handR')] as const;
/** Tempering Strike's arc (the cleave's own numbers): the wind-up frosts it. */
const STRIKE_HALF_ARC = (QUENCH_TUNING.strikeArcDeg * Math.PI) / 360;
const S_HEM = QUENCH_HEM.map((id) => S(id));
const S_TIPS = QUENCH_HAIR_TIPS.map((id) => S(id));
/** Her height in yards (the climbing frost and the snow round her read it). */
const BODY_H = 10 * U;

// ---- scratch (no allocation a frame) -------------------------------------------------------

const _a = new THREE.Vector3();
const _dir: [number, number, number] = [0, 1, 0];
const _act: QuenchBodyActionState = { action: 'idle', k: 0 };
const _actIn: QuenchBodyInput = {
  castId: null,
  castFill: 0,
  sinceBreath: Number.POSITIVE_INFINITY,
  sinceStrike: Number.POSITIVE_INFINITY,
  sinceWake: Number.POSITIVE_INFINITY,
};
const _look = newGlowLook();
const _glaze = { height: 0, glow: 0, bite: 0, alpha: 0 };
const _wind = { gather: 0, bracers: 0 };
const _mist = { along: 0, size: 0, alpha: 0 };

/** The per-frame puffs' options, written in place where they aim. */
const HEM_MIST = {
  speed: 1.7,
  up: 0.12,
  life: 3.4,
  size: [3.2, 8] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.17,
  drag: 0.55,
  dir: _dir,
  spread: 0.35,
  floor: -1e6,
};
const SNOW = {
  speed: 0.5,
  up: -0.9,
  life: 4.2,
  size: [0.26, 0.2] as [number, number],
  color: C.snow as readonly [number, number, number],
  alpha: 0.95,
  drag: 0.4,
  radius: 9,
  floor: -1e6,
};
const GLITTER = {
  speed: 0.6,
  up: 0.35,
  life: 1.7,
  size: [0.24, 0.04] as [number, number],
  color: C.glitter as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  radius: 4.2,
  drag: 0.5,
  floor: -1e6,
};
const VAPOUR = {
  speed: 0.4,
  up: 0.45,
  life: 2,
  size: [0.9, 2.4] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.2,
  drag: 0.6,
  floor: -1e6,
};
const PLUME = {
  speed: 1.8,
  up: -0.3,
  life: 1.4,
  size: [0.35, 1.7] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.13,
  dir: _dir,
  spread: 0.25,
  drag: 0.7,
  floor: -1e6,
};
/** Tempering Strike's wind-up: the cold drawn in to her bracers. */
const GATHER = {
  speed: 6,
  life: 0.45,
  size: [0.4, 0.06] as [number, number],
  color: QUENCH_STRIKE_COLORS.gather as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  dir: _dir,
  spread: 0.04,
  drag: 0,
  floor: -1e6,
};
const DRAW_IN = {
  speed: 9,
  life: 0.55,
  size: [0.42, 0.08] as [number, number],
  color: C.glitter as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as 'glow' | undefined,
  dir: _dir,
  spread: 0.05,
  drag: 0,
  floor: -1e6,
};
/** The blast's mist, born down the cone (never a ball at her mouth). */
const BLAST = {
  speed: 9,
  up: 0.4,
  life: 1.2,
  size: [1.2, 5] as [number, number],
  color: BC.mist as readonly [number, number, number],
  alpha: 0.2,
  dir: _dir,
  spread: 0.45,
  drag: 1.1,
  floor: -1e6,
};
/** Dense snow in the wind, down the cone. */
const BLAST_SNOW = {
  speed: 20,
  up: 0,
  life: 0.9,
  size: [0.32, 0.22] as [number, number],
  color: BC.snow as readonly [number, number, number],
  alpha: 0.95,
  dir: _dir,
  spread: 0.32,
  drag: 0.5,
  floor: -1e6,
};
const BLAST_SHARDS = {
  speed: 24,
  up: 0,
  life: 0.85,
  size: [0.55, 0.12] as [number, number],
  color: BC.shard as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  dir: _dir,
  spread: 0.36,
  drag: 0.6,
  gravity: 4,
  floor: -1e6,
};
const SPIRAL = {
  speed: 2.5,
  up: 11,
  life: 1.5,
  size: [0.5, 0.18] as [number, number],
  color: BC.snow as readonly [number, number, number],
  alpha: 0.9,
  drag: 0.3,
  floor: -1e6,
};
const SPIRAL_GLOW = {
  speed: 2,
  up: 14,
  life: 1.2,
  size: [0.85, 0.12] as [number, number],
  color: C.glitter as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.3,
  floor: -1e6,
};

interface Flash {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  born: number;
  life: number;
  size: number;
  peak: number;
}

export class QuenchBody {
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
  /** Live socket places this frame (world), in QUENCH_SOCKETS order. */
  private readonly sock: THREE.Vector3[] = QUENCH_SOCKETS.map(() => new THREE.Vector3());
  private readonly rime: QuenchRimeSteps;
  private readonly wake: QuenchWakeFx;
  private readonly throwFx: QuenchWakeThrow;
  private readonly streaks: QuenchBreathStreaks;
  private readonly cracks: QuenchStrikeCracks;
  private readonly windup: QuenchStrikeWindup;
  /** The live fists and bracers this frame (the wind-up's tell reads them). */
  private readonly handsAt: THREE.Vector3[];
  private readonly bracersAt: THREE.Vector3[];
  private readonly heartCore: THREE.Sprite;
  private readonly heartHalo: THREE.Sprite;
  private readonly heartMat: THREE.SpriteMaterial;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly eyes: THREE.Sprite[] = [];
  private readonly eyeMat: THREE.SpriteMaterial;
  private readonly crown: THREE.Sprite[] = [];
  private readonly crownMat: THREE.SpriteMaterial;
  private readonly bracers: THREE.Sprite[] = [];
  private readonly bracerMat: THREE.SpriteMaterial;
  private readonly mouth: THREE.Sprite;
  private readonly mouthMat: THREE.SpriteMaterial;
  private readonly flashes: Flash[] = [];
  private readonly glowTex: THREE.Texture | null;
  /** The four blades' places (world x, z), read on the scan. */
  private readonly blades = new Float32Array(QUENCH_BODY_POOLS.lines * 2);
  private bladeCount = 0;
  private readonly seenLanes = new Set<number>();
  private entityId = -1;
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x4c1e;
  private strikeAt = -99;
  private strikeHit = true;
  /** Seconds from the strike's cue to its fists on the ice (the slam from
   *  her raised fists, or the short Strike when no wind-up was seen). */
  private strikeContact: number = QUENCH_BODY_CLIP.strike;
  /** Tempering Strike's wind-up cue (StrikeRaise) and whether it still waits
   *  on the swing's outcome. */
  private windAt = -99;
  private windPending = false;
  private breathAt = -99;
  /** The cone's bearing as the breath landed (QuenchFx lays its ice on it):
   *  the blast keeps it while she turns back to her tank. */
  private breathYaw = 0;
  private wakeAt = -99;
  private slashAt = -99;
  private deadAt = -1;
  private sealed = false;
  private flaredBreath = false;
  // accumulators for the per-frame emitters
  private accMist = 0;
  private accSnow = 0;
  private accGlitter = 0;
  private accVapour = 0;
  private accPlume = 0;
  private accDraw = 0;
  private accSpiral = 0;
  private accClimb = 0;
  private accGather = 0;
  private accStreak = 0;
  private accBlast = 0;
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
    this.root.name = 'smith-heart-quench-body';
    setRenderCategory(this.root, 'ui3d');
    this.fx.name = 'smithHeartQuenchBodyFx';
    this.fx.visible = false;
    this.root.add(this.fx);
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.low = !detail;
    this.density = detail ? 1 : 0.4;
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
    this.rime = new QuenchRimeSteps(
      this.fx,
      this.uTime,
      detail ? QUENCH_BODY_POOLS.rime : QUENCH_RIME_POOL_LOW,
      detail ? QUENCH_RIME_STEP : QUENCH_RIME_STEP * 1.8,
      this.materials,
      this.geometries,
    );
    const glowTex = hasDom ? radialGlowTexture() : null;
    this.glowTex = glowTex;
    this.wake = new QuenchWakeFx(this.fx, this.uTime, this.materials, this.geometries, glowTex);
    this.throwFx = new QuenchWakeThrow(
      this.fx,
      this.uTime,
      this.particles,
      (x, z) => this.groundY(x, z),
      QUENCH_BODY_POOLS.lines,
      this.low,
      glowTex,
      this.materials,
      this.geometries,
    );
    this.streaks = new QuenchBreathStreaks(
      this.fx,
      detail ? QUENCH_BREATH_STREAK.pool : QUENCH_BREATH_STREAK.poolLow,
      BC.streakDeep,
      BC.streakCore,
      BC.streakHot,
      this.materials,
      this.geometries,
    );
    this.cracks = new QuenchStrikeCracks(
      this.fx,
      QUENCH_STRIKE_CRACKS.pool,
      this.materials,
      this.geometries,
    );
    this.windup = new QuenchStrikeWindup(this.fx, glowTex, this.materials, this.geometries);
    this.handsAt = [this.sock[S_HANDS[0]], this.sock[S_HANDS[1]]];
    this.bracersAt = [this.sock[S_BRACERS[0]], this.sock[S_BRACERS[1]]];
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
    this.heartMat = sprite(C.heart, 'smithHeartQuenchHeart');
    this.haloMat = sprite(C.heartHalo, 'smithHeartQuenchHeartHalo');
    this.eyeMat = sprite(C.eye, 'smithHeartQuenchEye');
    this.crownMat = sprite(C.crown, 'smithHeartQuenchCrown');
    this.bracerMat = sprite(C.bracer, 'smithHeartQuenchBracer');
    this.mouthMat = sprite(C.eye, 'smithHeartQuenchMouth');
    this.materials.push(
      this.heartMat,
      this.haloMat,
      this.eyeMat,
      this.crownMat,
      this.bracerMat,
      this.mouthMat,
    );
    const mk = (mat: THREE.SpriteMaterial, name: string) => {
      const s = new THREE.Sprite(mat);
      s.name = name;
      s.visible = false;
      this.fx.add(s);
      return s;
    };
    this.heartHalo = mk(this.haloMat, 'smithHeartQuenchHeartHalo');
    this.heartCore = mk(this.heartMat, 'smithHeartQuenchHeart');
    for (let i = 0; i < 2; i++) this.eyes.push(mk(this.eyeMat, 'smithHeartQuenchEye'));
    for (let i = 0; i < S_CROWN.length; i++)
      this.crown.push(mk(this.crownMat, 'smithHeartQuenchCrown'));
    for (let i = 0; i < 2; i++) this.bracers.push(mk(this.bracerMat, 'smithHeartQuenchBracer'));
    this.mouth = mk(this.mouthMat, 'smithHeartQuenchMouth');
    for (let i = 0; i < QUENCH_BODY_POOLS.flashes; i++) {
      const mat = sprite(C.flash, 'smithHeartQuenchFlash');
      this.materials.push(mat);
      this.flashes.push({
        sprite: mk(mat, 'smithHeartQuenchFlash'),
        mat,
        born: -99,
        life: 0,
        size: 1,
        peak: 0,
      });
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
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

  private send(gesture: string): void {
    if (this.entityId >= 0) this.playGesture?.(this.entityId, gesture);
  }

  /** Claims one event only: the cleave's own cue while her wind-up waits on
   *  it (she slams from her raised fists; the renderer's short Strike would
   *  restart the gesture). Every other cue's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed || this.entityId < 0) return false;
    if (ev.type !== 'spellfx' || ev.sourceId !== this.entityId) return false;
    if (ev.fx === 'windup' && ev.ability === QUENCH_CUES.strikeReady) {
      // Tempering Strike read before it lands: fists high over her crown now,
      // held for the swing's outcome a second on.
      this.windAt = this.clock;
      this.windPending = true;
      this.windup.begin(this.clock);
      this.send(QUENCH_BODY_GESTURES.strikeRaise);
    } else if (ev.fx === 'windup' && ev.ability === ARC_CLEAVE_ABILITY) {
      this.strikeAt = this.clock;
      this.strikeHit = false;
      if (this.windPending && this.clock - this.windAt < QUENCH_STRIKE_WIND_OWNS) {
        // The cleave fired: the raised fists hammer the ice.
        this.windPending = false;
        this.windup.end('slam', this.clock);
        this.strikeContact = QUENCH_BODY_CLIP.strikeSlam;
        this.send(QUENCH_BODY_GESTURES.strikeSlam);
        return true;
      }
      // No wind-up seen (a swing that came at once): the short Strike, her
      // fists landing on its clip's beat.
      this.strikeContact = QUENCH_BODY_CLIP.strike;
    } else if (ev.fx === 'windup' && ev.ability === QUENCH_CUES.strikeSpent) {
      // The cued swing was dodged, parried or missed: no cleave, so no slam.
      // Her raised fists come down as a plain swing and the cold falls away.
      if (this.windPending) {
        this.windPending = false;
        this.windup.end('spent', this.clock);
        this.send(QUENCH_BODY_GESTURES.strikeSpent);
        this.spentFx();
      }
    } else if (ev.ability === QUENCH_CASTS.breath) {
      this.breathAt = this.clock;
      this.breathYaw = this.world.entities.get(this.entityId)?.facing ?? 0;
      this.send(QUENCH_BODY_GESTURES.flare);
    } else if (ev.ability === QUENCH_CUES.wake) {
      this.wakeAt = this.clock;
      this.send(QUENCH_BODY_GESTURES.flare);
      const e = this.world.entities.get(this.entityId);
      if (e) this.wakeThrown(e);
    } else if (ev.ability === QUENCH_CUES.rim) {
      // The pull: the shore ice heaves up and she calls the raid on.
      this.send(QUENCH_BODY_GESTURES.taunt);
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
      retryQuenchBodySockets();
    }
    if (this.entityId >= 0) {
      const e = world.entities.get(this.entityId);
      if (!e) this.release();
      else this.pose(e, dt);
    }
    this.updateFlashes();
    this.rime.update(this.clock);
    this.throwFx.update(this.clock);
    this.streaks.update(this.clock);
    this.cracks.update(this.clock);
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
    // The discovery walk runs on a roster change only, never on the clock.
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    this.bladeCount = 0;
    let slash = false;
    for (const e of world.entities.values()) {
      if (e.kind === 'mob') {
        if (this.entityId < 0 && e.templateId === QUENCH_GUARDIAN) this.adopt(e);
        continue;
      }
      if (e.kind !== 'object') continue;
      if (bladeStateOf(e.templateId) !== null) {
        if (this.bladeCount < QUENCH_BODY_POOLS.lines) {
          this.blades[this.bladeCount * 2] = e.pos.x;
          this.blades[this.bladeCount * 2 + 1] = e.pos.z;
          this.bladeCount++;
        }
      } else if (e.templateId.startsWith(QUENCH_OBJECTS.lanePrefix)) {
        const lane = laneOf(e.templateId);
        if (lane?.state === 'warn' && !this.seenLanes.has(e.id)) {
          this.seenLanes.add(e.id);
          slash = true;
        }
      }
    }
    if (this.seenLanes.size > 32) this.seenLanes.clear();
    // A slash's line shows: she points the blade on.
    if (slash && this.entityId >= 0 && this.clock - this.slashAt > QUENCH_SLASH_GAP) {
      this.slashAt = this.clock;
      const g = world.entities.get(this.entityId);
      if (g && !g.dead && !g.castingAbility) this.send(QUENCH_BODY_GESTURES.slash);
    }
  }

  private adopt(e: Entity): void {
    this.entityId = e.id;
    // Found already dead (back in view of the statue): sealed at once, never
    // the climb and its burst replayed.
    this.deadAt = e.dead ? this.clock - 30 : -1;
    this.sealed = e.dead;
    this.strikeAt = -99;
    this.strikeHit = true;
    this.windAt = -99;
    this.windPending = false;
    this.windup.hide();
    this.breathAt = -99;
    this.wakeAt = -99;
    this.rime.reset();
    this.fx.visible = true;
  }

  private release(): void {
    if (this.entityId >= 0) holdQuenchStatueGlaze(this.entityId, null);
    this.entityId = -1;
    this.rosterSeen = Number.NaN;
    this.fx.visible = false;
    this.hideBody();
  }

  private hideBody(): void {
    this.heartCore.visible = false;
    this.heartHalo.visible = false;
    this.mouth.visible = false;
    for (const s of this.eyes) s.visible = false;
    for (const s of this.crown) s.visible = false;
    for (const s of this.bracers) s.visible = false;
    this.wake.hide();
    this.throwFx.hide();
    this.streaks.hide();
    this.cracks.hide();
    this.windup.hide();
    this.rime.hide();
  }

  // ---- the sockets -------------------------------------------------------------------------

  /** Where each socket is this frame: her own bones when her view is up, else
   *  its rest place round the guardian (a view still loading). */
  private readSockets(e: Entity): void {
    const set = quenchBodySockets();
    const eAt = fxAnchor(e);
    const sinY = Math.sin(e.facing);
    const cosY = Math.cos(e.facing);
    for (let i = 0; i < QUENCH_SOCKETS.length; i++) {
      const p = set?.points[i];
      if (p) {
        p.getWorldPosition(this.sock[i]);
        continue;
      }
      const at = QUENCH_SOCKETS[i].at;
      const x = at[0] * U;
      const z = at[2] * U;
      this.sock[i].set(eAt.x + x * cosY + z * sinY, eAt.y + at[1] * U, eAt.z - x * sinY + z * cosY);
    }
  }

  // ---- the pose ------------------------------------------------------------------------------

  private pose(e: Entity, dt: number): void {
    const eAt = fxAnchor(e);
    this.readSockets(e);
    if (e.dead) {
      this.poseDead(e, dt);
      return;
    }
    if (this.deadAt >= 0) {
      // Up again (a wipe): the statue's frost lets go.
      this.deadAt = -1;
      this.sealed = false;
      holdQuenchStatueGlaze(e.id, null);
    }
    const awake = bladesAwakeOn(e.auras);
    const fill = e.castTotal > 0 ? Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal)) : 1;
    _actIn.castId = e.castingAbility;
    _actIn.castFill = fill;
    _actIn.sinceBreath = this.clock - this.breathAt;
    _actIn.sinceStrike = this.clock - this.strikeAt;
    _actIn.sinceWake = this.clock - this.wakeAt;
    // A wind-up still waiting on its swing: a bar that took her body, or a
    // hold that ran out, lets it go (the fight cues the held swing afresh).
    if (
      this.windPending &&
      (e.castingAbility !== null || this.clock - this.windAt >= QUENCH_STRIKE_WIND_OWNS)
    ) {
      this.windPending = false;
      this.windup.end('spent', this.clock);
    }
    _actIn.sinceWind = this.windPending ? this.clock - this.windAt : Number.POSITIVE_INFINITY;
    quenchBodyAction(_actIn, _act);
    const look = quenchGlowLook(_act.action, _act.k, this.clock, awake, _look);
    if (_act.action === 'breath' && _act.k > 0.95) this.flaredBreath = true;
    else if (_act.action !== 'breath') this.flaredBreath = false;
    this.lights(look.heart, look.eyes, look.crown, look.bracers, look.gather, 1);
    this.ambient(e, dt, look.plume, 1);
    this.gatherFx(dt, look.gather);
    this.exhaleFx(e, dt);
    this.windFx(dt);
    this.windup.update(
      this.clock,
      eAt.x,
      this.groundY(eAt.x, eAt.z),
      eAt.z,
      e.facing,
      this.handsAt,
      this.bracersAt,
      STRIKE_HALF_ARC,
      QUENCH_TUNING.strikeRange,
      U,
    );
    this.strikeFx(e);
    this.wakeFx(e, dt, look.column);
    const gy = this.groundY(eAt.x, eAt.z);
    this.rime.step(eAt.x, gy, eAt.z, this.clock);
  }

  /** Her light: the heart (core and the halo bleeding round the wrap), the
   *  eyes, the crown's shards, the bracers, the mouth while the cold gathers. */
  private lights(
    heart: number,
    eyes: number,
    crown: number,
    bracers: number,
    gather: number,
    life: number,
  ): void {
    const h = this.sock[S_HEART];
    this.heartCore.visible = life > 0.01;
    this.heartHalo.visible = life > 0.01;
    this.heartCore.position.copy(h);
    this.heartHalo.position.copy(h);
    const hc = Math.min(2.4, heart);
    this.heartCore.scale.setScalar((0.9 + 0.5 * hc) * U);
    this.heartMat.opacity = Math.min(1, 0.55 + 0.25 * hc) * life;
    this.heartHalo.scale.setScalar((2.6 + 1.6 * hc) * U);
    this.haloMat.opacity = Math.min(0.85, 0.22 + 0.2 * hc) * life;
    for (let i = 0; i < 2; i++) {
      const s = this.eyes[i];
      s.visible = life > 0.01;
      s.position.copy(this.sock[S_EYES[i]]);
      s.scale.setScalar((0.45 + 0.25 * Math.min(2, eyes)) * U);
    }
    this.eyeMat.opacity = Math.min(1, 0.6 + 0.3 * eyes) * life;
    for (let i = 0; i < this.crown.length; i++) {
      const s = this.crown[i];
      s.visible = life > 0.01;
      s.position.copy(this.sock[S_CROWN[i]]);
      s.scale.setScalar((i === 0 ? 1.3 : 0.9) * (0.7 + 0.5 * Math.min(3.5, crown)) * U);
    }
    this.crownMat.opacity = Math.min(1, 0.25 + 0.3 * crown) * life;
    for (let i = 0; i < 2; i++) {
      const s = this.bracers[i];
      s.visible = life > 0.01;
      s.position.copy(this.sock[S_BRACERS[i]]);
      s.scale.setScalar((1.1 + 0.5 * Math.min(2.5, bracers)) * U);
    }
    this.bracerMat.opacity = Math.min(0.9, 0.18 + 0.28 * bracers) * life;
    this.mouth.visible = gather > 0.02;
    if (this.mouth.visible) {
      this.mouth.position.copy(this.sock[S_MOUTH]);
      this.mouth.scale.setScalar((0.6 + 1.6 * gather) * U);
      this.mouthMat.opacity = Math.min(1, 0.3 + 0.7 * gather);
    }
  }

  /** The always-on cold: the hem's mist ring, the snow and glitter round her,
   *  the hair's vapour, the out-breath's plume. `life` 0..1 (the death). */
  private ambient(e: Entity, dt: number, plume: number, life: number): void {
    const eAt = fxAnchor(e);
    const gy = this.groundY(eAt.x, eAt.z);
    // The hem: mist rolling outward over the ice.
    this.accMist += dt * 2.6 * S_HEM.length * life;
    while (this.accMist >= 1) {
      this.accMist -= 1;
      const p = this.sock[S_HEM[Math.floor(this.rand() * S_HEM.length)]];
      const dx = p.x - eAt.x;
      const dz = p.z - eAt.z;
      const d = Math.hypot(dx, dz) || 1;
      _dir[0] = dx / d;
      _dir[1] = 0.05;
      _dir[2] = dz / d;
      this.particles.puff(p.x, gy + 0.45, p.z, 1, HEM_MIST);
    }
    // Snow drifting down round her, glitter in the air about her body.
    this.accSnow += dt * 16 * life;
    while (this.accSnow >= 1) {
      this.accSnow -= 1;
      this.particles.puff(eAt.x, gy + 2 + this.rand() * BODY_H, eAt.z, 1, SNOW);
    }
    this.accGlitter += dt * 12 * life;
    while (this.accGlitter >= 1) {
      this.accGlitter -= 1;
      this.particles.puff(eAt.x, gy + 1 + this.rand() * BODY_H * 0.85, eAt.z, 1, GLITTER);
    }
    // Frozen vapour off her hair's tips.
    this.accVapour += dt * 2.4 * S_TIPS.length * life;
    while (this.accVapour >= 1) {
      this.accVapour -= 1;
      const p = this.sock[S_TIPS[Math.floor(this.rand() * S_TIPS.length)]];
      this.particles.puff(p.x, p.y, p.z, 1, VAPOUR);
    }
    // A plume of frost on each out-breath, down and forward of her mouth.
    if (plume > 0.08) {
      this.accPlume += dt * 5 * plume;
      while (this.accPlume >= 1) {
        this.accPlume -= 1;
        const m = this.sock[S_MOUTH];
        _dir[0] = Math.sin(e.facing) * 0.8;
        _dir[1] = -0.45;
        _dir[2] = Math.cos(e.facing) * 0.8;
        this.particles.puff(m.x, m.y, m.z, 1, PLUME);
      }
    }
  }

  /** Quenching Breath's draw: crystals of cold pulled in to her mouth. */
  private gatherFx(dt: number, gather: number): void {
    if (gather <= 0.02) return;
    const m = this.sock[S_MOUTH];
    this.accDraw += dt * 60 * gather;
    while (this.accDraw >= 1) {
      this.accDraw -= 1;
      const a = this.rand() * Math.PI * 2;
      const el = (this.rand() - 0.35) * 1.2;
      const r = (5 + this.rand() * 4) * U;
      const x = m.x + Math.cos(a) * r * Math.cos(el);
      const y = m.y + Math.sin(el) * r * 0.6;
      const z = m.z + Math.sin(a) * r * Math.cos(el);
      const dx = m.x - x;
      const dy = m.y - y;
      const dz = m.z - z;
      const d = Math.hypot(dx, dy, dz) || 1;
      _dir[0] = dx / d;
      _dir[1] = dy / d;
      _dir[2] = dz / d;
      DRAW_IN.speed = d / DRAW_IN.life;
      DRAW_IN.pool = this.rand() < 0.65 ? 'glow' : undefined;
      DRAW_IN.size[0] = DRAW_IN.pool ? 0.42 : 1.4;
      DRAW_IN.alpha = DRAW_IN.pool ? 1 : 0.22;
      this.particles.puff(x, y, z, 1, DRAW_IN);
    }
  }

  /** Quenching Breath loosed: the wind tears down the cone (QuenchFx draws
   *  the cone and its ice). Thin at her: streaks are born a few yards out,
   *  the mist only from a fifth of the way down, thickening outward; at her
   *  mouth only a narrow jet of shards, so her face and her heart stay seen. */
  private exhaleFx(e: Entity, dt: number): void {
    const age = this.clock - this.breathAt;
    const strong = quenchBreathBlast(age);
    if (strong <= 0) return;
    const m = this.sock[S_MOUTH];
    const eAt = fxAnchor(e);
    const gy = this.groundY(eAt.x, eAt.z);
    const yaw = this.breathYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const range = QUENCH_BREATH_CONE.range;
    const half = QUENCH_BREATH_CONE.halfArc;
    // The jet: from her mouth down to the cone's middle on the ice.
    const reach = range * 0.55;
    const dx0 = eAt.x + fx * reach - m.x;
    const dy0 = gy + 1 - m.y;
    const dz0 = eAt.z + fz * reach - m.z;
    const d0 = Math.hypot(dx0, dy0, dz0) || 1;
    const jx = dx0 / d0;
    const jy = dy0 / d0;
    const jz = dz0 / d0;
    _dir[0] = jx;
    _dir[1] = jy;
    _dir[2] = jz;
    BLAST_SHARDS.spread = Math.tan(half) * 0.45;
    this.particles.puff(m.x, m.y, m.z, Math.round(6 * strong), BLAST_SHARDS);
    // The streaks of wind, born out of her face's way, fanned over the cone.
    this.accStreak += dt * QUENCH_BREATH_STREAK.rate * strong;
    while (this.accStreak >= 1) {
      this.accStreak -= 1;
      const a = yaw + (this.rand() * 2 - 1) * half * 0.9;
      const tr = range * (0.45 + this.rand() * 0.55);
      const tx = eAt.x + Math.sin(a) * tr;
      const tz = eAt.z + Math.cos(a) * tr;
      const ty = gy + 0.4 + this.rand() * 2.2;
      const ox = m.x + jx * QUENCH_BREATH_STREAK.bornOut;
      const oy = m.y + jy * QUENCH_BREATH_STREAK.bornOut;
      const oz = m.z + jz * QUENCH_BREATH_STREAK.bornOut;
      const sx = tx - ox;
      const sy = ty - oy;
      const sz = tz - oz;
      const sd = Math.hypot(sx, sy, sz) || 1;
      this.streaks.emit(this.clock, ox, oy, oz, sx / sd, sy / sd, sz / sd, this.rand());
    }
    // The mist and the snow, born down the cone and blown on out of it.
    this.accBlast += dt * 70 * strong;
    while (this.accBlast >= 1) {
      this.accBlast -= 1;
      const look = quenchBreathMistAt(this.rand(), _mist);
      const a = yaw + (this.rand() * 2 - 1) * half * look.along * 0.95;
      const r = range * look.along;
      const px = eAt.x + Math.sin(a) * r;
      const pz = eAt.z + Math.cos(a) * r;
      _dir[0] = Math.sin(a);
      _dir[1] = 0.04;
      _dir[2] = Math.cos(a);
      BLAST.size[0] = look.size * 0.5;
      BLAST.size[1] = look.size;
      BLAST.alpha = look.alpha;
      this.particles.puff(px, gy + 0.6 + look.size * 0.25, pz, 1, BLAST);
      if (this.rand() < 0.8) this.particles.puff(px, gy + 0.8 + this.rand() * 3, pz, 2, BLAST_SNOW);
    }
    if (age < 1 / 30) {
      this.flash(m.x, m.y, m.z, 3.5, 0.35);
      this.shakeNear(m.x, m.z, 0.35);
    }
  }

  /** Tempering Strike's wind-up: the cold drawn in to her raised bracers,
   *  crystals forming on them, building to the slam. */
  private windFx(dt: number): void {
    if (!this.windPending) return;
    const look = quenchStrikeWindLook(Math.min(this.clock - this.windAt, 0.99), _wind);
    if (look.gather <= 0.02) return;
    this.accGather += dt * 70 * look.gather;
    while (this.accGather >= 1) {
      this.accGather -= 1;
      const p = this.sock[S_BRACERS[this.rand() < 0.5 ? 0 : 1]];
      const a = this.rand() * Math.PI * 2;
      const el = (this.rand() - 0.5) * 1.6;
      const r = (2.2 + this.rand() * 2.6) * U;
      const x = p.x + Math.cos(a) * r * Math.cos(el);
      const y = p.y + Math.sin(el) * r;
      const z = p.z + Math.sin(a) * r * Math.cos(el);
      const dx = p.x - x;
      const dy = p.y - y;
      const dz = p.z - z;
      const d = Math.hypot(dx, dy, dz) || 1;
      _dir[0] = dx / d;
      _dir[1] = dy / d;
      _dir[2] = dz / d;
      GATHER.speed = d / GATHER.life;
      this.particles.puff(x, y, z, 1, GATHER);
    }
  }

  /** Tempering Strike: her fists land on the ice on the slam's contact (from
   *  her raised fists, or the short Strike's when no wind-up was seen), once,
   *  and only ever for a cleave that fired. */
  private strikeFx(e: Entity): void {
    if (!this.strikeHit && this.clock - this.strikeAt >= this.strikeContact) {
      this.strikeHit = true;
      this.slam(e);
    }
  }

  /** An avoided swing: the cold gathered on her fists scatters off them. */
  private spentFx(): void {
    for (const p of this.handsAt) {
      this.particles.puff(p.x, p.y, p.z, 14, {
        speed: 4,
        up: -1,
        life: 0.9,
        size: [0.35, 0.08],
        color: QUENCH_STRIKE_COLORS.gather,
        alpha: 1,
        pool: 'glow',
        gravity: 6,
        drag: 0.6,
        floor: -1e6,
      });
    }
  }

  /** The fists on the ice: the lake cracks open from a shattered crater
   *  (no bright ring over it: QuenchFx's spikes carry the arc), a short flash
   *  on the fists only, shards and snow thrown. */
  private slam(e: Entity): void {
    const a = this.sock[S_HANDS[0]];
    const b = this.sock[S_HANDS[1]];
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    const gy = this.groundY(x, z);
    this.cracks.open(x, gy, z, e.facing, this.clock);
    this.flash(x, gy + 1.2, z, QUENCH_BURST.flashMax * 0.55, QUENCH_BURST.flashPeak * 0.8);
    this.particles.puff(x, gy + 0.6, z, 44, {
      speed: 11,
      up: 8,
      life: 1.1,
      size: [0.6, 0.15],
      color: BC.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 16,
      drag: 0.4,
      floor: gy + 0.1,
    });
    this.particles.puff(x, gy + 0.6, z, 26, {
      speed: 8,
      up: 5,
      life: 1.3,
      size: [0.34, 0.22],
      color: BC.snow,
      alpha: 0.95,
      gravity: 6,
      drag: 0.6,
      floor: gy + 0.1,
    });
    this.particles.puff(x, gy + 0.5, z, 16, {
      speed: 6,
      up: 1.4,
      life: 1.5,
      size: [1.2, 3.8],
      color: BC.mist,
      alpha: 0.26,
      drag: 1.0,
      radius: 1.5,
      floor: gy + 0.2,
    });
    this.shakeNear(x, z, 0.6);
  }

  /** The Blades Wake: the beam through the bar, snow and shards spiralling
   *  up it the whole height of the column. */
  private wakeFx(e: Entity, dt: number, column: number): void {
    const eAt = fxAnchor(e);
    const gy = this.groundY(eAt.x, eAt.z);
    this.wake.setColumn(eAt.x, gy, eAt.z, column);
    if (column <= 0.02) return;
    this.accSpiral += dt * 120 * column;
    while (this.accSpiral >= 1) {
      this.accSpiral -= 1;
      const a = this.clock * 3.2 + this.rand() * 0.9 + (this.rand() < 0.5 ? 0 : Math.PI);
      const r = (3.6 + this.rand() * 1.2) * U;
      const h = gy + this.rand() * BODY_H * 1.4 * column;
      const glow = this.rand() < 0.45;
      this.particles.puff(
        eAt.x + Math.cos(a) * r,
        h,
        eAt.z + Math.sin(a) * r,
        1,
        glow ? SPIRAL_GLOW : SPIRAL,
      );
    }
  }

  /** The blades thrown awake: the throw (the frost shockwave, the spikes,
   *  the lines to the blades), a flash at her heart, frost rolling out. */
  private wakeThrown(e: Entity): void {
    const eAt = fxAnchor(e);
    this.throwFx.begin(eAt.x, eAt.z, this.blades, this.bladeCount, this.clock);
    const h = this.sock[S_HEART];
    this.flash(h.x, h.y, h.z, QUENCH_BURST.flashMax, QUENCH_BURST.flashPeak);
    const gy = this.groundY(eAt.x, eAt.z);
    this.particles.puff(eAt.x, gy + 0.6, eAt.z, 40, {
      speed: 14,
      up: 0.6,
      life: 1.6,
      size: [2.2, 7],
      color: BC.mist,
      alpha: 0.3,
      drag: 0.8,
      radius: 3,
      floor: gy + 0.2,
    });
    this.particles.puff(eAt.x, gy + 1, eAt.z, 50, {
      speed: 16,
      up: 6,
      life: 1.2,
      size: [0.6, 0.14],
      color: BC.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 12,
      drag: 0.4,
      radius: 3,
      floor: gy + 0.1,
    });
    this.shakeNear(eAt.x, eAt.z, 0.55);
  }

  // ---- the death ------------------------------------------------------------------------------

  private poseDead(e: Entity, dt: number): void {
    if (this.deadAt < 0) {
      this.deadAt = this.clock;
      this.sealed = false;
    }
    const t = this.clock - this.deadAt;
    const d = quenchDeathLook(t);
    holdQuenchStatueGlaze(e.id, quenchStatueGlaze(t, _glaze));
    this.lights(0.6 * d.glow, 0.8 * d.glow, 0.6 * d.glow, 0.5 * d.glow, 0, d.glow);
    this.wake.hide();
    this.windPending = false;
    this.windup.hide();
    // Glints climbing her with the frost.
    const eAt = fxAnchor(e);
    const gy = this.groundY(eAt.x, eAt.z);
    if (d.frost > 0 && d.frost < 1.04) {
      this.accClimb += dt * 45;
      while (this.accClimb >= 1) {
        this.accClimb -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = (0.9 + this.rand() * 1.3) * U;
        this.particles.puff(
          eAt.x + Math.cos(a) * r,
          gy + d.frost * BODY_H * 0.8,
          eAt.z + Math.sin(a) * r,
          1,
          GLITTER,
        );
      }
    }
    if (!this.sealed && d.sealed > 0) {
      // The last of her freezes: a burst of crystals off the statue.
      this.sealed = true;
      const h = this.sock[S_CORE];
      this.flash(h.x, h.y, h.z, QUENCH_BURST.flashMax * 0.6, 0.5);
      this.particles.puff(h.x, h.y, h.z, 50, {
        speed: 7,
        up: 2,
        life: 1.4,
        size: [0.5, 0.1],
        color: C.shard,
        alpha: 1,
        pool: 'glow',
        gravity: 8,
        drag: 0.5,
        floor: gy + 0.1,
      });
      this.shakeNear(h.x, h.z, 0.3);
    }
    // Mist breathing off the statue, low over the ice.
    if (d.mist > 0.02) {
      this.accMist += dt * 6 * d.mist;
      while (this.accMist >= 1) {
        this.accMist -= 1;
        const p = this.sock[S_HEM[Math.floor(this.rand() * S_HEM.length)]];
        _dir[0] = p.x - eAt.x;
        _dir[1] = 0.05;
        _dir[2] = p.z - eAt.z;
        const n = Math.hypot(_dir[0], _dir[2]) || 1;
        _dir[0] /= n;
        _dir[2] /= n;
        this.particles.puff(p.x, gy + 0.45, p.z, 1, HEM_MIST);
      }
    }
  }

  // ---- flashes ---------------------------------------------------------------------------------

  /** A short bounded flash on a point (never a screen-filling white-out). */
  private flash(x: number, y: number, z: number, size: number, peak: number): void {
    let slot = this.flashes[0];
    for (const f of this.flashes) if (f.born < slot.born) slot = f;
    slot.born = this.clock;
    slot.life = 0.35;
    slot.size = Math.min(QUENCH_BURST.flashMax, size);
    slot.peak = Math.min(QUENCH_BURST.flashPeak, peak);
    slot.mat.opacity = slot.peak;
    slot.sprite.position.set(x, y, z);
    slot.sprite.visible = true;
  }

  private updateFlashes(): void {
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      const k = (this.clock - f.born) / f.life;
      if (k >= 1) {
        f.sprite.visible = false;
        continue;
      }
      f.sprite.scale.setScalar(f.size * (0.6 + 0.4 * k));
      f.mat.opacity = f.peak * (1 - k) ** 0.5;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.entityId >= 0) holdQuenchStatueGlaze(this.entityId, null);
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.rime.mesh.dispose();
    this.throwFx.dispose();
    this.streaks.dispose();
    this.glowTex?.dispose();
    clearQuenchBodySockets();
  }
}
