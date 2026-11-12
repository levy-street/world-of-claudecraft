// The Guardian of the Heat's death, "The fire goes home" (plan:
// heat_death_core.ts), hosted by ../rift_death_zone.ts and updated right
// after the entrance and before the Heat's other painters (it holds its look
// through heat_entrance_state.ts, as the entrance does, so the body's flames
// (heat_body.ts) and the wellspring (heat_well_fx.ts) ride its clock). It
// reads the guardian's death off IWorld (offline and online alike), runs the
// scene's clock (a death seen live plays it; a corpse first seen dead is a
// cold husk; a dev replay cue, `/dev heart heat death`, plays it on the
// living body and gives the fire back), writes the model's skin through
// heat_coal_skin.ts (white-hot, red, black coal) and draws:
//  - the choke: flames and embers drawn in out of the air into its heart, a
//    ring of fire closing in across the floor onto it, a flash in its chest;
//  - the gutter: its flames going out from its crown down (the body's own
//    tongues, through the held look);
//  - the exhale: a burst of embers and smoke out of its chest and a spiral of
//    smoke and sparks climbing away;
//  - the cracks: a glow on each crack of the coal husk, dying one by one
//    with a wisp of smoke;
//  - the crumble: chunks of basalt falling off the husk (the quarry stone's
//    program with its seams a dull ember), a slide of ash, a thud.
// No camera is taken, no control, nothing held back from loot or exit.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated (its
// programs are the council's stone and light cards, linked with the raid);
// fixed pools, no light, no per-frame allocation. Its particles ride the
// entrance's rungs on the Heat's floor ladder (the two never draw at once).
// The low tier thins the particles and the chunks and sheds the white-hot
// halo (`HEAT_DEATH_SECONDARY_LAYERS`); every beat plays on every tier;
// reduced motion takes the thuds and calms the light.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HEAT_DEV_CUES } from '../../sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { GLOW_FRAG, GLOW_VERT, STONE_FRAG, STONE_VERT } from './council_entrance_glsl';
import { rockGeometry } from './council_entrance_stone';
import { inSmithHeartClaim } from './council_fx_core';
import { entranceBudgetNow } from './entrance_budget';
import { HEAT_DEATH_SECONDARY_LAYERS } from './entrance_budget_core';
import { HEAT_GUARDIAN, HEAT_MODEL_LAVA, HEAT_SOCKETS, HEAT_YD_PER_UNIT } from './heat_body_core';
import { heatBodySockets } from './heat_body_sockets';
import { HeatCoalSkin } from './heat_coal_skin';
import {
  HEAT_CHUNKS,
  HEAT_CRACKS,
  HEAT_DEATH,
  HEAT_DEATH_GESTURES,
  HEAT_DEATH_HEART,
  HEAT_DEATH_RATES,
  HEAT_DEATH_SHAKES,
  HEAT_DEATH_SOUNDS,
  heatChokeDraw,
  heatChokeRing,
  heatChunkAt,
  heatCrackLevel,
  heatDeathBodyLook,
  heatDeathCrossed,
  heatDeathKept,
  heatDeathLight,
  heatDeathShake,
  heatDeathTime,
  heatExhale,
} from './heat_death_core';
import { newHeatEntranceLook } from './heat_entrance_core';
import { holdHeatEntrance } from './heat_entrance_state';
import { heatParticleSteps } from './heat_floor_ladder_core';

const SCAN_SEC = 0.25;
/** Reduced motion's white-hot: the skin's emissive capped this far past the
 *  authored (a warm glow, never a blaze). */
const HEAT_DEATH_CALM_GLOW = 0.6;
const CARDS = 24;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _axis = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _ring = { r: 0, k: 0 };
const _ch = { out: 0, y: 0, turn: 0, landed: false, shown: false };

const FIRE: readonly [number, number, number] = [1, 0.55, 0.16];
const WHITE: readonly [number, number, number] = [1, 0.9, 0.7];
const EMBER: readonly [number, number, number] = [1, 0.38, 0.08];
const SMOKE: readonly [number, number, number] = [0.46, 0.4, 0.36];
const ASH: readonly [number, number, number] = [0.32, 0.29, 0.27];

export class HeatDeathFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** Laid on the guardian's feet (the particles, the chunks: small local
   *  coordinates, never a world point a hundred thousand yards out). */
  private readonly stage = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly secondary: boolean;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly cards: THREE.InstancedMesh;
  private readonly halo: THREE.InstancedMesh;
  private readonly chunks: THREE.InstancedMesh;
  private readonly chunkMat: THREE.ShaderMaterial;
  private readonly chunkPicks: number[] = [];
  /** Where each chunk broke off (stage-local), held from the crumble. */
  private readonly chunkBirth: Float32Array;
  private chunksBorn = false;
  private readonly skin = new HeatCoalSkin();
  /** This scene holds the guardian's look (heat_entrance_state.ts). */
  private holding = false;
  /** A husk long past its scene, painted once at rest (nothing more to write). */
  private rested = false;
  private readonly look = newHeatEntranceLook();
  private cardN = 0;
  /** The sockets this frame (world), from the model's bones or the plan. */
  private readonly sock: THREE.Vector3[] = HEAT_SOCKETS.map(() => new THREE.Vector3());
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
  private seed = 0x4ea7;
  private drawDebt = 0;
  private ringDebt = 0;
  private spiralDebt = 0;
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
    this.root.name = 'smith-heart-heat-death';
    setRenderCategory(this.root, 'ui3d');
    this.stage.name = 'smithHeartHeatDeathStage';
    this.stage.visible = false;
    this.root.add(this.stage);
    const budget = entranceBudgetNow('heat');
    this.secondary = budget.secondary;
    this.density = budget.share;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.stage,
      this.uTime,
      this.density,
      (x, z) =>
        this.groundY(x + this.stage.position.x, z + this.stage.position.z) - this.stage.position.y,
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
      heatParticleSteps('heat_entrance'),
    );
    // ---- light cards: the heart, the cracks (the council's light card) ----
    const card = new THREE.PlaneGeometry(1, 1);
    this.geometries.push(card);
    const glowMat = (name: string) => {
      const m = new THREE.ShaderMaterial({
        name,
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(m);
      return m;
    };
    const cards = (name: string, n: number) => {
      const mesh = new THREE.InstancedMesh(card, glowMat(name), n);
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
    this.cards = cards('smithHeartHeatDeathLight', CARDS);
    this.halo = cards(HEAT_DEATH_SECONDARY_LAYERS[0], 1);
    // ---- the basalt that crumbles off the husk ----
    const chunkGeo = rockGeometry(61, 0.5);
    this.geometries.push(chunkGeo);
    this.chunkMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatDeathChunkMat',
      uniforms: {
        uCrack: { value: 1 },
        uHeat: { value: 0.35 },
        uHeight: { value: 30 },
        uEmber: { value: 0.4 },
        uTime: this.uTime,
        uTint: { value: 1 },
      },
      vertexShader: STONE_VERT,
      fragmentShader: STONE_FRAG,
    });
    this.materials.push(this.chunkMat);
    for (let i = 0; i < HEAT_CHUNKS.length; i++)
      if (heatDeathKept(i, this.density)) this.chunkPicks.push(i);
    this.chunks = new THREE.InstancedMesh(chunkGeo, this.chunkMat, this.chunkPicks.length);
    this.chunks.name = 'smithHeartHeatDeathChunks';
    this.chunks.frustumCulled = false;
    this.chunks.visible = false;
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.chunkPicks.length; i++) this.chunks.setMatrixAt(i, _zero);
    this.stage.add(this.chunks);
    this.chunkBirth = new Float32Array(HEAT_CHUNKS.length * 3);
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
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
    if (ev.type !== 'spellfx' || ev.ability !== HEAT_DEV_CUES.deathReplay) return false;
    const e = this.world.entities.get(ev.sourceId);
    if (!e || e.templateId !== HEAT_GUARDIAN || e.dead) return true;
    if (this.entityId !== e.id) this.take(e.id);
    this.replayAt = this.clock;
    this.fell = false;
    this.chunksBorn = false;
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
    // Out of view and not dying: a death that happens unseen is a husk when
    // it comes back, never a scene replayed late.
    if (!e && !this.deadKnown) this.seenAlive = false;
    if (e) {
      if (e.dead) {
        if (!this.deadKnown) {
          this.deadKnown = true;
          this.deadAt = this.seenAlive ? this.clock : this.clock - HEAT_DEATH.end - 30;
          this.replayAt = -1;
          this.chunksBorn = false;
        }
      } else {
        if (this.deadKnown) {
          // Revived (a reset): the fire comes back at once.
          this.deadKnown = false;
          this.chunksBorn = false;
        }
        this.seenAlive = true;
      }
    }
    this.prev = this.t;
    this.t = heatDeathTime(this.clock, this.deadAt, this.replayAt, this.deadKnown);
    if (!this.deadKnown && this.replayAt >= 0 && this.t < 0 && this.clock >= this.replayAt) {
      this.replayAt = -1;
      this.fell = false;
    }
    this.particles.update(this.clock);
    this.cardN = 0;
    if (!e || this.t < 0) {
      this.letGo(e);
      this.paintCards();
      return;
    }
    // The body's fire and skin ride the scene (the held look). A husk long
    // past it keeps its last look held and its rubble still: nothing to write.
    const rest = this.deadKnown && this.t > HEAT_DEATH.end + 1;
    if (rest && this.rested) {
      holdHeatEntrance(e.id, this.look);
      this.holding = true;
      return;
    }
    this.rested = rest;
    heatDeathBodyLook(this.t, this.look);
    holdHeatEntrance(e.id, this.look);
    this.holding = true;
    // Reduced motion: white-hot is calmed (the cooling still reads).
    const glow = this.reducedMotion()
      ? Math.min(this.look.glow, 1 + HEAT_DEATH_CALM_GLOW)
      : this.look.glow;
    this.skin.apply(glow, this.look.coal);
    if (!this.deadKnown && !this.fell) {
      this.fell = true;
      this.playGesture?.(e.id, HEAT_DEATH_GESTURES.fall);
    }
    this.readSockets(e);
    const at = fxAnchor(e);
    this.stage.position.set(at.x, at.y, at.z);
    this.stage.visible = true;
    this.paint(e, dt);
    this.paintCards();
  }

  /** No scene: the hold and the skin given back. */
  private letGo(e: Entity | null): void {
    if (this.skin.holding) this.skin.restore();
    // Only a hold of its own (the entrance holds its look each frame first).
    if (e && this.holding) holdHeatEntrance(e.id, null);
    this.holding = false;
    this.chunks.visible = false;
    this.halo.visible = false;
    this.rested = false;
    if (this.t < 0) this.stage.visible = this.particles.liveRings() > 0;
  }

  private readSockets(e: Entity): void {
    const set = heatBodySockets();
    const at = fxAnchor(e);
    const sin = Math.sin(e.facing);
    const cos = Math.cos(e.facing);
    for (let i = 0; i < HEAT_SOCKETS.length; i++) {
      const p = set?.points[i];
      if (p) {
        p.getWorldPosition(this.sock[i]);
        continue;
      }
      const a = HEAT_SOCKETS[i].at;
      const x = a[0] * HEAT_YD_PER_UNIT;
      const z = a[2] * HEAT_YD_PER_UNIT;
      this.sock[i].set(
        at.x + x * cos + z * sin,
        at.y + (a[1] - HEAT_MODEL_LAVA) * HEAT_YD_PER_UNIT,
        at.z - x * sin + z * cos,
      );
    }
  }

  // ---- the paint -----------------------------------------------------------------------------

  private paint(e: Entity, dt: number): void {
    const t = this.t;
    const prev = this.prev;
    const D = HEAT_DEATH;
    const reduced = this.reducedMotion();
    const crossed = (at: number) => heatDeathCrossed(prev, t, at);
    const heart = this.sock[HEAT_DEATH_HEART];
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    // ---- the choke: the fire drawn in, the ring closing ----
    const draw = heatChokeDraw(t);
    if (draw > 0.01) {
      this.drawDebt += dt * HEAT_DEATH_RATES.draw * draw * this.density;
      if (this.drawDebt > 40) this.drawDebt = 40;
      while (this.drawDebt >= 1) {
        this.drawDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = 7 + this.rand() * 9;
        const px = heart.x + Math.sin(a) * r;
        const pz = heart.z + Math.cos(a) * r;
        const py = heart.y + (this.rand() - 0.35) * 9;
        _v.set(heart.x - px, heart.y - py, heart.z - pz);
        const len = _v.length() || 1;
        DRAWN.dir[0] = _v.x / len;
        DRAWN.dir[1] = _v.y / len;
        DRAWN.dir[2] = _v.z / len;
        DRAWN.life = 0.38 + this.rand() * 0.2;
        DRAWN.speed = len / DRAWN.life;
        DRAWN.color = this.rand() < 0.3 ? WHITE : FIRE;
        DRAWN.pool = this.rand() < 0.5 ? 'pyre' : 'glow';
        this.particles.puff(px - sx, py - sy, pz - sz, 1, DRAWN);
      }
    }
    const ring = heatChokeRing(t, _ring);
    if (ring.k > 0.01) {
      this.ringDebt += dt * HEAT_DEATH_RATES.ring * ring.k * this.density;
      if (this.ringDebt > 60) this.ringDebt = 60;
      while (this.ringDebt >= 1) {
        this.ringDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const px = Math.sin(a) * ring.r;
        const pz = Math.cos(a) * ring.r;
        RING_FIRE.dir[0] = -Math.sin(a) * 0.6;
        RING_FIRE.dir[2] = -Math.cos(a) * 0.6;
        RING_FIRE.color = this.rand() < 0.25 ? WHITE : FIRE;
        const gy = this.groundY(sx + px, sz + pz) - sy;
        this.particles.puff(px, gy + 0.4, pz, 1, RING_FIRE);
      }
    }
    // ---- the heart's light: white-hot in the choke, red, out ----
    const hot = Math.max(0, this.look.glow - 1) / 2.6;
    const heartK = heatDeathLight(
      t < D.exhaleAt + 0.3 ? 0.5 + 1.6 * hot + 1.2 * draw : 0.6 * Math.max(0, this.look.glow - 0.1),
      reduced,
    );
    if (heartK > 0.02)
      this.card(
        heart.x - sx,
        heart.y - sy,
        heart.z - sz,
        6 + 6 * hot,
        heartK,
        0.62 * heartK,
        0.25 * heartK,
      );
    // The white-hot halo round the whole body (a cosmetic double over the
    // skin's own blaze: the low tier keeps the skin).
    this.halo.visible = this.secondary && hot > 0.02;
    if (this.halo.visible) {
      const k = heatDeathLight(0.55 * hot, reduced);
      _m.compose(_p.set(heart.x - sx, heart.y - sy, heart.z - sz), _q.identity(), _s.setScalar(26));
      this.halo.setMatrixAt(0, _m);
      this.halo.setColorAt(0, _c.setRGB(k, 0.66 * k, 0.32 * k));
      this.halo.instanceMatrix.needsUpdate = true;
      if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
    }
    // ---- the cracks on the husk, dying one by one ----
    for (const c of HEAT_CRACKS) {
      const lv = heatDeathLight(heatCrackLevel(c, t), reduced);
      const p = this.sock[c.socket];
      if (lv > 0.01) this.card(p.x - sx, p.y - sy, p.z - sz, c.size, lv, 0.36 * lv, 0.06 * lv);
      if (crossed(c.outAt)) this.particles.puff(p.x - sx, p.y - sy + 0.3, p.z - sz, 6, WISP);
    }
    // ---- the moments ----
    if (crossed(0.03)) {
      this.particles.puff(heart.x - sx, heart.y - sy, heart.z - sz, 30, CHEST_SPARKS);
      this.thud(HEAT_DEATH_SHAKES.choke.amount, HEAT_DEATH_SHAKES.choke.reach, e);
    }
    if (crossed(D.exhaleAt)) {
      this.particles.puff(heart.x - sx, heart.y - sy, heart.z - sz, 200, EXHALE_EMBERS);
      this.particles.puff(heart.x - sx, heart.y - sy, heart.z - sz, 60, EXHALE_SMOKE);
      const fk = heatDeathLight(1.2, this.reducedMotion());
      this.card(heart.x - sx, heart.y - sy, heart.z - sz, 14, fk, 0.46 * fk, 0.12 * fk);
      this.particles.shockRing(0, 0, 0xff7a2a, 22, 1.1, { wake: 0.25, crest: 0.08, strength: 0.6 });
      this.thud(HEAT_DEATH_SHAKES.exhale.amount, HEAT_DEATH_SHAKES.exhale.reach, e);
    }
    const ex = heatExhale(t);
    if (ex > 0.01) {
      // The spiral: an emitter turning round its axis as it climbs, so the
      // rising smoke and sparks wind up in a corkscrew.
      this.spiralDebt += dt * HEAT_DEATH_RATES.spiral * ex * this.density;
      if (this.spiralDebt > 20) this.spiralDebt = 20;
      const s = t - D.exhaleAt;
      while (this.spiralDebt >= 1) {
        this.spiralDebt -= 1;
        const a = s * 7 + this.rand() * 0.5;
        const r = 2 + s * 1.5;
        const h = heart.y - sy + s * 5;
        // Mostly sparks and dying flame (they read against the dark rock),
        // smoke between them.
        const roll = this.rand();
        const o = roll < 0.45 ? SPIRAL_SPARK : roll < 0.7 ? SPIRAL_FLAME : SPIRAL_SMOKE;
        this.particles.puff(
          heart.x - sx + Math.sin(a) * r,
          h,
          heart.z - sz + Math.cos(a) * r,
          1,
          o,
        );
      }
    }
    if (crossed(D.crumbleAt)) {
      this.particles.puff(0, 0.5, 0, 26, ASH_SLIDE);
      this.thud(HEAT_DEATH_SHAKES.crumble.amount, HEAT_DEATH_SHAKES.crumble.reach, e);
    }
    this.paintChunks(t);
    this.sounds(t, prev, e);
  }

  /** The basalt crumbling off the husk (lying at its feet after). */
  private paintChunks(t: number): void {
    const since = t - HEAT_DEATH.crumbleAt;
    const replayOver = !this.deadKnown && t > HEAT_DEATH.end - 0.4;
    if (since < 0 || replayOver) {
      this.chunks.visible = false;
      if (since < 0) this.chunksBorn = false;
      return;
    }
    const sx = this.stage.position.x;
    const sy = this.stage.position.y;
    const sz = this.stage.position.z;
    if (!this.chunksBorn) {
      for (let i = 0; i < HEAT_CHUNKS.length; i++) {
        const p = this.sock[HEAT_CHUNKS[i].socket];
        this.chunkBirth[i * 3] = p.x - sx;
        this.chunkBirth[i * 3 + 1] = p.y - sy;
        this.chunkBirth[i * 3 + 2] = p.z - sz;
      }
      this.chunksBorn = true;
    }
    this.chunks.visible = true;
    for (let j = 0; j < this.chunkPicks.length; j++) {
      const i = this.chunkPicks[j];
      const c = HEAT_CHUNKS[i];
      const bx = this.chunkBirth[i * 3];
      const by = this.chunkBirth[i * 3 + 1];
      const bz = this.chunkBirth[i * 3 + 2];
      const floor = this.groundY(sx + bx, sz + bz) - sy;
      const f = heatChunkAt(c, since, by - floor - c.size * 0.3, _ch);
      if (!f.shown) {
        this.chunks.setMatrixAt(j, _zero);
        continue;
      }
      const a = c.angle + Math.atan2(bx, bz);
      _axis.set(Math.sin(i * 1.3), 0.6, Math.cos(i * 2.1)).normalize();
      _q.setFromAxisAngle(_axis, f.turn);
      _m.compose(
        _p.set(bx + Math.sin(a) * f.out, by + f.y, bz + Math.cos(a) * f.out),
        _q,
        _s.set(c.size, c.size * 0.75, c.size * 0.9),
      );
      this.chunks.setMatrixAt(j, _m);
    }
    this.chunks.instanceMatrix.needsUpdate = true;
    // Their seams cool from a dull ember to dark.
    this.chunkMat.uniforms.uHeat.value = 0.35 * Math.max(0, 1 - since / 1.5);
    this.chunkMat.uniforms.uEmber.value = 0.4 * Math.max(0, 1 - since / 2.5);
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
    const k = heatDeathShake(
      amount,
      reach,
      Math.hypot(me.pos.x - e.pos.x, me.pos.z - e.pos.z),
      this.reducedMotion(),
    );
    if (k > 0) this.shakeSink(k);
  }

  private sounds(t: number, prev: number, e: Entity): void {
    if (prev < 0 || t <= prev) return;
    for (const snd of HEAT_DEATH_SOUNDS) {
      if (!heatDeathCrossed(prev, t, snd.at)) continue;
      sfx.playAt(snd.key, e.pos.x, e.pos.y + 6, e.pos.z, {
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
      if (e.kind !== 'mob' || e.templateId !== HEAT_GUARDIAN) continue;
      if (e.id !== this.entityId) this.take(e.id);
      break;
    }
  }

  /** Track a guardian's body (a new run's: its record starts afresh). */
  private take(id: number): void {
    if (this.holding && this.entityId >= 0 && this.entityId !== id)
      holdHeatEntrance(this.entityId, null);
    if (this.entityId !== id) this.holding = false;
    this.entityId = id;
    this.deadKnown = false;
    this.deadAt = 0;
    this.seenAlive = false;
    this.replayAt = -1;
    this.fell = false;
    this.t = -1;
    this.prev = -1;
    this.chunksBorn = false;
  }

  private release(): void {
    if (this.holding && this.entityId >= 0) holdHeatEntrance(this.entityId, null);
    this.holding = false;
    if (this.skin.holding) this.skin.restore();
    this.take(-1);
    this.rosterSeen = Number.NaN;
    this.stage.visible = false;
    this.particles.hideRings();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.root.removeFromParent();
    this.particles.dispose();
    this.cards.dispose();
    this.halo.dispose();
    this.chunks.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}

// ---- particles' options (written in place) -----------------------------------------------------

const DRAWN = {
  speed: 10,
  life: 0.45,
  size: [1.2, 0.3] as [number, number],
  color: FIRE,
  alpha: 1,
  pool: 'glow' as 'glow' | 'pyre',
  dir: [0, 0, 0] as [number, number, number],
  spread: 0.04,
  drag: 0,
  floor: -1e6,
};
const RING_FIRE = {
  speed: 3,
  up: 3,
  life: 0.55,
  size: [1.8, 0.4] as [number, number],
  color: FIRE,
  alpha: 1,
  pool: 'pyre' as const,
  dir: [0, 0.6, 0] as [number, number, number],
  spread: 0.3,
  drag: 0.6,
};
const CHEST_SPARKS = {
  speed: 9,
  up: 2,
  life: 0.6,
  size: [0.6, 0.08] as [number, number],
  color: WHITE,
  alpha: 1,
  pool: 'glow' as const,
  drag: 1.2,
  radius: 1.5,
};
const EXHALE_EMBERS = {
  speed: 11,
  up: 9,
  life: 2.2,
  size: [0.8, 0.1] as [number, number],
  color: EMBER,
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.9,
  radius: 2.5,
  floor: -1e6,
};
const EXHALE_SMOKE = {
  speed: 5,
  up: 6,
  life: 3.4,
  size: [4, 12] as [number, number],
  color: SMOKE,
  alpha: 0.7,
  drag: 0.8,
  radius: 2.5,
  floor: -1e6,
};
const SPIRAL_SMOKE = {
  speed: 0.6,
  up: 5.5,
  life: 2.6,
  size: [3, 8.5] as [number, number],
  color: SMOKE,
  alpha: 0.65,
  drag: 0.3,
  floor: -1e6,
};
const SPIRAL_FLAME = {
  speed: 0.8,
  up: 6,
  life: 1.1,
  size: [2.2, 0.6] as [number, number],
  color: FIRE,
  alpha: 1,
  pool: 'pyre' as const,
  drag: 0.3,
  floor: -1e6,
};
const SPIRAL_SPARK = {
  speed: 1,
  up: 6.5,
  life: 1.8,
  size: [0.7, 0.08] as [number, number],
  color: EMBER,
  alpha: 1,
  pool: 'glow' as const,
  drag: 0.3,
  floor: -1e6,
};
const WISP = {
  speed: 0.5,
  up: 2.6,
  life: 2,
  size: [0.8, 2.6] as [number, number],
  color: SMOKE,
  alpha: 0.45,
  drag: 0.4,
  radius: 0.4,
  floor: -1e6,
};
const ASH_SLIDE = {
  speed: 5,
  up: 0.6,
  life: 2,
  size: [1.6, 4.5] as [number, number],
  color: ASH,
  alpha: 0.45,
  drag: 1.5,
  radius: 4,
};
