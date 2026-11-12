// The Guardian of the Breath's death, "The storm loses its anchor" (plan:
// breath_death_core.ts), hosted by ../rift_death_zone.ts and updated right
// after the entrance and before BreathBody (it holds its look through
// breath_death_state.ts, so the body's currents, arcs, light and orbiting
// stones ride its clock). It reads the guardian's death off IWorld (offline
// and online alike), runs the scene's clock (a death seen live plays it; a
// corpse first seen dead shows only the calm after; a dev replay cue, `/dev
// heart breath death`, plays it on the living body and gives the wind back)
// and draws:
//  - the pull: streams of pale wind spiralling in out of the air round the
//    isle into its heart, the wind over the isle wheeling in after them;
//  - the arcs: lightning off its pieces to the floor and up into the cloud,
//    wild, then sputtering (the body's own arcs between its pieces ride the
//    held look);
//  - the unravel: its body coming apart into drifting cloud;
//  - the clap: one last bolt out of the cloud into its heart, a flash, a
//    ring over the floor, a thud;
//  - the clearing: the cloud overhead parting from the middle out, its torn
//    rims lit gold, a shaft of clear light falling on the isle with dust
//    settling in it; the wind over the isle dying down to stillness.
// No camera is taken, no control, nothing held back from loot or exit.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated; fixed
// pools, no light, no per-frame allocation. The particle pools build WORLD
// points (camera-relative in their own shaders) and hang off the root at the
// origin; the deck, the shaft, the bolts and the cards hang off the stage on
// its foot. The low tier thins the particles and sheds the shaft's halo
// (`BREATH_DEATH_SECONDARY_LAYERS`); every beat plays on every tier; reduced
// motion takes the thuds, steadies the bolts and calms the light.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { BREATH_DEV_CUES, BREATH_GUARDIAN } from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { attachSceneGroupGated } from '../gated_scene_attach';
import type { SanctumPuffOptions } from '../gravewyrm_sanctum_fx/sanctum_fx_core';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { BREATH_SOCKETS, BREATH_YD_PER_UNIT } from './breath_body_core';
import { breathBodySockets } from './breath_body_sockets';
import {
  BREATH_DEATH,
  BREATH_DEATH_ARCS,
  BREATH_DEATH_CLOUD_SOCKETS,
  BREATH_DEATH_GESTURES,
  BREATH_DEATH_HEART,
  BREATH_DEATH_RATES,
  BREATH_DEATH_SHAKES,
  BREATH_DEATH_SHAPE,
  BREATH_DEATH_SOUNDS,
  BREATH_DEATH_STREAMS,
  breathArenaWind,
  breathDeathArcLight,
  breathDeathBodyLook,
  breathDeathCrossed,
  breathDeathLight,
  breathDeathShake,
  breathDeathSky,
  breathDeathTime,
  breathStreamHead,
  newBreathDeathBodyLook,
} from './breath_death_core';
import { DECK_FRAG, DECK_VERT, SHAFT_FRAG, SHAFT_VERT } from './breath_death_glsl';
import { holdBreathDeath } from './breath_death_state';
import { BreathEntranceBolts } from './breath_entrance_bolts';
import { GLOW_FRAG, GLOW_VERT } from './council_entrance_glsl';
import { inSmithHeartClaim } from './council_fx_core';
import { entranceBudgetNow } from './entrance_budget';
import { BREATH_DEATH_SECONDARY_LAYERS } from './entrance_budget_core';

const SCAN_SEC = 0.25;
const CARDS = 12;
const U = BREATH_YD_PER_UNIT;
const SH = BREATH_DEATH_SHAPE;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _h0 = { x: 0, y: 0, z: 0, k: 0 };
const _h1 = { x: 0, y: 0, z: 0, k: 0 };
const _sky = { deck: 0, open: 0, rim: 0, shaft: 0, clap: 0 };

const WIND: readonly [number, number, number] = [0.45, 0.7, 1];
const WIND_SHADE: readonly [number, number, number] = [0.5, 0.6, 0.76];
const CLOUD: readonly [number, number, number] = [0.56, 0.62, 0.74];
const SPARK: readonly [number, number, number] = [0.8, 0.92, 1];
const SUN: readonly [number, number, number] = [1, 0.86, 0.55];

export class BreathDeathFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** Laid on the guardian's foot (the deck, the shaft, the bolts, the cards). */
  private readonly stage = new THREE.Group();
  readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly secondary: boolean;
  private readonly particles: EngineParticles;
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  private readonly bolts: BreathEntranceBolts;
  private readonly deck: THREE.Mesh;
  private readonly deckMat: THREE.ShaderMaterial;
  private readonly shaft: THREE.Mesh;
  private readonly shaftMat: THREE.ShaderMaterial;
  private readonly halo: THREE.Mesh;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly cards: THREE.InstancedMesh;
  private readonly flash: THREE.InstancedMesh;
  private readonly look = newBreathDeathBodyLook();
  /** This scene holds the guardian's look (breath_death_state.ts). */
  private holding = false;
  /** A corpse long past its scene, painted once at rest. */
  private rested = false;
  private cardN = 0;
  /** The sockets this frame (world), from the model's bones or the plan. */
  private readonly sock: THREE.Vector3[] = BREATH_SOCKETS.map(() => new THREE.Vector3());
  private entityId = -1;
  private deadKnown = false;
  private deadAt = 0;
  private seenAlive = false;
  private replayAt = -1;
  private fell = false;
  private t = -1;
  private prev = -1;
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0xb7ea;
  private cloudDebt = 0;
  private windDebt = 0;
  private moteDebt = 0;
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
    this.root.name = 'smith-heart-breath-death';
    setRenderCategory(this.root, 'ui3d');
    this.stage.name = 'smithHeartBreathDeathStage';
    this.stage.visible = false;
    this.root.add(this.stage);
    const budget = entranceBudgetNow('breath');
    this.secondary = budget.secondary;
    this.density = budget.share;
    const hasDom = typeof document !== 'undefined';
    // The pools draw world points and ignore a parent: on the root.
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    this.bolts = new BreathEntranceBolts(this.stage, this);
    // ---- the cloud overhead ----
    const disc = new THREE.CircleGeometry(1, 64).rotateX(Math.PI / 2);
    this.geometries.push(disc);
    this.deckMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathDeathDeckMat',
      uniforms: {
        uAlpha: { value: 0 },
        uOpen: { value: 0 },
        uRim: { value: 0 },
        uClap: { value: 0 },
        uTime: this.uTime,
      },
      vertexShader: DECK_VERT,
      fragmentShader: DECK_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(this.deckMat);
    this.deck = new THREE.Mesh(disc, this.deckMat);
    this.deck.name = 'smithHeartBreathDeathDeck';
    this.deck.frustumCulled = false;
    this.deck.visible = false;
    this.deck.position.set(0, SH.deckH, 0);
    this.deck.scale.setScalar(SH.deckR);
    this.stage.add(this.deck);
    // ---- the shaft of clear light (and its wide soft halo) ----
    const tube = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);
    this.geometries.push(tube);
    const shaftMat = (name: string, foot: number, top: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uFoot: { value: foot },
          uTop: { value: top },
          uColor: { value: new THREE.Color(1, 0.9, 0.66) },
        },
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(m);
      return m;
    };
    this.shaftMat = shaftMat('smithHeartBreathDeathShaftMat', SH.shaftFoot, SH.shaftTop);
    this.shaft = new THREE.Mesh(tube, this.shaftMat);
    this.shaft.name = 'smithHeartBreathDeathShaft';
    this.haloMat = shaftMat(
      `${BREATH_DEATH_SECONDARY_LAYERS[0]}Mat`,
      SH.shaftFoot * 1.9,
      SH.shaftTop * 1.7,
    );
    this.halo = new THREE.Mesh(tube, this.haloMat);
    this.halo.name = BREATH_DEATH_SECONDARY_LAYERS[0];
    for (const m of [this.shaft, this.halo]) {
      m.frustumCulled = false;
      m.visible = false;
      m.scale.set(1, SH.deckH, 1);
      m.renderOrder = 6;
      this.stage.add(m);
    }
    // ---- light cards and the clap's flash ----
    const card = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(card);
    const cards = (name: string, n: number, depthTest: boolean) => {
      const mat = new THREE.ShaderMaterial({
        name: `${name}Mat`,
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.InstancedMesh(card, mat, n);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) {
        mesh.setMatrixAt(i, _zero);
        mesh.setColorAt(i, _c.setRGB(0, 0, 0));
      }
      this.stage.add(mesh);
      return mesh;
    };
    this.cards = cards('smithHeartBreathDeathLight', CARDS, true);
    this.flash = cards('smithHeartBreathDeathFlash', 1, true);
    this.flash.renderOrder = 10_000;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** The scene's clock (tests read it). */
  get sceneTime(): number {
    return this.t;
  }

  // ---- the events ----------------------------------------------------------------------------

  /** Claims only the dev replay cue (a presentation trigger with no draw of
   *  its own); the fight's cues are never claimed. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type !== 'spellfx' || ev.ability !== BREATH_DEV_CUES.deathReplay) return false;
    const e = this.world.entities.get(ev.sourceId);
    if (!e || e.templateId !== BREATH_GUARDIAN || e.dead) return true;
    if (this.entityId !== e.id) this.take(e.id);
    this.replayAt = this.clock;
    this.fell = false;
    return true;
  }

  // ---- the frame -----------------------------------------------------------------------------

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
    const e = this.entityId >= 0 ? (world.entities.get(this.entityId) ?? null) : null;
    // Out of view and not dying: a death that happens unseen comes back
    // calm, never a scene played late.
    if (!e && !this.deadKnown) this.seenAlive = false;
    if (e) {
      if (e.dead) {
        if (!this.deadKnown) {
          this.deadKnown = true;
          this.deadAt = this.seenAlive ? this.clock : this.clock - BREATH_DEATH.end - 30;
          this.replayAt = -1;
        }
      } else {
        // Revived (a reset): the wind comes back at once.
        if (this.deadKnown) this.deadKnown = false;
        this.seenAlive = true;
      }
    }
    this.prev = this.t;
    this.t = breathDeathTime(this.clock, this.deadAt, this.replayAt, this.deadKnown);
    // A replay over (its span spent): the body stands, the wind back.
    if (!this.deadKnown && this.replayAt >= 0 && this.t < 0 && this.clock >= this.replayAt) {
      this.replayAt = -1;
      this.fell = false;
    }
    this.particles.update(this.clock);
    this.cardN = 0;
    this.bolts.begin();
    if (!e || this.t < 0) {
      this.letGo(e);
      this.bolts.end();
      this.paintCards();
      return;
    }
    // A corpse long past its scene keeps its calm look held: nothing to draw.
    const rest = this.deadKnown && this.t > BREATH_DEATH.end + 1;
    if (rest && this.rested) {
      holdBreathDeath(e.id, this.look);
      this.holding = true;
      this.bolts.end();
      return;
    }
    this.rested = rest;
    breathDeathBodyLook(this.t, this.look);
    holdBreathDeath(e.id, this.look);
    this.holding = true;
    if (!this.deadKnown && !this.fell) {
      this.fell = true;
      this.playGesture?.(e.id, BREATH_DEATH_GESTURES.fall);
    }
    this.readSockets(e);
    const at = fxAnchor(e);
    this.stage.position.set(at.x, this.groundY(at.x, at.z), at.z);
    this.stage.visible = true;
    if (rest) this.hideScene();
    else this.paint(e, dt);
    this.bolts.end();
    this.paintCards();
  }

  /** No scene: the hold given back, the scene hidden. */
  private letGo(e: Entity | null): void {
    if (e && this.holding) holdBreathDeath(e.id, null);
    this.holding = false;
    this.rested = false;
    this.hideScene();
    if (this.t < 0) this.stage.visible = false;
  }

  private hideScene(): void {
    this.deck.visible = false;
    this.shaft.visible = false;
    this.halo.visible = false;
    this.flash.visible = false;
  }

  private readSockets(e: Entity): void {
    const set = breathBodySockets();
    const at = fxAnchor(e);
    const sin = Math.sin(e.facing);
    const cos = Math.cos(e.facing);
    for (let i = 0; i < BREATH_SOCKETS.length; i++) {
      const p = set?.points[i];
      if (p) {
        p.getWorldPosition(this.sock[i]);
        continue;
      }
      const a = BREATH_SOCKETS[i].at;
      const x = a[0] * U;
      const z = a[2] * U;
      this.sock[i].set(at.x + x * cos + z * sin, at.y + a[1] * U, at.z - x * sin + z * cos);
    }
  }

  // ---- the paint -----------------------------------------------------------------------------

  private paint(e: Entity, dt: number): void {
    const t = this.t;
    const prev = this.prev;
    const D = BREATH_DEATH;
    const reduced = this.reducedMotion();
    const crossed = (at: number) => breathDeathCrossed(prev, t, at);
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    const heart = this.sock[BREATH_DEATH_HEART];
    const hx = heart.x - sx;
    const hy = heart.y - sy;
    const hz = heart.z - sz;
    // ---- the streams sucked home ----
    this.paintStreams(t, dt, hy);
    // ---- the wind over the isle: wheeling in, slowing to stillness ----
    this.paintWind(t, dt);
    // ---- the heart's light: flaring through the pull, out at the clap ----
    const L = this.look;
    const heartK = breathDeathLight(0.35 * L.glow + 0.45 * L.flare, reduced);
    if (heartK > 0.02) this.card(hx, hy, hz, 7 + 5 * L.flare, 0.6 * heartK, 0.85 * heartK, heartK);
    // ---- the lightning: wild, then sputtering ----
    this.paintArcs(t, reduced, hx, hz);
    // ---- the unravel into cloud ----
    const unravel =
      t > D.unravelFrom && t < D.unravelTo + 0.6
        ? Math.sin((Math.PI * (t - D.unravelFrom)) / (D.unravelTo + 0.6 - D.unravelFrom))
        : 0;
    if (unravel > 0.02) {
      this.cloudDebt += dt * BREATH_DEATH_RATES.cloud * unravel * this.density;
      if (this.cloudDebt > 12) this.cloudDebt = 12;
      while (this.cloudDebt >= 1) {
        this.cloudDebt -= 1;
        const si =
          BREATH_DEATH_CLOUD_SOCKETS[Math.floor(this.rand() * BREATH_DEATH_CLOUD_SOCKETS.length)];
        const p = this.sock[si];
        const a = Math.atan2(p.x - heart.x, p.z - heart.z) + (this.rand() - 0.5) * 0.8;
        UNRAVEL.dir[0] = Math.sin(a);
        UNRAVEL.dir[2] = Math.cos(a);
        UNRAVEL.color = this.rand() < 0.5 ? CLOUD : WIND_SHADE;
        this.particles.puff(p.x, p.y, p.z, 1, UNRAVEL);
        if (this.rand() < 0.5) this.particles.puff(p.x, p.y, p.z, 1, UNRAVEL_GLINT);
      }
    }
    // ---- the moments ----
    if (crossed(0.05)) {
      this.thud(BREATH_DEATH_SHAKES.pull.amount, BREATH_DEATH_SHAKES.pull.reach, e);
      this.particles.puff(heart.x, heart.y, heart.z, 30, PULL_SPARKS);
    }
    if (crossed(D.unravelFrom)) this.particles.puff(heart.x, heart.y, heart.z, 24, UNRAVEL_BURST);
    if (crossed(D.clapAt)) {
      this.thud(BREATH_DEATH_SHAKES.clap.amount, BREATH_DEATH_SHAKES.clap.reach, e);
      this.particles.shockRing(sx, sz, 0xb8e6ff, 30, 1.1, {
        wake: 0.3,
        crest: 0.12,
        strength: 0.8,
      });
      this.particles.puff(heart.x, heart.y, heart.z, 70, CLAP_SPARKS);
      this.particles.puff(heart.x, heart.y, heart.z, 26, CLAP_SMOKE);
    }
    // The clap's bolt out of the cloud into its heart, with forks.
    const clapSince = t - D.clapAt;
    if (clapSince >= 0 && clapSince < 0.45) {
      const k = breathDeathLight(
        reduced
          ? 1 - clapSince / 0.45
          : (1 - clapSince / 0.45) * (Math.floor(clapSince * 20) % 2 ? 0.7 : 1.2),
        reduced,
      );
      const seed = 9001 + (reduced ? 0 : Math.floor(clapSince * 14));
      if (this.bolts.draw(seed, hx + 4, SH.deckH - 2, hz - 3, hx, hy, hz, 0.1, 2.2, k)) {
        this.bolts.fork(seed + 1, 0.5, 10, -12, 5, 0.9, k * 0.8);
        this.bolts.fork(seed + 2, 0.62, -9, -14, -6, 0.9, k * 0.8);
        this.bolts.fork(seed + 3, 0.78, 4, -9, -10, 0.7, k * 0.7);
      }
      this.bolts.glow(hx, hy, hz, 16, 0.6 * k, 0.75 * k, k);
    }
    // ---- the sky: the cloud parting, the shaft of light ----
    const sky = breathDeathSky(t, _sky);
    this.deck.visible = sky.deck > 0.005;
    if (this.deck.visible) {
      const u = this.deckMat.uniforms;
      u.uAlpha.value = sky.deck;
      u.uOpen.value = sky.open;
      u.uRim.value = breathDeathLight(sky.rim * 1.3, reduced);
      u.uClap.value = breathDeathLight(0.6 * sky.clap, reduced);
    }
    const shaftK = breathDeathLight(sky.shaft, reduced);
    this.shaft.visible = shaftK > 0.005;
    this.shaftMat.uniforms.uAlpha.value = 0.3 * shaftK;
    this.halo.visible = this.secondary && shaftK > 0.005;
    this.haloMat.uniforms.uAlpha.value = 0.08 * shaftK;
    if (sky.shaft > 0.05) {
      // The dust settling slowly in the light.
      this.moteDebt += dt * BREATH_DEATH_RATES.motes * sky.shaft * this.density;
      if (this.moteDebt > 8) this.moteDebt = 8;
      while (this.moteDebt >= 1) {
        this.moteDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = Math.sqrt(this.rand()) * SH.shaftFoot * 1.1;
        const y = 1 + this.rand() * 16;
        this.particles.puff(sx + Math.sin(a) * r, sy + y, sz + Math.cos(a) * r, 1, MOTE);
      }
      // A soft pool of sun on the floor where it lands.
      const g = breathDeathLight(0.2 * sky.shaft, reduced);
      this.card(hx * 0.2, 0.6, hz * 0.2, SH.shaftFoot * 2.6, g, 0.86 * g, 0.6 * g);
    }
    // The clap's flash on it (a burst of light, never a white-out).
    const fk = breathDeathLight(sky.clap * 1.3, reduced);
    this.flash.visible = fk > 0.01;
    if (this.flash.visible) {
      _m.compose(_p.set(hx, hy, hz), _q.identity(), _s.setScalar(30 * (0.7 + 0.3 * fk)));
      this.flash.setMatrixAt(0, _m);
      this.flash.setColorAt(0, _c.setRGB(0.75 * fk, 0.85 * fk, fk));
      this.flash.instanceMatrix.needsUpdate = true;
      if (this.flash.instanceColor) this.flash.instanceColor.needsUpdate = true;
    }
    this.sounds(t, prev, e);
  }

  /** Each stream's head winding in and the pale trail it lays (glints and
   *  a softer shade of wind), its head a small light. */
  private paintStreams(t: number, dt: number, hy: number): void {
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    // The streams aim at its heart as it stands now (the plan's height is the
    // heart at rest; the live heart may drift: a share of the difference).
    const lift = hy - SH.heartY;
    for (let i = 0; i < BREATH_DEATH_STREAMS.length; i++) {
      const s = BREATH_DEATH_STREAMS[i];
      breathStreamHead(s, t, _h1);
      if (_h1.k < 0) continue;
      breathStreamHead(s, Math.max(s.at, t - dt), _h0);
      if (_h0.k < 0) {
        _h0.x = _h1.x;
        _h0.y = _h1.y;
        _h0.z = _h1.z;
      }
      const len = Math.hypot(_h1.x - _h0.x, _h1.y - _h0.y, _h1.z - _h0.z);
      const n = Math.min(
        30,
        Math.max(
          1,
          Math.round((len / BREATH_DEATH_RATES.streamStep) * Math.max(0.35, this.density)),
        ),
      );
      const fade = 1 - _h1.k * 0.3;
      for (let j = 1; j <= n; j++) {
        const k = j / n;
        const x = sx + _h0.x + (_h1.x - _h0.x) * k;
        const y = sy + _h0.y + (_h1.y - _h0.y) * k + lift * _h1.k;
        const z = sz + _h0.z + (_h1.z - _h0.z) * k;
        STREAM_CORE.alpha = fade;
        this.particles.puff(x, y, z, 1, STREAM_CORE);
        if (this.rand() < 0.35) this.particles.puff(x, y, z, 1, STREAM_SHADE);
      }
      this.card(_h1.x, _h1.y + lift * _h1.k, _h1.z, 3.2, 0.45 * fade, 0.6 * fade, 0.75 * fade);
    }
  }

  /** The wind over the isle: streaks wheeling round it (drawn in through the
   *  pull), slowing and thinning to stillness. */
  private paintWind(t: number, dt: number): void {
    const w = breathArenaWind(t);
    if (w < 0.02) return;
    const D = BREATH_DEATH;
    const inward = t < D.pullTo ? 1 - t / D.pullTo : 0;
    this.windDebt += dt * BREATH_DEATH_RATES.wind * w * this.density;
    if (this.windDebt > 12) this.windDebt = 12;
    const sx = this.stage.position.x;
    const sz = this.stage.position.z;
    while (this.windDebt >= 1) {
      this.windDebt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = 8 + this.rand() * 34;
      const x = sx + Math.sin(a) * r;
      const z = sz + Math.cos(a) * r;
      const y = this.groundY(x, z) + 0.6 + this.rand() * 4;
      // Wheeling round it (the same way the streams wind), drawn in.
      GUST.dir[0] = Math.cos(a) - Math.sin(a) * inward * 0.6;
      GUST.dir[1] = 0;
      GUST.dir[2] = -Math.sin(a) - Math.cos(a) * inward * 0.6;
      GUST.speed = 4 + 20 * w;
      GUST.alpha = 0.18 + 0.32 * w;
      this.particles.puff(x, y, z, 1, GUST);
    }
  }

  /** The bolts off it: to the floor, up into the cloud, piece to piece. */
  private paintArcs(t: number, reduced: boolean, hx: number, hz: number): void {
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    for (let i = 0; i < BREATH_DEATH_ARCS.length; i++) {
      const a = BREATH_DEATH_ARCS[i];
      const raw = breathDeathArcLight(a, t, reduced);
      if (raw <= 0.01) continue;
      const light = breathDeathLight(raw * 1.25, reduced);
      const beat = reduced ? 0 : Math.floor(((t - a.at) / a.life) * 3);
      const seed = i * 97 + beat * 13 + 7;
      const f = this.sock[a.from];
      const fx = f.x - sx;
      const fy = f.y - sy;
      const fz = f.z - sz;
      if (a.kind === 'floor') {
        const bx = hx + Math.sin(a.angle) * a.r;
        const bz = hz + Math.cos(a.angle) * a.r;
        const by = this.groundY(sx + bx, sz + bz) - sy;
        if (this.bolts.draw(seed, fx, fy, fz, bx, by, bz, 0.16, 0.9, light))
          this.bolts.fork(
            seed + 1,
            0.55,
            Math.sin(a.angle + 1.2) * 4,
            -3,
            Math.cos(a.angle + 1.2) * 4,
            0.4,
            light * 0.6,
          );
        this.bolts.glow(bx, by + 0.6, bz, 6, 0.45 * light, 0.6 * light, light);
      } else if (a.kind === 'sky') {
        const bx = fx + Math.sin(a.angle) * a.r * 0.8;
        const bz = fz + Math.cos(a.angle) * a.r * 0.8;
        this.bolts.draw(seed, fx, fy, fz, bx, SH.deckH - 3, bz, 0.12, 0.9, light * 0.9);
      } else {
        const b = this.sock[a.to];
        this.bolts.draw(seed, fx, fy, fz, b.x - sx, b.y - sy, b.z - sz, 0.25, 0.55, light);
      }
    }
  }

  private card(
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
  ): void {
    if (this.cardN >= CARDS) return;
    _m.compose(_p.set(x, y, z), _q.identity(), _s.setScalar(size));
    this.cards.setMatrixAt(this.cardN, _m);
    this.cards.setColorAt(this.cardN, _c.setRGB(r, g, b));
    this.cardN++;
  }

  private paintCards(): void {
    const was = this.cards.visible;
    for (let i = this.cardN; i < CARDS; i++) this.cards.setMatrixAt(i, _zero);
    this.cards.visible = this.cardN > 0;
    if (this.cardN > 0 || was) {
      this.cards.instanceMatrix.needsUpdate = true;
      if (this.cards.instanceColor) this.cards.instanceColor.needsUpdate = true;
    }
  }

  private thud(amount: number, reach: number, e: Entity): void {
    const me = this.world?.entities.get(this.world.playerId);
    if (!this.shakeSink || !me) return;
    const k = breathDeathShake(
      amount,
      reach,
      Math.hypot(me.pos.x - e.pos.x, me.pos.z - e.pos.z),
      this.reducedMotion(),
    );
    if (k > 0) this.shakeSink(k);
  }

  private sounds(t: number, prev: number, e: Entity): void {
    if (prev < 0 || t <= prev) return;
    for (const snd of BREATH_DEATH_SOUNDS) {
      if (!breathDeathCrossed(prev, t, snd.at)) continue;
      sfx.playAt(snd.key, e.pos.x, e.pos.y + 8, e.pos.z, {
        gain: snd.gain,
        rate: snd.rate,
        cooldown: 0.05,
        jitter: false,
        priority: true,
      });
    }
  }

  // ---- the scan --------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.entityId >= 0) this.release();
      return;
    }
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== BREATH_GUARDIAN) continue;
      if (e.id !== this.entityId) this.take(e.id);
      break;
    }
  }

  /** Track a guardian's body (a new run's: its record starts afresh). */
  private take(id: number): void {
    if (this.holding && this.entityId >= 0 && this.entityId !== id)
      holdBreathDeath(this.entityId, null);
    if (this.entityId !== id) this.holding = false;
    this.entityId = id;
    this.deadKnown = false;
    this.deadAt = 0;
    this.seenAlive = false;
    this.replayAt = -1;
    this.fell = false;
    this.t = -1;
    this.prev = -1;
  }

  private release(): void {
    if (this.holding && this.entityId >= 0) holdBreathDeath(this.entityId, null);
    this.holding = false;
    this.take(-1);
    this.rosterSeen = Number.NaN;
    this.stage.visible = false;
    this.hideScene();
    this.particles.hideRings();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.root.removeFromParent();
    this.particles.dispose();
    this.cards.dispose();
    this.flash.dispose();
    this.bolts.glows.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// ---- particles' options (written in place) -----------------------------------------------------

const STREAM_CORE: SanctumPuffOptions & { alpha: number } = {
  speed: 0.2,
  life: 0.7,
  size: [1.3, 0.3],
  color: WIND,
  alpha: 1,
  pool: 'glow',
  drag: 2,
  floor: -1e6,
};
const STREAM_SHADE: SanctumPuffOptions = {
  speed: 0.4,
  life: 1.1,
  size: [1.8, 4],
  color: WIND_SHADE,
  alpha: 0.22,
  drag: 1.5,
  floor: -1e6,
};
const GUST: SanctumPuffOptions & {
  dir: [number, number, number];
  speed: number;
  alpha: number;
} = {
  speed: 20,
  life: 0.9,
  size: [1.4, 3.2],
  color: WIND_SHADE,
  alpha: 0.4,
  dir: [1, 0, 0],
  spread: 0.08,
  drag: 0.4,
  floor: -1e6,
};
const UNRAVEL: SanctumPuffOptions & { dir: [number, number, number] } = {
  speed: 5,
  up: 1.2,
  life: 3.2,
  size: [4, 13],
  color: CLOUD,
  alpha: 0.5,
  dir: [1, 0.2, 0],
  spread: 0.5,
  drag: 0.7,
  radius: 1.5,
  floor: -1e6,
};
const UNRAVEL_GLINT: SanctumPuffOptions = {
  speed: 4,
  up: 1,
  life: 1.4,
  size: [0.9, 0.15],
  color: SPARK,
  alpha: 1,
  pool: 'glow',
  drag: 0.8,
  radius: 2,
  floor: -1e6,
};
const UNRAVEL_BURST: SanctumPuffOptions = {
  speed: 9,
  up: 1,
  life: 2.6,
  size: [5, 15],
  color: CLOUD,
  alpha: 0.45,
  drag: 1,
  radius: 3,
  floor: -1e6,
};
const PULL_SPARKS: SanctumPuffOptions = {
  speed: 7,
  life: 0.6,
  size: [1, 0.15],
  color: SPARK,
  alpha: 1,
  pool: 'glow',
  drag: 1.2,
  radius: 1.5,
  floor: -1e6,
};
const CLAP_SPARKS: SanctumPuffOptions = {
  speed: 16,
  up: 2,
  life: 1,
  size: [1.4, 0.2],
  color: SPARK,
  alpha: 1,
  pool: 'glow',
  drag: 1.3,
  radius: 2,
  floor: -1e6,
};
const CLAP_SMOKE: SanctumPuffOptions = {
  speed: 7,
  up: 1.5,
  life: 2.4,
  size: [5, 14],
  color: CLOUD,
  alpha: 0.45,
  drag: 1,
  radius: 3,
  floor: -1e6,
};
const MOTE: SanctumPuffOptions = {
  speed: 0.2,
  up: -0.6,
  life: 3.2,
  size: [0.45, 0.3],
  color: SUN,
  alpha: 0.9,
  pool: 'glow',
  drag: 0.5,
  floor: -1e6,
};
