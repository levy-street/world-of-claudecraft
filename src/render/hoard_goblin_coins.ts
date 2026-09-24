// The Coinsack Scurrier's gold, on screen: when the goblin dies its sack bursts
// and the coins fly out, bounce, lie on the floor, then sink away. Purely the
// show: the sim has already paid every player in the room (the loot line and
// its coin sound come from that payout, src/sim/rift/hoard_goblin.ts). It is
// read straight off the world (the goblin going from living to dead), so there
// is no new event or wire surface, and an escaping goblin (it just vanishes)
// never bursts. How it LOOKS is hoard_goblin_coins_core.ts beside this file.
//
// Performance contract (the hoard siblings' contract): one instanced mesh and
// one point cloud, built once and attached through the scene gate, so nothing
// compiles mid-fight; no lights; nothing allocated per frame. The world is
// looked at a few times a second, and only inside a rift floor. The low tier
// throws half the coins and no glints; nothing a player acts on lives here.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { HOARD_GOBLIN_TEMPLATE_ID } from '../sim/rift/hoard_goblin';
import type { IWorld } from '../world_api';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import { sparkMaterial } from './hoard_fx_materials';
import {
  type Coin,
  type CoinBurst,
  coinGlint,
  coinScale,
  goblinDeaths,
  COIN_LOOK as LOOK,
  makeCoin,
  spawnCoins,
  stepCoin,
} from './hoard_goblin_coins_core';
import { setRenderCategory } from './renderer_diagnostics';

/** Bursts that can play at once (one goblin per room; a second for overlap). */
const SLOTS = 2;
/** Seconds between looks at the world for a goblin that just died. */
const POLL = 0.1;
const GLINT_SIZE = 0.55;

interface BurstSlot {
  live: boolean;
  age: number;
  coins: Coin[];
}

export class HoardGoblinCoinsFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly perSlot: number;
  private readonly slots: BurstSlot[] = [];
  private readonly seen = new Map<number, boolean>();
  private readonly deaths: CoinBurst[] = [];
  private readonly present = new Set<number>();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scale = new THREE.Vector3();
  private readonly glints?: {
    points: THREE.Points;
    position: THREE.BufferAttribute;
    size: THREE.BufferAttribute;
    alpha: THREE.BufferAttribute;
  };
  private poll = 0;
  private time = 0;
  private bursts = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    effectsTier: GfxTier = GFX.tier,
  ) {
    this.root.name = 'hoard-goblin-coins';
    setRenderCategory(this.root, 'ui3d');
    const low =
      resolveUiEffectsProfile({ presetLabel: effectsTier, effectsQuality: 1, reduceMotion: false })
        .tier === 'low';
    this.perSlot = low ? LOOK.lowCount : LOOK.count;
    const total = SLOTS * this.perSlot;
    for (let s = 0; s < SLOTS; s++) {
      const coins: Coin[] = [];
      for (let i = 0; i < this.perSlot; i++) coins.push(makeCoin());
      this.slots.push({ live: false, age: 0, coins });
    }

    // A coin: a short cylinder lying in the XZ plane, gold with a little glow
    // of its own so it still reads on a dark cave floor.
    const geometry = new THREE.CylinderGeometry(LOOK.radius, LOOK.radius, LOOK.thickness, 12);
    this.geometries.push(geometry);
    const material = new THREE.MeshStandardMaterial({
      color: LOOK.gold,
      emissive: LOOK.glow,
      metalness: 0.85,
      roughness: 0.32,
    });
    this.materials.push(material);
    this.mesh = new THREE.InstancedMesh(geometry, material, total);
    this.mesh.name = 'GoblinCoins';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < total; i++) this.mesh.setMatrixAt(i, this.matrix);
    this.root.add(this.mesh);

    if (!low) {
      const points = new THREE.BufferGeometry();
      this.geometries.push(points);
      const position = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
      const size = new THREE.BufferAttribute(new Float32Array(total), 1);
      const alpha = new THREE.BufferAttribute(new Float32Array(total), 1);
      const tint = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
      position.setUsage(THREE.DynamicDrawUsage);
      size.setUsage(THREE.DynamicDrawUsage);
      alpha.setUsage(THREE.DynamicDrawUsage);
      const color = new THREE.Color(0xfff1b8);
      for (let i = 0; i < total; i++) tint.setXYZ(i, color.r, color.g, color.b);
      points.setAttribute('position', position);
      points.setAttribute('size', size);
      points.setAttribute('alpha', alpha);
      points.setAttribute('tint', tint);
      const glintMaterial = sparkMaterial();
      this.materials.push(glintMaterial);
      const cloud = new THREE.Points(points, glintMaterial);
      cloud.name = 'GoblinCoinGlints';
      cloud.visible = false;
      cloud.frustumCulled = false;
      cloud.renderOrder = 30;
      this.root.add(cloud);
      this.glints = { points: cloud, position, size, alpha };
    }

    this.readyForEntry = attachSceneGroupGated(
      scene,
      this.root,
      compileGate,
      () => this.disposed,
    ).catch(() => {});
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    this.watch(dt);
    let any = false;
    for (let s = 0; s < SLOTS; s++) {
      const slot = this.slots[s];
      if (!slot.live) continue;
      slot.age += dt;
      if (slot.age >= LOOK.lifeSec) {
        this.clear(s);
        continue;
      }
      any = true;
      this.paint(s, dt);
    }
    this.mesh.visible = any;
    if (this.glints) this.glints.points.visible = any;
    if (!any) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.glints) {
      this.glints.position.needsUpdate = true;
      this.glints.size.needsUpdate = true;
      this.glints.alpha.needsUpdate = true;
    }
  }

  /** A few times a second, inside a rift floor, look for a goblin that died. */
  private watch(dt: number): void {
    const world = this.world;
    if (!world?.riftFloor) {
      this.seen.clear();
      return;
    }
    this.poll -= dt;
    if (this.poll > 0) return;
    this.poll = POLL;
    goblinDeaths(
      world.entities.values(),
      HOARD_GOBLIN_TEMPLATE_ID,
      this.seen,
      this.deaths,
      this.present,
    );
    for (const death of this.deaths) this.burst(death);
  }

  private burst(death: CoinBurst): void {
    let s = this.slots.findIndex((slot) => !slot.live);
    if (s < 0) s = 0;
    const slot = this.slots[s];
    slot.live = true;
    slot.age = 0;
    this.bursts++;
    spawnCoins(
      slot.coins,
      death.x,
      death.z,
      death.facing,
      this.groundY,
      death.id * 7919 + this.bursts,
      this.reducedMotion(),
    );
  }

  private paint(s: number, dt: number): void {
    const slot = this.slots[s];
    const size = coinScale(slot.age);
    const base = s * this.perSlot;
    for (let i = 0; i < slot.coins.length; i++) {
      const c = slot.coins[i];
      stepCoin(c, dt, this.groundY);
      this.position.set(c.x, c.y, c.z);
      this.rotation.setFromEuler(this.euler.set(c.rx, c.ry, c.rz));
      this.scale.set(size, size, size);
      this.mesh.setMatrixAt(
        base + i,
        this.matrix.compose(this.position, this.rotation, this.scale),
      );
      if (this.glints) {
        const glint = coinGlint(slot.age, i, this.time) * size;
        this.glints.position.setXYZ(base + i, c.x, c.y + LOOK.thickness, c.z);
        this.glints.size.setX(base + i, GLINT_SIZE * glint);
        this.glints.alpha.setX(base + i, glint);
      }
    }
  }

  private clear(s: number): void {
    const slot = this.slots[s];
    slot.live = false;
    this.matrix.makeScale(0, 0, 0);
    const base = s * this.perSlot;
    for (let i = 0; i < this.perSlot; i++) {
      this.mesh.setMatrixAt(base + i, this.matrix);
      if (this.glints) this.glints.alpha.setX(base + i, 0);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.glints) this.glints.alpha.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.mesh.dispose();
  }
}
