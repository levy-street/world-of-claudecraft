// Fire and Fly explosive barrels, drawn: a powder keg on a gold warning ring
// for every standing barrel, popping up where the wave placed it, a flame
// painted on the facet that faces the tower and a short wick on its lid; lit,
// the ring turns red and throbs, the keg rattles and swells while the wick's
// tip spits sparks; blowing, a tall fire column and the keg's shards flying
// off, on top of the cannon's own blast drawn wider and hotter (the owner
// calls it, turret_defense_visual.ts). Driven from IWorld.turretSession's
// barrels and feedback.
//
// GPU rules (src/render/CLAUDE.md "GPU work"): built at the commitment (the
// first frame seen seated), never at world boot. The warning rings draw the
// calligraphy materials (world_quest_trace_materials.ts) the world-quest-trace
// prewarm stages, their geometry stripped of normals so they link nothing,
// and show from the first frame on every graphics tier: a player aims by them.
// The shards (one instanced draw) attach behind the compile gate at the
// commitment, the kegs (the model's materials swapped for named ones of its
// own, one clone per pooled slot) behind it too once the model has loaded.
// The flame mark and the wick are one small mesh per keg on one shared named
// material: an opaque shield-shaped polygon and a cord on a painted texture
// the gate uploads, the keg's own program (no alpha test, no blending); its
// texels are painted once per page, in the texel slot when one is given, and
// the kegs wait for them behind their rings. The fuse sparks and the fire
// column ride the cannon's one puff draw through its pooled bursts. No light;
// a frame allocates nothing. The pure half is turret_barrel_core.ts.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TURRET_EXPLOSIVE_BARREL } from '../sim/content/turret_defense';
import type { TurretEvent } from '../sim/minigames/turret_defense';
import { DT } from '../sim/types';
import type { TurretSessionView } from '../world_api/vehicles';
import { loadGltf } from './assets/loader';
import { timeBuildSpan } from './build_spans';
import type { CannonPuffBurst } from './cannon_puff_burst_core';
import { CANNON_IMPACT_POOL } from './cannon_shell_core';
import type { CannonBlast } from './cannon_shell_visuals';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX } from './gfx';
import { tagVfxSubtree } from './renderer_diagnostics';
import {
  newTurretBarrelFuseFrame,
  newTurretShard,
  TURRET_BARREL_FIRE_PUFFS,
  TURRET_BARREL_LOOK,
  TURRET_BARREL_MODEL_URL,
  TURRET_BARREL_SHARDS,
  TURRET_FUSE_PUFFS,
  TURRET_KEG_MARK,
  TURRET_KEG_MARK_FRAME,
  TURRET_KEG_SHIELD_ASPECT,
  TURRET_KEG_WICK,
  TURRET_SHARD_BAND_SHADE,
  type TurretBarrelCounts,
  type TurretKegPoint,
  type TurretShard,
  type TurretShardFrame,
  turretBarrelCounts,
  turretBarrelFireInto,
  turretBarrelFirePuffs,
  turretBarrelFuseInto,
  turretBarrelPop,
  turretBarrelRingRadius,
  turretFuseSparksInto,
  turretKegMarkTexels,
  turretKegShieldOutline,
  turretKegWickInto,
  turretKegWickTipInto,
  turretKegYaw,
  turretPuffsEnd,
  turretShardInto,
  turretShardLaunch,
} from './turret_barrel_core';
import { TURRET_CONTACT_PUFFS } from './turret_contact_dust_core';
import { worldQuestTraceMaterials } from './world_quest_trace_materials';

type CompileGate = (target: THREE.Object3D) => Promise<unknown>;
/** The barrel's scene graph as authored; the visual draws clones of it. */
export type TurretBarrelSource = () => Promise<THREE.Object3D>;
/** A pooled burst on the cannon's puff draw (CannonShellVisuals.puffBurst). */
export type TurretBurstTaker = (now: number) => CannonPuffBurst | null;
type DefenseView = TurretSessionView['defense'];
/** What the barrels are drawn from: the standing barrels and the tower's centre their marks face. */
export type TurretBarrelField = Pick<DefenseView, 'barrels' | 'cx' | 'cz'>;
type TowerCentre = Pick<DefenseView, 'cx' | 'cz'>;
type BarrelLit = Extract<TurretEvent, { type: 'barrelLit' }>;
type BarrelBlast = Extract<TurretEvent, { type: 'barrelExploded' }>;

export const TURRET_BARREL_NAME = 'fire-and-fly-barrels';
export const TURRET_BARREL_RINGS_NAME = 'fire-and-fly-barrel-rings';
export const TURRET_BARREL_MATERIAL_PREFIX = 'fireAndFly:barrel:';
const burstsOf = (puffs: number): number => Math.ceil(puffs / TURRET_CONTACT_PUFFS);
/**
 * Bursts a whole chain keeps alive at once on the turret's pooled bursts
 * (TURRET_CONTACT_PUFFS each): every barrel's fuse and its fire column.
 */
export const TURRET_BARREL_BURSTS =
  TURRET_EXPLOSIVE_BARREL.cap * (burstsOf(TURRET_FUSE_PUFFS) + burstsOf(TURRET_BARREL_FIRE_PUFFS));
/** Blasts the cannon visuals keep on the ground at once: the shells' own and a whole chain's. */
export const TURRET_BARREL_IMPACTS = CANNON_IMPACT_POOL + TURRET_EXPLOSIVE_BARREL.cap;

const loadBarrelModel: TurretBarrelSource = () =>
  loadGltf(TURRET_BARREL_MODEL_URL).then((gltf) => gltf.scene);

let pageMarkTexels: Uint8Array | null = null;

/** The flame mark's texels, painted once per page (filed in the build ledger). */
function kegMarkTexels(): Uint8Array {
  pageMarkTexels ??= timeBuildSpan('zone:turret-keg-mark', () =>
    turretKegMarkTexels(TURRET_KEG_MARK.texels),
  );
  return pageMarkTexels;
}

/** Forgets the page's mark texels, so a test can watch a cold build. */
export function resetTurretKegMarkTexelsForTest(): void {
  pageMarkTexels = null;
}

/**
 * A barrel's blast as the cannon's shot visuals draw it: its own radius (the
 * shock ring's reach and the scorch), bigger and hotter than a shell's, on an
 * id no shell carries so no shell in flight is taken for it.
 */
export function turretBarrelBlast(ev: BarrelBlast): CannonBlast {
  return {
    shotId: -ev.id,
    x: ev.x,
    y: ev.y,
    z: ev.z,
    hits: ev.hits,
    radius: TURRET_EXPLOSIVE_BARREL.blastRadius,
    scale: TURRET_BARREL_LOOK.blastScale,
  };
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const LID = new THREE.Color(0x7a4a36);
const BAND = new THREE.Color(0x8b9ba6);
const STAVE_DARK = new THREE.Color(0x5a3326);
const STAVE_LIGHT = new THREE.Color(0x9c5d42);
/** Arc steps per side of the painted shield's lower point. */
const SHIELD_ARC_STEPS = 8;
const WICK_POINTS = 6;

interface Slot {
  /** The barrel this slot draws, 0 when free. */
  id: number;
  /** Pose of the keg: its yaw to the tower, the fuse's rattle, its swell and its pop. */
  readonly root: THREE.Group;
  readonly ring: THREE.Mesh;
  bornAt: number;
  used: boolean;
}

/** The flame mark and the wick: one geometry and one material every keg shares. */
interface Mark {
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.Material;
  readonly texture: THREE.DataTexture;
}

interface Shards {
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BoxGeometry;
  readonly material: THREE.MeshLambertMaterial;
}

export class TurretBarrelVisual {
  /** Holds the kegs and the shards, each attached behind the compile gate. */
  readonly group = new THREE.Group();
  /** The warning rings: on prewarmed programs, drawn from the commitment. */
  readonly rings = new THREE.Group();
  private readonly kegs = new THREE.Group();
  private readonly shardsRoot = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly counts: Readonly<TurretBarrelCounts>;
  private readonly materials: THREE.Material[] = [];
  private readonly shardPool: TurretShard[] = Array.from(
    { length: TURRET_BARREL_SHARDS.pool * TURRET_BARREL_SHARDS.perBlast },
    newTurretShard,
  );
  private readonly blastAt = new Float64Array(TURRET_BARREL_SHARDS.pool);
  private readonly shardCounts = new Int32Array(TURRET_BARREL_SHARDS.pool);
  private readonly liveShards: boolean[] = new Array(TURRET_BARREL_SHARDS.pool).fill(false);
  private readonly fuse = newTurretBarrelFuseFrame();
  private readonly shardFrame: TurretShardFrame = { x: 0, y: 0, z: 0, angle: 0, scale: 0 };
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly tip: TurretKegPoint = { x: 0, y: 0, z: 0 };
  private ringGeometry: THREE.RingGeometry | null = null;
  private shards: Shards | null = null;
  private mark: Mark | null = null;
  private nextBlast = 0;
  private state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private disposed = false;

  constructor(
    private readonly groundAt: (x: number, z: number) => number,
    private readonly compileGate?: CompileGate,
    private readonly source: TurretBarrelSource = loadBarrelModel,
    low = false,
    private readonly texelSlot?: () => Promise<unknown>,
  ) {
    this.counts = turretBarrelCounts(low);
    this.group.name = TURRET_BARREL_NAME;
    this.rings.name = TURRET_BARREL_RINGS_NAME;
    this.kegs.name = `${TURRET_BARREL_NAME}:kegs`;
    this.shardsRoot.name = `${TURRET_BARREL_NAME}:shards`;
  }

  /** The build started (the model may still be on its way). */
  get prepared(): boolean {
    return this.state !== 'idle';
  }

  /** The kegs are built (their gate may still be pending). */
  get modelReady(): boolean {
    return this.state === 'ready';
  }

  /**
   * The commitment: mints the rings (shown at once) and the shards (behind the
   * compile gate), and loads the model into the slots, attached behind the gate
   * once built with the mark's texels. A load that fails leaves the barrels
   * unprepared and calls `onUnavailable`, so the caller can try again later;
   * the rings stand in.
   */
  prepare(parent: THREE.Object3D, onUnavailable?: () => void): void {
    if (this.state !== 'idle' || this.disposed) return;
    this.state = 'loading';
    if (!this.ringGeometry) this.mintPools(parent);
    const slot = this.texelSlot;
    const texels = pageMarkTexels || !slot ? null : slot().then(kegMarkTexels, kegMarkTexels);
    Promise.all([this.source(), texels]).then(
      ([scene]) => {
        if (this.disposed) return;
        if (!timeBuildSpan('zone:turret-barrels', () => this.build(scene))) {
          this.state = 'failed';
          console.error('Fire and Fly kegs could not be built, rings only');
          return;
        }
        this.state = 'ready';
        this.attach(this.kegs);
      },
      (error) => {
        if (this.disposed) return;
        this.state = 'idle';
        console.error('Fire and Fly barrel model unavailable, rings only for now', error);
        onUnavailable?.();
      },
    );
  }

  /**
   * One frame: every standing barrel on a slot, its painted facet toward the
   * tower, popping up when new, rattling through its fuse; `tick` is the
   * display tick, `time` the frame seconds. A frozen (lost) session holds its
   * lit barrels still.
   */
  update(field: TurretBarrelField, frozen: boolean, tick: number, time: number): void {
    if (this.disposed || !this.ringGeometry) return;
    const mats = worldQuestTraceMaterials();
    for (const slot of this.slots) slot.used = false;
    for (const b of field.barrels) {
      const slot = this.slotFor(b.id, time);
      if (!slot) continue;
      slot.used = true;
      const lit = b.litTick >= 0 && !frozen;
      const litAge = lit ? Math.max(0, (tick - b.litTick) * DT) : null;
      const fuse = this.fuse;
      if (litAge !== null) {
        turretBarrelFuseInto(fuse, litAge, (b.blowTick - b.litTick) * DT, b.id);
      } else {
        fuse.dx = fuse.dz = fuse.tiltX = fuse.tiltZ = 0;
        fuse.swell = 1;
      }
      const pop = turretBarrelPop(time - slot.bornAt);
      const root = slot.root;
      root.visible = pop > 0;
      root.position.set(b.x + fuse.dx, b.y, b.z + fuse.dz);
      root.rotation.set(fuse.tiltX, turretKegYaw(b.x, b.z, field.cx, field.cz), fuse.tiltZ);
      root.scale.setScalar(Math.max(1e-3, pop * fuse.swell));
      const ring = slot.ring;
      ring.visible = true;
      ring.material = litAge !== null ? mats.red : mats.gold;
      ring.position.set(b.x, b.y + TURRET_BARREL_LOOK.ringLift, b.z);
      ring.scale.setScalar(turretBarrelRingRadius(time, litAge, b.id) * Math.min(1, pop + 0.5));
    }
    for (const slot of this.slots) {
      if (slot.used) continue;
      slot.id = 0;
      slot.root.visible = false;
      slot.ring.visible = false;
    }
    this.drawShards(time);
  }

  /** A barrel is lit: its fuse's glow, flame licks and sparks at the wick's tip, on a pooled burst. */
  light(ev: BarrelLit, centre: TowerCentre, burst: CannonPuffBurst | null, time: number): void {
    if (!burst || this.disposed) return;
    const fuse = ev.fuseTicks * DT;
    const yaw = turretKegYaw(ev.x, ev.z, centre.cx, centre.cz);
    const tip = turretKegWickTipInto(this.tip, ev.x, ev.y, ev.z, yaw);
    const n = turretFuseSparksInto(
      burst.puffs,
      ev.id,
      tip.x,
      tip.y,
      tip.z,
      ev.y,
      fuse,
      this.counts.fuseSparks,
    );
    burst.count = n;
    burst.life = turretPuffsEnd(burst.puffs, n);
    burst.at = time;
  }

  /** A barrel blows: its fire column on pooled bursts and its shards flying off. */
  explode(ev: BarrelBlast, take: TurretBurstTaker, time: number): void {
    if (this.disposed) return;
    const total = turretBarrelFirePuffs(this.counts.embers);
    let first = 0;
    while (first < total) {
      const burst = take(time);
      if (!burst) break;
      const n = turretBarrelFireInto(
        burst.puffs,
        first,
        total - first,
        ev.id,
        ev.x,
        ev.y,
        ev.z,
        ev.y,
        this.counts.embers,
      );
      if (n === 0) break;
      burst.count = n;
      burst.life = turretPuffsEnd(burst.puffs, n);
      burst.at = time;
      first += n;
    }
    this.launchShards(ev, time);
  }

  /** Stops showing a session: every slot and shard cleared. */
  clear(): void {
    for (const slot of this.slots) {
      slot.id = 0;
      slot.root.visible = false;
      slot.ring.visible = false;
    }
    this.liveShards.fill(false);
    const shards = this.shards;
    if (shards) {
      shards.mesh.count = 0;
      shards.mesh.visible = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.removeFromParent();
    this.rings.removeFromParent();
    this.ringGeometry?.dispose();
    this.ringGeometry = null;
    const shards = this.shards;
    this.shards = null;
    if (shards) {
      shards.mesh.dispose();
      shards.geometry.dispose();
      shards.material.dispose();
    }
    const mark = this.mark;
    this.mark = null;
    if (mark) {
      mark.geometry.dispose();
      mark.material.dispose();
      mark.texture.dispose();
    }
    // The model's geometries and textures belong to the loader's cache.
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }

  /** The slot drawing barrel `id`, or a free one taken for it now. */
  private slotFor(id: number, time: number): Slot | null {
    let free: Slot | null = null;
    for (const slot of this.slots) {
      if (slot.id === id) return slot;
      if (!free && slot.id === 0) free = slot;
    }
    if (!free) return null;
    free.id = id;
    free.bornAt = time;
    return free;
  }

  /** The rings, the slots' pose groups and the shard pool, minted once at the commitment. */
  private mintPools(parent: THREE.Object3D): void {
    const ringGeometry = new THREE.RingGeometry(TURRET_BARREL_LOOK.ringInner, 1, 40);
    // vertexNormals is a program key bit and MeshBasic without an env map reads
    // no normal: without one, the ring draws the program the world-quest-trace
    // prewarm stages, not a variant nothing links.
    ringGeometry.deleteAttribute('normal');
    this.ringGeometry = ringGeometry;
    const gold = worldQuestTraceMaterials().gold;
    for (let i = 0; i < TURRET_EXPLOSIVE_BARREL.cap; i++) {
      const ring = new THREE.Mesh(ringGeometry, gold);
      ring.name = `${TURRET_BARREL_RINGS_NAME}:${i}`;
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = floorVfxRenderOrder('encounter');
      ring.userData.renderCategory = 'ui3d';
      ring.visible = false;
      this.rings.add(ring);
      const root = new THREE.Group();
      root.visible = false;
      this.kegs.add(root);
      this.slots.push({ id: 0, root, ring, bornAt: 0, used: false });
    }
    this.shards = this.mintShards();
    tagVfxSubtree(this.shardsRoot);
    parent.add(this.rings, this.group);
    this.attach(this.shardsRoot);
  }

  /** One gated attach under the visual's group: the shards at the commitment, the kegs once built. */
  private attach(group: THREE.Group): void {
    const parent = this.group;
    void attachSceneGroupGated(parent, group, this.compileGate, () => this.disposed).catch(
      () => {},
    );
  }

  private mintShards(): Shards {
    const count = TURRET_BARREL_SHARDS.pool * TURRET_BARREL_SHARDS.perBlast;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({
      name: `${TURRET_BARREL_MATERIAL_PREFIX}shard`,
      color: 0xffffff,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = `${TURRET_BARREL_MATERIAL_PREFIX}shards`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The colour attribute is a program key bit: it exists from the build, so
    // the gate links the very program the first blast draws.
    for (let i = 0; i < count; i++) {
      mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
      mesh.setMatrixAt(i, ZERO);
    }
    mesh.count = 0;
    mesh.visible = false;
    this.shardsRoot.add(mesh);
    return { mesh, geometry, material };
  }

  /** The model sized to the sim's barrel, its foot on the slot's origin, one clone and one mark per slot. */
  private build(source: THREE.Object3D): boolean {
    const template = source.clone(true);
    const owned = new Map<THREE.Material, THREE.Material>();
    let meshes = 0;
    template.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes++;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const swap = (material: THREE.Material): THREE.Material => {
        let mine = owned.get(material);
        if (!mine) {
          mine = barrelMaterial(material);
          owned.set(material, mine);
          this.materials.push(mine);
        }
        return mine;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    if (meshes === 0) return false;
    template.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(template);
    const size = box.getSize(new THREE.Vector3());
    if (!(size.y > 1e-6)) return false;
    const center = box.getCenter(new THREE.Vector3());
    template.position.set(-center.x, -box.min.y, -center.z);
    const fit = new THREE.Group();
    fit.add(template);
    fit.scale.setScalar(TURRET_EXPLOSIVE_BARREL.height / size.y);
    const mark = this.mintMark();
    if (!mark) return false;
    this.slots.forEach((slot, i) => {
      slot.root.add(i === 0 ? fit : fit.clone(true));
      const painted = new THREE.Mesh(mark.geometry, mark.material);
      painted.name = `${TURRET_BARREL_MATERIAL_PREFIX}mark`;
      painted.castShadow = false;
      painted.receiveShadow = true;
      slot.root.add(painted);
    });
    return true;
  }

  /** The shield and wick geometry, the flame mark's texture and its material on the keg's own surface family; null when the geometry cannot be built. */
  private mintMark(): Mark | null {
    const geometry = kegMarkGeometry();
    if (!geometry) return null;
    const n = TURRET_KEG_MARK.texels;
    const texture = new THREE.DataTexture(kegMarkTexels(), n, n * 2);
    texture.name = `${TURRET_BARREL_MATERIAL_PREFIX}mark`;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    const material = kegSurface(new THREE.Color(0xffffff), texture, 0.85);
    material.name = `${TURRET_BARREL_MATERIAL_PREFIX}mark`;
    const mark = { geometry, material, texture };
    this.mark = mark;
    return mark;
  }

  private launchShards(ev: BarrelBlast, time: number): void {
    const shards = this.shards;
    if (!shards) return;
    const s = this.nextBlast;
    this.nextBlast = (s + 1) % TURRET_BARREL_SHARDS.pool;
    const per = TURRET_BARREL_SHARDS.perBlast;
    const count = Math.max(0, Math.min(per, this.counts.shards));
    for (let i = 0; i < count; i++) {
      const shard = turretShardLaunch(
        this.shardPool[s * per + i],
        ev.id,
        i,
        count,
        ev.x,
        ev.y,
        ev.z,
        this.groundAt,
      );
      if (shard.shade < 0.1) this.color.copy(LID);
      else if (shard.shade < TURRET_SHARD_BAND_SHADE) this.color.copy(BAND);
      else {
        const k = (shard.shade - TURRET_SHARD_BAND_SHADE) / (1 - TURRET_SHARD_BAND_SHADE);
        this.color.copy(STAVE_DARK).lerp(STAVE_LIGHT, k);
      }
      shards.mesh.setColorAt(s * per + i, this.color);
    }
    for (let i = count; i < per; i++) shards.mesh.setMatrixAt(s * per + i, ZERO);
    if (shards.mesh.instanceColor) shards.mesh.instanceColor.needsUpdate = true;
    this.shardCounts[s] = count;
    this.blastAt[s] = time;
    this.liveShards[s] = count > 0;
  }

  private drawShards(time: number): void {
    const shards = this.shards;
    if (!shards) return;
    const per = TURRET_BARREL_SHARDS.perBlast;
    let any = false;
    let wrote = false;
    for (let s = 0; s < TURRET_BARREL_SHARDS.pool; s++) {
      if (!this.liveShards[s]) continue;
      const age = time - this.blastAt[s];
      let live = false;
      for (let i = 0; i < this.shardCounts[s]; i++) {
        const shard = this.shardPool[s * per + i];
        if (!turretShardInto(shard, age, this.shardFrame)) {
          shards.mesh.setMatrixAt(s * per + i, ZERO);
          continue;
        }
        live = true;
        const f = this.shardFrame;
        this.axis.set(shard.axisX, shard.axisY, shard.axisZ);
        this.quat.setFromAxisAngle(this.axis, f.angle);
        this.pos.set(f.x, f.y, f.z);
        this.scale.set(shard.sx * f.scale, shard.sy * f.scale, shard.sz * f.scale);
        this.matrix.compose(this.pos, this.quat, this.scale);
        shards.mesh.setMatrixAt(s * per + i, this.matrix);
      }
      wrote = true;
      this.liveShards[s] = live;
      any ||= live;
    }
    if (wrote) shards.mesh.instanceMatrix.needsUpdate = true;
    shards.mesh.count = any ? shards.mesh.instanceMatrix.count : 0;
    shards.mesh.visible = any;
  }
}

/** The kit's palette atlas on this tier's surface family, dielectric like the tower's. */
function barrelMaterial(source: THREE.Material): THREE.Material {
  const s = source as THREE.MeshStandardMaterial;
  const material = kegSurface(
    s.color?.clone() ?? new THREE.Color(0xffffff),
    s.map ?? null,
    s.isMeshStandardMaterial ? s.roughness : 0.8,
  );
  material.name = `${TURRET_BARREL_MATERIAL_PREFIX}${s.name || 'surface'}`;
  return material;
}

function kegSurface(
  color: THREE.Color,
  map: THREE.Texture | null,
  roughness: number,
): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, map, roughness, metalness: 0 })
    : new THREE.MeshLambertMaterial({ color, map });
}

/**
 * The painted shield, a polygon just off its facet whose outline is the
 * texture's own, and the wick's cord rising from the bung, in the keg's frame
 * (yd, before its yaw) with the mark texture's uvs: one geometry.
 */
function kegMarkGeometry(): THREE.BufferGeometry | null {
  const f = TURRET_KEG_MARK_FRAME;
  const half = f.width / 2;
  const outline = turretKegShieldOutline(SHIELD_ARC_STEPS);
  const count = outline.length / 2;
  const position = new Float32Array((count + 1) * 3);
  const normal = new Float32Array((count + 1) * 3);
  const uv = new Float32Array((count + 1) * 2);
  const v0 = TURRET_KEG_MARK.markBottom;
  const put = (i: number, x: number, y: number): void => {
    position[i * 3] = f.normalX * f.offset + f.sideX * x * half;
    position[i * 3 + 1] = f.centreY + y * half;
    position[i * 3 + 2] = f.normalZ * f.offset + f.sideZ * x * half;
    normal[i * 3] = f.normalX;
    normal[i * 3 + 2] = f.normalZ;
    uv[i * 2] = (x + 1) / 2;
    uv[i * 2 + 1] = v0 + ((1 - v0) * (y / TURRET_KEG_SHIELD_ASPECT + 1)) / 2;
  };
  put(0, 0, 0);
  for (let i = 0; i < count; i++) put(i + 1, outline[i * 2], outline[i * 2 + 1]);
  const index: number[] = [];
  for (let i = 0; i < count; i++) index.push(0, 1 + i, 1 + ((i + 1) % count));
  const shield = new THREE.BufferGeometry();
  shield.setAttribute('position', new THREE.BufferAttribute(position, 3));
  shield.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  shield.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  shield.setIndex(index);
  const points: THREE.Vector3[] = [];
  const p: TurretKegPoint = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < WICK_POINTS; i++) {
    turretKegWickInto(p, i / (WICK_POINTS - 1));
    points.push(new THREE.Vector3(p.x, p.y, p.z));
  }
  const wick = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points),
    8,
    TURRET_KEG_WICK.radius,
    5,
    false,
  );
  // The cord samples the strip along the texture's bottom.
  const wickUv = wick.getAttribute('uv');
  for (let i = 0; i < wickUv.count; i++) {
    wickUv.setY(i, wickUv.getY(i) * TURRET_KEG_MARK.wickTop);
  }
  const merged = mergeGeometries([shield, wick]);
  shield.dispose();
  wick.dispose();
  if (merged) merged.name = `${TURRET_BARREL_MATERIAL_PREFIX}mark`;
  return merged;
}
