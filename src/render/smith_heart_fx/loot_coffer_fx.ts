// The Smith's Heart's loot moment (plan: loot_coffer_core.ts), hosted by
// ../rift_death_zone.ts after the guardians' death scenes. When a guardian
// that fell in sight holds loot as its scene resolves, a forge coffer climbs
// out of a ring of molten light in the floor beside the corpse, locks in
// place with an anvil's ring, opens, and a shaft of golden light climbs out
// of it; it waits there breathing while the body holds loot for this viewer,
// sits ajar and dim while it only holds someone else's, and shuts and goes
// dark once it is empty. When the body goes it sinks back into the floor.
// A guardian first seen already dead has its coffer simply standing.
//
// Never a fake click target: the coffer lends the CORPSE a click proxy
// (../fx_pick_proxies.ts) carrying the corpse's entity id, so a click on the
// coffer is a click on the body: the same pick resolution, the same corpse
// loot through the same interaction path, the same authoritative outcome.
// Everything it shows is read off IWorld (the body's `lootable`, its loot
// slots, this viewer's rights through `corpseIndicatorFor`), offline and
// online alike; it holds nothing back and decides nothing.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through attachSceneGroupGated (the
// iron, shaft and floor programs are its own; the cards are the council's
// light card, the particles the crypt pools' glow and dust); a fixed pool of
// two coffers (the council's two bodies), no light, no shadow caster, no
// per-frame allocation. The particles are emitted at WORLD points (their
// shader builds the point itself and never reads a parent): the pools hang
// off the root at the origin. Each coffer's meshes ride a stage laid at its
// feet (small local coordinates). The low tier thins the particles and sheds
// the shaft's halo (`LOOT_COFFER_SECONDARY_LAYERS`); every beat and the
// coffer's whole read play on every tier. Reduced motion: no climb, no
// flash, no burst; the coffer is there and its light fades in.

import * as THREE from 'three';
import { localPartyMemberIds } from '../../game/corpse_loot_availability';
import { sfx } from '../../game/sfx';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { corpseIndicatorFor } from '../../sim/corpse_loot_state';
import { corpseHasDecayed } from '../../sim/respawn_policy';
import type { Entity } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { addFxPickProxy, removeFxPickProxy } from '../fx_pick_proxies';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import {
  DUST_FRAG,
  GLOW_FRAG as PARTICLE_GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';
import { setRenderCategory } from '../renderer_diagnostics';
import { GLOW_FRAG, GLOW_VERT } from './council_entrance_glsl';
import { inSmithHeartClaim } from './council_fx_core';
import {
  LOOT_COFFER,
  LOOT_COFFER_BOSSES,
  LOOT_COFFER_EMIT,
  LOOT_COFFER_PALETTES,
  LOOT_COFFER_RATES,
  LOOT_COFFER_RISE_SOUNDS,
  LOOT_COFFER_SECONDARY_LAYERS,
  LOOT_COFFER_SHUT_SOUND,
  LOOT_COFFER_TARGETS,
  type LootCofferBoss,
  type LootCofferMood,
  type LootCofferPalette,
  type LootCofferRise,
  type LootCofferSound,
  lootCofferBreath,
  lootCofferBudget,
  lootCofferCrossed,
  lootCofferEase,
  lootCofferFade,
  lootCofferMood,
  lootCofferRise,
  lootCofferSink,
  lootCofferSpark,
  lootCofferSpot,
} from './loot_coffer_core';
import {
  COFFER_FLOOR_FRAG,
  COFFER_FLOOR_VERT,
  COFFER_IRON_FRAG,
  COFFER_IRON_VERT,
  COFFER_SHAFT_FRAG,
  COFFER_SHAFT_VERT,
} from './loot_coffer_glsl';
import {
  buildLootCofferShapes,
  COFFER,
  COFFER_HEART_Y,
  COFFER_HINGE,
  COFFER_RIM_Y,
  COFFER_SCALE,
} from './loot_coffer_shape';

const SCAN_SEC = 0.25;
/** Coffers drawn at once: the council's two bodies are the most. */
const SLOTS = 2;
/** The light cards per coffer: the heart, the gap, the clasp's glint, the
 *  shaft's crown, the lock's flash. */
const CARDS = 5;
/** The shaft's height and the halo's (yards). */
const SHAFT_H = 13;
const HALO_H = 10;
/** The coffer's scale (its stage carries it; the cards and the particles,
 *  which ignore a parent's scale, take it by hand). */
const S = COFFER_SCALE;
const GOLD = new THREE.Color(0xffc45a);
const HOARD_GOLD = new THREE.Color(0xffd27a);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _spot = { x: 0, z: 0, yaw: 0 };
const _w = { x: 0, y: 0, z: 0 };

interface Slot {
  readonly stage: THREE.Group;
  readonly rig: THREE.Group;
  readonly hinge: THREE.Group;
  readonly iron: THREE.ShaderMaterial;
  readonly inlay: THREE.MeshBasicMaterial;
  readonly hoardMat: THREE.MeshBasicMaterial;
  readonly hoard: THREE.Mesh;
  readonly shaft: THREE.Mesh;
  readonly shaftMat: THREE.ShaderMaterial;
  readonly halo: THREE.Mesh;
  readonly haloMat: THREE.ShaderMaterial;
  readonly floor: THREE.Mesh;
  readonly floorMat: THREE.ShaderMaterial;
  readonly cards: THREE.InstancedMesh;
  readonly proxy: THREE.Mesh;
  /** The heart of its light in world space (the iron's bounce). */
  readonly heart: THREE.Vector3;
  id: number;
  boss: LootCofferBoss | null;
  palette: LootCofferPalette;
  /** The clock its rise began at; -1 when it stood from the start. */
  riseAt: number;
  risePrev: number;
  /** The clock its body went (-1 while it lies there). */
  goneAt: number;
  mood: LootCofferMood;
  lid: number;
  glow: number;
  shaftLevel: number;
  sparks: number;
  moteDebt: number;
  glintDebt: number;
  climbDebt: number;
  sparkN: number;
  yaw: number;
}

interface Track {
  seenAlive: boolean;
  /** The clock it was seen dead at (-Infinity: first seen dead, long past;
   *  NaN while it stands). */
  deadAt: number;
  slot: Slot | null;
}

export class LootCofferFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly share: number;
  private readonly secondary: boolean;
  private readonly slots: Slot[] = [];
  private readonly tracks = new Map<number, Track>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly glowPool: ParticlePool;
  private readonly dustPool: ParticlePool;
  private readonly spec: ParticleSpec = {
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
  private readonly rise: LootCofferRise = {
    sink: 0,
    ring: 0,
    ringAlpha: 0,
    pool: 0,
    flash: 0,
    open: 0,
    shaft: 0,
    shed: 0,
    done: true,
  };
  private partyIds: number[] | null = null;
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x10c0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
  ) {
    this.root.name = 'smith-heart-loot-coffer';
    setRenderCategory(this.root, 'ui3d');
    const { tier } = resolveUiEffectsProfile({
      presetLabel: GFX.tier,
      effectsQuality: 1,
      reduceMotion: false,
    });
    const budget = lootCofferBudget(tier);
    this.share = budget.share;
    this.secondary = budget.secondary;
    const shapes = buildLootCofferShapes();
    for (const g of Object.values(shapes)) this.geometries.push(g);

    // ---- the particles: world points off the root at the origin ----
    const pool = (
      name: string,
      frag: string,
      blending: THREE.Blending,
      capacity: number,
      step: number,
    ) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      const p = new ParticlePool(
        Math.round(capacity * this.share) + 24,
        m,
        floorVfxRenderOrder('encounter', step),
      );
      p.mesh.name = name;
      this.geometries.push(p.mesh.geometry);
      this.root.add(p.mesh);
      return p;
    };
    this.dustPool = pool('smithHeartLootDust', DUST_FRAG, THREE.NormalBlending, 120, 12);
    this.glowPool = pool(
      'smithHeartLootSparks',
      PARTICLE_GLOW_FRAG,
      THREE.AdditiveBlending,
      320,
      14,
    );

    // ---- the coffers ----
    const proxyMat = new THREE.MeshBasicMaterial({ name: 'smithHeartLootProxy' });
    this.materials.push(proxyMat);
    for (let i = 0; i < SLOTS; i++) this.slots.push(this.buildSlot(i, shapes, proxyMat));

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private buildSlot(
    i: number,
    shapes: ReturnType<typeof buildLootCofferShapes>,
    proxyMat: THREE.Material,
  ): Slot {
    const stage = new THREE.Group();
    stage.name = `smithHeartLootCoffer${i}`;
    stage.visible = false;
    this.root.add(stage);
    const rig = new THREE.Group();
    stage.add(rig);
    const iron = new THREE.ShaderMaterial({
      name: 'smithHeartLootIron',
      uniforms: {
        uHeart: { value: new THREE.Vector3() },
        uGlowCol: { value: GOLD.clone() },
        uGlow: { value: 0 },
        uAccent: { value: new THREE.Color() },
        uFade: { value: 1 },
      },
      vertexShader: COFFER_IRON_VERT,
      fragmentShader: COFFER_IRON_FRAG,
      vertexColors: true,
    });
    this.materials.push(iron);
    const body = new THREE.Mesh(shapes.body, iron);
    body.name = 'smithHeartLootBody';
    rig.add(body);
    const hinge = new THREE.Group();
    hinge.position.set(0, COFFER_HINGE.y, COFFER_HINGE.z);
    rig.add(hinge);
    const lid = new THREE.Mesh(shapes.lid, iron);
    lid.name = 'smithHeartLootLid';
    hinge.add(lid);
    // The heart's position in view space, written once a frame per coffer
    // from the camera that draws it (both iron meshes share the uniform).
    const heart = new THREE.Vector3();
    body.onBeforeRender = (_r, _s2, camera) => {
      (iron.uniforms.uHeart.value as THREE.Vector3)
        .copy(heart)
        .applyMatrix4(camera.matrixWorldInverse);
    };
    const inlay = new THREE.MeshBasicMaterial({
      name: 'smithHeartLootInlay',
      color: 0xffffff,
      toneMapped: false,
    });
    this.materials.push(inlay);
    const inlayMesh = new THREE.Mesh(shapes.inlay, inlay);
    inlayMesh.name = 'smithHeartLootInlays';
    rig.add(inlayMesh);
    const lidInlay = new THREE.Mesh(shapes.lidInlay, inlay);
    lidInlay.name = 'smithHeartLootLidRune';
    hinge.add(lidInlay);
    const hoardMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartLootHoard',
      vertexColors: true,
      toneMapped: false,
    });
    this.materials.push(hoardMat);
    const hoard = new THREE.Mesh(shapes.hoard, hoardMat);
    hoard.name = 'smithHeartLootHoard';
    rig.add(hoard);

    const shaftMaterial = (name: string, streaks: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uStreaks: { value: streaks },
        },
        vertexShader: COFFER_SHAFT_VERT,
        fragmentShader: COFFER_SHAFT_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(m);
      return m;
    };
    const shaftMat = shaftMaterial('smithHeartLootShaftMat', 1);
    const shaft = new THREE.Mesh(shapes.shaft, shaftMat);
    shaft.name = 'smithHeartLootShaft';
    shaft.frustumCulled = false;
    shaft.renderOrder = floorVfxRenderOrder('encounter', 16);
    shaft.position.y = COFFER_RIM_Y - 0.2;
    rig.add(shaft);
    const haloMat = shaftMaterial('smithHeartLootShaftHaloMat', 0.35);
    const halo = new THREE.Mesh(shapes.shaft, haloMat);
    halo.name = LOOT_COFFER_SECONDARY_LAYERS[0];
    halo.frustumCulled = false;
    halo.renderOrder = floorVfxRenderOrder('encounter', 15);
    halo.position.y = COFFER_RIM_Y - 0.4;
    rig.add(halo);

    const floorMat = new THREE.ShaderMaterial({
      name: 'smithHeartLootFloorMat',
      uniforms: {
        uColor: { value: new THREE.Color() },
        uRingColor: { value: new THREE.Color() },
        uPool: { value: 0 },
        uRing: { value: 0 },
        uRingAlpha: { value: 0 },
        uTime: this.uTime,
      },
      vertexShader: COFFER_FLOOR_VERT,
      fragmentShader: COFFER_FLOOR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(floorMat);
    const floor = new THREE.Mesh(shapes.floor, floorMat);
    floor.name = 'smithHeartLootFloor';
    floor.frustumCulled = false;
    floor.renderOrder = floorVfxRenderOrder('encounter', 11);
    floor.position.y = 0.06;
    stage.add(floor);

    const cardMat = new THREE.ShaderMaterial({
      name: 'smithHeartLootLight',
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.materials.push(cardMat);
    const cards = new THREE.InstancedMesh(shapes.card, cardMat, CARDS);
    cards.name = 'smithHeartLootLights';
    cards.frustumCulled = false;
    cards.renderOrder = floorVfxRenderOrder('encounter', 17);
    cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < CARDS; k++) {
      cards.setMatrixAt(k, _zero);
      cards.setColorAt(k, _c.setRGB(0, 0, 0));
    }
    stage.add(cards);

    const proxy = new THREE.Mesh(shapes.proxy, proxyMat);
    proxy.name = 'smithHeartLootProxy';
    proxy.visible = false;
    stage.add(proxy);
    addFxPickProxy(proxy);

    return {
      stage,
      rig,
      hinge,
      iron,
      inlay,
      hoardMat,
      hoard,
      shaft,
      shaftMat,
      halo,
      haloMat,
      floor,
      floorMat,
      cards,
      proxy,
      heart,
      id: -1,
      boss: null,
      palette: LOOT_COFFER_PALETTES.forge,
      riseAt: -1,
      risePrev: -1,
      goneAt: -1,
      mood: 'empty',
      lid: 0,
      glow: 0,
      shaftLevel: 0,
      sparks: 0,
      moteDebt: 0,
      glintDebt: 0,
      climbDebt: 0,
      sparkN: 0,
      yaw: 0,
    };
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  /** The coffers standing (or sinking) now: their corpses' ids (tests). */
  get standing(): number[] {
    const ids: number[] = [];
    for (const s of this.slots) if (s.id >= 0) ids.push(s.id);
    return ids;
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
    for (const slot of this.slots) if (slot.id >= 0) this.paint(slot, dt);
    this.glowPool.update(this.clock);
    this.dustPool.update(this.clock);
  }

  // ---- the scan ------------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    if (!me || !inSmithHeartClaim(me.pos.x, me.pos.z)) {
      if (this.tracks.size > 0) this.releaseAll();
      return;
    }
    if (world.entityRosterVersion !== this.rosterSeen) {
      this.rosterSeen = world.entityRosterVersion;
      for (const e of world.entities.values()) {
        if (e.kind !== 'mob' || !LOOT_COFFER_BOSSES[e.templateId] || this.tracks.has(e.id))
          continue;
        this.tracks.set(e.id, { seenAlive: false, deadAt: Number.NaN, slot: null });
      }
    }
    this.partyIds = localPartyMemberIds(world.partyInfo);
    for (const [id, track] of this.tracks) {
      const e = world.entities.get(id);
      if (!e) {
        // Out of view (or gone): a coffer sinks; the record is dropped once
        // it has (a body seen again is a new sight).
        if (track.slot) this.letGo(track.slot);
        else this.tracks.delete(id);
        continue;
      }
      if (!e.dead) {
        track.seenAlive = true;
        track.deadAt = Number.NaN;
        if (track.slot) this.letGo(track.slot);
        continue;
      }
      if (Number.isNaN(track.deadAt))
        track.deadAt = track.seenAlive ? this.clock : Number.NEGATIVE_INFINITY;
      const mood = this.moodOf(e, world.playerId);
      if (track.slot) {
        if (track.slot.goneAt < 0) this.setMood(track.slot, mood);
        continue;
      }
      if (mood === 'empty') continue;
      const boss = LOOT_COFFER_BOSSES[e.templateId];
      if (this.clock < track.deadAt + boss.revealAt) continue;
      const slot = this.slots.find((s) => s.id < 0);
      if (!slot) continue;
      track.slot = slot;
      this.take(slot, e, boss, mood, track.deadAt !== Number.NEGATIVE_INFINITY);
    }
  }

  private moodOf(e: Entity, viewerId: number): LootCofferMood {
    return lootCofferMood(
      corpseIndicatorFor(e, viewerId, this.partyIds),
      e.dead,
      e.lootable,
      corpseHasDecayed(e.dead, e.corpseTimer),
    );
  }

  /** Raise a coffer beside `e` (with its rise when the death was seen). */
  private take(
    slot: Slot,
    e: Entity,
    boss: LootCofferBoss,
    mood: LootCofferMood,
    ceremony: boolean,
  ): void {
    slot.id = e.id;
    slot.boss = boss;
    slot.palette = LOOT_COFFER_PALETTES[boss.flavour];
    lootCofferSpot(e.pos.x, e.pos.z, e.facing, boss, _spot);
    slot.stage.position.set(_spot.x, this.groundY(_spot.x, _spot.z), _spot.z);
    slot.stage.rotation.set(0, _spot.yaw, 0);
    slot.stage.scale.setScalar(S);
    slot.stage.updateMatrixWorld(true);
    slot.yaw = _spot.yaw;
    slot.heart.set(_spot.x, slot.stage.position.y + (COFFER_HEART_Y + 0.4) * S, _spot.z);
    slot.riseAt = ceremony ? this.clock : -1;
    slot.risePrev = -1;
    slot.goneAt = -1;
    slot.mood = mood;
    const target = LOOT_COFFER_TARGETS[mood];
    // A coffer standing from the start is already in its mood; a rising
    // one eases in under its ceremony.
    slot.lid = ceremony ? 0 : target.lid;
    slot.glow = ceremony ? 0 : target.glow;
    slot.shaftLevel = ceremony ? 0 : target.shaft;
    slot.sparks = ceremony ? 0 : target.sparks;
    slot.moteDebt = 0;
    slot.glintDebt = 0;
    slot.climbDebt = 0;
    const p = slot.palette;
    (slot.iron.uniforms.uAccent.value as THREE.Color).setHex(p.accent);
    (slot.iron.uniforms.uGlowCol.value as THREE.Color).copy(GOLD).lerp(_c.setHex(p.accent), 0.3);
    (slot.shaftMat.uniforms.uColor.value as THREE.Color).setHex(p.shaft);
    (slot.haloMat.uniforms.uColor.value as THREE.Color).setHex(p.shaft);
    (slot.floorMat.uniforms.uColor.value as THREE.Color).copy(GOLD);
    (slot.floorMat.uniforms.uRingColor.value as THREE.Color).setHex(p.accent);
    slot.halo.visible = this.secondary;
    slot.stage.visible = true;
  }

  private setMood(slot: Slot, mood: LootCofferMood): void {
    if (mood === slot.mood) return;
    const shut = mood === 'empty' && slot.lid > 12;
    slot.mood = mood;
    if (shut) this.shut(slot);
  }

  /** The body went (or stood up again): the coffer sinks back. */
  private letGo(slot: Slot): void {
    if (slot.goneAt < 0) slot.goneAt = this.clock;
  }

  private free(slot: Slot): void {
    for (const [id, track] of this.tracks) {
      if (track.slot !== slot) continue;
      track.slot = null;
      if (!this.world?.entities.has(id)) this.tracks.delete(id);
    }
    slot.id = -1;
    slot.boss = null;
    slot.stage.visible = false;
    slot.proxy.userData.entityId = undefined;
  }

  private releaseAll(): void {
    for (const slot of this.slots) if (slot.id >= 0) this.free(slot);
    this.tracks.clear();
    this.rosterSeen = Number.NaN;
  }

  // ---- one coffer's frame --------------------------------------------------------------------

  private paint(slot: Slot, dt: number): void {
    const calm = this.reducedMotion();
    const t = this.clock;
    // The rise (a coffer that stood from the start is past it).
    const age = slot.riseAt < 0 ? LOOT_COFFER.end + 1 : t - slot.riseAt;
    const rise = lootCofferRise(age, calm, this.rise);
    if (slot.riseAt >= 0 && !rise.done) this.riseBeats(slot, age, rise, calm, dt);
    slot.risePrev = age;

    // The levels ease toward the mood.
    const target = LOOT_COFFER_TARGETS[slot.goneAt >= 0 ? 'empty' : slot.mood];
    const R = LOOT_COFFER_RATES;
    slot.lid = lootCofferEase(slot.lid, target.lid, dt, R.lidOpen, R.lidShut);
    slot.glow = lootCofferEase(slot.glow, target.glow, dt, R.glowUp, R.glowDown);
    slot.shaftLevel = lootCofferEase(slot.shaftLevel, target.shaft, dt, R.shaft);
    slot.sparks = lootCofferEase(slot.sparks, target.sparks, dt, R.sparks);

    // Gone: it sinks (reduced motion: it fades), then the slot is free.
    let sink = rise.sink;
    let fade = 1;
    if (slot.goneAt >= 0) {
      const gone = t - slot.goneAt;
      if (gone >= LOOT_COFFER.sinkFor) {
        this.free(slot);
        return;
      }
      sink += lootCofferSink(gone, calm);
      fade = lootCofferFade(gone);
    }
    const breath = lootCofferBreath(t + slot.id * 0.37, calm);
    const glow = slot.glow * (0.78 + 0.32 * breath) * fade;
    const open = slot.lid * rise.open;
    const shaft = slot.shaftLevel * rise.shaft * (0.8 + 0.25 * breath) * fade;

    slot.rig.position.y = sink > 0 ? -sink : 0;
    slot.hinge.rotation.x = -THREE.MathUtils.degToRad(open);
    slot.iron.uniforms.uGlow.value = glow * (0.35 + 0.65 * Math.min(1, open / 40)) + rise.flash;
    slot.iron.uniforms.uFade.value = calm ? fade : 1;
    _c.setHex(slot.palette.accent).multiplyScalar(
      (0.18 + 1.9 * glow + 2.5 * rise.flash) * (calm ? fade : 1),
    );
    slot.inlay.color.copy(_c);
    slot.hoard.visible = open > 2;
    slot.hoardMat.color.copy(HOARD_GOLD).multiplyScalar(0.35 + 1.25 * glow);
    slot.heart.y = slot.stage.position.y + (COFFER_HEART_Y + 0.4 - sink) * S;

    // The shaft and its halo stand on the rim and climb into the dark.
    const shaftOn = shaft > 0.004;
    slot.shaft.visible = shaftOn;
    slot.shaftMat.uniforms.uAlpha.value = Math.min(1.6, shaft) * 0.9;
    slot.shaft.scale.set(0.95 + 0.25 * rise.shaft, SHAFT_H, 0.95 + 0.25 * rise.shaft);
    slot.halo.visible = shaftOn && this.secondary;
    slot.haloMat.uniforms.uAlpha.value = Math.min(1.6, shaft) * 0.32;
    slot.halo.scale.set(2.3, HALO_H, 2.3);

    // The floor: the pool of its light, the molten ring it climbed out of.
    const pool = Math.max(rise.pool, 0) * (0.25 + 0.75 * glow) * fade;
    slot.floor.visible = pool > 0.004 || rise.ringAlpha > 0.004;
    slot.floor.scale.setScalar(LOOT_COFFER.ringRadius);
    slot.floorMat.uniforms.uPool.value = pool * 0.55;
    slot.floorMat.uniforms.uRing.value = rise.ring;
    slot.floorMat.uniforms.uRingAlpha.value = rise.ringAlpha;

    this.paintCards(slot, sink, glow, open, shaft, rise.flash);

    // A click on the coffer is a click on its body, while the body holds
    // something and the coffer is up out of the floor.
    const clickable = slot.goneAt < 0 && slot.mood !== 'empty' && sink < 1;
    slot.proxy.userData.entityId = clickable ? slot.id : undefined;

    if (slot.goneAt < 0) this.emitWaiting(slot, dt, open, shaft, calm);
  }

  private paintCards(
    slot: Slot,
    sink: number,
    glow: number,
    open: number,
    shaft: number,
    flash: number,
  ): void {
    const cards = slot.cards;
    const opened = Math.min(1, open / 50);
    const accent = _c.setHex(slot.palette.accent);
    const y = COFFER_RIM_Y;
    const front = COFFER.depth / 2;
    this.card(
      cards,
      0,
      COFFER_HEART_Y + 0.35 - sink,
      0,
      3.4,
      GOLD,
      glow * (0.25 + 0.75 * opened) * 0.9,
    );
    this.card(cards, 1, y + 0.05 - sink, front + 0.1, 2.2, GOLD, glow * (0.3 + 0.5 * (1 - opened)));
    this.card(cards, 2, y - 0.36 - sink, front + 0.2, 0.9, accent, glow * 0.8);
    this.card(cards, 3, y + 9 - sink, 0, 7, GOLD, shaft * 0.22);
    this.card(cards, 4, 1.3 - sink, 0.2, 9, GOLD, flash * 1.2);
    cards.instanceMatrix.needsUpdate = true;
    if (cards.instanceColor) cards.instanceColor.needsUpdate = true;
  }

  /** Light card `k` at (0, y, z) on the stage, `size` yards (before the
   *  coffer's scale), `col` times `amount` (0: hidden). */
  private card(
    cards: THREE.InstancedMesh,
    k: number,
    y: number,
    z: number,
    size: number,
    col: THREE.Color,
    amount: number,
  ): void {
    if (amount <= 0.003) {
      cards.setMatrixAt(k, _zero);
    } else {
      _p.set(0, y, z);
      _s.setScalar(size * S);
      cards.setMatrixAt(k, _m.compose(_p, _q.identity(), _s));
    }
    cards.setColorAt(k, _c2.copy(col).multiplyScalar(Math.max(0, amount)));
  }

  // ---- the beats -----------------------------------------------------------------------------

  private riseBeats(
    slot: Slot,
    age: number,
    rise: LootCofferRise,
    calm: boolean,
    dt: number,
  ): void {
    const prev = slot.risePrev;
    for (const snd of LOOT_COFFER_RISE_SOUNDS)
      if (lootCofferCrossed(prev, age, snd.at)) this.sound(slot, snd);
    if (calm) return;
    // The climb: grit and sparks off its flanks and the ring.
    if (rise.shed > 0) {
      slot.climbDebt += dt * LOOT_COFFER_EMIT.climbSparks * this.share;
      while (slot.climbDebt >= 1) {
        slot.climbDebt -= 1;
        const a = this.rand() * Math.PI * 2;
        const r = 1.2 + this.rand() * 0.9;
        this.local(slot, Math.cos(a) * r, 0.1, Math.sin(a) * r);
        this.spark(
          slot,
          _w.x,
          _w.y,
          _w.z,
          Math.cos(a) * 1.4,
          4 + this.rand() * 4,
          Math.sin(a) * 1.4,
          0.9,
          0.16,
        );
        if (this.rand() < LOOT_COFFER_EMIT.climbDust / LOOT_COFFER_EMIT.climbSparks)
          this.dust(_w.x, _w.y, _w.z, 1.6, 0.9);
      }
    }
    // The lock: a burst of sparks out of the seam and a ring of dust.
    if (lootCofferCrossed(prev, age, LOOT_COFFER.lockAt)) {
      const n = Math.round(LOOT_COFFER_EMIT.lockSparks * this.share);
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2;
        this.local(slot, Math.cos(a) * 1.1, COFFER_RIM_Y * 0.6, Math.sin(a) * 0.7);
        const sp = 3 + this.rand() * 6;
        this.spark(
          slot,
          _w.x,
          _w.y,
          _w.z,
          Math.cos(a) * sp,
          2 + this.rand() * 6,
          Math.sin(a) * sp,
          0.7 + this.rand() * 0.6,
          0.2,
        );
      }
      const d = Math.round(LOOT_COFFER_EMIT.lockDust * this.share);
      for (let i = 0; i < d; i++) {
        const a = (i / Math.max(1, d)) * Math.PI * 2;
        this.local(slot, Math.cos(a) * 1.9, 0.15, Math.sin(a) * 1.9);
        this.dust(_w.x, _w.y, _w.z, 2.4, 1.3);
      }
    }
  }

  /** The waiting coffer: motes out of its open hold, glints up its shaft. */
  private emitWaiting(slot: Slot, dt: number, open: number, shaft: number, calm: boolean): void {
    const k = this.share * (calm ? 0.5 : 1);
    const opened = Math.min(1, open / 40);
    slot.moteDebt += dt * LOOT_COFFER_EMIT.motes * slot.sparks * opened * k;
    while (slot.moteDebt >= 1) {
      slot.moteDebt -= 1;
      this.local(
        slot,
        (this.rand() - 0.5) * (COFFER.width - 0.5),
        COFFER_RIM_Y + 0.05,
        (this.rand() - 0.5) * (COFFER.depth - 0.5),
      );
      this.spark(
        slot,
        _w.x,
        _w.y,
        _w.z,
        (this.rand() - 0.5) * 0.8,
        1.1 + this.rand() * 1.6,
        (this.rand() - 0.5) * 0.8,
        1.6 + this.rand() * 1.2,
        0.13,
        -0.25,
      );
    }
    slot.glintDebt += dt * LOOT_COFFER_EMIT.glints * Math.min(1, shaft) * k;
    while (slot.glintDebt >= 1) {
      slot.glintDebt -= 1;
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * 0.55;
      this.local(slot, Math.cos(a) * r, COFFER_RIM_Y + 0.3, Math.sin(a) * r);
      const s = this.spec;
      s.x = _w.x;
      s.y = _w.y;
      s.z = _w.z;
      s.vx = 0;
      s.vy = 3.5 + this.rand() * 2.5;
      s.vz = 0;
      s.ax = 0;
      s.ay = 0;
      s.az = 0;
      s.life = 2.2 + this.rand() * 0.8;
      s.drag = 0.05;
      s.floor = -1e6;
      s.size0 = 0.3;
      s.size1 = 0.08;
      s.spin = 0;
      s.seed = this.rand();
      s.r = 1;
      s.g = 0.93;
      s.b = 0.7;
      s.a = 0.95;
      this.glowPool.emit(this.clock, s);
    }
  }

  /** The lid falling shut on an emptied coffer: a puff and a few sparks. */
  private shut(slot: Slot): void {
    this.sound(slot, LOOT_COFFER_SHUT_SOUND);
    const n = Math.round(LOOT_COFFER_EMIT.shutDust * this.share);
    for (let i = 0; i < n; i++) {
      this.local(slot, (this.rand() - 0.5) * COFFER.width, COFFER_RIM_Y, COFFER.depth / 2 + 0.1);
      this.dust(_w.x, _w.y, _w.z, 0.9, 0.7);
    }
    const m = Math.round(LOOT_COFFER_EMIT.shutSparks * this.share);
    for (let i = 0; i < m; i++) {
      this.local(slot, (this.rand() - 0.5) * COFFER.width, COFFER_RIM_Y, COFFER.depth / 2);
      this.spark(
        slot,
        _w.x,
        _w.y,
        _w.z,
        (this.rand() - 0.5) * 2,
        1.5 + this.rand() * 2,
        1.5,
        0.6,
        0.1,
      );
    }
  }

  private sound(slot: Slot, snd: LootCofferSound): void {
    const s = slot.stage.position;
    sfx.playAt(snd.key, s.x, s.y + 1.2, s.z, {
      gain: snd.gain,
      rate: snd.rate,
      cooldown: 0.05,
      jitter: false,
      priority: true,
    });
  }

  // ---- the particles (world points) ------------------------------------------------------------

  /** A point in the coffer's frame (its stage) as a world point, in `_w`. */
  private local(slot: Slot, x: number, y: number, z: number): void {
    const c = Math.cos(slot.yaw);
    const s = Math.sin(slot.yaw);
    const o = slot.stage.position;
    _w.x = o.x + (x * c + z * s) * S;
    _w.y = o.y + y * S;
    _w.z = o.z + (-x * s + z * c) * S;
  }

  private spark(
    slot: Slot,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    gravity = 6,
  ): void {
    const col = lootCofferSpark(slot.palette, slot.sparkN++);
    const s = this.spec;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = vx;
    s.vy = vy;
    s.vz = vz;
    s.ax = 0;
    s.ay = -gravity;
    s.az = 0;
    s.life = life;
    s.drag = 0.6;
    s.floor = slot.stage.position.y + 0.05;
    s.size0 = size;
    s.size1 = size * 0.35;
    s.spin = 0;
    s.seed = this.rand();
    s.r = col[0];
    s.g = col[1];
    s.b = col[2];
    s.a = 1;
    this.glowPool.emit(this.clock, s);
  }

  private dust(x: number, y: number, z: number, size: number, life: number): void {
    const s = this.spec;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = (this.rand() - 0.5) * 1.2;
    s.vy = 0.5 + this.rand() * 0.8;
    s.vz = (this.rand() - 0.5) * 1.2;
    s.ax = 0;
    s.ay = 0;
    s.az = 0;
    s.life = life * (0.8 + this.rand() * 0.5);
    s.drag = 1.4;
    s.floor = y - 0.2;
    s.size0 = size * 0.6;
    s.size1 = size * 1.5;
    s.spin = (this.rand() - 0.5) * 1.5;
    s.seed = this.rand();
    s.r = 0.36;
    s.g = 0.31;
    s.b = 0.27;
    s.a = 0.55;
    this.dustPool.emit(this.clock, s);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseAll();
    for (const slot of this.slots) {
      removeFxPickProxy(slot.proxy);
      slot.cards.dispose();
    }
    this.root.removeFromParent();
    this.glowPool.dispose();
    this.dustPool.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
