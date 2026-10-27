// The Guardian of the Heat's provisional body (plan: heat_body_core.ts),
// hosted by ../rift_death_zone.ts beside the raid's other fx. The guardian is
// a bodyless target (characters/manifest.ts smith_heart_heat_guardian): its
// click capsule, nameplate and bars come from the ordinary entity view, and
// this module draws the body over it, read from IWorld (its position, facing,
// cast bar, swings, resource (the Hearth's heat), auras and death, and its
// cues), so offline and online look the same:
//  - the body: a being of the first flame, dark columnar basalt (the Heart
//    kit's colossus rock repainted the Hearth's sooted basalt, fire in its
//    joints) on legs of bundled basalt columns, a mane and a crown of
//    white-gold crystal prisms, pauldrons of fire-split boulders, fists of
//    crystal on beds of column stumps, crystal breaking out of its chest
//    round a white-gold heart, threads of the first flame between its joints;
//  - the heat: the whole body's fire brightens from gold toward white as the
//    Hearth climbs, a haze rising off it, tongues of flame licking up from
//    its joints; from 90 it strains, hunched and trembling, flashing white
//    (a glow round the whole body), until Hearthburst throws it back with
//    its arms flung wide;
//  - the motion: its breathing flame (deeper when cool, quick when hot), a
//    swipe on each melee hit, Shed Heat's lean down pouring fire down its
//    arms into the floor, then its arms flung up as the crystals tear free,
//    Molten Pour's arm out over the lane with fire running off its fist,
//    Searing Knell's sphere of fire gathered in its hands then thrown wide,
//    the stoking's deep breath;
//  - the death: the threads flare and go out, every piece falls and tumbles
//    to the floor, the flame sinking out of them in smoke.
// Presentation only: the fight's telegraphs are heat_fx.ts's and
// heat_fight_fx.ts's, on every tier. The body, its poses, its heat colour and
// the wind-up's flash never thin (the flash is the overheat's warning on the
// body itself); the embers, the haze, the smoke and the shakes thin on the low
// tier and under reduced motion.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the kits' pieces, which land later,
// draw with the kits' own shared slot materials linked by their program
// warmers, and this module's glows each have a hidden carrier); no light;
// fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { HEAT_CASTS, HEAT_CUES } from '../../sim/encounters/smith_heart/heat_ids';
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
import {
  HEAT_BODY_COLORS,
  HEAT_BODY_KITS,
  HEAT_BODY_PIECES,
  HEAT_BODY_POOLS,
  HEAT_FALL,
  HEAT_FLAME_JOINTS,
  HEAT_GUARDIAN,
  HEAT_RIG_JOINTS,
  HEAT_SLOTS,
  HEAT_THREAD_PAIRS,
  type HeatArmJoints,
  type HeatBodyAction,
  type HeatBodyActionState,
  type HeatBodyInput,
  type HeatBodyLook,
  type HeatBodyPiece,
  HJ,
  heatArm,
  heatBodyAction,
  heatBodyHash,
  heatBodyLook,
  heatFallProgress,
  heatFallRest,
  heatWristTarget,
  overheatingOn,
  restJoint,
  type V3,
} from './heat_body_core';

const SCAN_SEC = 0.1;
/** A thread colour change smaller than this is not re-uploaded. */
const THREAD_COLOR_EPS = 1 / 512;
const HEAD_JOINTS = [HJ.head, HJ.mouth] as const;
const LEAN_JOINTS = [
  HJ.chest,
  HJ.head,
  HJ.mouth,
  HJ.back,
  HJ.shoulderL,
  HJ.shoulderR,
  HJ.elbowL,
  HJ.elbowR,
  HJ.wristL,
  HJ.wristR,
] as const;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
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
const _arm: HeatArmJoints = { elbow: { x: 0, y: 0, z: 0 }, wrist: { x: 0, y: 0, z: 0 } };
const _act: HeatBodyActionState = { action: 'idle', k: 0 };
const _actIn: HeatBodyInput = {
  castId: null,
  castFill: 0,
  sinceShed: Number.POSITIVE_INFINITY,
  sinceToll: Number.POSITIVE_INFINITY,
  sinceBurst: Number.POSITIVE_INFINITY,
  sinceStoke: Number.POSITIVE_INFINITY,
  sinceSwing: Number.POSITIVE_INFINITY,
  overheating: false,
};
const _fall = { k: 0, landed: false };
const _look: HeatBodyLook = {
  swell: 0,
  lift: 0,
  lean: 0,
  glow: 0,
  white: 0,
  flash: 0,
  tremble: 0,
  haze: 0,
};
/** The per-frame puffs' options, written in place (no allocation a frame). */
const EMBER_DIR: [number, number, number] = [0, 1, 0];
const EMBER = {
  speed: 1.2,
  up: 3,
  life: 0.9,
  size: [0.24, 0.05] as [number, number],
  color: HEAT_BODY_COLORS.ember as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  dir: EMBER_DIR,
  spread: 0.4,
};
const FLAME = {
  speed: 0.6,
  up: 2.6,
  life: 0.5,
  size: [0.9, 0.2] as [number, number],
  color: HEAT_BODY_COLORS.ember as readonly [number, number, number],
  alpha: 0.85,
  pool: 'glow' as const,
};
const HAZE = {
  speed: 0.4,
  up: 1.8,
  life: 1.6,
  size: [1.6, 3.4] as [number, number],
  color: HEAT_BODY_COLORS.haze as readonly [number, number, number],
  alpha: 0.08,
  drag: 0.8,
};
/** The sparks crackling off it as it strains (the wind-up). */
const STRAIN_SPARK = {
  speed: 9,
  life: 0.4,
  size: [0.25, 0.05] as [number, number],
  color: HEAT_BODY_COLORS.spark,
  alpha: 1,
  pool: 'glow' as const,
  radius: 1.5,
};
const STREAM_DIR: [number, number, number] = [0, -1, 0];
const STREAM = {
  speed: 7,
  life: 0.35,
  size: [0.5, 0.15] as [number, number],
  color: HEAT_BODY_COLORS.spark as readonly [number, number, number],
  alpha: 1,
  pool: 'glow' as const,
  dir: STREAM_DIR,
  spread: 0.12,
};

interface PieceView {
  def: HeatBodyPiece;
  index: number;
  holder: THREE.Group;
  standIn: THREE.Mesh | null;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  diedPos: THREE.Vector3;
  diedQuat: THREE.Quaternion;
  rest: { at: V3; tilt: THREE.Quaternion; delay: number } | null;
  landed: boolean;
}

export class HeatBody {
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
  private readonly fireMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly eyeMat: THREE.SpriteMaterial;
  private readonly heartGlowMat: THREE.SpriteMaterial;
  private readonly auraMat: THREE.SpriteMaterial;
  private readonly orbMat: THREE.SpriteMaterial;
  private readonly eyes: THREE.Sprite[] = [];
  private readonly heartGlow: THREE.Sprite;
  private readonly aura: THREE.Sprite;
  private readonly orb: THREE.Sprite;
  private readonly joints: THREE.Vector3[] = [];
  private readonly glowColor = new THREE.Color();
  private readonly gold = new THREE.Color(HEAT_BODY_COLORS.gold);
  private readonly whiteC = new THREE.Color(HEAT_BODY_COLORS.white);
  private readonly threadColor = new THREE.Color();
  private readonly threadShown = new THREE.Color(Number.NaN, Number.NaN, Number.NaN);
  private readonly standInGeo: THREE.BufferGeometry;
  private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  private readonly glowTex: THREE.Texture | null;
  private kitBuilt = false;
  private rosterSeen = Number.NaN;
  private entityId = -1;
  private yaw = 0;
  private swingAt = -99;
  private swingSide: -1 | 1 = 1;
  private shedAt = -99;
  private tollAt = -99;
  private burstAt = -99;
  private stokeAt = -99;
  private lastCast: string | null = null;
  private deadAt = -1;
  private seenAlive = false;
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
  ) {
    this.compileGate = compileGate;
    this.root.name = 'smith-heart-heat-body';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.35;
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
    // Hearth's basalt.
    const standIn = new THREE.IcosahedronGeometry(0.5, 1);
    const g = HEAT_BODY_COLORS.basalt;
    const n = standIn.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const shade = 0.75 + 0.5 * heatBodyHash(i, 7);
      col[i * 3] = g[0] * shade;
      col[i * 3 + 1] = g[1] * shade;
      col[i * 3 + 2] = g[2] * shade;
    }
    standIn.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.standInGeo = standIn;
    this.geometries.push(standIn);
    this.crystalMat = heartVeinGlowMaterial(HEAT_BODY_COLORS.fire, 'smithHeartHeatCrystal');
    this.fireMat = heartVeinGlowMaterial(HEAT_BODY_COLORS.gold, 'smithHeartHeatSeams');
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
    this.haloMat = sprite(HEAT_BODY_COLORS.fire, 0.45, 'smithHeartHeatHalo');
    this.eyeMat = sprite(HEAT_BODY_COLORS.white, 0.95, 'smithHeartHeatEye');
    this.heartGlowMat = sprite(HEAT_BODY_COLORS.fire, 0.7, 'smithHeartHeatHeart');
    this.auraMat = sprite(HEAT_BODY_COLORS.white, 0, 'smithHeartHeatAura');
    this.orbMat = sprite(HEAT_BODY_COLORS.white, 0, 'smithHeartHeatOrb');
    const threadMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartHeatThreads',
    });
    this.materials.push(
      this.crystalMat,
      this.fireMat,
      this.haloMat,
      this.eyeMat,
      this.heartGlowMat,
      this.auraMat,
      this.orbMat,
      threadMat,
    );
    for (const m of [this.crystalMat, this.fireMat]) {
      const carrier = new THREE.Mesh(carrierGeo, m);
      carrier.visible = false;
      carrier.frustumCulled = false;
      carrier.name = 'smithHeartHeatCarrier';
      this.root.add(carrier);
    }
    this.group.name = 'smithHeartHeatBody';
    this.group.visible = false;
    this.root.add(this.group);
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.geometries.push(threadGeo);
    this.threads = new THREE.InstancedMesh(threadGeo, threadMat, HEAT_BODY_POOLS.threads);
    this.threads.name = 'smithHeartHeatThreads';
    this.threads.frustumCulled = false;
    this.threads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < HEAT_BODY_POOLS.threads; k++) {
      this.threads.setMatrixAt(k, _m.makeScale(0, 0, 0));
      this.threads.setColorAt(k, this.threadColor.setHex(HEAT_BODY_COLORS.thread));
    }
    this.group.add(this.threads);
    for (let k = 0; k < HEAT_RIG_JOINTS; k++)
      this.joints.push(new THREE.Vector3().copy(restJoint(k, _rest)));
    for (let k = 0; k < 2; k++) {
      const s = new THREE.Sprite(this.eyeMat);
      s.scale.set(0.6, 0.6, 1);
      s.name = 'smithHeartHeatEye';
      this.eyes.push(s);
      this.group.add(s);
    }
    this.heartGlow = new THREE.Sprite(this.heartGlowMat);
    this.heartGlow.scale.set(2.8, 2.8, 1);
    this.heartGlow.name = 'smithHeartHeatHeartGlow';
    this.group.add(this.heartGlow);
    // The wind-up's white glow round the whole body (every tier: the body's
    // own overheat warning), and the knell's sphere of fire in its hands.
    this.aura = new THREE.Sprite(this.auraMat);
    this.aura.scale.set(10, 10, 1);
    this.aura.position.set(0, 4, 0.4);
    this.aura.name = 'smithHeartHeatAura';
    this.group.add(this.aura);
    this.orb = new THREE.Sprite(this.orbMat);
    this.orb.scale.set(0.1, 0.1, 1);
    this.orb.name = 'smithHeartHeatOrb';
    this.group.add(this.orb);
    this.root.add(heartKitProgramWarmers());
    const kitsIn = this.kitsLoaded();
    this.buildPieces(kitsIn);
    this.kitBuilt = kitsIn;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (!kitsIn && hasDom)
      void Promise.all([ensureHeartKit(HEAT_BODY_KITS.heat), ensureHeartKit(HEAT_BODY_KITS.heart)])
        .then(() => {
          if (!this.disposed && this.kitsLoaded()) this.upgradeKit();
        })
        .catch(() => {});
  }

  private kitsLoaded(): boolean {
    return heartKitLoaded(HEAT_BODY_KITS.heat) && heartKitLoaded(HEAT_BODY_KITS.heart);
  }

  private buildPieces(withKit: boolean): void {
    HEAT_BODY_PIECES.forEach((def, index) => {
      const holder = new THREE.Group();
      holder.name = `heatBody:${def.id}`;
      const kit = withKit ? this.fitKit(def) : null;
      let standIn: THREE.Mesh | null = null;
      if (kit) holder.add(kit);
      else {
        standIn = new THREE.Mesh(
          this.standInGeo,
          def.light === 'crystal' ? this.crystalMat : heartKitSlotMaterial('stone'),
        );
        standIn.name = 'smithHeartHeatStandIn';
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
   *  when the kit has no such node. A limb's box is its unit length. */
  private fitKit(def: HeatBodyPiece): THREE.Group | null {
    const kit = heartKitMeshes(HEAT_BODY_KITS[def.kit], def.node);
    if (!kit) return null;
    for (const m of kit.children) {
      if (!(m instanceof THREE.Mesh)) continue;
      if (def.light === 'crystal') {
        m.material = this.crystalMat;
        m.castShadow = false;
        m.receiveShadow = false;
      } else if (m.name.endsWith(':glow')) {
        m.material = this.fireMat;
        m.castShadow = false;
      } else if (m.name.endsWith(':stone') && def.kit === 'heart')
        m.geometry = this.basalt(m.geometry);
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
    content.name = 'smithHeartHeatKitPiece';
    const tilt = new THREE.Group();
    tilt.rotation.set(def.tilt.x, def.tilt.y, def.tilt.z);
    tilt.add(kit);
    content.add(tilt);
    if (def.light === 'crystal') {
      const halo = new THREE.Sprite(this.haloMat);
      const s = Math.max(def.size.x, def.size.y, def.size.z) * 1.8;
      halo.scale.set(s, s, 1);
      halo.name = 'smithHeartHeatCrystalHalo';
      content.add(halo);
    }
    return content;
  }

  /** The kits landed after the body was built: fit every piece into one
   *  hidden staging group, link it through the compile gate, then swap. */
  private upgradeKit(): void {
    if (this.kitBuilt || this.disposed) return;
    this.kitBuilt = true;
    const staging = new THREE.Group();
    staging.name = 'smithHeartHeatKitStaging';
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

  /** The Heart kit's colossus rock repainted the Hearth's basalt: a warm dark
   *  grey, the kit's own value variation kept, umber in the shade. */
  private basalt(src: THREE.BufferGeometry): THREE.BufferGeometry {
    const g = src.clone();
    const col = g.getAttribute('color');
    if (col) {
      const c = HEAT_BODY_COLORS.basalt;
      const d = HEAT_BODY_COLORS.basaltShade;
      for (let i = 0; i < col.count; i++) {
        const v = Math.min(1, col.getX(i) * 1.4);
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
      const e = this.world.entities.get(this.entityId);
      if (ev.ability === HEAT_CUES.overheat) {
        this.burstAt = this.clock;
        if (e) this.burstFx(e);
      } else if (ev.ability === HEAT_CUES.stoke) this.stokeAt = this.clock;
      else if (ev.ability === HEAT_CASTS.knell && ev.fx === 'nova') this.tollAt = this.clock;
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
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    for (const e of world.entities.values()) {
      if (e.kind !== 'mob' || e.templateId !== HEAT_GUARDIAN) continue;
      this.entityId = e.id;
      this.yaw = e.facing;
      this.deadAt = -1;
      this.seenAlive = false;
      this.swingAt = -99;
      this.shedAt = -99;
      this.tollAt = -99;
      this.burstAt = -99;
      this.stokeAt = -99;
      this.lastCast = null;
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
      this.deadAt = -1;
      for (const p of this.pieces) {
        p.rest = null;
        p.landed = false;
      }
    }
    this.seenAlive = true;
    // Shed Heat's bar ending: its crystals tear up (its arms fling up).
    const cast = e.castingAbility;
    if (this.lastCast === HEAT_CASTS.shed && cast !== HEAT_CASTS.shed) this.shedAt = this.clock;
    this.lastCast = cast;
    const overheating = overheatingOn(e.auras);
    const heat = e.maxResource > 0 ? Math.max(0, Math.min(1, e.resource / e.maxResource)) : 0;
    const fill = e.castTotal > 0 ? Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal)) : 1;
    _actIn.castId = cast;
    _actIn.castFill = fill;
    _actIn.sinceShed = this.clock - this.shedAt;
    _actIn.sinceToll = this.clock - this.tollAt;
    _actIn.sinceBurst = this.clock - this.burstAt;
    _actIn.sinceStoke = this.clock - this.stokeAt;
    _actIn.sinceSwing = this.clock - this.swingAt;
    _actIn.overheating = overheating;
    heatBodyAction(_actIn, _act);
    const look = heatBodyLook(_act.action, _act.k, this.clock, heat, overheating, _look);
    this.yaw += wrapAngle(e.facing - this.yaw) * Math.min(1, dt * 5);
    this.group.rotation.y = this.yaw;
    if (look.tremble > 0 && !this.reducedMotion()) {
      this.group.position.x += (this.rand() - 0.5) * look.tremble * 2;
      this.group.position.z += (this.rand() - 0.5) * look.tremble * 2;
    }
    this.poseJoints(_act.action, _act.k, look);
    for (const p of this.pieces) this.posePiece(p, look);
    this.poseThreads(1, look);
    this.poseLights(_act.action, _act.k, look);
    this.glow(look);
    this.cosmetics(e, _act.action, _act.k, look, heat, dt);
  }

  private poseJoints(action: HeatBodyAction, k: number, look: HeatBodyLook): void {
    const J = this.joints;
    const S = HEAT_SLOTS;
    const bob = 0.08 * Math.sin(this.clock * 1.2);
    const sw = 0.1 * (look.swell - 0.5);
    J[HJ.hip].set(S.hip.x, S.hip.y + bob * 0.5, S.hip.z);
    J[HJ.hipL].set(S.hipJoint.x, S.hipJoint.y + bob * 0.5, S.hipJoint.z);
    J[HJ.hipR].set(-S.hipJoint.x, S.hipJoint.y + bob * 0.5, S.hipJoint.z);
    J[HJ.kneeL].set(S.knee.x, S.knee.y + bob * 0.3, S.knee.z);
    J[HJ.kneeR].set(-S.knee.x, S.knee.y + bob * 0.3, S.knee.z);
    J[HJ.footL].set(S.foot.x, S.foot.y, S.foot.z);
    J[HJ.footR].set(-S.foot.x, S.foot.y, S.foot.z);
    J[HJ.chest].set(S.chest.x, S.chest.y + bob + sw, S.chest.z);
    J[HJ.head].set(S.head.x, S.head.y + bob, S.head.z);
    J[HJ.mouth].set(S.mouth.x, S.mouth.y + bob, S.mouth.z);
    J[HJ.back].set(S.back.x, S.back.y + bob, S.back.z);
    J[HJ.shoulderL].set(S.shoulder.x + 0.6 * sw, S.shoulder.y + bob, S.shoulder.z);
    J[HJ.shoulderR].set(-J[HJ.shoulderL].x, J[HJ.shoulderL].y, J[HJ.shoulderL].z);
    for (let i = 0; i < 2; i++) {
      const side: -1 | 1 = i === 0 ? 1 : -1;
      const target = heatWristTarget(action, side, k, this.swingSide, _wrist);
      const arm = heatArm(side, target, _arm);
      J[HJ.elbowL + i].set(arm.elbow.x, arm.elbow.y + bob, arm.elbow.z);
      J[HJ.wristL + i].set(arm.wrist.x, arm.wrist.y + bob, arm.wrist.z);
    }
    const neckY = J[HJ.chest].y + 1.1;
    _q.setFromAxisAngle(_x, -look.lift);
    for (let h = 0; h < HEAD_JOINTS.length; h++) {
      const i = HEAD_JOINTS[h];
      _a.set(J[i].x, J[i].y - neckY, J[i].z).applyQuaternion(_q);
      J[i].set(_a.x, _a.y + neckY, _a.z);
    }
    const hipY = J[HJ.hip].y;
    const cl = Math.cos(look.lean);
    const sl = Math.sin(look.lean);
    for (const i of LEAN_JOINTS) {
      // The hands on the floor (Shed Heat) stay down there.
      if ((i === HJ.wristL || i === HJ.wristR) && J[i].y < hipY) continue;
      const y = J[i].y - hipY;
      const z = J[i].z;
      J[i].y = hipY + y * cl - z * sl;
      J[i].z = y * sl + z * cl;
    }
  }

  private posePiece(p: PieceView, look: HeatBodyLook): void {
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
    } else if (def.joint === HJ.hip || def.joint === HJ.footL || def.joint === HJ.footR) {
      p.quat.identity();
    } else {
      _a.applyQuaternion(_q2);
      p.quat.copy(_q2);
    }
    p.pos.copy(j).add(_a);
    if (def.joint === HJ.wristL || def.joint === HJ.wristR) {
      const elbow = J[def.joint === HJ.wristL ? HJ.elbowL : HJ.elbowR];
      _b.subVectors(j, elbow).normalize();
      p.pos.copy(j).addScaledVector(_b, def.size.y * 0.35);
      p.quat.setFromUnitVectors(_up, _b);
    }
    p.holder.position.copy(p.pos);
    p.holder.quaternion.copy(p.quat);
    const s = def.id === 'torso' ? 1 + 0.05 * (look.swell - 0.5) : 1;
    p.holder.scale.setScalar(s);
  }

  private poseThreads(alpha: number, look: HeatBodyLook): void {
    const J = this.joints;
    const w = 0.12 * (1 + Math.min(2, look.glow - 0.9) * 0.3) * Math.max(0, alpha);
    let n = 0;
    for (let t = 0; t < HEAT_THREAD_PAIRS.length; t++) {
      const i = HEAT_THREAD_PAIRS[t][0];
      const j = HEAT_THREAD_PAIRS[t][1];
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
    for (; n < HEAT_BODY_POOLS.threads; n++) this.threads.setMatrixAt(n, _m.makeScale(0, 0, 0));
    this.threads.instanceMatrix.needsUpdate = true;
  }

  /** The eyes, the heart's glow, the wind-up's aura and the knell's sphere. */
  private poseLights(action: HeatBodyAction, k: number, look: HeatBodyLook): void {
    const head = this.joints[HJ.head];
    const chest = this.joints[HJ.chest];
    _q.setFromAxisAngle(_x, -look.lift);
    _q2.setFromAxisAngle(_x, look.lean);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      _a.set(side * 0.33, 0.12, 0.74)
        .applyQuaternion(_q)
        .applyQuaternion(_q2);
      this.eyes[i].position.copy(head).add(_a);
    }
    _a.set(0, 0.05, 1.2).applyQuaternion(_q2);
    this.heartGlow.position.copy(chest).add(_a);
    const s = 2.4 + 0.8 * Math.min(4, look.glow);
    this.heartGlow.scale.set(s, s, 1);
    // The wind-up's flash: a white glow round the whole body.
    const as = 9 + 4 * look.flash;
    this.aura.scale.set(as, as * 1.15, 1);
    // A halo of heat round it at every heat, white and beating in the wind-up.
    this.auraMat.opacity = Math.min(0.8, 0.08 + look.haze * 0.14 + look.flash * 0.55);
    // The knell's sphere between its hands.
    if (action === 'knell' || action === 'toll') {
      const l = this.joints[HJ.wristL];
      const r = this.joints[HJ.wristR];
      this.orb.position.set((l.x + r.x) / 2, (l.y + r.y) / 2 + 0.2, (l.z + r.z) / 2 + 0.3);
      const size = action === 'knell' ? 0.6 + 2.6 * k : 3.2 * (1 + 2 * k);
      this.orb.scale.set(size, size, 1);
      this.orbMat.opacity = action === 'knell' ? 0.35 + 0.6 * k : 0.95 * (1 - k);
      this.orb.visible = true;
    } else {
      // A spent sprite still costs a draw: hide it.
      this.orbMat.opacity = 0;
      this.orb.visible = false;
    }
  }

  /** The crystals', seams' and threads' light: gold toward white with heat. */
  private glow(look: HeatBodyLook): void {
    const g = Math.min(4, look.glow);
    this.glowColor
      .copy(this.gold)
      .lerp(this.whiteC, Math.max(0, Math.min(1, look.white + look.flash * 0.5)));
    _s.set(this.glowColor.r, this.glowColor.g, this.glowColor.b);
    (this.crystalMat.uniforms.uColor.value as THREE.Color)
      .copy(this.glowColor)
      .multiplyScalar(Math.min(3.4, 0.9 + g * 0.65));
    (this.fireMat.uniforms.uColor.value as THREE.Color)
      .copy(this.glowColor)
      .multiplyScalar(Math.min(3, 0.7 + g * 0.55));
    this.haloMat.opacity = Math.min(0.85, 0.18 + g * 0.16);
    this.heartGlowMat.opacity = Math.min(0.95, 0.3 + g * 0.18);
    this.heartGlowMat.color.copy(this.glowColor);
    this.eyeMat.opacity = Math.min(1, 0.65 + g * 0.12);
    this.auraMat.color.copy(this.glowColor);
    this.threadColor.setRGB(_s.x, _s.y, _s.z).multiplyScalar(0.7 + g * 0.35);
    const tc = this.threadColor;
    const shown = this.threadShown;
    if (
      !(Math.abs(tc.r - shown.r) < THREAD_COLOR_EPS) ||
      !(Math.abs(tc.g - shown.g) < THREAD_COLOR_EPS) ||
      !(Math.abs(tc.b - shown.b) < THREAD_COLOR_EPS)
    ) {
      shown.copy(tc);
      for (let i = 0; i < HEAT_BODY_POOLS.threads; i++) this.threads.setColorAt(i, tc);
      if (this.threads.instanceColor) this.threads.instanceColor.needsUpdate = true;
    }
  }

  /** A joint's world place (for the puffs). */
  private worldOf(e: Entity, j: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    return out.set(
      e.pos.x + j.x * cosY + j.z * sinY,
      e.pos.y + j.y,
      e.pos.z - j.x * sinY + j.z * cosY,
    );
  }

  /** The flames, embers and haze off it, the fire it pours (cosmetic,
   *  thinned on the low tier). */
  private cosmetics(
    e: Entity,
    action: HeatBodyAction,
    k: number,
    look: HeatBodyLook,
    heat: number,
    dt: number,
  ): void {
    const d = this.density;
    // Tongues of the first flame licking up from its joints, more and whiter
    // as the Hearth climbs.
    const flameRate = dt * (16 + 34 * heat + 24 * look.flash) * d;
    if (this.rand() < flameRate) {
      const j = this.joints[HEAT_FLAME_JOINTS[Math.floor(this.rand() * HEAT_FLAME_JOINTS.length)]];
      this.worldOf(e, j, _a);
      FLAME.color = look.white > 0.6 ? HEAT_BODY_COLORS.spark : HEAT_BODY_COLORS.ember;
      FLAME.size[0] = 1.0 + 0.9 * heat;
      this.particles.puff(_a.x, _a.y, _a.z, 1, FLAME);
    }
    if (this.rand() < dt * (4 + 10 * heat) * d) {
      this.worldOf(e, this.joints[HJ.back], _a);
      this.particles.puff(
        _a.x + (this.rand() - 0.5) * 2,
        _a.y + 1.5 * this.rand(),
        _a.z + (this.rand() - 0.5) * 2,
        1,
        EMBER,
      );
    }
    // The heat's haze rising off it (thin, shed on the low tier).
    if (d >= 1 && this.rand() < dt * 5 * look.haze) {
      this.particles.puff(
        e.pos.x + (this.rand() - 0.5) * 3,
        e.pos.y + 3 + this.rand() * 3,
        e.pos.z + (this.rand() - 0.5) * 3,
        1,
        HAZE,
      );
    }
    if (action === 'shed' && k > 0.3) {
      // Fire streaming down its arms into the floor.
      for (let i = 0; i < 2; i++) {
        if (this.rand() > dt * 40 * d) continue;
        this.worldOf(e, this.joints[i === 0 ? HJ.wristL : HJ.wristR], _a);
        this.particles.puff(_a.x, _a.y, _a.z, 1, STREAM);
      }
    } else if (action === 'pour' && this.rand() < dt * 30 * d * (0.3 + k)) {
      this.worldOf(e, this.joints[HJ.wristR], _a);
      this.particles.puff(_a.x, _a.y - 0.3, _a.z, 1, STREAM);
    } else if (action === 'strain' && this.rand() < dt * 25 * d) {
      // Sparks crackling off it as it strains.
      this.worldOf(e, this.joints[HJ.chest], _a);
      this.particles.puff(_a.x, _a.y, _a.z, 2, STRAIN_SPARK);
    }
  }

  /** Hearthburst: the fire flung off it, a white ring over the floor. */
  private burstFx(e: Entity): void {
    const y = e.pos.y + 4;
    this.particles.puff(e.pos.x, y, e.pos.z, 48, {
      speed: 16,
      up: 4,
      life: 1.1,
      size: [0.6, 0.12],
      color: HEAT_BODY_COLORS.spark,
      alpha: 1,
      pool: 'glow',
      radius: 2,
    });
    this.particles.shockRing(e.pos.x, e.pos.z, HEAT_BODY_COLORS.white, 50, 1.2);
    this.shakeNear(e.pos.x, e.pos.z, 1.1, 90);
  }

  // ---- the death -----------------------------------------------------------------------------

  private poseDead(e: Entity): void {
    if (this.deadAt < 0) {
      this.deadAt = this.seenAlive ? this.clock : this.clock - HEAT_FALL.end - 1;
      if (!this.seenAlive) {
        const rest = heatBodyLook('idle', 0, 0, 0, false);
        this.poseJoints('idle', 0, rest);
        for (const p of this.pieces) this.posePiece(p, rest);
      }
      for (const p of this.pieces) {
        p.diedPos.copy(p.pos);
        p.diedQuat.copy(p.quat);
        const r = heatFallRest(p.index, p.pos);
        p.rest = {
          at: r.at,
          tilt: new THREE.Quaternion().setFromEuler(new THREE.Euler(r.tilt.x, r.tilt.y, r.tilt.z)),
          delay: r.delay,
        };
        p.landed = !this.seenAlive;
      }
      this.auraMat.opacity = 0;
      this.orbMat.opacity = 0;
      if (this.seenAlive) {
        this.particles.puff(e.pos.x, e.pos.y + 4, e.pos.z, 24, {
          speed: 6,
          up: 2,
          life: 0.9,
          size: [0.4, 0.08],
          color: HEAT_BODY_COLORS.spark,
          alpha: 1,
          pool: 'glow',
          radius: 1.4,
        });
        this.particles.shockRing(e.pos.x, e.pos.z, HEAT_BODY_COLORS.fire, 10, 0.8);
        this.shakeNear(e.pos.x, e.pos.z, 0.5, 50);
      }
    }
    this.group.rotation.y = this.yaw;
    const t = this.clock - this.deadAt;
    for (const p of this.pieces) {
      const rest = p.rest;
      if (!rest) continue;
      const fall = heatFallProgress(t, rest.delay, _fall);
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
        // The flame sinking out of it in smoke.
        this.particles.puff(x, this.groundY(x, z) + 0.3, z, Math.round(2 + size * 2), {
          speed: 1.2 + size * 0.6,
          up: 1.6,
          life: 1.6,
          size: [0.6 + size * 0.3, 1.6 + size * 0.6],
          color: HEAT_BODY_COLORS.smoke,
          alpha: 0.4,
          drag: 1.4,
        });
      }
    }
    const fade = Math.max(0, 1 - t / 0.6);
    this.poseThreads(fade * 1.5, _look);
    const dim = Math.max(0.04, 1 - t / HEAT_FALL.end);
    this.glowColor.setHex(HEAT_BODY_COLORS.gold).multiplyScalar(0.5 * dim);
    (this.crystalMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.glowColor.setHex(HEAT_BODY_COLORS.gold).multiplyScalar(0.3 * dim);
    (this.fireMat.uniforms.uColor.value as THREE.Color).copy(this.glowColor);
    this.haloMat.opacity = 0.4 * fade;
    this.heartGlowMat.opacity = 0.7 * fade;
    this.eyeMat.opacity = fade;
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
