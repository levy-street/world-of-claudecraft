// The Guardian of the Quench's provisional body (plan: quench_body_core.ts),
// hosted by ../rift_death_zone.ts beside the raid's other fx. The guardian is
// a bodyless target (characters/manifest.ts smith_heart_quench_guardian): its
// click capsule, nameplate and bars come from the ordinary entity view, and
// this module draws the body over it, read from IWorld (its position,
// facing, cast bar, swings, auras and death, and its cues), so offline and
// online look the same:
//  - the body: an ice guardian of the lake, frost-bound granite (the Heart
//    kit's colossus rock, repainted pale) clad in clear lake ice (the Quench
//    kit's heaved blades, frozen falls and frost stones): ice plates on its
//    chest, a crest of ice blades off its back and on its head, pauldrons of
//    heaved ice, forearms and shins of frozen falls, the lake's cold light in
//    a crystal heart and threads of it between its joints; two legs;
//  - the motion: its slow breath (frost plumes on every out-breath), a swipe
//    at the tank on each melee hit, Tempering Strike's two-fisted slam on the
//    ice before it, Quenching Breath's rearing back (its heart blazing) then
//    throwing the cold out (a plume of frost down its cone), and at half
//    health its arms raised to the sky as the four blades tear free, thrown
//    down as they wake; once they are awake its crest burns brighter;
//  - the death: the threads flare and go out, every piece falls and tumbles
//    to the ice round where it stood.
// Presentation only: the fight's telegraphs are quench_fx.ts's and
// quench_fight_fx.ts's, on every tier; the motes, mist and shakes here thin
// on the low tier and under reduced motion; the body and its poses never do.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the kits' pieces, which land
// later, draw with the kits' own shared slot materials linked by their
// program warmers, and this module's glows each have a hidden carrier); no
// light; fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { QUENCH_CASTS, QUENCH_CUES } from '../../sim/encounters/smith_heart/quench_ids';
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
import { inSmithHeartClaim } from './council_fx_core';
import { ARC_CLEAVE_ABILITY } from './hammer_fx_core';
import {
  bladesAwakeOn,
  QJ,
  QUENCH_BODY_COLORS,
  QUENCH_BODY_KITS,
  QUENCH_BODY_PIECES,
  QUENCH_BODY_POOLS,
  QUENCH_FALL,
  QUENCH_GUARDIAN,
  QUENCH_MOTE_JOINTS,
  QUENCH_RIG_JOINTS,
  QUENCH_SLOTS,
  QUENCH_THREAD_PAIRS,
  type QuenchArmJoints,
  type QuenchBodyAction,
  type QuenchBodyActionState,
  type QuenchBodyInput,
  type QuenchBodyLook,
  type QuenchBodyPiece,
  quenchArm,
  quenchBodyAction,
  quenchBodyHash,
  quenchBodyLook,
  quenchFallProgress,
  quenchFallRest,
  quenchWristTarget,
  restJoint,
  type V3,
} from './quench_body_core';

const SCAN_SEC = 0.1;
/** A thread colour change smaller than this is not re-uploaded. */
const THREAD_COLOR_EPS = 1 / 512;
/** The joints that turn with the head (the head, the maw). */
const HEAD_JOINTS = [QJ.head, QJ.maw] as const;
/** The joints the upper body's lean carries (about the hips). */
const LEAN_JOINTS = [
  QJ.chest,
  QJ.head,
  QJ.maw,
  QJ.back,
  QJ.shoulderL,
  QJ.shoulderR,
  QJ.elbowL,
  QJ.elbowR,
  QJ.wristL,
  QJ.wristR,
] as const;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _rest: V3 = { x: 0, y: 0, z: 0 };
const _wrist: V3 = { x: 0, y: 0, z: 0 };
const _arm: QuenchArmJoints = { elbow: { x: 0, y: 0, z: 0 }, wrist: { x: 0, y: 0, z: 0 } };
const _act: QuenchBodyActionState = { action: 'idle', k: 0 };
const _actIn: QuenchBodyInput = {
  castId: null,
  castFill: 0,
  sinceBreath: Number.POSITIVE_INFINITY,
  sinceStrike: Number.POSITIVE_INFINITY,
  sinceSwing: Number.POSITIVE_INFINITY,
  sinceWake: Number.POSITIVE_INFINITY,
  awake: false,
};
const _fall = { k: 0, landed: false };
const _look: QuenchBodyLook = { swell: 0, lift: 0, lean: 0, glow: 0, crest: 0, breath: 0 };

interface PieceView {
  def: QuenchBodyPiece;
  index: number;
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

export class QuenchBody {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly group = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly pieces: PieceView[] = [];
  private readonly threads: THREE.InstancedMesh;
  private readonly crystalMat: THREE.ShaderMaterial;
  private readonly iceGlowMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly moteMat: THREE.SpriteMaterial;
  private readonly eyeMat: THREE.SpriteMaterial;
  private readonly heartGlowMat: THREE.SpriteMaterial;
  private readonly motes: THREE.Sprite[] = [];
  private readonly eyes: THREE.Sprite[] = [];
  private readonly heartGlow: THREE.Sprite;
  private readonly joints: THREE.Vector3[] = [];
  private readonly glowColor = new THREE.Color();
  private readonly white = new THREE.Color(QUENCH_BODY_COLORS.core);
  private readonly threadColor = new THREE.Color();
  /** The thread colour last uploaded (NaN: never). */
  private readonly threadShown = new THREE.Color(Number.NaN, Number.NaN, Number.NaN);
  private readonly standInGeo: THREE.BufferGeometry;
  private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  private readonly glowTex: THREE.Texture | null;
  private kitBuilt = false;
  /** The roster version the last discovery walk saw (NaN: walk next scan). */
  private rosterSeen = Number.NaN;
  private entityId = -1;
  private yaw = 0;
  private swingAt = -99;
  private swingSide: -1 | 1 = 1;
  private strikeAt = -99;
  private breathAt = -99;
  private wakeAt = -99;
  private deadAt = -1;
  private seenAlive = false;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x4c1e;
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
    this.root.name = 'smith-heart-quench-body';
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
    this.geometries.push(carrierGeo);
    // The stand-in every piece wears until its kit lands: a unit rock in the
    // body's frost granite.
    const standIn = new THREE.IcosahedronGeometry(0.5, 1);
    const g = QUENCH_BODY_COLORS.granite;
    const n = standIn.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const shade = 0.8 + 0.4 * quenchBodyHash(i, 7);
      col[i * 3] = g[0] * shade;
      col[i * 3 + 1] = g[1] * shade;
      col[i * 3 + 2] = g[2] * shade;
    }
    standIn.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.standInGeo = standIn;
    this.geometries.push(standIn);
    this.crystalMat = heartVeinGlowMaterial(QUENCH_BODY_COLORS.glow, 'smithHeartQuenchCrystal');
    this.iceGlowMat = heartVeinGlowMaterial(QUENCH_BODY_COLORS.thread, 'smithHeartQuenchSeams');
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
    this.haloMat = sprite(QUENCH_BODY_COLORS.glow, 0.45, 'smithHeartQuenchHalo');
    this.moteMat = sprite(QUENCH_BODY_COLORS.thread, 0.6, 'smithHeartQuenchMote');
    this.eyeMat = sprite(QUENCH_BODY_COLORS.core, 0.95, 'smithHeartQuenchEye');
    this.heartGlowMat = sprite(QUENCH_BODY_COLORS.glow, 0.6, 'smithHeartQuenchHeart');
    const threadMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartQuenchThreads',
    });
    this.materials.push(
      this.crystalMat,
      this.iceGlowMat,
      this.haloMat,
      this.moteMat,
      this.eyeMat,
      this.heartGlowMat,
      threadMat,
    );
    for (const m of [this.crystalMat, this.iceGlowMat]) {
      const carrier = new THREE.Mesh(carrierGeo, m);
      carrier.visible = false;
      carrier.frustumCulled = false;
      carrier.name = 'smithHeartQuenchCarrier';
      this.root.add(carrier);
    }
    this.group.name = 'smithHeartQuenchBody';
    this.group.visible = false;
    this.root.add(this.group);
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.geometries.push(threadGeo);
    this.threads = new THREE.InstancedMesh(threadGeo, threadMat, QUENCH_BODY_POOLS.threads);
    this.threads.name = 'smithHeartQuenchThreads';
    this.threads.frustumCulled = false;
    this.threads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < QUENCH_BODY_POOLS.threads; k++) {
      this.threads.setMatrixAt(k, _m.makeScale(0, 0, 0));
      this.threads.setColorAt(k, this.threadColor.setHex(QUENCH_BODY_COLORS.thread));
    }
    this.group.add(this.threads);
    for (let k = 0; k < QUENCH_RIG_JOINTS; k++)
      this.joints.push(new THREE.Vector3().copy(restJoint(k, _rest)));
    for (let k = 0; k < QUENCH_MOTE_JOINTS.length; k++) {
      const s = new THREE.Sprite(this.moteMat);
      s.scale.set(0.9, 0.9, 1);
      s.name = 'smithHeartQuenchMote';
      this.motes.push(s);
      this.group.add(s);
    }
    for (let k = 0; k < 2; k++) {
      const s = new THREE.Sprite(this.eyeMat);
      s.scale.set(0.55, 0.55, 1);
      s.name = 'smithHeartQuenchEye';
      this.eyes.push(s);
      this.group.add(s);
    }
    this.heartGlow = new THREE.Sprite(this.heartGlowMat);
    this.heartGlow.scale.set(2.6, 2.6, 1);
    this.heartGlow.name = 'smithHeartQuenchHeartGlow';
    this.group.add(this.heartGlow);
    this.root.add(heartKitProgramWarmers());
    const kitsIn = this.kitsLoaded();
    this.buildPieces(kitsIn);
    this.kitBuilt = kitsIn;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (!kitsIn && hasDom)
      void Promise.all([
        ensureHeartKit(QUENCH_BODY_KITS.quench),
        ensureHeartKit(QUENCH_BODY_KITS.heart),
      ])
        .then(() => {
          if (!this.disposed && this.kitsLoaded()) this.upgradeKit();
        })
        .catch(() => {});
  }

  private kitsLoaded(): boolean {
    return heartKitLoaded(QUENCH_BODY_KITS.quench) && heartKitLoaded(QUENCH_BODY_KITS.heart);
  }

  private buildPieces(withKit: boolean): void {
    QUENCH_BODY_PIECES.forEach((def, index) => {
      const holder = new THREE.Group();
      holder.name = `quenchBody:${def.id}`;
      const kit = withKit ? this.fitKit(def) : null;
      let standIn: THREE.Mesh | null = null;
      if (kit) holder.add(kit);
      else {
        standIn = new THREE.Mesh(
          this.standInGeo,
          def.light === 'crystal'
            ? this.crystalMat
            : heartKitSlotMaterial(def.light === 'ice' ? 'ice' : 'stone'),
        );
        standIn.name = 'smithHeartQuenchStandIn';
        // A limb's holder stretches it along its span.
        standIn.scale.set(def.size.x, def.to !== undefined ? 1 : def.size.y, def.size.z);
        standIn.rotation.set(def.tilt.x, def.tilt.y, def.tilt.z);
        standIn.castShadow = def.light !== 'crystal';
        standIn.receiveShadow = def.light !== 'crystal';
        holder.add(standIn);
      }
      this.group.add(holder);
      this.pieces.push({
        def,
        index,
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

  /** One piece's kit shape fitted to its box (centred on its holder); null
   *  when the kit has no such node. A limb's box is its unit length (the
   *  holder stretches it along its span). */
  private fitKit(def: QuenchBodyPiece): THREE.Group | null {
    const kit = heartKitMeshes(QUENCH_BODY_KITS[def.kit], def.node);
    if (!kit) return null;
    for (const m of kit.children) {
      if (!(m instanceof THREE.Mesh)) continue;
      if (def.light === 'crystal') {
        m.material = this.crystalMat;
        m.castShadow = false;
        m.receiveShadow = false;
      } else if (m.name.endsWith(':glow')) m.material = this.iceGlowMat;
      else if (m.name.endsWith(':stone') && def.kit === 'heart')
        m.geometry = this.frostStone(m.geometry);
    }
    _box.setFromObject(kit);
    _box.getSize(_size);
    _box.getCenter(_centre);
    const limb = def.to !== undefined;
    const sx = def.size.x / Math.max(1e-3, _size.x);
    const sy = (limb ? 1 : def.size.y) / Math.max(1e-3, _size.y);
    const sz = def.size.z / Math.max(1e-3, _size.z);
    kit.scale.set(sx, sy, sz);
    kit.position.set(-_centre.x * sx, -_centre.y * sy, -_centre.z * sz);
    const content = new THREE.Group();
    content.name = 'smithHeartQuenchKitPiece';
    const tilt = new THREE.Group();
    tilt.rotation.set(def.tilt.x, def.tilt.y, def.tilt.z);
    tilt.add(kit);
    content.add(tilt);
    if (def.light === 'crystal') {
      const halo = new THREE.Sprite(this.haloMat);
      const s = Math.max(def.size.x, def.size.y, def.size.z) * 1.7;
      halo.scale.set(s, s, 1);
      halo.name = 'smithHeartQuenchCrystalHalo';
      content.add(halo);
    }
    return content;
  }

  /** The kits landed after the body was built: fit every piece's kit shape
   *  into one hidden staging group, link it through the compile gate (one
   *  budgeted unit, never a live frame), then swap each stand-in for it. */
  private upgradeKit(): void {
    if (this.kitBuilt || this.disposed) return;
    this.kitBuilt = true;
    const staging = new THREE.Group();
    staging.name = 'smithHeartQuenchKitStaging';
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

  /** The Heart kit's colossus rock repainted the Quench's frost granite: a
   *  pale cold grey, the kit's own value variation kept as rime on the high
   *  faces and blue in the shade. */
  private frostStone(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = src.clone();
    const col = g.getAttribute('color');
    if (col) {
      const c = QUENCH_BODY_COLORS.granite;
      const d = QUENCH_BODY_COLORS.graniteShade;
      for (let i = 0; i < col.count; i++) {
        const v = Math.min(1, col.getX(i) * 1.5);
        col.setXYZ(i, d[0] + (c[0] - d[0]) * v, d[1] + (c[1] - d[1]) * v, d[2] + (c[2] - d[2]) * v);
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
    } else if (ev.type === 'spellfx' && ev.sourceId === this.entityId) {
      if (ev.fx === 'windup' && ev.ability === ARC_CLEAVE_ABILITY) this.strikeAt = this.clock;
      else if (ev.ability === QUENCH_CASTS.breath) this.breathAt = this.clock;
      else if (ev.ability === QUENCH_CUES.wake) {
        this.wakeAt = this.clock;
        const e = this.world.entities.get(this.entityId);
        if (e) this.wakeBurst(e);
      }
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
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.entityId >= 0) this.release();
      this.rosterSeen = Number.NaN;
      return;
    }
    if (this.entityId >= 0) return;
    // The discovery walk runs on a roster change only, never on the clock.
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== QUENCH_GUARDIAN) continue;
      this.entityId = e.id;
      this.yaw = e.facing;
      this.deadAt = -1;
      this.seenAlive = false;
      this.swingAt = -99;
      this.strikeAt = -99;
      this.breathAt = -99;
      this.wakeAt = -99;
      this.group.visible = true;
      break;
    }
  }

  private release(): void {
    this.entityId = -1;
    this.rosterSeen = Number.NaN;
    this.group.visible = false;
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
      for (const p of this.pieces) {
        p.rest = null;
        p.landed = false;
      }
    }
    this.seenAlive = true;
    const awake = bladesAwakeOn(e.auras);
    const fill = e.castTotal > 0 ? Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal)) : 1;
    _actIn.castId = e.castingAbility;
    _actIn.castFill = fill;
    _actIn.sinceBreath = this.clock - this.breathAt;
    _actIn.sinceStrike = this.clock - this.strikeAt;
    _actIn.sinceSwing = this.clock - this.swingAt;
    _actIn.sinceWake = this.clock - this.wakeAt;
    _actIn.awake = awake;
    quenchBodyAction(_actIn, _act);
    const look = quenchBodyLook(_act.action, _act.k, this.clock, awake, _look);
    this.yaw += wrapAngle(e.facing - this.yaw) * Math.min(1, dt * 5);
    this.group.rotation.y = this.yaw;
    this.poseJoints(_act.action, _act.k, look);
    for (const p of this.pieces) this.posePiece(p, look);
    this.poseThreads(1, look);
    for (let i = 0; i < QUENCH_MOTE_JOINTS.length; i++) {
      this.motes[i].visible = true;
      this.motes[i].position.copy(this.joints[QUENCH_MOTE_JOINTS[i]]);
    }
    this.poseLights(look);
    this.glow(look);
    this.cosmetics(e, _act.action, _act.k, look, dt);
  }

  /** The joints (body frame) for this frame's look. */
  private poseJoints(action: QuenchBodyAction, k: number, look: QuenchBodyLook): void {
    const J = this.joints;
    const S = QUENCH_SLOTS;
    const bob = 0.08 * Math.sin(this.clock * 1.2);
    const sw = 0.1 * (look.swell - 0.5);
    J[QJ.hip].set(S.hip.x, S.hip.y + bob * 0.5, S.hip.z);
    J[QJ.hipL].set(S.hipJoint.x, S.hipJoint.y + bob * 0.5, S.hipJoint.z);
    J[QJ.hipR].set(-S.hipJoint.x, S.hipJoint.y + bob * 0.5, S.hipJoint.z);
    J[QJ.kneeL].set(S.knee.x, S.knee.y + bob * 0.3, S.knee.z);
    J[QJ.kneeR].set(-S.knee.x, S.knee.y + bob * 0.3, S.knee.z);
    J[QJ.footL].set(S.foot.x, S.foot.y, S.foot.z);
    J[QJ.footR].set(-S.foot.x, S.foot.y, S.foot.z);
    J[QJ.chest].set(S.chest.x, S.chest.y + bob + sw, S.chest.z);
    J[QJ.head].set(S.head.x, S.head.y + bob, S.head.z);
    J[QJ.maw].set(S.maw.x, S.maw.y + bob, S.maw.z);
    J[QJ.back].set(S.back.x, S.back.y + bob, S.back.z);
    J[QJ.shoulderL].set(S.shoulder.x + 0.6 * sw, S.shoulder.y + bob, S.shoulder.z);
    J[QJ.shoulderR].set(-J[QJ.shoulderL].x, J[QJ.shoulderL].y, J[QJ.shoulderL].z);
    for (let i = 0; i < 2; i++) {
      const side: -1 | 1 = i === 0 ? 1 : -1;
      const target = quenchWristTarget(action, side, k, this.swingSide, _wrist);
      const arm = quenchArm(side, target, _arm);
      J[QJ.elbowL + i].set(arm.elbow.x, arm.elbow.y + bob, arm.elbow.z);
      J[QJ.wristL + i].set(arm.wrist.x, arm.wrist.y + bob, arm.wrist.z);
    }
    // The head lifts about the neck; the upper body leans about the hips.
    const neckY = J[QJ.chest].y + 1.1;
    _q.setFromAxisAngle(_x, -look.lift);
    for (let h = 0; h < HEAD_JOINTS.length; h++) {
      const i = HEAD_JOINTS[h];
      _a.set(J[i].x, J[i].y - neckY, J[i].z).applyQuaternion(_q);
      J[i].set(_a.x, _a.y + neckY, _a.z);
    }
    const hipY = J[QJ.hip].y;
    const cl = Math.cos(look.lean);
    const sl = Math.sin(look.lean);
    for (const i of LEAN_JOINTS) {
      // The fists planted on the ice by a slam stay down there.
      if ((i === QJ.wristL || i === QJ.wristR) && J[i].y < hipY) continue;
      const y = J[i].y - hipY;
      const z = J[i].z;
      J[i].y = hipY + y * cl - z * sl;
      J[i].z = y * sl + z * cl;
    }
  }

  /** One piece on its joint, or spanning its two (a limb). */
  private posePiece(p: PieceView, look: QuenchBodyLook): void {
    const def = p.def;
    const J = this.joints;
    if (def.to !== undefined) {
      const from = J[def.joint];
      const to = J[def.to];
      _a.subVectors(to, from);
      const len = _a.length() || 1;
      _a.divideScalar(len);
      p.pos.copy(from).addScaledVector(_a, len * 0.5);
      p.quat.setFromUnitVectors(_up, _a);
      p.holder.position.copy(p.pos);
      p.holder.quaternion.copy(p.quat);
      p.holder.scale.set(1, len * def.size.y, 1);
      return;
    }
    const j = J[def.joint];
    _a.set(def.at.x, def.at.y, def.at.z);
    _q2.setFromAxisAngle(_x, look.lean);
    if (def.head) {
      _q.setFromAxisAngle(_x, -look.lift);
      _a.applyQuaternion(_q);
      p.quat.copy(_q2).multiply(_q);
    } else if (def.joint === QJ.hip || def.joint === QJ.footL || def.joint === QJ.footR) {
      p.quat.identity();
    } else {
      _a.applyQuaternion(_q2);
      p.quat.copy(_q2);
    }
    p.pos.copy(j).add(_a);
    if (def.joint === QJ.wristL || def.joint === QJ.wristR) {
      // The fist along its forearm.
      const elbow = J[def.joint === QJ.wristL ? QJ.elbowL : QJ.elbowR];
      _b.subVectors(j, elbow).normalize();
      p.pos.copy(j).addScaledVector(_b, def.size.y * 0.35);
      p.quat.setFromUnitVectors(_up, _b);
    }
    p.holder.position.copy(p.pos);
    p.holder.quaternion.copy(p.quat);
    const s = def.id === 'torso' ? 1 + 0.05 * (look.swell - 0.5) : 1;
    p.holder.scale.setScalar(s);
  }

  /** The threads between the joints at `alpha` of their light. */
  private poseThreads(alpha: number, look: QuenchBodyLook): void {
    const J = this.joints;
    const w = 0.11 * (1 + Math.min(1.5, look.glow - 0.9) * 0.3) * Math.max(0, alpha);
    let n = 0;
    for (let t = 0; t < QUENCH_THREAD_PAIRS.length; t++) {
      const i = QUENCH_THREAD_PAIRS[t][0];
      const j = QUENCH_THREAD_PAIRS[t][1];
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
    for (; n < QUENCH_BODY_POOLS.threads; n++) this.threads.setMatrixAt(n, _m.makeScale(0, 0, 0));
    this.threads.instanceMatrix.needsUpdate = true;
  }

  /** The eyes and the heart's glow, on their joints. */
  private poseLights(look: QuenchBodyLook): void {
    const head = this.joints[QJ.head];
    const chest = this.joints[QJ.chest];
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      _a.set(side * 0.33, 0.12, 0.72);
      _q.setFromAxisAngle(_x, -look.lift);
      _a.applyQuaternion(_q);
      _q2.setFromAxisAngle(_x, look.lean);
      _a.applyQuaternion(_q2);
      this.eyes[i].position.copy(head).add(_a);
    }
    _a.set(0, 0.05, 1.15).applyQuaternion(_q2.setFromAxisAngle(_x, look.lean));
    this.heartGlow.position.copy(chest).add(_a);
    const s = 2.2 + 0.9 * Math.min(3, look.glow);
    this.heartGlow.scale.set(s, s, 1);
  }

  /** The crystals', ice seams' and threads' light. */
  private glow(look: QuenchBodyLook): void {
    const white = Math.min(1, Math.max(0, (look.glow - 2) / 2));
    this.glowColor
      .setHex(QUENCH_BODY_COLORS.glow)
      .lerp(this.white, white)
      .multiplyScalar(Math.min(3, look.glow * 1.4));
    (this.crystalMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.glowColor.setHex(QUENCH_BODY_COLORS.thread).multiplyScalar(Math.min(3, look.crest));
    (this.iceGlowMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.haloMat.opacity = Math.min(0.8, 0.15 + look.glow * 0.16);
    this.moteMat.opacity = Math.min(0.9, 0.3 + look.glow * 0.18);
    this.heartGlowMat.opacity = Math.min(0.95, 0.25 + look.glow * 0.2);
    this.eyeMat.opacity = Math.min(1, 0.6 + look.glow * 0.15);
    this.threadColor
      .setHex(QUENCH_BODY_COLORS.thread)
      .multiplyScalar(0.8 + look.glow * 0.35 + (look.crest - 0.6) * 0.15);
    const tc = this.threadColor;
    const shown = this.threadShown;
    if (
      !(Math.abs(tc.r - shown.r) < THREAD_COLOR_EPS) ||
      !(Math.abs(tc.g - shown.g) < THREAD_COLOR_EPS) ||
      !(Math.abs(tc.b - shown.b) < THREAD_COLOR_EPS)
    ) {
      shown.copy(tc);
      for (let i = 0; i < QUENCH_BODY_POOLS.threads; i++) this.threads.setColorAt(i, tc);
      if (this.threads.instanceColor) this.threads.instanceColor.needsUpdate = true;
    }
  }

  /** The frost breath off its maw, the cold drawn into it, the mist at its
   *  feet, the ice dust of a slam (cosmetic, thinned low). */
  private cosmetics(
    e: Entity,
    action: QuenchBodyAction,
    k: number,
    look: QuenchBodyLook,
    dt: number,
  ): void {
    const maw = this.joints[QJ.maw];
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const mxW = e.pos.x + maw.x * cosY + maw.z * sinY;
    const mzW = e.pos.z - maw.x * sinY + maw.z * cosY;
    const myW = e.pos.y + maw.y;
    if (look.breath > 0.05 && this.rand() < dt * 18 * look.breath * this.density) {
      this.particles.puff(mxW + sinY * 0.6, myW, mzW + cosY * 0.6, 2, {
        speed: 2 + look.breath * 12,
        life: 1.1,
        size: [0.5, 2.6],
        color: QUENCH_BODY_COLORS.breath,
        alpha: 0.32 + 0.2 * Math.min(1, look.breath),
        dir: [sinY, -0.25, cosY],
        spread: 0.25,
        drag: 1.1,
      });
    }
    if (action === 'breath' && this.rand() < dt * 26 * (0.3 + k) * this.density) {
      // The cold drawn in to its maw from the ice round it.
      const a = this.rand() * Math.PI * 2;
      const r = 3 + this.rand() * 5;
      this.particles.puff(
        mxW + Math.sin(a) * r,
        myW - 1 - this.rand() * 2,
        mzW + Math.cos(a) * r,
        1,
        {
          speed: 7,
          life: 0.6,
          size: [0.6, 0.15],
          color: QUENCH_BODY_COLORS.mist,
          alpha: 0.32,
          dir: [-Math.sin(a), 0.35, -Math.cos(a)],
          spread: 0.1,
        },
      );
    }
    if (action === 'wake' && this.rand() < dt * 30 * (0.2 + k) * this.density) {
      // The cold rising off it to the sky, glints in it.
      this.particles.puff(
        e.pos.x + (this.rand() - 0.5) * 4,
        e.pos.y + 1 + this.rand() * 5,
        e.pos.z + (this.rand() - 0.5) * 4,
        1,
        {
          speed: 3,
          up: 5 + 6 * k,
          life: 0.9,
          size: [0.3, 0.08],
          color: QUENCH_BODY_COLORS.shard,
          alpha: 1,
          pool: 'glow',
        },
      );
    }
    if (action === 'strike' && k > 0.42 && k < 0.5 && this.rand() < 0.5) {
      // The slam's ice dust off its fists.
      for (const w of [QJ.wristL, QJ.wristR]) {
        const j = this.joints[w];
        const x = e.pos.x + j.x * cosY + j.z * sinY;
        const z = e.pos.z - j.x * sinY + j.z * cosY;
        this.particles.puff(x, this.groundY(x, z) + 0.3, z, 4, {
          speed: 4,
          up: 2,
          life: 0.8,
          size: [0.8, 2.2],
          color: QUENCH_BODY_COLORS.mist,
          alpha: 0.4,
        });
      }
    }
    if (this.rand() < dt * 3 * this.density) {
      // A low cold mist curling round its feet.
      this.particles.puff(
        e.pos.x + (this.rand() - 0.5) * 3,
        e.pos.y + 0.3,
        e.pos.z + (this.rand() - 0.5) * 3,
        1,
        {
          speed: 0.6,
          life: 2.2,
          size: [1.4, 3.6],
          color: QUENCH_BODY_COLORS.mist,
          alpha: 0.22,
          drag: 1.5,
        },
      );
    }
  }

  /** The blades wake: the cold flares out of it, a ring over the lake. */
  private wakeBurst(e: Entity): void {
    const y = e.pos.y + 4;
    this.particles.puff(e.pos.x, y, e.pos.z, 32, {
      speed: 11,
      up: 3,
      life: 1,
      size: [0.4, 0.1],
      color: QUENCH_BODY_COLORS.shard,
      alpha: 1,
      pool: 'glow',
      radius: 1.5,
    });
    this.particles.shockRing(e.pos.x, e.pos.z, 0xe8f9ff, 16, 0.8);
    this.shakeNear(e.pos.x, e.pos.z, 0.5, 70);
  }

  // ---- the death -----------------------------------------------------------------------------

  private poseDead(e: Entity): void {
    if (this.deadAt < 0) {
      this.deadAt = this.seenAlive ? this.clock : this.clock - QUENCH_FALL.end - 1;
      if (!this.seenAlive) {
        const rest = quenchBodyLook('idle', 0, 0, false);
        this.poseJoints('idle', 0, rest);
        for (const p of this.pieces) this.posePiece(p, rest);
      }
      for (const p of this.pieces) {
        p.diedPos.copy(p.pos);
        p.diedQuat.copy(p.quat);
        const r = quenchFallRest(p.index, p.pos);
        p.rest = {
          at: r.at,
          tilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tilt.x, r.tilt.y, r.tilt.z)),
          delay: r.delay,
        };
        p.landed = !this.seenAlive;
      }
      if (this.seenAlive) {
        this.particles.puff(e.pos.x, e.pos.y + 4, e.pos.z, 20, {
          speed: 6,
          up: 1,
          life: 0.7,
          size: [0.35, 0.08],
          color: QUENCH_BODY_COLORS.shard,
          alpha: 1,
          pool: 'glow',
          radius: 1.2,
        });
        this.particles.shockRing(e.pos.x, e.pos.z, QUENCH_BODY_COLORS.thread, 9, 0.8);
        this.shakeNear(e.pos.x, e.pos.z, 0.5, 50);
      }
    }
    this.group.rotation.y = this.yaw;
    const t = this.clock - this.deadAt;
    for (const p of this.pieces) {
      const rest = p.rest;
      if (!rest) continue;
      const fall = quenchFallProgress(t, rest.delay, _fall);
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
        const size = Math.max(p.def.size.x, p.def.size.z);
        this.particles.puff(x, this.groundY(x, z) + 0.2, z, Math.round(2 + size * 2), {
          speed: 1.5 + size,
          up: 0.8,
          life: 1.2,
          size: [0.5 + size * 0.3, 1.2 + size * 0.6],
          color: QUENCH_BODY_COLORS.mist,
          alpha: 0.4,
          drag: 1.6,
        });
      }
    }
    const fade = Math.max(0, 1 - t / 0.5);
    this.poseThreads(fade * 1.5, _look);
    const dim = Math.max(0.05, 1 - t / QUENCH_FALL.end);
    this.glowColor.setHex(QUENCH_BODY_COLORS.glow).multiplyScalar(0.3 * dim);
    (this.crystalMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.glowColor.setHex(QUENCH_BODY_COLORS.thread).multiplyScalar(0.2 * dim);
    (this.iceGlowMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.haloMat.opacity = 0.4 * fade;
    this.heartGlowMat.opacity = 0.6 * fade;
    this.eyeMat.opacity = fade;
    for (const s of this.motes) s.visible = fade > 0;
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
