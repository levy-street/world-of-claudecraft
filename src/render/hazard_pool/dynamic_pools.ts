// Boss-dropped hazard pools (world_api activeHazardPools(): Sister Nhalia's
// Blackwater Mark today). A few pooled slots built once at construction under
// one root, attached through the renderer's compile gate so the shared hazard
// pool program links before any pool ever draws (the static Litany dressing
// links the same program at delve entry). Each frame reconciles the slots with
// the world's rows by id: a new row claims a slot and spills, a kept row ages,
// and a row the world dropped drains for HAZARD_POOL_DRAIN_SEC before its slot
// frees. The pool's whole footprint shows from its first frame on every
// graphics tier; reduced motion only holds the surface flow and pulse still.
// No light; no per-frame allocation (a claim builds the slot's disc, once per
// pool).

import * as THREE from 'three';
import type { HazardPoolView } from '../../world_api/dungeons';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import {
  HAZARD_POOL_DRAIN_SEC,
  HAZARD_POOL_LOOKS,
  type HazardPoolPhase,
  hazardPoolPhase,
} from './hazard_pool_core';
import {
  buildHazardPoolGeometry,
  createHazardPoolMaterial,
  setHazardPoolPhase,
  setHazardPoolStyle,
} from './hazard_pool_mesh';

/** The renderer's live compile gate, absent where async compile is not supported. */
export type HazardPoolCompileGate = (target: THREE.Object3D) => Promise<unknown>;

/** Floor height under a point (the renderer's ground sampler). */
export type HazardPoolGroundSample = (x: number, z: number) => number;

/** More than any fight drops at once; a full house steals the oldest drain. */
export const DYNAMIC_HAZARD_POOL_SLOTS = 4;

interface Slot {
  /** The row this slot draws, or null while free. */
  id: string | null;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  ageSec: number;
  armSec: number;
  /** Seconds since the world dropped the row, or null while it is listed. */
  goneSec: number | null;
  seen: boolean;
}

export class DynamicHazardPools {
  readonly root = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly slots: Slot[] = [];
  private readonly phase: HazardPoolPhase = { film: 0, body: 0, arming: 0, fade: 0 };
  private readonly placeholder: THREE.BufferGeometry;

  constructor(
    scene: THREE.Object3D,
    compileGate: HazardPoolCompileGate | undefined,
    private readonly groundY: HazardPoolGroundSample,
  ) {
    this.root.name = 'hazardPools';
    this.placeholder = buildHazardPoolGeometry({ x: 0, z: 0, r: 1 }, true);
    for (let i = 0; i < DYNAMIC_HAZARD_POOL_SLOTS; i++) {
      const mat = createHazardPoolMaterial('violet', this.time);
      const mesh = new THREE.Mesh(this.placeholder, mat);
      mesh.name = 'hazardPool_dynamic';
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.slots.push({ id: null, mesh, mat, ageSec: 0, armSec: 0, goneSec: null, seen: false });
    }
    // Hidden slots still link: the compile walks the whole subtree.
    void attachSceneGroupGated(scene, this.root, compileGate);
  }

  /** Reconcile with this frame's rows and advance every live slot. */
  update(pools: readonly HazardPoolView[], dt: number, reducedMotion: boolean): void {
    if (!reducedMotion) this.time.value += dt;
    for (const slot of this.slots) slot.seen = false;
    for (const pool of pools) {
      const slot = this.slotFor(pool);
      if (!slot) continue;
      slot.seen = true;
      slot.ageSec = pool.ageSec;
      slot.armSec = pool.armSec;
      slot.goneSec = null;
    }
    for (const slot of this.slots) {
      if (slot.id === null) continue;
      if (!slot.seen) {
        slot.goneSec = (slot.goneSec ?? 0) + dt;
        if (slot.goneSec >= HAZARD_POOL_DRAIN_SEC) {
          this.release(slot);
          continue;
        }
      }
      setHazardPoolPhase(
        slot.mat,
        hazardPoolPhase(slot.ageSec, slot.armSec, slot.goneSec, this.phase),
      );
    }
  }

  /** The slot already drawing this row, or a fresh claim for it. */
  private slotFor(pool: HazardPoolView): Slot | null {
    for (const slot of this.slots) if (slot.id === pool.id) return slot;
    let slot: Slot | null = null;
    for (const s of this.slots) {
      if (s.id === null) {
        slot = s;
        break;
      }
    }
    if (!slot) {
      // Every slot busy: take the one furthest into its drain, never a live pool.
      for (const s of this.slots) {
        if (s.goneSec !== null && (!slot || s.goneSec > (slot.goneSec ?? 0))) slot = s;
      }
    }
    if (!slot) return null;
    this.claim(slot, pool);
    return slot;
  }

  private claim(slot: Slot, pool: HazardPoolView): void {
    slot.id = pool.id;
    slot.goneSec = null;
    if (slot.mesh.geometry !== this.placeholder) slot.mesh.geometry.dispose();
    slot.mesh.geometry = buildHazardPoolGeometry({ x: pool.x, z: pool.z, r: pool.r }, true);
    setHazardPoolStyle(slot.mat, pool.style);
    slot.mesh.renderOrder = floorVfxRenderOrder('encounter', HAZARD_POOL_LOOKS[pool.style].step);
    slot.mesh.position.set(pool.x, this.groundY(pool.x, pool.z), pool.z);
    slot.mesh.visible = true;
  }

  private release(slot: Slot): void {
    slot.id = null;
    slot.goneSec = null;
    slot.mesh.visible = false;
  }

  /** How many slots draw a pool right now (live or draining). */
  activeCount(): number {
    let n = 0;
    for (const slot of this.slots) if (slot.id !== null) n++;
    return n;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const slot of this.slots) {
      if (slot.mesh.geometry !== this.placeholder) slot.mesh.geometry.dispose();
      slot.mat.dispose();
    }
    this.placeholder.dispose();
  }
}
