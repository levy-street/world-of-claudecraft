// The Hammer Council's two provisional bodies (plan: council_bodies_core.ts),
// hosted by ../rift_death_zone.ts beside the raid's other fx. The Slabwright
// and the Seam Singer are bodyless targets (characters/manifest.ts
// smith_heart_slabwright, smith_heart_seam_singer): their click capsules,
// nameplates and bars come from the ordinary entity view, and this module
// draws the bodies over them, read from IWorld (each body's position, facing,
// cast bar, swings and death), so offline and online look the same:
//  - the bodies: pieces of the Hammer kit's dressed stone and the Heart kit's
//    rock and crystal, floating round their joints and stitched together by
//    threads of the vein's ochre light. The Slabwright is broad and blocky,
//    its slab shoulders standing proud, a skirt of chips turning low; the
//    Seam Singer tall and slender, amber geodes breaking out of its
//    shoulders, back and crown, a halo of crystal shards turning round it;
//  - the motion: a slow breath (the pieces drifting a little off their
//    joints), a swing at the tank on each melee hit, the Slabwright's arms
//    raised and slammed down over Wake the Stone and Falling Rock (dust and
//    a ring where its fists strike), the Singer's arms opening over its song
//    with its crystals flaring brighter with the bar (motes rising off them),
//    one hand drawn and thrust for Seam Bolt, either one hunched over an
//    inherited Mountain's Wrath with its light burning white-gold;
//  - the death: the threads flare and snap, every piece drops and tumbles to
//    the floor round where it stood with a breath of dust, and lies there as
//    rubble while the corpse does (first seen already dead: lying settled).
// Everything here is presentation: the telegraphs of the council's marks are
// drawn elsewhere on every tier; the dust, motes and shakes thin on the low
// tier and under reduced motion, the bodies and their poses never do.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the kits' pieces, which land later,
// draw with the kits' own shared slot materials, linked with the interior,
// and this module's glow, each with a hidden carrier); no light; fixed rig
// pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
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
} from '../smith_heart/heart_kit';
import { heartVeinGlowMaterial } from '../smith_heart/heart_room_kit';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  COUNCIL_BODY_COLORS,
  COUNCIL_BODY_KITS,
  COUNCIL_BODY_PLANS,
  COUNCIL_BODY_POOLS,
  COUNCIL_EMBER_JOINTS,
  COUNCIL_EMBER_SIZE,
  COUNCIL_FALL,
  COUNCIL_RAISE_SLAM_AT,
  COUNCIL_RIG_JOINTS,
  COUNCIL_SWING_SECONDS,
  COUNCIL_THREAD_PAIRS,
  type CouncilBodyAction,
  type CouncilBodyKind,
  type CouncilBodyPiece,
  type CouncilBodyPlan,
  councilArm,
  councilBodyKindOf,
  councilBreath,
  councilCastAction,
  councilCastFill,
  councilFallProgress,
  councilFallRest,
  councilGlowLevel,
  councilJointPoint,
  councilOrbitSlot,
  councilWrathTint,
  councilWristTarget,
  type V3,
} from './council_bodies_core';
import { inSmithHeartClaim } from './council_fx_core';

const SCAN_SEC = 0.1;
const KINDS: readonly CouncilBodyKind[] = ['slabwright', 'singer'];
const SIDES = [1, -1] as const;
/** Per-frame scratch (the pose allocates no point of its own). */
const _jp: V3 = { x: 0, y: 0, z: 0 };
const _orbit: V3 = { x: 0, y: 0, z: 0 };
const _breath = { bob: 0, drift: 0 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();

interface PieceView {
  def: CouncilBodyPiece;
  index: number;
  /** A skirt or halo piece's slot round the body (read once from its id). */
  orbit: number;
  /** Moves with the pose (body frame); holds the tilted, fitted kit piece. */
  holder: THREE.Group;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  diedPos: THREE.Vector3;
  diedQuat: THREE.Quaternion;
  rest: { at: V3; tilt: THREE.Quaternion; delay: number } | null;
  landed: boolean;
}

interface Rig {
  kind: CouncilBodyKind;
  plan: CouncilBodyPlan;
  group: THREE.Group;
  pieces: PieceView[];
  threads: THREE.InstancedMesh;
  seamMat: THREE.ShaderMaterial;
  crystalMat: THREE.ShaderMaterial;
  /** The crystals' halo (an additive glow card on each crystal piece). */
  haloMat: THREE.SpriteMaterial;
  /** The embers of light at the joints between the pieces. */
  emberMat: THREE.SpriteMaterial;
  embers: THREE.Sprite[];
  /** The rig's joint points this frame (body frame), COUNCIL_RIG_JOINTS long. */
  joints: THREE.Vector3[];
  built: boolean;
  entityId: number;
  facing: number;
  action: CouncilBodyAction;
  swingAt: number;
  swingSide: -1 | 1;
  lastAction: CouncilBodyAction;
  lastFill: number;
  deadAt: number;
  seenAlive: boolean;
}

export class CouncilBodies {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly rigs: Rig[] = [];
  private readonly baseColor = new THREE.Color();
  private readonly wrathColor = new THREE.Color(COUNCIL_BODY_COLORS.wrath);
  private readonly threadColor = new THREE.Color();
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x6b2d;
  private disposed = false;
  private readonly glowTex: THREE.Texture | null;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-council-bodies';
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
    // One carrier geometry: a single triangle every glow material is drawn
    // on, hidden, so the compile gate links their programs before any kit
    // piece lands.
    const carrierGeo = new THREE.BufferGeometry();
    carrierGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrierGeo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    carrierGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.geometries.push(carrierGeo, threadGeo);
    const threadMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartCouncilThreads',
    });
    this.materials.push(threadMat);
    const glowTex = hasDom ? radialGlowTexture() : null;
    this.glowTex = glowTex;
    for (const kind of KINDS) {
      const plan = COUNCIL_BODY_PLANS[kind];
      for (let i = 0; i < COUNCIL_BODY_POOLS.rigsPerKind; i++) {
        const seamMat = heartVeinGlowMaterial(plan.thread, `smithHeartCouncilSeams:${kind}`);
        const crystalMat = heartVeinGlowMaterial(plan.glow, `smithHeartCouncilCrystal:${kind}`);
        const haloMat = new THREE.SpriteMaterial({
          map: glowTex,
          color: plan.glow,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
          name: `smithHeartCouncilHalo:${kind}`,
        });
        const emberMat = new THREE.SpriteMaterial({
          map: glowTex,
          color: plan.thread,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
          name: `smithHeartCouncilEmber:${kind}`,
        });
        this.materials.push(seamMat, crystalMat, haloMat, emberMat);
        const embers: THREE.Sprite[] = [];
        const emberSize = COUNCIL_EMBER_SIZE[kind] * plan.height;
        for (let k = 0; k < COUNCIL_EMBER_JOINTS.length; k++) {
          const s = new THREE.Sprite(emberMat);
          s.scale.set(emberSize, emberSize, 1);
          s.name = 'smithHeartCouncilEmber';
          embers.push(s);
        }
        const haloCarrier = new THREE.Sprite(haloMat);
        haloCarrier.visible = false;
        haloCarrier.name = 'smithHeartCouncilCarrier';
        this.root.add(haloCarrier);
        const group = new THREE.Group();
        group.name = `smithHeartCouncilBody:${kind}:${i}`;
        group.visible = false;
        this.root.add(group);
        for (const s of embers) group.add(s);
        for (const m of [seamMat, crystalMat]) {
          const carrier = new THREE.Mesh(carrierGeo, m);
          carrier.visible = false;
          carrier.frustumCulled = false;
          carrier.name = 'smithHeartCouncilCarrier';
          this.root.add(carrier);
        }
        const threads = new THREE.InstancedMesh(threadGeo, threadMat, COUNCIL_BODY_POOLS.threads);
        threads.name = 'smithHeartCouncilThreads';
        threads.frustumCulled = false;
        threads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let k = 0; k < COUNCIL_BODY_POOLS.threads; k++) {
          threads.setMatrixAt(k, _m.makeScale(0, 0, 0));
          threads.setColorAt(k, this.threadColor.setHex(plan.thread));
        }
        group.add(threads);
        const joints: THREE.Vector3[] = [];
        for (let k = 0; k < COUNCIL_RIG_JOINTS; k++) joints.push(new THREE.Vector3());
        this.rigs.push({
          kind,
          plan,
          group,
          pieces: [],
          threads,
          seamMat,
          crystalMat,
          haloMat,
          emberMat,
          embers,
          joints,
          built: false,
          entityId: -1,
          facing: 0,
          action: 'idle',
          swingAt: -99,
          swingSide: 1,
          lastAction: 'idle',
          lastFill: 0,
          deadAt: -1,
          seenAlive: false,
        });
      }
    }
    // The kit's slot programs, linked with this root (a body that shows
    // before the interior's gate settles links nothing in a live frame).
    this.root.add(heartKitProgramWarmers());
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (this.kitsLoaded()) this.buildAll();
    else if (hasDom)
      void Promise.all([
        ensureHeartKit(COUNCIL_BODY_KITS.hammer),
        ensureHeartKit(COUNCIL_BODY_KITS.heart),
      ]).then(() => {
        if (!this.disposed && this.kitsLoaded()) this.buildAll();
      });
  }

  private kitsLoaded(): boolean {
    return heartKitLoaded(COUNCIL_BODY_KITS.hammer) && heartKitLoaded(COUNCIL_BODY_KITS.heart);
  }

  private buildAll(): void {
    for (const rig of this.rigs) this.buildRig(rig);
  }

  /** The kit pieces of one rig, each fitted to its box (centred on its
   *  holder, its kit shape scaled to the plan's size). */
  private buildRig(rig: Rig): void {
    if (rig.built) return;
    rig.built = true;
    rig.plan.pieces.forEach((def, index) => {
      const kit = heartKitMeshes(COUNCIL_BODY_KITS[def.kit], def.node);
      const holder = new THREE.Group();
      holder.name = `council:${rig.kind}:${def.id}`;
      if (kit) {
        for (const m of kit.children) {
          if (!(m instanceof THREE.Mesh)) continue;
          if (def.light === 'crystal') m.material = rig.crystalMat;
          else if (def.light === 'seam' && m.name.endsWith(':glow')) m.material = rig.seamMat;
          else if (m.name.endsWith(':stone')) m.geometry = this.warmStone(m.geometry, rig.kind);
          if (def.joint === 'skirt' || def.joint === 'halo') m.castShadow = false;
        }
        _box.setFromObject(kit);
        _box.getSize(_size);
        _box.getCenter(_centre);
        const sx = def.size.x / Math.max(1e-3, _size.x);
        const sy = def.size.y / Math.max(1e-3, _size.y);
        const sz = def.size.z / Math.max(1e-3, _size.z);
        kit.scale.set(sx, sy, sz);
        kit.position.set(-_centre.x * sx, -_centre.y * sy, -_centre.z * sz);
        const tilt = new THREE.Group();
        tilt.rotation.set(def.tilt.x, def.tilt.y, def.tilt.z);
        tilt.add(kit);
        // A right-side piece is its left twin mirrored.
        if (def.side < 0) tilt.scale.x = -1;
        holder.add(tilt);
        // A crystal glows past its own faces, in the low sun too.
        if (def.light === 'crystal') {
          const halo = new THREE.Sprite(rig.haloMat);
          const s = Math.max(def.size.x, def.size.y, def.size.z) * 1.5;
          halo.scale.set(s, s, 1);
          halo.name = 'smithHeartCouncilCrystalHalo';
          holder.add(halo);
        }
      }
      rig.group.add(holder);
      rig.pieces.push({
        def,
        index,
        orbit: Number(def.id.replace(/\D+/g, '')) || 0,
        holder,
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        diedPos: new THREE.Vector3(),
        diedQuat: new THREE.Quaternion(),
        rest: null,
        landed: false,
      });
    });
  }

  /** The kit's stone repainted a body's own granite: the Heart kit's rock is
   *  near-black for the Heart's ember night, and in the Quarry's low sun it
   *  read as a dark heap. A copy of the piece with its vertex paint pulled
   *  toward a warm (the Slabwright) or a paler seam (the Singer) granite,
   *  keeping a third of its own value variation (the beds, the chisel). */
  private warmStone(src: THREE.BufferGeometry, kind: CouncilBodyKind): THREE.BufferGeometry {
    const g = src.clone();
    const col = g.getAttribute('color');
    if (col) {
      const warm = COUNCIL_BODY_COLORS.granite[kind];
      for (let i = 0; i < col.count; i++) {
        const shade = 0.45 + 0.65 * Math.min(1, col.getX(i) * 1.6);
        col.setXYZ(i, warm[0] * shade, warm[1] * shade, warm[2] * shade);
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

  private shakeNear(x: number, z: number, amount: number, reach = 40): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  /** Never claims an event: the renderer's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type === 'damage' && ev.ability === null) {
      const rig = this.rigOf(ev.sourceId);
      if (rig && rig.action === 'idle') {
        rig.swingAt = this.clock;
        rig.swingSide = rig.swingSide === 1 ? -1 : 1;
      }
    }
    return false;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    if (!this.rigs[0].built && this.kitsLoaded()) this.buildAll();
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    for (const rig of this.rigs) {
      if (rig.entityId < 0) continue;
      const e = world.entities.get(rig.entityId);
      if (!e) {
        this.release(rig);
        continue;
      }
      this.pose(rig, e, dt);
    }
    this.particles.update(this.clock);
  }

  // ---- the scan: who wears which rig ---------------------------------------------------

  /** The rig a council body wears, if any (an indexed loop). */
  private rigOf(entityId: number): Rig | null {
    if (entityId < 0) return null;
    for (const r of this.rigs) if (r.entityId === entityId) return r;
    return null;
  }

  private freeRig(kind: CouncilBodyKind): Rig | null {
    for (const r of this.rigs) if (r.kind === kind && r.entityId < 0) return r;
    return null;
  }

  private scan(world: IWorld): void {
    for (const rig of this.rigs) {
      if (rig.entityId >= 0 && !world.entities.has(rig.entityId)) this.release(rig);
    }
    // Outside the raid there is nobody to dress: no walk of the world.
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) return;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob') continue;
      const kind = councilBodyKindOf(e.templateId);
      if (!kind) continue;
      if (this.rigOf(e.id)) continue;
      const rig = this.freeRig(kind);
      if (!rig) continue;
      rig.entityId = e.id;
      rig.facing = e.facing;
      rig.deadAt = -1;
      rig.seenAlive = false;
      rig.swingAt = -99;
      rig.lastAction = 'idle';
      rig.lastFill = 0;
      rig.group.visible = true;
    }
  }

  private release(rig: Rig): void {
    rig.entityId = -1;
    rig.group.visible = false;
  }

  // ---- the pose -------------------------------------------------------------------------

  private pose(rig: Rig, e: Entity, dt: number): void {
    const plan = rig.plan;
    rig.group.position.set(e.pos.x, e.pos.y, e.pos.z);
    if (e.dead) {
      this.poseDead(rig, e);
      return;
    }
    if (rig.deadAt >= 0) {
      // Stood up again (a wipe): whole at once, the rubble gone.
      rig.deadAt = -1;
      for (const p of rig.pieces) {
        p.rest = null;
        p.landed = false;
      }
    }
    rig.seenAlive = true;
    rig.facing += wrapAngle(e.facing - rig.facing) * Math.min(1, dt * 6);
    rig.group.rotation.y = rig.facing;
    // The action: a council bar, else a swing's own clock, else idle.
    const cast = councilCastAction(rig.kind, e.castingAbility);
    let action: CouncilBodyAction = 'idle';
    let k = 0;
    if (cast) {
      action = cast;
      k = councilCastFill(e.castRemaining, e.castTotal);
    } else if (this.clock - rig.swingAt < COUNCIL_SWING_SECONDS) {
      action = 'swing';
      k = (this.clock - rig.swingAt) / COUNCIL_SWING_SECONDS;
    }
    // The Slabwright's slam lands as its raise bar ends.
    if (rig.lastAction === 'raise' && action !== 'raise' && rig.lastFill > COUNCIL_RAISE_SLAM_AT)
      this.slam(rig, e);
    rig.action = action;
    rig.lastAction = action;
    rig.lastFill = k;
    const t = this.clock;
    const breath = councilBreath(rig.kind, t, _breath);
    let lean = 0;
    const J = rig.joints;
    putJoint(J[0], councilJointPoint(plan, 'base', 0, breath.bob, breath.drift, _jp));
    putJoint(J[1], councilJointPoint(plan, 'hip', 0, breath.bob, breath.drift, _jp));
    putJoint(J[2], councilJointPoint(plan, 'torso', 0, breath.bob, breath.drift, _jp));
    putJoint(J[3], councilJointPoint(plan, 'head', 0, breath.bob, breath.drift, _jp));
    putJoint(J[4], councilJointPoint(plan, 'shoulder', 1, breath.bob, breath.drift, _jp));
    putJoint(J[5], councilJointPoint(plan, 'shoulder', -1, breath.bob, breath.drift, _jp));
    const lift = plan.hover + breath.bob;
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i];
      const target = councilWristTarget(plan, action, side, k, rig.swingSide);
      lean += target.lean * 0.5;
      const arm = councilArm(plan, side, target.wrist);
      J[6 + i].set(arm.elbow.x, arm.elbow.y + lift, arm.elbow.z);
      J[8 + i].set(arm.wrist.x, arm.wrist.y + lift, arm.wrist.z);
    }
    // The upper body leans about the hip (the arms with it).
    const hipY = J[1].y;
    const cl = Math.cos(lean);
    const sl = Math.sin(lean);
    for (let i = 2; i < COUNCIL_RIG_JOINTS; i++) {
      const y = J[i].y - hipY;
      const z = J[i].z;
      J[i].y = hipY + y * cl - z * sl;
      J[i].z = y * sl + z * cl;
    }
    _q2.setFromAxisAngle(_a.set(1, 0, 0), lean);
    for (const p of rig.pieces) this.posePiece(rig, p, breath.drift, t, _q2);
    this.poseThreads(rig, breath.drift, 1);
    for (let i = 0; i < COUNCIL_EMBER_JOINTS.length; i++) {
      rig.embers[i].visible = true;
      rig.embers[i].position.copy(J[COUNCIL_EMBER_JOINTS[i]]);
    }
    this.glow(rig, action, k, t);
    this.cosmetics(rig, e, action, k, dt);
  }

  /** One piece on its joint (body frame). */
  private posePiece(
    rig: Rig,
    p: PieceView,
    drift: number,
    t: number,
    leanQ: THREE.Quaternion,
  ): void {
    const def = p.def;
    const J = rig.joints;
    const side = def.side;
    const wobble = drift * 0.6;
    const nx = Math.sin(t * 1.3 + p.index * 2.1) * wobble;
    const ny = Math.sin(t * 1.7 + p.index * 1.3) * wobble;
    switch (def.joint) {
      case 'upper':
      case 'fore':
      case 'hand': {
        const i = side < 0 ? 1 : 0;
        const root = J[4 + i];
        const elbow = J[6 + i];
        const wrist = J[8 + i];
        const from = def.joint === 'upper' ? root : def.joint === 'fore' ? elbow : wrist;
        const to = def.joint === 'upper' ? elbow : def.joint === 'fore' ? wrist : wrist;
        if (def.joint === 'hand') {
          // Along the forearm, a hand's length past the wrist.
          _a.subVectors(wrist, elbow).normalize();
          p.pos.copy(wrist).addScaledVector(_a, def.size.y * 0.45);
          p.quat.setFromUnitVectors(_up, _a);
        } else {
          _a.subVectors(to, from);
          const len = _a.length() || 1;
          _a.divideScalar(len);
          p.pos.copy(from).addScaledVector(_a, len * 0.5);
          p.quat.setFromUnitVectors(_up, _a);
        }
        p.pos.x += nx * 0.5;
        p.pos.y += ny * 0.5;
        break;
      }
      case 'skirt':
      case 'halo': {
        const index = p.orbit;
        const o = councilOrbitSlot(rig.plan, def.joint, index, t, _orbit);
        p.pos.set(o.x, o.y + rig.plan.hover, o.z);
        if (def.joint === 'halo') {
          // The halo leans and turns with the upper body.
          const hipY = J[1].y;
          _b.set(0, p.pos.y - hipY, p.pos.z).applyQuaternion(leanQ);
          p.pos.y = hipY + _b.y;
          p.pos.z = _b.z;
        }
        p.quat.setFromEuler(_e.set(0.3 * Math.sin(t + index), t * 0.6 + index, 0.2));
        break;
      }
      default: {
        const j =
          def.joint === 'base'
            ? J[0]
            : def.joint === 'hip'
              ? J[1]
              : def.joint === 'torso'
                ? J[2]
                : def.joint === 'head'
                  ? J[3]
                  : side < 0
                    ? J[5]
                    : J[4];
        const mx = side < 0 ? -1 : 1;
        _a.set(def.at.x * mx, def.at.y, def.at.z);
        const upper = def.joint !== 'base' && def.joint !== 'hip';
        if (upper) _a.applyQuaternion(leanQ);
        p.pos.copy(j).add(_a);
        p.pos.x += nx;
        p.pos.y += ny;
        if (upper) p.quat.copy(leanQ);
        else p.quat.identity();
      }
    }
    p.holder.position.copy(p.pos);
    p.holder.quaternion.copy(p.quat);
  }

  /** The threads between the joints (body frame), at `alpha` of their light. */
  private poseThreads(rig: Rig, drift: number, alpha: number): void {
    const J = rig.joints;
    const w = rig.plan.threadWidth * (1 + drift * 2) * Math.max(0, alpha);
    let n = 0;
    for (const [i, j] of COUNCIL_THREAD_PAIRS) {
      _a.copy(J[i]);
      _b.subVectors(J[j], J[i]);
      const len = _b.length();
      if (len < 1e-4 || w <= 0) {
        rig.threads.setMatrixAt(n++, _m.makeScale(0, 0, 0));
        continue;
      }
      _q.setFromUnitVectors(_up, _b.divideScalar(len));
      _s.set(w, len, w);
      rig.threads.setMatrixAt(n++, _m.compose(_a, _q, _s));
    }
    for (; n < COUNCIL_BODY_POOLS.threads; n++) rig.threads.setMatrixAt(n, _m.makeScale(0, 0, 0));
    rig.threads.instanceMatrix.needsUpdate = true;
  }

  /** The seams', crystals' and threads' light for the action. */
  private glow(rig: Rig, action: CouncilBodyAction, k: number, t: number): void {
    const level = councilGlowLevel(action, k, t);
    const white = councilWrathTint(action, k);
    const seamLevel = rig.kind === 'singer' ? level * 0.8 : level;
    this.baseColor.setHex(rig.plan.thread).lerp(this.wrathColor, white).multiplyScalar(seamLevel);
    (rig.seamMat.uniforms.uColor.value as THREE.Color).copy(this.baseColor);
    this.baseColor
      .setHex(rig.plan.glow)
      .lerp(this.wrathColor, white)
      .multiplyScalar(level * 1.7);
    (rig.crystalMat.uniforms.uColor.value as THREE.Color).copy(this.baseColor);
    rig.haloMat.color.setHex(rig.plan.glow).lerp(this.wrathColor, white);
    rig.haloMat.opacity = Math.min(0.7, 0.12 + level * 0.2);
    rig.emberMat.color.setHex(rig.plan.thread).lerp(this.wrathColor, white);
    rig.emberMat.opacity = Math.min(0.9, 0.35 + level * 0.25);
    this.threadColor
      .setHex(rig.plan.thread)
      .lerp(this.wrathColor, white)
      .multiplyScalar(1.1 + level * 0.6);
    for (let i = 0; i < COUNCIL_BODY_POOLS.threads; i++)
      rig.threads.setColorAt(i, this.threadColor);
    if (rig.threads.instanceColor) rig.threads.instanceColor.needsUpdate = true;
  }

  /** The motes over a song or a gathering Wrath (cosmetic, thinned low). */
  private cosmetics(rig: Rig, e: Entity, action: CouncilBodyAction, k: number, dt: number): void {
    if (action !== 'sing' && action !== 'wrath' && action !== 'point') return;
    const rate = (action === 'wrath' ? 26 : 16) * (0.3 + k) * this.density;
    if (this.rand() >= dt * rate) return;
    const p = rig.joints[2];
    _a.set(p.x, p.y, p.z).applyAxisAngle(_up, rig.facing);
    const x = e.pos.x + _a.x;
    const y = e.pos.y + _a.y;
    const z = e.pos.z + _a.z;
    if (action === 'wrath') {
      // White-gold drawn in toward its chest.
      const a = this.rand() * Math.PI * 2;
      const r = 2 + this.rand() * 2.5;
      this.particles.puff(
        x + Math.sin(a) * r,
        y + (this.rand() - 0.3) * 2,
        z + Math.cos(a) * r,
        1,
        {
          speed: 3.5,
          life: 0.6,
          size: [0.28, 0.06],
          color: [1, 0.92, 0.7],
          alpha: 0.9,
          dir: [-Math.sin(a), 0, -Math.cos(a)],
          spread: 0.15,
          pool: 'glow',
        },
      );
      return;
    }
    // Amber motes rising off the Singer's crystals.
    this.particles.puff(x + (this.rand() - 0.5) * 1.6, y + this.rand() * 1.4, z, 1, {
      speed: 0.4,
      up: 1.6 + k * 1.5,
      life: 1.1,
      size: [0.22, 0.05],
      color: COUNCIL_BODY_COLORS.spark,
      alpha: 0.85,
      pool: 'glow',
    });
  }

  /** The Slabwright's fists strike the floor ahead: dust, chips, a ring. */
  private slam(rig: Rig, e: Entity): void {
    const reach = rig.plan.arm.upper + rig.plan.arm.fore;
    const fx = e.pos.x + Math.sin(rig.facing) * reach * 0.7;
    const fz = e.pos.z + Math.cos(rig.facing) * reach * 0.7;
    const y = this.groundY(fx, fz);
    this.particles.puff(fx, y + 0.3, fz, 14, {
      speed: 4,
      up: 1.5,
      life: 1.4,
      size: [0.9, 2.6],
      color: COUNCIL_BODY_COLORS.dust,
      alpha: 0.5,
      drag: 1.4,
      radius: 0.8,
    });
    this.particles.puff(fx, y + 0.4, fz, 8, {
      speed: 3,
      up: 3,
      life: 0.5,
      size: [0.25, 0.08],
      color: COUNCIL_BODY_COLORS.spark,
      alpha: 0.9,
      pool: 'glow',
    });
    this.particles.shockRing(fx, fz, COUNCIL_BODY_COLORS.ochre, 4, 0.45);
    this.shakeNear(fx, fz, 0.3, 30);
  }

  // ---- the death ------------------------------------------------------------------------

  private poseDead(rig: Rig, e: Entity): void {
    if (rig.deadAt < 0) {
      // First seen already dead: the fall settled long ago.
      rig.deadAt = rig.seenAlive ? this.clock : this.clock - COUNCIL_FALL.end - 1;
      if (!rig.seenAlive) {
        // Never posed alive: take the rest pose as where each piece fell from.
        const breath = councilBreath(rig.kind, 0);
        const J = rig.joints;
        const plan = rig.plan;
        const set = (i: number, p: V3) => J[i].set(p.x, p.y, p.z);
        set(0, councilJointPoint(plan, 'base', 0, breath.bob, breath.drift));
        set(1, councilJointPoint(plan, 'hip', 0, breath.bob, breath.drift));
        set(2, councilJointPoint(plan, 'torso', 0, breath.bob, breath.drift));
        set(3, councilJointPoint(plan, 'head', 0, breath.bob, breath.drift));
        set(4, councilJointPoint(plan, 'shoulder', 1, breath.bob, breath.drift));
        set(5, councilJointPoint(plan, 'shoulder', -1, breath.bob, breath.drift));
        for (const side of [1, -1] as const) {
          const arm = councilArm(plan, side, councilWristTarget(plan, 'idle', side, 0).wrist);
          const i = side === 1 ? 0 : 1;
          set(6 + i, { x: arm.elbow.x, y: arm.elbow.y + plan.hover, z: arm.elbow.z });
          set(8 + i, { x: arm.wrist.x, y: arm.wrist.y + plan.hover, z: arm.wrist.z });
        }
        for (const p of rig.pieces) this.posePiece(rig, p, 0, 0, _q2.identity());
      }
      for (const p of rig.pieces) {
        p.diedPos.copy(p.pos);
        p.diedQuat.copy(p.quat);
        const r = councilFallRest(rig.plan, p.index, p.pos);
        p.rest = {
          at: r.at,
          tilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tilt.x, r.tilt.y, r.tilt.z)),
          delay: r.delay,
        };
        p.landed = !rig.seenAlive;
      }
      if (rig.seenAlive) this.snap(rig, e);
    }
    rig.group.rotation.y = rig.facing;
    const t = this.clock - rig.deadAt;
    for (const p of rig.pieces) {
      const rest = p.rest;
      if (!rest) continue;
      const fall = councilFallProgress(t, rest.delay);
      const k = fall.k;
      p.pos.set(
        p.diedPos.x + (rest.at.x - p.diedPos.x) * k,
        p.diedPos.y + (rest.at.y - p.diedPos.y) * k + Math.sin(Math.PI * k) * 0.35,
        p.diedPos.z + (rest.at.z - p.diedPos.z) * k,
      );
      p.quat.copy(p.diedQuat).slerp(rest.tilt, Math.min(1, k * 1.2));
      p.holder.position.copy(p.pos);
      p.holder.quaternion.copy(p.quat);
      if (fall.landed && !p.landed) {
        p.landed = true;
        _a.copy(p.pos).applyAxisAngle(_up, rig.facing);
        const x = e.pos.x + _a.x;
        const z = e.pos.z + _a.z;
        const size = Math.max(p.def.size.x, p.def.size.y);
        this.particles.puff(x, this.groundY(x, z) + 0.2, z, Math.round(3 + size * 3), {
          speed: 1.6 + size,
          up: 0.8,
          life: 1.3,
          size: [0.5 + size * 0.4, 1.2 + size * 0.8],
          color: COUNCIL_BODY_COLORS.dust,
          alpha: 0.45,
          drag: 1.6,
        });
      }
    }
    // The threads flare as they snap, then are gone.
    const snapK = t / COUNCIL_FALL.snap;
    this.poseThreads(rig, 0.4 * Math.max(0, 1 - snapK), snapK < 1 ? 1.6 * (1 - snapK) : 0);
    const dim = Math.max(0.05, 1 - t / COUNCIL_FALL.end);
    this.baseColor.setHex(rig.plan.thread).multiplyScalar(0.25 * dim);
    (rig.seamMat.uniforms.uColor.value as THREE.Color).copy(this.baseColor);
    this.baseColor.setHex(rig.plan.glow).multiplyScalar(0.3 * dim);
    (rig.crystalMat.uniforms.uColor.value as THREE.Color).copy(this.baseColor);
    rig.haloMat.opacity = 0.4 * Math.max(0, 1 - t / COUNCIL_FALL.snap);
    for (const s of rig.embers) s.visible = t < COUNCIL_FALL.snap;
    rig.emberMat.opacity = 0.9 * Math.max(0, 1 - t / COUNCIL_FALL.snap);
  }

  /** The threads snapping: a flash of the vein's light and a spray of sparks. */
  private snap(rig: Rig, e: Entity): void {
    const y = e.pos.y + rig.plan.height * 0.55;
    this.particles.puff(e.pos.x, y, e.pos.z, 16, {
      speed: 4,
      up: 1,
      life: 0.6,
      size: [0.3, 0.08],
      color: COUNCIL_BODY_COLORS.spark,
      alpha: 1,
      pool: 'glow',
      radius: 1,
    });
    this.particles.shockRing(e.pos.x, e.pos.z, COUNCIL_BODY_COLORS.ochre, 5, 0.6);
    this.shakeNear(e.pos.x, e.pos.z, 0.35, 35);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const rig of this.rigs) rig.threads.dispose();
    this.glowTex?.dispose();
  }
}

function putJoint(j: THREE.Vector3, p: V3): void {
  j.set(p.x, p.y, p.z);
}
