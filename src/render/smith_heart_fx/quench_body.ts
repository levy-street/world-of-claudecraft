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
//    into her mouth; when it lands a dense blast of freezing wind, snow and ice
//    shards pours out of it down the cone (the cone, its frost and its ice are
//    QuenchFx's);
//  - Tempering Strike: as both fists hit the ice, a short flash on the fists
//    only (never a white-out of the screen), a shockwave of frost, shards and
//    snow thrown (its spikes are QuenchFx's);
//  - the Blades Wake: arms raised, her crown and heart blaze, a column of cold
//    light and snow spirals up round her; thrown down, a frost wave and a
//    bright line racing to each blade (quench_wake_fx.ts);
//  - the death: frost climbs her from the feet up into an ice statue (her own
//    material, quench_statue_glaze.ts), glints climbing with it, her light
//    dying, a burst of crystals as the last of her freezes, mist off the
//    statue (the lake's refreeze is QuenchFightFx's).
// Presentation only: the fight's telegraphs are quench_fx.ts's and
// quench_fight_fx.ts's, on every tier. The low tier and reduced motion thin
// the mist, the snow, the glitter, the vapour, the rime and the shakes;
// nothing here is a warning a player reacts to.
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
  QUENCH_WAKE_LINE_SECONDS,
  QUENCH_YD_PER_UNIT,
  type QuenchBodyActionState,
  type QuenchBodyInput,
  type QuenchSocketId,
  quenchBodyAction,
  quenchDeathLook,
  quenchGlowLook,
  quenchSocketIndex,
  quenchStatueGlaze,
  quenchWakeLineLook,
} from './quench_body_core';
import {
  clearQuenchBodySockets,
  quenchBodySockets,
  retryQuenchBodySockets,
} from './quench_body_sockets';
import { QuenchRimeSteps } from './quench_rime_steps';
import { holdQuenchStatueGlaze } from './quench_statue_glaze';
import { QuenchWakeFx } from './quench_wake_fx';

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
const BLAST = {
  speed: 19,
  up: 0,
  life: 1.15,
  size: [1.2, 5] as [number, number],
  color: C.mist as readonly [number, number, number],
  alpha: 0.2,
  dir: _dir,
  spread: 0.42,
  drag: 0.9,
  floor: -1e6,
};
const BLAST_SHARDS = {
  speed: 24,
  up: 0,
  life: 0.85,
  size: [0.5, 0.12] as [number, number],
  color: C.shard as readonly [number, number, number],
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
  up: 9,
  life: 1.5,
  size: [0.5, 0.18] as [number, number],
  color: C.snow as readonly [number, number, number],
  alpha: 0.9,
  drag: 0.3,
  floor: -1e6,
};
const SPIRAL_GLOW = {
  speed: 2,
  up: 11,
  life: 1.2,
  size: [0.35, 0.06] as [number, number],
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
  private breathAt = -99;
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
    this.wake = new QuenchWakeFx(
      this.fx,
      this.uTime,
      QUENCH_BODY_POOLS.lines,
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

  /** Never claims an event: the renderer's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed || this.entityId < 0) return false;
    if (ev.type !== 'spellfx' || ev.sourceId !== this.entityId) return false;
    if (ev.fx === 'windup' && ev.ability === ARC_CLEAVE_ABILITY) {
      // Tempering Strike: her fists land on the clip's beat.
      this.strikeAt = this.clock;
      this.strikeHit = false;
    } else if (ev.ability === QUENCH_CASTS.breath) {
      this.breathAt = this.clock;
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
    this.deadAt = -1;
    this.sealed = false;
    this.strikeAt = -99;
    this.strikeHit = true;
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
    quenchBodyAction(_actIn, _act);
    const look = quenchGlowLook(_act.action, _act.k, this.clock, awake, _look);
    if (_act.action === 'breath' && _act.k > 0.95) this.flaredBreath = true;
    else if (_act.action !== 'breath') this.flaredBreath = false;
    this.lights(look.heart, look.eyes, look.crown, look.bracers, look.gather, 1);
    this.ambient(e, dt, look.plume, 1);
    this.gatherFx(dt, look.gather);
    this.exhaleFx(e);
    this.strikeFx();
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

  /** Quenching Breath loosed: a dense blast of freezing wind, snow and shards
   *  out of her mouth down the cone (QuenchFx draws the cone and its ice). */
  private exhaleFx(e: Entity): void {
    const age = this.clock - this.breathAt;
    if (age < 0 || age > 0.75) return;
    const m = this.sock[S_MOUTH];
    const eAt = fxAnchor(e);
    const gy = this.groundY(eAt.x, eAt.z);
    // Aimed down from the mouth to the cone's middle on the ice.
    const reach = QUENCH_BREATH_CONE.range * 0.55;
    const tx = eAt.x + Math.sin(e.facing) * reach;
    const tz = eAt.z + Math.cos(e.facing) * reach;
    const dx = tx - m.x;
    const dy = gy + 1 - m.y;
    const dz = tz - m.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    _dir[0] = dx / d;
    _dir[1] = dy / d;
    _dir[2] = dz / d;
    const strong = age < 0.35 ? 1 : 1 - (age - 0.35) / 0.4;
    BLAST.spread = Math.tan(QUENCH_BREATH_CONE.halfArc) * 0.7;
    BLAST_SHARDS.spread = BLAST.spread * 0.85;
    this.particles.puff(m.x, m.y, m.z, Math.round(9 * strong), BLAST);
    this.particles.puff(m.x, m.y, m.z, Math.round(7 * strong), BLAST_SHARDS);
    if (age < 1 / 30) {
      this.flash(m.x, m.y, m.z, 4.5, 0.4);
      this.shakeNear(m.x, m.z, 0.35);
    }
  }

  /** Tempering Strike: her fists land on the ice on the clip's beat. */
  private strikeFx(): void {
    if (this.strikeHit || this.clock - this.strikeAt < QUENCH_BODY_CLIP.strike) return;
    this.strikeHit = true;
    const a = this.sock[S_HANDS[0]];
    const b = this.sock[S_HANDS[1]];
    const x = (a.x + b.x) / 2;
    const z = (a.z + b.z) / 2;
    const gy = this.groundY(x, z);
    this.flash(x, gy + 1.2, z, QUENCH_BURST.flashMax * 0.7, QUENCH_BURST.flashPeak);
    this.particles.shockRing(x, z, C.ring, 9, 0.55);
    this.particles.shockRing(x, z, C.ring, 15, 1.1, { wake: 0.6, crest: 0.12, strength: 0.7 });
    this.particles.puff(x, gy + 0.6, z, 36, {
      speed: 10,
      up: 7,
      life: 1.1,
      size: [0.55, 0.15],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 16,
      drag: 0.4,
      floor: gy + 0.1,
    });
    this.particles.puff(x, gy + 0.5, z, 14, {
      speed: 6,
      up: 1.4,
      life: 1.5,
      size: [1.2, 3.6],
      color: C.mist,
      alpha: 0.2,
      drag: 1.0,
      radius: 1.5,
      floor: gy + 0.2,
    });
    this.shakeNear(x, z, 0.6);
  }

  /** The Blades Wake: the column through the bar, the spiral of snow. */
  private wakeFx(e: Entity, dt: number, column: number): void {
    const eAt = fxAnchor(e);
    const gy = this.groundY(eAt.x, eAt.z);
    this.wake.setColumn(eAt.x, gy, eAt.z, column);
    if (column > 0.02) {
      this.accSpiral += dt * 70 * column;
      while (this.accSpiral >= 1) {
        this.accSpiral -= 1;
        const a = this.clock * 3.2 + this.rand() * 0.9 + (this.rand() < 0.5 ? 0 : Math.PI);
        const r = (3.4 + this.rand() * 0.8) * U;
        const h = gy + this.rand() * BODY_H * 0.3;
        const glow = this.rand() < 0.4;
        this.particles.puff(
          eAt.x + Math.cos(a) * r,
          h,
          eAt.z + Math.sin(a) * r,
          1,
          glow ? SPIRAL_GLOW : SPIRAL,
        );
      }
    }
    // The throw's lines racing out to each blade.
    const age = this.clock - this.wakeAt;
    if (age >= 0 && age < QUENCH_WAKE_LINE_SECONDS) {
      const l = quenchWakeLineLook(age);
      for (let i = 0; i < QUENCH_BODY_POOLS.lines; i++) {
        if (i >= this.bladeCount) {
          this.wake.setLine(i, 0, 0, 0, 0, gy, 0, 0);
          continue;
        }
        this.wake.setLine(
          i,
          eAt.x,
          eAt.z,
          this.blades[i * 2],
          this.blades[i * 2 + 1],
          gy,
          l.head,
          l.alpha,
        );
      }
    } else
      for (let i = 0; i < QUENCH_BODY_POOLS.lines; i++) this.wake.setLine(i, 0, 0, 0, 0, 0, 0, 0);
  }

  /** The blades thrown awake: the frost wave out to them, a flash at her heart. */
  private wakeThrown(e: Entity): void {
    const eAt = fxAnchor(e);
    let reach = 18;
    if (this.bladeCount > 0) {
      reach = 0;
      for (let i = 0; i < this.bladeCount; i++)
        reach = Math.max(
          reach,
          Math.hypot(this.blades[i * 2] - eAt.x, this.blades[i * 2 + 1] - eAt.z),
        );
    }
    this.particles.shockRing(eAt.x, eAt.z, C.ring, reach + 2, 1.1, {
      wake: 0.5,
      crest: 0.08,
      strength: 0.85,
    });
    const h = this.sock[S_HEART];
    this.flash(h.x, h.y, h.z, QUENCH_BURST.flashMax, QUENCH_BURST.flashPeak);
    const gy = this.groundY(eAt.x, eAt.z);
    this.particles.puff(eAt.x, gy + 0.6, eAt.z, 40, {
      speed: 12,
      up: 0.6,
      life: 1.6,
      size: [2.2, 7],
      color: C.mist,
      alpha: 0.26,
      drag: 0.8,
      radius: 3,
      floor: gy + 0.2,
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
    this.glowTex?.dispose();
    clearQuenchBodySockets();
  }
}
