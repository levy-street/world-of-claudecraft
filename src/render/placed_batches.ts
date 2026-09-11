// InstancedMesh batches for editor placements.
//
// One InstancedMesh per (GLB sub-mesh, caster flag), so a village of 200 copies
// of one house costs one draw call per sub-mesh instead of 200 scene subtrees.
// This is the same arrangement the shipped game already uses for its own
// authored art (render/battleground_placements, render/dungeon); placements
// were the one content path still cloning per copy, which is why a map built in
// the editor cost more than the identical map hand-authored in the engine, in
// the editor AND in the real game that loads the exported map.
//
// Ownership split: render/placed_batch_core owns the pure decisions (which
// placements may share a batch, and the dense slot table), this module owns the
// three objects, and render/placed_assets keeps every placement's transform on
// a lightweight proxy Object3D whose matrixWorld feeds the instance matrix. The
// proxy is what lets picking, seating, footprints and the gizmo keep working
// against `entry.model` unchanged, it simply has no geometry under it.
//
// Growth: capacity doubles and the old instance buffer is copied, so a maker
// can keep stamping without a rebuild. Removal is a swap-with-last inside the
// backing buffer, so `mesh.count` alone decides what draws.

import * as THREE from 'three';
import { batchKey, SlotTable } from './placed_batch_core';
import { markSharedMaterial } from './shared_resource';

/** One drawable piece of a template GLB, hoisted out of its scene graph. */
export interface BatchSub {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** The piece's transform inside the GLB, relative to the model root. */
  local: THREE.Matrix4;
}

interface Batch {
  mesh: THREE.InstancedMesh;
  slots: SlotTable;
  local: THREE.Matrix4;
  capacity: number;
}

const INITIAL_CAPACITY = 8;

/**
 * Decompose a loaded template into its instanceable sub-meshes, or null when
 * nothing here can be instanced (a skinned rig, or a GLB with no mesh at all).
 *
 * Skinned meshes are the hard exclusion: an InstancedMesh has no per-instance
 * skeleton, so a rigged character must keep cloning.
 */
export function templateSubs(object: THREE.Object3D): BatchSub[] | null {
  object.updateMatrixWorld(true);
  const subs: BatchSub[] = [];
  let skinned = false;
  object.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // A multi-material mesh needs geometry groups, which instancing cannot
    // split per instance; take the first material the way the battleground
    // builder does, and let anything genuinely multi-material fall back to a
    // clone by reporting no subs.
    if (Array.isArray(mesh.material) && mesh.material.length > 1) {
      skinned = true; // reuse the "cannot instance" exit
      return;
    }
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    markSharedMaterial(material);
    subs.push({ geometry: mesh.geometry, material, local: mesh.matrixWorld.clone() });
  });
  if (skinned || subs.length === 0) return null;
  return subs;
}

/**
 * The batch set for one placement view. Keyed by (path, sub-mesh, caster) so
 * two placements of the same asset land in the same instance buffer.
 */
export class PlacedBatches {
  readonly group: THREE.Group;
  private readonly batches = new Map<string, Batch>();
  /** Which batch keys an id currently occupies, so detach needs no path. */
  private readonly keysById = new Map<number, string[]>();
  private readonly scratch = new THREE.Matrix4();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'placed-asset-batches';
    // The batches are positioned entirely by their instance matrices.
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  /** Is `id` currently drawn as instances? */
  has(id: number): boolean {
    return this.keysById.has(id);
  }

  /** Live instance count, for the draw-call readout and tests. */
  get instanceCount(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.slots.count;
    return n;
  }

  /** Number of InstancedMeshes, i.e. the draw calls these placements cost. */
  get batchCount(): number {
    return this.batches.size;
  }

  /**
   * Give `id` an instance in every sub-mesh batch of its template, seated by
   * `world` (the placement proxy's matrixWorld). Idempotent: attaching a live
   * id just rewrites its matrices.
   */
  attach(id: number, path: string, subs: readonly BatchSub[], world: THREE.Matrix4): void {
    if (this.keysById.has(id)) {
      this.setMatrix(id, world);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < subs.length; i++) {
      const key = batchKey(path, i, true);
      const batch = this.batchFor(key, subs[i]);
      const slot = batch.slots.alloc(id);
      this.grow(batch, slot + 1);
      this.scratch.multiplyMatrices(world, batch.local);
      batch.mesh.setMatrixAt(slot, this.scratch);
      batch.mesh.count = batch.slots.count;
      batch.mesh.instanceMatrix.needsUpdate = true;
      keys.push(key);
    }
    this.keysById.set(id, keys);
  }

  /** Rewrite every instance of `id` after its transform changed. */
  setMatrix(id: number, world: THREE.Matrix4): void {
    const keys = this.keysById.get(id);
    if (!keys) return;
    for (const key of keys) {
      const batch = this.batches.get(key);
      const slot = batch?.slots.slotOf(id);
      if (!batch || slot === undefined) continue;
      this.scratch.multiplyMatrices(world, batch.local);
      batch.mesh.setMatrixAt(slot, this.scratch);
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Remove `id` from every batch. The last live instance is copied down into
   * the hole (raw buffer bytes, the moved instance's transform is already
   * correct, it just lives at a different index now), then `count` drops, so
   * nothing stale is ever submitted.
   */
  detach(id: number): void {
    const keys = this.keysById.get(id);
    if (!keys) return;
    this.keysById.delete(id);
    for (const key of keys) {
      const batch = this.batches.get(key);
      if (!batch) continue;
      const release = batch.slots.free(id);
      if (!release) continue;
      const array = batch.mesh.instanceMatrix.array as Float32Array;
      if (release.moved !== null) {
        // The vacated slot takes the bytes of what was the last live instance.
        const from = batch.slots.count * 16; // old last index, now past the end
        array.copyWithin(release.freed * 16, from, from + 16);
      }
      batch.mesh.count = batch.slots.count;
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Follow a document reindex. Call in ascending order (see SlotTable.rename). */
  rename(from: number, to: number): void {
    const keys = this.keysById.get(from);
    if (!keys) return;
    this.keysById.delete(from);
    for (const key of keys) this.batches.get(key)?.slots.rename(from, to);
    this.keysById.set(to, keys);
  }

  /** Drop every batch (the geometries and materials belong to the loader cache
   *  and to markSharedMaterial, so they are never disposed here). */
  clear(): void {
    for (const batch of this.batches.values()) {
      this.group.remove(batch.mesh);
      batch.mesh.dispose();
    }
    this.batches.clear();
    this.keysById.clear();
  }

  private batchFor(key: string, sub: BatchSub): Batch {
    let batch = this.batches.get(key);
    if (batch) return batch;
    const mesh = new THREE.InstancedMesh(sub.geometry, sub.material, INITIAL_CAPACITY);
    mesh.name = `placed-batch:${key}`;
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    // Instances are scattered across the whole map, so the batch's own bounds
    // span it: frustum culling at this level would only ever be a false
    // negative risk. Per-instance culling is the LOD slot release instead.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    batch = { mesh, slots: new SlotTable(), local: sub.local, capacity: INITIAL_CAPACITY };
    this.batches.set(key, batch);
    return batch;
  }

  /** Ensure the backing buffer holds `needed` instances, doubling when not. */
  private grow(batch: Batch, needed: number): void {
    if (needed <= batch.capacity) return;
    let capacity = batch.capacity;
    while (capacity < needed) capacity *= 2;
    const old = batch.mesh;
    const next = new THREE.InstancedMesh(old.geometry, old.material, capacity);
    next.name = old.name;
    next.castShadow = old.castShadow;
    next.receiveShadow = old.receiveShadow;
    next.matrixAutoUpdate = false;
    next.updateMatrix();
    next.frustumCulled = false;
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    next.count = old.count;
    next.instanceMatrix.needsUpdate = true;
    this.group.remove(old);
    old.dispose();
    this.group.add(next);
    batch.mesh = next;
    batch.capacity = capacity;
  }

  /** The entry id drawn at `instanceId` of `mesh`, or null when it is not ours. */
  idAt(mesh: THREE.Object3D, instanceId: number): number | null {
    for (const batch of this.batches.values()) {
      if (batch.mesh !== mesh) continue;
      if (instanceId < 0 || instanceId >= batch.slots.count) return null;
      return batch.slots.liveIds()[instanceId] ?? null;
    }
    return null;
  }
}
