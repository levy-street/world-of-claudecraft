// Fire and Fly explosive barrels, drawn: a red drum on a gold warning ring for
// every standing barrel, popping up where the wave placed it; lit, the ring
// turns red and throbs, the drum rattles and swells while its fuse spits
// sparks; blowing, a tall fire column and the drum's shards flying off, on top
// of the cannon's own blast drawn wider and hotter (the owner calls it,
// turret_defense_visual.ts). Driven from IWorld.turretSession's barrels and
// feedback.
//
// GPU rules (src/render/CLAUDE.md "GPU work"): built at the commitment (the
// first frame seen seated), never at world boot. The warning rings draw the
// calligraphy materials (world_quest_trace_materials.ts) the world-quest-trace
// prewarm stages, their geometry stripped of normals so they link nothing,
// and show from the first frame on every graphics tier: a player aims by them.
// The shards (one instanced draw) attach behind the compile gate at the
// commitment, the drums (the model's materials swapped for named ones of its
// own, one clone per pooled slot) behind it too once the model has loaded;
// the fuse sparks and the fire column ride the cannon's one puff draw through
// its pooled bursts. No light; a frame allocates nothing. The
// pure half is turret_barrel_core.ts.
import * as THREE from 'three';
import { TURRET_EXPLOSIVE_BARREL } from '../sim/content/turret_defense';
import type { TurretEvent } from '../sim/minigames/turret_defense';
import { DT } from '../sim/types';
import type { TurretSessionView } from '../world_api/vehicles';
import { loadGltf } from './assets/loader';
import { timeBuildSpan } from './build_spans';
import type { CannonPuffBurst } from './cannon_puff_burst_core';
import { cannonHash01 } from './cannon_puff_core';
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
  type TurretBarrelCounts,
  type TurretShard,
  type TurretShardFrame,
  turretBarrelCounts,
  turretBarrelFireInto,
  turretBarrelFirePuffs,
  turretBarrelFuseInto,
  turretBarrelPop,
  turretBarrelRingRadius,
  turretFuseSparksInto,
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
type BarrelView = TurretSessionView['defense']['barrels'][number];
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
const LID = new THREE.Color(0x2b2622);
const SOOT = new THREE.Color(0x5a1c16);
const PAINT = new THREE.Color(0xb3281e);

interface Slot {
  /** The barrel this slot draws, 0 when free. */
  id: number;
  /** Pose of the drum: the fuse's rattle, its swell and its pop. */
  readonly root: THREE.Group;
  readonly ring: THREE.Mesh;
  bornAt: number;
  yaw: number;
  used: boolean;
}

interface Shards {
  readonly mesh: THREE.InstancedMesh;
  readonly geometry: THREE.BoxGeometry;
  readonly material: THREE.MeshLambertMaterial;
}

export class TurretBarrelVisual {
  /** Holds the drums and the shards, each attached behind the compile gate. */
  readonly group = new THREE.Group();
  /** The warning rings: on prewarmed programs, drawn from the commitment. */
  readonly rings = new THREE.Group();
  private readonly drums = new THREE.Group();
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
  private ringGeometry: THREE.RingGeometry | null = null;
  private shards: Shards | null = null;
  private nextBlast = 0;
  private state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private disposed = false;

  constructor(
    private readonly groundAt: (x: number, z: number) => number,
    private readonly compileGate?: CompileGate,
    private readonly source: TurretBarrelSource = loadBarrelModel,
    low = false,
  ) {
    this.counts = turretBarrelCounts(low);
    this.group.name = TURRET_BARREL_NAME;
    this.rings.name = TURRET_BARREL_RINGS_NAME;
    this.drums.name = `${TURRET_BARREL_NAME}:drums`;
    this.shardsRoot.name = `${TURRET_BARREL_NAME}:shards`;
  }

  /** The build started (the model may still be on its way). */
  get prepared(): boolean {
    return this.state !== 'idle';
  }

  /** The drums are built (their gate may still be pending). */
  get modelReady(): boolean {
    return this.state === 'ready';
  }

  /**
   * The commitment: mints the rings (shown at once) and the shards (behind the
   * compile gate), and loads the model into the slots, attached behind the gate
   * once built. A load that fails leaves the barrels unprepared and calls
   * `onUnavailable`, so the caller can try again later; the rings stand in.
   */
  prepare(parent: THREE.Object3D, onUnavailable?: () => void): void {
    if (this.state !== 'idle' || this.disposed) return;
    this.state = 'loading';
    if (!this.ringGeometry) this.mintPools(parent);
    this.source().then(
      (scene) => {
        if (this.disposed) return;
        if (!timeBuildSpan('zone:turret-barrels', () => this.build(scene))) {
          this.state = 'failed';
          console.error('Fire and Fly barrel model has no mesh, rings only');
          return;
        }
        this.state = 'ready';
        this.attach(this.drums);
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
   * One frame: every standing barrel on a slot, popping up when new, rattling
   * through its fuse; `tick` is the display tick, `time` the frame seconds.
   * A frozen (lost) session holds its lit barrels still.
   */
  update(barrels: readonly BarrelView[], frozen: boolean, tick: number, time: number): void {
    if (this.disposed || !this.ringGeometry) return;
    const mats = worldQuestTraceMaterials();
    for (const slot of this.slots) slot.used = false;
    for (const b of barrels) {
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
      root.rotation.set(fuse.tiltX, slot.yaw, fuse.tiltZ);
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

  /** A barrel is lit: its fuse's glow, flame licks and sparks on a pooled burst. */
  light(ev: BarrelLit, burst: CannonPuffBurst | null, time: number): void {
    if (!burst || this.disposed) return;
    const fuse = ev.fuseTicks * DT;
    const n = turretFuseSparksInto(
      burst.puffs,
      ev.id,
      ev.x,
      ev.y + TURRET_EXPLOSIVE_BARREL.height,
      ev.z,
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
    free.yaw = cannonHash01(id, 3) * Math.PI * 2;
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
      this.drums.add(root);
      this.slots.push({ id: 0, root, ring, bornAt: 0, yaw: 0, used: false });
    }
    this.shards = this.mintShards();
    tagVfxSubtree(this.shardsRoot);
    parent.add(this.rings, this.group);
    this.attach(this.shardsRoot);
  }

  /** One gated attach under the visual's group: the shards at the commitment, the drums once built. */
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

  /** The model sized to the sim's drum, its foot on the slot's origin, one clone per slot. */
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
    this.slots.forEach((slot, i) => {
      slot.root.add(i === 0 ? fit : fit.clone(true));
    });
    return true;
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
      else this.color.copy(SOOT).lerp(PAINT, shard.shade);
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
  const color = s.color?.clone() ?? new THREE.Color(0xffffff);
  const map = s.map ?? null;
  const material = GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({
        color,
        map,
        roughness: s.isMeshStandardMaterial ? s.roughness : 0.8,
        metalness: 0,
      })
    : new THREE.MeshLambertMaterial({ color, map });
  material.name = `${TURRET_BARREL_MATERIAL_PREFIX}${s.name || 'surface'}`;
  return material;
}
