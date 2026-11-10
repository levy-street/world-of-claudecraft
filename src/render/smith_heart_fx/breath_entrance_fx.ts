// The Guardian of the Breath's entrance, "Calm before the storm" (plan:
// breath_entrance_core.ts), hosted by ../rift_death_zone.ts beside the
// raid's other fx and updated before the guardian's own painters: it reads
// the scene's clock off the guardian's aura (IWorld only, so offline and
// online look the same), sends the rig's stances through the gesture seam
// (gathered into nothing on its Gathered clip, the Form one-shot inside the
// funnel, then its own calm stance), holds its look for the body's air
// (breath_entrance_state.ts) and draws the rest:
//  - the calm: the Cornice's loose stone and dust hanging still in the air
//    (one instanced draw), a dark smudge of cloud high over the middle;
//  - the pull: every piece drawn up to it in tightening spirals, grit
//    streaming up, the smudge swelling into the turning eye, the rising howl;
//  - the storm (breath_entrance_storm.ts): the funnel coming down out of the
//    eye, lit from within, stone orbiting it, its dust skirt, and its burst
//    into the ring of gust across the Cornice (cosmetic: no damage, no
//    knockback), the stone flung out;
//  - the lightning (breath_entrance_bolts.ts): strikes onto the floor at its
//    foot, the bolt down its heart as it touches, arcs crawling over it, the
//    strikes round the guardian and the great bolt onto it; the burst of
//    light at the burst and the great bolt (a flash on it, never a white-out;
//    none under reduced motion), the thuds, the thunder.
// No camera is taken, no control: the player plays through it. No voice.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated (the
// compile gate links every program before the first frame that draws it);
// fixed pools, no light, no per-frame allocation; the rig's own materials are
// never written (it is hidden by its Gathered clip, never by its material).
// The low tier thins the particles and the flying stone; every beat plays on
// every tier.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { BREATH_GUARDIAN } from '../../sim/encounters/smith_heart/breath_ids';
import { BREATH_INTRO } from '../../sim/encounters/smith_heart/breath_intro_plan';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { BREATH_BODY_GESTURES } from './breath_body_core';
import { BreathEntranceBolts } from './breath_entrance_bolts';
import {
  AWAKE,
  BOLT_FLICKERS,
  BOLT_LIFE,
  BREATH_ENTRANCE,
  BREATH_ENTRANCE_GESTURES,
  BREATH_ENTRANCE_HEARD_AT,
  BREATH_ENTRANCE_HOWL,
  BREATH_ENTRANCE_LOW_SHARE,
  BREATH_ENTRANCE_POOLS,
  BREATH_ENTRANCE_SOUNDS,
  BREATH_STORM_SHAPE,
  BREATH_STRIKES,
  type BreathEntranceClock,
  type BreathEntranceLook,
  type BreathEntranceStance,
  breathEntranceClock,
  breathEntranceFlash,
  breathEntranceFlicker,
  breathEntranceLight,
  breathEntranceLook,
  breathEntrancePicks,
  breathEntranceShake,
  CRAWLERS,
  crawlerArc,
  crossedBreathBeat,
  funnelRadius,
  HANGING_STONE,
  hangingAt,
  newBreathEntranceLook,
  newFlyingPiece,
  ORBIT_STONE,
  orbitAt,
  REDUCED_LIGHT_CAP,
  stepBreathEntranceTime,
  strikeLight,
  strikeLightSteady,
} from './breath_entrance_core';
import { GRANITE_FRAG } from './breath_entrance_glsl';
import { holdBreathEntrance } from './breath_entrance_state';
import { BreathEntranceStorm } from './breath_entrance_storm';
import { GLOW_FRAG, GLOW_VERT, STONE_VERT } from './council_entrance_glsl';
import { rockGeometry } from './council_entrance_stone';
import { inSmithHeartClaim } from './council_fx_core';

const SCAN_SEC = 0.25;
/** Seconds between re-sends of the held stance (a rebuilt view picks it up). */
const RESEND_SEC = 0.35;
const E = BREATH_ENTRANCE;
const P = BREATH_ENTRANCE_POOLS;
const SH = BREATH_STORM_SHAPE;
const G = BREATH_ENTRANCE_GESTURES;
const HOWL_LOOP = 'heart-breath-entrance-howl';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _axis = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _piece = newFlyingPiece();
const _arc = { seed: 0, h0: 0, h1: 0, a0: 0, a1: 0, light: 0 };
const _toEye: [number, number, number] = [0, 1, 0];
const _out: [number, number, number] = [1, 0, 0];

export class BreathEntranceFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** The guardian's foot (stage-local yards for everything the scene draws). */
  private readonly stage = new THREE.Group();
  readonly uTime = { value: 0 };
  readonly density: number;
  readonly detail: boolean;
  readonly particles: EngineParticles;
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly storm: BreathEntranceStorm;
  readonly bolts: BreathEntranceBolts;
  private readonly hanging: THREE.InstancedMesh;
  private readonly hangPicks: number[];
  private readonly orbiting: THREE.InstancedMesh;
  private readonly orbitPicks: number[];
  private readonly graniteMat: THREE.ShaderMaterial;
  private readonly flash: THREE.InstancedMesh;
  private readonly look = newBreathEntranceLook();
  private readonly clockRead: BreathEntranceClock = { stage: 'none', t: 0 };
  private id = -1;
  private sent: BreathEntranceStance | null = null;
  private rosterSeen = Number.NaN;
  private placed = false;
  private time = AWAKE;
  /** The painter's time a frame ago (the beats' crossing reads it). */
  private beatPrev = AWAKE;
  /** The scene was cut short (a forced pull) and jumped to the burst. */
  private cut = false;
  private scanTimer = 0;
  private resendIn = 0;
  private howling = false;
  private owed = { motes: 0, grit: 0, skirt: 0, ring: 0 };
  private clock = 0;
  private seed = 0xb4ea;
  private disposed = false;
  /** Did the scene cross `at` this frame, as the painter plays it (a scene
   *  cut short plays only the burst and after)? */
  private readonly crossed = (at: number): boolean =>
    crossedBreathBeat(this.beatPrev, this.time, at) && (!this.cut || at >= E.burstAt);

  constructor(
    scene: THREE.Scene,
    private readonly ground: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly motionReduced: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'smith-heart-breath-entrance';
    setRenderCategory(this.root, 'ui3d');
    this.stage.name = 'smithHeartBreathEntranceStage';
    this.stage.visible = false;
    this.root.add(this.stage);
    this.detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = this.detail ? 1 : BREATH_ENTRANCE_LOW_SHARE;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.ground(x, z),
      () => this.rand(),
      () => this.motionReduced(),
      hasDom ? getFlameTex() : null,
    );
    this.storm = new BreathEntranceStorm(this.stage, this);
    this.bolts = new BreathEntranceBolts(this.stage, this);

    // ---- the flying granite: the hanging stone and the orbiting stone ----
    this.graniteMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceGranite',
      uniforms: { uFlash: { value: 0 } },
      vertexShader: STONE_VERT,
      fragmentShader: GRANITE_FRAG,
    });
    this.materials.push(this.graniteMat);
    const rock = rockGeometry(71, 0.42);
    this.geometries.push(rock);
    this.hangPicks = breathEntrancePicks(HANGING_STONE.length, this.detail);
    this.hanging = new THREE.InstancedMesh(rock, this.graniteMat, this.hangPicks.length);
    this.hanging.name = 'smithHeartBreathEntranceHanging';
    this.orbitPicks = breathEntrancePicks(ORBIT_STONE.length, this.detail);
    this.orbiting = new THREE.InstancedMesh(rock, this.graniteMat, this.orbitPicks.length);
    this.orbiting.name = 'smithHeartBreathEntranceOrbit';
    for (const m of [this.hanging, this.orbiting]) {
      m.frustumCulled = false;
      m.visible = false;
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, _zero);
      this.stage.add(m);
    }

    // ---- the flash: a burst of light on the guardian ----
    const card = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(card);
    const flashMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathEntranceFlash',
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(flashMat);
    this.flash = new THREE.InstancedMesh(card, flashMat, 1);
    this.flash.name = 'smithHeartBreathEntranceFlash';
    this.flash.frustumCulled = false;
    this.flash.visible = false;
    this.flash.renderOrder = 10_000;
    this.flash.setMatrixAt(0, _zero);
    this.flash.setColorAt(0, _c.setRGB(0, 0, 0));
    this.stage.add(this.flash);

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** The entrance's look (tests read it). */
  get currentLook(): BreathEntranceLook {
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
    const e = this.id >= 0 ? (world.entities.get(this.id) ?? null) : null;
    if (!e || e.dead) {
      if (this.id >= 0 && (!e || e.dead)) this.release();
      this.particles.update(this.clock);
      return;
    }
    const prev = this.time;
    const next = stepBreathEntranceTime(prev, dt, breathEntranceClock(e.auras, this.clockRead));
    // Cut short (the aura gone before the burst): the burst plays at once.
    if (prev >= 0 && this.clockRead.stage === 'none' && next >= 0 && next - prev > dt + 0.25)
      this.cut = true;
    if (next < 0) this.cut = false;
    this.time = next;
    this.beatPrev = prev;
    const look = breathEntranceLook(this.time, this.look);
    if (this.cut) {
      // Cut short: the burst alone, its body whole, no storm before it.
      look.body = 1;
      look.reach = 1;
    }
    holdBreathEntrance(e.id, look.active ? look : null);
    this.stance(e, look, dt);
    this.particles.update(this.clock);
    this.howl(e, look);
    if (!look.active) {
      if (this.stage.visible) this.hide();
      this.placed = false;
      return;
    }
    if (!this.placed) this.place(e);
    this.stage.visible = true;
    this.paint(look, dt);
  }

  // ---- the scan --------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    if (this.id >= 0 && !world.entities.has(this.id)) this.release();
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.id >= 0) this.release();
      this.rosterSeen = Number.NaN;
      return;
    }
    if (this.id >= 0) return;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind === 'mob' && e.templateId === BREATH_GUARDIAN) {
        this.id = e.id;
        break;
      }
    }
  }

  private release(): void {
    if (this.id >= 0) holdBreathEntrance(this.id, null);
    this.id = -1;
    this.sent = null;
    this.rosterSeen = Number.NaN;
    this.time = AWAKE;
    this.beatPrev = AWAKE;
    this.cut = false;
    this.placed = false;
    this.hide();
  }

  private hide(): void {
    this.stage.visible = false;
    this.storm.hide();
    this.bolts.hide();
    this.hanging.visible = false;
    this.orbiting.visible = false;
    this.flash.visible = false;
    this.particles.hideRings();
    this.stopHowl();
  }

  /** Stand the stage on the guardian's foot (it is held still through the
   *  scene: once per scene). */
  private place(e: Entity): void {
    this.stage.position.set(e.pos.x, this.ground(e.pos.x, e.pos.z), e.pos.z);
    this.stage.updateMatrixWorld();
    this.placed = true;
  }

  // ---- the stance ------------------------------------------------------------------------------

  /** The rig's stance through the gesture seam: gathered (re-sent), the Form
   *  one-shot once as it crosses its beat, then its calm stance. A beat never
   *  seen crossing (joined after it): calm at once, no replayed Form. */
  private stance(e: Entity, look: BreathEntranceLook, dt: number): void {
    if (!this.playGesture) return;
    this.resendIn -= dt;
    const resend = this.resendIn <= 0;
    if (resend) this.resendIn = RESEND_SEC;
    const formNow =
      crossedBreathBeat(this.beatPrev, this.time, E.formAt) ||
      (this.cut && this.sent === 'gathered');
    let want: BreathEntranceStance = look.active ? look.stance : 'stand';
    if (formNow) want = 'form';
    else if (want === 'form' && this.sent !== 'form') want = 'stand';
    if (want !== this.sent) {
      // Never stand a rig nobody has seen gathered: calm is its own stance.
      if (!(want === 'stand' && this.sent === null)) {
        this.playGesture(
          e.id,
          want === 'gathered' ? G.gathered : want === 'form' ? G.form : BREATH_BODY_GESTURES.calm,
        );
      }
      this.sent = want;
    } else if (resend && want === 'gathered') this.playGesture(e.id, G.gathered);
    if (!look.active && this.sent === 'form') this.sent = 'stand';
  }

  // ---- the paint -------------------------------------------------------------------------------

  private paint(L: BreathEntranceLook, dt: number): void {
    const reduced = this.motionReduced();
    const cut = this.cut;
    const crossed = this.crossed;
    const sy = this.stage.position.y;
    const flick = breathEntranceFlicker(L, reduced);
    // The storm.
    _frame.eye = L.eye;
    _frame.eyeR = L.eyeR;
    _frame.eyeTurn = L.eyeTurn;
    _frame.reach = L.reach;
    _frame.funnel = cut ? 0 : L.funnel;
    _frame.burst = L.burst;
    _frame.flash = flick;
    _frame.flashY = L.flickerY;
    _frame.ringR = L.ringR;
    _frame.ring = L.ring;
    this.storm.paint(_frame);
    this.graniteMat.uniforms.uFlash.value = flick * 0.8;
    // The stone.
    this.paintStone(L);
    // The lightning.
    this.paintBolts(L, reduced, cut);
    // The particles.
    this.emit(L, dt, crossed);
    // The thuds and the rings on their beats.
    const x = this.stage.position.x;
    const z = this.stage.position.z;
    if (crossed(E.touchAt)) {
      this.thud(E.shakeTouch, x, z);
      this.particles.shockRing(x, z, 0x8c98b0, 20, 0.9, { wake: 0.3, crest: 0.2, strength: 0.6 });
    }
    if (crossed(E.burstAt)) {
      this.thud(E.shakeBurst, x, z);
      this.particles.shockRing(x, z, 0x7c8aa4, 46, 1.3, { wake: 0.2, crest: 0.1, strength: 0.8 });
    }
    if (crossed(E.finalAt)) {
      this.thud(E.shakeFinal, x, z);
      this.particles.shockRing(x, z, 0xb8ccff, 16, 0.7, { wake: 0.5, crest: 0.25, strength: 1 });
    }
    for (let i = 0; i < BREATH_STRIKES.length; i++) {
      const s = BREATH_STRIKES[i];
      if (s.kind !== 'ground' || !crossed(s.at)) continue;
      const lx = Math.sin(s.angle) * s.r;
      const lz = Math.cos(s.angle) * s.r;
      const wx = x + lx;
      const wz = z + lz;
      const gy = this.ground(wx, wz);
      this.thud(E.shakeStrike * (s.big ? 1.3 : 1), x, z);
      this.particles.shockRing(wx, wz, 0xa8c0ff, s.big ? 8 : 6, 0.6, {
        wake: 0.4,
        crest: 0.25,
        strength: 1,
      });
      this.particles.puff(wx, gy + 0.4, wz, P.strikeSparks, SPARK);
      this.particles.puff(wx, gy + 0.3, wz, P.strikeDust, STRIKE_DUST);
    }
    // The burst of light on the guardian (none under reduced motion).
    const flash = breathEntranceFlash(L, reduced);
    this.flash.visible = flash > 0.002;
    if (this.flash.visible) {
      const y = L.sinceFinal >= 0 ? SH.heartY : SH.heartY + 2;
      _p.set(0, y, 0);
      _q.identity();
      _s.setScalar(E.flashSize * (0.7 + 0.3 * flash));
      _m.compose(_p, _q, _s);
      this.flash.setMatrixAt(0, _m);
      const k = flash * E.flashPeak;
      this.flash.setColorAt(0, _c.setRGB(0.8 * k, 0.88 * k, k));
      this.flash.instanceMatrix.needsUpdate = true;
      if (this.flash.instanceColor) this.flash.instanceColor.needsUpdate = true;
    }
    // The sounds, each on its beat for a scene seen crossing it (a cut-short
    // scene: only the burst's and after).
    for (let si = 0; si < BREATH_ENTRANCE_SOUNDS.length; si++) {
      const snd = BREATH_ENTRANCE_SOUNDS[si];
      if (!crossed(snd.at)) continue;
      this.heard(x, sy + 6, z);
      sfx.playAt(snd.key, _heard.x, _heard.y, _heard.z, {
        gain: snd.gain,
        rate: snd.rate,
        cooldown: 0.05,
        jitter: false,
        priority: true,
      });
    }
  }

  /** The hanging stone and the stone orbiting the funnel. */
  private paintStone(L: BreathEntranceLook): void {
    let anyHang = false;
    for (let i = 0; i < this.hangPicks.length; i++) {
      const p = hangingAt(HANGING_STONE[this.hangPicks[i]], L, this.clock, _piece);
      if (p.size <= 0.01) {
        this.hanging.setMatrixAt(i, _zero);
        continue;
      }
      anyHang = true;
      this.compose(p.x, p.y, p.z, p.turn, p.size, i);
      this.hanging.setMatrixAt(i, _m);
    }
    this.hanging.visible = anyHang;
    if (anyHang || this.hanging.visible) this.hanging.instanceMatrix.needsUpdate = true;
    const orbitOn = L.orbit > 0.01 || (L.sinceBurst >= 0 && L.sinceBurst < 2.4);
    let anyOrbit = false;
    if (orbitOn && !this.cut) {
      for (let i = 0; i < this.orbitPicks.length; i++) {
        const p = orbitAt(ORBIT_STONE[this.orbitPicks[i]], L, _piece);
        if (p.size <= 0.01) {
          this.orbiting.setMatrixAt(i, _zero);
          continue;
        }
        anyOrbit = true;
        this.compose(p.x, p.y, p.z, p.turn, p.size, i + 977);
        this.orbiting.setMatrixAt(i, _m);
      }
    }
    if (anyOrbit || this.orbiting.visible) this.orbiting.instanceMatrix.needsUpdate = true;
    this.orbiting.visible = anyOrbit;
  }

  private compose(x: number, y: number, z: number, turn: number, size: number, i: number): void {
    _p.set(x, y, z);
    _axis.set(Math.sin(i * 1.7), 0.6, Math.cos(i * 2.3)).normalize();
    _q.setFromAxisAngle(_axis, turn);
    _s.set(size * 1.25, size, size * 1.05);
    _m.compose(_p, _q, _s);
  }

  /** Every bolt this frame: the strikes and their forks, the crawlers. */
  private paintBolts(L: BreathEntranceLook, reduced: boolean, cut: boolean): void {
    const b = this.bolts;
    b.begin();
    const t = L.t;
    const sy = this.stage.position.y;
    const sx = this.stage.position.x;
    const sz = this.stage.position.z;
    for (let i = 0; i < BREATH_STRIKES.length; i++) {
      const s = BREATH_STRIKES[i];
      if (cut && s.at < E.burstAt) continue;
      // Reduced motion: one fading bolt, never re-struck.
      const raw = reduced ? strikeLightSteady(s, t) : strikeLight(s, t);
      if (raw <= 0) continue;
      const light = breathEntranceLight(raw * (s.big ? 1.5 : 1.15), reduced);
      const beat = reduced ? 0 : Math.floor(((t - s.at) / BOLT_LIFE) * BOLT_FLICKERS);
      const seed = i * 131 + beat * 17 + 5;
      const fromA = s.angle + 0.5;
      const fromR = 6 + 4 * ((i * 0.37) % 1);
      const ax = Math.sin(fromA) * fromR;
      const az = Math.cos(fromA) * fromR;
      const ay = SH.eyeH - 1.5;
      if (s.kind === 'ground') {
        const bx = Math.sin(s.angle) * s.r;
        const bz = Math.cos(s.angle) * s.r;
        const by = this.ground(sx + bx, sz + bz) - sy;
        const w = s.big ? 1.1 : 0.8;
        if (b.draw(seed, ax, ay, az, bx, by, bz, 0.13, w, light)) {
          b.fork(
            seed + 1,
            0.45,
            Math.sin(s.angle + 1.1) * 7,
            -9,
            Math.cos(s.angle + 1.1) * 7,
            w * 0.45,
            light * 0.7,
          );
          b.fork(
            seed + 2,
            0.68,
            Math.sin(s.angle - 1.3) * 5,
            -6,
            Math.cos(s.angle - 1.3) * 5,
            w * 0.4,
            light * 0.6,
          );
        }
        b.glow(bx, by + 0.8, bz, s.big ? 11 : 8, 0.5 * light, 0.62 * light, light);
      } else if (s.kind === 'axis') {
        b.draw(seed, 0, ay, 0, 0, 0.2, 0, 0.05, 1.3, light);
        b.glow(0, 0.8, 0, 13, 0.55 * light, 0.65 * light, light);
      } else {
        // The great bolt onto the guardian, with forks lashing the floor.
        b.draw(seed, ax * 0.4, ay + 1, az * 0.4, 0, SH.heartY, 0, 0.09, 1.9, light * 1.2);
        b.fork(seed + 3, 0.55, 9, -14, 4, 0.7, light * 0.8);
        b.fork(seed + 4, 0.6, -7, -15, -6, 0.7, light * 0.8);
        b.fork(seed + 5, 0.7, 2, -12, -9, 0.6, light * 0.7);
        b.glow(0, SH.heartY, 0, 16, 0.6 * light, 0.72 * light, light);
      }
    }
    // The arcs crawling over the funnel.
    if (!cut && L.funnel > 0.05 && L.reach > 0.5) {
      for (let c = 0; c < CRAWLERS; c++) {
        crawlerArc(c, t, _arc);
        if (_arc.light <= 0) continue;
        if (1 - _arc.h0 > L.reach) continue;
        // Reduced motion: the arcs hold a steady glow (no flicker).
        const light = reduced
          ? Math.min(0.4 * L.funnel, REDUCED_LIGHT_CAP)
          : _arc.light * L.funnel * (0.55 + 0.6 * L.flicker);
        const r0 = funnelRadius(_arc.h0) * 1.04 * (1 + 2.8 * L.burst);
        const r1 = funnelRadius(_arc.h1) * 1.04 * (1 + 2.8 * L.burst);
        b.draw(
          _arc.seed,
          Math.sin(_arc.a0) * r0,
          _arc.h0 * SH.funnelH,
          Math.cos(_arc.a0) * r0,
          Math.sin(_arc.a1) * r1,
          _arc.h1 * SH.funnelH,
          Math.cos(_arc.a1) * r1,
          0.16,
          0.45,
          light,
        );
      }
    }
    b.end();
  }

  /** The particles: the calm's hanging dust, the grit drawn up to the eye,
   *  the funnel's skirt, the touch's dust, the ring of gust's dust front. */
  private emit(L: BreathEntranceLook, dt: number, crossed: (at: number) => boolean): void {
    const x = this.stage.position.x;
    const y = this.stage.position.y;
    const z = this.stage.position.z;
    const o = this.owed;
    // Dust hanging in the calm.
    o.motes = cap(o.motes + dt * P.calmMotes * L.calm * this.density);
    while (o.motes >= 1) {
      o.motes -= 1;
      const pc = HANGING_STONE[Math.floor(this.rand() * HANGING_STONE.length)];
      MOTE.floor = y - 2;
      this.particles.puff(
        x + pc.x + (this.rand() - 0.5) * 8,
        y + 0.8 + this.rand() * 5,
        z + pc.z + (this.rand() - 0.5) * 8,
        1,
        MOTE,
      );
    }
    // The grit drawn up to the eye.
    const pulling = L.t > E.pullAt && L.t < E.touchAt + 0.6 && !L.dormant;
    o.grit = cap(o.grit + (pulling ? dt * P.pullGrit * this.density : 0));
    while (o.grit >= 1) {
      o.grit -= 1;
      const pc = HANGING_STONE[Math.floor(this.rand() * HANGING_STONE.length)];
      const px = pc.x + (this.rand() - 0.5) * 6;
      const pz = pc.z + (this.rand() - 0.5) * 6;
      const py = 0.5 + this.rand() * 3;
      const dx = -px;
      const dy = SH.eyeH - py;
      const dz = -pz;
      const len = Math.hypot(dx, dy, dz) || 1;
      _toEye[0] = dx / len + (dz / len) * 0.5;
      _toEye[1] = dy / len;
      _toEye[2] = dz / len - (dx / len) * 0.5;
      GRIT.speed = 10 + 10 * this.rand();
      GRIT.floor = y - 4;
      this.particles.puff(x + px, y + py, z + pz, 1, GRIT);
    }
    // The funnel's skirt: dust torn off its foot, spun outward.
    const skirtOn = L.funnel > 0.1 && L.sinceTouch >= 0 && L.burst < 0.3;
    o.skirt = cap(o.skirt + (skirtOn ? dt * P.skirt * this.density : 0));
    while (o.skirt >= 1) {
      o.skirt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = SH.rBot * (0.8 + this.rand() * 0.6);
      _out[0] = Math.sin(a) + Math.cos(a) * 1.4;
      _out[1] = 0.25;
      _out[2] = Math.cos(a) - Math.sin(a) * 1.4;
      SKIRT.dir = _out;
      SKIRT.floor = y;
      this.particles.puff(x + Math.sin(a) * r, y + 0.6, z + Math.cos(a) * r, 1, SKIRT);
    }
    if (crossed(E.touchAt)) {
      TOUCH.floor = y;
      this.particles.puff(x, y + 0.8, z, P.touchDust, TOUCH);
    }
    // The ring of gust's dust front.
    o.ring = cap(o.ring + (L.ring > 0.05 ? dt * P.ringDust * L.ring * this.density : 0));
    while (o.ring >= 1) {
      o.ring -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = L.ringR * (0.9 + this.rand() * 0.12);
      const px = x + Math.sin(a) * r;
      const pz = z + Math.cos(a) * r;
      _out[0] = Math.sin(a);
      _out[1] = 0.15;
      _out[2] = Math.cos(a);
      RING_DUST.dir = _out;
      RING_DUST.floor = this.ground(px, pz);
      this.particles.puff(px, RING_DUST.floor + 0.6, pz, 1, RING_DUST);
    }
  }

  /** The howl under the pull and the funnel (a loop riding look.howl). */
  private howl(e: Entity, L: BreathEntranceLook): void {
    const want = L.active && !this.cut ? L.howl : 0;
    if (want <= 0.02) {
      this.stopHowl();
      return;
    }
    const gain = Math.round(want * BREATH_ENTRANCE_HOWL.gain * 20) / 20;
    this.heard(e.pos.x, e.pos.y + 10, e.pos.z);
    // Called every frame like any positional bed (the mixer re-arms its ramp
    // only when the gain changes).
    sfx.loop(HOWL_LOOP, BREATH_ENTRANCE_HOWL.key, gain, _heard.x, _heard.y, _heard.z);
    this.howling = true;
  }

  private stopHowl(): void {
    if (!this.howling) return;
    this.howling = false;
    sfx.unloop(HOWL_LOOP, 0.5);
  }

  /** Where a sound at (x, y, z) is heard from: the storm fills the whole
   *  Cornice, so a source past BREATH_ENTRANCE_HEARD_AT is brought in along
   *  its own bearing (the mixer stops at 46 yd). */
  private heard(x: number, y: number, z: number): void {
    _heard.x = x;
    _heard.y = y;
    _heard.z = z;
    const me = this.world?.entities.get(this.world.playerId);
    if (!me) return;
    const dx = x - me.pos.x;
    const dz = z - me.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= BREATH_ENTRANCE_HEARD_AT) return;
    const k = BREATH_ENTRANCE_HEARD_AT / d;
    _heard.x = me.pos.x + dx * k;
    _heard.z = me.pos.z + dz * k;
    _heard.y = me.pos.y + 3;
  }

  /** A thud of `amount` at (x, z) for this viewer. */
  private thud(amount: number, x: number, z: number): void {
    const me = this.world?.entities.get(this.world.playerId);
    if (!this.shakeSink || !me) return;
    const k = breathEntranceShake(
      amount,
      Math.hypot(me.pos.x - x, me.pos.z - z),
      this.motionReduced(),
    );
    if (k > 0) this.shakeSink(k);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

/** A particle debt's ceiling (a stalled frame never bursts a pool). */
const cap = (v: number) => (v > 24 ? 24 : v);

/** The scene's length the painter plays past the hand-back (tests read it). */
export const BREATH_ENTRANCE_TAIL = E.end - BREATH_INTRO.seconds;

const _frame = {
  eye: 0,
  eyeR: 0,
  eyeTurn: 0,
  reach: 0,
  funnel: 0,
  burst: 0,
  flash: 0,
  flashY: 0.5,
  ringR: 0,
  ring: 0,
};
const _heard = { x: 0, y: 0, z: 0 };

// ---- particles' options (written in place) -----------------------------------------------------

const MOTE = {
  speed: 0.04,
  life: 4.2,
  size: [0.32, 0.4] as [number, number],
  color: [0.78, 0.8, 0.84] as [number, number, number],
  alpha: 0.32,
  gravity: 0,
  drag: 0.2,
  floor: 0,
};
const GRIT = {
  speed: 14,
  life: 1.5,
  size: [0.35, 0.12] as [number, number],
  color: [0.42, 0.42, 0.45] as [number, number, number],
  alpha: 0.8,
  dir: _toEye as readonly [number, number, number],
  spread: 0.12,
  drag: 0,
  gravity: -3,
  floor: 0,
};
const SKIRT = {
  speed: 9,
  life: 1.7,
  size: [1.6, 5.2] as [number, number],
  color: [0.5, 0.48, 0.46] as [number, number, number],
  alpha: 0.34,
  dir: _out as readonly [number, number, number],
  spread: 0.3,
  drag: 0.9,
  gravity: -1.5,
  floor: 0,
};
const TOUCH = {
  speed: 16,
  life: 1.8,
  size: [2, 6.5] as [number, number],
  color: [0.55, 0.53, 0.5] as [number, number, number],
  alpha: 0.4,
  drag: 1.4,
  radius: 3,
  floor: 0,
};
const SPARK = {
  speed: 9,
  up: 4,
  life: 0.55,
  size: [0.28, 0.06] as [number, number],
  color: [0.7, 0.8, 1.0] as [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  gravity: 14,
  drag: 0.6,
};
const STRIKE_DUST = {
  speed: 5,
  life: 1.3,
  size: [1, 3.2] as [number, number],
  color: [0.42, 0.42, 0.44] as [number, number, number],
  alpha: 0.38,
  drag: 1.2,
  radius: 1.2,
};
const RING_DUST = {
  speed: 18,
  life: 1.1,
  size: [1.4, 4.4] as [number, number],
  color: [0.6, 0.6, 0.62] as [number, number, number],
  alpha: 0.32,
  dir: _out as readonly [number, number, number],
  spread: 0.25,
  drag: 1.1,
  floor: 0,
};
